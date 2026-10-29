# Sprint Change Proposal — 2026-10-29 (Plan with Claude: an MCP Connector)

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Mode:** Batch
**Status:** Approved by Tommy 2026-10-29, including all points marked **[default]**. Edits 4.1–4.3, 4.6 and 4.7 applied; 4.5 (architecture) goes to Winston for review and is applied by him; 4.8 (deploy files) ships with Story 15.1.
**Scope classification:** Major (new subsystem: an OAuth authorization server, a public MCP endpoint and server-held AI change history). It is purely additive: no existing behaviour changes for people using the app. Architect review (Winston) is needed before Stories 15.1 and 15.4 are contexted.

---

## 1. Issue Summary

Tommy and Konni plan stages and days in conversation with Claude. The result then has to be **typed into TravelPlan by hand**, activity by activity: title, duration, place, link, cost and documents. The AI suggestions of Epic 12 help inside the app, but they cannot replace a full conversation with an assistant that already knows the trip, the wishes and the research.

**Change:** TravelPlan gets a remote **MCP server** that people add to Claude (claude.ai web, desktop, mobile, Claude Code) as a custom connector. When the connector is added, Claude opens TravelPlan's sign-in page. The user signs in, confirms the connection, and Claude holds an OAuth token. The assistant can then read the trips the user may plan and write to them directly.

Category: *new requirement* from the product owner. TravelPlan is already publicly reachable over HTTPS (`https://plan.dreyer-travels.de`), which a remote connector needs.

**Rulings (Tommy, 2026-10-29):**

| # | Question | Ruling |
|---|---|---|
| R1 | Who may use it? | Only people who may **edit** a trip. Access is per trip (`canTripAccessRoleWrite`: owner or contributor). Trips where the user is only a viewer are **invisible** to the connector. Reading alone stays in the app. |
| R2 | What may it change? | Full control over the **content** of a trip: create, change, delete, move, park and schedule activities; stays, travel legs, costs, links, documents, images. |
| R3 | Traceability | Changes made through the connector carry a marker, **"KI" in German and "AI" in English**. It is generic and does not name Claude. |
| R4 | When does the marker go? | As soon as a **person** changes the entry in the app. |
| R5 | Undo | AI changes can be undone like UI edits. |
| R6 | Documents | Read (download) **and** upload are in scope, by **both** routes: inline (small files) and by URL. |
| R7 | Trips themselves | **No** trip creation. The admin creates trips and grants rights. Trip name, dates, budget, deletion and members stay read-only for the connector. |
| R8 | Epic 12 | Unchanged. This is purely additive. |

**Evidence / starting point (from the code, 2026-10-29):**

- **Auth:** custom JWT in an HTTP-only `session` cookie (`jose`, bcrypt), CSRF on mutating routes. There is **no** OAuth server, **no** bearer-token path and **no** MCP dependency.
- **Access:** `src/lib/auth/tripAccessRole.ts`: `TripAccessRole = owner | contributor | viewer`, with `canTripAccessRoleWrite` = owner or contributor. Every write route already uses the same gate (for example `refuseUnlessTripWriter`).
- **Undo receipts are client-held:** *"Receipts are client-held and never persisted"* (architecture, API & Communication Patterns). An edit made through the connector therefore produces a receipt that nobody in the app holds. **R5 cannot be met without storing receipts on the server.**
- **No provenance:** no model has a "changed by" field (`DayPlanItem` has only `createdAt`/`updatedAt`). **R3 needs a schema migration.**
- **Uploads:** documents are PDF, JPEG, PNG or WebP (`DOCUMENT_UPLOAD_ACCEPT`), at most 10 per entry (`MAX_DOCUMENTS_PER_ENTRY`), streamed to disk by `multipartToDisk`. An MCP tool receives JSON only, so an inline file must be base64 inside the tool call. That is workable for small files and impractical for a 2 MB boarding pass, which is why R6 adds upload by URL.
- **Domain logic to reuse:** `dayPlanItemRepo.ts` with `scheduleDay` (FR42, Epic 11/13), park/schedule (Epic 14), receipts v3, `rateLimit.ts`, the geocoder proxy and route preview (OSRM).

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| **Epic 15 (new): Plan with Claude — the TravelPlan Connector** | Seven stories, 15.1–15.7. Status `backlog`. |
| Epic 11 / 13 / 14 | No behaviour change. Their write paths are **called** by the connector rather than duplicated. Receipts v3 get one additive consumer (server-stored AI changes). |
| Epic 12 | None (R8). The AI suggestions keep their own key, limit and UI. |
| Epic 9 | None. The connector reuses the document storage, limits and media rules. |
| Epic 1 | Account page gains *Verbundene Apps / Connected apps* (Story 15.3). A password change also revokes connector tokens. |
| Others | None. No epic becomes obsolete, and no resequencing of running work. |

