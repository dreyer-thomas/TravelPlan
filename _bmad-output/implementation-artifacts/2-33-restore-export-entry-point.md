---
authored_against: e058259
baseline_revision: 5c8956784d166d147726d64841b5194f06021989
final_revision: 0c88a70
status: awaiting-operator
review_loop_iteration: 0
followup_review_recommended: true
warnings:
  - oversized
operator_actions:
  - "Do Task 5 in a real browser, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. No export has ever been performed from a browser against this code: jsdom implements no downloads and computes no layout, so the entire save path is verified only as far as the anchor's attributes."
  - "Sign in as the trip's owner, open the trip overview, and confirm the export button is the third outlined button in the controls card beside Reise bearbeiten and Reise löschen — one card, not a second one, and not a new toolbar."
  - "Press it on a photo-heavy trip and confirm three things in order: the button shows a spinner while the archive builds, the page does not navigate or open a tab, and a file lands in the downloads folder. Check the trip overview is still on screen afterwards."
  - "Open the downloaded file and confirm it is a valid ZIP containing trip.json plus a photos/ directory. Confirm its name is the server's — trip-<slug>-<YYYY-MM-DD>.zip — and not a uuid or 'trip-backup.zip'. A uuid means the content-disposition read failed; trip-backup.zip means the header was missing."
  - "Watch the control row while the spinner is showing, at a 390px viewport. A minWidth floor was added so the button does not collapse to spinner width, but confirm Edit and Delete do not visibly rearrange during the export and rearrange back — that is the defect the floor is meant to remove."
  - "Sign in as a contributor and then as a viewer on the same trip and confirm neither sees an export control: the contributor gets the card with Edit only, the viewer gets no card at all."
  - "Check German, not only English. The label is 'Backup exportieren', which is the longer of the two and the one that decides whether the three-button row wraps on a phone."
  - "If a failure is easy to provoke — sign out in a second tab, then press Export in the first — confirm the alert appears inside the controls card and reads 'Authentication required. Please sign in.' rather than the generic 'Trip export failed'. Confirm the page-level red banner above the trip did NOT appear and no 'Back to trips' link replaced the page."
  - "If every check passes, tick Task 5 in this spec, set status: done in the frontmatter and Status: done in the body, and set 2-33-restore-export-entry-point to done in sprint-status.yaml."
---

# Story 2.33: Restore the Export Entry Point on the Trip Overview

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip owner,
I want an export button back among the trip controls at the bottom of the trip overview,
so that I can download a backup without typing an API URL with an internal trip id.

## Acceptance Criteria

1. **Placement.** An export control sits in the trip-controls card beside "Reise bearbeiten" and "Reise löschen", in the same outlined button treatment. No second card, no new toolbar.
   *Given* an owner on the trip overview, *when* the trip-controls card renders, *then* it holds three `variant="outlined"` buttons in the existing flex row — edit, delete and export — and the page still contains exactly one `data-testid="trip-controls-card"`.

2. **It downloads.** Pressing it downloads the archive; it does not navigate away from the trip.
   *Given* an owner viewing trip X, *when* the export button is pressed and the route answers 200, *then* the archive is saved through a programmatic anchor with the server's `content-disposition` filename, and the trip overview stays mounted — no `router.push`, no `window.open`, no new tab.

3. **Owner only.** It renders only for a user who passes the route's `hasTripOwnerAccess` gate. A contributor and a viewer see no export control.
   *Given* `accessRole === "contributor"`, *when* the overview renders, *then* the card shows edit but no export. *Given* `accessRole === "viewer"`, *then* no card renders at all. *Given* `accessRole === "owner"`, *then* the export button is present.

4. **Test assertion deliberately inverted.** `test/tripTimelineRoles.test.tsx` currently asserts the *absence* of both import and export controls for every role. It is rewritten: export present for an owner, absent for contributor and viewer; import still absent for all three. The inversion is called out in the story's record.
   *Given* the rewritten suite, *when* it runs, *then* the owner case asserts presence by the real dictionary string and the two non-owner cases assert absence, and the Dev Agent Record names the inversion as a decision.

5. **Feedback.** A photo-heavy export takes a moment and produces a file, not a page. The user gets an indication that something is happening, and a failure surfaces a message rather than failing silently.
   *Given* an in-flight export, *when* the request has not resolved, *then* the button is disabled and shows a spinner while keeping its accessible name. *Given* a non-2xx response or a thrown request, *when* it resolves, *then* an error alert appears in the card and the button returns to its resting state.

6. **Import untouched.** "Backup importieren" stays exactly where Story 2.32 left it, on the trips list.
   *Given* the diff for this story, *when* it is reviewed, *then* `TripsDashboard.tsx` and `TripImportDialog.tsx` are unmodified and no import control exists on the overview for any role.

7. **Nothing else changes.** Edit, delete, their confirmation dialogs and the role gating around them behave as before. No route, format, schema or i18n contract change beyond the strings this control needs.
   *Given* the full suite, *when* it runs, *then* every pre-existing test passes unmodified except the role assertions AC4 names, and the only new dictionary keys are `trips.export.open` and `trips.export.error` in both languages.

## Tasks / Subtasks

