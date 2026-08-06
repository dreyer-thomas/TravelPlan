---
title: 'Story 5.12: Shared Trips on the Collaborator''s Dashboard'
type: 'bugfix'
created: '2026-08-06'
baseline_revision: f990054
final_revision: 50b2ddd
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** `listTripsForUser` (`tripRepo.ts:644`) is the only trip read in the codebase still filtering on ownership alone (`where: { userId }`), while every other read authorises with `OR: [{ userId }, { members: { some: { userId } } }]`. A live production defect (observed 2026-08-06): an invited collaborator signs in, the dashboard — the only surface offered after sign-in — is empty, and the invitation looks broken although the trip opens fine by direct URL.

**Approach:** Widen the list query to owner-OR-member, select the membership in the same round trip, and carry a per-entry `accessRole` through the repository type, the GET route's by-hand field map and the dashboard's local type, so a shared row is marked with a role pill and can never be mistaken for the account's own trip.

## Boundaries & Constraints

**Always:** Reuse the existing vocabulary — `TripAccessRole` (`"owner" | "viewer" | "contributor"`), the file-local `mapTripMemberRole` (`tripRepo.ts:570`), and the dictionary keys `trips.share.roleViewer` / `trips.share.roleContributor`. Derive the role with the *exact* expression `getTripWithDaysForUser` uses at `:890-891`. On this surface an absent or unrecognised `accessRole` means **not owned** — never the more privileged reading.

**Block If:** nothing. No human-only action, no vendor console, no credential, no migration, no new dependency is involved.

**Never:** Do not refactor the three `TripSummary` declarations into one shared type — the triplication is this project's convention. Do not export `RoleBadge` from `TripShareDialog.tsx` (Story 7.5 pinned it as presentational); re-express the two variants locally. Do not use the `owner`/warn badge variant on a trip row — warn is reserved for the gap state and `trip-row` already spends it there. Do not touch `hasAnyOwnedTrip` (`src/lib/auth/tripAccess.ts:85-92`), the visible-cost mirroring (`tripRepo.ts:665-673`), `buildTripComparator`, or the `orderBy`. Do not call `getTripAccessForUser` per row. Do not add a case to `test/tripListRoute.test.ts` (singular) or create a third list-route suite.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner lists | account owns trip A | one entry, `accessRole: "owner"` | none |
| Member lists | account holds `VIEWER` on trip B | trip B present, `accessRole: "viewer"` | none |
| Contributor lists | account holds `CONTRIBUTOR` on trip B | `accessRole: "contributor"` — never the Prisma enum `CONTRIBUTOR` | none |
| Owner + member | owns A, member of B | exactly two entries, correctly labelled | none |
| Owner who is also a member | owns A *and* holds a membership on A | A returned **once**, as `"owner"` | none |
| Stranger | account neither owns nor is a member of trip C | C absent | none |
| Nothing at all | no trips, no memberships | `trips: []`, HTTP 200, existing empty state | must not error |
| Row without the field | `accessRole` missing on a rendered row | treated as **shared**, viewer pill | none |

</intent-contract>

## Code Map

Line numbers verified against HEAD `f990054`. **`tripRepo.ts` reads as binary to `grep`** — always `LC_ALL=C grep -an`; the Read tool is unaffected.

