import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  convertBucketListItemToDayPlanItemForTripDay,
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  moveDayPlanItemsBetweenTripDays,
  moveDayPlanItemToTripDay,
  swapDayPlanItemsBetweenTripDays,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";

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
    await prisma.tripBucketListItem.deleteMany();
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

    const item = await createDayPlanItemForTripDay({
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
    expect(item?.tripDayId).toBe(day.id);
    expect(item?.title).toBe("Morning walk");
    expect(item?.fromTime).toBe("08:30");
    expect(item?.toTime).toBe("09:30");
    expect(item?.contentJson).toContain("Morning walk");
    expect(item?.costCents).toBe(1250);
    expect(item?.linkUrl).toBe("https://example.com/plan");
    expect(item?.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Museum" });
  });

  it("replaces payment rows when updating a day plan item", async () => {
    const user = await createUser("plan-payments@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const created = await createDayPlanItemForTripDay({
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

    expect(created?.payments).toHaveLength(2);
    const existingPayments = await prisma.costPayment.findMany({ where: { dayPlanItemId: created?.id } });
    expect(existingPayments).toHaveLength(2);

    const updated = await updateDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created!.id,
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
      where: { dayPlanItemId: created?.id },
      orderBy: { dueDate: "asc" },
    });
    expect(refreshedPayments).toHaveLength(1);
    expect(refreshedPayments[0].amountCents).toBe(3000);
    expect(refreshedPayments[0].dueDate).toBe("2026-11-03");
  });

  it("preserves explicit payment row order when due dates are identical", async () => {
    const user = await createUser("plan-payment-order@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const created = await createDayPlanItemForTripDay({
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

    expect(created?.payments).toEqual([
      { amountCents: 1000, dueDate: "2026-11-01" },
      { amountCents: 2000, dueDate: "2026-11-01" },
    ]);

    const updated = await updateDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created!.id,
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
        tripDayId: day.id,
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
        tripDayId: day.id,
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
        tripDayId: day.id,
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const updated = await updateDayPlanItemForTripDay({
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
        tripDayId: day.id,
        fromTime: "08:00",
        toTime: "09:00",
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const updated = await updateDayPlanItemForTripDay({
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
        tripDayId: day.id,
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

  it("converts a bucket list item into a day plan item and deletes the bucket list item", async () => {
    const user = await createUser("plan-convert@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const bucketItem = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Bucket stop",
        description: "Bucket notes",
        positionText: "Central Station",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Munich",
      },
    });

    const converted = await convertBucketListItemToDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      bucketListItemId: bucketItem.id,
      title: "Bucket stop",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("Bucket notes"),
      costCents: null,
      linkUrl: null,
      location: { lat: 48.1372, lng: 11.5756, label: "Munich" },
    });

    expect(converted.status).toBe("created");
    if (converted.status === "created") {
      expect(converted.item.tripDayId).toBe(day.id);
      expect(converted.item.title).toBe("Bucket stop");
      expect(converted.item.contentJson).toContain("Bucket notes");
      expect(converted.item.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Munich" });
    }

    expect(await prisma.tripBucketListItem.count()).toBe(0);
    expect(await prisma.dayPlanItem.count()).toBe(1);
  });

  it("keeps the bucket list item when conversion fails", async () => {
    const user = await createUser("plan-convert-fail@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const bucketItem = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Bucket stop",
      },
    });

    await expect(
      convertBucketListItemToDayPlanItemForTripDay({
        userId: user.id,
        tripId: trip.id,
        tripDayId: day.id,
        bucketListItemId: bucketItem.id,
        title: "Bucket stop",
        fromTime: "10:00",
        toTime: "11:00",
        // @ts-expect-error intentional invalid payload to force a DB error
        contentJson: null,
        costCents: null,
        linkUrl: null,
      }),
    ).rejects.toThrow();

    expect(await prisma.tripBucketListItem.count()).toBe(1);
    expect(await prisma.dayPlanItem.count()).toBe(0);
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
        tripDayId: day.id,
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
        tripDayId: firstDay.id,
        title: "Source A",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Source A"),
      },
    });
    const sourceItemB = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Source B",
        fromTime: "11:00",
        toTime: "12:00",
        contentJson: sampleDoc("Source B"),
      },
    });
    const targetItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: secondDay.id,
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
        tripDayId: firstDay.id,
        title: "First Item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("First Item"),
      },
    });
    const secondItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: secondDay.id,
        title: "Second Item",
        fromTime: "13:00",
        toTime: "14:00",
        contentJson: sampleDoc("Second Item"),
      },
    });

    const result = await swapDayPlanItemsBetweenTripDays({
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
        tripDayId: firstDay.id,
        title: "Only Item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Only Item"),
      },
    });

    const result = await swapDayPlanItemsBetweenTripDays({
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
        tripDayId: day.id,
        title: "Original",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Original"),
      },
    });

    const moveResult = await moveDayPlanItemsBetweenTripDays({
      userId: user.id,
      tripId: trip.id,
      sourceTripDayId: day.id,
      targetTripDayId: day.id,
    });
    const swapResult = await swapDayPlanItemsBetweenTripDays({
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
      userId: viewer.id,
      tripId: trip.id,
      sourceTripDayId: firstDay.id,
      targetTripDayId: secondDay.id,
    });
    const swapResult = await swapDayPlanItemsBetweenTripDays({
      userId: viewer.id,
      tripId: trip.id,
      firstTripDayId: firstDay.id,
      secondTripDayId: secondDay.id,
    });

    expect(moveResult.status).toBe("not_found");
    expect(swapResult.status).toBe("not_found");
  });

  /**
   * Story 6.23 AC2 and AC3 — and the assertion that catches the one shortcut that would destroy
   * data. `moveDayPlanItemsBetweenTripDays` deletes the target day's activities before reassigning
   * the source day's; if this function is ever "simplified" into a call to that one, `Target
   * Existing` disappears and this test is what says so.
   */
  it("appends a single activity to the target day and carries its images and payments", async () => {
    const user = await createUser("plan-single-move@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    const moved = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Moved",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Moved"),
        costCents: 4200,
        linkUrl: "https://example.com/moved",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Museum",
      },
    });
    const stayingBehind = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Staying Behind",
        fromTime: "16:00",
        toTime: "17:00",
        contentJson: sampleDoc("Staying Behind"),
      },
    });
    const targetExisting = await prisma.dayPlanItem.create({
      data: {
        tripDayId: secondDay.id,
        title: "Target Existing",
        fromTime: "14:00",
        toTime: "15:00",
        contentJson: sampleDoc("Target Existing"),
      },
    });

    await prisma.costPayment.createMany({
      data: [
        { dayPlanItemId: moved.id, amountCents: 2000, dueDate: "2026-11-01", sortOrder: 0 },
        { dayPlanItemId: moved.id, amountCents: 2200, dueDate: "2026-11-02", sortOrder: 1 },
      ],
    });
    await prisma.dayPlanItemImage.createMany({
      data: [
        { dayPlanItemId: moved.id, imageUrl: "https://example.com/one.jpg", sortOrder: 1 },
        { dayPlanItemId: moved.id, imageUrl: "https://example.com/two.jpg", sortOrder: 2 },
      ],
    });

    const result = await moveDayPlanItemToTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: firstDay.id,
      itemId: moved.id,
      targetTripDayId: secondDay.id,
    });

    expect(result.status).toBe("moved");
    if (result.status !== "moved") return;
    expect(result.itemId).toBe(moved.id);
    expect(result.targetTripDayId).toBe(secondDay.id);
    expect(result.removedTravelSegmentIds).toEqual([]);

    // AC2: the target day gained one activity and lost none.
    const targetItems = await prisma.dayPlanItem.findMany({ where: { tripDayId: secondDay.id } });
    expect(targetItems.map((item) => item.id).sort()).toEqual([moved.id, targetExisting.id].sort());
    expect(await prisma.dayPlanItem.findUnique({ where: { id: targetExisting.id } })).not.toBeNull();
    // And the source day kept everything that was not moved.
    const sourceItems = await prisma.dayPlanItem.findMany({ where: { tripDayId: firstDay.id } });
    expect(sourceItems.map((item) => item.id)).toEqual([stayingBehind.id]);

    // AC3: images and payments reference the *item*, so a single `update` of `tripDayId` carries
    // them. Asserted rather than assumed — it is the whole reason the story exists.
    const carried = await prisma.dayPlanItem.findUnique({
      where: { id: moved.id },
      include: {
        payments: { orderBy: { sortOrder: "asc" } },
        images: { orderBy: { sortOrder: "asc" } },
      },
    });
    expect(carried?.tripDayId).toBe(secondDay.id);
    expect(carried?.title).toBe("Moved");
    expect(carried?.fromTime).toBe("09:00");
    expect(carried?.toTime).toBe("10:00");
    expect(carried?.costCents).toBe(4200);
    expect(carried?.linkUrl).toBe("https://example.com/moved");
    expect(carried?.locationLat).toBe(48.1372);
    expect(carried?.locationLabel).toBe("Museum");
    expect(carried?.payments.map((payment) => payment.amountCents)).toEqual([2000, 2200]);
    expect(carried?.images.map((image) => image.imageUrl)).toEqual([
      "https://example.com/one.jpg",
      "https://example.com/two.jpg",
    ]);

    // AC7: `DayPlanItem` has no `sortOrder` column — every reader orders by `fromTime`, so a 09:00
    // activity lands among the morning entries of its new day with no write at all.
    const listed = await listDayPlanItemsForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: secondDay.id,
    });
    expect(listed?.map((entry) => entry.title)).toEqual(["Moved", "Target Existing"]);
  });

  /**
   * AC7's second half: "an activity with no time must still get a defined position". A legacy item
   * with no `fromTime` sorts after every timed one, by `createdAt` then `id` — a total order, so its
   * position is defined rather than incidental.
   */
  it("gives a moved activity without a start time a defined position on the target day", async () => {
    const user = await createUser("plan-single-move-untimed@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    const untimed = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Untimed",
        contentJson: sampleDoc("Untimed"),
        createdAt: new Date("2026-11-05T06:00:00.000Z"),
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: secondDay.id,
        title: "Afternoon",
        fromTime: "14:00",
        toTime: "15:00",
        contentJson: sampleDoc("Afternoon"),
        createdAt: new Date("2026-11-05T07:00:00.000Z"),
      },
    });

    const result = await moveDayPlanItemToTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: firstDay.id,
      itemId: untimed.id,
      targetTripDayId: secondDay.id,
    });

    expect(result.status).toBe("moved");
    const listed = await listDayPlanItemsForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: secondDay.id,
    });
    expect(listed?.map((entry) => entry.title)).toEqual(["Afternoon", "Untimed"]);
  });

  /**
   * AC4 and AC5. Segments have no foreign key to the activity, so the ones pointing at it have to go
   * by hand — and the ones that do not point at it must survive, or a move would quietly wipe the
   * rest of the day's travel times.
   */
  it("removes only the travel segments that reference the moved activity and invents none", async () => {
    const user = await createUser("plan-single-move-segments@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    const stay = await prisma.accommodation.create({
      data: { tripDayId: firstDay.id, name: "Source Stay", status: "PLANNED" },
    });
    const moved = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Middle",
        fromTime: "11:00",
        toTime: "12:00",
        contentJson: sampleDoc("Middle"),
      },
    });
    const neighbour = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Neighbour",
        fromTime: "14:00",
        toTime: "15:00",
        contentJson: sampleDoc("Neighbour"),
      },
    });

    await prisma.travelSegment.createMany({
      data: [
        {
          tripDayId: firstDay.id,
          fromItemType: "ACCOMMODATION",
          fromItemId: stay.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: moved.id,
          transportType: "CAR",
          durationMinutes: 25,
        },
        {
          tripDayId: firstDay.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: moved.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: neighbour.id,
          transportType: "WALKING",
          durationMinutes: 15,
        },
        {
          tripDayId: firstDay.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: neighbour.id,
          toItemType: "ACCOMMODATION",
          toItemId: stay.id,
          transportType: "CAR",
          durationMinutes: 30,
        },
      ],
    });

    const result = await moveDayPlanItemToTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: firstDay.id,
      itemId: moved.id,
      targetTripDayId: secondDay.id,
    });

    expect(result.status).toBe("moved");
    if (result.status !== "moved") return;
    expect(result.removedTravelSegmentIds).toHaveLength(2);

    const surviving = await prisma.travelSegment.findMany({ where: { tripDayId: firstDay.id } });
    expect(surviving).toHaveLength(1);
    expect(surviving[0]).toMatchObject({ fromItemId: neighbour.id, toItemId: stay.id });
    // The source day's "Fahrzeit" now counts only the segment that is still real.
    expect(await totalTravelMinutesForDay(firstDay.id)).toBe(30);

    // AC5: nothing is invented on the target day, and the two former neighbours are not joined into
    // a fabricated segment on the source day either.
    expect(await prisma.travelSegment.count({ where: { tripDayId: secondDay.id } })).toBe(0);
    expect(await totalTravelMinutesForDay(secondDay.id)).toBe(0);
  });

  it("rejects moving a single activity to the day it is already on", async () => {
    const user = await createUser("plan-single-move-same-day@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        title: "Original",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Original"),
      },
    });

    const result = await moveDayPlanItemToTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: item.id,
      targetTripDayId: day.id,
    });

    expect(result.status).toBe("validation_error");
    if (result.status === "validation_error") {
      expect(result.code).toBe("same_day");
    }
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).toMatchObject({ tripDayId: day.id });
  });

  it("returns missing when the single-activity move names an item that is not on the source day", async () => {
    const user = await createUser("plan-single-move-missing@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(user.id);

    const elsewhere = await prisma.dayPlanItem.create({
      data: {
        tripDayId: secondDay.id,
        title: "Elsewhere",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Elsewhere"),
      },
    });

    const unknown = await moveDayPlanItemToTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: firstDay.id,
      itemId: "missing-item",
      targetTripDayId: secondDay.id,
    });
    const wrongDay = await moveDayPlanItemToTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: firstDay.id,
      itemId: elsewhere.id,
      targetTripDayId: secondDay.id,
    });

    expect(unknown.status).toBe("missing");
    expect(wrongDay.status).toBe("missing");
    // And it stayed where it was. The write is `updateMany` scoped by `[id, tripDayId]`, not an
    // `update` by id after a separate check — otherwise a caller naming the wrong source day (a
    // second tab that moved the activity a moment ago) would drag it out of the day it is actually
    // on, and the segment sweep would then be pointed at the wrong two days.
    const unmoved = await prisma.dayPlanItem.findUnique({ where: { id: elsewhere.id } });
    expect(unmoved?.tripDayId).toBe(secondDay.id);
  });

  /** AC8, at the layer the route's guard delegates to. */
  it("rejects the single-activity move when the user lacks writer access", async () => {
    const owner = await createUser("plan-single-move-owner@example.com");
    const viewer = await createUser("plan-single-move-viewer@example.com");
    const { trip, firstDay, secondDay } = await createTripWithDays(owner.id);

    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });
    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: firstDay.id,
        title: "Owned",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Owned"),
      },
    });

    const result = await moveDayPlanItemToTripDay({
      userId: viewer.id,
      tripId: trip.id,
      tripDayId: firstDay.id,
      itemId: item.id,
      targetTripDayId: secondDay.id,
    });

    expect(result.status).toBe("not_found");
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).toMatchObject({
      tripDayId: firstDay.id,
    });
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
        tripDayId: day.id,
        title: "Doomed",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Doomed"),
      },
    });
    const survivor = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
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
});
