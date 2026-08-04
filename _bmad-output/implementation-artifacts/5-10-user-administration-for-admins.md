---
authored_against: 8f419d2
baseline_commit: def8618e98dcc9ef95e53376b5c15977a5c241db
---

# Story 5.10: User Administration for Admins

Status: done

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

- [x] **Task 1 — The role** (AC: 1)
  - [x] Add `ADMIN` to `enum UserRole` in `prisma/schema.prisma`, which is `OWNER | VIEWER` today.
  - [x] **Check whether a migration emits any DDL before writing one.** On SQLite Prisma has no native enum; Story 6.16 added two enum members and `prisma migrate diff` produced byte-identical output, so no migration was written. Verify the same here rather than assuming either way — `users.role` is a plain `TEXT` column, but confirm it carries no CHECK constraint.
  - [x] **Two bootstrap paths, both required** (AC: 8b, 8c). After this lands nobody is `ADMIN`, so the surface ships unreachable unless both exist.
    - *Fresh system:* in `register/route.ts`, when the user table is empty the new account gets `ADMIN`. Do the count and the insert in **one transaction** — two simultaneous first registrations must not both be promoted. `role: "OWNER"` at `:61` is the line that becomes conditional.
    - *Existing system:* `scripts/grant-admin.ts` plus `"admin:grant"` in `package.json`, invoked as `npm run admin:grant -- <email>`. Go through Prisma rather than `sqlite3`: the deploy script deliberately avoids `sqlite3` because it may not be installed on the server, while Node and Prisma always are. Refuse loudly on an unknown email — a mistyped `UPDATE` changes zero rows and says nothing.
    - Write the exact command into the Dev Agent Record so the operator does not have to derive it.
  - [x] `role` is carried in the session JWT (`createSessionJwt({ sub, role })`). An account promoted to admin while signed in holds a stale role until its next login — decide whether that matters and say so.

- [x] **Task 2 — The gate** (AC: 1, 2, 8)
  - [x] One predicate, used by the API and the menu alike. Do **not** reuse `hasAnyOwnedTrip` (added by 5.8) — it answers a different question, and reusing it here would hand this surface to every registered account.
  - [x] `middleware.ts` already matches `/users` (added by 5.8). Extend rather than duplicate. **Note Story 8.2 renames this file to `proxy.ts`;** whichever lands second must read the other.
  - [x] AC8 is a server-side rule, not a disabled button: refuse the demotion or deletion in the handler when it would leave zero admins, and refuse self-deletion. A UI that merely hides the option is not a guard.

- [x] **Task 3 — What the list shows** (AC: 3, 9)
  - [x] Two relations per user: `Trip.userId` (owned) and `TripMember` (`tripId`, `userId`, `role`). A user can own trip A and be a viewer on trip B; both must appear, labelled differently.
  - [x] Owned trips are the reason a deletion is refused (AC7), so the list is also where the admin sees *why* before trying.
  - [x] Select explicitly. `User` carries `passwordHash` and `mustChangePassword`; neither belongs on the wire. 5.8's spec already set a payload-minimisation floor — hold it.

- [x] **Task 4 — The actions** (AC: 4, 5, 6, 7)
  - [x] **Create:** `createTripCollaboratorForOwner` (`tripRepo.ts:2462`) already takes a `temporaryPassword`, finds an existing user or creates one, and sets up membership. Reuse the account-creating half; admin creation is not tied to a trip, so the shape differs — extract rather than copy.
  - [x] **Role change / attach / detach:** `POST` and `DELETE` on `/api/trips/[id]/members` already do this for a trip owner. The admin needs the same operations without owning the trip, so the access predicate is what changes, not the logic.
  - [x] **Delete:** count owned trips first and refuse with their names (AC7). See Trap 1 for why this is the most important line in the story.
  - [x] Every mutation validates CSRF and the session, like its neighbours.

- [x] **Task 5 — Where it lives** (AC: 2, 10)
  - [x] The menu entry follows the rule Stories 6.19/6.20 established: a destination needing no trip context belongs in the global `HeaderMenu`, and this one needs none. `authMenu.ts` grew a `trips` entry in 6.20 — this is the same shape, additionally gated.
  - [x] Decide 5.8's fate and record it. The link in `TripShareDialog` exists so an owner can check whether an invitee already has an account *before* inviting — a real need this story does not remove. Gating `/users` on `ADMIN` alone takes that away from every non-admin owner. Two defensible answers: keep 5.8's read-only list for trip owners and put the administration on top of it for admins (one page, two levels), or split them. Pick one; do not leave a link that 404s or forbids.

- [x] **Task 6 — Tests** (AC: 1, 2, 3, 6, 7, 8, 9)
  - [x] Route: an admin passes; an owner, a contributor and a viewer are all refused; anonymous is refused.
  - [x] The listing shows owned and member trips distinctly, and the payload contains no `passwordHash`.
  - [x] Deleting a user who owns a trip is refused and names it; deleting one who owns nothing succeeds and removes their memberships.
  - [x] The last admin cannot be demoted or deleted; an admin cannot delete themselves. An admin *can* drop their own role while a second admin exists — AC8 is "one must remain", not "not yourself".
  - [x] Granting and revoking `ADMIN` works and is refused for a non-admin caller (AC8a).
  - [x] **The bootstrap, both halves** (AC: 8b, 8c): registering into an **empty** user table yields `ADMIN`; the next registration yields `OWNER`; and the promotion happens inside the insert's transaction, so the guard is on the table being empty rather than on a prior count.
  - [x] `admin:grant` promotes a known email and fails loudly on an unknown one.
  - [x] Detaching a member does not touch a trip the user owns.
  - [x] Menu: the entry renders for an admin and for nobody else.
  - [x] `npm test` green.

