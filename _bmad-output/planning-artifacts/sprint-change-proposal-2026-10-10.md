# Sprint Change Proposal — 2026-10-10

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-10; edits 4.1–4.5 applied.
**Scope classification:** Moderate. One new epic, three new stories, two new FRs, one new design-system component, and one shipped rule (Story 8.5, AC2) superseded. No schema migration. No implemented work is reverted and no story is renumbered.

---

## 1. Issue Summary

**A day's plan does not keep itself consistent. Every knock-on effect of a time change is left for the user to clean up by hand.**

Two symptoms, one cause:

1. **Travel legs that no longer fit stay behind.** A retimed or inserted activity changes the order of the day, so a travel leg's two endpoints are no longer adjacent. Story 8.5 deliberately keeps that row and lists it under *Verwaiste Reiseabschnitte* in the day summary panel, where it has to be removed manually. In practice such a leg has never been revived: it describes a trip between two places that are no longer consecutive. It is noise the user deletes every time.
2. **Inserting or extending an activity does not move the rest of the day.** If you add a 90-minute stop at 11:30, every activity after it keeps its old time. The day then overlaps itself, and each later activity has to be opened and retimed one by one, with the travel time between them worked out by hand.

Both come from the same gap. The day's order is derived from `fromTime` alone. Nothing recalculates the day when one time changes, and nothing lets the user change the order other than by typing times.

**Trigger:** No triggering story. Raised by Tommy as a product request after Epic 10 closed. Category: *new requirement emerged from stakeholder*. It also reverses one recorded design decision (Story 8.5, AC2), with that decision's own reasoning re-examined below.

**Evidence:**

- `src/lib/trips/dayPlanItemOrder.ts:67-86` — `compareDayPlanItemsByStartTime` is the only source of order: timed activities by `fromTime`, untimed ones after them, ties broken by `createdAt`, then `id`. There is no `sortOrder` column (`prisma/schema.prisma:201-227`).
- `prisma/schema.prisma:152-171` — `TravelSegment` stores two endpoint ids, a `durationMinutes`, and no time of its own. A leg is placed by adjacency and nothing else.
- `src/lib/repositories/dayPlanItemRepo.ts:547-612` — `updateDayPlanItemForTripDay` updates the one row and touches no other activity and no leg.
- `src/components/features/trips/TripDayView.tsx:3702-3810` — the orphan block, and its handler `handleRemoveOrphanSegment` at `:1150-1300`, which asks for confirmation and removes one leg at a time.
- `epics.md:3211-3233` — Story 8.5, AC2: *"the segment survives with its mode, duration and distance intact — it is not silently deleted."*
- A search of the codebase for *reorder, shift, cascade, drag* finds only gallery reordering. Activities can be moved *between* days (Stories 6.7, 6.23) but not within one.
- No undo affordance exists anywhere in the app. `EXPERIENCE.md:88` defines a toast/banner only for failures.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 11 (new) — Day Plans That Recalculate Themselves | Created. Receives Stories 11.1, 11.2 and 11.3. |
| Epic 8 — Maintenance & Infrastructure | Story 8.5 is shipped and stays shipped. AC2 is superseded by 11.1. AC1 (stay deletion removes its legs), AC3/AC4 (the orphan list and its remove control) and AC5 (import fidelity) remain in force. The orphan list becomes a safety net instead of a daily chore. |
| Epics 1–7, 9, 10 | No impact. |

**Why a new epic and not three stories in Epic 6.** Epic 6's charter is *"focused UX improvements … without changing the core product model"*. This changes the model: a time edit stops being a single-row update and becomes a recalculation of the day, with a change set that can be undone. That is the same argument that produced Epics 9 and 10.

### Story impact

