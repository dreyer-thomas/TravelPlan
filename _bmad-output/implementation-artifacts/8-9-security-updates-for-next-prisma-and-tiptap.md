---
authored_against: 9dfbc0e
baseline_commit: ea96025eb0541a0b5ea19e385d1a33635edd34d6
---

# Story 8.9: Security Updates for Next.js, Prisma and Tiptap

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator of TravelPlan,
I want the production dependencies updated past every published advisory,
so that the app is not running known-exploitable code and the `audit:check` gate is green again.

**FRs covered:** none (security maintenance).
**Depends on:** Story 8.8 **committed first**, so the two diffs stay separate (8.8 adds `nodemailer` to the same `package.json`/lockfile).
**Origin:** Tommy, 2026-10-21. Story 8.8's dev run found `npm run audit:check` red with 23 production findings, none of them from 8.8. Added straight to Epic 8 at Tommy's request, without a separate sprint change proposal.

## Acceptance Criteria

1. **Gate green.** `npm run audit:check` passes with **zero** production findings and **no** new entry in `audit-allowlist.json`. `npm audit signatures` passes.
2. **Next.js.** `next` and `eslint-config-next` move together to the **same exact version**, at least `16.3.8`. The default is `16.4.2`, the current minor, which still gets patches. Both stay exact-pinned as today. The `sharp` override rises to at least `^0.35.5`. The `postcss` override stays unless the update makes it unnecessary; the Completion Notes say which.
3. **Prisma.** `prisma`, `@prisma/client` and `@prisma/adapter-better-sqlite3` all move to the same version, at least `7.10.1`. The generated client in `src/generated/prisma` is regenerated. `npm run check:migrations` passes, and no migration is created (no schema change).
4. **Tiptap.** `@tiptap/react`, `@tiptap/starter-kit` and `@tiptap/extension-link` resolve to one 3.x version, at least `3.30.5`, and `prosemirror-view` resolves to at least `1.42.3`. The rich-text editor still works when checked in a real browser: typing, bold/italic, lists and links, and saving and reloading keep the content.
5. **Transitive findings.** Findings with no direct parent to bump (`fast-uri`, `source-map-js`) are fixed by refreshing the lockfile within the declared ranges. An `overrides` entry is added only if that is not enough, with its reason in the Completion Notes.
6. **Verification.** `npm test`, `npm run typecheck`, `npm run lint` (no new errors) and `npm run build` pass. The app runs under `next start`, and the main flows work in a browser: sign-in, trip overview, day view with images, the print sheet, uploading and viewing a photo, the document packet download, and the password-reset request.
7. **Production (Tommy, manual).** Deployed with the deploy script, which runs `npm ci` because the lockfile changed, then `prisma migrate deploy` and the build. Afterwards the service is active, a signed-in page answers 200 through the public hostname, `/uploads/…` still answers 401 to an anonymous request, and the journal shows no new errors.

**Out of scope:** major-version upgrades no advisory requires; dev-only findings (the gate is `--omit=dev`); update automation (Dependabot/Renovate); disabling `/_next/image` (see *Questions*).

## Tasks / Subtasks

- [x] **Task 1: Baseline** (AC: 1, 5)
  - [x] Confirm 8.8 is committed and the working tree is clean in `travelplan/` apart from what this story changes.
  - [x] Save `npm audit --omit=dev --json` to the scratchpad as the "before" picture, and record the finding count (23 on 2026-10-21) in the Debug Log. If new advisories have appeared since then, include them in scope as long as they have a non-major fix.
- [x] **Task 2: Next.js** (AC: 2)
  - [x] Set `"next"` and `"eslint-config-next"` to `"16.4.2"` exactly (or the newest 16.4.x patch at dev time, once it is at least about a week old; fall back to `16.3.8` if 16.4 breaks something that 16.3 does not).
  - [x] Raise `overrides.sharp` from `^0.35.1` to `^0.35.5`. `next@16.4.2` already asks for `^0.35.5`; the override must not pull it below that.
  - [x] Read the Next 16.3 and 16.4 release notes for breaking or behaviour changes that touch this app: `proxy.ts` (Story 8.2), `instrumentation.ts` (8.3/8.8), route handlers' `params` Promise, `next.config.ts` (`middlewareClientMaxBodySize`, see its comment block), `cookies()`/`headers()`. Note anything relevant in the Completion Notes.
