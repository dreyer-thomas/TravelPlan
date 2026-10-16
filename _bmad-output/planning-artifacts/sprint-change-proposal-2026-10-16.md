# Sprint Change Proposal — 2026-10-16

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-16 with two changes: no image attribution (private use), and web search enabled (D4 and D5 below). Edits 4.1–4.4 applied.
**Scope classification:** Moderate. This adds a new Epic 12 with four stories, two FRs, one NFR note and one architecture integration entry. It also adds the project's first paid external dependency, the Anthropic API. It needs no schema migration and does not revert any shipped work.

---

## 1. Issue Summary

**A day can be filled with ideas without leaving the app.** On 2026-10-16 Tommy asked for an AI search on the day view. A planner describes what they want to do that day. Claude then suggests stops between the day's start and end. Each suggestion shows the same things an activity card shows: title, description, 2–3 small images and a location. The planner ticks the ones they want and presses *Übernehmen*. The app then creates them as activities in the order they would be visited.

**Category:** a new requirement from the stakeholder. No current FR covers it. Idea capture (FR35/FR36, Epic 4) only stores ideas the user brings, it does not generate them.

**Evidence and constraints found in the code (2026-10-16):**
- `DayPlanItem` already has every field a suggestion needs: `title`, `contentJson` (Tiptap), `locationLat/Lng/Label` and `fromTime/toTime`. Images live in `DayPlanItemImage`, stored under `MEDIA_STORAGE_ROOT`.
- An activity has no sort column. Order is defined by `fromTime` (Story 11.3), so "visiting order" means "chained times".
- `Accommodation.checkOutTime` exists, so the time chain can start there.
- OSRM routing (`src/lib/routing/dayRouteService.ts`, profiles driving/walking/cycling) and Nominatim geocoding (`src/app/api/geocode/route.ts`) are both in place.
- The project has no LLM integration and no app-settings table.

---

## 2. Impact Analysis

### Tommy's rulings, 2026-10-16

| # | Topic | Ruling |
|---|---|---|
| R1 | Key and cost | The system belongs to the admin, and the admin pays. The key goes in `.env` as `ANTHROPIC_API_KEY`. There is no admin settings UI for now. |
| R2 | Who may search | ADMIN, and anyone allowed to plan the trip (owner, contributor). Viewers may not. |
| R3 | Surface | A dialog on the day view (full-screen on phones). It has a free-text field ("Was willst du heute erleben?") and a mode toggle for car, walking and cycling. **The mode is part of the search** (a walk around the hotel gives different ideas than a drive). |
| R4 | Suggestion content | Title, description, 2–3 small images, location and a **typical visit duration** from the AI. |
| R5 | Selection | Each suggestion has a checkbox. *Übernehmen* creates the ticked ones. The others are discarded. A "to the bucket list" action is deferred. |
| R6 | Time chain | Starts at the **check-out time** of the morning's stay. If the day already has activities, the new ones are **appended after the last one**, not interleaved. |
| R7 | Travel legs | Legs between consecutive new activities are created at the same time as the activities. |

**PM defaults, to be confirmed with this approval:**
- **D1:** No check-out time means a 09:00 start. No previous-night stay means the trip's start location is the day's start.
- **D2:** Durations and distances come from OSRM, not the AI. OSRM is measured, free and already integrated. The AI picks places, and OSRM does the arithmetic.
- **D3:** Coordinates are verified. The AI's place name is checked with Nominatim. A suggestion that cannot be verified gets a visible "Ort nicht bestätigt" marker and keeps the AI's coordinates.
- **D4:** Images come from Wikimedia Commons or Wikipedia, looked up by title and coordinates. Image URLs from the AI are never used. On *Übernehmen* the images are downloaded into the app's own storage. **No attribution is stored or shown** (Tommy, 2026-10-16: a private app).
- **D5:** The model is `claude-sonnet-5-5`, which can be overridden with `ANTHROPIC_MODEL`. **Claude's server-side web search tool is on** (Tommy, 2026-10-16), so suggestions reflect current openings, events and closures. It is capped at 5 searches per request. Web search adds a per-search fee and latency, so the timeout is 60 s. Results are structured output validated with Zod.
- **D6:** Each user may run 20 searches per day, which can be changed with `AI_SUGGESTIONS_DAILY_LIMIT`. This is a guard against bugs and loops, not against abuse.

