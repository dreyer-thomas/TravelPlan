import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, PATCH } from "@/app/api/admin/users/[userId]/route";
import { POST } from "@/app/api/admin/users/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

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
  // A day, so the cascade has something visible to have destroyed. `TripDay` cascades from `Trip`, and a
  // trip with no days would let the refusal look like it worked while proving nothing.
  await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-07-01T00:00:00.000Z"), dayIndex: 0 },
  });
  return trip;
};

const sessionFor = (user: { id: string; role: string }) => createSessionJwt({ sub: user.id, role: user.role });

const buildRequest = (
  method: "PATCH" | "DELETE" | "POST",
  { session, body, csrf = CSRF, url = "http://localhost/api/admin/users/target" }: {
    session?: string;
    body?: unknown;
    csrf?: string | null;
    url?: string;
  },
) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookies: string[] = [];
  if (csrf !== null) {
    headers["x-csrf-token"] = csrf;
    cookies.push(`csrf_token=${csrf}`);
  }
  if (session) cookies.push(`session=${session}`);
  if (cookies.length > 0) headers.cookie = cookies.join("; ");

  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

const context = (userId: string) => ({ params: Promise.resolve({ userId }) });

const patchRole = async (session: string | undefined, userId: string, body: unknown, csrf: string | null = CSRF) => {
  const response = await PATCH(buildRequest("PATCH", { session, body, csrf }), context(userId));
  return { response, payload: (await response.json()) as ApiEnvelope<{ role: string }> };
};

const deleteUser = async (session: string | undefined, userId: string, csrf: string | null = CSRF) => {
  const response = await DELETE(buildRequest("DELETE", { session, csrf }), context(userId));
  return {
    response,
    payload: (await response.json()) as ApiEnvelope<{ deleted: boolean }> & {
      error: { details?: { tripNames?: string[] } } | null;
    },
  };
};

