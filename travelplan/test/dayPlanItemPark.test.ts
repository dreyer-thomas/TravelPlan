import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  listDayPlanItemsForTripDay,
  parkDayPlanItemForTripDay,
  parkedDayPlanItemsWhere,
  scheduleParkedDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { receiptHasSideEffects } from "@/lib/trips/dayChangeReceipt";
import { settleSeededDay } from "./helpers/settleSeededDay";

/**
 * Story 14.2 AC1, AC6, AC8. *Parken* moves the activity itself off the day: the same row, with
 * everything attached, `tripDayId` null and the parked schedule columns, and the day is recomputed
 * around the gap in the same transaction.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const PAST = new Date("2026-01-02T03:04:05.678Z");

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

/** Two days, so day 2 has last night's stay (day 1's) as its leading endpoint. */
const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Park Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-06T00:00:00.000Z"),
    },
  });
  const firstDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
  });
  return { trip, firstDay, day };
};

const createItem = (tripId: string, tripDayId: string, title: string, fromTime: string, toTime: string) =>
  prisma.dayPlanItem.create({
    data: {
      tripId,
      tripDayId,
      title,
      fromTime,
      toTime,
      contentJson: sampleDoc(title),
      costCents: 2500,
      linkUrl: "https://example.com/item",
      locationLat: 48.1,
      locationLng: 11.5,
      locationLabel: "Somewhere",
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

type Endpoint = { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string };
const item = (id: string): Endpoint => ({ type: "DAY_PLAN_ITEM", id });
const stay = (id: string): Endpoint => ({ type: "ACCOMMODATION", id });

const createLeg = (tripDayId: string, from: Endpoint, to: Endpoint) =>
  prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: from.type,
      fromItemId: from.id,
      toItemType: to.type,
      toItemId: to.id,
      transportType: "WALKING",
      durationMinutes: 25,
      distanceKm: 1.75,
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

/**
 * A 09:00–10:00 fixed, B and C flexible (60 minutes each), legs A→B and B→C of 25 minutes: B
 * 10:25–11:25, C 11:50–12:50.
 */
const seedDay = async (email: string) => {
  const user = await createUser(email);
  const { trip, firstDay, day } = await createTrip(user.id);
  const a = await createItem(trip.id, day.id, "A", "09:00", "10:00");
  const b = await createItem(trip.id, day.id, "B", "10:00", "11:00");
  const c = await createItem(trip.id, day.id, "C", "11:00", "12:00");
  const ab = await createLeg(day.id, item(a.id), item(b.id));
  const bc = await createLeg(day.id, item(b.id), item(c.id));
  await settleSeededDay(day.id, { flexible: [b.id, c.id] });
  return { user, trip, firstDay, day, a, b, c, ab, bc };
};

const park = async (userId: string, tripId: string, tripDayId: string, itemId: string) => {
  const result = await parkDayPlanItemForTripDay({ origin: "user", userId, tripId, tripDayId, itemId });
  expect(result.status).toBe("parked");
  if (result.status !== "parked") throw new Error("not parked");
  return result;
};

const dayRows = (tripDayId: string) =>
  prisma.dayPlanItem.findMany({ where: { tripDayId }, orderBy: { sortOrder: "asc" } });

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

describe("parkDayPlanItemForTripDay (Story 14.2 AC1)", () => {
  beforeEach(resetDatabase);

  it("parks the middle activity: the later one moves earlier, the order stays dense, the row is parked", async () => {
    const { user, trip, day, a, b, c, ab, bc } = await seedDay("park-middle@example.com");
    expect((await dayRows(day.id)).map((row) => [row.title, row.fromTime])).toEqual([
      ["A", "09:00"],
      ["B", "10:25"],
      ["C", "11:50"],
    ]);

    const parked = await park(user.id, trip.id, day.id, b.id);

    // C moved earlier by B's 60 minutes and both 25-minute legs.
    expect((await dayRows(day.id)).map((row) => [row.id, row.sortOrder, row.fromTime, row.toTime])).toEqual([
      [a.id, 0, "09:00", "10:00"],
      [c.id, 1, "10:00", "11:00"],
    ]);
    const row = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({
      tripId: trip.id,
      tripDayId: null,
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      fromTime: null,
      toTime: null,
      sortOrder: 0,
      title: "B",
      costCents: 2500,
      linkUrl: "https://example.com/item",
      locationLabel: "Somewhere",
    });
    expect(parked.item).toMatchObject({ id: b.id, tripDayId: null, scheduleMode: "FLEXIBLE", durationMinutes: 60 });

    expect(parked.receipt).toMatchObject({ version: 3, tripDayId: day.id });
    expect(parked.receipt.edited).toEqual({
      kind: "parked",
      itemId: b.id,
      updatedAt: row.updatedAt,
      previous: {
        tripDayId: day.id,
        scheduleMode: "FLEXIBLE",
        durationMinutes: 60,
        sortOrder: 1,
        fromTime: "10:25",
        toTime: "11:25",
        updatedAt: PAST,
        previousAiChangedAt: null,
      },
    });
    expect(parked.receipt.removedTravelSegments.map((leg) => leg.id).sort()).toEqual([ab.id, bc.id].sort());
    expect(parked.receipt.movedItems).toEqual([
      expect.objectContaining({ itemId: c.id, previousFromTime: "11:50", fromTime: "10:00", previousSortOrder: 2 }),
    ]);
    expect(receiptHasSideEffects(parked.receipt)).toBe(true);
    expect(await prisma.travelSegment.count()).toBe(0);
  });

  it("parks a FIXED 10:00–12:00 activity with 120 minutes, even when its stored duration drifted", async () => {
    const user = await createUser("park-fixed@example.com");
    const { trip, day } = await createTrip(user.id);
    const fixed = await createItem(trip.id, day.id, "Fixed", "10:00", "12:00");
    await settleSeededDay(day.id);
    // 13.1's backfill can leave a stored duration that no longer matches the times.
    await prisma.dayPlanItem.update({ where: { id: fixed.id }, data: { durationMinutes: 45, updatedAt: PAST } });

    const parked = await park(user.id, trip.id, day.id, fixed.id);

    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: fixed.id } })).toMatchObject({
      tripDayId: null,
      scheduleMode: "FLEXIBLE",
      durationMinutes: 120,
      fromTime: null,
      toTime: null,
      sortOrder: 0,
    });
    // The receipt keeps what was stored, so undo writes the drifted value back unchanged.
    expect(parked.receipt.edited).toMatchObject({
      previous: { scheduleMode: "FIXED", durationMinutes: 45, fromTime: "10:00", toTime: "12:00" },
    });
    expect(parked.receipt.movedItems).toEqual([]);
  });

  it("removes the legs into and out of it, and the legs to both stays, each once", async () => {
    const user = await createUser("park-legs@example.com");
    const { trip, firstDay, day } = await createTrip(user.id);
    const lastNight = await prisma.accommodation.create({ data: { tripDayId: firstDay.id, name: "Last night", status: "BOOKED" } });
    const tonight = await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Tonight", status: "BOOKED" } });
    const only = await createItem(trip.id, day.id, "Only", "10:00", "11:00");
    await settleSeededDay(day.id);
    const into = await createLeg(day.id, stay(lastNight.id), item(only.id));
    const out = await createLeg(day.id, item(only.id), stay(tonight.id));
    // A leg between the two stays was undrawn while the activity stood between them; it stays.
    const across = await createLeg(day.id, stay(lastNight.id), stay(tonight.id));

    const parked = await park(user.id, trip.id, day.id, only.id);

    const removedIds = parked.receipt.removedTravelSegments.map((leg) => leg.id);
    expect(removedIds.sort()).toEqual([into.id, out.id].sort());
    expect(new Set(removedIds).size).toBe(removedIds.length);
    expect(parked.receipt.removedTravelSegments).toEqual(expect.arrayContaining([into, out]));
    expect((await prisma.travelSegment.findMany()).map((leg) => leg.id)).toEqual([across.id]);
  });

  it("removes a leg naming it that was never drawn, so no leg is left pointing at a parked row", async () => {
    const { user, trip, day, b, c, ab, bc } = await seedDay("park-orphan@example.com");
    // C→B runs against the order, so the timeline never draws it and the sweep would never take it.
    const backwards = await createLeg(day.id, item(c.id), item(b.id));

    const parked = await park(user.id, trip.id, day.id, b.id);

    expect(parked.receipt.removedTravelSegments.map((leg) => leg.id).sort()).toEqual([ab.id, bc.id, backwards.id].sort());
    expect(
      await prisma.travelSegment.count({
        where: { OR: [{ fromItemId: b.id }, { toItemId: b.id }] },
      }),
    ).toBe(0);
  });

  it("keeps its pictures, documents and payments: the same rows, untouched", async () => {
    const { user, trip, day, b } = await seedDay("park-media@example.com");
    const base = `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${b.id}`;
    await prisma.dayPlanItemImage.createMany({
      data: [1, 2].map((sortOrder) => ({ dayPlanItemId: b.id, imageUrl: `${base}/${sortOrder}.webp`, sortOrder, createdAt: PAST, updatedAt: PAST })),
    });
    await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: b.id, documentUrl: `${base}/documents/t.pdf`, fileName: "t.pdf", sortOrder: 1, createdAt: PAST, updatedAt: PAST },
    });
    await prisma.costPayment.createMany({
      data: [0, 1].map((sortOrder) => ({ dayPlanItemId: b.id, amountCents: 1250, dueDate: "2026-11-01", sortOrder, createdAt: PAST, updatedAt: PAST })),
    });
    const media = async () => ({
      images: await prisma.dayPlanItemImage.findMany({ orderBy: { id: "asc" } }),
      documents: await prisma.dayPlanItemDocument.findMany({ orderBy: { id: "asc" } }),
      payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await media();

    await park(user.id, trip.id, day.id, b.id);

    expect(await media()).toEqual(before);
  });

  it("lands in the bucket list and leaves the day's list", async () => {
    const { user, trip, day, a, b, c } = await seedDay("park-readers@example.com");

    await park(user.id, trip.id, day.id, b.id);

    expect((await prisma.dayPlanItem.findMany({ where: parkedDayPlanItemsWhere(trip.id) })).map((row) => row.id)).toEqual([b.id]);
    const listed = await listDayPlanItemsForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id });
    expect(listed?.map((row) => row.id)).toEqual([a.id, c.id]);
  });

  it("works for a contributor", async () => {
    const { trip, day, b } = await seedDay("park-owner@example.com");
    const contributor = await createUser("park-contributor@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });

    await park(contributor.id, trip.id, day.id, b.id);
  });
});

