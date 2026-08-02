---
authored_against: ac03570
baseline_revision: 68607e045cfbc3e304b591d1d95e43798303dd6e
status: awaiting-operator
review_loop_iteration: 0
warnings: []
---

# Story 6.16: Walking and Cycling as Travel Modes

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to record a leg as walked or cycled,
so that the day's travel reflects how we actually get between places instead of forcing every leg into car, ship or flight.

## Acceptance Criteria

1. **Two new modes.** Walking and cycling are selectable wherever a transport type is chosen. The migration is additive: every existing segment keeps its current type and no row is rewritten.
2. **Own glyphs.** Each new mode has a glyph in `TripIcons.tsx` consistent with the existing stroke set, and `transportIconFor`'s type widens rather than falling back to a default.
3. **Coverage bar unchanged.** The day bar keeps its four kinds (`accommodation | planItem | travel | gap`) and never reads the transport type. Walking and cycling fall into `"travel"` under the legend's "Fahrt" like every other mode — the bar is a coarse overview and the manner of travel is deliberately not part of it.
4. **Google import extended.** Automatic route import runs for walking and cycling using Google's `walking` and `bicycling` travel modes. Ship and flight stay manual — Google offers no equivalent — and a mode Google cannot route for degrades to the manual path rather than erroring.
5. **Helper text corrected.** `trips.travelSegment.googleMapsCarOnlyHelper` stops saying "nur für Auto-Abschnitte" and names the modes that do import.
6. **Distance rule stated.** `trips.travelSegment.distanceRequired` requires a distance for car today. Whether it applies to the new modes is decided deliberately, not inherited.
7. **Backups round-trip.** The export and import formats carry the transport type; the new values survive a round trip, and a v2 backup containing them imports cleanly.

## Tasks / Subtasks

- [x] **Task 1 — Schema and migration** (AC: 1)
  - [x] `prisma/schema.prisma:36-40` — `enum TravelTransportType { CAR SHIP FLIGHT }`. Add the two new members.
  - [x] ~~Generate a migration.~~ **No migration was generated, deliberately** — the check this subtask asked for came back "no DDL needed". On SQLite Prisma has no native enum, so check what the existing migration actually produced before assuming a simple `ALTER TYPE` — an enum backed by a `TEXT` column with a check constraint needs the constraint widened, which on SQLite means a table rebuild. It is not: `20260301105118_add_travel_segments/migration.sql:9` is a bare `TEXT NOT NULL`. See Completion Note 1.
  - [x] `scripts/check-migration-immutability.sh` guards this directory; run `npm run check:migrations` before and after.
  - [x] Additive only: no existing row's value changes.

- [x] **Task 2 — Icons** (AC: 2)
  - [x] `TripIcons.tsx:334` — `transportIconFor(transportType: "car" | "ship" | "flight")` returns one of three. Widen the union and add two glyphs beside `CarIcon` / `ShipIcon` / `PlaneIcon` (`:269`, `:294`, `:318`).
  - [x] Match the module's conventions: `IconProps` with `SxProps<Theme>`, `aria-hidden`, `viewBox="0 0 24 24"`, the `sx={[{ fontSize: … }, ...]}` array-merge shape.
  - [x] Widen the type rather than adding a default branch. A default hides the next mode someone forgets.

- [x] **Task 3 — Selection and validation** (AC: 1, 6)
  - [x] `TripDayTravelSegmentDialog.tsx` renders the transport choice — add both, in both dictionaries.
  - [x] `trips.travelSegment.distanceRequired` reads "Entfernung ist für Auto erforderlich". Decide whether walking and cycling require a distance. A cycled leg plausibly has one; a five-minute walk plausibly does not. Whatever is chosen, the message must name the modes it applies to rather than saying "für Auto" while enforcing more.

