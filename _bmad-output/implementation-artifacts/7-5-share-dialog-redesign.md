# Story 7.5: Share Dialog Redesign

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip owner,
I want the "Reise teilen" dialog to match the approved design system instead of default Material UI styling,
So that sharing feels like part of the same product as the rest of the redesigned app.

**FRs covered:** FR22, FR28 in `epics.md`'s own FR scheme (`epics.md:40,47` — "Users can share a trip with a viewer", "Owners can grant a contributor role with full edit permissions"). These are FR29 and FR32 in `prd.md`'s differently-ordered scheme (`prd.md:265,268`). The two documents number FRs differently; `epics.md` is the citation of record for this epic.

## Acceptance Criteria

**AC1** (epic, verbatim)
**Given** `mockups/trips-list-share-login.html` (Screen D) and `EXPERIENCE.md`'s Share Dialog component patterns
**When** the share dialog is rebuilt
**Then** it uses the established card/border/input conventions, and each collaborator's role (Contributor/Viewer/Owner) renders as a badge using the token-defined role colors

**AC2** (epic, verbatim)
**Given** I remove a collaborator
**When** I use the "Entfernen" action
**Then** it is sized to the 44×44px touch-target floor, not a bare unpadded text link

**AC3** (epic, verbatim)
**Given** the existing share/invite/role-change functionality
**When** the dialog is redesigned
**Then** all of it continues to work unchanged — this story is visual only

**AC4** (derived — AC1 names a role that has no data behind it)
**Given** the owner opens the share dialog
**When** `GET /api/trips/{id}/members` responds
**Then** the payload carries the trip owner's email alongside the collaborator list, and the owner renders as the **first** row of the access list with the warn-toned Owner badge and **no** remove action

**AC5** (derived — AC2 describes an action that does not exist)
**Given** the owner clicks "Entfernen" on a collaborator row
**When** the request completes
**Then** an owner-only, CSRF-protected `DELETE /api/trips/{id}/members` has deleted **only** that `TripMember` row — the `User` account and every other trip that user belongs to are untouched — and the list re-renders from the server's refreshed collaborator list

**AC6** (regression)
**Given** a non-owner (viewer or contributor) or an unauthenticated caller
**When** they call `GET` or `DELETE /api/trips/{id}/members`
**Then** they get the existing owner-gated `404` / `401` / `403` treatment — the new `DELETE` is gated exactly like the existing `POST`, not more loosely

### Scope note — read before Task 1

**AC3's "visual only" clause is superseded exactly twice, by AC4 and AC5. Nowhere else.** This is deliberate and follows the precedent Story 7.8 set when it superseded 7.2's AC3 for the import/export UI.

The reason is not ambition, it is that the epic's own ACs are unbuildable as written against the current code:

- **AC1 requires an `Owner` badge.** `GET /api/trips/{id}/members` returns `{ collaborators }` and nothing else (`src/app/api/trips/[id]/members/route.ts:39`). There is no owner email anywhere on the client. A third badge variant with no third row to put it on is not a deliverable.
- **AC2 requires an "Entfernen" action.** No remove affordance exists in `TripShareDialog.tsx`, no `DELETE` handler exists on the members route, and no delete function exists in `tripRepo.ts`. AC2 is written as Given/When/Then over a user action; it is only testable if the action exists. `DESIGN.md:243`, `DESIGN.md:266`, `EXPERIENCE.md:70` and `EXPERIENCE.md:92` all specify this action in four separate places, and Screen D renders it on two of its three rows.

**AC3's "role-change functionality" is a phantom — do not build it.** There is no role-change in the code (`POST` creates, nothing updates a role), and `EXPERIENCE.md:92` is explicit: *"no inline role-editing dropdown was mocked for existing collaborators, only remove."* Read AC3 as "invite, list, and the existing error/conflict handling keep working".

## Tasks / Subtasks