- [x] **Task 1 — Add the control** (AC: 1, 2, 6)
  - [x] The trip-controls card is `tripControlsCard` in `TripTimeline.tsx:347-372` (`data-testid="trip-controls-card"`), built once and mounted at one of two places — `:767` inside `trip-overview-main-column` at `md`+ (Story 6.10), `:868` as the grid's third child below `md` (Story 6.14). **Do not duplicate the card**; add the button to the single definition.
  - [x] Put the control in the same `Box display="flex" alignItems="center" gap={1} flexWrap="wrap"` at `:359` that holds edit and delete, as a third `Button variant="outlined"` — no `color`, no `size`, no `startIcon`, matching its two siblings. The Epic 7 look comes from `theme.ts:284-331`, not the call site.
  - [x] Target `GET /api/trips/{tripId}/export` via `fetch` (see Task 3 for why, not a plain anchor). It answers `content-type: application/zip` and `content-disposition: attachment; filename="trip-<slug>-<YYYY-MM-DD>.zip"`. A bare cookie-carrying GET suffices: no CSRF token is required (`middleware.ts:66` checks only the session cookie; CSRF is validated per-route inside the mutating handlers — 22 of them — and this GET has no `validateCsrf` call). *Corrected during the review pass: this line originally said "three POST routes", which is wrong. The conclusion is unchanged.*
  - [x] Do **not** touch the import control on the trips list (`TripsDashboard.tsx:328-335`) or `TripImportDialog.tsx`.

- [x] **Task 2 — Gate it** (AC: 3)
  - [x] `export/route.ts:43-45` gates on `hasTripOwnerAccess` and answers **404**, not 403, to everyone else — deliberately, so a stranger cannot learn a trip exists. That means a shown-but-unauthorised button produces a bare "not found", which is precisely why Story 7.8 removed the old one.
  - [x] Render it under `isOwner` (`TripTimeline.tsx:117`), the narrower flag — the same condition `trips.delete.open` already uses at `:365`. Using `canEditPlanning` (`:118`, contributors included) would reintroduce 7.8's defect.
  - [x] Check the card's own guard at `:348` still holds: it renders when `canEditPlanning || isOwner`, so a contributor sees the card with edit but no export, and a viewer sees no card at all.

- [x] **Task 3 — Feedback** (AC: 5)
  - [x] **Decided: fetch + object URL, not a plain anchor.** A 16 MB archive took a noticeable moment to build in verification, and the route reports every failure as a JSON `{data,error}` envelope (401 unauthenticated, 403 `password_change_required`, 404 non-owner or missing, 500 `server_error`) — an `<a download>` would hand the user a file named `export` containing that JSON and AC5's failure path would be unreachable. `fetch(..., { credentials: "include", cache: "no-store" })` → check `response.ok` → `response.blob()` → `URL.createObjectURL` → hidden anchor `click()` → `remove()` → `URL.revokeObjectURL`. Record the trade-off (the whole archive is resident in memory client-side) in the Dev Agent Record.
  - [x] Read the filename from `content-disposition`, preferring `filename*=UTF-8''…` (percent-decoded) over `filename="…"`, falling back to `trip-backup.zip`. A blob URL carries no name, so skipping this saves the file as a random uuid. Story 7.8 deleted an `extractAttachmentFilename` helper that did exactly this; re-derive it as a module-level function in `TripTimeline.tsx`.
  - [x] Pending state: an `isExporting` boolean → `disabled={isExporting}` with `{isExporting ? <CircularProgress size={22} /> : t("trips.export.open")}`, matching `TripImportDialog.tsx:455-459`. Put `aria-label={t("trips.export.open")}` on the Button so the accessible name survives the spinner — otherwise the button vanishes from `getByRole("button", { name })` mid-flight and a11y loses the label.
  - [x] Error slot: a **dedicated** `exportError` state rendered as `<Alert severity="error">` inside the card, below the button row. Do **not** reuse the page-level `error` state (`:105`, rendered at `:375`) — it is the load-failure slot and drives the `error && !detail` "Back to trips" branch at `:411`. Clear `exportError` at the start of each attempt. This follows `TripShareDialog.tsx:430-432`, which keeps `loadError` and `serverError` in separate slots for the same reason.
  - [x] **Decided: new keys are `trips.export.open` and `trips.export.error`**, added to `src/i18n/en.ts` and `de.ts` in the same block as their siblings (en `:157-196`, de `:153-192`) — EN "Export backup" / "Trip export failed. Please try again."; DE "Backup exportieren" / "Reiseexport fehlgeschlagen. Bitte erneut versuchen." Story 7.8 removed `trips.export.action`/`trips.export.error`; `.error` returns under its old name, but `.action` does **not** — in the dictionary as it now stands `.action` means a dialog's submit label (`trips.import.action` = "Start import") while `.open` is the trigger label (`trips.import.open`, `trips.edit.open`, `trips.delete.open`, the two strings this button sits between). This control opens no dialog, so `.open` is the label key. `i18nDictionaries.test.ts` enforces exact key-set parity and has no guard forbidding `trips.export.*`.