| Story | Change |
|---|---|
| 11.1 | **New.** Legs that a change leaves non-adjacent are deleted in the same transaction. The whole change can be undone from a notice. Introduces the *change receipt* that 11.2 and 11.3 reuse. |
| 11.2 | **New.** Saving a time pushes later activities back as far as needed and no further, counting travel durations. Time edits never change the order. |
| 11.3 | **New.** *Nach oben / Nach unten* in an activity's menu swaps it with its neighbour and recalculates the times. |
| 8.5 | Shipped. AC2 superseded by 11.1 (see *Artifact conflicts*). Its distinction between *"endpoint ceased to exist"* and *"only adjacency changed"* collapses: both now delete. |
| 6.18 | Shipped. The time input is reused as is. 11.2 adds a validation outcome to it (see below); it does not change how a time is entered. |
| 6.23, 6.7 | Shipped. Moving between days already deletes the moved activity's legs and reports `removedTravelSegmentIds`. Unchanged; they are not routed through the new undo. |
| 2.23, 6.5 | Shipped. Leg creation and Google Maps auto-fill are unchanged. Legs that 11.1 deletes are not recreated automatically; a new pair gets a leg the way it does today. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `prd.md` | Two new FRs, **FR42** and **FR43**, appended to *Day Plans (Rich Text + Links)* after FR21. `lastEdited` set to `2026-10-10`. No NFR changes. |
| `epics.md` | Requirements Inventory and FR Coverage Map gain FR42 and FR43. Epic List gains Epic 11. New `## Epic 11` section appended after Epic 10. Story 8.5's AC2 gets an inline *superseded by Story 11.1 (2026-10-10)* marker, following the strike-through precedent used for FR31. |
| `DESIGN.md` | New `action-notice` component: a non-error notice that carries one action (*Rückgängig*). It is the first of its kind; see *UX impact*. |
| `EXPERIENCE.md` | The *Save-failure / error feedback* row (`:88`) gains a sibling row, *Change with side effects*, that points to `action-notice`. |
| `sprint-status.yaml` | New `epic-11` block: 11.1, 11.2, 11.3, retrospective. Appended after `epic-10`, so file order encodes 11.1 → 11.2 → 11.3. |
| `architecture.md` | *API & Communication Patterns* gains one line: the plan-item write endpoints return a change receipt alongside the item, and one new endpoint applies it in reverse. *Data Architecture*: no change. Order stays derived from `fromTime`; see *Technical impact*. |
| `deferred-work.md` | **DW-216** (a private copy of the order comparator in `dayPlanItemRepo.ts`) is bundled into 11.2, which needs the canonical comparator on the server. **DW-320** (the print sheet omits orphaned legs) loses most of its weight, because orphans become rare; it stays open, unchanged. |

### Technical impact

**No `sortOrder` column is needed, and this is the most important design point.**

Tommy's ruling is that a time edit never changes the order of the day. Together with the push rule, this keeps the existing invariant intact: the timed activities, read in order, always have non-decreasing start times, because every push moves a later activity to *at least* the end of the one before it. `compareDayPlanItemsByStartTime` therefore still returns the correct order after every operation in this epic. A `sortOrder` column would be a second source of truth for the same fact, to be kept in sync on every write. That costs a migration and a backfill and buys nothing.

**The rules, stated once:**

1. **Push only as far as needed (11.2).** After the change is applied, walk forward from the edited activity through the following *timed* activities. For each next activity, the earliest allowed start is `prev.toTime + leg(prev→next).durationMinutes`, or `prev.toTime` if there is no drawn leg. If it already starts at or after that time, stop: slack absorbed the change, and nothing after it moves. Otherwise, shift it by the shortfall, keeping its duration, and continue. Untimed activities are skipped and never acquire a time.
2. **Never pull forward.** Shortening, deleting or moving an activity earlier leaves the gaps where they are. A gap may be intentional.
3. **A time edit keeps the order.** If an edited activity's new start would fall before its timed predecessor's *start*, the save is refused. The message names the predecessor and points to *Nach oben* (11.3). Setting a later start, even past the successor's start, is allowed: the successor and everything after it are pushed. An overlap with the predecessor's end alone is accepted, as it is today.
4. **Insertion slots by time.** Creating an activity with a time, or giving an untimed activity a time, places it where its start time sorts. Rule 1 then runs from it. This is the main way the order still changes, together with deleting an activity, clearing an activity's times, and 11.3.
5. **Legs that stop being adjacent are deleted (11.1).** After the change is applied, any leg on that day whose endpoint pair is not consecutive in the new timeline is deleted in the same transaction. This includes legs whose endpoint is one of the day's stays.
6. **Midnight is a hard limit.** Times are `HH:MM` strings. A push that would move any activity's `toTime` past `23:59` is refused as a whole, and nothing is written. The message names the activity that would not fit.
7. **Check-in is a warning.** If the last timed activity's end, plus the leg to the night's stay, passes that stay's check-in time, the change is saved and the notice carries a warning line. This uses the explicit `checkInTime` only, never the assumed default, which already renders as *assumed* (`TripDayView.tsx:2129`).

