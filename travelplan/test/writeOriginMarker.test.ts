import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createAccommodationForTripDay,
  createAccommodationImage,
  updateAccommodationForTripDay,
} from "@/lib/repositories/accommodationRepo";
import {
  createParkedDayPlanItem,
  deleteParkedDayPlanItem,
  updateParkedDayPlanItem,
} from "@/lib/repositories/bucketListRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import {
  createDayPlanItemDocument,
  createDayPlanItemForTripDay,
  createDayPlanItemImage,
  deleteDayPlanItemForTripDay,
  moveDayPlanItemsBetweenTripDays,
  parkDayPlanItemForTripDay,
  reorderDayPlanItemForTripDay,
  scheduleParkedDayPlanItemForTripDay,
  swapDayPlanItemsBetweenTripDays,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { createTravelSegmentForTripDay } from "@/lib/repositories/travelSegmentRepo";
import {
  fromDayChangeReceiptWire,
  toDayChangeReceiptWire,
  type DayChangeReceipt,
} from "@/lib/trips/dayChangeReceipt";
import { ChangedSinceReadError, type InTransactionHook, type WriteOrigin } from "@/lib/trips/writeOrigin";
import { storedDayChangeReceiptSchema } from "@/lib/validation/dayChangeReceiptSchemas";