describe("parkDayPlanItemForTripDay refusals (Story 14.2 AC8)", () => {
  beforeEach(resetDatabase);

  const state = async () => ({
    items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
    legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  });

  it("is missing for an activity on another day, an already parked one, or an unknown id, and writes nothing", async () => {
    const { user, trip, firstDay, day } = await seedDay("park-missing@example.com");
    const elsewhere = await createItem(trip.id, firstDay.id, "Elsewhere", "09:00", "10:00");
    const alreadyParked = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: null, scheduleMode: "FLEXIBLE", title: "Idea", contentJson: sampleDoc("Idea") },
    });
    const before = await state();

    for (const itemId of [elsewhere.id, alreadyParked.id, "unknown"]) {
      expect(await parkDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId })).toEqual({
        status: "missing",
      });
    }
    expect(await state()).toEqual(before);
  });

  it("is not_found for a viewer and for an outsider, and writes nothing", async () => {
    const { trip, day, b } = await seedDay("park-viewer-owner@example.com");
    const viewer = await createUser("park-viewer@example.com");
    const outsider = await createUser("park-outsider@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const before = await state();

    for (const userId of [viewer.id, outsider.id]) {
      expect(await parkDayPlanItemForTripDay({ origin: "user", userId, tripId: trip.id, tripDayId: day.id, itemId: b.id })).toEqual({
        status: "not_found",
      });
    }
    expect(await state()).toEqual(before);
  });
});

