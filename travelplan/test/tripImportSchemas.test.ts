import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_BUCKET_LIST_ITEMS,
  MAX_IMPORT_DAYS,
  MAX_IMPORT_PHOTO_WRITES,
  MAX_IMPORT_SEGMENTS_PER_DAY,
  MAX_IMPORT_WARNINGS,
  MAX_SUPPORTED_FORMAT_VERSION,
} from "@/lib/trips/importLimits";
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
        payments: [{ amountCents: 25000, dueDate: "2026-03-01" }],
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

const STAMP = "2026-02-14T12:00:00.000Z";

/** A v2 travel segment wired to the ids `v2Day` exports, which is what the importer remaps. */
const v2Segment = {
  id: "seg-1",
  fromItemType: "accommodation",
  fromItemId: "stay-1",
  toItemType: "dayPlanItem",
  toItemId: "plan-1",
  transportType: "car",
  durationMinutes: 30,
  distanceKm: 12,
  linkUrl: null,
  createdAt: STAMP,
  updatedAt: STAMP,
};

const v2Day = {
  id: "day-1",
  date: "2026-03-01T00:00:00.000Z",
  dayIndex: 1,
  imageUrl: null,
  imagePhotoId: "p2",
  note: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  accommodation: {
    id: "stay-1",
    name: "Dockside Hotel",
    notes: null,
    status: "booked",
    costCents: null,
    link: null,
    checkInTime: null,
    checkOutTime: null,
    location: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    images: [{ sortOrder: 0, photoId: "p1" }],
  },
  dayPlanItems: [
    {
      id: "plan-1",
      contentJson: "{\"type\":\"doc\"}",
      linkUrl: null,
      location: null,
      createdAt: STAMP,
      updatedAt: STAMP,
      images: [{ sortOrder: 0, photoId: "p2" }],
    },
  ],
  travelSegments: [v2Segment],
};

