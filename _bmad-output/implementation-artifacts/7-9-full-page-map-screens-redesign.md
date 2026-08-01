---
baseline_commit: b18997c
---

# Story 7.9: Full-Page Map Screens Redesign — Day Route Map and Trip Route Map

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the two full-page map screens — the day route map and the whole-trip route map — to match the approved design,
so that enlarging a map keeps me inside the same product instead of dropping me onto a dark, pre-redesign screen.

## Acceptance Criteria

1. Given both map pages hardcode `backgroundColor: "#2f343d"` — a dark slate absent from the token palette, so enlarging a map inverts the app's entire value scheme mid-flow — when each page shell is restyled, then both use the same token page shell as the screen they were opened from (`trips/[id]/page.tsx` and `trips/[id]/days/[dayId]/page.tsx`), and no hardcoded hex value remains in either page component.
2. Given `TripDayMapBackButton.tsx` is shared by both pages and hardcodes `color: "#f3f6fb"` on a bare unpadded text `Button`, when it is restyled, then it uses token colors and meets the 44×44px touch-target floor, and continues to preserve its existing `history.length` back-vs-push behavior; **and** the day-map page's label is corrected: it currently renders `trips.dayView.back` ("← Back to trip") while actually navigating to the day, not the trip — the copy must name where the button goes.
3. Given each screen wraps its map in `Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}`, a 24px-radius elevated surface against the 8px flat-bordered `card` idiom used everywhere else, when each is restyled, then the container matches the `card` treatment (`tokens.card`, `tokens.borderStrong`, 8px radius, `card-padding`) using a `Box` rather than a `Paper`, per the `MuiPaper` border-override constraint established in Stories 7.3 and 7.8; **and** the map title moves from `Typography variant="h6"` to the `label-caps` card-label in `tokens.inkSoft` — each screen renders the same i18n string as the preview panel it enlarges (`trips.dayView.mapTitle`, `trips.overviewMap.title`), so the two must not render it in two different type styles.
4. Given the missing-location list, the routing-unavailable notice, and the no-locations empty state on each screen, when they are restyled, then each matches the treatment already shipped in its corresponding preview panel rather than introducing a second one, and the raw `borderColor: "divider"` in the empty state is replaced with `tokens.border`.
5. Given the marker-detail dialog and the fullscreen photo viewer rendered by both screens, when the screens are redesigned, then they are left to inherit Story 7.1's theme-level `MuiDialog` overrides and are **not** restyled here — dialog surfaces belong to Story 7.7, and the `MiniImageStrip` keyboard-access defect recorded in `deferred-work.md` stays deferred rather than being folded into a visual story.
6. Given existing functionality on both screens (route polyline with Google-routing fallback, clickable place markers, missing-location reporting, accommodation and plan-item image loading), when the screens are redesigned, then all of it continues to work unchanged — this story is visual only.

## Tasks / Subtasks

- [ ] Task 1: Restyle the two page shells. (AC: 1)
  - [ ] `src/app/(routes)/trips/[id]/map/page.tsx:17` and `src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx:17` — delete `backgroundColor: "#2f343d"` from the wrapper `Box`, leaving `sx={{ minHeight: "100vh" }}`. That is the whole change: `globals.css` already paints `body { background: var(--color-paper) }` (`#F7F4EC`), which is exactly what `trips/[id]/page.tsx:16` relies on. Keep the `Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}` and the `gap={3}` column as-is — they already match both parent screens.
  - [ ] **Do not** reach for `sx={(theme) => ...)}` or `useTheme()` here. Both files are `async` React Server Components and every MUI component is `"use client"`; a function `sx` prop crossing that boundary is a serialization error, not a style bug. If a theme value is ever genuinely needed in one of these two files, use a palette *key string* (`backgroundColor: "background.default"`), which is a plain string and serializes. For this story no value is needed at all.
  - [ ] Grep both files for `#` afterwards — AC1's wording is absolute ("no hardcoded hex value remains in either page component") and these two files have exactly one hex each today.
