import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/trips/[id]/members/route";
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
  options?: { method?: string; session?: string; csrf?: string; body?: Record<string, unknown> },
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
    body: options?.body ? JSON.stringify(options.body) : undefined,
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
      collaborators: { email: string; role: string }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.data?.collaborators).toEqual([
      expect.objectContaining({
        email: "viewer@example.com",
        role: "contributor",
      }),
    ]);
  });
});
