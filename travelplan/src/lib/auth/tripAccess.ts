import { prisma } from "@/lib/db/prisma";

export type TripAccessRole = "owner" | "viewer" | "contributor";

export type TripAccess = {
  tripId: string;
  ownerUserId: string;
  accessRole: TripAccessRole;
};

export const canTripAccessRoleRead = (accessRole: TripAccessRole | null | undefined) => accessRole !== null && accessRole !== undefined;

export const canTripAccessRoleManageTrip = (accessRole: TripAccessRole | null | undefined) => accessRole === "owner";

export const canTripAccessRoleWrite = (accessRole: TripAccessRole | null | undefined) =>
  accessRole === "owner" || accessRole === "contributor";

const mapTripMemberRole = (role: "VIEWER" | "CONTRIBUTOR"): Exclude<TripAccessRole, "owner"> =>
  role === "VIEWER" ? "viewer" : "contributor";

export const getTripAccessForUser = async (userId: string, tripId: string): Promise<TripAccess | null> => {
  const trip = await prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      userId: true,
      members: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!trip) {
    return null;
  }

  if (trip.userId === userId) {
    return {
      tripId: trip.id,
      ownerUserId: trip.userId,
      accessRole: "owner",
    };
  }

  const membership = trip.members[0];
  if (!membership) {
    return null;
  }

  return {
    tripId: trip.id,
    ownerUserId: trip.userId,
    accessRole: mapTripMemberRole(membership.role),
  };
};

export const hasTripReadAccess = async (userId: string, tripId: string) => {
  const access = await getTripAccessForUser(userId, tripId);
  return canTripAccessRoleRead(access?.accessRole);
};

export const hasTripOwnerAccess = async (userId: string, tripId: string) => {
  const access = await getTripAccessForUser(userId, tripId);
  return canTripAccessRoleManageTrip(access?.accessRole);
};

export const hasTripOwnerOrContributorAccess = async (userId: string, tripId: string) => {
  const access = await getTripAccessForUser(userId, tripId);
  return canTripAccessRoleWrite(access?.accessRole);
};

/**
 * Whether the user owns at least one trip anywhere - the gate for the surfaces that are not scoped to
 * a single trip and so have no `tripId` to ask the predicates above about.
 *
 * Membership never satisfies it: a `TripMember` row is not `Trip.userId`, and a viewer or contributor
 * is exactly the caller this is meant to keep out. `User.role` is not consulted either - it defaults
 * to `OWNER` on every account, so gating on it would let everyone through.
 */
export const hasAnyOwnedTrip = async (userId: string) => {
  const ownedTrip = await prisma.trip.findFirst({
    where: { userId },
    select: { id: true },
  });

  return ownedTrip !== null;
};
