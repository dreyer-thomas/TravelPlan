# Epic 2 Context: Core Trip Planning (Days, Stays, Plans, Budget, Export)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 2 builds the product itself: a trip with a date range that generates one day per date, a nightly accommodation and a set of timed plan items on each of those days, costs that roll up from items to day to trip, and a backup that can carry the whole thing — photos included — to another machine. This is the model every other epic reads from: maps plot the places recorded here, the bucket list feeds items into these days, sharing grants roles over these trips, and the redesign re-skins these two screens. The user-facing promise is gap visibility — at any moment the planner can see which nights have no stay and which days have no plan — so completeness signalling is a first-class concern, not decoration.

## Stories

- Story 2.1: Create Trip With Date Range and Auto-Generated Days
- Story 2.2: View Trips List and Open Trip Timeline
- Story 2.3: Edit or Delete Trip Details
- Story 2.4: See Planning Gaps in Day View
- Story 2.5: Add or Update Nightly Accommodation
- Story 2.6: Track Accommodation Status, Cost, and Link
- Story 2.7: Create and Edit Day Plan Items With Links
- Story 2.8: Budget Totals by Trip and by Day
- Story 2.9: Export Trip Backup as JSON
- Story 2.10: Restore/Import Trip Data from JSON
- Story 2.12: Day View Detail Layout With Overview Toggle
- Story 2.18: Rich Text Editor Formatting and Rendered Day Items
- Story 2.19: Day Plan Item Costs in Day and Trip Totals
- Story 2.20: Day Entry Title in Day View and Cost List
- Story 2.21: Day Plan Item From/To Time and Card Tag
- Story 2.22: Accommodation Check-in and Check-out Times
- Story 2.23: Day View Travel Segments Between Items
- Story 2.31: Complete Trip Backup Export With Photos, Travel Segments, and Bucket List
- Story 2.32: Complete Trip Backup Import With Photos, Travel Segments, and Bucket List
- Story 2.33: Restore the Export Entry Point on the Trip Overview
- Story 2.34: Read the Import Archive From Disk

Note: additional Epic 2 work was delivered without being recorded in the epics file (2.11, 2.13–2.17, 2.24–2.30 — hero and day images, photo galleries, day navigation, travel segment time tags, copy-previous-night, full-page map, day plan Gantt). Their specs exist as story files; the epics file is not a complete inventory of what shipped.

## Requirements & Constraints

- **Days are derived, never hand-managed.** Creating a trip generates a day per date in the range; editing the range adjusts the day set; deleting a trip removes everything hanging off it. Invalid names and invalid ranges are rejected with validation errors and nothing is created.
- **Gaps must be visible.** A night with no accommodation and a day with no plan items are both flagged. Gap signalling carries a text label — it may not rely on colour alone.
- **One accommodation per night**, with planned/booked status, an optional cost, and an external link. Removing it returns the night to the missing state. Check-out belongs to the previous night's stay and check-in to the current night's; defaults are 10:00 and 16:00 and no ordering validation is enforced between them.
- **Day plan items require a non-empty title and a from/to time**, with the end strictly after the start; cost and links are optional; rich text is the note body. Items that predate any of these fields must keep rendering without regression — every field added here landed on data that already existed.
- **Costs roll up in one direction.** Day subtotal and trip total both include accommodation costs plus day plan item costs; an item without a cost contributes zero and raises no error; cost-list rows are labelled with the owning item's title and follow title edits.
- **Travel segments sit between adjacent timeline items**, including the two stays. They carry a transport type and a duration; distance in kilometres applies to car and is not required otherwise; a directions link is offered when both endpoints have locations.
- **A backup must be self-contained.** The export is a single portable archive — a JSON manifest plus the uploaded photo files — covering trip, days, accommodations, day plan items, payments, travel segments and bucket list items, and it must restore on a machine that has never seen the original server's upload directory.
- **Import is all-or-nothing.** A malformed, incomplete or unreadable backup produces a validation error and writes no partial data; a name collision prompts overwrite-versus-create-new; older JSON-only backups still restore their supported fields without erroring on the absence of newer data.
- **Export is owner-only and denies by 404, not 403**, so a stranger cannot learn a trip exists. Any UI entry point renders only for a user who would pass that gate — a visible button that yields a 404 is the defect this rule exists to prevent.
- **Restore performance target:** a trip of up to 90 days and 500 items restores in under two minutes. Import size limits should be justified by policy, not by how much RAM the box happens to have.
- All trip data requires authentication, and all user-facing strings exist in both the German and English dictionaries.