- [ ] **Task 1 — Owner email and delete on the data layer (AC4, AC5, AC6)**
  - [ ] `src/lib/repositories/tripRepo.ts`: add `getTripSharingForOwner(ownerUserId, tripId): Promise<{ owner: { email: string }; collaborators: TripCollaborator[] } | null>`. One `prisma.trip.findFirst({ where: { id: tripId, userId: ownerUserId }, select: { id: true, user: { select: { email: true } } } })`, then reuse the existing private `listTripCollaborators(prisma, tripId, ownerUserId)` helper (`tripRepo.ts:360-386`). Return `null` when the trip is missing or not owned — same contract as `listTripCollaboratorsForOwner` (`:1521`).
  - [ ] Leave `listTripCollaboratorsForOwner` in place if anything else still calls it; delete it only if `getTripSharingForOwner` becomes its sole replacement and no other caller exists (grep first).
  - [ ] `src/lib/repositories/tripRepo.ts`: add `deleteTripCollaboratorForOwner({ ownerUserId, tripId, memberId }): Promise<{ outcome: "not_found" } | { outcome: "missing" } | { outcome: "deleted"; collaborators: TripCollaborator[] }>`. Inside a `prisma.$transaction`: verify trip ownership → `tx.tripMember.findFirst({ where: { id: memberId, tripId, trip: { userId: ownerUserId } } })` → `tx.tripMember.delete({ where: { id: memberId } })` → return the refreshed list via `listTripCollaborators(tx, tripId, ownerUserId)`. Model the three-outcome shape on `deleteBucketListItemForTrip`.
  - [ ] **`tx.user.delete` must never appear in this function.** Removing a collaborator revokes access to one trip. A user provisioned by an earlier invite may hold memberships on other trips and owns their own login; deleting the account would silently destroy unrelated data.
  - [ ] The `memberId`-plus-`tripId`-plus-owner triple in the `where` is the tenancy guard — do not simplify it to `delete({ where: { id: memberId } })` on its own, or one owner can delete another trip's membership by guessing an id.
  - [ ] `src/lib/validation/tripMemberSchemas.ts`: add `deleteTripMemberSchema = z.object({ memberId: z.string().min(1) })` next to `createTripMemberSchema`.
  - [ ] `src/app/api/trips/[id]/members/route.ts`: `GET` now returns `ok({ owner: sharing.owner, collaborators: sharing.collaborators })`. `POST` is unchanged — it keeps returning `{ accountAction, collaborator, collaborators }` and the client merges into the list it already holds.
  - [ ] `src/app/api/trips/[id]/members/route.ts`: add `DELETE`, copying the guard order from the file's own `POST` (`:45-64`) — CSRF (`validateCsrf`, `403 csrf_invalid`) → `requireSession` → `params` → `hasTripOwnerAccess` (`404 not_found`) → `request.json()` in a try (`400 invalid_json`) → `deleteTripMemberSchema.safeParse` (`400 validation_error`) → repo. Map `not_found` and `missing` to `404`, wrap in `try/catch` → `500 server_error`. Respond `ok({ deleted: true, collaborators })`.
  - [ ] No Prisma migration, no schema change: `TripMember` already has the `id` this keys on, and `TripCollaborator` (`:255-259`) already carries `id` out of the repo.

- [ ] **Task 2 — Dialog chrome (AC1)**
  - [ ] `TripShareDialog.tsx` gains a `tripName: string` prop; `TripTimeline.tsx:888` passes `detail.trip.name`. The mockup's sub-line is trip-specific ("Portugal Roadtrip · Zugriff per E-Mail einladen") and the dialog has no other route to the name.
  - [ ] `<Dialog maxWidth={false} PaperProps={{ sx: { width: "100%", maxWidth: 460 } }}>` — the mockup's `.dialog` is `max-width: 460px` (`:230`); the current `maxWidth="sm"` is 600px. Radius 10 and the modal shadow already come from `theme.ts`'s `MuiDialog` override (`:357-364`) — do not restate them.
  - [ ] **Keep `<DialogTitle>` as the head container.** MUI derives the dialog's `aria-labelledby` from it; three tests resolve the dialog by `findByRole("dialog", { name: "Share trip" })`. Style the `DialogTitle` (`p: "20px 24px 16px"`, `borderBottom: 1px solid tokens.border`) and put the title + sub-line inside it. Do not replace it with a `Box`.
  - [ ] Head: title at 17px/900/`-0.2px`/`tokens.ink` (mockup `:241`); sub-line `${tripName} · ${t("trips.share.subtitle")}` at 12.5px/600/`tokens.inkSoft` (`:242`).
  - [ ] `<DialogContent>` — `p: "20px 24px"`, and **drop `dividers`** (the head/footer borders now do that job; `dividers` would double the rule).
  - [ ] `<DialogActions>` — `p: "16px 24px"`, `borderTop: 1px solid tokens.border`, `backgroundColor: tokens.cardAlt`, `justifyContent: "flex-end"` (mockup `:244-251`). One secondary "Schließen" button (`variant="outlined"`), which the theme already renders at 44px on the `tokens.borderStrong`/`tokens.card` treatment.
  - [ ] Alerts (`loadError`/`serverError`/`success`) stay where they are, at the top of the content region — that is `EXPERIENCE.md:86`'s not-attributable-error convention.
  - [ ] **Do not add `MuiDialogTitle`/`MuiDialogContent`/`MuiDialogActions` overrides to `theme.ts`.** Seven other dialogs mount that chrome (`TripEditDialog`, `TripDeleteDialog`, `TripAccommodationDialog`, `TripDayPlanDialog`, `TripImportDialog`, `TripDayTravelSegmentDialog`, `TripCreateDialog`), and four of them belong to Story 7.7 or to no redesign story at all. Keep the treatment local to this file; 7.7 can lift it out when it has a second consumer.

