import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/users/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type AdminUser = {
  id: string;
  email: string;
  role: string;
  ownedTrips: { id: string; name: string }[];
  memberships: { id: string; tripId: string; tripName: string; role: string }[];
};

const createUser = (email: string, role: "OWNER" | "VIEWER" | "ADMIN" = "OWNER") =>
  prisma.user.create({ data: { email, passwordHash: "hashed", role } });

const createTripFor = (userId: string, name: string) =>
  prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-02T00:00:00.000Z"),
    },
  });

const buildRequest = (session?: string) =>
  new NextRequest("http://localhost/api/admin/users", {
    headers: session ? { cookie: `session=${session}` } : {},
  });

const readUsers = async (session?: string) => {
  const response = await GET(buildRequest(session));
  const payload = (await response.json()) as ApiEnvelope<{ users: AdminUser[] }>;
  return { response, payload };
};

const sessionFor = (user: { id: string; role: string }) => createSessionJwt({ sub: user.id, role: user.role });

describe("GET /api/admin/users", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("the gate (AC1)", () => {
    it("admits an admin", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const { response, payload } = await readUsers(await sessionFor(admin));

      expect(response.status).toBe(200);
      expect(payload.error).toBeNull();
    });

    /**
     * The four refusals that matter, and the trip-owning one matters most: `hasAnyOwnedTrip` is what
     * Story 5.8 gated on, it is the same population as "everybody who registered and made a trip", and
     * reusing it here would have handed an account-deletion surface to all of them (Trap 2).
     */
    it("refuses a trip owner who is not an admin", async () => {
      const owner = await createUser("owner@example.com", "OWNER");
      await createTripFor(owner.id, "Owner Trip");

      const { response, payload } = await readUsers(await sessionFor(owner));

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      expect(payload.data).toBeNull();
    });

    it.each(["VIEWER", "CONTRIBUTOR"] as const)("refuses a %s member", async (memberRole) => {
      const owner = await createUser("owner@example.com", "OWNER");
      const member = await createUser("member@example.com", "VIEWER");
      const trip = await createTripFor(owner.id, "Owner Trip");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: member.id, role: memberRole } });

      const { response, payload } = await readUsers(await sessionFor(member));

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
    });

    it("refuses an anonymous caller", async () => {
      const { response, payload } = await readUsers();

      expect(response.status).toBe(401);
      expect(payload.error?.code).toBe("unauthorized");
    });

    it("refuses an admin who still has to change their password", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const session = await createSessionJwt({ sub: admin.id, role: "ADMIN", mustChangePassword: true });

      const { response, payload } = await readUsers(session);

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("password_change_required");
    });
  });

  describe("what the list shows (AC3)", () => {
    it("lists every account by email, ordered", async () => {
      // Deliberately not created in alphabetical order, so this proves the `orderBy` rather than the
      // insertion sequence.
      const admin = await createUser("mira@example.com", "ADMIN");
      await createUser("zoe@example.com");
      await createUser("anton@example.com");

      const { payload } = await readUsers(await sessionFor(admin));

      expect(payload.data?.users.map((user) => user.email)).toEqual([
        "anton@example.com",
        "mira@example.com",
        "zoe@example.com",
      ]);
    });

    /**
     * AC3's whole point. Ownership (`Trip.userId`) and membership (`TripMember`) are two different
     * relations, and one account can hold both at once - own trip A and be a viewer on trip B. If the
     * surface merged them into one word, "detach from trip" would be offered for a trip the user owns,
     * where it means nothing, and the deletion refusal in AC7 would have no visible cause.
     */
    it("keeps owned trips and memberships apart on the same account", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const stranger = await createUser("stranger@example.com");
      const both = await createUser("both@example.com");

      const ownTrip = await createTripFor(both.id, "Own Trip");
      const strangerTrip = await createTripFor(stranger.id, "Stranger Trip");
      const membership = await prisma.tripMember.create({
        data: { tripId: strangerTrip.id, userId: both.id, role: "CONTRIBUTOR" },
      });

      const { payload } = await readUsers(await sessionFor(admin));
      const row = payload.data?.users.find((user) => user.email === "both@example.com");

      expect(row?.ownedTrips).toEqual([{ id: ownTrip.id, name: "Own Trip" }]);
      expect(row?.memberships).toEqual([
        { id: membership.id, tripId: strangerTrip.id, tripName: "Stranger Trip", role: "CONTRIBUTOR" },
      ]);
    });

    it("reports the membership role per trip, not per account", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com");
      const member = await createUser("member@example.com");
      const tripA = await createTripFor(owner.id, "Trip A");
      const tripB = await createTripFor(owner.id, "Trip B");
      await prisma.tripMember.create({ data: { tripId: tripA.id, userId: member.id, role: "VIEWER" } });
      await prisma.tripMember.create({ data: { tripId: tripB.id, userId: member.id, role: "CONTRIBUTOR" } });

      const { payload } = await readUsers(await sessionFor(admin));
      const row = payload.data?.users.find((user) => user.email === "member@example.com");

      expect(
        row?.memberships.map((membership) => [membership.tripName, membership.role]).sort(),
      ).toEqual([
        ["Trip A", "VIEWER"],
        ["Trip B", "CONTRIBUTOR"],
      ].sort());
    });

    it("shows an account that reaches nothing as reaching nothing", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      await createUser("nobody@example.com");

      const { payload } = await readUsers(await sessionFor(admin));
      const row = payload.data?.users.find((user) => user.email === "nobody@example.com");

      expect(row?.ownedTrips).toEqual([]);
      expect(row?.memberships).toEqual([]);
    });

    it("carries the account role, so the grant action has something to act on", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      await createUser("owner@example.com", "OWNER");

      const { payload } = await readUsers(await sessionFor(admin));

      expect(payload.data?.users.find((user) => user.email === "admin@example.com")?.role).toBe("ADMIN");
      expect(payload.data?.users.find((user) => user.email === "owner@example.com")?.role).toBe("OWNER");
    });

    it("includes the calling admin's own row", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { payload } = await readUsers(await sessionFor(admin));

      expect(payload.data?.users.map((user) => user.email)).toEqual(["admin@example.com"]);
    });
  });

  describe("what the payload does not carry (AC9)", () => {
    it("carries no password hash, no reset token and no session data", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      await prisma.passwordResetToken.create({
        data: { userId: admin.id, tokenHash: "token-hash", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
      });

      const { payload } = await readUsers(await sessionFor(admin));
      const [row] = payload.data?.users ?? [];

      // Asserted as the exact key set rather than as a list of absences: a new column added to `User`
      // later would slip past `expect("passwordHash" in row).toBe(false)` while `findMany` happily
      // returned it. 5.8 set this floor for a list of email addresses; this payload is wider and the
      // floor has to hold.
      expect(Object.keys(row!).sort()).toEqual(["email", "id", "memberships", "ownedTrips", "role"]);
      expect(JSON.stringify(payload)).not.toContain("token-hash");
      expect(JSON.stringify(payload)).not.toContain("hashed");
    });

    it("carries nothing but id and name per owned trip, and no owner id per membership", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const trip = await createTripFor(admin.id, "Admin Trip");
      const other = await createUser("other@example.com");
      const membership = await prisma.tripMember.create({
        data: { tripId: trip.id, userId: other.id, role: "VIEWER" },
      });

      const { payload } = await readUsers(await sessionFor(admin));
      const adminRow = payload.data?.users.find((user) => user.email === "admin@example.com");
      const otherRow = payload.data?.users.find((user) => user.email === "other@example.com");

      expect(Object.keys(adminRow!.ownedTrips[0]).sort()).toEqual(["id", "name"]);
      expect(Object.keys(otherRow!.memberships[0]).sort()).toEqual(["id", "role", "tripId", "tripName"]);
      expect(otherRow!.memberships[0].id).toBe(membership.id);
    });

    it("tells every caller not to store the response", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response } = await readUsers(await sessionFor(admin));

      // Same reasoning as `/api/users`: the body is every email address in the system, and a caller that
      // does not ask for `no-store` itself - a proxy, curl - has no other instruction.
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });
});
