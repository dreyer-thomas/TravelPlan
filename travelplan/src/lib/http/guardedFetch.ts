import dns, { type LookupAddress } from "node:dns";
import https from "node:https";
import net from "node:net";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import ipaddr from "ipaddr.js";

/**
 * Story 15.1, AC 18. The one outbound fetch for URLs a client chose: client ID metadata documents now,
 * documents by URL in Story 15.7.
 *
 * Every other fetcher in this app talks to a fixed host (OSRM, ECB, Nominatim, Wikimedia) and can rely on a
 * host allowlist. A URL handed to us by a client cannot, so this one checks where the name actually points:
 *
 * - **https on port 443 only**, no userinfo, no IP-literal host. A literal would skip the DNS check below,
 *   and no legitimate client metadata URL needs one.
 * - **DNS once, every address public.** The `lookup` hook resolves with `all: true` and refuses the request
 *   if *any* address is not public unicast (loopback, private, link-local, unique-local, CGNAT, multicast,
 *   reserved, NAT64, IPv4-mapped IPv6 unwrapped first). A name answering with one public and one private
 *   address is refused, because the connection could pick either.
 * - **The checked address is the one connected to.** `https.request` connects with whatever the `lookup`
 *   hook returns, while SNI and the certificate check stay on the original hostname, so a second DNS answer
 *   (rebinding) never gets a say.
 * - **Redirects** only up to `maxRedirects`, each hop checked the same way; `0` makes any 3xx a failure.
 * - **Bounded:** the body is counted and the request destroyed at `maxBytes`; one timer bounds the whole call.
 * - **No credentials:** no cookies, no `Authorization`, a fresh connection per request (`agent: false`).
 */

export type GuardedFetchOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  accept?: string;
  userAgent?: string;
};

export type GuardedFetchFailure =
  | "invalid_url"
  | "blocked_address"
  | "dns_failed"
  | "redirect"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "network";

export type GuardedFetchResult =
  | { ok: true; status: number; headers: IncomingHttpHeaders; body: Uint8Array; url: string }
  | { ok: false; reason: GuardedFetchFailure };

type LookupCallback = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;
export type GuardedLookup = (hostname: string, options: { all: true; family?: number }, callback: LookupCallback) => void;

export type GuardedFetchDeps = {
  lookup: GuardedLookup;
  request: typeof https.request;
};

const defaultDeps: GuardedFetchDeps = {
  lookup: (hostname, options, callback) => dns.lookup(hostname, options, callback),
  request: https.request,
};

const BLOCKED_ERROR_CODE = "ETRAVELPLAN_BLOCKED_ADDRESS";

export const isPublicUnicastAddress = (address: string) => {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
};

const parseTarget = (raw: string) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.port !== "" && url.port !== "443") return null;
  if (url.username !== "" || url.password !== "") return null;
  // An IPv6 literal arrives bracketed (`[::1]`), which `net.isIP` does not recognise; refuse both forms.
  if (url.hostname.startsWith("[") || net.isIP(url.hostname) !== 0) return null;
  if (url.hostname === "") return null;
  return url;
};

type HopOutcome =
  | { kind: "done"; result: GuardedFetchResult }
  | { kind: "redirect"; location: string };

const fetchOnce = (url: URL, options: GuardedFetchOptions, deps: GuardedFetchDeps, signal: AbortSignal) =>
  new Promise<HopOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: HopOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const fail = (reason: GuardedFetchFailure) => finish({ kind: "done", result: { ok: false, reason } });

    let blocked = false;
    const lookup = (hostname: string, lookupOptions: { all?: boolean; family?: number } | number | undefined, callback: (...args: unknown[]) => void) => {
      const family = typeof lookupOptions === "number" ? lookupOptions : (lookupOptions?.family ?? 0);
      const wantsAll = typeof lookupOptions === "object" && lookupOptions?.all === true;
      deps.lookup(hostname, { all: true, family }, (error, addresses) => {
        if (error) {
          callback(error);
          return;
        }
        if (addresses.length === 0 || addresses.some((entry) => !isPublicUnicastAddress(entry.address))) {
          blocked = true;
          const blockedError: NodeJS.ErrnoException = new Error("Refused a non-public address");
          blockedError.code = BLOCKED_ERROR_CODE;
          callback(blockedError);
          return;
        }
        if (wantsAll) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    };

    const request = deps.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        lookup: lookup as unknown as typeof dns.lookup,
        headers: {
          accept: options.accept ?? "*/*",
          "user-agent": options.userAgent ?? "TravelPlan",
        },
      },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          request.destroy();
          if (typeof location === "string" && location.length > 0) finish({ kind: "redirect", location });
          else fail("network");
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            fail("too_large");
            response.destroy();
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          finish({
            kind: "done",
            result: {
              ok: true,
              status,
              headers: response.headers,
              body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
              url: url.toString(),
            },
          });
        });
        response.on("error", () => fail("network"));
      },
    );

    const onAbort = () => {
      fail("timeout");
      request.destroy();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    request.on("error", (error: NodeJS.ErrnoException) => {
      if (blocked || error.code === BLOCKED_ERROR_CODE) fail("blocked_address");
      else if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") fail("dns_failed");
      else fail("network");
    });
    request.on("close", () => signal.removeEventListener("abort", onAbort));
    request.end();
  });

export const guardedFetch = async (
  rawUrl: string,
  options: GuardedFetchOptions,
  deps: GuardedFetchDeps = defaultDeps,
): Promise<GuardedFetchResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let current = parseTarget(rawUrl);
    if (!current) return { ok: false, reason: "invalid_url" };
    const maxRedirects = options.maxRedirects ?? 0;
    for (let hop = 0; ; hop += 1) {
      const outcome = await fetchOnce(current, options, deps, controller.signal);
      if (outcome.kind === "done") return outcome.result;
      if (maxRedirects === 0) return { ok: false, reason: "redirect" };
      if (hop >= maxRedirects) return { ok: false, reason: "too_many_redirects" };
      let next: URL | null;
      try {
        next = parseTarget(new URL(outcome.location, current).toString());
      } catch {
        next = null;
      }
      if (!next) return { ok: false, reason: "invalid_url" };
      current = next;
    }
  } finally {
    clearTimeout(timer);
  }
};
