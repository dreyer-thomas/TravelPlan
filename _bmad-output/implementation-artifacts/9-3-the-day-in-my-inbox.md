---
baseline_commit: 784b74435b6e3ac3330f8f41f0a829d83a79d880
---

# Story 9.3: The Day in My Inbox

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Prerequisites — read before starting

- **Story 8.10 is committed** (`784b744`). *Alle flexibel machen* is gone from the day ⋯ menu; `dayMenuItemsVisible` is now `dayImage / transfers / print / packet`. This story adds one key to that record. If `makeFlexible` still shows up anywhere in `src`, stop: you are on the wrong base.
- **Story 8.8 is live** (`sendEmail` sends over Strato SMTP in production, in-memory outbox elsewhere) and **Story 9.2 is done** (the packet route). This story reuses both. It adds **no** dependency, **no** env variable and **no** migration.
- Origin: Tommy with John (PM), 2026-10-21. Source of truth: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-21-day-email.md` and Story 9.3 in `epics.md` (FR51).

## Story

As a traveller who will be without signal tomorrow,
I want to send a day's plan and its tickets to my own email address from the day view,
so that both are on my phone in my mail app, offline.

## Acceptance Criteria

1. **Menu entry, every role.** The day view's ⋯ menu offers *Per E-Mail senden* / *Send by email* to owner, contributor and viewer (everyone with read access, like the packet), directly after *Download document packet*.
2. **Pending, once.** While the request runs the entry shows a pending label, is `disabled` and `aria-busy`, and cannot fire a second request.
3. **Recipient = session only.** The mail goes to the signed-in account's email address, read from the database by `session.sub`. The request carries no recipient; a `to`/`email` in the body is ignored (the route does not read the body at all).
4. **Guards.** `POST /api/trips/[id]/days/[dayId]/email`: CSRF check (`x-csrf-token` vs. CSRF cookie, 403 `csrf_invalid`) → `requireSession` (401) → params (400) → `hasTripReadAccess` (404 `not_found` for non-members) → day payload (404 if missing). Viewer allowed.
5. **Language.** Subject, body and every label are in the **currently selected UI language** — the `lang` cookie via `getRequestI18n(request)` (not `preferredLanguage`). Every string lives in `en.ts` and `de.ts`.
6. **Two parts, same content.** The mail has an HTML part and a plain-text alternative carrying the same content.
7. **Content.** Trip name; the day's date via `formatLongDate` (as in the day view hero / print sheet) and the day heading (`Day N` + day note); previous night's stay (name, check-out time); activities in timeline order with times (`fromTime – toTime`), duration, place (`location.label`), and plan text via `parsePlanText`; travel legs between entries (mode, duration, distance where the mode allows it, `from → to`); tonight's stay (name, check-in time, notes). An activity whose times are `null` (does not fit the day, see `daySchedule.ts` rule 5) shows its duration and no time.
8. **Link.** A link to the day: `new URL(`/trips/${tripId}/days/${dayId}`, APP_BASE_URL)` (fallback `http://localhost:3000`, as the reset route does).
9. **No external anything.** No images, no remote resources (no `<img>`, no `<link>`, no web fonts, no `url(...)`), no scripts, no `<style>` blocks or external CSS — inline `style=""` only, single column, `max-width: 600px`, readable at 390px.
10. **Escaping.** All user text (trip name, titles, places, notes, stay names, day note, file names) is HTML-escaped in the HTML part. No stored HTML reaches the mail — plan content only ever as `parsePlanText` output, escaped.
11. **Attachment when it fits.** When the day has documents and the **finished, encoded mail including the packet is ≤ 20 MB** (`20 * 1024 * 1024` bytes), the packet PDF is attached, built by the **same code** as the packet download (same order, label pages, failure pages), with the same file name (`<slug>-day-<N>-documents.pdf`).
12. **Too large / cannot build.** When the mail with the packet would exceed 20 MB, or the packet cannot be built because the day has more than `MAX_PACKET_DOCUMENTS` documents, the mail is still sent **without** the attachment and says in a sentence of its own that the documents were too large for email and can be downloaded on the day page via the link; the app shows a message saying the same.
13. **No documents.** The mail is sent without an attachment and says the day has no documents; the app shows no extra message (just the success confirmation).
14. **Success.** The app confirms, naming the address it went to.
15. **SMTP failure.** The send is **awaited**. On failure/timeout the app shows that the mail could not be sent; nothing else changes. The log carries error code, response code and address-redacted message only — never the body, the attachment, the address or the error object.
16. **`sendEmail` extended.** Accepts optional `html` and `attachments` (`filename`, `contentType`, `content: Uint8Array`) and passes them to `nodemailer` in production and into the outbox elsewhere. The password-reset mail is unchanged (plain text only; its tests unchanged).
17. **Route tests** (against the outbox, no network): 401, non-member 404, viewer allowed, recipient from the session even when the body names another, language from the cookie (one German case), attachment present, attachment dropped over the cap, no-documents day, SMTP failure, HTML escaping of a hostile title. Plus CSRF 403.
18. **Production acceptance (Tommy, manual, after deploy).** A real day with documents sent from `https://plan.dreyer-travels.de` arrives at GMX, the HTML reads correctly on the phone, the packet opens offline, the link opens the day after sign-in; an oversized day produces the mail without the attachment and the in-app message.

