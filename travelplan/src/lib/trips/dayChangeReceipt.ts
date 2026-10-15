/**
 * Story 11.1. The change receipt: what a day-plan write did beyond the row it was asked to write, and
 * everything needed to take the whole change back in one request.
 *
 * It travels to the client in the write's response and comes back verbatim in the undo request. It is
 * never persisted (AC7), which is why it has to be complete on its own: every swept leg as a full row,
 * the edited item's previous state including the rows a cascade would take with it, and the post-write
 * `updatedAt` of every row the change left in place, so that undo can refuse when the day has moved on.
 *
 * No Prisma import on purpose. The day view imports this module for `receiptHasSideEffects` and the
 * summary, and the client bundle must not pull the generated client in. The enum vocabularies below are
 * the stored (uppercase) spellings: the endpoint type spelled out as literals, the transport type derived
 * from the dependency-free `transportTypes.ts`; `dayChangeReceiptSchemas.ts` is what holds a wire receipt
 * to them.
 *
 * Story 11.2 (version 2) adds the activities the push rule moved (`movedItems`, each with the times and
 * `updatedAt` it had before, so undo can put it back byte for byte) and the optional check-in warning,
 * which travels inside the receipt because the notice renders only what the receipt and the day hold.
 * Undo ignores the warning; the signature covers it like everything else.
 *
 * Story 11.3 adds a fourth edited kind, `reordered`: *Nach oben* / *Nach unten* writes nothing but times,
 * so it names the two activities that traded places and lists both of them in `movedItems` (with every
 * activity the walk pushed after them). Undo restores them through the same moved-items path and has no
 * edited-item write. The union grew additively, so the version stays 2.
 *
 * Story 11.4 adds three more, again additively: a leg save (`legCreated`, `legUpdated` with the full row
 * it replaced) and a later check-out of last night's stay (`stayCheckOutChanged`). Their only side effect
 * is the push, so `removedTravelSegments` is always empty for them. A check-out change pushes the *next*
 * day, so its `tripDayId` is the pushed day, not the stay's. Undo puts back only the check-out and the
 * stay's `updatedAt` (*revert only what caused the side effect*): a save that also renamed the stay keeps
 * the new name and gets its old stamp back, which is the accepted cost of that rule.
 */

import { formatMessage } from "@/i18n";
import type { TransportType } from "@/lib/trips/transportTypes";

export type DayChangeEndpointType = "ACCOMMODATION" | "DAY_PLAN_ITEM";
// Derived from the one vocabulary rather than spelled out, so a mode added there (Story 6.31 added
// TRAIN and BUS) reaches the receipt type without a second list to forget.
export type DayChangeTransportType = Uppercase<TransportType>;

/** `Date` on the server, ISO string on the wire. Every row's only timestamps are these two. */
type Stamped<T extends Date | string> = { createdAt: T; updatedAt: T };

export type TravelSegmentRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  tripDayId: string;
  fromItemType: DayChangeEndpointType;
  fromItemId: string;
  toItemType: DayChangeEndpointType;
  toItemId: string;
  transportType: DayChangeTransportType;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
};

export type CostPaymentRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  accommodationId: string | null;
  dayPlanItemId: string | null;
  amountCents: number;
  amountOriginal: number | null;
  dueDate: string;
  sortOrder: number;
};

export type DayPlanItemRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  tripDayId: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  linkUrl: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
};

export type DayPlanItemImageRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  dayPlanItemId: string;
  imageUrl: string;
  sortOrder: number;
};

export type DayPlanItemDocumentRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  dayPlanItemId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
};

export type TripBucketListItemRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  positionText: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
};

/** Every `DayPlanItem` column plus its payments in `sortOrder` — PATCH replaces payments wholesale. */
export type DayPlanItemSnapshot<T extends Date | string = Date> = DayPlanItemRow<T> & {
  payments: CostPaymentRow<T>[];
};

/** A deleted item also loses its media rows through the cascade, so its snapshot carries them. */
export type DeletedDayPlanItemSnapshot<T extends Date | string = Date> = DayPlanItemSnapshot<T> & {
  images: DayPlanItemImageRow<T>[];
  documents: DayPlanItemDocumentRow<T>[];
};

