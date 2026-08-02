---
authored_against: ac03570
baseline_revision: dcfb859e3a541feb93be94d6ce0f0abb4f0839a4
final_revision: 9d72a91de42f71cfd77ac76ca3afd39c0b30b2b7
status: done
review_loop_iteration: 0
followup_review_recommended: false
warnings: []
operator_actions:
  - "Run the day view in a browser to do Task 4, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session: AC2's \"roughly 52px reclaimed\" and AC6's \"does not wrap at 390px\" are claims about computed layout, and jsdom implements none of it. The green suite is evidence about DOM structure only — that the right slot holds one control and the timeline header one button — not that either lands where it should on screen."
  - "At 390px, confirm the timeline section header sits on ONE line carrying its label and \"+ Aktivität\" alone (AC6). It held four buttons and wrapped; Story 6.13 removed the stay control and this story removed move and swap. German is the case that matters — check the app in German, where the labels are longest."
  - "At 390px, confirm the hero header row carries the back button and a single `⋯`, with no wrap (AC2). The German \"← Zurück zur Reise\" runs about 180px and is what the reclaimed ~52px was for. Note that the hero's responsive padding (16px gutters below `md` instead of 32px) was added by Story 6.11 for the two-control slot that no longer exists — if the row now has slack to spare, the 32px gutters may be worth restoring for visual consistency with desktop. That is a judgement call, not a defect; the comment on it has been corrected either way."
  - "Open the menu and confirm each of the four items does what it says: \"Edit day details\" opens the day-details dialog, \"Move activities\" opens the transfer dialog in MOVE mode, \"Swap activities\" opens it in SWAP mode, and \"Print day\" opens the print document in a new tab. Move and swap being wired to one mode is the failure that looks correct until someone uses it."
  - "Confirm the divider sits between \"Swap activities\" and \"Print day\" and reads as a real separator on screen, not as dead space. It was changed from an `<hr>` to an `<li>` for HTML validity inside the menu's `<ul>`; the styling should be unaffected, but this is the only place that can be seen."
  - "Check all three roles (AC3, AC5). A viewer must see the `⋯` with \"Print day\" alone and NO divider; a contributor must see move, swap, divider and print; an owner all four. The viewer case is the important one: if the `⋯` is missing for a viewer, the trigger was wrapped in a role condition and print has been taken away from them — the exact regression 6.11 AC6 exists to prevent."
  - "On a tablet-width touch device (or with touch emulation at 768px+), confirm the four menu items are still comfortable to tap. MUI drops `MenuItem` to 36px at `sm` and up, and all three relocated controls were 44px before; `minHeight: 44` was restated on the items to hold the floor, but only a real device proves the hit area."
  - "Decide whether the day NOTE being reachable only from the `⋯` is acceptable. The dialog that the old pencil opened holds the day note as well as the day image, and that pencil was the only visible affordance advertising it. AC2 asked for the pencil to move, so this is what was built — but an owner who wants to write a day note now has to know the overflow contains it. If that reads wrong at 390px, it wants a follow-up story, not a change here."
  - "Decide whether move and swap being at the top of the page is acceptable at desktop widths. They used to sit directly above the timeline they reorder and are now in the hero, unconditionally at every width — the story's motivation was the 390px row, but AC1 is not breakpoint-scoped. On a long day at 1400px this means scrolling back up."
  - "Read DW-108 and decide whether it blocks. `npm test` is red on `main` — five import size-cap tests still assert a 100 MB ceiling that was raised to 300 MB, so their fixture no longer trips the guard. Nothing to do with this story (both files are untouched by it and fail identically at the baseline commit), but it is red on the branch this story lands on."
  - "When the checks pass, tick Task 6's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-15-move-swap-into-overflow` in `sprint-status.yaml`."
---

# Story 6.15: Move, Swap and Day-Image Edit Into the Day Overflow Menu

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want "Aktivitäten verschieben", "Aktivitäten tauschen" and the day-image edit behind the `⋯` menu that already holds print,
so that the timeline header carries one primary action instead of a wrapping row, and the hero header carries one control instead of two.

