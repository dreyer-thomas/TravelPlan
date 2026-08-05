---
authored_against: 3a42ec7
baseline_commit: 3a42ec7a155d66339a80e4c1e4f6e5f12d848e30
---

# Story 9.2: Documents in Print and an Offline Packet

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Prerequisites — read before starting

**This story cannot be implemented until Stories 8.3 and 9.1 are done.** At `3a42ec7` both are `backlog` and neither has a story file. There is no `AccommodationDocument` table, no `DayPlanItemDocument` table, no document upload route and no document on any entry — so there is nothing for this story to print or package.

Before dispatching a dev agent, confirm in `sprint-status.yaml`:

- `8-3-uploaded-media-behind-the-login: done` — this story reads uploaded bytes off disk and 8.3 moves the uploads root and renames `UPLOADS_PUBLIC_ROOT`. Building against today's `public/` path means rewriting the file-reading half afterwards.
- `9-1-documents-on-stays-and-activities: done` — this story's entire input.

Everything below is written against the *specified* shape of 9.1 (`epics.md#Story 9.1`): `AccommodationDocument` and `DayPlanItemDocument` mirroring `AccommodationImage`/`DayPlanItemImage` (`schema.prisma:239-267`), with a `(parentId, sortOrder)` unique index and cascade delete. **When 9.1 lands, re-read its story file and its schema before starting: field names, the accepted MIME list and the `trips.documents.*` key namespace are 9.1's decisions, not this story's assumptions.**

## Story

As a traveller standing at a gate with no signal,
I want the day's tickets available as files I already have on my device,
so that the plan and the documents that make it usable are both offline.

## Acceptance Criteria

1. **Image documents append to the printed day plan as full pages.** Each one page-broken onto its own page after the itinerary, scaled to fit inside the existing `@page` box (A4 portrait, `16mm 14mm` margins — `TripDayPrintDocument.tsx:84-87`) without cropping or distortion, and oriented so a portrait ticket is not printed sideways. The last one adds no trailing blank page.

2. **PDF documents are named, not silently dropped.** An appendix after the itinerary lists every PDF document of the day by file name and by the entry it belongs to, and states plainly in the printed output that these files are *not* included in this print. A silent omission is the one failure mode that matters on an offline artefact — the traveller finds out at the gate.

3. **The appendix appears only when there is something to say.** No image documents on the day → no image pages. No PDF documents → no appendix. No documents at all → the printed sheet is byte-for-byte what it is today.

4. **One packet PDF per day, in timeline order.** A request for the day's document packet returns a single PDF containing every document of that day — PDFs page-for-page, image documents embedded as pages — in the same order as the day timeline (`previousStay` → plan items by `compareDayPlanItemsByStartTime` → `currentStay`), and **that order comes from the code that already decides it**, not from a second sort. Each document is preceded by a label page naming the entry it belongs to and the document's file name, so the packet is navigable with no app.

5. **A document that cannot be merged is reported inside the packet, never dropped and never fatal.** An encrypted PDF, a corrupt file, a missing file on disk or an image format `pdf-lib` cannot embed produces a label page saying so and naming the file, and the rest of the packet is still produced. One bad ticket does not cost the traveller the other nine.

6. **The packet route enforces read access and refuses an empty day distinctly.** `requireSession` plus the same read predicate Story 8.3's serving route uses (`hasTripReadAccess` — owner, viewer and contributor all pass; anyone else 404s). A day with **no documents** answers with its own error code and a message of its own, not an empty PDF and not the generic not-found string.

7. **The packet is reachable from the day screen** in both languages, and the download reports failure rather than saving an error envelope to disk as a file. Every new user-facing string exists in `en.ts` *and* `de.ts` under 9.1's `trips.documents.*` namespace; `i18nDictionaries.test.ts` stays green.

8. **`pdf-lib` is added as a server-only runtime dependency and the gates hold.** `npm run audit:check` is still `0`, `npm test` is green with no baseline moved (see *Baselines* below), and a **real multi-page ticket PDF plus a real portrait phone photo are verified in the merged output on screen** — page count, page order, orientation and legibility. AC1's and AC4's orientation claims are rendered-pixel claims and no unit test can answer them.

