# Deferred Work

### DW-1: Map points missing location data create direct-line shortcuts in Google Maps URL

origin: migrated from legacy ledger ("Deferred from: fix-68-print-navigation (2026-05-03)"), 2026-08-01
location: `TripDayPrintDocument.tsx`
reason: Items without coordinates are simply omitted from the generated route, so the Google Maps link draws a direct line past them with no indication anything is missing. `map.missingLocations` is already available in the payload but is not surfaced near the link — consider adding a "(X locations not shown)" note when `missingLocations.length > 0`.
status: open

### DW-2: Test coverage gap: travel segment route label suppression when adjacent planItem has no title and empty content

origin: migrated from legacy ledger ("Deferred from: fix-68-print-navigation (2026-05-03)"), 2026-08-01
location: `tripDayPrintDocument.test.tsx`
reason: `getEntryDisplayName` correctly returns null for a plan item that has no title and empty content, which suppresses the travel-segment route label, but this exact case has no test pinning the behaviour.
status: open

### DW-3: 21 `react-hooks/set-state-in-effect` sites newly enforced as errors by the `eslint-config-next` 16.2.x bump

origin: migrated from legacy ledger ("Deferred from: npm-audit-zero-vuln-gate (2026-07-27)"), 2026-08-01
location: 12 files, concentrated in `TripDayView.tsx` — also `HeaderMenu.tsx`, `TripAccommodationDialog.tsx`, `TripDayMapFullPage.tsx`, `TripDayPlanDialog.tsx`, `TripDayPrintPage.tsx`, `TripDayTravelSegmentDialog.tsx`, `TripImportDialog.tsx`, `TripOverviewMapFullPage.tsx`, `TripShareDialog.tsx`, `TripTimeline.tsx`, `TripsDashboard.tsx`
reason: Was 22 sites across 13 files; the 22nd went away with `TripFeedbackPanel.tsx` in Story 5.9. Most are already-guarded async-fetch patterns (`cancelled` flag) that the new rule flags regardless of the guard; a few (e.g. `TripDayPlanDialog.tsx:301`, ~15 setters resetting on dialog open) are genuine reset-on-open anti-patterns needing a `key`-based remount or render-time derivation. Downgraded to `"warn"` in `eslint.config.mjs` scoped to exactly these 12 files (not a blanket downgrade — new code elsewhere still fails at `error`), so it needs its own scoped story, particularly for `TripDayView.tsx` given its size and centrality. Note: a sibling finding, `react-hooks/immutability` at `TripDayView.tsx:682`, was originally grouped with these but turned out to be a real stale-closure bug rather than a false positive and was fixed directly as part of that change instead of deferred.
status: open
decision: 2026-08-01 Fix only the genuine reset-on-open sites, keep the scoped warn for the guarded fetches — Refactor only the sites where the rule is reporting a real bug: the reset-on-open cluster in `TripDayPlanDialog.tsx` (~15 setters around `:301`) and any sibling dialog with the same shape, using a `key`-based remount or render-time derivation rather than an effect. Leave the already-guarded async-fetch effects (`cancelled` flag) as they are and keep `eslint.config.mjs`'s scoped `"warn"` for the files that still hold them, narrowing the `files:` list to exactly those that remain. Record in the config comment that the remaining warnings are known false positives for a guarded-fetch pattern, so the next reader does not re-derive it.

### DW-4: `brace-expansion`/`minimatch@3.1.5` npm audit finding cannot be fixed without breaking the lint toolchain

origin: migrated from legacy ledger ("Deferred from: npm-audit-zero-vuln-gate (2026-07-27)"), 2026-08-01
location: `travelplan/package.json`
reason: GHSA-mh99-v99m-4gvg (high, DoS) is required directly by ESLint 9 core (`@eslint/config-array`, `@eslint/eslintrc`) and by `eslint-config-next`'s bundled `eslint-plugin-react`/`-import`/`-jsx-a11y`, and no patched 1.x release of `brace-expansion` exists for this CVE. Three fixes were tried and all failed: ESLint 9 to 10 breaks (bundled `eslint-plugin-react` uses an API ESLint 10 removed), forcing `brace-expansion` to v5 crashes ESLint's glob matcher, and forcing `minimatch` to v9 does not crash but silently changes ignore-pattern matching and surfaces false-positive lint errors. devDependency-only, never ships, and requires attacker-controlled glob input to trigger, so it is unexploitable in this repo; `npm audit --omit=dev` is 0 and this is the sole remaining finding in the full audit. Blocked on Next.js shipping a newer `eslint-config-next` with an ESLint-10-compatible `eslint-plugin-react`.
status: open

### DW-5: No lockfile provenance/signature verification in the security-hardening pass

origin: migrated from legacy ledger ("Deferred from: npm-audit-zero-vuln-gate (2026-07-27)"), 2026-08-01
location: `travelplan/package-lock.json`
reason: `npm audit signatures` and general supply-chain provenance checking (compromised transitive deps, dependency confusion) were out of scope for a change that targeted known-CVE remediation, but adversarial review surfaced it as a real gap for anything calling itself a "security hardening" effort. Worth scoping as its own initiative.
status: open

### DW-6: No scheduled re-audit for already-merged dependencies

origin: migrated from legacy ledger ("Deferred from: npm-audit-zero-vuln-gate (2026-07-27)"), 2026-08-01
location: `.github/workflows/security-audit.yml`
reason: The new gate only runs on `push`/`pull_request`, so a dependency that is already merged and untouched will not be re-checked when a new CVE is disclosed against it tomorrow. Before building a custom cron workflow, check whether GitHub Dependabot security alerts are already enabled for this repo — that would cover it for free.
status: open

### DW-7: No override/allowlist mechanism if a future production-dependency CVE has no upstream fix

origin: migrated from legacy ledger ("Deferred from: npm-audit-zero-vuln-gate (2026-07-27)"), 2026-08-01
location: `travelplan/package.json` — the `audit:check` script
reason: Today's unfixable finding (`brace-expansion`, DW-4) happens to be dev-only, so `--omit=dev` sidesteps it cleanly. If a production dependency ever lands in the same situation, the gate as designed would hard-block `main` indefinitely with no escape hatch. Not needed now (production audit is 0), but worth designing before it is urgently needed.
status: open

### DW-8: Image URLs rendered without domain allowlist validation

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `TripDayPrintDocument.tsx:~213`
reason: An app-wide pattern rather than a defect in the print document; enforcing an allowlist requires a broader CSP/URL policy decision that spans every image-rendering surface.
status: open

### DW-9: `parsePrintablePlanText` in `tripRepo.ts` duplicates the `parsePlanText` client utility

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `tripRepo.ts:344`
reason: The duplication exists because of the server/client boundary split; consolidating the two copies requires establishing a shared pure-function package boundary that does not exist yet.
status: open

### DW-10: `day.date.toISOString()` throws on a corrupted DB Date value

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `tripRepo.ts:974`
reason: Data integrity is enforced at write time, and a defensive guard at this read site would mask a deeper DB problem rather than fix it — so the guard was deliberately not added.
status: open

### DW-11: Unauthenticated user sees the print page loading state before the 401 redirect

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `print/page.tsx`
reason: Consistent with every other client-rendered page in this app; moving to a server-side auth redirect is a broader architectural change than one print route.
status: open

### DW-12: New hardcoded hex/rgba literals contradict Story 7.1's token foundation

