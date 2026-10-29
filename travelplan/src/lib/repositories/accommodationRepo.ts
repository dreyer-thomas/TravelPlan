import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { type PaymentDetail, toPaymentDetails } from "@/lib/repositories/paymentDetail";
import {
  buildStoredSegmentPairKey,
  readDrawnSegmentKeysInTransaction,
  removeTravelSegmentsReferencingItemInTransaction,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import {
  applyScheduleChangesInTransaction,
  buildReceipt,
  planDaySchedule,
  readScheduleInputInTransaction,
  toPlanConflicts,
  type DaySchedulePlan,
} from "@/lib/repositories/dayScheduleTransaction";
import type { DayChangeReceipt, StaySnapshot } from "@/lib/trips/dayChangeReceipt";
import { resolveCheckOutTime } from "@/lib/trips/stayTimes";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";
import {
  aiChangedAtFor,
  ChangedSinceReadError,
  type InTransactionHook,
  type WriteOrigin,
} from "@/lib/trips/writeOrigin";

/**
 * Story 10.1. `amountOriginal` is the typed amount in the entry's currency, in hundredths, and a euro
 * row - which is every row that existed before this story - has none.
 *
 * Optional on the way **in** so that the dozens of existing EUR callers and fixtures stay valid
 * unchanged, and optional on the way **out** for the same reason: see `paymentDetail.ts` for why a
 * euro row omits the field rather than carrying `null` (AC4).
 */
type PaymentInput = { amountCents: number; dueDate: string; amountOriginal?: number | null };

export type AccommodationDetail = {
  id: string;
  tripDayId: string;
  name: string;
  notes: string | null;
  status: AccommodationStatus;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: PaymentDetail[];
  link: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
};

export type AccommodationStatus = "planned" | "booked";

/**
 * Story 11.4: `receipt` is present exactly when the update ran the walk on the next day (a later resolved
 * check-out, and a next day exists). Since Story 13.2 the walk never refuses.
 */
export type AccommodationUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; accommodation: AccommodationDetail; receipt?: DayChangeReceipt };

export type AccommodationCopyResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "copied"; accommodation: AccommodationDetail };

type AccommodationMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  name: string;
  status: AccommodationStatus;
  costCents?: number | null;
  costOriginalAmount?: number | null;
  costCurrency?: string | null;
  costRate?: number | null;
  costRateDate?: string | null;
  payments?: PaymentInput[] | null;
  link?: string | null;
  notes?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  location?: { lat: number; lng: number; label?: string | null } | null;
  /** Story 15.4. `"ai"` marks the stay, `"user"` clears the mark. */
  origin: WriteOrigin;
  /**
   * Story 15.6. The connector's record, called last in the write's transaction with a connector receipt
   * (`stayCreated` / `stayUpdated`) and the stay's id. The receipt is built only when a hook is given; the
   * route's return value never changes.
   */
  inTransaction?: InTransactionHook;
};

/**
 * Story 15.6. The connector's create never upserts over a stay: with `expectNoStay`, a stay that appeared
 * between its read and the write throws `ChangedSinceReadError` inside the transaction.
 */
type AccommodationCreateParams = AccommodationMutationParams & { expectNoStay?: true };

/** Story 15.6. `expectedUpdatedAt`: the stamp the caller read, checked inside the transaction. */
type AccommodationUpdateParams = AccommodationMutationParams & { expectedUpdatedAt?: Date };

type AccommodationDeleteParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  /** Story 15.6. As for the update; with either option the stay is read and checked inside the transaction. */
  expectedUpdatedAt?: Date;
  inTransaction?: InTransactionHook;
};

/** Story 15.6. A unique-index refusal (Prisma's P2002), by its code. */
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** `updatedAt` by epoch milliseconds, never by `Date` identity. */
const sameInstant = (left: Date, right: Date) => left.getTime() === right.getTime();

const storedRowOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

