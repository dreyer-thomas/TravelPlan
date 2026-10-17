# Sprint Change Proposal — 2026-10-17

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-17; edits 4.1, 4.2, 4.4 and 4.5 applied. 4.3 applied after architecture review by Winston 2026-10-17, with the midnight rule changed from clamping to *no times = does not fit* (see rule 5).
**Scope classification:** Moderate, with an architecture review before the first story. One new epic, four new stories, two new FRs, FR42 and FR43 rewritten, and FR45 amended. This adds a schema migration (three columns on `DayPlanItem`). Two recorded rulings are reversed: *gaps are never closed* (Epic 11) and *check-in exceeded → warn* (Epic 11). One is softened: *midnight → refuse* becomes a warning. No shipped story is reverted or renumbered.

---

## 1. Issue Summary

**Planning a day still means doing clock arithmetic by hand. The app knows everything it needs to do it instead.**

To add an activity today, the user types a start time and an end time. To get the start right, they take the previous activity's end, add the travel time of the leg in between, and type the result. To get the end right, they add how long they want to stay. Epic 11 made the app push later activities back when something grows. But nothing ever computes the *first* time for the user, and nothing moves the day earlier when something shrinks.

How a traveller actually thinks about most activities is *how long*, not *from when to when*: "an hour at the waterfall, then lunch, then the museum for two hours". Only a few things are booked to the minute: a ferry, a guided tour, a restaurant reservation. Those really cannot move, and everything else has to fit around them.

**Trigger:** No triggering story. Raised by Tommy as a product request after Epic 12 closed. Category: *new requirement emerged from stakeholder*.

**Evidence:**

- `prisma/schema.prisma:204-230`: `DayPlanItem` stores `fromTime` and `toTime` as nullable `HH:MM` strings. There is no duration, no kind and no order column. Duration exists only implicitly, as `toTime − fromTime`.
- `src/lib/validation/dayPlanItemSchemas.ts:89-113`: the API requires both times and refines `toTime > fromTime`. The dialog (`TripDayPlanDialog.tsx:2561-2591`) offers only two `type="time"` inputs.
- `src/lib/trips/dayPlanPush.ts:133-182`: the walk pushes later items back and stops at the first one with slack. By ruling (Epic 11, decision 3), it never pulls forward.
- `src/lib/trips/suggestionPlan.ts:87-115`: Story 12.4 already chains times from the check-out using durations. The rule this proposal makes general exists today, but only for AI suggestions applied in one batch.
- Untimed activities exist only from imports and from suggestion overflow past midnight (`suggestionPlan.ts`). The API cannot create them.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 13 (new): Days Planned by Duration | Created. Receives Stories 13.1–13.4. |
| Epic 11: Day Plans That Recalculate Themselves | Shipped and stays shipped. Its machinery is **kept and reused**: the change receipt, the undo endpoint, the leg sweep (11.1), the `action-notice`, and *Nach oben / Nach unten* (11.3). Its **push rule (11.2, 11.4) is replaced** by a schedule rule that recomputes the whole day. Two rulings are reversed (decisions 3 and 4a of 2026-10-10) and one is softened (4b). See *Rulings superseded*. |
| Epic 12: AI Suggestions for the Day | Shipped. 12.4's `chainTimes` is absorbed into the shared schedule rule, which keeps its day starts (check-out, else 10:00; no stay, 09:00). Applied suggestions become **flexible** activities with their suggested duration (Story 13.4). |
| Epic 6: Stories 6.7, 6.23 (move to another day) | Shipped. A moved activity now gets a place and a time on its target day, which is recomputed. See 13.3. |
| Epic 2: Stories 2.29, 2.30 (gantt), 2.31, 2.32 (backup) | The gantts are unchanged, because they read the stored times, which stay. The backup format gains the new fields (13.4). |
| Epics 1, 3–5, 7–10 | No impact. |

**Why a new epic rather than three more stories in Epic 11.** Epic 11's charter is *"change one time and have the rest of the day follow"*. This changes what the user enters in the first place: a duration instead of a time, with times becoming a result. That is a change to the model, not to the recalculation. The same argument produced Epic 11.

### Rulings superseded

