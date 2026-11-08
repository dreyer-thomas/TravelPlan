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
 *
 * Story 16.2 (FR59) links items to days: `linkPackingItemToDay`, `addPackingItemToDay` (create-or-resolve
 * by name, then link) and `unlinkPackingItemFromDay`. A link or unlink that changes a row also writes the
 * item (`aiChangedAt` per origin, `updatedAt` automatically), so a later stale check on `updatedAt` sees
 * it; a no-op link or unlink writes nothing.
 */

export type PackingItemDetail = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  /** How many days the item is linked to (= `days.length`). */
  dayCount: number;
  /** Story 16.2. The days the item is linked to, ascending by `dayIndex`. */
  days: PackingItemDayRef[];
  /** Story 15.4 meaning: when the connector last wrote the item; `null` once a person has edited it. */
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PackingItemDayRef = { id: string; dayIndex: number; date: Date };

export type PackingItemCreateResult =
  | { status: "not_found" }
  | { status: "created"; item: PackingItemDetail }
  | { status: "existed"; item: PackingItemDetail };

export type PackingItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "duplicate_name" }
  | { status: "updated"; item: PackingItemDetail };

export type PackingItemDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "days_changed"; dayCount: number }
  | { status: "deleted" };

export type PackingItemLinkResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  | { status: "missing" }
  | { status: "linked"; item: PackingItemDetail };

export type PackingItemAddToDayResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  | { status: "created"; item: PackingItemDetail }
  | { status: "existed"; item: PackingItemDetail };

export type PackingItemUnlinkResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  | { status: "missing" }
  | { status: "unlinked"; item: PackingItemDetail };

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
  // Prisma cannot order by a field of the related row through the link table; `toDetail` sorts.
  days: { select: { tripDay: { select: { id: true, dayIndex: true, date: true } } } },
} as const;

type DetailRow = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  days: { tripDay: PackingItemDayRef }[];
};

const toDetail = (row: DetailRow): PackingItemDetail => {
  const days = row.days.map((link) => link.tripDay).sort((a, b) => a.dayIndex - b.dayIndex);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    packed: row.packed,
    dayCount: days.length,
    days,
    aiChangedAt: row.aiChangedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

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
 * The item named `name` on the trip: the existing one (`existed`, unchanged - its category and packed
 * state stay) or a new unpacked one (`created`). Shared by the list's add and the day's add, so the
 * duplicate-name rule lives in one place. A concurrent create of the same name throws `P2002`; callers
 * resolve the winner.
 */
const createOrResolveInTx = async (
  tx: TransactionClient,
  params: { tripId: string; name: string; category?: string | null; origin: WriteOrigin },
): Promise<{ status: "created" | "existed"; item: PackingItemDetail }> => {
  const name = normalizePackingName(params.name);
  const nameKey = packingNameKey(name);
  const existing = await tx.packingItem.findUnique({
    where: { tripId_nameKey: { tripId: params.tripId, nameKey } },
    select: detailSelect,
  });
  if (existing) return { status: "existed", item: toDetail(existing) };

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
  return { status: "created", item: toDetail(created) };
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

  try {
    return await prisma.$transaction((tx) => createOrResolveInTx(tx, params));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.packingItem.findUnique({
      where: { tripId_nameKey: { tripId: params.tripId, nameKey: packingNameKey(normalizePackingName(params.name)) } },
      select: detailSelect,
    });
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

/**
 * Removes the item; its day links cascade. Other items are untouched.
 *
 * Story 16.2 (DW-432): `confirmedDayCount` is the day count the person confirmed ("also removed from N
 * days"). When the item has links and their number differs, nothing is deleted and the current count is
 * answered (`days_changed`), so the page can ask again. Without it (the connector) the delete is
 * unconditional, as in 16.1.
 */
export const deletePackingItem = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  confirmedDayCount?: number;
}): Promise<PackingItemDeleteResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  return prisma.$transaction(async (tx): Promise<PackingItemDeleteResult> => {
    if (params.confirmedDayCount !== undefined) {
      const item = await tx.packingItem.findFirst({
        where: { id: params.itemId, tripId: params.tripId },
        select: { _count: { select: { days: true } } },
      });
      if (!item) return { status: "missing" };
      const dayCount = item._count.days;
      if (dayCount > 0 && dayCount !== params.confirmedDayCount) return { status: "days_changed", dayCount };
    }
    const result = await tx.packingItem.deleteMany({ where: { id: params.itemId, tripId: params.tripId } });
    return result.count === 0 ? { status: "missing" } : { status: "deleted" };
  });
};

