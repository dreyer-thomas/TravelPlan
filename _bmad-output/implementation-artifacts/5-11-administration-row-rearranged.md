---
authored_against: def8618
baseline_commit: def8618e98dcc9ef95e53376b5c15977a5c241db
---

# Story 5.11: The Administration Row, Rearranged

Status: done

## Story

As the administrator of this installation,
I want each account's actions collected in one overflow menu and its shares shown as a table,
so that a row stops being a paragraph with five text buttons trailing it.

## Acceptance Criteria

1. **Three row actions become one overflow menu.** Add-to-trip, grant/revoke admin and delete-account move into a vertical-dots trigger at the right of the line the address sits on. The trigger is named per account.
2. **The memberships become a table** under a `Freigaben` heading: trip name, role as a select that changes it, and a trash button. An account with no memberships says so rather than rendering an empty table.
3. **The shares table carries its own `+`** above its right edge. The same action stays in the overflow menu — one entry point belongs to the table, the other to the account.
4. **The role select sends what was picked**, and sends nothing when the value already showing is picked again.
5. **Removing a share is confirmed**, with the safe half naming what it preserves in the same noun as its neighbour (Story 6.25 AC3).
6. **Ownership and membership stay apart** (Story 5.10 AC3): the owned trips stay outside the shares table, under their own label.
7. **Every control keeps a name that says which row and which trip it acts on.** Story 5.10's review added those names because two memberships on one row rendered indistinguishable controls; the restyle must not weaken them.
8. **Nothing about behaviour changes** beyond AC4's no-op guard and AC5's confirmation. Every request goes to the same endpoint with the same body.

## Tasks / Subtasks

- [x] **Task 1 — The overflow menu** (AC: 1, 7)
  - [x] `MoreVerticalIcon` added to `TripIcons.tsx` — only a horizontal one existed, and the request asked for upright dots. Geometry is the horizontal glyph's with `cx`/`cy` exchanged, so both read as one shape rotated. A separate export rather than an `orientation` prop: each call site names the shape it wants.
  - [x] **One menu for the whole list, not one per row.** A `Menu` per `ListItem` renders N popovers and N focus traps for N accounts, all but one closed. This one is driven by `menuUser`, set by the trigger alongside the anchor.
  - [x] Chrome copied from `TripDayView`'s overflow menu deliberately — right-aligned origins, `slotProps.paper`, list named by its trigger. Two overflow menus in one app that look different read as two mechanisms.
  - [x] **Every item closes the menu before it acts, and the order is load-bearing.** `TripDayView` records the hazard as a latent one; here it is the normal path. Two of the three items mutate, every mutation calls `load()`, and `load()` replaces the whole `users` array — so the row remounts and the node in `menuAnchor` is gone.
  - [x] Trigger named `admin.users.rowMenuFor` ("Weitere Aktionen für {email}"), for the reason `detach.actionFor` exists: one per row, and three identically-named controls cannot be told apart.

- [x] **Task 2 — The shares table** (AC: 2, 3, 6, 7)
  - [x] A real `Table`, not the div-row idiom: three columns with a header row is tabular data, and story 7.13 set the precedent keeping the cost overview's per-day list as one.
  - [x] The role select is named by a **hidden label naming its trip**, via `labelId` and not `aria-label` — `TripAccommodationDialog` documents why: MUI forwards unrecognised props onto the `OutlinedInput` wrapper div, leaving the inner `role="combobox"` unnamed. `labelId` is the one prop `Select` routes down to it.
  - [x] The trash column's header is `visuallyHidden` rather than absent: an empty `th` leaves the column unnamed for anyone reading by structure, and a visible "Aktion" over one glyph is noise.
  - [x] The `+` is disabled only when there is no trip to attach at all — the one case where the dialog would open onto its own empty state.
  - [x] The owned-trips line stays where it was, above the heading. AC3 of 5.10 is the reason this story could not simply put every trip in the table.

