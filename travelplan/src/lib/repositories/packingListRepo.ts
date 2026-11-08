import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveTripAccessRole, type TripAccessRole } from "@/lib/auth/tripAccessRole";
import { normalizePackingCategory, normalizePackingName, packingNameKey } from "@/lib/trips/packingList";
import { aiChangedAtFor, ChangedSinceReadError, type WriteOrigin } from "@/lib/trips/writeOrigin";
import { UndoStaleError } from "@/lib/repositories/dayPlanChangeRepo";
import type {
  PackingChangeReceipt,
  PackingItemSnapshot,
  PackingReceiptEntry,
} from "@/lib/trips/packingChangeReceipt";

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
 * KI/AI marker.
 *
 * Story 16.2 (FR59) links items to days: `linkPackingItemToDay`, `addPackingItemToDay` (create-or-resolve
 * by name, then link) and `unlinkPackingItemFromDay`. A link or unlink that changes a row also writes the
 * item (`aiChangedAt` per origin, `updatedAt` automatically), so a later stale check on `updatedAt` sees
 * it; a no-op link or unlink writes nothing.
 *
 * Story 16.3 (FR51 amended): the day email reads one day's items through `listPackingItemsForDay`.
 *
 * Story 16.4 (FR57) adds the connector's writes (`addPackingItemsForConnector`,
 * `updatePackingItemForConnector`, `deletePackingItemForConnector`), each with an `inTransaction` hook that
 * runs last in the write's transaction with the packing receipt, so the connector records its `ai_changes`
 * row with the write; and `undoPackingChangeForTrip`, the undo of such a receipt. Every connector write
 * sets `aiChangedAt` on each item it created or changed, and a no-op writes nothing and runs no hook.
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

export type PackingItemForDay = { id: string; name: string; category: string | null; packed: boolean };

/**
 * Story 16.3. The items linked to one day, in name-key order, with the four fields the day email groups
 * by - not the trip-wide read with every day link. Every participant reads (viewer included); the route
 * already checked read access, so the participant clause is defence in depth: a non-participant, or a day
 * of another trip, gets `[]`.
 */