### Artifact impact

| Artifact | Change |
|---|---|
| PRD | FR52–FR57, NFR5, a new *Integration Requirements* line, a GDPR note and a changelog entry (4.1). |
| `epics.md` | FR52–FR57 and NFR14 in the inventory, the coverage map, an Epic 15 entry in the Epic List, and the Epic 15 section with seven stories (4.2–4.4). |
| Architecture | New section *Connector (MCP + OAuth)*: endpoints, token model, tool layer, provenance columns, stored AI changes, upload by URL, new dependency (4.5). |
| UX | KI/AI badge; an *AI changes* notice on the day with *Rückgängig*; a consent screen; a *Connected apps* list (4.6). |
| `sprint-status.yaml` | `epic-15` plus seven story entries (4.7). |
| Deployment | No new secret **[default: tokens are random and stored hashed; `APP_BASE_URL` is the issuer]**. One new optional variable, `MCP_ENABLED` (absent = connector off). Nginx: the MCP endpoint answers plain JSON (stateless Streamable HTTP), so no SSE or proxy-buffering change is needed **[default]**. `deploy/travelplan.env.example` and `deploy/README.md` get updated. |

### Technical impact

- **New dependency:** `@modelcontextprotocol/sdk` (TypeScript), pinned exactly like `next` (Story 8.9 practice). The OAuth server is built in-house on `jose` and the existing session, not with a third-party IdP. This matches the architecture's *custom auth* decision.
- **Schema:** new tables for OAuth clients, authorization codes, tokens and AI changes; new nullable provenance columns on activities, stays, travel legs, documents and images. Additive migrations only.
- **Security surface:** the first bearer-token API and the first public client-registration endpoint, plus a server that fetches URLs on user request (upload by URL means an SSRF surface). Every story touching these gets the full three-layer code review.
- **Load:** negligible. Two users, plus the assistant's tool calls. A per-user rate limit protects against a runaway agent loop.
- **Privacy:** trip content leaves the server **to the assistant the user chose and authorised**, under that user's own account with the provider. The operator pays nothing and holds no provider key for this. The PRD records this (4.1).

---

## 3. Recommended Approach

**Direct adjustment: add Epic 15.** There is no rollback and no MVP change. The order de-risks from the outside in:

1. **15.1:** prove that the connector can be added in claude.ai and that sign-in yields a working token, with one harmless tool. This tests the riskiest assumption first (Claude ↔ our OAuth).
2. **15.2:** read-only tools. Useful on their own: Claude can plan *knowing* the trip.
3. **15.3:** connections visible and revocable *before* anything can write.
4. **15.4:** the write foundation (marker + stored, undoable AI changes) together with the first write tools for activities.
5. **15.5:** *apply a day plan* in one call. This is the user's actual workflow.
6. **15.6:** stays, travel legs, costs, links.
7. **15.7:** documents and images: download, upload inline and by URL.

- **Effort:** high in total (comparable to Epic 13). By story: 15.1 high, 15.2 medium, 15.3 low–medium, 15.4 high, 15.5 medium, 15.6 medium, 15.7 medium–high.
- **Risk:** medium. The main risks:
  - (a) OAuth details that Claude's connector expects. Mitigated by 15.1 going first and by its production acceptance in claude.ai.
  - (b) An agent writing around the day-recalculation rules. Mitigated: tools call the existing repositories, never Prisma directly.
  - (c) SSRF on upload by URL. Mitigated by the guard rules in 15.7.
- **Alternatives considered:**
  - A personal API token pasted into the client. Rejected: Tommy asked for a sign-in flow, and claude.ai custom connectors expect OAuth.
  - Exposing the existing REST API to the agent. Rejected: cookie and CSRF based, too fine-grained, and receipts would still be lost.
  - A local stdio MCP server. Rejected: it works only on one machine and not in claude.ai or on the phone.

---

## 4. Detailed Change Proposals

### 4.1 PRD (`prd.md`)

**Frontmatter `lastEdited`:** `'2026-10-17'` → `'2026-10-29'`

**Changelog (frontmatter `editHistory`), append:**
```
  - date: '2026-10-29'
    changes: 'Added FR52-FR57 (connect an AI assistant through an MCP connector with OAuth sign-in; it reads and writes the trips the user may plan; changes are marked KI/AI and can be undone in the app) and NFR5 (connector tokens). Added an Integration Requirements line and a GDPR note. See Sprint Change Proposal 2026-10-29 (MCP Connector).'
```

