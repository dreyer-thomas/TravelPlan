---
authored_against: f990054
baseline_commit: f99005498ecded7bc60b4d09e7bf1ece74ec4cba
---

# Story 6.28: Coordinates by Hand, and a Choice of Places

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Reported from real use on production, 2026-08-06

Two complaints, one field, two different causes. Both are in the code and neither is a flake.

**"For some activities it just does not find the position — it only ever offers wrong places."**
[`api/geocode/route.ts`](../../travelplan/src/app/api/geocode/route.ts) asks Nominatim with `limit=1` and then takes `body[0]` unconditionally. There is exactly one candidate and the user never sees it as a candidate — it is simply adopted. For a street address that is usually right. For an activity name (*"Sky Tower"*, *"Hafenrundfahrt"*) Nominatim returns the best *name* match anywhere on earth, and the app pins it silently.

**"Then I would rather type the coordinates myself — Google Maps gives them to me. It does not accept them."**
There is no coordinate input anywhere. Each dialog has **one** free-text field plus a *Find* button, and `lat`/`lng` are only ever set from a geocoder response (`setResolvedLocation(...)`, e.g. `TripDayPlanDialog.tsx:1525`). A typed `-36.8485, 174.7633` is sent to Nominatim as a search string; `/search` does not resolve a bare pair, the answer is `result: null`, and the user is told no place was found.

**The write path is already able to store this.** `locationInputSchema` (`src/lib/validation/locationSchemas.ts`) accepts `{lat, lng, label}` and range-checks both numbers; the database, the maps, the print path and the backup archive all carry arbitrary coordinates today. No migration, no schema change, no server-side model change. **This story is entirely about the way in.**

## Story

As a traveller planning an activity the geocoder cannot find,
I want to paste or type coordinates from Google Maps, and to pick from real search results when I do search,
so that a pin lands where I mean it instead of somewhere with a similar name.

## Acceptance Criteria

1. **AC1** — A coordinate pair entered in the place field is accepted and sets the location **without any network request**. `48.8584, 2.2945` and `48.8584,2.2945` both work, leading `+`/`-` included.
2. **AC2** — A pasted Google Maps URL is accepted the same way. Both shapes people actually produce resolve: the `@lat,lng,zoom` form from the address bar and a `q=`/`query=` parameter carrying a pair. A URL that carries no pair is treated as an ordinary search term, not as an error.
3. **AC3** — The decimal-separator rule is explicit and documented in the UI. A German keyboard produces `48,8584`, which makes `48,8584, 2,2945` genuinely ambiguous. The parser must resolve the common unambiguous cases and **refuse** the ambiguous ones with a message that says what to type instead — never guess.
4. **AC4** — A pair that parses but is out of range (`lat` outside ±90, `lng` outside ±180) produces a visible error and sets nothing. A silently wrong pin is the failure this story exists to remove; it must not be replaced by a differently wrong one.
5. **AC5** — A place search returns **several** candidates and the user picks one. Nothing is adopted without a choice when more than one candidate exists. A single candidate may be adopted directly; zero candidates keeps today's "no matching place" message.
6. **AC6** — All four surfaces behave identically: trip create (start **and** destination), activity dialog, accommodation dialog, bucket-list panel. The parsing lives in **one** module under `src/lib/trips/`; no copy of it exists in a component.
7. **AC7** — Every user-facing string exists in both dictionaries. The eight already-present but unused `trips.location.*` keys are reused where they fit rather than duplicated under new names.
8. **AC8** — Existing behaviour is preserved: *Clear* still empties the location, the read-only `Latitude: … · Longitude: …` line still reflects what will be saved, and a location resolved by search still stores the geocoder's label.

## Tasks / Subtasks

