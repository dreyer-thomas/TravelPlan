---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/product-brief-TravelPlan-2026-02-11.md
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md
  - /Users/tommy/Development/TravelPlan/docs/index.md
  - /Users/tommy/Development/TravelPlan/docs/project-overview.md
  - /Users/tommy/Development/TravelPlan/docs/architecture.md
  - /Users/tommy/Development/TravelPlan/docs/architecture-patterns.md
  - /Users/tommy/Development/TravelPlan/docs/technology-stack.md
  - /Users/tommy/Development/TravelPlan/docs/deployment-configuration.md
  - /Users/tommy/Development/TravelPlan/docs/deployment-guide.md
  - /Users/tommy/Development/TravelPlan/docs/development-guide.md
  - /Users/tommy/Development/TravelPlan/docs/development-instructions.md
  - /Users/tommy/Development/TravelPlan/docs/contribution-guidelines.md
  - /Users/tommy/Development/TravelPlan/docs/project-structure.md
  - /Users/tommy/Development/TravelPlan/docs/critical-folders-summary.md
  - /Users/tommy/Development/TravelPlan/docs/component-inventory.md
  - /Users/tommy/Development/TravelPlan/docs/ui-component-inventory-root.md
  - /Users/tommy/Development/TravelPlan/docs/state-management-patterns-root.md
  - /Users/tommy/Development/TravelPlan/docs/data-models-root.md
  - /Users/tommy/Development/TravelPlan/docs/api-contracts-root.md
  - /Users/tommy/Development/TravelPlan/docs/comprehensive-analysis-root.md
  - /Users/tommy/Development/TravelPlan/docs/project-parts-metadata.md
  - /Users/tommy/Development/TravelPlan/docs/source-tree-analysis.md
  - /Users/tommy/Development/TravelPlan/docs/user-provided-context.md
  - /Users/tommy/Development/TravelPlan/docs/existing-documentation-inventory.md
  - /Users/tommy/Development/TravelPlan/docs/project-scan-report.json
workflowType: 'architecture'
project_name: 'TravelPlan'
user_name: 'Tommy'
date: '2026-02-12T07:37:18Z'
lastStep: 8
status: 'complete'
completedAt: '2026-02-12T08:05:30Z'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
TravelPlan’s functional scope centers on user accounts, trip CRUD, and day-level planning. The core entities are trips with a date range, daily accommodations (status, link, cost), and daily plans (rich text + links). There is also a viewer role with comment/suggestion capabilities and a lightweight budget roll-up. Architecturally, this implies a persistent data model with per-user tenancy boundaries, day-indexed content, and optional shared access.

**Non-Functional Requirements:**
- GDPR-aligned data handling and privacy expectations
- Secure authentication (username/password)
- Backup/export and restore for data durability and migration
- Performance targets: trip load around 15 seconds
- Responsive UI for desktop and mobile/tablet
- No SEO requirement; accessibility level not specified

**Scale & Complexity:**
- Primary domain: full-stack web application (SPA + API + database)
- Complexity level: medium (core CRUD with cross-cutting privacy + durability)
- Estimated architectural components: 5-7 (UI app, API/service layer, data store, auth, file/export/backup, integrations)

### Technical Constraints & Dependencies

- Greenfield project with no current tech stack or codebase
- Must support secure access, data durability, and export/restore
- Map integration required post-MVP (impacts data model and API design)

### Cross-Cutting Concerns Identified

- Authentication and authorization boundaries (owner vs viewer)
- Data durability and recovery (backup/export + restore)
- Privacy/GDPR compliance (data handling, access control)
- Performance for trip load and daily editing flows

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (Next.js App Router + API + database), based on the requirements and your TypeScript/Next.js preference.

### Starter Options Considered

1) **Next.js default starter (`create-next-app`)**  
Pros: Official, minimal, fast start, works well for self-hosting, no vendor lock.  
Cons: Leaves ORM/auth/db choices to us (which is fine here).

2) **Create T3 App (`create-t3-app`)**  
Pros: Opinionated stack (Next.js + tRPC + Prisma + auth).  
Cons: Heavier than needed and includes pre-packaged auth; you asked for custom auth.

3) **Vercel Prisma starters**  
Pros: Quick demo scaffolding.  
Cons: Oriented toward hosted workflows; not aligned with self-host + SQLite.

### Selected Starter: Next.js default (`create-next-app`)

**Rationale for Selection:**  
Matches your tech preferences, keeps the stack minimal, and avoids forcing opinions around auth or DB. It is the most stable, self-host friendly base and stays aligned with official Next.js defaults.

**Initialization Command:**

```bash
npx create-next-app@latest travelplan
```

(Choose recommended defaults: TypeScript, ESLint, App Router; Tailwind optional.)

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**  
- TypeScript enabled by default  
- App Router enabled (recommended)

**Styling Solution:**  
- Tailwind is default; can be declined if you prefer plain CSS or another system

