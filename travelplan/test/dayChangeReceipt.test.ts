import { describe, expect, it } from "vitest";
import de from "@/i18n/de";
import en from "@/i18n/en";
import {
  fromDayChangeReceiptWire,
  planConflictText,
  receiptHasSideEffects,
  summarizeDayChangeReceipt,
  toDayChangeReceiptWire,
  type DayChangeReceipt,
  type MovedItemRow,
  type TravelSegmentRow,
} from "@/lib/trips/dayChangeReceipt";
import { findInvalidity } from "@/lib/repositories/dayPlanChangeRepo";
import { fromPrismaItemType } from "@/lib/repositories/travelSegmentRepo";
import { signDayChangeReceipt, verifyDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayChangeReceiptSchema, storedDayChangeReceiptSchema } from "@/lib/validation/dayChangeReceiptSchemas";

const BINDING = { tripId: "trip-1", userId: "user-1" };

const at = (iso: string) => new Date(iso);

const leg = (id: string): TravelSegmentRow => ({
  id,
  tripDayId: "day-1",
  fromItemType: "ACCOMMODATION",
  fromItemId: "stay-1",
  toItemType: "DAY_PLAN_ITEM",
  toItemId: "item-1",
  transportType: "CYCLING",
  durationMinutes: 15,
  distanceKm: 3.25,
  linkUrl: null,
  createdAt: at("2026-01-01T10:00:00.123Z"),
  updatedAt: at("2026-01-02T10:00:00.456Z"),
  // Story 15.4: a leg the connector wrote.
  aiChangedAt: at("2026-01-02T10:00:00.456Z"),
});

const itemRow = {
  id: "item-1",
  tripDayId: "day-1",
  title: "Museum",
  fromTime: "09:00",
  toTime: "10:00",
  contentJson: "{}",
  costCents: 1200,
  costOriginalAmount: 1500,
  costCurrency: "USD",
  costRate: 0.8,
  costRateDate: "2026-01-01",
  linkUrl: "https://example.com",
  locationLat: 1,
  locationLng: 2,
  locationLabel: "Here",
  scheduleMode: "FIXED" as const,
  durationMinutes: 60,
  sortOrder: 0,
  createdAt: at("2026-01-01T00:00:00.001Z"),
  updatedAt: at("2026-01-01T00:00:00.002Z"),
  // Story 15.4: the connector's marker, carried through the wire form millisecond for millisecond.
  aiChangedAt: at("2026-01-01T00:00:00.003Z") as Date | null,
};

const payment = {
  id: "pay-1",
  accommodationId: null,
  dayPlanItemId: "item-1",
  amountCents: 1200,
  amountOriginal: 1500,
  dueDate: "2026-02-01",
  sortOrder: 0,
  createdAt: at("2026-01-01T00:00:00.003Z"),
  updatedAt: at("2026-01-01T00:00:00.004Z"),
};

const receiptWith = (legs: TravelSegmentRow[]): DayChangeReceipt => ({
  version: 3,
  tripDayId: "day-1",
  edited: { kind: "created", itemId: "item-9", updatedAt: at("2026-03-01T00:00:00.000Z") },
  removedTravelSegments: legs,
  movedItems: [],
});

const dictionary = (language: Record<string, string>) => (key: string) => language[key] ?? key;

const moved = (itemId: string): MovedItemRow => ({
  itemId,
  previousFromTime: "10:30",
  previousToTime: "11:30",
  previousSortOrder: 1,
  fromTime: "11:00",
  toTime: "12:00",
  previousUpdatedAt: at("2026-02-01T00:00:00.011Z"),
  updatedAt: at("2026-03-01T00:00:00.012Z"),
});

describe("dayChangeReceipt, version 2 (Story 11.2)", () => {
  it("has side effects when only activities moved", () => {
    expect(receiptHasSideEffects({ ...receiptWith([]), movedItems: [moved("item-2")] })).toBe(true);
  });

  it("summarises moved activities before removed legs, singular and plural, in both languages", () => {
    const one = { ...receiptWith([]), movedItems: [moved("item-2")] };
    const three = { ...receiptWith([leg("s1")]), movedItems: [moved("item-2"), moved("item-3"), moved("item-4")] };
    expect(summarizeDayChangeReceipt(one, dictionary(de))).toBe("1 Aktivität verschoben");
    expect(summarizeDayChangeReceipt(three, dictionary(de))).toBe("3 Aktivitäten verschoben · 1 Fahrt entfernt");
    expect(summarizeDayChangeReceipt(one, dictionary(en))).toBe("1 activity moved");
    expect(summarizeDayChangeReceipt({ ...three, removedTravelSegments: [leg("s1"), leg("s2")] }, dictionary(en))).toBe(
      "3 activities moved · 2 travel legs removed",
    );
  });

  it("counts a row that lost its times past midnight as moved (Story 13.2 §7)", () => {
    const untimed = { ...receiptWith([]), movedItems: [{ ...moved("item-2"), fromTime: null, toTime: null }] };
    expect(receiptHasSideEffects(untimed)).toBe(true);
    expect(summarizeDayChangeReceipt(untimed, dictionary(de))).toBe("1 Aktivität verschoben");
  });

  it("refuses a moved row with an unknown key", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire({ ...receiptWith([]), movedItems: [moved("item-2")] }), BINDING);
    expect(dayChangeReceiptSchema.safeParse(wire).success).toBe(true);
    // Story 13.1: `fromTime` is a moved row's own key since version 3, so the unknown key is another one.
    expect(dayChangeReceiptSchema.safeParse({ ...wire, movedItems: [{ ...wire.movedItems[0], extra: "x" }] }).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, version: 1 }).success).toBe(false);
    // Story 13.1 AC12: a version-2 receipt is refused too.
    expect(dayChangeReceiptSchema.safeParse({ ...wire, version: 2 }).success).toBe(false);
  });
});

