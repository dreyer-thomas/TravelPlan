---
authored_against: 096291f
baseline_revision: 607ddc6eea7417edc7670dd6f25d3a48d7d9c652
final_revision: 53d763ca631be2de8107702a06e1b127a4a406b9
status: done
review_loop_iteration: 0
followup_review_recommended: false
warnings: []
operator_actions:
  - "Run the day view in a browser at 390px and at a desktop width, as owner and as viewer, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that session; no agent can do any of it, because this repo has no browser automation and jsdom computes no layout."
  - "Confirm the chevrons are legible over a bright photo (Task 6, AC1). They sit at the hero's vertical midpoint, which is exactly where `HERO_SCRIM` is deliberately at its weakest — the scrim runs 0.88 at the bottom and near-transparent through the middle. `ON_PHOTO_CHROME` is a white glyph on a translucent white fill with a white border, so a snow or sky photo is the worst case. Check one bright day photo and one dark one."
  - "Judge whether a long day note reading under the chevrons is acceptable (Task 6, AC1). Open a day whose note wraps the title to two lines. The chevrons now carry `zIndex: 3`, so they stay fully clickable and paint on top — the operable defect is fixed — but the glyph will overlap the start of the title text. If that reads badly, say so rather than patching it: the fix is a horizontal inset on the title block, which moves what Story 6.9 aligned to the hero's 32px gutter and needs a deliberate spec amendment."
  - "Accept or reject the hero's new phone padding. To fit the second button this story added to the header's right slot, the hero's horizontal padding went from a fixed 32px to `{ xs: 16px, md: 32px }`, matching the panel directly beneath it. Without it the German nowrap \"← Zurück zur Reise\" overflowed at 360px. Confirm the hero still reads right at 390px and that nothing else in it looks cramped."
  - "Confirm the reclaimed space (Task 6, AC8). At 390px the hero card should be followed directly by the day's content, with no toolbar band between them."
  - "Confirm print is still reachable as a viewer (Task 6, AC6). Open the trip as a viewer, click the `⋯` in the hero header, and check the print item opens `/trips/{id}/days/{dayId}/print` in a new tab. The day-image edit action beside it must not be there."
  - "Make the discoverability call on the overflow. Print is now two interactions behind an unlabelled `⋯`, and the words \"Print day\" appear nowhere on the page until the menu is open. This is the design you decided on 2026-08-01, so it is not being raised as a defect — but it is the trade the first real use will test, and it is cheaper to revisit now than after a trip."
  - "When the checks pass, tick Task 6's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-11-day-nav-chevrons-and-print-menu` in `sprint-status.yaml`."
---

# Story 6.11: Day Navigation as Hero Chevrons, Print Into an Overflow Menu

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner opening a day on my phone,
I want previous/next to be chevrons on the day photo and print to live behind an overflow menu,
so that the day view stops spending a full toolbar row on three controls I rarely need.

## Acceptance Criteria

1. **Chevrons in the hero.** Given a day with both neighbours, when the day view renders, then a previous and a next chevron are rendered inside the day hero photo — one at each side, vertically centred — each spreading `ON_PHOTO_CHROME`, each an explicit 44×44 hit area, and each keeping its existing accessible name (`trips.dayView.previousAria` / `trips.dayView.nextAria`).

2. **Absent, not disabled.** Given the first day of a trip, when the day view renders, then no previous control exists in the DOM at all — no disabled button, no placeholder, nothing focusable. Given the last day, then the same holds for the next control.

3. **Toolbar gone.** Given any day, when the day view renders, then the flex row that held previous/next/print (`TripDayView.tsx:2063-2105` at the baseline) is absent from the DOM entirely — not present as an empty container.

4. **Print behind an overflow menu.** Given any day, when the user activates the `⋯` control in the hero header's right slot, then a MUI `Menu` opens containing a single print `MenuItem` labelled `trips.dayView.printAction`, built from the same `Menu` / `MenuItem` treatment `HeaderMenu.tsx:186-229` uses.

5. **Global menu untouched.** Given the finished change, when `git diff` is inspected, then `travelplan/src/components/HeaderMenu.tsx` and `travelplan/src/lib/navigation/authMenu.ts` show no modification.

6. **Print is not owner-gated.** Given a trip opened as `viewer` or `contributor`, when the day view renders, then the `⋯` overflow control is present and its print item is reachable. Given `owner`, then the right slot renders the day-image edit action *and* the overflow; given a non-owner, then it renders the overflow only.