export const listPackingItemsForDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<PackingItemForDay[]> => {
  const { userId, tripId, tripDayId } = params;
  return prisma.packingItem.findMany({
    where: {
      tripId,
      days: { some: { tripDayId } },
      trip: { OR: [{ userId }, { members: { some: { userId } } }] },
    },
    select: { id: true, name: true, category: true, packed: true },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  });
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

// ---------------------------------------------------------------------------------------------------------
// Story 16.4. The connector's writes and their undo.

/**
 * Runs last inside a connector packing write's transaction, with the write's receipt; the connector inserts
 * its `ai_changes` row here. A throw rolls the write back (as `InTransactionHook` in `writeOrigin.ts`).
 */
export type PackingInTransactionHook = (
  tx: TransactionClient,
  outcome: { receipt: PackingChangeReceipt },
) => Promise<void>;

const snapshotSelect = {
  id: true,
  name: true,
  nameKey: true,
  category: true,
  packed: true,
  aiChangedAt: true,
  createdAt: true,
  updatedAt: true,
  days: { select: { tripDayId: true } },
} as const;

const toSnapshot = (row: {
  id: string;
  name: string;
  nameKey: string;
  category: string | null;
  packed: boolean;
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  days: { tripDayId: string }[];
}): PackingItemSnapshot => ({
  id: row.id,
  name: row.name,
  nameKey: row.nameKey,
  category: row.category,
  packed: row.packed,
  aiChangedAt: row.aiChangedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  dayIds: row.days.map((link) => link.tripDayId),
});

const receiptOf = (entries: PackingReceiptEntry[]): PackingChangeReceipt => ({
  kind: "packingChanged",
  version: 1,
  entries,
});

export type PackingConnectorAddResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  | {
      status: "added";
      /** One per input, in input order. */
      results: { name: string; itemId: string; status: "created" | "existed" }[];
      /** The resolved items, deduplicated, in first-resolved order. */
      items: PackingItemDetail[];
      /** Whether anything was written (and the hook ran). */
      written: boolean;
    };

/**
 * `add_packing_items`. Resolves every name in one transaction, as the app's add does (an existing name is
 * that item, unchanged; a new one an unpacked item), and with `tripDayId` links each to the day. A created
 * item gets a `created` entry; an existing item whose link to the day is new gets an `updated` entry with
 * its state before. An existing item without a day, or already on it, writes nothing and gets no entry.
 * The hook runs only when there is an entry. A lost race on a unique index reruns the whole batch once.
 */
export const addPackingItemsForConnector = async (params: {
  userId: string;
  tripId: string;
  items: { name: string; category?: string | null }[];
  tripDayId?: string;
  inTransaction: PackingInTransactionHook;
}): Promise<PackingConnectorAddResult> => {
  const { userId, tripId, tripDayId, inTransaction } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) return { status: "not_found" };

  return retryOnceOnUniqueViolation(() =>
    prisma.$transaction(async (tx): Promise<PackingConnectorAddResult> => {
      if (tripDayId !== undefined && !(await dayOfTrip(tx, tripId, tripDayId))) return { status: "day_missing" };

      const entries = new Map<string, PackingReceiptEntry>();
      const results: { name: string; itemId: string; status: "created" | "existed" }[] = [];
      const order: string[] = [];

      for (const input of params.items) {
        const nameKey = packingNameKey(normalizePackingName(input.name));
        // The item's state before this call, read before the resolve: only an existing item has one.
        const before = await tx.packingItem.findUnique({
          where: { tripId_nameKey: { tripId, nameKey } },
          select: snapshotSelect,
        });
        const resolved = await createOrResolveInTx(tx, { tripId, name: input.name, category: input.category, origin: "ai" });
        const itemId = resolved.item.id;
        results.push({ name: input.name, itemId, status: resolved.status });
        if (!order.includes(itemId)) order.push(itemId);
        if (resolved.status === "created") {
          entries.set(itemId, { change: "created", itemId, updatedAt: resolved.item.updatedAt });
        }
        if (tripDayId !== undefined) {
          const link = await tx.packingItemDay.findUnique({
            where: { packingItemId_tripDayId: { packingItemId: itemId, tripDayId } },
            select: { packingItemId: true },
          });
          if (!link) {
            await linkInTx(tx, itemId, tripDayId, "ai");
            if (!entries.has(itemId) && before) {
              entries.set(itemId, { change: "updated", before: toSnapshot(before), updatedAt: before.updatedAt });
            }
          }
        }
      }

      // Every entry carries the stamp the write left last on its item.
      const finalItems = await tx.packingItem.findMany({ where: { id: { in: order } }, select: detailSelect });
      const byId = new Map(finalItems.map((row) => [row.id, toDetail(row)]));
      for (const [itemId, entry] of entries) {
        const stamp = byId.get(itemId)!.updatedAt;
        if (entry.change !== "deleted") entry.updatedAt = stamp;
      }

      const receiptEntries = [...entries.values()];
      if (receiptEntries.length > 0) await inTransaction(tx, { receipt: receiptOf(receiptEntries) });
      return {
        status: "added",
        results,
        items: order.map((id) => byId.get(id)!),
        written: receiptEntries.length > 0,
      };
    }),
  );
};

export type PackingConnectorUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "day_missing" }
  | { status: "duplicate_name" }
  | { status: "unchanged"; item: PackingItemDetail }
  | { status: "updated"; item: PackingItemDetail };

/**
 * `update_packing_item`. Changes only the given fields, under the app's rules (rename clash, category
 * spelling, "Other" as `null`), and links or unlinks days, checked against the `updatedAt` the caller read
 * (`ChangedSinceReadError` otherwise, nothing written). A call that changes nothing writes nothing and
 * runs no hook (`unchanged`).
 */
