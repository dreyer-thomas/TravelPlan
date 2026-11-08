import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createPackingItem,
  deletePackingItem,
  listPackingItemsForTrip,
  updatePackingItem,
} from "@/lib/repositories/packingListRepo";

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
