---
authored_against: b18997c2fb293ac1f6fc2adbc4b862620d455eb8
baseline_revision: 249c9253763c9d051e205e9c4c70d746edbc7e9c
status: done
review_loop_iteration: 0
final_revision: 9dacae0
followup_review_recommended: false
---

# Story 5.8: View All Registered System Users

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip owner,
I want to see a list of all users registered in the system,
so that I can decide who to invite as a collaborator and avoid confusion about whether someone already has an account.

**FRs covered:** FR35 in `epics.md`'s FR scheme (`epics.md:51` — "Trip owners can view a list of all registered users in the system, to help decide who to invite as a collaborator and avoid duplicate-account confusion"; epic mapping at `epics.md:140`).

> **FR numbering warning:** `prd.md:277` uses FR35 for a completely different, unbuilt capability ("Users can capture ideas or places in an inbox for later placement"). The two documents number FRs differently and `epics.md` is the citation of record for this epic (same convention Story 7.5 recorded). **Do not implement an idea inbox.**

## Acceptance Criteria

**AC1** (epic, verbatim)
**Given** I own at least one trip
**When** I open the registered users overview
**Then** I see a list of all user accounts registered in the system, identified by email

**AC2** (epic, verbatim)
**Given** I am signed in but do not own any trip
**When** I attempt to access the registered users overview
**Then** I am blocked from viewing it

**AC3** (epic, verbatim)
**Given** I am a viewer or contributor on one or more trips but not an owner of any trip
**When** I attempt to access the registered users overview
**Then** I am blocked from viewing it

**AC4** (epic, verbatim)
**Given** the registered users overview is open
**When** I view the list
**Then** it is not scoped to a single trip, but reflects every account in the system

**AC5** (epic, verbatim)
**Given** new users register after I first opened the overview
**When** I reload or reopen the overview
**Then** the list reflects the current set of registered accounts

**AC6** (derived — the epic ACs describe a surface that does not exist yet)
**Given** there is no "registered users overview" anywhere in the codebase today
**When** this story is implemented
**Then** the overview is a **separately addressable page** at `/users`, reachable from the share dialog, and backed by a new `GET /api/users` — because AC2/AC3 are only testable if a non-owner can *attempt* to reach the surface, which is impossible if the list lives only inside the owner-only share dialog

**AC7** (derived — privacy floor; the architecture claims GDPR-aligned handling, `architecture.md:51`)
**Given** the endpoint exposes every account in the system to any trip owner
**When** the payload is built
**Then** it carries **only** `id` and `email` per user — never `passwordHash`, `role`, `mustChangePassword`, `preferredLanguage`, or timestamps — and the UI renders **only** the email

**AC8** (regression)
**Given** an unauthenticated caller, or a caller whose session has `mustChangePassword`
**When** they call `GET /api/users` or navigate to `/users`
**Then** they get the same treatment the rest of the app already gives: `401 unauthorized` / `403 password_change_required` on the API, and a redirect to `/auth/login` / `/auth/first-login-password` on the page

### Scope note — read before Task 1

**"Blocked from viewing it" (AC2/AC3) means: the API returns `403 forbidden` and the page renders a single explanatory message with no user list.** Not a 404, not a silent empty list, not a redirect — a redirect would make AC2/AC3 indistinguishable from AC8's unauthenticated case and untestable at the component level.

**Ownership means trip ownership, not `User.role`.** `User.role` is a legacy global `OWNER`/`VIEWER` enum (`prisma/schema.prisma:42-55`) that defaults to `OWNER` for every registered account — it is **not** an authorization signal for this story and gating on it would let every account through. The gate is "this user is `Trip.userId` on at least one row", which is the same notion `hasTripOwnerAccess` already encodes per-trip (`src/lib/auth/tripAccess.ts:67-70`).

**Out of scope — do not build:**
- Inviting/adding a collaborator directly from this list (no per-row action, no click target). The list informs the owner; they still type the email into the share dialog. This keeps the story off the members route entirely.
- Search, filter, pagination, or sorting controls. Fixed ascending-by-email order only.
- A header-menu entry. A menu item visible to authenticated non-owners would dangle into the AC2/AC3 blocked state on every click; the entry point is the owner-only share dialog. `src/lib/navigation/authMenu.ts` is not touched.
- Any change to `GET/POST/DELETE /api/trips/[id]/members`, `createTripCollaboratorForOwner`, or the collaborator list rendering. Story 5.6 and Story 7.5 own those; this story only *adds* a link inside the dialog.
- User deletion, role editing, or account admin of any kind.

## Tasks / Subtasks

- [x] Task 1: Add the registered-users data access (AC1, AC4, AC5, AC7)
  - [x] Create `travelplan/src/lib/repositories/userRepo.ts` with `listRegisteredUsers(): Promise<RegisteredUser[]>` where `RegisteredUser = { id: string; email: string }`.
  - [x] Query `prisma.user.findMany` with an explicit `select: { id: true, email: true }` and `orderBy: { email: "asc" }` — explicit select, never a bare `findMany()` that would return `passwordHash`.
  - [x] Do not add a `where` clause: every account is in scope (AC4), including the caller's own account and accounts that own no trip.
  - [x] Add `hasAnyOwnedTrip(userId: string): Promise<boolean>` to `travelplan/src/lib/auth/tripAccess.ts` using `prisma.trip.count({ where: { userId } })` (or `findFirst` + `select: { id: true }`); it lives with the other access predicates, not in a repository.
