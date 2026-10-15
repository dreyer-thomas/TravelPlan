---
baseline_commit: cfb5690ec2a176fa9b149cfa92dd9af7a32dd552
---

# Story 6.31: Train and Bus as Travel Modes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to record a leg as taken by train or by bus,
so that a rail or coach journey no longer has to be filed as car, ship or flight.

**Source:** Sprint Change Proposal 2026-10-15. Tommy's rulings, 2026-10-15:
1. Train and bus are **two separate modes**.
2. Distance is **allowed but optional** for both.
3. Neither mode gets **automatic route import**.

**Template:** Story 6.16 (`6-16-walking-and-cycling-travel-modes.md`) made this same change for walking and cycling. Most of its hard work is already done (see *Read this first*).

## Read this first: why this story is small, and where it can still go wrong

Story 6.16 and its review left the transport vocabulary in good shape:

- **One source of truth.** `TRANSPORT_TYPES` in `src/lib/trips/transportTypes.ts:15`, together with the distance rule beside it. `travelTransportTypeSchema` (`travelSegmentSchemas.ts:21`) is `z.enum(TRANSPORT_TYPES)`, so the write API widens automatically.
- **Exhaustive mappers with a `never` guard.** A mapper with a missing case fails to compile. These are:
  - `transportIconFor` (`TripIcons.tsx:459`)
  - `TRANSPORT_LABEL_KEYS: Record<TransportType, string>` (`TripDayPrintDocument.tsx:53`)
  - `toPrismaTransportType` / `fromPrismaTransportType` (`travelSegmentRepo.ts:108-152`)
  - `toExportTransportType` (`tripRepo.ts:1771`) and `toPrismaTransportType` (`tripRepo.ts:2393`)
- **No migration.** `travel_segments.transport_type` is plain `TEXT` with no CHECK constraint (the comment at `prisma/schema.prisma:47-50`). Adding enum members emits no DDL. 6.16 checked this and generated no migration. Do the same. Run `npm run check:migrations`: it must pass, and `prisma/migrations/` must be unchanged.
- **The receipt schema is derived.** `dayChangeReceiptSchemas.ts:58-64` checks `isTransportType(value.toLowerCase())`, so an Epic 11 undo of a day that holds a train leg validates once `TRANSPORT_TYPES` is widened.

**Some places are *not* derived, and the compiler will not flag them. A half-done version will ship green here:**

| # | Place | Today | What goes wrong if you skip it |
|---|---|---|---|
| H1 | `tripImportSchemas.ts:294` | `transportType: z.enum(["car", "ship", "flight", "walking", "cycling"])` | A backup holding a train leg is refused on import (400). The narrower literal union still fits `TransportTypeInput`, so `tsc` is happy. **Derive it from `TRANSPORT_TYPES`** (`z.enum(TRANSPORT_TYPES)`), as `travelSegmentSchemas.ts` does, and update the comment above it. |
| H2 | `dayChangeReceipt.ts:36` | `type DayChangeTransportType = "CAR" \| "SHIP" \| "FLIGHT" \| "WALKING" \| "CYCLING"` | Prisma's widened `TravelTransportType` may or may not be assigned into it somewhere, so `tsc` may or may not catch it. **Derive it:** `Uppercase<TransportType>` (import the type from `transportTypes.ts`), or add the two literals and pin them with a test. Prefer deriving. |
| H3 | `TripDayTravelSegmentDialog.tsx:719-723` | Five hand-written `<MenuItem>`s | The mode exists everywhere except the one place a user can pick it. Add `train` and `bus` (order below). Mapping over `TRANSPORT_TYPES` is acceptable only if the order is pinned there. The current order (car, walking, cycling, ship, flight) is **not** the array order, so keep the explicit list. |
| H4 | `TripDayView.tsx:2396` | `` t(`trips.travelSegment.transport.${segment.transportType}`) `` | A template-literal key. A missing dictionary entry prints the raw key on screen with `tsc` green. Covered by adding the keys (Task 3) and by H5. |
| H5 | `test/i18nDictionaries.test.ts:803-809` `DAY_PRINT_KEYS` | Lists the five `transport.*` keys by hand | Add `transport.train` and `transport.bus`. Better: build the transport part of the list from `TRANSPORT_TYPES`, so the next mode cannot be forgotten here either. |
| H6 | `travelSegmentSchemas.ts:60` | Error message `"Distance is only allowed for car, walking and cycling travel"` | Becomes wrong as soon as train and bus allow distance. `test/travelSegmentSchemas.test.ts:80` asserts the exact string, so update both. |
| H7 | `googleMapsManualModeHelper` (`de.ts:425`, `en.ts:443`) | DE: "… deckt Auto, zu Fuß und Fahrrad ab. Schiff und Flug trägst du manuell ein." | Stops being true, because train and bus are manual too, and the copy has a **hard ceiling of 110 characters** (`i18nDictionaries.test.ts:200`). See AC5. |

