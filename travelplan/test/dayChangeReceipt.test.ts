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
import { fromPrismaItemType } from "@/lib/repositories/travelSegmentRepo";
import { signDayChangeReceipt, verifyDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayChangeReceiptSchema } from "@/lib/validation/dayChangeReceiptSchemas";

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
    edited: { kind: "reordered", itemId: "item-b", neighbourId: "item-a" },
    removedTravelSegments: legs,
    movedItems: [moved("item-b"), moved("item-a"), ...extra],
  });

  it("round-trips through the wire form, at version 3 since Story 13.1, and the schema accepts it", () => {
    const receipt = reordered([moved("item-c")], [leg("s1")]);
    const wire = toDayChangeReceiptWire(receipt);
    expect(wire.version).toBe(3) // Story 13.1: every receipt is version 3;
    expect(wire.edited).toEqual({ kind: "reordered", itemId: "item-b", neighbourId: "item-a" });
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
