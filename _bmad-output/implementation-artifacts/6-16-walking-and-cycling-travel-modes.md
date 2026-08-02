---
authored_against: ac03570
baseline_revision: 68607e045cfbc3e304b591d1d95e43798303dd6e
status: in-review
review_loop_iteration: 0
warnings: []
---

# Story 6.16: Walking and Cycling as Travel Modes

Status: in-progress

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
  - [x] Generate a migration. On SQLite Prisma has no native enum, so check what the existing migration actually produced before assuming a simple `ALTER TYPE` — an enum backed by a `TEXT` column with a check constraint needs the constraint widened, which on SQLite means a table rebuild.
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
  - [x] `npm test` green, `npm run check:migrations` green.

- [ ] **Task 7 — Manual check** (AC: 4)
  - [ ] Route import for a walking leg and a cycling leg between two located points, and confirm the duration and distance prefill.
  - [ ] A cycling leg somewhere Google has no bicycle data, to see the empty-result path.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

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