## Technical Decisions

- **Stack anchors:** Next.js App Router + TypeScript, SQLite through Prisma Migrate, REST route handlers with Zod validation, JWT in an HTTP-only cookie with CSRF protection on state-changing requests, Redux Toolkit for client state, React Hook Form for forms, TipTap 3 for rich text, Material UI as the component baseline, Leaflet 1.9.4 for maps.
- **Cross-cutting conventions:** snake_case in the database, camelCase in API JSON, ISO 8601 UTC for dates, `{ data, error }` envelopes both ways, and stable error codes from a central mapper.
- **Boundaries:** route handlers are the only public API surface; data access goes through repositories rather than reaching Prisma directly; validation schemas are centralised; the Prisma schema is the single source of truth for DB structure.
- **Rich text is stored and rendered as formatted content**, not flattened to plain text for display — cards render the formatting, including embedded images, and legacy plain entries still render.
- **The archive is streamed, one member resident at a time.** The export already works this way and is the reference implementation, not a target for edits. The import must reach the same property: spool the request body to a temporary file, read the ZIP from disk, and delete that file on every exit path including failure. Buffering the whole archive makes peak memory a multiple of the file size.
- **A disk-backed reader behind a memory-backed body buffer solves half the problem.** The framework buffers request bodies for middleware, so the middleware matcher (or the body-to-disk path) has to be addressed alongside the reader.
- **ZIP reading stays defensive:** every offset bounds-checked before the read, the same error type on a malformed archive, and refusal of member names that escape the archive root. Existing reader tests are extended, not replaced.
- **Imported photos land under the new trip's own directory**, and a failed import rolls back.

## UX & Interaction Patterns

- **Overview first, detail on demand.** The trip overview stays the primary navigation surface and carries only a day-selection entry point — no per-day action buttons. The day view is where detailed planning happens.
- **The day view is a chronology plus a ledger:** a left-side timeline running previous-night stay → activities → current-night stay, with travel segments in compact regions between adjacent pairs, and a right-side panel showing the day total with itemised entries.
- **Card metadata is compact and scannable:** the time window renders as an `HH:mm - HH:mm` tag, the title reads in bold, and cost rows in the budget list borrow the item title as their label.
- **Trip-level controls share one card** at the bottom of the overview's left column — edit, delete and export in the same outlined treatment, no second card or toolbar. Destructive actions confirm.
- **Feedback is immediate.** Saves snackbar, gaps persist as inline banners, and an action that produces a file rather than a page still tells the user something is happening and surfaces failures rather than failing silently.
- Desktop-first with responsive stacking to a single column on phones; visible focus states, keyboard operability, and touch targets of at least 44×44px.

## Cross-Story Dependencies

- **2.1 is the root** — day generation is what 2.4, 2.5, 2.7 and the whole day view operate on; 2.3's range editing must keep that generated day set correct.
- **2.4's gap flags depend on 2.5 and 2.7** for the things whose absence they report.
- **2.8's totals are extended by 2.19** (item costs) and labelled by 2.20; changing what contributes to a total touches both the day panel and the trip figure.
- **2.12 establishes the day view** that 2.18–2.23 refine; each of those stories must leave the rest of the timeline intact.
- **2.32 must consume exactly what 2.31 produces** and still accept the pre-photo JSON format. **2.34 changes only where the bytes live while being read** — format, schema, UI, the createNew/overwrite strategies, photo-missing warnings and rollback all stay as they are.
- **2.33 depends on 2.31** for the archive it downloads and on the trip-controls card position set by Epic 6's overview refinement; it must deliberately rewrite the role test added by Epic 7's story that removed the old buttons, and call that rewrite out so it is not read as an accidental weakening.
- **The backup format is bound to other epics' data:** travel segments, bucket list items (Epic 4) and the travel-mode enum widened in Epic 6 all have to round-trip through export and import.
- **Epic 3's maps and Epic 7's redesign both read this model** — maps plot places recorded on days and stays; the redesign re-skins these screens, so new UI here uses its tokens rather than local literals.
