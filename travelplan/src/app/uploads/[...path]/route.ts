import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { hasTripReadAccess } from "@/lib/auth/tripAccess";
import { getTripUploadDir, isSafeMediaSegment } from "@/lib/trips/uploadPaths";

/**
 * The only way to read an uploaded file (Story 8.3, NFR2).
 *
 * Until this route existed, media lived under `public/` and was served by Next statically - ahead of
 * any route handler and without consulting the session, so every trip photo was readable by anyone
 * who learned its URL. Trip photos are frequently not the owner's to publish, which makes the driver
 * rights rather than secrecy. `uploadPaths.ts` moved the root out of the served tree; this handler is
 * what puts the bytes back within reach of the people entitled to them, and nobody else.
 *
 * **No stored URL changed.** A stored URL is `/uploads/trips/<tripId>/...` and always was, so this
 * catch-all sits exactly where the static server used to and the database, the four upload routes and
 * every component are untouched.
 *
 * **This handler self-guards and is deliberately absent from `middleware.ts`'s matcher.** That
 * matcher is a closed list (`/`, `/trips/:path*`, `/users/:path*`, `/admin/:path*`, `/api/trips`,
 * `/api/trips/:path((?!import/?$).*)`, `/auth/first-login-password`) and adding `/uploads` to it
 * would re-run a session check in the edge runtime for every thumbnail on the page while still
 * leaving the trip-level decision here, because Prisma does not run there. It is the same pattern
 * `middleware.ts` already documents for `/api/admin/*` and `/api/users`, and CVE-2025-29927 - a
 * middleware authorisation bypass via a spoofable `x-middleware-subrequest` header - is the general
 * argument for keeping an authorisation decision inside the handler that owns it. Verified against
 * `src/middleware.ts`; Story 8.2 renames that file to `src/proxy.ts` and pins the matcher
 * character-for-character, so the reasoning carries over to either filename unchanged.
 */

// `node:fs` and `node:stream`.
export const runtime = "nodejs";
// The handler reads cookies and the filesystem, so it can never be prerendered or cached. Forcing it
// removes any question about Next's route cache. `revalidate = 0` would be redundant beside this.
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    // Next types a catch-all segment as `string[]` and URL-decodes each element before the handler
    // sees it. Both facts matter below.
    path: string[];
  }>;
};

/**
 * Closed map, and closed on purpose.
 *
 * `X-Content-Type-Options: nosniff` is set on every response, which means a wrong declared type is
 * not a cosmetic problem - the browser refuses to reinterpret and the file simply fails to render.
 * So the type comes from the *stored* extension and nothing else: never sniffed from the bytes, never
 * taken from anything a client sent. The three image types are exactly what the four image upload
 * routes accept (`imageUploads.ts`), `pdf` is what Story 9.1's two document routes added
 * (`documentUploads.ts`), and an import can only write an extension derived from those same
 * allow-lists.
 *
 * **`pdf` is the one entry served `Content-Disposition: inline`.** A document chip opens in a new tab
 * and the file has to render there; without the entry a PDF is `application/octet-stream` with
 * `attachment`, which downloads instead of opening - a green test suite and a feature that does not
 * work. `inline` alongside `nosniff` does not suppress rendering: `nosniff` only stops the browser
 * second-guessing a *declared* type, and `application/pdf` is the right declaration. Everything
 * unmapped keeps `attachment`, which is what makes a file of unknown type harmless.
 */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** The one mapped type that renders in place rather than being handed to the OS. */
const INLINE_CONTENT_TYPE = "application/pdf";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/**
 * `private` and deliberately not `no-store`.
 *
 * Every thumbnail is now a route invocation with a session verify and a Prisma query behind it, and a
 * day view renders on the order of twenty of them. `no-store` would forbid the browser from keeping
 * the bytes at all, so every navigation would pay that cost afresh for every image on screen.
 * `max-age=0, must-revalidate` keeps the bytes and turns a repeat view into a conditional request
 * that this handler answers with a 304 - which still authorises, but transfers nothing.
 *
 * `no-transform` is not decoration. `next start` compresses responses by default (`next.config.ts`
 * sets no `compress` key), and a gzipped `206` is a corrupted byte range: the client writes the
 * compressed bytes into the offset it asked for and renders garbage rather than reporting an error.
 */
const CACHE_CONTROL = "private, max-age=0, must-revalidate, no-transform";

const notFound = () => fail(apiError("not_found", "Trip not found"), 404);