- [x] **Task 4 — Google route import** (AC: 4, 5)
  - [x] The import is car-only today. Google's Directions API takes `mode=walking` and `mode=bicycling`; map the two new types onto them.
  - [x] Ship and flight have no Google equivalent — they must keep falling back to the manual path, not error.
  - [x] Rewrite `googleMapsCarOnlyHelper`. It currently asserts a fact that stops being true; a stale helper is worse than none because the user believes it.
  - [x] Bicycling directions are unavailable in many regions. A route request that comes back empty must read as "no route for this mode here", not as a failure of the feature.

- [x] **Task 5 — Check every reader of the type** (AC: 3, 7)
  - [x] `TripDayGanttSegments.ts:4` types its kinds as `"accommodation" | "planItem" | "travel" | "gap"` and pushes `"travel"` at `:109` without reading the transport type at all — so AC3 holds by construction. **Verify it still does after the change** rather than assuming; this AC is a guard against someone introducing a distinction while they are in the area.
  - [x] Export (`tripRepo.ts`'s export shape) and import (`tripImportSchemas.ts`) both carry the type. The import schema likely validates against the enum — widen it, and confirm a backup written before this story still imports.
  - [x] Grep for the three literals across `src/` — anything switching on them needs the two new cases or a widened type.

- [x] **Task 6 — Tests** (AC: 1, 4, 6, 7)
  - [x] Add a travel segment of each new type and assert it renders with its own glyph and rolls into the day's travel total.
  - [x] Assert the coverage bar still reports one `"travel"` kind regardless of mode.
  - [x] Assert a round trip through export and import preserves both new values, and that a pre-change backup still imports.
  - [x] `npm test` green, `npm run check:migrations` green. — **Qualified:** at commit `20b8041` the suite was 878 passed / 5 failed. The 5 are the pre-existing DW-108 import size-cap assertions, unrelated to this story and fixed in the following commit `8228ce0`. Zero new failures were introduced; the subtask as literally worded was not met at this commit.

- [ ] **Task 7 — Manual check** (AC: 4)
  - [ ] Route import for a walking leg and a cycling leg between two located points, and confirm the duration and distance prefill.
  - [ ] A cycling leg somewhere Google has no bicycle data, to see the empty-result path.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

### Review Findings

Code review 2026-08-02 against commit `20b8041`. Three parallel layers (adversarial, edge-case, acceptance). 13 findings kept, 5 dismissed as noise.

- [x] [Review][Decision] **RESOLVED 2026-08-02 — see "Decision resolved" below. AC4 was not delivered against the configured router — walking and cycling imports return car numbers** — `dayRouteService.ts:80` hardcodes `https://router.project-osrm.org`, whose public demo instance is built from a single (car) profile and *discards* the `{profile}` path segment. Verified live during review: `driving`, `walking`, `cycling` and the nonsense profile `foobar` all return byte-identical geometry for the same coordinate pair (582.9 m / 68.3 s — a 30 km/h car speed). So `ROUTING_PROFILE_BY_MODE`, `RoutingProfile` and the new `mode` query parameter are a correct end-to-end no-op: a 1.9 km walk prefills ~4 minutes and the dialog reports "Route imported successfully". There is no env or config override for the host anywhere in `src/`, and no Google Directions key in the repo — Google is only ever the link the user opens. Completion Note 3 asserts a per-mode route the backend cannot produce. Every test asserts only the URL/argument shape against a mocked service, which is why the suite is green. Task 7's unticked manual check is exactly what would have caught this. **The choice is human:** self-host OSRM with walking/cycling profiles, move to a router that serves them (e.g. a keyed Google Directions or GraphHopper), or scope AC4 back to "car imports, the other modes are manual" and delete the mode plumbing.

- [x] [Review][Patch] `routing_no_route` is unreachable in production — `!response.ok` rejects before the payload code is read [travelplan/src/lib/routing/dayRouteService.ts:96] — OSRM answers every non-`Ok` code with HTTP 400 (verified: an invalid coordinate returns `400 {"code":"InvalidValue"}`), so the `if (!response.ok) throw routing_unavailable` guard fires before `NoRoute` is ever inspected. The only surviving path is `code:"Ok"` with an empty `routes` array, which OSRM does not emit. `NoSegment` — the code a stop pinned off the pedestrian/cycle network actually produces — is not special-cased either and also lands on `routing_unavailable`. Net effect: the 404 branch, the `googleMapsNoRouteForMode` key and Trap 3 are all dead code, and the user is told "Automatic route import is not available in this build" when the correct answer is "no route for this mode here". `dayRouteService.test.ts:106` mocks `{ok: true, code:"NoRoute"}` and so encodes the wrong assumption.
- [x] [Review][Patch] Switching transport mode after a route import keeps the previous mode's duration, distance, link and success alert [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:224-242] — the reset effect's deps are `[open, segment, mapsLink]`, so `setTransportType` clears nothing. Pick Walking → *Plan with Maps* → switch to Cycling → Save, and the row persists as `cycling` carrying the walking duration, the walking distance and a link that literally reads `travelmode=walking`, with "Route imported successfully" still on screen. Before this story only `car` could prefill, so the state was unreachable; two routable modes make it a one-click mistake.
- [x] [Review][Patch] A saved walking or cycling link opens driving directions unless a route import happened to succeed [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:221,240] — `mapsLink` is mode-agnostic and is what seeds `linkUrl` on open and what is re-set at the top of every import attempt; only the post-success path at `:359` sets a `travelmode`. A manually entered walking leg therefore stores a link with no mode, and tapping it on a phone gives car directions. Completion Note 4's memoisation reasoning is sound (making `mapsLink` depend on the mode would reset the form), but the fix does not require breaking it: derive the `travelmode` at save/render time for a link the user has not edited.
- [x] [Review][Patch] A zero, negative or unparseable distance on walking/cycling is silently discarded, while the same input on car raises a field error [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:392-394] — `inputProps={{ min: 0 }}` is not enforced on submit (nothing runs constraint validation), `validate()` skips the field unless `requiresDistance`, and `parsedDistance > 0` then collapses `0` and negatives to `null`. Type `-3` into "Distance (km, optional)", save, and the value vanishes with a success close. The server would have rejected it too (`travelSegmentSchemas.ts:48` is `.positive()`), so the client is hiding a value the API considers invalid rather than reporting it.
- [x] [Review][Patch] The day-route endpoint returns the new `routing_no_route` code under HTTP 502 "Routing service unavailable" [travelplan/src/app/api/trips/[id]/days/[dayId]/route/route.ts:63] — this second consumer of `RoutingErrorCode` passes `error.code` through with a fixed message and status, and this commit re-coded the empty-`routes` case from `routing_invalid_response` to `routing_no_route`. The contract now says "this is a normal answer, not an outage" inside the status and prose for the opposite. No user-visible breakage today (both callers read only `details.fallbackPolyline`), but it is self-contradictory for the next reader who switches on the code.
- [x] [Review][Patch] `?mode=` present-but-empty is a 400 instead of defaulting to car [travelplan/src/app/api/trips/[id]/travel-segments/route-preview/route.ts:50] — `searchParams.get("mode")` returns `""`, not `null`, for `&mode=` and for a bare `&mode`. `"" ?? undefined` yields `""`, which `z.enum` rejects, so `.default("car")` never applies. The `?? undefined` guard was written to keep pre-6.16 callers working and misses the empty-value boundary. `|| undefined` fixes it.
- [x] [Review][Patch] The distance rule lives in three unlinked copies, none typed against the enum [travelplan/src/lib/validation/travelSegmentSchemas.ts:34, travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:56, travelplan/src/components/features/trips/TripDayView.tsx:70] — `TRANSPORT_TYPES_ALLOWING_DISTANCE` and `transportTypeAllowsDistance` are exported and imported by nothing outside their own module; the two UI files each re-spell the list, one of them as `readonly string[]`. This is the one discipline the commit spends the most comment lines defending ("the compiler has to be the one that notices the next one"). Add a sixth mode and all four enum mappers plus `transportIconFor` fail to compile as designed, while the three distance lists, `TripDayPrintDocument`'s `Record<string, string>` label map and `GOOGLE_TRAVEL_MODE_BY_TRANSPORT` (a `Partial<Record<…>>`, structurally exempt) compile clean and quietly do the wrong thing. Note the shared home should be a plain module, not the zod one — no client component currently imports from `@/lib/validation`, and doing so would pull zod into the client bundle.
- [x] [Review][Patch] Two subtask checkboxes in this file are ticked against work that was not done [`6-16-walking-and-cycling-travel-modes.md` Task 1, Task 6] — Task 1's "Generate a migration" is ticked and no migration was generated. The *decision* is correct and Completion Note 1 is accurate (`20260301105118_add_travel_segments/migration.sql:9` is bare `TEXT NOT NULL`, the only CHECK in the directory is `cost_payments_one_target_check`, and `check:migrations` passes) — the checkbox is what contradicts it. Task 6's "`npm test` green" is ticked at a commit the message itself records as 878 passed / 5 failed; the 5 are pre-existing DW-108 and were fixed in `8228ce0`, but the subtask as worded was not satisfied here.

- [x] [Review][Defer] The print sheet shows a distance for ship and flight while the day view now hides it [travelplan/src/components/features/trips/TripDayPrintDocument.tsx:180 vs TripDayView.tsx:1177] — deferred, pre-existing (DW-109)
- [x] [Review][Defer] A prefilled duration of 24 h or more is written by the form and then rejected by it [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:105-114,357] — deferred, pre-existing (DW-110)
- [x] [Review][Defer] No rollback path: `WALKING`/`CYCLING` rows are unreadable by a pre-6.16 build [travelplan/prisma/schema.prisma:36-45] — deferred, inherent to the accepted one-way compatibility (DW-111)
- [x] [Review][Defer] A NUL byte in `tripRepo.ts` makes plain `grep -r` skip the file that held three of the five defaulting mappers [travelplan/src/lib/repositories/tripRepo.ts:1424] — deferred, pre-existing (DW-112)

#### Decision resolved, 2026-08-02 — per-profile OSRM endpoints

**Chosen: point each mode at its own OSRM instance, host overridable via `OSRM_BASE_URL`.**

The diagnosis was slightly off in a way that made the fix much smaller than expected. The `{profile}`
segment was never a selector: an OSRM deployment serves exactly one graph, fixed at `osrm-extract`
time by a Lua profile, and answers any `{profile}` in the path from that one graph. Selecting a
profile means selecting an **endpoint**. FOSSGIS runs one public instance per profile, so no API key,
no signup, no new response shape and no self-hosting were needed — `ROUTING_PROFILE_BY_MODE` became a
profile→path map and everything downstream already worked.

Verified live end to end, same 2.9 km of central Berlin, through the app's own request shape:

| mode | endpoint | result | speed |
| --- | --- | --- | --- |
| car | `routed-car/route/v1/driving` | 2.65 km / 5 min | 29.6 km/h |
| cycling | `routed-bike/route/v1/bike` | 2.99 km / 18 min | 9.9 km/h |
| walking | `routed-foot/route/v1/foot` | 2.94 km / 39 min | 4.5 km/h |

Three graphs, three plausible speeds — against the demo host all four profiles, including a nonsense
one, returned byte-identical car numbers. **AC4 is now delivered.**

Two things a future reader should know:

1. **This is a community service under fair use.** Fine at one request per explicit user action, not
   something to poll. `OSRM_BASE_URL` points the whole thing at a self-hosted deployment mirroring the
   same three paths when that stops being true. Documented at the use site, matching how `APP_BASE_URL`
   is handled; `.env` is gitignored and there is no example file to update.
2. **Trap 3's "no route for this mode here" path is still mostly defensive.** These instances snap
   almost anything and answer `Ok` — a Berlin→New York bike request returns a 3,434 km "route" rather
   than `NoRoute`. The `NoRoute`/`NoSegment` handling is correctly wired now (it was unreachable
   before), but it fires rarely in practice. Not a defect; worth knowing before anyone hunts for the
   message in the wild.

**DW-110 was unmasked by this fix and closed in the same pass**, exactly as its ledger entry said it
should be. At real walking speed a ~110 km leg exceeds 24 h, and `parseTimeToMinutes` capped hours at
23 while `formatMinutesToTime` happily wrote `26:30` — so the form rejected its own prefill with
"Duration is required". A duration is not a time of day: hours now accept three digits. This also
fixes multi-day ship crossings, which could never be entered by hand.

#### Patch pass, 2026-08-02

All 8 `patch` findings applied. The one `decision-needed` finding is untouched and still open — it is why this story is `in-progress` rather than `done`.

New in this pass:

- `travelplan/src/lib/trips/transportTypes.ts` — the single home for the transport vocabulary and the per-mode distance rule. Zod-free and dependency-free on purpose: client components import it, and reaching into `travelSegmentSchemas.ts` for a string array would drag zod into the browser bundle. `travelSegmentSchemas.ts` now derives its `z.enum` from `TRANSPORT_TYPES`, and both repositories, `TripDayView`, `TripTimeline` and the dialog take the type and the rule from here. The three duplicated distance lists are gone.
- `trips.travelSegment.distanceInvalid` in both dictionaries, for a distance that is filled in but not positive.
- 15 regression tests (13 from the patch pass, 2 from the decision) across `dayRouteService.test.ts`, `travelSegmentRoutePreview.test.ts`, `tripDayRoute.test.ts` and `travelSegmentDialog.test.tsx`, each pinning a finding.

Verification after the pass: `npx vitest run` **898 passed / 102 files / 0 failed** (was 883 total with 5 failing at `20b8041`; +13 from this pass). `npx tsc --noEmit` zero errors in `src/`. `npm run lint` 2 errors / 84 warnings — identical to the baseline, both errors in the untouched `src/theme.ts`. `npm run check:migrations` passes.

**Dismissed as noise (5):** `transportIconFor`'s trailing `return CarIcon` vs Trap 2 — compile-time exhaustiveness *is* present via `const unhandled: never`, and the trailing return is documented defensive rendering for a row that bypassed validation, not the silent default the trap forbids. Backup `FORMAT_VERSION` left at 2 — AC7 explicitly specifies "a **v2** backup containing them imports cleanly", so staying at 2 is spec-mandated, not an oversight. `prefillRouteOnOpen`'s stale `transportType` closure — the prop has no caller anywhere in `src/` or `test/`, so it is unreachable. Completion Note 4's "noted in a comment at the call site" pointing at `:184` rather than `:221` — trivia. Task 7 unticked — a known human gate, not a defect.

## Dev Notes

### This is a schema change wearing a UI request's clothes

`TravelTransportType` is a Prisma enum backed by a database column. Adding two members means a migration, and the enum is read by more than the dialog: the coverage bar, the Gantt, the day's travel total, the trip cost roll-up, and — importantly — **the backup format Stories 2.31 and 2.32 built**. A backup written after this story contains values a pre-change build cannot parse; that is expected and acceptable, but the reverse must work.

### The coverage bar already does what Tommy asked for

He asked that the day bar collapse all modes into one "Fahrt". It already does: `TripDayGanttSegments.ts` types its segments as four kinds and pushes `"travel"` without ever looking at the transport type, and the legend says "Fahrt". AC3 is therefore a *guard*, not a change — it forbids introducing a per-mode distinction while adding the modes.

### Two decisions already made

Both settled by Tommy on 2026-08-02:

- **Google import covers the new modes.** Directions supports `walking` and `bicycling`, so they get automatic import; ship and flight stay manual.
- **No per-mode treatment in the coverage bar.** The bar is a coarse overview of the day; the manner of travel is deliberately not part of it.

### Traps

**1. SQLite has no enums.** Check what `20260308…_add_travel_segments`-style migration actually emitted before assuming Prisma will hand you a clean `ALTER`. A `TEXT` column with a check constraint needs a table rebuild on SQLite, and `check-migration-immutability.sh` guards the directory.

**2. Do not add a default branch to `transportIconFor`.** Widening the union makes the compiler point at every switch that needs the new cases. A default silently swallows the next one.

**3. Bicycling coverage is patchy.** Google returns no route for bicycling in large parts of the world. That is a normal answer, not an error, and the UI must say so.

**4. The distance rule is not obviously the same.** "Entfernung ist für Auto erforderlich" was a deliberate rule for car. Inheriting it for a two-minute walk would be an annoyance; not inheriting it for a 40 km ride would lose data. Decide.

### Testing

Vitest 3.2. `travelSegmentSchema.test.ts`, `travelSegmentSchemas.test.ts`, `travelSegmentRoute.test.ts`, `travelSegmentRoutePreview.test.ts` and `travelSegmentDialog.test.tsx` all constrain this. The backup suites (`tripExportRoute`, `tripImportRoute`, `tripBackupRoundTrip`) constrain AC7.

### Project Structure Notes

`prisma/schema.prisma` plus a migration, `src/components/features/trips/TripIcons.tsx`, `TripDayTravelSegmentDialog.tsx`, the route-preview service, `src/lib/validation/tripImportSchemas.ts`, both i18n dictionaries, and the suites above.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.16]
- [Source: travelplan/prisma/schema.prisma:36-40] — the enum
- [Source: travelplan/src/components/features/trips/TripIcons.tsx:269-340] — the glyph set and `transportIconFor`
- [Source: travelplan/src/components/features/trips/TripDayGanttSegments.ts:4,109] — why the coverage bar needs no change
- [Source: _bmad-output/implementation-artifacts/2-31-…md] — the backup format bound to this enum

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (bmad dev-story implementation agent)

