# Sprint Change Proposal — 2026-10-21 (Day by Email)

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-21, including all points marked **[default]**. Edits 4.1–4.8 applied (the [default] markers were dropped from the story text in `epics.md`).
**Scope classification:** Minor. Two new stories (8.10 removal, 9.3 feature). One new FR (FR51). No schema migration, no new dependency, no new environment variable.

---

## 1. Issue Summary

Two changes, both from Tommy on 2026-10-21:

1. **Send the day by email.** During a trip Tommy wants a day's plan and its tickets on his phone *offline*. The day view's ⋯ menu gets an entry that mails the plan and the day's document packet to the signed-in user. Category: *new requirement*. It is the manual first step of the nightly mail that was parked in 8.8. That one stays parked.
2. **Remove *Alle flexibel machen*.** Story 13.3 added it as a one-time migration aid ("every existing activity is fixed after the migration, the user needs one step to release a whole day"). Tommy has finished migrating his trips. The entry is now dead weight in the menu. Category: *scope reduction of shipped work*.

**Evidence / starting point:**

- `src/lib/notifications/email.ts`: `sendEmail({ to, subject, text })`, SMTP over Strato in production since 8.8, in-memory outbox everywhere else. No `html` and no `attachments` yet.
- `GET /api/trips/[id]/days/[dayId]/documents/packet`: builds the day's packet PDF (`buildDocumentPacket` in `src/lib/trips/packetPdf.ts`) in timeline order, with the read-access guard and the UI language from the cookie (`getRequestLanguage`).
- `TripDayPrintDocument.tsx` already turns rich-text plan content into plain text (`parsePlanText`). The mail can render user text the same way and never pass stored HTML through.
- *Alle flexibel machen* lives in: `src/app/api/trips/[id]/day-plan-items/make-flexible/route.ts`, `dayPlanItemRepo.ts` (fn + error type), `dayScheduleTransaction.ts` (branch), `dayChangeReceipt.ts` + `dayChangeReceiptSchemas.ts` (`madeFlexible` kind), `dayPlanItemSchemas.ts`, `TripDayView.tsx` (menu item, confirm dialog, handler, visibility flag), `en.ts`/`de.ts` (`trips.dayView.makeFlexible*`), tests `dayMakeFlexible.test.ts`, `dayMakeFlexibleConflict.test.ts`, `dayScheduleMakeFlexible.test.ts`, `tripDayViewMakeFlexible.test.tsx`. Undo receipts are in-memory only (no Prisma model), so removing the kind leaves no stored rows behind.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 8: Maintenance & Infrastructure | Receives Story 8.10 (removal). Stays `in-progress`. |
| Epic 9: Travel Documents | Receives Story 9.3 (day by email) **[default]**: it is a way to take the day offline, next to the packet (FR40), not maintenance. Stays `in-progress`. |
| Epic 13 | Story 13.3 stays `done`; its *Alle flexibel machen* criterion is struck through with a pointer to 8.10. |
| Others | None. |

### Artifact impact

| Artifact | Change |
|---|---|
| PRD | Add FR51; amend the Integration Requirements line about email; add a changelog entry (4.1). |
| `epics.md` | FR51 in the inventory and coverage map; strike the 13.3 criterion; supersede "HTML email" in 8.8's *Out of scope*; add Story 8.10 and Story 9.3 (4.2–4.6). |
| Architecture | One note under API & Communication Patterns: `sendEmail` takes optional `html` and `attachments`; the day-email route is the first awaited caller (4.7). |
| UX | Day ⋯ menu: *Alle flexibel machen* goes, *Per E-Mail senden* comes, beside print and packet. No new screen, no new pattern. |
| `sprint-status.yaml` | Two new entries (4.8). |
| Deployment docs | None. No new variable; `APP_BASE_URL` and the five SMTP variables already exist. |

### Technical impact

