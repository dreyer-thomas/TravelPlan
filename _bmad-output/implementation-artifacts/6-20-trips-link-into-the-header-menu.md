---
authored_against: dcfb859
baseline_revision: cfa015f6d74ff0ac4cde39e9ef016dbff4001e20
final_revision: 723c5395c01621765915bd251eabfa8eed217a1e
status: done
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Run the app in a browser to do Task 6, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. Two of the eight acceptance criteria need that session: AC1's spacing judgement and AC4's real behaviour are the only claims in this story that jsdom cannot make, because it computes no layout and does not resolve MUI's responsive sx at all."
  - "Open a trip and confirm the page now starts with the trip: no link, no button, nothing above the hero. Then look at the top spacing at 390px and again at 1400px and say whether it still reads as intentional. The breadcrumb and the flex wrapper that held it are both gone; the padding that remains is the Container's own py of 4 at xs and 6 at md, which is unchanged — but that gap used to be filled by a control, so the judgement is yours."
  - "Open the hamburger menu from a trip page and confirm the row reads \"Alle Reisen\" (\"All trips\" in English), sits between Sprache and Abmelden, and lands on the trips list. Then confirm selecting it also closes the menu rather than leaving it open over the new page."
  - "Open the menu from a day page too, and then from /trips itself. On /trips the row is deliberately still there and links to the page you are already on — that is Story 6.20 AC4, decided rather than overlooked, because hiding it would make the global menu's contents depend on the current route and that coupling has been refused three times in this epic. Try it and say whether it reads as harmless or as broken; if it reads as broken, the fix is its own story and DW-129 in deferred-work.md is its starting point."
  - "Sign out and confirm the row is absent while Login and Register are both still present and working. Then sign back in and confirm it returns."
  - "Check the label in both languages. \"Alle Reisen\" and \"All trips\" are a new key with no leading arrow, because in a vertical menu the breadcrumb's ← pointed at nothing. The old key keeps its arrow and its two readers, so glance at a \"trip not found\" screen too and confirm \"← Zurück zu Reisen\" still looks right there."
  - "Force a trip load failure that is not a 404 — stop the dev server after the page loads, then reload, or open /trips/<a-valid-id-you-then-break>. You should see an error alert AND a \"← Zurück zu Reisen\" button under it. That button is new: the breadcrumb used to be that state's only way out, so the review pass gave the error state its own, matching the not-found panel. Confirm it does not appear when the trip loads normally."
  - "If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-20-trips-link-into-the-header-menu to done in sprint-status.yaml."
---

# Story 6.20: The Trips Link Moves Into the Header Menu

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the way back to all my trips in the hamburger menu instead of as a breadcrumb above the page,
so that the trip overview starts with the trip rather than with a link away from it.

## Acceptance Criteria

1. **The breadcrumb is gone.** The `← Zurück zu Reisen` control at the top of the trip detail page is removed, and the page's first block is the trip itself.
2. **The global menu carries it instead.** `HeaderMenu` gains an entry leading to `/trips`, reachable from every page an authenticated user can open.
3. **Only for signed-in users.** An anonymous visitor does not see it — `/trips` is not reachable for them, and a menu entry that bounces to the login screen is worse than none.
4. **Not a self-link where it leads nowhere.** Its behaviour on `/trips` itself is a deliberate decision — hidden, or present and harmless — and is recorded with its reason.
5. **The error states keep their button.** `TripTimeline.tsx:295` and `TripCostOverview.tsx:344` render the same label inside a "trip not found" panel. Those stay: a menu is not a recovery path from a page that failed to load.
6. **Key parity holds.** Whatever label the menu entry uses exists in both dictionaries; `trips.detail.back` keeps its two remaining readers or is deliberately retired.
7. **One less invalid nesting.** The removed markup is a `<Link>` wrapping a `<Button>` — an `<a>` containing a `<button>`, which is not valid HTML. It does not come back in the new entry.
8. **Nothing else in the menu changes.** Language switching, login, register and logout behave exactly as before.

## Tasks / Subtasks

- [x] **Task 1 — Remove the breadcrumb** (AC: 1, 7)
  - [x] `src/app/(routes)/trips/[id]/page.tsx:19-23` is the whole of it: a `Link` wrapping a `Button` wrapping `t("trips.detail.back")`.
  - [x] Delete it. The surrounding `Box display="flex" flexDirection="column" gap={4}` then has one child — check whether the wrapper and its `gap` still earn their place, and whether the page's top spacing still looks intentional at `xs` and `md`.
  - [x] Note what is being removed: interactive content inside an anchor. Both `Link` and `Button` render their own focusable element, so this was one control announcing itself twice. Do not reproduce the pattern.

