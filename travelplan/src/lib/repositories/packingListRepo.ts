import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveTripAccessRole, type TripAccessRole } from "@/lib/auth/tripAccessRole";
import { normalizePackingCategory, normalizePackingName, packingNameKey } from "@/lib/trips/packingList";
import { aiChangedAtFor, type WriteOrigin } from "@/lib/trips/writeOrigin";

/**
 * Story 16.1 (FR58). The trip's shared packing list. Every app read and write of `PackingItem` /
 * `PackingItemDay` goes through here (the backup export/import in `tripRepo.ts` and the trip summary's
 * count are the only other readers). Each function re-checks access for the trip: owners and
 * contributors write (`findTripForTripWriter`), every participant reads (viewers too - unlike the bucket
 * list, the packing list is not hidden from them).
 *
 * Names are unique per trip by `nameKey` (`packingNameKey`): adding a name that exists resolves to the
 * existing item, renaming onto another item's name is refused. A category matching one the trip already
 * uses (ignoring case) is stored in the existing spelling; "Sonstiges"/"Other" is stored as `null`.
 *
 * `origin` is required on create and update (Story 15.4): the app passes `"user"`, which clears the
 * KI/AI marker. Story 16.4 will add the connector's `inTransaction` hook; the writes already run in a
 * transaction so it has a place to go.
 */

export type PackingItemDetail = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  /** How many days the item is linked to (Story 16.2 writes the links). */
  dayCount: number;
  /** Story 15.4 meaning: when the connector last wrote the item; `null` once a person has edited it. */
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PackingItemCreateResult =
  | { status: "not_found" }
  | { status: "created"; item: PackingItemDetail }
  | { status: "existed"; item: PackingItemDetail };

export type PackingItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "duplicate_name" }
  | { status: "updated"; item: PackingItemDetail };

export type PackingItemDeleteResult = { status: "not_found" } | { status: "missing" } | { status: "deleted" };

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The write gate. The explicit `role: "CONTRIBUTOR"` is load-bearing: a bare `members: { some: { userId } }`
 * is the participant *read* clause and would let viewers write (see `bucketListRepo.ts`).
 */
const findTripForTripWriter = async (userId: string, tripId: string) =>
  prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
    },
    select: { id: true },
  });

const detailSelect = {
  id: true,
  name: true,
  category: true,
  packed: true,
  aiChangedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { days: true } },
} as const;

type DetailRow = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { days: number };
};