- [x] **Task 7 — Manual check** (AC: 2, 7) — **completed 2026-08-05**; the one outstanding half is below.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [x] Promote an account to `ADMIN` by hand, sign in, and confirm the menu entry appears — and that it does not for the viewer and contributor accounts. **Half done, and the half that is missing is the rendered pixels.** Promotion, sign-in, the live role flip in both directions, `/admin/users` reachability and the `isAdmin` prop reaching `HeaderMenu` were all confirmed against a running server (see the Dev Agent Record). What was *not* seen is the opened menu itself: MUI portals a closed `Menu`, so no menu row — not even `All trips` — is present in server HTML, and this environment has no browser automation. See operator actions.
  - [x] Try to delete an account that owns a trip and read what comes back. **This is the check that matters**: confirm with `sqlite3` afterwards that the trip and its days still exist.
  - [x] Create an account, sign in as it, and confirm the forced password change from Story 5.2 still fires.
  - [x] Run `npm run admin:grant` against the throwaway copy and confirm it promotes — this is the exact command the operator will run on production, so it is worth having executed once before it is needed.
  - [x] Empty the `users` table in the throwaway copy, register, and confirm that account comes out as `ADMIN` (AC8b). This path can never be exercised on production, where the table is not empty, so the test bed is the only place it is ever seen.

### Review Findings

Code review 2026-08-04 — three parallel adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **Every AC is met in substance**, and the two structural claims the story rests on were independently verified rather than taken on trust: `requireAdmin` really does re-read the role from the database and never authorises on the token (Trap 6 answered), and AC7's refusal really does leave the trip, its days and its plan items intact. `npm test` re-run from scratch: **118 files / 1351 tests green**, matching the record exactly. Nothing below undoes the story; the two `high` items are both on the *client* half of the delete path — the one place the surface tells the admin what it is about to do, and the one place it tells them what happened.

- [x] [Review][Decision] **RESOLVED 2026-08-04 — Tommy chose (b), log the swallowed exception only.** `console.error` now precedes every `server_error` envelope in the four new admin route files, with a note in each saying why these routes depart from the house silence. No audit table and no new concepts: a 500 on this surface is now diagnosable, and "who granted what to whom" remains unrecorded by choice. Original finding retained: **the only surface in the app that can delete an account writes no audit trail and logs no errors** — all four new route files, e.g. [`travelplan/src/app/api/admin/users/[userId]/route.ts:129-131`]. Every failure path is a bare `catch { return fail(apiError("server_error", …), 500) }`. Nothing records who granted `ADMIN` to whom, who deleted which account, or what the swallowed exception actually was. This is faithfully the house style — zero `console.error` across all 32 route files — which is why it is a decision and not a patch: this is the first surface where the actions are privileged and irreversible, and it is the first place where "we do not log" stops being a stylistic choice and starts being the reason an incident cannot be reconstructed. Three defensible answers: (a) leave it, consistent with everything else; (b) log the swallowed exception only, so a 500 is diagnosable, no new concepts; (c) an actual admin-action log (who, what, when) for grant/revoke/delete, which is a schema change and its own story. Not patchable without your call on which.

- [x] [Review][Patch] **`mutate` never catches a rejected `fetch`, so a network blip freezes the clicked row forever with no message at all** [`travelplan/src/components/features/admin/AdminUsersList.tsx:212-218`] — **high**. `fetchList` and `requestCsrfToken` both wrap their `fetch` in `try`/`catch`; `mutate` guards only `response.json()`. `await send(token)` is unprotected, so an offline blip, a connection reset or a dev-server restart mid-click rejects with `TypeError: Failed to fetch` and the rejection escapes the click handler as an unhandled rejection. Every one of the four hand-rolled busy flags is left set — `setBusyUserId(null)` at `:274`, `:330`, `:351` and `setDeleteBusy(false)` at `:374` are all *after* the await — and neither `setActionError` nor `setDeleteError` ever runs. The row's grant/revoke, role-toggle, detach and delete buttons stay disabled behind a spinner permanently, with no explanation, recoverable only by reloading. The two form dialogs escape this only because react-hook-form clears `isSubmitting` in a `finally`. Worst on the delete path: the admin clicks *Delete account*, the dialog freezes silently, and they have no way to tell whether the account was deleted. Fix: `try`/`catch` around the sends in `mutate`, returning `{ ok: false, envelope: null }` so the existing error branches fire.

- [x] [Review][Patch] **The delete confirmation tells the admin their trips will be deleted — which is false, and in German unambiguously so** [`travelplan/src/i18n/en.ts` / `de.ts`, `admin.users.delete.body`] — **high**. EN: *"{email} will be removed, along with every trip shared with them."* DE: *"{email} wird entfernt, samt aller für dieses Konto freigegebenen Reisen."* A trip *shared with* an account is a `TripMember` row on somebody else's trip, and `deleteUserForAdmin` removes only the membership — the trip, its days and its photos survive, exactly as `adminUserRepo.ts:264-267` states. An account that owns trips cannot be deleted at all. So the one dialog where the cascade fear lives describes the cascade the AC7 guard exists to prevent, and it does it by collapsing ownership and membership into one word — precisely what AC3 forbids everywhere else, in the most consequential string in the story. The German is worse than the English: "samt" reads as "together with", so it states outright that the trips go too. Nothing catches it — `i18nDictionaries.test.ts` pins only that `delete.keep` and `delete.confirm` share a noun. Fix: say that the account and its access to shared trips are removed, and that trips it owns are untouched (which is why deletion is refused when it owns any).

- [x] [Review][Patch] **Escape or a backdrop click during an in-flight delete throws away the server's refusal** [`travelplan/src/components/features/admin/AdminUsersList.tsx:722`] — **medium**. The create and attach dialogs route `onClose` through `useDiscardGuard`, which early-returns while busy (`DiscardChangesDialog.tsx:59`). The delete dialog wires `onClose={closeDelete}` raw, so only the `✕` and the two buttons honour `deleteBusy`. Press Escape while the DELETE is in flight → `deleteTarget` becomes `null`, then `confirmDelete` resolves and calls `setDeleteError(...)` into a dialog that is already closed. The message discarded is AC7's `owns_trips` refusal *with the blocking trip names in it* — the single most important message this surface produces — or the `self_delete` / `last_admin` refusal. The admin sees a dialog that vanished and no outcome whatsoever. Fix: guard `closeDelete` on `deleteBusy`, matching the other two dialogs.

