---
title: 'Story 5.13: What a Contributor May Do, Made Consistent'
type: 'bugfix'
created: '2026-08-07'
baseline_revision: 43f177c
final_revision: 44ed530
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** A `CONTRIBUTOR` may create, edit and delete a stay or an activity, and may rename the trip — but may not attach a photo or a document to the thing she just created, set a day image, add a bucket-list idea, or export a backup. The split is chronological, not principled: the gallery routes predate Story 5.4's contributor role and Story 9.1 copied their gate onto the document routes. Reported from production on 2026-08-06 (**DW-182**); the refusal also answers `404 not_found`, so it reads as a broken app rather than a permission rule.

**Approach:** Apply one line — *content is contributor-writable, the trip as a possession is not* — to both enforcement layers at once (route gate **and** repository scope) across the media, document, day-image, bucket-list and export surfaces; keep members, hero image and trip deletion owner-only; and make a role refusal for someone who is already a participant answer `403 forbidden` so the client can say "you may not" instead of "it is not there".

## Boundaries & Constraints

**Always:**
- Widen **both** layers for every widened surface. A route that admits a caller whose repository query then refuses them is a 404 that reads as a bug. Five repository scopes back these routes, not the two the story file names.
- The writer clause is copied byte-for-byte from the existing canonical spelling — `OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }]` (`accommodationRepo.ts:130`). The explicit `role: "CONTRIBUTOR"` is load-bearing.
- A `VIEWER` gains no write anywhere and loses no read anywhere.
- Every new user-facing string exists in **both** `en.ts` and `de.ts`.
- A UI control that a role may not use does not render for that role; a route a role may use is reachable from the UI.

**Block If:**
- Widening a repository scope would admit a caller to data outside the trip being widened.
- The full test suite cannot be run to a baseline.

**Never:**
- Widen `members`, `hero-image` (route), `deleteTripForUser`, `updateTripHeroImageForUser`, `getTripByIdForUser`, or the trip `DELETE` handler. `DELETE /api/trips/[id]:239` carrying no route gate is deliberate — `deleteTripForUser` scopes `deleteMany({ where: { id: tripId, userId } })` (`tripRepo.ts:2848`). Do not add a gate there and do not widen that scope.
- Touch the participant **read** scopes (`findScoped…ForTripParticipant`, `findTripDayForTripParticipant`, `getTripDayByIdForUser`). Widening the write scope must not converge the two — the participant scope admits `VIEWER`.
- Convert 404 to 403 for **non-participants**, or on trip routes this story does not widen (`accommodations`, `day-plan-items`, `travel-segments`, `PATCH /api/trips/[id]`, `members`). Those are recorded in the ledger instead.
- Touch the seven `resolveApiError` copies outside the four named components.
- Reorder, rename or re-tone existing dictionary entries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Contributor attaches media | `CONTRIBUTOR` membership; `POST` to any of the four media/document routes | `200`, file stored, row created | No error expected |
| Contributor removes media | `CONTRIBUTOR`; `DELETE` on the same four routes | `200`, row and file removed | No error expected |
| Contributor reorders photos | `CONTRIBUTOR`; `PATCH` on either images route (ungated at HEAD) | `200`, new sort order | No error expected |
| Contributor day image | `CONTRIBUTOR`; `POST`/`PATCH` `days/[dayId]/image` | `200`, image set or cleared | No error expected |
| Contributor bucket list | `CONTRIBUTOR`; `GET`/`POST`/`PATCH`/`DELETE` `bucket-list-items` | `200` on all four | No error expected |
| Contributor converts idea | `CONTRIBUTOR`; `POST day-plan-items` with `bucketListItemId` | `200`, activity created, idea consumed | Not `bucket_missing` |
| Contributor export | `CONTRIBUTOR`; `GET export` | `200`, ZIP stream | No error expected |
| Viewer on any widened route | `VIEWER` membership | `403` `forbidden` | Dialog shows the permission message |
| Non-participant on any widened route | No membership, not owner | `404` `not_found` — unchanged | Existence not disclosed |
| Contributor manages members | `CONTRIBUTOR`; `GET`/`POST`/`DELETE members` | `404` `not_found` — unchanged | Control does not render for her |
| Contributor sets hero image | `CONTRIBUTOR`; `POST hero-image` | `404` `not_found` — unchanged | Field does not render for her |
| Contributor deletes trip | `CONTRIBUTOR`; `DELETE /api/trips/[id]` | `404`, zero rows deleted | Control does not render for her |

</intent-contract>

## Code Map

Line numbers verified against HEAD `43f177c`. **`tripRepo.ts` reads as binary to `grep`** — always `LC_ALL=C grep -an`; the Read tool is unaffected.

**Access layer**
- `src/lib/auth/tripAccess.ts` (92 lines) — `TripAccessRole` (`:3`), `TripAccess` (`:5-9`), `canTripAccessRoleWrite` (`:15`), `getTripAccessForUser` (`:21-60`, returns `TripAccess | null`, **the only helper that separates "not a participant" from "wrong role"**, and today it is called only from inside this module, by the three `has…` wrappers that throw the distinction away), `hasTripOwnerAccess` (`:67`), `hasTripOwnerOrContributorAccess` (`:72`). The three `has…` helpers return a bare `boolean` and cannot express AC6.
- `src/lib/auth/adminAccess.ts:53-55` — the 403-over-404 reasoning, verbatim, and `requireAdmin` (`:57-71`) is the shape to follow: an `auth` module that imports `fail`/`apiError` and returns a ready refusal.
- `src/lib/errors/apiError.ts:7` — `apiError(code, message, details?)`; `code` is a bare `string`, no union to extend. `src/lib/http/response.ts:12` — `fail(error, status = 400)`; there is **no** code→status mapping, status is always explicit.
- `"forbidden"` exists already, at two sites, both 403: `adminAccess.ts:65`, `src/app/api/users/route.ts:39`.