- [x] **Task 2 — Add the entry to the header menu** (AC: 2, 3, 8)
  - [x] `src/lib/navigation/authMenu.ts` is the source: `getAuthMenuItems(isAuthenticated)` returns `{ key, labelKey, href? }` with `key: "login" | "register" | "logout"`. The union has to grow.
  - [x] Authenticated today returns `[logout]` alone. The trips entry belongs there, before `logout` — a destination above a session action.
  - [x] `HeaderMenu.tsx:209-223` already renders any item with an `href` as `MenuItem component={Link}`, so a new href-carrying item needs no new branch. Confirm that before adding one.
  - [x] AC3 falls out of putting it in the authenticated branch only. State it in a test rather than trusting the shape.
  - [x] Do not touch the language switcher, the CSRF handling or the logout path.

- [x] **Task 3 — Decide the self-link case** (AC: 4)
  - [x] `HeaderMenu` is global, so the entry appears on `/trips` too, where it leads to the page the user is already on.
  - [x] Two defensible answers: leave it (a menu that changes shape per route is harder to learn, and a no-op link costs nothing), or hide it with `usePathname()` (already a client component, so this is available).
  - [x] Pick one and record why. Do not leave it undecided — this is the kind of detail that gets re-litigated in review.

- [x] **Task 4 — The label** (AC: 6)
  - [x] `trips.detail.back` reads "← Zurück zu Reisen" / "← Back to trips". The arrow is breadcrumb decoration; in a vertical menu beside "Sprache" and "Abmelden" it points at nothing.
  - [x] Prefer a new key without the glyph — the existing one keeps two readers in the not-found panels, where the arrow still makes sense, so it is not freed by this story anyway.
  - [x] `i18nDictionaries.test.ts` compares the dictionaries key for key. A key added to one only will fail it.

- [x] **Task 5 — Tests** (AC: 1, 2, 3, 5, 8)
  - [x] Assert the trip detail page renders no link to `/trips` (AC1).
  - [x] Assert `HeaderMenu` shows the entry for an authenticated user and not for an anonymous one (AC2, AC3).
  - [x] Assert the not-found panels still render theirs (AC5) — this is the regression this story is most likely to cause, because a global grep for `href="/trips"` finds all three sites and two of them must stay.
  - [x] Keep the existing `HeaderMenu` suite green, language switching included.
  - [x] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 1, 4)
  - [ ] Open a trip: the page starts with the trip.
  - [ ] Open the menu from a trip, from a day and from `/trips` itself, and confirm the entry behaves as Task 3 decided.
  - [ ] Signed out, confirm it is absent.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked

Tommy on 2026-08-02: *"In der Reiseliste mit den Tagen steht oben ein Breadcrumb, um auf die Reiseübersicht aller Reisen zu gelangen. Den Link würde ich entfernen und stattdessen in das Hamburger-Menü aufnehmen."*

### The rule this establishes

Story 6.19 puts "back to this trip" into the **page-local** `⋯`. This story puts "all trips" into the **global** `HeaderMenu`. The two look contradictory and are not:

**A navigation target that needs this trip or this day belongs in the page-local menu. One that needs nothing belongs in the global menu.**

`/trips/${tripId}` needs the trip id, which `getAuthMenuItems(isAuthenticated)` does not have and should not learn — that is the exact argument 6.11 used when it built a page-local menu rather than extending this one. `/trips` is a constant, so it fits here without teaching the global menu anything about trips.

Worth writing down, because 6.11 and 6.15 both carry a trap saying "do not touch `HeaderMenu.tsx` or `authMenu.ts`", and this story deliberately does. The prohibition was never absolute — it was about not pushing trip-scoped state into a global component.

### What the removed markup actually was

```tsx
<Link href="/trips" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
  <Button variant="text" sx={{ alignSelf: "flex-start" }}>
    {t("trips.detail.back")}
  </Button>
</Link>
```

An `<a>` containing a `<button>`. Interactive content inside an anchor is invalid HTML, and both elements are focusable, so the control took two tab stops and announced itself twice. The `alignSelf: "flex-start"` is also set on both, once in `style` and once in `sx`, of which only the outer one does anything.

This is a real defect being removed, not merely a relocation — worth one line in the Dev Agent Record so the fix is not lost as a side effect.

### Three call sites, two must stay

`href="/trips"` appears three times. Only the first is in scope:

| Site | What it is | Fate |
|---|---|---|
| `app/(routes)/trips/[id]/page.tsx:19` | the breadcrumb | removed |
| `TripTimeline.tsx:295` | "trip not found" panel | **stays** |
| `TripCostOverview.tsx:344` | "trip not found" panel | **stays** |

The two survivors are recovery paths shown when the trip could not be loaded. Sending a user to a menu at that moment would be poor, and they are the reason `trips.detail.back` is not orphaned by this story.

### Traps

**1. A grep-and-delete removes too much.** All three sites share the label and the href. Two of them are error states. AC5 is written because this is the plausible failure.

**2. The item type is a closed union.** `AuthMenuItem["key"]` is `"login" | "register" | "logout"`. Adding a destination widens a type named for authentication — consider whether the name still fits, or note that it no longer does.