**Server-side and in one transaction.** The recalculation runs in the repository, inside the same `$transaction` as the edit. It reads the day's rows inside that transaction, so two contributors saving the same day cannot interleave a half-applied push. The client does not compute times. It renders what the server returns. The client and the server must agree on the order, which is why DW-216 belongs to 11.2.

**The change receipt (11.1), reused by 11.2 and 11.3.** Every write that can trigger rules 1–5 (create, update, delete, *Nach oben/unten*) returns, alongside today's payload, a receipt with:
- the previous `fromTime` and `toTime` of every other activity it moved;
- every leg it deleted, as full rows (`id`, endpoints, `transportType`, `durationMinutes`, `distanceKm`, `linkUrl`);
- the edited activity's previous state (or "created" for an insertion);
- the `updatedAt` of every row it touched.

`POST /api/trips/{id}/day-plan-changes/undo` applies a receipt in reverse in one transaction: it restores the times, recreates the legs with their original ids, and either restores the edited activity or, for an insertion, deletes it through the existing delete path, which already cleans up its legs and media. **It refuses if any touched row's `updatedAt` has moved since the receipt was issued.** In that case the day has changed underneath the notice, and blindly reverting would overwrite someone's later edit. A refused undo leaves the day as it is and says so. The receipt is held in client state only. It is not persisted, and it expires when the notice is dismissed, the user leaves the day, or another write is made on that day.

**Moving between days is out of scope for undo.** Stories 6.7 and 6.23 already delete legs and report them. Routing them through the receipt would be consistent, but it is a separate change to separately tested code. It is recorded, not built.

**11.3 is a swap plus rule 1.** Swapping timed neighbours A (earlier) and B (later):
- B takes A's start and keeps its own duration.
- A starts at B's new end, plus the leg B→A if one exists. One never does at that point, because rule 5 has just deleted every leg touching the pair.
- Rule 1 then runs from A.

The day's start time and both durations are preserved. Any slack between the pair is absorbed, and any slack after it is kept. The controls are offered only on timed activities, and only where a timed neighbour exists in that direction. The order of untimed activities is `createdAt`, which no control can sensibly rewrite without a sort column, and their position has no time meaning anyway.

**What 11.1 does on its own, before 11.2 ships.** Until 11.2 lands, a retime can still change the order, as it does today, and 11.1 deletes the legs that change orphans. That is correct and useful in isolation. 11.2 then removes that route to reordering. Each story is shippable without the next.

**The orphan list stays.** Once 11.1 is live, the paths covered here stop producing orphans. Orphans still arrive in other ways: restoring a backup that carries one (8.5 AC5, deliberately preserved), and shrinking a trip's dates (DW-318). Existing rows in the database also stay where they are, because no migration deletes data. The list costs nothing when it is empty, and it is already built and tested.

### UX impact

One new component, `action-notice`. It sits in the day view, below the day hero, and is not attached to a dialog, because the dialog has already closed when it appears. It contains:

- a one-line summary of what the save did beyond the edit itself (*"3 Aktivitäten verschoben · 1 Fahrt entfernt"*), with correct German number agreement as `trip-status` already requires;
- an optional warning line (rule 7) in `{colors.warn}`;
- a single text button, *Rückgängig*, and a `close` icon-button.

It appears **only when the save had side effects.** An edit that moved nothing and deleted nothing shows nothing, which is exactly today's behaviour. It does not auto-dismiss. `EXPERIENCE.md:88` already rules that feedback must not disappear faster than it can be read, and a notice whose action is the only way to revert should not disappear at all until the user dismisses it or makes another write.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment: add an epic and three stories. Selected.**

Effort: Medium. 11.1 is the largest, because it carries the receipt and the undo endpoint. 11.2 is mostly one pure function plus tests. 11.3 is small once both exist.
Risk: Medium-low. The arithmetic is simple. The risk is in the transaction boundary and in undo's staleness check. Both are server-side and unit-testable without a browser.