- **Removal:** subtractive only. No migration. The import schema's minimum duration of 1 (`tripImportSchemas.ts:494`) **stays**: old exports still need it. Its comment is reworded so it no longer cites a feature that is gone.
- **Mail size:** base64 adds about a third. A 20 MB packet becomes a ~27 MB mail, and Gmail rejects that (25 MB). The cap applies to the **whole mail at 20 MB** **[default]**, which leaves room for a packet of about 14 MB.
- **Request time:** the packet build plus the SMTP send run inside one awaited request. The 15 s SMTP timeouts from 8.8 apply. Packet building is bounded by the existing packet limits.
- **Security:** the recipient always comes from the session, never from the request body. User text is HTML-escaped. Plan content goes through `parsePlanText`; stored HTML is never inserted. No images are embedded or linked: they sit behind the login and would not load offline anyway.

---

## 3. Recommended Approach

**Direct adjustment.** One subtractive story and one additive story on existing building blocks (SMTP from 8.8, packet from 9.2, plan text from the print sheet). No rollback, no MVP change.

- **Effort:** 8.10 low; 9.3 medium (mail template in two languages, transport extension, route, menu entry, tests).
- **Risk:** low. The main risk is mail rendering across clients, which the plain-text alternative and a real send to GMX cover.
- **Order:** 8.10 first (it takes an entry out of the same menu 9.3 adds one to, so the two diffs stay separate), then 9.3.

---

## 4. Detailed Change Proposals

### 4.1 PRD

**Changelog (frontmatter), append:**

```
  - date: '2026-10-21'
    changes: 'Added FR51 (send a day''s plan and document packet to the signed-in user''s own email address). Amended the Integration Requirements line on email. See Sprint Change Proposal 2026-10-21 (Day by Email).'
```

**Section *Integration Requirements*:**

OLD:
```
- Calendar/email integrations are explicitly not required at this stage.
```
NEW:
```
- Calendar/email integrations are explicitly not required at this stage. The app sends transactional mail of its own through the operator's SMTP account (password reset, FR4; a day sent to oneself, FR51); it does not connect to the user's mailbox or calendar. **(Amended 2026-10-21)**
```

**Section *Travel Documents*, after FR40:**

NEW:
```
- FR51: Users can send a day's plan, with a link to the day and the day's document packet attached, to the email address of their own account, so the day is available offline in their mail app. **(Added 2026-10-21)**
```

Rationale: the PRD said email integration is not needed; this is still true for integrations, but the app now sends user-triggered content mail, which deserves its own FR.

### 4.2 `epics.md`: Requirements inventory and coverage map

After the `FR50:` line in *Functional Requirements*:
```
FR51: Users can send a day's plan, with a link to the day and the day's document packet attached, to their own account's email address for offline use.
```
After `FR50: Epic 7 …` in the coverage map:
```
FR51: Epic 9 - Travel Documents (Story 9.3, added 2026-10-21)
```
Epic 9 header: `**FRs covered:** FR38, FR39, FR40` → `**FRs covered:** FR38, FR39, FR40, FR51`

### 4.3 `epics.md`: Story 13.3

OLD:
```
**Given** a day with fixed activities
**When** *Alle flexibel machen* is chosen from the day menu and confirmed
**Then** every fixed activity on the day becomes flexible with its current duration, keeping the order, the day is recomputed, and the notice offers *Rückgängig*
```
NEW:
```
~~**Given** a day with fixed activities
**When** *Alle flexibel machen* is chosen from the day menu and confirmed
**Then** every fixed activity on the day becomes flexible with its current duration, keeping the order, the day is recomputed, and the notice offers *Rückgängig*~~
> **Removed 2026-10-21 by Story 8.10.** A one-time migration aid; Tommy finished migrating his trips.
```
The *Context* sentence "Because every existing activity is fixed after the migration, the user needs one step to release a whole day." gets the suffix " *(That step was removed again by Story 8.10 once the migration was done.)*"

### 4.4 `epics.md`: Story 8.8 *Out of scope*

OLD: `… it will build on this transport); HTML email; an SPF record …`
NEW: `… it will build on this transport); HTML email (superseded 2026-10-21: Story 9.3 adds HTML for the day email; the reset email stays plain text); an SPF record …`