### Debug Log References

- Baseline `npm test` before any edit: **5 failed | 847 passed (852)**, 2 failed files — the five DW-108 import size-cap assertions only.
- Final `npm test`: **5 failed | 878 passed (883)**, the *same* two files and the *same* five assertions. +31 passing tests, zero new failures.
- `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` — output byte-identical before and after the enum edit (39 lines of pre-existing, unrelated `cost_payments` / `trip_members` drift). Proof the enum widening emits no DDL.
- `npm run check:migrations` — passed before and after ("no migration changes").
- `npx tsc --noEmit` — 174 errors before, 174 after, all in `test/` and all pre-existing; the only diff is three line numbers in `dayRouteService.test.ts` shifted by inserted tests. **Zero errors in `src/`.**
- `npm run lint` — 2 errors / 84 warnings before and after; both errors are in the untouched `src/theme.ts`. Nothing new on any changed file.

### Completion Notes List

1. **No migration was needed, and none was written.** The story warned about a `TEXT`-plus-`CHECK` column needing a SQLite table rebuild. The actual emitted SQL of `20260301105118_add_travel_segments` declares `"transport_type" TEXT NOT NULL` with **no CHECK constraint** — the only CHECK anywhere in the migrations directory is `cost_payments_one_target_check`. Prisma's enum is therefore enforced purely client-side on SQLite, so adding two members is a zero-DDL change. This was verified, not assumed: `prisma migrate diff` produces byte-identical output before and after. A comment-only migration folder was deliberately **not** added — the migrations directory records DDL that was applied, and an empty entry would imply a schema change that did not happen. The reasoning is recorded in `prisma/schema.prisma` above the enum so the next reader does not re-derive it. Additive by construction: no stored row is read or rewritten.