- [x] Task 2: Add the owner-gated `GET /api/users` route (AC1, AC2, AC3, AC4, AC5, AC7, AC8)
  - [x] Create `travelplan/src/app/api/users/route.ts` with `export const runtime = "nodejs";` and a `GET` handler only.
  - [x] Guard with `requireSession(request)` first and return `auth.response` verbatim when set — this yields `401 unauthorized` and `403 password_change_required` for free (AC8). **This path is not covered by the middleware matcher, so the route must self-guard.**
  - [x] Then call `hasAnyOwnedTrip(session.sub)`; when false return `fail(apiError("forbidden", "Trip ownership required"), 403)`.
  - [x] On success return `ok({ users })` from `listRegisteredUsers()`; wrap the repository call in try/catch returning `fail(apiError("server_error", "Unable to load registered users"), 500)`, matching `src/app/api/trips/[id]/members/route.ts:37-46`.
  - [x] No CSRF check — this is a read-only `GET`, consistent with the members `GET`.
- [x] Task 3: Protect and create the `/users` page (AC1, AC6, AC8)
  - [x] Extend `travelplan/src/middleware.ts`: `isProtectedPath` must also match `/users` (keep `/api/users` out of `isProtectedApiPath`, which stays `/api/trips`-only), and add `"/users/:path*"` to `config.matcher` (`src/middleware.ts:5,66`).
  - [x] Create `travelplan/src/app/(routes)/users/page.tsx` as a thin async server component: `Container maxWidth="md"` + a back `Button`/`Link` to `/trips` + the client list component — mirror `src/app/(routes)/trips/[id]/page.tsx:12-29` and use `getServerT()` for the back label.
  - [x] Do **not** duplicate the ownership check in the page; the client component renders the blocked state from the API's `403` (single source of truth, and it is what the tests assert).
- [x] Task 4: Build the registered-users list UI (AC1, AC2, AC3, AC5, AC7)
  - [x] Create `travelplan/src/components/features/users/RegisteredUsersList.tsx` as a `"use client"` component.
  - [x] Fetch `GET /api/users` with `credentials: "include"` and `cache: "no-store"` on mount, in a `useEffect` with an `active` cancellation flag — copy the shape of `TripShareDialog.tsx:170-241`. `cache: "no-store"` is what makes AC5 hold on reload.
  - [x] Render three exclusive states: loading (`CircularProgress`), blocked (`error.code === "forbidden"` → `<Alert severity="error">{t("users.registered.forbidden")}</Alert>` and **no list**), loaded (count label + list). Any other error code → `t("users.registered.loadError")`.
  - [x] Reuse the access-list row pattern from `TripShareDialog.tsx:452-497`: a `List` with `borderTop`, per-`ListItem` `borderBottom: 1px solid tokens.border`, last row borderless, `py: "12px"`, email at `fontSize: 13, fontWeight: 700, color: tokens.ink`. Do not invent a new list style and do not use `Table`.
  - [x] Wrap the list in the DESIGN.md `card` treatment (white, `borderRadius: "8px"`, `1px solid tokens.borderStrong`, `18px` padding, uppercase label-caps card label) — `DESIGN.md:238`.
  - [x] Render **email only**. No `RoleBadge`, no role text, no created-at, no remove/invite action (AC7 and the scope note).
  - [x] Show the count via `formatMessage(t("users.registered.countLabel"), { count })`, matching `TripShareDialog.tsx:443`.
- [x] Task 5: Add the share-dialog entry point (AC6)
  - [x] In `travelplan/src/components/features/trips/TripShareDialog.tsx`, add one link to `/users` beneath the invite form, labelled `t("trips.share.viewRegisteredUsers")`.
  - [x] Use `target="_blank" rel="noopener"` so opening the overview does not close the dialog or discard a half-typed invite.
  - [x] Keep it visually quiet — a text-weight link/`Button variant="text"` at the 44px hit-target floor (`DESIGN.md:243,266`). Do not restructure, re-space, or re-theme anything else in the dialog: Story 7.5's redesign of this file is at `review` and its layout is the approved one.
- [x] Task 6: Add i18n keys to **both** dictionaries (AC1, AC2, AC5)
  - [x] `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` — exact key/value pairs in Dev Notes → *i18n keys*. Both files or the German UI silently falls back to raw key strings (`translate()` in `src/i18n/index.ts:22` returns the key on miss).
- [x] Task 7: Test coverage (AC1–AC8)
  - [x] `travelplan/test/usersRoute.test.ts` — see Dev Notes → *Testing Requirements* for the full case list.
  - [x] `travelplan/test/registeredUsersList.test.tsx` — jsdom, `renderWithProviders`, stubbed `fetch`.
  - [x] Extend `travelplan/test/middleware.test.ts` with the two `/users` redirect cases.
  - [x] Extend `travelplan/test/tripShareDialog.test.tsx` with the entry-point link assertion.
  - [x] Run the full suite (`npm test`) plus `npm run lint` — the whole repo must stay green, not just the new files.

## Dev Notes

### Developer Context

Epic 5 already models collaboration correctly: `TripMember` is trip-scoped and unique on `(tripId, userId)`, Story 5.6 made an existing `User` reusable across trips, and Story 7.5 rebuilt the share dialog with an owner row and a remove action. What is still missing is the *discovery* half — an owner typing an email has no way to know whether that person already has an account, which is exactly the duplicate-account confusion FR35 names.

This story adds a **read-only, system-wide** surface. That is a deliberate widening of the app's otherwise strictly trip-scoped read model, and it is the only place in the codebase where a caller sees data belonging to users they have no trip relationship with. Hence the two hard constraints: the payload is minimal (AC7) and the gate is real (AC2/AC3).

