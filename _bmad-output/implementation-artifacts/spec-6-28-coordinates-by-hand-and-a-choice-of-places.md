---
title: 'Story 6.28: Coordinates by Hand, and a Choice of Places'
type: 'feature'
created: '2026-08-07'
status: 'done'
baseline_revision: '8d06abb'
final_revision: '5b950f7'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/6-28-coordinates-by-hand-and-a-choice-of-places.md'
warnings: ['oversized', 'multiple-goals']
---

<intent-contract>

## Intent

**Problem:** The place field has exactly one way in, and it is wrong twice. `api/geocode` asks Nominatim
with `limit=1` and adopts `body[0]` unconditionally, so an activity name pins the best *name* match
anywhere on earth with no candidate ever shown; and there is no coordinate input at all, so a pasted
`-36.8485, 174.7633` is sent to `/search` as a search string and comes back "no matching place found".

**Approach:** One new pure parser under `src/lib/trips/` runs **before** the fetch at all five lookup call
sites: a coordinate pair (typed, or extracted from a Google Maps URL) resolves with no network request at
all; anything else falls through to the route, which now returns up to five candidates as an array and
adopts none of them when there is more than one. No schema change, no migration — `locationInputSchema`
already accepts and range-checks `{lat, lng, label}`.

## Boundaries & Constraints

**Always:**
- Parsing lives in **exactly one** module (`src/lib/trips/parseLocationInput.ts`). No component re-implements
  any part of it; the candidate list has **one** implementation shared by all four surfaces.
- **Refuse rather than guess.** Where a decimal/pair separator reading is genuinely ambiguous, the answer is
  a visible error naming the accepted spelling. A parser that picks an interpretation reintroduces the
  silent-wrong-pin bug through the front door.
- Coordinates never route through `parseAmount.ts`. It rounds to two decimals, multiplies by 100, rejects a
  leading `-`, and reads `1,000` as one — every one of those is wrong for a coordinate.
