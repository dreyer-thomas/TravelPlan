# Story 2.9: Export Trip Backup as JSON

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to export my trip data as JSON,
so that I can back up or recover my plans.

## Acceptance Criteria

1. **Given** I am viewing a trip
   **When** I export the trip
   **Then** I receive a JSON file with all trip data
2. **Given** I am not signed in
   **When** I attempt to export a trip
   **Then** I am blocked from exporting

## Story Requirements

- Export must include complete trip data required for future restore/import:
  - Trip metadata
  - Ordered day records
  - Per-day accommodation data
  - Per-day day-plan items
- JSON output must be deterministic and stable (same structure/order for same data).
- Export endpoint must enforce ownership scope; no cross-user data leakage.
- Authentication behavior must follow existing route patterns (`401` for missing/invalid session).
- Existing API envelope conventions for JSON APIs must remain unchanged for current routes.
- Story 2.8 completed budget/day-view updates; export story must not regress those UI/API behaviors.

## Tasks / Subtasks

- [x] Repository export payload builder (AC: 1,2)
  - [x] Add a repository function to fetch full trip export data for a user with ordered nested relations.
  - [x] Reuse current ownership filtering pattern (`userId + tripId`) before serializing.
  - [x] Normalize date fields to ISO 8601 UTC strings in exported payload.
- [x] API route for trip export (AC: 1,2)
  - [x] Create `GET /api/trips/[id]/export` route handler under App Router.
  - [x] Return `application/json` response with attachment headers so browser downloads file.
  - [x] Use safe filename pattern (e.g., `trip-<slug>-<date>.json`) and prevent header injection.
  - [x] Return `401` for unauthorized and `404` when trip not found for authorized user.
- [x] UI trigger in trip detail (AC: 1)
  - [x] Add export action on trip detail/timeline surface using existing MUI button patterns.
  - [x] Call export endpoint and trigger download with consistent UX feedback on failure.
  - [x] Keep existing edit/delete/day navigation actions unchanged.
- [x] i18n updates (AC: 1)
  - [x] Add EN/DE labels/messages for export action and export failure state.
- [x] Tests (AC: 1,2)
  - [x] Route tests for successful export headers/content and auth/not-found cases.
  - [x] Repository test for payload completeness and ordering guarantees.
  - [x] UI test for export action visibility and request invocation.

## Dev Notes

- Current trip detail screen is driven by:
  - `travelplan/src/app/(routes)/trips/[id]/page.tsx`
  - `travelplan/src/components/features/trips/TripTimeline.tsx`
- Existing authenticated trip route patterns:
  - `travelplan/src/app/api/trips/[id]/route.ts`
- Existing data access patterns:
  - `travelplan/src/lib/repositories/tripRepo.ts`
- Existing API helpers:
  - `travelplan/src/lib/http/response.ts`
- Prisma models required for export are already present in schema:
  - `Trip`, `TripDay`, `Accommodation`, `DayPlanItem`
- Do not add schema changes for this story; export should read existing persisted data only.

### Project Structure Notes

- Expected touch points:
  - `travelplan/src/app/api/trips/[id]/export/route.ts` (new)
  - `travelplan/src/lib/repositories/tripRepo.ts`
  - `travelplan/src/components/features/trips/TripTimeline.tsx`
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - `travelplan/test/tripExportRoute.test.ts` (new)
  - `travelplan/test/tripRepo.test.ts`
  - `travelplan/test/tripTimelinePlan.test.tsx`

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.9: Export Trip Backup as JSON`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md#Data Safety`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#API & Communication Patterns`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-8-budget-totals-by-trip-and-by-day.md`
- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [MDN Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition)

## Developer Context

### Data Model

- Export payload should map directly from existing models, no schema mutation:
  - Trip: `id`, `name`, `startDate`, `endDate`, `heroImageUrl`, timestamps
  - Day: `id`, `date`, `dayIndex`, timestamps
  - Accommodation: status/cost/link/location/notes when present
  - Day plan item: content JSON, link, location, timestamps
- Keep DB naming concerns internal to Prisma; exported JSON remains camelCase field names.

### API Shape

- Export route returns downloadable JSON content, not standard `{ data, error }` envelope.
- Error responses should follow existing API error behavior used in nearby routes for consistency (`401`, `404`, `500`).
- Suggested exported document shape:
  - `meta`: `{ exportedAt, appVersion, formatVersion }`
  - `trip`: trip core fields
  - `days`: ordered day list with nested accommodation/dayPlanItems

### UI Behavior

- Export action should be available from trip detail page where user already manages the trip.
- On success: browser download starts immediately.
- On failure: show localized error alert/snackbar aligned with existing error handling style.

### Validation Rules

- Export endpoint is read-only; no CSRF requirement for `GET`.
- Authorization is mandatory via session cookie validation.
- Ensure response headers are explicit:
  - `Content-Type: application/json; charset=utf-8`
  - `Content-Disposition: attachment; filename="<safe-name>.json"`

## Technical Requirements

- Keep pinned stack from repo/package:
  - Next.js `16.1.6`
  - Prisma `7.3.0`
  - React `19.2.3`
  - MUI `7.3.8`
- No dependency upgrades in this story.

## Architecture Compliance

- API routes remain under `src/app/api/**/route.ts`.
- Repository remains the source of DB access logic.
- Preserve owner-only access boundary at repository and route level.
- Keep date handling UTC/ISO formatted in serialized output.

