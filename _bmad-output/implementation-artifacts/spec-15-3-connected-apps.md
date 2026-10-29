---
title: 'Story 15.3: Connected Apps'
type: 'feature'
created: '2026-10-29'
status: 'done'
final_revision: 'feba565'
baseline_revision: '0bb43a2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** A user can connect Claude to TravelPlan (15.1) but cannot see which assistants hold tokens on their account or cut one off, and a password change or reset leaves connector tokens alive. Writes (15.4+) must not ship before the user has that control.

**Approach:** Add an account page (`/account`, header menu *Konto* / *Account*; none exists today) whose *Verbundene Apps* / *Connected apps* section lists each active connection (token family) with client name, redirect host, connected since, last used and a confirmed *Trennen* / *Disconnect*. Revoke every connector token of the user inside the two existing password-write transactions. Keep the existing RFC 7009 endpoint and the FK cascade on account deletion, and pin both with tests.

## Boundaries & Constraints

**Always:**
- A connection is one token family (`familyId`). It is active when it has a row with `revokedAt = null` and `familyExpiresAt > now`. Revoked, reuse-revoked and expired families are not listed.
- *Connected since* = `familyExpiresAt − REFRESH_TOKEN_TTL_MS` (the family lives exactly 30 days from consent, and rotation never extends it). *Last used* = the newest `lastUsedAt` over the family's rows. When it is null, show *Noch nie* / *Never*.
- Redirect host comes from a new nullable `redirectUri` column on `OAuthToken`. `exchangeAuthorizationCode` copies it from the code, and rotation carries it along with the other family fields. Families issued before the migration show the host as `—`.
- Disconnect revokes every unrevoked row of that family **owned by the session user** in one `prisma.$transaction` callback, matching `revokeFamilyByToken`. A family id that is unknown, already revoked, or belongs to another user answers 404 `not_found`. The bearer's next `/api/mcp` call answers 401.
- Revoke all of a user's unrevoked tokens (`updateMany {userId, revokedAt:null}`) in the **same** transaction as the password write, in both `password-reset/confirm` and `first-login-password`.
- Session routes use `requireSession` and `ok`/`fail`. The DELETE is CSRF-checked like the other session mutations. While `isMcpEnabled()` is false, both connection routes answer 404 and the page omits the section.
- Every new string exists in `en.ts` and `de.ts`. Dates and times are formatted with `Intl.DateTimeFormat` in the UI language.

**Block If:** none. The design question this story raised (there is no account page) is resolved by the Approach.

**Never:** an admin view of other users' connections; a self-service password change or account deletion (not in this story); touching `sprint-status.yaml`; Prisma calls in routes (go through `oauthRepo`); deleting token rows on disconnect (mark `revokedAt`, so reuse stays recognisable); listing a family twice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | 2 active families (one rotated twice), 1 revoked, 1 expired | `GET /api/users/me/connections` → 2 items `{id: familyId, clientName, redirectHost, connectedAt, lastUsedAt}`, newest connection first | — |
| Foreign | Another user's family | not listed. DELETE on its id → 404, and its rows stay unrevoked | 404 `not_found` |
| Disconnect | DELETE own active family with CSRF | 200. All rows revoked. The access token then gets 401 on `/api/mcp`, and the refresh token gets `invalid_grant` | missing CSRF → 403 `csrf_invalid`, no session → 401 |
| Legacy row | `redirectUri` null | `redirectHost: null`, UI shows `—` | — |
| Password reset / first-login change | User has 2 active families | Both revoked in the password transaction. Another user's tokens are untouched | Transaction failure → existing 500, nothing revoked |
| Connector off | `MCP_ENABLED` unset | both routes 404, no section rendered | — |
| Empty | No active family | One line saying there are no connections, how-to text, the `getMcpResourceUrl()` URL and a copy button (copied feedback; clipboard failure leaves the URL selectable) | — |

</intent-contract>

## Code Map

