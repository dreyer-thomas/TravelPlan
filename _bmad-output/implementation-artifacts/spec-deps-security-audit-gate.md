---
title: 'Trustworthy Dependency-Audit Gate: Lift Highs, Provenance, Schedule, Allowlist'
type: 'chore'
created: '2026-08-08'
status: 'done'
baseline_revision: 'a39fd5735f083eefabeea7872a24adc3d7690297'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['multiple-goals', 'oversized']
baseline_commit: 'a39fd5735f083eefabeea7872a24adc3d7690297'
final_revision: '7125d31999ffa8ac956fe115e5f1e3a699f04164'
---

<intent-contract>

## Intent

**Problem:** `npm audit --omit=dev` reports two high findings with upstream fixes available (`fast-uri@3.1.4` via `prisma → @prisma/dev → @prisma/streams-local → ajv`, `nanoid@3.3.16` via `postcss`), so `npm run audit:check` — and therefore the CI gate — is red. Beyond that, the gate has three structural holes: it never checks package provenance, it only fires on push/PR so already-merged dependencies are never re-audited when a CVE lands later, and it is a bare `npm audit` with no escape hatch, so a future unfixable *production* CVE would hard-block `main` indefinitely.

**Approach:** Lift the two findings via `npm audit fix` (lockfile-only, transitive semver-compatible bumps) and re-verify build/lint/test plus `prisma generate`. Then close the three gaps: add a blocking `npm audit signatures` step to the workflow, add a weekly `schedule` trigger (plus `workflow_dispatch`), and replace the bare `npm audit` behind `audit:check` with a Node wrapper that reads a checked-in allowlist of advisory ids, each carrying a justification and an expiry date.

## Boundaries & Constraints

**Always:**
- After the fix, `npm audit --omit=dev` reports 0 vulnerabilities and `npm run audit:check` exits 0.
- `npm run build`, `npm run lint`, `npm run test` and `npx prisma generate` all exit 0 (lint: zero errors; warnings fine).
- The wrapper fails on *any* unsuppressed finding at any severity — it preserves today's `--audit-level=low` strictness, and it stays scoped to `--omit=dev`.
- The wrapper must be **fail-closed**: an unreadable/absent/malformed allowlist must never widen what is suppressed.
- `scripts/audit-check.mjs` may import **node: builtins only** — no dependencies at all, prod or dev (house rule from `scripts/grant-admin.mjs`: the server installs with `--omit=dev`).
- The allowlist starts **empty** — nothing is suppressed by this change.

**Block If:**
- `npm audit fix` wants to modify `package.json` (i.e. proposes a direct-dependency or major bump) rather than `package-lock.json` alone.
- `npm audit --omit=dev` is still non-zero after the fix, or any of build / lint / test / `prisma generate` regresses.
- `npm audit signatures` fails locally against the fixed tree (it passes today: 766/766 verified).

**Never:**
- Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`. The orchestrator records resolution; DW-4's stale sentence is reported in `## Auto Run Result`, not patched here.
- Do not add `.github/dependabot.yml` or attempt to change GitHub repo settings — the `schedule` trigger is the in-repo, verifiable option, and Dependabot alert state cannot be checked from here (no `gh` CLI).
- Do not add `overrides` for `fast-uri`/`nanoid` — upstream already ships patched versions; an override would be dead weight that outlives the advisory.
- Do not touch application code, `eslint.config.mjs`, or the existing `overrides` block.
- Do not make the wrapper re-implement severity thresholds, `--json` shapes, or anything else npm already decides.

## I/O & Edge-Case Matrix

`scripts/audit-check.mjs` — allowlist evaluation. "now" is injectable so expiry is testable.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean tree | audit reports no vulnerabilities | prints a one-line all-clear; exit 0 | No error expected |
| Unlisted finding | finding `GHSA-AAAA`, allowlist empty | prints the finding (package, severity, id, title, url); exit 1 | Blocking by design |
| Live suppression | finding `GHSA-AAAA`; entry `GHSA-AAAA` expires 2099-01-01 | prints it as suppressed with its justification + expiry; exit 0 | No error expected |
| Expired suppression | finding `GHSA-AAAA`; entry expired yesterday | suppression refused — finding is reported as blocking and named as expired; exit 1 | Blocking by design |
| Stale entry | entry `GHSA-BBBB` matches no finding | warns that the entry can be removed; does **not** affect exit code | Warning only |
| Absent allowlist file | file missing | treated as empty allowlist, noted on stdout; strictest behavior | Fail-closed, not an error |
| Malformed allowlist | invalid JSON, or an entry missing `advisory`/`justification`/`expires`, or `expires` not `YYYY-MM-DD` | names every offending entry; exit 1; **nothing is suppressed** | Fail-closed |
| npm audit unusable | `npm audit --json` produces unparseable output or the process cannot be spawned | reports the failure with npm's stderr; exit 1 | Never treated as "clean" |
| npm audit non-zero exit | vulnerabilities found (npm exits 1) | normal path — parse the JSON, do not treat the exit code as failure | Exit code alone is not the signal |

