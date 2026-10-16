import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetchResponse, requestUrl } from "./helpers/mockFetch";
import {
  attachSuggestionImages,
  fetchNearbyCommonsImages,
  fetchPageImage,
  findSuggestionImages,
  getWikimediaUserAgent,
} from "@/lib/ai/suggestionImages";
import type { VerifiedDaySuggestion } from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.2, AC7. Wikimedia is faked through the injected `fetchImpl`, which routes on the host and on
 * `generator`/`prop`. Fixture rows follow the live `formatversion=2` answers (checked 2026-10-16):
 * thumbnails on `thumb.wikimedia.org`, originals on `upload.wikimedia.org`, both with `utm_*` queries,
 * and geosearch `index` starting at -1.
 */

const thumb = (file: string) =>
  `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/250px-${file}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`;
const original = (file: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original`;

const commonsRow = (file: string, index: number, mime = "image/jpeg") => ({
  ns: 6,
  title: `File:${file.replace(/_/g, " ")}`,
  index,
  imageinfo: [{ thumburl: thumb(file), thumbwidth: 250, url: original(file), mime }],
});

const pageRow = (file: string, overrides: Record<string, unknown> = {}) => ({
  pageid: 1,
  ns: 0,
  title: "Neues Museum",
  pageimage: file,
  thumbnail: { source: thumb(file), width: 250, height: 118 },
  original: { source: original(file), width: 3807, height: 1800 },
  pageprops: { page_image_free: file, wikibase_item: "Q157566" },
  ...overrides,
});

type Handler = (url: URL, init?: RequestInit) => Promise<Response>;

const ok = (body: unknown) => mockFetchResponse(body);

/** A fake that routes Wikipedia page-image requests to `page` and Commons geosearch requests to `geo`. */
const fakeWikimedia = ({ page, geo }: { page?: Handler; geo?: Handler }) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    if (url.hostname === "en.wikipedia.org" && url.searchParams.get("prop") === "pageimages|pageprops") {
      return page ? page(url, init) : ok({ batchcomplete: true });
    }
    if (url.hostname === "commons.wikimedia.org" && url.searchParams.get("generator") === "geosearch") {
      return geo ? geo(url, init) : ok({ batchcomplete: true });
    }
    throw new Error(`unexpected request ${url.href}`);
  });

/** Answers once the request's signal aborts, with the rejection a real `fetch` gives. */
const hang: Handler = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

const pageAnswer = (row: unknown) => ok({ batchcomplete: true, query: { pages: [row] } });
const geoAnswer = (rows: unknown[]) => ok({ batchcomplete: true, query: { pages: rows } });

const suggestion = (overrides: Partial<VerifiedDaySuggestion> = {}): VerifiedDaySuggestion => ({
  title: "Neues Museum",
  description: "Egyptian collection.",
  locationLabel: "Neues Museum, Bodestraße 1, Berlin",
  lat: 52.520611,
  lng: 13.397799,
  durationMinutes: 120,
  verified: true,
  ...overrides,
});

const files = (images: { originalUrl: string }[]) =>
  images.map((image) => decodeURIComponent(new URL(image.originalUrl).pathname.split("/").pop() ?? ""));

const deps = (fetchImpl: ReturnType<typeof fakeWikimedia>) => ({
  fetchImpl: fetchImpl as unknown as typeof fetch,
  userAgent: "TravelPlan/test",
});

const savedBaseUrl = process.env.APP_BASE_URL;

afterEach(() => {
  vi.useRealTimers();
  if (savedBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBaseUrl;
});

describe("getWikimediaUserAgent", () => {
  it("names the public base URL as the contact", () => {
    process.env.APP_BASE_URL = "https://plan.dreyer-travels.de";
    expect(getWikimediaUserAgent()).toBe("TravelPlan/0.1 (suggestion images; https://plan.dreyer-travels.de)");
  });

  it("says there is no public URL when the variable is unset, blank, local or not a URL", () => {
    for (const value of [undefined, "  ", "http://localhost:3000", "http://127.0.0.1:3000", "nonsense"]) {
      if (value === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = value;
      expect(getWikimediaUserAgent(), String(value)).toBe("TravelPlan/0.1 (suggestion images; self-hosted; no public URL)");
    }
  });

  it("reads the environment on every call", () => {
    delete process.env.APP_BASE_URL;
    const before = getWikimediaUserAgent();
    process.env.APP_BASE_URL = "https://example.org";
    expect(getWikimediaUserAgent()).not.toBe(before);
  });
});

describe("fetchPageImage", () => {
  it("asks English Wikipedia for the lead image with the exact parameters and etiquette", async () => {
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer(pageRow("Berlin_Neues_Museum_001.JPG")) });

    const candidate = await fetchPageImage({ title: "Neues Museum", ...deps(fetchImpl) });

    expect(candidate).toEqual({
      fileName: "File:Berlin_Neues_Museum_001.JPG",
      thumbnailUrl: thumb("Berlin_Neues_Museum_001.JPG"),
      originalUrl: original("Berlin_Neues_Museum_001.JPG"),
      mime: "image/jpeg",
    });
    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(requestUrl(input));
    expect(`${url.origin}${url.pathname}`).toBe("https://en.wikipedia.org/w/api.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      prop: "pageimages|pageprops",
      piprop: "thumbnail|original|name",
      pithumbsize: "250",
      titles: "Neues Museum",
    });
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { "User-Agent": "TravelPlan/test" } });
    expect(Object.keys(init?.headers ?? {})).toEqual(["User-Agent"]);
  });

  it("uses the original as the thumbnail when Wikipedia returns none for a source no wider than 250 px", async () => {
    const fetchImpl = fakeWikimedia({
      page: async () =>
        pageAnswer(
          pageRow("Small.png", { thumbnail: undefined, original: { source: original("Small.png"), width: 200, height: 150 } }),
        ),
    });
    const candidate = await fetchPageImage({ title: "Neues Museum", ...deps(fetchImpl) });
    expect(candidate).toMatchObject({ thumbnailUrl: original("Small.png"), mime: "image/png" });
  });

  it("drops a lead image with no thumbnail whose original is wider than 250 px or of unknown width", async () => {
    for (const width of [3807, undefined]) {
      const fetchImpl = fakeWikimedia({
        page: async () =>
          pageAnswer(pageRow("Big.jpg", { thumbnail: undefined, original: { source: original("Big.jpg"), width } })),
      });
      expect(await fetchPageImage({ title: "Neues Museum", ...deps(fetchImpl) }), String(width)).toBeNull();
    }
  });

  it("does not look up a title with a pipe, which the API would split into several pages", async () => {
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer(pageRow("Lead.jpg")) });
    expect(await fetchPageImage({ title: "Foo|Eiffel Tower", ...deps(fetchImpl) })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops a missing page, a disambiguation page and a page without an image", async () => {
    for (const row of [
      { ns: 0, title: "Nowhere", missing: true },
      pageRow("Mercury.jpg", { pageprops: { disambiguation: "" } }),
      { pageid: 2, ns: 0, title: "Bare" },
    ]) {
      const fetchImpl = fakeWikimedia({ page: async () => pageAnswer(row) });
      expect(await fetchPageImage({ title: "x", ...deps(fetchImpl) })).toBeNull();
    }
  });

  it("drops a lead image that is not JPEG, PNG or WebP (inferred from the file extension)", async () => {
    for (const file of ["Map.svg", "Scan.tif", "Anim.gif"]) {
      const fetchImpl = fakeWikimedia({ page: async () => pageAnswer(pageRow(file)) });
      expect(await fetchPageImage({ title: "x", ...deps(fetchImpl) }), file).toBeNull();
    }
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer(pageRow("Photo.WebP")) });
    expect(await fetchPageImage({ title: "x", ...deps(fetchImpl) })).toMatchObject({ mime: "image/webp" });
  });

  it("drops a lead image whose URLs are not on Wikimedia's media hosts", async () => {
    const fetchImpl = fakeWikimedia({
      page: async () =>
        pageAnswer(pageRow("X.jpg", { original: { source: "https://evil.example.com/X.jpg", width: 1, height: 1 } })),
    });
    expect(await fetchPageImage({ title: "x", ...deps(fetchImpl) })).toBeNull();
  });

  it("answers null and never throws on a non-OK status, a thrown fetch, bad JSON or an odd shape", async () => {
    const handlers: Handler[] = [
      async () => mockFetchResponse({}, { status: 503 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => mockFetchResponse(undefined, { json: async () => JSON.parse("<html>") }),
      async () => ok(null),
      async () => ok({ query: { pages: "nope" } }),
      async () => ok({ query: { pages: [null, "row", 7] } }),
      async () => ok({ query: { pages: [{ pageimage: 5, original: { source: 5 } }] } }),
    ];
    for (const page of handlers) {
      const fetchImpl = fakeWikimedia({ page });
      await expect(fetchPageImage({ title: "x", ...deps(fetchImpl) })).resolves.toBeNull();
    }
  });
});

describe("fetchNearbyCommonsImages", () => {
  it("asks Commons for files within 1000 m with the exact parameters, nearest first by index", async () => {
    const fetchImpl = fakeWikimedia({
      // `formatversion=2` returns the pages out of distance order; `index` carries it.
      geo: async () => geoAnswer([commonsRow("Third.jpg", 1), commonsRow("First.jpg", -1), commonsRow("Second.jpg", 0)]),
    });

    const candidates = await fetchNearbyCommonsImages({ lat: 52.520611, lng: 13.397799, ...deps(fetchImpl) });

    expect(candidates.map((candidate) => candidate.fileName)).toEqual(["File:First.jpg", "File:Second.jpg", "File:Third.jpg"]);
    expect(candidates[0]).toEqual({
      fileName: "File:First.jpg",
      thumbnailUrl: thumb("First.jpg"),
      originalUrl: original("First.jpg"),
      mime: "image/jpeg",
    });
    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(requestUrl(input));
    expect(`${url.origin}${url.pathname}`).toBe("https://commons.wikimedia.org/w/api.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "geosearch",
      ggscoord: "52.520611|13.397799",
      ggsradius: "1000",
      ggsnamespace: "6",
      ggslimit: "10",
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: "250",
    });
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { "User-Agent": "TravelPlan/test" } });
  });

  it("keeps only JPEG, PNG and WebP", async () => {
    const fetchImpl = fakeWikimedia({
      geo: async () =>
        geoAnswer([
          commonsRow("A.jpg", 0),
          commonsRow("Plan.pdf", 1, "application/pdf"),
          commonsRow("Map.svg", 2, "image/svg+xml"),
          commonsRow("Sound.ogg", 3, "audio/ogg"),
          commonsRow("Clip.webm", 4, "video/webm"),
          commonsRow("Scan.tif", 5, "image/tiff"),
          commonsRow("B.png", 6, "image/png"),
          commonsRow("C.webp", 7, "image/webp"),
        ]),
    });
    const candidates = await fetchNearbyCommonsImages({ lat: 1, lng: 2, ...deps(fetchImpl) });
    expect(candidates.map((candidate) => candidate.mime)).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("uses a narrow original when there is no thumbnail, and drops a wide one and off-host URLs", async () => {
    const noThumb = commonsRow("Tiny.jpg", 0);
    delete (noThumb.imageinfo[0] as { thumburl?: string }).thumburl;
    (noThumb.imageinfo[0] as { width?: number }).width = 200;
    const wideNoThumb = commonsRow("Wide.jpg", 3);
    delete (wideNoThumb.imageinfo[0] as { thumburl?: string }).thumburl;
    (wideNoThumb.imageinfo[0] as { width?: number }).width = 4000;
    const offHost = commonsRow("Evil.jpg", 1);
    offHost.imageinfo[0].url = "https://evil.example.com/Evil.jpg";
    const offHostThumb = commonsRow("EvilThumb.jpg", 2);
    offHostThumb.imageinfo[0].thumburl = "http://thumb.wikimedia.org/x.jpg";
    const fetchImpl = fakeWikimedia({ geo: async () => geoAnswer([noThumb, offHost, offHostThumb, wideNoThumb]) });

    const candidates = await fetchNearbyCommonsImages({ lat: 1, lng: 2, ...deps(fetchImpl) });

    expect(candidates).toEqual([
      { fileName: "File:Tiny.jpg", thumbnailUrl: original("Tiny.jpg"), originalUrl: original("Tiny.jpg"), mime: "image/jpeg" },
    ]);
  });

  it("answers [] for no results (a body without `query`)", async () => {
    const fetchImpl = fakeWikimedia({ geo: async () => ok({ batchcomplete: true }) });
    expect(await fetchNearbyCommonsImages({ lat: 1, lng: 2, ...deps(fetchImpl) })).toEqual([]);
  });

  it("answers [] and never throws on a non-OK status, a thrown fetch, bad JSON or an odd shape", async () => {
    const handlers: Handler[] = [
      async () => mockFetchResponse({}, { status: 429 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => mockFetchResponse(undefined, { json: async () => JSON.parse("{") }),
      async () => ok("text"),
      async () => ok({ query: { pages: {} } }),
      async () => ok({ query: { pages: [null, "row", { title: "File:X.jpg", imageinfo: "nope" }, { imageinfo: [null] }] } }),
    ];
    for (const geo of handlers) {
      const fetchImpl = fakeWikimedia({ geo });
      await expect(fetchNearbyCommonsImages({ lat: 1, lng: 2, ...deps(fetchImpl) })).resolves.toEqual([]);
    }
  });

  it("keeps a valid row among broken ones", async () => {
    const fetchImpl = fakeWikimedia({ geo: async () => geoAnswer([null, "row", commonsRow("Good.jpg", 3)]) });
    const candidates = await fetchNearbyCommonsImages({ lat: 1, lng: 2, ...deps(fetchImpl) });
    expect(candidates.map((candidate) => candidate.fileName)).toEqual(["File:Good.jpg"]);
  });
});

describe("findSuggestionImages", () => {
  it("puts the lead image first, then the nearest Commons files, cut to 3 of 5", async () => {
    const fetchImpl = fakeWikimedia({
      page: async () => pageAnswer(pageRow("Lead.jpg")),
      geo: async () => geoAnswer(["G1.jpg", "G2.jpg", "G3.jpg", "G4.jpg"].map((file, index) => commonsRow(file, index))),
    });

    const images = await findSuggestionImages(suggestion(), deps(fetchImpl));

    expect(files(images)).toEqual(["Lead.jpg", "G1.jpg", "G2.jpg"]);
    expect(images[0]).toEqual({ thumbnailUrl: thumb("Lead.jpg"), originalUrl: original("Lead.jpg") });
    expect(Object.keys(images[0]).sort()).toEqual(["originalUrl", "thumbnailUrl"]);
  });

  it("deduplicates the lead image when it is also a geosearch hit (spaces vs underscores)", async () => {
    const fetchImpl = fakeWikimedia({
      page: async () => pageAnswer(pageRow("Berlin_Neues_Museum_001.JPG")),
      geo: async () => geoAnswer([commonsRow("Berlin_Neues_Museum_001.JPG", -1), commonsRow("Other.jpg", 0)]),
    });

    const images = await findSuggestionImages(suggestion(), deps(fetchImpl));

    expect(files(images)).toEqual(["Berlin_Neues_Museum_001.JPG", "Other.jpg"]);
  });

  it("tries wikiTitle first and stops there when it has an image", async () => {
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer(pageRow("Lead.jpg")) });

    await findSuggestionImages(suggestion({ wikiTitle: "  Neues   Museum (Berlin) " }), deps(fetchImpl));

    const titles = fetchImpl.mock.calls
      .map(([input]) => new URL(requestUrl(input)).searchParams.get("titles"))
      .filter((title) => title !== null);
    expect(titles).toEqual(["Neues Museum (Berlin)"]);
  });

  it("falls back to title after an empty wikiTitle lookup", async () => {
    const fetchImpl = fakeWikimedia({
      page: async (url) =>
        url.searchParams.get("titles") === "Neues Museum"
          ? pageAnswer(pageRow("Lead.jpg"))
          : pageAnswer({ ns: 0, title: "Wrong", missing: true }),
    });

    const images = await findSuggestionImages(suggestion({ wikiTitle: "Wrong" }), deps(fetchImpl));

    const titles = fetchImpl.mock.calls
      .map(([input]) => new URL(requestUrl(input)).searchParams.get("titles"))
      .filter((title) => title !== null);
    expect(titles).toEqual(["Wrong", "Neues Museum"]);
    expect(files(images)).toEqual(["Lead.jpg"]);
  });

  it("does not ask twice when wikiTitle and title are the same apart from spacing", async () => {
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer({ ns: 0, title: "x", missing: true }) });

    await findSuggestionImages(suggestion({ wikiTitle: " Neues  Museum " }), deps(fetchImpl));

    const pageCalls = fetchImpl.mock.calls.filter(([input]) => new URL(requestUrl(input)).hostname === "en.wikipedia.org");
    expect(pageCalls).toHaveLength(1);
  });

  it("does ask twice when they differ only in case (Wikipedia titles are case-sensitive)", async () => {
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer({ ns: 0, title: "x", missing: true }) });

    await findSuggestionImages(suggestion({ wikiTitle: "Neues museum" }), deps(fetchImpl));

    const pageCalls = fetchImpl.mock.calls.filter(([input]) => new URL(requestUrl(input)).hostname === "en.wikipedia.org");
    expect(pageCalls).toHaveLength(2);
  });

  it("uses title alone when there is no wikiTitle", async () => {
    const fetchImpl = fakeWikimedia({ page: async () => pageAnswer({ ns: 0, title: "x", missing: true }) });

    await findSuggestionImages(suggestion(), deps(fetchImpl));

    const titles = fetchImpl.mock.calls
      .map(([input]) => new URL(requestUrl(input)).searchParams.get("titles"))
      .filter((title) => title !== null);
    expect(titles).toEqual(["Neues Museum"]);
  });

  it("answers [] when neither source has a usable image", async () => {
    const fetchImpl = fakeWikimedia({
      page: async () => pageAnswer({ ns: 0, title: "x", missing: true }),
      geo: async () => ok({ batchcomplete: true }),
    });
    expect(await findSuggestionImages(suggestion(), deps(fetchImpl))).toEqual([]);
  });

  it("keeps the geosearch images when the page image fails, and the page image when geosearch fails", async () => {
    const failures: Handler[] = [
      async () => mockFetchResponse({}, { status: 500 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => mockFetchResponse(undefined, { json: async () => JSON.parse("nope") }),
    ];
    for (const failure of failures) {
      const pageDown = fakeWikimedia({ page: failure, geo: async () => geoAnswer([commonsRow("G1.jpg", 0)]) });
      expect(files(await findSuggestionImages(suggestion(), deps(pageDown)))).toEqual(["G1.jpg"]);

      const geoDown = fakeWikimedia({ page: async () => pageAnswer(pageRow("Lead.jpg")), geo: failure });
      expect(files(await findSuggestionImages(suggestion(), deps(geoDown)))).toEqual(["Lead.jpg"]);
    }
  });

  it("runs the page-image chain and the geosearch concurrently", async () => {
    let releasePage: () => void = () => {};
    const pageGate = new Promise<void>((resolve) => {
      releasePage = resolve;
    });
    const fetchImpl = fakeWikimedia({
      page: async () => {
        await pageGate;
        return pageAnswer(pageRow("Lead.jpg"));
      },
      geo: async () => geoAnswer([commonsRow("G1.jpg", 0)]),
    });

    const pending = findSuggestionImages(suggestion(), deps(fetchImpl));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    releasePage();

    expect(files(await pending)).toEqual(["Lead.jpg", "G1.jpg"]);
  });
});

describe("attachSuggestionImages", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.APP_BASE_URL;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs one line per search naming the failures by status and class only, and nothing when all answer", async () => {
    const failing = fakeWikimedia({
      page: async () => mockFetchResponse({}, { status: 429 }),
      geo: async () => {
        throw new TypeError("fetch failed: secret detail");
      },
    });
    const result = await attachSuggestionImages([suggestion(), suggestion({ title: "B" })], {
      fetchImpl: failing as unknown as typeof fetch,
    });

    expect(result.map((entry) => entry.images)).toEqual([[], []]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("day suggestions: image lookups failed", {
      failed: 4,
      reasons: ["HTTP 429", "TypeError"],
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret");

    warnSpy.mockClear();
    await attachSuggestionImages([suggestion()], { fetchImpl: fakeWikimedia({}) as unknown as typeof fetch });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("attaches each suggestion's images, keeping order and every other field", async () => {
    const fetchImpl = fakeWikimedia({
      page: async (url) =>
        url.searchParams.get("titles") === "Neues Museum"
          ? pageAnswer(pageRow("Lead.jpg"))
          : pageAnswer({ ns: 0, title: "x", missing: true }),
      geo: async (url) =>
        url.searchParams.get("ggscoord") === "52.520611|13.397799" ? geoAnswer([commonsRow("G1.jpg", 0)]) : ok({}),
    });
    const input = [suggestion(), suggestion({ title: "Elsewhere", lat: 1, lng: 2, verified: false, wikiTitle: "Nope" })];

    const result = await attachSuggestionImages(input, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual([
      { ...input[0], images: [expect.objectContaining({ originalUrl: original("Lead.jpg") }), expect.objectContaining({ originalUrl: original("G1.jpg") })] },
      { ...input[1], images: [] },
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(
        "TravelPlan/0.1 (suggestion images; self-hosted; no public URL)",
      );
      expect(init?.cache).toBe("no-store");
    }
  });

  it("starts every suggestion's lookups at once", async () => {
    const fetchImpl = fakeWikimedia({ page: hang, geo: hang });
    const controller = new AbortController();

    const pending = attachSuggestionImages([suggestion(), suggestion({ title: "B" }), suggestion({ title: "C" })], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(6));
    controller.abort();

    expect((await pending).map((entry) => entry.images)).toEqual([[], [], []]);
  });

  it("keeps what arrived within the 8 s budget and aborts the rest", async () => {
    vi.useFakeTimers();
    const fetchImpl = fakeWikimedia({ page: hang, geo: async () => geoAnswer([commonsRow("G1.jpg", 0)]) });

    let settled = false;
    const pending = attachSuggestionImages([suggestion()], { fetchImpl: fetchImpl as unknown as typeof fetch }).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const [entry] = await pending;
    expect(files(entry.images)).toEqual(["G1.jpg"]);
    const [, init] = fetchImpl.mock.calls.find(([input]) => new URL(requestUrl(input)).hostname === "en.wikipedia.org")!;
    expect(init?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when everything answers early", async () => {
    vi.useFakeTimers();
    const fetchImpl = fakeWikimedia({});
    await attachSuggestionImages([suggestion()], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts the lookups when the client goes away, without waiting for the budget", async () => {
    vi.useFakeTimers();
    const fetchImpl = fakeWikimedia({ page: hang, geo: hang });
    const controller = new AbortController();

    let settled = false;
    const pending = attachSuggestionImages([suggestion()], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);

    expect((await pending)[0].images).toEqual([]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.signal?.aborted).toBe(true);
    }
  });

  it("sends nothing when the client has already gone", async () => {
    const fetchImpl = fakeWikimedia({});
    const controller = new AbortController();
    controller.abort();

    const result = await attachSuggestionImages([suggestion(), suggestion({ title: "B" })], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.map((entry) => entry.images)).toEqual([[], []]);
  });

  it("answers images: [] for every suggestion even when the step itself breaks", async () => {
    const fetchImpl = fakeWikimedia({});
    const input = [suggestion(), suggestion({ title: "B" })];

    // Not an AbortSignal, so combining it throws inside the step: the guard that keeps AC4 true for a bug.
    const result = await attachSuggestionImages(input, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: { aborted: false } as AbortSignal,
    });

    expect(result).toEqual(input.map((entry) => ({ ...entry, images: [] })));
    expect(warnSpy).toHaveBeenCalledWith("day suggestions: image step failed", { name: "TypeError" });
  });

  it("answers [] for no suggestions without a request", async () => {
    const fetchImpl = fakeWikimedia({});
    expect(await attachSuggestionImages([], { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