## Acceptance Criteria

1. **Relocated.** Move and swap render as items in the existing `⋯` overflow menu; the two buttons are gone from the timeline section header. No second menu is introduced.
2. **Day-image edit moves too.** The `isOwner` pencil beside the `⋯` (`TripDayView.tsx:1963-1977`) becomes a menu item, so the hero's right slot holds the `⋯` alone — roughly 52px reclaimed in the header row.
3. **Three gating levels, per item.** A viewer sees print alone; a contributor sees print plus move and swap; an owner sees all four. Each item appears only for a role the server would accept.
4. **Mixed item kinds behave correctly.** Print keeps `target="_blank"` and `rel="noopener noreferrer"`; move and swap open their existing dialogs; the menu closes on any selection.
5. **No empty menu.** If no item would render for a role, the `⋯` trigger does not render either.
6. **Header reduced.** After this story and 6.13, the timeline section header carries its label and "+ Aktivität" alone, and does not wrap at 390px.
7. **Nothing else changes.** The transfer dialogs, the day-details dialog, the print document, the timeline and every gating rule behave as before.

## Tasks / Subtasks

- [x] **Task 1 — Move the two buttons into the menu** (AC: 1, 3)
  - [x] The buttons are in the timeline section header (`TripDayView.tsx:2225-2253` at the baseline), both wrapped in `canEditPlanning`, calling `handleOpenTransferDialog("move")` and `("swap")`.
  - [x] The menu is the one Story 6.11 built: `dayMenuAnchor` state, the `⋯` `IconButton` in the hero header's right slot, and a `Menu` holding one print `MenuItem`. Extend it — do not create a second.
  - [x] Move and swap are **action** items (`onClick` + close), unlike print which is `component={Link}`. Both kinds are ordinary `MenuItem`s; keep print's link props on print only.
  - [x] Delete the two buttons from the header once the items exist.
  - [x] Keep `handleOpenTransferDialog` exactly as it is. This story changes how it is reached.

- [x] **Task 2 — Move the day-image edit in as well** (AC: 2, 6)
  - [x] `TripDayView.tsx:1963-1977` renders it as an `IconButton` with `ON_PHOTO_CHROME`, 44×44, `aria-label={t("trips.dayImage.editAction")}`, opening `setDayMetaOpen(true)`. Make it a `MenuItem` calling the same setter.
  - [x] Once it is gone the right slot holds only the unconditional `⋯`. The comment at `:1959-1961` — "rendered even when empty so the row keeps two flex children" — describes a workaround that no longer has a purpose. Story 6.11 already had to revisit it once; finish it here rather than leaving a third stale version.
  - [x] Keep the `isOwner` condition on the *item*, not on the menu.
  - [x] The dialog it opens is Story 7.7's surface — do not touch it.

- [x] **Task 3 — Gate per item, not per menu** (AC: 3, 5)
  - [x] Three levels: the day image needs `isOwner`, move and swap need `canEditPlanning`, print needs nothing beyond being able to open the day. A viewer therefore sees one item, a contributor three, an owner four.
  - [x] Guard the `⋯` trigger on "at least one item would render". Today it is unconditional because print always renders; once items become conditional that assumption has to be stated rather than inherited.
  - [x] The trigger itself stays outside every role condition (6.11 AC6) — only the *items* are gated. Wrapping the trigger in `isOwner` because the day-image item moved in would take print away from viewers.

- [x] **Task 4 — Ordering inside the menu** (AC: 3)
  - [x] Move and swap are a pair and belong adjacent. Whether they sit above or below print is a judgement; make it and say so in the Dev Agent Record.
  - [x] Consider a divider between the planning actions and print, since they differ in kind — one changes the trip, the other opens a document. `HeaderMenu.tsx` has no divider to copy, so this is a new decision rather than a pattern to follow.