**Out of scope:** the nightly automatic mail; sending to other members or arbitrary addresses; a separate day-plan PDF; a ZIP of original files; images in the mail; costs/payments in the mail; changing the password-reset mail; rate limiting (the recipient is always oneself).

## Tasks / Subtasks

- [x] **Task 1: Extend `sendEmail`** (AC: 16)
  - [x] `src/lib/notifications/email.ts`: `EmailMessage` gains `html?: string` and `attachments?: EmailAttachment[]` where `EmailAttachment = { filename: string; contentType: string; content: Uint8Array }`. Export both types.
  - [x] Production: pass `html` and `attachments` (`content` as `Buffer.from(content.buffer, content.byteOffset, content.byteLength)` — no copy) to `sendMail` **only when present**, so the reset mail's `sendMail` call stays `{ from, to, subject, text }` exactly (the existing "no `html`" assertion in `email.test.ts` must keep passing unchanged).
  - [x] Outbox: push the message as given (attachments included). Nothing else on that path changes.
  - [x] Update the `SMTP_TIMEOUT_MS` docblock: it no longer only bounds a background send — the day-email route awaits, so the per-phase timeouts now also bound that request (per phase, not total).
  - [x] Move `describeSendFailure` + `ADDRESS_PATTERN` out of the reset route into `email.ts` (or `src/lib/notifications/sendFailure.ts`) and import it from both routes. Reset route behaviour and its tests unchanged.
  - [x] `test/email.test.ts`: production passes `html` and `attachments` through (filename, contentType, bytes equal); without them `sendMail` gets no `html`/`attachments` keys; outbox keeps them.
- [x] **Task 2: Share the packet build** (AC: 11, 12)
  - [x] Extract the body of the packet route — `collectTimelineDocuments`, the `MAX_PACKET_DOCUMENTS` check, the per-trip containment `readDocument`, `buildDocumentPacket` with `onDegraded` logging, and the file name — into `src/lib/trips/dayPacket.ts`, e.g.
        `buildDayPacket({ tripId, dayId, payload, language, t, logPrefix }) → { kind: "empty" } | { kind: "tooMany" } | { kind: "built"; bytes: Uint8Array; fileName: string }`.
        Throws for the unexpected (containment escape, `MEDIA_STORAGE_ROOT` unset) exactly as today.
  - [x] Rewrite `documents/packet/route.ts` on top of it. Its responses, status codes, headers, log messages and the long comments' substance stay; **`test/tripDayDocumentPacketRoute.test.ts` must pass without edits.** Move the comments with the code they explain.
  - [x] `runtime = "nodejs"` stays on both routes.
- [x] **Task 3: Shared formatting helpers, server-importable** (AC: 7)
  - [x] Move `TRANSPORT_LABEL_KEYS` out of `TripDayPrintDocument.tsx` (a `"use client"` module — see Trap 1) into `src/lib/trips/transportTypes.ts` (keep the `Record<TransportType, string>` typing and its docblock), and the sheet's `formatDuration` into `printDocuments.ts` as `formatPrintDuration(minutes, t)`. The print sheet imports both back; `tripDayPrintDocument.test.tsx` passes unchanged.