- A coordinate parse issues **zero** network requests, and marks the form dirty exactly as the fetch path does.
- Every guard in `api/geocode/route.ts` survives unchanged: session check, empty-query 400, 200-character cap,
  the `User-Agent` header (Nominatim's usage policy requires a real one), `cache: "no-store"`, the 502/500
  branches. One Nominatim request per *Find*, exactly as today — raising `limit` does not raise the count.
- Both dictionaries stay key-identical, and every new string is added to both.
- The candidate list is built from `Box`, `Button` and `Typography` only. `test/tripDayPlanDialog.test.tsx`
  mocks `@mui/material` with an **exhaustive** factory that throws on an undeclared export — `List`,
  `ListItem`, `ListItemButton`, `MenuItem` and `Stack` are not in it.

**Block If:**
- Delivering this needs a Prisma migration, a change to `locationSchemas.ts`, or a change to any server-side
  write schema. The story asserts none is needed; if one is, the intent was mis-scoped.
- The candidate list cannot be built without more than one Nominatim request per *Find* (a type-ahead is
  explicitly out of scope).

**Never:**
- No type-ahead / per-keystroke lookup. The explicit *Find* button stays.
- No refactor of the five `handleLookupLocation` copies into one component — that collides with four in-flight
  dialog stories. The **parsing** is consolidated; the five handlers stay five.
- No lat/lng swap detection. Two valid latitudes are indistinguishable; state the order in the helper instead.
- No separate latitude / longitude / label input boxes. The eight orphaned keys are a vocabulary to draw from,
  not a form to build.
- No treating a URL as an error. A pasted hotel link is a search term.

## I/O & Edge-Case Matrix

`parseLocationInput(raw)` → `{status:"coordinates",lat,lng}` | `{status:"search"}` | `{status:"ambiguous"}` |
`{status:"out_of_range",field:"lat"|"lng"}`

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pair, dots, spaced | `48.8584, 2.2945` | `coordinates` 48.8584 / 2.2945 | No error expected |
| Pair, dots, tight | `48.8584,2.2945` | `coordinates` — one comma is the pair separator | No error expected |
| Signed pair | `-36.8485, +174.7633` | `coordinates` -36.8485 / 174.7633 | No error expected |
| German decimals, semicolon | `48,8584; 2,2945` | `coordinates` — `;` is unambiguous | No error expected |
| German decimals, space | `48,8584 2,2945` | `coordinates` — whitespace is unambiguous; a trailing `,`/`;` on the left half is punctuation | No error expected |
| Integer pair | `48, 2` | `coordinates` 48 / 2 | No error expected |
| Ambiguous comma soup | `48,8584,2,2945` / `48,8584,2.2945` | `ambiguous` | Caller shows `trips.location.coordinatesAmbiguous`, sets nothing |
| Google Maps address bar | `https://www.google.com/maps/@48.8584,2.2945,17z/data=…` | `coordinates` from the `@` segment | No error expected |
| Google Maps query param | `…/maps?q=48.8584,2.2945` (also `query=`, `ll=`) | `coordinates` | No error expected |
| URL with no pair | `https://hotel.example/rooms` | `search` | No error — ordinary search term |
| Lat out of range | `91.0, 2.0` | `out_of_range` field `lat` | Caller shows `trips.location.latInvalid`, sets nothing |
| Lng out of range | `48.0, 181.0` | `out_of_range` field `lng` | Caller shows `trips.location.lngInvalid`, sets nothing (lat is checked first) |
| Place name | `Sky Tower` / `Hafenrundfahrt` | `search` | No error expected |
| Lone number | `48.8584` | `search` — not a pair, so it is a search term as today | No error expected |
| Empty / whitespace | `""` / `"   "` | `search` (parser is total; callers still gate empty with `searchRequired` first) | No error expected |
| Route: several matches | Nominatim returns 5 | `ok({results:[…5…]})`, order preserved | — |
| Route: one match | Nominatim returns 1 | `ok({results:[one]})`; caller adopts it directly | — |
| Route: no match, or all non-finite coords | `[]` / unusable rows | `ok({results:[]})`, status 200 | Caller shows `trips.location.noResult` |
| UI: several candidates | `results.length > 1` | Candidate list renders; **nothing** is adopted until a row is activated | — |

</intent-contract>

## Code Map

- `travelplan/src/lib/trips/parseLocationInput.ts` -- **new.** The single source of truth; beside `formatCost.ts`
  and `parseAmount.ts`, the two existing precedents for shared pure helpers.
- `travelplan/src/components/features/trips/LocationCandidateList.tsx` -- **new.** The one candidate presentation.
- `travelplan/src/app/api/geocode/route.ts` -- `limit` at `:52`; `ok({ result })` at `:73-75`; the two
  `ok({ result: null })` returns at `:64` and `:70`; guards at `:29-41`, `:57-59`, `:83-85`. Module-local
  `NominatimResult` uses `lon`, not `lng`.
- `travelplan/src/lib/validation/locationSchemas.ts` -- unchanged. `lat` ±90, `lng` ±180, `label` trimmed and
  capped at 200, optional **and** nullable. Only `locationInputSchema` and `LocationInput` are exported.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- `handleLookupLocation` `:1476-1515`; state
  `:602-606` (`resolvedLocation`, `locationQuery`, `lookupLoading`); search row `:2129-2165` inside the
  `when` tabpanel; `Clear` `:2150-2157` clears the coordinate only; coordinate readout `:2159-2163`; errors go
  to `setServerError` (rendered at `:1851`); dirty fingerprint `planFormFingerprint` `:519-532` + memo `:1319-1345`.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- handler `:1228-1266` (pending flag
  `isGeocoding`); state `:380-384`; open-effect seeding `:609-620`; search row `:1942-1980` in the `place`
  tabpanel; dirty key comparison `:1585-1591`; the stale label-truncation docblock at `:121-135` (the route has
  sliced to 200 since, worth correcting while here).
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- **two** fetch sites:
  `handleLookupLocation` `:255-296` (reads RHF's watched `positionText`, sets `resolvedLocationQuery`) and the
  silent submit-time `attemptGeocode` `:298-320`, called from `onSubmit` `:333-343`. Invalidation effect
  `:236-244` nulls the coordinate when `positionText` drifts from `resolvedLocationQuery` — a manual pair must
  set both or it is wiped on the next render. Raw MUI `TextField` at `:666-696`, not `FormField`; errors via
  `Alert` at `:647`.
- `travelplan/src/components/features/trips/TripCreateForm.tsx` -- one handler `:370-444` with a
  `kind: "start" | "destination"` parameter and **eight** flat state slots `:125-132`; the only site with
  per-field lookup-error state; search rows `:505-553` / `:555-604`; `onChange` nulls the coordinate on every
  keystroke; `Clear` `:528-546` resets all three; payload pairing `:205-231` demands both ends resolved.
- `travelplan/src/i18n/en.ts:692-708`, `travelplan/src/i18n/de.ts:647-663` -- the flat `trips.location.*` block
  (17 keys, 8 of them with zero consumers anywhere). `trips.form.locationHelper` (en `:155`, de `:150`) is read
  only by `TripCreateForm`. `Dictionary` is `Record<string, string>`, so nothing but the parity test catches a
  one-sided edit; `translate()` returns the key itself when missing. Interpolation is `formatMessage` with
  `{single}` braces, not `t()`.
- `travelplan/test/geocodeRoute.test.ts` -- 3 tests, direct `GET` import, `createSessionJwt` + `NextRequest`
  with a `session` cookie, `vi.stubGlobal("fetch", …)`. Nothing asserts the outbound URL today.
- `travelplan/test/tripDayPlanDialog.test.tsx:34-311` -- the exhaustive `@mui/material` mock (see Always).
  `selectTab(key, language)` `:388-402` matches a tab by **prefix**; geocode branch of the fetch mock at `:532`.
- `travelplan/test/tripAccommodationDialog.test.tsx` -- real MUI, `selectTab(name)` `:21`.
- `travelplan/test/tripBucketListPanel.test.tsx` -- `mockBucketListFetch` `:29-41` returns the mock handle;
  `renderWithProviders`.
- `travelplan/test/tripCreateForm.test.tsx` -- assigns `global.fetch` directly in `beforeEach`, branches on
  `"Start"`/`"Dest"` in the URL `:118`, `:125`.
- `travelplan/test/i18nDictionaries.test.ts:25` -- the only parity enforcement; `:105-110` is the house pattern
  for pinning a deleted key as **staying** deleted.
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` -- `## Components` (`:250`).
  Epic 6's rule: a new variant is recorded here, not left living only in code.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/trips/parseLocationInput.ts` -- create. Export `parseLocationInput(raw): LocationInputParse`
  (the four-arm `status:` union from the I/O matrix) and `formatCoordinateLabel(lat, lng): string` →
  `` `${lat.toFixed(6)}, ${lng.toFixed(6)}` ``. Order: trim → URL branch → bail to `search` unless the whole
  string matches `^[0-9+\-.,;\s]+$` → pair-separator resolution (`;` > whitespace-between-digits > a single `,`) → per-half
  `^[+-]?\d+(?:[.,]\d+)?$` → range check, `lat` first. House docblock: the 2026-08-06 report, why the money
  parser is not reused, and the separator rule spelled out. -- one owner, so the fifth call site cannot drift.
- [x] `travelplan/src/app/api/geocode/route.ts` -- `limit` `1` → `5`; map every usable row to
  `{lat, lng, label}` keeping Nominatim's order, dropping rows whose `lat`/`lon` are missing or non-finite;
  return `ok({ results })` — an empty array where `result: null` used to be. Keep the per-candidate
  `(display_name?.trim() || q).slice(0, 200)` label. Delete the `result` field entirely rather than shipping
  both. -- AC5 is the half that fixes the reported "wrong places" complaint; a compatibility shim would let a
  call site keep the old branch.
- [x] `travelplan/src/components/features/trips/LocationCandidateList.tsx` -- create. Props
  `{ candidates, onSelect, disabled?, idPrefix }`; renders `null` while empty. A `Typography` heading carrying
  `formatMessage(t("trips.location.resultsLabel"), { count })` with an `id`, a `Box` referencing it via
  `aria-labelledby`, and one full-width left-aligned `Button` per candidate whose accessible name is the
  candidate label. Bordered-row skin copied from `TripShareDialog.tsx:556-568` (`borderTop`, per-row
  `borderBottom`, none on the last). `Box`/`Button`/`Typography` only. -- one presentation for four surfaces.
- [x] `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- parse before `fetch`: `coordinates`
  sets `resolvedLocation` with `formatCoordinateLabel` as its label and returns without fetching; `ambiguous`
  and `out_of_range` set `serverError` from the keys in the matrix and set nothing; `search` fetches as today.
  Add a `candidates` state, adopt `results[0]` only when `results.length === 1`, render `LocationCandidateList`
  under the existing search row, and clear the list on select, on *Clear*, and on a new *Find*. -- the canonical
  surface the other three follow.
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- the same change, keeping
  `isGeocoding` and the `place` tab placement. Also correct the now-stale label-truncation claim in the
  `:121-135` docblock. -- five copies must not diverge further.
- [x] `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- the same change at **both** sites.
  In `handleLookupLocation` a coordinate result must set `resolvedLocationQuery` to the raw typed text as well,
  or the `:236-244` effect wipes it immediately. In the silent submit path, parse first (a coordinate saves with
  no request); on several candidates the save aborts, renders the list and reports
  `trips.location.selectRequired` rather than saving with no location at all. -- a silent drop is the bug class
  this story exists to remove.
- [x] `travelplan/src/components/features/trips/TripCreateForm.tsx` -- the same change in the one
  `kind`-parameterised handler, both arms, with `candidates` state per kind and a list under each search row.
  Parse failures go to the existing `setStartLocationError` / `setDestinationLocationError`, not `serverError`.
  -- it already has the per-field error channel the others lack; use it.
- [x] `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` -- reuse `searchHelper` (reworded to state the
  rule and the latitude-first order), `latInvalid` and `lngInvalid` as-is; add `coordinatesAmbiguous`,
  `resultsLabel` (with a `{count}` placeholder) and `selectRequired`; delete the five orphans that describe a
  coordinate *form* this story does not build (`latHelper`, `lngHelper`, `labelLabel`, `labelHelper`,
  `coordinatesRequiredTogether`) plus `trips.bucketList.locationLabelFallback` and `trips.form.locationHelper`,
  whose meaning `searchHelper` now carries. Render `searchHelper` as the helper line on all five place fields
  (`hint` on `FormField`, `helperText` on the bucket-list `TextField`). -- AC7; a key that survives two
  features without a consumer survives a third.
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` -- one `## Components`
  entry for the candidate list (bordered `{rounded.md}` rows, 44px floor, label is the content, no selected
  state because activation resolves it immediately). -- Epic 6's rule that a new variant is recorded, not
  invented locally.
- [x] `travelplan/test/parseLocationInput.test.ts` -- new node-environment suite, one `describe` per export and
  one `it` per rule in the I/O matrix, each naming the trap it pins. Must include: `parseAmount`'s
  `normalizeDecimalInput` is **not** in the call path (`1,000` is one, not a thousand, and `-36.8485` survives).
- [x] `travelplan/test/geocodeRoute.test.ts` -- update the existing match test to the array shape and add:
  several candidates in order, exactly one, zero, all-non-finite → `[]`, and an assertion that the outbound URL
  carries `limit=5` and the `User-Agent` header. Leave the 400 and 401 cases byte-identical. -- the guards are
  load-bearing and currently unasserted.
- [x] `travelplan/test/tripDayPlanDialog.test.tsx`, `travelplan/test/tripAccommodationDialog.test.tsx`,
  `travelplan/test/tripBucketListPanel.test.tsx`, `travelplan/test/tripCreateForm.test.tsx` -- per suite: a
  coordinate entry sets the readout and the **fetch mock is not called** for `/api/geocode` (a call-count delta
  where the component fetches on mount); a Google Maps URL does the same; an out-of-range pair shows the error
  and leaves the readout at `noCoordinates`; a multi-candidate search adopts nothing until a row is activated,
  and then stores that row's label; *Clear* still empties the location after a manual entry. Bucket list also
  covers the submit path: a typed pair saves with a location and no geocode request.
- [x] `travelplan/test/i18nDictionaries.test.ts` -- pin the seven deleted keys as staying gone (the `:105-110`
  pattern, via the local `has` helper) and the three new keys as present in both dictionaries.

**Acceptance Criteria:**
- Given any of the five place fields, when a coordinate pair or a Google Maps URL carrying one is entered and
  *Find* is pressed, then the readout shows those exact numbers to six decimals, the location saves, and no
  request reaches `/api/geocode`.
- Given a search term that Nominatim matches several ways, when the results arrive, then every candidate is
  listed in the route's order, nothing is resolved, and the readout still reads `noCoordinates` until a row is
  activated — after which the stored label is that row's label, not the typed query.
- Given a single candidate, when the results arrive, then it is adopted directly and the surface behaves exactly
  as it does today; given zero candidates, `trips.location.noResult` appears, unchanged.
- Given a manually entered pair, when *Clear* is pressed, then the location is empty; and when the dialog is
  dismissed without saving, then the dirty guard prompts exactly as it does after a search-resolved pin.
- Given a search of `src/`, when the coordinate-parsing entry points are grepped, then exactly one
  implementation exists, it lives in `src/lib/trips/`, and no component references the route's old `result`
  field.
- Given either dictionary, when its keys are listed, then they are identical to the other's, the three new keys
  are present in both, and none of the seven deleted keys remains.
- Given the three write-path schema suites (`accommodationSchemas`, `dayPlanItemSchemas`, `tripSchemas` — the
  bucket-list schema has no suite of its own), when they run unmodified, then all pass — this story changes
  no schema.

## Spec Change Log

## Review Triage Log

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 3, medium 6, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 5: (high 0, medium 1, low 4)
- addressed_findings:
  - `[high]` `[patch]` Neither `TripDayPlanDialog` nor `TripAccommodationDialog` reset `locationCandidates` in its on-open effect, and both dialogs are permanently mounted with `open` toggled. An unanswered candidate list from activity A rendered over activity B's empty place field on the next open — with no discard prompt in between, because nothing had been resolved — and picking a row pinned A's search result onto B. `TripBucketListPanel` already had this reset; the two dialogs had missed it. Both effects fixed beside their existing `galleryFiles`/`documentFiles` resets, each pinned by a reopen-on-a-different-item test.
  - `[high]` `[patch]` An outstanding candidate list survived an edit of the query text at all five sites. On the bucket list it was not self-healing: `selectLocationCandidate` set `resolvedLocationQuery` to the *current* field text, so the drift-invalidation effect saw agreement and left the pin — "Sky Tower" → Find → edit the note to "Eiffelturm" → pick "Sky Tower, Auckland" saved the note at Auckland's coordinates, the silent wrong pin this story exists to remove. The list is now cleared in the field's `onChange` at the four sites that own their query state, and via a recorded `candidatesQuery` plus a drift effect on the RHF-registered bucket-list field.
  - `[high]` `[patch]` The bucket list's silent submit path aborted the whole save on `ambiguous` and `out_of_range`, but `positionText` is a 200-character free-text note column. A note of `1,2,3` could no longer be saved **at all** (it saved fine before this story) and `2026, 8` was refused with a latitude error. Both refusals now fall through to the geocode attempt exactly as pre-story — the item saves with no location. The `coordinates` branch and the AC5-mandated multi-candidate abort stay; the interactive handler still reports both refusals visibly.
  - `[medium]` `[patch]` A single-comma pair with no `.` anywhere answered a range error about a number the user never typed: `50,1109`, Frankfurt's latitude on a German keyboard, read as (50, 1109) and reported "Longitude must be between -180 and 180" — a value that cannot be corrected because the mistake was the reading. Where a comma is involved and no dot appears, a failing range check now returns `ambiguous`, whose message names both accepted spellings. `48, 2` still resolves and `91.0, 2.0` still reports the latitude, as the I/O matrix pins; `91 181` keeps its range message because with no comma there is no German-decimal reading to prefer.
  - `[medium]` `[patch]` Whitespace beside a separator, and a trailing separator, defeated the parse entirely: `48.8584 , 2.2945`, `48.8584 ,2.2945` and `48.8584, 2.2945,` all answered `search`, reached Nominatim and came back "No matching place found" — one keystroke from the spelling `searchHelper` prints. `normalizeSeparators` now strips one trailing `,`/`;` and collapses whitespace standing **before** a separator. Leading-side only, deliberately: collapsing both sides also took `48,8584, 2,2945` — a German pair with the separator its writer is used to, and the likeliest spelling from the phone this story was reported on — from resolving to `ambiguous`, which is not a defensible reading of AC3. `48,8584,2,2945` with no space anywhere still refuses.
  - `[medium]` `[patch]` `PARAM_PAIR` was fully anchored, so two standard Google Maps `q=` shapes fell through to a place search: `?q=loc:48.8584,2.2945` and `?q=48.8584,2.2945 (Eiffel Tower)`. Both now resolve, with the tail restricted to end-of-string or a parenthesis so `q=1,2 Main Street` stays a street address. A `maps.app.goo.gl` short link carries no pair and correctly stays a search term — AC2 says so explicitly — so it was left alone.
  - `[medium]` `[patch]` The candidate list's `aria-labelledby` was attached to a bare `<div>`, whose implicit `generic` role prohibits an accessible name, so assistive tech dropped the label the docblock and DESIGN.md both claimed; and the list arrived in silence with focus parked on *Find*. `role="group"` on the row container, `role="status"` on the count heading, both pinned — once against the day-plan suite's MUI mock and once against real MUI.
  - `[medium]` `[patch]` Neither dialog parsed `locationQuery` on the **save** path, so a user who typed a pair — which the new helper on every field now invites — and pressed Save without pressing *Find* lost it silently, with no discard prompt either, since `locationQuery` is deliberately outside the dirty fingerprint. Both dialogs now parse on save when nothing is resolved and only `coordinates` acts; every other status is a no-op, so no save is blocked and no request is issued. Both halves pinned per dialog. `TripCreateForm` already blocked visibly with `locationResolveError`.
  - `[medium]` `[patch]` After the bucket list's multi-candidate abort, choosing a row cleared the list and set the pin but left "Select one of the places found." on screen — the user was told to do the thing they had just done. `selectLocationCandidate` now clears `serverError`, asserted in the existing abort test.
  - `[low]` `[patch]` The candidate heading hardcoded 11px/700 with no `textTransform` while the DESIGN.md entry written in the same pass cited `{typography.label-caps}` (10.5px/800/uppercase). Now uses the `labelCaps` variant the way `FormField` does, so the design record matches what renders; asserted against real MUI via `textTransform`.
  - `[low]` `[patch]` The route's per-row guard checked presence and finiteness but not `locationSchemas.ts`'s ±90/±180 bounds, so an out-of-range upstream row would have been offered as a candidate and then failed the save server-side with a `validation_error` about a value the user never typed. Same bounds now applied in the `flatMap`, with a route test row.
  - `[low]` `[patch]` `trips.location.searchRequired` still read "Enter a place name to search" / "Bitte einen Ortsnamen eingeben" on fields that now also accept coordinates and Maps links, contradicting the helper line one row below. Reworded in both dictionaries. `searchLabel` was left alone deliberately — several suites use it as an accessor and "Search place" is still accurate.

### 2026-08-07 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 3, low 2)
- defer: 2: (high 0, medium 2, low 0)
- reject: 14: (high 0, medium 4, low 10)
- addressed_findings:
  - `[high]` `[patch]` `Clear` and the save-path parse the previous pass added were on a collision course, and
    the result was that a hand-entered location could not be deleted at all. `Clear` nulled `resolvedLocation`
    and left the query text; `locationQuery` is seeded from the stored label; and for a manual pair that label
    *is* the pair — so the parse on save read it straight back. `Clear` followed by *OK* / *Save stay* was a
    no-op. Both dialogs now clear the text too, which is what the button says and what `TripCreateForm`'s
    Clear has always done. One test per dialog: Clear, then save, then assert `location: null`.
  - `[medium]` `[patch]` Saving past an unanswered candidate list dropped the choice in silence on the two
    dialogs: nothing was resolved, so the save-path parse answered `search`, the item saved with
    `location: null`, and the rows the user was choosing between left with the dialog — no message. The
    bucket list refuses this state with `selectRequired` and `TripCreateForm` with `locationResolveError`;
    the two dialogs were the outliers on the one surface this story set out to make consistent. Both now
    refuse with `selectRequired` and reveal the tab that holds the field. Safe because the previous pass
    widened *Clear* to be enabled while a list is pending, so a user who wants none of the rows has a way
    out. Pinned per dialog, including the save that succeeds after a row is picked.
  - `[medium]` `[patch]` The previous pass's demotion of an out-of-range result to `ambiguous` was written as
    "a comma is present and no dot is", which swept up every out-of-range pair spelled in German decimals
    with an **explicit** separator: `48,8584; 200,0` and `91,5 2,5` were told "Coordinates unclear. Write
    48.8584, 2.2945 or 48,8584; 2,2945." — instructing a user who had spelled the pair exactly as
    `searchHelper` prescribes to write it the way they just had, and hiding which number was actually wrong.
    The condition is now the reading it was always arguing about: demote only when the whole value is also
    readable as one German decimal (`^[+-]?\d+\s*,\s*\d+$`). All four pinned refusals (`50,1109`, `50 , 1109`,
    `91,181`, `2026, 8`) keep their answer, five explicit-separator range failures gain the accurate one.
  - `[medium]` `[patch]` The `role="status"` count line, which the component docblock and DESIGN.md both call
    the only thing that announces a choice is waiting, was inserted into the DOM together with its first
    text — the component returned `null` while empty — and a live region created in the same tick as its
    content is routinely never read out. The heading is now mounted from the start and empty, so the count is
    a content change in a region already being watched; the bordered group is still rendered only when it has
    rows, so nothing visible changed. Pinned once against the day-plan suite's MUI mock and once against real
    MUI, each asserting no `group` while empty.
  - `[low]` `[patch]` The parser's canonical rules docblock contradicted its own code and its own test: it
    stated that `48,8584 , 2,2945` and `48,8584, 2,2945` "collapse to three commas and are therefore
    `ambiguous`", while both resolve as German pairs and `parseLocationInput.test.ts` asserts exactly that.
    Stale text from the amendment that superseded it, left standing in the block presented as the single
    source of the separator rules. Reworded, along with the range-demotion paragraph the patch above changes.
  - `[low]` `[patch]` Two comments in `LocationCandidateList.tsx` asserted things that are not so: the heading
    was said to use `labelCaps` "the way `FormField.tsx` applies it", but `FormField` overrides the variant to
    11px/0.06em for the mockup's `.field-label` and this heading takes it bare, as every section label in
    `TripImportDialog` and `TripsDashboard` does; and the row `key` was justified by "a duplicated key would
    drop a row", which is not React's behaviour. Both corrected — these docblocks are the story's design
    record, so a false claim in them is the record being wrong.

### 2026-08-07 — Review pass (follow-up 2)

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 2, medium 2, low 2)
- defer: 2: (high 0, medium 1, low 1)
- reject: 9: (high 0, medium 5, low 4)
- addressed_findings:
  - `[high]` `[patch]` The *Clear*-versus-save-parse collision the previous pass fixed on the two dialogs
    was still live on the fifth surface, and the dialogs' fix is not available there: `positionText` is a
    **saved note column**, not a search box, so *Clear* cannot empty it. It nulled the pin, left
    `48.8584, 2.2945` in the note, and `onSubmit` read the pair straight back — a hand-entered location
    could not be deleted at all, and the save silently stored the one the user had just removed. A
    `noLocationQuery` marker now records the text that is known to want no location. It is a query rather
    than a flag, so editing the note revives the lookup and an explicit *Find* revokes it; both pinned.
  - `[high]` `[patch]` The bucket list's submit-time multi-candidate abort made an ordinary edit
    impossible. An item with a note and no location is a legal, already-saved shape — a position is
    optional — so re-opening one to fix a typo in the title sent its note to Nominatim, got several rows
    back and refused the save with `selectRequired`. The title edit could not be stored unless the user
    pinned a place they never asked for or deleted the note; it saved fine before this story. The same
    marker is seeded on open for that shape, so a note already settled asks Nominatim nothing. The abort
    still fires for a lookup the user asked for in this session, which is what AC5 is about.
  - `[medium]` `[patch]` `selectRequired` outlived the only gesture that answers it. The previous pass
    taught both dialogs to refuse a save past an unanswered candidate list but gave neither the clear that
    `TripBucketListPanel` had already had for a pass — so picking a row took the list down and left "Select
    one of the places found." on screen, telling the user to do the thing they had just done. All three
    surfaces now clear that message and **only** that message: the bucket list had been clearing the whole
    `serverError` slot, which took a failed save's `errors.csrfMissing` with it. Its drift effect clears it
    too, so editing the note away from the rows does not leave the demand standing with nothing to select.
  - `[medium]` `[patch]` The dirty guard could not see the one reading of the search box that now
    persists. `locationQuery` is outside both dialogs' dirty comparison by a Story 6.24 decision — a search
    box saves nothing — but the previous pass taught `onSubmit` to parse it, so a typed pair *does* save,
    and dismissing the dialog threw it away with no prompt. Only a `coordinates` reading enters the
    comparison; a place name still holds nothing open, which is what the exclusion exists for. Both halves
    pinned per dialog.
  - `[low]` `[patch]` Two ways a malformed Nominatim row broke the route. A `null` or non-object element
    made `row.lat` throw, and the throw landed in the outer `catch`: a 500 with **every** usable candidate
    lost, where the pre-story `body[0]` path answered 200. And a whitespace-only `lat` is truthy while
    `Number(" ")` is `0`, so it passed both the presence and the finiteness guard and arrived as a
    selectable candidate pinned at the equator. Both guarded, with a route test carrying all four shapes.
  - `[low]` `[patch]` `LocationCandidateList`'s docblock cited `FullscreenPhotoViewer.tsx` and
    `TripDayView.tsx` as `role="status"` precedents. `TripDayView.tsx:3106` uses a bare
    `aria-live="polite"` and the other file has no live region at all — and it is in `src/components/ui/`,
    not the neighbourhood the citation implies. Corrected to the precedent that exists plus the reason
    this element needs a role that permits an accessible name. Third false claim found in this one
    docblock across three passes; it is the story's design record, so a wrong citation is the record
    being wrong.

## Design Notes

**The separator rule (AC3), stated once and rendered in `searchHelper`.** A pair separator is resolved by
precedence, and only unambiguous readings resolve:

```
";"            → the pair separator. `48,8584; 2,2945`  → (48.8584, 2.2945)
whitespace     → the pair separator; a single trailing "," or ";" on the left half is punctuation.
                 `48,8584 2,2945` and `48.8584, 2.2945` → resolve
exactly one "," and no ";" and no inner whitespace → the pair separator. `48.8584,2.2945` → resolve
otherwise      → two or more commas ⇒ ambiguous (refuse); fewer ⇒ not a pair at all ⇒ search term
```

`48,8584,2,2945` is the case the story names, and it refuses. `12,5` resolves as the pair (12, 5) — a lone
German decimal is not a coordinate under any reading, and one comma has to mean *something*; the helper states
the recommended spellings so nobody arrives here by accident. Inside a URL the separators are always dot and
comma, so the URL branch bypasses this rule entirely.

**Why not `normalizeDecimalInput`.** Story 6.27 put a comma-aware parser in `src/lib/trips/parseAmount.ts` and
it is the wrong one here on four counts: it strips thousands-position whitespace (which is this story's *pair*
separator), reads a lone `1,000` as one, has no notion of two numbers, and its gates reject a leading `-` —
every coordinate south of the equator. 6.27's own Dev Notes make this argument about the distance field; this
is the second instance, not a new idea. The two modules stay neighbours and share nothing.

**Discriminated union, `status:`, not `T | null`.** The pure helpers in `src/lib/trips/` return `T | null`, but
this function has four outcomes and three of them drive different user-visible text. `status:` matches the
repository convention (`dayPlanItemRepo.ts:24`) and makes an unhandled arm a compile error at each of the five
call sites.

**The candidate list has no precedent, and two constraints that decide it.** There is no `ListItemButton`,
`Autocomplete` or selectable list anywhere in `src/components`, and `tripDayPlanDialog.test.tsx`'s MUI mock is
exhaustive by design. So: the bordered-row *skin* comes from `TripShareDialog.tsx:556-568`, and the *mechanics*
are plain `Button`s in an `aria-labelledby` group — Tab-reachable, each carrying the candidate name as its
accessible name, which meets Epic 6's keyboard floor without inventing a `listbox` and its arrow keys. No
`selected` state exists because activation resolves the pin and dismisses the list in the same gesture.

**The bucket list's silent save is the one behaviour that changes.** `onSubmit` geocodes when the user typed a
place and never pressed *Find*, and it cannot prompt mid-submit. With several candidates the AC5-compliant
answer is to stop and ask, so the save aborts with `selectRequired` and the list rendered. The alternative —
adopting `results[0]` — is precisely the silent wrong pin this story removes.

**Key disposition (AC7).** Reused: `searchHelper` (reworded), `latInvalid`, `lngInvalid` (already worded for
AC4). Added: `coordinatesAmbiguous`, `resultsLabel`, `selectRequired`. Deleted: `latHelper`, `lngHelper`,
`labelLabel`, `labelHelper`, `coordinatesRequiredTogether` — all five describe separate latitude/longitude/label
input boxes, which this story deliberately does not build — plus `trips.bucketList.locationLabelFallback` (a
ninth orphan in the same neighbourhood) and `trips.form.locationHelper`, whose "Search and select a place" is
subsumed by the reworded `searchHelper`. Wording, both dictionaries:

```
searchHelper         en: Place name, or coordinates — latitude first: 48.8584, 2.2945 (or 48,8584; 2,2945)
                     de: Ortsname oder Koordinaten — Breitengrad zuerst: 48.8584, 2.2945 (oder 48,8584; 2,2945)
coordinatesAmbiguous en: Coordinates unclear. Write 48.8584, 2.2945 or 48,8584; 2,2945.
                     de: Koordinaten nicht eindeutig. Bitte 48.8584, 2.2945 oder 48,8584; 2,2945 schreiben.
resultsLabel         en: Select a place ({count})   /  de: Ort auswählen ({count})
selectRequired       en: Select one of the places found.  /  de: Bitte einen der gefundenen Orte auswählen.
```

**Asserting the absence of the request is AC1's actual content.** A test that types a pair and checks the
readout passes even if the numbers came from a round trip. Hold the fetch-mock handle and assert no
`/api/geocode` call — for surfaces that fetch on mount, a filtered call list rather than
`not.toHaveBeenCalled()`.

### Decisions made during implementation (spec left these open)

**A half that is not a number answers `search`, not `ambiguous`.** The matrix names `ambiguous` for the
comma-soup shapes only, and the order in the Execution item puts the per-half `^[+-]?\d+(?:[.,]\d+)?$`
gate *after* separator resolution — so something has to be decided for `1,2,3 4,5` and `48..8584 2.2945`,
which reach the gate and fail it. They answer `search`. `ambiguous` is reserved for input that is
*plausibly* a coordinate under two readings and has to be refused rather than guessed at; numeric noise
nobody meant as a pair is not that, and "no matching place found" is the honest answer for it. Refusing it
instead would put the refusal message in front of typing mistakes it does not describe.

**Only an explicit `scheme://` enters the URL branch.** `parseLocationInput` tests `^[a-z][a-z0-9+.-]*://`
before anything else. A bare `www.google.com/maps/@48.8584,2.2945` therefore falls through the character
gate (it has letters) to `search`, and so does `maps.app.goo.gl/abc123` — the latter carries no pair
anyway. The alternative, retrying `new URL("https://" + value)` on failure, would also swallow ordinary
place names containing a dot ("St. Pauli") into the URL branch for nothing. Both matrix rows use `https://`.

**The candidate rows are rule-separated inside one group, not individually bordered `{rounded.md}` cards.**
The Execution item mandates `TripShareDialog.tsx:556-568`'s skin (`borderTop` on the group, `borderBottom`
per row, none on the last), which has no per-row radius; the DESIGN.md item asked for "bordered
`{rounded.md}` rows". The skin instruction won, because it is the instruction about the code and because
four cards read as four things to compare while a ruled list reads as one question with four answers. The
DESIGN.md entry records that reading rather than the token.

