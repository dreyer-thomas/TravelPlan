import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, POST } from "@/app/api/admin/users/[userId]/memberships/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type Membership = { id: string; tripId: string; tripName: string; role: string };

const CSRF = "test-csrf-token";

const createUser = (email: string, role: "OWNER" | "VIEWER" | "ADMIN" = "OWNER") =>
  prisma.user.create({ data: { email, passwordHash: "hashed", role } });

const createTripFor = async (userId: string, name: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-02T00:00:00.000Z"),
    },
  });
  await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-07-01T00:00:00.000Z"), dayIndex: 0 },
  });
  return trip;
};

const sessionFor = (user: { id: string; role: string }) => createSessionJwt({ sub: user.id, role: user.role });

const buildRequest = (method: "POST" | "DELETE", { session, body, csrf = CSRF }: {
  session?: string;
  body?: unknown;
  csrf?: string | null;
}) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookies: string[] = [];
  if (csrf !== null) {
    headers["x-csrf-token"] = csrf;
    cookies.push(`csrf_token=${csrf}`);
  }
  if (session) cookies.push(`session=${session}`);
  if (cookies.length > 0) headers.cookie = cookies.join("; ");

  return new NextRequest("http://localhost/api/admin/users/target/memberships", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const context = (userId: string) => ({ params: Promise.resolve({ userId }) });

const setMembership = async (
  session: string | undefined,
  userId: string,
  body: unknown,
  csrf: string | null = CSRF,
) => {
  const response = await POST(buildRequest("POST", { session, body, csrf }), context(userId));
  return { response, payload: (await response.json()) as ApiEnvelope<{ membership: Membership }> };
};

const removeMembership = async (
  session: string | undefined,
  userId: string,
  body: unknown,
  csrf: string | null = CSRF,
) => {
  const response = await DELETE(buildRequest("DELETE", { session, body, csrf }), context(userId));
  return { response, payload: (await response.json()) as ApiEnvelope<{ removed: boolean }> };
};

describe("/api/admin/users/[userId]/memberships", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("POST - attach and change role (AC5, AC6)", () => {
    it("attaches a user to a trip as a viewer", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      const { response, payload } = await setMembership(await sessionFor(admin), guest.id, {
        tripId: trip.id,
        role: "VIEWER",
      });

      expect(response.status).toBe(200);
      expect(payload.data?.membership).toMatchObject({ tripId: trip.id, tripName: "Norwegen 2027", role: "VIEWER" });
      const stored = await prisma.tripMember.findUniqueOrThrow({
        where: { tripId_userId: { tripId: trip.id, userId: guest.id } },
      });
      expect(stored.role).toBe("VIEWER");
    });

    /** AC5: switch a user between VIEWER and CONTRIBUTOR on a trip, in both directions. */
    it.each([
      ["VIEWER", "CONTRIBUTOR"],
      ["CONTRIBUTOR", "VIEWER"],
    ] as const)("switches a membership from %s to %s", async (from, to) => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      const original = await prisma.tripMember.create({
        data: { tripId: trip.id, userId: guest.id, role: from },
      });

      const { response, payload } = await setMembership(await sessionFor(admin), guest.id, {
        tripId: trip.id,
        role: to,
      });

      expect(response.status).toBe(200);
      expect(payload.data?.membership.role).toBe(to);
      // The same row, updated - not a second membership beside the first. `@@unique([tripId, userId])`
      // would reject that anyway, so a create-shaped implementation would have thrown here instead.
      expect(payload.data?.membership.id).toBe(original.id);
      expect(await prisma.tripMember.count({ where: { userId: guest.id } })).toBe(1);
    });

    it("is idempotent - attaching twice leaves one membership", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      const session = await sessionFor(admin);

      await setMembership(session, guest.id, { tripId: trip.id, role: "VIEWER" });
      const { response } = await setMembership(session, guest.id, { tripId: trip.id, role: "VIEWER" });

      expect(response.status).toBe(200);
      expect(await prisma.tripMember.count({ where: { userId: guest.id } })).toBe(1);
    });

    /**
     * The admin does not own the trip, and that is exactly the point: `POST /api/trips/[id]/members`
     * refuses this same caller through `hasTripOwnerAccess`. The operation is the same, the access
     * predicate is what changes.
     */
    it("works on a trip the calling admin does not own", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Somebody Else's Trip");

      const { response } = await setMembership(await sessionFor(admin), guest.id, {
        tripId: trip.id,
        role: "CONTRIBUTOR",
      });

      expect(response.status).toBe(200);
      expect(await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({ userId: owner.id });
    });

    it("refuses making a trip's own owner a member of it", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      const { response, payload } = await setMembership(await sessionFor(admin), owner.id, {
        tripId: trip.id,
        role: "VIEWER",
      });

      // The owner already has full access through `Trip.userId`. A `TripMember` row for them would be a
      // second, weaker statement about the same relationship - and a *viewer* row on a trip you own reads
      // like a downgrade that it is not.
      expect(response.status).toBe(409);
      expect(payload.error?.code).toBe("trip_owner");
      expect(await prisma.tripMember.count()).toBe(0);
    });

    it("reports an unknown trip and an unknown account distinctly", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      const session = await sessionFor(admin);

      const unknownTrip = await setMembership(session, guest.id, { tripId: "no-such-trip", role: "VIEWER" });
      expect(unknownTrip.response.status).toBe(404);
      expect(unknownTrip.payload.error?.code).toBe("trip_not_found");

      const unknownUser = await setMembership(session, "no-such-user", { tripId: trip.id, role: "VIEWER" });
      expect(unknownUser.response.status).toBe(404);
      expect(unknownUser.payload.error?.code).toBe("not_found");
    });

    it("refuses a role outside VIEWER and CONTRIBUTOR", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      // `ADMIN` is a `UserRole`, not a `TripMemberRole`. The two enums share the word "role" and nothing
      // else, and this is the boundary that keeps them apart.
      const { response, payload } = await setMembership(await sessionFor(admin), guest.id, {
        tripId: trip.id,
        role: "ADMIN",
      });

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
      expect(await prisma.tripMember.count()).toBe(0);
    });

    it.each([
      ["a trip owner", "OWNER"],
      ["a viewer", "VIEWER"],
    ] as const)("refuses %s as caller", async (_label, callerRole) => {
      const caller = await createUser("caller@example.com", callerRole);
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(caller.id, "Caller's Trip");

      const { response, payload } = await setMembership(await sessionFor(caller), guest.id, {
        tripId: trip.id,
        role: "VIEWER",
      });

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      expect(await prisma.tripMember.count()).toBe(0);
    });

    it("refuses an anonymous caller", async () => {
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      const { response, payload } = await setMembership(undefined, guest.id, { tripId: trip.id, role: "VIEWER" });

      expect(response.status).toBe(401);
      expect(payload.error?.code).toBe("unauthorized");
      expect(await prisma.tripMember.count()).toBe(0);
    });

    it("refuses a request without a valid CSRF token", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      const { response, payload } = await setMembership(
        await sessionFor(admin),
        guest.id,
        { tripId: trip.id, role: "VIEWER" },
        null,
      );

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("csrf_invalid");
      expect(await prisma.tripMember.count()).toBe(0);
    });
  });

  describe("DELETE - detach (AC6)", () => {
    it("removes the membership", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: guest.id, role: "VIEWER" } });

      const { response, payload } = await removeMembership(await sessionFor(admin), guest.id, { tripId: trip.id });

      expect(response.status).toBe(200);
      expect(payload.data?.removed).toBe(true);
      expect(await prisma.tripMember.count({ where: { userId: guest.id } })).toBe(0);
    });

    it("leaves the trip, its days and its owner alone", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: guest.id, role: "VIEWER" } });

      await removeMembership(await sessionFor(admin), guest.id, { tripId: trip.id });

      expect(await prisma.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
      expect(await prisma.tripDay.count({ where: { tripId: trip.id } })).toBe(1);
      expect(await prisma.user.findUnique({ where: { id: guest.id } })).not.toBeNull();
    });

    /**
     * AC6's second sentence: "Detaching removes the membership; it never touches a trip the user *owns*."
     *
     * The user here owns one trip and is a member of another, which is the only arrangement in which the
     * two relations can be confused. Detaching from the trip they are a member of must leave the trip they
     * own completely untouched - and the same account asked to detach from the trip it *owns* has no
     * membership there to remove, so the answer is `missing`, not a deleted trip.
     */
    it("never touches a trip the user owns", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const stranger = await createUser("stranger@example.com");
      const both = await createUser("both@example.com");
      const ownTrip = await createTripFor(both.id, "Own Trip");
      const strangerTrip = await createTripFor(stranger.id, "Stranger Trip");
      await prisma.tripMember.create({ data: { tripId: strangerTrip.id, userId: both.id, role: "CONTRIBUTOR" } });
      const session = await sessionFor(admin);

      const detach = await removeMembership(session, both.id, { tripId: strangerTrip.id });
      expect(detach.response.status).toBe(200);

      // The owned trip and its day are still there, and so is the ownership itself.
      expect(await prisma.trip.findUnique({ where: { id: ownTrip.id } })).not.toBeNull();
      expect(await prisma.tripDay.count({ where: { tripId: ownTrip.id } })).toBe(1);
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: ownTrip.id } })).userId).toBe(both.id);

      // And asking to detach them from the trip they own finds no membership rather than deleting it.
      const detachOwned = await removeMembership(session, both.id, { tripId: ownTrip.id });
      expect(detachOwned.response.status).toBe(404);
      expect(detachOwned.payload.error?.code).toBe("not_found");
      expect(await prisma.trip.findUnique({ where: { id: ownTrip.id } })).not.toBeNull();
    });

    it("reports a membership that is not there as not found", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      const { response, payload } = await removeMembership(await sessionFor(admin), guest.id, { tripId: trip.id });

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
    });

    it("refuses a non-admin caller", async () => {
      const owner = await createUser("owner@example.com", "OWNER");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Owner Trip");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: guest.id, role: "VIEWER" } });

      const { response, payload } = await removeMembership(await sessionFor(owner), guest.id, { tripId: trip.id });

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      expect(await prisma.tripMember.count()).toBe(1);
    });

    it("refuses an anonymous caller", async () => {
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: guest.id, role: "VIEWER" } });

      const { response, payload } = await removeMembership(undefined, guest.id, { tripId: trip.id });

      expect(response.status).toBe(401);
      expect(payload.error?.code).toBe("unauthorized");
      expect(await prisma.tripMember.count()).toBe(1);
    });

    it("refuses a request without a valid CSRF token", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const guest = await createUser("guest@example.com");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: guest.id, role: "VIEWER" } });

      const { response, payload } = await removeMembership(
        await sessionFor(admin),
        guest.id,
        { tripId: trip.id },
        null,
      );

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("csrf_invalid");
      expect(await prisma.tripMember.count()).toBe(1);
    });
  });
});
