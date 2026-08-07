---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md
---

# TravelPlan - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for TravelPlan, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Users can create a private account to access their trips.
FR2: Users can sign in to view and manage their trips.
FR3: Users can sign out to protect their data.
FR4: Users can create a trip with name and date range.
FR5: Users can view a list of trips.
FR6: Users can open a trip to see its full timeline.
FR7: Users can edit trip name and date range.
FR8: Users can delete a trip.
FR9: Users can view the trip as a day-by-day list.
FR10: Users can see which days are missing accommodations.
FR11: Users can see which days have empty or placeholder plans.
FR12: Users can add an accommodation entry for a specific day.
FR13: Users can mark an accommodation as booked or planned.
FR14: Users can add a cost for an accommodation entry.
FR15: Users can add a link to the accommodation (e.g., Booking/Airbnb).
FR16: Users can edit or remove an accommodation entry.
FR17: Users can create a day plan for each day.
FR18: Users can add rich text notes to a day plan.
FR19: Users can add links to a day plan.
FR20: Users can edit or clear a day plan.
FR21: Users can see a total of planned costs entered so far.
FR22: Users can share a trip with a viewer.
FR23: Viewers can see the trip plan but cannot edit core details.
~~FR24: Viewers can add comments/suggestions to days or items.~~ **(Removed 2026-07-30 — comments/voting feature discontinued, see Sprint Change Proposal 2026-07-30)**
FR25: Users can export or back up trip data for recovery. **(2026-08-01: capability retained; UI entry point removed from the trip overview by Story 7.8 — reachable via API only until a new entry point is decided)**
FR34: Users can restore/import trip data from a backup. **(2026-08-01: capability retained; UI entry point removed from the trip overview by Story 7.8 — reachable via API only until a new entry point is decided)**
FR26: Maps integration for overall trip visualization and day-plan mapping.
FR27: Ability to start a trip plan using Google (start + destination).
FR28: Owners can grant a contributor role with full edit permissions.
FR29: Users can reset their password via email.
FR30: Users can add, view, and delete trip-level bucket list items for unplanned places.
FR31: Users can add a bucket list item to a day plan and remove it from the bucket list.
FR35: Trip owners can view a list of all registered users in the system, to help decide who to invite as a collaborator and avoid duplicate-account confusion.
FR38: Users can attach documents (PDF or image files) to an accommodation entry and to a day plan item.
FR39: Users can see attached documents on the entry in the day timeline, open them, and delete them from the entry's dialog.
FR40: Users can produce an offline document packet as a single PDF containing a day's attached documents.

### NonFunctional Requirements

NFR1: GDPR compliance is required (user data handling, privacy, consent).
NFR2: Secure access via username/password.
NFR3: Data backup/restore capability to recover if server changes or fails.
NFR4: SPA architecture.
NFR5: Cross-device responsive UI (desktop + mobile/tablet).
NFR6: Browser support for Chrome (desktop + mobile) and Safari (desktop + iOS).
NFR7: No SEO requirements.
NFR8: Near-real-time awareness of changes by others; refresh is acceptable.
NFR9: No formal accessibility standard required at this stage.
NFR10: Trip loads within ~15 seconds under normal use.
NFR12: Encryption is not required at this stage.
NFR13: External links must be supported in day plans and accommodations.

### Additional Requirements

- Starter template: Next.js default starter (`create-next-app`) with TypeScript and App Router; initialization should be the first implementation story.
- Database: SQLite with Prisma Migrate (Prisma CLI 7.3.0, `@prisma/client` 7.3.0, SQLite 3.51.1).
- Auth: JWT in HTTP-only cookies (SameSite=Lax, Secure in prod) with bcrypt 6.0.0; role-based access (owner/viewer).
- Security: CSRF protection enabled for state-changing requests; basic rate limiting on auth endpoints.
- API: REST with Zod validation (4.1.11); error envelope `{ error: { code, message, details } }` and success `{ data, error }`.
- Frontend: Redux Toolkit 2.11.2 for state; React Hook Form 7.71.1; TipTap 3 for rich text.
- Infrastructure: Debian 13 (trixie), Nginx for TLS, Node.js LTS v24, systemd process management; basic logging only.
- Maps library guidance: Leaflet 1.9.4 preferred over 2.0.0-alpha.
- Naming/format rules: DB snake_case; API JSON camelCase; dates ISO 8601 UTC.
- UX system: Material UI as baseline component system; custom components for trip overview, navigation rail, day plan timeline, accommodation table, gap badges, route map, budget summary, suggestion/voting widget.
- UX layout: overview-first, navigation rail on desktop and compact tab bar on mobile; persistent overview summary across modes.
- Responsive: breakpoints for mobile/tablet/desktop, desktop-first with responsive stacking; mobile optimized for quick reference and light edits.
- Accessibility: no formal standard; still keep strong contrast, visible focus, full keyboard navigation, touch targets >= 44x44px, map views paired with text summaries.

### FR Coverage Map

FR1: Epic 1 - Secure Access & Personal Workspace
FR2: Epic 1 - Secure Access & Personal Workspace
FR3: Epic 1 - Secure Access & Personal Workspace
FR4: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR5: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR6: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR7: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR8: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR9: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR10: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR11: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR12: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR13: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR14: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR15: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR16: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR17: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR18: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR19: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR20: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR21: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR22: Epic 5 - Sharing & Light Contribution
FR23: Epic 5 - Sharing & Light Contribution
~~FR24: Epic 5 - Sharing & Light Contribution~~ (Removed 2026-07-30 — comments/voting discontinued)
FR25: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR34: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR26: Epic 3 - Route & Map-Based Planning
FR27: Epic 3 - Route & Map-Based Planning
FR28: Epic 5 - Sharing & Light Contribution
FR29: Epic 1 - Secure Access & Personal Workspace
FR30: Epic 4 - Trip Bucket List (Idea Capture)
FR31: Epic 4 - Trip Bucket List (Idea Capture)
FR35: Epic 5 - Sharing & Light Contribution
FR38: Epic 9 - Travel Documents
FR39: Epic 9 - Travel Documents
FR40: Epic 9 - Travel Documents

## Epic List

### Epic 1: Secure Access & Personal Workspace
Users can create accounts and safely access their private trips.
**FRs covered:** FR1, FR2, FR3, FR29

### Epic 2: Core Trip Planning (Days, Stays, Plans, Budget, Export)
Users can create trips, manage day-by-day planning, accommodations, day plans, and see planned costs; export data for safety.
**FRs covered:** FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR25, FR34

### Epic 3: Route & Map-Based Planning
Users can visualize trips and days on maps and seed a trip from Google start + destination.
**FRs covered:** FR26, FR27

### Epic 4: Trip Bucket List (Idea Capture)
Users can collect unplanned places at the trip level and add them to day plans later.
**FRs covered:** FR30, FR31

### Epic 5: Sharing & Light Contribution
Users can share trips with viewers who can comment/suggest without changing core details.
**FRs covered:** FR22, FR23, FR28, FR35

### Epic 6: Usability Refinements
Users can iterate on focused UX improvements that simplify planning screens without changing the core product model.
**FRs covered:** FR6, FR9, FR23

### Epic 7: Visual Redesign — Light Cockpit System
Users experience the approved `DESIGN.md`/`EXPERIENCE.md` visual system across every screen instead of the current inconsistent styling — no new capability, existing screens re-skinned to the new tokens/components.
**FRs covered:** FR6, FR9, FR22 (no new FRs — implements an already-approved design spine, not new product capability)

### Epic 8: Maintenance & Infrastructure
The maintainer can keep the runtime, toolchain, and accumulated technical debt current without threading infrastructure work through feature or redesign epics.
**FRs covered:** None (infrastructure and maintenance; no new product capability)

### Epic 9: Travel Documents
Users can keep tickets and booking confirmations as the original files on the stay or activity they belong to, see and open them from the day timeline, and take them offline as one PDF.
**FRs covered:** FR38, FR39, FR40

## Epic 1: Secure Access & Personal Workspace

Users can create accounts and safely access their private trips.

### Story 1.1: Initialize Project From Starter Template

As a developer,
I want to initialize the project from the approved Next.js starter template,
So that the codebase is ready for feature implementation.

**FRs covered:** Additional requirement (starter template initialization)

**Acceptance Criteria:**

**Given** I am starting implementation
**When** I initialize the project using `create-next-app` with the agreed settings
**Then** a new project is created and runs locally
**And** the repository contains the default Next.js structure

### Story 1.2: Register With Email and Password

As a new user,
I want to create an account with email and password,
So that I can access my private trips.

**FRs covered:** FR1

**Acceptance Criteria:**

**Given** I am logged out
**When** I submit a valid email and password
**Then** my account is created and I am signed in with a session cookie
**And** I see a success state

**Given** I submit an invalid email format
**When** I attempt to register
**Then** I see a validation error and my account is not created

**Given** I submit a weak or empty password
**When** I attempt to register
**Then** I see a validation error and my account is not created

**Given** the email is already registered
**When** I attempt to register
**Then** I see an error indicating the account exists

### Story 1.3: Sign In With Email and Password

As a returning user,
I want to sign in with my email and password,
So that I can access my trips.

**FRs covered:** FR2

**Acceptance Criteria:**

**Given** I am logged out
**When** I submit valid credentials
**Then** I am signed in with a session cookie
**And** I can access authenticated pages

**Given** I submit invalid credentials
**When** I attempt to sign in
**Then** I see an error and remain logged out

### Story 1.4: Sign Out From Current Device

As a signed-in user,
I want to sign out from my current device,
So that my session is no longer active.

**FRs covered:** FR3

**Acceptance Criteria:**

**Given** I am signed in
**When** I sign out
**Then** my current session cookie is cleared
**And** I am redirected to the signed-out state

**Given** I am signed out
**When** I attempt to access authenticated pages
**Then** I am blocked and prompted to sign in

### Story 1.5: Reset Password by Email

As a user who forgot my password,
I want to reset my password via email,
So that I can regain access.

**FRs covered:** FR29

**Acceptance Criteria:**

**Given** I am logged out
**When** I request a password reset with my email
**Then** I receive a reset link or code

**Given** I have a valid reset link or code
**When** I set a new password
**Then** I can sign in with the new password

**Given** I use an invalid or expired reset link or code
**When** I attempt to reset my password
**Then** I see an error and the password is not changed

## Epic 2: Core Trip Planning (Days, Stays, Plans, Budget, Export)

Users can create trips, manage day-by-day planning, accommodations, day plans, and see planned costs; export data for safety.

### Story 2.1: Create Trip With Date Range and Auto-Generated Days

As a trip planner,
I want to create a trip with a name and date range,
So that my trip is set up with a full set of days to plan.

**FRs covered:** FR4, FR9

**Acceptance Criteria:**

**Given** I am signed in
**When** I create a trip with a name, start date, and end date
**Then** the trip is created
**And** a day entry is auto-generated for every date in the range

**Given** I submit an invalid or empty name
**When** I attempt to create the trip
**Then** I see a validation error and the trip is not created

**Given** I submit an invalid date range
**When** I attempt to create the trip
**Then** I see a validation error and the trip is not created

### Story 2.2: View Trips List and Open Trip Timeline

As a trip planner,
I want to see my trips and open a trip,
So that I can access the full day-by-day timeline.

**FRs covered:** FR5, FR6, FR9

**Acceptance Criteria:**

**Given** I am signed in
**When** I open the trips list
**Then** I see all of my trips

**Given** I select a trip
**When** I open it
**Then** I see the day-by-day list for that trip

### Story 2.3: Edit or Delete Trip Details

As a trip planner,
I want to edit or delete a trip,
So that I can keep my plans accurate and clean.

**FRs covered:** FR7, FR8

**Acceptance Criteria:**

**Given** I am viewing a trip
**When** I update the trip name or date range
**Then** the trip is updated
**And** the day entries are adjusted to match the new date range

**Given** I delete a trip
**When** I confirm deletion
**Then** the trip and all its associated data are removed

### Story 2.4: See Planning Gaps in Day View

As a trip planner,
I want to see which days are missing accommodations or plans,
So that I can quickly fill the gaps.

**FRs covered:** FR10, FR11

**Acceptance Criteria:**

**Given** I am viewing a trip
**When** any day has no accommodation for its night
**Then** that day is flagged as missing accommodation

**Given** I am viewing a trip
**When** any day has no day plan items
**Then** that day is flagged as missing a plan

### Story 2.5: Add or Update Nightly Accommodation

As a trip planner,
I want to add or update one accommodation per night,
So that each night in the trip is covered.

**FRs covered:** FR12, FR16

**Acceptance Criteria:**

**Given** I am viewing a trip day
**When** I add an accommodation for that night
**Then** the accommodation is saved and linked to that night

**Given** an accommodation exists for the night
**When** I update it
**Then** the changes are saved

**Given** an accommodation exists for the night
**When** I remove it
**Then** the night is marked as missing accommodation

### Story 2.6: Track Accommodation Status, Cost, and Link

As a trip planner,
I want to mark an accommodation as planned or booked and capture cost and link,
So that I can track status and spending.

**FRs covered:** FR13, FR14, FR15

**Acceptance Criteria:**

**Given** I am editing a night's accommodation
**When** I set status to planned or booked
**Then** the status is saved and displayed

**Given** I enter a cost value
**When** I save the accommodation
**Then** the cost is stored and included in totals

**Given** I enter an external link
**When** I save the accommodation
**Then** the link is stored and accessible from the accommodation

### Story 2.7: Create and Edit Day Plan Items With Links

As a trip planner,
I want to add multiple day plan items with rich text and links,
So that I can capture notes and references for each day.

**FRs covered:** FR17, FR18, FR19, FR20

**Acceptance Criteria:**

**Given** I am viewing a trip day
**When** I add a day plan item with rich text
**Then** the item is saved for that day

**Given** I add a link to a day plan item
**When** I save the item
**Then** the link is stored and accessible

**Given** I edit or delete a day plan item
**When** I save changes
**Then** the updates are reflected in the day plan

### Story 2.8: Budget Totals by Trip and by Day

As a trip planner,
I want to see planned costs by day and in total,
So that I can track my budget as I plan.

**FRs covered:** FR21

**Acceptance Criteria:**

**Given** accommodations have costs
**When** I view a trip
**Then** I see the total planned cost

**Given** accommodations have costs for a specific day
**When** I view that day
**Then** I see the planned cost subtotal for that day

### Story 2.9: Export Trip Backup as JSON

As a trip planner,
I want to export my trip data as JSON,
So that I can back up or recover my plans.

**FRs covered:** FR25

**Acceptance Criteria:**

**Given** I am viewing a trip
**When** I export the trip
**Then** I receive a JSON file with all trip data

**Given** I am not signed in
**When** I attempt to export a trip
**Then** I am blocked from exporting

### Story 2.10: Restore/Import Trip Data from JSON

As a trip planner,
I want to restore or import my trip data from a JSON backup,
So that I can recover plans or migrate between environments.

**FRs covered:** FR34

**Acceptance Criteria:**

**Given** I am signed in
**When** I import a valid trip JSON backup
**Then** the trip and all associated data are restored
**And** I see a success state

**Given** the import file is invalid or incomplete
**When** I attempt to import
**Then** I see a validation error and no data is overwritten

**Given** a trip with the same name already exists
**When** I import a backup
**Then** I am prompted to confirm overwrite or create a new trip

### Story 2.12: Day View Detail Layout With Overview Toggle

As a trip planner,
I want a dedicated day view for detailed planning,
so that I can keep the overview compact while focusing on one day at a time.

**FRs covered:** FR9, FR21

**Acceptance Criteria:**

**Given** I am viewing the trip overview
**When** I select a day or choose the day view action
**Then** I see a day view for that specific date
**And** the overview remains the primary navigation surface

**Given** I am in day view
**When** I review the layout
**Then** a left-side timeline lists the day in chronological order (previous night accommodation, day activities, current night accommodation)
**And** a right-side panel shows day budget total with itemized entries

**Given** I am in the trip overview
**When** I look for per-day actions
**Then** I see only a day selection entry point (no per-day action buttons)

### Story 2.18: Rich Text Editor Formatting and Rendered Day Items

As a trip planner,
I want formatting options in the day-entry editor and formatted rendering in day item cards,
So that my daily plan entries are richer and easier to read.

**FRs covered:** FR18, FR19, FR20

**Acceptance Criteria:**

**Given** I open add/edit for a day plan item
**When** the editor is shown
**Then** I can access formatting controls including italic and image insertion

**Given** I apply formatting in the editor
**When** I save the day plan item
**Then** formatting is persisted without breaking existing day plan content

**Given** a day plan item contains formatted content
**When** it is rendered in day timeline cards
**Then** the card shows formatted output (for example italic text and embedded images), not plain-text-only extraction

**Given** older day plan items exist
**When** day cards render
**Then** legacy entries still display correctly with no regression

### Story 2.19: Day Plan Item Costs in Day and Trip Totals

As a trip planner,
I want each day plan item to have an optional cost,
So that day and trip totals reflect all planned spending.

**FRs covered:** FR21

**Acceptance Criteria:**

**Given** I add or edit a day plan item
**When** I enter a cost
**Then** the item saves with that cost

**Given** day plan items have costs
**When** I view day details
**Then** those costs are included in the day total and visible in day budget entries

**Given** a trip has day plan item costs across days
**When** I view the trip planned total
**Then** the total includes accommodation costs plus day plan item costs

**Given** a day plan item has no cost
**When** totals are calculated
**Then** the item contributes zero and no error is shown

### Story 2.20: Day Entry Title in Day View and Cost List

As a trip planner,
I want every day plan entry to have a title,
So that the entry is easier to scan in day view and cost bookings use a clear label.

**FRs covered:** FR21

**Acceptance Criteria:**

**Given** I create or edit a day plan item
**When** I save the item
**Then** a non-empty title is required

**Given** a day plan item has a title
**When** I open day view
**Then** the title is shown in bold in the day plan item card

**Given** a day plan item has a cost
**When** I open the day budget list
**Then** the cost entry label uses the day plan item title

**Given** I update an existing day plan item title
**When** I save and view the day budget list
**Then** the cost label reflects the updated title

**Given** there are existing day plan items without titles
**When** I open add/edit and save
**Then** validation requires a title before save

### Story 2.21: Day Plan Item From/To Time and Card Tag

As a trip planner,
I want every day plan item to include a from time and a to time,
So that I can understand the planned time window for each activity.

**FRs covered:** FR21

**Acceptance Criteria:**

**Given** I create or edit a day plan item
**When** I save without a from time or to time
**Then** save is blocked with validation errors

**Given** I create or edit a day plan item
**When** I save with both times and to is after from
**Then** the time range is stored with the day plan item

**Given** I create or edit a day plan item
**When** to is equal to or earlier than from
**Then** save is blocked with a validation error

**Given** a day plan item has from and to times
**When** I view the day entry card
**Then** the time range is shown as a tag in the format HH:mm - HH:mm

**Given** there are existing day plan items without times
**When** I open day view
**Then** existing items still render without regression

### Story 2.22: Accommodation Check-in and Check-out Times

As a trip planner,
I want to set check-in and check-out times for accommodations in day view,
So that I can model when I am at the hotel around the day plan.

**FRs covered:** FR12, FR16

**Acceptance Criteria:**

**Given** I am viewing a trip day in day view
**When** I edit the previous-night accommodation entry
**Then** I can set a checkout time for that accommodation
**And** the time is saved with that accommodation

**Given** I am viewing a trip day in day view
**When** I edit the current-night accommodation entry
**Then** I can set a check-in time for that accommodation
**And** the time is saved with that accommodation

**Given** an accommodation is created without a time
**When** I view the accommodation time fields
**Then** checkout defaults to 10:00 for the previous-night accommodation
**And** check-in defaults to 16:00 for the current-night accommodation

