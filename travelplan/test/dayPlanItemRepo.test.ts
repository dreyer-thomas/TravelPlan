import { beforeEach, describe, expect, it } from "vitest";
import { createDayPlanItemExpectingSuccess } from "./helpers/createDayPlanItem";
import { prisma } from "@/lib/db/prisma";
import {
  scheduleParkedDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  moveDayPlanItemsBetweenTripDays,
  swapDayPlanItemsBetweenTripDays,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";

const createUser = async (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: "hashed",
      role: "OWNER",
    },
  });

const createTripWithDay = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Plan Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });

  const day = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-11-05T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  return { trip, day };
};

const createTripWithDays = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Plan Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-06T00:00:00.000Z"),
    },
  });

  const firstDay = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-11-05T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  const secondDay = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-11-06T00:00:00.000Z"),
      dayIndex: 2,
    },
  });

  return { trip, firstDay, secondDay };
};

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/**
 * Story 6.23 AC6. The same sum `TripDayView`'s `totalTravelMinutes` computes: **every** segment on
 * the day, with no check that the activities it points at still exist.
 *
 * That is exactly why an orphaned segment kept being counted as "Fahrzeit" — `segmentsByKey` only
 * looks up pairs the timeline draws, so the row was invisible, permanent and wrong. Reproducing the
 * formula here rather than counting rows is what makes the delete-path regression test say something
 * about the defect the story measured.
 */
const totalTravelMinutesForDay = async (tripDayId: string) => {
  const segments = await prisma.travelSegment.findMany({
    where: { tripDayId },
    select: { durationMinutes: true },
  });
  return segments.reduce((total, segment) => total + segment.durationMinutes, 0);
};

