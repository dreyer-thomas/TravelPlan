import { describe, expect, it } from "vitest";
import {
  declaredBodyExceedsFileLimit,
  MULTIPART_FRAMING_SLACK_BYTES,
  readJsonBodyWithinLimit,
} from "@/lib/http/bodyLimit";

/**
 * The two body-size guards, without a route around them.
 *
 * Both exist because of what Story 2.34 changed about where request bodies are buffered: taking
 * `/api/trips/import` out of `middleware.ts`'s matcher removed Next's implicit ceiling from its JSON
 * branch, and lowering `proxyClientMaxBodySize` from 320 MB to 20 MB moved the truncation cliff down
 * onto the four image upload routes that are still matched. Neither guard can be proven through a
 * route without uploading hundreds of megabytes, which is why they are unit-tested here.
 */

const streamOf = (chunks: (string | Buffer)[]): ReadableStream<Uint8Array> => {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      controller.enqueue(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk));
    },
  });
};

const requestWith = (headers: Record<string, string>) =>
  new Request("http://localhost/api/trips/x/hero-image", { method: "POST", headers });

describe("declaredBodyExceedsFileLimit", () => {
  it("allows a file at exactly the ceiling, because multipart framing rides on top of it", () => {
    const limit = 5 * 1024 * 1024;
    expect(declaredBodyExceedsFileLimit(requestWith({ "content-length": String(limit) }), limit)).toBe(false);
    expect(
      declaredBodyExceedsFileLimit(
        requestWith({ "content-length": String(limit + MULTIPART_FRAMING_SLACK_BYTES) }),
        limit,
      ),
    ).toBe(false);
  });

  it("refuses a body that declares more than the ceiling plus framing", () => {
    const limit = 5 * 1024 * 1024;
    expect(
      declaredBodyExceedsFileLimit(
        requestWith({ "content-length": String(limit + MULTIPART_FRAMING_SLACK_BYTES + 1) }),
        limit,
      ),
    ).toBe(true);
  });

  it("defers to the caller's real size check when the header is absent or junk", () => {
    // A `Transfer-Encoding: chunked` request sends no `content-length` and a client may lie in it, so
    // this is a pre-check and never the enforcement.
    expect(declaredBodyExceedsFileLimit(requestWith({}), 16)).toBe(false);
    expect(declaredBodyExceedsFileLimit(requestWith({ "content-length": "not-a-number" }), 16)).toBe(false);
  });
});

describe("readJsonBodyWithinLimit", () => {
  it("parses a body that fits, across as many chunks as it arrives in", async () => {
    const result = await readJsonBodyWithinLimit(streamOf(['{"a":', "1,", '"b":[2,3]}']), 1024);

    expect(result).toEqual({ ok: true, raw: { a: 1, b: [2, 3] } });
  });

  it("refuses a body past the ceiling even though it never declared a content-length", async () => {
    // This is the hole the matcher change opened: `request.json()` reads until the stream ends, and
    // the route's `content-length` pre-check has nothing to look at on a chunked request.
    const result = await readJsonBodyWithinLimit(streamOf([Buffer.alloc(64, 0x20), Buffer.alloc(64, 0x20)]), 100);

    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("counts the ceiling exactly, so a body that just fits still parses", async () => {
    const json = '{"ok":true}';
    expect(await readJsonBodyWithinLimit(streamOf([json]), json.length)).toEqual({ ok: true, raw: { ok: true } });
    expect(await readJsonBodyWithinLimit(streamOf([json]), json.length - 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("reports unparseable JSON, an empty body and a missing body the same way request.json() did", async () => {
    expect(await readJsonBodyWithinLimit(streamOf(["{"]), 1024)).toEqual({ ok: false, reason: "invalid" });
    expect(await readJsonBodyWithinLimit(streamOf([]), 1024)).toEqual({ ok: false, reason: "invalid" });
    expect(await readJsonBodyWithinLimit(null, 1024)).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports a stream that errors mid-flight as a bad request rather than throwing", async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array(Buffer.from('{"a":1', "utf8")));
          return;
        }
        controller.error(new Error("client went away"));
      },
    });

    await expect(readJsonBodyWithinLimit(body, 1024)).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});
