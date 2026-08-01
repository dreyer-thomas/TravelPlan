# Sprint Change Proposal — 2026-08-01

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Scope classification:** Moderate — backlog reorganization, no implementation change

---

## 1. Issue Summary

Two related problems with the current epic structure surfaced while planning the
order of remaining work.

**Problem A — Story 7.10 is filed in the wrong epic.** Epic 7 is titled *"Visual
Redesign — Light Cockpit System"* and its charter states it *"re-skins existing,
already-shipped screens — it does not add product capability."* Story 7.10 is a
Node 20 → Node 24 LTS runtime upgrade covering CI workflows, the development
machine, and the deployment server. Its own context paragraph concedes the
mismatch: *"The only non-visual story in Epic 7, sequenced last on purpose."*

The practical consequence is operational. Running `bmad-loop run --epic 7` picks
up every story in the epic with status `backlog` or `ready-for-dev`, so an
infrastructure upgrade would be dispatched as part of a visual-redesign run. The
epic filter is the loop's primary sequencing control, and it is only as useful as
the epic boundaries are honest.

**Problem B — Epic 7's own token debt has no home.** Story 7.1 established the
design-token foundation. Stories 7.2 through 7.6 each hit cases where the correct
fix was a change to `theme.ts`, and each was scoped to exclude it — correctly, to
keep visual stories from turning into system-wide changes. The result is seven
deferred-work entries that all name the same fix and all defer to a
"standing design-token reconciliation pass" that was never scheduled. Two of the
seven are WCAG AA contrast failures and one is an app-wide missing keyboard focus
indicator, so this is not cosmetic cleanup.

**Evidence:**

- `epics.md:1549` — Epic 7 charter, explicitly visual-only.
- `epics.md:1786` — Story 7.10 context, self-identifying as the only non-visual story.
- `bmad-loop run --dry-run` — plans `7-10-node-24-runtime-upgrade` inside the Epic 7 queue.
- `deferred-work.md` — seven entries from the reviews of 7-2, 7-3, 7-4, 7-5 and 7-6, each deferring to the same unscheduled pass.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 7 | Loses story 7.10; gains story 7.11. Charter unchanged and now accurate — every remaining story is visual or design-system work. |
| Epic 8 (new) | Created as *Maintenance & Infrastructure*. Receives the Node upgrade as story 8.1. |
| Epics 1–6 | No impact. |

Epic 7 is currently the last epic in `epics.md` (file ends at line 1809), so
Epic 8 is a pure append. No epic renumbering is required anywhere.

### Story impact

| Story | Change |
|---|---|
| 7.10 | Renumbered to 8.1 and moved to Epic 8. Content unchanged. |
| 7.11 | New. Design-token reconciliation: contrast, focus, literal cleanup. |
| 5.8 | Cross-reference at line 234 names `7-10-node-24-runtime-upgrade` by key; must be updated to the new key. |
| 7.7 | In progress, uncommitted. Not touched by this proposal. |
| 7.8, 7.9 | `ready-for-dev`. Not touched. Both remain ahead of 7.11 in file order. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `epics.md` | Epic List section (`:120-148`) gains an Epic 8 entry; Story 7.10 section (`:1778-1809`) moves to a new Epic 8 section; new Story 7.11 section appended to Epic 7. |
| `sprint-status.yaml` | Key `7-10-node-24-runtime-upgrade` → `8-1-node-24-runtime-upgrade`, relocated to a new `epic-8` block; `7-11-design-token-reconciliation` added as `backlog`. |
| `7-10-node-24-runtime-upgrade.md` | Renamed to `8-1-node-24-runtime-upgrade.md`; internal heading updated. `baseline_commit: b18997c` and all acceptance criteria preserved verbatim. |
| `5-8-view-all-registered-system-users.md` | Cross-reference at `:234` updated to the new story key. |
| PRD | No change. Story 7.10 covers no FRs; MVP scope unaffected. |
| Architecture | No change. Its only epic reference (`:504`) is a coverage table without story granularity. |
| UX specification | No change. 7.11 revises `DESIGN.md` token values; it introduces no new screen or flow. |

### Technical impact

None. Story 7.10 has not been implemented — its status is `backlog` and its spec
file records `baseline_commit: b18997c`, which is unchanged. No code, migration,
or deployment artifact is affected by the renumbering.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment. Effort: Low. Risk: Low.**

