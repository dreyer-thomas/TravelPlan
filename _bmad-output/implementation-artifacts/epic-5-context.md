# Epic 5 Context: Sharing & Light Contribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A trip owner can bring other people into a trip without giving away control of it. The owner provisions an account by email with a temporary password, assigns it a role on the trip — VIEWER (reads the plan, changes nothing) or CONTRIBUTOR (plans alongside the owner) — and the same person can be attached to several trips without duplicate-account errors. The epic also carries the administrative surface for the installation: an ADMIN account can see every registered account, what it owns and what it is shared into, and can attach, re-role, detach and delete accounts. The through-line is that a role must mean the same thing everywhere it applies: every trip surface has to agree on who may read, who may write, and which trips a signed-in account can even reach.

## Stories

- Story 5.1: Invite viewer or contributor by email with temp password
- Story 5.2: Enforce first-login password change
- Story 5.3: Viewer read-only access
- Story 5.4: Contributor full edit permissions
- Story 5.5: Edit own comments — REMOVED 2026-07-30 (comments/voting discontinued; retained for history only)
- Story 5.6: Add existing contributor to another trip
- Story 5.7: Limit voting to day items — REMOVED 2026-07-30 (comments/voting discontinued; retained for history only)
- Story 5.8: View all registered system users
- Story 5.9: Remove comments & voting feature
- Story 5.10: User administration for admins
- Story 5.11: The administration row, rearranged
- Story 5.12: Shared trips on the collaborator's dashboard
- Story 5.13: What a contributor may do, made consistent

## Requirements & Constraints

- **Sharing and roles.** An owner can share a trip with a viewer, and can grant a contributor role carrying full edit permissions on trip content. A viewer sees the plan — days, stays, activities, travel segments, photos and documents — and can change none of it. "Sees the plan" is not "sees everything": the bucket list and the backup export require write-level role, so a viewer reaches neither. **Recorded 2026-08-07, and it is a discrepancy rather than a decision.** This file previously said a viewer "sees everything"; the code has never matched that, because both surfaces were owner-only at the route long before Story 5.13 and that story widened them to owner-or-contributor rather than to every participant. The sentence was corrected to describe the system that exists, but nobody has ever ruled on whether a viewer *should* read the bucket list and be able to export — see the ledger entry opened alongside this note. Do not read the corrected wording as the answer. Invitation is provisioning-by-owner with a temporary password — there is no email-invitation flow — and the invited account must be forced to set a real password before it can use the app.
- **Membership is many-to-many.** An account may be a member of several trips and may own trips of its own at the same time. Attaching an existing account to a new trip must succeed; attaching it twice to the same trip must fail with a trip-specific message and create nothing.
- **Registered-users visibility.** Trip owners can see the accounts registered in the system, identified by email, so they know whether someone already has an account. This list is system-wide, not trip-scoped, and reflects current state on reload. An account that owns no trip is refused access to it.
- **Administration.** Exactly one privilege tier above owner exists (ADMIN), reachable only from the admin's own navigation. Self-registration always produces a plain owner, so the owner population cannot be used as a gate. The first account in an empty installation becomes ADMIN in the same transaction as its insert; an already-populated installation is bootstrapped by a CLI script rather than through the UI.
- **Destructive-action guards.** Deleting an account that owns trips must be refused, naming the trips, because trip ownership cascades and an unguarded delete destroys travel history. Removing a share is confirmed before it happens.
- **Discontinued scope.** Comments, suggestions and voting were removed from the product. Do not reintroduce feedback/comment/vote models, routes, UI or strings; the viewer/contributor *access* model is what survives.
- Authenticated access is required for all trip data, including uploaded media and documents.

## Technical Decisions

