---
title: 'Eliminate npm Vulnerabilities and Add Security Audit Gate'
type: 'chore'
created: '2026-07-27'
status: 'done'
review_loop_iteration: 1
context: []
baseline_commit: '535ffa66615daa7759b2bec69b722a234f10a579'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `travelplan` has 34 `npm audit` findings (1 low, 11 moderate, 20 high, 2 critical) from stale dependencies, and nothing prevents the count from creeping back up on future changes.

**Approach:** Bump `next`/`vitest` to versions that resolve the vast majority of findings without crossing into breaking majors (learned the hard way earlier today — a blind full-major-bump attempt broke build/lint/tests and was reverted), add narrow `overrides` for the rest, gate production-dependency vulnerabilities at 0 via a new GitHub Actions workflow on every push/PR to `main`, and explicitly document the one finding that cannot be fixed without breaking the lint toolchain.

## Boundaries & Constraints

**Always:** `npm audit --omit=dev` must report 0 vulnerabilities. `npm run build`, `npm run lint`, and `npm run test` must all exit 0 (lint: zero errors; warnings are fine) after any dependency or config change in this spec.

**Ask First:** Any change that touches `typescript`, `@mui/material`, `@tiptap/*`, `react`, or `react-dom` major versions — out of scope; bumping these earlier today broke the build (TS7/Next.js incompatibility) and MUI's test DOM shape.

**Never:** Force `brace-expansion` or `minimatch` overrides to chase the devDependency-only ESLint-toolchain finding — tried three ways (blanket override, scoped override, ESLint 9→10 bump); all three either crash `eslint`'s config loader or silently change ignore-pattern matching semantics. Do not refactor the 22 `react-hooks/set-state-in-effect` sites inline — deferred as a separate, properly-scoped story per human decision.

</frozen-after-approval>

## Code Map