**`Clear`'s enabled condition widened to cover a pending candidate list.** The Execution item asks for the
list to clear "on *Clear*", but `Clear` was disabled while `!resolvedLocation` — and after a multi-candidate
search nothing *is* resolved, so that path was unreachable and the only way out of the list would have been
to search for something else. Now `disabled` is `!resolvedLocation && candidates.length === 0` on the three
dialogs. `TripCreateForm` needed no change: its condition already includes a non-empty query box.

**The bucket list's submit path aborts on `ambiguous` and `out_of_range` too, not only on several
candidates.** The spec mandates the abort for the multi-candidate case. Extending it to the two refusals
follows from AC4 — "produces a visible error and sets nothing" — since a save that swallowed an
out-of-range pair and stored no location at all would be the same silent drop one keypress later. A failed
*search* still saves without a location, exactly as before: a bucket-list position is optional, and a
geocoder miss is not a reason to refuse the note.

**Choosing a candidate in the bucket list does not overwrite `positionText`.** The three dialogs write the
chosen label into their *search* box, which persists nothing. `positionText` is a saved column holding the
user's own words ("Trailhead"), and this call site has never overwritten it with a geocoder display name.
What is kept in step instead is `resolvedLocationQuery`, which is all the `:236-244` invalidation effect
compares. The candidate's label is still what gets **stored** as `location.label`, which is what AC5 asks.