**Section *Integration Requirements*, append:**
```
- MCP connector (Model Context Protocol, remote, OAuth 2.1) through which a user connects an AI assistant of their choice (for example Claude) to their own account. The assistant reads and writes the trips the user may plan, under that user's rights. Trip content goes to the provider the user authorised, under the user's own account there; the operator holds no provider key for this and pays nothing. **(Added 2026-10-29)**
```

**Section *Compliance & Regulatory (GDPR)*, append:**
```
- Users see every assistant connected to their account and can revoke it at any time; revoking stops all further access immediately. **(Added 2026-10-29)**
```

**New section after *AI Day Suggestions*:**
```
### Planning with an AI Assistant (Connector)

- FR52: Users can connect an AI assistant to their account by adding TravelPlan as a connector in the assistant, signing in to TravelPlan and confirming the connection. Users can see their connected assistants and revoke each one. **(Added 2026-10-29)**
- FR53: A connected assistant can read every trip on which the user may plan (owner or contributor): its days, activities with times, durations and places, stays, travel legs, the bucket list, costs, links, documents and images. Trips the user may only view are not visible to it. **(Added 2026-10-29)**
- FR54: A connected assistant can create, change, delete, reorder, park and schedule activities, and create, change and delete stays, travel legs, costs and links, on those trips, under the same rules as the app (FR42, FR43, FR46-FR48, FR41). It cannot create, rename, re-date or delete a trip, change its budget, or manage its members. **(Added 2026-10-29)**
- FR55: A connected assistant can apply a whole day plan in one step, either appending to the day or replacing its activities, with travel legs between them; the day is recomputed under FR42. **(Added 2026-10-29)**
- FR56: A connected assistant can download a trip's documents and images, and attach documents and images to activities and stays, under the same file types and limits as the app. **(Added 2026-10-29)**
- FR57: Every entry created or changed through a connector shows a marker ("KI" in German, "AI" in English) until a person changes it in the app. Each change made through a connector can be undone from the app, and by the assistant, in one step, unless something it touched has changed since. **(Added 2026-10-29)**
```

**Section *Non-Functional Requirements → Security*, append:**
```
- NFR5: Connector access shall use short-lived, audience-bound access tokens with rotating refresh tokens, stored only as hashes; tokens shall be revoked on revocation by the user, on password change and on account deletion, and shall never grant more than the user's own rights on a trip. **(Added 2026-10-29)**
```

Rationale: a new way to reach trip data and a new class of writer. Both deserve explicit FRs, and the security properties need an NFR.

### 4.2 `epics.md`: Requirements inventory, coverage map and Epic List

After `FR51:` in *Functional Requirements*:
```
FR52: Users can connect an AI assistant to their account through a connector (sign-in and consent) and see and revoke connected assistants.
FR53: A connected assistant can read every trip the user may plan (owner/contributor): days, activities, stays, legs, bucket list, costs, links, documents, images. View-only trips are invisible to it.
FR54: A connected assistant can create, change, delete, reorder, park and schedule activities, and manage stays, legs, costs and links, under the app's rules; it cannot create, rename, re-date or delete trips, change budgets, or manage members.
FR55: A connected assistant can apply a whole day plan in one step (append or replace), with travel legs; the day is recomputed.
FR56: A connected assistant can download documents and images and attach new ones to activities and stays, under the app's types and limits.
FR57: Entries created or changed through a connector show a KI/AI marker until a person changes them; each connector change can be undone in one step from the app or by the assistant, unless something it touched changed since.
```
After `NFR13:` in *NonFunctional Requirements*:
```
NFR14: Connector tokens are short-lived, audience-bound, rotating, stored hashed, revoked on user revocation, password change and account deletion, and never exceed the user's rights on a trip.
```
After `FR51: …` in the coverage map:
```
FR52: Epic 15 - Plan with Claude (Stories 15.1, 15.3, added 2026-10-29)
FR53: Epic 15 (Story 15.2)
FR54: Epic 15 (Stories 15.4, 15.6)
FR55: Epic 15 (Story 15.5)
FR56: Epic 15 (Story 15.7)
FR57: Epic 15 (Story 15.4; applied by 15.5-15.7)
```
After the Epic 14 entry in the *Epic List*:
```
### Epic 15: Plan with Claude — the TravelPlan Connector
Users who plan a trip connect their AI assistant to TravelPlan once, sign in, and from then on the assistant reads the trip and writes the planned days straight into it, every change marked KI/AI and undoable, instead of being copied over by hand.
**FRs covered:** FR52, FR53, FR54, FR55, FR56, FR57
```

### 4.3 `epics.md`: new Epic 15 section (appended after Epic 14)

