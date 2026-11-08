import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveTripAccessRole, type TripAccessRole } from "@/lib/auth/tripAccessRole";
import {
  PACKING_TAGS_PER_ITEM_MAX,
  dedupePackingTags,
  normalizePackingCategory,
  normalizePackingName,
  normalizePackingTag,
  packingNameKey,
  packingTagKey,
} from "@/lib/trips/packingList";
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
 *
 * Story 16.7 (FR58 amended) adds the third item state, "not needed this time" (`notNeeded`), and its
 * invariant: a not-needed item is never packed and never linked to a day. Every write here keeps it.
 * Marking an item not needed unticks it and removes its day links (the app confirms the day count first,
 * `days_changed` as for the delete); ticking or linking a not-needed item is refused (`not_needed`, nothing
 * written) unless the same request marks it needed again (`notNeeded: false` / `markNeeded`). The connector's
 * add with a day refuses the whole batch when a name is a not-needed item. Undo restores the snapshot's
 * `notNeeded`, which was read from a consistent row.
 *
 * Story 16.8 (FR58 amended) adds free tags (`PackingItemTag`, one row per tag, unique per item by key).
 * Across the trip a tag key keeps the spelling first stored (`resolveTags`, the twin of `resolveCategory`).
 * Every tag write path also writes the item (`aiChangedAt` per origin, `updatedAt` by Prisma), like a link
 * change: the app's add (a created item gets its tags; an existing name gets the missing ones added, D3),
 * the app's PATCH (full replacement), the connector's add (as the app's add) and update (`addTags` /
 * `removeTags`), and undo (restores the snapshot's tags when it has any; an older receipt has none, D5).
 * A merge that would leave an item with more than 10 tags is refused and writes nothing
 * (`PackingTagLimitError` → `too_many_tags`). State changes (pack, not needed) never touch tags.
 */

export type PackingItemDetail = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  /** Story 16.7. Kept on the list but not needed this time: then never packed and never linked to a day. */
  notNeeded: boolean;
  /** Story 16.8. The item's tags in tag-key order (the client sorts for display). */
  tags: string[];
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
  /** Story 16.8. Adding the tags to the existing item would leave it with more than 10; nothing written. */
  | { status: "too_many_tags" }
  | { status: "created"; item: PackingItemDetail }
  | { status: "existed"; item: PackingItemDetail };

export type PackingItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "duplicate_name" }
  /** Story 16.7. Marking not needed: the item's day links changed since the person confirmed their count. */
  | { status: "days_changed"; dayCount: number }
  /** Story 16.7. Ticking an item that is (and stays) not needed. */
  | { status: "not_needed" }
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
  /** Story 16.7. The item is not needed and the request did not say `markNeeded`. */
  | { status: "not_needed" }
  | { status: "linked"; item: PackingItemDetail };

export type PackingItemAddToDayResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  /** Story 16.7. The name is an existing not-needed item and the request did not say `markNeeded`. */
  | { status: "not_needed" }
  | { status: "created"; item: PackingItemDetail }
  | { status: "existed"; item: PackingItemDetail };

export type PackingItemUnlinkResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  | { status: "missing" }
  | { status: "unlinked"; item: PackingItemDetail };

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Story 16.8. A tag merge would leave an item with more than 10 tags. Thrown (never returned) so the whole
 * transaction rolls back, a batch's earlier creates included; `index` is the connector input it came from.
 */
export class PackingTagLimitError extends Error {
  constructor(readonly index = -1) {
    super("packing item would carry more than 10 tags");
    this.name = "PackingTagLimitError";
  }
}

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
  notNeeded: true,
  aiChangedAt: true,
  createdAt: true,
  updatedAt: true,
  // Prisma cannot order by a field of the related row through the link table; `toDetail` sorts.
  days: { select: { tripDay: { select: { id: true, dayIndex: true, date: true } } } },
  tags: { select: { tag: true, tagKey: true }, orderBy: { tagKey: "asc" } },
} as const;

type DetailRow = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  notNeeded: boolean;
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  days: { tripDay: PackingItemDayRef }[];
  tags: { tag: string; tagKey: string }[];
};