describe("dayPlanItemRepo", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates a day plan item for a trip day", async () => {
    const user = await createUser("plan-owner@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const item = await createDayPlanItemExpectingSuccess({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      title: "Morning walk",
      fromTime: "08:30",
      toTime: "09:30",
      contentJson: sampleDoc("Morning walk"),
      costCents: 1250,
      linkUrl: "https://example.com/plan",
      location: { lat: 48.1372, lng: 11.5756, label: "Museum" },
    });

    expect(item).not.toBeNull();
    expect(item?.item.tripDayId).toBe(day.id);
    expect(item?.item.title).toBe("Morning walk");
    expect(item?.item.fromTime).toBe("08:30");
    expect(item?.item.toTime).toBe("09:30");
    expect(item?.item.contentJson).toContain("Morning walk");
    expect(item?.item.costCents).toBe(1250);
    expect(item?.item.linkUrl).toBe("https://example.com/plan");
    expect(item?.item.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Museum" });
  });

  it("replaces payment rows when updating a day plan item", async () => {
    const user = await createUser("plan-payments@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const created = await createDayPlanItemExpectingSuccess({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      title: "Tickets",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("Tickets"),
      costCents: 3000,
      payments: [
        { amountCents: 1000, dueDate: "2026-11-01" },
        { amountCents: 2000, dueDate: "2026-11-02" },
      ],
      linkUrl: null,
      location: null,
    });

    expect(created?.item.payments).toHaveLength(2);
    const existingPayments = await prisma.costPayment.findMany({ where: { dayPlanItemId: created?.item.id } });
    expect(existingPayments).toHaveLength(2);

    const updated = await updateDayPlanItemForTripDay({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created!.item.id,
      title: "Tickets",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("Tickets"),
      costCents: 3000,
      payments: [{ amountCents: 3000, dueDate: "2026-11-03" }],
      linkUrl: null,
      location: null,
    });

    expect(updated.status).toBe("updated");
    const refreshedPayments = await prisma.costPayment.findMany({
      where: { dayPlanItemId: created?.item.id },
      orderBy: { dueDate: "asc" },
    });
    expect(refreshedPayments).toHaveLength(1);
    expect(refreshedPayments[0].amountCents).toBe(3000);
    expect(refreshedPayments[0].dueDate).toBe("2026-11-03");
  });

  it("preserves explicit payment row order when due dates are identical", async () => {
    const user = await createUser("plan-payment-order@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const created = await createDayPlanItemExpectingSuccess({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      title: "Tickets",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("Tickets"),
      costCents: 3000,
      payments: [
        { amountCents: 1000, dueDate: "2026-11-01" },
        { amountCents: 2000, dueDate: "2026-11-01" },
      ],
      linkUrl: null,
      location: null,
    });

    expect(created?.item.payments).toEqual([
      { amountCents: 1000, dueDate: "2026-11-01" },
      { amountCents: 2000, dueDate: "2026-11-01" },
    ]);

    const updated = await updateDayPlanItemForTripDay({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created!.item.id,
      title: "Tickets",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("Tickets"),
      costCents: 3000,
      payments: [
        { amountCents: 2000, dueDate: "2026-11-01" },
        { amountCents: 1000, dueDate: "2026-11-01" },
      ],
      linkUrl: null,
      location: null,
    });

    expect(updated.status).toBe("updated");
    if (updated.status === "updated") {
      expect(updated.item.payments).toEqual([
        { amountCents: 2000, dueDate: "2026-11-01" },
        { amountCents: 1000, dueDate: "2026-11-01" },
      ]);
    }
  });

  it("lists day plan items ordered by fromTime start", async () => {
    const user = await createUser("plan-order@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        title: "Late",
        fromTime: "10:00",
        toTime: "11:00",
        contentJson: sampleDoc("Late"),
        costCents: null,
        linkUrl: null,
        createdAt: new Date("2026-11-05T08:00:00.000Z"),
      },
    });

    await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        title: "Early",
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("Early"),
        costCents: 900,
        linkUrl: null,
        createdAt: new Date("2026-11-05T10:00:00.000Z"),
      },
    });

    const items = await listDayPlanItemsForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
    });

    expect(items).not.toBeNull();
    expect(items?.map((entry) => entry.title)).toEqual(["Early", "Late"]);
    expect(items?.map((entry) => entry.contentJson)).toEqual([sampleDoc("Early"), sampleDoc("Late")]);
    expect(items?.map((entry) => entry.costCents)).toEqual([900, null]);
  });

  it("rejects listing items for a non-owned trip day", async () => {
    const owner = await createUser("plan-owner-2@example.com");
    const other = await createUser("plan-other@example.com");
    const { trip, day } = await createTripWithDay(owner.id);

    const items = await listDayPlanItemsForTripDay({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
    });

    expect(items).toBeNull();
  });

  it("updates a day plan item for a trip day", async () => {
    const user = await createUser("plan-update@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const created = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const updated = await updateDayPlanItemForTripDay({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created.id,
      title: "Updated title",
      fromTime: "11:00",
      toTime: "12:00",
      contentJson: sampleDoc("Updated"),
      costCents: 4500,
      linkUrl: "https://example.com/updated",
      location: { lat: 48.145, lng: 11.582, label: "Gallery" },
    });

    expect(updated.status).toBe("updated");
    if (updated.status === "updated") {
      expect(updated.item.contentJson).toContain("Updated");
      expect(updated.item.title).toBe("Updated title");
      expect(updated.item.fromTime).toBe("11:00");
      expect(updated.item.toTime).toBe("12:00");
      expect(updated.item.costCents).toBe(4500);
      expect(updated.item.linkUrl).toBe("https://example.com/updated");
      expect(updated.item.location).toEqual({ lat: 48.145, lng: 11.582, label: "Gallery" });
    }
  });

  it("returns missing when updating an unknown item", async () => {
    const user = await createUser("plan-update-missing@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const updated = await updateDayPlanItemForTripDay({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: "missing-item",
      title: "Updated title",
      fromTime: "11:00",
      toTime: "12:00",
      contentJson: sampleDoc("Updated"),
      linkUrl: null,
    });

    expect(updated.status).toBe("missing");
  });

  it("returns not_found when updating a non-owned trip day", async () => {
    const owner = await createUser("plan-owner-3@example.com");
    const other = await createUser("plan-other-2@example.com");
    const { trip, day } = await createTripWithDay(owner.id);

    const created = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const updated = await updateDayPlanItemForTripDay({
      origin: "user",
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created.id,
      title: "Updated title",
      fromTime: "11:00",
      toTime: "12:00",
      contentJson: sampleDoc("Updated"),
      linkUrl: null,
    });

    expect(updated.status).toBe("not_found");
  });

  it("deletes a day plan item for a trip day", async () => {
    const user = await createUser("plan-delete@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const created = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("To delete"),
        linkUrl: null,
      },
    });

    const deleted = await deleteDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created.id,
    });

    expect(deleted.status).toBe("deleted");
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("schedules a parked activity onto the day: the same row, with its pictures, document and payments (Story 14.1 AC8)", async () => {
    const user = await createUser("plan-schedule@example.com");
    const { trip, day } = await createTripWithDay(user.id);
    const idea = await prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: null,
        scheduleMode: "FLEXIBLE",
        durationMinutes: 90,
        title: "Bucket stop",
        contentJson: sampleDoc("Bucket notes"),
        costCents: 3000,
        linkUrl: "https://example.com/stop",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Munich",
      },
    });
    const images = await Promise.all(
      [1, 2].map((sortOrder) =>
        prisma.dayPlanItemImage.create({
          data: { dayPlanItemId: idea.id, imageUrl: `/uploads/trips/${trip.id}/parked/day-plan-items/${idea.id}/${sortOrder}.webp`, sortOrder },
        }),
      ),
    );
    const document = await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: idea.id, documentUrl: `/uploads/trips/${trip.id}/parked/day-plan-items/${idea.id}/documents/t.pdf`, fileName: "t.pdf", sortOrder: 1 },
    });
    const payments = await Promise.all(
      [0, 1].map((sortOrder) =>
        prisma.costPayment.create({ data: { dayPlanItemId: idea.id, amountCents: 1500, dueDate: "2026-11-01", sortOrder } }),
      ),
    );

    const scheduled = await scheduleParkedDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: idea.id });

    expect(scheduled.status).toBe("scheduled");
    if (scheduled.status !== "scheduled") return;
    expect(scheduled.item).toMatchObject({
      id: idea.id,
      tripDayId: day.id,
      title: "Bucket stop",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 90,
      sortOrder: 0,
      fromTime: "09:00",
      toTime: "10:30",
      costCents: 3000,
      linkUrl: "https://example.com/stop",
      location: { lat: 48.1372, lng: 11.5756, label: "Munich" },
    });
    expect(scheduled.item.contentJson).toContain("Bucket notes");
    expect(await prisma.dayPlanItem.count()).toBe(1);
    expect((await prisma.dayPlanItemImage.findMany({ where: { dayPlanItemId: idea.id }, orderBy: { sortOrder: "asc" } })).map((row) => row.id)).toEqual(
      images.map((row) => row.id),
    );
    expect((await prisma.dayPlanItemDocument.findMany({ where: { dayPlanItemId: idea.id } })).map((row) => row.id)).toEqual([document.id]);
    expect((await prisma.costPayment.findMany({ where: { dayPlanItemId: idea.id }, orderBy: { sortOrder: "asc" } })).map((row) => row.id)).toEqual(
      payments.map((row) => row.id),
    );
  });

  it("refuses to schedule what is not a parked activity of this trip, and a viewer, writing nothing", async () => {
    const user = await createUser("plan-schedule-refused@example.com");
    const viewer = await createUser("plan-schedule-viewer@example.com");
    const { trip, day } = await createTripWithDay(user.id);
    const { trip: otherTrip } = await createTripWithDay(user.id);
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const planned = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Planned", fromTime: "09:00", toTime: "10:00", contentJson: sampleDoc("x") },
    });
    const foreign = await prisma.dayPlanItem.create({
      data: { tripId: otherTrip.id, tripDayId: null, scheduleMode: "FLEXIBLE", title: "Foreign", contentJson: sampleDoc("x") },
    });
    const idea = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: null, scheduleMode: "FLEXIBLE", title: "Idea", contentJson: sampleDoc("x") },
    });
    const before = await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } });

    for (const itemId of [planned.id, foreign.id, "unknown"]) {
      expect(await scheduleParkedDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId })).toEqual({
        status: "missing",
      });
    }
    expect(await scheduleParkedDayPlanItemForTripDay({ origin: "user", userId: viewer.id, tripId: trip.id, tripDayId: day.id, itemId: idea.id })).toEqual({
      status: "not_found",
    });
    expect(await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("returns missing when deleting an unknown item", async () => {
    const user = await createUser("plan-delete-missing@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const deleted = await deleteDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: "missing-item",
    });

    expect(deleted.status).toBe("missing");
  });

  it("rejects deletion for non-owned trip day", async () => {
    const owner = await createUser("plan-owner-4@example.com");
    const other = await createUser("plan-other-4@example.com");
    const { trip, day } = await createTripWithDay(owner.id);

    const created = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("To delete"),
        linkUrl: null,
      },
    });

    const deleted = await deleteDayPlanItemForTripDay({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created.id,
    });

    expect(deleted.status).toBe("not_found");
    expect(await prisma.dayPlanItem.count()).toBe(1);
  });

  it("moves all activities to another day, preserves identity, keeps accommodations, and clears affected segments", async () => {
    const user = await createUser("plan-move@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    const sourceAccommodation = await prisma.accommodation.create({
      data: {
        tripDayId: firstDay.id,
        name: "Source Stay",
        status: "PLANNED",
      },
    });
    const targetAccommodation = await prisma.accommodation.create({
      data: {
        tripDayId: secondDay.id,
        name: "Target Stay",
        status: "BOOKED",
      },
    });

    const sourceItemA = await prisma.dayPlanItem.create({
      data: {
        tripId: firstDay.tripId, tripDayId: firstDay.id,
        title: "Source A",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Source A"),
      },
    });
    const sourceItemB = await prisma.dayPlanItem.create({
      data: {
        tripId: firstDay.tripId, tripDayId: firstDay.id,
        title: "Source B",
        fromTime: "11:00",
        toTime: "12:00",
        contentJson: sampleDoc("Source B"),
      },
    });
    const targetItem = await prisma.dayPlanItem.create({
      data: {
        tripId: secondDay.tripId, tripDayId: secondDay.id,
        title: "Target Existing",
        fromTime: "14:00",
        toTime: "15:00",
        contentJson: sampleDoc("Target Existing"),
      },
    });

    await prisma.costPayment.create({
      data: {
        dayPlanItemId: sourceItemA.id,
        amountCents: 1500,
        dueDate: "2026-11-01",
        sortOrder: 0,
      },
    });
    await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: sourceItemA.id,
        imageUrl: "https://example.com/source-a.jpg",
        sortOrder: 1,
      },
    });
    await prisma.travelSegment.createMany({
      data: [
        {
          tripDayId: firstDay.id,
          fromItemType: "ACCOMMODATION",
          fromItemId: sourceAccommodation.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: sourceItemA.id,
          transportType: "CAR",
          durationMinutes: 15,
        },
        {
          tripDayId: secondDay.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: targetItem.id,
          toItemType: "ACCOMMODATION",
          toItemId: targetAccommodation.id,
          transportType: "CAR",
          durationMinutes: 20,
        },
      ],
    });

    const result = await moveDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      sourceTripDayId: firstDay.id,
      targetTripDayId: secondDay.id,
    });

    expect(result.status).toBe("moved");
    if (result.status !== "moved") return;

    expect(result.movedItemIds).toEqual([sourceItemA.id, sourceItemB.id]);
    expect(result.removedTargetItemIds).toEqual([targetItem.id]);

    const sourceDayItems = await prisma.dayPlanItem.findMany({ where: { tripDayId: firstDay.id } });
    const targetDayItems = await prisma.dayPlanItem.findMany({
      where: { tripDayId: secondDay.id },
      orderBy: { fromTime: "asc" },
    });
    expect(sourceDayItems).toHaveLength(0);
    expect(targetDayItems.map((item) => item.id)).toEqual([sourceItemA.id, sourceItemB.id]);

    expect(await prisma.dayPlanItem.findUnique({ where: { id: targetItem.id } })).toBeNull();
    expect(await prisma.accommodation.findUnique({ where: { id: sourceAccommodation.id } })).not.toBeNull();
    expect(await prisma.accommodation.findUnique({ where: { id: targetAccommodation.id } })).not.toBeNull();
    expect(await prisma.costPayment.count({ where: { dayPlanItemId: sourceItemA.id } })).toBe(1);
    expect(await prisma.dayPlanItemImage.count({ where: { dayPlanItemId: sourceItemA.id } })).toBe(1);
    expect(
      await prisma.travelSegment.count({
        where: { tripDayId: { in: [firstDay.id, secondDay.id] } },
      }),
    ).toBe(0);
  });

  it("swaps activity sets between two days and keeps accommodations untouched", async () => {
    const user = await createUser("plan-swap@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    await prisma.accommodation.create({
      data: {
        tripDayId: firstDay.id,
        name: "First Stay",
        status: "PLANNED",
      },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: secondDay.id,
        name: "Second Stay",
        status: "PLANNED",
      },
    });

    const firstItem = await prisma.dayPlanItem.create({
      data: {
        tripId: firstDay.tripId, tripDayId: firstDay.id,
        title: "First Item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("First Item"),
      },
    });
    const secondItem = await prisma.dayPlanItem.create({
      data: {
        tripId: secondDay.tripId, tripDayId: secondDay.id,
        title: "Second Item",
        fromTime: "13:00",
        toTime: "14:00",
        contentJson: sampleDoc("Second Item"),
      },
    });

    const result = await swapDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      firstTripDayId: firstDay.id,
      secondTripDayId: secondDay.id,
    });

    expect(result.status).toBe("swapped");
    if (result.status !== "swapped") return;

    expect(result.firstDayItemIds).toEqual([secondItem.id]);
    expect(result.secondDayItemIds).toEqual([firstItem.id]);

    const refreshedFirst = await prisma.dayPlanItem.findUnique({ where: { id: firstItem.id } });
    const refreshedSecond = await prisma.dayPlanItem.findUnique({ where: { id: secondItem.id } });
    expect(refreshedFirst?.tripDayId).toBe(secondDay.id);
    expect(refreshedSecond?.tripDayId).toBe(firstDay.id);
    expect(await prisma.accommodation.count()).toBe(2);
  });

  it("supports swapping with an empty day", async () => {
    const user = await createUser("plan-swap-empty@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    const firstItem = await prisma.dayPlanItem.create({
      data: {
        tripId: firstDay.tripId, tripDayId: firstDay.id,
        title: "Only Item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Only Item"),
      },
    });

    const result = await swapDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      firstTripDayId: firstDay.id,
      secondTripDayId: secondDay.id,
    });

    expect(result.status).toBe("swapped");
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: firstDay.id } })).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: secondDay.id } })).toBe(1);
    expect(await prisma.dayPlanItem.findUnique({ where: { id: firstItem.id } })).toMatchObject({ tripDayId: secondDay.id });
  });

  it("rejects same-day move and swap requests without mutating data", async () => {
    const user = await createUser("plan-same-day@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const item = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        title: "Original",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Original"),
      },
    });

    const moveResult = await moveDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      sourceTripDayId: day.id,
      targetTripDayId: day.id,
    });
    const swapResult = await swapDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      firstTripDayId: day.id,
      secondTripDayId: day.id,
    });

    expect(moveResult.status).toBe("validation_error");
    expect(swapResult.status).toBe("validation_error");
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).toMatchObject({ tripDayId: day.id });
  });

  it("rejects move and swap when the user lacks writer access", async () => {
    const owner = await createUser("plan-owner-transfer@example.com");
    const viewer = await createUser("plan-viewer-transfer@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(owner.id);

    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

    const moveResult = await moveDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: viewer.id,
      tripId: trip.id,
      sourceTripDayId: firstDay.id,
      targetTripDayId: secondDay.id,
    });
    const swapResult = await swapDayPlanItemsBetweenTripDays({
      origin: "user",
      userId: viewer.id,
      tripId: trip.id,
      firstTripDayId: firstDay.id,
      secondTripDayId: secondDay.id,
    });

    expect(moveResult.status).toBe("not_found");
    expect(swapResult.status).toBe("not_found");
  });

  /**
   * Story 6.23 AC6 — the defect this story fixes on the way past, reproduced as the story measured
   * it. Before the shared helper, deleting an activity left the segment pointing at it in place, and
   * `totalTravelMinutes` kept summing its 330 minutes forever with nothing on screen to remove.
   */
  it("removes the travel segments referencing a deleted activity so the day stops counting them", async () => {
    const user = await createUser("plan-delete-segments@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const doomed = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        title: "Doomed",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Doomed"),
      },
    });
    const survivor = await prisma.dayPlanItem.create({
      data: {
        tripId: day.tripId, tripDayId: day.id,
        title: "Survivor",
        fromTime: "18:00",
        toTime: "19:00",
        contentJson: sampleDoc("Survivor"),
      },
    });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Stay", status: "PLANNED" },
    });

    await prisma.travelSegment.createMany({
      data: [
        {
          tripDayId: day.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: doomed.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: survivor.id,
          transportType: "CAR",
          durationMinutes: 330,
        },
        {
          tripDayId: day.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: survivor.id,
          toItemType: "ACCOMMODATION",
          toItemId: stay.id,
          transportType: "CAR",
          durationMinutes: 20,
        },
      ],
    });

    expect(await totalTravelMinutesForDay(day.id)).toBe(350);

    const deleted = await deleteDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: doomed.id,
    });

    expect(deleted.status).toBe("deleted");
    if (deleted.status !== "deleted") return;
    expect(deleted.removedTravelSegmentIds).toHaveLength(1);

    // The orphan is gone, the unrelated segment is not, and "Fahrzeit" no longer counts 330 minutes
    // of travel to an activity that does not exist.
    expect(await prisma.travelSegment.count({ where: { tripDayId: day.id } })).toBe(1);
    expect(await totalTravelMinutesForDay(day.id)).toBe(20);
  });

  /**
   * Story 8.5 AC3 — **superseded by Story 11.1** (the epic's AC2 of 8.5; see
   * `sprint-change-proposal-2026-10-10.md`). This case used to pin that the neighbours' leg *survives* an
   * insertion and a retime and is listed as an orphan. 11.1 reverses that on the user's own report: the
   * orphan list turned every rearrangement into a round of manual deletions. The leg now leaves in the
   * write's own transaction, and what made 8.5 decline the deletion — mode, duration and distance are the
   * user's measurements — is answered by the receipt instead: it carries the row in full, and undo puts
   * it back byte for byte. Rewritten deliberately; this is the one sanctioned expectation change.
   *
   * Still true from 6.23: nothing is *fabricated*. The new neighbours are never joined.
   */
  it("removes the neighbours' leg when an activity is inserted between them, and undo brings it back identical", async () => {
    const user = await createUser("plan-insert-sweeps-segment@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const first = await prisma.dayPlanItem.create({
      data: { tripId: day.tripId, tripDayId: day.id, title: "A", fromTime: "09:00", toTime: "10:00", contentJson: sampleDoc("A") },
    });
    const second = await prisma.dayPlanItem.create({
      data: { tripId: day.tripId, tripDayId: day.id, title: "B", fromTime: "15:00", toTime: "16:00", contentJson: sampleDoc("B") },
    });

    const leg = await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: first.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: second.id,
        transportType: "CAR",
        durationMinutes: 40,
        distanceKm: 12,
      },
    });

    // The insertion, as a user reaches it: a new activity whose time falls between the two, created
    // last. There is no "insert at position" anywhere in this app — this is what insertion *is*.
    const created = await createDayPlanItemExpectingSuccess({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      title: "M",
      fromTime: "12:00",
      toTime: "13:00",
      contentJson: sampleDoc("M"),
      costCents: null,
      linkUrl: null,
    });
    expect(created).not.toBeNull();
    if (!created) return;

    // Gone, and nothing fabricated in its place: no A→M, no M→B.
    expect(await prisma.travelSegment.findMany({ where: { tripDayId: day.id } })).toEqual([]);
    // The receipt carries the row in full — mode, duration, distance and both stamps.
    expect(created.receipt.removedTravelSegments).toEqual([leg]);

    const undone = await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: created.receipt });
    expect(undone).toEqual({ status: "undone" });
    expect(await prisma.travelSegment.findMany({ where: { tripDayId: day.id } })).toEqual([leg]);
    expect(await prisma.dayPlanItem.findUnique({ where: { id: created.item.id } })).toBeNull();
  });
});
