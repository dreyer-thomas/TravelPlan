# Sprint Change Proposal — 2026-10-11

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** Amelia (Dev) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-11; edits 4.1–4.5 applied.
**Scope classification:** Minor. One new story (11.4) in Epic 11, which is still open. FR42 is widened. Story 11.2's AC14 and its stay-leg exclusion are narrowed. No schema migration, and no shipped work is reverted.

---

## 1. Issue Summary

**A longer journey does not push the day. Only an activity edit does.**

Tommy tested Epic 11 after 11.3 shipped (commit `b9df833`). On a day that starts at Glenfern Villas, the previous night's stay with check-out at 09:00, he changed the car leg to Fantail Falls to 3 h 15 min. The leg now runs 09:00–12:15, but Fantail Falls still starts at 12:10. The activity overlaps the journey, and nothing after it moved.

**Category:** a misunderstanding of the original requirement. FR42 names only activity edits (*"when users insert, retime or extend an activity"*). In use, the travel time between two places is part of the same chain. A user who learns that the drive is longer expects the day to follow, exactly as when an activity runs longer.

**Cause in the code: two deliberate exclusions in Story 11.2.**

1. `11-2-…md` AC14: *"the travel-segment routes do not run the walk."* `createTravelSegmentForTripDay` and `updateTravelSegmentForTripDay` (`travelSegmentRepo.ts:417-479`) write the leg row and nothing else.
2. `dayPlanPush.ts:45`: *"Legs to or from a stay never take part in the walk."* Even if Fantail Falls itself were saved, the walk would not count check-out 09:00 + 3 h 15 min as its earliest start. The walk starts at an activity and looks only at activity→activity legs.

The same gap shows when the previous night's check-out moves later. The leg's time pill moves, because the client draws it from the check-out (`TripDayView.tsx:2139-2153`, `previousStaySegment.endTime`), but the activities stay put.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 11 — Day Plans That Recalculate Themselves | Gains Story 11.4. The epic stays `in-progress`, and its retrospective waits for 11.4. |
| All other epics | No impact. |

### Story impact

| Story | Change |
|---|---|
| 11.4 | **New.** Leg saves and later check-outs push the day. They use the same walk, the same refusals and the same receipt and undo as the activity edits. |
| 11.2 | Shipped. AC14 is narrowed: the travel-segment routes now run the walk (from 11.4 on). Moving between days, import and restore still do not. The rule *"legs to or from a stay never take part"* is narrowed to *"a stay never takes part, except as the start of the day for the first activity (11.4)"*. Nothing in 11.2's own behaviour changes: a retime or insert still ignores the stay. |
| 11.1, 11.3 | Shipped, unchanged. 11.4 reuses the receipt, the undo endpoint, the `action-notice` and the `past_midnight` refusal. |
| 2.23, 6.5 (leg creation, Maps auto-fill) | Shipped. The leg dialog keeps its fields. A save can now return `409 day_plan_past_midnight`, shown in the dialog. |
| Accommodation dialog (current and previous night) | Shipped. A check-out change can now return `409 day_plan_past_midnight`, shown in the dialog. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `prd.md` | FR42 is widened to cover lengthening a leg and moving a stay's check-out later (4.1). `lastEdited` → `2026-10-11`. |
| `epics.md` | Requirements Inventory FR42 line updated to match the PRD. Epic 11 summary gains one clause. New Story 11.4 appended after 11.3. Story 11.2 gets an inline *narrowed by Story 11.4 (2026-10-11)* marker on the stay rule (4.2). |
| `architecture.md` | The *Day recalculation receipts* line gains the two new writers (4.4). |
| `EXPERIENCE.md` | The *Change with side effects* row names the leg dialog and the stay dialog as sources (4.3). `DESIGN.md`: no change; `action-notice` already covers this. |
| `sprint-status.yaml` | `11-4-…: backlog` after 11.3 (4.5). |

### Technical impact

**Rules, as additions to the 2026-10-10 rule set.**