**Option 2 — Potential Rollback of Story 8.5: not viable.** 8.5 fixed a real production defect: invisible legs that were counted in travel time and could not be reached. AC1, AC3, AC4 and AC5 stay correct and in force. Only AC2's judgement, *"surface rather than silently discard"*, is reversed. It is reversed on usage evidence (orphans are always deleted, never revived) and with undo as the replacement safety net. 8.5's own argument was that the measured data is not derivable. That argument is answered by making the deletion reversible, not by keeping the row.

**Option 3 — PRD MVP Review: not required.** The MVP is long shipped. This adds two FRs and removes none.

---

## 4. Detailed Change Proposals

### 4.1 PRD — `prd.md`

**Section:** *Day Plans (Rich Text + Links)*, after FR21.

OLD:
```
- FR21: Users can edit or clear a day plan.
```

NEW:
```
- FR21: Users can edit or clear a day plan.
- FR42: When users insert, retime or extend an activity, later activities on that day move back only as far as needed to start after the previous activity ends plus the travel time between them, keeping their order and duration; gaps are never closed automatically. Travel legs whose two endpoints are no longer consecutive are removed, and the whole change, including every moved activity and removed leg, can be undone.
- FR43: Users can move an activity one place earlier or later within its day, with the times of the swapped pair and the activities after them recalculated under the same rule.
```

Frontmatter: `lastEdited: '2026-10-10'`.

Rationale: FR18–21 describe day plans as content, not as a schedule. The schedule behaviour has been implicit until now. That was harmless while nothing recalculated it, but it stops being harmless the moment something does.

### 4.2 Epics — `epics.md`

**Requirements Inventory**, after FR41:
```
FR42: When users insert, retime or extend an activity, later activities on that day move back only as far as needed to start after the previous activity ends plus the travel time between them, keeping their order and duration; gaps are never closed automatically. Travel legs whose two endpoints are no longer consecutive are removed, and the whole change, including every moved activity and removed leg, can be undone.
FR43: Users can move an activity one place earlier or later within its day, with the times of the swapped pair and the activities after them recalculated under the same rule.
```

**FR Coverage Map**, after FR41:
```
FR42: Epic 11 - Day Plans That Recalculate Themselves
FR43: Epic 11 - Day Plans That Recalculate Themselves
```

**Epic List**, after Epic 10:
```
### Epic 11: Day Plans That Recalculate Themselves
Users can change one time on a day and have the rest of the day follow — later activities pushed back as far as needed, travel legs that no longer fit removed, the order changed only when they ask — and take the whole change back in one step.
**FRs covered:** FR42, FR43
```

**Story 8.5, AC2**: append a marker and leave the original text in place:
```
**Given** a day whose two activities are joined by a travel segment
**When** an activity is inserted between them, retimed so the order changes, or moved away
**Then** the segment survives with its mode, duration and distance intact — it is not silently deleted

> **Superseded 2026-10-10 by Story 11.1** (Sprint Change Proposal 2026-10-10). A leg left non-adjacent by a create, update or delete on its day is now deleted in the same transaction, and the change is reversible through undo. AC1, AC3, AC4 and AC5 remain in force.
```

**New section**, appended after Epic 10:

```markdown
## Epic 11: Day Plans That Recalculate Themselves

Users can change one time on a day and have the rest of the day follow — later activities pushed back as far as needed, travel legs that no longer fit removed, the order changed only when they ask — and take the whole change back in one step.

### Story 11.1: Travel Legs That Leave With Their Place in the Day

As someone rearranging a day,
I want travel legs that no longer connect two consecutive stops to disappear on their own,
So that I stop deleting them one by one from the orphan list, without losing the ability to take the change back.

**FRs covered:** FR42 (leg removal and undo)

**Depends on:** nothing. Supersedes Story 8.5's AC2.

**Context:** Story 8.5 keeps a leg whose endpoints still exist but are no longer adjacent, on the grounds that its mode, duration and distance are measured rather than derivable. In use, such a leg is never revived: it describes a trip between two places that are no longer consecutive, and the user deletes it every time from the *Verwaiste Reiseabschnitte* list, one confirmation per leg. This story deletes those legs in the same transaction as the change that orphaned them, and answers 8.5's concern with undo instead of retention.

The undo mechanism, a *change receipt* returned by the write and an endpoint that applies it in reverse, is built here because this is the first story that deletes something as a side effect. Stories 11.2 and 11.3 add to the same receipt rather than building their own.

**Acceptance Criteria:**

**Given** a day whose activities A and B are joined by a leg
**When** an activity is created with a time between them, an activity is retimed so the order changes, an activity's times are cleared, or an activity is deleted
**Then** every leg on that day whose endpoint pair is no longer consecutive in the resulting timeline, including legs to or from the day's stays, is deleted in the same transaction as the change

**Given** a create, update or delete on a day plan item
**When** it succeeds
**Then** the response carries, alongside today's payload, a change receipt listing: every leg it deleted as a full row, the previous state of the edited item (or that it was created), and the `updatedAt` of every row it touched

**Given** a change whose receipt is not empty
**When** the day view receives it
**Then** an `action-notice` appears below the day hero summarising what happened beyond the edit itself (e.g. "1 Fahrt entfernt"), with correct German number agreement, a *Rückgängig* action and a close control, and it does not auto-dismiss

**Given** a change whose receipt is empty
**Then** no notice appears, which is today's behaviour exactly

**Given** an `action-notice`
**When** *Rückgängig* is activated
**Then** one request restores the whole change in one transaction: the edited item returns to its previous state (or, if it was created, is deleted through the existing delete path, which cleans up its legs and media), and every deleted leg is recreated with its original id, mode, duration, distance and link

**Given** a receipt
**When** any row it touched has changed since it was issued
**Then** undo is refused, nothing is written, and the notice says the day has changed since — an undo must never overwrite a later edit

**Given** an `action-notice`
**When** it is closed, the user leaves the day, or another write is made on that day
**Then** the receipt is discarded; it is held in client state only and never persisted

**Given** a viewer without planning rights
**Then** no notice and no undo control is ever shown to them, and the undo endpoint refuses them with the same check as the other planning writes

**Given** the orphan list from Story 8.5
**When** this story ships
**Then** the list and its remove control remain, unchanged, for orphans that still arrive by other routes — a restored backup (8.5 AC5), shrinking a trip's dates (DW-318) — and for rows already in the database

**Given** moving an activity to another day (Stories 6.7, 6.23)
**Then** its behaviour is unchanged and it is not routed through the receipt

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string, and no key is added to one dictionary only

### Story 11.2: The Rest of the Day Moves Back With It

As someone inserting a stop or letting an activity run longer,
I want every later activity pushed back just as far as it has to go,
So that I do not have to retime the rest of the day one entry at a time, working out the travel time in my head.

**FRs covered:** FR42 (push rule)

**Depends on:** Story 11.1, whose change receipt this story extends. Bundles DW-216.

**Context:** The day's order is derived from `fromTime` alone (`dayPlanItemOrder.ts:67-86`), and no write changes more than one row (`dayPlanItemRepo.ts:547-612`). This story makes a time change recalculate the day on the server, inside the same transaction. Two rulings by Tommy shape it. First, **push only as far as needed**: slack before the next activity absorbs the change, and the push stops at the first activity that already fits. Second, **never pull forward**: gaps may be deliberate and are never closed.

A third ruling, that **a time edit keeps the order**, means no `sortOrder` column is needed. Every push leaves the timed activities with non-decreasing start times, so the existing comparator still yields the right order after every write. A time that would put an activity before its predecessor's start is refused rather than read as a reorder. Reordering belongs to Story 11.3.

**Acceptance Criteria:**

**Given** a timed activity that is created, retimed or extended
**When** it is saved
**Then** the following timed activities are walked in order, and each is moved to start no earlier than the previous one's end plus the duration of the drawn leg between them (or the previous end if there is none), keeping its duration

**Given** that walk
**When** an activity already starts at or after its earliest allowed start
**Then** the walk stops there, and no activity after it moves

**Given** an activity that is shortened, moved later with slack to spare, or deleted
**Then** no other activity moves earlier — gaps are never closed

**Given** untimed activities on the day
**Then** they are skipped by the walk and never acquire a time

**Given** a timed activity whose new start would fall before its timed predecessor's start
**When** it is saved
**Then** the save is refused with a message naming the predecessor and pointing to *Nach oben* — a time edit never changes the order

**Given** a timed activity whose new start falls after its successor's start
**Then** the save is accepted, the activity keeps its place, and the successor and everything after it are pushed

**Given** a new activity, or an untimed one given a time
**Then** it is placed where its start sorts, and the walk runs from it — insertion is the one time edit that sets a position

**Given** a push that would move any activity's `toTime` past `23:59`
**Then** nothing is written, and the dialog names the activity that would not fit — `HH:MM` cannot represent the next day, and clamping would silently change durations

**Given** a push after which the last timed activity's end plus the leg to the night's stay passes that stay's explicit `checkInTime`
**Then** the change is saved, and the `action-notice` carries a warning line in `{colors.warn}`; an assumed check-in time never triggers it

**Given** a change that moved other activities
**Then** the change receipt lists each moved activity with its previous `fromTime` and `toTime`, the notice reports how many were moved ("3 Aktivitäten verschoben"), and *Rückgängig* restores them together with everything Story 11.1 already restores

**Given** the recalculation
**Then** it runs in the repository inside the edit's own transaction, reading the day's rows within that transaction, and the client renders the server's result rather than computing times itself

**Given** DW-216, a private copy of the order comparator in `dayPlanItemRepo.ts`
**Then** the walk uses the canonical `compareDayPlanItemsByStartTime`, and the private copy is removed

**Given** the push rule
**Then** it is implemented as a pure function over the day's timeline, with unit tests covering: slack absorbed with no push; a chain push; a push stopping mid-day; untimed activities skipped; a leg's duration counted; the midnight refusal; and the predecessor refusal

### Story 11.3: One Place Earlier, One Place Later

As someone who decides two stops would be better the other way round,
I want to move an activity up or down one place,
So that I can change the order of my day without retyping both sets of times.

**FRs covered:** FR43

**Depends on:** Stories 11.1 and 11.2. It reuses the leg removal, the receipt and the push rule unchanged.

**Context:** Since Story 11.2, a time edit never changes the order, so this is the way to reorder a day. Tommy's ruling is to start with *Nach oben / Nach unten* in the activity's menu, swapping with the neighbour. Drag and drop is not in scope.

**Acceptance Criteria:**

**Given** a timed activity with a timed neighbour above it
**When** *Nach oben* is chosen from its menu
**Then** it takes its neighbour's start time and keeps its own duration, the neighbour follows immediately after it and keeps its own duration, and the push rule from Story 11.2 runs from the neighbour — the day's start and both durations are preserved, slack between the pair is absorbed, and slack after it is kept

**Given** a timed activity with a timed neighbour below it
**When** *Nach unten* is chosen
**Then** the same swap applies in the other direction

**Given** the swap
**Then** every leg that is no longer between consecutive endpoints, including the leg between the two swapped activities, is deleted as in Story 11.1 — a leg is not reversed automatically

**Given** the first timed activity of the day, the last timed activity, or an untimed activity
**Then** the control that has no timed neighbour in its direction is not offered — the order of untimed activities carries no time meaning and is not reorderable

**Given** a swap that would push any activity past `23:59`
**Then** nothing is written and the reason is shown, as in Story 11.2

**Given** a completed swap
**Then** the `action-notice` appears with the swap's receipt, and *Rückgängig* restores both times, every pushed activity and every deleted leg in one step

**Given** the activity's overflow menu
**Then** the two new items follow the existing menu conventions (44px row floor, the `'&&'` specificity fix from DW-180), and are shown only to users with planning rights

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry the new strings
```