**Routes to widen** (all under `src/app/api/trips/[id]/`) — each gate is the identical 3-line `if (!(await hasTripOwnerAccess(...))) return fail(apiError("not_found", "<noun> not found"), 404);`
- `accommodations/images/route.ts` — POST `:104` gate `:119`; DELETE `:188` gate `:203`; **PATCH `:249` has no gate**; GET `:66` ungated (stays)
- `accommodations/documents/route.ts` — POST `:145` gate `:160`; DELETE `:246` gate `:261`; GET `:106` ungated (stays)
- `day-plan-items/images/route.ts` — POST `:111` gate `:126`; DELETE `:195` gate `:210`; **PATCH `:256` has no gate**; GET `:67` ungated (stays)
- `day-plan-items/documents/route.ts` — POST `:154` gate `:169`; DELETE `:255` gate `:270`; GET `:107` ungated (stays)
- `days/[dayId]/image/route.ts` — POST `:71` gate `:86`; PATCH `:172` gate `:200` (this one sits *after* JSON parse + zod, unlike every other file). No GET.
- `bucket-list-items/route.ts` — GET `:48` gate `:59`; POST `:86` gate `:101`; PATCH `:146` gate `:161`; **DELETE `:211` has no gate**
- `export/route.ts` — GET `:41` gate `:52`; returns a raw ZIP `Response` (`:112-118`), not `ok()`

**Routes that stay owner-only**
- `hero-image/route.ts:66`, `members/route.ts:33` / `:66` / `:139`, `trips/[id]/route.ts` DELETE `:239` (no gate, by design)

**Repository scopes — five need widening, not two**
- `src/lib/repositories/accommodationRepo.ts` — canonical writer clause at `:129-131` (`findTripDayForTripWriter`, `:124`); `findScopedAccommodation` `:135`, owner-only `trip: { userId }` at **`:143`**; participant read scope `:149`, clause `:162-164` — untouched. Writers using `findScopedAccommodation`: `createAccommodationImage` `:522`, `deleteAccommodationImage` `:548`, `reorderAccommodationImages` `:572`, `createAccommodationDocument` `:632`, `deleteAccommodationDocument` `:669`.
- `src/lib/repositories/dayPlanItemRepo.ts` — writer clause `:210-212` (`findTripDayForTripWriter`, `:205`); `findScopedDayPlanItem` `:232`, owner-only at **`:240`**; participant scopes `:194` / `:246` — untouched. Writers: `:840`, `:866`, `:889`, `:975`, `:1012`. `convertBucketListItemToDayPlanItemForTripDay` `:473` calls `findBucketListItemForTripInTransaction` `:484` and `deleteBucketListItemForTripInTransaction` `:524`.
- `src/lib/repositories/bucketListRepo.ts` — `findTripForUser` `:49`, owner-only `where: { id: tripId, userId }`; the single gate for **all four** bucket-list functions (`:94`, `:111`, `:135`, `:170`). `findBucketListItemForTrip` `:191` (owner-only, **zero callers**) and `findBucketListItemForTripInTransaction` `:205` (owner-only, called from the convert flow). `deleteBucketListItemForTripInTransaction` `:219` takes no `userId` — safe because its caller feeds it an already-scoped id; leave it.
- `src/lib/repositories/tripRepo.ts` — `updateTripDayImageForUser` `:1034`, owner-only `trip: { userId }` at `:1047-1054`; `getTripExportForUser` `:1489`, owner-only `where: { id: tripId, userId }` at `:1490-1491`, and the whole archive hangs off this one root. Flat-on-`Trip` writer clause precedent: `:756` (`updateTripWithDays`). **Do not touch** `deleteTripForUser` `:2848`, `updateTripHeroImageForUser` `:3193`, `getTripByIdForUser` `:3064`, `getTripDayByIdForUser` `:3070`.

**Client**
- `src/components/features/trips/TripBucketListPanel.tsx` — `resolveApiError` `:157-173` (component scope); all three mutations already route through it: GET `:179`→`:186`, POST/PATCH `:359`→`:382`, DELETE `:421`→`:432`.
- `src/components/features/trips/TripDayPlanDialog.tsx` — `resolveApiError` `:1101-1117` (component scope, **fallback is required**). The four media calls **bypass it**: images POST `:1565`→`:1572-1576` + catch `:1587`; images DELETE `:1607`→`:1621-1624` + catch `:1627`; documents POST `:1675`→`:1682-1694` (matches `DOCUMENT_LIMIT_ERROR_MESSAGE` on `body.error.message`) + catch `:1703`; documents DELETE `:1724`→`:1738-1741` + catch `:1747`.
- `src/components/features/trips/TripAccommodationDialog.tsx` — **no component-scope** `resolveApiError`; two function-local copies, `:1141-1154` (stay save) and `:1195-1208` (stay delete). Media calls bypass both: images POST `:1291`→`:1298-1301` + catch `:1307`; images DELETE `:1326`→`:1340-1343` + catch `:1346`; documents POST `:1400`→`:1407-1421` + catch `:1428`; documents DELETE `:1448`→`:1462-1465` + catch `:1471`.
- `src/components/features/trips/TripDayView.tsx` — `resolveApiError` `:696-715` (handles `network_error`); `isOwner` `:611`, `canEditPlanning` `:612`; `dayMenuItemsVisible.dayImage: isOwner` `:630`; `loadBucketListItems` owner short-circuit `:828-833` + dep array `:855`; day bucket panel `:3642`; day-image writes `:2289`→`:2300-2307`, `:2320`→`:2336-2338`, `:2360`→`:2373-2375`, all composing `` `${t(key)} (${body.error.message})` `` and none using `resolveApiError`.
- `src/components/features/trips/TripTimeline.tsx` — `isOwner` `:144`, `canEditPlanning` `:145`; export button `:473` gated `isOwner` with a comment at `:465-472` that says *"Whether a contributor should be able to export is a question about the route's gate"* — this story answers it; bucket panel mount `:953` gated `isOwner`; Edit button `:455` gated `canEditPlanning`; `TripEditDialog` mounted around `:1012`.
- `src/components/features/trips/TripEditDialog.tsx` — **no role prop and no role conditional anywhere**; hero file field renders unconditionally `:378-390`; hero POST `:273`, failure `:288-290` → generic `trips.edit.uploadError`. A contributor reaches this today and always fails.
- `src/i18n/en.ts:94-100` / `src/i18n/de.ts:90-96` — the flat `errors.*` block, same relative position in both files. Tone reference: `en.ts:713` `"users.registered.forbidden"`, `en.ts:723` `"admin.users.forbidden"`.

