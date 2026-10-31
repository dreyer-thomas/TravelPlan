# Sprint Change Proposal — Connector: the Day's Note and Picture, and the Trip Route

**Date:** 2026-10-31
**Author:** John (PM) with Tommy
**Mode:** Batch
**Scope classification:** Minor (two stories added to Epic 15, no replan)
**Status:** Approved by Tommy 2026-10-31; edits applied to epics.md, prd.md, architecture.md, sprint-status.yaml

---

## 1. Issue Summary

Two requests came in after Epic 15 (Plan with Claude — the TravelPlan Connector) was finished.

1. **Users want the connector to change the day itself.** This is the "Tagesdetails" dialog: the day note ("Tagesnotiz", at most 280 characters) and the day picture ("Tagesbild"). Today the connector can neither read nor write either one. `get_day` does not return them, no tool writes the note, and `attach_file` accepts only `activity | stay`. The gap was deliberate: Stories 15.6 and 15.7 list "day image and hero image" as out of scope (Sprint Change Proposal 2026-10-29). This change reverses that line for the day picture.

2. **A connected Claude client asked for a compact route of the whole trip**: `get_trip_route(tripId)`, giving per day the date, the stay's position, leg totals and a thinned route line, without texts, costs, images or documents. To get this today, the client has to call `get_day` once per day and assemble it itself. That is slow and fills the client's context with content it does not need.

**What the data really holds (checked 2026-10-31):**
- `TravelSegment` stores `transportType`, `durationMinutes`, `distanceKm` and the two entries it connects. **It stores no waypoints and no road geometry.**
- The road line on the day map is requested live from the public FOSSGIS OSRM server (`routing.openstreetmap.de`), with no cache, every time the map opens (`dayRouteService.ts`).
- Stays (`Accommodation.locationLat/Lng`) and activities with a place have coordinates.

The request's "route from all leg waypoints, thinned to about 20 points per day" therefore cannot be served from stored data. Section 3 explains the choice.

## 2. Impact Analysis

### Epic impact
- **Epic 15:** two stories are added, 15.9 and 15.10. All stories so far, 15.1 to 15.8, are done. The epic goes back to *in-progress*. Its shared rules (repositories only, access check per trip, *not found* for trips the user cannot write, rate limit, logging, English tool descriptions) apply unchanged.
- No other epic is affected.

### Story impact
- **15.6, 15.7:** completed work is unchanged. Only their "Out of scope" lines are now superseded for the day picture. The stories stay as written, as the historical record, and 15.9 states the reversal.
- **15.2 (`get_day`):** its read shape gains the day note and the day picture. This is delivered by 15.9.

### Artifact conflicts
- **PRD:** FR53 lists what the assistant can read, FR54 what it can write, FR56 its file attachments. None of them mention the day's own note and picture. All three need an amendment (section 4.2). The route is a read of data FR53 already covers, so no new FR is needed for it.
- **FR57 (the KI/AI marker):** "every entry created or changed through a connector shows a marker". The day header carries no marker today. For a day note or picture changed through the connector to comply, the day needs the same `aiChangedAt` field the other entries have, and the Tagesdetails area must show the marker. **[default, changed from the chat on 2026-10-31: I first suggested "no badge on the day header"; FR57 does not allow that without amending the FR. Overrule it if you would rather amend FR57.]**
- **Architecture:** no new pattern. `TripDay` gains a column, `aiChangedAt`, the same pattern Story 15.4 added to the other entries. 15.10 uses no new external service.
- **UX:** one small addition. The KI/AI marker appears in the Tagesdetails section of the day view, in the same style as on activities.

### Technical impact
- **15.9:**
  - Prisma migration adding `trip_days.ai_changed_at`.
  - The day-image upload path is reused through the existing image processing.
  - **Highest risk:** replacing or removing a day picture. Story 8.4 found that a careless replace deletes the file the day still shows. The `/days/[dayId]/image` route and its containment rules are the only path allowed.
- **15.10:** read-only and database-only. It reuses the trip overview map's ordered stops (`TripOverviewMapData.ts`) and FR50's drawn-legs selection and per-mode totals (`tripTravelSummary.ts`: `selectDrawnTravelSegments`, `summarizeTripTravel`). That logic is moved to `src/lib` if it is still under `components`.

## 3. Recommended Approach

**Direct adjustment: add Stories 15.9 and 15.10 to Epic 15.**

Three options were weighed for the route:

| Option | Result | Verdict |
|---|---|---|
| **A. The route through the stops** (chosen) | Per day, ordered coordinates: last night's stay → activities that have a place → tonight's stay, in sections tagged with the leg's mode | Database only, fast, and honest about what is known. Straight lines between stops are fine at trip scale. |
| B. Live OSRM per day | Road geometry thinned to about 20 points | Rejected. A 30-day trip means 30 calls to a public server per tool call, each allowed up to 3.5 s, which strains its fair-use terms. |
| C. Store the road geometry on each leg | Real geometry from the database | Deferred to a future story if a client needs real roads (for example, finding places along the way). It needs a schema change, a fetch on every leg write and a backfill. |

**Effort:** 15.9 is about medium, comparable to one 15.6 tool plus a 15.7 target and a migration. 15.10 is small to medium.
**Risk:** low for 15.10. Medium for 15.9 because of media replacement (see 8.4).
**Timeline:** sequence 15.10 first; it is quick and was asked for by a working client. 15.9 follows.

## 4. Detailed Change Proposals

### 4.1 Stories (`epics.md`, append after Story 15.8)

#### Story 15.9: The Day's Own Note and Picture

```
### Story 15.9: The Day's Own Note and Picture

*Added 2026-10-31 (Tommy), from user requests. Reverses, for the day picture, the "day image" line in the Out of scope of Stories 15.6 and 15.7.*

As someone planning with Claude,
I want Claude to read and change the day's own note and picture,
So that a day Claude planned also has its one-line summary and its picture without me opening the day details.

**FRs covered:** FR53, FR54, FR56 (day note and day picture, amended 2026-10-31), FR57

**Depends on:** Stories 15.4, 15.7, 15.8.

**Acceptance Criteria:**

**Given** `get_day`
**Then** it also returns the day's `note` (or null) and its `image` (or null) with `downloadUrl` (`w=1600`), `width` and `height` as in 15.8, and the day's `updatedAt`
**And** `get_trip` returns per day whether it has a note and a picture (`hasNote`, `hasImage`), not their content

**Given** `update_day(tripId, dayId, note, updatedAt)`
**Then** it sets the note (trimmed, at most 280 characters, empty or null clears it) under the same validation as the Tagesdetails dialog
**And** a stale `updatedAt` answers "Day changed since you read it; read the day again" and writes nothing
**And** it changes nothing else on the day, and in particular never touches the day picture

**Given** `attach_file(target: "day", id: dayId, …)` with `contentBase64` or `url`
**Then** only JPEG, PNG or WebP is accepted, decided by content; a PDF answers that day pictures must be images
**And** the 15.7 limits and the URL download rules (https only, public addresses after DNS and on every redirect, at most 3 redirects, 15 s, no credentials) apply unchanged
**And** the picture goes through the same processing and the same storage path as an upload in the Tagesdetails dialog
**And** if the day already has a picture, it is replaced; the old file is kept for undo (DW-187 rule) and never deleted while the day still points at it (Story 8.4)

**Given** `delete_file` with the day picture's id
**Then** it removes the picture as the dialog does, kept for undo

**Given** every write here
**Then** it follows the 15.4 rules: one `ai_changes` entry tied to the day, undoable from the app and through `undo_ai_change` unless the day changed since, *not found* for trips the user cannot write
**And** `trip_days.ai_changed_at` is set by a connector write and cleared by an app write to the note or picture, and the Tagesdetails section of the day view shows the KI/AI marker while it is set **[default; FR57]**
**And** the change is listed in the day view's AI-changes notice like any other

**Given** the test suite
**Then** it covers reading note and picture, setting and clearing the note, a stale `updatedAt`, a first picture, a replaced picture with undo restoring the old one, a PDF refused, a picture removed and undone, the marker set and cleared, and a view-only trip answering *not found*

**Given** the production server
**When** deployed (Tommy, manual)
**Then** a day picture set by Claude from a URL appears in the day view with the KI badge, and undo in the app brings back the previous picture

**Out of scope:** the trip's hero picture (trip-level, R7 spirit) **[default]**; several pictures per day; changing the day's date.
```

#### Story 15.10: The Trip Route at a Glance