- [x] **Task 4: Mail builder** (AC: 5–10, 12, 13)
  - [x] New `src/lib/notifications/dayEmail.ts` (server-only, pure, no I/O): `buildDayEmail({ payload, language, t, dayUrl, documents: "attached" | "tooLarge" | "none" }) → { subject, text, html }`.
  - [x] Walk `payload.timeline` once (it is already in order — do not sort); produce the plain-text and HTML from the same intermediate rows so the two parts cannot drift (AC6).
  - [x] One local `escapeHtml` (`& < > " '`) applied to **every** interpolated value in the HTML; the `dayUrl` goes into `href` escaped as well. No `dangerouslySetInnerHTML`, no React rendering — string templates.
  - [x] Plan text: `parsePlanText(item.contentJson)`; activity label: `getPrintEntryLabel(entry, index, planItemFallback)` with the same `trips.dayPrint.planItemFallback` wording (so the mail, the sheet and the packet label pages name an activity identically). Do **not** truncate the plan text in the mail (it is not paper) — but do keep the label rule.
  - [x] Reuse `trips.dayPrint.*` keys where they already say the right thing (`dayHeading`, `previousStay`, `currentStay`, `checkIn`, `checkOut`, `planItemFallback`, `durationHours/Minutes`, `empty`, `itinerarySection`) and `trips.travelSegment.transport.*` / `kmSuffix`. New keys under `trips.dayEmail.*` in both dictionaries: `subject` (`{trip}`, `{date}`), `intro`, `openDay` (link text), `documentsAttached`, `documentsTooLarge`, `documentsNone`, plus the UI keys from Task 6.
  - [x] Unit tests `test/dayEmail.test.ts`: order matches timeline; legs with `from → to`; `null` times show duration only; hostile strings (`<script>`, `"><img src=x onerror=…>`, `&`) appear escaped in HTML and raw in text; HTML contains none of `<img`, `<script`, `<link`, `<style`, `url(`, `http` other than the day link; German labels with `de`; each of the three document sentences.
- [x] **Task 5: Route `POST /api/trips/[id]/days/[dayId]/email`** (AC: 3, 4, 8, 11–15)
  - [x] New `src/app/api/trips/[id]/days/[dayId]/email/route.ts`, `runtime = "nodejs"`. Guard order per AC4 (CSRF first, as `days/[dayId]/image/route.ts` does). Do **not** read `request.json()`.
  - [x] `prisma.user.findUnique({ where: { id: userId }, select: { email: true } })` — the session JWT carries only `sub`/`role`. Missing user → 401 `unauthorized`.
  - [x] `getTripDayPrintPayloadForUser` → `buildDayPacket` → decide:
        `empty` → no attachment, `documents: "none"`;
        `tooMany` → no attachment, `documents: "tooLarge"`;
        `built` → compose the full mail with the attachment and measure it (see Dev Notes → *Measuring 20 MB*); `> MAX_DAY_EMAIL_BYTES` → rebuild the text with `"tooLarge"` and no attachment, else attach.
  - [x] `MAX_DAY_EMAIL_BYTES = 20 * 1024 * 1024` in its own tiny module `src/lib/notifications/dayEmailLimits.ts` so the route test can `vi.mock` it down (see Testing).
  - [x] `await sendEmail(...)`. Success → `ok({ sentTo: email, attachment: "attached" | "tooLarge" | "none" })`. Failure → `console.error("day email POST: mail not sent", describeSendFailure(error))` and `fail(apiError("email_failed", "The email could not be sent"), 502)`.
  - [x] Packet build throws unexpectedly → log like the packet route's catch (no address) and answer 500 `server_error`; **no mail is sent** (see Questions).
  - [x] `cache-control: no-store` on the response.
- [x] **Task 6: Menu entry and feedback in `TripDayView.tsx`** (AC: 1, 2, 12, 14, 15)
  - [x] `dayMenuItemsVisible` gains `email: true` (read access, same reasoning as `packet`; extend the block comment). `showDayMenuDivider` includes it in the second group.
  - [x] New `MenuItem` `data-testid="day-menu-email"` after the packet item, `sx={DAY_MENU_ITEM_SX}`, `disabled`/`aria-busy`/label swap exactly like the packet item. Own `emailPending` state.
  - [x] `handleSendDayEmail`: `ensureCsrfToken()` → `fetch(.../email, { method: "POST", credentials: "include", headers: { "x-csrf-token": token } })`, no body. Menu stays open while pending and closes in `finally` (packet pattern). Gate messages on `currentDayIdRef.current === requestedDayId` (packet pattern — the request can outlive a sibling-day navigation).
  - [x] Feedback: a new `emailNotice` state rendered beside the existing `{error && <Alert severity="error">}` slot (`TripDayView.tsx:~3538`): `severity="success"` with `trips.dayEmail.sent` (`{address}`); for `attachment: "tooLarge"` `severity="warning"` with `trips.dayEmail.sentWithoutDocuments` (`{address}` + "documents too large for email, download them on the day page"). Errors go through `setError`: `email_failed` → `trips.dayEmail.failed`; `unauthorized`/`password_change_required` → `errors.unauthorized`; `not_found` → `trips.detail.notFoundBody`; `csrf_invalid` → `errors.csrfInvalid`; default → `trips.dayEmail.failed`. Clear `emailNotice` on day change and when another action sets an error. Do **not** use `ActionNotice` (it is the undo receipt and hidden from viewers).
  - [x] Keys: `trips.dayEmail.action` (*Send by email* / *Per E-Mail senden*), `pending` (*Sending…* / *Wird gesendet …*), `sent`, `sentWithoutDocuments`, `failed`.
  - [x] Component test `test/tripDayViewEmail.test.tsx` (pattern: the packet menu tests in the 9.2 suite / `test/helpers/mockFetch.ts`): visible for owner, contributor, viewer; second click while pending does not fetch again; success names the address; `tooLarge` shows the warning; `email_failed` shows the error; divider still correct.
