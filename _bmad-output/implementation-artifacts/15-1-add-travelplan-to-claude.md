---
baseline_commit: c244d2c
---

# Story 15.1: Add TravelPlan to Claude

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Prerequisites — read before starting

- **Epic 15 is new.** Source of truth: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-29-mcp.md` (sections 1–6), Story 15.1 in `epics.md`, and the *Connector auth*, *MCP endpoint* and *Guarded outbound fetch* entries in `architecture.md` (Winston review, 2026-10-29). If those entries are missing from `architecture.md`, you are on the wrong base (`c244d2c` or later).
- This story exposes **no trip data**. The only tool is `whoami`. Reads come in 15.2, writes in 15.4+.
- This is the app's **first OAuth server, first bearer-token API and first outbound fetch to a URL chosen by a client**. Everything here is security code. Full three-layer code review (blind, edge case, acceptance) is mandatory.
- Origin: Tommy with John (PM) and Winston (Architect), 2026-10-29. Tommy's rulings that apply here: **only Claude may connect for now** (`MCP_CLIENT_ID_HOSTS`, default `claude.ai`); only owners and contributors of a trip reach it through the connector (relevant from 15.2; `whoami` only counts).

## Story

As someone who plans trips with Claude,
I want to add TravelPlan as a connector, sign in with my TravelPlan account and confirm,
so that Claude can act for me in TravelPlan without ever seeing my password.

## Acceptance Criteria

1. **Off switch.** Unless `MCP_ENABLED === "true"`, every connector endpoint answers **404**: both `/.well-known/*` documents, the authorize page, the decision route, `/api/oauth/token`, `/api/oauth/revoke` and `/api/mcp`. Read on every call, so tests can toggle it (as with `isAiSuggestionsEnabled`).
2. **Boot check.** In production, with `MCP_ENABLED=true`, a missing or non-`https` `APP_BASE_URL` throws in `instrumentation.ts`, following the existing `assert…Configured` pattern (skipped in the build phase and outside production).
3. **401 challenge.** `POST /api/mcp` without a valid bearer token answers **401** with `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource", scope="trips"`, before any MCP processing. An expired, revoked or unknown token, or a token whose `resource` is not the MCP resource, gets the same 401 with `error="invalid_token"`. Tokens in the query string are never read.
4. **Protected-resource metadata (RFC 9728).** `GET /.well-known/oauth-protected-resource` **and** the path-inserted `GET /.well-known/oauth-protected-resource/api/mcp` return the same JSON:
   - `resource` = exactly `<issuer>/api/mcp`
   - `authorization_servers` = `[<issuer>]`
   - `scopes_supported` = `["trips"]`
   - `bearer_methods_supported` = `["header"]`
   - `resource_name` = `"TravelPlan"`
   
   Both carry `Cache-Control: public, max-age=300`.
5. **Authorization-server metadata (RFC 8414).** `GET /.well-known/oauth-authorization-server` returns:
   - `issuer` = `<issuer>`, exactly as used to build the URL
   - `authorization_endpoint` = `<issuer>/oauth/authorize`
   - `token_endpoint` = `<issuer>/api/oauth/token`
   - `revocation_endpoint` = `<issuer>/api/oauth/revoke`
   - `response_types_supported` = `["code"]`
   - `grant_types_supported` = `["authorization_code","refresh_token"]`
   - `code_challenge_methods_supported` = `["S256"]`
   - `token_endpoint_auth_methods_supported` = `["none"]`
   - `revocation_endpoint_auth_methods_supported` = `["none"]`
   - `scopes_supported` = `["trips","offline_access"]`
   - `client_id_metadata_document_supported` = `true`
   - `authorization_response_iss_parameter_supported` = `true`
   - **no** `registration_endpoint`
6. **Client allowlist before any fetch.** A `client_id` must be an `https:` URL with no port, no userinfo, no fragment, a non-empty path, and a host listed in `MCP_CLIENT_ID_HOSTS` (comma-separated, exact, case-insensitive; default `claude.ai`). Anything else is refused **without a network request**. The refusal is logged with the host only: `oauth/authorize: client_id host not allowed: <host>`. This log is how Tommy finds the hosted Claude apps' CIMD host if it is not `claude.ai`.
7. **Client ID Metadata Document.** An allowed `client_id` is fetched with `guardedFetch` (AC 18), at most 64 KB, 15 s, no redirects, `Accept: application/json`. It must be valid JSON with:
   - `client_id` **exactly equal** to the URL
   - a non-empty `client_name`
   - a non-empty `redirect_uris` array of strings
   - `token_endpoint_auth_method` absent or `"none"`
   
   A valid document is cached in memory per `client_id` for `min(max-age from Cache-Control, 24 h)`, default 1 h when there is no header. An invalid document or a failed fetch is **not** cached.
8. **Redirect URI.** The request's `redirect_uri` must equal one of the document's `redirect_uris` exactly. The one exception is a registered loopback URI (`http://localhost/...` or `http://127.0.0.1/...`): it matches a requested URI with the same scheme, host and path on **any port** (Claude Code uses an ephemeral port). No other relaxation: no prefix match, no trailing-slash or query tolerance.
9. **Authorize request validation (`/oauth/authorize`, GET).** Required: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` (43–128 chars, `[A-Za-z0-9-._~]`), `code_challenge_method=S256`, `resource` (must equal the MCP resource; one trailing slash tolerated; scheme and host case-insensitive). `state` is optional and passed through. `scope` is optional; when present it must be a subset of `trips offline_access`; the granted scope is always `trips`.
   - **Before** `client_id` and `redirect_uri` are verified, errors render an error card on the page. The browser is **never** redirected to an unverified URI.
   - **After** they are verified, errors redirect to `redirect_uri` with `error`, `error_description`, `state` (if given) and `iss=<issuer>`.
10. **Sign-in round trip.** When I am not signed in, `/oauth/authorize` redirects to `/auth/login?returnTo=<the full /oauth/authorize?... path, encoded>`. After a successful sign-in, the login page navigates to `returnTo` **only if** it is a relative path starting with `/oauth/authorize?`. That means no scheme, no `//`, no backslash, and it is decoded and checked once. Otherwise the login page behaves exactly as today. A session with `mustChangePassword` goes to the first-login page as today; the authorize step is then restarted from Claude (documented limitation).
11. **Consent screen.** Signed in, I see the authorize page in my UI language, in the `AuthScreenShell` card. It shows:
    - the client's `client_name`, plus the **host of its `client_id`** in plain text (the name is self-asserted, the host is not)
    - the **host of the `redirect_uri`**
    - the sentence `oauth.consent.permission` ("Reisen lesen und bearbeiten, auf denen du planen darfst" / "Read and edit the trips you may plan")
    - my email address
    - *Erlauben* / *Allow* (primary) and *Ablehnen* / *Deny*
    
    When **every** `redirect_uri` in the document is a loopback address, an extra warning (`oauth.consent.loopbackWarning`) says that a program on this computer will receive access. Every new authorization needs this consent; nothing is remembered.
12. **Decision.** `POST /api/oauth/authorize/decision` runs the CSRF check first, then `requireSession` (401), then re-validates the full authorize request server-side (same function as AC 9), then:
    - On *Ablehnen*, it returns `{ data: { redirectUrl } }` to `redirect_uri` with `error=access_denied`, `state`, `iss`.
    - On *Erlauben*, it issues a code and returns `redirect_uri?code=…&state=…&iss=…`.
    
    The page then navigates with `window.location.assign`. The request body carries the original query string, not separately trusted fields.
13. **Authorization codes.** Each code is:
    - 32 random bytes, base64url, stored only as a SHA-256 hash
    - single-use, valid 60 s
    - bound to user, `client_id`, `redirect_uri`, `code_challenge`, `resource` and scope
    
    A code presented a second time answers `invalid_grant` **and** revokes the token family it issued.
14. **Token endpoint, code grant.** `POST /api/oauth/token` accepts **only** `application/x-www-form-urlencoded`; other content types get 400 `invalid_request`. For `grant_type=authorization_code` it requires `code`, `redirect_uri` (equal to the stored one), `client_id` (equal), `code_verifier` (S256 matches) and `resource` (equal to the stored one). It returns `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope: "trips" }`.
    - Every error is a standard RFC 6749 JSON body (`invalid_request`, `invalid_grant`, `unsupported_grant_type`, `invalid_scope`): HTTP 400 for these, 401 only for `invalid_client`.
    - Every response carries `Cache-Control: no-store` and `Pragma: no-cache`.
    - These responses are **not** in the `{ data, error }` envelope.
    - Rate limit: `checkRateLimit("oauth-token:" + ip, 60, 60_000)`, which gives 429 `{"error":"slow_down"}` **[default]**.
15. **Token endpoint, refresh grant.** `grant_type=refresh_token` with `refresh_token`, `client_id` (equal to the token's) and an optional `resource` (if given, equal) rotates on every use. The old refresh token is marked rotated, and a new access token and refresh token in the **same family** are returned in this response.
    - A rotated refresh token presented again **within 30 s** of its rotation answers `invalid_grant` and revokes nothing (Claude refreshes proactively and can race itself).
    - Presented later, it answers `invalid_grant` and **revokes the whole family**.
    - Expired, revoked or unknown tokens answer `invalid_grant`.
16. **Token model.** All tokens are opaque (32 random bytes, base64url) and stored only as SHA-256 hashes, with:
    - user, `clientId` (the URL), `clientName` (from the document, for Story 15.3)
    - scope, resource, `familyId`, `kind` (`ACCESS` | `REFRESH`)
    - `expiresAt`, `createdAt`, `lastUsedAt`, `rotatedAt`, `revokedAt`
    
    Lifetimes: access 1 h, refresh 30 days. A family's refresh lifetime is not extended past 30 days from the consent **[default]**. `lastUsedAt` is written at most once per 5 minutes per token. Deleting a user cascades to all codes and tokens. `JWT_SECRET` is not involved.
17. **Revocation endpoint (RFC 7009).** `POST /api/oauth/revoke` (form-encoded `token`, optional `token_type_hint`, `client_id`) revokes the presented token's **whole family** and always answers 200 with an empty body, including for unknown tokens. Rate-limited per IP like `/token`.
18. **Guarded fetcher.** `src/lib/http/guardedFetch.ts`:
    - Takes `https:` URLs only, on port 443, and refuses IP-literal hosts.
    - Resolves DNS **once** through its own `lookup` and refuses the request if **any** resolved address is not public unicast. That covers loopback, private, link-local, unique-local `fc00::/7`, `fe80::/10`, CGNAT, multicast, reserved and unspecified addresses, with IPv4-mapped IPv6 unwrapped first.
    - Connects to the checked address (pinned through the `lookup` hook, with SNI/certificate on the original hostname), so DNS rebinding cannot redirect it.
    - Follows redirects only up to the caller's `maxRedirects` (0 here; 15.7 will use 3), checking each hop the same way.
    - Aborts at `maxBytes` and `timeoutMs`.
    - Sends no cookies or credentials.
    - Returns `{ ok: true, status, headers, body: Uint8Array } | { ok: false, reason }`.
    - Built on `node:https`, with `ipaddr.js` for range checks. No `undici` dependency.
    - DNS and the request function are injectable for tests.
19. **MCP endpoint.**
    - `POST /api/mcp` (Node runtime) authenticates with `requireBearerAuth` from `@modelcontextprotocol/server`. It uses our verifier and `expectedResource` = the MCP resource, then serves the request through `createMcpHandler` with `responseMode: 'json'` and the default `legacy: 'stateless'`, so 2026-07-28 and 2025-era clients both work.
    - `authInfo.extra.userId` carries the user.
    - Request bodies over **2 MB** answer 413 (declared length checked first, then a counted read).
    - `GET` and `DELETE` answer 405.
    - The `session` cookie is ignored on `/api/mcp`: a request with only a valid session cookie gets 401.
    - A bearer token is accepted on no other route: no existing guard reads `Authorization`. A test pins this for one REST route.
20. **`whoami` tool** (read-only annotation) returns my email and the number of trips I may plan (owner or contributor, through `canTripAccessRoleWrite`), and nothing else, e.g. `{ email, plannableTrips }` as text and `structuredContent`. Every tool call is logged as `mcp: tool=<name> user=<id> outcome=<ok|error> ms=<n>`, never with arguments.
21. **Housekeeping.** Each successful token issue deletes codes and tokens that expired more than 24 h ago (bounded `deleteMany`, no scheduler).
22. **i18n.** Every new string exists in `en.ts` and `de.ts`, and `i18nDictionaries.test.ts` passes.
23. **Tests** (vitest, no network) cover at least:
    - metadata contents, including no `registration_endpoint`, both PRM paths and the `MCP_ENABLED` off case
    - a `client_id` outside the allowlist refused **with no fetch call**
    - a document whose `client_id` differs from its URL
    - a `redirect_uri` not in the document
    - loopback redirects on any port for `localhost` and `127.0.0.1`, while `https` redirects require an exact match
    - the error card (no redirect) for a bad `client_id` and a bad `redirect_uri`
    - an error redirect with `iss` and `state` after validation
    - `returnTo` accepted for `/oauth/authorize?…` and refused for `//evil`, `https://evil`, `/trips` and a backslash variant
    - the decision route (CSRF 403, 401, deny, allow)
    - code: single use, 60 s expiry, PKCE mismatch, wrong `redirect_uri`, wrong `resource`, reuse revoking the family
    - token endpoint: JSON body refused, `no-store` headers
    - refresh: rotation, parallel refresh inside 30 s not revoking, reuse after 30 s revoking the family, expired refresh
    - revoke: whole family, and 200 for an unknown token
    - `/api/mcp`: 401 with `WWW-Authenticate`, wrong audience 401, session cookie alone 401, 413 over 2 MB, 405 on GET, `whoami` counting owner and contributor trips but not viewer trips
    - a bearer token on one REST route (e.g. `GET /api/trips`) 401
    - `guardedFetch`: refuses `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `::1`, `::ffff:127.0.0.1`, `fd00::1`, a hostname resolving to one public and one private address, port 8443, `http:`, an IP-literal host, a redirect when `maxRedirects` is 0, and a body over `maxBytes`
    - user deletion cascading tokens
24. **Gates.** `npm test`, `npm run typecheck`, `npm run lint` (no new errors), `npm run build` and `npm run check:migrations` pass.
25. **Production acceptance (Tommy, manual, after deploy).**
    - Nginx passes `/.well-known/*` and `/api/mcp` to the app unchanged. Check with `curl -i https://plan.dreyer-travels.de/.well-known/oauth-authorization-server`.
    - With `MCP_ENABLED=true`, TravelPlan is added as a custom connector at `https://plan.dreyer-travels.de/api/mcp`:
      - in **claude.ai (web)**: sign-in → consent screen → connected, and asking Claude "Wer bin ich in TravelPlan?" runs `whoami` correctly
      - in **Claude Code** (`claude mcp add --transport http travelplan https://plan.dreyer-travels.de/api/mcp`): the same
    - If claude.ai is refused, the server log line from AC 6 names the host. Tommy adds it to `MCP_CLIENT_ID_HOSTS` only if it is an Anthropic host.

**Out of scope:**
- any trip data (15.2)
- the *Verbundene Apps* page and revocation on password change (15.3)
- Dynamic Client Registration (a contingency only, behind its own switch, and only if AC 25 shows a Claude surface not using CIMD; that would be a follow-up story)
- scopes finer than `trips`
- remembering consent
- carrying `returnTo` through the first-login password change
- Origin/Host header checks on `/api/mcp` (bearer-only, no cookies; not needed)

## Tasks / Subtasks

- [ ] **Task 1: Dependencies and config** (AC: 1, 2, 6)
  - [ ] `npm install --save-exact @modelcontextprotocol/server@2.4.0` and `npm install ipaddr.js@^2.5.0`. Check that `zod` in the lockfile satisfies the SDK's `^4.2.0` (it is 4.4.3). Do **not** install `@modelcontextprotocol/sdk` (v1 does not support 2026-07-28).
  - [ ] `src/lib/oauth/config.ts`:
    - `isMcpEnabled()`
    - `getIssuer()`: the origin of `APP_BASE_URL` with no trailing slash; falls back to `http://localhost:3000` outside production, like the reset route
    - `getMcpResourceUrl()`: issuer + `/api/mcp`
    - `getAllowedClientIdHosts()`: parsed `MCP_CLIENT_ID_HOSTS`, default `["claude.ai"]`
    - constants `MCP_SCOPE = "trips"`, `ACCESS_TOKEN_TTL_MS`, `REFRESH_TOKEN_TTL_MS`, `CODE_TTL_MS`, `REFRESH_REUSE_GRACE_MS = 30_000`
    - all `process.env` reads per call
  - [ ] `src/lib/oauth/configBoot.ts` `assertMcpConfigured()`, called from `src/instrumentation.ts` `register()` after the SMTP check. Same skip rules as `assertSmtpConfigured`.
  - [ ] A small `connectorDisabled()` helper returning the 404 used by every endpoint.
- [ ] **Task 2: Schema and migration** (AC: 13, 16, 21)
  - [ ] `prisma/schema.prisma`:
    - `enum OAuthTokenKind { ACCESS REFRESH }`
    - `model OAuthAuthorizationCode` (`oauth_authorization_codes`): id, codeHash unique, userId FK Cascade, clientId, clientName, redirectUri, codeChallenge, resource, scope, expiresAt, usedAt?, familyId?, createdAt
    - `model OAuthToken` (`oauth_tokens`): id, tokenHash unique, kind, familyId, userId FK Cascade, clientId, clientName, scope, resource, expiresAt, familyExpiresAt, createdAt, lastUsedAt?, rotatedAt?, revokedAt?
    - indexes `idx_oauth_tokens_family_id`, `idx_oauth_tokens_user_id`, `idx_oauth_tokens_expires_at`
    - relations on `User`
    - snake_case `@map` everywhere, per the naming rules
  - [ ] Migration `prisma/migrations/20261029120000_add_oauth_connector/migration.sql`, generated by `prisma migrate dev --create-only`, with the leading `--` comment block explaining Story 15.1 like the recent migrations. Additive only.
  - [ ] Bump `PRISMA_SCHEMA_TAG` in `src/lib/db/prisma.ts` and extend `cachedClientMatchesCurrentSchema` with a probe for the new delegate (`oAuthToken`) so a hot-reloaded dev client is rebuilt.
- [ ] **Task 3: Guarded fetcher** (AC: 18)
  - [ ] `src/lib/http/guardedFetch.ts`. See *Guarded fetch* below.
  - [ ] `test/guardedFetch.test.ts` with an injected `lookup` and an injected request function. No sockets.
- [ ] **Task 4: Client metadata and redirect matching** (AC: 6, 7, 8)
  - [ ] `src/lib/oauth/clientMetadata.ts`:
    - `parseClientIdUrl(raw)` → URL | null (AC 6 shape checks)
    - `isAllowedClientIdHost(url)`
    - `resolveClientMetadata(clientId, deps?)` → `{ ok: true, client: { clientId, clientName, redirectUris } } | { ok: false, reason }`, with an in-memory TTL cache keyed by `client_id` and an exported `resetClientMetadataCacheForTests()`
    - its own small Zod schema for the document (do **not** add `@modelcontextprotocol/core` as a direct dependency)
  - [ ] `src/lib/oauth/redirectUri.ts`: `matchesRegisteredRedirectUri(requested, registered[])` and `isLoopbackRedirectUri(uri)`.
- [ ] **Task 5: Authorization request, PKCE, codes and tokens** (AC: 9, 13–17, 21)
  - [ ] `src/lib/oauth/authorizeRequest.ts`: `validateAuthorizeRequest(searchParams, deps)` → one of:
    - `{ kind: "fatal", reason }` (render the card)
    - `{ kind: "redirectError", redirectUri, error, description, state }`
    - `{ kind: "ok", request: { client, redirectUri, codeChallenge, resource, scope, state } }`
    
    `buildAuthorizationResponseUrl(redirectUri, params)` always adds `iss`. Used by the page **and** the decision route.
  - [ ] `src/lib/oauth/pkce.ts`: `verifyS256(verifier, challenge)` (verifier 43–128 chars of the unreserved set; base64url SHA-256; timing-safe compare).
  - [ ] `src/lib/oauth/secrets.ts`: `generateOpaqueToken()` (32 bytes base64url) and `hashOpaqueToken()` (SHA-256 hex, the same as `hashPasswordResetToken`).
  - [ ] `src/lib/repositories/oauthRepo.ts` (all Prisma access lives here):
    - `createAuthorizationCode`
    - `exchangeAuthorizationCode`: an interactive `$transaction` that checks `usedAt`, expiry and every binding, marks it used, creates the family and the access and refresh pair; on reuse it revokes the family
    - `rotateRefreshToken`: grace and reuse logic inside one transaction
    - `findActiveAccessToken(hash)` (checks `revokedAt`, `expiresAt` and `kind`)
    - `touchTokenLastUsed` (throttled)
    - `revokeFamilyByTokenHash`
    - `deleteExpiredOAuthRows`
    - `countPlannableTripsForUser(userId)`, or put this one in `tripRepo.ts`: trips owned plus `CONTRIBUTOR` memberships, consistent with `deriveTripAccessRole` and `canTripAccessRoleWrite`
- [ ] **Task 6: Discovery routes** (AC: 4, 5)
  - [ ] `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts` and `src/app/.well-known/oauth-authorization-server/route.ts`, built from one `src/lib/oauth/metadata.ts`.
  - [ ] Confirm with `npm run build` and a `next start` curl that Next serves the dot-folder. If it does not, add `rewrites()` in `next.config.ts` from `/.well-known/:path*` to `/api/well-known/:path*`, and note it in the completion notes.
- [ ] **Task 7: Login `returnTo`** (AC: 10)
  - [ ] `src/lib/oauth/returnTo.ts` `safeOAuthReturnTo(raw: string | null): string | null`, a pure and tested function.
  - [ ] `src/app/(auth)/auth/login/page.tsx`: read `returnTo` with `useSearchParams` (wrap in `<Suspense>` if the build demands it). On success, without `mustChangePassword`, call `window.location.assign(safe)` when it is safe, otherwise keep `router.push("/")`. Everything else on the page stays.
- [ ] **Task 8: Authorize page and decision route** (AC: 9, 10, 11, 12)
  - [ ] `src/app/(auth)/oauth/authorize/page.tsx`: a server component, `dynamic = "force-dynamic"`.
    - 404 (`notFound()`) when disabled.
    - Run `validateAuthorizeRequest`:
      - fatal: render the error card
      - redirectError: `redirect(url)`
      - not signed in (read the `session` cookie with `verifySessionJwt`, like `resolveSignedInUserId`): `redirect("/auth/login?returnTo=" + encodeURIComponent(path+query))`
      - signed in: render a client `OAuthConsentCard`
    - The proxy does **not** match this path. Do not add it to the matcher.
  - [ ] `src/components/features/oauth/OAuthConsentCard.tsx` (client):
    - `AuthScreenShell`
    - fetch the CSRF token as the login page does
    - POST `{ query, decision: "allow" | "deny" }` with `x-csrf-token`
    - pending state disables both buttons
    - `window.location.assign(redirectUrl)`
    - error notice on failure
  - [ ] `src/app/api/oauth/authorize/decision/route.ts`: CSRF, then `requireSession`, then `validateAuthorizeRequest(new URLSearchParams(body.query))`, then issue the code or deny. `requireSession` already refuses `mustChangePassword`.
- [ ] **Task 9: Token and revoke routes** (AC: 14, 15, 17, 21)
  - [ ] `src/lib/oauth/formBody.ts`: read the body as text with a 16 KB cap (counted read, like `readJsonBodyWithinLimit`), `new URLSearchParams(text)`, refuse duplicate parameters (RFC 6749 §3.2).
  - [ ] `src/app/api/oauth/token/route.ts` and `src/app/api/oauth/revoke/route.ts`, with `runtime = "nodejs"`, the RFC JSON error helper `oauthError(code, description, status)`, `no-store` headers, and the rate limit. Use the client-IP logic of the login route (consider extracting `getClientIp` into `src/lib/http/clientIp.ts`; it is copy-pasted three times today, so moving it is in scope if you touch it).
- [ ] **Task 10: MCP endpoint and `whoami`** (AC: 3, 19, 20)
  - [ ] `src/lib/mcp/verifier.ts`: an `OAuthTokenVerifier` implementation. Hash the bearer, call `findActiveAccessToken`, and return `AuthInfo { token, clientId, scopes: ["trips"], expiresAt: seconds, resource: new URL(row.resource), extra: { userId } }`. Throw the SDK's invalid-token error for anything else (check the 2.4.0 `.d.mts` for the exact class or type).
  - [ ] `src/lib/mcp/server.ts`: `createTravelPlanMcpServer()` → `new McpServer({ name: "travelplan", version })`. Register tools from `src/lib/mcp/tools/*`, one file per area. 15.1 has only `tools/whoami.ts`.
  - [ ] `src/lib/mcp/logging.ts`: `withToolLogging(name, handler)`.
  - [ ] `src/app/api/mcp/route.ts`:
    - `runtime = "nodejs"`, `dynamic = "force-dynamic"`
    - POST: disabled 404 → size guard (413) → `requireBearerAuth` gate → `handler.fetch(rebuiltRequest, { authInfo })`
    - GET and DELETE: 405 (or 404 when disabled)
    - Make sure the 401 path never reads the body.
- [ ] **Task 11: i18n, deploy docs** (AC: 22, 25)
  - [ ] Keys `oauth.consent.*` and `oauth.error.*` in both dictionaries.
  - [ ] `deploy/travelplan.env.example`: `MCP_ENABLED=` and `MCP_CLIENT_ID_HOSTS=claude.ai`, with comments.
  - [ ] `deploy/README.md`: a *Connector* section covering the connector URL, the switch, the allowlist, that Nginx must pass `/.well-known/*` and `/api/mcp` (no buffering change needed, since JSON responses), and the `claude mcp add` command for testing.
- [ ] **Task 12: Tests and gates** (AC: 23, 24). See *Testing*.

## Dev Notes

### What exists and what this story does to it

| Area | Today | This story |
|---|---|---|
| Session | `session` cookie with HS256 JWT `{ sub, role, mustChangePassword }`, 7 d (`src/lib/auth/jwt.ts`, `session.ts`); `requireSession(request)` → `{ response, session }` (`sessionGuard.ts:23`) | Unchanged. The consent page reads the cookie the same way as `resolveSignedInUserId` (`src/lib/auth/adminPage.ts:14`); the decision route uses `requireSession`. |
| CSRF | Double-submit: cookie `csrf_token`, header `x-csrf-token`, `validateCsrf` (`src/lib/security/csrf.ts`), checked **before** the session; token from `GET /api/auth/csrf` | The decision route uses it. Token and revoke do **not** (form posts from a public client, no cookies). `/api/mcp` does not (bearer). |
| Login | `src/app/(auth)/auth/login/page.tsx` → `router.push(mustChangePassword ? "/auth/first-login-password" : "/")` at `:127`; no return parameter anywhere | Adds `returnTo`, restricted to `/oauth/authorize?…` (AC 10). |
| Proxy | `src/proxy.ts` matcher: `/`, `/trips/*`, `/users/*`, `/admin/*`, `/api/trips*`, `/auth/first-login-password`; pinned by `test/proxy.test.ts` | **Unchanged.** `/.well-known/*`, `/oauth/*`, `/api/oauth/*` and `/api/mcp` are outside the matcher on purpose (no body buffering, no session redirects). The authorize page guards itself. |
| Rate limit | `checkRateLimit(key, limit, windowMs)`, in-memory, fixed window (`src/lib/security/rateLimit.ts:16`) | New keys `oauth-token:<ip>` and `oauth-revoke:<ip>`. |
| Responses | `ok` / `fail` envelope (`src/lib/http/response.ts`) | Used by the decision route only. OAuth endpoints and metadata return **raw RFC JSON**; `/api/mcp` returns whatever the SDK returns. |
| Outbound fetch | Per-service `fetchImpl` + `AbortController`; host allowlist only (`isHttpsUrlOnHost`, `daySuggestionSchemas.ts:161`); no DNS/IP checks anywhere; `undici` not a direct dependency | New `guardedFetch` (AC 18), the first DNS-checked fetcher. Reused by 15.7. |
| Boot checks | `src/instrumentation.ts` `register()` → `assertMediaRootConfigured`, `assertSmtpConfigured` | Adds `assertMcpConfigured`. |
| User deletion | Admin-only, `deleteUserForAdmin` (`src/lib/repositories/adminUserRepo.ts:251`), `tx.user.delete` | New FKs cascade; no code change there. |

### OAuth endpoints at a glance

```
GET  /.well-known/oauth-protected-resource            PRM (RFC 9728)
GET  /.well-known/oauth-protected-resource/api/mcp    same (path-inserted form)
GET  /.well-known/oauth-authorization-server          AS metadata (RFC 8414)
GET  /oauth/authorize                                 page: validate → login round trip → consent card
POST /api/oauth/authorize/decision                    CSRF + session → code / access_denied  (envelope)
POST /api/oauth/token                                 form-encoded; code + refresh grants      (RFC JSON)
POST /api/oauth/revoke                                form-encoded; RFC 7009                   (200 always)
POST /api/mcp                                         bearer → createMcpHandler (json)
```
`issuer` is the origin of `APP_BASE_URL`, e.g. `https://plan.dreyer-travels.de`. The resource is `https://plan.dreyer-travels.de/api/mcp`, which must be **byte-identical** to the URL Tommy types into Claude.

### Known Claude behaviour (claude.com/docs/connectors/building/authentication, checked 2026-10-29)

- Sign-in starts **only** on a 401 carrying `WWW-Authenticate … resource_metadata`. A 200 with an error does nothing.
- Claude uses only the first `authorization_servers` entry.
- Claude uses CIMD only if the AS metadata has `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`. Otherwise it falls back to DCR, which we do not offer, so the connection fails. Both values are in AC 5.
- PKCE S256 is always sent, and `resource` is sent in the authorization and token requests.
- Claude adds `offline_access` to the requested scope when the AS metadata lists it, so accept it in `scope` (AC 9).
- Redirects:
  - Hosted apps (web, desktop, mobile): `https://claude.ai/api/mcp/auth_callback`.
  - Claude Code: CIMD `https://claude.ai/oauth/claude-code-client-metadata`, with `redirect_uris` `["http://localhost/callback","http://127.0.0.1/callback"]` on an **ephemeral port**, hence AC 8.
- The hosted apps' CIMD URL is **not published**, which is why AC 6 logs the refused host and AC 25 checks it.
- Timeouts: 10 s for discovery and token, 30 s for refresh. Claude refreshes on 401 and up to 5 minutes before expiry, and expects `invalid_grant` for a dead refresh token, and rotation.
- `/token` is always form-encoded. Discovery is cached about 5 minutes.
- Egress comes from `160.79.104.0/21` (not used for filtering; Claude Code calls from users' machines).

### MCP authorization spec 2026-07-28: points this story implements

- **CIMD:** the AS MUST check that the fetched `client_id` equals the URL, MUST check `redirect_uri` against `redirect_uris`, MUST require valid JSON with the required fields, and SHOULD consider SSRF. Domain-trust policies are allowed, which is our allowlist. The redirect host must be shown clearly, with a warning when only loopback redirects exist.
- **DCR is deprecated**, so this story offers none.
- **RFC 9207 `iss`:** included on every authorization response, success and error, and advertised (AC 5, AC 9, AC 12).
- **Audience:** the RS MUST reject tokens not issued for it. We store `resource` on the token and `requireBearerAuth({ expectedResource })` checks it. The SDK tolerates one trailing slash.
- **Public clients:** refresh tokens MUST rotate.
- Redirect URIs MUST be `https` or loopback (enforced by the document check plus AC 8). There are no tokens in query strings.
- **PRM `scopes_supported` should not contain `offline_access`;** only the AS metadata lists it.

### MCP SDK: `@modelcontextprotocol/server` 2.4.0 (v2 line, published 2026-10-23)

- v1 `@modelcontextprotocol/sdk` (1.32.x) stays on 2025-11-25 and **will not** support 2026-07-28. Use v2.
- v2 is split into packages: `@modelcontextprotocol/server` depends on `@modelcontextprotocol/core` and `zod ^4.2.0`. Do not add the express or hono adapters.
- Pattern (adapted from `ts.sdk.modelcontextprotocol.io/v2/serving/http` and `/v2/serving/authorization`). **Verify every name against the installed `.d.mts` before relying on it:**

```ts
import { createMcpHandler, McpServer, requireBearerAuth } from "@modelcontextprotocol/server";

const handler = createMcpHandler(({ authInfo }) => createTravelPlanMcpServer(), { responseMode: "json" });

export async function POST(request: Request) {
  if (!isMcpEnabled()) return connectorDisabled();
  const gate = requireBearerAuth({
    verifier: travelPlanTokenVerifier,
    requiredScopes: [MCP_SCOPE],
    expectedResource: new URL(getMcpResourceUrl()),
    resourceMetadataUrl: `${getIssuer()}/.well-known/oauth-protected-resource`,
  });
  const auth = await gate(request);          // AuthInfo | Response (401/403 with WWW-Authenticate)
  if (auth instanceof Response) return auth;
  const limited = await rebuildWithin2Mb(request);   // 413 on overflow
  if (limited instanceof Response) return limited;
  return handler.fetch(limited, { authInfo: auth });
}
```

- In tool handlers, read the user from `ctx.http?.authInfo?.extra?.userId`. If it is missing, return `isError: true`; never fall back to anything.
- `registerTool(name, { title, description, inputSchema?, annotations: { readOnlyHint: true } }, handler)`. Arguments that fail schema validation give `isError: true` without running the handler.
- The default `legacy: 'stateless'` keeps 2025-era clients (`initialize` handshake) working. **Do not** set `'reject'`; Claude's docs still describe `initialize`.
- `requireBearerAuth` needs `expiresAt` in `AuthInfo`, in seconds.
- Check whether the 401 it builds includes `scope="trips"`. If not, wrap the response to add it (AC 3).
- The SDK does not validate Origin or Host. That is fine for a bearer-only endpoint.

### Guarded fetch (AC 18)

```ts
import https from "node:https";
import dns from "node:dns";
import ipaddr from "ipaddr.js";

const isPublicUnicast = (address: string) => {
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address();
  return ip.range() === "unicast";   // verify the range labels against ipaddr.js 2.5.0 README
};
// lookup(host, opts, cb): resolve with { all: true }; refuse if ANY address is not public; hand back the
// checked address(es) — https.request uses them to connect while SNI/cert validation stay on `hostname`.
```

- Pass the `lookup` option to `https.request`, which closes the TOCTOU gap: resolution and connection are the same step. Handle `opts.all` both ways (Node's `autoSelectFamily` calls with `all: true`).
- Refuse an IP-literal hostname up front: `net.isIP(hostname) !== 0`.
- No `Cookie` or `Authorization` header. Set `User-Agent: TravelPlan (+<issuer>)`. With `maxRedirects` 0, a 3xx is a failure.
- Count bytes and destroy the request at `maxBytes`. One overall timer (`timeoutMs`) destroys the request.
- Testability: `guardedFetch(url, opts, deps = { lookup: dns.lookup, request: https.request })`. Tests inject a fake `lookup` and a fake `request` that emits a canned response, so no sockets are opened.

### Data model sketch

```prisma
enum OAuthTokenKind {
  ACCESS
  REFRESH
}

model OAuthAuthorizationCode {
  id            String    @id @default(cuid()) @map("id")
  codeHash      String    @unique @map("code_hash")
  userId        String    @map("user_id")
  clientId      String    @map("client_id")
  clientName    String    @map("client_name")
  redirectUri   String    @map("redirect_uri")
  codeChallenge String    @map("code_challenge")
  resource      String    @map("resource")
  scope         String    @map("scope")
  expiresAt     DateTime  @map("expires_at")
  usedAt        DateTime? @map("used_at")
  familyId      String?   @map("family_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([expiresAt], map: "idx_oauth_authorization_codes_expires_at")
  @@map("oauth_authorization_codes")
}

model OAuthToken {
  id              String         @id @default(cuid()) @map("id")
  tokenHash       String         @unique @map("token_hash")
  kind            OAuthTokenKind @map("kind")
  familyId        String         @map("family_id")
  userId          String         @map("user_id")
  clientId        String         @map("client_id")
  clientName      String         @map("client_name")
  scope           String         @map("scope")
  resource        String         @map("resource")
  expiresAt       DateTime       @map("expires_at")
  familyExpiresAt DateTime       @map("family_expires_at")
  createdAt       DateTime       @default(now()) @map("created_at")
  lastUsedAt      DateTime?      @map("last_used_at")
  rotatedAt       DateTime?      @map("rotated_at")
  revokedAt       DateTime?      @map("revoked_at")
  user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([familyId], map: "idx_oauth_tokens_family_id")
  @@index([userId], map: "idx_oauth_tokens_user_id")
  @@index([expiresAt], map: "idx_oauth_tokens_expires_at")
  @@map("oauth_tokens")
}
```

- A **family** is one connection, created by one consent. Story 15.3 will list families by `(userId, familyId)` with `clientName`, the `clientId` host, `createdAt` and the latest `lastUsedAt`, and revoke by family. Keep that query easy.
- Revoking means setting `revokedAt` on every row of the family (not deleting), so reuse detection still sees rotated tokens. Housekeeping deletes rows more than 24 h past `expiresAt`.
- Rotation inside one interactive transaction:
  1. Load the refresh row by hash.
  2. If it is revoked, expired or not `REFRESH`, return `invalid_grant`.
  3. If `rotatedAt` is set and `now - rotatedAt ≤ 30 s`, return `invalid_grant` without revoking.
  4. If `rotatedAt` is set and older than that, revoke the family and return `invalid_grant`.
  5. Otherwise set `rotatedAt = now` and create the new pair with the same `familyId` and `familyExpiresAt`. The new refresh token's `expiresAt` is `min(now + 30 d, familyExpiresAt)`.

### The authorize page in detail

- Validation order (AC 9):
  1. Parse `client_id` (shape, then allowlist, which logs the host).
  2. Resolve the CIMD.
  3. Check `redirect_uri`.

  Up to this point, a failure is **fatal** and renders the card `oauth.error.invalidRequest` with a short reason key. From here on, errors redirect:

  4. `response_type`
  5. `code_challenge_method` and `code_challenge`
  6. `resource`
  7. `scope`
- Signed-in check: verify the `session` cookie. If it is invalid or missing, redirect to login with `returnTo` = `"/oauth/authorize?" + originalQueryString`.
- `mustChangePassword` sessions: `requireSession` in the decision route already answers 403. On the page, treat such a session like a signed-out one; the login page sends it to first-login (AC 10 limitation).
- The card's language comes from `getServerLanguage()` and the `I18nProvider` already in the root layout. Use the `AuthScreenShell` props `title`, `subtitle`, `error` and `children`.

### Testing

- Vitest, flat `test/` folder. The DB comes from `test/setup.ts` (`prisma migrate deploy` once per worker, `JWT_SECRET="test-secret"`). Clean with `prisma.<model>.deleteMany()` in `beforeEach`, **children first** (tokens and codes before users).
- Route tests import the handler and pass a `NextRequest`, as in `test/loginRoute.test.ts` and `test/adminUserActionsRoute.test.ts`. Session and CSRF: `cookie: "session=<createSessionJwt(...)>; csrf_token=test-csrf-token"` plus `x-csrf-token: test-csrf-token`.
- Set `process.env.MCP_ENABLED`, `APP_BASE_URL` (`https://plan.example.test`) and `MCP_CLIENT_ID_HOSTS` per test and restore them in `afterEach`.
- Inject the CIMD fetch: `resolveClientMetadata(clientId, { fetch })`, with routes and pages passing the default. A module-level setter such as `setClientMetadataFetcherForTests()` is acceptable if threading `deps` through the page is awkward. Assert the fake was **not called** for a disallowed host (AC 23).
- Time-dependent cases (60 s code, 30 s grace, 1 h access, 30 d refresh): use `vi.useFakeTimers()` / `vi.setSystemTime()`, or seed rows with past timestamps directly.
- PKCE fixture: RFC 7636 Appendix B, verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`, challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`.
- `/api/mcp` end to end: issue a real token through the repo, POST a JSON-RPC `tools/call` for `whoami` (and an `initialize` for the 2025 era), and parse the JSON response. Check the request headers the 2026-07-28 transport needs (`Mcp-Method`, `Mcp-Name`, `MCP-Protocol-Version`, `Accept: application/json, text/event-stream`) against the SDK docs; tests must send what Claude would.
- The `whoami` fixture covers one owned trip, one contributor trip and one viewer trip, and expects `plannableTrips: 2`.
- Suggested files:
  - `test/oauthMetadataRoutes.test.ts`
  - `test/oauthClientMetadata.test.ts`
  - `test/oauthRedirectUri.test.ts`
  - `test/oauthAuthorizeRequest.test.ts`
  - `test/oauthReturnTo.test.ts`
  - `test/oauthDecisionRoute.test.ts`
  - `test/oauthTokenRoute.test.ts`
  - `test/oauthRevokeRoute.test.ts`
  - `test/mcpRoute.test.ts`
  - `test/guardedFetch.test.ts`
  - `test/oauthUserCascade.test.ts`
- `test/proxy.test.ts` must pass **unchanged**, which proves the matcher was not touched.

### Traps

- **Never redirect before the redirect URI is verified** (open redirector). Never put a token or code in a log line. Log hosts and ids only.
- **Do not trust `client_name`.** Show it, but always next to the `client_id` host.
- **Timing-safe comparisons:** use `crypto.timingSafeEqual` for PKCE. Hash lookups are by unique index and need nothing extra.
- **Form parsing:** Next's `request.formData()` also parses multipart. Use `request.text()` with a cap plus `URLSearchParams`, check the content type yourself, and refuse a duplicated parameter.
- **CORS:** Claude's hosted apps call the token endpoint server-side. Claude Code calls it from Node. No CORS headers are needed. Do not add `Access-Control-Allow-Origin: *`.
- **`APP_BASE_URL` with a trailing slash or a path:** use `new URL(...).origin`. A wrong issuer breaks Claude silently, because it compares issuer strings exactly.
- **Next `redirect()` in a server component throws:** do not wrap it in try/catch.
- **Do not touch the session JWT, cookie or CSRF semantics.** Other routes depend on them.
- **SQLite and `@unique` hashes:** generate a fresh token per row and never reuse random values across rows.
- `window.location.assign` for the external redirect: `router.push` cannot leave the origin cleanly.
- The SDK's error classes and option names differ between v1 and v2 docs on the web. **Use the installed 2.4.0 `.d.mts` as the truth.**

### Project Structure Notes

- New folders: `src/lib/oauth/`, `src/lib/mcp/` (with `tools/`), `src/app/.well-known/…`, `src/app/(auth)/oauth/authorize/`, `src/app/api/oauth/…`, `src/app/api/mcp/`, `src/components/features/oauth/`. All Prisma access goes through `src/lib/repositories/oauthRepo.ts`, per the architecture's *data access only via repositories* rule.
- Naming:
  - DB tables and columns `snake_case`; indexes `idx_<table>_<column>`
  - JSON in the decision route `camelCase`
  - OAuth wire fields `snake_case` **by RFC**, a deliberate exception to the `camelCase` JSON rule, because OAuth clients require it
- `runtime = "nodejs"` on every new route: `node:crypto`, `node:https`, Prisma.

### References

- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-29-mcp.md`, §1 (rulings R1–R8), §4.3 (Story 15.1), §6 (architect review)
- `_bmad-output/planning-artifacts/epics.md`, Epic 15 shared rules and Story 15.1
- `_bmad-output/planning-artifacts/architecture.md`, *Authentication & Security → Connector auth*, *API & Communication Patterns → MCP endpoint*, *Integration Points → MCP connector, Guarded outbound fetch*
- `_bmad-output/planning-artifacts/prd.md`: FR52, NFR5
- MCP spec 2026-07-28 authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization (and `/client-registration`, `/security-considerations`, `/changelog`)
- Claude connector auth: https://claude.com/docs/connectors/building/authentication, plus `/lazy-authentication` and `/testing`
- SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/serving/http, https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization, https://www.npmjs.com/package/@modelcontextprotocol/server
- Claude Code CIMD: https://claude.ai/oauth/claude-code-client-metadata
- RFCs: 6749 (§3.2, §4.1, §5.2), 7009, 7636 (App. B), 8252 (§7.3), 8414, 8707, 9207, 9728
- Code: `src/lib/auth/{jwt,session,sessionGuard,adminPage,tripAccess,tripAccessRole}.ts`, `src/lib/security/{csrf,rateLimit}.ts`, `src/lib/http/{response,bodyLimit}.ts`, `src/app/(auth)/auth/login/page.tsx`, `src/components/features/auth/AuthScreenShell.tsx`, `src/proxy.ts`, `src/instrumentation.ts`, `src/lib/notifications/smtpConfig.ts` (boot-check pattern), `src/lib/ai/config.ts` (feature-switch pattern), `src/lib/repositories/adminUserRepo.ts:251`, `src/lib/db/prisma.ts`

## Questions for Tommy (do not block development)

- **Hosted Claude apps' CIMD host:** not published by Anthropic. If claude.ai web is refused at acceptance, the log names the host, and you decide whether to add it to `MCP_CLIENT_ID_HOSTS`.
- **Defaults chosen here:**
  - token endpoint rate limit 60/min per IP
  - a family lives at most 30 days from consent; after that, Claude asks you to sign in again
  
  Say if you want longer.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