### Epic impact

| Epic | Impact |
|---|---|
| **Epic 12 — AI Suggestions for the Day** | **New**, with 4 stories and status `backlog`. |
| Epic 11 | Not changed, but reused. *Übernehmen* is a day-recalculating write, so it returns a receipt and can be undone in one step (Story 11.1 mechanism). |
| Epic 4 (Bucket List) | No change. "Discarded suggestion → bucket list" is noted as a possible follow-up story. |
| Epics 8–10 | No impact. |

### Sequencing

Under the 2026-08-01 sequencing decision, Epics 10 and 11 are finished first. All of their stories are `done` and only the optional retrospectives are open. Epic 12 can start straight after them.

### Artifact conflicts

| Artifact | Update |
|---|---|
| `prd.md` | Add FR44 and FR45 under a new "AI Day Suggestions" heading. Add a domain note on what data goes to Anthropic. Add an edit-history entry. (4.1) |
| `epics.md` | FR inventory lines, the Epic 12 list entry, and the full Epic 12 section. (4.2) |
| `architecture.md` | Add Anthropic and Wikimedia entries under *Integration Points → External Integrations*. Add a rate-limit note under *API & Communication Patterns*. (4.3) |
| `DESIGN.md` / `EXPERIENCE.md` | None. The dialog reuses the existing dialog, card, checkbox and `action-notice` patterns, and the story spells out its layout. |
| `.env.example` / deployment guide | Add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `AI_SUGGESTIONS_DAILY_LIMIT`. This is part of Story 12.1. |
| `sprint-status.yaml` | Add Epic 12 and its four stories as `backlog`. (4.4) |

### Technical impact

- **New dependency:** `@anthropic-ai/sdk`. This is the project's first paid external API. **No schema migration:** the daily limit is counted in memory per process, which is fine for a single-server deployment.
- **Privacy:** the request to Anthropic contains the day's start and end place names and coordinates, the free-text wish, the mode and the titles of existing activities. It contains no user names, emails or trip members.
- **Feature flag by presence:** without `ANTHROPIC_API_KEY` the entry point is not rendered and the endpoint answers `503 ai_unavailable`.
- **Undo:** applying 1..n suggestions is one transaction with one receipt. *Rückgängig* removes every created activity, leg and image file.

---

## 3. Recommended Approach

**Direct adjustment by adding a new epic.** Nothing shipped is touched. The feature is built on existing pieces: the activity model, OSRM, Nominatim, media storage and Epic 11 receipts.

**Story cut:**
1. **12.1** builds the server-side search and proves the AI part works on its own.
2. **12.2** adds images, the riskiest UX element, kept separate so 12.1 can ship without it.
3. **12.3** builds the dialog where the planner reviews and selects suggestions, read-only with no writes.
4. **12.4** applies the selection: ordering, time chain, legs, undo.

**Effort:** medium, about 4 dev sessions. **Risk:** medium. AI output quality and Nominatim hit rate are the unknowns, so D3 and the "unconfirmed" marker make failures visible instead of silent. **Timeline:** none for current work.

**Alternatives considered:**
- **Admin UI for the key, stored encrypted.** Rejected for now (R1). It needs a migration and key encryption, and `.env` is enough for a single admin.
- **AI-estimated travel times.** Rejected (D2). OSRM is already there and measures them.
- **A separate page instead of a dialog.** Rejected (R3). All day edits are dialogs today. It can be promoted to a page later if the cards need more room.

