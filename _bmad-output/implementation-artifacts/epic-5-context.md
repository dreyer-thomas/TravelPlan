# Epic 5 Context: Sharing & Light Contribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A trip owner can grant other people access to a trip without the plan ever leaving their control: a viewer sees everything and can change nothing, a contributor edits like the owner. Because there is no email delivery, access is provisioned in-app — the owner enters an address, picks a role, and hands over a temporary password the invitee must replace on first login. Around that core sit the operational surfaces a single-installation, self-hosted app needs: seeing who already has an account, an administrator view for reassigning and removing accounts, and the invited person's own dashboard actually listing the trips shared with them. The epic also carries the removal of the discontinued comments/voting feature, which originally lived here.

## Stories

- Story 5.1: Invite Viewer or Contributor by Email With Temp Password
- Story 5.2: Enforce First-Login Password Change
- Story 5.3: Viewer Read-Only Access
- Story 5.4: Contributor Full Edit Permissions
- Story 5.5: Edit Own Comments — REMOVED 2026-07-30 (comments/voting discontinued; retained for history only)
- Story 5.6: Add Existing Contributor to Another Trip
- Story 5.7: Limit Voting to Day Items — REMOVED 2026-07-30 (comments/voting discontinued; retained for history only)
- Story 5.8: View All Registered System Users
- Story 5.9: Remove Comments & Voting Feature
- Story 5.10: User Administration for Admins
- Story 5.11: The Administration Row, Rearranged
- Story 5.12: Shared Trips on the Collaborator's Dashboard

## Requirements & Constraints

- Two collaboration roles only: **viewer** (sees the full trip plan, blocked from editing core details) and **contributor** (edits trip details, accommodations, and day plans exactly as the owner does). Ownership is a third, distinct thing and must never be presented as a membership.
- No email is sent. Access is provisioned by the owner entering an address plus a temporary password; the invitee is forced to set a new password before reaching any app surface.
- An address that already has an account must be linkable to a further trip rather than rejected as a duplicate. Duplication is only an error when that account already holds a membership *on this trip*, and the message must say so specifically.
- Every read of trip data is authenticated, and authorization is per-trip: an account sees a trip only if it owns it or holds a membership on it. A route-level test proving no leakage across accounts is expected wherever the access query is widened.
- The registered-users overview is not scoped to a trip — it lists every account in the installation — and is therefore gated: owners (later, admins) only; a signed-in account that is merely a viewer/contributor somewhere is blocked. The list must reflect accounts registered since it was last opened.
- Administration must be able to create, re-assign, and remove accounts. Deleting an account that owns trips is refused outright, naming the trips, because the owner relation cascades and would destroy an entire travel history.
- Admin capability cannot be inferred from ownership, since every self-registration produces an owner. It is an explicit role on the account, bootstrapped by making the very first registered account an admin in the same transaction as its insert, plus a CLI grant for installations that already have accounts.
- Comments, suggestions, and voting are discontinued product scope: no data model, API route, UI affordance, or translation string for them may remain, and nothing new may be built against them. Removing them must not regress the adjacent sharing, day-view, or budget surfaces.
- Destructive or consequential actions confirm first, and the safe answer names what it preserves rather than the mechanism. Re-selecting a value that is already current must not issue a write.

## Technical Decisions

- Access control is role-based and enforced server-side in the API layer; the UI hiding a control is never the enforcement. Rejected writes return the standard error envelope with a stable error code.
- The trip-access predicate is "owner OR member" and is applied uniformly across every trip-scoped read. Any list query must return each trip exactly once for an account that both owns and is a member of trips.
- Trip payloads that can contain shared trips must state, per entry, whether the account owns it and — if not — which membership role it holds. Without that, the client cannot suppress role-forbidden affordances, and deletion in particular must never be offered on a trip the account does not own.
- Passwords are bcrypt-hashed; sessions are JWTs in HTTP-only cookies. State-changing requests carry CSRF protection and auth endpoints are rate-limited. The temporary-password state is a property of the account that gates the app until cleared.
- Schema changes go through Prisma Migrate against SQLite; DB identifiers are snake_case, API JSON is camelCase, timestamps are ISO 8601 UTC. Data access stays behind the repository layer, validation is Zod at the API boundary.
- Role-changing endpoints behave as upserts, so the client is responsible for not re-sending an unchanged role.
- All user-facing text ships in both English and German translation files; removals must take orphaned keys with them.

## UX & Interaction Patterns

- The share surface is a modal opened from the trip overview: a single-line invite row (email input + role select + submit), with existing collaborators listed below carrying a role badge and a remove action. Owner, contributor, and viewer badges are visually distinct.
- Invalid input is reported inline on the offending field with concrete wording ("this address isn't valid"), never a generic failure; problems not attributable to a field render as a warn-toned banner at the top of the dialog.
- Form dialogs have exactly one committing action and no cancel button — dismissal is a close glyph in the title row. Two equally weighted buttons appear only on destructive confirmations.
- Every interactive element — buttons, inputs, selects, icon buttons — has a 44×44px minimum hit area. Icon-only controls carry a mandatory, specific accessible name; in a list, per-row triggers must be named per row so they can be told apart.
- On an administration row, the account's actions belong in a single overflow menu at the right of the address line; its memberships belong in a labelled table (trip name, role as a select, remove), with owned trips shown separately outside that table and an explicit message when there are no memberships.
- A viewer's trip overview and day detail are the same screens with edit affordances suppressed; that reduced-permission state was never mocked, so it needs deliberate treatment rather than assumption.
- The design system's tokens are the source of truth for the rendered result; no fifth semantic color family exists, and destructive filled buttons use the darker warn tone for contrast.

## Cross-Story Dependencies

- Stories 5.2, 5.3, 5.4, and 5.6 all build on the provisioning and membership model established by Story 5.1.
- Story 5.10 extends the registered-users list from Story 5.8 and introduces the admin role that later gates it; Story 5.11 is purely a re-layout of Story 5.10's surface and adds no new capability.
- Story 5.9 is a removal that reaches into Epic 4 (bucket-list dialog comments) and Epic 6 (feedback UX refinements), all of which were withdrawn by the same decision. Sharing and roles are explicitly out of its blast radius.
- Story 5.12 depends on nothing new — the memberships it reads already exist from 5.1/5.4/5.6 — but it fixes a production defect where the dashboard query was the only trip read still filtering on ownership alone, and it requires the trip-list payload to gain per-entry access-role information.
- The account-deletion guard in Story 5.10 depends on the owner relation's cascade behaviour in the trip schema; verify the actual relation before implementing.
