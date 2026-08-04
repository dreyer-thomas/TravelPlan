import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { createAccountWithTemporaryPassword } from "@/lib/repositories/userRepo";

/**
 * The administration surface's data layer (Story 5.10).
 *
 * Everything here is deliberately **not** tenancy-scoped, which is the one way it differs from every
 * other repository in this app. `tripRepo`'s functions put `userId: ownerUserId` in the `where` clause so
 * that the query which finds a row is the same query that proves the caller owns it. An administrator
 * owns nothing by virtue of being an administrator, so that pattern cannot express what they may do; the
 * proof moved up to `requireAdmin` in the route, and it has to be there on every single one of these.
 */

export type AdminOwnedTrip = {
  id: string;
  name: string;
};

export type AdminMembership = {
  /** The `TripMember` row's id - what a detach or a role change acts on. */
  id: string;
  tripId: string;
  tripName: string;
  role: "VIEWER" | "CONTRIBUTOR";
};

export type AdminUserSummary = {
  id: string;
  email: string;
  role: "OWNER" | "VIEWER" | "ADMIN";
  /** `Trip.userId`. The reason a deletion is refused (AC7), so the list is where the admin sees why. */
  ownedTrips: AdminOwnedTrip[];
  /** `TripMember`. A different relation from the above, and shown as one. */
  memberships: AdminMembership[];
};

/**
 * Every account, with everything it can reach and how (AC3).
 *
 * Two relations per user, kept apart all the way to the wire: `trips` is the owned side (`Trip.userId`)
 * and `memberships` is `TripMember`. One account can hold both at once - own trip A and be a viewer on
 * trip B - and merging them into a single "trips" list would make "detach from trip" meaningful for a
 * trip the user owns, where it is not, and would hide the cause of AC7's deletion refusal.
 *
 * The `select` is exhaustive by intent (AC9), not for performance. `User` carries `passwordHash` and
 * `mustChangePassword`; a bare `findMany()` returns both. Neither belongs on the wire, and neither does
 * `preferredLanguage` or either timestamp - the surface shows an email, a role and a reach, so that is
 * what it gets. `role` is here because the grant and revoke actions need something to act on.
 */
export const listUsersForAdmin = async (): Promise<AdminUserSummary[]> => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      trips: {
        select: { id: true, name: true },
        orderBy: { startDate: "asc" },
      },
      memberships: {
        select: {
          id: true,
          role: true,
          trip: { select: { id: true, name: true } },
        },
        orderBy: { trip: { startDate: "asc" } },
      },
    },
    orderBy: { email: "asc" },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    ownedTrips: user.trips,
    // Flattened rather than passed through as `{ trip: { ... } }`: the client renders a trip name beside a
    // role, and a nested shape would make it walk two levels to say one thing.
    memberships: user.memberships.map((membership) => ({
      id: membership.id,
      tripId: membership.trip.id,
      tripName: membership.trip.name,
      role: membership.role,
    })),
  }));
};

export type AdminTripSummary = {
  id: string;
  name: string;
  ownerEmail: string;
};

/**
 * Every trip, for the picker that attaches a user to one.
 *
 * `ownerEmail` because trip names are not unique and two people may both have a "Norwegen 2027" - an
 * admin choosing a trip out of a flat list of names would have nothing to tell them apart by.
 */
export const listTripsForAdmin = async (): Promise<AdminTripSummary[]> => {
  const trips = await prisma.trip.findMany({
    select: {
      id: true,
      name: true,
      user: { select: { email: true } },
    },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
  });

  return trips.map((trip) => ({ id: trip.id, name: trip.name, ownerEmail: trip.user.email }));
};

export type CreateAdminUserResult =
  | { outcome: "created"; user: AdminUserSummary }
  | { outcome: "email_exists" };

/**
 * Creates an account by email with a temporary password and `mustChangePassword` (AC4).
 *
 * The account-creating mechanism is `createAccountWithTemporaryPassword`, extracted from Story 5.1's
 * `createTripCollaboratorForOwner` rather than reimplemented, so Story 5.2's forced first-login change
 * fires on an admin-created account exactly as it does on an invited one.
 *
 * `role: "OWNER"` - the same value `register/route.ts` gives a self-registration. An account created here
 * is attached to no trip, so `VIEWER` (what the invite path uses, where a `TripMember` row follows
 * immediately) would describe a relationship that does not exist. Nothing in the app branches on either
 * value in any case; `ADMIN` is the only `UserRole` that decides anything, and it is granted separately
 * and on purpose.
 *
 * The duplicate check is the `P2002` catch rather than a preceding `findUnique`, so two admins creating
 * the same address at once produce one account and one `email_exists` instead of a Prisma error escaping
 * as a 500.
 */