**3. Key parity is enforced.** `i18nDictionaries.test.ts` fails on a key present in one dictionary only.

**4. Do not reintroduce nested interactives.** `MenuItem component={Link}` renders a single element. Wrapping a `MenuItem` in a `Link` would recreate exactly what Task 1 removes.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. The `HeaderMenu` suite and `i18nDictionaries.test.ts` are the constraints. No browser-only acceptance criteria except the spacing judgement in Task 1 and the self-link behaviour in Task 6.

### Project Structure Notes

`src/app/(routes)/trips/[id]/page.tsx`, `src/lib/navigation/authMenu.ts`, `src/components/HeaderMenu.tsx`, both dictionaries, and the affected suites. No route, API or schema change.

### Sequencing

Independent of 6.19 — different files entirely — but the two share the rule stated above, so whichever lands second should not contradict it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.20]
- [Source: travelplan/src/app/(routes)/trips/[id]/page.tsx:19-23] — the breadcrumb
- [Source: travelplan/src/lib/navigation/authMenu.ts] — the item source
- [Source: travelplan/src/components/HeaderMenu.tsx:209-223] — the renderer that already handles href items
- [Source: _bmad-output/implementation-artifacts/6-19-day-hero-three-surfaces.md] — the other half of the rule

## Operator Pass — 2026-08-02, against `86b2526`

Chromium at 390px and 1400px, isolated worktree on port 3099 against a copy of `dev.db`.

- **AC1:** no breadcrumb; the only `/trips` link reachable from the trip page is the menu entry. The hero starts at y=107 (390px) and y=115 (1400px) — the Container's own `py` of 4/6, unchanged.
- **AC2:** the row reads "Alle Reisen", links to `/trips`, and sits **between Sprache and Abmelden**. Identical from the trip page, a day page and `/trips` itself.
- **AC3:** signed out the menu holds Language, Login, Register and **no** trips row.
- **AC4:** the row is present on `/trips` itself, as decided.
- **AC5:** the "Reise nicht gefunden" panel keeps **"← Zurück zu Reisen"**, arrow included.
- **Selecting it** navigates to `/trips` **and closes the menu**.
- **The review's addition works:** a non-404 load failure (forced 500 on `/api/trips/<id>`) renders the error alert **and** a "← Zurück zu Reisen" link. Before this story the breadcrumb was that state's only way out.

**A false finding worth recording so it is not re-found:** a naive "is a `[role=menu]` in the DOM" check reports the menu as open even before it is first opened, because `HeaderMenu` uses `keepMounted`. The reliable signals are the modal root's computed `visibility` (`hidden` → `visible` → `hidden`) and `aria-hidden`.

**Found while measuring, pre-existing, not a blocker:** the hamburger trigger carries `aria-label` alone — no `aria-haspopup`, `aria-expanded` or `aria-controls`, all three of which the day-hero `⋯` has carried since 6.11. Recorded as DW-140.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context) — implementation agent, non-interactive session.

### Debug Log References

- `npm test` (vitest run, from `travelplan/`): 105 files, 972 tests, all passing.
- `npx tsc --noEmit`: exits 1 with 143 pre-existing errors, all in `test/*` files this story did not
  touch (`tripDayPlanItemsRoute`, `tripDetailRoute`, `bucketListRoute`, `tripTimelineSharing`, …),
  overwhelmingly the known `as unknown as typeof fetch` / mock-envelope narrowing pattern. Zero
  errors in `src/`, and zero in any file this story added or changed.
- `npm run lint` (eslint): 2 errors, both pre-existing in `src/theme.ts`
  (`react/no-children-prop`), plus 83 pre-existing warnings. No error or warning in any file this
  story added or changed; the warnings reported for `HeaderMenu.tsx` (lines 31 and 55,
  `react-hooks/set-state-in-effect` / exhaustive-deps) are on code this story did not modify.

### Completion Notes List

- **AC1/AC7 — the breadcrumb is gone, and with it a real defect.** `src/app/(routes)/trips/[id]/page.tsx`
  rendered `<Link href="/trips"><Button variant="text">…</Button></Link>` — an `<a>` containing a
  `<button>`. That is invalid HTML (interactive content inside an anchor), and both elements are
  focusable, so the single "back to trips" control occupied two tab stops and announced itself twice.
  It is deleted rather than relocated: the new menu row is `MenuItem component={Link}`, one element,
  one tab stop. The duplicated `alignSelf: "flex-start"` (once in `style`, once in `sx`, only the
  outer one effective) went with it. Recording this explicitly so the accessibility fix is not lost
  as an incidental side effect of a relocation.
- **AC1 — the single-child wrapper went too.** With the breadcrumb removed, the enclosing
  `Box display="flex" flexDirection="column" gap={4}` had one child, and a `gap` needs two children
  to do anything. The page now renders `<TripTimeline>` directly inside the `Container`. Top spacing
  is unchanged at both breakpoints because it never came from that wrapper — it is the `Container`'s
  own `py: { xs: 4, md: 6 }`, which is untouched. `getServerT` is no longer imported: the breadcrumb
  label was the only string this page rendered, so the page is now string-free.
