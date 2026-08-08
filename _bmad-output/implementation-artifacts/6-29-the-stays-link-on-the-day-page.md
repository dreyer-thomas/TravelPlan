---
authored_against: 0fd061d
baseline_commit: 0fd061d749bad07e2462fb790e9821c47a24a779
---

# Story 6.29: The Stay's Link on the Day Page

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## What is asked for

A stay's booking link is reachable **only** from the trip overview, where the stay name in the day row is the anchor (`TripTimeline.tsx:843-846`). The day detail page shows the same stay twice — last night's at the top, this night's at the bottom — and neither offers the link. Standing on the day page, the traveller has to navigate back to the overview to open a booking.

Put the link on both stay cards in the day view.

## ⚠️ And one finding that ships with it

While confirming the data path, the link's validation was tested rather than read:

```
z.string().trim().url().max(2000)      // accommodationSchemas.ts:21
  "https://booking.com/x"     ACCEPTED
  "javascript:alert(1)"       ACCEPTED
  "data:text/html,<h1>x"      ACCEPTED
```

Zod 4.4.3's `.url()` validates URL *syntax*, not scheme. Meanwhile the trip overview places the stored value straight into `href` with **no** scheme guard, while the day view's *activity* link one file over is guarded by `isSafeLink` (`TripDayView.tsx:3384`). The two link surfaces already disagree, and the unguarded one is the one that is live today for stays.

Adding two more render sites without fixing that would ship a third and fourth unguarded site. So the guard comes with the feature. Note the ordering that makes this matter more than it looks: **Story 5.13 lets contributors write to a trip they do not own** — an unguarded stored link stops being self-inflicted the moment more than one person can write it.

## Story

As a traveller looking at a single day,
I want the booking link of last night's and tonight's stay right there on the day page,
so that I can open a reservation without navigating back to the trip overview.

## Acceptance Criteria

1. **AC1** — The previous night's stay card (top of the day timeline) offers its link when the stay has one, and shows nothing extra when it does not.
2. **AC2** — This night's stay card (bottom of the day timeline) does the same.
3. **AC3** — Both open in a new tab with `rel="noreferrer noopener"`, and a click on the link opens **only** the link — it must not also open the stay's edit dialog, on pointer or on keyboard.
4. **AC4** — A link whose scheme is neither `http:` nor `https:` is not rendered as a link anywhere: not on the two new cards and not on the trip overview row, which is unguarded today.
5. **AC5** — A stay link with an unsupported scheme can no longer be **stored**. Existing rows are unaffected by the write-side change and are handled by AC4's render guard.
6. **AC6** — A `VIEWER`, who has no edit overlay on these cards, can still open both links.
7. **AC7** — No new i18n key. `trips.stay.linkOpen` already exists in both dictionaries with no consumer and is exactly this string.

## Tasks / Subtasks

- [ ] `src/components/features/trips/TripDayView.tsx` — previous-night stay card. Render the link inside the card, copying the activity pattern at `:3384-3399` verbatim in structure: `Button component="a" href={…} target="_blank" rel="noreferrer noopener" variant="text" size="small"`, guarded by `stay.link && isSafeLink(stay.link)`. `isSafeLink` is already imported in this file — AC1, AC3, AC4
- [ ] `src/components/features/trips/TripDayView.tsx` — this night's stay card, the same. The two stay cards look alike and edit different days; `:3441-3444`'s comment records that crossing their wires is a silent data bug no visual check catches. Keep the link with the card it belongs to — AC2, AC3, AC4
- [ ] `src/components/features/trips/TripTimeline.tsx` — guard the existing overview link. `:843-846` builds `component={link ? "a" : "span"}` from the raw value; the condition becomes `link && isSafeLink(link)`. `isSafeLink` is exported from `TripDayPlanItemContent.tsx` and this file does not import it yet. An unsafe value then renders as the plain `<span>` the no-link case already produces — no new empty state to design — AC4
- [ ] `src/lib/validation/accommodationSchemas.ts` — `linkSchema` (`:21`) gains a scheme check so `javascript:` and `data:` can no longer be stored. Keep `.url()` and `.max(2000)`; add the constraint rather than replacing the validation with a hand-rolled regex — AC5
- [ ] `test/` — the render cases on both stay cards: a link renders, no link renders nothing, a `javascript:` link renders nothing. Assert the anchor's `target` and `rel` — AC1, AC2, AC4
- [ ] `test/` — the click case: clicking the link does not open the stay dialog. This is AC3's real content and the one a reviewer cannot see by reading — AC3
- [ ] `test/` — the overview guard, in the existing `TripTimeline` suite, and the schema rejection in the existing accommodation-schema suite — AC4, AC5
- [ ] `src/i18n/en.ts`, `src/i18n/de.ts` — **no new keys.** Confirm `trips.stay.linkOpen` ("Open link" / "Link öffnen") is now consumed; if any sibling key in that block is still orphaned at the end of the story, delete it rather than leaving it for a third feature — AC7