### 4.3 Design system — `DESIGN.md`, `EXPERIENCE.md`

**`DESIGN.md` → Components**, new entry after `money-field`:

```
- **action-notice** — Feedback for a save that did more than the user typed: a {rounded.md} {colors.card} panel with a {colors.border-strong} border, placed directly below the day hero (Screen B) and above the stat strip, never inside a dialog — the dialog that caused it has already closed. One summary line in {colors.ink} ("3 Aktivitäten verschoben · 1 Fahrt entfernt", with correct German number agreement as `trip-status` requires), an optional warning line in {colors.warn} with the small alert icon, then a trailing text `button` ("Rückgängig") and the `close` icon-button.

  **It is not an error and does not borrow the error treatment.** The save succeeded; the notice reports consequences and offers their reversal. It appears only when there were consequences — a save with none shows nothing, so the notice cannot become wallpaper.

  **It does not auto-dismiss.** Its action is the only way to take the change back, so it stays until the user closes it, leaves the day, or makes another write on that day. Each of those ends the undo window as well.
```

`components.action-notice` token block: `padding: {spacing.card-padding}`, `gap: 8px`, `actionMinHeight: {components.button.minHeight}`.

**`EXPERIENCE.md`**, a new row after `:88`:

```
| Change with side effects | Day view, after saving or reordering an activity moved others or removed travel legs (FR42, FR43) | `action-notice` below the day hero: what else changed, one "Rückgängig" action, no auto-dismiss. Shown only when something beyond the edit itself happened. A refused change (midnight, predecessor) is not this — it stays in the dialog as an inline error and nothing is saved. |
```