describe("/api/admin/users/[userId]", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("POST /api/admin/users - create an account (AC4)", () => {
    const createAccount = async (session: string | undefined, body: unknown, csrf: string | null = CSRF) => {
      const response = await POST(
        buildRequest("POST", { session, body, csrf, url: "http://localhost/api/admin/users" }),
      );
      return { response, payload: (await response.json()) as ApiEnvelope<{ user: { id: string; email: string } }> };
    };

    it("creates the account with mustChangePassword set, so Story 5.2 still fires", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response, payload } = await createAccount(await sessionFor(admin), {
        email: "newcomer@example.com",
        temporaryPassword: "temporary-password",
      });

      expect(response.status).toBe(200);
      const created = await prisma.user.findUniqueOrThrow({ where: { email: "newcomer@example.com" } });
      expect(created.mustChangePassword).toBe(true);
      expect(payload.data?.user.email).toBe("newcomer@example.com");
    });

    it("hashes the temporary password rather than storing it", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      await createAccount(await sessionFor(admin), {
        email: "newcomer@example.com",
        temporaryPassword: "temporary-password",
      });

      const created = await prisma.user.findUniqueOrThrow({ where: { email: "newcomer@example.com" } });
      expect(created.passwordHash).not.toBe("temporary-password");
      expect(created.passwordHash.startsWith("$2")).toBe(true);
    });

    it("lower-cases the address the way every other entry point does", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      await createAccount(await sessionFor(admin), {
        email: "NewComer@Example.COM",
        temporaryPassword: "temporary-password",
      });

      expect(await prisma.user.findUnique({ where: { email: "newcomer@example.com" } })).not.toBeNull();
    });

    it("refuses a duplicate address", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      await createUser("taken@example.com");

      const { response, payload } = await createAccount(await sessionFor(admin), {
        email: "taken@example.com",
        temporaryPassword: "temporary-password",
      });

      expect(response.status).toBe(409);
      expect(payload.error?.code).toBe("email_exists");
    });

    it("refuses a temporary password that is too short", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response, payload } = await createAccount(await sessionFor(admin), {
        email: "newcomer@example.com",
        temporaryPassword: "short",
      });

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
      expect(await prisma.user.count()).toBe(1);
    });

    it("refuses a non-admin caller", async () => {
      const owner = await createUser("owner@example.com", "OWNER");
      await createTripFor(owner.id, "Owner Trip");

      const { response, payload } = await createAccount(await sessionFor(owner), {
        email: "newcomer@example.com",
        temporaryPassword: "temporary-password",
      });

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      expect(await prisma.user.count()).toBe(1);
    });

    it("refuses a request without a valid CSRF token", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response, payload } = await createAccount(
        await sessionFor(admin),
        { email: "newcomer@example.com", temporaryPassword: "temporary-password" },
        null,
      );

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("csrf_invalid");
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe("PATCH - grant and revoke ADMIN (AC8a)", () => {
    it("grants the role", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const target = await createUser("target@example.com", "OWNER");

      const { response, payload } = await patchRole(await sessionFor(admin), target.id, { isAdmin: true });

      expect(response.status).toBe(200);
      expect(payload.data?.role).toBe("ADMIN");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("ADMIN");
    });

    it("revokes the role", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const other = await createUser("other@example.com", "ADMIN");

      const { response, payload } = await patchRole(await sessionFor(admin), other.id, { isAdmin: false });

      expect(response.status).toBe(200);
      expect(payload.data?.role).toBe("OWNER");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe("OWNER");
    });

    /**
     * AC8, stated exactly: the rule is *at least one admin must remain*, **not** "you may not demote
     * yourself". These two cases are what tell those two rules apart, and they are the reason AC8 is
     * worded the way it is. An admin who has handed the role on may drop their own.
     */
    it("lets an admin drop their own role while a second admin exists", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      await createUser("second@example.com", "ADMIN");

      const { response } = await patchRole(await sessionFor(admin), admin.id, { isAdmin: false });

      expect(response.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("OWNER");
    });

    it("refuses the demotion that would leave zero admins", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response, payload } = await patchRole(await sessionFor(admin), admin.id, { isAdmin: false });

      expect(response.status).toBe(409);
      expect(payload.error?.code).toBe("last_admin");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
    });

    /**
     * Where the last-admin rule can and cannot be reached, written down so the guard is not mistaken for
     * covering more than it does.
     *
     * The caller must already be an admin to get here at all, so an admin always exists while the request
     * is being served. It follows that revoking somebody *else's* role can never bring the count to zero -
     * if the target is an admin and is not the caller, there were at least two. The only operation that
     * can empty the installation is therefore an admin demoting themselves, which is the case above.
     *
     * This is asserted rather than reasoned about in a comment alone, because it is what makes "at least
     * one admin must remain" hold without a self-demotion ban that AC8 explicitly does not want.
     */
    it("cannot empty the installation by revoking somebody else, whatever the order", async () => {
      const first = await createUser("first@example.com", "ADMIN");
      const second = await createUser("second@example.com", "ADMIN");

      // Each takes the role off the other, in sequence. The second attempt is made by an account that has
      // just lost its own role, so the gate refuses it - and one admin is left standing either way.
      await patchRole(await sessionFor(first), second.id, { isAdmin: false });
      await patchRole(await sessionFor(second), first.id, { isAdmin: false });

      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    });

    it("is a no-op rather than an error when granting to an existing admin", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const other = await createUser("other@example.com", "ADMIN");

      const { response } = await patchRole(await sessionFor(admin), other.id, { isAdmin: true });

      expect(response.status).toBe(200);
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(2);
    });

    it("refuses a non-admin caller (AC8a)", async () => {
      const owner = await createUser("owner@example.com", "OWNER");
      await createTripFor(owner.id, "Owner Trip");

      const { response, payload } = await patchRole(await sessionFor(owner), owner.id, { isAdmin: true });

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      // The refusal has to be the *write* not happening, not just the status code.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe("OWNER");
    });

    it("refuses an anonymous caller", async () => {
      const target = await createUser("target@example.com", "OWNER");

      const { response, payload } = await patchRole(undefined, target.id, { isAdmin: true });

      expect(response.status).toBe(401);
      expect(payload.error?.code).toBe("unauthorized");
    });

    it("refuses a request without a valid CSRF token", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const target = await createUser("target@example.com", "OWNER");

      const { response, payload } = await patchRole(await sessionFor(admin), target.id, { isAdmin: true }, null);

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("csrf_invalid");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("OWNER");
    });

    it("refuses a body that is not a boolean isAdmin", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const target = await createUser("target@example.com", "OWNER");

      const { response, payload } = await patchRole(await sessionFor(admin), target.id, { isAdmin: "yes" });

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
    });

    it("reports an unknown account as not found", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response, payload } = await patchRole(await sessionFor(admin), "no-such-user", { isAdmin: true });

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
    });
  });

  describe("DELETE - the cascade guard (AC7)", () => {
    /**
     * **The most important test in this story.**
     *
     * `Trip.user` is `onDelete: Cascade`, and `TripDay`, `DayPlanItem` and every image and payment table
     * cascade below it. So one `user.delete` on an account that owns trips takes an entire travel history
     * with it - Tommy's production trip is 41 days and around 150 photos hanging off exactly this key.
     * The refusal is what stands between an admin's click in a user list and all of it.
     *
     * The assertion is therefore not the status code but the trip and its day still being there
     * afterwards. A 409 with the rows already gone would pass a status-only check.
     */
    it("refuses to delete an account that owns trips, and destroys nothing", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com", "OWNER");
      const trip = await createTripFor(owner.id, "Norwegen 2027");

      const { response, payload } = await deleteUser(await sessionFor(admin), owner.id);

      expect(response.status).toBe(409);
      expect(payload.error?.code).toBe("owns_trips");
      expect(await prisma.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
      expect(await prisma.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
      expect(await prisma.tripDay.count({ where: { tripId: trip.id } })).toBe(1);
    });

    it("names the trips it is blocked by", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com", "OWNER");
      await createTripFor(owner.id, "Norwegen 2027");
      await createTripFor(owner.id, "Island 2028");

      const { payload } = await deleteUser(await sessionFor(admin), owner.id);

      // Named, not counted: "owns 2 trips" leaves the admin to go and find out which, and the whole point
      // of the message is that they can see what is in the way.
      expect(payload.error?.details?.tripNames).toEqual(
        expect.arrayContaining(["Norwegen 2027", "Island 2028"]),
      );
      expect(payload.error?.details?.tripNames).toHaveLength(2);
    });

    it("deletes an account that owns nothing, and takes its memberships with it", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const owner = await createUser("owner@example.com", "OWNER");
      const guest = await createUser("guest@example.com", "VIEWER");
      const trip = await createTripFor(owner.id, "Norwegen 2027");
      await prisma.tripMember.create({ data: { tripId: trip.id, userId: guest.id, role: "VIEWER" } });

      const { response } = await deleteUser(await sessionFor(admin), guest.id);

      expect(response.status).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
      expect(await prisma.tripMember.count({ where: { userId: guest.id } })).toBe(0);
      // And the trip the guest was a member of is untouched - a membership is a row about the account, not
      // a trip belonging to somebody else.
      expect(await prisma.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
      expect(await prisma.tripDay.count({ where: { tripId: trip.id } })).toBe(1);
    });

    it("takes the account's password-reset tokens with it", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const guest = await createUser("guest@example.com", "VIEWER");
      await prisma.passwordResetToken.create({
        data: { userId: guest.id, tokenHash: "hash", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
      });

      await deleteUser(await sessionFor(admin), guest.id);

      expect(await prisma.passwordResetToken.count({ where: { userId: guest.id } })).toBe(0);
    });

    /** AC8's second sentence: deleting one's own account from this surface is refused outright. */
    it("refuses an admin deleting their own account, even with a second admin present", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      await createUser("second@example.com", "ADMIN");

      const { response, payload } = await deleteUser(await sessionFor(admin), admin.id);

      expect(response.status).toBe(409);
      expect(payload.error?.code).toBe("self_delete");
      expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull();
    });

    /**
     * The deletion path cannot leave the installation with zero admins, and it is worth being precise
     * about *why*, because the reason is not a count check.
     *
     * A caller must be an admin to reach this route, and an admin may not delete their own account
     * (AC8). So any admin this route successfully deletes is somebody other than the caller, and the
     * caller is still an admin when it returns. The last-admin count guard in the repository is
     * therefore a belt that the current rules never need - it exists so that relaxing either the
     * self-delete refusal or the gate cannot quietly produce an installation nobody can administer,
     * which would need shell access and `admin:grant` to recover from.
     *
     * The assertion is the invariant itself rather than a status code, so it keeps holding whichever of
     * the two rules is what enforces it.
     */
    it("leaves an admin standing after deleting another admin", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const second = await createUser("second@example.com", "ADMIN");

      const { response, payload } = await deleteUser(await sessionFor(second), admin.id);

      expect(response.status).toBe(200);
      expect(payload.error).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: admin.id } })).toBeNull();
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    });

    it("cannot be used to empty the installation of admins", async () => {
      const first = await createUser("first@example.com", "ADMIN");
      const second = await createUser("second@example.com", "ADMIN");

      // Each deletes the other, in sequence. The second request comes from an account that no longer
      // exists, so the gate refuses it, and one admin survives.
      const firstSession = await sessionFor(first);
      const secondSession = await sessionFor(second);
      await deleteUser(firstSession, second.id);
      await deleteUser(secondSession, first.id);

      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    });

    it("refuses a non-admin caller", async () => {
      const owner = await createUser("owner@example.com", "OWNER");
      await createTripFor(owner.id, "Owner Trip");
      const guest = await createUser("guest@example.com", "VIEWER");

      const { response, payload } = await deleteUser(await sessionFor(owner), guest.id);

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("forbidden");
      expect(await prisma.user.findUnique({ where: { id: guest.id } })).not.toBeNull();
    });

    it("refuses an anonymous caller", async () => {
      const guest = await createUser("guest@example.com", "VIEWER");

      const { response, payload } = await deleteUser(undefined, guest.id);

      expect(response.status).toBe(401);
      expect(payload.error?.code).toBe("unauthorized");
      expect(await prisma.user.findUnique({ where: { id: guest.id } })).not.toBeNull();
    });

    it("refuses a request without a valid CSRF token", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");
      const guest = await createUser("guest@example.com", "VIEWER");

      const { response, payload } = await deleteUser(await sessionFor(admin), guest.id, null);

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("csrf_invalid");
      expect(await prisma.user.findUnique({ where: { id: guest.id } })).not.toBeNull();
    });

    it("reports an unknown account as not found", async () => {
      const admin = await createUser("admin@example.com", "ADMIN");

      const { response, payload } = await deleteUser(await sessionFor(admin), "no-such-user");

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
    });
  });
});

