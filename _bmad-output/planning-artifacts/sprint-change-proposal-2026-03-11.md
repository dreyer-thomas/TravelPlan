# Sprint Change Proposal

Date: 2026-03-11
Project: TravelPlan
Requested by: Tommy
Mode: Batch

## 1. Issue Summary

The current trip overview includes a mini map that shows all places in the trip, but it does not provide a full-size map experience comparable to the existing full-page day map.

The newly identified requirement is to add a full-size trip map launched from the trip overview map area. This full-size trip map must:

- show all places of the trip
- connect them in chronological order
- open a popup when a place is clicked
- show the linked accommodation or day item in that popup
- align closely with the existing day full-page map interaction and implementation pattern

Trigger source:

- Existing implemented story `3-1-trip-overview-map-with-all-places`
- Existing implemented story `2-28-map-full-page-view`
- Existing implemented story `3-5-day-view-map-panel-with-ordered-pins`

Evidence:

- `3.1` currently covers overview markers only, not a full-size trip map.
- `2.28` already established a reusable full-page map pattern, marker click handling, and detail dialogs for day maps.
- The codebase already contains trip overview map components and a day full-page route, so the gap is feature scope rather than missing platform capability.

## 2. Impact Analysis

### Epic Impact

Affected epic:

- Epic 3: Route & Map-Based Planning

Assessment:

- Epic 3 remains valid as planned.
- No rollback is needed.
- The change fits naturally as an additional story in Epic 3 after `3.5`.
- Recommended new story id: `3.6`

Epic-level change needed:

- Add a new story for a full-size trip map launched from the trip overview map section.

Future epic impact:

- No change required for Epics 1, 2, 4, or 5.
- No epic resequencing required.

### Story Impact

Already completed stories that provide dependencies:

- `3.1` provides trip overview map data and missing-location handling.
- `3.5` provides ordered chronological map point logic for day maps.
- `2.28` provides the full-page map route pattern and marker popup behavior.

Required story change:

- Add a new story that extends trip-level map behavior without redefining the completed scope of `3.1`.

### Artifact Conflict Analysis

PRD:

- No conflict.
- Existing FR26 already supports map-based overview of the trip route.
- No MVP scope increase outside the existing map feature family.

Architecture:

- No stack or architectural conflict.
- Change stays within existing Leaflet, Material UI, App Router, and feature-based component boundaries.
- No API or database changes appear necessary if current trip detail payload already exposes the place metadata used by the overview map and the day map dialogs.

UX:

- Minor update needed.
- The UX specification already calls for a mini map / route snapshot and route visualization.
- It should be updated to note that the overview mini map can expand into a full-size trip map using the same interaction model as the day full-page map.

Other artifacts:

- Sprint tracking needs a new backlog story entry once approved.

## 3. Recommended Approach

Selected path:

- Option 1: Direct Adjustment

Rationale:

- The requested feature is a bounded extension of existing map capabilities.
- It can be delivered by adding one story under Epic 3 without changing completed story intent.
- Existing implementation patterns can be reused:
  - trip overview map data flow
  - day full-page map route/page pattern
  - marker popup/detail dialog behavior
  - chronological pin connection logic

Effort estimate:

- Medium

Risk:

- Low to Medium

Primary risks:

- Chronological ordering at trip level must be defined from canonical trip/day/day-item sequence rather than inferred from UI order.
- Popups must resolve correctly for both accommodations and day items.
- Trip overview and full-page trip map must stay visually and behaviorally aligned with existing day map patterns.

Why this is preferred over alternatives:

- Rollback adds no value because current completed work is useful and reusable.
- MVP reduction is unnecessary because the request stays within existing FR26 map scope.

## 4. Detailed Change Proposals

### 4.1 Epic / Story Changes

Artifact: `epics.md`

Section: `Epic 3: Route & Map-Based Planning`

OLD:

```md
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
```

NEW:

```md
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
```

Rationale:

- Keeps `3.1` intact as the overview map foundation.
- Captures the new full-size capability explicitly instead of stretching `3.1` beyond its completed scope.
- Makes reuse from `2.28` and `3.5` an intentional dependency.

### 4.2 PRD Changes

Artifact: `prd.md`

Section: `Transport & Routing`

OLD:

```md
- FR26: Users can view a map-based overview of the trip route.
```

NEW:

```md
- FR26: Users can view a map-based overview of the trip route, including a full-size trip map that can be opened from the overview and inspected via clickable place markers.
```

Rationale:

- This is a clarification of existing route-visualization scope, not a net-new product pillar.

### 4.3 UX Specification Changes

Artifact: `ux-design-specification.md`

Section: trip overview / mini map / route map behavior

OLD:

```md
Purpose: Summarize trip health (gaps, budget, route snapshot).
Anatomy: Summary cards, gap panel, mini map, budget strip.
```

NEW:

```md
Purpose: Summarize trip health (gaps, budget, route snapshot).
Anatomy: Summary cards, gap panel, mini map, budget strip.

Trip overview mini map behavior:
- Shows all trip places that have valid locations.
- Provides a clear action to open a full-size trip map.
- The full-size trip map connects places in chronological trip order.
- Clicking a marker reveals the linked accommodation or day item.
- The full-size trip map should mirror the day full-page map interaction style where practical.
```

Rationale:

- Keeps the overview-first UX intact while formalizing the expanded map interaction.

### 4.4 Architecture / Implementation Guidance Changes

Artifact: `architecture.md`

Section: implementation patterns / project structure

OLD:

```md
- Leaflet stable `1.9.4`; Leaflet `2.0.0-alpha.1` exists but is a major change, so avoid for now.
```

NEW:

```md
- Leaflet stable `1.9.4`; Leaflet `2.0.0-alpha.1` exists but is a major change, so avoid for now.
- Trip-level full-size maps should reuse the same Leaflet and route/page composition patterns already established for the day full-page map instead of introducing a separate map stack.
```

Rationale:

- Prevents duplicate map implementations and keeps future story creation anchored to existing code patterns.

### 4.5 Sprint Tracking Changes

Artifact: `sprint-status.yaml`

OLD:

```yaml
  epic-3: backlog
  3-1-trip-overview-map-with-all-places: done
  3-2-day-route-map-with-ordered-stops: done
  3-3-seed-trip-from-start-and-destination: done
  3-5-day-view-map-panel-with-ordered-pins: done
  epic-3-retrospective: optional
```

NEW:

```yaml
  epic-3: backlog
  3-1-trip-overview-map-with-all-places: done
  3-2-day-route-map-with-ordered-stops: done
  3-3-seed-trip-from-start-and-destination: done
  3-5-day-view-map-panel-with-ordered-pins: done
  3-6-trip-overview-full-size-map-with-chronological-route: backlog
  epic-3-retrospective: optional
```

Rationale:

- Adds the story to the active planning system so `create-story` can target it next.

## 5. Implementation Handoff

Scope classification:

- Moderate

Reason:

- This requires backlog and planning artifact updates before the developer workflow can consume the story cleanly.

Handoff recipients:

- Scrum Master / Product Owner: update planning artifacts and sprint tracking
- Scrum Master: run `create-story` for the new story after artifact updates
- Development agent: implement the story once the context file exists

Success criteria:

- Epic 3 includes Story 3.6 in planning artifacts.
- Sprint status includes Story 3.6 as `backlog`.
- A new implementation-ready story file is created for `3-6-trip-overview-full-size-map-with-chronological-route`.
- The implementation reuses the day full-page map pattern and does not introduce a parallel trip-map architecture.

## Checklist Status Summary

- 1. Understand trigger and context: [x] Done
- 2. Epic impact assessment: [x] Done
- 3. Artifact conflict and impact analysis: [x] Done
- 4. Path forward evaluation: [x] Done
- 5. Sprint change proposal components: [x] Done
- 6. Final review and handoff: [!] Action-needed after user approval
