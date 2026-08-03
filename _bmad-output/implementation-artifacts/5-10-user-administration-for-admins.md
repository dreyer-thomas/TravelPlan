---
authored_against: 8f419d2
---

# Story 5.10: User Administration for Admins

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the administrator of this installation,
I want one place to see every account, what each can reach, and to create, re-assign and remove accounts,
so that people who no longer travel with us stop having access and I do not have to reason about it from the database.

## Acceptance Criteria

1. **`ADMIN` is a real role.** `UserRole` gains a third value. The administration surface is reachable only by a user whose role is `ADMIN` — not by "owns a trip", which every self-registered account satisfies.
2. **The entry point is the hamburger menu**, visible only to an admin. Everyone else sees the menu exactly as it is today.
3. **Every account, with its reach.** The list shows each account by email and, per account, the trips it can reach and how: **owned** (`Trip.userId`) or **member** with role `VIEWER` / `CONTRIBUTOR` (`TripMember.role`). Ownership and membership are two different relations and must be shown as such, not merged into one word.
4. **Create an account.** The admin can add one by email, with a temporary password and `mustChangePassword` set, reusing the mechanism Story 5.1 built rather than a second one.
5. **Change a membership role.** An admin can switch a user between `VIEWER` and `CONTRIBUTOR` on a trip.
6. **Attach and detach.** An admin can add a user to a trip as a member and remove them from it. Detaching removes the membership; it never touches a trip the user *owns*.
7. **Deleting is refused while the user owns trips.** The attempt names the trips it is blocked by. Only an account owning nothing can be deleted.
8. **An admin cannot lock the installation out of itself.** The rule is *at least one admin must remain* — not "you may not demote yourself". An admin may hand the role on and drop their own, and another admin may take it from them; what is refused is the operation that would leave zero admins. Deleting one's own account from this surface is refused outright.
8a. **The role can be granted and revoked here.** An admin can make any account an admin and take it back, subject to AC8.
8b. **A fresh installation bootstraps itself.** On a system with **no accounts at all**, the first registration becomes `ADMIN`; every registration after that stays `OWNER` as today. This is decided in the same transaction as the insert, so two simultaneous first registrations cannot both win.
8c. **An existing installation is bootstrapped by hand.** `npm run admin:grant -- <email>` promotes a named account. It is the only path for a database that already has users — Tommy's production instance has accounts today, so the rule in AC8b will never fire there.
9. **The payload carries no more than the surface needs** — no password hashes, no session data, no reset tokens.
10. **Story 5.8's surface is resolved, not left dangling.** `/users` and the "Alle registrierten Benutzer ansehen" link in the share dialog exist today and are gated on *owning a trip*. Whether they stay, move behind `ADMIN` or are absorbed is decided and recorded — see Traps.

## Tasks / Subtasks

- [ ] **Task 1 — The role** (AC: 1)
  - [ ] Add `ADMIN` to `enum UserRole` in `prisma/schema.prisma`, which is `OWNER | VIEWER` today.
  - [ ] **Check whether a migration emits any DDL before writing one.** On SQLite Prisma has no native enum; Story 6.16 added two enum members and `prisma migrate diff` produced byte-identical output, so no migration was written. Verify the same here rather than assuming either way — `users.role` is a plain `TEXT` column, but confirm it carries no CHECK constraint.
  - [ ] **Two bootstrap paths, both required** (AC: 8b, 8c). After this lands nobody is `ADMIN`, so the surface ships unreachable unless both exist.
    - *Fresh system:* in `register/route.ts`, when the user table is empty the new account gets `ADMIN`. Do the count and the insert in **one transaction** — two simultaneous first registrations must not both be promoted. `role: "OWNER"` at `:61` is the line that becomes conditional.
    - *Existing system:* `scripts/grant-admin.ts` plus `"admin:grant"` in `package.json`, invoked as `npm run admin:grant -- <email>`. Go through Prisma rather than `sqlite3`: the deploy script deliberately avoids `sqlite3` because it may not be installed on the server, while Node and Prisma always are. Refuse loudly on an unknown email — a mistyped `UPDATE` changes zero rows and says nothing.
    - Write the exact command into the Dev Agent Record so the operator does not have to derive it.
  - [ ] `role` is carried in the session JWT (`createSessionJwt({ sub, role })`). An account promoted to admin while signed in holds a stale role until its next login — decide whether that matters and say so.

- [ ] **Task 2 — The gate** (AC: 1, 2, 8)
  - [ ] One predicate, used by the API and the menu alike. Do **not** reuse `hasAnyOwnedTrip` (added by 5.8) — it answers a different question, and reusing it here would hand this surface to every registered account.
  - [ ] `middleware.ts` already matches `/users` (added by 5.8). Extend rather than duplicate. **Note Story 8.2 renames this file to `proxy.ts`;** whichever lands second must read the other.
  - [ ] AC8 is a server-side rule, not a disabled button: refuse the demotion or deletion in the handler when it would leave zero admins, and refuse self-deletion. A UI that merely hides the option is not a guard.

