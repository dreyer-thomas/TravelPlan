/**
 * The trip access role and the three predicates that read it, with **no `prisma` import** - which is
 * the whole reason this file exists separately from `tripAccess.ts`. That module reaches the database
 * to answer `getTripAccessForUser`, so importing it from a `"use client"` component would pull the
 * Prisma client into the browser bundle. The client components therefore used to re-declare the three
 * role literals inline and hand-write the test against them, and that is where DW-243's fail-open
 * flags came from: a re-declared union has no single definition to add a fourth member to, so a
 * widened role silently keeps compiling at every consumer while the hand-written tests quietly grant
 * whatever they do not recognise.
 *
 * With one definition here, the predicates below are the *only* statement of what each role may do -
 * server routes and client components read the same function rather than two expressions kept in step
 * by review - and a fourth role has one place to be added and three predicates to be answered in.
 *
 * Be exact about what that does and does not buy, because the looser claim is tempting and false:
 * nothing in this app *exhausts* the union (no `switch` with a `never` arm, no `Record<TripAccessRole,
 * …>`), so adding a member here is **not** a compile error at the consumers - it is denied everywhere
 * by the positive equality below until someone grants it. Denied-by-default is the property being
 * bought; a compiler error is not. The one place a widened role *is* a compile error is
 * `mapTripMemberRole`'s closed parameter, which is DW-237's signal and is described at that function.
 */
export type TripAccessRole = "owner" | "viewer" | "contributor";

/**
 * Positive equality against all three roles rather than the `!= null` check this used to be. The old
 * spelling was a null-check wearing an authorization predicate's name: it answered `true` for any
 * non-null value, so a role outside the union - the exact input its two siblings below are careful to
 * deny - passed the read gate on uploads, day packets and route previews. That is the fail-open shape
 * DW-243 removed from the client flags, one level up, and this is it removed here too.
 */
export const canTripAccessRoleRead = (accessRole: TripAccessRole | null | undefined) =>
  accessRole === "owner" || accessRole === "contributor" || accessRole === "viewer";

export const canTripAccessRoleManageTrip = (accessRole: TripAccessRole | null | undefined) => accessRole === "owner";

export const canTripAccessRoleWrite = (accessRole: TripAccessRole | null | undefined) =>
  accessRole === "owner" || accessRole === "contributor";

/**
 * `TripMember.role` as this app's access role. Two properties of this one line are load-bearing and
 * neither is obvious:
 *
 *   - The parameter stays the **closed** `"VIEWER" | "CONTRIBUTOR"` union rather than widening to
 *     `string` or to the generated `TripMemberRole`. That is what makes adding a third member role to
 *     the schema a compile error at every call site instead of a silent mapping (DW-237). Widening it
 *     would buy nothing and cost exactly that signal.
 *   - The body tests for `CONTRIBUTOR` and falls back to `viewer`, not the other way round. Both arms
 *     are reachable for the same two inputs, so the choice only shows itself for a row holding a value
 *     outside the union - a role added to the database ahead of this code, or a hand-edited row. The
 *     old `role === "VIEWER" ? "viewer" : "contributor"` handed that row the *more* privileged answer
 *     (DW-243). Least privilege belongs in the default arm, so an unrecognised value reads.
 */
export const mapTripMemberRole = (role: "VIEWER" | "CONTRIBUTOR"): Exclude<TripAccessRole, "owner"> =>
  role === "CONTRIBUTOR" ? "contributor" : "viewer";

/**
 * The one derivation of "what may this user do with this trip?" from a row already loaded with its own
 * membership - the shape all three trip reads select.
 *
 * It exists because that rule used to be stated three times: `listTripsForUser` dropped a non-owned row
 * with no membership, `getTripWithDaysForUser` served that same trip as a `viewer`, and
 * `getTripAccessForUser` - the gate every write goes through - answered `null`. Two of those three
 * cannot both be right, and the disagreement handed a just-removed collaborator the entire trip: every
 * day, stay, plan item and cost, on a screen the list would no longer show her a row for (DW-239).
 *
 * `null` is "no access at all", not "the least access": the detail read turns it into the route's
 * existing 404, the list read drops the row, and `getTripAccessForUser` returns it unchanged.
 *
 * It lives here rather than in `tripRepo.ts` because it touches no database - it reads a row someone
 * else already fetched - and a repository is the one module `tripAccess.ts` must not depend on.
 *
 * `members` carries `userId` and is matched on it rather than trusting `members[0]`. Every caller
 * already narrows the relation with `where: { userId }, take: 1`, so the match is a formality today;
 * the point is that a caller who forgets would otherwise derive this user's access from somebody
 * else's membership row, and no signature could have told them. A precondition a function can check is
 * better than one its docstring asserts.
 */
export const deriveTripAccessRole = (
  userId: string,
  trip: { userId: string; members: { userId: string; role: "VIEWER" | "CONTRIBUTOR" }[] },
): TripAccessRole | null => {
  if (trip.userId === userId) {
    return "owner";
  }

  const membership = trip.members.find((member) => member.userId === userId);
  return membership ? mapTripMemberRole(membership.role) : null;
};