2. **AC6 — the distance decision: allowed for every ground mode, required for car alone.** Walking and cycling may carry a distance but are not obliged to; ship and flight still forbid one; car keeps its existing requirement unchanged. Reasoning: (a) requiring it would turn a two-minute walk between adjacent stops into a form error over a number the user does not have — the annoyance the Dev Notes call out; (b) forbidding it would discard the 40 km of a cycled leg *and* make the route import for these modes pointless, since it prefills duration **and** distance, which Task 7's manual check explicitly expects; (c) allowed-but-optional is the only rule that keeps both cases usable. Because the rule now applies to car alone, `trips.travelSegment.distanceRequired` ("Distance is required for car travel" / "Entfernung ist für Auto erforderlich") **already names exactly the mode it applies to and was left unchanged** — it is not asserting "für Auto" while enforcing more. The message that *did* become a lie was the server-side counterpart, `"Distance is only allowed for car travel"`, now `"Distance is only allowed for car, walking and cycling travel"`. The UI signals the difference before a save is attempted: the field is labelled `Distance (km)` for car and `Distance (km, optional)` for walking and cycling.

3. **The "Google route import" is OSRM underneath.** `handleGoogleMapsRoute` calls `/travel-segments/route-preview`, which calls `getDayRouteFromOsrm` against `router.project-osrm.org` with a hardcoded `driving` profile — Google is only ever the *link* the user opens. The story's "map WALKING→`walking` and CYCLING→`bicycling` on the Directions request" therefore landed in two places: the OSRM profile (`driving` | `walking` | `cycling`, selected by a new `mode` query parameter the endpoint maps from the app's own vocabulary), and the Google Maps deep link's `travelmode` parameter, which uses Google's own spelling `bicycling` rather than `cycling`.

