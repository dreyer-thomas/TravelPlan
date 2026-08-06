---
authored_against: 51664d8
baseline_commit: 51664d8629ac2a827ea07e96ccc5c59a9cbd81b8
---

# Story 5.12: Shared Trips on the Collaborator's Dashboard

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ This is a live production defect

Observed on production 2026-08-06. An invited collaborator signed in, saw an empty dashboard, and concluded the invitation had failed. The trip owner then deleted the account and re-invited from the trip's own share dialog; the collaborator changed the temporary password and still saw nothing. Neither step could have helped — the invitation was never broken.

The collaborator has full read access the whole time. `getTripWithDaysForUser` (`tripRepo.ts:808`), the accommodation, plan-item, travel-segment, cost and route repositories all authorise with `OR: [{ userId }, { members: { some: { userId } } }]`. The trip opens correctly by direct URL. Only the dashboard — the single surface offered after sign-in — filters on ownership alone (`tripRepo.ts:652`), so there is no way in.

**The gap was known and twice deferred.** Story 7.4 recorded it while redesigning this very list (*"a real product gap, it is **not** in this story's ACs […] note it for the backlog"*, `7-4-trips-list-redesign.md:171`), and Story 7.5 declined it again as out of scope for the share dialog (`:202`). Neither note ever reached `deferred-work.md` or the sprint plan, which is why a real user found it instead. When this ships, that history is worth one ledger entry so the next deferral is not lost the same way.

## Story

As someone who has been invited to another person's trip,
I want that trip to appear in my trip list after I sign in,
so that I can reach it at all without being sent a link every time.

## Acceptance Criteria

1. **AC1** — An account holding a `VIEWER` or `CONTRIBUTOR` membership on somebody else's trip sees that trip in its trip list, alongside any trips it owns, reachable without a direct link.
2. **AC2** — Every entry in the trip list payload states whether the account owns the trip or holds a membership on it, and with which role. The list cannot present the two as the same thing.
3. **AC3** — A shared trip is visibly distinguishable from an owned trip on the dashboard, and a `VIEWER` is offered no action their role forbids — deletion in particular is never offered on a trip the account does not own.
4. **AC4** — An account with no trips of its own and no memberships still sees the existing empty state. The widened query must not turn "nothing to show" into an error.
5. **AC5** — The list returns each trip exactly once for an account that both owns trips and holds memberships, and a route test proves an account never sees a trip it neither owns nor holds a membership on.
6. **AC6** — The dashboard's aggregate figures (`Active trips`, `Costs so far (all trips)`, `Open items`, and the sub-line trip count) describe the list as rendered, shared trips included. A number that disagrees with the rows beneath it is worse than one that mixes ownership.
7. **AC7** — The role labels reuse the existing `trips.share.roleViewer` / `trips.share.roleContributor` keys rather than adding parallel vocabulary. If any new user-facing string is introduced, it exists in **both** `en.ts` and `de.ts`, held in agreement by `test/i18nDictionaries.test.ts`.

## Tasks / Subtasks

