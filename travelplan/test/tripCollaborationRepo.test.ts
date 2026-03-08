import { beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/auth/bcrypt";
import { prisma } from "@/lib/db/prisma";
import {
  createTripCollaboratorForOwner,
  getTripAccessForUser,
  listTripCollaboratorsForOwner,
} from "@/lib/repositories/tripRepo";

describe("trip collaboration repository", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates a new collaborator account, membership, and password-change flag", async () => {
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
        name: "Collaboration Trip",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
      },
    });

    const result = await createTripCollaboratorForOwner({
      ownerUserId: owner.id,
      tripId: trip.id,
      email: " Viewer@example.com ",
      role: "viewer",
      temporaryPassword: "TempPass123",
    });

    expect(result.outcome).toBe("created");
    expect(result.collaborator).toEqual(
      expect.objectContaining({
        email: "viewer@example.com",
        role: "viewer",
      }),
    );
    expect(result.collaborator.id).toBe(result.collaborators[0]?.id);

    const user = await prisma.user.findUnique({
      where: { email: "viewer@example.com" },
    });
    expect(user?.mustChangePassword).toBe(true);
    expect(user?.role).toBe("VIEWER");
    expect(await verifyPassword("TempPass123", user!.passwordHash)).toBe(true);

    const membership = await prisma.tripMember.findUnique({
      where: {
        tripId_userId: {
          tripId: trip.id,
          userId: user!.id,
        },
      },
    });
    expect(membership?.role).toBe("VIEWER");

    const collaborators = await listTripCollaboratorsForOwner(owner.id, trip.id);
    expect(collaborators).toEqual([
      expect.objectContaining({
        email: "viewer@example.com",
        role: "viewer",
      }),
    ]);
  });

  it("rejects existing accounts instead of overwriting their password", async () => {
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

    const result = await createTripCollaboratorForOwner({
      ownerUserId: owner.id,
      tripId: trip.id,
      email: "existing@example.com",
      role: "contributor",
      temporaryPassword: "FreshPass123",
    });

    expect(result).toEqual({
      outcome: "conflict",
      reason: "existing_account",
    });

    const users = await prisma.user.findMany({
      where: {
        email: "existing@example.com",
      },
    });
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(existing.id);
    expect(users[0].mustChangePassword).toBe(false);
    expect(users[0].passwordHash).toBe("old-hash");
    expect(await prisma.tripMember.count({ where: { tripId: trip.id, userId: existing.id } })).toBe(0);
  });

  it("returns conflict when the user is already linked to the trip", async () => {
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

    const result = await createTripCollaboratorForOwner({
      ownerUserId: owner.id,
      tripId: trip.id,
      email: "viewer@example.com",
      role: "viewer",
      temporaryPassword: "TempPass123",
    });

    expect(result.outcome).toBe("conflict");

    const membershipCount = await prisma.tripMember.count({
      where: {
        tripId: trip.id,
        userId: collaborator.id,
      },
    });
    expect(membershipCount).toBe(1);
  });

  it("resolves owner and collaborator trip access without regressing owner reads", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const collaborator = await prisma.user.create({
      data: {
        email: "collaborator@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Access Trip",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: collaborator.id,
        role: "CONTRIBUTOR",
      },
    });

    await expect(getTripAccessForUser(owner.id, trip.id)).resolves.toEqual(
      expect.objectContaining({
        tripId: trip.id,
        accessRole: "owner",
      }),
    );
    await expect(getTripAccessForUser(collaborator.id, trip.id)).resolves.toEqual(
      expect.objectContaining({
        tripId: trip.id,
        accessRole: "contributor",
      }),
    );
  });
});