describe("dayChangeReceipt, reordered (Story 11.3)", () => {
  const reordered = (extra: MovedItemRow[] = [], legs: TravelSegmentRow[] = []): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited: { kind: "reordered", itemId: "item-b", neighbourId: "item-a", previousAiChangedAt: at("2026-01-03T00:00:00.000Z") },
    removedTravelSegments: legs,
    movedItems: [moved("item-b"), moved("item-a"), ...extra],
  });

  it("round-trips through the wire form, at version 3 since Story 13.1, and the schema accepts it", () => {
    const receipt = reordered([moved("item-c")], [leg("s1")]);
    const wire = toDayChangeReceiptWire(receipt);
    expect(wire.version).toBe(3) // Story 13.1: every receipt is version 3;
    expect(wire.edited).toEqual({
      kind: "reordered",
      itemId: "item-b",
      neighbourId: "item-a",
      previousAiChangedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
    expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
  });

  it("refuses a reordered edit with an unknown key or without its neighbour", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(reordered()), BINDING);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...wire.edited, updatedAt: "x" } }).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: { kind: "reordered", itemId: "item-b" } }).success).toBe(false);
  });

  it("always has side effects", () => {
    expect(receiptHasSideEffects({ ...reordered(), movedItems: [] })).toBe(true);
  });

  it("leads with the order change and counts only the other moved activities, in both languages", () => {
    expect(summarizeDayChangeReceipt(reordered(), dictionary(de))).toBe("Reihenfolge geändert");
    expect(summarizeDayChangeReceipt(reordered([moved("item-c")], [leg("s1")]), dictionary(de))).toBe(
      "Reihenfolge geändert · 1 Aktivität verschoben · 1 Fahrt entfernt",
    );
    expect(summarizeDayChangeReceipt(reordered([moved("item-c"), moved("item-d")]), dictionary(en))).toBe(
      "Order changed · 2 activities moved",
    );
    expect(summarizeDayChangeReceipt(reordered(), dictionary(en))).toBe("Order changed");
  });
});

describe("dayChangeReceipt, scheduled (Story 14.1 AC8, AC9)", () => {
  const scheduled = (extra: MovedItemRow[] = []): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited: {
      kind: "scheduled",
      itemId: "idea-1",
      updatedAt: at("2026-10-18T10:00:00.000Z"),
      previousUpdatedAt: at("2026-09-01T08:00:00.000Z"),
      previousAiChangedAt: null,
    },
    removedTravelSegments: [],
    movedItems: extra,
  });

  it("round-trips through the wire form at version 3, and the schema accepts it", () => {
    const wire = toDayChangeReceiptWire(scheduled());
    expect(wire.version).toBe(3);
    expect(wire.edited).toEqual({
      kind: "scheduled",
      itemId: "idea-1",
      updatedAt: "2026-10-18T10:00:00.000Z",
      previousUpdatedAt: "2026-09-01T08:00:00.000Z",
      previousAiChangedAt: null,
    });
    expect(fromDayChangeReceiptWire(wire)).toEqual(scheduled());
    expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
  });

  it("refuses a scheduled edit with an unknown key or without its previous stamp", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(scheduled()), BINDING);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...wire.edited, title: "x" } }).success).toBe(false);
    const { previousUpdatedAt: _previous, ...withoutPrevious } = wire.edited as { previousUpdatedAt: string };
    void _previous;
    expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: withoutPrevious }).success).toBe(false);
  });

  it("refuses a receipt that still carries a check-in warning (Story 13.2 AC8: 400, undo unavailable)", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([])), BINDING);
    const withOldField = { ...wire, checkInWarning: { accommodationId: "stay-1", checkInTime: "17:30" } };
    expect(dayChangeReceiptSchema.safeParse(withOldField).success).toBe(false);
  });

  it("refuses a receipt that still carries a consumed bucket-list row (400, undo unavailable)", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([])), BINDING);
    const withOldField = {
      ...wire,
      consumedBucketListItem: {
        id: "idea-1",
        tripId: "trip-1",
        title: "Idea",
        description: null,
        positionText: null,
        locationLat: null,
        locationLng: null,
        locationLabel: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    expect(dayChangeReceiptSchema.safeParse(withOldField).success).toBe(false);
  });

  it("always has side effects, even when nothing on the day moved", () => {
    expect(receiptHasSideEffects(scheduled())).toBe(true);
  });

  it("names the idea it scheduled, then what else changed, in both languages", () => {
    expect(summarizeDayChangeReceipt(scheduled(), dictionary(de), { itemTitle: "Wasserfall" })).toBe(
      "„Wasserfall“ eingeplant",
    );
    expect(summarizeDayChangeReceipt(scheduled(), dictionary(en), { itemTitle: "Waterfall" })).toBe(
      "\"Waterfall\" scheduled",
    );
    expect(summarizeDayChangeReceipt(scheduled([moved("item-c")]), dictionary(de), { itemTitle: "Wasserfall" })).toBe(
      "„Wasserfall“ eingeplant · 1 Aktivität verschoben",
    );
    // Without a title the dialog's untitled label stands in.
    expect(summarizeDayChangeReceipt(scheduled(), dictionary(en))).toBe(`"${en["trips.plan.untitledActivity"]}" scheduled`);
  });
});