- [x] [Review][Patch] **`AppHeader` now renders a signed-in user as anonymous when the database hiccups** [`travelplan/src/components/AppHeader.tsx:22-28`] — **medium**. `isAdminUser(session.sub)` was placed *inside* the `try` whose `catch` returns `{ isAuthenticated: false, isAdmin: false }`. Before this story the only thing that could throw there was `verifySessionJwt`, where "threw" genuinely means "no valid session". Now a `SQLITE_BUSY`, a locked file or any transient Prisma error makes a user with a perfectly good session see the anonymous Login/Register menu on every page in the `(routes)` group. The two failures need different answers: a JWT failure means signed out, a database failure means `isAdmin: false` at most. Fix: resolve the session first, then wrap only the role lookup, defaulting it to `false`. Same fix belongs at [`travelplan/src/app/(routes)/admin/users/page.tsx:43`], where the identical call has *no* `try` at all and a transient database error renders the framework's 500 page instead of `notFound()` — the two callers of one predicate currently handle its failure in opposite ways and neither handles it well.

- [x] [Review][Patch] **`grant-admin.mjs` creates a new empty database instead of telling the operator the path is wrong** [`travelplan/scripts/grant-admin.mjs:74`] — **medium**. `new Database(file)` creates the file when it is absent. Run the one-shot production bootstrap from the wrong working directory and it silently makes a stray `.db`, then reports `No account exists for <email>. Nothing was changed.` and exit 1 — a message that reads like a typo in the address, for what is actually a path bug, on the command the story itself describes as having "no second chance". `resolveDatabaseFile` also only strips a literal `file:` prefix, so a relative `DATABASE_URL` resolves against `cwd` here and against the schema directory under Prisma: the same string, two different files. Fix: `new Database(file, { fileMustExist: true })`, which turns both failure modes into one honest error naming the path it tried.

- [x] [Review][Patch] **`/admin` returns 404, and the middleware comment asserts it redirects** [`travelplan/src/middleware.ts:114-119`] — **medium**. The matcher comment reads "`/admin` today redirects to `/admin/users`". There is no `src/app/(routes)/admin/page.tsx` — only `admin/users/page.tsx` — and no `redirect()` or `redirects` config anywhere. A signed-in admin who types the obvious parent of the URL behind a menu row labelled "User administration" gets a 404. `test/middleware.test.ts` asserts the matcher covers `/admin`, which reinforces the false claim rather than catching it. Fix: add the `admin/page.tsx` that `redirect("/admin/users")`, which makes the existing comment and matcher entry true, and assert it.

- [x] [Review][Patch] **The attach dialog silently demotes an existing `CONTRIBUTOR` to `VIEWER`** [`travelplan/src/components/features/admin/AdminUsersList.tsx:402-410, 697-706`] — **medium**. `attachableTrips` filters out only trips the account *owns*; trips it is already a member of stay in the picker deliberately, because "picking one of those is how a role gets changed". But the role select hard-defaults to `"VIEWER"`, and nothing in the option marks that a membership already exists or what role it currently holds. An admin who believes they are adding a new share, on a trip where the account is already a `CONTRIBUTOR`, submits the default and the `upsert`'s `update: { role }` branch demotes them — no confirmation, no diff, and the success path then reloads and shows the new value as though it were intended. Fix: mark existing memberships in the option and seed the role select from the current one, so the dialog cannot change a role without showing which role it is changing.

- [x] [Review][Patch] **Every registration now opens an interactive transaction, and any failure that is not `P2002` escapes as a raw 500** [`travelplan/src/app/api/auth/register/route.ts:78-97`] — **medium**. `throw error` for non-`P2002` is pre-existing, but the `$transaction` is new and brings failure modes the old single `create` did not have: `SQLITE_BUSY` from write-lock contention and Prisma's 5 s interactive-transaction timeout (`P2028`). Those escape the handler, so the caller gets Next's generic 500 HTML instead of the `{ data, error }` envelope every client of this endpoint parses. The comment also states a guarantee the database does not provide: it claims the second transaction "cannot upgrade to a write lock while the first holds one, so it fails and never commits a second `ADMIN`", but `prisma/dev.db` is `journal_mode=delete` (rollback journal, **not** WAL) — verified directly. In that mode two deferred transactions that both read zero end with one taking `SQLITE_BUSY` on its `INSERT` or on the other's `COMMIT`, so the losing registrant on a fresh install gets a 500 rather than an ordinary `OWNER` account. **AC8b still holds** — no second `ADMIN` is ever committed, which is what it asks — but the mechanism is single-process serialisation in `better-sqlite3`, not lock upgrade, and the comment should say so. Fix: map unknown errors to a `server_error` envelope like the rest of the app, and correct the comment to name the real guarantee.

- [x] [Review][Patch] **`main()` is untested, so the "fails loudly" half of AC8c has no coverage** [`travelplan/test/grantAdminScript.test.ts`] — **medium**. Task 6 asks that "`admin:grant` promotes a known email and fails loudly on an unknown one". The suite imports `grantAdmin` and asserts the returned outcome object for all three outcomes — the promotion half is well covered, including reading every result back through `prisma.user`. What nothing exercises is `main()`: the stderr line and `process.exitCode = 1` at `scripts/grant-admin.mjs:115-120` are uncovered, and so is the `dotenv` / `DATABASE_URL` resolution. "Loudly" is the half that protects the operator from a silent no-op, and it is the half with no test. Fix: spawn the script as a child process for the unknown-email case and assert the exit code and stderr.