const toDetail = (row: DetailRow): PackingItemDetail => {
  const days = row.days.map((link) => link.tripDay).sort((a, b) => a.dayIndex - b.dayIndex);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    packed: row.packed,
    notNeeded: row.notNeeded,
    tags: row.tags.map((tag) => tag.tag),
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
 * Story 16.8. The tags as stored: for each given tag whose key another item of the trip already uses, that
 * item's earliest spelling (by row creation), else the given spelling, normalized. So "kaufen" joins
 * "Kaufen". `excludeItemId` keeps an item's own old spelling from blocking a case fix on it. The input is
 * expected deduplicated by key; order is kept.
 */
const resolveTags = async (
  tx: TransactionClient,
  tripId: string,
  tags: readonly string[],
  excludeItemId?: string,
): Promise<string[]> => {
  if (tags.length === 0) return [];
  const keys = tags.map(packingTagKey);
  const used = await tx.packingItemTag.findMany({
    where: {
      tagKey: { in: keys },
      packingItem: { tripId, ...(excludeItemId ? { id: { not: excludeItemId } } : {}) },
    },
    select: { tag: true, tagKey: true },
    orderBy: [{ createdAt: "asc" }, { packingItemId: "asc" }],
  });
  const spelling = new Map<string, string>();
  for (const row of used) if (!spelling.has(row.tagKey)) spelling.set(row.tagKey, row.tag);
  return tags.map((tag) => spelling.get(packingTagKey(tag)) ?? normalizePackingTag(tag));
};

/**
 * Story 16.8. Makes the item's tag rows exactly `nextTags` (by key): removed keys deleted, a changed
 * spelling updated, added keys created one by one (`createMany({ skipDuplicates })` is not available on
 * SQLite). Kept rows keep their `createdAt`, so the trip's first spelling stays stable. Answers whether
 * anything changed; the caller writes the item.
 */
const writeTagsInTx = async (tx: TransactionClient, itemId: string, nextTags: readonly string[]) => {
  const current = await tx.packingItemTag.findMany({
    where: { packingItemId: itemId },
    select: { tag: true, tagKey: true },
  });
  const have = new Map(current.map((row) => [row.tagKey, row.tag]));
  const next = new Map(nextTags.map((tag) => [packingTagKey(tag), normalizePackingTag(tag)]));
  const removed = current.filter((row) => !next.has(row.tagKey)).map((row) => row.tagKey);
  let changed = false;
  if (removed.length > 0) {
    await tx.packingItemTag.deleteMany({ where: { packingItemId: itemId, tagKey: { in: removed } } });
    changed = true;
  }
  for (const [tagKey, tag] of next) {
    const existing = have.get(tagKey);
    if (existing === undefined) {
      await tx.packingItemTag.create({ data: { packingItemId: itemId, tag, tagKey } });
      changed = true;
    } else if (existing !== tag) {
      await tx.packingItemTag.update({
        where: { packingItemId_tagKey: { packingItemId: itemId, tagKey } },
        data: { tag },
      });
      changed = true;
    }
  }
  return changed;
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

export type PackingItemForDay = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  /** Story 16.8. The item's tags in tag-key order (the day email sorts for display). */
  tags: string[];
};

/**
 * Story 16.3. The items linked to one day, in name-key order, with the four fields the day email groups
 * by - not the trip-wide read with every day link. Every participant reads (viewer included); the route
 * already checked read access, so the participant clause is defence in depth: a non-participant, or a day
 * of another trip, gets `[]`. Story 16.7: a not-needed item is never linked; `notNeeded: false` is defence in
 * depth too, so the day email never shows one.
 */
export const listPackingItemsForDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<PackingItemForDay[]> => {
  const { userId, tripId, tripDayId } = params;
  const rows = await prisma.packingItem.findMany({
    where: {
      tripId,
      notNeeded: false,
      days: { some: { tripDayId } },
      trip: { OR: [{ userId }, { members: { some: { userId } } }] },
    },
    select: {
      id: true,
      name: true,
      category: true,
      packed: true,
      tags: { select: { tag: true }, orderBy: { tagKey: "asc" } },
    },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ ...row, tags: row.tags.map((tag) => tag.tag) }));
};

