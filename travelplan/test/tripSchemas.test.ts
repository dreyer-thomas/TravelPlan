import { describe, expect, it } from "vitest";
import { createTripSchema } from "@/lib/validation/tripSchemas";

describe("createTripSchema", () => {
  const basePayload = {
    name: "Trip",
    startDate: "2026-03-01T00:00:00.000Z",
    endDate: "2026-03-02T00:00:00.000Z",
  };

  it("accepts both start and destination locations together", () => {
    const result = createTripSchema.safeParse({
      ...basePayload,
      startLocation: { lat: 48.14, lng: 11.58, label: "Munich" },
      destinationLocation: { lat: 47.37, lng: 8.54, label: "Zurich" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects when only one location is provided", () => {
    const result = createTripSchema.safeParse({
      ...basePayload,
      startLocation: { lat: 48.14, lng: 11.58, label: "Munich" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid location labels", () => {
    const result = createTripSchema.safeParse({
      ...basePayload,
      startLocation: { lat: 48.14, lng: 11.58, label: "   " },
      destinationLocation: { lat: 47.37, lng: 8.54, label: "Zurich" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    const result = createTripSchema.safeParse({
      ...basePayload,
      startLocation: { lat: 181, lng: 11.58, label: "Bad Lat" },
      destinationLocation: { lat: 47.37, lng: -190, label: "Bad Lng" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects partial coordinate payloads", () => {
    const result = createTripSchema.safeParse({
      ...basePayload,
      startLocation: { lat: 48.14, label: "Missing Lng" },
      destinationLocation: { lat: 47.37, lng: 8.54, label: "Zurich" },
    });

    expect(result.success).toBe(false);
  });
});
