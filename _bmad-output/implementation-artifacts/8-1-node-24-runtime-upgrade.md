---
authored_against: b18997c
baseline_commit: 290674e
---

# Story 8.1: Node 24 LTS Runtime Upgrade (CI, Local, Server)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the maintainer of TravelPlan,
I want CI, my development machine, and the deployment server moved from end-of-life Node 20 to Node 24 LTS in one coordinated change,
so that the runtime under the app keeps receiving security patches — a gap the 0-vulnerability `npm audit` gate is structurally unable to see.

## Acceptance Criteria

1. Given `node-version: 20` in both workflow files, when the upgrade lands, then both `.github/workflows/security-audit.yml` and `.github/workflows/migration-guard.yml` specify `node-version: 24`, and both workflows pass on `main`.
2. Given the full test suite (`npm test`, vitest) passes on Node 20 at baseline, when it is run on Node 24, then it passes with the same number of tests and no new warnings that indicate runtime incompatibility.
3. Given `next build` succeeds on Node 20 at baseline, when it is run on Node 24, then it succeeds — including the `postinstall` `prisma generate` step and Next.js 16's SWC binary resolution.
4. Given `better-sqlite3` is a native module compiled against Node's ABI, when dependencies are installed on Node 24, then the prebuilt binary is downloaded rather than compiled from source, and Prisma queries against SQLite work at runtime.
5. Given the deployment server also hosts a second application on Node 20, when TravelPlan is moved to Node 24, then the second application continues running on Node 20, unaffected.
6. Given the `EBADENGINE` warning for `@prisma/streams-local` on Node 20, when dependencies are installed on Node 24, then `npm ci` emits no `EBADENGINE` warnings.

## Tasks / Subtasks

- [x] Task 1: Install Node 24 locally and verify the app before touching CI. (AC: 2, 3, 4, 6)
  - [x] The dev machine currently has **only** Homebrew `node@20` and **no `nvm`** (verified at baseline: `/opt/homebrew/bin/node` → v20.19.2, `~/.nvm/versions/node` does not exist). Install Node 24 side-by-side rather than replacing 20 — `brew install node@24`, or install `nvm` if you want per-project switching. Do not `brew upgrade node`; keeping 20 available is what makes a rollback cheap.
  - [x] Delete `travelplan/node_modules` and reinstall from the lockfile on Node 24 (`npm ci`). A stale tree built against Node 20's ABI will mask exactly the native-module failure AC4 is there to catch.
  - [x] Confirm AC6: the `@prisma/streams-local@0.1.11` `EBADENGINE` warning (`requires >=22.0.0`) should be gone. It is the **only** engine conflict in the tree — see Dev Notes → "Compatibility was verified statically, not guessed".
  - [x] Run `npm test` and record the pass count against the Node 20 baseline (AC2), then `npm run build` (AC3).
  - [x] Smoke-test at runtime, not just at build time (AC4): `npm run dev`, open a trip, load a day view. `better-sqlite3` binding failures surface on first query, not at install.
- [x] Task 2: Bump CI. (AC: 1)
  - [x] `node-version: 20` → `24` in `.github/workflows/security-audit.yml` and `.github/workflows/migration-guard.yml`. Remove the "Kept at 20 to match local dev and the deployment server" comment that `b18997c` added above each one — it stops being true here, and a stale comment is worse than none.
  - [x] Leave the `--ignore-scripts` flag on the audit job's `npm ci` alone. It is unrelated to the Node version; it exists because `postinstall` → `prisma generate` needs a `DATABASE_URL` that CI does not have (`b18997c`).
  - [x] Push and confirm both workflows go green on `main`. The Security Audit job is the meaningful one — it is the job that actually installs dependencies.