## Acceptance Criteria

1. **Two new modes, additive, no migration.**
   - `train` and `bus` join `TRANSPORT_TYPES`. `TRAIN` and `BUS` join `enum TravelTransportType` in `prisma/schema.prisma`; update the comment above it ("the two new members" → name all four added since the original three, or make it generic). Regenerate the Prisma client (`npx prisma generate`).
   - Both modes can be chosen in the travel-segment dialog.
   - Labels: German **"Bahn"** and **"Bus"**, English **"Train"** and **"Bus"**, under `trips.travelSegment.transport.train` and `.bus` in both dictionaries.
   - Every existing segment keeps its type. `npm run check:migrations` passes, with no new directory under `prisma/migrations/`.

2. **Own glyphs.**
   - `TrainIcon` and `BusIcon` are added to `TripIcons.tsx` beside `CarIcon` … `BikeIcon`. They follow the module's conventions: `IconProps`, `aria-hidden`, `viewBox="0 0 24 24"`, `fontSize: 14`, the `sx` array-merge shape, stroke-only with `strokeWidth={2}`, round caps and joins.
   - `transportIconFor` returns them, and neither mode falls through to `CarIcon`.
   - Widen the parameter type to `TransportType` (imported from `@/lib/trips/transportTypes`) instead of extending the hand-written literal union. That union is the same trap as H2.
   - At 14 px a bus must not read as a car, so draw the bus as a tall box with a window band, not a car silhouette. The train is a front-on rail car on two short rails/wheels.

3. **Distance: allowed, not required.**
   - `TRANSPORT_TYPES_ALLOWING_DISTANCE` gains `train` and `bus`. `TRANSPORT_TYPES_REQUIRING_DISTANCE` stays `["car"]`.
   - The dialog shows the distance field for both modes and saves without one.
   - The day-view label (`TripDayView.tsx:2393-2405`) and the print sheet (`TripDayPrintDocument.tsx:462`) show the distance when one is present. Both already go through `transportTypeAllowsDistance`, so no code change should be needed there, only tests.
   - The schema error message (H6) names the rule without listing every mode. Suggested: `"Distance is not allowed for ship and flight travel"`. Its sense flips from "only allowed for X" to "not allowed for Y", the smaller and more stable set. Update the docblock in `transportTypes.ts` so it states the rule for all seven modes.

4. **No automatic route import.**
   - `GOOGLE_TRAVEL_MODE_BY_TRANSPORT` (`TripDayTravelSegmentDialog.tsx:49`), `travelSegmentRouteLookupModeSchema` (`travelSegmentRouteLookupSchemas.ts:15`), `ROUTING_PROFILE_BY_MODE` (`route-preview/route.ts:20`) and `RoutingProfile` (`dayRouteService.ts:16`) are **not** widened.
   - Train and bus therefore take the existing non-routable path, exactly like ship and flight: `isRoutableTransportType` is false, `staticRouteHelper` shows the manual-mode helper when adding, the "Plan" press sets it as an Alert when editing (`:460-468`), and the Google Maps link carries no `travelmode`.
   - Switching an already-prefilled car leg to train restores the opened values, as `handleTransportTypeChange` (`:344-361`) does today for ship.

