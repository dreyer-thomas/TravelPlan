# Sprint Change Proposal — 2026-10-21

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-21, with one change: the reset email follows the account's selected language. Edits 4.1 and 4.2 applied.
**Scope classification:** Minor. One new story in Epic 8 (8.8). No FR added, no PRD or UX change, no schema migration. One new runtime dependency (`nodemailer`) and five new environment variables.

---

## 1. Issue Summary

**Password-reset emails have never been sent in production. The app says they were.**

`src/lib/notifications/email.ts` is a stub. `sendEmail` pushes the message into an in-memory outbox when `NODE_ENV !== "production"` and does **nothing at all** in production. `POST /api/auth/password-reset/request` calls it, then answers `{ success: true }`. Nothing is logged. A user who forgets their password today has no way back in except the operator.

FR29 ("Users can reset their password via email") and Story 1.5 ("I receive a reset link or code") are therefore marked done but have never worked for a real user. The same pattern hit `APP_BASE_URL`, which was unset in production until 2026-08-12 (see `docs/deployment-configuration.md`) and also failed silently. Fixing that variable fixed the link; there was still no mail to carry it.

**Trigger:** Found on 2026-10-21 while Tommy and John discussed a nightly day-plan mail for offline use during a trip. Reading the email code to judge that idea showed there is no mail delivery at all. Tommy decided to fix password reset first and park the nightly mail (see *Out of scope*). Category: *defect in shipped work*.

**Evidence:**

- `travelplan/src/lib/notifications/email.ts:17-21`: the only body of `sendEmail` is the non-production `outbox.push`.
- `travelplan/src/app/api/auth/password-reset/request/route.ts:57-61`: the only caller; the route returns success whether or not anything was sent.
- `getEmailOutbox` is not referenced by any test, so no test would notice whether mail goes anywhere.

### Facts verified on 2026-10-21 (Tommy, from his Mac)

| Fact | Result |
|---|---|
| SMTP host / port | `smtp.strato.de`, **465 implicit TLS** (587 STARTTLS also offered) |
| Login | `webmaster@dreyer-travels.de`, the only mailbox in the Strato contract, with its **mailbox** password (not the Strato customer login) |
| Sender | Alias `system@plan.dreyer-travels.de` on that mailbox. Strato accepted it as `MAIL FROM` (`250 2.1.0 Sender ok`) |
| Delivery | Test mail arrived in the **inbox** at GMX |
| DNS | `dreyer-travels.de` has DMARC `p=reject` (also governs subdomains), **no SPF record** on any of the domains, Strato DKIM keys `strato-dkim-0002` / `-0003` published. Delivery therefore depends on Strato's DKIM signature, which the GMX test shows is working |
| Protocol | Strato rejects bare-LF headers (`554 5.6.0 … must be terminated by CRLF`). `nodemailer` emits CRLF. Max message size 100 MB (`SIZE 104857600`) |
| Production server | **Not yet verified:** whether `4.185.71.23` can reach `smtp.strato.de:465` outbound |

The mailbox password was rotated after one was exposed in a debug log during testing. The current one has never been in any log or in this repository.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 8: Maintenance & Infrastructure | Receives Story 8.8. Epic stays `in-progress`. |
| Epic 1 (Story 1.5) | Not reopened. Its ACs are correct; the implementation stopped at a stub. 8.8 makes them true in production. |
| All others | None. |

### Artifact impact

| Artifact | Change |
|---|---|
| `epics.md` | Add Story 8.8 under Epic 8 (Section 4.1). |
| `sprint-status.yaml` | Add `8-8-password-reset-emails-that-arrive: backlog`. |
| PRD | None. FR29 already requires this. The line "Calendar/email integrations are explicitly not required" refers to integrations with the user's own mail or calendar, not to transactional mail, and stays. |
| Architecture | None in `architecture.md`. The deployment docs gain the SMTP variables (part of the story). |
| UX | None. The reset screens (Story 7.6) are unchanged. |

### Technical impact

