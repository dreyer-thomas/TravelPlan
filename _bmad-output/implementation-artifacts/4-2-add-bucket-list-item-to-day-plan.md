# Story 4.2: Add Bucket List Item to Day Plan

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to add a bucket list item to a specific day plan,
so that the idea becomes a scheduled day item and no longer stays in the bucket list.

## Acceptance Criteria

1. Given I am viewing a trip day, when I see the bucket list panel below the map, then I can select an item and add it to the current day.
2. Given I add a bucket list item to the day, when the day item is created, then title, description, and position text carry over and any lat/long stored with the bucket item is copied.
3. Given I add a bucket list item to the day, when the day item is created, then the bucket list item is removed from the bucket list.

## Tasks / Subtasks

- [x] Task 1: Data flow + API support for converting a bucket list item into a day plan item (single action, no partial state).
- [x] Task 2: UI: day view bucket list panel (below map) with add-to-day action + prefilled day plan dialog.
- [x] Task 3: Validation and error handling to ensure day plan item requirements remain enforced (title, times, contentJson).
- [x] Task 4: Update i18n strings for new UI actions, errors, and empty states.
- [x] Task 5: Tests for API conversion flow, UI add-to-day interaction, and bucket list removal.

## Dev Notes

### Developer Context

This story builds directly on Story 4.1 bucket list functionality. Bucket list items already exist at the trip level with CRUD, geocoding, and an overview panel. The new behavior is to surface those bucket list items in the day view (below the map panel), and allow converting a selected bucket list item into a day plan item for the current day, removing it from the bucket list. Because day plan items require title, from/to times, and non-empty TipTap content, the UX must open the existing day plan dialog prefilled with bucket list data, then on save perform a server-side conversion that also deletes the bucket list item.

### Technical Requirements

- Add a conversion pathway that creates a day plan item and removes the bucket list item in one server-side action.
- Conversion must be scoped to the current user and trip (owner auth), with CSRF protection on mutation.
- Carry-over mapping:
  - `title` -> day plan item title.
  - `description` -> day plan item content JSON (TipTap doc). If empty, use a minimal doc seeded with title or a default paragraph so validation passes.
  - `positionText` -> day plan item location label (if location exists) or retained as plain text in content JSON if no location.
  - `locationLat/locationLng/locationLabel` -> day plan item `location`.
- The bucket list item must be removed only after the day plan item is successfully created (atomic behavior preferred via Prisma transaction).
- Reuse existing validation schema for day plan items; do not bypass required `fromTime`, `toTime`, and `contentJson` constraints.

### Architecture Compliance

- Follow established API envelope `{ data, error }` and error codes via `apiError`.
- Keep DB naming as `snake_case`, JSON fields as `camelCase`.
- Enforce CSRF on mutation routes and ownership checks (`trip` belongs to user).
- Keep all API handlers under `src/app/api/**/route.ts`, data access under `src/lib/repositories`, validation under `src/lib/validation`.

### Library / Framework Requirements

- Use MUI components and styling patterns consistent with TripDayView and TripBucketListPanel.
- Use React Hook Form only if consistent with existing dialog patterns; TripDayPlanDialog currently uses internal state + TipTap editor.
- Reuse existing TipTap JSON structure and helper patterns from `TripDayPlanDialog.tsx` and `TripDayPlanItemContent.tsx`.
- Reuse existing geocode normalization and location schema for location payloads.

### File Structure Requirements

