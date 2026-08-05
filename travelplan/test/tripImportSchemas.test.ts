import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_BUCKET_LIST_ITEMS,
  MAX_IMPORT_DAYS,
  MAX_IMPORT_MEDIA_WRITES,
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

/**
 * `v2Payload` stretched over two days, which is the shortest package that can express Story 2.35's
 * subject: `previousStay` writes a segment on day 2 pointing at day 1's accommodation, so a one-day
 * fixture cannot tell the widened rule from the old one.
 *
 * Day 2 carries its own stay and plan item so the tests can pick which endpoint they misfile.
 */
const secondDay = {
  ...v2Day,
  id: "day-2",
  date: "2026-03-02T00:00:00.000Z",
  dayIndex: 2,
  imagePhotoId: null,
  accommodation: { ...v2Day.accommodation, id: "stay-2", images: [] },
  dayPlanItems: [{ ...v2Day.dayPlanItems[0], id: "plan-2", images: [] }],
  travelSegments: [],
};

const twoDayPayload = (
  firstDayOverrides: Record<string, unknown> = {},
  secondDayOverrides: Record<string, unknown> = {},
) => ({
  ...v2Payload,
  trip: { ...v2Payload.trip, endDate: "2026-03-02T00:00:00.000Z" },
  days: [
    { ...v2Day, ...firstDayOverrides },
    { ...secondDay, ...secondDayOverrides },
  ],
});

