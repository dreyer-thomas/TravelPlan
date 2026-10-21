---
authored_against: 9dfbc0e
baseline_commit: 9dfbc0e
---

# Story 8.8: Password-Reset Emails That Arrive

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who forgot their password,
I want the reset email to actually reach my inbox,
so that I can get back into my account without asking the operator.

**FRs covered:** FR29. Story 1.5 marked it done, but in production the mail was never sent.
**Origin:** Tommy with John (PM), 2026-10-21. The verified Strato facts are in [sprint-change-proposal-2026-10-21.md](../planning-artifacts/sprint-change-proposal-2026-10-21.md) §1.

## Acceptance Criteria

1. **SMTP in production.** **Given** `NODE_ENV=production` and the SMTP settings present, **when** `sendEmail` is called, **then** the message is sent through SMTP with `nodemailer`, using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Port 465 uses implicit TLS; any other port requires STARTTLS. Certificate verification stays on. **And** the From header is `MAIL_FROM` (e.g. `TravelPlan <system@plan.dreyer-travels.de>`).
2. **Outbox outside production.** **Given** `NODE_ENV` is not `production` (dev, test, CI), **when** `sendEmail` is called, **then** it behaves exactly as today: the message goes into the in-memory outbox and no network connection is made, even if SMTP variables are set.
3. **Fail-fast at startup.** **Given** `NODE_ENV=production` and any of the five SMTP variables missing or empty, **when** the server starts, **then** it refuses to start, with an error that names the missing variable(s) but never their values. This is the same pattern as the production fail-fast for `MEDIA_STORAGE_ROOT`. Mail must never again be swallowed silently.
4. **No account enumeration, no secrets in logs, no hang.** **Given** an SMTP failure (connection, authentication or rejection), **when** a reset is requested for an existing account, **then** the response is still the same `{ success: true }` as for an unknown address. **And** the failure is logged with the SMTP error code and message, never with the password, the reset token, the reset URL or the message body. **And** a stuck SMTP server cannot hang the request: connection and send each time out after at most 15 s.
5. **The mail itself.** **Given** the reset email, **then** it is plain text, contains the reset link built from `APP_BASE_URL`, and goes to exactly the requested address. **And** its subject and body are in the account's `preferredLanguage` (`de` or `en`), with both texts in `en.ts` and `de.ts`. The language of the page the request came from does not matter.
6. **Tests.** **Given** the test suite, **then** tests cover the production path with a stubbed transport (no real network): the config fail-fast, the From header, the error path logging without secrets, and the reset route still answering success when the transport throws. **And** a test asserts that the non-production path never creates a transport.
7. **Docs.** **Given** the deployment docs, **then** `docs/deployment-configuration.md` and `docs/deployment-guide.md` list the five variables and the Strato values. They say which mailbox the login belongs to and that the password is the **mailbox** password set under "Postfach bearbeiten" (not the Strato customer login). They describe the DMARC/DKIM dependency.
8. **Production acceptance (Tommy, manual).** **Given** the production server, **when** the story is deployed, **then** a TCP connection from the server to `smtp.strato.de:465` succeeds first (`timeout 5 bash -c "</dev/tcp/smtp.strato.de/465"`; the host has no `nc`). If it fails, try port 587 with STARTTLS before changing anything else. **And** a real password reset requested on `https://plan.dreyer-travels.de` for Tommy's own account arrives in the inbox, its link points at `https://plan.dreyer-travels.de/auth/reset-password?token=…`, and setting a new password through it works. **And** the journal shows no error for that request.

**Out of scope:** the nightly day-plan email (parked 2026-10-21; it will build on this transport). HTML email. The SPF record (`v=spf1 include:_spf.strato.com -all`, a DNS step for Tommy).

## Tasks / Subtasks

- [x] **Task 1: Add the dependency** (AC: 1)
  - [x] `npm install nodemailer` in `travelplan/` (current 10.x, caret range like the other deps). **Do not add `@types/nodemailer`**: nodemailer 10 ships its own `.d.ts` (`"types": "./dist/cjs/nodemailer.d.ts"`), and `@types/nodemailer@8` describes the v8 API. The change proposal named `@types`; that was written before checking.
  - [x] Run `npm run audit:check` and `npm audit signatures` and confirm both are clean. nodemailer 10.1.x publishes SLSA provenance. Record the exact installed version in the Completion Notes.
