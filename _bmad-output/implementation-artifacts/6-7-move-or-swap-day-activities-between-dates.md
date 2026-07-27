# Story 6.7: Move or Swap Day Activities Between Dates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to move or swap all activities between two days without affecting accommodations,
so that I can quickly rework my itinerary when plans change or a special event changes which day should hold those activities.

## Acceptance Criteria

1. Given a source day contains activities and a different target day exists, when I choose the move action and confirm it, then all activities from the source day are moved to the target day, any activities previously on the target day are removed, and the source day no longer contains those moved activities.
2. Given the source day or target day has an accommodation entry, when I move activities between the two days, then accommodation remains attached to its original day and no accommodation data is moved, deleted, or overwritten by the move.
3. Given two different days exist, when I choose the swap action and confirm it, then the full set of activities from day A is assigned to day B, the full set of activities from day B is assigned to day A, and accommodation remains attached to its original day on both dates.
4. Given one of the selected days has no activities, when I perform a swap with another day that has activities, then the empty day receives the other day's activities, the previously populated day becomes empty of activities, and accommodation on both days remains unchanged.
5. Given I try to move or swap activities using the same day as both source and target, when I attempt to continue, then the system blocks the action with a validation message.
6. Given the target day already contains activities for a move action, when I start the move flow, then I am warned that the target day's activities will be deleted and I must confirm before the overwrite is applied.

## Tasks / Subtasks

- [x] Task 1: Add a dedicated day-activity transfer capability in the backend for move and swap operations. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Add a focused repository operation in `travelplan/src/lib/repositories/dayPlanItemRepo.ts` or an adjacent day-planning repository module that can move all day plan items from one trip day to another within the same trip.
  - [x] Add a companion repository operation for swapping all day plan items between two trip days within the same trip.
  - [x] Enforce same-trip ownership and contributor write permissions using the same writer-access rules as existing day plan item and travel segment mutations.
  - [x] Reject same-day source/target requests with a validation result instead of mutating data.
- [x] Task 2: Define and implement the persistence rules for affected related records. (AC: 1, 2, 3, 4)
  - [x] Preserve each moved day plan item's existing payload, including title, rich text, times, cost, payments, images, links, locations, and feedback target linkage.
  - [x] Leave accommodation rows untouched on both days for both move and swap operations.
  - [x] Explicitly handle day-scoped travel segments for both affected days so the timeline cannot retain invalid segment references after activities move or swap.
  - [x] Keep all mutations transactional so partial move/swap state cannot be persisted.
- [x] Task 3: Expose the move and swap actions through a narrow API contract. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Add a dedicated route under `travelplan/src/app/api/trips/[id]` for day-activity transfer actions rather than overloading the existing single-item CRUD route.
  - [x] Validate operation type, source day, target day, and confirmation-sensitive destructive cases with Zod schemas under `travelplan/src/lib/validation`.
  - [x] Return the standard `{ data, error }` API envelope and stable error codes for not found, validation failure, and unauthorized access.
- [x] Task 4: Add day-view UI controls and confirmation flows for move and swap. (AC: 1, 3, 4, 5, 6)
  - [x] Extend `travelplan/src/components/features/trips/TripDayView.tsx` with discoverable actions to move activities to another day and swap activities with another day.
  - [x] Prevent selecting the current day as both source and target in the client flow.
  - [x] Show a destructive confirmation warning before move overwrite is submitted.
  - [x] Refresh both the current day state and adjacent timeline data after a successful move or swap so the UI reflects the new item assignment without stale activities or segment rows.
- [x] Task 5: Add localization and regression coverage for the new behavior. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Add English and German copy for the new move/swap controls, confirmation text, and validation messages in `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts`.
  - [x] Add repository tests covering move, swap, empty-day swap, same-day rejection, and related-record cleanup behavior.
  - [x] Add API route tests for successful move/swap, validation errors, and access control.
  - [x] Extend `travelplan/test/tripDayViewLayout.test.tsx` or a focused day-view interaction test with move and swap flows, including destructive confirmation handling.

## Dev Notes

### Developer Context

This is an Epic 6 workflow refinement, not a new domain model. The current product already stores accommodations, day plan items, travel segments, item payments, item images, and item feedback separately. The requested feature only reassigns day plan activities between existing trip days. It must not change the trip calendar, create new days, or move accommodation ownership.

The core implementation challenge is not the visible UI action. It is preserving internal consistency when a day plan item changes `tripDayId`. In this codebase, day plan items are linked indirectly to several related concerns:

- `cost_payments` belong to the day plan item, so they should move automatically if the item row stays intact and only its `tripDayId` changes.
- `day_plan_item_images` also belong to the item, so they should remain attached if item IDs are preserved.
- day-plan-item feedback targets are keyed by `dayPlanItemId`, not by day, so preserving the existing item rows is lower risk than deleting and recreating them.
- travel segments are different: they are stored per day and reference adjacent timeline item IDs. A move or swap can invalidate those references on one or both affected days unless segment cleanup is performed deliberately.

