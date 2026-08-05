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
decision: 2026-08-01 Validate at the import boundary only — Reject or strip any `heroImageUrl` (and any day/plan-item image URL the importer accepts) that is not a relative path under `/uploads/`, in `src/app/api/trips/import/route.ts`. That closes the one path by which a non-server-issued URL can enter the database, keeps every render site unchanged, and needs no CSP decision. Add a test asserting an absolute `http(s)://` hero URL in an imported backup is refused.
decision: 2026-08-01 Validate at the import boundary only — Reject or strip any `heroImageUrl` (and any day/plan-item image URL the importer accepts) that is not a relative path under `/uploads/`, in `src/app/api/trips/import/route.ts`. That closes the one path by which a non-server-issued URL can enter the database, keeps every render site unchanged, and needs no CSP decision. Add a test asserting an absolute `http(s)://` hero URL in an imported backup is refused.

### DW-9: `parsePrintablePlanText` in `tripRepo.ts` duplicates the `parsePlanText` client utility

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `tripRepo.ts:344`
reason: The duplication exists because of the server/client boundary split; consolidating the two copies requires establishing a shared pure-function package boundary that does not exist yet.
status: open

### DW-10: `day.date.toISOString()` throws on a corrupted DB Date value

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `tripRepo.ts:974`
reason: Data integrity is enforced at write time, and a defensive guard at this read site would mask a deeper DB problem rather than fix it — so the guard was deliberately not added.
status: done 2026-08-01
decision: 2026-08-01 Close - fail-fast is the intended behaviour — Deliberate design decision, re-affirmed: `day.date` integrity is enforced at write time and a read-site guard would mask a corrupted database rather than fix it. Failing loudly is correct.
resolution: closed by human decision: Deliberate design decision, re-affirmed: `day.date` integrity is enforced at write time and a read-site guard would mask a corrupted database rather than fix it. Failing loudly is correct.
decision: 2026-08-01 Close - fail-fast is the intended behaviour — Deliberate design decision, re-affirmed: `day.date` integrity is enforced at write time and a read-site guard would mask a corrupted database rather than fix it. Failing loudly is correct.

### DW-11: Unauthenticated user sees the print page loading state before the 401 redirect

origin: migrated from legacy ledger ("Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)"), 2026-08-01
location: `print/page.tsx`
reason: Consistent with every other client-rendered page in this app; moving to a server-side auth redirect is a broader architectural change than one print route.
status: done 2026-08-01
decision: 2026-08-01 Close - matches the app-wide client-rendering convention — Not a print-route defect: every client-rendered page in this app shows its loading state before an unauthenticated fetch redirects. Moving to server-side auth redirects is an architecture change to file as its own story if wanted, not a fix to this route.
resolution: closed by human decision: Not a print-route defect: every client-rendered page in this app shows its loading state before an unauthenticated fetch redirects. Moving to server-side auth redirects is an architecture change to file as its own story if wanted, not a fix to this route.
decision: 2026-08-01 Close - matches the app-wide client-rendering convention — Not a print-route defect: every client-rendered page in this app shows its loading state before an unauthenticated fetch redirects. Moving to server-side auth redirects is an architecture change to file as its own story if wanted, not a fix to this route.

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
decision: 2026-08-01 Standardise the caption across all map surfaces — Add the text caption `EXPERIENCE.md` mandates to every map preview surface, not just this one: a station-count-plus-action summary beneath the map in `TripOverviewMapPanel` and `TripDayMapPanel`, with a shared i18n key in both dictionaries. Feed the count from the same data the map already receives so it cannot drift from the stat strip. While there, give the populated map wrapper the mockup's `1px solid` token border on the `paper` fill, matching what the empty state already does, so populated and empty previews read as the same card.
decision: 2026-08-01 Standardise the caption across all map surfaces — Add the text caption `EXPERIENCE.md` mandates to every map preview surface, not just this one: a station-count-plus-action summary beneath the map in `TripOverviewMapPanel` and `TripDayMapPanel`, with a shared i18n key in both dictionaries. Feed the count from the same data the map already receives so it cannot drift from the stat strip. While there, give the populated map wrapper the mockup's `1px solid` token border on the `paper` fill, matching what the empty state already does, so populated and empty previews read as the same card.

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
decision: 2026-08-01 Drop it from both responses — Remove `currentUserId` from the `GET` and `PATCH` payloads in `src/app/api/trips/[id]/route.ts` (`:46`, `:171`) and update the key-set assertion at `test/tripDetailRoute.test.ts:244` plus the test fixtures that carry it. Confirm with a grep across `src/` first that no client reads it - it is dead weight shipped to every client on every trip read. The client bundle and the route deploy together in Next.js, and `GET /api/trips/:id` sets no cache headers, so there is no stale-consumer window to sequence around.
decision: 2026-08-01 Drop it from both responses — Remove `currentUserId` from the `GET` and `PATCH` payloads in `src/app/api/trips/[id]/route.ts` (`:46`, `:171`) and update the key-set assertion at `test/tripDetailRoute.test.ts:244` plus the test fixtures that carry it. Confirm with a grep across `src/` first that no client reads it - it is dead weight shipped to every client on every trip read. The client bundle and the route deploy together in Next.js, and `GET /api/trips/:id` sets no cache headers, so there is no stale-consumer window to sequence around.

### DW-26: `cachedClientMatchesCurrentSchema` is structurally blind to removal-only schema changes

origin: migrated from legacy ledger ("Deferred from: code review of 5-9-remove-comments-and-voting-feature (2026-08-01)"), 2026-08-01
location: `src/lib/db/prisma.ts:40-47`
reason: All three surviving predicates are field-exists assertions (`CostPayment.sortOrder`, `User.mustChangePassword`, `TripMember.role`), every one of which a client generated from the pre-removal schema still satisfies — so the function returns `true` for precisely the staleness Story 5.9 creates, and only the `PRISMA_SCHEMA_TAG` string comparison forces the teardown. The edit is exactly what Task 1 mandated and works today, but the guard no longer does what its name claims: the next removal-only schema change that forgets to bump the tag silently reuses a stale client with no second line of defence. A field-absence predicate, or deriving the tag from a schema hash, would restore defence-in-depth.
status: open

### DW-27: `formatCost` now diverges across screens

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripCostOverview.tsx:245-251`
reason: Day Detail switched to the currency-aware formatter (`style: "currency", currency: "EUR"`) that 7.2 landed in `TripTimeline.tsx`, but `TripCostOverview.tsx` is a third copy still emitting a bare number wrapped in the `trips.stay.costSummary` "Cost: {value}" template. The same amount therefore reads "€160.00" on Day Detail and "Cost: 160.00" on the cost overview, and `test/tripCostOverview.test.tsx:137` pins the old form. All three copies also hardcode EUR with no trip-level currency field feeding them. Task-sanctioned (the story scoped the switch to this screen), but the debt is now three-way. Natural home: one shared `formatCost` helper plus a trip currency field, or the 7.4-7.7 screen that owns the cost route.
status: done 2026-08-03
resolution: resolved by story 7-13-cost-overview-redesign — the divergence half only: the cost overview now imports the shared `src/lib/trips/formatCost.ts` and the `trips.stay.costSummary` wrapper is gone, so all three screens render the same form. The EUR-hardcoding half named in this entry's reason is NOT closed here and continues as DW-151.

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
decision: 2026-08-01 Exclude untimed segments from the stat as well — Make the "Total travel time" stat sum only the segments the coverage bar actually draws, by having `TripDayView.tsx:1055-1062` read the built segment list rather than the raw `travelSegments` array. The two surfaces then agree and neither over-claims, at the cost of under-reporting travel on days with no `toTime` set. If the number can differ from the raw total, say so in the stat's label or hint rather than silently reporting a smaller figure.
decision: 2026-08-01 Exclude untimed segments from the stat as well — Make the "Total travel time" stat sum only the segments the coverage bar actually draws, by having `TripDayView.tsx:1055-1062` read the built segment list rather than the raw `travelSegments` array. The two surfaces then agree and neither over-claims, at the cost of under-reporting travel on days with no `toTime` set. If the number can differ from the raw total, say so in the stat's label or hint rather than silently reporting a smaller figure.

### DW-30: `MiniImageStrip` thumbnails are mouse-only

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripDayPlanItemContent.tsx:170-197`
reason: The images carry `onClick` and `cursor: pointer` but no `role`, `tabIndex` or key handler, so the lightbox cannot be opened from the keyboard; the "+N" overflow indicator is plain caption text and the 4th and later photos are unreachable by any input. Pre-existing and untouched by 7.3's `variant` addition — but that story promoted the strip to the timeline's primary photo affordance on Day Detail, so the blast radius grew. Fix belongs with a photo-viewer story covering this plus the two map-dialog call sites and `TripDayMapFullPage`; see DW-51, which is the same defect in the newer shared `PhotoUploadField` primitive.
status: done 2026-08-02
resolution: resolved by story 6-12-fullscreen-photo-viewer

### DW-31: The day-detail route has no `h1`-`h4`

origin: migrated from legacy ledger ("Deferred from: code review of 7-3-day-detail-redesign (2026-07-31)"), 2026-08-01
location: `TripDayView.tsx:1722`
reason: The day title is the page's top heading at `h5`, chosen because about 14 existing assertions pin `level: 5`. `<h1>` exists only in `HomeHero.tsx` and `TripDayPrintDocument.tsx`, so this is an app-wide convention rather than a Day Detail defect, and fixing it means re-levelling every screen and its assertions at once.
status: open
decision: 2026-08-01 Re-level Day Detail to h1 and update its assertions — Promote the day title to `component="h1"` on both branches (`TripDayView.tsx:1798` and the loading/not-found heading at `:1653`), keeping the visual `variant` unchanged so nothing moves on screen, and re-level the section labels beneath it (`h6` at `:1827`, `:2026`, `:2338`) so the outline descends without skipping. Update the ~14 `level: 5` assertions in `test/tripDayViewLayout.test.tsx` to match. Note that custom typography variants carry no `variantMapping`, so `component=` is mandatory or the element renders a `<span>`.
decision: 2026-08-01 Re-level Day Detail to h1 and update its assertions — Promote the day title to `component="h1"` on both branches (`TripDayView.tsx:1798` and the loading/not-found heading at `:1653`), keeping the visual `variant` unchanged so nothing moves on screen, and re-level the section labels beneath it (`h6` at `:1827`, `:2026`, `:2338`) so the outline descends without skipping. Update the ~14 `level: 5` assertions in `test/tripDayViewLayout.test.tsx` to match. Note that custom typography variants carry no `variantMapping`, so `component=` is mandatory or the element renders a `<span>`.

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
decision: 2026-08-01 Delete the three keys and their wiring — Remove the unreachable success path from the three redirecting pages: drop the `setSuccess(true)` calls, stop threading `success` through `login`, `register` and `first-login-password`, and delete `auth.login.success`, `auth.register.success` and `auth.firstLogin.success` from both dictionaries. Leave `AuthScreenShell`'s `success` prop and the notice itself in place - `forgot-password` and `reset-password` use them for real. Deleting orphaned keys from both dictionaries is the convention 7.3 set and 7.8 followed.
decision: 2026-08-01 Delete the three keys and their wiring — Remove the unreachable success path from the three redirecting pages: drop the `setSuccess(true)` calls, stop threading `success` through `login`, `register` and `first-login-password`, and delete `auth.login.success`, `auth.register.success` and `auth.firstLogin.success` from both dictionaries. Leave `AuthScreenShell`'s `success` prop and the notice itself in place - `forgot-password` and `reset-password` use them for real. Deleting orphaned keys from both dictionaries is the convention 7.3 set and 7.8 followed.

### DW-44: The day-detail page overflows horizontally by 25px at a 390px viewport

origin: migrated from legacy ledger ("Deferred from: 7-7-trip-create-and-add-entry-dialog-redesign (2026-08-01)"; re-raised by the code review of the same story), 2026-08-01
location: `travelplan/src/components/features/trips/TripDayView.tsx` — the Gantt coverage block, around `:1780-1800`
reason: Found by Story 7.7's browser check, outside its scope boundary. A visually-hidden `<span>` carrying `trips.dayView.coverageAxisDescription` ("The coverage bar spans the full day, from 00:00 to 24:00.") is positioned but never clipped, so its full text box extends to x=415 on a 390px viewport and `document.scrollWidth - clientWidth` measures 25. It is the sole overflowing element, it is present with no dialog open, and `/trips` and `/trips/t1` both measure 0 — so this is the day page's own defect, not the redesigned dialogs' (all four measured `scrollWidth === clientWidth` at 390px). Story 7.3 owns this page and is `done`; Story 7.7 owns exactly one block of the file (the day-details dialog), so it was measured and recorded rather than fixed. Fix is the standard screen-reader-only clip (`position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0)`) — the same treatment `AuthScreenShell.tsx:87` already uses for its language-name spans, which suggests extracting one `visuallyHidden` constant rather than a third hand-rolled copy. Natural home: whichever story next touches Day Detail, or the standing accessibility pass.
decision: 2026-08-01 Resolved by Story 6.9 — reproduced, re-diagnosed and fixed. Measured 25px at 390px and 169px at 1440px on `4978db8`, re-measured 0px in both after the fix. The prescribed clip was **already present and already working**: the span really is clipped, and that is why nobody ever saw the text. The actual cause was a unit — `sx={{ width: 1, height: 1 }}` reads as 1px but MUI maps a bare 0..1 `width`/`height` to a *percentage*, so it compiled to `width: 100%; height: 100%`, and `clip` hides an element without shrinking its layout box, leaving the span to set `scrollWidth` on its own. So this entry's "positioned but never clipped" was wrong about the mechanism and right about the culprit. Fixed via one shared `VISUALLY_HIDDEN` constant with explicit `px` strings, applied to **both** occurrences of the recipe in `TripDayView.tsx` — the twin on the travel-segment edit button was latent only because an `IconButton` is `position: relative` and 28px wide. The entry's own suggestion to extract a single constant rather than hand-roll a third copy was the right instinct; note `AuthScreenShell.tsx:87` still carries its own copy and was left alone as out of scope.
status: done 2026-08-01

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
status: done 2026-08-02
resolution: already resolved: Story 2.32 AC6 (UI half) re-landed the entry point. `TripsDashboard.tsx` now renders an outlined "Import backup" button beside "Add trip" in the header and mounts `<TripImportDialog>` at the end of the tree, so the component has a production call site again. The surface chosen is the **trips list, not the trip overview** — an import creates or replaces a whole trip, and 7.8's removal from the overview stands. The dialog itself changed with the reconnect: the `tripId` prop is gone (the overwrite target now comes only from the server-returned conflict set, never from an ambient trip), submission is `multipart/form-data` because the v2 package is a ZIP, and success holds the dialog open on a photo / travel-segment / bucket-list count summary. Pinned by `test/tripsDashboard.test.tsx` ("import entry point") and `test/tripImportDialog.test.tsx`. Note the export half has **not** re-landed — see DW-76, which this entry is paired with.

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
status: done 2026-08-02
resolution: resolved by story 6-12-fullscreen-photo-viewer

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
seen-again: 2026-08-03 (story 7-13-cost-overview-redesign) — a seventh verbatim copy, `TripCostOverview.tsx`'s `cardSx`, added under the same reference-not-refactor rule; that file also adds a `nestedGroupSx` sibling bundle (`cardAlt` / `border` / 6px / 16px) whose own copies live in `TripsDashboard.tsx`, `TripShareDialog.tsx` and `DialogShell.tsx`, so the extraction now has two bundles to own, not one.

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
status: done 2026-08-01
decision: 2026-08-01 Close - placeholder fade plus the pill is enough — The photoless case is covered: the world-map placeholder is real image content that receives the 0.78 fade, the row border composites at the same value, and the status pill carries the state as text per DESIGN.md's "colour is never the sole signal" rule.
resolution: closed by human decision: The photoless case is covered: the world-map placeholder is real image content that receives the 0.78 fade, the row border composites at the same value, and the status pill carries the state as text per DESIGN.md's "colour is never the sole signal" rule.
decision: 2026-08-01 Close - placeholder fade plus the pill is enough — The photoless case is covered: the world-map placeholder is real image content that receives the 0.78 fade, the row border composites at the same value, and the status pill carries the state as text per DESIGN.md's "colour is never the sole signal" rule.

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
decision: 2026-08-01 Make the frontmatter the only source in the local template — Remove the body `Status:` line from `.claude/skills/bmad-create-story/template.md` and from the corresponding emission in `SKILL.md`, so newly created stories carry the status only in YAML frontmatter and there is nothing for `confirm` to leave behind. Check which other local skills read the body line before removing it - `bmad-dev-story`, `bmad-dev-auto` and `bmad-loop-*` are the likely readers - and point any that do at the frontmatter instead. Leave existing story files alone: this stops new drift rather than rewriting history, and the `## Auto Run Result` copy is a run record, not a status field.
decision: 2026-08-01 Make the frontmatter the only source in the local template — Remove the body `Status:` line from `.claude/skills/bmad-create-story/template.md` and from the corresponding emission in `SKILL.md`, so newly created stories carry the status only in YAML frontmatter and there is nothing for `confirm` to leave behind. Check which other local skills read the body line before removing it - `bmad-dev-story`, `bmad-dev-auto` and `bmad-loop-*` are the likely readers - and point any that do at the frontmatter instead. Leave existing story files alone: this stops new drift rather than rewriting history, and the `## Auto Run Result` copy is a run record, not a status field.

### DW-67: The bucket-list empty message renders alongside the load-error alert when the fetch fails

origin: code review of 7-12-bucket-list-sidebar-card, 2026-08-01
location: `travelplan/src/components/features/trips/TripBucketListPanel.tsx:394` (`emptyState`), `:415-425` (`loadItems` error paths)
reason: `emptyState` is `!loading && items.length === 0`, and both failure paths in `loadItems` call `setItems([])` alongside `setLoadError(...)`. So a failed `GET /api/trips/{id}/bucket-list-items` renders the error alert *and* "Noch keine Ideen gesammelt." / "No bucket list items yet." together, telling the user their bucket list is empty when the truth is that it could not be read — the one reading under which they might stop looking for data that exists. Pre-existing: the `emptyState` computation predates Story 7.12, which only relocated the panel and capped its height. Surfaced now because 7.12 made the empty-state treatment a confirmed spec decision (`EXPERIENCE.md:81`), so the branch is worth getting right. Fix is a one-line gate: `!loading && !loadError && items.length === 0`. `TripDayBucketListPanel.tsx` should be checked for the same shape.
status: open

### DW-68: `trips.bucketList.countLine` has no singular form, so a one-item list reads "1 entries" / "1 Einträge"

origin: code review of 7-12-bucket-list-sidebar-card, 2026-08-01
location: `travelplan/src/i18n/en.ts:378`, `travelplan/src/i18n/de.ts:375`; consumer `TripBucketListPanel.tsx:412`
reason: Both dictionaries define the key as a bare `"{count} entries"` / `"{count} Einträge"` and `formatMessage` does no pluralization, so `items.length === 1` renders ungrammatically in both languages. Pre-existing since Story 4.4 introduced the collapsed count line. The app already has the precedent for handling this: the trips-list gap pill singularizes "N Tage offen" to "1 Tag offen" for N=1 (`EXPERIENCE.md:81`, Trip status variants). Visible on the collapsed card, which is the default state, so it is the first thing a user with one collected idea sees. Worth pairing with a sweep for other unpluralized `{count}` keys rather than fixing this one key alone.
status: open

### DW-69: `tripTimelineRoles.test.tsx` unstubs `fetch` at the end of each test body instead of in an `afterEach`, so a failing assertion leaks the stub

origin: code review of 7-12-bucket-list-sidebar-card, 2026-08-01
location: `travelplan/test/tripTimelineRoles.test.tsx` — no `afterEach`; per-test `vi.unstubAllGlobals()` calls as the last statement of most test bodies, and absent entirely from two (`:250`, `:279`)
reason: The file stubs `fetch` per test and tears it down as the final statement of the body. Any assertion that throws before that line leaves the stub installed, so the *next* test in the file runs against the previous test's canned response and fails for reasons unrelated to its own subject — the classic cascading-failure pattern that makes a single real regression look like five. Two tests omit the call entirely, so the leak already exists on the happy path there. Pre-existing; Story 7.12's new case copied the surrounding convention rather than introducing it. Fix is a file-level `afterEach(() => vi.unstubAllGlobals())` and deleting the per-test calls — mechanical, but it touches every test in the file, which is why it was not folded into 7.12. `tripBucketListPanel.test.tsx` already does it the right way and is the model.
status: open

### DW-70: Day Detail's bucket-list card is still unbounded, so Tommy's "optisch übermächtig" concern is only half addressed

origin: code review of 7-12-bucket-list-sidebar-card, 2026-08-01
location: `travelplan/src/components/features/trips/TripDayBucketListPanel.tsx:62` (a plain `Box component="ul"` with no `maxHeight`/`overflow`)
reason: Story 7.12 capped the *Trip Overview* bucket list at 5.5 rows because an unbounded card next to the day list reads as visually overwhelming at twenty collected ideas. Day Detail's sidebar carries a bucket-list card too, but it is a different component with no cap, no scroll region and no collapse, so the same twenty items grow it without limit there. Correctly outside 7.12's scope, which named the trip overview only — recorded because the decision behind the cap is a general one about the card, not about one screen, and because `EXPERIENCE.md:81` now has to explicitly say Day Detail is not capped in order to stay truthful. Fix is applying the same breakpoint-scoped `maxHeight`/`overflowY` pair; the derivation constants in `TripBucketListPanel.tsx` would need to move somewhere shared, and the day panel's rows have the same 12.5px/11px + 44px-hit-area shape, so the metric transfers. Note the day panel has no collapse toggle, so whether it should also start collapsed is a UX call, not a mechanical port.
status: open

### DW-71: The bucket-list scroll container is a tab stop at every width, including where nothing scrolls

origin: retroactive operator verification of story 7-12, 2026-08-01
location: `travelplan/src/components/features/trips/TripBucketListPanel.tsx` — the `List` carrying `tabIndex={0}`
severity: low
reason: Story 7.12 AC3 required the capped scroll container to be keyboard-operable, so the `List` carries `tabIndex={0}`. Verified working at desktop width — ArrowDown moves scrollTop 0 to 40, PageDown to 305 (bottom), and Tab leaves cleanly into the row edit/delete buttons rather than cycling. But the attribute is unconditional while the cap is not: measured at 820px the list reads `maxHeight: none`, `overflowY: visible` and is not scrollable, yet it still takes focus. So below `md` every keyboard user passes through a stop that does nothing. Fix is to make `tabIndex` track the same breakpoint the cap does, which needs the breakpoint in JS rather than only in `sx` — or to accept it. The story's own operator action 6 asked for this judgement and it was never made; recorded here so it is not lost. Related: the same `List` carries `aria-label="Bucket-Liste"`, duplicating the card heading a screen reader already announces (operator action 10, also unjudged — needs a real screen reader, not an automated check).
status: open

