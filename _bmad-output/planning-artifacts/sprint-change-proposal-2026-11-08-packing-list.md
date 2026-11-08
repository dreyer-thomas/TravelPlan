# Sprint Change Proposal — The Packing List

**Date:** 2026-11-08
**Author:** John (PM) with Tommy
**Mode:** Batch
**Scope classification:** Moderate (new Epic 16 with five stories, new FRs, no replan of existing work)
**Status:** Approved by Tommy 2026-11-08; edits applied to epics.md, prd.md, architecture.md, sprint-status.yaml

---

## 1. Issue Summary

Tommy proposed a new capability on 2026-11-08. TravelPlan plans *where* a trip goes and *what* happens there. It does not help with *what the travellers take with them*.

Today Tommy keeps packing lists outside the app. Two things go wrong:

1. **While packing:** nothing shows which items are already in the suitcase. The family splits the packing by area (Tommy the tech, his wife the clothing), so each person needs to see their own area and tick it off.
2. **In the morning of a day:** the day's needs ("beach: swimwear, snorkel mask") live only in people's heads, so things get left behind.

He also wants his AI assistant to work on the list through the connector (Epic 15). Items entered while planning, or discovered on a day, should fill the list over the course of the trip.

**Rulings from the discovery conversation (Tommy, 2026-11-08):**
- **One shared list per trip** for all travellers. No per-person lists; who packs does not matter.
- Items have a **name and a free category**, with suggested default categories. No tags, no quantities.
- The **trip list is the only place with a checkbox** ("packed").
- The **day's packing list is information only.** Nothing is used up and there is no checkbox. You pick items from the trip list or create new ones on the day; a new one also lands on the trip list, unchecked. One item can belong to many days.
- Removing an item from a day only unlinks it. **Deleting it from the trip list removes it from every day, after a confirmation.**
- **Contributors can do everything** on the list.
- The day's packing list appears **in the day email** (FR51).
- **Connector:** read, add, tick off, delete and link to days, under the KI/AI marker and undo rules.
- **Reuse:** copy items **from any other TravelPlan trip**, in the app. File import and export (CSV) are not built; the assistant covers that through the connector.
- No in-app "suggest a packing list" AI feature. The connected assistant can do that, because it reads the trip.

## 2. Impact Analysis

### Epic impact
- **New Epic 16: The Packing List**, with Stories 16.1 to 16.5.
- **Epic 9 (Travel Documents / Day by Email):** completed work is unchanged. The day email gains a section, delivered by 16.3.
- **Epic 15 (Connector):** completed work is unchanged. Its shared rules apply to the new tools in 16.4. `get_day` and `get_trip` gain small packing fields.
- **Epic 2 (backup export and import, Story 2.31):** the v2 archive carries the packing list (16.1), so a restored trip does not lose it.
- No other epic is affected.

### Story impact
- No completed story is reopened. Every change is additive and lives in Epic 16.

### Artifact conflicts
- **PRD:** no FR covers packing. Add FR58 to FR60, and amend FR51 (day email), FR53 (connector read) and FR54 (connector write). FR30 (viewers see, but do not edit) and FR32 (contributors have full edit rights) already cover the access rules. Section 4.2 has the wording.
- **FR57 (KI marker and undo):** the bucket-list precedent (connector writes that cannot be undone, `receiptJson` null) **does not apply here**. A packing item is small and flat, so a snapshot receipt is cheap. Packing changes are undoable, as FR57 says. **[default]**
- **Architecture:** a new trip-level model with a day link table, a new repository and a new tool module. There is no new external service, and no OSRM or AI-provider call. Section 4.4 has the details.
- **UX:** a packing list page reachable from the trip overview, a "Take along" section in the day view, and a section in the day email. Section 4.5 has the details.

### Technical impact
- **Prisma migration:** `PackingItem` (trip-level) and `PackingItemDay` (link to `TripDay`), both cascading. A shortened trip that loses days loses their links, never the items.
- **Name uniqueness per trip, ignoring case and surrounding spaces.** Three stories depend on this: creating on a day (16.2), the connector (16.4) and copying (16.5). They link the existing item instead of creating a duplicate.
- **Export and import v2:** the manifest gains an optional `packingItems` array. Older archives without it still import.
- **Highest risk:** the AI-changes notice and undo for trip-level writes. The existing receipt is day-scoped (v3 day-change receipt), so packing needs its own small receipt kind. Everything else is plain CRUD.

