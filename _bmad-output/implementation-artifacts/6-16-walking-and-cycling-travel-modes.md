---
authored_against: ac03570
---

# Story 6.16: Walking and Cycling as Travel Modes

Status: ready-for-dev

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

- [ ] **Task 1 — Schema and migration** (AC: 1)
  - [ ] `prisma/schema.prisma:36-40` — `enum TravelTransportType { CAR SHIP FLIGHT }`. Add the two new members.
  - [ ] Generate a migration. On SQLite Prisma has no native enum, so check what the existing migration actually produced before assuming a simple `ALTER TYPE` — an enum backed by a `TEXT` column with a check constraint needs the constraint widened, which on SQLite means a table rebuild.
  - [ ] `scripts/check-migration-immutability.sh` guards this directory; run `npm run check:migrations` before and after.
  - [ ] Additive only: no existing row's value changes.

- [ ] **Task 2 — Icons** (AC: 2)
  - [ ] `TripIcons.tsx:334` — `transportIconFor(transportType: "car" | "ship" | "flight")` returns one of three. Widen the union and add two glyphs beside `CarIcon` / `ShipIcon` / `PlaneIcon` (`:269`, `:294`, `:318`).
  - [ ] Match the module's conventions: `IconProps` with `SxProps<Theme>`, `aria-hidden`, `viewBox="0 0 24 24"`, the `sx={[{ fontSize: … }, ...]}` array-merge shape.
  - [ ] Widen the type rather than adding a default branch. A default hides the next mode someone forgets.

- [ ] **Task 3 — Selection and validation** (AC: 1, 6)
  - [ ] `TripDayTravelSegmentDialog.tsx` renders the transport choice — add both, in both dictionaries.
  - [ ] `trips.travelSegment.distanceRequired` reads "Entfernung ist für Auto erforderlich". Decide whether walking and cycling require a distance. A cycled leg plausibly has one; a five-minute walk plausibly does not. Whatever is chosen, the message must name the modes it applies to rather than saying "für Auto" while enforcing more.

- [ ] **Task 4 — Google route import** (AC: 4, 5)
  - [ ] The import is car-only today. Google's Directions API takes `mode=walking` and `mode=bicycling`; map the two new types onto them.
  - [ ] Ship and flight have no Google equivalent — they must keep falling back to the manual path, not error.
  - [ ] Rewrite `googleMapsCarOnlyHelper`. It currently asserts a fact that stops being true; a stale helper is worse than none because the user believes it.
  - [ ] Bicycling directions are unavailable in many regions. A route request that comes back empty must read as "no route for this mode here", not as a failure of the feature.

- [ ] **Task 5 — Check every reader of the type** (AC: 3, 7)
  - [ ] `TripDayGanttSegments.ts:4` types its kinds as `"accommodation" | "planItem" | "travel" | "gap"` and pushes `"travel"` at `:109` without reading the transport type at all — so AC3 holds by construction. **Verify it still does after the change** rather than assuming; this AC is a guard against someone introducing a distinction while they are in the area.
  - [ ] Export (`tripRepo.ts`'s export shape) and import (`tripImportSchemas.ts`) both carry the type. The import schema likely validates against the enum — widen it, and confirm a backup written before this story still imports.
  - [ ] Grep for the three literals across `src/` — anything switching on them needs the two new cases or a widened type.

- [ ] **Task 6 — Tests** (AC: 1, 4, 6, 7)
  - [ ] Add a travel segment of each new type and assert it renders with its own glyph and rolls into the day's travel total.
  - [ ] Assert the coverage bar still reports one `"travel"` kind regardless of mode.
  - [ ] Assert a round trip through export and import preserves both new values, and that a pre-change backup still imports.
  - [ ] `npm test` green, `npm run check:migrations` green.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