</intent-contract>

## Code Map

- `travelplan/package-lock.json` -- regenerated by `npm audit fix`: `fast-uri` 3.1.4→3.1.5, `nanoid` 3.3.16→3.3.18 (both production); `js-yaml` 4.3.0→4.3.1 and three `brace-expansion` bumps come along dev-side
- `travelplan/package.json` -- `audit:check` script only: `npm audit --omit=dev --audit-level=low` → `node ./scripts/audit-check.mjs`
- `travelplan/scripts/audit-check.mjs` (new) -- the wrapper; exported pure functions + `main()` behind a main-module guard, mirroring `scripts/grant-admin.mjs`
- `travelplan/audit-allowlist.json` (new) -- checked-in allowlist, ships empty
- `travelplan/test/auditCheckScript.test.ts` (new) -- covers the I/O matrix against the exported functions
- `.github/workflows/security-audit.yml` -- add `schedule` + `workflow_dispatch` triggers and an `npm audit signatures` step
- `travelplan/scripts/grant-admin.mjs` -- style reference (shebang, `node:` imports, `process.exitCode`, main-module guard, why-not-what comments)
- `travelplan/test/grantAdminScript.test.ts` -- test style reference for importing a `.mjs` script from `test/`

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/package-lock.json` -- run `cd travelplan && npm audit fix --ignore-scripts`, then `npx prisma generate`; confirm `git diff --stat` touches `package-lock.json` only -- lifts both production highs without a direct-dependency change (`--ignore-scripts` keeps the `prisma generate` postinstall, which needs `DATABASE_URL`, out of the install; it is run explicitly afterwards as the intent requires)
- [x] `travelplan/scripts/audit-check.mjs` -- new wrapper. Spawn `npm audit --omit=dev --json` (`node:child_process`), parse stdout regardless of exit code, collect one finding per object in each `vulnerabilities[*].via[]` (advisory id parsed from the trailing `GHSA-…` segment of `via[].url`), evaluate against the allowlist, print a report, set `process.exitCode`. Export `parseAllowlist`, `collectFindings`, `evaluate({ findings, entries, now })` and `formatReport` as pure functions; keep `main()` behind the `process.argv[1]` guard -- an escape hatch that is auditable in review and cannot be widened by accident
- [x] `travelplan/audit-allowlist.json` -- new file, empty entry list plus a `$comment`/`README`-style field documenting the entry shape (`advisory`, `package`, `justification`, `expires`) -- the shape has to be discoverable at the moment someone needs it, which is the moment `main` is blocked
- [x] `travelplan/package.json` -- point `audit:check` at `node ./scripts/audit-check.mjs` -- CI and the workflow call the same command they already call
- [x] `travelplan/test/auditCheckScript.test.ts` -- new test covering every I/O matrix row against the exported functions, using fixture audit reports and an injected `now` -- expiry and fail-closed behavior are exactly the parts that are never exercised until they matter
- [x] `.github/workflows/security-audit.yml` -- add `schedule: - cron: "17 6 * * 1"` and `workflow_dispatch:` to `on:`, and add a blocking `Verify package provenance` step running `npm audit signatures` (working-directory `travelplan`) after install and before `npm run audit:check`; comment why each exists -- closes DW-6 and DW-5

**Acceptance Criteria:**
- Given the updated lockfile, when `npm audit --omit=dev` runs, then it reports 0 vulnerabilities and `git diff` shows `package.json` dependency/override blocks unchanged.
- Given the updated lockfile, when `npm run build`, `npm run lint`, `npm run test` and `npx prisma generate` run, then all four exit 0.
- Given the updated lockfile, when `npm audit signatures` runs, then every audited package has a verified registry signature and the command exits 0.
- Given `.github/workflows/security-audit.yml`, when the file is read, then `on:` contains `schedule`, `workflow_dispatch`, `pull_request` and `push`, and a step runs `npm audit signatures` before `npm run audit:check`.
- Given the shipped empty allowlist and a clean tree, when `npm run audit:check` runs, then it exits 0 — i.e. the wrapper is a drop-in replacement for the bare command it replaces.
- Given `npm run test`, when the suite runs, then `test/auditCheckScript.test.ts` passes alongside the existing 133 test files with no regressions.

## Spec Change Log

## Review Triage Log

### 2026-08-08 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 2, medium 3, low 8)
- defer: 2: (high 0, medium 1, low 1)
- reject: 4
- addressed_findings:
  - `[high]` `[patch]` The plausibility tripwire — the only guard against npm reorganising its report — read `metadata.vulnerabilities.total` defensively, so it disarmed itself the moment that field moved or changed type. Reproduced end to end: a report listing `fast-uri` as a **high** with its advisory detail outside `via[]` and its counts under `summary` instead of `metadata` printed "No vulnerabilities in the production dependency tree" and **exited 0**; same for `"total":"7"`. `parseAuditReport` now *requires* both counts, and `reportPlausibilityError` additionally blocks on a non-empty `vulnerabilities` map that yielded zero advisories — a signal that needs no `metadata` at all, so a format change cannot take out both.
  - `[high]` `[patch]` An audit that covered **nothing** graded as clean. Reproduced: `metadata.dependencies.prod === 0` (lockfile regenerated wrong, `dependencies` emptied) printed the all-clear and exited 0 — literally "audited nothing → green", the one failure this file names in its own header as the thing it exists to prevent. Now refused with "this is not a clean tree, it is an unaudited one".
  - `[medium]` `[patch]` Both whole-report checks only fire when *nothing* parsed, so an npm major that moved advisory detail for some packages and not others would be graded on the half that still read. `reportPlausibilityError` now checks each package's `via` against the two shapes npm actually builds (an advisory object, or the name of the dependency the vulnerability arrives through) and names the packages it could not read. Verified against a real populated report from the pre-fix lockfile: 2 findings, exit 1, no false positive.
  - `[medium]` `[patch]` `auditReportVersion` was checked only when present, so the one report format that declares nothing about itself was graded by a parser with no claim to understand it — the exact case the guard was written for. The field is now required.
  - `[medium]` `[patch]` The GHSA id was minted from any host's URL. `via[].url` is registry-supplied data, so `https://anywhere.example/advisories/GHSA-<an-already-accepted-id>` would inherit that entry's suppression for an unrelated advisory. Ids are now read only from `github.com/advisories/…`; anything else falls back to npm's own advisory number, which still blocks and is still suppressible.
  - `[low]` `[patch]` The id was taken from the URL's *last* path segment only, so `…/GHSA-7p8r-x3mc-p8w7/dependabot` fell through to the numeric fallback. The allowlist's own instructions tell a blocked reader to write the GHSA id, so the entry they wrote would never match — a suppression that reads as taken in the diff and does nothing in CI. The id is now found anywhere in the advisory path.
  - `[low]` `[patch]` A non-string `package` was silently discarded. `"package": ["fast-uri","ajv"]` — the very mistake the unrecognised-key rule was added to catch, wearing a legal field name — read in a diff as a suppression scoped to two packages and applied as one scoped to none. Now an error.
  - `[low]` `[patch]` `Number.isInteger(source)` admitted zero and negatives while `NPM_ADVISORY_PATTERN` refuses `npm-advisory--1`: the minter and its validator disagreed about their own domain, producing an unsuppressable id — the one shape the numeric fallback exists to prevent. Out-of-domain numbers now take the ordinal.
  - `[low]` `[patch]` A UTF-8 BOM disarmed the entire allowlist and blamed JSON syntax, sending the reader after a missing comma that was not there. Stripped before parsing.
  - `[low]` `[patch]` Annotations covered suppressed, expired and stale entries — three categories that change no verdict — and said nothing about the findings that actually fail the run, so a red run's reason was reachable only by opening the step log. Blocking findings now raise an escaped `::error::` each, first.
  - `[low]` `[patch]` The integration stub discarded `argv`, so `--omit=dev --json` was untested: narrowing the audit's scope (e.g. adding `--omit=optional`) would have audited strictly less of what ships with all 63 tests still green. The stub now records its command line and it is asserted.
  - `[low]` `[patch]` `AUDIT_TIMEOUT_MS` bounds `npm audit` to 5 minutes against a registry that answers never — while `npm ci` and the new `npm audit signatures` step talk to that same registry with no bound at all, leaving the scenario the constant was written against fully available one step earlier. Added `timeout-minutes: 15` to the job.
  - `[low]` `[patch]` `audit-allowlist.json`'s `$comment` was a single 1,459-character line — unreadable in the two situations it exists for (someone blocked at 2am, and a reviewer reading its diff) — and it stated a rule the parser does not enforce ("those four fields", when `package` is optional) while never stating the consequence of id-only matching: an entry also suppresses that advisory on any *other* package it later lands on. Rewritten as a line array, with the rules corrected and that consequence spelled out.