/** The `updatedAt` on `created` and `updated` is the item *after* the write: what undo compares against. */
export type DayChangeEdited<T extends Date | string = Date> =
  | { kind: "created"; itemId: string; updatedAt: T }
  | { kind: "updated"; itemId: string; updatedAt: T; previous: DayPlanItemSnapshot<T> }
  | { kind: "deleted"; previous: DeletedDayPlanItemSnapshot<T> }
  /** Story 11.3. `itemId` is the activity the user moved; both rows are always in `movedItems`. */
  | { kind: "reordered"; itemId: string; neighbourId: string }
  /** Story 11.4. A new leg; `updatedAt` is its post-write stamp. */
  | { kind: "legCreated"; segmentId: string; updatedAt: T }
  /** Story 11.4. `previous` is the whole stored row before the write, stamps included. */
  | { kind: "legUpdated"; segmentId: string; updatedAt: T; previous: TravelSegmentRow<T> }
  /** Story 11.4. `previousCheckOutTime` is the stored value, not the resolved one. */
  | {
      kind: "stayCheckOutChanged";
      accommodationId: string;
      updatedAt: T;
      previousUpdatedAt: T;
      previousCheckOutTime: string | null;
    };

/**
 * Story 11.2. An activity the push rule moved: its times before the change, and its `updatedAt` before
 * and after. Undo refuses when `updatedAt` no longer matches, and writes `previousUpdatedAt` back.
 */
export type MovedItemRow<T extends Date | string = Date> = {
  itemId: string;
  previousFromTime: string | null;
  previousToTime: string | null;
  previousUpdatedAt: T;
  updatedAt: T;
};

/** Story 11.2 AC9. The day's stay has an explicit check-in that the pushed day now reaches too late. */
export type DayChangeCheckInWarning = { accommodationId: string; checkInTime: string };

export type DayChangeReceipt<T extends Date | string = Date> = {
  version: 2;
  tripDayId: string;
  edited: DayChangeEdited<T>;
  removedTravelSegments: TravelSegmentRow<T>[];
  /** Always present, empty when nothing moved (DELETE never moves anything). */
  movedItems: MovedItemRow<T>[];
  consumedBucketListItem?: TripBucketListItemRow<T>;
  checkInWarning?: DayChangeCheckInWarning;
};

export type DayChangeReceiptWire = DayChangeReceipt<string>;

/**
 * What the write routes send and the undo route accepts: the wire receipt sealed with the server's MAC
 * (`dayChangeReceiptSignature.ts`). The client treats it as opaque and sends it back verbatim.
 */
export type SignedDayChangeReceiptWire = DayChangeReceiptWire & { signature: string };

const mapStamps = <R extends Stamped<A>, A extends Date | string, B extends Date | string>(
  row: R,
  convert: (value: A) => B,
): Omit<R, "createdAt" | "updatedAt"> & Stamped<B> => ({
  ...row,
  createdAt: convert(row.createdAt),
  updatedAt: convert(row.updatedAt),
});

const mapReceipt = <A extends Date | string, B extends Date | string>(
  receipt: DayChangeReceipt<A>,
  convert: (value: A) => B,
): DayChangeReceipt<B> => {
  const snapshot = (previous: DayPlanItemSnapshot<A>): DayPlanItemSnapshot<B> => ({
    ...mapStamps(previous, convert),
    payments: previous.payments.map((payment) => mapStamps(payment, convert)),
  });

  let edited: DayChangeEdited<B>;
  switch (receipt.edited.kind) {
    case "created":
      edited = { ...receipt.edited, updatedAt: convert(receipt.edited.updatedAt) };
      break;
    case "updated":
      edited = {
        ...receipt.edited,
        updatedAt: convert(receipt.edited.updatedAt),
        previous: snapshot(receipt.edited.previous),
      };
      break;
    case "deleted":
      edited = {
        kind: "deleted",
        previous: {
          ...snapshot(receipt.edited.previous),
          images: receipt.edited.previous.images.map((image) => mapStamps(image, convert)),
          documents: receipt.edited.previous.documents.map((document) => mapStamps(document, convert)),
        },
      };
      break;
    case "reordered":
      edited = { ...receipt.edited };
      break;
    case "legCreated":
      edited = { ...receipt.edited, updatedAt: convert(receipt.edited.updatedAt) };
      break;
    case "legUpdated":
      edited = {
        ...receipt.edited,
        updatedAt: convert(receipt.edited.updatedAt),
        previous: mapStamps(receipt.edited.previous, convert),
      };
      break;
    case "stayCheckOutChanged":
      edited = {
        ...receipt.edited,
        updatedAt: convert(receipt.edited.updatedAt),
        previousUpdatedAt: convert(receipt.edited.previousUpdatedAt),
      };
      break;
    default: {
      const unhandled: never = receipt.edited;
      throw new Error(`Unhandled receipt kind: ${String(unhandled)}`);
    }
  }

  return {
    version: receipt.version,
    tripDayId: receipt.tripDayId,
    edited,
    removedTravelSegments: receipt.removedTravelSegments.map((segment) => mapStamps(segment, convert)),
    movedItems: receipt.movedItems.map((moved) => ({
      ...moved,
      previousUpdatedAt: convert(moved.previousUpdatedAt),
      updatedAt: convert(moved.updatedAt),
    })),
    ...(receipt.consumedBucketListItem
      ? { consumedBucketListItem: mapStamps(receipt.consumedBucketListItem, convert) }
      : {}),
    ...(receipt.checkInWarning ? { checkInWarning: { ...receipt.checkInWarning } } : {}),
  };
};