## Dev Notes

### The data is already there

`TripDay["accommodation"]` in `TripDayView.tsx:304-315` already carries `link: string | null`, and both `previousStay` (`:1481`) and `currentStay` (`:1482`) are that same object. Nothing needs fetching, no route changes, no repository change, no schema migration. This is a rendering story plus one validation tightening.

### Why the link is a separate control and not the stay name

On the trip overview the stay *name* is the anchor. Do **not** copy that here.

Those two surfaces mean different things by a click. The overview row navigates to the day; making the stay name a link inside it takes over a click that would otherwise just navigate. On the day page both stay cards are edit targets — Story 6.13 stretched a `<button>` across the whole card, and the card *is* how you edit the stay. Turning the name into an anchor there would silently steal the most obvious click for editing.

So: a small text link inside the card, exactly like the activity card's, which solved this same problem in this same file.

### The overlay is already solved — do not invent a workaround

Both stay cards sit under a stretched overlay button, and both already apply the escape hatch (`:3223` for the previous stay, `:3476` for the current one):

```ts
const overlaidContentSx = canEditPlanning
  ? { position: "relative", zIndex: 2, pointerEvents: "none", "& a, & button": { pointerEvents: "auto" } }
  : {};
```

An `<a>` inside a container carrying that style gets its pointer events back and sits above the overlay. The activity link's own comment states the consequence: *"No `stopPropagation` needed … the click lands here and the overlay never sees it, on pointer or on keyboard."*

Two details that follow:

- **Place the link inside a container that already has `overlaidContentSx`**, or add it. Outside one, the overlay swallows the click and the card opens the dialog instead — which is AC3 failing in the most confusing possible way, because the link looks fine and does the wrong thing.
- **The previous-stay card gates on a different flag.** `:3223` uses `canEditPreviousStay ? overlaidContentSx : {}`, not `canEditPlanning`. Read which flag guards the container you put the link in; picking the wrong one produces a link that works on one card and not the other.

For a `VIEWER` (AC6) `overlaidContentSx` is `{}` and there is no overlay button at all, so the link works naturally. Both branches need to hold, and the viewer branch is the one no one thinks to check.

### `isSafeLink` is the guard, and it is deliberately blunt

```ts
export const isSafeLink = (value: string) =>
  value.trim().toLowerCase().startsWith("http://") || startsWith("https://");
```

`TripDayPlanItemContent.tsx:22`, already used for activity links and for images inside rich text. Reuse it; do not write a second predicate. It is `"use client"` — fine for all three render sites, all of which are client components. If the schema change wants the same rule server-side, express it in the schema rather than importing this module into server code; that file's own docblock at `:26-30` records why a client module must not be reached from the server.

### The write side and the rows already stored

Tightening `linkSchema` stops new bad values. It does **not** clean existing rows, and this story does not migrate data — a stored `javascript:` link keeps sitting in the column and is simply never rendered as a link. That is deliberate: a render guard protects every existing row immediately and cannot be bypassed by a row written before the schema changed, whereas a migration would have to guess what the user meant.

The import path validates with its own schemas (`tripImportSchemas.ts`), so an archive can carry a link written before this story. AC4's render guard covers that too. Worth a line in the ledger if the import schema is found to be looser than the write schema after this change.

### What must not regress