- [x] **Task 3 — Select instead of toggle** (AC: 4, 8)
  - [x] `changeMembershipRole` takes the target role as a parameter now. Deriving it from the current value would be inventing an answer the widget already gave.
  - [x] The no-op guard is not a micro-optimisation: the endpoint is an **upsert**, so re-picking the current role spends a write and a full list reload to arrive where it started.

- [x] **Task 4 — The detach confirmation** (AC: 5)
  - [x] **This reverses a decision the file argued for**, and the old comment is quoted in the new one rather than deleted: detach was direct because "the difference is reversibility rather than importance — a membership removed here can be put back from the same screen in two clicks".
  - [x] What changed is the control, not the risk: a text button reading "Von Reise entfernen" became a 44px trash glyph one row away from three other trash glyphs. The word that said what the click costs is gone, and "two clicks to put back" assumes the admin noticed. Same trade Story 6.24 made when `Löschen` became a glyph and kept its confirmation.
  - [x] Its failure message goes to the page, not into the dialog — unlike the delete path there is no equivalent of AC7's `owns_trips`, no refusal carrying information the admin must read *inside* the dialog.

- [x] **Task 5 — i18n** (AC: 1, 2, 5)
  - [x] Eleven `admin.users.*` keys added in both dictionaries; `i18nDictionaries.test.ts` enforces parity and is green.
  - [x] **Two keys deleted rather than left orphaned**, per 6.17/6.25: `admin.users.detach.action` ("Von Reise entfernen") was the visible label of a button that is a glyph now, and `admin.users.roleToggleFor` named a toggle that no longer exists. Grep confirms no readers.

- [x] **Task 6 — Tests** (AC: 1–8)
  - [x] `adminUsersList.test.tsx`: 27 → 31 cases. Two helpers (`openRowMenu`, `clickRowMenuItem`) carry the eleven cases whose control moved into the menu; the menu is portalled outside the row, so its items are reached through `screen` and a `within(row)` query would read like the item was missing rather than like it lives elsewhere.
  - [x] New: the menu offers the item for the account whose glyph was pressed (one shared menu makes "which account" *state* rather than structure — a defect the per-row buttons could not have had); the select sends the picked role; the select sends nothing on a no-op; detach asks first and sends nothing until confirmed; keeping the share sends nothing; the no-shares empty state.
  - [x] AC3's case rewritten rather than re-queried, and it came out stronger: "Own Trip" being **absent from the shares table** is a claim about structure, where the old "the two labels are different nodes" was a claim about node identity.
  - [x] Fixed a pre-existing type error in the fixture: `stubFetch`'s `users?: typeof USERS` narrowed `role` to the literals in the default array, so the two `CONTRIBUTOR` fixtures did not typecheck. The fixture type was lying about what the component accepts — and the role a membership holds is exactly what this story's select and guard turn on.

- [x] **Task 7 — Manual browser check** (AC: 1, 2, 3) — **done 2026-08-05**, operated by Tommy against a throwaway copy of `dev.db` on port 3099. Found that the review's own menu-height patch was insufficient; see Browser Pass Results.
  - [x] jsdom lays nothing out, so every claim about how this *looks* is unverified — which is the whole reason the story exists. The recipe is in `7-12-bucket-list-sidebar-card.md`'s Dev Notes; use a throwaway copy of `dev.db`, never `prisma/dev.db`.
  - [x] At 1400px and 390px: the trigger stays on the address line when the badges wrap, the menu opens inside the viewport for the **last** row on the page (it is bottom-anchored and right-aligned), and the three-column table does not overflow at 390px — the role select has a minimum width the trip name does not.
  - [x] Confirm the `+` and the trash glyphs clear 44px, and that the focus ring shows on both — theme.ts scopes the app-wide ring to `MuiButton`, which is why each spells its own out.
  - [x] Open the menu on the last row, grant admin, and confirm the menu is gone rather than floating detached — Task 1's close-before-act is what should make this boring.