### 2026-08-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 2, medium 5, low 6)
- defer: 2: (high 0, medium 2, low 0)
- reject: 6
- addressed_findings:
  - `[high]` `[patch]` `parseAuditReport` rejected `null` and non-objects but not *arrays*, while `collectFindings` deliberately did guard `Array.isArray` — the two disagreed about the same guard and the disagreement resolved fail-open. Reproduced: a report whose `vulnerabilities` was an array holding a critical finding printed "No vulnerabilities in the production dependency tree" and **exited 0**. The array check is now in both places.
  - `[high]` `[patch]` `npm-advisory-unnamed-<n>` was accepted by the allowlist, but that id is an ordinal over every `via` object in the report — a position, not an identity. Reproduced: adding one unrelated advisory on an earlier-iterating package renumbered the ids, so an entry written to accept advisory B silently began suppressing advisory A, printing B's justification for it. `NPM_ADVISORY_PATTERN` is now `^npm-advisory-\d+$`: the `source`-derived form stays suppressible, the ordinal form is refused and those findings stay blocking.
  - `[medium]` `[patch]` Any non-GHSA last path segment was used verbatim as the advisory id. Reproduced: `https://www.npmjs.com/advisories/1234` minted the id `1234` and `https://example.com/` minted `example.com` — ids that block `main` and that `parseAllowlist` refuses, i.e. a finding structurally impossible to accept, which is the exact emergency the allowlist exists for. Non-GHSA segments now fall through to `npm-advisory-<source>`.
  - `[medium]` `[patch]` Justifications were interpolated into `::warning::` workflow commands unescaped. A newline truncated the annotation before the reason and let the remainder be read as further commands. All interpolated values now go through GitHub's `%25`/`%0D`/`%0A` escaping.
  - `[medium]` `[patch]` `spawnSync` had no `timeout`, so a registry that accepts the connection and never answers left the gate hanging with no verdict until GitHub's job cap hours later. Added a 5-minute timeout with `SIGKILL`; it surfaces as `audit.error`, which was already the fail-closed path.
  - `[medium]` `[patch]` An npm exit status outside `{0, 1}` was graded as a normal audit — the bare `npm audit` this replaced failed on every non-zero exit, so this was a hole the gate never previously had. Unrecognised statuses now fail closed.
  - `[medium]` `[patch]` The plausibility guard's comment named "a changed `auditReportVersion`" as the failure it defends against, but the field was never read, and the guard only fires at *zero* findings — a format change leaving one readable advisory passed silently. `parseAuditReport` now refuses any version other than `2`.
  - `[low]` `[patch]` Unrecognised keys on an allowlist entry were silently ignored, so `expiry` (a typo for `expires`) or a `packages` array written to scope a suppression made the diff read as a narrower, shorter-lived exception than the one applied. Unknown keys are now an error.
  - `[low]` `[patch]` `spawnSync("npm", …)` cannot find npm on Windows, where it is `npm.cmd` — fail-closed, but permanently and inexplicably red for a Windows contributor, which is how gates get worked around. Platform-aware now.
  - `[low]` `[patch]` `if: ${{ !cancelled() }}` also ran the gate after a failed `npm ci`; `npm audit` reads the lockfile, so a red job could end on an all-clear for a tree that was never installed. Narrowed to `steps.install.outcome == 'success'` — still immune to a flaky provenance step, which was the point of the guard.
  - `[low]` `[patch]` The shipped-allowlist test pinned `now` to `2026-08-08` forever, so a legitimate entry added next year would fail it with a "more than 180 days out" message that is simply false about the file under test. It now parses the shipped file against the real clock.
  - `[low]` `[patch]` `main()` — the wiring where every pure answer becomes an exit code — had no coverage at all. Added 8 process-level tests running the script against a stub `npm` on `PATH`, asserting exit codes for the clean, blocked, suppressed, malformed-allowlist, absent-allowlist, non-JSON, unknown-exit-code and annotation paths.
  - `[low]` `[patch]` Documentation drift: the script docblock still claimed "four exported functions" (there are seven), the allowlist `$comment` described the fallback id in the pre-fix form, and its `$example` carried a hard-coded `"expires": "2026-12-31"` that anyone copying after that date would paste as an instantly-expired entry. All three corrected; the example now carries a placeholder the parser would reject.