**Tests** (all in `travelplan/test/`) — every suite drives the exported handler with a `NextRequest` and `{ params: Promise.resolve({ id: trip.id }) }`; session cookie `session=${token}`, mutations add `; csrf_token=csrf-token` plus header `x-csrf-token: csrf-token`.
- `tripAccommodationImagesRoute.test.ts` (208), `tripDayPlanItemImagesRoute.test.ts` (228) — one big `it` each; already build owner/stranger/VIEWER sessions and a `TripMember` VIEWER row; stranger 404 pinned on every verb; viewer 200 on GET.
- `tripAccommodationDocumentsRoute.test.ts` (500) and `tripDayPlanItemDocumentsRoute.test.ts` (458) — `seed(label)` helper (`:47` / `:49`); `beforeEach` includes `prisma.tripMember.deleteMany()`.
- `tripDayImageRoute.test.ts` (537) — `buildJsonRequest` `:16`, `buildUploadRequest` `:49`; **`:207` asserts a viewer gets `404` on upload — this assertion changes to `403` `forbidden`**.
- `bucketListRoute.test.ts` (606) — `buildRequest` `:13`; **creates no `TripMember` rows at all**.
- `tripExportRoute.test.ts` (900) — `createOwner` `:118`, `buildRequest`, `routeContext`; **creates no `TripMember` rows at all**.
- `tripMembersRoute.test.ts`, `tripHeroImageRoute.test.ts`, `tripDetailRoute.test.ts` — the three AC3 negatives belong here.
- `tripTimelineRoles.test.tsx`, `tripTimelineSharing.test.tsx`, `tripDayViewLayout.test.tsx`, `tripEditDialogHeroImage.test.tsx` — the role-scoped UI patterns to extend.
- The CONTRIBUTOR fixture idiom, `tripDayPlanItemsRoute.test.ts:1345-1351` — note the deliberate mismatch, account `User.role: "VIEWER"` with `TripMember.role: "CONTRIBUTOR"`, which proves the route reads the membership and not the account role. Reusable helper: `tripsListRoute.test.ts:48-49` `addMember`.
- `test/i18nDictionaries.test.ts:24` — key-parity gate; a key added to one dictionary only fails here.

## Tasks & Acceptance

**Execution:**

