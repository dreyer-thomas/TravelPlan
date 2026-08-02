---
authored_against: 0ab5e0e
---

# Story 6.22: The Activity Dialog in Tabs

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want the activity dialog split into four tabs instead of one long scroll,
so that I can see what a section holds without scrolling through everything that comes before it.

## Acceptance Criteria

1. **Four tabs, and none of them holds a single field.**
   - **Was** — Titel, Beschreibung (with its own formatting toolbar)
   - **Wann & Wo** — Von, Bis, Ort
   - **Kosten** — Betrag, Zahlungsart, die Zahlungszeilen
   - **Medien & Links** — Galerie, Link
2. **An error is never invisible.** Every tab holding a field with an error carries a visible marker, and pressing save from any tab switches to the **first** tab with an error and puts focus on the offending field. Saving must never fail silently because the message is on a tab the user cannot see.
3. **The error-to-tab map is total and the compiler enforces it.** `fieldErrors` has six keys today — `title`, `contentJson`, `fromTime`, `toTime`, `costCents`, `linkUrl` — plus `paymentError` and `paymentRowErrors`. The map is typed so that adding a seventh key without assigning it a tab fails to compile.
4. **Nothing is lost by switching tabs.** Typed-but-unsaved values, the rich-text content, the selected files and an in-flight upload all survive moving away and back.
5. **It is not a wizard.** No Next/Back; every tab is reachable at any time, and Abbrechen/Speichern stay visible from all four.
6. **The tab bar does not read as a second toolbar.** The description already carries one (B, I, list, link, image). The two must be distinguishable at a glance at 390px.
7. **Tab semantics, not styled buttons.** `role="tablist"`/`tab`/`tabpanel` with `aria-controls`/`aria-selected`, arrow-key navigation between tabs, and each panel labelled by its tab.
8. **Behaviour is unchanged.** Every field, validation rule, default, upload path and save path works exactly as before. This story changes where a field is, not what it does.
9. **Shorter, measurably.** At 390px the tallest tab's content is shorter than today's whole form — which measures **1341px of content in a 556px window**, 2.4 screens.

## Tasks / Subtasks

- [ ] **Task 1 — The four panels** (AC: 1, 5, 8)
  - [ ] `TripDayPlanDialog.tsx` is 1284 lines; the form body runs from the title `FormField` at `:948` to the gallery at `:1243`. Move blocks into panels — do not rewrite them.
  - [ ] Grouping is decided (AC1) and follows from Tommy's own point: a tab with one control costs a tap and gives nothing. `Wann & Wo` pairs the two time fields with the location search; `Medien & Links` pairs the gallery with the link.
  - [ ] `Kosten` is one block that expands: `paymentMode` (`single`/`split`) reveals repeatable amount/date rows. It earns its tab by expansion, not by field count.
  - [ ] Keep `DialogActions` outside the panels. Save is not per-section.

- [ ] **Task 2 — Errors cannot hide** (AC: 2, 3)
  - [ ] This is the acceptance criterion the story exists to satisfy safely. A tabbed form that reports an error on a hidden tab is worse than the long scroll it replaced.
  - [ ] Build the map as a typed total function over the error keys, e.g. `Record<keyof FieldErrors, TabId>`, so the compiler refuses an unmapped key. `paymentError` and `paymentRowErrors` live outside `fieldErrors` and need mapping too — decide whether to fold them in or map them separately, and say which.
  - [ ] On save: compute the errors, and if any exist select the first tab (in tab order) that owns one, then focus that field. Do not merely mark the tab.
  - [ ] The marker must not rely on colour alone.

- [ ] **Task 3 — Nothing is lost** (AC: 4)
  - [ ] Good news, and worth knowing before designing around it: **every field is already `useState` in the dialog** (`:220-256`), not `react-hook-form`. State lives above the fields, so an unmounted panel cannot drop a value. The usual tabbed-form data-loss trap does not apply here — do not add machinery to solve a problem that is already solved.
  - [ ] The TipTap editor is created at dialog level with `useEditor` (`:280`), so content and undo history survive too; only `EditorContent`'s DOM host is re-attached. Check after switching away and back that the toolbar buttons still act on the editor and that undo still reaches edits made before the switch.
  - [ ] `galleryBusy` guards an upload in progress (`:1247`, `:1259`). Switching tabs mid-upload must not cancel it or lose the result.
  - [ ] Decide whether panels unmount or stay mounted and hidden, and record why. Unmounting is cheaper and safe for state; it costs scroll position and DOM focus.

- [ ] **Task 4 — Tabs, not a toolbar** (AC: 6, 7)
  - [ ] Tommy suggested "Tabs oder eine Toolbar". A toolbar is the wrong form here: the description already has one directly below, and two toolbars stacked read as one broken control. Tabs carry their own indicator and separate cleanly.
  - [ ] MUI `Tabs`/`Tab` give the ARIA wiring and arrow-key handling. Use them rather than hand-rolling buttons.
  - [ ] At 390px four German labels must fit — `variant="scrollable"` if they do not, but check before reaching for it, because a scrollable tab bar hides tabs and works against the story.

