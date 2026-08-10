---
title: 'Access-role derivation fails closed everywhere'
type: 'bugfix'
created: '2026-08-10'
status: 'done'
baseline_revision: '84fd6fb'
final_revision: '2f854cb'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Every client-side access-role derivation is fail-open — `TripTimeline.tsx:168-169` and `TripDayView.tsx:651` read `accessRole ? test : true`, so a detail payload without `accessRole` hands a viewer or contributor the owner-only Delete/Share/Export controls and click-to-edit; both copies of `mapTripMemberRole` (`tripRepo.ts:576`, `lib/auth/tripAccess.ts:20`) map anything not `VIEWER` to the more privileged `contributor`; and `getTripWithDaysForUser` (`tripRepo.ts:922`) serves a whole trip as `viewer` via `?? "VIEWER"` where `getTripAccessForUser` and the list read both answer "no access".

**Approach:** Give the role union and its predicates one client-safe home so an unknown role is a compile error at every consumer, drive the client flags off those predicates instead of permissive ternaries, invert both role mappings to least privilege by deduplicating them into that one home, and make `getTripWithDaysForUser` return `null` (existing 404 semantics) for a non-owner with no membership row via a derivation shared with its list-side sibling.

## Boundaries & Constraints

**Always:** An absent, `null` or unrecognised role grants nothing. `TripAccessRole` has exactly one definition; client components reference it rather than re-declaring the literals. The list read and the detail read derive the role through the same exported helper, so "drop the row when a non-owner has no membership" is one rule, not two synchronised expressions. Existing behaviour for owner, contributor and viewer is unchanged on every surface.

