import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createAccommodationForTripDay,
  deleteAccommodationForTripDay,
  updateAccommodationForTripDay,
} from "@/lib/repositories/accommodationRepo";

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
      name: "Stay Trip",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-01T00:00:00.000Z"),
    },
  });

  const day = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-10-01T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  return { trip, day };
};

describe("accommodationRepo", () => {
  beforeEach(async () => {
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates an accommodation for a trip day", async () => {
    const user = await createUser("stay-owner@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const accommodation = await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Harbor Inn",
      notes: "Near the docks",
    });

    expect(accommodation).not.toBeNull();
    expect(accommodation?.tripDayId).toBe(day.id);
    expect(accommodation?.name).toBe("Harbor Inn");
    expect(accommodation?.notes).toBe("Near the docks");
  });

  it("rejects accommodation creation for non-owned trip day", async () => {
    const owner = await createUser("stay-owner-2@example.com");
    const other = await createUser("stay-other@example.com");
    const { trip, day } = await createTripWithDay(owner.id);

    const accommodation = await createAccommodationForTripDay({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Hidden Spot",
      notes: null,
    });

    expect(accommodation).toBeNull();
  });

  it("updates an accommodation for a trip day", async () => {
    const user = await createUser("stay-update@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Initial Stay",
      notes: null,
    });

    const updated = await updateAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Updated Stay",
      notes: "Late check-in",
    });

    expect(updated.status).toBe("updated");
    if (updated.status === "updated") {
      expect(updated.accommodation.name).toBe("Updated Stay");
      expect(updated.accommodation.notes).toBe("Late check-in");
    }
  });

  it("returns missing when updating without an existing accommodation", async () => {
    const user = await createUser("stay-missing@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const updated = await updateAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Missing Stay",
      notes: null,
    });

    expect(updated.status).toBe("missing");
  });

  it("returns not_found when updating a non-owned trip day", async () => {
    const owner = await createUser("stay-owner-4@example.com");
    const other = await createUser("stay-other-4@example.com");
    const { trip, day } = await createTripWithDay(owner.id);

    const updated = await updateAccommodationForTripDay({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Unauthorized Stay",
      notes: null,
    });

    expect(updated.status).toBe("not_found");
  });

  it("deletes an accommodation for a trip day", async () => {
    const user = await createUser("stay-delete@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Delete Stay",
      notes: null,
    });

    const deleted = await deleteAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
    });

    expect(deleted).toBe(true);
    expect(await prisma.accommodation.count()).toBe(0);
  });

  it("rejects deletion for non-owned trip day", async () => {
    const owner = await createUser("stay-owner-3@example.com");
    const other = await createUser("stay-other-2@example.com");
    const { trip, day } = await createTripWithDay(owner.id);

    await createAccommodationForTripDay({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Owner Stay",
      notes: null,
    });

    const deleted = await deleteAccommodationForTripDay({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
    });

    expect(deleted).toBe(false);
    expect(await prisma.accommodation.count()).toBe(1);
  });
});