### DW-72: `AuthScreenShell`'s visually-hidden language names carry the same `width: 1` percentage bug DW-44 turned out to be

origin: Story 6.9's DW-44 fix, 2026-08-01
location: `travelplan/src/components/features/auth/AuthScreenShell.tsx` — the language-switcher's screen-reader span, `sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}`
severity: low
reason: DW-44 looked like a missing clip and was actually a unit: in MUI's `sx`, a bare `width`/`height` between 0 and 1 is a *percentage*, so `width: 1, height: 1` compiles to `width: 100%; height: 100%`. `clip` still hides the text, so nothing is visible — but `clip` does not shrink the layout box, and on Day Detail that span alone gave the page 25px of horizontal overflow at 390px. Story 6.9 fixed both occurrences in `TripDayView.tsx` behind one `VISUALLY_HIDDEN` constant. This third copy has the identical defect and was left alone as out of scope: it is a different screen owned by a different story (7.6), and it may well measure 0 overflow today because its container is narrow and the auth screens are simple. **Not verified either way** — nobody has measured `scrollWidth - clientWidth` on `/auth/login` at 390px. Fix is to promote `VISUALLY_HIDDEN` out of `TripDayView.tsx` into a shared module and use it here, which also removes the third hand-rolled copy DW-44 already complained about. Measure before and after, since the point of the entry is a number.
status: open

## Deferred from: code review of 6-9-day-detail-refinements (2026-08-01)

### DW-73: The coverage block has no heading and no outline entry after AC9 removed its label

origin: code review of Story 6.9, 2026-08-01
location: `travelplan/src/components/features/trips/TripDayView.tsx` — the Gantt coverage block, around `:1896`
severity: low
reason: Story 6.9 AC9 required `trips.dayView.coverageTitle` to stop rendering, and it does — the code is compliant, this is not a defect in the change. The side effect is that the `Typography variant="labelCaps" component="h6"` it rendered was the coverage band's only entry in the document outline, so heading-based screen-reader navigation now steps from the day title straight past the coverage bar. The band is not nameless (`TripDayGanttBar` carries `ganttAriaLabel`, and the visually-hidden axis description survives), so nothing is unreachable — only unnavigable by heading. This belongs with **DW-31** (the day-detail route has no `h1`-`h4` at all), which Story 6.9 explicitly excluded and whose approach Tommy already decided on 2026-08-01: promote the day title to `h1` and re-level the sections beneath it. Fold this in there rather than fixing it alone.
status: open

### DW-74: `canEditPlanning` defaults to `true` when the day-detail response omits `accessRole`

origin: code review of Story 6.9, 2026-08-01
location: `travelplan/src/components/features/trips/TripDayView.tsx:339` — `const canEditPlanning = detail?.trip.accessRole ? detail.trip.accessRole !== "viewer" : true;`
severity: low
reason: Pre-existing, and `isOwner` on the line above uses the identical fail-open pattern. Recorded now because Story 6.9 widened its blast radius: the flag used to gate a 28px pencil and now gates the whole activity card's `role="button"`, tab stop, pointer cursor and click-to-edit. If the endpoint ever omits `accessRole`, or returns a role string added later that is neither `owner`, `contributor` nor `viewer`, a genuine read-only user gets a fully editable-looking card. No test covers the undefined-role branch — the viewer test stubs an explicit `"viewer"`. Fix is to fail closed, or to narrow the type so an unknown role is a compile error rather than a silent grant. Check whether the same pattern exists on the other trip surfaces before changing one in isolation.
status: open

### DW-75: Activity cost and accommodation cost are styled two different ways on the same timeline

origin: code review of Story 6.9, 2026-08-01
location: `travelplan/src/components/features/trips/TripDayView.tsx` — `costPillSx` at `:1193` vs `tlCostSx` at `:2385`
severity: low
reason: Story 6.9 AC1 turned the activity card's cost into a filled accent pill in the card head. The accommodation card immediately below it on the same timeline keeps the old plain-bold `tlCostSx`. Newly created by this change rather than pre-existing, but out of scope by design: AC1 is written about the activity card specifically, the two cards have different head structures, and Tommy settled the filled-pill decision on 2026-08-01 for activities only. Worth a deliberate judgement rather than a drive-by: either the accommodation cost becomes a pill too, or the divergence is confirmed as intentional (the accommodation cost is a nightly rate, not a slot cost, so a different treatment may be right). Note the code Story 6.9 deleted carried the opposite rationale — "the mockup puts tl-cost on every card that has one". Related: DW-27, `formatCost` diverges across screens.
status: open

## Deferred from: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list (2026-08-02)

### DW-76: The v2 trip backup export has no user-facing entry point

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, 2026-08-02
location: `travelplan/src/app/api/trips/[id]/export/route.ts` — reachable only by requesting the URL directly
severity: low
reason: Story 7.8 removed the "Export JSON" button from the trip overview (its AC3), and PRD FR33/FR34 record the consequence: "No user-facing entry point exists until one is decided." Story 2.31 deliberately did not pre-empt that decision — its AC8 forbids adding a button, an i18n key or a component test, so the complete v2 ZIP backup (manifest + photo bytes + travel segments + bucket list) now exists behind a URL nobody can reach from the UI. This is the contract *behind* the parked decision, not a half-finished feature. Recorded so the next reader does not treat the missing button as an oversight, and so whoever re-lands the surface knows what is already there to wire up. **Same surface as DW-47** (`TripImportDialog.tsx` has zero production call sites for exactly the same reason): the export trigger and the import dialog will re-land together or not at all — deciding one without the other leaves the pair asymmetric. Note that Story 2.32's AC6 *does* require a reachable "Import trip backup" control, which will make the asymmetry visible the moment 2.32 ships; if that reads wrong, it is a product call for Tommy, not something to fix by quietly adding an export button. **Update 2026-08-02 — the pair is now asymmetric in fact, not in prospect.** Story 2.32's UI half shipped the import control (`TripsDashboard.tsx`, "Import backup", beside "Add trip") and DW-47 is closed; this entry stays open because no export control was added. The "re-land together or not at all" pairing was overruled by an AC, not by a decision: 2.32 AC6 mandated the import half and 2.31 AC8 forbade the export half, so the two stories could not have landed it together even in principle. Standing consequence: a user can restore a backup from the UI but cannot create one there — the only way to produce the `.zip` an import consumes is to request `/api/trips/{id}/export` directly. The remaining work is one button on the trip overview (or on the trips list beside the import control, which is now the nearer precedent) plus its i18n keys; the route, the format and the whole v2 payload already exist. Still a product call for Tommy.
status: done 2026-08-03
resolution: The surface question this entry left open ("still a product call for Tommy" — overview card vs. trips list beside Import) was answered by Story 2.33's own AC1, authored in `epics.md`, not by the implementer: the control belongs in the trip-controls card. Story 2.33 landed that entry point on the **trip overview's controls card, owner-only** — a third `variant="outlined"` button beside "Edit trip" and "Delete trip", gated on `isOwner` to match the route's `hasTripOwnerAccess` 404 (the mismatch that made Story 7.8 remove the old one), with new keys `trips.export.open` / `trips.export.error` in `en.ts` and `de.ts`. It fetches the route and saves the blob under the server's `content-disposition` filename rather than being a plain anchor, so the route's JSON error envelopes surface as an alert in the card instead of being saved to disk as a file. The route, format and payload are consumed exactly as 2.31 shipped them. The asymmetry with the import control is closed, though the two surfaces differ deliberately: import creates or replaces a whole trip and stays on the trips list, export is about the trip you are looking at.

### DW-77: Story 2.32's `## Package Format Contract v2` still describes the base64-in-JSON container that 2.31 did not ship

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, 2026-08-02
location: `_bmad-output/implementation-artifacts/2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list.md` — `## Package Format Contract v2`, and its Open Item #1
severity: medium
reason: 2.32 is already `ready-for-dev` and was authored against a single `.json` file with photo bytes embedded as base64 in `photos[id].data`; its Open Item #1 asserts that a real `.zip` "needs a new dependency." That premise is wrong — `node:zlib` ships `crc32` and a STORE-only archive needs no compressor — and Tommy settled the container as a hand-rolled ZIP on 2026-08-01, after that spec was written. Story 2.31 shipped the ZIP. 2.32's spec was deliberately **not** edited from inside 2.31 (amending another story's spec from within one is how two specs end up disagreeing about who changed what), so the delta is recorded here and 2.32's dev session must read it before it starts. Everything else in 2.32 survives unchanged: the pool indirection, `heroPhotoId` / `imagePhotoId` / `images[].photoId`, `bucketListItems` under `trip`, per-day `travelSegments`, the cross-reference validation and the whole id-remapping design. The four deltas:

- `photos[id]` is `{ contentType, archivePath }`, not `{ contentType, data }`.
- The uploaded package is a `.zip`; the manifest is the member `trip.json`; photo bytes are the members named by `archivePath`.
- Its base64 decode-and-round-trip validation is replaced by ZIP member extraction plus CRC verification; its 5 MB per-photo cap and `contentType` allow-list still apply, to the extracted bytes.
- Its Open Item #1 is closed: the format is a ZIP and no dependency was added.

status: open

### DW-78: A v2 manifest POSTed to the v1 import API is silently accepted and stripped

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/lib/validation/tripImportSchemas.ts` — `tripImportPayloadSchema`, the `formatVersion` field
severity: medium
reason: `tripImportPayloadSchema` validates `formatVersion` only as `z.number().int().positive()`, and its objects are non-strict, so zod's default strip silently discards every field v2 added. A user who extracts `trip.json` from a v2 archive and POSTs it to `/api/trips/import` gets a `200` and a restored trip that has lost all travel segments, all bucket-list items, all gallery photos and every pool reference — reported as success. Not caused by this story's code (the v1 importer was already permissive), but this story is what makes a v2 manifest exist, so the hazard is newly reachable. Deliberately not fixed here: Story 2.31's Dev Notes forbid touching the import side or relaxing `tripImportSchemas.ts` in anticipation, and Story 2.32 owns the v2 importer. 2.32 should either gate on `formatVersion` explicitly or reject an unknown version rather than degrading, and note that today's failure mode is silent data loss rather than an error. See also DW-77 (the container delta 2.32 must read first) and DW-76 (neither export nor import is reachable from the UI today, which is why this is not yet user-visible).
status: open

### DW-79: Deleting an accommodation leaves orphan travel segments with dangling endpoint ids

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/lib/repositories/accommodationRepo.ts:413` — `deleteAccommodationForTripDay`
severity: medium
reason: `TravelSegment.fromItemId` / `toItemId` are plain `String` columns with no foreign key — only `tripDayId` cascades (`prisma/schema.prisma`, `model TravelSegment`). `deleteDayPlanItemForTripDay` compensates by calling `tx.travelSegment.deleteMany(...)` (`dayPlanItemRepo.ts:532`, `:578`), but `deleteAccommodationForTripDay` deletes the accommodation row without any equivalent cleanup, so a segment whose endpoint was that accommodation survives pointing at an id that no longer exists. Pre-existing and not caused by this story — but Story 2.31 is the first code to *export* those endpoint ids, so a backup taken after such a delete carries a dangling `fromItemId`/`toItemId` that Story 2.32's id-remapping cannot resolve. Two candidate fixes, and the choice is a real one: clean up on delete in `accommodationRepo` (fixes the data, matches what `dayPlanItemRepo` already does), or have the export filter segments whose endpoints are absent from the same day's exported records and warn. The first is the root-cause fix; the second alone would leave the orphan rows in the database. Note the `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])` constraint, which 2.32 will hit if a remap ever collapses two distinct old ids onto one new one.
status: open

## Deferred from: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list — follow-up review (2026-08-02)

### DW-80: The exporter can pool a photo whose `contentType` Story 2.32's importer is specified to reject

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, follow-up code review, 2026-08-02
location: `travelplan/src/lib/repositories/tripRepo.ts` — `toExportPhotoExtension`, `EXPORT_PHOTO_FALLBACK_CONTENT_TYPE`
severity: medium
reason: An `imageUrl` whose extension is outside `jpg|jpeg|png|webp` is still archived, with `archivePath` `photos/pN.bin` and `contentType` `application/octet-stream`, and **no `meta.warnings` line** — `tripRepo.test.ts` "falls back to a binary content type for an extension outside the upload allow-list" pins exactly that, asserting `warnings: []`. Story 2.32's `photoSchema` pins `contentType` to `z.enum(["image/jpeg", "image/png", "image/webp"])` with an explicit "do not widen it", so such a package fails import wholesale — and the export gave no hint at the time it was produced. The `bin` fallback is what Story 2.31's Task 2 mandates, so this is not a deviation and was not patched here; the decision belongs to the importer's story. Only reachable today via a legacy or hand-written DB row (the upload routes accept the three types only), which is why this is low-frequency rather than low-consequence. Three candidate resolutions for 2.32's dev session: widen the allow-list to accept and pass through `application/octet-stream`, have the exporter warn when it uses the fallback, or have the exporter drop the row like any other unarchivable image. Note DW-77 records four 2.31→2.32 deltas and this is not among them.
status: open

### DW-81: Nothing enforces the Node floor that `zlib.crc32` needs

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, follow-up code review, 2026-08-02
location: `travelplan/package.json` — no `engines` field; `.github/workflows/*` pin `node-version: 20` (floating minor)
severity: low
reason: `zipArchive.ts` depends on `zlib.crc32`, added in Node 20.15.0 / 22.2.0. Story 2.31 verified it against Node 20.19.2, but that is an observation, not a constraint: `package.json` declares no `engines` at all and CI pins only the major. A self-hosted deployment on Node 20.0–20.14 gets `crc32 is not a function` on every export request, which the route's bare `catch` turns into an unexplained `500` with nothing logged. Pre-existing in the sense that the project has never declared an engine floor — this story is the first code that makes one load-bearing. Fix is one line (`"engines": { "node": ">=20.15" }`), but it is a project-wide toolchain policy rather than a story-scoped change, and note npm does not enforce `engines` without `engine-strict`. Worth pairing with Story 8.1's Node 24 bump, which will want to revisit the floor anyway.
status: open

### DW-82: A photo file that disappears between the assembly-time stat and the stream-time read truncates an archive already sent as 200

origin: 2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list, follow-up code review, 2026-08-02
location: `travelplan/src/lib/trips/zipArchive.ts` — the `fs.readFile` inside `pull`; `tripRepo.ts` — `registerPhoto`'s `fs.stat`
severity: low
reason: The design deliberately stats every pooled photo during payload assembly so AC4's pool/member set equality holds before the first byte goes out, and the code comment says so. But the bytes are read much later, inside the stream's `pull`. If the file is deleted, replaced or made unreadable in between — a concurrent image delete, an operator pruning uploads — `fs.readFile` rejects, the stream errors after the `200` and the `Content-Disposition` are on the wire, and there is no way to retract them. Chunked transfer means a well-behaved client sees a network error rather than silently saving a corrupt file, which is why this is low rather than medium, but a client that saves what it got keeps a ZIP with no end-of-central-directory record. No test covers the path and `pull` has no `try`/`catch` that could skip the member instead. Not patched here: the honest fixes are structural (hold an open file descriptor from assembly through to the read, or capture `stats.size` — already in hand at the stat and currently discarded — and fail deterministically when it changes), and neither is a drive-by. The same window is what makes a post-check symlink swap theoretically exploitable, though that already requires write access to the upload directory.
status: open

## Deferred from: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list (backend half, 2026-08-02)

### DW-83: One `application/octet-stream` photo makes a whole v2 backup unrestorable

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, dev session, 2026-08-02
location: `travelplan/src/lib/validation/tripImportSchemas.ts` — `photoSchema`; `travelplan/src/lib/trips/importPackage.ts` — `PHOTO_SIGNATURES`
severity: low
reason: Story 2.32 Task 1 mandates a `contentType` allow-list of exactly `image/jpeg` / `image/png` / `image/webp`, matching `ALLOWED_TYPES` in the three upload routes, with an explicit "do not widen it". The export's `application/octet-stream` / `photos/pN.bin` fallback (`tripRepo.ts`, `toExportPhotoExtension`) is therefore **rejected**, and because the check is a whole-payload Zod failure the entire backup fails to import rather than degrading — one anomalous image row makes the file unrestorable, with no way for the user to skip it. This is the AC3-faithful reading (a photo whose type cannot be validated is not written to disk unvalidated) and it is what shipped, but it is a real sharp edge and it is the resolution of DW-80's open three-way choice. Only reachable via a legacy or hand-written `imageUrl` row — the upload routes accept the three types only — so it should never fire in practice. The alternative, if it ever does: skip the offending photo and surface it as a warning alongside `meta.warnings`, which needs a warning channel on the import response that does not exist today. Open Question 5 in the story flags the same trade-off as a product call.
status: done 2026-08-02
resolution: The premise was wrong on both ends and the fix removed it. `contentType` is no longer an allow-list enum — `tripImportSchemas.ts`'s `photoSchema` takes any non-empty string, because the declared type was never evidence of anything: `trips/[id]/hero-image/route.ts:86` picks the stored extension from the client-supplied `file.type` **without sniffing**, so a PNG uploaded as `image/jpeg` is stored `hero.jpg`, exported as `image/jpeg`, and was then rejected on import — the enum was making the app's own backups unrestorable, not just hand-written ones. It could also fire on this importer's own output, since a v1 `imageUrl` is written verbatim and `/uploads/.../day.jfif` round-trips back out as octet-stream. The bytes are now the sole authority: `sniffPhotoContentType` (`importPackage.ts`) allow-lists JPEG/PNG/WebP signatures, `validatePackagePhotos` fails a member matching **none** of them (still a `validation_error`, which is AC3's real intent — reject data that is not a decodable image), and `tripRepo.ts` rewrites each pool entry's `contentType` from the sniff before `importPhotos.ts` derives the on-disk extension, so a mislabelled member lands as `hero.png` rather than as a `.jpg` that is not one. No warning channel was needed after all. Pinned by `test/tripImportPackage.test.ts` (declared-vs-sniffed, octet-stream accepted, no-signature rejected), `test/tripImportSchemas.test.ts` and `test/tripRepo.test.ts` ("names a restored file for what its bytes are"). Open Question 5 in the story is rewritten to record that the question is moot.

### DW-84: `meta.formatVersion` is still validated only as "a positive integer"

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, dev session, 2026-08-02
location: `travelplan/src/lib/validation/tripImportSchemas.ts` — `tripImportPayloadSchema`, `meta.formatVersion`
severity: low
reason: DW-78 asked Story 2.32 to "either gate on `formatVersion` explicitly or reject an unknown version rather than degrading". The backend half resolved the *consequence* DW-78 was actually about — a v2 manifest sent to the JSON body path is no longer silently stripped: `photos`, `travelSegments`, `bucketListItems`, `images`, `heroPhotoId` and `imagePhotoId` are all in the schema now, so they survive, and a manifest that declares a photo pool with no accompanying bytes is rejected with a `validation_error` 400 instead of quietly losing every image. What is *not* done is the version gate itself: `formatVersion: 99` still parses, and a future v3 field would be stripped by zod's default strip exactly as v2's were. Not tightened here because a hard gate would make the importer reject its own forward-compatible input for no benefit while there is no v3, and the story's task list does not ask for one. Whoever adds v3 must add the gate at the same time.
status: done 2026-08-02
resolution: Gated in the 2.32 review pass. `meta.formatVersion` is now `.max(MAX_SUPPORTED_FORMAT_VERSION)` (`= 2`, declared in `travelplan/src/lib/trips/importLimits.ts`) and answers "Backup was written by a newer version of this app". The reasoning for deferring turned out to be backwards: the concern was that a gate would reject "forward-compatible input", but zod's default strip means a v3 manifest does not degrade gracefully — it imports, reports **success**, and silently discards every field v3 added. Silent partial restore is the one failure mode a backup tool must not have, and it is strictly worse than a clear refusal the user can act on. Whoever adds v3 now raises one constant rather than remembering to add a guard. Pinned by `test/tripImportSchemas.test.ts` → "manifest ceilings" ("accepts the newest format version it knows" / "refuses a format version newer than it can read").

### DW-85: Overwriting a trip with a **v1** backup deletes the upload directory that backup's own URLs point at

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, dev session, 2026-08-02
location: `travelplan/src/lib/repositories/tripRepo.ts` — the post-commit stash/discard around `importTripFromExportForUser`'s overwrite mode; `travelplan/src/lib/trips/importPhotos.ts` — `stashTripUploadDir`
severity: medium
reason: AC5 requires an overwrite to replace "previously uploaded files on disk" with no orphans left, and Task 3 spells out the mechanism: rename `getTripUploadDir(targetTripId)` aside before writing, delete it on success. That is what shipped, and it is unconditional. A **v1** backup carries no photo pool — only verbatim `heroImageUrl` / `imageUrl` strings — so overwriting a trip with its own pre-2.31 export deletes the very files those strings name, leaving rows pointing at 404s. Before this story the overwrite path never touched the disk, so this is a behaviour change for that one combination. Not special-cased because every alternative trades one AC against the other: skipping the cleanup when the payload has no pooled photos satisfies the v1 case but lets a photo-free v2 backup leave orphans behind, and detecting "this v1 URL names the target trip's own directory" is a heuristic on a free-text column. A v2 backup, which is what the export produces today, restores its photos correctly and is covered by `tripBackupRoundTrip.test.ts`. Candidate fix if it bites: keep any file whose path is still referenced verbatim by a restored row, and delete only the rest.
status: done 2026-08-02
resolution: Superseded rather than deferred, and neither AC had to give. The filesystem replacement stays unconditional — AC5's "no orphaned files" is untouched — but the *rows* no longer keep a string naming a file the same operation just deleted, which is the other half of AC5 ("no orphaned rows"). `tripRepo.ts`'s `dropReplacedUploadUrl` stores `null` in place of a v1 `heroImageUrl` / `imageUrl` when, and only when, three things hold at once: the mode is **overwrite**, the reference has no pooled replacement, and the URL points into the *target trip's own* upload directory (`/uploads/trips/<targetId>/`). That last condition is what the original entry dismissed as "a heuristic on a free-text column", and it is not one — the prefix is the exact directory being deleted, so containment is decidable rather than guessed. Create-new is deliberately untouched: it deletes nothing, the URL names some other trip's directory, and AC2 plus the seven original v1 tests require it back verbatim. A null renders as "no image" instead of as a broken one. Pinned by `test/tripRepo.test.ts` ("clears v1 image urls that name files the overwrite just deleted" and its create-new counterpart, "keeps a v1 url pointing at another trip's directory").

## Deferred from: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list (review pass, 2026-08-02)