const dayOfTrip = (tx: TransactionClient, tripId: string, tripDayId: string) =>
  tx.tripDay.findFirst({ where: { id: tripDayId, tripId }, select: { id: true } });

/** Writes the item after a link change: `aiChangedAt` per origin, `updatedAt` by Prisma. */
const touchItem = async (tx: TransactionClient, itemId: string, origin: WriteOrigin) =>
  toDetail(
    await tx.packingItem.update({
      where: { id: itemId },
      data: { aiChangedAt: aiChangedAtFor(origin, new Date()) },
      select: detailSelect,
    }),
  );

/** Links the item to the day unless it already is; writes the item only when a link was created. */
const linkInTx = async (tx: TransactionClient, itemId: string, tripDayId: string, origin: WriteOrigin) => {
  const link = await tx.packingItemDay.findUnique({
    where: { packingItemId_tripDayId: { packingItemId: itemId, tripDayId } },
    select: { packingItemId: true },
  });
  if (!link) {
    await tx.packingItemDay.create({ data: { packingItemId: itemId, tripDayId } });
    return touchItem(tx, itemId, origin);
  }
  return toDetail(await tx.packingItem.findUniqueOrThrow({ where: { id: itemId }, select: detailSelect }));
};

/**
 * Runs `write` once more when it lost a race on a unique index (the same name created, or the same link
 * made, concurrently): the second run finds the winner's row and resolves onto it.
 */
const retryOnceOnUniqueViolation = async <T>(write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return write();
  }
};

/**
 * Story 16.2. Links an item of the trip to a day of the trip. Linking an item already on the day is
 * success and writes nothing. A day or item of another trip is `day_missing` / `missing`.
 */
export const linkPackingItemToDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
  origin: WriteOrigin;
}): Promise<PackingItemLinkResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  return retryOnceOnUniqueViolation(() =>
    prisma.$transaction(async (tx): Promise<PackingItemLinkResult> => {
      if (!(await dayOfTrip(tx, params.tripId, params.tripDayId))) return { status: "day_missing" };
      const item = await tx.packingItem.findFirst({
        where: { id: params.itemId, tripId: params.tripId },
        select: { id: true },
      });
      if (!item) return { status: "missing" };
      return { status: "linked", item: await linkInTx(tx, item.id, params.tripDayId, params.origin) };
    }),
  );
};

/**
 * Story 16.2. Adds `name` to the day: the trip's item of that name (ignoring case and surrounding spaces;
 * its category and packed state unchanged) or a new unpacked one, then links it. Never a second item of
 * the same name.
 */
export const addPackingItemToDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  name: string;
  category?: string | null;
  origin: WriteOrigin;
}): Promise<PackingItemAddToDayResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  return retryOnceOnUniqueViolation(() =>
    prisma.$transaction(async (tx): Promise<PackingItemAddToDayResult> => {
      if (!(await dayOfTrip(tx, params.tripId, params.tripDayId))) return { status: "day_missing" };
      const resolved = await createOrResolveInTx(tx, params);
      const item = await linkInTx(tx, resolved.item.id, params.tripDayId, params.origin);
      return { status: resolved.status, item };
    }),
  );
};

/**
 * Story 16.2. Removes the item from the day; the item stays on the trip and its other days. A link that
 * is already gone is still `unlinked` (the click had its effect) and writes nothing.
 */
export const unlinkPackingItemFromDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
  origin: WriteOrigin;
}): Promise<PackingItemUnlinkResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  return prisma.$transaction(async (tx): Promise<PackingItemUnlinkResult> => {
    if (!(await dayOfTrip(tx, params.tripId, params.tripDayId))) return { status: "day_missing" };
    const item = await tx.packingItem.findFirst({
      where: { id: params.itemId, tripId: params.tripId },
      select: detailSelect,
    });
    if (!item) return { status: "missing" };
    const removed = await tx.packingItemDay.deleteMany({
      where: { packingItemId: params.itemId, tripDayId: params.tripDayId },
    });
    if (removed.count === 0) return { status: "unlinked", item: toDetail(item) };
    return { status: "unlinked", item: await touchItem(tx, params.itemId, params.origin) };
  });
};
