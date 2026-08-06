---
authored_against: 0fcfff9
baseline_commit: 0fcfff9c098c95e7a86551873b0669005e470ff1
---

# Story 5.13: What a Contributor May Do, Made Consistent

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Reported from real use on production, 2026-08-06

A contributor on a shared trip could not add photos to activities. Every attempt produced an error; the owner's own uploads worked. The account was fine, the invitation was fine, and nothing was broken — the rule is that media writes are owner-only, and it has been since Story 2.16.

This is **DW-182**, already in the ledger and recorded there as *"Confirmed as intentional-for-now by Tommy on 2026-08-05"*. That confirmation was made against a design argument. It was withdrawn a day later, against a person using the app. This story is the withdrawal.

## The line as it stands is not defensible

Sorted by which gate each route carries:

| A contributor **may** | A contributor **may not** |
|---|---|
| Edit the trip itself — name, dates (`PATCH /api/trips/[id]:132`) | Attach or remove a photo on an activity |
| Create, edit, **delete**, copy a stay | Attach or remove a document |
| Create, edit, **delete**, move an activity between days | Set a day's image |
| Create and edit travel segments | Add an idea to the bucket list |
| | Export a backup |

She may delete an entire activity but not attach a picture to it. She may rename your trip but not set a day image. There is no principle behind that split — it is chronology: the gallery routes were written in Story 2.16, before Story 5.4 introduced the contributor role at all, and Story 9.1 copied the same gate onto the document routes rather than diverging mid-dialog. That was the right call at the time and it doubled the inconsistency.

## The rule this story applies

> **Content: yes. The trip as a possession: no.**

**Moves to owner-or-contributor:** the four media routes (activity images, stay images, activity documents, stay documents), the day image, the bucket list, and the backup export.

**Stays owner-only, deliberately:**

- **`members`** — who else gets access. A contributor must not be able to add someone, and above all must not be able to remove the owner. This is the boundary that has to hold.
- **Deleting the trip** — already correct, and enforced one layer down rather than in the route: `deleteTripForUser` scopes `deleteMany({ where: { id: tripId, userId } })` (`tripRepo.ts:2841`). `DELETE /api/trips/[id]:239` carries no route gate of its own, which looks like an omission and is not. **Do not "fix" it by adding one, and do not widen the repository scope.**
- **`hero-image`** — the trip's identity picture on the dashboard card, not day content. Owner's call. This is a judgement, not a derivation; it was decided explicitly rather than defaulted.

A `VIEWER` gains nothing anywhere in this story.

## Story

As someone invited to help plan a trip,
I want to add photos, documents and ideas to the things I am already allowed to create and delete,
so that "contributor" means what it says instead of stopping at the parts that carry a file.

## Acceptance Criteria

1. **AC1** — A `CONTRIBUTOR` can add and remove photos and documents on both activities and stays, on all four media routes.
2. **AC2** — A `CONTRIBUTOR` can set and remove a day's image, add and remove bucket-list ideas, and export a backup.
3. **AC3** — A `CONTRIBUTOR` still cannot manage members, cannot change the trip hero image, and cannot delete the trip. Each of the three is asserted as a **negative** test, because these are the properties the story could plausibly break.
4. **AC4** — A `VIEWER` can still do none of the above, and can still read everything they could read before.
5. **AC5** — Both layers move together for every widened route: the route's access gate **and** the repository's scope. A route that admits a caller whose repository query then refuses them is a 404 that reads as a bug.
6. **AC6** — Where a request is refused for the caller's **role** on a trip they are already a participant of, the response says so — `403 forbidden` — instead of reporting the object as non-existent. Refusals to non-participants keep answering `404`, unchanged.
7. **AC7** — The dialogs that perform these writes translate a `forbidden` response into a message about permission. Any new string exists in both dictionaries.

## Tasks / Subtasks