### 2026-08-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 1, medium 5, low 8)
- defer: 4: (high 0, medium 3, low 1)
- reject: 6
- addressed_findings:
  - `[high]` `[patch]` Both reviewers independently found, and I reproduced, that the main-module guard compared `path.resolve(process.argv[1])` against `fileURLToPath(import.meta.url)` — Node resolves the latter through symlinks and the former not, so invoking the script through any symlinked path component (a git worktree, `/tmp` on macOS) made `main()` never run and the gate exit **0 having printed nothing and audited nothing**. Fixed by comparing `fs.realpathSync` of both sides, with a lexical fallback if either cannot be resolved. Re-reproduced through a symlinked directory: the gate now audits and reports.
  - `[medium]` `[patch]` No cross-check against npm's own count: a report whose format changed (or whose advisory detail moved out of `via[]`) yielded zero findings and a green build. Added exported `reportPlausibilityError`, which blocks when `metadata.vulnerabilities.total > 0` and no advisory could be read. Deliberately one-directional — this script counts advisories where npm counts packages, so finding *more* than npm's total is normal.
  - `[medium]` `[patch]` `expires` had no ceiling, so `9999-12-31` was a valid "temporary" suppression and the expiry field was decorative. Added `MAX_SUPPRESSION_DAYS = 180`, enforced in `parseAllowlist` against an injected `now`.
  - `[medium]` `[patch]` A suppressed vulnerability was announced only inside a collapsed green CI step — the "visible decision" the allowlist promises, at the one moment it stops being visible. Added exported `annotations`, emitting `::warning::` workflow commands for every suppressed finding, expired entry and stale entry when `GITHUB_ACTIONS` is set.
  - `[medium]` `[patch]` A finding whose advisory has no GHSA id got a minted `npm-advisory-<id>`, which no allowlist entry could match — a hole in the escape hatch shaped exactly like the emergency it exists for. The allowlist now accepts that id form too, still requiring justification and expiry.
  - `[medium]` `[patch]` A failure of the new `npm audit signatures` step aborted the job before the vulnerability gate ran, coupling the two checks and inviting someone to weaken the second after a flaky first. Added `if: ${{ !cancelled() }}` to the audit step.
  - `[low]` `[patch]` An expired allowlist entry sitting beside a live one for the same advisory was reported under a heading claiming "the findings above block" while nothing blocked. `evaluate` now excludes entries whose advisory is still covered.
  - `[low]` `[patch]` A run red *only* because the allowlist was unusable ended on the line "No vulnerabilities in the production dependency tree", flatly contradicting its own exit code. A closing line now names the real reason.
  - `[low]` `[patch]` `via[].url` carrying a query string or fragment produced an advisory id no entry could match. Both are stripped before the last path segment is taken.
  - `[low]` `[patch]` `typeof [] === "object"`, so an array `vulnerabilities` map would have had its indices walked as package names, and an array `via` element would have become a nameless finding. Both are now rejected explicitly.
  - `[low]` `[patch]` Two unnameable advisories on one package both fell back to `npm-advisory-unknown` and the second was silently dropped by dedupe. The fallback id now carries an ordinal.
  - `[low]` `[patch]` `evaluate()` threw on a missing argument object; defaulted to `{}`.
  - `[low]` `[patch]` The file's docblock claimed it "keeps the same answer" as `npm audit --omit=dev --audit-level=low`, which is untrue for `info`-severity findings — those did not fail before and do now. Corrected the claim rather than the behaviour: stricter is right for a gate, and an `info` finding is suppressible with a reason and a date.
  - `[low]` `[patch]` A second entry for an advisory that already had one was accepted, letting an expired suppression be renewed by appending — a diff that reads as an addition rather than as somebody changing a date. Duplicates are now rejected.

