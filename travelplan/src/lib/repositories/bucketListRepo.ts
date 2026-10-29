import { prisma } from "@/lib/db/prisma";
import { parkedDayPlanItemsWhere } from "@/lib/repositories/dayPlanItemRepo";
import { type PaymentDetail, toPaymentDetails } from "@/lib/repositories/paymentDetail";
import { DEFAULT_ACTIVITY_DURATION_MINUTES } from "@/lib/trips/legacySchedule";
import {
  aiChangedAtFor,
  ChangedSinceReadError,
  type InTransactionHook,
  type WriteOrigin,
} from "@/lib/trips/writeOrigin";

/**
 * Story 14.1 (FR30, FR31). The bucket list is the trip's parked activities: `DayPlanItem` rows with
 * `tripDayId = null`. Its own table is gone; an idea is a full activity (text, cost and payments,
 * pictures, documents, link, place, duration) that has no day yet. A parked row is always FLEXIBLE with
 * no times and `sortOrder` 0 (the table's CHECK), so nothing here ever writes the schedule fields beyond
 * that, and these writes recompute no day and return no receipt.
 *
 * Every read here is `parkedDayPlanItemsWhere(tripId)` - the one place a reader queries activities by
 * `tripId` - and every function goes through the writer clause first (owners and contributors; viewers
 * see no bucket list).
 */

type PaymentInput = { amountCents: number; dueDate: string; amountOriginal?: number | null };

export type ParkedDayPlanItemDetail = {
  id: string;
  tripId: string;
  title: string;
  contentJson: string;
  durationMinutes: number;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: PaymentDetail[];
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  /** The first picture by `sortOrder`, read in the same query; the row's thumbnail. */
  firstImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Story 15.4. When the connector last wrote the row; `null` once a person has edited it. */
  aiChangedAt: Date | null;
};

export type ParkedDayPlanItemMutationParams = {
  userId: string;
  tripId: string;
  title: string;
  contentJson: string;
  durationMinutes?: number | null;
  costCents?: number | null;
  costOriginalAmount?: number | null;
  costCurrency?: string | null;
  costRate?: number | null;
  costRateDate?: string | null;
  payments?: PaymentInput[] | null;
  linkUrl?: string | null;
  location?: { lat: number; lng: number; label?: string | null } | null;
  /** Story 15.4. `"ai"` marks the row, `"user"` clears the mark. */
  origin: WriteOrigin;
  /**
   * Story 15.4. Runs last inside the write's transaction, with a `null` receipt: the app cannot undo a
   * parked write.
   */
  inTransaction?: InTransactionHook;
};

export type ParkedDayPlanItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; item: ParkedDayPlanItemDetail };

/** The media rows the cascade took, for the route to remove their files after the commit. */
export type ParkedDayPlanItemDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted"; imageUrls: string[]; documentUrls: string[] };

/**
 * The single scope gate behind every exported function. The explicit `role: "CONTRIBUTOR"` is
 * load-bearing: a bare `members: { some: { userId } }` is the participant *read* clause and would hand
 * viewers the bucket list (Story 5.13).
 */
const findTripForTripWriter = async (userId: string, tripId: string) =>
  prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
    },
    select: { id: true },
  });

const detailInclude = {
  payments: {
    select: { amountCents: true, dueDate: true, amountOriginal: true },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
  },
  images: { select: { imageUrl: true }, orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }], take: 1 },
};

type ParkedRow = {
  id: string;
  tripId: string;
  title: string | null;
  contentJson: string;
  durationMinutes: number;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  linkUrl: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  aiChangedAt: Date | null;
  payments: { amountCents: number; dueDate: string; amountOriginal: number | null }[];
  images: { imageUrl: string }[];
};

const toDetail = (row: ParkedRow): ParkedDayPlanItemDetail => ({
  id: row.id,
  tripId: row.tripId,
  title: row.title ?? "",
  contentJson: row.contentJson,
  durationMinutes: row.durationMinutes,
  costCents: row.costCents,
  costOriginalAmount: row.costOriginalAmount,
  costCurrency: row.costCurrency,
  costRate: row.costRate,
  costRateDate: row.costRateDate,
  payments: toPaymentDetails(row.payments),
  linkUrl: row.linkUrl,
  location:
    row.locationLat !== null && row.locationLng !== null
      ? { lat: row.locationLat, lng: row.locationLng, label: row.locationLabel }
      : null,
  firstImageUrl: row.images[0]?.imageUrl ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  aiChangedAt: row.aiChangedAt,
});

/**
 * The columns a create or an edit writes; the schedule fields are the parked constants, never input.
 * Story 15.4: and the marker, from `origin`.
 */
const contentColumns = (params: ParkedDayPlanItemMutationParams, now: Date) => ({
  title: params.title.trim(),
  contentJson: params.contentJson,
  durationMinutes: params.durationMinutes ?? DEFAULT_ACTIVITY_DURATION_MINUTES,
  costCents: params.costCents ?? null,
  costOriginalAmount: params.costOriginalAmount ?? null,
  costCurrency: params.costCurrency ?? null,
  costRate: params.costRate ?? null,
  costRateDate: params.costRateDate ?? null,
  linkUrl: params.linkUrl ?? null,
  locationLat: params.location?.lat ?? null,
  locationLng: params.location?.lng ?? null,
  locationLabel: params.location?.label?.trim() || null,
  aiChangedAt: aiChangedAtFor(params.origin, now),
});

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Payments replaced wholesale, exactly as `dayPlanItemRepo.ts` writes them. Absent payments keep the rows,
 * unless the cost is cleared: payments never outlive their cost.
 */