**Given** check-in and check-out times are set for a day
**When** I view the day view timeline context
**Then** the time from midnight to checkout is considered hotel time for the previous night
**And** the time from check-in to midnight is considered hotel time for the current night

**Given** I edit accommodation times to any values
**When** I save
**Then** the system stores the times without enforcing ordering validation

### Story 2.23: Day View Travel Segments Between Items

As a trip planner,
I want to add travel segments between each pair of adjacent day items,
So that I can plan the time needed to move between locations.

**FRs covered:** FR25

**Acceptance Criteria:**

**Given** I am viewing a trip day in day view
**When** I look between adjacent timeline items (including previous-night accommodation, day items, and current-night accommodation)
**Then** I see a compact travel segment region between each pair

**Given** I open a travel segment between two adjacent items
**When** I save a transport type and duration
**Then** the travel segment is stored and shown in the day view

**Given** I choose transport type `car`
**When** I save the travel segment
**Then** I can enter a distance in kilometers and it is stored

**Given** I choose a transport type that is not `car`
**When** I save the travel segment
**Then** distance is not required

**Given** adjacent items have locations
**When** I open the travel segment
**Then** I can trigger a Google Maps directions link using those locations

### Story 2.31: Complete Trip Backup Export With Photos, Travel Segments, and Bucket List

As a trip planner,
I want to export a complete backup of my trip that includes travel segments, bucket list items, and the uploaded photos themselves,
So that I have a fully self-contained backup that does not depend on the original server's file storage.

**FRs covered:** FR25

**Acceptance Criteria:**

**Given** I export a trip
**When** the export is generated
**Then** it includes everything the current export includes (trip, days, accommodations, day plan items, payments) plus travel segments and bucket list items

**Given** an accommodation or day plan item has uploaded photos
**When** I export the trip
**Then** the photo files themselves are included in the exported package, not just a reference URL

**Given** an accommodation or day plan item has no photos
**When** I export the trip
**Then** the export succeeds without errors for that item

**Given** the export completes
**When** I download it
**Then** I receive a single file (e.g., an archive containing a JSON manifest plus photo files) that is portable to another system without depending on the original server's `/uploads` storage

**Given** I am not the trip owner
**When** I attempt to export the trip
**Then** I am blocked from exporting

### Story 2.32: Complete Trip Backup Import With Photos, Travel Segments, and Bucket List

As a trip planner,
I want to import a complete trip backup including travel segments, bucket list items, and photos,
So that I can fully restore a trip, including its media, on this or another system.

**FRs covered:** FR34

**Acceptance Criteria:**

**Given** I import a complete backup produced by the export in Story 2.31
**When** the import runs
**Then** the trip, days, accommodations, day plan items, payments, travel segments, and bucket list items are all restored
**And** the exported photo files are restored and linked to their accommodations/day plan items

**Given** I import a backup produced by the older export format (no photos, travel segments, or bucket list)
**When** the import runs
**Then** the previously-supported fields are restored as before
**And** the absence of the newer data does not cause an error

**Given** the backup file is invalid, incomplete, or references photo data that cannot be read
**When** I attempt to import
**Then** I see a validation error and no partial data is written

**Given** a trip with the same name already exists
**When** I import a complete backup
**Then** I am prompted to confirm overwrite or create a new trip, consistent with the existing import behavior

### Story 2.33: Restore the Export Entry Point on the Trip Overview

As a trip owner,
I want an export button back among the trip controls at the bottom of the trip overview,
So that I can download a backup without typing an API URL with an internal trip id.

**FRs covered:** FR25, FR34 (backup export — UI entry point only; no route, format or capability change)

**Context:** There is currently **no way to export from the UI at all.** Story 7.8 removed "Import JSON" and "Export JSON" from the trip-controls card, correctly: the export button was ungated, so a viewer or contributor who pressed it got a bare 404. Story 2.31 then rebuilt the export as a real ZIP archive, and its Dev Notes record "no UI entry point" as a deliberate deferral. Story 2.32 kept the *import* reachable — "Backup importieren" sits on the trips list (`TripsDashboard.tsx:329`) — so the two halves are now asymmetric: import has a button, export has a URL.

The only way to export today is `GET /api/trips/{id}/export` typed by hand, with an internal cuid in it. That is not a usable backup tool, and it leaves 2.31's work unreachable.

Import stays where it is. This story restores **only** the export control, and only where it belongs — beside "Reise bearbeiten" and "Reise löschen", the card those actions already share.

**Acceptance Criteria:**

**Given** the trip-controls card at the bottom of the trip overview, which Story 6.10 moves into the layout grid's left column
**When** an export control is added
**Then** it sits in that card alongside the existing edit and delete actions, using the same outlined button treatment, and adds no second card or toolbar
**And** it downloads the archive rather than navigating away from the trip

**Given** `GET /api/trips/{id}/export` gates on `hasTripOwnerAccess` and answers **404** — not 403 — to anyone else (`export/route.ts:43-44`), deliberately, so a stranger cannot learn that a trip exists
**When** the control renders
**Then** it renders **only** for a user who would pass that gate, so no one can reach a 404 by pressing a button the app showed them — the exact defect Story 7.8 removed the old button to fix
**And** a contributor sees no export control, because the server does not grant them one

**Given** `test/tripTimelineRoles.test.tsx` currently asserts the **absence** of both import and export controls for every role — an assertion Story 7.8 added on purpose
**When** export returns
**Then** that assertion is deliberately rewritten: export present for an owner, absent for a contributor and a viewer; import still absent for all three, since it stays on the trips list
**And** the change is called out in the story's record, so a reader does not mistake it for an accidental weakening of 7.8's guard

**Given** an export can take a moment for a photo-heavy trip and produces a file rather than a page
**When** the control is pressed
**Then** the user gets feedback that something is happening, and a failure surfaces a message rather than failing silently

**Given** every other trip-control behaviour — edit, delete, their confirmation dialogs, and the role gating around them
**When** the export control is added
**Then** none of it changes: this story adds one button and its gating, nothing else

### Story 2.34: Read the Import Archive From Disk

As the maintainer of TravelPlan,
I want the import to read a backup from disk instead of holding it in memory,
So that the size of a restorable backup is a policy decision rather than a function of how much RAM the server happens to have.

**FRs covered:** FR34 (backup restore) — the same capability, made to scale; no format, schema or UI change

