import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  addPackingItemsForConnector,
  addPackingItemToDay,
  createPackingItem,
  deletePackingItemForConnector,
  undoPackingChangeForTrip,
  updatePackingItemForConnector,
  type PackingInTransactionHook,
  deletePackingItem,
  linkPackingItemToDay,
  listPackingItemsForDay,
  listPackingItemsForTrip,
  unlinkPackingItemFromDay,
  updatePackingItem,
} from "@/lib/repositories/packingListRepo";
import { updateTripWithDays } from "@/lib/repositories/tripRepo";
import type { PackingChangeReceipt } from "@/lib/trips/packingChangeReceipt";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";

/** Story 16.1 (FR58). The packing list repository: writes, duplicates, categories, access. */

let counter = 0;
const createUser = (label: string) =>
  prisma.user.create({
    data: { email: `packing-repo-${label}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });

const createTrip = (userId: string) =>
  prisma.trip.create({
    data: {
      userId,
      name: "Packing Repo Trip",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-03T00:00:00.000Z"),
    },
  });

const createDays = (tripId: string, count: number) =>
  Promise.all(
    Array.from({ length: count }, (_, index) =>
      prisma.tripDay.create({
        data: { tripId, dayIndex: index + 1, date: new Date(Date.UTC(2026, 11, 1 + index)) },
      }),
    ),
  );

const add = async (userId: string, tripId: string, name: string, category?: string | null) => {
  const result = await createPackingItem({ userId, tripId, name, category, origin: "user" });
  if (result.status === "not_found") throw new Error("unexpected not_found");
  return result;
};

describe("packingListRepo (Story 16.1)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates an item, trimmed, with no day links and no AI marker", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);

    const result = await add(owner.id, trip.id, "  Taucherbrille  ", " Sport ");

    expect(result.status).toBe("created");
    expect(result.item).toMatchObject({ name: "Taucherbrille", category: "Sport", packed: false, dayCount: 0, aiChangedAt: null });
    expect(await prisma.packingItem.findUniqueOrThrow({ where: { id: result.item.id } })).toMatchObject({
      nameKey: "taucherbrille",
    });
  });

  it("resolves a duplicate name (case, spaces) to the existing item and writes nothing", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const first = await add(owner.id, trip.id, "Taucherbrille");

    const second = await add(owner.id, trip.id, "  TAUCHERBRILLE ", "Sport");

    expect(second).toMatchObject({ status: "existed", item: { id: first.item.id, name: "Taucherbrille", category: null } });
    expect(await prisma.packingItem.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("keeps the same name apart on two trips", async () => {
    const owner = await createUser("owner");
    const tripA = await createTrip(owner.id);
    const tripB = await createTrip(owner.id);
    await add(owner.id, tripA.id, "Pass");
    expect((await add(owner.id, tripB.id, "Pass")).status).toBe("created");
  });

  it("stores Sonstiges/Other as no category and reuses an existing spelling", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    await add(owner.id, trip.id, "Ladekabel", "Technik");

    expect((await add(owner.id, trip.id, "Adapter", "technik")).item.category).toBe("Technik");
    expect((await add(owner.id, trip.id, "Schirm", "Sonstiges")).item.category).toBeNull();
    expect((await add(owner.id, trip.id, "Mütze", "OTHER")).item.category).toBeNull();
    expect((await add(owner.id, trip.id, "Buch", "  ")).item.category).toBeNull();
  });

  it("renames, refuses a rename onto another item, allows a case fix of its own name", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const pass = await add(owner.id, trip.id, "Pass");
    const brille = await add(owner.id, trip.id, "taucherbrille");

    const refused = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: brille.item.id, name: " PASS ", origin: "user" });
    expect(refused).toEqual({ status: "duplicate_name" });
    expect(await prisma.packingItem.findUniqueOrThrow({ where: { id: brille.item.id } })).toMatchObject({
      name: "taucherbrille",
      nameKey: "taucherbrille",
    });

    const caseFix = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: brille.item.id, name: "Taucherbrille", origin: "user" });
    expect(caseFix).toMatchObject({ status: "updated", item: { name: "Taucherbrille" } });

    const renamed = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: pass.item.id, name: "Reisepass", origin: "user" });
    expect(renamed).toMatchObject({ status: "updated", item: { name: "Reisepass" } });
    expect(await prisma.packingItem.findUniqueOrThrow({ where: { id: pass.item.id } })).toMatchObject({ nameKey: "reisepass" });
  });

  it("changes and clears the category, joining an existing spelling", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    await add(owner.id, trip.id, "Ladekabel", "Technik");
    const adapter = await add(owner.id, trip.id, "Adapter");

    const changed = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: adapter.item.id, category: "TECHNIK", origin: "user" });
    expect(changed).toMatchObject({ status: "updated", item: { category: "Technik", name: "Adapter" } });

    const cleared = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: adapter.item.id, category: null, origin: "user" });
    expect(cleared).toMatchObject({ status: "updated", item: { category: null } });

    const clearedEmpty = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: adapter.item.id, category: "Technik", origin: "user" });
    expect(clearedEmpty).toMatchObject({ item: { category: "Technik" } });
    expect(
      await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: adapter.item.id, category: "", origin: "user" }),
    ).toMatchObject({ item: { category: null } });
  });

  it("lets the only item of a category fix that category's case", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const item = await add(owner.id, trip.id, "Ladekabel", "technik");
    const fixed = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: item.item.id, category: "Technik", origin: "user" });
    expect(fixed).toMatchObject({ item: { category: "Technik" } });
  });

  it("ticks and unticks", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const item = await add(owner.id, trip.id, "Pass");

    expect(await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: item.item.id, packed: true, origin: "user" })).toMatchObject({
      item: { packed: true, name: "Pass" },
    });
    expect(await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: item.item.id, packed: false, origin: "user" })).toMatchObject({
      item: { packed: false },
    });
  });

  it("clears the AI marker on an app edit", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const seeded = await prisma.packingItem.create({
      data: { tripId: trip.id, name: "Pass", nameKey: "pass", aiChangedAt: new Date("2026-11-01T10:00:00.000Z") },
    });

    const listed = await listPackingItemsForTrip({ userId: owner.id, tripId: trip.id });
    expect(listed?.items[0].aiChangedAt).toEqual(new Date("2026-11-01T10:00:00.000Z"));

    const updated = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: seeded.id, packed: true, origin: "user" });
    expect(updated).toMatchObject({ item: { aiChangedAt: null } });
  });

  it("deletes an item without links and one with two day links, leaving the rest", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2] = await createDays(trip.id, 2);
    const lonely = await add(owner.id, trip.id, "Pass");
    const linked = await add(owner.id, trip.id, "Taucherbrille");
    const other = await add(owner.id, trip.id, "Schnorchel");
    await prisma.packingItemDay.createMany({
      data: [
        { packingItemId: linked.item.id, tripDayId: day1.id },
        { packingItemId: linked.item.id, tripDayId: day2.id },
        { packingItemId: other.item.id, tripDayId: day1.id },
      ],
    });

    const listed = await listPackingItemsForTrip({ userId: owner.id, tripId: trip.id });
    expect(listed?.items.find((entry) => entry.id === linked.item.id)?.dayCount).toBe(2);

    expect(await deletePackingItem({ userId: owner.id, tripId: trip.id, itemId: lonely.item.id })).toEqual({ status: "deleted" });
    expect(await deletePackingItem({ userId: owner.id, tripId: trip.id, itemId: linked.item.id })).toEqual({ status: "deleted" });

    expect(await prisma.packingItemDay.findMany({ where: { packingItemId: linked.item.id } })).toEqual([]);
    expect(await prisma.packingItem.findMany({ where: { tripId: trip.id }, select: { id: true } })).toEqual([{ id: other.item.id }]);
    expect(await prisma.packingItemDay.count({ where: { packingItemId: other.item.id } })).toBe(1);
    expect(await prisma.tripDay.count({ where: { tripId: trip.id } })).toBe(2);
  });

  it("answers missing for an unknown item or one of another trip", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const otherTrip = await createTrip(owner.id);
    const foreign = await add(owner.id, otherTrip.id, "Pass");

    expect(await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: foreign.item.id, packed: true, origin: "user" })).toEqual({
      status: "missing",
    });
    expect(await deletePackingItem({ userId: owner.id, tripId: trip.id, itemId: "nope" })).toEqual({ status: "missing" });
    expect(await prisma.packingItem.count({ where: { id: foreign.item.id } })).toBe(1);
  });

  it("lets a contributor write, a viewer only read, a stranger nothing", async () => {
    const owner = await createUser("owner");
    const contributor = await createUser("contributor");
    const viewer = await createUser("viewer");
    const stranger = await createUser("stranger");
    const trip = await createTrip(owner.id);
    await prisma.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
        { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
      ],
    });

    const created = await add(contributor.id, trip.id, "Pass");
    expect(created.status).toBe("created");
    expect(
      await updatePackingItem({ userId: contributor.id, tripId: trip.id, itemId: created.item.id, packed: true, origin: "user" }),
    ).toMatchObject({ status: "updated" });

    expect(await createPackingItem({ userId: viewer.id, tripId: trip.id, name: "Mütze", origin: "user" })).toEqual({ status: "not_found" });
    expect(await updatePackingItem({ userId: viewer.id, tripId: trip.id, itemId: created.item.id, packed: false, origin: "user" })).toEqual({
      status: "not_found",
    });
    expect(await deletePackingItem({ userId: viewer.id, tripId: trip.id, itemId: created.item.id })).toEqual({ status: "not_found" });

    expect(await listPackingItemsForTrip({ userId: owner.id, tripId: trip.id })).toMatchObject({ accessRole: "owner" });
    expect(await listPackingItemsForTrip({ userId: contributor.id, tripId: trip.id })).toMatchObject({ accessRole: "contributor" });
    expect(await listPackingItemsForTrip({ userId: viewer.id, tripId: trip.id })).toMatchObject({
      accessRole: "viewer",
      items: [{ name: "Pass", packed: true }],
    });
    expect(await listPackingItemsForTrip({ userId: stranger.id, tripId: trip.id })).toBeNull();
    expect(await createPackingItem({ userId: stranger.id, tripId: trip.id, name: "X", origin: "user" })).toEqual({ status: "not_found" });
  });

  it("lists items in name order", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    await add(owner.id, trip.id, "Zelt");
    await add(owner.id, trip.id, "adapter");
    await add(owner.id, trip.id, "Mütze");
    const listed = await listPackingItemsForTrip({ userId: owner.id, tripId: trip.id });
    expect(listed?.items.map((entry) => entry.name)).toEqual(["adapter", "Mütze", "Zelt"]);
  });
});

describe("packingListRepo day links (Story 16.2)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  const linkRows = (itemId: string) =>
    prisma.packingItemDay.findMany({ where: { packingItemId: itemId }, select: { tripDayId: true } });

  it("links an existing item, bumping updatedAt and clearing the AI marker", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1] = await createDays(trip.id, 1);
    const seeded = await prisma.packingItem.create({
      data: {
        tripId: trip.id,
        name: "Pass",
        nameKey: "pass",
        aiChangedAt: new Date("2026-11-01T10:00:00.000Z"),
        updatedAt: new Date("2026-11-01T10:00:00.000Z"),
      },
    });

    const result = await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: seeded.id, origin: "user" });

    expect(result.status).toBe("linked");
    if (result.status !== "linked") throw new Error("unreachable");
    expect(result.item).toMatchObject({ id: seeded.id, dayCount: 1, aiChangedAt: null });
    expect(result.item.days).toEqual([{ id: day1.id, dayIndex: 1, date: day1.date }]);
    expect(result.item.updatedAt.getTime()).toBeGreaterThan(new Date("2026-11-01T10:00:00.000Z").getTime());
    expect(await linkRows(seeded.id)).toEqual([{ tripDayId: day1.id }]);
  });

  it("treats a re-link as a no-op: no second row, updatedAt unchanged", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1] = await createDays(trip.id, 1);
    const item = await add(owner.id, trip.id, "Pass");
    const first = await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" });
    if (first.status !== "linked") throw new Error("unexpected");

    const again = await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" });

    expect(again.status).toBe("linked");
    if (again.status !== "linked") throw new Error("unreachable");
    expect(again.item.updatedAt).toEqual(first.item.updatedAt);
    expect(again.item.dayCount).toBe(1);
    expect(await prisma.packingItemDay.count()).toBe(1);
  });

  it("adds a new item from the day: unpacked, linked", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1] = await createDays(trip.id, 1);
    await add(owner.id, trip.id, "Ladekabel", "Technik");

    const result = await addPackingItemToDay({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day1.id,
      name: " Adapter ",
      category: "technik",
      origin: "user",
    });

    expect(result).toMatchObject({ status: "created", item: { name: "Adapter", category: "Technik", packed: false, dayCount: 1 } });
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.item.days.map((day) => day.id)).toEqual([day1.id]);
  });

  it("adds an existing name (other case, spaces) by linking the existing item, unchanged", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1] = await createDays(trip.id, 1);
    const existing = await add(owner.id, trip.id, "Taucherbrille", "Sport");
    await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: existing.item.id, packed: true, origin: "user" });

    const result = await addPackingItemToDay({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day1.id,
      name: "  TAUCHERBRILLE ",
      category: "Wasser",
      origin: "user",
    });

    expect(result).toMatchObject({
      status: "existed",
      item: { id: existing.item.id, name: "Taucherbrille", category: "Sport", packed: true, dayCount: 1 },
    });
    expect(await prisma.packingItem.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("links an item to several days, sorted by day index", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2, day3] = await createDays(trip.id, 3);
    const item = await add(owner.id, trip.id, "Pass");
    for (const day of [day3, day1]) {
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day.id, itemId: item.item.id, origin: "user" });
    }

    const listed = await listPackingItemsForTrip({ userId: owner.id, tripId: trip.id });
    expect(listed?.items[0].dayCount).toBe(2);
    expect(listed?.items[0].days.map((day) => day.id)).toEqual([day1.id, day3.id]);
    expect(listed?.items[0].days.some((day) => day.id === day2.id)).toBe(false);
  });

  it("unlinks only this day's link, keeping the item and its other day", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2] = await createDays(trip.id, 2);
    const item = await add(owner.id, trip.id, "Pass");
    for (const day of [day1, day2]) {
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day.id, itemId: item.item.id, origin: "user" });
    }

    const result = await unlinkPackingItemFromDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" });

    expect(result).toMatchObject({ status: "unlinked", item: { id: item.item.id, dayCount: 1 } });
    expect(await linkRows(item.item.id)).toEqual([{ tripDayId: day2.id }]);
    expect(await prisma.packingItem.count({ where: { id: item.item.id } })).toBe(1);
  });

  it("answers unlinked for a link already gone, without bumping the item", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1] = await createDays(trip.id, 1);
    const item = await add(owner.id, trip.id, "Pass");

    const result = await unlinkPackingItemFromDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" });

    expect(result.status).toBe("unlinked");
    if (result.status !== "unlinked") throw new Error("unreachable");
    expect(result.item.updatedAt).toEqual(item.item.updatedAt);
  });

  it("refuses a day of another trip and an item of another trip, writing nothing", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const otherTrip = await createTrip(owner.id);
    const [day1] = await createDays(trip.id, 1);
    const [foreignDay] = await createDays(otherTrip.id, 1);
    const item = await add(owner.id, trip.id, "Pass");
    const foreignItem = await add(owner.id, otherTrip.id, "Pass");

    expect(
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: foreignDay.id, itemId: item.item.id, origin: "user" }),
    ).toEqual({ status: "day_missing" });
    expect(
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: foreignItem.item.id, origin: "user" }),
    ).toEqual({ status: "missing" });
    expect(
      await addPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: foreignDay.id, name: "Mütze", origin: "user" }),
    ).toEqual({ status: "day_missing" });
    expect(
      await unlinkPackingItemFromDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: foreignItem.item.id, origin: "user" }),
    ).toEqual({ status: "missing" });
    expect(
      await unlinkPackingItemFromDay({ userId: owner.id, tripId: trip.id, tripDayId: foreignDay.id, itemId: item.item.id, origin: "user" }),
    ).toEqual({ status: "day_missing" });
    expect(await prisma.packingItemDay.count()).toBe(0);
    expect(await prisma.packingItem.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("refuses viewers and strangers on all three writes", async () => {
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    const stranger = await createUser("stranger");
    const trip = await createTrip(owner.id);
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const [day1] = await createDays(trip.id, 1);
    const item = await add(owner.id, trip.id, "Pass");

    for (const userId of [viewer.id, stranger.id]) {
      expect(await linkPackingItemToDay({ userId, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" })).toEqual({
        status: "not_found",
      });
      expect(await addPackingItemToDay({ userId, tripId: trip.id, tripDayId: day1.id, name: "Mütze", origin: "user" })).toEqual({
        status: "not_found",
      });
      expect(await unlinkPackingItemFromDay({ userId, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" })).toEqual({
        status: "not_found",
      });
    }
    expect(await prisma.packingItemDay.count()).toBe(0);
    expect(await prisma.packingItem.count()).toBe(1);
  });

  it("refuses a delete whose confirmed day count is stale, deletes when it matches", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2] = await createDays(trip.id, 2);
    const item = await add(owner.id, trip.id, "Pass");
    const lonely = await add(owner.id, trip.id, "Mütze");
    for (const day of [day1, day2]) {
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day.id, itemId: item.item.id, origin: "user" });
    }

    expect(await deletePackingItem({ userId: owner.id, tripId: trip.id, itemId: item.item.id, confirmedDayCount: 0 })).toEqual({
      status: "days_changed",
      dayCount: 2,
    });
    expect(await prisma.packingItem.count({ where: { id: item.item.id } })).toBe(1);
    expect(await prisma.packingItemDay.count()).toBe(2);

    expect(await deletePackingItem({ userId: owner.id, tripId: trip.id, itemId: item.item.id, confirmedDayCount: 2 })).toEqual({
      status: "deleted",
    });
    expect(await prisma.packingItemDay.count()).toBe(0);
    // A confirmed count above the real one (links removed meanwhile, nothing left) still deletes.
    expect(await deletePackingItem({ userId: owner.id, tripId: trip.id, itemId: lonely.item.id, confirmedDayCount: 3 })).toEqual({
      status: "deleted",
    });
  });

  it("drops the links of days removed by re-dating the trip and keeps the items", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, , day3] = await createDays(trip.id, 3);
    const item = await add(owner.id, trip.id, "Pass");
    for (const day of [day1, day3]) {
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day.id, itemId: item.item.id, origin: "user" });
    }

    await updateTripWithDays({
      userId: owner.id,
      tripId: trip.id,
      name: "Packing Repo Trip",
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-02T00:00:00.000Z",
    });

    expect(await linkRows(item.item.id)).toEqual([{ tripDayId: day1.id }]);
    expect(await prisma.packingItem.count({ where: { tripId: trip.id } })).toBe(1);
  });
});

describe("packingListRepo listPackingItemsForDay (Story 16.3)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns only the day's items in name-key order, to every participant and to no stranger", async () => {
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    const stranger = await createUser("stranger");
    const trip = await createTrip(owner.id);
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const [day1, day2] = await createDays(trip.id, 2);
    const zelt = await add(owner.id, trip.id, "Zelt", "Camping");
    const adapter = await add(owner.id, trip.id, "adapter", "Technik");
    const other = await add(owner.id, trip.id, "Mütze");
    await add(owner.id, trip.id, "Unlinked");
    for (const entry of [zelt, adapter]) {
      await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: entry.item.id, origin: "user" });
    }
    await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day2.id, itemId: other.item.id, origin: "user" });

    const expected = [
      { id: adapter.item.id, name: "adapter", category: "Technik", packed: false },
      { id: zelt.item.id, name: "Zelt", category: "Camping", packed: false },
    ];
    expect(await listPackingItemsForDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id })).toEqual(expected);
    expect(await listPackingItemsForDay({ userId: viewer.id, tripId: trip.id, tripDayId: day1.id })).toEqual(expected);
    expect(await listPackingItemsForDay({ userId: stranger.id, tripId: trip.id, tripDayId: day1.id })).toEqual([]);
    expect(await listPackingItemsForDay({ userId: owner.id, tripId: trip.id, tripDayId: day2.id })).toEqual([
      { id: other.item.id, name: "Mütze", category: null, packed: false },
    ]);
  });

  it("does not answer a day of another trip through this trip", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const otherTrip = await createTrip(owner.id);
    const [otherDay] = await createDays(otherTrip.id, 1);
    const item = await add(owner.id, otherTrip.id, "Pass");
    await linkPackingItemToDay({ userId: owner.id, tripId: otherTrip.id, tripDayId: otherDay.id, itemId: item.item.id, origin: "user" });
    expect(await listPackingItemsForDay({ userId: owner.id, tripId: trip.id, tripDayId: otherDay.id })).toEqual([]);
  });
});

describe("packingListRepo connector writes and undo (Story 16.4)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  /** Stamps are milliseconds: a later write must not share the previous write's millisecond. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  const capture = () => {
    const receipts: PackingChangeReceipt[] = [];
    const hook: PackingInTransactionHook = async (_tx, outcome) => {
      receipts.push(outcome.receipt);
    };
    return { receipts, hook };
  };

  const undo = (userId: string, tripId: string, receipt: PackingChangeReceipt) =>
    undoPackingChangeForTrip({ userId, tripId, receipt });

  it("adds a batch: new items created and marked, an existing name and an in-batch repeat resolved", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const existing = await add(owner.id, trip.id, "Pass", "Dokumente");
    const { receipts, hook } = capture();

    const result = await addPackingItemsForConnector({
      userId: owner.id,
      tripId: trip.id,
      items: [{ name: "Sonnencreme", category: "Hygiene" }, { name: " pass " }, { name: "SONNENCREME" }],
      inTransaction: hook,
    });

    if (result.status !== "added") throw new Error(result.status);
    const created = result.results[0].itemId;
    expect(result.results).toEqual([
      { name: "Sonnencreme", itemId: created, status: "created" },
      { name: " pass ", itemId: existing.item.id, status: "existed" },
      { name: "SONNENCREME", itemId: created, status: "existed" },
    ]);
    expect(result.items.map((item) => item.name)).toEqual(["Sonnencreme", "Pass"]);
    expect(result.written).toBe(true);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].entries).toEqual([{ change: "created", itemId: created, updatedAt: result.items[0].updatedAt }]);
    // The existing item is unchanged: no marker, same category.
    expect(result.items[1]).toMatchObject({ category: "Dokumente", aiChangedAt: null });
    expect(result.items[0].aiChangedAt).toBeInstanceOf(Date);
  });

  it("writes nothing and runs no hook when every name exists and no day is given", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    await add(owner.id, trip.id, "Pass");
    const { receipts, hook } = capture();

    const result = await addPackingItemsForConnector({ userId: owner.id, tripId: trip.id, items: [{ name: "pass" }], inTransaction: hook });

    expect(result).toMatchObject({ status: "added", written: false });
    expect(receipts).toHaveLength(0);
  });

  it("adds to a day: links existing items (marking them), and undo removes exactly those links", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2] = await createDays(trip.id, 2);
    const pass = await add(owner.id, trip.id, "Pass");
    await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day2.id, itemId: pass.item.id, origin: "user" });
    const before = await prisma.packingItem.findUniqueOrThrow({ where: { id: pass.item.id } });
    await tick();
    const { receipts, hook } = capture();

    const result = await addPackingItemsForConnector({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day1.id,
      items: [{ name: "Pass" }, { name: "Badehose" }],
      inTransaction: hook,
    });

    if (result.status !== "added") throw new Error(result.status);
    expect(result.items.map((item) => item.days.map((day) => day.id))).toEqual([[day1.id, day2.id], [day1.id]]);
    expect(result.items[0].aiChangedAt).toBeInstanceOf(Date);
    expect(receipts[0].entries.map((entry) => entry.change)).toEqual(["updated", "created"]);

    expect(await undo(owner.id, trip.id, receipts[0])).toEqual({ status: "undone" });
    const after = await prisma.packingItem.findMany({ where: { tripId: trip.id }, include: { days: true } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: pass.item.id, aiChangedAt: null });
    expect(after[0].updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after[0].days.map((link) => link.tripDayId)).toEqual([day2.id]);
  });

  it("answers day_missing for a day of another trip and not_found for a viewer", async () => {
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    const trip = await createTrip(owner.id);
    const other = await createTrip(owner.id);
    const [foreignDay] = await createDays(other.id, 1);
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const { hook } = capture();

    expect(
      await addPackingItemsForConnector({ userId: owner.id, tripId: trip.id, tripDayId: foreignDay.id, items: [{ name: "X" }], inTransaction: hook }),
    ).toEqual({ status: "day_missing" });
    expect(await prisma.packingItem.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await addPackingItemsForConnector({ userId: viewer.id, tripId: trip.id, items: [{ name: "X" }], inTransaction: hook })).toEqual({
      status: "not_found",
    });
  });

  it("updates fields and links, refuses a stale stamp and a duplicate rename, skips a no-op", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2] = await createDays(trip.id, 2);
    const item = await add(owner.id, trip.id, "Sonnencreme");
    await add(owner.id, trip.id, "Pass");
    await add(owner.id, trip.id, "Kabel", "Technik");
    await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day2.id, itemId: item.item.id, origin: "user" });
    const read = await prisma.packingItem.findUniqueOrThrow({ where: { id: item.item.id } });
    await tick();
    const { receipts, hook } = capture();
    const base = { userId: owner.id, tripId: trip.id, itemId: item.item.id, inTransaction: hook };

    await expect(
      updatePackingItemForConnector({ ...base, expectedUpdatedAt: new Date(read.updatedAt.getTime() - 1), packed: true }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    expect(await updatePackingItemForConnector({ ...base, expectedUpdatedAt: read.updatedAt, name: "PASS" })).toEqual({
      status: "duplicate_name",
    });
    expect(await updatePackingItemForConnector({ ...base, expectedUpdatedAt: read.updatedAt, addDayIds: ["nope"] })).toEqual({
      status: "day_missing",
    });
    expect(
      await updatePackingItemForConnector({ ...base, expectedUpdatedAt: read.updatedAt, packed: false, addDayIds: [day2.id], removeDayIds: [day1.id] }),
    ).toMatchObject({ status: "unchanged" });
    expect(receipts).toHaveLength(0);

    const updated = await updatePackingItemForConnector({
      ...base,
      expectedUpdatedAt: read.updatedAt,
      name: "SONNENCREME",
      category: "technik",
      packed: true,
      addDayIds: [day1.id],
      removeDayIds: [day2.id],
    });
    if (updated.status !== "updated") throw new Error(updated.status);
    expect(updated.item).toMatchObject({ name: "SONNENCREME", category: "Technik", packed: true });
    expect(updated.item.days.map((day) => day.id)).toEqual([day1.id]);
    expect(updated.item.aiChangedAt).toBeInstanceOf(Date);
    expect(receipts).toHaveLength(1);

    expect(await undo(owner.id, trip.id, receipts[0])).toEqual({ status: "undone" });
    const restored = await prisma.packingItem.findUniqueOrThrow({ where: { id: item.item.id }, include: { days: true } });
    expect(restored).toMatchObject({ name: "Sonnencreme", nameKey: "sonnencreme", category: null, packed: false, aiChangedAt: null });
    // The explicit `updatedAt` survives Prisma's @updatedAt.
    expect(restored.updatedAt.getTime()).toBe(read.updatedAt.getTime());
    expect(restored.days.map((link) => link.tripDayId)).toEqual([day2.id]);
  });

  it("clears the category with null and stores Other as null", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const item = await add(owner.id, trip.id, "Kabel", "Technik");
    const { hook } = capture();
    const updated = await updatePackingItemForConnector({
      userId: owner.id,
      tripId: trip.id,
      itemId: item.item.id,
      expectedUpdatedAt: item.item.updatedAt,
      category: "OTHER",
      inTransaction: hook,
    });
    expect(updated).toMatchObject({ status: "updated", item: { category: null } });
  });

  it("deletes with every link and undo recreates the item with its own id, stamps and live links", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const [day1, day2] = await createDays(trip.id, 2);
    const item = await add(owner.id, trip.id, "Schnorchel", "Sport");
    await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day1.id, itemId: item.item.id, origin: "user" });
    await linkPackingItemToDay({ userId: owner.id, tripId: trip.id, tripDayId: day2.id, itemId: item.item.id, origin: "user" });
    const before = await prisma.packingItem.findUniqueOrThrow({ where: { id: item.item.id } });
    const { receipts, hook } = capture();

    expect(await deletePackingItemForConnector({ userId: owner.id, tripId: trip.id, itemId: item.item.id, inTransaction: hook })).toEqual({
      status: "deleted",
      id: item.item.id,
      name: "Schnorchel",
      dayCount: 2,
    });
    expect(await prisma.packingItemDay.count()).toBe(0);
    expect(await deletePackingItemForConnector({ userId: owner.id, tripId: trip.id, itemId: item.item.id, inTransaction: hook })).toEqual({
      status: "missing",
    });

    // A day deleted since is not linked again.
    await prisma.tripDay.delete({ where: { id: day2.id } });
    expect(await undo(owner.id, trip.id, receipts[0])).toEqual({ status: "undone" });
    const restored = await prisma.packingItem.findUniqueOrThrow({ where: { id: item.item.id }, include: { days: true } });
    expect(restored).toMatchObject({ name: "Schnorchel", category: "Sport", packed: false });
    expect(restored.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(restored.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(restored.days.map((link) => link.tripDayId)).toEqual([day1.id]);
  });

  it("refuses a delete's undo when the name was taken since", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const item = await add(owner.id, trip.id, "Schnorchel");
    const { receipts, hook } = capture();
    await deletePackingItemForConnector({ userId: owner.id, tripId: trip.id, itemId: item.item.id, inTransaction: hook });
    await add(owner.id, trip.id, "schnorchel");

    expect(await undo(owner.id, trip.id, receipts[0])).toEqual({ status: "stale" });
  });

  it("refuses an update's undo when its old name was taken since, and rolls everything back", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const item = await add(owner.id, trip.id, "Mütze");
    const { receipts, hook } = capture();
    const renamed = await updatePackingItemForConnector({
      userId: owner.id,
      tripId: trip.id,
      itemId: item.item.id,
      expectedUpdatedAt: item.item.updatedAt,
      name: "Kappe",
      inTransaction: hook,
    });
    if (renamed.status !== "updated") throw new Error(renamed.status);
    await add(owner.id, trip.id, "Mütze");

    expect(await undo(owner.id, trip.id, receipts[0])).toEqual({ status: "stale" });
    expect(await prisma.packingItem.findUniqueOrThrow({ where: { id: item.item.id } })).toMatchObject({ name: "Kappe" });
  });

  it("undoes a chain newest first, and refuses the older one first", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const { receipts, hook } = capture();
    const added = await addPackingItemsForConnector({ userId: owner.id, tripId: trip.id, items: [{ name: "Sonnencreme" }], inTransaction: hook });
    if (added.status !== "added") throw new Error(added.status);
    await tick();
    const ticked = await updatePackingItemForConnector({
      userId: owner.id,
      tripId: trip.id,
      itemId: added.items[0].id,
      expectedUpdatedAt: added.items[0].updatedAt,
      packed: true,
      inTransaction: hook,
    });
    expect(ticked.status).toBe("updated");
    const [addReceipt, tickReceipt] = receipts;

    expect(await undo(owner.id, trip.id, addReceipt)).toEqual({ status: "stale" });
    expect(await undo(owner.id, trip.id, tickReceipt)).toEqual({ status: "undone" });
    const afterTickUndo = await prisma.packingItem.findUniqueOrThrow({ where: { id: added.items[0].id } });
    expect(afterTickUndo.packed).toBe(false);
    expect(afterTickUndo.aiChangedAt?.getTime()).toBe(added.items[0].aiChangedAt?.getTime());
    expect(await undo(owner.id, trip.id, addReceipt)).toEqual({ status: "undone" });
    expect(await prisma.packingItem.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("an app write after a connector write clears the marker and makes the undo stale", async () => {
    const owner = await createUser("owner");
    const trip = await createTrip(owner.id);
    const { receipts, hook } = capture();
    const added = await addPackingItemsForConnector({ userId: owner.id, tripId: trip.id, items: [{ name: "Hut" }], inTransaction: hook });
    if (added.status !== "added") throw new Error(added.status);
    expect(added.items[0].aiChangedAt).toBeInstanceOf(Date);
    await tick();

    const edited = await updatePackingItem({ userId: owner.id, tripId: trip.id, itemId: added.items[0].id, packed: true, origin: "user" });
    expect(edited).toMatchObject({ status: "updated", item: { aiChangedAt: null } });
    expect(await undo(owner.id, trip.id, receipts[0])).toEqual({ status: "stale" });
  });

  it("answers invalid for an item of another trip and not_found for a viewer", async () => {
    const owner = await createUser("owner");
    const viewer = await createUser("viewer");
    const trip = await createTrip(owner.id);
    const other = await createTrip(owner.id);
    const foreign = await add(owner.id, other.id, "Fremd");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const receipt: PackingChangeReceipt = {
      kind: "packingChanged",
      version: 1,
      entries: [{ change: "created", itemId: foreign.item.id, updatedAt: foreign.item.updatedAt }],
    };

    expect(await undo(owner.id, trip.id, receipt)).toEqual({ status: "invalid" });
    expect(await undo(viewer.id, trip.id, receipt)).toEqual({ status: "not_found" });
    expect(await prisma.packingItem.count({ where: { id: foreign.item.id } })).toBe(1);
  });
});