- [x] **Task 3: Prisma** (AC: 3)
  - [x] Set `prisma`, `@prisma/client` and `@prisma/adapter-better-sqlite3` to `^7.10.1`. `prisma@7.10.1` pins `mysql2@3.24.4` and `@prisma/config@7.10.1` → `deepmerge-ts@8.0.2`, which clears both findings.
  - [x] `npx prisma generate`; the regenerated `src/generated/prisma/**` is **tracked in git** and goes into the diff. `npm run check:migrations`. `npx prisma migrate status` against `dev.db` shows nothing pending, and `prisma migrate diff` (schema vs. migrations) shows no drift. **Not met, pre-existing:** the diff exits 2 on `cost_payments`/`trip_members`, byte-identical at the baseline on Prisma 7.9.1 (Debug Log); tracked as DW-407.
- [x] **Task 4: Tiptap** (AC: 4)
  - [x] Raise the three `@tiptap/*` ranges from `^3.0.0` to `^3.32.0` (current latest, 2026-10-13), so the floor itself excludes the vulnerable versions. `@tiptap/pm@3.32.0` requires `prosemirror-view@^1.42.6`.
  - [x] Confirm with `npm ls @tiptap/core prosemirror-view` that there is **one** version of each (no duplicate `@tiptap/core`, which breaks extensions at runtime).
- [x] **Task 5: Lockfile and residuals** (AC: 1, 5)
  - [x] `npm install`, then `npm run audit:check`. For anything left over, first try `npm update <pkg>` within ranges (`fast-uri` is under `@prisma/dev` → `@prisma/streams-local` → `ajv`, with `^3` allowing 3.1.9; `source-map-js` is under `postcss`, with `^1.2.1` allowing 1.2.2). Add an override only as the last resort, with its reason.
  - [x] Do **not** use `npm audit fix --force`, and do **not** add allowlist entries.
  - [x] `npm audit signatures`.
- [x] **Task 6: Verify** (AC: 4, 6)
  - [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
  - [x] Browser pass under `next start` (with a local `MEDIA_STORAGE_ROOT`; SMTP is not needed outside production): every flow in AC6, plus the editor in AC4 (it lives in `TripDayPlanDialog.tsx`). Note what was checked in the Debug Log.
  - [x] Write the "after" `npm audit --omit=dev` count (0) and a table of package: before → after in the Completion Notes.
- [x] **Task 7: Hand-off** (AC: 7)
  - [x] Completion Notes: the AC7 server steps as commands for Tommy (deploy script, `systemctl is-active TravelPlan`, a `curl` for a signed-in page and for `/uploads/trips/x/y.png` → 401 through the public hostname, `journalctl -u TravelPlan --since …`). The deploy reinstalls `node_modules` (`npm ci`), so it takes longer than usual.

### Review Findings

Code review 2026-10-21 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). The auditor found no AC violation. The production audit is 0, and all resolved versions match the Completion Notes. 16 findings were dismissed as noise or already covered by the notes.

