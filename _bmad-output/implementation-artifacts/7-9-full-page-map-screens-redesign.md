---
baseline_revision: 8564c15
final_revision: b8c3fcb
status: awaiting-operator
followup_review_recommended: false
operator_actions:
  - "Seed an isolated SQLite DB on a non-default port (do NOT use travelplan/prisma/dev.db — it holds real trip data; follow the isolation precedent from Stories 7.2, 7.3 and 7.8) and start the dev server against it."
  - "Open a trip and click the expand icon in the Trip Overview sidebar (goes to /trips/{id}/map), then open a day and click the expand icon in the Day Detail sidebar (goes to /trips/{id}/days/{dayId}/map). Confirm neither screen inverts to a dark background on the way in, and that each map card reads as the same card as the preview panel it enlarged (cream card, 1px border, 8px radius, 18px padding — no elevated white panel)."
  - "On both screens confirm the card label is the small uppercase label-caps title in muted ink, matching the preview panel: 'Day map' on the day screen and 'Route' (not 'Full trip map') on the trip screen, with the trip name still shown as a subline beneath 'Route'."
  - "Check the back button on both screens: readable accent-green against the paper background, at least 44x44px in dev tools' computed box, and the day-map one now reads '← Back to day' (not '← Back to trip'). Confirm the trip-map one reads '← Back to trip overview' — the leading arrow is newly added."
  - "Test both back-button branches on each screen: arriving via the expand icon should go back in history, and pasting the map URL into a fresh tab should navigate forward to the trip/day. Both must land on the correct screen."
  - "Exercise on both screens: a populated route with a Google-routed polyline; the routing-unavailable notice (block /api/trips/*/days/*/route in devtools); the missing-locations list (clear the location on one plan item) — on the trip map, confirm the missing-location labels are now underlined links that navigate to the owning day; and the no-locations empty state (a trip/day with no coordinates anywhere), confirming its dashed border is the light token border with a 6px radius."
  - "Click a marker on each screen and confirm the detail dialog opens with its content and images and that the fullscreen photo viewer still works — these were deliberately NOT restyled (AC5), so they should look exactly as they did before."
  - "At roughly 1080px and again at a short viewport, check whether the map fills its container without the page scrolling. FULL_PAGE_MAP_HEIGHT is still 'calc(100vh - 220px)' in both TripDayMapFullPage.tsx:73 and TripOverviewMapFullPage.tsx:57; review's static measurement suggests the real chrome is nearer 291px on the day map and ~23px more on the trip map. If either page scrolls or leaves a dead band, adjust the constant in that file and record the before/after value in the Dev Agent Record."
  - "If every check above passes, edit _bmad-output/implementation-artifacts/7-9-full-page-map-screens-redesign.md: tick Task 8's six checkboxes to [x], set status: done in both the frontmatter and the body's 'Status:' line, and append a Change Log entry dated with the verification date."
---

# Story 7.9: Full-Page Map Screens Redesign — Day Route Map and Trip Route Map

Status: awaiting-operator

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

- [x] Task 1: Restyle the two page shells. (AC: 1)
  - [x] `src/app/(routes)/trips/[id]/map/page.tsx:17` and `src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx:17` — delete `backgroundColor: "#2f343d"` from the wrapper `Box`, leaving `sx={{ minHeight: "100vh" }}`. That is the whole change: `globals.css` already paints `body { background: var(--color-paper) }` (`#F7F4EC`), which is exactly what `trips/[id]/page.tsx:16` relies on. Keep the `Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}` and the `gap={3}` column as-is — they already match both parent screens.
  - [x] **Do not** reach for `sx={(theme) => ...)}` or `useTheme()` here. Both files are `async` React Server Components and every MUI component is `"use client"`; a function `sx` prop crossing that boundary is a serialization error, not a style bug. If a theme value is ever genuinely needed in one of these two files, use a palette *key string* (`backgroundColor: "background.default"`), which is a plain string and serializes. For this story no value is needed at all.
  - [x] Grep both files for `#` afterwards — AC1's wording is absolute ("no hardcoded hex value remains in either page component") and these two files have exactly one hex each today.
