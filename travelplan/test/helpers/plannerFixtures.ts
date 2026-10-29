import { prisma } from "@/lib/db/prisma";
import { recomputeDayInTransaction } from "@/lib/repositories/dayScheduleTransaction";

/**
 * Story 15.2. One trip seeded for the connector's read tools: three days, the middle one carrying every
 * case `get_day` has to answer. Last night's stay checks out at 11:00; a walk leg from it to a 180-minute
 * flexible museum (11:15-14:15), a 30-minute drive to a dinner fixed at 13:30 (late by 75 minutes), then a
 * 600-minute flexible walk that does not fit (overflow). Tonight's stay is booked, priced in CZK with two
 * instalments, and has a document and an image. The flexible times are the schedule's, written by
 * `recomputeDayInTransaction`, not by hand. Two parked activities sit in the bucket list.
 */

export const plannerDoc = (...paragraphs: string[]) =>
  JSON.stringify({
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });

export const seedPlannerTrip = async (ownerId: string, name = "Prague") => {
  const trip = await prisma.trip.create({
    data: {
      userId: ownerId,
      name,
      startDate: new Date("2027-05-01T00:00:00.000Z"),
      endDate: new Date("2027-05-03T00:00:00.000Z"),
    },
  });
  const day = (dayIndex: number) =>
    prisma.tripDay.create({
      data: { tripId: trip.id, dayIndex, date: new Date(`2027-05-0${dayIndex}T00:00:00.000Z`) },
    });
  const day1 = await day(1);
  const day2 = await day(2);
  const day3 = await day(3);

  const previousStay = await prisma.accommodation.create({
    data: { tripDayId: day1.id, name: "Hotel Arrival", checkOutTime: "11:00" },
  });

  const stay = await prisma.accommodation.create({
    data: {
      tripDayId: day2.id,
      name: "Hotel Old Town",
      status: "BOOKED",
      checkInTime: "15:00",
      checkOutTime: "10:30",
      link: "https://hotel.example/booking",
      notes: "Late arrival announced",
      locationLat: 50.087,
      locationLng: 14.421,
      locationLabel: "Old Town Square",
      costCents: 20000,
      costOriginalAmount: 500000,
      costCurrency: "CZK",
      costRate: 25,
      costRateDate: "2027-04-01",
      payments: {
        create: [
          { amountCents: 5000, amountOriginal: 125000, dueDate: "2027-04-15", sortOrder: 0 },
          { amountCents: 15000, amountOriginal: 375000, dueDate: "2027-05-02", sortOrder: 1 },
        ],
      },
      documents: {
        create: [{ documentUrl: `/uploads/trips/${trip.id}/stay/booking.pdf`, fileName: "booking.pdf", sortOrder: 0 }],
      },
      images: { create: [{ imageUrl: `/uploads/trips/${trip.id}/stay/front.jpg`, sortOrder: 0 }] },
    },
  });

  const activity = (data: {
    title: string | null;
    content: string;
    scheduleMode: "FLEXIBLE" | "FIXED";
    durationMinutes: number;
    sortOrder: number;
    fromTime?: string;
    toTime?: string;
  }) =>
    prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: day2.id,
        title: data.title,
        contentJson: plannerDoc(data.content),
        scheduleMode: data.scheduleMode,
        durationMinutes: data.durationMinutes,
        sortOrder: data.sortOrder,
        fromTime: data.fromTime ?? null,
        toTime: data.toTime ?? null,
      },
    });

  const museum = await activity({
    title: "National Museum",
    content: "Start with the main hall",
    scheduleMode: "FLEXIBLE",
    durationMinutes: 180,
    sortOrder: 0,
  });
  await prisma.dayPlanItem.update({
    where: { id: museum.id },
    data: {
      costCents: 1500,
      linkUrl: "https://museum.example",
      locationLat: 50.079,
      locationLng: 14.431,
      locationLabel: "Wenceslas Square",
    },
  });
  const dinner = await activity({
    title: "Dinner",
    content: "Table for two",
    scheduleMode: "FIXED",
    durationMinutes: 90,
    sortOrder: 1,
    fromTime: "13:30",
    toTime: "15:00",
  });
  await prisma.dayPlanItemDocument.create({
    data: { dayPlanItemId: dinner.id, documentUrl: `/uploads/trips/${trip.id}/dinner/menu.pdf`, fileName: "menu.pdf", sortOrder: 0 },
  });
  await prisma.dayPlanItemImage.create({
    data: { dayPlanItemId: dinner.id, imageUrl: `/uploads/trips/${trip.id}/dinner/table.webp`, sortOrder: 0 },
  });
  const nightWalk = await activity({
    title: null,
    content: "Night walk along the river",
    scheduleMode: "FLEXIBLE",
    durationMinutes: 600,
    sortOrder: 2,
  });

  const walkLeg = await prisma.travelSegment.create({
    data: {
      tripDayId: day2.id,
      fromItemType: "ACCOMMODATION",
      fromItemId: previousStay.id,
      toItemType: "DAY_PLAN_ITEM",
      toItemId: museum.id,
      transportType: "WALKING",
      durationMinutes: 15,
      distanceKm: 1.2,
    },
  });
  const driveLeg = await prisma.travelSegment.create({
    data: {
      tripDayId: day2.id,
      fromItemType: "DAY_PLAN_ITEM",
      fromItemId: museum.id,
      toItemType: "DAY_PLAN_ITEM",
      toItemId: dinner.id,
      transportType: "CAR",
      durationMinutes: 30,
      distanceKm: 12.5,
      linkUrl: "https://maps.example/route",
    },
  });

  await prisma.$transaction((tx) => recomputeDayInTransaction(tx, trip.id, day2.id, new Date()));

  const parked = (title: string, createdAt: string) =>
    prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: null,
        title,
        contentJson: plannerDoc(`${title} idea`),
        scheduleMode: "FLEXIBLE",
        durationMinutes: 60,
        sortOrder: 0,
        createdAt: new Date(createdAt),
      },
    });
  const zoo = await parked("Zoo", "2027-01-01T00:00:00.000Z");
  const castle = await parked("Castle", "2027-01-02T00:00:00.000Z");
  await prisma.dayPlanItem.update({
    where: { id: castle.id },
    data: {
      costCents: 2000,
      costOriginalAmount: 50000,
      costCurrency: "CZK",
      costRate: 25,
      costRateDate: "2027-04-01",
      payments: { create: [{ amountCents: 2000, amountOriginal: 50000, dueDate: "2027-05-03", sortOrder: 0 }] },
    },
  });
  await prisma.dayPlanItemDocument.create({
    data: { dayPlanItemId: castle.id, documentUrl: `/uploads/trips/${trip.id}/castle/ticket.pdf`, fileName: "ticket.pdf", sortOrder: 0 },
  });
  await prisma.dayPlanItemImage.create({
    data: { dayPlanItemId: castle.id, imageUrl: `/uploads/trips/${trip.id}/castle/view.jpg`, sortOrder: 0 },
  });

  return { trip, day1, day2, day3, previousStay, stay, museum, dinner, nightWalk, walkLeg, driveLeg, zoo, castle };
};

export type SeededPlannerTrip = Awaited<ReturnType<typeof seedPlannerTrip>>;
