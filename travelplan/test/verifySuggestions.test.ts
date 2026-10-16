import { describe, expect, it, vi } from "vitest";
import { verifySuggestionLocations } from "@/lib/ai/verifySuggestions";
import { createNominatimThrottle, GeocodingError, type GeocodingCandidate } from "@/lib/geocoding/nominatim";
import type { ModelDaySuggestion } from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.1, AC4. Each suggestion's label is geocoded, one request at a time, at most one per second
 * across the process, inside a 10 s budget; a hit within 2 km replaces the model's coordinates.
 */

const BASE = { lat: 52.52, lng: 13.405 };
// Metres due north of BASE, exactly: a meridian arc of d metres is d / R radians.
const north = (meters: number) => ({ lat: BASE.lat + ((meters / 6371000) * 180) / Math.PI, lng: BASE.lng });

const suggestion = (label: string): ModelDaySuggestion => ({
  title: label,
  description: "",
  locationLabel: label,
  lat: BASE.lat,
  lng: BASE.lng,
  durationMinutes: 60,
});

/**
 * A fake clock: `sleep` advances it, and each geocode call costs `latencyMs` of it - or its `timeoutMs`,
 * after which it fails as the real one would. Each harness has its own throttle, so tests do not share
 * the process-wide one.
 */
const harness = (answer: (q: string) => GeocodingCandidate[] | Error, latencyMs = 200) => {
  let t = 1_000_000;
  const now = () => t;
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  const throttle = createNominatimThrottle();
  const starts: number[] = [];
  const geocode = vi.fn(async ({ q, timeoutMs }: { q: string; timeoutMs: number }) => {
    starts.push(t);
    if (latencyMs > timeoutMs) {
      t += timeoutMs;
      throw new GeocodingError("geocoding_unavailable", "timeout");
    }
    t += latencyMs;
    const result = answer(q);
    if (result instanceof Error) throw result;
    return result;
  });
  return { now, sleep, geocode, starts, throttle };
};

describe("verifySuggestionLocations", () => {
  it("adopts a geocoder hit 1.9 km away and marks it verified, keeping the model's label", async () => {
    const hit = north(1900);
    const { now, sleep, geocode, throttle } = harness(() => [{ ...hit, label: "Some long Nominatim display name" }]);

    const [result] = await verifySuggestionLocations([suggestion("Museum")], { geocode, now, sleep, throttle });

    expect(result).toMatchObject({ verified: true, lat: hit.lat, lng: hit.lng, locationLabel: "Museum" });
  });

  it("keeps the model's coordinates and verified false for a hit 2.1 km away", async () => {
    const { now, sleep, geocode, throttle } = harness(() => [{ ...north(2100), label: "x" }]);

    const [result] = await verifySuggestionLocations([suggestion("Museum")], { geocode, now, sleep, throttle });

    expect(result).toMatchObject({ verified: false, lat: BASE.lat, lng: BASE.lng });
  });

  it("picks the closest of several candidates", async () => {
    const near = north(300);
    const { now, sleep, geocode, throttle } = harness(() => [
      { ...north(1800), label: "a" },
      { ...near, label: "b" },
      { ...north(5000), label: "c" },
    ]);

    const [result] = await verifySuggestionLocations([suggestion("Museum")], { geocode, now, sleep, throttle });

    expect(result).toMatchObject({ verified: true, lat: near.lat });
  });

  it("asks for five candidates with the suggestions User-Agent", async () => {
    const { now, sleep, geocode, throttle } = harness(() => []);

    await verifySuggestionLocations([suggestion("Museum")], { geocode, now, sleep, throttle });

    expect(geocode).toHaveBeenCalledWith(
      expect.objectContaining({ q: "Museum", limit: 5, userAgent: "TravelPlan/0.1 suggestions", timeoutMs: 3500 }),
    );
  });

  it("marks a failed lookup unverified and carries on with the next", async () => {
    const { now, sleep, geocode, throttle } = harness((q) =>
      q === "Broken" ? new GeocodingError("geocoding_unavailable", "down") : [{ ...north(100), label: "x" }],
    );

    const results = await verifySuggestionLocations([suggestion("Broken"), suggestion("Fine")], { geocode, now, sleep, throttle });

    expect(results.map((r) => r.verified)).toEqual([false, true]);
  });

  it("starts requests at least 1000 ms apart", async () => {
    const { now, sleep, geocode, starts, throttle } = harness(() => [], 200);

    await verifySuggestionLocations([suggestion("A"), suggestion("B"), suggestion("C")], { geocode, now, sleep, throttle });

    expect(geocode).toHaveBeenCalledTimes(3);
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1000);
    }
    // 200 ms of latency means 800 ms of waiting before each later request.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([800, 800]);
  });

  it("stops when the 10 s budget runs out and leaves the rest unverified", async () => {
    // Each lookup takes 3 s, so starts land at 0, 3, 6 and 9 s. The fourth gets only the 1 s left of the
    // budget and times out; a fifth would start after 9 s, leaving less than a second, so it is not tried.
    const { now, sleep, geocode, throttle } = harness(() => [{ ...north(10), label: "x" }], 3000);

    const results = await verifySuggestionLocations(
      ["A", "B", "C", "D", "E"].map((label) => suggestion(label)),
      { geocode, now, sleep, throttle },
    );

    expect(geocode).toHaveBeenCalledTimes(4);
    expect(geocode.mock.calls.map(([input]) => input.timeoutMs)).toEqual([3500, 3500, 3500, 1000]);
    expect(results.map((r) => r.verified)).toEqual([true, true, true, false, false]);
    expect(results).toHaveLength(5);
  });

  it("can verify all eight suggestions when the geocoder is quick", async () => {
    const { now, sleep, geocode, throttle } = harness(() => [{ ...north(10), label: "x" }], 200);
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    const results = await verifySuggestionLocations(labels.map(suggestion), { geocode, now, sleep, throttle });

    expect(results.every((r) => r.verified)).toBe(true);
    // The eighth starts at 7 s with the 3 s left of the budget.
    expect(geocode.mock.calls.at(-1)?.[0].timeoutMs).toBe(3000);
  });

  it("spaces around a request another caller booked on the same throttle", async () => {
    const { now, sleep, geocode, throttle } = harness(() => [], 200);
    throttle.book(now());

    await verifySuggestionLocations([suggestion("A")], { geocode, now, sleep, throttle });

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000]);
  });

  it("sends nothing more once the client has gone", async () => {
    const { now, sleep, geocode, throttle } = harness(() => [{ ...north(10), label: "x" }], 200);
    const controller = new AbortController();
    geocode.mockImplementationOnce(async () => {
      controller.abort();
      return [{ ...north(10), label: "x" }];
    });

    const results = await verifySuggestionLocations([suggestion("A"), suggestion("B"), suggestion("C")], {
      geocode,
      now,
      sleep,
      throttle,
      signal: controller.signal,
    });

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.verified)).toEqual([true, false, false]);
  });
});