- [ ] **Task 3 — Invite row (AC1, AC3)**
  - [ ] Section label "Person einladen" above the row: 11px/800/`0.06em`/uppercase/`tokens.inkSoft`, `mb: "7px"` (mockup `:253`). Render it as a real `<label htmlFor>` bound to the email input, or as a `Typography` plus an explicit `aria-label` on the field — see the accessible-name contract below.
  - [ ] Single-line compose row (`EXPERIENCE.md:92`): email `TextField` (`flex: 1`) + role `TextField select` (`minWidth: 118`) + primary "Einladen" `Button` — `display: flex; gap: 10px`, `alignItems: "flex-start"` so a field error message does not shove the button downward. All three are already 44px from `theme.ts` (`MuiOutlinedInput` `:279`, `MuiButton` `:253`); verify the computed box rather than assuming.
  - [ ] Collapse to a stacked column at `xs` via an `sx` breakpoint object (`{ xs: "column", sm: "row" }`). **No `useMediaQuery`** — `data-layout` JS breakpoint re-derivation is a deferred finding from 7.2, do not replicate it.
  - [ ] **Keep the temporary-password field.** The mockup omits it because Screen D was drawn against the design system, not against the real invite flow; it is required whenever the invite creates a brand-new account (`createTripCollaboratorForOwner` returns `validation_error` on `temporaryPassword` without it, and `test/tripMembersRoute.test.ts:413` pins that). Render it as a full-width field block below the invite row, keeping `trips.share.temporaryPasswordHelp` as its hint in `tokens.inkMuted` at 11px (mockup `.field-hint`, `forms-authoring.html:286`).
  - [ ] Keep the native `<select>` (`SelectProps={{ native: true }}`) — `userEvent.selectOptions` in three existing tests depends on it, and the mockup's control is a plain `select`.
  - [ ] Keep `react-hook-form` registration, `resolveApiError`, and the field-level `setError` mapping exactly as they are. This story restyles the form; it does not re-plumb it.

- [ ] **Task 4 — Access list, role badges, and the owner row (AC1, AC2, AC4)**
  - [ ] Section label `formatMessage(t("trips.share.accessLabel"), { count })` → "Zugriff (3)", where **count includes the owner**. Same 11px caps treatment as Task 3.
  - [ ] **Keep `<List>` / `<ListItem>`.** Two existing assertions call `.closest("li")` on a collaborator email, and a list of people is genuinely a list for assistive tech. Style them (`disablePadding` on the `List`, `disableGutters` + `py: "12px"` on each `ListItem`); do not swap to `Box`.
  - [ ] `List` gets `borderTop: 1px solid tokens.border`; each `ListItem` gets `borderBottom: 1px solid tokens.border` with `"&:last-child": { borderBottom: "none" }` (mockup `:278-285`). Use the `:last-child` selector, **not** MUI's `divider` prop on all-but-the-last item — 7.8 calls this out as the established idiom.
  - [ ] Row layout: email left (13px/700/`tokens.ink`), a right-aligned actions cluster (`display: flex; gap: 10px; alignItems: center`) holding the role badge and, for non-owners, the remove button.
  - [ ] Owner row renders **first**, before every collaborator, from the new `owner.email`. It has the Owner badge and no remove button.
  - [ ] Role badge — one small component in this file, driven by `"owner" | "viewer" | "contributor"`. Shared spec: `borderRadius: "5px"`, `padding: "5px 10px"`, `fontSize: 10.5`, `fontWeight: 800`, `letterSpacing: "0.04em"`, `textTransform: "uppercase"`, `whiteSpace: "nowrap"` (mockup `:290-298`). Variants, all from theme tokens — **no new hex literals**:

    | Variant | Background | Text |
    |---|---|---|
    | contributor | `theme.palette.primary.main` (`#4B6358`) | `#FFFFFF` (use `theme.palette.primary.contrastText`) |
    | viewer | `tokens.accentSoft` (`#E7EDE7`) | `theme.palette.primary.main` |
    | owner | `tokens.warnBg` (`#F6ECE0`) | `theme.palette.warning.main` (`#8A5A2B`) |

  - [ ] The owner badge is the **one sanctioned non-gap use of the warn family in this system** — it is specified verbatim at `DESIGN.md:239` and mocked at `:301`. Do not "correct" it to a neutral token, and do not treat it as licence to use warn decoratively anywhere else.
  - [ ] Empty state: with the owner row always present the list is never truly empty, so render `trips.share.empty` as a caption **below** the owner row when `collaborators.length === 0`, not in place of the whole list.
  - [ ] Loading: keep the existing centred `CircularProgress` while the open-fetch is in flight. `EXPERIENCE.md:85` reserves skeletons for full route loads and explicitly permits a small inline spinner inside a dialog.

- [ ] **Task 5 — The Entfernen action (AC2, AC5)**
  - [ ] Add `id: string` to the component-local `TripCollaborator` type (`TripShareDialog.tsx:27-30`). The repo and both API responses already carry it; only this local type omits it.
  - [ ] Render `<Button variant="text">` with `minHeight: 44, minWidth: 44, px: 1.5, color: theme.palette.warning.main, fontSize: 11.5, fontWeight: 700`. `DESIGN.md:243` and `EXPERIENCE.md:70` are explicit that this keeps its link-like look (text, no fill, no border) while carrying a real ≥44×44px hit area. The theme's `MuiButton` root already sets `minHeight: 44`; restate `minWidth` because a short word like "Entfernen" would otherwise render narrower than 44px at `xs`.
  - [ ] `aria-label` = `formatMessage(t("trips.share.removeAria"), { email })` — "Entfernen" alone repeated three times is not a distinguishing accessible name.
  - [ ] Handler: `DELETE /api/trips/{tripId}/members` with `credentials: "include"`, `Content-Type: application/json`, the `x-csrf-token` header from the token already fetched on open, and `body: JSON.stringify({ memberId })`. On success, replace state from `body.data.collaborators`; on failure, `setServerError(resolveApiError(body.error?.code))` with a new `trips.share.removeError` default.
  - [ ] Track the in-flight member id in local state and disable that one row's button while the request is open. Do not disable the whole dialog.
  - [ ] **No confirmation dialog.** The mockup shows none, revoking access is reversible by re-inviting, and the codebase reserves confirm-dialogs for destructive-and-irreversible actions (`TripDeleteDialog`). If you disagree, record it in Dev Agent Record — do not add one silently.
  - [ ] If `csrfToken` is null (the open-fetch failed), the remove button must not fire a tokenless request — surface `errors.csrfMissing` the same way `onSubmit` already does at `:161-164`.