- [ ] `src/lib/trips/parseLocationInput.ts` — NEW, the single source of truth. One exported function taking the raw field text and returning a discriminated result: a coordinate pair, "not a coordinate — treat as a search term", or a named parse failure (ambiguous separator, out of range). Place it beside `formatCost.ts` and `transportTypes.ts`, the two existing precedents for shared pure helpers — AC1, AC2, AC3, AC4, AC6
- [ ] `src/lib/trips/parseLocationInput.ts` — the Google Maps shapes. Extract from `@<lat>,<lng>,<zoom>z` in the path and from a `q=` / `query=` / `ll=` query parameter. Anything else that happens to be a URL falls through to the search-term branch, **not** to an error — AC2
- [ ] `src/app/api/geocode/route.ts` — raise `limit` from `1` to `5` and return `results: [...]` instead of `result: {...} | null`. Keep every existing guard unchanged: the session check, the empty-query 400, the 200-character cap, the `User-Agent` header (Nominatim's usage policy requires a real one) and the `no-store` cache. Raising `limit` does not raise the request count — AC5
- [ ] `src/components/features/trips/TripDayPlanDialog.tsx` — call the parser **before** `fetch`. A coordinate result sets `resolvedLocation` directly and returns; a search term goes to the route as today and now renders a candidate list. `handleLookupLocation` is at `:1496` — AC1, AC2, AC5
- [ ] `src/components/features/trips/TripAccommodationDialog.tsx` (`:1222`), `src/components/features/trips/TripBucketListPanel.tsx` (`:253`, **two** fetch sites at `:263` and `:296`), `src/components/features/trips/TripCreateForm.tsx` (`:370`, one handler serving both `start` and `destination`) — the same change. That is **five** call sites across four files; the handler is copy-pasted today and the copies must not diverge further — AC6
- [ ] The candidate list UI — one presentation, used by all four surfaces. It appears under the search row that already exists (`TripDayPlanDialog.tsx:2148-2178` is the canonical block: `FormField` + *Find* + *Clear*, then the read-only coordinate line). Picking a candidate does exactly what the current success path does — set `resolvedLocation`, write the label into the query field — AC5, AC8
- [ ] `src/i18n/en.ts`, `src/i18n/de.ts` — the new strings, plus **put the orphans to work**. These eight keys already exist in both dictionaries and have **zero** consumers in `src/`: `latHelper`, `lngHelper`, `labelLabel`, `labelHelper`, `latInvalid`, `lngInvalid`, `coordinatesRequiredTogether`, `searchHelper`. `latInvalid` / `lngInvalid` are already worded exactly for AC4; `searchHelper` is the natural home for AC3's "what to type instead". Reuse them, and delete any that still have no consumer when the story ends rather than leaving a third generation of dead keys — AC7
- [ ] `test/geocodeRoute.test.ts` — the route's new shape: several candidates returned in order, a single candidate, zero candidates, and every existing guard still answering as before — AC5
- [ ] `test/` — a dedicated suite for `parseLocationInput`, table-driven: the accepted forms, both Google Maps shapes, the ambiguous-comma refusals, the out-of-range refusals, and the "this is a search term" fall-through. This is a pure function, so the table is the cheap place to make the rules explicit — AC1, AC2, AC3, AC4
- [ ] `test/tripDayPlanDialog.test.tsx` and the sibling dialog suites — a coordinate entry sets the location **with no `fetch` call at all** (assert the mock was not called; that is what proves AC1 rather than merely producing the right numbers), and a search with several candidates adopts none until one is picked — AC1, AC5

## Dev Notes

### The comma is the whole difficulty (AC3)

On a German keyboard `48,8584` is the natural spelling, and then the comma is both the decimal separator **and** the pair separator. `48,8584, 2,2945` cannot be resolved by counting commas alone.

This project has already been bitten by exactly this class and has a story open about it: **6.27 "A Comma Is a Decimal Point"** (`ready-for-dev`), which documents five money fields where a German comma silently produced an empty value and a saved zero. Read its Dev Notes before designing the rule here — not for the code, for the failure mode.

Two hard requirements that follow:

- **Do not route coordinates through the money parser.** 6.27 moves one amount parser into `src/lib/trips/`, and it rounds to two decimals and multiplies by 100. Coordinates need six decimals and no scaling. 6.27 makes this same point about the travel-segment *distance* field for the same reason — this is the second instance, not a new idea.
- **Refuse rather than guess.** Where the input is genuinely ambiguous the answer is an error naming the accepted spelling. A parser that picks an interpretation reintroduces the silent-wrong-pin bug through the front door.

A workable rule, offered rather than mandated: treat a semicolon or whitespace as an unambiguous pair separator (`48,8584; 2,2945` and `48,8584 2,2945` both resolve under German spelling), accept a single comma as the pair separator when both halves use dots, and refuse the rest. Whatever rule ships, `searchHelper` must state it.

### Sequencing with 6.27

Both stories touch decimal parsing and both want a home under `src/lib/trips/`. Prefer landing **6.27 first** — it is already `ready-for-dev` and it establishes the house rule. If this story lands first, it must not pre-empt 6.27's decisions: create only the coordinate parser, leave the money fields alone, and do not create a shared "number parsing" module that 6.27 would then have to fight.

### Five copies of one handler

`handleLookupLocation` exists five times over four files, byte-similar each time: read the query, `fetch("/api/geocode?q=…")`, branch on `body.error`, branch on `result === null`, `setResolvedLocation`, write the label back into the field. Changing the route's response shape touches all five. Two of them sit in `TripBucketListPanel.tsx` alone (`:263` and `:296`).

This story does **not** ask for those five to be refactored into one component — that is a larger change than the problem warrants and would collide with four in-flight dialog stories. It asks that the **parsing** live once. Keep the five handlers, give them one parser and one candidate-list presentation.

### The eight orphaned keys are a signal, not just a convenience

`latHelper`, `lngHelper`, `labelLabel`, `labelHelper`, `latInvalid`, `lngInvalid`, `coordinatesRequiredTogether` and `searchHelper` exist in both dictionaries with no consumer anywhere in `src/`. Their wording — *"Enter a value between -90 and 90"*, *"Latitude and longitude must both be provided"*, *"Location label (optional)"* — describes a manual coordinate form that was designed and then never built, or built and removed. The vocabulary for this story was written before the story was.

Reuse what fits. Anything still unused at the end of this story should be deleted, with the deletion pinned the way `5-11`'s review pinned its two removed keys — a key that survives two features without a consumer will survive a third.

### What must not regress

- **The read-only coordinate line.** `Latitude: {lat.toFixed(6)} · Longitude: {lng.toFixed(6)}` renders in all four surfaces (`TripDayPlanDialog.tsx:2175`, `TripAccommodationDialog.tsx:1958`, `TripBucketListPanel.tsx:690`, `TripCreateForm.tsx:552` and `:602`). It is the only feedback that a pin was set; six decimals stay.
- **`Clear`.** `setResolvedLocation(null)` must still empty the location, including after a manual coordinate entry.
- **The stored label.** A search-resolved location keeps the geocoder's `display_name` (truncated to 200 by the route, and `labelSchema` caps it again). A manually entered pair has no `display_name` — give it the formatted pair as its label so lists and map popups have something to show. `label` is optional and nullable in the schema, so an empty one is legal, but a nameless pin reads as a bug on the trip overview.
- **The dirty-guard.** Each dialog folds `resolvedLocation` into its unsaved-changes model. Setting a location by parse rather than by fetch must mark the form dirty exactly as the fetch path does, or a coordinate typed and then dismissed is lost without a prompt.

### Traps

1. **Fixing the parser and leaving `limit=1`.** The coordinate half is the satisfying half and it is the smaller one. The "wrong places" complaint is *only* fixed by AC5. Both halves ship or neither does.
2. **Asserting the numbers instead of the absence of the request.** A test that types coordinates and checks `lat`/`lng` passes even if the value came from a geocoder round trip. Assert the `fetch` mock was **not** called — that is AC1's actual content.
3. **Treating any URL as an error.** Someone will paste a link to a hotel page. That is a search term, not a failure.
4. **Silently swapping lat and lng.** Google gives `lat, lng`; some tools give the reverse. There is no way to detect the swap when both values are valid latitudes, so do not try — state the order in `searchHelper` and show the parsed pair back to the user before saving, which the existing read-only line already does.
5. **Nominatim etiquette.** The `User-Agent` header is required by its usage policy and the existing route sets it. Raising `limit` is free; adding per-keystroke lookups would not be. Keep the explicit *Find* button — do not make this a type-ahead.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`, one file per subject. Route suites drive the exported handler directly (`test/geocodeRoute.test.ts` is the existing one for this route); dialog suites use `renderWithProviders` with `// @vitest-environment jsdom`. The parser suite is a plain node-environment table test — no DOM needed.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

One new module (`src/lib/trips/parseLocationInput.ts`), one new test file for it, edits to one API route, four components and both dictionaries. No new dependency: the Google Maps forms are extracted with `URL` and a regular expression, not with a library. No migration, no schema change — `locationInputSchema` already accepts and validates what this story produces.

### References

- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 6.28: Coordinates by Hand, and a Choice of Places]
- The decimal-comma failure mode: [Source: _bmad-output/implementation-artifacts/6-27-a-comma-is-a-decimal-point.md]
- Location model and range validation: `travelplan/src/lib/validation/locationSchemas.ts`
- The geocoding route as it stands: `travelplan/src/app/api/geocode/route.ts`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
