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
 * `updatedAt` it had before, so undo can put it back byte for byte). It also carried an optional check-in
 * warning, which Story 13.2 removed (see below).
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
 *
 * Story 12.4 adds `suggestionsApplied`: the activities, legs and image rows one apply of picked AI
 * suggestions created, each activity and leg with its post-write `updatedAt`. Undo removes all of them
 * (and the image files) in one request and restores any leg the apply swept. Additive, so still version 2.
 *
 * Story 13.1 (version 3). The day's order is stored (`sortOrder`) and every write recomputes the day, so a
 * write can renumber rows whose times stay put: `movedItems` lists every row whose times **or** order
 * changed, with `previousSortOrder`, and its new times so the notice counts only rows that visibly moved.
 * The item snapshots carry `scheduleMode`, `durationMinutes` and `sortOrder`, so undo of an edit or a
 * delete restores how the activity was planned. A leg delete now recomputes too, and gets its own kind,
 * `legDeleted`. `planConflicts` names the fixed activities this write made unreachable in time; it is for
 * the notice only, and undo ignores it. A version-2 receipt is refused.
 *
 * Story 14.1 adds `scheduled`: "+" on a bucket-list row moved the parked activity itself onto the day
 * (same id, everything attached). Undo parks it again with its previous `updatedAt`. The bucket-list
 * row copy that a create used to carry (`consumedBucketListItem`) is gone with the table: there is
 * nothing to recreate, because nothing was consumed. Additive otherwise, so the version stays 3; a
 * receipt that still carries the old field is refused by the schema.
 *
 * Story 14.2 adds `parked`, the reverse: *Parken* took the activity off the day (same row, `tripDayId`
 * null, FLEXIBLE, no times) and the day was recomputed around the gap. `previous` holds the schedule
 * columns it had on the day, which undo writes back with its old stamp; everything attached stayed on
 * the row, so there is nothing else to restore. Additive, so the version stays 3.
 *
 * Story 13.2 removes the check-in warning: arriving at the night's stay after its check-in is no longer a
 * warning, and a write past 23:59 is saved instead of refused. A row that lost its times is a time change,
 * so it is in `movedItems` with its previous times and undo restores it. Removed without a bump, as 14.1
 * did: a receipt that still carries the field is refused by the `.strict()` schema (400).
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

/** Story 13.1. The stored spelling of `DayPlanItemScheduleMode`, spelled out to keep Prisma out of the bundle. */
export type DayChangeScheduleMode = "FLEXIBLE" | "FIXED";