- [x] [Review][Decision] 8-8 close-out is mixed into the 8-9 diff — `sprint-status.yaml` flips 8-8 review → done and the 8-8 story file is modified. Decision resolved 2026-10-21 by Tommy: option 2, both ride in the 8-9 commit. No change.
- [x] [Review][Patch] Production env sample as the starting point for a new server (Decision resolved 2026-10-21 by Tommy, from the finding that the root `.env` is tracked with `SENDGRID_API_KEY`/`VITE_JWT_SECRET`) — new `deploy/travelplan.env.example`: all 13 variables plus `NODE_ENV`, the reference non-secret values, empty secrets, a comment per variable, and both ways to use it (inline `Environment=` today, or `EnvironmentFile=` outside the tree, `root:root` 600, per DW-331). Empty optional values were checked against the readers and fall back to their defaults. Referenced from `deploy/README.md` and `docs/deployment-configuration.md`. Root `.gitignore` ignores `deploy/*.env`. [deploy/travelplan.env.example]
- [x] [Review][Patch] Root `.env` and `.env.example` untracked (Tommy, 2026-10-21) — both from the initial commit, with legacy `VITE_JWT_SECRET`/`SENDGRID_*` that no code reads; `git rm --cached`, files kept on disk, root `.gitignore` ignores both. **The SendGrid key stays in git history: Tommy revokes it in SendGrid.** [.env, .env.example, .gitignore]
- [x] [Review][Patch] AC7 hand-off names the deploy script as a placeholder, and does not warn about a failed deploy after `npm ci` — use `/usr/local/bin/deploy-travelplan.sh` (deployment-guide.md:188). Add: if the deploy fails after `npm ci`, the ERR trap restarts the old 16.2.12 `.next` against the new `node_modules`, so a green `is-active` proves nothing; fix the cause and re-run (see DW-405). [_bmad-output/implementation-artifacts/8-9-security-updates-for-next-prisma-and-tiptap.md (Completion Notes, AC7)]
- [x] [Review][Patch] Task 3's "`prisma migrate diff` shows no drift" is ticked although it exits 2 — annotate the subtask as not met, pre-existing (byte-identical at baseline), and point it at DW-407. [_bmad-output/implementation-artifacts/8-9-security-updates-for-next-prisma-and-tiptap.md:45]
- [x] [Review][Defer] Deploy ERR trap after `npm ci` restarts the previous build against the new dependency tree [deploy/deploy-travelplan.sh:37,58-61] — deferred, pre-existing (DW-405)
- [x] [Review][Defer] Deploy script comment cites `next-server.js:1065-1079`, now 1098–1108 on 16.4.2 [deploy/deploy-travelplan.sh:75] — deferred, pre-existing (DW-406)
- [x] [Review][Defer] Schema-vs-migrations drift on `cost_payments`/`trip_members` [travelplan/prisma/migrations/] — deferred, pre-existing (DW-407)
- [x] [Review][Defer] Dev-only audit findings (13, 2 critical) installed on the server [travelplan/package.json devDependencies] — deferred, pre-existing (DW-408)
- [x] [Review][Defer] `@types/node` and `undici-types` now count as production via `mysql2`'s peer [travelplan/package-lock.json] — deferred, upstream (DW-409)
- [x] [Review][Defer] Turbopack "whole project traced" warnings 1 → 11 [travelplan/next.config.ts] — deferred, pre-existing condition (DW-410)
- [x] [Review][Defer] `/_next/image` is still served although the app never uses it (story Question 2) [travelplan/next.config.ts] — deferred, hardening follow-up (DW-411)

## Dev Notes

### The findings on 2026-10-21 and their fix path

| Package (installed) | Comes from | Worst | Fixed by |
|---|---|---|---|
| `next@16.2.12` | direct, exact pin | **critical** (RCE in Image Optimization with AVIF; RCE in `next/og`; RCE on Windows hosts), high SSRF in Image Optimization, cache poisoning, info disclosure | `next@16.3.8`+ (default 16.4.2) |
| `sharp@0.35.3` | `next` optional dep + `overrides: ^0.35.1` | high (libheif, librsvg) | `0.35.5`, via override `^0.35.5` |
| `source-map-js@1.2.1` | `next` → `postcss@8.5.23` (and `prisma` → `c12` → `magicast`) | high (DoS) | lockfile refresh → `1.2.2` |
| `mysql2@3.15.3` | `prisma` (exact dep, unused by SQLite but shipped) | high | `prisma@7.10.1` (`mysql2@3.24.4`) |
| `deepmerge-ts@7.1.5` | `prisma` → `@prisma/config` | high | `prisma@7.10.1` (`deepmerge-ts@8.0.2`) |
| `fast-uri@3.1.5` | `prisma` → `@prisma/dev` → `@prisma/streams-local` → `ajv@8.20.0` | high (SSRF/host confusion) | lockfile refresh → `3.1.9` |
| `@tiptap/core` and 25 `@tiptap/*` (`3.29.1`) | `@tiptap/react`, `starter-kit`, `extension-link` | high (ReDoS), moderate (`__proto__` attrs) | `3.30.5`+ (target 3.32.0) |
| `prosemirror-view@1.42.2` | `@tiptap/pm` | high (paste XSS) | `1.42.3`+ (3.32.0 requires `^1.42.6`) |