- [x] **Task 2: SMTP config module** (AC: 1, 3)
  - [x] New `src/lib/notifications/smtpConfig.ts`. It has one predicate `usesSmtp()` = `process.env.NODE_ENV === "production"`, which both `sendEmail` and the boot check use (see *Dev Notes → One predicate*). It also has `readSmtpConfig()`, which returns `{ host, port, secure, user, pass, from }` or throws an `Error` that names the missing/empty (trimmed) variables in a fixed order and never prints a value.
  - [x] `SMTP_PORT` must parse as an integer from 1 to 65535. Otherwise throw, naming `SMTP_PORT` but not its value. Set `secure = port === 465`.
  - [x] `assertSmtpConfigured()` for boot: return early on `NEXT_PHASE === "phase-production-build"` (as `mediaRootBoot.ts` does), return when `!usesSmtp()`, otherwise call `readSmtpConfig()`.
  - [x] Unit tests (`test/smtpConfig.test.ts`): each variable missing, each one whitespace-only, several missing at once (all of them named), a bad port, the message never contains a value (set `SMTP_PASS` to a sentinel and assert the message does not contain it), the build phase is skipped, non-production is skipped.
- [x] **Task 3: Wire the boot check** (AC: 3)
  - [x] In `src/instrumentation.ts`, inside the existing `NEXT_RUNTIME === "nodejs"` branch, dynamically import `@/lib/notifications/smtpConfig` and call `assertSmtpConfigured()` after the media-root check. Keep both guards. Rewrite the docblock's "The only thing here is the media-root check" and "must not become where unrelated startup work accumulates" so they name the second check and explain why it qualifies: a missing setting is knowable at startup, and losing it silently is exactly what this story fixes.
  - [x] Test that `register()` throws with `NODE_ENV=production` and the SMTP variables unset (with `MEDIA_STORAGE_ROOT` valid, so the SMTP check is what fires), and does not throw when `NEXT_RUNTIME` is not `nodejs`.
- [x] **Task 4: Rewrite `sendEmail`** (AC: 1, 2, 4)
  - [x] `src/lib/notifications/email.ts`: if `!usesSmtp()`, push to the outbox exactly as today and return. Do not import anything that opens a socket on that path.
  - [x] Otherwise call `readSmtpConfig()` and then `nodemailer.createTransport({ host, port, secure, requireTLS: !secure, auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000 })`. Do not set `tls.rejectUnauthorized`. Then `await transport.sendMail({ from, to, subject, text })`: plain text only, no `html`.
  - [x] `sendEmail` **throws** on failure. Logging and swallowing happen in the caller (Task 5), so a future caller cannot mistake a lost mail for a sent one.
  - [x] Keep `getEmailOutbox` / `clearEmailOutbox` and the `globalThis` outbox untouched. Export the `EmailMessage` type.
  - [x] Tests (`test/email.test.ts`, `vi.mock("nodemailer")`): non-production pushes to the outbox and `createTransport` is **not called**, even with all five SMTP variables set (AC2, AC6). Production calls `createTransport` with `secure: true` for 465 and `secure: false, requireTLS: true` for 587, every timeout ≤ 15 000, and no `rejectUnauthorized: false`. `sendMail` receives `from === MAIL_FROM`, the exact `to`, `text`, and no `html`. Production leaves the outbox empty. A rejecting `sendMail` makes `sendEmail` reject.