### 4.4 Architecture — `architecture.md`

**API & Communication Patterns**, append:
```
- Writes that recalculate a day (day plan item create, update, delete, and in-day move) return `{ data: { item, receipt } }`, where `receipt` lists the rows the write changed as a side effect, with their prior state. `POST /api/trips/{id}/day-plan-changes/undo` applies a receipt in reverse in one transaction and refuses (409) if any row it names has changed since. Receipts are client-held and never persisted.
```

*Data Architecture*: no change. Order remains derived from `fromTime` (`dayPlanItemOrder.ts`). Story 11.2's push rule preserves non-decreasing start times, so no `sortOrder` column is introduced.

### 4.5 Sprint status — `sprint-status.yaml`

Appended after the `epic-10` block:
```yaml
  epic-11: backlog
  11-1-travel-legs-that-leave-with-their-place-in-the-day: backlog
  11-2-the-rest-of-the-day-moves-back-with-it: backlog
  11-3-one-place-earlier-one-place-later: backlog
  epic-11-retrospective: optional
```

---

## 5. Implementation Handoff

**Scope: Moderate.** Backlog addition and one superseded acceptance criterion. No replan.

| Recipient | Responsibility |
|---|---|
| John (PM), this session | Apply 4.1–4.5 to the artifacts once this proposal is approved. |
| `bmad-create-story` | Create the story file for 11.1 first, then 11.2 and 11.3 in order. Each depends on the one before. |
| Developer agent / `bmad-dev-story` | Implement in order. In 11.1, the receipt shape and the undo staleness check are the parts to get right. In 11.2, the push rule is a pure function, to be tested before it is wired in. |
| Code review | Check specifically that the recalculation and the leg deletion run inside the edit's own transaction, and that undo cannot overwrite a later edit. |

**Success criteria:**

1. Inserting a 90-minute activity into a full day moves every overlapping later activity back by exactly as much as needed, counting leg durations, in one save, and stops at the first activity with enough slack.
2. After 11.1, no create, update or delete on a day leaves an orphan in the *Verwaiste Reiseabschnitte* list.
3. One *Rückgängig* returns the day to exactly its prior state, byte for byte on every touched row, and refuses if the day changed in between.
4. *Nach oben* on the second activity of a day swaps it with the first, keeps the day's start and both durations, and pushes the rest only as far as needed.
5. A change that would cross midnight writes nothing.

**Decisions recorded (Tommy, 2026-10-10):**

| # | Question | Ruling |
|---|---|---|
| 1 | Orphaned legs | Delete immediately, with a notice and undo. Supersedes 8.5 AC2. |
| 2 | Push rule | Only as far as needed; slack is absorbed first. |
| 3 | Pull forward | Never. Gaps may be intentional. |
| 4a | Check-in exceeded | Save, and warn. |
| 4b | Midnight exceeded | Refuse the save. `HH:MM` cannot represent it. |
| 5 | Reorder control | *Nach oben / Nach unten* in the menu, swapping with the neighbour. Drag and drop later, if ever. |
| 6 | A retime past a neighbour | The order stays. Later activities are pushed, and a start before the predecessor's start is refused. |
| 7 | Undo scope | The whole change: own times, pushed activities, deleted legs. |
