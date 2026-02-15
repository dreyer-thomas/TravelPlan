import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
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
      contentJson: sampleDoc("Morning walk"),
      linkUrl: "https://example.com/plan",
      location: { lat: 48.1372, lng: 11.5756, label: "Museum" },
    });

    expect(item).not.toBeNull();
    expect(item?.tripDayId).toBe(day.id);
    expect(item?.contentJson).toContain("Morning walk");
    expect(item?.linkUrl).toBe("https://example.com/plan");
    expect(item?.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Museum" });
  });

  it("lists day plan items ordered by createdAt", async () => {
    const user = await createUser("plan-order@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: sampleDoc("Second"),
        linkUrl: null,
        createdAt: new Date("2026-11-05T10:00:00.000Z"),
      },
    });

    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: sampleDoc("First"),
        linkUrl: null,
        createdAt: new Date("2026-11-05T08:00:00.000Z"),
      },
    });

    const items = await listDayPlanItemsForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
    });

    expect(items).not.toBeNull();
    expect(items?.map((entry) => entry.contentJson)).toEqual([sampleDoc("First"), sampleDoc("Second")]);
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
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const updated = await updateDayPlanItemForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created.id,
      contentJson: sampleDoc("Updated"),
      linkUrl: "https://example.com/updated",
      location: { lat: 48.145, lng: 11.582, label: "Gallery" },
    });

    expect(updated.status).toBe("updated");
    if (updated.status === "updated") {
      expect(updated.item.contentJson).toContain("Updated");
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
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const updated = await updateDayPlanItemForTripDay({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      itemId: created.id,
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
