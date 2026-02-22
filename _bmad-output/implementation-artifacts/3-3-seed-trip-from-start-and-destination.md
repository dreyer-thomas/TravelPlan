# Story 3.3: Seed Trip From Start and Destination

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to start a trip plan using a start and destination,
so that the trip overview can be initialized quickly.

## Acceptance Criteria

1. **Given** I am creating a trip
   **When** I enter a start location and a destination
   **Then** the trip is created with those locations attached
2. **Given** a location cannot be resolved
   **When** I attempt to create the trip with start/destination
   **Then** I see a validation error and can correct the input

## Tasks / Subtasks

- [x] Add trip start/destination location fields (AC: 1, 2)
  - [x] Extend Prisma `Trip` with optional start/destination location columns (lat, lng, label)
  - [x] Add migration and update Prisma client
  - [x] Update trip repository create/update to persist location fields
- [x] Update create-trip validation and API payloads (AC: 1, 2)
  - [x] Extend `createTripSchema` to accept `startLocation` + `destinationLocation` objects
  - [x] Enforce: both provided or both null; reject partial or unresolved inputs
  - [x] Ensure API responses include stored start/destination data
- [x] Update trip creation UI for start/destination (AC: 1, 2)
  - [x] Add two location inputs to `TripCreateForm` (start + destination)
  - [x] Use existing `/api/geocode` for lookup and store resolved coordinates
  - [x] Block submit and surface validation errors if either location cannot be resolved
- [x] Tests (AC: 1, 2)
  - [x] Schema tests for paired location rules and invalid/partial coordinates
  - [x] API tests for create-trip validation errors and success payloads
  - [x] Repo tests for persisted start/destination fields
  - [x] UI tests for geocode failure handling and validation error display

## Dev Notes

### Story Requirements

- Reuse the existing geocoding endpoint (`/api/geocode`) for location resolution; do not call third-party geocoding from the client.
- Store start/destination as optional trip-level location fields so the trip can be created without them, but when provided they must be valid and paired.
- Keep API envelope `{ data, error }` and Zod validation patterns intact.

### Developer Context

- Trip creation currently only captures name + date range (`TripCreateForm`, `createTripSchema`, `createTripWithDays`).
- Location schema patterns already exist in `lib/validation/locationSchemas.ts` and in accommodation/day plan flows; reuse those shapes to avoid divergence.
- Geocoding already uses Nominatim via `/api/geocode` with an identifying User-Agent.

### Technical Requirements

- Add optional `startLocation` and `destinationLocation` fields on create-trip API input, each in `{ lat, lng, label }` shape.
- Validation rules:
  - Accept both null/omitted, or both objects; reject partial or only-one-present.
  - Reject lat/lng outside valid ranges; reject empty/whitespace label.
- Persist to DB with camelCase API <-> snake_case DB mapping consistent with existing patterns.

### Architecture Compliance

- API routes stay under `src/app/api/**/route.ts`.
- Validation stays in `src/lib/validation/*` (Zod).
- Data writes via `src/lib/repositories/*` only.
- Maintain `{ data, error }` response envelope.

### Library & Framework Requirements

- Continue using Leaflet 1.9.4 for map features and avoid 2.0 alpha.
- Nominatim Search API parameters: `q`, `format=jsonv2`, `limit` (as already used).
- Respect public API usage policies (User-Agent and reasonable rate limits) for Nominatim and OSRM demo services if used.

### Latest Technical Information

- Nominatim Search endpoint supports `https://nominatim.openstreetmap.org/search` with `format=jsonv2` and `limit` parameters.
- Leaflet’s current stable line is 1.9.4; 2.0.0 is still prerelease.
- OSRM demo server usage requires valid User-Agent and reasonable request rates; it is best-effort and can be withdrawn.

### File Structure Requirements

- Extend existing trip create flow, do not introduce a new create-trip component.
- Keep new Prisma fields and repository mapping localized to trip features.
- Reuse existing i18n keys where possible; add new keys only if necessary.

### Testing Requirements

- `createTripSchema` unit tests for paired location behavior and invalid inputs.
- `POST /api/trips` integration tests for validation and response payloads.
- Repository tests for `createTripWithDays` persisting location fields.
- UI test for TripCreateForm: failing geocode yields validation error; success sends resolved coordinates.

### Project Structure Notes

- Expected touch points:
  - `travelplan/prisma/schema.prisma`
  - `travelplan/src/lib/validation/tripSchemas.ts`
  - `travelplan/src/lib/repositories/tripRepo.ts`
  - `travelplan/src/app/api/trips/route.ts`
  - `travelplan/src/components/features/trips/TripCreateForm.tsx`
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - `travelplan/test/*` (schema, api, repo, ui)

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 3.3: Seed Trip From Start and Destination`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md#Trip Seeding`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-1-trip-overview-map-with-all-places.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-2-day-route-map-with-ordered-stops.md`
- `https://nominatim.org/release-docs/5.0/api/Search/`
- `https://leafletjs.com/download`
- `https://github-wiki-see.page/m/Project-OSRM/osrm-backend/wiki/Api-usage-policy`

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- none

### Completion Notes List

- Assumption: use the existing `/api/geocode` (Nominatim) for start/destination search to stay consistent with current stack.
- Open question: PRD says “Google search” for seeding; confirm whether to keep Nominatim or introduce Google Places (API key + billing + privacy impact).
- Open question: should start/destination appear in trip overview map or timeline once stored?
- Implemented trip start/destination location columns, migration, and repo persistence; updated timeline test colors.
- Implemented create-trip validation for paired locations and label requirements; API responses now include start/destination locations.
- Added start/destination lookup fields to trip creation UI, including geocode lookup and unresolved-location blocking.
- Code review fixes: cap geocode labels to 200 chars; include start/destination locations in export/import; update TripCreateResponse typing; add schema tests for invalid/partial coordinates.
- Tests: `npx vitest run test/tripCreateForm.test.tsx`.
- Tests: `npm test`.
- Tests: `npx vitest run test/tripSchemas.test.ts test/createTripRoute.test.ts`, `npx prisma generate`, `npm test`.
- Tests not run in this pass (code review fixes only).

### File List

- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/prisma/schema.prisma`
- `travelplan/prisma/migrations/20260222093000_add_trip_start_destination_locations/migration.sql`
- `travelplan/src/generated/prisma/commonInputTypes.ts`
- `travelplan/src/generated/prisma/internal/class.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `travelplan/src/generated/prisma/models/Accommodation.ts`
- `travelplan/src/generated/prisma/models/Trip.ts`
- `travelplan/src/lib/validation/tripSchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/app/api/trips/route.ts`
- `travelplan/src/app/api/geocode/route.ts`
- `travelplan/src/components/features/trips/TripCreateForm.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripSchemas.test.ts`
- `travelplan/test/tripRepo.test.ts`
- `travelplan/test/createTripRoute.test.ts`
- `travelplan/test/tripCreateForm.test.tsx`
- `travelplan/test/tripTimelinePlan.test.tsx`