export const createUserForAdmin = async ({
  email,
  temporaryPassword,
}: {
  email: string;
  temporaryPassword: string;
}): Promise<CreateAdminUserResult> => {
  try {
    const created = await createAccountWithTemporaryPassword(prisma, {
      email,
      temporaryPassword,
      role: "OWNER",
    });

    return {
      outcome: "created",
      // A brand-new account reaches nothing, and saying so explicitly is cheaper and more honest than
      // re-reading a row whose two relations are empty by construction.
      user: { id: created.id, email: created.email, role: "OWNER", ownedTrips: [], memberships: [] },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { outcome: "email_exists" };
    }
    throw error;
  }
};

export type SetAdminRoleResult =
  // `VIEWER` is in here only because revoking from an account that is not an admin reports the role it
  // already had rather than writing one - see the no-op branch below. Nothing this operation *writes* is ever
  // `VIEWER`.
  | { outcome: "updated"; role: "OWNER" | "VIEWER" | "ADMIN" }
  | { outcome: "not_found" }
  | { outcome: "last_admin" };

/**
 * Grants or revokes `ADMIN` (AC8a), subject to the one rule in AC8: **at least one admin must remain.**
 *
 * That rule, and not "you may not demote yourself", is what is enforced - the difference is the whole
 * point of AC8. An admin may hand the role to somebody else and then drop their own; another admin may
 * take it from them. What is refused is only the operation that would leave the installation with zero
 * admins, which is the state nobody can recover from through the UI (it needs shell access and
 * `admin:grant`).
 *
 * The count and the write are in one transaction because "count the admins, then demote" is the same race
 * as Trap 3b's: two admins demoting each other simultaneously can both read two.
 */
export const setUserAdminRoleForAdmin = async ({
  userId,
  makeAdmin,
}: {
  userId: string;
  makeAdmin: boolean;
}): Promise<SetAdminRoleResult> =>
  prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!target) {
      return { outcome: "not_found" } satisfies SetAdminRoleResult;
    }

    if (!makeAdmin) {
      // Revoking from an account that is not an admin is a no-op, not a rewrite. The write below flattens to
      // `OWNER`, so without this a `PATCH { isAdmin: false }` against a `VIEWER` - the role the trip-share
      // invite path assigns - silently changed a column the surface never showed and the caller never asked
      // about, and did it without passing the count guard, which only ran for an actual admin. Unreachable
      // from this app's own UI, which computes `user.role !== "ADMIN"` and therefore only ever sends
      // `isAdmin: true` for a non-admin; reachable by anything speaking to the route directly. Harmless today
      // because nothing branches on `OWNER` versus `VIEWER` - and `ADMIN` becoming load-bearing is itself the
      // proof that "nothing branches on it" has a shelf life.
      if (target.role !== "ADMIN") {
        // Reports the role the row actually holds, not the `OWNER` the write would have produced - saying
        // `OWNER` while the column still reads `VIEWER` would trade a silent write for a silent lie.
        return { outcome: "updated", role: target.role } satisfies SetAdminRoleResult;
      }

      const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return { outcome: "last_admin" } satisfies SetAdminRoleResult;
      }
    }

    // `OWNER` on revocation, not the role the account held before it was promoted - that value is not
    // recorded anywhere, and `OWNER` is the app's default for "an account with no special standing".
    const role = makeAdmin ? "ADMIN" : "OWNER";
    await tx.user.update({ where: { id: userId }, data: { role } });

    return { outcome: "updated", role } satisfies SetAdminRoleResult;
  });

export type DeleteAdminUserResult =
  | { outcome: "deleted"; email: string }
  | { outcome: "not_found" }
  | { outcome: "owns_trips"; tripNames: string[] }
  | { outcome: "last_admin" };

/**
 * Deletes an account - but only one that owns nothing (AC7).
 *
 * **This refusal is the most important thing in the story.** `Trip.user` is declared
 * `onDelete: Cascade`; `TripDay` cascades from `Trip`, `DayPlanItem` from `TripDay`, and every image and
 * payment table from those. So a single `user.delete` on an account that owns trips silently removes an
 * entire travel history - for Tommy's production account, 41 days and around 150 photos - with no second
 * prompt and no way back short of a backup. Nothing else in this file can destroy anything.
 *
 * It is a server-side refusal rather than a confirmation dialog on purpose: a dialog is advice, and this
 * has to be a rule. The blocking trip names come back with it so the admin can see what is in the way
 * without having to go and look.
 *
 * The check and the delete share a transaction, so a trip created for this user between the two cannot
 * slip through the gap.
 *
 * `last_admin` is here as well as in the role change: deleting the only admin leaves zero admins just as
 * surely as demoting them. Self-deletion is refused one level up, in the route, because it is a fact
 * about the *caller* rather than about the row.
 */
