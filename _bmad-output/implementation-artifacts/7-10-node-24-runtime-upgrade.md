---
baseline_commit: b18997c
---

# Story 7.10: Node 24 LTS Runtime Upgrade (CI, Local, Server)

Status: backlog

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

- [ ] Task 1: Install Node 24 locally and verify the app before touching CI. (AC: 2, 3, 4, 6)
  - [ ] The dev machine currently has **only** Homebrew `node@20` and **no `nvm`** (verified at baseline: `/opt/homebrew/bin/node` → v20.19.2, `~/.nvm/versions/node` does not exist). Install Node 24 side-by-side rather than replacing 20 — `brew install node@24`, or install `nvm` if you want per-project switching. Do not `brew upgrade node`; keeping 20 available is what makes a rollback cheap.
  - [ ] Delete `travelplan/node_modules` and reinstall from the lockfile on Node 24 (`npm ci`). A stale tree built against Node 20's ABI will mask exactly the native-module failure AC4 is there to catch.
  - [ ] Confirm AC6: the `@prisma/streams-local@0.1.11` `EBADENGINE` warning (`requires >=22.0.0`) should be gone. It is the **only** engine conflict in the tree — see Dev Notes → "Compatibility was verified statically, not guessed".
  - [ ] Run `npm test` and record the pass count against the Node 20 baseline (AC2), then `npm run build` (AC3).
  - [ ] Smoke-test at runtime, not just at build time (AC4): `npm run dev`, open a trip, load a day view. `better-sqlite3` binding failures surface on first query, not at install.
- [ ] Task 2: Bump CI. (AC: 1)
  - [ ] `node-version: 20` → `24` in `.github/workflows/security-audit.yml` and `.github/workflows/migration-guard.yml`. Remove the "Kept at 20 to match local dev and the deployment server" comment that `b18997c` added above each one — it stops being true here, and a stale comment is worse than none.
  - [ ] Leave the `--ignore-scripts` flag on the audit job's `npm ci` alone. It is unrelated to the Node version; it exists because `postinstall` → `prisma generate` needs a `DATABASE_URL` that CI does not have (`b18997c`).
  - [ ] Push and confirm both workflows go green on `main`. The Security Audit job is the meaningful one — it is the job that actually installs dependencies.
- [ ] Task 3: Upgrade the deployment server. (AC: 5)
  - [ ] **Read Dev Notes → "The server is undocumented" before starting.** `docs/deployment-guide.md` and `docs/deployment-configuration.md` are both 9-line placeholders, so the actual process/service setup has to be discovered on the box.
  - [ ] Install Node 24 alongside Node 20 — do not replace it. The second application depends on 20 and moving it is explicitly out of scope.
  - [ ] Point **only** TravelPlan's service at the Node 24 binary: an absolute path in the systemd unit's `ExecStart`, or an `nvm`-selected version scoped to the service user. Avoid changing the system-wide default `node` — that is the one action that could silently take the other app with it.
  - [ ] Reinstall `node_modules` on the server on Node 24 (native ABI again — AC4 applies here too, and the server is `linux-x64` where the dev machine is `darwin-arm64`).
  - [ ] Restart, then verify both applications respond (AC5). Rollback is repointing `ExecStart` back at the Node 20 binary.
- [ ] Task 4: Record what was learned about the deployment target. (AC: 5)
  - [ ] While on the box for Task 3, fill in the two placeholder docs with what is actually there — process manager, service names, install paths, both Node versions and which app uses which. This story is the first task in the project's history that requires knowing any of it; not writing it down means rediscovering it next time.
  - [ ] Note the second application's own EOL Node 20 exposure as a follow-up. Out of scope here, but it does not stop being true.

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

Two conclusions worth carrying into the work:

- **Node 24 is exactly as safe as Node 22 here.** No dependency prefers 22. That removes the usual "take the smaller jump" argument.
- The single Node 20 conflict arrives via `prisma@7.9.1 → @prisma/dev@0.24.17 → @prisma/streams-local@0.1.11`. It is a warning today, not a failure — but it is Prisma signalling direction of travel.

### Why 24 and not 22

Node 22 left **Active** LTS in Oct 2025 and is in Maintenance with EOL around Apr 2027. Node 24 is the current Active LTS, EOL around Apr 2028. Going to 22 would buy ~8 months and then repeat this story in the spring. Confirm the current dates at <https://nodejs.org/en/about/previous-releases> before starting — those are scheduled dates, not verified ones.

### `better-sqlite3` is the real risk, and it is covered (read before Task 1)

Native modules are the thing that actually breaks on a Node major bump, because they compile against Node's ABI (`NODE_MODULE_VERSION`). The pinned `better-sqlite3@12.6.2` release ships prebuilds for:

```
node-v115 → Node 20      node-v137 → Node 24  ← target
node-v127 → Node 22      node-v141 → Node 25/26
```

`node-v137` is published for both `linux-x64` (CI + server) and `darwin-arm64` (dev machine), so `prebuild-install` should fetch a binary and no build toolchain is needed. If it *does* fall back to a source compile, that is the signal something is off — stop and check the ABI rather than installing build tools to force it through.

### The server is undocumented (read before Task 3)

`docs/deployment-guide.md` and `docs/deployment-configuration.md` are both 9-line "No deployment configuration detected yet / TBD" placeholders at baseline. There is no `Dockerfile`, no `docker-compose`, no `.nvmrc`, and no `.node-version` anywhere in the repo — a repo-wide search for Node version pins finds hits **only** in the two workflow files. So Task 3 is partly discovery, and Task 4 exists to make sure that discovery is not thrown away.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