### DW-86: Two concurrent overwrite imports of the same trip can destroy each other's photo files

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/lib/trips/importPhotos.ts` — `stashTripUploadDir` / `restoreStashedTripUploadDir`; `travelplan/src/lib/repositories/tripRepo.ts` — the post-commit disk phase
severity: medium
reason: Nothing serializes imports against a trip id. Import A renames `<tripDir>` to its stash; import B's rename then hits `ENOENT`, which `stashTripUploadDir` swallows by design (a photo-free trip has no directory), so B proceeds believing there was nothing to stash. Both then write into `<tripDir>`, and the hero and day filenames are deterministic (`hero.<ext>`, `day.<ext>`) rather than randomized, so they collide. If B fails, its cleanup unlinks paths that may now be A's files and its `restoreStashedTripUploadDir(null)` is a no-op; if both succeed, A's `discardStashedTripUploadDir` deletes the original directory while the surviving rows are B's, leaving a mix of both imports on disk. Not patched here: the fix is a real per-trip lock (an exclusive `mkdir` sentinel, or a DB advisory row) with its own stale-lock and crash-recovery semantics, which is a design decision rather than a drive-by. Requires the same owner to run two overwrites of one trip at once, so it is unlikely but not synthetic — a double-clicked submit on a slow upload is enough.
status: open

### DW-87: The overwrite stash lives inside the publicly-served uploads root and can outlive the request

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/lib/trips/importPhotos.ts` — `stashTripUploadDir`, `discardStashedTripUploadDir`
severity: medium
reason: The stash is `${tripDir}.import-<timestamp>-<random>`, a sibling of the trip's own upload directory and therefore under `public/uploads/trips/`, which Next serves statically with no auth check. `discardStashedTripUploadDir` is deliberately called with `.catch(() => undefined)` — correctly, since the import has already succeeded and a failed cleanup must not be reported as a 500 — and an existing test pins that behaviour. The consequence is that a cleanup failure (held handle, AV scanner, EBUSY) leaves a complete copy of every photo the overwrite replaced permanently readable at a guessable path and referenced by no row. The code comment calls this "untidy, not harmful", which understates it. Fix is to stash outside the public root, but the naive version risks `EXDEV` if the uploads root is its own mount, so it needs a deliberate choice of location plus a sweeper for whatever is left behind.
status: open

### DW-88: A create-new import restores a v1 image URL verbatim, cross-linking another trip's — possibly another user's — upload directory

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/lib/repositories/tripRepo.ts` — `dropReplacedUploadUrl`, called with `replacedUploadPrefix: null` on the create-new path
severity: medium
reason: AC2 requires a v1 backup to restore "exactly as before", and the seven original v1 tests pin the verbatim string, so create-new deliberately keeps `heroImageUrl` / `imageUrl` as written (DW-85's resolution narrowed the nulling to overwrite only, on purpose). The case that was not considered: user X imports a backup exported by user Y whose photo the *export* had to skip, so `heroPhotoId` is null but the v1 URL survives. X's trip then stores `/uploads/trips/<Y-trip-id>/hero.jpg` and renders Y's image — no bytes were copied and no access check applies, because the file is served statically. It breaks silently the moment Y deletes or overwrite-imports that trip. Not patched here because the honest fix is a product call between three options that AC2 does not choose between: refuse the cross-trip URL, null it, or copy the bytes if the file happens to be present. Reachable only through a shared export whose photos were already incomplete.
status: open

### DW-89: The precise diagnostics the package reader produces never reach the user

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/app/api/trips/import/route.ts` — the `parseImportPackage` failure branch and the Zod failure branch; `travelplan/src/components/features/trips/TripImportDialog.tsx` — `resolveApiError` / `readIssues`
severity: low
reason: `zipReader.ts` and `importPackage.ts` produce genuinely useful, member-level messages ("Archive entry failed its CRC-32 check: photos/p3.jpg", "Archive is missing its trip.json manifest"), and the route returns each as `apiError(code, message)` — with no `details`. The dialog renders `resolveApiError(code)` plus `readIssues(details)` and never `error.message`, so all of them collapse into "This backup could not be read. It may be incomplete or damaged." The `details` path works only for `validatePackagePhotos`, which is the one failure that populates `issues`. Zod payload failures are worse: their `details` is `error.flatten()`, whose `{ formErrors, fieldErrors }` shape yields an empty `issues` array, so the multi-issue list the dialog builds never renders for them either. The reader's diagnostics are the main thing that makes a damaged package diagnosable, and today they exist only in the server response body. Fix is to route both through the same `{ issues: string[] }` channel `validatePackagePhotos` already uses — cheap, but it needs a deliberate decision about how much server-side detail to expose to a client, which is why it is not a drive-by.
status: open

### DW-90: An archive re-zipped from an extracted folder is rejected, though the code reads as though it is supported

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/lib/trips/importPackage.ts` — `isArchiveBookkeeping` and the manifest lookup (`member.name === "trip.json"`)
severity: low
reason: `isArchiveBookkeeping` and `zipReader.ts`'s zero-length-DEFLATE tolerance exist to accept a backup a user unzipped and re-zipped with a desktop tool, and the comments say so. But the manifest is found by exact name and every member outside `photos/` is a hard rejection, so the ordinary way of doing that — right-click → Compress on the *extracted folder* — produces `trip-italy/trip.json` and `trip-italy/photos/p1.jpg` and is rejected with "Archive is missing its trip.json manifest". Only selecting the folder's *contents* works. The rejection is safe, so this is a usability and comment-accuracy gap rather than a defect: either strip a single common top-level directory prefix before matching, or correct the comments to say which re-zip shapes are actually supported.
status: open

### DW-91: A conflicting import re-uploads the entire package to answer the conflict prompt

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/components/features/trips/TripImportDialog.tsx` — `submitImport`
severity: low
reason: The first submit sends the file with no strategy; the route answers 409 with the same-name conflicts; the user picks overwrite or create-new and `submitImport(strategy)` builds a fresh `FormData` around the same `File`. A 100 MB backup whose trip name already exists therefore costs 200 MB of upload and two full ZIP parse + CRC verification passes before a single row is written, and on a slow connection the user waits through the whole upload twice. Inherent to the stateless two-request conflict protocol Story 2.10 established, which was cheap when the body was JSON and is not now that it can be 100 MB. Fixes all have real cost: a pre-flight name check before uploading (racy, but cheap and probably right), or a server-side staged upload the second request refers to by token (needs storage and expiry).
status: open

### DW-92: A failed overwrite leaves the trips list showing the trip as it was before the import that already replaced it

origin: 2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list, code review, 2026-08-02
location: `travelplan/src/components/features/trips/TripImportDialog.tsx` — the error branch of `submitImport`; `travelplan/src/lib/repositories/tripRepo.ts` — the post-commit disk phase in overwrite mode
severity: low
reason: Overwrite commits its rows and only then writes photos, and on a write failure it deliberately does **not** delete the trip (destroying the trip the user was replacing would be strictly worse — see the story's Completion Notes, decision 2). So a `photo_write_failed` 500 means the database *has* been replaced while the response says the import failed. The dialog calls `onImported()` only on success, so the list behind it is never refetched and keeps showing the pre-import trip until the user reloads. The row state is correct and recoverable by re-running the import; only the client's view of it is stale. Fix is to refetch on the overwrite-error path too, which is a few lines, but "the request failed, therefore refresh the list" is confusing enough to be worth pairing with copy that explains the trip was replaced but its photos were not written.
status: open

### DW-93: Next's 10MB body cap makes the 100MB import limit unreachable — every photo-bearing import fails

origin: retroactive operator verification of story 2-32, 2026-08-02
location: `travelplan/next.config.ts` (empty), `travelplan/src/lib/trips/importLimits.ts:14`, `travelplan/src/middleware.ts:66`
severity: critical
reason: `MAX_IMPORT_PACKAGE_BYTES` is 100 MB, but `middleware.ts:66`'s matcher includes `/api/trips/:path*`, so Next buffers the import request for the middleware and caps that buffer at **10 MB** by default. A 13.4 MB export (one trip, four photos) is truncated mid-body; `request.formData()` then throws and the route answers `400 invalid_form_data` — "this backup could not be read, it may be incomplete or damaged" — for a backup that is perfectly intact. Next logs the real cause server-side ("Request body exceeded 10MB for /api/trips/import"), which no user sees. `importLimits.ts:14` states the wrong premise: "The App Router has no bodyParser.sizeLimit equivalent, so nothing caps a request body unless the handler does." That is false for Next 16 whenever the route is in the middleware matcher. **Verified empirically 2026-08-02**: the same import returns 400 with the stock config and 200 with `experimental: { proxyClientMaxBodySize: "110mb" }` in `next.config.ts` (note the key moved — `middlewareClientMaxBodySize`, which Next's own error message still names, is deprecated in this version). Raising nginx's `client_max_body_size` is necessary but not sufficient; the app's own cap sits behind it. This blocks story 2-32's core purpose.
status: open

### DW-94: A skipped photo's URL is carried into the imported trip, pointing back at the source trip's directory

origin: retroactive operator verification of story 2-32, 2026-08-02
location: `travelplan/src/lib/trips/importPhotos.ts`
severity: low
reason: When the export skips an image whose file is missing on disk (it warns, correctly), the import still writes the *original* `image_url` onto the new trip's row. Measured after a `createNew` import: the copy carried `/uploads/trips/<SOURCE-ID>/days/<SOURCE-DAY>/day.png` alongside its own correctly-rewritten `/uploads/trips/<NEW-ID>/…` paths. Nothing renders either way — the file never existed — so no pixel is lost. But the row is a dangling cross-trip reference, and after the source trip is deleted it points into a removed directory. Nulling the URL when the photo is skipped would be the honest write. Everything else verified clean: byte-identical copies under the new trip's own ids, the source's upload dir removed on delete, the copy surviving that delete, a v1 (`formatVersion: 1`) backup importing with no error, and overwrite replacing rather than duplicating (41 days not 82, 2 bucket items not 4, zero orphan rows).
status: done 2026-08-02
resolution: fixed in `travelplan/next.config.ts` with `experimental.proxyClientMaxBodySize = \"110mb\"`; proven by a 16.0 MB round-trip returning HTTP 200 with 5 photos written and no truncation warning, where the stock config returned 400 invalid_form_data

### DW-95: 143 pre-existing `tsc --noEmit` errors and no typecheck gate

origin: incidental to story 6-10 review, 2026-08-02
location: `travelplan/package.json` (scripts), `travelplan/test/**`
severity: low
reason: `npx tsc --noEmit` reports **143 errors**, identical on the 6-10 branch and on its baseline `e990d3f` — none introduced by this story, and none in application source. They are concentrated in test files, overwhelmingly one shape: hand-rolled `fetch` stubs typed as `{ ok, status, json }` object literals assigned where `Promise<Response>` is expected ("missing the following properties from type 'Response': headers, redirected, statusText, type, and 9 more"). `package.json` has no `typecheck` script — `lint` is the only static gate — so nothing in CI or the dev loop ever surfaces these, and the count is free to grow. The consequence today is nil at runtime (Vitest transpiles without typechecking, and `next build` only checks the app graph), but it means TypeScript cannot be trusted as a signal in the test suite: a genuine type error in a new test is indistinguishable from the 143 already there. Fix is a shared typed `mockFetchResponse` helper in `test/helpers/` plus a `typecheck` script wired into the same gate as `lint`.
status: open

### DW-96: DESIGN.md's "hero shows one navigation or action button only" rule is now contradicted by the day hero it governs

origin: incidental to story 6-11 review, 2026-08-02
location: `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — the `hero-photo (with scrim)` component entry
severity: low
reason: The design spine states the hero shows "**title, date/breadcrumb, and one navigation or action button only** — never stats". Story 6.9 already put two controls there (back-to-trip plus the owner-gated day-image action); story 6.11 adds a `⋯` overflow and two chevrons, taking the day hero to five. The controls themselves are not the problem — Tommy decided the chevron placement on 2026-08-01 and Epic 6's context records "The hero carries navigation" as the settled pattern — but DESIGN.md was never updated to match, so the approved spine now describes something the flagship screen contradicts, and the next screen built from it will inherit a rule nobody follows. Either restate the rule (e.g. one *labelled* action in each header slot, with photo-edge navigation exempt) or record the exception against the day hero. Not fixed in 6-11: DESIGN.md is an approved design artifact and amending it is a design-authority call, not a side effect of a layout story.
status: open

### DW-97: The global header menu's trigger announces no popup, on the same defect just fixed on the day hero

origin: incidental to story 6-11 review, 2026-08-02
location: `travelplan/src/components/HeaderMenu.tsx` — the hamburger `IconButton`
severity: low
reason: The trigger carries `aria-label` but no `aria-haspopup`, `aria-expanded` or `aria-controls`, so a screen-reader user hears "Open menu, button" with no indication it opens a menu or whether it is currently open. Story 6.11 introduced a second menu trigger on the day hero and gave it all three, which is what surfaced this — the two now diverge. Not fixed in 6.11 because that story's AC5 explicitly forbids modifying `HeaderMenu.tsx`; the same one-line fix applies there and should be taken with whatever next touches that component.
status: open

### DW-98: On-photo chrome is unreadable over bright photography — the scrim only protects the title

origin: operator verification of story 6-11, 2026-08-02
location: `travelplan/src/components/features/trips/TripIcons.tsx` (`HERO_SCRIM`, `ON_PHOTO_CHROME`), applied in `TripDayView.tsx` and `TripTimeline.tsx`
severity: medium
reason: `ON_PHOTO_CHROME` is a white glyph on `rgba(255,255,255,.18)` with a `rgba(255,255,255,.55)` border, and `HERO_SCRIM` is a four-stop gradient reaching 0.88 only at the **bottom** of the hero. Everything above the title therefore sits on the raw photograph. Measured against a near-white (`#FAFAF8`) day image, rendered pixels: header row (back button, day-image edit, the new overflow) composites to `rgb(220,220,217)` — **white on it is 1.37:1**; the chevrons' midpoint to `rgb(168,167,164)` — **2.41:1**; only the title's band reaches 5.66:1. A snow, sky or sand photo makes the entire control row invisible. Not introduced by 6.11: the back button and the day-image pencil predate it and score worse than its chevrons, and the same treatment carries the trip overview's share action. The fix is a design-system decision, not a story-level patch — either the scrim gains coverage at the top (which changes every hero's look), or on-photo controls take a dark translucent fill with a light glyph instead of the current light-on-light. Same class as DW-71 and the standing contrast pass: it is about what the tokens promise, not about who applied them.
status: open

### DW-99: `PhotoUploadField`'s remove button covers ~40% of the open button that Story 6.12 just made an advertised affordance

origin: incidental to story 6-12 review, 2026-08-02
location: `travelplan/src/components/forms/PhotoUploadField.tsx` — the thumbnail cell
severity: medium
reason: The remove control is a 44×44 transparent target at `top: -8px; right: -8px` over a 56×56 thumbnail, so it occupies x∈[20,56], y∈[0,36] — 1296 of the cell's 3136 px², the whole upper-right quadrant. Aiming at the top-right of a photo to enlarge it deletes it instead. The geometry predates this story (the thumbnail already carried a click-to-open handler), but Story 6.12 turned that handler into a real `<button>` with a focus ring and an accessible name, which is what promotes a latent mis-click into a control users are now told to use. Keyboard order is unaffected — the two are separate tab stops. The fix is a geometry decision, not a patch: either the remove disc moves fully outside the 56px cell, or the open target is inset to the area the remove button does not claim, and both change a layout `mockups/forms-authoring.html:346-395` pins. Same class as the standing 44px-target work.
status: open

### DW-100: In the two gallery dialogs the fullscreen viewer announces its position twice, once as the photo and once as the caption

origin: incidental to story 6-12 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` and `TripDayPlanDialog.tsx` (their `galleryPreviews` memos), against `travelplan/src/components/ui/FullscreenPhotoViewer.tsx`
severity: low
reason: Both dialogs build each preview's `alt` from `trips.gallery.imageAlt` ("Image 3 of 4"), and the viewer renders that same key as its position line. An assistive-tech user browsing the open viewer therefore hears "Image 3 of 4" from the graphic and "Image 3 of 4" again from the status text, with nothing distinguishing the photo from its caption. Reusing the key inside the viewer is right — it is the sentence that states the position, and composing a second one would be worse. The real defect is upstream: a positional string is a poor `alt` for a photograph in the first place, which is why `MiniImageStrip` synthesises `"<activity> <n>"` instead and reads correctly in the same viewer. Fixing it means deciding what a gallery photo's alt should say when the surface has no per-image caption to draw on — a content question that outlives this story.
status: open

### DW-101: The `+N` overflow control widens the timeline photo-strip row by ~26px to meet the 44px target floor

origin: incidental to story 6-12 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayPlanItemContent.tsx` — `MiniImageStrip`'s overflow indicator
severity: low
reason: Making the indicator operable (AC6, DW-30) turned an inline ~18px caption into a real `<button>` with `minWidth: 44` / `minHeight: 44`. The height was chosen to stay under the 56px thumbnails so the row's height is unchanged, and it is; the width is new. On a four-photo activity the strip row goes from roughly 204px to 230px, and the row is `display: flex` with no wrap, so on the narrowest timeline card the overflow indicator is what gets squeezed. Story 6.12's AC10 asks that the strip's layout not change, and this is the one place it does — unavoidably, since an 18px tap target is its own accessibility defect. jsdom lays nothing out, so whether it actually crowds at 390px is a browser observation, folded into that story's operator pass. If it does, the answer is a smaller minimum with a padded hit area rather than reverting to inert text.
status: open

### DW-102: `tripDayPlanDialog.test.tsx`'s `@mui/material` mock now also hides the shared photo viewer

origin: incidental to story 6-12 review, 2026-08-02
location: `travelplan/test/tripDayPlanDialog.test.tsx` — the `MUI_ONLY_PROPS` / `Dialog` mock
severity: low
reason: One more increment of [[DW-53]]. Story 6.12 taught the mocked `Dialog` to honour `open` — strictly more faithful than before, and the reason that file's suite still passes — but `slotProps` remains in `MUI_ONLY_PROPS`, so under this mock `FullscreenPhotoViewer` renders as a bare `<div>`: no `role="dialog"`, no `aria-label`, no dark paper, no click-to-close, no backdrop. Every structural claim the viewer's own suite makes is untestable in the file that pins the most day-plan-dialog contracts, and a future assertion about the viewer there would pass or fail for reasons unrelated to the real component. Not separately actionable: it closes when DW-53 does, by deleting the wholesale mock and rendering against real MUI through `renderWithProviders`. Recorded so the growth is visible rather than absorbed.
status: open

### DW-103: The stay name — the most copy-worthy string on a stay card — is no longer drag-selectable

source_spec: `_bmad-output/implementation-artifacts/6-13-stay-cards-editable.md`
origin: incidental to story 6-13 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — both stay cards' head rows (`tlCardTopSx` + `overlaidContentSx`)
severity: medium
summary: Making the stay cards click-to-edit put their head rows under `pointerEvents: "none"`, so dragging across a hotel name starts no selection and the mouse-up lands on the edit overlay instead.
evidence: `overlaidContentSx` sets `pointerEvents: "none"` on the content layer and re-enables only `a` and `button`. Story 6.9 measured this exact effect and judged it unacceptable for prose — the activity card's comment records that "the drag never reaches the text and the mouse-up lands on the overlay, so the reader gets an edit dialog instead of a selection" — and carved the notes block out with `pointerEvents: "auto"` for that reason. Stay cards got no equivalent carve-out, and their head row holds precisely the class of string that exception exists for: hotel names, and through them addresses and booking references. Not patched here because activity card *titles* have the same property, so exempting only the stay name would make the three card kinds diverge on text selection — the drift Task 1 exists to prevent. The fix is one decision applied to all three: either card titles become selectable everywhere, or they do not.
status: open

### DW-104: `i18nDictionaries.test.ts` does not enforce en/de parity, and dictionary keys are untyped

source_spec: `_bmad-output/implementation-artifacts/6-13-stay-cards-editable.md`
origin: incidental to story 6-13 review, 2026-08-02
location: `travelplan/test/i18nDictionaries.test.ts`, `travelplan/src/i18n/index.ts`
severity: medium
summary: Story 6.13's spec assumed `i18nDictionaries.test.ts` enforces en/de key parity; it does not, and `Dictionary = Record<string, string>` means a mistyped key type-checks and degrades to the key string as a user-visible accessible name.
evidence: The suite asserts only that both modules export objects. Parity for the four keys this story added was verified by hand (519/519 keys, no gaps) — which is exactly the manual step a test should be doing. `translate` is `dictionary[key] ?? key`, so renaming `trips.stay.editCurrentNightAria` in the dictionaries but not at the call site yields a stay card whose screen-reader name is the literal string `trips.stay.editCurrentNightAria`, with nothing failing. Two independent fixes, both cheap: a real parity assertion over `Object.keys`, and a `keyof typeof en` key type so call sites are checked at compile time. Pre-existing; surfaced because 6.13 is the first story to make a dictionary key the *only* signal distinguishing two controls (add vs edit on a card that looks identical either way).
status: open

### DW-105: The photo-strip's pointer-events wrapper spans the card's full width, so the band right of the last thumbnail swallows clicks

source_spec: `_bmad-output/implementation-artifacts/6-13-stay-cards-editable.md`
origin: incidental to story 6-13 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — the `<Box sx={{ pointerEvents: "auto" }}>` around each `MiniImageStrip` (activity card, both stay cards)
severity: low
summary: The wrapper that restores pointer events for the photo strip is block-level, so it claims the full card width; clicking the empty band to the right of the last thumbnail hits a dead zone instead of opening the editor.
evidence: The wrapper exists to stop a near-miss between two thumbnails falling through to the overlay, and for that it is correct. But a `Box` in a column flex container stretches to the card's width, and the strip itself is only as wide as its thumbnails, so on a card with one or two photos most of that row is wrapper and nothing else — an inert strip across the bottom of an otherwise fully clickable card. Introduced for stay cards by 6.13, pre-existing on activity cards since 6.9. `width: "fit-content"` on all three closes it, but it is a one-line change to a pattern 6.9 verified in a browser, and this repo has no way to re-verify it there; folded into the next browser pass rather than patched blind.
status: open

### DW-106: `useMediaQuery` now decides DOM structure, not just a `data-` attribute — DW-14 escalated