### Review Findings

Code review 2026-08-04 (`bmad-code-review`, three parallel layers). 41 raw findings, 28 after dedup. Baseline reproduced: **119 files / 1384 tests green**, `adminUsersList.test.tsx` at 31 cases. **AC1, AC2, AC3, AC5, AC6 and AC8 are met in substance** — every request still goes to the same endpoint with the same body, verified call site by call site. AC7 is violated at page scope and AC4 is satisfied by MUI rather than by the code that claims it.

**Patches — high**

- [x] [Review][Patch] **The role select's accessible name lost the account, re-creating the exact defect 5.10's review fixed** [`AdminUsersList.tsx:887`, `admin.users.roleForTrip`] — AC7. `roleToggleFor` was "Change {email} on {trip} to {role}"; `roleForTrip` is only "Role for {trip}". Two accounts holding a membership on one trip render two comboboxes with identical accessible names — verified empirically by a reviewer probe returning 2 matches for one name, while the two trash buttons stayed distinct. One trip shared with several accounts is the ordinary case here, not a corner. Both AC7 test cases query `within(row)`, and the fixture has only one account with memberships, so the suite cannot see it.
- [x] [Review][Patch] **The role select silently drops the app-wide 44px touch floor to 32px** [`AdminUsersList.tsx:901`] — `sx={{ … "& .MuiSelect-select": { py: "6px", minHeight: 32 } }}`, and `sx` outranks `theme.ts`'s deliberate `MuiSelect` floor of 44. The same diff hand-writes `width: 44, height: 44` on all three icon buttons and comments at length about why, then defeats the rule on the one control it did not hand-spell. `theme.test.tsx` asserts the theme object, so nothing catches it.
- [x] [Review][Patch] **`:last-of-type` also matches the `<thead>` row, so the column headers lose their rule** [`AdminUsersList.tsx:840`] — `:last-of-type` is scoped per parent, and the `<tr>` in `<thead>` is the only `tr` there. Needs `.MuiTableBody-root` scoping. A single-row table ends up with no separator at all. jsdom cannot see it and Task 7 does not list it.

**Patches — medium**

