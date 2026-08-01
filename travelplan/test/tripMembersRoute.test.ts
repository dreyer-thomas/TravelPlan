import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/trips/[id]/members/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { verifyPassword } from "@/lib/auth/bcrypt";
import { getTripAccessForUser } from "@/lib/auth/tripAccess";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (
  tripId: string,
  options?: {
    method?: string;
    session?: string;
    csrf?: string;
    body?: Record<string, unknown>;
    /** Bypasses JSON serialization, so a handler's `invalid_json` branch can be reached. */
    rawBody?: string;
  },
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  if (options?.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }

  return new NextRequest(`http://localhost/api/trips/${tripId}/members`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.rawBody ?? (options?.body ? JSON.stringify(options.body) : undefined),
  });
};

describe("/api/trips/[id]/members", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lets the owner add a new viewer and returns collaborator data", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Owner Trip",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "viewer@example.com",
          role: "viewer",
          temporaryPassword: "TempPass123",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<{
      collaborator: { id: string; email: string; role: string };
      collaborators: { id: string; email: string; role: string }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.collaborator).toEqual(
      expect.objectContaining({
        email: "viewer@example.com",
        role: "viewer",
      }),
    );
    expect(payload.data?.collaborators).toEqual([
      expect.objectContaining({
        email: "viewer@example.com",
        role: "viewer",
      }),
    ]);
    expect(payload.data?.collaborator.id).toBe(payload.data?.collaborators[0]?.id);
    // The dialog renders a remove button on the row it just added, keyed on `id` from this payload.
    expect(Object.keys(payload.data?.collaborators[0] ?? {}).sort()).toEqual(["email", "id", "role"]);

    const user = await prisma.user.findUnique({ where: { email: "viewer@example.com" } });
    expect(user?.mustChangePassword).toBe(true);
    expect(await verifyPassword("TempPass123", user!.passwordHash)).toBe(true);
  });

  it("lets the owner link an existing account to another trip without changing credentials", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const existing = await prisma.user.create({
      data: {
        email: "existing@example.com",
        passwordHash: "old-hash",
        role: "VIEWER",
        mustChangePassword: false,
        preferredLanguage: "de",
      },
    });
    const originalTrip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Existing Membership Trip",
        startDate: new Date("2026-07-20T00:00:00.000Z"),
        endDate: new Date("2026-07-21T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: originalTrip.id,
        userId: existing.id,
        role: "VIEWER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Reuse Trip",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "existing@example.com",
          role: "contributor",
          temporaryPassword: "FreshPass123",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<{
      collaborator: { id: string; email: string; role: string };
      collaborators: { id: string; email: string; role: string }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.collaborator).toEqual(
      expect.objectContaining({
        email: "existing@example.com",
        role: "contributor",
      }),
    );
    expect(payload.data?.collaborators).toEqual([
      expect.objectContaining({
        email: "existing@example.com",
        role: "contributor",
      }),
    ]);

    const users = await prisma.user.findMany({ where: { email: "existing@example.com" } });
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(existing.id);
    expect(users[0].passwordHash).toBe("old-hash");
    expect(users[0].mustChangePassword).toBe(false);
    expect(users[0].preferredLanguage).toBe("de");
    expect(await prisma.tripMember.count({ where: { tripId: trip.id, userId: existing.id } })).toBe(1);
    await expect(getTripAccessForUser(existing.id, trip.id)).resolves.toEqual(
      expect.objectContaining({
        tripId: trip.id,
        accessRole: "contributor",
      }),
    );
  });

  it("returns conflict for a duplicate trip membership", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const collaborator = await prisma.user.create({
      data: {
        email: "viewer@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Conflict Trip",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-09-02T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: collaborator.id,
        role: "VIEWER",
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "viewer@example.com",
          role: "viewer",
          temporaryPassword: "TempPass123",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("trip_member_exists");
  });

  it("preserves owner-email protection as a distinct conflict", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Owner Guard Trip",
        startDate: new Date("2026-09-10T00:00:00.000Z"),
        endDate: new Date("2026-09-11T00:00:00.000Z"),
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "owner@example.com",
          role: "viewer",
          temporaryPassword: "TempPass123",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("trip_owner_email");
  });

  it("rejects non-owner collaborator provisioning attempts", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Protected Trip",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });
    const session = await createSessionJwt({ sub: other.id, role: other.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "viewer@example.com",
          role: "viewer",
          temporaryPassword: "TempPass123",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
  });

  it("keeps member management owner-only for contributors", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "members-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const contributor = await prisma.user.create({
      data: {
        email: "members-contributor@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Protected Members Trip",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: contributor.id,
        role: "CONTRIBUTOR",
      },
    });
    const session = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "viewer@example.com",
          role: "viewer",
          temporaryPassword: "TempPass123",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
  });

  it("returns validation errors for invalid email, role, and temporary password", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Validation Trip",
        startDate: new Date("2026-11-01T00:00:00.000Z"),
        endDate: new Date("2026-11-02T00:00:00.000Z"),
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "bad-email",
          role: "admin",
          temporaryPassword: "short",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("requires a temporary password when creating a brand-new account", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Missing Password Trip",
        startDate: new Date("2026-11-10T00:00:00.000Z"),
        endDate: new Date("2026-11-11T00:00:00.000Z"),
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await POST(
      buildRequest(trip.id, {
        method: "POST",
        session,
        csrf: "test-csrf-token",
        body: {
          email: "brand-new@example.com",
          role: "viewer",
          temporaryPassword: "",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(payload.error?.details).toEqual({
      fieldErrors: {
        temporaryPassword: ["Temporary password is required for new collaborator accounts"],
      },
    });
  });

  it("returns the current collaborator list for the owner", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const collaborator = await prisma.user.create({
      data: {
        email: "viewer@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Members Trip",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-02T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: collaborator.id,
        role: "CONTRIBUTOR",
      },
    });
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });

    const response = await GET(buildRequest(trip.id, { session }), {
      params: Promise.resolve({ id: trip.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<{
      owner: { email: string };
      collaborators: { email: string; role: string }[];
    }>;

    expect(response.status).toBe(200);
    // Key-set assertion: the owner row the dialog renders is only possible if `owner` ships with the list.
    expect(Object.keys(payload.data ?? {}).sort()).toEqual(["collaborators", "owner"]);
    expect(payload.data?.owner.email).toBe("owner@example.com");
    expect(payload.data?.collaborators).toEqual([
      expect.objectContaining({
        email: "viewer@example.com",
        role: "contributor",
      }),
    ]);
    // The remove action keys on `id`, so a collaborator without one is a broken row, not a cosmetic gap.
    expect(Object.keys(payload.data?.collaborators[0] ?? {}).sort()).toEqual(["email", "id", "role"]);
  });

  describe("DELETE", () => {
    const seedOwnerWithCollaborator = async (options?: { collaboratorEmail?: string }) => {
      const owner = await prisma.user.create({
        data: {
          email: "owner@example.com",
          passwordHash: "hashed",
          role: "OWNER",
        },
      });
      const collaborator = await prisma.user.create({
        data: {
          email: options?.collaboratorEmail ?? "viewer@example.com",
          passwordHash: "hashed",
          role: "VIEWER",
        },
      });
      const trip = await prisma.trip.create({
        data: {
          userId: owner.id,
          name: "Removal Trip",
          startDate: new Date("2026-12-01T00:00:00.000Z"),
          endDate: new Date("2026-12-02T00:00:00.000Z"),
        },
      });
      const membership = await prisma.tripMember.create({
        data: {
          tripId: trip.id,
          userId: collaborator.id,
          role: "CONTRIBUTOR",
        },
      });

      return { owner, collaborator, trip, membership };
    };

    it("lets the owner remove a collaborator and returns the shortened list", async () => {
      const { owner, collaborator, trip, membership } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          csrf: "test-csrf-token",
          body: { memberId: membership.id },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<{
        deleted: boolean;
        collaborators: { id: string; email: string; role: string }[];
      }>;

      expect(response.status).toBe(200);
      expect(payload.error).toBeNull();
      expect(payload.data?.deleted).toBe(true);
      expect(payload.data?.collaborators).toEqual([]);
      expect(await prisma.tripMember.findUnique({ where: { id: membership.id } })).toBeNull();

      // Revoking trip access must not delete the person's account.
      const account = await prisma.user.findUnique({ where: { id: collaborator.id } });
      expect(account?.email).toBe("viewer@example.com");
    });

    it("keeps removal owner-only for contributors", async () => {
      const { collaborator, trip, membership } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: collaborator.id, role: collaborator.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          csrf: "test-csrf-token",
          body: { memberId: membership.id },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
      expect(await prisma.tripMember.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });

    it("rejects unauthenticated removal attempts", async () => {
      const { trip, membership } = await seedOwnerWithCollaborator();

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          csrf: "test-csrf-token",
          body: { memberId: membership.id },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(401);
      expect(payload.error?.code).toBe("unauthorized");
      expect(await prisma.tripMember.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });

    it("rejects removal without a CSRF token", async () => {
      const { owner, trip, membership } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          body: { memberId: membership.id },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(403);
      expect(payload.error?.code).toBe("csrf_invalid");
      expect(await prisma.tripMember.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });

    it("returns not found for an unknown member id", async () => {
      const { owner, trip } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          csrf: "test-csrf-token",
          body: { memberId: "does-not-exist" },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
    });

    it("refuses to remove a membership that belongs to a different trip", async () => {
      const { owner, collaborator, trip } = await seedOwnerWithCollaborator();
      const otherTrip = await prisma.trip.create({
        data: {
          userId: owner.id,
          name: "Other Trip",
          startDate: new Date("2026-12-10T00:00:00.000Z"),
          endDate: new Date("2026-12-11T00:00:00.000Z"),
        },
      });
      const otherMembership = await prisma.tripMember.create({
        data: {
          tripId: otherTrip.id,
          userId: collaborator.id,
          role: "VIEWER",
        },
      });
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          csrf: "test-csrf-token",
          body: { memberId: otherMembership.id },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
      expect(await prisma.tripMember.findUnique({ where: { id: otherMembership.id } })).not.toBeNull();
    });

    it("refuses to remove a membership on a trip owned by somebody else", async () => {
      // The case above builds `otherTrip` under the same owner, so it only exercises the `tripId` half
      // of the delete's `where`. This one puts a different owner behind the membership id.
      const { owner, collaborator, trip } = await seedOwnerWithCollaborator();
      const foreignOwner = await prisma.user.create({
        data: {
          email: "foreign-owner@example.com",
          passwordHash: "hashed",
          role: "OWNER",
        },
      });
      const foreignTrip = await prisma.trip.create({
        data: {
          userId: foreignOwner.id,
          name: "Foreign Trip",
          startDate: new Date("2026-12-20T00:00:00.000Z"),
          endDate: new Date("2026-12-21T00:00:00.000Z"),
        },
      });
      const foreignMembership = await prisma.tripMember.create({
        data: {
          tripId: foreignTrip.id,
          userId: collaborator.id,
          role: "VIEWER",
        },
      });
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          csrf: "test-csrf-token",
          body: { memberId: foreignMembership.id },
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
      expect(await prisma.tripMember.findUnique({ where: { id: foreignMembership.id } })).not.toBeNull();
    });

    it("reports a repeated removal as not found rather than a server error", async () => {
      const { owner, trip, membership } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });
      const send = async () =>
        DELETE(
          buildRequest(trip.id, {
            method: "DELETE",
            session,
            csrf: "test-csrf-token",
            body: { memberId: membership.id },
          }),
          { params: Promise.resolve({ id: trip.id }) },
        );

      expect((await send()).status).toBe(200);

      const repeat = await send();
      const payload = (await repeat.json()) as ApiEnvelope<null>;

      expect(repeat.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
    });

    it("rejects a malformed removal body", async () => {
      const { owner, trip, membership } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      const response = await DELETE(
        buildRequest(trip.id, {
          method: "DELETE",
          session,
          csrf: "test-csrf-token",
          rawBody: "{ not json",
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("invalid_json");
      expect(await prisma.tripMember.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });

    it("rejects a removal with a missing or empty member id", async () => {
      const { owner, trip, membership } = await seedOwnerWithCollaborator();
      const session = await createSessionJwt({ sub: owner.id, role: owner.role });

      for (const body of [{}, { memberId: "" }, { memberId: "x".repeat(65) }]) {
        const response = await DELETE(
          buildRequest(trip.id, {
            method: "DELETE",
            session,
            csrf: "test-csrf-token",
            body,
          }),
          { params: Promise.resolve({ id: trip.id }) },
        );
        const payload = (await response.json()) as ApiEnvelope<null>;

        expect(response.status).toBe(400);
        expect(payload.error?.code).toBe("validation_error");
      }

      expect(await prisma.tripMember.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });
  });
});