- [x] [Review][Patch] **`submitAttach` — AC5's main flow — is never exercised, on the one control that departs from the house pattern** [`travelplan/src/components/features/admin/AdminUsersList.tsx:680-714`] — **medium**. `adminUsersList.test.tsx` tests the picker's *contents* twice (which trips are offered, that owners are named) and never submits it. Meanwhile every other MUI select in this codebase uses `SelectProps={{ native: true }}` with `<option>` children precisely so `register` wires up (cf. `TripShareDialog.tsx:482-490`); this dialog uses a non-native `Select` with `MenuItem` and a bare `{...attachForm.register("tripId")}` / `("role")`. It does work today. The failure mode if it ever stops — an MUI upgrade, a `Controller` refactor — is that `role` silently ships the `defaultValues` value `"VIEWER"` on every attach, and no assertion anywhere would notice. Fix: one test that submits the attach form and asserts the request body carries the selected trip *and* the selected role.

- [x] [Review][Patch] **The per-membership buttons' accessible names do not say what they act on** [`travelplan/src/components/features/admin/AdminUsersList.tsx:560-577`] — **medium**. The role toggle's entire accessible name is the target role — `"Contributor"` — with no verb and no trip; detach is `"Remove from trip"` with no trip name. An account with two `VIEWER` memberships renders two buttons both named `"Contributor"` and two both named `"Remove from trip"` on the same row, indistinguishable to a screen-reader user and to `getByRole` — which is why the tests only ever use a fixture with exactly one membership. On a surface whose whole point is that two relations must not be confused, the controls that act on one of them do not name it. Fix: `aria-label` carrying the verb and the trip name, and a test with two memberships.

- [x] [Review][Patch] **Revoking admin on an account that is not an admin silently rewrites `VIEWER` to `OWNER`** [`travelplan/src/lib/repositories/adminUserRepo.ts:193-203`] — **low**. The `last_admin` guard is conditioned on `!makeAdmin && target.role === "ADMIN"`, but the write below is unconditional: `role = makeAdmin ? "ADMIN" : "OWNER"`. So `PATCH { isAdmin: false }` against a `VIEWER` — the role the trip-share invite path assigns — is not a no-op; it mutates a column the surface never showed and the caller never asked about. Unreachable from the UI, which computes `user.role !== "ADMIN"` and therefore only ever sends `isAdmin: true` for a non-admin, and harmless today because nothing branches on `OWNER` vs `VIEWER`. But `ADMIN` becoming load-bearing is itself the proof that "nothing branches on it" is a statement with a shelf life. Fix: return `{ outcome: "updated", role: target.role }` unchanged when the target is not an admin and `makeAdmin` is false.

- [x] [Review][Patch] **Every 403 is treated as an expired CSRF token and the mutation is re-sent** [`travelplan/src/components/features/admin/AdminUsersList.tsx:213-218`] — **low**. `requireAdmin` returns 403 for `forbidden`, and `requireSession` for `password_change_required`, on the same status as `csrf_invalid`. So a revoked admin's every click fires a token fetch plus a second identical mutation before a generic red alert appears, while `fetchList` has a purpose-built `case "forbidden": return { status: "blocked" }` that the mutation path cannot reach. Harmless only because a 403 means nothing was written — it becomes a real double-submit the moment any route returns 403 after a partial effect. The envelope's `error.code` is already parsed one line later and would tell the three apart. Fix: retry only on `csrf_invalid`, and route `forbidden` to the `blocked` state.

- [x] [Review][Patch] **The create form has validation states with no words, and drops the server's reason** [`travelplan/src/components/features/admin/AdminUsersList.tsx:637-653`] — **low**. `register("temporaryPassword", { required: true, minLength: 8 })` passes no `message`, and the field's `helperText` is the static hint, so a short password renders a red box with nothing said. There is no client-side `maxLength: 72` while the server's `passwordSchema` caps at 72, and `createError` maps only `email_exists` — so a 73-character password or a malformed email comes back `validation_error` and is shown as the generic "Unable to create the account.", with `parsed.error.flatten()` discarded. Fix: messages on both rules, `maxLength: 72`, and a distinct string for `validation_error`.

- [x] [Review][Patch] **The temporary-password field invites the browser to autofill or save it** [`travelplan/src/components/features/admin/AdminUsersList.tsx:645-652`] — **low**. Showing it in clear is well argued — the admin has to read back what they will pass on, and `mustChangePassword` makes it short-lived. The unhandled half is that on a form whose sibling field is an email, browsers and password managers will offer to save this value, or autofill the admin's *own* credentials into it. Fix: `autoComplete="off"` (or `"new-password"`).

- [x] [Review][Patch] **The `owns_trips` refusal can render with nothing after the colon** [`travelplan/src/components/features/admin/AdminUsersList.tsx:381-387`] — **low**. `(details?.tripNames ?? []).join(", ")` yields "… owns these trips and cannot be deleted: " whenever `details` is absent — which is exactly the fallback shape the client uses for any envelope it cannot fully parse. AC7's message exists to name the blocking trips; the degraded form names none and looks broken. Fix: fall back to the generic delete error when the list comes back empty.

- [x] [Review][Patch] **The client collapses the two 404 codes the routes deliberately separated** [`travelplan/src/components/features/admin/AdminUsersList.tsx:310-314, 331-334, 352-356`] — **low**. `memberships/route.ts:73-81` returns distinct `not_found` (account) and `trip_not_found` codes with a comment saying why: "which of the two is gone is the difference between reloading the list and picking another trip". The client maps only `trip_owner` and shows one generic message for everything else, so the distinction the route pays for is discarded at the only place it was for. Fix: map `trip_not_found` and `not_found` to their own strings.

- [x] [Review][Patch] **`HeaderMenu`'s comment contradicts the middleware, and it is the justification for making `isAdmin` optional** [`travelplan/src/components/HeaderMenu.tsx:14-18`] — **low**. The comment says `/page.tsx` "renders this menu for anonymous and signed-in visitors on the marketing home page". `middleware.ts:53-61` redirects any session at `/` straight to `/trips`, so that page is only ever reached anonymously — as `test/headerMenuAdminEntry.test.tsx:44` states correctly. The behaviour is right and `isAdmin = false` there is correct; the stated reason for it is not. Worth fixing because it is the reason a prop feeding a privilege gate was made omittable one frame above a signature that was deliberately redesigned to be un-omittable. Fix: correct the comment to say the home page is anonymous-only.