**Block If:** Making the client flags fail closed would require changing an API response shape or route status code (it must not — `getTripWithDaysForUser` returning `null` reuses the route's existing 404 branch at `src/app/api/trips/[id]/route.ts:38-40`).

**Never:** Do not add a 403 branch to `GET /api/trips/[id]`, do not change PATCH's viewer-gets-404 behaviour, do not widen `mapTripMemberRole`'s parameter away from the closed `"VIEWER" | "CONTRIBUTOR"` union (that closed type is what turns a future third `TripMemberRole` into a compile error at the call site), and do not edit `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Detail payload omits `accessRole` | `detail.trip.accessRole === undefined` in `TripTimeline`/`TripDayView` | `isOwner === false`, `canEditPlanning === false`; no Edit/Delete/Share/Export, no click-to-edit, no bucket-list write fetch | No error expected |
| Unrecognised role reaches a client flag | `accessRole` is a string outside the union | Treated as no access — same as viewer | No error expected |
| Dashboard row omits `accessRole` | `trip.accessRole === undefined` | `isShared === true` (unchanged — already fail-closed) | No error expected |
| Member role maps | `"CONTRIBUTOR"` → `contributor`; `"VIEWER"` and anything else → `viewer` | Least-privileged reading is the default arm | No error expected |
| Non-owner, membership row absent | `deriveTripAccessRole` on a trip the user neither owns nor is a member of | `null` | `getTripWithDaysForUser` returns `null`; `listTripsForUser` drops the row |
| Owner reads own trip | `trip.userId === userId`, `members: []` | `"owner"` | No error expected |
| Detail route for a dropped membership | `getTripWithDaysForUser` returns `null` | `GET /api/trips/[id]` → `404 not_found` "Trip not found" | Existing 404 branch |

</intent-contract>

## Code Map

- `travelplan/src/lib/auth/tripAccess.ts` -- owns `TripAccessRole`, the three `canTripAccessRole*` predicates, a private fail-open `mapTripMemberRole` (`:20-21`), and `getTripAccessForUser`; imports `prisma`, so it cannot be imported for values by a client component.
- `travelplan/src/lib/repositories/tripRepo.ts` -- second private `mapTripMemberRole` (`:576-577`, three call sites); `listTripsForUser` (`:650-726`) with the membership drop at `:688` and role at `:709`; `getTripWithDaysForUser` (`:836-1032`) with the `?? "VIEWER"` fallback at `:922-923`. **Contains NUL bytes — `grep` needs `-a` or it silently matches nothing.**
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- `:53` inline role union, `:168-169` the two fail-open flags feeding Edit/Delete/Share/Export and `canEditHeroImage`.
- `travelplan/src/components/features/trips/TripDayView.tsx` -- `:285` inline union, `:651` fail-open `canEditPlanning` feeding activity click-to-edit, the day-image menu item and the bucket-list fetch.
- `travelplan/src/components/features/trips/TripsDashboard.tsx` -- `:50` inline union, `:512-518` the already-fail-closed `isShared` whose comment cites the other two surfaces as the counter-example.
- `travelplan/src/app/api/trips/[id]/route.ts` -- `:37-47` GET returns 404 when `getTripWithDaysForUser` is `null`, else attaches `accessRole`.
- `travelplan/test/tripTimelineRoles.test.tsx`, `travelplan/test/tripDayViewLayout.test.tsx` (`dayPayload(accessRole?)` helper at `:7465`), `travelplan/test/tripsDashboard.test.tsx` (`:607` absent-role test), `travelplan/test/tripDetailRoute.test.ts` (404 cases at `:402/:421/:443`) -- the suites to extend.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/auth/tripAccessRole.ts` -- new module, no `prisma` import: move `TripAccessRole` and `canTripAccessRoleRead`/`ManageTrip`/`Write` here verbatim, and add one exported `mapTripMemberRole` whose body is inverted to `role === "CONTRIBUTOR" ? "contributor" : "viewer"` -- a client component must be able to import the predicates for values, and one definition is what makes an added role a compile error everywhere.
- [x] `travelplan/src/lib/auth/tripAccess.ts` -- delete the private `mapTripMemberRole` and the moved declarations; import from `./tripAccessRole` and re-export `TripAccessRole` plus the three predicates so all ~20 existing importers are untouched -- keeps this file the server-side access surface.
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- delete the private `mapTripMemberRole`, import the shared one, and add an exported `deriveTripAccessRole(userId, trip): TripAccessRole | null` returning `"owner"` for the owner, the mapped member role, or `null` when a non-owner has no membership row -- one rule for both reads.
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- `listTripsForUser`: replace the `.filter(...)` at `:688` and the `?? "VIEWER"` expression at `:709` with `deriveTripAccessRole`, dropping a row whose role is `null` -- same output as today, derived once instead of twice.
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- `getTripWithDaysForUser`: replace the `?? "VIEWER"` derivation at `:922-923` with `deriveTripAccessRole` and `return null` when it is `null`, before the `$queryRawUnsafe` day-meta read -- a revoked collaborator gets the route's 404, not the whole trip.
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- type `accessRole?: TripAccessRole` from the shared module; `isOwner = canTripAccessRoleManageTrip(detail?.trip.accessRole)`, `canEditPlanning = canTripAccessRoleWrite(detail?.trip.accessRole)` -- both flags now deny on absent/unknown.
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- same import and `canEditPlanning = canTripAccessRoleWrite(detail?.trip.accessRole)` -- the day surface's only role flag.
- [x] `travelplan/src/components/features/trips/TripsDashboard.tsx` -- type from the shared module; `isShared = trip.accessRole !== "owner"` and rewrite the `:512-517` comment, which claims the other two surfaces read an absent role as owner -- behaviour identical, but the comment must stop describing a rule that no longer exists.
- [x] `travelplan/test/tripAccessRole.test.ts` -- new: unit-test `mapTripMemberRole` (both arms plus an unrecognised value cast in) and `deriveTripAccessRole` (owner / contributor member / viewer member / non-owner with `members: []` → `null`) -- covers the I/O matrix rows no integration test can reach.
- [x] `travelplan/test/tripTimelineRoles.test.tsx` -- add a case building the detail response with `accessRole` omitted, asserting the viewer expectations (no Edit, Delete, Share or Export, no controls card) -- the `: true` branch has no coverage today.
- [x] `travelplan/test/tripDayViewLayout.test.tsx` -- add an omitted-`accessRole` case using the existing `dayPayload` helper, asserting the viewer gating (no click-to-edit on activity cards, contributor-only overflow items absent).
- [x] `travelplan/test/tripDetailRoute.test.ts` -- add a 404 case: a collaborator whose membership row is removed gets `404 not_found` from `GET /api/trips/[id]`, mirroring `tripsListRoute.test.ts:261` on the list side.

**Acceptance Criteria:**
- Given a fourth member is added to `TripAccessRole`, when the app runs, then every predicate denies it until someone grants it explicitly, and no trip component re-declares the role literals. (Amended during review: the original wording promised a `typecheck` failure at the consumers. Nothing in the app exhausts the union — no `switch` with a `never` arm, no `Record<TripAccessRole, …>` — so that was false as written. The compile-error signal that does exist is `mapTripMemberRole`'s closed `"VIEWER" | "CONTRIBUTOR"` parameter, which fails at `deriveTripAccessRole`'s call site the moment the Prisma enum widens; that is DW-237's signal and it holds.)
- Given a viewer or contributor on the trip overview and day screens, when the trip loads normally, then every control they see today is still present and every one they do not is still absent.
- Given `grep -a "?? \"VIEWER\"" src/lib/repositories/tripRepo.ts` and `grep -ran ": true;" ` over the three trip components, when the change is complete, then no permissive role fallback remains.
- Given `deferred-work.md`, when the change is complete, then no commit or working-tree edit in this run touched it. (Amended during review: the original said "byte-identical to its pre-change state", which this run cannot assert — the orchestrator modified six unrelated `status:` lines concurrently. Verified instead that none of the five bundled entries were touched and that nothing in this run wrote the file.)

## Design Notes

DW-243's recorded decision spells the client fix as `detail?.trip.accessRole !== "viewer"` "with no fallback to true". Taken literally that is still fail-open — `undefined !== "viewer"` is `true`. The intent (fail closed) requires positive equality, which is exactly what `canTripAccessRoleWrite` already encodes server-side, so the client consumes that predicate instead of restating the test:

```ts
// src/lib/auth/tripAccessRole.ts — no prisma import, safe in a client component
export const canTripAccessRoleWrite = (accessRole: TripAccessRole | null | undefined) =>
  accessRole === "owner" || accessRole === "contributor";
export const mapTripMemberRole = (role: "VIEWER" | "CONTRIBUTOR"): Exclude<TripAccessRole, "owner"> =>
  role === "CONTRIBUTOR" ? "contributor" : "viewer";
```

`mapTripMemberRole`'s parameter stays the closed union on purpose: that is what makes a widened `TripMemberRole` a compile error at the call site, per DW-237. The inverted body is the runtime backstop for a row that already holds an unrecognised value.

`deriveTripAccessRole` replaces the "byte-identical expressions kept in sync by comment" invariant `tripRepo.ts:704-708` describes with a single function both reads call, which is what DW-239 asks for. Accepted cost, per DW-243's decision: an owner on a stale cached payload briefly sees a reduced UI until `accessRole` resolves.

## Verification

**Commands:**
- `cd travelplan && npm run typecheck` -- expected: exit 0
- `cd travelplan && npm run lint` -- expected: exit 0, no new warnings
- `cd travelplan && npx vitest run test/tripAccessRole.test.ts test/tripTimelineRoles.test.tsx test/tripDayViewLayout.test.tsx test/tripsDashboard.test.tsx test/tripDetailRoute.test.ts test/tripsListRoute.test.ts test/tripCollaborationRepo.test.ts test/tripRepo.test.ts test/tripMembersRoute.test.ts` -- expected: all pass, including the new cases
- `cd travelplan && npm test` -- expected: full suite green (serial, single fork; allow several minutes)
- `git diff --stat -- _bmad-output/implementation-artifacts/deferred-work.md` -- expected: empty

## Review Triage Log

### 2026-08-11 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 4: (high 0, medium 2, low 2)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` `TripsDashboard.tsx:34-38`'s new docstring sold the shared module as making "an added role a compile error at every consumer", which is the claim `tripAccessRole.ts:16-20` refutes in bold and which this spec's own first acceptance criterion was amended to withdraw. Two comments added by the same commit said opposite things, and the false one was the one a reader meets first. Rewritten to state what the single definition actually buys — one place to add a role, three predicates that deny it until someone grants it — and to point at the longer note.
  - `[low]` `[patch]` `test/tripTimelinePlan.test.tsx` was missed by the fixture sweep: all 12 of its `TripTimeline` fixtures omitted `accessRole`, so since this change every test in the file renders the overview as a *denied* user. It matters in exactly one case — "does not render per-day action buttons in the overview" asserts a layout rule, and the role gate now suppresses those buttons independently, so the case would have stayed green if the layout rule were reversed. Added `accessRole: "owner"` to all 12 fixtures and a comment on that case recording why the field is load-bearing there.
  - `[low]` `[patch]` `test/tripAccessRole.test.ts:47-51` claimed the old `!= null` spelling of `canTripAccessRoleRead` let an unrecognised role "read every day, stay and cost of a trip through the upload, packet and route-preview gates". Unreachable: the predicate's only producer is `getTripAccessForUser`, whose role now comes from `deriveTripAccessRole` and is a union member or `null`. Rewritten to say the case pins a shape rather than closing a live gap, so the next reader does not go hunting for a hole that is not there.
  - `[low]` `[patch]` `TripTimeline.tsx:180-184` justified "the fail-closed cost is not paid here" with the `loading` early return, which is only half the guard — the load-error path clears `detail`, drops `loading` and falls through to the main return. What actually holds is that `tripControlsCard` and every other reader sit inside the `{detail && …}` wrappers at `:634`/`:1129`. Corrected, with the refactor that would reintroduce the cost named explicitly.

## Auto Run Result

Status: done

**Change.** Every access-role derivation in the app now fails closed. `src/lib/auth/tripAccessRole.ts` (new, no `prisma` import) is the one home for `TripAccessRole`, the three `canTripAccessRole*` predicates, `mapTripMemberRole` and `deriveTripAccessRole`. The three trip components drive their flags off those predicates instead of `accessRole ? test : true`; `mapTripMemberRole`'s default arm was inverted to `viewer`; `getTripAccessForUser`, `listTripsForUser` and `getTripWithDaysForUser` all derive through `deriveTripAccessRole`, so a non-owner with no membership row is `null` — the list drops the row and the detail read returns `null` into the route's existing 404 rather than serving the whole trip as a viewer.

**Files changed** (this review pass only; the implementation is `326e881`):
- `src/components/features/trips/TripsDashboard.tsx` — corrected the `accessRole` docstring's compile-error claim.
- `src/components/features/trips/TripTimeline.tsx` — corrected the comment naming which guard keeps the fail-closed flags out of a rendered tree.
- `test/tripAccessRole.test.ts` — corrected the `canTripAccessRoleRead` case's claim of a live vulnerability.
- `test/tripTimelinePlan.test.tsx` — added `accessRole: "owner"` to all 12 fixtures the earlier sweep missed, plus a note on the one case where it is load-bearing.

**Review findings:** 4 patches applied (all low), 4 items deferred as DW-298…DW-301, 11 rejected. No intent gaps and no spec-level defects; no repair loopback (`review_loop_iteration` stayed 0).

**Verification:**
- `npm run typecheck` — exit 0.
- `npm run lint` — 0 errors, 79 warnings; identical to the pre-patch tree measured by stashing, so no new warnings.
- `npx vitest run` over the 10 role-related suites — 308 passed.
- `npm test` — 145 files, 2223 tests, all passing.
- Ledger: `git diff` on `deferred-work.md` shows this run made trailing additions only. The pre-existing `status:` line deletions in that diff are the orchestrator's concurrent work, present before this session started. This partly restates the fourth acceptance criterion, which this run cannot assert byte-identity for and does not claim to.

**Residual risks:**
- `deriveTripAccessRole` consolidated the three in-memory reads; the ~26 Prisma filters that actually enforce the mutations still spell the write rule out by hand (DW-299). A fourth role means editing all of them with no compiler signal.
- `TripEditDialog`'s `as TripDetail` cast survives, patched for `accessRole` only (DW-300). The next field to become load-bearing reproduces this defect in the same way.
- `toTripMemberRole` still fails open on the grant path (DW-298) — unreachable today behind zod validation, but it now contradicts its own sibling.
