---
baseline_commit: 5d86bb8cfd313b041a9a69785b9dd8be32229f70
---

# Story 15.10: The Trip Route at a Glance

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an AI client looking at a whole trip (to draw its map or judge each day's travel),
I want one compact read of where each day goes and how,
so that I do not have to read every day in full and fill my context with texts, costs and files.

*Added 2026-10-31 (Tommy), from a request by a connected Claude client. FRs covered: FR53 (no new FR; a compact read of data already covered). Depends on Story 15.2. Source: `epics.md` → Story 15.10; `sprint-change-proposal-2026-10-31-connector-day-and-route.md` (option A chosen, B live OSRM rejected, C stored road geometry deferred).*

## Acceptance Criteria

1. **Per-day shape.** `get_trip_route(tripId)` is read-only and returns, per day in `dayIndex` order: `date` (YYYY-MM-DD), `dayIndex`, `stay` (`{ name, lat, lng }`, or `null` when the day has no stay or the stay has no position).
2. **Leg totals per day.** `legs`: one entry per transport mode present that day (`car`, `ship`, `flight`, `train`, `bus`, `walking`, `cycling`; lower case as in 15.2), in `TRANSPORT_TYPES` order, each `{ mode, count, distanceKm, durationMinutes }`; `distanceKm` is the sum of the mode's distances, `null` if no leg of that mode has one; `durationMinutes` is the sum of durations.
3. **Path.** `path`: the day's stops in plan order (last night's stay → activities that have a place → tonight's stay) as sections `{ mode, points: [[lat, lng], …] }`; a section's mode is the leg drawn between those stops, or `null` where no leg is drawn. Exact rules in Dev Notes → "Path algorithm".
4. **Missing positions.** Stops without a position are skipped in `path` and counted per day in `missingPositions`.
5. **Drawn legs only.** Only drawn legs count (the `selectDrawnTravelSegments` rule used by FR50 and 15.2), so the per-mode totals summed over the trip match the trip overview's planned distance (`summarizeTripTravel`).
6. **No content.** The answer contains no texts (no titles, descriptions, notes, labels; the stay's `name` from AC 1 is the one exception), no costs, no links, no images, no documents. Coordinates are rounded to 5 decimals.
7. **No routing.** The tool makes no call to any routing service (OSRM or other). Its description tells the model the path connects stops in straight lines, not along roads.
8. **Size and single pass [default].** For a trip of 60 days with 10 stops per day the answer (`JSON.stringify` of the result value) stays below 60 KB, and the tool reads the database in one pass (one `getTripWithDaysForUser` call; no query per day).
9. **Shared rules.** Access check per call (`requireWritableTrip`), `Trip not found` for trips the user cannot write (viewer, stranger, unknown id: identical answer), the 120/min rate limit, one log line with `trip=` and never the arguments — all via `runTool`.
10. **Tests** cover: an empty trip, a day without stay, a ferry day giving a `ship` section, an undrawn (orphaned) leg left out of the totals and out of the path modes, a stop without position, trip totals equal to `summarizeTripTravel`, and no text fields in the answer; plus the size bound, viewer/stranger *not found*, and the read-only annotations.

**Out of scope:** road geometry (option C, a future story if needed); live routing; elevation; any UI change; any schema change.

## Tasks / Subtasks

- [x] **Task 1: Let the shared drawn-leg rule accept repository rows** (AC: 5)
  - [x] In `src/lib/trips/tripTravelSummary.ts`, widen `OrderablePlanItem.createdAt` from `string` to `Date | string` (it is passed straight to `compareDayPlanItemsByOrder`, whose `DayPlanItemOrderable.createdAt` is already `Date | string`; the `?? ""` fallback stays). No behaviour change; `TripTimeline` keeps passing strings. This lets `TripWithDays` days (Prisma `Date`s) go into `selectDrawnTravelSegments` / `summarizeTripTravel` without mapping.
  - [x] `npm run typecheck` to confirm `TripTimeline.tsx` and `test/tripTravelSummary.test.ts` are unaffected.
- [x] **Task 2: Pure route builder** (AC: 1-6, 8)
  - [x] New `src/lib/mcp/routeShapes.ts` exporting `toTripRoute(trip: TripWithDays)` — pure, no I/O, like `plannerShapes.ts`. Result:
    ```ts
    {
      id, startDate, endDate,            // YYYY-MM-DD via toDateKey
      totals: { distanceKm, byMode: [{ mode, count, distanceKm, durationMinutes }] },  // [default], from summarizeTripTravel
      days: [{ date, dayIndex, stay, legs, path, missingPositions }]
    }
    ```
    No trip `name` (it is text and the client already has it from `list_trips`).
  - [x] Iterate `trip.days` in array order (already `dayIndex, date` ordered by the repo) with `previousDay = trip.days[index - 1] ?? null` — **exactly** the convention `summarizeTripTravel` uses, so AC 5 holds by construction.
  - [x] Per day call `selectDrawnTravelSegments(day, previousDay)` once; use its `orderedPlanItems` for the path and its `drawnTravelSegments` for both `legs` and section modes.
  - [x] `legs`: skip segments whose `transportType` fails `isTransportType`; count + sum `durationMinutes`; sum `distanceKm` only when `transportTypeAllowsDistance(mode)` and the value is a finite number (the same guard as `summarizeTripTravel` — a flight/ship distance from an old backup is ignored); round the per-mode sum once to 1 decimal; `null` when no counted leg had one. Order by `TRANSPORT_TYPES`.
  - [x] `totals`: `summarizeTripTravel(trip.days)` mapped to `{ distanceKm: totalKm, byMode: [{ mode: transportType, count: legCount, distanceKm, durationMinutes }] }`. Do not re-derive it.
  - [x] `stay`: `day.accommodation` with a `location` → `{ name, lat, lng }` (rounded), otherwise `null`.
  - [x] `path` and `missingPositions`: see Dev Notes → "Path algorithm".
  - [x] Round coordinates with one helper (`Math.round(v * 1e5) / 1e5`); never emit `NaN`/`Infinity` — a non-finite lat/lng counts as "no position".
- [x] **Task 3: The tool** (AC: 7, 8, 9)
  - [x] Register `get_trip_route` in `registerTripReadTools` (`src/lib/mcp/tools/tripRead.ts`), directly after `get_bucket_list`, with `inputSchema: tripInput` and `annotations: READ_ONLY_TOOL_ANNOTATIONS`. Handler mirrors `get_trip`: `runTool({ name: "get_trip_route", ctx, tripId })` → `requireWritableTrip` → `getTripWithDaysForUser` → `canTripAccessRoleWrite` re-check → `toolResult(toTripRoute(trip))`.
  - [x] Description (English, for the model, names units): what each field is; dates YYYY-MM-DD; coordinates `[lat, lng]` in degrees, 5 decimals; `distanceKm` in km, `durationMinutes` in minutes; **"path connects the stops in straight lines in plan order, not along roads; no routing service is used"**; mode `null` = no leg drawn between those stops; only legs drawn in the day view count, so totals match the trip overview; no texts, costs, links or files here — use `get_day` for those.
  - [x] Do **not** import anything from `dayRouteService.ts` or any OSRM helper.
- [x] **Task 4: Tests** (AC: 10)
  - [x] New `test/mcpRouteShapes.test.ts` (pure, synthetic `TripWithDays`): empty trip (`days: []` and a trip with days but no stops → `legs: []`, `path: []`, `missingPositions: 0`); day without stay; ferry day → a section with `mode: "ship"`; an orphaned leg (non-consecutive pair) absent from `legs` and not giving a mode; a stop without position skipped + counted, and the hop across it has `mode: null`; same hotel two nights (zero-length hop dropped); single positioned stop → one one-point section; unknown transport type → not counted, `mode: null`; coordinates rounded to 5 decimals; per-day `legs` summed over all days equal `summarizeTripTravel(trip.days).byMode` (count and duration exactly; km with one-decimal fixture values) and `totals` equals it; a flight with a stored distance contributes `distanceKm: null`; 60 days × 10 activities + stays + legs → `JSON.stringify(result).length < 60_000`.
  - [x] "No text fields": seed titles/descriptions/notes/links/costs with sentinel strings (e.g. `"SENTINEL-TEXT"`, `linkUrl: "https://sentinel.example"`, `costCents: 987654`) and assert `JSON.stringify(result)` contains none of them; also assert the key set of each day is exactly `["date","dayIndex","stay","legs","path","missingPositions"]`.
  - [x] Extend `test/mcpReadTools.test.ts` with a `describe("get_trip_route")` end to end through `POST /api/mcp` on `seedPlannerTrip` (owner and contributor equal; check one real day's `stay`, `legs` and `path` against the seeded rows), and add `get_trip_route` to the viewer loop in "access (ruling R1)" and to the `readTools` set in the annotations test.
  - [x] Single pass: in a separate file `test/mcpTripRouteSinglePass.test.ts`, `vi.mock("@/lib/repositories/tripRepo", …)` wrapping the real `getTripWithDaysForUser` in a `vi.fn` (the pattern of `test/tripImportTempFileOnThrow.test.ts:27`), call `get_trip_route` on a 3-day seeded trip, and assert it was called exactly once with `(userId, tripId)`. A separate file because a module mock applies to the whole file.
  - [x] Update the tool-name list in `test/mcpRoute.test.ts` (insert `"get_trip_route"` right after `"get_bucket_list"`; registration order = list order). Grep `test/` for other exhaustive tool lists (`tools/list`) and update them too.
  - [x] Widened type: one assertion in `test/tripTravelSummary.test.ts` that a `Date` `createdAt` orders the same as its ISO string.
- [x] **Task 5: Verify**
  - [x] `npm run typecheck`, `npm run lint` (baseline 0 errors / 80 warnings), `npm test`, `npm run build`. Record counts in the Dev Agent Record.

### Review Findings

- [x] [Review][Patch] Tool description: name the top-level `id`, `startDate`, `endDate` and the `totals.byMode` entry fields; say a flight/ship leg's distance is never counted (`distanceKm` null for those modes); say a day with one place gives a one-point section [travelplan/src/lib/mcp/tools/tripRead.ts:163]
- [x] [Review][Patch] AC 9 log line not tested for `get_trip_route` — add a `get_trip_route` call to "logs trip-scoped calls with trip= and never the arguments" [travelplan/test/mcpReadTools.test.ts:402]
- [x] [Review][Defer] Duplicate `dayIndex` rows: array-neighbour previous day (shared with `summarizeTripTravel`) differs from `get_day`'s previousStay [travelplan/src/lib/mcp/routeShapes.ts:149] — deferred, pre-existing (DW-431)

## Dev Notes

### Path algorithm (decided here; record any change as a deviation)

1. Build the day's endpoint list exactly as `selectDrawnTravelSegments` does: `previousDay.accommodation` (if any) → `orderedPlanItems` → `day.accommodation` (if any). Each endpoint keeps `{ type: "accommodation" | "dayPlanItem", id, position | null }`.
2. Build a lookup of the day's **drawn** legs by pair key (`buildDaySegmentPairKeyForSegment` from `daySegmentPairs.ts`), from `drawnTravelSegments`.
3. Walk the positioned endpoints in order. For each consecutive positioned pair at endpoint indices `a < b`:
   - mode = the drawn leg's mode **only if `b === a + 1`** (the two are adjacent in the plan) and a drawn leg `E[a] → E[b]` exists with a valid `isTransportType` mode; otherwise `null` (a hop that skips a stop without position, or has no leg drawn, has no single leg to name).
   - if both points are equal after rounding, drop the hop (same hotel two nights, two activities at one place).
4. Merge consecutive hops with the same mode into one section. Sections share their boundary point (section *n*'s last point is section *n+1*'s first), so a client draws a continuous line.
5. A day with exactly one distinct positioned point gives one section `{ mode: null, points: [[lat, lng]] }`, so the place is not lost; zero positioned points gives `path: []`.
6. `missingPositions` counts the day's **own** stops without a position: its activities and tonight's stay. Last night's stay is not counted again (it is counted on the day it is tonight's stay). A day without any stay row is not a missing position — that is `stay: null`.

### Why these choices
- `getTripWithDaysForUser` (`src/lib/repositories/tripRepo.ts:1112`) already holds everything: per day `accommodation.location`, ordered `dayPlanItems` with `location`, `sortOrder`, `fromTime`, `createdAt`, and `travelSegments` with lower-case `transportType`, `durationMinutes`, `distanceKm`, `fromItemType/Id`, `toItemType/Id`. It is one `findFirst` with nested includes plus one raw `trip_days` read — no query per day (AC 8). `get_trip` uses it already. Do **not** write a new repository query.
- It returns `accommodation: null` for a stay row with an empty name — the same rule the overview uses. Keep it.
- `src/components/features/trips/TripOverviewMapData.ts` is a `"use client"` module importing `parsePlanText` from a component and builds one trip-wide polyline with labels; it does **not** know previous-night stays or leg modes. Do not import it into `src/lib/mcp` and do not move it — the proposal's "move if still under components" is unnecessary, since the drawn-leg logic it needs (`selectDrawnTravelSegments`, `summarizeTripTravel`) already lives in `src/lib/trips/tripTravelSummary.ts`.
- `summarizeTripTravel` rounds km once per mode after summing over the whole trip. Per-day values here are rounded per day, so a sum of per-day `distanceKm` can drift by a few tenths from the overview on real data. That is why `totals` comes from `summarizeTripTravel` itself **[default]** — a client wanting the overview's figure reads `totals`, never re-adds days. State that in the description.

### Size check (AC 8)
60 days × (10 activities + 2 stays) ≈ 12 points/day × ~24 bytes + section/leg overhead ≈ 0.5 KB/day ≈ 30 KB. `toolResult` puts the same JSON in `structuredContent` and in one text item; the 60 KB bound is on the JSON of the value, as AC 8 says. Keep keys short as specified; do not pretty-print.

### Existing code to reuse — do not reinvent
| Need | Use |
|---|---|
| Tool runtime, rate limit, log, generic error | `runTool`, `toolResult`, `requireWritableTrip`, `TRIP_NOT_FOUND`, `READ_ONLY_TOOL_ANNOTATIONS` — `src/lib/mcp/toolRuntime.ts` |
| Trip input schema | `tripInput` in `src/lib/mcp/tools/tripRead.ts` |
| Trip read | `getTripWithDaysForUser` — `src/lib/repositories/tripRepo.ts` |
| Drawn legs, ordered activities | `selectDrawnTravelSegments` — `src/lib/trips/tripTravelSummary.ts` |
| Trip totals | `summarizeTripTravel` — same file |
| Pair keys | `buildDaySegmentPairKey(ForSegment)` — `src/lib/trips/daySegmentPairs.ts` |
| Modes, distance rule | `TRANSPORT_TYPES`, `isTransportType`, `transportTypeAllowsDistance` — `src/lib/trips/transportTypes.ts` |
| Dates | `toDateKey` — `src/lib/mcp/plannerShapes.ts` |

### What must be preserved
- `get_trip`, `get_day`, `get_bucket_list` shapes and descriptions unchanged.
- `selectDrawnTravelSegments` / `summarizeTripTravel` behaviour unchanged (Task 1 is type-only); `TripTimeline` coverage bar and distance card untouched.
- No change to `dayRouteService.ts` or the day map's live OSRM use.

### Architecture compliance (Epic 15 shared rules)
- Tools call repositories only, never Prisma directly.
- Per-call access check; *not found*, never *forbidden*, for trips the user cannot write.
- Short English tool errors; internals never leak (handled by `runTool`).
- Log tool name, user, trip, outcome, duration — never arguments (handled by `runTool` with `tripId`).
- English descriptions written for the model, naming units.
- `architecture.md` (Epic 15 notes, 2026-10-31): "Route reads (15.10) never call OSRM."

### Project Structure Notes
- New: `src/lib/mcp/routeShapes.ts`, `test/mcpRouteShapes.test.ts`.
- Changed: `src/lib/mcp/tools/tripRead.ts`, `src/lib/trips/tripTravelSummary.ts` (type only), `test/mcpReadTools.test.ts`, `test/mcpRoute.test.ts`, `test/tripTravelSummary.test.ts`.
- No schema, migration, i18n or UI change. `server.ts` needs no edit (the tool lives in `registerTripReadTools`).

### Previous story intelligence (15.9, 15.8, 15.2)
- **15.9's changes are in the working tree, not yet committed** (git status shows `tripRepo.ts`, `plannerShapes.ts`, `tripRead.ts`, `server.ts` and many tests modified). Build on top of them; do not revert or reformat them. `TripDaySummary` now carries `note`, `imageUrl`, `aiChangedAt` — none of which may appear in this tool's answer.
- 15.2 established: lower-case modes; dates `YYYY-MM-DD` in UTC (`toDateKey`, never local time); drawn legs only (D1); tool output tested both as `structuredContent` and as the identical text item (`structured()` helper in `mcpReadTools.test.ts`).
- 15.9 D4: the app's raw read of `trip_days.updated_at` parses as local time — irrelevant here, as this tool emits no timestamps. Do not add `updatedAt`.
- Reviews in this epic repeatedly caught: tool-name lists in tests not updated, descriptions promising more than the data holds, and duplicated derivations drifting. This story's design (reuse `selectDrawnTravelSegments` + `summarizeTripTravel`, no new query) is aimed at the last one.

### Git intelligence
Recent commits: `5d86bb8` file links end in the served extension; `dd85166` 15.8 signed download links; `4653c59` upload limit 50/h; `e05a01d` 15.7. Tests are vitest with a real SQLite test database (`test/helpers/oauthFixtures.ts` `setupConnectorEnvironment`, `test/helpers/mcpClient.ts` `callTool`/`issueAccessToken`, `test/helpers/plannerFixtures.ts` `seedPlannerTrip`).

### Latest tech information
No new library. `@modelcontextprotocol/server` `registerTool` with a zod `inputSchema` and `annotations`, exactly as the other read tools. No external service.

### Open defaults (Tommy may overrule)
1. `totals` (trip-wide per-mode, from `summarizeTripTravel`) added beside the per-day figures, so a client never re-adds rounded day values.
2. A hop across a stop without position gets `mode: null`, even when the legs on both sides share a mode.
3. A day with one positioned stop yields a one-point section; zero-length hops are dropped.
4. `missingPositions` does not count last night's stay a second time.
5. No trip `name` in the answer.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 15.10]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 15 shared rules]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-31-connector-day-and-route.md#3 Recommended Approach]
- [Source: _bmad-output/planning-artifacts/architecture.md — Epic 15 connector notes, 2026-10-31 line]
- [Source: travelplan/src/lib/trips/tripTravelSummary.ts]
- [Source: travelplan/src/lib/trips/daySegmentPairs.ts]
- [Source: travelplan/src/lib/repositories/tripRepo.ts#getTripWithDaysForUser]
- [Source: travelplan/src/lib/mcp/tools/tripRead.ts, toolRuntime.ts, plannerShapes.ts]
- [Source: _bmad-output/implementation-artifacts/15-9-the-days-own-note-and-picture.md#Dev Agent Record]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story

### Debug Log References

- Red first: `test/mcpRouteShapes.test.ts` failed on the missing module before `routeShapes.ts` existed. One later failure was the test's own Map-insertion order in the per-day summation (flight before car); compared keyed by mode instead. No implementation change needed.
- Single pass verified through the module mock: the spy saw exactly one `getTripWithDaysForUser(userId, tripId)` call (a zero count would have meant the mock did not intercept).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (2026-10-31).
- Task 1: `OrderablePlanItem.createdAt` widened to `Date | string` (type only); new test pins that a `Date` orders like its ISO string.
- Task 2: `src/lib/mcp/routeShapes.ts` — pure `toTripRoute(trip)`: `{ id, startDate, endDate, totals, days }`, days `{ date, dayIndex, stay, legs, path, missingPositions }`. Days walked in array order with `days[index - 1]` as previous day; `selectDrawnTravelSegments` once per day drives both `legs` and section modes; `totals` mapped from `summarizeTripTravel`. Path algorithm implemented exactly as in Dev Notes (adjacency required for a mode, zero-length hops dropped, same-mode hops merged with shared boundary points, one-point section for a single place, `missingPositions` = own activities + tonight's stay). Coordinates rounded to 5 decimals with `-0` normalised to `0`; non-finite lat/lng = no position.
- Task 3: `get_trip_route` registered after `get_bucket_list` in `registerTripReadTools`, read-only annotations, same gate as `get_trip` (`runTool` → `requireWritableTrip` → `getTripWithDaysForUser` → role re-check). Description names units, the straight-line/no-routing rule, `mode: null`, drawn-legs-only and "read totals rather than adding days". No OSRM / `dayRouteService` import.
- Task 4: 16 pure tests (`mcpRouteShapes.test.ts`, all AC 10 cases incl. sentinel no-text check, exact key sets, 60×10 size bound < 60 000 chars), 3 end-to-end tests in `mcpReadTools.test.ts` (full answer on the seeded trip, stranger = unknown id, description text) plus `get_trip_route` in the viewer loop, the owner/contributor equality loop and the read-only annotation set; single-pass file; `mcpRoute.test.ts` tool list. No other exhaustive tool list exists in `test/`.
- Open defaults 1-5 from the story kept as written; no deviations.
- Task 5: `npm run typecheck` clean; `npm run lint` 0 errors / 80 warnings (baseline); `npm test` 260 files / 4161 passed (from 258 / 4140); `npm run build` ok.

### File List

- travelplan/src/lib/mcp/routeShapes.ts (new)
- travelplan/src/lib/mcp/tools/tripRead.ts (modified)
- travelplan/src/lib/trips/tripTravelSummary.ts (modified, type only)
- travelplan/test/mcpRouteShapes.test.ts (new)
- travelplan/test/mcpTripRouteSinglePass.test.ts (new)
- travelplan/test/mcpReadTools.test.ts (modified)
- travelplan/test/mcpRoute.test.ts (modified)
- travelplan/test/tripTravelSummary.test.ts (modified)
- _bmad-output/implementation-artifacts/15-10-the-trip-route-at-a-glance.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-10-31: Story 15.10 implemented — `get_trip_route` read tool (pure `toTripRoute`, one trip read, drawn legs only, totals from `summarizeTripTravel`, straight-line path, no routing); status → review.
- 2026-10-31: Code review (bmad-code-review): 2 patches applied (get_trip_route description names top-level fields, byMode fields, flight/ship null distance and the one-point section; log-line test covers get_trip_route), DW-431 deferred, 19 dismissed; status → done.