/**
 * The item named `name` on the trip: the existing one (`existed`, unchanged - its category and packed
 * state stay) or a new unpacked one (`created`). Shared by the list's add and the day's add, so the
 * duplicate-name rule lives in one place. A concurrent create of the same name throws `P2002`; callers
 * resolve the winner.
 *
 * Story 16.8: a created item gets `tags` (resolved to the trip's spellings). With `mergeTags` (the list's
 * add and the connector's add, D3), an `existed` item gets the given tags it lacks added, and the item is
 * written (`tagsAdded`); more than 10 after the merge throws `PackingTagLimitError`, so nothing is written.
 * Without `mergeTags` (the day's add) an existing item stays unchanged.
 */
const createOrResolveInTx = async (
  tx: TransactionClient,
  params: {
    tripId: string;
    name: string;
    category?: string | null;
    tags?: readonly string[];
    mergeTags?: boolean;
    origin: WriteOrigin;
  },
): Promise<{ status: "created" | "existed"; item: PackingItemDetail; tagsAdded: boolean }> => {
  const name = normalizePackingName(params.name);
  const nameKey = packingNameKey(name);
  const tags = dedupePackingTags(params.tags ?? []);
  const existing = await tx.packingItem.findUnique({
    where: { tripId_nameKey: { tripId: params.tripId, nameKey } },
    select: detailSelect,
  });
  if (existing) {
    const haveKeys = new Set(existing.tags.map((row) => row.tagKey));
    const missing = params.mergeTags ? tags.filter((tag) => !haveKeys.has(packingTagKey(tag))) : [];
    if (missing.length === 0) return { status: "existed", item: toDetail(existing), tagsAdded: false };
    if (existing.tags.length + missing.length > PACKING_TAGS_PER_ITEM_MAX) throw new PackingTagLimitError();
    const resolved = await resolveTags(tx, params.tripId, missing, existing.id);
    for (const tag of resolved) {
      await tx.packingItemTag.create({ data: { packingItemId: existing.id, tag, tagKey: packingTagKey(tag) } });
    }
    return { status: "existed", item: await touchItem(tx, existing.id, params.origin), tagsAdded: true };
  }

  const category = await resolveCategory(tx, params.tripId, params.category);
  const resolvedTags = await resolveTags(tx, params.tripId, tags);
  const created = await tx.packingItem.create({
    data: {
      tripId: params.tripId,
      name,
      nameKey,
      category,
      aiChangedAt: aiChangedAtFor(params.origin, new Date()),
      ...(resolvedTags.length > 0
        ? { tags: { create: resolvedTags.map((tag) => ({ tag, tagKey: packingTagKey(tag) })) } }
        : {}),
    },
    select: detailSelect,
  });
  return { status: "created", item: toDetail(created), tagsAdded: false };
};

/**
 * Adds an item, or answers the existing one when the trip already has the name (ignoring case and
 * surrounding spaces) - `existed`, nothing written. A concurrent create of the same name loses on the
 * unique index and answers the winner as `existed` too.
 *
 * Story 16.8 (D3): `tags` go on a new item, and onto an existing one as a merge (only the missing ones are
 * added; the item is then written). A merge past 10 tags is `too_many_tags`, nothing written. A lost race
 * on a unique index (the name, or the same tag added meanwhile) reruns once, so the merge applies to the
 * winner; a second loss falls back to answering the winner as before.
 */