- [x] **Task 4 — Tests** (AC: 3, 4, 6)
  - [x] Rewrite the role assertions in `test/tripTimelineRoles.test.tsx` (`:214-215`, `:267-268`, `:286-287`): owner sees export, contributor does not, viewer sees no card. Import stays absent for all three. **Query by the real dictionary strings** — the existing assertions query `"Import JSON"`/`"Export JSON"`, which exist in neither dictionary at HEAD and are therefore vacuous; use `"Import backup"` and `"Export backup"`. Retitle the owner case at `:274` ("hides Import and Export from an owner as well") to match what it now asserts.
  - [x] Add an owner case asserting the control targets the export route for the trip being viewed: press the button and assert `fetch` was called with `/api/trips/trip-1/export`, so a wrong-id regression is caught mechanically.
  - [x] Add an owner case for AC5's failure path: the export request answers a non-2xx envelope, an alert with `trips.export.error` appears inside the card, and the button is enabled again.
  - [x] `stubDetailFetch` (`:183-197`) throws `Unhandled fetch ${method} ${url}` for anything but `GET /api/trips/trip-1` — extend it to answer the export URL. jsdom implements neither `URL.createObjectURL` nor `URL.revokeObjectURL`; stub both (`vi.stubGlobal` / assignment) in the cases that press the button, and assert nothing about the anchor beyond that the download was triggered.
  - [x] Leave the structural assertions intact and green: `controlsCards()` length (`:311`, `:337`, `:386`, `:446`, `:495`), the delete button's colour-class check (`:338`), `dayColumn.lastElementChild === card` (`:369`) and `grid.lastElementChild === card` (`:452`), and `emotionDeclaredProperties(card)` (`:474-477`, `:532-534`). A third button and a conditional alert inside the card must not disturb any of them.
  - [x] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 2, 3, 5) — **operator-owned; requires a browser**
  - [ ] Download a real archive as owner and confirm it opens as a ZIP with `trip.json` plus a `photos/` directory, and that the saved filename is the server's `trip-<slug>-<date>.zip` rather than a uuid.
  - [ ] Sign in as a contributor and as a viewer and confirm neither sees the control.
  - [ ] Confirm the pending state is visible on a photo-heavy trip and that the overview does not navigate.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

- [x] **Task 6 — Close the ledger entry** (AC: none)
  - [x] `deferred-work.md` **DW-76** ("The v2 trip backup export has no user-facing entry point") is exactly what this story closes. Set its `status` to resolved with a one-line resolution naming the surface chosen (trip overview controls card, owner-only) and the keys added.

## Dev Notes

### There is currently no way to export from the UI at all

Three stories produced this between them, each correctly within its own scope:

- **7.8** removed "Import JSON" and "Export JSON" from the trip-controls card. The export button was ungated, so a viewer or contributor pressing it got a bare 404. Removing it was the right call for that story; its AC even records the defect as "resolved by the button's removal".
- **2.31** rebuilt the export as a real ZIP archive and noted "no UI entry point" as a deliberate deferral (DW-76).
- **2.32** kept the *import* reachable — "Backup importieren" on the trips list.

The result is asymmetric: import has a button, export has a URL. The only way to export today is typing `GET /api/trips/{id}/export` with an internal cuid in it. That is not a usable backup tool, and it leaves 2.31's format unreachable.

### Why `isOwner` and not `canEditPlanning`

The card renders for `canEditPlanning || isOwner`, and its two existing buttons split along that line: edit is `canEditPlanning` (contributors included), delete is `isOwner`. Export belongs with delete, because that is what the server enforces.

Whether a contributor *should* be able to export is a fair question and not this story's: it would be a change to `export/route.ts`'s gate, not to a button. If you want it, file it separately.

Note the client flags default to `true` when `accessRole` is absent from the payload (`:117-118`). That fallback predates this story and is deliberate — the API omits the field only for the owner's own trips — but it means the button's visibility is not itself a security boundary. The 404 gate is. Do not change the fallback here.

### The test inversion is the point, not a side effect

`test/tripTimelineRoles.test.tsx` asserts the absence of both controls for every role. Story 7.8 added that assertion deliberately, to close a gap where export visibility had never been asserted at all. This story inverts half of it.

That is legitimate — the reason for the absence (an ungated button) is gone once Task 2 lands — but it must read as a decision in the record, not as a test that someone loosened to make their change pass.

A second, smaller thing to record: those assertions are currently **vacuous**. They query `"Import JSON"` and `"Export JSON"`, and neither string is in either dictionary at HEAD (`trips.import.open` = "Import backup", `trips.import.action` = "Start import", no `trips.export.*` at all). They would not have failed if someone had added an export button under any other label. Task 4 fixes that in passing; say so, because "the test was already not testing this" is exactly the kind of claim a reviewer should see stated rather than discover.

### Sequencing

