# Sprint Change Proposal — 2026-10-17 (Bucket List as a Parking Lot)

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-17; edits 4.1, 4.2, 4.4 and 4.5 applied. 4.3 reviewed by Winston and applied to `architecture.md` on 2026-10-18 (see section 6). Defaults 5–9 confirmed with approval.
**Related:** Sprint Change Proposal 2026-10-17 (Epic 13, *Days Planned by Duration*), approved earlier today. This proposal depends on it.
**Scope classification:** Moderate, with an architecture review before the first story. One new epic with three stories, two new FRs, two FRs amended. Schema change: `DayPlanItem` can exist without a day, and `TripBucketListItem` is migrated into it and dropped. One recorded ruling is reversed: the bucket list is no longer owner-only on the trip overview (Story 7.12). No shipped story is reverted or renumbered.

---

## 1. Issue Summary

**Overloaded days have no place to put an activity that does not fit, and the bucket list, which could be that place, loses almost everything an activity carries.**

When a day holds more than can be done, the user has two choices today: delete the activity, which loses it, or move it to a specific other day (Stories 6.7, 6.23), which requires knowing which day right now. What is missing is "not today, but not lost": a parking lot.

The bucket list is barely used, and it cannot serve as that parking lot. A bucket item holds only a title, a plain-text description, a place text and coordinates. An activity has a rich description, a link, images, documents, costs, payments and (with Epic 13) a duration. Parking an activity in the bucket list as it stands would throw most of that away.

AI suggestions (Epic 12) have the same gap. A search often returns more good ideas than fit into the day. The ones not taken are gone, and finding them again means another search, another wait and another AI call.

**Trigger:** No triggering story. Raised by Tommy as a product request on 2026-10-17, after the Epic 13 proposal. Category: *new requirement emerged from stakeholder*.

**Evidence:**

- `prisma/schema.prisma:319-335`: `TripBucketListItem` has id, tripId, title, description, positionText, locationLat/Lng/Label and stamps. It has no images, documents, payments, link, rich content or duration.
- `prisma/schema.prisma:204-230`: `DayPlanItem` has all of those, and `DayPlanItemImage`, `DayPlanItemDocument` and `CostPayment` hang off it.
- `dayPlanItemRepo.ts:597-697`: bucket → day exists (Story 4.2) as a conversion. It creates a new item, copies title, description and coordinates, and deletes the bucket row. Day → bucket does not exist anywhere.
- `TripDaySuggestionsDialog.tsx:122-124, 309-390`: suggestions are ticked and applied. Unticked suggestions are dropped when the dialog closes.
- Image files live under `/uploads/trips/<tripId>/days/<tripDayId>/day-plan-items/<itemId>/` and the delete path checks that folder (`mediaCleanup.ts:11-38`). Copying an activity into a different table would mean re-homing files.

---

## 2. Impact Analysis

### The central design decision