export const toDayChangeReceiptWire = (receipt: DayChangeReceipt): DayChangeReceiptWire =>
  mapReceipt(receipt, (value: Date) => value.toISOString());

/** The caller has validated the wire form; every date string here parses. */
export const fromDayChangeReceiptWire = (receipt: DayChangeReceiptWire): DayChangeReceipt =>
  mapReceipt(receipt, (value: string) => new Date(value));

/**
 * A removed leg (Story 11.1) or a moved activity (Story 11.2). The check-in warning only follows a move.
 * A reorder (Story 11.3) always has side effects: it changes two activities' times by itself.
 */
export const receiptHasSideEffects = <T extends Date | string>(receipt: DayChangeReceipt<T>): boolean =>
  receipt.edited.kind === "reordered" || receipt.removedTravelSegments.length > 0 || receipt.movedItems.length > 0;

/**
 * The notice's summary line. One part per kind of side effect, joined with `" · "`. The singular has
 * its own key because `formatMessage` has no plural rules (the `statusGap`/`statusGapOne` convention).
 * A reorder leads with "order changed", and its moved count leaves out the pair, which that part covers.
 *
 * Story 11.4 AC11: `otherDayIndex` is set when the receipt's day is not the one being viewed (a
 * check-out change that pushed the next day); the moved part then names that day.
 */
export const summarizeDayChangeReceipt = <T extends Date | string>(
  receipt: DayChangeReceipt<T>,
  t: (key: string) => string,
  options: { otherDayIndex?: number } = {},
): string => {
  const parts: string[] = [];
  const { edited } = receipt;
  let movedItems = receipt.movedItems;
  if (edited.kind === "reordered") {
    parts.push(t("trips.dayChange.reordered"));
    movedItems = movedItems.filter((row) => row.itemId !== edited.itemId && row.itemId !== edited.neighbourId);
  }
  const movedCount = movedItems.length;
  const { otherDayIndex } = options;
  if (otherDayIndex !== undefined && movedCount > 0) {
    parts.push(
      movedCount === 1
        ? formatMessage(t("trips.dayChange.itemsMovedOnDayOne"), { day: otherDayIndex })
        : formatMessage(t("trips.dayChange.itemsMovedOnDay"), { count: movedCount, day: otherDayIndex }),
    );
  } else if (movedCount === 1) {
    parts.push(t("trips.dayChange.itemsMovedOne"));
  } else if (movedCount > 1) {
    parts.push(formatMessage(t("trips.dayChange.itemsMoved"), { count: movedCount }));
  }
  const legCount = receipt.removedTravelSegments.length;
  if (legCount === 1) {
    parts.push(t("trips.dayChange.legsRemovedOne"));
  } else if (legCount > 1) {
    parts.push(formatMessage(t("trips.dayChange.legsRemoved"), { count: legCount }));
  }
  return parts.join(" · ");
};

/** Story 11.2 AC9. The notice's warning line, or `undefined` when the receipt carries no warning. */
export const checkInWarningText = <T extends Date | string>(
  receipt: DayChangeReceipt<T>,
  t: (key: string) => string,
): string | undefined =>
  receipt.checkInWarning
    ? formatMessage(t("trips.dayChange.checkInWarning"), { time: receipt.checkInWarning.checkInTime })
    : undefined;