- [x] `src/lib/auth/tripAccess.ts` -- add one exported helper, `refuseUnlessTripWriter(userId, tripId, notFoundMessage)`, returning the refusal response or `null`: `getTripAccessForUser` → `null` means not a participant → `fail(apiError("not_found", notFoundMessage), 404)`; a participant failing `canTripAccessRoleWrite` → `fail(apiError("forbidden", "Trip write access required"), 403)`; otherwise `null`. Import `fail` and `apiError` exactly as `adminAccess.ts` does. Leave all existing exports in place — `hasTripOwnerOrContributorAccess` still has eleven callers this story does not touch -- AC6
- [x] `src/lib/repositories/accommodationRepo.ts` -- `findScopedAccommodation` (`:143`): `trip: { userId }` → the writer clause copied byte-for-byte from `:129-131` eleven lines above. Do not invent a new spelling -- AC1, AC5
- [x] `src/lib/repositories/dayPlanItemRepo.ts` -- the same to `findScopedDayPlanItem` (`:240`), against the same model in the same file (`:210-212`) -- AC1, AC5
- [x] `src/lib/repositories/tripRepo.ts` -- `updateTripDayImageForUser`'s day lookup (`:1047-1054`): `trip: { userId }` → the writer clause -- AC2, AC5
- [x] `src/lib/repositories/tripRepo.ts` -- `getTripExportForUser` (`:1490-1491`): `where: { id: tripId, userId }` → `where: { id: tripId, OR: [...] }`, the flat-on-`Trip` form already used at `:756`. Every `include` in the archive hangs off this root, so this one line moves the whole export -- AC2, AC5
- [x] `src/lib/repositories/bucketListRepo.ts` -- `findTripForUser` (`:49`) → widen to the flat writer clause and rename to `findTripForTripWriter` (module-private; the old name would tell the next reader it is owner-only). It gates all four bucket-list functions, so this single edit moves list, create, update and delete together -- AC2, AC5
- [x] `src/lib/repositories/bucketListRepo.ts` -- `findBucketListItemForTripInTransaction` (`:213`): `trip: { userId: params.userId }` → the writer clause. Without it a contributor's "add idea to this day" reaches a contributor-permissive route (`day-plan-items/route.ts:101`) and a contributor-permissive day lookup, then dies inside the transaction as `bucket_missing` → 404. Apply the identical change to `findBucketListItemForTrip` (`:195`) so the two spellings of the same query cannot drift; it currently has zero callers -- AC2, AC5
- [x] `src/lib/repositories/accommodationRepo.ts`, `dayPlanItemRepo.ts`, `tripRepo.ts` -- leave every `…ForTripParticipant` helper, `findTripDayForTripParticipant` (`dayPlanItemRepo.ts:194`) and `getTripDayByIdForUser` (`tripRepo.ts:3070`) untouched. Those are the **read** scopes and already admit everyone; converging them with the write scope would grant `VIEWER` writes -- AC4
- [x] `src/app/api/trips/[id]/accommodations/images/route.ts`, `.../accommodations/documents/route.ts`, `.../day-plan-items/images/route.ts`, `.../day-plan-items/documents/route.ts` -- replace the `hasTripOwnerAccess` block with `refuseUnlessTripWriter` on every write handler, keeping each file's existing not-found noun. **Also add the gate to the two ungated reorder `PATCH` handlers** (`accommodations/images:249`, `day-plan-items/images:256`): they are writes, they are widened by the repository change above, and without a route gate a viewer's refusal arrives as a repository 404 instead of AC6's 403. The `GET` handlers have no gate and stay that way -- AC1, AC6
- [x] `src/app/api/trips/[id]/days/[dayId]/image/route.ts` -- the same at **both** sites (`:86`, `:200`). Leave `:200` where it is in the handler; moving it ahead of the zod parse is a separate change -- AC2, AC6
- [x] `src/app/api/trips/[id]/bucket-list-items/route.ts` -- the same at all three existing sites (`:59`, `:101`, `:161`) **and add it to the ungated `DELETE` (`:211`)**, for the same reason as the reorder handlers -- AC2, AC6
- [x] `src/app/api/trips/[id]/export/route.ts` -- the same at `:52`. A contributor can already read every byte this archive contains; the export changes the container, not the exposure -- AC2, AC6
- [x] `src/app/api/trips/[id]/hero-image/route.ts` (`:66`) and `.../members/route.ts` (`:33`, `:66`, `:139`) -- gate **unchanged**, including its 404. Add a one-line comment at each naming this story as the one that considered and declined them, so the next reader does not read them as oversights -- AC3
- [x] `src/components/features/trips/TripTimeline.tsx` -- export button (`:473`) `isOwner` → `canEditPlanning`, and rewrite the comment at `:465-472`: its premise ("the route gates on `hasTripOwnerAccess` and answers 404") stops being true in this commit, and it names the open question this story closes. Bucket-list panel mount (`:953`) `isOwner` → `canEditPlanning` -- AC2
- [x] `src/components/features/trips/TripDayView.tsx` -- `dayMenuItemsVisible.dayImage` (`:630`) `isOwner` → `canEditPlanning`, updating the record's comment which states each field mirrors its route's gate; `loadBucketListItems` short-circuit (`:828`) and its dep array (`:855`) `isOwner` → `canEditPlanning`; day bucket-list panel (`:3642`) the same. If `isOwner` (`:611`) ends up unused, remove it rather than leaving a lint error -- AC2
- [x] `src/components/features/trips/TripEditDialog.tsx`, `TripTimeline.tsx` -- add a `canEditHeroImage: boolean` prop, render the hero file field (`:378-390`) and run the hero `POST` (`:273`) only when it is true, and pass `isOwner` from `TripTimeline`. The Edit button is gated `canEditPlanning`, so a contributor reaches this dialog today, sees a hero field, and always fails at the route with a generic upload error — shipping AC3's rule while leaving the control that violates it on screen would reproduce this story's own defect on a different surface -- AC3
- [x] `src/components/features/trips/TripBucketListPanel.tsx` (`:157`), `TripDayView.tsx` (`:696`), `TripDayPlanDialog.tsx` (`:1101`), `TripAccommodationDialog.tsx` (`:1141`, `:1195`) -- add `case "forbidden": return t("errors.forbidden");` to each `resolveApiError` switch. **Only these.** There are twelve copies across eleven files in `src/components` plus five in the auth pages; the rest perform no write this story widens -- AC7
- [x] `src/components/features/trips/TripAccommodationDialog.tsx` -- add a component-scope `resolveApiError` (`useCallback`, the `TripBucketListPanel:157` shape with a `fallback` parameter) and route the four media/document error blocks through it (`:1298-1301`, `:1340-1343`, `:1407-1421`, `:1462-1465`), each keeping its current message as the fallback. The two existing copies are function-local to stay save/delete and are invisible from the media handlers, so without this AC7 cannot hold on this dialog. Keep the `DOCUMENT_LIMIT_ERROR_MESSAGE` branch (`:1407-1421`) ahead of the code switch — it matches on `message`, not on `code` -- AC7
- [x] `src/components/features/trips/TripDayPlanDialog.tsx` -- route its four media/document error blocks and their `catch` fallbacks through the existing `resolveApiError` (`:1572-1576`, `:1587`, `:1621-1624`, `:1627`, `:1682-1694`, `:1703`, `:1738-1741`, `:1747`), each keeping its current message as the fallback, and keep the document-limit branch ahead of the code switch. Adding the `case` alone changes nothing here: none of these blocks calls `resolveApiError` today -- AC7
- [x] `src/components/features/trips/TripDayView.tsx` -- route the three day-image error blocks (`:2300-2307`, `:2336-2338`, `:2373-2375`) through `resolveApiError`, passing the existing `` `${t(key)} (${message})` `` expression as the fallback so unknown codes render exactly as they do now -- AC7
- [x] `src/i18n/en.ts` (after `:100`), `src/i18n/de.ts` (after `:96`) -- one new key, `errors.forbidden`, at the same relative position in both files, worded as a permission statement rather than a failure. Match the neighbouring `errors.*` tone and the German `du` form -- AC7
- [x] `test/tripAccommodationImagesRoute.test.ts`, `test/tripDayPlanItemImagesRoute.test.ts`, `test/tripAccommodationDocumentsRoute.test.ts`, `test/tripDayPlanItemDocumentsRoute.test.ts` -- extend the existing suites (do not add parallel files): a `CONTRIBUTOR` uploads, reorders where the route has a `PATCH`, and deletes; a `VIEWER` is refused `403 forbidden` on every write verb; the existing stranger-404 and viewer-read-200 assertions stay green unchanged -- AC1, AC4, AC6
- [x] `test/tripDayImageRoute.test.ts` -- a `CONTRIBUTOR` sets and removes a day image; **change the existing viewer assertion at `:207` from `404 not_found` to `403 forbidden`** and say in the case name that the refusal now names the reason; add a non-participant case still answering 404 -- AC2, AC4, AC6
- [x] `test/bucketListRoute.test.ts` -- the suite creates no memberships today: add a `CONTRIBUTOR` covering `GET`/`POST`/`PATCH`/`DELETE`, a `VIEWER` refused `403` on all four, and a non-participant still answering 404 -- AC2, AC4, AC6
- [x] `test/tripExportRoute.test.ts` -- the same three fixtures for the single `GET`, asserting the contributor receives the archive and not merely a 200 -- AC2, AC4, AC6
- [x] `test/tripDayPlanItemsRoute.test.ts` -- a `CONTRIBUTOR` converts a bucket-list idea into an activity (`POST` with `bucketListItemId`), proving the transaction's item lookup moved with the route gate. Extend the existing contributor block near `:1345` -- AC2, AC5
- [x] `test/tripMembersRoute.test.ts`, `test/tripHeroImageRoute.test.ts`, `test/tripDetailRoute.test.ts` -- the three AC3 negatives: a `CONTRIBUTOR` is refused on `GET`/`POST`/`DELETE members`, on `POST hero-image`, and on `DELETE /api/trips/[id]` (asserting the trip still exists afterwards). These are the assertions that make the story safe to change later — a change granting contributors media rights *and* member management passes every positive test written for AC1 and AC2 -- AC3
- [x] `test/tripTimelineRoles.test.tsx` (or `tripTimelineSharing.test.tsx`), `test/tripDayViewLayout.test.tsx`, `test/tripEditDialogHeroImage.test.tsx` -- render cases: a contributor sees the export button, the bucket-list panel and the day-image menu item; a viewer sees none of the three; a contributor does **not** see the hero-image field while an owner does -- AC2, AC3, AC4
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- set **DW-182** (`:1796-1801`) to `status: **closed 2026-08-07** - fixed by Story 5.13 …`, naming both layers and the suites that pin them. Append two new numbered entries after `### DW-199` in that entry's field shape (`source_spec`, `origin`, `location`, `severity`, `summary`, `evidence`, `status`): **DW-200** — the trip write routes this story did not widen still answer `404 not_found` for a participant's role refusal (`accommodations`, `day-plan-items`, `travel-segments`, `PATCH /api/trips/[id]`, `members`, `hero-image`), and two others already answer `403` under the *wrong* code `unauthorized` (`day-plan-items/move/route.ts:58`, `day-activity-transfer/route.ts:46`), which the client renders as "Authentication required. Please sign in."; **DW-201** — the same route/UI mismatch this story fixed for the hero image may exist elsewhere, and nothing enforces the correspondence between a route's gate and the conditional that renders its control, which is the defect class that produced both DW-182 and this one -- AC3

