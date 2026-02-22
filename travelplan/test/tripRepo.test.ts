import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createTripWithDays,
  deleteTripForUser,
  getTripExportForUser,
  getTripWithDaysForUser,
  importTripFromExportForUser,
  updateTripDayImageForUser,
  updateTripWithDays,
} from "@/lib/repositories/tripRepo";
import type { TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";

const VALID_RANGE = {
  startDate: "2026-04-01T00:00:00.000Z",
  endDate: "2026-04-02T00:00:00.000Z",
};

const IMPORT_PAYLOAD: TripImportPayloadInput = {
  meta: {
    exportedAt: "2026-02-14T12:00:00.000Z",
    appVersion: "0.1.0",
    formatVersion: 1,
  },
  trip: {
    id: "export-trip",
    name: "Imported Trip",
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2026-11-02T00:00:00.000Z",
    heroImageUrl: null,
    createdAt: "2026-02-14T12:00:00.000Z",
    updatedAt: "2026-02-14T12:00:00.000Z",
  },
  days: [
    {
      id: "export-day-2",
      date: "2026-11-02T00:00:00.000Z",
      dayIndex: 2,
      imageUrl: "/uploads/trips/export-trip/days/export-day-2/day.webp",
      note: "Arrival and city walk",
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: {
        id: "export-stay-2",
        name: "Dockside Hotel",
        notes: "Near station",
        status: "booked",
        costCents: 22300,
        link: "https://example.com/stay-2",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: { lat: 48.14, lng: 11.58, label: "Dockside" },
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
      },
      dayPlanItems: [
        {
          id: "export-plan-2",
          contentJson: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Museum\"}]}]}",
          costCents: 1800,
          linkUrl: "https://example.com/museum",
          location: { lat: 48.141, lng: 11.581, label: "Museum" },
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
        },
      ],
    },
    {
      id: "export-day-1",
      date: "2026-11-01T00:00:00.000Z",
      dayIndex: 1,
      imageUrl: null,
      note: null,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
    },
  ],
};

describe("tripRepo", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("does not create days when trip creation fails", async () => {
    await expect(
      createTripWithDays({
        userId: "missing-user",
        name: "Failing Trip",
        ...VALID_RANGE,
      })
    ).rejects.toBeDefined();

    const tripCount = await prisma.trip.count();
    const dayCount = await prisma.tripDay.count();

    expect(tripCount).toBe(0);
    expect(dayCount).toBe(0);
  });

  it("returns days in ascending dayIndex order", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-order@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Ordering Trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-04-02T00:00:00.000Z"), dayIndex: 2 },
        { tripId: trip.id, date: new Date("2026-04-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-03T00:00:00.000Z"), dayIndex: 3 },
      ],
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => day.dayIndex)).toEqual([1, 2, 3]);
  });

  it("orders days by dayIndex then date", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-tiebreaker@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Tie Break Trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-04-02T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-03T00:00:00.000Z"), dayIndex: 2 },
      ],
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => `${day.dayIndex}-${day.date.toISOString()}`)).toEqual([
      "1-2026-04-01T00:00:00.000Z",
      "1-2026-04-02T00:00:00.000Z",
      "2-2026-04-03T00:00:00.000Z",
    ]);
  });

  it("builds complete export payload with nested accommodation and day plans", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Export Trip",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });

    const [day1, day2] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });
    await prisma.tripDay.update({
      where: { id: day1.id },
      data: {
        imageUrl: "/uploads/trips/export-trip/days/day-1/day.webp",
        note: "Arrival and check-in",
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "Dockside Hotel",
        notes: "Near ferry terminal",
        status: "BOOKED",
        costCents: 22300,
        link: "https://example.com/stay",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        locationLat: 48.1401,
        locationLng: 11.5802,
        locationLabel: "Dockside",
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day1.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }] }),
        costCents: 1500,
        linkUrl: "https://example.com/plan-1",
        locationLat: 48.141,
        locationLng: 11.581,
        locationLabel: "Museum",
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Walk" }] }] }),
        costCents: null,
        linkUrl: null,
      },
    });

    const exported = await getTripExportForUser(user.id, trip.id);

    expect(exported).not.toBeNull();
    expect(exported?.trip.id).toBe(trip.id);
    expect(exported?.trip.name).toBe("Export Trip");
    expect(exported?.trip.startDate).toBe("2026-11-01T00:00:00.000Z");
    expect(exported?.trip.endDate).toBe("2026-11-02T00:00:00.000Z");
    expect(exported?.trip.createdAt).toMatch(/Z$/);
    expect(exported?.trip.updatedAt).toMatch(/Z$/);
    expect(exported?.days).toHaveLength(2);
    expect(exported?.days[0]).toEqual(
      expect.objectContaining({
        imageUrl: "/uploads/trips/export-trip/days/day-1/day.webp",
        note: "Arrival and check-in",
      })
    );
    expect(exported?.days[0].accommodation).toEqual(
      expect.objectContaining({
        name: "Dockside Hotel",
        status: "booked",
        costCents: 22300,
        link: "https://example.com/stay",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: { lat: 48.1401, lng: 11.5802, label: "Dockside" },
      })
    );
    expect(exported?.days[0].dayPlanItems[0]).toEqual(
      expect.objectContaining({
        costCents: 1500,
        linkUrl: "https://example.com/plan-1",
        location: { lat: 48.141, lng: 11.581, label: "Museum" },
      })
    );
    expect(exported?.days[1].accommodation).toBeNull();
    expect(exported?.days[1].dayPlanItems).toHaveLength(1);
    expect(exported?.days[1].dayPlanItems[0].location).toBeNull();
  });

  it("returns export days ordered by dayIndex then date", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-order@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Export Order Trip",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-12-02T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-12-03T00:00:00.000Z"), dayIndex: 2 },
      ],
    });

    const exported = await getTripExportForUser(user.id, trip.id);

    expect(exported).not.toBeNull();
    expect(exported?.days.map((day) => `${day.dayIndex}-${day.date}`)).toEqual([
      "1-2026-12-01T00:00:00.000Z",
      "1-2026-12-02T00:00:00.000Z",
      "2-2026-12-03T00:00:00.000Z",
    ]);
  });

  it("updates trip and adjusts day entries to match new date range", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-update@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Original Trip",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-03T00:00:00.000Z",
    });

    const updated = await updateTripWithDays({
      userId: user.id,
      tripId: trip.id,
      name: "Updated Trip",
      startDate: "2026-05-02T00:00:00.000Z",
      endDate: "2026-05-04T00:00:00.000Z",
    });

    expect(updated).not.toBeNull();
    expect(updated?.trip.name).toBe("Updated Trip");
    expect(updated?.dayCount).toBe(3);

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    expect(days.map((day) => day.date.toISOString())).toEqual([
      "2026-05-02T00:00:00.000Z",
      "2026-05-03T00:00:00.000Z",
      "2026-05-04T00:00:00.000Z",
    ]);
  });

  it("computes missing accommodation and plan flags per day", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-gaps@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Gap Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-04T00:00:00.000Z",
    });

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.accommodation.create({
      data: { tripDayId: days[0].id, name: "Lake Cabin", notes: "Bring snacks" },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[1].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Day 2" }] }] }),
        linkUrl: null,
      },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[2].id, name: "Forest Lodge" },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[2].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Day 3" }] }] }),
        linkUrl: "https://example.com/plan",
      },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[3].id, name: "   " },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => [day.missingAccommodation, day.missingPlan])).toEqual([
      [false, true],
      [true, false],
      [false, false],
      [true, true],
    ]);
    expect(detail?.days.map((day) => day.accommodation?.name ?? null)).toEqual([
      "Lake Cabin",
      null,
      "Forest Lodge",
      null,
    ]);
  });

  it("computes planned cost totals with null costs treated as zero", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-budget@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Budget Trip",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-03T00:00:00.000Z",
    });

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.accommodation.create({
      data: { tripDayId: days[0].id, name: "Night 1", costCents: 25000 },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[1].id, name: "Night 2", costCents: null },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[0].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }] }),
        costCents: 1300,
        linkUrl: null,
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[1].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Walk" }] }] }),
        costCents: null,
        linkUrl: null,
      },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.plannedCostTotal).toBe(26300);
    expect(detail?.accommodationCostTotalCents).toBe(25000);
    expect(detail?.days.map((day) => day.plannedCostSubtotal)).toEqual([26300, 0, 0]);
  });

  it("deletes trip and associated days for user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-delete@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Delete Trip",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-02T00:00:00.000Z",
    });

    const deleted = await deleteTripForUser(user.id, trip.id);
    expect(deleted).toBe(true);

    const tripCount = await prisma.trip.count({ where: { id: trip.id } });
    const dayCount = await prisma.tripDay.count({ where: { tripId: trip.id } });

    expect(tripCount).toBe(0);
    expect(dayCount).toBe(0);
  });

  it("persists hero image urls on trips", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-hero@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const heroImageUrl = "/uploads/trips/hero-trip/hero.jpg";

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Hero Trip",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
        heroImageUrl,
      },
    });

    const stored = await prisma.trip.findUnique({ where: { id: trip.id } });

    expect(stored?.heroImageUrl).toBe(heroImageUrl);
  });

  it("persists start and destination locations on trips", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-locations@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const startLocation = { lat: 48.14, lng: 11.58, label: "Munich" };
    const destinationLocation = { lat: 47.37, lng: 8.54, label: "Zurich" };

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Location Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-02T00:00:00.000Z",
      startLocation,
      destinationLocation,
    });

    const stored = await prisma.trip.findUnique({ where: { id: trip.id } });

    expect(stored?.startLocationLat).toBeCloseTo(startLocation.lat);
    expect(stored?.startLocationLng).toBeCloseTo(startLocation.lng);
    expect(stored?.startLocationLabel).toBe(startLocation.label);
    expect(stored?.destinationLocationLat).toBeCloseTo(destinationLocation.lat);
    expect(stored?.destinationLocationLng).toBeCloseTo(destinationLocation.lng);
    expect(stored?.destinationLocationLabel).toBe(destinationLocation.label);
  });

  it("persists image urls on trip days", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const imageUrl = "/uploads/trips/day/day-1.webp";

    await prisma.tripDay.update({
      where: { id: day.id },
      data: {
        imageUrl,
      },
    });

    const stored = await prisma.tripDay.findUnique({ where: { id: day.id } });
    expect(stored?.imageUrl).toBe(imageUrl);
  });

  it("returns day image urls in trip detail", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image-detail@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Detail Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: "/uploads/trips/day/day-detail.webp", note: "Flight from FRA to SIN" },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);
    expect(detail?.days[0].imageUrl).toBe("/uploads/trips/day/day-detail.webp");
    expect(detail?.days[0].note).toBe("Flight from FRA to SIN");
  });

  it("updates trip day image url with ownership constraints", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image-update@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Update Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const updated = await updateTripDayImageForUser({
      userId: user.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: "/uploads/trips/day/day-update.webp",
      note: "Flight from FRA to SIN",
    });

    expect(updated).not.toBeNull();
    expect(updated?.imageUrl).toBe("/uploads/trips/day/day-update.webp");
    expect(updated?.note).toBe("Flight from FRA to SIN");
  });

  it("removes trip day image url with ownership constraints", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image-remove@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Remove Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: "/uploads/trips/day/day-remove.webp", note: "Initial note" },
    });

    const removed = await updateTripDayImageForUser({
      userId: user.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: null,
      note: null,
    });

    expect(removed).not.toBeNull();
    expect(removed?.imageUrl).toBeNull();
    expect(removed?.note).toBeNull();
  });

  it("returns null when updating day image for non-owner", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-day-image-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "trip-day-image-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Day Image Guard Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const updated = await updateTripDayImageForUser({
      userId: other.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: "/uploads/trips/day/blocked.webp",
    });

    expect(updated).toBeNull();
  });

  it("returns conflict without writes when same-name trip exists and no strategy is set", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-conflict@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    await prisma.trip.create({
      data: {
        userId: user.id,
        name: IMPORT_PAYLOAD.trip.name,
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
    });

    expect(result.outcome).toBe("conflict");
    const trips = await prisma.trip.findMany({ where: { userId: user.id } });
    expect(trips).toHaveLength(1);
  });

  it("imports nested data in create-new mode with deterministic day ordering", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-create-new@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "createNew",
    });

    expect(result.outcome).toBe("imported");
    expect(result.mode).toBe("createNew");
    expect(result.dayCount).toBe(2);

    const detail = await getTripWithDaysForUser(user.id, result.trip.id);
    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => `${day.dayIndex}-${day.date.toISOString()}`)).toEqual([
      "1-2026-11-01T00:00:00.000Z",
      "2-2026-11-02T00:00:00.000Z",
    ]);
    expect(detail?.days[1].imageUrl).toBe("/uploads/trips/export-trip/days/export-day-2/day.webp");
    expect(detail?.days[1].note).toBe("Arrival and city walk");
    expect(detail?.days[1].accommodation?.status).toBe("booked");
    expect(detail?.days[1].accommodation?.checkInTime).toBe("16:00");
    expect(detail?.days[1].accommodation?.checkOutTime).toBe("10:00");
    expect(detail?.days[1].accommodation?.location).toEqual({
      lat: 48.14,
      lng: 11.58,
      label: "Dockside",
    });
    expect(detail?.days[1].dayPlanItems).toHaveLength(1);
    expect(detail?.days[1].dayPlanItems[0].costCents).toBe(1800);
  });

  it("overwrites target trip data atomically in overwrite mode", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-overwrite@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const target = await createTripWithDays({
      userId: user.id,
      name: IMPORT_PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });

    const targetDay = await prisma.tripDay.findFirstOrThrow({
      where: { tripId: target.trip.id, dayIndex: 1 },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: targetDay.id,
        name: "Old Accommodation",
        status: "PLANNED",
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });

    expect(result.outcome).toBe("imported");
    expect(result.mode).toBe("overwrite");
    expect(result.trip.id).toBe(target.trip.id);

    const detail = await getTripWithDaysForUser(user.id, target.trip.id);
    expect(detail?.name).toBe("Imported Trip");
    expect(detail?.days).toHaveLength(2);
    expect(detail?.days[1].accommodation?.name).toBe("Dockside Hotel");
  });

  it("rolls back imported records when transaction fails", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-rollback-mid-transaction@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const invalidPayload = {
      ...IMPORT_PAYLOAD,
      days: [
        IMPORT_PAYLOAD.days[0],
        {
          ...IMPORT_PAYLOAD.days[1],
          date: "not-a-date",
        },
      ],
    } as unknown as TripImportPayloadInput;

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: invalidPayload,
        strategy: "createNew",
      })
    ).rejects.toBeDefined();

    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.tripDay.count()).toBe(0);
    expect(await prisma.accommodation.count()).toBe(0);
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });
});