/** Story 15.6. The stay row with its payments as the receipt snapshots it, read through `tx`. */
const readStaySnapshotInTransaction = async (
  tx: TransactionClient,
  stay: Omit<StaySnapshot, "payments">,
): Promise<StaySnapshot> => ({
  ...stay,
  payments: await tx.costPayment.findMany({ where: { accommodationId: stay.id }, orderBy: storedRowOrder }),
});

/** Story 15.6. The day after the stay's (the smallest higher `dayIndex`): the day its check-out starts. */
const findNextTripDayIdInTransaction = async (tx: TransactionClient, tripId: string, stayTripDayId: string) => {
  const stayDay = await tx.tripDay.findUnique({ where: { id: stayTripDayId }, select: { dayIndex: true } });
  if (!stayDay) return null;
  const nextDay = await tx.tripDay.findFirst({
    where: { tripId, dayIndex: { gt: stayDay.dayIndex } },
    orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
    select: { id: true },
  });
  return nextDay?.id ?? null;
};

export type AccommodationImageDetail = {
  id: string;
  accommodationId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type AccommodationImageScopeParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  accommodationId: string;
};

type AccommodationImageCreateParams = AccommodationImageScopeParams & {
  imageUrl: string;
  /** Story 15.4. Marks (or leaves unmarked) the new image row. */
  origin: WriteOrigin;
};

type AccommodationImageDeleteParams = AccommodationImageScopeParams & {
  imageId: string;
};

type AccommodationImageReorderParams = AccommodationImageScopeParams & {
  order: { imageId: string; sortOrder: number }[];
};

export type AccommodationImageDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

export type AccommodationImageReorderResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "reordered" };

export type AccommodationDocumentDetail = {
  id: string;
  accommodationId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type AccommodationDocumentCreateParams = AccommodationImageScopeParams & {
  documentUrl: string;
  fileName: string;
  /** Story 15.4. Marks (or leaves unmarked) the new document row. */
  origin: WriteOrigin;
};

type AccommodationDocumentDeleteParams = AccommodationImageScopeParams & {
  documentId: string;
};

/**
 * Three outcomes rather than the images' `Detail | null`, because the create has three answers to
 * give: the entry is not this user's to write to, the entry is full, or here is the row. Folding
 * "full" into `null` would have the route answer 404 for a document the caller can see, and folding
 * it into a thrown error would make the cap an exception rather than a rule.
 */
export type AccommodationDocumentCreateResult =
  | { status: "not_found" }
  | { status: "limit_reached" }
  | { status: "created"; document: AccommodationDocumentDetail };

export type AccommodationDocumentDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

const findTripDayForTripWriter = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
  });

const findScopedAccommodation = async ({ userId, tripId, tripDayId, accommodationId }: AccommodationImageScopeParams) =>
  prisma.accommodation.findFirst({
    where: {
      id: accommodationId,
      tripDayId,
      tripDay: {
        id: tripDayId,
        tripId,
        // The writer clause, identical to `findTripDayForTripWriter` above. Story 5.13 widened it from
        // `trip: { userId }`: a contributor may create and delete the stay itself, so refusing her the
        // photos and documents hanging off it was chronology (Story 2.16 predates the role), not a rule.
        // The explicit `role: "CONTRIBUTOR"` is load-bearing - the role-agnostic spelling twenty lines
        // below is the *participant read* scope and admits viewers.
        trip: {
          OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
        },
      },
    },
    select: { id: true },
  });

const findScopedAccommodationForTripParticipant = async ({
  userId,
  tripId,
  tripDayId,
  accommodationId,
}: AccommodationImageScopeParams) =>
  prisma.accommodation.findFirst({
    where: {
      id: accommodationId,
      tripDayId,
      tripDay: {
        id: tripDayId,
        tripId,
        trip: {
          OR: [{ userId }, { members: { some: { userId } } }],
        },
      },
    },
    select: { id: true },
  });