**Acceptance Criteria:**

- Given a `CONTRIBUTOR` on a shared trip, when she uploads, reorders or removes a photo or a document on an activity or a stay, then the request succeeds at both the route gate and the repository query and the attachment is persisted. *(AC1)*
- Given a `CONTRIBUTOR`, when she sets or clears a day image, adds, edits or removes a bucket-list idea, converts an idea into an activity, or exports a backup, then each succeeds, and each corresponding control is reachable from the UI for her role. *(AC2)*
- Given a `CONTRIBUTOR`, when she attempts to read or change trip members, change the trip hero image, or delete the trip, then each is refused server-side with its existing status and the trip is unchanged; no control offering any of the three renders for her. *(AC3)*
- Given a `VIEWER`, when she attempts any write this story widened, then she is refused; and everything she could read before this story she can still read, with the same status code. *(AC4)*
- Given any route this story widened, when a `CONTRIBUTOR` calls it, then the route gate and the repository scope agree — there is no widened route on which the gate admits her and the query then reports the object as absent. *(AC5)*
- Given a caller who holds a membership on the trip, when a widened route refuses her for her role, then the response is `403` with code `forbidden`; given a caller who holds no membership and does not own the trip, then the response remains `404` with code `not_found`. *(AC6)*
- Given a widened write that returns `forbidden`, when the dialog that issued it handles the response, then it shows a message about permission rather than a generic failure, and that string exists in both `en.ts` and `de.ts`. *(AC7)*

## Spec Change Log

## Review Triage Log

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 4, low 7)
- defer: 3: (high 0, medium 2, low 1)
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Mutation testing proved six of the seven widened repository scopes had **no test that fails when `role: "CONTRIBUTOR"` is dropped** — the story's number-one trap had a net on one scope only. Structural cause: the new route gate refuses a viewer *before* the repository runs, so no route test can reach those scopes with a viewer. Added repository-level viewer/contributor nets calling the functions directly, in `test/documentGalleryRepo.test.ts`, `test/imageGalleryRepo.test.ts`, `test/bucketListRepo.test.ts` and `test/tripRepo.test.ts`, covering `findScopedDayPlanItem`, `findTripForTripWriter`, both `findBucketListItemForTrip…` spellings, `getTripExportForUser` and `updateTripDayImageForUser`. Each net was verified by mutating its clause to the role-agnostic spelling and confirming the test went red, then restoring the source and re-verifying by SHA-256.
  - `[medium]` `[patch]` Nothing asserted that `errors.forbidden` ever reaches a screen — AC7 was pinned only by dictionary key parity and `case` labels, so a regression mapping `forbidden` to the fallback would ship green. Added a render case stubbing a `403 forbidden` on a photo upload and asserting the rendered permission sentence, plus the absence of the fallback and `errors.server` strings.
  - `[medium]` `[patch]` `epic-5-context.md` (recompiled at the start of this run because it was stale against `epics.md`) had dropped normative constraints and gained two statements this commit contradicts. Restored the dialog-affordance, inline-validation, error-envelope, design-token and story-removal-date constraints; corrected "a viewer reads everything" (the bucket list and export now require write-level role) and "every trip-scoped route is guarded twice" (`DELETE /api/trips/[id]` deliberately relies on the repository alone); added the UI-mirrors-enforcement rule and a new decision recording why repository role clauses need direct tests.
  - `[medium]` `[patch]` `TripAccommodationDialog` ended the implementation with **three** `resolveApiError` definitions under one identifier, the two function-local copies shadowing the new component-scope one. Deleted both locals in favour of `resolveApiError(code, t("trips.stay.error"))` / `…deleteError`, so the next `case` is added in one place and a reader inside `onSubmit` sees the function the file defines.
  - `[low]` `[patch]` `PATCH days/[dayId]/image` checked the role *after* `request.json()` and the zod parse, so a viewer collected `invalid_json` and a flattened `validation_error` — the payload schema field by field — from a route she may not call, and learned she was forbidden only once she had guessed a well-formed body. Hoisted the gate above the body handling, matching `POST` and every other handler this story touched. This turned `tripDayImageRoute.test.ts`'s "rejects invalid payload" case red, because it used a literal non-existent trip id; repointed it at a real owned trip so it asserts the validation it is named for rather than the auth gate.
  - `[low]` `[patch]` `TripTimeline`'s `handleExport` switch had no `forbidden` branch, so the one refusal the widened export route can now answer rendered as "Export failed. Please try again." — advice that never works, on a button a contributor can reach. Added the case.
  - `[low]` `[patch]` The `errors.forbidden` wording said "does not allow this **change**", but two of the seven call sites are reads (bucket-list `GET`, export `GET`). Reworded to "this action" in both dictionaries, and fixed the German preposition (`in dieser Reise` → `für diese Reise`).
  - `[low]` `[patch]` The `TripDayView` day-image comment claimed only `forbidden` changes what a user sees. False: every code `resolveApiError` already knew now renders its shared `errors.*` string instead of the key-plus-server-text form. Rewritten to state the real trade and why it is intended.
  - `[low]` `[patch]` The `TripEditDialog` guard comment claimed the hero field "is unregistered for a contributor". `register("heroImage")` runs unconditionally; the field is registered and merely never mounted — which is precisely why the guard cannot be left to the rendering. Comment corrected to say so.
  - `[low]` `[patch]` The only assertion pinning the `resolveApiError` **fallback** parameter had been retargeted to `errors.server` during implementation, leaving "an unrecognised code keeps the surface-specific message" unproven. Added a case stubbing an unrecognised code and asserting the surface fallback still renders and the raw backend message never leaks.
  - `[low]` `[patch]` DW-200 claimed `getTripAccessForUser` "has exactly one non-test caller" (it has four, all in-module) and its `location:` field listed `members` and `hero-image` among the defect sites this same commit annotates as deliberate — one instruction from the ledger, the opposite from the code. Corrected the caller claim and split the `location` field into straight migrations, one-word outliers, and the two routes that are a separate product judgement. The same "zero callers" slip in this spec's Code Map was corrected too.