7. **Print behaviour preserved.** Given the overflow menu is open, when the print item is inspected, then it is a link to `/trips/{tripId}/days/{dayId}/print` carrying `target="_blank"` and `rel="noopener noreferrer"`; when it is clicked, then the menu closes.

8. **Space reclaimed.** Given a 390px viewport, when the day view is inspected in a real browser, then the hero card is followed directly by the day's content with no toolbar band between them.

9. **No functional change.** Given the finished change, when the full suite runs, then the timeline, coverage bar, stays, travel segments, bucket list, map panel, costs and the print document itself behave exactly as before.

## Tasks / Subtasks

- [x] **Task 1 — A left chevron and a `⋯` glyph** (AC: 1, 4)
  - [x] `travelplan/src/components/features/trips/TripIcons.tsx` -- add `ChevronLeftIcon` -- `ChevronRightIcon` exists (`:68`); a left-pointing one does not. Follow the module's own established convention (`ChevronDownIcon:82`, `ChevronUpIcon:101`): reuse the `M9 6l6 6-6 6` path with `transform="rotate(180 12 12)"` rather than authoring a second `d=` string that can drift.
  - [x] `travelplan/src/components/features/trips/TripIcons.tsx` -- add `MoreHorizontalIcon` (three dots) -- the `⋯` trigger needs a glyph, and this module is the established home for this feature's icons. Match the existing `IconProps` signature (`sx?: SxProps<Theme>`), `aria-hidden`, `viewBox="0 0 24 24"` and the `sx={[{ fontSize: 18 }, ...]}` array-merge shape the other icons use.

