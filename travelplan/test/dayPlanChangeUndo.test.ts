import { beforeEach, describe, expect, it } from "vitest";
import { createDayPlanItemExpectingSuccess } from "./helpers/createDayPlanItem";
import { NextRequest } from "next/server";
import { POST as ITEMS_POST } from "@/app/api/trips/[id]/day-plan-items/route";
import { POST as UNDO_POST } from "@/app/api/trips/[id]/day-plan-changes/undo/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import {
  parkDayPlanItemForTripDay,
  scheduleParkedDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  reorderDayPlanItemForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import {
  createTravelSegmentForTripDay,
  deleteTravelSegmentForTripDay,
  updateTravelSegmentForTripDay,
} from "@/lib/repositories/travelSegmentRepo";
import { updateAccommodationForTripDay } from "@/lib/repositories/accommodationRepo";
import { toDayChangeReceiptWire, type DayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { routeContext } from "./helpers/routeContext";
import { settleSeededDay } from "./helpers/settleSeededDay";
import { tripIdOfDay } from "./helpers/tripIdOfDay";

/**
 * Story 11.1 AC5/AC6/AC8/AC12. Undo restores every touched row identical — column by column, including
 * `createdAt` and `updatedAt` — or refuses and writes nothing.
 *
 * "Identical" is asserted by reading the whole database before the change and after the undo and
 * comparing with `toEqual`, so a column the restore forgets fails here rather than in a user's backup.
 * That includes `updatedAt` on an *update*: Prisma's `@updatedAt` would silently overwrite it if it did
 * not honour an explicit value, and this suite is where that is pinned (Dev Notes).
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Fixture rows are stamped in the past so a later write can never share their millisecond. */
const PAST = new Date("2026-01-02T03:04:05.678Z");
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Undo Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 },
  });
  return { trip, day };
};

const createRawItem = async (tripDayId: string, title: string, fromTime: string | null, toTime: string | null) =>
  prisma.dayPlanItem.create({
    data: {
      tripId: await tripIdOfDay(tripDayId), tripDayId,
      title,
      fromTime,
      toTime,
      contentJson: sampleDoc(title),
      costCents: 3000,
      linkUrl: "https://example.com/item",
      locationLat: 48.1,
      locationLng: 11.5,
      locationLabel: "Somewhere",
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

/** Story 13.1: each seeded day is numbered the way the migration numbers real data. */
const createItem = async (...args: Parameters<typeof createRawItem>) => {
  const row = await createRawItem(...args);
  await settleSeededDay(row.tripDayId!);
  return prisma.dayPlanItem.findUniqueOrThrow({ where: { id: row.id } });
};

const createLeg = (tripDayId: string, fromId: string, toId: string) =>
  prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: "DAY_PLAN_ITEM",
      fromItemId: fromId,
      toItemType: "DAY_PLAN_ITEM",
      toItemId: toId,
      transportType: "WALKING",
      durationMinutes: 25,
      distanceKm: 1.75,
      linkUrl: "https://maps.example.com/leg",
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

const addPayments = (dayPlanItemId: string) =>
  prisma.costPayment.createMany({
    data: [
      { dayPlanItemId, amountCents: 1000, dueDate: "2026-10-01", sortOrder: 0, createdAt: PAST, updatedAt: PAST },
      { dayPlanItemId, amountCents: 2000, dueDate: "2026-10-01", sortOrder: 1, createdAt: PAST, updatedAt: PAST },
    ],
  });

/** Every row an undo could touch, in a stable order. */
const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  images: await prisma.dayPlanItemImage.findMany({ orderBy: { id: "asc" } }),
  documents: await prisma.dayPlanItemDocument.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

const mutation = (userId: string, tripId: string, tripDayId: string) => ({
  userId,
  tripId,
  tripDayId,
  costCents: null,
  linkUrl: null,
});

/** A, B, C at 09/12/15 with legs A→B and B→C: the day most cases start from. */
const seedDay = async (email: string) => {
  const user = await createUser(email);
  const { trip, day } = await createTrip(user.id);
  const a = await createItem(day.id, "A", "09:00", "10:00");
  const b = await createItem(day.id, "B", "12:00", "13:00");
  const c = await createItem(day.id, "C", "15:00", "16:00");
  const ab = await createLeg(day.id, a.id, b.id);
  const bc = await createLeg(day.id, b.id, c.id);
  return { user, trip, day, a, b, c, ab, bc };
};

/**
 * `seedDay` plus an untimed U after C, with the leg C→U: the day reads A, B, C, U.
 *
 * Story 11.2: Story 11.1 reached an order-changing update by retiming A past B (`retimeAAfterB`). Ruling 6
 * removed that route - a retime now keeps its place and pushes - so the update cases below reach the same
 * kind of change through the one PATCH that still reorders: an untimed activity given a time.
 */
const seedDayWithUntimed = async (email: string) => {
  const seeded = await seedDay(email);
  const u = await createItem(seeded.day.id, "U", null, null);
  const cu = await createLeg(seeded.day.id, seeded.c.id, u.id);
  return { ...seeded, u, cu };
};

/** Times U at 13:30, between B and C: A, B, U, C. Un-draws B→C and C→U; C has slack, so nothing moves. */
const timeUBetweenBAndC = (userId: string, tripId: string, tripDayId: string, itemId: string) =>
  updateDayPlanItemForTripDay({
    ...mutation(userId, tripId, tripDayId),
    itemId,
    title: "U timed",
    fromTime: "13:30",
    toTime: "14:00",
    contentJson: sampleDoc("U timed"),
    costCents: 500,
    payments: [{ amountCents: 500, dueDate: "2026-12-24" }],
    linkUrl: "https://example.com/changed",
  });

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

describe("undoDayPlanChangeForTrip restores the whole change (Story 11.1)", () => {
  beforeEach(resetDatabase);

  it("undoes a create: the item goes and every swept leg comes back identical", async () => {
    const { user, trip, day } = await seedDay("undo-create@example.com");
    const before = await databaseState();

    const created = await createDayPlanItemExpectingSuccess({
      ...mutation(user.id, trip.id, day.id),
      title: "M",
      fromTime: "10:30",
      toTime: "11:00",
      contentJson: sampleDoc("M"),
      costCents: 700,
      payments: [{ amountCents: 700, dueDate: "2026-11-01" }],
    });
    expect(created?.receipt.removedTravelSegments).toHaveLength(1);

    const result = await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: created!.receipt });

    expect(result).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("undoes an update: columns, payments, updatedAt and swept legs all return to the snapshot", async () => {
    const { user, trip, day, u } = await seedDayWithUntimed("undo-update@example.com");
    await addPayments(u.id);
    const before = await databaseState();

    const updated = await timeUBetweenBAndC(user.id, trip.id, day.id, u.id);
    expect(updated.status).toBe("updated");
    if (updated.status !== "updated") return;
    expect(updated.receipt.removedTravelSegments).toHaveLength(2);

    const result = await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: updated.receipt });

    expect(result).toEqual({ status: "undone" });
    const after = await databaseState();
    // Pinned on its own so a moved `updatedAt` reads as exactly that rather than as a large diff.
    expect(after.items.find((row) => row.id === u.id)?.updatedAt.getTime()).toBe(PAST.getTime());
    expect(after).toEqual(before);
  });

  it("undoes a delete: the item, its payments, image and document rows and its legs return identical", async () => {
    const { user, trip, day, b } = await seedDay("undo-delete@example.com");
    await addPayments(b.id);
    const mediaBase = `/uploads/trips/${trip.id}/days/${day.id}/items/${b.id}`;
    await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: b.id, imageUrl: `${mediaBase}/photo.webp`, sortOrder: 1, createdAt: PAST, updatedAt: PAST },
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: b.id,
        documentUrl: `${mediaBase}/documents/ticket.pdf`,
        fileName: "Ticket.pdf",
        sortOrder: 1,
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
    const before = await databaseState();

    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id });
    expect(deleted.status).toBe("deleted");
    if (deleted.status !== "deleted") return;
    expect(await prisma.dayPlanItemImage.count()).toBe(0);

    const result = await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: deleted.receipt });

    expect(result).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

});