**A parked activity is an activity without a day.** (Tommy's ruling, 2026-10-17.)

The bucket list becomes the list of the trip's activities that have no day. Parking an activity and scheduling it back change only which day it belongs to. Nothing is copied, so nothing can be lost: images, documents, costs, payments, link, rich description and duration stay on the same row with the same id. The existing bucket ideas are migrated into this shape, so afterwards there is one kind of entry, edited with one dialog.

Alternatives considered and rejected:

- **Extend `TripBucketListItem`** with every activity field plus its own image, document and payment tables. This duplicates the model and its media handling, and every park or schedule becomes a copy across tables. That is the most expensive and most fragile option.
- **Two kinds side by side** (plain ideas and parked activities in one list). This needs every bucket surface, the backup and the receipts to handle two shapes forever.

### Epic impact

| Epic | Impact |
|---|---|
| Epic 14 (new): The Bucket List as a Parking Lot | Created. Receives Stories 14.1–14.3. |
| Epic 4: Trip Bucket List | Shipped. Its capability is kept, and its data model is replaced by 14.1. Story 4.2's "+" now *moves* the parked activity onto the day instead of converting a bucket row. |
| Epic 13: Days Planned by Duration | Backlog. A prerequisite. Parking needs flexible activities and the `scheduleDay` recompute: a parked activity is always flexible, and scheduling it back appends it and recomputes the day. 13.1's AC *"a bucket-list take-over … a flexible one is appended at the end of the day"* is exactly the scheduling path. |
| Epic 12: AI Suggestions for the Day | Shipped. The apply step gains a per-suggestion choice between scheduling and parking (14.3), built on 13.4's flexible apply. |
| Epic 7: Story 7.12 | Shipped. Its AC *"a viewer and a contributor see no bucket-list card"* is superseded for contributors (see *Rulings superseded*). |
| Epic 2: Stories 2.31, 2.32 (backup) | Shipped. The backup carries parked activities with all their data, and old backups' bucket items import into the new shape (14.1). |
| Epic 6: Stories 6.7, 6.23 (move to another day) | Unchanged. Parking is a sibling action in the same menu. |
| Epics 1, 3, 5, 8–11 | No impact beyond what Epic 13 already changes. |

**Why a new epic rather than stories in Epic 4 or 13.** Epic 4 is closed and its charter is idea capture. Epic 13 changes how a day is computed. This changes where an activity can live. Each of the three stories ships something usable on its own.

### Rulings superseded

| Ruling (date) | Was | Now |
|---|---|---|
| Story 7.12 (2026-08-01) | The trip-overview bucket-list card is owner-only; viewers and contributors see no card. | **Everyone who can plan (owner and contributor) sees the bucket list on both surfaces and can park, schedule, add and edit.** Viewers still see no bucket list. Anyone allowed to plan a day must be able to see where its activities were parked. This also aligns the card with Story 8.x (*content yes, possession no*), which already gave contributors bucket-list writes. |
| Story 4.1 (FR30 in `epics.md`) | Bucket items have a title, a description and a position text. | Bucket items are activities without a day and carry every activity field. |
| Story 4.2 (FR31 in `epics.md`) | Adding a bucket item to a day creates a new day item and deletes the bucket item. | Scheduling moves the same activity onto the day. Its id, media, documents and payments are unchanged. |

The 2026-08-01 rulings on the card's **height cap** and **compact empty state** (7.12) stay as they are.

### Story impact

| Story | Change |
|---|---|
| 14.1 | **New.** One kind of entry. Migration of bucket items into day-less activities; bucket panels list them with picture and duration; add and edit through the activity dialog; "+" moves the activity onto the day; contributors see the bucket list; backup round-trip. |
| 14.2 | **New.** *Parken* in the day's activity menu. The activity leaves the day with everything it carries and becomes flexible; the day is recomputed; one *Rückgängig* restores it. |
| 14.3 | **New.** In the suggestions preview, each selected suggestion is either scheduled or parked; parked ones arrive in the bucket list with their pictures and duration. |
| 4.1, 4.2, 7.12 | Shipped. Supersession markers (see 4.2). Their tests are rewritten against the new model, not deleted. |
| 13.1 | Backlog. Unchanged. Its bucket take-over AC is satisfied by 14.1's move path once 14.1 lands. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `prd.md` | FR35 and FR36 (*Idea Capture & Logbook*) amended. New FR48 (park an activity) and FR49 (park suggestions). `editHistory` entry. |
| `epics.md` | Requirements Inventory: FR30, FR31 amended; FR48, FR49 appended. FR Coverage Map updated. Epic List gains Epic 14. New `## Epic 14` section. Supersession markers on 4.1, 4.2 and 7.12. |
| `architecture.md` | *Data Architecture*: activities without a day, `tripId` on `DayPlanItem`, `TripBucketListItem` dropped, media path rule. *API & Communication Patterns*: receipt kinds for park and schedule. Requires Winston's review. |
| `DESIGN.md` | New `bucket-item` spec (thumbnail and duration) and `park-choice` (suggestion card toggle). |
| `EXPERIENCE.md` | Bucket List rows: owner-only replaced by *who can plan*. New row: *Parking an activity*. |
| `sprint-status.yaml` | New `epic-14` block. |

### Technical impact

**Schema (one migration, SQL-only, like 13.1's):**

- `DayPlanItem.tripId` (not null, FK to `Trip`, cascade), backfilled from `tripDay.tripId`. This is needed because a day-less row has no other path to its trip.
- `DayPlanItem.tripDayId` becomes nullable. **Invariant:** `tripDayId IS NULL` ⇔ the activity is parked. A parked activity is always `FLEXIBLE`, has `fromTime`/`toTime = null`, and has no travel legs.
- Each `TripBucketListItem` row becomes a `DayPlanItem` with `tripDayId = null`, `FLEXIBLE`, **15 minutes** (FR46's default, same as 13.1's backfill), title, coordinates and label copied, and `contentJson` built from description and position text exactly as `buildBucketListContentJson` does today. The `id` is kept, so open receipts stay meaningful.
- `TripBucketListItem` is dropped after the copy.
- `sortOrder` for parked rows is unused. The bucket list keeps its alphabetical order (Story 4.1).

**Readers that must exclude parked rows.** Every reader that reaches activities through a day is unaffected. Every reader that reaches them through the trip must filter `tripDayId IS NOT NULL`: trip cost totals and budget runway, the trip overview gantt and route, the trip map, document packet, print, adjacency, and AI suggestion context. Winston should confirm the list. Code review should check every `dayPlanItem` query by `tripId`.

**Costs of parked activities do not count** in "Kosten bisher", the budget runway or any total. They are not planned. They stay on the activity and count again as soon as it is scheduled. *(John's default; confirm with approval.)*

**Media.** Files stay where they are. URLs are stored as-is, so a parked or rescheduled activity keeps working images and documents. The managed-file rule (`mediaCleanup.ts`) changes from *"the file's parent folder is this item's folder under this day"* to *"the file's parent folder is this item's folder under any day of this trip, or under the trip's `parked/` folder"*. New uploads to a parked activity go to `/uploads/trips/<tripId>/parked/day-plan-items/<itemId>/`. Winston decides the exact rule.

**Receipts and undo.** Two write paths are new or changed:

- **Park** (14.2): the activity's `tripDayId` becomes null and its mode becomes flexible; its legs are deleted and the sweep runs; the day is recomputed. The receipt gets a new `edited.kind: "parked"` with the previous `tripDayId`, `scheduleMode`, `sortOrder`, `fromTime`/`toTime` and `updatedAt`, plus the usual `movedItems` and `removedTravelSegments`. Undo puts it back exactly.
- **Schedule** (14.1): `edited.kind: "created"` with `consumedBucketListItem` is replaced by `edited.kind: "scheduled"` (previous `tripDayId = null`, `updatedAt`). Undo returns it to the bucket list. `TripBucketListItemRow`, `bucketListRowSchema` and the `consumedBucketListItem` branches in `dayPlanChangeRepo.ts` are removed.

The exhaustive `never` defaults in the receipt switches make the compiler find every place that must handle the new kinds. Whether this is receipt v4 or new kinds within 13.1's v3 depends on whether 13.1 has shipped when 14.1 starts. Winston decides.

**Suggestions (14.3).** The apply request gains a per-suggestion `target: "day" | "parked"`. Parked suggestions are created as day-less flexible activities, with their duration rounded up to 5 minutes and their pictures downloaded as today (Wikimedia URLs are never stored). They get no legs and are not part of the day's order, preview chain or fingerprint. If every selected suggestion is parked, the day is not written at all. The 409 `day_plan_changed` check still applies when at least one is scheduled. Undo of `suggestionsApplied` removes the parked ones too.

**Test impact.** The bucket tests (`bucketListRepo`, `bucketListRoute`, `tripBucketListPanel`) are rewritten against day-less activities. `dayPlanChangeUndo` and `dayChangeReceipt` gain park and schedule cases. `tripBackupRoundTrip` gains a parked activity with images, a document and a payment. The migration test compares every former bucket row with its new activity row.

### UX impact

**Day view, activity menu:** *Parken* sits next to *Auf anderen Tag verschieben*. There is no confirmation dialog, because the action can be undone. The `action-notice` reads *"„Wasserfall" geparkt · 2 Aktivitäten verschoben"* with *Rückgängig*.

**Bucket-list rows** (both surfaces): the first picture as a small square thumbnail (sharp corners, per the photography rule), the title, and one meta line with the duration and the place (*"1 Std · Gullfoss"*). An activity without pictures shows no placeholder. The "+" on Day Detail schedules it onto this day.

**Add and edit:** both bucket panels open the activity dialog (`TripDayPlanDialog`) in *parked* mode. *Wann & Wo* shows only the duration and the place; *Feste Zeit* is not offered, because a parked activity has no day to be fixed on. Every other tab (description, link, pictures, documents, costs) works as on a day. This replaces the bucket panel's own small dialog, so editing a parked activity can never flatten its rich description.

**Suggestions preview:** each ticked card gets a `park-choice` toggle *Einplanen* / *Parken*, defaulting to *Einplanen*. The preview timeline shows only the ones being scheduled. The apply button names both counts: *"3 einplanen · 2 parken"*. With only parked ones it reads *"2 parken"*.

---

## 3. Recommended Approach

**Option 1, Direct Adjustment: add Epic 14 with three stories after Epic 13.1. Selected.**

- **Effort:** Medium. 14.1 is the largest: the migration, the trip-level reader filters, the media rule, the two bucket panels moving to the activity dialog, and the backup. 14.2 is small once 14.1 stands, because it reuses the delete path's leg sweep and 13.1's recompute. 14.3 is small to medium.
- **Risk:** Medium. The main risk is a trip-level reader that forgets to exclude parked rows, so that a parked activity shows up in totals or on the route. This is mitigated by one shared repository predicate and a code-review check. The migration is low risk: it adds rows and drops a small table, and every former bucket item can be compared one to one.

**Option 2, Potential Rollback: not viable.** Nothing shipped stands in the way. Epic 4's surfaces are kept and re-pointed.

**Option 3, PRD MVP Review: not required.** The MVP is long shipped. This amends two FRs and adds two.

**Sequencing:**

- 14.1 and 14.2 depend on **13.1** (flexible activities, `scheduleDay`, receipt v3).
- 14.3 depends on **13.4** (suggestions applied as flexible activities) and on 14.1.
- Recommended order: 13.1 → 14.1 → 14.2 → 13.2 → 13.3 → 13.4 → 14.3. Parking relieves overloaded days, which 13.2 makes visible, so it is worth having early.

**Why each story ships on its own:**

- After 14.1, the bucket list holds full activities, contributors can use it, and scheduling keeps everything. Nothing can be parked yet, but new ideas can carry pictures and a duration.
- 14.2 adds parking: the overloaded-day case is solved.
- 14.3 adds parking suggestions: no more searching again.

---

## 4. Detailed Change Proposals

### 4.1 PRD: `prd.md`

**Section:** *Idea Capture & Logbook*

OLD:
```
- FR35: Users can capture ideas or places in an inbox for later placement.
- FR36: Users can assign captured ideas to specific days.
```

NEW:
```
- FR35: Users can capture ideas or places in a trip-level bucket list for later placement. A bucket-list entry is an activity without a day: it carries everything an activity carries (title, description, link, pictures, documents, costs, duration, place), and its costs do not count in any total while it has no day. **(Amended 2026-10-17 — see Sprint Change Proposal 2026-10-17, Bucket List as a Parking Lot)**
- FR36: Users can schedule a bucket-list entry onto a specific day; it becomes an activity of that day with all its data and is placed under FR42. **(Amended 2026-10-17)**
- FR48: Users who can plan a trip can park an activity of a day in the bucket list. It leaves the day with all its data, becomes flexible with its duration, the day is recomputed under FR42, and the parking can be undone in one step. **(Added 2026-10-17 — see Sprint Change Proposal 2026-10-17, Bucket List as a Parking Lot)**
```

**Section:** *AI Day Suggestions*, after FR45:
```
- FR49: When applying suggestions, users choose for each selected suggestion whether to schedule it on the day or park it in the bucket list. Parked suggestions keep their title, description, place, pictures and duration. **(Added 2026-10-17)**
```

**Frontmatter:** `editHistory` entry:
```
  - date: '2026-10-17'
    changes: 'Amended FR35-FR36 (bucket list entries are activities without a day). Added FR48 (park an activity) and FR49 (park AI suggestions). See Sprint Change Proposal 2026-10-17, Bucket List as a Parking Lot.'
```

### 4.2 Epics: `epics.md`

**Requirements Inventory** (`epics.md` numbers the bucket-list FRs FR30/FR31; the PRD numbers them FR35/FR36):

```
FR30: Users can add, view, edit, and delete trip-level bucket list entries. An entry is an activity without a day and carries everything an activity carries. (Amended 2026-10-17)
FR31: Users can schedule a bucket list entry onto a day; it moves there with all its data. (Amended 2026-10-17)
FR48: Users who can plan a trip can park an activity of a day in the bucket list, keeping all its data; the day is recomputed and the parking can be undone.
FR49: When applying AI suggestions, users choose for each selected suggestion whether to schedule it or park it in the bucket list.
```

**FR Coverage Map:**
```
FR30: Epic 4 - Trip Bucket List (Idea Capture); Epic 14 - The Bucket List as a Parking Lot (amended 2026-10-17)
FR31: Epic 4; Epic 14 (amended 2026-10-17)
FR48: Epic 14 - The Bucket List as a Parking Lot
FR49: Epic 14 - The Bucket List as a Parking Lot
```

**Epic List**, after Epic 13:
```
### Epic 14: The Bucket List as a Parking Lot
Users park what does not fit into a day, an activity or an AI suggestion, in the bucket list with everything it carries, and schedule it onto another day later without retyping anything.
**FRs covered:** FR30 (amended), FR31 (amended), FR48, FR49
```

**Supersession markers** (original text left in place, quote block appended, following the 8.5 AC2 precedent):

- **Story 4.1**, the AC *"Given I add a bucket list item with title, description, and position text"*:
  > **Superseded 2026-10-17 by Story 14.1** (Sprint Change Proposal 2026-10-17, Bucket List as a Parking Lot). A bucket-list entry is an activity without a day, added and edited through the activity dialog.
- **Story 4.2**, the AC *"any lat/long stored with the bucket item is copied"* and *"the bucket list item is removed from the bucket list"*:
  > **Superseded 2026-10-17 by Story 14.1.** Scheduling moves the same activity onto the day; nothing is copied or deleted.
- **Story 7.12**, the AC *"its owner-only gating is preserved exactly — a viewer and a contributor see no bucket-list card"*:
  > **Superseded 2026-10-17 by Story 14.1** for contributors: everyone who can plan sees the bucket-list card. Viewers still see none.

**New section**, appended after Epic 13:

```markdown
## Epic 14: The Bucket List as a Parking Lot

Users park what does not fit into a day, an activity or an AI suggestion, in the bucket list with everything it carries, and schedule it onto another day later without retyping anything.

### Story 14.1: One Kind of Entry

As someone collecting ideas for a trip,
I want a bucket-list entry to be a full activity that simply has no day yet,
So that pictures, documents, costs and duration are never lost on the way to a day and back.

**FRs covered:** FR30 (amended), FR31 (amended)

**Depends on:** Story 13.1. Architecture review of the schema and media rule before this story is contexted.

**Context:** Today a bucket item is a separate, much thinner record (`TripBucketListItem`), and scheduling it converts it into a new activity. This story makes the bucket list the set of the trip's activities without a day, migrates the existing ideas into that shape, and makes scheduling a move. Rulings (Tommy, 2026-10-17): a bucket entry is an activity without a day; parked activities are flexible; everyone who can plan sees and uses the bucket list.

**Acceptance Criteria:**

**Given** the migration
**Then** `DayPlanItem` gains `tripId` (not null, backfilled from its day) and `tripDayId` becomes nullable; every `TripBucketListItem` becomes a `DayPlanItem` with the same id, `tripDayId = null`, `FLEXIBLE`, 15 minutes, its title, coordinates and label, and a `contentJson` built from description and position text as `buildBucketListContentJson` does today; and `TripBucketListItem` is dropped

**Given** a former bucket item
**Then** its new row carries the same title, place and text (migration test compares every row)

**Given** an activity without a day
**Then** it is `FLEXIBLE`, has no times and no travel legs, and no reader that works through the trip (cost totals and budget runway, trip overview gantt and route, trip map, print, document packet, suggestion context) includes it

**Given** the bucket list on the trip overview and on Day Detail
**Then** it lists the trip's activities without a day in alphabetical order; each row shows the first picture as a sharp-cornered thumbnail if there is one, the title, and a meta line with duration and place ("1 Std · Gullfoss")

**Given** an owner or a contributor
**Then** they see the bucket list on both surfaces and can add, edit, delete and schedule; a viewer sees no bucket list

**Given** *Idee hinzufügen* or a row's edit action
**Then** the activity dialog opens in parked mode: *Wann & Wo* shows only duration and place, *Feste Zeit* is not offered, and every other tab (description, link, pictures, documents, costs) works as on a day

**Given** a picture or document added to a parked activity
**Then** it is stored under the trip's `parked/` folder and can be deleted; pictures and documents from an earlier day keep working and can be deleted too

**Given** the "+" on a Day Detail bucket row
**Then** the same activity, with its id, pictures, documents, costs and payments, moves onto this day, is appended at the end as a flexible activity, the day is recomputed, the activity leaves the bucket list, and the notice offers *Rückgängig*, which returns it to the bucket list exactly

**Given** a backup export
**Then** parked activities are exported with all their data, including pictures, documents and payments

**Given** a backup from before this change, with bucket items
**Then** each becomes a parked activity by the same rule as the migration, and a backup with parked activities round-trips exactly

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string, and keys only the old bucket dialog used are removed

### Story 14.2: Park It for Another Day

As someone whose day holds more than it can,
I want to move an activity out of the day into the bucket list with one action,
So that the day works again and the activity waits, complete, for a day that has room.

**FRs covered:** FR48

**Depends on:** Story 14.1.

**Acceptance Criteria:**

**Given** an activity on a day and a user who can plan
**When** *Parken* is chosen from its menu
**Then** it leaves the day with all its data; it becomes flexible, keeping its duration (a fixed one keeps `toTime − fromTime`); its travel legs are deleted and no-longer-consecutive legs are swept; the day is recomputed, so later flexible activities move earlier; and it appears in the bucket list

**Given** a parking
**Then** the notice reads "„Wasserfall" geparkt" plus the moved count if any, and *Rückgängig* restores the day exactly, including the activity's day, mode, times, order and the removed legs (whole-DB `toEqual`), refusing as `409 undo_stale` if any named row has changed

**Given** a parked activity scheduled onto another day (14.1)
**Then** it arrives with the same pictures, documents, costs, payments, link, description and duration it had before parking

**Given** a viewer
**Then** *Parken* is not offered

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string

### Story 14.3: Park the Suggestions Too

As someone who got more good suggestions than fit into today,
I want to park the extra ones instead of losing them,
So that I don't have to search for them again for another day.

**FRs covered:** FR49

**Depends on:** Stories 13.4 and 14.1.

**Acceptance Criteria:**

**Given** the suggestions preview with ticked suggestions
**Then** each ticked card shows a `park-choice` toggle *Einplanen* / *Parken*, defaulting to *Einplanen*; the preview timeline, order and legs include only the ones being scheduled; and the apply button names both counts ("3 einplanen · 2 parken", or "2 parken" alone)

**Given** the apply
**Then** scheduled suggestions are applied as in 13.4; each parked one becomes an activity without a day, flexible, with its suggested duration rounded up to 5 minutes, its title, description, place and coordinates, and its pictures downloaded and stored as for scheduled ones; parked ones get no legs

**Given** an apply in which every suggestion is parked
**Then** the day is not written, no `day_plan_changed` check applies, and the suggestions appear in the bucket list

**Given** *Rückgängig* after an apply
**Then** both the scheduled and the parked activities, with their pictures and legs, are removed in one step

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string
```

### 4.3 Architecture: `architecture.md` *(requires Winston's review before 14.1 is contexted)*

**Data Architecture**, append:
```
- **Activities without a day (2026-10-17, Epic 14):** The bucket list is the set of a trip's `DayPlanItem` rows with `tripDayId = null`; `TripBucketListItem` is migrated into it and dropped. `DayPlanItem` carries `tripId` (not null) so a day-less row still belongs to its trip. Invariant: `tripDayId IS NULL` ⇔ parked ⇒ `FLEXIBLE`, `fromTime`/`toTime` null, no travel legs. Readers that reach activities through a day are unaffected; readers that reach them through the trip use one shared repository predicate that excludes parked rows. Parking and scheduling change `tripDayId` only, so media, documents and payments never move between tables. Media files keep their stored URLs; the managed-file rule accepts the item's folder under any day of the trip or under `uploads/trips/<tripId>/parked/day-plan-items/<itemId>/`, where uploads to a parked activity go.
```

**API & Communication Patterns**, the receipt line: append *"Since 2026-10-17 (Epic 14), parking an activity writes `edited.kind: "parked"` and scheduling a bucket-list entry writes `edited.kind: "scheduled"`; `consumedBucketListItem` is removed. Applying suggestions may create parked activities, which its receipt lists with the others."*

**Open points for Winston:** the column set and migration order; the exact media rule; receipt v3 vs v4; the full list of trip-level readers that must apply the parked predicate.

### 4.4 Design system: `DESIGN.md`, `EXPERIENCE.md`

**`DESIGN.md` → Components**, after `plan-conflict`:
```
- **bucket-item** — One row of the bucket-list card, on Trip Overview and Day Detail. Left: the activity's first picture as a 40px square thumbnail at {rounded.photo} (it is photography); no placeholder when there is none. Then the title in {typography.body} 600-weight and one meta line in {colors.ink-soft}: duration and place, separated by " · " ("1 Std · Gullfoss"). On Day Detail the trailing "+" (24px glyph, ≥44×44px hit area) schedules the activity onto this day. The row's divider follows the card's `:last-child` rule.

- **park-choice** — A two-segment toggle on a ticked suggestion card in the suggestions preview: *Einplanen* / *Parken*. Same treatment as `schedule-mode` at a compact height inside the card; selected segment in {colors.accent-soft}. Shown only while the card is ticked.
```

**`EXPERIENCE.md`:**

- Surfaces table, Trip Overview row: replace *"bucket list (owner only — a viewer and a contributor see cost summary, route map, gap alert)"* with *"bucket list (everyone who can plan — a viewer sees cost summary, route map, gap alert)"*.
- Line 39: replace *"the Bucket List in both Trip Overview's (owner only) and Day Detail's sidebar"* with *"the Bucket List in both Trip Overview's and Day Detail's sidebar (everyone who can plan)"*.
- Add a row to the state/interaction table:
```
| Parking an activity | Day Detail, activity menu *Parken* (FR48); suggestions preview, `park-choice` (FR49) | The activity leaves the day with everything it carries and appears in the bucket list; the day recomputes. No confirmation, because the `action-notice` offers *Rückgängig*. A parked activity has no day and therefore no fixed time; it is scheduled back with the bucket row's "+". |
```

### 4.5 Sprint status: `sprint-status.yaml`

Appended after the `epic-13` block:
```yaml
  epic-14: backlog
  14-1-one-kind-of-entry: backlog
  14-2-park-it-for-another-day: backlog
  14-3-park-the-suggestions-too: backlog
  epic-14-retrospective: optional
```

---

## 5. Implementation Handoff

**Scope: Moderate**, with one architecture checkpoint.

| Recipient | Responsibility |
|---|---|
| John (PM), this session | Apply 4.1, 4.2, 4.4 and 4.5 once this proposal is approved. |
| Winston (Architect), `bmad-agent-architect` | Before 14.1 is contexted, review the schema (nullable `tripDayId`, `tripId`, dropping `TripBucketListItem`), the parked predicate and its readers, the media rule, and the receipt kinds. Then apply 4.3. |
| `bmad-create-story` | Create 14.1 after 13.1 is done, then 14.2. Create 14.3 after 13.4. |
| Developer agent / `bmad-dev-story` | In 14.1, write the migration and its row-by-row test first, then the shared parked predicate and every trip-level reader, then the panels. |
| Code review | Check that every `dayPlanItem` query by `tripId` excludes parked rows, that no path copies an activity between tables, and that parking and scheduling recompute the day in the same transaction. |

**Success criteria:**

1. On an overloaded day, *Parken* on a 2-hour activity with three pictures, a PDF ticket and a cost of €25 removes it from the day, moves the later flexible activities 2 hours earlier plus the leg, and drops €25 from "Kosten bisher".
2. Scheduling it onto another day via "+" brings back the same three pictures, the ticket, the €25 and the 2 hours, without typing anything.
3. One *Rückgängig* after parking restores the original day exactly.
4. In the suggestions preview, ticking five suggestions and setting two to *Parken* schedules three on the day and puts two, with their pictures and durations, in the bucket list.
5. After the migration, every former bucket idea is in the bucket list with its title, text and place.
6. A contributor sees and uses the bucket list on the trip overview; a viewer does not see it.

**Decisions recorded (Tommy, 2026-10-17):**

| # | Question | Ruling |
|---|---|---|
| 1 | What a bucket entry is | An activity without a day. Old ideas are migrated; one kind of entry. |
| 2 | Parking a fixed activity | It becomes flexible with its duration. A booking is for a date, so its time is usually wrong on another day. It can be made fixed again after scheduling. |
| 3 | Who parks and sees the bucket list | Everyone who can plan (owner and contributor), on both surfaces. Viewers do not. Reverses 7.12's owner-only card. |
| 4 | Suggestions | Per selected suggestion in the preview: *Einplanen* or *Parken*. |

**Defaults set by John, to confirm with approval:**

| # | Question | Default |
|---|---|---|
| 5 | Costs of parked activities | Not counted in any total or the budget until scheduled. |
| 6 | Bucket list order | Alphabetical, as today. |
| 7 | Duration of migrated ideas | 15 minutes (FR46's default). |
| 8 | Confirmation before parking | None; undo instead. |
| 9 | Scheduling from the trip overview (a day picker on the bucket row) | Out of scope. Scheduling happens from the day's "+". Can be a later story. |

---

## 6. Architecture Review (Winston, 2026-10-18)

Edit 4.3 was applied to `architecture.md` (*Data Architecture → Activities without a day*, *API & Communication Patterns → Parking and scheduling*) with these decisions on the open points:

| Open point | Decision |
|---|---|
| Columns and migration order | `tripId` not null with cascade; `tripDayId` nullable, still cascade (deleting a day deletes its activities, it does not park them). One SQL-only migration: rebuild `day_plan_items` (SQLite cannot drop NOT NULL), backfill `trip_id` from `trip_days`, insert bucket rows with the same id, drop `trip_bucket_list_items`. A SQL `CHECK` guards the parked invariant. |
| Media rule | URLs are never rewritten. Uploads go to the item's current place (`days/<d>/…` or `parked/…`). One URL-derived rule accepts the item's folder under any day of the trip or under `parked/`. It replaces `readStoredMediaDayId` and the undo's `receipt.tripDayId` folder. Deleting a parked activity removes its files, because there is no undo. |
| Receipt v3 or v4 | **v3**, with the new kinds `scheduled` and `parked`. This follows 11.3, 11.4 and 12.4. `consumedBucketListItem` is removed, and an old receipt carrying it is refused as invalid. New endpoints: `day-plan-items/schedule` (14.1) and `day-plan-items/park` (14.2). |
| Trip-level readers | Every current trip-level reader goes through the day relation, so parked rows are already excluded. The rule: only bucket-list reads query `DayPlanItem.tripId`. Future readers by `tripId` use the shared predicates. The ones that must *include* parked rows are export/import, the overwrite import's delete step, and the per-item media gates. |
| Backup | `FORMAT_VERSION` stays 2. The export writes `trip.parkedDayPlanItems[]`. Legacy `bucketListItems` are still imported, by the migration rule. |

**Correction to section 2, *Rulings superseded*:** the trip-overview bucket card has not been owner-only since Story 5.13. `TripTimeline.tsx` gates it with `canEditPlanning`, which means owner or contributor, and the bucket-list API already lets contributors write. So 14.1 changes nothing about who sees the list. Its AC on roles becomes a regression guard.