- **Two independent gates per write.** A trip-scoped write is guarded twice: by its route-level access helper and by the repository's trip-ownership/membership scope on the query. Widening one without the other yields a request that passes the gate and is then silently refused by the query — a green-looking half-implementation. Widen both, and test both. Note that the second gate is the load-bearing one and a handful of routes deliberately rely on it alone: `DELETE /api/trips/[id]` carries no route gate because `deleteTripForUser` scopes the `deleteMany` itself. Enforcement is server-side in every case; a UI that hides a control is never the enforcement, only a mirror of it — and when the two disagree the user gets either a control that always errors or a capability they cannot reach.
- **Test the role, not just the path.** A repository scope that admits members must name the role explicitly (`role: "CONTRIBUTOR"`); the role-agnostic membership predicate is the *read* scope and admits viewers. Because a route-level gate refuses the wrong role before the query runs, no route test can prove the repository clause — those nets have to call the repository directly or the story's most dangerous single-word mistake ships green.
- **Authorisation shape.** Reads that admit members use an ownership-or-membership predicate (`userId` OR a membership row for that user); owner-only reads filter on `userId` alone. When widening a query to admit members, guarantee each trip is returned exactly once for an account that both owns and is a member, and prove by test that no trip leaks to an account with neither relationship.
- **The permission line.** Content is contributor-writable; the trip as a possession is owner-only. Contributors may create, edit and delete trip content and attachments (stay/activity photos and documents, day images, bucket-list items) and may export a backup, since they can already read every byte it contains. Member management, trip deletion and the trip hero image stay with the owner. A viewer gains no write anywhere.
- **404 vs 403.** A caller who does not participate in a trip keeps getting 404 — the trip's existence is not disclosed. A caller who *does* participate but whose role forbids the action gets `403 forbidden`; returning 404 to someone looking at the object on screen reads as a broken app.
- **List payloads must carry access role.** A trip summary returned to a dashboard has to state whether the account owns the trip or holds a membership, and with which role, before the UI can render owned and shared trips side by side without offering forbidden actions.
- **Conventions.** REST routes with Zod validation; `{ data, error }` success and `{ data: null, error: { code, message, details } }` error envelopes — a rejected write always answers the envelope with a stable error code the client can branch on, never a bare status. Authorisation is checked before the body is parsed, so a caller who may not call a route cannot enumerate its schema from validation errors. DB `snake_case`, API JSON `camelCase`, dates ISO 8601 UTC; schema changes go through Prisma Migrate against SQLite. Auth is a JWT in an HTTP-only cookie with bcrypt password hashing; CSRF protection on state-changing requests and rate limiting on auth endpoints. Data access lives in repositories, not in route handlers.
- **i18n.** All user-facing strings exist in both dictionaries, in agreement — key parity is enforced by test. Removing a feature includes removing its now-orphaned strings.

## UX & Interaction Patterns

- **Shared trips are visibly not owned trips.** On the trip list, a shared trip is distinguishable at a glance from an owned one, and a viewer is offered no affordance their role forbids — deletion in particular never appears on a trip the account does not own. The empty state stays exactly as it is when an account has neither owned trips nor memberships.
- **One trigger per row.** In the administration list, an account's actions (attach to trip, grant/revoke admin, delete) collapse into a single vertical-dots overflow menu at the right of the address line, and that menu is labelled per account — a list of identically-named "more actions" triggers cannot be told apart by anyone navigating by label.
- **Memberships are a table, ownership is not.** An account's shares render as a table under their own heading: trip name, role as a select that applies the change, and a remove control. Owned trips stay outside that table under their own label — ownership and membership must never read as the same relationship. An account with no memberships says so rather than rendering an empty table.
- **Idempotent controls send nothing.** Re-selecting the role a membership already has issues no request; the endpoint is an upsert, so a redundant write plus a list reload would cost a round-trip to arrive where it started.
- **Form dialogs have exactly one committing action and no cancel button** — dismissal is a close glyph in the title row. Two equally weighted buttons appear only on destructive confirmations, and the safe answer names what it preserves rather than the mechanism.
- **Invalid input is reported inline on the offending field** with concrete wording, never a generic failure; problems not attributable to a field render as a warn-toned banner at the top of the dialog. A refusal states its reason — a permission refusal says so rather than reporting the object as missing or asking the user to try again.
- Material UI is the component baseline; keep strong contrast, visible focus, full keyboard navigation, and touch targets of at least 44×44 px. Dialogs trap focus and carry `role="dialog"`. The design system's tokens are the source of truth for the rendered result; no fifth semantic colour family exists, warn is reserved for actionable gaps, and destructive filled buttons use the darker warn tone for contrast.

## Cross-Story Dependencies

- Stories 5.1, 5.4 and 5.6 create the memberships that every later story in this epic reads. Nothing else in the epic blocks 5.12 or 5.13.
- Story 5.2 (forced password change) is the gate that makes 5.1's temporary-password provisioning safe; they are two halves of one flow.
- Story 5.10 introduces the ADMIN tier and the administration surface; 5.11 relays out that same surface and changes no capability.
- Story 5.8's registered-users list is the ancestor of 5.10's administration list — 5.10 extends it rather than replacing the requirement.
- Story 5.9 removes the comments/votes feature that Epic 4 (bucket-list dialog) and Epic 6 (feedback-UX refinements) also touched; those epics' corresponding stories were withdrawn in the same decision.
- Story 5.13 widens permissions on routes originally written owner-only in Epic 2 (media) and Epic 9 (documents), plus the Epic 4 bucket list and the Epic 2 backup export. Changes there and here must stay in agreement.
- Story 5.12 corrects a dashboard query that Epic 7's redesign stories (7.4, 7.5) rendered but explicitly left out of scope.