- [ ] **Task 6 — i18n (AC1, AC2, AC4)**
  - [ ] New keys in **both** `src/i18n/en.ts` and `src/i18n/de.ts`, placed with the existing `trips.share.*` block (`en.ts:157-175`, `de.ts:156-174`):

    | Key | en | de |
    |---|---|---|
    | `trips.share.subtitle` | `Invite access by email` | `Zugriff per E-Mail einladen` |
    | `trips.share.inviteLabel` | `Invite person` | `Person einladen` |
    | `trips.share.accessLabel` | `Access ({count})` | `Zugriff ({count})` |
    | `trips.share.roleOwner` | `Owner` | `Eigentümer` |
    | `trips.share.remove` | `Remove` | `Entfernen` |
    | `trips.share.removeAria` | `Remove {email}` | `{email} entfernen` |
    | `trips.share.removeError` | `Unable to remove collaborator. Please try again.` | `Person konnte nicht entfernt werden. Bitte erneut versuchen.` |
    | `common.close` | `Close` | `Schließen` |

  - [ ] Change `trips.share.submit` from "Add collaborator"/"Person hinzufügen" to **"Invite"/"Einladen"**. `DESIGN.md:243` enumerates the system's primary-button labels and names this one "Einladen". Keep the key; change only the values. This breaks five assertions — Task 7 owns them.
  - [ ] Interpolate with `formatMessage` from `@/i18n` (`src/i18n/index.ts:23`) — `t()` takes a key only and does no substitution.
  - [ ] Do **not** rename `roleViewer`/`roleContributor`. The mockup prints the English words "Viewer"/"Contributor" in its German composition, but the app has shipped "Betrachter"/"Mitwirkender" since Story 5.1 and they appear in the role `<select>` as well as the badges. `EXPERIENCE.md:47` mandates German UI copy; the mockup's untranslated labels are a mockup shortcut, not a copy decision.
  - [ ] Check for orphans before finishing: `trips.share.temporaryPasswordLabel` and `trips.share.existingAccountError` may already be unreferenced. Grep; delete only what has no call site, and say which in Dev Agent Record.

- [ ] **Task 7 — Tests (all ACs)**
  - [ ] `test/tripTimelineSharing.test.tsx` — update all five `{ name: "Add collaborator" }` button queries to `"Invite"` (`:153, :272, :281, :376, :382`). Add `owner: { email: "owner@example.com" }` to each of the three `GET /members` mock responses; the dialog will read it. Everything else in this file must keep passing unchanged, including the two `closest("li")` assertions.
  - [ ] **New `test/tripShareDialog.test.tsx`** — the dialog has never had a direct test; it is only reached through `TripTimeline`, which now costs three fetch mocks per case. Render `TripShareDialog` directly under `renderWithProviders` (`test/helpers/renderWithProviders.tsx` — the theme wrapper is mandatory the moment this file reads `theme.palette.tokens.*`; this is the trap 7.3 and 7.4 both hit). Cover: (a) the owner row renders first with the Owner badge and **no** remove button; (b) a contributor and a viewer row each render their badge text; (c) the access-label count includes the owner; (d) clicking Entfernen issues `DELETE` with the right `memberId` and `x-csrf-token`, and the row disappears from the re-rendered list; (e) a failed `DELETE` surfaces `trips.share.removeError` and leaves the row in place; (f) the remove button's accessible name names the collaborator; (g) the temporary-password field is still present and labelled.
  - [ ] `test/tripMembersRoute.test.ts` — extend the existing `GET` test (`:455`) to assert the **full response key set** (`["collaborators", "owner"]`, sorted) plus `owner.email`. A payload key-set assertion is what caught a missing field last time (deferred-work, 2026-08-01). Then add `DELETE` cases: owner removes a member and the response carries the shortened list; **`prisma.user.findUnique` still finds the removed collaborator's account afterwards**; a contributor gets `404`; an unauthenticated caller gets `401`; a missing CSRF header gets `403`; an unknown `memberId` gets `404`; a `memberId` belonging to a *different* trip gets `404` and that membership survives. Use the file's existing `buildRequest` helper (`:14`) — it already threads session and CSRF cookies.
  - [ ] `test/tripCollaborationRepo.test.ts` — one repo-level test that `deleteTripCollaboratorForOwner` removes the `TripMember` row, leaves the `User` row intact, and leaves that user's membership on a second trip intact.
  - [ ] Run `npm test`, `npx tsc --noEmit -p .`, and `eslint` on the touched files, all from `travelplan/`. Establish the baseline with `git stash` rather than assuming: 7.4 recorded 551 tests / 152 tsc errors / 3 eslint warnings at its own baseline, and 7.4 itself has landed since. Triage each failure as a stale assertion (fix it, say so) or a real regression (fix the code). Do not delete assertions in bulk.
  - [ ] `TripShareDialog.tsx` is one of the 12 files where `react-hooks/set-state-in-effect` is downgraded to `warn` (`eslint.config.mjs:31`). Existing warnings in this file are expected and deferred; do not attempt the effect refactor here, and do not add new sites.
  - [ ] Manual browser check on a real dev server against a **throwaway** database — never `prisma/dev.db`, which holds Tommy's real trip data (the suite destroyed real uploads once already; see deferred-work 2026-08-01). Seed one trip with an owner plus one contributor plus one viewer, then verify: the 460px dialog, head/body/footer chrome, the three badges, the invite row on one line at desktop and stacked at 390px, a successful invite, a successful removal, the removed user's account still able to log in, keyboard focus reaching and firing Entfernen, and the computed height of every interactive element ≥44px.