export type DayPlanItemRow<T extends Date | string = Date> = Stamped<T> & {
  id: string;
  tripDayId: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  scheduleMode: DayChangeScheduleMode;
  durationMinutes: number;
  sortOrder: number;
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
  /** Story 13.1. The deleted leg in full; undo re-creates it with its id and stamps. */
  | { kind: "legDeleted"; segmentId: string; previous: TravelSegmentRow<T> }
  /** Story 11.4. `previousCheckOutTime` is the stored value, not the resolved one. */
  | {
      kind: "stayCheckOutChanged";
      accommodationId: string;
      updatedAt: T;
      previousUpdatedAt: T;
      previousCheckOutTime: string | null;
    }
  /**
   * Story 14.1. A parked activity moved onto the day. `updatedAt` is its post-write stamp,
   * `previousUpdatedAt` the stamp it had parked, which undo writes back.
   */
  | { kind: "scheduled"; itemId: string; updatedAt: T; previousUpdatedAt: T }
  /**
   * Story 14.2. An activity moved off the day into the bucket list. `updatedAt` is its post-park stamp;
   * `previous` is where and how it was planned, which undo writes back (the receipt's `tripDayId` is
   * that day too).
   */
  | {
      kind: "parked";
      itemId: string;
      updatedAt: T;
      previous: {
        tripDayId: string;
        scheduleMode: DayChangeScheduleMode;
        durationMinutes: number;
        sortOrder: number;
        fromTime: string | null;
        toTime: string | null;
        updatedAt: T;
      };
    }
  /**
   * Story 13.3. *Alle flexibel machen*: every FIXED activity of the day became FLEXIBLE, order unchanged.
   * `updatedAt` is each row's post-write stamp; `previous` is what undo writes back (the mode was always
   * FIXED, so it is not stored). These rows are never also in `movedItems`.
   */
  | {
      kind: "madeFlexible";
      items: Array<{
        itemId: string;
        updatedAt: T;
        previous: { durationMinutes: number; fromTime: string | null; toTime: string | null; sortOrder: number; updatedAt: T };
      }>;
    }
  /** Story 12.4. Everything one apply of picked suggestions created; `updatedAt` is each row's post-write stamp. */
  | {
      kind: "suggestionsApplied";
      items: { itemId: string; updatedAt: T }[];
      segments: { segmentId: string; updatedAt: T }[];
      imageIds: string[];
      /** Story 14.3. The ones parked to the bucket list in the same apply; absent when none was. */
      parkedItems?: { itemId: string; updatedAt: T }[];
    };

/**
 * Story 11.2. An activity the write moved: its times before the change, and its `updatedAt` before and
 * after. Undo refuses when `updatedAt` no longer matches, and writes the previous values back. Story 13.1:
 * also a row only renumbered (`previousSortOrder`); `fromTime`/`toTime` are the times after the write, so
 * the notice can tell the two apart.
 */
export type MovedItemRow<T extends Date | string = Date> = {
  itemId: string;
  previousFromTime: string | null;
  previousToTime: string | null;
  previousSortOrder: number;
  fromTime: string | null;
  toTime: string | null;
  previousUpdatedAt: T;
  updatedAt: T;
};

/** Story 13.1 AC5. A fixed activity the day now reaches only at `reachableAt`, after its `fromTime`. */
export type DayChangePlanConflict = { itemId: string; title: string | null; fromTime: string; reachableAt: string };

export type DayChangeReceipt<T extends Date | string = Date> = {
  version: 3;
  tripDayId: string;
  edited: DayChangeEdited<T>;
  removedTravelSegments: TravelSegmentRow<T>[];
  /** Always present, empty when nothing moved (DELETE never moves anything). */
  movedItems: MovedItemRow<T>[];
  /** Story 13.1. Only conflicts this write made; absent when there are none. */
  planConflicts?: DayChangePlanConflict[];
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
    case "legDeleted":
      edited = { ...receipt.edited, previous: mapStamps(receipt.edited.previous, convert) };
      break;
    case "stayCheckOutChanged":
      edited = {
        ...receipt.edited,
        updatedAt: convert(receipt.edited.updatedAt),
        previousUpdatedAt: convert(receipt.edited.previousUpdatedAt),
      };
      break;
    case "scheduled":
      edited = {
        ...receipt.edited,
        updatedAt: convert(receipt.edited.updatedAt),
        previousUpdatedAt: convert(receipt.edited.previousUpdatedAt),
      };
      break;
    case "parked":
      edited = {
        ...receipt.edited,
        updatedAt: convert(receipt.edited.updatedAt),
        previous: { ...receipt.edited.previous, updatedAt: convert(receipt.edited.previous.updatedAt) },
      };
      break;
    case "madeFlexible":
      edited = {
        kind: "madeFlexible",
        items: receipt.edited.items.map((item) => ({
          ...item,
          updatedAt: convert(item.updatedAt),
          previous: { ...item.previous, updatedAt: convert(item.previous.updatedAt) },
        })),
      };
      break;
    case "suggestionsApplied":
      edited = {
        kind: "suggestionsApplied",
        items: receipt.edited.items.map((item) => ({ ...item, updatedAt: convert(item.updatedAt) })),
        segments: receipt.edited.segments.map((segment) => ({ ...segment, updatedAt: convert(segment.updatedAt) })),
        imageIds: [...receipt.edited.imageIds],
        // Omitted when absent: a signed receipt is compared as JSON.
        ...(receipt.edited.parkedItems
          ? { parkedItems: receipt.edited.parkedItems.map((item) => ({ ...item, updatedAt: convert(item.updatedAt) })) }
          : {}),
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
    ...(receipt.planConflicts ? { planConflicts: receipt.planConflicts.map((conflict) => ({ ...conflict })) } : {}),
  };
};

export const toDayChangeReceiptWire = (receipt: DayChangeReceipt): DayChangeReceiptWire =>
  mapReceipt(receipt, (value: Date) => value.toISOString());

/** The caller has validated the wire form; every date string here parses. */
export const fromDayChangeReceiptWire = (receipt: DayChangeReceiptWire): DayChangeReceipt =>
  mapReceipt(receipt, (value: string) => new Date(value));

/** Story 13.1. A moved row whose times changed, as opposed to one only renumbered. */
const movedTimes = <T extends Date | string>(row: MovedItemRow<T>) =>
  row.previousFromTime !== row.fromTime || row.previousToTime !== row.toTime;

/**
 * A removed leg (Story 11.1) or a moved activity (Story 11.2); since Story 13.2 also one that lost its times.
 * A reorder (Story 11.3) always has side effects: it changes two activities' times by itself. So does an
 * apply of suggestions (Story 12.4): it writes several rows at once, and its notice is the only undo.
 * Story 13.1: a new plan conflict too, or a plain create that runs into a ferry would show no notice. A
 * row only renumbered is not a side effect anyone sees; it is still in `movedItems` for undo.
 * Story 14.1: scheduling an idea always has one: it left the bucket list, and its notice is the only
 * way to take that back, even when nothing on the day moved.
 * Story 14.2: so does parking one, for the same reason in the other direction.
 * Story 13.3: *Alle flexibel machen* always has one: the day's modes changed, and the notice is its undo.
 */
export const receiptHasSideEffects = <T extends Date | string>(receipt: DayChangeReceipt<T>): boolean =>
  receipt.edited.kind === "reordered" ||
  receipt.edited.kind === "madeFlexible" ||
  receipt.edited.kind === "scheduled" ||
  receipt.edited.kind === "parked" ||
  receipt.edited.kind === "suggestionsApplied" ||
  receipt.removedTravelSegments.length > 0 ||
  receipt.movedItems.some(movedTimes) ||
  (receipt.planConflicts?.length ?? 0) > 0;

/** Story 14.3. "2 geparkt", "1 geparkt". */
const summarizeSuggestionsParked = (count: number, t: (key: string) => string) =>
  count === 1 ? t("trips.dayChange.suggestionsParkedOne") : formatMessage(t("trips.dayChange.suggestionsParked"), { count });

/** Story 12.4. "4 activities and 3 travel legs added", or "1 activity added" when no leg was created. */
const summarizeSuggestionsApplied = (itemCount: number, legCount: number, t: (key: string) => string) => {
  if (legCount === 0) {
    return itemCount === 1
      ? t("trips.dayChange.activitiesAddedOne")
      : formatMessage(t("trips.dayChange.activitiesAdded"), { count: itemCount });
  }
  const activities =
    itemCount === 1
      ? t("trips.dayChange.activityCountOne")
      : formatMessage(t("trips.dayChange.activityCount"), { count: itemCount });
  const legs =
    legCount === 1 ? t("trips.dayChange.legCountOne") : formatMessage(t("trips.dayChange.legCount"), { count: legCount });
  return formatMessage(t("trips.dayChange.activitiesAndLegsAdded"), { activities, legs });
};

/**
 * The notice's summary line. One part per kind of side effect, joined with `" · "`. The singular has
 * its own key because `formatMessage` has no plural rules (the `statusGap`/`statusGapOne` convention).
 * A reorder leads with "order changed", and its moved count leaves out the pair, which that part covers.
 *
 * Story 11.4 AC11: `otherDayIndex` is set when the receipt's day is not the one being viewed (a
 * check-out change that pushed the next day); the moved part then names that day.
 *
 * Story 14.1: a `scheduled` receipt leads with „{title}" eingeplant. The receipt carries no title, so
 * the caller passes it as `itemTitle`, as it passes `otherDayIndex`.
 *
 * Story 14.2: a `parked` receipt leads with „{title}" geparkt, from the same `itemTitle`.
 *
 * Story 13.3: a `madeFlexible` receipt leads with "N Aktivitäten flexibel gemacht"; the converted rows are
 * never in `movedItems`, so the moved count that follows is the other rows'.
 *
 * Story 14.3: a `suggestionsApplied` receipt with `parkedItems` adds "N geparkt" after the added part.
 */
export const summarizeDayChangeReceipt = <T extends Date | string>(
  receipt: DayChangeReceipt<T>,
  t: (key: string) => string,
  options: { otherDayIndex?: number; itemTitle?: string | null } = {},
): string => {
  const parts: string[] = [];
  const { edited } = receipt;
  if (edited.kind === "scheduled" || edited.kind === "parked") {
    parts.push(
      formatMessage(t(edited.kind === "scheduled" ? "trips.dayChange.scheduled" : "trips.dayChange.parked"), {
        title: options.itemTitle?.trim() || t("trips.plan.untitledActivity"),
      }),
    );
  }
  // Story 13.1: rows whose times changed, never one only renumbered.
  let movedItems = receipt.movedItems.filter(movedTimes);
  if (edited.kind === "suggestionsApplied") {
    // Story 14.3: an all-parked apply added nothing to the day, so it reads only "2 geparkt".
    if (edited.items.length > 0) {
      parts.push(summarizeSuggestionsApplied(edited.items.length, edited.segments.length, t));
    }
    const parkedCount = edited.parkedItems?.length ?? 0;
    if (parkedCount > 0) parts.push(summarizeSuggestionsParked(parkedCount, t));
  }
  if (edited.kind === "madeFlexible") {
    const count = edited.items.length;
    parts.push(count === 1 ? t("trips.dayChange.madeFlexibleOne") : formatMessage(t("trips.dayChange.madeFlexible"), { count }));
  }
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

/**
 * Story 13.1 AC5. One sentence per new plan conflict, joined with `" · "`, or `undefined` when there is
 * none: "Fähre beginnt um 12:00, erreichbar erst um 12:40". An untitled activity uses the dialog's
 * untitled label.
 */
export const planConflictText = <T extends Date | string>(
  receipt: DayChangeReceipt<T>,
  t: (key: string) => string,
): string | undefined => {
  const conflicts = receipt.planConflicts ?? [];
  if (conflicts.length === 0) return undefined;
  return conflicts
    .map((conflict) =>
      formatMessage(t("trips.dayChange.planConflict"), {
        title: conflict.title?.trim() || t("trips.plan.untitledActivity"),
        start: conflict.fromTime,
        reachable: conflict.reachableAt,
      }),
    )
    .join(" · ");
};