**`TripCreateForm`'s coordinate branch leaves the query box as typed.** Its `onChange` nulls the location on
every keystroke, so writing the formatted pair back into the field would immediately invalidate the pin that
was just set. The same holds for the two dialogs, where it is merely pointless rather than destructive.

**The route guards a non-array upstream body.** `(Array.isArray(body) ? body : [])` is new. The old code did
`body[0]`, which answered a nulled candidate and 200 for a malformed Nominatim response; `flatMap` on a
non-array would have thrown into the 500 branch instead. The guard preserves the old outcome — this is an
added guard, not a relaxed one.

**Candidate rows carry an explicit `type="button"`.** MUI's `ButtonBase` defaults to it, but the bucket-list
panel renders this list *inside* its `<form>`, where a `<button>` with no type submits it — and the
`@mui/material` mock in `tripDayPlanDialog.test.tsx` does not supply the default.

**The grep `latHelper|…|form.locationHelper` over `src/ test/` cannot be empty in `test/`.** The same
Execution list requires `i18nDictionaries.test.ts` to pin all seven deleted keys by name, so the pin is
itself the only hit. `src/` is clean, which is what the grep is actually asking (two prose comments were
reworded to keep it so, and the same applies to `data?.result` / `result: null`).

## Verification

**Commands:** (all in `travelplan/`)
- `npx vitest run test/parseLocationInput.test.ts` -- expected: all green.
- `npx vitest run test/geocodeRoute.test.ts test/tripDayPlanDialog.test.tsx test/tripAccommodationDialog.test.tsx test/tripBucketListPanel.test.tsx test/tripCreateForm.test.tsx test/i18nDictionaries.test.ts` -- expected: all green; the 400/401 route cases unmodified.
- `npx vitest run test/accommodationSchemas.test.ts test/dayPlanItemSchemas.test.ts test/tripSchemas.test.ts` -- expected: green **and** `git diff --stat` over those three files empty. If any needs an edit, Block If has triggered.
- `npm test` -- expected: at or above the **1699-test / 130-file** baseline measured at `8d06abb`, zero failures.
- `npx tsc --noEmit` -- expected: 0 `src` errors; test-side at or below the 135 baseline.
- `npm run lint` -- expected: at or below 85 problems / 2 errors.
- `npm run check:migrations` -- expected: pass (this story adds none).
- `npm run audit:check` -- expected: unchanged 1 pre-existing high; `package-lock.json` byte-identical.
- `grep -rn "data?.result\b\|result: null" src/` -- expected: no hits; the route's old field is gone everywhere.
- `grep -rn "limit\", \"5\"" src/app/api/geocode/route.ts` -- expected: one hit.
- `grep -rn "latHelper\|lngHelper\|labelLabel\|labelHelper\|coordinatesRequiredTogether\|locationLabelFallback\|form.locationHelper" src/ test/` -- expected: no hits.
- `grep -rn "parseLocationInput\|formatCoordinateLabel" src/` -- expected: definitions only in `src/lib/trips/parseLocationInput.ts`.