4. **`buildGoogleMapsLink` was deliberately left mode-agnostic.** Only `buildGoogleMapsRouteLink` gained the transport type. `mapsLink` is memoised on the two adjacent items and is a dependency of the effect that seeds the form; making it depend on `transportType` would have reset duration, distance and link every time the user changed the mode dropdown. Noted in a comment at the call site.

5. **Ship and flight degrade, they do not error.** `route-preview` accepts only `car | walking | cycling` and rejects anything else at the schema boundary, so an unroutable mode can never quietly become a car route. The dialog never sends them: `isRoutableTransportType` routes them to the manual helper instead.

6. **Empty results got their own outcome.** `routing_no_route` is a new `RoutingErrorCode`, raised on OSRM's `NoRoute` code and on `code: "Ok"` with an empty route list. The endpoint answers it with **404** and its own code rather than the 502 an unreachable router gets, and the dialog shows "No route is available for this travel mode between these two places" instead of the generic "import unavailable". This is the patchy-bicycle-coverage path.

7. **AC5 — `googleMapsCarOnlyHelper` was renamed, not just reworded.** Its new content covers *all* modes (which import, which are manual), so the old key name would have been a second lie. It is now `googleMapsManualModeHelper`; both references in the dialog were updated and the old key is gone from both dictionaries. A second new key, `googleMapsNoRouteForMode`, backs note 6.