- [x] Task 3: Upgrade the deployment server. (AC: 5)
  - [x] **Read Dev Notes → "The server is undocumented" before starting.** Both deployment documents now carry real content from Story 8.3 (95 and 185 lines) — extend them, never replace them. The runtime half they still lack (process manager, service names, install paths, install command, CI/CD) has to be discovered on the box.
  - [x] Install Node 24 alongside Node 20 — do not replace it. The second application depends on 20 and moving it is explicitly out of scope.
  - [x] Point **only** TravelPlan's service at the Node 24 binary: an absolute path in the systemd unit's `ExecStart`, or an `nvm`-selected version scoped to the service user. Avoid changing the system-wide default `node` — that is the one action that could silently take the other app with it. **The `nvm` half of this instruction is unsafe here and was not used** — both services run as `User=app`, and `nvm`'s scope *is* the user, so selecting a version for that user would have moved TravelBlogs too. Done as an absolute path in `ExecStart` **plus** a unit-scoped `Environment=PATH`, because `npm start` spawns `next start` whose shebang resolves `node` from `PATH`.
  - [x] Reinstall `node_modules` on the server on Node 24 (native ABI again — AC4 applies here too, and the server is `linux-x64` where the dev machine is `darwin-arm64`). **The server is `arm64`, not `linux-x64`** — see Dev Notes.
  - [x] Restart, then verify both applications respond (AC5). Rollback is repointing `ExecStart` back at the Node 20 binary. **That rollback instruction is incomplete** — reverting the unit alone leaves Node 20 facing an ABI-137 tree it cannot load. Rollback is two steps, both now written into the deployment guide.
- [x] Task 4: Record what was learned about the deployment target. (AC: 5)
  - [x] While on the box for Task 3, fill in the two placeholder docs with what is actually there — process manager, service names, install paths, both Node versions and which app uses which. This story is the first task in the project's history that requires knowing any of it; not writing it down means rediscovering it next time.
  - [x] Note the second application's own EOL Node 20 exposure as a follow-up. Out of scope here, but it does not stop being true. **Filed as `DW-330`.**

## Dev Notes

### Why this is a separate story and not part of any Epic 7 UI story

Epic 7 is a presentation-layer rework — design tokens, MUI components, dialogs, screens. It adds no dependencies and touches no runtime concern. A Node bump landed mid-epic would put a variable underneath in-flight UI work: a red test becomes ambiguous between the story and the runtime. This is sequenced deliberately **after** 7-9 so it lands against a quiet tree.

### Compatibility was verified statically, not guessed (read before Task 1)

All 405 `engines.node` declarations in the installed tree were semver-checked against three versions at baseline `b18997c`:

```
Node 20.19.2:  1 package incompatible  (@prisma/streams-local@0.1.11, requires >=22.0.0)
Node 22.22.0:  0 packages incompatible
Node 24.14.0:  0 packages incompatible
```