5. **Helper text stays true and short.**
   - `googleMapsManualModeHelper` keeps naming the three importing modes. It now covers *every* other mode generically instead of listing ship and flight, so it stays true for the next mode too.
   - Proposed copy (measured):
     - DE: `"Der Routenimport deckt Auto, zu Fuß und Fahrrad ab. Alle anderen Verkehrsmittel trägst du manuell ein."` (102 characters)
     - EN: `"Automatic route import covers car, walking and cycling. Every other mode is entered manually."` (93 characters)
   - The existing tests at `i18nDictionaries.test.ts:197-219` (ceiling 110; names car/walking/cycling, and Auto/zu Fuß/Fahrrad) must pass unchanged.

6. **Every surface treats it as travel.** With no new segment kind, no new colour and no special case, a train or bus leg:
   - is drawn as `"travel"` by the coverage bar and Gantt (`TripDayGanttSegments.ts`, which never reads the mode),
   - counts in the day's travel total,
   - takes part in the Epic 11 push and sweep (`src/lib/trips/dayPlanPush.ts`, `src/lib/repositories/dayPlanPushTransaction.ts`, `travelSegmentRepo.ts`), which do not read the mode either.

   Verify this with a grep rather than assuming it.

7. **Backups and receipts round-trip.**
   - A trip with a train leg (with a distance) and a bus leg (without one) exports and re-imports with both types and the distance intact (H1).
   - A backup written before this story still imports.
   - An Epic 11 receipt holding a `TRAIN` row validates and undoes (H2).
   - Known and accepted: a backup holding train or bus, opened by a pre-6.31 build, is refused. This is the same trade 6.16 accepted; update the comment at `tripImportSchemas.ts:291-293` to say so.

8. **The hand-written lists are pinned.**
   - A test fails if `TRANSPORT_TYPES` gains a member that the dialog's `<MenuItem>` list does not offer. Render the dialog, open the select, and compare the option values as a **set** against `TRANSPORT_TYPES`.
   - H1, H2 and H5 are derived, not pinned (see the table).
   - Mutation check: temporarily delete the `bus` `<MenuItem>`, confirm the test fails, then restore it. Record this in the Completion Notes.

## Tasks / Subtasks

- [x] **Task 1: Vocabulary and schema** (AC: 1, 3)
  - [x] `transportTypes.ts`: `TRANSPORT_TYPES = ["car", "ship", "flight", "walking", "cycling", "train", "bus"]`. Append; do not reorder, because nothing should depend on the order and appending makes that true. `TRANSPORT_TYPES_ALLOWING_DISTANCE` gains `train` and `bus`. Rewrite the docblock above it so it covers all modes, including Tommy's 2026-10-15 ruling (rail kilometres are rarely known but worth keeping when they are).
  - [x] `prisma/schema.prisma`: `TRAIN` and `BUS` in `TravelTransportType`, and the comment updated. Run `npx prisma generate`. Run `npm run check:migrations` before and after, and confirm `git status prisma/migrations` is clean.
  - [x] `travelSegmentSchemas.ts:60`: new message (AC3).

- [x] **Task 2: Mappers** (AC: 1, 7)
  - [x] Add the `train`/`TRAIN` and `bus`/`BUS` cases to the four exhaustive switches. The compiler lists them once `TRANSPORT_TYPES` and the Prisma enum are widened, and `npx tsc --noEmit` is the checklist.
  - [x] `tripImportSchemas.ts:294`: `z.enum(TRANSPORT_TYPES)` and the comment updated (H1). Check that the module already imports from `@/lib/trips/transportTypes` or can, since it is zod-free and dependency-free.
  - [x] `dayChangeReceipt.ts:36`: derive `DayChangeTransportType` (H2). Check that `dayChangeReceiptSchemas.ts:64`'s cast still type-checks.
  - [x] `tripRepo.ts:1643`: the comment mentions WALKING and CYCLING as the example. Leave it unless it now reads wrong.

