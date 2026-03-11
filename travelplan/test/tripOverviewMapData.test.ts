import { describe, expect, it } from "vitest";
import { buildTripOverviewMapData } from "@/components/features/trips/TripOverviewMapData";

describe("buildTripOverviewMapData", () => {
  it("sorts trip points canonically, excludes missing locations, and dedupes consecutive stay points", () => {
    const result = buildTripOverviewMapData({
      tripId: "trip-1",
      days: [
        {
          id: "day-a",
          date: "2026-06-01T00:00:00.000Z",
          dayIndex: 1,
          accommodation: {
            id: "stay-1",
            name: "Harbor Hotel",
            notes: "Check in",
            location: { lat: 53.55, lng: 10, label: "Hamburg" },
          },
          dayPlanItems: [
            {
              id: "item-1",
              title: "Breakfast",
              contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Breakfast details" }] }] }),
              location: null,
            },
          ],
        },
        {
          id: "day-b",
          date: "2026-06-02T00:00:00.000Z",
          dayIndex: 2,
          accommodation: {
            id: "stay-2",
            name: "Harbor Hotel",
            notes: "Late check-in",
            location: { lat: 53.55, lng: 10, label: "Hamburg" },
          },
          dayPlanItems: [],
        },
        {
          id: "day-c",
          date: "2026-06-03T00:00:00.000Z",
          dayIndex: 3,
          accommodation: {
            id: "stay-3",
            name: "Airport Hotel",
            notes: "Early departure",
            location: { lat: 53.63, lng: 10.02, label: "Airport" },
          },
          dayPlanItems: [
            {
              id: "item-3",
              title: "Port walk",
              contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Port walk details" }] }] }),
              location: { lat: 53.551, lng: 9.99, label: "Harbor" },
            },
          ],
        },
      ],
      getDayLabel: (index) => `Day ${index}`,
      getPlanItemFallbackLabel: (index) => `Plan item ${index}`,
    });

    expect(result.points.map((point) => point.id)).toEqual(["stay-1", "item-3", "stay-3"]);
    expect(result.polylinePositions).toEqual([
      [53.55, 10],
      [53.551, 9.99],
      [53.63, 10.02],
    ]);
    expect(result.missingLocations).toEqual([
      {
        id: "item-1",
        kind: "planItem",
        label: "Breakfast",
        href: "/trips/trip-1/days/day-a?open=plan&itemId=item-1",
      },
    ]);
  });

  it("dedupes the same stay across adjacent days even when the rendered labels differ", () => {
    const result = buildTripOverviewMapData({
      tripId: "trip-1",
      days: [
        {
          id: "day-a",
          date: "2026-06-01T00:00:00.000Z",
          dayIndex: 1,
          accommodation: {
            id: "stay-1",
            name: "Harbor Hotel",
            notes: "Check in",
            location: { lat: 53.55, lng: 10, label: "Hamburg" },
          },
          dayPlanItems: [],
        },
        {
          id: "day-b",
          date: "2026-06-02T00:00:00.000Z",
          dayIndex: 2,
          accommodation: {
            id: "stay-1",
            name: "",
            notes: "Second night",
            location: { lat: 53.55, lng: 10, label: "Hamburg" },
          },
          dayPlanItems: [],
        },
      ],
      getDayLabel: (index) => `Day ${index}`,
      getPlanItemFallbackLabel: (index) => `Plan item ${index}`,
    });

    expect(result.points.map((point) => point.id)).toEqual(["stay-1"]);
    expect(result.polylinePositions).toEqual([[53.55, 10]]);
  });
});