The safest implementation direction is to treat move/swap as a transactional reassignment of existing day plan item rows between two existing `TripDay` records in the same trip, while explicitly recalculating or clearing invalid travel-segment rows for both affected days. Do not implement this as JSON copy/delete if preserving existing item identity is feasible, because that would increase risk around images, payments, and feedback continuity.

### Technical Requirements

- Support two operations only: `move` and `swap`.
- Scope both operations to two existing `TripDay` records inside the same trip.
- Preserve day plan item identity whenever possible by reassigning `tripDayId` instead of deleting and recreating activity rows.
- For `move`, delete or otherwise clear all target-day activities before reassigning source-day items.
- For `swap`, exchange the two full day-plan-item sets between the two days in one transaction.
- Do not move, overwrite, delete, or recreate accommodation rows as part of this story.
- Treat same-day source/target requests as validation failures.
- After either operation, ensure no invalid travel segment remains on either affected day.

### Architecture Compliance

- Primary persistence seam: `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- Existing day-detail payload source: `travelplan/src/lib/repositories/tripRepo.ts`
- Existing single-item CRUD route to avoid overloading: `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- Existing day-view client surface: `travelplan/src/components/features/trips/TripDayView.tsx`
- Existing travel-segment rules to preserve: `travelplan/src/lib/repositories/travelSegmentRepo.ts`

The current repository structure separates concerns cleanly:

- day plan item CRUD lives in `dayPlanItemRepo.ts`
- travel segment CRUD lives in `travelSegmentRepo.ts`
- full trip/day payload assembly lives in `tripRepo.ts`

Keep that structure. Do not hide a multi-day move/swap workflow inside `TripDayView.tsx` or spread persistence logic across route handlers.

### Library / Framework Requirements

- Stay on the current stack pinned in `travelplan/package.json`: Next.js `16.1.6`, React `19.2.3`, Material UI `7.3.8`, Prisma `7.3.0`, React Hook Form `7.71.1`, and Zod `4.1.11`.
- Reuse the existing REST route patterns, auth/session guard helpers, CSRF validation, and standard `{ data, error }` response envelope.
- Do not add state libraries, modal libraries, or drag/drop tooling for this story.

### File Structure Requirements