8. **AC3 holds by construction, and is now guarded.** `TripDayGanttSegments.ts` cannot read the transport type: its `TravelSegmentTimes` input type has no `transportType` field at all, and `buildTravelSegments` pushes a literal `kind: "travel"`. Verified rather than assumed, and pinned by a new test that feeds it all five modes and asserts one `"travel"` kind plus an unchanged output shape.

9. **Four silent `default:` branches were the real hazard.** `travelSegmentRepo.toPrismaTransportType` / `fromPrismaTransportType`, `tripRepo.toPrismaTransportType`, `tripRepo.mapTransportType` and the inline ternary at `tripRepo.ts:901` all funnelled anything that was not CAR/SHIP into **FLIGHT** — so walking and cycling would have been stored and displayed as flights with no compile error anywhere. All five are now exhaustive with a `never` check (matching the idiom `toExportTransportType` already used). `transportIconFor` was converted from an `if`-chain with a `CarIcon` fallback to an exhaustive switch plus a `never` assignment; the trailing `return CarIcon` is unreachable for any value the type admits and exists only so a row that bypassed validation renders instead of crashing the timeline.

10. **Backward compatibility is one-way and that is intended.** The import schema change is accept-more, so every pre-6.16 backup still parses — pinned by a new test that exports and re-imports a trip carrying all three legacy modes. A backup written *after* this story cannot be opened by a pre-6.16 build, which the story's Dev Notes accept explicitly.

