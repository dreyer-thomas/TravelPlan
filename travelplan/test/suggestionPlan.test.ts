import { describe, expect, it } from "vitest";
import {
  SAME_PLACE_METERS,
  SUGGESTION_MODE_ROUTING,
  ceilToFive,
  legFromOsrm,
  orderSuggestions,
  suggestionDurationMinutes,
} from "@/lib/trips/suggestionPlan";

/**
 * Story 12.4 AC1/AC2. The order the picked suggestions are visited in, and (Story 13.4) the duration each is
 * stored with. Pure, so every rule is pinned here and the routes only feed it. The times are the schedule
 * rule's since 13.4 (`dayScheduleAppend.test.ts`, `daySuggestionApplyRoute.test.ts`).
 */

// A west-to-east line through Porto: origin in the west, the night's stay about 4 km east.
const origin = { lat: 41.15, lng: -8.65 };
const end = { lat: 41.15, lng: -8.6 };
const at = (lngOffset: number, latOffset = 0) => ({ lat: 41.15 + latOffset, lng: -8.65 + lngOffset });

describe("orderSuggestions", () => {
  it("sorts by progress along origin → end when the two are far apart", () => {
    const points = [at(0.04), at(0.01, 0.01), at(0.025, -0.01)];
    expect(orderSuggestions(points, origin, end)).toEqual([1, 2, 0]);
  });

  it("keeps list order between points equally far along the way", () => {
    // Same longitude, mirrored either side of the line: the same projection.
    const points = [at(0.02, 0.01), at(0.02, -0.01), at(0.01)];
    expect(orderSuggestions(points, origin, end)).toEqual([2, 0, 1]);
  });

  it("runs a nearest-neighbour tour from the origin when there is no end", () => {
    // From the origin: 2 is nearest, then 0 (next to 2), then 1 far away.
    const points = [at(0.012), at(0.05), at(0.01)];
    expect(orderSuggestions(points, origin, null)).toEqual([2, 0, 1]);
  });

  it("runs the nearest-neighbour tour when the end is within 500 m of the origin", () => {
    const nearEnd = at(0.004); // about 340 m east
    expect(SAME_PLACE_METERS).toBe(500);
    const points = [at(0.01), at(0.02), at(-0.012)];
    // By projection the order would be 2, 0, 1 (west first). The tour goes to the nearest (0), on to
    // its neighbour (1), and only then back west (2).
    expect(orderSuggestions(points, origin, nearEnd)).toEqual([0, 1, 2]);
    expect(orderSuggestions(points, origin, end)).toEqual([2, 0, 1]);
  });

  it("breaks a nearest-neighbour tie by list order", () => {
    const points = [at(0.01), at(-0.01)];
    expect(orderSuggestions(points, origin, null)).toEqual([0, 1]);
  });

  it("keeps the dialog's order when the origin is unknown", () => {
    const points = [at(0.04), at(0.01), at(0.02)];
    expect(orderSuggestions(points, null, end)).toEqual([0, 1, 2]);
    expect(orderSuggestions(points, null, null)).toEqual([0, 1, 2]);
  });
});

describe("ceilToFive", () => {
  it("rounds up to the next five minutes and leaves a multiple alone", () => {
    expect(ceilToFive(600)).toBe(600);
    expect(ceilToFive(601)).toBe(605);
    expect(ceilToFive(604)).toBe(605);
    expect(ceilToFive(0)).toBe(0);
  });
});

describe("suggestionDurationMinutes (Story 13.4)", () => {
  it("rounds up to five minutes", () => {
    expect(suggestionDurationMinutes(43)).toBe(45);
    expect(suggestionDurationMinutes(91)).toBe(95);
  });

  it("leaves a multiple of five alone; 600 stays 600", () => {
    expect(suggestionDurationMinutes(90)).toBe(90);
    expect(suggestionDurationMinutes(600)).toBe(600);
  });

  it("keeps the result inside the activity range", () => {
    expect(suggestionDurationMinutes(0)).toBe(5);
    expect(suggestionDurationMinutes(5000)).toBe(1439);
  });
});

describe("legFromOsrm", () => {
  it("rounds like the leg dialog: minutes to the nearest, at least 1; kilometres to 0.1", () => {
    expect(legFromOsrm(749, 8_449)).toEqual({ durationMinutes: 12, distanceKm: 8.4 });
    expect(legFromOsrm(20, 30)).toEqual({ durationMinutes: 1, distanceKm: 0.1 });
  });

  it("reads a zero or a missing value as no route", () => {
    expect(legFromOsrm(0, 1000)).toBeNull();
    expect(legFromOsrm(600, 0)).toBeNull();
    expect(legFromOsrm(null, 1000)).toBeNull();
    expect(legFromOsrm(600, null)).toBeNull();
  });
});

describe("SUGGESTION_MODE_ROUTING", () => {
  it("maps each search mode to its OSRM profile and stored transport type", () => {
    expect(SUGGESTION_MODE_ROUTING).toEqual({
      car: { profile: "driving", transport: "car" },
      walking: { profile: "walking", transport: "walking" },
      cycling: { profile: "cycling", transport: "cycling" },
    });
  });
});
