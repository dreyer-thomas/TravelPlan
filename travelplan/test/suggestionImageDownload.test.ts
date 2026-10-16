import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SUGGESTION_IMAGE_BYTES,
  downloadCandidates,
  downloadSuggestionImages,
} from "@/lib/trips/suggestionImageDownload";

/**
 * Story 12.4 AC5, items 13–15 and DW-386. The server downloads a ticked suggestion's pictures: the
 * 1280 px thumbnail first, then the original, then the 250 px thumbnail; never following a redirect,
 * never past 5 MB, never anything that is not a JPEG, PNG or WebP by its bytes.
 */

const THUMB = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Ribeira.jpg/250px-Ribeira.jpg?x=1";
const THUMB_1920 = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Ribeira.jpg/1920px-Ribeira.jpg?x=1";
const THUMB_1280 = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Ribeira.jpg/1280px-Ribeira.jpg?x=1";
const ORIGINAL = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ribeira.jpg";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);
const GIF = Buffer.from("GIF89a....................");

const image = (thumbnailUrl = THUMB, originalUrl = ORIGINAL) => ({ thumbnailUrl, originalUrl });

type Reply = Response | (() => Response) | Error;

/** A `fetch` answering each URL from a table; any URL not in it is a test failure. */
const fetchFrom = (table: Record<string, Reply>) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply = table[url];
    if (!reply) throw new Error(`unexpected fetch ${url}`);
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply() : reply;
  });

const okBytes = (bytes: Buffer) => () => new Response(new Uint8Array(bytes), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadCandidates", () => {
  it("derives the 1920 px and 1280 px thumbnails first, then the original, then the 250 px thumbnail", () => {
    expect(downloadCandidates(image())).toEqual([THUMB_1920, THUMB_1280, ORIGINAL, THUMB]);
  });

  it("has no 1280 px attempt for a thumbnail that is not a /thumb/…/250px- URL", () => {
    const small = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Tiny.png";
    expect(downloadCandidates(image(small))).toEqual([ORIGINAL, small]);
  });

  it("drops any candidate that fails its host guard, before anything is requested", () => {
    const evilThumb = "https://evil.example/thumb/a/ab/X.jpg/250px-X.jpg";
    const evilOriginal = "http://upload.wikimedia.org/a.jpg";
    expect(downloadCandidates(image(evilThumb, evilOriginal))).toEqual([]);
    expect(downloadCandidates(image(THUMB, "https://thumb.wikimedia.org/original.jpg"))).toEqual([THUMB_1920, THUMB_1280, THUMB]);
  });
});

describe("downloadSuggestionImages", () => {
  it("takes the 1920 px thumbnail when it loads, without trying the rest", async () => {
    const fetchImpl = fetchFrom({ [THUMB_1920]: okBytes(JPEG) });
    const [[downloaded]] = await downloadSuggestionImages([[image()]], { fetchImpl });
    expect(downloaded.contentType).toBe("image/jpeg");
    expect(downloaded.bytes.equals(JPEG)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("User-Agent")).toMatch(/^TravelPlan\//);
  });

  it("falls through to 1280 px, the original and then the 250 px thumbnail", async () => {
    const fetchImpl = fetchFrom({
      [THUMB_1920]: () => new Response("too wide", { status: 400 }),
      [THUMB_1280]: () => new Response("too wide", { status: 400 }),
      [ORIGINAL]: new TypeError("socket hang up"),
      [THUMB]: okBytes(PNG),
    });
    const [[downloaded]] = await downloadSuggestionImages([[image()]], { fetchImpl });
    expect(downloaded.contentType).toBe("image/png");
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([THUMB_1920, THUMB_1280, ORIGINAL, THUMB]);
  });

  it("treats a redirect as a failure and never requests its target", async () => {
    const fetchImpl = fetchFrom({
      [THUMB_1920]: () => new Response(null, { status: 307, headers: { Location: "http://127.0.0.1/" } }),
      [THUMB_1280]: () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }),
      [ORIGINAL]: () => new Response(null, { status: 301, headers: { Location: "https://evil.example/x.jpg" } }),
      [THUMB]: okBytes(JPEG),
    });
    const [[downloaded]] = await downloadSuggestionImages([[image()]], { fetchImpl });
    expect(downloaded.contentType).toBe("image/jpeg");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("cuts a body off past 5 MB and cancels the stream", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set([0xff, 0xd8, 0xff], 0);
    // 20 MB on offer per response; the reader must stop after the sixth 1 MB chunk.
    const pulls: number[] = [];
    const huge = () => {
      const index = pulls.push(0) - 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls[index] += 1;
            controller.enqueue(chunk);
            if (pulls[index] >= 20) controller.close();
          },
          cancel,
        }),
        { status: 200 },
      );
    };
    const fetchImpl = fetchFrom({ [THUMB_1920]: huge, [THUMB_1280]: huge, [ORIGINAL]: huge, [THUMB]: huge });
    const result = await downloadSuggestionImages([[image()]], { fetchImpl });
    expect(result).toEqual([[]]);
    expect(cancel).toHaveBeenCalledTimes(4);
    pulls.forEach((count) => expect(count).toBeLessThanOrEqual(7));
    expect(MAX_SUGGESTION_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("rejects bytes that sniff as no allowed picture, whatever the header says", async () => {
    const gif = () => new Response(new Uint8Array(GIF), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    const fetchImpl = fetchFrom({ [THUMB_1920]: gif, [THUMB_1280]: gif, [ORIGINAL]: gif, [THUMB]: gif });
    expect(await downloadSuggestionImages([[image()]], { fetchImpl })).toEqual([[]]);
  });

  it("never requests a URL that fails its guard", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(JPEG), { status: 200 }));
    const result = await downloadSuggestionImages(
      [[image("https://evil.example/thumb/a/X.jpg/250px-X.jpg", "https://evil.example/original.jpg")]],
      { fetchImpl },
    );
    expect(result).toEqual([[]]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps each suggestion's pictures in their order, skipping the ones that failed, and logs once by host", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = image(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Tiles.jpg/250px-Tiles.jpg",
      "https://upload.wikimedia.org/wikipedia/commons/c/cd/Tiles.jpg",
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("Ribeira")) return new Response(new Uint8Array(JPEG), { status: 200 });
      return new Response("gone", { status: 404 });
    });
    const result = await downloadSuggestionImages([[second, image()], []], { fetchImpl });
    expect(result[0]).toHaveLength(1);
    expect(result[0][0].bytes.equals(JPEG)).toBe(true);
    expect(result[1]).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain("thumb.wikimedia.org");
    expect(logged).not.toContain("Tiles");
  });

  it("stops at the overall budget and keeps what had arrived", async () => {
    const fetchImpl = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (String(input) === THUMB_1920) {
            resolve(new Response(new Uint8Array(JPEG), { status: 200 }));
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const other = image(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Slow.jpg/250px-Slow.jpg",
      "https://upload.wikimedia.org/wikipedia/commons/c/cd/Slow.jpg",
    );
    const result = await downloadSuggestionImages([[image()], [other]], { fetchImpl, budgetMs: 50 });
    expect(result[0]).toHaveLength(1);
    expect(result[1]).toEqual([]);
  });
});