| Ruling (date) | Was | Now |
|---|---|---|
| Epic 11 #3 (2026-10-10) | Never pull forward; gaps may be intentional. | **Flexible activities always sit tight** behind their predecessor plus the leg. If something before them shrinks, they move earlier. A gap can only appear *before a fixed activity*, as waiting time. A deliberate break is an activity of its own. |
| Epic 11 #4a (2026-10-10) | Arriving at the night's stay after its explicit check-in time → warning. | **No warning.** Check-in is the *earliest* time to arrive, not a deadline. Arriving later is normal. |
| Epic 11 #4b (2026-10-10) | A push past 23:59 is refused; nothing is written. | **Saved, with a warning** that the plan does not work. See the storage rule in *Technical impact*. |
| Epic 11 #6 (2026-10-10) | A retime that would start before the predecessor is refused. | **Gone for flexible activities**, because they have no start to type. A fixed activity takes its place by its time (rule 4 below). |

### Story impact

| Story | Change |
|---|---|
| 13.1 | **New.** Activities are flexible (duration only) or fixed (booked time). Flexible ones are placed by the app. Schema, backfill (all existing → fixed), the schedule rule on every write path, the dialog, receipt and undo. |
| 13.2 | **New.** *Der Plan geht nicht auf:* collisions are shown persistently in the day view and the trip overview. Midnight becomes a warning, and the check-in warning is removed. |
| 13.3 | **New.** Order for a duration-based day: *Nach oben / Nach unten* moves flexible activities, including past fixed ones. A new activity can be placed after a chosen one. Moving an activity to another day recomputes that day. One action makes a whole day flexible. |
| 13.4 | **New.** AI suggestions arrive as flexible activities. The backup export and import carry kind, duration and order. |
| 11.2, 11.3, 11.4 | Shipped. Their AC are superseded where they conflict with 13.1–13.3 (inline markers, see 4.2). Their tests are rewritten against the new rule, not deleted. |
| 12.4 | Shipped. AC on the time chain is superseded by 13.4. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `prd.md` | FR42 and FR43 rewritten. New FR46 (flexible and fixed activities) and FR47 (plan collision warnings). FR45 amended. `lastEdited: '2026-10-17'`. |
| `epics.md` | Requirements Inventory and FR Coverage Map updated. Epic List gains Epic 13. New `## Epic 13` section. Supersession markers on 11.2, 11.3, 11.4 and 12.4. |
| `architecture.md` | *Data Architecture*: three new columns, and order stored in `sortOrder` instead of being derived from `fromTime`. This reverses the 2026-10-10 line *"no `sortOrder` column"*. *API & Communication Patterns*: the receipt line is updated. |
| `DESIGN.md` | New `schedule-mode` toggle (dialog) and `plan-conflict` marker (card, day hero, day row). |
| `EXPERIENCE.md` | *Change with side effects* row: the check-in example is dropped. New row: *Plan does not work out*. |
| `sprint-status.yaml` | New `epic-13` block. |

### Technical impact

**The central design point: duration is the source of truth for flexible activities; `fromTime`/`toTime` remain stored as the computed result.**

All twelve consumers of `fromTime`/`toTime` keep working unchanged: day gantt, overview gantt, timeline cards, travel-time ranges, print sheet, document packet, export, receipt and undo. The server recomputes the stored times on every write that can affect them. The client never computes times; it renders what the server returns, as since Story 11.2.

**Schema (one migration):**

- `scheduleMode` enum `FLEXIBLE | FIXED`, not null.
- `durationMinutes Int`, not null, minimum 5.
- `sortOrder Int`, not null. This is the day's order. The comparator `compareDayPlanItemsByStartTime` becomes `compareDayPlanItemsByOrder` (`sortOrder`, then `id`) and every caller switches to it. That includes `getDayRoutePointsForUser`, which today orders by `createdAt` and so already disagrees with the timeline.
- `fromTime`/`toTime` stay as they are and stay nullable: a fixed activity always has both; a flexible one has them exactly when it fits in the day (rule 5). *(Revised by Winston 2026-10-17.)*