- `travelplan/src/lib/repositories/tripRepo.ts` -- `TripSummary` (`:51-79`, 12 fields, no role today); `mapTripMemberRole` (`:570`, file-local, not exported — `tripAccess.ts`'s copy is module-private and will not import); `listTripsForUser` (`:644-694`); the six-line comment above the `where` (`:645-650`) whose tail claims shared trips are deliberately excluded; `getTripWithDaysForUser`'s query (`:806-822`) and role derivation (`:890-891`) — the pattern to copy; `TripAccessRole` already imported type-only at `:7`
- `travelplan/src/app/api/trips/route.ts` -- `GET` maps every field by hand (`:85-101`); an omission here is silent and type-clean
- `travelplan/src/components/features/trips/TripsDashboard.tsx` -- local `TripSummary` (`:30-46`, optional fields carry an "older cached payload still renders" rationale); `handleTripCreated` (`:141-156`); `statusPill` definition (`:206`); aggregates (`:182-204`); `listEmpty` (`:124`); grid areas (`:467-470`); the `status` area Box and its `pointerEvents` pairing (`:602-618`)
- `travelplan/src/components/features/trips/TripShareDialog.tsx` -- `RoleBadge` (`:87-123`): `contributor` = `primary.main` on `primary.contrastText`; `viewer` = `tokens.accentSoft` on `primary.main`; `borderRadius: "5px"`, `padding: "5px 10px"`, `fontSize: 10.5`, `fontWeight: 800`, `letterSpacing: "0.04em"`, uppercase, `whiteSpace: "nowrap"`
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- precedent: `accessRole?` optional at `:50`, `isOwner` fails **open** at `:144-145`. That direction is wrong for the list; see Design Notes
- `travelplan/src/i18n/en.ts` / `de.ts` -- flat dotted keys. `trips.share.roleViewer` / `roleContributor` at `en:227-228` (`Viewer` / `Contributor`) and `de:216-217` (`Betrachter` / `Mitwirkender`). No new key is needed
- `travelplan/test/tripsListRoute.test.ts` -- 169 lines. `TripListEntry` (`:12-25`), exact-key-set pin (`:92-107`, docblock `:74-75`), AC5 negative (`:157-168`), helpers `buildRequest`/`createUser`/`createTrip`/`createDay` (`:27-54`), `beforeEach` truncation (`:57-63`)
- `travelplan/test/tripsDashboard.test.tsx` -- 512 lines. `trip()` factory (`:13-27`, untyped overrides), `FOUR_STATE_TRIPS` (`:30-62`), fetch router + fake timers (`:89-133`), `renderDashboard` (`:135`), `rowFor` (`:137-142`)
- `travelplan/test/tripTimelineRoles.test.tsx` -- the established pattern for asserting `accessRole`-scoped UI; read before writing the dashboard cases
- `travelplan/prisma/schema.prisma` -- `TripMember` (`:116-131`), `@@unique([tripId, userId])` (makes `take: 1` safe), `onDelete: Cascade` on both relations (`:124-125`), `Trip.members` (`:108`). No migration
- `_bmad-output/implementation-artifacts/deferred-work.md` -- ledger, tail currently ends with three un-numbered legacy entries after `### DW-198`

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- add `accessRole: TripAccessRole` to the exported `TripSummary` (`:51`). No new import, no new role union -- AC2
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- widen `listTripsForUser`'s `where` to `{ OR: [{ userId }, { members: { some: { userId } } }] }` and add `members: { where: { userId }, select: { role: true }, take: 1 }` inside the existing `include` block. Because it is `include` (not `select`), `trip.userId` is already on the result -- AC1, AC2, AC5
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- in the `.map()`, set `accessRole: trip.userId === userId ? "owner" : mapTripMemberRole(trip.members[0]?.role ?? "VIEWER")` -- byte-for-byte the expression at `:890-891`, calling the file-local `mapTripMemberRole`. Same expression on both surfaces is what stops them drifting -- AC2
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- rewrite the comment block at `:645-650`. Its last two lines ("shared trips are deliberately not listed here") become a lie the moment the clause changes. State what the clause now does and why the membership rides along in the same query; keep the `orderBy`/past-trips-last sentence, which is still true -- AC1
- [x] `travelplan/src/app/api/trips/route.ts` -- add `accessRole: trip.accessRole` to the GET field map (`:85-101`) -- AC2
- [x] `travelplan/test/tripsListRoute.test.ts` -- add `"accessRole"` to the key-set array (`:92-107`) and to `TripListEntry` (`:12-25`). The assertion going red first is it working; never loosen or delete it -- AC2
- [x] `travelplan/test/tripsListRoute.test.ts` -- payload cases: a `VIEWER` member sees the trip and is reported `viewer`; a `CONTRIBUTOR` is reported `contributor`; an owner is reported `owner`. Extend the existing "does not return another user's trips" case (`:157`) with a third account holding no membership rather than adding a parallel copy -- AC1, AC2, AC5
- [x] `travelplan/test/tripsListRoute.test.ts` -- duplication cases: an account owning A and holding a membership on B gets exactly two entries; an account holding a membership on a trip it also owns gets that trip once, as `owner` -- AC5
- [x] `travelplan/src/components/features/trips/TripsDashboard.tsx` -- extend the local `TripSummary` (`:30`) with `accessRole?: "owner" | "viewer" | "contributor"`, declared inline as `TripTimeline.tsx:50` does (client components here do not import `TripAccessRole`). Set `accessRole: "owner"` in `handleTripCreated`'s reconstructed summary (`:141-156`) -- AC2
- [x] `travelplan/src/components/features/trips/TripsDashboard.tsx` -- render a role pill for shared rows only, inside the existing `status` grid-area Box beside `statusPill` (`:602-618`); add a `gap` to that Box. Re-express the two `RoleBadge` variants locally (contributor / viewer values in the Code Map); give it `data-testid="trip-row-role"` and `data-role`, matching the `trip-row-status` convention. Owned rows get **no pill**. Do not add a grid area, do not opt into `pointerEvents` -- AC3
- [x] `travelplan/test/tripsDashboard.test.tsx` -- add `accessRole: "owner"` to the `trip()` factory defaults (`:13-27`) **in the same edit** as the component change; without it every existing case renders as shared under the fallback rule -- AC3, AC4
- [x] `travelplan/test/tripsDashboard.test.tsx` -- render cases: a shared row is distinguishable from an owned one (pill present / absent, correct role word from the shared dictionary keys); a viewer row offers nothing a viewer may not do; the empty state is unchanged for an account with neither trips nor memberships; the stat strip and sub-line count a shared trip -- AC3, AC4, AC6
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append `### DW-199` after the three un-numbered legacy entries at the tail, recording that Stories 7.4 (`:171`, `:282`) and 7.5 (`:202`) both deferred this gap with no ledger entry, so a real user found the defect instead. Follow the `DW-19x` field shape: `source_spec`, `origin`, `location`, `severity`, `summary`, `evidence`, `status`. Close it in the same edit — `status: **closed 2026-08-06** - fixed by Story 5.12 ...` (the ledger's existing closed-entry shape); the defect ships here, so what the entry preserves is the process failure, not open work. The story's task text says to omit `source_spec` "because this story has no spec file"; it now has one, so include it and point at this spec

**Acceptance Criteria:**
- Given an account holding a `VIEWER` or `CONTRIBUTOR` membership on somebody else's trip, when it signs in and opens the trip list, then that trip appears alongside any trips it owns and is reachable without a direct link. *(AC1)*
- Given the trip list payload, when it is returned, then every entry states whether the account owns the trip or holds a membership, and with which role — the two are never presented as the same thing. *(AC2)*
- Given a shared trip on the dashboard, when it is rendered, then it is visibly distinguishable from an owned trip and a viewer is offered no action their role forbids; deletion in particular is never offered on a trip the account does not own. *(AC3)*
- Given an account with no trips and no memberships, when it opens the trip list, then the existing empty state renders and the response is 200 — the widened query must not turn "nothing to show" into an error. *(AC4)*
- Given an account that both owns trips and holds memberships, when the list is returned, then each trip appears exactly once, and a route test proves an account never sees a trip it neither owns nor holds a membership on. *(AC5)*
- Given the aggregate strip (`Active trips`, `Costs so far (all trips)`, `Open items`) and the `{tripCount} trips · {gapTripCount} with open items` sub-line, when shared trips are listed, then the figures describe the list as rendered, shared trips included. *(AC6)*
- Given the role words on the dashboard, when they are rendered, then they come from `trips.share.roleViewer` / `trips.share.roleContributor`; if any new user-facing string is introduced it exists in **both** `en.ts` and `de.ts`, held in agreement by `test/i18nDictionaries.test.ts`. *(AC7)*

## Spec Change Log

## Review Triage Log

### 2026-08-06 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 5, low 5)
- defer: 6: (high 0, medium 3, low 3)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The dashboard's `/api/trips` fetch was the only authenticated GET in the tree without `cache: "no-store"`, and the inverted fallback made that consequential — a replayed pre-`accessRole` payload would put a viewer pill on every one of the owner's own trips. Added `credentials: "include", cache: "no-store"` to match every sibling fetch.
  - `[medium]` `[patch]` Two `nowrap` pills in one flex row with no wrap: `"Bevorstehend · Planung offen"` beside `MITWIRKENDER` exceeds a 320px phone's content box, and `minWidth: 0` does nothing for a `nowrap` child. Added `flexWrap: "wrap"` to the `status` column.
  - `[medium]` `[patch]` The role pill sits outside the row's overlay link, so a reader traversing by link list lost the owned/shared distinction entirely — AC3 was met visually and not otherwise. Added `trips.dashboard.openSharedTripAria` to both dictionaries and switched the shared row's accessible name to it, reusing the existing role words for the `{role}` slot.
  - `[medium]` `[patch]` `handleTripCreated`'s `accessRole: "owner"` was load-bearing and untested — deleting that one line puts a VIEWER pill on a trip the account just created. Pinned by a new create-path case.
  - `[medium]` `[patch]` The widened `where` was proven to admit through a membership and never to revoke. Added a route case that removes the membership and re-lists.
  - `[low]` `[patch]` German coverage stopped at `Betrachter`, the shorter of the two words and the one that does not stress the layout. Extended the dictionary case to assert `Mitwirkender` too.
  - `[low]` `[patch]` The comment on the `?? "VIEWER"` arm claimed it was unreachable while the `where` holds. Prisma loads a to-many `include` as its own query, so the `EXISTS` filter and the membership read are not atomic and a membership revoked between them lands there. Comment corrected to say "all but unreachable" and why.
  - `[low]` `[patch]` The local `TripSummary`'s optionality docblock inherited `updatedAt`'s "older cached payload" rationale, which does not hold — there is no service worker and the fetch now sends `no-store`. Restated as the real reason: a server not yet redeployed.
  - `[low]` `[patch]` This spec's Verification block demanded `tsc` "expected: no errors" against a project that has never been clean. Corrected to "no new errors, none in a touched file", with the 135-error baseline recorded.
  - `[low]` `[patch]` `sprint-status.yaml` still carried the story as `ready-for-dev`. Set to `done`, matching how Story 9.2 closed. The story file itself is left at `ready-for-dev` with unticked boxes, which is this project's actual precedent — `9-2-documents-in-print-and-an-offline-packet.md` sits that way at `f990054` while its spec and the sprint plan both read `done`.

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` The list disagreed with the app's own authoriser about one state. Prisma loads a to-many `include` as a separate statement, so a membership revoked between the `EXISTS` filter and the membership read returns a non-owned row with `members: []`; the `?? "VIEWER"` arm downgraded it to `viewer` and shipped that trip's name, dates, route and cost total to an account `getTripAccessForUser` answers `null` for — on a row that 404s when clicked. Now filtered out before the `.map()` rather than downgraded, and the comment on the fallback arm corrected to say it is unreachable and why it is kept.
  - `[medium]` `[patch]` `GET /api/trips` sent no `Cache-Control` while both sibling per-account list routes set `no-store` and document why. The change made the body strictly more sensitive — other people's trip names, routes, date ranges, cost totals — and `cache: "no-store"` on the client fetch governs only the browser's own cache, leaving a proxy no instruction. Header added, pinned by a route case.
  - `[medium]` `[patch]` The new German string was the only formal-*Sie* value in a dictionary that is *du* throughout (`de.ts:19`, `:137`, `:207`, `:762`), and it lands on the one string delivered exclusively to screen-reader users. Changed to `für dich freigegeben als {role}`.
  - `[low]` `[patch]` The viewer pill's fill and text (`accentSoft` on `primary.main`) are byte-identical to `statusPill`'s `planned` treatment, which sits 8px away in the same column: a fully planned shared trip rendered two same-coloured chips. The previous pass's `gap: "8px"` fixed adjacency, not identity. Added a `1px solid primary.main` border — the one addition to the pinned `RoleBadge` values, invisible on the contributor variant where it matches the fill — plus a case for the planned+viewer pairing that had no fixture.
  - `[low]` `[patch]` `cache: "no-store"` was raised to a correctness fix last pass and left untested — deleting it kept every test green, while the structurally identical `handleTripCreated` one-liner got its own case. Pinned by asserting the GET's `init`.
  - `[low]` `[patch]` The German aria-label was never rendered by a test; only the pill words were, and the parity test it leans on does not check placeholders. Added a German case asserting the full accessible name including the role.

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 2: (high 0, medium 2, low 0)
- reject: 14
- addressed_findings:
  - `[low]` `[patch]` The test written last pass to guard the role pill's border asserted `borderStyle === "solid"` and nothing about the colour — so recolouring the border to `accentSoft` would make it invisible against its own fill, re-merge the viewer pill with the `planned` status pill beside it, and keep the test green. The border is now pinned against the pill's own two colours (must equal the text colour, must differ from the background), which is palette-independent and fails on exactly that mutation — verified by making it. The paired negative was also weak: it read `not.toBe("solid")` on a status pill that declares no border at all, so it held for any implementation; tightened to `toBe("")`.
  - `[low]` `[patch]` The fetch-`init` case pinned `credentials: "include"` under a comment reading "Deleting either option must fail here", whose stated reason — a replayed pre-`accessRole` payload — is true of `cache: "no-store"` and false of `credentials`, which defaults to `same-origin` and already sends the cookie on this call. A future tidy-up would have hit a failing test telling it the app was now insecure. Comment split so each option carries its own weight.
  - `[low]` `[patch]` The local `TripSummary`'s optionality docblock understated its own blast radius: a server old enough to omit `accessRole` is also old enough to list owner-only, so the deploy-skew window it names is one where *every* returned trip is the account's own and every one of them is marked shared — not "an unknown row". The behaviour is pinned by the intent contract's I/O matrix and is the conservative direction, so it stands; the comment now states the real scope and why it is accepted rather than implying a narrower one.

## Design Notes

**The fallback direction is inverted here.** `TripTimeline.tsx:144-145` and `TripDayView.tsx:598-599` read an absent `accessRole` as *owner*, because those components predate the field and a cached older payload had to keep working for the trip's own owner. On the dashboard every entry carries the field by construction, and defaulting an unknown row to "owner" would present someone else's trip as the account's own — the exact failure this story exists to prevent. Follow `TripShareDialog.tsx:399-401` instead: *"An unrecognised role must not be presented as the more privileged one."*

```tsx
const isShared = trip.accessRole ? trip.accessRole !== "owner" : true;
const roleLabel = t(trip.accessRole === "contributor" ? "trips.share.roleContributor" : "trips.share.roleViewer");
```

**The dashboard has no destructive actions — do not go looking for them.** The whole card is one overlay `Link` to `/trips/{id}` (`:524-529`) over a four-area grid ending in a chevron. There is no menu, no delete, no edit, no per-row control. Deletion and editing live on the trip overview, which already gates on `accessRole` (`TripTimeline.tsx:443-473`). AC3 is a *visual* requirement on this surface: mark the row, and stop. The two header buttons ("Add trip", "Import") stay visible for everyone — both write with the session's `userId` and produce a trip the account owns.

**AC6 needs no code.** Every aggregate already reduces over `trips` (`:182-204`), so widening the query moves them for free. Leave them: the strip is a caption for the list beneath it, and a count that excludes visible rows is a bug report waiting to be filed. `openItems` is already scoped to `gap` trips only, which keeps a shared trip from turning the cell warn-orange merely for existing.

**Why the pill is absent on owned rows rather than warn-toned.** `RoleBadge`'s third variant (`owner` = `tokens.warnBg` on `warning.main`) is sanctioned only inside the share dialog. DESIGN.md reserves warn exclusively for the gap/open-item state, and `trip-row` already spends it there — a gap row swaps its border, background and status pill to warn. A warn owner badge would put two unrelated meanings in one colour inside one row. The absence is the signal, the same way the share dialog's owner row is the one with no remove button.

**No membership cleanup in test setup.** `TripMember` cascades from both `Trip` and `User` (`schema.prisma:124-125`), so the existing `beforeEach` chains ending in `prisma.trip.deleteMany()` / `prisma.user.deleteMany()` already take memberships with them. Add `prisma.tripMember.deleteMany()` only if a foreign-key error actually appears.

**Traps.** (1) The key-set pin fails first, and correctly. (2) The `trip()` factory default must land in the same edit as the component change. (3) A field added to `TripSummary` but forgotten in the route map compiles cleanly and ships a role-less dashboard — trap 1 is the only thing that catches it. (4) Prisma compiles a relation filter inside `OR` to an `EXISTS` subquery so a trip matching both arms returns once; prove it rather than trust it. (5) `test/tripListRoute.test.ts` (singular, 70 lines, one `heroImageUrl` case) is a different suite — leave it alone. (6) Any suite rendering `TripsDashboard` must use `renderWithProviders`; `theme.palette.tokens.*` throws under MUI's default theme.

## Verification

**Commands:** run from `travelplan/`.
- `npm test` -- expected: green. **Measure and report the baseline before starting** (129 test files at HEAD; Story 9.2 closed at 1389 tests / 119 files, so re-measure rather than assume) and report the after-count. `tripsListRoute.test.ts` is expected to fail on the key-set pin until the array is updated — that is the gate working.
- `npx tsc --noEmit -p .` -- expected: **no new errors**, and none in a touched file. The project has never been clean here: 135 errors sit at baseline `f990054`, all of them `TS2339` union-narrowing failures in twenty unrelated test files (`ImportTripResult`, `CreateTripCollaboratorResult`). Count before and after; the number must not move. This still catches the local `TripSummary` copies drifting apart.
- `npx eslint src/lib/repositories/tripRepo.ts src/app/api/trips/route.ts src/components/features/trips/TripsDashboard.tsx test/tripsListRoute.test.ts test/tripsDashboard.test.tsx` -- expected: clean.

**Manual checks:**
- `LC_ALL=C grep -an "accessRole" src/lib/repositories/tripRepo.ts src/app/api/trips/route.ts` -- the field is present in the type, the `.map()` and the route's field map.
- The comment at `tripRepo.ts:645-650` no longer claims shared trips are excluded.

## Auto Run Result

Status: `done`. Second follow-up review pass over the shipped story; no blocking condition.

**Change.** No feature work this pass. `listTripsForUser` lists owner-OR-member, carries a per-entry `accessRole` through `TripSummary`, the GET field map and the dashboard's local type, and marks shared rows with a role pill and a role-bearing accessible name — all unchanged from the previous pass. This pass applied three low-severity patches, all to comments and one test's strength. **No shipped behaviour changed.**

**Files changed this pass:**
- `travelplan/test/tripsDashboard.test.tsx` -- the border guard now pins the border's colour against the pill's own fill and text rather than only its style; the fetch-`init` comment no longer claims `credentials` is load-bearing
- `travelplan/src/components/features/trips/TripsDashboard.tsx` -- the `accessRole?` docblock states the true scope of the deploy-skew window (all rows, not one) and why that direction is accepted
- `_bmad-output/implementation-artifacts/deferred-work.md` -- two new entries, appended only

**Triage:** 3 patched (3 low), 2 deferred (2 medium), 14 rejected, 0 intent_gap, 0 bad_spec.

Both deferrals are pre-existing and outside this story's boundaries: `getTripWithDaysForUser` still downgrades the revoked-membership race to `viewer` and serves the whole trip, where the list now drops the row — the two byte-identical derivations have stopped agreeing about that one moment; and `GET /api/trips/[id]` sets no `Cache-Control` while returning strictly more third-party data than the list route that just earned one.

Of the rejections, seven were re-reports of findings already in the ledger from the previous pass (unbounded list, `orderBy` tiebreaker, mixed-ownership stat strip, viewer gap-warn, `mapTripMemberRole`'s privileged default, no way to leave a trip, i18n placeholder parity), and two rested on claims that did not survive checking: the ledger's `status: **closed …**` shape has precedent at `deferred-work.md:898`, and the 500 path's missing `no-store` matches `/api/users` and `/api/admin/users`, which both set the header on the success path only.

One rejected finding is real and was left unfixed on purpose: DW-199's neighbouring `mapTripMemberRole` entry cites `tripRepo.ts:570` (the function moved to `:576` when this story added six lines above it) and `schema.prisma:50` for a note that actually documents `TravelTransportType` — `TripMemberRole` is at `:27` and carries no such comment. The premise still holds (SQLite stores the enum as unconstrained `TEXT`), only the citations are wrong. Correcting them means editing an existing ledger entry, which this invocation forbids; recorded here instead so the orchestrator can decide.

**Verification:**
- `npm test` -- 129 files / 1644 tests, all green (unchanged count: the patches strengthened an existing case rather than adding one)
- `npx tsc --noEmit -p .` -- 135 errors, exactly the recorded baseline, none in a touched file
- `npx eslint <touched files>` -- 0 errors; the same 2 pre-existing warnings on untouched lines (`TripsDashboard.tsx:143`)
- Mutation check on the strengthened border assertion: changed `border` to `1px solid ${tokens.accentSoft}` and confirmed the case fails, then restored. The previous assertion passed under that mutation.

**Residual risks:**
- Unchanged from the previous pass: the repository's revoked-membership filter ships defensive and untested (no Prisma-mocking pattern in this suite), and the absent-`accessRole` fallback reads every row as shared during a deploy-skew window. Both are spec-pinned and conservative in direction; the second is now documented accurately at the declaration rather than understated.
- The `rolePill` / `RoleBadge` duplication has nothing holding the two in agreement, so the same role can drift to two treatments one click apart. Left as-is because the intent contract forbids exporting `RoleBadge`, and the triplication is this project's stated convention.