source_spec: `_bmad-output/implementation-artifacts/6-14-trip-controls-last-on-phone.md`
origin: incidental to story 6-14 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripTimeline.tsx:115`
severity: medium
summary: Three components carry the comment "pure sx breakpoints, never `useMediaQuery` (deferred finding from 7.2)", and DW-14 is open against this file's existing `isNarrowLayout` for exactly that reason; Story 6.14 adds a second instance and promotes the pattern from a cosmetic attribute to where an element mounts.
evidence: `DialogShell.tsx:113` and `TripCreateForm.tsx:434` state the convention; DW-14 states the failure mode ("change one breakpoint and the attribute reports 'inline' while the CSS renders stacked — and the test still passes"). With the new mount point that failure is no longer cosmetic: a mismatch puts the trip-controls card back between the day list and the sidebar at some widths, which is the defect 6.14 exists to remove. The story's Task 1 named a pure-`sx` alternative (direct grid child with `order` + `gridColumn`), and it does not hold: at `md`+ the card auto-places into grid row 2, so it sits below the *taller* column and opens a visible gap whenever the sidebar outruns the day list; every fix for that (`gridRow` spanning, `alignItems: start`) redistributes row height back into row 1 and re-opens the same gap, and none of it is checkable without a browser. So the mechanism is right for this story and the convention is still owed a real answer. The review closed the specific escape by asserting the grid's own `grid-template-columns` media condition (`tripTimelineRoles.test.tsx`, "declares the grid's own column split…"), which pins the CSS and JS halves to one number — but that is one declaration guarded by hand, not the convention. Natural home: the browser-level layout-assertion pass (Playwright) DW-14 already reserves.
status: open

### DW-107: Crossing `md` unmounts and remounts the trip-controls card, and jsdom cannot test the transition

source_spec: `_bmad-output/implementation-artifacts/6-14-trip-controls-last-on-phone.md`
origin: incidental to story 6-14 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripTimeline.tsx:752` and `:853`, `travelplan/test/tripTimelineRoles.test.tsx` (`setViewportWidth`)
severity: low
summary: The card's two mount points are different React positions, so resizing, rotating or split-screening across 900px destroys the card and rebuilds it — a keyboard user focused on "Edit trip" loses focus to `<body>` — and the test harness pins one width per case and can never fire a change event, so nothing automated covers the crossing.
evidence: `{isTwoColumnLayout ? tripControlsCard : null}` and `{isTwoColumnLayout ? null : tripControlsCard}` are separate slots in the tree; React unmounts one and mounts the other rather than moving the node, and focus does not survive that. Narrow trigger — the viewport has to change while one of the two buttons holds focus — which is why it is deferred rather than patched. The harness half is structural: `setViewportWidth` installs a `matchMedia` whose `addEventListener` is a bare `vi.fn()`, so an implementation that read `window.innerWidth` once at mount would pass all 16 cases identically. Both halves want the same thing DW-14 and DW-106 want: a browser-level layout pass.
operator_measurement (2026-08-02, Chromium, `dcfb859`): **Confirmed, in both directions.** With "Reise bearbeiten" focused at 1400px, resizing to 820px moves `document.activeElement` to `<body>`; resizing back to 1400px leaves it on `<body>`. The reviewer called the trigger narrow, and for a mouse user it is — but **tablet rotation crosses 900px** (1024x768 landscape to 768x1024 portrait), so it is reachable without anyone deliberately resizing a window. Consequence is bounded: focus is lost, nothing else, and one Tab recovers. Judged **non-blocking** for story 6.14 on that basis; the entry stays open because the fix (one mount point, or restoring focus after the swap) is still worth doing.
status: open

## Deferred from: 6-15-move-swap-into-overflow (review pass, 2026-08-02)

### DW-108: The import size-cap suite still asserts the old 100 MB ceiling and fails on `main`

source_spec: `_bmad-output/implementation-artifacts/6-15-move-swap-into-overflow.md`
origin: incidental to story 6-15 review, 2026-08-02
location: `travelplan/test/tripImportDialog.test.tsx` (four cases) and `travelplan/test/tripImportRoute.test.ts:560`
severity: medium
summary: `MAX_IMPORT_PACKAGE_BYTES` was raised from 100 MB to 300 MB, but five tests still spell out `101 * 1024 * 1024` and the string "Backup file is larger than 100 MB."; the fixture is now comfortably *under* the cap, so the route accepts it and fails downstream with `invalid_json`, and `npm test` has been red on `main` since.
evidence: Not a product defect — the cap enforces correctly at its new value; the assertions are stale. `importLimits.ts` documents the raise ("Raised from 100 MB on 2026-08-02 because it made real backups unrestorable"), and the failures read exactly as a fixture that no longer trips the guard: `expected 'invalid_json' to be 'file_too_large'`. Confirmed pre-existing at `dcfb859` — both files are unmodified by this story and fail identically with story 6-15's changes reverted. A fix was in the working tree at the start of this run (deriving `OVER_LIMIT_BYTES` and the message from `MAX_IMPORT_PACKAGE_BYTES` rather than hard-coding either) and was reverted before it landed; that derive-don't-duplicate shape is the right one, since the same duplication is what `importLimits.ts` exists to prevent. Left to the import story rather than patched here: a red suite on `main` masks real regressions, but it is a different feature and this story must not carry an unrelated fix into its commit.
status: open

## Deferred from: code review of 6-16-walking-and-cycling-travel-modes (2026-08-02)

### DW-109: The print sheet shows a distance for ship and flight while the day view hides it

source_spec: `_bmad-output/implementation-artifacts/6-16-walking-and-cycling-travel-modes.md`
origin: incidental to story 6-16 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayPrintDocument.tsx:180` and `travelplan/src/components/features/trips/TripDayView.tsx:1177`
severity: medium
summary: The same stored row renders "Flight · 5h" in the day view and "Flight · 5h · 800 km" on the printed day sheet, because the print document shows any non-null `distanceKm` regardless of mode while the day view now gates on a mode list.
evidence: Reachable because `tripImportSchemas.ts:184-207` deliberately does *not* enforce the transport/distance coupling on import, so a backup carrying `{transportType: "flight", distanceKm: 800}` restores intact. The divergence predates story 6-16 — the day view previously gated on `=== "car"` and the print doc already did not gate at all — but 6-16 is what made the day view's rule explicit and list-driven (`TRANSPORT_TYPES_WITH_DISTANCE`) without bringing the fourth surface along. Natural fix is the same one DW-112's sibling finding wants: one shared mode list all four surfaces import, rather than a fourth copy. Left out of 6-16's patch set because the print document is not otherwise touched by the story and the mismatch is not new.
status: open

### DW-110: A prefilled duration of 24 h or more is written by the form and then rejected by it

source_spec: `_bmad-output/implementation-artifacts/6-16-walking-and-cycling-travel-modes.md`
origin: incidental to story 6-16 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:105-114` (`parseTimeToMinutes`) and `:357`
severity: low
summary: `formatMinutesToTime` happily writes `"120:00"` into the duration field and reports "Route imported successfully", but `parseTimeToMinutes` caps at `\d{1,2}` and `hours > 23`, so Save answers "Duration is required" over a field that visibly contains a duration and the user cannot proceed without hand-editing.
evidence: Pre-existing — car could already reach it, but only on a ~2000 km leg. Walking and cycling reach it at ordinary distances (a 120 km walk is ~24 h), so story 6-16 widens the door rather than opening it. Currently masked by the open decision finding in the 6-16 story file (the OSRM demo host serves car times for every profile): while that holds, a walking leg gets the car duration and stays under the cap. It becomes reachable the moment per-mode routing actually works, so it should be fixed in the same pass that resolves the routing decision rather than before it. The fix is a decision as much as a patch — either widen the field's format to accept `HHH:mm`, or treat a multi-day leg as an input the segment model should reject explicitly instead of via a misleading "required" message.
status: **closed 2026-08-02** - fixed in the story 6.16 review's decision pass, as this entry said it should be. Unmasked the moment per-mode routing started returning real walking speeds (~4.5 km/h makes a ~110 km leg exceed 24 h, where car speed needed ~700 km). `parseTimeToMinutes` now accepts three digits of hours: a duration is not a time of day. Also fixes multi-day ship crossings, which could never be entered by hand. Pinned by "accepts a prefilled duration longer than a day" in `travelSegmentDialog.test.tsx`.

### DW-111: No rollback path — WALKING/CYCLING rows are unreadable by a pre-6.16 build

source_spec: `_bmad-output/implementation-artifacts/6-16-walking-and-cycling-travel-modes.md`
origin: incidental to story 6-16 review, 2026-08-02
location: `travelplan/prisma/schema.prisma:36-45`
severity: low
summary: The enum widening ships no migration because `transport_type` is bare `TEXT` with no CHECK — correct for rolling forward, but it also means a rollback to a pre-6.16 build leaves values in the column that the older generated enum does not contain, and Prisma validates enum values on deserialization.
evidence: The failure would not be scoped to the offending row: every `travelSegment` include on that trip day throws, taking the day view, the export and the print payload with it. The schema comment reasons only about the additive direction. Deferred rather than patched because the story's Dev Notes already accept one-way compatibility explicitly for the backup format and this is the same trade in the database, and because the deployment is single-operator self-hosted where a rollback is a deliberate act. What is owed is a line in the schema comment or the deploy notes saying so, not code.
status: open

### DW-112: A NUL byte in tripRepo.ts makes plain `grep -r` skip the file silently

source_spec: `_bmad-output/implementation-artifacts/6-16-walking-and-cycling-travel-modes.md`
origin: incidental to story 6-16 review, 2026-08-02
location: `travelplan/src/lib/repositories/tripRepo.ts:1424`
severity: low
summary: A literal NUL in a template string (`` `${sortOrder}\x00${imageUrl}` ``) makes `file` report the source as `data`, so `grep -r` treats it as binary and omits it without saying so — and that file held three of the five silently-defaulting transport mappers story 6-16 had to fix.
evidence: Pre-existing at baseline `68607e0`, and nothing was actually missed — the dev found and fixed all five mappers. The hazard is the audit method, not the code: story 6-16's Task 5 mandates "grep for the three literals across `src/`", and the mandated sweep cannot see the file it most needed to see unless the operator happens to pass `-a`. Worth either replacing the NUL with a delimiter that is not a NUL, or recording `grep -a` as the convention for repo-wide sweeps.
status: open

### DW-113: A route OSRM cannot find is reported as a successful import of zero

source_spec: `_bmad-output/implementation-artifacts/6-16-walking-and-cycling-travel-modes.md`
origin: operator browser pass for story 6-16, 2026-08-02
location: `travelplan/src/lib/routing/dayRouteService.ts` (the `code: "Ok"` success path)
severity: low
summary: When no routable network exists near either point, OSRM snaps both to the same node and answers `code: "Ok"` with `distance: 0, duration: 0`. The service passes that straight through, so the dialog shows "Route erfolgreich importiert" with 00:00 and 0 km — the one situation `routing_no_route` was added for, and it does not fire.
evidence: Measured through the app's own request shape on 2026-08-02. Cycling from 30,-40 to 31,-41 (mid-Atlantic) returned HTTP 200 with `{"distanceMeters":0,"durationSeconds":0}` and a two-point polyline at 39.376475,-31.248047 — the Azores, roughly 1000 km from both requested coordinates. Upstream confirms it: `routed-bike` answers `{"code":"Ok","routes":[{"distance":0,"duration":0}]}`. The saved value is caught one step later by the distance rule the same review added ("Gib eine Entfernung größer als 0 ein"), so nothing wrong is stored — but the *import* claims success, and the snapped polyline is silently a thousand kilometres away. A zero-length route between two distinct requested points is a reliable "no route for this mode" signal and is what `routing_no_route` should key on, alongside the `NoRoute`/`NoSegment` codes the review already wired. Not a regression: this path was unreachable before 6.16 because only car could import.
status: open

### DW-114: The standing helper tests for a Maps link before it tests routability, so ship and flight are told to add locations that cannot help them

source_spec: `_bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md`
origin: incidental to story 6-17 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:520-526` (`staticRouteHelper`)
severity: low
summary: Add mode, transport = ship or flight, one or both neighbours unplaced: the outer `mapsLink` arm wins, so the dialog renders "Add a location to both adjacent items." The user complies and the helper flips to "Automatic route import covers car, walking and cycling. Ship and flight are entered manually" — the instruction bought them nothing.
evidence: The branch order predates story 6-17 (the same ternary sat under the old `!isEditing ?` guard), so this is not a regression, but 6-17 removed the clause that made the sentence conditionally true: it used to read "…to calculate a Google Maps route", which scoped the promise. Fix is to test routability first — `!isRoutableTransportType(transportType) ? manualModeHelper : mapsLink ? null : unavailableHelper` — plus a case for add-mode + Flight + unplaced neighbours, which no test currently covers (the new 6-17 no-location cases all run under the default `car`). Not patched inside 6-17 because that story's AC6 is "nothing functional changes" and its Dev Notes forbid restructuring the dialog; changing which of two helpers appears in a reachable state is a behaviour change a copy story should not make unannounced.
status: open

### DW-115: In the edit dialog a permanently disabled "Plan" button has no explanation at all

source_spec: `_bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md`
origin: incidental to story 6-17 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:520` (the `isEditing ? null :` arm) with the button state at `:643-647`
severity: low
summary: Open an existing segment whose neighbours have since lost their locations: `mapsLink` is null, so the "Maps" link is not rendered and "Plan" is disabled — and because the standing helper is suppressed entirely when editing, nothing says why. The identical state in the add dialog gets `googleMapsUnavailableHelper`.
evidence: Carried over from the pre-6.17 `!isEditing ?` guard rather than introduced by it, but 6-17's new "renders no standing helper at all when editing an existing segment" case now pins the gap shut, so a future fix has to argue with a test. Cheapest correct shape is to let the unavailable branch through in edit mode too, since it is the one helper that is actionable in both states. Left out of 6-17 for the same reason as DW-114: a copy story that promises no functional change.
status: open

### DW-116: A zero-length route, or one missing only its distance, is reported as "Route import failed"

source_spec: `_bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md`
origin: incidental to story 6-17 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:425-432`
severity: medium
summary: The `> 0` guards collapse three different outcomes into one message. Two neighbours pinned at the same coordinates — a hotel and a restaurant inside it, an everyday case — produce `distance: 0 / duration: 0`, and the user is told the import failed and that retrying is worth trying, which it never is. A route that returned a valid duration but a non-numeric distance discards the duration that did arrive.
evidence: Same root as DW-113 (OSRM answers `code: "Ok"` with zeros where no network exists), but a different surface and a different symptom: DW-113 describes the pre-6.16-review behaviour where zeros were reported as *success*; the `> 0` guards added in that review turned it into a reported *failure*. Story 6-17 sharpened the wording from "Automatic route import is not available in this build" to "Route import failed", which is more truthful at three of the four call sites and less truthful at this one — the shortening made the message assert an event that did not occur. What is owed is to split the branch: a genuinely zero-length route between two distinct requested points is `routing_no_route`, and a partial route should fill in the field it did receive.
status: open

### DW-117: `googleMapsNoRouteForMode` is the dialog's longest helper and was outside story 6-17's review list

source_spec: `_bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md`
origin: incidental to story 6-17 review, 2026-08-02
location: `travelplan/src/i18n/de.ts:333-334` and `travelplan/src/i18n/en.ts:333-334`
severity: low
summary: At 108 characters in German and 110 in English it is longer than every helper story 6-17 shortened, and it renders in exactly the state cycling produces most often — a walking or cycling leg where OSRM answers `NoRoute`/`NoSegment`. AC4 enumerated four keys by name and this one, added by story 6-16, was not among them.
evidence: Measured from the dictionaries; reachable via `TripDayTravelSegmentDialog.tsx:416-419` on the 404 `routing_no_route` path. It is now bounded at its current length by the per-key budget test 6-17's review added to `i18nDictionaries.test.ts`, so it cannot grow silently — but it was never judged against the "actionable, not explanatory" standard the other four were, and the second sentence ("Trage Dauer und Entfernung manuell ein" / "Enter the duration and distance manually") is the only part the user must act on. Worth one pass with the same standard, together with DW-116, since both live on the failure branches of the same import.
status: open

### DW-118: Pressing "Plan" on a ship or flight leg discards a hand-pasted link before returning without a route

source_spec: `_bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md`
origin: incidental to story 6-17 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:379-381`, above the non-routable early return at `:386`
severity: low
summary: `setLinkUrl(modeAwareMapsLink)` runs unconditionally at the top of `handleGoogleMapsRoute`, so a URL the user typed into the link field is replaced by a generated Google directions link even on the paths that import nothing — ship and flight, no locations, no route for this mode.
evidence: Pre-existing, from story 6-16's "point the fallback link at the mode being imported" change, and deliberate for the paths that go on to import. On the early-return paths it is a silent overwrite of user input with no undo, and story 6-17 makes it marginally easier to hit by accident: the action row is now three short words, so "Plan" is a smaller and less deliberate target than "Plan with Maps" was. Fix is to move the assignment below the early returns, or to skip it when `linkUrl` differs from `seededLinkRef.current`, which is exactly the "user typed this" signal the ref already tracks.
status: open

### DW-119: The travel-segment dialog's external Maps action has a two-word accessible name and no new-tab announcement