export const createPackingItem = async (params: {
  userId: string;
  tripId: string;
  name: string;
  category?: string | null;
  tags?: string[];
  origin: WriteOrigin;
}): Promise<PackingItemCreateResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  try {
    return await retryOnceOnUniqueViolation(async () => {
      const { status, item } = await prisma.$transaction((tx) =>
        createOrResolveInTx(tx, { ...params, mergeTags: true }),
      );
      return { status, item };
    });
  } catch (error) {
    // Checked first: the tag limit is not a name race.
    if (error instanceof PackingTagLimitError) return { status: "too_many_tags" };
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
 *
 * Story 16.7: `notNeeded: true` marks the item not needed - unticked, and removed from every day it is
 * linked to. With `confirmedDayCount` (the app), a linked item whose day count differs from the confirmed
 * one is `days_changed` and nothing is written. `notNeeded: false` marks it needed again (open, never
 * packed). `packed: true` on an item that is and stays not needed is `not_needed`, nothing written.
 *
 * Story 16.8: `tags` replaces the item's tags (the schema caps them at 10), each resolved to the trip's
 * spelling except the item's own (a case fix). Marking packed or not needed never touches tags.
 */
export const updatePackingItem = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  name?: string;
  category?: string | null;
  packed?: boolean;
  notNeeded?: boolean;
  tags?: string[];
  confirmedDayCount?: number;
  origin: WriteOrigin;
}): Promise<PackingItemUpdateResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  const run = () =>
    prisma.$transaction(async (tx): Promise<PackingItemUpdateResult> => {
      const current = await tx.packingItem.findFirst({
        where: { id: params.itemId, tripId: params.tripId },
        select: { id: true, notNeeded: true, _count: { select: { days: true } } },
      });
      if (!current) return { status: "missing" };

      // Story 16.7. Every refusal is decided before anything is written.
      if (params.packed === true && (params.notNeeded ?? current.notNeeded)) return { status: "not_needed" };
      const dayCount = current._count.days;
      if (
        params.notNeeded === true &&
        params.confirmedDayCount !== undefined &&
        dayCount > 0 &&
        dayCount !== params.confirmedDayCount
      ) {
        return { status: "days_changed", dayCount };
      }

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

      if (params.notNeeded === true) {
        data.notNeeded = true;
        data.packed = false;
        if (dayCount > 0) await tx.packingItemDay.deleteMany({ where: { packingItemId: params.itemId } });
      } else if (params.notNeeded === false) {
        data.notNeeded = false;
      }

      if (params.tags !== undefined) {
        const tags = dedupePackingTags(params.tags);
        await writeTagsInTx(tx, params.itemId, await resolveTags(tx, params.tripId, tags, params.itemId));
      }

      const updated = await tx.packingItem.update({ where: { id: params.itemId }, data, select: detailSelect });
      return { status: "updated", item: toDetail(updated) };
    });

  try {
    // Story 16.8. A unique violation is a concurrent create or rename taking the name, or the same tag added
    // meanwhile. The rerun tells them apart: its own clash check answers a name taken meanwhile as
    // `duplicate_name`, and a tag added meanwhile is then simply kept.
    return await retryOnceOnUniqueViolation(run);
  } catch (error) {
    // Lost twice: only a rename can clash on the name.
    if (params.name !== undefined && isUniqueViolation(error)) return { status: "duplicate_name" };
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

/**
 * Writes the item after a link change: `aiChangedAt` per origin, `updatedAt` by Prisma. Story 16.7:
 * `markNeeded` folds marking the item needed again into the same write.
 */
const touchItem = async (tx: TransactionClient, itemId: string, origin: WriteOrigin, markNeeded = false) =>
  toDetail(
    await tx.packingItem.update({
      where: { id: itemId },
      data: { aiChangedAt: aiChangedAtFor(origin, new Date()), ...(markNeeded ? { notNeeded: false } : {}) },
      select: detailSelect,
    }),
  );

/**
 * Links the item to the day unless it already is; writes the item only when a link was created, or when
 * `markNeeded` (Story 16.7: the item is not needed and the request marks it needed again).
 */
const linkInTx = async (
  tx: TransactionClient,
  itemId: string,
  tripDayId: string,
  origin: WriteOrigin,
  markNeeded = false,
) => {
  const link = await tx.packingItemDay.findUnique({
    where: { packingItemId_tripDayId: { packingItemId: itemId, tripDayId } },
    select: { packingItemId: true },
  });
  if (!link) {
    await tx.packingItemDay.create({ data: { packingItemId: itemId, tripDayId } });
    return touchItem(tx, itemId, origin, markNeeded);
  }
  if (markNeeded) return touchItem(tx, itemId, origin, true);
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
 *
 * Story 16.7: a not-needed item is `not_needed` (nothing written), unless `markNeeded`: then it is marked
 * needed and linked in one write.
 */
export const linkPackingItemToDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
  markNeeded?: boolean;
  origin: WriteOrigin;
}): Promise<PackingItemLinkResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  return retryOnceOnUniqueViolation(() =>
    prisma.$transaction(async (tx): Promise<PackingItemLinkResult> => {
      if (!(await dayOfTrip(tx, params.tripId, params.tripDayId))) return { status: "day_missing" };
      const item = await tx.packingItem.findFirst({
        where: { id: params.itemId, tripId: params.tripId },
        select: { id: true, notNeeded: true },
      });
      if (!item) return { status: "missing" };
      if (item.notNeeded && !params.markNeeded) return { status: "not_needed" };
      return {
        status: "linked",
        item: await linkInTx(tx, item.id, params.tripDayId, params.origin, item.notNeeded),
      };
    }),
  );
};