- API route to extend: `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts` (add optional conversion input and delete bucket list item server-side).
- Repo additions/changes: `travelplan/src/lib/repositories/dayPlanItemRepo.ts` and `travelplan/src/lib/repositories/bucketListRepo.ts` (conversion helper with Prisma transaction).
- Validation: `travelplan/src/lib/validation/dayPlanItemSchemas.ts` (optional bucketListItemId input, if needed).
- UI: `travelplan/src/components/features/trips/TripDayView.tsx` (add bucket list panel below map) and a small day view bucket list component (new file) or reuse `TripBucketListPanel.tsx` with a new "add to day" action.
- i18n: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`.
- Tests: `travelplan/test/*` for API + UI (follow existing patterns in bucket list and day plan tests).

### Testing Requirements

- API route test: conversion succeeds, day plan item created, bucket list item removed, correct fields copied, and errors on invalid day/time.
- Repo test: conversion is atomic (no bucket list delete if day plan create fails).
- UI test: day view shows bucket list panel, add-to-day opens plan dialog with prefilled title/description/location, and successful save removes item from bucket list list.

### Previous Story Intelligence

Story 4.1 introduced bucket list CRUD, geocoding via `/api/geocode`, and the `TripBucketListPanel`. Reuse its data shape (`title`, `description`, `positionText`, `location`) and error handling. Avoid duplicating geocode logic; location should already be persisted and can be copied.

### Git Intelligence Summary

Recent commits are focused on trip overview/day view UI and bucket list. Follow existing visual structure, `TripTimeline`/`TripDayView` layout patterns, and i18n patterns. The bucket list panel already exists and should be reused where possible rather than reinvented.

### Latest Tech Information

- Material UI latest stable: v7.3.8 (remain on v7 series already in repo).
- React Hook Form latest stable: v7.63.0 (no upgrade required for this story).
- Zod latest stable: v4.3.6 (no upgrade required for this story).
- Prisma latest stable: v7.4.2 (no upgrade required for this story).
- Next.js latest stable: v16.1.1 (no upgrade required for this story).
- Leaflet latest stable: v1.9.4 (avoid 2.0 alpha).

Sources:
- https://github.com/mui/material-ui/releases
- https://github.com/react-hook-form/react-hook-form/releases
- https://github.com/colinhacks/zod/releases
- https://github.com/prisma/prisma/releases
- https://github.com/vercel/next.js/releases
- https://github.com/Leaflet/Leaflet/releases

### Project Context Reference

No `project-context.md` found in the repository.

### Project Structure Notes

- Day view UI is in `travelplan/src/components/features/trips/TripDayView.tsx` and the day plan dialog is `TripDayPlanDialog.tsx`.
- Bucket list panel is in `travelplan/src/components/features/trips/TripBucketListPanel.tsx`.
- Day plan item API is in `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts` with validation in `travelplan/src/lib/validation/dayPlanItemSchemas.ts`.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 4, Story 4.2 acceptance criteria)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (FR31)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (stack, naming, API envelope)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (overview-first UX, navigation rail patterns)
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-1-manage-trip-bucket-list-items.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripBucketListPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/dayPlanItemRepo.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Implementation Plan

- Add repo conversion helper with Prisma transaction and extend day-plan-items POST to optionally convert bucket list items.
- Extend day plan item validation to accept `bucketListItemId` and add regression tests for repo + API conversion behavior.

### Completion Notes List

- Story Status set to ready-for-dev.
- Sprint status updated to in-progress in sprint-status.yaml.
- Added transactional bucket list conversion flow in day plan item repo and API route, plus optional `bucketListItemId` validation.
- Tests: `npm test`.
- Added day view bucket list panel with add-to-day flow and prefilled plan dialog support (bucket list conversion payload).
- Added validation coverage for conversion payloads so bucket list adds still enforce title/times/content rules.
- Added i18n strings for bucket list add-to-day action and updated button label.
- Added API + UI tests for bucket list conversion flow and add-to-day interaction with removal coverage.
- Story status updated to review; sprint status set to review.
- Switched bucket list add-to-day button to an icon-only plus with accessible label. Tests: `npm test`.
- Review fixes: bucket list error copy, labeled add-to-day action, remove duplicate state reset, file list synced with git changes.
- UI tweaks: icon-only edit actions for trip/stay/travel segments, icon-only bucket add restored, add icon uses primary color.

### File List

- .codex/.codex-global-state.json
- .codex/models_cache.json
- .codex/vendor_imports/skills-curated-cache.json
- _bmad-output/implementation-artifacts/4-1-manage-trip-bucket-list-items.md
- _bmad-output/implementation-artifacts/4-2-add-bucket-list-item-to-day-plan.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/lib/repositories/bucketListRepo.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/validation/dayPlanItemSchemas.ts
- travelplan/test/dayPlanItemRepo.test.ts
- travelplan/test/dayPlanItemSchemas.test.ts
- travelplan/test/tripDayPlanItemsRoute.test.ts
- travelplan/src/components/features/trips/TripDayBucketListPanel.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts

### Story Completion Status

Status set to **done**.
Completion note: All tasks complete with passing tests; review fixes applied.
