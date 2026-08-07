import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
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
 * The write-level gate for the routes Story 5.13 widened, returning the refusal to hand straight back
 * (`if (refusal) return refusal;`) or `null` to continue - `requireAdmin`'s shape in `adminAccess.ts`,
 * for the same reason: an `auth` module is the only place that knows *why* the caller was refused, so
 * it is the only place that can pick the status.
 *
 * The three `has…Access` predicates above cannot do this. They answer a bare `boolean`, which collapses
 * "no such trip", "not your trip" and "you are only a viewer" into one `false`, and the route then has
 * to guess. `getTripAccessForUser` already separates the first two from the third, so this is a thin
 * composition of it with `canTripAccessRoleWrite` rather than new access logic.
 *
 * The split matters because the two answers are different statements:
 *
 *   - **not a participant** -> `404 not_found`, keeping Story 8.3's convention. Someone with no
 *     relationship to the trip learns nothing about whether it exists.
 *   - **a participant in the wrong role** -> `403 forbidden`. She is looking at the trip, the day and
 *     the activity on her screen; the existence is not a secret being kept from her, and telling her
 *     the thing is not there is simply false. That answer is what made DW-182 read as a broken app
 *     rather than a permission rule - the report was "it always throws errors", not "it says I am not
 *     allowed". `adminAccess.ts:53-55` makes the same argument for the admin surface.
 *
 * Named for the **role floor** and not for a verb, because two of its call sites are reads that require
 * write-level role anyway: the bucket-list `GET` and the backup `export`.
 *
 * `notFoundMessage` is per call site so each route keeps the noun it already answered with ("Accommodation
 * not found", "Trip not found"); only the 403 branch is worded here, because it is the same statement
 * everywhere it is reached.
 */
export const refuseUnlessTripWriter = async (userId: string, tripId: string, notFoundMessage: string) => {
  const access = await getTripAccessForUser(userId, tripId);

  if (!access) {
    return fail(apiError("not_found", notFoundMessage), 404);
  }

  if (!canTripAccessRoleWrite(access.accessRole)) {
    return fail(apiError("forbidden", "Trip write access required"), 403);
  }

  return null;
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