- [x] **Task 7: Route tests** `test/tripDayEmailRoute.test.ts` (AC: 17) — see Testing.
- [x] **Task 8: Docs** — append the Outbound-email note (proposal §4.7) to `architecture.md` *API & Communication Patterns* if John has not already; nothing in deployment docs (no new variable).
- [x] **Task 9: Gates** — `npm test` (baseline 3559 after 8.10), `npm run typecheck`, `npm run lint` (0 errors, warnings ≤ 80), `npm run build`, `i18nDictionaries.test.ts`. Browser pass under `next start`-equivalent dev: owner/viewer menu, send, outbox inspected, German UI → German mail. AC18 stays unchecked as "pending Tommy".

### Review Findings

- [x] [Review][Patch] Early guard responses (403 csrf_invalid, session 401, 400 params, 404 no access) lack `cache-control: no-store`; Task 5 asks for it on the route's responses [travelplan/src/app/api/trips/[id]/days/[dayId]/email/route.ts:81]
- [x] [Review][Defer] No rate limit on the mail route; a looping member can exhaust the Strato SMTP quota that password reset shares (rate limiting out of scope per story) [travelplan/src/app/api/trips/[id]/days/[dayId]/email/route.ts:77] — deferred as DW-412
- [x] [Review][Defer] `APP_BASE_URL` unset in production silently links every day mail to localhost; not in the boot fail-fast (same fallback as the reset route) [travelplan/src/app/api/trips/[id]/days/[dayId]/email/route.ts:118] — deferred as DW-413, pre-existing pattern
- [x] [Review][Defer] Awaited send has no overall deadline; a reverse-proxy timeout during a large SMTP upload shows "could not be sent" although the mail goes, and a retry duplicates it [travelplan/src/app/api/trips/[id]/days/[dayId]/email/route.ts:156] — deferred as DW-414
- [x] [Review][Defer] `emailPending` (like `packetPending`) survives a sibling-day navigation: the new day's menu shows "Sending…" and `finally` closes a menu opened on the new day [travelplan/src/components/features/trips/TripDayView.tsx:3507] — deferred as DW-415, pattern inherited from the packet handler

## Dev Notes

### What exists and what this story does to it

| File | Today | This story |
|---|---|---|
| `src/lib/notifications/email.ts` | `sendEmail({to,subject,text})`; SMTP per call in production (`usesSmtp()`), outbox elsewhere; throws on failure | + optional `html`, `attachments`; passed only when present |
| `src/app/api/auth/password-reset/request/route.ts` | fire-and-forget send, local `describeSendFailure` | imports the moved `describeSendFailure`; otherwise **untouched** |
| `src/app/api/trips/[id]/days/[dayId]/documents/packet/route.ts` | GET builds packet inline (containment, budgets, logging) | thin wrapper over `buildDayPacket`; identical behaviour |
| `src/components/features/trips/TripDayPrintDocument.tsx` | owns `TRANSPORT_LABEL_KEYS`, `formatDuration` | imports them back from `src/lib/trips/*` |
| `src/components/features/trips/TripDayView.tsx` | menu: dayImage, move, swap │ print, packet | + email entry, pending, notice |
| `src/i18n/en.ts`, `de.ts` | `trips.dayPrint.*`, `trips.documents.*` | + `trips.dayEmail.*` |