- [ ] **Task 5 — Tests** (AC: 1, 2, 4, 8)
  - [ ] `tripDayPlanDialog.test.tsx` is **1308 lines and 13 tests**, and nearly every one queries a field directly. If panels unmount, those fields are absent until their tab is selected — so most of the file needs a "select the tab first" step. Write one helper rather than repeating it.
  - [ ] Four smaller files also import this dialog (`tripDayPlanDialogImport`, `…ImportWithMocks`, `…MockMuiDialogImport`, `…MockMuiImport`). They test import shape rather than behaviour and should survive — confirm rather than assume.
  - [ ] New: an error on a non-active tab marks that tab; saving from tab 1 with an error on tab 3 switches to tab 3 and focuses the field (AC2). This is the assertion that makes the whole story safe.
  - [ ] New: type in a field, switch tabs, switch back, and the value is still there (AC4).
  - [ ] New: the error-to-tab map covers every key — a table-driven test, so a future key without a tab fails.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 6, 9)
  - [ ] jsdom computes no layout, so AC9 is browser-only.
  - [ ] At 390px measure the tallest panel's content height against today's 1341px.
  - [ ] Confirm the tab bar and the editor toolbar do not read as one control (AC6), in German, where labels are longest.
  - [ ] Walk the add flow end to end on a phone: this is where tabs cost the most, and it is the case to judge.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked, and what was measured

Tommy on 2026-08-02: *"Der Dialog für eine Aktivität ist mittlerweile recht lang geworden. Wäre es da nicht sinnvoll, wenn wir diesen in Bereiche aufteilen und diese z.B. mit Tabs oder einer Toolbar umschalten könnten? … Vielleicht könnten wir auch etwas zusammenlegen, damit es nicht nur ein Element ist."*

Measured at 390×844 before writing this: the dialog's content area is **556px tall and holds 1341px of content** — 2.4 screens — with **11 input fields**, and that is the *empty* add form. Split payments and a populated gallery make it taller.

Tabs were chosen over collapsible sections and a single "Weitere Angaben" toggle, with the error-visibility risk stated and accepted. AC2 is what makes that choice safe, so it is not optional.

### The grouping came from the right instinct

Tommy's own caveat — *"damit es nicht nur ein Element ist"* — is the reason this has four tabs and not six. A tab holding one field costs a tap and returns nothing.

### Two fears that turned out to be unfounded

Both were checked in the source before this spec was written, because both would have changed the shape of the work:

1. **Data loss on switching.** Every field is plain `useState` in the dialog (`:220-256`). There is no `react-hook-form`, so nothing unregisters and no value can be dropped by an unmounting panel.
2. **The rich-text editor.** `useEditor` runs at dialog level (`:280`), so the Editor instance — content and undo history — outlives any panel. Only `EditorContent`'s host div is re-attached.

Neither needs defending against. Say so in the Dev Agent Record rather than adding machinery.

### The one real risk

A tabbed form that reports a validation error on a tab the user is not looking at. Press Speichern, nothing appears to happen, and the reason is one tab away. That is the single most common way this pattern fails, and it is why AC2 asks for *switching and focusing* rather than for a marker alone.

The mapping is small and total today, which is the moment to make it compiler-enforced:

| Tab | Error keys |
|---|---|
| Was | `title`, `contentJson` |
| Wann & Wo | `fromTime`, `toTime` |
| Kosten | `costCents`, `paymentError`, `paymentRowErrors` |
| Medien & Links | `linkUrl` |

`Ort` and `Galerie` carry no error key today. If either gains one, AC3's typing is what makes the omission a compile error rather than an invisible bug.

### Traps

**1. Do not make it a wizard.** Tabs are random access. Next/Back turns editing one field into a walk through four screens — the opposite of what this story is for.

**2. The add flow pays for this, the edit flow gains.** Adding means visiting every tab; editing usually means one. AC5 and Task 6's walk-through exist so the cost to the add flow is looked at rather than assumed away.

**3. Two toolbars.** The tab bar sits directly above a formatting toolbar. If both are rendered as rows of small controls they read as one broken widget.

**4. The test file is the bulk of the work.** 1308 lines, 13 tests, nearly all querying fields that will not be in the DOM until their tab is selected.

**5. Do not rewrite the blocks.** Costs, payments, the location search and the gallery each carry their own history. This story moves them.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayPlanDialog.test.tsx` is the constraint, plus four small import-shape suites. AC6 and AC9 are browser-only.

### Project Structure Notes

`src/components/features/trips/TripDayPlanDialog.tsx` and both i18n dictionaries (four tab labels). No route, API, schema or validation change.

### Sequencing

Independent of 6.17–6.21. It touches no file they touch except the dictionaries, where it only adds keys.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.22]
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:220-256] — the state, and why nothing is lost
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:242-249] — `fieldErrors`, the keys the map must cover
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:280] — the editor instance, above any panel
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:948-1243] — the form body to be split

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
