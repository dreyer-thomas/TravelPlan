import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getPlannerDayForUser, listParkedItemMediaForPlanner } from "@/lib/repositories/connectorReadRepo";
import { getTripWithDaysForUser } from "@/lib/repositories/tripRepo";
import { seedPlannerTrip } from "./helpers/plannerFixtures";

let counter = 0;
const createUser = () =>
  prisma.user.create({
    data: { email: `connector-read-${Date.now()}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });

beforeEach(async () => {
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
});

describe("getPlannerDayForUser (Story 15.2)", () => {
  it("reads a day by id and by date with the schedule's times, in the day's order", async () => {
    const owner = await createUser();
    const seed = await seedPlannerTrip(owner.id);

    const byId = await getPlannerDayForUser({ userId: owner.id, tripId: seed.trip.id, day: { id: seed.day2.id } });
    const byDate = await getPlannerDayForUser({ userId: owner.id, tripId: seed.trip.id, day: { date: "2027-05-02" } });
    expect(byDate).toEqual(byId);

    const day = byId!.day!;
    expect(day.id).toBe(seed.day2.id);
    expect(day.dayIndex).toBe(2);
    expect(day.previousStay).toEqual({ id: seed.previousStay.id, name: "Hotel Arrival", checkOutTime: "11:00" });
    expect(day.items.map((item) => [item.id, item.fromTime, item.toTime])).toEqual([
      [seed.museum.id, "11:15", "14:15"],
      [seed.dinner.id, "13:30", "15:00"],
      [seed.nightWalk.id, null, null],
    ]);
    expect(day.items.every((item) => item.updatedAt instanceof Date)).toBe(true);
    expect(day.items[1].documents).toEqual([
      { id: expect.any(String), fileName: "menu.pdf", documentUrl: `/uploads/trips/${seed.trip.id}/dinner/menu.pdf`, updatedAt: expect.any(Date) },
    ]);
    expect(day.legs.map((leg) => leg.id)).toEqual([seed.walkLeg.id, seed.driveLeg.id]);
    expect(day.stay).toMatchObject({ id: seed.stay.id, name: "Hotel Old Town", status: "BOOKED" });
    expect(day.stay!.payments).toEqual([
      { amountCents: 5000, dueDate: "2027-04-15", amountOriginal: 125000 },
      { amountCents: 15000, dueDate: "2027-05-02", amountOriginal: 375000 },
    ]);
    expect(day.missingStay).toBe(false);
    expect(day.warnings.map((warning) => warning.kind)).toEqual(["late", "overflow"]);
  });

  it("derives the same warnings as the trip overview (parity, not a second rule)", async () => {
    const owner = await createUser();
    const seed = await seedPlannerTrip(owner.id);
    const overview = await getTripWithDaysForUser(owner.id, seed.trip.id);
    const result = await getPlannerDayForUser({ userId: owner.id, tripId: seed.trip.id, day: { id: seed.day2.id } });
    expect(result!.day!.warnings).toEqual(overview!.days.find((day) => day.id === seed.day2.id)!.planConflicts);
    expect(result!.day!.warnings.length).toBe(2);
  });

  it("leaves out legs the day view does not draw (review D1)", async () => {
    const owner = await createUser();
    const seed = await seedPlannerTrip(owner.id);
    // museum → nightWalk skips dinner, so the timeline never draws it; the reverse of a drawn leg neither.
    const orphans = await Promise.all([
      prisma.travelSegment.create({
        data: {
          tripDayId: seed.day2.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: seed.museum.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: seed.nightWalk.id,
          transportType: "BUS",
          durationMinutes: 20,
        },
      }),
      prisma.travelSegment.create({
        data: {
          tripDayId: seed.day2.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: seed.dinner.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: seed.museum.id,
          transportType: "CAR",
          durationMinutes: 10,
        },
      }),
    ]);

    const result = await getPlannerDayForUser({ userId: owner.id, tripId: seed.trip.id, day: { id: seed.day2.id } });
    const legIds = result!.day!.legs.map((leg) => leg.id);
    expect(legIds).toEqual([seed.walkLeg.id, seed.driveLeg.id]);
    expect(legIds).not.toContain(orphans[0].id);
    expect(legIds).not.toContain(orphans[1].id);
  });

  it("finds last night's stay across a gap in dayIndex, whatever its name", async () => {
    const owner = await createUser();
    const trip = await prisma.trip.create({
      data: { userId: owner.id, name: "Gap", startDate: new Date("2027-06-01"), endDate: new Date("2027-06-03") },
    });
    const first = await prisma.tripDay.create({ data: { tripId: trip.id, dayIndex: 1, date: new Date("2027-06-01") } });
    const later = await prisma.tripDay.create({ data: { tripId: trip.id, dayIndex: 3, date: new Date("2027-06-03") } });
    const stay = await prisma.accommodation.create({ data: { tripDayId: first.id, name: "   ", checkOutTime: "09:30" } });

    const result = await getPlannerDayForUser({ userId: owner.id, tripId: trip.id, day: { id: later.id } });
    expect(result!.day!.previousStay).toEqual({ id: stay.id, name: "   ", checkOutTime: "09:30" });

    const firstDay = await getPlannerDayForUser({ userId: owner.id, tripId: trip.id, day: { id: first.id } });
    expect(firstDay!.day!.previousStay).toBeNull();
    // A blank name is no stay for the night (the overview's rule).
    expect(firstDay!.day!.stay).toBeNull();
    expect(firstDay!.day!.missingStay).toBe(true);
  });

  it("answers null for a viewer, a removed member and a stranger, and a contributor reads the same day", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const contributor = await createUser();
    const removed = await createUser();
    const stranger = await createUser();
    const seed = await seedPlannerTrip(owner.id);
    await prisma.tripMember.createMany({
      data: [
        { tripId: seed.trip.id, userId: viewer.id, role: "VIEWER" },
        { tripId: seed.trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
        { tripId: seed.trip.id, userId: removed.id, role: "CONTRIBUTOR" },
      ],
    });
    await prisma.tripMember.deleteMany({ where: { userId: removed.id } });

    const read = (userId: string) => getPlannerDayForUser({ userId, tripId: seed.trip.id, day: { id: seed.day2.id } });
    expect(await read(viewer.id)).toBeNull();
    expect(await read(removed.id)).toBeNull();
    expect(await read(stranger.id)).toBeNull();
    expect(await read(contributor.id)).toEqual(await read(owner.id));
  });

  it("answers { day: null } for a day of another trip and for a date outside the trip", async () => {
    const owner = await createUser();
    const seed = await seedPlannerTrip(owner.id);
    const other = await seedPlannerTrip(owner.id, "Other");
    expect(await getPlannerDayForUser({ userId: owner.id, tripId: seed.trip.id, day: { id: other.day2.id } })).toEqual({
      day: null,
    });
    expect(await getPlannerDayForUser({ userId: owner.id, tripId: seed.trip.id, day: { date: "2027-05-09" } })).toEqual({
      day: null,
    });
  });
});

describe("listParkedItemMediaForPlanner (Story 15.2)", () => {
  it("returns parked activities' media only, for writers only", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const seed = await seedPlannerTrip(owner.id);
    await prisma.tripMember.create({ data: { tripId: seed.trip.id, userId: viewer.id, role: "VIEWER" } });
    const itemIds = [seed.castle.id, seed.zoo.id, seed.dinner.id];

    const media = await listParkedItemMediaForPlanner({ userId: owner.id, tripId: seed.trip.id, itemIds });
    expect(media.get(seed.castle.id)).toEqual({
      documents: [
        { id: expect.any(String), fileName: "ticket.pdf", documentUrl: `/uploads/trips/${seed.trip.id}/castle/ticket.pdf`, updatedAt: expect.any(Date) },
      ],
      images: [{ id: expect.any(String), imageUrl: `/uploads/trips/${seed.trip.id}/castle/view.jpg`, updatedAt: expect.any(Date) }],
    });
    expect(media.has(seed.zoo.id)).toBe(false);
    // A day activity's media is not the bucket list's.
    expect(media.has(seed.dinner.id)).toBe(false);

    expect((await listParkedItemMediaForPlanner({ userId: viewer.id, tripId: seed.trip.id, itemIds })).size).toBe(0);
  });
});