const extensionOf = (fileName: string) => {
  const extension = path.extname(fileName).replace(/^\./, "").toLowerCase();
  return extension;
};

/**
 * Weak validator over size and mtime, which is what `serve-static` derives one from and what Next's
 * own static server was giving these URLs for free until this route took the job.
 *
 * A Route Handler is given neither an `ETag` nor a `304`: `generateEtags` does not reach route
 * handlers, and that is deliberate on Next's side. So "conditional-request behaviour is unchanged"
 * meant implementing it here rather than doing nothing.
 */
const weakEtagFor = (stats: { size: number; mtimeMs: number }) =>
  `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;

/**
 * Weak comparison, per RFC 9110: `W/` is stripped from both sides before comparing.
 *
 * `allowStar` exists because `*` is legal in `If-None-Match` (where it means "any current
 * representation", so an existing file matches) but is **not** legal in `If-Range`, which takes a
 * single validator. Accepting it there would turn a malformed header into a `206`.
 */
const matchesEtag = (headerValue: string | null, etag: string, options?: { allowStar?: boolean }) => {
  if (!headerValue) {
    return false;
  }
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  const target = normalize(etag);
  return headerValue
    .split(",")
    .map(normalize)
    .some((candidate) => (options?.allowStar === true && candidate === "*") || candidate === target);
};

/**
 * `If-Modified-Since`, for the date validator Next's static server also sent.
 *
 * `serve-static` supplies both `Last-Modified` and an `ETag`, and a cache or intermediary holding
 * only the date one revalidates with this header. Answering it is the other half of AC5's
 * "conditional-request behaviour is preserved"; mtime is compared at second granularity because
 * that is all an HTTP-date carries.
 */
const notModifiedSince = (headerValue: string | null, mtimeMs: number) => {
  if (!headerValue) {
    return false;
  }
  const since = Date.parse(headerValue);
  if (Number.isNaN(since)) {
    return false;
  }
  return Math.floor(mtimeMs / 1000) * 1000 <= since;
};

type ParsedRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  /** Multi-range, or a spelling this handler does not implement: answer the whole body. */
  | { kind: "ignore" }
  | { kind: "range"; start: number; end: number };

/**
 * Single ranges only.
 *
 * A multi-range request needs a `multipart/byteranges` body, and nothing that reaches this route
 * sends one - browsers do not for `<img>` or `<embed>`, only download managers do. Falling back to
 * the whole `200` is a correct answer to a `Range` a server chooses not to honour, and it is a much
 * better failure mode than a mishandled multipart response.
 */
const parseRange = (headerValue: string | null, size: number): ParsedRange => {
  if (!headerValue) {
    return { kind: "none" };
  }
  const match = /^bytes=(.*)$/i.exec(headerValue.trim());
  if (!match) {
    return { kind: "ignore" };
  }
  const spec = match[1];
  if (spec.includes(",")) {
    return { kind: "ignore" };
  }

  const parts = /^(\d*)-(\d*)$/.exec(spec.trim());
  if (!parts) {
    return { kind: "ignore" };
  }
  const [, rawStart, rawEnd] = parts;

  // An empty file can satisfy no range at all, not even `bytes=0-`.
  if (size === 0) {
    return { kind: "unsatisfiable" };
  }

  if (rawStart === "" && rawEnd === "") {
    return { kind: "ignore" };
  }

  if (rawStart === "") {
    // Suffix range: the last N bytes, clamped to the whole file rather than refused when N > size.
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0) {
      return { kind: "unsatisfiable" };
    }
    return { kind: "range", start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) {
    return { kind: "unsatisfiable" };
  }
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) {
    // An inverted range (`bytes=5-2`) is an *invalid* byte-range-spec, not an unsatisfiable one.
    // RFC 9110 §14.2 says an invalid range set must be ignored and the whole representation served;
    // 416 is reserved for a syntactically valid range that falls outside the file. Answering 416
    // here would hand the client nothing at all instead of the file it can still use.
    return { kind: "ignore" };
  }
  return { kind: "range", start, end };
};

/**
 * `ok()` cannot carry bytes - it is hard-wired to `NextResponse.json` and would serialise a Buffer
 * into `{"0":137,...}`. The one precedent in this repo for a non-JSON body is the trip-export ZIP,
 * which returns a bare `new Response(stream, { headers })`; this does the same.
 *
 * The abort listener is defence rather than a guarantee: reports exist of `request.signal` firing
 * late, so a navigated-away request may still read a few chunks. Destroying the stream on abort
 * costs nothing and closes the common case. An *already*-aborted signal is checked separately -
 * `addEventListener` never fires for an event that has already happened, so relying on the listener
 * alone leaks the stream and its descriptor for every request that was cancelled before it got here.
 *
 * The `error` handler is not decoration either. `Content-Length` was derived from a `stat` taken
 * before this call, so a file removed or replaced in between (trip import renames a whole trip
 * directory aside; trip delete removes it) fails the read after the status and length are already
 * committed. Nothing can turn that into a clean status at this point, but destroying the stream ends
 * the response instead of leaving an unhandled `error` event on a live descriptor.
 */
const streamFile = (
  request: NextRequest,
  filePath: string,
  options: { start?: number; end?: number },
) => {
  const stream = createReadStream(filePath, options);
  stream.on("error", () => stream.destroy());
  if (request.signal.aborted) {
    stream.destroy();
  } else {
    request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  }
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
};

export const GET = async (request: NextRequest, context: RouteContext) => {
  // Authentication first: an unauthenticated caller learns nothing about what exists.
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  // Only `params.path` is read, so the query string is ignored by construction - which is what
  // `withImageCacheBuster`'s `?v=<token>` and `toCssUrl`'s `encodeURI` of the whole URL require.
  const { path: segments } = await context.params;
  if (!Array.isArray(segments) || segments.length < 3) {
    return notFound();
  }
  // Every stored URL is `/uploads/trips/<tripId>/...` with `tripId` third overall and therefore
  // second here. Anything else is not a media URL this app ever wrote.
  // `isSafeMediaSegment` stops a hostile segment reaching `path.resolve` and `fs` at all; it is not
  // the containment check, which is the two layers further down. See its docblock for why one decoded
  // catch-all element is not the same thing as one path component.
  if (segments[0] !== "trips" || !segments.every(isSafeMediaSegment)) {
    return notFound();
  }
  const tripId = segments[1];

  // 404 and not 403, this repo's settled convention (`travel-segments/route.ts` is the exemplar):
  // distinguishing "exists but hidden" from "does not exist" leaks which trips exist. Note this is
  // `hasTripReadAccess` - owner, viewer *and* contributor - and not the write-level gate the four media
  // upload routes carry (`hasTripOwnerAccess` until Story 5.13, `refuseUnlessTripWriter` since). A viewer
  // who can see the day must be able to see its photos.
  //
  // No `requireCsrf`: it guards mutating verbs, and a browser never attaches `x-csrf-token` to an
  // `<img>` request, so requiring one here would break every image on every page.
  if (!(await hasTripReadAccess(userId, tripId))) {
    return notFound();
  }

  // Three containment layers, mirroring `resolveOwnedMediaPath` in `tripRepo.ts` layer for layer -
  // including *which root* it contains against, which is the trip's own directory and not the
  // uploads root. That distinction is the whole point: authorisation above is per-trip, so
  // containment must be per-trip too or the two scopes disagree. Rooted at `uploads/`, a path that
  // reaches a *different* trip's directory is still "contained" - both the lexical and the realpath
  // layer admit `<root>/uploads/trips/<other>/hero.png`, and the only thing refusing it would be
  // `isSafeMediaSegment`'s `..` rejection, with a symlink into a sibling trip not refused at all.
  // Rooting here makes a cross-trip read structurally impossible rather than guard-dependent.
  //
  // Built from `getTripUploadDir` rather than by re-joining `getMediaRoot()` with "uploads": the
  // layout belongs to `uploadPaths.ts`, and this is the one string that defines containment.
  const tripRoot = path.resolve(getTripUploadDir(tripId));
  // `segments` is `["trips", tripId, ...rest]` and `tripRoot` already spans the first two, so only
  // the remainder is joined on. `rest` is non-empty because of the length check above.
  const requested = path.resolve(path.join(tripRoot, ...segments.slice(2)));
  // Lexical containment. The trailing separator is what stops a sibling directory - `.../<id>-evil` -
  // from passing a bare `startsWith(tripRoot)`.
  if (!requested.startsWith(`${tripRoot}${path.sep}`)) {
    console.error("uploads GET: path escaped the trip upload root", { tripId, segments });
    return notFound();
  }
  // Realpath the *root* as well as the file. On macOS `os.tmpdir()` is a symlink into `/private`,
  // which is exactly where the test suite's media root lives, so comparing a realpath-ed file
  // against a lexical root would reject perfectly valid paths. `tripRepo.ts` computes its
  // `ownedUploadRootReal` for the same reason.
  const tripRootReal = await fs.realpath(tripRoot).catch(() => tripRoot);
  // And the file, because `fs.stat` and `createReadStream` both follow symlinks: a symlink planted
  // inside the trip's directory pointing anywhere else on the box - including at another trip -
  // passes the lexical check above and would stream its target's bytes. This is the layer that
  // closes that, and the only one that can.
  const real = await fs.realpath(requested).catch(() => null);
  if (real === null) {
    // Much the most common cause is simply a missing file, which is not worth a log line on every
    // stale thumbnail URL. Distinguished from a containment refusal above precisely so the two are
    // not indistinguishable in operations: a botched media move looks like a wall of 404s, and a
    // traversal probe looks like the line above.
    return notFound();
  }
  if (!real.startsWith(`${tripRootReal}${path.sep}`)) {
    console.error("uploads GET: symlink target escaped the trip upload root", { tripId, segments });
    return notFound();
  }

  const stats = await fs.stat(real).catch(() => null);
  if (!stats || !stats.isFile()) {
    return notFound();
  }

  const etag = weakEtagFor(stats);
  const lastModified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000).toUTCString();
  // From the extension in the *stored URL*, which is what AC5 says, and not from the resolved
  // target's - a symlink is the one case where the two differ, and the declared type must describe
  // the URL the browser asked for.
  const extension = extensionOf(segments[segments.length - 1]);
  const mappedContentType = CONTENT_TYPE_BY_EXTENSION[extension];
  const contentType = mappedContentType ?? FALLBACK_CONTENT_TYPE;

  const headers = new Headers({
    "content-type": contentType,
    "cache-control": CACHE_CONTROL,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    etag,
    "last-modified": lastModified,
    // The body depends entirely on the session cookie. `private` already tells a conformant shared
    // cache not to store this, but the reverse-proxy configuration is Story 8.1's to write and these
    // responses look exactly like static images - so say which header varies the representation
    // rather than relying on nobody adding a `proxy_cache` for `/uploads`.
    vary: "Cookie",
  });
  if (!mappedContentType) {
    // An unrecognised extension is never guessed at and never rendered in place.
    headers.set("content-disposition", "attachment");
  } else if (contentType === INLINE_CONTENT_TYPE) {
    // Stated rather than left to the default, because the default is a browser preference: some
    // builds and some enterprise policies download a PDF that carries no disposition at all, and the
    // chip's whole promise is that the ticket opens.
    headers.set("content-disposition", "inline");
  }

  // `If-None-Match` is evaluated before `Range` (RFC 9110), and the `ETag` must be echoed on the 304:
  // omitting it there is the classic silent-re-fetch bug, because the client has nothing to
  // revalidate against next time. `If-Modified-Since` is only consulted when there is no
  // `If-None-Match`, because the entity tag is the stronger validator and wins when both are sent.
  const ifNoneMatch = request.headers.get("if-none-match");
  const isNotModified = ifNoneMatch
    ? matchesEtag(ifNoneMatch, etag, { allowStar: true })
    : notModifiedSince(request.headers.get("if-modified-since"), stats.mtimeMs);
  if (isNotModified) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": CACHE_CONTROL,
        "last-modified": lastModified,
        vary: "Cookie",
      },
    });
  }

  // `If-Range` that does not match the current representation means the client's copy is stale, so
  // the `Range` it computed against that copy is meaningless: serve the whole current file instead.
  // No `allowStar` here - `*` is legal in `If-None-Match` but not in `If-Range`, so a header spelt
  // that way is malformed and must not be honoured as a match.
  const ifRange = request.headers.get("if-range");
  const rangeIsUsable = !ifRange || matchesEtag(ifRange, etag);
  const range = rangeIsUsable ? parseRange(request.headers.get("range"), stats.size) : { kind: "none" as const };

  if (range.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        vary: "Cookie",
        "content-range": `bytes */${stats.size}`,
        "accept-ranges": "bytes",
        "cache-control": CACHE_CONTROL,
      },
    });
  }

  if (range.kind === "range") {
    const { start, end } = range;
    headers.set("content-range", `bytes ${start}-${end}/${stats.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(streamFile(request, real, { start, end }), { status: 206, headers });
  }

  headers.set("content-length", String(stats.size));
  return new Response(streamFile(request, real, {}), { status: 200, headers });
};