**Working-tree state you inherit:** baseline commit `b18997c` plus **uncommitted Story 7.5 work** in `TripShareDialog.tsx`, `members/route.ts`, `tripRepo.ts`, `tripMemberSchemas.ts`, `TripTimeline.tsx`, both i18n dictionaries, and four test files (7.5 is at `review`, not `done`). Treat that state as the baseline — the share dialog you edit in Task 5 is the redesigned one with `SectionLabel`, `RoleBadge`, and the owner-first access list. Do not revert, restyle, or "fix" it.

### Technical Requirements

- **Ownership gate:** `hasAnyOwnedTrip(userId)` = at least one `Trip` row with `userId = <caller>`. Trip *membership* (`TripMember`) never satisfies it (AC3).
- **Ordering:** `email asc`, so the list is deterministic and assertable. No client-side re-sorting.
- **Scope:** no `where` filter — the caller's own account and account owners with zero trips are all included (AC4).
- **Payload shape:** `{ data: { users: [{ id, email }] }, error: null }`. `id` is included so React keys are stable; nothing else ships.
- **Freshness:** client fetch uses `cache: "no-store"`; the route is a dynamic App Router `GET` handler with `runtime = "nodejs"` like every other route in the project. No revalidate tags, no Redux slice — this is one fetch on mount, same as `TripCostOverview`/`TripShareDialog`.
- **Error codes:** reuse `unauthorized`, `password_change_required`, `server_error` verbatim from `requireSession`/existing routes. `forbidden` is a **new** code in this codebase (the existing 17 codes are listed by `grep -rh 'apiError("' src`) — introduce it deliberately at 403; do not reuse `not_found`, which would hide a real state the ACs require the UI to distinguish.

### Architecture Compliance

- Route handler under `src/app/api/**/route.ts` — the only public API surface (`architecture.md:394-397`).
- Data access via `src/lib/repositories/*`; Prisma client only from `src/lib/db/prisma.ts` (`architecture.md:404-406`). `tripAccess.ts` already queries Prisma directly for access predicates (`src/lib/auth/tripAccess.ts:22`) — `hasAnyOwnedTrip` follows that established precedent rather than opening a new repository for a boolean.
- `{ data, error }` envelope via `ok`/`fail` from `src/lib/http/response.ts` — never a raw payload (`architecture.md:258-266,304`).
- Feature component under `src/components/features/users/`; new folder is consistent with `features/trips|days|accommodations` (`architecture.md:352-358`).
- DB `snake_case` / API JSON `camelCase` (`architecture.md:289-292`). No schema change and **no migration** — `User` already has everything needed.
- Component `PascalCase.tsx`, functions `camelCase` (`architecture.md:235-239`).

### Library / Framework Requirements

Stay on the pinned stack in `travelplan/package.json`; **add no dependency** — this story needs nothing that is not already installed:

- `next@16.2.12`, `react@19.2.3` / `react-dom@19.2.3`
- `@mui/material@^7.3.8` (+ `@mui/material-nextjs`) — `Container`, `Box`, `List`, `ListItem`, `Alert`, `CircularProgress`, `Typography`, `Button`
- `prisma` / `@prisma/client@^7.3.0` with `@prisma/adapter-better-sqlite3`
- `zod@^4.1.11` — **not needed here**: a `GET` with no body and no query params has nothing to validate. Do not add a schema file for symmetry's sake.
- `vitest@^3.2.7` + `@testing-library/react@^16.3.2` + `jsdom@^28` for tests
- No `react-hook-form` (no form on this surface), no Redux slice (`store/` is not touched)

### File Structure Requirements

**NEW**
- `travelplan/src/app/api/users/route.ts` — `GET` handler
- `travelplan/src/lib/repositories/userRepo.ts` — `listRegisteredUsers`
- `travelplan/src/app/(routes)/users/page.tsx` — server shell
- `travelplan/src/components/features/users/RegisteredUsersList.tsx` — client list
- `travelplan/test/usersRoute.test.ts`
- `travelplan/test/registeredUsersList.test.tsx`

**UPDATE** (read the current file before editing — all four already carry behavior this story must not break)
- `travelplan/src/lib/auth/tripAccess.ts` — append `hasAnyOwnedTrip`; leave the four existing predicates and `getTripAccessForUser` untouched
- `travelplan/src/middleware.ts` — `isProtectedPath` + `config.matcher` only; the `/api/trips` branch, the `/` redirect branch, and the forced-password-change branch stay exactly as they are
- `travelplan/src/components/features/trips/TripShareDialog.tsx` — one link added; nothing else
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — additive keys only
- `travelplan/test/middleware.test.ts`, `travelplan/test/tripShareDialog.test.tsx` — additive cases only

**Do not create:** a `lib/validation/userListSchemas.ts`, a `store/slices/usersSlice.ts`, a `/api/users/[id]` route, or a second users page. `src/lib/validation/userSchemas.ts` already exists for the language PATCH — do not repurpose it.

### i18n keys

Add verbatim to both dictionaries (flat dot-namespaced keys, matching the existing style):

| Key | `en.ts` | `de.ts` |
|---|---|---|
| `users.registered.title` | `Registered users` | `Registrierte Benutzer` |
| `users.registered.subtitle` | `Every account in TravelPlan` | `Alle Konten in TravelPlan` |
| `users.registered.countLabel` | `Accounts ({count})` | `Konten ({count})` |
| `users.registered.empty` | `No accounts registered yet.` | `Noch keine Konten registriert.` |
| `users.registered.loadError` | `Unable to load registered users. Please refresh.` | `Registrierte Benutzer konnten nicht geladen werden. Bitte aktualisieren.` |
| `users.registered.forbidden` | `Only trip owners can view registered users.` | `Nur Reise-Eigentümer können registrierte Benutzer sehen.` |
| `users.registered.back` | `← Back to trips` | `← Zurück zu Reisen` |
| `trips.share.viewRegisteredUsers` | `View all registered users` | `Alle registrierten Benutzer ansehen` |