### 4.5 `epics.md`: new Story 8.10 (after Story 8.9)

```
### Story 8.10: *Alle flexibel machen* Goes Away

As someone whose trips are all migrated to durations,
I want the one-time *Alle flexibel machen* entry gone from the day menu,
So that the menu only offers what I still use.

**FRs covered:** None (removal of a migration aid from Story 13.3; FR43/FR46 unchanged)

**Depends on:** nothing. **Origin:** Tommy, 2026-10-21. See `sprint-change-proposal-2026-10-21-day-email.md`.

**Context:** Story 13.3 added *Alle flexibel machen* because every activity was fixed after the 13.1 migration. Tommy has released his days; nothing else needs the step. Undo receipts exist only in memory, so no stored data refers to the `madeFlexible` kind.

**Acceptance Criteria:**

**Given** the day view's ⋯ menu, for every role
**Then** *Alle flexibel machen* is not offered and its confirmation dialog no longer exists
**And** the menu's divider logic (`dayMenuItemsVisible`) still shows a divider only between two non-empty groups

**Given** the code base
**Then** the `make-flexible` route, the repository function and its error type, the `dayScheduleTransaction` branch, the `madeFlexible` receipt kind and its schema, the request schema, the client handler and the `trips.dayView.makeFlexible*` keys in `en.ts` and `de.ts` are deleted, with their tests
**And** a search for `makeFlexible`, `make-flexible` and `madeFlexible` in `src` and `test` finds nothing
**And** `POST /api/trips/{id}/day-plan-items/make-flexible` answers 404

**Given** `tripImportSchemas.ts`
**Then** the minimum duration of 1 stays, so exports made before or after the migration still import; its comment no longer names the removed feature as the reason

**Given** everything else Story 13.3 built
**Then** *Nach oben / Nach unten*, *Einfügen nach*, cross-day moves and their undo behave exactly as before, and their tests pass unchanged

**Given** the gates
**Then** `npm test`, `npm run typecheck`, `npm run lint` (no new errors), `npm run build` and `i18nDictionaries.test.ts` pass

**Out of scope:** anything else in the day menu; FR42/FR43/FR46 behaviour.
```

### 4.6 `epics.md`: new Story 9.3 (after Story 9.2)