The change is a backlog reorganization with no implemented work behind it.
Rollback (Option 2) is not applicable — nothing to revert. An MVP review
(Option 3) is not warranted — story 7.10 covers no functional requirements and
the MVP is untouched.

**Rationale.** Epic boundaries are the loop's sequencing control. `--epic 7`
should mean "finish the redesign," and today it does not. Correcting the
boundary is cheaper now, while 7.10 is unstarted, than after it has run inside a
redesign epic and muddied that epic's retrospective.

Epic 8 as *Maintenance & Infrastructure* also gives the project a standing home
for work that is neither a feature nor a redesign. That matters for what comes
after: the deferred-work ledger currently holds 41 open items, and some of its
bundles will deserve real story numbers rather than living only in a side file.

**Deliberately excluded from this proposal:** populating Epic 8 with
deferred-work stories. The ledger is entirely in the legacy pre-DW format and has
not been migrated, and `bmad-loop sweep`'s triage step exists precisely to verify
each entry against current code before anything is built — its own skill
definition warns that *"entries are often resolved by later work but never marked
done."* Authoring stories from unverified findings would skip that check, and
stories 7.8 and 7.9 will close some entries incidentally before any sweep runs.
Epic 8 is therefore created with one story; the rest is decided after the sweep.

**Why 7.11 stays in Epic 7 rather than moving to Epic 8.** It is the completion
of Epic 7's own premise, not maintenance. Story 7.1 promised one consistent token
source; stories 7.2–7.6 each had to work around it. Filing that as maintenance
would mislabel an unfinished commitment as housekeeping, and would let Epic 7
close while its foundational story remains partly unhonored.

---

## 4. Detailed Change Proposals

### 4.1 `epics.md` — Epic List section

**OLD** (after the Epic 7 entry at `:146-148`, end of section):

```markdown
### Epic 7: Visual Redesign — Light Cockpit System
Users experience the approved `DESIGN.md`/`EXPERIENCE.md` visual system across every screen instead of the current inconsistent styling — no new capability, existing screens re-skinned to the new tokens/components.
**FRs covered:** FR6, FR9, FR22 (no new FRs — implements an already-approved design spine, not new product capability)
```

**NEW** (append after it):

```markdown
### Epic 8: Maintenance & Infrastructure
The maintainer can keep the runtime, toolchain, and accumulated technical debt current without threading infrastructure work through feature or redesign epics.
**FRs covered:** None (infrastructure and maintenance; no new product capability)
```

**Rationale:** The Epic List is the document's index. A new epic that appears
only in the body would be invisible to anyone reading the top of the file.

---

### 4.2 `epics.md` — Move Story 7.10 to Epic 8

**Change:** The entire block `### Story 7.10: Node 24 LTS Runtime Upgrade — CI,
Local, and Server` (`:1778-1809`) is removed from Epic 7 and re-emitted under a
new `## Epic 8: Maintenance & Infrastructure` section appended to the end of the
file, renumbered as `### Story 8.1`.

Two lines inside the block change:

**OLD:**
```markdown
### Story 7.10: Node 24 LTS Runtime Upgrade — CI, Local, and Server
```
**NEW:**
```markdown
### Story 8.1: Node 24 LTS Runtime Upgrade — CI, Local, and Server
```

**OLD:**
```markdown
**Context:** The only non-visual story in Epic 7, sequenced last on purpose. Node 20 reached end-of-life around Apr 2026 …
```
**NEW:**
```markdown
**Context:** Node 20 reached end-of-life around Apr 2026 …
```
…continuing with the sentence *"A bump landed mid-epic would put a variable
underneath in-flight UI work, which is why this waits for 7.9."* retained — the
dependency on 7.9 survives the move and is now a cross-epic dependency.

All acceptance criteria, the compatibility evidence (405 `engines.node`
declarations, `better-sqlite3@12.6.2` ABI prebuilds), and the deployment-doc
requirement are preserved verbatim.

**Rationale:** The story's substance is correct and well-researched; only its
filing is wrong. Rewriting it would risk losing the compatibility analysis.

---

### 4.3 `epics.md` — New Story 7.11

**NEW** (appended to Epic 7, after Story 7.9):