/**
 * Story 16.2. Adds `name` to the day: the trip's item of that name (ignoring case and surrounding spaces;
 * its category and packed state unchanged) or a new unpacked one, then links it. Never a second item of
 * the same name.
 *
 * Story 16.7: when the name is an existing not-needed item, `not_needed` (nothing written) unless
 * `markNeeded`, which marks it needed and links it in one write. A just-created item is always needed.
 */
export const addPackingItemToDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  name: string;
  category?: string | null;
  markNeeded?: boolean;
  origin: WriteOrigin;
}): Promise<PackingItemAddToDayResult> => {
  const trip = await findTripForTripWriter(params.userId, params.tripId);
  if (!trip) return { status: "not_found" };

  return retryOnceOnUniqueViolation(() =>
    prisma.$transaction(async (tx): Promise<PackingItemAddToDayResult> => {
      if (!(await dayOfTrip(tx, params.tripId, params.tripDayId))) return { status: "day_missing" };
      const resolved = await createOrResolveInTx(tx, params);
      // Only a resolved item can be not needed; `existed` wrote nothing, so the refusal writes nothing.
      const notNeeded = resolved.status === "existed" && resolved.item.notNeeded;
      if (notNeeded && !params.markNeeded) return { status: "not_needed" };
      const item = await linkInTx(tx, resolved.item.id, params.tripDayId, params.origin, notNeeded);
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
  notNeeded: true,
  aiChangedAt: true,
  createdAt: true,
  updatedAt: true,
  days: { select: { tripDayId: true } },
  tags: { select: { tag: true, tagKey: true }, orderBy: { tagKey: "asc" } },
} as const;

const toSnapshot = (row: {
  id: string;
  name: string;
  nameKey: string;
  category: string | null;
  packed: boolean;
  notNeeded: boolean;
  aiChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  days: { tripDayId: string }[];
  tags: { tag: string; tagKey: string }[];
}): PackingItemSnapshot => ({
  id: row.id,
  name: row.name,
  nameKey: row.nameKey,
  category: row.category,
  packed: row.packed,
  notNeeded: row.notNeeded,
  aiChangedAt: row.aiChangedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  dayIds: row.days.map((link) => link.tripDayId),
  tags: row.tags.map((tag) => tag.tag),
});

const receiptOf = (entries: PackingReceiptEntry[]): PackingChangeReceipt => ({
  kind: "packingChanged",
  version: 1,
  entries,
});

export type PackingConnectorAddResult =
  | { status: "not_found" }
  | { status: "day_missing" }
  /** Story 16.7. With a day, the input at `index` names a not-needed item; nothing was written. */
  | { status: "not_needed"; index: number }
  /** Story 16.8. The input at `index` would leave its item with more than 10 tags; nothing was written. */
  | { status: "too_many_tags"; index: number }
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
 *
 * Story 16.7: with `tripDayId`, a name that resolves to a not-needed item refuses the whole call
 * (`not_needed` with the first such input's index), decided before anything is written.
 *
 * Story 16.8: an input's `tags` go on a created item, and are added to an existing one (an `updated` entry
 * when a tag was actually added). A merge past 10 tags refuses the whole call (`too_many_tags` with that
 * input's index): it throws, so the batch's earlier creates roll back too.
 */
export const addPackingItemsForConnector = async (params: {
  userId: string;
  tripId: string;
  items: { name: string; category?: string | null; tags?: string[] }[];
  tripDayId?: string;
  inTransaction: PackingInTransactionHook;
}): Promise<PackingConnectorAddResult> => {
  const { userId, tripId, tripDayId, inTransaction } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) return { status: "not_found" };

  const addInTx = () =>
    prisma.$transaction(async (tx): Promise<PackingConnectorAddResult> => {
      if (tripDayId !== undefined && !(await dayOfTrip(tx, tripId, tripDayId))) return { status: "day_missing" };

      if (tripDayId !== undefined) {
        // Before any write: a return after a create would commit half the batch (only a throw rolls back).
        const keys = params.items.map((input) => packingNameKey(normalizePackingName(input.name)));
        const notNeeded = await tx.packingItem.findMany({
          where: { tripId, notNeeded: true, nameKey: { in: keys } },
          select: { nameKey: true },
        });
        if (notNeeded.length > 0) {
          const refused = new Set(notNeeded.map((row) => row.nameKey));
          return { status: "not_needed", index: keys.findIndex((key) => refused.has(key)) };
        }
      }

      const entries = new Map<string, PackingReceiptEntry>();
      const results: { name: string; itemId: string; status: "created" | "existed" }[] = [];
      const order: string[] = [];

      for (const [index, input] of params.items.entries()) {
        const nameKey = packingNameKey(normalizePackingName(input.name));
        // The item's state before this call, read before the resolve: only an existing item has one.
        const before = await tx.packingItem.findUnique({
          where: { tripId_nameKey: { tripId, nameKey } },
          select: snapshotSelect,
        });
        let resolved: Awaited<ReturnType<typeof createOrResolveInTx>>;
        try {
          resolved = await createOrResolveInTx(tx, {
            tripId,
            name: input.name,
            category: input.category,
            tags: input.tags,
            mergeTags: true,
            origin: "ai",
          });
        } catch (error) {
          // A throw, never a return: it rolls back the creates made earlier in the batch.
          if (error instanceof PackingTagLimitError) throw new PackingTagLimitError(index);
          throw error;
        }
        const itemId = resolved.item.id;
        results.push({ name: input.name, itemId, status: resolved.status });
        if (!order.includes(itemId)) order.push(itemId);
        if (resolved.status === "created") {
          entries.set(itemId, { change: "created", itemId, updatedAt: resolved.item.updatedAt });
        }
        if (resolved.tagsAdded && !entries.has(itemId) && before) {
          entries.set(itemId, { change: "updated", before: toSnapshot(before), updatedAt: before.updatedAt });
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
    });

  try {
    return await retryOnceOnUniqueViolation(addInTx);
  } catch (error) {
    if (error instanceof PackingTagLimitError) return { status: "too_many_tags", index: error.index };
    throw error;
  }
};

export type PackingConnectorUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "day_missing" }
  | { status: "duplicate_name" }
  /** Story 16.7. Ticking or linking an item that is, or would end up, not needed; nothing written. */
  | { status: "not_needed" }
  /** Story 16.8. The tags would end up more than 10; nothing written. */
  | { status: "too_many_tags" }
  | { status: "unchanged"; item: PackingItemDetail }
  | { status: "updated"; item: PackingItemDetail };

/**
 * `update_packing_item`. Changes only the given fields, under the app's rules (rename clash, category
 * spelling, "Other" as `null`), and links or unlinks days, checked against the `updatedAt` the caller read
 * (`ChangedSinceReadError` otherwise, nothing written). A call that changes nothing writes nothing and
 * runs no hook (`unchanged`).
 *
 * Story 16.7: `notNeeded: true` unticks the item and removes every day link (whatever `removeDayIds` says);
 * `notNeeded: false` marks it needed again. `packed: true` or `addDayIds` on an item that is, or would end
 * up, not needed is `not_needed`, nothing written.
 *
 * Story 16.8: `addTags` adds the tags the item lacks (ignoring case; resolved to the trip's spelling),
 * `removeTags` removes the given ones it has; both no-ops otherwise. More than 10 at the end is
 * `too_many_tags`, decided before anything is written. The caller refuses a tag in both lists.
 */
export const updatePackingItemForConnector = async (params: {
  userId: string;
  tripId: string;
  itemId: string;
  expectedUpdatedAt: Date;
  name?: string;
  category?: string | null;
  packed?: boolean;
  notNeeded?: boolean;
  addDayIds?: string[];
  removeDayIds?: string[];
  addTags?: string[];
  removeTags?: string[];
  inTransaction: PackingInTransactionHook;
}): Promise<PackingConnectorUpdateResult> => {
  const { userId, tripId, itemId, inTransaction } = params;
  const trip = await findTripForTripWriter(userId, tripId);
  if (!trip) return { status: "not_found" };

  const run = () =>
    prisma.$transaction(async (tx): Promise<PackingConnectorUpdateResult> => {
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

      const endsNotNeeded = params.notNeeded ?? current.notNeeded;
      if (endsNotNeeded && (addDayIds.length > 0 || params.packed === true)) return { status: "not_needed" };

      // Story 16.8. The next tag set, checked against the limit before anything is written.
      const removeTagKeys = new Set((params.removeTags ?? []).map(packingTagKey));
      const keptTags = current.tags.filter((row) => !removeTagKeys.has(row.tagKey));
      const keptTagKeys = new Set(keptTags.map((row) => row.tagKey));
      const addedTags = dedupePackingTags(params.addTags ?? []).filter((tag) => !keptTagKeys.has(packingTagKey(tag)));
      const tagsChanged = addedTags.length > 0 || keptTags.length !== current.tags.length;
      if (keptTags.length + addedTags.length > PACKING_TAGS_PER_ITEM_MAX) return { status: "too_many_tags" };

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
      const markingNotNeeded = params.notNeeded === true && !current.notNeeded;
      if (markingNotNeeded) {
        data.notNeeded = true;
        if (current.packed) data.packed = false;
      }
      if (params.notNeeded === false && current.notNeeded) data.notNeeded = false;

      const linked = new Set(current.days.map((link) => link.tripDayId));
      const toLink = addDayIds.filter((id) => !linked.has(id));
      const toUnlink = markingNotNeeded ? [...linked] : removeDayIds.filter((id) => linked.has(id));

      if (Object.keys(data).length === 0 && toLink.length === 0 && toUnlink.length === 0 && !tagsChanged) {
        const item = await tx.packingItem.findUniqueOrThrow({ where: { id: itemId }, select: detailSelect });
        return { status: "unchanged", item: toDetail(item) };
      }

      for (const tripDayId of toLink) await tx.packingItemDay.create({ data: { packingItemId: itemId, tripDayId } });
      if (toUnlink.length > 0) {
        await tx.packingItemDay.deleteMany({ where: { packingItemId: itemId, tripDayId: { in: toUnlink } } });
      }
      if (tagsChanged) {
        const resolvedAdded = await resolveTags(tx, tripId, addedTags, itemId);
        await writeTagsInTx(tx, itemId, [...keptTags.map((row) => row.tag), ...resolvedAdded]);
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

  try {
    // Story 16.8. A unique violation (a name, day link or tag taken meanwhile) reruns once: the rerun's
    // stale check and clash check give the precise answer.
    return await retryOnceOnUniqueViolation(run);
  } catch (error) {
    // Lost twice: only a rename can clash on the name; any other unique violation is not a name clash.
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
 * Story 16.8. Makes the item's tags exactly `tags`, in order. Called only for a snapshot that has tags; a
 * receipt from before 16.8 leaves the tags as they are (D5).
 */
const restoreTags = async (tx: TransactionClient, itemId: string, tags: readonly string[]) => {
  await tx.packingItemTag.deleteMany({ where: { packingItemId: itemId } });
  for (const tag of tags) {
    await tx.packingItemTag.create({ data: { packingItemId: itemId, tag, tagKey: packingTagKey(tag) } });
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
          // Before the item write that puts `updatedAt` back, so nothing bumps the stamp afterwards.
          if (before.tags !== undefined) await restoreTags(tx, before.id, before.tags);
          await tx.packingItem.update({
            where: { id: before.id },
            data: {
              name: before.name,
              nameKey: before.nameKey,
              category: before.category,
              packed: before.packed,
              notNeeded: before.notNeeded,
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
            notNeeded: before.notNeeded,
            aiChangedAt: before.aiChangedAt,
            createdAt: before.createdAt,
            updatedAt: before.updatedAt,
          },
        });
        await restoreLinks(tx, tripId, before.id, before.dayIds);
        if (before.tags !== undefined) await restoreTags(tx, before.id, before.tags);
      }
      if (inTransaction) await inTransaction(tx);
    });
  } catch (error) {
    if (error instanceof UndoStaleError || isUniqueViolation(error)) return { status: "stale" };
    throw error;
  }
  return { status: "undone" };
};
