import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";

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
      name: "Gallery Trip",
      startDate: new Date("2026-11-15T00:00:00.000Z"),
      endDate: new Date("2026-11-15T00:00:00.000Z"),
    },
  });

  const day = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-11-15T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  return { trip, day };
};

describe("image gallery persistence", () => {
  beforeEach(async () => {
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("persists ordered accommodation images", async () => {
    const user = await createUser("gallery-accommodation@example.com");
    const { day } = await createTripWithDay(user.id);
    const accommodation = await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Harbor Hotel",
      },
    });

    await prisma.accommodationImage.createMany({
      data: [
        { accommodationId: accommodation.id, imageUrl: "/uploads/a3.webp", sortOrder: 3 },
        { accommodationId: accommodation.id, imageUrl: "/uploads/a1.webp", sortOrder: 1 },
        { accommodationId: accommodation.id, imageUrl: "/uploads/a2.webp", sortOrder: 2 },
      ],
    });

    const images = await prisma.accommodationImage.findMany({
      where: { accommodationId: accommodation.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    expect(images.map((image) => image.imageUrl)).toEqual([
      "/uploads/a1.webp",
      "/uploads/a2.webp",
      "/uploads/a3.webp",
    ]);
    expect(images.map((image) => image.sortOrder)).toEqual([1, 2, 3]);
  });

  it("persists ordered day plan item images", async () => {
    const user = await createUser("gallery-plan@example.com");
    const { day } = await createTripWithDay(user.id);
    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }],
        }),
      },
    });

    await prisma.dayPlanItemImage.createMany({
      data: [
        { dayPlanItemId: item.id, imageUrl: "/uploads/p2.webp", sortOrder: 2 },
        { dayPlanItemId: item.id, imageUrl: "/uploads/p1.webp", sortOrder: 1 },
      ],
    });

    const images = await prisma.dayPlanItemImage.findMany({
      where: { dayPlanItemId: item.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    expect(images.map((image) => image.imageUrl)).toEqual(["/uploads/p1.webp", "/uploads/p2.webp"]);
    expect(images.map((image) => image.sortOrder)).toEqual([1, 2]);
  });
});
