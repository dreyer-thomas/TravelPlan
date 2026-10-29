# Epic 15 Context: Plan with Claude — the TravelPlan Connector

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a user connect Claude to TravelPlan once (OAuth sign-in plus consent, never sharing the password). From then on the assistant reads the trips the user may plan and writes activities, whole day plans, stays, legs, costs, links and files straight into them. Nobody copies plans over by hand any more. Every connector change is visibly marked KI/AI and can be undone from the app or by the assistant, so the user can let it work and still trust the plan.

## Stories

- Story 15.1: Add TravelPlan to Claude
- Story 15.2: Claude Knows the Trip
- Story 15.3: Connected Apps
- Story 15.4: Claude Plans Activities, Marked and Undoable
- Story 15.5: Take Over the Day Plan
- Story 15.6: Stays, Legs, Costs and Links
- Story 15.7: Documents and Images

## Requirements & Constraints

- **Access:** only trips where the user is owner or contributor exist for the connector. A viewer-only trip, or one that does not exist, answers *not found*, never *forbidden*, in every tool, so no existence leak. The connector never grants more than the user's own rights.
- **Scope of control:** the connector has full control over trip content: activities (create/update/delete/reorder/move day/park/schedule), stays, legs, costs, links, documents and images. It may never create, rename, re-date or delete a trip, change the budget, or manage members.
- **Same rules as the app:** day recompute, fixed/flexible scheduling, warnings, and foreign-currency conversion at the ECB rate behave exactly as in the UI. Over-full plans are saved anyway and return the warnings.
- **Provenance:** entries the connector creates or edits show a "KI" (de) / "AI" (en) badge. It is generic and never names Claude. The badge disappears once a person edits the entry in the app.
- **Undo:** each connector change can be undone in one step from the app (by any trip writer) or by the assistant, unless something it touched has changed since (stale → refused). Undo is available for 14 days. Writes the app cannot undo either have no receipt and are listed without undo.
- **Tokens:** access tokens are short-lived and audience-bound, refresh tokens rotate, and both are stored only as hashes. They are revoked by the user (*Connected apps*), by password change or reset, and by account deletion.
- **Tool conventions:** descriptions are in English, written for the model, and name their units (minutes, EUR cents vs amount, `HH:MM`, ISO dates). Errors are short, actionable MCP tool errors with no internal details. Every call is logged with tool, user, trip, outcome and duration, never its argument contents. The rate limit is 120 calls/min per user and 20 uploads/hour.
- **Optimistic concurrency:** read tools return `updatedAt`. Update and delete tools accept it and refuse with "changed since you read it" on a mismatch.
- **Files:** only PDF, JPEG, PNG and WebP are accepted, judged by content (magic bytes). Inline uploads may be at most 1 MB decoded, URL uploads and downloads up to 10 MB. The limit of 10 documents per entry and the app's file-name sanitisation apply. Uploaded files land where the day packet and the day email find them.
- All new UI strings go into both `en.ts` and `de.ts`.
- Epic 12 (AI suggestions) is unchanged. The connector is purely additive and independent of the provider key.

## Technical Decisions

- **Feature switch:** with `MCP_ENABLED` not `true`, every connector endpoint (well-known metadata, authorize, consent, token, revoke, `/api/mcp`) answers 404.
- **Own OAuth 2.1 authorization server** on top of the existing session, with no third-party IdP:
  - Discovery: RFC 9728 protected-resource metadata (resource exactly `<APP_BASE_URL>/api/mcp`, scope `trips`) and RFC 8414 AS metadata (code + PKCE S256 only, `iss` on responses, no `registration_endpoint`, `offline_access` only in the AS metadata).
  - Clients: Client ID Metadata Documents only. The client host or path prefix must be allowlisted in `MCP_CLIENT_ID_HOSTS` (default `claude.ai/oauth/`), checked before any fetch. Loopback redirects match regardless of port.
  - Codes: single-use, 60 s, bound to client, redirect, challenge and resource. A code is consumed only by a successful exchange.
  - Tokens: opaque, stored as SHA-256 in `oauth_tokens`. Access tokens live 1 h, refresh tokens 30 days and rotate. Reuse within 30 s gets a sibling pair; later reuse revokes the token family.
  - `/oauth/*` pages cannot be framed.
