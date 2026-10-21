---
authored_against: 9dfbc0e
---

# Story 8.9: Security Updates for Next.js, Prisma and Tiptap

Status: ready-for-dev

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

- [ ] **Task 1: Baseline** (AC: 1, 5)
  - [ ] Confirm 8.8 is committed and the working tree is clean in `travelplan/` apart from what this story changes.
  - [ ] Save `npm audit --omit=dev --json` to the scratchpad as the "before" picture, and record the finding count (23 on 2026-10-21) in the Debug Log. If new advisories have appeared since then, include them in scope as long as they have a non-major fix.
- [ ] **Task 2: Next.js** (AC: 2)
  - [ ] Set `"next"` and `"eslint-config-next"` to `"16.4.2"` exactly (or the newest 16.4.x patch at dev time, once it is at least about a week old; fall back to `16.3.8` if 16.4 breaks something that 16.3 does not).
  - [ ] Raise `overrides.sharp` from `^0.35.1` to `^0.35.5`. `next@16.4.2` already asks for `^0.35.5`; the override must not pull it below that.
  - [ ] Read the Next 16.3 and 16.4 release notes for breaking or behaviour changes that touch this app: `proxy.ts` (Story 8.2), `instrumentation.ts` (8.3/8.8), route handlers' `params` Promise, `next.config.ts` (`middlewareClientMaxBodySize`, see its comment block), `cookies()`/`headers()`. Note anything relevant in the Completion Notes.
- [ ] **Task 3: Prisma** (AC: 3)
  - [ ] Set `prisma`, `@prisma/client` and `@prisma/adapter-better-sqlite3` to `^7.10.1`. `prisma@7.10.1` pins `mysql2@3.24.4` and `@prisma/config@7.10.1` → `deepmerge-ts@8.0.2`, which clears both findings.
  - [ ] `npx prisma generate`; the regenerated `src/generated/prisma/**` is **tracked in git** and goes into the diff. `npm run check:migrations`. `npx prisma migrate status` against `dev.db` shows nothing pending, and `prisma migrate diff` (schema vs. migrations) shows no drift.
- [ ] **Task 4: Tiptap** (AC: 4)
  - [ ] Raise the three `@tiptap/*` ranges from `^3.0.0` to `^3.32.0` (current latest, 2026-10-13), so the floor itself excludes the vulnerable versions. `@tiptap/pm@3.32.0` requires `prosemirror-view@^1.42.6`.
  - [ ] Confirm with `npm ls @tiptap/core prosemirror-view` that there is **one** version of each (no duplicate `@tiptap/core`, which breaks extensions at runtime).
- [ ] **Task 5: Lockfile and residuals** (AC: 1, 5)
  - [ ] `npm install`, then `npm run audit:check`. For anything left over, first try `npm update <pkg>` within ranges (`fast-uri` is under `@prisma/dev` → `@prisma/streams-local` → `ajv`, with `^3` allowing 3.1.9; `source-map-js` is under `postcss`, with `^1.2.1` allowing 1.2.2). Add an override only as the last resort, with its reason.
  - [ ] Do **not** use `npm audit fix --force`, and do **not** add allowlist entries.
  - [ ] `npm audit signatures`.
- [ ] **Task 6: Verify** (AC: 4, 6)
  - [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
  - [ ] Browser pass under `next start` (with a local `MEDIA_STORAGE_ROOT`; SMTP is not needed outside production): every flow in AC6, plus the editor in AC4 (it lives in `TripDayPlanDialog.tsx`). Note what was checked in the Debug Log.
  - [ ] Write the "after" `npm audit --omit=dev` count (0) and a table of package: before → after in the Completion Notes.
- [ ] **Task 7: Hand-off** (AC: 7)
  - [ ] Completion Notes: the AC7 server steps as commands for Tommy (deploy script, `systemctl is-active TravelPlan`, a `curl` for a signed-in page and for `/uploads/trips/x/y.png` → 401 through the public hostname, `journalctl -u TravelPlan --since …`). The deploy reinstalls `node_modules` (`npm ci`), so it takes longer than usual.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-21: Story created (bmad-create-story) and added to Epic 8 at Tommy's request.