- [ ] Task 2: Restyle the shared back button and fix the day-map label. (AC: 2)
  - [ ] `TripDayMapBackButton.tsx:25` — remove `color: "#f3f6fb"` from the `sx` entirely, keeping `alignSelf: "flex-start"`. Dropping the override makes it inherit MUI's text-button default (`primary.main` = accent `#4B6358`), which is precisely what the sibling back button on `trips/[id]/page.tsx:20` renders. Do not substitute a different token to "be explicit" — two back buttons on adjacent screens must not resolve to two colors.
  - [ ] **The 44px floor is already satisfied — verify, don't re-add it.** `theme.ts:253-260` sets `MuiButton.root { minHeight: 44, paddingInline: 20, paddingBlock: 10 }` for every variant including `text`. The epic's "bare unpadded text `Button`" description predates Story 7.1. Confirm the computed box in dev tools and record the finding; adding a redundant `minHeight: 44` to the `sx` is noise.
  - [ ] **Do not touch `handleClick`.** The `typeof window === "undefined"` guard → `window.history.length > 1 ? router.back() : router.push(href)` chain is the behavior AC2 explicitly preserves. It is also the reason this is a `Button` with an `onClick` and not a `next/link` — do not "improve" it into a `Link`.
  - [ ] Add **one new i18n key** to both `src/i18n/en.ts` and `src/i18n/de.ts`: `trips.dayView.mapBack` — EN `"← Back to day"`, DE `"← Zurück zum Tag"`. Point `days/[dayId]/map/page.tsx:20` at it.
  - [ ] **You cannot fix this by editing `trips.dayView.back`.** That key is shared: `TripDayView.tsx:1644` (not-found card) and `:1771` (hero back link) both use it and both genuinely navigate to the trip, and `test/tripDayViewLayout.test.tsx:1606` pins the exact string `"← Back to trip"`. Changing the value breaks a correct call site and a passing test. A new key is the only correct move.
  - [ ] `trips.overviewMap.back` ("Back to trip overview" / "Zurück zur Reiseübersicht") is already correct copy and stays. It is the one back label with no `←` glyph while its new sibling has one; adding `← ` to both dictionaries for parity is a reasonable call since the two buttons are now visually identical — decide, do it or don't, and say which in Dev Agent Record rather than leaving it unremarked.