8. **A leg is part of the chain.** Creating a leg, or saving one with a different duration or different endpoints, runs rule 1's walk from the activity the leg arrives at. That activity's earliest start is the leaving endpoint's end plus the leg's duration. If it already starts at or after that, nothing moves. Otherwise it shifts, keeping its duration, and the walk continues as in 11.2. A leg that arrives at a stay (tonight's) moves nothing.
9. **The previous night's stay starts the day.** For the walk in rule 8, a leg that leaves the previous night's stay has its start at that stay's check-out: the stored `checkOutTime`, or the 10:00 default the timeline already draws when none is stored (**Tommy's ruling, 2026-10-11**). The default moves from `TripDayView.tsx:757` into one shared constant, used by the client and the server.
10. **A later check-out pushes the next day.** Updating a stay so that its resolved check-out changes runs the walk on the *next* trip day from its first timed activity. The earliest start is the new check-out plus the stored leg stay→that activity, or the check-out alone if there is no leg. The last night of a trip has no next day, so nothing runs. **Creating** a stay, or copying one from the previous night, does **not** trigger this. Otherwise adding a hotel would move a 07:00 sunrise walk the next morning to 10:00 without being asked.
11. **Rules 2, 6 and 7 hold unchanged.** A shorter leg or an earlier check-out pulls nothing forward. A push past 23:59 is refused as a whole, and the leg or stay is not saved. The check-in warning line appears when the push moved something and the last activity now reaches tonight's stay after an explicit check-in.
12. **What does not change.** An activity edit (11.2) still ignores the stay: moving the first activity to 08:00 while check-out is 09:00 is accepted. That matches rule 3, which accepts an overlap with the predecessor's end. A leg or stay save never changes the order, so 11.1's sweep has nothing to remove, and the receipt's `removedTravelSegments` is always empty for these writes.

