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
});