### 2026-08-07 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 3: (high 0, medium 2, low 1)
- reject: 10: (high 0, medium 4, low 6)
- addressed_findings:
  - `[medium]` `[patch]` AC7 was unpinned on the surface the story names *first*. The previous pass added a `forbidden` render net for `TripDayPlanDialog`'s photo upload, but the three day-image writes live in `TripDayView` and had none — so `errors.forbidden` reaching a day-image alert was proven only by dictionary key parity and the `case` label, both of which survive the blocks reverting to the key-plus-server-text form they used before this story. Added a render case to `tripDayViewLayout.test.tsx` stubbing a `403 forbidden` on the day-image `POST` and asserting the permission sentence renders while the surface fallback, the route's internal English message and `errors.server` do not. Verified as a real net: mutating `case "forbidden"` out of `TripDayView`'s switch turned it red, then the source was restored and re-verified by SHA-256.
  - `[low]` `[patch]` Three suites gained `TripMember` rows in this story without the `prisma.tripMember.deleteMany()` the same commit added to five siblings, whose stated justification is that a stale row would decide the next test's role. `TripMember` cascades from both `Trip` and `User` (`schema.prisma:124-125`) and both are deleted, so the omission is harmless today — but the two facts are only compatible while the cascade holds, and the suites carrying the stranger-still-gets-404 assertions are exactly the ones where a stale `CONTRIBUTOR` row would turn an AC6 guard into a silent pass. Added the line and a comment saying why it is explicit, in `tripAccommodationImagesRoute`, `tripDayPlanItemImagesRoute` and `tripDayImageRoute`.
  - `[low]` `[patch]` `bucketListRepo.test.ts` labelled its `toEqual` "the actual anti-drift assertion". It is not: for `viewer` and `stranger` it reduces to `null` equals `null`, and for the two writers both spellings read the same row by the same id. The drift is caught by the two `expected` assertions above it. Comment corrected to say what the assertion really earns its place for — pinning that the two lookups still select the same *shape* — so the next reader does not skip writing the net they think is already there.
  - `[low]` `[patch]` The previous pass corrected `epic-5-context.md` from "a viewer sees everything" to "the bucket list and the export require write-level role", which is accurate but reads as though it had always been the requirement. Story 5.3 is titled "Viewer read-only access" and the epic's contract said otherwise; the code never matched it, and no one has ruled on which is right. Annotated the corrected sentence as a recorded discrepancy with its date and a pointer to the new ledger entry, so a later story does not read the rewrite as a decision.

## Design Notes

**Two layers, and there are five of them, not two.** The story file names `findScopedAccommodation` and `findScopedDayPlanItem`. Those cover the four media routes only. The day image (`tripRepo.ts:1047`), the bucket list (`bucketListRepo.ts:49`, and `:213` for the convert flow) and the export (`tripRepo.ts:1490`) each carry their own owner-only scope, and each would produce exactly the failure the story warns about — a widened gate, a repository `null`, and the same 404 as before:

```
route:       hasTripOwnerAccess(userId, tripId)          →  404 not_found
repository:  where: { … trip: { userId } }               →  "not found" outcome
```

Note the two shapes of the same clause. Nested under a relation (`accommodationRepo.ts:129`) it is `trip: { OR: [...] }`; flat on `Trip` itself (`tripRepo.ts:756`) it is `where: { id: tripId, OR: [...] }`. The bucket-list and export scopes are the flat kind.

**`hasTripOwnerOrContributorAccess` cannot express AC6, and does not need to change.** It returns a bare `boolean`, so `false` collapses "no such trip", "not your trip" and "you are a viewer" into one value. `getTripAccessForUser` (`tripAccess.ts:21`) already separates the first two from the third and is exported with zero callers. `refuseUnlessTripWriter` is a thin composition of it with the existing `canTripAccessRoleWrite`, following `requireAdmin`'s shape:

```ts
export const refuseUnlessTripWriter = async (userId: string, tripId: string, notFoundMessage: string) => {
  const access = await getTripAccessForUser(userId, tripId);
  if (!access) return fail(apiError("not_found", notFoundMessage), 404);
  if (!canTripAccessRoleWrite(access.accessRole)) return fail(apiError("forbidden", "Trip write access required"), 403);
  return null;
};
```

It is named for the *role floor*, not the verb, because two of its call sites are reads that require write-level role (bucket-list `GET`, export `GET`). Call sites read `const refusal = await refuseUnlessTripWriter(...); if (refusal) return refusal;` — a one-for-one replacement of the current three-line block. The eleven other `hasTripOwnerOrContributorAccess` callers stay as they are; migrating them is DW-200, not this story.

**Why AC6 stops at the widened routes.** Trap 4 of the story file narrows AC6 to participants; this spec narrows it once more, to the routes this story touches. Turning `PATCH /api/trips/[id]` or `members` into a 403 would be a behaviour change on surfaces whose gates this story deliberately does not move, each with its own suite, and it would put the story's diff across most of the trip API. The remaining sites are recorded rather than dropped.

**Three ungated write handlers, found during investigation and not in the story file.** `accommodations/images` `PATCH` (`:249`), `day-plan-items/images` `PATCH` (`:256`) and `bucket-list-items` `DELETE` (`:211`) have no route gate at all today; they are safe only because their repository call is owner-only. Widening those repository scopes is what makes them contributor-capable — correct, and required by AC1/AC2 — but it also means a viewer's refusal would arrive from the repository as a 404, silently violating AC6 on three of the story's own routes. Adding the gate is the smaller change and the one that keeps the layers in agreement.

**Why the export moves and the hero image does not.** Both were coin-flips in the story file and were decided rather than defaulted; do not re-open them mid-implementation. The export moves because a contributor can already read every stay, activity, photo and document the archive contains — it changes the container, not the exposure. The hero image stays because it is the trip's identity on someone else's dashboard card, not content of a day. The comment at `TripTimeline.tsx:465-472` states the export question as open and points at the route; this commit closes it, so that comment has to go with the gate rather than survive it.

**The hero-image UI is the same defect, one surface over.** `TripEditDialog` has no role conditional at all, and the Edit button that opens it is gated `canEditPlanning` — so a contributor sees a hero-image field, submits it, and gets `trips.edit.uploadError` while the trip `PATCH` beside it commits. That is DW-182's exact shape: a control on screen, a route that refuses, and a message that names neither. AC3 is a statement about what a contributor cannot do, and leaving the field visible would ship the rule and the violation in the same commit. Gating the field is six lines and needs no route change.

**AC7 is not satisfied by adding the `case` alone.** Of the four named components only `TripBucketListPanel` routes its mutations through `resolveApiError`. `TripDayPlanDialog`'s four media calls set hard-coded keys; `TripAccommodationDialog`'s two `resolveApiError` copies are function-local to stay save/delete and invisible from its media handlers; `TripDayView`'s day-image blocks concatenate the raw server message. Each block keeps its existing message as the fallback, so only the `forbidden` code changes what a user sees — but the wiring is the work, not the `case`.

**Traps.**
1. **Widening only the route.** The single most likely wrong outcome, and it looks exactly like success until someone tries it. Five repository scopes, not two.
2. **Dropping `role: "CONTRIBUTOR"` from the members clause.** A bare `members: { some: { userId } }` admits viewers and turns a usability fix into a permissions bug. That role-agnostic spelling is the *participant read* clause and exists ten lines away in the same files.
3. **Converging the write scope with the participant read scope.** They must stay two functions.
4. **Touching all twelve `resolveApiError` copies.** Only the four named components perform these writes.
5. **Turning every 404 into a 403.** Non-participants keep their 404 everywhere, and this story's routes are the only ones whose role refusals move.
6. **Testing only the happy path.** The three negatives in AC3 are the story's real content.
7. **`tripRepo.ts` reads as binary to `grep`** — `LC_ALL=C grep -an`, or the export and day-image scopes never appear in your search results.
8. **`tripDayImageRoute.test.ts:207` is expected to fail** once the gate moves. It asserts a viewer gets 404; the correct new value is 403 `forbidden`. Update the assertion — do not delete the case.

## Verification

**Commands:** run from `travelplan/`.
- `npm test` -- expected: green. Baseline measured at HEAD `43f177c`: **129 test files, 1644 tests, 0 failures, 0 skipped** (190s). Report the after-count. `tripDayImageRoute.test.ts:207` is expected to fail until its assertion is updated from 404 to 403 — that is the gate working.
- `npx tsc --noEmit -p .` -- expected: **no new errors, and none in a touched file**. The project has never been clean here: **135 errors at baseline**, all under `test/` and **zero in `src/`**. The mix is 90×TS2353, 24×TS2339, 7×TS2741, 5×TS2352, 5×TS7006, 3×TS2558, 3×TS2739, 2×TS7053, 1×TS2322, 1×TS18047. Count before and after; the number must not move. Note that the bare-object route-context idiom (`{ params: { id } }`) several suites use is itself one of these errors — new cases must use `{ params: Promise.resolve({ id }) }` or a touched file gains an error.
- `npx eslint src/lib/auth/tripAccess.ts src/lib/repositories/accommodationRepo.ts src/lib/repositories/dayPlanItemRepo.ts src/lib/repositories/bucketListRepo.ts src/lib/repositories/tripRepo.ts 'src/app/api/trips/[id]/**/route.ts' src/components/features/trips/TripTimeline.tsx src/components/features/trips/TripDayView.tsx src/components/features/trips/TripDayPlanDialog.tsx src/components/features/trips/TripAccommodationDialog.tsx src/components/features/trips/TripBucketListPanel.tsx src/components/features/trips/TripEditDialog.tsx` -- expected: clean. Watch for an unused `isOwner` in `TripDayView.tsx`.