- `travelplan/prisma/schema.prisma` + new `prisma/migrations/<ts>_add_oauth_token_redirect_uri/` -- the `OAuthToken` model, where the nullable `redirectUri` column goes
- `travelplan/src/lib/repositories/oauthRepo.ts` -- `FamilyFields`, `issueTokenPair`, `revokeFamily`, `exchangeAuthorizationCode`, `rotateRefreshToken`
- `travelplan/src/lib/oauth/config.ts` -- `isMcpEnabled`, `getMcpResourceUrl`, `REFRESH_TOKEN_TTL_MS`
- `travelplan/src/app/api/oauth/revoke/route.ts` -- the existing RFC 7009 endpoint (unchanged)
- `travelplan/src/app/api/auth/password-reset/confirm/route.ts`, `.../first-login-password/route.ts` -- the two password writes
- `travelplan/src/app/api/users/me/language/route.ts` -- the `/api/users/me/*` route template
- `travelplan/src/app/(routes)/admin/users/page.tsx` -- the server page pattern (`resolveSignedInUserId`)
- `travelplan/src/components/features/admin/AdminUsersList.tsx` -- the confirm-dialog and CSRF-retry pattern (~:217-319, :1333-1360)
- `travelplan/src/proxy.ts`, `src/lib/navigation/authMenu.ts`, `src/components/HeaderMenu.tsx` -- the page gate and the menu
- `travelplan/test/helpers/oauthFixtures.ts`, `test/oauthRoutes.test.ts`, `test/mcpRoute.test.ts`, `test/i18nDictionaries.test.ts` -- the fixtures and the existing coverage

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + migration -- add `redirectUri String? @map("redirect_uri")` to `OAuthToken` -- needed for the redirect host. Run `npm run check:migrations`.
- [x] `src/lib/repositories/oauthRepo.ts` -- add `redirectUri` to `FamilyFields`, set it from the code row and carry it through rotation. Add `listConnectionsForUser(userId, now)`, `revokeConnectionForUser(userId, familyId, now) → boolean` and `revokeAllTokensForUser(tx|client, userId, now)` -- the repository owns all OAuth DB access
- [x] `src/app/api/users/me/connections/route.ts` (GET) and `.../connections/[familyId]/route.ts` (DELETE) -- session plus CSRF on DELETE, MCP gate, `{data,error}` shape -- the list and disconnect API
- [x] `src/app/api/auth/password-reset/confirm/route.ts`, `src/app/api/auth/first-login-password/route.ts` -- revoke all tokens in the password transaction (first-login moves into a `$transaction`) -- NFR14
- [x] `src/app/(routes)/account/page.tsx` + `src/components/features/account/ConnectedApps.tsx` -- server page showing the signed-in email, plus the section when the connector is on. The client component fetches the list and renders rows, the confirm dialog (safe *Abbrechen* / *Cancel* + `color="error"` *Trennen*, spinner, error `Alert`) and the empty state with a copy button
- [x] `src/proxy.ts`, `src/lib/navigation/authMenu.ts` (`account` destination after `trips`), `HeaderMenu` if needed -- page protected and reachable
- [x] `src/i18n/en.ts`, `src/i18n/de.ts` -- `header.account`, `account.*` keys
- [x] Tests: repo (listing rules, foreign family, legacy null host, rotation carries `redirectUri`), routes (I/O matrix, the 401 on `/api/mcp` after disconnect, MCP off), password routes (revocation scoped to the user), the component (rows, empty state with URL, confirm then remove, error), the menu and proxy tests updated, plus an existing-or-new test that the revoke endpoint revokes its own token (RFC 7009)

