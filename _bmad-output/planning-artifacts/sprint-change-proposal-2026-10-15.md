# Sprint Change Proposal — 2026-10-15

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-15 ("ja, mache die story", in answer to the three rulings below). Edits 4.1 and 4.2 applied.
**Scope classification:** Minor. One new story (6.31) in Epic 6, which is still `in-progress`. No PRD, architecture or UX change. No schema migration, and no shipped work is reverted.

---

## 1. Issue Summary

**There is no train.** On 2026-10-15 Tommy noticed that a travel leg cannot be recorded as a train journey. The mode set is `car | ship | flight | walking | cycling` (`src/lib/trips/transportTypes.ts:15`, `TravelTransportType` in `prisma/schema.prisma`). A rail or coach leg has to be filed as one of those modes, or left out.

**Category:** a gap in the original scope, not a defect. Story 6.16 widened the set once before (walking, cycling). This change is the same kind of widening.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 6 — Usability Refinements | Gains Story 6.31. The epic stays `in-progress`. Its retrospective is already `done`, and a single follow-on story does not reopen it. |
| All other epics | No impact. Epic 11's push treats every leg the same whatever its mode. |

### Story impact

| Story | Change |
|---|---|
| 6.31 | **New.** Train and bus as travel modes. |
| 6.16 | Shipped, unchanged. It is the template for 6.31 and built the single vocabulary module that 6.31 widens. |
| 6.5 (route import) | Shipped, unchanged. Train and bus are deliberately left out of the import. |

### Artifact conflicts

| Artifact | Update |
|---|---|
| `prd.md` | None. PRD FR25 says "mode" without listing the modes. |
| `epics.md` | Story 6.31 appended after 6.30 (4.1). |
| `architecture.md` | None. |
| `DESIGN.md` / `EXPERIENCE.md` | None. EXPERIENCE.md already says a travel-segment node's icon comes from `transportType`. The two new glyphs follow the existing stroke set. |
| `sprint-status.yaml` | `6-31-train-and-bus-as-travel-modes: backlog` (4.2). |

### Technical impact

- **No migration.** `travel_segments.transport_type` is plain `TEXT` with no CHECK constraint, so widening the enum emits no DDL.
- **Lists the compiler checks:** `transportIconFor`, `TRANSPORT_LABEL_KEYS`, and the repository mappers in `travelSegmentRepo.ts` and `tripRepo.ts`.
- **Hand-written lists the compiler does *not* check:** `DayChangeTransportType` (`dayChangeReceipt.ts:36`), the import `z.enum` (`tripImportSchemas.ts:294`) and the dialog's `<MenuItem>` list (`TripDayTravelSegmentDialog.tsx:~715`). The story requires a test that pins these lists to `TRANSPORT_TYPES`.
- **Left alone on purpose:** the route-lookup schema (`travelSegmentRouteLookupSchemas.ts`), the OSRM profile map (`route-preview/route.ts`) and the Google travel-mode map in the dialog.
- i18n: `trips.travelSegment.transport.train` / `.bus` in `de.ts` ("Bahn", "Bus") and `en.ts` ("Train", "Bus"). The route-import helper text is checked so it stays accurate.

---

## 3. Recommended Approach

**Direct adjustment.** Add one story to Epic 6, following 6.16's pattern.

Tommy's rulings, 2026-10-15:
1. **Two modes, `train` and `bus`.** A single "public transport" mode would be vaguer, and the second mode costs almost nothing once the enum is open.
2. **Distance allowed, not required.** This is the same rule as walking and cycling. Rail kilometres are rarely known, but they are worth keeping when they are.
3. **No automatic route import.** OSRM has no rail profile. A road profile for a bus gives a road time, not the timetable's. A Google `transit` lookup depends on a departure time and on changes between services. Train and bus stay manual, like ship and flight. Route import for them would be a later story if it is ever wanted.

**Effort:** small, about one dev session. **Risk:** low. The main risk is a missed hand-written list, which the new pinning test covers. **Timeline:** no effect on other work.

---

## 4. Detailed Change Proposals

### 4.1 `epics.md` — new Story 6.31 after Story 6.30

Added in full: "Story 6.31: Train and Bus as Travel Modes". It has seven acceptance criteria:
- mode set and labels, with no migration
- glyphs
- the distance rule
- no route import
- surfaces unchanged
- backup and receipt round-trip
- the pinning test for the hand-written lists

### 4.2 `sprint-status.yaml`

```
OLD:
  6-30-one-decimal-for-a-distance-a-comma-in-the-box: done
  epic-6-retrospective: done

NEW:
  6-30-one-decimal-for-a-distance-a-comma-in-the-box: done
  6-31-train-and-bus-as-travel-modes: backlog
  epic-6-retrospective: done
```

---

## 5. Implementation Handoff

**Scope:** Minor. The work goes straight to development.

1. `bmad-create-story 6-31` builds the full story file against the live codebase.
2. `bmad-dev-story` implements it.
3. `bmad-code-review` reviews it.

**Success criteria:**
- A train or bus leg can be created, edited and printed, and shows its own glyph.
- It survives export and import, and an Epic 11 undo.
- Existing segments are untouched.
- No new migration.
- The full suite is green.