describe("dayChangeReceipt, parked (Story 14.2 AC3, AC5)", () => {
  const parked = (extra: MovedItemRow[] = [], legs: TravelSegmentRow[] = []): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited: {
      kind: "parked",
      itemId: "item-1",
      updatedAt: at("2026-10-18T10:00:00.000Z"),
      previous: {
        tripDayId: "day-1",
        scheduleMode: "FIXED",
        durationMinutes: 120,
        sortOrder: 1,
        fromTime: "10:00",
        toTime: "12:00",
        updatedAt: at("2026-09-01T08:00:00.000Z"),
        previousAiChangedAt: at("2026-08-01T08:00:00.000Z"),
      },
    },
    removedTravelSegments: legs,
    movedItems: extra,
  });

  it("round-trips through the wire form at version 3, and the schema accepts it", () => {
    const wire = toDayChangeReceiptWire(parked([moved("item-2")], [leg("s1")]));
    expect(wire.version).toBe(3);
    expect(wire.edited).toEqual({
      kind: "parked",
      itemId: "item-1",
      updatedAt: "2026-10-18T10:00:00.000Z",
      previous: {
        tripDayId: "day-1",
        scheduleMode: "FIXED",
        durationMinutes: 120,
        sortOrder: 1,
        fromTime: "10:00",
        toTime: "12:00",
        updatedAt: "2026-09-01T08:00:00.000Z",
        previousAiChangedAt: "2026-08-01T08:00:00.000Z",
      },
    });
    expect(fromDayChangeReceiptWire(wire)).toEqual(parked([moved("item-2")], [leg("s1")]));
    const signed = JSON.parse(JSON.stringify(signDayChangeReceipt(wire, BINDING)));
    const parsed = dayChangeReceiptSchema.safeParse(signed);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(verifyDayChangeReceipt(parsed.data, BINDING)).not.toBeNull();
  });

  it("refuses an unknown key, a null previous day, and a missing previous stamp", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(parked()), BINDING);
    const edited = wire.edited as { previous: Record<string, unknown> };
    expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...wire.edited, title: "x" } }).success).toBe(false);
    expect(
      dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...edited, previous: { ...edited.previous, extra: 1 } } }).success,
    ).toBe(false);
    expect(
      dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...edited, previous: { ...edited.previous, tripDayId: null } } })
        .success,
    ).toBe(false);
    const { updatedAt: _stamp, ...withoutStamp } = edited.previous;
    void _stamp;
    expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...edited, previous: withoutStamp } }).success).toBe(false);
  });

  it("always has side effects, even when nothing else moved and no leg was removed", () => {
    expect(receiptHasSideEffects(parked())).toBe(true);
  });

  it("names the activity it parked, then what else changed, in both languages", () => {
    expect(summarizeDayChangeReceipt(parked(), dictionary(de), { itemTitle: "Wasserfall" })).toBe("„Wasserfall“ geparkt");
    expect(summarizeDayChangeReceipt(parked(), dictionary(en), { itemTitle: "Waterfall" })).toBe("\"Waterfall\" parked");
    expect(
      summarizeDayChangeReceipt(parked([moved("item-2"), moved("item-3")], [leg("s1")]), dictionary(de), {
        itemTitle: "Wasserfall",
      }),
    ).toBe("„Wasserfall“ geparkt · 2 Aktivitäten verschoben · 1 Fahrt entfernt");
    expect(
      summarizeDayChangeReceipt(parked([moved("item-2")], [leg("s1"), leg("s2")]), dictionary(en), { itemTitle: "Waterfall" }),
    ).toBe(`"Waterfall" parked · ${en["trips.dayChange.itemsMovedOne"]} · ${en["trips.dayChange.legsRemoved"].replace("{count}", "2")}`);
    expect(summarizeDayChangeReceipt(parked(), dictionary(en))).toBe(`"${en["trips.plan.untitledActivity"]}" parked`);
  });
});

describe("dayChangeReceipt, leg and check-out kinds (Story 11.4)", () => {
  const withEdited = (edited: DayChangeReceipt["edited"], movedItems: MovedItemRow[] = []): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited,
    removedTravelSegments: [],
    movedItems,
  });
  const kinds: DayChangeReceipt["edited"][] = [
    { kind: "legCreated", segmentId: "s1", updatedAt: at("2026-03-01T00:00:00.101Z") },
    { kind: "legUpdated", segmentId: "s1", updatedAt: at("2026-03-01T00:00:00.102Z"), previous: { ...leg("s1"), tripDayId: "day-1" } },
    {
      kind: "stayCheckOutChanged",
      accommodationId: "stay-1",
      updatedAt: at("2026-03-01T00:00:00.103Z"),
      previousUpdatedAt: at("2026-02-01T00:00:00.104Z"),
      previousCheckOutTime: null,
    },
  ];

  it("round-trips all three kinds through the wire form, and the schema accepts them", () => {
    for (const edited of kinds) {
      const receipt = withEdited(edited, [moved("item-2")]);
      const wire = toDayChangeReceiptWire(receipt);
      expect(wire.version).toBe(3) // Story 13.1: every receipt is version 3;
      expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
      expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
    }
  });

  it("refuses each kind with an unknown key", () => {
    for (const edited of kinds) {
      const wire = signDayChangeReceipt(toDayChangeReceiptWire(withEdited(edited)), BINDING);
      expect(dayChangeReceiptSchema.safeParse({ ...wire, edited: { ...wire.edited, itemId: "x" } }).success).toBe(false);
    }
  });

  it("has side effects only when something moved", () => {
    for (const edited of kinds) {
      expect(receiptHasSideEffects(withEdited(edited))).toBe(false);
      expect(receiptHasSideEffects(withEdited(edited, [moved("item-2")]))).toBe(true);
    }
  });

  it("names the pushed day when it is another day, singular and plural, in both languages", () => {
    const one = withEdited(kinds[2], [moved("item-2")]);
    const three = withEdited(kinds[2], [moved("item-2"), moved("item-3"), moved("item-4")]);
    expect(summarizeDayChangeReceipt(one, dictionary(de), { otherDayIndex: 5 })).toBe("1 Aktivität an Tag 5 verschoben");
    expect(summarizeDayChangeReceipt(three, dictionary(de), { otherDayIndex: 5 })).toBe("3 Aktivitäten an Tag 5 verschoben");
    expect(summarizeDayChangeReceipt(one, dictionary(en), { otherDayIndex: 5 })).toBe("1 activity moved on day 5");
    expect(summarizeDayChangeReceipt(three, dictionary(en), { otherDayIndex: 5 })).toBe("3 activities moved on day 5");
    expect(summarizeDayChangeReceipt(three, dictionary(en))).toBe("3 activities moved");
  });
});