- **AC2 — the entry is data, not a new branch.** `getAuthMenuItems(true)` now returns
  `[{ key: "trips", labelKey: "header.trips", href: "/trips" }, { key: "logout", … }]`.
  `HeaderMenu.tsx:209-223` was confirmed before writing anything: it already renders every non-logout
  item as `MenuItem component={Link} href={item.href}`, so `HeaderMenu.tsx` needed **no change at
  all**. Destination before session action, matching the reading order the spec asked for.
- **AC3 — anonymous visitors never see it**, because the item exists only in the authenticated branch.
  Asserted twice: at the data level in `authMenu.test.ts` and at the rendered level in
  `headerMenuTripsEntry.test.tsx`.
- **AC4 decision — the entry stays visible on `/trips` itself; it is not hidden.** Reasons, in order
  of weight: (1) the epic's standing technical decision is that the global header menu is built from
  **auth state alone** and is not made route-, trip- or day-aware; introducing `usePathname()` here
  would make menu content a function of the current route, which is the exact coupling stories 6.11
  and 6.15 refused and 6.20's own Dev Notes restate. (2) A menu whose rows appear and disappear per
  route is harder to learn than one with a fixed shape — the user cannot build a motor memory of
  "second row is all trips" if the row sometimes is not there. (3) The cost of leaving it is a
  navigation to the page you are already on, which Next.js treats as a cheap same-route navigation —
  harmless, and no worse than the browser's own reload affordance. (4) It keeps `getAuthMenuItems` a
  pure function of one boolean, which is what makes it testable without a router.
- **AC6 — new key, both dictionaries, no glyph.** `header.trips` = "All trips" / "Alle Reisen", placed
  next to `header.openMenu` in each dictionary with a comment explaining why it is not a reuse.
  `trips.detail.back` is deliberately **kept** with its "←": its two readers (`TripTimeline.tsx:297`
  and `TripCostOverview.tsx:345`) are edge-anchored recovery buttons where the arrow still describes
  the affordance, so this story does not orphan it. Key parity holds — `i18nDictionaries.test.ts`
  passes.
- **AC5 — the two recovery buttons were left alone and are now pinned by test.** Neither not-found
  panel had any test coverage before; `tripNotFoundRecoveryLink.test.tsx` renders both components
  against a 404 envelope and asserts each still shows a link to `/trips` labelled "← Back to trips".
  This is the guard against the grep-and-delete failure mode the spec names.
- **AC8 — nothing else in the menu moved.** The language switcher, the CSRF fetch and the logout path
  are byte-identical; `HeaderMenu.tsx` was not edited. `headerMenuLanguageSwitcher.test.tsx` passes
  unchanged, and the new suite additionally pins that logout is still present for authenticated users
  and login/register still carry their hrefs for anonymous ones.
- **Trap 2, answered rather than dodged.** `AuthMenuItem["key"]` grew to
  `"trips" | "login" | "register" | "logout"`, so the type name now means "an item of the auth-driven
  menu" rather than "an authentication action". It is deliberately **not** renamed: the property that
  matters (built from auth state and nothing else) is unchanged, and the file's doc comment now states
  where the line actually is — a constant route may live here, a trip- or day-scoped one may not.
  (Corrected in the review pass: the first version of that comment justified the non-rename by saying
  a rename "would churn every reader". It would not — `grep -rn AuthMenuItem src test` finds only the
  declaration, because `HeaderMenu` imports the function and not the type. The comment now says the
  rename is cheap whenever it is wanted, so the next reader is not handed a false cost.)
- **Review pass — the load-error state got the exit the breadcrumb used to provide.** The spec
  enumerated three `href="/trips"` sites and protected the two error panels, but `TripTimeline` has a
  *fourth* failure state the enumeration missed: a non-404 load failure (`unauthorized`,
  `server_error`, `invalid_json`, network) renders `{error && <Alert/>}` with `detail === null` and no
  exit of its own. It never needed one, because the page's breadcrumb sat above it — and this story
  removed that. By AC5's own argument ("a menu is not a recovery path from a page that failed to
  load") that state now gets the same `/trips` button as the not-found panel, shown only when there is
  no trip to render, so a transient error over an already-loaded trip does not sprout a stray button.
  Pinned by a third case in `tripNotFoundRecoveryLink.test.tsx`.
- **Review pass — AC4's decision now lives beside the code, not only in `_bmad-output/`.** The
  reasoning above is repeated as a comment in `getAuthMenuItems`'s authenticated branch. A decision
  that takes four paragraphs to justify and one `usePathname()` call to reverse needs to be readable
  from the file it constrains.
