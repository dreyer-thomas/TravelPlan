import { describe, expect, it } from "vitest";
import { travelSegmentMutationSchema } from "@/lib/validation/travelSegmentSchemas";

describe("travelSegmentMutationSchema", () => {
  const basePayload = {
    tripDayId: "day-1",
    fromItemType: "dayPlanItem" as const,
    fromItemId: "item-1",
    toItemType: "accommodation" as const,
    toItemId: "stay-1",
    transportType: "car" as const,
    durationMinutes: 30,
    distanceKm: 12,
    linkUrl: "https://maps.example.com",
  };

  it("requires duration minutes", () => {
    const result = travelSegmentMutationSchema.safeParse({ ...basePayload, durationMinutes: 0 });
    expect(result.success).toBe(false);
  });

  it("requires distance for car travel", () => {
    const result = travelSegmentMutationSchema.safeParse({ ...basePayload, distanceKm: null });
    expect(result.success).toBe(false);
  });

  it("allows non-car travel without distance", () => {
    const result = travelSegmentMutationSchema.safeParse({
      ...basePayload,
      transportType: "ship",
      distanceKm: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects distance for non-car travel", () => {
    const result = travelSegmentMutationSchema.safeParse({
      ...basePayload,
      transportType: "flight",
      distanceKm: 220,
    });
    expect(result.success).toBe(false);
  });

  // --- Story 6.16: walking and cycling ---------------------------------------------------------

  it("accepts walking and cycling as transport types", () => {
    for (const transportType of ["walking", "cycling"] as const) {
      const result = travelSegmentMutationSchema.safeParse({ ...basePayload, transportType, distanceKm: null });
      expect(result.success).toBe(true);
    }
  });

  /**
   * AC6, in both directions. Distance is *allowed* on walking and cycling so a 40 km ride keeps its
   * number, and *not required* so a two-minute walk is not a form error. Only car still demands one.
   */
  it("allows but does not require a distance for walking and cycling", () => {
    for (const transportType of ["walking", "cycling"] as const) {
      expect(travelSegmentMutationSchema.safeParse({ ...basePayload, transportType, distanceKm: null }).success).toBe(
        true,
      );
      expect(travelSegmentMutationSchema.safeParse({ ...basePayload, transportType, distanceKm: 42.5 }).success).toBe(
        true,
      );
    }
  });

  it("still requires a distance for car only", () => {
    expect(travelSegmentMutationSchema.safeParse({ ...basePayload, distanceKm: null }).success).toBe(false);
    expect(
      travelSegmentMutationSchema.safeParse({ ...basePayload, transportType: "walking", distanceKm: null }).success,
    ).toBe(true);
  });

  it("still rejects a distance on ship and flight", () => {
    for (const transportType of ["ship", "flight"] as const) {
      const result = travelSegmentMutationSchema.safeParse({ ...basePayload, transportType, distanceKm: 12 });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Distance is only allowed for car, walking and cycling travel");
    }
  });
});