- [x] **Task 5: Reset route** (AC: 4, 5)
  - [x] `src/app/api/auth/password-reset/request/route.ts`: select `{ id: true, preferredLanguage: true }`. Build subject and body from `dictionaries[user.preferredLanguage]` with `translate` + `formatMessage` (pattern: `getPacketLabels` in `src/lib/trips/packetPdf.ts`). **Not** `getServerT()`: that reads the `lang` cookie, which AC5 rules out.
  - [x] Wrap **only** the `sendEmail` call in its own `try/catch`. On failure, `console.error("password-reset/request: reset email not sent", { code, responseCode, message })`, taking those three fields off the error defensively (it may not be an `Error`) and never logging the error object itself (see *Traps*). Then fall through to `ok({ success: true })`. DB failures (lookup, token create) still go to the existing outer catch and answer 500, unchanged.
  - [x] Dictionary keys in both `en.ts` and `de.ts`, next to the `auth.forgot.*` block: `auth.resetEmail.subject` and `auth.resetEmail.body`, where the body takes a `{url}` placeholder. Suggested texts are in *Dev Notes → Mail text*. The i18n parity test enforces equal key sets.
  - [x] Extend `test/passwordResetRequestRoute.test.ts` (it runs under `NODE_ENV=test`, so it uses the outbox; call `clearEmailOutbox()` in `beforeEach`):
    - a known `en` user gets exactly one outbox message, to that address, with the English subject, and a body containing `${APP_BASE_URL}/auth/reset-password?token=` followed by 64 hex characters;
    - a `de` user gets the German subject even when the request carries a `lang=en` cookie (AC5);
    - an unknown address leaves the outbox empty;
    - when `sendEmail` throws (`vi.spyOn` on the module or `vi.mock("@/lib/notifications/email")`), the response is 200 `{ success: true }`, `console.error` was called, and nothing it received (stringify all its arguments) contains the raw token, `/auth/reset-password`, the body text or a sentinel `SMTP_PASS`.
- [x] **Task 6: Docs and `.env.example`** (AC: 7)
  - [x] `docs/deployment-configuration.md`: the intro says "eight variables", which becomes thirteen. Add five rows marked **Yes, in production**: the Strato values; `SMTP_USER` = `webmaster@dreyer-travels.de`, the only mailbox in the contract; `SMTP_PASS` = the **mailbox** password from Strato "Postfach bearbeiten", **not** the customer login, and a secret (link the existing "Secrets in the unit" section); `MAIL_FROM` = `"TravelPlan <system@plan.dreyer-travels.de>"`, an alias on that mailbox. Add a short *Password-reset email* subsection covering DMARC `p=reject` with no SPF, so delivery rests on Strato's DKIM; the optional SPF record; port 587 as the fallback; and outbox-only outside production. Add the five `Environment=` lines to the systemd unit block. Update the `APP_BASE_URL` row (line ref `route.ts:53` will move).
  - [x] `docs/deployment-guide.md`: same count fix and five rows in the env table. State that with `NODE_ENV=production` the server refuses to start without them, and that, like `MEDIA_STORAGE_ROOT`, this shows up as **500 on every request with the reason in the journal**, not as a process exit (that is how the instrumentation throw behaves; see the existing `MEDIA_STORAGE_ROOT` row). Add a release note that the variables must be in the unit **before** deploying this build.
  - [x] `travelplan/.env.example`: add an SMTP block, commented out, under a heading saying it is required in production only and ignored in dev, where mail goes to the in-memory outbox.
- [x] **Task 7: Full verification** (AC: 1–7)
  - [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (the build must pass **without** the SMTP vars; this proves the `NEXT_PHASE` guard).
  - [x] Optional local smoke: `NODE_ENV=production` `next start` with SMTP vars unset shows the named-variables error. Do **not** send real mail from a dev machine with the production password.
  - [x] AC8 is Tommy's manual server step. Leave it unchecked in the Completion Notes as "pending Tommy", with the exact commands from AC8.

### Review Findings

Code review 2026-10-21 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). The auditor found no AC violation.

