---
baseline_commit: 57c438dac580d8768b9bbae21d84b5de8967e943
---

# Story 7.4: Trips List Redesign

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the trips list to match the approved design (trip rows with photo, status pill, cost-so-far, a primary "Neue Reise" action),
so that my trips overview is consistent with the rest of the app and shows each trip's planning status at a glance.

## Acceptance Criteria

1. Given `mockups/trips-list-share-login.html` (Screen C) and `EXPERIENCE.md`'s Trips List component patterns, when the trips list screen is rebuilt, then each trip renders as a `trip-row` with a square center-cropped trip photo, name, date range, a `trip-status` pill in one of its four states (gap/fully-planned/upcoming/past), and a cost-so-far figure.
2. Given a trip has no accommodation gaps and is fully within its planned range, when its row renders, then it shows the "Vollständig geplant" state, not the gap state.
3. Given a past/completed trip, when its row renders, then it renders at reduced opacity as a read-only archival row, per `DESIGN.md`'s `trip-row` spec.
4. Given the existing trips-list functionality (create a trip, open a trip, hero-image display), when the screen is redesigned, then all of it continues to work unchanged — the redesign adds read-only status/cost data, it does not change what the screen can do.

## Tasks / Subtasks

- [x] Task 1: Extend the trips-list payload with the two fields the design needs. (AC: 1, 2, 3)
  - [x] **This is the one story in Epic 7 that legitimately requires a data change.** 7.2 and 7.3 rendered from payloads that already carried everything; Screen C does not. `GET /api/trips` today returns exactly `{ id, name, startDate, endDate, dayCount, heroImageUrl, updatedAt }` (`src/app/api/trips/route.ts:84-95`) — no accommodation-gap count, no cost. AC1's status pill and cost figure cannot be derived from it. Extend the read path; do **not** work around it by having the client fetch `/api/trips/{id}` per row (N+1 on the landing surface, and NFR1's ~15s p95 budget is a page-level budget).
  - [x] Widen `listTripsForUser` (`src/lib/repositories/tripRepo.ts:417-432`) to include what the three new numbers need, in **one** query — keep the existing `where: { userId }` filter and `orderBy: { startDate: "asc" }` exactly as they are (see Dev Notes → "Two things not to 'fix' while you are in this function"):
    ```
    include: {
      _count: { select: { days: true } },
      days: {
        select: {
          accommodation: { select: { name: true, costCents: true } },
          dayPlanItems: { select: { costCents: true } },
        },
      },
    }
    ```
  - [x] Derive three fields per trip and add them to the `TripSummary` type (`tripRepo.ts:22-38`), **reusing the visible-cost rules from `getTripWithDaysForUser` verbatim** (`tripRepo.ts:641-654`) rather than re-deriving them — the same amount must not read differently on the list and on the trip overview:
    - `openDayCount` — days whose accommodation name is missing or blank (`(day.accommodation?.name?.trim() ?? "").length === 0`). This is the list-level mirror of `missingAccommodation` (`tripRepo.ts:682`) and of Trip Overview's `openDaysCount` (`TripTimeline.tsx:385`). A stay row that exists with an empty name counts as *open* — that is the established rule, not an edge case to tighten.
    - `planItemCount` — total `dayPlanItems` across the trip. Needed only by the upcoming/unplanned branch in Task 3; a `_count` on the day select is fine if you prefer it to a length sum.
    - `plannedCostTotal` — cents. Accommodation cost counts **only when the name is non-blank** (`getVisibleAccommodationCost`), plus every `dayPlanItem.costCents ?? 0`. Same rule as `plannedCostTotal` on the detail payload, so the list figure and the trip-overview figure agree for the same trip.
  - [x] Serialize the three fields in `GET /api/trips` (`src/app/api/trips/route.ts:84-95`) next to the existing keys. Keep the envelope shape (`{ data, error }`), `camelCase` JSON, and ISO-8601-UTC dates per `architecture.md`'s Format Patterns. Do **not** touch the `POST` response shape — Task 5 derives the new fields client-side for a freshly created trip instead.
  - [x] Do **not** compute trip *status* on the server. Status depends on "today" (Task 3), and a server-computed status would be baked into a cached response and go stale at midnight. Ship the raw counts; derive the state in the component.