- [x] **Task 5 — Tests** (AC: 1, 2, 3, 5)
  - [x] Update any suite asserting the two buttons by their visible labels.
  - [x] Add: the menu holds four items for an owner, three for a contributor and one for a viewer; selecting move opens the transfer dialog in move mode and swap in swap mode; the day-image item opens the day-details dialog; the header exposes no button named by `trips.dayTransfer.moveAction`, `swapAction` or `trips.dayImage.editAction`.
  - [x] Assert the hero's right slot contains exactly one control.
  - [x] `npm test` green.

- [x] **Task 6 — Manual check** (AC: 2, 6) — operator pass 2026-08-02, against `68607e0`, with a before/after at `dcfb859`
  - [x] At 390px the timeline section header carries `+ Aktivität` alone, height 45px — **one row**. Before this story the same header held three buttons on **two rows** (tops `651` and `704`), which is the wrap AC6 exists to remove.
  - [x] **AC2's "roughly 52px" is exact.** The hero's right slot measured `96px` at `dcfb859` (two 44px controls plus an 8px gap) and `44px` at `68607e0` — **52px reclaimed**, at both 390 and 1400px.
  - [x] Three gating levels, all three roles, both widths (AC3): owner **4** items, contributor **3**, viewer **1**. The `⋯` renders for every role, so print is never taken away — the 6.11 AC6 regression did not occur.
  - [x] Mixed item kinds (AC4): print is an `<a>` with `target="_blank" rel="noopener noreferrer"`; move opens "Verschiebe alle Aktivitäten dieses Tages…" and swap "Tausche alle Aktivitäten zwischen diesem Tag und…" — two distinct dialogs, so the two modes did not collapse onto one.
  - [x] The divider holds its rule: present for owner and contributor (`dividerCount: 1`), absent for a viewer (`0`), and never the menu's first child at any role.
  - [~] AC5's "no empty menu" **could not be exercised**: print is ungated, so no role today sees zero items. The guard is derived from the items rather than from the role table, which is what Task 3 asked for, but the case it protects against is unreachable and no browser can show it.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. — Isolated worktree at `TravelPlan-wt-614` on port 3099 against a copy at `scratchpad/dev-614.db`; `prisma/dev.db` untouched.

## Dev Notes

### What this completes

The timeline section header held four `canEditPlanning`-gated buttons. Story 6.13 removed the accommodation one, since both stay cards became clickable. This story removes move and swap, leaving "+ Aktivität" alone — the one action that belongs in a section header, because it creates what the section lists.

Story 6.11 built the destination and its rationale: a page-local `⋯` rather than an entry in the global `HeaderMenu`, because that menu is built from `getAuthMenuItems(authState)` and knows nothing about this trip or this day. The same reasoning covers move, swap and the day-image edit, all of which need this day.

Tommy extended the ask on 2026-08-02: the `isOwner` pencil sitting beside the `⋯` should go in too. That leaves the hero's right slot with one 44px control instead of two plus their 8px gap — about 52px, which matters most at 390px where the German "← Zurück zur Reise" already competes for the row.

### The gating changes shape

Until now the menu had exactly one item and it was ungated, so the `⋯` could be unconditional. This story gives it **three** levels at once — `isOwner` for the day image, `canEditPlanning` for move and swap, and none for print — so its contents become role-dependent for the first time. That is why AC5 exists: a role that can do none of them must not get a trigger that opens an empty surface. There is no such role today, since anyone who can open the day can print, but the guard should be written from what the items say rather than from today's role table.

### Traps

**1. Two kinds of item in one menu.** Print is a link with `target`/`rel`; move, swap and the day-image edit are handlers. Applying print's props to all four would open the dialogs in a new tab; applying none would strip print's.

**1b. Do not gate the trigger.** The day-image item is `isOwner`, and moving it into the menu makes it tempting to wrap the `⋯` in the same condition. That would remove print from viewers and contributors — the exact regression 6.11 AC6 was written to prevent.