- **Review pass — AC1's assertion was strengthened.** `tripDetailPage.test.tsx` counted occurrences of
  the mocked timeline, which would have stayed green if a heading or a new breadcrumb appeared *above*
  it — the exact regression AC1 forbids. It now asserts the timeline is the content column's only and
  first element child.
- **Review pass — the new `HeaderMenu` suite mounts the real provider tree.** It wrapped `HeaderMenu`
  in `I18nProvider` alone, which passes only because `HeaderMenu` happens to use colour literals; the
  first theme token it adopts would have broken a brand-new suite for an unrelated reason. It now uses
  `renderWithProviders`, whose `language` option also replaced the hand-rolled German render, and it
  gained the one behaviour test that was missing: choosing the row closes the menu (`onClick={handleClose}`
  was the only `HeaderMenu` behaviour the entry depends on and nothing exercised it).
- **Task 6 (manual browser check) is NOT done** and is left unticked: this session cannot start a dev
  server. What a human must verify is listed under Change Log below and in the frontmatter's
  `operator_actions`.

### File List

Modified:
- `travelplan/src/app/(routes)/trips/[id]/page.tsx` — breadcrumb and its single-child flex wrapper
  removed; `Button`, `Link`, `Typography` and `getServerT` imports dropped.
- `travelplan/src/lib/navigation/authMenu.ts` — `trips` added to the authenticated branch and to the
  `key` union; doc comments for the widened type and the destination/session ordering.
- `travelplan/src/i18n/en.ts` — added `header.trips`: "All trips".
- `travelplan/src/i18n/de.ts` — added `header.trips`: "Alle Reisen".
- `travelplan/test/authMenu.test.ts` — authenticated ordering is now `["trips", "logout"]`; new cases
  for the entry's href/labelKey and for its absence when signed out.
- `travelplan/src/components/features/trips/TripTimeline.tsx` — *review pass*: the load-error state
  (alert, no trip) gained the same `/trips` recovery button the not-found panel has. Its two
  pre-existing `href="/trips"` sites are untouched.

Added:
- `travelplan/test/headerMenuTripsEntry.test.tsx` — AC2, AC3, AC7, AC8 at the rendered level, the
  German label, and that choosing the row closes the menu.
- `travelplan/test/tripDetailPage.test.tsx` — AC1: the timeline is the content column's first and only
  element child, and the page renders no link (and no control) of its own.
- `travelplan/test/tripNotFoundRecoveryLink.test.tsx` — AC5: both not-found panels keep their
  `/trips` button, plus the load-error state added in the review pass.

Not changed, deliberately:
- `travelplan/src/components/HeaderMenu.tsx` — its existing href branch already renders the new item.
- `travelplan/src/components/features/trips/TripCostOverview.tsx` — its surviving `href="/trips"`
  recovery button. (Its own load-error state keeps the costs page's separate back link, which this
  story did not touch.)

### Change Log