11. **Accessibility.** The two new glyphs are `aria-hidden` decoration inside the existing 22px timeline marker, exactly like `CarIcon`/`ShipIcon`/`PlaneIcon`; the mode is always also carried as text in the segment row's label ("Walking · 20m · 1.5 km"), so no meaning rests on the glyph or on colour. The new options are plain MUI `MenuItem`s in the existing `Select`, inheriting its focus ring, keyboard operability and touch target. Both dictionaries carry every new key; no key is orphaned.

12. **Task 7 (manual browser check) was not attempted and is not ticked** — it requires a human, a throwaway `dev.db` copy and live routing.

### File List

**Modified — schema**
- `travelplan/prisma/schema.prisma` — two enum members plus the no-DDL rationale
- `travelplan/src/generated/prisma/enums.ts`, `travelplan/src/generated/prisma/internal/class.ts` — regenerated by `prisma generate`

**Modified — source**
- `travelplan/src/components/features/trips/TripIcons.tsx` — `WalkIcon`, `BikeIcon`, exhaustive `transportIconFor`
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — new modes, distance rule, per-mode route request, `travelmode`, degraded/no-route messaging
- `travelplan/src/components/features/trips/TripDayView.tsx` — widened union, distance shown for ground modes
- `travelplan/src/components/features/trips/TripTimeline.tsx` — widened union
- `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` — two transport labels
- `travelplan/src/lib/repositories/travelSegmentRepo.ts` — `TransportTypeInput`, exhaustive mappers
- `travelplan/src/lib/repositories/tripRepo.ts` — `TransportTypeInput`, exhaustive export/import mappers, ternary chains removed
- `travelplan/src/lib/routing/dayRouteService.ts` — `RoutingProfile`, `routing_no_route`
- `travelplan/src/lib/validation/travelSegmentSchemas.ts` — widened enum, stated distance rule
- `travelplan/src/lib/validation/travelSegmentRouteLookupSchemas.ts` — `mode` parameter
- `travelplan/src/lib/validation/tripImportSchemas.ts` — widened enum
- `travelplan/src/app/api/trips/[id]/travel-segments/route-preview/route.ts` — mode→profile, 404 for no-route
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — 4 keys added, 1 renamed