**2. Do not touch `HeaderMenu.tsx` or `authMenu.ts`.** Story 6.11 AC5 kept them out of scope and the same holds here.

**3. The transfer dialog has two modes.** `handleOpenTransferDialog` takes `"move"` or `"swap"`. Wiring both items to one mode is a silent bug that looks right until someone uses it.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the constraint; 6.9, 6.11 and 6.13 have each reworked it, so read it before adding.

### Project Structure Notes

`src/components/features/trips/TripDayView.tsx` and the affected suite. Possibly no i18n change at all — `trips.dayTransfer.moveAction` / `swapAction` become menu labels rather than button labels and keep their strings. No route, API or schema change.

### Sequencing

After **6.11** (which built the menu) and **6.13** (which empties the same header of its accommodation button). Both are `done`, so this is unblocked.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.15]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2225-2253] — the two buttons to move
- [Source: _bmad-output/implementation-artifacts/6-11-day-nav-chevrons-and-print-menu.md] — the menu and why it is page-local

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (bmad-dev-auto implementation subagent)

### Debug Log References

Run from `travelplan/`.

- Baseline captured before any edit, at `dcfb859`: `npm test` → **102 files, 846 tests, 4 failed** (all in `test/tripImportDialog.test.tsx`); `npx tsc --noEmit` → **143 errors**; `npm run lint` → **86 problems (2 errors, 84 warnings)**.
- `npx vitest run test/tripDayViewLayout.test.tsx` → **83/83 passed** (77 at baseline + the 6 added here).
- `npm test` after the change → **102 files, 851 tests, 5 failed**. The five are `test/tripImportDialog.test.tsx` (4) and `test/tripImportRoute.test.ts` (1), all about the import size cap.
- The failing-file count moved from 1 to 2 *mid-session, not because of this change*: a concurrent session had uncommitted edits to both import test files at the time of the baseline run and reverted them partway through. Verified by extracting `dcfb859` read-only with `git archive` into a scratch tree and running both suites there: **5 failed | 31 passed (36)**, byte-identical to the working tree's result. Pre-existing, unrelated, and confirmed at baseline. Nothing this story touches is on their import path.
- **Root cause of those five, established during the review pass:** `MAX_IMPORT_PACKAGE_BYTES` was raised from 100 MB to 300 MB on 2026-08-02, and the five cases still hard-code `101 * 1024 * 1024` and the string `"Backup file is larger than 100 MB."`. Their fixture is now well under the cap, so the route accepts it and fails downstream with `invalid_json`. Stale assertions, not a broken size cap — the reverted working-tree edit was fixing exactly this by deriving both from the constant. Filed as **DW-108**; not carried into this story's commit.
- `npx tsc --noEmit` after the change → **143 errors**, unchanged from baseline, none in `TripDayView.tsx`. (Pre-existing, all in test fetch-mock typings; DW-95.)
- `npm run lint` after the change → **86 problems (2 errors, 84 warnings)**, byte-identical to baseline.
- `git diff --stat -- src/components/HeaderMenu.tsx src/lib/navigation/authMenu.ts` → empty (Trap 2, and 6.11 AC5).

### Completion Notes List

- Tasks 1–5 complete. **Task 6 (browser pass) is not done and cannot be done by an agent** — this repo has no browser automation and jsdom computes no layout. Its subtasks are left unticked. AC6's "does not wrap at 390px" half and AC2's "roughly 52px reclaimed" rest on it; everything else is mechanically verified.
- **Ordering judgement (Task 4).** Final order: `Edit day details` → `Move activities` → `Swap activities` → *divider* → `Print day`. Three reasons, in the order they decided it:
  1. Everything above the divider changes this day; the one below it changes nothing and leaves for another tab. That is the only clean line through four items of two different kinds, and it is also the line between "handler" and "link", which is the trap this story was warned about — the divider makes the two kinds visible in the source as well as on screen.
  2. Ordering the planning group by *descending privilege* (owner-only, then contributor-or-better, then everyone) makes each role's visible set a contiguous **tail** of the same list. An owner sees all four, a contributor the last three, a viewer the last one. Nothing ever reorders between roles, and the divider can never end up as the first child of the menu, which would render a rule floating above nothing.
  3. Print last rather than first: it is the item every role sees, so putting it at the bottom keeps it in a stable, predictable position — for a viewer it is the only item, and for an owner it is still the last thing in the list rather than sliding as the group above it grows.