| Date | Change |
|---|---|
| 2026-08-02 | Task 1: removed the `← Zurück zu Reisen` breadcrumb from the trip detail page, including the `<Link>`-wrapping-`<Button>` nested-interactive defect and the now-pointless single-child flex wrapper. |
| 2026-08-02 | Task 2: added the `trips` destination to `getAuthMenuItems`'s authenticated branch, before `logout`, and widened `AuthMenuItem["key"]`. `HeaderMenu.tsx` needed no change. |
| 2026-08-02 | Task 3: decided AC4 — the entry stays visible on `/trips`; the global menu remains auth-driven and route-unaware. |
| 2026-08-02 | Task 4: added `header.trips` to both dictionaries without the `←` glyph; kept `trips.detail.back` for its two recovery readers. |
| 2026-08-02 | Task 5: updated `authMenu.test.ts`; added `headerMenuTripsEntry.test.tsx`, `tripDetailPage.test.tsx`, `tripNotFoundRecoveryLink.test.tsx`. `npm test` green (105 files / 972 tests). |
| 2026-08-02 | Review pass: gave `TripTimeline`'s load-error state (alert, no trip) the same `/trips` recovery button as its not-found panel, since the breadcrumb that used to serve that state is gone. Recorded AC4's decision as a comment in `getAuthMenuItems`. Corrected the `AuthMenuItem` non-rename rationale (the "churns every reader" cost was false — the type has no importers). Condensed the trip detail page's docblock from a changelog of deleted markup to what the file is. Strengthened AC1's assertion to "first element child" and moved the new `HeaderMenu` suite onto `renderWithProviders`, adding the missing menu-closes-on-choose test. |
| 2026-08-02 | Task 6 left open — requires a human at a browser. To verify: (a) open a trip and confirm the page starts with the trip, with no link above it, and that the top spacing reads as intentional at 390px and at desktop width; (b) open the hamburger menu from a trip page, from a day page and from `/trips` itself and confirm "Alle Reisen" / "All trips" is present in all three, including on `/trips` where it is a deliberate self-link, and that selecting it closes the menu and lands on the trips list; (c) sign out and confirm the row is absent while Login/Register are present; (d) confirm the label reads well in both languages; (e) force a "trip not found" state and confirm the recovery button still appears. Use a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. |

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 8: (high 0, medium 2, low 6)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The spec enumerated three `href="/trips"` sites and protected the two error panels, but `TripTimeline` has a fourth failure state the enumeration missed: a non-404 load failure renders `{error && <Alert/>}` with `detail === null`, and that state carried no exit of its own because the page's breadcrumb sat above it — the breadcrumb this story deleted. AC5's own argument ("a menu is not a recovery path from a page that failed to load") applies to it verbatim, so it now gets the same `/trips` button as the not-found panel, rendered only when there is no trip to show. Pinned by a third case in `tripNotFoundRecoveryLink.test.tsx`. (This is the same shape as DW-126, which the 6.19 review raised for the day screen; that one remains open because its target is the parent trip, not `/trips`.)
  - `[low]` `[patch]` AC4's decision existed only in `_bmad-output/`. A decision that takes four paragraphs to justify and one `usePathname()` call to reverse has to be readable from the file it constrains, so the reasoning is now a comment in `getAuthMenuItems`'s authenticated branch.
  - `[low]` `[patch]` The `AuthMenuItem` doc block justified not renaming the type by saying a rename "would churn every reader". False, and checkable: `grep -rn AuthMenuItem src test` returns only the declaration, because `HeaderMenu` imports the function and not the type. The non-rename stands on the argument that does hold (what it is built from is unchanged); the comment now says the rename is cheap whenever it is wanted rather than handing the next reader an invented cost.
  - `[low]` `[patch]` The AC1 test asserted `querySelectorAll("[data-testid='trip-timeline']")).toHaveLength(1)` under a comment claiming the timeline was the content column's only child. Counting the mock proves only that the mock rendered; a heading or a new breadcrumb *above* the timeline would have kept all three tests green while violating "the page's first block is the trip itself". Now asserts the content column has exactly one element child and that it is the timeline.
  - `[low]` `[patch]` `headerMenuTripsEntry.test.tsx` wrapped `HeaderMenu` in `I18nProvider` alone, bypassing `renderWithProviders` — whose own doc comment states the theme wrapper is not optional, since anything reading `theme.palette.tokens.*` throws under MUI's bare default theme. It passes today only because `HeaderMenu` happens to use colour literals; the first token it adopts would break a brand-new suite for a reason unrelated to what it tests. Moved onto `renderWithProviders`, whose `language` option also replaced the hand-rolled German render that had been duplicated because the `openMenu` helper hardcoded English.
  - `[low]` `[patch]` The one `HeaderMenu` behaviour the new row depends on — `onClick={handleClose}`, which dismisses the menu when the row is chosen — was asserted by nothing: the suite covered presence, `href`, tag name and absence, never a click. Added, and it is the same interaction item (b) of the operator checklist performs by hand.
  - `[low]` `[patch]` The trip detail page's new docblock was eleven lines describing code that is no longer there (what the deleted `Box` was, why a `gap` needs two children, why `getServerT` went) — a changelog in a position where a reader expects a description, unverifiable from the file and stale on the next edit, with git history and this spec already holding it twice. Condensed to what the file is plus the one durable constraint (keep the timeline first; the top spacing is the `Container`'s). One test-name/body mismatch ("for both audiences" over a single-audience body) and an unused `{ user }` return in the same suite went with it.
  - `[medium]` `[defer]` DW-127 — `href` stays optional on a union that now contains a destination, while `HeaderMenu` branches on the literal `key === "logout"` and falls back to `href ?? "#"`. A future *action* item renders a silent dead anchor instead of failing to compile.
  - `[medium]` `[defer]` DW-128 — `HeaderMenu` never revalidates `authState`, so an expired session keeps being offered a row that bounces to login. Pre-existing staleness; this story changed what a stale row costs by putting navigation next to the session actions.
  - `[low]` `[defer]` DW-129 — the deliberate self-link on `/trips` is not marked as the current page (`aria-current` / `selected`), which would need the route-awareness AC4 declined.
  - `[low]` `[defer]` DW-130 — the costs page and both full-page map screens keep the above-content back link idiom this story moved into the menu. Consistent with 6.20's actual rule (those targets are trip-scoped) but the scope is not written down anywhere they can see it.
  - `[low]` `[defer]` DW-131 — the page's outer `minHeight: "100vh"` Box now wraps a single child and, with `AppHeader`'s 72px Toolbar, guarantees a scrollbar on every trip.
  - `[low]` `[defer]` DW-132 — the "trip not found" panel is duplicated verbatim between `TripTimeline` and `TripCostOverview`, `trips.detail.*` keys included, and is now pinned twice.
  - `[low]` `[defer]` DW-133 — `HomeHero` offers "Create account" and "Sign in" to an authenticated visitor, on the same screen where the menu beside it now says "All trips" and "Sign out".
  - `[low]` `[defer]` DW-134 — `npm run lint` exits non-zero on a clean tree from two `react/no-children-prop` errors in `theme.ts`, so lint cannot be used as a per-story signal (the `tsc` twin of this is DW-95).