**R6 confirmed 2026-10-16:** new activities are appended after the last existing one.

---

## 4. Detailed Change Proposals

### 4.1 `prd.md`

**Frontmatter `editHistory`, append:**
```
  - date: '2026-10-16'
    changes: 'Added FR44-FR45 (AI suggestions for a day, applied as ordered activities with travel legs) and a domain note on data sent to the AI provider. See Sprint Change Proposal 2026-10-16.'
```

**Functional Requirements, new subsection after "Travel Documents":**
```
### AI Day Suggestions

- FR44: Users who can plan a trip can ask an AI for activity suggestions for a day, describing in free text what they want to do and choosing car, walking or cycling. Each suggestion shows a title, a description, up to three images, a location and a typical visit duration. The day's start and end places are used as context. The feature is available only when the operator has configured an AI provider key.
- FR45: Users can select any number of suggestions and apply them in one step. The selected suggestions become activities in visiting order along the day's route, with times chained from the morning's check-out (or after the day's last activity), and travel legs between them in the chosen mode. The whole application can be undone in one step.
```

**Domain Requirements → Integration Requirements, append:**
```
- AI provider (Anthropic Claude) for day suggestions, operator-paid via a server-side key. Requests contain place names and coordinates, the user's free-text wish and existing activity titles — no account or member data.
```

### 4.2 `epics.md`

**Requirements inventory, after FR43:**
```
FR44: Epic 12 - AI Suggestions for the Day
FR45: Epic 12 - AI Suggestions for the Day
```

**Epic List, after Epic 11:**
```
### Epic 12: AI Suggestions for the Day
Users who plan a trip can describe what they want from a day, get AI suggestions for stops between the morning's stay and the evening's, pick the ones they like, and have them placed on the day in visiting order with times and travel legs — undoable in one step.
**FRs covered:** FR44, FR45
```

**New section at the end of the file:**

---

## Epic 12: AI Suggestions for the Day

Users who plan a trip can describe what they want from a day, get AI suggestions for stops between the morning's stay and the evening's, pick the ones they like, and have them placed on the day in visiting order with times and travel legs, undoable in one step.

### Story 12.1: Ask Claude What the Day Could Hold

As someone planning a day,
I want the app to ask an AI for stops that fit my wish, my mode of travel and the day's route,
So that I start from concrete ideas instead of a blank day.

**FRs covered:** FR44 (search, without images and UI)

**Depends on:** nothing.

**Acceptance Criteria:**