- [x] [Review][Defer] **Deleting an account does not invalidate its seven-day session** [`travelplan/src/lib/repositories/adminUserRepo.ts:234-270`] — deferred as DW-163, needs a session-revocation mechanism this app does not have.
- [x] [Review][Defer] **The role toggle can resurrect a membership another admin just detached** [`travelplan/src/components/features/admin/AdminUsersList.tsx:321-337`] — deferred as DW-164, requires two concurrent admins.
- [x] [Review][Defer] **`busyUserId` is one slot shared by every row** [`travelplan/src/components/features/admin/AdminUsersList.tsx:88, 491`] — deferred as DW-165.
- [x] [Review][Defer] **The whole account-and-trip graph is unpaginated and refetched after every mutation** [`travelplan/src/lib/repositories/adminUserRepo.ts:51-112`] — deferred as DW-166.
- [x] [Review][Defer] **The wire contract is hand-written twice, with the role enums as string literals on both sides** [`travelplan/src/components/features/admin/AdminUsersList.tsx:30-49` vs `adminUserRepo.ts:15-36`] — deferred as DW-167.
- [x] [Review][Defer] **The attach `upsert` has no `P2002` handler where its sibling detach explicitly avoids `P2025`** [`travelplan/src/lib/repositories/adminUserRepo.ts:316-321`] — deferred as DW-168.
- [x] [Review][Defer] **`userId` reaches Prisma unbounded while every id in the body is capped at 64** [`travelplan/src/app/api/admin/users/[userId]/route.ts:37-40`] — deferred as DW-169.
- [x] [Review][Defer] **`lower(email)` with `.get()` picks arbitrarily among case variants the binary-collated unique index permits** [`travelplan/scripts/grant-admin.mjs:78`] — deferred as DW-170.
- [x] [Review][Defer] **bcrypt runs inside the trip-share transaction, now invisible at the call site** [`travelplan/src/lib/repositories/userRepo.ts:44-56`] — deferred as DW-171, behaviour preserved from before the extraction.

**Dismissed as noise (5).** A signed-in admin seeing no administration row on `/` — unreachable, `middleware.ts:53-61` redirects any session off the home page. Story and AC numbers in shipped comments — the established convention throughout this repo, not a defect. `admin:grant` reading `.env` and not `.env.local` — `prisma.config.ts` opens with the identical `import "dotenv/config"`, so the script matches the tooling that runs the *migrations*; making it read `.env.local` would make the bootstrap disagree with `prisma migrate deploy`, which is worse than the hazard it closes. The Completion Notes' claim that the `DELETE` last-admin guard is "unreachable" — reachable under a TOCTOU race (A deletes B while B revokes A), but the guard behaves correctly and the note is about reachability, not behaviour. The "exact 85-problem / 2-error lint baseline" — the Acceptance Auditor could not reproduce it (measuring 87–94 problems / 3–4 errors across runs) and reported the figure as wrong. It is not: after the patches below, `npx eslint src scripts test` returns **exactly 85 problems / 2 errors**, and zero on any file this story touches. The variance is explained, and not by non-determinism: **another session was editing `TripAccommodationDialog.tsx`, `theme.ts` and `epics.md` in this working tree while the review ran** (story 6.26, timestamps 20:24–20:53), which is exactly the file the auditor's per-file diffing isolated the variance to. The record's number stands.

**One record-accuracy note**, not a code defect. The manual-check note says `npm run admin:grant -- <email>` was run "for real" against the throwaway copy: in the `TravelPlan-wt-510` worktree that command resolves `DATABASE_URL` from `.env`, which points at the real `prisma/dev.db`, not at `scratchpad/manual-510.db` in `.env.local` — so the verification must have used an inline `DATABASE_URL`, meaning the documented command path is the one thing not exercised. No damage occurred; `prisma/dev.db` still holds one `OWNER` account with `updated_at` unchanged at 2026-02-22.

## Browser Pass Completion (Task 7, 2026-08-05)

The one half Task 7 still owed — **the opened header menu, seen rather than inferred** — measured against a throwaway copy of `dev.db` on port 3099, in the same session that closed Story 5.11's browser pass.

**Both directions, on the same build:**

| signed in as | menu rows | administration row |
|---|---|---|
| `thomas-dreyer@gmx.de` (`ADMIN`) | 4 | **present**, `href="/admin/users"` |
| `mara@example.com` (not admin) | 3 | **absent** (`null`) |

That is AC2's claim in both directions. The negative case is the one that could not be inferred from the earlier server-HTML check, because MUI portals a closed `Menu` and no row — not even *All trips* — appears in the served markup.

`npm run admin:grant` was also run once more against the copy, as the production command it is, and reported `Granted ADMIN to thomas-dreyer@gmx.de.` with exit 0.

**One thing the pass surfaced about the row this story added.** Its height is **48px at 390x844 and 32.3px at 747x925** — MUI's `MenuItem` resets `minHeight` to `auto` above the `sm` breakpoint, and `HeaderMenu` sets no height of its own, so the app's 44px target floor is absent from this row on every desktop width. It holds on a phone. Recorded as **DW-180** rather than patched here, because the same defect sits on all of that menu's rows and on `TripDayView`'s day menu, and it wants one fix with one measurement above the breakpoint rather than three. Worth knowing that a check run only at phone width would have certified it as fine.

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

claude-opus-5[1m] (Amelia, `bmad-dev-story`), 2026-08-04.

### The command the operator needs

On the production server, in `travelplan/`:

```
npm run admin:grant -- <email>
```