## Design Notes

**Why `npm audit fix` and not pinned `overrides`.** Both findings are transitive and both have patched versions inside the existing semver ranges (`ajv` asks for `fast-uri@^3.0.1`, `postcss` for `nanoid@^3.3.16`), so the fix is purely a lockfile resolution move. A dry run confirms it changes 7 packages and no `package.json` entry. An `overrides` pin would still be sitting in `package.json` long after upstream moved on — the previous audit story already had to delete three such stale overrides.

**Advisory id, not npm's numeric `source`.** `via[].source` is an npm-internal advisory number; the GHSA id in `via[].url` is the identifier a human reads in the advisory, pastes into a justification, and can look up. The allowlist keys on GHSA.

**Why stale entries warn but expired ones block.** Expiry exists to force re-evaluation of a suppression that is still doing work. An entry whose advisory no longer appears is doing no work — failing CI on it would be a self-inflicted break with no security meaning, on a date boundary, for a tree that is clean. So: expired *and still matching* → the suppression is refused and the finding blocks; matching nothing → a printed nudge to delete it.

**Schedule, not Dependabot.** DW-6 asks to check whether Dependabot alerts are already on before building anything. That cannot be checked from here — there is no `gh` CLI and no API credential in this environment — and enabling it is a repo-settings change, not a code change. A `schedule` trigger is in-repo, reviewable, and verifiable; GitHub emails the repo owner when a scheduled workflow fails. Note for the human: scheduled runs execute against the **default branch only**, and GitHub disables schedules on repos with 60 days of no activity. If Dependabot alerts turn out to be enabled already, this cron is cheap redundancy, not a conflict.

**`npm audit signatures` is safe to make blocking.** Verified against the current tree: `766 packages have verified registry signatures`, 202 with attestations, exit 0. It needs a populated `node_modules`, so it must run after `npm ci`.

**A fifth export, `parseAuditReport`, was added to the four the task named.** It is the guard for the "npm audit unusable" row, and it exists as an export because that row is otherwise untestable without spawning npm. The failure it catches is the quiet one: when npm cannot reach the registry it writes a *valid JSON error object*, which has no `vulnerabilities` key, so a caller that merely parsed and counted would find zero findings and report a clean tree for a run that audited nothing. `collectFindings` still tolerates a missing `vulnerabilities` key — as a pure function it should — and `parseAuditReport` is where `main()` refuses to accept one. Empty stdout, non-JSON stdout, an `error` object and a report without a `vulnerabilities` section are all errors, never a pass.

**Expiry is compared as a UTC calendar day, not an instant.** Both sides are reduced to `YYYY-MM-DD` — a format whose lexicographic order is its chronological order — and compared with `>=`, so the day named is the last day the suppression is valid. UTC because CI runs in UTC and a gate whose verdict depends on the developer's timezone is a gate nobody trusts; the cost is that an entry can outlive its date by a few hours for someone west of UTC, which is the harmless direction on a date somebody chose by hand.

**Matching is by advisory id alone; `package` in an entry is documentation.** The GHSA id is the thing npm, GitHub and the justification all agree on. A package name is the thing that moves when a transitive dependency is re-parented, so making it part of the match would silently un-suppress an accepted advisory on an unrelated dependency-tree change.

