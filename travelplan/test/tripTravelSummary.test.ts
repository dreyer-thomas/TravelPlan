import { describe, expect, it } from "vitest";
import { selectDrawnTravelSegments, summarizeTripTravel } from "@/lib/trips/tripTravelSummary";

type Leg = {
  id: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: string;
  durationMinutes: number;
  distanceKm: number | null;
};

const leg = (
  id: string,
  from: [Leg["fromItemType"], string],
  to: [Leg["toItemType"], string],
  transportType: string,
  durationMinutes: number,
  distanceKm: number | null,
): Leg => ({
  id,
  fromItemType: from[0],
  fromItemId: from[1],
  toItemType: to[0],
  toItemId: to[1],
  transportType,
  durationMinutes,
  distanceKm,
});

const item = (id: string, sortOrder: number) => ({ id, sortOrder, fromTime: null, createdAt: "2026-01-01T00:00:00.000Z" });

describe("selectDrawnTravelSegments", () => {
  it("orders the activities by the shared comparator, not by payload order", () => {
    const day = {
      accommodation: null,
      dayPlanItems: [item("b", 1), item("a", 0)],
      travelSegments: [leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "car", 10, 5)],
    };
    const result = selectDrawnTravelSegments(day, null);
    expect(result.orderedPlanItems.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.drawnTravelSegments.map((entry) => entry.id)).toEqual(["ab"]);
  });

  it("draws a leg starting at the previous night's stay and drops one that is not consecutive", () => {
    const day = {
      accommodation: { id: "stay2" },
      dayPlanItems: [item("a", 0), item("b", 1)],
      travelSegments: [
        leg("first", ["accommodation", "stay1"], ["dayPlanItem", "a"], "car", 30, 20),
        leg("orphan", ["dayPlanItem", "a"], ["accommodation", "stay2"], "car", 60, 80),
      ],
    };
    const result = selectDrawnTravelSegments(day, { accommodation: { id: "stay1" } });
    expect(result.drawnTravelSegments.map((entry) => entry.id)).toEqual(["first"]);
  });

  it("returns no legs for a day without travelSegments", () => {
    expect(selectDrawnTravelSegments({ accommodation: null, dayPlanItems: [] }, null).drawnTravelSegments).toEqual([]);
  });
});

describe("summarizeTripTravel", () => {
  // Day 1: stay1. Day 2: stay1 → a → b → stay2, plus an orphaned a → stay2.
  const days = [
    {
      accommodation: { id: "stay1" },
      dayPlanItems: [item("x", 0)],
      travelSegments: [leg("d1", ["dayPlanItem", "x"], ["accommodation", "stay1"], "flight", 120, null)],
    },
    {
      accommodation: { id: "stay2" },
      dayPlanItems: [item("a", 0), item("b", 1)],
      travelSegments: [
        leg("first", ["accommodation", "stay1"], ["dayPlanItem", "a"], "car", 45, 30.5),
        leg("walk", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "walking", 15, null),
        leg("last", ["dayPlanItem", "b"], ["accommodation", "stay2"], "car", 90, 100),
        leg("orphan", ["dayPlanItem", "a"], ["accommodation", "stay2"], "car", 600, 900),
      ],
    },
  ];

  it("sums mixed modes per mode in TRANSPORT_TYPES order, excluding orphans", () => {
    expect(summarizeTripTravel(days)).toEqual({
      totalKm: 130.5,
      byMode: [
        { transportType: "car", legCount: 2, durationMinutes: 135, distanceKm: 130.5 },
        { transportType: "flight", legCount: 1, durationMinutes: 120, distanceKm: null },
        { transportType: "walking", legCount: 1, durationMinutes: 15, distanceKm: null },
      ],
    });
  });

  it("counts a leg without a distance towards legs and time in a mode that has other distances", () => {
    const summary = summarizeTripTravel([
      {
        accommodation: null,
        dayPlanItems: [item("a", 0), item("b", 1), item("c", 2)],
        travelSegments: [
          leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "cycling", 60, 12),
          leg("bc", ["dayPlanItem", "b"], ["dayPlanItem", "c"], "cycling", 30, null),
        ],
      },
    ]);
    expect(summary.byMode).toEqual([{ transportType: "cycling", legCount: 2, durationMinutes: 90, distanceKm: 12 }]);
    expect(summary.totalKm).toBe(12);
  });

  it("gives a flight-only trip no distance and a zero total", () => {
    const summary = summarizeTripTravel([days[0]]);
    expect(summary).toEqual({
      totalKm: 0,
      byMode: [{ transportType: "flight", legCount: 1, durationMinutes: 120, distanceKm: null }],
    });
  });

  it("rounds once after summing, so float noise does not leak", () => {
    const summary = summarizeTripTravel([
      {
        accommodation: null,
        dayPlanItems: [item("a", 0), item("b", 1), item("c", 2)],
        travelSegments: [
          leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "car", 1, 0.1),
          leg("bc", ["dayPlanItem", "b"], ["dayPlanItem", "c"], "train", 1, 0.2),
        ],
      },
    ]);
    expect(summary.totalKm).toBe(0.3);
    expect(summary.byMode.map((entry) => entry.distanceKm)).toEqual([0.1, 0.2]);
  });

  it("computes the total from the unrounded leg sum, not from rounded per-mode values", () => {
    const summary = summarizeTripTravel([
      {
        accommodation: null,
        dayPlanItems: [item("a", 0), item("b", 1), item("c", 2)],
        travelSegments: [
          leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "car", 1, 0.04),
          leg("bc", ["dayPlanItem", "b"], ["dayPlanItem", "c"], "bus", 1, 0.04),
        ],
      },
    ]);
    // Per mode each rounds to 0, the trip's 0.08 rounds to 0.1.
    expect(summary.byMode.map((entry) => entry.distanceKm)).toEqual([0, 0]);
    expect(summary.totalKm).toBe(0.1);
  });

  it("ignores a distance stored on a flight or ship, as the day view does", () => {
    const summary = summarizeTripTravel([
      {
        accommodation: null,
        dayPlanItems: [item("a", 0), item("b", 1), item("c", 2), item("d", 3)],
        travelSegments: [
          leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "flight", 120, 800),
          leg("bc", ["dayPlanItem", "b"], ["dayPlanItem", "c"], "ship", 60, 40),
          leg("cd", ["dayPlanItem", "c"], ["dayPlanItem", "d"], "car", 30, 25),
        ],
      },
    ]);
    expect(summary).toEqual({
      totalKm: 25,
      byMode: [
        { transportType: "car", legCount: 1, durationMinutes: 30, distanceKm: 25 },
        { transportType: "ship", legCount: 1, durationMinutes: 60, distanceKm: null },
        { transportType: "flight", legCount: 1, durationMinutes: 120, distanceKm: null },
      ],
    });
  });

  it("skips a leg with an unknown transport type", () => {
    const summary = summarizeTripTravel([
      {
        accommodation: null,
        dayPlanItems: [item("a", 0), item("b", 1)],
        travelSegments: [leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "hovercraft", 10, 50)],
      },
    ]);
    expect(summary).toEqual({ totalKm: 0, byMode: [] });
  });

  it("returns zero and no modes for no days or no legs", () => {
    expect(summarizeTripTravel([])).toEqual({ totalKm: 0, byMode: [] });
    expect(summarizeTripTravel([{ accommodation: null, dayPlanItems: [], travelSegments: [] }])).toEqual({
      totalKm: 0,
      byMode: [],
    });
  });
});