/** The `previousStay` segment: on day 2, starting at day 1's accommodation. */
const previousStaySegment = {
  ...v2Segment,
  id: "seg-prev-stay",
  fromItemType: "accommodation",
  fromItemId: "stay-1",
  toItemType: "dayPlanItem",
  toItemId: "plan-2",
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

    it("rejects a travel segment referencing a plan item that is not on its own day", () => {
      // Story 2.35 changed this fixture, not the rule it proves. It used to name `plan-on-another-day`,
      // an id no day in the package declared at all - which AC2 now makes a skipped segment rather
      // than a refused archive. The assertion this test exists for is Trap 2: plan-item endpoints
      // stay day-scoped, so a real plan item belonging to a *different* day is still a hard error.
      const result = tripImportPayloadSchema.safeParse(
        twoDayPayload({ travelSegments: [{ ...v2Segment, toItemId: "plan-2" }] }),
      );

      expect(result.success).toBe(false);
    });

    it("accepts a day-2 segment starting at day 1's accommodation (the previousStay feature)", () => {
      // AC1. `TripDayView`'s `previousStay` offers last night's hotel as the start of today's first
      // leg and stores the segment on *today's* day, which the old same-day rule refused - 27 of the
      // 36 rejections on the production archive, and every multi-day trip planned with the app.
      const result = tripImportPayloadSchema.safeParse(
        twoDayPayload({}, { travelSegments: [previousStaySegment] }),
      );

      expect(result.success).toBe(true);
    });

    it("accepts an accommodation from any earlier day, not only the day before", () => {
      // The rule is "this day or earlier" rather than "exactly one day back": the importer's
      // `accommodationIdBySourceId` is trip-wide and filled in day order, so day 1's stay is already
      // mapped by day 3 - and a segment written when day 2 did not yet exist outlives inserting it.
      const threeDayPayload = {
        ...v2Payload,
        trip: { ...v2Payload.trip, endDate: "2026-03-03T00:00:00.000Z" },
        days: [
          v2Day,
          { ...secondDay, accommodation: null },
          {
            ...secondDay,
            id: "day-3",
            date: "2026-03-03T00:00:00.000Z",
            dayIndex: 3,
            accommodation: null,
            dayPlanItems: [{ ...v2Day.dayPlanItems[0], id: "plan-3", images: [] }],
            travelSegments: [{ ...previousStaySegment, toItemId: "plan-3" }],
          },
        ],
      };

      const result = tripImportPayloadSchema.safeParse(threeDayPayload);

      expect(result.success).toBe(true);
    });

    it("rejects a segment naming an accommodation from a *later* day", () => {
      // Trap 4. The importer's map is trip-wide but order-dependent: `sortImportDays` has not reached
      // day 2 when day 1's segments are written, so a forward reference cannot resolve at all. The
      // package does contain the record, so this is a misfiled reference rather than AC2's orphan -
      // it stays a validation error and says which problem it is.
      const result = tripImportPayloadSchema.safeParse(
        twoDayPayload({ travelSegments: [{ ...v2Segment, fromItemId: "stay-2" }] }),
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "Travel segment fromItemId names an accommodation from a later day: stay-2",
      );
    });

    it("reads 'earlier day' in the importer's day order, not the array's", () => {
      // `sortImportDays` sorts by `dayIndex` then `date`; nothing makes the manifest's array agree
      // with it. Trusting the array order would read this package's ordinary previous-night segment
      // as a forward reference - the same false positive one layer down.
      const reversed = twoDayPayload({}, { travelSegments: [previousStaySegment] });
      const result = tripImportPayloadSchema.safeParse({ ...reversed, days: [...reversed.days].reverse() });

      expect(result.success).toBe(true);
    });

    it("accepts a segment endpoint that names no record anywhere, for the importer to skip", () => {
      // AC2. An orphan left by an activity deleted before Story 6.23 fixed the cause, which every
      // database older than 2026-08-03 still holds. Validation lets it past so the importer can drop
      // the one segment and report it; refusing here made an otherwise intact archive unrestorable.
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ travelSegments: [{ ...v2Segment, toItemId: "deleted-long-ago" }] }),
      );

      expect(result.success).toBe(true);
    });

    it("accepts an *accommodation* endpoint that names no record anywhere, for the importer to skip", () => {
      // The same AC2 orphan on the other side of the `itemType` branch, and the branch that matters
      // most: a deleted *stay* is what leaves an orphan on the accommodation side, and the whole
      // reason the check had to grow a third verdict is that accommodations resolve through a
      // different map. Without this, `itemType === "accommodation"` + declared-nowhere could be
      // mis-triaged as a misfiled reference and refuse the archive with the suite still green.
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          travelSegments: [{ ...v2Segment, fromItemType: "accommodation", fromItemId: "stay-deleted-long-ago" }],
        }),
      );

      expect(result.success).toBe(true);
    });

    it("rejects a travel segment whose endpoint has the wrong item type", () => {
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({
          // `stay-1` exists on this day, but as the accommodation, not as a plan item.
          travelSegments: [{ ...v2Segment, fromItemType: "dayPlanItem", fromItemId: "stay-1" }],
        }),
      );

      expect(result.success).toBe(false);
      // Story 2.35 made this the case that has to be told apart from AC2's orphan, so `success: false`
      // alone no longer pins it: the id *is* in the package, just under the other `itemType`, and a
      // check that read it as declared-nowhere would accept the archive and let the importer silently
      // drop the segment instead. Name the verdict.
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "Travel segment fromItemId does not match any record on this day: stay-1",
      );
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
      const images = Array.from({ length: MAX_IMPORT_MEDIA_WRITES + 1 }, (_, index) => ({
        sortOrder: index,
        photoId: "p1",
      }));
      const result = tripImportPayloadSchema.safeParse(
        withFirstDay({ accommodation: { ...v2Day.accommodation, images } }),
      );

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("media files");
    });

    it("accepts a payload sitting exactly on the planned-write cap", () => {
      const images = Array.from({ length: MAX_IMPORT_MEDIA_WRITES - 2 }, (_, index) => ({
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

  /**
   * Story 9.1's additions, and the two properties that outrank everything else in them: `documents`
   * is optional with an empty default everywhere it appears, and `fileName` is judged strictly
   * because it is a column value that gets rendered and, in Story 9.2, printed.
   */
  describe("v2 documents", () => {
    const documentPool = { d1: { contentType: "application/pdf", archivePath: "documents/d1.pdf" } };

    /** `v2Payload` with a document pool and one document on the day's stay. */
    const withDocuments = (documents: unknown[], pool: Record<string, unknown> = documentPool) => ({
      ...v2Payload,
      documents: pool,
      days: [{ ...v2Day, accommodation: { ...v2Day.accommodation, documents } }],
    });

    it("defaults documents to empty everywhere, so a payload that never heard of them parses", () => {
      // The invariant in one test: `v2Payload` is a pre-9.1 manifest verbatim - no `documents` key at
      // the root, none on the stay, none on the plan item - and it must parse into the same shape a
      // documents-carrying payload does, with `[]` and `{}` rather than `undefined`.
      const result = tripImportPayloadSchema.safeParse(v2Payload);

      expect(result.success).toBe(true);
      expect(result.data?.documents).toEqual({});
      expect(result.data?.days[0].accommodation?.documents).toEqual([]);
      expect(result.data?.days[0].dayPlanItems[0].documents).toEqual([]);
    });

    it("accepts a document on a stay and on an activity", () => {
      const result = tripImportPayloadSchema.safeParse({
        ...v2Payload,
        documents: {
          d1: { contentType: "application/pdf", archivePath: "documents/d1.pdf" },
          d2: { contentType: "image/jpeg", archivePath: "documents/d2.jpg" },
        },
        days: [
          {
            ...v2Day,
            accommodation: {
              ...v2Day.accommodation,
              documents: [{ sortOrder: 0, documentId: "d1", fileName: "Ticket Rom.pdf" }],
            },
            dayPlanItems: [
              {
                ...v2Day.dayPlanItems[0],
                documents: [{ sortOrder: 0, documentId: "d2", fileName: "Museumskarte.jpg" }],
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.days[0].accommodation?.documents[0].fileName).toBe("Ticket Rom.pdf");
      expect(result.data?.days[0].dayPlanItems[0].documents[0].fileName).toBe("Museumskarte.jpg");
    });

    it("rejects a documentId that names nothing in the pool", () => {
      const result = tripImportPayloadSchema.safeParse(
        withDocuments([{ sortOrder: 0, documentId: "d9", fileName: "Ticket.pdf" }]),
      );

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("Unknown document reference: d9");
    });

    it("rejects two documents on one owner sharing a sortOrder", () => {
      // `@@unique([accommodationId, sortOrder])` would otherwise surface as a P2002 halfway through
      // the import transaction - a 500 for something the payload states plainly.
      const result = tripImportPayloadSchema.safeParse(
        withDocuments([
          { sortOrder: 0, documentId: "d1", fileName: "First.pdf" },
          { sortOrder: 0, documentId: "d1", fileName: "Second.pdf" },
        ]),
      );

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain("Duplicate document sortOrder");
    });

    it("allows two documents on one owner sharing a fileName, which nothing forbids", () => {
      // The unique index is on `sortOrder`, not on the name: two tickets called `Ticket.pdf` on one
      // stay is an ordinary thing to have, and refusing it here would refuse a restorable backup.
      const result = tripImportPayloadSchema.safeParse(
        withDocuments([
          { sortOrder: 0, documentId: "d1", fileName: "Ticket.pdf" },
          { sortOrder: 1, documentId: "d1", fileName: "Ticket.pdf" },
        ]),
      );

      expect(result.success).toBe(true);
    });

    it("accepts a fileName at both ends of its length range", () => {
      const oneCharacter = "a";
      const exactly255 = `${"b".repeat(251)}.pdf`;
      expect(exactly255).toHaveLength(255);

      for (const fileName of [oneCharacter, exactly255]) {
        const result = tripImportPayloadSchema.safeParse(
          withDocuments([{ sortOrder: 0, documentId: "d1", fileName }]),
        );
        expect(result.success).toBe(true);
        expect(result.data?.days[0].accommodation?.documents[0].fileName).toBe(fileName);
      }
    });

    it("refuses a fileName that is empty, over-length, a path or full of control characters", () => {
      const refused: [string, string][] = [
        ["empty", ""],
        ["whitespace only", "   "],
        ["256 characters", "c".repeat(256)],
        ["forward slash", "../../etc/passwd"],
        ["backslash", "C:\\Users\\tommy\\ticket.pdf"],
        ["a bare dot", "."],
        ["a parent reference", ".."],
        ["a control character", "Ticket\u0000Rom.pdf"],
        ["a newline", "Ticket\nRom.pdf"],
      ];

      for (const [label, fileName] of refused) {
        const result = tripImportPayloadSchema.safeParse(
          withDocuments([{ sortOrder: 0, documentId: "d1", fileName }]),
        );
        expect(result.success, `${label} should be refused`).toBe(false);
      }
    });

    it("counts document references against the same write cap photos use", () => {
      // One disk budget, not two: the cap is on files this request creates, and it does not care
      // which pool a file came out of. Two documents short of the cap, plus the hero and day image
      // this fixture already carries, sits exactly on it - and one more is over.
      const documents = (count: number) =>
        Array.from({ length: count }, (_, index) => ({
          sortOrder: index,
          documentId: "d1",
          fileName: `Ticket ${index}.pdf`,
        }));
      const payload = (count: number) => ({
        ...v2Payload,
        documents: documentPool,
        days: [
          {
            ...v2Day,
            accommodation: { ...v2Day.accommodation, images: [], documents: documents(count) },
            dayPlanItems: [{ ...v2Day.dayPlanItems[0], images: [] }],
          },
        ],
      });

      expect(tripImportPayloadSchema.safeParse(payload(MAX_IMPORT_MEDIA_WRITES - 2)).success).toBe(true);

      const over = tripImportPayloadSchema.safeParse(payload(MAX_IMPORT_MEDIA_WRITES - 1));
      expect(over.success).toBe(false);
      expect(JSON.stringify(over.error?.issues)).toContain("media files");
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