- [ ] `src/lib/repositories/tripRepo.ts` — widen `listTripsForUser` (`:644`) to `where: { OR: [{ userId }, { members: { some: { userId } } }] }`, and **select the membership in the same query** so the role is known without a second round trip. The function uses `include:` (not `select:`), so add the relation inside the existing `include` block: `members: { where: { userId }, select: { role: true }, take: 1 }`. Because it is `include`, every scalar — `trip.userId` included — is already on the result, so no extra field is needed to compare ownership — AC1, AC2, AC5
- [ ] `src/lib/repositories/tripRepo.ts` — derive the role in the `.map()` with **exactly** the expression `getTripWithDaysForUser` already uses (`:890-891`): `trip.userId === userId ? "owner" : mapTripMemberRole(trip.members[0]?.role ?? "VIEWER")`, calling the **file-local** `mapTripMemberRole` at `:570`. Using the same expression is what keeps the two surfaces from drifting apart — AC2
- [ ] `src/lib/repositories/tripRepo.ts` — add `accessRole: TripAccessRole` to the exported `TripSummary` type (`:51`). `TripAccessRole` is **already imported** at `:7` (type-only); no new import is needed. **Do not declare a new role union here.** — AC2
- [ ] `src/lib/repositories/tripRepo.ts` — **rewrite the comment above the `where` clause** (`:648-650`). It currently reads *"The `where`/`orderBy` stay as they are - shared trips are deliberately not listed here (see the story's Dev Notes)"* and becomes a lie the moment the clause changes. Replace it with what the clause now does and why the membership is selected in the same query. Keep the surrounding note about `orderBy` staying ascending and past-trips-last being applied client-side — that part is still true — AC1
- [ ] `src/app/api/trips/route.ts` — add `accessRole: trip.accessRole` to the `GET` handler's explicit field map (`:85-101`). The handler maps every field by hand; a field absent from that map is silently dropped and the dashboard receives `undefined` with no type error — AC2
- [ ] `test/tripsListRoute.test.ts` — **the exact-key-set assertion at `:92-107` will fail the moment the route gains a field, and that is the test doing its job.** Add `"accessRole"` to that array and to the file-local `TripListEntry` type (`:12-25`). Do **not** delete or loosen the assertion — its docblock (`:74-75`) records that a missing field on this route is invisible to the component suites, and it is the only thing that catches it — AC2
- [ ] `src/components/features/trips/TripsDashboard.tsx` — extend the **locally declared** `TripSummary` type (`:30`) with the role. Follow the sibling components' convention and declare the union inline — `accessRole?: "owner" | "viewer" | "contributor"` — exactly as `TripTimeline.tsx:50` and `TripDayView.tsx:285` do; client components in this tree do not import `TripAccessRole`. Add it to `handleTripCreated`'s reconstructed summary (`:141-156`) as `"owner"` — a trip the account just created is always its own — AC2
- [ ] `src/components/features/trips/TripsDashboard.tsx` — mark shared rows with a role pill in the existing `status` grid area (`:602-618`), beside `statusPill`. Reuse the share dialog's role palette (see Dev Notes → *Reuse, do not reinvent*); **owned rows get no pill at all**. Do not add a grid area — the `status` area already holds a pill at both breakpoints (`:467-470`) — AC3
- [ ] `test/tripsDashboard.test.tsx` — **add `accessRole: "owner"` to the `trip()` fixture's defaults (`:13-27`) before writing anything new.** Every existing case builds its rows from that factory; without the default they all arrive role-less and, under this story's fallback rule, render as *shared* — silently changing what a dozen unrelated assertions are looking at — AC3, AC4
- [ ] `test/tripsDashboard.test.tsx` — the render cases: a shared row is distinguishable from an owned row, a viewer row offers nothing a viewer may not do, and the empty state is unchanged for an account with neither trips nor memberships. `test/tripTimelineRoles.test.tsx` is the established pattern for asserting `accessRole`-scoped UI — read it first — AC3, AC4
- [ ] `test/tripsListRoute.test.ts` — the payload cases: a member sees the trip, the role is reported as `viewer`/`contributor`, an owner is reported as `owner`. The AC5 negative already exists as *"does not return another user's trips"* (`:157`) — it must stay green; extend it with a third account holding no membership rather than writing a second copy — AC1, AC2, AC5
- [ ] `test/tripsListRoute.test.ts` — the duplication case: an account that owns trip A **and** holds a membership on trip B receives exactly two entries, and an account holding a membership on a trip it also owns receives that trip **once**, reported as `owner` — AC5
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` — append `### DW-199` recording that Stories 7.4 and 7.5 both deferred this gap without a ledger entry, so the next deferral of a real defect is filed rather than lost. Follow the `DW-19x` field shape: `origin`, `location`, `severity`, `summary`, `evidence`, `status` (there is no `source_spec` — this story has no spec file). Note the file's tail currently ends with two un-numbered legacy-format entries; append **after** them with a proper `###` heading

## Dev Notes

### Read this first: `grep` lies about `tripRepo.ts`

`src/lib/repositories/tripRepo.ts` contains a byte that makes `file(1)` classify it as `data`, so **plain `grep` treats it as binary and silently prints nothing** — not an error, not a warning, just no matches. Every search in this file needs `grep -a`:

```
LC_ALL=C grep -an "listTripsForUser" src/lib/repositories/tripRepo.ts
```

The Read tool is unaffected. Every line number in this story was verified with `-a` at `51664d8`.

### The one-line change and the three files that must follow it

Widening the `where` clause is the smaller half. `TripSummary` carries no `accessRole` today, so a widened list without the rest of the work renders somebody else's trip in a card identical to the user's own. The shape is declared in **three** places and every one has to gain the field, or it is dropped silently between the database and the screen:

| File | What it is |
|---|---|
| `src/lib/repositories/tripRepo.ts:51` | the exported `TripSummary` |
| `src/app/api/trips/route.ts:85-101` (GET) | an explicit by-hand field map — omission here is silent |
| `src/components/features/trips/TripsDashboard.tsx:30` | a local re-declaration of the same shape |

That third copy is the project's existing convention, not an accident. Follow it; **do not** refactor the three into one shared type in this story.

### Reuse, do not reinvent

The vocabulary already exists — all of it. Note carefully where each piece lives; two are not where you would first look.

- **`TripAccessRole`** = `"owner" | "viewer" | "contributor"`, exported from `src/lib/auth/tripAccess.ts:3`. `tripRepo.ts` already imports it type-only at `:7`. The field name `accessRole` and these three values are what `/api/trips/[id]/route.ts` returns and what `TripTimeline.tsx` and `TripDayView.tsx` consume. Same name, same values, so a component can move between surfaces without a translation layer.
- **`mapTripMemberRole` is NOT exported from `tripAccess.ts`.** It is module-private there (`:18`). `tripRepo.ts` carries its **own copy** at `:570`, and that local one is what `getTripWithDaysForUser` calls at `:891`. Call the local copy. Importing the `tripAccess` one will not compile, and adding a third copy is the mistake this note exists to prevent. The Prisma enum values (`VIEWER`/`CONTRIBUTOR`) must never reach the payload.
- **The role pill already has a palette.** `TripShareDialog.tsx:87-123` defines `RoleBadge` — `contributor` = `theme.palette.primary.main` on `primary.contrastText`, `viewer` = `tokens.accentSoft` on `primary.main` — at `borderRadius: "5px"`, `fontSize: 10.5`, `fontWeight: 800`, `letterSpacing: "0.04em"`, uppercase. It is module-private and Story 7.5 recorded the reason (*"the role-badge variant map is presentational and belongs in the component"*), so **re-express those two variants locally in `TripsDashboard.tsx` rather than exporting `RoleBadge`.** Two colour pairs, no new abstraction.
- **The role words already exist in both dictionaries**: `trips.share.roleViewer` (`Viewer` / `Betrachter`) and `trips.share.roleContributor` (`Contributor` / `Mitwirkender`) at `en.ts:227-228` and `de.ts:216-217`. Reuse them. Adding `trips.dashboard.role*` duplicates live vocabulary, and the same role reading as two different words on two surfaces is the exact confusion Story 5.10's review found and pinned.
- **`canTripAccessRoleWrite` / `canTripAccessRoleManageTrip`** are exported but have no consumer outside `tripAccess.ts` — they back the server-side per-trip guards. The UI convention is a plain inline comparison (`accessRole === "owner"`, `accessRole !== "viewer"`, as in `TripTimeline.tsx:144-145`). Follow the UI convention; do not introduce these predicates into a component.

Do **not** call `getTripAccessForUser` per row. It issues its own query per trip, and this is the landing surface; the membership comes back with the list query in a single round trip.

### Do not use the `owner` badge variant here

`RoleBadge` has a third variant — `owner` = `tokens.warnBg` on `warning.main` — and its docblock calls it *"the one sanctioned non-gap use of the warn family in this system"*. **It must not follow the pill onto a trip row.** DESIGN.md reserves the warn family exclusively for the gap/open-item state (*"never used decoratively or for anything that isn't an actionable gap"*), and `trip-row` already spends warn on exactly that: a gap row swaps its border and background to the warn treatment and its status pill to `tokens.warnBg`. A warn-toned owner badge would put two unrelated meanings in one colour, inside one row.