- [x] [Review][Patch] Send the reset mail without awaiting it (Decision resolved 2026-10-21 by Tommy: option c, fire-and-forget) — Known addresses waited for the SMTP round trip (timing enumeration), and the per-phase timeouts let a trickling server hold the request past AC4's 15 s. The route now starts `sendEmail` with `void …catch(log)` and answers at once, so known and unknown addresses answer alike and no SMTP state holds the request. The failure log keeps its shape; the route test awaits the rejection settling before asserting the log. AC4's "cannot hang the request" is now met by construction; the 15 s transport timeouts stay so the background send ends. [travelplan/src/app/api/auth/password-reset/request/route.ts:82-90]
- [x] [Review][Patch] Failure log can carry the recipient address and raw server reply — nodemailer's `message` embeds the server response (e.g. `Can't send mail - all recipients were rejected: 550 5.1.1 <user@…>`), and a non-`Error` throw is logged whole via `String(error)`. Redact address-shaped substrings from `message`, and log only `typeof` for a non-`Error`. [travelplan/src/app/api/auth/password-reset/request/route.ts:25]
- [x] [Review][Patch] "No password in the log" route test is vacuous — `sendEmail` is mocked to reject, so `SMTP_PASS` never enters any code path and the sentinel assertion is always true. Add a route case under `NODE_ENV=production` with `nodemailer` mocked so `sendMail` rejects with an error whose `command`/`response` hold the sentinel password and the recipient, and assert the log contains neither. [travelplan/test/passwordResetRequestRoute.test.ts]
- [x] [Review][Patch] `SMTP_PASS` is trimmed before use — the trim is right for the "missing or empty" test, but a mailbox password with leading/trailing whitespace is silently altered and every send fails `EAUTH`. Detect emptiness on the trimmed value, pass the raw value. [travelplan/src/lib/notifications/smtpConfig.ts:35]
- [x] [Review][Patch] Bad-port test checks only the quoted value — `not.toContain(\`"${port}"\`)` would pass a message that echoed the value unquoted; assert the exact message instead. [travelplan/test/smtpConfig.test.ts]
- [x] [Review][Patch] `MAIL_FROM` table value shows literal quotes — the env table renders `"TravelPlan <system@plan.dreyer-travels.de>"` while the unit line carries no quotes in the value; a copy from the table puts quotes in the From header. Drop them in the table. [docs/deployment-configuration.md:35]
- [x] [Review][Defer] Reset rate limit is keyed on the client-supplied first `X-Forwarded-For` entry [travelplan/src/app/api/auth/password-reset/request/route.ts:29-33] — deferred, pre-existing (DW-403)
- [x] [Review][Defer] Malformed `APP_BASE_URL` answers 500 for known addresses only [travelplan/src/app/api/auth/password-reset/request/route.ts:71-72] — deferred, pre-existing (DW-404)

## Dev Notes

### Current state of the files this story touches

- **`src/lib/notifications/email.ts`** (27 lines): `sendEmail` pushes to a `globalThis` outbox when `NODE_ENV !== "production"` and does **nothing** otherwise. `getEmailOutbox` and `clearEmailOutbox` exist, but no test references them today.
- **`src/app/api/auth/password-reset/request/route.ts`**: order is rate limit (by IP), CSRF, JSON, zod, then `findUnique({ select: { id } })`, `createPasswordResetToken`, `new URL("/auth/reset-password", APP_BASE_URL ?? "http://localhost:3000")` + `searchParams.set("token", raw)`, then `sendEmail` with hard-coded English. **One** `try/catch` wraps the lookup, token and send, and answers `500 server_error`. Today an SMTP throw would therefore turn into a 500 for known addresses only, which would reveal that the account exists. That is why AC4 needs the inner catch.
- **`src/instrumentation.ts`**: `register()` returns unless `NEXT_RUNTIME === "nodejs"`, then dynamically imports `mediaRootBoot`. The docblock explains why both guards matter (the file is still compiled for edge). nodemailer pulls `net`/`tls`, so the same rule applies here: **never import it at the top of a file reachable from instrumentation, and import `smtpConfig` dynamically inside the branch**. `smtpConfig.ts` itself must not import nodemailer. Only `email.ts` does.
- **`src/lib/trips/mediaRootBoot.ts`**: this is the pattern to copy. It skips the `NEXT_PHASE` build phase, throws an `Error` with an actionable message, and points to the docs. Its tests live in `test/uploadPaths.test.ts` (`describe("assertMediaRootConfigured")`) and use a `withEnv` helper. Reuse that approach.
- **`User.preferredLanguage`**: Prisma enum `PreferredLanguage`, values `en`/`de`, `@default(en)`, so it is never null. It maps directly onto `dictionaries` keys.
- **`src/lib/auth/passwordReset.ts`**: token = 32 random bytes as hex (64 characters), valid for 60 minutes. The mail text can say "valid for one hour".

### One predicate, deliberately not the media-root allow-list

`mediaRootBoot` treats anything that is not `development`/`test` as production. Here, AC2 fixes the outbox for "not production", so `sendEmail` routes on `NODE_ENV === "production"`. If the boot check used a different rule (for example the allow-list), a `NODE_ENV=staging` server would pass the boot check and then silently put mail in the outbox. That is the exact bug this story removes. So both use `usesSmtp()`. `next start` always runs with `NODE_ENV=production`, so the server is covered.

### Mail text (suggested; Tommy may reword)

- en subject: `Reset your TravelPlan password`
- en body: `Someone (hopefully you) asked to reset the password for your TravelPlan account.\n\nOpen this link to choose a new password. It is valid for one hour:\n{url}\n\nIf you did not ask for this, ignore this email. Your password stays unchanged.`
- de subject: `TravelPlan: Passwort zurücksetzen`
- de body: `Jemand (hoffentlich du) möchte das Passwort für dein TravelPlan-Konto zurücksetzen.\n\nÖffne diesen Link, um ein neues Passwort zu wählen. Er ist eine Stunde gültig:\n{url}\n\nWenn du das nicht angefordert hast, ignoriere diese E-Mail. Dein Passwort bleibt unverändert.`

Use `du`, matching the existing German UI tone in `de.ts` (check `auth.forgot.*`). Keep `\n` line breaks; nodemailer turns them into CRLF on the wire, which Strato requires.

### Traps

1. **Do not log the nodemailer error object.** Depending on the error, it carries `command` and `response` fields and sometimes the envelope. AUTH errors in particular should never be dumped whole. Log `{ code, responseCode, message }` only. If `message` could contain the URL (it should not, because nodemailer does not echo the body), the test in Task 5 catches it.
2. **Do not put the token, URL or body into the log line** "for debugging". AC4 forbids it, and the reset URL is a login credential for an hour.
3. **Top-level nodemailer import in `instrumentation.ts` or `smtpConfig.ts`** breaks the edge compile of instrumentation (see its docblock). `email.ts` may import it at the top because only route handlers reach `email.ts`.
4. **Build without SMTP vars.** CI runs `next build` with `NODE_ENV=production`. Without the `NEXT_PHASE` guard the build fails.
5. **Tests must not inherit a developer's real `.env` SMTP values.** Explicitly set or delete the five variables per test (`withEnv`), and restore them afterwards.
6. **Do not cache the transport at module scope.** Create it per call; the volume is a handful of mails a year. Caching would freeze the config across `withEnv` tests and hide the "never created" assertion.
7. **`secure` is not `tls`.** `secure: true` = implicit TLS (465). For 587, `secure: false` + `requireTLS: true`, otherwise nodemailer would happily send AUTH in clear text if STARTTLS is not offered.
8. **Response unchanged.** `{ success: true }` for every outcome except validation, CSRF, rate limit and DB failure. The UI (Story 7.6) shows `auth.forgot.success` and needs no change.

### What must not regress

- All three existing cases in `test/passwordResetRequestRoute.test.ts`, `test/passwordResetConfirmRoute.test.ts`, the `assertMediaRootConfigured` tests in `test/uploadPaths.test.ts`, and the i18n parity test (`test/i18nDictionaries.test.ts`).
- `next build` with no SMTP variables.
- Dev workflow: `npm run dev` without SMTP vars boots and the reset still "works" through the outbox.

### Known, not in scope (note it, don't fix it)

Timing: a known address now waits for an SMTP round trip (about 1–2 s, up to the timeouts) and an unknown one returns at once. That is a timing-based enumeration signal. AC4 asks only for the same *response*. Sending fire-and-forget would close the gap but conflicts with "a stuck SMTP server cannot hang the request" being testable, and moves failure logging off the request. Raise it under *Questions* in the Completion Notes rather than deciding it here.

### Project Structure Notes

- New: `src/lib/notifications/smtpConfig.ts`, `test/smtpConfig.test.ts`, `test/email.test.ts` (plus an instrumentation test, either in `test/smtpConfig.test.ts` or a new `test/instrumentation.test.ts`).
- Changed: `src/lib/notifications/email.ts`, `src/app/api/auth/password-reset/request/route.ts`, `src/instrumentation.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `test/passwordResetRequestRoute.test.ts`, `package.json`, `package-lock.json`, `.env.example`, `docs/deployment-configuration.md`, `docs/deployment-guide.md`.
- No schema change, no migration, no UI change.
- Logging prefix convention: `"<route>: <what failed>"` (see `register/route.ts:111`, `admin/users/route.ts`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.8]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-21.md §1 (verified Strato facts), §5 (handoff)]
- [Source: travelplan/src/lib/trips/mediaRootBoot.ts, travelplan/src/instrumentation.ts (boot fail-fast pattern and edge guards)]
- [Source: docs/deployment-configuration.md#Environment variables, #The systemd unit, #Secrets in the unit are readable by every local user (DW-331)]
- [Source: .github/workflows/security-audit.yml (`npm audit signatures`, `audit:check`)]
- nodemailer 10.1.7 (npm, 2026-10-18): ships its own types, `engines.node >=20`, SLSA provenance attested. SMTP options: `secure`, `requireTLS`, `connectionTimeout`, `greetingTimeout`, `socketTimeout`; errors carry `code` (`EAUTH`, `ECONNECTION`, `ETIMEDOUT`, `EENVELOPE`, `EMESSAGE`…) and `responseCode`.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story.

### Debug Log References

- `npm test`: 223 files / 3578 tests passed. `npm run typecheck` clean. `npm run lint` 0 errors / 80 warnings, the same as before; the touched and new files lint clean.
- `npm run build` passed with no SMTP variable set anywhere (the `NEXT_PHASE` guard).
- Local smoke: `NODE_ENV=production next start` with `MEDIA_STORAGE_ROOT` set and no SMTP variables. Every request answered `500`, and the log read `An error occurred while loading instrumentation hook: SMTP is not configured, missing or empty: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.` No value appeared. No real mail was sent from the dev machine.
- `npm audit signatures`: 775 registry signatures and 207 attestations verified, nodemailer included.
- `npm run audit:check` is **red, but not because of this story**. It reports 23 production findings in `next` (8, three of them critical, fixed in 16.3.3–16.3.8), `fast-uri` (6), `@tiptap/core` (2), `sharp` (2), `mysql2` (2), `deepmerge-ts`, `prosemirror-view` and `source-map-js`. None is in nodemailer, which has no dependencies. The lockfile diff is nodemailer's single entry (+10 lines).

### Completion Notes List

- **Dependency:** `nodemailer@^10.1.7` (installed 10.1.7). No `@types/nodemailer`, because v10 ships its own types.
- **`smtpConfig.ts`** (new, no nodemailer import, so it is safe to reach from `instrumentation.ts`): `usesSmtp()` (`NODE_ENV === "production"`) is the one predicate shared by `sendEmail` and the boot check. `readSmtpConfig()` trims values, names every missing variable in a fixed order in the message `SMTP is not configured, missing or empty: ….`, validates `SMTP_PORT` as an integer from 1 to 65535 without echoing the value, and sets `secure = port === 465`. `assertSmtpConfigured()` skips the build phase and non-production.
- **`instrumentation.ts`**: imports the second check dynamically inside the existing `NEXT_RUNTIME` branch, after the media-root check. The docblock is rewritten to name both checks and to say what qualifies for this file.
- **`email.ts`**: outside production, behaviour is unchanged (outbox, no transport). In production it creates a transport per call with `secure`, `requireTLS: !secure`, verification left on, and connection, greeting and socket timeouts of 15 s each, then sends a plain-text `sendMail({ from: MAIL_FROM, to, subject, text })`. It **throws** on failure. `EmailMessage` is now exported.
- **Reset route**: selects `preferredLanguage`. Subject and body come from `dictionaries[preferredLanguage]` (`auth.resetEmail.subject` / `.body`, `{url}` placeholder), not from the cookie. Only `sendEmail` has its own `try/catch`; on failure it logs `password-reset/request: reset email not sent` with `{ code, responseCode, message }` only, then answers `{ success: true }`. DB failures still answer 500, as before.
- **Tests** (+44): `smtpConfig.test.ts` (25), `email.test.ts` (8; nodemailer mocked, including "no transport outside production even with SMTP vars set"), `instrumentation.test.ts` (3), `passwordResetRequestRoute.test.ts` (+5: English mail and link shape, German account with a `lang=en` cookie, unknown address sends nothing, a send failure answers 200 and the log contains no token, link path, body, password or `AUTH PLAIN`, and a failed send answers the same as an unknown address).
- **Docs**: `deployment-configuration.md` (count 8→13, five rows, new *Password-reset email* section, unit block, secrets section names `SMTP_PASS`, dropped the stale `route.ts:53` line number), `deployment-guide.md` (count, five rows, short note, new *Upgrading past Story 8.8* section with the AC8 steps), `.env.example` (commented SMTP block).
- **AC8 is pending Tommy (manual, on the server)**: put the five variables in `TravelPlan.service` + `systemctl daemon-reload` **before** starting this build; run `timeout 5 bash -c "</dev/tcp/smtp.strato.de/465" && echo open` (fallback 587); then do a real reset on `https://plan.dreyer-travels.de` for your own account: the mail arrives, the link is `https://plan.dreyer-travels.de/auth/reset-password?token=…`, the new password works, and the journal has no `reset email not sent` line.
  - 2026-10-21: TCP from the production server to `smtp.strato.de:465` checked by Tommy: open, so 465 with implicit TLS stays (no 587 fallback). The five variables are in the unit (Tommy, 2026-10-21). Still pending: deploy, and the real reset on `https://plan.dreyer-travels.de`.
- **Questions for Tommy:** (1) Timing: a known address now waits for the SMTP round trip and an unknown one does not, which is a timing-based enumeration signal (see Dev Notes). Accept it or send fire-and-forget? (2) Mail wording: the suggested texts were used as written. (3) `audit:check` is red from the findings above, Next.js critical ones included. This is separate from this story but worth a dependency-bump story soon.

### File List

- `travelplan/package.json` (modified)
- `travelplan/package-lock.json` (modified)
- `travelplan/.env.example` (modified)
- `travelplan/src/lib/notifications/smtpConfig.ts` (new)
- `travelplan/src/lib/notifications/email.ts` (modified)
- `travelplan/src/instrumentation.ts` (modified)
- `travelplan/src/app/api/auth/password-reset/request/route.ts` (modified)
- `travelplan/src/i18n/en.ts` (modified)
- `travelplan/src/i18n/de.ts` (modified)
- `travelplan/test/smtpConfig.test.ts` (new)
- `travelplan/test/email.test.ts` (new)
- `travelplan/test/instrumentation.test.ts` (new)
- `travelplan/test/passwordResetRequestRoute.test.ts` (modified)
- `docs/deployment-configuration.md` (modified)
- `docs/deployment-guide.md` (modified)
- `_bmad-output/implementation-artifacts/8-8-password-reset-emails-that-arrive.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log

- 2026-10-21: Story created (bmad-create-story).
- 2026-10-21: Implemented (bmad-dev-story). SMTP via nodemailer in production with a startup fail-fast; the reset mail is in the account's language; a send failure is logged without secrets and still answers success; 44 new tests; deployment docs. Status → review. AC8 (server acceptance) pending Tommy.
- 2026-10-21: Code review (bmad-code-review): 1 decision (fire-and-forget send, Tommy), 6 patches applied — send not awaited, failure log blanks addresses and logs only the kind of a non-Error, real-production-path log test with mocked nodemailer (mutation-checked), raw SMTP_PASS, exact bad-port message, MAIL_FROM docs quotes; DW-403/DW-404 deferred. 223 files / 3582 tests, typecheck clean, touched files lint clean.