- [x] **Task 3: UI** (AC: 1, 2, 4, 5)
  - [x] `TripIcons.tsx`: add `TrainIcon` and `BusIcon`, and widen `transportIconFor` to `TransportType` (AC2).
  - [x] `TripDayTravelSegmentDialog.tsx:719-723`: menu order **car, walking, cycling, train, bus, ship, flight**. Ground modes first, then the public-transport pair, then the two long-haul modes.
  - [x] `de.ts` / `en.ts`: the two `transport.*` keys beside the existing five, and the rewritten `googleMapsManualModeHelper` (AC5).
  - [x] Do **not** touch the Google, OSRM or route-lookup maps (AC4).

- [x] **Task 4: Verify the readers** (AC: 6)
  - [x] Run `git grep -nE "transportType|TransportType" -- src ':!src/generated'` and go through every hit. Anything that switches on, compares with or lists the mode either gets the new cases or is shown not to care. List the "does not care" ones in the Completion Notes. Known: `TripTimeline.tsx:122` (type only), `TripDayGanttSegments.ts` (never reads it), the push and sweep.

- [x] **Task 5: Tests** (AC: 1–8)
  - [x] `test/travelSegmentSchemas.test.ts`: train and bus accepted. Distance allowed and optional for both. Ship and flight with a distance still refused, under the new message. Mirror the 6.16 block at `:45-82`.
  - [x] `test/travelSegmentDialog.test.tsx`: both modes appear in the select. Picking train shows the distance field, saves without a distance, and sends `transportType: "train"`. No route lookup request is made for train or bus (assert the fetch mock was not called with `route-preview`), and the manual-mode helper renders when adding. Add the AC8 set-equality test here.
  - [x] `test/tripDayViewLayout.test.tsx` (mirror 6.16's test at `:4742`): a train leg and a bus leg each render their own glyph, not the car glyph, and the label shows "Bahn · … · 120 km" with a distance.
  - [x] `test/tripDayPrintDocument.test.tsx`: "Train · 2h · 120 km" and "Bus · 45m" (no distance) print correctly. Mirror `:437-465`.
  - [x] `test/i18nDictionaries.test.ts`: derive or extend `DAY_PRINT_KEYS` (H5). The existing helper tests must stay green unchanged.
  - [x] `test/tripBackupRoundTrip.test.ts`: a round trip with `TRAIN` (with distance) and `BUS` (without), mirroring `:314-410`. The legacy-backup test at `:422` stays green.
  - [x] `test/dayChangeReceipt.test.ts` / `test/dayPlanChangeUndo.test.ts`: one receipt row with `transportType: "TRAIN"` validates and undoes.
  - [x] Full gates: `npm test`, `npx tsc --noEmit` (0 src errors), `npm run lint` (no new warnings over the 80 baseline), `npm run check:migrations`.

### Review Findings

Code review 2026-10-16 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). No AC violations. The AC2 glyphs were rendered and inspected at 14 px and at 4× scale. Car, train and bus read as three distinct shapes, which closes the dev's open "nobody has looked at them" flag.