describe("dayChangeReceipt (Story 11.1)", () => {
  it("has side effects exactly when a leg was removed", () => {
    expect(receiptHasSideEffects(receiptWith([]))).toBe(false);
    expect(receiptHasSideEffects(receiptWith([leg("s1")]))).toBe(true);
  });

  it("summarises one and several removed legs in both languages, with a separate singular", () => {
    expect(summarizeDayChangeReceipt(receiptWith([leg("s1")]), dictionary(de))).toBe("1 Fahrt entfernt");
    expect(summarizeDayChangeReceipt(receiptWith([leg("s1"), leg("s2")]), dictionary(de))).toBe("2 Fahrten entfernt");
    expect(summarizeDayChangeReceipt(receiptWith([leg("s1")]), dictionary(en))).toBe("1 travel leg removed");
    expect(summarizeDayChangeReceipt(receiptWith([leg("s1"), leg("s2"), leg("s3")]), dictionary(en))).toBe(
      "3 travel legs removed",
    );
    expect(summarizeDayChangeReceipt(receiptWith([]), dictionary(en))).toBe("");
  });

  it("round-trips every kind through the wire form, millisecond for millisecond, and the schema accepts it", () => {
    const receipts: DayChangeReceipt[] = [
      receiptWith([leg("s1")]),
      {
        version: 3,
        tripDayId: "day-1",
        edited: {
          kind: "updated",
          itemId: "item-1",
          updatedAt: at("2026-03-01T00:00:00.999Z"),
          previous: { ...itemRow, payments: [payment] },
        },
        removedTravelSegments: [leg("s1"), leg("s2")],
        movedItems: [],
      },
      {
        version: 3,
        tripDayId: "day-1",
        edited: {
          kind: "deleted",
          previous: {
            ...itemRow,
            payments: [payment],
            images: [
              {
                id: "img-1",
                dayPlanItemId: "item-1",
                imageUrl: "/uploads/trips/t/x.webp",
                sortOrder: 1,
                createdAt: at("2026-01-01T00:00:00.005Z"),
                updatedAt: at("2026-01-01T00:00:00.006Z"),
                aiChangedAt: at("2026-01-01T00:00:00.006Z"),
              },
            ],
            documents: [
              {
                id: "doc-1",
                dayPlanItemId: "item-1",
                documentUrl: "/uploads/trips/t/doc.pdf",
                fileName: "Ticket.pdf",
                sortOrder: 1,
                createdAt: at("2026-01-01T00:00:00.007Z"),
                updatedAt: at("2026-01-01T00:00:00.008Z"),
                aiChangedAt: null,
              },
            ],
          },
        },
        removedTravelSegments: [],
        movedItems: [],
      },
      // Story 14.1: a parked activity scheduled onto the day.
      {
        ...receiptWith([]),
        edited: {
          kind: "scheduled",
          itemId: "item-9",
          updatedAt: at("2026-01-01T00:00:00.009Z"),
          previousUpdatedAt: at("2026-01-01T00:00:00.010Z"),
          previousAiChangedAt: at("2026-01-01T00:00:00.011Z"),
        },
      },
      // Story 11.2: moved items (one an imported row with a null end). Story 13.2: one that lost its times.
      {
        ...receiptWith([leg("s1")]),
        movedItems: [
          moved("item-2"),
          { ...moved("item-3"), previousToTime: null },
          { ...moved("item-4"), fromTime: null, toTime: null },
        ],
      },
    ];

    for (const receipt of receipts) {
      // Signed as the write route sends it, through JSON as the client holds it, then parsed — which
      // rebuilds every object in schema order — and verified, exactly as the undo route does.
      const wire = JSON.parse(JSON.stringify(signDayChangeReceipt(toDayChangeReceiptWire(receipt), BINDING)));
      const parsed = dayChangeReceiptSchema.safeParse(wire);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      const verified = verifyDayChangeReceipt(parsed.data, BINDING);
      expect(verified).not.toBeNull();
      if (!verified) continue;
      expect(fromDayChangeReceiptWire(verified)).toEqual(receipt);
    }
  });

  it("refuses an unknown transport mode and a lowercase stored spelling", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([leg("s1")])), BINDING);
    const withMode = (transportType: string) => ({
      ...wire,
      removedTravelSegments: [{ ...wire.removedTravelSegments[0], transportType }],
    });
    expect(dayChangeReceiptSchema.safeParse(withMode("TELEPORT")).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse(withMode("car")).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse(withMode("CAR")).success).toBe(true);
  });

  // Story 6.31 / AC7 (H2): the receipt schema is derived from `TRANSPORT_TYPES`, so the new modes are
  // accepted in their stored spelling and refused in the wire one, like every other mode.
  it("accepts a stored TRAIN or BUS leg and refuses the lowercase spelling", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([leg("s1")])), BINDING);
    const withMode = (transportType: string) => ({
      ...wire,
      removedTravelSegments: [{ ...wire.removedTravelSegments[0], transportType }],
    });
    expect(dayChangeReceiptSchema.safeParse(withMode("TRAIN")).success).toBe(true);
    expect(dayChangeReceiptSchema.safeParse(withMode("BUS")).success).toBe(true);
    expect(dayChangeReceiptSchema.safeParse(withMode("train")).success).toBe(false);
  });

  it("caps the number of legs a receipt may carry", () => {
    const sign = (count: number) =>
      signDayChangeReceipt(
        toDayChangeReceiptWire(receiptWith(Array.from({ length: count }, (_, index) => leg(`s${index}`)))),
        BINDING,
      );
    expect(dayChangeReceiptSchema.safeParse(sign(1000)).success).toBe(true);
    expect(dayChangeReceiptSchema.safeParse(sign(1001)).success).toBe(false);
  });

  it("accepts only ISO timestamps, not anything Date.parse understands", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([leg("s1")])), BINDING);
    const withStamp = (createdAt: string) => ({
      ...wire,
      removedTravelSegments: [{ ...wire.removedTravelSegments[0], createdAt }],
    });
    expect(dayChangeReceiptSchema.safeParse(withStamp("2026")).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse(withStamp("Oct 10 2026")).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse(withStamp("2026-10-10T08:00:00.000Z")).success).toBe(true);
  });

  it("refuses an unsigned receipt", () => {
    const wire = toDayChangeReceiptWire(receiptWith([leg("s1")]));
    expect(dayChangeReceiptSchema.safeParse(wire).success).toBe(false);
  });

  it("verifies only the receipt it signed, for the trip and user it signed it for (review: AC12)", () => {
    const signed = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([leg("s1")])), BINDING);
    expect(verifyDayChangeReceipt(signed, BINDING)).not.toBeNull();

    const altered = {
      ...signed,
      removedTravelSegments: [{ ...signed.removedTravelSegments[0], toItemId: "somewhere-else" }],
    };
    expect(verifyDayChangeReceipt(altered, BINDING)).toBeNull();
    expect(verifyDayChangeReceipt(signed, { ...BINDING, tripId: "trip-2" })).toBeNull();
    expect(verifyDayChangeReceipt(signed, { ...BINDING, userId: "user-2" })).toBeNull();
    expect(verifyDayChangeReceipt({ ...signed, signature: "0".repeat(64) }, BINDING)).toBeNull();
  });

  it("maps the stored endpoint discriminator onto the timeline's", () => {
    expect(fromPrismaItemType("ACCOMMODATION")).toBe("accommodation");
    expect(fromPrismaItemType("DAY_PLAN_ITEM")).toBe("dayPlanItem");
  });
});