describe("a parked activity scheduled onto another day comes back whole (Story 14.2 AC6)", () => {
  beforeEach(resetDatabase);

  it("keeps every child row, its text, link, cost and location; a FIXED 10:00–12:00 arrives FLEXIBLE with 120 minutes", async () => {
    const user = await createUser("park-round-trip@example.com");
    const { trip, firstDay, day } = await createTrip(user.id);
    const richDoc = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Bring ", marks: [{ type: "bold" }] }, { type: "text", text: "a towel" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Ticket" }] }] }] },
      ],
    });
    const source = await prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: firstDay.id,
        title: "Wasserfall",
        fromTime: "10:00",
        toTime: "12:00",
        contentJson: richDoc,
        costCents: 2500,
        costOriginalAmount: 2700,
        costCurrency: "USD",
        costRate: 0.925,
        costRateDate: "2026-10-01",
        linkUrl: "https://example.com/falls",
        locationLat: 47.1,
        locationLng: 10.2,
        locationLabel: "Falls",
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
    await settleSeededDay(firstDay.id);
    const base = `/uploads/trips/${trip.id}/days/${firstDay.id}/day-plan-items/${source.id}`;
    await prisma.dayPlanItemImage.createMany({
      data: [1, 2].map((sortOrder) => ({ dayPlanItemId: source.id, imageUrl: `${base}/${sortOrder}.webp`, sortOrder })),
    });
    await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: source.id, documentUrl: `${base}/documents/ticket.pdf`, fileName: "ticket.pdf", sortOrder: 1 },
    });
    await prisma.costPayment.createMany({
      data: [
        { dayPlanItemId: source.id, amountCents: 1000, amountOriginal: 1080, dueDate: "2026-10-15", sortOrder: 0 },
        { dayPlanItemId: source.id, amountCents: 1500, amountOriginal: 1620, dueDate: "2026-11-05", sortOrder: 1 },
      ],
    });
    const children = async () => ({
      images: await prisma.dayPlanItemImage.findMany({ orderBy: { id: "asc" } }),
      documents: await prisma.dayPlanItemDocument.findMany({ orderBy: { id: "asc" } }),
      payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: source.id } });
    const childrenBefore = await children();

    await park(user.id, trip.id, firstDay.id, source.id);
    const scheduled = await scheduleParkedDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: source.id });
    expect(scheduled.status).toBe("scheduled");

    const after = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: source.id } });
    const unchanged = (row: typeof before) => {
      const { tripDayId: _day, scheduleMode: _mode, fromTime: _from, toTime: _to, sortOrder: _order, updatedAt: _stamp, durationMinutes: _duration, ...rest } = row;
      void [_day, _mode, _from, _to, _order, _stamp, _duration];
      return rest;
    };
    expect(unchanged(after)).toEqual(unchanged(before));
    expect(after).toMatchObject({ tripDayId: day.id, scheduleMode: "FLEXIBLE", durationMinutes: 120, fromTime: "09:00", toTime: "11:00" });
    expect(await children()).toEqual(childrenBefore);
  });
});