const v2Payload = {
  meta: { exportedAt: STAMP, appVersion: "0.1.0", formatVersion: 2, warnings: [] },
  photos: {
    p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" },
    p2: { contentType: "image/png", archivePath: "photos/p2.png" },
  },
  trip: {
    id: "trip-export-id",
    name: "V2 Trip",
    startDate: "2026-03-01T00:00:00.000Z",
    endDate: "2026-03-01T00:00:00.000Z",
    heroImageUrl: null,
    heroPhotoId: "p1",
    createdAt: STAMP,
    updatedAt: STAMP,
    bucketListItems: [
      {
        id: "bucket-1",
        title: "Fjord cruise",
        description: "Book early",
        positionText: "North",
        location: { lat: 60.1, lng: 5.3, label: "Bergen" },
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  },
  days: [v2Day],
};

/** Replaces fields on the single day of `v2Payload`, keeping the trip's date range coverage valid. */
const withFirstDay = (overrides: Record<string, unknown>) => ({
  ...v2Payload,
  days: [{ ...v2Day, ...overrides }],
});

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

  it("rejects impossible payment dates in imported schedules", () => {
    const result = tripImportPayloadSchema.safeParse({
      ...validPayload,
      days: [
        {
          ...validPayload.days[0],
          accommodation: {
            ...validPayload.days[0].accommodation!,
            payments: [{ amountCents: 25000, dueDate: "2026-02-31" }],
          },
        },
        validPayload.days[1],
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

  describe("v2 manifest", () => {
    it("accepts a complete v2 manifest", () => {
      const result = tripImportPayloadSchema.safeParse(v2Payload);

      expect(result.success).toBe(true);
    });

    it("fills v2 defaults so a v1 payload is unchanged after parsing (AC2)", () => {
      const result = tripImportPayloadSchema.safeParse(validPayload);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.photos).toEqual({});
      expect(result.data.meta.warnings).toEqual([]);
      expect(result.data.trip.heroPhotoId).toBeNull();
      expect(result.data.trip.bucketListItems).toEqual([]);
      expect(result.data.days[0].imagePhotoId).toBeNull();
      expect(result.data.days[0].travelSegments).toEqual([]);
      expect(result.data.days[0].accommodation?.images).toEqual([]);
      expect(result.data.days[0].dayPlanItems[0].images).toEqual([]);
    });

    it("accepts any non-empty photo content type, because the bytes are what decide", () => {
      // The export's `application/octet-stream` fallback used to fail the whole payload here. It
      // is now just a hint: `validatePackagePhotos` sniffs the member and the importer derives the
      // stored extension from the sniffed type. Resolves DW-83.
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        photos: {
          ...v2Payload.photos,
          p1: { contentType: "application/octet-stream", archivePath: "photos/p1.bin" },
        },
      });

      expect(result.success).toBe(true);
    });

    it("still requires a photo entry to name a content type and a member", () => {
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        photos: { ...v2Payload.photos, p1: { contentType: "  ", archivePath: "photos/p1.jpg" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects a dangling heroPhotoId", () => {
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        trip: { ...v2Payload.trip, heroPhotoId: "p99" },
      });

      expect(result.success).toBe(false);
    });

    it("rejects a dangling gallery photoId", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ accommodation: { ...v2Day.accommodation, images: [{ sortOrder: 0, photoId: "p42" }] } }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects duplicate gallery sortOrder values", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          accommodation: {
            ...v2Day.accommodation,
            images: [
              { sortOrder: 0, photoId: "p1" },
              { sortOrder: 0, photoId: "p2" },
            ],
          },
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a travel segment referencing an id that is not on its own day", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          travelSegments: [{ ...v2Segment, toItemId: "plan-on-another-day" }],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a travel segment whose endpoint has the wrong item type", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          // `stay-1` exists on this day, but as the accommodation, not as a plan item.
          travelSegments: [{ ...v2Segment, fromItemType: "dayPlanItem", fromItemId: "stay-1" }],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a duplicate travel segment endpoint tuple within a day", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          travelSegments: [v2Segment, { ...v2Segment, id: "seg-2", durationMinutes: 99 }],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("accepts two segments that share one endpoint but not the whole tuple", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          dayPlanItems: [v2Day.dayPlanItems[0], { ...v2Day.dayPlanItems[0], id: "plan-2" }],
          travelSegments: [v2Segment, { ...v2Segment, id: "seg-2", toItemId: "plan-2" }],
        }),
      );

      expect(result.success).toBe(true);
    });

    it("rejects a non-positive travel segment duration", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ travelSegments: [{ ...v2Segment, durationMinutes: 0 }] }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a travel segment that loops back to the record it starts from", () => {
      // `travelSegmentMutationSchema` refuses this, so an imported self-loop could never be edited
      // or re-saved from the dialog that owns it.
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          travelSegments: [{ ...v2Segment, fromItemType: "dayPlanItem", fromItemId: "plan-1" }],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a zero travel segment distance, which the mutation schema calls non-positive", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ travelSegments: [{ ...v2Segment, distanceKm: 0 }] }),
      );

      expect(result.success).toBe(false);
    });

    it("accepts a car segment with no distance, which the mutation schema would reject", () => {
      // Deliberate: the export emits whatever is in the database, and enforcing the
      // transportType/distanceKm coupling would make legitimate backups unrestorable.
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ travelSegments: [{ ...v2Segment, transportType: "car", distanceKm: null }] }),
      );

      expect(result.success).toBe(true);
    });

    it("rejects a travel segment link that is not http or https", () => {
      // Import is the only writer that could put a `javascript:` URL in this column - the mutation
      // route applies `isSafeExternalUrl`, and `z.string().url()` alone does not.
      for (const linkUrl of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
        const result = tripImportPayloadSchema.safeParse(
          withFirstDay({ travelSegments: [{ ...v2Segment, linkUrl }] }),
        );
        expect(result.success).toBe(false);
      }
    });

    it("rejects a travel segment link over the 2000 character cap", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          travelSegments: [{ ...v2Segment, linkUrl: `https://example.com/${"a".repeat(2000)}` }],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects two records on one day that share a source id", () => {
      // The importer remaps travel segments through a `Map` keyed on these ids, so a duplicate
      // silently overwrites its twin and any segment naming it wires to the wrong row.
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          dayPlanItems: [v2Day.dayPlanItems[0], { ...v2Day.dayPlanItems[0] }],
          travelSegments: [],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a plan item whose id collides with the day's accommodation", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          dayPlanItems: [{ ...v2Day.dayPlanItems[0], id: "stay-1" }],
          travelSegments: [],
        }),
      );

      expect(result.success).toBe(false);
    });

    it("rejects a payload planning more photo files than one import may write", () => {
      // One pooled photo, thousands of gallery slots naming it: the archive stays tiny while the
      // planned write count does not. Every slot is a separate file on disk.
      const images = Array.from({ length: MAX_IMPORT_PHOTO_WRITES + 1 }, (_, index) => ({
        sortOrder: index,
        photoId: "p1",
      }));
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ accommodation: { ...v2Day.accommodation, images } }),
      );

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("photo files");
    });

    it("accepts a payload sitting exactly on the planned-write cap", () => {
      const images = Array.from({ length: MAX_IMPORT_PHOTO_WRITES - 2 }, (_, index) => ({
        sortOrder: index,
        photoId: "p1",
      }));
      // Plus the hero and the day image, which are references too: exactly at the cap.
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          accommodation: { ...v2Day.accommodation, images },
          dayPlanItems: [{ ...v2Day.dayPlanItems[0], images: [] }],
        }),
      );

      expect(result.success).toBe(true);
    });

    it("rejects bucket list fields that the live API would refuse to save again", () => {
      const overLength = [
        { title: "a".repeat(121) },
        { title: "Fine", description: "b".repeat(1001) },
        { title: "Fine", positionText: "c".repeat(201) },
      ];

      for (const item of overLength) {
        const result = tripImportPayloadSchema.safeParse({
          ...v2Payload,
          trip: { ...v2Payload.trip, bucketListItems: [item] },
        });
        expect(result.success).toBe(false);
      }
    });

    it("accepts bucket list fields exactly on the live API's caps", () => {
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        trip: {
          ...v2Payload.trip,
          bucketListItems: [
            { title: "a".repeat(120), description: "b".repeat(1000), positionText: "c".repeat(200) },
          ],
        },
      });

      expect(result.success).toBe(true);
    });

    it("rejects a bucket list item with a blank title", () => {
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        trip: { ...v2Payload.trip, bucketListItems: [{ id: "b1", title: "   " }] },
      });

      expect(result.success).toBe(false);
    });

    it("accepts a bucket list item with only a title", () => {
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        trip: { ...v2Payload.trip, bucketListItems: [{ title: "Northern lights" }] },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.trip.bucketListItems[0]).toMatchObject({
        title: "Northern lights",
        description: null,
        positionText: null,
        location: null,
      });
    });
  });

  describe("manifest ceilings", () => {
    it("accepts the newest format version it knows", () => {
      expect(tripImportPayloadSchema.safeParse(v2Payload).success).toBe(true);
    });

    it("refuses a format version newer than it can read", () => {
      // Zod strips fields it has no rule for, so accepting a future format would import, report
      // success, and silently drop whatever that format added. A backup tool must not do that.
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        meta: { ...v2Payload.meta, formatVersion: MAX_SUPPORTED_FORMAT_VERSION + 1 },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(JSON.stringify(result.error.issues)).toContain("newer version");
    });

    it("refuses a manifest declaring more days than any real trip has", () => {
      // The day count is pinned to the declared date range, so an absurd range is a schema-legal
      // way to ask for six figures of rows inside one transaction.
      const days = Array.from({ length: MAX_IMPORT_DAYS + 1 }, (_, index) => ({
        ...v2Payload.days[0],
        id: `day-${index + 1}`,
        dayIndex: index + 1,
      }));

      const result = tripImportPayloadSchema.safeParse({ ...v2Payload, days });
      expect(result.success).toBe(false);
      if (result.success) return;
      // Asserted on the message, not just on failure: an absurd day list also trips the
      // date-range coverage rule, and this test is about the cap.
      expect(JSON.stringify(result.error.issues)).toContain(`at most ${MAX_IMPORT_DAYS} days`);
    });

    it("refuses more travel segments on one day than the ceiling allows", () => {
      const travelSegments = Array.from({ length: MAX_IMPORT_SEGMENTS_PER_DAY + 1 }, (_, index) => ({
        ...v2Payload.days[0].travelSegments[0],
        id: `seg-${index + 1}`,
      }));

      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        days: [{ ...v2Payload.days[0], travelSegments }, ...v2Payload.days.slice(1)],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(JSON.stringify(result.error.issues)).toContain(`at most ${MAX_IMPORT_SEGMENTS_PER_DAY} travel segments`);
    });

    it("refuses more bucket list items than the ceiling allows", () => {
      const bucketListItems = Array.from({ length: MAX_IMPORT_BUCKET_LIST_ITEMS + 1 }, (_, index) => ({
        title: `Wish ${index + 1}`,
      }));

      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        trip: { ...v2Payload.trip, bucketListItems },
      });

      expect(result.success).toBe(false);
    });

    it("refuses an unbounded warnings list, which the success envelope echoes back verbatim", () => {
      const warnings = Array.from({ length: MAX_IMPORT_WARNINGS + 1 }, (_, index) => `warning ${index}`);

      expect(tripImportPayloadSchema.safeParse({ ...v2Payload, meta: { ...v2Payload.meta, warnings } }).success).toBe(
        false,
      );
    });
  });
});
