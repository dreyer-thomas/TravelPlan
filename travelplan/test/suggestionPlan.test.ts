import { describe, expect, it } from "vitest";
import {
  SAME_PLACE_METERS,
  SUGGESTION_MODE_ROUTING,
  ceilToFive,
  chainTimes,
  legFromOsrm,
  orderSuggestions,
} from "@/lib/trips/suggestionPlan";

/**
 * Story 12.4 AC1/AC2. The order the picked suggestions are visited in, and the times they get. Pure, so
 * every rule is pinned here and the routes only feed it.
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

describe("chainTimes", () => {
  it("starts at the start minute and adds each leg and each duration, both rounded up to five", () => {
    const result = chainTimes({ startMinute: 10 * 60, legMinutes: [12, 7], durations: [90, 43] });
    expect(result.overflow).toBe(false);
    // 10:00 + 12 = 10:12 → 10:15; + 90 → 11:45. + 7 = 11:52 → 11:55; + ceil5(43) = 45 → 12:40.
    expect(result.rows).toEqual([
      { fromTime: "10:15", toTime: "11:45" },
      { fromTime: "11:55", toTime: "12:40" },
    ]);
  });

  it("treats an unknown leg as no travel time", () => {
    const result = chainTimes({ startMinute: 10 * 60 + 2, legMinutes: [null, null], durations: [60, 30] });
    expect(result.rows).toEqual([
      { fromTime: "10:05", toTime: "11:05" },
      { fromTime: "11:05", toTime: "11:35" },
    ]);
  });

  it("leaves every row from the first one past 23:59 without times and says so", () => {
    const result = chainTimes({ startMinute: 21 * 60, legMinutes: [0, 10, 5], durations: [120, 60, 30] });
    expect(result.rows).toEqual([{ fromTime: "21:00", toTime: "23:00" }, null, null]);
    expect(result.overflow).toBe(true);
  });

  it("still fits an activity ending exactly at 23:55", () => {
    const result = chainTimes({ startMinute: 22 * 60 + 55, legMinutes: [null], durations: [60] });
    expect(result.rows).toEqual([{ fromTime: "22:55", toTime: "23:55" }]);
    expect(result.overflow).toBe(false);
  });

  it("refuses a start that rounds up to midnight", () => {
    const result = chainTimes({ startMinute: 23 * 60 + 50, legMinutes: [8], durations: [10] });
    expect(result.rows).toEqual([null]);
    expect(result.overflow).toBe(true);
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