- [x] Task 2: Restyle the shared back button and fix the day-map label. (AC: 2)
  - [x] `TripDayMapBackButton.tsx:25` — remove `color: "#f3f6fb"` from the `sx` entirely, keeping `alignSelf: "flex-start"`. Dropping the override makes it inherit MUI's text-button default (`primary.main` = accent `#4B6358`), which is precisely what the sibling back button on `trips/[id]/page.tsx:20` renders. Do not substitute a different token to "be explicit" — two back buttons on adjacent screens must not resolve to two colors.
  - [x] **The 44px floor is already satisfied — verify, don't re-add it.** `theme.ts:253-260` sets `MuiButton.root { minHeight: 44, paddingInline: 20, paddingBlock: 10 }` for every variant including `text`. The epic's "bare unpadded text `Button`" description predates Story 7.1. Confirm the computed box in dev tools and record the finding; adding a redundant `minHeight: 44` to the `sx` is noise.
  - [x] **Do not touch `handleClick`.** The `typeof window === "undefined"` guard → `window.history.length > 1 ? router.back() : router.push(href)` chain is the behavior AC2 explicitly preserves. It is also the reason this is a `Button` with an `onClick` and not a `next/link` — do not "improve" it into a `Link`.
  - [x] Add **one new i18n key** to both `src/i18n/en.ts` and `src/i18n/de.ts`: `trips.dayView.mapBack` — EN `"← Back to day"`, DE `"← Zurück zum Tag"`. Point `days/[dayId]/map/page.tsx:20` at it.
  - [x] **You cannot fix this by editing `trips.dayView.back`.** That key is shared: `TripDayView.tsx:1644` (not-found card) and `:1771` (hero back link) both use it and both genuinely navigate to the trip, and `test/tripDayViewLayout.test.tsx:1606` pins the exact string `"← Back to trip"`. Changing the value breaks a correct call site and a passing test. A new key is the only correct move.
  - [x] `trips.overviewMap.back` ("Back to trip overview" / "Zurück zur Reiseübersicht") is already correct copy and stays. It is the one back label with no `←` glyph while its new sibling has one; adding `← ` to both dictionaries for parity is a reasonable call since the two buttons are now visually identical — decide, do it or don't, and say which in Dev Agent Record rather than leaving it unremarked.