```
## Epic 15: Plan with Claude — the TravelPlan Connector

Users who plan a trip connect their AI assistant to TravelPlan once, sign in, and from then on the assistant reads the trip and writes the planned days straight into it, every change marked KI/AI and undoable, instead of being copied over by hand.

**Rulings (Tommy, 2026-10-29):** only people who may edit a trip (owner, contributor) reach it through the connector, and view-only trips are invisible; full control over trip content; no trip creation, renaming, re-dating, budget, deletion or member changes; marker "KI" (de) / "AI" (en), gone once a person changes the entry; connector changes undoable like UI edits; documents downloadable and uploadable, inline and by URL; Epic 12 unchanged. See `sprint-change-proposal-2026-10-29-mcp.md`.

**Shared rules for every tool in this epic:**
- Tools call the existing repositories and services (`dayPlanItemRepo`, accommodation, travel-segment, document and image repositories, `scheduleDay`, park/schedule), never Prisma directly, so FR42/FR43/FR46-FR48 and FR41 hold exactly as in the app.
- Every call re-checks access per trip with `getTripAccessForUser` + `canTripAccessRoleWrite`; a trip the user cannot write answers *not found*, never *forbidden* (no existence leak).
- Tool errors are returned as MCP tool errors with a short, actionable English message (for example "Activity changed since you read it; read the day again"); internal details never leak.
- Every tool is logged with tool name, user id, trip id, outcome and duration, never its arguments' content.
- Per-user rate limit through `rateLimit.ts` **[default: 120 tool calls per minute, 20 uploads per hour]**.
- Tool descriptions are in English, written for the model, and name units (minutes, EUR cents vs amount, `HH:MM`, ISO dates).
```

#### Story 15.1: Add TravelPlan to Claude

```
### Story 15.1: Add TravelPlan to Claude

As someone who plans trips with Claude,
I want to add TravelPlan as a connector, sign in with my TravelPlan account and confirm,
So that Claude can act for me in TravelPlan without ever seeing my password.

**FRs covered:** FR52 (connect), NFR14

**Depends on:** Architect review of the *Connector (MCP + OAuth)* architecture section. **Origin:** Tommy with John (PM), 2026-10-29.

**Context:** TravelPlan has only cookie sessions. This story builds the OAuth 2.1 authorization server, the protected MCP endpoint and one tool, and proves the whole loop in claude.ai before any trip data is exposed.

**Acceptance Criteria:**

**Given** `MCP_ENABLED` is not `true`
**Then** every connector endpoint (metadata, register, authorize, token, revoke, `/api/mcp`) answers 404

**Given** an unauthenticated request to `POST /api/mcp`
**Then** it answers 401 with `WWW-Authenticate: Bearer resource_metadata="<APP_BASE_URL>/.well-known/oauth-protected-resource"`
**And** the protected-resource metadata (RFC 9728) names `<APP_BASE_URL>/api/mcp` as the resource and TravelPlan as its authorization server
**And** the authorization-server metadata (RFC 8414) lists the authorize, token, registration and revocation endpoints, `code` as the only response type, `authorization_code` and `refresh_token` as grant types, and `S256` as the only PKCE method

**Given** a client registers
**Then** dynamic client registration (RFC 7591) and client ID metadata documents are both supported **[default; Winston confirms against the MCP authorization spec revision current at story time]**
**And** redirect URIs must be `https://`, or `http://localhost` / `http://127.0.0.1` with any port (Claude Code); anything else is refused
**And** registration is rate-limited per IP

**Given** the authorize request from a registered client with PKCE S256 and a `resource` equal to the MCP resource (RFC 8707)
**When** I am not signed in
**Then** I see TravelPlan's normal sign-in page and, after signing in, return to the authorization step
**When** I am signed in
**Then** I see a consent screen in my UI language naming the client, the host its redirect goes to, and what it may do ("Reisen lesen und bearbeiten, auf denen du planen darfst"), with *Erlauben* and *Ablehnen*
**And** consent is CSRF-protected and a fresh consent is required for every new authorization (no silent re-grant) **[default]**

**Given** the code exchange
**Then** codes are single-use, expire after 60 s, are bound to client, redirect URI, PKCE challenge and resource, and a reused code revokes the tokens issued from it
**And** the access token lives 1 h and the refresh token 30 days, rotating on every use with reuse detection **[default]**
**And** tokens are opaque random strings, stored only as SHA-256 hashes with user id, client id, scope, resource, expiry and last-used time

**Given** a valid bearer token
**Then** `/api/mcp` serves the MCP Streamable HTTP transport, stateless, with JSON responses, and accepts the token only if its audience is the MCP resource
**And** the session cookie is never accepted on `/api/mcp`, and a bearer token is never accepted on any other route