- [ ] **Task 3 — What the list shows** (AC: 3, 9)
  - [ ] Two relations per user: `Trip.userId` (owned) and `TripMember` (`tripId`, `userId`, `role`). A user can own trip A and be a viewer on trip B; both must appear, labelled differently.
  - [ ] Owned trips are the reason a deletion is refused (AC7), so the list is also where the admin sees *why* before trying.
  - [ ] Select explicitly. `User` carries `passwordHash` and `mustChangePassword`; neither belongs on the wire. 5.8's spec already set a payload-minimisation floor — hold it.

- [ ] **Task 4 — The actions** (AC: 4, 5, 6, 7)
  - [ ] **Create:** `createTripCollaboratorForOwner` (`tripRepo.ts:2462`) already takes a `temporaryPassword`, finds an existing user or creates one, and sets up membership. Reuse the account-creating half; admin creation is not tied to a trip, so the shape differs — extract rather than copy.
  - [ ] **Role change / attach / detach:** `POST` and `DELETE` on `/api/trips/[id]/members` already do this for a trip owner. The admin needs the same operations without owning the trip, so the access predicate is what changes, not the logic.
  - [ ] **Delete:** count owned trips first and refuse with their names (AC7). See Trap 1 for why this is the most important line in the story.
  - [ ] Every mutation validates CSRF and the session, like its neighbours.

- [ ] **Task 5 — Where it lives** (AC: 2, 10)
  - [ ] The menu entry follows the rule Stories 6.19/6.20 established: a destination needing no trip context belongs in the global `HeaderMenu`, and this one needs none. `authMenu.ts` grew a `trips` entry in 6.20 — this is the same shape, additionally gated.
  - [ ] Decide 5.8's fate and record it. The link in `TripShareDialog` exists so an owner can check whether an invitee already has an account *before* inviting — a real need this story does not remove. Gating `/users` on `ADMIN` alone takes that away from every non-admin owner. Two defensible answers: keep 5.8's read-only list for trip owners and put the administration on top of it for admins (one page, two levels), or split them. Pick one; do not leave a link that 404s or forbids.

- [ ] **Task 6 — Tests** (AC: 1, 2, 3, 6, 7, 8, 9)
  - [ ] Route: an admin passes; an owner, a contributor and a viewer are all refused; anonymous is refused.
  - [ ] The listing shows owned and member trips distinctly, and the payload contains no `passwordHash`.
  - [ ] Deleting a user who owns a trip is refused and names it; deleting one who owns nothing succeeds and removes their memberships.
  - [ ] The last admin cannot be demoted or deleted; an admin cannot delete themselves. An admin *can* drop their own role while a second admin exists — AC8 is "one must remain", not "not yourself".
  - [ ] Granting and revoking `ADMIN` works and is refused for a non-admin caller (AC8a).
  - [ ] **The bootstrap, both halves** (AC: 8b, 8c): registering into an **empty** user table yields `ADMIN`; the next registration yields `OWNER`; and the promotion happens inside the insert's transaction, so the guard is on the table being empty rather than on a prior count.
  - [ ] `admin:grant` promotes a known email and fails loudly on an unknown one.
  - [ ] Detaching a member does not touch a trip the user owns.
  - [ ] Menu: the entry renders for an admin and for nobody else.
  - [ ] `npm test` green.

- [ ] **Task 7 — Manual check** (AC: 2, 7)
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [ ] Promote an account to `ADMIN` by hand, sign in, and confirm the menu entry appears — and that it does not for the viewer and contributor accounts.
  - [ ] Try to delete an account that owns a trip and read what comes back. **This is the check that matters**: confirm with `sqlite3` afterwards that the trip and its days still exist.
  - [ ] Create an account, sign in as it, and confirm the forced password change from Story 5.2 still fires.
  - [ ] Run `npm run admin:grant` against the throwaway copy and confirm it promotes — this is the exact command the operator will run on production, so it is worth having executed once before it is needed.
  - [ ] Empty the `users` table in the throwaway copy, register, and confirm that account comes out as `ADMIN` (AC8b). This path can never be exercised on production, where the table is not empty, so the test bed is the only place it is ever seen.

## Dev Notes

### What was asked