**The advisory URL is registry-supplied data, so the id is read only from GitHub.** `via[].url` arrives from the same place the vulnerable package did. Taking a GHSA-shaped path segment from any host lets a package name itself as an advisory somebody already accepted and inherit that entry's suppression — the one input to the match that was assumed rather than verified. Ids now come only from `github.com/advisories/…`; anything else falls back to npm's own advisory number, which keeps the finding blocking and still suppressible on its own terms. Within that path the id is searched for across every segment rather than in the last one, because `…/GHSA-xxxx-xxxx-xxxx/dependabot` would otherwise take the fallback, and the entry the allowlist's own instructions tell a blocked person to write would silently never match.

**A fallback id is suppressible only when it is an identity, never when it is a position.** If `via[].url` is missing or its last path segment is not GHSA-shaped, the finding falls back to `npm-advisory-<source>`, built from npm's own advisory number — stable across runs, so an allowlist entry holding one keeps meaning the same advisory tomorrow. That form *is* accepted by the allowlist, because the alternative is an escape hatch with a hole shaped exactly like the emergency it exists for. When there is no usable `source` either, the id becomes `npm-advisory-unnamed-<n>`, an ordinal over the `via` objects in the whole report; `parseAllowlist` refuses that form outright, since one unrelated advisory appearing earlier renumbers it and the entry would silently transfer its justification onto something nobody reviewed. So: nameable → blocking but acceptable with a reason and a date; unnameable → blocking, full stop. Note also that a non-GHSA last segment must *not* be used as the id — `https://www.npmjs.com/advisories/1234` would otherwise mint the id `1234`, and a bare host URL the id `example.com`, neither of which any valid entry may hold: a finding that blocks `main` with the escape hatch structurally unable to reach it.

**Refusing an `auditReportVersion` this script was not written against.** `parseAuditReport` accepts only version `2` (or a report that omits the field). A future npm that reorganises its report would otherwise be graded by a parser that no longer understands it, and that failure presents as a green build — the `metadata.total` tripwire only fires when *zero* advisories were read, so a format change that leaves one readable `via` object slips through. Red-and-loud on an unknown version costs one deliberate edit here; reading a format nobody checked costs a shipped vulnerability. Same reasoning for npm exiting with a status outside `{0, 1}`: those two are the codes npm documents for this command, and the bare `npm audit` this replaced failed on every non-zero exit, so accepting an unrecognised one as a clean audit would open a hole the gate never had.

**The main-module guard is `realpath`ed, and that is load-bearing.** Node resolves `import.meta.url` through symlinks but leaves `process.argv[1]` as typed, so the idiomatic comparison copied from `scripts/grant-admin.mjs` silently disables the script whenever the invocation path crosses a symlink. For `grant-admin.mjs` that is a script that does nothing and says nothing — annoying. For a security gate it is a **green build that audited nothing**, which is the exact failure this file exists to prevent, so the guard compares real paths. Verified by reproduction before and after.

**Suppression ceiling: 180 days.** An `expires` with no upper bound makes the field decorative — `9999-12-31` is a real calendar day. Six months is long enough to wait out an upstream release and short enough that every accepted vulnerability is re-argued twice a year. Combined with one-entry-per-advisory, renewing means editing a date in place, so the diff shows what actually changed.

**Trusting npm's own count as a tripwire — and not trusting it alone.** The script reads advisories out of `via[]`; npm publishes a package count in `metadata.vulnerabilities.total` from the same document. If npm says there is something and this script found nothing, the script did not understand the report, and "could not check" is not "clean". The check is one-directional on purpose — this script legitimately finds more entries than npm's total, since one package can carry several advisories.

The trap in that design, found by reproduction rather than by reading: a tripwire that reads one field is defeated by a format change that moves that field, which is the same event it exists to detect. So there are now four independent signals, and a format change has to take out all of them to produce a false green. (1) npm's count, as above. (2) The `vulnerabilities` map itself — npm does not list a package there unless something is wrong with it, so a non-empty map yielding zero advisories is the same contradiction stated without touching `metadata`. (3) Each package's `via` shape: npm builds `via` from a package's advisory set, so every element is an advisory object or the *name* of the dependency the vulnerability arrives through (verified against `@npmcli/arborist`'s `vuln.js`, which constructs exactly those two). Anything else means detail moved for *that* package — which (1) and (2) miss whenever some other package still parses. (4) `metadata.dependencies.prod === 0`: an audit that covered nothing produces a report identical to a clean one, and the two must never be graded the same. Both counts are required by `parseAuditReport` rather than read defensively, because optional-and-absent is precisely how (1) and (4) disarm themselves.

**Annotations are escaped; the allowlist is the one file whose whole job is carrying free text into CI.** GitHub reads workflow commands a line at a time, so a newline inside an interpolated justification truncates the `::warning::` at that point — dropping the reason, which is the only thing the annotation exists to show — and hands the remainder to the runner as further commands. Justifications come from a checked-in file and titles come from the registry, so both go through GitHub's own `%25`/`%0D`/`%0A` escaping.