**Manual checks (if no CLI):**
- Before implementing, run one new coordinate case against unmodified code and confirm it **fails** with the
  reported symptom (`noResult` / no location set), and record the observed value in the Completion Notes.
- **Operator-only:** a real German-keyboard phone is the only surface that exercises the comma spelling the
  AC3 rule exists for, and only a live Nominatim key-free request shows what real candidate sets look like for
  an activity name. Enumerate under `operator_actions` if the run ends there.


## Auto Run Result

Status: done — third pass over Story 6.28, review-only (no implementation loopback).

**Change:** Six review patches on top of the shipped story. Two are `high`: on `TripBucketListPanel`,
*Clear* could not delete a hand-entered pin (the save re-parsed the note text and put it straight back),
and an existing item holding a note but no location could no longer be saved at all once its note matched
several places. Both come from the same cause — this surface's place field is a **saved note column**, so
the two dialogs' fix of "clear the text as well" does not transfer — and both are now answered by one
`noLocationQuery` marker that records which text is known to want no location, revives on an edit, and is
revoked by an explicit *Find*. The rest close gaps the previous pass opened: the `selectRequired` banner
now goes down when a row is picked (and only that banner, on all three surfaces), the dirty guard now sees
a typed-but-unresolved coordinate pair, and the route survives a malformed upstream row instead of losing
the whole response to a 500.