source_spec: `_bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md`
origin: incidental to story 6-17 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:638-642`
severity: low
summary: The link is rendered as `<Button component="a" target="_blank">` with no `aria-label` and no `title`, and since story 6-17 its whole accessible name is "Maps". A screen-reader user hears "Maps, link" and gets a new browser tab with no warning.
evidence: `target="_blank"` predates 6-17 and the same pattern appears on other external links in the app, so this is a convention question rather than a defect this story introduced. It is recorded because 6-17 shortened the visible text, which is the only thing that was carrying the meaning. Deliberately not patched inside 6-17: adding `aria-label` to the *save* button — the reviewer's suggested fix — would give it an accessible name ("Save travel segment") that does not contain its visible label ("OK"), which is a WCAG 2.5.3 Label-in-Name failure and worse than what it replaces. The right scope is one pass over external links app-wide, deciding a single convention for the new-tab announcement.
status: open

### DW-120: "Duration is required" names neither the box nor the rule that broke

source_spec: `_bmad-output/implementation-artifacts/6-18-one-way-to-enter-a-time.md`
origin: incidental to story 6-18 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — `combineDurationToMinutes`, and `trips.travelSegment.durationRequired` in both dictionaries
severity: low
summary: Every way of failing the duration produces the same sentence. 1 h 99 min, 1000 h, a stray letter and two empty boxes all read "Duration is required" over two boxes that in most of those cases visibly contain a duration.
evidence: The message is pre-existing and story 6.18's AC5 pinned it verbatim ("this story changes how a value is entered, not what is accepted"), so it could not be improved inside that story. Splitting one field into two multiplied the ways to reach it and made the mismatch more visible: with a single `HH:mm` box the message at least described the whole control. The same docblock that defines the accepted set calls "an error over a field that visibly contained a duration" the failure signature it exists to prevent. A story allowed to touch the strings would give the ceiling cases their own message ("Minutes must be under 60") and leave "Duration is required" for the empty case.
status: open

### DW-121: The duration pair never stacks below `sm`, unlike the two form rows it was modelled on

source_spec: `_bmad-output/implementation-artifacts/6-18-one-way-to-enter-a-time.md`
origin: incidental to story 6-18 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — the `Box display="flex" gap={2}` wrapping the two duration boxes
severity: low
summary: The two boxes sit side by side at every width. The equivalent pair in `TripAccommodationDialog.tsx:889-895` uses `flexDirection: { xs: "column", sm: "row" }`, and `TripDayPlanDialog.tsx:1064` documents its row as stacking to a column at xs.
evidence: Deliberate, not overlooked — story 6.18's Task 3 required the pair to gain the dialog no vertical height, which is exactly what stacking would cost, and story 6.17 had just spent itself reclaiming that height. But the trade-off was never seen: at 390px the dialog paper is about 326px, so each box gets roughly 155px for a floating label of "Duration (min)" / "Dauer (Min.)". Whether that reads or crowds is a browser measurement, and story 6.18's browser pass is owed to the operator. Resolve it from that session: if the labels crowd, the cheap first move is `gap={1}`, and stacking is the fallback.
status: open

### DW-122: A stored duration above 59,999 minutes cannot be edited, and the route import can produce one

source_spec: `_bmad-output/implementation-artifacts/6-18-one-way-to-enter-a-time.md`
origin: incidental to story 6-18 review, 2026-08-02
location: `travelplan/src/lib/validation/travelSegmentSchemas.ts` (`durationMinutes: z.number().int().positive()`) against `combineDurationToMinutes`'s 999-hour ceiling in `TripDayTravelSegmentDialog.tsx`
severity: low
summary: The server accepts any positive integer; the dialog accepts hours 0-999. A segment stored above 59,999 minutes (about 41 days) opens with hours ≥ 1000 in the box and answers "Duration is required" on save — a segment that cannot be edited without retyping. The route import at `handleGoogleMapsRoute` is unclamped, so a long enough walking route could write one.
evidence: Pre-existing and unchanged by story 6.18 — the old `^(\d{1,3}):(\d{2})$` regex had exactly the same ceiling, and 6.18's AC5 required the accepted set to stay identical. Recorded because the docblock on `combineDurationToMinutes` presents this failure mode ("the field could reject its own prefill") purely as history, when a narrower version of it survives. Fix is either a `.max()` on the schema that agrees with the form, or clamping the import to the form's ceiling; the two should be one number stated once.
status: open

### DW-123: The two duration boxes are one value with no programmatic grouping, and the shared error is not announced

source_spec: `_bmad-output/implementation-artifacts/6-18-one-way-to-enter-a-time.md`
origin: incidental to story 6-18 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — the duration `Box` and its `FormHelperText`
severity: low
summary: The hours and minutes boxes are two independent fields sharing one `aria-describedby` target. There is no `role="group"` or fieldset naming them as one control, and the error is not a live region, so it is announced only if the user happens to be on one of the two inputs when it appears.
evidence: Each box carries a self-describing label ("Duration (h)", "Duration (min)"), so nothing is unlabelled and the error is correctly associated — this is a polish gap, not a barrier. It is not specific to this dialog either: no error in the app is announced through a live region, and no split control anywhere is grouped. Recorded as the concrete instance of a convention the app has not yet chosen; deciding it once, app-wide, beats grouping one pair.
status: open

### DW-124: The travel-segment distance field does not clear its error when corrected

source_spec: `_bmad-output/implementation-artifacts/6-18-one-way-to-enter-a-time.md`
origin: incidental to story 6-18 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — the distance `TextField`'s `onChange`
severity: low
summary: After a failed save, editing the distance leaves the field red under the old message until the next OK press. `TripDayPlanDialog.tsx:1078-1081` clears its field errors on change; this dialog's distance field does not.
evidence: Pre-existing. Surfaced because story 6.18's review added exactly this clearing to the two new duration boxes — one message painting two boxes made a stale error twice as loud — which leaves the distance field the odd one out inside the same dialog. `handleTransportTypeChange` already clears `distanceKm`, so the pattern is half there; the fix is the same two lines used on the duration boxes.
status: open


## Note: story 6.16 review decision (2026-08-02)

The one `decision-needed` finding from the 6.16 code review - walking and cycling route import
returning car numbers - was resolved in the same session and is **not** deferred. The public
`router.project-osrm.org` demo host serves a single car graph and ignores the `{profile}` path
segment; each mode now has its own FOSSGIS endpoint (`routed-car` / `routed-bike` / `routed-foot`),
overridable via `OSRM_BASE_URL`. Verified live: 29.6 / 9.9 / 4.5 km/h over the same 2.9 km. Full
detail in the story file under "Decision resolved".

Standing hazard worth carrying forward: the routing backend is a community service under fair use.
It is fine at one request per explicit user action. Anything that routes automatically or in bulk -
a background prefill, a per-day batch, a map that re-routes on pan - needs a self-hosted OSRM behind
`OSRM_BASE_URL` first.

### DW-125: The day-hero overflow menu can outlive its trigger and anchor to a detached node

source_spec: `_bmad-output/implementation-artifacts/6-19-day-hero-three-surfaces.md`
origin: incidental to story 6-19 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — `dayMenuAnchor`, the `Menu`'s `open` prop, and `loadDay()`
severity: low
summary: Anything that re-enters the day's loading state without changing `dayId` — a transfer submit, an accommodation dialog's `onSaved`, or `notFound` — unmounts the hero and its `⋯` trigger while the menu is open, leaving `anchorEl` on a node no longer in the document. MUI then warns about an invalid `anchorEl` and paints an empty paper in the viewport corner.
evidence: Pre-existing, and the guard that appeared to cover it never did. Until 6.19 the menu read `open={hasDayMenuItems && Boolean(dayMenuAnchor)}`, with a comment attributing exactly this protection to the first conjunct — but `hasDayMenuItems` was `Object.values({ dayImage, transfers, print: true }).some(Boolean)` and `print` is a literal `true`, so it was tautologically true for every role and suppressed nothing. Story 6.19 removed the conjunct (the trigger is unconditional now that back-to-trip is ungated), which is a behavioural no-op and neither introduces nor worsens the hole. The only reset that clears the anchor fires on a `dayId` change, and none of the three paths above change `dayId`. The fix is to clear `dayMenuAnchor` where the hero unmounts — alongside `setLoading(true)` in `loadDay()` and `setNotFound(true)` — not to add a term to `open`.
status: open

### DW-126: A non-404 failure on the day screen leaves no in-app route back to the trip

source_spec: `_bmad-output/implementation-artifacts/6-19-day-hero-three-surfaces.md`
origin: incidental to story 6-19 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — the `error && !detail` branch
severity: medium
summary: When the day fetch fails for any reason other than 404, the page renders an `Alert` and nothing else. The hero does not render, so neither does the `⋯` menu that now holds back-to-trip, and the user's only way out is the browser's own back gesture.
evidence: Pre-existing — the back button lived inside the same `detail && day` branch before story 6.19 moved it into the menu, so the error state has never carried a route out. Surfaced by 6.19 because that story made the hero menu the *sole* route to the parent trip: `AppHeader.tsx` renders the brand as a `Typography` rather than a link, `getAuthMenuItems` returns only `logout` for an authenticated user, and the 6.9 breadcrumb is gone, so on this screen `document.querySelectorAll('a[href="/trips/{id}"]')` returns zero outside the open menu. The 404 branch already renders its own back link and is the model; the error branch wants the same one.
status: open

### DW-127: A future menu action without an `href` renders a dead `#` anchor instead of failing to compile

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/lib/navigation/authMenu.ts` (`href?: string`) against `travelplan/src/components/HeaderMenu.tsx:209-223`
severity: medium
summary: `HeaderMenu` decides link-versus-action by the literal `item.key === "logout"`, and renders everything else as `MenuItem component={Link} href={item.href ?? "#"}`. `href` stays optional on a union that now contains a destination, so the invariant the menu depends on — a non-logout item always carries an href — is enforced by nothing. The next *action* item added to the list renders as an anchor to `#` and silently does nothing.
evidence: Not introduced by 6-20 — the `?? "#"` fallback and the `key === "logout"` branch both predate it, and every item shipping today satisfies the invariant, so nothing is broken now. Surfaced because 6-20 widened the union for the first time and deliberately left `HeaderMenu.tsx` untouched (the story's whole point was that the existing href branch already handled a destination). The fix is a discriminated union — `{ kind: "destination"; href: string } | { kind: "action" }` or equivalent — which turns the failure into a compile error and lets the renderer branch on shape rather than on a key literal; the unreachable `?? "#"` then goes away with it. Touching a global component that three stories have warned against extending, so it wants its own scoped change rather than a drive-by.
status: open

### DW-128: The header menu never revalidates its auth state, and now carries navigation rather than only session actions

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/components/HeaderMenu.tsx` — `authState`, seeded from the `isAuthenticated` prop
severity: medium
summary: `authState` is seeded from a server-rendered prop and only ever changes on prop change or an explicit logout. A tab left open past session expiry keeps offering "All trips", which `middleware.ts`'s `isProtectedPath` then bounces to the login screen — the outcome story 6-20's AC3 calls "worse than none".
evidence: Pre-existing staleness: the menu has always been able to show "Sign out" to an expired session. Surfaced by 6-20 because it changed what a stale row costs — a stale session *action* is a failed click on something the user was finishing anyway, while a stale *navigation* row is a broken promise about where the app can take them. Cheap mitigation: the menu already fetches `/api/auth/csrf` when it opens, so a `401` there is a ready signal to flip `authState` to false without any new endpoint. Not urgent — the bounce lands on a login screen that then returns the user to the app — but it is the one hole in AC3's guarantee, and AC3 is stated absolutely.
status: open

### DW-129: The global menu's trips row is not marked as the current page when it already is

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/components/HeaderMenu.tsx:209-223`, decision recorded at `travelplan/src/lib/navigation/authMenu.ts`
severity: low
summary: On `/trips` the row links to the page already shown. Story 6-20 AC4 decided deliberately to keep it visible there, but nothing marks it as current: a screen-reader user gets an identical announcement on `/trips` as on a trip page, and activating it produces no perceptible change.
evidence: The self-link is intentional and argued (the global menu is a function of auth state alone, and route-awareness is the coupling stories 6.11 and 6.15 refused), so this is not a defect in the decision — it is the one piece of polish the decision leaves owing. `aria-current="page"` plus MUI's `selected` would signpost it without making menu *content* route-dependent, but both need `usePathname()`, which is exactly the dependency AC4 declined; whether that trade is worth making is a design call, not a patch. Worth deciding once for the whole menu rather than for this row.
status: open

### DW-130: One breadcrumb moved into the menu; its three structural twins stayed above the content

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/app/(routes)/trips/[id]/costs/page.tsx:20` (`TripDayMapBackButton`), plus the `trips.overviewMap.back` and `trips.dayView.mapBack` readers
severity: low
summary: The costs page still renders a back link as the first child of the same `Container` → `Box` → column shell that 6-20 just dismantled on the trip detail page, and the two full-page map screens do the same. As of this commit the app holds two idioms for "the way out of this page": a menu row on one screen, a breadcrumb above the content on three others.
evidence: Correctly out of scope — 6-20's argument is specifically that a *global constant* destination (`/trips`) belongs in the global menu, while a trip- or day-scoped one (`/trips/{id}`) must not be pushed into a component built from auth state alone, and all three survivors are trip-scoped. So the rule is consistent; what is missing is a stated scope, because a reader who sees only the diff will read it as "breadcrumbs are wrong" and apply it to the wrong screens. Either write the scope down where those pages can see it, or decide the trip-scoped back links belong in their pages' own overflow menus the way story 6.19 did for the day hero.
status: open

### DW-131: The trip detail page's full-height wrapper now holds one child and guarantees a scrollbar

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/app/(routes)/trips/[id]/page.tsx` — the outer `<Box sx={{ minHeight: "100vh" }}>`
severity: low
summary: `minHeight: "100vh"` plus `AppHeader`'s `minHeight: 72` Toolbar makes the document at least 100vh + 72px, so even a one-day trip scrolls. The Box also wraps a single child and paints nothing — unlike the costs page's equivalent, which at least sets a background.
evidence: Pre-existing arithmetic; the Box and the Toolbar both predate this story. Recorded because 6-20 audited the *inner* wrapper for exactly this reason (single child, no effect) and removed it, which leaves the adjacent wrapper — the one with an actual layout consequence — as the arbitrary survivor. The sibling day page renders a bare `Container` with no such Box, so the app already disagrees with itself. The fix is either `minHeight: "calc(100vh - 72px)"` against a shared header-height constant or dropping the Box, and it should be decided for every page that carries this pattern at once.
status: open

### DW-132: The "trip not found" panel is duplicated verbatim, and the cost overview reads `trips.detail.*` keys

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripTimeline.tsx:286-302` and `TripCostOverview.tsx:335-349`
severity: low
summary: Both components render the same panel — `Paper` → column `Box` → title `Typography` → body `Typography` → `Button component={Link} href="/trips"` — reading the same three keys, including `trips.detail.notFoundTitle/Body/back` inside a *cost overview*, where that namespace does not belong.
evidence: Story 6-20 correctly protected both from deletion (AC5) and now pins each with its own test, so the duplication is held in place by two tests as well as two components. Nothing is broken; the cost is that a copy change to the panel has to be made twice and the keys mis-describe one of their readers. Fix is a small shared `TripNotFoundPanel` with its own key namespace, which also gives the third caller — `TripDayView`'s day-not-found card — somewhere to go.
status: open
seen-again: 2026-08-03 (story 7-13-cost-overview-redesign) — the two copies are no longer verbatim: this story restyled the cost-overview copy onto the token card with `variant="heading" component="h1"` in `tokens.ink`, while `TripTimeline.tsx` still renders `Paper elevation={1}` with `h6 fontWeight={600}`. The line numbers above are stale and the extraction now has to reconcile two treatments rather than lift one, with the redesigned copy being the correct target.

### DW-133: The home page offers Register and Sign in to a signed-in user

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/components/HomeHero.tsx:24-32`, called from `travelplan/src/app/page.tsx:32`
severity: low
summary: `HomeHero` renders its two CTAs — "Create account" (`/auth/register`) and "Sign in" (`/auth/login`) — unconditionally. `app/page.tsx` passes only `showHowItWorks={!isAuthenticated}`, so an authenticated visitor on `/` is invited to register while the header menu beside it offers "All trips" and "Sign out".
evidence: Pre-existing and untouched by story 6-20. Surfaced by it because `/` is now one of the pages where the new menu row pays off ("reachable from every page an authenticated user can open"), which makes the contradiction on the same screen visible: the menu knows who the user is and the hero does not. The prop to thread already exists — `resolveAuthState()` is called two lines above the `HomeHero` render — so the fix is small; what it needs is a decision about what the hero should say instead ("Open my trips", or no CTA block at all).
status: open

### DW-134: Two `react/no-children-prop` errors in `theme.ts` block a clean `npm run lint`

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: incidental to story 6-20 review, 2026-08-02
location: `travelplan/src/theme.ts:120` and `:137`
severity: low
summary: `npm run lint` ends at "2 errors, 83 warnings" on a clean tree — both errors are `Do not pass children as props` in `theme.ts`, in component slots that pass `children` inside a props object. Lint is the repo's only static gate (see DW-95: there is no `typecheck` script), and it exits non-zero regardless of what a story changed.
evidence: Confirmed pre-existing: the same two errors and the same 83 warnings appear before and after story 6-20's changes, and neither line is in any file this story touched. The consequence is that "is lint clean?" cannot be used as a signal — every story has to diff the output by hand to tell its own findings from the baseline, which is precisely the trap DW-95 describes for `tsc`. Fix is small and local (pass the children as an argument rather than a prop in both slots), and it is worth doing at the same time as wiring the typecheck gate.
status: open

### Note: story 6.20 partially reduces DW-126 (2026-08-02)

DW-126 argues that a non-404 failure on the *day* screen leaves no in-app route out, and cites
`getAuthMenuItems` returning only `logout` for an authenticated user as part of its evidence. That
clause is no longer true as of story 6.20: the global header menu now carries an "All trips" row on
every page, so the day error screen does have one route out. DW-126's substance stands — its target
is back to the *parent trip* (`/trips/{id}`), which the global menu still does not and should not
offer — but its severity is lower than when it was written. Story 6.20 applied the analogous fix to
`TripTimeline`'s own error branch, which is the model DW-126 asks for.

### DW-135: The stat strip's row-growth defect survives in cell 4's *value*, on every day without a stay

source_spec: `_bmad-output/implementation-artifacts/6-21-shorter-day-stat-labels.md`
origin: incidental to story 6-21 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — `statValueSx` and the `checkInStatValue` render in cell 4
severity: medium
summary: Story 6.21 removed the accommodation name from cell 4's *label*, which is where a long hotel name grew row 2 and dragged the spend cell up with it. `statValueSx` still carries `overflowWrap: "anywhere"`, and cell 4's value on a day with no accommodation is the sentence "No accommodation" / "Keine Unterkunft" at 21px/900 in a ~130px column at 390px. It wraps to two lines and grows the same row, by the same mechanism, on every gap day — which is a far more common state than "the hotel has a long name".
evidence: Correctly out of scope: story 6.21's Trap 4 says explicitly that a strip which still does not fit after the labels shorten is "a finding for a new story, not licence to restructure the grid", and AC5 requires the two-state value to keep reading as it does. So nothing here contradicts the story. What the story's Change Log now claims is narrower than it sounds — "no user-supplied text can set the strip's row height" is true, and is not the same as "the strip no longer grows". The fix is a decision about the value, not the label: a shorter string for the empty state (an em dash, matching the "check-in unset" case, loses the distinction AC5 protects), a smaller font for that one value, or letting the cell clip. Worth measuring in a browser first — the manual pass owed by story 6.21's Task 5 is the natural place to confirm it.
operator_measurement (2026-08-02, Chromium, `cec3505`): **Confirmed, and larger than this entry assumed.** On a day with no accommodation the value "Keine Unterkunft" wraps to **2 lines at 390px** and **3 lines at 600px**, growing the strip's row by **+31px at both widths** (85px -> 117px, and 117px -> 148px). Story 6.21 removed exactly this mechanism from the *label*; it survives untouched in the *value*. Worth raising in priority on frequency alone: a day without a booked stay is far more common than a day whose hotel name is long enough to have triggered the original complaint.
status: open

### DW-136: The same number is "Ausgaben" in the stat strip and "Kosten heute" in the card below it

source_spec: `_bmad-output/implementation-artifacts/6-21-shorter-day-stat-labels.md`
origin: incidental to story 6-21 review, 2026-08-02
location: `travelplan/src/i18n/de.ts` — `trips.dayView.statSpendToday` vs `trips.dayView.costCardTitle`; same pair in `en.ts`
severity: low
summary: `dayTotalCents` is rendered twice on the day screen — once in stat cell 3, now labelled "Ausgaben" / "Spend", and once as the cost card's title "Kosten heute" / "Costs today" with the subtitle "bisher erfasste Ausgaben, Tag {index}". Two nouns for one figure, and the subtitle uses the other one.
evidence: Recorded because story 6.21's Dev Notes call for it by name and its reasoning is worth keeping: the two were already inconsistent before the story, and shortening one of them does not create the ambiguity — the card's own subtitle already says which day it means. So this is a vocabulary decision ("does this app call day money Ausgaben or Kosten?"), not a defect, and it should be settled once across the strip, the card and the cost overview rather than renamed inside a copy story. The key `statSpendToday` also still says "today" after the copy dropped it; fold that rename in when the word is decided.
status: open

### DW-137: On a day with two stays, the check-in cell no longer says which one it means

source_spec: `_bmad-output/implementation-artifacts/6-21-shorter-day-stat-labels.md`
origin: incidental to story 6-21 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — stat cell 4, and `previousStay` / `currentStay`
severity: low
summary: A moving day has a `previousStay` being checked out of and a `currentStay` being checked into. The cell used to read "Check-in <name>"; it now reads "Check-in" over a bare time, so the strip states a check-in time without naming which of the day's two accommodations it belongs to.
evidence: Real but small, and the fix is explicitly not "put the name back" — story 6.21 AC2 requires the label to be the same string in both states, which is the entire point of the change. The information is still on screen: the timeline card for the arriving stay carries its name and the same time. If the strip should disambiguate, the place is the value's accessible name (an `aria-label` on the value carrying the stay's name), which costs the layout nothing because it is not rendered text. Worth doing at the same time as any other accessible-name work on the strip — the four cells currently expose label and value as two unassociated text nodes to a screen reader.
status: open

### DW-138: The stat labels now clip silently instead of truncating visibly

source_spec: `_bmad-output/implementation-artifacts/6-21-shorter-day-stat-labels.md`
origin: incidental to story 6-21 review, 2026-08-02
location: `travelplan/src/components/features/trips/TripDayView.tsx` — `statLabelSx`, inside the wrapper that sets `overflow: hidden`
severity: low
summary: Story 6.21 dropped `overflowWrap: "anywhere"` from the stat labels for a good reason — mid-word breaking is what converted one long string into a taller grid row. But the strip sits inside a wrapper with `overflow: hidden`, so the failure mode it leaves behind is a label cut off at the cell edge with no ellipsis and no other signal, rather than a label visibly spilling. `whiteSpace: nowrap` + `textOverflow: ellipsis` + `overflow: hidden` on the label would give all three properties at once: no row growth, no silent loss, and a visible "…" that says the string is too long.
evidence: Not a defect today — all four labels are short dictionary constants, a computed-style test pins the decision, and `i18nDictionaries.test.ts` caps the longest word in each at 10 characters. It is recorded because the character cap is a proxy for a pixel constraint measured on text that is uppercased at render, and because the narrowest cell is not the phone: at `sm` the grid goes to four columns, so a 600px viewport gives each cell roughly 89px against ~130px at 390px. An ellipsis would make the guard's inevitable eventual miss visible instead of silent. Deliberately not done inside a copy story whose AC6 says the label typography is untouched.
status: open

### DW-139: A shipped spec still names `trips.dayView.statCheckIn` as the stat strip's key set

source_spec: `_bmad-output/implementation-artifacts/6-21-shorter-day-stat-labels.md`
origin: incidental to story 6-21 review, 2026-08-02
location: `_bmad-output/implementation-artifacts/7-3-day-detail-redesign.md:265`, and the same key quoted in 7-11
severity: low
summary: Story 6.21 deleted `trips.dayView.statCheckIn` from both dictionaries. Story 7.3's spec, which is the document that defined the stat strip, still lists it with its `{name}` placeholder as one of the strip's four labels.
evidence: Completed spec files are records of what was decided at the time, not live documentation, so amending 7.3 in place would cost more than it saves — this ledger entry is the pointer. It matters only for the specific case of someone rebuilding the strip from 7.3 and reintroducing the interpolated label along with it. The concrete mitigation is already in place and is the reason `statCheckInGeneric` deliberately kept its now-meaningless suffix: `statCheckIn` was left retired rather than rebound to the short string, so an old reference to it reads as obviously stale instead of silently resolving to something with different semantics.
status: open

### DW-140: The hamburger trigger announces no menu — no aria-haspopup, aria-expanded or aria-controls

source_spec: `_bmad-output/implementation-artifacts/6-20-trips-link-into-the-header-menu.md`
origin: operator browser pass for story 6-20, 2026-08-02
location: `travelplan/src/components/HeaderMenu.tsx:161-174`
severity: low
summary: The global menu's `IconButton` carries `aria-label` alone. A screen-reader user is told it is a button named "Menü öffnen" but not that it opens a menu, nor whether that menu is currently open — while the page-local day-hero `⋯` has carried all three attributes since Story 6.11.
evidence: Measured on 2026-08-02: `trigger.getAttribute("aria-expanded")` is `null` before opening, while open, and after closing. `TripDayView.tsx` sets `aria-haspopup="menu"`, `aria-expanded={Boolean(dayMenuAnchor)}` and `aria-controls` on its own trigger, so the app already has the pattern and this one component diverges. Pre-existing and not introduced by 6.20 — but 6.20 is the story that gave this menu a navigation destination, which makes it the point at which the gap starts to matter. Fix is three attributes plus an `id` on the `Menu`, mirroring what `TripDayView` already does.
status: open

### DW-141: `isOwner`/`canEditPlanning` default to `true` when the payload omits `accessRole`, and owner-only controls inherit that

source_spec: `_bmad-output/implementation-artifacts/2-33-restore-export-entry-point.md`
origin: 2-33-restore-export-entry-point, code review, 2026-08-03
location: `travelplan/src/components/features/trips/TripTimeline.tsx:180-181`, same shape in `TripDayView.tsx`
severity: low
summary: `detail?.trip.accessRole ? detail.trip.accessRole === "owner" : true` opens the owner-only controls — now Delete, Share and Export — to anyone whose trip payload arrives without an `accessRole` field. The fallback is permissive where every other guard in the app is restrictive.
evidence: Unreachable today and therefore low: `getTripAccessForUser` (`src/lib/auth/tripAccess.ts:21-59`) always sets the role and the detail route forwards it (`src/app/api/trips/[id]/route.ts:47,172`), so no live response omits the field — verified during this story's review, not assumed. It is recorded because Story 2.33 makes the consequence larger than it was: the export button is the third owner-only control riding on this flag, and the failure mode it would produce for a non-owner is precisely the ungated-button-yields-404 defect Story 7.8 removed the old export button over. Pre-existing and explicitly out of 2.33's scope (its Dev Notes forbid changing the fallback). Fix is to default the two flags to `false` and let the loading state cover the gap, which needs a check of every consumer — the same expression exists in `TripDayView.tsx` and both feed several controls.
status: open

### DW-142: The v1 fallback still materialises the whole upload, plus a second copy as a JS string

source_spec: `_bmad-output/implementation-artifacts/2-34-import-archive-from-disk.md`
origin: 2-34-import-archive-from-disk, code review, 2026-08-03
location: `travelplan/src/app/api/trips/import/route.ts:215-225` (the `!looksLikeZipFile` branch), same shape in the `request.json()` branch at `:150-159`
severity: medium
summary: Story 2.34 made the ZIP path disk-backed, but the container is chosen by magic bytes, so anything whose first four bytes are not `PK\x03\x04`/`PK\x05\x06` takes the v1 branch and is read whole with `fs.readFile` and then converted with `bytes.toString("utf8")` — a second, wider copy. 300 MB of noise is roughly 1 GB resident before `JSON.parse` even fails.
evidence: Measured during review: 100 MB of random bytes cost +189 MB for the string alone and 321 MB peak. Deliberately not fixed in 2.34. It is not a regression — the pre-story multipart path held four copies of the same upload and this one holds two — but it is the last unbounded materialisation on the route, and `importLimits.ts` now claims the opposite. A cap is the obvious fix and is exactly what AC8 forbids ("v1 JSON backups … behave exactly as today"), so it needs its own story and a decision on what a v1 backup may legitimately weigh. Note the same shape sits in the untouched `application/json` branch, which 2.34 did not go near.
status: open

### DW-143: Nothing bounds concurrent imports, so the temp-file disk cost is N × 300 MB

source_spec: `_bmad-output/implementation-artifacts/2-34-import-archive-from-disk.md`
origin: 2-34-import-archive-from-disk, code review, 2026-08-03
location: `travelplan/src/app/api/trips/import/route.ts:168-176`, `travelplan/src/lib/trips/importLimits.ts:11-46`
severity: medium
summary: `MAX_IMPORT_PACKAGE_BYTES`'s rewritten docblock names "temp-file disk per concurrent import" as the first reason the ceiling stays at 300 MB, but no guard enforces a concurrency limit. Each in-flight import holds up to 300 MB in `os.tmpdir()` for the life of a request whose transaction budget is 120 s.
evidence: The reason is stated in the code and the guard is not written — found by review, not by failure. Trading memory for disk was the whole point of 2.34, so the resource that now scales with concurrency is the one nothing counts; on the production box `os.tmpdir()` is `/tmp`, shared with the second application the story's Dev Notes describe. Out of scope for 2.34, which was asked to remove the memory coupling and did. Fix is a small in-process counter answering 503 past a ceiling, which needs a decision on what that ceiling is for a single-box deployment.
status: open

