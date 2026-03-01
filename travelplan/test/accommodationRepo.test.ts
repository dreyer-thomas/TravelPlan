import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createAccommodationForTripDay,
  copyAccommodationFromPreviousNight,
  deleteAccommodationForTripDay,
  getAccommodationCostTotalForTrip,
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

const createTripWithTwoDays = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Stay Trip",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-02T00:00:00.000Z"),
    },
  });

  const previousDay = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-10-01T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  const currentDay = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-10-02T00:00:00.000Z"),
      dayIndex: 2,
    },
  });

  return { trip, previousDay, currentDay };
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
      status: "booked",
      costCents: 24500,
      link: "https://example.com/harbor-inn",
      notes: "Near the docks",
      checkInTime: "16:00",
      checkOutTime: "10:00",
      location: { lat: 48.1351, lng: 11.582, label: "City Center" },
    });

    expect(accommodation).not.toBeNull();
    expect(accommodation?.tripDayId).toBe(day.id);
    expect(accommodation?.name).toBe("Harbor Inn");
    expect(accommodation?.notes).toBe("Near the docks");
    expect(accommodation?.status).toBe("booked");
    expect(accommodation?.costCents).toBe(24500);
    expect(accommodation?.link).toBe("https://example.com/harbor-inn");
    expect(accommodation?.checkInTime).toBe("16:00");
    expect(accommodation?.checkOutTime).toBe("10:00");
    expect(accommodation?.location).toEqual({ lat: 48.1351, lng: 11.582, label: "City Center" });
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
      status: "planned",
      costCents: null,
      link: null,
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
      status: "planned",
      costCents: null,
      link: null,
      notes: null,
    });

    const updated = await updateAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Updated Stay",
      status: "booked",
      costCents: 12000,
      link: "https://example.com/updated",
      notes: "Late check-in",
      checkInTime: "15:30",
      checkOutTime: "09:15",
      location: { lat: 48.1372, lng: 11.5756, label: "Altstadt" },
    });

    expect(updated.status).toBe("updated");
    if (updated.status === "updated") {
      expect(updated.accommodation.name).toBe("Updated Stay");
      expect(updated.accommodation.notes).toBe("Late check-in");
      expect(updated.accommodation.status).toBe("booked");
      expect(updated.accommodation.costCents).toBe(12000);
      expect(updated.accommodation.link).toBe("https://example.com/updated");
      expect(updated.accommodation.checkInTime).toBe("15:30");
      expect(updated.accommodation.checkOutTime).toBe("09:15");
      expect(updated.accommodation.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Altstadt" });
    }
  });

  it("allows accommodations without check-in or check-out times", async () => {
    const user = await createUser("stay-null-times@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const accommodation = await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Flexible Stay",
      status: "planned",
      costCents: null,
      link: null,
      notes: null,
    });

    expect(accommodation?.checkInTime).toBeNull();
    expect(accommodation?.checkOutTime).toBeNull();
  });

  it("returns missing when updating without an existing accommodation", async () => {
    const user = await createUser("stay-missing@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const updated = await updateAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Missing Stay",
      status: "planned",
      costCents: null,
      link: null,
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
      status: "planned",
      costCents: null,
      link: null,
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
      status: "planned",
      costCents: null,
      link: null,
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
      status: "planned",
      costCents: null,
      link: null,
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

  it("computes total accommodation cost for a trip", async () => {
    const user = await createUser("stay-total@example.com");
    const { trip, day } = await createTripWithDay(user.id);

    const secondDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-10-02T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      name: "Budget Stay",
      status: "planned",
      costCents: 4500,
      link: null,
      notes: null,
    });

    await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: secondDay.id,
      name: "Luxury Stay",
      status: "booked",
      costCents: 15500,
      link: null,
      notes: null,
    });

    const total = await getAccommodationCostTotalForTrip(user.id, trip.id);

    expect(total).toBe(20000);
  });

  it("copies the previous-night accommodation onto the current day", async () => {
    const user = await createUser("stay-copy@example.com");
    const { trip, previousDay, currentDay } = await createTripWithTwoDays(user.id);

    await prisma.accommodation.create({
      data: {
        tripDayId: previousDay.id,
        name: "Harbor Inn",
        status: "BOOKED",
        costCents: 28000,
        link: "https://example.com/harbor",
        notes: "Ocean view",
        checkInTime: "15:00",
        checkOutTime: "11:00",
        locationLat: 48.1351,
        locationLng: 11.582,
        locationLabel: "City Center",
      },
    });

    const result = await copyAccommodationFromPreviousNight({
      userId: user.id,
      tripId: trip.id,
      tripDayId: currentDay.id,
    });

    expect(result.status).toBe("copied");
    if (result.status === "copied") {
      expect(result.accommodation.tripDayId).toBe(currentDay.id);
      expect(result.accommodation.name).toBe("Harbor Inn");
      expect(result.accommodation.status).toBe("booked");
      expect(result.accommodation.costCents).toBeNull();
      expect(result.accommodation.link).toBe("https://example.com/harbor");
      expect(result.accommodation.notes).toBe("Ocean view");
      expect(result.accommodation.checkInTime).toBe("15:00");
      expect(result.accommodation.checkOutTime).toBe("11:00");
      expect(result.accommodation.location).toEqual({ lat: 48.1351, lng: 11.582, label: "City Center" });
    }
  });

  it("overwrites an existing current-night accommodation when copying", async () => {
    const user = await createUser("stay-copy-overwrite@example.com");
    const { trip, previousDay, currentDay } = await createTripWithTwoDays(user.id);

    await prisma.accommodation.create({
      data: {
        tripDayId: previousDay.id,
        name: "Previous Stay",
        status: "PLANNED",
        costCents: null,
        link: null,
        notes: null,
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: currentDay.id,
        name: "Current Stay",
        status: "BOOKED",
        costCents: 12000,
        link: "https://example.com/current",
        notes: "Existing",
      },
    });

    const result = await copyAccommodationFromPreviousNight({
      userId: user.id,
      tripId: trip.id,
      tripDayId: currentDay.id,
    });

    expect(result.status).toBe("copied");
    if (result.status === "copied") {
      expect(result.accommodation.name).toBe("Previous Stay");
      expect(result.accommodation.status).toBe("planned");
    }
  });

  it("copies from a previous-day index of zero", async () => {
    const user = await createUser("stay-copy-zero@example.com");
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Stay Trip",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });

    const previousDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-09-30T00:00:00.000Z"),
        dayIndex: 0,
      },
    });

    const currentDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-10-01T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: previousDay.id,
        name: "Zero Stay",
        status: "PLANNED",
        costCents: 9000,
      },
    });

    const result = await copyAccommodationFromPreviousNight({
      userId: user.id,
      tripId: trip.id,
      tripDayId: currentDay.id,
    });

    expect(result.status).toBe("copied");
    if (result.status === "copied") {
      expect(result.accommodation.tripDayId).toBe(currentDay.id);
      expect(result.accommodation.name).toBe("Zero Stay");
      expect(result.accommodation.costCents).toBeNull();
    }
  });

  it("returns missing when no previous-night accommodation exists", async () => {
    const user = await createUser("stay-copy-missing@example.com");
    const { trip, currentDay } = await createTripWithTwoDays(user.id);

    const result = await copyAccommodationFromPreviousNight({
      userId: user.id,
      tripId: trip.id,
      tripDayId: currentDay.id,
    });

    expect(result.status).toBe("missing");
  });

  it("returns not_found when copying a non-owned trip day", async () => {
    const owner = await createUser("stay-copy-owner@example.com");
    const other = await createUser("stay-copy-other@example.com");
    const { trip, currentDay } = await createTripWithTwoDays(owner.id);

    const result = await copyAccommodationFromPreviousNight({
      userId: other.id,
      tripId: trip.id,
      tripDayId: currentDay.id,
    });

    expect(result.status).toBe("not_found");
  });
});
