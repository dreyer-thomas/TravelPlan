# Story 6.8: Export Day Itinerary PDF for Offline Use

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to export one trip day as a compact PDF with the full day flow,
so that I can take the plan with me and use it without internet access.

## Acceptance Criteria

1. Given I open a trip day that I am allowed to view, when I choose the export or print action for that day, then the system generates a print-friendly PDF flow for that specific day only and the export is available to authorized trip participants without requiring edit permission.
2. Given the exported day contains a previous-night accommodation, day activities, travel segments, and a current-night accommodation, when the PDF is rendered, then it shows the day in chronological order starting from the day-start accommodation context, includes all activities in between, shows the travel information between timeline items, and includes the end accommodation when present.
3. Given day activities or accommodations have saved images, when the PDF is rendered, then relevant images are shown as compact thumbnails and items without images do not leave broken or oversized empty media blocks.
4. Given the day has enough location data for the map view, when the PDF is rendered, then it includes a map section for that day's ordered route or ordered pins and the map content matches the same day sequence used in the timeline.
5. Given routing or map rendering is unavailable, when the PDF is generated, then the export still succeeds without crashing and the PDF shows the textual itinerary details even if the map falls back to a placeholder or unavailable state.
6. Given the day contains a large amount of text, many images, or many stops, when the PDF is laid out for print, then it is optimized for A4 output, aims to fit on one page when practical and no more than two pages for normal usage, and long content is truncated or compacted in a readable way instead of overflowing unpredictably.
7. Given I save the export as a PDF file, when I open that PDF later without internet access, then the printed document remains usable offline and does not depend on live application data or map requests after the PDF has been created.
8. Given I print the PDF in grayscale or on a standard office printer, when the output is produced, then the itinerary remains readable and timing, travel, and section hierarchy are still understandable without relying only on color.

## Tasks / Subtasks

- [x] Task 1: Assemble a print-ready day itinerary payload that reuses existing trip-day data instead of inventing a parallel model. (AC: 1, 2, 3, 4, 5, 7)
  - [x] Reuse or extend the existing day data seams in `travelplan/src/lib/repositories/tripRepo.ts` so the printable payload includes previous-night accommodation context, ordered day plan items, current-night accommodation, travel segments, map points, and available image metadata.
  - [x] Keep timeline ordering consistent with the existing day view so the PDF sequence matches what the user already sees on screen.
  - [x] Preserve read-access rules for owners, contributors, and viewers; this export is a read capability, not an owner-only backup/export action.
  - [x] Keep the printable payload self-contained enough that the final PDF remains useful offline once the browser saves it.
- [x] Task 2: Add a dedicated day print/export surface using browser-native print-to-PDF instead of introducing a heavyweight PDF stack. (AC: 1, 5, 6, 7, 8)
  - [x] Add a dedicated printable route or page under the existing trip/day feature structure, for example `travelplan/src/app/trips/[id]/days/[dayId]/print/page.tsx`, rather than overloading the JSON trip backup export route.
  - [x] Trigger the export from a focused day-view action in `travelplan/src/components/features/trips/TripDayView.tsx`.
  - [x] Use the browser print flow (`window.print()`) from the printable page once the itinerary content is fully loaded, rather than adding `jspdf`, `react-pdf`, or screenshot-based export tooling by default.
  - [x] Ensure the print surface hides interactive controls and includes a clear file title/date context for the generated PDF.
- [x] Task 3: Build a compact A4 print layout that prioritizes itinerary readability over full on-screen fidelity. (AC: 2, 3, 6, 8)
  - [x] Create a print-focused component such as `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` that groups the day header, map, accommodation context, activity timeline, travel segments, and thumbnails into a compact layout.
  - [x] Add print CSS using `@media print` and `@page` rules so the output targets A4 sizing and controlled page breaks.
  - [x] Show item images only as small thumbnails and truncate long rich-text content to a print-safe summary.
  - [x] Keep the visual hierarchy readable in grayscale by relying on typography, spacing, borders, and labels rather than color alone.
- [x] Task 4: Reuse existing map and routing behavior without making map availability a hard blocker to export. (AC: 4, 5, 7)
  - [x] Reuse the current day-route/day-map point construction from `travelplan/src/components/features/trips/TripDayMapPanel.tsx` and `travelplan/src/lib/repositories/tripRepo.ts`.
  - [x] Prefer using the already-supported route or ordered-pins data from the day map stack instead of introducing a second mapping provider just for PDF export.
  - [x] Ensure the printable document can render a stable map section when map tiles/route data are available and fall back cleanly to textual itinerary details when they are not.
  - [x] Do not let routing failure, missing coordinates, or tile availability prevent the rest of the PDF from being generated.