Rejected, with reasons, so they are not re-raised: (1) *"primary navigation now lives inside `role="menu"`, losing a link in the document flow and one tab stop"* — true, and it is precisely what Tommy asked for; the story is the trade, not a victim of it. (2) *"the recovery tests assert the exact label `← Back to trips`, so a copy change breaks them"* — deliberate: AC6 turns on `trips.detail.back` keeping its readers *and its arrow*, so the label is part of what those two cases pin, not incidental coupling. (3) *"the two dictionary entries carry nine lines of prose for two lines of data, and `de.ts` points at `en.ts`"* — matches the file's existing convention (there is already a multi-line arrow-glyph note in `en.ts`), and the reviewer's supporting claim that the "between Language and Sign out" comment is wrong is itself wrong: `HeaderMenu` renders the language row first, so the rendered order really is Language → All trips → Sign out. (4) *"AC4 is not a real decision unless a test pins it"* — pinning "the row is present on `/trips`" requires making the menu route-aware, which is the coupling AC4 rejected; the comment added above is the appropriate weight. (5) *"rename `AuthMenuItem`"* — trap 2 of the spec offers renaming *or* noting that the name no longer fits, and the note is the sanctioned half; only the false justification was a finding. (6) *"the spec is committed with Task 6 open and its two status fields disagreeing"* — the status fields were mid-workflow bookkeeping, now reconciled, and Task 6 is the operator hand-off this story is designed to end in, not a finding.

## Auto Run Result

Status: **awaiting-operator** — implemented, reviewed and patched as far as an agent can take it. Task 6 is a browser pass and needs a human.

### What changed

The `← Zurück zu Reisen` breadcrumb is gone from the top of the trip detail page, and the page now opens with the trip. Its replacement is a row in the global `HeaderMenu`, added as *data*: `getAuthMenuItems(true)` returns `[{ key: "trips", labelKey: "header.trips", href: "/trips" }, { key: "logout", … }]`, and `HeaderMenu.tsx` needed no change at all because its existing branch already renders any href-carrying item as a single `MenuItem component={Link}`. That single element is also the AC7 fix: the deleted markup was a `<Link>` wrapping a `<Button>` — an `<a>` containing a `<button>`, invalid HTML that took two tab stops and announced one control twice. The row is authenticated-only (AC3) and is deliberately kept on `/trips` itself rather than hidden with `usePathname()`, because the global menu is a function of auth state alone and route-awareness is the coupling stories 6.11 and 6.15 refused (AC4, now recorded in the code as well as here). The label is a new key, `header.trips`, without the breadcrumb's arrow; `trips.detail.back` keeps its arrow and its two readers in the "trip not found" panels, which stay exactly where they are (AC5). The review pass added one thing the spec's three-call-site enumeration had missed: `TripTimeline`'s *load-error* state, which also relied on the removed breadcrumb for its way out, now gets the same recovery button as the not-found panel.

### Files changed

| File | What |
|---|---|
| [`travelplan/src/app/(routes)/trips/[id]/page.tsx`](../../travelplan/src/app/(routes)/trips/[id]/page.tsx) | Breadcrumb and its now single-child flex wrapper removed; `Button`, `Link`, `Typography` and `getServerT` imports dropped, leaving a string-free page shell. |
| [`travelplan/src/lib/navigation/authMenu.ts`](../../travelplan/src/lib/navigation/authMenu.ts) | `trips` added to the authenticated branch before `logout` and to the `key` union; doc comments for the widened type, the destination/session ordering, the trip-scoped line a destination must not cross, and AC4's self-link decision. |
| [`travelplan/src/components/features/trips/TripTimeline.tsx`](../../travelplan/src/components/features/trips/TripTimeline.tsx) | Review pass: the load-error state (alert, no trip) gained a `/trips` recovery button. Its two pre-existing `href="/trips"` sites are untouched. |
| [`travelplan/src/i18n/en.ts`](../../travelplan/src/i18n/en.ts) · [`de.ts`](../../travelplan/src/i18n/de.ts) | New key `header.trips` — "All trips" / "Alle Reisen", no arrow glyph. `trips.detail.back` unchanged. |
| [`travelplan/test/authMenu.test.ts`](../../travelplan/test/authMenu.test.ts) | Authenticated ordering is now `["trips", "logout"]`; new cases for the entry's shape and for its absence when signed out. |
| [`travelplan/test/headerMenuTripsEntry.test.tsx`](../../travelplan/test/headerMenuTripsEntry.test.tsx) | New: AC2, AC3, AC7, AC8 at the rendered level, the German label, and that choosing the row closes the menu. Mounts through `renderWithProviders`. |
| [`travelplan/test/tripDetailPage.test.tsx`](../../travelplan/test/tripDetailPage.test.tsx) | New: AC1 — the timeline is the content column's first and only element child, and the page renders no link or control of its own. |
| [`travelplan/test/tripNotFoundRecoveryLink.test.tsx`](../../travelplan/test/tripNotFoundRecoveryLink.test.tsx) | New: AC5 — both not-found panels keep their `/trips` button (neither had coverage before), plus the load-error state added in the review pass. |
| [`deferred-work.md`](deferred-work.md) | DW-127 … DW-134 appended, all pre-existing and surfaced by this review, plus a note that story 6.20 partially reduces DW-126. |