**Files changed**

- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` — `noLocationQuery` state, seeded on
  open, set by *Clear*, revoked by *Find*, and read as the third condition on the submit-time lookup;
  targeted `selectRequired` clear in both `selectLocationCandidate` and the drift effect.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — targeted `selectRequired` clear on
  select; `unresolvedPairLocation` memo feeding `planFormFingerprint`.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` — the same two changes, spelled
  against its `currentLocationKey` dirty comparison.
- `travelplan/src/app/api/geocode/route.ts` — per-row object guard and a trimming coordinate read.
- `travelplan/src/components/features/trips/LocationCandidateList.tsx` — corrected the `role="status"`
  precedent citation (docblock only).
- `travelplan/test/tripBucketListPanel.test.tsx` (+3), `travelplan/test/tripDayPlanDialog.test.tsx` (+2),
  `travelplan/test/tripAccommodationDialog.test.tsx` (+2), `travelplan/test/geocodeRoute.test.ts` (+1),
  plus a banner-clear assertion added to the existing refusal test in both dialog suites.

**Review findings:** 6 patched (2 high, 2 medium, 2 low), 2 deferred, 9 rejected. One reviewer finding —
the unsequenced in-flight geocode request — was already an open ledger entry from the previous pass and
was not duplicated. The two new ledger entries are the accommodation dialog's validate-after-CSRF-fetch
ordering (not patched here because moving only the location guard across the fetch would demote the cost
and payment errors) and the code-unit `.slice(0, 200)` on candidate labels.