**Given** the tool `whoami`
**Then** it returns my email and the number of trips I may plan, and nothing else

**Given** the test suite
**Then** it covers metadata, registration with good and bad redirect URIs, PKCE mismatch, code reuse, wrong resource, expired and revoked tokens, refresh rotation and reuse, cookie refused on `/api/mcp`, bearer refused on a REST route, and `MCP_ENABLED` off

**Given** the production server
**When** the story is deployed (Tommy, manual)
**Then** TravelPlan added as a custom connector in claude.ai (web) and in Claude Code signs in, shows the consent screen, and `whoami` answers correctly in both

**Out of scope:** any trip data (15.2); the connections page (15.3); scopes finer than one.
```

#### Story 15.2: Claude Knows the Trip

```
### Story 15.2: Claude Knows the Trip

As someone planning with Claude,
I want Claude to read my trips, days, activities, stays, legs, bucket list, costs, links and documents,
So that its suggestions build on what is already planned instead of on what I retype.

**FRs covered:** FR53

**Depends on:** Story 15.1.

**Acceptance Criteria:**

**Given** the tool `list_trips`
**Then** it returns the trips where I am owner or contributor (id, name, start and end date, my role, number of days), and no trip where I am only a viewer

**Given** `get_trip(tripId)`
**Then** it returns name, dates, budget, the planned-cost total, and per day: id, date, index, the night's stay (name, status), the number of activities, plan warnings (FR47) and whether a stay is missing

**Given** `get_day(tripId, dayId or date)`
**Then** it returns the previous night's stay with check-out, the day's activities in order with id, title, description as plain text (from `contentJson`), mode (flexible/fixed), duration, computed from/to, place (label, lat, lng), link, cost (EUR and original currency/rate if any), payments, document and image ids with names, the travel legs between them (mode, duration, distance), the night's stay with all its fields, the day's warnings, and the KI/AI marker of each entry
**And** each entry carries its `updatedAt`, which write tools accept as an optimistic-concurrency check

**Given** `get_bucket_list(tripId)`
**Then** it returns the parked activities with the same fields as on a day, minus times and legs

**Given** any trip or day I cannot write, or that does not exist
**Then** the tool answers "not found"

**Given** the test suite
**Then** it covers a viewer-only trip being invisible in every read tool, an owner and a contributor reading, plain-text conversion of rich text, and the parked/day split

**Out of scope:** writing; file contents (15.7); AI suggestions (Epic 12).
```

#### Story 15.3: Connected Apps

```
### Story 15.3: Connected Apps

As an account holder,
I want to see which assistants are connected to my account and cut any of them off,
So that I stay in control before anything can write to my trips.

**FRs covered:** FR52 (see and revoke), NFR14

**Depends on:** Story 15.1.

**Acceptance Criteria:**

**Given** my account page
**Then** a section *Verbundene Apps* / *Connected apps* lists each connection: client name, redirect host, connected since, last used
**And** each has *Trennen* / *Disconnect*, with a confirmation, which revokes all its access and refresh tokens at once; the next tool call answers 401

**Given** I change my password, or my account is deleted
**Then** all my connector tokens are revoked

**Given** the token revocation endpoint (RFC 7009)
**Then** a client can revoke its own token

**Given** no connection exists
**Then** the section says so in one line and explains how to add TravelPlan as a connector, with the connector URL to copy

**Given** both dictionaries
**Then** every new string exists in `en.ts` and `de.ts`

**Out of scope:** admin view of other users' connections.
```

#### Story 15.4: Claude Plans Activities, Marked and Undoable

```
### Story 15.4: Claude Plans Activities, Marked and Undoable

As someone planning with Claude,
I want Claude to add, change, remove, reorder, park and schedule activities, and to see in the app what it did and take it back,
So that I can let it work and still trust my plan.

**FRs covered:** FR54 (activities), FR57

**Depends on:** Stories 15.2, 15.3; Architect review of *provenance* and *stored AI changes*.

**Context:** receipts are client-held today, so an edit made through the connector would have no undo. This story stores the receipt of every connector write on the server and shows it on the day. It also adds the KI/AI provenance marker.

**Acceptance Criteria:**

**Given** the migration
**Then** activities, stays, travel legs, documents and images gain a nullable `aiChangedAt` **[default name]**, and a table `ai_changes` stores per connector write: id, trip, day (nullable), user, client, time, a one-line summary, the v3 receipt, and `undoneAt`

