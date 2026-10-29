import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type https from "node:https";
import { describe, expect, it } from "vitest";
import { guardedFetch, isPublicUnicastAddress, type GuardedFetchDeps, type GuardedLookup } from "@/lib/http/guardedFetch";

type FakeResponse = { status: number; headers?: Record<string, string>; body?: string | Buffer };

/**
 * A fake `https.request` that does what Node does with the `lookup` option: it asks the hook for the
 * address(es) and only "connects" when the hook answers. No socket is ever opened.
 */
const buildDeps = (dnsTable: Record<string, string[]>, responses: Record<string, FakeResponse | (() => FakeResponse)>) => {
  const connected: { host: string; address: unknown }[] = [];
  const requested: string[] = [];
  const lookup: GuardedLookup = (hostname, _options, callback) => {
    const addresses = dnsTable[hostname];
    if (!addresses) {
      const error: NodeJS.ErrnoException = new Error("not found");
      error.code = "ENOTFOUND";
      callback(error, []);
      return;
    }
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  };
  const request = ((options: https.RequestOptions, onResponse: (response: unknown) => void) => {
    const emitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    emitter.destroy = () => {
      queueMicrotask(() => emitter.emit("close"));
    };
    emitter.end = () => {
      const host = String(options.hostname);
      requested.push(`${host}${options.path}`);
      (options.lookup as unknown as (h: string, o: { all: boolean }, cb: (...args: unknown[]) => void) => void)(
        host,
        { all: true },
        (error: unknown, address: unknown) => {
          if (error) {
            emitter.emit("error", error);
            return;
          }
          connected.push({ host, address });
          const entry = responses[`${host}${options.path}`];
          const spec = typeof entry === "function" ? entry() : entry ?? { status: 404 };
          const body = spec.body === undefined ? [] : [Buffer.isBuffer(spec.body) ? spec.body : Buffer.from(spec.body)];
          const response = Readable.from(body) as Readable & { statusCode: number; headers: Record<string, string> };
          response.statusCode = spec.status;
          response.headers = spec.headers ?? {};
          onResponse(response);
        },
      );
    };
    return emitter;
  }) as unknown as typeof https.request;
  const deps: GuardedFetchDeps = { lookup, request };
  return { deps, connected, requested };
};

const options = { maxBytes: 1024, timeoutMs: 2000 };

describe("isPublicUnicastAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::7f00:1",
    "::a00:1",
  ])("refuses %s", (address) => {
    expect(isPublicUnicastAddress(address)).toBe(false);
  });

  it.each(["160.79.104.10", "93.184.216.34", "2606:4700::6810:84e5", "::ffff:93.184.216.34"])("accepts %s", (address) => {
    expect(isPublicUnicastAddress(address)).toBe(true);
  });
});

describe("guardedFetch", () => {
  it("fetches a public https URL and connects to the checked address", async () => {
    const { deps, connected } = buildDeps(
      { "claude.ai": ["160.79.104.10"] },
      { "claude.ai/oauth/meta": { status: 200, headers: { "content-type": "application/json" }, body: '{"a":1}' } },
    );
    const result = await guardedFetch("https://claude.ai/oauth/meta", options, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(Buffer.from(result.body).toString()).toBe('{"a":1}');
    expect(connected).toHaveLength(1);
  });

  it.each([
    ["127.0.0.1"],
    ["10.0.0.1"],
    ["169.254.169.254"],
    ["::1"],
    ["::ffff:127.0.0.1"],
    ["fd00::1"],
  ])("refuses a hostname resolving to %s without connecting", async (address) => {
    const { deps, connected } = buildDeps({ "evil.example": [address] }, {});
    const result = await guardedFetch("https://evil.example/x", options, deps);
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(connected).toHaveLength(0);
  });

  it("refuses a hostname resolving to one public and one private address", async () => {
    const { deps, connected } = buildDeps({ "mixed.example": ["93.184.216.34", "10.0.0.1"] }, {});
    const result = await guardedFetch("https://mixed.example/x", options, deps);
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(connected).toHaveLength(0);
  });

  it.each([
    "http://claude.ai/x",
    "https://claude.ai:8443/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://user:pass@claude.ai/x",
    "not a url",
  ])("refuses %s before any lookup", async (url) => {
    const { deps, requested } = buildDeps({ "claude.ai": ["160.79.104.10"] }, {});
    const result = await guardedFetch(url, options, deps);
    expect(result).toEqual({ ok: false, reason: "invalid_url" });
    expect(requested).toHaveLength(0);
  });

  it("treats any redirect as a failure when maxRedirects is 0", async () => {
    const { deps } = buildDeps(
      { "claude.ai": ["160.79.104.10"] },
      { "claude.ai/x": { status: 302, headers: { location: "https://claude.ai/y" } } },
    );
    expect(await guardedFetch("https://claude.ai/x", options, deps)).toEqual({ ok: false, reason: "redirect" });
  });

  it("checks every redirect hop the same way", async () => {
    const { deps, connected } = buildDeps(
      { "claude.ai": ["160.79.104.10"], "internal.example": ["10.0.0.5"] },
      { "claude.ai/x": { status: 302, headers: { location: "https://internal.example/secret" } } },
    );
    const result = await guardedFetch("https://claude.ai/x", { ...options, maxRedirects: 3 }, deps);
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(connected.map((entry) => entry.host)).toEqual(["claude.ai"]);
  });

  it("follows allowed redirects up to the limit", async () => {
    const { deps } = buildDeps(
      { "a.example": ["93.184.216.34"] },
      {
        "a.example/1": { status: 301, headers: { location: "/2" } },
        "a.example/2": { status: 200, body: "ok" },
      },
    );
    const result = await guardedFetch("https://a.example/1", { ...options, maxRedirects: 3 }, deps);
    expect(result.ok && Buffer.from(result.body).toString()).toBe("ok");
    const loop = buildDeps({ "a.example": ["93.184.216.34"] }, { "a.example/1": { status: 302, headers: { location: "/1" } } });
    expect(await guardedFetch("https://a.example/1", { ...options, maxRedirects: 2 }, loop.deps)).toEqual({
      ok: false,
      reason: "too_many_redirects",
    });
  });

  it("aborts a body over maxBytes", async () => {
    const { deps } = buildDeps(
      { "claude.ai": ["160.79.104.10"] },
      { "claude.ai/big": { status: 200, body: Buffer.alloc(2048, 1) } },
    );
    expect(await guardedFetch("https://claude.ai/big", options, deps)).toEqual({ ok: false, reason: "too_large" });
  });

  it("reports an unknown host as a DNS failure", async () => {
    const { deps } = buildDeps({}, {});
    expect(await guardedFetch("https://nowhere.example/x", options, deps)).toEqual({ ok: false, reason: "dns_failed" });
  });

  it("times out", async () => {
    const lookup: GuardedLookup = () => {
      // never answers
    };
    const request = (() => {
      const emitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      emitter.end = () => undefined;
      emitter.destroy = () => undefined;
      return emitter;
    }) as unknown as typeof https.request;
    const result = await guardedFetch("https://slow.example/x", { maxBytes: 10, timeoutMs: 20 }, { lookup, request });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
