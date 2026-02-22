import { describe, expect, it } from "vitest";
import {
  tripImportRequestSchema,
  tripImportPayloadSchema,
} from "@/lib/validation/tripImportSchemas";

const validPayload = {
  meta: {
    exportedAt: "2026-02-14T12:00:00.000Z",
    appVersion: "0.1.0",
    formatVersion: 1,
  },
  trip: {
    id: "trip-export-id",
    name: "Importable Trip",
    startDate: "2026-03-01T00:00:00.000Z",
    endDate: "2026-03-02T00:00:00.000Z",
    heroImageUrl: null,
    createdAt: "2026-02-14T12:00:00.000Z",
    updatedAt: "2026-02-14T12:00:00.000Z",
  },
  days: [
    {
      id: "day-1",
      date: "2026-03-01T00:00:00.000Z",
      dayIndex: 1,
      imageUrl: "/uploads/trips/trip-export-id/days/day-1/day.webp",
      note: "Arrival",
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: {
        id: "stay-1",
        name: "Dockside Hotel",
        notes: "Near station",
        status: "booked",
        costCents: 25000,
        link: "https://example.com/stay",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: {
          lat: 48.14,
          lng: 11.58,
          label: "Dockside",
        },
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
      },
      dayPlanItems: [
        {
          id: "plan-1",
          contentJson: "{\"type\":\"doc\"}",
          linkUrl: "https://example.com/plan",
          location: {
            lat: 48.141,
            lng: 11.581,
            label: "Museum",
          },
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
        },
      ],
    },
    {
      id: "day-2",
      date: "2026-03-02T00:00:00.000Z",
      dayIndex: 2,
      imageUrl: null,
      note: null,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
    },
  ],
};

describe("tripImportSchemas", () => {
  it("accepts exported payload format", () => {
    const result = tripImportPayloadSchema.safeParse(validPayload);

    expect(result.success).toBe(true);
  });

  it("accepts legacy payloads without day image fields", () => {
    const legacyPayload = {
      ...validPayload,
      days: validPayload.days.map((day) => {
        const { imageUrl: _imageUrl, note: _note, ...rest } = day;
        return rest;
      }),
    };
    const result = tripImportPayloadSchema.safeParse(legacyPayload);

    expect(result.success).toBe(true);
  });

  it("rejects malformed payload missing core trip fields", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      trip: {
        ...validPayload.trip,
        name: " ",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed day objects", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      days: [
        {
          ...validPayload.days[0],
          dayIndex: 0,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects incomplete day coverage for trip date range", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      trip: {
        ...validPayload.trip,
        endDate: "2026-03-03T00:00:00.000Z",
      },
      days: [validPayload.days[0]],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate dayIndex values", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      days: [
        validPayload.days[0],
        {
          ...validPayload.days[0],
          id: "day-2",
          date: "2026-03-02T00:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects day plan item ranges where toTime is not later than fromTime", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      days: [
        {
          ...validPayload.days[0],
          dayPlanItems: [
            {
              ...validPayload.days[0].dayPlanItems[0],
              fromTime: "11:00",
              toTime: "10:00",
            },
          ],
        },
        validPayload.days[1],
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects day plan items with only one time field set", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      days: [
        {
          ...validPayload.days[0],
          dayPlanItems: [
            {
              ...validPayload.days[0].dayPlanItems[0],
              fromTime: "10:00",
            },
          ],
        },
        validPayload.days[1],
      ],
    });

    expect(result.success).toBe(false);
  });

  it("requires targetTripId for overwrite conflict strategy", () => {
    const result = tripImportRequestSchema.safeParse({
      payload: validPayload,
      strategy: "overwrite",
    });

    expect(result.success).toBe(false);
  });

  it("accepts createNew conflict strategy without targetTripId", () => {
    const result = tripImportRequestSchema.safeParse({
      payload: validPayload,
      strategy: "createNew",
    });

    expect(result.success).toBe(true);
  });
});