```markdown
### Story 7.11: Design Token Reconciliation — Contrast, Focus, and Literal Cleanup

As a developer and as a keyboard or low-vision user,
I want the design tokens established in Story 7.1 to be the single source of truth for color, contrast, and focus across every screen,
So that retheming does not require editing component bodies, and so that the accessibility floor `EXPERIENCE.md` promises is actually met.

**FRs covered:** None (completes Story 7.1's token foundation; closes 7 deferred-work entries from Stories 7.2–7.6)

**Context:** Story 7.1 established the token foundation. Stories 7.2 through 7.6
each encountered a case whose correct fix lived in `theme.ts`, and each was
scoped to exclude it — deliberately, to stop visual stories from becoming
system-wide changes. Seven deferred-work entries resulted, each deferring to a
"standing design-token reconciliation pass." This is that pass. It is the last
story in Epic 7 because it needs every screen's literals visible before it can
decide which are tokens; it therefore runs after 7.9.

Two of its acceptance criteria are **design-system decisions, not implementation
details** — the source of truth conflicts with itself and the story cannot
proceed until each is settled. Both are called out explicitly below.

**Acceptance Criteria:**

**Given** the mockups prescribe `#FBF6EE` for the day-row gap background while `DESIGN.md`'s token table defines `warnBg` as `#F6ECE0` — two values for one surface
**When** the conflict is resolved
**Then** `DESIGN.md`'s token table is updated to record the single agreed value, and no component defines a near-duplicate of it
**And** `DAY_ROW_GAP_BG` and `HERO_SCRIM` (`TripTimeline.tsx:153`) and `ROW_GAP_BG` / `NEUTRAL_PILL_BG` (`TripIcons.tsx:202-215`) are replaced by token references, so that no background color is exported from an icon module

**Given** `tokens.inkMuted` is `#8A8677`, which measures 3.65:1 against `tokens.card` `#FFFFFF` and is rendered at 10px on the Day Detail coverage axis
**When** the token is corrected
**Then** it meets the 4.5:1 WCAG AA floor for normal text at every size it is used, and the change is applied at the token level rather than per screen

**Given** `DESIGN.md` prescribes `trip-row.opacity-past: 0.78` as the *entire* archival treatment, which composites 12px `inkSoft` text to roughly 3.4:1 and fails the same floor
**When** the archival treatment is redecided
**Then** `DESIGN.md` records the chosen approach — a higher opacity, opacity confined to the photo and border, or a darker `inkSoft` — and past trip rows and their "Completed" pills meet AA
**And** the treatment is defined once in the design system rather than per surface, so no future screen re-derives it

**Given** `theme.ts` replaces the entire MUI `shadows` array with `"none"` except index 24, and MUI's contained-button focus indicator is `shadows[6]`
**When** the focus treatment is added
**Then** every `variant="contained"` button in the app shows a visible keyboard focus indicator via an explicit `MuiButton` `&.Mui-focusVisible` treatment, satisfying `EXPERIENCE.md`'s Accessibility Floor
**And** the auth-local workaround `src/components/features/auth/authSubmitSx.ts` (`AUTH_SUBMIT_SX`) is deleted rather than left as a second source of truth

**Given** `theme.ts` defines `primary`, `secondary` and `warning` but no `error` palette entry, so `<Alert severity="error">` renders MUI's default `#d32f2f` and `severity="success"` its default green — two colors absent from the token set
**When** the palette gains an `error` entry
**Then** it uses the existing `colors.errorBorder` `#C97A3E` already used for input error borders, and an `MuiAlert` treatment applies it, so alerts in every dialog draw from tokens
**And** no component-local `sx` override is introduced to achieve this

**Given** `HouseIcon`, `WarningTriangleIcon`, `ChevronRightIcon` and `ShareGlyphIcon` are private to `TripTimeline.tsx` (`:92-151`) while other screens need the same glyphs
**When** they are extracted to the shared icon module
**Then** they live alongside the existing glyph set in `TripIcons.tsx` and type their style prop as `SxProps<Theme>` rather than `sx?: object`, so style-key typos are caught

**Given** the seven deferred-work entries this story closes
**When** the story's spec is written
**Then** its frontmatter declares `closes_deferred:` with their DW ids, so the ledger is annotated at commit rather than left stale

**Note:** the `closes_deferred` declaration requires the deferred-work ledger to
have been migrated to the canonical `DW-<n>` format first. If the migration has
not run when this story is specced, the final criterion is dropped and the
entries are closed by a later sweep instead.
```

**Rationale:** Seven ledger entries, seven acceptance criteria — the mapping is
one-to-one so nothing is silently absorbed or dropped. The two decision-shaped
criteria are stated as decisions so the story does not stall mid-implementation.

---

### 4.4 `sprint-status.yaml`

**OLD:**
```yaml
  epic-7: in-progress
  …
  7-9-full-page-map-screens-redesign: ready-for-dev
  7-10-node-24-runtime-upgrade: backlog
  epic-7-retrospective: optional
