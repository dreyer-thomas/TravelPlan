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
  accessRole: "owner" | "viewer" | "contributor";
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

const addMember = async (tripId: string, userId: string, role: "VIEWER" | "CONTRIBUTOR") =>
  prisma.tripMember.create({ data: { tripId, userId, role } });

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
        "accessRole",
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

  it("reports a trip the account owns as owner", async () => {
    const user = await createUser("trips-list-owner@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    await createTrip(user.id, "Mine");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips[0].accessRole).toBe("owner");
  });

  // The defect this route test exists for: before Story 5.12 the list filtered on ownership alone,
  // so an invited collaborator's only post-sign-in surface was empty and the invitation looked
  // broken although the trip opened fine by direct URL.
  it("lists a trip reached through a VIEWER membership and reports it as viewer", async () => {
    const user = await createUser("trips-list-viewer@example.com");
    const owner = await createUser("trips-list-viewer-owner@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id, "Shared with a viewer");
    await addMember(trip.id, user.id, "VIEWER");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips.map((entry) => entry.name)).toEqual(["Shared with a viewer"]);
    expect(payload.data?.trips[0].accessRole).toBe("viewer");
  });

  it("lists a trip reached through a CONTRIBUTOR membership and reports it as contributor", async () => {
    const user = await createUser("trips-list-contributor@example.com");
    const owner = await createUser("trips-list-contributor-owner@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id, "Shared with a contributor");
    await addMember(trip.id, user.id, "CONTRIBUTOR");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    // The payload speaks the app's role vocabulary, never the Prisma enum.
    expect(payload.data?.trips[0].accessRole).toBe("contributor");
  });

  it("returns an owned trip and a shared one as two separately labelled entries", async () => {
    const user = await createUser("trips-list-both@example.com");
    const owner = await createUser("trips-list-both-owner@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    await createTrip(user.id, "Mine");
    const theirs = await createTrip(owner.id, "Theirs, shared");
    await addMember(theirs.id, user.id, "CONTRIBUTOR");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips).toHaveLength(2);
    // Both fixtures share a `startDate`, so the `orderBy` leaves their relative order undefined -
    // the entries are matched by name rather than by position.
    const byName = new Map(payload.data!.trips.map((entry) => [entry.name, entry.accessRole]));
    expect(byName.get("Mine")).toBe("owner");
    expect(byName.get("Theirs, shared")).toBe("contributor");
  });

  // Prisma compiles the relation filter inside `OR` to an `EXISTS` subquery rather than a join, so a
  // trip matching both arms comes back once. Proven rather than trusted - a join would duplicate the
  // row, and the owner arm has to win the label either way.
  it("returns a trip the account both owns and holds a membership on exactly once, as owner", async () => {
    const user = await createUser("trips-list-selfmember@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id, "Mine, and I am a member of it");
    await addMember(trip.id, user.id, "VIEWER");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips).toHaveLength(1);
    expect(payload.data?.trips[0].accessRole).toBe("owner");
  });

  it("does not return a trip the account neither owns nor holds a membership on", async () => {
    const user = await createUser("trips-list-mine@example.com");
    const other = await createUser("trips-list-theirs@example.com");
    // A third account, so the negative is proven while the account does hold a membership somewhere:
    // widening the `where` to owner-OR-member must not turn "shares one trip" into "sees them all".
    const stranger = await createUser("trips-list-stranger@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    await createTrip(user.id, "Mine");
    const shared = await createTrip(other.id, "Theirs, shared with me");
    await addMember(shared.id, user.id, "VIEWER");
    await createTrip(other.id, "Theirs, not shared");
    await createTrip(stranger.id, "A stranger's");

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(payload.data?.trips.map((trip) => trip.name).sort()).toEqual(["Mine", "Theirs, shared with me"]);
  });

  // The widened `where` is proven to admit in five cases above; this is the one that proves it also
  // revokes. Nothing else pins that removing a membership takes the trip off the collaborator's
  // dashboard rather than leaving a row that 404s when clicked.
  it("stops listing a trip once the membership is removed", async () => {
    const user = await createUser("trips-list-revoked@example.com");
    const owner = await createUser("trips-list-revoked-owner@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id, "Shared, then revoked");
    const membership = await addMember(trip.id, user.id, "VIEWER");

    const before = (await (await GET(buildRequest(token))).json()) as ApiEnvelope<{ trips: TripListEntry[] }>;
    expect(before.data?.trips.map((entry) => entry.name)).toEqual(["Shared, then revoked"]);

    await prisma.tripMember.delete({ where: { id: membership.id } });

    const after = (await (await GET(buildRequest(token))).json()) as ApiEnvelope<{ trips: TripListEntry[] }>;
    expect(after.data?.trips).toEqual([]);
  });

  // The body became other people's data the moment the list went owner-OR-member: trip names, routes,
  // date ranges, cost totals and this account's role on each. The dashboard asks with
  // `cache: "no-store"`, but that governs only the browser's own cache - the header is what a proxy
  // reads. Same treatment `/api/users` and `/api/admin/users` give their per-account bodies.
  it("tells caches not to store the per-account list", async () => {
    const user = await createUser("trips-list-nostore@example.com");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    await createTrip(user.id, "Mine");

    const response = await GET(buildRequest(token));

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 200 with an empty list for an account with neither trips nor memberships", async () => {
    const user = await createUser("trips-list-nothing@example.com");
    await createUser("trips-list-nothing-other@example.com").then((other) => createTrip(other.id, "Not mine"));
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await GET(buildRequest(token));
    const payload = (await response.json()) as ApiEnvelope<{ trips: TripListEntry[] }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trips).toEqual([]);
  });
});