## 3. Recommended Approach

**Direct adjustment: add Epic 16 with five stories.**

| Option weighed | Verdict |
|---|---|
| **One list per trip with free categories** (chosen) | Matches how the family packs (one area each), and the categories carry that split. |
| Several lists per trip | Rejected. Only useful for per-person packing, which Tommy ruled out. |
| Tags | Rejected. A packing item almost never belongs to two groups. The "what do I need on the beach day" grouping comes from the days themselves. |
| Templates or file import and export | Rejected. Copying from another trip (16.5) covers reuse, and the assistant covers outside lists through the connector. |

**Effort:** 16.1 is medium (model, page, export). 16.2 is medium. 16.3 is small. 16.4 is medium (five tools plus a new receipt kind). 16.5 is small.
**Risk:** low overall. Medium for the undo of trip-level connector writes in 16.4.
**Order:** 16.1 → 16.2 → 16.3 → 16.4 → 16.5. 16.4 may go before 16.3 if Tommy wants the assistant earlier; it depends only on 16.1 and 16.2.

## 4. Detailed Change Proposals

### 4.1 Stories (`epics.md`, new Epic 16 appended after Epic 15)

```
## Epic 16: The Packing List

The travellers keep one shared packing list on the trip. They tick it off while packing, and each day shows what to take along that morning. Items found missing on a day go straight onto the list, and the connected assistant works on the same list.

**Rulings (Tommy, 2026-11-08):** one shared list per trip; free categories with suggestions, no tags, no quantities; only the trip list has a checkbox; the day's list is information only; one item, many days; removing from a day only unlinks; deleting from the trip list removes it from every day after a confirmation; contributors can do everything; the day list goes into the day email; connector read/add/tick off/delete/link, marked KI and undoable; copying from any other TravelPlan trip; no file import or export, no per-person lists, no templates, no in-app AI suggestions. See `sprint-change-proposal-2026-11-08-packing-list.md`.

**Shared rules for every story in this epic:**
- Writes go through `packingListRepo`, never Prisma directly, and re-check access per trip: owner and contributor write, viewer reads (FR30, FR32).
- An item's name is trimmed, 1–80 characters, and unique per trip ignoring case. A second "Taucherbrille" resolves to the existing item.
- A category is free text, trimmed, at most 40 characters, optional. An item without a category is shown under "Sonstiges" (de) / "Other" (en). Suggested categories (localized, not stored as a fixed list): Kleidung/Clothing, Technik/Electronics, Hygiene/Toiletries, Dokumente/Documents, Medikamente/Medication, Sonstiges/Other, plus every category already used on the trip.
- Categories are sorted alphabetically, with "Other" last. Items within a category are sorted alphabetically. A packed item stays in place and is shown ticked and struck through.
- All UI text exists in German and English.

### Story 16.1: The Trip's Packing List

As a traveller packing for a trip,
I want one shared packing list on the trip, grouped by category, that I can extend and tick off,
So that we can collect items while planning and see while packing what is already in the suitcase.

**FRs covered:** FR58, FR33 (export carries the list)

**Acceptance Criteria:**

**Given** a trip
**Then** the trip overview shows a "Packliste" / "Packing list" entry with the progress ("18 von 30 eingepackt" / "18 of 30 packed"), and it opens the trip's packing list page
**And** a trip without items shows the entry with "Noch leer" / "Empty yet"

**Given** the packing list page as owner or contributor
**Then** I can add an item with a name and an optional category (category input offers the suggestions from the shared rules)
**And** adding a name that already exists (ignoring case) does not create a second item but highlights the existing one
**And** I can rename an item, change its category, and tick or untick it as packed in one tap
**And** I can delete an item. If it is linked to one or more days, a confirmation names how many days it disappears from ("Auch an 3 Tagen entfernen?" / "Also removed from 3 days?")

**Given** the page
**Then** items are grouped by category with a per-category count ("Technik 4/7")
**And** a filter shows "Alle" / "All" or "Noch offen" / "Not packed yet", remembered per viewer in the browser
**And** the page works one-handed at phone width (tick targets at least 44 px)

**Given** a viewer
**Then** they see the list and its progress, read-only, with no add, edit, tick or delete controls

**Given** the backup export (v2 archive)
**Then** `trip.json` carries `packingItems` (name, category, packed, the day indexes it is linked to)
**And** importing an archive restores them. An archive without `packingItems` still imports.

**Given** the test suite
**Then** it covers add, duplicate name, rename onto an existing name (refused), category change, tick and untick, delete with and without day links, viewer read-only, empty state, and export/import round trip

**Out of scope:** day links (16.2); copying from another trip (16.5); per-person lists, quantities, tags, templates.

### Story 16.2: What the Day Needs

As a traveller on the morning of a day,
I want the day to show what we should take along, and to add things I notice are missing,
So that we don't leave the swimwear behind on the beach day, and the trip list fills up over the days.

**FRs covered:** FR59

**Depends on:** Story 16.1.

**Acceptance Criteria:**

**Given** the day view
**Then** a "Mitnehmen" / "Take along" section lists the items linked to that day, grouped by category, as information only (no checkbox)
**And** each item shows whether it is packed on the trip list (a small packed mark) so a missing item stands out **[default]**
**And** a day without items shows the section collapsed with an "Hinzufügen" / "Add" action for planners, and nothing for viewers

**Given** "Add" on a day, as owner or contributor
**Then** a picker searches the trip's packing list. Picking an item links it to the day.
**And** typing a name that does not exist offers "„Taucherbrille“ neu anlegen" / "Create 'Snorkel mask'" with an optional category. The new item lands on the trip list unpacked and is linked to the day.
**And** typing an existing name (ignoring case) links the existing item, never a duplicate

**Given** "Remove from this day" on an item in the day section
**Then** only the link to this day is removed; the item stays on the trip list and on other days
**And** no confirmation is asked (it can be re-added in one step)

**Given** the trip's packing list page
**Then** each item shows the days it is linked to (short dates) **[default]**

**Given** the trip loses days (re-dated shorter)
**Then** links to the removed days disappear and the items stay

**Given** the test suite
**Then** it covers linking an existing item, creating from the day, duplicate name linking the existing item, unlinking, an item on several days, deleting from the trip list removing every link, a removed day, and viewer read-only

**Out of scope:** a per-day checkbox; linking items to activities instead of days.

### Story 16.3: Take-Along in the Day Email

As a traveller who reads the day offline in my mail app,
I want the day's take-along list in the day email,
So that I see it in the morning without opening the app.

**FRs covered:** FR51 (amended)

**Depends on:** Story 16.2.

**Acceptance Criteria:**

**Given** a day with linked packing items
**When** the day email is built (HTML and text)
**Then** it contains a "Mitnehmen" / "Take along" section after the day's plan, grouped by category, in the email's UI language
**And** a day without items has no such section (no empty heading)

**Given** the test suite
**Then** it covers both languages, HTML and text, a day without items, and HTML escaping of item names and categories

**Out of scope:** a separate packing email; the trip list in the email.

### Story 16.4: The Packing List through the Connector

As someone planning with Claude,
I want Claude to read, add, tick off, delete and link packing items,
So that Claude can draft the list from the trip's activities, places and season, and keep it current with me.

**FRs covered:** FR53, FR54 (packing list, amended 2026-11-08), FR57

**Depends on:** Stories 16.1, 16.2, 15.4.

**Acceptance Criteria:**

**Given** `get_packing_list(tripId, dayId?)`, read-only
**Then** without `dayId` it returns every item: `id`, `name`, `category` (or null), `packed`, `dayIds`, `updatedAt`, `aiChanged`; with `dayId` only the items linked to that day
**And** `get_trip` gains `packing: { total, packed }`, and `get_day` gains `packingItems` (id, name, category, packed)

**Given** `add_packing_items(tripId, items: [{ name, category? }], dayId?)` with 1–50 items
**Then** each name that exists (ignoring case) resolves to the existing item and is not duplicated; new names create unpacked items
**And** with `dayId` every resolved item is linked to that day
**And** the answer lists per input which item it resolved to and whether it was created or existed

**Given** `update_packing_item(tripId, itemId, updatedAt, name?, category?, packed?, addDayIds?, removeDayIds?)`
**Then** it changes only the given fields, under the shared rules (a rename onto an existing name is refused)
**And** a stale `updatedAt` answers "Packing item changed since you read it; read the list again" and writes nothing

**Given** `delete_packing_item(tripId, itemId)`
**Then** it deletes the item and every day link (the confirmation of the UI is the model's job; the description says it removes the item from every day)

**Given** every write here
**Then** it follows the 15.4 rules: one `ai_changes` entry (`tripDayId` null, or the day for a day-scoped add), *not found* for trips the user cannot write, the shared rate limit
**And** `packing_items.ai_changed_at` is set by a connector write and cleared by an app write, and the item shows the KI/AI badge while it is set
**And** every write is undoable through `undo_ai_change` and from the app, unless the item changed since, with a packing receipt (the items' prior state and day links) **[default; FR57]**
**And** the packing list page shows the AI-changes notice for packing changes (list, undo, OK), in the style of the day view's notice **[default]**

**Given** the test suite
**Then** it covers reading the whole list and a day's list, a batch add with an existing name, a day-scoped add, tick, rename refused on a duplicate, link and unlink days, delete, a stale `updatedAt`, undo of each write, badge set and cleared, and a view-only trip answering *not found*

**Given** the production server
**When** deployed (Tommy, manual)
**Then** "Make a packing list for this trip and put the beach things on the beach days" in Claude produces items with KI badges, linked to the right days, and undo in the app removes them

**Out of scope:** an in-app AI suggestion feature; copying between trips as a dedicated tool (the assistant reads one list and adds to the other).

### Story 16.5: Copy from Another Trip

As a traveller starting a new trip,
I want to take over items from another trip's packing list,
So that I don't type the swimwear and chargers again for every trip.

**FRs covered:** FR60

**Depends on:** Story 16.1.

**Acceptance Criteria:**

**Given** the packing list page as owner or contributor
**When** I choose "Aus anderer Reise übernehmen" / "Copy from another trip"
**Then** I can choose any other trip I can see (owner, contributor or viewer), newest first, showing name and dates
**And** I see that trip's items grouped by category, all preselected, with select all / none per category

**When** I confirm
**Then** the selected items are added unpacked, with their category and without day links
**And** names that already exist on this trip (ignoring case) are skipped, and the result says how many were added and how many already existed
**And** the source trip is never changed

**Given** the test suite
**Then** it covers copying all, a partial selection, duplicates skipped, categories kept, packed state and day links not copied, a viewer-only source trip allowed, and a source trip the user cannot see refused

**Out of scope:** file import and export (handled by the assistant through the connector); saved templates.
```