```

**NEW:**
```yaml
  epic-7: in-progress
  …
  7-9-full-page-map-screens-redesign: ready-for-dev
  7-11-design-token-reconciliation: backlog
  epic-7-retrospective: optional

  epic-8: backlog
  8-1-node-24-runtime-upgrade: backlog
  epic-8-retrospective: optional
```

**Rationale:** The loop reads this file in **file order** (`next_actionable`:
*"First story in file order whose status allows starting work"*), so placing the
`epic-8` block after `epic-7` encodes the agreed sequence structurally. Story
7.11 sits after 7.9 for the same reason.

---

### 4.5 Story spec file rename

`git mv _bmad-output/implementation-artifacts/7-10-node-24-runtime-upgrade.md \
        _bmad-output/implementation-artifacts/8-1-node-24-runtime-upgrade.md`

**OLD** (`:5`): `# Story 7.10: Node 24 LTS Runtime Upgrade (CI, Local, Server)`
**NEW** (`:5`): `# Story 8.1: Node 24 LTS Runtime Upgrade (CI, Local, Server)`

Frontmatter (`baseline_commit: b18997c`), status, and all acceptance criteria
unchanged.

---

### 4.6 `5-8-view-all-registered-system-users.md:234`

**OLD:**
> …do not bundle upgrades into this story (a Node 24 runtime upgrade is separately tracked as story `7-10-node-24-runtime-upgrade`).

**NEW:**
> …do not bundle upgrades into this story (a Node 24 runtime upgrade is separately tracked as story `8-1-node-24-runtime-upgrade`).

**Rationale:** Story 5.8 is `ready-for-dev`. A dev session reading a dangling
story key would have to work out for itself whether the reference is stale or the
story is missing.

---

## 5. Implementation Handoff

**Scope: Moderate** — backlog reorganization across planning and implementation
artifacts. No code changes, no implemented work reverted.

| Task | Owner | Artifact |
|---|---|---|
| Epic List entry for Epic 8 | PM (John) | `epics.md:120-148` |
| Move 7.10 → Epic 8 as 8.1 | PM (John) | `epics.md` |
| Author Story 7.11 section | PM (John) | `epics.md` |
| Rename spec file + heading | PM (John) | `implementation-artifacts/` |
| Fix 5.8 cross-reference | PM (John) | `5-8-…md:234` |
| Update sprint status | PM (John) | `sprint-status.yaml` |
| Write the 7.11 story spec | SM / `bmad-create-story` | later, before 7.11 is dispatched |
| Write 2.31 / 2.32 specs | SM / `bmad-create-story` | later, before Epic 2 resumes |

### Success criteria

1. `bmad-loop run --epic 7 --dry-run` lists only visual and design-system stories — no Node upgrade.
2. `bmad-loop run --epic 8 --dry-run` lists `8-1-node-24-runtime-upgrade`.
3. No reference to the key `7-10-node-24-runtime-upgrade` remains anywhere in the repository.
4. Each of the seven deferred-work entries named in Section 4.3 maps to exactly one acceptance criterion of Story 7.11.

### Sequencing after this change

```
7-7 (in progress, uncommitted)  →  7-8  →  7-9  →  7-11
   →  2-31  →  2-32                    [Epic 2, specs needed]
   →  8-1                              [Epic 8, spec exists]
   →  ledger migration  →  bmad-loop sweep
```

Story 8.1's own context requires it to land after 7.9 so a runtime change does
not sit underneath in-flight UI work. That dependency is now cross-epic and is
satisfied by this ordering.

---

## 6. Open Items

- **`7-11`'s two decision criteria** (the `#FBF6EE` / `warnBg` conflict and the past-row archival treatment) need Tommy's ruling before the story is specced. They are design-system calls, not implementation choices.
- **Deferred-work ledger migration** remains unscheduled. It is a prerequisite for `closes_deferred:` to work on Story 7.11 and for any sweep to see the 41 open entries.
- **Epic 2's remaining stories** (2.31, 2.32) have no spec files. They should be authored before Epic 2 resumes, and the backup format contract deserves attention against the shipped 2.9 / 2.10 behavior.