const toImageDetail = (image: {
  id: string;
  accommodationId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): AccommodationImageDetail => ({
  id: image.id,
  accommodationId: image.accommodationId,
  imageUrl: image.imageUrl,
  sortOrder: image.sortOrder,
  createdAt: image.createdAt,
  updatedAt: image.updatedAt,
});

const toDocumentDetail = (document: {
  id: string;
  accommodationId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): AccommodationDocumentDetail => ({
  id: document.id,
  accommodationId: document.accommodationId,
  documentUrl: document.documentUrl,
  fileName: document.fileName,
  sortOrder: document.sortOrder,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

const toStatus = (status: string): AccommodationStatus => (status === "BOOKED" ? "booked" : "planned");
const toDbStatus = (status: AccommodationStatus) => (status === "booked" ? ("BOOKED" as const) : ("PLANNED" as const));

const toDetail = (accommodation: {
  id: string;
  tripDayId: string;
  name: string;
  notes: string | null;
  status: string;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments?: PaymentDetail[];
  link: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}) => ({
  id: accommodation.id,
  tripDayId: accommodation.tripDayId,
  name: accommodation.name,
  notes: accommodation.notes,
  status: toStatus(accommodation.status),
  costCents: accommodation.costCents,
  costOriginalAmount: accommodation.costOriginalAmount,
  costCurrency: accommodation.costCurrency,
  costRate: accommodation.costRate,
  costRateDate: accommodation.costRateDate,
  payments: accommodation.payments ?? [],
  link: accommodation.link,
  checkInTime: accommodation.checkInTime,
  checkOutTime: accommodation.checkOutTime,
  location:
    accommodation.locationLat !== null && accommodation.locationLng !== null
      ? {
          lat: accommodation.locationLat,
          lng: accommodation.locationLng,
          label: accommodation.locationLabel,
        }
      : null,
});

export const createAccommodationForTripDay = async (
  params: AccommodationCreateParams,
): Promise<AccommodationDetail | null> => {
  const { userId, tripId, tripDayId, name, notes } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  const { status, costCents, link } = params;
  const checkInTime = params.checkInTime ?? null;
  const checkOutTime = params.checkOutTime ?? null;
  const location = params.location ?? null;
  const aiChangedAt = aiChangedAtFor(params.origin, new Date());
  return prisma.$transaction(async (tx) => {
    const columns = {
      name,
      notes: notes ?? null,
      status: toDbStatus(status),
      costCents: costCents ?? null,
      costOriginalAmount: params.costOriginalAmount ?? null,
      costCurrency: params.costCurrency ?? null,
      costRate: params.costRate ?? null,
      costRateDate: params.costRateDate ?? null,
      link: link ?? null,
      checkInTime,
      checkOutTime,
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: location?.label?.trim() || null,
      aiChangedAt,
    };
    // Story 15.6: the connector creates only where its read found no stay, so a plain create; a stay that
    // appeared since trips the day's unique index (P2002), which is "changed since you read it". The app's
    // upsert is unchanged.
    const accommodation = params.expectNoStay
      ? await tx.accommodation.create({ data: { tripDayId, ...columns } }).catch((error: unknown) => {
          if (isUniqueViolation(error)) throw new ChangedSinceReadError();
          throw error;
        })
      : await tx.accommodation.upsert({
          where: { tripDayId },
          update: columns,
          create: { tripDayId, ...columns },
        });

    if (params.payments) {
      await tx.costPayment.deleteMany({ where: { accommodationId: accommodation.id } });
      if (params.payments.length > 0) {
        await tx.costPayment.createMany({
          data: params.payments.map((payment, index) => ({
            accommodationId: accommodation.id,
            amountCents: payment.amountCents,
            amountOriginal: payment.amountOriginal ?? null,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const payments = await tx.costPayment.findMany({
      where: { accommodationId: accommodation.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    if (params.inTransaction) {
      const receipt = buildReceipt(
        tripDayId,
        { kind: "stayCreated", accommodationId: accommodation.id, updatedAt: accommodation.updatedAt },
        [],
        [],
      );
      await params.inTransaction(tx, { receipt, itemId: accommodation.id });
    }

    return toDetail({
      ...accommodation,
      payments: toPaymentDetails(payments),
    });
  });
};

/**
 * Story 11.4 (FR42, rule 10), rewired by Story 13.1. A changed check-out recomputes the *next* trip day:
 * the smallest `dayIndex` above the stay's (the inverse of the timeline's nearest-lower rule), whose day
 * starts at this check-out. Both directions now: an earlier check-out pulls the day's flexible activities
 * earlier, as a later one pushes them (11.4's "only later" and "untimed first row" guards are gone).
 *
 * `null` means no recompute: the PATCH has no `checkOutTime`, it resolves to the check-out already in
 * effect, or there is no next day (the last night).
 */
const planCheckOutScheduleInTransaction = async (
  tx: TransactionClient,
  params: { tripId: string; checkOutTime: string | null | undefined },
  existing: { id: string; checkOutTime: string | null; tripDayId: string },
): Promise<{ nextDayId: string; plan: DaySchedulePlan } | null> => {
  if (params.checkOutTime === undefined) return null;
  if (resolveCheckOutTime(existing.checkOutTime) === resolveCheckOutTime(params.checkOutTime)) return null;

  const stayDay = await tx.tripDay.findUnique({ where: { id: existing.tripDayId }, select: { dayIndex: true } });
  if (!stayDay) return null;
  const nextDay = await tx.tripDay.findFirst({
    where: { tripId: params.tripId, dayIndex: { gt: stayDay.dayIndex } },
    orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
    select: { id: true },
  });
  if (!nextDay) return null;

  const state = await readScheduleInputInTransaction(tx, params.tripId, nextDay.id);
  if (!state) return null;
  return { nextDayId: nextDay.id, plan: planDaySchedule(state, { kind: "checkOut", checkOutTime: params.checkOutTime }) };
};

export const updateAccommodationForTripDay = async (
  params: AccommodationUpdateParams,
): Promise<AccommodationUpdateResult> => {
  const { userId, tripId, tripDayId, name, notes } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  const { status, costCents, link } = params;
  const location = params.location ?? null;
  const data = {
    name,
    notes: notes ?? null,
    status: toDbStatus(status),
    costCents: costCents ?? null,
    costOriginalAmount: params.costOriginalAmount ?? null,
    costCurrency: params.costCurrency ?? null,
    costRate: params.costRate ?? null,
    costRateDate: params.costRateDate ?? null,
    link: link ?? null,
    locationLat: location?.lat ?? null,
    locationLng: location?.lng ?? null,
    locationLabel: location?.label?.trim() || null,
    aiChangedAt: aiChangedAtFor(params.origin, new Date()),
  } as {
    name: string;
    notes: string | null;
    status: "PLANNED" | "BOOKED";
    costCents: number | null;
    costOriginalAmount: number | null;
    costCurrency: string | null;
    costRate: number | null;
    costRateDate: string | null;
    link: string | null;
    locationLat: number | null;
    locationLng: number | null;
    locationLabel: string | null;
    aiChangedAt: Date | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
  };

  if (params.checkInTime !== undefined) {
    data.checkInTime = params.checkInTime;
  }
  if (params.checkOutTime !== undefined) {
    data.checkOutTime = params.checkOutTime;
  }

  return prisma.$transaction(async (tx): Promise<AccommodationUpdateResult> => {
    // Story 11.4: read inside, because the previous check-out and stamp go into the receipt.
    const existing = await tx.accommodation.findUnique({ where: { tripDayId } });
    if (!existing) {
      return { status: "missing" };
    }
    if (params.expectedUpdatedAt && !sameInstant(existing.updatedAt, params.expectedUpdatedAt)) {
      throw new ChangedSinceReadError();
    }
    // Story 15.6: the connector's receipt holds the whole stay before the write, payments included.
    const previous = params.inTransaction ? await readStaySnapshotInTransaction(tx, existing) : null;

    // Planned before any write, from the stored rows the conditional writes compare against.
    const push = await planCheckOutScheduleInTransaction(tx, { tripId, checkOutTime: params.checkOutTime }, existing);

    const now = new Date();
    const accommodation = await tx.accommodation.update({
      where: { id: existing.id },
      data,
    });

    if (params.payments) {
      await tx.costPayment.deleteMany({ where: { accommodationId: existing.id } });
      if (params.payments.length > 0) {
        await tx.costPayment.createMany({
          data: params.payments.map((payment, index) => ({
            accommodationId: existing.id,
            amountCents: payment.amountCents,
            amountOriginal: payment.amountOriginal ?? null,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const payments = await tx.costPayment.findMany({
      where: { accommodationId: existing.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    const detail = toDetail({
      ...accommodation,
      payments: toPaymentDetails(payments),
    });
    // Story 15.6: on the stay's day when nothing was pushed, on the pushed day otherwise (`stayCheckOutChanged`'s rule).
    const stayUpdated = { kind: "stayUpdated" as const, accommodationId: existing.id, updatedAt: accommodation.updatedAt };
    if (!push) {
      if (params.inTransaction && previous) {
        const receipt = buildReceipt(tripDayId, { ...stayUpdated, previous }, [], []);
        await params.inTransaction(tx, { receipt, itemId: existing.id });
      }
      return { status: "updated", accommodation: detail };
    }

    const { nextDayId, plan } = push;
    const movedItems = await applyScheduleChangesInTransaction(tx, nextDayId, plan.changes, now);
    if (params.inTransaction && previous) {
      const connectorReceipt = buildReceipt(nextDayId, { ...stayUpdated, previous }, [], movedItems, {
        planConflicts: toPlanConflicts(plan.newConflicts),
      });
      await params.inTransaction(tx, { receipt: connectorReceipt, itemId: existing.id });
    }
    // A check-out never changes an order, so 11.1's sweep has nothing to remove (rule 12).
    const receipt = buildReceipt(
      nextDayId,
      {
        kind: "stayCheckOutChanged",
        accommodationId: existing.id,
        updatedAt: accommodation.updatedAt,
        previousUpdatedAt: existing.updatedAt,
        previousCheckOutTime: existing.checkOutTime,
      },
      [],
      movedItems,
      { planConflicts: toPlanConflicts(plan.newConflicts) },
    );
    return { status: "updated", accommodation: detail, receipt };
  });
};

/** Story 15.4: the copy is a new stay on this night, so `origin` marks or clears it. */
export const copyAccommodationFromPreviousNight = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  origin: WriteOrigin;
}): Promise<AccommodationCopyResult> => {
  const { userId, tripId, tripDayId } = params;
  const currentDay = await prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
    select: { id: true, dayIndex: true },
  });

  if (!currentDay) {
    return { status: "not_found" };
  }

  const previousDayIndex = currentDay.dayIndex - 1;
  if (previousDayIndex < 0) {
    return { status: "missing" };
  }

  const previousDay = await prisma.tripDay.findFirst({
    where: {
      tripId,
      dayIndex: previousDayIndex,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
    select: { id: true },
  });

  if (!previousDay) {
    return { status: "missing" };
  }

  const previousAccommodation = await prisma.accommodation.findUnique({
    where: { tripDayId: previousDay.id },
  });

  if (!previousAccommodation) {
    return { status: "missing" };
  }

  const data = {
    name: previousAccommodation.name,
    notes: previousAccommodation.notes,
    status: previousAccommodation.status,
    costCents: null,
    /*
      Story 10.1 review. The four currency columns are nulled **explicitly**, not omitted.
      This runs through an `upsert`, and on the `update` arm an omitted column keeps whatever the
      target row already held - so copying onto a day that carried a foreign stay left a complete
      receipt describing a `costCents` of `null`, which is exactly the shape `refineCostCurrency`
      refuses ("Currency metadata requires a cost"). The stay could then never be saved from the
      dialog again, and `getTripExportForUser` emitted it into an archive that failed its own import.
      The copy deliberately drops the price; it must drop the price's receipt with it.
    */
    costOriginalAmount: null,
    costCurrency: null,
    costRate: null,
    costRateDate: null,
    link: previousAccommodation.link,
    checkInTime: previousAccommodation.checkInTime,
    checkOutTime: previousAccommodation.checkOutTime,
    locationLat: previousAccommodation.locationLat,
    locationLng: previousAccommodation.locationLng,
    locationLabel: previousAccommodation.locationLabel,
    aiChangedAt: aiChangedAtFor(params.origin, new Date()),
  };

  const nextAccommodation = await prisma.$transaction(async (tx) => {
    const accommodation = await tx.accommodation.upsert({
      where: { tripDayId: currentDay.id },
      update: data,
      create: { tripDayId: currentDay.id, ...data },
    });
    await tx.costPayment.deleteMany({ where: { accommodationId: accommodation.id } });
    return accommodation;
  });

  return { status: "copied", accommodation: toDetail({ ...nextAccommodation, payments: [] }) };
};

/**
 * Story 8.5 AC1/AC2 (`DW-79`, `DW-215`). Deleting a stay now takes its travel segments with it, in the
 * same transaction, through the same helper the activity paths use.
 *
 * This was a bare `prisma.accommodation.delete` with no transaction and no cleanup, while the activity
 * side has had both since Story 6.23 — so every stay a user deleted left rows behind that nothing on
 * the screen could draw and nothing anywhere could remove, while `totalTravelMinutes` kept summing
 * them into "Fahrzeit". A segment whose endpoint has *ceased to exist* is unrepairable: nobody can
 * supply the missing half, so it is deleted. That is the opposite half of this story's rule from the
 * merely-non-adjacent case, which keeps its row and surfaces it (see `TripDayView`'s orphaned legs).
 *
 * **The sweep is scoped to the trip's days, not to this one.** An activity can only be an endpoint on
 * its own day; a stay cannot. `buildSegmentTimelineInTransaction` (`travelSegmentRepo.ts`) offers day N's
 * accommodation as the leading endpoint of day N+1, so `[tripDayId]` alone would leave the next day's
 * `stay → firstActivity` row behind — the same defect, one day over — and older rows can sit on any
 * later day. Endpoint ids are cuids, so a trip-wide `in` cannot reach another trip's rows.
 *
 * The idempotent `true` for a day with no stay is unchanged and stays *outside* the transaction: a
 * `DELETE` for a day that has nothing to delete must go on touching nothing, and the route contract
 * (`accommodations/route.ts:197`) still reads a plain boolean.
 */
export const deleteAccommodationForTripDay = async (params: AccommodationDeleteParams): Promise<boolean> => {
  const { userId, tripId, tripDayId } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return false;
  }
  if (params.expectedUpdatedAt || params.inTransaction) {
    return deleteAccommodationForConnector({ ...params, tripDayId: tripDay.id });
  }

  const existing = await prisma.accommodation.findUnique({ where: { tripDayId } });
  if (!existing) {
    return true;
  }

  // One transaction, so a failed sweep fails the delete rather than committing half of it. The row
  // goes first and the segments after, mirroring `deleteDayPlanItemForTripDay`; the segments have no
  // foreign key to the accommodation, so neither order cascades into the other.
  await prisma.$transaction(async (tx) => {
    const tripDays = await tx.tripDay.findMany({ where: { tripId }, select: { id: true } });
    await tx.accommodation.delete({ where: { id: existing.id } });
    await removeTravelSegmentsReferencingItemInTransaction(
      tx,
      tripDays.map((day) => day.id),
      "ACCOMMODATION",
      existing.id,
    );
  });

  return true;
};

/**
 * Story 15.6. The connector's stay delete: the app's delete (the row, its payments, images and documents by
 * cascade, and every leg naming it on any day of the trip; the files stay on disk and the next day is not
 * recomputed), with the stay read and checked inside the transaction and a `stayDeleted` receipt for the
 * hook. A stay gone or re-stamped since the caller's read throws `ChangedSinceReadError`.
 *
 * The legs are partitioned by whether their day drew them before the delete: on the stay's day they are the
 * receipt's `removedTravelSegments`, on the next day its `nextDayLegs`. A leg already undrawn before (an old
 * orphan on any day) is deleted as the app does, but not recorded: restoring it would fail the undo's
 * "restored legs are drawn" post-condition and make every such undo stale.
 */
const deleteAccommodationForConnector = async (params: AccommodationDeleteParams): Promise<boolean> => {
  const { tripId, tripDayId } = params;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.accommodation.findUnique({
      where: { tripDayId },
      include: { images: { orderBy: storedRowOrder }, documents: { orderBy: storedRowOrder } },
    });
    if (!existing || (params.expectedUpdatedAt && !sameInstant(existing.updatedAt, params.expectedUpdatedAt))) {
      throw new ChangedSinceReadError();
    }
    const { images, documents, ...row } = existing;
    const snapshot = await readStaySnapshotInTransaction(tx, row);
    const nextDayId = await findNextTripDayIdInTransaction(tx, tripId, tripDayId);
    const drawnOnDay = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
    const drawnOnNextDay = nextDayId ? await readDrawnSegmentKeysInTransaction(tx, tripId, nextDayId) : new Set<string>();

    const tripDays = await tx.tripDay.findMany({ where: { tripId }, select: { id: true } });
    await tx.accommodation.delete({ where: { id: existing.id } });
    const removed = await removeTravelSegmentsReferencingItemInTransaction(
      tx,
      tripDays.map((day) => day.id),
      "ACCOMMODATION",
      existing.id,
    );

    if (params.inTransaction) {
      const drawnBefore = (leg: (typeof removed)[number], dayId: string, drawn: ReadonlySet<string>) =>
        leg.tripDayId === dayId && drawn.has(buildStoredSegmentPairKey(leg));
      const receipt = buildReceipt(
        tripDayId,
        {
          kind: "stayDeleted",
          accommodationId: existing.id,
          previous: { ...snapshot, images, documents },
          nextDayId,
          nextDayLegs: nextDayId ? removed.filter((leg) => drawnBefore(leg, nextDayId, drawnOnNextDay)) : [],
        },
        removed.filter((leg) => drawnBefore(leg, tripDayId, drawnOnDay)),
        [],
      );
      await params.inTransaction(tx, { receipt, itemId: existing.id });
    }
  });
  return true;
};

export const getAccommodationCostTotalForTrip = async (
  userId: string,
  tripId: string,
): Promise<number | null> => {
  const result = await prisma.accommodation.aggregate({
    where: {
      costCents: { not: null },
      tripDay: {
        tripId,
        trip: { userId },
      },
    },
    _sum: { costCents: true },
    _count: { costCents: true },
  });

  if (result._count.costCents === 0) {
    return null;
  }

  return result._sum.costCents ?? 0;
};

export const listAccommodationImages = async (
  params: AccommodationImageScopeParams,
): Promise<AccommodationImageDetail[] | null> => {
  const accommodation = await findScopedAccommodationForTripParticipant(params);
  if (!accommodation) {
    return null;
  }

  const images = await prisma.accommodationImage.findMany({
    where: { accommodationId: accommodation.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return images.map(toImageDetail);
};

export const createAccommodationImage = async (
  params: AccommodationImageCreateParams,
): Promise<AccommodationImageDetail | null> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return null;
  }

  const last = await prisma.accommodationImage.findFirst({
    where: { accommodationId: accommodation.id },
    orderBy: [{ sortOrder: "desc" }],
    select: { sortOrder: true },
  });
  const nextSortOrder = (last?.sortOrder ?? 0) + 1;

  const created = await prisma.accommodationImage.create({
    data: {
      accommodationId: accommodation.id,
      imageUrl: params.imageUrl,
      sortOrder: nextSortOrder,
      aiChangedAt: aiChangedAtFor(params.origin, new Date()),
    },
  });

  return toImageDetail(created);
};

export const deleteAccommodationImage = async (
  params: AccommodationImageDeleteParams,
): Promise<AccommodationImageDeleteResult> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return { status: "not_found" };
  }

  const existing = await prisma.accommodationImage.findFirst({
    where: {
      id: params.imageId,
      accommodationId: accommodation.id,
    },
    select: { id: true },
  });

  if (!existing) {
    return { status: "missing" };
  }

  await prisma.accommodationImage.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};

export const reorderAccommodationImages = async (
  params: AccommodationImageReorderParams,
): Promise<AccommodationImageReorderResult> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return { status: "not_found" };
  }

  const existing = await prisma.accommodationImage.findMany({
    where: { accommodationId: accommodation.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((item) => item.id));
  const orderIds = new Set(params.order.map((item) => item.imageId));

  if (
    existing.length !== params.order.length ||
    orderIds.size !== params.order.length ||
    [...orderIds].some((id) => !existingIds.has(id))
  ) {
    return { status: "missing" };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of params.order) {
      await tx.accommodationImage.update({
        where: { id: item.imageId },
        data: { sortOrder: item.sortOrder + 1000 },
      });
    }

    for (const item of params.order) {
      await tx.accommodationImage.update({
        where: { id: item.imageId },
        data: { sortOrder: item.sortOrder },
      });
    }
  });

  return { status: "reordered" };
};

export const listAccommodationDocuments = async (
  params: AccommodationImageScopeParams,
): Promise<AccommodationDocumentDetail[] | null> => {
  // The participant scope, exactly as the gallery read uses: a viewer who can see the day must be
  // able to see what is attached to it. The write functions below use the owner-only scope instead.
  const accommodation = await findScopedAccommodationForTripParticipant(params);
  if (!accommodation) {
    return null;
  }

  const documents = await prisma.accommodationDocument.findMany({
    where: { accommodationId: accommodation.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return documents.map(toDocumentDetail);
};

export const createAccommodationDocument = async (
  params: AccommodationDocumentCreateParams,
): Promise<AccommodationDocumentCreateResult> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return { status: "not_found" };
  }

  // Counted here rather than in the dialog. The route has already written the file by the time it
  // calls this, so the refusal has to be distinguishable enough for it to roll that write back - see
  // `AccommodationDocumentCreateResult`.
  const existingCount = await prisma.accommodationDocument.count({
    where: { accommodationId: accommodation.id },
  });
  if (existingCount >= MAX_DOCUMENTS_PER_ENTRY) {
    return { status: "limit_reached" };
  }

  const last = await prisma.accommodationDocument.findFirst({
    where: { accommodationId: accommodation.id },
    orderBy: [{ sortOrder: "desc" }],
    select: { sortOrder: true },
  });
  const nextSortOrder = (last?.sortOrder ?? 0) + 1;

  const created = await prisma.accommodationDocument.create({
    data: {
      accommodationId: accommodation.id,
      documentUrl: params.documentUrl,
      fileName: params.fileName,
      sortOrder: nextSortOrder,
      aiChangedAt: aiChangedAtFor(params.origin, new Date()),
    },
  });

  return { status: "created", document: toDocumentDetail(created) };
};

export const deleteAccommodationDocument = async (
  params: AccommodationDocumentDeleteParams,
): Promise<AccommodationDocumentDeleteResult> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return { status: "not_found" };
  }

  const existing = await prisma.accommodationDocument.findFirst({
    where: {
      id: params.documentId,
      accommodationId: accommodation.id,
    },
    select: { id: true },
  });

  if (!existing) {
    return { status: "missing" };
  }

  await prisma.accommodationDocument.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};