export const updatePackingItemForConnector = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  expectedUpdatedAt: Date;
  name?: string;
  category?: string | null;
  packed?: boolean;
  addDayIds?: string[];
  removeDayIds?: string[];
  inTransaction: PackingInTransactionHook;
}): Promise<PackingConnectorUpdateResult> => {
  const { userId, tripId, itemId, inTransaction } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) return { status: "not_found" };

  try {
    return await prisma.$transaction(async (tx): Promise<PackingConnectorUpdateResult> => {
      const current = await tx.packingItem.findFirst({ where: { id: itemId, tripId }, select: snapshotSelect });
      if (!current) return { status: "missing" };
      if (current.updatedAt.getTime() !== params.expectedUpdatedAt.getTime()) throw new ChangedSinceReadError();

      const addDayIds = [...new Set(params.addDayIds ?? [])];
      const removeDayIds = [...new Set(params.removeDayIds ?? [])];
      const givenDays = [...new Set([...addDayIds, ...removeDayIds])];
      if (givenDays.length > 0) {
        const found = await tx.tripDay.count({ where: { id: { in: givenDays }, tripId } });
        if (found !== givenDays.length) return { status: "day_missing" };
      }

      const data: Prisma.PackingItemUpdateInput = {};
      if (params.name !== undefined) {
        const name = normalizePackingName(params.name);
        const nameKey = packingNameKey(name);
        const clash = await tx.packingItem.findFirst({
          where: { tripId, nameKey, id: { not: itemId } },
          select: { id: true },
        });
        if (clash) return { status: "duplicate_name" };
        if (name !== current.name) {
          data.name = name;
          data.nameKey = nameKey;
        }
      }
      if (params.category !== undefined) {
        const category = await resolveCategory(tx, tripId, params.category, itemId);
        if (category !== current.category) data.category = category;
      }
      if (params.packed !== undefined && params.packed !== current.packed) data.packed = params.packed;

      const linked = new Set(current.days.map((link) => link.tripDayId));
      const toLink = addDayIds.filter((id) => !linked.has(id));
      const toUnlink = removeDayIds.filter((id) => linked.has(id));

      if (Object.keys(data).length === 0 && toLink.length === 0 && toUnlink.length === 0) {
        const item = await tx.packingItem.findUniqueOrThrow({ where: { id: itemId }, select: detailSelect });
        return { status: "unchanged", item: toDetail(item) };
      }

      for (const tripDayId of toLink) await tx.packingItemDay.create({ data: { packingItemId: itemId, tripDayId } });
      if (toUnlink.length > 0) {
        await tx.packingItemDay.deleteMany({ where: { packingItemId: itemId, tripDayId: { in: toUnlink } } });
      }
      const updated = await tx.packingItem.update({
        where: { id: itemId },
        data: { ...data, aiChangedAt: new Date() },
        select: detailSelect,
      });
      await inTransaction(tx, {
        receipt: receiptOf([{ change: "updated", before: toSnapshot(current), updatedAt: updated.updatedAt }]),
      });
      return { status: "updated", item: toDetail(updated) };
    });
  } catch (error) {
    // A concurrent create or rename took the name between the check and the write. Only a rename can
    // clash on the name; any other unique violation (a day link added meanwhile) is not a name clash.
    if (params.name !== undefined && isUniqueViolation(error)) return { status: "duplicate_name" };
    throw error;
  }
};

export type PackingConnectorDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted"; id: string; name: string; dayCount: number };

/** `delete_packing_item`. Deletes the item and every day link, with the item's full state in the receipt. */
export const deletePackingItemForConnector = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  inTransaction: PackingInTransactionHook;
}): Promise<PackingConnectorDeleteResult> => {
  const { userId, tripId, itemId, inTransaction } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) return { status: "not_found" };

  return prisma.$transaction(async (tx): Promise<PackingConnectorDeleteResult> => {
    const current = await tx.packingItem.findFirst({ where: { id: itemId, tripId }, select: snapshotSelect });
    if (!current) return { status: "missing" };
    const removed = await tx.packingItem.deleteMany({ where: { id: itemId, tripId } });
    if (removed.count !== 1) return { status: "missing" };
    await inTransaction(tx, { receipt: receiptOf([{ change: "deleted", before: toSnapshot(current) }]) });
    return { status: "deleted", id: current.id, name: current.name, dayCount: current.days.length };
  });
};

export type PackingUndoResult =
  | { status: "undone" }
  | { status: "not_found" }
  | { status: "invalid" }
  | { status: "stale" };