**Given** the tools `create_activity`, `update_activity`, `delete_activity`, `move_activity` (earlier/later or to a position), `move_activity_to_day`, `park_activity`, `schedule_activity`
**Then** each calls the same repository function as the matching UI route, so the day is recomputed under FR42 exactly as in the app
**And** each takes plain text or simple Markdown for the description and stores it as the same rich-text JSON the editor writes
**And** a place given by name only is geocoded through the existing geocoder; coordinates given are used as they are
**And** `update_*` and `delete_*` accept the `updatedAt` read in 15.2 and refuse with "changed since you read it" on a mismatch
**And** each sets `aiChangedAt` on every row it creates or changes, and records one `ai_changes` entry with its receipt
**And** each returns the changed activity, the day's new order and times, the warnings, and the `ai_changes` id

**Given** any UI write that changes a row
**Then** it clears that row's `aiChangedAt` (R4)

**Given** an entry with `aiChangedAt`
**Then** the day timeline, the bucket list and the dialogs show a small *KI* (de) / *AI* (en) badge on it

**Given** a day with connector changes not yet undone **[default: from the last 14 days]**
**Then** the day view shows a notice "KI hat diesen Tag geändert" / "AI changed this day", with each change's summary and time, newest first, and *Rückgängig* / *Undo* on each
**When** I choose *Rückgängig*
**Then** the stored receipt is applied through the existing undo path; on a stale receipt (409) the notice says that the day has changed since and the change can no longer be undone
**And** an undone change is marked `undoneAt` and leaves the notice

**Given** the tools `list_ai_changes(tripId)` and `undo_ai_change(changeId)`
**Then** the assistant can see and undo its own changes under the same stale rule

**Given** `ai_changes` entries older than 14 days **[default]**
**Then** they are deleted (no undo after that)

**Given** the test suite
**Then** it covers every tool as owner and contributor, a viewer-only trip answering not found, recompute parity with the UI route (same input gives the same day), marker set by the tool and cleared by a UI edit, undo from the app, undo by the tool, stale undo, and concurrency refusal

**Out of scope:** stays, legs, costs, links (15.6); files (15.7); bulk day plan (15.5).
```

#### Story 15.5: Take Over the Day Plan

```
### Story 15.5: Take Over the Day Plan

As someone who just planned tomorrow with Claude,
I want Claude to put the whole day into TravelPlan in one go,
So that the plan we agreed on is in the app in seconds and can be taken back in one step.

**FRs covered:** FR55

**Depends on:** Story 15.4.

**Acceptance Criteria:**

**Given** `apply_day_plan(tripId, dayId, mode: "append" | "replace", activities[], legs?)`
**Then** each activity carries title, description, flexible duration or fixed start with end or duration, place, link and cost; legs carry a transport mode from the app's `TravelTransportType` between consecutive activities
**And** in `append` the activities follow the day's last activity; in `replace` the day's existing activities and their legs are deleted first, in the same transaction
**And** missing leg durations and distances are computed as the app computes them (route preview), falling back to no duration if routing fails
**And** the day is recomputed once under FR42; the whole call is one `ai_changes` entry, undone in one step
**And** every created row carries the KI/AI marker

**Given** a plan that does not fit (fixed overlaps, past midnight)
**Then** it is saved anyway and the tool returns the FR47 warnings, as the app would

**Given** invalid input (more than 50 activities **[default]**, a fixed time without duration or end, an unknown mode)
**Then** nothing is written and the tool says which entry is wrong

**Given** the test suite
**Then** it covers append, replace with undo restoring the old day exactly, legs computed, a routing failure, warnings, and a rejected entry leaving the day untouched

**Out of scope:** applying to several days in one call **[default; Claude calls the tool once per day]**.
```

#### Story 15.6: Stays, Legs, Costs and Links

```
### Story 15.6: Stays, Legs, Costs and Links

As someone planning with Claude,
I want Claude to also set the night's stay, the travel legs, costs and links,
So that a planned day is complete and the budget is right.

**FRs covered:** FR54 (stays, legs, costs, links)

**Depends on:** Story 15.4.

**Acceptance Criteria:**

**Given** `set_stay` (create or update) and `delete_stay`
**Then** they write the night's stay with name, status (planned/booked), check-in, check-out, place, link, cost and notes through the accommodation repository; a check-out change recomputes the next day as in the app (receipt included)

**Given** `create_leg`, `update_leg`, `delete_leg`
**Then** they write travel legs between two consecutive entries of a day through the travel-segment repository and recompute the day

**Given** a cost on an activity or stay
**Then** it can be given in EUR or in a foreign currency, converted at the ECB rate exactly as FR41 does, keeping amount, currency and rate; payments can be added, changed and removed as in the dialogs