This costs nothing, because **owned rows carry no role pill at all.** The absence is the signal — the same way the share dialog's owner row is the one with no remove button. A pill appears only when the trip is somebody else's, which is also the only case AC3 asks to mark.

### The fallback direction is different here

`TripTimeline.tsx:144-145` and `TripDayView.tsx:598-599` both read:

```ts
const isOwner = detail?.trip.accessRole ? detail.trip.accessRole === "owner" : true;
```

An absent `accessRole` means *owner* there, because those components predate the field and a cached older payload had to keep working for the trip's own owner. **Do not copy that direction onto the list.** On the dashboard every entry carries the field by construction, and defaulting an unknown row to "owner" would present someone else's trip as the user's own — the exact failure this story exists to prevent. If the field is missing, treat the row as not-owned.

`TripShareDialog.tsx:399-401` states the same principle as a rule, and it is the one to follow: *"An unrecognised role must not be presented as the more privileged one."*

### The dashboard has no destructive actions — do not go looking for them

AC3 says a viewer must be offered no forbidden action. On this surface that is almost entirely a *visual* requirement. The whole card is one overlay `Link` to `/trips/{id}` (`TripsDashboard.tsx:524-529`) over a four-area grid — photo, title, status, cost — ending in a chevron (`:660`). There is no menu, no delete, no edit, no per-row control of any kind. Trip deletion and editing live on the trip overview page, which already gates on `accessRole` (`TripTimeline.tsx:443-473`). So do not hunt for buttons to hide here — mark the row, and stop.

The two header buttons ("Add trip", "Import") stay visible for everyone. A member-only account may legitimately create or import its own trip; both paths write with `userId` from the session and produce a trip the account owns.

One detail if you touch the `status` area: it sets `pointerEvents: "none"` with `"& a, & button": { pointerEvents: "auto" }` so the full-row link stays clickable through it (`:611-614`). A non-interactive `Box` pill is correct there and needs no opt-in.

### What the aggregate figures must do (AC6)

The strip above the list reports `Active trips`, `Costs so far (all trips)` and `Open items`, and the sub-line reports `{tripCount} trips · {gapTripCount} with open items`. All are computed from `trips` (`:186-204`) — so widening the query changes them for free.

Leave that. The strip is a caption for the list directly beneath it, and a count that excludes rows the user can see is a bug report waiting to be filed. `openItems` is already scoped to `gap` trips only (`:198`), which keeps a viewer's shared trip from turning the cell warn-orange merely for existing.

### What must not regress

- **The empty state.** `listEmpty` is `!loading && trips.length === 0 && !error` (`:124`). An account with nothing still gets `trips: []` and 200 — the widened `OR` must not become a query that errors on an account with no memberships.
- **Ordering.** `buildTripComparator` (`:55-61`) sorts client-side (non-past first ascending, past last descending) and the repository's `orderBy: { startDate: "asc" }` stays. Shared trips sort by the same rule; they are **not** a separate group.
- **Cost semantics.** `listTripsForUser` mirrors `getTripWithDaysForUser`'s visible-cost rules verbatim (`:665-673`) — a stay with a blank name contributes neither cost nor "has accommodation". That mirroring is deliberate so the same trip reads identically on both surfaces. Do not touch it.
- **The hero cache-buster.** `updatedAt` versions the otherwise-stable `hero.<ext>` URL via `withImageCacheBuster` (`:538-540`). Shared trips carry hero images too.
- **`hasAnyOwnedTrip` stays as it is.** It exists to keep members out of a surface with no `tripId` to scope, and `/api/users/route.ts:38` is its only caller. Nothing here should widen it or start calling it.

### Traps