- [x] **Task 2 — Chevrons in the hero** (AC: 1, 2)
  - [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- render two chevron `IconButton`s absolutely positioned inside the `day-hero` Box (`:1816`, already `position: relative`) -- left and right, `top: "50%"`, `transform: "translateY(-50%)"`, above `HERO_SCRIM`'s `zIndex`.
  - [x] Spread `ON_PHOTO_CHROME` for fill, border, hover and the white `Mui-focusVisible` ring. Story 7.11 verified that ring in a browser — do not author a new one.
  - [x] Size them 44×44 explicitly: `sx={{ ...ON_PHOTO_CHROME, width: 44, height: 44 }}`. `size="small"` renders ~28px, and the theme's `minHeight: 44` is scoped to `MuiButton`, not `MuiIconButton`. The day-image edit button at `:1877-1890` already carries exactly this — match it.
  - [x] Keep `component={Link}` with the existing hrefs (`/trips/${tripId}/days/${previousDay.id}` and `.../${nextDay.id}`) so they stay real navigations, not JS handlers.
  - [x] Render **nothing** when `previousDay` / `nextDay` is `null` (`:842-854`). No disabled button, no placeholder, no reserved space.
  - [x] Add `data-testid="day-hero-prev"` / `data-testid="day-hero-next"` so absence is assertable without depending on translated names.

- [x] **Task 3 — Overflow menu** (AC: 4, 5, 6, 7)
  - [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- add `Menu`, `MenuItem` to the `@mui/material` import block (`:4-19`) and `ChevronLeftIcon`, `MoreHorizontalIcon` to the `TripIcons` import (`:33-42`) -- neither `Menu` nor `MenuItem` is currently imported and this file contains no menu today.
  - [x] Add `const [dayMenuAnchor, setDayMenuAnchor] = useState<null | HTMLElement>(null)` alongside the other `useState` calls (`:306-340`), plus open/close handlers. `HeaderMenu.tsx:24,59` is the shape.
  - [x] Add a `⋯` `IconButton` to the hero header's right-hand `Box` (`:1875`), beside the day-image edit action, with `ON_PHOTO_CHROME`, 44×44, `aria-label={t("trips.dayView.moreActions")}` and `data-testid="day-hero-overflow"`.
  - [x] Place it **outside** the `isOwner` conditional (`:1876-1891`). Print is a read action available to every role that can open the day; the edit action beside it is owner-only.
  - [x] Open a MUI `Menu` from it with one `MenuItem` — print — using `trips.dayView.printAction` as its label. ~~and `trips.dayView.printAria` as the item's `aria-label`~~ — **amended by the 2026-08-02 review pass:** no `aria-label`. It replaced the visible name rather than supplementing it (WCAG 2.5.3, Label in Name), so `printAria` lost its last reader and was deleted from both dictionaries alongside `previousAction`/`nextAction`.
  - [x] The `MenuItem` is `component={Link}` to `/trips/${tripId}/days/${day.id}/print` with `target="_blank"`, `rel="noopener noreferrer"` and `onClick` closing the menu. `HeaderMenu.tsx:219` is the shape to copy; carry over its `PaperProps` treatment (`:191-200`) so the two menus read as one idiom.
  - [x] **Do not touch** `HeaderMenu.tsx` or `authMenu.ts`. This menu belongs to the day page.

- [x] **Task 4 — Clean up what the move leaves behind** (AC: 3, 9)
  - [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- delete the toolbar `Box` at `:2063-2105` and its comment at `:2061-2062` -- the stats strip (closes `:2059`) must then be followed directly by the two-column grid (opens `:2107`).
  - [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- rewrite the right-slot comment at `:1873-1874` -- it reads *"Rendered even when empty so the row keeps two flex children and space-between goes on pinning the trip button left for a non-owner."* Once the overflow is unconditional the box is never empty, so that workaround no longer applies. Replace it with what is now true or delete it; a comment describing a dead workaround is worse than none.
  - [x] `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` -- delete `trips.dayView.previousAction` and `trips.dayView.nextAction` -- after Task 2 the chevrons carry no visible label and `TripDayView.tsx` was their only reader. **Keep** `previousAria` / `nextAria` (the chevrons need them) and **keep** `printAction` — `TripDayPrintPage.tsx:61` still reads it.
  - [x] `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` -- add `trips.dayView.moreActions` -- EN `"More actions"`, DE `"Weitere Aktionen"`. Insert next to the existing `trips.dayView.print*` keys (`en.ts:277-278`, `de.ts:276-277`) so the group stays together.

- [x] **Task 5 — Tests** (AC: 1, 2, 4, 6, 7)
  - [x] `travelplan/test/tripDayViewLayout.test.tsx:1071-1139` -- keep the middle-day test, and assert both chevrons' hrefs point at the neighbouring days -- a swapped left/right must be caught mechanically, not by eye. Add an assertion that both `data-testid`s are present.
  - [x] `travelplan/test/tripDayViewLayout.test.tsx:1141-1211` -- the German test asserts `toHaveTextContent("Zurück")` / `("Weiter")` on the nav controls. Those labels no longer exist. Keep the German aria-name lookups and the href assertions; drop the text-content assertions.
  - [x] `travelplan/test/tripDayViewLayout.test.tsx:1213-1283` -- rewrite "disables previous on first day and next on last day" as an *absence* test: on the first day `queryByTestId("day-hero-prev")` is null **and** no element with the accessible name `Go to previous day` exists in any role; the next chevron still links to the middle day. Mirror it for the last day.
  - [x] `travelplan/test/tripDayViewLayout.test.tsx:3684-3742` -- the print test does `getByRole("link", { name: /print|export/i })` against what used to be a always-rendered toolbar link. Open the overflow first (`userEvent.click` on `day-hero-overflow`), then assert `href`, `target="_blank"` and `rel="noopener noreferrer"` on the print item.
  - [x] `travelplan/test/tripDayViewLayout.test.tsx` -- add a role test: with `accessRole: "viewer"`, `day-hero-overflow` is present, the day-image edit action is absent, and opening the overflow exposes the print link. This is AC6's regression guard and no existing test covers print by role.
  - [x] `npm test` green from `travelplan/`.

- [x] **Task 6 — Manual check** (AC: 1, 6, 8) — **OWED TO THE OPERATOR.** jsdom computes no layout, and this repo has no browser automation (`npm run` offers only `dev`/`build`/`start`/`lint`/`test`; no Playwright, Puppeteer or Cypress). Chevron placement over photography and the reclaimed vertical space cannot be proven by an agent.
  - [x] Check at 390px and desktop, as owner and as viewer.
  - [x] Confirm the chevrons stay legible over a light photo and a dark one — that is what `ON_PHOTO_CHROME`'s translucent fill and white border are for, and the day hero shows arbitrary user photography.
  - [x] Confirm a long day note does not run under a chevron — see Traps 5.
  - [x] Throwaway copy of `dev.db` on an isolated port, never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Code Map

- `travelplan/src/components/features/trips/TripDayView.tsx` -- 2854 lines. The whole change lives here except the icons and dictionaries. Hero card wrapper `:1815`; hero `:1816-1910` (`position: relative`, `padding: "22px 32px 24px"`, `minHeight: 210`); scrim `:1831`; header row `:1840-1893`; left slot `:1852-1872`; right slot `:1875-1892` with its comment at `:1873-1874`; owner-gated edit `IconButton` `:1877-1890`; bottom-anchored title block `:1896-1909`; toolbar to delete `:2061-2105`; two-column grid opens `:2107`.
- `travelplan/src/components/features/trips/TripDayView.tsx:842-854` -- `previousDay` / `nextDay`, both `useMemo`, both `TripDay | null`, derived from `orderedDays` (`:716-719`) by index.
- `travelplan/src/components/features/trips/TripDayView.tsx:346-347` -- `isOwner` and `canEditPlanning`, both derived from `detail.trip.accessRole` and both defaulting to `true` when the role is absent.
- `travelplan/src/components/features/trips/TripIcons.tsx` -- `IconProps` `:27`; `ChevronRightIcon` `:68`; the rotate-a-shared-path convention `:76-115`; `HERO_SCRIM` `:311`; `ON_PHOTO_CHROME` `:321-327`.
- `travelplan/src/components/HeaderMenu.tsx:24,59,186-229` -- anchor state, `Menu` with `PaperProps`, and the `MenuItem component={Link} … onClick={handleClose}` shape to copy. **Read-only reference — do not edit.**
- `travelplan/src/i18n/en.ts:228-231,277-278` and `travelplan/src/i18n/de.ts:227-230,276-277` -- the nav and print keys.
- `travelplan/src/components/features/trips/TripDayPrintPage.tsx:61` -- the second reader of `trips.dayView.printAction`; the reason that key survives.
- `travelplan/test/tripDayViewLayout.test.tsx` -- 4738 lines, the only suite rendering `TripDayView`. Affected cases at `:1071`, `:1141`, `:1213`, `:3684`; the viewer-role case at `:259` is the model for the new AC6 test.

## Spec Change Log

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 3, low 7)
- defer: 2: (high 0, medium 0, low 2)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` The bottom-anchored hero title spans the chevron band on any two-line title and, at equal `zIndex`, won both painting and hit-testing — leaving ~20px of each 44px chevron dead to the touch. Chevrons raised to `zIndex: 3`; a navigation control outranks decorative text.
  - `[medium]` `[patch]` The unconditional overflow button added ~52px to the hero header's right slot, pushing the German nowrap "← Zurück zur Reise" past the usable width at 360px (≈300px needed vs 264px available) where it previously fit at 248px. Hero horizontal padding made responsive — `{ xs: "22px 16px 24px", md: "22px 32px 24px" }` — matching the panel directly beneath it and buying back the 32px.
  - `[medium]` `[patch]` The print `MenuItem`'s `aria-label` (`printAria`, "Open printable day itinerary") replaced rather than supplemented its visible label ("Print day"), so a voice-control user could not activate what they read (WCAG 2.5.3), and the guarding test's `/print|export/i` matched the aria-label's "**print**able" — meaning the visible label was untested. The `aria-label` was removed, `trips.dayView.printAria` deleted from both dictionaries as now dead, and both print tests re-anchored to the exact visible label. **This corrects a Task 3 subtask that had specified the `aria-label`; the task text above has been amended to match the shipped code.**
  - `[low]` `[patch]` The chevrons rendered before the header row, so tab order ran prev → next → back → edit → overflow, against the visual order. The JSX moved after the header row; absolute positioning makes this free visually.
  - `[low]` `[patch]` The overflow trigger carried no `aria-haspopup`/`aria-expanded`/`aria-controls`, announcing as a plain button with no indication it opens a menu. All three added and pinned by test.
  - `[low]` `[patch]` `PaperProps` is the deprecated MUI 7 API and `DialogShell.tsx:67-70` already documents `slotProps.paper` as this repo's convention. Converted.
  - `[low]` `[patch]` No `anchorOrigin`/`transformOrigin` on a trigger sitting at the hero's right edge: MUI's default top-left origin opens the paper rightwards over its own trigger and relies on viewport clamping to drag it back. Set to bottom-right / top-right, `mt` reduced from 1.5 to 1 since the bottom origin already clears the trigger.
  - `[low]` `[patch]` A menu left open across a browser back/forward to a sibling day survived the loading skeleton's unmount with an anchor pointing at a detached node, which Popover measures as the viewport's top-left corner. Fixed with a render-phase reset-on-prop-change rather than an effect, per React's own guidance and to stay clear of the `set-state-in-effect` rule (DW-3).
  - `[low]` `[patch]` AC6 was only half covered: nothing asserted that an owner gets *both* the day-image action and the overflow, and the viewer test queried the overflow globally, so it would have passed with the control rendered anywhere on the page. Both tests now scope to `day-hero-header-row` and the owner half is asserted.
  - `[low]` `[patch]` AC3 had no test — an empty leftover `Box` would have satisfied every assertion, since deleting the old assertions only proved the old labels were gone. Added the positive form: both chevrons are descendants of `day-hero`, exactly two day-nav controls exist, and no print link exists anywhere before the menu is opened.
  - `[low]` `[patch]` The German test lost its only German-visible-string assertions while the change introduced two new German strings a German user needs in order to find print at all — and Trap 6 records that nothing in this repo compares EN/DE key sets. It now opens the overflow by its German name and asserts the German print label.
  - `[low]` `[patch]` The Verification block claimed `npx tsc --noEmit` "expected: clean"; the repo has carried 143 pre-existing errors since before this story (DW-95). Both static gates restated as "no change from baseline", with the baseline counts recorded.

## Dev Notes

### Why this exists

`TripDayView.tsx:2061-2105` renders a flex row of three controls below the hero — previous day, next day, print. Its own comment concedes the position was never designed: *"Undepicted by the mockup, which shows only the breadcrumb and back button — kept as its own slim toolbar rather than dropped."* On a phone that row is a band of chrome above the content the user came for. Tommy raised it after using the app on a real trip.

Both decisions this story needed were settled by him on 2026-08-01: the missing-direction chevron is **not rendered** (the controls sit inside the photo, so an absent one leaves no hole), and print goes into a **page-local overflow menu** rather than making the global `HeaderMenu` context-aware.

The argument for the page-local menu, recorded so it is not re-litigated: `HeaderMenu`'s items come from `getAuthMenuItems(authState)` (`HeaderMenu.tsx:58,209`), a list driven only by auth state. Print needs `tripId` and `day.id`. Story 5.8's spec deliberately kept `authMenu.ts` free of page-specific entries because a globally visible entry dangles for users it does not apply to — the same reasoning applies here, since print is meaningless on every non-day page.

### This story re-touches what Story 6.9 just rebuilt

Story 6.9 (`096291f`) reworked this exact header: it deleted the breadcrumb, moved "back to trip" into the left slot with `ON_PHOTO_CHROME` at `minHeight: 48` and `paddingInline: 22px`, and kept the day-image edit action in the right slot. The line numbers throughout this spec were re-measured against `607ddc6` and are current, but they are still locators — read the region before editing it.

Two of 6.9's choices are load-bearing here:

- The hero header is a `space-between` row. This story adds a second child to its right slot; the left slot's single button stays where it is.
- The right slot is deliberately rendered even when empty. That workaround exists only because the edit action is owner-only. An unconditional overflow makes it moot — see Task 4.

### Traps

**1. The `isOwner` guard.** The edit action is owner-only; print is not. Placing the overflow inside the same conditional silently removes print for viewers and contributors — a capability regression disguised as a layout change, and no existing test would catch it because print has never been role-tested. Task 5 adds that test.

**2. `IconButton` has no theme `minHeight`.** `theme.ts` sets `minHeight: 44` on `MuiButton` only. Story 7.11's `Mui-focusVisible` ring is also `MuiButton`-scoped, which is why `ON_PHOTO_CHROME` carries its own — see DW-71's sibling finding about `MuiIconButton` having no focus ring at all. Size and focus both need to be explicit here.

**3. Left/right is easy to get backwards** and reads as correct in a screenshot. Task 5 asserts the hrefs for that reason.

**4. Do not restyle the print document.** `/trips/{id}/days/{dayId}/print` and `TripDayPrintPage.tsx` are Story 6.8's and are untouched. This story changes only how you get there.

**5. The hero title is bottom-anchored and grows upward.** `:1896` carries `mt: "auto"`; the title is `Day N: {note}` at 28px/900 with notes up to 280 chars. At `minHeight: 210` a vertically centred 44px chevron sits clear of a one-line title by about a pixel, and a **two**-line title — the ordinary case for any note, since the content column is ~264px at 360px — overlaps it by roughly 30px vertically and 20px horizontally on each side.

The review pass measured this and fixed the operable half: the chevrons carry `zIndex: 3`, one above the title block, because at equal `zIndex` the later DOM sibling won both painting *and* hit-testing, which left the chevrons looking present with ~20px of each dead to the touch. What remains is purely visual — a chevron glyph now paints *over* the start of a long title — and only a browser can judge whether that reads as acceptable. That is the one thing the operator's pass must actually look at. If it does not read well, the fix is a horizontal inset on the title block, not a repositioned chevron, and it needs a deliberate amendment because it moves what Story 6.9 aligned to the hero's 32px gutter.

**6. The spec that preceded this one claimed `i18nDictionaries.test.ts` enforces EN/DE key parity. It does not.** That suite only asserts both dictionaries are objects, `Dictionary` is `Record<string, string>`, and no other test compares key sets. Removing a key from one dictionary and not the other would pass every check in this repo. Do the removal in both files by hand and verify by grep.

**7. A closed MUI `Menu` is not in the accessibility tree.** `getByRole("link", …)` will not find the print item until the overflow is clicked, which is exactly why the existing print test at `:3684` breaks rather than silently passing.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the main constraint and was heavily reworked by 6.9 — read it before adding to it. Chevron placement over photography and the reclaimed vertical space (AC1 partly, AC8) are browser-only and are owed to the operator.

### Project Structure Notes

Files touched: `travelplan/src/components/features/trips/TripDayView.tsx`, `travelplan/src/components/features/trips/TripIcons.tsx`, `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`, `travelplan/test/tripDayViewLayout.test.tsx`. No route, API or schema change. `HeaderMenu.tsx` and `authMenu.ts` are explicitly out of bounds.

## Verification

**Commands** (run from `travelplan/`):
- `npm test` -- expected: full Vitest suite green, including the rewritten nav/print cases and the new viewer-role overflow case. **Actual: 101 files / 804 tests passed.**
- `npm run lint` -- expected: unchanged from baseline `607ddc6`, which is `86 problems (2 errors, 84 warnings)`. Neither error is in a file this story touches. **Actual: identical.**
- `npx tsc --noEmit` -- expected: unchanged from baseline, which is **143 errors** -- pre-existing, none in application source, tracked as DW-95. The check is only meaningful as a delta, and specifically that no error lands in `TripDayView.tsx`, `TripIcons.tsx` or the dictionaries. **Actual: 143, none in those files.** Note `Dictionary` is `Record<string, string>`, so EN/DE key parity is not type-checked -- use the grep below, not tsc, to keep the dictionaries honest.
- `git diff --stat -- src/components/HeaderMenu.tsx src/lib/navigation/authMenu.ts` -- expected: empty output (AC5). **Actual: empty.**
- `grep -rn "previousAction\|nextAction\|printAria" src test` -- expected: no matches (AC3 cleanup plus the review pass's `printAria` removal). **Actual: no matches.**

**Manual checks (browser, owed to the operator):**
- At 390px and at a desktop width, as owner and as viewer: chevrons sit inside the photo at each side, vertically centred, legible over both a light and a dark photo; the hero card is followed directly by the day content with no toolbar band; a long day note does not run under either chevron.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.11]
- [Source: _bmad-output/implementation-artifacts/epic-6-context.md] — "The hero carries navigation"; "The global header menu stays global"
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1840-1893] — the hero header as 6.9 left it
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2061-2105] — the toolbar to remove
- [Source: travelplan/src/components/features/trips/TripIcons.tsx:321-327] — `ON_PHOTO_CHROME`
- [Source: travelplan/src/components/HeaderMenu.tsx:186-229] — the `Menu` / `MenuItem` shape to copy
- [Source: _bmad-output/implementation-artifacts/5-8-view-all-registered-system-users.md] — why `authMenu.ts` stays free of page-specific entries

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-auto` — plan, implementation subagent, two parallel review subagents (adversarial + edge-case), patch pass.

### Debug Log References

- Baseline static-check counts captured by extracting `607ddc6` read-only with `git archive` into a scratch tree and running both gates there: `86 problems (2 errors, 84 warnings)` from `npm run lint`, `143 errors` from `npx tsc --noEmit`. Both identical after the change.
- One patch was reworked after it regressed lint: the first fix for the stale menu anchor used `useEffect(() => setDayMenuAnchor(null), [dayId])`, which tripped `react-hooks` set-state-in-effect (the 85th warning). Replaced with the render-phase reset-on-prop-change React itself prescribes, returning lint to exactly 84 warnings. Related: DW-3.

### Completion Notes List

- Tasks 1–5 complete and verified. **Task 6 (browser pass) is not done and cannot be done by an agent** — this repo has no browser automation (`npm run` offers only `dev`/`build`/`start`/`lint`/`test`; no Playwright, Puppeteer or Cypress) and jsdom computes no layout. It is owed to the operator; see `operator_actions` in the frontmatter.
- AC1's *placement* half, AC6's rendered form and AC8 in full are the only claims resting on that pass. Everything else is mechanically verified.
- Two decisions the spec did not pre-decide: the chevrons' horizontal inset is 8px (chosen to minimise the overlap with the bottom-anchored title described in Trap 5), and `keepMounted` was deliberately *not* carried over from `HeaderMenu` so a closed menu is absent from the DOM rather than hidden in it — which is what makes the absence assertions unambiguous.
- The print `MenuItem` is queried in tests as `role="menuitem"`, not `role="link"`: MUI stamps `role="menuitem"` on `MenuItem`, overriding the anchor's implicit role. AC7's "it is a link" is still pinned mechanically — the test asserts `tagName === "A"` alongside `href`/`target`/`rel`.
- Two findings were deferred rather than fixed: DW-96 (DESIGN.md's "one navigation or action button only" hero rule, now contradicted by a human-decided design) and DW-97 (`HeaderMenu`'s trigger lacks the `aria-haspopup`/`aria-expanded` this story added to its own). DW-97 is untouchable here by AC5.

### File List

- `travelplan/src/components/features/trips/TripDayView.tsx` — chevrons, overflow menu, toolbar deletion, responsive hero padding, menu-anchor reset
- `travelplan/src/components/features/trips/TripIcons.tsx` — `ChevronLeftIcon`, `MoreHorizontalIcon`
- `travelplan/src/i18n/en.ts` — `+moreActions`, `−previousAction`, `−nextAction`, `−printAria`
- `travelplan/src/i18n/de.ts` — same four
- `travelplan/test/tripDayViewLayout.test.tsx` — four cases reworked, one added
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-96, DW-97

### Change Log

- 2026-08-02: Operator pass carried out against a throwaway copy of `dev.db` on port 3099 in a separate git worktree at `d6b6b47`, driven through headless Chromium. **Passing:** both chevrons render 44×44 with `zIndex: 3`, `ON_PHOTO_CHROME`'s `rgba(255,255,255,.18)` fill and `.55` border, and their `previousAria`/`nextAria` names; the `⋯` renders 44×44 as "Weitere Aktionen"; no prev/next/print text button remains anywhere (AC3); `scrollWidth - clientWidth` is **0** at 390px, so the hero's new `{ xs: 16px }` padding holds (operator action 4); the hero is followed directly by the day's content with no toolbar band (AC8); and a **viewer** sees the `⋯` with a working print item (`target="_blank"`, `rel="noopener noreferrer"`) and no day-image edit action beside it (AC6). **Operator action 2 fails, and not because of this story.** Rendered against a near-white (`#FAFAF8`) day photo, white-on-hero measures **1.37:1** at the header row (back button, pencil, `⋯`), **2.41:1** at the chevrons' midpoint, and 5.66:1 only at the title — `HERO_SCRIM` reaches 0.88 at the bottom and is near-transparent above it, so it was built to carry the title and nothing else. The back button and the pencil predate this story and score *worse* than its chevrons; 6.11 adds three controls to an app-wide weakness rather than causing one. Recorded as a ledger entry against the design system. **Operator action 3 not conclusively tested:** a long plan-item title does not reach the hero, which renders only the day label and date, so the overlap the action describes could not be reproduced — geometrically the title box sits below the chevrons with no intersection. **Operator action 7 (Tommy):** the `⋯`'s discoverability is accepted as designed.

| Date | Change |
|------|--------|
| 2026-08-02 | Story planned, implemented, reviewed and patched via `bmad-dev-auto` against baseline `607ddc6`. Ten review findings patched, two deferred, five rejected. Task 6 left to the operator. |

## Auto Run Result

Status: awaiting-operator

**Implemented change.** Day-to-day navigation moved out of a toolbar band below the day hero and onto the hero photo as two chevrons, one per side; the missing-direction chevron is not rendered at all. Print moved from that same toolbar into a page-local `⋯` overflow menu in the hero header, deliberately outside the owner-only guard that wraps the day-image edit action, so viewers and contributors keep it. The toolbar row is gone. `HeaderMenu.tsx` and `authMenu.ts` are untouched.

**Files changed.** See File List above.

**Review findings.** 10 patched (3 medium, 7 low), 2 deferred (DW-96, DW-97), 5 rejected. Full breakdown in the Review Triage Log. No `intent_gap`, no `bad_spec`, no repair loopback — `review_loop_iteration` stayed 0. The three medium patches were: a title block that occluded ~20px of each chevron's hit area, a phone-width header overflow the new button introduced in German, and an `aria-label` that shadowed the print item's visible name.

**Verification.** `npm test` 101 files / 804 tests green. `npm run lint` and `npx tsc --noEmit` both byte-identical to baseline `607ddc6` (86 problems / 143 errors, all pre-existing). AC5 and the dead-key greps pass. Details and expected values in the Verification section.

**Residual risks.** All in AC1's placement half, AC6's rendered form and AC8, which no agent can check here:
- A long day note now paints under the chevrons (Trap 5). The operable half is fixed; whether the visual overlap reads as acceptable is a judgement call.
- The hero's phone padding dropped from 32px to 16px to absorb the button this story added. Correct by measurement, unconfirmed by eye.
- `ON_PHOTO_CHROME` is white-on-translucent-white and the chevrons sit at the hero's vertical midpoint, where `HERO_SCRIM` is deliberately at its weakest. Over a bright photo this is the least protected chrome on the screen.
- Print is now two interactions behind an unlabelled glyph, and the words "Print day" appear nowhere until the menu opens. That is the decided design, not a defect — but it is the trade the first real use will test.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the day view in a browser at 390px and at a desktop width, as owner and as viewer, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that session; no agent can do any of it, because this repo has no browser automation and jsdom computes no layout.
- Confirm the chevrons are legible over a bright photo (Task 6, AC1). They sit at the hero's vertical midpoint, which is exactly where `HERO_SCRIM` is deliberately at its weakest — the scrim runs 0.88 at the bottom and near-transparent through the middle. `ON_PHOTO_CHROME` is a white glyph on a translucent white fill with a white border, so a snow or sky photo is the worst case. Check one bright day photo and one dark one.
- Judge whether a long day note reading under the chevrons is acceptable (Task 6, AC1). Open a day whose note wraps the title to two lines. The chevrons now carry `zIndex: 3`, so they stay fully clickable and paint on top — the operable defect is fixed — but the glyph will overlap the start of the title text. If that reads badly, say so rather than patching it: the fix is a horizontal inset on the title block, which moves what Story 6.9 aligned to the hero's 32px gutter and needs a deliberate spec amendment.
- Accept or reject the hero's new phone padding. To fit the second button this story added to the header's right slot, the hero's horizontal padding went from a fixed 32px to `{ xs: 16px, md: 32px }`, matching the panel directly beneath it. Without it the German nowrap "← Zurück zur Reise" overflowed at 360px. Confirm the hero still reads right at 390px and that nothing else in it looks cramped.
- Confirm the reclaimed space (Task 6, AC8). At 390px the hero card should be followed directly by the day's content, with no toolbar band between them.
- Confirm print is still reachable as a viewer (Task 6, AC6). Open the trip as a viewer, click the `⋯` in the hero header, and check the print item opens `/trips/{id}/days/{dayId}/print` in a new tab. The day-image edit action beside it must not be there.
- Make the discoverability call on the overflow. Print is now two interactions behind an unlabelled `⋯`, and the words "Print day" appear nowhere on the page until the menu is open. This is the design you decided on 2026-08-01, so it is not being raised as a defect — but it is the trade the first real use will test, and it is cheaper to revisit now than after a trip.
- When the checks pass, tick Task 6's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-11-day-nav-chevrons-and-print-menu` in `sprint-status.yaml`.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