describe("dayChangeReceipt, suggestionsApplied (Story 12.4)", () => {
  const applied = (itemCount: number, legCount: number, removed: TravelSegmentRow[] = []): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited: {
      kind: "suggestionsApplied",
      items: Array.from({ length: itemCount }, (_value, index) => ({
        itemId: `item-${index}`,
        updatedAt: at(`2026-03-01T00:00:00.${String(100 + index).padStart(3, "0")}Z`),
      })),
      segments: Array.from({ length: legCount }, (_value, index) => ({
        segmentId: `seg-${index}`,
        updatedAt: at(`2026-03-01T00:00:00.${String(200 + index).padStart(3, "0")}Z`),
      })),
      imageIds: ["img-1", "img-2"],
    },
    removedTravelSegments: removed,
    movedItems: [],
  });

  it("always has side effects", () => {
    expect(receiptHasSideEffects(applied(1, 0))).toBe(true);
  });

  it("round-trips through the wire form at version 3 (Story 13.1), and the schema accepts it", () => {
    const receipt = applied(3, 2, [leg("s1")]);
    const wire = toDayChangeReceiptWire(receipt);
    expect(wire.version).toBe(3) // Story 13.1: every receipt is version 3;
    expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
    expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
  });

  it("refuses an unknown key, no items, more than 8 items, more than 24 images, an overlong id", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(applied(2, 1)), BINDING);
    if (wire.edited.kind !== "suggestionsApplied") throw new Error("fixture");
    const edited = wire.edited;
    const parse = (next: unknown) => dayChangeReceiptSchema.safeParse({ ...wire, edited: next }).success;
    expect(parse({ ...edited, extra: 1 })).toBe(false);
    expect(parse({ ...edited, items: [] })).toBe(false);
    expect(parse({ ...edited, items: Array.from({ length: 9 }, () => edited.items[0]) })).toBe(false);
    expect(parse({ ...edited, segments: Array.from({ length: 9 }, () => edited.segments[0]) })).toBe(false);
    expect(parse({ ...edited, imageIds: Array.from({ length: 25 }, (_v, i) => `img-${i}`) })).toBe(false);
    expect(parse({ ...edited, imageIds: ["x".repeat(129)] })).toBe(false);
    expect(parse({ ...edited, items: [{ ...edited.items[0], title: "x" }] })).toBe(false);
  });

  it("says how many activities and legs were added, singular and plural, in both languages", () => {
    expect(summarizeDayChangeReceipt(applied(1, 0), dictionary(de))).toBe("1 Aktivität hinzugefügt");
    expect(summarizeDayChangeReceipt(applied(4, 0), dictionary(de))).toBe("4 Aktivitäten hinzugefügt");
    expect(summarizeDayChangeReceipt(applied(4, 3), dictionary(de))).toBe("4 Aktivitäten und 3 Fahrten hinzugefügt");
    expect(summarizeDayChangeReceipt(applied(1, 1), dictionary(de))).toBe("1 Aktivität und 1 Fahrt hinzugefügt");
    expect(summarizeDayChangeReceipt(applied(1, 0), dictionary(en))).toBe("1 activity added");
    expect(summarizeDayChangeReceipt(applied(2, 1), dictionary(en))).toBe("2 activities and 1 travel leg added");
    expect(summarizeDayChangeReceipt(applied(3, 2), dictionary(en))).toBe("3 activities and 2 travel legs added");
  });

  it("adds the removed-leg fragment after the added part", () => {
    expect(summarizeDayChangeReceipt(applied(2, 2, [leg("s1")]), dictionary(de))).toBe(
      "2 Aktivitäten und 2 Fahrten hinzugefügt · 1 Fahrt entfernt",
    );
  });
});

describe("dayChangeReceipt, suggestionsApplied with parked ones (Story 14.3 AC5, AC7)", () => {
  const stamp = (ms: number) => at(`2026-03-01T00:00:00.${String(ms).padStart(3, "0")}Z`);
  const applied = (itemCount: number, legCount: number, parkedCount: number): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited: {
      kind: "suggestionsApplied",
      items: Array.from({ length: itemCount }, (_value, index) => ({ itemId: `item-${index}`, updatedAt: stamp(100 + index) })),
      segments: Array.from({ length: legCount }, (_value, index) => ({ segmentId: `seg-${index}`, updatedAt: stamp(200 + index) })),
      imageIds: [],
      parkedItems: Array.from({ length: parkedCount }, (_value, index) => ({ itemId: `parked-${index}`, updatedAt: stamp(300 + index) })),
    },
    removedTravelSegments: [],
    movedItems: [],
  });

  it("round-trips parkedItems through the wire form, and omits the key when the receipt has none", () => {
    const receipt = applied(2, 1, 2);
    const wire = toDayChangeReceiptWire(receipt);
    expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
    expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);

    const { parkedItems: _parked, ...withoutParked } = receipt.edited as Extract<DayChangeReceipt["edited"], { kind: "suggestionsApplied" }>;
    void _parked;
    const plain = toDayChangeReceiptWire({ ...receipt, edited: withoutParked });
    expect("parkedItems" in plain.edited).toBe(false);
  });

  it("accepts an all-parked receipt and refuses none at all, more than 8 together and an unknown key", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(applied(2, 1, 1)), BINDING);
    if (wire.edited.kind !== "suggestionsApplied") throw new Error("fixture");
    const edited = wire.edited;
    const parse = (next: unknown) => dayChangeReceiptSchema.safeParse({ ...wire, edited: next }).success;
    expect(parse({ ...edited, items: [], segments: [] })).toBe(true);
    expect(parse({ ...edited, items: [], parkedItems: [] })).toBe(false);
    expect(parse({ ...edited, parkedItems: Array.from({ length: 7 }, () => edited.parkedItems![0]) })).toBe(false);
    expect(parse({ ...edited, parkedItems: [{ ...edited.parkedItems![0], title: "x" }] })).toBe(false);
  });

  it("says how many were parked after the added part, or alone when all were, in both languages", () => {
    expect(summarizeDayChangeReceipt(applied(3, 2, 2), dictionary(de))).toBe("3 Aktivitäten und 2 Fahrten hinzugefügt · 2 geparkt");
    expect(summarizeDayChangeReceipt(applied(1, 0, 1), dictionary(de))).toBe("1 Aktivität hinzugefügt · 1 geparkt");
    expect(summarizeDayChangeReceipt(applied(0, 0, 2), dictionary(de))).toBe("2 geparkt");
    expect(summarizeDayChangeReceipt(applied(0, 0, 1), dictionary(de))).toBe("1 geparkt");
    expect(summarizeDayChangeReceipt(applied(3, 2, 2), dictionary(en))).toBe("3 activities and 2 travel legs added · 2 parked");
    expect(summarizeDayChangeReceipt(applied(0, 0, 1), dictionary(en))).toBe("1 parked");
    expect(receiptHasSideEffects(applied(0, 0, 2))).toBe(true);
  });

  it("has every new key in both dictionaries", () => {
    for (const key of [
      "trips.suggestions.parkChoiceLabel",
      "trips.suggestions.choiceSchedule",
      "trips.suggestions.choicePark",
      "trips.suggestions.applySplit",
      "trips.suggestions.applyParkedOnly",
      "trips.suggestions.previewParkedTitle",
      "trips.dayChange.suggestionsParked",
      "trips.dayChange.suggestionsParkedOne",
    ]) {
      expect(de[key as keyof typeof de], key).toBeTruthy();
      expect(en[key as keyof typeof en], key).toBeTruthy();
    }
  });
});