/**
 * Story 15.4. The `origin` marker on the repository writes: `"ai"` stamps `aiChangedAt` on the rows a
 * write targets, `"user"` clears it, and rows the recompute only shifts keep theirs. Also the optional
 * `expectedUpdatedAt` refusal and `inTransaction` hook, the `toIndex` move, and undo restoring markers.
 */

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const resetDatabase = async () => {
  await prisma.aiChange.deleteMany();
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
  await prisma.accommodationImage.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

let userCount = 0;
const seedTrip = async () => {
  userCount += 1;
  const user = await prisma.user.create({
    data: { email: `origin-${userCount}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Origin Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 1 },
  });
  const otherDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 2 },
  });
  return { user, trip, day, otherDay };
};

type Seeded = Awaited<ReturnType<typeof seedTrip>>;

const createFlexible = async (
  seeded: Seeded,
  title: string,
  origin: WriteOrigin,
  extra: { tripDayId?: string; durationMinutes?: number; inTransaction?: InTransactionHook } = {},
) => {
  const result = await createDayPlanItemForTripDay({
    userId: seeded.user.id,
    tripId: seeded.trip.id,
    tripDayId: extra.tripDayId ?? seeded.day.id,
    title,
    scheduleMode: "FLEXIBLE",
    durationMinutes: extra.durationMinutes ?? 60,
    fromTime: null,
    toTime: null,
    contentJson: doc(title),
    origin,
    inTransaction: extra.inTransaction,
  });
  if (!result) throw new Error("setup: create refused");
  return result;
};

const updateParams = (seeded: Seeded, itemId: string, title: string, durationMinutes = 60) => ({
  userId: seeded.user.id,
  tripId: seeded.trip.id,
  tripDayId: seeded.day.id,
  itemId,
  title,
  scheduleMode: "FLEXIBLE" as const,
  durationMinutes,
  fromTime: null,
  toTime: null,
  contentJson: doc(title),
});

const row = (id: string) => prisma.dayPlanItem.findUniqueOrThrow({ where: { id } });
const marker = async (id: string) => (await row(id)).aiChangedAt;

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  changes: await prisma.aiChange.findMany({ orderBy: { id: "asc" } }),
});

const titlesInOrder = async (tripDayId: string) =>
  (await prisma.dayPlanItem.findMany({ where: { tripDayId }, orderBy: { sortOrder: "asc" } })).map((item) => item.title);

beforeEach(resetDatabase);

describe("origin marker on activity writes (Story 15.4)", () => {
  it("create: ai marks the new row, user leaves it unmarked", async () => {
    const seeded = await seedTrip();
    const ai = await createFlexible(seeded, "AI", "ai");
    const user = await createFlexible(seeded, "User", "user");
    expect(await marker(ai.item.id)).toBeInstanceOf(Date);
    expect(await marker(user.item.id)).toBeNull();
  });

  it("update: user clears an ai row's marker, ai marks a user row, and a row the recompute only shifted keeps its own", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const b = await createFlexible(seeded, "B", "ai");
    const bMarker = await marker(b.item.id);

    // A grows, so B is pushed later: B is shifted by the recompute, not targeted.
    const updatedA = await updateDayPlanItemForTripDay({ ...updateParams(seeded, a.item.id, "A", 120), origin: "ai" });
    expect(updatedA.status).toBe("updated");
    expect(await marker(a.item.id)).toBeInstanceOf(Date);
    const shiftedB = await row(b.item.id);
    expect(shiftedB.fromTime).not.toBe(b.item.fromTime);
    expect(shiftedB.aiChangedAt).toEqual(bMarker);

    const updatedB = await updateDayPlanItemForTripDay({ ...updateParams(seeded, b.item.id, "B edited"), origin: "user" });
    expect(updatedB.status).toBe("updated");
    expect(await marker(b.item.id)).toBeNull();
  });

  it("park and schedule mark or clear the activity they move", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const b = await createFlexible(seeded, "B", "ai");
    const bMarker = await marker(b.item.id);

    const parked = await parkDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "ai",
    });
    expect(parked.status).toBe("parked");
    expect(await marker(a.item.id)).toBeInstanceOf(Date);
    // B moved earlier into A's slot, by the recompute only.
    expect(await marker(b.item.id)).toEqual(bMarker);

    const scheduled = await scheduleParkedDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "user",
    });
    expect(scheduled.status).toBe("scheduled");
    expect(await marker(a.item.id)).toBeNull();

    const reparked = await parkDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "user",
    });
    expect(reparked.status).toBe("parked");
    expect(await marker(a.item.id)).toBeNull();
    const rescheduled = await scheduleParkedDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "ai",
    });
    expect(rescheduled.status).toBe("scheduled");
    expect(await marker(a.item.id)).toBeInstanceOf(Date);
  });

  it("reorder by direction marks only the moved activity; the neighbour keeps its marker", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const b = await createFlexible(seeded, "B", "user");

    const ai = await reorderDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: b.item.id,
      direction: "up",
      origin: "ai",
    });
    expect(ai.status).toBe("reordered");
    const movedB = await row(b.item.id);
    expect(movedB.aiChangedAt).toEqual(movedB.updatedAt);
    expect(await marker(a.item.id)).toBeNull();

    const user = await reorderDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: b.item.id,
      direction: "down",
      origin: "user",
    });
    expect(user.status).toBe("reordered");
    expect(await marker(b.item.id)).toBeNull();
  });

  it("day transfers mark or clear every row they moved", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const c = await createFlexible(seeded, "C", "user", { tripDayId: seeded.otherDay.id });

    const swapped = await swapDayPlanItemsBetweenTripDays({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      firstTripDayId: seeded.day.id,
      secondTripDayId: seeded.otherDay.id,
      origin: "ai",
    });
    expect(swapped.status).toBe("swapped");
    expect(await marker(a.item.id)).toBeInstanceOf(Date);
    expect(await marker(c.item.id)).toBeInstanceOf(Date);

    const moved = await moveDayPlanItemsBetweenTripDays({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      sourceTripDayId: seeded.otherDay.id,
      targetTripDayId: seeded.day.id,
      origin: "user",
    });
    expect(moved.status).toBe("moved");
    expect(await marker(a.item.id)).toBeNull();
  });

  it("media, parked, stay and leg creates and edits carry the marker too", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const scope = { userId: seeded.user.id, tripId: seeded.trip.id, tripDayId: seeded.day.id, dayPlanItemId: a.item.id };

    const image = await createDayPlanItemImage({ ...scope, imageUrl: `/uploads/trips/${seeded.trip.id}/x.webp`, origin: "ai" });
    expect((await prisma.dayPlanItemImage.findUniqueOrThrow({ where: { id: image!.id } })).aiChangedAt).toBeInstanceOf(Date);
    const document = await createDayPlanItemDocument({
      ...scope,
      documentUrl: `/uploads/trips/${seeded.trip.id}/doc.pdf`,
      fileName: "Ticket.pdf",
      origin: "user",
    });
    if (document.status !== "created") throw new Error("setup");
    expect((await prisma.dayPlanItemDocument.findUniqueOrThrow({ where: { id: document.document.id } })).aiChangedAt).toBeNull();

    const parked = await createParkedDayPlanItem({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      title: "Idea",
      contentJson: doc("Idea"),
      origin: "ai",
    });
    expect(await marker(parked!.id)).toBeInstanceOf(Date);
    const edited = await updateParkedDayPlanItem({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      itemId: parked!.id,
      title: "Idea 2",
      contentJson: doc("Idea 2"),
      origin: "user",
    });
    expect(edited.status).toBe("updated");
    expect(await marker(parked!.id)).toBeNull();

    const stayParams = {
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      name: "Hotel",
      status: "planned" as const,
    };
    const stay = await createAccommodationForTripDay({ ...stayParams, origin: "ai" });
    expect((await prisma.accommodation.findUniqueOrThrow({ where: { id: stay!.id } })).aiChangedAt).toBeInstanceOf(Date);
    const stayImage = await createAccommodationImage({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      accommodationId: stay!.id,
      imageUrl: `/uploads/trips/${seeded.trip.id}/s.webp`,
      origin: "ai",
    });
    expect((await prisma.accommodationImage.findUniqueOrThrow({ where: { id: stayImage!.id } })).aiChangedAt).toBeInstanceOf(Date);
    await updateAccommodationForTripDay({ ...stayParams, name: "Hotel 2", origin: "user" });
    expect((await prisma.accommodation.findUniqueOrThrow({ where: { id: stay!.id } })).aiChangedAt).toBeNull();

    const leg = await createTravelSegmentForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      fromItemType: "dayPlanItem",
      fromItemId: a.item.id,
      toItemType: "accommodation",
      toItemId: stay!.id,
      transportType: "car",
      durationMinutes: 10,
      origin: "ai",
    });
    if (leg.status !== "created") throw new Error(`setup: ${leg.status}`);
    expect((await prisma.travelSegment.findUniqueOrThrow({ where: { id: leg.segment.id } })).aiChangedAt).toBeInstanceOf(Date);
  });
});

describe("expectedUpdatedAt and the in-transaction hook (Story 15.4)", () => {
  const STALE = new Date("2020-01-01T00:00:00.000Z");

  it("an update or delete with a stale updatedAt throws ChangedSinceReadError and writes nothing", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    await createFlexible(seeded, "B", "user");
    const before = await databaseState();

    await expect(
      updateDayPlanItemForTripDay({ ...updateParams(seeded, a.item.id, "A edited", 90), origin: "ai", expectedUpdatedAt: STALE }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    await expect(
      deleteDayPlanItemForTripDay({
        userId: seeded.user.id,
        tripId: seeded.trip.id,
        tripDayId: seeded.day.id,
        itemId: a.item.id,
        expectedUpdatedAt: STALE,
      }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    expect(await databaseState()).toEqual(before);

    // The current stamp passes.
    const current = (await row(a.item.id)).updatedAt;
    const updated = await updateDayPlanItemForTripDay({
      ...updateParams(seeded, a.item.id, "A edited"),
      origin: "ai",
      expectedUpdatedAt: current,
    });
    expect(updated.status).toBe("updated");
  });

  it("a parked update or delete with a stale updatedAt throws and writes nothing", async () => {
    const seeded = await seedTrip();
    const parked = await createParkedDayPlanItem({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      title: "Idea",
      contentJson: doc("Idea"),
      origin: "user",
    });
    const before = await databaseState();
    await expect(
      updateParkedDayPlanItem({
        userId: seeded.user.id,
        tripId: seeded.trip.id,
        itemId: parked!.id,
        title: "Changed",
        contentJson: doc("Changed"),
        origin: "ai",
        expectedUpdatedAt: STALE,
      }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    await expect(
      deleteParkedDayPlanItem({ userId: seeded.user.id, tripId: seeded.trip.id, itemId: parked!.id, expectedUpdatedAt: STALE }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    expect(await databaseState()).toEqual(before);

    const deleted = await deleteParkedDayPlanItem({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      itemId: parked!.id,
      expectedUpdatedAt: parked!.updatedAt,
    });
    expect(deleted.status).toBe("deleted");
  });

  it("the hook gets the receipt and the item id, and a throw rolls the whole write back", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const seen: { receipt: DayChangeReceipt | null; itemId: string }[] = [];
    await createFlexible(seeded, "B", "ai", {
      inTransaction: async (_tx, outcome) => {
        seen.push(outcome);
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].receipt?.edited.kind).toBe("created");
    expect(seen[0].receipt?.edited).toMatchObject({ itemId: seen[0].itemId });

    const before = await databaseState();
    const failing: InTransactionHook = async (tx) => {
      // A write inside the hook is rolled back with everything else.
      await tx.dayPlanItem.updateMany({ where: { id: a.item.id }, data: { title: "hooked" } });
      throw new Error("hook failed");
    };
    await expect(createFlexible(seeded, "C", "ai", { inTransaction: failing })).rejects.toThrow("hook failed");
    await expect(
      updateDayPlanItemForTripDay({ ...updateParams(seeded, a.item.id, "A edited", 90), origin: "ai", inTransaction: failing }),
    ).rejects.toThrow("hook failed");
    await expect(
      reorderDayPlanItemForTripDay({
        userId: seeded.user.id,
        tripId: seeded.trip.id,
        tripDayId: seeded.day.id,
        itemId: a.item.id,
        toIndex: 1,
        origin: "ai",
        inTransaction: failing,
      }),
    ).rejects.toThrow("hook failed");
    await expect(
      createParkedDayPlanItem({
        userId: seeded.user.id,
        tripId: seeded.trip.id,
        title: "Idea",
        contentJson: doc("Idea"),
        origin: "ai",
        inTransaction: failing,
      }),
    ).rejects.toThrow("hook failed");
    expect(await databaseState()).toEqual(before);
  });
});

describe("reorder to a position (Story 15.4)", () => {
  const seedFour = async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "user");
    const b = await createFlexible(seeded, "B", "user");
    const c = await createFlexible(seeded, "C", "ai");
    const d = await createFlexible(seeded, "D", "user");
    return { seeded, a, b, c, d };
  };

  it("moves an activity later, shifts the rows between, names the row it now follows, and undo restores the day and the marker", async () => {
    const { seeded, a, b, c } = await seedFour();
    const before = await databaseState();
    const cMarker = await marker(c.item.id);

    const result = await reorderDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      toIndex: 2,
      origin: "ai",
    });
    if (result.status !== "reordered") throw new Error(result.status);
    expect(await titlesInOrder(seeded.day.id)).toEqual(["B", "C", "A", "D"]);
    expect(result.receipt.edited).toEqual({
      kind: "reordered",
      itemId: a.item.id,
      neighbourId: c.item.id,
      previousAiChangedAt: null,
    });
    // A, B and C changed order (and times); D kept both.
    expect(result.receipt.movedItems.map((moved) => moved.itemId).sort()).toEqual([a.item.id, b.item.id, c.item.id].sort());
    expect(await marker(a.item.id)).toBeInstanceOf(Date);
    expect(await marker(b.item.id)).toBeNull();
    expect(await marker(c.item.id)).toEqual(cMarker);

    // The receipt survives the stored round trip and undoes the move exactly, marker included.
    const stored = storedDayChangeReceiptSchema.parse(JSON.parse(JSON.stringify(toDayChangeReceiptWire(result.receipt))));
    expect(
      await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: fromDayChangeReceiptWire(stored) }),
    ).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("moves an activity earlier and names the row it now precedes", async () => {
    const { seeded, a, d } = await seedFour();
    const result = await reorderDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: d.item.id,
      toIndex: 0,
      origin: "user",
    });
    if (result.status !== "reordered") throw new Error(result.status);
    expect(await titlesInOrder(seeded.day.id)).toEqual(["D", "A", "B", "C"]);
    expect(result.receipt.edited).toMatchObject({ itemId: d.item.id, neighbourId: a.item.id });
    expect(result.receipt.movedItems).toHaveLength(4);
  });

  it("refuses a position outside the day, its own position, or a fixed activity, writing nothing", async () => {
    const { seeded, a } = await seedFour();
    const fixed = await createDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      title: "Ferry",
      scheduleMode: "FIXED",
      fromTime: "20:00",
      toTime: "21:00",
      contentJson: doc("Ferry"),
      origin: "user",
    });
    const before = await databaseState();
    const base = { userId: seeded.user.id, tripId: seeded.trip.id, tripDayId: seeded.day.id, origin: "ai" as const };
    for (const toIndex of [-1, 5, 0, 1.5]) {
      expect(await reorderDayPlanItemForTripDay({ ...base, itemId: a.item.id, toIndex })).toEqual({ status: "not_reorderable" });
    }
    expect(await reorderDayPlanItemForTripDay({ ...base, itemId: fixed!.item.id, toIndex: 0 })).toEqual({
      status: "not_reorderable",
    });
    expect(await databaseState()).toEqual(before);
  });
});

describe("undo restores the marker (Story 15.4)", () => {
  it("updated: a person's edit of an ai row, undone, gives the row its marker back", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "ai");
    const before = await databaseState();
    const updated = await updateDayPlanItemForTripDay({ ...updateParams(seeded, a.item.id, "Edited"), origin: "user" });
    if (updated.status !== "updated") throw new Error("setup");
    expect(await marker(a.item.id)).toBeNull();
    expect(updated.receipt.edited).toMatchObject({ previous: { aiChangedAt: before.items[0].aiChangedAt } });
    expect(await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: updated.receipt })).toEqual({
      status: "undone",
    });
    expect(await databaseState()).toEqual(before);
  });

  it("deleted: the restored row carries its marker", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "ai");
    const before = await databaseState();
    const deleted = await deleteDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
    });
    if (deleted.status !== "deleted") throw new Error("setup");
    await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: deleted.receipt });
    expect(await databaseState()).toEqual(before);
    expect(await marker(a.item.id)).toBeInstanceOf(Date);
  });

  it("parked and scheduled: undo puts the previous marker back", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "ai");
    await createFlexible(seeded, "B", "user");
    const beforePark = await databaseState();

    const parked = await parkDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "user",
    });
    if (parked.status !== "parked") throw new Error("setup");
    expect(parked.receipt.edited).toMatchObject({ previous: { previousAiChangedAt: beforePark.items.find((item) => item.id === a.item.id)!.aiChangedAt } });
    await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: parked.receipt });
    expect(await databaseState()).toEqual(beforePark);

    // Now park it as the connector, then schedule it as a person and undo that.
    const parkedByAi = await parkDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "ai",
    });
    if (parkedByAi.status !== "parked") throw new Error("setup");
    const beforeSchedule = await databaseState();
    const parkedMarker = await marker(a.item.id);
    expect(parkedMarker).toBeInstanceOf(Date);
    const scheduled = await scheduleParkedDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: a.item.id,
      origin: "user",
    });
    if (scheduled.status !== "scheduled") throw new Error("setup");
    expect(scheduled.receipt.edited).toMatchObject({ previousAiChangedAt: parkedMarker });
    expect(await marker(a.item.id)).toBeNull();
    await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: scheduled.receipt });
    expect(await databaseState()).toEqual(beforeSchedule);
  });

  it("reordered by direction: undo puts the moved activity's marker back", async () => {
    const seeded = await seedTrip();
    await createFlexible(seeded, "A", "user");
    const b = await createFlexible(seeded, "B", "ai");
    const before = await databaseState();
    const result = await reorderDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: b.item.id,
      direction: "up",
      origin: "user",
    });
    if (result.status !== "reordered") throw new Error("setup");
    expect(await marker(b.item.id)).toBeNull();
    await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: result.receipt });
    expect(await databaseState()).toEqual(before);
  });

  it("a stored receipt without the marker keys is refused by the strict schema", async () => {
    const seeded = await seedTrip();
    const a = await createFlexible(seeded, "A", "ai");
    const updated = await updateDayPlanItemForTripDay({ ...updateParams(seeded, a.item.id, "Edited"), origin: "user" });
    if (updated.status !== "updated") throw new Error("setup");
    const wire = toDayChangeReceiptWire(updated.receipt);
    expect(storedDayChangeReceiptSchema.safeParse(wire).success).toBe(true);
    const { aiChangedAt: _marker, ...olderPrevious } = (wire.edited as { previous: Record<string, unknown> }).previous;
    void _marker;
    expect(
      storedDayChangeReceiptSchema.safeParse({ ...wire, edited: { ...wire.edited, previous: olderPrevious } }).success,
    ).toBe(false);
  });
});
