import { beforeEach, describe, expect, it } from "vitest";
import { createDayPlanItemExpectingSuccess } from "./helpers/createDayPlanItem";
import { prisma } from "@/lib/db/prisma";
import {
  convertBucketListItemToDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { receiptHasSideEffects } from "@/lib/trips/dayChangeReceipt";
import { settleSeededDay } from "./helpers/settleSeededDay";

/**
 * Story 11.1 AC1/AC2. A leg that the change itself un-draws leaves in the same transaction, and the
 * receipt carries it in full so the change can be taken back. Supersedes Story 8.5 AC3 (the epic's AC2),
 * which kept such legs and listed them as orphans.
 *
 * The rule has two halves and both are pinned here: legs drawn *before* and not drawn *after* go, and
 * legs that were already undrawn before the change stay (AC1 "pre-existing orphans are not swept").
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const createUser = async (email: string) =>
  prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

/** Two days, so day 2 has last night's stay (day 1's) as its leading endpoint. */
const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Sweep Trip",
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

const createRawItem = (tripDayId: string, title: string, fromTime: string | null, toTime: string | null) =>
  prisma.dayPlanItem.create({
    data: { tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title) },
  });

/** Story 13.1: each seeded day is numbered the way the migration numbers real data. */
const createItem = async (...args: Parameters<typeof createRawItem>) => {
  const row = await createRawItem(...args);
  await settleSeededDay(row.tripDayId);
  return prisma.dayPlanItem.findUniqueOrThrow({ where: { id: row.id } });
};

const createLeg = (
  tripDayId: string,
  from: { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string },
  to: { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string },
  durationMinutes = 30,
) =>
  prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: from.type,
      fromItemId: from.id,
      toItemType: to.type,
      toItemId: to.id,
      transportType: "CAR",
      durationMinutes,
      distanceKm: 12.5,
      linkUrl: "https://maps.example.com/route",
    },
  });

const item = (id: string) => ({ type: "DAY_PLAN_ITEM" as const, id });
const stay = (id: string) => ({ type: "ACCOMMODATION" as const, id });

const baseMutation = (userId: string, tripId: string, tripDayId: string) => ({
  userId,
  tripId,
  tripDayId,
  costCents: null,
  linkUrl: null,
});

