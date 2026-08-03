import { prisma } from "@/lib/db/prisma";

export type RegisteredUser = {
  id: string;
  email: string;
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