origin: migrated from legacy ledger ("Deferred from: code review of 7-2-trip-overview-redesign (2026-07-31)"), 2026-08-01
location: `TripTimeline.tsx:153`
reason: `HERO_SCRIM`, `DAY_ROW_GAP_BG = "#FBF6EE"` (a fourth near-duplicate of `warnBg`/`cardAlt`), plus `"#FFFFFF"`, `rgba(255,255,255,.18/.28/.55/.92)`, `"11.5px"` and `p: "16px 24px"` literals throughout the hero, stat strip, day row and sidebar. Several are spec-mandated literal values (the 4-stop scrim, the mockup's `#FBF6EE`, white-on-photo alphas), so this is not a straight defect — but retheming (dark mode, brand change) now requires editing component bodies again, which is exactly what 7.1 set out to eliminate. The story already flags the `#FBF6EE` vs `colors.warn-bg` `#F6ECE0` conflict between the mockup and DESIGN.md's token table; a token reconciliation pass is the natural home.
status: open

### DW-13: Four one-off SVG icon components inlined in `TripTimeline.tsx`

origin: migrated from legacy ledger ("Deferred from: code review of 7-2-trip-overview-redesign (2026-07-31)"), 2026-08-01
location: `TripTimeline.tsx:92-151`
reason: `HouseIcon`, `WarningTriangleIcon`, `ChevronRightIcon` and `ShareGlyphIcon` are private to this file, but Story 7.3 (Day Detail) needs the same house and warning glyphs and will duplicate them. Each also types its prop as `sx?: object` rather than `SxProps<Theme>`, so style-key typos go unchecked. The call was to extract to a shared icon module when 7.3 needs them rather than pre-emptively.
status: done 2026-08-01
resolution: already resolved: Both halves done: the four glyphs are now shared exports in `TripIcons.tsx` (`HouseIcon:29`, `WarningTriangleIcon:52`, `ChevronRightIcon:68`, `ShareGlyphIcon:218`) imported by `TripTimeline.tsx:17-22`, and `IconProps` types `sx` as `SxProps<Theme>` at `TripIcons.tsx:27` (Story 7.11 AC8) rather than `object`.

### DW-14: `data-layout` re-derives the breakpoint in JS, duplicating the CSS grid's source of truth

origin: migrated from legacy ledger ("Deferred from: code review of 7-2-trip-overview-redesign (2026-07-31)"), 2026-08-01
location: `TripTimeline.tsx:623`
reason: Layout is driven by `sx` responsive objects, but `isNarrowLayout` (`useMediaQuery(theme.breakpoints.down("sm"))`) also stamps a `data-layout="stacked"/"inline"` attribute purely so tests can assert something jsdom cannot compute. Change one breakpoint and the attribute reports "inline" while the CSS renders stacked — and the test still passes. Pre-existing pattern, not introduced by 7.2; worth replacing with a real layout assertion (Playwright) when the responsive story is tackled.
status: open

### DW-15: Route card has no text caption

origin: migrated from legacy ledger ("Deferred from: code review of 7-2-trip-overview-redesign (2026-07-31)"), 2026-08-01
location: `TripOverviewMapPanel.tsx:41`
reason: `EXPERIENCE.md`'s Interaction Primitives and Accessibility Floor both state map previews are "always paired with a text caption/summary (station count…)", and the mockup has `.map-caption` "5 Stationen · Kartenvorschau öffnen". Task 4 explicitly authorized keeping the icon-button instead, so this is task-sanctioned — but the station count now lives in a different component (the stat strip) and the card carries only a "Route" label plus an icon button. Also the populated map wrapper has no border/background where the mockup's `.map-preview` has `1px solid #E4DFD3` on `#F7F4EC` (only the empty state kept a dashed border). Revisit if the caption pattern is standardized across map surfaces.
status: open

### DW-16: `trips.dashboard.dayCount` renders "1 days" / "1 Tage" for a one-day trip

origin: migrated from legacy ledger ("Deferred from: code review of 7-4-trips-list-redesign (2026-08-01)"), 2026-08-01
location: `src/i18n/en.ts`, `src/i18n/de.ts`
reason: A pre-existing key that Task 4 explicitly said to keep as-is, so not a regression — but newly conspicuous: a one-day gap trip now shows "Sep 12, 2026 - Sep 12, 2026 · 1 days" directly beside a pill that correctly says "1 day open", because Story 7.4 added a dedicated `statusGapOne` key for the pill and nothing for the meta line. `formatMessage` is a `{key}` substituter with no plural support, so every count-bearing key needs its own singular twin until that changes. Natural home: whichever story next touches the shared i18n layer, or a small sweep auditing every `{count}` key across both dictionaries.
status: open

### DW-17: `listTripsForUser` materializes the full day/accommodation/plan-item tree of every trip to produce three integers

origin: migrated from legacy ledger ("Deferred from: code review of 7-4-trips-list-redesign (2026-08-01)"), 2026-08-01
location: `src/lib/repositories/tripRepo.ts:435-447`
reason: The `include` pulls every `TripDay` with its `accommodation` and all `dayPlanItems` for every trip the user owns, with no `take` and no upper bound, on the landing surface. An account with 30 trips × 30 days × 10 items joins ~9,000 rows to compute `openDayCount`/`planItemCount`/`plannedCostTotal`, all three of which are expressible as SQL aggregates. Not a defect in that story — Task 1 prescribed this exact `include` and explicitly forbade the alternatives (per-trip fetch, `getTripWithDaysForUser` in a loop) — but it scales linearly with the user's whole history. Revisit if the trips list ever gets slow, or alongside a broader read-path performance pass.
status: open

### DW-18: Design-system color constants live in an icon module

origin: migrated from legacy ledger ("Deferred from: code review of 7-4-trips-list-redesign (2026-08-01)"), 2026-08-01
location: `src/components/features/trips/TripIcons.tsx:202-215`
reason: `ROW_GAP_BG = "#FBF6EE"` and `NEUTRAL_PILL_BG = "#F1ECE1"` are exported from a file whose stated purpose is SVG glyphs, and `TripTimeline.tsx` now imports a background color from `TripIcons`. Task 4 sanctioned this location and both carry mockup line references, so this is not a defect — but `theme.ts` already owns exactly this class of value (`warnBg`, `cardAlt`, `borderStrong`), and `NEUTRAL_PILL_BG`'s own docstring concedes it is "the one value on this screen with no token behind it", which argues for adding the token rather than housing it in the icon file. Folds into the hardcoded-literal reconciliation pass in DW-12.
status: done 2026-08-01
resolution: already resolved: Story 7.11 AC1-AC3 (commit 33abbdf): `ROW_GAP_BG` and `NEUTRAL_PILL_BG` no longer exist anywhere in `src/` (grep returns zero hits) and the values are now real tokens - `warnBgRow: "#FBF6EE"` at `theme.ts:78` and `pillNeutral: "#F1ECE1"` at `theme.ts:84`, mirrored in `globals.css` as `--color-warn-bg-row` / `--color-pill-neutral`.

### DW-19: The three new `/api/trips` payload fields are non-optional and unvalidated, while `updatedAt` right above them carries a defensive `?`

origin: migrated from legacy ledger ("Deferred from: code review of 7-4-trips-list-redesign (2026-08-01)"), 2026-08-01
location: `src/components/features/trips/TripsDashboard.tsx:39-45, 156, 523`
reason: `openDayCount`, `planItemCount` and `plannedCostTotal` are declared required, the fetch body is cast rather than parsed, and a response missing them makes `totalCost` `NaN` — rendering "€NaN" in the stat cell and every row — while `deriveTripStatus` silently returns `planned` for everything. Reachability is thin in practice (client bundle and route deploy together in Next.js, and `GET /api/trips` sets no cache headers), which is why this was deferred rather than patched; but the inconsistency with the `updatedAt` guard three lines above is worth resolving the next time this payload changes. A cheap `?? 0` at the two read sites closes it.
status: open

### DW-20: Past-row `opacity: 0.78` drops 12px `inkSoft` text below WCAG AA

origin: migrated from legacy ledger ("Deferred from: code review of 7-4-trips-list-redesign (2026-08-01)"), 2026-08-01
location: `src/components/features/trips/TripsDashboard.tsx:399`
reason: The sub-line (`#6B675C` on `#FFFFFF`) composites to about `#8B8880` at roughly 3.4:1 against the 4.5:1 floor for normal text, and the "Completed" pill (11.5px bold `inkSoft` on `#F1ECE1`) fails the same way. The code is spec-compliant — `DESIGN.md.components.trip-row.opacity-past` prescribes 0.78 and is explicit that opacity is the whole treatment for a past row — so the conflict lives in the design system, not on this screen, and it is the same class of problem as the `inkMuted` contrast finding carried from 7-2's review (DW-28). Resolving it per-screen would fragment the archival treatment across surfaces; resolve both together in a design-system contrast pass that decides whether the floor is a higher opacity (about 0.85), an opacity applied to the photo and border only, or a darker `inkSoft`. Deferred by Tommy during the 7-4 code review for exactly that reason.
status: done 2026-08-01
resolution: already resolved: Story 7.11 AC5: the row-level `opacity` is gone from `TripsDashboard.tsx` - the 0.78 now composites only the border (`:462` `alpha(tokens.borderStrong, 0.78)`) and the photo (`:537`), and the comment at `:446-457` states the new rule explicitly ("the row's text and status pill render at full opacity"). Pinned by `test/tripsDashboard.test.tsx:264`.

### DW-21: Coverage gaps in an otherwise well-tested change (7-4 trips list)

origin: migrated from legacy ledger ("Deferred from: code review of 7-4-trips-list-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/test/tripsDashboard.test.tsx`
reason: No assertion that the `start → destination` route string actually renders (the route test proves the two new API fields are returned, nothing proves they reach the DOM); no test for the empty state, for the error state and its zeroed stat strip, or for a trip whose `startDate` is today. The `:has(:focus-visible)` focus ring is untestable in jsdom as written and would need Playwright. No AC is left uncovered, so this is coverage depth rather than a gap in verification.
status: open

### DW-22: The test suite recursively deleted the developer's real upload directory

origin: migrated from legacy ledger ("Fixed during: hero-image investigation (2026-08-01)"), 2026-08-01
location: `test/setup.ts`, `src/lib/trips/uploadPaths.ts`
reason: Found while diagnosing "hero image appears on upload, then reverts to the blue/green background after navigating away and back". Four image-route suites cleaned up with `fs.rm(path.resolve(process.cwd(), "public", "uploads", "trips"), { recursive: true, force: true })` in `beforeEach` (`tripHeroImageRoute`, `tripDayImageRoute`, `tripAccommodationImagesRoute`, `tripDayPlanItemImagesRoute`). Under test `process.cwd()` is `travelplan/`, so that path is the live dev storage — every `npm test` destroyed all uploaded hero, day, accommodation and plan-item images. This actually happened: a 3.3 MB dev hero image and two day images were lost during the Story 5.9 code review, and it left the DB pointing at missing files, which is what seeded the cached 404 behind the reported symptom. Residual data state: `trips.hero_image_url` and 2 `trip_days.image_url` rows in `prisma/dev.db` still reference deleted files — re-uploading each image clears it, and until then those surfaces fall back to their placeholder/background.
status: done 2026-08-01
resolution: All 8 upload path sites across 6 routes now resolve through `src/lib/trips/uploadPaths.ts`, which honours `UPLOADS_PUBLIC_ROOT` (defaulting to `<cwd>/public`, so dev and prod behaviour and served URLs are unchanged); `test/setup.ts` points it at a per-worker temp dir. Verified with a canary file that survives a full suite run, and guarded by `test/uploadPaths.test.ts`, which fails if any path resolves inside the repo's `public/`.

### DW-23: The hero image URL was never versioned on any read path

origin: migrated from legacy ledger ("Fixed during: hero-image investigation (2026-08-01)"), 2026-08-01
location: `src/lib/repositories/tripRepo.ts`, `src/app/api/trips/[id]/route.ts`, `src/app/api/trips/route.ts`, `TripTimeline.tsx`, `TripsDashboard.tsx`
reason: Found while diagnosing "hero image appears on upload, then reverts to the blue/green background after navigating away and back". The upload route replaces `hero.<ext>` in place, so the stored URL is byte-identical across replacements and a cached response — including a cached 404 from the window described in DW-22 — wins indefinitely. `withImageCacheBuster` was called in only two places, both upload handlers, writing a stamped URL into local component state; every read path (`TripTimeline:371`, `TripsDashboard:174`) used the bare URL, and the trip API did not even return `updatedAt`, so no reader could version it. Hence the symptom: the image appears right after upload and vanishes the moment the component refetches. Day images never had this bug because they were already versioned at read time from `day.updatedAt`.
status: done 2026-08-01
resolution: `trip.updatedAt` is now returned by `GET`/`PATCH /api/trips/:id` and `GET /api/trips`, and both read paths version the hero through the existing `withImageCacheBuster`; the two dialogs now pass a raw URL plus its version instead of a pre-stamped URL, so it cannot double-stamp into `?v=A&v=B`. Regression tests in `test/tripTimelineRoles.test.tsx`; the added `updatedAt` key was correctly caught by the payload key-set test added in the same review.

### DW-24: The destructive drop migration has no expand/contract sequencing and no rollback path

origin: migrated from legacy ledger ("Deferred from: code review of 5-9-remove-comments-and-voting-feature (2026-08-01)"), 2026-08-01
location: `prisma/migrations/20260801090000_remove_trip_feedback/migration.sql:5-7`
reason: Two coupled gaps. (1) Applying the migration while any process still runs the pre-removal code breaks the entire trip-detail read path, not just comments: at `cacfa72` `getTripWithDaysForUser` calls `listTripFeedbackForUser` unconditionally, so a missing `trip_feedback_targets` table throws, hits the route's bare `catch`, and returns 500 for the whole trip detail page and `PATCH` — nothing sequences this as ship-code-first-then-drop-tables. (2) There is no reverse path: `20260309090000_add_trip_feedback` is already recorded in `_prisma_migrations`, so a `git revert` of this story plus `prisma migrate deploy` applies nothing, the tables stay dropped and the reverted code 500s per (1); the only alternative, `prisma migrate dev`, sees drift and offers a full DB reset. Prisma has no down migrations and none was authored. Not actionable now — the app is single-instance SQLite (`prisma/dev.db`, one trip) with no rolling deploy, so neither path is reachable today; it becomes real the moment this is deployed to more than one instance or gets a staging environment. Revisit as part of any deployment-story work.
status: open

### DW-25: `currentUserId` is an orphaned response field with no consumer

origin: migrated from legacy ledger ("Deferred from: code review of 5-9-remove-comments-and-voting-feature (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/api/trips/[id]/route.ts:47,169`
reason: Still serialized into both the `GET` and `PATCH` trip payloads, but its only reader was the deleted `TripFeedbackPanel`'s comment-authorship check. AC 5 forbade changing any surviving response field, so Story 5.9 correctly left it on the wire and the code review removed only the two dead client-local type declarations (`TripTimeline.tsx`, `TripDayView.tsx`). The field itself is now dead weight shipped to every client on every trip read — harmless, but it should either be dropped in a story that is allowed to change the response contract, or gain a real consumer. Recorded so the next reader does not have to rediscover that nothing reads it.
status: open

### DW-26: `cachedClientMatchesCurrentSchema` is structurally blind to removal-only schema changes

origin: migrated from legacy ledger ("Deferred from: code review of 5-9-remove-comments-and-voting-feature (2026-08-01)"), 2026-08-01
location: `src/lib/db/prisma.ts:40-47`
reason: All three surviving predicates are field-exists assertions (`CostPayment.sortOrder`, `User.mustChangePassword`, `TripMember.role`), every one of which a client generated from the pre-removal schema still satisfies — so the function returns `true` for precisely the staleness Story 5.9 creates, and only the `PRISMA_SCHEMA_TAG` string comparison forces the teardown. The edit is exactly what Task 1 mandated and works today, but the guard no longer does what its name claims: the next removal-only schema change that forgets to bump the tag silently reuses a stale client with no second line of defence. A field-absence predicate, or deriving the tag from a schema hash, would restore defence-in-depth.
status: open

### DW-27: `formatCost` now diverges across screens

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripCostOverview.tsx:245-251`
reason: Day Detail switched to the currency-aware formatter (`style: "currency", currency: "EUR"`) that 7.2 landed in `TripTimeline.tsx`, but `TripCostOverview.tsx` is a third copy still emitting a bare number wrapped in the `trips.stay.costSummary` "Cost: {value}" template. The same amount therefore reads "€160.00" on Day Detail and "Cost: 160.00" on the cost overview, and `test/tripCostOverview.test.tsx:137` pins the old form. All three copies also hardcode EUR with no trip-level currency field feeding them. Task-sanctioned (the story scoped the switch to this screen), but the debt is now three-way. Natural home: one shared `formatCost` helper plus a trip currency field, or the 7.4-7.7 screen that owns the cost route.
status: open

### DW-28: `inkMuted` fails AA at the size it is used

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `theme.ts:61`, consumer `TripDayView.tsx:1787-1789`
reason: `#8A8677` on `tokens.card` `#FFFFFF` is 3.65:1, below the 4.5:1 floor, and the new coverage-axis tick labels render it at 10px. The token is Story 7.1's and predates 7.3; darkening it is a system-wide visual change. Belongs to the standing design-token reconciliation pass deferred from 7.2 (DW-12) and shares the contrast question in DW-20 — see also DW-61, which measured the post-7.11 residue of the same token.
status: done 2026-08-01
resolution: already resolved: Story 7.11 AC4: `colors.inkMuted` is `#7A7667` at `theme.ts:61` (4.55:1 on `card`), darkened from the `#8A8677` this entry measured at 3.65:1; `globals.css:10` carries the same value. DW-61 already tracks the post-7.11 residue on non-`card` surfaces, and says so.

### DW-29: "Total travel time" counts travel the coverage bar refuses to draw

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripDayGanttSegments.ts:98-111`, consumer `TripDayView.tsx:1055-1062`
reason: `buildTravelSegments` skips any segment whose origin has no resolvable end time (`if (!endTime || !endTime.trim()) continue`), while the new stat cell sums every `travelSegments[].durationMinutes` unconditionally. A day whose activities have no `toTime` therefore shows "Total travel time 2h 10m" above a bar containing zero travel segments. The stat is arguably the more truthful of the two and the bar's skip is the limitation. Pre-existing asymmetry, newly made visible — fixing it means deciding whether an untimed travel segment should be positioned by inference or excluded from both surfaces.
status: open

### DW-30: `MiniImageStrip` thumbnails are mouse-only

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripDayPlanItemContent.tsx:170-197`
reason: The images carry `onClick` and `cursor: pointer` but no `role`, `tabIndex` or key handler, so the lightbox cannot be opened from the keyboard; the "+N" overflow indicator is plain caption text and the 4th and later photos are unreachable by any input. Pre-existing and untouched by 7.3's `variant` addition — but that story promoted the strip to the timeline's primary photo affordance on Day Detail, so the blast radius grew. Fix belongs with a photo-viewer story covering this plus the two map-dialog call sites and `TripDayMapFullPage`; see DW-51, which is the same defect in the newer shared `PhotoUploadField` primitive.
status: open

### DW-31: The day-detail route has no `h1`-`h4`

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripDayView.tsx:1722`
reason: The day title is the page's top heading at `h5`, chosen because about 14 existing assertions pin `level: 5`. `<h1>` exists only in `HomeHero.tsx` and `TripDayPrintDocument.tsx`, so this is an app-wide convention rather than a Day Detail defect, and fixing it means re-levelling every screen and its assertions at once.
status: open

### DW-32: The day photo has no text alternative anywhere

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripDayView.tsx:1611-1613`
reason: The hero is a decorative CSS `background-image` per `DESIGN.md.Photo Alt-Text` (the adjacent title names the day) and `trips.dayImage.previewAlt` was deleted from both dictionaries as the story required — correct for the hero. The residual gap is that the day-details edit dialog has no preview `<img>` either: it only says "No day image selected yet." when the image is absent, so a non-sighted owner cannot confirm an upload succeeded. That dialog's internals are Story 7.7's surface.
status: done 2026-08-01
resolution: already resolved: Story 7.7 (a4f553b) closed the residual gap: the day-details dialog now renders the current day image through `PhotoUploadField`'s `images` prop with a real text alternative, `alt: t("trips.dayImage.previewAlt")` at `TripDayView.tsx:2576`, and the key is back in both dictionaries (`en.ts:335`, `de.ts:332`).

### DW-33: Alerts are the one surface in the redesigned share dialog left on stock MUI colours

origin: migrated from legacy ledger ("Deferred from: code review of 7-5-share-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripShareDialog.tsx:369-371`
reason: `theme.ts` defines `primary`, `secondary` and `warning` but no `error` palette entry, so `<Alert severity="error">` renders MUI's default `#d32f2f` and `severity="success"` its default green — two colours absent from the token set, inside a dialog where every other element was re-tokenised. The system does have an error colour, `colors.errorBorder` `#C97A3E` (`theme.ts:71`), already used for input error borders; it just never reached the alerts. Not 7.5's doing: the alerts predate it, Task 2 explicitly kept them in place ("Alerts stay where they are") and the Dev Notes forbade touching `theme.ts`. Every other dialog in the app has the same gap, so the fix is a theme-level `error` palette entry plus an `MuiAlert` treatment, not a local `sx` on one component. Natural home: Story 7.7, which owns the remaining dialog chrome, or the standing design-token reconciliation pass (DW-12); see also DW-49.
status: done 2026-08-01
resolution: already resolved: Story 7.11 AC7: `theme.ts` now defines `error: { main: colors.errorBorder }` (`:178`), `success` (`:179`) and `info` (`:184`), plus an `MuiAlert` block (`:429-444`) giving all four severities a token border - so no alert renders MUI's `#d32f2f` or stock green, and no component-local `sx` was needed.

### DW-34: The CSRF preamble is now copy-pasted an eleventh time

origin: migrated from legacy ledger ("Deferred from: code review of 7-5-share-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/api/trips/[id]/members/route.ts:123-127`
reason: The new `DELETE` opens with the same four lines as the `POST` twenty lines above it (`:50-54`), and a private `requireCsrf` helper is independently redefined in ten other route files (`bucket-list-items`, `accommodations`, `day-plan-items`, `travel-segments`, `hero-image`, and more). The duplication is task-sanctioned and was the correct call there — Dev Notes rule 1 says to copy `POST`'s guard order from the same file rather than re-derive it, precisely because a clever abstraction is how access-control drift starts. The debt is that the CSRF check now has twelve independent implementations: change the header name, or add a constant-time compare or a second accepted header, and the copies that are missed keep passing their own tests. Fix is one shared guard in `src/lib/security/csrf.ts` applied across all twelve routes in a single change, which is a route-layer story, not a redesign story.
status: open

### DW-35: Every `variant="contained"` MUI button in the app has no visible keyboard focus state

origin: migrated from legacy ledger ("Deferred from: 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/theme.ts:78-104, 253-273`
reason: Found by Story 7.6's manual browser check, pre-existing and outside its scope boundary. MUI's contained-button focus indicator is `boxShadow: theme.shadows[6]`, and `theme.ts` replaces the entire `shadows` array with `"none"` at every index except 24 (the modal shadow), so a keyboard-focused primary button computes to `outline: none` / `box-shadow: none` — measured directly in Chrome on `/auth/login`, where the submit button was the only focusable element on the screen with no focus indicator at all (inputs get the accent halo from `MuiOutlinedInput`, links get the UA ring). This fails `EXPERIENCE.md`'s Accessibility Floor ("visible keyboard focus everywhere"). Story 7.6 patched it only for the five auth submits via `AUTH_SUBMIT_SX` (`src/components/features/auth/authSubmitSx.ts`) because its scope boundary excludes `theme.ts`, but the gap is app-wide: every "Reise hinzufügen", every dialog confirm, every save button. The real fix is a `MuiButton` `&.Mui-focusVisible` treatment in `theme.ts` (plus deciding whether `shadows[6]` should stay blanked), after which the auth-local override should be deleted rather than left as a second source of truth. `EXPERIENCE.md:95` notes focus visuals were never mocked, so the design system has to choose the ring.
status: done 2026-08-01
resolution: already resolved: Story 7.11 AC6: `theme.ts:302-305` adds `MuiButton` `"&.Mui-focusVisible": { outline: "2px solid #2B2A26", outlineOffset: "2px" }` app-wide, and the auth-local second source of truth is gone - `src/components/features/auth/` now holds only `AuthScreenShell.tsx` and `AuthTabs.tsx`, with zero references to `AUTH_SUBMIT_SX` in `src/` or `test/`.

### DW-36: `register/page.tsx` leaves BOTH the `fetch` and the `response.json()` unguarded, so a network failure or a 5xx with an empty body shows the user nothing

origin: migrated from legacy ledger ("Deferred from: 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/(auth)/auth/register/page.tsx:77,86`
reason: Amended by the code review of 7.6 — the original entry named only `response.json()`, but `await fetch(…)` at `:77` is equally unwrapped, confirmed by probe: with `fetch` rejecting the result is zero alerts plus a `TypeError: Failed to fetch` unhandled rejection, so a fix that wraps only the `json()` call leaves the offline case broken and both need the same treatment. `const body = (await response.json()) as ApiEnvelope<…>` is unwrapped, unlike `login`, `forgot-password`, `reset-password` and `first-login-password`, which all wrap the same call in `try/catch` and fall back to their `*.error` message. When `POST /api/auth/register` returned a 500 with an empty body during the browser check (a Prisma failure in the throwaway environment), `response.json()` threw, the rejection went unhandled (`unhandledRejection: SyntaxError: Failed to execute 'json' on 'Response'`), `isSubmitting` reset, and the form showed no error notice whatsoever — the user sees a spinner flick and nothing else. Also `register`'s CSRF-bootstrap `catch` sets `auth.register.initError` where `login`'s sets `csrfToken` to null, so the five pages have three different error-handling shapes for the same two calls. Pre-existing and deliberately untouched: Story 7.6's Task 4 scoped every line above the `return` to a zero diff. Fix is a four-line `try/catch` matching its four siblings, ideally alongside extracting the shared CSRF-fetch/`resolveApiError` preamble the five pages each re-declare (DW-42).
status: open

### DW-37: `token_invalid` / `token_expired` are unmapped, and the reset screen offers no recovery path

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/(auth)/auth/reset-password/page.tsx:121-134`
reason: The `resolveApiError` switch handles `rate_limited`, `csrf_invalid`, `server_error` and `invalid_json`; the confirm route's two token codes (`api/auth/password-reset/confirm/route.ts:50,54`) fall through to the generic `auth.reset.error` ("Password reset failed. Please try again."), which invites a retry that can never succeed. Every expired or already-used reset link lands here, making it the flow's most reachable failure. The switch is byte-identical to the pre-change page, so this is pre-existing — but 7.6 grew its blast radius: the token field is now hidden on exactly this path (`:200`) and the only footer link is `auth.backToLogin` (`:186`), so there is no route from the dead end to `/auth/forgot-password` for a fresh link. Fix is two switch cases plus a conditional "request a new link" footer link, which means adding `auth.reset.tokenInvalid` / `auth.reset.tokenExpired` to both dictionaries — copy work this story's AC6 ("no endpoint, schema, session or redirect changes") did not authorise. Natural home: a story that owns the reset flow's error surface.
status: open

### DW-38: A 2.27 MB unoptimised JPEG is now the LCP element on all five auth screens

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/auth/AuthScreenShell.tsx:29,116`
reason: `public/hero-mountains.jpg` is 2,272,765 bytes and is painted as a CSS `background-image` via `toCssUrl(HERO_IMAGE)`, so it gets no `next/image` format negotiation, no responsive `srcset`, no `priority` preload and no lazy/eager control — including at 390px, where it is cropped to a 180px band. The `primary.main` pre-load fill means users on slow links stare at a flat green panel for the duration. Not 7.6's doing: the asset shipped for the marketing landing page (`page.module.css:84`) and Task 2 prescribes the CSS-background treatment verbatim (the hero must be decorative with no `<img>`, per `DESIGN.md.Photo Alt-Text`). The debt is that the app's front door now depends on it. Fix is an optimised/resized derivative plus a `<picture>`-style AVIF/WebP path, or a `next/image` `fill` with `aria-hidden` — both of which change the shell's markup. Natural home: an asset-pipeline or performance pass; the same treatment applies to the trip and day heroes.
status: open

### DW-39: No `noValidate` on any auth form, so native browser validation preempts the styled error treatment

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/(auth)/auth/login/page.tsx:150` and the four sibling pages
reason: The forms are `<Box component="form" onSubmit={…}>` with no `noValidate`, and `AuthField` forwards `type="email"` straight to the input. Typing `abc` into any email field and submitting fires the browser's own `typeMismatch` bubble — in the browser's UI language, outside the design system — and the RHF handler never runs, so `auth.emailInvalid` and the whole `WarningTriangleIcon` warn-toned hint this story built are bypassed for the most common invalid-email case. Pre-existing (the old pages had the same shape) and invisible in jsdom, which does not implement constraint validation. Fix is one `noValidate` attribute per form, but it should land with a check that every native constraint currently doing real work has an RHF equivalent — the `required` attributes MUI emits from `register` included. Natural home: the same form-primitive pass that would add `autoComplete`.
status: open

### DW-40: `AuthField` merges a caller `sx` by object spread

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/auth/AuthField.tsx:60`
reason: `...rest.sx` is spread into an object literal, but `AuthFieldProps` extends `TextFieldProps`, so `sx` is legally `SxProps<Theme>`: an array or a `(theme) => …` callback as well as an object. An array spreads to `{ 0: {…} }` and a callback spreads to `{}`, so a future caller's styles would be silently dropped — and the placeholder and helper-text overrides above may be clobbered — with no type error. Latent: no current call site passes `sx`. Fix is the array form (`sx={[baseSx, ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx])]}`), which MUI supports natively. Recorded rather than patched because it has no live consumer and the same pattern likely exists in other wrapper components.
status: done 2026-08-01
resolution: already resolved: `AuthField.tsx` no longer exists; its successor `src/components/forms/FormField.tsx` merges the caller `sx` with MUI's array form at `:77` and `:96-98` (`...(Array.isArray(rest.sx) ? rest.sx : [rest.sx])`), with a comment naming exactly this defect - so an array or callback `sx` is no longer silently dropped.

### DW-41: AC3 of Story 7.6 ships with no automated assertion

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/test/authScreens.test.tsx`
reason: Nothing in the suite asserts that the five auth routes render without an `AppHeader` ancestor, which is the entire point of the `(auth)` route group and the story's one structural change. It was verified twice by other means (the `npm run build` route manifest, and the browser check confirming no `header`/`.MuiAppBar-root` in any of the five DOMs), so the risk is regression rather than correctness: a future story moving a page back under `(routes)`, or adding a header to the `(auth)` layout, would pass every test. The obstacle is that a page-component test renders the page in isolation and never sees its layout — asserting this needs either a route-level render harness or an E2E check. Natural home: the E2E suite (`bmad-qa-generate-e2e-tests`), where a single `expect(page.locator("header")).toHaveCount(0)` across the five URLs covers it.
status: open

### DW-42: The CSRF bootstrap has three different shapes across the five auth pages

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/(auth)/auth/register/page.tsx:49-63` and the four siblings
reason: `register` catches and sets `auth.register.initError` with `[]` deps; `first-login-password` uses `[t]`; `login` silently leaves `csrfToken` at `null` and shows nothing. The `[]` variants close over a stale `t`, so a language change during mount would render the wrong string. The same five files each re-declare their own `resolveApiError` switch. Explicitly out of bounds for 7.6 — "Refactoring the CSRF-fetch effects" is on the story's "What must not be built" list, and Task 7 says that if `react-hooks/set-state-in-effect` newly fires the correct response is to report it, not refactor auth bootstrapping inside a visual story; that story created `components/features/auth/` for exactly this kind of sharing and correctly limited it to presentation. Fix is one `useCsrfToken()` hook plus a shared `resolveApiError` factory across all five pages in a single change. Natural home: the same route-layer story that would consolidate the twelve copies of the CSRF server guard (DW-34).
status: open

### DW-43: Three success notices are rendered for a frame no user sees

origin: migrated from legacy ledger ("Deferred from: code review of 7-6-login-register-and-password-reset-redesign (2026-08-01)"), 2026-08-01
location: `login/page.tsx`, `register/page.tsx:119-121`, `first-login-password/page.tsx`, shell at `AuthScreenShell.tsx:213`
reason: Each page sets `setSuccess(true)` and then immediately calls `router.push(…)`, so `AuthScreenShell`'s success `AuthNotice` paints and is torn down in the same tick. Meanwhile `auth.login.success`, `auth.register.success` and `auth.firstLogin.success` are maintained in both dictionaries and the shell's `success` prop is threaded through three pages to serve them. Pre-existing: the old pages did the same with `<Alert severity="success">`. Either the redirect should await a brief confirmation dwell, or the three keys and the three `success` wirings are ceremony that should be deleted. Recorded because deciding which is a UX call, not a cleanup — and because a reviewer will otherwise re-derive it every time. Only `forgot-password` and `reset-password`, which do not redirect, use the success notice for real.
status: open

### DW-44: The day-detail page overflows horizontally by 25px at a 390px viewport

origin: migrated from legacy ledger ("Deferred from: 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"; re-raised by the code review of the same story), 2026-08-01
location: `travelplan/src/components/features/trips/TripDayView.tsx` — the Gantt coverage block, around `:1780-1800`
reason: Found by Story 7.7's browser check, outside its scope boundary. A visually-hidden `<span>` carrying `trips.dayView.coverageAxisDescription` ("The coverage bar spans the full day, from 00:00 to 24:00.") is positioned but never clipped, so its full text box extends to x=415 on a 390px viewport and `document.scrollWidth - clientWidth` measures 25. It is the sole overflowing element, it is present with no dialog open, and `/trips` and `/trips/t1` both measure 0 — so this is the day page's own defect, not the redesigned dialogs' (all four measured `scrollWidth === clientWidth` at 390px). Story 7.3 owns this page and is `done`; Story 7.7 owns exactly one block of the file (the day-details dialog), so it was measured and recorded rather than fixed. Fix is the standard screen-reader-only clip (`position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0)`) — the same treatment `AuthScreenShell.tsx:87` already uses for its language-name spans, which suggests extracting one `visuallyHidden` constant rather than a third hand-rolled copy. Natural home: whichever story next touches Day Detail, or the standing accessibility pass.
status: open

### DW-45: The three photo-upload surfaces still state three different size limits

origin: migrated from legacy ledger ("Deferred from: 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `trips.form.heroImageHelper` ("up to 5MB"), `trips.dayImage.fileHelper` ("up to 15MB"), and the two galleries which state none
reason: `PhotoUploadField` deliberately takes its hint line as a prop so each call site passes its own existing key, and the mockup's invented "bis zu 10 MB pro Foto" was adopted nowhere. Reconciling them is a validation/data question (what does the server actually enforce, per surface?) rather than a visual one, so Story 7.7 left all three strings as it found them. Fix is to establish the real per-route limit, then either converge the three or make the helper derive from a shared constant.
status: open

### DW-46: `TripShareDialog.tsx` still carries its own inlined copy of the dialog chrome

origin: migrated from legacy ledger ("Deferred from: 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripShareDialog.tsx:404-432, 600-620`
reason: Story 7.5 built the head/body/footer treatment inline (including both MUI traps: the `DialogContent` sibling-selector padding reset and the explicit `aria-labelledby` so the sub-line stays out of the accessible name), and 7.7 extracted exactly that into `components/ui/DialogShell.tsx` for its four dialogs. The share dialog was deliberately not converted — it was in `review`, and rewriting a story under review is how merge conflicts and re-review loops start. It is now the only dialog in the app with a second copy of this chrome, so a change to `DialogShell` will silently not reach it. Fix is a mechanical swap once 7.5 is `done`.
status: open

### DW-47: `TripImportDialog.tsx` now has zero production call sites

origin: migrated from legacy ledger ("Deferred from: 7-8-trip-overview-lower-sections-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripImportDialog.tsx`
reason: Story 7.8 removed the "Import JSON" button (AC3) and the dialog's mount from `TripTimeline.tsx`; the component is now reachable only from `test/tripImportDialog.test.tsx`, and its i18n key `trips.import.action` still resolves for its own submit button label. AC3 explicitly required the underlying import dialog and route to stay intact (`FR33`/`FR34` marked "capability retained and functional; UI entry point removed from the trip overview by Story 7.8"), so this is an intentional zero-call-site state, not dead code. Recorded here so the next reader does not delete the file, its tests or the surviving i18n keys as unused; the next surface to reconnect it (or a redesigned equivalent) inherits this note.
status: open

### DW-48: `TripBucketListPanel.tsx` swallows load errors while collapsed

origin: migrated from legacy ledger ("Deferred from: code review of 7-8-trip-overview-lower-sections-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripBucketListPanel.tsx:464-477`
reason: `loadError`, `loading` and `emptyState` all live inside `<Collapse in={!isCollapsed} unmountOnExit>`. The panel is default-collapsed (Story 4.4 shipped that) and Story 7.8 hoisted the count line into the always-visible header, so on a load failure a user sees "0 entries" in the header — a lie — with no visible error until they click to expand. Not caused by 7.8 (the Collapse behavior pre-dates it) but exposed by the count-line hoist. Fix is either to render `loadError` outside `Collapse` or to gate the count line on `!loadError`. Natural home: the accessibility/error-surface pass that already owns the `data-layout` re-derivation deferred from 7-2 (DW-14).
status: open

### DW-49: Bucket-item delete-confirmation dialog uses off-palette `color="error"` red

origin: migrated from legacy ledger ("Deferred from: code review of 7-8-trip-overview-lower-sections-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripBucketListPanel.tsx:647`
reason: Story 7.8 removed exactly this off-palette `#d32f2f` treatment from the trip-level Delete button (`TripTimeline.tsx`, AC2), but the delete-confirmation dialog inside the same panel that story restyled still ships `<Button color="error" variant="contained">`. Task 4 explicitly deferred dialog internals to Story 7.7's scope and 7.7 landed without touching this dialog, so the two Delete confirmations on the Trip Overview now diverge in palette. Fix is a one-word deletion (`color="error"` removed) once the dialog-audit pass is scoped. `theme.palette` has no `error` entry; MUI's stock `#d32f2f` is the value being removed — see DW-33 for the missing theme-level error palette.
status: done 2026-08-01
resolution: already resolved: The off-palette red is gone at the theme level: `MuiButton.containedError` (`theme.ts:320-324`) paints both delete confirms `colors.warn` `#8A5A2B` with a white label at 5.87:1, so `TripBucketListPanel.tsx:647` and `TripDeleteDialog.tsx:125` now render identically and neither shows MUI's `#d32f2f`.

### DW-50: Row-level edit/delete `IconButton`s have 2px cluster gap and no `:focus-visible` treatment

origin: migrated from legacy ledger ("Deferred from: code review of 7-8-trip-overview-lower-sections-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripBucketListPanel.tsx:534-551`
reason: The two 44×44 hit areas sit `gap: 0.25` apart (2px) with no keyboard-focus signal beyond the browser default. WCAG 2.2 target-size guidance and the iOS HIG both call for spacing between adjacent touch targets, and a tab-through user has no signal which button is focused. Pre-existing at the shell level (Day Detail's bucket panel has the same 44px pattern from Story 7.3), so the fix belongs to the standing accessibility polish pass rather than that story. A wider gap (at least 8px) plus a `&:focus-visible` outline treatment on both `IconButton`s closes it; see DW-65 for the app-wide `MuiIconButton` focus gap.
status: open

### DW-51: Photo thumbnails are click-only — keyboard and AT cannot open the fullscreen viewer

origin: migrated from legacy ledger ("Deferred from: code review of 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/forms/PhotoUploadField.tsx:196-213`
reason: The `<Box component="img">` carries `onClick={image.onOpen}` and `cursor: pointer` but no `tabIndex`, no `role="button"` and no key handler. Pre-existing: HEAD's gallery blocks had the identical pattern, and the Dev Notes explicitly place the `MiniImageStrip` keyboard defect (DW-30) out of scope. What changed is the blast radius and the location — the defect now lives in a new shared primitive used by three surfaces (accommodation gallery, day-plan gallery, day-details preview) rather than in one display component, and the component's own docblock at `:17-21` cites exactly this defect in `MiniImageStrip` as the reason not to reuse it. Fix both together in the photo-viewer story that already owns DW-30: `PhotoUploadField`, `MiniImageStrip`, the two map-dialog call sites and `TripDayMapFullPage`.
status: open

### DW-52: The file input is never reset, so the same file cannot be re-selected after an upload-then-remove cycle

origin: migrated from legacy ledger ("Deferred from: code review of 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/forms/PhotoUploadField.tsx:117-138`
reason: The `<Box component="input" type="file">` has no `value=""` reset and none on the `onChange` path. Pick `photo.jpg`, upload (succeeds, `setGalleryFiles([])`), remove the thumbnail, then pick `photo.jpg` again: the DOM input's `value` still holds it, no `change` event fires, `galleryFiles` stays `[]` and the Upload button stays `disabled`, so the user must choose a different file first. The same shape exists in the day-details dialog around `setDayImageFile(null)`. Pre-existing — HEAD's `TextField type="file"` had no reset either — but now centralised in one component, so one `event.target.value = ""` after `onFilesSelected` fixes all three surfaces at once.
status: open

### DW-53: The wholesale `@mui/material` mock in `tripDayPlanDialog.test.tsx` has drifted further from real MUI, in ways that hide what it is used to check

origin: migrated from legacy ledger ("Deferred from: code review of 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/test/tripDayPlanDialog.test.tsx:33-176`
reason: Three specifics. (a) `MUI_ONLY_PROPS` now includes `open`/`onClose` and `Dialog: Simple`, so the mocked dialog renders its whole body regardless of `open` — an `open` regression in `DialogShell` is structurally uncatchable in the file that pins the most contracts, and `DialogShell`'s real output (`role="dialog"`, `aria-labelledby`, focus trap) is exercised nowhere except three shallow cases in `formPrimitives.test.tsx`. (b) The `TextField` mock wraps its `<input>` in `<label><span>{label}</span>…</label>`, which real MUI never does — and since `FormField` no longer passes `label` to `TextField` at all, every field is now nested in an anonymous empty `<label>` with no production counterpart. (c) The mock hardcodes `value={value ?? ""}` with `onChange`, forcing every field controlled, so a `register()`-driven `FormField` (the pattern in `TripAccommodationDialog` and `TripCreateForm`) would render permanently empty under it. Survivable only because this one file happens to use `useState` throughout — a trap for the next dialog converted onto these primitives. Story 7.7 extended the mock rather than introducing it; the real fix is deleting it and rendering against real MUI with `renderWithProviders`, as the other three contract files now do.
status: open

### DW-54: The accommodation dialog's sub-line is composed by template literal with a hardcoded separator

origin: migrated from legacy ledger ("Deferred from: code review of 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:707`
reason: The sub-line is built as `` `${dayLabel} · ${date}` ``, but Task 7 says "interpolate with `formatMessage`, never template-literal concatenation", and the `·` and the ordering are hardcoded for both languages. Deviation #9 discloses the inlined `Intl.DateTimeFormat` but not this. Folds naturally into the follow-up the notes already record: once 7.8 lands, the short-date formatter moves out of `TripTimeline.tsx` and the sub-line can take a real key at the same time.
status: open

### DW-55: `daySubtitle`'s `Intl.DateTimeFormat` has no invalid-date guard

origin: migrated from legacy ledger ("Deferred from: code review of 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:700-707`
reason: `format(new Date(day.date))` throws `RangeError: Invalid time value` on an empty or unparseable `day.date`, inside a `useMemo` with no error boundary above it, white-screening the day view rather than dropping the sub-line. `day.date` is typed `string` (`:37`) with no compile-time protection. Reachability is essentially nil given the API contract — recorded only because the sibling helper `toDateOnly` (`TripDayPlanDialog.tsx:168-173`) guards precisely this case for the same field, so the codebase already treats the input as untrusted in one place and not the other.
status: open

### DW-56: Both full-page maps render "No mapped places yet" underneath their own error banner when the load fails

origin: migrated from legacy ledger ("Deferred from: code review of 7-9-full-page-map-screens-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx:151-196`, `TripDayMapFullPage.tsx:392-427`
reason: The empty state is gated on `mapData.points.length === 0` alone. When the fetch throws or returns non-ok, `error` is set and `detail`/`dayDetail` stay `null`, so `points` is empty and the screen shows an `Alert severity="error"` immediately above a full-height box asserting the trip has no locations. The two messages contradict each other, and the empty state's advice ("Add locations to stays or plan items") sends the user to fix data that may be fine. Pre-existing — the branch predates the redesign and Story 7.9 was visual-only — but the empty state is now a full-viewport `minHeight: FULL_PAGE_MAP_HEIGHT` panel rather than a modest one, so the false claim is much louder. Fix is a `&& !error` on the empty-state condition in both files; the same shape exists in both preview panels, so do all four together.
status: open

### DW-57: The full-page day map identifies neither the day nor the trip

origin: migrated from legacy ledger ("Deferred from: code review of 7-9-full-page-map-screens-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripDayMapFullPage.tsx:395-403`
reason: After 7.9 the screen's only heading is the card label "Day map" / "Tageskarte". `/trips/{id}/days/{dayId}/map` is reachable by direct URL and by browser history, and nothing on it says which day or which trip is shown. The sibling trip map deliberately kept its trip-name subline for exactly this reason (7.9 Task 4), but the same reasoning was never applied to the day map, which has no AC covering it. Not a regression — the pre-redesign `h6` said "Day map" too — but the asymmetry between two screens redesigned in the same pass is now visible. Fix is a `trips.dayView.title`-based subline (`formatMessage(t("trips.dayView.title"), { index: dayDetail.day.dayIndex })`) in the panel-caption rhythm, matching the trip map's.
status: open

### DW-58: The `card` token bundle is now literally duplicated in six components

origin: migrated from legacy ledger ("Deferred from: code review of 7-9-full-page-map-screens-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripDayMapFullPage.tsx:107-113`, `TripOverviewMapFullPage.tsx:66-72`, `TripDayMapPanel.tsx:52-59`, `TripOverviewMapPanel.tsx:30-37`, `TripDayView.tsx:1114-1120`, `TripTimeline.tsx`
reason: `backgroundColor: tokens.card` / `1px solid tokens.borderStrong` / `8px` / `18px`, copied verbatim each time, and the comments in the two newest copies say "identical to …" outright. Story 7.9 was told to copy it verbatim (the reference-not-refactor rule that kept 7.2/7.3's shipped panels untouched), so this is task-sanctioned accumulation rather than a mistake. It is now the most-duplicated token bundle in the app and a change to the `card` treatment has six edit sites. Fix is a single exported `cardSx(tokens)` helper (or a `MuiCard`-style theme slot); the natural home was the token-reconciliation work in Story 7.11.
status: open

### DW-59: `FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)"` under-measures the real chrome, and both full-page map screens scroll

origin: migrated from legacy ledger ("Deferred from: code review of 7-9-full-page-map-screens-redesign (2026-08-01)"; empirically confirmed by the retroactive operator verification of 7-9 and 7-11 on 2026-08-01), 2026-08-01
location: `travelplan/src/components/features/trips/TripDayMapFullPage.tsx:73`, `TripOverviewMapFullPage.tsx:57`
reason: Static measurement of the day-map stack at `md` puts the real chrome near 291px (72px `Toolbar` + 1px `AppBar` border + 96px `Container` `py:6` + 44px back button + 24px `gap={3}` + 2px card border + 36px card padding + about 16px `labelCaps` title + 16px inner `gap={2}`), and the trip map adds a further ~23px for its trip-name subline plus `gap={0.75}` — so the two screens need different offsets while sharing one constant. Empirically confirmed afterwards: `calc(100vh - 220px)` leaves `document.scrollHeight - clientHeight` at 208px on the trip map and 153px on the day map, identical at 1440×1080 and 1280×620, so it is fixed chrome rather than a viewport-dependent effect, and both estimates above are in the right direction and roughly the right size. Pre-existing (`220px` predates the redesign) and 7.9 recovered about 28px by shrinking the card padding and the title. Story 7.9's Task 3 routed the decision to a browser measurement and its Task 8 flagged exactly this ("adjust the constant only if the page actually scrolls"), but the story was advanced to `done` by `bmad-loop confirm` before that pass ran, and the verification happened afterwards against a throwaway copy of `dev.db` on an isolated port in a separate worktree. The fix is a per-file constant change plus a re-measure; it was not folded into 7.9 because that story is committed and confirmed.
status: open

### DW-60: Nothing enforces key parity between the two i18n dictionaries

origin: migrated from legacy ledger ("Deferred from: code review of 7-9-full-page-map-screens-redesign (2026-08-01)"), 2026-08-01
location: `travelplan/test/i18nDictionaries.test.ts`, `travelplan/src/i18n/index.ts:4,20`
reason: The only dictionary test asserts `typeof en === "object"`; `Dictionary` is `Record<string, string>` so a key present in `en.ts` and missing from `de.ts` is not a type error; and `translate()` falls back to `dictionary[key] ?? key`, so the miss ships as the raw key string (`trips.dayView.mapBack`) rendered as visible German UI. Story 7.9 added one key and removed one from both files correctly, but by hand and unguarded — as has every i18n-touching story in Epic 7. Fix is a three-line test asserting `Object.keys(en).sort()` equals `Object.keys(de).sort()`, which would also have caught the orphaned-key cleanups that 7.2's review found left behind.
status: open

### DW-61: `inkMuted` clears the 4.5:1 target on `card` only, and the app's smallest text does not sit on `card`

origin: migrated from legacy ledger ("Deferred from: code review of 7-11-design-token-reconciliation (2026-08-01)"), 2026-08-01
location: `travelplan/src/theme.ts` `colors.inkMuted`; consumers `travelplan/src/components/forms/PhotoUploadField.tsx:174`, `TripDayView.tsx:1866`
reason: Story 7.11 AC4 specified the target against `tokens.card` `#FFFFFF` and `#7A7667` meets it at 4.55:1, but the same token measures 4.33:1 on `cardAlt` `#FBF9F4`, 4.14:1 on `paper` `#F7F4EC` and 3.80:1 on `paperOuter` `#EFEAE0`. The two live consumers on non-`card` surfaces are the 11px photo-upload-zone hint and the 10px coverage-axis tick labels — the smallest text in the app. Clearing `paper` too needs roughly `#736F62`, a visibly darker token, which is a design call rather than a measurement, so it was correctly out of AC4's scope. Recorded because the story statement's goal is that the contrast baseline is "actually met", and for these two sites it is not. Natural home: whichever pass decides whether tertiary text is allowed on `paper` at all, or gives those two sites `inkSoft`. Supersedes the pre-7.11 measurement in DW-28.
status: open

### DW-62: `globals.css`'s `:root` token block has almost no consumers, and nothing enforces parity with `theme.ts`

origin: migrated from legacy ledger ("Deferred from: code review of 7-11-design-token-reconciliation (2026-08-01)"), 2026-08-01
location: `travelplan/src/app/globals.css:1-30`, `travelplan/src/theme.ts` `colors`
reason: `grep -rn "var(--color" src` finds exactly three live reads in the whole app (`--color-ink` twice, `--color-paper` once) plus the `page.module.css` back-compat aliases; nothing reads `--color-ink-muted`, `--color-warn-bg`, `--color-warn-bg-row` or `--color-pill-neutral`. Story 7.11's Task 1 asserted that missing one of the two files means "either TypeScript fails or a CSS consumer silently reads an undefined variable", but for the CSS half the opposite is true — with no consumer, a missed or wrong CSS var produces no symptom, ever, so the darkened `--color-ink-muted` has zero runtime effect and only `theme.ts` matters. Trap 7 ("change one, change both") is enforced by no test, no lint rule and no build step. Same unguarded-parity class as the i18n-dictionary entry DW-60. Fix is either a test asserting the two palettes agree key-for-key, or deleting the unread half of the `:root` block so there is one source of truth rather than two that only look like they agree.
status: open

### DW-63: A past trip with no hero photo loses most of its archival cue

origin: migrated from legacy ledger ("Deferred from: code review of 7-11-design-token-reconciliation (2026-08-01)"), 2026-08-01
location: `travelplan/src/components/features/trips/TripsDashboard.tsx:446-535`
reason: Story 7.11 AC5 correctly moved the `0.78` off the row onto the trip photo and the row border, because a row-level opacity dropped the sub-line and status pill below the contrast target (DW-20). When `heroImageUrl` is null the photo is a near-white `rgba(0,0,0,0.04)` placeholder, so fading it is invisible and the only remaining visual cue is the border composited at 0.78 — a subtle step from `#D9D0BE`. The "abgeschlossen" pill still carries the state as text, which is what `DESIGN.md`'s "colour is never the sole signal" rule requires, so nothing is broken; but a photoless past row now reads much closer to an active one than a photographed one does. AC5 prescribed photo-and-border and was followed exactly — the photoless case is an edge the spec did not consider. Fix needs a UX call: either a second carrier for that case (`filter: grayscale(1)` is a no-op on a grey placeholder, so more likely a step to `tokens.border` on the row edge, or a `cardAlt` row fill), or an explicit decision that the pill alone suffices.
status: open

### DW-64: Story 7-9's frontmatter says `done` while its body still reads as unverified

origin: migrated from legacy ledger ("Deferred from: code review of 7-11-design-token-reconciliation (2026-08-01)"), 2026-08-01
location: `_bmad-output/implementation-artifacts/7-9-full-page-map-screens-redesign.md`
reason: The frontmatter is `status: done` and `sprint-status.yaml` agrees, but the body's `Status:` line still reads `awaiting-operator`, all six of Task 8's checkboxes are still `[ ]`, and the Change Log has no verification-dated entry — its last line still ends "Status: awaiting-operator." Those three edits were exactly what the story's final `operator_actions` entry required, and the appended Operator Confirmation block both asserts the external actions were carried out and re-lists that entry verbatim, so the file simultaneously claims the bookkeeping was done and shows that it was not. Not caused by Story 7.11; found while reading the epic's recent history. Fix is the three edits the operator action already specified, plus a look at whether the same drift exists on 7-8, which has the same shape — see DW-66 for the structural cause.
status: done 2026-08-01
resolution: already resolved: Reconciled by hand on 2026-08-01: `7-9-full-page-map-screens-redesign.md` now has `status: done` in frontmatter (`:4`) and `Status: done` in the body (`:20`), all six Task 8 checkboxes are `[x]` (`:86-95`), and a verification-dated Change Log entry records the retroactive browser pass. (The `## Auto Run Result` block still reads `awaiting-operator` - that third copy is DW-66's subject, not this entry's three edits.)

### DW-65: `MuiIconButton` gets no focus ring, so the header menu button has no visible keyboard focus

origin: migrated from legacy ledger ("Deferred from: retroactive operator verification of 7-9 and 7-11 (2026-08-01)"), 2026-08-01
location: `travelplan/src/theme.ts` — the `MuiButton` block
reason: Story 7.11 AC6 added `&.Mui-focusVisible` to `MuiButton`, which fixed every `variant="contained"` button as specified (confirmed: `outline: 2px solid #2B2A26` at 2px offset on both auth submits and the trips-list "Add trip"). `MuiIconButton` is a separate component and inherits nothing from that rule: tabbing to the header's `aria-label="Open menu"` button yields `outline: none` / `box-shadow: none` with `:focus-visible` matching. Strictly outside AC6, which named contained buttons only — but `EXPERIENCE.md:104` makes visible focus an unconditional baseline, so the gap survives 7.11. Fix is an `MuiIconButton` `&.Mui-focusVisible` treatment alongside the `MuiButton` one. Note that plain links correctly fall back to the UA ring and need nothing. Verified empirically 2026-08-01 against a throwaway copy of `dev.db` on an isolated port in a separate worktree.
status: open

### DW-66: `bmad-loop confirm` sets the frontmatter status but not the body's `Status:` line, so every confirmed story drifts

origin: migrated from legacy ledger ("Deferred from: retroactive operator verification of 7-9 and 7-11 (2026-08-01)"), 2026-08-01
location: `_bmad-output/implementation-artifacts/*.md`
reason: The spec template carries the status twice — once in YAML frontmatter and once as a `Status:` line in the body, plus a third time in `## Auto Run Result`. `confirm` writes only the frontmatter and appends its Operator Confirmation block, then leaves the body untouched, which is why each story's final `operator_actions` entry has to ask the human to "set status: done in BOTH the frontmatter and the body's 'Status:' line" by hand. 7-9 drifted exactly there (DW-64) and 7-11 drifted the same way minutes later despite its own action 10 explicitly warning against repeating it, so this is a structural property of the tool rather than operator error and it will recur on every future park. Fix is either teaching the confirm path to rewrite the body line, or removing the duplicate status from the template so the frontmatter is the only source. Recorded 2026-08-01 after reconciling both stories by hand.
status: open