### 4.2 PRD (`prd.md`)

**New subsection after "AI Day Suggestions", before "Planning with an AI Assistant (Connector)":**

```
### Packing List

- FR58: Users can keep one shared packing list per trip. Each item has a name and an optional free category; items are grouped by category. Users who can plan the trip can add, rename, recategorize, tick off as packed and delete items; deleting an item linked to days asks for confirmation and removes it from those days. Viewers see the list read-only. **(Added 2026-11-08 — see Sprint Change Proposal 2026-11-08, Packing List)**
- FR59: Users who can plan a trip can link packing items to a day, or create a new item from a day (it is added to the trip's list, unpacked). The day view shows its linked items as information only, without a checkbox; removing an item from a day only unlinks it. **(Added 2026-11-08)**
- FR60: Users who can plan a trip can copy packing items from any other trip they can see. Copied items arrive unpacked, without day links, and names already on the list are skipped. **(Added 2026-11-08)**
```

**FR51**
OLD: `- FR51: Users can send a day's plan, with a link to the day and the day's document packet attached, to the email address of their own account, so the day is available offline in their mail app. **(Added 2026-10-21)**`
NEW: `- FR51: Users can send a day's plan, including the day's take-along packing items, with a link to the day and the day's document packet attached, to the email address of their own account, so the day is available offline in their mail app. **(Added 2026-10-21; amended 2026-11-08 — take-along items, Story 16.3)**`