`{count}` is substituted by `formatMessage` (`src/i18n/index.ts:24-28`), the same helper `trips.share.accessLabel` uses.

### Testing Requirements

Vitest runs `environment: "node"` by default; `.tsx` suites opt into jsdom with a `// @vitest-environment jsdom` first line (`vitest.config.ts`, `test/tripsDashboard.test.tsx:1`). Route suites hit a **real migrated SQLite database** per worker (`test/setup.ts`) — build fixtures with `prisma.*.create` and clean up in `beforeEach` with `deleteMany` in FK-safe order (`tripMember` → `tripDay` → `trip` → `user`), exactly as `test/tripMembersRoute.test.ts:39-43` does. Sessions come from `createSessionJwt({ sub, role })`; requests from `new NextRequest("http://localhost/api/users", { headers: { cookie: \`session=${token}\` } })`.

`test/usersRoute.test.ts` (AC1–AC5, AC7, AC8):
- Owner of ≥1 trip receives every registered account, `email asc`, including their own row **and** an account that owns no trip (AC1, AC4).
- Signed-in user who owns no trip and has no membership → `403` with `error.code === "forbidden"`, `data === null` (AC2).
- Signed-in user who is only a `TripMember` (assert once for `VIEWER`, once for `CONTRIBUTOR`) → `403 forbidden` (AC3).
- No session cookie → `401 unauthorized`; session with `mustChangePassword: true` → `403 password_change_required` (AC8).
- Payload keys are exactly `["id", "email"]` per user — assert `Object.keys(user).sort()`, and assert `"passwordHash" in user === false` (AC7).
- A user created **between** two `GET` calls appears in the second response (AC5).