- [ ] `src/lib/repositories/accommodationRepo.ts` — `findScopedAccommodation` (`:135`) currently scopes `trip: { userId }`. Widen it to `trip: { OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] }` — **exactly the clause `findTripDayForTripWriter` already uses eleven lines above it** (`:124-133`). Do not invent a new spelling; the file already contains the correct one — AC1, AC5
- [ ] `src/lib/repositories/dayPlanItemRepo.ts` — the same to `findScopedDayPlanItem` (`:232`), against the same model in the same file (`findTripDayForTripWriter`, `:205`) — AC1, AC5
- [ ] `src/lib/repositories/accommodationRepo.ts`, `dayPlanItemRepo.ts` — leave `findScoped…ForTripParticipant` (`:149` / `:246`) untouched. Those are the **read** scopes and already admit everyone; widening the write scope must not accidentally converge the two, because the participant scope admits `VIEWER` — AC4
- [ ] `src/app/api/trips/[id]/accommodations/images/route.ts`, `.../accommodations/documents/route.ts`, `.../day-plan-items/images/route.ts`, `.../day-plan-items/documents/route.ts` — swap `hasTripOwnerAccess` → `hasTripOwnerOrContributorAccess` on every write handler. The reads have no gate and stay that way — AC1
- [ ] `src/app/api/trips/[id]/days/[dayId]/image/route.ts` — the same at **both** sites (`:86`, `:200`) — AC2
- [ ] `src/app/api/trips/[id]/bucket-list-items/route.ts` — the same at **all three** sites (`:59`, `:101`, `:161`) — AC2
- [ ] `src/app/api/trips/[id]/export/route.ts` — the same at `:52`. A contributor can already see every byte this archive contains; the export only changes the container — AC2
- [ ] `src/app/api/trips/[id]/hero-image/route.ts` (`:66`) and `.../members/route.ts` — **unchanged**. Add a one-line comment at each naming this story as the one that considered and declined them, so the next reader does not read them as oversights — AC3
- [ ] The role refusal (AC6) — where the gate rejects a caller who *is* a participant, answer `403` with an `apiError("forbidden", …)` rather than the current `404 not_found`. `src/lib/auth/adminAccess.ts` already carries the reasoning for this exact choice and is the precedent to follow: a 404 collapses "you may not" into "it is not there", and the client cannot tell them apart. The 404 stays for non-participants — AC6
- [ ] `src/components/features/trips/TripDayPlanDialog.tsx`, `TripAccommodationDialog.tsx`, `TripDayView.tsx`, `TripBucketListPanel.tsx` — add a `case "forbidden":` to each `resolveApiError` switch (the one in `TripDayPlanDialog.tsx` is at `:1101`). **Only these four.** There are eleven copies of that switch in `src/components`; the other seven perform no write this story widens and must not be touched — AC7
- [ ] `src/i18n/en.ts`, `src/i18n/de.ts` — one new key in the existing `errors.*` block (`en.ts:94-100`), worded as a permission statement rather than a failure — AC7
- [ ] `test/` — the positive cases: a contributor uploads and deletes a photo and a document on both parents, sets a day image, adds a bucket-list item, and exports. Extend the existing route suites rather than adding parallel ones — AC1, AC2
- [ ] `test/` — the three negatives from AC3, plus a viewer refused on every widened route. These are the assertions that make the story safe to change later — AC3, AC4

## Dev Notes

### Two layers, or it does not work

Every widened route is guarded twice, and the second guard is easy to miss because it does not look like a guard:

```
route:       hasTripOwnerAccess(userId, tripId)          →  404 not_found
repository:  where: { … trip: { userId } }               →  "not found" outcome
```

Open only the route and the request reaches the repository, whose `findFirst` returns `null` for a contributor, and the handler reports the same 404 as before. The symptom is identical to doing nothing at all, which is exactly how a half-done version of this story ships green and gets reported again next week.

The correct clause is already in both repository files, used by the writer helpers that gate every *other* contributor write:

```ts
trip: { OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] }
```

Copy that. Note the explicit `role: "CONTRIBUTOR"` — a bare `members: { some: { userId } } }` would admit viewers and is the one-word mistake that turns this story into a security defect.

### Why the export moves and the hero image does not

Both were genuine coin-flips and were decided rather than defaulted, so do not re-open them mid-implementation:

- **Export moves** because a contributor can already read every stay, activity, photo and document the archive contains. The archive changes the container, not the exposure. Refusing it protects nothing.
- **Hero image stays** because it is the trip's identity on someone else's dashboard card, not content of a day. It is a small, defensible asymmetry, and it is written down here precisely so that it reads as a decision.

### `DELETE /api/trips/[id]` looks unguarded and is not

`DELETE` at `:239` calls `deleteTripForUser(userId, tripId)` with no `hasTrip…Access` call above it. That is not an omission: the repository scopes `deleteMany({ where: { id: tripId, userId } })` (`tripRepo.ts:2841`), so a contributor's delete matches zero rows and returns `false`. While widening sibling routes it will be tempting to "make it consistent". Do not. Adding a gate is harmless but redundant; widening the repository scope would let a contributor delete the whole trip.

### The 404 convention, and why this narrows it rather than breaks it

Story 8.3 established "access failure answers 404 not 403 per house convention", and that convention is right where it applies: a 404 refuses to confirm that a trip exists to someone with no relationship to it.

It does not apply to a caller who is already a participant. They can see the trip, the day and the activity on their screen; the existence is not a secret being kept. Telling them the activity does not exist is simply false, and it is what made this defect read as a broken app rather than a permission rule — the report that opened this story was "it always throws errors", not "it says I am not allowed".

`adminAccess.ts` already makes this argument for the admin surface and chose `forbidden` over `not_found` for the same reason. Follow it, and keep the 404 for everyone else.

### What must not regress

- **Reads.** All four media routes let any participant read today, through `findScoped…ForTripParticipant`. Story 8.3's serving route (`src/app/uploads/[...path]/route.ts`) authorises file reads with `hasTripReadAccess`. Neither changes.
- **Viewers.** Every widened gate must still refuse `VIEWER`. The repository clause carries `role: "CONTRIBUTOR"` for exactly this reason; the route helper `hasTripOwnerOrContributorAccess` already resolves through `canTripAccessRoleWrite`, which is `owner || contributor`.
- **The dialogs' own gating.** `TripDayView.tsx:598-599` and `TripTimeline.tsx:144-145` derive `canEditPlanning` from `accessRole`. A contributor already passes it, so the upload controls are already on screen for her — which is why the failure surfaced as a server error rather than a hidden button. Nothing there needs changing, and nothing there should be relied on as a guard.

### Traps

1. **Widening only the route.** See above. The single most likely wrong outcome, and it looks exactly like success until someone tries it.
2. **Dropping `role: "CONTRIBUTOR"` from the members clause.** Admits viewers. Turns a usability fix into a permissions bug.
3. **Touching all eleven `resolveApiError` copies.** Only four dialogs perform these writes. The other seven are unrelated surfaces and changing them widens the diff and the review for nothing.
4. **Turning every 404 into a 403.** AC6 is narrow: participants only. A blanket change reverses Story 8.3's reasoning for callers who genuinely should learn nothing.
5. **Testing only the happy path.** The three negatives in AC3 are the story's real content. A change that grants contributors media rights *and* member management would pass every positive test written for AC1 and AC2.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`. Route suites build a session with `createSessionJwt` and drive the exported handler directly; the existing media-route suites already construct owner sessions, so the contributor and viewer cases are additional session fixtures against the same setup, not new files.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

No new files, no new dependency, no migration, no schema change. Two repository helpers, eight route files, four component switches and both dictionaries. The membership rows this story reads already exist and are already created by Stories 5.1, 5.4 and 5.6.

### References

- Ledger entry this story closes: **DW-182**, [Source: _bmad-output/implementation-artifacts/deferred-work.md] — *"Gallery and document writes are owner-only, which contradicts Story 5.4's 'contributor full edit'"*. Mark it resolved as part of this work.
- The promise being kept: [Source: _bmad-output/implementation-artifacts/5-4-contributor-full-edit-permissions.md]
- The 403-over-404 precedent: `travelplan/src/lib/auth/adminAccess.ts`
- The 404 convention this narrows: [Source: _bmad-output/implementation-artifacts/8-3-uploaded-media-behind-the-login.md]
- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 5.13: What a Contributor May Do, Made Consistent]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
