import { describe, expect, it } from "vitest";
import de from "@/i18n/de";
import en from "@/i18n/en";
import {
  checkInWarningText,
  fromDayChangeReceiptWire,
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
  version: 2,
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

  it("formats the check-in warning, and has none without one", () => {
    const warned = { ...receiptWith([]), movedItems: [moved("item-2")], checkInWarning: { accommodationId: "stay-1", checkInTime: "17:30" } };
    expect(checkInWarningText(warned, dictionary(de))).toBe("Die Ankunft in der Unterkunft liegt nach dem Check-in um 17:30.");
    expect(checkInWarningText(warned, dictionary(en))).toBe("You will reach your stay after its 17:30 check-in.");
    expect(checkInWarningText(receiptWith([]), dictionary(en))).toBeUndefined();
  });

  it("refuses a moved row with an unknown key and a warning with an unknown key", () => {
    const wire = signDayChangeReceipt(
      toDayChangeReceiptWire({
        ...receiptWith([]),
        movedItems: [moved("item-2")],
        checkInWarning: { accommodationId: "stay-1", checkInTime: "17:30" },
      }),
      BINDING,
    );
    expect(dayChangeReceiptSchema.safeParse(wire).success).toBe(true);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, movedItems: [{ ...wire.movedItems[0], fromTime: "x" }] }).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, checkInWarning: { ...wire.checkInWarning, extra: 1 } }).success).toBe(false);
    expect(dayChangeReceiptSchema.safeParse({ ...wire, version: 1 }).success).toBe(false);
  });
});

describe("dayChangeReceipt, reordered (Story 11.3)", () => {
  const reordered = (extra: MovedItemRow[] = [], legs: TravelSegmentRow[] = []): DayChangeReceipt => ({
    version: 2,
    tripDayId: "day-1",
    edited: { kind: "reordered", itemId: "item-b", neighbourId: "item-a" },
    removedTravelSegments: legs,
    movedItems: [moved("item-b"), moved("item-a"), ...extra],
  });

  it("round-trips through the wire form, still at version 2, and the schema accepts it", () => {
    const receipt = reordered([moved("item-c")], [leg("s1")]);
    const wire = toDayChangeReceiptWire(receipt);
    expect(wire.version).toBe(2);
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
        version: 2,
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
        version: 2,
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
      {
        ...receiptWith([]),
        consumedBucketListItem: {
          id: "idea-1",
          tripId: "trip-1",
          title: "Idea",
          description: null,
          positionText: null,
          locationLat: null,
          locationLng: null,
          locationLabel: null,
          createdAt: at("2026-01-01T00:00:00.009Z"),
          updatedAt: at("2026-01-01T00:00:00.010Z"),
        },
      },
      // Story 11.2: moved items (one an imported row with a null end) and the check-in warning.
      {
        ...receiptWith([leg("s1")]),
        movedItems: [moved("item-2"), { ...moved("item-3"), previousToTime: null }],
        checkInWarning: { accommodationId: "stay-1", checkInTime: "17:30" },
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