**Exposure, for context only (this does not lower the priority):** the app never imports `next/image` or `next/og` (it renders plain `<img>`; see the eslint comment in `TripDayPrintDocument.tsx`). But Next serves `/_next/image` by default whether or not the app uses it, so the Image Optimization advisories cannot be ruled out. The server is Linux, so the Windows-only RCE does not apply. The Tiptap paste XSS concerns the note editor, which only signed-in owners and contributors use.

### What this touches

- `travelplan/package.json`: `next`, `eslint-config-next` (exact), the three Prisma packages, the three Tiptap packages, `overrides.sharp`. Nothing else. `react`/`react-dom` stay at `19.2.3` unless Next 16.4 requires a newer one (check `peerDependencies`; if it does, bump the minimum and say so).
- `travelplan/package-lock.json`: a large diff, expected.
- `travelplan/src/generated/prisma/**`: regenerated and tracked. Do not hand-edit it.
- No source changes are expected. If a Next 16.3/16.4 change forces one, keep it minimal and name it in the Completion Notes.

### Traps

1. **`npm audit fix --force`** would take major bumps (and may touch dev deps freely). Do not use it; set the versions by hand.
2. **`--ignore-scripts` in CI.** The Security Audit workflow runs `npm ci --ignore-scripts`, so `postinstall` (`prisma generate`) does not run there. The generated client must be committed, which it already is.
3. **Duplicate `@tiptap/core`** after a partial bump causes runtime "duplicate extension" or schema errors that unit tests do not see (the editor is mocked in `test/setup.ts`). Check with `npm ls` and in the browser.
4. **The `sharp` override** can pin `sharp` below what `next` asks for. That is exactly why 0.35.3 is installed today. Raise it.
5. **The `next` exact pin and `eslint-config-next`** must match, or lint fails in confusing ways.
6. **The prisma `postinstall`** needs `DATABASE_URL` (from `.env`) locally. If `npm install` complains, check `.env`, not the package.
7. **The deploy runs `npm ci` on the server under the invoking shell's `node`** (deployment-guide "Deployment process", known defect: `PATH` is not pinned). Tommy should run it from a shell where `node -v` is 24.

### What must not regress

The whole suite (3578 tests on 2026-10-21, after 8.8), `proxy.test.ts` (matcher config unchanged), the media-root and SMTP boot checks (`instrumentation.test.ts`, `uploadPaths.test.ts`), `next build` without SMTP variables, the migration-immutability check.

### Project Structure Notes

