import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays, getDaySuggestionContextForUser } from "@/lib/repositories/tripRepo";

/**
 * Story 12.1, Task 4. What the AI day-suggestion request is told about the day: its date, where it
 * starts, where it ends and which activities already exist. Nothing else - the privacy rule is asserted
 * on the prompt itself in `daySuggestionPrompt.test.ts`.
 */
describe("getDaySuggestionContextForUser", () => {
  let counter = 0;

  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  const seed = async (startLocation?: { lat: number; lng: number; label: string }) => {
    const user = await prisma.user.create({
      data: { email: `ctx-${Date.now()}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
    });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Secret Trip Name",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-03T00:00:00.000Z",
      startLocation,
    });
    const days = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
    return { user, trip, days };
  };

  const stay = (tripDayId: string, data: { name: string; locationLabel?: string; lat?: number; lng?: number }) =>
    prisma.accommodation.create({
      data: {
        tripDayId,
        name: data.name,
        status: "BOOKED",
        locationLabel: data.locationLabel ?? null,
        locationLat: data.lat ?? null,
        locationLng: data.lng ?? null,
      },
    });

  it("uses the previous night's stay as the start and the day's stay as the end", async () => {
    const { user, trip, days } = await seed({ lat: 52.52, lng: 13.405, label: "Berlin" });
    await stay(days[0].id, { name: "Hotel Adlon", locationLabel: "Unter den Linden 77, Berlin", lat: 52.5159, lng: 13.3801 });
    await stay(days[1].id, { name: "Hotel Elephant", locationLabel: "Markt 19, Weimar", lat: 50.9795, lng: 11.3297 });

    const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: days[1].id });

    expect(context).toEqual({
      date: "2026-08-02",
      start: { label: "Hotel Adlon, Unter den Linden 77, Berlin", lat: 52.5159, lng: 13.3801 },
      end: { label: "Hotel Elephant, Markt 19, Weimar", lat: 50.9795, lng: 11.3297 },
      existingTitles: [],
    });
  });

  it("uses the nearest lower dayIndex when the day before has no row", async () => {
    const { user, trip, days } = await seed();
    await stay(days[0].id, { name: "Hotel Adlon", lat: 52.5159, lng: 13.3801 });
    await prisma.tripDay.delete({ where: { id: days[1].id } });

    const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: days[2].id });

    expect(context?.start).toEqual({ label: "Hotel Adlon", lat: 52.5159, lng: 13.3801 });
  });

  it("falls back to the trip's start location on day 1", async () => {
    const { user, trip, days } = await seed({ lat: 52.52, lng: 13.405, label: "Berlin Hbf" });

    const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: days[0].id });

    expect(context?.start).toEqual({ label: "Berlin Hbf", lat: 52.52, lng: 13.405 });
  });

  it("has no start when there is neither a previous stay nor a trip start, and no end without a stay", async () => {
    const { user, trip, days } = await seed();

    const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: days[0].id });

    expect(context?.start).toBeNull();
    expect(context?.end).toBeNull();
  });

  it("ignores a blank previous stay with no coordinates and falls through to the trip start", async () => {
    const { user, trip, days } = await seed({ lat: 52.52, lng: 13.405, label: "Berlin" });
    await stay(days[0].id, { name: "   " });

    const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: days[1].id });

    expect(context?.start).toEqual({ label: "Berlin", lat: 52.52, lng: 13.405 });
  });

  it("lists the trimmed, non-empty activity titles in start-time order", async () => {
    const { user, trip, days } = await seed();
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    await prisma.dayPlanItem.create({ data: { tripDayId: days[0].id, contentJson: doc, title: " Lunch ", fromTime: "12:00" } });
    await prisma.dayPlanItem.create({ data: { tripDayId: days[0].id, contentJson: doc, title: "Museum", fromTime: "09:30" } });
    await prisma.dayPlanItem.create({ data: { tripDayId: days[0].id, contentJson: doc, title: "   " } });
    await prisma.dayPlanItem.create({ data: { tripDayId: days[0].id, contentJson: doc, title: null } });
    await prisma.dayPlanItem.create({ data: { tripDayId: days[0].id, contentJson: doc, title: "Evening walk" } });

    const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: days[0].id });

    expect(context?.existingTitles).toEqual(["Museum", "Lunch", "Evening walk"]);
  });

  it("returns null for a day on another trip and for a user who cannot read the trip", async () => {
    const a = await seed();
    const b = await seed();

    expect(await getDaySuggestionContextForUser({ userId: a.user.id, tripId: a.trip.id, dayId: b.days[0].id })).toBeNull();
    expect(await getDaySuggestionContextForUser({ userId: b.user.id, tripId: a.trip.id, dayId: a.days[0].id })).toBeNull();
  });
});