- [x] Task 3: Restyle `TripDayMapFullPage.tsx` onto the `card` shell. (AC: 3, 4, 6)
  - [x] Add `useTheme` and read `const tokens = theme.palette.tokens;`, matching `TripDayMapPanel.tsx:47-48`.
  - [x] Replace all three `Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}` wrappers — loading (`:356`), not-found (`:367`), and main (`:384`) — with a `Box` carrying the card treatment: `backgroundColor: tokens.card`, `border: "1px solid"`, `borderColor: tokens.borderStrong`, `borderRadius: "8px"`, `padding: "18px"`. Copy the shape verbatim from `TripDayMapPanel.tsx:52-59` (identical to `TripDayView.tsx:1114-1120`'s `cardSx`). **`Box`, not `Paper`** — `theme.ts:245-252` stamps `border: 1px solid rgba(17, 18, 20, 0.08)` on every `Paper`, which would layer a non-token rule over `borderStrong`. This is the same constraint 7.3 and 7.8 worked under.
  - [x] Drop `Paper` from the `@mui/material` import once the last use is gone, or lint will flag it.
  - [x] Title (`:386-388`): `Typography variant="h6" fontWeight={600}` → `variant="labelCaps" component="h1"` with `sx={{ color: tokens.inkSoft }}`. Keep the `trips.dayView.mapTitle` key ("Day map" / "Tageskarte") unchanged — AC3 requires the same string the preview panel renders.
  - [x] **`component=` is mandatory and `h1` is deliberate** — see Dev Notes → "Heading level on a screen that has no title".
  - [x] Not-found branch (`:369`): `variant="h6" fontWeight={600}` → `variant="heading" component="h1"` in `tokens.ink`, matching `TripDayView.tsx:1637`'s not-found card. Keep `trips.dayView.notFoundTitle` / `notFoundBody`.
  - [x] Empty state (`:391-412`): `borderRadius: 2` → `"6px"`, `borderColor: "divider"` → `tokens.border`. Everything else (dashed 1px, centered column, the two `Typography` lines, the copy keys) already matches `TripDayMapPanel.tsx:88-109` — leave it alone. Keep `minHeight: FULL_PAGE_MAP_HEIGHT` here; the panel's fixed `height: 150` is the preview footprint, not this one.
  - [x] Map wrapper (`:414`): `borderRadius: 2` → `"6px"`, matching `TripDayMapPanel.tsx:111`.
  - [x] Routing-unavailable notice (`:424-433`) and missing-locations list (`:435-449`) are **already byte-identical** to `TripDayMapPanel.tsx:145-170`, including the `warning.main` text and the `Chip color="warning"`. AC4 is already satisfied for these two — verify by diffing the two blocks, then leave them untouched and say so. Warn is correct here: a missing location *is* an open item.
  - [x] `FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)"` (`:73`) was tuned against the old chrome. Card padding drops 24px→18px and the title shrinks from h6 to 10.5px caps, so the map gains roughly 20–30px of room. Re-check in the browser (Task 8); adjust the constant only if the page actually scrolls or leaves a dead band, and record the before/after value if you change it.
- [x] Task 4: Restyle `TripOverviewMapFullPage.tsx` onto the `card` shell. (AC: 3, 4, 6)
  - [x] Same `useTheme` / `tokens` setup, same `Paper` → card `Box` replacement on all three wrappers — loading (`:120`), not-found (`:131`), main (`:143`). Note these three additionally carry `background: "#ffffff"`: that literal goes with the `Paper`, replaced by `tokens.card`. It is the same value, but AC1's no-hex rule and 7.2's standing hardcoded-literal debt both say it should not be spelled out here.
  - [x] **Title swap (`:145-154`)**: the header block currently renders `Typography variant="h5" fontWeight={700}` with `trips.overviewMap.fullPageTitle` ("Full trip map"), plus the trip name below it. AC3 requires the same string the preview panel renders → `variant="labelCaps" component="h1"` in `tokens.inkSoft` with `t("trips.overviewMap.title")` ("Route"), matching `TripOverviewMapPanel.tsx:41-43`.
  - [x] **Keep the trip-name line** (`:149-153`). It is the only element on the page that names the trip, AC3 constrains the *title* only, and dropping it would be a silent information loss on a screen reachable by direct URL. Restyle it to `11.5px / 600` in `tokens.inkSoft` (the panel-caption rhythm used at `TripDayMapPanel.tsx:131-137`) so it reads as a subline under the caps label rather than competing with it.
  - [x] Not-found branch (`:132`): `variant="h6"` → `variant="heading" component="h1"` in `tokens.ink`. Keep `trips.detail.notFoundTitle`.
  - [x] Empty state (`:157-178`) and map wrapper (`:180`): same two edits as Task 3 — `borderRadius: 2` → `"6px"`, `borderColor: "divider"` → `tokens.border`. The loading skeleton (`:123`) carries a third `borderRadius: 2` — same fix. Its day-map counterpart (`TripDayMapFullPage.tsx:359`) has no radius at all; give it `sx={{ borderRadius: "6px" }}` so the two loading states match each other and `TripDayMapPanel.tsx:86`.
  - [x] **Missing-locations list (`:190-204`) is the one place where this screen genuinely diverges from its panel.** `TripOverviewMapPanel.tsx:103-115` renders each label as a `Typography component={Link} href={item.href}` in `primary.main` with `textDecoration: "underline"` and `textUnderlineOffset: "2px"`; the full page renders the same items as plain `Typography`. AC4 says match the panel — so make them links. The data is already there: both call the same `buildTripOverviewMapData`, and `TripOverviewMissingLocation` carries `href` (`TripOverviewMapData.ts:48-52`), so this is a copy of the panel's JSX, not new plumbing.
  - [x] Leave the `Chip label={t("trips.overviewMap.missingTag")} size="small" color="warning"` exactly as-is — identical in both, and warn is the correct reservation for an open item.
- [x] Task 5: Retire the orphaned title key. (AC: 3)
  - [x] `trips.overviewMap.fullPageTitle` has exactly one call site (`TripOverviewMapFullPage.tsx:147`), which Task 4 removes. Re-run `grep -rn "overviewMap.fullPageTitle" src/ test/` to confirm zero hits, then delete it from **both** `src/i18n/en.ts:334` and `src/i18n/de.ts:333`. Deleting orphans from both dictionaries is the convention 7.3 set and 7.8 followed; 7.2's review found dead keys left behind after a rename.
  - [x] Net i18n change for this story: **+1** (`trips.dayView.mapBack`), **−1** (`trips.overviewMap.fullPageTitle`). Nothing else. Every other string these screens render already exists and is shared with the preview panels — do not introduce a parallel `…fullPage…` variant of any of them.
- [x] Task 6: Repair the two full-page test files, which will otherwise start throwing. (AC: 6)
  - [x] `test/tripDayMapFullPage.test.tsx:96-100`, `:180-184` and `test/tripOverviewMapFullPage.test.tsx:90-94`, `:162-166` all render with a bare `<I18nProvider>` and **no `ThemeProvider`**. The moment these components read `theme.palette.tokens.*`, MUI's default theme has no `tokens` object and every render throws on `undefined`. Switch all four renders to `renderWithProviders` (`test/helpers/renderWithProviders.tsx`). This is the third story in a row to hit this exact trap (7.3 on `tripDayMapPanel.test.tsx`, 7.8 on `tripBucketListPanel.test.tsx`) — it is listed here so it costs you a minute instead of a debugging session.
  - [x] The four existing behaviors — day map renders its container, day marker click opens the plan-item dialog with its image, overview renders the chronological polyline and both popup kinds with correct `Open details` hrefs, overview keeps missing-location items visible while excluding them from the map — **must keep passing unchanged** apart from the provider swap. They are this story's regression canary for AC6.
  - [x] Watch `test/tripOverviewMapFullPage.test.tsx:105` — `screen.getAllByRole("button")` grabs *every* button in the tree and indexes into it. Task 4 adds no buttons, but if your restyle introduces one the indices shift and the assertions silently target the wrong element. If that happens, narrow the query to `getAllByTestId(/^trip-map-marker-/)` rather than re-numbering the indices.
- [x] Task 7: Add the coverage these two screens don't have. (AC: 1, 2, 3, 4)
  - [x] `test/tripDayMapFullPage.test.tsx` — the card label renders as a **heading** with the accessible name `"Day map"` (`getByRole("heading", { name: "Day map" })`). This is AC3's mechanical assertion and it fails today, where the title is an `h6` reading the same string but would fail again if a future edit drops `component=` and silently renders a `<span>`.
  - [x] `test/tripOverviewMapFullPage.test.tsx` — the card label renders as a heading named `"Route"`, the trip name `"Northern Route"` is still on screen, and `"Full trip map"` is **absent**. The name/label collision in the existing fixture is a coincidence — assert the heading role for `"Route"` and plain text presence for the trip name so the two cannot satisfy each other.
  - [x] `test/tripOverviewMapFullPage.test.tsx` — extend the existing missing-locations test (`:120`): `"Unmapped museum"` resolves to a **link** with `href="/trips/trip-1/days/day-1?open=plan&itemId=item-1"`. That is Task 4's one behavioral change and the only AC4 item that is not pure CSS.
  - [x] **New file** `test/tripDayMapBackButton.test.tsx` — the component has no test at all today. Mock `next/navigation`'s `useRouter` and cover: (a) the label prop renders as the button's accessible name; (b) with `window.history.length > 1`, clicking calls `router.back()` and not `router.push`; (c) with `history.length <= 1`, clicking calls `router.push(href)`. (b) and (c) are AC2's "continues to preserve its existing behavior" — the only part of this story that can break navigation. Render through `renderWithProviders`.
  - [x] Optional but recommended, and the **only** mechanical check available for AC1: a static assertion that neither map `page.tsx` contains a hex literal. Both files are async RSCs and vitest cannot render them, so a source-text guard (`readFileSync` + `expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)`) is the alternative to eyeballing it. No test in this repo reads source files today, so this introduces a pattern — take it or leave it, but if you leave it, say in Dev Agent Record that AC1 is verified by grep and browser only.
  - [x] Run `npx vitest run` from `travelplan/`. Triage every failure as either a stale assertion encoding a pre-redesign detail (fix the assertion, and say so) or a real regression (fix the implementation). Do not relax or delete assertions in bulk to get green. Then `npx tsc --noEmit -p .` and `eslint` over the touched files, reporting counts against the baseline the way 7.1–7.4 and 7.8 did — establish the baseline with `git stash push --include-untracked` first; there is a known pre-existing population (~161 tsc errors, ~9 eslint warnings) unrelated to this work.
  - [x] `npm run build` must stay clean.
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

claude-opus-5[1m] (bmad-dev-auto: implementation subagent + two parallel review subagents)

### Debug Log References

- Baseline measured at `8564c15` with the tree clean: `npx vitest run` 94 files / 618 passed, `npx tsc --noEmit -p .` **152** errors, `npx eslint src test` **87** problems (2 errors, 85 warnings), `npm run build` clean with one pre-existing warning ("Encountered unexpected file in NFT list" on `next.config.ts`, confirmed pre-existing by stashing and rebuilding).
- The spec's Dev Notes section "The working tree is not clean at baseline" is **stale** — Story 7.5 was committed before this run, so `git stash push --include-untracked` picked up nothing but this story's own work. No 7.5 test failures appeared.
- The spec's estimated pre-existing populations were also off: **152** tsc errors (not ~161) and **85** eslint warnings plus **2** eslint errors (`react/no-children-prop`) that the spec did not mention at all. None were touched; none moved.
- First attempt at the Task 7 source-text hex guard used `new URL(..., import.meta.url)` and failed — under `@vitest-environment jsdom`, `import.meta.url` is an `http:` URL and `readFileSync` throws "The URL must be of scheme file". Resolved with `resolve(process.cwd(), …)`, consistent with the assumption `test/setup.ts` already makes.

### Completion Notes List

Tasks 1–7 are complete. **Task 8 (manual browser check on a seeded throwaway database) is not done and is owed to the operator** — see the `operator_actions` list in this file's frontmatter. Everything below that depends on a rendered page is asserted statically or by unit test, and re-listed for the operator to confirm visually.

Decisions the story text required to be recorded here:

1. **The 44px touch-target floor was verified, not re-added** (Task 2). `theme.ts:253-260` sets `MuiButton.styleOverrides.root { minHeight: 44, borderRadius: 6, paddingInline: 20, paddingBlock: 10 }` with no size or variant carve-out — the only sibling slots are `containedPrimary` and `outlined`, neither of which touches metrics — and the button renders at default `size="medium"` with an `sx` that sets no padding or height. So the computed box clears 44px in both dimensions for both labels. The epic's "bare unpadded text `Button`" wording predates Story 7.1. A comment above the `<Button>` records this instead of a redundant `minHeight: 44`. Literal dev-tools confirmation is an operator action.
2. **The `← ` glyph was added to `trips.overviewMap.back`** in both dictionaries (Task 2's open call). Reasoning: after this story the two back buttons are the same component, in the same slot, in the same colour, on adjacent screens — an arrow on one and not the other reads as an inconsistency, not a distinction; `TripDayView.tsx:1763-1764` records that the arrow lives in the string precisely so the button needs no leading icon; and unlike `trips.dayView.back`, `trips.overviewMap.back` has exactly one call site and **no test pins its value**, so the parity edit carries none of the hazard that made a new key mandatory on the day side. This is a user-visible copy change in an otherwise visual-only story, called out here deliberately.
3. **The card label is `component="h1"` on both screens** (Dev Notes → "Heading level on a screen that has no title"). Neither map screen has a page title, so 7.3's "card labels are title + 1" rule has no anchor and the card label is the page's own heading. Worth a reviewer's attention: `AppHeader` emits a real `<h6>` on every route (`AppHeader.tsx:38`), so the premise "no ancestor heading" is not strictly true — the outline on both screens is now `h6` → `h1`. That is not an axe `heading-order` violation (the rule only flags level *increases* greater than one) and it is not a regression (the day map previously emitted a lone `h6`, the trip map a lone `h5`, both equally unanchored), but the app-wide `AppHeader` `h6` is a pre-existing outline oddity that any future document-outline pass should settle globally rather than per screen.
4. **`FULL_PAGE_MAP_HEIGHT` was NOT changed** (Task 3). It remains `"calc(100vh - 220px)"` in both components. Task 3 conditioned the change on a browser measurement, which is Task 8's — an operator action. Static measurement during review suggests the real day-map chrome is nearer 291px, and that the trip map needs a further ~23px for its trip-name subline, i.e. the two screens arguably need different offsets while sharing one constant. Recorded in `deferred-work.md` so the constant is not left unexamined if the operator pass only confirms the visuals.
5. **The routing-unavailable notice and the missing-locations list in `TripDayMapFullPage.tsx` were diff-verified and left untouched** (Task 3). Diffed against `TripDayMapPanel.tsx:145-170` with indentation normalised: the only differing lines are the data-source expression (`missingLocations` prop vs. `mapData.missingLocations`). Every style, variant, colour, `data-testid`, i18n key and the `Chip color="warning"` are identical, so AC4 was already satisfied for both blocks.
6. **The optional source-text hex guard was taken** (Task 7) — it is the only mechanical check available for AC1, since both page shells are async RSCs that vitest cannot render. Rather than add a second new file, one assertion lives in each of the two existing full-page test files, each guarding its own shell. Review hardened it: comments are stripped before matching (so a future `// see #1234` cannot fail the guard) and `rgb()`/`hsl()` are matched too (so the literal cannot return in another notation).

Other notes:

- `getAllByRole("button")` at `tripOverviewMapFullPage.test.tsx:105` did not need narrowing — this story adds no buttons (the missing-location labels became **links**), and that test has no missing locations in its fixture.
- No stale assertions and no regressions: the suite went from 618 passing to 623 passing with zero failures at any point, so nothing was relaxed, rewritten or deleted to get green. The +5 are 3 back-button tests and 2 hex guards; the rest of the new coverage is added assertions inside existing tests.
- AC5 held: neither `Dialog` was opened. The marker-detail dialog, the fullscreen photo viewer and its scrim are unchanged in the diff, and `MiniImageStrip`'s keyboard defect stays deferred.

### File List

Modified:

- [travelplan/src/app/(routes)/trips/[id]/map/page.tsx](../../travelplan/src/app/(routes)/trips/[id]/map/page.tsx) — dropped the `#2f343d` shell background.
- [travelplan/src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx](../../travelplan/src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx) — dropped the `#2f343d` shell background; repointed the back label to `trips.dayView.mapBack`.
- [travelplan/src/components/features/trips/TripDayMapBackButton.tsx](../../travelplan/src/components/features/trips/TripDayMapBackButton.tsx) — removed the `#f3f6fb` override so it inherits the accent text-button default; `handleClick` untouched.
- [travelplan/src/components/features/trips/TripDayMapFullPage.tsx](../../travelplan/src/components/features/trips/TripDayMapFullPage.tsx) — three `Paper` surfaces onto the token `card` `Box`; `labelCaps`/`heading` titles; `tokens.border` + 6px empty state, map wrapper and skeleton; loading branch now renders the real label.
- [travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx](../../travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx) — same card/title/empty-state work, `#ffffff` literal dropped, trip-name subline kept and restyled, missing-location labels turned into links.
- [travelplan/src/i18n/en.ts](../../travelplan/src/i18n/en.ts), [travelplan/src/i18n/de.ts](../../travelplan/src/i18n/de.ts) — `+trips.dayView.mapBack`, `−trips.overviewMap.fullPageTitle`, `← ` added to `trips.overviewMap.back`.
- [travelplan/test/tripDayMapFullPage.test.tsx](../../travelplan/test/tripDayMapFullPage.test.tsx), [travelplan/test/tripOverviewMapFullPage.test.tsx](../../travelplan/test/tripOverviewMapFullPage.test.tsx) — `renderWithProviders`, heading-role and link-href assertions, page-shell colour guards.

Created:

- [travelplan/test/tripDayMapBackButton.test.tsx](../../travelplan/test/tripDayMapBackButton.test.tsx) — first test for the shared back button: label as accessible name, and both branches of the `history.length` guard.

### Review Triage Log

### 2026-08-01 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 5: (high 0, medium 2, low 3)
- reject: 18
- addressed_findings:
  - `[low]` `[patch]` Dev Agent Record was left entirely empty (placeholder `{{agent_model_name_version}}`, no notes, no file list) while Tasks 1–7 were ticked — the story text demanded four specific decisions be recorded there. Filled in: model, debug log with real baseline numbers, all six decisions, file list, change log.
  - `[low]` `[patch]` The Task 7 hex guard both under- and over-enforced: it missed `rgb()`/`hsl()`/named colours, so "no hardcoded colour" was not what it tested, and it false-positived on any future comment containing an issue reference like `// see #1234`. Now strips comments before matching and covers `rgb`/`rgba`/`hsl`/`hsla`.
  - `[low]` `[patch]` `test/tripDayMapBackButton.test.tsx` closed over plain module-scope `const back`/`push` from a hoisted `vi.mock` factory (one import-order change from a TDZ error; the repo idiom at `tripDayViewLayout.test.tsx:26` is `vi.hoisted`), never restored the redefined `window.history.length`, and asserted a `length: 1` branch that matches jsdom's own default so it would pass even if the redefinition silently failed. Switched to `vi.hoisted`, added an `afterEach` that deletes the own property, and made the precondition explicit.
  - `[low]` `[patch]` Both loading skeletons still described the retired chrome — a 28px (day) and 36px (trip) text placeholder standing in for a ~16px `labelCaps` line, and still differing from each other after Task 4 asked for them to match. Both now render the real card label and skeleton only the map rectangle, which is what the two reference preview panels do and which also stops the screens from having no heading at all while loading.

Rejected in this pass, with reasons, because each is a spec-mandated match to already-shipped reference code rather than a defect: the `minHeight: "100vh"` wrapper being vestigial after the background was removed (`trips/[id]/page.tsx:16` — reviewed and shipped in 7.2 — carries the identical wrapper, so the map shell now matches its parent exactly); the trip-name subline spelling `11.5px / 600` as literals instead of `variant="body2"` (`TripDayMapPanel.tsx:130-137`, the designated reference, does exactly this, and the hardcoded-literal debt is already recorded from 7.2's review); `trips.dayView.mapBack` duplicating the value of the existing `trips.dayPrint.back` (same string, different feature namespace — reusing the print key on the map page would couple two unrelated surfaces); the six-copy `cardSx` duplication and the "should not be allocated in the render body" objection (`tokens` come from `useTheme()` and cannot be hoisted to module scope; the duplication is deferred instead); the `h6` → `h1` outline claim being an axe violation (the `heading-order` rule flags level *increases* greater than one, not decreases); `component="h1"` on the not-found branches diverging from `TripDayView.tsx:1648`'s `h5` (consistent with this story's recorded h1 decision); the back button not being a `next/link` and not verifying that the previous history entry is the labelled destination (Task 2 explicitly forbids touching `handleClick` or converting it); the missing-location links having a sub-44px touch target and sitting below the empty state (both match `TripOverviewMapPanel.tsx`, which AC4 designates as the treatment to match, and the design pass is desktop-only); and the hex guards resolving via `process.cwd()` (`test/setup.ts` already makes that assumption, and the suggested `import.meta.url` alternative is the approach that actually failed under jsdom).

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev.
- 2026-08-01: Tasks 1–7 implemented and reviewed via bmad-dev-auto at baseline `8564c15`. Four low-severity review patches applied, five findings deferred, no spec amendment needed. Gates held at baseline: 623 tests passing (up from 618, none failing), 152 tsc errors, 87 eslint problems, clean build. Task 8's manual browser pass remains owed. Status: awaiting-operator.

## Auto Run Result

Status: `awaiting-operator` — Tasks 1–7 are implemented, reviewed and committed. Task 8 is a manual browser pass against a seeded throwaway database, which no agent can perform; it is enumerated under `operator_actions` in the frontmatter.

### Summary of implemented change

The two full-page map routes no longer drop the user onto a dark pre-redesign screen. Both page shells lost their `#2f343d` background and now inherit the app's paper ground from `globals.css`, matching the screens they were opened from. The shared back button lost its `#f3f6fb` override and inherits the accent text-button colour used by its sibling on the trip page, and the day-map route now renders a new `trips.dayView.mapBack` key ("← Back to day") instead of the shared "← Back to trip", which named the wrong destination. Inside both screens, six `Paper elevation={1}` surfaces became `Box`es carrying the token `card` treatment, the map titles became `labelCaps` card labels rendering the same string as the preview panel each screen enlarges, and the empty states, map wrappers and loading skeletons moved onto `tokens.border` and 6px radii. The trip map's missing-location labels became links to the owning day, matching its preview panel. One i18n key was added and one orphan removed. No data plumbing, no Leaflet component, and neither dialog was touched.

### Files changed

- `travelplan/src/app/(routes)/trips/[id]/map/page.tsx` — dropped the `#2f343d` shell background.
- `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx` — dropped the `#2f343d` shell background; repointed the back label to the new key.
- `travelplan/src/components/features/trips/TripDayMapBackButton.tsx` — removed the `#f3f6fb` override; `handleClick` untouched.
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` — card shell, `labelCaps`/`heading` titles, token empty state, real label in the loading branch.
- `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx` — same, plus the `#ffffff` literal dropped, the trip-name subline kept and restyled, and linked missing locations.
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — `+trips.dayView.mapBack`, `−trips.overviewMap.fullPageTitle`, `← ` added to `trips.overviewMap.back`.
- `travelplan/test/tripDayMapFullPage.test.tsx`, `travelplan/test/tripOverviewMapFullPage.test.tsx` — `renderWithProviders`, heading-role and link-href assertions, page-shell colour guards.
- `travelplan/test/tripDayMapBackButton.test.tsx` — **new**, first coverage for the shared back button.
- `_bmad-output/implementation-artifacts/deferred-work.md` — five findings recorded.

### Review findings breakdown

Two reviewers (adversarial + edge-case) ran in parallel against the full diff. After dedup and severity re-assignment: **0 intent_gap, 0 bad_spec, 4 patch (all low), 5 defer (2 medium, 3 low), 18 reject**. No spec amendment or implementation loopback was needed.

- **Patches applied:** the empty Dev Agent Record; the over- and under-enforcing hex guard regex; three defects in the new back-button test (`vi.mock` factory closing over module-scope consts instead of `vi.hoisted`, `window.history.length` never restored, and a branch assertion that matched jsdom's default and so proved nothing); and both loading skeletons still sized for the retired `h6`/`h5` titles.
- **Deferred:** the error-banner/empty-state contradiction on both map screens (medium); `FULL_PAGE_MAP_HEIGHT` under-measuring the real chrome (medium, and also an operator action); the day-map screen identifying neither day nor trip (low); the `card` token bundle now duplicated in six components (low); and the absence of any i18n key-parity test (low).
- **Rejected:** eighteen findings, each because it objected to something the spec mandated as a match to already-shipped reference code, or rested on a claim that did not survive checking. The full list with reasons is in the Review Triage Log above.

### Verification performed

| Gate | Baseline `8564c15` | Final |
|---|---|---|
| `npx vitest run` | 94 files / 618 passed, 0 failed | 95 files / **623 passed, 0 failed** |
| `npx tsc --noEmit -p .` | 152 errors | **152** (unchanged) |
| `npx eslint src test` | 87 problems (2 errors, 85 warnings) | **87** (unchanged) |
| `npm run build` | clean, 1 pre-existing warning | **clean**, same warning |

All four gates were run twice — once by the implementation agent and once independently after the review patches — with identical results. Additional static verification: zero `#` characters remain in either page component; `grep -rn "overviewMap.fullPageTitle" src/ test/` returns zero hits; no `Paper` usage remains in either full-page component; and the routing-notice and missing-locations blocks in `TripDayMapFullPage.tsx` were diffed line-by-line against `TripDayMapPanel.tsx:145-170` and differ only in the data-source expression.

### Residual risks

- **Every pixel-level claim is unverified.** AC1's "same page shell", AC2's colour contrast and 44px computed box, AC3's card treatment, AC4's empty-state border, and AC5's "the dialogs were not restyled" are all asserted from source and theme reading, not from a rendered page. The unit tests cover heading roles, one link href and two source-text colour guards — the visual result itself has no automated coverage. This is what the operator pass exists to close.
- **`FULL_PAGE_MAP_HEIGHT` is knowingly unexamined**, and static measurement suggests it is wrong on both screens by different amounts. If the operator's viewport check is cursory, a scrolling map page ships.
- **`trips.overviewMap.back` gained a user-visible `← ` prefix** in a story declared visual-only. It was an explicitly authorised call, but it is copy, no test pins it, and it should be looked at during the operator pass.
- The i18n change was made by hand in both dictionaries with nothing enforcing parity; it is correct here, but the class of error is unguarded (deferred).