`test/registeredUsersList.test.tsx` (AC1, AC2, AC5, AC7):
- `200` with three users → all three emails render, count label reads `Accounts (3)`.
- `403 forbidden` → the forbidden message renders and **no email and no list** is present (assert `queryByRole("list")` is null).
- `500 server_error` and a rejected `fetch` → the load-error message renders.
- `200` with an empty array → the empty message renders.
- The fetch is called with `cache: "no-store"` (AC5's mechanism).
- No role text and no button appears in a rendered row (AC7).

`test/middleware.test.ts` (AC8): unauthenticated `GET /users` → 307 redirect to `/auth/login`; session with `mustChangePassword` → redirect to `/auth/first-login-password`. Follow the existing suite's request-construction helper rather than writing a new one.

`test/tripShareDialog.test.tsx` (AC6): with the existing CSRF+members `fetch` stub, the dialog renders a link whose `href` is `/users` and whose `target` is `_blank`. Do not weaken or rewrite the existing cases in that file.

### Previous Story Intelligence

- **Story 5.6** (`done`) made an existing `User` linkable to a second trip and returns `accountAction: "linked_existing_account"`. The registered-users list is the discovery front-end for exactly that path — which is why no per-row invite action is needed: the owner already has a working "type any existing email" flow.
- **Story 5.6 code review** found that owner-email conflicts and duplicate-member races needed *distinct* error codes rather than one collapsed message. Same lesson applies here: `forbidden` must not be collapsed into `not_found`.
- **Story 5.4** kept member management owner-only; this story keeps the same posture and does not widen any write permission.
- **Story 5.9** (`done`) removed comments/voting entirely. Do not reference, re-add, or lean on any comment/vote surface — and `DESIGN.md:265` forbids that UI outright.
- **Story 7.5** (`review`, uncommitted) added `getTripSharingForOwner`, `deleteTripCollaboratorForOwner`, a `DELETE` on the members route, 8 i18n keys, and rebuilt the dialog on Screen D chrome with `theme.palette.tokens.*`. Two direct consequences: (a) any component reading `tokens.*` **must** be rendered through `renderWithProviders` or it throws under MUI's bare default theme (`test/helpers/renderWithProviders.tsx`); (b) your Task 5 edit lands in a file whose diff is already under review — keep it to the single link.
- **Story 7.6 / 7.8** are `ready-for-dev` and touch auth screens and the trip overview. Neither touches `/users`, `/api/users`, `middleware.ts`, or `tripAccess.ts` — no coordination needed beyond the shared i18n dictionaries, where additive-only edits avoid conflicts.

### Git Intelligence Summary

Recent commits: `b18997c` (CI: security-audit gate + Node 20 action deprecation), `161a58e` (7.4 trips list redesign), `57c438d` (5.9 comments/voting removal), `cacfa72` (7.3 day detail redesign), `a65c533` (7.2 trip overview redesign).

Actionable signals:
- Four of the last five commits are Epic 7 redesigns, so the design-token system (`src/theme.ts` → `palette.tokens`) is the current styling contract. A new surface built with raw hex values or MUI defaults would be immediately off-system — read tokens from `useTheme()`.
- `b18997c` tightened the CI security-audit gate (`npm run audit:check` at `--audit-level=low`). Adding a dependency would risk that gate; this story deliberately adds none.
- `57c438d` (5.9) is the precedent for deleting rather than dormanting discontinued features — do not build hooks or props "for later" (no invite-from-row callback, no filter prop).
- Every recent route addition follows the identical `requireSession` → access check → `try/catch` → `ok`/`fail` skeleton. Copy it; do not invent a new handler shape.

### Latest Tech Information

Versions are pinned locally in `travelplan/package.json` and are the implementation target — do not bundle upgrades into this story (a Node 24 runtime upgrade is separately tracked as story `8-1-node-24-runtime-upgrade`).

- App Router `GET` route handlers are uncached by default in Next 15+/16, so AC5 needs no explicit opt-out server-side; the client's `cache: "no-store"` covers the browser side: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- Middleware `matcher` entries are compiled at build time and must be static string literals — `"/users/:path*"` matches `/users` itself as well as any subpath: [Next.js Middleware matcher](https://nextjs.org/docs/app/api-reference/file-conventions/middleware#matcher)
- Prisma `select` is the mechanism that keeps `passwordHash` out of the result set (AC7); a bare `findMany()` returns every scalar field: [Prisma select fields](https://www.prisma.io/docs/orm/prisma-client/queries/select-fields)
- MUI `List`/`ListItem` with `disablePadding`/`disableGutters` is the same primitive the share dialog's access list uses: [MUI List](https://mui.com/material-ui/react-list/)

### Project Context Reference

No `project-context.md` exists in this repository. `docs/` holds the brownfield documentation set referenced by `architecture.md:6-28`; the authoritative visual contract is `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` + `EXPERIENCE.md`.

### Project Structure Notes

- **The middleware matcher is the trap in this story.** `src/middleware.ts:66` lists `["/", "/trips/:path*", "/api/trips/:path*", "/auth/first-login-password"]`. Neither `/users` nor `/api/users` is covered, which is why `/api/users/me/language` self-guards (`src/app/api/users/me/language/route.ts:31-34`). Your new API route **must** self-guard the same way; the new page **must** be added to the matcher or an unauthenticated visitor gets a shell page and a bare 401.
- Adding `/users` to `isProtectedPath` is safe: `isProtectedApiPath` is checked first and stays `/api/trips`-scoped, and matcher entry `"/users/:path*"` does not match `/api/users`.
- `User.role` defaults to `OWNER` for every account (`prisma/schema.prisma:42-55`) — worthless as a gate. Use trip ownership.
- `src/lib/repositories/` has five repos, none for users; `userRepo.ts` is the natural new seam and keeps `route.ts` free of Prisma calls.
- The `users` i18n namespace is new; existing namespaces are `app`, `header`, `language`, `auth`, `trips`, `errors`, `common`. `Dictionary` is `Record<string, string>` (`src/i18n/index.ts:4`), so nothing enforces en/de parity — adding a key to only one file fails silently at runtime, not at compile time.
- `test/i18nDictionaries.test.ts` only asserts both dictionaries exist; it will **not** catch a missing German key. Verify both files by hand.

### References

- `_bmad-output/planning-artifacts/epics.md` (lines 51, 138-140, 1168-1196)
- `_bmad-output/planning-artifacts/architecture.md` (lines 51, 149-162, 235-266, 289-306, 352-358, 394-410)
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` (lines 195-205, 217, 223, 229, 238, 243-244, 265-266)
- `_bmad-output/implementation-artifacts/5-6-add-existing-contributor.md`
- `_bmad-output/implementation-artifacts/5-9-remove-comments-and-voting-feature.md`
- `_bmad-output/implementation-artifacts/7-5-share-dialog-redesign.md`
- `travelplan/package.json`
- `travelplan/prisma/schema.prisma` (lines 42-55, `model User`)
- `travelplan/src/middleware.ts` (lines 5-8, 50-62, 66)
- `travelplan/src/lib/auth/sessionGuard.ts` (lines 23-43)
- `travelplan/src/lib/auth/tripAccess.ts` (lines 21-75)
- `travelplan/src/lib/http/response.ts`, `travelplan/src/lib/errors/apiError.ts`
- `travelplan/src/app/api/trips/[id]/members/route.ts` (lines 22-47)
- `travelplan/src/app/api/users/me/language/route.ts` (lines 24-46)
- `travelplan/src/lib/repositories/tripRepo.ts` (lines 383-409, `listTripCollaborators` select pattern)
- `travelplan/src/components/features/trips/TripShareDialog.tsx` (lines 146-241, 441-527)
- `travelplan/src/app/(routes)/trips/page.tsx`, `travelplan/src/app/(routes)/trips/[id]/page.tsx`
- `travelplan/src/i18n/index.ts` (lines 4, 22-28), `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- `travelplan/src/theme.ts` (palette `tokens`)
- `travelplan/test/setup.ts`, `travelplan/test/helpers/renderWithProviders.tsx`
- `travelplan/test/tripMembersRoute.test.ts` (lines 14-43), `travelplan/test/middleware.test.ts`, `travelplan/test/tripShareDialog.test.tsx`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js Middleware matcher](https://nextjs.org/docs/app/api-reference/file-conventions/middleware#matcher)
- [Prisma select fields](https://www.prisma.io/docs/orm/prisma-client/queries/select-fields)
- [MUI List](https://mui.com/material-ui/react-list/)

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

None. No failing intermediate state needed diagnosis; the new suites passed on first run and the full
suite stayed green.

### Completion Notes List

- **Context drift from the Dev Notes.** The story was authored against `b18997c`; implementation
  landed on `249c925`. Every referenced file was re-read at its current state before editing. Three
  Dev Notes claims were stale and are recorded here:
  1. Story 7.5's share-dialog work is **committed**, not uncommitted. `TripShareDialog.tsx` exists at
     the documented path with `SectionLabel`, `RoleBadge` and the owner-first access list, so Task 5
     landed exactly where the story expected — one added link, nothing restructured.
  2. `src/middleware.ts:66` no longer holds the four-entry matcher the notes quote. Story 2.34 rebuilt
     it into five entries with a negative-lookahead exclusion for `/api/trips/import`. The `/users`
     entry was appended without touching that exclusion, and `middleware.test.ts` now also pins that
     `/api/users` is **not** matched — the matcher-level counterpart to the API route self-guarding.
  3. `src/app/api/trips/[id]/members/route.ts` now carries `GET`/`POST`/`DELETE`; the `GET` skeleton
     copied for `/api/users` is at lines 22-47 as described, unchanged in shape.
- **`forbidden` is a new error code**, introduced deliberately at 403 rather than folded into
  `not_found`, so `RegisteredUsersList` can tell "you may not see this" apart from a failure.
- **The ownership gate reads `Trip.userId`, never `User.role`.** `hasAnyOwnedTrip` uses
  `findFirst` + `select: { id: true }` and lives beside the other predicates in `tripAccess.ts`.
- **The page does not repeat the gate.** `GET /api/users` is the single decider; the client component
  renders the blocked state from the 403. A second server-side check could disagree with the API.
- **`RegisteredUsersList` models its states as a discriminated union** (`loading` / `blocked` /
  `error` / `loaded`) rather than a set of booleans, so "blocked" and "loaded" cannot both be true —
  which is what the AC2/AC3 "not an empty list" requirement actually asks for.
- **Payload is `{ id, email }` only**, enforced by an explicit Prisma `select` and asserted positively
  (`Object.keys(user).sort()`) and negatively (`passwordHash`/`role`/`mustChangePassword`/
  `preferredLanguage` all absent) in `usersRoute.test.ts`.
- No dependency added, no schema change, no migration.
- **Verification:** `npm run lint` → 2 errors / 83 warnings, and `npx tsc --noEmit` → 143 errors —
  byte-identical to the counts measured on a stashed working tree, i.e. all pre-existing (the two lint
  errors are `react/no-children-prop` in `src/theme.ts`; the tsc errors are all in pre-existing test
  files, none in any file this story touches — already tracked as DW-95). `npm test` after the review
  pass: **110 files / 1078 tests, all passing** (1074 at hand-off, plus 4 added by review patches).

### File List

**New**

- `travelplan/src/lib/repositories/userRepo.ts`
- `travelplan/src/app/api/users/route.ts`
- `travelplan/src/app/(routes)/users/page.tsx`
- `travelplan/src/components/features/users/RegisteredUsersList.tsx`
- `travelplan/test/usersRoute.test.ts`
- `travelplan/test/registeredUsersList.test.tsx`

**Modified**

- `travelplan/src/lib/auth/tripAccess.ts` — appended `hasAnyOwnedTrip`; the four existing predicates
  and `getTripAccessForUser` untouched
- `travelplan/src/middleware.ts` — `isProtectedPath` also matches `/users`; matcher gained
  `"/users/:path*"`; `isProtectedApiPath` stays `/api/trips`-scoped
- `travelplan/src/components/features/trips/TripShareDialog.tsx` — one `target="_blank"` link to
  `/users` beneath the invite form; nothing else
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — 6 `users.registered.*` keys and
  `trips.share.viewRegisteredUsers`, additive only, both dictionaries (`users.registered.back` was
  added and then removed in review with the page's back button — see the Review Triage Log)
- `travelplan/test/middleware.test.ts` — two `/users` redirect cases, `/users` added to the
  matcher-coverage list, and a case pinning `/api/users` out of the matcher
- `travelplan/test/tripShareDialog.test.tsx` — one entry-point link case; existing cases untouched

## Review Triage Log

### 2026-08-03 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 0
- reject: 13
- addressed_findings:
  - `[medium]` `[patch]` `hasAnyOwnedTrip` was called outside the handler's `try`, so a Prisma failure there would escape the `{ data, error }` envelope as a framework 500 the clients cannot parse. Moved the ownership check inside the `try` in `travelplan/src/app/api/users/route.ts`.
  - `[medium]` `[patch]` The client collapsed `unauthorized` and `password_change_required` into "Unable to load registered users. Please refresh." — a dead end for the realistic case of a session expiring after the page loaded, since middleware guards the navigation but not the later XHR. Replaced the ternary with the `switch (body.error?.code)` idiom the other 12 client components use, mapping both codes to `errors.unauthorized`. Task 4's "any other error code → loadError" instruction is superseded by this. Covered by two new cases in `travelplan/test/registeredUsersList.test.tsx`.
  - `[medium]` `[patch]` The response carried no `Cache-Control`, leaving freshness and privacy for a body containing every email address in the system to the *client's* `cache: "no-store"` alone. Added `{ headers: { "Cache-Control": "no-store" } }` to the `ok()` call, matching the print and CSRF routes, with a new assertion in `travelplan/test/usersRoute.test.ts`.
  - `[low]` `[patch]` The share-dialog link set `px: 0` on a `variant="text"` Button, overriding the theme's `paddingInline: 20` and shrinking the horizontal hit target to the text width — the exact regression `DESIGN.md:280` names for this dialog. Dropped `px: 0`.
  - `[low]` `[patch]` The `/users` page shipped an outlined `← Back to trips` button, reintroducing the breadcrumb Story 6.20 removed from the trip detail shell in favour of the global `HeaderMenu`'s `/trips` row — which `(routes)/layout.tsx` renders on this page too. Neither sibling page has one. Removed the button and the now-orphaned `users.registered.back` key from both dictionaries; the page shell became synchronous, dropping its `getServerT()` call. This narrows Task 3's "back `Button`/`Link` to `/trips`" instruction, which predated awareness of 6.20's committed state.
  - `[low]` `[patch]` A `200` whose payload omitted `users` rendered as "No accounts registered yet." — an affirmative claim about the system made from a broken contract. A non-array `users` now sets the error state. New case in `travelplan/test/registeredUsersList.test.tsx`.
  - `[low]` `[patch]` `stubFetch`'s docstring claimed the component "fetches `/api/users` once on mount and nothing else" with no assertion behind it. Added `toHaveBeenCalledTimes(1)` to the freshness case.

**Deferred (0):** the one pre-existing issue raised — the repository is not typecheck-clean, `npx tsc --noEmit` reporting 143 errors, all in test files and none in any file this story touches — is already tracked as **DW-95** in `deferred-work.md` with the identical count and diagnosis. Confirmed still pre-existing here rather than logged twice.

**Rejected (13), the two worth naming:**

- *"The ownership gate is a speed bump"* — `hasAnyOwnedTrip` is satisfied by owning any trip, registration is public, and `POST /api/trips` lets any signed-in account create one, so the real precondition for reading every email is register → create a throwaway trip. This is accurate, but it is the feature `epics.md` asked for: AC1–AC5 are verbatim from the epic and the Scope note fixes the gate as trip ownership with exactly one possible reading. The change implements the decision rather than exposing a gap in it, so there is nothing here for a loopback to resolve. Carried into Residual Risks instead — it is a product-level call for the owner, not a defect in this diff.
- *"`Promise<RegisteredUser[]>` does not structurally enforce AC7"* — true (a widened `select` still compiles), but the explicit Prisma `select` *is* the mechanism AC7 names, and `usersRoute.test.ts` asserts the key set positively and negatively. Adding a `.map()` re-projection would be redundancy, not enforcement.

The other ten were noise or explicitly out of scope: pagination/`take` (Scope note forbids it), `AbortController`/fetch timeout (no component in this codebase uses one; the `active` flag is the established idiom), a named `target` for the new tab (AC6's test pins `_blank`), `startsWith("/users")` being a looser prefix than the matcher (inert, and identical to the existing `/trips` predicate), SQLite's binary sort on mixed-case emails (normalised at the only creation path), the pinned `credentials: "include"`, per-element payload validation, list-style duplication with `TripShareDialog`, the `RegisteredUser` type existing in three places, and the absence of a test for the page shell (now a bare `Container` + list).

### 2026-08-03 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 1 (high 0, medium 0, low 1)
- reject: 14
- addressed_findings:
  - `[medium]` `[patch]` `/users` had no `h1`. The card title rendered as `variant="labelCaps" component="div"`, and since the page shell contributes no heading either, the whole document outline for the route was empty — the one authenticated page in the app in that state. `labelCaps` has no `variantMapping`, so the element has to be explicit; `component="h1"` now matches the identical pairing at `TripDayMapFullPage.tsx:378` and `TripOverviewMapFullPage.tsx:137`, where a label-styled string is likewise doing page-title duty.
  - `[low]` `[patch]` The blocked state and the failure state both rendered `<Alert severity="error">`. Introducing `forbidden` as a new code was justified by the UI needing to tell "you may not see this" apart from a failure, and identical red chrome spent that distinction on the message string alone. The blocked state is now `severity="info"`: nothing went wrong for a non-owner, and the state is not theirs to retry.
  - `[low]` `[patch]` The comment on `isProtectedApiPath` in `travelplan/src/middleware.ts` was wrong as written — "`/api/users` is checked first here" names the wrong subject, and the reason `/api/users` escapes is that neither prefix matches it *and* that it is absent from `config.matcher`. Rewritten to say both.
  - `[low]` `[patch]` No test held an account that owns a trip **and** is a member of someone else's. Every existing case has the two conditions cleanly separated, so a gate that learned to read `TripMember` would keep the suite green. New case in `travelplan/test/usersRoute.test.ts` asserting that caller gets `200`.
  - `[low]` `[patch]` The `loading` member of the state union had no test, and `users.registered.title`/`users.registered.subtitle` had no reader in any test — `i18nDictionaries.test.ts` only checks key-set parity, so a key nothing renders looks identical to one that works. New case in `travelplan/test/registeredUsersList.test.tsx` pins the spinner, the `h1`, and the subtitle against a never-resolving fetch.

**Deferred (1):** logged as **DW-145** — no route handler anywhere in `src/app/api` logs the error it converts into a 500 (`grep -rn "console\.\|logger" src/app/api src/lib` returns nothing). Pre-existing and repo-wide; `/api/users` inherits the established skeleton exactly. Recorded because this is the one read that leaves the caller's trip graph, so a failure here is the one most worth attributing.

**Rejected (14), the four worth naming:**

- *"No rate limit on the endpoint"* — `checkRateLimit` exists (`src/lib/security/rateLimit.ts`) and all five auth routes use it, so the omission is real, but it buys nothing here: a **single** authorised request already returns every email in the system. Throttling repeat calls does not reduce a disclosure that is complete on the first one. The exposure is the feature the epic specified; the mitigation the story chose is AC7's payload floor.
- *"`listRegisteredUsers` needs a `take` cap"* — a cap without pagination would silently truncate, and AC4 requires the list to reflect **every** account. Adding one would trade a scaling concern for an incorrect answer.
- *"Widen `isProtectedApiPath` to `/api`"* — Task 3 requires it stay `/api/trips`-scoped, and the API route self-guards by design. The new matcher test pins that contract rather than papering over a defect.
- *"The `unauthorized` state is a dead end with no sign-in link"* — overstated. `(routes)/layout.tsx` renders `AppHeader` on this page, whose menu carries a `/trips` row and a logout action; `/trips` bounces an expired session to `/auth/login` through the middleware. The recovery path is the same one every other page in the app relies on.

The other ten repeated findings this story's first pass already rejected (`AbortController`/timeout, per-element payload validation, the `RegisteredUser`/`ApiEnvelope` type copies, list-style duplication with `TripShareDialog`, the ownership gate being satisfiable by creating a throwaway trip — carried in Residual Risks) or named repo-wide conventions this story is not the place to change (route suites asserting against global table state under `fileParallelism: false`, German strings covered only by key-set parity, `Cache-Control` absent from the failure envelopes — a 403 is not heuristically cacheable, `maxWidth="md"` against the siblings' `"lg"` — a single-column email list, and a stale-session JWT whose `sub` is a deleted user reporting as `forbidden` rather than `unauthorized`, which every other route does too).

## Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev. AC1–AC5 copied verbatim from `epics.md:1176-1196`; AC6–AC8 derived because the epic ACs describe a surface with no route, no endpoint, and no ownership predicate in the codebase, and because a system-wide user listing needs an explicit payload-minimization floor — see the Scope note.
- 2026-08-03: Implemented and reviewed via bmad-dev-auto. No spec amendment was needed (0 intent_gap, 0 bad_spec), so no loopback ran. Two Task-level instructions were narrowed by review patches and are recorded in the Review Triage Log rather than rewritten above: Task 3's back link (removed — Story 6.20's convention) and Task 4's "any other error code → loadError" (superseded — `unauthorized` and `password_change_required` now map to `errors.unauthorized`).
- 2026-08-03: Follow-up review pass via bmad-dev-auto (the run that recommended it). Again 0 intent_gap and 0 bad_spec, so no loopback ran and no Task instruction was narrowed. Five patches (1 medium, 4 low) and one pre-existing finding deferred as DW-145. The medium was an accessibility defect no AC names: `/users` shipped without an `h1`.

## Auto Run Result

Status: done

### Summary

Follow-up review of the shipped Story 5.8 change — the `/users` registered-users overview, its
owner-gated `GET /api/users`, and the share-dialog entry point. No spec-level problem was found and no
code was re-derived. Five patches landed: one accessibility defect (the page had no `h1` at all), one
state-distinction fix (`blocked` no longer wears the same red error chrome as a failure), one wrong
comment in `middleware.ts`, and two coverage gaps that would have let a future gate refactor pass.

### Files changed in this pass

- `travelplan/src/components/features/users/RegisteredUsersList.tsx` — card title promoted to
  `component="h1"`; blocked state moved from `severity="error"` to `severity="info"`
- `travelplan/src/middleware.ts` — corrected the comment on `isProtectedApiPath`; no behavior change
- `travelplan/test/usersRoute.test.ts` — new case: an owner who is *also* a viewer on someone else's
  trip still gets `200`
- `travelplan/test/registeredUsersList.test.tsx` — new case pinning the loading spinner, the `h1`, and
  the subtitle against a never-resolving fetch
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-145 appended

### Review findings

5 patches applied (1 medium, 4 low), 1 deferred (DW-145), 14 rejected, 0 intent_gap, 0 bad_spec. No
repair loopback ran. Ten of the fourteen rejections repeat findings the first pass already dismissed or
name repo-wide conventions out of this story's scope; the four worth naming are written out in the
Review Triage Log above.

### Verification

- `npm test` — **110 files / 1080 tests, all passing** (1078 before this pass, +2 from the new cases)
- The four touched suites run in isolation first — `usersRoute`, `registeredUsersList`, `middleware`,
  `tripShareDialog`: 46 tests, all passing
- `npm run lint` — 2 errors / 83 warnings, unchanged from the previous pass; both errors are the
  pre-existing `react/no-children-prop` in `src/theme.ts`
- `npx tsc --noEmit` unchanged at 143 pre-existing errors (DW-95); none in any file this story touches
- Verified each reviewer claim against the codebase before acting: `checkRateLimit`'s existence and its
  five call sites, the `component="h1"` convention across `TripsDashboard`/`TripOverviewMapFullPage`/
  `TripDayMapFullPage`, `severity="info"` precedent, `errors.unauthorized` present in both dictionaries,
  `Container maxWidth` on all sibling routes, `AppHeader` being rendered by `(routes)/layout.tsx`, and
  the absence of any logging call in `src/app/api` and `src/lib`

### Residual risks

- **The ownership gate is weaker than it reads** — unchanged from the first pass and re-raised
  independently by both reviewers this time. Registration is public and any signed-in account can
  create a trip, so the real precondition for reading every email in the system is: register → create
  one throwaway trip → `GET /api/users`. This is what `epics.md` specified and AC7's payload
  minimisation is the mitigation the story chose. Rate limiting was considered and rejected as
  ineffective: one request already returns the whole list. If the intent was "only established owners",
  the gate needs a product decision, not a code fix.
- **`listRegisteredUsers` has no ceiling.** Correct for AC4 as written — the list must reflect every
  account — but it means payload size and render cost grow linearly with registrations, with no
  virtualisation on the client. Fine at this app's scale; it is the first thing to revisit if the
  account count ever stops being small.
- **No server-side record of a failure on this route** (DW-145). Repo-wide, not specific to 5.8.