- **Divider: yes, added**, gated on `(dayImage || transfers) && print` so it is suppressed for a viewer rather than leading the menu. It is a new local decision — `HeaderMenu.tsx` has no divider and stays untouched. It carries `data-testid="day-hero-overflow-divider"` so its presence *and its absence for a viewer* are both assertable.
- **The trigger guard is derived, not asserted.** `dayMenuItemsVisible` is a `Record` with one field per item mirroring that item's own gate, and `hasDayMenuItems` is `Object.values(...).some(Boolean)`. Written this way so the guard is read off what the items say rather than off today's role table, which is what Task 3 asked for. It evaluates to `true` for every role today because `print` is `true`; the point is that it would stop doing so on its own if print ever became gated.
- **Everything moved from where the spec said it was.** Stories 6.13 and 6.14 landed between `ac03570` and the `dcfb859` baseline, so every line number in the spec is stale by ~40 lines. Located by content instead: the timeline section header's move/swap buttons were at **`:2279-2288`**, not `:2225-2253`; the day-image `IconButton` was at **`:1963-1977`** (that one happened to still be right); the stale right-slot comment was at **`:1959-1961`**. The comment is now in its third and final form: the "rendered even when empty" workaround is retired outright, since the box is now conditional on the menu having content.
- **The right slot wrapper `Box` was kept, not deleted**, and given `data-testid="day-hero-header-right"`. With one child the wrapper is redundant for layout, but Task 5 asks for "the right slot contains exactly one control" and the left slot already has `day-hero-header-left` — keeping the pair symmetric makes that assertion mean what it says instead of counting buttons across the whole header row. Its `gap={1}` is gone with the second child.
- **`Menu` is left rendering unconditionally** while only the trigger is gated. With no trigger the menu can never open, and a closed MUI `Menu` mounts nothing, so the dead branch has no cost; gating both would have added a fragment for no observable difference. *Revised in the review pass:* the reasoning covered opening but not **staying** open. `open` is now `hasDayMenuItems && Boolean(dayMenuAnchor)`, so a role change arriving from a background `loadDay()` while the menu is open cannot unmount the trigger and leave `anchorEl` pointing at a detached node. The element still renders unconditionally — only its `open` answers to the guard, which is the whole fix without the fragment.
- **Two modes, two items, asserted separately** (Trap 3). The new test opens move, asserts the dialog shows `Confirm move` and *not* `Confirm swap`, cancels, then opens swap and asserts the mirror. The three pre-existing transfer tests were re-routed through the menu and still assert the POST body's `operation`, so the mode is pinned at both ends.
- **`SvgIcon` is still imported and used** — the inline pencil `<path>` went away with the `IconButton`, but `SvgIcon` has another reader at `:1540` (the travel-segment edit action). No import became dead; no i18n key changed, exactly as the spec predicted.
- Menu items close the menu *before* running their action. For the two dialog-opening items this means MUI's `Menu` focus-restore and the `Dialog`'s focus trap resolve in the same commit; the trap wins and the suite confirms it, but it is worth an eye in the browser pass.
- Six tests added and seven reworked in `tripDayViewLayout.test.tsx`. The reworked ones all share the same cause: a closed MUI `Menu` is not mounted, so a single `getByRole("button", …)` had to become a click on the trigger plus a click on a `menuitem`. That is wrapped in one `activateDayOverflowItem(name)` helper rather than repeated. The 6.11 owner-half assertion at `:3819` was **inverted** — it asserted the day-image action was *in* the header row, which this story makes false; it now asserts it is not, and the menu-content tests cover where it went.