Run it once. Until it is run nobody is an `ADMIN`, the header menu shows no administration row to anybody, and `/admin/users` returns 404 to every account — the surface ships reachable by no one, by design (AC8c). It is idempotent: a second run on an account that is already an admin says so and changes nothing. An unknown address is refused loudly on stderr with exit code 1, because a mistyped `UPDATE` changes zero rows and says nothing.

Verified for real against a throwaway copy, including both refusal paths. Nothing else needs to be deployed differently.

### Debug Log References

- `prisma migrate diff --from-migrations ./prisma/migrations --to-schema=prisma/schema.prisma --script`, run with and without the new enum member: **byte-identical output.** So no migration, confirming rather than assuming what Story 6.16 found for `TravelTransportType`. `users.role` is `TEXT NOT NULL DEFAULT 'OWNER'` in `20260212164546_init` with no CHECK constraint. `npm run check:migrations` passes with zero migration changes.
- That same diff is **not empty at baseline** — it wants to rebuild `cost_payments` and `trip_members`. Pre-existing drift between those hand-written migrations and what Prisma would now generate, untouched by this story and unrelated to `users`; recorded here because the next person to run that command will see it and wonder.
- Two assertions were mutation-tested rather than trusted: removing the `owns_trips` refusal fails `adminUserActionsRoute.test.ts`'s cascade case, and wiring the create dialog's `✕` past the discard guard fails `adminUsersList.test.tsx`'s discard case. Both caught.

### Completion Notes List

**`ADMIN` is the first `UserRole` value in this app that decides anything.** Nothing branches on `OWNER` or `VIEWER` anywhere — trip permission comes from `Trip.userId` and `TripMember.role`, which are different relations wearing the same word. Worth knowing before reading the diff: the enum existed but was inert.

**Trap 6 was answered, not accepted.** The story notes that `role` in the session JWT is a seven-day snapshot and asks whether that matters. It does, on a surface that deletes accounts: an admin whose role had just been revoked would keep full access for up to a week. So **authorisation never reads the token's role.** `requireAdmin` takes only `sub` from the token and re-reads the role from the database on every request, and `AppHeader` — a server component on the Node runtime — does the same for the menu. One indexed primary-key lookup buys a promotion that takes effect at once and, more importantly, a revocation that does. Confirmed live in both directions against a running server on the same unchanged session. The token's `role` claim is now purely informational.

**AC7's refusal is the story, and it was checked against the real thing.** The throwaway copy is Tommy's actual database: one account owning one 41-day trip with 50 plan items. Deleting that account was refused with `owns_trips` naming `Neuseeland`, and SQL afterwards confirmed the account, the trip, all 41 days and all 50 plan items still present. The same test bed then showed what the guard is for: `DELETE FROM users` in the bootstrap phase took the trip and every day with it, exactly as `onDelete: Cascade` declares.

**Two deviations from the spec's letter, both deliberate.**

1. **`scripts/grant-admin.mjs`, not `grant-admin.ts`, and it talks to SQLite directly rather than through Prisma.** The reason the spec gave for avoiding `sqlite3` is honoured — no external binary, only Node and the app's own dependencies. What could not be honoured is the extension: the server runs Node 20, which cannot execute TypeScript at all (native stripping is 22.6; Story 8.1's bump is still backlog); the generated Prisma client is TypeScript-only, 20 `.ts` files with no JS build; and the only transpiling runner in the tree is `vite-node`, which arrives transitively with `vitest`, a **devDependency**. A `.ts` script would work locally and fail on any `--omit=dev` install — that is, fail precisely at the moment it is needed, on a one-shot command with no second chance. `better-sqlite3` and `dotenv` are production dependencies, and `better-sqlite3` is the very driver Prisma uses here. The price is hand-writing `users.updated_at` (Prisma applies `@updatedAt` client-side), so `grantAdminScript.test.ts` reads **every** result back through `prisma.user` rather than asserting the raw column — "Prisma can read what the script wrote" is the actual contract.
2. **The membership operations are re-expressed rather than shared with `/api/trips/[id]/members`.** The spec said "the access predicate is what changes, not the logic". That is true of the authorisation and it is what happened. It could not be true of the queries: `createTripCollaboratorForOwner` and `deleteTripCollaboratorForOwner` carry `userId: ownerUserId` **inside their `where` clauses**, so the statement that finds a row is the statement that proves the caller owns it — an admin owns nothing, so the tenancy is not a parameter to vary but a clause to not have. The trip-share route also has no role-change operation at all (AC5 needs a third one), and it is trip-first where this surface is user-first. So `adminUserRepo` expresses the three operations without a tenancy clause, with attach and change-role collapsed into one `upsert` on `@@unique([tripId, userId])`. The trip-share route is untouched.

**AC10 decided: `/users` stays exactly as it is, and the administration is a separate page.** Two reasons, both written into `(routes)/users/page.tsx` so the next reader finds them there. First, the need 5.8 serves is not the administrator's — the share dialog links there so an owner can check whether an invitee already has an account *before* inviting, and gating that page on `ADMIN` would take it from every non-admin owner and leave the link walking into a wall. Second, the two payloads are different sizes and the difference should be structural: `/api/users` returns `{ id, email }`, the admin endpoint returns roles and every account's whole trip reach, and serving both from one endpoint that branches on the caller's role makes the privacy floor a conditional — one refactor from leaking the wide shape to the narrow audience. Verified live that `/users` still returns 200 for an admin, for a plain owner, and for an account that has just lost the admin role.

**AC8's wording was implemented literally.** The refusal is for the operation leaving **zero** admins, not for demoting yourself: an admin may hand the role on and then drop their own, and that case has a passing test. Two things are worth recording about reachability, because the guards look wider than they are. On `PATCH`, `last_admin` can only be reached by an admin demoting *themselves* — a caller must be an admin to get here, so revoking somebody else's role can never bring the count to zero. On `DELETE` the count guard is **unreachable** under the current rules, because self-deletion is refused outright and any other admin deleted is not the caller. It is kept as a belt so that relaxing either rule cannot quietly produce an installation nobody can administer, and the tests assert the *invariant* ("an admin is left standing") rather than a status code, so they keep holding whichever rule enforces it.