describe("dayChangeReceipt, version 3 (Story 13.1 AC5, AC12)", () => {
  const renumbered = (itemId: string): MovedItemRow => ({
    ...moved(itemId),
    previousSortOrder: 2,
    fromTime: "10:30",
    toTime: "11:30",
  });
  const ferry = { itemId: "item-f", title: "Fähre", fromTime: "12:00", reachableAt: "12:40" };

  it("round-trips a leg delete, renumbered rows and plan conflicts, and the schema accepts them", () => {
    const receipt: DayChangeReceipt = {
      ...receiptWith([]),
      edited: { kind: "legDeleted", segmentId: "s1", previous: leg("s1") },
      movedItems: [moved("item-2"), renumbered("item-3")],
      planConflicts: [ferry],
    };
    const wire = toDayChangeReceiptWire(receipt);
    expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
    expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
    expect(
      dayChangeReceiptSchema.safeParse(signDayChangeReceipt({ ...wire, planConflicts: [{ ...ferry, extra: 1 }] } as never, BINDING))
        .success,
    ).toBe(false);
  });

  it("refuses a version-2 receipt", () => {
    const wire = signDayChangeReceipt(toDayChangeReceiptWire(receiptWith([])), BINDING);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, version: 2 }).success).toBe(false);
  });

  it("counts only rows whose times changed, never one only renumbered", () => {
    const receipt = { ...receiptWith([]), movedItems: [moved("item-2"), renumbered("item-3"), moved("item-4")] };
    expect(summarizeDayChangeReceipt(receipt, dictionary(de))).toBe("2 Aktivitäten verschoben");
    expect(receiptHasSideEffects({ ...receiptWith([]), movedItems: [renumbered("item-3")] })).toBe(false);
    expect(summarizeDayChangeReceipt({ ...receiptWith([]), movedItems: [renumbered("item-3")] }, dictionary(en))).toBe("");
  });

  it("has side effects when the write made a plan conflict, even with nothing moved", () => {
    expect(receiptHasSideEffects({ ...receiptWith([]), planConflicts: [ferry] })).toBe(true);
    expect(receiptHasSideEffects({ ...receiptWith([]), planConflicts: [] })).toBe(false);
  });

  it("says which fixed activity is reached late, one sentence per conflict, in both languages", () => {
    const receipt = { ...receiptWith([]), planConflicts: [ferry, { ...ferry, itemId: "item-g", title: null, fromTime: "15:00", reachableAt: "15:05" }] };
    expect(planConflictText(receipt, dictionary(de))).toBe(
      "Fähre beginnt um 12:00, erreichbar erst um 12:40 · Aktivität ohne Titel beginnt um 15:00, erreichbar erst um 15:05",
    );
    expect(planConflictText({ ...receiptWith([]), planConflicts: [ferry] }, dictionary(en))).toBe(
      "Fähre starts at 12:00, reachable only at 12:40",
    );
    expect(planConflictText(receiptWith([]), dictionary(en))).toBeUndefined();
  });
});

describe("dayChangeReceipt, dayPlanApplied (Story 15.5)", () => {
  const stamp = (ms: number) => at(`2026-04-01T00:00:00.${String(ms).padStart(3, "0")}Z`);
  const deletedItem = {
    ...itemRow,
    payments: [payment],
    images: [
      {
        id: "img-1",
        dayPlanItemId: "item-1",
        imageUrl: "/uploads/trips/t/x.webp",
        sortOrder: 0,
        createdAt: stamp(1),
        updatedAt: stamp(2),
        aiChangedAt: null,
      },
    ],
    documents: [
      {
        id: "doc-1",
        dayPlanItemId: "item-1",
        documentUrl: "/uploads/trips/t/doc.pdf",
        fileName: "Ticket.pdf",
        sortOrder: 0,
        createdAt: stamp(3),
        updatedAt: stamp(4),
        aiChangedAt: stamp(5),
      },
    ],
  };
  const applied = (mode: "append" | "replace", itemCount: number): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited: {
      kind: "dayPlanApplied",
      mode,
      items: Array.from({ length: itemCount }, (_value, index) => ({ itemId: `new-${index}`, updatedAt: stamp(100 + index) })),
      segments: [{ segmentId: "seg-new", updatedAt: stamp(200) }],
      deletedItems: mode === "replace" ? [deletedItem] : [],
    },
    removedTravelSegments: mode === "replace" ? [leg("s1")] : [],
    movedItems: mode === "append" ? [moved("item-old")] : [],
  });

  it("round-trips both modes through the wire form at version 3, and both schemas accept them", () => {
    for (const receipt of [applied("append", 3), applied("replace", 2)]) {
      const wire = toDayChangeReceiptWire(receipt);
      expect(wire.version).toBe(3);
      expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
      expect(storedDayChangeReceiptSchema.safeParse(wire).success).toBe(true);
      expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
    }
  });

  it("refuses an unknown key or mode, no items, more than 50 items or legs, and a snapshot without its media", () => {
    const wire = toDayChangeReceiptWire(applied("replace", 2));
    if (wire.edited.kind !== "dayPlanApplied") throw new Error("fixture");
    const edited = wire.edited;
    const parse = (next: unknown) => storedDayChangeReceiptSchema.safeParse({ ...wire, edited: next }).success;
    expect(parse(edited)).toBe(true);
    expect(parse({ ...edited, extra: 1 })).toBe(false);
    expect(parse({ ...edited, mode: "merge" })).toBe(false);
    expect(parse({ ...edited, items: [] })).toBe(false);
    expect(parse({ ...edited, items: Array.from({ length: 51 }, () => edited.items[0]) })).toBe(false);
    expect(parse({ ...edited, segments: Array.from({ length: 51 }, () => edited.segments[0]) })).toBe(false);
    const { images: _images, ...withoutImages } = edited.deletedItems[0];
    void _images;
    expect(parse({ ...edited, deletedItems: [withoutImages] })).toBe(false);
  });

  it("always has side effects", () => {
    expect(receiptHasSideEffects({ ...applied("append", 1), movedItems: [] })).toBe(true);
  });

  it("has the notice's plan keys in both dictionaries", () => {
    for (const key of ["trips.aiChanges.planAppended", "trips.aiChanges.planReplaced"]) {
      expect(de[key as keyof typeof de], key).toContain("{title}");
      expect(en[key as keyof typeof en], key).toContain("{title}");
    }
  });
});