- Repository implementation: `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- Potential supporting repository logic for segment cleanup: `travelplan/src/lib/repositories/travelSegmentRepo.ts`
- New API route under `travelplan/src/app/api/trips/[id]/...` for day-activity transfer actions
- Validation schema additions under `travelplan/src/lib/validation/`
- Primary UI integration in `travelplan/src/components/features/trips/TripDayView.tsx`
- Supporting localization in `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts`
- Tests to extend:
  - `travelplan/test/dayPlanItemRepo.test.ts`
  - new focused route test alongside existing trip/day route tests
  - `travelplan/test/tripDayViewLayout.test.tsx`

### Testing Requirements

- Repository test: moving activities overwrites target-day activities while preserving moved item identity and leaving accommodations untouched.
- Repository test: swapping activities exchanges the two day item sets and preserves item identity on both sides.
- Repository test: same-day move/swap is rejected without mutation.
- Repository test: travel segments for both affected days are cleaned up or rebuilt according to the chosen implementation rule.
- API test: unauthorized users and non-trip participants cannot invoke move/swap.
- API test: contributors can invoke the action if current write rules allow contributor planning edits.
- UI test: move action shows overwrite confirmation when the target day already contains activities.
- UI test: successful move/swap refreshes the rendered day-plan list and does not disturb accommodation rendering.

### Previous Story Intelligence

- Story 6.6 reinforced the current Epic 6 pattern: prefer small, targeted day-view refinements over broad architecture changes. Keep this story narrowly scoped to activity transfer behavior and avoid unrelated cleanup.
- Story 6.5 showed that day-view behavior is safest when new actions reuse the existing trip/day payload refresh path instead of building special one-off client state reconciliation. After move/swap, reloading day detail from the canonical trip endpoint is lower risk than trying to patch every derived view locally.
- Story 2.23 introduced travel segments as day-scoped records between adjacent timeline items. That means moving or swapping activities is not just a day-plan-item operation; it also affects the integrity of any segment rows on the affected days.
- Story 2.24 added rendered travel-segment time tags derived from the previous timeline item's end time. If invalid segment references remain after move/swap, timeline rendering and segment time calculations can silently become wrong even if the main activity cards look correct.
- Story 2.25 established an accommodation-copy action that explicitly leaves day identity intact while copying related planning data. That precedent supports this story's rule that accommodation ownership must stay attached to the original day while only activity data changes.

### Git Intelligence Summary

- Recent Epic 6 commits have continued the pattern of shipping one narrowly scoped usability improvement at a time, followed by small bugfix commits instead of wide refactors.
- The current branch history shows Story 6.6 landing as a focused dialog refinement with follow-up fixes, which is a signal to keep Story 6.7 similarly narrow and test-driven.
- The lowest-risk path is to implement move/swap as a dedicated backend capability plus a thin day-view action surface, not as a sweeping redesign of trip-day state management.
- Existing day-view behavior already depends on a full `GET /api/trips/[id]` payload refresh after several mutations, so aligning move/swap with that pattern will fit the recent codebase direction.

### Latest Tech Information

- Local repo baseline from `travelplan/package.json`: Next.js `16.1.6`, React `19.2.3`, Material UI `7.3.8`, Prisma `7.3.0`, React Hook Form `7.71.1`, and Zod `4.1.11`.
- Current Next.js upstream has already moved beyond `16.1` to `16.2` as of March 18, 2026, but this story should stay compatible with the repo's pinned `16.1.6` version rather than adopting newer framework features opportunistically.
- Prisma `7.3.0` is current in this repo and already includes the relevant ORM/runtime fixes for this codebase. This story does not need a Prisma version change or schema migration if implemented by reassigning existing `tripDayId` values and cleaning related rows transactionally.

### Project Context Reference

No `docs/project-context.md` file exists in this repository. Use the existing planning artifacts, architecture document, implementation stories, and current codebase as the authoritative context sources for this story.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-24-travel-segment-time-tags.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-25-copy-accommodation-from-previous-night.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-5-auto-fill-travel-segments-from-google-maps.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-6-match-day-item-photo-ux-to-accommodations.md`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/travelSegmentRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/dayPlanItemRepo.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx`

## Story Completion Status

- Status set to **review**.
- Completion note: Move/swap day-activity transfers are implemented end-to-end with transactional item reassignment, affected-day travel-segment cleanup, dedicated API validation, and refreshed day-view interactions.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- User identified a new planning need: moving all activities from one day to another when a date should be repurposed for a special event.
- Requirement was expanded to include a separate swap behavior where two days exchange activities while accommodations remain on their original dates.
- The story did not exist in planning artifacts, so it was first added as Epic 6 Story 6.7 and registered in sprint tracking.
- Code analysis found that day plan items can be reassigned by `tripDayId`, but travel segments are day-scoped rows that separately reference timeline item IDs, making them the primary hidden consistency risk for this feature.
- Code analysis also found that payments, images, and feedback targets attach to the day plan item row itself, which makes preserving item identity the safest implementation direction.
- No `docs/project-context.md` file exists in this repository, so story context was assembled from epics, architecture, prior implementation stories, current code, and recent git history.
- Implemented transactional move/swap repository operations that preserve item identity, delete overwritten move targets, and clear affected travel-segment rows on both touched days.
- Added a dedicated `POST /api/trips/[id]/day-activity-transfer` route with Zod validation for operation type, same-day rejection, and move overwrite confirmation.
- Added day-view move/swap actions with a target-day picker, destructive move warning, and canonical `loadDay()` refresh after successful transfer.
- Validated the story with focused repository, schema, route, and day-view tests plus a full `npm test` run across the repo.
- Code review follow-up fixes: move overwrite confirmation is now enforced against live target-day state, the client only sends overwrite confirmation when a destructive warning was shown, and the transfer route now returns an explicit unauthorized access error for non-writers.

### Implementation Plan

- Add repository primitives in `dayPlanItemRepo.ts` for move and swap, keeping all mutations inside a single Prisma transaction and applying writer access checks before mutation.
- Clear travel segments for both affected days during transfer operations so no stale day-scoped segment references survive reassignment.
- Expose the capability via a dedicated transfer route and a narrow schema instead of overloading existing single-item plan CRUD.
- Reuse `TripDayView`'s existing `loadDay()` path after successful transfer so the current day, neighboring context, and timeline all refresh from canonical trip data.

### Completion Notes List

- Added `moveDayPlanItemsBetweenTripDays` and `swapDayPlanItemsBetweenTripDays` in `travelplan/src/lib/repositories/dayPlanItemRepo.ts` with same-day validation, contributor write enforcement, move overwrite deletion, and affected-day travel segment cleanup.
- Added `dayActivityTransferSchema` and a dedicated `travelplan/src/app/api/trips/[id]/day-activity-transfer/route.ts` endpoint that returns the standard `{ data, error }` envelope for move/swap actions.
- Extended `travelplan/src/components/features/trips/TripDayView.tsx` with move/swap controls, a target-day selection dialog, a destructive overwrite warning for moves, and canonical post-submit reload behavior.
- Added English and German translations plus regression tests for repository behavior, schema validation, route behavior, and end-to-end day-view interactions for move and swap flows.
- Tightened move overwrite confirmation so the backend rejects destructive moves unless the client explicitly confirmed an actually populated target day.
- Adjusted the transfer route contract/tests to return `unauthorized` for authenticated users without contributor write access.
- Validation results: `npm run lint` completed with existing warnings only; `npm test` passed with 86 files and 480 tests green.

### File List

- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/6-7-move-or-swap-day-activities-between-dates.md
- _bmad-output/planning-artifacts/epics.md
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/validation/dayPlanItemSchemas.ts
- travelplan/src/app/api/trips/[id]/day-activity-transfer/route.ts
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/dayPlanItemRepo.test.ts
- travelplan/test/dayPlanItemSchemas.test.ts
- travelplan/test/dayActivityTransferRoute.test.ts
- travelplan/test/tripDayViewLayout.test.tsx

## Change Log

- 2026-05-03: Implemented Story 6.7 day activity move/swap backend, API contract, day-view UI flow, localization, and regression coverage.