**The delete button is not hidden on rows that cannot be deleted** — not on the admin's own row, not on an account that owns trips. Both are refused server-side with a reason worth reading (AC7 names the blocking trips; self-deletion says so), and a hidden button teaches neither. Hiding it would also be the disabled-button-as-guard that AC8 explicitly is not.

**Detach has no confirmation; delete does.** The difference is reversibility, not importance: a membership removed here goes back in two clicks from the same screen and destroys nothing, while account deletion is irreversible. The two form dialogs carry `useDiscardGuard` (6.25 AC7) and confirm with `OK` (6.24 AC5); the delete confirmation keeps both buttons at unchanged weight with the safe one naming what it preserves in the same noun — `Konto behalten` beside `Konto löschen` — and `i18nDictionaries.test.ts` now pins that shared noun in both languages, plus the distinctness of the `owns` and `shared with` labels that AC3 turns on.

**A lint rule shaped the component's structure, for the better.** `react-hooks/set-state-in-effect` fires here where it does not fire on `TripBucketListPanel` — that component uses react-hook-form's `watch()`, which makes the compiler skip analysing it entirely. Rather than dodge it, `fetchList` and `requestCsrfToken` now **return** their results instead of applying them, which is what lets the mount effect hold a genuine cancellation flag instead of a decorative one, and parallelises the two mount requests. Lint is back at its exact 85-problem / 2-pre-existing-error baseline and `src/` has 0 type errors.

**What the browser pass could NOT prove, and nobody should read as proven.** This environment has no browser automation, so the manual check was driven over real HTTP against an isolated dev server (54 assertions, all passing) — which covers the middleware, the server-component gate, `AppHeader`'s live read, and every route. It does **not** cover a single rendered pixel. The new page's layout, its behaviour at 390px and 1400px, whether the per-row action buttons wrap sanely on a phone, and the opened menu itself are all unverified. MUI portals a closed `Menu`, so no menu row — not even the existing `All trips` — appears in server HTML; two of my first-pass assertions were written against that HTML and were not only wrong but **vacuous in their negative form**, passing whatever the code did. They were replaced with assertions on the `isAdmin` prop in the Flight payload, which is the seam no unit test covers. `headerMenuAdminEntry.test.tsx` covers the rendering given the prop, in jsdom.

**One thing I broke and fixed during the pass, for the record:** resetting the throwaway database with `rm` + `cp` left the running server holding the deleted inode, so the reset silently did nothing. Restarting the server was the fix, but the `pkill -f "next-server"` I used was too broad and also killed the dev server Tommy had running on :3000 against the real database. Both servers were restarted immediately and no data was touched — the real `prisma/dev.db` was only ever read from, never opened for writing by anything in this pass.

### Operator actions

1. **Run `npm run admin:grant -- <your email>` on production.** Nothing works until this is done. See the command section above.
2. **Do the visual pass.** An isolated instance is set up and running at `http://localhost:3098`, on a throwaway copy at `scratchpad/manual-510.db` — never `prisma/dev.db`. Its users were emptied and re-seeded by the bootstrap phase, so sign in as `founder@example.com` / `founder-password` (`ADMIN`) or `second@example.com` / `second-password` (plain `OWNER`). To restart it: `cd /Users/tommy/Development/TravelPlan-wt-510/travelplan && npx next dev -p 3098` (its `.env.local` already points at the copy). Check: the menu row appears for the admin and not for the other account; the two relations read as two things on one row; the per-row buttons wrap acceptably at 390px; the three dialogs look like their neighbours.
3. **Note the open window AC8b creates on a genuinely fresh deployment** (Trap 3): `/auth/register` requires only CSRF — no invite token, no allowlist — so on an empty database whoever reaches it first becomes the administrator. Standard first-run behaviour, closes on the first registration, and it can never apply to the production instance, whose table has never been empty. Recorded so it is a known property rather than a discovery.
4. **Coordinate with Story 8.2**, which renames `middleware.ts` to `proxy.ts`. This story landed first and added `/admin/:path*` to the matcher and `/admin` to `isProtectedPath`; 8.2 must carry both across.
5. **Decide whether the pre-existing `migrate diff` drift** on `cost_payments` and `trip_members` is worth a story. Not this story's to fix, and harmless today.
6. **If the visual pass passes**, tick Task 7 and its remaining subtask, set `Status: review` → `done` here, and set `5-10-user-administration-for-admins` to `done` in `sprint-status.yaml`.

### Review Actions (2026-08-04)

All 18 patch findings applied and the decision resolved as (b) — log the swallowed exception, no audit table.
Verified after the fact rather than assumed:

- **`npm test`: 119 files / 1369 tests, all green** (from 118 / 1351). Four new suites' worth of cases: the
  attach submit that AC5's main flow never had, the two-membership row that was untestable while its controls
  shared names, the `grant-admin` CLI as the operator actually invokes it (exit codes and stderr, in a child
  process, including the `fileMustExist` guard leaving no stray file), the revoke-from-a-non-admin no-op, and
  `/admin`'s redirect.
- **`npx eslint src scripts test`: exactly 85 problems / 2 errors** — the baseline the record claims, which the
  review had reported as unreproducible and which reproduces. Zero problems on any file this story touches.

**One caveat on both figures, stated because it would be dishonest to let them read as clean 5.10 numbers.**
Another session was editing this same working tree while the review ran — `TripAccommodationDialog.tsx`,
`src/theme.ts`, `epics.md` and two new 6.26 spec files, timestamped 20:24–20:53, none of them 5.10's. The test
and lint runs above therefore measure 5.10's patches **plus** that in-flight work. Both came out green and at
baseline, so nothing is hidden, but the 1369 and the 85/2 are figures for the tree as it stood, not for this
story in isolation. It also explains the auditor's lint variance, which it had attributed to non-determinism.
- **`npx tsc --noEmit`: 0 errors in `src/` and `scripts/`.**

