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
FR24: Viewers can add comments/suggestions to days or items.
FR25: Users can export or back up trip data for recovery.
FR34: Users can restore/import trip data from a backup.
FR26: Maps integration for overall trip visualization and day-plan mapping.
FR27: Ability to start a trip plan using Google (start + destination).
FR28: Owners can grant a contributor role with full edit permissions.
FR29: Users can reset their password via email.
FR30: Users can add, view, and delete trip-level bucket list items for unplanned places.
FR31: Users can add a bucket list item to a day plan and remove it from the bucket list.

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
FR24: Epic 5 - Sharing & Light Contribution
FR25: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR34: Epic 2 - Core Trip Planning (Days, Stays, Plans, Budget, Export)
FR26: Epic 3 - Route & Map-Based Planning
FR27: Epic 3 - Route & Map-Based Planning
FR28: Epic 5 - Sharing & Light Contribution
FR29: Epic 1 - Secure Access & Personal Workspace
FR30: Epic 4 - Trip Bucket List (Idea Capture)
FR31: Epic 4 - Trip Bucket List (Idea Capture)

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
**FRs covered:** FR22, FR23, FR24, FR28

### Epic 6: Usability Refinements
Users can iterate on focused UX improvements that simplify planning screens without changing the core product model.
**FRs covered:** FR6, FR9, FR23, FR24

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

### Story 5.3: Viewer Access With Comments and Votes

As a viewer,
I want to view the trip and add comments or votes,
So that I can contribute suggestions without changing core details.

**FRs covered:** FR23, FR24

**Acceptance Criteria:**

**Given** I have a viewer role
**When** I open a trip
**Then** I can see all trip details

**Given** I have a viewer role
**When** I attempt to edit trip data
**Then** I am blocked from editing

**Given** I have a viewer role
**When** I add a comment or vote on a trip element
**Then** my input is saved and visible on that element

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

## Epic 6: Usability Refinements

Users can iterate on focused UX improvements that simplify planning screens without changing the core product model.

### Story 6.1: Remove Trip Overview Header Feedback

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