- [x] Task 5: Cover access control, fallback behavior, and layout regressions with focused tests. (AC: 1, 5, 6, 7, 8)
  - [x] Add route or page-level tests that prove authorized readers can export and unauthorized users cannot.
  - [x] Add component tests for the printable day document covering chronological ordering, travel-segment rendering, image-thumbnail rendering, and map-unavailable fallback.
  - [x] Add a targeted day-view interaction test that verifies the export action opens the print surface for the selected day.
  - [x] Add manual verification notes for actual browser print-to-PDF output in A4 portrait, including dense-day cases that should stay within one to two pages.

## Dev Notes

### Developer Context

This story is a focused offline-reference enhancement, not a replacement for the existing trip backup export. The codebase already supports JSON backup export, day-level map rendering, travel segments, accommodation context, and image galleries, but it does not yet provide a compact print-friendly artifact for a single day.

The safest implementation path is a dedicated printable HTML page that uses the browser's native print-to-PDF flow. That fits the current stack better than adding a new PDF-generation dependency, keeps the feature close to the existing day view, and avoids binary PDF-generation complexity on the server. The resulting PDF still satisfies the offline-use requirement because the browser-generated file embeds the rendered output at save time.

The key risk is layout density. A normal day can contain multiple activities, travel segments, rich text, images, and a map. Do not try to reproduce the full interactive day view. Build a print-specific summary that stays readable, A4-safe, and deterministic under dense content.

### Technical Requirements

- Reuse the existing day ordering semantics: previous-night accommodation context, ordered day activities, travel segments between adjacent timeline items, and current-night accommodation.
- Keep the PDF flow day-scoped only for this story; do not expand scope to full-trip booklet export.
- Treat this as a read/export capability for any authorized trip participant with view access, unlike the owner-only JSON backup export route at `src/app/api/trips/[id]/export/route.ts`.
- Prefer browser-native print generation over adding new libraries; do not add `jspdf`, `react-pdf`, `html2canvas`, `puppeteer`, or similar tooling unless a blocker is proven in implementation.
- Ensure long rich-text day item content is summarized or truncated for print instead of dumping the full editor payload.
- Keep travel segment details compact but present: at minimum transport type, duration, and distance when relevant.
- Make the printable output resilient when map routing, map tiles, or images are unavailable.

### Architecture Compliance