**FR53**
OLD: `… stays, travel legs, the bucket list, costs, links, documents and images. …`
NEW: `… stays, travel legs, the bucket list, the packing list, costs, links, documents and images. … **(…; amended 2026-11-08 — packing list, Story 16.4)**`

**FR54**
OLD: `… create, change and delete stays, travel legs, costs and links, and change each day's note, on those trips, …`
NEW: `… create, change and delete stays, travel legs, costs and links, change each day's note, and add, change, tick off, delete and link to days the items of the packing list, on those trips, … **(…; amended 2026-11-08 — packing list, Story 16.4)**`

**Frontmatter:** set `lastEdited: '2026-11-08'` and add an `editHistory` entry: `Added FR58-FR60 (one shared packing list per trip with free categories; take-along items per day, information only; copy from another trip). Amended FR51 (take-along items in the day email), FR53 and FR54 (packing list through the connector). See Sprint Change Proposal 2026-11-08 (Packing List).`

### 4.3 Epics (`epics.md`), other places

- **Requirements inventory** (after FR57): add FR58 to FR60 in the short form used there, and append "the packing list" to FR53 and FR54 there.
- **FR coverage map** (after the FR57 line): `FR58: Epic 16 - The Packing List (Story 16.1, added 2026-11-08)`, `FR59: Epic 16 (Story 16.2)`, `FR60: Epic 16 (Story 16.5)`, and annotate FR51 with `(+ Story 16.3)` and FR53/FR54/FR57 with `(+ Story 16.4)`.
- **Epic list:** add `### Epic 16: The Packing List` with `**FRs covered:** FR58, FR59, FR60 (+ FR51, FR53, FR54, FR57 amendments)`.