**Given** every write here
**Then** it follows the 15.4 rules: KI/AI marker, one `ai_changes` entry, undo, `updatedAt` check, not found for non-writable trips

**Given** the test suite
**Then** it covers each tool, the next-day recompute on check-out change with undo, foreign currency conversion and an ECB failure answering with a clear error and writing nothing **[default]**

**Out of scope:** trip budget, trip name and dates (R7); day image and hero image.
```

#### Story 15.7: Documents and Images

```
### Story 15.7: Documents and Images

As someone planning with Claude,
I want Claude to read my tickets and to attach new ones and pictures to the right activity or stay,
So that the documents end up where the day packet and the day email find them.

**FRs covered:** FR56

**Depends on:** Story 15.4.

**Acceptance Criteria:**

**Given** `get_file(tripId, fileId)`
**Then** it returns the document or image as an MCP embedded resource (MIME type and base64) up to 10 MB **[default]**, and metadata only above that
**And** media access follows the same managed-file rule as the app (no path outside the trip's folder)

**Given** `attach_file(target: activity | stay, id, fileName, …)` with **either** `contentBase64` **or** `url`
**Then** the file type must be PDF, JPEG, PNG or WebP, decided by the file's content, not its name or the server's header
**And** inline content is limited to **1 MB decoded [default]**, a URL download to **10 MB [default, = import document limit]**
**And** the 10-documents-per-entry limit and the file-name sanitisation of the app apply
**And** documents go to the same folders as UI uploads, so the packet (FR40) and the day email (FR51) include them
**And** images are attached as activity or stay images, with the same processing as UI uploads

**Given** a URL download
**Then** only `https` is fetched, and the resolved address must not be loopback, private, link-local or otherwise non-public (checked after DNS resolution and on every redirect, at most 3 redirects)
**And** the download stops at the size limit and after 15 s; cookies and credentials are never sent
**And** failures answer with a short reason and write nothing

**Given** `delete_file`
**Then** it removes the document or image as the dialog does; the delete is undoable via `ai_changes` while the file is kept for undo (DW-187 rule)

**Given** every write here
**Then** it follows the 15.4 rules (marker, `ai_changes`, not found for non-writable trips)

**Given** the test suite
**Then** it covers inline and URL upload, a too-large file, a wrong type with a PDF name, SSRF to `127.0.0.1`, `10.x`, `169.254.169.254` and a redirect to a private address, the per-entry limit, and the packet including an uploaded document

**Given** the production server
**When** deployed (Tommy, manual)
**Then** a ticket attached through Claude by URL appears on the activity with the KI badge and is part of the day packet

**Out of scope:** day images and trip hero images; OCR or reading ticket contents server-side.
```

### 4.4 `epics.md`: nothing else

No existing story text changes. Epic 12's FR44 stays as written.

### 4.5 Architecture (`architecture.md`)

**Section *Authentication & Security*, append:**
```
- **Connector auth (added 2026-10-29, Epic 15; Winston to review before 15.1).** TravelPlan is its own OAuth 2.1 authorization server for the MCP connector, built on `jose` and the existing session; no third-party IdP. Endpoints under `/api/oauth/*` plus `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Authorization code + PKCE S256 only; resource indicator bound to `<APP_BASE_URL>/api/mcp`; dynamic client registration and client ID metadata documents; redirect URIs `https` or loopback. Access tokens 1 h, refresh tokens 30 days, rotating with reuse detection; all tokens opaque and stored as SHA-256 hashes (`oauth_clients`, `oauth_authorization_codes`, `oauth_tokens`). Revoked by the user (Connected apps), by password change and by account deletion. Bearer tokens are accepted only on `/api/mcp`; the session cookie is never accepted there. CSRF does not apply to bearer requests; it does apply to the consent form. Off unless `MCP_ENABLED=true`.
```

**Section *API & Communication Patterns*, append:**
```
- **MCP endpoint (added 2026-10-29, Epic 15).** `POST /api/mcp`, Streamable HTTP, stateless, JSON responses (no SSE), via `@modelcontextprotocol/sdk` (exact pin). Tools live in `src/lib/mcp/tools/*`, one file per area, and call repositories and services only. They are thin adapters, like route handlers. Per call: resolve the token to a user, then `getTripAccessForUser` + `canTripAccessRoleWrite` per trip; not writable means not found. Inputs are validated with Zod and reuse the route schemas where shapes match. Rich text arrives as plain text or simple Markdown and is converted to the editor's JSON by one shared function. Per-user rate limit via `rateLimit.ts`. Logs carry tool, user, trip, outcome and duration, never arguments.
- **Stored AI changes (added 2026-10-29, Epic 15; Winston to review before 15.4).** Receipts stay client-held for UI writes. Connector writes store theirs in `ai_changes` (trip, nullable day, user, client, summary, receipt v3 JSON, `createdAt`, `undoneAt`), because no client holds them. Undo from the app or the tool runs the existing `day-plan-changes/undo` path with the stored receipt and keeps its 409 stale rule. Rows older than 14 days are deleted on write. Receipts must cover the primary row of creates and deletes as well as side effects; where v3 lacks a kind for that (stay create/delete, leg create/delete, file attach/delete, bulk apply), the kinds are added additively without a version bump, following the Epic 14 precedent.
- **Provenance (added 2026-10-29, Epic 15).** Nullable `ai_changed_at` on `day_plan_items`, `accommodations`, `travel_segments`, `*_documents`, `*_images`. Connector writes set it; every UI write path clears it on the rows it changes. Not exported in backups **[default]**, since it is transient trust information, not trip content.
```

**Section *Integration Points → External Integrations*, append:**
```
- MCP connector (2026-10-29, Epic 15): inbound only. External AI assistants (for example claude.ai, Claude Code) call `/api/mcp` with user-granted OAuth tokens. Outbound only for *upload by URL* (Story 15.7): https only, public addresses only (checked after DNS and on each redirect, ≤ 3), 10 MB, 15 s, no credentials. Independent of the Epic 12 provider key.
```

### 4.6 UX (`ux-design-specification.md`, short addendum)

```
## Addendum 2026-10-29: Connector (Epic 15)

- **KI/AI badge:** small neutral pill, text "KI" (de) / "AI" (en), placed after the title on activity cards, stay cards, legs, documents and images, using the same token as other secondary pills; tooltip "Von KI erstellt oder geändert" / "Created or changed by AI". Disappears after any human edit of that entry.
- **AI changes notice on the day:** inline notice under the day header (same component family as the undo notice), collapsed to one line ("KI hat diesen Tag geändert · 3 Änderungen"), expandable to the list with time, one-line summary and *Rückgängig* each.
- **Consent screen:** a centred card like the sign-in page: client name, redirect host, one sentence on what it may do, *Erlauben* (primary) and *Ablehnen*.
- **Connected apps:** a section on the account page; list rows with name, host, since, last used, *Trennen*; empty state with the connector URL and a copy button.
```

### 4.7 `sprint-status.yaml`

After `epic-14-retrospective: optional`:
```
  epic-15: backlog
  15-1-add-travelplan-to-claude: backlog
  15-2-claude-knows-the-trip: backlog
  15-3-connected-apps: backlog
  15-4-claude-plans-activities-marked-and-undoable: backlog
  15-5-take-over-the-day-plan: backlog
  15-6-stays-legs-costs-and-links: backlog
  15-7-documents-and-images: backlog
  epic-15-retrospective: optional
```

### 4.8 Deployment (`deploy/travelplan.env.example`, `deploy/README.md`)

```
# Connector (Epic 15). Absent or anything but "true" = every connector endpoint answers 404.
MCP_ENABLED=
```
README: a short section *Connector* covering the connector URL to give users (`<APP_BASE_URL>/api/mcp`), how to turn it off, and that tokens survive restarts (stored in the DB).

---

## 5. Implementation Handoff

**Scope:** Major (new subsystem). It is additive and introduces no rollback.

| Step | Who | What |
|---|---|---|
| 1 | John (PM) | Apply edits 4.1–4.8 after approval (PRD, `epics.md`, UX addendum, `sprint-status.yaml`; the deploy files with 15.1). |
| 2 | Winston (Architect) | Review 4.5 before 15.1 (OAuth, token model, client registration against the current MCP authorization spec) and before 15.4 (stored AI changes, receipt kinds, provenance). Amend `architecture.md` with the reviewed text. |
| 3 | Bob / `bmad-create-story` | Story files in order 15.1 → 15.7. |
| 4 | Amelia / `bmad-dev-story` | Implement in order; full three-layer code review on 15.1, 15.4 and 15.7. |
| 5 | Tommy | Deploy and accept in production: 15.1 (connector in claude.ai and Claude Code), 15.5 (a day planned in Claude lands in the app, undo works), 15.7 (ticket by URL lands in the packet). |

**Success criteria:** Tommy adds TravelPlan as a connector in claude.ai, signs in once, plans tomorrow in conversation, and Claude writes the day into TravelPlan: activities with durations, places, legs, the stay, costs and a ticket. Each entry shows *KI*. The app's day view offers *Rückgängig* for Claude's change. Konni, a viewer on another trip, cannot see that trip through her connector. Disconnecting in *Verbundene Apps* stops Claude at its next call.