**Context:** The import buffers the archive four times over. Next buffers the body for the middleware (`/api/trips/:path*` is in `middleware.ts:66`'s matcher), `request.formData()` materialises it again as a `File`, `readZipMembers(bytes)` (`importPackage.ts:89`) takes it as one `Buffer`, and each extracted member is copied out of that with `Buffer.from(raw)`. Peak resident memory runs roughly 3–4× the archive.

Measured on 2026-08-02: the production trips hold **113 MB** and **217 MB** of photos, and a STORE-only archive is essentially the sum of those bytes. At the original 100 MB ceiling neither was restorable. The ceiling was raised to 300 MB as a stopgap — with 2.9 GB available on a 3.8 GB box and no swap, a 217 MB import peaks around 700–870 MB, which fits but does not scale. At roughly 600 MB the peak would exceed the box no matter what the constant says.

**The export already does this correctly.** `createZipStream` (`zipArchive.ts:199-206`) is a `ReadableStream` whose `pull` reads one member at a time — its own comment reads *"One member resident at a time — read, hash, emit, release."* So the pattern exists in this codebase and is proven; only the reading half is missing it.

`zipReader.ts` is structurally close: its own docblock records that *"Every read is bounds-checked before it happens"*, so it already treats the archive as a random-access medium rather than a stream it must trust.

**Acceptance Criteria:**

**Given** the archive is currently resident as a `Buffer` for the whole import
**When** the import runs
**Then** the request body is written to a temporary file and the ZIP is read from that file, so peak memory is bounded by the largest single member rather than by the archive
**And** the temporary file is removed on every exit path, including a failed or rejected import

**Given** `readZipMembers` takes a `Buffer` today
**When** it reads from disk instead
**Then** its bounds checking is preserved exactly — every offset validated before the read, the same `ZipReadError` on a malformed archive, the same refusal of names that escape the archive root
**And** the existing zip-reader tests still pass, or are extended rather than replaced

**Given** Next buffers the body for the middleware before the handler sees it
**When** the archive is read from disk
**Then** that buffer is addressed too — either the route is taken out of the middleware matcher, or the body is streamed to disk without a second full copy. A disk-backed reader behind a memory-backed body buffer solves half the problem and is not enough

**Given** `MAX_IMPORT_PACKAGE_BYTES`, `proxyClientMaxBodySize` and nginx's `client_max_body_size` are currently set to a value chosen for memory rather than for policy
**When** the memory ceiling is gone
**Then** the comment in `importLimits.ts` explaining the 3–4× multiplier is corrected, and the limit's new rationale is stated — whatever value is chosen, it should be chosen for a reason other than "what fits in RAM"

**Given** the export path already streams
**When** this story lands
**Then** it is unchanged: `createZipStream` is the reference for how this should look, not a target for edits

**Given** a 217 MB backup and the production box
**When** the import is exercised end to end
**Then** it completes, the photos land under the new trip's own directory, and peak process memory stays well below what the archive would have cost — measured, not assumed

**Given** every existing import behaviour — v1 JSON backups, the createNew and overwrite strategies, the photo-missing warnings and the rollback on failure
**When** the reading mechanism changes
**Then** none of it changes: this story changes where the bytes live while they are read

### Story 2.35: The Import Accepts a Valid Backup

As someone who has just taken a backup,
I want it to restore,
So that the file I hold is a backup rather than a 229 MB reassurance.

**FRs covered:** FR31, FR32 (backup export/import)

**Given** a travel segment stored on day N that references day N-1's accommodation — the `previousStay` feature working as designed
**When** the archive is imported
**Then** it is accepted, because the importer's id map is trip-wide and already resolves it; only the guard in front rejects it today

**Given** a segment whose endpoint matches no record anywhere in the payload
**When** the archive is imported
**Then** that one segment is skipped and reported through the existing warnings channel, rather than the whole archive being refused

**Given** the production archive trip-neuseeland-2026-08-03.zip — 41 days, 151 files, 150 photos, currently refused with 36 validation errors
**When** this story lands
**Then** it imports cleanly, with a warning naming the 9 genuinely orphaned segments


## Epic 3: Route & Map-Based Planning

Users can visualize trips and days on maps and seed a trip from Google start + destination.

### Story 3.1: Trip Overview Map With All Places

As a trip planner,
I want to see all trip places on a single overview map,
So that I can visualize the full journey at a glance.

**FRs covered:** FR26

**Acceptance Criteria:**

**Given** a trip has accommodations and day plan items with locations
**When** I open the trip overview map
**Then** all places are shown as markers on the map

**Given** a place is missing location data
**When** the map renders
**Then** the place is excluded and flagged for missing location

### Story 3.2: Day Route Map With Ordered Stops

As a trip planner,
I want to see a day route that starts at the day start point and ends at the night accommodation,
So that I can visualize the full travel plan with stops in order.

**FRs covered:** FR26

**Acceptance Criteria:**

**Given** a day has a start location, intermediate places, and a night accommodation location
**When** I open the day route map
**Then** I see a single route with ordered stops and sub-destinations

**Given** a day has no intermediate places
**When** I open the day route map
**Then** I see a route from start to night accommodation only

**Given** routing is unavailable from the OSRM service
**When** I open the day route map
**Then** I see a clear error state and the map does not crash

### Story 3.3: Seed Trip From Start and Destination

As a trip planner,
I want to start a trip plan using a start and destination,
So that the trip overview can be initialized quickly.

**FRs covered:** FR27

**Acceptance Criteria:**

**Given** I am creating a trip
**When** I enter a start location and a destination
**Then** the trip is created with those locations attached

**Given** a location cannot be resolved
**When** I attempt to create the trip with start/destination
**Then** I see a validation error and can correct the input

### Story 3.4: Routing Service Setup and Fallback Strategy

As a developer,
I want a defined routing service configuration and fallback behavior,
So that route maps and travel-time calculations are reliable.

**FRs covered:** FR26

**Acceptance Criteria:**

**Given** routing is required for map views
**When** the routing service is configured (e.g., OSRM or alternative)
**Then** the app can request routes successfully

**Given** the routing service is unavailable
**When** a route is requested
**Then** a clear error state is shown and the UI does not crash

**Given** routing is not configured
**When** a user opens a map view
**Then** the UI shows a fallback state explaining routing is unavailable

### Story 3.5: Day View Map Panel With Ordered Pins

As a trip planner,
I want a day-view map that displays all places in chronological order,
so that I can understand the day route at a glance.

**FRs covered:** FR26

**Acceptance Criteria:**

**Given** a day has a previous-night accommodation, activities, and a current-night accommodation
**When** I open the day view map panel
**Then** I see pins for each place in chronological order
**And** the pins are connected in that order

**Given** a day is missing a location for any place
**When** the map renders
**Then** the missing place is excluded and flagged as missing location

### Story 3.6: Trip Overview Full-Size Map With Chronological Route

As a trip planner,
I want to open a full-size trip map from the trip overview,
so that I can inspect the full trip route in chronological order and review the linked stay or day item behind each place.

**FRs covered:** FR26

**Acceptance Criteria:**

**Given** I am viewing the trip overview map
**When** I activate the full-size map action
**Then** a full-size trip map opens for the current trip

**Given** the full-size trip map is open
**When** it renders
**Then** it shows all trip places with valid locations
**And** connects them in chronological order across the trip

**Given** I click or tap a place marker on the full-size trip map
**When** the marker popup opens
**Then** it shows the linked accommodation or day item for that place

**Given** a trip place is missing location data
**When** the full-size trip map renders
**Then** that place is excluded and the missing-location handling remains clear and non-blocking

**Given** the trip overview mini map and the full-size trip map represent the same trip
**When** I compare them
**Then** the full-size map uses interaction and visual patterns consistent with the day full-page map where applicable

## Epic 4: Trip Bucket List (Idea Capture)

Users can collect unplanned places at the trip level and add them to day plans later.

### Story 4.1: Manage Trip Bucket List Items

As a trip planner,
I want to add, view, and delete bucket list items at the trip level,
So that I can capture ideas without assigning them to a specific day yet.

**FRs covered:** FR30

**Acceptance Criteria:**

**Given** I am viewing a trip overview
**When** I open the bucket list view
**Then** I see existing bucket list items ordered alphabetically by title

**Given** I add a bucket list item with title, description, and position text
**When** I save the item
**Then** the item is added to the bucket list
**And** the app attempts to geocode the position text

**Given** the position text cannot be geocoded
**When** I save the item
**Then** the position text is retained
**And** the item is saved without lat/long

**Given** I delete a bucket list item
**When** I confirm deletion
**Then** the item is removed from the bucket list

### Story 4.2: Add Bucket List Item to Day Plan

As a trip planner,
I want to add a bucket list item to a specific day plan,
So that the idea becomes a scheduled day item and no longer stays in the bucket list.

**FRs covered:** FR31

**Acceptance Criteria:**

**Given** I am viewing a trip day
**When** I see the bucket list panel below the map
**Then** I can select an item and add it to the current day

**Given** I add a bucket list item to the day
**When** the day item is created
**Then** title, description, and position text carry over
**And** any lat/long stored with the bucket item is copied

**Given** I add a bucket list item to the day
**When** the day item is created
**Then** the bucket list item is removed from the bucket list

### Story 4.5: Payment Schedule for Costs

As a trip planner,
I want to split a cost into a downpayment and one or more planned payments with amounts and dates,
So that the total cost reflects how I pay over time.

**FRs covered:** FR14, FR21

**Acceptance Criteria:**

**Given** I am creating a cost for an accommodation or a day plan item
**When** I choose to pay all now
**Then** a single payment is recorded for the full amount with a date

**Given** I am creating a cost for an accommodation or a day plan item
**When** I choose to split into multiple payments
**Then** I can add two or more payments with an amount and a date for each

**Given** I have entered multiple payments
**When** the sum of payment amounts does not equal the total cost
**Then** I see a validation error and cannot save

**Given** I am editing an existing cost
**When** I add or adjust payments
**Then** the total of all payments must still equal the cost amount

### Story 4.6: Show Open Costs by Month

As a trip planner,
I want to switch the trip cost overview between the existing day list and a monthly payment list,
So that I can quickly see which open costs I need to pay in each month.

**FRs covered:** FR21

**Acceptance Criteria:**

**Given** I am on the trip cost overview page
**When** the page loads
**Then** I can switch between a `Days` view and a `Months` view
**And** the existing day-based behavior remains available unchanged

**Given** I switch to the `Months` view
**When** open scheduled payments exist
**Then** they are grouped by month using each payment due date
**And** months are ordered chronologically

**Given** I switch to the `Months` view
**When** open regular accommodation or day-plan-item costs exist without a split schedule
**Then** they also appear in the month list
**And** the entered date is used when it is known

**Given** a month contains multiple open cost items
**When** the month section is shown
**Then** I see each payment or cost entry with a clear label, date, and amount
**And** I see the total amount due for that month

**Given** an item is already represented by scheduled payments
**When** the `Months` view is rendered
**Then** the base cost is not shown a second time

**Given** there are no relevant open cost items
**When** I open the `Months` view
**Then** I see a clear empty state

**Given** I switch between `Days` and `Months`
**When** the view changes
**Then** no payment or cost data is modified
**And** trip planned totals remain unchanged

### Story 4.7: Comments in Dialog

> **REMOVED 2026-07-30** — comments/voting feature discontinued per product decision (see Sprint Change Proposal 2026-07-30). Story text retained below for historical record only.

As a trip participant,
I want comments and pro/con feedback shown as a compact summary that opens a dialog,
So that the main planning UI stays focused while discussion remains easy to access.

**FRs covered:** FR24 (UX refinement of the existing comments and votes feature)

**Acceptance Criteria:**

**Given** I open a day, accommodation, or day-plan-item card that supports feedback
**When** the UI renders
**Then** the full comments panel is no longer shown inline by default
**And** I instead see a compact comments trigger in the lower area of the card

**Given** a feedback summary is shown
**When** I look at the trigger
**Then** I see a comments symbol and a short label such as `no comments`, `1 comment`, or `5 comments`

**Given** a feedback summary is shown
**When** votes exist
**Then** I also see thumbs up and thumbs down indicators with their counts

**Given** I activate the comments trigger
**When** the dialog opens
**Then** I can read existing comments and use the current comments/votes interactions there

**Given** I add a comment or vote in the dialog
**When** the action succeeds
**Then** the dialog content and compact summary update to the latest saved values

**Given** I close the dialog
**When** I return to the trip screen
**Then** I remain in the same context without losing my place

## Epic 5: Sharing & Light Contribution

Users can share trips with viewers who can comment/suggest without changing core details.

### Story 5.1: Invite Viewer or Contributor by Email With Temp Password

As a trip owner,
I want to add a viewer or contributor by email with a temporary password,
So that I can grant access without sending email invitations yet.

**FRs covered:** FR22, FR28

**Acceptance Criteria:**

**Given** I am the trip owner
**When** I add a person with email and role (viewer or contributor) and set a temp password
**Then** the account is created and linked to the trip with the chosen role

**Given** the email is invalid or already in use
**When** I attempt to add the person
**Then** I see an error and the person is not added

### Story 5.2: Enforce First-Login Password Change

As a newly invited user,
I want to change my temporary password on first login,
So that my account is secure.

**FRs covered:** FR22

**Acceptance Criteria:**

**Given** I log in with a temporary password
**When** I access the app
**Then** I am required to set a new password before continuing

**Given** I set a new valid password
**When** I save it
**Then** I can proceed into the app

### Story 5.3: Viewer Read-Only Access

> **REVISED 2026-07-30** — split from the original "Viewer Access With Comments and Votes" story; the comments/votes half is discontinued per product decision (see Sprint Change Proposal 2026-07-30). This story now covers view-only access only.

As a viewer,
I want to view the trip without being able to edit it,
So that I can stay informed without risking changes to the plan.

**FRs covered:** FR23 (view access portion only)

**Acceptance Criteria:**

**Given** I have a viewer role
**When** I open a trip
**Then** I can see all trip details

**Given** I have a viewer role
**When** I attempt to edit trip data
**Then** I am blocked from editing

### Story 5.4: Contributor Full Edit Permissions

As a contributor,
I want to edit trip data like the owner,
So that I can help maintain the plan directly.

**FRs covered:** FR28

**Acceptance Criteria:**

**Given** I have a contributor role
**When** I edit trip details, accommodations, or day plans
**Then** my changes are saved and visible

### Story 5.5: Edit Own Comments

> **REMOVED 2026-07-30** — comments/voting feature discontinued per product decision (see Sprint Change Proposal 2026-07-30). Story text retained below for historical record only.

As a contributor or viewer,
I want to edit my own comments,
So that I can correct or refine my feedback.

**FRs covered:** FR24

**Acceptance Criteria:**

**Given** I created a comment
**When** I edit it
**Then** the updated comment is saved and visible

**Given** I try to edit someone else’s comment
**When** I attempt to save changes
**Then** I am blocked

### Story 5.6: Add Existing Contributor to Another Trip

As a trip owner,
I want to add an existing contributor account to another trip,
So that the same person can collaborate across multiple trips without duplicate-account errors.

**FRs covered:** FR22, FR28

**Acceptance Criteria:**

**Given** the entered email already belongs to an existing account that is not yet linked to the current trip
**When** I add that person as a contributor
**Then** the existing account is linked to the current trip with a new membership

**Given** the entered email already belongs to an existing account that is already linked to the current trip
**When** I attempt to add that person again
**Then** I see a trip-specific duplicate message and no duplicate membership is created

**Given** the entered email does not belong to an existing account
**When** I add that person through the current share flow
**Then** the existing temporary-password provisioning behavior still works

### Story 5.7: Limit Voting to Day Items

> **REMOVED 2026-07-30** — comments/voting feature discontinued per product decision (see Sprint Change Proposal 2026-07-30). Story text retained below for historical record only.

As a trip participant,
I want days and accommodations to stay commentable without voting,
So that lightweight discussion remains available while voting is reserved for concrete day-item suggestions.

**FRs covered:** FR24

**Acceptance Criteria:**

**Given** I view a day entry in the trip overview
**When** the feedback trigger is rendered
**Then** I still see comment access for that day
**And** I do not see vote counts or vote actions for the day itself

**Given** I open the day view for a specific day
**When** the day-level feedback trigger is rendered
**Then** I can still read and add comments for the day
**And** I do not see vote counts or vote actions for the day itself

**Given** I view an accommodation that supports feedback
**When** its feedback trigger is rendered
**Then** I can still read and add comments for that accommodation
**And** I do not see vote counts or vote actions for that accommodation

**Given** I view a day plan item that supports feedback
**When** its feedback trigger is rendered
**Then** the existing comments and voting behavior remains available

**Given** a client attempts to submit a vote for a day or accommodation target
**When** the request reaches the feedback API
**Then** the request is rejected as unsupported
**And** no vote state is created or changed for that target

### Story 5.8: View All Registered System Users

As a trip owner,
I want to see a list of all users registered in the system,
So that I can decide who to invite as a collaborator and avoid confusion about whether someone already has an account.

**FRs covered:** FR35

**Acceptance Criteria:**

**Given** I own at least one trip
**When** I open the registered users overview
**Then** I see a list of all user accounts registered in the system, identified by email

**Given** I am signed in but do not own any trip
**When** I attempt to access the registered users overview
**Then** I am blocked from viewing it

**Given** I am a viewer or contributor on one or more trips but not an owner of any trip
**When** I attempt to access the registered users overview
**Then** I am blocked from viewing it

**Given** the registered users overview is open
**When** I view the list
**Then** it is not scoped to a single trip, but reflects every account in the system

**Given** new users register after I first opened the overview
**When** I reload or reopen the overview
**Then** the list reflects the current set of registered accounts

### Story 5.9: Remove Comments & Voting Feature

As a developer,
I want to remove the comments/votes data model, API routes, and UI components,
So that the discontinued feature is fully removed rather than left dormant in the codebase.

**FRs covered:** N/A (removal of discontinued FR24, comments/suggestions)

**Acceptance Criteria:**

**Given** the comments/votes feature is discontinued
**When** the removal is implemented
**Then** the TripFeedbackTarget, TripFeedbackComment, and TripFeedbackVote Prisma models (or equivalently named feedback/comment/vote models — verify actual model names in travelplan/prisma/schema.prisma) are removed via a migration

**Given** the data model is removed
**When** the removal is implemented
**Then** all API routes serving comments/votes are removed

**Given** the data model and API are removed
**When** the removal is implemented
**Then** all UI components for comments/votes (comment dialogs, vote widgets, feedback trigger buttons/badges) are removed from every screen that previously showed them

**Given** the feature is fully removed
**When** the removal is implemented
**Then** now-orphaned i18n strings related to comments/votes are cleaned up from the translation files

### Story 5.10: User Administration for Admins

As the administrator of this installation,
I want one place to see every account, what each can reach, and to create, re-assign and remove accounts,
So that people who no longer travel with us stop having access.

**FRs covered:** FR35 (registered users), extending Story 5.8

**Given** the hamburger menu
**When** an admin opens it
**Then** it carries an entry to the user administration, and for nobody else — `UserRole` gains `ADMIN`, because every self-registration is an `OWNER` and that population cannot gate this

**Given** an account in the list
**When** the admin looks at it
**Then** they see the trips it owns and the trips it is a member of, with the membership role, and can change the role, attach, detach, and grant or revoke `ADMIN`

**Given** an account that owns trips
**When** the admin tries to delete it
**Then** the deletion is refused and the owning trips are named — `Trip.user` cascades, so an unguarded delete would take an entire travel history with it

**Given** a system with no accounts at all
**When** the first person registers
**Then** that account becomes `ADMIN`, in the same transaction as the insert; an existing installation is bootstrapped with `npm run admin:grant -- <email>`

### Story 5.11: The Administration Row, Rearranged

As the administrator of this installation,
I want each account's actions collected in one overflow menu and its shares shown as a table,
So that a row stops being a paragraph with five text buttons trailing it.

**FRs covered:** none new — Story 5.10's surface, relaid out

**Given** an account row carrying three text buttons (add to trip, grant/revoke admin, delete account)
**When** the row is laid out
**Then** the three sit in one vertical-dots overflow menu at the right of the line the address is on, and the menu is named per account — a list renders one trigger per row, and three controls called "Weitere Aktionen" cannot be told apart

**Given** the memberships, previously one "Freigegeben für X · Rolle" line each with two text buttons after it
**When** they are laid out
**Then** they are a table under a "Freigaben" heading with three columns — trip name, role as a select that changes it, and a trash button — and an account with no memberships says so instead of rendering an empty table

**Given** the shares table
**When** the admin wants to add one
**Then** a `+` button sits above its right edge; the same action stays in the overflow menu, because one belongs to the table and the other to the account

**Given** the role control is a select rather than a toggle
**When** the role already showing is picked again
**Then** nothing is sent — the endpoint is an upsert, so re-sending the current role would spend a write and a full list reload to arrive where it started

**Given** removing a share was a direct action, argued for on the grounds that it is reversible in two clicks
**When** it becomes a trash glyph in a table row beside three other trash glyphs
**Then** it is confirmed first, with the safe half naming what it preserves — the word that said what the click costs is gone, and "reversible" assumed the admin noticed

**Given** ownership and membership must never read as one thing (Story 5.10 AC3)
**When** the shares become a table
**Then** the owned trips stay outside it, under their own label — the table holds memberships and nothing else


### Story 5.12: Shared Trips on the Collaborator's Dashboard

As someone who has been invited to another person's trip,
I want that trip to appear in my trip list after I sign in,
So that I can reach it at all without being sent a link every time.

**FRs covered:** FR29, FR30, FR32

**Depends on:** nothing. Stories 5.1, 5.4 and 5.6 already create the memberships this story reads.

**Context:** This is a **live defect on production**, observed 2026-08-06: an invited collaborator signed in, saw an empty dashboard, and concluded the invitation had failed. It had not. `listTripsForUser` (`tripRepo.ts:652`) filters `where: { userId }` — owner only — while every other read in the codebase authorises with `OR: [{ userId }, { members: { some: { userId } } }]` (`getTripWithDaysForUser`, the accommodation, plan-item, travel-segment, cost and route repositories). The collaborator therefore has full read access to the trip and no way to reach it: the dashboard is the only surface offered after sign-in, and it is the one surface that ignores memberships. The trip opens correctly by direct URL.

The gap is not new. Story 7.4 recorded it while redesigning this list — *"a real product gap, it is not in this story's ACs […] note it for the backlog"* — and Story 7.5 declined it again as out of scope. Neither note reached `deferred-work.md` or the sprint plan, which is why it survived to be found by a real user.

Widening the `where` clause is the smaller half. `TripSummary` carries no `accessRole`, so a widened list would render a shared trip in a card identical to an owned one, offering actions the member may not perform — and a VIEWER must not be shown edit affordances. The payload has to say which trips are the user's own before the list can show both.

**Acceptance Criteria:**

**Given** an account holding a VIEWER or CONTRIBUTOR membership on somebody else's trip
**When** it signs in and opens the trip list
**Then** that trip appears in the list alongside any trips the account owns, reachable without a direct link

**Given** the trip list payload
**When** it is returned
**Then** each entry states whether the account owns the trip or holds a membership on it, and with which role — the list cannot present the two as the same thing

**Given** a shared trip on the list
**When** it is rendered
**Then** it is visibly distinguishable from an owned trip, and a VIEWER is offered no action their role forbids; deletion in particular is never offered on a trip the account does not own

**Given** an account with no trips of its own and no memberships
**When** it opens the trip list
**Then** the existing empty state is unchanged — the widened query must not turn "nothing to show" into an error

**Given** the widened query
**When** it runs
**Then** it returns each trip exactly once for an account that both owns and is a member of trips, and a route test proves an account sees no trip it neither owns nor holds a membership on

### Story 5.13: What a Contributor May Do, Made Consistent

As someone invited to help plan a trip,
I want to add photos, documents and ideas to the things I am already allowed to create and delete,
So that "contributor" means what it says instead of stopping at the parts that carry a file.

**FRs covered:** FR32

**Depends on:** nothing. Stories 5.1, 5.4 and 5.6 already create the memberships this story reads.

**Context:** Reported from production use on 2026-08-06: a contributor could not add photos to activities while the owner could. Nothing was broken — media writes have been owner-only since Story 2.16, which predates the contributor role entirely, and Story 9.1 copied the same gate onto the new document routes rather than diverging mid-dialog. The result is a split with no principle behind it: a contributor may rename the trip and delete an entire activity, but may not attach a picture to it, set a day image, or add a bucket-list idea.

Recorded as **DW-182** and confirmed as intentional-for-now on 2026-08-05, one day before real use overturned it. The rule this story applies is *content yes, the trip as a possession no*: the four media routes, the day image, the bucket list and the backup export move to owner-or-contributor; member management, trip deletion and the trip hero image stay with the owner; a viewer gains nothing.

Each widened route is guarded twice — the route's access helper **and** the repository's `trip: { userId }` scope. Opening only one produces a request that passes the gate and is then refused by the query, with the identical 404 as before, which is how a half-done version of this ships green.

**Acceptance Criteria:**

**Given** an account holding a CONTRIBUTOR membership
**When** it adds or removes a photo or a document on an activity or a stay
**Then** the write succeeds, on all four media routes, at both the route gate and the repository scope

**Given** the same account
**When** it sets a day image, adds a bucket-list idea, or exports a backup
**Then** each succeeds — the export because a contributor can already read every byte the archive contains

**Given** the same account
**When** it attempts to manage members, change the trip hero image, or delete the trip
**Then** each is refused, asserted as a negative, because these are the properties this change could plausibly break

**Given** an account holding a VIEWER membership
**When** it attempts any of the writes above
**Then** every one is refused, and everything it could read before it can still read

**Given** a request refused for the caller's role on a trip they already participate in
**When** the refusal is returned
**Then** it says so with `403 forbidden` rather than reporting the object as non-existent — a 404 to someone looking at the object on screen is what made this defect read as a broken app; refusals to non-participants keep answering 404


## Epic 6: Usability Refinements

Users can iterate on focused UX improvements that simplify planning screens without changing the core product model.

### Story 6.1: Remove Trip Overview Header Feedback

> **REMOVED/SUPERSEDED 2026-07-30** — the entire feedback system (not just the header instance this story addressed) is now discontinued per product decision (see Sprint Change Proposal 2026-07-30). Story text retained below for historical record only.

As a trip participant,
I want the trip overview header to focus on core trip context instead of comments or voting,
So that the overview feels cleaner and the least useful feedback surface is removed.

**FRs covered:** FR6, FR9, FR23, FR24

**Acceptance Criteria:**

**Given** I open a trip overview
**When** the trip header renders
**Then** I do not see a comments trigger, comment count, vote count, or vote action in the header area

**Given** trip-level feedback data exists for the trip
**When** the overview header renders after this change
**Then** the header still does not show feedback UI
**And** the story does not require deleting existing feedback rows as part of the change

**Given** I view day entries, accommodations, or day-plan items that still support feedback
**When** those surfaces render
**Then** their existing feedback behavior remains unchanged unless explicitly updated by a later story

**Given** the trip overview header shows core summary content such as title, date range, hero image, map, or sharing actions
**When** the feedback section is removed
**Then** the remaining layout stays usable on desktop and mobile without empty gaps or broken alignment

### Story 6.2: Feedback as Chat

> **REMOVED 2026-07-30** — comments/voting feature discontinued per product decision (see Sprint Change Proposal 2026-07-30). Story text retained below for historical record only.

As a trip participant,
I want comment dialogs to behave like a chat surface with comment deletion for my own messages,
So that conversation feels natural and I can fully manage feedback I authored.

**FRs covered:** FR23, FR24

**Acceptance Criteria:**

**Given** I open a comments dialog for a supported feedback target
**When** the dialog renders
**Then** the existing comments appear above the composer area
**And** the composer for a new comment is anchored at the bottom of the dialog

**Given** a target has multiple comments
**When** the comments are rendered in the dialog
**Then** they are shown in chronological order with the oldest at the top and the newest at the bottom
**And** the newest saved comment appears closest to the composer area

**Given** I add a new comment
**When** the save succeeds
**Then** the new comment appears at the bottom of the comment list without requiring a page refresh

**Given** I view the comments dialog on desktop or mobile
**When** the chat layout is shown
**Then** the dialog visually reads like a messaging surface with a distinct message history area and a bottom composer
**And** the layout remains usable and accessible on smaller screens

**Given** I authored a comment on a supported feedback target
**When** I view that comment in the dialog
**Then** I can discover a delete action for my own comment in addition to the existing edit action

**Given** I delete my own comment
**When** the delete succeeds
**Then** the comment is removed completely from the UI and persisted storage
**And** the updated comment count is reflected anywhere that feedback target is summarized

**Given** I did not author a comment
**When** I view that comment
**Then** I cannot delete it
**And** attempts to delete another participant's comment are rejected without mutating stored data

### Story 6.3: Optimize Comments

> **REMOVED 2026-07-30** — comments/voting feature discontinued per product decision (see Sprint Change Proposal 2026-07-30). Story text retained below for historical record only.

As a trip participant,
I want comment indicators and comment actions to use a more compact visual format,
So that day and trip planning surfaces stay easier to scan and each comment bubble uses less space.

**FRs covered:** FR23, FR24

**Acceptance Criteria:**

**Given** a comment indicator is rendered for a day item, a day overview surface, or a day in the trip overview
**When** the indicator shows the number of comments
**Then** it displays only the numeric count
**And** it does not append text such as `Kommentar`, `Kommentare`, `comment`, or `comments`

**Given** the compact comment indicator is rendered in any supported surface
**When** the count is `0`, `1`, or greater than `1`
**Then** the visible trigger still stays compact
**And** the accessible name continues to communicate the comment purpose and count

**Given** I view a comment that I authored inside the comments dialog
**When** the available comment actions are rendered
**Then** the edit action is shown as a pen icon instead of the text `Kommentar bearbeiten`
**And** the delete action is shown as a trash icon instead of the text `Kommentar löschen`

**Given** the edit and delete icons are shown for my own comment
**When** the comment bubble is rendered
**Then** both icons are placed to the right of the comment text content
**And** the message bubble uses less horizontal space than the current text-button layout

**Given** I do not own a comment
**When** I view that comment in the dialog
**Then** I do not see the edit or delete icons for that comment
**And** the existing ownership restrictions remain unchanged

**Given** I use the compact comment trigger or the icon-only comment actions on desktop or mobile
**When** I interact with them
**Then** the controls remain clearly clickable and keyboard accessible
**And** screen readers still receive meaningful labels for opening comments, editing, and deleting

### Story 6.4: Fix Day View Accommodation Cost Duplication

As a trip planner,
I want the day-view cost area to count an overnight stay only on the day that owns that stay,
So that the daily total is accurate and the same accommodation cost is not shown again on the following day as previous-night context.

**FRs covered:** FR10, FR22, FR24

**Acceptance Criteria:**

**Given** a day view shows a previous-night accommodation that was already counted on the prior day
**When** the day-view cost area renders for the current day
**Then** that previous-night accommodation cost is not included in the current day's cost list
**And** it is not included in the current day's displayed total

**Given** a day has a current-night accommodation with a saved cost
**When** the day-view cost area renders
**Then** that current-night accommodation cost is included in the current day's cost list and total

**Given** a day has day-plan items with costs
**When** the day-view cost area renders
**Then** those item costs continue to appear unchanged
**And** they continue to be included in the current day's displayed total

**Given** a previous-night accommodation is shown in day view for timeline or context purposes
**When** the day-view page renders
**Then** the accommodation card and hotel-time context remain visible
**And** only the duplicated cost attribution is removed from the current day's cost area

**Given** a day has no current-night accommodation cost and no day-plan item costs
**When** the day-view cost area renders
**Then** it continues to show the existing zero-cost or empty-cost behavior without errors

### Story 6.5: Auto-Fill Travel Segments From Google Maps

As a trip planner,
I want the travel-segment flow between adjacent timeline items to reuse Google Maps directions automatically when possible,
So that I do not need to manually copy duration and distance into the travel dialog for each route.

**FRs covered:** FR10, FR18, FR22

**Acceptance Criteria:**

**Given** two adjacent timeline items in day view both have usable locations
**When** I choose the Google Maps route action from the travel segment between them
**Then** the system uses the previous item as origin and the next item as destination
**And** the travel-segment dialog opens with the route result already filled in when automatic import is supported

**Given** an automatic route result is successfully retrieved for a car trip
**When** the dialog opens or refreshes from the Google Maps action
**Then** the duration field is prefilled from that result
**And** the distance field is prefilled from that result
**And** the Google Maps link for that exact route remains available in the dialog

**Given** the route cannot be imported automatically because required data is missing or the implementation path is not feasible
**When** I trigger the Google Maps route action
**Then** I still get the Google Maps directions button or link that existed previously
**And** I can continue the manual workflow of checking Google Maps and entering the values myself

**Given** one or both adjacent items do not have enough location data for directions
**When** I open the travel segment
**Then** the automatic Google Maps action is disabled or unavailable
**And** the dialog does not show incorrect prefilled travel values

**Given** I am editing an existing travel segment that already has saved values
**When** I trigger the Google Maps route action again
**Then** I can refresh the dialog values from the current adjacent locations without breaking the existing ability to manually edit and save the segment

**Given** I use the travel-segment dialog on desktop or mobile
**When** the Google Maps route action or fallback is shown
**Then** the controls remain understandable and usable in both languages and on both screen sizes

### Story 6.6: Match Day Item Photo UX to Accommodations

As a trip planner,
I want day item photo management to work like the accommodation photo flow,
So that adding and managing photos feels consistent and easier across the day view.

**FRs covered:** FR17, FR18

**Acceptance Criteria:**

**Given** I edit a day item that already supports image galleries
**When** I open its dialog
**Then** the photo section uses the same interaction pattern as the accommodation dialog for selecting and uploading files
**And** I do not have to use a more cumbersome or separate workflow than accommodations

**Given** I select multiple photos for a day item
**When** I upload them
**Then** the system accepts the same multi-file add behavior used for accommodations
**And** the uploaded images appear in the saved gallery for that day item

**Given** a day item already has uploaded photos
**When** the photo list is shown in the dialog
**Then** it uses the same compact thumbnail-and-action presentation as accommodations
**And** it remains easy to review and remove photos without extra text-heavy controls

**Given** I click a photo thumbnail for a day item
**When** I want to inspect it
**Then** the same enlarged preview behavior used by accommodations is available

**Given** day item photos already exist from earlier stories
**When** this UX refinement is implemented
**Then** existing image persistence, ordering, authorization, and day-view mini-strip rendering continue to work
**And** accommodation photo behavior remains unchanged

**Given** I use the day item photo flow on desktop or mobile
**When** I add or manage photos
**Then** the controls remain understandable and usable in both languages and on both screen sizes

### Story 6.7: Move or Swap Day Activities Between Dates

As a trip planner,
I want to move or swap all activities between two days without affecting accommodations,
So that I can quickly rework my itinerary when plans change or a special event changes which day should hold those activities.

**FRs covered:** FR10, FR18

**Acceptance Criteria:**

**Given** a source day contains activities and a different target day exists
**When** I choose the move action and confirm it
**Then** all activities from the source day are moved to the target day
**And** any activities previously on the target day are removed
**And** the source day no longer contains those moved activities

**Given** the source day or target day has an accommodation entry
**When** I move activities between the two days
**Then** accommodation remains attached to its original day
**And** no accommodation data is moved, deleted, or overwritten by the move

**Given** two different days exist
**When** I choose the swap action and confirm it
**Then** the full set of activities from day A is assigned to day B
**And** the full set of activities from day B is assigned to day A
**And** accommodation remains attached to its original day on both dates

**Given** one of the selected days has no activities
**When** I perform a swap with another day that has activities
**Then** the empty day receives the other day's activities
**And** the previously populated day becomes empty of activities
**And** accommodation on both days remains unchanged

**Given** I try to move or swap activities using the same day as both source and target
**When** I attempt to continue
**Then** the system blocks the action with a validation message

**Given** the target day already contains activities for a move action
**When** I start the move flow
**Then** I am warned that the target day's activities will be deleted
**And** I must confirm before the overwrite is applied

### Story 6.8: Export Day Itinerary PDF for Offline Use

As a trip planner,
I want to export one trip day as a compact PDF with the full day flow,
So that I can take the plan with me and use it without internet access.

**FRs covered:** FR10, FR18, FR33

**Acceptance Criteria:**

**Given** I open a trip day that I am allowed to view
**When** I choose the export or print action for that day
**Then** the system generates a print-friendly PDF flow for that specific day only
**And** the export is available to authorized trip participants without requiring edit permission

**Given** the exported day contains a previous-night accommodation, day activities, travel segments, and a current-night accommodation
**When** the PDF is rendered
**Then** it shows the day in chronological order starting from the day-start accommodation context
**And** it includes all activities in between
**And** it shows the travel information between timeline items
**And** it includes the end accommodation when present

**Given** day activities or accommodations have saved images
**When** the PDF is rendered
**Then** relevant images are shown as compact thumbnails
**And** items without images do not leave broken or oversized empty media blocks

**Given** the day has enough location data for the map view
**When** the PDF is rendered
**Then** it includes a map section for that day's ordered route or ordered pins
**And** the map content matches the same day sequence used in the timeline

**Given** routing or map rendering is unavailable
**When** the PDF is generated
**Then** the export still succeeds without crashing
**And** the PDF shows the textual itinerary details even if the map falls back to a placeholder or unavailable state

**Given** the day contains a large amount of text, many images, or many stops
**When** the PDF is laid out for print
**Then** it is optimized for A4 output
**And** it aims to fit on one page when practical and no more than two pages for normal usage
**And** long content is truncated or compacted in a readable way instead of overflowing unpredictably

**Given** I save the export as a PDF file
**When** I open that PDF later without internet access
**Then** the printed document remains usable offline
**And** it does not depend on live application data or map requests after the PDF has been created

**Given** I print the PDF in grayscale or on a standard office printer
**When** the output is produced
**Then** the itinerary remains readable

### Story 6.9: Day Detail Refinements From First Production Use

As a trip planner using the redesigned day view on a real trip,
I want an activity's cost read as a tag beside its time, the whole activity clickable to edit, and the header stripped of duplicated navigation and redundant labels,
So that the screen I use most is faster to scan and easier to operate, particularly on a phone.

**FRs covered:** FR12, FR17, FR21 (presentation and interaction only — no data model, endpoint or capability change)

**Context:** Story 7.3 redesigned Day Detail and Story 7.11 reconciled its tokens. Both are `done`. This story collects six changes Tommy identified after using the result on a real trip — the first feedback in Epic 7's history that comes from production use rather than from a mockup comparison. None of them is a defect in 7.3: each is a judgement that only became visible in use.

Two of the six carry a design decision that must be settled before implementation; both are marked below.

**Acceptance Criteria:**

**Given** an activity's cost currently renders as plain text in the card's trailing block beside the edit affordance (`TripDayView.tsx:2208-2212`, `tlCostSx`), where it reads as an afterthought rather than as an attribute of the activity
**When** the card is re-laid out
**Then** the cost renders top-right in the card head, right-aligned, on the same line as the time
**And** it uses the established `badge-pill` geometry the time pill already uses (`TripDayView.tsx:1126-1132` — 4px radius, tabular figures), so money and time read as one family of metadata
**And** it is **filled** with `tokens.accent` `#4B6358` — the same forest green `DESIGN.md` assigns to `coverage-bar.seg-stay` (`:122`) — carrying white text, so time and money are distinguishable at a glance rather than reading as two identical tags (decided by Tommy, 2026-08-01; white on `#4B6358` measures 6.51:1, comfortably clear of this system's 4.5:1 contrast target)
**And** `DESIGN.md`'s `badge-pill` section records this as a second, filled pill variant alongside the existing soft one (`tl-time-bg: {colors.accent-soft}`, `:139`), so the next screen that needs a filled tag reuses it instead of inventing one
**And** the filled pill is visually distinguishable from a primary button, which uses the same accent fill and white text (`theme.ts` `containedPrimary`) — the 4px radius and small type carry that distinction, and a reviewer should confirm it holds at a glance rather than only in the markup

**Given** the per-activity edit affordance is a bare `IconButton` carrying an inline pencil path (`TripDayView.tsx:2215-2225`) that users do not reliably recognise as editable
**When** the card's interaction is reworked
**Then** that `IconButton` is removed from the activity card entirely, along with the `data-testid="day-plan-item-actions"` wrapper that exists only to hold it
**And** the day-image edit action in the hero header (`:1764`) is **kept** — this criterion is scoped to the activity cards alone

**Given** the pencil was the only way into editing an activity and is now gone
**When** an activity card is clicked anywhere other than its interactive children
**Then** the edit dialog for that activity opens
**And** the photo strip keeps its own behaviour — clicking a thumbnail opens the fullscreen viewer and does **not** open the edit dialog
**And** the "open link" action keeps its own behaviour and does not open the edit dialog

**Given** removing the pencil removes the only visible signal that an activity is editable
**When** an editable card is hovered on a pointer device
**Then** it carries a pointer cursor, a low-contrast background shift and a border move to accent, authored from the existing tokens — `EXPERIENCE.md:95` assigns hover and focus visuals to implementation because no mockup specifies them, and `TripsDashboard.tsx:462-471` is the established precedent for a whole-row click target in this app
**And** a small edit glyph fades in at the card's top-right, so the card stays quiet until the pointer reaches it
**And** that glyph is decoration only — `aria-hidden`, never a `<button>` — because the click target is the whole card, and a nested control would restore both the redundant affordance and the extra tab stop this story set out to remove

**Given** hover does not exist on a touch device, and `TripsDashboard.tsx:462` already scopes this app's row hover to `@media (hover: hover)` — correct for a trip row, which is self-evidently tappable, but leaving an activity card with no editability signal at all on a phone
**When** the card renders under `@media (hover: none)`
**Then** the same edit glyph is permanently visible at low emphasis (`tokens.inkMuted` rather than accent), so touch users get a quiet standing hint where pointer users get a revealed one
**And** no custom cursor image is used to carry this signal on any device — browsers cap cursor bitmap sizes, render them poorly on HiDPI displays, and no other surface in this app does it

**Given** the card is now the click target
**When** it is reached by keyboard
**Then** it is focusable, activated by both Enter and Space, shows a visible focus state, and carries an accessible name that says which activity it edits

**Given** a viewer or contributor without planning rights
**When** an activity card renders for them
**Then** it gets no click-to-edit behaviour, no pointer cursor, no hover treatment and no edit glyph in either media mode, matching today's `canEditPlanning` gating — a non-editable card must not look actionable

**Given** the hero header is a `space-between` row (`TripDayView.tsx:1714-1723`) whose left slot holds a breadcrumb of trip name, a `/` separator and the day label (`:1738-1760`), and whose right slot holds two controls — the day-image edit action (owner-only) and a "back to trip" button to the same destination the breadcrumb already links (`:1787`)
**When** the header is simplified
**Then** the breadcrumb is removed entirely
**And** the two right-slot controls are split across the row: "back to trip" moves into the left slot the breadcrumb vacates, and the day-image edit action stays right
**And** the trip button is enlarged to a comfortable touch target on a phone — it is the primary way back out of this screen
**And** the day is still named on the screen — the day title below the hero carries it, so no information is lost
**And** a non-owner, for whom the edit action does not render, still sees the trip button on the left rather than having it snap across an empty row

**Given** the day coverage bar is preceded by the label `trips.dayView.coverageTitle` ("Tagesabdeckung" / "Day coverage")
**When** the bar renders
**Then** that label is gone, the bar reading as self-evident from its segments and legend
**And** the key is removed from both dictionaries, along with any assertion that pins it

**Given** the day cost card is titled `trips.dayView.costCardTitle` ("Kosten bisher · heute")
**When** the card renders
**Then** it reads "Kosten heute" / "Costs today" in both dictionaries — the "bisher · heute" construction was carried over from the trip-level card, where "bisher" distinguishes spend-to-date from a total, a distinction that has no meaning on a single day

**Given** every other behaviour of the day view — the timeline, coverage bar, travel segments, stays, bucket list, map panel, cost roll-up and print export
**When** these six changes land
**Then** all of it works exactly as before: this story changes presentation and one interaction, nothing else
**And** timing, travel, and section hierarchy are still understandable without relying only on color

### Story 6.10: Trip Overview Refinements From First Production Use

As a trip planner using the redesigned trip overview on a real trip,
I want the trip-controls block to line up with the day list above it,
So that the page ends on a clean edge instead of a block that runs wider than everything it sits under.

**FRs covered:** None (presentation only — no capability, data or gating change)

**Context:** The trip overview's layout grid is `1.7fr 1fr` (`TripTimeline.tsx:455-460`). The day list occupies the left column, which carries `p: "22px 28px 22px 0"` — so at a 1400px viewport the grid measures `725.328px / 426.656px` and a day row is about **697px** wide after that right padding. The trip-controls card (`:800-822`, `data-testid="trip-controls-card"`) renders *outside* the grid entirely and therefore spans the full **1152px** — roughly 455px wider than everything above it, and the last thing on the page.

This is the same structural situation the bucket list was in before Story 7.12: a block that belongs to the trip's content column but was rendered after the grid rather than inside it. Story 7.8 restyled this card onto the token card treatment and, like 7.12's predecessor, left its placement alone because placement was not in its scope.

**Acceptance Criteria:**

**Given** the trip-controls card renders after the layout grid closes (`TripTimeline.tsx:800`) and so spans the full container width
**When** it is relocated
**Then** it renders inside the grid's left column, below the day list, and its rendered width matches a day row's — achieved by inheriting the column's existing padding, not by adding a width, `maxWidth` or margin of its own
**And** the `canEditPlanning || isOwner` guard moves with it unchanged, so a viewer still sees no empty bordered card

**Given** the overview collapses to a single column below `md` (`TripTimeline.tsx:456`)
**When** the page renders at `xs`/`sm`
**Then** the controls card still spans the column as it does today — the alignment this story fixes exists only in the two-column layout

**Given** the card's existing treatment from Story 7.8 — `tokens.card`, `1px solid tokens.borderStrong`, 8px radius, 18px padding, and the outlined "Edit trip" / "Delete trip" buttons with no destructive red
**When** it moves
**Then** none of that changes: this story relocates a block and nothing else

**Given** the bucket-list card that Story 7.12 moved into the sidebar
**When** the controls card moves into the left column
**Then** the two do not collide — the left column ends with the controls card, the right column ends with the gap alert, and neither reintroduces a full-width block after the grid

### Story 6.11: Day Navigation as Hero Chevrons, Print Into the Header Menu

As a trip planner opening a day on my phone,
I want previous/next to be chevrons on the day photo and print to live in the header menu,
So that the day view stops spending a full toolbar row on three controls I rarely need.

**FRs covered:** FR9 (day navigation), FR33 (print/PDF) — placement only, no capability change

**Context:** `TripDayView.tsx:2045-2088` renders a flex row of three controls below the hero — "previous day", "next day" and "print", each an outlined or text `Button` at `size="small"`. Its own comment concedes the position was never designed: *"Undepicted by the mockup, which shows only the breadcrumb and back button — kept as its own slim toolbar rather than dropped."* On a phone that row is a full band of chrome above the content the user came for.

Two facts shape the work. The hero already has a treatment for controls sitting on photography — `ON_PHOTO_CHROME` (`TripIcons.tsx:215`), whose white focus ring Story 7.11 verified in a browser — so the chevrons have a pattern to follow rather than one to invent. And the header menu's items come from `getAuthMenuItems(authState)` (`HeaderMenu.tsx:58,209`), a **global** list driven only by auth state, while print needs `tripId` and `day.id`. Moving print there makes a global menu context-aware for the first time.

Note this story overlaps Story 6.9, which also restructures this header: 6.9 removes the breadcrumb and moves "back to trip" into the left slot, while this story puts chevrons into the hero. They must be sequenced, not run in parallel.

**Acceptance Criteria:**

**Given** previous/next render as labelled `Button`s in a toolbar row below the hero
**When** they are relocated
**Then** they render as chevron controls inside the hero photo, one at each side, vertically centred
**And** they use `ON_PHOTO_CHROME` so they stay legible over arbitrary user photography, with the white focus ring Story 7.11 established
**And** each keeps a ≥44×44px hit area and its existing accessible name (`trips.dayView.previousAria` / `nextAria`), so the control is still announced as "previous day" rather than as a bare glyph
**And** the toolbar row they leave behind is removed rather than left as an empty flex container

**Given** the first and last day of a trip, where today a disabled `Button` still occupies the row
**When** there is no previous or no next day
**Then** that chevron is **not rendered at all** — decided by Tommy on 2026-08-01: the controls sit inside the photo, so an absent one leaves no hole in the layout and needs no disabled treatment
**And** nothing focusable remains in its place, so keyboard order skips it rather than stopping on a dead control
**And** the two `trips.dayView.previousAction` / `nextAction` label strings become unused if no other surface renders them — check and remove them from both dictionaries if so, keeping the `*Aria` keys, which the chevrons still need

**Given** print is a `Button` in that same toolbar, linking to `/trips/{id}/days/{dayId}/print` in a new tab, and it is the day view's only print entry point
**When** it is relocated
**Then** it moves into a new overflow menu (`⋯`) in the day hero's header, beside the day-image edit action — decided by Tommy on 2026-08-01, in preference to making the global `HeaderMenu` context-aware
**And** `HeaderMenu.tsx` and `src/lib/navigation/authMenu.ts` are **not touched**: the overflow is the day page's own, built from the same `Menu` / `MenuItem` treatment so the two read as one idiom
**And** the overflow trigger carries an accessible name, a ≥44×44px hit area, and opens by keyboard

**Given** the day-image edit action beside it is owner-only (`TripDayView.tsx:1764`) while print is a read action available to every role that can open the day
**When** the overflow menu is placed in that same control group
**Then** it is rendered **without** the `isOwner` guard, so a viewer and a contributor keep their access to print
**And** the group renders correctly in all three cases: owner (edit + overflow), non-owner (overflow only), and — if a future role can neither edit nor print — nothing at all rather than an empty container

**Given** a print action that opens a new tab
**When** it is invoked from a menu rather than a button
**Then** it keeps `target="_blank"` with `rel="noopener noreferrer"`, and the menu closes on selection

**Given** the day view at a phone width
**When** the three controls have moved
**Then** the vertical space the toolbar occupied is gone, and the hero is followed directly by the day's content

**Given** every existing behaviour — the day timeline, coverage bar, stays, travel segments, bucket list, map panel, costs, and the print document itself
**When** these controls move
**Then** none of it changes: this story relocates three controls and nothing else

### Story 6.12: One Fullscreen Photo Viewer — Correct Coverage, Paging, Keyboard Access

As a trip planner looking at a photo I attached to an activity,
I want the fullscreen viewer to actually fill the screen and let me page through that item's other photos,
So that opening a photo shows me the photo instead of a black panel with a lighter rim around it, and I can see all of them without closing and reopening.

**FRs covered:** FR13, FR18 (photo galleries — viewer behaviour only; no upload, storage or data-model change)

**Context:** The viewer is inlined **four times** — `TripDayView.tsx:2786`, `TripAccommodationDialog.tsx:1111`, `TripDayPlanDialog.tsx:1290`, `TripDayMapFullPage.tsx:531` — and opened from **nine** call sites. Each copy is the same ~25 lines:

```jsx
<Dialog maxWidth={false} sx={{ "& .MuiDialog-paper": { backgroundColor: "transparent", boxShadow: "none", m: 0 } }}>
  <DialogContent sx={{ minWidth: "100vw", minHeight: "100vh", backgroundColor: "rgba(0,0,0,0.85)" }}>
```

Three defects follow from that shape. The dark fill sits on the `DialogContent`, so MUI still paints its own `rgba(0,0,0,0.5)` backdrop underneath — two differently dark surfaces stacked, and wherever the inner one fails to cover, the outer shows as a rim. `100vw` **includes the scrollbar width**, so on a pointer device the inner surface is wider than the viewport, which produces overflow and offset. And `onKeyDown={() => setFullscreenImage(null)}` closes on *any* key, Tab included.

Two ledger entries have been waiting for this story by name. **DW-30** records that `MiniImageStrip`'s thumbnails carry `onClick` and `cursor: pointer` but no `role`, `tabIndex` or key handler, so the viewer cannot be opened from a keyboard — and that the strip caps at three images with a "+N" indicator, leaving **the fourth photo and beyond unreachable by any input**. **DW-51** records the identical defect in `PhotoUploadField`, the shared primitive Story 7.7 introduced across three surfaces. Both name a photo-viewer story as their home.

Paging is what closes the second half of DW-30: with it, the overflow images become reachable.

**Acceptance Criteria:**

**Given** the viewer is inlined in four components with nine call sites
**When** it is consolidated
**Then** one shared viewer component owns the behaviour and all four inline copies are deleted
**And** the call sites hand it the image **collection and a starting index**, not a single URL — `MiniImageStrip` and `PhotoUploadField` already receive the whole array and discard it in an `onImageClick(imageUrl, alt)` callback, so this is a signature change, not new data plumbing

**Given** the dark fill is applied to `DialogContent` while MUI paints its own backdrop beneath it
**When** the viewer renders
**Then** exactly **one** darkened surface covers the screen, and no lighter rim or seam is visible at any viewport size
**And** `100vw` is not used for it, because it includes the scrollbar width and makes the surface wider than the visible area

**Given** an activity, accommodation or day with several photos
**When** the viewer is open on one of them
**Then** the user can page to the next and previous image within that collection, without closing the viewer
**And** paging wraps or stops consistently — whichever is chosen is applied the same way at both ends
**And** the current position is stated, so it is clear how many images there are and which one this is

**Given** `MiniImageStrip` shows at most three thumbnails plus a "+N" indicator, leaving later images unreachable (DW-30)
**When** the viewer supports paging
**Then** every image in the collection is reachable, including those the strip does not render
**And** the "+N" indicator opens the viewer rather than being inert caption text

**Given** thumbnails in `MiniImageStrip` and `PhotoUploadField` carry `onClick` and `cursor: pointer` but no `role`, `tabIndex` or key handler (DW-30, DW-51)
**When** they are made operable
**Then** each is reachable and activatable by keyboard with a visible focus state and an accessible name identifying which photo it opens
**And** both components are fixed, not one — `PhotoUploadField` serves the accommodation gallery, the day-plan gallery and the day-details preview, so fixing only `MiniImageStrip` leaves three surfaces behind

**Given** the viewer closes on `onKeyDown` for any key, Tab included
**When** the key handling is corrected
**Then** only `Escape` closes it, the arrow keys page, and focus is managed so it does not escape to the page behind while the viewer is open
**And** focus returns to the thumbnail that opened it when it closes

**Given** each image already has an alt string composed at the call sites
**When** the viewer displays an image
**Then** that alt travels with it and updates as the user pages, rather than being fixed at the one the viewer opened with

**Given** every other photo behaviour — upload, delete, the gallery grids, the strip's three-thumbnail layout, and the image routes
**When** the viewer is consolidated
**Then** none of it changes: this story owns the viewer and the thumbnails' input handling, nothing else

### Story 6.13: Accommodation Cards Editable Like Activities

As a trip planner editing a day,
I want the two accommodation cards to open their editor by clicking the card, exactly as activities now do,
So that the timeline has one interaction rule instead of three, and the stay I am looking at is the stay I edit.

**FRs covered:** FR14, FR15 (accommodation editing — interaction only; no data, gating or dialog change)

**Context:** Story 6.9 made activity cards open their editor on click and removed their per-card pencil. The two accommodation cards were not in its scope, so the day timeline now has three different rules:

- **Activity cards** — click the card. No visible button.
- **Previous-night card** (`TripDayView.tsx:2173-2185`) — a `Button variant="text"` with a pencil, *inside* the card. Since 6.9 it is the only card in the timeline still carrying one, which is why it now stands out.
- **Current-night card** (`:2439-2452`) — no card-level affordance at all. The only way in is a button in the toolbar above the timeline (`:2130-2143`, `setStayOpen`), so the card you are looking at and the control you press are in different places.

Everything this needs already exists and was verified in a browser by 6.9: `editableActivityCardSx` (hover, cursor, glyph), `overlaidContentSx` (`pointerEvents: none` on content, `auto` on `a, button`), `editLabelFor` (a capped accessible name), and the stretched `<button>` overlay itself. 6.9's own comment records why the overlay exists rather than `role="button"` on the card: ARIA gives `button` *Children Presentational: True*, which would collapse the card's title, notes and pills into a single announced label.

**Acceptance Criteria:**

**Given** the previous-night and current-night cards
**When** either is clicked anywhere other than an interactive child
**Then** it opens the same dialog its current control opens — `setPreviousStayOpen` and `setStayOpen` respectively — with no change to the dialogs themselves
**And** the mechanism is the stretched `<button>` overlay Story 6.9 built, not `role="button"` on the card, for the reason 6.9 recorded

**Given** the previous-night card carries an inline edit/add `Button` (`:2173-2185`)
**When** the card becomes the target
**Then** that button is removed, so no card in the timeline carries a visible edit control

**Given** the toolbar above the timeline carries a stay edit/add button (`:2130-2143`)
**When** the current-night card becomes the target
**Then** that button is removed as well
**And** the toolbar's other actions — move, swap, add plan item — are untouched

**Given** a day with no accommodation on record, where the cards render `trips.dayView.previousNightEmpty` / `currentNightEmpty` and today's buttons read "Unterkunft hinzufügen"
**When** such a card is clicked
**Then** it opens the same add dialog the removed button opened, so an empty card is the way to add a stay rather than a dead surface
**And** the accessible name says whether it adds or edits, since the card looks the same either way

**Given** the current-night card contains a "Vorherige Nacht kopieren" button when `canCopyPreviousStay` (`:2450`)
**When** the card is clicked on that button
**Then** the copy runs and the edit dialog does **not** open — `overlaidContentSx` already lifts `a` and `button` above the overlay, so this works by reusing the pattern rather than by special-casing

**Given** editability must be visible, as Story 6.9 established for activities
**When** an editable stay card is presented
**Then** it carries the same hover treatment and edit glyph on a pointer device, and the same permanently visible glyph under `@media (hover: none)`, so all three card kinds signal editability identically

**Given** a viewer or contributor without planning rights
**When** the stay cards render for them
**Then** they get no overlay, no cursor, no hover treatment and no glyph — matching both today's `canEditPlanning` gating and what 6.9 did for activities

**Given** the timeline, coverage bar, travel segments, stay dialogs, cost roll-up and the copy-previous-night action
**When** the two cards become clickable
**Then** none of it changes: this story moves an affordance, it does not change what any dialog does

### Story 6.14: Trip Controls Last on a Phone

As a trip planner on a phone,
I want "Reise bearbeiten" and "Reise löschen" at the very bottom of the trip overview,
So that two actions I almost never use stop sitting between the day list and the information I actually scrolled for.

**FRs covered:** None (ordering only — no capability, gating or styling change)

**Context:** Story 6.10 moved the trip-controls card into the layout grid's left column so its width would match the day rows'. That fixed the desktop alignment — measured: card and day rows both `left 124 → right 821.3` at 1400px, the ~455px overhang gone.

Below `md` the grid collapses to one column and DOM order becomes visual order, so the card came with it: Edit/Delete now render directly under the day list, **above** the cost summary, the route map, the bucket list and the gap alert. Before 6.10 they were the last thing on the page.

6.10's AC4 only constrained the card's *width* in the single-column layout, and its width is unchanged — so this is a follow-up, not a defect in that story. Its own operator action said as much. Tommy rejected the new order on 2026-08-02: these two controls are rarely used and should not precede four information cards on the surface where vertical space costs the most.

Note the shape of the problem: the card is nested inside the left column, and the sidebar cards inside the right one. A CSS `order` on the card alone cannot move it past its own column's sibling, so the fix is structural rather than a one-property change.

**Acceptance Criteria:**

**Given** the trip overview below the `md` breakpoint, where the layout is a single column
**When** the page renders
**Then** the trip-controls card is the **last** block on the page, after the cost summary, the route map, the bucket list and the gap alert
**And** its width still spans the column exactly as it does today, which is what Story 6.10's AC4 fixed

**Given** the two-column layout at `md` and above
**When** the page renders
**Then** nothing changes from what Story 6.10 delivered: the card sits in the left column below the day list, sharing the day rows' edges, with no width, `maxWidth` or margin of its own
**And** the left column still ends with the controls card and the right with the gap alert

**Given** the card is nested inside the left column, so a CSS `order` cannot lift it past that column's own boundary
**When** the reordering is implemented
**Then** the mechanism is chosen deliberately and recorded — whether the card becomes a direct grid child with a breakpoint-dependent `order`, or is rendered in a different position below `md` — and it does not reintroduce a full-width block after the grid, which Story 6.10 removed
**And** the card is not rendered twice with one copy hidden, since that would duplicate its buttons for assistive technology

**Given** the existing gating (`canEditPlanning || isOwner`) and Story 6.10's test asserting the card is a descendant of the left column
**When** the ordering changes
**Then** the gating is unchanged, and that test is updated deliberately rather than deleted — a viewer still sees no card at any width

**Given** every other block on the overview
**When** the card moves on small screens
**Then** their order, width and behaviour are unchanged: this story moves one card on one breakpoint

### Story 6.15: Move and Swap Into the Day Overflow Menu

As a trip planner on a phone,
I want "Aktivitäten verschieben" and "Aktivitäten tauschen" behind the `⋯` menu that already holds print,
So that the timeline header carries one primary action instead of a wrapping row of four.

**FRs covered:** FR16 (move/swap day activities — placement only; the dialogs and their behaviour are unchanged)

**Context:** The timeline section header (`TripDayView.tsx:2225-2253`) holds four `canEditPlanning`-gated buttons: move, swap, the accommodation edit/add, and "+ Aktivität". On a phone they wrap to two rows above the content.

Two stories already reduce this. **6.13** removes the accommodation button, since both stay cards become clickable. This story removes the other two, leaving "+ Aktivität" alone — the one action that genuinely belongs in a section header, because it creates what the section lists.

Story **6.11** built the destination: a page-local `⋯` overflow in the hero header (`:1930-1936`), holding print today. It is deliberately *not* the global `HeaderMenu` — that one is built from `getAuthMenuItems(authState)` and knows nothing about this trip or this day.

**Acceptance Criteria:**

**Given** move and swap render as outlined buttons in the timeline section header
**When** they are relocated
**Then** they appear as items in the existing `⋯` overflow menu, and the two buttons are gone from the header
**And** no second menu is introduced — this is the menu Story 6.11 created, extended

**Given** the day-image edit action sits beside the `⋯` as a second 44px control in the hero's right slot, `isOwner`-gated (`TripDayView.tsx:1963-1977`)
**When** it moves into the menu as well
**Then** the right slot holds the `⋯` alone, freeing roughly 52px in the header row — decided by Tommy on 2026-08-02, and worth most on a phone
**And** the comment above that slot explaining it is "rendered even when empty" is finally correct or gone: with only an unconditional trigger left, the workaround it describes has no remaining purpose

**Given** the menu now carries three different gating levels — day-image edit (`isOwner`), move and swap (`canEditPlanning`), print (every role that can open the day)
**When** it renders
**Then** each item appears only for a role the server would accept, so a viewer sees print alone, a contributor sees print with move and swap, and an owner sees all four
**And** the items are grouped so the two transfer actions stay adjacent and the read action does not sit between two write actions

**Given** print is a link that opens a new tab, while move and swap open dialogs
**When** the menu holds both kinds
**Then** each item behaves as its kind requires — print keeps `target="_blank"` and `rel="noopener noreferrer"`, move and swap open their existing dialogs — and the menu closes on any selection
**And** the dialogs themselves are unchanged: this story changes how they are reached, not what they do

**Given** the menu could end up holding nothing for a role that can neither print nor plan
**When** no item would render
**Then** the `⋯` trigger does not render either, rather than opening an empty menu

**Given** the timeline section header after this story and Story 6.13
**When** it renders for a planner
**Then** it carries the section label and "+ Aktivität" alone
**And** the header no longer wraps to a second row at 390px, which is the reason for the change

**Given** the day timeline, the transfer dialogs, the print document, the stay cards and every gating rule
**When** the two actions move
**Then** none of it changes: this story relocates two controls

### Story 6.16: Walking and Cycling as Travel Modes

As a trip planner,
I want to record a leg as walked or cycled,
So that the day's travel reflects how we actually get between places instead of forcing every leg into car, ship or flight.

**FRs covered:** FR23 (travel segments) — extends the mode set; no change to how segments are timed, drawn or rolled up

**Context:** `TravelTransportType` in `prisma/schema.prisma:36-40` is `CAR | SHIP | FLIGHT`. There is no walking and no cycling, so a leg on foot has to be recorded as one of the three or not at all — and the coverage bar, the day's travel total and the Gantt all read from it.

This is a **schema change**, not a UI addition: the enum is a Prisma enum backed by a database column, so it needs a migration. `TripIcons.tsx:334`'s `transportIconFor` is typed `"car" | "ship" | "flight"` and returns one of three glyphs; two more are needed.

One consequence worth deciding up front: `trips.travelSegment.googleMapsCarOnlyHelper` records that automatic route import works for car only. Walking and cycling would either gain Google Maps' own `walking`/`bicycling` modes, or stay manual like ship and flight.

**Acceptance Criteria:**

**Given** `TravelTransportType` offers only `CAR`, `SHIP` and `FLIGHT`
**When** the mode set is extended
**Then** walking and cycling are available wherever a transport type is chosen, and the migration adds them without touching existing rows
**And** every existing segment keeps its current type — this is additive only

**Given** `transportIconFor` is typed to three literals and returns three glyphs
**When** the new modes land
**Then** each has its own glyph in `TripIcons.tsx`, consistent with the existing stroke set, and the function's type widens rather than falling back to a default

**Given** the coverage bar, the Gantt segments, the day's travel total and the trip's cost roll-up all read the transport type
**When** a leg is walked or cycled
**Then** each surface treats it as travel exactly as it treats the other modes — no new segment kind, no new colour, no special case

**Given** automatic route import is car-only today, and its helper text says so
**When** a walking or cycling leg is edited
**Then** the import runs for those modes too, using Google's `walking` and `bicycling` travel modes — decided by Tommy on 2026-08-02
**And** ship and flight stay manual, since Google offers no equivalent, so the helper text is rewritten to name the modes that *do* import rather than saying "nur für Auto-Abschnitte"
**And** a mode Google cannot route for degrades to the existing manual path rather than erroring

**Given** the day coverage bar reads `kind: "accommodation" | "planItem" | "travel" | "gap"` (`TripDayGanttSegments.ts:4`) and never reads the transport type at all
**When** the new modes land
**Then** they continue to fall into the single `"travel"` kind under the legend's "Fahrt", and no per-mode distinction is introduced there — the bar is a coarse overview of the day and the manner of travel is deliberately not part of it

**Given** the distance field is required for car (`trips.travelSegment.distanceRequired`)
**When** a walking or cycling leg is saved
**Then** the rule is stated deliberately for the new modes rather than inherited by accident

**Given** the export and import formats carry the transport type
**When** a backup is written or read
**Then** the new values round-trip, and a v2 backup containing them imports cleanly — Story 2.31/2.32's format is bound to the enum

### Story 6.17: Travel Segment Dialog on a Phone

As a trip planner adding a leg on my phone,
I want short button labels and less explanatory prose,
So that the dialog fits the screen instead of wrapping its controls.

**FRs covered:** FR23 — presentation only; no field, validation or route change

**Context:** The travel-segment dialog carries the app's longest control labels and a paragraph of helper text. On a phone the buttons wrap and the prose pushes the fields below the fold. Tommy asked for four specific changes on 2026-08-02:

| Key | Today | Wanted |
|---|---|---|
| `trips.travelSegment.openLink` | "Open Maps" | "Maps" |
| `calculateGoogleMapsRoute` / `refreshGoogleMapsRoute` | "Plan with Maps" | "Plan" |
| `common.save` | "Speichern" | "OK" |
| `googleMapsFallbackHelper` | "Öffne die Route in Google Maps und übertrage Dauer und Entfernung anschließend manuell in dieses Formular." | removed |

Note that `common.save` has exactly one reader — this dialog (`TripDayTravelSegmentDialog.tsx`). Renaming its *value* therefore changes nothing else today, but the key's **name** claims to be shared. Leaving a key called `common.save` reading "OK" is a trap for the next dialog that reaches for it.

**Acceptance Criteria:**

**Given** the four strings above
**When** the dialog renders
**Then** each reads as Tommy specified, in **both** dictionaries — `i18nDictionaries.test.ts` enforces key parity
**And** the removed helper's key is deleted rather than left orphaned, and any assertion pinning it is updated

**Given** `common.save` is named as a shared key but has exactly one reader
**When** its value becomes "OK"
**Then** it is either renamed to something dialog-specific, or the change is recorded where the next reader will see it — a key called `common.save` that says "OK" will be reused by a dialog that meant "Speichern"

**Given** the remaining helper texts — `googleMapsUnavailableHelper`, `googleMapsCarOnlyHelper`, `googleMapsFallbackActive`, `googleMapsPrefillSuccess`
**When** the dialog renders on a phone
**Then** each is reviewed for the same problem, and any that is prose rather than instruction is shortened or dropped
**And** whichever are kept still say what the user needs at the moment they appear

**Given** the dialog at 390px
**When** it renders
**Then** its controls sit on one row where they fit, no label wraps mid-word, and no horizontal scrollbar appears

**Given** every field, validation rule, route call and save path
**When** the copy changes
**Then** none of it changes: this story edits strings and layout

### Story 6.18: One Way to Enter a Time

As a trip planner on a phone,
I want every time field to use the same control I can actually operate,
So that entering a check-in time stops being impossible.

**FRs covered:** FR15, FR21, FR23 (accommodation times, activity times, segment duration) — input mechanism only

**Context:** The app has three different time inputs, and one of them cannot be used on a phone at all:

| Where | Today | On a phone |
|---|---|---|
| `TripDayPlanDialog.tsx:1083,1094` | native `type="time"` | the OS wheel — works |
| `TripAccommodationDialog.tsx:900,908` | `FormField` + `inputMode: "numeric"` | **digits-only keypad, no colon — the value cannot be typed** |
| `TripDayTravelSegmentDialog.tsx:437` | free text, `placeholder="HH:mm"` | ordinary keyboard; it is a **duration**, not a clock time |

The middle row is a real defect: `inputMode="numeric"` asks the OS for a numeric keypad, which on iOS and Android has no `:`. A user cannot enter "16:00". Tommy hit this in production use.

The third is a different problem wearing the same mask. A duration is a span, so a native `type="time"` would model it wrongly — it would offer a clock, and "01:30" would mean half past one rather than ninety minutes.

**Acceptance Criteria:**

**Given** `TripAccommodationDialog`'s check-in and check-out fields ask for `HH:mm` behind a numeric keypad
**When** they are reworked
**Then** they use the same native `type="time"` control `TripDayPlanDialog` already uses, so a phone offers its own time picker
**And** the existing validation, defaults (`DEFAULT_CHECK_IN` / `DEFAULT_CHECK_OUT`) and "assumed time" behaviour are preserved

**Given** every time-of-day field in the app
**When** this story lands
**Then** they all use one control, and a grep for `inputMode: "numeric"` on a time field returns nothing
**And** any `HH:mm` hint that only existed to explain a free-text field is removed with it

**Given** the travel segment's duration is a span rather than a clock time
**When** it is reworked
**Then** it uses a control that models a duration — separate hours and minutes, or an explicit minutes field — and **not** `type="time"`, which would silently reinterpret "01:30" as a time of day
**And** whatever is chosen is operable on a phone without typing a colon, which is the whole point of this story

**Given** `type="time"` renders differently across browsers and its value is always `HH:mm` regardless of the display locale
**When** the fields are converted
**Then** the stored and validated format is unchanged, so no migration and no data rewrite is needed

**Given** the accommodation, plan-item and travel-segment dialogs
**When** the controls change
**Then** every existing validation message, required rule and default still applies: this story changes how a value is entered, not what is accepted

### Story 6.19: Three Surfaces on the Day Hero

As a trip planner on a phone,
I want the day hero to carry three controls in three corners instead of a row of buttons,
So that the photo reads as a photo and the controls stop competing with the title for the same band.

**FRs covered:** FR21, FR22 (day navigation, day actions) — placement only

**Given** the day hero
**When** it renders
**Then** it carries exactly three interactive controls: previous day (top-left), next day (top-right) and the `⋯` overflow (bottom-right)

**Given** the "← Zurück zur Reise" button
**When** this story lands
**Then** it is the first item of the `⋯` menu, and the header row is removed rather than left as an empty flex container

**Given** the `⋯` and the next-day chevron
**When** measured at any breakpoint
**Then** their right edges are identical — today the `⋯` inherits the hero's 16/32px padding while the chevron sits at `right: 8`, so they differ by 8px on a phone and 24px on a desktop

**Given** a day whose note runs to the full 280 characters
**When** the title block grows upward with no header row above it and the `⋯` below it
**Then** no title text renders under a control and no control is made un-tappable

**Given** the chevrons moving from the vertical centre to the top corners
**When** measured against `HERO_SCRIM`
**Then** they read no worse than today — the scrim behind them drops from ~0.35 to ~0.19 alpha, on controls DW-98 already measured at 2.41:1

**Given** every role
**When** the back action moves into the menu
**Then** each can still reach print and still get back to the trip — the trigger stays ungated

### Story 6.20: The Trips Link Moves Into the Header Menu

As a trip planner,
I want the way back to all my trips in the hamburger menu instead of as a breadcrumb above the page,
So that the trip overview starts with the trip rather than with a link away from it.

**FRs covered:** FR3 (trip navigation) — placement only

**Given** the trip detail page
**When** it renders
**Then** the `← Zurück zu Reisen` control is gone and the page's first block is the trip itself

**Given** an authenticated user on any page
**When** they open the header menu
**Then** it carries an entry leading to `/trips`; an anonymous visitor does not see it, because `/trips` is not reachable for them

**Given** the "trip not found" panels in `TripTimeline` and `TripCostOverview`
**When** this story lands
**Then** they keep their own button — a menu is not a recovery path from a page that failed to load

**Given** the removed markup is a `<Link>` wrapping a `<Button>`
**When** the menu entry is written
**Then** the invalid `<a>`-containing-`<button>` nesting is not reproduced

### Story 6.21: Shorter Labels on the Day Stat Strip

As a trip planner on a phone,
I want the four stat cells under the day photo to carry short labels,
So that one long hotel name stops making half the strip tall.

**FRs covered:** FR21 (day overview) — labels only

**Given** the stat strip
**When** it renders
**Then** the labels read "Fahrzeit", "Ausgaben" and "Check-in" — the accommodation name leaves the label entirely

**Given** a stay with a long name
**When** the day is opened at 390px
**Then** the strip does not react to it: the check-in cell shares its grid row with the spend cell, so a wrapping label made both cells tall

**Given** `trips.dayView.statCheckInGeneric` already holds exactly "Check-in"
**When** the label is collapsed
**Then** that key becomes the only label and `statCheckIn` is deleted from both dictionaries rather than left orphaned

**Given** the cell's two states
**When** the label stops varying
**Then** the value still distinguishes them: `noAccommodation` in the warning colour, or the check-in time or an em dash in ink


### Story 6.22: The Activity Dialog in Tabs

As a trip planner on a phone,
I want the activity dialog split into four tabs instead of one long scroll,
So that I can see what a section holds without scrolling through everything that comes before it.

**FRs covered:** FR15, FR21 (activity editing) — layout only

**Given** the activity dialog, which measures 1341px of content in a 556px window at 390x844 with 11 input fields
**When** it opens
**Then** it carries four tabs — Was (Titel, Beschreibung), Wann & Wo (Von, Bis, Ort), Kosten (Betrag, Zahlungsart, Zahlungszeilen), Medien & Links (Galerie, Link) — and none of them holds a single field

**Given** a validation error on a tab the user is not looking at
**When** they press save
**Then** the dialog switches to the first tab carrying an error and focuses that field; every tab with an error is marked, and saving never fails silently

**Given** the map from error key to tab
**When** a seventh error key is added later
**Then** the build fails rather than the marker silently going missing

**Given** typed-but-unsaved values, rich-text content, selected files and an in-flight upload
**When** the user switches tabs and comes back
**Then** none of it is lost

**Given** the description's own formatting toolbar sits directly below the tab bar
**When** both render at 390px
**Then** they are distinguishable at a glance rather than reading as one broken control


### Story 6.23: Move a Single Activity to Another Day

As a trip planner,
I want to move one activity to a different day,
So that a plan that turned out to fit better elsewhere can be rearranged instead of retyped.

**FRs covered:** FR21, FR23 (day planning, activity management)

**Given** an existing activity
**When** its dialog is open
**Then** it offers "Auf anderen Tag verschieben" — absent while creating one, and absent for a viewer

**Given** a target day that already has activities
**When** one is moved onto it
**Then** they are untouched: this appends, unlike the day-level move which deletes the target day's activities

**Given** an activity with images, a cost with split payments, a link, a location and times
**When** it is moved
**Then** all of it arrives on the new day unchanged — not retyping is the whole point

**Given** travel segments referencing the moved activity
**When** it leaves the day
**Then** they are removed and the user is told, because a segment holds a duration, a distance and sometimes a link that someone typed

**Given** the activity's arrival on the target day
**When** it has no neighbours it is connected to
**Then** no travel segment is invented — transport mode and duration are the user's knowledge, not the app's

**Given** an activity being deleted rather than moved
**When** the same cleanup is needed
**Then** it happens there too: today the segments survive and `totalTravelMinutes` keeps counting them, measured at 5h 30m before and after deleting the activity the segment pointed at


### Story 6.24: A Calmer Activity Dialog

As a trip planner,
I want the activity dialog to hold still when I switch tabs and to carry fewer buttons,
So that the thing I just clicked stops moving away from my cursor.

**Given** the dialog measured at 1400px — 668px on Was, 501px on Wann & Wo, 572px on Kosten, 660px on Medien & Links
**When** tabs are switched
**Then** the frame does not move: MUI centres it, so a 167px swing lands as 84px on the top edge, which is where the tab bar is

**Given** the Kosten panel reaching 1634px at five split-payment rows (DW-149)
**When** the frame is stabilised
**Then** it is a minimum height and not a fixed one, so shorter panels pad with space and the long one still scrolls

**Given** a footer measuring 243px at 390px — 31% of the dialog, four buttons deep
**When** Abbrechen becomes a top-right close control, Löschen a trash glyph, Speichern "OK" and the move action "anderer Tag"
**Then** it fits on one row, and the trash glyph keeps the accessible name `trips.plan.deleteItemAria` that already exists

### Story 6.25: Close Is a Cross, and Keeping Is Named

As someone using this app,
I want every dialog to close the same way and every deletion to offer a clearly named way out,
So that a footer full of Abbrechen becomes one familiar close control.

**Given** eleven dialog files, six of which already use `DialogShell`
**When** the close control is added to the shell's title row
**Then** those six inherit it and the remaining five get a matching one — migrating them onto the shell is explicitly out of scope

**Given** ten form dialogs and two delete confirmations among the twelve `common.cancel` call sites
**When** the pattern is applied
**Then** the forms lose their Abbrechen button, while the confirmations keep two buttons and rename the safe one to "Reise behalten" / "Eintrag behalten" — a dialog asking whether to delete must not shrink the harmless answer to a corner glyph

**Given** all twelve readers are in this story's scope
**When** it lands
**Then** `common.cancel` has none left and is deleted from both dictionaries, the way `common.save` was in Story 6.17

**Given** `EXPERIENCE.md` requires a secondary cancel button beside every non-trivial primary action, and `DESIGN.md` defines the secondary variant as cancel/dismiss only
**When** this story reverses that
**Then** both documents are updated with it, rather than leaving the drift Story 7.11 exists to clean up

### Story 6.26: The Accommodation Dialog in Tabs

As a trip planner on a phone,
I want the accommodation dialog split into tabs the way the activity dialog already is,
So that the second-longest form on the day screen stops being one scroll through everything.

**FRs covered:** FR13, FR14 (accommodation editing) — layout only

**Given** the accommodation dialog, which holds nine form fields plus the payment schedule, the place lookup and the photo gallery in one 520px column
**When** it opens
**Then** it carries four tabs — Basisdaten (Name, Status, Check-in/Check-out), Zahlung (Kosten, Zahlungsart, Zahlungszeilen), Ort & Notizen (Ortssuche, Koordinaten, Notizen), Medien & Links (Link, Galerie) — and none of them holds a single field

**Given** the gallery is gated on a stay that has already been saved
**When** the dialog is opened to *add* one
**Then** the Medien & Links tab still holds the link and says why the upload zone is absent, rather than being an empty tab — the same reason Story 6.22 moved the activity dialog's link onto its media tab

**Given** a validation error on a tab the user is not looking at
**When** they press save
**Then** the dialog switches to the first tab carrying an error and focuses that field; every tab with an error is marked in colour, in a glyph and in the tab's accessible name, and saving never fails silently

**Given** react-hook-form skips the rules of a field whose panel is unmounted, while keeping its value
**When** save is pressed from any tab
**Then** the required name, the cost, the link and the rendered time field are judged anyway — before the split every field was always mounted, so this is a defect the tabs introduce rather than one they inherit

**Given** the map from form field to tab
**When** a tenth field is added later
**Then** the build fails rather than the marker silently going missing

**Given** typed-but-unsaved values, a resolved location and files staged for upload
**When** the user switches tabs and comes back
**Then** none of it is lost, and the dirty-form confirmation from Story 6.25 still asks exactly once

**Given** four panels of different heights and MUI centring the dialog
**When** tabs are switched
**Then** a minimum height holds the frame still, as Story 6.24 did for the activity dialog — a minimum and not a fixed height, because the payment rows and the photo strip are both unbounded

### Story 6.27: A Comma Is a Decimal Point

As someone planning a trip on a German phone,
I want to type 12,50 into a cost field and have it saved as 12,50,
So that a stay does not save with no cost at all while the box looked filled.

**FRs covered:** None (defect fix; silent data loss on four numeric inputs)

**Depends on:** nothing.

**Context:** Reported from a real German phone on 2026-08-05. Four numeric inputs are `type="number"` while also setting `inputMode="decimal"` — the second asks a German keyboard for a comma, the first rejects it. On `badInput` a browser reports `value === ""`, so the comma never reaches React, and the cost validation opens with "empty is legal, it means no cost". The stay therefore saves **with no cost at all**, silently, and no error is shown. That is data loss, not an input annoyance.

The fix already existed one field deep: the activity cost field was already `type="text"` + `inputMode="decimal"` with a comma-aware parser, and was never propagated. The app also already promises comma support in its own copy — `trips.plan.costHelper` reads "z. B. 10,00 oder 10.00" — and kept that promise at exactly one of five fields.

**Acceptance Criteria:**

**Given** a German keyboard and any of the five numeric fields — stay cost, stay payment amount, activity cost, activity payment amount, travel-segment distance
**When** a comma decimal is typed
**Then** it is accepted and saved as the value shown, including grouped forms such as `1.234,50` and `1,234.50`

**Given** the underlying cause is the input type and not the parser
**When** the fix is applied
**Then** `type="number"` is gone from all five: a parser cannot recover a comma the browser discarded before any code runs

**Given** a value that cannot be parsed at all
**When** it is submitted
**Then** it becomes a visible, blocking error rather than falling through to "empty means no cost" — the empty-versus-invalid distinction that only becomes expressible once the field is text

**Given** a distance in km, which is not money
**When** it is parsed
**Then** it is neither rounded to two decimals nor multiplied by 100, and one shared parser serves all of them with both local copies deleted

**Given** the German locale
**When** a cost field is empty
**Then** its placeholder and helper line are locale-correct — `0,00`, and the accepted forms named

### Story 6.28: Coordinates by Hand, and a Choice of Places

As a traveller planning an activity the geocoder cannot find,
I want to paste or type coordinates from Google Maps, and to pick from real search results when I do search,
So that a pin lands where I mean it instead of somewhere with a similar name.

**FRs covered:** FR26, FR28 (the way *into* the map data both describe)

**Depends on:** nothing hard. Prefer landing after Story 6.27, which establishes this codebase's decimal-comma rule.

**Context:** Reported from production use on 2026-08-06, as two complaints about one field. The place lookup asks Nominatim with `limit=1` and adopts `body[0]` unconditionally, so a search never presents alternatives — for an activity name rather than a street address it pins the best *name* match anywhere on earth, silently. And there is no coordinate input at all: `lat`/`lng` are only ever written from a geocoder response, so a typed pair is sent to Nominatim as a search string, does not resolve, and is reported as "no matching place".

The data model is not the obstacle. `locationInputSchema` already accepts and range-checks `{lat, lng, label}`, and the maps, print path and backup archive all carry arbitrary coordinates. The whole story is the way in — plus one genuine difficulty: on a German keyboard the decimal separator is a comma, which makes a comma-separated pair ambiguous. That is the same failure class Story 6.27 documents across five money fields, and the rule here must refuse ambiguity rather than guess at it.

**Acceptance Criteria:**

**Given** a coordinate pair typed or pasted into the place field
**When** the lookup is triggered
**Then** it is accepted and sets the location with no network request at all — a pin the geocoder was never consulted about

**Given** a Google Maps URL pasted into the place field
**When** the lookup is triggered
**Then** the pair is extracted from it, in both shapes real use produces; a URL carrying no pair is treated as an ordinary search term rather than as an error

**Given** a German keyboard, where `48,8584` is the natural spelling
**When** a pair is entered whose separators are genuinely ambiguous
**Then** it is refused with a message naming the accepted spelling — never resolved by guessing, which would reinstate the silently-wrong pin this story exists to remove

**Given** a pair that parses but lies outside ±90 or ±180
**When** it is entered
**Then** a visible error appears and no location is set

**Given** a place search that matches several candidates
**When** the results come back
**Then** they are offered as a choice and none is adopted until one is picked; a single candidate may be adopted directly and zero candidates keeps the existing message

**Given** the four surfaces that resolve a place — trip create (start and destination), activity dialog, accommodation dialog, bucket-list panel
**When** any of them is used
**Then** all behave identically, with the parsing living in exactly one module and no copy of it in a component


### Story 6.29: The Stay's Link on the Day Page

As a traveller looking at a single day,
I want the booking link of last night's and tonight's stay right there on the day page,
So that I can open a reservation without navigating back to the trip overview.

**FRs covered:** FR6

**Depends on:** nothing. The field is already loaded by the day view.

**Context:** A stay's booking link is reachable only from the trip overview, where the stay name in the day row is the anchor. The day detail page shows the same stay twice — last night's at the top, tonight's at the bottom — and offers the link on neither, so opening a booking means navigating back.

The data is already present: the day view's accommodation object carries `link`. This is a rendering story, with one finding attached. The link's validation is `z.string().url()`, which in Zod 4.4.3 validates URL *syntax* and not scheme — `javascript:alert(1)` and `data:text/html,…` are both accepted — and the trip overview places the stored value straight into `href` with no guard, while the day view's activity link one file over is guarded by `isSafeLink`. Adding two render sites without closing that would ship a third and fourth unguarded one, and Story 5.13 makes it matter more by letting contributors write to a trip they do not own.

**Acceptance Criteria:**

**Given** a day whose previous night or current night has a stay with a booking link
**When** the day page is opened
**Then** each stay card offers that link, and a stay without one shows nothing extra

**Given** a stay card, whose whole surface is the edit target since Story 6.13
**When** the link is clicked, by pointer or by keyboard
**Then** only the link opens — the edit dialog does not — and the link opens in a new tab with `rel="noreferrer noopener"`

**Given** a stored link whose scheme is neither `http:` nor `https:`
**When** any surface renders it
**Then** it is not rendered as a link anywhere, the trip overview row included, which is unguarded today

**Given** the stay edit form
**When** a link with an unsupported scheme is submitted
**Then** it is refused; rows stored before this change are left alone and are covered by the render guard instead

**Given** a viewer, who has no edit overlay on these cards
**When** they open either link
**Then** it works — the overlay escape hatch and the no-overlay case must both hold


### Story 6.30: One Decimal for a Distance, a Comma in the Box

As someone entering numbers in German,
I want a distance to refuse precision it cannot mean, and an amount to be shown the way I would write it,
So that the fields finish the job Story 6.27 started.

**FRs covered:** None (follow-up to a defect fix)

**Depends on:** Story 6.27, whose operator pass produced both items.

**Context:** Story 6.27's operator pass on a real German phone (2026-08-07) confirmed the fix against the database on all five fields. Two things it could not close came out of that pass.

The first was deferred by 6.27 for a human ruling and is now ruled: a **lone** three-digit group is read as a fraction in both spellings — `parseDecimal("1,000")` and `parseDecimal("1.000")` both return `1` — so "one thousand kilometres" silently becomes one kilometre however it is typed. Two separators are understood correctly, which keeps this narrow. Capping a distance at one decimal makes every ambiguous form refusable and turns a factor-of-1000 error into a visible question; 100 m resolution is beyond anything trip planning uses. This deliberately amends 6.27's intent contract, which currently requires `12,555` to parse as a distance.

The second nobody had noticed until a person used it: under German the cost field's placeholder renders `0,00` while the value beside it renders `120.50`. That is deliberate and documented — the edit value stays dot-decimal "because that is what an unedited round-trip must hand back" — but the reason is weaker after 6.27, which taught the parser to accept both. Nothing is at risk; it is a cosmetic inconsistency in the one story that exists because German number entry was broken.

**Acceptance Criteria:**

**Given** a distance field
**When** a value with more than one decimal is entered — `1,000`, `1.000`, `12,555`, `60,12345`
**Then** it is refused with a visible, blocking error that names the rule, while `60,5`, `1234,5` and `12000` are accepted

**Given** the shared decimal parser, whose documented contract is that whatever precision was typed survives
**When** the cap is applied
**Then** it is expressed as the distance field's rule and not hard-coded into the helper, so a future caller is not silently bound by it

**Given** a segment already storing more decimals than the new rule allows
**When** its dialog is opened and saved without touching the distance
**Then** it is unchanged — the cap governs input, not stored history

**Given** an account set to German
**When** an existing amount is loaded into a cost or payment field
**Then** it renders with a comma, agreeing with the placeholder and helper beside it; under English it renders with a period

**Given** any stored amount and either language
**When** it is formatted into the field and parsed back without an edit
**Then** the cent value is identical, and the dialog reports no unsaved changes


## Epic 7: Visual Redesign — Light Cockpit System

Users experience the approved `DESIGN.md`/`EXPERIENCE.md` visual system across every screen instead of the current inconsistent styling. Source of truth: `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md`, `EXPERIENCE.md`, and `mockups/*.html`. This epic re-skins existing, already-shipped screens — it does not add product capability, so no new FRs are introduced.

### Story 7.1: Design Token Foundation

As a developer,
I want the app's theme, global CSS, and shared primitives to use the approved design tokens,
So that every subsequent screen restyle draws from one consistent source instead of ad hoc values.

**FRs covered:** None (foundation for Epic 7; implements `DESIGN.md` tokens)

**Acceptance Criteria:**

**Given** `DESIGN.md`'s color, typography, spacing, radius, and elevation tokens
**When** `theme.ts` and `globals.css` are updated
**Then** the app's palette, font stack, spacing scale, and card/photo radius rules match `DESIGN.md` exactly, replacing the current orange/navy palette and stale `--forest-*`/`--terracotta-*` CSS variable names

**Given** `DESIGN.md`'s `button`/`input`/`select`/`tab`/`checkbox` component tokens (all `minHeight: 44px`)
**When** shared form primitives are updated
**Then** every interactive control meets the 44×44px touch-target floor, replacing the current sub-44px buttons/inputs

**Given** the old theme is replaced
**When** any screen not yet restyled by a later story in this epic renders
**Then** it does not visually break (falls back cleanly to the new base tokens, even if not yet pixel-matched to its specific mockup)

### Story 7.2: Trip Overview Redesign

As a trip planner,
I want the trip overview to match the approved design (photo hero, day-row list with per-day photo and mini coverage bar, simplified cost summary, gap alert),
So that the overview is visually consistent and the "what's set, what's open" signal is immediately visible.

**FRs covered:** FR6, FR9, FR22

**Acceptance Criteria:**

**Given** `mockups/trip-overview-day-detail.html` (Screen A) and `EXPERIENCE.md`'s Trip Overview component patterns
**When** the trip overview screen is rebuilt
**Then** it shows the photo-hero header (title/date over a scrim, no duplicated stats), day-row list with square center-cropped day photos and mini coverage bars, a simplified "Kosten bisher" summary, the trip map preview, and the gap-alert card

**Given** a day has no accommodation on record
**When** the day-row renders
**Then** it shows the warn-treatment gap badge and an enlarged gap segment in its mini coverage bar, per `EXPERIENCE.md`'s State Patterns

**Given** existing trip data (accommodations, day plans, costs)
**When** the redesigned overview renders
**Then** all existing functionality (open a day, edit trip, share trip, export/import) continues to work unchanged — this story is visual only

### Story 7.3: Day Detail Redesign

As a trip planner,
I want the day view to match the approved design (photo hero, full coverage bar, timeline with neutral activity markers and photo strips, day map, bucket list, simplified day cost),
So that a single day's plan is visually consistent with the rest of the app and clearly shows what's covered vs. open.

**FRs covered:** FR9, FR12, FR17, FR21

**Acceptance Criteria:**

**Given** `mockups/trip-overview-day-detail.html` (Screen B) and `EXPERIENCE.md`'s Day Detail component patterns
**When** the day view is rebuilt
**Then** it shows the day photo-hero, the full coverage bar (stay/activity/travel/gap segments in chronological order), the timeline (previous-night accommodation, activities, travel segments, current-night accommodation), the day map card, the bucket-list card, and the simplified "Kosten bisher · heute" cost card

**Given** a generic day-plan-item activity node
**When** the timeline renders
**Then** it shows the single neutral marker defined in `EXPERIENCE.md` — never a per-activity icon, since no activity-type field exists in the data model and none should be introduced to support this pattern

**Given** an accommodation or day-plan item has multiple uploaded photos
**When** its timeline card renders
**Then** the photos show as a uniform-size, left-aligned, square, center-cropped, sharp-cornered strip along the bottom of the card, per `DESIGN.md`'s photo-strip rule

**Given** existing day-view functionality (add/edit accommodation, add/edit day-plan item, travel segments, bucket-list add-to-day)
**When** the redesigned day view renders
**Then** all of it continues to work unchanged — this story is visual only

### Story 7.4: Trips List Redesign

As a trip planner,
I want the trips list to match the approved design (trip rows with photo, status pill, cost-so-far, a primary "Neue Reise" action),
So that my trips overview is consistent with the rest of the app and shows each trip's planning status at a glance.

**FRs covered:** FR5, FR6

**Acceptance Criteria:**

**Given** `mockups/trips-list-share-login.html` (Screen C) and `EXPERIENCE.md`'s Trips List component patterns
**When** the trips list screen is rebuilt
**Then** each trip renders as a `trip-row` with a square center-cropped trip photo, name, date range, a `trip-status` pill in one of its four states (gap/fully-planned/upcoming/past), and a cost-so-far figure

**Given** a trip has no accommodation gaps and is fully within its planned range
**When** its row renders
**Then** it shows the "Vollständig geplant" state, not the gap state

**Given** a past/completed trip
**When** its row renders
**Then** it renders at reduced opacity as a read-only archival row, per `DESIGN.md`'s `trip-row` spec

### Story 7.5: Share Dialog Redesign

As a trip owner,
I want the "Reise teilen" dialog to match the approved design system instead of default Material UI styling,
So that sharing feels like part of the same product as the rest of the redesigned app.

**FRs covered:** FR22, FR28

**Acceptance Criteria:**

**Given** `mockups/trips-list-share-login.html` (Screen D) and `EXPERIENCE.md`'s Share Dialog component patterns
**When** the share dialog is rebuilt
**Then** it uses the established card/border/input conventions, and each collaborator's role (Contributor/Viewer/Owner) renders as a badge using the token-defined role colors

**Given** I remove a collaborator
**When** I use the "Entfernen" action
**Then** it is sized to the 44×44px touch-target floor, not a bare unpadded text link

**Given** the existing share/invite/role-change functionality
**When** the dialog is redesigned
**Then** all of it continues to work unchanged — this story is visual only

### Story 7.6: Login, Register, and Password Reset Redesign

As a user,
I want the login, registration, and password-reset screens to match the approved design system,
So that the first impression of the app is consistent with the rest of the redesigned product.

**FRs covered:** FR1, FR2, FR29

**Acceptance Criteria:**

**Given** `mockups/trips-list-share-login.html` (Screen E) and `mockups/forms-authoring.html` (Screen H) and `EXPERIENCE.md`'s corresponding component patterns
**When** login, register, and password-reset screens are rebuilt
**Then** each uses the hero-photo side-panel treatment and the shared form-primitive tokens (44px inputs/buttons, default/focus/error states)

**Given** the existing auth functionality (login, register, request reset, set new password)
**When** these screens are redesigned
**Then** all of it continues to work unchanged — this story is visual only

### Story 7.7: Trip-Create and Add-Entry Dialog Redesign

As a trip planner,
I want the "Reise erstellen" and "Eintrag hinzufügen" dialogs to match the approved design system,
So that creating trips and adding accommodations/day-plan items feels consistent with the rest of the redesigned app.

**FRs covered:** FR4, FR12, FR17

**Acceptance Criteria:**

**Given** `mockups/forms-authoring.html` (Screens F, G) and `EXPERIENCE.md`'s corresponding component patterns
**When** the trip-create dialog and the add-accommodation/add-day-item dialog are rebuilt
**Then** each uses the shared form-primitive tokens, and the add-entry dialog's photo upload area follows the same square/sharp-cornered photo-strip pattern used elsewhere

**Given** the existing create-trip and add-entry functionality
**When** these dialogs are redesigned
**Then** all of it continues to work unchanged — this story is visual only

### Story 7.8: Trip Overview Lower Sections — Bucket List, Trip Controls, and Import/Export Removal

As a trip planner,
I want the bucket list and the trip controls at the bottom of the trip overview to match the approved design, and the JSON import/export buttons removed from that page,
So that the overview reads as one consistent surface end-to-end instead of trailing off into two pre-redesign cards and two developer-facing actions.

**FRs covered:** FR7, FR8, FR30, FR31 (import/export UI removal affects FR25 and FR34 — see note below)

**Context:** Story 7.2 redesigned the upper trip overview but left the two bottom blocks untouched — `TripBucketListPanel.tsx` and the inline trip-controls `Paper` at `TripTimeline.tsx:843-871`. These are the only two blocks in the page's render tree that never reference `theme.palette.tokens`; both still use `background: "#ffffff"` with `borderRadius: 3` (24px) against the 8px token card idiom used everywhere else. Story 7.2's AC3 asserted export/import "continues to work unchanged" — this story deliberately supersedes that clause for the UI layer only.

**Acceptance Criteria:**

**Given** the trip-overview bucket-list panel and the `bucket-list` / `bucket-item` / `bucket-add` patterns already implemented for Day Detail in Story 7.3 (`TripDayBucketListPanel.tsx`)
**When** `TripBucketListPanel.tsx` is restyled
**Then** it uses the same `card` shell, `card-label` title, `bucket-item` rows with `:last-child` divider suppression, and a 24px circular add affordance inside a ≥44×44px hit area — reusing the established pattern rather than introducing a second visual treatment for the same feature
**And** the non-palette surface color `#f7f9fc`, the raw `borderColor: "divider"`, and the `warning.main`-colored add button are all replaced with token values (`tokens.cardAlt`, `tokens.border`, `tokens.accent`) — warn is reserved exclusively for gap/open-item states per `DESIGN.md`
**And** its inline `SvgIcon` paths are replaced with the shared stroke icons from `TripIcons.tsx`

**Given** the trip-controls block at the bottom of the trip overview
**When** it is restyled
**Then** its container uses the token card treatment (`tokens.card`, `tokens.borderStrong`, 8px radius) instead of hardcoded `#ffffff` / `borderRadius: 3`
**And** "Reise löschen" uses the existing secondary button variant paired with its confirmation dialog, not MUI's default `color="error"` red (`#d32f2f`) — the palette defines no `error` entry, and `DESIGN.md` defines no destructive variant, so no new color is introduced by this story

**Given** the "Import JSON" and "Export JSON" buttons currently rendered in that same controls block
**When** the trip overview renders
**Then** neither button is present anywhere in the UI
**And** the underlying export/import API routes, dialogs, and logic remain intact and functional — this is a UI-entry-point removal, not a feature removal

**Given** a viewer or contributor opens a trip
**When** the redesigned controls block renders
**Then** the pre-existing defect where an ungated "Export JSON" button produced an owner-only 404 error is resolved by the button's removal
**And** `test/tripTimelineRoles.test.tsx` is updated to assert the absence of both import and export controls for every role, closing the gap where Export visibility was never asserted

**Given** existing bucket-list functionality (add, edit, delete, add-to-day-plan) and trip controls (edit, delete)
**When** the redesigned sections render
**Then** all of it continues to work unchanged, including owner/contributor/viewer gating — apart from the import/export removal, this story is visual only

### Story 7.9: Full-Page Map Screens Redesign — Day Route Map and Trip Route Map

As a trip planner,
I want the two full-page map screens — the day route map and the whole-trip route map — to match the approved design,
So that enlarging a map keeps me inside the same product instead of dropping me onto a dark, pre-redesign screen.

**FRs covered:** FR26 (the day-map screen traces to Story 3.5/2.28 and carries no dedicated FR of its own)

**Context:** These are the last two unredesigned screens in the app. Neither has a mockup — `DESIGN.md`'s source-mockup list covers Screens A–H only, and `EXPERIENCE.md`'s Information Architecture states the day map is "an embedded panel inside Day Detail's sidebar, **not** a separate surface or route", because both full-map routes (Stories 2.28 and 3.6) predate the design pass. This story therefore derives both screens from patterns already shipped — the `card` shell, the `label-caps` card-label, the token page shell, and the redesigned preview panels (`TripDayMapPanel.tsx`, `TripOverviewMapPanel.tsx`) that these screens are the enlargement of — and introduces no new visual language. The two screens are one story rather than two because they share `TripDayMapBackButton.tsx`, whose hardcoded light text (`#f3f6fb`) is readable only against the hardcoded dark page shell; restyling either screen alone leaves the other with invisible back-navigation.

**Acceptance Criteria:**

**Given** both map pages hardcode `backgroundColor: "#2f343d"` — a dark slate absent from the token palette, so enlarging a map inverts the app's entire value scheme mid-flow
**When** each page shell is restyled
**Then** both use the same token page shell as the screen they were opened from (`trips/[id]/page.tsx` and `trips/[id]/days/[dayId]/page.tsx`), and no hardcoded hex value remains in either page component

**Given** `TripDayMapBackButton.tsx` is shared by both pages and hardcodes `color: "#f3f6fb"` on a bare unpadded text `Button`
**When** it is restyled
**Then** it uses token colors and meets the 44×44px touch-target floor, and continues to preserve its existing `history.length` back-vs-push behavior
**And** the day-map page's label is corrected: it currently renders `trips.dayView.back` ("← Back to trip") while actually navigating to the day, not the trip — the copy must name where the button goes

**Given** each screen wraps its map in `Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}`, a 24px-radius elevated surface against the 8px flat-bordered `card` idiom used everywhere else
**When** each is restyled
**Then** the container matches the `card` treatment (`tokens.card`, `tokens.borderStrong`, 8px radius, `card-padding`) using a `Box` rather than a `Paper`, per the `MuiPaper` border-override constraint established in Stories 7.3 and 7.8
**And** the map title moves from `Typography variant="h6"` to the `label-caps` card-label in `tokens.inkSoft` — each screen renders the same i18n string as the preview panel it enlarges (`trips.dayView.mapTitle`, `trips.overviewMap.title`), so the two must not render it in two different type styles

**Given** the missing-location list, the routing-unavailable notice, and the no-locations empty state on each screen
**When** they are restyled
**Then** each matches the treatment already shipped in its corresponding preview panel rather than introducing a second one, and the raw `borderColor: "divider"` in the empty state is replaced with `tokens.border`

**Given** the marker-detail dialog and the fullscreen photo viewer rendered by both screens
**When** the screens are redesigned
**Then** they are left to inherit Story 7.1's theme-level `MuiDialog` overrides and are **not** restyled here — dialog surfaces belong to Story 7.7, and the `MiniImageStrip` keyboard-access defect recorded in `deferred-work.md` stays deferred rather than being folded into a visual story

**Given** existing functionality on both screens (route polyline with Google-routing fallback, clickable place markers, missing-location reporting, accommodation and plan-item image loading)
**When** the screens are redesigned
**Then** all of it continues to work unchanged — this story is visual only

### Story 7.11: Design Token Reconciliation — Contrast, Focus, and Literal Cleanup

As a developer and as a keyboard or low-vision user,
I want the design tokens established in Story 7.1 to be the single source of truth for color, contrast, and focus across every screen,
So that retheming does not require editing component bodies, and so that the accessibility floor `EXPERIENCE.md` promises is actually met.

**FRs covered:** None (completes Story 7.1's token foundation; closes 7 deferred-work entries from Stories 7.2–7.6)

**Context:** Story 7.1 established the token foundation. Stories 7.2 through 7.6 each encountered a case whose correct fix lived in `theme.ts`, and each was scoped to exclude it — deliberately, to stop visual stories from becoming system-wide changes. Seven deferred-work entries resulted, each deferring to a "standing design-token reconciliation pass." This is that pass. It is the last story in Epic 7 because it needs every screen's literals visible before it can decide which are tokens; it therefore runs after 7.9.

Two of its criteria were design-system decisions rather than implementation choices. Both were settled by Tommy on 2026-08-01 and are written below as decided requirements: the gap background gains a second token rather than collapsing to one value, and the past-row archival treatment moves off the text. Note that this story's scope was measured against the code as of 2026-08-01, when several literals named in the original deferred-work entries had already been consolidated into `TripIcons.tsx` by Stories 7.4 and 7.6 — `DAY_ROW_GAP_BG` no longer exists, and `HERO_SCRIM` is now one shared export serving four components rather than a per-file literal.

**Acceptance Criteria:**

**Given** `DESIGN.md` contradicts itself on the gap-row background — `day-row.bg-gap` (`:104`) resolves to `{colors.warn-bg}` `#F6ECE0` while `trip-row.bg-gap` (`:152`) hardcodes `#FBF6EE`, and both mockups paint both rows `#FBF6EE` (`trip-overview-day-detail.html:322`, `trips-list-share-login.html:173`) while reserving `#F6ECE0` for pills, badges, error inputs and coverage segments
**When** the design system is corrected to match the mockups
**Then** `theme.ts` and `DESIGN.md` gain a distinct token for the whole-row gap fill (`#FBF6EE`), leaving `warn-bg` `#F6ECE0` to the small-element treatments it already serves, and both `day-row.bg-gap` and `trip-row.bg-gap` reference it
**And** `#F1ECE1` — used consistently across all three mockups for the `upcoming` and `past` status pills but absent from `DESIGN.md` entirely — gains a token of its own
**And** `ROW_GAP_BG` (`TripIcons.tsx:230`) and `NEUTRAL_PILL_BG` (`TripIcons.tsx:239`) are replaced by those token references, so that no background color is exported from an icon module
**And** the rendered result is pixel-identical to today — this criterion corrects the specification to describe the shipped design, it does not restyle anything

**Given** `tokens.inkMuted` is `#8A8677`, which measures 3.65:1 against `tokens.card` `#FFFFFF` and is rendered at 10px on the Day Detail coverage axis
**When** the token is corrected
**Then** it meets the 4.5:1 WCAG AA floor for normal text at every size it is used, and the change is applied at the token level rather than per screen

**Given** `DESIGN.md:153` prescribes `trip-row.opacity-past: 0.78` as the *entire* archival treatment, and both affected elements pass AA at full opacity but fail under that multiplier — the 12px `inkSoft` sub-line drops from 5.65:1 to roughly 3.5:1, and the 11.5px bold "Completed" pill on `#F1ECE1` from 4.79:1 to roughly 3.3:1
**When** the archival treatment is applied at `TripsDashboard.tsx:454`
**Then** the opacity is confined to the trip photo and the row border, and the row's text and status pill render at full opacity, so both clear the 4.5:1 floor without any color changing
**And** `DESIGN.md`'s `trip-row` entry records this split — opacity carries the archival signal through the 96px photo, which is the row's visual mass — so the treatment is defined once and no future surface re-derives it
**And** `tokens.inkSoft` is left unchanged: darkening it to survive a 0.78 multiplier would repaint every secondary-text surface in the app to fix an artifact on one row

**Given** `theme.ts` replaces the entire MUI `shadows` array with `"none"` except index 24, and MUI's contained-button focus indicator is `shadows[6]`
**When** the focus treatment is added
**Then** every `variant="contained"` button in the app shows a visible keyboard focus indicator via an explicit `MuiButton` `&.Mui-focusVisible` treatment, satisfying `EXPERIENCE.md`'s Accessibility Floor
**And** the auth-local workaround `src/components/features/auth/authSubmitSx.ts` (`AUTH_SUBMIT_SX`) is deleted rather than left as a second source of truth

**Given** `theme.ts` defines `primary`, `secondary` and `warning` but no `error` palette entry, so `<Alert severity="error">` renders MUI's default `#d32f2f` and `severity="success"` its default green — two colors absent from the token set
**When** the palette gains an `error` entry
**Then** it uses the existing `colors.errorBorder` `#C97A3E` already used for input error borders, and an `MuiAlert` treatment applies it, so alerts in every dialog draw from tokens
**And** no component-local `sx` override is introduced to achieve this

**Given** `TripIcons.tsx`'s `IconProps` (`:12`) types `sx` as bare `object`, so a style-key typo passes the compiler at every call site
**When** the type is tightened
**Then** it uses `SxProps<Theme>`, covering all 13 icons in the module rather than only the four the original finding named
**And** no glyph is moved: the extraction half of that finding — `HouseIcon`, `WarningTriangleIcon`, `ChevronRightIcon` and `ShareGlyphIcon` out of `TripTimeline.tsx` — was already completed incidentally by Stories 7.4 through 7.7, and all four now live in `TripIcons.tsx` with `TripTimeline` importing them

**Given** the seven deferred-work entries this story closes
**When** the story's spec is written
**Then** its frontmatter declares `closes_deferred:` with their DW ids, so the ledger is annotated at commit rather than left stale

**Note:** the `closes_deferred` declaration requires the deferred-work ledger to have been migrated to the canonical `DW-<n>` format first. If the migration has not run when this story is specced, the final criterion is dropped and the entries are closed by a later sweep instead.

### Story 7.12: Bucket List as a Trip Overview Sidebar Card

As a trip planner,
I want the trip-level bucket list to sit in the trip overview's sidebar alongside the cost and route cards,
So that my collected ideas read as one of the overview's reference panels instead of a full-width block trailing off the bottom of the page.

**FRs covered:** FR30, FR31 (placement only — no bucket-list capability changes)

**Context:** The trip overview's layout is `1.7fr 1fr` (`TripTimeline.tsx:459`), matching the mockup's `.layout`. The sidebar holds "Kosten bisher" and "Route"; the bucket list renders *outside* that grid at `:785`, spanning the full page width beneath it.

That placement is not a design decision — it is a gap. The bucket list appears in **no Screen A mockup at all**: `mockups/trip-overview-day-detail.html` gives Screen A exactly two `side-col` cards, and shows the bucket list only in Screen B's sidebar (`:1070`). `EXPERIENCE.md:39` records why the Day Detail cards exist at all — the bucket list and day map "correspond to real, already-existing product features … that were **simply missing from earlier mockups in this pass** and were added back as sidebar cards using existing card conventions." The identical reasoning was never applied to Screen A. Story 7.8 restyled the panel where it stood, exactly as its scope prescribed, and left placement untouched.

This story finishes that job. It also settles the open `[ASSUMPTION]` at `EXPERIENCE.md:81`, which proposed an empty-state treatment for the bucket-list card and asked for confirmation in a later review pass — Tommy confirmed it on 2026-08-01 with one added constraint: the empty card must stay compact.

**Acceptance Criteria:**

**Given** `TripBucketListPanel` renders outside the overview's layout grid at `TripTimeline.tsx:785`
**When** it is relocated
**Then** it renders inside the side column as the third card, below `TripOverviewMapPanel`, using the same `card` shell the other two sidebar cards use
**And** its owner-only gating is preserved exactly — a viewer and a contributor see no bucket-list card, as today

**Given** a trip-level bucket list can hold far more ideas than the four a Day Detail card shows
**When** the card is expanded
**Then** it grows with its content up to approximately 5–6 rows, after which it holds a fixed maximum height and scrolls internally — expressed as a `max-height` derived from the row metric, not a magic pixel value
**And** the scroll container is keyboard-reachable and does not trap focus

**Given** a trip with no bucket-list items
**When** the card renders
**Then** it stays compact — the existing `trips.bucketList.empty` line inside the card shell, with no minimum height, no filler, and no illustration
**And** `EXPERIENCE.md:81`'s `[ASSUMPTION]` marker is replaced by the confirmed treatment, including this compactness constraint

**Given** the overview collapses to a single column below `md` (`TripTimeline.tsx:459`)
**When** the page renders at `xs`/`sm`
**Then** the bucket list keeps a sensible stacked position relative to the cost and route cards, and the max-height rule does not produce a scroll region inside an already-scrolling page

**Given** the existing bucket-list functionality (collapse/expand, add, edit, delete, add-to-day-plan) and Story 4.4's collapsed-by-default behavior with its count line
**When** the card is relocated
**Then** all of it continues to work unchanged — this story moves and bounds a panel, it does not change what the panel does

**Given** `EXPERIENCE.md`'s Information Architecture lists Screen A's sidebar contents
**When** this story lands
**Then** it records the bucket list as Screen A's third sidebar card, so the next reader does not rediscover the gap

### Story 7.13: Cost Overview Redesign — Per-Day and Per-Month Lists

As a trip planner checking what a trip costs,
I want the cost overview to match the rest of the redesigned app,
So that opening it from the trip overview does not drop me onto a screen from before the redesign.

**FRs covered:** FR19, FR20, FR32 (cost roll-up and payment schedule — presentation only)

**Context:** `/trips/{id}/costs` is reached by clicking the trip's cost figure on the trip overview (`TripTimeline.tsx:420`). It renders `TripCostOverview.tsx` — 519 lines carrying **zero** `tokens.` references. Three `Paper elevation={1}` wrappers (loading `:323`, not-found `:336`, main `:355`) each hardcode `borderRadius: 3` (24px) and `background: "#ffffff"`; headings are `Typography variant="h6" fontWeight={600}`; the per-month groups are nested `Paper variant="outlined"` at `borderRadius: 2`.

Story 7.9's context claimed the two full-page map screens were *"the last two unredesigned screens in the app."* That was wrong — this one was missed by the whole pass, and Tommy found it in production use. Like the map screens, it appears in **no mockup**: `DESIGN.md`'s source list covers Screens A–H and none of them is a cost surface. So this story derives its treatment from patterns already shipped rather than inventing one, exactly as 7.9 did.

It also closes DW-27, whose own text names this file and assigns the fix to "the screen that owns the cost route".

**Acceptance Criteria:**

**Given** three `Paper elevation={1}` wrappers with `borderRadius: 3` and a hardcoded `#ffffff` fill
**When** each is restyled
**Then** all three use the token `card` treatment — `tokens.card`, `1px solid tokens.borderStrong`, 8px radius, `card-padding` — on a `Box` rather than a `Paper`, per the `MuiPaper` border-override constraint Stories 7.3, 7.8 and 7.9 each had to work around
**And** no hex literal remains anywhere in the component

**Given** the page shell around it
**When** the screen renders
**Then** it uses the same token page shell as the trip overview it was opened from, so the value scheme does not shift mid-flow

**Given** section titles render as `Typography variant="h6" fontWeight={600}`
**When** they are restyled
**Then** they use the `label-caps` card-label in `tokens.inkSoft`, matching every other card label in the app
**And** the document outline descends without skipping, following the rule 7.3's review set — card labels are the page title's level plus one

**Given** the per-day list with its `Tag` / `Kostenpositionen` / `Tagessumme` columns
**When** it is restyled
**Then** it adopts the row rhythm and `:last-child` divider suppression already shipped for day rows and cost lists, and its figures use tabular numerals as the trip overview's cost summary does

**Given** the per-month payment groups, each a nested `Paper variant="outlined"` at `borderRadius: 2`
**When** they are restyled
**Then** they read as a nested group inside the card rather than as a second card — no elevation, no competing radius — and the raw `borderColor: "divider"` is replaced with `tokens.border`

**Given** `TripCostOverview.tsx` is the third copy of `formatCost` and the only one still emitting a bare number wrapped in the `trips.stay.costSummary` "Cost: {value}" template, so the same amount reads "€160.00" on Day Detail and "Cost: 160.00" here (DW-27)
**When** the formatter is converged
**Then** this screen uses the currency-aware formatter the other two screens use, and `test/tripCostOverview.test.tsx:137`, which pins the old form, is updated
**And** the residual half of DW-27 — all three copies hardcoding EUR with no trip-level currency field — is recorded as its own ledger entry rather than silently carried, since a currency field is a data-model change this story does not make

**Given** the loading skeleton, the not-found branch, the error alert and the two empty states (`trips.costOverview.empty`, `emptyDay`, `emptyMonths`)
**When** the screen is restyled
**Then** each matches the treatment already shipped on the screens this one is reached from, rather than introducing a second one

**Given** every existing behaviour — the cost roll-up, the day grouping, the month grouping, the back link and the trip total
**When** the screen is redesigned
**Then** all of it works unchanged: this story is visual only

## Epic 8: Maintenance & Infrastructure

The maintainer can keep the runtime, toolchain, and accumulated technical debt current without threading infrastructure work through feature or redesign epics. This epic is the standing home for work that is neither a feature nor a redesign — runtime and toolchain upgrades, and the deferred-work bundles that earn a story number after a `bmad-loop sweep` has verified them against the code.

### Story 8.2: `middleware.ts` Becomes `proxy.ts`

As the operator of this installation,
I want the deprecated `middleware` file convention replaced by `proxy`,
So that the warning on every server start stops being noise.

**Given** Next 16 deprecating the `middleware` file convention
**When** the file becomes `src/proxy.ts` and its export becomes `proxy`
**Then** the warning stops and `config.matcher` carries over unchanged — the same parser serves both conventions

**Given** the matcher entry `/api/trips/:path((?!import/?$).*)`
**When** the file moves
**Then** it survives character for character: the `/?` is what keeps both `/api/trips/import` and `/api/trips/import/` out, and `middleware.test.ts` pins both


### Story 8.1: Node 24 LTS Runtime Upgrade — CI, Local, and Server

As the maintainer of TravelPlan,
I want CI, my development machine, and the deployment server moved from end-of-life Node 20 to Node 24 LTS in one coordinated change,
So that the runtime under the app keeps receiving security patches — a gap the 0-vulnerability `npm audit` gate is structurally unable to see.

**FRs covered:** None (infrastructure; closes a security exposure the CI gate cannot detect)

**Context:** Node 20 reached end-of-life around Apr 2026 and no longer receives security patches, but `npm audit` scans *packages* and not the runtime beneath them — so the 0-vulnerability gate added in `a27f8f5` reports green while sitting on an unpatched runtime. Compatibility was verified statically at baseline `b18997c`: of 405 `engines.node` declarations in the installed tree, **zero** are incompatible with Node 24 (Node 20 has one — `@prisma/streams-local@0.1.11` requires `>=22.0.0`), and `better-sqlite3@12.6.2` publishes `node-v137` ABI prebuilds for both `linux-x64` and `darwin-arm64`. Node 24 rather than 22 because 22 left Active LTS in Oct 2025 and would need repeating in spring 2027. A bump landed while Epic 7 is still in flight would put a variable underneath in-flight UI work, which is why this waits for Epic 7 to complete — originally expressed as a dependency on Story 7.9, now on Story 7.11, Epic 7's last story. Separate from and downstream of `b18997c`, which fixed the audit gate's `npm ci` failure and cleared the GitHub Actions node20 action-runtime deprecation without changing `node-version`.

**Acceptance Criteria:**

**Given** both workflow files pin `node-version: 20`
**When** the upgrade lands
**Then** `.github/workflows/security-audit.yml` and `.github/workflows/migration-guard.yml` both specify `node-version: 24` and both pass on `main`
**And** the `--ignore-scripts` flag on the audit job's `npm ci` is left in place — it is unrelated to the Node version and exists because `postinstall` → `prisma generate` needs a `DATABASE_URL` that CI does not have

**Given** the test suite and `next build` both succeed on Node 20 at baseline
**When** each is run on Node 24 against a `node_modules` tree reinstalled from the lockfile
**Then** the suite passes with the same test count and the build succeeds, including the `prisma generate` postinstall hook and Next.js 16 SWC binary resolution

**Given** `better-sqlite3` is a native module compiled against Node's ABI
**When** dependencies are installed on Node 24 on both `darwin-arm64` and `linux-x64`
**Then** the prebuilt binary is downloaded rather than compiled from source, and SQLite-backed Prisma queries work at runtime — verified by loading a trip and a day view, not by a successful install alone

**Given** the deployment server also hosts a second application that runs on Node 20
**When** TravelPlan is moved to Node 24
**Then** Node 24 is installed alongside Node 20 and only TravelPlan's service is repointed at it, the system-wide default `node` is unchanged, and the second application continues running

**Given** `docs/deployment-guide.md` and `docs/deployment-configuration.md` are both 9-line TBD placeholders, and no `Dockerfile`, `docker-compose`, `.nvmrc`, or `.node-version` exists anywhere in the repo
**When** the server work requires discovering the actual process manager, service names, and install paths
**Then** both documents are filled in with what was found, including which application runs on which Node version — this is the first task in the project's history that requires knowing any of it


### Story 8.3: Uploaded Media Behind the Login

As a trip owner,
I want every uploaded photo and document to be reachable only by someone signed in with access to that trip,
So that content I hold no rights to is not published to anyone who learns a URL, and so that NFR2 is true of media and not only of database rows.

**FRs covered:** None (closes an existing NFR2 gap on already-shipped behaviour)

**Context:** Every upload route writes beneath `public/`, which Next.js serves statically ahead of any route handler and without consulting the session. NFR2 has always required authenticated access to all trip data; uploaded media is trip data, so the requirement has been unmet for media since Story 2.11 shipped the first hero image. The driver is rights rather than secrecy: trip photos are frequently not the owner's to publish. Documents (Epic 9) make it acute, which is why this story comes first — building Epic 9 on the public path means moving the same files and writing the same route afterwards.

The change is cheaper than it looks, and for a reason worth stating: every stored URL is `/uploads/trips/<tripId>/…` with `tripId` always the third segment, and `getPublicRoot()` (`uploadPaths.ts:19`) is already the single source of truth for the write path. A catch-all route handler can therefore authorise and serve every existing file with no URL change, no data migration, and no component change. The access predicates exist — `requireSession` plus `hasTripReadAccess`, which admits owners, viewers and contributors alike.

**Acceptance Criteria:**

**Given** uploaded files live under `public/uploads/trips/` and are served statically
**When** the move lands
**Then** they live under a root outside the statically served tree, `public/uploads/` no longer exists, and a test asserts its **absence** rather than merely that nothing writes to it — a file left behind stays publicly readable no matter what the code does
**And** `public/images/`, `public/hero-mountains.jpg` and the SVGs are untouched, because they are application assets and not trip data

**Given** a request for `/uploads/trips/<tripId>/…`
**When** it is served by the new route handler
**Then** an unauthenticated request is refused, a signed-in user with no access to that trip is refused, and the owner, a viewer and a contributor each succeed — the same three-way check `hasTripReadAccess` already encodes
**And** no stored URL anywhere in the database or in any component changes

**Given** the path segment arrives from the URL
**When** it is resolved to a file
**Then** a traversal attempt (`..`, an encoded separator, an absolute-looking segment) cannot escape the uploads root, and the resolution is asserted against those inputs rather than trusted to `path.join`

**Given** a browser PDF viewer requests a byte range
**When** the route answers
**Then** it serves `206` with the requested range, and a real multi-page PDF opens inline — a route that always answers `200` with the whole file makes some viewers refuse to open it at all

**Given** the files are no longer public
**When** the response headers are written
**Then** `Cache-Control` is `private`, the ETag and conditional-request behaviour are unchanged, `Content-Type` is derived from the stored extension only, and `X-Content-Type-Options: nosniff` is set — serving user bytes from our own origin is what makes sniffing a same-origin concern

**Given** `UPLOADS_PUBLIC_ROOT` is the env var the test setup uses to redirect writes away from real files
**When** the root is no longer public
**Then** the variable is renamed to match what it now means, all four image-route suites and the test setup follow, and the protection it exists for — that no test can reach the operator's real uploads — is re-verified rather than assumed

**Given** export and import reach files through the `uploadPaths.ts` helpers
**When** the root moves
**Then** both continue to work with no change of their own, verified by a round trip rather than by inspection

**Given** the uploads directory now sits outside the deployed application tree
**When** the deployment docs are updated
**Then** `docs/deployment-guide.md` and `docs/deployment-configuration.md` record where it lives, that the service user must be able to write to it, and that it must survive a redeploy — a media root inside the build output would be silently emptied on deploy

**Given** the printed day plan renders `<img>` tags against these URLs
**When** a day is printed after the move
**Then** the images still appear, because the browser sends the session cookie on a same-origin request — verified on screen, not reasoned about


## Epic 9: Travel Documents

Users can keep tickets and booking confirmations as the original files on the stay or activity they belong to, see and open them from the day timeline, and take them offline as one PDF.

### Story 9.1: Documents on Stays and Activities

As a trip planner,
I want to attach the original ticket or booking confirmation to the accommodation or activity it belongs to,
So that I keep the multi-page, legible, forwardable file instead of a screenshot of its first screen.

**FRs covered:** FR38, FR39

**Depends on:** Story 8.3. Documents carry names, addresses and booking codes; they must not land in a publicly served directory even briefly.

**Context:** Photos already attach to both entry types (Stories 2.16, 6.6). Documents are the same gesture with a different payload and one genuinely different display problem: a document has no thumbnail, so the card element is a labelled chip rather than a square — see `DESIGN.md`'s `doc-chip`. Both dialogs already have a `Medien & Links` tab (Stories 6.22, 6.26); documents go there, not into a fifth tab.

PDF **and** image files are accepted, because the distinction between a photograph and a document is semantic rather than technical — a ticket screenshot is a document. The user places the file; the app does not guess from the MIME type.

**Acceptance Criteria:**

**Given** an accommodation and a day plan item
**When** the schema gains documents
**Then** `AccommodationDocument` and `DayPlanItemDocument` exist with the same shape and cascade behaviour as their image counterparts (`schema.prisma:239-267`), including the `(parentId, sortOrder)` uniqueness that keeps ordering total, and a migration is added

**Given** the `Medien & Links` tab of each dialog
**When** documents are added
**Then** the tab carries a document field **visibly distinct in label from the photo field**, so a JPEG's destination is the user's choice and not a guess, and a file placed in one bucket never appears in the other
**And** up to 10 documents per entry are accepted, each up to 10 MB — larger than the 5 MB photo limit because a ticket PDF carrying a map exceeds it

**Given** a picked file
**When** it is validated
**Then** PDF and the image types the photo fields already accept are allowed, the client-side gate mirrors the server's list the way `isSupportedImageUpload` already mirrors it (`imageUploads.ts:25`), and the upload route remains the authoritative check

**Given** an entry with documents
**When** its `tl-card` renders in the day timeline
**Then** `doc-chip`s appear per `DESIGN.md`: trailing on the media row beside the photo strip where the width allows at least two, wrapping to their own row below the photos where it does not, each labelled with the document's file name minus its extension and ellipsised
**And** the wrap threshold is **measured at 390px and at desktop width**, not chosen as a breakpoint — the arithmetic that motivates it (≈180px of photo strip against ≈150px of remaining row) is the reason it exists

**Given** more documents than the row shows
**When** the overflow control is used
**Then** it is the same `+N` affordance the photo strip uses, and it opens a list of document names rather than a viewer, each entry openable

**Given** a document chip or list entry
**When** it is activated
**Then** the document opens in a new tab — including image documents, which do not enter `FullscreenPhotoViewer`

**Given** a document attached to an entry
**When** it is deleted from the dialog
**Then** the row and the file on disk both go, matching how image deletion already behaves, and the dialog's dirty/discard semantics (Story 6.25) treat a staged-but-unsaved document the way it treats a staged photo

**Given** the v2 backup archive carries `trip.json` plus the uploaded photo files (Stories 2.31, 2.32)
**When** a trip with documents is exported and re-imported
**Then** the documents come back attached to the same entries with the same names and order — a backup mechanism that silently drops a class of files is worse than one that refuses to run

**Given** every user-facing string
**When** the feature lands
**Then** both dictionaries carry it under a `trips.documents.*` namespace, and `i18nDictionaries.test.ts` holds the two in agreement as it does for every other namespace

### Story 9.2: Documents in Print and an Offline Packet

As a traveller standing at a gate with no signal,
I want the day's tickets available as files I already have on my device,
So that the plan and the documents that make it usable are both offline.

**FRs covered:** FR40

**Depends on:** Story 9.1.

**Context:** The printed day plan is `window.print()` over an HTML page (`TripDayPrintPage.tsx:60`), and there is no PDF library in the project. Image documents can be appended to that output as full pages. **PDF documents cannot** — an embedded PDF in an `<iframe>` or `<embed>` is not rendered into print output by any browser, and tickets are the case this story exists for.

Two approaches were rejected. Rendering the whole day plan server-side through headless Chrome would produce one file, at the cost of a browser in the deployment for one feature. Listing documents by name only and leaving the user to print them is honest but is not an offline packet. So the day plan keeps printing as HTML, and the documents are merged server-side into their own PDF via `pdf-lib`. Two files offline, each doing its job, no rendering engine.

**Acceptance Criteria:**

**Given** a day whose entries carry image documents
**When** the day plan is printed
**Then** each image document appends as its own full page after the plan, page-broken, oriented so a portrait ticket is not printed sideways

**Given** a day whose entries carry PDF documents
**When** the day plan is printed
**Then** an appendix lists them by name and by the entry they belong to, and states plainly that they are not included in this output — a silent omission on an offline artefact is the failure mode that matters here

**Given** a day with documents of both kinds
**When** the document packet is requested
**Then** one PDF is returned containing every document of that day in timeline order: PDFs page-for-page, images embedded as pages, each preceded by or labelled with the entry name and the document name so the packet is navigable without the app

**Given** the packet route serves file contents
**When** it is called
**Then** it enforces the same access check as Story 8.3's serving route, and a day with no documents yields a clear refusal rather than an empty PDF

**Given** `pdf-lib` is a new dependency
**When** it is added
**Then** it is a runtime dependency of the server only, the 0-vulnerability audit gate stays green, and a real multi-page ticket PDF plus a portrait phone photo are both verified in the merged output — page count, orientation, and legibility, on screen