### 4.4 Architecture (`architecture.md`)

Add a short section, "Packing list (Epic 16, 2026-11-08)":

- `PackingItem` (`packing_items`): `id`, `tripId` (cascade with the trip), `name`, `nameKey` (lower-cased, trimmed; unique with `tripId`), `category` (nullable), `packed` (bool), `aiChangedAt` (nullable, 15.4 semantics), `createdAt`, `updatedAt`.
- `PackingItemDay` (`packing_item_days`): `packingItemId` + `tripDayId`, both cascading, primary key on the pair.
- The repository `packingListRepo` holds all reads and writes; app routes and connector tools use it, never Prisma directly.
- Connector tools live in `src/lib/mcp/tools/packingTools.ts`. Undo uses a new additive receipt kind, `packingChanged` (still version 3, as in Epics 14 and 15: prior item rows and links, the created item ids), stored in `AiChange.receiptJson` and checked against `updatedAt` before applying.
- Export and import v2: an optional `packingItems` array in `trip.json`, with links stored as `dayIndex` so they survive re-created day ids.
- No external service is called.

### 4.5 UX

- **Trip overview:** a "Packliste" / "Packing list" card or entry with the progress, near the bucket list. It opens a full packing list page (`/trips/[id]/packing`), built for use at phone width while packing.
- **Packing list page:** an add field (name plus category combo box), category groups with counts, ticks, an "All / Not packed yet" filter, and per item its linked days and the KI badge. A "Copy from another trip" action (16.5) and the AI-changes notice (16.4) sit at the top.
- **Day view:** a "Mitnehmen" / "Take along" section with the items grouped by category, a packed mark, "Add" (picker plus create) and "Remove from this day". It has no checkbox.
- **Day email:** a "Mitnehmen" / "Take along" section after the plan.

### 4.6 Sprint status (`sprint-status.yaml`)

```
  epic-16: backlog
  16-1-the-trips-packing-list: backlog
  16-2-what-the-day-needs: backlog
  16-3-take-along-in-the-day-email: backlog
  16-4-the-packing-list-through-the-connector: backlog
  16-5-copy-from-another-trip: backlog
  epic-16-retrospective: optional
```

## 5. Implementation Handoff

- **Scope:** Moderate, a new epic. The PM applies the artifact edits above after approval. The Developer agent then implements story by story through `bmad-create-story` → `bmad-dev-story` → `bmad-code-review`. No architect review is needed: there is no new pattern beyond a new receipt kind, which follows the 15.4 design.
- **Order:** 16.1 → 16.2 → 16.3 → 16.4 → 16.5 (16.4 may move ahead of 16.3).
- **Tommy:** production acceptance of 16.4 (Claude drafts the list, KI badges, undo).
- **Success criteria:**
  - The family packs from one list on the phone, each person ticking their own category, and the progress reaches "30 of 30".
  - On a beach day the day view and the day email show swimwear and snorkel mask.
  - An item created on a day appears on the trip list, unpacked.
  - Claude can draft the list from the trip and link items to days, and every change is marked and undoable.
  - A new trip starts from a previous trip's list in under a minute.

**Open defaults for Tommy to overrule:**
1. Packing changes made through the connector are undoable, unlike bucket-list writes, and the packing page shows an AI-changes notice (16.4).
2. The day's take-along section shows whether each item is already packed (16.2).
3. The trip list shows each item's linked days (16.2).
4. "Remove from this day" asks no confirmation (16.2).
5. Copying allows view-only trips as the source (16.5).
6. The packing list is included in the backup export and import (16.1).
7. An item has at most 80 characters, a category at most 40, and one connector add takes at most 50 items.