- [x] Task 2: Rebuild the page shell — topbar and stat strip. (AC: 1)
  - [x] `src/app/(routes)/trips/page.tsx`: delete the pre-redesign header block entirely (`page.tsx:11-26` — the white `Paper`-style `Box` with `borderRadius: 4`, `boxShadow: "0 22px 40px rgba(17,18,20,.1)"` and a `1px solid rgba(17,18,20,.08)` border). It is a shadowed, 16px-radius card in a system that is flat and bordered (`DESIGN.md.Elevation & Depth`: "if an element sits in the normal document flow… it should never carry a shadow"). Widen `Container maxWidth="md"` → `"lg"` to match the trip-overview and day-detail pages, and reduce `py` to something in the token scale (`{ xs: 3, md: 4 }`); the screen's own topbar now supplies the vertical rhythm. The file stays a server component; it renders `<TripsDashboard />` and nothing else of substance.
  - [x] Build the topbar inside `TripsDashboard.tsx` (it needs the fetched counts, so it cannot stay server-rendered): `display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap`, `padding: 22px 32px`, `border-bottom: 1px solid` `tokens.border`.
    - **Left:** kicker at `variant="kicker"` in `theme.palette.primary.main` (reuse `trips.page.title` — "Your trips" / "Deine Reisen", which is exactly the mockup's "Meine Reisen" kicker), then the page title at `variant="display" component="h1"`, then the sub-line at `13px/600` in `tokens.inkSoft`.
    - **Do not build the mockup's "Willkommen zurück, Thomas" greeting.** `User` has `id`, `email`, `role`, `preferredLanguage` and no name field (`prisma/schema.prisma`), and adding one is a schema change with no AC behind it. Deriving a display name from the email local-part is a guess presented as a fact. Use the existing `trips.dashboard.title` ("Trips in progress" / "Reisen in Planung") as the `h1`; note the deviation in Dev Agent Record.
    - Sub-line copy: "{tripCount} trips · {gapTripCount} with open items" (new parameterized key, both dictionaries). `gapTripCount` = the number of **non-past** trips whose derived status is `gap` — the mockup's own sub-line counts *trips*, while the stat cell below counts *days*, so the two numbers are deliberately different and each is labelled for what it is.
    - **Right:** the "Neue Reise" primary action — keep the existing `TripCreateDialog` trigger and the existing `trips.dashboard.addTrip` key (all four tests in the file locate it by `getAllByRole`/`findAllByRole("button", { name: /add trip/i })`, `test/tripsDashboard.test.tsx:75, 89, 108, 138`). `variant="contained"` already resolves to the accent fill at 44px min-height through Story 7.1's theme; add the mockup's leading "+" glyph as a 15px `aria-hidden` `startIcon` (the label already carries the meaning). Do not reword the key.
  - [x] Stat strip directly below the topbar — same construction as the two existing ones (`TripTimeline.tsx:452-509` is the reference; copy its shape rather than inventing a third): `display: grid`, `repeat(3, 1fr)` at `sm`+ / `repeat(1, 1fr)` at `xs`, `backgroundColor: tokens.card`, `border-bottom: 1px solid` `tokens.border`, each cell `p: "16px 24px"` with a right border except the last, label at `variant="labelCaps"` in `tokens.inkSoft`, value at `fontSize: 21, fontWeight: 900` with `fontVariantNumeric: "tabular-nums"` (hard rule, `DESIGN.md.Typography`).
    - **Cell 1 — Active trips:** count of trips whose status is not `past`.
    - **Cell 2 — Costs so far (all trips):** `formatCost(sum of plannedCostTotal)`, in `theme.palette.primary.main` (the mockup's `.v.accent`).
    - **Cell 3 — Open items:** sum of `openDayCount` across **non-past** trips, in `theme.palette.warning.main` when > 0, else `tokens.ink` — exactly the treatment Trip Overview's open-items cell uses (`TripTimeline.tsx:498-507`). Past trips are excluded because a finished trip's missing accommodations are not actionable, and AC3 frames past trips as archival.
    - Before adding any fourth number, apply `EXPERIENCE.md`'s redundant-stat-removal principle. Trip count already appears in the sub-line; do not repeat it as a cell.
- [x] Task 3: Implement the four-state status derivation. (AC: 1, 2, 3)
  - [x] Write it as one pure helper (a module-scope function in `TripsDashboard.tsx`, or `src/lib/trips/tripStatus.ts` if you prefer it directly unit-testable — either is fine, but it must be a pure function of `(trip, today)`, not inline JSX ternaries). Signature: `(trip: TripSummary, todayUtc: Date) => "past" | "upcoming" | "gap" | "planned"`.
  - [x] **`EXPERIENCE.md` names the four states but never defines their boundaries, and two of them overlap on real data. These are the rules — implement them exactly, in this precedence order:**
    1. `endDate < todayUtc` → **`past`**. Precedence is deliberate and AC3-driven: a finished trip is archival, and shouting "3 Tage offen" about a trip that already happened is noise, not an action.
    2. else if `openDayCount === dayCount && planItemCount === 0 && startDate > todayUtc` → **`upcoming`**. This is the "created but not yet planned" trip — the mockup's third row (a future trip with €0 and no plan). Without this branch every brand-new trip would immediately render as a full-width warn row, which inverts the gap signal's meaning: warn is for *holes in a plan*, not for *the absence of a plan*.
    3. else if `openDayCount > 0` → **`gap`**.
    4. else → **`planned`** (AC2).
  - [x] `todayUtc`: the trip dates are UTC-normalized date-only values (`normalizeToUtcDate`, and every formatter on this screen already passes `timeZone: "UTC"` — `TripsDashboard.tsx:77-86`). Compare against UTC midnight of the current day, computed once per render, not per row. `TripsDashboard` is a client component whose data arrives from an effect, so there is no SSR/hydration mismatch risk here — but do not move this derivation into a server component later without revisiting that.
  - [x] Pill treatments, all four (`DESIGN.md.Components → badge/pill`, `EXPERIENCE.md.State Patterns` "Trip status variants"). Base: `display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; font-size: 11.5px; font-weight: 700; white-space: nowrap`, icon at 13px, **`aria-hidden` on every icon** (the adjacent text always carries the meaning — `EXPERIENCE.md.Accessibility Floor` names the trip-status check/clock/box icons explicitly).
    | State | Colors | Icon | Text |
    |---|---|---|---|
    | `gap` | `theme.palette.warning.main` on `tokens.warnBg` | `WarningTriangleIcon` | "N days open" / "1 day open" |
    | `planned` | `theme.palette.primary.main` on `tokens.accentSoft` | check glyph | "Fully planned" |
    | `upcoming` | `tokens.inkSoft` on the mockup's `#F1ECE1` | clock glyph | "Upcoming · planning open" |
    | `past` | `tokens.inkSoft` on the mockup's `#F1ECE1` | calendar/box glyph | "Completed" |
  - [x] `#F1ECE1` is not in the token set (`theme.ts:54-72`) and is the only new literal this story needs. Define it **once** as a named module constant with a comment pointing at `mockups/trips-list-share-login.html:210-211`, the way 7.2 handled `DAY_ROW_GAP_BG`. Do not scatter it, and do not substitute `tokens.cardAlt`/`warnBg` — this is the neutral track and both of those read as a different state. Add nothing else: every other value above resolves from `theme.palette` / `theme.palette.tokens`. Story 7.2's review left "new hardcoded hex literals" as standing debt; this story should add one, not five.
  - [x] **Pluralization is manual.** `formatMessage` is a `{key}` substituter with no plural support (`src/i18n/index.ts:23-27`), so the gap pill needs **two** keys (`…statusGap` / `…statusGapOne`) and a `count === 1` branch. `DESIGN.md.Components → badge/pill` calls this out by name ("correct German number agreement, not a fixed plural"); shipping "1 Tage offen" is a visible defect in the primary language.
  - [x] Add the three new glyphs (check, clock, calendar) to `src/components/features/trips/TripIcons.tsx`, in the same `SvgIcon` style as the existing seven — paths from `mockups/trips-list-share-login.html:497, 510, 523`. Reuse `WarningTriangleIcon` and `ChevronRightIcon` from that module; do not re-declare them locally (that duplication is exactly what 7.2's review flagged and 7.3 fixed).
- [x] Task 4: Rebuild the list as `trip-row`s. (AC: 1, 2, 3)
  - [x] Delete the current `Paper` + MUI `List`/`ListItem`/`ListItemButton`/`ListItemText` construction (`TripsDashboard.tsx:150-201`) including the `"&:hover": { backgroundColor: "rgba(241, 90, 36, 0.08)" }` orange tint — a leftover from the pre-redesign palette with no `DESIGN.md` equivalent. Rows are now plain `Box`es in a `component="ul"` list, mirroring the day-row list (`TripTimeline.tsx:530, 600-632`).
  - [x] Row: `display: grid`, `gridTemplateColumns: { xs: "72px 1fr", sm: "96px 1fr 190px 150px" }` with named `gridTemplateAreas` for both breakpoints — **name every area both templates use**; 7.2 shipped a real bug where an unnamed area auto-placed into an implicit track and overflowed the row on narrow viewports (`TripTimeline.tsx:609-616`, comment retained there). `align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid` `tokens.borderStrong`; `border-radius: 8px` (`rounded.md`); `margin-bottom: 10px`; `background: tokens.card`.
  - [x] State treatments on the row itself: `gap` → `borderColor: tokens.warnBorder` + `backgroundColor: "#FBF6EE"` (the same `DAY_ROW_GAP_BG` literal 7.2 already defines at `TripTimeline.tsx:100` — **import it or move it into `TripIcons.tsx`/a shared constants module rather than declaring a second copy**; `DESIGN.md.components.trip-row.bg-gap` and `day-row.bg-gap` are the same value). `past` → `opacity: 0.78` (`components.trip-row.opacity-past`) and nothing else — `DESIGN.md` is explicit that this is the one place opacity substitutes for a color state, so do not also gray the text or drop the border.
  - [x] **Whole row is one navigation target** (`EXPERIENCE.md.Interaction Primitives`). Use 7.2's proven technique verbatim (`TripTimeline.tsx:633-638`): an absolutely-positioned `Link` covering `inset: 0` at `zIndex: 1` with an `aria-label` naming the trip, plus `"&:has(:focus-visible)": { outline: 2px solid primary.main, outlineOffset: 2 }` on the row so keyboard focus is visible without firing on mouse clicks. Any column painted above it (`zIndex: 2`) must set `pointerEvents: "none"` with `"& a, & button": { pointerEvents: "auto" }`, or it becomes a dead zone.
  - [x] Photo: `component="img"`, `data-testid="trip-row-photo"`, `width/height: { xs: 72, sm: 96 }` (`components.trip-row.photoSize` = 96px, larger than day-row's 72px — this is the higher-prominence landing surface), `objectFit: "cover"; objectPosition: "center"`, **`borderRadius: 0`** (`rounded.photo`, no exceptions), `border: 1px solid rgba(0,0,0,0.06)`, `flexShrink: 0`. Src keeps the existing versioned resolution — `withImageCacheBuster(trip.heroImageUrl, trip.updatedAt)` falling back to `/images/world-map-placeholder.svg` (`TripsDashboard.tsx:178-185`); that versioning is a fix from the 2026-08-01 hero-image investigation, do not simplify it away.
  - [x] Photo alt: `alt=""` — `DESIGN.md.Photo Alt-Text` classes the `trip-row` leading thumbnail as decorative/redundant ("the adjacent title text already names the same entity"). **This breaks `test/tripsDashboard.test.tsx:159`** (`getByRole("img", { name: /autumn in oslo/i })`) — see Task 6; rewrite that assertion against the testid, do not keep a redundant alt just to satisfy it.
  - [x] Middle block: trip name at `variant="cardTitle"` sized to the mockup's `16px/800` in `tokens.ink` (`component="h2"`, since the topbar title is now the `h1`), then the meta sub-line at `12px/600` in `tokens.inkSoft`, `minWidth: 0` with ellipsis on overflow.
  - [x] Meta sub-line content: the existing date range + day count (`buildDateRange(trip)` + `trips.dashboard.dayCount`, `TripsDashboard.tsx:87-90, 192-194`) — keep both, one test asserts the trip name renders and the date logic is already correct and locale-aware. The mockup's multi-stop route ("Lissabon → Sintra → Porto → Douro-Tal → Algarve") is **not derivable**: `Trip` carries only `startLocationLabel` and `destinationLocationLabel`, with no intermediate stops. You may append " · {start} → {destination}" when *both* labels are non-empty (select the two fields in Task 1's query if you do); synthesizing a multi-stop route from day accommodations is out of scope and would be inventing data.
  - [x] Trailing cost block: right-aligned, label at `10px/700` uppercase `0.06em` in `tokens.inkSoft` and value at `16.5px/900` in `tokens.ink` with `fontVariantNumeric: "tabular-nums"`. Label is "Costs so far" for every state except `past`, where the mockup switches to "Total costs" — implement both keys, that switch is meaningful (a finished trip's running total is final). Value = `formatCost(trip.plannedCostTotal)`.
  - [x] **Reuse the currency-aware `formatCost`** that 7.2 landed and 7.3 adopted (`TripTimeline.tsx:143-153`: a `useMemo` over `language` returning `Intl.NumberFormat(de-DE|en-US, { style: "currency", currency: "EUR", min/maxFractionDigits: 2 }).format(cents / 100)`; the comment above it records why — German needs "1.234,50 €", not "€1.234,50"). Do not write a fourth copy and do not emit a bare number. There is a standing deferred finding that this helper is already duplicated three ways; lifting it into `src/lib/trips/formatCost.ts` as a pure `(cents, language)` function and calling it from here is welcome — but do not refactor `TripTimeline.tsx`/`TripDayView.tsx`/`TripCostOverview.tsx` onto it in this story.
  - [x] Add a `ChevronRightIcon` in `tokens.inkMuted` at the row's trailing edge, matching the day-row affordance — the mockup omits it, but the row is a click-through and 7.2 established the convention. Note as a judgment call.
  - [x] **Sort order:** non-past trips first, ascending by `startDate` (today's behavior, `TripsDashboard.tsx:60-63`), then past trips last, descending by `startDate` (most recent first). This is what Screen C actually depicts — its past May-2026 row sits *below* the September/October/December rows — and it follows from AC3's archival framing. It is the story's one behavioral change beyond the added fields; apply it in both `loadTrips` and `handleTripCreated`, ideally by extracting the comparator once, and record it in Dev Agent Record.
  - [x] **Do not render the mockup's "4 von 4 Reisen angezeigt" footer line.** There is no pagination or filtering on this screen, so "N of N" carries zero information — `EXPERIENCE.md`'s redundant-stat-removal principle applies. Note the omission.
- [x] Task 5: Loading, empty, and error states. (AC: 4)
  - [x] Loading: replace the single generic `Paper`+`Skeleton` block (`TripsDashboard.tsx:127-135`) with **trip-row-shaped skeletons** — 3 rows, each matching the real row's grid (96px square block + two text lines + pill + cost). `EXPERIENCE.md.State Patterns` "Cold load" is explicit that the skeleton must be "a skeleton silhouette matching its own layout… rather than a generic spinner", and it names `trip-row` shapes. Do not introduce a spinner.
  - [x] Empty state: keep the existing copy and action (`trips.dashboard.empty` + a secondary "Add trip" button, `:137-148`) but move it onto the `card` shell (white, `1px solid` `tokens.borderStrong`, `borderRadius: "8px"`, `padding: "18px"`) — flat and bordered, no `elevation`, no `borderRadius: 3`. Keep the button (a second `/add trip/i` match is expected; the tests use `getAllByRole`/`findAllByRole` and take `[0]`, so both must stay reachable).
  - [x] Error: leave the top `Alert severity="error"` behavior as-is. `EXPERIENCE.md`'s save-failure pattern is flagged "not pixel-mocked — minimal convention only" and no AC covers it; 7.3 drew the same boundary. Do not redesign error surfaces here.
  - [x] `handleTripCreated` (`:91-105`) must populate the three new fields for the optimistically-inserted trip, since `POST /api/trips` does not return them: `openDayCount: response.dayCount`, `planItemCount: 0`, `plannedCostTotal: 0`. A brand-new future-dated trip then derives to `upcoming` via Task 3's rule 2 — which is the correct, non-alarming first impression, and the reason that rule exists. Verify this specific path in the browser check; the existing "closes the dialog and updates the list" test walks it.
- [x] Task 6: i18n. (AC: 1)
  - [x] Every string goes through `t()`/`formatMessage()`; add each new key to **both** `src/i18n/en.ts` and `src/i18n/de.ts` (flat-key convention, near the existing `trips.dashboard.*` block at `:82-88`). New keys: `trips.dashboard.subline` (`{tripCount}`, `{gapTripCount}`), `trips.dashboard.statActiveTrips`, `trips.dashboard.statTotalCost`, `trips.dashboard.statOpenItems`, `trips.dashboard.statusGap` (`{count}`), `trips.dashboard.statusGapOne`, `trips.dashboard.statusPlanned`, `trips.dashboard.statusUpcoming`, `trips.dashboard.statusPast`, `trips.dashboard.costSoFar`, `trips.dashboard.costTotal`, `trips.dashboard.openTripAria` (`{trip}`).
  - [x] Reuse rather than mint: `trips.dashboard.addTrip`, `trips.dashboard.title`, `trips.dashboard.empty`, `trips.dashboard.loadError`, `trips.dashboard.dayCount`, `trips.page.title`. **`trips.page.subtitle` becomes orphaned** by Task 2's header deletion (grep confirms `page.tsx:24` is its only call site) — delete it from both dictionaries. 7.2's review found dead keys left behind after exactly this kind of rename; leaving orphans is a finding.
  - [x] German copy comes from the mockup verbatim where it exists: "Vollständig geplant", "Bevorstehend · Planung offen", "Abgeschlossen", "N Tage offen"/"1 Tag offen", "Kosten bisher", "Kosten gesamt", "Neue Reise", "Aktive Reisen", "Kosten bisher (alle Reisen)", "Offene Punkte". English is a straight translation in the same register (`EXPERIENCE.md.Voice and Tone`: concrete, non-corporate).
- [x] Task 7: Tests. (AC: 1, 2, 3, 4)
  - [x] **`test/tripsDashboard.test.tsx` renders under `I18nProvider` only, with no `ThemeProvider`** (`:68-71` and three more sites). The moment this component reads `theme.palette.tokens.*` every test in the file throws under MUI's bare default theme. Switch all four renders to the shared `renderWithProviders`/`Providers` helper (`test/helpers/renderWithProviders.tsx`) — this is the same trap 7.3 hit with `tripDayMapPanel.test.tsx`. Do this **first**; otherwise every other failure in the file is noise.
  - [x] Extend the file's `mockTripsResponse` (`:9-12`, currently an empty list) with fixtures covering all four states, including the new fields. The four `/add trip/i` assertions and the "Autumn in Oslo" create-flow assertion must keep passing.
  - [x] Rewrite `:159-160` (`getByRole("img", { name: /autumn in oslo/i })` + `src` check) against `data-testid="trip-row-photo"`, preserving its intent: a trip with `heroImageUrl: null` renders the placeholder src. The alt is now empty by design (Task 4).
  - [x] New coverage — this screen has four tests today and is about to grow three data-driven states, so add: (a) each of the four statuses renders its expected pill text from a fixture (including `1 day open` singular vs `3 days open` plural); (b) a past trip's row carries `opacity: 0.78` **and** the "Total costs" label; (c) a gap trip's row carries the warn border/background; (d) the three stat cells compute correctly across a mixed fixture, with past trips excluded from active-trips and open-items; (e) the row is a single link to `/trips/{id}` with an accessible name naming the trip; (f) the cost figure renders currency-formatted (`€2,340.00`-class, not a bare number) with tabular figures.
  - [x] New `test/tripsListRoute.test.ts` for `GET /api/trips` — there is **no test for this route today**. Model it on `test/createTripRoute.test.ts` (real Prisma against the test DB, `createSessionJwt` for the session cookie, `NextRequest`, `beforeEach` deleteMany cleanup). Cover: the response key set (the deferred-work log records that a payload key-set test is what caught a missing field last time), `openDayCount` counting a blank-named accommodation as open, `plannedCostTotal` excluding a blank-named accommodation's cost while including plan-item costs, and that another user's trips are not returned.
  - [x] Run `npm test` (Vitest, from `travelplan/`), `npx tsc --noEmit -p .`, and `eslint` on the touched files. Report counts against the baseline commit (`57c438d`) established with `git stash` — there is a known pre-existing population (7.3 recorded 161 tsc errors and 8 eslint warnings against its own baseline; re-establish rather than assume, since Story 5.9 landed after it). Triage every failure as a stale assertion (fix it and say so) or a real regression (fix the code). Do not delete assertions in bulk.
  - [x] Manual browser check on a real dev server against a **throwaway** database — never `prisma/dev.db`, which holds Tommy's real trip data (the test suite already destroyed real uploads once; see deferred-work 2026-08-01). Seed four trips covering all four states plus one with no hero image, then verify: the four pills, the past row's opacity and cost label, the gap row's warn treatment, the three stat cells, the sub-line counts, sort order (past last), full-row click-through, keyboard focus ring, the create-trip dialog inserting an `upcoming` row without a refetch, and the placeholder image path.

## Review Findings

Code review 2026-08-01 (bmad-code-review, three parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 4 decision-needed, 12 patch, 5 deferred, 4 dismissed as noise. **All 4 decisions resolved and all 15 resulting patches applied** — see resolutions inline below and the deviations recorded in Dev Agent Record.

The Acceptance Auditor independently re-ran the suite and confirmed the Dev Agent Record's numbers (551/551, tsc 152 against a re-established baseline of 153, eslint 3 warnings / 0 errors), and verified the story's highest-risk claims as genuinely correct: the visible-cost rules in `listTripsForUser` mirror `getTripWithDaysForUser` verbatim so the list and overview figures cannot diverge; the query is a single `findMany`; every grid area is named in both templates; `trips.page.subtitle` is truly orphan-free; the four new icon paths match the mockup; and `ROW_GAP_BG`/`NEUTRAL_PILL_BG` are the only hex literals added.

### Decision needed (all resolved)

- [x] **RESOLVED — relaxed rule 2 to `start >= today`.** [Review][Decision] **A trip that starts *today* renders as a warn row** — `deriveTripStatus`'s rule 2 requires `start > today` (strictly future), exactly as Task 3 specifies. But a trip created with `startDate === today` has `openDayCount === dayCount` and `planItemCount === 0`, so it falls through to rule 3 and renders as an orange warn row saying "N days open" the instant it is created. `createTripSchema` has no future-date constraint, so this is directly reachable from the create dialog. It is the precise outcome `tripStatus.ts`'s own docstring says the ladder exists to prevent, and the comment at `TripsDashboard.tsx:130-133` asserts the opposite unconditionally ("a fresh trip … derives to `upcoming` rather than a warn row"). Neither test file covers `start === today`. **Resolution:** rule 2 now reads `start >= today`. This deviates from Task 3's literal text in favour of its stated intent — a trip created to start today is exactly as untouched as one created to start tomorrow. A trip already under way still falls through to rule 3, where open days are genuinely actionable. Covered by a new unit test (`start === today` → `upcoming`) and a new component test on the create path. [`src/lib/trips/tripStatus.ts:35`, `src/components/features/trips/TripsDashboard.tsx:130-133`]
- [x] **RESOLVED — `openItems` now counts `gap` trips only.** [Review][Decision] **"Open items" counts `upcoming` trips' days and turns the stat orange for a brand-new trip** — `openItems` sums `openDayCount` across all non-past trips (Task 2's literal wording), so an `upcoming` trip contributes its full `dayCount`. Creating any future trip immediately turns the top-level stat `warning.main` orange, re-introducing one component up exactly what rule 2 was built to prevent at the row level. It also contradicts the sub-line beside it: the test fixture reads "4 trips · 1 with open items" next to "Open items 11", where 8 of those 11 days belong to a trip the UI simultaneously says has no open items. Flagged by the dev in the Dev Agent Record as "worth a reviewer's eye" — confirmed by two independent layers. **Resolution:** `openItems` now sums `openDayCount` over `gap` trips only — the same population the sub-line reports. Deviates from Task 2's literal wording ("across non-past trips"); creating a future trip no longer turns the dashboard warn-orange, and the two numbers now measure different things (days vs. trips) over the same set. The stat-cell test expectation moved from 11 to 3 with the reasoning recorded in the test. [`src/components/features/trips/TripsDashboard.tsx:159-166, 298`]
- [x] **RESOLVED — "today" is now the viewer's local calendar day.** [Review][Decision] **"Today" is the UTC calendar day, not the viewer's** — `utcStartOfDay(new Date())` takes the UTC date. For a user at UTC−8, from 16:00 local onward a trip ending *today* satisfies `end < today`: it is labelled "Completed", dimmed to 0.78, dropped from `activeTrips`, switched to "Total costs", and sorted to the bottom — while the user is still on the trip. Positive offsets keep a finished trip active an extra day. Normalizing *stored* dates to UTC is right; using UTC to decide what "today" is for a human is a separate call. No test runs under a non-UTC `TZ`. **Resolution:** `utcStartOfDay` replaced by `startOfTodayUtc`, which reads the *local* calendar date and returns the corresponding UTC midnight. Stored dates stay UTC-normalized; only the definition of "today" is now the viewer's. Two new TZ-independent unit tests (constructed from local date parts) pin both directions of the offset. [`src/lib/trips/tripStatus.ts:23-25`, `TripsDashboard.tsx:76`]
- [x] **RESOLVED — deferred to a design-system contrast pass; no code change.** [Review][Decision] **Past-row `opacity: 0.78` drops 12px `inkSoft` text below WCAG AA** — the sub-line (`#6B675C` on `#FFFFFF`) composites to ≈`#8B8880` ≈ 3.4:1, under the 4.5:1 floor for normal text; the "Completed" pill fails the same way. `DESIGN.md` prescribes 0.78 as the whole past-row treatment, so the code is spec-compliant and the conflict is in the design system. Joins the existing `inkMuted` contrast finding. **Resolution:** left spec-compliant at 0.78. Root cause is a `DESIGN.md` token conflict, not this screen — same class as the `inkMuted` contrast finding already carried from 7.2's review. Both should be resolved together in a design-system contrast pass rather than one screen at a time; appended to `deferred-work.md`. [`src/components/features/trips/TripsDashboard.tsx:399`]

### Patch (all applied)

- [x] [Review][Patch] Stat strip and sub-line render fabricated zeros during cold load and, permanently, after a load failure — both blocks sit outside the `{loading}`/`{error}` guards and read straight off `trips`, which the `catch` resets to `[]`; a failed fetch shows "Active trips 0 / €0.00 / Open items 0" directly under "Unable to load trips" [`src/components/features/trips/TripsDashboard.tsx:271, 278-301`]
- [x] [Review][Patch] No hover state was authored for the rebuilt `trip-row` — Task 4 deleted the old `rgba(241,90,36,.08)` hover and did not replace it; `EXPERIENCE.md.Interaction Primitives` requires implementations to author hover/focus/active per the floor [`src/components/features/trips/TripsDashboard.tsx:378-404`]
- [x] [Review][Patch] The topbar/stat-strip literal padding stacks on `Container maxWidth="lg"`'s 24px gutter, so the page title indents 56px while the rows beneath it sit at 48px (the mockup has the title 16px to their *left*), and both horizontal rules stop at the gutter instead of bleeding to the frame [`src/app/(routes)/trips/page.tsx:9`, `TripsDashboard.tsx:257, 233`]
- [x] [Review][Patch] The `sm` 4-column row template activates at 600px but needs ~750px — at 600px the fixed tracks and gaps consume ~484px of ~518px, leaving ~34px for the `1fr` title column, so the trip name ellipses to two or three characters on portrait tablets and split-screen windows [`src/components/features/trips/TripsDashboard.tsx:315, 384`]
- [x] [Review][Patch] The German `upcoming` pill ("Bevorstehend · Planung offen", ≈214px with icon and padding) cannot fit the fixed 190px status track; with `whiteSpace: nowrap`, no `minWidth: 0` and `justify-content: flex-end` its background overflows leftward across the trip name [`src/components/features/trips/TripsDashboard.tsx:206-220, 471-486`]
- [x] [Review][Patch] `trips.dashboard.subline` has no singular form — a single-trip account (the state right after first create) reads "1 trips · 0 with open items" / "1 Reisen · …". This change added `statusGapOne` specifically because `formatMessage` has no plural support, then shipped the same defect in the adjacent new string [`src/i18n/en.ts`, `src/i18n/de.ts`]
- [x] [Review][Patch] The `+` glyph on the primary action ships at 20px, not the specified 15px — MUI's `ButtonStartIcon` emits `& > *:nth-of-type(1) { font-size: 20 }` at specificity (0,2,0), which beats the `sx` class on the `SvgIcon` root (0,1,0) regardless of injection order; verified in `@mui/material/Button/Button.js:67-68` [`src/components/features/trips/TripIcons.tsx:91`, `TripsDashboard.tsx:273`]
- [x] [Review][Patch] `formatCost.ts`'s docstring is false — it claims to be lifted out of `TripTimeline.tsx` "so the Trips List does not become a fourth copy", but `TripTimeline.tsx:147` still declares its own identical copy. There are now four `Intl.NumberFormat` currency formatters, and the file claiming to be the consolidation point is the newest one. Also correct the "goes stale at midnight inside a cached response" reasoning in `TripsDashboard.tsx:73-76` / `api/trips/route.ts` — that route sets no cache headers and declares no `revalidate`/`dynamic` [`src/lib/trips/formatCost.ts:10-12`]
- [x] [Review][Patch] List semantics are stripped — `list-style: none` on the `ul` drops the `list`/`listitem` roles in Safari/VoiceOver, and `display: grid` on each `li` removes the implicit `list-item` display in every engine; needs explicit `role="list"` / `role="listitem"` [`src/components/features/trips/TripsDashboard.tsx:362, 375`]
- [x] [Review][Patch] `todayUtc` is memoized with `[]`, so it is computed once per *mount*, not per render as Task 3 specified — a tab left open across UTC midnight keeps stale pills, a stale "Costs so far"/"Total costs" label, and a stale sort order even after a refetch [`src/components/features/trips/TripsDashboard.tsx:76`]
- [x] [Review][Patch] A missing hero file now renders a bare broken-image glyph — the diff removed the wrapping `Box`'s `rgba(0,0,0,0.04)` backdrop and changed `alt={trip.name}` to `alt=""`, and the placeholder branch only covers `heroImageUrl === null`, not a non-null URL whose file is gone. Add a background color (and `width`/`height` attributes to prevent layout shift) [`src/components/features/trips/TripsDashboard.tsx:413-437`]
- [x] [Review][Patch] Test hygiene and small cleanups: the "derives upcoming" test restores `mockCreateResponse`'s dates *after* its assertion, so a failure leaks a November-dated fixture into every later test (move to `beforeEach`, as `heroImageUrl` already is); `_count: { select: { days: true } }` is now a redundant subquery since `trip.days` is fully loaded (`trip.days.length` is in hand); `DAY_ROW_GAP_BG = ROW_GAP_BG` is a dead alias that leaves two names for one value [`test/tripsDashboard.test.tsx:210-218`, `src/lib/repositories/tripRepo.ts:437`, `TripTimeline.tsx:103`]

### Deferred (pre-existing or spec-sanctioned)

- [x] [Review][Defer] `trips.dashboard.dayCount` renders "1 days" / "1 Tage" for a one-day trip [`src/i18n/en.ts`, `de.ts`] — deferred, pre-existing key that Task 4 said to keep; newly conspicuous beside a correctly-singularized pill
- [x] [Review][Defer] `listTripsForUser` materializes every day, accommodation and plan item of every trip to produce three integers [`src/lib/repositories/tripRepo.ts:435-447`] — deferred, this `include` is exactly what Task 1 prescribed and alternatives were explicitly forbidden
- [x] [Review][Defer] Design-system color constants (`ROW_GAP_BG`, `NEUTRAL_PILL_BG`) are exported from an icon module [`src/components/features/trips/TripIcons.tsx:202-215`] — deferred, Task 4 sanctioned this location; `NEUTRAL_PILL_BG`'s own docstring concedes it wants a `theme.ts` token
- [x] [Review][Defer] The three new payload fields are non-optional and unvalidated while `updatedAt` right above them got a defensive `?` — a response missing them yields `€NaN` [`src/components/features/trips/TripsDashboard.tsx:39-45, 156, 523`] — deferred, reachability is thin (client and route deploy together, no cache headers on `GET /api/trips`)
- [x] [Review][Defer] Coverage gaps in an otherwise well-tested change: the `start → destination` route string (the only consumer of two new API fields) is never asserted as *rendered*; no test for the empty state, the error state and its zeroed stat strip, or a trip starting today [`test/tripsDashboard.test.tsx`] — deferred, no AC uncovered

### Dismissed as noise

`deriveTripStatus` has no unparseable-date guard (dates come from Prisma serialization); `statusPill` builds all four treatment objects per row (negligible); the stat grid lacks `minWidth: 0` (needs a €1M+ total at a narrow breakpoint); the ellipsed trip title has no `title` attribute (the overlay link's `aria-label` carries the full name).

## Dev Notes

### Scope boundary

This story owns the **Trips List** screen: `src/app/(routes)/trips/page.tsx` → `TripsDashboard.tsx`, plus the read path that feeds it (`GET /api/trips` and `listTripsForUser`). Do **not** touch:

- `TripTimeline.tsx` / `TripDayView.tsx` (Stories 7.2/7.3, both `done` — do not re-open their layouts). You will *import* from `TripIcons.tsx` and may *add* icons to it; that is the intended direction of reuse.
- `TripCreateDialog.tsx` / `TripCreateForm.tsx` internals — Story 7.7 owns that dialog's redesign. Its trigger lives on this screen and must keep working; its contents are someone else's story. It already picks up Story 7.1's theme-level `MuiDialog`/`MuiButton`/`MuiOutlinedInput` overrides, so it will not look broken.
- `TripShareDialog.tsx` (7.5), the auth screens (7.6).
- `getTripWithDaysForUser` and the `GET /api/trips/{id}` detail payload. You are *reading* its cost rules to mirror them, not editing them.
- `TripCostOverview.tsx`'s `formatCost` copy. It is a known three-way duplication with a deferred finding; consolidating it is not this story's job (lifting the helper into a shared module and using it here is fine — rewriting the cost route's rendering is not).

### The data gap is the story (read before Task 1)

7.2 and 7.3 were pure re-skins because their payloads already carried every number the mockups showed. This one does not: `GET /api/trips` returns no gap count and no cost, and AC1 requires both. That makes a repository + route change unavoidable, and it is the one place this story can go wrong in a way no amount of CSS review would catch.

Two rules keep it safe:

1. **Mirror the detail payload's cost rules exactly** (`tripRepo.ts:641-654`). "Visible" accommodation cost is conditional on a non-blank name — a stay row with a blank name contributes neither to the cost nor to "has accommodation". If you re-derive this from first principles, the trips list will disagree with the trip overview for the same trip, which is the single most damaging bug this screen can ship (`ux-design-specification.md`'s emotional-design principle: "Never make users reconcile data across views").
2. **One query, not N.** `days` with a narrow `select` on one `findMany` is a single round trip. Do not add a per-trip fetch, and do not call `getTripWithDaysForUser` in a loop — it does a raw `$queryRawUnsafe` per trip plus a full day/accommodation/plan-item/travel-segment tree, which is orders of magnitude more work than this screen needs.

### Two things not to "fix" while you are in this function

- **`listTripsForUser` filters `where: { userId }`, so shared trips do not appear on this list.** A user who was added as a Viewer or Contributor to someone else's trip (Stories 5.1/5.4/5.6) sees an empty dashboard and can only reach the trip by direct link. That is a real product gap, it is **not** in this story's ACs, and widening the filter would change what data leaves the API — with role-scoping consequences (`accessRole` isn't even in this payload). Leave it. If it bothers you, note it for the backlog in Dev Agent Record.
- **The `orderBy: { startDate: "asc" }` in the query stays.** Task 4's past-trips-last ordering is applied client-side, where "today" is known, alongside the existing client-side sort (`TripsDashboard.tsx:60-63`). Do not try to express it in SQL.

### The four states are under-specified — Task 3 resolves them, don't re-litigate

`EXPERIENCE.md.State Patterns` lists four pill treatments and calls them "fully data-driven", but never says where `upcoming` ends and `gap` begins, and the two overlap on a real dataset: the mockup's `upcoming` row is a future trip with €0 and no plan, which under a naive `openDayCount > 0` rule would render as a warn row. Task 3's precedence ladder is the resolution, and it is deliberately ordered so that:

- the warn treatment means "your plan has holes", never "you haven't started" — otherwise every newly created trip immediately screams for attention and the signal stops meaning anything (`DESIGN.md`: warn is "reserved exclusively for the gap/open-item state… never used decoratively");
- `past` outranks everything, per AC3.

Implement it as written. If a case genuinely doesn't fit (e.g. an in-progress trip whose dates straddle today), record the call in Dev Agent Record rather than inventing a fifth state — the design system has exactly four pills.

### Data available on this screen (verified, not assumed)

After Task 1, per trip: `id`, `name`, `startDate`, `endDate`, `dayCount`, `heroImageUrl`, `updatedAt`, `openDayCount`, `planItemCount`, `plannedCostTotal` (+ optionally the two location labels). That is everything Screen C's rows and stat strip need.

What genuinely does not exist, and must not be synthesized:
- **A user display name** — `User` has no `name` field. The mockup's "Willkommen zurück, Thomas" is not buildable (Task 2).
- **A multi-stop route string** — `Trip` has start/destination labels only; no intermediate waypoints (Task 4).
- **A per-trip currency** — `formatCost` hardcodes EUR everywhere in the app. Known debt, recorded in deferred-work; do not add a currency field here.

### Reference implementations to copy, not re-derive

Every visual pattern this story needs already exists in the codebase at the right token values. Read these before writing new `sx`:

| Pattern | Reference |
|---|---|
| Stat-strip cell (grid, borders, labelCaps, tabular value, warn-when-nonzero) | `TripTimeline.tsx:452-509` |
| Row as single navigation target (overlay link, `:has(:focus-visible)`, pointer-events dance) | `TripTimeline.tsx:600-638, 679-694` |
| Gap row treatment (warn border + `#FBF6EE` background) | `TripTimeline.tsx:100, 620-624` |
| Warn pill with icon (`day-row-gap-pill`) | `TripTimeline.tsx:695-713` |
| Square sharp-cornered leading photo | `TripTimeline.tsx:640-655` |
| Currency-aware `formatCost` | `TripTimeline.tsx:144-153` |
| `card` shell (flat, bordered, 8px, 18px padding) | `TripTimeline.tsx:765` |
| Shared icons / `SvgIcon` house style | `TripIcons.tsx:14-152` |
| Hero-URL cache busting | `TripsDashboard.tsx:178-185`, `withImageCacheBuster` |
| Route test harness (real Prisma, session JWT, `NextRequest`) | `test/createTripRoute.test.ts:1-46` |

### Typography traps

Custom typography variants (`display`, `heading`, `metricLg`, `cardTitle`, `kicker`, `labelCaps`) have **no `variantMapping`**, so `<Typography variant="display">` renders a `<span>` unless you pass `component=` explicitly. 7.2 shipped a page with one heading total because of this; 7.3 had to guard against it in every task. On this screen: the topbar title needs `component="h1"` and each trip name needs `component="h2"`. No existing test pins a heading level on this screen, so unlike Day Detail you are free to use the semantically correct levels — do so.

`tabular-nums` is a hard `DESIGN.md.Typography` rule for every numeric display and none of the custom variants carry it; set `fontVariantNumeric: "tabular-nums"` explicitly on the three stat values and the per-row cost.

### Responsive behavior

`EXPERIENCE.md` states this design pass mocked desktop only (~1080px). Follow the established resolution: pure-CSS MUI breakpoint objects in `sx` (`{ xs: …, sm: … }`), no `useMediaQuery` — 7.2's `data-layout` JS breakpoint re-derivation is a deferred finding ("duplicated source of truth"), do not replicate it in new code. The row collapses from `96px 1fr 190px 150px` to a two-column stack at `xs`, and the stat strip from 3 columns to 1. Name every grid area in both templates (Task 4).

### Accessibility floor

- Every status icon `aria-hidden` — the pill text always duplicates it (`EXPERIENCE.md` names these icons explicitly).
- Trip photo `alt=""` (decorative per `DESIGN.md.Photo Alt-Text`).
- The row's overlay link needs a real `aria-label` naming the trip; "open" alone is not a name.
- Visible keyboard focus on the row (`:has(:focus-visible)` outline) and on the primary button.
- 44px min-height on every interactive element — the theme already enforces it for `MuiButton`; verify the computed box on the "+ Neue Reise" button rather than assuming.
- No formal WCAG claim. `tokens.inkMuted` is known to fail AA at small sizes (deferred finding); prefer `tokens.inkSoft` for anything a user must read, which this story's spec already does everywhere except the trailing chevron.

### Project Structure Notes

Files expected to change:
- `travelplan/src/lib/repositories/tripRepo.ts` — `TripSummary` type + `listTripsForUser` query/derivation (Task 1).
- `travelplan/src/app/api/trips/route.ts` — serialize three new fields on `GET` (Task 1).
- `travelplan/src/app/(routes)/trips/page.tsx` — drop the header block, widen to `lg` (Task 2).
- `travelplan/src/components/features/trips/TripsDashboard.tsx` — primary rebuild: topbar, stat strip, status derivation, trip rows, states (Tasks 2–5).
- `travelplan/src/components/features/trips/TripIcons.tsx` — three new glyphs; possibly the shared gap-background constant (Tasks 3, 4).
- `travelplan/src/lib/trips/tripStatus.ts` — **optional new**; only if you extract the status helper (Task 3).
- `travelplan/src/i18n/en.ts`, `de.ts` — new keys, one orphan deleted (Task 6).
- `travelplan/test/tripsDashboard.test.tsx` — provider wrapper, fixtures, rewritten photo assertion, new coverage (Task 7).
- `travelplan/test/tripsListRoute.test.ts` — **new** (Task 7).

This matches `architecture.md`'s boundaries: data access only via `lib/repositories/*`, API surface only under `app/api/**/route.ts`, feature components under `components/features/*`, `{ data, error }` envelope, camelCase JSON, ISO-8601 UTC dates. No schema migration, no new dependency, and no validation-schema change is in scope — if one seems necessary, that is a signal the change belongs in a different story.

### References

- `_bmad-output/planning-artifacts/epics.md` → "Epic 7" → "Story 7.4: Trips List Redesign" (lines 1623-1643; Story/AC text above copied verbatim), plus 7.1–7.3 (the foundation) and 7.5–7.7 (explicitly out of scope). FRs covered: FR5, FR6 (`prd.md:220-221`); FR37 (`prd.md:279`, past trips as a read-only logbook) is the source of AC3's archival framing.
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — front-matter `colors`, `typography`, `rounded`, `spacing`, and `components.trip-row` (lines 146-153: 96px photo, `rounded.photo` 0, `rounded.md` row, warn border/`#FBF6EE` gap background, `opacity-past` 0.78), `components.photo-strip`, `components.button`, `components.stat-strip`, `components.card`, `components.badge-pill`; prose sections "Colors" (warn reserved for gaps), "Typography" (weight hierarchy, tabular-figures hard rule), "Elevation & Depth" (flat and bordered, no shadow in flow), "Shapes" (photo radius 0 without exception), "Components → trip-row" (line 241) and "→ badge/pill" (line 239, the four pill states and the German singularization rule), "Photo Alt-Text" (line 251, trip-row thumbnail is decorative), "Do's and Don'ts" (44px floor, no new decorative warn usage).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md` — "Information Architecture" (line 31: Trips List is the post-login landing surface), "Component Patterns" (line 67 photo-strip uniform-square rule, line 68 `trip-row` whole-row navigation + data-driven state, line 74 redundant-stat removal), "State Patterns" (line 80 gap mirroring at trip level with "N Tage offen", line 83 the four status variants, line 84 read-only past trip, line 85 cold-load skeleton convention, line 86 error-banner convention flagged not-mocked), "Interaction Primitives" (line 90 full-row click-through, line 95 hover/focus states unspecified — author them per the floor), "Accessibility Floor" (lines 103-107: keyboard operability, visible focus, colour-never-alone, 44px, `aria-hidden` on trip-status icons), "Key Flow 3" (line 138: Konni lands on the Trips List and reads the status pill + cost figure before opening the trip).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/mockups/trips-list-share-login.html` — Screen C markup at lines 448-532 and its CSS at lines 100-217 (`.topbar`/`.page-kicker`/`.page-title`/`.page-sub` :103-113, `.primary-btn` :115-129, `.stat-strip`/`.stat-cell` :146-154, `.trip-row` :162-174, `.trip-photo` :179-191, `.trip-name`/`.trip-meta` :193-194, `.trip-status` + its three state modifiers :196-211, `.trip-cost` :213-215, `.empty-hint` :217). The four status icon paths are at :484, :497, :510, :523.
- `_bmad-output/implementation-artifacts/7-2-trip-overview-redesign.md` and `7-3-day-detail-redesign.md` — read both **Review Findings** / **Dev Agent Record** sections before starting. They encode rules this story must re-apply rather than rediscover: explicit `component=` on custom typography variants, `tabular-nums` on numeric displays, `:last-child` dividers over per-row hardcodes, the `Providers` test-harness requirement, safe `url()` interpolation, no new hex literals, the named-grid-area overflow bug, and the pointer-events technique for a full-row link.
- `_bmad-output/implementation-artifacts/deferred-work.md` — "Deferred from: code review of 7-2/7-3" (hardcoded-literal debt, `formatCost` three-way divergence, `inkMuted` contrast, `data-layout` duplication) and "Fixed during: hero-image investigation (2026-08-01)" (why `withImageCacheBuster` must stay on the read path, and why the browser check must use a throwaway database).
- `travelplan/src/components/features/trips/TripsDashboard.tsx` (208 lines — read in full; every current-state line reference above is from this file at the baseline commit), `TripTimeline.tsx` (the reference implementation for nearly every pattern here), `TripIcons.tsx`, `src/theme.ts` (token/variant source), `src/i18n/en.ts`/`de.ts:82-88`.
- `travelplan/src/lib/repositories/tripRepo.ts:22-38` (`TripSummary`), `:417-432` (`listTripsForUser`), `:641-654` (the visible-cost rules to mirror), `:669-682` (`missingAccommodation` derivation); `src/app/api/trips/route.ts:75-99`; `prisma/schema.prisma` (`Trip`, `User` — confirms no user name field and no intermediate route stops).
- `travelplan/test/tripsDashboard.test.tsx` (162 lines — the four existing contracts to preserve or deliberately update), `test/createTripRoute.test.ts` (route-test harness to model the new route test on), `test/helpers/renderWithProviders.tsx`.
- `_bmad-output/planning-artifacts/architecture.md` — "API & Communication Patterns" (REST, `{ data, error }` envelope), "Structure Patterns" / "Format Patterns" (camelCase JSON, ISO-8601 UTC), "Architectural Boundaries" (repositories are the only data access, `components/features/*`).

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-opus-5[1m]) — bmad-dev-story workflow.

### Implementation Plan

Red-green-refactor, one task at a time, in the story's order.

1. **Task 1 (data).** Wrote `test/tripsListRoute.test.ts` first — it failed on the three missing fields, confirming the gap the story describes. Widened `listTripsForUser` with a single `include` carrying `days → { accommodation: { name, costCents }, dayPlanItems: { costCents } }`, derived the three numbers in the mapper, and serialized them in `GET /api/trips`. The visible-cost rule (`name.trim().length > 0`) is expressed once as `hasVisibleAccommodation` and reused by both `openDayCount` and `plannedCostTotal`, so the two cannot drift from each other or from `getTripWithDaysForUser`.
2. **Task 3 (status) before Tasks 2/4.** Extracted `deriveTripStatus` into `src/lib/trips/tripStatus.ts` with its own unit test rather than inlining it, because the precedence ladder is the one piece of genuinely new logic in this story and its boundaries (past-outranks-gap, upcoming-vs-gap, trip-ending-today) are cheaper to pin directly than through rendered pill text.
3. **Tasks 2, 4, 5 (component).** Rebuilt `TripsDashboard.tsx` in one pass — topbar, stat strip, trip rows, skeleton/empty states — copying the referenced patterns from `TripTimeline.tsx` rather than re-deriving them.
4. **Tasks 6, 7.** i18n keys landed alongside the component; then the four existing dashboard tests were moved onto `renderWithProviders` and the file grew to 15 tests. Finished with the full suite, tsc, eslint, and a browser check on a throwaway database.

### Judgment calls and documented decisions

- **Included the two location labels in the payload.** Task 4 offered this as optional ("select the two fields in Task 1's query if you do"). Taken: the meta sub-line now reads `Sep 12, 2026 - Sep 14, 2026 · 3 days · Lisbon → Algarve` when both labels are non-empty, which is as close to the mockup's route line as the data model honestly allows. No multi-stop route was synthesized.
- **No "Willkommen zurück, Thomas" greeting** (Task 2 deviation, as instructed). `User` has no name field. The `h1` is `trips.dashboard.title`; the kicker above it is `trips.page.title`.
- **Sort order changed** (the story's one sanctioned behavioral change): non-past trips ascending by `startDate`, then past trips descending. Extracted as `buildTripComparator(todayUtc)` and used by both `loadTrips` and `handleTripCreated`.
- **Cell 3 "Open items" sums open days across *all* non-past trips**, per Task 2's wording — which means an `upcoming` trip's untouched days count toward it. On the browser fixture that reads 5 (2 from the gap trip + 3 from the unplanned one) while the sub-line reads "1 with open items". The two numbers are deliberately different and each is labelled for what it is, but it is worth a reviewer's eye: an unplanned future trip inflates a warn-coloured number without having a warn-coloured row.
- **Omitted the mockup's "4 von 4 Reisen angezeigt" footer** (instructed) **and its "Alle Reisen" section label** (not requested by any task; a section heading above the only list on the page carries no information — same redundant-stat reasoning).
- **Kept the trailing `ChevronRightIcon`** although the mockup omits it, per Task 4's instruction to note it as a judgment call.
- **`DAY_ROW_GAP_BG` moved rather than duplicated.** `ROW_GAP_BG` now lives in `TripIcons.tsx`; `TripTimeline.tsx:100` aliases it (a one-line import change — no layout in that file was touched). `NEUTRAL_PILL_BG = "#F1ECE1"` is the single new literal this story adds, defined once with a mockup line reference.
- **`formatCost` lifted to `src/lib/trips/formatCost.ts`** as a pure `(cents, language)` function and consumed here. `TripTimeline.tsx`, `TripDayView.tsx` and `TripCostOverview.tsx` were deliberately left on their own copies, per the scope boundary — the three-way duplication is unchanged, not worsened.
- **Two focus rings on a focused row.** The overlay link keeps Chrome's default ring *and* the row draws the accent `:has(:focus-visible)` outline, so a keyboard-focused row shows both. This is exactly the behaviour Story 7.2's day rows already have; suppressing one here would have made the two surfaces inconsistent. Visible focus is satisfied either way.
- **`listTripsForUser` still filters `where: { userId }`**, so a Viewer/Contributor on someone else's trip sees an empty dashboard and can only reach that trip by direct link. Left untouched as instructed — **noted here for the backlog**, since it is a real product gap with role-scoping consequences (`accessRole` is not in this payload at all).

### Deviations introduced by the code review (2026-08-01)

Three sanctioned deviations from the story text, all decided by Tommy during review triage. Each changes behavior the ACs do not pin, and each is covered by a new test.

- **Task 3, rule 2 now reads `start >= today`, not `start > today`.** As written, a trip created to start *today* had `openDayCount === dayCount` and `planItemCount === 0` but failed the strict `>`, fell through to rule 3, and rendered as a warn row the instant it was created — the exact outcome the ladder exists to prevent, and reachable from the create dialog since `createTripSchema` has no future-date constraint. The spec's intent ("warn always means holes in a plan, never absence of a plan") wins over its literal text. A trip already under way still falls through to rule 3.
- **Task 2's "Open items" cell now counts `gap` trips only, not all non-past trips.** The literal wording made an `upcoming` trip contribute its whole `dayCount`, so creating any future trip turned the cell `warning.main` orange — re-introducing at the stat level exactly what rule 2 prevents at the row level. It also made the cell and the sub-line beside it count over different populations, which is what the original implementation note flagged for a reviewer's eye. Both now report the same set of trips; they still measure different things (days vs. trips), each labelled for what it is.
- **"Today" is now the viewer's local calendar day, not the UTC one.** `utcStartOfDay` became `startOfTodayUtc`, which reads local date parts and returns the corresponding UTC midnight. Stored trip dates remain UTC-normalized and every formatter still passes `timeZone: "UTC"` — only the question "which calendar day is today" is now answered from the viewer's clock. Previously a user at UTC−8 saw a trip they were still on marked "Completed", dimmed and sorted last from 16:00 local onward.

Also changed without altering behavior: the 4-column row and 3-column stat templates now activate at `md` rather than `sm` (their fixed tracks need ~750px, so at the 600px `sm` boundary the title column collapsed to ~30px), and the status track is `auto` rather than a fixed 190px (the German `upcoming` label is wider than 190px and, being `nowrap`, spilled its pill background across the trip name).

### Debug Log References

- **Baseline at `57c438d`:** 527 tests / 89 files passing, 153 `tsc` errors, 2 eslint warnings across the files this story touches (both in `TripsDashboard.tsx`, both on the deferred-work list).
- **After:** 551 tests / 91 files passing, 152 `tsc` errors, 3 eslint warnings / 0 errors. No new failures, no new type errors, no new lint findings. The third eslint warning is `TripTimeline.tsx:205` (`react-hooks/set-state-in-effect`), pre-existing and already deferred — it only appears now because that file joined the lint set.
- **One stat-strip assertion was written wrong and corrected, not the code:** the first draft expected "Open items" to be 3 (the gap trip's days only). Task 2 specifies the sum across *non-past* trips, so the unplanned trip's 8 days count too; the expectation was fixed to 11 and the reasoning recorded in the test.
- **Browser check** ran against a throwaway SQLite database in the session scratchpad. Tommy's dev server on :3000 and `prisma/dev.db` were never touched — a second `next dev` refuses to start in the same directory, so the check ran from a disposable copy of the app on :3311, deleted afterwards. `prisma/dev.db` and `public/uploads` verified unmodified after the run.

### Completion Notes List

- **AC1 satisfied.** Each trip renders as a `trip-row`: 96px square center-cropped photo at `border-radius: 0`, name (`h2`), date-range/day-count/route meta line, a `trip-status` pill in one of four states, and a cost-so-far figure with tabular figures. Verified in the browser at 1200px and 390px.
- **AC2 satisfied.** A trip with `openDayCount === 0` renders "Fully planned", not the gap state — covered by a unit test on the helper, a component test, and the browser fixture (City break Copenhagen).
- **AC3 satisfied.** A past trip renders at `opacity: 0.78` with the "Total costs" label and the "Completed" pill; `past` outranks `gap` in the precedence ladder, so a finished trip with open days still reads as archival (Tuscany fixture has 2 open days and renders `past`). Past trips are excluded from the active-trips and open-items stat cells and sort last.
- **AC4 satisfied.** Create a trip, open a trip, and hero-image display all still work. Verified in the browser: the create dialog inserts the new row with **no refetch** (`GET /api/trips` count stayed at 1) and it derives to `upcoming`; a click anywhere on a row navigates to `/trips/{id}`; the placeholder resolves for a trip with no hero, and `withImageCacheBuster` is still on the read path.
- Accessibility floor: every pill icon `aria-hidden`, photo `alt=""`, one link per row with `aria-label` "Open trip {name}", 44px computed height on the primary button (measured 44.5px), visible keyboard focus on the row, no horizontal document overflow at either breakpoint. Heading order on the page is `h1` → `h2` per row.
- Orphaned key `trips.page.subtitle` deleted from both dictionaries (its only call site was the deleted page header). All 12 new keys added to `en.ts` and `de.ts`; German copy taken verbatim from the mockup, with the gap pill singularized through a separate `statusGapOne` key.

### File List

| Status | Path |
|---|---|
| M | `travelplan/src/lib/repositories/tripRepo.ts` |
| M | `travelplan/src/app/api/trips/route.ts` |
| M | `travelplan/src/app/(routes)/trips/page.tsx` |
| M | `travelplan/src/components/features/trips/TripsDashboard.tsx` |
| M | `travelplan/src/components/features/trips/TripIcons.tsx` |
| M | `travelplan/src/components/features/trips/TripTimeline.tsx` (import only — `DAY_ROW_GAP_BG` now aliases the shared `ROW_GAP_BG`) |
| A | `travelplan/src/lib/trips/tripStatus.ts` |
| A | `travelplan/src/lib/trips/formatCost.ts` |
| M | `travelplan/src/i18n/en.ts` |
| M | `travelplan/src/i18n/de.ts` |
| M | `travelplan/test/tripsDashboard.test.tsx` |
| A | `travelplan/test/tripsListRoute.test.ts` |
| A | `travelplan/test/tripStatus.test.ts` |
| M | `_bmad-output/implementation-artifacts/sprint-status.yaml` |

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev.
- 2026-08-01: Code review (bmad-code-review, 3 parallel layers). 4 decisions resolved, 15 patches applied, 6 deferred, 4 dismissed. 556/556 tests passing (+5), tsc 152 (unchanged, none in touched files), eslint 3 warnings / 0 errors (unchanged). Status: done.
- 2026-08-01: Implemented Tasks 1–7 (dev-story). `GET /api/trips` extended with `openDayCount`, `planItemCount`, `plannedCostTotal` and the two location labels; Trips List rebuilt as topbar + stat strip + `trip-row`s with four data-driven status states; past-trips-last ordering added; `tripStatus` and `formatCost` extracted as shared pure helpers; 24 tests added across three files. 551/551 passing. Status: review.
