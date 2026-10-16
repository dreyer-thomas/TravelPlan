---
baseline_commit: 3140a60 (plus the uncommitted Story 12.2 working tree; commit 12.2 before starting)
---

# Story 12.3: Look Through the Ideas and Tick the Good Ones

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone planning a day,
I want a dialog where I describe the day, see the suggestions as cards and tick the ones I want,
so that I can choose calmly before anything is added to my plan.

**FRs covered:** FR44 (UI). **Depends on:** 12.1 (done, `f917a7a`), 12.2 (done; **still uncommitted** in the working tree on 2026-10-16: `suggestionImages.ts`, the schema and route changes, the docs). Story 12.4 adds the *Übernehmen* behaviour to the dialog built here. This story writes nothing to the database.
Sources: [epics.md#Story 12.3](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) (R3 surface, R5 selection, D3 marker); [12-1 story](12-1-ask-claude-what-the-day-could-hold.md) (*Response contract*, *Error codes and statuses*); [12-2 story](12-2-pictures-for-each-suggestion.md) (`images`, Deviation 1); [DESIGN.md / EXPERIENCE.md](../planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/); DW-387 in [deferred-work.md](deferred-work.md).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-16 against the working tree (12.2 applied). `TV` means `src/components/features/trips/TripDayView.tsx` (5035 lines).

## Read this first: what the epic's wording assumes that the code or the design system does not

Each item was checked, and each one changes what a task asks for.

1. **The design system has no full-screen dialog, and the house rule forbids the usual way of building one.** No form dialog uses MUI's `fullScreen` or `useMediaQuery` (only `FullscreenPhotoViewer.tsx:134` and `TripTimeline.tsx:195,209`). `DialogShell.tsx:233` and `TripTimeline.tsx:202` record the rule: `useMediaQuery` is allowed only when a breakpoint decides *which subtree mounts*, never for styling a mounted element. EXPERIENCE.md:19 says mobile was never mocked. So: add an optional `fullScreenOnPhone?: boolean` prop to `DialogShell` that applies **pure sx breakpoints** to the paper at `xs` (`m: 0`, `width: 100%`, `maxWidth: 100%`, `height: 100%`, `maxHeight: 100%`, `borderRadius: 0`, no border) and leaves `sm`+ exactly as today. The default `false` must leave every existing consumer's DOM and sx byte-identical. Do **not** pass MUI's `fullScreen` prop.
2. **The section header was deliberately reduced to one action.** The comment at TV:4107-4111 says the header once carried four buttons and wrapped on phones, and that the add button stays because "it creates what the section lists". *Ideen finden* also creates what the section lists (from 12.4), so it qualifies, but the comment becomes false. Put both buttons in one `Box` (`display: flex`, `gap: 1`, `flexWrap: wrap`) on the right of the header, add-activity first, and **rewrite the comment** to say two actions and why. The header `Box` already has `flexWrap="wrap"` (TV:4101).
3. **"Exactly one primary action per dialog" (DESIGN.md:282, EXPERIENCE.md:71) vs a dialog with *Suchen* and *Übernehmen*.** *Übernehmen* is the committing action, so it is the only `contained` button and it lives in the footer. *Suchen* is an `outlined` button in the body, directly below the form fields. It does not commit anything; it fetches.
4. **"A disabled primary needs an explanation" (EXPERIENCE.md:71) vs "Übernehmen disabled with none ticked".** Keep the disabled state (the AC asks for it) and put the explanation next to it: the footer always shows a `role="status"` count line, "Noch nichts ausgewählt" / "3 ausgewählt" (singular twin key for 1, see item 9). For the empty wish, do **not** disable *Suchen*: pressing it with an empty (whitespace-only) wish shows the field's own error state ("Beschreib kurz, was du erleben willst."), following DESIGN.md:291.
5. **Story 12.4 does not exist yet, so *Übernehmen* has nothing to do.** The AC allows hiding it. **Default:** the dialog takes `onApply?: (picked: DaySuggestion[]) => void`. When it is undefined (as in this story, where `TripDayView` passes nothing), the footer shows only the count line and **no button**. When it is defined, the footer shows *Übernehmen (n)*, enabled for n ≥ 1, and calls `onApply` with the ticked suggestions in list order. The dialog tests pass a `vi.fn()` and cover enabled/disabled and the call. 12.4 then only has to pass the prop. See *Questions* 1.
6. **`warn` is reserved for the gap state (DESIGN.md:234, :325), so *Ort nicht bestätigt* must not use it.** Render it as a small pill on `tokens.pillNeutral` (`src/theme.ts:20`) with `tokens.inkSoft` text and a small location-off/help icon (`aria-hidden`), always with the text. Colour is never the only signal (EXPERIENCE.md:107-111).
7. **The client does not know the trip's start location.** The server's context loader falls back to the trip start (`getDaySuggestionContextForUser`), but the trip detail payload has no `startLocation` (`TripSummary` at TV:307, `TripWithDays` at `tripRepo.ts:219`). Day start in the dialog is `previousStay` (TV:2093) by `name` (plus `location.label` when present). Without a previous stay, show the localised line "Startort der Reise" (no label). End is `currentStay` (TV:2094), or "Keine Unterkunft" when there is none. **Do not** widen the trip payload in this story. See *Questions* 2.
8. **A search can take about 80 s, and nginx may cut it at 60 s with an HTML 504.** EXPERIENCE.md:87 allows a button spinner only for sub-second actions. So *Suchen* shows a spinner **and** the label switches to "Suche läuft …", and a `role="status"` line below says "Das kann bis zu einer Minute dauern." The client must not set its own fetch timeout below 90 s (set none). It must survive a non-JSON body: wrap `response.json()` in a try. A non-JSON `504` or `502` maps to the `ai_failed` message, and any other non-JSON reply maps to `errors.server`.
9. **No plural support, no "1½ h" formatter.** `formatMessage` only replaces `{name}` (`src/i18n/index.ts`). Plurals use singular twin keys (`trips.gallery.showMoreImagesOne`, `provider.tsx:126-143`). The existing duration helpers (`formatDurationSummary` TV:2333, `formatDurationMinutes` TV:492) give "1h 30m", not "ca. 1½ h". Add a pure `formatApproxDuration(minutes, t)` (Task 2).
10. **Thumbnails are third-party hotlinks (DW-387).** Each `<img>` gets `referrerPolicy="no-referrer"`, `loading="lazy"` and `decoding="async"`. There is **no CSP anywhere** (`next.config.ts` has only `proxyClientMaxBodySize`, `src/proxy.ts` sets none, nginx config in the docs adds none), so there is no `img-src` to extend. Record that in the docs and close DW-387. Use plain `<img>`, not `next/image` (no `remotePatterns` exist, and the URLs are already 250 px).
11. **`MiniImageStrip` does not fit.** It needs an `id` per image, and it wraps each thumbnail in a `<button>` (`TripDayPlanItemContent.tsx:162-230`). Inside a card that is itself a checkbox `<label>`, a nested button is a nested interactive element. Build a small non-interactive strip in the dialog file that reuses the **strip geometry** (56 px, `flex: 0 0 56px`, `objectFit: cover`, radius 0, the 6 px gap; DESIGN.md:272). Do not modify `MiniImageStrip`.
12. **Closing mid-search should stop the paid request.** The route forwards `request.signal` to the model call and to both lookup steps (`suggestions/route.ts:104-115`). Abort the fetch with an `AbortController` when the dialog closes or unmounts, and ignore the aborted result (no error shown, no state set after close). The search still counts against the daily limit; that is the server's rule and needs no UI.

## Acceptance Criteria

1. **Entry point.** When `aiSuggestionsEnabled` is true **and** `canEditPlanning` is true (TV:774), the day view's timeline section header shows an *Ideen finden* / *Find ideas* button beside the add-activity button (item 2). It is not rendered for a viewer, nor when the feature is off. `TripDayView` destructures the prop (default `false`) and drops the "unused until Story 12.3" comment at TV:478.
2. **Dialog layout.** The button opens `TripDaySuggestionsDialog`, built on `DialogShell` (width 520, one `✕` close, no cancel button). It shows, in order:
   - the day's start and end, read-only (item 7);
   - a multi-line wish field labelled "Was willst du heute erleben?" (3–6 rows, max 500 characters, matching `suggestionsRequestSchema`);
   - a mode choice Auto / Zu Fuß / Fahrrad, default Auto, built as an exclusive `ToggleButtonGroup` with an accessible group name. Deselecting the active option is ignored, so a mode is always set;
   - an outlined *Suchen* button.

   Below `sm` the dialog is full-screen (item 1). At `sm`+ it looks like every other `DialogShell` dialog.
3. **Running search.** Pressing *Suchen* with a non-empty trimmed wish posts `{ prompt, mode }` to `POST /api/trips/${tripId}/days/${dayId}/suggestions` with the CSRF header. While it runs, the button shows the spinner and "Suche läuft …", the wish field and the mode choice are disabled, the status line from item 8 is shown, and the dialog can still be closed by `✕`, Escape or a backdrop click (no `disableDismiss`). Closing aborts the request (item 12). An empty wish shows the field error and sends nothing.
4. **Results.** On `200`, a live heading "{n} Ideen gefunden" (singular twin) introduces a `role="group"` list. Each suggestion is a card with:
   - a checkbox, unticked;
   - the title;
   - the description (plain text, whitespace preserved as line breaks);
   - up to 3 thumbnails (item 11), none drawn when `images` is empty;
   - the place label;
   - the typical duration, e.g. "ca. 1½ h" / "about 1½ h" (Task 2);
   - for `verified: false`, the *Ort nicht bestätigt* / *Location not confirmed* pill (item 6).

   The whole card is the checkbox's click target (DESIGN.md:306), and the checkbox's accessible name is the title.
5. **Search again.** When the user searches again (with a changed or unchanged wish or mode), the list is replaced by the new result and every tick is cleared. Until the new result arrives, the old list stays visible but cannot be ticked, so stale ticks can never be applied.
6. **Selection and *Übernehmen*.** The footer count line updates as cards are ticked (item 4). With `onApply` given (item 5), *Übernehmen (n)* is enabled for n ≥ 1 and disabled for 0, and it calls `onApply` with the ticked suggestions in list order. Without `onApply`, no apply button is rendered.
7. **Errors.** On a non-`200` reply or a network failure, a `warn`-toned banner at the top of the dialog body (EXPERIENCE.md:88; this is the one sanctioned non-gap use of warn, as an error) shows the mapped message. Wish and mode stay filled, and an earlier result list is cleared. Mapping (dialog-local, not `resolveApiError`, which knows none of the AI codes):
   - `ai_failed`, and a non-JSON `502`/`504` → "Gerade konnten keine Ideen gefunden werden. Bitte versuch es später noch einmal.";
   - `ai_limit_reached` → "Für heute sind alle Suchen aufgebraucht. Morgen geht es wieder.";
   - `ai_unavailable` → "Die Ideensuche ist gerade nicht eingerichtet.";
   - `forbidden`, `unauthorized`, `csrf_invalid` → the existing `errors.*` keys;
   - `validation_error` → the field error on the wish when the details name `prompt`, otherwise `errors.server`;
   - a network error → `errors.network`;
   - anything else → `errors.server`.

   The banner does not auto-dismiss. It clears on the next search.
8. **Fresh state per open.** Each open starts empty: no wish, mode Auto, no results, no error (`useOpenInstanceKey`, namespaced, e.g. `` `suggest-${key}` ``, per its docblock). Closing with at least one card ticked asks once through `useDiscardGuard` / `DiscardChangesDialog`. Closing with nothing ticked closes silently (EXPERIENCE.md:90), and so does closing during a running search.
9. **Images and privacy (DW-387).** Every thumbnail `<img>` has `referrerPolicy="no-referrer"`, `loading="lazy"` and an alt text "Foto zu {title}, Bild {n} von {total}" (DESIGN.md:320). A thumbnail that fails to load hides itself (`onError`), and the rest of the card is unaffected. Only `images[].thumbnailUrl` is rendered. `originalUrl` is never put into the DOM.
10. **i18n.** `en.ts` and `de.ts` carry every new string, and `test/i18nDictionaries.test.ts` stays green. No string is hard-coded in the component.
11. **Tests and gates.** Component tests cover AC 1–9 (Task 5). Full suite, `tsc --noEmit`, lint (0 errors, warning baseline 80) and `npm run check:migrations` are green. `audit:check` stays waived (DW-384). No dependency, no migration, no env variable, no API change.

## Tasks / Subtasks

- [x] **Task 0: Baseline.** Commit Story 12.2 first, or confirm with Tommy that it is committed (it was uncommitted when this story was written). Run the suite and record the numbers (expected 185 files / 3040 tests).
- [x] **Task 1: `DialogShell` full-screen option (AC: 2)**: `src/components/ui/DialogShell.tsx`
  - [x] 1.1 Add `fullScreenOnPhone?: boolean` (default `false`) to `DialogShellProps`, with a docblock: why (Story 12.3, a card list on a 390 px phone), why sx and not `useMediaQuery`/`fullScreen` (item 1), and that EXPERIENCE.md has no mobile mock.
  - [x] 1.2 When true, merge into the paper `sx`: at `xs` `m: 0`, `width: "100%"`, `maxWidth: "100%"`, `height: "100%"`, `maxHeight: "100%"`, `borderRadius: 0`, `border: "none"`; from `sm` restore `maxWidth: width`, the border and the theme radius. Let `DialogContent` scroll (MUI does by default) and keep the footer pinned.
  - [x] 1.3 Test (in the new dialog test file; no DialogShell test file exists): default renders no full-screen sx on the paper. jsdom cannot resolve breakpoints, so the visual check is a browser task (see Task 7).
- [x] **Task 2: Duration formatter (AC: 4)**: new `src/lib/trips/approxDuration.ts`, pure, with no React.
  - [x] 2.1 `formatApproxDuration(minutes: number, t: (key: string) => string): string`.
    - Under 60: round to the nearest 5 (minimum 5), using `trips.suggestions.durationMinutes` = "ca. {minutes} min" / "about {minutes} min".
    - From 60: round to the nearest 30 minutes, written as whole hours plus "½" when there is a half (`1`, `1½`, `2`, `2½`, …), using `trips.suggestions.durationHours` = "ca. {hours} h" / "about {hours} h".
    - Examples: 45 → "ca. 45 min"; 52 → "ca. 50 min"; 60 → "ca. 1 h"; 90 → "ca. 1½ h"; 100 → "ca. 1½ h"; 105 → "ca. 2 h"; 600 → "ca. 10 h".
  - [x] 2.2 `test/approxDuration.test.ts` with those cases plus 10 (the schema minimum) and the 59/60 boundary. Do one mutation: change 30 to 15 and watch it go red.
- [x] **Task 3: The dialog (AC: 2–9)**: new `src/components/features/trips/TripDaySuggestionsDialog.tsx` (`"use client"`).
  - [x] 3.1 Props: `{ open: boolean; onClose: () => void; tripId: string; dayId: string; dayLabel: string; start: { label: string } | null; end: { label: string } | null; ensureCsrfToken: () => Promise<string>; onApply?: (picked: DaySuggestion[]) => void }`. `start: null` renders the "Startort der Reise" line, and `end: null` renders "Keine Unterkunft". Import `DaySuggestion`, `SuggestionMode` and `suggestionsRequestSchema` from `@/lib/validation/daySuggestionSchemas` (zod only, client-safe). **Never** import from `@/lib/ai/*`: those files are `server-only` and break the build.
  - [x] 3.2 State: `prompt`, `mode` (`"car"`), `promptError`, `status: "idle" | "searching" | "results" | "error"`, `suggestions: DaySuggestion[]`, `ticked: Set<number>` (array indices; 12.1 deliberately has no `id`), `errorMessage`. Keep an `AbortController` in a ref that is set when a search starts. Abort it in `onClose` and in an unmount effect cleanup.
  - [x] 3.3 Search: trim, and validate with `suggestionsRequestSchema.shape.prompt.safeParse` (same rule as the server). Then `fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": token }, body, signal })`, following the TV:1557 pattern. Parse the JSON in a try (item 8). On success, require `Array.isArray(body.data?.suggestions)`, otherwise treat it as `errors.server`. Clear `ticked` when the search **starts** (AC 5). Ignore `AbortError`.
  - [x] 3.4 Layout inside `DialogShell` (`title` = "Ideen für den Tag", `subtitle` = `dayLabel`, `fullScreenOnPhone`, `closeLabel` = `t("common.close")`):
    - the error banner, if any;
    - a small two-line route block: "Start" and "Ziel" with labels, on `tokens.cardAlt`, read-only text, not inputs;
    - the wish `TextField multiline minRows={3} maxRows={6}` with `slotProps.htmlInput.maxLength = 500`. Check the 16 px input-font rule in `theme.ts:171-180` (iOS zoom) still applies to a multiline field;
    - the mode `ToggleButtonGroup exclusive fullWidth` with `aria-label` "Fortbewegung". Style it as the auth-tabs pattern (DESIGN.md:281): a track with 4 px padding, 44 px tall, a white active fill. The `onChange` ignores `null`;
    - *Suchen* (outlined, with the spinner while searching);
    - the status line;
    - the results heading (`role="status"`, present and empty from the start, DESIGN.md:313) and the card list.
  - [x] 3.5 Card: `Box component="label"` (card shell, DESIGN.md:270: white, md radius, `borderStrong`, 18 px padding, ticked state as an `accent` border) wrapping an MUI `Checkbox` whose input has `aria-labelledby` = the title id and `aria-describedby` = the meta line id (place, duration, marker). Text: the title (`fontWeight` 800), the description (`whiteSpace: "pre-line"`), then the meta line with the place label, `formatApproxDuration`, and the pill. Then the thumbnail strip (item 11, AC 9). Checkboxes are disabled while `status === "searching"`. Use tabular figures for the duration (DESIGN.md:245).
  - [x] 3.6 Footer: the count line (`role="status"`), then *Übernehmen (n)* only when `onApply` is set (AC 6). Set `footerSx` to `justifyContent: "space-between"` when both are present.
  - [x] 3.7 Discard guard (AC 8): `useDiscardGuard(ticked.size > 0, onClose, false)` and render `<DiscardChangesDialog {...guard.dialogProps} />`. Read `DiscardChangesDialog.tsx` for the exact signature and wording keys before wiring. Use the generic discard wording if it fits "your selection is lost"; otherwise add one key pair.
  - [x] 3.8 A docblock at the top of the file in the 12.1/12.2 style: the story, why there is no `Übernehmen` without `onApply` (item 5), why abort on close (item 12), why there is no client timeout (item 8), and the referrer policy (item 10).
- [x] **Task 4: Wire into `TripDayView` (AC: 1, 8)**
  - [x] 4.1 Destructure `aiSuggestionsEnabled = false` at TV:570 and drop the placeholder comment at TV:478.
  - [x] 4.2 Add `suggestionsOpen` state, the button (item 2, `variant="outlined" size="small"`, with the label `trips.suggestions.openAction`) and `<TripDaySuggestionsDialog key={`suggest-${suggestionsKey}`} …/>` beside the other dialogs (around TV:4752). Pass `start` from `previousStay`, `end` from `currentStay`, `ensureCsrfToken`, and the day label the activity dialog uses as its subtitle (find how TV builds it for `TripDayPlanDialog`). Pass **no** `onApply` (item 5).
  - [x] 4.3 Guard the open handler with `if (!canEditPlanning || !aiSuggestionsEnabled) return;`, like the other write handlers (TV:1105 and following).
- [x] **Task 5: Tests (AC: 11)**
  - [x] 5.1 New `test/tripDaySuggestionsDialog.test.tsx`. Render the dialog directly with `renderWithProviders`, a fake `ensureCsrfToken` and `stubFetch` (`test/helpers/mockFetch.ts`). Cover:
    - the start/end lines, including both `null` fallbacks;
    - default mode Auto, and the mode sent in the body;
    - an empty wish → field error and no fetch;
    - inputs disabled while searching, with a fetch that hangs until resolved;
    - close during search → the fetch signal is aborted and no error is shown;
    - cards render title, description, duration, place, ≤ 3 images with `referrerpolicy="no-referrer"` and the alt pattern, and no `originalUrl` anywhere in the DOM;
    - the marker only on `verified: false`;
    - ticking via the card;
    - search again → ticks cleared and the list replaced;
    - footer count text;
    - with `onApply`: disabled at 0, enabled at 1, called with the ticked suggestions in order; without `onApply`: no apply button;
    - each error mapping, including a non-JSON 504 body and a thrown fetch, with the wish still filled afterwards;
    - the discard confirm only with ticks.
  - [x] 5.2 New `test/tripDayViewSuggestionsEntry.test.tsx`, following the `stubDay` / `tripDetail(accessRole)` pattern of `test/tripDayViewDayChange.test.tsx` (`renderDay` around :272). Cover: owner + enabled → button shown; contributor + enabled → shown; viewer + enabled → not shown; owner + disabled or prop absent → not shown; clicking opens the dialog (by its title). Stub the dialog with `vi.mock` only if rendering it adds noise; the five existing `tripDayView*.test.tsx` files must stay **unedited** and green, which proves the default `false` changes nothing.
  - [x] 5.3 Mutation discipline (6.31): remove `canEditPlanning` from the button condition; drop `referrerPolicy`; stop clearing ticks on a new search; enable *Übernehmen* at 0. Each one must turn a test red. Record them in the Debug Log.
- [x] **Task 6: i18n and docs (AC: 9, 10)**
  - [x] 6.1 Keys under `trips.suggestions.*` in both dictionaries (flat dotted keys, as in the rest of the files). German first, as listed in *Copy* below.
  - [x] 6.2 `docs/deployment-configuration.md`, *AI day suggestions* section: one sentence that the browser loads the thumbnails with `no-referrer`, so Wikimedia sees members' IP addresses but not which page they came from, and that the app sets no CSP, so nothing needs adding. Then mark **DW-387** `status: resolved (Story 12.3)` in `deferred-work.md`, with a one-line note.
- [x] **Task 7: Gates and a browser check.** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run check:migrations`, `next build` (proves no `server-only` import leaked into the client dialog). Then, in a browser at 390 px and at desktop width: full-screen on the phone with the footer reachable, the header buttons wrapping cleanly, a real or mocked result list scrolling, and thumbnails loading. Record what was checked. With Tommy's key available, run one real search and note the time it took (this also closes the measurement half of DW-388, so record it there).

### Review Findings

Code review 2026-10-16 (Blind Hunter, Edge Case Hunter, Acceptance Auditor) on `08e7cbc`: 0 decision-needed, 4 patch, 0 defer, 25 dismissed (server already validates the response and `durationMinutes` 10–600, thumbnails are deduplicated by file name, "up to a minute" and the cleared list on error are the spec's own choices, no `viewport-fit=cover` so safe-area insets do not apply, a "prompt too long" server reply cannot happen behind the 500-character field cap).

- [x] [Review][Patch] The results group loses its accessible name during a repeat search: `resultsText` is `""` while `searching`, but the old list (`role="group" aria-labelledby`) is still on screen. Keep the last count while the stale list is shown [travelplan/src/components/features/trips/TripDaySuggestionsDialog.tsx:253]
- [x] [Review][Patch] Thumbnail alt text keeps "n of total" from before failed pictures were removed, and an all-failed strip keeps its empty `mt` box. Number only the visible pictures and return `null` when none load [travelplan/src/components/features/trips/TripDaySuggestionsDialog.tsx:557]
- [x] [Review][Patch] The wish field hard-codes `maxLength: 500` beside the comment that says the client uses the server's own rule. Take it from `suggestionsRequestSchema.shape.prompt.maxLength` [travelplan/src/components/features/trips/TripDaySuggestionsDialog.tsx:340]
- [x] [Review][Patch] The abort test's final `waitFor(... suggestions-error toBeNull)` passes on its first poll, so it cannot catch an error banner that shows up late after an abort. Let the aborted fetch settle (release or reject the hanging promise) before asserting [travelplan/test/tripDaySuggestionsDialog.test.tsx:192]

## Dev Notes

### Copy (de / en)

| Key (suffix of `trips.suggestions.`) | de | en |
|---|---|---|
| `openAction` | Ideen finden | Find ideas |
| `dialogTitle` | Ideen für den Tag | Ideas for the day |
| `startLabel` / `endLabel` | Start / Ziel | Start / End |
| `startTripFallback` | Startort der Reise | The trip's starting point |
| `endNone` | Keine Unterkunft | No stay |
| `promptLabel` | Was willst du heute erleben? | What would you like to do today? |
| `promptRequired` | Beschreib kurz, was du erleben willst. | Say briefly what you would like to do. |
| `modeLabel` | Fortbewegung | Getting around |
| `modeCar` / `modeWalking` / `modeCycling` | Auto / Zu Fuß / Fahrrad | Car / On foot / Bike |
| `search` / `searching` | Suchen / Suche läuft … | Search / Searching … |
| `searchingHint` | Das kann bis zu einer Minute dauern. | This can take up to a minute. |
| `resultsOne` / `results` | 1 Idee gefunden / {count} Ideen gefunden | 1 idea found / {count} ideas found |
| `selectedNone` / `selectedOne` / `selected` | Noch nichts ausgewählt / 1 ausgewählt / {count} ausgewählt | Nothing selected yet / 1 selected / {count} selected |
| `apply` | Übernehmen ({count}) | Add ({count}) |
| `unverified` | Ort nicht bestätigt | Location not confirmed |
| `imageAlt` | Foto zu {title}, Bild {n} von {total} | Photo of {title}, image {n} of {total} |
| `durationMinutes` / `durationHours` | ca. {minutes} min / ca. {hours} h | about {minutes} min / about {hours} h |
| `errorFailed` | Gerade konnten keine Ideen gefunden werden. Bitte versuch es später noch einmal. | No ideas could be found just now. Please try again later. |
| `errorLimit` | Für heute sind alle Suchen aufgebraucht. Morgen geht es wieder. | You have used all of today's searches. Try again tomorrow. |
| `errorUnavailable` | Die Ideensuche ist gerade nicht eingerichtet. | Idea search is not set up right now. |

The results count never shows 0 (the server returns 3–8 or an error), but keep `results` correct for any n ≥ 2.

### Response contract (read-only here)

```ts
// POST /api/trips/[id]/days/[dayId]/suggestions  body { prompt: string (1–500, trimmed), mode: "car"|"walking"|"cycling" }
// 200 { data: { suggestions: DaySuggestion[] }, error: null }   // 3–8 entries
type DaySuggestion = {
  title: string; description: string; locationLabel: string;
  lat: number; lng: number; durationMinutes: number;   // integer 10–600
  wikiTitle?: string; verified: boolean;
  images: Array<{ thumbnailUrl: string; originalUrl: string }>;   // 0–3; thumbnails on thumb.wikimedia.org (or upload.* when ≤ 250 px)
};
```
Errors: `401 unauthorized`, `403 csrf_invalid | forbidden`, `404 not_found`, `400 invalid_json | validation_error`, `429 ai_limit_reached`, `502 ai_failed`, `503 ai_unavailable`, `500 server_error` (`suggestions/route.ts:59-132`). Keep the full `DaySuggestion` objects in state, `lat`/`lng`/`originalUrl` included: 12.4's apply receives the ticked objects back.

### What must not regress

- The five `test/tripDayView*.test.tsx` files: unedited and green.
- Every existing `DialogShell` consumer: unchanged rendering (the new prop defaults to `false`).
- The section header for viewers: still no action at all.
- `MiniImageStrip`, `resolveApiError`, the route and the schemas: unchanged. This story changes no server code.
- `page.tsx` already passes `aiSuggestionsEnabled` (`src/app/(routes)/trips/[id]/days/[dayId]/page.tsx:15-18`); do not touch it.

### Architecture compliance

- Client code calls only our own API. It never calls Wikimedia's API, only renders the thumbnail URLs.
- Raw `fetch` with `credentials: "include"` and the `x-csrf-token` header (no shared client helper exists; `src/lib/http/` is server-only code).
- `"use client"` components must not import Prisma, `server-only` or `@/lib/ai/*`.
- Component conventions: a dialog in its own file under `components/features/trips/`, `DialogShell` chrome, `useOpenInstanceKey` for a fresh state per open, `useDiscardGuard` for the one close confirmation, theme `tokens` (no new hex literals; DW-12).

### Testing standards

Vitest 3.2 + Testing Library, `test/` folder, camelCase `*.test.tsx`, `renderWithProviders`, `stubFetch` / `mockFetchResponse` / `requestUrl` from `test/helpers/mockFetch.ts`. Do not mock the i18n provider; assert on the German or English text the provider renders (check which language `renderWithProviders` defaults to). Write each test red first.

### Previous story intelligence

- 12.1: the real search returned 5 suggestions, 4 of them **unverified**, and one duplicate (now dropped server-side). So the marker will be common. Make it calm, not alarming, which is another reason not to use warn.
- 12.2: thumbnails come from `thumb.wikimedia.org` (Deviation 1). In the live run, 5/5 places got 3 pictures in 1.9 s, and one first picture was unrelated ("cracked earth"). The pictures are hints, not proof.
- 12.2 review deferred DW-387 to this story (referrer, CSP, docs) and DW-388 (real-key timing). Task 6.2 closes DW-387. Task 7 can close DW-388's measurement.
- Gate baseline after 12.2: **185 files / 3040 tests**, tsc 0, lint 0 errors / 80 warnings.

### Git intelligence

`f917a7a` (12.1) added the route, schemas and the `aiSuggestionsEnabled` prop. 12.2 is uncommitted. `b9df833`/`cfb5690` (Epic 11) last touched TripDayView's day-change notice and dialogs. Follow their dialog wiring (keyed instances, guarded handlers), not older inline-dialog code.

### Latest technical information (2026-10-16)

- MUI 7: use `slotProps.htmlInput` (not `inputProps`) on `TextField` and `slotProps.input` on `Checkbox`, matching existing code. `ToggleButtonGroup` with `exclusive` calls `onChange(event, null)` when the active button is pressed again, so ignore `null`.
- `referrerPolicy` on `<img>` is a standard React DOM prop (`referrerPolicy="no-referrer"`). In jsdom assert it as the attribute `referrerpolicy`.

### Project Structure Notes

New: `src/components/features/trips/TripDaySuggestionsDialog.tsx`, `src/lib/trips/approxDuration.ts`, `test/tripDaySuggestionsDialog.test.tsx`, `test/tripDayViewSuggestionsEntry.test.tsx`, `test/approxDuration.test.ts`.
Updated: `src/components/ui/DialogShell.tsx` (one optional prop), `src/components/features/trips/TripDayView.tsx` (prop, button, dialog), `src/i18n/en.ts`, `src/i18n/de.ts`, `docs/deployment-configuration.md`, `_bmad-output/implementation-artifacts/deferred-work.md` (DW-387).

### Questions for Tommy (not blocking; the defaults above apply)

1. ***Übernehmen* until 12.4 ships (item 5).** The default hides the button and shows only the "n ausgewählt" line. That way 12.3 can ship on its own without a button that does nothing. The alternative is a visible but disabled button with a "kommt bald" hint. Recommendation: hide it, and 12.4 follows straight after.
2. **Start place on day 1 (item 7).** Without a previous stay, the dialog says "Startort der Reise" without naming it, although the server sends the real label to Claude. Naming it means adding `startLocationLabel` to the trip detail payload (route and repo type, plus the tests that pin that payload's keys). Recommendation: leave it out for now.
3. **Results are lost on close.** Each open starts fresh (house rule, `useOpenInstanceKey`), and a closed dialog throws away a paid search. Ticks are protected by a confirm, but an unticked result list is not. The alternative is keeping the last result in `TripDayView` state for the rest of the page visit. Recommendation: start fresh; revisit if it annoys in use.

### References

- [epics.md — Story 12.3](../planning-artifacts/epics.md) · [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) R3, R5, D3
- DESIGN.md:230-237 (tokens, reserved warn), :270-272 (card, photo strip), :281-282 (tabs, buttons), :289-291 (close, field error), :306-313 (checkbox, candidate list, live count), :320 (alt text); EXPERIENCE.md:19, :70-74, :83-90, :107-111
- TV:307 (TripSummary), :478-479 (prop), :570 (signature), :774 (`canEditPlanning`), :930 (`resolveApiError`), :1134 (`ensureCsrfToken`), :1557 (POST pattern), :2093-2094 (stays), :2333 (duration helper), :4094-4117 (section header), :4752 (dialogs)
- `src/components/ui/DialogShell.tsx:57` (`useOpenInstanceKey`), :66 (props), :233 (breakpoint rule); `src/components/ui/DiscardChangesDialog.tsx`; `src/components/features/trips/TripDayPlanItemContent.tsx:162-230` (strip geometry)
- `src/lib/validation/daySuggestionSchemas.ts:9-17, 138-154`; `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`
- `src/i18n/index.ts`, `src/i18n/provider.tsx:126-143`, `test/i18nDictionaries.test.ts`
- `test/tripDayViewDayChange.test.tsx` (stubDay, renderDay), `test/helpers/mockFetch.ts`, `test/helpers/renderWithProviders`
- `docs/deployment-configuration.md` *AI day suggestions*; `deferred-work.md` DW-387, DW-388

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-16.

### Debug Log References

- Baseline (Task 0): 185 files / 3040 tests green on 3140a60 plus the uncommitted 12.2 tree. 12.2 was committed afterwards at Tommy's request as `072fe85`, without `.env` (a trailing newline only) and the dev.db backup. The three shared files (`sprint-status.yaml`, `deferred-work.md`, `deployment-configuration.md`) were split, so 12.2's commit holds only its own hunks.
- Task 2 mutation: rounding to 15 instead of 30 minutes turned 8 of 13 `approxDuration` tests red.
- Task 5.3 mutations, each run and reverted:
  1. `(canEditPlanning || aiSuggestionsEnabled)` as the header condition: `tripDayViewSuggestionsEntry` 1 red (viewer).
  2. `referrerPolicy` removed: `tripDaySuggestionsDialog` 1 red (card rendering).
  3. `setTicked(new Set())` removed from the search start: 1 red (search again).
  4. *Übernehmen* `disabled={searching}` only: 1 red (`onApply` case).
- First DialogShell attempt used per-property breakpoint objects with `borderRadius: { xs: 0, sm: undefined }`. That leaves the radius at 0 on every width (the `xs` rule is `min-width: 0` and nothing overrides it), so it became one `theme.breakpoints.down("sm")` block that restates nothing at `sm`+.
- Gates: 188 files / 3097 tests, `tsc --noEmit` 0, lint 0 errors / 80 warnings (baseline unchanged), `check:migrations` passes, `next build` succeeds (no `server-only` import reached the client dialog).
- Task 7 manual check (Tommy, 2026-10-16, desktop, dev server, real key): one real search took **about 15 s** and returned cards with text and pictures. **The 390 px check was not done.** Tommy accepted the phone layout unchecked ("wird schon passen"). It can be checked without a phone in DevTools device mode at 390 px. The jsdom test only proves the phone-only CSS rule exists, not how it looks.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- `DialogShell` gains `fullScreenOnPhone` (default `false`). Below `sm` the paper drops its margin, radius and border and fills the height; `sm`+ and every existing consumer are unchanged. Covered by reading emotion's injected rule for the paper class (present with the prop, absent without).
- `formatApproxDuration` rounds to 5 min below an hour and to the half hour above. A value that rounds up to 60 reads "ca. 1 h", not "ca. 60 min" (59 → 1 h, 57 → 55 min).
- `TripDaySuggestionsDialog` follows read-first items 1–12. *Suchen* is an outlined submit in the body. *Übernehmen (n)* appears only with `onApply` and is also disabled while a new search runs. The count line is always in the footer. Errors go to a warn `Alert` at the top of the body; a `validation_error` naming `prompt` goes to the field instead. A non-JSON 502/504 maps to `errorFailed`. Aborts on close and on unmount, and ignores the aborted result. No client timeout.
- Cards: a `label` wrapping an MUI `Checkbox` (named by the title, described by the place/duration/marker line). The ticked state uses the accent border. The *Ort nicht bestätigt* pill is on `pillNeutral` with a pin-with-question glyph. Thumbnails are plain `<img>` with the 56 px strip geometry, `no-referrer`, lazy, async decode, and hide themselves on error. `originalUrl` never reaches the DOM (asserted on `innerHTML`).
- Discard guard: one added key pair, `trips.suggestions.discardBody` ("Deine Auswahl geht verloren." / "Your selection will be lost."). The generic "Deine Änderungen werden verworfen." does not name a selection.
- Day start/end: `previousStay` / `currentStay` as "name · place", with the place only when it differs from the name. The fallbacks follow item 7. The dialog's sub-line is the same `trips.plan.title` the activity dialog uses ("Tag 2 Plan").
- Mode toggle follows the auth-tabs pattern: `paperOuter` track, 4 px padding, 44 px options, `card` active fill. MUI's shadow literal is not repeated, so no colour literal is added.
- The 16 px iOS input rule applies to the multiline field as well: the theme sets it on the `MuiInputBase` input slot, which the `<textarea>` also is.
- The five existing `test/tripDayView*.test.tsx` files are unedited and green. The new entry suite stubs the three authoring dialogs (their rich-text editor does not run in jsdom) and renders the real suggestion dialog.
- DW-387 is closed (`deferred-work.md`), and the docs gained the `no-referrer` / no-CSP paragraph. DW-388 is closed: the real-key search took about 15 s, far inside the 90 s proxy timeout.

### File List

New:
- `travelplan/src/components/features/trips/TripDaySuggestionsDialog.tsx`
- `travelplan/src/lib/trips/approxDuration.ts`
- `travelplan/test/tripDaySuggestionsDialog.test.tsx`
- `travelplan/test/tripDayViewSuggestionsEntry.test.tsx`
- `travelplan/test/approxDuration.test.ts`

Modified:
- `travelplan/src/components/ui/DialogShell.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `docs/deployment-configuration.md`
- `_bmad-output/implementation-artifacts/deferred-work.md` (DW-387)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/12-3-look-through-the-ideas-and-tick-the-good-ones.md`

### Change Log

- 2026-10-16: Tasks 1–6 implemented and tested: DialogShell full-screen option, duration formatter, suggestion dialog, day-view entry point, i18n, docs and DW-387. Task 0 (commit 12.2) and the manual half of Task 7 (browser check, real-key search) are open, so the story stays in-progress.
- 2026-10-16: Task 0 closed: 12.2 committed as `072fe85`. Only the manual half of Task 7 is open.
- 2026-10-16: Task 7 closed: a real search took about 15 s (DW-388 closed). The 390 px layout is unchecked, accepted by Tommy. Status → review.
- 2026-10-16: Code review (3 layers): 4 low patches applied (results group keeps its name during a repeat search, thumbnail alt counts only visible pictures and an all-failed strip goes, wish maxLength from the schema, abort test now lets the fetch settle), 25 dismissed. Status → done.
