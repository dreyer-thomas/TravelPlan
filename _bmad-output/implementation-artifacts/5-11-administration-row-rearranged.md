---
authored_against: def8618
baseline_commit: def8618e98dcc9ef95e53376b5c15977a5c241db
---

# Story 5.11: The Administration Row, Rearranged

Status: review

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

- [ ] **Task 7 — Manual browser check** (AC: 1, 2, 3) — **not done; this is what `review` is waiting on**
  - [ ] jsdom lays nothing out, so every claim about how this *looks* is unverified — which is the whole reason the story exists. The recipe is in `7-12-bucket-list-sidebar-card.md`'s Dev Notes; use a throwaway copy of `dev.db`, never `prisma/dev.db`.
  - [ ] At 1400px and 390px: the trigger stays on the address line when the badges wrap, the menu opens inside the viewport for the **last** row on the page (it is bottom-anchored and right-aligned), and the three-column table does not overflow at 390px — the role select has a minimum width the trip name does not.
  - [ ] Confirm the `+` and the trash glyphs clear 44px, and that the focus ring shows on both — theme.ts scopes the app-wide ring to `MuiButton`, which is why each spells its own out.
  - [ ] Open the menu on the last row, grant admin, and confirm the menu is gone rather than floating detached — Task 1's close-before-act is what should make this boring.

## Dev Notes

**The `+` and the menu item are the same action, deliberately.** The request asked for both, and it is not a duplication to tidy away: the menu holds what acts on the *account*, the `+` sits on the table and reads as "add a row to this". That is also what makes a wordless `+` legible — a glyph with no label needs its container to say what it adds to.

**What is still Story 5.10's, untouched.** Every route, every refusal code, the re-read-after-mutate strategy, the CSRF retry, `consumeForbidden`, and the delete confirmation's `owns_trips` message. This story moved controls and changed two of their behaviours (AC4, AC5); it did not touch the rules underneath.