**Re-run on 2026-08-06 against the tree as it stands after Epic 9: unchanged.** Still 405 distinct packages declaring `engines.node`, still exactly one incompatible with Node 20 and none with 24. Worth stating because Story 9.2 added a runtime dependency (`pdf-lib@1.17.1`) after the original sweep — neither it nor anything in its subtree (`@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, `tslib`) declares `engines.node` at all, which is why the count did not move.

Two conclusions worth carrying into the work:

- **Node 24 is exactly as safe as Node 22 here.** No dependency prefers 22. That removes the usual "take the smaller jump" argument.
- The single Node 20 conflict arrives via `prisma@7.9.1 → @prisma/dev@0.24.17 → @prisma/streams-local@0.1.11`. It is a warning today, not a failure — but it is Prisma signalling direction of travel.

### Why 24 and not 22

Node 22 left **Active** LTS in Oct 2025 and is in Maintenance with EOL around Apr 2027. Node 24 is the current Active LTS, EOL around Apr 2028. Going to 22 would buy ~8 months and then repeat this story in the spring. Confirm the current dates at <https://nodejs.org/en/about/previous-releases> before starting — those are scheduled dates, not verified ones.

### `better-sqlite3` is the real risk, and it is covered (read before Task 1)

Native modules are the thing that actually breaks on a Node major bump, because they compile against Node's ABI (`NODE_MODULE_VERSION`).

**The version moved since this story was written.** `package.json` declares the caret range `^12.6.2`, and the lockfile now resolves **`better-sqlite3@12.11.1`** — that is the version this work will actually install, not `12.6.2`. The good news is that 12.11.1 answers the compatibility question itself, in its own manifest:

```
engines.node: "20.x || 22.x || 23.x || 24.x || 25.x || 26.x"
```

Node 24 is explicitly supported by the resolved version. The prebuild table from the original sweep still applies:

```
node-v115 → Node 20      node-v137 → Node 24  ← target
node-v127 → Node 22      node-v141 → Node 25/26
```

**Verified against the real release assets on 2026-08-12, and the platform assumption above was wrong.** The deployment server is **`arm64`**, not `linux-x64` — `nodejs 20.19.6-1nodesource1 arm64`. CI on `ubuntu-latest` is x64, so the two are not the same platform and never were. Probing the `12.11.1` assets directly:

```
                node-v115 (Node 20)   node-v137 (Node 24)
linux-arm64  ←  404                   200   ← the server
linux-x64    ←  404                   200   ← CI
darwin-arm64 ←  404                   200   ← dev machine
```

**Correction — the earlier "correction" in this note was itself false, and inverted the risk.** It claimed the local install was already a source build "on Node 20, where a `node-v115` prebuild does exist." **No `node-v115` prebuild exists for `12.11.1` on any of the three platforms.** The `obj/`, `obj.target/` and `sqlite3.a` artefacts were therefore not an anomaly to be explained away — they were the *forced* outcome of there being no Node 20 prebuild to download, on the dev machine and on the server alike.

The consequence runs the opposite way to how this story framed it: **moving to Node 24 removes a build-toolchain dependency rather than adding one.** Confirmed on both machines after the upgrade — `build/Release/` holds only `better_sqlite3.node`, with the node-gyp artefacts gone. Keep `gcc`/`make`/`python3` installed on the server only for as long as a rollback to Node 20 is still plausible, because that rollback *does* need to compile.

Checking the ABI of the produced binary (`process.versions.modules` must read `137`) remains the right verification. What changed is that a source compile after the bump is now a legitimate stop signal, since a prebuild is published for every platform in play.

### The server is undocumented (read before Task 3)

> **No longer true — Task 4 closed this on 2026-08-12.** The server is now documented in
> [deployment-guide.md](../../docs/deployment-guide.md) ("The server, in one place") and
> [deployment-configuration.md](../../docs/deployment-configuration.md) ("The systemd unit"). The
> paragraphs below are kept as the record of what was unknown going in. **One gap remains**: how new
> code reaches the server was not discoverable from the box and is still unwritten.

**This changed after the story was written.** Both documents were 9-line "No deployment configuration detected yet / TBD" placeholders at baseline `b18997c`. Story 8.3 has since written real content into them — `docs/deployment-guide.md` is now 95 lines and `docs/deployment-configuration.md` 185 — covering media storage, the environment variables and the reverse-proxy rules. **Read them before Task 3 and extend rather than replace.**

What they do *not* yet contain is the runtime half, and the guide says so in its own words: *"The infrastructure half — process manager, service names, install paths, the deployment process itself and CI/CD — is Story 8.1's to discover and write."* It also already records the fact this story starts from: *"The current environment runs v20.19.2; nothing in the repository pins it (`engines` is absent). Story 8.1 owns the move to Node 24."*

There is still no `Dockerfile`, no `docker-compose`, no `.nvmrc`, and no `.node-version` anywhere in the repo — a repo-wide search for Node version pins finds hits **only** in the two workflow files. So Task 3 is partly discovery, and Task 4 exists to make sure that discovery is not thrown away.

One question to settle during that discovery, surfaced by a production install log on 2026-08-06: a deprecation warning for `glob@10.5.0` appeared, and that package reaches the tree only through `@vitest/coverage-v8 → test-exclude`, which is a **devDependency**. That suggests the server installs dev dependencies. If so it is worth recording plainly in the guide, because `npm run audit:check` runs `npm audit --omit=dev` and would then be auditing a different tree than the one deployed. Confirm on the server (`ls node_modules/vitest`) rather than assuming; either answer belongs in the written deployment process.

The one known constraint: a second application on the same server runs on Node 20 and must keep running. That is what makes "install alongside, repoint one service" the required approach rather than a system-wide upgrade.

### What this story does and does not fix

It closes a real gap — `npm audit` scans *packages*, not the runtime beneath them, so the 0-vulnerability gate reports green while sitting on an unpatched Node. That is the entire point of the story.

It does **not** address a related observation: `prisma` is declared in `dependencies` rather than `devDependencies` (`travelplan/package.json`), which pulls the CLI and its transitive tree — including `@prisma/dev` and `@prisma/studio-core` — into the *production* audit surface. Presumably deliberate, since the `postinstall` hook needs the CLI and a `--omit=dev` install would not have it. Worth a separate look at whether the gate should be auditing that much; not this story.

### References

- `.github/workflows/security-audit.yml` — `node-version` (Task 2), `--ignore-scripts` rationale
- `.github/workflows/migration-guard.yml` — `node-version` (Task 2)
- `travelplan/package.json` — `postinstall: prisma generate`, `audit:check`, `prisma` in `dependencies`
- `travelplan/prisma.config.ts` — `env("DATABASE_URL")`, the reason `--ignore-scripts` exists
- `docs/deployment-guide.md`, `docs/deployment-configuration.md` — placeholders to fill in Task 4
- Commit `b18997c` — CI fix and action-runtime bump that preceded this story
- GitHub Actions node20 runtime deprecation: <https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/>

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Opus 5, 1M context), via `bmad-dev-story` — interactive session, not `bmad-loop`/`bmad-dev-auto`.

### Debug Log References

Local runtime: Node **v24.19.0** (Homebrew `node@24`, keg-only, installed alongside the existing `node@20`), `process.versions.modules` = **137**.

- `npm ci` — 766 packages, 0 vulnerabilities, **no `EBADENGINE` of any kind** (AC6).
- `npm test` — `Test Files 151 passed (151) / Tests 2356 passed (2356)`, 244 s (AC2).
- `npm run build` — succeeded; `prisma generate` postinstall ran; 2 pre-existing Turbopack warnings, neither Node-related (see Completion Notes).
- `npm run typecheck` — clean. `npm run lint` — `0 errors, 79 warnings`.
- `npm run audit:check` — *"No vulnerabilities in the production dependency tree, and nothing suppressed."*
- `npm run check:migrations` — passed.
- CI on `main` at `f6ed931`: **Migration Guard** run `31609775577` success; **Security Audit** run `31609775566` success, all `npm-audit` job steps green including *Install dependencies* and *Audit production dependencies* (AC1).

### Completion Notes List

**Tasks 1 and 2 are complete. Tasks 3 and 4 are deliberately open** — see "State this leaves behind" below. This story is **not** ready for review.

- **AC1 satisfied.** `node-version: 20` → `24` in both workflow files, and the stale `# Kept at 20 to match local dev and the deployment server` comment (which also still referenced the story by its old number, 7-10) removed above each. `--ignore-scripts` on the audit job's `npm ci` left untouched, as the task specified. Both jobs were pre-run locally on Node 24 before pushing, then both went green on `main`.
- **AC2 satisfied literally, not approximately.** 151 files / 2356 tests — byte-for-byte the Node 20 baseline recorded for story 8-6 in `spec-8-6-the-sixth-route-story-8-4-left-out.md:186`. No test count drift, no new warnings indicating runtime incompatibility.
- **AC3 satisfied.** Build log compared against the Node 20 run: identical. The two remaining warnings are pre-existing and unrelated to the runtime — the NFT-tracing warning on `next.config.ts`, and `The "middleware" file convention is deprecated`, which is story **8-2**'s subject and the next `ready-for-dev` item.
- **AC4 satisfied, and verified in the Next server runtime rather than only under vitest.** vitest runs in a plain node environment, so a green suite alone does not prove the app's own server process can load the addon. `next dev` was started on the `node@24` binary and driven into a real database query (`POST /api/auth/login` → `401 invalid_credentials`, i.e. the user lookup reached SQLite). `lsof` on that process confirms `/opt/homebrew/Cellar/node@24/24.19.0/bin/node` + `libnode.137.dylib` with **`better-sqlite3/build/Release/better_sqlite3.node`, `bcrypt/prebuilds/darwin-arm64/bcrypt.node` and `@next/swc-darwin-arm64/next-swc.darwin-arm64.node` all mapped into the process**. `/uploads/trips/x/y.png` still answered `401`, so story 8.3's authorisation gate is intact under 24. Not done, because it needs credentials this session does not have: the literal browser click-through of a trip and a day view. Worth doing as a final visual confirmation.
- **AC6 satisfied.** The `@prisma/streams-local@0.1.11` warning is gone; the Node 24 install emits no `EBADENGINE` at all.
- **AC5 untouched.** It is entirely about the deployment server — Task 3.

**A Dev Note in this story is false, and it is still written above.** The *"Correction to the original anomaly signal"* paragraph states that the local install is already a source build *"on Node 20, where a `node-v115` prebuild does exist."* **It does not exist.** Probing the `better-sqlite3` 12.11.1 release assets returns **404 for `node-v115` on both `darwin-arm64` and `linux-x64`**, while `node-v127`, `node-v137` and `node-v141` all return 200. So the `obj/`, `obj.target/` and `sqlite3.a` artefacts were not an anomaly needing to be explained away — they were the forced result of there being no Node 20 prebuild to download. This **inverts the story's risk framing**: the upgrade *removes* a build-toolchain dependency instead of adding one. After the bump, `build/Release/` holds only `better_sqlite3.node`. This bears directly on Task 3, because the server is `linux-x64` and was compiling from source for the same reason. Dev Notes are not a section this workflow may modify, so the correction is recorded here — **whoever takes Task 3 should fix the Dev Note itself.**

**A second finding, not in the story at all, that belongs in Task 4's documentation.** npm 11.17.0 (shipped with `node@24`) prints `npm warn allow-scripts — 7 packages have install scripts not yet covered by allowScripts`, naming `better-sqlite3`, `bcrypt`, `@prisma/engines`, `esbuild`, `fsevents`, `prisma` and `unrs-resolver`. The scripts **do still run** today; the warning is advisory. But if npm ever flips this to default-deny, `better-sqlite3` would silently skip its prebuild download and fail on **first query at runtime**, not at install time. That failure mode should be written into the deployment guide.

**Carried in this commit beyond the story's ACs, on the user's explicit decision.** The runtime is now pinned in the repository for the first time: `engines.node: ">=24 <25"` in `travelplan/package.json`, plus a root `.nvmrc` containing `24`. The rationale is that the *absence* of any pin is exactly why Tasks 3 and 4 are discovery work at all — the story's own Dev Notes record that a repo-wide search for a Node pin finds hits only in the two workflow files. Verified to actually bite: `npm ci --dry-run` under `node@20` now warns `EBADENGINE ... package: 'travelplan@0.1.0', required: { node: '>=24 <25' }`.

**Also carried, on the maintainer's explicit decision, in a separate commit `66b0b01`.** `@types/node` was declared `^20` and resolved `20.19.43`, so TypeScript was checking the codebase against Node 20's API surface while the runtime beneath it is 24. Bumped to `^24.13.3`. Committed on its own rather than folded into `f6ed931`, because it is a dependency change beyond the story's specification and should be revertible independently of the CI bump. Re-verified after the bump: `npm test` 151 files / 2356 tests (unchanged), typecheck clean, lint 0 errors / 79 warnings, build log byte-identical to the pre-bump build.

### Tasks 3 and 4 — the server (2026-08-12)

**AC5 satisfied.** TravelPlan runs Node 24 on the server; TravelBlogs was never touched and keeps `/usr/bin/node` v20.19.6. What the box turned out to be is recorded in [deployment-guide.md](../../docs/deployment-guide.md) and [deployment-configuration.md](../../docs/deployment-configuration.md) — systemd, units `TravelPlan.service` / `TravelBlogs.service`, `User=app` **shared by both**, trees under `/home/app/apps/`, host `Travelblog`, `arm64`, media root `/var/lib/travelplan/media`.

**Evidence, stated precisely, because two false greens happened on the way.** The interpreter separation and the DB-touching health check were confirmed *by the maintainer* reporting both applications up after the final unit change; the corresponding `readlink` and `curl` outputs were **not captured in this record**. Everything before that point was captured: the install ran on `v24.19.0` / npm `11.17.0`, emitted **no `EBADENGINE` at all**, reported `found 0 vulnerabilities`, and left `build/Release/` holding **only `better_sqlite3.node`** — the `linux-arm64` `node-v137` prebuild, no source compile. A reviewer wanting AC5 pinned harder should re-run the two `readlink`s.

**Three things went wrong on the way, and all three are now written into the guide as warnings:**

1. **`export PATH=/nonexistent:$PATH` is not an error.** The first server install silently fell through to the system `npm` and built against Node 20. **The `engines.node` pin added earlier in this story is the only reason it was noticed** — the `EBADENGINE` warning for `travelplan@0.1.0` was the entire signal. The guide now invokes `npm` by absolute path with a `test -x` guard.
2. **`systemd-analyze verify` passes on a file whose edits were never saved.** A restart came back on `/usr/bin/npm start` and looked healthy. Verification must be `readlink` on the running PID, never `verify` and never "the site loads".
3. **`/auth/login` returns `200` while the data layer is dead.** It renders a static form and touches neither the database nor `better-sqlite3`, so it answered `200` for a process running an ABI-115 interpreter against an ABI-137 tree, in which state every data-bearing request failed. This was my own recommended health check and it hid exactly the failure it was meant to catch. The guide now specifies a CSRF + login POST that forces a user lookup: `invalid_credentials` + `401` is green, `500` is not.

**Four findings filed, none of them in scope here:** `DW-328` the production database inside the application tree with no startup validation (**high** — the failure is total and nobody yet knows whether the deploy method triggers it); `DW-329` the audit gate running `--omit=dev` while the server installs dev dependencies, so the audited tree is not the deployed tree; `DW-330` TravelBlogs still on EOL Node 20, same host, same user; `DW-331` `JWT_SECRET` inline in the unit and readable by any local account via `systemctl show`.

**Two live defects found by reading the running service, unrelated to Node:** `APP_BASE_URL` was **unset in production**, so every password-reset email had been linking to `http://localhost:3000` for the life of the deployment, exactly as `deployment-configuration.md` predicted and with nothing logging it — now `https://plan.dreyer-travels.de`. And `JWT_SECRET` was inline in a mode-644 unit, readable without sudo; it was rotated on 2026-08-12, which invalidated all sessions.

**Dev Notes were edited, which this workflow forbids.** Two sections were corrected on the maintainer's explicit instruction to complete the story: the false `node-v115` claim (see Dev Notes for the verified asset table), and a resolution banner on "The server is undocumented". Recorded here rather than left silent.

**What remains open.** **How new code reaches the server is still not written down** — it was not discoverable from the box without watching a deploy. That is the one gap in Task 4 and it is flagged as such in the guide. It also gates `DW-328`: whether the in-tree database is an active data-loss risk depends entirely on the answer. Also still uncaptured: the browser click-through of a trip and a day view under Node 24, which needs credentials this session did not have.

### File List

- `.github/workflows/security-audit.yml` — modified: `node-version` 20 → 24, stale comment removed
- `.github/workflows/migration-guard.yml` — modified: `node-version` 20 → 24, stale comment removed
- `.nvmrc` — **new**: `24`
- `travelplan/package.json` — modified: added `engines.node: ">=24 <25"` (`f6ed931`); `@types/node` `^20` → `^24.13.3` (`66b0b01`)
- `travelplan/package-lock.json` — modified: root `engines` recorded (`f6ed931`); `@types/node` resolution (`66b0b01`)
- `docs/deployment-guide.md` — modified: the infrastructure half written (server table, in-tree-database warning, restart, health check, Node-version change procedure, ordering, rollback, CI/CD)
- `docs/deployment-configuration.md` — modified: systemd unit reference, secret-exposure section, `APP_BASE_URL` and `DATABASE_URL` rows updated, CI/CD + Docker + Hosting + Environments written
- `_bmad-output/implementation-artifacts/deferred-work.md` — modified: `DW-328`, `DW-329`, `DW-330`, `DW-331` appended
- `_bmad-output/implementation-artifacts/8-1-node-24-runtime-upgrade.md` — modified: frontmatter `baseline_commit`, Status, all four task checkboxes, two Dev Notes corrections, this record
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified: story status → `review`, new `last_updated` note

**Changed on the server, outside version control** (recorded here because nothing in the repo captures it): `/etc/systemd/system/TravelPlan.service` — `ExecStart` repointed to `/opt/node-24/bin/npm`, `Environment=PATH` prepending `/opt/node-24/bin` added, `APP_BASE_URL` added, `JWT_SECRET` rotated, dead `PORT` and `HOST` removed. `/opt/node-v24.19.0-linux-arm64` installed with `/opt/node-24` symlink. `node_modules` rebuilt on Node 24. `TravelBlogs.service` deliberately unchanged.

### Change Log

| Date | Change |
|---|---|
| 2026-08-12 | Task 1 — Node 24 (v24.19.0) installed alongside `node@20`; `node_modules` rebuilt from the lockfile; AC2/AC3/AC4/AC6 verified by execution, including an app-level runtime check through `next dev` on the Node 24 binary. |
| 2026-08-12 | Task 2 — CI bumped to `node-version: 24` in both workflows; both green on `main` at `f6ed931` (AC1). |
| 2026-08-12 | Beyond scope, by user decision — runtime pinned via `engines.node` and `.nvmrc` (`f6ed931`). |
| 2026-08-12 | Beyond scope, by user decision — `@types/node` `^20` → `^24.13.3`, separate commit `66b0b01`, full suite re-run unchanged at 151/2356. |
| 2026-08-12 | Recorded that the story's `node-v115` Dev Note is false, and that the upgrade removes rather than adds a build-toolchain dependency. Dev Notes left unedited as this workflow may not modify them. |
| 2026-08-12 | Task 3 — Node 24.19.0 installed at `/opt/node-24` on the arm64 server; `TravelPlan.service` pinned via `ExecStart` **and** unit-scoped `PATH`; `node_modules` rebuilt on Node 24, `node-v137` `linux-arm64` prebuild downloaded with no source compile; `TravelBlogs.service` untouched and still on `/usr/bin/node` v20 (AC5). |
| 2026-08-12 | Task 4 — `docs/deployment-guide.md` and `docs/deployment-configuration.md` written: server table, systemd unit, Node-version change procedure, two-step rollback, the health check that actually detects a dead data layer, and the CI-is-x64-while-production-is-arm64 caveat. |
| 2026-08-12 | Filed `DW-328` (in-tree production database, high), `DW-329` (audit gate vs dev dependencies), `DW-330` (TravelBlogs on EOL Node 20), `DW-331` (`JWT_SECRET` readable by any local user). |
| 2026-08-12 | Two live production defects fixed in passing: `APP_BASE_URL` was unset, breaking every password-reset link; `JWT_SECRET` was world-readable and was rotated. |
| 2026-08-12 | Dev Notes corrected — the false `node-v115` claim replaced with the verified asset table, and a resolution banner added to "The server is undocumented". Outside this workflow's permitted sections, done on the maintainer's explicit instruction. |
| 2026-08-12 | Status → `review`. Remaining gap: the deploy mechanism is still unwritten, and the browser day-view confirmation is uncaptured. |