/**
 * Story 5.10 review: revoking from an account that is not an admin is a no-op.
 *
 * The write flattens to `OWNER`, so without the guard a `PATCH { isAdmin: false }` against a `VIEWER` - the
 * role the trip-share invite path assigns - rewrote a column the surface never showed and the caller never
 * asked about, and did it without passing the count guard, which only ran for an actual admin. This app's own
 * UI never sends it (it computes `user.role !== "ADMIN"`), but the route is reachable directly.
 */
describe("PATCH /api/admin/users/[userId] - revoking from an account that is not an admin", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("leaves a VIEWER's stored role untouched and reports the role it actually holds", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    const invitee = await createUser("invitee@example.com", "VIEWER");

    const { response, payload } = await patchRole(await sessionFor(admin), invitee.id, { isAdmin: false });

    expect(response.status).toBe(200);
    // Reports what is there, not the `OWNER` the write would have produced.
    expect(payload.data?.role).toBe("VIEWER");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } })).role).toBe("VIEWER");
  });

  it("leaves a plain OWNER alone, and the sole admin is still standing", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    const owner = await createUser("plain@example.com", "OWNER");

    const { response } = await patchRole(await sessionFor(admin), owner.id, { isAdmin: false });

    expect(response.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe("OWNER");
    // The invariant, asserted rather than a status code - the same way the other AC8 cases are written.
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });
});
