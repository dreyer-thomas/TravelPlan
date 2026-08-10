import { describe, expect, it } from "vitest";
import {
  canTripAccessRoleManageTrip,
  canTripAccessRoleRead,
  canTripAccessRoleWrite,
  deriveTripAccessRole,
  mapTripMemberRole,
  type TripAccessRole,
} from "@/lib/auth/tripAccessRole";

/**
 * The two pure functions every trip read now derives its access role through, tested directly because
 * the cases that matter most are the ones no route or component test can reach: a membership row
 * holding a value outside the union, and a payload with no role at all. Both used to resolve to the
 * *more* privileged answer (DW-243), and neither has a fixture in an integration suite - Prisma will
 * not write an unrecognised enum, and the repository never emitted an absent role.
 */
describe("mapTripMemberRole", () => {
  it("maps the two roles the schema defines", () => {
    expect(mapTripMemberRole("CONTRIBUTOR")).toBe("contributor");
    expect(mapTripMemberRole("VIEWER")).toBe("viewer");
  });

  it("reads anything it does not recognise as a viewer", () => {
    // The cast is the point of the case, not a convenience: the parameter is deliberately the closed
    // `"VIEWER" | "CONTRIBUTOR"` union so that widening `TripMemberRole` is a compile error at the call
    // site (DW-237), which means the only way to reach the default arm with a third value is to force
    // one in. A row can still hold one - a migration applied ahead of a deploy, or a hand-edited
    // database - and this pins that such a row reads rather than writes.
    expect(mapTripMemberRole("ADMIN" as "VIEWER" | "CONTRIBUTOR")).toBe("viewer");
    expect(mapTripMemberRole("" as "VIEWER" | "CONTRIBUTOR")).toBe("viewer");
  });
});

describe("canTripAccessRole predicates", () => {
  it("grants nothing for an absent or null role", () => {
    // The client flags are these three functions now, so "no role" has to deny at this level - the
    // components no longer hold a test of their own that could disagree.
    for (const role of [undefined, null] as const) {
      expect(canTripAccessRoleRead(role)).toBe(false);
      expect(canTripAccessRoleWrite(role)).toBe(false);
      expect(canTripAccessRoleManageTrip(role)).toBe(false);
    }
  });

  it("grants nothing for a role outside the union", () => {
    // The I/O case the change is named for, and the one that caught `canTripAccessRoleRead` being a
    // bare `!= null` check: it answered `true` for any non-null value, where its two siblings are
    // careful to deny one. Do not overstate what that was worth - it was never reachable, and saying
    // otherwise would have the next reader hunting a hole that is not there: the predicate's only
    // producer is `getTripAccessForUser`, whose role now comes from `deriveTripAccessRole` and is a
    // union member or `null`. This pins the shape rather than closing a live gap, which is also why
    // it takes a cast to reach: the union is closed on purpose, so nothing else in the suite could
    // have found it.
    for (const role of ["admin", "OWNER", ""] as unknown as TripAccessRole[]) {
      expect(canTripAccessRoleRead(role)).toBe(false);
      expect(canTripAccessRoleWrite(role)).toBe(false);
      expect(canTripAccessRoleManageTrip(role)).toBe(false);
    }
  });

  it("keeps the three roles' existing answers", () => {
    expect([canTripAccessRoleRead("owner"), canTripAccessRoleWrite("owner"), canTripAccessRoleManageTrip("owner")]).toEqual([
      true,
      true,
      true,
    ]);
    expect([
      canTripAccessRoleRead("contributor"),
      canTripAccessRoleWrite("contributor"),
      canTripAccessRoleManageTrip("contributor"),
    ]).toEqual([true, true, false]);
    expect([canTripAccessRoleRead("viewer"), canTripAccessRoleWrite("viewer"), canTripAccessRoleManageTrip("viewer")]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("deriveTripAccessRole", () => {
  it("answers owner from the trip's own `userId`, whatever the membership list holds", () => {
    // Ownership wins outright: an owner who is also carried as a `VIEWER` member - which the share
    // flow does not create, but nothing in the schema forbids - must not be demoted by the row.
    expect(deriveTripAccessRole("u1", { userId: "u1", members: [] })).toBe("owner");
    expect(deriveTripAccessRole("u1", { userId: "u1", members: [{ userId: "u2", role: "VIEWER" }] })).toBe("owner");
  });

  it("answers the mapped member role for a non-owner with a membership row", () => {
    expect(deriveTripAccessRole("u2", { userId: "u1", members: [{ userId: "u2", role: "CONTRIBUTOR" }] })).toBe("contributor");
    expect(deriveTripAccessRole("u2", { userId: "u1", members: [{ userId: "u2", role: "VIEWER" }] })).toBe("viewer");
  });

  it("answers null - no access at all - for a non-owner with no membership row", () => {
    // The state a revoked collaborator arrives in, and the whole reason this helper exists.
    // `getTripWithDaysForUser` used to read it as `viewer` and serve the trip in full while
    // `listTripsForUser` dropped the same row; `null` is what makes both reads say the one thing
    // `getTripAccessForUser` says.
    expect(deriveTripAccessRole("u2", { userId: "u1", members: [] })).toBeNull();
  });

  it("ignores a membership row belonging to somebody else", () => {
    // Every caller narrows the relation with `where: { userId }`, so this list cannot arrive today -
    // which is the reason to pin it. A caller who forgets that `where` would otherwise be handed
    // another collaborator's role for their own, and the `members[0]` this replaced would have taken
    // it without a word.
    expect(deriveTripAccessRole("u2", { userId: "u1", members: [{ userId: "u3", role: "CONTRIBUTOR" }] })).toBeNull();
  });
});
