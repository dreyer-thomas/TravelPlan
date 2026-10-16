import { afterEach, describe, expect, it, vi } from "vitest";
import { createNominatimThrottle, GeocodingError, searchNominatim } from "@/lib/geocoding/nominatim";

/**
 * Story 12.1. The row-filtering rules themselves are pinned by `geocodeRoute.test.ts`, which stays
 * unedited as the proof that the extraction changed nothing; this file covers what the extraction adds:
 * the injectable fetch, the timeout, the typed error and the caller-chosen `User-Agent`.
 */
describe("searchNominatim", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const okFetch = (rows: unknown) =>
    vi.fn(async () => ({ ok: true, status: 200, json: async () => rows })) as unknown as typeof fetch;

  it("returns the usable rows and asks with limit and the geocoding User-Agent by default", async () => {
    const fetchImpl = okFetch([
      { lat: "52.52", lon: "13.40", display_name: "Berlin" },
      { lat: "", lon: "13.40", display_name: "broken" },
    ]);

    const results = await searchNominatim({ q: "Berlin", fetchImpl });

    expect(results).toEqual([{ lat: 52.52, lng: 13.4, label: "Berlin" }]);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("limit=5");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("TravelPlan/0.1 geocoding");
  });

  it("uses the caller's limit and User-Agent", async () => {
    const fetchImpl = okFetch([]);

    await searchNominatim({ q: "Berlin", limit: 3, userAgent: "TravelPlan/0.1 suggestions", fetchImpl });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("limit=3");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("TravelPlan/0.1 suggestions");
  });

  it("throws geocoding_unavailable on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => [] })) as unknown as typeof fetch;

    await expect(searchNominatim({ q: "Berlin", fetchImpl })).rejects.toMatchObject({
      name: "GeocodingError",
      code: "geocoding_unavailable",
    });
  });

  it("throws geocoding_unavailable on a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(searchNominatim({ q: "Berlin", fetchImpl })).rejects.toBeInstanceOf(GeocodingError);
  });

  it("aborts after timeoutMs and throws geocoding_unavailable", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;

    const pending = searchNominatim({ q: "Berlin", fetchImpl, timeoutMs: 3500 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "geocoding_unavailable" });
    await vi.advanceTimersByTimeAsync(3500);
    await assertion;
  });
});

describe("createNominatimThrottle", () => {
  it("books slots at least a second apart, from any caller", () => {
    const throttle = createNominatimThrottle();

    expect(throttle.book(0)).toBe(0);
    expect(throttle.book(200)).toBe(1000);
    expect(throttle.book(300)).toBe(2000);
    expect(throttle.book(5000)).toBe(5000);
  });

  it("books nothing when the next slot is later than the caller can start", () => {
    const throttle = createNominatimThrottle();
    throttle.book(0);

    expect(throttle.book(100, 900)).toBeNull();
    // The refusal booked nothing, so the next slot is still 1000.
    expect(throttle.book(100)).toBe(1000);
  });
});