### File List

- `travelplan/src/components/features/trips/TripDayView.tsx` — move/swap/day-image relocated into the hero overflow menu, divider added, per-item gating plus the derived trigger guard, timeline section header reduced to one action, stale right-slot comment retired
- `travelplan/test/tripDayViewLayout.test.tsx` — `activateDayOverflowItem` helper, six new Story 6.15 cases, seven existing cases re-routed through the menu
- `_bmad-output/implementation-artifacts/6-15-move-swap-into-overflow.md` — this record

### Change Log

| Date | Change |
|------|--------|
| 2026-08-02 | Tasks 1–5 implemented against baseline `dcfb859`. Move, swap and the day-image edit relocated into the `⋯` overflow the 6.11 story built; menu ordered planning-then-divider-then-print; `⋯` trigger guarded on derived item visibility. `npm test` green apart from 5 pre-existing import-size-cap failures confirmed at baseline; `tsc` and `lint` byte-identical to baseline. Task 6 (browser pass at 390px, three roles) left to the operator. |
| 2026-08-02 | Review pass. Nine patches applied: `Menu` `open` folded into the trigger guard; `Divider` given `component="li"`; `minHeight: 44` restated on all four menu items; `aria-haspopup="dialog"` on the three that open one; menu named by its trigger via `slotProps.list`; the stale "96px right slot" comment on the hero padding retired; divider *position* now asserted in the order assertion; the AC4 mode test pinned to a contributor; the timeline header scoped by testid; print's link props and menu closure covered. One finding deferred as DW-108. |

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 1, low 9)
- defer: 1: (high 0, medium 1, low 0)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` MUI drops `MenuItem` to 36px at `sm` and up, so the three relocated controls — all 44px `Button`/`IconButton`s, a floor this codebase enforces deliberately and the removed pencil carried an explicit comment about — would have shrunk below the touch minimum on a tablet. `DAY_MENU_ITEM_SX = { minHeight: 44 }` restated on all four items, print included.
  - `[low]` `[patch]` Only the trigger answered to `hasDayMenuItems`; the `Menu` rendered with `open={Boolean(dayMenuAnchor)}`. If the guard flipped false while the menu was open, the trigger unmounted and `anchorEl` was left pointing at a detached node — MUI warns and paints an empty paper in the viewport corner. `open` is now `hasDayMenuItems && Boolean(dayMenuAnchor)`.
  - `[low]` `[patch]` `Divider` defaults to `component="hr"`, and `MenuList` renders a `<ul>`, whose only permitted children are `<li>`. Now `component="li"`, with the suite asserting `tagName === "LI"` so it cannot silently revert.
  - `[low]` `[patch]` The three items that open a modal carried no `aria-haspopup="dialog"`. Unlike `aria-label` it is additive rather than name-replacing — the reasoning the item comment already contained, applied one step further. Print does not carry it; it opens a tab.
  - `[low]` `[patch]` The menu had no accessible name of its own. `slotProps.list` now carries `aria-labelledby` pointing at a new `id` on the trigger, merged into the existing `slotProps` rather than added as a second prop that would have silently replaced the paper styling.
  - `[low]` `[patch]` The hero's `padding` comment still justified itself with "a now-96px right slot", the exact condition this story removed. Task 2 hunted down the sibling stale comment 55 lines below and missed this one; both are now current.
  - `[low]` `[patch]` `dayOverflowItemNames()` collected only `role="menuitem"`, so the divider was invisible to the order assertion — moving the rule above "Edit day details" or between move and swap left both role tests green. It now returns items and the separator in DOM order, which is the only thing that actually pins Task 4's decision.
  - `[low]` `[patch]` The AC4 mode test used a fixture with no `accessRole`, so `canEditPlanning` came from the absent-role default rather than from a real contributor. Pinned to `contributor`.
  - `[low]` `[patch]` The AC6 assertion scoped the timeline header via `getByText("Day timeline").parentElement`, which quietly rescopes if the `Typography` is ever wrapped. The header now carries `data-testid="day-timeline-section-header"`, matching the `day-hero-header-*` testids the same file already uses.
  - `[low]` `[patch]` "The menu closes on any selection" was asserted for one of four items, and never for print — dropping `handleDayMenuClose` from the link would have failed nothing. A new case covers print's `href`/`target`/`rel`, its *absence* of `aria-haspopup`, and the menu closing behind it.

**Deferred (1):** DW-108 — the import size-cap suite still asserts a 100 MB ceiling that was raised to 300 MB, so five tests fail on `main`. Pre-existing, unrelated to this story, not carried into its commit.

**Rejected (6):** menu focus-restore said to fight the dialog it opens (the edge-case reviewer probed the actual focus sequence — trigger → menuitem → trigger → dialog, `nodeToRestore` correct — and disproved it); AC5's guard being unreachable today (the spec asks for it to be written from what the items say, not from today's role table, and says so explicitly); the day-details dialog now being reachable only from the overflow, and move/swap being further from the timeline at desktop widths (both are what AC1 and AC2 instruct, not deviations — carried to the operator as residual risks instead); `transfers` being one flag for two items (speculative future drift); the dead first disjunct in `showDayMenuDivider` (it mirrors the item groups literally, which is the property that makes the guard readable).

## Auto Run Result

Status: awaiting-operator

### What was implemented

Three controls left the page and became items in the `⋯` overflow menu the 6.11 story built in the day hero: **"Move activities"** and **"Swap activities"** from the day timeline's section header, and the owner-only **day-image edit pencil** from the hero's right slot. The menu now reads `Edit day details` → `Move activities` → `Swap activities` → *divider* → `Print day`, gated per item — `isOwner` for the day image, `canEditPlanning` for the pair, nothing for print — with the trigger itself guarded on "at least one item would render" and never on a role. The timeline section header is down to its label and "+ Aktivität"; the hero's right slot holds one 44px control where it held two plus their gap.

### Files changed

- `travelplan/src/components/features/trips/TripDayView.tsx` — the three controls relocated into the overflow; per-item gating plus the derived trigger guard; divider; timeline section header reduced to one action and given a testid; two stale comments retired
- `travelplan/test/tripDayViewLayout.test.tsx` — `activateDayOverflowItem` helper, seven new Story 6.15 cases, seven existing cases re-routed through the menu, one 6.11 assertion inverted by design
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-108
- `_bmad-output/implementation-artifacts/6-15-move-swap-into-overflow.md` — this record

### Review findings

10 patches applied (1 medium, 9 low), 1 deferred (DW-108), 6 rejected. No intent gaps, no spec defects, no repair loopbacks.

### Verification performed

All from `travelplan/`, compared against baseline `dcfb859`:

| Gate | Baseline | Final |
|---|---|---|
| `npx vitest run test/tripDayViewLayout.test.tsx` | 77 passed | **84 passed** |
| `npm test` | 851 tests, 5 failed | 852 tests, **5 failed** — the same five, all DW-108 |
| `npx tsc --noEmit` | 143 errors | **143 errors**, none in either changed file |
| `npm run lint` | 86 problems (2 errors, 84 warnings) | **identical**; both errors are pre-existing, in `src/theme.ts` |

The five failures were verified pre-existing two ways: both files are untouched by this story, and their cause was traced to a 100 MB → 300 MB constant change that their assertions never followed.

### Residual risks

1. **AC2 and AC6 have no automated evidence.** "Roughly 52px reclaimed" and "does not wrap at 390px" are claims about computed layout; jsdom computes none and this repo has no browser automation. The suite proves the DOM structure — one control in the right slot, one button in the timeline header — and nothing about where either lands on screen. This is Task 6, and it is the operator's.
2. **The day-details dialog is now reachable from exactly one place, and that place is unlabeled chrome.** `setDayMetaOpen(true)` has a single call site, and that dialog holds the **day note** as well as the image. AC2 describes it as relocating a "day-image pencil"; an owner who wants to edit the day note now has to know that `⋯` contains it. This is what the AC asks for, so it was not treated as a defect — but it is a product consequence worth seeing at 390px before it ships.
3. **Move and swap are further from what they act on, at every width.** They used to sit directly above the timeline they reorder; they are now at the top of the page, with no desktop-only alternative. The story's motivation is a 390px constraint and AC1 is unconditional, so this is intended — but on a long day at 1400px it means scrolling back to the hero.
4. **`main` is red.** Not from this story, but a red suite masks the next real regression. DW-108 has the diagnosis and the shape of the fix.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the day view in a browser to do Task 4, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session: AC2's "roughly 52px reclaimed" and AC6's "does not wrap at 390px" are claims about computed layout, and jsdom implements none of it. The green suite is evidence about DOM structure only — that the right slot holds one control and the timeline header one button — not that either lands where it should on screen.
- At 390px, confirm the timeline section header sits on ONE line carrying its label and "+ Aktivität" alone (AC6). It held four buttons and wrapped; Story 6.13 removed the stay control and this story removed move and swap. German is the case that matters — check the app in German, where the labels are longest.
- At 390px, confirm the hero header row carries the back button and a single `⋯`, with no wrap (AC2). The German "← Zurück zur Reise" runs about 180px and is what the reclaimed ~52px was for. Note that the hero's responsive padding (16px gutters below `md` instead of 32px) was added by Story 6.11 for the two-control slot that no longer exists — if the row now has slack to spare, the 32px gutters may be worth restoring for visual consistency with desktop. That is a judgement call, not a defect; the comment on it has been corrected either way.
- Open the menu and confirm each of the four items does what it says: "Edit day details" opens the day-details dialog, "Move activities" opens the transfer dialog in MOVE mode, "Swap activities" opens it in SWAP mode, and "Print day" opens the print document in a new tab. Move and swap being wired to one mode is the failure that looks correct until someone uses it.
- Confirm the divider sits between "Swap activities" and "Print day" and reads as a real separator on screen, not as dead space. It was changed from an `<hr>` to an `<li>` for HTML validity inside the menu's `<ul>`; the styling should be unaffected, but this is the only place that can be seen.
- Check all three roles (AC3, AC5). A viewer must see the `⋯` with "Print day" alone and NO divider; a contributor must see move, swap, divider and print; an owner all four. The viewer case is the important one: if the `⋯` is missing for a viewer, the trigger was wrapped in a role condition and print has been taken away from them — the exact regression 6.11 AC6 exists to prevent.
- On a tablet-width touch device (or with touch emulation at 768px+), confirm the four menu items are still comfortable to tap. MUI drops `MenuItem` to 36px at `sm` and up, and all three relocated controls were 44px before; `minHeight: 44` was restated on the items to hold the floor, but only a real device proves the hit area.
- Decide whether the day NOTE being reachable only from the `⋯` is acceptable. The dialog that the old pencil opened holds the day note as well as the day image, and that pencil was the only visible affordance advertising it. AC2 asked for the pencil to move, so this is what was built — but an owner who wants to write a day note now has to know the overflow contains it. If that reads wrong at 390px, it wants a follow-up story, not a change here.
- Decide whether move and swap being at the top of the page is acceptable at desktop widths. They used to sit directly above the timeline they reorder and are now in the hero, unconditionally at every width — the story's motivation was the 390px row, but AC1 is not breakpoint-scoped. On a long day at 1400px this means scrolling back up.
- Read DW-108 and decide whether it blocks. `npm test` is red on `main` — five import size-cap tests still assert a 100 MB ceiling that was raised to 300 MB, so their fixture no longer trips the guard. Nothing to do with this story (both files are untouched by it and fail identically at the baseline commit), but it is red on the branch this story lands on.
- When the checks pass, tick Task 6's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-15-move-swap-into-overflow` in `sprint-status.yaml`.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
