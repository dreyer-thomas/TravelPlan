import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  convertBucketListItemToDayPlanItemForTripDay,
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
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

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("dayPlanItemRepo", () => {
  beforeEach(async () => {
    await prisma.tripBucketListItem.deleteMany();
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
});