```
### Story 15.10: The Trip Route at a Glance

*Added 2026-10-31 (Tommy), from a request by a connected Claude client.*

As an AI client looking at a whole trip (to draw its map or judge each day's travel),
I want one compact read of where each day goes and how,
So that I do not have to read every day in full and fill my context with texts, costs and files.

**FRs covered:** FR53 (no new FR; a compact read of data already covered)

**Depends on:** Story 15.2.

**Acceptance Criteria:**

**Given** `get_trip_route(tripId)`, read-only
**Then** it returns per day in order: `date` (YYYY-MM-DD), `dayIndex`, `stay` (`name`, `lat`, `lng`, or null if there is no stay or it has no position)
**And** `legs`: per transport mode present that day (`car`, `ship`, `flight`, `train`, `bus`, `walking`, `cycling`; lower case as in 15.2) the `count`, the sum of `distanceKm` (null if no leg of that mode has one) and the sum of `durationMinutes`
**And** `path`: the day's stops in plan order (last night's stay → activities that have a place → tonight's stay) as sections `{ mode, points: [[lat, lng], …] }`, where a section's mode is the leg drawn between those stops, or null where no leg is drawn
**And** stops without a position are skipped and counted per day in `missingPositions`

**Given** the legs counted
**Then** only drawn legs count (the same `selectDrawnTravelSegments` rule as FR50 and 15.2), so the per-mode totals summed over the trip match the trip overview's planned distance

**Given** the answer
**Then** it contains no texts (no titles, descriptions or notes), no costs, no links, no images and no documents; coordinates are rounded to 5 decimals
**And** it makes no call to any routing service; the description tells the model the path connects stops in straight lines, not along roads

**Given** a trip of 60 days with 10 stops per day
**Then** the answer stays below 60 KB and the tool answers from the database in one read pass (no query per day) **[default]**

**Given** every call
**Then** it follows the shared rules (access check, *not found* for trips the user cannot write, rate limit, logging)

**Given** the test suite
**Then** it covers an empty trip, a day without stay, a ferry day giving a `ship` section, an undrawn leg left out of the totals, a stop without position, trip totals equal to `summarizeTripTravel`, and no text fields in the answer

**Out of scope:** road geometry (option C, a future story if needed); live routing; elevation.
```

### 4.2 PRD (`prd.md`)

**FR53**
OLD: `… its days, activities with times, durations and places, stays, travel legs, the bucket list, costs, links, documents and images. …`
NEW: `… its days (with each day's note and picture), activities with times, durations and places, stays, travel legs, the bucket list, costs, links, documents and images. … **(Amended 2026-10-31 — day note and picture)**`

**FR54**
OLD: `… and create, change and delete stays, travel legs, costs and links, on those trips, …`
NEW: `… create, change and delete stays, travel legs, costs and links, and change each day's note, on those trips, … **(Amended 2026-10-31)**`

**FR56**
OLD: `… and attach documents and images to activities and stays, …`
NEW: `… attach documents and images to activities and stays, and set or remove a day's picture, … **(Amended 2026-10-31)**`

Add a change-log entry to the frontmatter: `Amended FR53, FR54, FR56 (day note and day picture through the connector). Stories 15.9, 15.10. See Sprint Change Proposal 2026-10-31 (Connector: Day and Route).`

### 4.3 Epics (`epics.md`), Epic 15 rulings line

Append: `**Rulings (Tommy, 2026-10-31):** the day's note and picture are writable through the connector (15.9); the trip's hero picture stays out. A compact trip route read connects stops, not roads (15.10).`

### 4.4 Architecture (`architecture.md`)

No new section. One line under the Epic 15 connector notes: `TripDay.aiChangedAt (2026-10-31, Story 15.9), same semantics as the 15.4 marker columns. Route reads (15.10) never call OSRM.`

### 4.5 UX

Day view, Tagesdetails section: show the existing KI/AI badge component while `aiChangedAt` is set. No new component.

### 4.6 Sprint status (`sprint-status.yaml`)

```
  epic-15: in-progress
  15-9-the-days-own-note-and-picture: backlog
  15-10-the-trip-route-at-a-glance: backlog
```

## 5. Implementation Handoff

- **Scope:** Minor. The Developer agent implements directly, through `bmad-create-story` → `bmad-dev-story` → `bmad-code-review`.
- **Order:** 15.10 first, then 15.9.
- **Tommy:** production acceptance of 15.9 (picture by URL, undo).
- **Success criteria:**
  - 15.10: a client draws the trip map from one call, and the per-mode totals equal the trip overview's planned distance.
  - 15.9: a day note and picture set by Claude show in the day view with the KI badge, and undo restores the previous picture without losing any file.

**Open defaults for Tommy to overrule:**
1. The KI marker on the Tagesdetails section, to satisfy FR57. The alternative is to amend FR57 and rely on the AI-changes notice.
2. The hero picture stays out.
3. All travel modes in the route totals.
4. The 60 KB / single-pass bound in 15.10.
