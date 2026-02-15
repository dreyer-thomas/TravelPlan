import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createAccommodationImage,
  deleteAccommodationImage,
  listAccommodationImages,
  reorderAccommodationImages,
} from "@/lib/repositories/accommodationRepo";
import {
  createDayPlanItemImage,
  deleteDayPlanItemImage,
  listDayPlanItemImages,
  reorderDayPlanItemImages,
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
      name: "Gallery Repo Trip",
      startDate: new Date("2026-12-10T00:00:00.000Z"),
      endDate: new Date("2026-12-10T00:00:00.000Z"),
    },
  });

  const day = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-12-10T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  return { trip, day };
};

describe("image gallery repositories", () => {
  beforeEach(async () => {
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates/lists/reorders/deletes accommodation images with ownership scope", async () => {
    const owner = await createUser("gallery-repo-owner@example.com");
    const other = await createUser("gallery-repo-other@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const accommodation = await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Scoped Stay",
      },
    });

    const first = await createAccommodationImage({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      imageUrl: "/uploads/stay-1.webp",
    });
    const second = await createAccommodationImage({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      imageUrl: "/uploads/stay-2.webp",
    });

    expect(first).not.toBeNull();
    expect(first?.sortOrder).toBe(1);
    expect(second?.sortOrder).toBe(2);

    const unauthorizedCreate = await createAccommodationImage({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      imageUrl: "/uploads/nope.webp",
    });
    expect(unauthorizedCreate).toBeNull();

    const listed = await listAccommodationImages({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
    });
    expect(listed?.map((entry) => entry.imageUrl)).toEqual(["/uploads/stay-1.webp", "/uploads/stay-2.webp"]);

    const reorder = await reorderAccommodationImages({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      order: [
        { imageId: second!.id, sortOrder: 1 },
        { imageId: first!.id, sortOrder: 2 },
      ],
    });
    expect(reorder.status).toBe("reordered");

    const reordered = await listAccommodationImages({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
    });
    expect(reordered?.map((entry) => entry.imageUrl)).toEqual(["/uploads/stay-2.webp", "/uploads/stay-1.webp"]);

    const deleted = await deleteAccommodationImage({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      imageId: second!.id,
    });
    expect(deleted.status).toBe("deleted");
  });

  it("creates/lists/reorders/deletes day plan item images with ownership scope", async () => {
    const owner = await createUser("gallery-plan-repo-owner@example.com");
    const other = await createUser("gallery-plan-repo-other@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Gallery stop" }] }],
        }),
      },
    });

    const first = await createDayPlanItemImage({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      imageUrl: "/uploads/plan-1.webp",
    });
    const second = await createDayPlanItemImage({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      imageUrl: "/uploads/plan-2.webp",
    });

    expect(first?.sortOrder).toBe(1);
    expect(second?.sortOrder).toBe(2);

    const unauthorizedList = await listDayPlanItemImages({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
    });
    expect(unauthorizedList).toBeNull();

    const reorder = await reorderDayPlanItemImages({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      order: [
        { imageId: second!.id, sortOrder: 1 },
        { imageId: first!.id, sortOrder: 2 },
      ],
    });
    expect(reorder.status).toBe("reordered");

    const listed = await listDayPlanItemImages({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
    });
    expect(listed?.map((entry) => entry.imageUrl)).toEqual(["/uploads/plan-2.webp", "/uploads/plan-1.webp"]);

    const deleted = await deleteDayPlanItemImage({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      imageId: first!.id,
    });
    expect(deleted.status).toBe("deleted");
  });
});