### DW-144: `tripImportRequestSchema` puts no ceiling on the manifest, so `trip.json` is bounded only by the ZIP reader

source_spec: `_bmad-output/implementation-artifacts/2-34-import-archive-from-disk.md`
origin: 2-34-import-archive-from-disk, follow-up code review, 2026-08-03
location: `travelplan/src/lib/validation/tripImportSchemas.ts`, ceiling currently enforced in `travelplan/src/lib/trips/zipReader.ts` (`MAX_MEMBER_UNCOMPRESSED_BYTES`)
severity: low
summary: The row caps in `importLimits.ts` do not bound the manifest anywhere near a size worth caring about — `MAX_IMPORT_DAYS` 7300 × `MAX_IMPORT_SEGMENTS_PER_DAY` 200 admits well over a million segments, and day-plan items per day are not capped at all — so the de-facto ceiling on `trip.json` is `MAX_MEMBER_UNCOMPRESSED_BYTES` (64 MB) in the ZIP reader, and a manifest that trips it is refused with "Archive entry is larger than this reader will read: trip.json", a message about the reader's internals rather than about the payload.
evidence: Found by review of Story 2.34, whose per-member cap is what made the reader the effective limit; the miscount was in that cap's own justification, which cited the row caps as bounding the manifest "in practice" and has been corrected in place. No real backup comes close — a genuine manifest is a few hundred kilobytes — so nothing user-facing is broken today and this is not a regression: before 2.34 nothing bounded the manifest at all. What is deferred is the right fix, which is a size or item ceiling in the schema so the refusal comes with a message about the backup, plus deciding what a legitimate manifest may weigh. That decision is the same one DW-142 needs for a v1 payload and the two should probably be taken together.
status: open

### DW-145: No API route logs anything, so every 500 in the app is unattributable