- [ ] Task 3: Restyle `TripDayMapFullPage.tsx` onto the `card` shell. (AC: 3, 4, 6)
  - [ ] Add `useTheme` and read `const tokens = theme.palette.tokens;`, matching `TripDayMapPanel.tsx:47-48`.
  - [ ] Replace all three `Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}` wrappers — loading (`:356`), not-found (`:367`), and main (`:384`) — with a `Box` carrying the card treatment: `backgroundColor: tokens.card`, `border: "1px solid"`, `borderColor: tokens.borderStrong`, `borderRadius: "8px"`, `padding: "18px"`. Copy the shape verbatim from `TripDayMapPanel.tsx:52-59` (identical to `TripDayView.tsx:1114-1120`'s `cardSx`). **`Box`, not `Paper`** — `theme.ts:245-252` stamps `border: 1px solid rgba(17, 18, 20, 0.08)` on every `Paper`, which would layer a non-token rule over `borderStrong`. This is the same constraint 7.3 and 7.8 worked under.
  - [ ] Drop `Paper` from the `@mui/material` import once the last use is gone, or lint will flag it.
  - [ ] Title (`:386-388`): `Typography variant="h6" fontWeight={600}` → `variant="labelCaps" component="h1"` with `sx={{ color: tokens.inkSoft }}`. Keep the `trips.dayView.mapTitle` key ("Day map" / "Tageskarte") unchanged — AC3 requires the same string the preview panel renders.
  - [ ] **`component=` is mandatory and `h1` is deliberate** — see Dev Notes → "Heading level on a screen that has no title".
  - [ ] Not-found branch (`:369`): `variant="h6" fontWeight={600}` → `variant="heading" component="h1"` in `tokens.ink`, matching `TripDayView.tsx:1637`'s not-found card. Keep `trips.dayView.notFoundTitle` / `notFoundBody`.
  - [ ] Empty state (`:391-412`): `borderRadius: 2` → `"6px"`, `borderColor: "divider"` → `tokens.border`. Everything else (dashed 1px, centered column, the two `Typography` lines, the copy keys) already matches `TripDayMapPanel.tsx:88-109` — leave it alone. Keep `minHeight: FULL_PAGE_MAP_HEIGHT` here; the panel's fixed `height: 150` is the preview footprint, not this one.
  - [ ] Map wrapper (`:414`): `borderRadius: 2` → `"6px"`, matching `TripDayMapPanel.tsx:111`.
  - [ ] Routing-unavailable notice (`:424-433`) and missing-locations list (`:435-449`) are **already byte-identical** to `TripDayMapPanel.tsx:145-170`, including the `warning.main` text and the `Chip color="warning"`. AC4 is already satisfied for these two — verify by diffing the two blocks, then leave them untouched and say so. Warn is correct here: a missing location *is* an open item.
  - [ ] `FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)"` (`:73`) was tuned against the old chrome. Card padding drops 24px→18px and the title shrinks from h6 to 10.5px caps, so the map gains roughly 20–30px of room. Re-check in the browser (Task 8); adjust the constant only if the page actually scrolls or leaves a dead band, and record the before/after value if you change it.
- [ ] Task 4: Restyle `TripOverviewMapFullPage.tsx` onto the `card` shell. (AC: 3, 4, 6)
  - [ ] Same `useTheme` / `tokens` setup, same `Paper` → card `Box` replacement on all three wrappers — loading (`:120`), not-found (`:131`), main (`:143`). Note these three additionally carry `background: "#ffffff"`: that literal goes with the `Paper`, replaced by `tokens.card`. It is the same value, but AC1's no-hex rule and 7.2's standing hardcoded-literal debt both say it should not be spelled out here.
  - [ ] **Title swap (`:145-154`)**: the header block currently renders `Typography variant="h5" fontWeight={700}` with `trips.overviewMap.fullPageTitle` ("Full trip map"), plus the trip name below it. AC3 requires the same string the preview panel renders → `variant="labelCaps" component="h1"` in `tokens.inkSoft` with `t("trips.overviewMap.title")` ("Route"), matching `TripOverviewMapPanel.tsx:41-43`.
  - [ ] **Keep the trip-name line** (`:149-153`). It is the only element on the page that names the trip, AC3 constrains the *title* only, and dropping it would be a silent information loss on a screen reachable by direct URL. Restyle it to `11.5px / 600` in `tokens.inkSoft` (the panel-caption rhythm used at `TripDayMapPanel.tsx:131-137`) so it reads as a subline under the caps label rather than competing with it.
  - [ ] Not-found branch (`:132`): `variant="h6"` → `variant="heading" component="h1"` in `tokens.ink`. Keep `trips.detail.notFoundTitle`.
  - [ ] Empty state (`:157-178`) and map wrapper (`:180`): same two edits as Task 3 — `borderRadius: 2` → `"6px"`, `borderColor: "divider"` → `tokens.border`. The loading skeleton (`:123`) carries a third `borderRadius: 2` — same fix. Its day-map counterpart (`TripDayMapFullPage.tsx:359`) has no radius at all; give it `sx={{ borderRadius: "6px" }}` so the two loading states match each other and `TripDayMapPanel.tsx:86`.
  - [ ] **Missing-locations list (`:190-204`) is the one place where this screen genuinely diverges from its panel.** `TripOverviewMapPanel.tsx:103-115` renders each label as a `Typography component={Link} href={item.href}` in `primary.main` with `textDecoration: "underline"` and `textUnderlineOffset: "2px"`; the full page renders the same items as plain `Typography`. AC4 says match the panel — so make them links. The data is already there: both call the same `buildTripOverviewMapData`, and `TripOverviewMissingLocation` carries `href` (`TripOverviewMapData.ts:48-52`), so this is a copy of the panel's JSX, not new plumbing.
  - [ ] Leave the `Chip label={t("trips.overviewMap.missingTag")} size="small" color="warning"` exactly as-is — identical in both, and warn is the correct reservation for an open item.
- [ ] Task 5: Retire the orphaned title key. (AC: 3)
  - [ ] `trips.overviewMap.fullPageTitle` has exactly one call site (`TripOverviewMapFullPage.tsx:147`), which Task 4 removes. Re-run `grep -rn "overviewMap.fullPageTitle" src/ test/` to confirm zero hits, then delete it from **both** `src/i18n/en.ts:334` and `src/i18n/de.ts:333`. Deleting orphans from both dictionaries is the convention 7.3 set and 7.8 followed; 7.2's review found dead keys left behind after a rename.
  - [ ] Net i18n change for this story: **+1** (`trips.dayView.mapBack`), **−1** (`trips.overviewMap.fullPageTitle`). Nothing else. Every other string these screens render already exists and is shared with the preview panels — do not introduce a parallel `…fullPage…` variant of any of them.
- [ ] Task 6: Repair the two full-page test files, which will otherwise start throwing. (AC: 6)
  - [ ] `test/tripDayMapFullPage.test.tsx:96-100`, `:180-184` and `test/tripOverviewMapFullPage.test.tsx:90-94`, `:162-166` all render with a bare `<I18nProvider>` and **no `ThemeProvider`**. The moment these components read `theme.palette.tokens.*`, MUI's default theme has no `tokens` object and every render throws on `undefined`. Switch all four renders to `renderWithProviders` (`test/helpers/renderWithProviders.tsx`). This is the third story in a row to hit this exact trap (7.3 on `tripDayMapPanel.test.tsx`, 7.8 on `tripBucketListPanel.test.tsx`) — it is listed here so it costs you a minute instead of a debugging session.
  - [ ] The four existing behaviors — day map renders its container, day marker click opens the plan-item dialog with its image, overview renders the chronological polyline and both popup kinds with correct `Open details` hrefs, overview keeps missing-location items visible while excluding them from the map — **must keep passing unchanged** apart from the provider swap. They are this story's regression canary for AC6.
  - [ ] Watch `test/tripOverviewMapFullPage.test.tsx:105` — `screen.getAllByRole("button")` grabs *every* button in the tree and indexes into it. Task 4 adds no buttons, but if your restyle introduces one the indices shift and the assertions silently target the wrong element. If that happens, narrow the query to `getAllByTestId(/^trip-map-marker-/)` rather than re-numbering the indices.
- [ ] Task 7: Add the coverage these two screens don't have. (AC: 1, 2, 3, 4)
  - [ ] `test/tripDayMapFullPage.test.tsx` — the card label renders as a **heading** with the accessible name `"Day map"` (`getByRole("heading", { name: "Day map" })`). This is AC3's mechanical assertion and it fails today, where the title is an `h6` reading the same string but would fail again if a future edit drops `component=` and silently renders a `<span>`.
  - [ ] `test/tripOverviewMapFullPage.test.tsx` — the card label renders as a heading named `"Route"`, the trip name `"Northern Route"` is still on screen, and `"Full trip map"` is **absent**. The name/label collision in the existing fixture is a coincidence — assert the heading role for `"Route"` and plain text presence for the trip name so the two cannot satisfy each other.
  - [ ] `test/tripOverviewMapFullPage.test.tsx` — extend the existing missing-locations test (`:120`): `"Unmapped museum"` resolves to a **link** with `href="/trips/trip-1/days/day-1?open=plan&itemId=item-1"`. That is Task 4's one behavioral change and the only AC4 item that is not pure CSS.
  - [ ] **New file** `test/tripDayMapBackButton.test.tsx` — the component has no test at all today. Mock `next/navigation`'s `useRouter` and cover: (a) the label prop renders as the button's accessible name; (b) with `window.history.length > 1`, clicking calls `router.back()` and not `router.push`; (c) with `history.length <= 1`, clicking calls `router.push(href)`. (b) and (c) are AC2's "continues to preserve its existing behavior" — the only part of this story that can break navigation. Render through `renderWithProviders`.
  - [ ] Optional but recommended, and the **only** mechanical check available for AC1: a static assertion that neither map `page.tsx` contains a hex literal. Both files are async RSCs and vitest cannot render them, so a source-text guard (`readFileSync` + `expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)`) is the alternative to eyeballing it. No test in this repo reads source files today, so this introduces a pattern — take it or leave it, but if you leave it, say in Dev Agent Record that AC1 is verified by grep and browser only.
  - [ ] Run `npx vitest run` from `travelplan/`. Triage every failure as either a stale assertion encoding a pre-redesign detail (fix the assertion, and say so) or a real regression (fix the implementation). Do not relax or delete assertions in bulk to get green. Then `npx tsc --noEmit -p .` and `eslint` over the touched files, reporting counts against the baseline the way 7.1–7.4 and 7.8 did — establish the baseline with `git stash push --include-untracked` first; there is a known pre-existing population (~161 tsc errors, ~9 eslint warnings) unrelated to this work.
  - [ ] `npm run build` must stay clean.
- [ ] Task 8: Manual browser check on a real dev server, against a **throwaway** database. (AC: 1, 2, 3, 4, 5, 6)
  - [ ] `prisma/dev.db` holds Tommy's own trip data. Stories 7.2, 7.3 and 7.8 all established seeding an isolated SQLite file on an isolated port as the precedent. Do not run against `dev.db`.
  - [ ] Reach both screens the way a user does — the expand icon in the Trip Overview sidebar (`TripTimeline.tsx:806` → `/trips/{id}/map`) and in the Day Detail sidebar (`TripDayView.tsx:2389` → `/trips/{id}/days/{dayId}/map`). Confirm the background no longer inverts on the way in, that the card reads as the same card as the preview it enlarged, and that the label-caps title lines up with the panel's.
  - [ ] Back button on **both** screens: readable against paper, ≥44px tall, returns to the correct screen, and the day-map one now says "Back to day". Test both branches — arriving via the expand icon (`history.length > 1` → `router.back()`) and by pasting the URL into a fresh tab (`push`).
  - [ ] Exercise, on both screens: a populated route with a Google-routed polyline; the routing-unavailable notice (block `/api/trips/*/days/*/route` in devtools); the missing-locations list (clear a location on one plan item) including the overview's new links; the no-locations empty state (a trip/day with no coordinates anywhere).
  - [ ] Click a marker on each screen and confirm the dialog opens with its content and images, and that the fullscreen photo viewer still works — then confirm you **did not** restyle either (AC5).
  - [ ] Check the map fills its container without the page scrolling, at ~1080px and at a short viewport, before deciding whether `FULL_PAGE_MAP_HEIGHT` needs the adjustment flagged in Task 3.

## Dev Notes

### Scope boundary

Visual/structural only, across five files:

- `src/app/(routes)/trips/[id]/map/page.tsx`, `src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx` — one line each (Task 1).
- `TripDayMapBackButton.tsx` — color + label wiring (Task 2).
- `TripDayMapFullPage.tsx`, `TripOverviewMapFullPage.tsx` — card shell, title, empty state (Tasks 3–4).
- `src/i18n/en.ts`, `src/i18n/de.ts` — one key added, one removed (Tasks 2, 5).

Do **not** touch:

- `TripDayMapPanel.tsx` and `TripOverviewMapPanel.tsx`. They are the *reference* for this story, shipped and reviewed in 7.2/7.3. If a value differs between panel and full page, the panel is right and the full page moves.
- `TripDayLeafletMap.tsx` / `TripOverviewLeafletMap.tsx` — marker icons, pin colors, tile layer, `fitBounds`. Both full pages and both preview panels share them, so any change here silently restyles four surfaces. No AC covers them.
- The marker-detail `Dialog` and the fullscreen photo viewer in both components (AC5). They already inherit `theme.ts:357-364`'s `MuiDialog` override; their internals are Story 7.7's.
- `MiniImageStrip` (`TripDayPlanItemContent.tsx:170-197`). Its keyboard-access defect is recorded in `deferred-work.md` under 7.3's review, which names this very file as one of the call sites and assigns the fix to a photo-viewer story. AC5 keeps it deferred — resist it.
- The `Alert severity="error"` banner at the top of both components (`TripDayMapFullPage.tsx:382`, `TripOverviewMapFullPage.tsx:141`). `EXPERIENCE.md` calls the error-banner treatment "not pixel-mocked — minimal convention only" and no AC covers it; 7.8 left the identical banner alone on Trip Overview.
- All data plumbing: `buildTripDayMapItems` / `buildDayMapPanelData` (`lib/trips/dayMapData.ts`), `buildTripOverviewMapData` (`TripOverviewMapData.ts`), the `/api/trips/{id}`, `/route`, `/accommodations/images` and `/day-plan-items/images` fetches, and the routing-fallback `useEffect` (`TripDayMapFullPage.tsx:219-267`). Nothing server-side changes. If a server change seems necessary, that is a signal the change belongs elsewhere.
- `TripDayView.tsx` / `TripTimeline.tsx`, apart from reading them for the expand hrefs. Stories 7.2/7.3 are `done` and 7.8 owns the overview's lower sections.

### Heading level on a screen that has no title (read before Tasks 3 and 4)

7.3's code review set the rule "card labels are title + 1" — Trip Overview's `h4` title gives `h5` labels, Day Detail's `h5` title gives `h6` labels. **Neither map screen has a title**, so the rule has no anchor here: the card label *is* the page's only heading. Render it `component="h1"` on both screens.

Two things this is not: it is not a font-size change (an `h1` at `label-caps`'s 10.5px is fine — heading level is document structure, not scale), and it is not a regression from today (the day map currently emits a lone `<h6>` and the overview map a lone `<h5>`, both floating with no ancestor heading — an outline defect either way). Record the decision in Dev Agent Record so a reviewer reads it as a call, not an oversight.

And the reason `component=` must be passed at all: Story 7.1's custom typography variants (`display`/`heading`/`metricLg`/`cardTitle`/`kicker`/`labelCaps`) have **no `variantMapping` entry** — custom variants never do — so `<Typography variant="labelCaps">` renders a `<span>` unless you say otherwise. 7.2, 7.3 and 7.8 each had to be told this; the assertion in Task 7 exists to catch it mechanically.

### Current state of the four components (read at baseline `b18997c`)

| Value | Where | Replace with |
|---|---|---|
| `backgroundColor: "#2f343d"` | `trips/[id]/map/page.tsx:17`, `days/[dayId]/map/page.tsx:17` | nothing — `body` already paints `--color-paper` |
| `color: "#f3f6fb"` | `TripDayMapBackButton.tsx:25` | nothing — inherit the text-button default, as `trips/[id]/page.tsx:20` does |
| `label={t("trips.dayView.back")}` | `days/[dayId]/map/page.tsx:20` | `t("trips.dayView.mapBack")` (new key) |
| `Paper elevation={1}` + `borderRadius: 3` (+ `background: "#ffffff"` on the overview) | `TripDayMapFullPage.tsx:356/367/384`, `TripOverviewMapFullPage.tsx:120/131/143` | `Box` with `tokens.card` / `tokens.borderStrong` / 8px / 18px |
| `variant="h6" fontWeight={600}` map title | `TripDayMapFullPage.tsx:386` | `variant="labelCaps" component="h1"`, `tokens.inkSoft` |
| `variant="h5" fontWeight={700}` + `trips.overviewMap.fullPageTitle` | `TripOverviewMapFullPage.tsx:146-148` | `variant="labelCaps" component="h1"`, `tokens.inkSoft`, `trips.overviewMap.title` |
| `variant="h6"` not-found title | `TripDayMapFullPage.tsx:369`, `TripOverviewMapFullPage.tsx:132` | `variant="heading" component="h1"`, `tokens.ink` |
| `borderColor: "divider"` + `borderRadius: 2` empty state | `TripDayMapFullPage.tsx:398-400`, `TripOverviewMapFullPage.tsx:164-166` | `tokens.border`, `"6px"` |
| `borderRadius: 2` map wrapper | `TripDayMapFullPage.tsx:414`, `TripOverviewMapFullPage.tsx:180` | `"6px"` |
| plain `Typography` missing-location label | `TripOverviewMapFullPage.tsx:199` | `component={Link} href={item.href}`, per `TripOverviewMapPanel.tsx:103-115` |

Add no new hex literals. 7.2 left a standing deferred finding about hardcoded literals contradicting Story 7.1's token foundation; this story should shrink that debt, not grow it. Every value in this story's scope has a token.

### `trips.dayView.back` is shared — a new key is the only fix (read before Task 2)

Verified at baseline. `t("trips.dayView.back")` = "← Back to trip" / "← Zurück zur Reise" has three call sites:

| Call site | Navigates to | Copy correct? |
|---|---|---|
| `TripDayView.tsx:1644` (day-not-found card) | `/trips/{tripId}` | yes |
| `TripDayView.tsx:1771` (day hero back link) | `/trips/{tripId}` | yes |
| `days/[dayId]/map/page.tsx:20` (day map back) | `/trips/{tripId}/days/{dayId}` | **no** — this is the AC2 defect |

`test/tripDayViewLayout.test.tsx:1606` asserts `getByRole("link", { name: "← Back to trip" })`. Editing the key's value breaks a correct call site and a passing test; the defect is one wrong *reference*, not wrong copy. Add `trips.dayView.mapBack` and repoint the single wrong call site. Keep the leading `← ` glyph — `TripDayView.tsx:1763-1764` records that the arrow lives in the string precisely so the button needs no leading icon, and the map back button follows the same convention.

### The two preview panels are the pattern source — there is no mockup

`DESIGN.md`'s source-mockup list covers Screens A–H only, and `EXPERIENCE.md:39` states the day map is "an embedded panel inside Day Detail's sidebar, **not** a separate surface or route", because both full-map routes (Stories 2.28 and 3.6) predate the design pass. So the reference is the shipped code, not a `.html` file:

| Element | Reference |
|---|---|
| card shell | `TripDayMapPanel.tsx:52-59` ≡ `TripOverviewMapPanel.tsx:30-37` ≡ `TripDayView.tsx:1114-1120` (`cardSx`) |
| card label | `TripOverviewMapPanel.tsx:41-43` (`labelCaps` + `component=` + `tokens.inkSoft`) |
| empty state | `TripDayMapPanel.tsx:88-109` / `TripOverviewMapPanel.tsx:64-85` |
| map wrapper | `TripDayMapPanel.tsx:111` / `TripOverviewMapPanel.tsx:87` |
| missing list | `TripDayMapPanel.tsx:156-170` (plain labels) / `TripOverviewMapPanel.tsx:94-120` (linked labels) |
| routing notice | `TripDayMapPanel.tsx:145-154` |

The two missing-location treatments differ **because the data differs**, not by accident: `TripOverviewMissingLocation` carries an `href` (`TripOverviewMapData.ts:48-52`) so its labels link to the owning day; `TripDayMapItem` has no `href` (`lib/trips/dayMapData.ts:3-8`) because everything on a day map already belongs to the day you came from. Do not add an `href` to `TripDayMapItem` to make the two symmetrical — that is a data-model change with no AC behind it.

One thing deliberately **not** copied over: `TripDayMapPanel`'s `map-caption` link (`:125-143`, "N stops · open the full map"). It exists to satisfy `EXPERIENCE.md:94`'s rule that a *preview* is always paired with a text affordance to the full map. On the full map that link points at itself.

### Height, and what the map is actually told

`FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)"` is passed **down into Leaflet** as a `height` prop, not merely used to clip — the comments at `TripDayMapPanel.tsx:20-23` and `TripOverviewMapPanel.tsx:88-89` record that a map left at its own default renders full-size and hides the lower half of the route behind `overflow: hidden`. Keep passing it. The `220px` is the old chrome's arithmetic (48px container padding + back button + `gap={3}` + 24px card padding + h6 title); the new chrome is ~20–30px shorter. Re-measure in the browser before touching the constant, and if you change it, say what it was and what it became.

### i18n

Every string goes through `t()` / `getServerT()`; do not introduce the first hardcoded exception. Both `page.tsx` files use the **server** helper `getServerT()` (`@/i18n/server`) — keep them on it; do not convert either page to a client component to reach `useI18n`.

Reuse, do not duplicate: `trips.dayView.mapTitle`, `.mapEmptyTitle`, `.mapEmptyBody`, `.mapMissingTitle`, `.mapMissingTag`, `.routingUnavailableTitle`, `.routingUnavailableBody`, `.notFoundTitle`, `.notFoundBody`, `.loadError`, `.budgetItemPlan`; `trips.overviewMap.title`, `.back`, `.emptyTitle`, `.emptyBody`, `.missingTitle`, `.missingTag`, `.popupStay`, `.popupPlanItem`, `.popupNoNotes`, `.openLinkedItem`; `trips.detail.notFoundTitle`; `trips.timeline.dayLabel`; `trips.plan.previewFallback`. Check both dictionaries before touching any shared key.

### Responsive behavior

`EXPERIENCE.md` states this design pass mocked desktop only (~1080px). Follow the established idiom: MUI breakpoint objects in `sx` (`{ xs: ..., md: ... }`), no `useMediaQuery`. Both pages already carry `py: { xs: 4, md: 6 }` on their `Container` — that is the only breakpoint either screen needs, and it stays.

### The working tree is not clean at baseline

`b18997c` is HEAD, but Story 7.5 (share dialog, status `review`) has uncommitted changes in `TripShareDialog.tsx`, `TripTimeline.tsx`, `members/route.ts`, `tripRepo.ts`, `tripMemberSchemas.ts`, both i18n dictionaries and four test files, plus an untracked `test/zz-scratch-7-5.test.tsx`. None of it overlaps this story's five files, but two consequences:

- When you `git stash push --include-untracked` to measure the tsc/eslint baseline (Task 7), you are stashing 7.5's work too. Pop it back.
- If `npx vitest run` shows failures in `tripShareDialog.test.tsx` / `tripMembersRoute.test.ts` / `tripCollaborationRepo.test.ts` / `tripTimelineSharing.test.tsx`, they are 7.5's, not yours. Do not fix them and do not touch `test/zz-scratch-7-5.test.tsx`.

### Project Structure Notes

Files this story is expected to touch:

- `travelplan/src/app/(routes)/trips/[id]/map/page.tsx` — remove the hex (Task 1).
- `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx` — remove the hex, repoint the back label (Tasks 1–2).
- `travelplan/src/components/features/trips/TripDayMapBackButton.tsx` — remove the hex (Task 2).
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` — card shell, title, empty state (Task 3).
- `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx` — card shell, title, empty state, linked missing locations (Task 4).
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — `+trips.dayView.mapBack`, `−trips.overviewMap.fullPageTitle` (Tasks 2, 5).
- `travelplan/test/tripDayMapFullPage.test.tsx`, `travelplan/test/tripOverviewMapFullPage.test.tsx` — `renderWithProviders` + new coverage (Tasks 6–7).
- `travelplan/test/tripDayMapBackButton.test.tsx` — **new file** (Task 7).

One new file, all of it a test. No new directories, no new components, no new icons. This matches `architecture.md`'s Component Boundaries (feature components under `components/features/*`, routes under `app/(routes)/**`). No API, repository, schema, or validation change is in scope.

### Epic-level note (non-blocking)

The epic lists "**FRs covered:** FR26 (the day-map screen traces to Story 3.5/2.28 and carries no dedicated FR of its own)", which checks out against `prd.md:256` — FR26 covers "a full-size trip map that can be opened from the overview and inspected via clickable place markers". The day-map screen genuinely has no FR; it is Story 3.5's sidebar panel plus Story 2.28's enlargement route. No correction needed.

### References

- `_bmad-output/planning-artifacts/epics.md` → "Epic 7" → "Story 7.9" (lines 1740-1776; Story/AC text above copied verbatim). Stories 7.1–7.3 (the foundation this builds on, lines 1553-1621), 7.7 (dialogs, explicitly out of scope, lines 1685-1701), 7.8 (the immediately preceding story, lines 1703-1738). Story 3.6 (line 824) and Story 3.5 (line 805) are the two features these screens belong to.
- `_bmad-output/planning-artifacts/prd.md:256` — FR26, the only FR this story touches.
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — front-matter `colors`, `rounded` (`md: 8px`, `DEFAULT: 6px`), `spacing.card-padding` (18px), `components.card` and `components.button.minHeight`; prose "Colors" (warn's reserved job), "Elevation & Depth" ("flat and bordered by default… if an element sits in the normal document flow it should never carry a shadow" — the rule the `Paper elevation={1}` violates), "Do's and Don'ts" (44px floor; **"Don't introduce dark mode, or a second dark-mode token set"** — the clause `#2f343d` breaks).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md` — line 39 (day map is a sidebar panel, not a separate surface — why no mockup exists), line 94 (map previews pair with a caption and an affordance to the full map), line 108 (a map is never the sole carrier of information — why the missing-location list and the empty state matter), line 85 (skeleton silhouettes over spinners for route loads — the loading branch this story restyles).
- `_bmad-output/implementation-artifacts/7-8-trip-overview-lower-sections-redesign.md` — the immediately preceding story. Its `Box`-not-`Paper` rule, its card-label heading rule, and its "a component that starts reading `theme.palette.tokens.*` breaks any test rendering it without a `ThemeProvider`" warning all apply here unchanged.
- `_bmad-output/implementation-artifacts/7-3-day-detail-redesign.md` — Task 8's map-panel work is what `TripDayMapPanel.tsx` looks like today; its review established card labels as title+1 (decision 5).
- `_bmad-output/implementation-artifacts/deferred-work.md` → "Deferred from: code review of 7-3-day-detail-redesign" (the `MiniImageStrip` keyboard defect AC5 keeps deferred — it names `TripDayMapFullPage` explicitly) and "Deferred from: code review of 7-2-trip-overview-redesign" (the hardcoded-literal debt, and the `TripOverviewMapPanel` caption/border finding — do not "fix" the panel here).
- `travelplan/src/theme.ts` — `tokens` declaration (`:4-19`) and values (`:158-171`), `MuiPaper`'s non-token border override (`:245-252`), `MuiButton.root`'s `minHeight: 44` (`:253-260`), `MuiDialog` (`:357-364`), and the custom typography variants without `variantMapping` (`:25-52`, `:185-222`).
- `travelplan/src/app/globals.css:1-40` — the CSS custom properties and `body { background: var(--color-paper) }` that make Task 1 a deletion rather than a substitution.
- `travelplan/src/components/features/trips/TripDayMapPanel.tsx`, `TripOverviewMapPanel.tsx` — read in full; the pattern source for every value in this story.
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx`, `TripOverviewMapFullPage.tsx`, `TripDayMapBackButton.tsx`, `travelplan/src/app/(routes)/trips/[id]/map/page.tsx`, `.../days/[dayId]/map/page.tsx` — the five files this story rewrites; every line reference above is drawn from them at baseline `b18997c`.
- `travelplan/src/components/features/trips/TripOverviewMapData.ts:41-57`, `travelplan/src/lib/trips/dayMapData.ts:1-20` — the two missing-location shapes, and why only one carries an `href`.
- `travelplan/src/components/features/trips/TripDayView.tsx:1114-1120` (`cardSx`), `:1637-1645` (not-found card), `:1763-1771` (why the back arrow lives in the string), `:2389` (day-map expand href); `TripTimeline.tsx:806` (trip-map expand href).
- `travelplan/test/tripDayMapFullPage.test.tsx`, `test/tripOverviewMapFullPage.test.tsx`, `test/tripDayMapPanel.test.tsx`, `test/tripOverviewMapPanel.test.tsx`, `test/tripDayViewLayout.test.tsx:1606`, `test/helpers/renderWithProviders.tsx` — the existing contracts this story must preserve or deliberately, visibly update.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev.
