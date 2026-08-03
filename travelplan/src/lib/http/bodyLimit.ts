/**
 * Two guards on a request body's size: the cheap `content-length` pre-check that keeps an oversized
 * upload from being answered with the wrong error, and the counted read that bounds a JSON body a
 * `content-length` header never described.
 *
 * **Why this exists, and it is not memory.** Next buffers a request body in memory for every path
 * `middleware.ts`'s matcher covers and caps that buffer at `proxyClientMaxBodySize`. Over the cap it
 * does not refuse the request - it logs "Request body exceeded ..." and *truncates the stream*, so
 * `await request.formData()` then throws on a body that was intact when it left the client, and the
 * route answers `invalid_form_data` "Request body must be valid form data". That is the failure of
 * 2026-08-02, and it is a bad answer twice over: the upload's real problem was its size, and the
 * message sends the user off to inspect a file that is fine.
 *
 * The cap used to be 320 MB, which is why no upload route ever hit this: nothing anyone uploads is
 * that large. Story 2.34 took `/api/trips/import` - the only request that justified the number - out
 * of the matcher and lowered the cap to 20 MB, because a 320 MB memory buffer on endpoints that
 * accept 5 and 15 MB was the exact hazard that story removed, relocated to its neighbours. That is
 * the right trade, but it moves the truncation cliff from 320 MB down to just above the routes' own
 * ceilings, where a 25 MB photo can actually land.
 *
 * So each matched upload route checks the size the client declares *before* asking Next for the body,
 * and answers with its own size message.
 *
 * **What that buys is the message, and only the message.** It does not avoid the buffer. In
 * `next/dist/server/body-streams.js`, `cloneBodyStream()` pipes the request into two `PassThrough`s
 * with `push` and no regard for backpressure, and `finalize()` awaits the request's `end` event before
 * handing the buffered copy back - so for any matched path the whole body, up to
 * `proxyClientMaxBodySize`, is already resident before the handler runs its first line. "Before Next
 * is asked for the body" in the routes means before `request.formData()`, not before the buffering.
 * The memory win of Story 2.34 came from lowering the cap and taking the import out of the matcher,
 * not from this guard.
 *
 * `content-length` is a claim and a `Transfer-Encoding: chunked` request need not make it, so this is
 * a pre-check rather than enforcement. Where the header is present the route's own `file.size` check
 * is the enforcement behind it. Where it is absent there is a gap, and it is worth naming precisely
 * because lowering the cap opened it: a chunked upload larger than `proxyClientMaxBodySize` is
 * truncated by the clone above, so `request.formData()` throws and `file.size` is never reached at
 * all - the route answers `invalid_form_data` and the accurate size message is lost. That case is
 * bounded (the upload was over the route's own ceiling and is refused either way, just with the wrong
 * message) and unreachable from this app's client, because a browser `FormData` upload always sends
 * `content-length`. Closing it properly means not asking Next for the body at all on those routes,
 * which is the shape `/api/trips/import` now has and a larger change than these four need.
 */

/**
 * How far above a route's file ceiling a legitimate `content-length` may sit.
 *
 * `multipart/form-data` wraps the file in two delimiters, a `content-disposition` line and whatever
 * short text fields the route takes - a few hundred bytes for the requests these endpoints receive.
 * Without slack, a file of exactly the permitted size would be refused for its framing. 64 KB is
 * three orders of magnitude above real framing and far below the truncation cliff it is protecting
 * against, so it never turns a rejection into an acceptance that matters.
 */
export const MULTIPART_FRAMING_SLACK_BYTES = 64 * 1024;

/**
 * True when the request's own `content-length` already exceeds `maxFileBytes` plus multipart framing.
 *
 * Absent, unparseable or dishonest headers return `false` - the caller's real size check still runs.
 */
export const declaredBodyExceedsFileLimit = (request: Request, maxFileBytes: number) => {
  const header = request.headers.get("content-length");
  if (!header) return false;
  const declared = Number.parseInt(header, 10);
  if (!Number.isFinite(declared)) return false;
  return declared > maxFileBytes + MULTIPART_FRAMING_SLACK_BYTES;
};

export type JsonBodyReadResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: "too_large" | "invalid" };

/**
 * `JSON.parse` of a request body, refusing to accumulate more than `maxBytes` of it.
 *
 * `request.json()` reads until the stream ends and has no ceiling of its own. For
 * `/api/trips/import` that did not matter until Story 2.34: the route was in `middleware.ts`'s
 * matcher, so Next's body clone truncated anything past `proxyClientMaxBodySize` before the handler
 * ran - the "Request body exceeded 10MB" line in the 2026-08-02 note is that ceiling doing its job by
 * accident. Taking the route out of the matcher (AC4) removed it, which left the route's
 * `content-length` pre-check as the only bound on its JSON branch, and `content-length` is a claim a
 * `Transfer-Encoding: chunked` request does not have to make at all. An authenticated caller could
 * stream JSON of any size straight into memory on a box with no swap.
 *
 * So the ceiling is counted rather than trusted. It is the same number the caller already advertised,
 * not a new policy: a body over it was refused with the same code and message whenever the client
 * announced its size, and anything under it parses byte for byte as before.
 *
 * What this does *not* do is stop the body being resident: it is accumulated and then copied again as
 * a UTF-8 string, because that is what `JSON.parse` needs. Bounded is the improvement here, not
 * streamed - see DW-142.
 */
export const readJsonBodyWithinLimit = async (
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<JsonBodyReadResult> => {
  if (!body) {
    // No body at all is what `request.json()` rejected on, and it is reported the same way.
    return { ok: false, reason: "invalid" };
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > maxBytes) {
        // Before the chunk is kept, so the ceiling is what is held rather than the ceiling plus one
        // chunk of overshoot.
        return { ok: false, reason: "too_large" };
      }
      chunks.push(Buffer.from(next.value));
    }
  } catch {
    // A body that errors or is abandoned mid-flight is a bad request and not a server fault;
    // `request.json()` rejected on it too.
    return { ok: false, reason: "invalid" };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return { ok: true, raw: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
};
