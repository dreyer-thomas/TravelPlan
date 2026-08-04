import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isAdminUser, requireAdmin } from "@/lib/auth/adminAccess";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const createUser = (email: string, role: "OWNER" | "VIEWER" | "ADMIN") =>
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

describe("admin access gate", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("isAdminUser", () => {
    it("is true for an ADMIN account", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      expect(await isAdminUser(admin.id)).toBe(true);
    });

    it.each(["OWNER", "VIEWER"] as const)("is false for a %s account", async (role) => {
      const user = await createUser("person@example.com", role);
      expect(await isAdminUser(user.id)).toBe(false);
    });

    /**
     * Trap 2, made a test rather than a comment. `hasAnyOwnedTrip` is nearby, it compiles, and it is
     * the wrong question: every self-registered account that has made a trip satisfies it, which is
     * the whole population this surface must keep out. An account that owns trips and is not an admin
     * has to come back false, or the gate has silently become 5.8's.
     */
    it("is false for an account that owns trips but is not an ADMIN", async () => {
      const owner = await createUser("owner@example.com", "OWNER");
      await createTripFor(owner.id, "Owner Trip");

      expect(await isAdminUser(owner.id)).toBe(false);
    });

    it("is false for an id that no longer exists", async () => {
      // A session outlives the account it names: the JWT is valid for 7 days and nothing revokes it
      // when an admin deletes somebody. A missing row must read as "not an admin", not throw.
      expect(await isAdminUser("deleted-user-id")).toBe(false);
    });
  });

  describe("requireAdmin", () => {
    it("admits an admin and hands back the session", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const session = await createSessionJwt({ sub: admin.id, role: admin.role });

      const result = await requireAdmin(buildRequest(session));

      expect(result.response).toBeNull();
      expect(result.session?.sub).toBe(admin.id);
    });

    it.each(["OWNER", "VIEWER"] as const)("refuses a %s account with forbidden", async (role) => {
      const user = await createUser("person@example.com", role);
      await createTripFor(user.id, "Their Trip");
      const session = await createSessionJwt({ sub: user.id, role: user.role });

      const result = await requireAdmin(buildRequest(session));

      expect(result.response?.status).toBe(403);
      expect(((await result.response!.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
      expect(result.session).toBeNull();
    });

    it("refuses an anonymous caller with unauthorized", async () => {
      const result = await requireAdmin(buildRequest());

      expect(result.response?.status).toBe(401);
      expect(((await result.response!.json()) as ApiEnvelope<null>).error?.code).toBe("unauthorized");
    });

    it("refuses a caller who still has to change their password", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const session = await createSessionJwt({ sub: admin.id, role: admin.role, mustChangePassword: true });

      const result = await requireAdmin(buildRequest(session));

      expect(result.response?.status).toBe(403);
      expect(((await result.response!.json()) as ApiEnvelope<null>).error?.code).toBe("password_change_required");
    });

    /**
     * Trap 6, answered rather than accepted. `role` is carried in the session JWT, which lasts 7 days,
     * so a token is a *snapshot* of what the account was when it signed in. The gate therefore takes
     * only the identity (`sub`) from the token and re-reads the role from the database on every
     * request. These two cases are the ones that decide it: a token minted before the promotion must
     * still admit, and - the one that matters on a surface that deletes accounts - a token minted
     * while the caller *was* an admin must stop admitting the moment the role is taken away.
     */
    it("admits on a live promotion, even though the token predates it", async () => {
      const user = await createUser("promoted@example.com", "OWNER");
      const staleSession = await createSessionJwt({ sub: user.id, role: "OWNER" });

      await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

      expect((await requireAdmin(buildRequest(staleSession))).response).toBeNull();
    });

    it("refuses on a live revocation, even though the token still says ADMIN", async () => {
      const user = await createUser("demoted@example.com", "ADMIN");
      const staleSession = await createSessionJwt({ sub: user.id, role: "ADMIN" });

      await prisma.user.update({ where: { id: user.id }, data: { role: "OWNER" } });

      const result = await requireAdmin(buildRequest(staleSession));
      expect(result.response?.status).toBe(403);
      expect(((await result.response!.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    });

    it("refuses a session whose account has been deleted", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const session = await createSessionJwt({ sub: admin.id, role: "ADMIN" });
      await prisma.user.delete({ where: { id: admin.id } });

      expect((await requireAdmin(buildRequest(session))).response?.status).toBe(403);
    });
  });
});