Two things changed shape rather than being patched in place, and both are improvements the findings only
pointed at:

1. **The attach dialog's two selects became `Controller`s.** Seeding the role from the trip's existing
   membership needs the select's *displayed* value to follow `setValue`, and a MUI `select` with
   `defaultValue` plus a spread `register` is uncontrolled — MUI keeps its own value and the two drift. This
   also retires the fragility the review flagged separately: the rest of the codebase uses
   `SelectProps={{ native: true }}` so a bare `register` wires up, and this dialog needs `MenuItem` for its
   composed option label, so it now takes the other supported route rather than the unsupported middle.
2. **`mutate` reads each attempt's body once** instead of sniffing a `clone()`, which is what makes deciding
   "was this 403 a CSRF expiry or a revocation?" possible without a second read — and avoids depending on
   `Response.clone`, which the suite's fetch stub does not implement.

Two existing assertions in `adminUsersList.test.tsx` were updated, not weakened: they queried the membership
buttons by the visible labels `"Contributor"` and `"Remove from trip"`, which are no longer the accessible
names now that each carries the trip it acts on. They now match on the trip, which is strictly more specific.

**Not done, and still the gate:** Task 7's browser pass. Nothing in this review looked at a rendered pixel
either — jsdom lays nothing out — so the page's layout, its behaviour at 390px and 1400px, the per-row button
wrapping and the opened menu remain exactly as unverified as the record says. Status is `in-progress` rather
than `done` for that reason alone: every review finding is resolved, and the story's own operator action 6
gates `done` on the visual pass. Note that the isolated instance on :3098 predates these patches — restart it
before the visual pass so it serves the patched code.

### File List

**New — source**
- `travelplan/scripts/grant-admin.mjs`
- `travelplan/src/app/(routes)/admin/page.tsx` — added by review: `/admin` → `/admin/users`
- `travelplan/src/app/(routes)/admin/users/page.tsx`
- `travelplan/src/app/api/admin/users/route.ts`
- `travelplan/src/app/api/admin/users/[userId]/route.ts`
- `travelplan/src/app/api/admin/users/[userId]/memberships/route.ts`
- `travelplan/src/components/features/admin/AdminUsersList.tsx`
- `travelplan/src/lib/auth/adminAccess.ts`
- `travelplan/src/lib/repositories/adminUserRepo.ts`
- `travelplan/src/lib/validation/adminUserSchemas.ts`

**New — tests**
- `travelplan/test/adminAccess.test.ts`
- `travelplan/test/adminIndexRedirect.test.ts` — added by review
- `travelplan/test/adminUsersRoute.test.ts`
- `travelplan/test/adminUserActionsRoute.test.ts`
- `travelplan/test/adminMembershipsRoute.test.ts`
- `travelplan/test/adminUsersList.test.tsx`
- `travelplan/test/headerMenuAdminEntry.test.tsx`
- `travelplan/test/grantAdminScript.test.ts`

**Modified — source**
- `travelplan/package.json` — the `admin:grant` script
- `travelplan/prisma/schema.prisma` — `UserRole.ADMIN`, plus the no-DDL note
- `travelplan/src/app/(routes)/users/page.tsx` — AC10's decision, recorded (comment only)
- `travelplan/src/app/api/auth/register/route.ts` — AC8b's transactional first-registration promotion
- `travelplan/src/components/AppHeader.tsx` — resolves `isAdmin` live from the database
- `travelplan/src/components/HeaderMenu.tsx` — takes and forwards `isAdmin`
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — `header.userAdmin` and the `admin.users.*` namespace
- `travelplan/src/lib/db/prisma.ts` — `PRISMA_SCHEMA_TAG` bumped (the field probe cannot see a new enum member)
- `travelplan/src/lib/navigation/authMenu.ts` — the `admin` entry; signature became one named argument
- `travelplan/src/lib/repositories/tripRepo.ts` — now calls the extracted account-creation helper
- `travelplan/src/lib/repositories/userRepo.ts` — `createAccountWithTemporaryPassword`, extracted from the above
- `travelplan/src/middleware.ts` — `/admin` in the page guard and the matcher
- `travelplan/src/generated/prisma/enums.ts`, `travelplan/src/generated/prisma/internal/class.ts` — regenerated

**Modified — tests**
- `travelplan/test/authMenu.test.ts` — new signature, plus the administration entry
- `travelplan/test/middleware.test.ts` — `/admin` guard and matcher
- `travelplan/test/registerRoute.test.ts` — AC8b's bootstrap
- `travelplan/test/i18nDictionaries.test.ts` — the AC3 label distinctness and delete-noun pins

**Modified — artifacts**
- `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-08-04 — Story 5.10 implemented. `UserRole.ADMIN` added with no migration (verified byte-identical `migrate diff`). Both bootstrap paths built: a transactional first-registration promotion for an empty installation (AC8b) and `npm run admin:grant -- <email>` for one that already has users (AC8c). `requireAdmin` / `isAdminUser` gate the API and the header menu on the **live** database role rather than the session token's seven-day snapshot, so promotions and revocations take effect at once. New administration page at `/admin/users`, admin-only and gated in the server component; `/users` from Story 5.8 left untouched and the decision recorded (AC10). Listing keeps ownership and membership as two relations (AC3) on a five-key payload (AC9). Actions: create with a temporary password reusing 5.1's mechanism (AC4), grant and revoke `ADMIN` (AC8a), attach / change role / detach (AC5, AC6), and a delete that is refused while the account owns trips and names them (AC7). AC8 enforced as "at least one admin must remain", server-side. Tests 1220 → 1351 across 111 → 118 files, all green; lint at its 85-problem / 2-error baseline; 0 `src/` type errors. Manual check driven over real HTTP against an isolated instance on a throwaway copy of the production database: 54/54 assertions passed, including SQL confirmation that a refused deletion left all 41 days and 50 plan items intact. **The rendered pixels are not verified** — no browser automation available; see operator actions.