## Dev Notes

### Scope boundary

This story owns **one component and one API route**: `TripShareDialog.tsx` and `src/app/api/trips/[id]/members/route.ts`, plus the two repository functions and the one Zod schema they need. Do **not** touch:

- `TripTimeline.tsx` beyond the single `tripName` prop at `:888`. Story 7.2 owns that page's layout and it is `done`; Story 7.8 is `ready-for-dev` against its lower sections right now. A layout edit here will collide.
- `TripCreateDialog.tsx` / `TripEditDialog.tsx` / `TripAccommodationDialog.tsx` / `TripDayPlanDialog.tsx` / `TripImportDialog.tsx` / `TripDayTravelSegmentDialog.tsx` — Story 7.7 owns the create/add-entry dialogs; the rest have no redesign story yet. They already pick up 7.1's theme-level primitives and do not look broken.
- The auth screens (7.6) and the trips list (7.4, currently in `review`).
- `theme.ts`. Every token this story needs already exists there. If you find yourself adding one, that is a signal the value belongs in a component, not that the token set is incomplete.
- `src/lib/auth/tripAccess.ts` and `hasTripOwnerAccess`. You are *calling* the existing owner gate, not changing it.

### The two data gaps are the story

7.2 and 7.3 were pure re-skins because their payloads already carried everything the mockups showed. This one does not, in exactly two places (owner email, delete endpoint), and those are the only places a CSS review would not catch a mistake. Both are small; both touch authorization. Three rules keep them safe:

1. **The new `DELETE` is gated identically to the existing `POST`.** Copy the guard order from the same file rather than re-deriving it. `POST` is CSRF → session → owner → parse → validate; anything looser on `DELETE` is an access-control bug, not a style difference.
2. **Tenancy lives in the `where` clause, not in a prior `if`.** `tripMember.delete({ where: { id } })` after a separate ownership check is a TOCTOU shape and reads as safe when it is not. Put `tripId` and `trip: { userId: ownerUserId }` into the same query that finds the row.
3. **Deleting a membership is not deleting a person.** `TripMember` and `User` are separate models with separate lifecycles (`prisma/schema.prisma:42,99`). Story 5.1 provisions accounts on invite, so the temptation to "clean up" the account it created is real and wrong — that account may own trips, hold other memberships, and have gone through the first-login password change (Story 5.2). AC5 and a repo test both pin this.

### What must not be built

Every item below has been considered and ruled out. Building any of them is scope creep, not thoroughness:

- **Role change for an existing collaborator.** `EXPERIENCE.md:92`: *"no inline role-editing dropdown was mocked for existing collaborators, only remove."* The `<select>` in the invite row sets the role for a *new* invite only. AC3's mention of "role-change functionality" describes something that has never existed.
- **A share link / public URL / email notification.** Sharing here is "provision an account and link it to the trip" (Stories 5.1, 5.6). Screen D is a re-skin of that, not a redesign of the sharing model.
- **A confirmation dialog before removal.** See Task 5.
- **Theme-level dialog chrome overrides.** See Task 2.
- **A self-removal or leave-trip affordance for collaborators.** The dialog is owner-only (`TripTimeline.tsx:434` gates it behind `isOwner`).
- **Widening `listTripsForUser` so shared trips appear on a collaborator's dashboard.** A real product gap, recorded by 7.4 for the backlog, and firmly not this story.

### Test contracts this story will break — the exact list

`test/tripTimelineSharing.test.tsx` is the only file pinning this component today, and it pins the dialog through accessible names. Know these before writing a line:

| Pinned by | Where | What it means for you |
|---|---|---|
| `findByRole("dialog", { name: "Share trip" })` | `:148, :266, :373` | Keep `<DialogTitle>` as the head, or set `aria-labelledby` yourself |
| `getByLabelText("Email")` | `:150, :270, :375, :380` | The email field's accessible name stays exactly `Email` (`auth.emailLabel`) |
| `getByLabelText("Role")` | `:151, :271` | Native `<select>`, accessible name stays `Role` |
| `getByLabelText("Temporary password (new accounts only)")` | `:152, :268` | Keep the field **and** its full label string |
| `getByRole("button", { name: "Add collaborator" })` | `:153, :272, :281, :376, :382` | **Will break** — Task 6 renames it to "Invite"; update all five |
| `collaboratorEmail.closest("li")` has text `Viewer` / `Contributor` | `:157, :277` | Keep `<ListItem>`; keep the role text inside the same `<li>` |
| Alert texts for `trip_member_exists`, `trip_owner_email`, network failure | `:274, :283, :378, :384` | Keep `resolveApiError` and the alert placement |

The three `GET /api/trips/{id}/members` mocks in that file return `{ collaborators: [] }` with no `owner`. Add `owner` to all three, and make the component tolerate its absence rather than crashing — a missing `owner` should render the list without an owner row, not throw.