Dependency and lockfile change only. No schema, UI, i18n or env change. No docs change is required, unless a Next upgrade changes something the deployment docs describe (e.g. Node engine requirements). Check `next@16.4.2`'s `engines.node` against the server's Node 24.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.9]
- `npm audit --omit=dev --json` and `npm view` output, 2026-10-21 (Story 8.8 dev session)
- [Source: travelplan/scripts/audit-check.mjs, travelplan/audit-allowlist.json (empty by policy)]
- [Source: .github/workflows/security-audit.yml (`npm ci --ignore-scripts`, `npm audit signatures`, `audit:check`)]
- [Source: docs/deployment-guide.md#Deployment process (deploy script runs `npm ci` only when the lockfile hash changes)]
- [Source: _bmad-output/implementation-artifacts/8-1-node-24-runtime-upgrade.md (last coordinated runtime/dependency change, server procedure)]

### Questions (defaults applied; confirm before or during dev)

1. **Target `next@16.4.2` (default) or the smaller step to `16.3.8`?** 16.4 is the minor that will keep getting patches.
2. **Turn off `/_next/image` (`images: { unoptimized: true }`)?** The app does not use it, and that would remove the attack surface of the whole class of Image Optimization advisories. That is a hardening change, not an update, so it is out of scope here; it could be a small follow-up story.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story, interactive, 2026-10-21.

### Debug Log References

- **Before (Task 1):** 8.8 committed (`8638dc2`, plus `ea96025`); `travelplan/` clean. `npm audit --omit=dev` = **35 vulnerable packages** (1 critical, 9 high, 25 moderate), the same package set as the Dev Notes table (the story's "23" counted differently; nothing new). Registry checked: no newer patch than `next@16.4.2` (2026-10-15), `prisma@7.10.1`, `@tiptap/*@3.32.0`. Prisma's `latest` tag is now `8.0.0-rc.24`, and `^7.10.1` keeps us on 7.x.
- **Tiptap install trap:** `npm install` failed with ERESOLVE, because all 28 locked `@tiptap/*` at 3.29.1 carry exact `@tiptap/pm` peer pins, and `npm update` across the whole family failed the same way. Fix (no `--force`, no `--legacy-peer-deps`): I deleted only the 41 `@tiptap/*` and `prosemirror-*` entries from the lockfile and from `node_modules`, then ran `npm install`, which re-resolved that subtree within the declared ranges. Everything else stayed locked.
- **Residuals (Task 5):** after the install, only `fast-uri@3.1.5` (6 advisories) and `source-map-js@1.2.1` were left. `npm update fast-uri source-map-js` moved them to 3.1.9 and 1.2.2 within range. **No override was needed.**
- **Drift check:** `prisma migrate diff --from-migrations … --to-schema … --exit-code` exits **2** ("Redefined table `cost_payments`/`trip_members`"). This is **pre-existing**: a throwaway worktree at the baseline with Prisma 7.9.1 produced the **byte-identical** 40-line script. It is not caused by this story, and I did not touch it. Column sets match on both sides, so it looks like how those two tables' constraints were migrated historically. `prisma migrate status`: "Database schema is up to date". `check:migrations` passes. 31 migrations, none added.
- **Build warnings:** the baseline build (16.2.12, same worktree) shows **1** Turbopack warning ("whole project traced", at `next.config.ts`). 16.4.2 shows **11** of the same kind, one at each `fs` call site behind it (`tripRepo.ts` ×2, `importPhotos.ts` ×6, `uploadPaths.ts` ×3). The underlying condition is the same; only the reporting is finer. It has no effect on our in-tree `next start` deploy (it only bloats an NFT/standalone trace). Not fixed here.
- **Browser pass (Task 6), under `next start` on 16.4.2,** against APFS clones of `dev.db` and `var/` in the scratchpad, with a throwaway password set **in the clone only**. The real `prisma/dev.db` hash was verified unchanged afterwards. The browser was system Chrome, headless, driven by `playwright-core` installed in the scratchpad (not in the project). SMTP settings were dummies pointing at closed port 127.0.0.1:2599, because under `next start` `NODE_ENV=production` and the 8.8 boot check requires SMTP (the story's "SMTP not needed" does not hold for `next start`). Both boot checks passed. Results:
  - sign-in → `/trips` ✓
  - trip overview: 43/43 images ✓
  - day view (Day 18, 12 item photos): 18/18 images. 3 lazy images below the fold load once scrolled into view, and all answer 200 ✓
  - print sheet: 9/9 images ✓
  - document packet (day with 3 docs): 200 `application/pdf`, 2,244,479 bytes, `%PDF-` ✓
  - signed-in `/uploads/…`: 200 `image/png`, `private, max-age=0, must-revalidate, no-transform` ✓
  - anonymous `/uploads/<real file>` and `/uploads/trips/x/y.png`: **401** ✓
  - password-reset request: `POST /api/auth/password-reset/request` → 200, and the send failed into the log as `ECONNREFUSED 127.0.0.1:2599` (fire-and-forget, as designed) ✓
  - **Editor (AC4):** typing, Bold, Italic, bullet list (2 items) and Link (via the toolbar prompt) produce `<strong>fett</strong> <em>kursiv</em>`, a two-item `<ul>` and `<a href="https://example.org/probe-8-9">Linktext</a>`. OK → PATCH 200 → reload → reopen gives the same HTML ✓. Repeated 4× ✓. 0 page/console errors.
  - **Photo upload:** "Medien & Links" → Hochladen → POST `/day-plan-items/images` 200, gallery 4 → 5, the new image renders, and its URL answers 200 after a reload ✓
  - **Harness notes:** my first two editor runs typed faster than the toolbar returns focus and produced mangled text; with 250 ms pauses it was correct every time. One earlier run on that mangled, piled-up content left the dialog open after OK; I could not reproduce it in 3 further saves on piled-up content with diagnostics in place, so I recorded it as seen once and not reproduced. Playwright's `request` client got 401 on a real upload because the session cookie is `Secure` and that client doesn't send it over `http`; Chrome itself treats 127.0.0.1 as secure, and the in-page fetch got 200.
- The server was stopped by its PID, both temporary worktrees were removed and pruned (the existing `TravelPlan-wt-*` and `.kilo` worktrees were untouched), and nothing is left listening on 3109.

### Completion Notes List

- **AC1 ✓** `npm run audit:check`: "No vulnerabilities in the production dependency tree, and nothing suppressed." `audit-allowlist.json` unchanged (empty). `npm audit signatures`: 776 verified registry signatures, 212 attestations. After: `npm audit --omit=dev` = **0**.
- **AC2 ✓** `next` and `eslint-config-next` are both exact `16.4.2`. `overrides.sharp` `^0.35.5` → `sharp@0.35.5`. **The `postcss` override was removed as unnecessary:** it existed because `next@16.2.12` pinned `postcss@8.4.31`, and `next@16.4.2` pins `8.5.23` exactly (above the old floor `^8.5.18`). I removed it, reinstalled, and confirmed that **0 lockfile package entries changed**. `next@16.4.2` engines `>=20.9.0` (server is on Node 24) and React peer `^19.0.0`, so `react`/`react-dom` stay at 19.2.3.
- **Next 16.3/16.4 release notes, items touching this app:**
  - proxy/middleware matchers in Turbopack were aligned with webpack (`proxy.test.ts` 19/19 green, matcher config unchanged)
  - instrumentation is now awaited in `RouteModule.prepare` (our boot checks still run and pass)
  - `proxyClientMaxBodySize` is still in the 16.4.2 schema, and the build prints it
  - non-document requests to unknown paths now get a plain-text 404
  - strict route matching is on by default (no route broke in build or browser)
  - image optimization re-enables AVIF and applies `maximumResponseBody` to local images (we don't use `next/image`; `/_next/image` is still served, see Question 2)
  - nothing on `cookies()`/`headers()` or route `params` that affects us.

  **No source change was needed.**
- **AC3 ✓** All three Prisma packages are on `^7.10.1` → 7.10.1. `prisma generate` ran via postinstall. The tracked `src/generated/prisma` diff is two files: version/engine hash strings, plus a new `schema: null` key per model in the runtime data model (generator output shape; no field changes). `check:migrations` passes, no migration was created, and `migrate status` is up to date. Drift report pre-existing, see the Debug Log.
- **AC4 ✓** `@tiptap/react`, `@tiptap/starter-kit` and `@tiptap/extension-link` are on `^3.32.0` → one version, 3.32.0, for every `@tiptap/*` (`@tiptap/core` appears 20× in `npm ls`, all 3.32.0, no duplicate). `prosemirror-view@1.42.6` and `prosemirror-model@1.25.12` are single versions. Editor checked in a real browser (Debug Log).
- **AC5 ✓** `fast-uri` 3.1.5 → 3.1.9 and `source-map-js` 1.2.1 → 1.2.2 by `npm update` within range. **No override added.**
- **AC6 ✓**
  - `npm test`: 223 files / **3582 tests** passed, the same count as 8.8's final run.
  - `npm run typecheck`: clean.
  - `npm run lint`: 0 errors / **80 warnings** (= baseline).
  - `npm run build`: passes, on Next.js 16.4.2 (Turbopack), with `ƒ Proxy (Middleware)` in the route table and without SMTP variables.
  - All AC6 browser flows pass (Debug Log).
- **Package versions, before → after:**

  | Package | Before | After |
  |---|---|---|
  | next / eslint-config-next / @next/* | 16.2.12 | 16.4.2 |
  | sharp (+ @img/sharp-*) | 0.35.3 (libvips 1.3.2) | 0.35.5 (libvips 1.3.4) |
  | prisma, @prisma/client, @prisma/adapter-better-sqlite3 (+ @prisma/*) | 7.9.1 | 7.10.1 |
  | mysql2 | 3.15.3 | 3.24.4 |
  | deepmerge-ts | 7.1.5 | 8.0.2 |
  | fast-uri | 3.1.5 | 3.1.9 |
  | source-map-js | 1.2.1 | 1.2.2 |
  | @tiptap/* (28 packages) | 3.29.1 | 3.32.0 |
  | prosemirror-view | 1.42.2 | 1.42.6 |
  | postcss | 8.5.23 | 8.5.23 (override removed, unchanged) |

  98 lockfile version changes in total. The rest are in-range bumps those parents pulled in: `@swc/helpers`, `exsolve`, `lru.min`, `ohash`, `pkg-types`, `rc9`, `readdirp`, `fastq`(dev). Added: `sql-escaper`, `confbox`, `@eslint-community/eslint-utils`, `eslint-visitor-keys`. Removed with the new `mysql2`: `denque`, `seq-queue`, `sqlstring`.
- **Open for follow-up, not in scope:**
  - (a) **Dev-only tree:** 13 findings (2 critical: `vitest`/`tinypool`, with a fix only in `vitest@5`, a major bump; high: `vite`, `undici`, `js-yaml`, `brace-expansion`, plus the `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob`/`micromatch`/`braces` chain, for which npm only offers a downgrade to `eslint-config-next@14`). Per DW-329 the server installs dev dependencies, so these are on disk in production even though they never run there. Candidate for a separate story or DW entry.
  - (b) The pre-existing `migrate diff` drift on `cost_payments`/`trip_members`. Candidate DW entry.
  - (c) The Turbopack whole-project-trace warnings (11 call sites).
  - (d) Question 2 of the story (`images: { unoptimized: true }`) is still open.
- **AC7: for Tommy (manual, on the server).** Run from a shell where `node -v` prints v24 (Trap 7):

  ```bash
  node -v                                   # must be v24.x
  /usr/local/bin/deploy-travelplan.sh       # as app, not via sudo (it sudos itself); lockfile changed -> runs npm ci (slower than usual), then prisma migrate deploy (nothing pending) and npm run build
  systemctl is-active TravelPlan            # active
  curl -s -o /dev/null -w '%{http_code}\n' -b 'session=<a valid session cookie>' https://plan.dreyer-travels.de/trips     # 200
  curl -s -o /dev/null -w '%{http_code}\n' https://plan.dreyer-travels.de/uploads/trips/x/y.png                         # 401
  journalctl -u TravelPlan --since "<deploy start time>" --no-pager | grep -iE 'error|warn'                              # nothing new
  ```

  Optionally, in the browser, open one day with photos and one note in the editor.

  **If the deploy fails after `npm ci`** (in `prisma generate`, `migrate deploy` or the build), the script's ERR trap restarts the service on the **old** 16.2.12 `.next` against the **new** `node_modules`. `systemctl is-active` may then say `active` although the server is mismatched, so don't trust it. Read the error, fix the cause and run the deploy script again; it rebuilds `.next` from scratch. If it can't be fixed right away, `git revert` the 8-9 commit and deploy again, which runs `npm ci` back to the old tree (DW-405).

### File List

- `travelplan/package.json`: `next`, `eslint-config-next` → `16.4.2` (exact); `prisma`, `@prisma/client`, `@prisma/adapter-better-sqlite3` → `^7.10.1`; `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link` → `^3.32.0`; `overrides.sharp` → `^0.35.5`; `overrides.postcss` removed
- `travelplan/package-lock.json`: regenerated
- `travelplan/src/generated/prisma/internal/class.ts`: regenerated (Prisma 7.10.1)
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts`: regenerated (Prisma 7.10.1)
- `_bmad-output/implementation-artifacts/8-9-security-updates-for-next-prisma-and-tiptap.md`: this record
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: status

### Change Log

- 2026-10-21: Story created (bmad-create-story) and added to Epic 8 at Tommy's request.
- 2026-10-21: Implemented (bmad-dev-story). Next 16.4.2, sharp 0.35.5, Prisma 7.10.1, Tiptap 3.32.0 / prosemirror-view 1.42.6, fast-uri 3.1.9 and source-map-js 1.2.2 via lockfile refresh; `postcss` override dropped as redundant. Production audit 35 → 0, no allowlist entry, no source change. Status → review.
- 2026-10-21: Code review (bmad-code-review). No AC violation. Patches: AC7 hand-off (real script path, recovery note for a failed deploy after `npm ci`), Task 3 drift annotated; per Tommy a production env template `deploy/travelplan.env.example` and the root `.env`/`.env.example` untracked. DW-405..DW-411 deferred. Status → done; AC7 (production deploy) still pending with Tommy.