source_spec: `_bmad-output/implementation-artifacts/5-8-view-all-registered-system-users.md`
origin: 5-8-view-all-registered-system-users, follow-up code review, 2026-08-03
location: repo-wide across `travelplan/src/app/api/**/route.ts`; surfaced at `travelplan/src/app/api/users/route.ts:44`
severity: low
summary: Every `catch` in every route handler discards the caught error and answers `server_error` — `grep -rn "console\.\|logger" src/app/api src/lib` returns nothing, so the application emits no server-side record of any failure it converts into a 500.
evidence: Verified by grep during this review, not assumed: zero matches in both `src/app/api` and `src/lib` (the only `no-console` directives in the repo are in `test/zz-hero-diagnostic.test.tsx`). Pre-existing and repo-wide, not introduced by Story 5.8 — the new `/api/users` handler inherits the established skeleton exactly. Recorded because the consequence is now slightly larger: `/api/users` is the one read in the app that leaves the caller's own trip graph, and a production failure there leaves no trace of what broke or who asked. Fixing it is not a one-line change in this story's file — it needs a logging seam chosen once (a `src/lib/logging` helper plus the `no-console` rule's disposition) and applied to roughly thirty handlers, which is its own story.
status: open

### DW-146: AC7's arrow-key tab navigation is asserted against a hand-written mock of MUI `Tabs`, never against MUI itself

source_spec: `_bmad-output/implementation-artifacts/6-22-activity-dialog-in-tabs.md`
origin: 6-22-activity-dialog-in-tabs, code review, 2026-08-03
location: `travelplan/test/tripDayPlanDialog.test.tsx` (the `@mui/material` mock), covering `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
severity: low
summary: Story 6.22's AC7 asks for arrow-key navigation between tabs and roving `tabIndex`, and the component gets both by using MUI `Tabs`/`Tab` — but the suite replaces those with `<div role="tablist">` / `<button role="tab">` that have no keyboard handling at all, so nothing in the repo executes the behaviour the criterion names.
evidence: Verified during review of 6.22, not assumed: `test/tripDayPlanDialog.test.tsx` is the only suite that renders this dialog (the four `tripDayPlanDialog*Import*` files test import shape and never render), and it mocks `@mui/material` wholesale. The mock does assert the tab *semantics* — `role`, `aria-selected`, `aria-controls` — so a regression from tabs to plain styled buttons still breaks the suite; what is unprotected is losing `value`, the roving `tabIndex`, or the arrow-key handling, all of which come from MUI and all of which would leave 28 green tests. The mocking is a pre-existing repo-wide pattern, not something 6.22 introduced, which is why the fix is not local: it needs one dialog suite that renders against real MUI (or a jsdom keyboard test at a level above the mock), and that decision applies to every dialog in the app.
status: open

### DW-147: The `trips.payments.minRows` validation branch looks unreachable, and its focus target is justified by a claim that would not hold if it revived

source_spec: `_bmad-output/implementation-artifacts/6-22-activity-dialog-in-tabs.md`
origin: 6-22-activity-dialog-in-tabs, code review, 2026-08-03
location: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — the `payments.length < 2` guard in `handleSave`, the split-mode normalisation effect, and the row `Remove` button
severity: low
summary: In split mode the normalisation effect pads `payments` up to two rows and the per-row `Remove` button is `disabled={payments.length <= 2}`, so `payments.length < 2` should never be true when `handleSave` reaches its split branch — the `minRows` message and its i18n keys appear to be dead.
evidence: Read during review of 6.22 while auditing the error→tab map, which has to assign every error a tab and a focus target whether or not the error can occur. Pre-existing: both the guard and the two things that make it unreachable pre-date this story, and 6.22 only moved the block. Recorded rather than deleted for two reasons. Removing a validation branch needs certainty that no path (a restored draft, a future bulk edit, an import) can produce a one-row split, and that was not established here. And if it is kept, its focus target should be revisited: `planErrorFocusId` sends the caret to the cost box for every `paymentError`, which is right for the sum-mismatch and cost-required cases but wrong for `minRows`, where the action the user must take is pressing "Zahlung hinzufügen".
status: open

### DW-148: Inserting an activity into a day strands its new neighbours' travel segment — invisible, still counted

source_spec: `_bmad-output/implementation-artifacts/6-23-move-a-single-activity-to-another-day.md`
origin: 6-23-move-a-single-activity-to-another-day, code review, 2026-08-03
location: `travelplan/src/lib/repositories/dayPlanItemRepo.ts` (`createDayPlanItemForTripDay`, `updateDayPlanItemForTripDay`, `moveDayPlanItemToTripDay`), surfacing in `travelplan/src/components/features/trips/TripDayView.tsx` (`totalTravelMinutes` vs `segmentsByKey`)
severity: medium
summary: A day with A →(car, 40 min)→ B gains an activity M whose time falls between them. The timeline is now A, M, B, so the view draws A→M and M→B as empty gaps and never looks up A→B — but `totalTravelMinutes` sums every segment row on the day, so those 40 minutes go on being reported as "Fahrzeit" with no control anywhere that can remove them.
evidence: Both reviewers found this independently. It is the same invisible-and-permanent over-count Story 6.23's AC6 closed for *removal*, reached instead by *insertion*, and it is pre-existing rather than introduced here: `grep -n "travelSegment" dayPlanItemRepo.ts` shows neither `createDayPlanItemForTripDay` nor `updateDayPlanItemForTripDay` touches segments at all, so creating an activity in the middle of a day, or retiming one so it reorders, already does this today. Story 6.23's move is a third trigger of the same cause. It is not patchable inside this story: the fix is a "reconcile this day's segments against its current timeline" routine — needing `buildSegmentTimeline`'s adjacency rules and the accommodation endpoints, and a decision about whether a stranded segment is deleted or shown for the user to resolve — applied to create, update and move alike. `createTravelSegmentForTripDay` already refuses to re-create a non-adjacent pair, so a day in this state cannot be repaired through the UI either.
status: open

### DW-149: Deleting an accommodation leaves its travel segments behind — the other half of the enum Story 6.23 fixed

source_spec: `_bmad-output/implementation-artifacts/6-23-move-a-single-activity-to-another-day.md`
origin: 6-23-move-a-single-activity-to-another-day, code review, 2026-08-03
location: `travelplan/src/lib/repositories/accommodationRepo.ts` (`deleteAccommodationForTripDay`)
severity: medium
summary: `TravelSegmentItemType` has exactly two members. Story 6.23 gave `DAY_PLAN_ITEM` a sweep on both the move and the delete path; `ACCOMMODATION` has none, and `deleteAccommodationForTripDay` is a bare `prisma.accommodation.delete` with no transaction and no segment cleanup.
evidence: `TravelSegment` has no foreign key to `Accommodation` either — only `tripDayId` cascades (`prisma/schema.prisma`) — so a deleted stay leaves every segment that pointed at it on the day, counted by `totalTravelMinutes` and drawn by nothing. The repo test Story 6.23 added for the activity path (`dayPlanItemRepo.test.ts`, "removes the travel segments referencing a deleted activity so the day stops counting them") would fail the same way if written against the stay path. Deferred rather than patched because it is outside this story's files and its ACs, and because the fix should decide once whether `removeTravelSegmentsReferencing` becomes type-agnostic (`itemType` + `itemId`) rather than growing a second near-identical helper.
status: open

### DW-150: One day-plan-item ordering comparator, copied verbatim into three repositories

source_spec: `_bmad-output/implementation-artifacts/6-23-move-a-single-activity-to-another-day.md`
origin: 6-23-move-a-single-activity-to-another-day, code review, 2026-08-03
location: `travelplan/src/lib/repositories/dayPlanItemRepo.ts`, `travelplan/src/lib/repositories/tripRepo.ts` (`compareDayPlanItemsByStartTime`), `travelplan/src/lib/repositories/travelSegmentRepo.ts` (`comparePlanItemsByStartTime`)
severity: low
summary: `DayPlanItem` has no `sortOrder` column; its order is `fromTime` → `createdAt` → `id`, expressed three times in three files. Story 6.23's AC7 (where a moved activity lands) rests entirely on those three staying identical, and the story's tests reach the ordering only through `listDayPlanItemsForTripDay` — the order the user actually sees comes from `getTripWithDaysForUser`.
evidence: All three copies read during this review. Pre-existing duplication; recorded now because Story 6.23 made a *correctness claim* depend on it rather than just a display detail. The fix is one exported comparator plus a test that pins the rendering path's ordering, not just the repository's.
status: open

### DW-151: Every `formatCost` copy hardcodes EUR, and no trip carries a currency

origin: Deferred from: 7-13-cost-overview-redesign (2026-08-03)
location: `travelplan/src/lib/trips/formatCost.ts`, `travelplan/src/components/features/trips/TripTimeline.tsx:220`, `travelplan/src/components/features/trips/TripDayView.tsx:539`
severity: medium
reason: All three surviving copies of the formatter pass `style: "currency", currency: "EUR"` as a constant, and `prisma/schema.prisma`'s `Trip` model has no currency field for them to read. A trip priced in dollars, pounds or francs therefore renders as euros on every screen that shows money — the trip overview's cost summary, Day Detail, the cost overview's per-day and per-month lists and its trip total alike — with no indication the symbol is wrong and no way for the user to correct it. Story 7.13 converged the *divergence* half of DW-27 (this screen now uses the shared `src/lib/trips/formatCost.ts` rather than a bare-number local copy wrapped in `trips.stay.costSummary`), which is why DW-27's closure must not be read as covering this. Fixing it is not a formatting change: it needs a `currency` column on `Trip` plus a migration and a backfill default, a way to set it in the trip create/edit dialog, and a decision about whether existing amounts are re-interpreted or re-entered — all outside a visual-only story's scope, and all touching schema rather than paint.
operator_decision (2026-08-03): **Non-blocking, stays open.** This is the same family as the defect Story 6.23 fixed for activities, one level up: 6.23 removes the segments that reference a deleted *activity*, but a segment on day N pointing at day N−1's accommodation is orphaned when that *day* is deleted, and `TravelSegment` cascades on `tripDayId` alone. Story 2.35 is right to restore such rows rather than drop them — the archive is a faithful record and the gap is on the UI side, which counts what it will not draw and offers no way to remove it. The fix belongs with 6.23's helper, extended to the cross-day case.
status: open

### DW-152: `trips.stay.costSummary` is now a dead key in both locales

source_spec: `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md`
origin: 7-13-cost-overview-redesign, implementation verification, 2026-08-03
location: `travelplan/src/i18n/en.ts:570`, `travelplan/src/i18n/de.ts:540`
severity: low
summary: Story 7.13's AC6 dropped the `"Cost: {amount}"` wrapper from the cost overview's four amount call sites, which were the key's last readers — `grep -rn "stay.costSummary" src/` now returns only the two definitions. The key remains defined in both locales with nothing reading it.
evidence: The story's Project Structure Notes justified keeping the key with "it has other readers", and that premise was false at the time it was written — verified by grep after the change. The key was left in place deliberately rather than removed, because the same note scopes i18n changes out of a visual-only story. Fix is two deleted lines plus a check that no dynamic key construction reaches it; small enough to ride along with the next story that touches `src/i18n`.
operator_decision (2026-08-03): **Left to Tommy.** The new line is English in a German UI, which is a visible inconsistency — but it is consistent with every other string in that channel, so translating one means translating the channel, and that means sending a structured warning shape rather than sentences. Worth doing; not worth blocking a restored backup for.
status: open

- source_spec: `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md`
  summary: The hardcoded-colour guard helper (`HARDCODED_COLOUR` + `stripComments`) is now copy-pasted into four test files, and the two older copies carry a weaker regex than the two this story wrote.
  evidence: Byte-identical in `tripOverviewMapFullPage.test.tsx:36-37` and `tripDayMapFullPage.test.tsx:46-47`; Story 7.13's copies additionally match named colours, `oklch()`/`lab()`/`color-mix()` and use `resolve(__dirname, "..")` instead of the cwd-dependent `resolve(process.cwd(), ...)`. The four should be one exported test helper so a guard improvement reaches every screen instead of only the newest two. Sanctioned at the time by Task 7's "matching the one Stories 7.9 and 7.11 use".

- source_spec: `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md`
  summary: When the cost overview's fetch fails with a non-404 error, the card renders its label, divider and two working tabs above nothing at all — there is no error-state body, only the alert above the card.
  evidence: Pre-existing and untouched by 7.13 (AC9 makes it visual-only), but newly pinned by the error-branch test that story added: every content block is gated on `detail`, which stays null on error, so the tabs remain clickable and switch between two empty views. Fix is either an in-card error body with a retry, or collapsing the card to the alert alone.

- source_spec: `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md`
  summary: The per-month view's totals need not sum to the trip total printed directly beneath them, because `buildMonthlyGroups` filters out every entry with `amountCents <= 0` or a due date shorter than 10 characters while the trip total counts everything.
  evidence: `TripCostOverview.tsx`'s `buildMonthlyGroups` filter is `entry.amountCents > 0 && entry.date.length >= 10`; the trip total comes from the API's `plannedCostTotal`. A trip with an undated or zero-amount cost therefore shows month rows that visibly do not add up to the figure below them, with nothing naming the residual. Pre-existing; 7.13 was forbidden from touching the grouping logic. Fix is a residual row ("not yet scheduled: X") rather than a filter change.

- source_spec: `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md`
  summary: `formatCost` constructs a fresh `Intl.NumberFormat` on every call, and converging the cost overview onto it made that screen the hot path — a 30-day trip formats once per entry, per day row, per month row and per total, on every render and every tab toggle.
  evidence: `travelplan/src/lib/trips/formatCost.ts:17` builds the formatter inside the exported function; the two surviving local copies in `TripTimeline.tsx` and `TripDayView.tsx` memoize only the enclosing closure, not the formatter. Pre-existing, and not a regression — but a module-level `Map` keyed by language is two lines and the natural companion to whichever story folds the last two copies in.

- source_spec: `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md`
  summary: The cost overview's trip total now renders at the same rank as each month group's heading (`cardTitle`, 14.5px/700) while the trip overview figure the user clicked to get there is `metricLg` 30px/900, so the screen's headline number is its least prominent element.
  evidence: `TripCostOverview.tsx`'s trip-total row versus `TripTimeline.tsx:956`, and the accented 21px/900 cost figure at `TripTimeline.tsx:665` that is the entry point to this screen. Rank is unchanged from before the redesign (it was `subtitle1`), so this is pre-existing rather than caused by 7.13, and no AC or mockup covers it — which is why it was not changed on a visual-only story's own judgement. Worth a deliberate decision, and it is on 7.13's operator checklist to look at in a browser.

### DW-149: The Kosten tab is unbounded, so AC9's fixed 1341px figure stops holding at four payment rows

source_spec: `_bmad-output/implementation-artifacts/6-22-activity-dialog-in-tabs.md`
origin: operator browser pass for story 6-22, 2026-08-03
location: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` (the Kosten panel's split-payment rows)
severity: low
summary: Story 6.22's AC9 compares the tallest tab against a fixed 1341px, measured on the empty form with a single payment. Each split-payment row adds ~246px to the Kosten panel, so it passes that figure at four rows and reaches 1634px at five.
evidence: Measured at 390x844 on 2026-08-03: single payment 516px, then 895 / 1141 / 1388 / 1634px at two through five rows. The other three panels sit at 478-513px regardless. AC9's *intent* still holds — the same content before the change would have been ~2080px in one scroll, so the tab still saves ~700px — but its literal wording does not, because the baseline was taken under different content. Not a defect in 6.22: the payment list is unbounded by nature and no grouping fixes that. Worth revisiting only if split payments become common enough to make the Kosten tab its own long scroll; the fix would be a collapsible or paged payment list, which is its own story.
status: open

### DW-150: A user-facing German error reads "gueltigen" instead of "gültigen"

source_spec: `_bmad-output/implementation-artifacts/6-22-activity-dialog-in-tabs.md`
origin: incidental to the operator browser pass for story 6-22, 2026-08-03
location: `travelplan/src/i18n/de.ts` (`trips.plan.costInvalid`)
severity: low
summary: The invalid-amount message on the activity dialog reads "Bitte einen gueltigen nicht-negativen Betrag …" — an ASCII fallback where its two nearest neighbours both write the umlaut.
evidence: Seen on screen during the 6-22 error-path check, then confirmed in the dictionary: `trips.travelSegment.linkInvalid` reads "Bitte einen gültigen http(s)-Link eingeben" and `trips.stay.costInvalid` reads "Bitte einen gültigen Betrag eingeben". Only `trips.plan.costInvalid` diverges. Pre-existing, one character, and the sort of thing a sweep should pick up rather than a story.
status: open


### DW-151: A day's travel-time total counts segments its timeline refuses to draw, and the UI offers no way to delete them

source_spec: `_bmad-output/implementation-artifacts/2-35-import-accepts-a-valid-backup.md`
origin: both review passes on story 2-35, 2026-08-03
location: `travelplan/src/components/features/trips/TripDayView.tsx` (`totalTravelMinutes` vs `segmentsByKey`), `travelplan/src/lib/repositories/travelSegmentRepo.ts` (`buildSegmentTimeline`, `ensureSegmentItemsExist`)
severity: medium
summary: `totalTravelMinutes` sums every travel segment fetched for a day, while the timeline draws only segments whose endpoint pair `buildSegmentTimeline` produced. A segment whose endpoints fall outside that timeline is therefore invisible on the day yet permanently included in its "Fahrzeit" stat, and `ensureSegmentItemsExist` answers `missing` for it — so it cannot be edited or deleted through the UI either.
evidence: `buildSegmentTimeline` offers the *immediately preceding* day's accommodation and nothing further back (`dayIndex: { lt }`, `orderBy` desc, `findFirst`), plus this day's plan items and stay. Any segment outside that set is dropped by `segmentsByKey.get(buildSegmentKey(from, to))` in `renderTravelSegment` but still reduced into `totalTravelMinutes`. Reachable today with no import involved: delete a day sitting between a segment's two endpoints and a drawable distance-1 previous-stay reference silently becomes an undrawable distance-2 one in place. Story 6.23 removed one *producer* of orphaned segments; this is the *consequence* side, which nothing addresses. Story 2.35 knowingly restores such rows rather than dropping them — a restore that discarded them would make the backup differ from what was backed up — so import fidelity is correct and the gap is here. Fix is either to count only drawn segments, or to surface undrawable ones as a removable "orphaned leg" row; both are behaviour changes needing their own story.
status: open

### DW-152: `meta.warnings` is an untranslated English channel rendered under a translated heading

source_spec: `_bmad-output/implementation-artifacts/2-35-import-accepts-a-valid-backup.md`
origin: both review passes on story 2-35, 2026-08-03
location: `travelplan/src/components/features/trips/TripImportDialog.tsx` (`trips.import.warningsHeading` and the list below it), `travelplan/src/lib/repositories/tripRepo.ts` (`skippedTravelSegmentWarnings`)
severity: low
summary: The import dialog's warnings list is server-generated English prose beneath a translated heading, so a German user reads "In diesem Backup fehlt: Skipped 1 travel segment whose start or end point is missing from this backup".
evidence: Pre-existing by construction — every string in `meta.warnings` is written in English by the exporter, and `TripImportDialog`'s own comment justifies leaving the list alone on the grounds that "both lists name archive members, photo ids and file paths, so there is nothing to translate". Story 2.35 added the first entry that rationale does not cover: a count sentence with no identifier in it. It followed the existing precedent deliberately, because AC3 required the existing channel and translating would mean sending a structured warning shape (code + params) instead of strings — which is a second channel, and the one thing AC3 forbids. That structured shape is the actual fix and it is its own story, covering the exporter's warnings at the same time.
status: open

### DW-153: `OK` silently discards staged-but-unuploaded photos on the activity dialog, while the new `✕` asks about them

source_spec: `_bmad-output/implementation-artifacts/6-24-a-calmer-activity-dialog.md`
origin: code review of story 6-24, 2026-08-03
location: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` (`handleSave` at `:1123`, `uploadGalleryImages` at `:1316`, its only call site at `:1965`, and the `PlanFormValues.pendingPhotoCount` comment at `:432`)
severity: medium
summary: Staging photos in `Medien & Links` and pressing `OK` without pressing `Upload` drops the files with no question and no notice. Story 6.24's dirty guard now asks "Änderungen verwerfen?" about those same files on the `✕`, so the dialog warns about data on the exit that was never destructive and stays silent on the one that is.
evidence: `uploadGalleryImages` has exactly one caller — the Media tab's own `Upload` button — and `handleSave` never touches `galleryFiles`; on a successful save it calls `onSaved()`, and `TripDayView.handlePlanDialogSaved` (`TripDayView.tsx:862`) closes the dialog. The loss is pre-existing: `Speichern` behaved identically before 6.24, which only added `pendingPhotoCount` to the fingerprint (correctly — the `✕` does lose them). What is new is the asymmetry. Fixing it means either uploading staged files as part of the save or blocking the save until they are uploaded, both of which are behaviour changes AC9 explicitly forbids, so it cannot land inside 6.24. Note the comment at `:432` asserts the opposite of the code ("`uploadGalleryImages` only runs from a save"); correcting that comment is part of 6.24's review patches, but the behaviour itself belongs here.
status: open

### DW-154: The app-wide focus ring is scoped to `MuiButton`, so every `IconButton` in the app shows nothing under keyboard focus

source_spec: `_bmad-output/implementation-artifacts/6-24-a-calmer-activity-dialog.md`
origin: code review of story 6-24, 2026-08-03
location: `travelplan/src/theme.ts` (`MuiButton.styleOverrides.root`, the `&.Mui-focusVisible` block), against the ~17 `<IconButton` sites in `src/components/`
severity: medium
summary: `theme.ts` defines the app's focus ring inside `MuiButton` only. MUI's `IconButton` is a different component and inherits none of it, and `ButtonBase` ships `outline: 0`, so every icon-only control in the app computes to no visible focus indicator at all. EXPERIENCE.md's Accessibility Floor makes a visible focus state unconditional and DESIGN.md's `icon-button` entry names the ring explicitly ("Hover and focus follow the Accessibility Floor — the app-wide focus ring, never colour alone").
evidence: `grep -n "MuiIconButton\|MuiButtonBase" src/theme.ts` returns nothing, and there is no global CSS focus rule in `src`. Measured against real MUI in jsdom: `getComputedStyle(closeButton).outline` was `0px` before the fix. `TripIcons.tsx:447` is the only site that has ever carried one, and it spells its own out for on-photo chrome. Story 6.24 fixed its own two controls per-site (`DialogShell`'s `✕` and the activity dialog's trash glyph) rather than adding a `MuiIconButton` theme override, because a theme override would have put a ring on sixteen other icon buttons across the app — a visual change on surfaces AC9 says this story does not touch. The correct fix is one `MuiIconButton` (or `MuiButtonBase`) override plus a check that the on-photo chrome, which needs a white ring rather than an ink one, still overrides it. Story 6.25's Task 2 is the natural place: it extracts a shared close control across a dozen dialogs and can carry the ring with it.
status: open

### DW-155: The activity dialog's frame still moves on tab switch for activities with a long description — no static floor can prevent it

source_spec: `_bmad-output/implementation-artifacts/6-24-a-calmer-activity-dialog.md`
origin: code review of story 6-24, 2026-08-03 (browser re-measure)
location: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` (`PLAN_PANEL_MIN_HEIGHT`, `PLAN_PANEL_FLOOR_SX`, applied at the `plan-tabpanel-floor` wrapper)
severity: low
summary: Story 6.24's `minHeight: 475px` floor holds the dialog's edges still for the ordinary case, but the `Was` panel carries the rich-text description and is therefore unbounded — just as `Kosten` is unbounded via split-payment rows (DW-149). For an activity whose description exceeds the floor, switching tabs still resizes the frame, so AC1 is satisfied conditionally rather than unconditionally.
evidence: Measured in Chromium across **18 real activities** on a throwaway DB copy. Natural panel heights: `Was` 361–606px at 1400x1000 and 361–930px at 390x844; `Wann & Wo` 194/406; `Kosten` (single payment) 266/392; `Medien & Links` 315–354 at both. Outcome at 475: **17 of 18 activities hold perfectly still at 1400px** (0.0px swing) and the exception swings 131px (a 606px description panel); at 390px 14 of 18 hold still and the worst case is only **13.3px**, because the taller ones hit MUI's `calc(100% - 64px)` cap and are pinned by it. Against the 167px swing and 84px top-edge displacement the story set out to remove, the ordinary case is fixed and the phone is an order of magnitude better, which is why 475 was kept rather than changed. Raising the floor to cover the 606px outlier costs +131px on every activity and the 930px phone case cannot be covered below the viewport cap; lowering it to the tallest non-`Was` panel (406) would make *more* activities jump. A real fix is a design change rather than a constant: either give the description panel its own bounded scroll region, or accept a taller uniform frame, or drive the floor from the tallest panel of the activity actually open. All three are behaviour changes 6.24's AC9 forbids.
status: open

### DW-156: Eleven dialogs still build their own `<Dialog>` instead of using `DialogShell`, so the `✕` sits 4px higher on them than on the four that do

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: browser pass of story 6-25, 2026-08-04
location: `travelplan/src/components/ui/DialogShell.tsx` (head padding `20px 24px 16px`) against `DialogTitleWithClose` in `travelplan/src/components/ui/DialogCloseButton.tsx` (MUI's `DialogTitle` default padding, `16px 24px`)
severity: low
summary: Story 6.25 put the same close control on every dialog and Task 2 explicitly deferred migrating the eleven non-shell dialogs onto `DialogShell`. The residual difference is vertical: the glyph is 11px from the paper's top edge on the four shell dialogs and 7px on the eleven that build their own, because the two heads carry different top padding. Horizontally they are identical (15px from the right edge on all thirteen measured, at 390px and 1400px alike).
evidence: Measured in Chromium at 390x844 and 1400x1000 on a throwaway DB copy. `insetRight` was **15.0px on every dialog at both widths** — the "same place every time" claim AC1 and Task 7 are about. `insetTop` was 11.0px on the four `DialogShell` consumers (Reise erstellen, Unterkunft, Tagesdetails, Aktivität) and 7.0px on the raw ones measured (Backup importieren, Reise bearbeiten, Reise löschen, Bucket-Liste, Aktivitäten verschieben, anderer Tag, Reiseabschnitt, Tag-Karte, Übersichtskarte). The 4px is the head padding difference and predates this story: the *title text* sits 4px lower in the shell too, so in both shapes the glyph is correctly aligned to its own title's first line — the inconsistency is between two head paddings, not between two glyph placements. Migrating the eleven onto `DialogShell` removes it and is the cleanup Task 2 names as "a worthwhile cleanup and a different story"; it also brings the token-styled `.dialog-head` border and padding to eleven dialogs that currently render MUI defaults, which is a visible change to each and why it cannot ride along on a chrome sweep.
status: open

### DW-157: `TripShareDialog`'s close is a footer button rather than the title-row `✕`, so it is the one dialog outside the system's close pattern

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: story 6-25, 2026-08-04 (recorded exemption)
location: `travelplan/src/components/features/trips/TripShareDialog.tsx` (`:405` the `<Dialog>`, `:620` the `DialogActions`, `:628` the `common.close` button), and `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/mockups/trips-list-share-login.html:585`
severity: low
summary: `DESIGN.md.Components → icon-button → close` says every dialog's dismissal is a 44px `✕` at the top right of its title row. The share dialog's dismissal is a named 44px `Schließen` in its footer instead — one close control, in the wrong place rather than missing or duplicated. Story 6.25 exempted it deliberately; this is the entry that says so.
evidence: Story 6.25's Task 2 instructs "Confirm before adding a second" for this dialog, and a second control is the wrong answer: the dialog would then have two dismissals with the same name. Moving the existing one into the title row is the right answer and costs more than a chrome sweep can carry — the footer holds nothing else, so it goes with the button, and that deletes a bordered `{colors.card-alt}` footer bar that `mockups/trips-list-share-login.html:585` draws and that Story 7.5 designed. Story 6.25's Task 6 scopes the mockup work to `forms-authoring.html` only, so changing a second mockup is outside it. `FullscreenPhotoViewer` is the other exemption and needs no entry: it has no title row at all and its close is already a named 44px control at the top right, in the on-photo chrome DESIGN.md specifies for a glyph over a photo. Pinned by `test/dialogCloseAffordance.test.tsx` ("the two dialogs that already had a close control keep exactly one"), so neither drifts into a second control unnoticed.

status: open

### DW-158: `TripDayView`'s travel-segment add/edit buttons are named "Reise hinzufügen" / "Reise bearbeiten" — the same words as the trip-level actions

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: browser pass of story 6-25, 2026-08-04 (incidental finding)
location: `travelplan/src/components/features/trips/TripDayView.tsx` (the travel-segment row controls between plan items), `travelplan/src/i18n/de.ts` / `en.ts` (`trips.travelSegment.*` labels)
severity: medium
summary: On a day with travel segments, the buttons that add or edit a *leg between two activities* carry the accessible names "Reise hinzufügen" and "Reise bearbeiten" — identical to the trip-level "add a trip" and "edit this trip" actions, one of which is on the same page. A screen-reader user hears the same two names for four different actions and cannot tell which is which; a test has to select by position, which is what surfaced it.
evidence: Enumerated in Chromium at 390px on day 3 of a real trip: `["Menü öffnen", "Weitere Aktionen", "+ Aktivität", "Unterkunft der vorherigen Nacht bearbeiten: …", "", "Reise hinzufügen", "Planpunkt bearbeiten: Ankunft in Auckland", "Reise hinzufügen", "Planpunkt bearbeiten: Mietwagen abholen", "Reise bearbeiten", …]` — "Reise bearbeiten" appears twice on the page (once trip-level, once per segment) and "Reise hinzufügen" three times. `EXPERIENCE.md`'s `icon-button` row requires an accessible name "written per Voice and Tone ('Planpunkt löschen', not 'Löschen')" — naming the object, which these do not: the object is a leg, not the trip. The neighbouring plan-item buttons get it right ("Planpunkt bearbeiten: {title}"). Outside Story 6.25's scope: it is a wording change to keys that story does not touch, on controls that carry no close affordance. Fix is a dictionary change plus the `{from} → {to}` interpolation the plan-item labels already model.
status: open

## Deferred from: code review of 6-25-close-is-a-cross-keeping-is-named (2026-08-04)

### DW-159: The `✕` is disabled during an in-flight write but Escape and the backdrop are not, on the eleven dialogs that build their own `<Dialog>`

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: code review of story 6-25, 2026-08-04
location: `travelplan/src/components/features/trips/TripDeleteDialog.tsx:112`, `TripEditDialog.tsx:337`, `TripImportDialog.tsx:371`, `TripDayTravelSegmentDialog.tsx:599`, `TripBucketListPanel.tsx:633` and `:709` — against `travelplan/src/components/ui/DialogShell.tsx:110-115`
severity: medium
summary: Each of these dialogs passes `disabled={isSubmitting|isDeleting|saving|deleteBusy}` to its `DialogTitleWithClose`, so the glyph correctly refuses a click while a request is in flight — but the same handler reaches `<Dialog onClose>` with no `reason` check, so Escape and a backdrop click walk straight past the guard and close the dialog mid-request. `DialogShell` is the only place the in-flight flag reaches the dismissal gestures, via its `disableDismiss` branch.
evidence: Pre-existing, not introduced here — `git show HEAD:…/TripDeleteDialog.tsx:111` is already `<Dialog open={open} onClose={onClose}>` beside a `disabled={isDeleting}` footer cancel at `:122`. Story 6.25 replaced the footer button with the glyph and carried the `disabled` prop across faithfully, so the asymmetry survived rather than appeared. Recorded because the story's stated invariant — "whatever the shell does, these must match it… true by construction rather than by review" (`DialogShell.tsx:50-53`) — now holds for the glyph's geometry, name, tooltip and focus ring but not for dismissal-during-write, which is the one behaviour where the shell and the eleven still differ. Concrete path: `TripDeleteDialog` → "Reise löschen" → press Escape while the DELETE is in flight → the dialog closes and the caller never learns the outcome. Fix is the same three-line `reason` guard `DialogShell` already carries, applied in `DialogTitleWithClose`'s callers or hoisted into a shared `<Dialog>` wrapper — which is really the deferred shell migration of DW-156.
status: open

### DW-160: The eleven non-shell dialogs have no `aria-labelledby`, so a screen reader announces an unnamed dialog

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: code review of story 6-25, 2026-08-04
location: `travelplan/src/components/ui/DialogCloseButton.tsx:93-105` (`DialogTitleWithClose`) and its eleven call sites — against `travelplan/src/components/ui/DialogShell.tsx:138`
severity: medium
summary: MUI does not wire `DialogTitle` to its `Dialog` automatically. `DialogShell` does it explicitly with `aria-labelledby={titleId}`, and `formPrimitives.test.tsx` asserts `getByRole("dialog")).toHaveAccessibleName("Add stay")` for that path. `DialogTitleWithClose` renders `<Box component="h2">` with no `id`, and none of its eleven call sites sets `aria-labelledby` on the `<Dialog>` — so a screen-reader user entering `TripDeleteDialog`, `TripEditDialog` or any of the four map popups hears an unnamed dialog.
evidence: `grep -rn "aria-labelledby" travelplan/src/components/features/trips travelplan/src/components/ui` returns it on `DialogShell.tsx:138` and `TripShareDialog.tsx:413` only; the other eleven dialogs have none. Pre-existing — the baseline `<DialogTitle>` was not wired either, and MUI v5+ has never done it implicitly. Recorded here because Story 6.25 created `DialogTitleWithClose` as the single place the heading semantics now live: it already moved the `<h2>` role down off the `DialogTitle` so the glyph's name would stop joining the heading's, and adding a generated `id` plus returning it (or accepting one) would close this for all eleven at the same seam, where before it was eleven separate fixes. `dialogCloseAffordance.test.tsx` asserts the glyph's accessible name on the non-shell path but never the dialog's own, which is why the asymmetry shipped as "identical by construction".
status: open

### DW-161: The travel-segment dialog's open snapshot is derived from live props rather than captured at open

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: code review of story 6-25, 2026-08-04
location: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:277-300` (the `useMemo` that replaced `openSnapshotRef`), read by the dirty comparison at `:590-595` and by `handleTransportTypeChange`'s stale-route-restore path
severity: low
summary: Story 6.25 turned the dialog's "what the form opened with" baseline from a ref written inside the open effect into a `useMemo` over the `segment` / `mapsLink` props. The lint reason is sound — a ref read during render is `react-hooks/refs` and a genuine stale-read hazard, since nothing re-renders when a ref changes — but the two are equivalent only while the props stay stable for the dialog's lifetime. If the parent re-supplies `segment` while the dialog is open, the dirty baseline and the restore target both shift under the user, where the ref would have held the values the form actually opened with.
evidence: The `useMemo` is derived from exactly the inputs the open effect keys on, which is what makes seeding and comparing unable to drift apart — that part of the story's reasoning holds. What is untested is the re-supply case: no suite renders this dialog and then changes `segment` while `open` stays true. Today the parent (`TripDayView`) does not re-supply it mid-open, so this is latent rather than live; it becomes reachable the moment the day's data is refetched behind an open dialog (a websocket push, a background `loadDay`, or a sibling edit). Fix is either a `useMemo` keyed on a captured open-generation counter, or a `useState` seeded in the open effect, both of which keep the lint clean while restoring capture-at-open semantics.
status: open

### DW-162: No destructive confirmation is drawn in `forms-authoring.html`, which DESIGN.md names the binding reference for dialog footers

source_spec: `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md`
origin: story 6-25, 2026-08-04 (self-declared in the mockup's own rationale block, confirmed by code review)
location: `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/mockups/forms-authoring.html` (the rationale block, and the `btn-secondary` specimen in the swatch sheet)
severity: low
summary: Story 6.25 made the one-button form footer the rule and the two-button destructive confirmation the carve-out. The mockup now draws the rule correctly, but the carve-out is not drawn anywhere in it — so after this story the two-button footer is the only footer shape in the app that its own binding reference does not contain. The `btn-secondary` specimen was relabelled "Reise behalten" and given a usage constraint ("nur als sichere Hälfte einer zerstörenden Bestätigung"), which is a rule with no drawn instance to check against.
evidence: Recorded by the implementation itself rather than found afterwards — the file's rationale block says so, and the reasoning given is that drawing one from the code would be a transcription rather than a design decision. That is the right call for a chrome story and it is why this is deferred rather than patched. The gap is real all the same: `DESIGN.md` cites this file as binding for dialog footers, and the pair that AC3 exists to protect — "Reise behalten" beside a red contained "Reise löschen", at deliberately near-equal width (measured 139px against 137px) — is the one arrangement a future editor cannot check against a picture. Closing it needs a UX pass that decides the destructive confirmation's layout rather than copying the implementation's.
status: open

## Deferred from: code review of story 5-10 (2026-08-04)

### DW-163: Deleting an account does not invalidate its seven-day session

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/lib/repositories/adminUserRepo.ts:234-270` (`deleteUserForAdmin`), against `travelplan/src/lib/auth/sessionGuard.ts` and `travelplan/src/lib/auth/jwt.ts`
severity: medium
summary: Story 5.10 created the first way to delete an account from the UI. Nothing revokes the deleted account's session JWT, which is valid for seven days, and no route other than the admin ones re-reads the user row. So a deleted user's token keeps passing `requireSession` for up to a week.
evidence: `adminAccess.ts:30-33` handles its own half correctly and says so — a missing row means "not an admin", and the comment names exactly this state as reachable. What it cannot do is speak for the ~30 other routes that call `requireSession` alone. `POST /api/trips` with a deleted user's token would insert a `Trip.userId` pointing at a row that no longer exists, surfacing as a foreign-key 500 rather than a 401. Pre-existing in the sense that this app has never had session revocation — there is no denylist, no session table, no token version column — but unreachable before this story because accounts could not be deleted. Closing it needs a revocation mechanism (a `tokenVersion` column bumped on delete, or a server-side session table), which is a schema change and its own story rather than a patch here.
status: open

### DW-164: The admin role toggle can resurrect a membership another admin just detached

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/components/features/admin/AdminUsersList.tsx:321-337` (`changeMembershipRole`), against `travelplan/src/lib/repositories/adminUserRepo.ts:316-321`
severity: low
summary: `changeMembershipRole` sends `POST …/memberships`, which is an `upsert`, with the target role computed from the locally cached `membership.role`. If the row was detached between the last `load()` and the click, the upsert takes its **create** branch and re-grants trip access that was deliberately revoked — and the UI reports success.
evidence: The sibling `removeTripMembershipForAdmin` guards against exactly this class of staleness, using a guarded `deleteMany` so a concurrent duplicate removal reports `missing` rather than throwing; the role-change path has no equivalent "only if it still exists" condition. Requires two admins acting concurrently, and the installation has one admin today, which is why this is deferred rather than patched. Becomes live the moment a second admin exists — which this story's own AC8a makes a one-click operation. Fix is a distinct role-change operation that updates by the compound key without creating, leaving `upsert` to the attach path that actually wants it.
status: open

### DW-165: `busyUserId` is one slot shared by every row, so two in-flight actions clear each other's spinner

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/components/features/admin/AdminUsersList.tsx:88` (the state) and `:491` (`const busy = busyUserId === user.id`)
severity: low
summary: `busy` is computed per row by comparing against a single `busyUserId`, so a click on row B is not disabled while row A's mutation is still in flight. Whichever request returns first calls `setBusyUserId(null)`, re-enabling the other row's buttons and hiding its spinner while its request is still outstanding; the two `load()` calls then resolve in arbitrary order.
evidence: All four mutation helpers (`setAdminRole`, `changeMembershipRole`, `detach`, and the delete path's own flag) write the same single slot. The consequence is cosmetic and self-healing — both mutations still complete server-side and the final `load()` reconciles — which is why it is deferred. It is worth recording because the same structure is what makes DW-163's sibling finding (the unguarded `fetch` in `mutate`, patched under this story) able to strand the flag permanently: a set of per-row flags, or a `Set` of in-flight ids, removes both classes at once.
status: open

### DW-166: The admin payload is the whole account-and-trip graph, unpaginated, refetched after every mutation

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/lib/repositories/adminUserRepo.ts:51-112` (`listUsersForAdmin`, `listTripsForAdmin`), served by `travelplan/src/app/api/admin/users/route.ts:33-38`
severity: low
summary: `GET /api/admin/users` returns every account with every owned trip and every membership, plus every trip in the installation with its owner's email. No `take`, no `skip`, no pagination. Each of the six mutations then re-reads all of it, and the attach picker is a flat select over every trip that exists.
evidence: The refetch-everything decision is well argued for correctness and documented at `AdminUsersList.tsx:75-79` — half these actions change a row other than the one clicked, so a local splice would show a list that disagrees with the database precisely where being wrong matters. That reasoning is sound and should not be undone. What is missing is any boundary at which the page degrades: combined with no `take`, one role toggle is an O(users × trips) transfer. Harmless at this installation's size (a handful of accounts, one trip) and genuinely not worth solving yet, which is why it is deferred rather than patched. Recorded so that "it refetches everything" is a known property with a known cost rather than a surprise at the first installation with a hundred accounts.
status: open

### DW-167: The admin wire contract is hand-written twice, with the role enums as string literals on both sides

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/components/features/admin/AdminUsersList.tsx:30-49` against `travelplan/src/lib/repositories/adminUserRepo.ts:15-36`
severity: low
summary: `AdminUser`, `AdminMembership` and `AdminTrip` are declared independently on both sides of the fetch, and both hard-code `"OWNER" | "VIEWER" | "ADMIN"` and `"VIEWER" | "CONTRIBUTOR"` rather than importing the generated `UserRole` / `TripMemberRole` that this very story just widened. Renaming `ownedTrips` or adding a fourth role compiles clean on both sides and fails only at runtime.
evidence: This story is itself the proof the enum grows — it added the third `UserRole` member and had to bump `PRISMA_SCHEMA_TAG` to make a stale client notice. The duplication follows 5.8's existing pattern for `RegisteredUsersList`, so it is the house shape rather than a new deviation, and the client genuinely should not import from a repository module. Deferred because the right fix is a shared contract type (a `types/` module both sides import, or the role unions imported from the generated enums) which touches 5.8's surface too and is a small refactor rather than a patch to this story.
status: open

### DW-168: The attach `upsert` has no `P2002` handler where its sibling detach explicitly guards `P2025`

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/lib/repositories/adminUserRepo.ts:316-321` (`setTripMembershipForAdmin`), against `:343-353` (`removeTripMembershipForAdmin`)
severity: low
summary: Two admins attaching the same account to the same trip concurrently can make the upsert's create branch collide on `@@unique([tripId, userId])`. The `PrismaClientKnownRequestError` escapes the repository into the route's bare `catch` and becomes a 500 `server_error`.
evidence: The asymmetry is the finding: `removeTripMembershipForAdmin` documents avoiding exactly this class ("a guarded `deleteMany` rather than `findFirst` then `delete`, so a concurrent duplicate removal reports `missing` instead of throwing Prisma's `P2025`"), and `createUserForAdmin` at `:155-160` catches `P2002` deliberately for the same reason. The attach path is the one of the three that does not. Requires two concurrent admins on the same trip and the same account, which is why it is deferred; the fix is a `P2002` catch returning `{ outcome: "set" }`, since a collision means the row the caller wanted now exists.
status: open

### DW-169: `userId` reaches Prisma unbounded while every id in the request body is capped at 64

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/app/api/admin/users/[userId]/route.ts:37-40` and `:99-102`, `…/[userId]/memberships/route.ts:49-52` and `:115-118`, against `travelplan/src/lib/validation/adminUserSchemas.ts:44`
severity: low
summary: `adminUserSchemas.ts` bounds `tripId` with `z.string().trim().min(1).max(64)` and states the reason in a comment — "these are fixed-length cuids, so an unbounded string only ever reaches Prisma as an oversized query parameter". `userId` comes straight off `context.params` with only an emptiness check and goes into `findUnique` / `upsert` / `deleteMany`.
evidence: Four route handlers, same omission in each. Not an injection risk — Prisma parameterises — so the consequence is only that an arbitrarily long path segment is handed to the driver, which is precisely the consequence the schema comment says the bound exists to prevent. The reasoning is already written down in this story; it is simply unapplied to the one id that does not travel in the body. Deferred rather than patched because the fix wants a shared path-param helper across the four handlers rather than four inline checks, and it touches no behaviour anyone can reach.
status: open

### DW-170: `grant-admin.mjs` picks arbitrarily among the case variants the binary-collated unique index permits

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/scripts/grant-admin.mjs:78-84`
severity: low
summary: SQLite's unique index on `users.email` is binary-collated, so `Foo@x.com` and `foo@x.com` can coexist as two rows. `SELECT id, role FROM users WHERE lower(email) = ?` can match both, and `.get()` returns whichever the query planner yields. The script then promotes one of them and reports success naming the normalised address, with no hint that a second matching account exists.
evidence: The `lower(email)` match is deliberate and correct in intent — the comment explains that an operator types the address however it was written to them, while `normalizedEmailSchema` lowercases everything on the way in. That normalisation is why no such pair exists today: every row was written through the schema. The hazard is only reachable via a row inserted outside the app (a manual `INSERT`, a restored backup from before the normalisation, a future import path). Deferred because it is unreachable through any code path in the tree; recorded because the one-shot production command reporting `Granted ADMIN to x@y` while having promoted a different row than the operator meant is a bad way to find out. Fix is `.all()` plus a refusal when more than one row matches.
status: open

### DW-171: bcrypt runs inside the trip-share transaction, and the extraction moved it out of sight of the call site

source_spec: `_bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md`
origin: code review of story 5-10, 2026-08-04
location: `travelplan/src/lib/repositories/userRepo.ts:44-56` (`createAccountWithTemporaryPassword`), called from `travelplan/src/lib/repositories/tripRepo.ts:2591-2596` inside an interactive transaction
severity: low
summary: The extracted helper is `async` and hashes internally, so the trip-share invite path holds its interactive transaction open across the ~100 ms bcrypt call. Behaviour is preserved exactly from before the refactor — the old inline code hashed in the same place — but the cost is now invisible at the call site.
evidence: The contrast is inside this same story: `register/route.ts:70-72` documents keeping `hashPassword` *outside* its new transaction, because "bcrypt takes ~100ms and holding a SQLite write transaction open across it would serialise every concurrent registration behind it". That reasoning applies verbatim to the trip-share path, which does the opposite — and after the extraction a reader of `tripRepo.ts:2591` sees only a function call with no indication that a 100 ms CPU-bound hash happens inside their transaction. One step from Prisma's 5 s `P2028` interactive-transaction timeout under concurrent invites. Deferred because it is genuinely pre-existing and fixing it means restructuring the caller to hash before opening its transaction, which is a change to Story 5.1's path rather than to this story's.
status: open

## Deferred from: code review of 6-26-accommodation-dialog-in-tabs (2026-08-04)

### DW-172: `STAY_PANEL_MIN_HEIGHT = 300` is unmeasured, and the same diff that introduced it invalidated its arithmetic

source_spec: `_bmad-output/implementation-artifacts/6-26-accommodation-dialog-in-tabs.md`
origin: code review of story 6-26, 2026-08-04
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:203-231`
severity: medium
summary: The constant is arithmetic over the panels' composition rather than a browser measurement, as its own docstring says. Three things are wrong with the arithmetic independently of the missing measurement: (a) the table's own figures put `Medien` at ≈307, above the 300 floor, so the floor stills nothing for the tallest panel — the frame still moves ~7px between that tab and the other three, which is the exact motion AC5 exists to remove; (b) the table assumes a 44px input at 13.5px type, and fix 6.26a in the same commit raises every input to 16px on precisely the touch devices the story targets; (c) the table is desktop-only — at `xs` the basics row is `flexDirection: column`, adding ~79px that appears nowhere in it.
evidence: The review found the arithmetic not merely unverified but internally inconsistent, and declined to guess a second number.
resolution: **Measured and fixed 2026-08-04**, in the Task 7 browser pass, on two stays at 747px and 390x844. `Medien & Links` measured 355.2–358.8 (the comment had estimated ~307) and `Ort & Notizen` reached 399.0 with 102 characters of notes. **The constant is now 400**, chosen because it puts three of the four panels at exactly the floor at both widths — only `Kosten` exceeds it, which AC5 exempts. Re-measured after the change: 400 / 400 / 400 / 762.3, `clipped: false` throughout. The comment's table now carries the measurements. Two things the measurement settled that the desk could not: any width above `sm` reproduces the desktop column, because the dialog is `width={520}`; and the `minHeight`-not-`height` distinction is now proven on screen, since `Kosten` grew to a used height of 467.4px against the old 300px floor rather than clipping.
status: resolved

### DW-173: native constraint validation pre-empts the dialog's own validation whenever the offending field is on the active tab

source_spec: `_bmad-output/implementation-artifacts/6-26-accommodation-dialog-in-tabs.md`
origin: code review of story 6-26, 2026-08-04
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:1583` (`type="url"`), `:1426` and `:1466` (`type="number"`)
severity: medium
summary: With `Medien & Links` selected, an invalid Link value makes the browser block the submit event on the type mismatch, so neither `handleSubmit` nor the `onSubmit` re-run ever executes: no POST, no `aria-invalid`, no inline message, no tab marker, no focus move. In a real browser the user gets a native bubble; in jsdom, nothing at all. `linkRules` and `costRules` can therefore only ever be *seen* from a tab that does not contain their field.
evidence: Both input types predate this story (`git show def8618` has `type="url"` and `type="number"` in the same places), so the pre-emption is genuinely pre-existing rather than introduced. What Story 6.26 changed is the *character* of it: the same invalid value now produces a native browser bubble when its tab is active and the app's own styled `trips.stay.linkInvalid` when it is not, which is a split the tab layout created. Deferred because the honest fix is `noValidate` on the form so the app's validation is authoritative, and that would surface every other native-blocked message in this dialog at once — an app-wide behaviour change well beyond a review patch, and one that wants the same treatment on the sibling dialog.
status: open

### DW-174: the error-focus effect fails open, with no fallback and no diagnostic

source_spec: `_bmad-output/implementation-artifacts/6-26-accommodation-dialog-in-tabs.md`
origin: code review of story 6-26, 2026-08-04
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:414-419`
severity: low
summary: `document.getElementById(pendingErrorFocus.elementId)?.focus()` degrades to no focus change at all when the id resolves to nothing. Two documented cases reach it: a server error naming `checkOutTime` while `stayType === "current"` (only the rendered half of the check-in/check-out pair is mounted), and `stayErrorFocusId(prefix, key, {})` called with an empty errors object from the server path for a row-level `payments` error. AC2's "puts focus on the offending field" silently becomes a no-op.
evidence: Both cases are reasoned about in the source — `stayErrorFocusId`'s docstring calls the unmounted `checkOutTime` outcome "the honest outcome for a field this surface does not show", and the `payments` fallback to `-cost` is stated as correct for a block-level message. So this is a known, deliberate edge rather than an oversight, which is why it is deferred rather than patched. Recorded because the tab is still selected in both cases, so the user is moved to a panel with the caret left wherever it was; focusing the revealed panel or its tab as a fallback would at least keep the caret inside the right section. Applies to `TripDayPlanDialog` too.
status: open

### DW-175: German tab-label fit at 390px is unverified, and the error triangle reflows the label mid-session

source_spec: `_bmad-output/implementation-artifacts/6-26-accommodation-dialog-in-tabs.md`
origin: code review of story 6-26, 2026-08-04
location: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:1239-1289`
severity: low
summary: Four labels share one 390px row at `variant="fullWidth"`, `fontSize: 12`, `px: "6px"`: "Basisdaten", "Zahlung", "Ort & Notizen", "Medien & Links". That set is longer than the activity dialog's "Was", "Wann & Wo", "Kosten", "Medien & Links", which already needed the per-tab padding cut to 6px to fit — and the `sx` was copied verbatim from it, tuned for the shorter strings. Separately, a 13px `WarningTriangleIcon` is appended to a tab when it gains an error, so the labels reflow while the user is looking at them.
evidence: Story 6.26 Task 7 named the label-fit check explicitly; the reflow-on-error observation was new.
resolution: **Label fit measured and fixed 2026-08-04.** The check failed: at 390px each tab is 62.5px wide, leaving ~50px inside the padding, and `Basisdaten` is ~68px as a single unbreakable word — `truncated: true` on both sampled stays, while the other three labels passed *only* because they contain spaces and may wrap. Fixed with a soft hyphen (U+00AD) after `Basis` in the German dictionary, giving the word the same ability to break; re-measured `truncated: false` on all four, `allOnOneRow: true`. Smaller type and reduced padding were both rejected as insufficient (the word is ~18px too wide for either) and because both would have diverged the tab chrome from the sibling dialog, which AC7 forbids.
**Still open: the reflow-on-error half.** When a tab gains its error marker, a 13px `WarningTriangleIcon` plus a 4px gap is appended, leaving roughly 33px for text inside a 62.5px tab. `Basis` alone is ~34px at `fontSize: 12` / `fontWeight: 800`, so the label may truncate again *in the error state specifically* — which is exactly the state AC3 makes appear mid-session. Not measured, because it needs a validation error raised at 390px rather than the clean dialog the pass sampled. Applies to both dialogs.
status: open (label fit resolved; error-state reflow outstanding)

### DW-176: the activity dialog's selected errored tab still loses the warning colour, so the two dialogs' tab chrome now differs by one rule

source_spec: `_bmad-output/implementation-artifacts/6-26-accommodation-dialog-in-tabs.md`
origin: code review of story 6-26, 2026-08-04
location: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1703`
severity: medium
summary: `sx={hasError ? { color: warning.main } : undefined}` puts the marker colour on the tab root at one class of specificity, while MUI's own `textColor="primary"` variant emits `&.Mui-selected { color: palette.primary.main }` at two. The *selected* errored tab therefore renders `primary.main` green instead of `warning.main`, and the warning triangle goes green with it through `currentColor`. Because the error reveal auto-selects the tab that owns the error, the colour channel is missing in precisely the state the user is placed into — leaving the glyph and the accessible name to carry the "not colour alone" requirement by themselves.
evidence: Introduced by Story 6.22 and copied verbatim into Story 6.26, where this review measured it (selected errored tab computed `rgb(75, 99, 88)` = `#4B6358` `primary.main`; an unselected one correctly computed `rgb(138, 90, 43)` = `warning.main`). Story 6.26 AC7 requires "the two dialogs' tab chrome is the same control", so fixing one half and not the other would itself have been a drift.
resolution: **Applied 2026-08-04, same session as the review**, on Tommy's call after the stay half was patched. Both dialogs now carry `{ color: warning.main, "&.Mui-selected": { color: warning.main } }`, so the chrome is identical again and AC7 holds. Pinned in both suites, with the two assertions doing deliberately different jobs: `tripAccommodationDialog.test.tsx` renders real MUI and asserts the **computed** colour — verified to fail with `expected 'rgb(75, 99, 88)' to be 'rgb(138, 90, 43)'` against the single-class version, which is the defect reproduced exactly — while `tripDayPlanDialog.test.tsx` stubs `@mui/material` and re-exposes `sx` as `data-sx`, so it can only assert the override is *present* and says so in its own comment. A computed-colour assertion was attempted there first and returned `rgb(0, 0, 0)` for every element, which is worth knowing before anyone tries again: that suite has no cascade to measure.
status: resolved

## Deferred from: Task 7 browser session for 6-26 (2026-08-04)

### DW-177: every auth form falls back to a native GET submit if JS has not hydrated, putting the password in the URL

source_spec: found during the Story 6.26 Task 7 browser session, not attributable to any story
origin: observed live, 2026-08-04, on `http://…:3099/auth/login`
location: `travelplan/src/app/(auth)/auth/login/page.tsx:175-178`, and the same shape in `register/page.tsx`, `first-login-password/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`
severity: medium
summary: The auth forms are `<Box component="form" onSubmit={handleSubmit(onSubmit)}>` with **no `method` and no `action`**. `handleSubmit` calls `preventDefault`, so the POST-to-JSON path is entirely dependent on React having hydrated. When it has not, the browser performs its default submission — a **GET to the same URL with every field as a query parameter** — so the password travels in the query string. Observed verbatim in a dev server log: `GET /auth/login?email=…&password=…`, twice.
evidence: Reproduced by accident rather than by construction, which is the interesting part. The trigger in this session was Next 16 refusing to serve dev resources cross-origin — the server advertised `localhost` and the browser used `127.0.0.1`, so the bundle was blocked ("Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr"), nothing hydrated, and the form degraded. That specific trigger is dev-only. **The degradation is not:** any failed or slow bundle load in production, with the user pressing Enter before hydration, produces the same GET. The consequences of a password in a URL are the ones that outlive the request — browser history, server and proxy access logs, and the `Referer` header on whatever the page loads next. In this session it landed in a scratch dev log (since redacted) and the operator's browser history; the affected password was reported to Tommy immediately and should be treated as exposed.
suggested fix: `method="post"` on each of the five forms, so the unhydrated fallback is a POST with the fields in a body rather than a URL. The API route would reject it as a non-JSON request, which is a clean failure instead of a silent credential leak. Worth considering alongside it: a `<noscript>` notice, or moving the submit to a server action so the no-JS path is real rather than merely non-damaging. Not fixed here because it is an auth-surface change with its own test surface, unrelated to Story 6.26.
status: open

### DW-178: the rich-text editor registers its `link` extension twice

source_spec: observed during the Story 6.26 Task 7 browser session
origin: observed live, 2026-08-04, on every day-view load
location: the tiptap editor configuration reached from `travelplan/src/components/features/trips/TripDayView.tsx:3223` (`TripDayPlanDialog`'s description editor)
severity: low
summary: Every day-view load logs `[tiptap warn]: Duplicate extension names found: ['link']. This can lead to issues.` The link extension is registered twice — almost certainly once via a `StarterKit`-style bundle that already includes it and once explicitly, to configure it.
evidence: Reproduced on every single page load during the browser pass, on two different days, with a full stack through `resolveExtensions` → `ExtensionManager` → `createEditor`. tiptap's own wording ("can lead to issues") is the reason to record it rather than ignore it: with two registrations the effective configuration is whichever wins, so a deliberate link option can be silently overridden by the bundle's default. Nothing misbehaved visibly during the pass. Unrelated to Story 6.26 — it is the activity dialog's description editor, and the warning predates this story. Fix is to drop the duplicate registration, keeping the configured one, and to check that whatever options were intended are actually in effect afterwards.
status: open

## Deferred from: code review of 5-11-administration-row-rearranged (2026-08-04)

### DW-179: the role select snaps back to the old role while the request is in flight

source_spec: `_bmad-output/implementation-artifacts/5-11-administration-row-rearranged.md`
origin: code review of story 5-11, 2026-08-04
location: `travelplan/src/components/features/admin/AdminUsersList.tsx:891` (`value={membership.role}`), with the mutation at `:430-450`
severity: medium
summary: The select is controlled by server state, and that state only advances when `load()` returns. So picking "Contributor" makes the control show "Viewer" again for the whole round trip, then flip to "Contributor" when the reload lands. On a surface where every action is privileged and irreversible, a control that visibly reverts what was just chosen reads as a rejection rather than as latency.
evidence: Raised independently by two review layers. It is a direct consequence of the re-read-after-mutate strategy Story 5.10 established, which 5.11's Dev Notes explicitly place out of scope ("What is still Story 5.10's, untouched"). Deferred rather than patched for that reason and one more: the fix is optimistic local state per membership, and AC8 says nothing about behaviour changes beyond AC4's guard and AC5's confirmation — adding an optimistic layer is a behaviour change with its own failure mode (what the control shows when the request then fails). Worth doing deliberately, with the rollback path decided, rather than inside a review. The same pattern applies to the grant/revoke toggle, which has no visible value to revert and so shows the problem less.
status: open

### DW-180: every other `MenuItem` in the app sits at 32.3px, because a single-class `minHeight: 44` loses to MUI's `sm` reset

source_spec: measured during the Story 5.11 Task 7 browser pass
origin: measured live, 2026-08-05, at 747x925
location: `travelplan/src/components/features/trips/TripDayView.tsx:505` (`DAY_MENU_ITEM_SX`), and `travelplan/src/components/HeaderMenu.tsx` (its four rows carry no height rule at all)
severity: medium
summary: MUI's `MenuItem` sets `minHeight: 48` and then resets it to `auto` inside a `theme.breakpoints.up('sm')` block. A plain `sx={{ minHeight: 44 }}` is the same one class of specificity as that media rule, so above 600px the later rule in the emotion sheet wins and the item collapses. **Measured: 44px at 390x844 and 32.3px at 747x925 for the identical constant.** The app's 44px target floor is therefore absent from every overflow and header menu on every desktop width.
evidence: Found because Story 5.11's review patch had the bug too — `ROW_MENU_ITEM_SX = { minHeight: 44 }` was written from `DAY_MENU_ITEM_SX` as the precedent, passed at 390px, and was caught only when the browser pass ran the same measurement at 747px. That one is now `{ "&&": { minHeight: 44 } }`, where the doubled selector reaches (0,2,0) and the ordering question disappears. `DAY_MENU_ITEM_SX` is the byte-identical single-class version and predates this story, so it is recorded rather than changed here. `HeaderMenu`'s rows are worse: they set no height at all, so they inherit MUI's base 48 below the breakpoint and its `auto` above it. Measured in the same pass, on the same menu: **48px at 390x844 and 32.3px at 747x925** — including the row Story 5.10 added ("Nutzerverwaltung" / "User administration"), a privileged navigation target that holds the floor on a phone and loses it on every desktop. That pair of numbers is the clearest statement of the mechanism: the bug is invisible at the width most people would think to check. Fix is the `&&` form in both places, plus a measurement above 600px rather than below it, because below the breakpoint the bug is invisible.
status: open

### DW-181: `grep` reports zero matches in `tripRepo.ts`, the repo's largest consumer of `uploadPaths.ts`

source_spec: 8-3-uploaded-media-behind-the-login
origin: dev session, 2026-08-05
location: `travelplan/src/lib/repositories/tripRepo.ts`
severity: low
summary: The file contains **a single raw NUL byte at offset 46830, `tripRepo.ts:1435`**, used as a composite map-key separator — `` `${sortOrder}<NUL>${imageUrl}` `` — written as a literal NUL rather than the `\0` escape. `grep` therefore applies its binary heuristic, prints `Binary file ... matches` at best and **silently reports nothing** when piped or used with `-l`/`-c`. Every ripgrep-style sweep of the codebase misses the single largest consumer of `uploadPaths.ts` — 3 call sites of the two renamed exports, plus the three-layer containment check every path-safety story is told to mirror.
evidence: Found while taking Story 8.3's call-site inventory: a plain `grep -rn "resolvePublicFilePath" src/` returned four hits across three files and omitted `tripRepo.ts` entirely, which would have shipped a half-completed rename that `tsc` happens to catch — but a *prose* or comment sweep, which `tsc` does not check, would have shipped silently wrong. `grep -a` finds them.
  **Diagnosis corrected by Story 8.3's code review, 2026-08-05.** This entry originally guessed the cause was "a mangled character inside a comment or a German string" and recommended locating it with `grep -an '[^\x00-\x7F]'` or `iconv -f utf-8 -t utf-8`. All three were wrong: the character class `[^\x00-\x7F]` **excludes** `\x00` and so cannot match the cause; `iconv` passes cleanly because a NUL *is* valid UTF-8; and the file holds only 6 non-ASCII bytes, none of them the problem. What finds it is a byte scan for `\x00` (`python3 -c "print(open(f,'rb').read().find(b'\x00'))"`), which reports offset 46830.
  Fix is **one character** — escape the separator as `\0` — and is behaviour-preserving, since the runtime value of the key is identical either way. Pre-existing at `3a42ec7`; a source edit was outside Story 8.3's scope, so it is carried here rather than applied.
status: open

## Deferred from: code review of 8-3-uploaded-media-behind-the-login (2026-08-05)

- **`APP_BASE_URL` silently defaults to `http://localhost:3000`.** `src/app/api/auth/password-reset/request/route.ts:53`
  reads it with `?? "http://localhost:3000"`, so on a production host where the variable is unset every
  password-reset email links to localhost and the reset flow is unusable — with no error anywhere, because
  the fallback is a valid URL. Surfaced by Story 8.3's review while auditing the new deployment docs, which
  claimed a closed set of three production variables; the tree reads five (`DATABASE_URL`, `JWT_SECRET`,
  `MEDIA_STORAGE_ROOT`, `APP_BASE_URL`, `OSRM_BASE_URL` — the last has a sane public default and is genuinely
  optional). Pre-existing, not caused by 8.3. The fix is a decision, not a patch: either fail fast in
  production the way `MEDIA_STORAGE_ROOT` now does, or derive the origin from the request. Wants its own story
  alongside Story 8.1's deployment discovery.
  status: open

- **The `/uploads` serve route derives its ETag and `Content-Length` from a `stat` taken before the read
  stream is opened.** `src/app/uploads/[...path]/route.ts:191-199,257,316`. A file replaced or removed between
  the `stat` and the end of the read yields a truncated 200 with a `Content-Length` that lies, surfacing to the
  client as a protocol-level truncation rather than a clean status. Reachable without an attacker: trip import's
  `stashTripUploadDir` renames an entire trip directory aside while a day view is loading twenty images out of
  it, and trip delete `fs.rm`s it. The cheap guards (a `stream.on("error")` handler and an
  `if (request.signal.aborted)` check for the already-aborted case) were patched in 8.3's review; closing the
  race properly means restructuring to `fs.open` → `fstat` → stream from the same descriptor so every derived
  value comes from one open file, which is more than 8.3 should carry.
  status: open

- **`src/lib/repositories/tripRepo.ts:1435` contains a raw NUL byte.** It is used as a composite map-key
  separator — `` `${sortOrder}<NUL>${imageUrl}` `` — written as a literal NUL rather than the `\0` escape, at
  byte offset 46830. Consequence: `grep` applies its binary heuristic and silently reports **zero matches** in
  the repo's single largest consumer of `uploadPaths.ts`, so a rename sweep that greps rather than relying on
  `tsc` will quietly miss this file. `grep -a` works. This is the corrected diagnosis for DW-181, whose original
  entry blamed "a mangled character or a German string" and recommended `grep -an '[^\x00-\x7F]'` — a character
  class that *excludes* `\x00` and therefore cannot match the cause. The file holds only 6 non-ASCII bytes, none
  of them the problem. Fix is one character and behaviour-preserving; pre-existing at `3a42ec7`.
  status: open