### Reference implementations to copy, not re-derive

| Pattern | Reference |
|---|---|
| Owner-gated route with CSRF, session, params, envelope | `src/app/api/trips/[id]/members/route.ts:45-116` (the `POST` in the same file) |
| `DELETE` handler shape and three-outcome mapping | `src/app/api/trips/[id]/bucket-list-items/route.ts:211-256` |
| Transactional repo write with ownership in the `where` | `tripRepo.ts:1546-1600` (`createTripCollaboratorForOwner`) |
| Collaborator list projection | `tripRepo.ts:360-386` (`listTripCollaborators`) |
| `card`-family surface at token values | `TripTimeline.tsx:765` |
| Caps section label | `Typography variant="labelCaps"` (`theme.ts:216`) |
| Pill/badge with token background + icon-free text | `TripsDashboard.tsx` trip-status pill (Story 7.4) |
| `:last-child` divider suppression | `TripDayBucketListPanel.tsx` (Story 7.3) |
| Route test harness (real Prisma, session JWT, `NextRequest`, CSRF cookie) | `test/tripMembersRoute.test.ts:1-44` |
| Provider-wrapped component render | `test/helpers/renderWithProviders.tsx` |
| Message interpolation | `formatMessage` (`src/i18n/index.ts:23`), used at `TripsDashboard.tsx:184` |

### Token mapping — mockup hex to theme token

Every colour Screen D uses already exists in `theme.ts`. **This story adds no new hex literal.** Hardcoded-literal debt from 7.2 is already on the deferred list; do not grow it.

