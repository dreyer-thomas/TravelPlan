import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/users/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type RegisteredUsersPayload = {
  users: { id: string; email: string }[];
};

const buildRequest = (session?: string) =>
  new NextRequest("http://localhost/api/users", {
    headers: session ? { cookie: `session=${session}` } : {},
  });

const createUser = (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: "hashed",
      role: "OWNER",
    },
  });

const createTripFor = (userId: string, name: string) =>
  prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-02T00:00:00.000Z"),
    },
  });

const readUsers = async (session: string) => {
  const response = await GET(buildRequest(session));
  const payload = (await response.json()) as ApiEnvelope<RegisteredUsersPayload>;
  return { response, payload };
};

describe("/api/users", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns every registered account to a trip owner, ordered by email", async () => {
    // Deliberately not in alphabetical creation order, so the assertion proves the `orderBy` rather
    // than the insertion sequence.
    const owner = await createUser("mira@example.com");
    await createUser("zoe@example.com");
    await createUser("anton@example.com");
    await createTripFor(owner.id, "Owner Trip");
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const { response, payload } = await readUsers(session);

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    // The caller's own row is in the list, and so is `zoe`, who owns no trip at all: the list is not
    // scoped to a trip, and "accounts that exist" is exactly the question it answers.
    expect(payload.data?.users.map((user) => user.email)).toEqual([
      "anton@example.com",
      "mira@example.com",
      "zoe@example.com",
    ]);
  });

  it("carries only id and email per account", async () => {
    const owner = await createUser("owner@example.com");
    await createTripFor(owner.id, "Owner Trip");
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const { payload } = await readUsers(session);

    const [user] = payload.data?.users ?? [];
    expect(user).toBeDefined();
    expect(Object.keys(user!).sort()).toEqual(["email", "id"]);
    expect("passwordHash" in user!).toBe(false);
    expect("role" in user!).toBe(false);
    expect("mustChangePassword" in user!).toBe(false);
    expect("preferredLanguage" in user!).toBe(false);
  });

  it("tells every caller not to store the response", async () => {
    const owner = await createUser("owner@example.com");
    await createTripFor(owner.id, "Owner Trip");
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const { response } = await readUsers(session);

    // The browser client asks for `cache: "no-store"` itself, but this body is every email address in
    // the system and a caller that does not ask - a proxy, curl - needs telling.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reflects accounts registered between two reads", async () => {
    const owner = await createUser("owner@example.com");
    await createTripFor(owner.id, "Owner Trip");
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const first = await readUsers(session);
    expect(first.payload.data?.users).toHaveLength(1);

    await createUser("newcomer@example.com");

    const second = await readUsers(session);
    expect(second.payload.data?.users.map((user) => user.email)).toEqual([
      "newcomer@example.com",
      "owner@example.com",
    ]);
  });

  it("blocks a signed-in user who owns no trip", async () => {
    const stranger = await createUser("stranger@example.com");
    const session = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const { response, payload } = await readUsers(session);

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("forbidden");
    expect(payload.data).toBeNull();
  });

  it.each(["VIEWER", "CONTRIBUTOR"] as const)(
    "blocks a %s member who owns no trip of their own",
    async (memberRole) => {
      const owner = await createUser("owner@example.com");
      const member = await createUser("member@example.com");
      const trip = await createTripFor(owner.id, "Owner Trip");
      await prisma.tripMember.create({
        data: { tripId: trip.id, userId: member.id, role: memberRole },
      });
      const session = await createSessionJwt({ sub: member.id, role: member.role });

      const { response, payload } = await readUsers(session);

      // Membership is not ownership: the gate is `Trip.userId`, and a collaborator has none.
      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      expect(payload.data).toBeNull();
    },
  );

  it("lets an owner through who is also a viewer on somebody else's trip", async () => {
    // The two conditions the gate has to keep apart, held by the same account at once. Owning a trip
    // decides it and the `TripMember` row is irrelevant - a gate that learned to read `TripMember`
    // would still pass this caller, and every other case in this file, so without it the suite
    // cannot tell "ownership" from "any trip relationship".
    const stranger = await createUser("stranger@example.com");
    const both = await createUser("both@example.com");
    const strangerTrip = await createTripFor(stranger.id, "Stranger Trip");
    await createTripFor(both.id, "Own Trip");
    await prisma.tripMember.create({
      data: { tripId: strangerTrip.id, userId: both.id, role: "VIEWER" },
    });
    const session = await createSessionJwt({ sub: both.id, role: both.role });

    const { response, payload } = await readUsers(session);

    expect(response.status).toBe(200);
    expect(payload.data?.users.map((user) => user.email)).toEqual([
      "both@example.com",
      "stranger@example.com",
    ]);
  });

  it("rejects an unauthenticated caller", async () => {
    const response = await GET(buildRequest());
    const payload = (await response.json()) as ApiEnvelope<RegisteredUsersPayload>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects a caller who still has to change their password", async () => {
    const owner = await createUser("owner@example.com");
    await createTripFor(owner.id, "Owner Trip");
    const session = await createSessionJwt({
      sub: owner.id,
      role: owner.role,
      mustChangePassword: true,
    });

    const { response, payload } = await readUsers(session);

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("password_change_required");
  });
});