- `travelplan/package.json` -- dependency version bumps, `overrides` (trimmed to load-bearing only), new `audit:check` script
- `travelplan/package-lock.json` -- regenerated lockfile
- `travelplan/eslint.config.mjs` -- `react-hooks/set-state-in-effect` downgraded to warn, scoped to exactly the 13 pre-existing offending files
- `travelplan/src/components/features/trips/TripDayView.tsx` -- fix the one confirmed real bug (`react-hooks/immutability`, stale `confirmOverwrite` flag on day transfer)
- `.github/workflows/migration-guard.yml` -- existing workflow, used as the structural template for the new one
- `.github/workflows/security-audit.yml` (new) -- CI gate
- `_bmad-output/implementation-artifacts/deferred-work.md` -- log deferred react-hooks sites + documented vulnerability exception

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/package.json` -- bump `next`/`eslint-config-next` 16.1.6→16.2.12, `vitest`/`@vitest/coverage-v8` ^2.1.9→^3.2.7; add `overrides`: `postcss` ^8.5.18, `sharp` ^0.35.1 (verified load-bearing — removing them regresses `npm audit --omit=dev` from 0 to 3); add script `"audit:check": "npm audit --omit=dev --audit-level=low"` -- resolves 33/34 findings. `valibot`/`find-my-way`/`esbuild` overrides originally added but removed after verifying they're now redundant: `prisma` 7.9.0→7.9.1 upstream already carries patched `valibot`/`find-my-way`, and `vite@7` already carries patched `esbuild`
- [x] `travelplan/package-lock.json` -- regenerate via `npm install` -- lock the resolved tree
- [x] `travelplan/eslint.config.mjs` -- add a `files`-scoped rules block setting `react-hooks/set-state-in-effect` to `"warn"` for exactly the 13 offending files -- the `next` bump enables this rule as an error tree-wide; scoping (not a blanket downgrade) keeps it at `error` for all other/future code
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- reorder `orderedDays`/`transferTargetOptions`/`selectedTransferTargetDay`/`transferNeedsOverwriteWarning` above `handleSubmitTransfer`, add `transferNeedsOverwriteWarning` to its `useCallback` dependency array -- fixes a real stale-closure bug (day-transfer could submit a stale `confirmOverwrite` flag), confirmed independently by two review passes; renegotiated out of the original deferral (see Spec Change Log)
- [x] `.github/workflows/security-audit.yml` -- new workflow mirroring `migration-guard.yml`'s structure (checkout, `actions/setup-node@v4` node 20, `npm`-cached, working-directory `travelplan`), plus `permissions: contents: read` and PR trigger `types: [opened, synchronize, reopened, ready_for_review]`; runs `npm ci` then `npm run audit:check`; triggers on `pull_request` and `push` to `main`/`master` -- blocks any PR/push that reintroduces a production vulnerability
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append a new dated section: (a) the 22 `react-hooks/set-state-in-effect` sites by file (13 files, concentrated in `TripDayView.tsx`), noting most are already-guarded async-fetch patterns the new rule flags regardless of guard, plus a few genuine dialog-reset anti-patterns needing a `key`-based remount; (b) the `brace-expansion`/`minimatch@3.1.5` finding (GHSA-mh99-v99m-4gvg, high, devDependency-only, required directly by ESLint 9 core and `eslint-config-next`'s bundled plugins, no patched 1.x release exists, blocked on upstream `eslint-config-next` shipping an ESLint-10-compatible `eslint-plugin-react`) -- keeps both exceptions tracked instead of silently dropped

**Acceptance Criteria:**
- Given the updated `package.json`/lockfile, when `npm audit --omit=dev` runs, then it reports 0 vulnerabilities.
- Given the same tree, when `npm run build`, `npm run lint`, and `npm run test` run, then all three exit 0.
- Given a PR that reintroduces a vulnerable production dependency, when `.github/workflows/security-audit.yml` runs, then the `audit:check` step fails and blocks merge.
- Given the full (dev-inclusive) `npm audit`, then the only remaining finding is the documented `brace-expansion`/`minimatch@3.1.5` one, recorded in `deferred-work.md`.
- Given a "move" day-transfer where the target day's plan-item list changes without `transferMode`/`transferTargetDayId` changing, when the transfer is submitted, then `confirmOverwrite` reflects the current `transferTargetOptions`, not a stale render's value.

## Spec Change Log

**2026-07-27 — intent_gap loopback:** Blind Hunter and Edge Case Hunter independently identified that `react-hooks/immutability` at `TripDayView.tsx:682` is a confirmed real stale-closure bug (`transferNeedsOverwriteWarning` missing from `handleSubmitTransfer`'s `useCallback` dependency array — a "move" day-transfer could submit a stale overwrite-confirmation flag), not a false positive like the 22 `set-state-in-effect` sites. The original `Never` clause deferred this alongside the others. Human renegotiated: fix this one site now. Amended: removed `react-hooks/immutability` from the `Never` clause and from scope-exclusion in Code Map/Tasks; added a Code Map entry and an Execution task for the `TripDayView.tsx` fix; added an acceptance criterion for it. `react-hooks/set-state-in-effect` (the 22 mostly-false-positive sites) remains deferred as originally decided — unchanged. Known-bad state avoided: shipping a known, documented, low-effort-to-fix data-integrity bug behind a blanket lint downgrade. KEEP: the `set-state-in-effect` deferral reasoning and file list are unchanged and still correct.

## Design Notes

The gate scopes to `--omit=dev` deliberately: the one remaining finding lives exclusively in ESLint's own dependency chain (never ships, never processes attacker-controlled input), and forcing it to 0 requires breaking the lint toolchain outright (verified empirically, not assumed). Gating on production dependencies is the meaningful, sustainable target; the dev-only exception is tracked, not ignored.

`vitest` targets `3.2.7`, not npm's own suggested `4.1.10` — 3.2.7 already resolves to `vite@^7`, clearing the `esbuild` advisory, at roughly half the breaking-change surface of jumping straight to `vitest@4`.

`overrides` were pared down after adversarial review challenged them: three of the original five (`valibot`, `find-my-way`, `esbuild`) turned out to be redundant once verified against a clean install — upstream (`prisma` patch release, `vite@7`'s own tree) had already caught up. Only `postcss`/`sharp` are load-bearing, confirmed by removing them and watching `npm audit --omit=dev` regress from 0 to 3.

## Verification

**Commands:**
- `cd travelplan && rm -rf node_modules package-lock.json && npm install` -- expected: installs clean, no `EBADENGINE`/peer errors beyond pre-existing Node-version warnings
- `npm audit --omit=dev` -- expected: `found 0 vulnerabilities`
- `npm run build && npm run lint && npm run test` -- expected: all exit 0

## Suggested Review Order

**Dependency remediation**

- Entry point: version bumps that clear 33/34 findings without crossing a breaking major.
  [`package.json:32`](../../travelplan/package.json#L32)

- Overrides trimmed to the two actually load-bearing ones after adversarial review disproved the other three.
  [`package.json:54`](../../travelplan/package.json#L54)

- New gate script, scoped to production dependencies only.
  [`package.json:11`](../../travelplan/package.json#L11)

**Real bug fix (renegotiated out of the original deferral)**

- Stale-closure fix: `transferNeedsOverwriteWarning` added to the callback's dependency array so a changed transfer target isn't silently ignored.
  [`TripDayView.tsx:732`](../../travelplan/src/components/features/trips/TripDayView.tsx#L732)

- Declaration reordered above its first use to satisfy both the lint rule and the actual data dependency.
  [`TripDayView.tsx:674`](../../travelplan/src/components/features/trips/TripDayView.tsx#L674)

**CI gate**

- Least-privilege token scope for a security-hardening workflow.
  [`security-audit.yml:15`](../../.github/workflows/security-audit.yml#L15)

- Draft→ready-for-review PRs now retrigger the check (the default `pull_request` types silently skip this transition).
  [`security-audit.yml:9`](../../.github/workflows/security-audit.yml#L9)

**Lint scoping**

- `react-hooks/set-state-in-effect` downgraded only for the 13 pre-existing offending files, not tree-wide — new code still fails at error.
  [`eslint.config.mjs:21`](../../travelplan/eslint.config.mjs#L21)

**Tracking**

- 22 deferred lint sites and the one unfixable dev-only vulnerability, documented with rationale.
  [`deferred-work.md:6`](deferred-work.md#L6)