1. **The exact key-set test fails first, and correctly.** `tripsListRoute.test.ts:92-107` pins the payload's key list. Adding `accessRole` to the route turns it red — add the key to the array and to `TripListEntry` (`:12-25`); never loosen the assertion.
2. **The dashboard fixture defaults.** `tripsDashboard.test.tsx`'s `trip()` factory (`:13-27`) feeds every existing case. Give it `accessRole: "owner"` in the same edit that teaches the component about roles, or a dozen unrelated assertions start describing shared rows.
3. **A field dropped in the route map.** `GET /api/trips` maps every field by hand. Adding `accessRole` to `TripSummary` and forgetting the route compiles cleanly and ships a dashboard where every row is role-less. Trap 1's assertion is what catches this — which is why it must survive.
4. **Duplicate rows.** Prisma compiles a relation filter inside `OR` to an `EXISTS` subquery, so a trip matching both arms returns once. Worth *proving* rather than trusting: AC5 asks for the test because the failure mode is a user seeing their own trip twice.
5. **The two suites with almost the same name.** `test/tripsListRoute.test.ts` (169 lines, five cases, the key-set pin and the AC5 negative) is the one to extend. `test/tripListRoute.test.ts` (70 lines, one `heroImageUrl` case, a partial inline payload type) will not break and should be left alone. **Do not add a third.**
6. **`tokens` throw under a bare theme.** Any suite rendering `TripsDashboard` must use `renderWithProviders` — a component reading `theme.palette.tokens.*` throws under MUI's default theme. `tripsDashboard.test.tsx` already does; keep it that way.
7. **Dictionary parity.** `test/i18nDictionaries.test.ts:25` holds `en.ts` and `de.ts` in agreement, and the file has a standing convention of pinning *deleted* keys so orphans cannot return. Reusing `trips.share.role*` sidesteps both risks; introducing new keys means both files, same edit.
8. **No membership cleanup is needed in test setup.** `TripMember` declares `onDelete: Cascade` on both relations (`prisma/schema.prisma:124-125`), so the existing `beforeEach` chains that end in `prisma.user.deleteMany()` already take memberships with them. Do not add a redundant `tripMember.deleteMany()`.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`, one file per subject. Route suites build a session with `createSessionJwt` and drive the exported handler directly (see `tripsListRoute.test.ts`); component suites use `renderWithProviders` with `// @vitest-environment jsdom` (see `tripsDashboard.test.tsx`). `test/tripTimelineRoles.test.tsx` is the closest precedent for asserting `accessRole`-scoped UI — read it before writing the dashboard cases.

Story 9.2 recorded **1389 tests across 119 files** green at its close. Re-measure the baseline yourself before starting rather than assuming that number, and report it after; the project tracks it story to story. Also run `npx tsc --noEmit -p .` and `eslint` on the touched files, both from `travelplan/`.

### Project Structure Notes

No new files, no new directories, no new dependencies, no migration. The `TripMember` rows this story reads are already created by Stories 5.1, 5.4 and 5.6, and `prisma/schema.prisma:108` already declares `Trip.members`. Everything here is an edit to three existing source files and three existing test files, plus the ledger.

### References

- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 5.12: Shared Trips on the Collaborator's Dashboard]
- The gap, first recorded: [Source: _bmad-output/implementation-artifacts/7-4-trips-list-redesign.md] — `:171` (*"That is a real product gap, it is **not** in this story's ACs"*) and `:282` (noted for the backlog in the Dev Agent Record, where it stopped)
- The gap, deferred again: [Source: _bmad-output/implementation-artifacts/7-5-share-dialog-redesign.md] — `:202` (*"A real product gap, recorded by 7.4 for the backlog, and firmly not this story"*); `:230` names the trip-status pill as this system's badge precedent
- Role badge palette and the warn reservation: [Source: _bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md] — `:258` (badge/pill, role badge variants), `:221-222` (warn reserved for gaps only), `:265-267` (`trip-row` anatomy)
- Membership model and invite flow: [Source: _bmad-output/implementation-artifacts/5-1-invite-viewer-or-contributor-by-email-with-temp-password.md]
- Contributor permissions: [Source: _bmad-output/implementation-artifacts/5-4-contributor-full-edit-permissions.md]
- Ownership vs membership, stated as a rule: [Source: _bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md] — its review finding on collapsing the two words into one is the same confusion this story must not reintroduce on the card
- FR29 (share with a viewer), FR30 (viewers see but cannot edit), FR32 (contributor role): [Source: _bmad-output/planning-artifacts/prd.md:267-270]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