**Modified — tests**
- `travelplan/test/travelSegmentSchemas.test.ts` (+4), `travelplan/test/travelSegmentDialog.test.tsx` (+9)
- `travelplan/test/travelSegmentRoutePreview.test.ts` (+8), `travelplan/test/dayRouteService.test.ts` (+5)
- `travelplan/test/tripDayGanttSegments.test.ts` (+1), `travelplan/test/tripDayViewLayout.test.tsx` (+1)
- `travelplan/test/tripBackupRoundTrip.test.ts` (+2)

**Created:** none. **No migration file was added** — see Completion Note 1.

### Change Log

| Change | Why |
| --- | --- |
| `TravelTransportType` gains `WALKING`, `CYCLING` | AC1 |
| No migration file | The column is bare `TEXT`; the widening emits no DDL, proven by `migrate diff` (Note 1) |
| `WalkIcon`, `BikeIcon`; `transportIconFor` exhaustive | AC2 |
| Five `default:` branches made exhaustive | They mapped every new mode to FLIGHT silently (Note 9) |
| AC3 pinned by a new test | Guard against a per-mode distinction in the coverage bar |
| `mode` parameter on route-preview; OSRM `walking`/`cycling` profiles | AC4 |
| Google deep link `travelmode` = `walking` / `bicycling` | AC4, Google's own spelling |
| `routing_no_route` + 404 + its own message | AC4, patchy bicycle coverage is an answer not a failure |
| `googleMapsCarOnlyHelper` → `googleMapsManualModeHelper`, rewritten | AC5, the name became a lie too |
| Distance allowed for car/walking/cycling, required for car only | AC6 (Note 2) |
| Import schema and export mapper widened | AC7 |