- **Boundaries:** bearer tokens work only on `/api/mcp`, and the session cookie is never accepted there. CSRF applies to the consent form, not to bearer calls.
- **MCP endpoint:** `POST /api/mcp`, Streamable HTTP, stateless, JSON-only responses. `GET` answers 405, and bodies are capped at 2 MB. It uses `@modelcontextprotocol/server` (v2 line, pinned exactly) and serves both the 2026-07-28 protocol and 2025-era clients.
- **Tools:** tools live in `src/lib/mcp/tools/*`, one file per area. They are thin adapters: they call repositories and services (`dayPlanItemRepo`, accommodation, travel-segment, document and image repos, `scheduleDay`, park/schedule) and never Prisma directly. All go through the shared `runTool` wrapper (bearer user, rate limit, log line, generic error). Inputs are Zod-validated, reusing route schemas where shapes match. Plain text or simple Markdown becomes editor rich-text JSON through one shared converter; the reverse uses `tiptapDocToPlainText`. A place given by name only is geocoded through the existing geocoder.
- **Write origin:** every repository write function takes a required `origin: "user" | "ai"` with no default. `"ai"` sets `aiChangedAt` on targeted rows and `"user"` clears it. Rows only shifted by the recompute keep their state.
- **Provenance column:** a nullable `aiChangedAt` on activities, stays, legs, documents and images. It is part of receipt row snapshots, so undo restores it. It is not exported in backups. Client-held receipts issued before the deploy fail the strict parse and show "undo unavailable".
- **Stored AI changes:** a table `ai_changes` (trip, nullable day, user, client id URL, one-line summary, nullable receipt v3 JSON, `createdAt`, `undoneAt`). Rows are inserted in the write's own transaction, and `updatedAt` checks also run inside it. Stored receipts are trusted and unsigned; UI receipts stay client-held and HMAC-signed.
- **Undo core:** the undo core is extracted from `day-plan-changes/undo` and shared by three callers: that route, `POST /api/trips/{id}/ai-changes/{changeId}/undo`, and the `undo_ai_change` tool. The 409 stale rule is unchanged. Rows older than 14 days are deleted on write, along with any files kept for a `fileDeleted` undo.
- **Receipt kinds:** these are additive and stay at version 3, and exhaustive `never` switches must cover them. New kinds: `dayPlanApplied` (15.5), `stayCreated`/`stayUpdated`/`stayDeleted` (15.6) and `fileAttached`/`fileDeleted` (15.7).
- **Guarded fetcher:** `src/lib/http/guardedFetch.ts` serves both client metadata and upload by URL:
  - `https` on port 443 only
  - only public IPs, checked after DNS and on every redirect (at most 3), with the IP pinned for the connection
  - 15 s timeout, a size cap per caller, and no cookies or credentials.

## UX & Interaction Patterns

- **Consent screen:** shown in the UI language. It names the client and its redirect host and says what the client may do, with *Erlauben* / *Ablehnen*. It adds a warning when the only redirects are loopback, and a fresh consent is required for every authorization.
- **Connected apps** (*Verbundene Apps*, account page): lists each connection's client name, redirect host, connected since and last used, with a confirmed *Trennen* / *Disconnect* on each. When there are no connections, the section shows one line with how-to text and the connector URL to copy.
- **Badge:** a small *KI*/*AI* badge appears on marked entries in the day timeline, the bucket list and the dialogs.
- **Day view notice:** "KI hat diesen Tag geändert" / "AI changed this day" lists the changes not yet undone (newest first, summary plus time), with *Rückgängig* / *Undo* on each. On a stale change it explains that the day has changed since.

## Cross-Story Dependencies

- 15.1 is the foundation (OAuth, endpoint, `runTool`, guarded fetcher). 15.2 adds the read tools and the `updatedAt` values that later write tools check.
- 15.3 (revocation) must land before any write tool.
- 15.4 depends on 15.2 and 15.3. It introduces the `origin` parameter, `aiChangedAt`, `ai_changes`, the undo core and the badge and notice UI, which 15.5, 15.6 and 15.7 all build on.
- 15.7 reuses the 15.1 guarded fetcher, and the packet and day-email features must pick up uploaded documents.
- Production steps (Nginx passing `/.well-known/*`, connector acceptance in Claude) are manual and done by Tommy.