**Must be preserved:** packet download byte-for-byte and its tests; print sheet output and its tests; reset mail plain-text only; `dayMenuItemsVisible` mirror rule (each key mirrors its item's gate) and the divider rule from 8.10; the `currentDayIdRef` gating for long-running menu actions.

### Data you get for free

`getTripDayPrintPayloadForUser({ userId, tripId, dayId })` (`tripRepo.ts:1480`) returns `TripDayPrintPayload` (`tripRepo.ts:327`): `trip {id,name}`, `day {id,date,dayIndex,note,imageUrl}`, `timeline` already ordered `previousStay → (planItem | travelSegment)* → currentStay`. Plan items carry persisted `fromTime/toTime` (the scheduler writes them; `null` = does not fit the day), `durationMinutes`, `scheduleMode`, `contentJson`, `location.label`, `documents`. Segments carry `transportType`, `durationMinutes`, `distanceKm`. It does its own access check (returns `null`), but keep the explicit `hasTripReadAccess` like the packet route.

### Measuring 20 MB

The AC caps the **finished encoded mail**, not the PDF. Don't estimate — measure: nodemailer 10.1.7 exports `MailComposer` at `nodemailer/lib/mail-composer` (own types, ESM+CJS). `await new MailComposer({ from: "x@x", to, subject, text, html, attachments }).compile().build()` returns the RFC 822 `Buffer`; its `length` is the size. Works in every environment (no transport). Build it once with the attachment; if too large, drop it and switch the sentence. Peak memory ≈ packet + ~1.37× packet, bounded because the packet itself is bounded by 9.2's budgets. Rule of thumb: base64 + line breaks ≈ ×1.37, so the cap admits a packet of about 14.5 MB.

The mail size must be computed in the route (or a helper the route calls), **not** inside `sendEmail` — `sendEmail` stays a dumb transport.

### The HTML

Table-free simple blocks are fine; keep everything inline. Suggested skeleton: outer `<div style="max-width:600px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1a1a1a">`, heading block (trip name, day heading, date), a prominent day link, the documents sentence, then one block per timeline entry (stays with a left border, activities with time on its own line, legs as a muted single line of text: `Car · 1h 20min · 85 km — A → B`). No emoji, no colours that need dark-mode handling beyond black-on-white defaults (mail clients invert unpredictably; keep contrast plain). Wrap long words: `word-break:break-word` on text blocks. Include `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width,initial-scale=1">` in a minimal `<html><head>…</head><body>` — no `<style>`.

Plain text: same order, one entry per paragraph, the link on its own line.

### Logging rules (from 8.8)

`describeSendFailure(error)` → `{ code, responseCode, message }`, message with addresses replaced by `<address>`, non-`Error` → `non-Error thrown (<typeof>)`. Never log the error object, the recipient, subject, body or attachment. Packet degradations keep logging through the packet's `onDegraded` (document URL, no address) exactly as in the download route.

### Testing

- **Route suite** (`test/tripDayEmailRoute.test.ts`): copy `tripDayDocumentPacketRoute.test.ts`'s setup — real Prisma, `beforeEach` delete order, `fs.rm(getTripsUploadRoot())`, `createSessionJwt`, `writeUploadFile` + `getAccommodationDocumentUploadDir`/`getDayPlanItemDocumentUploadDir`, fixtures from `test/helpers/packetFixtures.ts` (`realPdfBytes`, `realJpegBytes`). Request: `POST` with `cookie: session=…; csrf_token=…; lang=de` and `x-csrf-token` (`CSRF_COOKIE_NAME` is `csrf_token` in `src/lib/security/csrf.ts`; mint a valid pair the way the other trip-route tests do). `clearEmailOutbox()` in `beforeEach`; read with `getEmailOutbox()`.
- **Cases:** 403 CSRF; 401; non-member 404; viewer 200 + mail; body `{ "to": "evil@example.test" }` → outbox `to` is the session user's address; `lang=de` → German subject/labels; documents present → one attachment, `application/pdf`, parses with `PDFDocument.load`, filename matches the packet route's; over the cap → `vi.mock("@/lib/notifications/dayEmailLimits", () => ({ MAX_DAY_EMAIL_BYTES: 64 * 1024 }))` in a **separate test file** (module mocks are file-wide) with a ~100 KB real PDF → no attachment, `attachment: "tooLarge"`, sentence present; `MAX_PACKET_DOCUMENTS + 1` documents → `tooLarge` without reading files (rows only, like the 9.2 test); no documents → no attachment, `attachment: "none"`; hostile title → escaped in `html`, raw in `text`.
- **SMTP failure:** run that case on the real production path as 8.8's review demanded: `vi.stubEnv("NODE_ENV","production")` + the five SMTP vars, `vi.mock("nodemailer")` with `sendMail` rejecting an error whose `message`/`response` contain the recipient and a sentinel password → 502 `email_failed`, and `console.error` arguments (stringified) contain neither the address, the sentinel, the subject nor the trip name. Separate file if the nodemailer mock would leak into the outbox cases.
- **No network** anywhere; production-path tests mock `nodemailer`.

### Traps

1. **Importing from a `"use client"` module into the route.** `TripDayPrintDocument.tsx` is a client module; any value import from it in server code compiles and throws at call time (`planText.ts` docblock tells the story). That is why Task 3 moves the helpers out first.
2. **Two copies of the packet build.** Copy-pasting the containment/`readDocument` block into the new route doubles the security-critical code. Extract it (Task 2).
3. **Recipient from the body.** Never parse the body. A test pins it.
4. **`preferredLanguage` vs cookie.** The reset mail uses `preferredLanguage`; this one must use the cookie (`getRequestI18n`). Copying the reset route gets it wrong.
5. **Fire-and-forget.** The reset route's `void sendEmail(...)` is deliberate *there* (timing enumeration). Here the result must be awaited (AC15).
6. **Estimating the size.** A `bytes * 4/3` estimate ignores line breaks, headers and the QP-encoded HTML; measure with `MailComposer`.
7. **Escaping only titles.** Stay names, notes, places, the day note, the trip name and file names are all user text. Escape at interpolation, every time.
8. **`ActionNotice` for the confirmation.** It is the undo receipt and is withheld from viewers; viewers can send the mail.
9. **Breaking the reset mail's `sendMail` shape.** Passing `html: undefined` adds a key; the existing test asserts no `html`. Spread only when present.

### Project Structure Notes

- New: `src/app/api/trips/[id]/days/[dayId]/email/route.ts`, `src/lib/trips/dayPacket.ts`, `src/lib/notifications/dayEmail.ts`, `src/lib/notifications/dayEmailLimits.ts`, tests `test/dayEmail.test.ts`, `test/tripDayEmailRoute.test.ts`, `test/tripDayEmailRouteCap.test.ts`, `test/tripDayEmailRouteSmtpFailure.test.ts`, `test/tripDayViewEmail.test.tsx`.
- The route sits beside `documents/`, `image/`, `print/` under `days/[dayId]`; the proxy matcher (`src/proxy.ts`) already covers `/api/trips/*`.
- App code is under `travelplan/`; run npm scripts there.

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-21-day-email.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.3: The Day in My Inbox]
- [Source: _bmad-output/planning-artifacts/prd.md — FR51, Integration Requirements]
- [Source: _bmad-output/implementation-artifacts/8-8-password-reset-emails-that-arrive.md — logging, timeouts, production-path tests]
- [Source: _bmad-output/implementation-artifacts/9-2-documents-in-print-and-an-offline-packet.md — packet route, menu item, traps]
- [Source: travelplan/src/lib/notifications/email.ts, smtpConfig.ts]
- [Source: travelplan/src/app/api/trips/[id]/days/[dayId]/documents/packet/route.ts]
- [Source: travelplan/src/lib/trips/printDocuments.ts, planText.ts, formatLongDate.ts, transportTypes.ts, daySchedule.ts]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:855-864, 3355-3440, 3784-3822]
- [Source: travelplan/src/i18n/request.ts]