## Library & Framework Requirements

- Implement route as Next.js App Router route handler.
- Use native `Response`/`NextResponse` patterns compatible with Node runtime.
- Keep current MUI action button styling conventions in trip detail UI.

## File Structure Requirements

- Add export route in correct nested trip route folder only.
- Avoid creating duplicate API abstractions; reuse established helpers and repository access.
- Keep tests in existing `travelplan/test/` style and naming.

## Testing Requirements

- Route tests:
  - authorized user downloads JSON with expected headers
  - unauthorized request returns `401`
  - unknown/non-owned trip returns `404`
- Repository tests:
  - exported payload includes nested days/accommodation/day plan items
  - day ordering remains stable by `dayIndex` then date
- UI tests:
  - export action is visible on trip detail
  - clicking export issues request and handles error state

## Previous Story Intelligence

- Story 2.8 reinforced:
  - server-first data shaping in repository/route layers
  - strict ownership checks
  - i18n consistency (EN/DE keys)
  - route+UI regression test expectations
- Export story should follow the same layering and avoid client-side re-derivation of persisted structures.

## Git Intelligence Summary

- Recent commits indicate active evolution in trip day UI and day-plan flows:
  - `8e3939c Story 2.13 day view plan items`
  - `0f5668c Story 2.7 Create and edit day plan`
  - `f56a91b Story 2.5 Add accomodation`
- Export integration should be additive in trip detail controls and must not interfere with day-view/day-plan actions.

## Latest Technical Information

- Next.js route handlers are the correct implementation surface for file download endpoints in App Router.  
  Source: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- `Content-Disposition: attachment` is the standard mechanism for browser-triggered file downloads.  
  Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition
- Repository uses Next `16.1.6` and Prisma `7.3.0` (confirmed in `travelplan/package.json`); implement within this pinned stack.

## Project Context Reference

No `project-context.md` was found. Story context uses:
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-8-budget-totals-by-trip-and-by-day.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

 - `npm test -- tripRepo.test.ts`
 - `npm test -- tripExportRoute.test.ts`
 - `npm test -- tripTimelinePlan.test.tsx`
 - `npm test -- tripExportRoute.test.ts tripTimelinePlan.test.tsx tripRepo.test.ts`
 - `npm test` (full suite; 143 passing)
 - `npm run lint` (warnings only, no errors)

### Implementation Plan

- Added repository export serializer (`getTripExportForUser`) with strict `userId + tripId` ownership filter.
- Added App Router export endpoint (`GET /api/trips/[id]/export`) returning downloadable JSON with safe attachment filename and `401/404` handling.
- Added trip timeline export action to call export endpoint, trigger browser download, and show localized failure feedback.
- Added EN/DE translation keys for export action + failure message.
- Added route/repo/UI tests to cover headers, ownership/auth behavior, payload completeness, ordering, and UI invocation.

### Completion Notes List

- Story selected from sprint backlog in sequence: `2-9-export-trip-backup-as-json`.
- Epic/PRD/architecture/UX and previous story context analyzed for implementation guardrails.
- Recent commit patterns reviewed for regression risk in trip/day view areas.
- Story prepared with explicit API/repository/UI/test guidance and pinned-stack constraints.
- Implemented `getTripExportForUser` with ordered nested relations and ISO UTC string serialization for trip/day/accommodation/day-plan timestamps.
- Implemented `GET /api/trips/[id]/export` with attachment download headers and safe filename generation (`trip-<slug>-<YYYY-MM-DD>.json`).
- Added export action in timeline header; existing edit/delete/day navigation behaviors remained intact.
- Added i18n strings: `trips.export.action` and `trips.export.error` in EN/DE dictionaries.
- Added and passed story-specific tests for repository, route, and UI export behavior.
- Full regression suite passed: `44` files, `143` tests.
- Addressed code-review findings:
  - Export payload meta timestamp made deterministic (`meta.exportedAt = trip.updatedAt`) for unchanged data.
  - Browser download reliability improved by deferring `URL.revokeObjectURL` cleanup.
  - Added route test coverage for invalid session token handling (`401`) and hostile filename sanitization.

## Senior Developer Review (AI)

- Review date: 2026-02-14
- Outcome: **Approved after fixes**
- High/Medium findings fixed:
  - Deterministic export payload metadata issue resolved in export route.
  - Download object URL lifecycle race mitigated in timeline UI.
  - Missing security/auth edge-case tests added for export route.
- Verification:
  - `npm test -- tripExportRoute.test.ts tripTimelinePlan.test.tsx tripRepo.test.ts` passed (`22/22`).

### File List

- _bmad-output/implementation-artifacts/2-9-export-trip-backup-as-json.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/app/api/trips/[id]/export/route.ts
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripRepo.test.ts
- travelplan/test/tripExportRoute.test.ts
- travelplan/test/tripTimelinePlan.test.tsx

## Change Log

- 2026-02-14: Created Story 2.9 ready-for-dev context file with architecture-compliant implementation guidance.
- 2026-02-14: Implemented export backup story (repository payload, export API route, UI trigger, i18n, and tests); full suite passing.
- 2026-02-14: Completed CR fixes (deterministic export meta timestamp, safer download cleanup timing, added auth/filename sanitization tests); story moved to done.
