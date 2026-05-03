import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  convertBucketListItemToDayPlanItemForTripDay,
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  moveDayPlanItemsBetweenTripDays,
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

describe("dayPlanItemRepo", () => {
  beforeEach(async () => {
    await prisma.tripBucketListItem.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
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
});