| Mockup | Token |
|---|---|
| `#FFFFFF` dialog surface | `tokens.card` (or leave it to `MuiDialog`'s default paper) |
| `#FBF9F4` footer, input fill | `tokens.cardAlt` |
| `#E4DFD3` head/footer/list rules | `tokens.border` |
| `#D9D0BE` input + select borders | `tokens.borderStrong` |
| `#2B2A26` title, email | `tokens.ink` |
| `#6B675C` sub-line, section labels | `tokens.inkSoft` |
| `#8A8677` placeholder, hint | `tokens.inkMuted` |
| `#4B6358` primary button, contributor badge, viewer badge text | `palette.primary.main` |
| `#E7EDE7` viewer badge fill | `tokens.accentSoft` |
| `#8A5A2B` owner badge text, Entfernen | `palette.warning.main` |
| `#F6ECE0` owner badge fill | `tokens.warnBg` |

`tokens.inkMuted` is a known AA failure at small sizes (deferred from 7.3). Use it only for the placeholder and the temporary-password hint, exactly as the mockup does; anything a user must read to act uses `tokens.inkSoft`.

### Typography traps

- The custom variants (`display`, `heading`, `metricLg`, `cardTitle`, `kicker`, `labelCaps`) have **no `variantMapping`** — `<Typography variant="labelCaps">` renders a `<span>` unless you pass `component=`. This bit 7.2 and 7.3 both. Nothing on this surface needs a heading level (a dialog title is not a page heading and `DialogTitle` already renders `<h2>` by default), so the trap here is only about `<span>`s where you wanted block elements: set `component="div"` on the section labels.
- `labelCaps` is 10.5px/`0.08em`; the mockup's `.field-label` is 11px/`0.06em`. Close but not identical. Use `variant="labelCaps"` with an `sx` override for the two values rather than inventing a variant or writing the whole style inline.

### Responsive behaviour

`EXPERIENCE.md:19` states this design pass mocked desktop only. Follow the established resolution: pure-CSS MUI breakpoint objects in `sx` (`{ xs: …, sm: … }`), never `useMediaQuery`. Two things change at `xs`: the invite row stacks to a column (email, then select, then a full-width button), and a collaborator row is allowed to wrap its actions cluster below the email if the email is long. A 460px dialog on a 390px viewport is already handled by MUI's `Dialog` margins — verify no horizontal overflow rather than adding your own `fullScreen` breakpoint.

### Accessibility floor

No formal WCAG claim (`prd.md:207`, `EXPERIENCE.md:99`) — these are the project's stated basics:

- 44×44px on every interactive element, Entfernen explicitly included (`DESIGN.md:266`, `EXPERIENCE.md:106`). Measure the computed box in the browser check; do not infer it from the theme.
- Visible keyboard focus on the invite button, the remove buttons, and the close button. `EXPERIENCE.md:95` notes focus visuals were never mocked — MUI's default ring plus the theme's accent focus ring on inputs satisfies the floor; do not suppress either.
- The remove button's accessible name names the collaborator (Task 5). Three buttons all named "Entfernen" is exactly the "icon/label is not the sole distinguishing signal" failure the floor guards against.
- Role badges are text, not colour alone — keep the word in the badge (`DESIGN.md:239`: colour is never the sole signal).
- Error text stays paired with its field for validation errors, and in the top alert for everything else (`EXPERIENCE.md:71, 86`).

### Previous story intelligence

From `7-4-trips-list-redesign.md` (status `review`) and the 7.2/7.3 records — these are re-applied rules, not discoveries to repeat:

- A component that reads `theme.palette.tokens.*` **throws** under MUI's bare default theme. Any test file rendering it must use `renderWithProviders`. 7.3 and 7.4 both lost time to this; the new `tripShareDialog.test.tsx` must start there.
- Extract shared pure helpers rather than inlining novel logic (7.4 pulled out `tripStatus.ts` and `formatCost.ts`). Nothing in this story qualifies — the role-badge variant map is presentational and belongs in the component.
- 7.4 moved `ROW_GAP_BG` into `TripIcons.tsx` rather than duplicating it. Same instinct applies if you need any shared value here; you probably do not.
- A payload key-set assertion caught a missing field during the hero-image investigation. That is why Task 7 asks for one on the `GET` response.
- 7.4 is in `review` and touched `TripIcons.tsx`, `tripRepo.ts`, and `src/app/api/trips/route.ts`. This story touches `tripRepo.ts` too, but at the other end of the file (the collaborator block, `:255-386` and `:1521+`, versus 7.4's `listTripsForUser` around `:417`). Rebase cleanly; do not "tidy" anything 7.4 added.

### Git intelligence

Recent commits (`57c438d` … `cb97ebe`) are the redesign sequence itself: `7-1-design-token-foundation` → `7-2-trip-overview-redesign` → `7-3-day-detail-redesign`, then `5-9-remove-comments-and-voting-feature`. The working tree already carries uncommitted 7.4 and 7.8 work (`TripsDashboard.tsx`, `TripTimeline.tsx`, `TripIcons.tsx`, `tripRepo.ts`, `src/app/api/trips/route.ts`, both i18n files, plus new files under `src/lib/trips/`). Check `git status` before starting and keep this story's diff off those files apart from the sanctioned one-line `tripName` prop.

Established convention from those four commits: one commit per story, tests in the same commit as the code, i18n keys added to both dictionaries in the same change, and no new dependency.

### Latest technical information

No new library, no version bump, no migration. Everything this story needs is already installed and pinned:

- `@mui/material` ^7.3.8 — `Dialog`/`DialogTitle`/`DialogContent`/`DialogActions`, `List`/`ListItem`, `TextField`, `Button`, `Alert`, `CircularProgress`. All already imported by this file. MUI 7 still derives `aria-labelledby` from a `DialogTitle` child, which is what the three dialog-by-name queries rely on.
- `react-hook-form` ^7.71.1 — unchanged usage.
- `zod` ^4.1.11 — one new object schema; `z.enum` message syntax already in use in `tripMemberSchemas.ts`.
- `@prisma/client` ^7.3.0 with the better-sqlite3 adapter — `tripMember.delete` inside `$transaction`, no schema change.
- `next` 16.2.12 App Router — route handlers export named HTTP verbs; `context.params` is a `Promise` in this version (every handler in the file already awaits it).
- Vitest ^3.2.7 with `@testing-library/react` ^16.3.2 and `user-event` ^14.6.1.

### Project Structure Notes

Files expected to change:

| Status | Path | Why |
|---|---|---|
| M | `travelplan/src/lib/repositories/tripRepo.ts` | `getTripSharingForOwner`, `deleteTripCollaboratorForOwner` (Task 1) |
| M | `travelplan/src/lib/validation/tripMemberSchemas.ts` | `deleteTripMemberSchema` (Task 1) |
| M | `travelplan/src/app/api/trips/[id]/members/route.ts` | `GET` payload + new `DELETE` (Task 1) |
| M | `travelplan/src/components/features/trips/TripShareDialog.tsx` | Primary rebuild (Tasks 2–5) |
| M | `travelplan/src/components/features/trips/TripTimeline.tsx` | One line: `tripName` prop (Task 2) |
| M | `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` | 8 new keys, 1 changed value (Task 6) |
| M | `travelplan/test/tripTimelineSharing.test.tsx` | Renamed button, `owner` in mocks (Task 7) |
| M | `travelplan/test/tripMembersRoute.test.ts` | Key-set assertion + `DELETE` cases (Task 7) |
| M | `travelplan/test/tripCollaborationRepo.test.ts` | Membership-vs-account repo test (Task 7) |
| A | `travelplan/test/tripShareDialog.test.tsx` | **New** — first direct test of this component (Task 7) |
| M | `_bmad-output/implementation-artifacts/sprint-status.yaml` | Status transitions |

This matches `architecture.md`'s boundaries: data access only via `lib/repositories/*`, the public API surface only under `app/api/**/route.ts`, validation only in `lib/validation/*` with Zod, feature components under `components/features/*`, the `{ data, error }` envelope, camelCase JSON. No schema migration, no new dependency, no Redux slice. If any of those seem necessary, the change belongs in a different story.

### References

- `_bmad-output/planning-artifacts/epics.md` → "Epic 7: Visual Redesign — Light Cockpit System" (`:1549-1551`, the epic's framing and source-of-truth pointer) → "Story 7.5: Share Dialog Redesign" (`:1645-1665`, ACs 1–3 copied verbatim above). Sibling scope: 7.4 (`:1623`, `review`), 7.6 (`:1667`), 7.7 (`:1685`), 7.8 (`:1703`, `ready-for-dev`, and the precedent for superseding a prior AC). FR inventory `:19-51` (FR22 at `:40`, FR28 at `:47`); "Additional Requirements" `:73` (CSRF on every state-changing request) and `:82` (44×44px touch targets, visible focus, full keyboard navigation).
- `_bmad-output/planning-artifacts/prd.md` — FR29/FR30/FR32 (`:265-268`, the sharing capability in the PRD's own numbering); "Accessibility Level" (`:207`, no formal standard, basic best practices only).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — front-matter `colors`, `spacing`, `rounded` (`:10-88`), `components.badge-pill.role-badge-radius` (`:138`), `components.button` (`:154-160`), `components.input`/`select` (`:161-174`), `components.card` (`:130-134`); prose "Colors" (`:205`, warn reserved for gaps), "Elevation & Depth" (`:225`, the modal is one of only three shadowed elements), "Shapes" (`:229`, dialogs at 10px), "Components → badge / pill" (`:239`, the three role-badge treatments — the owner badge is the sanctioned warn exception), "→ button" (`:243`, `Entfernen` is a sized button variant, not a text link), "Do's and Don'ts" (`:266`, the 44px floor supersedes the original Share Dialog mockup's smaller paddings, naming `Entfernen` explicitly).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md` — "Foundation" (`:19`, desktop-only mockups; `:21`, MUI-as-substrate unconfirmed but tokens are the source of truth for the result), "Information Architecture" (`:32`, Share Dialog reached from Trip Overview; `:37`, the Form-Bausteine sheet backs every form row here), "Voice and Tone" (`:47`, German UI copy, concrete not corporate), "Component Patterns → button" (`:70`) and "→ input / select" (`:71`), "State Patterns" (`:85` inline spinner permitted in a dialog, `:86` non-field errors as a top banner), "Interaction Primitives" (`:92`, the single-line invite row, remove-only with no role editing, `Entfernen` as a real ≥44px target; `:95`, hover/focus never mocked), "Accessibility Floor" (`:103-107`), "Key Flow 3" (`:136`, Tom invites Konni as a Viewer).
- `.../mockups/trips-list-share-login.html` — Screen D markup at `:535-590` and its CSS at `:220-306`: `.dialog` `:228`, `.dialog-head` `:237`, `.dialog-title` `:241`, `.dialog-sub` `:242`, `.dialog-body` `:243`, `.dialog-footer` `:244`, `.field-label` `:253`, `.invite-row` `:254`, `.input` `:255`, `.select` `:266`, `.collab-list` `:278`, `.collab-item` `:279`, `.collab-email` `:287`, `.collab-actions` `:288`, `.role-badge` + its three variants `:290-301`, `.remove-link` `:303`. **The `.input`/`.select`/`.primary-btn` heights in this file predate the accessibility fix** — `DESIGN.md:266` supersedes them with the 44px primitives in `mockups/forms-authoring.html:227-325` (`.field-input`, `.field-select`, `.btn-primary`, `.btn-secondary`, `.field-hint`). Use the forms sheet for sizing and this file for structure.
- `_bmad-output/implementation-artifacts/7-4-trips-list-redesign.md` — "Typography traps", "Accessibility floor", "Project Structure Notes", and the whole Dev Agent Record (the provider-wrapper trap, the throwaway-database rule, the payload key-set lesson, the baseline-by-`git stash` procedure).
- `_bmad-output/implementation-artifacts/deferred-work.md` — "code review of 7-2" (`:23`, hardcoded-literal debt; `:25`, why `data-layout`/`useMediaQuery` must not be replicated), "code review of 7-3" (`:46`, `inkMuted` contrast), "npm-audit-zero-vuln-gate" (`:8`, `TripShareDialog.tsx` is in the `set-state-in-effect` warn-scoped list), "hero-image investigation" (`:32`, why the browser check uses a throwaway database).
- `travelplan/src/components/features/trips/TripShareDialog.tsx` (300 lines — **read in full**; every current-state line reference above is from this file), `TripTimeline.tsx:434-443, 888` (the owner-gated trigger and the mount point), `src/theme.ts` (tokens, custom variants, `MuiButton`/`MuiOutlinedInput`/`MuiSelect`/`MuiDialog` overrides).
- `travelplan/src/app/api/trips/[id]/members/route.ts` (117 lines — read in full), `src/lib/repositories/tripRepo.ts:255-287` (`TripCollaborator` and the create result union), `:358-386` (`listTripCollaborators`), `:1521-1535` (`listTripCollaboratorsForOwner`), `:1537+` (`createTripCollaboratorForOwner`); `src/lib/auth/tripAccess.ts` (the role model); `src/lib/validation/tripMemberSchemas.ts`; `prisma/schema.prisma:42-114` (`User`, `Trip`, `TripMember` — confirms the separate lifecycles and the `TripMember.id` this story keys deletes on).
- `travelplan/test/tripTimelineSharing.test.tsx` (388 lines — the contracts to preserve or deliberately update), `test/tripMembersRoute.test.ts` (the route harness), `test/tripCollaborationRepo.test.ts`, `test/helpers/renderWithProviders.tsx`, `travelplan/eslint.config.mjs:31`.
- `_bmad-output/planning-artifacts/architecture.md` — "Structure Patterns" (`:241`), "Format Patterns" (`:256`, the `{ data, error }` envelope and camelCase JSON), "Architectural Boundaries" (`:392`, repositories are the only data access, Zod validation in `lib/validation/*`).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev. AC1–AC3 copied verbatim from `epics.md`; AC4–AC6 added because AC1's Owner badge and AC2's Entfernen action both require data and an endpoint that do not exist — see the Scope note.
