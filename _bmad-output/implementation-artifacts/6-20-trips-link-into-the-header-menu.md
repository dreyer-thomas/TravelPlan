---
authored_against: dcfb859
---

# Story 6.20: The Trips Link Moves Into the Header Menu

Status: ready-for-dev

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

- [ ] **Task 1 — Remove the breadcrumb** (AC: 1, 7)
  - [ ] `src/app/(routes)/trips/[id]/page.tsx:19-23` is the whole of it: a `Link` wrapping a `Button` wrapping `t("trips.detail.back")`.
  - [ ] Delete it. The surrounding `Box display="flex" flexDirection="column" gap={4}` then has one child — check whether the wrapper and its `gap` still earn their place, and whether the page's top spacing still looks intentional at `xs` and `md`.
  - [ ] Note what is being removed: interactive content inside an anchor. Both `Link` and `Button` render their own focusable element, so this was one control announcing itself twice. Do not reproduce the pattern.

- [ ] **Task 2 — Add the entry to the header menu** (AC: 2, 3, 8)
  - [ ] `src/lib/navigation/authMenu.ts` is the source: `getAuthMenuItems(isAuthenticated)` returns `{ key, labelKey, href? }` with `key: "login" | "register" | "logout"`. The union has to grow.
  - [ ] Authenticated today returns `[logout]` alone. The trips entry belongs there, before `logout` — a destination above a session action.
  - [ ] `HeaderMenu.tsx:209-223` already renders any item with an `href` as `MenuItem component={Link}`, so a new href-carrying item needs no new branch. Confirm that before adding one.
  - [ ] AC3 falls out of putting it in the authenticated branch only. State it in a test rather than trusting the shape.
  - [ ] Do not touch the language switcher, the CSRF handling or the logout path.

- [ ] **Task 3 — Decide the self-link case** (AC: 4)
  - [ ] `HeaderMenu` is global, so the entry appears on `/trips` too, where it leads to the page the user is already on.
  - [ ] Two defensible answers: leave it (a menu that changes shape per route is harder to learn, and a no-op link costs nothing), or hide it with `usePathname()` (already a client component, so this is available).
  - [ ] Pick one and record why. Do not leave it undecided — this is the kind of detail that gets re-litigated in review.

- [ ] **Task 4 — The label** (AC: 6)
  - [ ] `trips.detail.back` reads "← Zurück zu Reisen" / "← Back to trips". The arrow is breadcrumb decoration; in a vertical menu beside "Sprache" and "Abmelden" it points at nothing.
  - [ ] Prefer a new key without the glyph — the existing one keeps two readers in the not-found panels, where the arrow still makes sense, so it is not freed by this story anyway.
  - [ ] `i18nDictionaries.test.ts` compares the dictionaries key for key. A key added to one only will fail it.

- [ ] **Task 5 — Tests** (AC: 1, 2, 3, 5, 8)
  - [ ] Assert the trip detail page renders no link to `/trips` (AC1).
  - [ ] Assert `HeaderMenu` shows the entry for an authenticated user and not for an anonymous one (AC2, AC3).
  - [ ] Assert the not-found panels still render theirs (AC5) — this is the regression this story is most likely to cause, because a global grep for `href="/trips"` finds all three sites and two of them must stay.
  - [ ] Keep the existing `HeaderMenu` suite green, language switching included.
  - [ ] `npm test` green.

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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