**Given** `ANTHROPIC_API_KEY` is set in the server environment
**When** a user with planning rights on the trip (owner, contributor) or an ADMIN posts `{ prompt, mode: "car" | "walking" | "cycling" }` to `POST /api/trips/[id]/days/[dayId]/suggestions`
**Then** the server calls Claude through `@anthropic-ai/sdk`, using the model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`) Claude's server-side web search tool (`max_uses` 5), and Zod-validated structured output. It returns 3–8 suggestions, each with `title`, `description` (plain text, at most about 600 characters), `locationLabel`, `lat`, `lng`, `durationMinutes` and an optional `wikiTitle` hint.

**Given** the request context
**Then** it contains the day's date, the start place (the previous night's stay, or the trip's start location if there is none), the end place (the day's stay, or none), the free-text wish, the mode with its meaning (walking or cycling means stops reachable on foot or by bike from start or end), and the titles of the day's existing activities so they are not suggested again. It contains no user, email or member data.

**Given** a suggestion
**When** its `locationLabel` is geocoded through the existing Nominatim integration and the result lies within 2 km of the AI's coordinates
**Then** the verified coordinates replace the AI's and the suggestion is `verified: true`. Otherwise it keeps the AI's coordinates with `verified: false`.

**Given** a viewer without planning rights
**Then** the endpoint refuses with the same check as other planning writes.

**Given** the key is not set
**Then** the endpoint answers `503` with code `ai_unavailable`, and a capability flag the day page can read reports the feature as off.

**Given** a user has made `AI_SUGGESTIONS_DAILY_LIMIT` searches (default 20) since midnight server time
**Then** further searches answer `429` with code `ai_limit_reached`. The count is kept in memory per process.

**Given** Claude times out (60 s, web search included), errors, or returns output that fails validation
**Then** the endpoint answers with the standard error envelope and code `ai_failed`, and nothing is written.

**Given** the change ships
**Then** `.env.example` and `docs/deployment-guide.md` document the three variables, the key never reaches the client bundle or logs, and tests cover the permission check, the missing key, the limit, the verification threshold and invalid model output (with the SDK mocked).

### Story 12.2: Pictures for Each Suggestion

As someone choosing between suggestions,
I want two or three small pictures of each place,
So that I can judge it at a glance.

**FRs covered:** FR44 (images)

**Depends on:** 12.1.

**Acceptance Criteria:**

**Given** a suggestion from 12.1
**Then** the server looks up up to 3 images on Wikimedia (the Wikipedia page images for `wikiTitle`/`title`, then Commons geosearch within 1 km of the coordinates). It returns for each image a thumbnail URL (at most 320 px wide) and the original URL. No author or licence data is kept. It never uses image URLs produced by the AI.

**Given** no image is found or Wikimedia fails
**Then** the suggestion is returned without images, and the search as a whole does not fail.

**Given** the lookups
**Then** they run in parallel with a total budget of 8 s, and requests send a descriptive `User-Agent` as Wikimedia's API policy requires.

**Given** tests
**Then** the lookup order, the 3-image cap, the missing-image case and the timeout are covered with Wikimedia mocked.

### Story 12.3: Look Through the Ideas and Tick the Good Ones

As someone planning a day,
I want a dialog where I describe the day, see the suggestions as cards and tick the ones I want,
So that I can choose calmly before anything is added to my plan.

**FRs covered:** FR44 (UI)

**Depends on:** 12.1, 12.2.

**Acceptance Criteria:**

**Given** the feature is on and the user may plan the trip
**Then** the day view shows an *Ideen finden* action next to the existing "add activity" action. It is never shown to viewers or when the feature is off.

**Given** the dialog opens
**Then** it shows the day's start and end (read-only), a multi-line field "Was willst du heute erleben?", a mode toggle (Auto / Zu Fuß / Fahrrad, default Auto) and a *Suchen* button. It is full-screen on phones and follows the existing dialog pattern.

**Given** a search is running
**Then** the button shows progress, the inputs are locked, and the dialog can still be closed.

**Given** results
**Then** each suggestion is a card with a checkbox, title, description, up to 3 small thumbnails, place label, typical duration ("ca. 1½ h") and, for `verified: false`, a visible *Ort nicht bestätigt* marker. A small map preview is not required.

**Given** the user changes the wish or mode and searches again
**Then** the list is replaced and earlier ticks are cleared.

**Given** at least one card is ticked
**Then** *Übernehmen (n)* is enabled. With none ticked it is disabled. (Applying is Story 12.4. Until then the button can be hidden behind the same flag.)

**Given** an error code from 12.1 (`ai_failed`, `ai_limit_reached`)
**Then** a German or English message appears in the dialog, and the inputs stay filled.

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string.

### Story 12.4: Take Them Over in Visiting Order

As someone who has picked the ideas they like,
I want them added as activities in the order I would visit them, with times and travel legs,
So that the day is planned in one step and I can take it back if it is wrong.

**FRs covered:** FR45

**Depends on:** 12.3; Epic 11 receipts (Story 11.1).

**Acceptance Criteria:**

**Given** n ticked suggestions
**When** *Übernehmen* is pressed
**Then** they are ordered along the day's route. If start and end differ, they are sorted by their projection onto the start→end line. If they are equal or there is no end, the order is a nearest-neighbour tour from the start.

**Given** the ordered list
**Then** the time chain starts at the start stay's `checkOutTime` (09:00 if empty). If the day already has activities with times, it starts after the last one ends. Each activity gets `fromTime` = previous end plus the OSRM travel time from the previous point in the chosen mode, and `toTime` = `fromTime` + `durationMinutes`, rounded up to 5 minutes.

**Given** the dialog before applying
**Then** it shows the computed order and times as a preview. If the last activity would end after 23:59, a warning is shown and applying is still allowed.

**Given** applying
**Then** in one transaction: each suggestion becomes a `DayPlanItem` with title, description as Tiptap paragraphs, verified location and times. A `TravelSegment` is created between each pair of consecutive new activities, and from the previous point (stay or last existing activity) to the first one, in the chosen mode (`CAR`, `WALKING`, `CYCLING`) with OSRM duration and distance.

**Given** images
**Then** each is downloaded server-side into `MEDIA_STORAGE_ROOT` through the existing upload path and size limit, and linked as `DayPlanItemImage`. A failed download skips that image and does not block the apply.

**Given** OSRM is unavailable
**Then** activities are still created, legs are created without duration and distance, and the chain assumes 0 minutes of travel.

**Given** the apply succeeds
**Then** it returns a receipt (Story 11.1). The `action-notice` reads e.g. "4 Aktivitäten und 4 Fahrten hinzugefügt", and *Rückgängig* removes every created activity, leg and image file in one step.

**Given** a viewer
**Then** the apply endpoint refuses them like other planning writes.

**Given** tests
**Then** they cover the ordering for both cases, the time chain from check-out, from 09:00 and after existing activities, the OSRM fallback, a failed image download, and undo.

---

### 4.3 `architecture.md`

**Integration Points → External Integrations, append:**
```
- AI suggestions (2026-10-16, Epic 12): Anthropic Claude via `@anthropic-ai/sdk`, called only from the server (`lib/ai/`). Key in `ANTHROPIC_API_KEY`, model in `ANTHROPIC_MODEL`; absent key = feature off. Structured output validated with Zod; server-side web search tool enabled (max 5 per request); coordinates re-verified via Nominatim. Paid per call by the operator; per-user daily limit `AI_SUGGESTIONS_DAILY_LIMIT` (in-memory). See FR44–FR45.
- Wikimedia (Wikipedia page images, Commons geosearch): keyless image lookup for suggestions; images copied into media storage on apply (no attribution kept — private app).
```

**API & Communication Patterns → Rate Limiting Scope:**
```
OLD: - **Rate Limiting Scope:** Auth endpoints only
NEW: - **Rate Limiting Scope:** Auth endpoints, plus a per-user daily limit on AI suggestion searches (Epic 12)
```

### 4.4 `sprint-status.yaml`, append after Epic 11

```
  epic-12: backlog
  12-1-ask-claude-what-the-day-could-hold: backlog
  12-2-pictures-for-each-suggestion: backlog
  12-3-look-through-the-ideas-and-tick-the-good-ones: backlog
  12-4-take-them-over-in-visiting-order: backlog
  epic-12-retrospective: optional
```

---

## 5. Implementation Handoff

**Scope:** Moderate. It is a new epic, but built on existing patterns with no architect review needed beyond 4.3.

1. Tommy approved on 2026-10-16. John applied 4.1–4.4.
2. `bmad-create-story 12-1` creates the story file against the live code, followed by `bmad-dev-story` and `bmad-code-review`. Repeat for 12.2–12.4 in order.
3. Before 12.1 goes live: Tommy creates an Anthropic API key, puts it in the server `.env`, and optionally sets a spend limit in the Anthropic console.

**Success criteria:**
- A contributor can describe a day and receive suggestions.
- A ticked set lands on the day in a sensible order, with times starting at check-out and legs between the stops.
- One *Rückgängig* removes it all.
- Viewers never see the feature.
- Without a key the feature is invisible.
- No migration.
- The full suite is green.