## Tasks / Subtasks

- [ ] **Task 1 — Carry documents into the print payload** (AC: 1, 2, 3, 4)
  - [ ] Add `documents` to `TripDayPrintStay` and `TripDayPrintPlanItem` (`tripRepo.ts:161-184`). Shape: `{ id, documentUrl, fileName, sortOrder }` — align the field names with whatever 9.1's schema actually uses.
  - [ ] Extend `getTripDayPrintPayloadForUser` (`tripRepo.ts:1025`). It runs in deliberate rounds: round 1 access+day, round 2 previous-day stay + plan-item images, round 3 accommodation images (which needs round 2's ids). Documents follow exactly the same shape — batch them **into rounds 2 and 3** beside the image queries rather than adding a serial fourth round.
  - [ ] Build `documentsByParentId` maps the way `accommodationImagesById` / `planItemImagesById` are built (`:1124-1136`). Order by `[{ sortOrder: "asc" }, { createdAt: "asc" }]`, matching the image queries.
  - [ ] **Do not add a separate document ordering rule.** The timeline array the function already builds (`:1170-1229`) *is* the answer to "timeline order" for both AC1 and AC4.
  - [ ] `tripRepo.test.ts` and `tripDayPrintRoute.test.ts` both assert on this payload; add cases, keep the existing ones.

- [ ] **Task 2 — Image documents as print pages** (AC: 1, 3)
  - [ ] In `TripDayPrintDocument.tsx`, after the itinerary and before the footer, render one block per image document across all timeline entries, in timeline order.
  - [ ] Add a print rule alongside the existing ones (`:88-93`): `page-break-before: always; break-before: page` on each block, and constrain the image to `max-width: 100%; max-height: 100%; object-fit: contain` so it fits the printable box instead of overflowing it.
  - [ ] **Check the trailing blank page.** `break-after` on the final block, or a `:last-child` exemption. A blank last page is the classic tell that the rule was written and not printed.
  - [ ] Orientation on this half is free: browsers default to `image-orientation: from-image`, so an EXIF-rotated phone photo renders upright in the browser and in its print output. **This is not true of the packet half — see Trap 2.**
  - [ ] Each page carries the entry name and the document file name, so a loose printed page can be matched back to what it belongs to.

- [ ] **Task 3 — The PDF appendix** (AC: 2, 3)
  - [ ] A section listing each PDF document as `<entry name> — <file name>`, plus one sentence stating these files are not part of this printout and where to get them (the packet).
  - [ ] **Write the strings as English literals in this component, and do not wire `useI18n` into it.** `TripDayPrintDocument.tsx` is entirely unlocalised today — `TRANSPORT_LABELS` (`:8`), `"Itinerary"`, `"Day route"`, `"Previous night accommodation"`, `Intl.DateTimeFormat("en-US")` (`:66`). Half-localising it is worse than either end. The localised strings in this story are the ones in Task 5, which live in `TripDayView`/`TripDayPrintPage` — those *do* use `useI18n` and *do* need both dictionaries.
  - [ ] Render nothing at all when the day has no PDF documents (AC3).

- [ ] **Task 4 — The packet route** (AC: 4, 5, 6, 8)
  - [ ] `GET /api/trips/[id]/days/[dayId]/documents/packet/route.ts`, `export const runtime = "nodejs"` — file reads and `pdf-lib` both need it.
  - [ ] Guard: `requireSession` then `hasTripReadAccess` (`src/lib/auth/tripAccess.ts:61`). Note `/api/trips/*` already passes through the middleware's 401/403 gate; the route guard is the second layer, not the only one, and both are required — every sibling route does both.
  - [ ] Source the document list and its order from the **same** function Task 1 extends, so the print sheet and the packet cannot disagree about the day's order.
  - [ ] No documents → `fail(apiError("no_documents", …), 404)`. **Its own code**: the client maps `not_found` to "trip not found" (`TripTimeline.tsx:441`), which would be a lie here.
  - [ ] Read bytes off disk through the `uploadPaths.ts` helper (`resolvePublicFilePath`, or whatever 8.3 renames it to) — **never by fetching the app's own URLs over HTTP**.
  - [ ] Merge with `pdf-lib`: `PDFDocument.create()`, then per document in order — a label page, then either `copyPages(src, src.getPageIndices())` for a PDF or `embedJpg`/`embedPng` + `drawImage` for an image. See *Working with pdf-lib* for the four things that go wrong.
  - [ ] Every per-document step in its own `try`/`catch` producing AC5's "could not be included" label page. A `throw` from one file must not reach the outer handler.
  - [ ] Respond `application/pdf` with `content-disposition: attachment; filename="…"`, mirroring `export/route.ts:95-101`. **Reuse `toSafeSlug`** (`export/route.ts:22`) rather than writing a fourth copy — DW-27 is the ledger entry for exactly this class of duplication, and it was closed by an import, not a new helper.
  - [ ] New suite `test/tripDayDocumentPacketRoute.test.ts`, patterned on `tripDayPrintRoute.test.ts`: node env, real `NextRequest`, real Prisma against the per-worker test db, `beforeEach` row cleanup. Cover 401, non-member 404, empty-day `no_documents`, viewer succeeds, ordering, and each AC5 degradation with a real bad byte sequence.

- [ ] **Task 5 — Entry point and download** (AC: 6, 7)
  - [ ] Add the packet item to the day overflow menu in `TripDayView.tsx` (beside Print, `:2433-2444`). **Not the print page's control row**: that page auto-fires `window.print()` on load (`TripDayPrintPage.tsx:75` → `TripDayPrintDocument.tsx:77-79`), so its buttons sit behind the browser's print modal the moment the page appears.
  - [ ] Add `packet: true` to `dayMenuItemsVisible` (`:495`) — read access, same gate as `print`. Feed `showDayMenuDivider` the same way `print` does.
  - [ ] **Do not copy `DAY_MENU_ITEM_SX`.** It is `{ minHeight: 44 }` (`:505`) and that is the *byte-identical broken version* Story 5.11's browser pass found: MUI resets `MenuItem`'s `minHeight` to `auto` above `sm`, and a plain `sx` is the same specificity as that media rule, so it measured 32.3px at 747px width. Use `{ '&&': { minHeight: 44 } }`. This is **DW-180**, and fixing the constant in place fixes both items at once — the better move here.
  - [ ] No `aria-label` (it would replace the visible name — WCAG 2.5.3, see the comment at `:2371`); no `aria-haspopup` (no dialog, no tab).
  - [ ] **Download via `fetch` + blob, not `<a download>`.** The route answers failures as `{data,error}` JSON, and AC6's empty-day refusal is precisely the response an anchor would save to disk as a file called `packet`. `TripTimeline.tsx:402-464` has the whole argument written out already, together with `triggerBlobDownload` (`:146`) and `extractAttachmentFilename` (`:122`). Both are module-private there — **extract them to a shared module and import from both call sites**; a second copy is the DW-27 pattern again.
  - [ ] Pending state while the packet builds (a 10-document day is real work), and an error surfaced on the day screen mapping `no_documents`, `unauthorized`, `not_found` and `server_error` to distinct messages.
  - [ ] Every new key in **both** `en.ts` and `de.ts` under 9.1's `trips.documents.*` namespace.

- [ ] **Task 6 — Dependency and gates** (AC: 8)
  - [ ] `npm i pdf-lib` into `dependencies` (not `devDependencies` — it runs in the request path).
  - [ ] Run `npm run audit:check` (`npm audit --omit=dev --audit-level=low`) and confirm it is still **0**. Do not reason about it; run it. If it goes red, see *pdf-lib is unmaintained* below before doing anything else.
  - [ ] Confirm no native build step and no new postinstall: `pdf-lib@1.17.1`'s whole tree is `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako@^1.0.11`, `tslib@^1.11.1`, all pure JS, MIT.
  - [ ] Check `next build` succeeds — `pdf-lib` is CJS/UMD and only ever imported from a `runtime = "nodejs"` route, but confirm nothing pulls it into a client bundle.

- [ ] **Task 7 — Browser and packet verification pass** (AC: 1, 2, 5, 8)
  - [ ] Every item here needs a real browser and a real PDF viewer. jsdom lays nothing out and `pdf-lib` output cannot be judged by a page count alone. **This project's history is emphatic on this point** — 6.26's `STAY_PANEL_MIN_HEIGHT` went from 300 by arithmetic to 400 by measurement, and 5.11's browser pass found a defect in the review's own patch.
  - [ ] Print a day carrying: one portrait phone photo *with EXIF orientation set*, one landscape image, one multi-page PDF ticket, one encrypted PDF. Check at 390px and desktop width.
  - [ ] Confirm: each image document is its own page, upright, uncropped, inside the margins; no trailing blank page; the appendix names the PDFs and says they are absent.
  - [ ] Open the packet in a real PDF viewer. Confirm total page count = sum of source PDF pages + one page per image + one label page each; the order matches the day timeline; the portrait photo is upright; the multi-page ticket is complete and legible; the encrypted PDF produced AC5's label page rather than killing the packet.
  - [ ] Print the day *after* Story 8.3 — the `<img>` tags now hit an authenticated route. 8.3's own AC covers this for photos; document images are the same request and worth re-confirming here rather than assuming.
  - [ ] **Cleanup discipline, as every recent story records:** work against a throwaway copy of `dev.db` on a spare port, hash the operator's real `prisma/dev.db` before and after and confirm it is bit-identical, write nothing into the real uploads tree, delete any injected harness script, and stop the server. Use a narrowly-targeted kill — a broad `pkill` took down Tommy's own `:3000` during 5.10.

## Dev Notes

### Why the two halves are different mechanisms

The printed day plan is `window.print()` over an HTML page and there is no PDF library in the tree. Image documents append to that output trivially. **PDF documents cannot** — an embedded PDF in an `<iframe>` or `<embed>` is not rendered into print output by any browser, and tickets are the case this story exists for.

Two approaches were rejected in `sprint-change-proposal-2026-08-05.md#3`: rendering the day plan server-side through headless Chrome (a browser in the deployment for one feature), and listing documents by name and leaving the user to print them (honest, but not an offline packet). So: the day plan keeps printing as HTML, and the documents merge server-side into their own PDF. **Two files offline, each doing its job, no rendering engine.** AC2's appendix is what keeps the HTML half honest about what it does not contain.

### Working with pdf-lib — four things that go wrong

**1. It cannot embed WebP.** The API is `embedJpg` and `embedPng`, and that is the entire list. The app's image accept list is `image/jpeg,image/png,image/webp` (`imageUploads.ts:13`), and if 9.1 mirrored it for image documents then a WebP document is reachable and `embedPng` throws on it. Handle it as AC5's degradation, and check what 9.1's accepted list actually is before assuming which formats can arrive.

**2. It ignores EXIF orientation.** `embedJpg` reads the JPEG's SOF dimensions and nothing else. A phone photo shot in portrait very commonly stores *landscape* pixels plus `Orientation: 6`, which every browser applies and `pdf-lib` does not. So AC4's portrait ticket comes out **sideways** if the page is sized from `image.width`/`image.height` alone. The two halves of this story therefore have genuinely different orientation behaviour: Task 2 gets it free from the browser, Task 4 has to read the EXIF `Orientation` tag out of the JPEG and rotate or transpose accordingly. This is the single most likely thing to ship silently wrong, which is why AC8 makes a real portrait phone photo a verification input rather than a nice-to-have.

**3. Encrypted PDFs throw.** `PDFDocument.load(bytes)` raises `EncryptedPDFError`, and airline and rail tickets are encrypted often enough that this is a normal case, not an edge one. `{ ignoreEncryption: true }` loads the document but `copyPages` off it can yield unusable pages. Try the load, catch, and fall back to AC5's label page — a page saying "this ticket could not be included, open it from the app" is worth more than nine tickets lost to the tenth.

**4. `drawText` with a standard font is WinAnsi-only.** `StandardFonts.Helvetica` cannot encode characters outside WinAnsi and **throws at draw time**. Label pages carry user-supplied file names. A ticket named with Greek, CJK or a typographic dash takes the whole packet down. Sanitise the name to WinAnsi with a visible replacement, or register `@pdf-lib/fontkit` and embed a real font — sanitising is the smaller change and enough for a label.

**Two deliberate shapes, so nobody "fixes" them later.** Copied PDF pages keep their own page size, so the packet is legitimately mixed-size (A4 label pages beside a US-Letter ticket); rescaling someone's ticket to fit a uniform sheet is worse than a mixed packet. And a label page *before* each document, rather than text drawn onto the document's first page — AC4 permits either, and drawing onto a copied page risks landing on top of the barcode.

**Memory.** `pdf-lib` holds every source document in memory and `save()` returns one `Uint8Array`. With 9.1's limits (10 documents × 10 MB) the worst case is ~100 MB resident. Same shape as the export route, whose own comment names ~16 MB as the largest observed and flags this as the ceiling to revisit (`TripTimeline.tsx:410-413`). Acceptable, worth a comment, not worth streaming.

### pdf-lib is unmaintained — the honest version

`pdf-lib@1.17.1` is the latest release and was published in **October 2021** (`time.modified` 2022-05-12). Snyk lists no direct vulnerabilities for it and none for `pako@1.0.11`; MIT; ~10M weekly downloads. So the `audit:check` gate should stay at 0 — but *run it*, because `tslib@^1` is old enough to be the thing that eventually moves.

**If the gate goes red**, `@cantoo/pdf-lib` is the actively maintained fork with the same API. It is deliberately *not* the default: the epic names `pdf-lib`, its dep tree is clean today, and swapping to a fork is a decision to make when there is a reason rather than pre-emptively. If you do swap, say so in the Completion Notes — it is a spec deviation, and this project records those rather than absorbing them.

### The print document you are editing

Read `TripDayPrintDocument.tsx` before touching it. 350 lines, no i18n, its own inline `<style>` for `@page` and three print classes, `.print-no-break` on each timeline card, and an `onReady` callback the page uses to auto-fire `window.print()`. It renders four timeline kinds and every branch reads `entry.item.images` / `entry.stay.images` — the same two places documents attach.

**Two live ledger entries sit in this file. Neither is yours; do not break either and do not silently fix either:**

- **DW-1** — the Google Maps link silently omits points with no coordinates, drawing a straight line past them. `map.missingLocations` is already in the payload and unused.
- **DW-109** — this sheet prints a distance for ship and flight where the day view suppresses it (`:180` vs `TripDayView.tsx:1177`). The fix wants one shared mode list across four surfaces.

### What must not regress

The print sheet is shipped, verified behaviour (Stories 6.8, 6.11, fix-68). A day with no documents must print exactly as it does today — AC3 is that requirement, and `tripDayPrintDocument.test.tsx` is what holds it. Read that suite before editing the component; **DW-2** notes one uncovered case in it already (`getEntryDisplayName` returning null for a titleless, empty plan item), so do not read green as complete.

### Baselines — do not move these

At `3a42ec7`, and every recent story records them because reviews check them:

- `npm test` → **1389 tests across 119 files**, all green. New tests raise the count; nothing existing may turn red.
- **0 `src/` type errors.** Test type errors are at a known **143** baseline — do not add to it.
- `npm run lint` → exactly **85 problems / 2 errors**, both pre-existing in `theme.ts`.
- `npm run audit:check` → **0**.
- **No new migration in this story.** 9.1 owns the document tables. If you find yourself writing a migration here, something has gone wrong.

Also relevant if a lint error appears in `TripDayView.tsx` or `TripDayPrintPage.tsx`: both are in **DW-3**'s scoped `react-hooks/set-state-in-effect` warn list in `eslint.config.mjs`. New code in them still has to be clean.

### Testing

Vitest 3.2, suites in `travelplan/test/`, `test/setup.ts` migrates a per-worker SQLite db and redirects uploads to a temp root via `UPLOADS_PUBLIC_ROOT` — **8.3 renames that variable**, so read the current name out of the tree rather than from this story.

- Route tests: node env, `new NextRequest(...)`, real Prisma, `beforeEach` deleting rows in FK order. Pattern: `tripDayPrintRoute.test.ts`.
- Component tests: `// @vitest-environment jsdom` first line, `@testing-library/react`. Pattern: `tripDayPrintDocument.test.tsx`.
- `i18nDictionaries.test.ts` fails on any key present in one dictionary and not the other. It is the parity gate, and it has caught a verbatim orphan key before (5.11).

**Two test-quality rules this project's reviews enforce, both learned the hard way:**

- **Never assert a height or a computed layout value in jsdom.** It resolves `height` to `""` for every element, so such an assertion passes whether the code is right, wrong or absent — 6.26's review found exactly this masquerading as proof.
- **Pin each fix with a test verified to fail without the fix.** Several 6.25/6.26/5.11 findings survived their own tests because the test could not have failed. For AC5 especially: feed the route a genuinely encrypted PDF and a genuinely truncated one, not a `vi.fn()` that throws.

### Traps

**1. `not_found` for an empty day.** The obvious code is the wrong one — the client already maps it to "trip not found". AC6 exists because a traveller told the trip does not exist, when the day simply has no tickets, will go looking in the wrong place.

**2. Timeline order, derived twice.** Two independent sorts is two surfaces that eventually disagree. `compareDayPlanItemsByStartTime` (`tripRepo.ts:452`) and the timeline assembly at `:1170-1229` already decide it; use them.

**3. `DAY_MENU_ITEM_SX` is the broken precedent.** It looks like the thing to copy and it is DW-180. See Task 5.

**4. `<a download>` pointing at the route.** Saves the JSON error envelope to disk as a file. Task 5.

**5. Fetching own URLs server-side.** After 8.3 the serving route needs the session cookie, which the server does not have. Read from disk through the `uploadPaths` helpers.

**6. Half-localising the print document.** It is 100% English literals today. Task 3.

**7. A fourth copy of `toSafeSlug`.** Import it. DW-27's whole content is this mistake.

### Project Structure Notes

New: `src/app/api/trips/[id]/days/[dayId]/documents/packet/route.ts`, `test/tripDayDocumentPacketRoute.test.ts`, and a shared module for `triggerBlobDownload` / `extractAttachmentFilename` (suggest `src/lib/http/blobDownload.ts`).

Updated: `src/lib/repositories/tripRepo.ts` (payload types + query rounds), `src/components/features/trips/TripDayPrintDocument.tsx` (image pages + appendix), `src/components/features/trips/TripDayView.tsx` (menu item + download handler + `DAY_MENU_ITEM_SX`), `src/components/features/trips/TripTimeline.tsx` (import the extracted helpers), `src/i18n/en.ts`, `src/i18n/de.ts`, `package.json`/`package-lock.json`, and the existing print suites.

No schema change, no migration, no new env var.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.2] — the five acceptance blocks this story expands
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.1] — the document tables, limits and accept list this story consumes
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.3] — the serving route whose access check AC6 mirrors
- [Source: _bmad-output/planning-artifacts/prd.md#Travel Documents] — FR40; NFR2's media annotation
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-05.md#3] — the two rejected approaches, and why 9.2 is split out
- [Source: travelplan/src/components/features/trips/TripDayPrintDocument.tsx] — the print sheet, its `@page` rules and its unlocalised strings
- [Source: travelplan/src/components/features/trips/TripDayPrintPage.tsx:75] — the auto-`window.print()` that rules out the print page as the entry point
- [Source: travelplan/src/lib/repositories/tripRepo.ts:161-208, :452, :1025-1229] — the print payload, the ordering rule and the query rounds
- [Source: travelplan/src/components/features/trips/TripTimeline.tsx:111-163, :402-464] — the blob-download pattern and the argument for it
- [Source: travelplan/src/app/api/trips/[id]/export/route.ts:22, :95-101] — `toSafeSlug` and the binary-response shape
- [Source: travelplan/src/lib/auth/tripAccess.ts:61] — `hasTripReadAccess`
- [Source: travelplan/src/lib/trips/uploadPaths.ts] — `resolvePublicFilePath`, and the reason the root is indirected
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:495-505, :2433-2444] — the day menu, its gate record and the 44px constant
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — DW-1, DW-2, DW-3, DW-9, DW-27, DW-109, DW-180
- [Source: https://pdf-lib.js.org/docs/api/classes/pdfdocument] — `copyPages`, `embedJpg`, `embedPng`, `load({ ignoreEncryption })`
- [Source: https://security.snyk.io/package/npm/pdf-lib] — no known direct vulnerabilities at 1.17.1

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