describe("day plan writes sweep the legs they un-draw (Story 11.1)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.tripBucketListItem.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("sweeps A→B when an activity is created between A and B, and carries the full row", async () => {
    const user = await createUser("sweep-create@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "15:00", "16:00");
    const leg = await createLeg(day.id, item(a.id), item(b.id), 40);

    const result = await createDayPlanItemExpectingSuccess({
      ...baseMutation(user.id, trip.id, day.id),
      title: "M",
      fromTime: "12:00",
      toTime: "13:00",
      contentJson: sampleDoc("M"),
    });

    expect(await prisma.travelSegment.count({ where: { tripDayId: day.id } })).toBe(0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.receipt.tripDayId).toBe(day.id);
    expect(result.receipt.edited).toEqual({
      kind: "created",
      itemId: result.item.id,
      updatedAt: expect.any(Date),
    });
    expect(result.receipt.removedTravelSegments).toEqual([leg]);
    expect(receiptHasSideEffects(result.receipt)).toBe(true);
  });

  /**
   * Story 11.2 supersedes this case's Story 11.1 form ("sweeps the legs a retime breaks when it changes
   * the order"). Ruling 6: a time change never reorders the day, so A retimed past B keeps its place and
   * pushes B and C instead, and nothing is un-drawn. The sweep's order-change coverage is the create case
   * above and the untimed case below, which still reach an order change.
   */
  it("a fixed retime past the successor is placed by its time and sweeps the legs it un-draws (13.1 AC7)", async () => {
    const user = await createUser("sweep-retime@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "15:00", "16:00");
    const c = await createItem(day.id, "C", "18:00", "19:00");
    const ab = await createLeg(day.id, item(a.id), item(b.id));
    const bc = await createLeg(day.id, item(b.id), item(c.id));

    // 13.1 AC7: Story 11.2 kept a retimed row at its index and pushed; a fixed row now takes its place by
    // its time. A at 16:00 goes after B, so neither A→B nor B→C is drawn any more.
    const result = await updateDayPlanItemForTripDay({
      ...baseMutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      fromTime: "16:00",
      toTime: "17:00",
      contentJson: sampleDoc("A"),
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.receipt.removedTravelSegments.map((leg) => leg.id).sort()).toEqual([ab.id, bc.id].sort());
    // B only renumbered (it is first now); fixed rows keep their times.
    expect(result.receipt.movedItems.map((moved) => [moved.itemId, moved.previousSortOrder, moved.fromTime])).toEqual([
      [b.id, 1, "15:00"],
    ]);
    expect(await prisma.travelSegment.count({ where: { tripDayId: day.id } })).toBe(0);
    const rows = await prisma.dayPlanItem.findMany({ where: { tripDayId: day.id }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((row) => `${row.title} ${row.fromTime}–${row.toTime}`)).toEqual([
      "B 15:00–16:00",
      "A 16:00–17:00",
      "C 18:00–19:00",
    ]);
  });

  /**
   * The API refuses an empty time on create and update (`dayPlanItemSchemas.ts`), so "clearing" a time
   * is not reachable through a write. What *is* reachable is the same order change from the other side:
   * an untimed activity (from an import or an older row) sorts last, and giving it a time moves it.
   */
  it("sweeps when an untimed activity gains a time and moves ahead of its neighbours", async () => {
    const user = await createUser("sweep-untimed@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const untimed = await createItem(day.id, "U", null, null);
    const leg = await createLeg(day.id, item(a.id), item(untimed.id));

    const result = await updateDayPlanItemForTripDay({
      ...baseMutation(user.id, trip.id, day.id),
      itemId: untimed.id,
      title: "U",
      fromTime: "07:00",
      toTime: "08:00",
      contentJson: sampleDoc("U"),
    });

    expect(await prisma.travelSegment.findUnique({ where: { id: leg.id } })).toBeNull();
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.receipt.removedTravelSegments).toEqual([leg]);
  });

  it("removes both legs referencing a deleted activity and reports every one of them", async () => {
    const user = await createUser("sweep-delete@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "12:00", "13:00");
    const c = await createItem(day.id, "C", "15:00", "16:00");
    const ab = await createLeg(day.id, item(a.id), item(b.id));
    const bc = await createLeg(day.id, item(b.id), item(c.id));

    const result = await deleteDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: b.id,
    });

    expect(await prisma.travelSegment.count({ where: { tripDayId: day.id } })).toBe(0);
    expect(result.status).toBe("deleted");
    if (result.status !== "deleted") return;
    expect([...result.removedTravelSegmentIds].sort()).toEqual([ab.id, bc.id].sort());
    // A union, deduplicated: each leg once even though it is both "referencing" and "no longer drawn".
    expect(result.receipt.removedTravelSegments).toHaveLength(2);
    expect(result.receipt.edited.kind).toBe("deleted");
  });

  it("sweeps legs to last night's stay and to tonight's stay when their pair breaks", async () => {
    const user = await createUser("sweep-stays@example.com");
    const { trip, firstDay, day } = await createTrip(user.id);
    const lastNight = await prisma.accommodation.create({
      data: { tripDayId: firstDay.id, name: "Last night", status: "BOOKED" },
    });
    const tonight = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Tonight", status: "BOOKED" },
    });
    const a = await createItem(day.id, "A", "12:00", "13:00");
    const fromStay = await createLeg(day.id, stay(lastNight.id), item(a.id));
    const toStay = await createLeg(day.id, item(a.id), stay(tonight.id));

    const early = await createDayPlanItemExpectingSuccess({
      ...baseMutation(user.id, trip.id, day.id),
      title: "Early",
      fromTime: "07:00",
      toTime: "08:00",
      contentJson: sampleDoc("Early"),
    });
    expect(await prisma.travelSegment.findUnique({ where: { id: fromStay.id } })).toBeNull();
    expect(early?.receipt.removedTravelSegments).toEqual([fromStay]);

    const late = await createDayPlanItemExpectingSuccess({
      ...baseMutation(user.id, trip.id, day.id),
      title: "Late",
      fromTime: "20:00",
      toTime: "21:00",
      contentJson: sampleDoc("Late"),
    });
    expect(await prisma.travelSegment.findUnique({ where: { id: toStay.id } })).toBeNull();
    expect(late?.receipt.removedTravelSegments).toEqual([toStay]);
  });

  it("leaves a pre-existing orphan alone during an unrelated edit to the same day", async () => {
    const user = await createUser("sweep-orphan@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "12:00", "13:00");
    const c = await createItem(day.id, "C", "15:00", "16:00");
    // A→C is not drawn: B sits between them. It was orphaned by something other than this edit.
    const orphan = await createLeg(day.id, item(a.id), item(c.id));

    const result = await updateDayPlanItemForTripDay({
      ...baseMutation(user.id, trip.id, day.id),
      itemId: b.id,
      title: "B renamed",
      fromTime: "12:30",
      toTime: "13:30",
      contentJson: sampleDoc("B renamed"),
    });

    expect(await prisma.travelSegment.findUnique({ where: { id: orphan.id } })).toEqual(orphan);
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.receipt.removedTravelSegments).toEqual([]);
  });

  it("sweeps nothing on a retime that keeps the order, and the receipt has no side effects", async () => {
    const user = await createUser("sweep-noop@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "15:00", "16:00");
    const leg = await createLeg(day.id, item(a.id), item(b.id));

    const result = await updateDayPlanItemForTripDay({
      ...baseMutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("A"),
    });

    expect(await prisma.travelSegment.findUnique({ where: { id: leg.id } })).toEqual(leg);
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.receipt.removedTravelSegments).toEqual([]);
    expect(receiptHasSideEffects(result.receipt)).toBe(false);
  });

  it("sweeps on a bucket-list conversion and carries the consumed bucket-list row", async () => {
    const user = await createUser("sweep-convert@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "15:00", "16:00");
    const leg = await createLeg(day.id, item(a.id), item(b.id));
    const idea = await prisma.tripBucketListItem.create({
      data: { tripId: trip.id, title: "Idea", description: "Worth it", positionText: "Old town" },
    });

    const result = await convertBucketListItemToDayPlanItemForTripDay({
      ...baseMutation(user.id, trip.id, day.id),
      bucketListItemId: idea.id,
      title: "Idea",
      fromTime: "12:00",
      toTime: "13:00",
      contentJson: sampleDoc("Idea"),
    });

    expect(await prisma.travelSegment.findUnique({ where: { id: leg.id } })).toBeNull();
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.receipt.removedTravelSegments).toEqual([leg]);
    expect(result.receipt.consumedBucketListItem).toEqual(idea);
    expect(result.receipt.edited).toMatchObject({ kind: "created", itemId: result.item.id });
  });
});