**`main()` is tested as a process, not as a function.** Every exported function is pure and covered, but none of them can prove the one thing CI reads: the exit code. A future edit turning `process.exitCode = 1` into a bare `return` would leave the whole pure-function suite green while the gate stopped being one — the silent-success failure this file exists to prevent. So the script (which imports nothing but `node:` builtins, and therefore runs anywhere) is copied into a temp directory beside a fixture allowlist, with a stub `npm` on `PATH`, and the exit code is asserted for the clean, blocked, suppressed, malformed-allowlist, absent-allowlist, non-JSON, unknown-exit-code and annotation paths. The stub is a POSIX shell script, so that block skips on Windows.

**Pre-existing lint state, for the record.** `npm run lint` reports `85 problems (2 errors, 83 warnings)` both at baseline `a39fd57` and after this change — the two errors are `react/no-children-prop` in `src/theme.ts` (last touched in `a41e5b6`, before the baseline) and are out of this change's blast radius under "do not touch application code". Verified by running eslint against a worktree at the baseline commit with the same `node_modules`: identical counts, so the new script and test contribute zero problems.

## Verification

**Commands:**
- `cd travelplan && npm audit fix --ignore-scripts` -- expected: reports the 7 package changes; `git diff --name-only` lists `package-lock.json` only
- `cd travelplan && npx prisma generate` -- expected: exit 0, client generated
- `cd travelplan && npm audit --omit=dev` -- expected: `found 0 vulnerabilities`
- `cd travelplan && npm audit signatures` -- expected: all packages verified, exit 0
- `cd travelplan && npm run audit:check; echo $?` -- expected: `0`, via the new wrapper
- `cd travelplan && npm run build && npm run lint && npm run test` -- expected: all exit 0, no new lint errors from `scripts/audit-check.mjs`
- `cd travelplan && npx vitest run test/auditCheckScript.test.ts` -- expected: all cases pass
- `node -e "const yaml=require('js-yaml'),fs=require('fs');const d=yaml.load(fs.readFileSync('../.github/workflows/security-audit.yml','utf8'));console.log(Object.keys(d.on??d[true]).sort())"` -- expected: `pull_request`, `push`, `schedule`, `workflow_dispatch`; the install step carries `id: install` and the audit step's `if` references `steps.install.outcome` (run from `travelplan/`, where `js-yaml` is resolvable; there is no `pyyaml` in this environment)