```
### Story 9.3: The Day in My Inbox

As a traveller who will be without signal tomorrow,
I want to send a day's plan and its tickets to my own email address from the day view,
So that both are on my phone in my mail app, offline.

**FRs covered:** FR51

**Depends on:** Story 8.8 (SMTP transport), Story 9.2 (document packet), Story 8.10 committed first (same menu, separate diffs). **Origin:** Tommy with John (PM), 2026-10-21. See `sprint-change-proposal-2026-10-21-day-email.md`.

**Context:** `sendEmail` sends plain text through Strato in production and fills an in-memory outbox elsewhere. The packet route builds the day's packet in timeline order. The print sheet already turns plan content into plain text. This story reuses all three. The nightly automatic mail stays parked; this is the manual first step.

**Acceptance Criteria:**

**Given** the day view's ⋯ menu, for owner, contributor and viewer **[default: everyone with read access, like the packet]**
**Then** it offers *Per E-Mail senden* / *Send by email* beside print and the packet download

**Given** I choose it
**When** the request runs
**Then** the entry shows a pending state and cannot be triggered twice
**And** the mail goes to **my account's email address only**, taken from the session. The request carries no recipient, and one in the body is ignored
**And** the route guards with `requireSession`, `hasTripReadAccess` (others get 404) and the CSRF check the other mutating trip routes use

**Given** the mail
**Then** subject, body and every label are in my **currently selected UI language** (the language cookie, `getRequestLanguage`), with every string in `en.ts` and `de.ts`
**And** it has an HTML part and a plain-text alternative carrying the same content
**And** it contains the trip name, the day's date (formatted as in the day view), the previous night's stay, the activities in timeline order with times, durations, places and travel legs between them, the day's stay, and plan text converted with `parsePlanText`
**And** it contains a link to the day, built from `APP_BASE_URL` (`/trips/{id}/days/{dayId}`)
**And** it contains no images, no remote resources, no scripts and no external CSS. Styling is inline and simple enough that the mail reads well on a phone at 390px
**And** all user text (titles, places, notes, file names) is HTML-escaped. No stored HTML reaches the mail

**Given** the day has documents and the finished mail including the packet is **at most 20 MB** **[default: cap on the whole encoded mail, i.e. a packet of about 14 MB]**
**Then** the packet PDF is attached, built by the same code as the packet download (same order, same label pages, same failure pages for bad files)

**Given** the mail with the packet would exceed 20 MB, or the packet cannot be built at all (more documents than the packet's limits allow)
**Then** the mail is still sent without the attachment and says in a sentence of its own that the documents were too large for email and can be downloaded on the day page via the link
**And** the app shows a message saying the same

**Given** the day has no documents
**Then** the mail is sent without an attachment and says that the day has no documents **[default]**; the app shows no extra message

**Given** the send succeeds
**Then** the app confirms it, naming the address it went to

**Given** SMTP fails or times out (8.8's 15 s timeouts)
**Then** the app shows that the mail could not be sent and nothing else changes. The send is **awaited**, unlike the reset mail, so the result is honest
**And** the log follows 8.8's rules: error code and message, never the body, the attachment or the address

**Given** `sendEmail`
**Then** it accepts optional `html` and `attachments` (filename, content type, bytes) and passes them to `nodemailer` in production and into the outbox elsewhere
**And** the password-reset mail is unchanged: plain text only

**Given** the test suite
**Then** route tests cover 401, non-member 404, viewer allowed, recipient from the session even when the body names another, language from the cookie (one German case), attachment present, attachment dropped over the cap, no-documents day, SMTP failure, and HTML escaping of a hostile title
**And** they run against the outbox, with no network

**Given** the production server
**When** the story is deployed (Tommy, manual)
**Then** a real day with documents sent from `https://plan.dreyer-travels.de` arrives in Tommy's inbox at GMX, the HTML reads correctly on his phone, the packet opens offline, and the link opens the day after signing in
**And** an oversized day produces the mail without the attachment and the in-app message

**Out of scope:** the nightly automatic mail; sending to other members or arbitrary addresses; a separate day-plan PDF; a ZIP of original files; images in the mail; changing the password-reset mail.
```

### 4.7 Architecture (`architecture.md`, *API & Communication Patterns*)

Append:
```
- **Outbound email (added 2026-10-21).** `src/lib/notifications/email.ts` is the only mail sender: SMTP via `nodemailer` in production (Story 8.8), in-memory outbox elsewhere. Messages are plain text, optionally with an `html` alternative and `attachments`. The recipient of user-triggered mail is always the session's own address (Story 9.3). The reset route does not await the send (no timing signal); the day-email route awaits it so the UI can report the result.
```

### 4.8 `sprint-status.yaml`

Under `epic-8`, after `8-9-…: done`:
```
  8-10-alle-flexibel-machen-goes-away: backlog
```
Under `epic-9`, after `9-2-…: done`:
```
  9-3-the-day-in-my-inbox: backlog
```

---

## 5. Implementation Handoff

**Scope:** Minor. Direct implementation by the Developer agent.

| Step | Who | What |
|---|---|---|
| 1 | John (PM) | Apply edits 4.1–4.8 after approval. |
| 2 | Bob / `bmad-create-story` | Create story files 8-10, then 9-3. |
| 3 | Amelia / `bmad-dev-story` | Implement 8.10, review, commit; then 9.3. |
| 4 | Tommy | Deploy and do 9.3's real send to GMX on the phone. |

**Success criteria:** the day menu no longer offers *Alle flexibel machen* and nothing in the code refers to it; a day sent by email arrives in the signed-in user's inbox in the UI language, reads well on the phone, carries the packet when it fits under 20 MB, and always links to the day.