- Existing owner-only backup export route to avoid overloading: `travelplan/src/app/api/trips/[id]/export/route.ts`
- Existing day payload and route-point seams to reuse: `travelplan/src/lib/repositories/tripRepo.ts`
- Existing day map composition to reuse: `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- Existing day-view action surface: `travelplan/src/components/features/trips/TripDayView.tsx`
- Existing travel segment behavior to preserve: `travelplan/src/lib/repositories/travelSegmentRepo.ts`

Keep the architecture split clean:

- printable data assembly in repository or dedicated server-side data helpers
- print page or route/page composition in App Router feature paths
- print-specific presentation in a dedicated trips feature component
- no PDF binary generation logic mixed into generic trip backup export

### Library / Framework Requirements

- Stay on the current repo baseline from `travelplan/package.json`: Next.js `16.1.6`, React `19.2.3`, Material UI `7.3.8`, Prisma `7.3.0`, React Hook Form `7.71.1`, and Zod `4.1.11`.
- Use Next.js App Router pages/routes and the existing `route.ts` conventions where a dedicated printable payload endpoint is needed.
- Use browser-native print support (`window.print()`) plus CSS print rules (`@media print`, `@page`) rather than new PDF packages.
- Reuse existing MUI and trip feature presentation patterns where they help, but do not try to make the printed page look identical to the interactive UI.

### File Structure Requirements

- Day-view trigger surface: `travelplan/src/components/features/trips/TripDayView.tsx`
- Recommended new print page: `travelplan/src/app/trips/[id]/days/[dayId]/print/page.tsx`
- Recommended print component: `travelplan/src/components/features/trips/TripDayPrintDocument.tsx`
- If a dedicated printable payload endpoint is needed, keep it under `travelplan/src/app/api/trips/[id]/days/[dayId]/.../route.ts`
- Existing repository seam to extend: `travelplan/src/lib/repositories/tripRepo.ts`
- Existing map/routing reuse points: `travelplan/src/components/features/trips/TripDayMapPanel.tsx`, `travelplan/src/lib/routing/dayRouteService.ts`
- Localization updates if user-facing copy is introduced: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests to extend: `travelplan/test/tripDayViewLayout.test.tsx` and new focused print/export tests under `travelplan/test/*`

### Testing Requirements

- Access test: authorized owner, contributor, and viewer can open the day print/export flow; unauthorized users cannot.
- Print-document component test: chronological accommodation -> activity -> travel -> accommodation ordering is preserved.
- Print-document component test: image thumbnails render only when images exist and do not create empty blocks otherwise.
- Print-document component test: map-unavailable fallback still renders itinerary text cleanly.
- Layout regression test: dense content uses the compact print layout classes and page-break rules expected for A4 output.
- Manual browser QA: save as PDF in A4 portrait with a sparse day and a dense day; confirm the result stays readable and typically fits within one to two pages.

### Previous Story Intelligence

- Story 3.2 established the day route map and the need for a graceful routing-unavailable fallback instead of crashing the map surface.
- Story 3.5 and the current `TripDayMapPanel` established ordered pin logic that should be reused for the printable map section.
- Story 2.16 established accommodation and day item image galleries plus thumbnail behavior that can be reused for print thumbnails.
- Story 2.23 introduced travel segments between adjacent timeline items, which are part of the user's requested printable day flow and should appear in the PDF summary.
- Story 6.5 reinforced that Google Maps or routing enrichment can fail and must not block the main day-planning workflow.

### Git Intelligence Summary

- Recent commits show Epic 6 changes staying narrowly focused on usability improvements layered onto the current trip/day architecture rather than broad refactors.
- The current codebase already has a single-day interaction center in `TripDayView.tsx`; adding the export trigger there is the lowest-friction user entry point.
- There is already a JSON backup export route, but it is owner-only and intentionally oriented around raw data portability, not a human-readable offline day handout. This story should not repurpose that route.
- No existing PDF or screenshot export dependency is present in the repo, which makes a browser-native print page the lowest-risk starting approach.

### Latest Tech Information

- MDN documents `window.print()` as a broadly available browser API and notes it opens the print dialog for the current document. That aligns with the lowest-risk PDF strategy for this repo. Source: [MDN Window.print](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- MDN documents `@page` and print CSS support for page size, margins, and print layout control. That is the right mechanism for A4 tuning and page-break control in this story. Sources: [MDN @page](https://developer.mozilla.org/en-US/docs/Web/CSS/%40page), [MDN page](https://developer.mozilla.org/en-US/docs/Web/CSS/page)
- Next.js App Router documentation updated February 27, 2026 continues to position `route.ts` files in the `app` directory as the standard custom request-handler seam. Use that if a dedicated printable payload endpoint is added. Source: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)

### Project Context Reference

No `project-context.md` file was found in this repository.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-16-accommodation-and-plan-item-image-galleries.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-2-day-route-map-with-ordered-stops.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-5-auto-fill-travel-segments-from-google-maps.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/export/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/travelSegmentRepo.ts`
- [MDN Window.print](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)
- [MDN @page](https://developer.mozilla.org/en-US/docs/Web/CSS/%40page)
- [MDN page](https://developer.mozilla.org/en-US/docs/Web/CSS/page)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Ready-for-dev context created for a print-friendly single-day PDF export that prioritizes offline readability, map fallback safety, and A4-constrained layout.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Implementation Plan

- Add a day print/export entry point in `TripDayView.tsx` that opens a dedicated printable day page.
- Build a print-only day summary component that reuses existing day ordering, image-gallery, travel-segment, and map-route data rather than recreating the itinerary model.
- Use browser-native print-to-PDF with explicit A4 print CSS and page-break control to keep the document compact and stable.
- Add focused tests for access, printable ordering, map fallback, and thumbnail rendering, plus manual print QA notes for dense-day layout.

### Debug Log References

- User requested a day-level printable PDF that includes accommodations, activities, travel legs, a map view, and thumbnails, and should stay compact enough for one or two A4 pages.
- Existing planning artifacts did not yet contain Story 6.8, so the story had to be added to Epic 6 before the implementation context could be generated.
- Current code inspection confirmed there is already an owner-only JSON trip export route, but no PDF export stack and no dedicated printable day route.
- Current code inspection also confirmed that day route points, travel segments, image galleries, and day-view composition already exist and should be reused rather than reimplemented.
- Repository search found no existing PDF-generation libraries in `travelplan/package.json`, which makes browser-native print export the lowest-risk default.
- The workflow's validator task file `_bmad/core/tasks/validate-workflow.xml` was not present in this repository, so BMAD's validator could not be executed as referenced by the workflow. Story quality was checked manually against the loaded create-story checklist instead.
- Web verification was completed for the print/layout technical seams: `window.print()` and CSS `@page` remain the current browser-native print mechanisms, and Next.js App Router route handlers remain the correct backend seam if a dedicated printable payload endpoint is added.

### Completion Notes List

- Added Story 6.8 to Epic 6 in `_bmad-output/planning-artifacts/epics.md`.
- Created the ready-for-dev context file `_bmad-output/implementation-artifacts/6-8-export-day-itinerary-pdf-for-offline-use.md`.
- Registered Story 6.8 in sprint tracking with status `ready-for-dev`.
- Scoped the feature to single-day printable export only, explicitly excluding full-trip PDF/booklet scope for this story.
- Chose browser-native print-to-PDF plus print CSS as the recommended implementation direction because the repo has no existing PDF dependency and already has the required day-level content primitives.
- Captured a key access-control distinction: this printable itinerary is a read/export convenience for trip participants, not the owner-only raw-data backup export.
- Captured non-blocking fallback requirements for missing routing, map tiles, or images so the textual itinerary still prints cleanly.
- Implemented `getTripDayPrintPayloadForUser` in `travelplan/src/lib/repositories/tripRepo.ts` to assemble ordered printable day data with previous-night accommodation context, current-night accommodation, travel segments, image metadata, and map-point data.
- Extracted shared day-map item builders into `travelplan/src/lib/trips/dayMapData.ts` so the print payload and existing day map surfaces use the same point-ordering semantics.
- Added repository coverage for owner/viewer printable payload access and timeline/map ordering.
- Created `GET /api/trips/[id]/days/[dayId]/print/route.ts` — read-only endpoint available to owner, contributor, and viewer (not owner-only); returns the assembled print payload.
- Created `TripDayPrintDocument.tsx` — compact A4 print layout with `@page` CSS rules, `@media print` class controls, grayscale-safe typography hierarchy, image thumbnails capped at 2 per item, rich-text content truncated at 300 chars, and conditional Leaflet map section.
- Created `TripDayPrintPage.tsx` — client component that fetches the payload, renders the document, and auto-triggers `window.print()` after 800 ms once data is loaded.
- Created `app/(routes)/trips/[id]/days/[dayId]/print/page.tsx` — server page wrapper following the same pattern as the existing day-map page.
- Added "Print day" / "Tag drucken" button to `TripDayView.tsx` that links to the print page (opens in a new tab), alongside prev/next navigation.
- Added i18n keys `trips.dayView.printAction`, `trips.dayView.printAria`, `trips.dayPrint.back`, `trips.dayPrint.loadError` to both `en.ts` and `de.ts`.
- Added 5 access-control tests in `tripDayPrintRoute.test.ts` (401 unauthenticated, 404 non-member, 200 owner, 200 viewer, 200 contributor).
- Added 8 component tests in `tripDayPrintDocument.test.tsx` covering chronological order, thumbnail rendering, empty-image-block prevention, map-present section, map-absent fallback, travel-segment label, full-timeline rendering.
- Added 1 day-view interaction test in `tripDayViewLayout.test.tsx` verifying the print link exists with the correct href.
- Manual browser QA notes: open the print page for a day with accommodations + activities + travel segments, verify A4 portrait PDF is generated via browser print dialog; dense days (5+ items) should fit within 1–2 pages; grayscale printing should remain readable using border/typography hierarchy.
- Full test suite: 498 tests passing (was 484; +14 new tests).

### File List

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/6-8-export-day-itinerary-pdf-for-offline-use.md`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/dayMapData.ts`
- `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/print/route.ts`
- `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/print/page.tsx`
- `travelplan/src/components/features/trips/TripDayPrintPage.tsx`
- `travelplan/src/components/features/trips/TripDayPrintDocument.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripRepo.test.ts`
- `travelplan/test/tripDayPrintRoute.test.ts`
- `travelplan/test/tripDayPrintDocument.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`

### Change Log

- 2026-05-03: Added Story 6.8 "Export Day Itinerary PDF for Offline Use", created the ready-for-dev context story, and registered the story in sprint tracking.
- 2026-05-03: Completed Task 1 by adding the reusable printable day payload seam, shared map-point builders, and repository regression coverage.
- 2026-05-03: Completed Tasks 2–5 — print API route, print page, TripDayPrintDocument, TripDayPrintPage, TripDayView trigger button, i18n (EN+DE), and full test coverage (498 tests passing).
- 2026-05-03: Code review complete — applied all 14 patches: static map snapshot replacing Leaflet, onReady callback replacing fixed timer, targeted Prisma queries replacing full-trip graph load, accessRole removed from print payload, Cache-Control header, distance/toTime/fallback-label/zero-km fixes, generateMetadata, and new test coverage for cross-trip access, first-day path, and onReady callback. 45 print-related tests passing.

### Review Findings

#### Decision-Needed (resolved)

- [x] [Review][Patch] Replace Leaflet tile map with a static map snapshot image — AC7; chosen approach (C): build a `mapStaticImageUrl` from map points in the print payload, replace `<TripDayLeafletMap>` with `<img src={mapStaticImageUrl}>` in TripDayPrintDocument, and gate `window.print()` on image load/error instead of a fixed 800 ms delay so the map is embedded in the PDF on save [TripDayPrintDocument.tsx, TripDayPrintPage.tsx, tripRepo.ts]

- [x] [Review][Dismiss] Dense days can exceed two pages — accepted as best-effort (C); manual QA note documents that very dense days (10+ items) may spill to a third page; no code change required [TripDayPrintDocument.tsx:145–284]

#### Patch

- [x] [Review][Patch] No React error boundary around Leaflet map — AC5 requires export to succeed if map rendering fails; a Leaflet runtime error will crash the entire document [TripDayPrintDocument.tsx:~119]
- [x] [Review][Patch] Travel segment distance suppressed for non-car transport types — AC2; `distanceKm` only shown when `transportType === 'car'`; flight/ship distances silently dropped even when populated [TripDayPrintDocument.tsx:150]
- [x] [Review][Patch] previousStay/currentStay cards differentiated by background color only — AC8; in grayscale both cards appear as near-identical light-gray boxes; add a non-color differentiator [TripDayPrintDocument.tsx:189–191]
- [x] [Review][Patch] getTripDayPrintPayloadForUser loads full trip graph to print one day — loads all days/items/segments via getTripWithDaysForUser then discards 99% of the result; replace with a targeted Prisma query [tripRepo.ts:~827]
- [x] [Review][Patch] accessRole included in print API response but unused by the client — unnecessary data in a read-only response; remove from TripDayPrintPayload [tripRepo.ts:~322]
- [x] [Review][Patch] No Cache-Control header on print route — browser may cache stale itinerary; add `Cache-Control: no-store` [route.ts:~40]
- [x] [Review][Patch] toTime silently dropped when fromTime is null — if a plan item has only a toTime, time tag is null and end time is never shown [TripDayPrintDocument.tsx:~163]
- [x] [Review][Patch] Blank timeline card when title and contentJson both empty — label resolves to empty string; add a positional fallback label [TripDayPrintDocument.tsx:~145]
- [x] [Review][Patch] Zero distanceKm renders '0 km' for car segments — guard with `> 0` not just `!= null` [TripDayPrintDocument.tsx:150]
- [x] [Review][Patch] Missing generateMetadata export on print page — browser tab and bookmarks show generic app title [print/page.tsx]
- [x] [Review][Patch] window.print() auto-trigger not covered by tests [test/tripDayPrintDocument.test.tsx]
- [x] [Review][Patch] Cross-trip dayId access path not tested [test/tripDayPrintRoute.test.ts]
- [x] [Review][Patch] First-day (dayIndex=0) print path not tested [test/tripRepo.test.ts]

#### Deferred

- [x] [Review][Defer] Image URLs rendered without domain allowlist validation [TripDayPrintDocument.tsx:~213] — deferred, pre-existing: app-wide pattern; enforcement requires a broader CSP/URL policy decision
- [x] [Review][Defer] parsePrintablePlanText in tripRepo.ts duplicates parsePlanText client utility [tripRepo.ts:344] — deferred, pre-existing: server/client boundary justifies the split
- [x] [Review][Defer] day.date.toISOString() throws on corrupted DB Date value [tripRepo.ts:974] — deferred, pre-existing: data integrity enforced at write time
- [x] [Review][Defer] Unauthenticated user sees print page loading state before 401 redirect [print/page.tsx] — deferred, pre-existing: consistent with other client-rendered pages in this app