- [x] [Review][Patch] **`admin.users.sharedLabel` is orphaned, and the i18n test guarding AC3/AC6 now pins a string nothing renders** [`i18n/en.ts:680`, `de.ts:629`, `i18nDictionaries.test.ts:47-52`] — its only reader was the membership line this diff deleted. Task 5 says orphans were deleted "per 6.17/6.25"; two were, this third was missed, and it is the one carrying a test. That test exists so the *rendered* words cannot converge — the pair actually on screen is now `ownsLabel` vs `sharesLabel`, which nothing pins. An orphan with a green test defending it.
- [x] [Review][Patch] **AC4's no-op guard cannot execute, and the test listed as proving it is a tautology** [`AdminUsersList.tsx:435`, `adminUsersList.test.tsx`] — MUI's `SelectInput` gates the whole `onChange` on `value !== newValue`, so re-picking the showing value never reaches the handler. **Mutation-tested during this review: with line 435 deleted, "sends nothing when the role already showing is picked again" still passes.** AC4's second half genuinely holds; what does not hold is Task 3's claim that this guard is what prevents the upsert and Task 6's listing of a case that exercises it. First half is correct — `event.target.value` is MUI's `newValue`, so the picked role is what ships.
- [x] [Review][Patch] **Every shares table has the accessible name "Shares" — N indistinguishable tables** [`AdminUsersList.tsx:832`] — `aria-labelledby` points at a per-user id whose *text* is identical for every row. On the surface whose stated principle is that a control must name the row it acts on, the table wrapping those controls does not. The test passes only because of `within(row)`.
- [x] [Review][Patch] **The overflow menu's items fall below 44px on desktop** [`AdminUsersList.tsx:1004-1038`] — the three `MenuItem`s get no `sx`. Verified in MUI's source: `minHeight: 48` with a single `breakpoints.up('sm')` block that resets it to `auto`. `TripDayView.tsx:505` defines `DAY_MENU_ITEM_SX = { minHeight: 44 }` and applies it to every item for exactly this reason. The paper styling was copied verbatim; the one rule carrying the accessibility floor was not.
- [x] [Review][Patch] **An account that reaches nothing now says so twice, in two different nouns** [`AdminUsersList.tsx:761-765` and `:825-828`] — `reachesNothing` ("No trips") and then the `Shares` heading plus `sharesEmpty` ("No shares"), for the same fact, on the surface whose job is that ownership and membership read as two distinct things. Two tests each pin their own half against the same fixture row and neither notices the pair.
- [x] [Review][Patch] **AC5's shared-noun pin was never added, though its neighbour has one** [`i18nDictionaries.test.ts:59-71`] — the strings are correct in both languages ("Keep share"/"Remove share", "Freigabe behalten"/"Freigabe entfernen"), but the 6.25-AC3 assertion covers `delete.keep`/`delete.confirm` only. The pair 5.11 introduced is unguarded, and its own docblock says checking one language would let the other drift. `adminUsersList.test.tsx` asserts the English literal only.
- [x] [Review][Patch] **One `busyUserId` serves every row, so two concurrent mutations interleave** [`AdminUsersList.tsx:683`] — row B is not disabled while row A is in flight; starting B overwrites the flag, and A's completion clears it, re-enabling everything while B is still running. Two racing `load()`s can also land the stale list.
- [x] [Review][Patch] **Busy and target are cleared before `load()` resolves** [`AdminUsersList.tsx:486-499`] — between the two, the removed share is still on screen and still clickable; a second DELETE then reports that it no longer exists.
- [x] [Review][Patch] **Focus is lost to `<body>` after every menu-driven mutation and after a detach** [`AdminUsersList.tsx:1014-1023`, `:917-946`] — the menu closes, MUI restores focus to the trigger, `disabled={busy}` immediately blurs it, and the reload does not put it back. The old text buttons had the same disable, but they were not the *only* route to three actions; now they are.
- [x] [Review][Patch] **The overflow trigger's `Tooltip` wraps a conditionally-disabled button with no span** [`AdminUsersList.tsx:733-756`] — the `+` and the trash glyph are both `<Box component="span">`-wrapped for exactly this reason. The trigger's tooltip stops firing while the row is busy — the moment a user is most likely to hover it asking what is happening.
- [x] [Review][Patch] **The table has no horizontal escape at 390px, and the email has no wrap** [`AdminUsersList.tsx:830-951`, `:695`] — no `TableContainer` with `overflowX`, `px: 0` on every cell, and a role select with a hard minimum width beside an unbreakable trip name; the email likewise has no `overflowWrap` despite `minWidth: 0`. The flex layout this replaced wrapped instead. Both belong to Task 7's browser check.
- [x] [Review][Patch] **`runFromRowMenu`'s docblock is wrong on three counts, including the load-bearing one** [`AdminUsersList.tsx:588-599`] — the row does *not* remount (`ListItem key={user.id}` means React reconciles in place, so the trigger's node survives `load()`); only grant/revoke mutates, not "two of the three"; and the next paragraph then accounts for four of three items. Closing before acting is still the right order — the stated mechanism is not what makes it right, and in this file the comment carries the reasoning.

**Patches — low**