**Build Tooling:**  
- Next.js build pipeline and dev server

**Testing Framework:**  
- Not included by default; we’ll decide later

**Code Organization:**  
- App Router project structure with `app/`  
- Optional `src/` directory and import alias `@/*`

**Development Experience:**  
- ESLint configured by default  
- Local dev server and hot reload

**Note:** Project initialization using this command should be the first implementation story.

### Mapping Libraries (Future Integration)

- Leaflet stable `1.9.4`; Leaflet `2.0.0-alpha.1` exists but is a major change, so avoid for now.
- Trip-level full-size maps should reuse the same Leaflet and route/page composition patterns already established for the day full-page map instead of introducing a separate map stack.

## Core Architectural Decisions (In Progress)

### Data Architecture

- **Database Runtime:** SQLite single file (in-process), self-hosted
- **Migrations:** Prisma Migrate
- **Version Anchors:** Prisma CLI `7.3.0`, `@prisma/client` `7.3.0`, SQLite `3.51.1`
- **Durability (Optional):** Litestream `v0.5.2` for streaming backups, if/when needed
- **Activities planned by duration (2026-10-17, Epic 13; reviewed by Winston):** `DayPlanItem` carries `scheduleMode` (`FLEXIBLE` | `FIXED`), `durationMinutes` (≥ 5, stored for both modes and kept equal to `toTime − fromTime` for fixed ones by the repository) and `sortOrder`. Order is stored in `sortOrder`, not derived from `fromTime`; this reverses the 2026-10-10 decision. `sortOrder` is renumbered densely (0…n−1) per day inside every write's transaction; it has an index on `(tripDayId, sortOrder)` and no unique constraint, because the transaction guarantees consistency and SQLite would trip over a unique key during renumbering. `fromTime`/`toTime` are stored as the computed result of the pure `scheduleDay` rule and recomputed by the server on every write that can affect them, so every reader of times is unaffected. They stay nullable with one invariant: a `FIXED` activity always has both times; a `FLEXIBLE` activity has them exactly when it fits before 23:59, and null means *does not fit in the day* — a derived state, never entered, which every existing time reader (gantt, cards, import) already handles. Plan conflicts (late arrival at a fixed activity, overlapping fixed activities, flexible activities that do not fit) are derived on read by a pure function from the stored times, legs and the day start, and never stored. The migration is SQL-only: `ROW_NUMBER()` reproduces today's comparator order, durations are computed from the `HH:MM` strings, untimed rows (imports only) become `FLEXIBLE`/15 min appended after the day's last end without leg times; `scheduleDay` is idempotent and normalises such a day on its next write.
- **Activities without a day (2026-10-18, Epic 14; reviewed by Winston):** The bucket list is the set of a trip's `DayPlanItem` rows with `tripDayId = null` ("parked"); `TripBucketListItem` is migrated into it and dropped. Parking and scheduling change `tripDayId` (and the schedule columns) only, so images, documents and payments never move between tables and keep their ids.
  - *Columns:* `DayPlanItem.tripId` (not null, FK `trips.id`, `ON DELETE CASCADE`, relation `Trip.dayPlanItems`); `tripDayId` becomes nullable and keeps `ON DELETE CASCADE` (deleting a day still deletes its activities; it does not park them). Index `(tripId, tripDayId)` serves the bucket-list read. Invariant, also written as a SQL `CHECK` in the migration (Prisma cannot express it; the `cost_payments` one-target CHECK is the precedent): `trip_day_id IS NOT NULL OR (schedule_mode = 'FLEXIBLE' AND from_time IS NULL AND to_time IS NULL AND sort_order = 0)`. "No legs" needs no constraint, because a `TravelSegment` always has a `tripDayId` and every park path deletes the item's legs. `tripId` must equal `tripDay.tripId`; every write sets both, and a test guards it.
  - *Migration (one file, SQL-only):* SQLite cannot drop `NOT NULL`, so `day_plan_items` is rebuilt with the `20260301105118_add_travel_segments` pattern (`PRAGMA foreign_keys=OFF`, create `new_day_plan_items`, copy with `trip_id` taken from `trip_days`, drop, rename, recreate all three indexes plus the new one, `PRAGMA foreign_key_check`). Then each `trip_bucket_list_items` row is inserted as a parked activity with the **same id**, `FLEXIBLE`, 15 minutes, `sort_order` 0, title, `location_*`, stamps, and a `content_json` built with SQLite's `json_object`/`json_array` exactly as the client's `buildBucketListContentJson` (`TripDayView.tsx`) builds it (trimmed description; position text only when there are no coordinates; the title when both are empty). Then `trip_bucket_list_items` is dropped. The migration test compares every former bucket row with its new row, and the JSON byte for byte with the TS function.
  - *Readers:* every trip-level reader that exists today (cost totals and "Kosten bisher" incl. the dashboard's raw SQL aggregate, trip overview gantt and route, trip map, print, document packet, previous-day lookups, AI suggestion context) reaches activities **through the day** (`tripDay: { tripId }`, `trip.days[].dayPlanItems`, `JOIN trip_days`), so parked rows are excluded without a filter. Rule: day activities are read through the day; only bucket-list reads query `DayPlanItem.tripId`, and they always add `tripDayId: null`. Any future reader by `tripId` uses the shared predicates `plannedDayPlanItemsWhere(tripId)` / `parkedDayPlanItemsWhere(tripId)` in `dayPlanItemRepo.ts`. Readers that must **include** parked rows: backup export and import, the overwrite import's delete step (it deletes the trip's parked rows explicitly, as it deleted bucket rows), and the per-item gates (`findScopedDayPlanItem*`), which scope by `{ id, tripId }` and the item's own `tripDayId` (`null` for parked) instead of requiring a day.
  - *Media:* stored URLs are never rewritten (this already holds for items moved between days). Uploads go to the folder of the item's *current* place: `uploads/trips/<tripId>/days/<tripDayId>/day-plan-items/<itemId>/` on a day, `uploads/trips/<tripId>/parked/day-plan-items/<itemId>/` when parked (documents in `…/documents/` under either). The managed-file rule generalises `readStoredMediaDayId` into one helper that derives `allowedDir` from the stored URL: the URL's folder must be `days/<anyDayId>/day-plan-items/<thisItemId>[/documents]` or `parked/day-plan-items/<thisItemId>[/documents]` under this trip, and anything else is refused and logged. Image delete, document delete and the `suggestionsApplied` undo cleanup all use it (the undo no longer builds the folder from `receipt.tripDayId`). Deleting a parked activity has no undo, so it removes its files after commit by that rule; deleting a day activity still keeps them for undo (DW-187).
  - *Backup:* `FORMAT_VERSION` stays 2 (additive, per its own rule). The export writes parked activities as `trip.parkedDayPlanItems[]` in the day-item shape (with images, documents, payments, `scheduleMode`, `durationMinutes`) and no longer writes `bucketListItems`; the import still reads legacy `bucketListItems` and creates parked activities by the migration's rule, and writes parked media under `parked/`.

### Authentication & Security

- **Auth Model:** JWT stored in HTTP-only cookie (SameSite=Lax; Secure in prod)
- **Password Hashing:** bcrypt `6.0.0`
- **Authorization:** Role-based access (owner, viewer)
- **CSRF Protection:** Enabled for state-changing requests
- **Rate Limiting:** Basic limits on auth endpoints
- **JWT Library:** `jose` `6.1.0`
- **Connector auth (added 2026-10-29, Epic 15; reviewed by Winston against MCP authorization spec 2026-07-28 and Claude's connector docs).** TravelPlan is its own OAuth 2.1 authorization server for the MCP connector, built on the existing session; no third-party IdP. Off unless `MCP_ENABLED=true` (every connector endpoint then answers 404).
  - *Discovery:* `/.well-known/oauth-protected-resource` (RFC 9728) with `resource` exactly `<APP_BASE_URL>/api/mcp`, TravelPlan as the only authorization server, `scopes_supported` = the one trip scope (`trips`); `offline_access` appears only in the authorization-server metadata's `scopes_supported` (the spec says the resource metadata should not list it; Claude adds it when the AS lists it). `/.well-known/oauth-authorization-server` (RFC 8414): authorize, token, revocation endpoints; `code` only; `authorization_code` + `refresh_token`; `S256` only; `client_id_metadata_document_supported: true`; `token_endpoint_auth_methods_supported: ["none"]`; `authorization_response_iss_parameter_supported: true` (RFC 9207: `iss` on every authorization response); **no** `registration_endpoint`. An unauthenticated `/api/mcp` call answers 401 with `WWW-Authenticate: Bearer resource_metadata="…"` (Claude ignores the header on a 200). Nginx must pass `/.well-known/*` to the app.
  - *Clients:* Client ID Metadata Documents only (DCR is deprecated in the 2026-07-28 spec; it is a contingency behind its own switch if a Claude surface turns out not to use CIMD). `client_id` must be an `https` URL whose host is in `MCP_CLIENT_ID_HOSTS` (default `claude.ai`, Tommy 2026-10-29: Claude only for now), checked **before** any fetch. The document is fetched with the guarded fetcher (`src/lib/http/guardedFetch.ts`, see *Integration Points*), validated (`client_id` equals its URL, `redirect_uris` present), cached ≤ 24 h. Public clients only. `redirect_uri` must be listed in the document; loopback URIs (`localhost`, `127.0.0.1`) match port-agnostically (Claude Code). No client table: clients are identified by their URL. **Story 15.1 review (2026-10-29):** entries are `host` or `host/path-prefix`, normalised through `URL`, default `claude.ai/oauth/` (Tommy, D1), so a JSON file elsewhere on an allowed host cannot pose as a client; the document must be served as `application/json`; redirect URIs other than `https:` or loopback `http:` are dropped from it (a document left with none is invalid), and `assignLocation` follows only http(s) URLs as a second line. Fetches are single-flight, successes cached at least 60 s, failures 60 s, at most 30 fetches a minute per process.
  - *Flow:* authorization code + PKCE S256, resource indicator (RFC 8707) bound to the MCP resource. Sign-in reuses the normal login page and returns to the authorize step. The consent form is CSRF-protected, names the client, shows the redirect host, warns when the only redirects are loopback, and is required for every new authorization. Codes are single-use, 60 s, bound to client, redirect URI, challenge and resource; a reused code revokes what it issued. **Story 15.1 review:** a code is consumed only by a *successful* exchange; a failed attempt (wrong verifier, client, redirect or resource) leaves it usable for the rest of its 60 s, so a stolen code cannot lock out the real client (Tommy, D3). `/oauth/*` is sent with `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
  - *Tokens:* opaque random strings stored as SHA-256 hashes (`oauth_authorization_codes`, `oauth_tokens` with user, client id URL, scope, resource, family id, expiry, last used, revoked). Access 1 h, refresh 30 days, rotated on every use, the new one returned in the same response. A just-rotated refresh token presented again within 30 s gets `invalid_grant` without revocation (Claude refreshes proactively and may race itself); later reuse revokes the family. `/token` takes `application/x-www-form-urlencoded`, answers `invalid_grant` for every invalid grant, and must answer well under Claude's 10 s limit. Revoked by *Connected apps* (Story 15.3), RFC 7009 revocation, password change and reset (`passwordUpdate.ts`, `passwordReset.ts`), and account deletion (FK cascade). **Story 15.1 review:** a rotated refresh token presented again within 30 s gets a fresh sibling pair in the same family instead of `invalid_grant` (Tommy, D2); no pair is issued for a family with a revoked row, and revocation runs in a transaction so it cannot interleave with a rotation. Access tokens are capped at the family's end too. A failed grant transaction answers `server_error` (RFC shape, no-store).
  - *Boundaries:* bearer tokens are accepted only on `/api/mcp`; the session cookie is never accepted there. CSRF does not apply to bearer requests; it does to the consent form. No new secret: `JWT_SECRET` is not involved.

### API & Communication Patterns

- **API Style:** REST
- **Validation:** Zod schemas in API layer (`zod` `4.1.11`)
- **Error Format:** Standard `{ error: { code, message, details } }` envelope
- **Rate Limiting Scope:** Auth endpoints, plus a per-user daily limit on AI suggestion searches (Epic 12)
- **Day recalculation receipts (2026-10-10, Epic 11):** Writes that recalculate a day (day plan item create, update, delete, and in-day move; travel segment create and update; accommodation update when its check-out changes, which recalculates the *next* day) return their usual payload plus `receipt` (day plan item writes as `{ data: { item, receipt } }`), where `receipt` lists the rows the write changed as a side effect, with their prior state. `POST /api/trips/{id}/day-plan-changes/undo` applies a receipt in reverse in one transaction and refuses (409) if any row it names has changed since. Receipts are client-held and never persisted. Since 2026-10-17 (Epic 13), receipts are version 3 and include each moved row's previous `sortOrder` and the edited activity's previous mode and duration; delete and leg delete also recompute the day. Order is stored in `sortOrder` (see *Data Architecture*).
- **Parking and scheduling (2026-10-18, Epic 14; reviewed by Winston):** Receipts stay **version 3**: Stories 11.3, 11.4 and 12.4 added kinds without a bump, and the strict schema refuses any receipt that still carries the removed field, which the client already shows as "undo unavailable". Two kinds are added. `{ kind: "scheduled", itemId, updatedAt, previousUpdatedAt }` (14.1): `POST /api/trips/{id}/day-plan-items/schedule` with `{ itemId, tripDayId }` moves a parked activity onto the day, appended as `FLEXIBLE` with its duration, and recomputes the day in the same transaction; undo is refused as stale if the item's `updatedAt` changed or a leg now references it, and otherwise returns it to `tripDayId = null`, mode `FLEXIBLE`, times null, `sortOrder` 0 and its previous `updatedAt`, renumbering the day. `{ kind: "parked", itemId, updatedAt, previous: { tripDayId, scheduleMode, durationMinutes, sortOrder, fromTime, toTime, updatedAt } }` (14.2): `POST /api/trips/{id}/day-plan-items/park` with `{ itemId }` sets the activity to parked (a fixed one keeps `toTime − fromTime` as its duration), deletes its legs through the delete path's sweep into `removedTravelSegments`, and recomputes the day into `movedItems`; undo restores all of it. In both kinds the receipt's `tripDayId` is the day that was recomputed, so it is never null, and `DayPlanItemRow.tripDayId` stays a string, because a receipt only snapshots activities on a day. `consumedBucketListItem`, `TripBucketListItemRow` and `bucketListRowSchema` are removed, and the exhaustive `never` switches (`mapReceipt`, both undo phases) handle the new kinds. Parked activities are added, edited and deleted through `/api/trips/{id}/bucket-list-items`, which keeps its `refuseUnlessTripWriter` gate (owner and contributor; viewers 403). It now takes the activity payload without times, mode or day, and returns the activity. These writes recompute no day, so they return no receipt; delete keeps its confirmation dialog. Story 14.3: parked suggestions are listed in the `suggestionsApplied` receipt with the scheduled ones, and their media cleanup follows the URL-derived rule.
- **Outbound email (added 2026-10-21).** `src/lib/notifications/email.ts` is the only mail sender: SMTP via `nodemailer` in production (Story 8.8), in-memory outbox elsewhere. Messages are plain text, optionally with an `html` alternative and `attachments`. The recipient of user-triggered mail is always the session's own address (Story 9.3). The reset route does not await the send (no timing signal); the day-email route awaits it so the UI can report the result.
- **MCP endpoint (added 2026-10-29, Epic 15; reviewed by Winston).** `POST /api/mcp`, Streamable HTTP, stateless, JSON responses (no SSE, no session id); `GET` answers 405; body limit 2 MB via `bodyLimit.ts`. `@modelcontextprotocol/server` (the SDK's v2 line; v1 `@modelcontextprotocol/sdk` will not support 2026-07-28) pinned exactly at Story 15.1 (2.4.0 at the time of writing): `createMcpHandler` with `responseMode: 'json'` and the default `legacy: 'stateless'`, so 2026-07-28 and 2025-era clients are both served; `requireBearerAuth` with our own verifier. Tools live in `src/lib/mcp/tools/*`, one file per area, and are thin adapters like route handlers: they call repositories and services only. Per call: token → user, then `getTripAccessForUser` + `canTripAccessRoleWrite` per trip; not writable answers *not found*. Inputs are Zod-validated, reusing route schemas where shapes match. Rich text arrives as plain text or simple Markdown and is converted to the editor's JSON by one shared function. Per-user rate limit via `rateLimit.ts` (in-memory is fine: one process). Logs: tool, user, trip, outcome, duration, never arguments. **Story 15.1 implementation:** the SDK's built-in 2025-era fallback answers with SSE, so the route classifies with the SDK's `isLegacyRequest` and serves 2025-era traffic through a per-request `WebStandardStreamableHTTPServerTransport` with `enableJsonResponse`, and 2026-07-28 traffic through `createMcpHandler({ legacy: 'reject', responseMode: 'json' })`; the 2 MB limit is the SDK's `maxRequestBodySize` on both legs plus a declared-length check. A request without `Authorization` gets the challenge without an error code (RFC 6750 §3.1). **Signed file links (Story 15.8):** the read tools give each image and document a `downloadUrl` on the public route `GET /f/{fileId}?w=&exp=&sig=`, whose HMAC-SHA256 signature over id, width and expiry (`FILE_LINK_SECRET`, TTL `FILE_LINK_TTL_SECONDS`, default 15 minutes) is the whole grant: no session, no token, outside the proxy matcher, rate-limited per IP; images are re-encoded with sharp at the signed width with all metadata stripped, PDFs are streamed unchanged. The path ends in the served extension (`/f/{fileId}.jpg|.webp|.pdf`), cosmetic and unsigned, because some download tools refuse a URL without one.
- **Write origin and provenance (added 2026-10-29, Epic 15; reviewed by Winston).** Nullable `ai_changed_at` on `day_plan_items`, `accommodations`, `travel_segments`, the document tables and the image tables. Every repository write function takes a **required** `origin: "user" | "ai"` parameter with no default, so the compiler finds every caller: `"ai"` sets `ai_changed_at` on the rows the write *targets* (created or edited), `"user"` clears it; rows only shifted by the FR42 recompute keep their state. `aiChangedAt` is part of the receipt row snapshots, so undo restores it; client-held receipts issued before that deploy fail the strict parse and show "undo unavailable" (accepted, as in Epic 14). Not exported in backups: transient trust information, not trip content. `trip_days.ai_changed_at` added 2026-10-31 (Story 15.9) with the same semantics, for the day's note and picture. Route reads (`get_trip_route`, Story 15.10) never call OSRM: the path connects stored stop positions.
- **Stored AI changes (added 2026-10-29, Epic 15; reviewed by Winston).** Receipts of UI writes stay client-held and HMAC-signed to trip **and user**. Connector writes store theirs in `ai_changes` (trip, nullable day, user, client id URL, summary, receipt v3 JSON nullable, `createdAt`, `undoneAt`), inserted **in the write's own transaction** (repository writes accept the transaction or an in-transaction hook). Stored receipts are trusted and unsigned. The undo logic is extracted from `day-plan-changes/undo/route.ts` into one core used by that route (signed, client-held), by `POST /api/trips/{id}/ai-changes/{changeId}/undo` (any trip writer, not only the connecting user) and by the `undo_ai_change` tool; the 409 stale rule is unchanged. Optimistic `updatedAt` checks are made inside the transaction. Rows older than 14 days are deleted on write; files kept for a `fileDeleted` undo are removed then.
  - *Receipt kinds (additive, still version 3, as in Epic 14):* activities use the existing kinds. New: `dayPlanApplied` (Story 15.5: created items and legs, plus deleted items and legs as full snapshots in `replace` mode; generalises `suggestionsApplied`), `stayCreated`, `stayUpdated` (full previous row with payments), `stayDeleted` (with images and documents) (15.6), `fileAttached`, `fileDeleted` (15.7). Writes the app cannot undo either (edits of parked activities through the bucket-list path) store no receipt and are listed without *Rückgängig* (Tommy, 2026-10-29: undo parity with the app). Exhaustive `never` switches cover the new kinds.

### Frontend Architecture

- **State Management:** Redux Toolkit `2.11.2`
- **Data Fetching:** Next.js Server Components + `fetch`
- **Forms:** React Hook Form `7.71.1` (v8 beta noted)
- **Rich Text Editor:** TipTap 3 (stable)

### Infrastructure & Deployment

- **Hosting Target:** Debian-based server (Debian 13 "trixie")
- **Reverse Proxy / TLS:** Nginx
- **Runtime:** Node.js LTS (v24 "Krypton")
- **Process Manager:** systemd
- **CI/CD:** none initially
- **Logging/Monitoring:** basic logs only

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Next.js + TypeScript starter (create-next-app)
- SQLite file database with Prisma Migrate
- Auth model: JWT in HTTP-only cookies with bcrypt
- REST API + Zod validation
- Debian self-host + Nginx TLS + Node LTS

**Important Decisions (Shape Architecture):**
- Role-based authorization (owner/viewer)
- Redux Toolkit for state management
- Server Components + fetch data strategy
- TipTap for rich text
- systemd process management

**Deferred Decisions (Post-MVP):**
- Litestream for continuous backup/replication
- Broader rate limiting or monitoring stack
- Map routing integration (Google) beyond core MVP

### Decision Impact Analysis

**Implementation Sequence:**
1. Initialize Next.js project (TypeScript/App Router)
2. Configure Prisma + SQLite and apply migrations
3. Implement auth (JWT + bcrypt + cookie handling + CSRF)
4. Build REST API endpoints with Zod validation
5. Implement core UI flows (Redux state + forms + rich text)
6. Deploy on Debian with Nginx + systemd

**Cross-Component Dependencies:**
- Auth decisions affect API and frontend session handling.
- Data model decisions affect API shape and UI editing flows.
- Hosting/runtime choices influence build and deployment scripts.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 6 areas where AI agents could make different choices

### Naming Patterns

**Database Naming Conventions:**
- Tables: `snake_case` plural (e.g., `trip_days`)
- Columns: `snake_case` (e.g., `trip_id`)
- Foreign keys: `snake_case` with `_id` suffix (e.g., `user_id`)
- Indexes: `idx_<table>_<column>` (e.g., `idx_trip_days_trip_id`)

**API Naming Conventions:**
- Endpoints: plural nouns (e.g., `/api/trips`, `/api/trips/:id/days`)
- Route params: `:id`
- Query params: `camelCase` (e.g., `tripId`)
- Headers: `X-Request-Id`, `X-Trace-Id` (capitalized words, hyphenated)

**Code Naming Conventions:**
- Components: `PascalCase` (e.g., `TripDayCard`)
- Files: `PascalCase.tsx` for components
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

### Structure Patterns

**Project Organization:**
- App Router routes under `app/`
- API handlers under `app/api/**/route.ts`
- Server actions under `app/_actions/`
- UI components under `components/`
- Shared utilities under `lib/`
- Data access under `lib/db/` and `lib/repositories/`

**File Structure Patterns:**
- Prisma schema: `prisma/schema.prisma`
- Static assets: `public/`
- Tests: co-located as `*.test.ts(x)`

### Format Patterns

**API Response Formats:**
- Success: `{ data: <payload>, error: null }`
- Error: `{ data: null, error: { code, message, details } }`

**Data Exchange Formats:**
- JSON field naming: `camelCase`
- Dates: ISO 8601 strings in UTC
- Booleans: true/false

### Communication Patterns

**Event System Patterns:**
- No async event system in MVP

**State Management Patterns:**
- Redux slices by feature (e.g., `tripSlice`)
- Action naming: `feature/action`
- Selectors in `lib/selectors/featureSelectors.ts`

### Process Patterns

**Error Handling Patterns:**
- Central error mapper in API layer
- Consistent `code` values (e.g., `AUTH_INVALID`, `NOT_FOUND`, `VALIDATION_ERROR`)

**Loading State Patterns:**
- Use `isLoading`, `isSaving`, `isDeleting`
- Clear error on new request start

### Enforcement Guidelines

**All AI Agents MUST:**
- Use `snake_case` for DB and `camelCase` for API JSON
- Return API responses using the `{ data, error }` envelope
- Store dates as ISO 8601 UTC strings

**Pattern Enforcement:**
- Reject PRs that violate naming and response formats
- Update this section when patterns evolve

### Pattern Examples

**Good Examples:**
- Table: `trip_days` with column `trip_id`
- API: `GET /api/trips/:id/days` returns `{ data: [...], error: null }`

**Anti-Patterns:**
- Mixed `camelCase` columns in DB
- Returning raw payloads without `{ data, error }`

## Project Structure & Boundaries

### Complete Project Directory Structure
```
travelplan/
├── README.md
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.example
├── .env.local
├── .gitignore
├── public/
│   └── assets/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts
│   │   │   │   ├── logout/route.ts
│   │   │   │   └── register/route.ts
│   │   │   ├── trips/route.ts
│   │   │   ├── trips/[id]/route.ts
│   │   │   ├── trips/[id]/days/route.ts
│   │   │   ├── trips/[id]/accommodations/route.ts
│   │   │   └── trips/[id]/export/route.ts
│   │   ├── (routes)/
│   │   │   ├── trips/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   └── auth/
│   │   │       ├── login/page.tsx
│   │   │       └── register/page.tsx
│   │   └── _actions/
│   │       ├── auth.ts
│   │       ├── trips.ts
│   │       ├── days.ts
│   │       └── accommodations.ts
│   ├── components/
│   │   ├── ui/
│   │   ├── forms/
│   │   └── features/
│   │       ├── trips/
│   │       ├── days/
│   │       └── accommodations/
│   ├── lib/
│   │   ├── db/
│   │   │   └── prisma.ts
│   │   ├── repositories/
│   │   │   ├── tripRepo.ts
│   │   │   ├── dayRepo.ts
│   │   │   └── accommodationRepo.ts
│   │   ├── auth/
│   │   │   ├── jwt.ts
│   │   │   ├── bcrypt.ts
│   │   │   └── session.ts
│   │   ├── validation/
│   │   │   ├── authSchemas.ts
│   │   │   ├── tripSchemas.ts
│   │   │   └── daySchemas.ts
│   │   ├── errors/
│   │   │   └── apiError.ts
│   │   ├── http/
│   │   │   └── response.ts
│   │   └── utils/
│   ├── store/
│   │   ├── store.ts
│   │   └── slices/
│   │       ├── tripSlice.ts
│   │       └── uiSlice.ts
│   ├── proxy.ts
│   └── types/
└── tests/
    ├── api/
    ├── components/
    └── e2e/
```

### Architectural Boundaries

**API Boundaries:**
- `/app/api/**/route.ts` is the only public API surface.
- Auth routes are isolated under `/app/api/auth/*`.
- Trip/day/accommodation resources are separate endpoints.

**Component Boundaries:**
- Feature components live under `components/features/*`.
- UI primitives live under `components/ui/*`.
- Forms are in `components/forms/*`.

**Service Boundaries:**
- Data access only via `lib/repositories/*`.
- Prisma client only in `lib/db/prisma.ts`.

**Data Boundaries:**
- Prisma schema is the single source of truth for DB structure.
- Validation happens in `lib/validation/*` with Zod.

### Requirements to Structure Mapping

**Feature/FR Mapping:**
- **User Access & Accounts (FR1-FR3)**
  - Routes: `src/app/api/auth/*`
  - UI: `src/app/(routes)/auth/*`
  - Auth logic: `src/lib/auth/*`

- **Trip Management (FR4-FR8)**
  - API: `src/app/api/trips/*`
  - UI: `src/app/(routes)/trips/*`
  - Data: `src/lib/repositories/tripRepo.ts`

- **Day-by-Day Planning (FR9-FR11)**
  - API: `src/app/api/trips/[id]/days/*`
  - UI: `src/components/features/days/*`
  - Data: `src/lib/repositories/dayRepo.ts`

- **Accommodation Planning (FR12-FR16)**
  - API: `src/app/api/trips/[id]/accommodations/*`
  - UI: `src/components/features/accommodations/*`
  - Data: `src/lib/repositories/accommodationRepo.ts`

- **Day Plans (FR17-FR20)**
  - UI: `src/components/features/days/*`
  - Rich text: TipTap components inside day feature

- **Budget Awareness (FR21)**
  - Aggregation: `tripRepo.ts` and API responses
  - UI: `components/features/trips/*`

- **Viewer/Light Contributor (FR22-FR24)**
  - Auth roles: `src/lib/auth/*`
  - API guards: `src/proxy.ts`

- **Data Safety (FR25)**
  - Export route: `src/app/api/trips/[id]/export/route.ts`

### Integration Points

**Internal Communication:**
- UI -> Server actions in `app/_actions/*`
- UI -> API via REST endpoints using `fetch`

**External Integrations:**
- Maps (future): `components/features/trips/` and `components/features/days/`
- Routing (future): server integration in `lib/services/maps.ts`
- Exchange rates: ECB `eurofxref-daily.xml`, reached through the session-gated proxy at `app/api/exchange-rates/route.ts` and cached in-process. Keyless and EUR-based; adds no dependency, no secret and no deployment step. Failure is non-blocking — the cost field degrades to plain EUR entry. See FR41 and Sprint Change Proposal 2026-09-20.
- AI suggestions (2026-10-16, Epic 12): Anthropic Claude via `@anthropic-ai/sdk`, called only from the server (`lib/ai/`). Key in `ANTHROPIC_API_KEY`, model in `ANTHROPIC_MODEL`; absent key = feature off. Structured output validated with Zod; server-side web search tool enabled (max 5 per request); coordinates re-verified via Nominatim. Paid per call by the operator; per-user daily limit `AI_SUGGESTIONS_DAILY_LIMIT` (in-memory). See FR44–FR45
- Wikimedia (Wikipedia page images, Commons geosearch): keyless image lookup for suggestions; images copied into media storage on apply (no attribution kept — private app)
- MCP connector (2026-10-29, Epic 15): inbound, from Anthropic's egress range (`160.79.104.0/21`) and from users' machines (Claude Code). External assistants call `/api/mcp` with user-granted OAuth tokens. Independent of the Epic 12 provider key; the operator pays nothing for it.
- Guarded outbound fetch (2026-10-29, Epic 15): `src/lib/http/guardedFetch.ts`, built in Story 15.1 for client metadata documents and reused by upload-by-URL (Story 15.7). `https` on port 443 only; the resolved address must be public (no loopback, private, link-local, unique-local `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6 or other special-use ranges), checked after DNS and on every redirect (≤ 3), with the checked IP pinned for the connection (no DNS rebinding); size cap per caller (64 KB metadata, 10 MB files), 15 s, no cookies or credentials. File types are decided by magic bytes, not by name or header.

**Data Flow:**
- UI submits -> server action / API -> repository -> Prisma -> SQLite

### File Organization Patterns

**Configuration Files:**
- `.env.local` for local secrets; `.env.example` for templates

**Source Organization:**
- Feature-based UI + centralized `lib/*` services

**Test Organization:**
- Unit tests co-located or under `tests/` by category
- E2E tests in `tests/e2e/`

**Asset Organization:**
- Static assets under `public/assets`

### Development Workflow Integration

**Development Server Structure:**
- Next dev server uses App Router and API routes in `src/app`

**Build Process Structure:**
- Next build outputs `.next/` and bundles API routes

**Deployment Structure:**
- systemd manages Node process; Nginx terminates TLS and proxies to Next

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are compatible: Next.js + TypeScript + Prisma + SQLite + REST + JWT + Redux. Versions align and do not conflict.

**Pattern Consistency:**
Naming, response formats, and validation rules are consistent with the stack and prevent agent divergence.

**Structure Alignment:**
Project structure supports App Router, API routes, Prisma, and feature-based UI organization.

### Requirements Coverage Validation ✅

**Epic/Feature Coverage:**
No epics provided; FR categories are fully mapped to routes, components, and repositories.

**Functional Requirements Coverage:**
All FRs (accounts, trips, days, accommodations, plans, budget, viewer role, backup/export) are supported by the architecture and file structure.

**Non-Functional Requirements Coverage:**
- Performance: trip load target set to 15 seconds (resolved)
- Security: auth, role-based access, CSRF, rate limiting
- Reliability: backup/export path defined
- Compliance: GDPR accounted for in access patterns

### Implementation Readiness Validation ✅

**Decision Completeness:**
Critical decisions documented with versions and rationale.

**Structure Completeness:**
Full project tree defined with clear boundaries.

**Pattern Completeness:**
Naming, formats, error handling, and loading states are defined.

### Gap Analysis Results

**Critical Gaps:** None  
**Important Gaps:** None  
**Nice-to-Have Gaps:** Optional Litestream backup and expanded monitoring stack (deferred)

### Validation Issues Addressed

- Resolved performance target conflict: **15 seconds** is the authoritative requirement.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION  
**Confidence Level:** High

**Key Strengths:**
- Coherent, minimal stack aligned to requirements
- Clear boundaries and naming rules for AI agent consistency
- Full mapping of requirements to structure

**Areas for Future Enhancement:**
- Add Litestream for automated SQLite backup/replication
- Expand monitoring/alerting if the app scales beyond personal use

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
Initialize the Next.js project with `create-next-app` and apply the Prisma + SQLite setup.