## Questions for Tommy (do not block development)

1. **Packet build crashes unexpectedly** (not "too many", e.g. a server misconfiguration): this story answers 500 and sends no mail. Alternative: send the plan without the attachment anyway. Default chosen: no mail, because the "too large" sentence would be false.
2. **Costs** are left out of the mail (the AC lists no cost). Say if you want tonight's stay cost and activity costs in it.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- First full run: 4 failures. Three were `tripDayViewLayout.test.tsx` menu-list assertions that pin the exact ⋯ items (expected, since AC1 adds one). I updated them to include *Send by email*. The fourth did not reproduce on the rerun (225/225 files, 3603/3603).
- Lint went to 81 warnings once, from an unused `_init` parameter in the new component test. I replaced it with a typed `vi.fn<…>`, and lint is back to 80.
- Browser pass: binding port 465 was refused in the sandbox (EACCES), so the local SMTP sink ran on 2587 with STARTTLS. That is the app's `requireTLS` branch, with certificate verification on, trusting a self-signed localhost certificate through `NODE_EXTRA_CA_CERTS`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Task 1 / AC16.** `EmailMessage` gains optional `html` and `attachments` (`EmailAttachment` exported). In production they are spread into `sendMail` only when present, so the reset mail's call is still exactly `{from,to,subject,text}` and its tests are unchanged. Attachment bytes go in as a `Buffer` view, not a copy. A test pins a subarray view with a non-zero offset. The `SMTP_TIMEOUT_MS` docblock is updated. `describeSendFailure` and `ADDRESS_PATTERN` moved into `email.ts`; the reset route imports them, and its behaviour and tests are unchanged.
- **Task 2 / AC11.** `src/lib/trips/dayPacket.ts` `buildDayPacket` now holds the whole packet build: traversal, the `MAX_PACKET_DOCUMENTS` check, per-trip lexical and realpath containment, `buildDocumentPacket` with `onDegraded`, and the file name. The comments moved with the code. Log lines take a `logPrefix`, so the download still logs `documents packet GET: …`. The packet route is a thin wrapper with the same codes, statuses and headers. `tripDayDocumentPacketRoute.test.ts` passes with no edits (14/14).
- **Task 3.** `TRANSPORT_LABEL_KEYS` moved to `transportTypes.ts`. `formatDuration` moved to `printDocuments.ts` as `formatPrintDuration(minutes, t)`. **Also `getEntryDisplayName` moved to `printDocuments.ts`**: the mail's `from → to` needs the sheet's exact naming, and the function lived in the same `"use client"` module (Trap 1). `printDocuments.ts` now imports `formatMessage` from `@/i18n`, and the docblock sentence that claimed it was `@/i18n`-free is corrected. Print tests pass unchanged.
- **Task 4 / AC5–10.** `src/lib/notifications/dayEmail.ts` `buildDayEmail` is pure. It walks the timeline once into worded rows, and both the text and HTML parts render from those rows. A single `escapeHtml` (`& < > " '`) is applied at every interpolation, including the `href`. Activity labels come from `getPrintEntryLabel`. Plan text comes from `parsePlanText`, untruncated, and is dropped only when it equals the label. An activity with `null` times shows its duration only. An unknown transport type prints raw. Leg distance follows `transportTypeAllowsDistance` (the sheet's rule). The HTML has inline styles only, `max-width:600px`, a `<meta charset>` and viewport, and no `<style>`, image, link, font, script or `url(`. Costs are left out (Question 2 default).
- **Task 5 / AC3, 4, 8, 11–15.** `POST …/days/[dayId]/email`: CSRF → session → params → `hasTripReadAccess` → user email by `session.sub` → payload. The body is never read. Language comes from one `getRequestI18n` call shared by the mail and the packet. Mail size is **measured** with nodemailer's `MailComposer` (`nodemailer/lib/mail-composer`, no transport) against `MAX_DAY_EMAIL_BYTES` from its own module. A packet that is `tooMany` or over the cap gives `tooLarge` with no attachment; an `empty` packet gives `none`. The send is awaited. A failure is logged through `describeSendFailure` and answered 502 `email_failed`. An unexpected packet failure is answered 500 and **no mail is sent** (Question 1 default). Responses carry `cache-control: no-store`.
- **Task 6 / AC1, 2, 12, 14, 15.** `dayMenuItemsVisible.email = true`, and the divider rule includes it. `day-menu-email` sits after the packet, with `disabled` + `aria-busy` + label swap and its own `emailPending`. The menu stays open while pending and closes in `finally`. Messages are gated on `currentDayIdRef`. `emailNotice` renders under the error slot: success, or a warning for `tooLarge`. It clears on a day change, and also during render whenever `error` becomes non-null (React's adjust-state-in-render pattern, no effect). It does not use `ActionNotice`. 11 new i18n keys exist in en and de, in the dictionary's existing *du* register.
- **Task 7 / AC17.** Tests: `tripDayEmailRoute.test.ts` (12), `tripDayEmailRouteCap.test.ts` (2, cap mocked to 64 KB with a ~100 KB real PDF; the packet alone fits, base64 pushes the mail over), `tripDayEmailRouteSmtpFailure.test.ts` (1, real production path with nodemailer mocked; the log carries no address, sentinel password, `AUTH PLAIN`, trip name, subject, HTML or file name), `dayEmail.test.ts` (17), `tripDayViewEmail.test.tsx` (8), and `email.test.ts` (+4).
- **Task 8.** The Outbound-email note was already in `architecture.md` *API & Communication Patterns* (line 171). No change, and no deployment-doc change.
- **Task 9.** `npm test` 225 files / **3603 tests** (3559 + 44), typecheck 0, lint 0 errors / 80 warnings, `npm run build` OK (`i18nDictionaries.test.ts` included in the run).
- **Browser pass, under `next start` (16.4.2) on 3110.** Run against an APFS clone of `prisma/dev.db` and an APFS clone of `var/uploads` in the scratchpad. In the clone only: throwaway passwords, Konni added as VIEWER on *Neuseeland*, and two ~8 MB JPEG documents added to day 6's stay. Real production SMTP path to a local STARTTLS sink. Headless Chrome at 390px.
  - Owner menu (de): Zurück zur Reise · Tagesdetails bearbeiten · Aktivitäten verschieben · Aktivitäten tauschen · ─── · Tag drucken · Dokumentenpaket herunterladen · Per E-Mail senden ✓. Viewer menu (en): Back to trip · Print day · Download document packet · Send by email, no divider ✓
  - Day 1 (real tickets), German UI: 200 `attached`, about 0.9 s. Mail is 930 KB, subject *Tagesplan: Neuseeland, Montag, 14. Dezember 2026*. It has text/plain + text/html + `neuseeland-day-1-documents.pdf` (24 pages, parses). Notice: *Der Tagesplan wurde an thomas-dreyer@gmx.de gesendet.* ✓
  - Day 6 (~16 MB of documents): 200 `tooLarge`. Mail is 10 KB, no attachment, and carries the *zu groß* sentence. The app shows the warning alert ✓
  - Day 4 as viewer, English UI: 200 `none`, sent to Konni's own address, *This day has no documents.* ✓. (Day 2 reports `attached`, correctly: its previous-night stay is day 1's hotel with the tickets, the same as the packet download.)
  - Bad CSRF from the viewer's page with `{to:"evil@…"}` in the body → 403 ✓
  - Mail HTML rendered at 390px: 0 px horizontal overflow, no network request attempted, and the only URL is the day link ✓
  - No page errors. Server and sink stopped by PID, nothing left on 3110/2587, `prisma/dev.db` SHA-1 verified unchanged.
- **AC18 (production acceptance) is pending Tommy after deploy:** a real day to GMX, reading on the phone, the packet offline, the link after sign-in, and an oversized day.
- **Open questions (defaults implemented):** Q1, no mail when the packet build fails unexpectedly (500); Q2, no costs in the mail.

### File List

- `src/lib/notifications/email.ts` (modified)
- `src/lib/notifications/dayEmail.ts` (new)
- `src/lib/notifications/dayEmailLimits.ts` (new)
- `src/lib/trips/dayPacket.ts` (new)
- `src/lib/trips/printDocuments.ts` (modified)
- `src/lib/trips/transportTypes.ts` (modified)
- `src/app/api/trips/[id]/days/[dayId]/email/route.ts` (new)
- `src/app/api/trips/[id]/days/[dayId]/documents/packet/route.ts` (modified)
- `src/app/api/auth/password-reset/request/route.ts` (modified)
- `src/components/features/trips/TripDayPrintDocument.tsx` (modified)
- `src/components/features/trips/TripDayView.tsx` (modified)
- `src/i18n/en.ts` (modified)
- `src/i18n/de.ts` (modified)
- `test/email.test.ts` (modified)
- `test/tripDayViewLayout.test.tsx` (modified)
- `test/dayEmail.test.ts` (new)
- `test/tripDayEmailRoute.test.ts` (new)
- `test/tripDayEmailRouteCap.test.ts` (new)
- `test/tripDayEmailRouteSmtpFailure.test.ts` (new)
- `test/tripDayViewEmail.test.tsx` (new)
- `_bmad-output/implementation-artifacts/9-3-the-day-in-my-inbox.md` (story record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status)

### Change Log

- 2026-10-21: Implemented Story 9.3. Day ⋯ menu *Send by email* for every role. `POST days/[dayId]/email` sends to the session's own address in the `lang`-cookie language as HTML + text, with the 9.2 packet attached when the measured mail is ≤ 20 MB, otherwise without it and saying so. The send is awaited, with 502 `email_failed` on SMTP failure. `sendEmail` takes `html`/`attachments`. The packet build is extracted to `buildDayPacket`. The print helpers moved out of the client module. 3603 tests, typecheck, lint 0/80, build, browser pass under `next start` with a real SMTP round trip. AC18 is pending Tommy. Status → review.
- 2026-10-22: Code review (blind, edge case, acceptance). 1 patch applied: `cache-control: no-store` on the early guard responses (CSRF 403, session 401/403, params 400, non-member 404), asserted in `tripDayEmailRoute.test.ts`. 4 deferred (DW-412..DW-415), 17 dismissed. 3603 tests, typecheck clean. Status → done.