Tommy on 2026-08-03, after seeing what Story 5.8 shipped: *"Mir geht es ja auch darum, dass ich Nutzer wieder löschen kann, die wir nicht mehr brauchen. Dafür ist der Dialog zwar gut, aber irgendwie an der falschen Stelle und besitzt die Funktionen nicht. … Wir bauen dazu für den Admin eine Funktion in das Hamburgermenü für den Zugriff auf die Nutzerverwaltung. Dort sieht der alle Nutzer, kann neue anlegen und sieht auch welche Reisen dieser Nutzer mit welcher Rolle sehen kann. Das kann der Admin auch anpassen. Nutzer können von Reisen dort getrennt oder hinzugefügt werden und auch komplett gelöscht."*

Two decisions were taken with him before this was written: the admin is a **new `ADMIN` role** (over a boolean flag or "first registered user"), and deleting a user who owns trips is **refused** (over transferring or cascading).

### The two findings that shaped this story

**1. `OWNER` is not an admin marker.** `register/route.ts:61` sets `role: "OWNER"` for every self-registration. Story 5.8 approximated an admin with `hasAnyOwnedTrip`, which is the same population. A surface that deletes accounts cannot be gated on it — hence AC1.

**2. Deleting a user destroys their trips.**

```prisma
model Trip {
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

`TripDay` cascades from `Trip`, `DayPlanItem` from `TripDay`, and the image tables from those. So one delete removes an entire travel history with no further prompt. Tommy's production trip is 41 days and 150 photos and hangs off exactly this key. AC7 is the whole of the protection, and it is a server-side refusal rather than a confirmation dialog because a dialog is advice and a refusal is a rule.

### Ownership and membership are different things

`Trip.userId` says who owns it. `TripMember` says who else may see or edit it, with `role` in `VIEWER | CONTRIBUTOR`. They are separate relations, and the surface has to keep them separate: "detach from trip" is meaningful for a membership and meaningless for ownership, and it is ownership alone that blocks a deletion.

Note the collision of vocabulary: `UserRole.OWNER` (an account-level role, the default for anyone who registers) and "owner of a trip" (`Trip.userId`) are unrelated. Adding `ADMIN` to the same enum does not fix that, and the code should not pretend otherwise.

### Traps

**1. The cascade is the story's whole risk.** Everything else here is a listing and three mutations. AC7 is what stands between an admin's click in a user list and 150 photos.

**2. Do not gate on `hasAnyOwnedTrip`.** It exists, it is nearby, it compiles, and it is wrong — see finding 1.

**3. The first-registration promotion has an open window.** `register/route.ts` requires only CSRF — no invite token, no allowlist — so on a genuinely fresh deployment whoever reaches `/auth/register` first becomes the administrator. That is the standard first-run pattern and the window closes the moment the operator registers, but it is a real property of AC8b and belongs in the deployment note rather than being discovered later. It cannot affect an existing installation, where the table is never empty.

**3b. The promotion must be transactional.** "Count the users, then insert" is a race. Two requests can both read zero.

**4. Do not orphan Story 5.8.** The share dialog links to `/users`; if that becomes admin-only without a decision, an owner following the link gets a wall. AC10 exists so this is chosen rather than inherited.

**5. `middleware.ts` is being renamed.** Story 8.2 moves it to `proxy.ts` for the Next 16 deprecation. Both stories touch the same matcher.

**6. The role in the JWT is a snapshot.** Promoting or demoting someone does not change their live session.

### Testing

Vitest 3.2 + Testing Library, jsdom. `usersRoute.test.ts` and `registeredUsersList.test.tsx` exist from 5.8 and are the starting point; `tripMembersRoute.test.ts` covers the membership operations this story re-uses under a different gate. `i18nDictionaries.test.ts` enforces key parity for the new strings.

### Project Structure Notes

`prisma/schema.prisma` (the enum), `src/lib/auth/tripAccess.ts`, `src/lib/repositories/userRepo.ts`, `src/app/api/users/route.ts` and new sibling routes, `src/app/(routes)/users/page.tsx`, `src/components/features/users/`, `src/lib/navigation/authMenu.ts`, `src/components/HeaderMenu.tsx`, `src/middleware.ts`, both dictionaries. Possibly a migration — Task 1 says to check rather than assume.

### Sequencing

Supersedes the *placement* of Story 5.8 without undoing its code. Coordinate with **8.2** (`middleware.ts` → `proxy.ts`) and note that **6.20** established the header-menu convention this follows.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.10]
- [Source: travelplan/prisma/schema.prisma] — `UserRole`, and `Trip.user onDelete: Cascade`
- [Source: travelplan/src/app/api/auth/register/route.ts:61] — every registration is an `OWNER`
- [Source: travelplan/src/lib/repositories/tripRepo.ts:2462] — `createTripCollaboratorForOwner`, the account-creation half to reuse
- [Source: travelplan/src/app/api/trips/[id]/members/route.ts] — attach/detach/role, already built for a trip owner
- [Source: _bmad-output/implementation-artifacts/5-8-view-all-registered-system-users.md] — the surface this precises

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