describe("dayChangeReceipt, stay kinds (Story 15.6)", () => {
  const stamp = (ms: number) => at(`2026-05-01T00:00:00.${String(ms).padStart(3, "0")}Z`);
  const stayRow = {
    id: "stay-1",
    tripDayId: "day-1",
    name: "Harbour Inn",
    status: "BOOKED" as const,
    costCents: 9259,
    costOriginalAmount: 10000,
    costCurrency: "USD",
    costRate: 1.08,
    costRateDate: "2026-04-30",
    link: "https://inn.example",
    locationLat: 50.1,
    locationLng: 14.4,
    locationLabel: "Harbour",
    notes: "Late arrival",
    checkInTime: "15:00",
    checkOutTime: "10:30",
    createdAt: stamp(1),
    updatedAt: stamp(2),
    aiChangedAt: stamp(2),
  };
  const stayPayment = {
    id: "pay-stay-1",
    accommodationId: "stay-1",
    dayPlanItemId: null,
    amountCents: 9259,
    amountOriginal: 10000,
    dueDate: "2026-05-01",
    sortOrder: 0,
    createdAt: stamp(3),
    updatedAt: stamp(4),
  };
  const previous = { ...stayRow, payments: [stayPayment] };
  const deleted = {
    ...previous,
    images: [
      { id: "simg-1", accommodationId: "stay-1", imageUrl: "/uploads/trips/t/stay.webp", sortOrder: 0, createdAt: stamp(5), updatedAt: stamp(6), aiChangedAt: null },
    ],
    documents: [
      {
        id: "sdoc-1",
        accommodationId: "stay-1",
        documentUrl: "/uploads/trips/t/booking.pdf",
        fileName: "Booking.pdf",
        sortOrder: 0,
        createdAt: stamp(7),
        updatedAt: stamp(8),
        aiChangedAt: stamp(9),
      },
    ],
  };
  const nextDayLeg = { ...leg("s-next"), tripDayId: "day-2" };
  const receipts: DayChangeReceipt[] = [
    {
      version: 3,
      tripDayId: "day-1",
      edited: { kind: "stayCreated", accommodationId: "stay-1", updatedAt: stamp(10) },
      removedTravelSegments: [],
      movedItems: [],
    },
    {
      version: 3,
      tripDayId: "day-2",
      edited: { kind: "stayUpdated", accommodationId: "stay-1", updatedAt: stamp(11), previous },
      removedTravelSegments: [],
      movedItems: [moved("item-next")],
    },
    {
      version: 3,
      tripDayId: "day-1",
      edited: { kind: "stayDeleted", accommodationId: "stay-1", previous: deleted, nextDayId: "day-2", nextDayLegs: [nextDayLeg] },
      removedTravelSegments: [leg("s1")],
      movedItems: [],
    },
  ];

  it("round-trips the three kinds through the wire form at version 3, and both schemas accept them", () => {
    for (const receipt of receipts) {
      const wire = toDayChangeReceiptWire(receipt);
      expect(wire.version).toBe(3);
      expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
      expect(storedDayChangeReceiptSchema.safeParse(wire).success).toBe(true);
      expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
    }
  });

  it("refuses an unknown key, an activity payment, an unknown status, a snapshot without its media and an unsafe link", () => {
    const wire = toDayChangeReceiptWire(receipts[2]);
    if (wire.edited.kind !== "stayDeleted") throw new Error("fixture");
    const edited = wire.edited;
    const parse = (next: unknown) => storedDayChangeReceiptSchema.safeParse({ ...wire, edited: next }).success;
    expect(parse(edited)).toBe(true);
    expect(parse({ ...edited, extra: 1 })).toBe(false);
    expect(parse({ ...edited, previous: { ...edited.previous, payments: [{ ...edited.previous.payments[0], dayPlanItemId: "item-1" }] } })).toBe(false);
    expect(parse({ ...edited, previous: { ...edited.previous, status: "CANCELLED" } })).toBe(false);
    expect(parse({ ...edited, previous: { ...edited.previous, link: "javascript:alert(1)" } })).toBe(false);
    const { images: _images, ...withoutImages } = edited.previous;
    void _images;
    expect(parse({ ...edited, previous: withoutImages })).toBe(false);
    expect(parse({ ...edited, nextDayId: undefined })).toBe(false);
  });

  it("has the notice's stay and leg keys in both dictionaries", () => {
    for (const key of [
      "trips.aiChanges.stayCreated",
      "trips.aiChanges.stayUpdated",
      "trips.aiChanges.stayDeleted",
      "trips.aiChanges.legCreated",
      "trips.aiChanges.legUpdated",
      "trips.aiChanges.legDeleted",
    ]) {
      expect(de[key as keyof typeof de], key).toContain("{title}");
      expect(en[key as keyof typeof en], key).toContain("{title}");
    }
  });
});

