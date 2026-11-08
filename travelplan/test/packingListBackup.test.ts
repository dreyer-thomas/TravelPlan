import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createTripWithDays,
  getTripExportForUser,
  importTripFromExportForUser,
  type ImportTripResult,
} from "@/lib/repositories/tripRepo";
import { tripImportPayloadSchema } from "@/lib/validation/tripImportSchemas";

/**
 * Story 16.1 (AC 10). The packing list in the v2 backup: export → `trip.json` → schema → import, in both
 * strategies; an archive without `packingItems`; an unknown `dayIndex`; duplicate names in an archive.
 */

const expectImported = (result: ImportTripResult) => {
  if (result.outcome !== "imported") throw new Error(`Expected "imported", received "${result.outcome}"`);
  return result;
};

let counter = 0;
const createUser = () =>
  prisma.user.create({ data: { email: `packing-backup-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" } });

/** A three-day trip with a packing list: one item on days 1 and 3, one packed without links. */
const seedSourceTrip = async (userId: string) => {
  const { trip } = await createTripWithDays({
    userId,
    name: "Packing Source",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-09-03T00:00:00.000Z",
  });
  const [day1, , day3] = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
  const brille = await prisma.packingItem.create({
    data: { tripId: trip.id, name: "Taucherbrille", nameKey: "taucherbrille", category: "Sport" },
  });
  await prisma.packingItem.create({ data: { tripId: trip.id, name: "Pass", nameKey: "pass", category: "Dokumente", packed: true } });
  await prisma.packingItemDay.createMany({
    data: [
      { packingItemId: brille.id, tripDayId: day1.id },
      { packingItemId: brille.id, tripDayId: day3.id },
    ],
  });
  return trip;
};

/** The manifest as `export/route.ts` writes it, round-tripped through JSON and the import schema. */
const exportManifest = async (userId: string, tripId: string) => {
  const exported = await getTripExportForUser(userId, tripId);
  if (!exported) throw new Error("export failed");
  return JSON.parse(
    JSON.stringify({
      meta: { exportedAt: exported.payload.trip.updatedAt, appVersion: "test", formatVersion: 2, warnings: [] },
      photos: exported.payload.photos,
      documents: exported.payload.documents,
      trip: exported.payload.trip,
      days: exported.payload.days,
    }),
  ) as Record<string, unknown> & { trip: Record<string, unknown> };
};

const readList = async (tripId: string) =>
  (
    await prisma.packingItem.findMany({
      where: { tripId },
      orderBy: { nameKey: "asc" },
      select: { name: true, category: true, packed: true, aiChangedAt: true, days: { select: { tripDay: { select: { dayIndex: true } } } } },
    })
  ).map((item) => ({
    name: item.name,
    category: item.category,
    packed: item.packed,
    aiChangedAt: item.aiChangedAt,
    dayIndexes: item.days.map((link) => link.tripDay.dayIndex).sort((a, b) => a - b),
  }));

const EXPECTED_LIST = [
  { name: "Pass", category: "Dokumente", packed: true, aiChangedAt: null, dayIndexes: [] },
  { name: "Taucherbrille", category: "Sport", packed: false, aiChangedAt: null, dayIndexes: [1, 3] },
];

describe("packing list backup (Story 16.1)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("restores items, packed flags, categories and day links into a new trip", async () => {
    const user = await createUser();
    const source = await seedSourceTrip(user.id);
    const payload = tripImportPayloadSchema.parse(await exportManifest(user.id, source.id));

    const imported = expectImported(await importTripFromExportForUser({ userId: user.id, payload, strategy: "createNew" }));

    expect(imported.trip.id).not.toBe(source.id);
    expect(await readList(imported.trip.id)).toEqual(EXPECTED_LIST);
    // Linked to the new trip's days, not the source's.
    const links = await prisma.packingItemDay.findMany({ where: { packingItem: { tripId: imported.trip.id } }, select: { tripDay: { select: { tripId: true } } } });
    expect(links.map((link) => link.tripDay.tripId)).toEqual([imported.trip.id, imported.trip.id]);
    // The source is untouched.
    expect(await readList(source.id)).toEqual(EXPECTED_LIST);
  });

  it("replaces the target's list on overwrite: no doubling, no unique-index clash", async () => {
    const user = await createUser();
    const source = await seedSourceTrip(user.id);
    const payload = tripImportPayloadSchema.parse(await exportManifest(user.id, source.id));
    const { trip: target } = await createTripWithDays({
      userId: user.id,
      // Overwrite targets a trip with the archive's name.
      name: "Packing Source",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-02T00:00:00.000Z",
    });
    await prisma.packingItem.createMany({
      data: [
        { tripId: target.id, name: "PASS", nameKey: "pass" },
        { tripId: target.id, name: "Old thing", nameKey: "old thing" },
      ],
    });

    const imported = expectImported(
      await importTripFromExportForUser({ userId: user.id, payload, strategy: "overwrite", targetTripId: target.id }),
    );

    expect(imported.trip.id).toBe(target.id);
    expect(await readList(target.id)).toEqual(EXPECTED_LIST);

    // A second overwrite with the same archive still gives the same list.
    expectImported(await importTripFromExportForUser({ userId: user.id, payload, strategy: "overwrite", targetTripId: target.id }));
    expect(await readList(target.id)).toEqual(EXPECTED_LIST);
  });

  it("imports an archive without packingItems with an empty list", async () => {
    const user = await createUser();
    const source = await seedSourceTrip(user.id);
    const manifest = await exportManifest(user.id, source.id);
    delete manifest.trip.packingItems;

    const parsed = tripImportPayloadSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.trip.packingItems).toEqual([]);
    expect(parsed.data!.meta.formatVersion).toBe(2);

    const imported = expectImported(await importTripFromExportForUser({ userId: user.id, payload: parsed.data!, strategy: "createNew" }));
    expect(await readList(imported.trip.id)).toEqual([]);
  });

  it("refuses a dayIndex the archive has no day for", async () => {
    const user = await createUser();
    const source = await seedSourceTrip(user.id);
    const manifest = await exportManifest(user.id, source.id);
    manifest.trip.packingItems = [{ name: "Zelt", category: null, packed: false, dayIndexes: [2, 9] }];

    const parsed = tripImportPayloadSchema.safeParse(manifest);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Unknown dayIndex in packing item", path: ["trip", "packingItems", 0, "dayIndexes"] }),
      ]),
    );
  });

  it("refuses an over-long name or category", async () => {
    const user = await createUser();
    const source = await seedSourceTrip(user.id);
    const manifest = await exportManifest(user.id, source.id);
    manifest.trip.packingItems = [{ name: "x".repeat(81) }];
    expect(tripImportPayloadSchema.safeParse(manifest).success).toBe(false);
    manifest.trip.packingItems = [{ name: "ok", category: "c".repeat(41) }];
    expect(tripImportPayloadSchema.safeParse(manifest).success).toBe(false);
  });

  it("merges archive entries that share a name, folds Other and unifies category spelling", async () => {
    const user = await createUser();
    const source = await seedSourceTrip(user.id);
    const manifest = await exportManifest(user.id, source.id);
    manifest.trip.packingItems = [
      { name: "Taucherbrille", category: "Sport", packed: false, dayIndexes: [3] },
      { name: "  TAUCHERBRILLE ", category: "Tauchen", packed: true, dayIndexes: [1, 3] },
      { name: "Schnorchel", category: "sport" },
      { name: "Schirm", category: "Sonstiges", dayIndexes: [2] },
      { name: "Hut", category: "  " },
    ];

    const payload = tripImportPayloadSchema.parse(manifest);
    const imported = expectImported(await importTripFromExportForUser({ userId: user.id, payload, strategy: "createNew" }));

    expect(await readList(imported.trip.id)).toEqual([
      { name: "Hut", category: null, packed: false, aiChangedAt: null, dayIndexes: [] },
      { name: "Schirm", category: null, packed: false, aiChangedAt: null, dayIndexes: [2] },
      { name: "Schnorchel", category: "Sport", packed: false, aiChangedAt: null, dayIndexes: [] },
      { name: "Taucherbrille", category: "Sport", packed: true, aiChangedAt: null, dayIndexes: [1, 3] },
    ]);
  });
});