**Manual checks:**
- `LC_ALL=C grep -an 'trip: { userId }' src/lib/repositories/accommodationRepo.ts src/lib/repositories/dayPlanItemRepo.ts` -- expected: **neither `findScopedAccommodation` nor `findScopedDayPlanItem` appears**. Two unrelated owner-only scopes legitimately survive in these files and are out of scope: `accommodationRepo.ts:499` (`getAccommodationCostTotalForTrip`) and `dayPlanItemRepo.ts:190` (`findTripDayForUser`, dead code).
- `LC_ALL=C grep -can 'role: "CONTRIBUTOR"' src/lib/repositories/*.ts` -- the clause count rose by exactly the number of scopes widened (**7** — the five named above plus both `findBucketListItemForTrip…` spellings) and every occurrence is the identical spelling. The `-c` count also picks up comment lines quoting the clause; compare code occurrences.
- `LC_ALL=C grep -an 'hasTripOwnerAccess' src/app/api/trips/\[id\]` -- expected: only `hero-image/route.ts` and `members/route.ts` remain, each now carrying the declining comment.
- `LC_ALL=C grep -an 'errors.forbidden' src/i18n/en.ts src/i18n/de.ts` -- one hit each, at the same relative position in the `errors.*` block.
- `deferred-work.md`: DW-182 reads `closed 2026-08-07`, and DW-200 / DW-201 exist with the full field shape.

## Auto Run Result

Status: `done`. No blocking condition. This was a **follow-up review pass** on an already-implemented story (the previous run set `followup_review_recommended: true`); it re-reviewed the whole diff since `43f177c` from scratch, with no prior conversation context in either reviewer.

**Outcome: the implementation stands.** 0 intent_gap, 0 bad_spec, no loopback, and **no change to `src/` at all** — the four patches are one test, three cleanup lines, two comment corrections and one documentation note. Two adversarial reviewers walked all 46 files and neither found a defect in the widening itself. Both independently re-confirmed the load-bearing parts: the 404/403 split, the five widened repository scopes against their untouched participant-read siblings, `getTripAccessForUser`'s `take: 1` (safe on `@@unique([tripId, userId])`), and that the export's `include` tree carries no `members`, so widening it does not leak the collaborator list a contributor is refused at `members/route.ts`.

**What this pass changed** (`travelplan/` prefix omitted):

- `test/tripDayViewLayout.test.tsx` -- new AC7 render case: a `403 forbidden` on the day-image `POST` must render the permission sentence, not the surface fallback, not the route's English message, not `errors.server`. Mutation-verified.
- `test/tripAccommodationImagesRoute.test.ts`, `test/tripDayPlanItemImagesRoute.test.ts`, `test/tripDayImageRoute.test.ts` -- explicit `prisma.tripMember.deleteMany()` in `beforeEach`, matching the five siblings the story already did this to
- `test/bucketListRepo.test.ts` -- corrected a comment that claimed more for its assertion than the assertion does
- `epic-5-context.md` -- the viewer-read correction annotated as a dated discrepancy rather than a settled requirement
- `deferred-work.md` -- three new entries appended; no existing entry read, modified or re-opened

**Review findings.** 4 patches applied (1 medium, 3 low), 3 deferred, 10 rejected. The rejections are the substance of this pass, so they are itemised rather than counted:

- **Already in the ledger, opened by this same story** (4): the multi-file gallery upload that discards photos on a partial failure; the export-as-permanent-possession question; the `isOwner`/`canEditPlanning` fail-open, including the viewer's bucket-list fetch flashing a 403; and the two routes answering `403` under the code `unauthorized` (DW-200). Both reviewers rediscovered all four, which is the ledger working as intended, not four new problems.
- **Forbidden by the intent contract** (1): adding a `forbidden` branch to `TripEditDialog`'s `resolveApiError`. The contract's **Never** list rules out the seven copies outside the four named components, the hero route is deliberately not widened, and the only path that reaches the message is the already-deferred fail-open.
- **Spec-mandated, no behaviour change** (1): the eight `resolveApiError(undefined, fallback)` catch blocks always return the fallback. The reviewer is right that it reads as dead indirection; the spec asked for the catch fallbacks to be routed through the helper, and undoing it now would be a deviation for a readability preference.
- **Refuted against the code** (2): `imageUrl: undefined` does *not* clear a day image — `updateTripDayImageForUser` guards `if (imageUrl !== undefined)` before building its `SET` clause. And the per-request query-count objection was already rejected in the first pass on the same grounds (`hasTripOwnerAccess` ran the same query).
- **Not a code finding** (2): the `sprint-status.yaml`/spec status mismatch is this workflow's own bookkeeping mid-run; and `errors.forbidden` living in the global `errors.*` namespace with trip-specific wording is a latent naming trap with no current non-trip call site, whose fix — renaming across seven files — contradicts the spec's explicit task and would degrade the wording for all seven real call sites.

**Follow-up review recommended: false.** The previous pass earned a `true` by changing authorization ordering, deleting shadowing definitions and altering a user-facing string. This one changed no source, no behaviour, no API and no copy. One test was added and mutation-verified; the rest are comments, a cleanup line and records. There is nothing here for a third reviewer to catch that this one did not.

**Verification.**
- `npm test` -- **129 files, 1667 tests, 0 failures** (previous pass 1666; baseline `43f177c` 1644)
- `npx tsc --noEmit -p .` -- **135 errors, 0 in `src/`** — exactly the baseline count; every error reported in a touched file predates this pass's insertion point
- `npx eslint` over all six touched files -- **0 errors**, 7 warnings, all pre-existing
- Mutation check: removing `case "forbidden"` from `TripDayView`'s `resolveApiError` turns the new render case red; source restored and re-verified by SHA-256
- `git status` confirms this pass modified five test/artifact files and nothing under `travelplan/src/`

**Residual risks.** Unchanged from the previous pass and all recorded in the ledger — the export/import possession question, the `accessRole` fail-open default, and AC6 stopping at the seven widened routes (DW-200). This pass adds three more: the two gallery reorder `PATCH` handlers are gated and tested but reachable from no UI for any role; the day-image `POST` deletes the previous image file before the repository confirms the write; and Epic 5's "a viewer sees the whole plan" contract is contradicted by the bucket list and the export without anyone having decided it should be.