**Follow-up review pass (2026-08-08), re-verified after the 13 patches:**
- `npx vitest run test/auditCheckScript.test.ts` -- 63 tests pass (was 48; +15 for the ordinal-drift, non-GHSA-fallback, array-report, unknown-version, unknown-key, annotation-escaping and `main()` process cases)
- `npm run test` -- 132 files / 1963 tests pass, against 132 files / 1948 tests on a stashed working tree at HEAD: +15 tests, zero regressions. (The earlier acceptance criterion's "133 test files" was inaccurate when written — the suite has 132 files including this one.)
- `npm run build` exit 0; `npx prisma generate` exit 0; `npm audit --omit=dev` -> `found 0 vulnerabilities`; `npm audit signatures` exit 0 (766 verified, 202 attested); `npm run audit:check` exit 0
- `npm run lint` -- `85 problems (2 errors, 83 warnings)`, byte-identical to the baseline recorded above: the patches add zero lint problems
- Each of the four fail-open/unsuppressable defects was reproduced against the pre-patch script and re-run against the patched one: array report now errors, `npm-advisory-unnamed-2` is now refused by the allowlist, `https://www.npmjs.com/advisories/1234` now yields the suppressible `npm-advisory-1234`, and a newline-bearing justification now emits as `%0A` on a single line

**Second follow-up review pass (2026-08-08), re-verified after the 13 patches:**
- The three silent-pass reproductions were run against the script before and after. Before: a report naming `fast-uri` as a **high** with counts moved to `summary`, the same with `"total":"7"`, and a report with `dependencies.prod: 0` each printed "No vulnerabilities in the production dependency tree" and exited **0**. After: all three exit **1** with the specific reason named
- **Regression check against a real populated report**, which matters more than the synthetic fixtures: `npm audit --json --package-lock-only --omit=dev` run against the *baseline* (`a39fd57`) lockfile in a temp directory, fed to the patched script — 2 findings (`fast-uri`, `nanoid`), both GHSA ids read correctly, exit 1. The new per-package `via` shape check produces no false positive on npm's real output
- `npx vitest run test/auditCheckScript.test.ts` -- 78 tests pass (was 63; +15 for the metadata-required, map-non-empty, partial-detail-move, empty-tree, unstamped-version, host-restricted-id, GHSA-in-path, non-string-`package`, out-of-domain-`source`, BOM, `::error::`-annotation and npm-command-line cases)
- `npm run test` -- 132 files / 1978 tests pass (was 1963): +15 tests, zero regressions
- `npm run build` exit 0; `npx prisma generate` exit 0; `npm audit --omit=dev` -> `found 0 vulnerabilities`; `npm audit signatures` exit 0 (766 verified, 202 attested); `npm run audit:check` exit 0
- `npm run lint` -- `85 problems (2 errors, 83 warnings)`, byte-identical to the baseline recorded above: the patches add zero lint problems
- Workflow re-parsed: `on:` = `pull_request, push, schedule, workflow_dispatch`; `jobs.npm-audit.timeout-minutes: 15`; steps in order `checkout | setup-node | npm ci --ignore-scripts | npm audit signatures | npm run audit:check`
- The rewritten `audit-allowlist.json` parses clean and still ships zero entries
- One reviewer claim was checked and **rejected as factually wrong**: that `npm audit signatures` fails only on *invalid* signatures and lets *missing* ones through. `npm/lib/utils/verify-signatures.js` sets `process.exitCode = 1` when either list is non-empty (`hasNoInvalidOrMissing`), so the step already blocks on both



## Auto Run Result

Status: `done` — second follow-up review pass. No intent gap, no spec amendment, no implementation loopback.

**What this pass changed.** Two independent reviewers went at the shipped gate; 13 findings survived triage as patches, all applied to `scripts/audit-check.mjs`, its tests, the workflow and the allowlist. The two that mattered were both *reproduced as exit-0 all-clears on a vulnerable or unaudited tree* — the single failure this file exists to prevent:

- the plausibility tripwire read one `metadata` field defensively, so a report that moved or re-typed that field disarmed the only check standing between a reorganised npm report and a green build;
- a tree with zero production dependencies (`metadata.dependencies.prod: 0`) was graded as clean rather than as unaudited.

The fix is structural rather than one more special case: `parseAuditReport` now *requires* the counts and the version stamp, and `reportPlausibilityError` carries four independent signals — npm's count, the `vulnerabilities` map itself, each package's `via` shape, and a non-empty production tree — so no single field a future npm moves can produce a false green. The remaining eleven patches close a suppression-inheritance vector in advisory-id derivation (ids are now read only from `github.com/advisories/…`), three unsuppressable-or-mismatched-id cases, a silently-dropped `package` field, a BOM that disarmed the allowlist, the absence of any `::error::` annotation for the findings that actually fail a run, an untested npm command line, an unbounded job, and allowlist documentation that was a 1,459-character single line stating one rule the parser does not enforce and omitting the consequence of id-only matching.

**Files changed in this pass**
- `travelplan/scripts/audit-check.mjs` — required version + counts in `parseAuditReport`; four-signal `reportPlausibilityError`; host-restricted, path-wide GHSA extraction; positive-`source` fallback; non-string `package` rejected; BOM stripped; `::error::` annotations for blocking findings
- `travelplan/test/auditCheckScript.test.ts` — 63 → 78 tests; the stub `npm` now records and asserts its command line; the three silent passes are asserted as exit 1 at process level
- `travelplan/audit-allowlist.json` — `$comment` rewritten as a readable line array with the rules corrected; still ships zero entries
- `.github/workflows/security-audit.yml` — `timeout-minutes: 15` on the job
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-261, DW-262 appended (new entries only)

**Review findings breakdown.** 13 patches applied (high 2, medium 3, low 8); 2 deferred (DW-261 mutable action tags across both workflows; DW-262 the new test file's share of an already-red `tsc --noEmit`); 4 rejected. One rejection is worth recording because it was checked rather than waved off: the claim that `npm audit signatures` blocks on *invalid* but not *missing* signatures is wrong — `verify-signatures.js` fails on either. The other three were branch-protection/CODEOWNERS work the intent contract explicitly puts out of scope, the test file inheriting the repo's global vitest setup, and a request to make suppressions package-scoped, which contradicts a deliberate design decision (the consequence is now documented in the allowlist instead).

**Verification.** Full detail under `## Verification`. Headline: 132 files / 1978 tests pass (+15, zero regressions); build, lint (byte-identical to baseline), `prisma generate`, `npm audit --omit=dev`, `npm audit signatures` and `npm run audit:check` all green; all three silent passes re-run and now exit 1; and — the check that matters most — a *real* populated audit report regenerated from the baseline lockfile still grades correctly through the new guards (2 findings, correct GHSA ids, exit 1, no false positive from the per-package shape check).

**Residual risks**
- The new guards are deliberately fail-closed against report shapes npm does not currently emit. If a future npm legitimately changes `auditReportVersion`, drops `metadata.dependencies.prod`, or emits a package with an empty `via`, this gate goes red rather than quiet. That is the intended direction, but it means an npm major is a deliberate edit here — the error messages say so.
- `metadata.dependencies.prod > 0` assumes this project always ships production dependencies. True today (333) and for any Next.js app; it would need revisiting for a package with none.
- DW-261 stands: the gate's own runner is still assembled by actions resolved through mutable tags, which is a weaker link than anything inside the script.
- Note on scope: the intent contract says not to edit `deferred-work.md`. This run's invocation explicitly instructed the opposite — append new entries only — and the two prior passes already recorded DW-259/260 the same way, so the newer instruction was followed. Existing entries were not read for duplicates, modified, or re-opened.