- [x] [Review][Patch] `aria-haspopup="dialog"` is on two of the four controls that open a dialog — present on the attach and delete menu items, absent from the `+` and the trash glyph [`AdminUsersList.tsx:807-810`, `:925-931`].
- [x] [Review][Patch] The `+`'s disabled condition does not do what its comment claims [`AdminUsersList.tsx:809`, comment at `:798-800`] — `attachableTrips` filters out owned trips, so an account owning every trip gets an enabled `+` that opens onto its own empty state. Behaviour inherited from 5.10; the claim is new and false.
- [x] [Review][Patch] The attach action's two copies disable on different conditions [`AdminUsersList.tsx:1006` vs `:809`] — the menu item omits `busy`. Currently unreachable, but AC8 claims nothing changed.
- [x] [Review][Patch] AC3's second entry point has no test — every attach case routes through the row menu, so the shares table's `+` is unexercised, and the `visuallyHidden` action-column header is unasserted.
- [x] [Review][Patch] A vacuous assertion carries part of the rewritten AC6 case [`adminUsersList.test.tsx:233`] — `expect(within(row).getByText(/Owns/)).not.toBe(shares)` compares a `<span>` to a `<table>` and cannot fail.
- [x] [Review][Patch] AC6's negative assertion is exact-match [`adminUsersList.test.tsx:232`] — a merged cell rendering "Own Trip · Owner" would satisfy `queryByText("Own Trip")` while committing the exact failure the case exists to catch. A regex closes it.
- [x] [Review][Patch] The fixture hand-duplicates `AdminUser`/`AdminMembership` instead of importing them [`adminUsersList.test.tsx:30-36`] — the docblock correctly diagnoses the old `typeof USERS` as a type that lied, then replaces it with a clone that can lie the same way. Exporting the real types is the fix; the now-redundant `as const` on each fixture role is residue.
- [x] [Review][Patch] Mechanical residue [`AdminUsersList.tsx:693`, `:757`, `:760-776`, `:1007-1035`] — a new wrapper leaves every child at the parent's indentation so the tree misreads as siblings; a flex column renders empty (6px of pure spacing) for an account with shares but no owned trips, with a leftover blank line; the `const target = menuUser; … target &&` ceremony is a no-op three times over; and the 44px + focus-ring `sx` block is copy-pasted verbatim three times where one local constant belongs.
- [x] [Review][Patch] Removed keys are not pinned — the repo's convention is a per-story block asserting a deleted key is gone; `detach.action` and `roleToggleFor` have none, and `Dictionary` is `Record<string, string>`, so nothing else objects if they return.

**Two changes the patches made that were not findings, recorded because they alter the surface**

- `admin.users.reachesNothing` ("No trips" / "Keine Reisen") was **renamed to `ownsNothing`** and re-worded to "Owns no trips" / "Keine eigenen Reisen". Fixing the double empty state meant the ownership line stops answering for both relations, so its wording had to stop answering for both too. Both old keys — `sharedLabel` and `reachesNothing` — are now pinned as deleted by the i18n suite, per the repo's convention.
- `admin.users.sharesLabelFor` ("Shares of {email}" / "Freigaben von {email}") is **new**, and is the table's `aria-label`. The visible label stays the bare word for sighted readers; only the accessible name gained the account. `aria-labelledby` was dropped from the table, because pointing it at the visible word is what made every table share one name.

**Verification**

Every behavioural fix is pinned by a test verified to fail without it. The two that matter most were reverted and re-run: dropping the email from `roleForTrip` fails the new page-scope case with *"Unable to find … Role for Shared Trip (alice@example.com)"*, and restoring `aria-labelledby` on the table fails it with *"Unable to find … Shares of alice@example.com"*. `adminUsersList.test.tsx` 31 → 33 cases; `i18nDictionaries.test.ts` 51 → 53.

**Deferred**

- [x] [Review][Defer] The role select visibly snaps back to the old role while the request is in flight [`AdminUsersList.tsx:891`] — deferred as DW-179. `value={membership.role}` is server state that only advances after `load()`, so picking "Contributor" shows "Viewer" again for the round trip, which on a privileged surface reads as a rejection. Fixing it means optimistic local state, and AC8 says nothing changes beyond AC4 and AC5 — this is the re-read-after-mutate strategy 5.10 established and this story explicitly did not touch.