**Verification** (all in `travelplan/`)

- `npm test` — 1837 tests / 131 files, zero failures (baseline at `8d06abb` was 1699 / 130).
- `npx tsc --noEmit` — 0 `src` errors; 135 test-side, exactly the recorded baseline.
- `npm run lint` — 85 problems / 2 errors, at the cap.
- `npm run check:migrations` — passed, no migration changes.
- `npm run audit:check` — unchanged single pre-existing high; `package-lock.json` byte-identical.
- Grep gates all clean: no `data?.result` / `result: null` in `src/`, none of the seven deleted i18n keys
  in `src/`, `parseLocationInput` / `formatCoordinateLabel` defined only in `src/lib/trips/`.
- The three write-path schema suites are byte-identical to `8d06abb` and pass — no schema changed, so the
  spec's Block If did not trigger.

**Residual risks**

- The `noLocationQuery` marker is the bucket list's fourth piece of location state, and it interacts with
  `resolvedLocationQuery` and `candidatesQuery`. All three now have tests, but the deferred
  `<LocationSearchField>` extraction is what actually retires the interaction.
- Both deferred entries are pre-existing exposures this story widened rather than created; neither is
  reachable from the surfaces 6.28 added without an unusual upstream response or a failing CSRF endpoint.
- The operator checks stand unchanged: a real German-keyboard phone and one live Nominatim request are the
  only way to see the AC3 comma spelling and a real candidate set.
