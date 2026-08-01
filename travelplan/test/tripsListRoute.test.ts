import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripListEntry = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  heroImageUrl: string | null;
  updatedAt: string;
  openDayCount: number;
  planItemCount: number;
  plannedCostTotal: number;
  startLocationLabel: string | null;
  destinationLocationLabel: string | null;
};

const buildRequest = (session?: string) =>
  new NextRequest("http://localhost/api/trips", {
    method: "GET",
    headers: session ? { cookie: `session=${session}` } : {},
  });

const createUser = async (email: string) =>
  prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

const createTrip = async (userId: string, name: string, overrides: Record<string, unknown> = {}) =>
  prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date("2026-09-12T00:00:00.000Z"),
      endDate: new Date("2026-09-13T00:00:00.000Z"),
      ...overrides,
    },
  });

const createDay = async (tripId: string, dayIndex: number) =>
  prisma.tripDay.create({
    data: {
      tripId,
      dayIndex,
      date: new Date(`2026-09-${String(11 + dayIndex).padStart(2, "0")}T00:00:00.000Z`),
    },
  });

describe("GET /api/trips", () => {
  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("rejects unauthenticated requests", async () => {
    const response = await GET(buildRequest());
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  // The payload key set is pinned deliberately: a missing field on this route is invisible in the
  // component tests (they build their own fixtures) and was last caught only by a key-set assertion.
  it("returns exactly the documented key set per trip", async () => {
    const user = await createUser("trips-list-keys@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id, "Portugal Roadtrip", {
      heroImageUrl: "/uploads/trips/x/hero.webp",
      startLocationLabel: "Lisbon",
      destinationLocationLabel: "Algarve",
    });
    await createDay(trip.id, 1);

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trips).toHaveLength(1);
    expect(Object.keys(payload.data!.trips[0]).sort()).toEqual(
      [
        "dayCount",
        "destinationLocationLabel",
        "endDate",
        "heroImageUrl",
        "id",
        "name",
        "openDayCount",
        "planItemCount",
        "plannedCostTotal",
        "startDate",
        "startLocationLabel",
        "updatedAt",
      ].sort(),
    );
    expect(payload.data?.trips[0].startDate).toBe("2026-09-12T00:00:00.000Z");
    expect(payload.data?.trips[0].startLocationLabel).toBe("Lisbon");
    expect(payload.data?.trips[0].destinationLocationLabel).toBe("Algarve");
  });

  it("counts a day with no accommodation row and a day with a blank-named one as open", async () => {
    const user = await createUser("trips-list-open@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id, "Gap trip");
    const dayOne = await createDay(trip.id, 1);
    const dayTwo = await createDay(trip.id, 2);
    const dayThree = await createDay(trip.id, 3);

    // A stay row that exists with a blank name is *open* - the same rule the trip detail payload
    // applies via `missingAccommodation`.
    await prisma.accommodation.create({ data: { tripDayId: dayOne.id, name: "   " } });
    await prisma.accommodation.create({ data: { tripDayId: dayTwo.id, name: "Hotel Lisboa" } });
    void dayThree;

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips[0].dayCount).toBe(3);
    expect(payload.data?.trips[0].openDayCount).toBe(2);
  });

  it("excludes a blank-named accommodation's cost while including plan item costs", async () => {
    const user = await createUser("trips-list-cost@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id, "Cost trip");
    const dayOne = await createDay(trip.id, 1);
    const dayTwo = await createDay(trip.id, 2);

    await prisma.accommodation.create({ data: { tripDayId: dayOne.id, name: "   ", costCents: 50_000 } });
    await prisma.accommodation.create({ data: { tripDayId: dayTwo.id, name: "Hotel Lisboa", costCents: 12_000 } });
    await prisma.dayPlanItem.create({
      data: { tripDayId: dayOne.id, contentJson: "{}", costCents: 2_500 },
    });
    await prisma.dayPlanItem.create({
      data: { tripDayId: dayTwo.id, contentJson: "{}", costCents: null },
    });

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips[0].plannedCostTotal).toBe(14_500);
    expect(payload.data?.trips[0].planItemCount).toBe(2);
  });

  it("does not return another user's trips", async () => {
    const user = await createUser("trips-list-mine@example.com");
    const other = await createUser("trips-list-theirs@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    await createTrip(user.id, "Mine");
    await createTrip(other.id, "Theirs");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips.map((trip) => trip.name)).toEqual(["Mine"]);
  });
});