After **Story 6.10**, which moved this card into the grid's left column — done, and **6.14** then added the below-`md` mount point. Both have landed; the card's shape is settled and this story can proceed.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripTimelineRoles.test.tsx` is the constraint and the file this story deliberately rewrites. It stubs `matchMedia` (jsdom ships none) at widths 390/820 for single-column and 900/1400 for two-column, and mocks every child dialog as a bare div.

### Project Structure Notes

`src/components/features/trips/TripTimeline.tsx`, `src/i18n/en.ts` and `de.ts`, `test/tripTimelineRoles.test.tsx`, and `_bmad-output/implementation-artifacts/deferred-work.md`. No route, schema or format change — `GET /api/trips/{id}/export` is used exactly as it stands.

## Code Map

- `travelplan/src/components/features/trips/TripTimeline.tsx` — the only production file to change. `tripControlsCard` at `:347-372`; role flags at `:117-118`; page-level `error` state at `:105` (rendered `:375`, recovery branch `:411`); mount points `:767` and `:868`.
- `travelplan/src/app/api/trips/[id]/export/route.ts` — consumed unchanged. Owner gate `:43-45` (404, not 403), streamed ZIP response and headers `:91-101`, filename built `:57-61`.
- `travelplan/src/lib/auth/tripAccess.ts` — server-only; `hasTripOwnerAccess` (`:67`) is `accessRole === "owner"`. No client counterpart exists; the client re-derives inline.
- `travelplan/src/i18n/en.ts` (`:157-196`) and `de.ts` (`:153-192`) — flat dotted-key maps; the `trips.edit.*` / `trips.delete.*` / `trips.import.*` block the two new keys join.
- `travelplan/test/tripTimelineRoles.test.tsx` — the file this story rewrites. Fetch stub `:183-197`, payload builder `:145-181`, viewport stub `:76-91`, the three absence assertions at `:214-215`, `:267-268`, `:286-287`.
- `travelplan/test/i18nDictionaries.test.ts` — key-set parity (`:21-26`) and no-empty-values (`:28-31`); no guard forbids `trips.export.*`.
- `travelplan/src/components/features/trips/TripImportDialog.tsx` (`:365`, `:455-459`) — the pending/error convention to copy. Read-only for this story.
- `travelplan/src/components/features/trips/TripsDashboard.tsx` (`:328-335`) — the import control that must not move. Read-only for this story.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-76, closed by Task 6.

## Verification

**Commands** (run from `travelplan/`):
- `npm test` — expected: all files pass, 0 failed. The pre-story baseline is 101 files / 801 tests plus whatever Epic 6/7 added since; any failure outside `tripTimelineRoles.test.tsx` is a regression this story caused.
- `npm run lint` — expected: no *new* problem in a file this story touches. Baseline at HEAD is 2 errors (both pre-existing `react/no-children-prop` in `src/theme.ts`) plus warnings; diff against `5c89567^` before claiming a warning is pre-existing.
- `npx tsc --noEmit` — expected: no new error under `src/**`. Pre-existing errors under `test/**` are the suite's long-standing fetch-mock casts.

**Manual checks (operator, no CLI equivalent):** Task 5. jsdom computes no downloads and no layout, so nothing in the suite can prove the browser actually saves a valid ZIP under the right name, or that the pending state is perceptible on a real photo-heavy trip.

## Spec Change Log

## Review Triage Log

### 2026-08-03 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 3, low 7)
- defer: 1: (high 0, medium 0, low 1)
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` **The whole filename mechanism was untested, and a mutation proved it.** The reviewer replaced `anchor.download = filename` with a literal and the suite stayed green at 18/18: `extractAttachmentFilename`, `EXPORT_FILENAME_FALLBACK` and the `download` assignment had no coverage at all, while AC2 claims the archive is saved under the server's name. The gap was guaranteed by this spec's own Task 4, which told the implementer to "assert nothing about the anchor beyond that the download was triggered" — a hedge about jsdom that went too far. Fixed additively (no production change): the AC2 case now spies `HTMLAnchorElement.prototype.click`, asserts `download`, `href`, that the anchor is detached and that the object URL is revoked, and a new case covers the fallback name. The same mutation now fails 2 tests — re-run to confirm, not assumed.
  - `[medium]` `[patch]` **Every failure collapsed into "please try again", including two states where retrying can never work.** `!response.ok` discarded the `{data,error}` envelope, so a tab left open past session expiry (401 from middleware) and a trip deleted between load and press (404) both produced the same unactionable sentence, forever — ten lines above, `loadTrip` already maps envelope codes to messages. `handleExport` now reads the envelope and maps `unauthorized` → `errors.unauthorized`, `not_found` → `trips.detail.notFoundBody`, `server_error` → `errors.server`, everything else → `trips.export.error`. Existing keys only: AC7 caps this story's new i18n at the control's own two.
  - `[medium]` `[patch]` **AC5's thrown-request branch had no test.** The stub could model `ok`/`!ok` and nothing else, so the `catch` — offline, DNS failure, a `blob()` rejecting because the archive failed mid-stream — was unexecuted while AC5's Given/When/Then names it. Stub extended with `throws`; new case asserts the alert appears and the button re-enables.
  - `[low]` `[patch]` **A shipped comment stated a checkable fact that was wrong by 19.** "`validateCsrf` guards three POST routes" — it guards 22 route handlers. The conclusion (this GET needs no token) is correct, but anyone auditing CSRF coverage from that comment would have concluded the app protects three mutations. Corrected in the code and in this spec's Task 1, which is where the claim originated.
  - `[low]` `[patch]` **The error alert was sticky and could outlive its own language.** `exportError` was cleared only at the start of the *next* export attempt, so one failure left a red alert in the card indefinitely — through an edit, through a reload — and, because the resolved sentence was stored rather than the key, a language switch left it in the previous language. Now `exportErrorKey`, resolved at render, and cleared at the top of `loadTrip`.
  - `[low]` `[patch]` **The object URL leaked if `anchor.click()` threw.** The revoke was scheduled only after the click returned, so a throw pinned the whole archive (~16 MB) for the tab's lifetime, accumulating across retries. `anchor.remove()` and the deferred revoke moved into a `finally`.
  - `[low]` `[patch]` **The spinner collapsed the button and re-flowed the row.** `CircularProgress` replaces a ~150px label in a `flexWrap="wrap"` row, so Edit and Delete visibly rearranged for the duration of a photo-heavy export and rearranged back. `minWidth: 148` floors it. (Honest limit: this removes the collapse-to-spinner-width case, it does not make the button perfectly fixed-width.)
  - `[low]` `[patch]` **The RFC 5987 branch is dead code whose comment claimed it was live.** `toSafeSlug` reduces the trip name to `[a-z0-9-]` before it reaches `content-disposition`, so the route cannot emit `filename*=UTF-8''…`; the comment asserted that form "is the form a non-ASCII trip name would arrive in". Branch kept (free, and correct if the route ever changes), comment rewritten as defensive-only.
  - `[low]` `[patch]` **DW-76's closure read as the implementer making a product call the entry had reserved.** The entry ended "still a product call for Tommy", naming two candidate surfaces. The call was in fact made by this story's AC1, authored in `epics.md`. Resolution line rewritten to say so.
  - `[low]` `[patch]` **`epic-2-context.md` was untracked while the File List said "no file was added".** It is a workflow artifact of this run; now listed and committed.

Deferred as **DW-141**: `isOwner`/`canEditPlanning` default to `true` when the payload omits `accessRole`, so owner-only controls — now three of them — ride on a permissive fallback. Unreachable today (the detail route always sets the field, verified rather than assumed) and explicitly out of this story's scope, but Story 2.33 enlarges the consequence, so it is on the ledger.

Rejected: an `AbortController` aborting the request on unmount (new code, speculative, and a post-unmount `setState` is a no-op in React 18+); a hard request timeout (would abort a legitimately slow export of a large trip — the exact case this feature exists for); keeping the button enabled during export to avoid focus loss on `disabled` (the concern is real, but the remedy contradicts AC5's explicit "the button is disabled" and diverges from `TripImportDialog`, which is the app-wide pattern — recorded as a residual risk instead); disabling Delete while an export is in flight (guards a sequence the owner deliberately chose, and losing the alert to a navigation they initiated is not a defect); and a `content-length` pre-check against oversized archives (the route deliberately sends no `content-length`, so the guard is unimplementable as proposed, and the memory ceiling is a documented, accepted trade-off).

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`.

### Debug Log References

None. No failing run needed investigation; the rewritten suite was green on its first full execution.

### Completion Notes List

**Verification (run from `travelplan/`, all three at the end of implementation)**

> Superseded by the review pass, which added three test cases and a type/lint fix: the current figures are **989/989 tests in 105 files** and `tripTimelineRoles.test.tsx` at **21/21**, with lint and `tsc` back at exactly the baselines quoted below. The numbers in this block were accurate when written; see § Auto Run Result for the measurements that stand.

- `npm test` — **105 files passed / 105, 986 tests passed / 986, 0 failed** (136.72s). `tripTimelineRoles.test.tsx` alone: 18 passed / 18.
- `npm run lint` — **85 problems (2 errors, 83 warnings)**, byte-identical to the HEAD `5c89567` baseline re-measured with the change stashed. The 2 errors are the pre-existing `react/no-children-prop` pair in `src/theme.ts`. `TripTimeline.tsx` carries one warning ("Calling setState synchronously within an effect"), pre-existing: it sits at `:201` at HEAD and at `:264` here — the same `useEffect(() => { loadTrip(); }, [loadTrip])`, displaced by the lines this story inserted above it. `tripTimelineRoles.test.tsx`, `en.ts` and `de.ts` produce no warning at all.
- `npx tsc --noEmit` — **143 errors, identical count to HEAD, none under `src/**`**. All are the suite's long-standing fetch-mock `TS2352` casts and a few `TS2339`s under `test/**`. `tripTimelineRoles.test.tsx` contributes **0** — the extended stub keeps the file's existing `as unknown as typeof fetch` escape hatch, which is why the added `headers`/`blob` members type-check.

**Per-AC evidence**

- **AC1 (placement)** — `tripTimelineRoles.test.tsx` › "shows Export to an owner beside Edit and Delete, and still no Import": asserts all three buttons are found *within* `trip-controls-card`, that `controlsCards()` has length 1, and that the export button's class matches `MuiButton-outlined`. The pre-existing structural cases ("ends the day column with the controls card…" ×2 widths, "puts the controls card last on the page…" ×2 widths) still assert one card and its two mount points, unchanged and green.
- **AC2 (it downloads, no navigation)** — "exports the trip being viewed, saves it under the server's filename, and stays on the overview": asserts `fetch` was called with `/api/trips/trip-1/export` and `{ method, credentials: "include", cache: "no-store" }`; that the blob handed to `URL.createObjectURL` is a `Blob`; that the anchor the click fired on carries `download === "trip-owner-trip-2026-08-03.zip"` and the object-URL `href`; that it is detached afterwards and the URL revoked; that the trip heading is still mounted; and that no error text appeared. The filename half was added in the review pass — see § Review Triage Log. Its companion case, "falls back to a fixed archive name when the response carries no content-disposition", covers `EXPORT_FILENAME_FALLBACK`. **Still operator-owned:** that the browser writes a valid ZIP under that name. jsdom implements no downloads at all.
- **AC3 (owner only)** — "hides every owner-only trip action from a viewer" (absent), "shows contributor trip editing…" (absent, card present with Edit), "shows Export to an owner…" (present). Plus the two pre-existing viewer cases asserting `controlsCards()` length 0 at both layouts.
- **AC4 (deliberate inversion)** — see the dedicated note below; the rewritten owner case is "shows Export to an owner beside Edit and Delete, and still no Import".
- **AC5 (feedback)** — "disables the export button while the request is in flight and reports a failure inside the card": both halves in one case, because they are two points on one request. A gate promise held inside the fetch stub makes the in-flight window observable; mid-flight the button is `toBeDisabled()`, still findable by its accessible name, and contains a `progressbar`. After release, the error text is asserted **`within(card)`**, the button is `toBeEnabled()` again, the trip heading is still rendered and no "← Back to trips" link appeared — that last one is the assertion that fails if someone rewires the failure into the page-level `error` state. Three cases were added in the review pass to cover the rest of AC5's failure surface: "reports a request that never produced a response" (the `catch` branch — offline or a mid-stream archive failure, which AC5's *or a thrown request* names and nothing reached before), "tells an expired session apart from a generic export failure" (401), and the 404 case's message tightened from the generic sentence to the not-found one. **Still operator-owned:** that the pending state is perceptible on a real photo-heavy trip.
- **AC6 (import untouched)** — `git diff --stat` shows neither `TripsDashboard.tsx` nor `TripImportDialog.tsx` nor anything under `src/app/api/`; all three role cases assert no "Import backup" button exists on the overview.
- **AC7 (nothing else changes)** — 986/986 green with no pre-existing test modified except the three role assertions AC4 names. `i18nDictionaries.test.ts` (key-set parity, no empty values) passes with exactly two new keys per language.

**AC4: the test inversion, stated as a decision**

`test/tripTimelineRoles.test.tsx` asserted the *absence* of both import and export controls for every role. That assertion was **deliberately inverted for the owner case**, not loosened to make this change pass. Story 7.8 added it because the export button of the day was ungated and handed a contributor or viewer a bare 404 from the route's `hasTripOwnerAccess` gate; Task 2 gates the new button on `isOwner`, so the *reason* for the absence no longer holds and the owner half flips to presence. The contributor and viewer halves were **not** inverted — they still assert absence, and they are what makes the gate mechanical rather than incidental. Import did not flip at all: Story 2.32 put it on the trips list and this story does not move it.

A second finding, recorded because a reviewer should see it stated rather than discover it: those assertions were **vacuous** before this story. They queried `"Import JSON"` and `"Export JSON"`, and neither string is in `en.ts` or `de.ts` at HEAD — they would have passed with an export button rendered under any real label. They now query `"Import backup"` / `"Export backup"` through named constants (`IMPORT_LABEL`, `EXPORT_LABEL`) so the drift is harder to repeat.

**Trade-off: the whole archive is resident in memory client-side**

`fetch` → `response.blob()` → `URL.createObjectURL` buffers the entire ZIP in the tab before a byte reaches disk, where a plain `<a href="/api/trips/{id}/export" download>` would have streamed it and cost nothing. That is a real regression against the anchor on memory, and it was accepted for two things the anchor cannot do: (1) the route reports every failure as a JSON `{data,error}` envelope with a 401/403/404/500 status, and an anchor cannot read a status — it would silently save the envelope to disk as a file named `export`, making AC5's failure path unreachable by construction; (2) the anchor gives no hook for the pending state, and a photo-heavy archive takes long enough to build that AC5 asks for one. The largest archive seen in 2.31's verification was ~16 MB, comfortably inside what a browser holds. The ceiling to revisit, if exports ever reach hundreds of megabytes, is the File System Access API or a streamed `showSaveFilePicker`; it is not worth the Safari/Firefox fallback today. The comment on `handleExport` says all of this at the call site.

**Decisions the spec did not settle**

1. **`triggerBlobDownload` and `extractAttachmentFilename` are module-level, not in-component.** The spec pinned only `extractAttachmentFilename` as module-level; the anchor helper depends on nothing from the component either, so it sits beside it rather than being redefined on every render. `EXPORT_FILENAME_FALLBACK = "trip-backup.zip"` is a named module constant for the same reason.
2. **`URL.revokeObjectURL` is deferred by `window.setTimeout(…, 0)`** rather than called immediately after `click()`. Carried over from the helper Story 7.8 deleted; Safari has historically cancelled a download whose object URL was revoked inside the same task as the click. Documented at the call site.
3. **The error `Alert` carries `sx={{ mt: 1.5 }}`** and sits as a sibling *after* the button row, inside the card. Checked against the suite's `emotionDeclaredProperties(card)` assertions: that helper reads only rules targeting the card element's own emotion classes, so a margin on a child does not reach it and the "no width or margin on the card" assertions stay meaningful.
4. **The failure case uses 404, not 500.** It is what the route answers both for a non-owner and for a trip that vanished between load and press — the realistic failure. The component branches on `response.ok` alone, so the status behind it does not change the assertion; the stub still returns the route's real `{data:null,error:{code:"not_found"}}` envelope so a future change that starts reading the body has something honest to read.
5. **`URL.createObjectURL` / `URL.revokeObjectURL` are assigned onto the `URL` constructor once for the whole test file, not stubbed per case.** `vi.stubGlobal` reaches `globalThis` properties only, and tearing the stubs down in `afterEach` would race the `setTimeout(0)` revoke: a timer firing after the teardown would surface as an unhandled error inside a timer rather than as a test failure. Cases that care clear the mock instead. Reasoned at the declaration.
6. **`stubDetailFetch`'s new `exportResponse` parameter is optional**, so every case predating this story keeps its exact behaviour — including the `Unhandled fetch` throw, which still fires if the component ever starts calling the export route unprompted.
7. **The in-flight state is observed through a gate promise** awaited inside the fetch stub. Without it the request settles inside the same click that started it and the disabled/spinner window never exists for an assertion to see; this is what turns AC5's pending half from a manual-only check into a mechanical one.
8. **Both new i18n keys sit between `trips.delete.open` and `trips.import.open`** in each dictionary, with a comment in `en.ts` recording why the label key is `.open` and not the retired `.action` (and a one-line pointer to it in `de.ts`, matching how that file cross-references `en.ts` elsewhere).

**Known cosmetic noise:** the AC2 case prints `Not implemented: navigation to another Document` to stderr. That is jsdom, which implements neither the `download` attribute nor downloads at all, reacting to the anchor click. The test passes; there is nothing to suppress without also hiding real navigation.

**Not done:** Task 5 (operator-owned, needs a browser). Its checkboxes are deliberately left unticked. jsdom computes no downloads and no layout, so nothing in the suite can prove the browser saves a valid ZIP under the server's filename, or that the pending state is perceptible on a real photo-heavy trip.

### File List

**Modified — production**

- `travelplan/src/components/features/trips/TripTimeline.tsx` — module-level `extractAttachmentFilename`, `EXPORT_FILENAME_FALLBACK` and `triggerBlobDownload`; `CircularProgress` added to the MUI import; `exportError` and `isExporting` state; `handleExport`; the third outlined button and the error `Alert` inside the single `tripControlsCard` definition.
- `travelplan/src/i18n/en.ts` — `trips.export.open` = "Export backup", `trips.export.error` = "Trip export failed. Please try again."
- `travelplan/src/i18n/de.ts` — `trips.export.open` = "Backup exportieren", `trips.export.error` = "Reiseexport fehlgeschlagen. Bitte erneut versuchen."

**Modified — test**

- `travelplan/test/tripTimelineRoles.test.tsx` — label constants and the file-wide object-URL stubs; `stubDetailFetch` extended with an optional gated export response; the three role assertions rewritten against the real dictionary strings; the owner case retitled and inverted; two new owner cases (route target / no navigation, and in-flight plus failure).

**Modified — docs**

- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-76 closed (`status: done 2026-08-03`) with a resolution naming the surface and the keys.
- `_bmad-output/implementation-artifacts/2-33-restore-export-entry-point.md` — this record.

**New — docs**

- `_bmad-output/implementation-artifacts/epic-2-context.md` — the compiled Epic 2 planning context this run produced before planning. A workflow artifact rather than a story deliverable, but it is committed with the story that generated it.

**New — production/test** — none. No source or test file was added by this story.

### Change Log

- 2026-08-03 (implementation): Implemented Tasks 1, 2, 3, 4 and 6; Task 5 left to the operator. Added an owner-only "Export backup" button as the third outlined control in the single `tripControlsCard` definition in `TripTimeline.tsx`, fetching `GET /api/trips/{id}/export` and saving the blob under the server's `content-disposition` filename through a detached anchor, with `isExporting` driving a spinner behind a persistent `aria-label` and a dedicated `exportError` alert inside the card. Added `trips.export.open` / `trips.export.error` to `en.ts` and `de.ts`. Rewrote the three role assertions in `tripTimelineRoles.test.tsx` against the real dictionary strings — the owner half deliberately inverted from absence to presence, the contributor and viewer halves left asserting absence — and added two owner cases covering the request target plus the in-flight and failure states. Closed DW-76. Verification: `npm test` 105/105 files, 986/986 tests, 0 failed; `npm run lint` 85 problems (2 errors, 83 warnings), identical to the HEAD baseline, with `TripTimeline.tsx`'s single warning confirmed pre-existing by re-measuring at `5c89567`; `npx tsc --noEmit` 143 errors, identical count to HEAD, none under `src/**`.
- 2026-08-03 (bmad-dev-auto planning): Resolved the three decisions this spec had left open to the implementer and pinned every line reference to HEAD `5c89567` rather than the authored `e058259` baseline. (1) Download mechanism — fetch + object URL, not a plain anchor, because every route failure is a JSON envelope and an anchor makes AC5's error path unreachable. (2) i18n keys — `trips.export.open` (not the retired `trips.export.action`, whose meaning has since settled on "dialog submit label") and `trips.export.error`. (3) Error slot — a dedicated `exportError` state inside the card rather than the page-level `error`, which owns the "Back to trips" recovery branch. Added Given/When/Then clauses to all seven ACs, a Code Map, a Verification section, and Task 6 to close DW-76. Recorded the finding that the existing role assertions query strings absent from both dictionaries and are therefore vacuous. Task 5 marked operator-owned.
- 2026-08-03 (review pass): Adversarial and edge-case review of the full `5c89567..HEAD` diff. 10 patches applied, 1 finding deferred (DW-141), 5 rejected, 0 intent gaps, 0 spec defects — see § Review Triage Log. Three of the patches change behaviour rather than comments: `handleExport` now reads the failure envelope and maps `unauthorized` / `not_found` / `server_error` to existing messages instead of reporting "please try again" for a session that has expired or a trip that is gone; `exportError` became `exportErrorKey`, resolved at render and cleared in `loadTrip`, so the alert neither outlives its cause nor survives a language switch in the old language; and the anchor's detach-and-revoke moved into a `finally`. The remainder are a `minWidth` floor so the spinner does not re-flow the control row, `aria-busy`, and three comments that stated facts which were wrong (`validateCsrf` guards 22 route handlers, not three; the RFC 5987 branch cannot run against this route). Test coverage went from 18 to 21 cases: the filename path is now pinned by a click spy — a mutation deleting `anchor.download` was green before this pass and fails 2 tests after it — plus new cases for the fallback name, a request that never produced a response, and a 401. Suite 105 files / 989 tests, lint 85 problems (2 errors, 83 warnings) and `tsc` 143 errors with none under `src/**`, all three exactly the `5c89567` baseline.

## Auto Run Result

Status: **awaiting-operator** — Tasks 1, 2, 3, 4 and 6 are complete, reviewed and committed. Task 5 is manual verification that needs a browser and a running dev server, and nothing in the suite can substitute for it: jsdom implements no downloads and computes no layout. It is enumerated under `operator_actions` in the frontmatter.

**What was implemented.** An owner-only "Export backup" control as the third outlined button in the trip overview's single trip-controls card, closing the asymmetry Story 2.31 left behind — import had a button, export had a URL with an internal cuid in it. The button fetches `GET /api/trips/{id}/export`, saves the returned ZIP through a detached anchor under the server's `content-disposition` filename, shows a spinner behind a persistent accessible name while the archive builds, and reports a failure in an alert inside the card. It is gated on `isOwner`, the same flag as Delete and the same boundary the route enforces with a 404. The route, the archive format and both dictionaries' existing contracts are otherwise untouched.

**Files changed.**

- `travelplan/src/components/features/trips/TripTimeline.tsx` — the whole feature: `extractAttachmentFilename`, `triggerBlobDownload`, `EXPORT_FILENAME_FALLBACK`, the `exportErrorKey` / `isExporting` state, `handleExport` with envelope-code mapping, and the button plus alert inside the one `tripControlsCard` definition.
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — `trips.export.open` and `trips.export.error`, two keys per language, placed with their siblings.
- `travelplan/test/tripTimelineRoles.test.tsx` — the deliberate AC4 inversion plus six export cases; 21 tests, up from 18 at HEAD.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-76 closed, DW-141 opened.
- `_bmad-output/implementation-artifacts/epic-2-context.md` — new; the compiled Epic 2 planning context this run produced.

**Review findings.** 10 patches applied, 1 deferred (DW-141), 5 rejected, 0 intent gaps, 0 spec defects. Breakdown and reasoning in § Review Triage Log.

**Verification performed.** Every figure below was measured by the orchestrator after the patches, not carried over from a subagent report. The baselines were re-measured at `5c89567` with the change stashed, in the same session.

- `npm test` → **105 test files passed, 989 tests passed, 0 failed.**
- `npm run lint` → **85 problems (2 errors, 83 warnings)** — identical to the stashed baseline, including the count. Both errors are the pre-existing `react/no-children-prop` pair in `src/theme.ts`, a file this story never touched.
- `npx tsc --noEmit` → **143 errors, identical to the baseline, none under `src/**`**, and none in `tripTimelineRoles.test.tsx`.
- Mutation check: replacing `anchor.download = filename` with a literal fails 2 tests. Before the review pass the same mutation was green — this is the evidence that AC2's filename claim is now actually pinned rather than merely asserted in prose.

**Residual risks.**

- **The archive is fully resident in memory client-side** before it reaches disk. Deliberate — it is what makes AC5's error path and pending state possible at all — and comfortable at the ~16 MB seen in 2.31's verification, but it is the ceiling to revisit if exports reach hundreds of megabytes.
- **Disabling the button during export blurs it** if it had keyboard focus, and focus falls to `<body>`. Raised in review and rejected rather than fixed: the remedy contradicts AC5's explicit "the button is disabled" and would diverge from `TripImportDialog`, which is this app's pattern for exactly this. Worth a focused a11y story across all of them, not a one-off here.
- **`server_error` and the default error branch are not directly test-covered** — `unauthorized`, `not_found` and the thrown-request path are. A wrong key in either of the two uncovered branches would surface as a raw key string in the alert.
- **No export has ever been performed from a browser against this code.** Everything above is jsdom. That is what Task 5 is for.

**Follow-up review recommended: true.** Three of the ten patches change runtime behaviour rather than comments — the error-code mapping is new user-visible messaging, the error state changed shape and its clearing reached outside the new code into `loadTrip`, and the download helper's cleanup contract moved. That is more than a handful of localized cosmetic fixes, and it all landed after the implementation pass rather than being reviewed as written.
