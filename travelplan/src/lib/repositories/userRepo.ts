import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/bcrypt";
import type { Prisma, UserRole } from "@/generated/prisma/client";

export type RegisteredUser = {
  id: string;
  email: string;
};

/**
 * Minimal Prisma surface this helper needs, so it can be handed either `prisma` or a `$transaction`
 * client. Typing it as the full `PrismaClient` would exclude the transaction client; typing it as the
 * transaction client would exclude `prisma`.
 */
type UserWriter = {
  user: {
    create: (args: {
      data: Prisma.UserUncheckedCreateInput;
      select: { id: true; email: true };
    }) => Promise<{ id: string; email: string }>;
  };
};

/**
 * Provisions one account on somebody else's behalf: a hashed temporary password and
 * `mustChangePassword`, so Story 5.2's forced change fires on the invitee's first sign-in.
 *
 * Extracted here by Story 5.10 from the second half of `createTripCollaboratorForOwner`
 * (`tripRepo.ts`), which Story 5.1 wrote. AC4 asks the administration surface to create accounts
 * "reusing the mechanism Story 5.1 built rather than a second one", and the two callers genuinely need
 * different shapes around it - the trip-share path creates an account *and* a `TripMember` row inside
 * one transaction, while an admin creates an account attached to no trip at all. What they share is
 * exactly this: normalise, hash, insert with the flag set. So that is what moved, and the differing
 * parts stayed where they were.
 *
 * `mustChangePassword: true` is the load-bearing line and is not a parameter. An account created by
 * somebody else always starts on a password that somebody else knows, and there is no caller for whom
 * that should not have to be changed.
 *
 * Takes its writer as an argument so the trip-share path can keep passing its transaction client - the
 * membership insert that follows it there must not commit without the account.
 */
export const createAccountWithTemporaryPassword = async (
  writer: UserWriter,
  { email, temporaryPassword, role }: { email: string; temporaryPassword: string; role: UserRole },
) => {
  const passwordHash = await hashPassword(temporaryPassword);

  return writer.user.create({
    data: {
      email: email.trim().toLowerCase(),
      passwordHash,
      role,
      mustChangePassword: true,
    },
    select: { id: true, email: true },
  });
};

/**
 * Every account in the system, in a fixed `email asc` order.
 *
 * No `where`: the list is deliberately not scoped to a trip, so the caller's own account and accounts
 * that own no trip are both in it. The explicit `select` is the privacy floor rather than a
 * performance tweak - a bare `findMany()` returns every scalar on `User`, `passwordHash` included,
 * and this is the one payload in the app that reaches outside the caller's own trip graph.
 */
export const listRegisteredUsers = async (): Promise<RegisteredUser[]> =>
  prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { email: "asc" },
  });