### Review findings

7 patches applied (1 medium, 6 low), 8 deferred, 6 rejected. No `intent_gap` and no `bad_spec`, so no spec loopback and no re-derivation. The load-bearing patch is the load-error recovery button: the spec's "three call sites, two must stay" table is a complete account of where the *href* appears and an incomplete account of which states relied on it, and the state it missed is the one where the user most needs a way out. The rest are a test that could not fail the way it was named, a suite mounting half the provider tree, an untested `onClick`, and two comments asserting things that were not true.

### Verification

| Check | Outcome |
|---|---|
| `npm test` | 105 files, **974 tests, all passed** (972 before the review pass added two) |
| `npx tsc --noEmit` | Exits 1 with **143 pre-existing errors**, none in `src/` and none in any file this story touched — the `as unknown as typeof fetch` mock pattern tracked as DW-95 |
| `npm run lint` | **2 errors, 83 warnings — identical before and after this change**, both errors in `src/theme.ts` (now DW-134); nothing reported in any file this story added or changed |
| Affected suites in isolation | `authMenu`, `headerMenuTripsEntry`, `tripDetailPage`, `tripNotFoundRecoveryLink`, `headerMenuLanguageSwitcher` — all green |
| Task 6 (browser) | **Not performed.** No dev server was started and `prisma/dev.db` was not touched. See `operator_actions`. |

### Residual risks

- **AC1's spacing judgement and AC4's real behaviour are unverified.** jsdom computes no layout and resolves no responsive `sx`, so "the top spacing still looks intentional at `xs` and `md`" and "the self-link is harmless" are arguments here, not measurements. Both are in the operator list.
- **The self-link is a deliberate no-op.** If it reads as broken rather than as harmless when Tommy tries it, the fix is `usePathname()` in `HeaderMenu` — a route-awareness the epic has refused three times, so it should become its own story rather than a follow-up patch, with DW-129 as its starting point.
- **`/trips` is now one tap deeper on every screen than the breadcrumb was on one screen.** That is the trade the story asked for, but it applies to the error and not-found states too, which is why all three keep or gain their own in-page button.
- **DW-127 and DW-128 are the two open items closest to this change.** Neither affects any shipping item today; both are about what the next item added to this menu, or an expired session, will do.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the app in a browser to do Task 6, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. Two of the eight acceptance criteria need that session: AC1's spacing judgement and AC4's real behaviour are the only claims in this story that jsdom cannot make, because it computes no layout and does not resolve MUI's responsive sx at all.
- Open a trip and confirm the page now starts with the trip: no link, no button, nothing above the hero. Then look at the top spacing at 390px and again at 1400px and say whether it still reads as intentional. The breadcrumb and the flex wrapper that held it are both gone; the padding that remains is the Container's own py of 4 at xs and 6 at md, which is unchanged — but that gap used to be filled by a control, so the judgement is yours.
- Open the hamburger menu from a trip page and confirm the row reads "Alle Reisen" ("All trips" in English), sits between Sprache and Abmelden, and lands on the trips list. Then confirm selecting it also closes the menu rather than leaving it open over the new page.
- Open the menu from a day page too, and then from /trips itself. On /trips the row is deliberately still there and links to the page you are already on — that is Story 6.20 AC4, decided rather than overlooked, because hiding it would make the global menu's contents depend on the current route and that coupling has been refused three times in this epic. Try it and say whether it reads as harmless or as broken; if it reads as broken, the fix is its own story and DW-129 in deferred-work.md is its starting point.
- Sign out and confirm the row is absent while Login and Register are both still present and working. Then sign back in and confirm it returns.
- Check the label in both languages. "Alle Reisen" and "All trips" are a new key with no leading arrow, because in a vertical menu the breadcrumb's ← pointed at nothing. The old key keeps its arrow and its two readers, so glance at a "trip not found" screen too and confirm "← Zurück zu Reisen" still looks right there.
- Force a trip load failure that is not a 404 — stop the dev server after the page loads, then reload, or open /trips/<a-valid-id-you-then-break>. You should see an error alert AND a "← Zurück zu Reisen" button under it. That button is new: the breadcrumb used to be that state's only way out, so the review pass gave the error state its own, matching the not-found panel. Confirm it does not appear when the trip loads normally.
- If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-20-trips-link-into-the-header-menu to done in sprint-status.yaml.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