**Backfill (Tommy's ruling: nothing moves by itself):**

- Every activity with both times becomes `FIXED`, with `durationMinutes = toTime − fromTime`.
- Every untimed activity becomes `FLEXIBLE` with **15 minutes** (*"kurz anhalten und umschauen"*) and is placed after the last timed one, keeping its current relative order.
- `sortOrder` is the current comparator order.
- The backfill runs the schedule rule once per day so that the former untimed activities get times. Fixed ones do not move by definition.

**The schedule rule, stated once.** A pure function `scheduleDay(dayStart, items in sortOrder, legs) → { times, conflicts }`:

1. **Day start** = last night's stay's `checkOutTime`; if none is stored, `DEFAULT_CHECK_OUT_TIME` (10:00); with no stay the night before at all (the trip's first day), `DAY_START_WITHOUT_STAY` (09:00), moved from `suggestionPlan.ts` into `stayTimes.ts` as a shared constant. A cursor starts there. If the first activity has a drawn leg from the stay, its duration is added.
2. **Flexible activity:** `fromTime = cursor + leg(prev → this)`, `toTime = fromTime + durationMinutes`; the cursor moves to `toTime`. It always sits tight.
3. **Fixed activity:** its times are never changed. If `cursor + leg(prev → this) > fromTime`, record a **collision**: *"X beginnt um 12:00, erreichbar erst um 12:40"*. This covers both cases Tommy named, a flexible chain running into a booking and two fixed activities overlapping. The cursor moves to `max(cursor, toTime)`. If the predecessor ends earlier, the gap before the fixed activity is waiting time and stays visible.
4. **Fixed activities keep their place by time.** When an activity becomes fixed, or its fixed time changes, it is placed after the last activity whose computed start is ≤ its start. Its `sortOrder` is rewritten accordingly. A fixed time edit therefore never needs refusing (this replaces the predecessor refusal).
5. **Midnight.** If a flexible activity's computed `toTime` would pass 23:59, it and every later flexible activity are stored with `fromTime`/`toTime = null`, meaning *does not fit in the day*. Their `durationMinutes` is untouched, so nothing is lost, and each carries a **past-midnight collision**. The next write that makes room restores the times exactly, because they are recomputed from durations. *(Revised by Winston 2026-10-17: the originally proposed clamp to 23:59 produced zero-length rows that the gantt hides (`TripDayGanttSegments.ts:74-86`) and that the backup import rejects (`tripImportSchemas.ts:467-474`); every time reader already handles null times, and 12.4 already stores overflow this way.)*
6. **No check-in warning.** `findCheckInWarning*` and the receipt's `checkInWarning` field are removed. The leg to the night's stay counts in nothing.
7. **Leg sweep (11.1) unchanged.** Any write that changes the order deletes legs whose endpoints are no longer consecutive, in the same transaction, and they are reversible through undo.

**Conflicts are derived, never stored.** `scheduleDay` returns them on every read of the day (and of the trip overview, per day), so they cannot go stale. The write response also carries them so the `action-notice` can mention a *new* collision.

**One recompute replaces three walks.** `planDayPush`, `planDayReorder` and `planDayPushFrom` all collapse into *apply the edit, then `scheduleDay` the affected day*. Every write path that ran a walk runs the recompute: create, update, delete (new, because deleting now pulls forward), reorder, leg create/update/**delete**, check-out change (now in either direction), bucket-list take-over, suggestion apply, and move to another day (both days). The receipt's `movedItems` already stores previous `fromTime`/`toTime`/`updatedAt` per moved row, which is exactly what a recompute needs for undo. It adds `previousSortOrder` and, for the edited item, `previousScheduleMode`/`previousDurationMinutes`. The receipt goes to **version 3**, and the undo endpoint accepts only v3 (receipts are client-held and short-lived, so no v2 tolerance is needed).

**Test impact.** About 21 test files touch the push walk (`dayPlanPush.test.ts` alone has 50 cases). The pure-function tests are rewritten against `scheduleDay`. The repo and route tests keep their scenarios and change their expectations where pull-forward or the removed refusals apply. This is the largest single cost in 13.1.

**Architecture review recommended before 13.1 is contexted.** The rule set is small, but it reverses an explicit architecture decision (*no `sortOrder`*) and touches every write path on a day. Winston should confirm the column set, the midnight clamp, and the derived-not-stored conflicts.

### UX impact

**Activity dialog:** a two-option `schedule-mode` toggle at the top of *Wann & Wo*:

- **Flexibel** (default for new activities): one duration field (hours and minutes, prefilled 1 h; empty saves as 15 min). Below it, a read-only line: *"Voraussichtlich 11:20 – 12:20"*, from the last server result, or *"wird nach dem Speichern berechnet"* for a new one.
- **Feste Zeit:** start time plus either end time or duration (a small switch; both store start and end).
- Switching modes keeps the duration. Fixed → flexible turns the activity's times into a duration. Flexible → fixed freezes the currently computed times.

**`plan-conflict` marker** (`{colors.warn}` family, which DESIGN.md reserves for actionable gaps, and a plan that does not work out is one):

- On the fixed activity's card: an alert icon plus *"Erreichbar erst 12:40 (40 Min zu spät)"*.
- On the day hero: *"Der Plan geht nicht auf"* with the count.
- On the trip overview's `day-row`: the same gap-badge treatment as a missing stay, so a broken day shows up without opening it.
- For past midnight: on the first activity that does not fit, *"Passt nicht mehr in den Tag"*.

**Cards:** a flexible activity's time pill shows its computed times in the normal style. A fixed one adds a small lock glyph, so the user sees which times are booked.

---

## 3. Recommended Approach

**Option 1, Direct Adjustment: add Epic 13 with four stories. Selected.**

- **Effort:** Medium-high. 13.1 is the largest: migration and backfill, the new pure rule, rewiring about ten write paths, the dialog, and rewriting the push tests. 13.2–13.4 are each small to medium once 13.1 stands.
- **Risk:** Medium. The arithmetic is simpler than Epic 11's (one forward pass, no stop condition). The risks are breadth (every write path) and the backfill on real data. The backfill is designed so that it changes no visible time, and that is testable as a whole-DB comparison.

**Option 2, Potential Rollback of Epic 11: not viable.** Epic 11's receipt, undo, sweep, notice and reorder are exactly the infrastructure this needs. Only its push rule is replaced, and that is replaced in place.

**Option 3, PRD MVP Review: not required.** The MVP is long shipped. This rewrites two FRs, adds two, and removes none.

**Why each story ships on its own:**

- After 13.1, durations work and nothing existing moves. Collisions are reported in the notice, and until 13.2, midnight keeps today's refusal.
- 13.2 makes collisions permanent and visible.
- 13.3 makes order comfortable.
- 13.4 aligns the two remaining time sources.

---

## 4. Detailed Change Proposals

### 4.1 PRD: `prd.md`

**Section:** *Day Plans (Rich Text + Links)*

OLD:
```
- FR42: When users insert, retime or extend an activity, lengthen a travel leg, or move the previous night's check-out later, later activities on that day move back only as far as needed to start after the previous activity (or the check-out) ends plus the travel time between them, keeping their order and duration; gaps are never closed automatically. Travel legs whose two endpoints are no longer consecutive are removed, and the whole change, including every moved activity and removed leg, can be undone. **(Added 2026-10-10 — …; widened 2026-10-11 …)**
- FR43: Users can move an activity one place earlier or later within its day, with the times of the swapped pair and the activities after them recalculated under the same rule. **(Added 2026-10-10)**
```

NEW:
```
- FR42: Whenever an activity, a travel leg or the previous night's check-out changes, the app recomputes the day: flexible activities start directly after the previous activity ends plus the travel time between them, starting from the previous night's check-out (10:00 if none is set; 09:00 on a day without a stay the night before), and move earlier as well as later; fixed activities never move. Travel legs whose two endpoints are no longer consecutive are removed, and the whole change, including every moved activity and removed leg, can be undone. **(Added 2026-10-10 — see Sprint Change Proposal 2026-10-10; widened 2026-10-11; rewritten 2026-10-17 for flexible and fixed activities — see Sprint Change Proposal 2026-10-17)**
- FR43: Users can move an activity one place earlier or later within its day, including past a fixed activity, and the day is recomputed under FR42. A fixed activity's place follows from its time. **(Added 2026-10-10; amended 2026-10-17)**
- FR46: Users plan an activity either as flexible, by giving only how long it takes, or as fixed, by giving a booked start together with an end or a duration. An activity without a duration takes 15 minutes. **(Added 2026-10-17 — see Sprint Change Proposal 2026-10-17)**
- FR47: Users are warned, on the day and in the trip overview, when a day's plan cannot work: an activity cannot be reached by its fixed start, two fixed activities overlap, or the day runs past midnight. The plan is saved anyway. Arriving at the night's stay after its check-in time is not a warning. **(Added 2026-10-17)**
```

**Section:** *AI Day Suggestions*, FR45. Replace *"with times chained from the morning's check-out (or after the day's last activity)"* with *"as flexible activities with the suggested duration, appended after the day's last activity and placed under FR42"*, and append *"(amended 2026-10-17)"*.

**Frontmatter:** `lastEdited: '2026-10-17'`, plus an `editHistory` entry:
```
  - date: '2026-10-17'
    changes: 'Rewrote FR42-FR43 and added FR46-FR47 (activities planned by duration as flexible or fixed; plan collision warnings; check-in no longer a warning). Amended FR45. See Sprint Change Proposal 2026-10-17.'
```

### 4.2 Epics: `epics.md`

**Requirements Inventory:** FR42, FR43 and FR45 updated to the text above. FR46 and FR47 are appended after FR45.

**FR Coverage Map:**
```
FR42: Epic 11 - Day Plans That Recalculate Themselves; Epic 13 - Days Planned by Duration (rewritten 2026-10-17)
FR43: Epic 11; Epic 13 (amended 2026-10-17)
FR46: Epic 13 - Days Planned by Duration
FR47: Epic 13 - Days Planned by Duration
```

**Epic List**, after Epic 12:
```
### Epic 13: Days Planned by Duration
Users say how long they want to spend somewhere and the app works out when; only bookings keep a fixed time, and the app says plainly when the day no longer adds up.
**FRs covered:** FR42 (rewritten), FR43 (amended), FR45 (amended), FR46, FR47
```

**Supersession markers** (original text left in place, quote block appended, following the 8.5 AC2 precedent):

- **Story 11.2:** under the AC *"Given an activity that is shortened … Then no other activity moves earlier"*, the predecessor-refusal AC, the midnight AC and the check-in AC:
  > **Superseded 2026-10-17 by Stories 13.1 and 13.2** (Sprint Change Proposal 2026-10-17). Flexible activities move earlier as well as later. A fixed activity takes its place by time instead of being refused. Midnight is a warning, and check-in is no warning.
- **Story 11.3**, the swap AC:
  > **Superseded 2026-10-17 by Story 13.3.** Up/down changes order only and the day is recomputed. Fixed activities are not moved by it.
- **Story 11.4**, the AC *"a shorter leg, a deleted leg, an earlier check-out … Then no activity moves"*:
  > **Superseded 2026-10-17 by Story 13.1.** These now pull flexible activities earlier.
- **Story 12.4**, the time-chain AC:
  > **Superseded 2026-10-17 by Story 13.4.**

**New section**, appended after Epic 12:

```markdown
## Epic 13: Days Planned by Duration

Users say how long they want to spend somewhere and the app works out when; only bookings keep a fixed time, and the app says plainly when the day no longer adds up.

### Story 13.1: Just Say How Long

As someone filling a day,
I want to give each activity only how long I want to spend there,
So that the app works out every start and end from the check-out and the travel times, and I never add up times again.

**FRs covered:** FR42 (rewritten), FR46

**Depends on:** Epic 11 (receipt, undo, sweep, `action-notice`). Architecture review of the schema before this story is contexted.

**Context:** Times are typed today and pushed back by Epic 11's walk, which never pulls forward. This story makes duration the input and times the result for *flexible* activities, keeps *fixed* activities exactly where they are booked, and recomputes the whole day on every write. Stored `fromTime`/`toTime` remain, as the computed result, so the gantts, cards, print, export and undo keep reading them. Rulings (Tommy, 2026-10-17): day starts at last night's check-out, else 10:00, and at 09:00 with no stay the night before; existing activities all become fixed; an activity without a duration takes 15 minutes; gaps before flexible activities close.

**Acceptance Criteria:**

**Given** the migration
**Then** `DayPlanItem` gains `scheduleMode` (`FLEXIBLE` | `FIXED`), `durationMinutes` (≥ 5) and `sortOrder`, all not null; every activity with both times becomes `FIXED` with its duration; every untimed activity becomes `FLEXIBLE` with 15 minutes, ordered after the timed ones in its current relative order; `sortOrder` reproduces today's comparator order; and afterwards `fromTime`/`toTime` are not null

**Given** a day whose activities were all timed before the migration
**Then** after it, every activity's `fromTime` and `toTime` are exactly what they were (whole-DB comparison in the migration test)

**Given** a day
**When** any of these is saved: an activity created, edited or deleted; a travel leg created, edited or deleted; last night's stay's check-out changed
**Then** the server recomputes the day inside the same transaction: from the day start (last night's `checkOutTime`, else 10:00, or 09:00 with no stay the night before, plus a drawn leg from the stay to the first activity), each flexible activity starts at the previous end plus the drawn leg between them and lasts its duration; each fixed activity keeps its times, and the cursor continues from the later of its end and the cursor

**Given** a flexible activity whose predecessor gets shorter, is deleted, or whose leg gets shorter
**Then** it and the flexible activities after it move earlier — no gap is left before a flexible activity

**Given** a flexible chain that reaches a fixed activity late, or two fixed activities that overlap
**Then** the save succeeds, the fixed activity does not move, and the `action-notice` carries a warning line naming it and the time it can be reached ("Fähre beginnt um 12:00, erreichbar erst um 12:40")

**Given** a recompute that would end a flexible activity after 23:59
**Then** in this story the save is still refused as today (`day_plan_past_midnight`); Story 13.2 turns this into a warning

**Given** an activity that becomes fixed, or whose fixed start changes
**Then** it is placed after the last activity whose computed start is at or before its start, and no save is refused for its position

**Given** the activity dialog
**Then** *Wann & Wo* starts with a `schedule-mode` toggle *Flexibel* / *Feste Zeit*; *Flexibel* (the default for a new activity) shows one duration field in hours and minutes prefilled with 1 h and the read-only line "Voraussichtlich 11:20 – 12:20" (or "wird nach dem Speichern berechnet"); *Feste Zeit* shows the start and either the end or the duration; an empty duration saves as 15 minutes

**Given** an activity switched between modes
**Then** its duration is kept: fixed → flexible keeps `toTime − fromTime`, flexible → fixed freezes the currently computed times

**Given** a new activity, a bucket-list take-over or a suggestion without a chosen position
**Then** a flexible one is appended at the end of the day and a fixed one is placed by time

**Given** an activity card
**Then** the time pill shows the computed times for flexible activities and adds a lock glyph for fixed ones

**Given** a change that moved other activities (later or earlier)
**Then** the receipt (version 3) lists each with its previous times, `sortOrder` and `updatedAt`, plus the edited activity's previous mode and duration; the notice reports "3 Aktivitäten verschoben"; and *Rückgängig* restores the day exactly (whole-DB `toEqual`), refusing as `409 undo_stale` if any named row has changed

**Given** the order of a day
**Then** every consumer reads it from `sortOrder` through one comparator — timeline, day view, gantts, print, document packet, adjacency, and the day route points query (which today orders by `createdAt`) — and `compareDayPlanItemsByStartTime` is removed

**Given** the schedule rule
**Then** it is one pure function `scheduleDay` replacing `planDayPush`, `planDayReorder` and `planDayPushFrom`, unit-tested for: day start from stored and default check-out and from 09:00 without a stay; a stay leg counted; a flexible chain; pull-forward on shortening and on delete; a fixed activity kept with waiting time before it; a late arrival at a fixed activity; two overlapping fixed activities; a fixed activity placed by time

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string

### Story 13.2: When the Plan Doesn't Work Out

As someone with a booked ferry and a full morning,
I want to see, on the day and in the trip overview, when my plan no longer adds up,
So that I fix it while planning instead of finding out on the road.

**FRs covered:** FR47

**Depends on:** Story 13.1.

**Context:** 13.1 reports a collision once, in the notice after a save. A notice is dismissed; a broken day should stay visibly broken until it is fixed. Rulings (Tommy, 2026-10-17): collisions warn and never refuse; running past midnight is a collision; arriving at the stay after check-in is normal and warns nobody.

**Acceptance Criteria:**

**Given** a day and its activities
**When** it is read (day view, trip overview)
**Then** `scheduleDay` derives its conflicts — late arrival at a fixed activity, overlapping fixed activities, past midnight — and they are never stored

**Given** a fixed activity that cannot be reached in time
**Then** its card shows a `plan-conflict` marker: alert icon and "Erreichbar erst 12:40 (40 Min zu spät)"

**Given** a day with at least one conflict
**Then** the day hero shows "Der Plan geht nicht auf" with the count, and the trip overview's `day-row` shows the same gap-badge treatment as a missing stay

**Given** a recompute that would end a flexible activity after 23:59
**Then** the save succeeds; that activity's and every later activity's stored times are clamped to 23:59, their durations are untouched, and the first of them carries "Passt nicht mehr in den Tag"; when a later change makes room, their times are recomputed exactly from their durations

**Given** the push code's `day_plan_past_midnight` refusal and its i18n key
**Then** they are removed from activity, leg, stay and reorder writes

**Given** the check-in warning (`findCheckInWarning*`, the receipt's `checkInWarning`, `checkInWarningText`, the warning line and its key)
**Then** it is removed; no arrival time at the night's stay ever warns

**Given** a viewer without planning rights
**Then** they see the same conflict markers (they describe the plan, not an action)

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string, and the removed keys are removed from both

### Story 13.3: Putting the Day in Order

As someone who has the right activities but not yet the right sequence,
I want to move flexible activities up and down, past bookings if needed, and drop a new one in where it belongs,
So that the order is mine to set and the times follow from it.

**FRs covered:** FR43 (amended)

**Depends on:** Story 13.1.

**Context:** Since 13.1, order is stored and flexible times follow from it. *Nach oben / Nach unten* (11.3) therefore becomes a pure order change. A fixed activity's place follows from its time, so it is not moved by these controls. Because every existing activity is fixed after the migration, the user needs one step to release a whole day.

**Acceptance Criteria:**

**Given** a flexible activity with a neighbour in a direction, fixed or flexible
**When** *Nach oben* or *Nach unten* is chosen
**Then** it swaps places with that neighbour, the day is recomputed, non-consecutive legs are swept, and the notice offers *Rückgängig* for the whole change

**Given** a fixed activity
**Then** *Nach oben / Nach unten* are not offered; the menu shows instead "Feste Zeit — Platz ergibt sich aus der Uhrzeit"

**Given** the activity dialog for a new flexible activity
**Then** an *Einfügen nach* select lists the day's activities in order with "Am Ende" as the default, and the new activity is placed there

**Given** an activity moved to another day (Stories 6.7, 6.23, including whole-day move and swap)
**Then** a flexible one is appended to the target day, a fixed one is placed by time, and both days are recomputed in the same transaction (undo for this path remains out of scope, as in Epic 11)

**Given** a day with fixed activities
**When** *Alle flexibel machen* is chosen from the day menu and confirmed
**Then** every fixed activity on the day becomes flexible with its current duration, keeping the order, the day is recomputed, and the notice offers *Rückgängig*

**Given** both dictionaries
**Then** `en.ts` and `de.ts` carry every new string

### Story 13.4: Suggestions and Backups Speak in Durations

As someone taking over AI suggestions or restoring a backup,
I want them to arrive as flexible activities with their durations,
So that they behave like everything else on the day.

**FRs covered:** FR45 (amended), FR46

**Depends on:** Story 13.1.

**Acceptance Criteria:**

**Given** selected suggestions applied (Story 12.4)
**Then** each becomes a `FLEXIBLE` activity with its suggested duration rounded up to 5 minutes, appended in visiting order after the day's last activity, with legs created as today, and the day is recomputed by `scheduleDay`; `chainTimes` and `planStartMinute` are removed, and suggestion overflow past midnight becomes a 13.2 conflict instead of untimed activities

**Given** the suggestions preview
**Then** it shows the times `scheduleDay` would produce, from the same function

**Given** a backup export
**Then** each activity carries `scheduleMode`, `durationMinutes` and `sortOrder`

**Given** a backup import from before this change (no `scheduleMode`)
**Then** activities with times become `FIXED`, untimed ones `FLEXIBLE` with 15 minutes, order follows the old comparator — the same rule as the migration — and a backup with the new fields round-trips exactly
```

### 4.3 Architecture: `architecture.md`

**Data Architecture**, append:
```
- **Activities planned by duration (2026-10-17, Epic 13):** `DayPlanItem` carries `scheduleMode` (`FLEXIBLE` | `FIXED`), `durationMinutes` and `sortOrder`. Order is stored in `sortOrder`, not derived from `fromTime`. This reverses the 2026-10-10 decision. `fromTime`/`toTime` are stored as the computed result of the pure `scheduleDay` rule and recomputed by the server on every write that can affect them, so every reader of times is unaffected. Plan conflicts are derived on read and never stored.
```

**API & Communication Patterns**, the 2026-10-10 receipt line: replace *"Order remains derived from `fromTime`; no `sortOrder` column."* with *"Since 2026-10-17 (Epic 13), receipts are version 3 and include previous `sortOrder` and the edited activity's previous mode and duration; delete and leg delete also recompute the day."*

### 4.4 Design system: `DESIGN.md`, `EXPERIENCE.md`

**`DESIGN.md` → Components**, after `action-notice`:
```
- **schedule-mode** — A two-segment toggle at the top of the activity dialog's *Wann & Wo* tab: *Flexibel* / *Feste Zeit*. Same height and radius as `input`, selected segment in {colors.accent-soft} with {colors.ink} 700-weight text. *Flexibel* reveals one duration field (hours + minutes) and a read-only computed-time line in {colors.ink-soft}; *Feste Zeit* reveals start and either end or duration.

- **plan-conflict** — The marker for a day whose plan cannot work. It belongs to the warn family, because it is an actionable gap. On the affected activity card: the small alert icon and one line in {colors.warn} ("Erreichbar erst 12:40 (40 Min zu spät)", "Passt nicht mehr in den Tag"). On the day hero: a {colors.warn-bg} pill "Der Plan geht nicht auf · 2". On the trip overview: the `day-row` gap treatment, as for a missing stay. Never colour alone, and never on an activity without a conflict.
```

Time pill: a fixed activity's pill adds a 12px lock glyph before the time, in {colors.ink-soft}.

**`EXPERIENCE.md`**:

- In the *Change with side effects* row, delete the check-in reference and replace *"A refused change (midnight, predecessor)"* with *"A refused change"*.
- Add a row:
```
| Plan does not work out | Day view and trip overview, whenever a day's derived schedule has a conflict (FR47): a fixed activity reached late, fixed activities overlapping, the day past midnight | `plan-conflict` marker on the activity, the day hero and the day row. Persistent until the plan is fixed; never a refusal. Arriving at the night's stay after check-in is not a conflict. |
```

### 4.5 Sprint status: `sprint-status.yaml`

Appended after the `epic-12` block:
```yaml
  epic-13: backlog
  13-1-just-say-how-long: backlog
  13-2-when-the-plan-doesnt-work-out: backlog
  13-3-putting-the-day-in-order: backlog
  13-4-suggestions-and-backups-speak-in-durations: backlog
  epic-13-retrospective: optional
```

---

## 5. Implementation Handoff

**Scope: Moderate**, with one architecture checkpoint.

| Recipient | Responsibility |
|---|---|
| John (PM), this session | Apply 4.1, 4.2, 4.4 and 4.5 once this proposal is approved. |
| Winston (Architect), `bmad-agent-architect` | Before 13.1 is contexted, review the schema, the midnight clamp, conflicts derived on read, and receipt v3. Then apply 4.3. |
| `bmad-create-story` | Create 13.1 first. 13.2, 13.3 and 13.4 each depend only on 13.1 and can follow in any order. Recommended order: 13.2, 13.3, 13.4. |
| Developer agent / `bmad-dev-story` | In 13.1, write `scheduleDay` and its tests first, then the migration with its whole-DB invariance test, then rewire the write paths one by one. |
| Code review | Check that every write path that touches a day recomputes it in the same transaction, including delete, leg delete and move-to-day, and that the backfill changes no stored time. |

**Success criteria:**

1. A day with check-out 09:00, a 30-minute leg and three flexible activities of 1 h, 2 h and 30 min, with 20-minute legs between them, reads 09:30–10:30, 10:50–12:50 and 13:10–13:40, without the user typing a single time.
2. Shortening the second activity to 1 h moves the third to 12:10–12:40.
3. A fixed ferry at 12:00 after that chain shows *"Erreichbar erst …"* on its card, on the day hero and on the trip overview. Its time does not move, and the save succeeds.
4. After the migration, every existing activity's times are unchanged.
5. One *Rückgängig* restores the day exactly, including order and modes.

**Decisions recorded (Tommy, 2026-10-17):**

| # | Question | Ruling |
|---|---|---|
| 1 | Day start | Last night's check-out; 10:00 if none is stored; 09:00 with no stay the night before (keeps 12.4's ruling). |
| 2 | Pull forward | Yes. Flexible activities follow tightly in both directions. Reverses 2026-10-10 #3. |
| 3 | What collides | A flexible chain into a fixed activity, overlapping fixed activities, past midnight. All three warn; none refuses. |
| 4 | Check-in | Arriving later is normal; check-in is the earliest possible arrival. No warning. Reverses 2026-10-10 #4a. |
| 5 | Existing activities | All become fixed. |
| 6 | Untimed activities | Abolished. Without a duration, an activity takes 15 minutes ("kurz anhalten und umschauen"). |
| 7 | Reordering | The existing *Nach oben / Nach unten*. |
| 8 | Fixed activities and *Nach oben / unten* | Not offered; a fixed activity's place follows from its time. |
| 9 | *Alle flexibel machen* | Yes, per day (13.3). |
| 10 | Fixed input forms | Start + duration and start + end are one kind ("fixed") with two input forms. (Confirmed with approval.) |