const toDetail = (row: DetailRow): PackingItemDetail => ({
  id: row.id,
  name: row.name,
  category: row.category,
  packed: row.packed,
  dayCount: row._count.days,
  aiChangedAt: row.aiChangedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * The category as stored: normalized (`null` for none or "Other"), then, if another item of the trip
 * already uses it ignoring case, that item's spelling - so "technik" joins "Technik". `excludeItemId`
 * keeps an item's own old spelling from blocking a case fix on it.
 */
const resolveCategory = async (
  tx: TransactionClient,
  tripId: string,
  raw: string | null | undefined,
  excludeItemId?: string,
): Promise<string | null> => {
  const category = normalizePackingCategory(raw);
  if (category === null) return null;
  const key = category.toLowerCase();
  const used = await tx.packingItem.findMany({
    where: { tripId, category: { not: null }, ...(excludeItemId ? { id: { not: excludeItemId } } : {}) },
    select: { category: true },
    distinct: ["category"],
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const match = used.find((row) => row.category !== null && row.category.toLowerCase() === key);
  return match?.category ?? category;
};

/**
 * Every participant reads: owner, contributor, viewer. Answers the caller's role with the items (the
 * page derives its edit controls from it), or `null` for a non-participant. Items in name-key order;
 * grouping is `groupPackingItems` on the client.
 */
export const listPackingItemsForTrip = async (params: {
  userId: string;
  tripId: string;
}): Promise<{ accessRole: TripAccessRole; items: PackingItemDetail[] } | null> => {
  const { userId, tripId } = params;
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, OR: [{ userId }, { members: { some: { userId } } }] },
    select: {
      userId: true,
      members: { where: { userId }, select: { userId: true, role: true }, take: 1 },
      packingItems: { select: detailSelect, orderBy: [{ nameKey: "asc" }, { id: "asc" }] },
    },
  });
  if (!trip) return null;
  const accessRole = deriveTripAccessRole(userId, trip);
  if (accessRole === null) return null;
  return { accessRole, items: trip.packingItems.map(toDetail) };
};

/**
 * Adds an item, or answers the existing one when the trip already has the name (ignoring case and
 * surrounding spaces) - `existed`, nothing written. A concurrent create of the same name loses on the
 * unique index and answers the winner as `existed` too.
 */
export const createPackingItem = async (params: {
  userId: string;
  tripId: string;
  name: string;
  category?: string | null;
  origin: WriteOrigin;
}): Promise<PackingItemCreateResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  const name = normalizePackingName(params.name);
  const nameKey = packingNameKey(name);
  const findExisting = () =>
    prisma.packingItem.findUnique({
      where: { tripId_nameKey: { tripId: params.tripId, nameKey } },
      select: detailSelect,
    });

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.packingItem.findUnique({
        where: { tripId_nameKey: { tripId: params.tripId, nameKey } },
        select: detailSelect,
      });
      if (existing) return { status: "existed" as const, item: toDetail(existing) };

      const category = await resolveCategory(tx, params.tripId, params.category);
      const created = await tx.packingItem.create({
        data: {
          tripId: params.tripId,
          name,
          nameKey,
          category,
          aiChangedAt: aiChangedAtFor(params.origin, new Date()),
        },
        select: detailSelect,
      });
      return { status: "created" as const, item: toDetail(created) };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findExisting();
    if (!winner) throw error;
    return { status: "existed", item: toDetail(winner) };
  }
};

/**
 * Renames, re-categorizes (`null` or `""` clears) and ticks or unticks an item; absent fields are kept.
 * A rename onto another item's name (ignoring case) is `duplicate_name` and writes nothing; a different
 * spelling of the item's own name (a case fix) is allowed.
 */
export const updatePackingItem = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  name?: string;
  category?: string | null;
  packed?: boolean;
  origin: WriteOrigin;
}): Promise<PackingItemUpdateResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  try {
    return await prisma.$transaction(async (tx): Promise<PackingItemUpdateResult> => {
      const current = await tx.packingItem.findFirst({
        where: { id: params.itemId, tripId: params.tripId },
        select: { id: true },
      });
      if (!current) return { status: "missing" };

      const data: Prisma.PackingItemUpdateInput = { aiChangedAt: aiChangedAtFor(params.origin, new Date()) };

      if (params.name !== undefined) {
        const name = normalizePackingName(params.name);
        const nameKey = packingNameKey(name);
        const clash = await tx.packingItem.findFirst({
          where: { tripId: params.tripId, nameKey, id: { not: params.itemId } },
          select: { id: true },
        });
        if (clash) return { status: "duplicate_name" };
        data.name = name;
        data.nameKey = nameKey;
      }

      if (params.category !== undefined) {
        data.category = await resolveCategory(tx, params.tripId, params.category, params.itemId);
      }

      if (params.packed !== undefined) {
        data.packed = params.packed;
      }

      const updated = await tx.packingItem.update({ where: { id: params.itemId }, data, select: detailSelect });
      return { status: "updated", item: toDetail(updated) };
    });
  } catch (error) {
    // A concurrent create or rename took the name between the check and the write.
    if (isUniqueViolation(error)) return { status: "duplicate_name" };
    throw error;
  }
};

/** Removes the item; its day links cascade. Other items are untouched. */
export const deletePackingItem = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
}): Promise<PackingItemDeleteResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  const result = await prisma.packingItem.deleteMany({ where: { id: params.itemId, tripId: params.tripId } });
  return result.count === 0 ? { status: "missing" } : { status: "deleted" };
};