**The receipt gains three `edited` kinds.** The version stays 2, because adding members to a union is additive (the same argument as 11.3's `reordered`).

- `legCreated { segmentId, updatedAt }`. Undo deletes the leg. It is stale if the leg changed since.
- `legUpdated { segmentId, updatedAt, previous }`. `previous` is the full leg row (endpoints, transport type, duration, distance, link). Undo restores the row as a whole, including `updatedAt`.
- `stayCheckOutChanged { accommodationId, updatedAt, previousCheckOutTime }`. Undo restores the check-out time and `updatedAt`, plus every moved activity. The other fields of that stay save (name, cost, status, …) are **kept as saved**. Undo reverts only what caused the side effect. The receipt's `tripDayId` is the **pushed** day.

`movedItems` and its restore are reused unchanged. A save that moved nothing returns a receipt with no side effects, so no notice appears, as today.

**Where the notice appears.** The leg dialog and the previous-stay dialog are opened from the pushed day, so the notice shows there as usual. A check-out edit made from the stay's *own* day (day N) pushes day N+1. The notice then shows on day N, and its summary names the other day (*"3 Aktivitäten an Tag 5 verschoben"*), using one new string per language. Undo works from there, because the receipt carries day N+1's id.

**Server-side, in the write's own transaction.** The travel-segment create and update and the accommodation update move into `$transaction`s that read, plan, write the edit, apply the moves, compute the check-in warning and build the receipt. This follows 11.2's order. The pure planner gets a new entry point, `planDayPushFrom({ items, legs, startAfter })`, over the existing `walkFrom`. Here `startAfter` is either an activity (its end) or a fixed minute (the check-out). No new copy of the walk is written.

**Existing data is not repaired.** No migration or backfill. A day that overlaps today, like Tommy's screenshot, is corrected the next time its leg or check-out is saved.

---

## 3. Recommended Approach

**Option 1 — Direct adjustment: one new story in Epic 11. Selected.**
Effort: Medium-low. The walk, the receipt, the undo endpoint, the notice and the midnight refusal exist. New work: one planner entry point, three receipt kinds and their undo rules, transactions on two existing write paths, the two dialogs' `409` handling, and two or three strings.
Risk: Low-medium. The new risks are the cross-day receipt for a check-out edit and the shared default check-out constant. Both are server-side and unit-testable.

**Option 2 — Rollback: not viable.** Nothing shipped is wrong. It is incomplete.

**Option 3 — MVP review: not required.** One FR is widened; none is removed.

---

## 4. Detailed Change Proposals

### 4.1 PRD — `prd.md`

FR42, OLD:
> FR42: When users insert, retime or extend an activity, later activities on that day move back only as far as needed to start after the previous activity ends plus the travel time between them, keeping their order and duration; gaps are never closed automatically. Travel legs whose two endpoints are no longer consecutive are removed, and the whole change, including every moved activity and removed leg, can be undone. **(Added 2026-10-10 — see Sprint Change Proposal 2026-10-10)**

NEW:
> FR42: When users insert, retime or extend an activity, lengthen a travel leg, or move the previous night's check-out later, later activities on that day move back only as far as needed to start after the previous activity (or the check-out) ends plus the travel time between them, keeping their order and duration; gaps are never closed automatically. Travel legs whose two endpoints are no longer consecutive are removed, and the whole change, including every moved activity and removed leg, can be undone. **(Added 2026-10-10 — see Sprint Change Proposal 2026-10-10; widened 2026-10-11 to legs and check-out — see Sprint Change Proposal 2026-10-11)**

Rationale: the travel time is part of the same chain, as Tommy's test shows.

### 4.2 Epics — `epics.md`

**Requirements Inventory**, FR42 line: same text as the PRD, without the bold provenance note.

**Epic List**, Epic 11 summary, OLD:
> Users can change one time on a day and have the rest of the day follow — later activities pushed back as far as needed, …

NEW:
> Users can change one time on a day — an activity, a travel leg or the morning's check-out — and have the rest of the day follow — later activities pushed back as far as needed, …

**Story 11.2**, after its *Context* paragraph, append:
> *Narrowed by Story 11.4 (2026-10-11): leg saves and a later check-out of the previous night's stay now run the same walk; the travel-segment routes are no longer excluded.*

**New story, appended after Story 11.3:**

> ### Story 11.4: When the Journey Takes Longer
>
> As someone who finds out a drive takes longer than I planned, or that I leave the hotel later,
> I want the activities after it pushed back just as far as they have to go,
> So that my day never shows me arriving somewhere after I am supposed to be there.
>
> **FRs covered:** FR42 (legs and check-out)
>
> **Depends on:** Stories 11.1, 11.2 and 11.3. It reuses the walk, the receipt, the undo endpoint, the `action-notice` and the midnight refusal; it builds no second copy of any of them.
>
> **Context:** 11.2 ran the walk only from an edited activity and left the travel-segment routes and the stays out (11.2 AC14, `dayPlanPush.ts:45`). In use, a leg made longer left the next activity overlapping the journey (Tommy, 2026-10-11: Glenfern Villas check-out 09:00 → car 3 h 15 min → Fantail Falls still at 12:10). Rulings: a leg's leaving end is the previous activity's end or, for the previous night's stay, its check-out (stored, or the 10:00 default the timeline already draws); creating or copying a stay never pushes; undo of a check-out change reverts the check-out time and the moves, not the rest of the stay save.
>
> **Acceptance Criteria:**
>
> **Given** a leg between two activities
> **When** it is created, or saved with a longer duration or different endpoints
> **Then** the walk from Story 11.2 runs from the activity it arrives at, whose earliest start is the leaving activity's end plus the leg's duration; slack absorbs it, the walk stops at the first activity that fits, and untimed activities are skipped
>
> **Given** a leg from the previous night's stay to the day's first timed activity
> **When** it is created or saved
> **Then** that activity's earliest start is the stay's check-out plus the leg's duration, where the check-out is the stored `checkOutTime` or, if none is stored, the same 10:00 default the timeline draws (one shared constant for client and server)
>
> **Given** a stay whose check-out is changed on an update
> **When** it is saved
> **Then** the walk runs on the next trip day from its first timed activity, whose earliest start is the new check-out plus the stored leg from the stay to it (or the check-out alone); the last night of a trip pushes nothing
>
> **Given** a stay that is created or copied from the previous night
> **Then** nothing is pushed
>
> **Given** a shorter leg, a deleted leg, an earlier check-out, or a leg that arrives at tonight's stay
> **Then** no activity moves
>
> **Given** a push from a leg or check-out that would move any activity past `23:59`
> **Then** nothing is written — neither the leg nor the stay — and the leg dialog or the stay dialog shows 11.2's message naming the activity that would not fit
>
> **Given** an activity edit (Story 11.2)
> **Then** the stay is still not part of its walk: a first activity moved before the check-out is accepted, as an overlap with a predecessor's end is today
>
> **Given** a leg or check-out save that moved activities
> **Then** it returns a change receipt (version 2) with a new `edited` kind (`legCreated`, `legUpdated` with the leg's previous row, or `stayCheckOutChanged` with the previous check-out), every moved activity in `movedItems`, no removed legs, and 11.2's check-in warning when it applies; the `action-notice` appears with the count
>
> **Given** *Rückgängig* on such a notice
> **Then** one transaction restores every moved activity and the leg (deleted if created, its previous row if updated) or the previous check-out time, and the day reads exactly as before (whole-DB `toEqual`, including `updatedAt`); the stay's other saved fields are kept; if any named row changed since, undo is refused as `409 undo_stale`
>
> **Given** a check-out edit made from the stay's own day that pushed the next day
> **Then** the notice appears on the day where the save was made, names the pushed day in its summary, and *Rückgängig* works from there
>
> **Given** the recalculation
> **Then** it runs in the repository inside the leg or stay write's own transaction, through one new entry point over 11.2's extracted walk, unit-tested for: a longer leg absorbed by slack; a chain push from a leg; a stay leg with a stored and with a default check-out; a later check-out with and without a leg; an earlier check-out moving nothing; the midnight refusal
>
> **Given** both dictionaries
> **Then** `en.ts` and `de.ts` carry the new strings, including the notice summary that names another day

### 4.3 UX — `EXPERIENCE.md`

*Change with side effects* row, OLD *Where* cell:
> Day view, after saving or reordering an activity moved others or removed travel legs (FR42, FR43)

NEW:
> Day view, after saving or reordering an activity, saving a travel leg, or changing a stay's check-out moved others or removed travel legs (FR42, FR43). A check-out change made on the stay's own day that moved the next day's activities shows the notice there, naming the other day.

The *refused change* sentence gains: *"… it stays in the dialog (activity, leg or stay) as an inline error and nothing is saved."*

### 4.4 Architecture — `architecture.md`

*Day recalculation receipts* line, OLD:
> Writes that recalculate a day (day plan item create, update, delete, and in-day move) return `{ data: { item, receipt } }`, …

NEW:
> Writes that recalculate a day (day plan item create, update, delete, and in-day move; travel segment create and update; accommodation update when its check-out changes, which recalculates the *next* day) return their usual payload plus `receipt`, …

### 4.5 Sprint status — `sprint-status.yaml`

After `11-3-one-place-earlier-one-place-later: done`, add:
```
  11-4-when-the-journey-takes-longer: backlog
```
`epic-11` stays `in-progress`.

---

## 5. Implementation Handoff

**Scope: Minor.** The Developer agent implements it directly.

1. Apply edits 4.1–4.5 (this workflow, on approval).
2. `bmad-create-story 11.4`: the story file, with the code-level *Read this first* (transaction boundaries of the two write paths, the receipt union, the shared check-out default, and the cross-day notice).
3. `bmad-dev-story`, then `bmad-code-review`.

**Success criteria**

1. Tommy's case: saving the Glenfern Villas → Fantail Falls leg at 3 h 15 min moves Fantail Falls to 12:15–13:15 and walks on. One notice says what moved, and *Rückgängig* restores the old leg and times.
2. Making a leg longer never moves anything when the slack covers it, and making it shorter never moves anything.
3. Setting the previous night's check-out later pushes the next morning only as far as needed. Adding a new hotel never moves anything.
4. A push past midnight from a leg or a stay saves nothing and says which activity would not fit.
5. All existing Epic 11 tests stay green. No activity edit behaves differently.