**Dismissed** (2): `#ffffff` hardcoded at `:991` where `tokens.card` is that colour — copied debt, identical in `HeaderMenu.tsx` and `TripDayView.tsx`, and worth one sweep rather than one file. And the `Freigaben` label being a `div` rather than a real heading — AC2 says "heading", but it names the table through `aria-labelledby`, which is the load-bearing part, and promoting it would put one heading per account into the document outline.

## Browser Pass Results (Task 7, 2026-08-05)

Throwaway copy of `dev.db` on port 3099, `UPLOADS_PUBLIC_ROOT` pointed at scratch. Fixture built for the criteria rather than for convenience: **mara** owns one trip *and* holds a membership on another (AC6's arrangement), **zoe** is the last row alphabetically with **three** memberships including a 57-character trip name (the 390px table check and the bottom-anchored-menu check), and the admin's own row is in the middle. Measured at 390x844 and 747x925 — any width above `sm` (600px) behaves as 747 does.

### Everything AC1/AC2/AC3 claims about layout, measured

| check | 390x844 | 747x925 |
|---|---|---|
| trigger / `+` / trash hit areas | 44x44 each, every row | 44x44 each, every row |
| trigger vs. the address line (`triggerTopVsEmailTop`) | 0 | 0 |
| shares table `overflow-x` | `auto` | `auto` |
| table actually scrolls sideways | no | no |
| row overflows its card | no | no |
| page scrolls sideways | no | no |
| last row's menu inside the viewport | yes | yes |

The 57-character trip name is the one that mattered: with `TableContainer` and `overflowWrap: anywhere` in place, nothing overflows at 390px — neither the table, nor the row, nor the page.

**Close-before-act (AC1):** opened the last row's menu, pressed *Zum Administrator machen*. `menuGone: true`, `PATCH` returned 200, and the database shows `zoe` as `ADMIN`. No popover left behind.

### The pass found a defect in this review's own patch

The menu-item height finding was real, and **the first fix for it was not enough.** `ROW_MENU_ITEM_SX = { minHeight: 44 }` measured **44px at 390x844 and 32.3px at 747x925** — because MUI's `MenuItem` resets `minHeight` to `auto` inside a `breakpoints.up('sm')` block, and a plain `sx` is the same one class of specificity as that media rule, so the later rule in the emotion sheet wins. Now `{ "&&": { minHeight: 44 } }`, where the doubled selector reaches (0,2,0) and ordering stops mattering. Re-measured: **44/44/44 at both widths**.

Two things worth keeping from that: the patch was written from `TripDayView`'s `DAY_MENU_ITEM_SX` as its precedent, and **that constant is the byte-identical broken version** — recorded as DW-180 together with `HeaderMenu`, which sets no height at all and measured 48px at 390px against 32.3px at 747px. And a check run only at 390px would have certified all three as fine, which is the argument for measuring above the breakpoint rather than below it.

### Harness corrections, recorded so the numbers can be trusted

Three readings in this pass were artefacts of the measuring tool, not of the code, and were fixed before anything was concluded: a document-wide `[role="menuitem"]` query counted the app header menu's mounted items (reported seven items and four "below 44px" that belonged to another menu); a `document.body.click()` and then a synthetic `keydown` on `document` both failed to dismiss the menu, because the body sits behind the backdrop and MUI's handler is bound to the modal root — and dismissal is not what Task 7 asks about anyway; and a 1200 ms wait read the row before the reload had landed, so a grant that had in fact succeeded looked as though it had not.

## Dev Notes

**The `+` and the menu item are the same action, deliberately.** The request asked for both, and it is not a duplication to tidy away: the menu holds what acts on the *account*, the `+` sits on the table and reads as "add a row to this". That is also what makes a wordless `+` legible — a glyph with no label needs its container to say what it adds to.

**What is still Story 5.10's, untouched.** Every route, every refusal code, the re-read-after-mutate strategy, the CSRF retry, `consumeForbidden`, and the delete confirmation's `owns_trips` message. This story moved controls and changed two of their behaviours (AC4, AC5); it did not touch the rules underneath.