export const deleteUserForAdmin = async ({ userId }: { userId: string }): Promise<DeleteAdminUserResult> =>
  prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        trips: { select: { name: true }, orderBy: { startDate: "asc" } },
      },
    });

    if (!target) {
      return { outcome: "not_found" } satisfies DeleteAdminUserResult;
    }

    if (target.trips.length > 0) {
      return {
        outcome: "owns_trips",
        tripNames: target.trips.map((trip) => trip.name),
      } satisfies DeleteAdminUserResult;
    }

    if (target.role === "ADMIN") {
      const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return { outcome: "last_admin" } satisfies DeleteAdminUserResult;
      }
    }

    // Reached only for an account owning no trips, so the cascade has no trip to walk. What it does still
    // take with it are this user's own `TripMember` rows and password-reset tokens, which is correct and
    // is what AC7's "removes their memberships" asks for - a membership is a row about the account, not a
    // trip belonging to somebody else.
    await tx.user.delete({ where: { id: userId } });

    return { outcome: "deleted", email: target.email } satisfies DeleteAdminUserResult;
  });

export type SetMembershipResult =
  | { outcome: "set"; membership: AdminMembership }
  | { outcome: "user_not_found" }
  | { outcome: "trip_not_found" }
  | { outcome: "owns_trip" };

/**
 * Attaches a user to a trip, or changes the role they already hold on it (AC5, AC6).
 *
 * One operation rather than two, because `TripMember` has a `@@unique([tripId, userId])` and so "add as
 * viewer" and "change to viewer" are the same row reached from two directions. `upsert` on that
 * compound key expresses it exactly, and makes the action idempotent - an admin clicking twice gets one
 * membership, not a conflict.
 *
 * `owns_trip` is refused rather than silently allowed: the trip's owner already has full access through
 * `Trip.userId`, and a `TripMember` row for them would be a second, weaker statement about the same
 * relationship that `getTripAccessForUser` would then have to arbitrate. `createTripCollaboratorForOwner`
 * refuses the same case as `owner_email`.
 */
export const setTripMembershipForAdmin = async ({
  userId,
  tripId,
  role,
}: {
  userId: string;
  tripId: string;
  role: "VIEWER" | "CONTRIBUTOR";
}): Promise<SetMembershipResult> =>
  prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return { outcome: "user_not_found" } satisfies SetMembershipResult;
    }

    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { id: true, name: true, userId: true } });
    if (!trip) {
      return { outcome: "trip_not_found" } satisfies SetMembershipResult;
    }

    if (trip.userId === userId) {
      return { outcome: "owns_trip" } satisfies SetMembershipResult;
    }

    const membership = await tx.tripMember.upsert({
      where: { tripId_userId: { tripId, userId } },
      create: { tripId, userId, role },
      update: { role },
      select: { id: true, role: true },
    });

    return {
      outcome: "set",
      membership: { id: membership.id, tripId: trip.id, tripName: trip.name, role: membership.role },
    } satisfies SetMembershipResult;
  });

export type RemoveMembershipResult = { outcome: "removed" } | { outcome: "missing" };

/**
 * Detaches a user from a trip (AC6).
 *
 * **Deletes the `TripMember` row and nothing else.** It cannot touch a trip the user owns, and that is a
 * property of the statement rather than a promise: the `where` names `trip_members` by its compound
 * unique key, and ownership is a column on `trips` that this delete never reaches. The same guarantee
 * Story 5.1 wrote into `deleteTripCollaboratorForOwner`, restated because the caller here has no tenancy
 * to be constrained by.
 *
 * A guarded `deleteMany` rather than `findFirst` then `delete`, so a concurrent duplicate removal reports
 * `missing` instead of throwing Prisma's `P2025` out into the route's 500 branch.
 */
export const removeTripMembershipForAdmin = async ({
  userId,
  tripId,
}: {
  userId: string;
  tripId: string;
}): Promise<RemoveMembershipResult> => {
  const removed = await prisma.tripMember.deleteMany({ where: { tripId, userId } });

  return removed.count > 0 ? { outcome: "removed" } : { outcome: "missing" };
};