- New dependency `nodemailer` (plus `@types/nodemailer` as a dev dependency). It goes through the existing `audit:check` and provenance gates.
- Five environment variables in the systemd unit, inline like `JWT_SECRET` and `ANTHROPIC_API_KEY` (DW-331's ruling stands).
- One manual server step: add the variables, then a real reset as acceptance.

---

## 3. Recommended Approach

**Direct adjustment:** one Epic 8 story. No rollback, no MVP change.

- **Effort:** small. One module rewritten, one route touched, tests, two docs.
- **Risk:** low in code. The real risks are operational, and the story covers each one: the server's outbound port, DKIM under `p=reject`, and a misconfigured production silently swallowing mail again. Each has an acceptance criterion.
- **Timeline:** fits ahead of any feature work. It fixes a broken FR.

---

## 4. Detailed Change Proposals

### 4.1 `epics.md`: new Story 8.8 (after Story 8.7)

```markdown
### Story 8.8: Password-Reset Emails That Arrive

As someone who forgot their password,
I want the reset email to actually reach my inbox,
So that I can get back into my account without asking the operator.

**FRs covered:** FR29 (already marked done by Story 1.5, never delivered in production)

**Depends on:** nothing. **Origin:** Tommy with John (PM), 2026-10-21. See `sprint-change-proposal-2026-10-21.md` for the verified Strato facts.

**Context:** `sendEmail` in `src/lib/notifications/email.ts` is a stub: outside production it pushes into an in-memory outbox, in production it does nothing. The reset route then answers success. No password-reset email has ever been sent. Strato SMTP was verified by hand on 2026-10-21: `smtp.strato.de:465`, login `webmaster@dreyer-travels.de` (mailbox password), sender alias `system@plan.dreyer-travels.de` accepted, delivered to the inbox at GMX. `dreyer-travels.de` publishes DMARC `p=reject` and no SPF, so delivery rests on Strato's DKIM signature.

**Acceptance Criteria:**

**Given** `NODE_ENV=production` and the SMTP settings present
**When** `sendEmail` is called
**Then** the message is sent through SMTP with `nodemailer` using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`, with implicit TLS on port 465 and STARTTLS required on any other port. Certificate verification stays on
**And** the From header is `MAIL_FROM` (e.g. `TravelPlan <system@plan.dreyer-travels.de>`)

**Given** `NODE_ENV` is not `production` (dev, test, CI)
**When** `sendEmail` is called
**Then** it behaves exactly as today: the message goes into the in-memory outbox and no network connection is made, even if SMTP variables are set

**Given** `NODE_ENV=production` and any of the five SMTP variables missing or empty
**When** the server starts
**Then** it refuses to start with an error naming the missing variable(s), not their values. The same pattern as `MEDIA_STORAGE_ROOT`'s production fail-fast. Mail must never again be swallowed silently

**Given** an SMTP failure (connection, authentication, rejection)
**When** a reset is requested for an existing account
**Then** the response is still the same `{ success: true }` as for an unknown address, so the endpoint does not reveal which addresses have accounts
**And** the failure is logged with the SMTP error code and message, but never the password, the reset token, the reset URL or the message body
**And** a stuck SMTP server cannot hang the request: connection and send have a timeout of at most 15 s

**Given** the reset email
**Then** it is plain text, contains the reset link built from `APP_BASE_URL`, and is sent to exactly the requested address
**And** its subject and body are in the account's `preferredLanguage` (`de` or `en`, the language the user picked in the app), with both texts in `en.ts` and `de.ts`. The language of the page the request came from does not matter: the address is all the request carries, and the account is what the mail is about

**Given** the test suite
**Then** the production path is covered by tests that stub the transport (no real network): the config fail-fast, the From header, the error path logging without secrets, and the reset route still answering success when the transport throws
**And** a test asserts that the non-production path never creates a transport

**Given** the deployment docs
**Then** `docs/deployment-configuration.md` and `docs/deployment-guide.md` list the five variables, the Strato values, which mailbox the login belongs to, that the password is the **mailbox** password set under "Postfach bearbeiten" (not the Strato customer login), and the DMARC/DKIM dependency

**Given** the production server
**When** the story is deployed (Tommy, manual)
**Then** first a TCP connection from the server to `smtp.strato.de:465` succeeds (the host has no `nc`; `timeout 5 bash -c "</dev/tcp/smtp.strato.de/465"` works). If it does not, port 587 with STARTTLS is tried before anything else changes
**And** a real password reset requested on `https://plan.dreyer-travels.de` for Tommy's own account arrives in the inbox, its link points at `https://plan.dreyer-travels.de/auth/reset-password?token=…`, and setting a new password through it works
**And** the journal for that request shows no error

**Out of scope:** the nightly day-plan email for offline use (parked, Tommy 2026-10-21; it will build on this transport); HTML email; an SPF record (recommended `v=spf1 include:_spf.strato.com -all` for `dreyer-travels.de` and `plan.dreyer-travels.de`, a DNS step for Tommy, not code).
```

### 4.2 `sprint-status.yaml`

```yaml
  8-7-what-the-ai-searches-cost: done
  8-8-password-reset-emails-that-arrive: backlog
  epic-8-retrospective: optional
```

---

## 5. Implementation Handoff

- **Scope:** Minor. Direct implementation by the Developer agent.
- **Next:** `bmad-create-story 8-8`, then `bmad-dev-story`.
- **Tommy (manual):** put `SMTP_HOST=smtp.strato.de`, `SMTP_PORT=465`, `SMTP_USER=webmaster@dreyer-travels.de`, `SMTP_PASS=…`, `MAIL_FROM="TravelPlan <system@plan.dreyer-travels.de>"` into the unit **before** deploying the build, because the fail-fast will refuse to start without them. Then run the server-side acceptance steps. Optionally add the SPF record.
- **Success criteria:** a real reset email reaches Tommy's inbox from production, and a missing SMTP setting stops the service at startup instead of losing mail.
