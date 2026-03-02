# Story 4.4: Collapsible Bucket List Panel

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the trip bucket list panel to be collapsible (collapsed by default),
so that the trip overview stays compact when the list is long while I can still see how many items I have.

## Acceptance Criteria

1. Given I open a trip overview, when the bucket list panel first renders, then it is collapsed by default.
2. Given the bucket list panel is collapsed, then only the header is visible with:
   - the title “Bucket List”,
   - a compact add action rendered as a “+” icon button in orange,
   - and a line below the title showing the number of bucket list entries.
3. Given the bucket list panel is expanded, then the content renders exactly as it does today (list, loading/empty/error states, edit/delete actions, and full add button label), and the entry count remains visible below the title.
4. Given I toggle the bucket list panel, then the list content expands/collapses without losing current data (no re-fetch required).
5. Given the panel is collapsed, when I click the “+” add action, then the add dialog opens as normal.
6. Given there are zero items, then the count line shows 0 entries and the empty state is only shown when the panel is expanded.

## Tasks / Subtasks

- [x] Task 1: Add collapse state and toggle UI to the trip bucket list panel (AC: 1, 2, 4).
  - [x] Subtask 1.1: Default the panel to collapsed on initial render.
  - [x] Subtask 1.2: Add an expand/collapse toggle (header icon/button) and animate content with MUI `Collapse` (or equivalent).
- [x] Task 2: Update header layout for collapsed state and count line (AC: 2, 3, 6).
  - [x] Subtask 2.1: Render the entry count below the title in both states.
  - [x] Subtask 2.2: Replace the add button with an orange “+” icon button when collapsed; keep the full “Add item” button when expanded.
- [x] Task 3: Ensure add/edit/delete flows remain unchanged when expanded (AC: 3, 5).
- [x] Task 4: Add i18n strings for the count line and any new aria labels (EN/DE).
- [x] Task 5: Add UI tests for default-collapsed behavior, toggle, and add action from collapsed state.

## Dev Notes

### Developer Context

The bucket list UI is implemented in `TripBucketListPanel.tsx` and rendered on the trip overview via `TripTimeline.tsx`. The panel currently always renders its header + full list content. This story adds a collapsible wrapper and header tweaks without changing data fetching or CRUD logic.

### Technical Requirements

- Implement collapse state locally in `TripBucketListPanel` (React state). No persistence required.
- Default state: collapsed on initial render.
- Use MUI components (`Collapse`, `IconButton`, `Button`, `Typography`, `Box`) to keep styling consistent.
- Add the entry count line under the title for both collapsed and expanded states.
- Add the compact “+” add action in orange for collapsed state only. Suggested color from UX palette: warning orange (`#ED6C02`) or theme warning color; keep consistent with existing button styling.
- When expanded, preserve current layout and full add button label (“Add item”).
- Do not change API calls, validation, or data structures.

### Architecture Compliance

- Follow project structure and UI patterns in `components/features/trips/*`.
- Keep UI strings in `src/i18n/en.ts` and `src/i18n/de.ts`.
- Preserve existing API envelope `{ data, error }` and no new endpoints.

### Library / Framework Requirements

- Material UI (already in repo) for collapse/controls.
- Keep Next.js App Router patterns unchanged.

### File Structure Requirements

- Update component: `travelplan/src/components/features/trips/TripBucketListPanel.tsx`
- (Optional) Update parent layout if needed: `travelplan/src/components/features/trips/TripTimeline.tsx`
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: add/update under `travelplan/test/*` following existing patterns

### Testing Requirements

- UI test: panel is collapsed by default and list content is hidden.
- UI test: toggle expands and reveals list content.
- UI test: “+” add action opens the dialog while collapsed.
- UI test: count line renders and updates when items load.

### Previous Story Intelligence

Story 4.3 introduced the cost overview route and kept `TripTimeline` as the trip overview surface. Keep the bucket list panel change isolated to avoid regressions in the overview header and map panel.

### Git Intelligence Summary

Recent bucket list work touched `TripBucketListPanel.tsx` and `TripDayView.tsx`. Follow the same MUI spacing, typography, and i18n patterns already in place.

### Latest Tech Information

- Keep the repo’s current MUI version (v7.x) and avoid upgrades unless required by other changes.
- Keep Next.js on a patched 16.x release; do not downgrade.

### Project Context Reference

No `project-context.md` found in the repository.

### Project Structure Notes

- Trip overview page: `travelplan/src/app/(routes)/trips/[id]/page.tsx`
- Trip overview UI: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Bucket list panel: `travelplan/src/components/features/trips/TripBucketListPanel.tsx`

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 4 context)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (FR30, FR31)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (stack + UI patterns)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (progressive disclosure, overview-first)
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripBucketListPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- Implement local collapse state with header toggle and MUI `Collapse` to hide list content when collapsed.
- Add count line and compact orange "+" add icon for collapsed state; preserve full add button when expanded.
- Add i18n strings for count/toggle labels and UI tests for collapse/toggle/add dialog behavior.

### Debug Log References

### Completion Notes List

- ✅ Story context created for collapsible bucket list panel with default-collapsed behavior and count line requirements.
- ✅ Added collapse toggle, count line, and compact add icon for collapsed state; preserved expanded-state content rendering.
- ✅ Render full “Add item” button label when expanded to match AC3 and maintain accessibility.
- ✅ Added EN/DE i18n strings for count and toggle labels.
- ✅ Tests: `npm test -- tripBucketListPanel.test.tsx`
- ✅ Lint: `npm run lint` (56 warnings, 0 errors; pre-existing)

### File List

- .codex/.codex-global-state.json
- .codex/models_cache.json
- .codex/vendor_imports/skills-curated-cache.json
- _bmad-output/implementation-artifacts/4-4-collapsable-bucket-list.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/components/features/trips/TripBucketListPanel.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripBucketListPanel.test.tsx