- **The overview row's no-link case.** `component={link ? "a" : "span"}` already renders a `<span>` when there is no link, and the styling is shared between both branches. An unsafe link must take that same `<span>` path — not a third state.
- **The stay dialog.** `trips.stay.linkLabel` / `linkHelper` / `linkInvalid` are the edit-side strings and are already wired. The schema change may surface `linkInvalid` on a value that used to be accepted; that is the intended behaviour, not a regression.
- **The activity link.** `:3384` is the pattern being copied, not a site being changed.

### Traps

1. **Making the stay name the link** because the overview does. See above — it takes over the click that edits.
2. **Adding the link outside an `overlaidContentSx` container.** It renders, it looks right, and it opens the edit dialog instead. Only a click test catches it.
3. **Fixing the two new sites and leaving the overview unguarded.** AC4 names three sites for that reason.
4. **Replacing `.url()` with a regex.** The task is to add a scheme constraint, not to re-implement URL parsing.
5. **Adding a `trips.stay.*` key that already exists.** `linkOpen` is there in both dictionaries, unused. This is the second orphaned-vocabulary case found this week — see Story 6.28, which puts eight `trips.location.*` orphans to work for the same reason.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`, `// @vitest-environment jsdom` with `renderWithProviders` for the component cases. The existing day-view suites already build a day with an accommodation, so the link cases are additional fixtures on that setup rather than new files. The click assertion needs `userEvent`, which the day-view suites already use.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

No new files, no new dependency, no migration, no route change. Two render sites added in `TripDayView.tsx`, one condition tightened in `TripTimeline.tsx`, one schema line in `accommodationSchemas.ts`, and test cases in existing suites.

### References

- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 6.29: The Stay's Link on the Day Page]
- The pattern to copy: `travelplan/src/components/features/trips/TripDayView.tsx:3384-3399`
- The overlay mechanism and why it needs no `stopPropagation`: same file, `:1874-1881`
- The card-is-the-edit-target decision: [Source: _bmad-output/implementation-artifacts/6-13-stay-cards-editable.md]
- Contributors gaining write access, which raises the stakes on the link guard: [Source: _bmad-output/implementation-artifacts/5-13-what-a-contributor-may-do-made-consistent.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

## Operator Pass — 2026-08-07

Run by Tommy against a clean archive of `6d23741` (HEAD; the story's park point `0fbdac9f` is its
direct ancestor, with only Story 6.30 between them) on an isolated port, with a throwaway copy of the
database and an empty `MEDIA_STORAGE_ROOT`. The real database and media tree were never opened. A
`VIEWER` account was seeded into the scratch database for AC6.

| # | Check | Result |
|---|---|---|
| 1 | Both stay links tapped in Chrome at 390px | **Pass** — booking opens in a new tab, the stay edit dialog does not open |
| 2 | The same two taps on real iOS Safari, portrait | **Pass** |
| 3 | Tap-target measurement | **71.12 × 44** — see below |
| 4 | Both stay links tapped as a `VIEWER` | **Pass** — the no-overlay branch works |
| 5 | `javascript:alert(1)` submitted in the stay Link field | **Pass** — inline field error, no generic failure banner |

Checks 1, 2 and 4 are the ones jsdom cannot answer: it does not hit-test, so the whole question of
whether the link or the stretched edit overlay receives the tap only exists in a real engine. Both
engines were exercised deliberately — Chrome's pointer emulation and Safari's touch hit-testing are
different mechanisms, and the overlay and the link genuinely overlap.

### DW-206 is closed by check 3, and the entry was wrong

The review recorded the three link controls as *"roughly a 22px tap target"* against DESIGN.md's 44px
floor, reasoning from `sx={{ p: 0, minWidth: "auto", alignSelf: "flex-start" }}` on a `size="small"`
text `Button`. The measurement says **71.12 × 44** — exactly on the floor.

`p: 0` removes the *padding*. It does not touch `minHeight`, and `src/theme.ts:355-358` sets
`MuiButton.styleOverrides.root.minHeight = 44` for every button in the application. All three sites
are MUI `Button`s and inherit it, so the floor holds structurally rather than by luck at one of them.

The finding was derived from a component's own `sx` without resolving it against the theme cascade —
a claim only a measurement could settle, which is what this pass is for. DW-206 is closed as not
reproducible; no work is owed. DW-207 (all five links accessibly named "Open link") survives on its
own merits, and its "bundle with DW-206" routing has been corrected.