/**
 * Story 14.1 AC8. "+" moves the parked activity itself onto the day; undo parks it again exactly: no day,
 * FLEXIBLE, no times, `sortOrder` 0, its previous `updatedAt`, and every row the schedule renumbered or
 * moved back where it was.
 */
describe("undo of a scheduled bucket-list idea (Story 14.1 AC8)", () => {
  beforeEach(resetDatabase);

  /** A parked idea with two pictures, a document and two payments, all stamped `PAST`. */
  const seedParked = async (tripId: string) => {
    const idea = await prisma.dayPlanItem.create({
      data: {
        tripId,
        tripDayId: null,
        title: "Idea",
        scheduleMode: "FLEXIBLE",
        durationMinutes: 120,
        contentJson: sampleDoc("Idea"),
        costCents: 3000,
        linkUrl: "https://example.com/idea",
        locationLat: 1.5,
        locationLng: 2.5,
        locationLabel: "Harbour",
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
    await addPayments(idea.id);
    const mediaBase = `/uploads/trips/${tripId}/parked/day-plan-items/${idea.id}`;
    await prisma.dayPlanItemImage.createMany({
      data: [
        { dayPlanItemId: idea.id, imageUrl: `${mediaBase}/one.webp`, sortOrder: 1, createdAt: PAST, updatedAt: PAST },
        { dayPlanItemId: idea.id, imageUrl: `${mediaBase}/two.webp`, sortOrder: 2, createdAt: PAST, updatedAt: PAST },
      ],
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: idea.id,
        documentUrl: `${mediaBase}/documents/ticket.pdf`,
        fileName: "Ticket.pdf",
        sortOrder: 1,
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
    return idea;
  };

  const schedule = async (userId: string, tripId: string, tripDayId: string, itemId: string) => {
    const result = await scheduleParkedDayPlanItemForTripDay({ userId, tripId, tripDayId, itemId });
    expect(result.status).toBe("scheduled");
    if (result.status !== "scheduled") throw new Error("not scheduled");
    return result;
  };

  it("moves the same activity onto the day with everything attached, and undo restores the whole database", async () => {
    const { user, trip, day } = await seedDay("undo-scheduled@example.com");
    const idea = await seedParked(trip.id);
    const before = await databaseState();

    const scheduled = await schedule(user.id, trip.id, day.id, idea.id);
    expect(scheduled.item).toMatchObject({ id: idea.id, tripDayId: day.id, scheduleMode: "FLEXIBLE", sortOrder: 3, durationMinutes: 120 });
    expect(scheduled.receipt.edited).toEqual({
      kind: "scheduled",
      itemId: idea.id,
      updatedAt: expect.any(Date),
      previousUpdatedAt: PAST,
    });
    // Same id, so nothing was copied: the pictures, the document and the payments are the same rows.
    const during = await databaseState();
    expect(during.images).toEqual(before.images);
    expect(during.documents).toEqual(before.documents);
    expect(during.payments).toEqual(before.payments);
    expect(during.items.find((row) => row.id === idea.id)).toMatchObject({ tripDayId: day.id, fromTime: "16:00", toTime: "18:00" });

    const result = await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: scheduled.receipt });

    expect(result).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses as stale after the scheduled activity was edited on its day", async () => {
    const { user, trip, day } = await seedDay("undo-scheduled-edited@example.com");
    const idea = await seedParked(trip.id);
    const scheduled = await schedule(user.id, trip.id, day.id, idea.id);
    const edited = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: idea.id,
      title: "Idea, renamed",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 120,
      fromTime: null,
      toTime: null,
      contentJson: sampleDoc("Idea"),
    });
    expect(edited.status).toBe("updated");

    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: scheduled.receipt })).toEqual({
      status: "stale",
    });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses as stale once a leg references the scheduled activity", async () => {
    const { user, trip, day, c } = await seedDay("undo-scheduled-leg@example.com");
    const idea = await seedParked(trip.id);
    const scheduled = await schedule(user.id, trip.id, day.id, idea.id);
    await createLeg(day.id, c.id, idea.id);

    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: scheduled.receipt })).toEqual({
      status: "stale",
    });
    expect(await databaseState()).toEqual(before);
  });

  it("is not stale after a picture was added on the day: the picture goes back to the list with it", async () => {
    const { user, trip, day } = await seedDay("undo-scheduled-image@example.com");
    const idea = await seedParked(trip.id);
    const scheduled = await schedule(user.id, trip.id, day.id, idea.id);
    const added = await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: idea.id,
        imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${idea.id}/new.webp`,
        sortOrder: 3,
      },
    });

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: scheduled.receipt })).toEqual({
      status: "undone",
    });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: idea.id } })).toMatchObject({
      tripDayId: null,
      scheduleMode: "FLEXIBLE",
      fromTime: null,
      toTime: null,
      sortOrder: 0,
      updatedAt: PAST,
    });
    expect(await prisma.dayPlanItemImage.findUnique({ where: { id: added.id } })).not.toBeNull();
  });

  it("brings back the leg to tonight's stay that appending the idea un-drew", async () => {
    const { user, trip, day, c } = await seedDay("undo-scheduled-stay-leg@example.com");
    const tonight = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Tonight", status: "BOOKED", createdAt: PAST, updatedAt: PAST },
    });
    const toStay = await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: c.id,
        toItemType: "ACCOMMODATION",
        toItemId: tonight.id,
        transportType: "WALKING",
        durationMinutes: 10,
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
    const idea = await seedParked(trip.id);
    const before = await databaseState();

    const scheduled = await schedule(user.id, trip.id, day.id, idea.id);
    expect(scheduled.receipt.removedTravelSegments).toEqual([toStay]);
    expect(await prisma.travelSegment.findUnique({ where: { id: toStay.id } })).toBeNull();

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: scheduled.receipt })).toEqual({
      status: "undone",
    });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses a scheduled receipt whose removed leg is still there (stale) or that lists the item as moved (invalid)", async () => {
    const { user, trip, day, ab } = await seedDay("undo-scheduled-forged@example.com");
    const idea = await seedParked(trip.id);
    const scheduled = await schedule(user.id, trip.id, day.id, idea.id);
    const leg = await prisma.travelSegment.findUniqueOrThrow({ where: { id: ab.id } });

    expect(
      await undoDayPlanChangeForTrip({
        userId: user.id,
        tripId: trip.id,
        receipt: { ...scheduled.receipt, removedTravelSegments: [leg] },
      }),
    ).toEqual({ status: "stale" });
    expect(
      await undoDayPlanChangeForTrip({
        userId: user.id,
        tripId: trip.id,
        receipt: {
          ...scheduled.receipt,
          movedItems: [
            {
              itemId: idea.id,
              previousFromTime: null,
              previousToTime: null,
              previousSortOrder: 0,
              fromTime: "16:00",
              toTime: "18:00",
              previousUpdatedAt: PAST,
              updatedAt: PAST,
            },
          ],
        },
      }),
    ).toEqual({ status: "invalid", reason: "edited item listed as moved" });
  });
});

describe("undo of a parked activity (Story 14.2 AC4)", () => {
  beforeEach(resetDatabase);

  const park = async (userId: string, tripId: string, tripDayId: string, itemId: string) => {
    const result = await parkDayPlanItemForTripDay({ userId, tripId, tripDayId, itemId });
    expect(result.status).toBe("parked");
    if (result.status !== "parked") throw new Error("not parked");
    return result;
  };

  const expectStale = async (userId: string, tripId: string, receipt: Parameters<typeof undoDayPlanChangeForTrip>[0]["receipt"]) => {
    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip({ userId, tripId, receipt })).toEqual({ status: "stale" });
    expect(await databaseState()).toEqual(before);
  };

  it("restores the whole database after a park that moved two rows and removed a leg", async () => {
    const { user, trip, day, a, c } = await seedFlexibleDay("undo-parked@example.com");
    const tonight = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Tonight", status: "BOOKED", createdAt: PAST, updatedAt: PAST },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: c.id,
        toItemType: "ACCOMMODATION",
        toItemId: tonight.id,
        transportType: "WALKING",
        durationMinutes: 10,
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
    await addPayments(a.id);
    const before = await databaseState();

    const parked = await park(user.id, trip.id, day.id, a.id);
    expect(parked.receipt.movedItems).toHaveLength(2);
    expect(parked.receipt.removedTravelSegments).toHaveLength(1);

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: parked.receipt })).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("restores a FIXED activity exactly: mode, times, duration, order and both legs", async () => {
    const { user, trip, day, b } = await seedDay("undo-parked-fixed@example.com");
    const before = await databaseState();

    const parked = await park(user.id, trip.id, day.id, b.id);
    expect(parked.receipt.removedTravelSegments).toHaveLength(2);

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: parked.receipt })).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses as stale after the parked activity was edited in the bucket list", async () => {
    const { user, trip, day, b } = await seedDay("undo-parked-edited@example.com");
    const parked = await park(user.id, trip.id, day.id, b.id);
    await tick();
    await prisma.dayPlanItem.update({ where: { id: b.id }, data: { title: "B, renamed", updatedAt: new Date() } });

    await expectStale(user.id, trip.id, parked.receipt);
  });

  it("refuses as stale after it was scheduled onto another day", async () => {
    const { user, trip, day, b } = await seedDay("undo-parked-scheduled@example.com");
    const otherDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
    });
    const parked = await park(user.id, trip.id, day.id, b.id);
    await tick();
    const scheduled = await scheduleParkedDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: otherDay.id, itemId: b.id });
    expect(scheduled.status).toBe("scheduled");

    await expectStale(user.id, trip.id, parked.receipt);
  });

  it("refuses as stale when a leg was drawn across the gap it left", async () => {
    const { user, trip, day, a, b, c } = await seedDay("undo-parked-across@example.com");
    const parked = await park(user.id, trip.id, day.id, b.id);
    await createLeg(day.id, a.id, c.id);

    await expectStale(user.id, trip.id, parked.receipt);
  });

  it("is not stale after a picture was added while parked: it comes back to the day with the activity", async () => {
    const { user, trip, day, b } = await seedDay("undo-parked-image@example.com");
    const parked = await park(user.id, trip.id, day.id, b.id);
    const added = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: b.id, imageUrl: `/uploads/trips/${trip.id}/parked/day-plan-items/${b.id}/new.webp`, sortOrder: 1 },
    });

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: parked.receipt })).toEqual({ status: "undone" });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      tripDayId: day.id,
      scheduleMode: "FIXED",
      fromTime: "12:00",
      toTime: "13:00",
      updatedAt: PAST,
    });
    expect(await prisma.dayPlanItemImage.findUniqueOrThrow({ where: { id: added.id } })).toMatchObject({ dayPlanItemId: b.id });
  });

  it("refuses through the route, with 400 and nothing written, a receipt naming another day, listing the item as moved, or carrying an unknown field", async () => {
    const { user, trip, day, b, c } = await seedDay("undo-parked-forged@example.com");
    const otherDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const parked = await park(user.id, trip.id, day.id, b.id);
    const wire = toDayChangeReceiptWire(parked.receipt);
    if (wire.edited.kind !== "parked") throw new Error("setup");
    const sign = (receipt: DayChangeReceiptWire) => signDayChangeReceipt(receipt, { tripId: trip.id, userId: user.id });

    const forgeries: DayChangeReceiptWire[] = [
      { ...wire, edited: { ...wire.edited, previous: { ...wire.edited.previous, tripDayId: otherDay.id } } },
      {
        ...wire,
        movedItems: [
          {
            itemId: b.id,
            previousFromTime: "12:00",
            previousToTime: "13:00",
            previousSortOrder: 1,
            fromTime: null,
            toTime: null,
            previousUpdatedAt: PAST.toISOString(),
            updatedAt: wire.edited.updatedAt,
          },
        ],
      },
      // AC5: strict on the wire, `edited` and its `previous` alike (review).
      { ...wire, edited: { ...wire.edited, title: "Wasserfall" } } as unknown as DayChangeReceiptWire,
      {
        ...wire,
        edited: { ...wire.edited, previous: { ...wire.edited.previous, linkUrl: null } },
      } as unknown as DayChangeReceiptWire,
    ];
    void c;
    for (const forged of forgeries) {
      const before = await databaseState();
      const result = await postUndo(trip.id, session, sign(forged));
      expect(result.status).toBe(400);
      expect(result.body.error?.code).toBe("validation_error");
      expect(await databaseState()).toEqual(before);
    }

    // The genuine receipt still works through the route.
    expect((await postUndo(trip.id, session, sign(wire))).status).toBe(200);
  });
});

describe("undoDayPlanChangeForTrip refuses when the day has moved on (Story 11.1 AC6)", () => {
  beforeEach(resetDatabase);

  /** Runs the undo and asserts the refusal wrote nothing. */
  const expectStale = async (params: Parameters<typeof undoDayPlanChangeForTrip>[0]) => {
    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip(params)).toEqual({ status: "stale" });
    expect(await databaseState()).toEqual(before);
  };

  it("refuses after a later PATCH of the updated item", async () => {
    const { user, trip, day, u } = await seedDayWithUntimed("stale-patch@example.com");
    const updated = await timeUBetweenBAndC(user.id, trip.id, day.id, u.id);
    if (updated.status !== "updated") throw new Error("setup");
    await tick();
    await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: u.id,
      title: "U edited later",
      fromTime: "13:30",
      toTime: "14:00",
      contentJson: sampleDoc("U edited later"),
    });

    await expectStale({ userId: user.id, tripId: trip.id, receipt: updated.receipt });
  });

  it("refuses when the created item has gained an image since", async () => {
    const { user, trip, day } = await seedDay("stale-image@example.com");
    const created = await createDayPlanItemExpectingSuccess({
      ...mutation(user.id, trip.id, day.id),
      title: "M",
      fromTime: "10:30",
      toTime: "11:00",
      contentJson: sampleDoc("M"),
    });
    await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: created!.item.id, imageUrl: `/uploads/trips/${trip.id}/x.webp`, sortOrder: 1 },
    });

    await expectStale({ userId: user.id, tripId: trip.id, receipt: created!.receipt });
  });

  it("refuses when someone has drawn a new leg for a removed pair", async () => {
    const { user, trip, day, b, c, u } = await seedDayWithUntimed("stale-pair@example.com");
    const updated = await timeUBetweenBAndC(user.id, trip.id, day.id, u.id);
    if (updated.status !== "updated") throw new Error("setup");
    // A fresh row for B→C (a new id), which the recreate would collide with on the pair index.
    await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: b.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: c.id,
        transportType: "CAR",
        durationMinutes: 5,
      },
    });

    await expectStale({ userId: user.id, tripId: trip.id, receipt: updated.receipt });
  });

  it("refuses when the undo would orphan a leg added since", async () => {
    const { user, trip, day, c, u } = await seedDayWithUntimed("stale-orphan@example.com");
    const updated = await timeUBetweenBAndC(user.id, trip.id, day.id, u.id);
    if (updated.status !== "updated") throw new Error("setup");
    // U→C is drawn now (A, B, U, C). Undoing puts U last again (A, B, C, U) and would un-draw it.
    await createLeg(day.id, u.id, c.id);

    await expectStale({ userId: user.id, tripId: trip.id, receipt: updated.receipt });
  });

  it("refuses when an endpoint of a removed leg has been deleted since", async () => {
    const { user, trip, day, b, u } = await seedDayWithUntimed("stale-endpoint@example.com");
    const updated = await timeUBetweenBAndC(user.id, trip.id, day.id, u.id);
    if (updated.status !== "updated") throw new Error("setup");
    await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id });

    await expectStale({ userId: user.id, tripId: trip.id, receipt: updated.receipt });
  });

  it("refuses when a later edit has put an activity between a removed leg's endpoints (review: drawn, not merely present)", async () => {
    const { user, trip, day, b } = await seedDay("stale-interposed@example.com");
    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id });
    if (deleted.status !== "deleted") throw new Error("setup");
    // N at 12:30 sits where B→C would run once B is back: A, B, N, C. Both endpoints of B→C exist, but
    // the pair is no longer consecutive, so restoring it would only refill the orphan list.
    await createItem(day.id, "N", "12:30", "12:45");

    await expectStale({ userId: user.id, tripId: trip.id, receipt: deleted.receipt });
  });

  it("refuses a leg between two endpoints that are not consecutive, even when both are on the day", async () => {
    const { user, trip, day, a, c } = await seedDay("stale-non-adjacent@example.com");
    const created = await createDayPlanItemExpectingSuccess({
      ...mutation(user.id, trip.id, day.id),
      title: "Late",
      fromTime: "18:00",
      toTime: "19:00",
      contentJson: sampleDoc("Late"),
    });
    // A receipt that never came from a write (the repository is below the route's signature check):
    // it claims the create removed A→C, which no timeline of this day ever drew.
    const forged = {
      ...created!.receipt,
      removedTravelSegments: [
        {
          id: "leg-forged",
          tripDayId: day.id,
          fromItemType: "DAY_PLAN_ITEM" as const,
          fromItemId: a.id,
          toItemType: "DAY_PLAN_ITEM" as const,
          toItemId: c.id,
          transportType: "CAR" as const,
          durationMinutes: 5,
          distanceKm: null,
          linkUrl: null,
          createdAt: PAST,
          updatedAt: PAST,
        },
      ],
    };

    await expectStale({ userId: user.id, tripId: trip.id, receipt: forged });
  });

  it("refuses a second undo of the same change", async () => {
    const { user, trip, day, b } = await seedDay("stale-twice@example.com");
    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id });
    if (deleted.status !== "deleted") throw new Error("setup");
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: deleted.receipt })).toEqual({
      status: "undone",
    });

    await expectStale({ userId: user.id, tripId: trip.id, receipt: deleted.receipt });
  });
});

/**
 * Story 13.1: `seedDay` with B and C flexible, so a change before them moves them. With the two
 * 25-minute legs the schedule stores B 10:25–11:25 and C 11:50–12:50.
 */
const seedFlexibleDay = async (email: string) => {
  const seeded = await seedDay(email);
  await settleSeededDay(seeded.day.id, { flexible: [seeded.b.id, seeded.c.id] });
  return seeded;
};

describe("undo takes back what the push moved (Story 11.2 AC10)", () => {
  beforeEach(resetDatabase);

  it("undoes a create that pushed an activity: every row identical, including the moved one's updatedAt", async () => {
    const { user, trip, day, b, c } = await seedFlexibleDay("undo-push-create@example.com");
    const before = await databaseState();

    // M 10:00–12:30 sits between A and B: A→B is swept, and B is pushed to 12:30. 13.1: C follows B.
    const created = await createDayPlanItemExpectingSuccess({
      ...mutation(user.id, trip.id, day.id),
      title: "M",
      fromTime: "10:00",
      toTime: "12:30",
      contentJson: sampleDoc("M"),
    });
    if (!created) throw new Error("setup");
    expect(created.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, c.id]);
    expect(created.receipt.removedTravelSegments).toHaveLength(1);

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: created.receipt })).toEqual({
      status: "undone",
    });
    expect(await databaseState()).toEqual(before);
  });

  it("undoes an update that pushed activities: columns, payments and every moved row return identical", async () => {
    const { user, trip, day, a, b } = await seedFlexibleDay("undo-push-update@example.com");
    await addPayments(a.id);
    const before = await databaseState();

    // A to 09:00–12:30: B must start at 12:30 + the 25-minute A→B leg = 12:55.
    const updated = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A longer",
      fromTime: "09:00",
      toTime: "12:30",
      contentJson: sampleDoc("A longer"),
      payments: [{ amountCents: 500, dueDate: "2026-12-24" }],
    });
    if (updated.status !== "updated") throw new Error("setup");
    // 13.1: B's previous times are the schedule's; C follows it.
    expect(updated.receipt.movedItems[0]).toMatchObject({ itemId: b.id, previousFromTime: "10:25", previousToTime: "11:25" });
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).fromTime).toBe("12:55");

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: updated.receipt })).toEqual({
      status: "undone",
    });
    const after = await databaseState();
    expect(after.items.find((row) => row.id === b.id)?.updatedAt.getTime()).toBe(PAST.getTime());
    expect(after).toEqual(before);
  });

  it("refuses when a moved activity has been edited since, and writes nothing", async () => {
    const { user, trip, day, a, b } = await seedFlexibleDay("undo-push-stale@example.com");
    const updated = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      fromTime: "09:00",
      toTime: "12:30",
      contentJson: sampleDoc("A"),
    });
    if (updated.status !== "updated") throw new Error("setup");
    await tick();
    await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: b.id,
      title: "B renamed",
      fromTime: "12:55",
      toTime: "13:55",
      contentJson: sampleDoc("B renamed"),
    });

    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: updated.receipt })).toEqual({
      status: "stale",
    });
    expect(await databaseState()).toEqual(before);
  });
});

/**
 * Story 11.3. A (3 h), B and C (1 h each), legs A→B and B→C. Story 13.1 makes all three flexible: the
 * schedule stores A 09–12, B 12:25–13:25, C 13:50–14:50. *Nach oben* on B gives B 09–10, A 10–13, moves C
 * to 13–14, and sweeps both legs: a swap, a move and a sweep in one receipt.
 */
const seedReordered = async (email: string) => {
  const user = await createUser(email);
  const { trip, day } = await createTrip(user.id);
  const a = await createItem(day.id, "A", "09:00", "12:00");
  const b = await createItem(day.id, "B", "10:00", "11:00");
  const c = await createItem(day.id, "C", "12:00", "13:00");
  await createLeg(day.id, a.id, b.id);
  await createLeg(day.id, b.id, c.id);
  await settleSeededDay(day.id, { flexible: [a.id, b.id, c.id] });
  const before = await databaseState();
  const reordered = await reorderDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });
  if (reordered.status !== "reordered") throw new Error("setup");
  return { user, trip, day, a, b, c, before, receipt: reordered.receipt };
};

describe("undo takes back a reorder (Story 11.3 AC10)", () => {
  beforeEach(resetDatabase);

  it("restores both swapped rows, the pushed one and the swept legs: every row identical", async () => {
    const { user, trip, a, b, c, before, receipt } = await seedReordered("undo-reorder@example.com");
    expect(receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id, c.id]);
    expect(receipt.removedTravelSegments).toHaveLength(2);

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt })).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses when a swapped row has been edited since, and writes nothing", async () => {
    const { user, trip, day, a, receipt } = await seedReordered("undo-reorder-stale-pair@example.com");
    await tick();
    await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A renamed",
      fromTime: "10:00",
      toTime: "13:00",
      contentJson: sampleDoc("A renamed"),
    });

    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt })).toEqual({ status: "stale" });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses when a pushed row has been edited since, and writes nothing", async () => {
    const { user, trip, day, c, receipt } = await seedReordered("undo-reorder-stale-pushed@example.com");
    await tick();
    await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: c.id,
      title: "C renamed",
      fromTime: "13:00",
      toTime: "14:00",
      contentJson: sampleDoc("C renamed"),
    });

    const before = await databaseState();
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt })).toEqual({ status: "stale" });
    expect(await databaseState()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
// The route: access, envelope and tampering (AC8, AC12).

const CSRF = "csrf-token-value";

const buildRequest = (url: string, options: { session?: string; csrf?: string; body: unknown }) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookies: string[] = [];
  if (options.session) cookies.push(`session=${options.session}`);
  if (options.csrf) {
    cookies.push(`csrf_token=${options.csrf}`);
    headers["x-csrf-token"] = options.csrf;
  }
  if (cookies.length > 0) headers.cookie = cookies.join("; ");
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(options.body) });
};

const undoUrl = (tripId: string) => `http://localhost/api/trips/${tripId}/day-plan-changes/undo`;

const postUndo = async (tripId: string, session: string, receipt: unknown, csrf: string | undefined = CSRF) => {
  const response = await UNDO_POST(buildRequest(undoUrl(tripId), { session, csrf, body: { receipt } }), routeContext(tripId));
  return { status: response.status, body: (await response.json()) as { data: unknown; error: { code: string } | null } };
};

describe("POST /api/trips/[id]/day-plan-changes/undo (Story 11.1)", () => {
  beforeEach(resetDatabase);

  /** A create through the real POST route, so the receipt is exactly the wire form a client holds. */
  const createThroughRoute = async (tripId: string, tripDayId: string, session: string) => {
    const response = await ITEMS_POST(
      buildRequest(`http://localhost/api/trips/${tripId}/day-plan-items`, {
        session,
        csrf: CSRF,
        body: { tripDayId, title: "M", fromTime: "10:30", toTime: "11:00", contentJson: sampleDoc("M") },
      }),
      routeContext(tripId),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { dayPlanItem: { id: string }; receipt: DayChangeReceiptWire } };
    return body.data;
  };

  it("undoes a change from the receipt the write route returned", async () => {
    const { user, trip, day } = await seedDay("route-undo@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const { receipt } = await createThroughRoute(trip.id, day.id, session);
    expect(receipt.removedTravelSegments).toHaveLength(1);

    const result = await postUndo(trip.id, session, receipt);
    expect(result).toEqual({ status: 200, body: { data: { undone: true }, error: null } });
    expect(await databaseState()).toEqual(before);
  });

  /**
   * Story 6.31 / AC7 (H2). A swept train leg travels in the receipt in its stored spelling, comes back
   * through the wire schema and is restored identical. A mode the receipt type or schema did not know
   * would fail here as a 400 rather than an undo.
   */
  it("undoes a change whose receipt holds a swept TRAIN leg", async () => {
    const { user, trip, day, ab } = await seedDay("route-undo-train@example.com");
    await prisma.travelSegment.update({ where: { id: ab.id }, data: { transportType: "TRAIN", updatedAt: PAST } });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const { receipt } = await createThroughRoute(trip.id, day.id, session);
    expect(receipt.removedTravelSegments).toHaveLength(1);
    expect(receipt.removedTravelSegments[0].transportType).toBe("TRAIN");

    const result = await postUndo(trip.id, session, receipt);
    expect(result).toEqual({ status: 200, body: { data: { undone: true }, error: null } });
    expect(await databaseState()).toEqual(before);
    expect((await prisma.travelSegment.findUnique({ where: { id: ab.id } }))?.transportType).toBe("TRAIN");
  });

  it("answers 409 undo_stale when the day has moved on", async () => {
    const { user, trip, day } = await seedDay("route-stale@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { receipt } = await createThroughRoute(trip.id, day.id, session);
    expect((await postUndo(trip.id, session, receipt)).status).toBe(200);

    const second = await postUndo(trip.id, session, receipt);
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("undo_stale");
  });

  it("refuses a viewer and a non-member with 404, and a missing CSRF token with 403", async () => {
    const { user, trip, day } = await seedDay("route-access@example.com");
    const ownerSession = await createSessionJwt({ sub: user.id, role: user.role });
    const { receipt } = await createThroughRoute(trip.id, day.id, ownerSession);

    const viewer = await createUser("route-viewer@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const stranger = await createUser("route-stranger@example.com");
    const before = await databaseState();

    const viewerResult = await postUndo(trip.id, await createSessionJwt({ sub: viewer.id, role: viewer.role }), receipt);
    expect(viewerResult.status).toBe(404);
    expect(viewerResult.body.error?.code).toBe("not_found");

    const strangerResult = await postUndo(trip.id, await createSessionJwt({ sub: stranger.id, role: stranger.role }), receipt);
    expect(strangerResult.status).toBe(404);

    const noCsrf = await postUndo(trip.id, ownerSession, receipt, "");
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error?.code).toBe("csrf_invalid");

    expect(await databaseState()).toEqual(before);
  });

  it("lets a contributor undo exactly as she may write", async () => {
    const { user, trip, day } = await seedDay("route-contrib-owner@example.com");
    const contributor = await createUser("route-contrib@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    const session = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    void user;

    const { receipt } = await createThroughRoute(trip.id, day.id, session);
    expect((await postUndo(trip.id, session, receipt)).status).toBe(200);
  });

  describe("tampered receipts are 400 and write nothing (AC12)", () => {
    const seedDeleted = async (email: string) => {
      const seeded = await seedDay(email);
      const session = await createSessionJwt({ sub: seeded.user.id, role: seeded.user.role });
      const deleted = await deleteDayPlanItemForTripDay({
        userId: seeded.user.id,
        tripId: seeded.trip.id,
        tripDayId: seeded.day.id,
        itemId: seeded.b.id,
      });
      if (deleted.status !== "deleted") throw new Error("setup");
      return { ...seeded, session, receipt: toDayChangeReceiptWire(deleted.receipt) };
    };

    /**
     * The signature is the first line of defence: everything below this helper would be refused for
     * that alone. So each tampered receipt is *re-signed* here, as a forger holding the key would — the
     * cases then reach, and pin, the schema and ownership checks underneath it.
     */
    const expectRejected = async (tripId: string, session: string, receipt: unknown) => {
      const userId = (await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, select: { userId: true } })).userId;
      const { signature: _ignored, ...unsigned } = receipt as DayChangeReceiptWire & { signature?: string };
      void _ignored;
      await expectRejectedAsSent(tripId, session, signDayChangeReceipt(unsigned, { tripId, userId }));
    };

    const expectRejectedAsSent = async (tripId: string, session: string, receipt: unknown) => {
      const before = await databaseState();
      const result = await postUndo(tripId, session, receipt);
      expect(result.status).toBe(400);
      expect(result.body.error?.code).toBe("validation_error");
      expect(await databaseState()).toEqual(before);
    };

    it("refuses a receipt naming another trip's day", async () => {
      const { user, trip, session, receipt } = await seedDeleted("tamper-day@example.com");
      const other = await createTrip(user.id);
      void trip;
      // The user may write to both trips; the receipt claims the *other* trip's day under this URL.
      await expectRejected(trip.id, session, {
        ...receipt,
        tripDayId: other.day.id,
        removedTravelSegments: receipt.removedTravelSegments.map((leg) => ({ ...leg, tripDayId: other.day.id })),
        edited: { ...receipt.edited, previous: { ...(receipt.edited as { previous: object }).previous, tripDayId: other.day.id } },
      });
    });

    it("refuses a leg on another day", async () => {
      const { trip, session, receipt } = await seedDeleted("tamper-leg@example.com");
      const otherDay = await prisma.tripDay.create({
        data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
      });
      await expectRejected(trip.id, session, {
        ...receipt,
        removedTravelSegments: [{ ...receipt.removedTravelSegments[0], tripDayId: otherDay.id }],
      });
    });

    it("refuses a javascript: link", async () => {
      const { trip, session, receipt } = await seedDeleted("tamper-link@example.com");
      await expectRejected(trip.id, session, {
        ...receipt,
        removedTravelSegments: [{ ...receipt.removedTravelSegments[0], linkUrl: "javascript:alert(1)" }],
      });
    });

    it("refuses a media URL that escapes the trip's directory", async () => {
      const { trip, day, b, session, receipt } = await seedDeleted("tamper-media@example.com");
      if (receipt.edited.kind !== "deleted") throw new Error("setup");
      const escaping = `/uploads/trips/${trip.id}/../other-trip/days/${day.id}/photo.webp`;
      await expectRejected(trip.id, session, {
        ...receipt,
        edited: {
          kind: "deleted",
          previous: {
            ...receipt.edited.previous,
            images: [
              {
                id: "img-forged",
                dayPlanItemId: b.id,
                imageUrl: escaping,
                sortOrder: 1,
                createdAt: PAST.toISOString(),
                updatedAt: PAST.toISOString(),
              },
            ],
          },
        },
      });
    });

    it("refuses a receipt the server did not sign, or altered after signing", async () => {
      const { trip, session, receipt } = await seedDeleted("tamper-unsigned@example.com");
      await expectRejectedAsSent(trip.id, session, receipt);

      const userId = (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { userId: true } })).userId;
      const signed = signDayChangeReceipt(receipt, { tripId: trip.id, userId });
      await expectRejectedAsSent(trip.id, session, {
        ...signed,
        removedTravelSegments: signed.removedTravelSegments.map((leg) => ({ ...leg, durationMinutes: leg.durationMinutes + 1 })),
      });
    });

    it("refuses a genuine receipt sent by another member of the trip", async () => {
      const { trip, receipt } = await seedDeleted("tamper-replay@example.com");
      const userId = (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { userId: true } })).userId;
      const signed = signDayChangeReceipt(receipt, { tripId: trip.id, userId });
      const contributor = await createUser("tamper-replay-contrib@example.com");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });

      await expectRejectedAsSent(trip.id, await createSessionJwt({ sub: contributor.id, role: contributor.role }), signed);
    });

    it("refuses unknown keys", async () => {
      const { trip, session, receipt } = await seedDeleted("tamper-keys@example.com");
      await expectRejected(trip.id, session, { ...receipt, extra: true });
    });

    const movedRow = (itemId: string) => ({
      itemId,
      previousFromTime: "08:00",
      previousToTime: "08:30",
      previousUpdatedAt: PAST.toISOString(),
      updatedAt: PAST.toISOString(),
    });

    it("refuses a moved item listed twice (Story 11.2)", async () => {
      const { trip, a, session, receipt } = await seedDeleted("tamper-moved-twice@example.com");
      await expectRejected(trip.id, session, { ...receipt, movedItems: [movedRow(a.id), movedRow(a.id)] });
    });

    it("refuses the edited item listed as moved (Story 11.2)", async () => {
      const { trip, b, session, receipt } = await seedDeleted("tamper-moved-edited@example.com");
      await expectRejected(trip.id, session, { ...receipt, movedItems: [movedRow(b.id)] });
    });

    describe("a reordered receipt (Story 11.3)", () => {
      const seedReorderedWire = async (email: string) => {
        const seeded = await seedReordered(email);
        const session = await createSessionJwt({ sub: seeded.user.id, role: seeded.user.role });
        return { ...seeded, session, wire: toDayChangeReceiptWire(seeded.receipt) };
      };

      it("is undone through the route when it is genuine", async () => {
        const { trip, session, before, user, receipt } = await seedReorderedWire("tamper-reorder-genuine@example.com");
        const signed = signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId: trip.id, userId: user.id });
        const result = await postUndo(trip.id, session, signed);
        expect(result.status).toBe(200);
        expect(await databaseState()).toEqual(before);
      });

      it("refuses a pair that names one activity twice", async () => {
        const { trip, b, session, wire } = await seedReorderedWire("tamper-reorder-self@example.com");
        await expectRejected(trip.id, session, { ...wire, edited: { kind: "reordered", itemId: b.id, neighbourId: b.id } });
      });

      it("refuses a pair whose activity is not listed as moved", async () => {
        const { trip, a, session, wire } = await seedReorderedWire("tamper-reorder-unlisted@example.com");
        await expectRejected(trip.id, session, { ...wire, movedItems: wire.movedItems.filter((row) => row.itemId !== a.id) });
      });

      it("refuses a consumed bucket-list row", async () => {
        const { trip, session, wire } = await seedReorderedWire("tamper-reorder-bucket@example.com");
        await expectRejected(trip.id, session, {
          ...wire,
          consumedBucketListItem: {
            id: "idea-forged",
            tripId: trip.id,
            title: "Idea",
            description: null,
            positionText: null,
            locationLat: null,
            locationLng: null,
            locationLabel: null,
            createdAt: PAST.toISOString(),
            updatedAt: PAST.toISOString(),
          },
        });
      });
    });

    it("refuses a version-1 receipt held across the deploy (Story 11.2)", async () => {
      const { trip, session, receipt } = await seedDeleted("tamper-v1@example.com");
      const { movedItems: _moved, ...v1 } = receipt;
      void _moved;
      await expectRejected(trip.id, session, { ...v1, version: 1 });
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Story 11.4 AC9/AC10: the leg and check-out kinds, through the same undo.

describe("undo takes back a leg or check-out push (Story 11.4)", () => {
  beforeEach(resetDatabase);

  /** `databaseState` plus the stays and days, which a check-out undo touches. */
  const fullState = async () => ({
    ...(await databaseState()),
    stays: await prisma.accommodation.findMany({ orderBy: { id: "asc" } }),
    days: await prisma.tripDay.findMany({ orderBy: { id: "asc" } }),
  });

  /**
   * Day 1 with last night's stay (check-out 09:00), day 2 with A, B, C where a 90 min A→B pushes B and C.
   * Story 13.1: all three flexible, stored A 09:00–09:30, B 09:30–10:30, C 10:30–11:00.
   */
  const seedLegDay = async (email: string) => {
    const user = await createUser(email);
    const { trip, day: stayDay } = await createTrip(user.id);
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
    });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: stayDay.id, name: "Glenfern", status: "PLANNED", checkOutTime: "09:00", createdAt: PAST, updatedAt: PAST },
    });
    const a = await createItem(day.id, "A", "09:30", "10:00");
    const b = await createItem(day.id, "B", "10:30", "11:30");
    const c = await createItem(day.id, "C", "11:30", "12:00");
    await settleSeededDay(day.id, { flexible: [a.id, b.id, c.id] });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    return { user, trip, stayDay, day, stay, a, b, c, session };
  };

  const legParams = (seeded: Awaited<ReturnType<typeof seedLegDay>>, durationMinutes: number) => ({
    userId: seeded.user.id,
    tripId: seeded.trip.id,
    tripDayId: seeded.day.id,
    fromItemType: "dayPlanItem" as const,
    fromItemId: seeded.a.id,
    toItemType: "dayPlanItem" as const,
    toItemId: seeded.b.id,
    transportType: "walking" as const,
    durationMinutes,
    distanceKm: 1.75,
    linkUrl: "https://maps.example.com/leg",
  });

  const createdLeg = async (seeded: Awaited<ReturnType<typeof seedLegDay>>) => {
    const result = await createTravelSegmentForTripDay(legParams(seeded, 90));
    if (result.status !== "created") throw new Error("setup");
    expect(result.receipt.movedItems).toHaveLength(2);
    return result.receipt;
  };

  const updatedLeg = async (seeded: Awaited<ReturnType<typeof seedLegDay>>) => {
    const leg = await createLeg(seeded.day.id, seeded.a.id, seeded.b.id);
    const result = await updateTravelSegmentForTripDay({ ...legParams(seeded, 90), segmentId: leg.id });
    if (result.status !== "updated") throw new Error("setup");
    expect(result.receipt.movedItems).toHaveLength(2);
    return { leg, receipt: result.receipt };
  };

  /** A check-out-only PATCH: the stay's other columns are written back as they were. */
  const laterCheckOut = async (seeded: Awaited<ReturnType<typeof seedLegDay>>, name = "Glenfern") => {
    const result = await updateAccommodationForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.stayDay.id,
      name,
      status: "planned",
      checkOutTime: "10:00",
    });
    if (result.status !== "updated" || !result.receipt) throw new Error("setup");
    expect(result.receipt.movedItems.length).toBeGreaterThan(0);
    return result.receipt;
  };

  it("undoes a leg create: the leg is gone and every moved row is identical", async () => {
    const seeded = await seedLegDay("undo-leg-create@example.com");
    const before = await fullState();
    const receipt = await createdLeg(seeded);

    expect(await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt })).toEqual({ status: "undone" });
    expect(await fullState()).toEqual(before);
  });

  it("undoes a leg update: the full previous row comes back, updatedAt included", async () => {
    const seeded = await seedLegDay("undo-leg-update@example.com");
    const stored = await createLeg(seeded.day.id, seeded.a.id, seeded.b.id);
    const before = await fullState();
    const result = await updateTravelSegmentForTripDay({ ...legParams(seeded, 90), segmentId: stored.id });
    if (result.status !== "updated") throw new Error("setup");

    expect(
      await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: result.receipt }),
    ).toEqual({ status: "undone" });
    const after = await fullState();
    expect(after.legs.find((row) => row.id === stored.id)?.updatedAt.getTime()).toBe(PAST.getTime());
    expect(after).toEqual(before);
  });

  it("undoes a check-out-only save: the stay and the pushed day read exactly as before", async () => {
    const seeded = await seedLegDay("undo-checkout@example.com");
    const before = await fullState();
    const receipt = await laterCheckOut(seeded);
    expect(receipt.tripDayId).toBe(seeded.day.id);

    expect(await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt })).toEqual({ status: "undone" });
    expect(await fullState()).toEqual(before);
  });

  it("keeps the stay's other saved fields and restores only the check-out", async () => {
    const seeded = await seedLegDay("undo-checkout-name@example.com");
    const receipt = await laterCheckOut(seeded, "Glenfern Villas");

    expect(await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt })).toEqual({ status: "undone" });
    expect(await prisma.accommodation.findUniqueOrThrow({ where: { id: seeded.stay.id } })).toMatchObject({
      name: "Glenfern Villas",
      checkOutTime: "09:00",
      updatedAt: PAST,
    });
  });

  it("refuses when the leg, the stay or a moved activity changed since, and writes nothing", async () => {
    const legSeed = await seedLegDay("undo-stale-leg@example.com");
    const { leg, receipt: legReceipt } = await updatedLeg(legSeed);
    await tick();
    await prisma.travelSegment.update({ where: { id: leg.id }, data: { transportType: "CYCLING" } });
    let before = await fullState();
    expect(await undoDayPlanChangeForTrip({ userId: legSeed.user.id, tripId: legSeed.trip.id, receipt: legReceipt })).toEqual({
      status: "stale",
    });
    expect(await fullState()).toEqual(before);

    await resetDatabase();
    const staySeed = await seedLegDay("undo-stale-stay@example.com");
    const stayReceipt = await laterCheckOut(staySeed);
    await tick();
    await prisma.accommodation.update({ where: { id: staySeed.stay.id }, data: { notes: "later edit" } });
    before = await fullState();
    expect(await undoDayPlanChangeForTrip({ userId: staySeed.user.id, tripId: staySeed.trip.id, receipt: stayReceipt })).toEqual({
      status: "stale",
    });
    expect(await fullState()).toEqual(before);

    await resetDatabase();
    const movedSeed = await seedLegDay("undo-stale-moved@example.com");
    const movedReceipt = await createdLeg(movedSeed);
    await tick();
    await prisma.dayPlanItem.update({ where: { id: movedSeed.c.id }, data: { title: "C edited" } });
    before = await fullState();
    expect(await undoDayPlanChangeForTrip({ userId: movedSeed.user.id, tripId: movedSeed.trip.id, receipt: movedReceipt })).toEqual({
      status: "stale",
    });
    expect(await fullState()).toEqual(before);

    await resetDatabase();
    const movedStaySeed = await seedLegDay("undo-stale-checkout-moved@example.com");
    const movedStayReceipt = await laterCheckOut(movedStaySeed);
    const movedId = movedStayReceipt.movedItems[0]!.itemId;
    await tick();
    await prisma.dayPlanItem.update({ where: { id: movedId }, data: { title: "edited since" } });
    before = await fullState();
    expect(
      await undoDayPlanChangeForTrip({ userId: movedStaySeed.user.id, tripId: movedStaySeed.trip.id, receipt: movedStayReceipt }),
    ).toEqual({ status: "stale" });
    expect(await fullState()).toEqual(before);
  });

  it("refuses to restore a re-pointed leg whose old endpoint has been deleted since, and writes nothing", async () => {
    const seeded = await seedLegDay("undo-leg-repointed@example.com");
    const stored = await createLeg(seeded.day.id, seeded.a.id, seeded.b.id);
    const result = await updateTravelSegmentForTripDay({
      ...legParams(seeded, 90),
      fromItemId: seeded.b.id,
      toItemId: seeded.c.id,
      segmentId: stored.id,
    });
    if (result.status !== "updated") throw new Error("setup");
    // The leg now names B→C, so deleting A sweeps nothing and leaves the leg's stamp untouched.
    await prisma.dayPlanItem.delete({ where: { id: seeded.a.id } });
    const before = await fullState();

    expect(
      await undoDayPlanChangeForTrip({ userId: seeded.user.id, tripId: seeded.trip.id, receipt: result.receipt }),
    ).toEqual({ status: "stale" });
    expect(await fullState()).toEqual(before);
  });

  it("refuses a check-out receipt naming a stay other than last night's as stale", async () => {
    const seeded = await seedLegDay("undo-checkout-other-stay@example.com");
    const receipt = await laterCheckOut(seeded);
    if (receipt.edited.kind !== "stayCheckOutChanged") throw new Error("setup");
    // Tonight's stay on the pushed day, stamped to match the receipt so only the "which night" rule refuses it.
    const tonight = await prisma.accommodation.create({
      data: { tripDayId: seeded.day.id, name: "Tonight", updatedAt: receipt.edited.updatedAt },
    });
    const before = await fullState();

    const result = await postUndo(
      seeded.trip.id,
      seeded.session,
      signDayChangeReceipt(
        toDayChangeReceiptWire({ ...receipt, edited: { ...receipt.edited, accommodationId: tonight.id } }),
        { tripId: seeded.trip.id, userId: seeded.user.id },
      ),
    );

    expect(result.status).toBe(409);
    expect(result.body.error?.code).toBe("undo_stale");
    expect(await fullState()).toEqual(before);
  });

  it("undoes a leg receipt through the route", async () => {
    const seeded = await seedLegDay("undo-leg-route@example.com");
    const before = await fullState();
    const receipt = await createdLeg(seeded);

    const result = await postUndo(
      seeded.trip.id,
      seeded.session,
      signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId: seeded.trip.id, userId: seeded.user.id }),
    );

    expect(result.status).toBe(200);
    expect(await fullState()).toEqual(before);
  });

  describe("tampered leg and check-out receipts are 400 and write nothing (AC10)", () => {
    const forgedLeg = (tripDayId: string): DayChangeReceiptWire["removedTravelSegments"][number] => ({
      id: "leg-forged",
      tripDayId,
      fromItemType: "DAY_PLAN_ITEM",
      fromItemId: "x",
      toItemType: "DAY_PLAN_ITEM",
      toItemId: "y",
      transportType: "CAR",
      durationMinutes: 10,
      distanceKm: 1,
      linkUrl: null,
      createdAt: PAST.toISOString(),
      updatedAt: PAST.toISOString(),
    });
    const forgedIdea = (tripId: string) => ({
      id: "idea-forged",
      tripId,
      title: "Idea",
      description: null,
      positionText: null,
      locationLat: null,
      locationLng: null,
      locationLabel: null,
      createdAt: PAST.toISOString(),
      updatedAt: PAST.toISOString(),
    });

    const expectForgeryRejected = async (seeded: Awaited<ReturnType<typeof seedLegDay>>, wire: DayChangeReceiptWire) => {
      const before = await fullState();
      const result = await postUndo(
        seeded.trip.id,
        seeded.session,
        signDayChangeReceipt(wire, { tripId: seeded.trip.id, userId: seeded.user.id }),
      );
      expect(result.status).toBe(400);
      expect(result.body.error?.code).toBe("validation_error");
      expect(await fullState()).toEqual(before);
    };

    it("refuses a leg receipt with a removed leg or a consumed idea", async () => {
      const seeded = await seedLegDay("tamper-leg-extras@example.com");
      const wire = toDayChangeReceiptWire(await createdLeg(seeded));
      await expectForgeryRejected(seeded, { ...wire, removedTravelSegments: [forgedLeg(seeded.day.id)] });
      await expectForgeryRejected(seeded, { ...wire, consumedBucketListItem: forgedIdea(seeded.trip.id) } as DayChangeReceiptWire);
    });

    it("refuses a legUpdated whose previous row is another leg or on another day", async () => {
      const seeded = await seedLegDay("tamper-leg-previous@example.com");
      const { receipt } = await updatedLeg(seeded);
      const wire = toDayChangeReceiptWire(receipt);
      if (wire.edited.kind !== "legUpdated") throw new Error("setup");
      await expectForgeryRejected(seeded, { ...wire, edited: { ...wire.edited, previous: { ...wire.edited.previous, id: "leg-other" } } });
      await expectForgeryRejected(seeded, {
        ...wire,
        edited: { ...wire.edited, previous: { ...wire.edited.previous, tripDayId: seeded.stayDay.id } },
      });
    });

    it("refuses a check-out receipt with a removed leg or a consumed idea", async () => {
      const seeded = await seedLegDay("tamper-checkout-extras@example.com");
      const wire = toDayChangeReceiptWire(await laterCheckOut(seeded));
      await expectForgeryRejected(seeded, { ...wire, removedTravelSegments: [forgedLeg(seeded.day.id)] });
      await expectForgeryRejected(seeded, { ...wire, consumedBucketListItem: forgedIdea(seeded.trip.id) } as DayChangeReceiptWire);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Story 13.1 AC12: every write recomputes the day, and one undo restores it exactly, including the
// rows only renumbered and how the edited activity was planned.

describe("undo restores a recomputed day exactly (Story 13.1 AC12)", () => {
  beforeEach(resetDatabase);

  const fullState = async () => ({
    ...(await databaseState()),
    stays: await prisma.accommodation.findMany({ orderBy: { id: "asc" } }),
  });

  const undo = (userId: string, tripId: string, receipt: Parameters<typeof undoDayPlanChangeForTrip>[0]["receipt"]) =>
    undoDayPlanChangeForTrip({ userId, tripId, receipt });

  it("undoes a switch from fixed to flexible: mode, duration, times and the rows it pulled forward", async () => {
    const { user, trip, day, a, b, c } = await seedFlexibleDay("undo-13-1-to-flexible@example.com");
    const before = await databaseState();

    // A becomes flexible for 30 minutes: it starts at 09:00 still, and B and C come forward.
    const updated = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 30,
      fromTime: null,
      toTime: null,
      contentJson: sampleDoc("A"),
    });
    if (updated.status !== "updated") throw new Error(`expected an update, got ${updated.status}`);
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      scheduleMode: "FLEXIBLE",
      durationMinutes: 30,
      fromTime: "09:00",
      toTime: "09:30",
    });
    expect(updated.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, c.id]);

    expect(await undo(user.id, trip.id, updated.receipt)).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("undoes a switch from flexible to fixed that placed the row by its time", async () => {
    const { user, trip, day, c } = await seedFlexibleDay("undo-13-1-to-fixed@example.com");
    const before = await databaseState();

    // C fixed at 08:00 goes first; A→B and B→C are no longer drawn and are swept.
    const updated = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: c.id,
      title: "C",
      scheduleMode: "FIXED",
      fromTime: "08:00",
      toTime: "08:45",
      contentJson: sampleDoc("C"),
    });
    if (updated.status !== "updated") throw new Error(`expected an update, got ${updated.status}`);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: c.id } })).sortOrder).toBe(0);

    expect(await undo(user.id, trip.id, updated.receipt)).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("undoes a delete that pulled the day forward", async () => {
    const { user, trip, day, a } = await seedFlexibleDay("undo-13-1-delete@example.com");
    const before = await databaseState();

    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id });
    if (deleted.status !== "deleted") throw new Error("setup");
    expect(deleted.receipt.movedItems.length).toBeGreaterThan(0);

    expect(await undo(user.id, trip.id, deleted.receipt)).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("undoes a leg delete: the leg comes back with its id and stamps, and the rows it moved too", async () => {
    const { user, trip, day, ab, b } = await seedFlexibleDay("undo-13-1-leg-delete@example.com");
    const before = await fullState();

    const deleted = await deleteTravelSegmentForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, segmentId: ab.id });
    if (deleted.status !== "deleted") throw new Error("setup");
    expect(deleted.receipt.edited).toEqual({ kind: "legDeleted", segmentId: ab.id, previous: ab });
    expect(deleted.receipt.movedItems.map((row) => row.itemId)).toContain(b.id);

    expect(await undo(user.id, trip.id, deleted.receipt)).toEqual({ status: "undone" });
    expect(await fullState()).toEqual(before);
  });

  it("refuses a leg-delete undo when the leg exists again, and writes nothing", async () => {
    const { user, trip, day, ab } = await seedFlexibleDay("undo-13-1-leg-delete-stale@example.com");
    const deleted = await deleteTravelSegmentForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, segmentId: ab.id });
    if (deleted.status !== "deleted") throw new Error("setup");
    await prisma.travelSegment.create({ data: ab });

    const before = await fullState();
    expect(await undo(user.id, trip.id, deleted.receipt)).toEqual({ status: "stale" });
    expect(await fullState()).toEqual(before);
  });

  it("undoes an earlier check-out that pulled the next day forward", async () => {
    const user = await createUser("undo-13-1-earlier-checkout@example.com");
    const { trip, day: stayDay } = await createTrip(user.id);
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
    });
    await prisma.accommodation.create({
      data: { tripDayId: stayDay.id, name: "Glenfern", status: "PLANNED", checkOutTime: "11:00", createdAt: PAST, updatedAt: PAST },
    });
    const f = await createItem(day.id, "F", "11:00", "12:00");
    await settleSeededDay(day.id, { flexible: [f.id] });
    const before = await fullState();

    const result = await updateAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: stayDay.id,
      name: "Glenfern",
      status: "planned",
      checkOutTime: "08:00",
    });
    if (result.status !== "updated" || !result.receipt) throw new Error("setup");
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: f.id } })).fromTime).toBe("08:00");

    expect(await undo(user.id, trip.id, result.receipt)).toEqual({ status: "undone" });
    expect(await fullState()).toEqual(before);
  });

  it("refuses when a row only renumbered has changed since, and writes nothing", async () => {
    const { user, trip, day, a, c } = await seedFlexibleDay("undo-13-1-renumbered-stale@example.com");
    // C fixed at 08:00 goes first: A keeps its fixed times and is only renumbered, 0 → 1.
    const updated = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: c.id,
      title: "C",
      fromTime: "08:00",
      toTime: "08:45",
      contentJson: sampleDoc("C"),
    });
    if (updated.status !== "updated") throw new Error("setup");
    const renumbered = updated.receipt.movedItems.find((row) => row.itemId === a.id);
    expect(renumbered).toMatchObject({ previousFromTime: "09:00", fromTime: "09:00", previousSortOrder: 0 });
    await tick();
    await prisma.dayPlanItem.update({ where: { id: a.id }, data: { title: "A renamed" } });

    const before = await databaseState();
    expect(await undo(user.id, trip.id, updated.receipt)).toEqual({ status: "stale" });
    expect(await databaseState()).toEqual(before);
  });
});