const replacePayments = async (
  tx: TransactionClient,
  itemId: string,
  costCents: number | null | undefined,
  payments: PaymentInput[] | null | undefined,
) => {
  if (costCents == null) {
    await tx.costPayment.deleteMany({ where: { dayPlanItemId: itemId } });
    return;
  }
  if (!payments) return;
  await tx.costPayment.deleteMany({ where: { dayPlanItemId: itemId } });
  if (payments.length > 0) {
    await tx.costPayment.createMany({
      data: payments.map((payment, index) => ({
        dayPlanItemId: itemId,
        amountCents: payment.amountCents,
        amountOriginal: payment.amountOriginal ?? null,
        dueDate: payment.dueDate,
        sortOrder: index,
      })),
    });
  }
};

/** Alphabetical, then oldest first, then by id: the order the list has always had. */
export const listParkedDayPlanItemsForTrip = async (params: {
  userId: string;
  tripId: string;
}): Promise<ParkedDayPlanItemDetail[] | null> => {
  const { userId, tripId } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) {
    return null;
  }

  const rows = await prisma.dayPlanItem.findMany({
    where: parkedDayPlanItemsWhere(tripId),
    orderBy: [{ title: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: detailInclude,
  });
  return rows.map(toDetail);
};

export const createParkedDayPlanItem = async (
  params: ParkedDayPlanItemMutationParams,
): Promise<ParkedDayPlanItemDetail | null> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.dayPlanItem.create({
      data: {
        tripId: params.tripId,
        tripDayId: null,
        scheduleMode: "FLEXIBLE",
        fromTime: null,
        toTime: null,
        sortOrder: 0,
        ...contentColumns(params, new Date()),
      },
    });
    await replacePayments(tx, created.id, params.costCents, params.payments);
    if (params.inTransaction) await params.inTransaction(tx, { receipt: null, itemId: created.id });
    return toDetail(await tx.dayPlanItem.findUniqueOrThrow({ where: { id: created.id }, include: detailInclude }));
  });
};

/**
 * Conditional on the item still being parked on this trip (`{ id, tripId, tripDayId: null }`): an idea
 * scheduled meanwhile in another tab is a day activity now and answers `missing`, never an edit that
 * would pull it off its day. Never touches the mode, the times or the order.
 *
 * Story 15.4: `expectedUpdatedAt`, when given, is the stamp the caller read; a parked row that no longer
 * carries it throws `ChangedSinceReadError` inside the transaction, so nothing is written.
 */
export const updateParkedDayPlanItem = async (
  params: ParkedDayPlanItemMutationParams & { itemId: string; expectedUpdatedAt?: Date },
): Promise<ParkedDayPlanItemUpdateResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) {
    return { status: "not_found" };
  }

  const item = await prisma.$transaction(async (tx) => {
    const where = { id: params.itemId, ...parkedDayPlanItemsWhere(params.tripId) };
    if (params.expectedUpdatedAt) {
      const existing = await tx.dayPlanItem.findFirst({ where, select: { updatedAt: true } });
      if (!existing) return null;
      if (existing.updatedAt.getTime() !== params.expectedUpdatedAt.getTime()) throw new ChangedSinceReadError();
    }
    const written = await tx.dayPlanItem.updateMany({
      where: params.expectedUpdatedAt ? { ...where, updatedAt: params.expectedUpdatedAt } : where,
      data: contentColumns(params, new Date()),
    });
    if (written.count !== 1) {
      if (params.expectedUpdatedAt) throw new ChangedSinceReadError();
      return null;
    }
    await replacePayments(tx, params.itemId, params.costCents, params.payments);
    if (params.inTransaction) await params.inTransaction(tx, { receipt: null, itemId: params.itemId });
    return toDetail(await tx.dayPlanItem.findUniqueOrThrow({ where: { id: params.itemId }, include: detailInclude }));
  });

  return item ? { status: "updated", item } : { status: "missing" };
};

/**
 * One transaction: read the media URLs, then delete the parked row, which cascades its images,
 * documents and payments. The files are the route's to remove after the commit (Story 14.1 §15), from
 * the URLs returned here - a day activity's delete keeps its files (DW-187); a parked idea's does not,
 * because no undo can bring it back.
 *
 * Story 15.4: a pure delete, so no origin; `expectedUpdatedAt` and the hook as for the update.
 */
export const deleteParkedDayPlanItem = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  expectedUpdatedAt?: Date;
  inTransaction?: InTransactionHook;
}): Promise<ParkedDayPlanItemDeleteResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) {
    return { status: "not_found" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const where = { id: params.itemId, ...parkedDayPlanItemsWhere(params.tripId) };
    const existing = await tx.dayPlanItem.findFirst({
      where,
      select: {
        updatedAt: true,
        images: { select: { imageUrl: true } },
        documents: { select: { documentUrl: true } },
      },
    });
    if (!existing) return null;
    if (params.expectedUpdatedAt && existing.updatedAt.getTime() !== params.expectedUpdatedAt.getTime()) {
      throw new ChangedSinceReadError();
    }
    const deleted = await tx.dayPlanItem.deleteMany({ where });
    if (deleted.count !== 1) return null;
    if (params.inTransaction) await params.inTransaction(tx, { receipt: null, itemId: params.itemId });
    return {
      imageUrls: existing.images.map((image) => image.imageUrl),
      documentUrls: existing.documents.map((document) => document.documentUrl),
    };
  });

  return outcome ? { status: "deleted", ...outcome } : { status: "missing" };
};