describe("dayChangeReceipt, file kinds (Story 15.7)", () => {
  const stamp = (ms: number) => at(`2026-06-01T00:00:00.${String(ms).padStart(3, "0")}Z`);
  const tripId = "trip-files";
  const inTrip = (rest: string) => `/uploads/trips/${tripId}/days/day-1/${rest}`;
  const fileReceipt = (edited: DayChangeReceipt["edited"]): DayChangeReceipt => ({
    version: 3,
    tripDayId: "day-1",
    edited,
    removedTravelSegments: [],
    movedItems: [],
  });
  const attached = fileReceipt({
    kind: "fileAttached",
    target: "activity",
    media: "document",
    parentId: "item-1",
    fileId: "doc-1",
    url: inTrip("day-plan-items/item-1/documents/doc-1.pdf"),
    updatedAt: stamp(1),
  });
  const deletedItemImage = fileReceipt({
    kind: "fileDeleted",
    target: "activity",
    media: "image",
    previous: {
      id: "img-1",
      dayPlanItemId: "item-1",
      imageUrl: inTrip("day-plan-items/item-1/img-1.webp"),
      sortOrder: 2,
      createdAt: stamp(2),
      updatedAt: stamp(3),
      aiChangedAt: null,
    },
  });
  const deletedItemDocument = fileReceipt({
    kind: "fileDeleted",
    target: "activity",
    media: "document",
    previous: {
      id: "doc-2",
      dayPlanItemId: "item-1",
      documentUrl: inTrip("day-plan-items/item-1/documents/doc-2.pdf"),
      fileName: "Ticket.pdf",
      sortOrder: 0,
      createdAt: stamp(4),
      updatedAt: stamp(5),
      aiChangedAt: stamp(5),
    },
  });
  const deletedStayImage = fileReceipt({
    kind: "fileDeleted",
    target: "stay",
    media: "image",
    previous: {
      id: "simg-1",
      accommodationId: "stay-1",
      imageUrl: inTrip("accommodations/stay-1/img-1.png"),
      sortOrder: 1,
      createdAt: stamp(6),
      updatedAt: stamp(7),
      aiChangedAt: null,
    },
  });
  const deletedStayDocument = fileReceipt({
    kind: "fileDeleted",
    target: "stay",
    media: "document",
    previous: {
      id: "sdoc-1",
      accommodationId: "stay-1",
      documentUrl: inTrip("accommodations/stay-1/documents/doc-3.pdf"),
      fileName: "Booking.pdf",
      sortOrder: 3,
      createdAt: stamp(8),
      updatedAt: stamp(9),
      aiChangedAt: stamp(9),
    },
  });
  const receipts = [attached, deletedItemImage, deletedItemDocument, deletedStayImage, deletedStayDocument];

  it("round-trips both kinds, for every target and list, through the wire form at version 3, and both schemas accept them", () => {
    for (const receipt of receipts) {
      const wire = toDayChangeReceiptWire(receipt);
      expect(wire.version).toBe(3);
      expect(fromDayChangeReceiptWire(wire)).toEqual(receipt);
      expect(storedDayChangeReceiptSchema.safeParse(wire).success).toBe(true);
      expect(dayChangeReceiptSchema.safeParse(signDayChangeReceipt(wire, BINDING)).success).toBe(true);
      expect(findInvalidity(receipt, tripId)).toBeNull();
    }
  });

  it("refuses an unknown key, a row of another list or entry type, an unknown target and an external attached URL", () => {
    const parse = (receipt: DayChangeReceipt, edited: unknown) =>
      storedDayChangeReceiptSchema.safeParse({ ...toDayChangeReceiptWire(receipt), edited }).success;
    const attachedWire = toDayChangeReceiptWire(attached).edited;
    expect(parse(attached, { ...attachedWire, extra: 1 })).toBe(false);
    expect(parse(attached, { ...attachedWire, target: "day" })).toBe(false);
    expect(parse(attached, { ...attachedWire, url: "https://files.example/ticket.pdf" })).toBe(false);
    const imageWire = toDayChangeReceiptWire(deletedItemImage).edited;
    if (imageWire.kind !== "fileDeleted") throw new Error("fixture");
    // An activity image row under `media: "document"`, or under a stay: the row type must match both.
    expect(parse(deletedItemImage, { ...imageWire, media: "document" })).toBe(false);
    expect(parse(deletedItemImage, { ...imageWire, target: "stay" })).toBe(false);
    expect(parse(deletedItemImage, { ...imageWire, previous: { ...imageWire.previous, extra: 1 } })).toBe(false);
    const { aiChangedAt: _marker, ...withoutMarker } = imageWire.previous;
    void _marker;
    expect(parse(deletedItemImage, { ...imageWire, previous: withoutMarker })).toBe(false);
  });

  it("is invalid with a moved row, a removed leg, or a file outside the trip; a deleted external image is not", () => {
    expect(findInvalidity({ ...attached, movedItems: [moved("item-2")] }, tripId)).toBe("side effect a file save never has");
    expect(findInvalidity({ ...deletedItemDocument, removedTravelSegments: [leg("l1")] }, tripId)).toBe(
      "side effect a file save never has",
    );
    expect(findInvalidity(attached, "another-trip")).toBe("file outside the trip");
    const traversal = { ...attached, edited: { ...attached.edited, url: `/uploads/trips/${tripId}/../other/doc.pdf` } } as DayChangeReceipt;
    expect(findInvalidity(traversal, tripId)).toBe("file outside the trip");
    expect(findInvalidity(deletedStayDocument, "another-trip")).toBe("file outside the trip");
    if (deletedItemImage.edited.kind !== "fileDeleted" || deletedItemImage.edited.media !== "image") throw new Error("fixture");
    const external = {
      ...deletedItemImage,
      edited: { ...deletedItemImage.edited, previous: { ...deletedItemImage.edited.previous, imageUrl: "https://images.example/x.jpg" } },
    } as DayChangeReceipt;
    expect(findInvalidity(external, tripId)).toBeNull();
  });

  it("has no side effect and no summary part of its own, and the notice's file keys are in both dictionaries", () => {
    for (const receipt of receipts) {
      expect(receiptHasSideEffects(receipt)).toBe(false);
      expect(summarizeDayChangeReceipt(receipt, (key) => en[key as keyof typeof en] ?? key)).toBe("");
    }
    for (const key of ["trips.aiChanges.fileAttached", "trips.aiChanges.fileDeleted"]) {
      expect(de[key as keyof typeof de], key).toContain("{title}");
      expect(en[key as keyof typeof en], key).toContain("{title}");
    }
  });
});