/** Links the item to exactly those of `dayIds` that are still days of the trip. */
const restoreLinks = async (tx: TransactionClient, tripId: string, itemId: string, dayIds: string[]) => {
  const days = dayIds.length
    ? await tx.tripDay.findMany({ where: { id: { in: dayIds }, tripId }, select: { id: true } })
    : [];
  const keep = days.map((day) => day.id);
  await tx.packingItemDay.deleteMany({ where: { packingItemId: itemId, tripDayId: { notIn: keep } } });
  const present = await tx.packingItemDay.findMany({ where: { packingItemId: itemId }, select: { tripDayId: true } });
  const have = new Set(present.map((link) => link.tripDayId));
  for (const tripDayId of keep) {
    if (!have.has(tripDayId)) await tx.packingItemDay.create({ data: { packingItemId: itemId, tripDayId } });
  }
};

/**
 * Undoes one stored packing receipt in one transaction, newest entry first, then runs `inTransaction` (which
 * marks the change undone). `stale` when any touched item changed since (another `updatedAt`, gone, or a
 * restore would take another item's name); everything rolls back. `invalid` when an item id of the receipt
 * belongs to another trip. Restores each item's `updatedAt` and `aiChangedAt`, so undoing newest first works
 * across chained changes. A link to a day that no longer exists is not restored.
 */
export const undoPackingChangeForTrip = async (params: {
  userId: string;
  tripId: string;
  receipt: PackingChangeReceipt;
  inTransaction?: (tx: TransactionClient) => Promise<void>;
}): Promise<PackingUndoResult> => {
  const { userId, tripId, receipt, inTransaction } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) return { status: "not_found" };

  const ids = receipt.entries.map((entry) => (entry.change === "created" ? entry.itemId : entry.before.id));
  const foreign = await prisma.packingItem.count({ where: { id: { in: ids }, tripId: { not: tripId } } });
  if (foreign > 0) return { status: "invalid" };

  const sameStamp = (row: { updatedAt: Date } | null, stamp: Date) =>
    row !== null && row.updatedAt.getTime() === stamp.getTime();

  try {
    await prisma.$transaction(async (tx) => {
      for (const entry of [...receipt.entries].reverse()) {
        if (entry.change === "created") {
          const row = await tx.packingItem.findFirst({ where: { id: entry.itemId, tripId }, select: { updatedAt: true } });
          if (!sameStamp(row, entry.updatedAt)) throw new UndoStaleError("packing item changed since");
          await tx.packingItem.delete({ where: { id: entry.itemId } });
          continue;
        }
        const { before } = entry;
        if (entry.change === "updated") {
          const row = await tx.packingItem.findFirst({ where: { id: before.id, tripId }, select: { updatedAt: true } });
          if (!sameStamp(row, entry.updatedAt)) throw new UndoStaleError("packing item changed since");
          const clash = await tx.packingItem.findFirst({
            where: { tripId, nameKey: before.nameKey, id: { not: before.id } },
            select: { id: true },
          });
          if (clash) throw new UndoStaleError("packing item name taken since");
          await restoreLinks(tx, tripId, before.id, before.dayIds);
          await tx.packingItem.update({
            where: { id: before.id },
            data: {
              name: before.name,
              nameKey: before.nameKey,
              category: before.category,
              packed: before.packed,
              aiChangedAt: before.aiChangedAt,
              updatedAt: before.updatedAt,
            },
          });
          continue;
        }
        const taken = await tx.packingItem.findFirst({
          where: { OR: [{ id: before.id }, { tripId, nameKey: before.nameKey }] },
          select: { id: true },
        });
        if (taken) throw new UndoStaleError("packing item recreated or name taken since");
        await tx.packingItem.create({
          data: {
            id: before.id,
            tripId,
            name: before.name,
            nameKey: before.nameKey,
            category: before.category,
            packed: before.packed,
            aiChangedAt: before.aiChangedAt,
            createdAt: before.createdAt,
            updatedAt: before.updatedAt,
          },
        });
        await restoreLinks(tx, tripId, before.id, before.dayIds);
      }
      if (inTransaction) await inTransaction(tx);
    });
  } catch (error) {
    if (error instanceof UndoStaleError || isUniqueViolation(error)) return { status: "stale" };
    throw error;
  }
  return { status: "undone" };
};