**Acceptance Criteria:**
- Given my account page, then *Verbundene Apps* / *Connected apps* lists each active connection with client name, redirect host, connected since and last used, and *Trennen* / *Disconnect* asks for confirmation before revoking all of that connection's tokens.
- Given I change my password (forced first-login change) or reset it, then all my connector tokens are revoked. Given my account is deleted, then my tokens are deleted with it (existing cascade, test kept).
- Given a client holding a token, when it calls `/api/oauth/revoke` with it, then its connection is revoked and it disappears from the list.
- Given the whole suite, then typecheck, lint (no new warnings), the tests and the build pass, and the i18n parity test passes.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 1, low 6)
- defer: 2 (high 0, medium 1, low 1)
- reject: 7 (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` An authorization code issued before a password write could still be exchanged for a fresh family. Added `invalidateUnusedCodesForUser` to both password transactions, with a test.
  - `[low]` `[patch]` `account/page.tsx` turned DB errors into `notFound()`. Dropped the `.catch`.
  - `[low]` `[patch]` A disconnect `not_found` (could be "connector off") was treated as removal. Disconnect and `not_found` now refetch the list.
  - `[low]` `[patch]` A list in error state stayed stale after a successful disconnect. Covered by the same refetch.
  - `[low]` `[patch]` The dialog title and body went blank during the closing fade. The client name is kept in `dialogClient`.
  - `[low]` `[patch]` A 401 on DELETE showed "try again". It now shows the sign-in message, with a test.
  - `[low]` `[patch]` The proxy `/account` prefix also matched `/accounts…`; it now matches exact or `/account/`. The overstated "never deleted" route comment was corrected.

## Design Notes

The epic assumed an existing account page, but the app has none. A minimal `/account` page (email line + section) is the smallest faithful reading. A self-service password change or account deletion are separate features and stay out of scope. The only password writes that exist are forced first-login and reset, and admin deletion already cascades.

*Connected since* is derived from `familyExpiresAt` rather than `min(createdAt)`, because housekeeping deletes expired rows a day after expiry, so the family's first rows disappear within about a day.

## Verification

**Commands (in `travelplan/`):**
- `npm run typecheck` -- expected: clean
- `npm run lint` -- expected: no new problems over baseline
- `npm test` -- expected: all pass
- `npm run check:migrations` and `npm run build` -- expected: success

## Auto Run Result

Status: done

**Summary:** Story 15.3 is implemented. There is a new `/account` page (header row *Konto* / *Account*) with the signed-in email and *Verbundene Apps* / *Connected apps*. The section has one row per active connector connection: client, redirect host, connected since and last used, plus a confirmed *Trennen* / *Disconnect* that revokes the whole token family. The next `/api/mcp` call then answers 401. When nothing is connected, it shows how-to text and the connector URL with a copy button. Password reset and the forced first-login change now revoke all connector tokens and unused authorization codes inside the password transaction. Account deletion keeps the existing FK cascade, which is tested. RFC 7009 `/api/oauth/revoke` is unchanged, and a new test covers it removing the connection from the list.

**Files**
- `travelplan/prisma/schema.prisma`, `prisma/migrations/20261029130000_add_oauth_token_redirect_uri/`: nullable `OAuthToken.redirectUri`. The Prisma client was regenerated.
- `travelplan/src/lib/repositories/oauthRepo.ts`: carries `redirectUri` through exchange and rotation, plus four new functions for listing, disconnecting, revoking all tokens and invalidating codes.
- `travelplan/src/app/api/users/me/connections/route.ts`, `.../[familyId]/route.ts`: the list and disconnect API.
- `travelplan/src/app/api/auth/password-reset/confirm/route.ts`, `.../first-login-password/route.ts`: revocation inside the password transaction.
- `travelplan/src/app/(routes)/account/page.tsx`, `src/components/features/account/{AccountSummary,ConnectedApps}.tsx`: the page and section.
- `travelplan/src/proxy.ts`, `src/lib/navigation/authMenu.ts`, `src/i18n/{en,de}.ts`: gate, menu and strings.
- Tests: `oauthConnections.test.ts`, `connectedApps.test.tsx`, `accountPage.test.ts` (new); menu, proxy, password-route and OAuth fixture tests updated.

**Review:** one pass (Blind Hunter + Edge Case Hunter). 7 patches applied (1 medium: unused codes survived a password write), 2 deferred (DW-422 session JWTs survive a reset, DW-423 revoke versus a grace-window rotation race; both existed before this story), 7 rejected.

**Follow-up review recommended:** false. The patches were localized and each one is tested.

**Verification:** `npm run typecheck` clean. `npm run lint` 0 errors / 80 warnings, same as baseline. `npm test` 241 files / 3826 passed. `npm run check:migrations` and `npm run build` succeeded.

**Residual risks:** Families issued before the migration show the host as `—` until they reconnect (at most 30 days). There is no test for a password transaction that fails halfway; atomicity rests on the single transaction. Deviations: the extra `AccountSummary.tsx` client component; a DELETE on an expired, unlisted family answers 200 rather than 404, which is harmless.