- [x] [Review][Decision] Google Maps link for train and bus: `travelmode=transit` or none. **Resolved by Tommy (1b): transit link.** Implemented as a separate `GOOGLE_LINK_MODE_BY_TRANSPORT` map in the dialog, so the router gate (`isRoutableTransportType`) is not widened. The tests now pin `travelmode=transit`, and a mutation check (removing `train` from the map) fails the Train case. This is Dev Notes Question 1, implemented with its default (no `travelmode`). Google deep links do support `transit`, which the "no route import" ruling does not strictly cover. The new dialog tests pin the absence (`travelSegmentDialog.test.tsx`).
- [x] [Review][Patch] Stale comments still name only ship/flight as the manual modes, or "the five" [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:453,462,645; travelplan/src/components/features/trips/TripDayPrintDocument.tsx:446]
- [x] [Review][Patch] The day-view test's AC6 docblock promises a "Travel once" legend check the test never makes, and the travel-total check `/2.*45/` is loose. Assert `"Fahrt"` and the exact `"2h 45m"`. [travelplan/test/tripDayViewLayout.test.tsx:4892,5030]
- [x] [Review][Patch] The "names no individual manual mode" test hard-codes `["ship","flight","train","bus"]` and matches by substring. Derive the manual modes from `TRANSPORT_TYPES` minus `travelSegmentRouteLookupModeSchema.options`, and match whole words. [travelplan/test/i18nDictionaries.test.ts:228]
- [x] [Review][Defer] Rolling back to a pre-6.31 build after a TRAIN/BUS row exists 500s that trip's reads and export: the old mappers throw on the unknown value [travelplan/src/lib/repositories/travelSegmentRepo.ts:148] — deferred, pre-existing (the same one-way trade 6.16 made); DW-379
- [x] [Review][Defer] Switching a leg that has a typed distance to ship/flight drops the distance silently on save [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:345] — deferred, pre-existing since 6.16 (walking/cycling → ship); DW-380

## Dev Notes

### What must not regress

- **Route import for car, walking and cycling.** `test/travelSegmentRoutePreview.test.ts` and `test/dayRouteService.test.ts` must pass untouched. If one needs editing, AC4 has been broken.
- **The two helper tests in `i18nDictionaries.test.ts:197-219`.** They encode 6.16's AC5 and 6.18's length budget.
- **6.16's ship/flight distance refusal.** It is still enforced, only re-worded.
- **Epic 11.** A train or bus leg pushes the day exactly like a car leg (11.4). There is no mode-specific code in the push, and none may be added.
- **`TripDayGanttSegments.ts` keeps its four kinds.** The coverage bar never reads the mode.

### Previous story intelligence

- **6.16:**
  - Its first draft assumed a migration was needed. The check showed none was. Do not generate one "to be safe": `check:migrations` guards the directory, and an empty migration is noise.
  - The review of 6.16 is why the vocabulary module, the exhaustive mappers and the derived write schema exist. This story exists to extend that pattern to the three places it did not reach (H1, H2, H3).
- **6.18:** set the 110-character ceiling on the manual-mode helper. Shortening the copy to fit it is expected, not a workaround.
- **DW-230 (print labels):** the print sheet prints an unknown `transportType` raw on purpose. With `train` in `TRANSPORT_TYPES`, membership passes and the dictionary key is used, so H5 is what guards it.
- **11.1–11.4:** receipts carry full stored rows in uppercase. The receipt schema is already derived (see *Read this first*); only the TS type (H2) is hand-written.

### Git intelligence

The last commits (`cfb5690` 11.4, `b9df833` 11.1–11.3) touched `travelSegmentRepo.ts`, `dayChangeReceipt.ts` and `dayChangeReceiptSchemas.ts`. Edit the current files, not 6.16's line numbers; all line numbers above were taken at `cfb5690`. No dependency changes: this story adds none.

### Project Structure Notes

- No new files except tests. Icons stay in `TripIcons.tsx`, the vocabulary in `transportTypes.ts`, and copy in `src/i18n/{de,en}.ts`.
- `transportTypes.ts` must stay zod-free and dependency-free (its docblock). Client components import it.

### Questions for Tommy (not blocking; the defaults above apply)

1. **Google Maps link for train and bus.** The "Maps" link in the dialog (a link, not the import) could open Google with `travelmode=transit`, which shows real connections. The default here is no `travelmode`, the same as ship and flight, to keep the story strictly within the "no routing" ruling. If you want the transit link, it is a few lines: a separate `GOOGLE_LINK_MODE_BY_TRANSPORT` map, so the import gate is not widened at the same time.
2. **Menu order.** Car, walking, cycling, train, bus, ship, flight. Change it if you think in a different order.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.31]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-15.md]
- [Source: _bmad-output/implementation-artifacts/6-16-walking-and-cycling-travel-modes.md]
- [Source: travelplan/src/lib/trips/transportTypes.ts]
- [Source: travelplan/prisma/schema.prisma#TravelTransportType]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md, activity timeline neutral-marker rule: transport glyphs are legitimate because they derive from `transportType`]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story.

### Debug Log References

- Baseline at `cfb5690`: `tsc` 0 errors, lint 0 errors / 80 warnings, `check:migrations` passing.
- `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` gives **byte-identical** output for the HEAD schema and the widened one. The enum adds no DDL. The diff is not empty, but its 42 lines are older index drift that has nothing to do with this story. It is left alone.
- Red before green, every step: schema tests (3 red), print (2 red), i18n (4 red), dialog (11 red), day view (1 red: both glyphs fell through to `CarIcon` at runtime).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Task 1.** `TRANSPORT_TYPES` gains `train` and `bus`, appended at the end. `TRANSPORT_TYPES_ALLOWING_DISTANCE` gains both. `TRANSPORT_TYPES_REQUIRING_DISTANCE` stays `["car"]`. The docblock now states the distance rule for all seven modes, including Tommy's 2026-10-15 ruling. Prisma enum: `TRAIN` and `BUS` added, the comment made generic, client regenerated. No migration: `check:migrations` passes before and after, and `prisma/migrations/` is unchanged. Schema message: `"Distance is not allowed for ship and flight travel"`.
- **Task 2.** The four exhaustive switches got the new cases. **H1:** `tripImportSchemas.ts` now uses `z.enum(TRANSPORT_TYPES)`, and its comment records the accepted trade (an old build refuses a newer backup). **H2:** `DayChangeTransportType = Uppercase<TransportType>`. In practice `tsc` *did* flag H2: six errors in `dayPlanItemRepo.ts` and `travelSegmentRepo.ts:586` once the Prisma enum was widened. The cast at `dayChangeReceiptSchemas.ts:64` still type-checks. The `tripRepo.ts:1643` comment still reads correctly and was left alone.
- **Task 3.** `TrainIcon` (rounded front-on cab, split windscreen, two splayed legs to the rails) and `BusIcon` (taller, square box, full-width window band, two wheel stubs) follow the module's conventions. `transportIconFor` now takes `TransportType`. Menu order: car, walking, cycling, train, bus, ship, flight. Labels: DE "Bahn"/"Bus", EN "Train"/"Bus". Helper copy is exactly as proposed (DE 102 chars, EN 93). The Google, OSRM and route-lookup maps were not widened. I only updated their "ship and flight are absent" comments in `TripDayTravelSegmentDialog.tsx` and `travelSegmentRouteLookupSchemas.ts`.
- **Task 4: the reader sweep.** `git grep` found 137 hits in 14 files. Every hit that switches on, compares or lists a mode is now either complete or deliberately not widened:
  - Complete: the 4 exhaustive switches, `transportIconFor`, `TRANSPORT_LABEL_KEYS`, the dialog menu, and the derived schemas (`travelSegmentSchemas`, `tripImportSchemas`, `dayChangeReceiptSchemas`).
  - Not widened, per AC4: the routing maps (`GOOGLE_TRAVEL_MODE_BY_TRANSPORT`, `travelSegmentRouteLookupModeSchema`, `ROUTING_PROFILE_BY_MODE`, `RoutingProfile`).
  - **Do not care about the mode:** `src/app/api/trips/[id]/route.ts` and `travel-segments/route.ts` (pass-through only); `TripTimeline.tsx:122` (type only); `TripDayView.tsx` (the label goes through the dictionary and `transportTypeAllowsDistance`, the glyph through `transportIconFor`); the `dayChangeReceipt*` modules (derived); `travelSegmentRepo.ts:566` (the push decision reads endpoints and duration only). `TripDayGantt*`, `dayPlanPush.ts`, `dayPlanPushTransaction.ts` and `dayPlanPushResponses.ts` contain **no** `transport` reference at all (grep confirmed). That settles AC6 by grep, not by assumption.
  - Stale comments fixed along the way: `TripDayPrintDocument.tsx` (said "these five" and claimed the import schema does not constrain the mode), `TripDayView.tsx:2399`, and the `dayChangeReceipt.ts` module docblock.
- **Task 5: tests.** Added: 2 schema, 2 print, 3 i18n (the DAY_PRINT_KEYS transport part is now built from `TRANSPORT_TYPES`, plus a test that the helper names no individual manual mode), 12 dialog (set-equality pin, DE order, train saves without a distance, bus keeps its distance, no router call and no `travelmode` for train and bus, edit-mode alert, car→train discards the import, and train/bus added to the DW-114 table), 1 day view (German; glyphs differ from each other *and* from `CarIcon`; "Bahn · … · 120 km"; bus shows no distance; counts in the travel total), 1 backup round trip (TRAIN with 120 km, BUS without), 2 receipt (schema accepts TRAIN/BUS and refuses lowercase; a route-level undo of a receipt holding a swept TRAIN leg restores every row identical). The dialog tests that hard-coded the old helper copy were updated to the AC5 copy. `travelSegmentRoutePreview.test.ts` and `dayRouteService.test.ts` are untouched and pass. The 6.16/6.18 helper tests in `i18nDictionaries.test.ts` pass unchanged.
- **Mutation checks (AC8 and H1):**
  - Deleting the `bus` `<MenuItem>` fails "offers exactly the modes in TRANSPORT_TYPES" with `- "bus"` missing from the set. Restored.
  - Reverting the import enum to the hand-written five-mode list fails the train/bus round trip with exactly the predicted `expected 400 to be 200`. Restored.
- **Gates:** `npm test` passes, 174 files and 2885 tests. `tsc --noEmit` reports 0 errors (src and test). Lint: 0 errors and 80 warnings, the same as the baseline. `check:migrations` passes.
- **Not done, flagged for Tommy:** no SVG rasteriser was available, so nobody has *looked* at the two glyphs at 14 px yet. The test proves they are distinct markup, not that they are legible. A glance at a day view with a train and a bus leg would settle AC2's "a bus must not read as a car". Questions 1 (transit link) and 2 (menu order) in the Dev Notes were implemented with their stated defaults.

### File List

- travelplan/prisma/schema.prisma
- travelplan/src/generated/prisma/enums.ts (regenerated)
- travelplan/src/generated/prisma/internal/class.ts (regenerated)
- travelplan/src/lib/trips/transportTypes.ts
- travelplan/src/lib/trips/dayChangeReceipt.ts
- travelplan/src/lib/validation/travelSegmentSchemas.ts
- travelplan/src/lib/validation/tripImportSchemas.ts
- travelplan/src/lib/validation/travelSegmentRouteLookupSchemas.ts (comment only)
- travelplan/src/lib/repositories/travelSegmentRepo.ts
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/components/features/trips/TripIcons.tsx
- travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx
- travelplan/src/components/features/trips/TripDayPrintDocument.tsx
- travelplan/src/components/features/trips/TripDayView.tsx (comment only)
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/test/travelSegmentSchemas.test.ts
- travelplan/test/travelSegmentDialog.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/test/tripDayPrintDocument.test.tsx
- travelplan/test/i18nDictionaries.test.ts
- travelplan/test/tripBackupRoundTrip.test.ts
- travelplan/test/dayChangeReceipt.test.ts
- travelplan/test/dayPlanChangeUndo.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-10-15: Implemented Story 6.31. Train and bus are added as travel modes, with an optional distance and no route import. Three hand-written lists are now derived (H1 import schema, H2 receipt type, H5 print keys), and the dialog menu is pinned by a set-equality test. Status → review.
- 2026-10-16: Code review (3 layers). Tommy resolved Question 1 as a transit link: train and bus Maps links now carry `travelmode=transit`, while route import stays off. Three patches applied: stale comments, the day-view AC6 legend and total assertions, and the derived whole-word manual-mode i18n test. DW-379 and DW-380 deferred, 11 dismissed. Gates: 174 files / 2885 tests, tsc 0, lint 0/80, check:migrations passes. Status → done.
