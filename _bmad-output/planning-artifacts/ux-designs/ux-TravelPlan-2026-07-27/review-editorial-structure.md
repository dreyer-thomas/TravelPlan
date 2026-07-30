# Editorial Review — Structure

Reviewed: `DESIGN.md`, `EXPERIENCE.md` (both `status: final`, `updated: 2026-07-30`)
reader_type: humans (human-primary, precision aids preserved) · length_target: none (reference/spec judgment call)

This file is the pre-application record: both files' analysis as produced, followed by what was actually applied. Content was never altered in meaning — only reorganized, cross-referenced, or trimmed of duplicated narration. One factual inconsistency was found (state count mismatch) and left as an inline `[QUESTION FOR UX]` marker rather than resolved by guessing.

---

## DESIGN.md

### Document Summary
- **Purpose:** This document exists to help developers and future designers implementing/extending the TravelPlan UI accomplish precise, consistent visual implementation (color, type, spacing, elevation, shape, and component specs) without guessing token values or re-litigating settled design decisions.
- **Audience:** Developers and future designers implementing/extending the TravelPlan UI (human-primary; also consumed by downstream AI dev-agents).
- **Reader type:** humans
- **Structure model:** Reference/Database (token spec + component swatches, random access; MECE, consistent schema per token/component).
- **Current length:** ~3,142 words total — 394 words frontmatter (YAML token block) + 2,748 words prose body across 8 sections + 1 subsection.

**Section word counts (body):**
| Section | Words |
|---|---|
| Brand & Style | 254 |
| Colors | 388 |
| Typography | 171 |
| Layout & Spacing | 141 |
| Elevation & Depth | 130 |
| Shapes | 116 |
| Components (incl. Photo Alt-Text) | 916 + 192 |
| Do's and Don'ts | 440 |

### Flow Analysis
Section order is **Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts** — this matches the canonical spine order exactly. No MOVE recommendations.

### Recommendations

#### 1. PRESERVE — Frontmatter token block vs. prose restatement of values (e.g., hex codes in Colors, px values in Layout & Spacing, Typography)
**Rationale:** This looked like candidate duplication (same fact — e.g. `#EFEAE0` — appears in both the YAML frontmatter and the prose body) but on inspection it serves two different audiences: the frontmatter is the machine-readable token database, while the prose pairs each value with the *usage rule* (why this color, when to use it, what it must never be used for) that doesn't exist in frontmatter at all. Removing the inline value would force constant cross-referencing back to frontmatter, hurting the "random access" trait this Reference/Database document needs.
**Impact:** 0 words (no change)
**Comprehension note:** Cutting this would harm scanability for a document whose whole job is precision lookup — correctly not a duplication in the harmful sense.

#### 2. CONDENSE — Do's and Don'ts: redundant-stat-removal bullet
**Rationale:** DESIGN.md's bullet fully re-narrates the same two examples (hero-photo stat-pills, "Heute im Überblick" card) that EXPERIENCE.md's Component Patterns "redundant-stat removal principle" row already documents in full, including the reasoning. The immediately preceding bullet (neutral-marker rule) already uses the correct pattern for this situation — state the rule, cross-reference EXPERIENCE.md for the full rationale — so this bullet was brought in line with that established pattern.
**Impact:** ~-30 words

#### 3. CONDENSE — Do's and Don'ts: hero-photo real-photography stress-test bullet
**Rationale:** The "learned empirically by swapping a real photo asset" story is told in full here and again, nearly verbatim, in EXPERIENCE.md's Component Patterns "hero-photo scrim-strengthening rule" row. EXPERIENCE.md is the better home for the full empirical narrative (it's doing forward-looking behavioral-spec work with it — "any new hero photo... must keep this 4-stop treatment"); DESIGN.md keeps the decision statement and a pointer.
**Impact:** ~-18 words

#### 4. QUESTION — Components: badge/pill entry states trip-status pill has "three states," contradicting the rest of the spine
**Rationale:** DESIGN.md's own `Components` entry for badge/pill (trip-status) enumerates **three** states (accent / warn / neutral, with "bevorstehend"/"abgeschlossen" folded into one neutral state). But DESIGN.md's own `trip-row` entry two lines later says "four states — see EXPERIENCE.md.State Patterns," and EXPERIENCE.md's State Patterns "Trip status variants" row and Component Patterns "trip-row" row both consistently describe **four** distinct states (gap / fully-planned / upcoming-unplanned / past-completed). This is a genuine content inconsistency, not an organizational one — resolving it means picking which count is correct, which is a product/content decision outside a structural editor's remit. Left as an inline `[QUESTION FOR UX]` marker at the point of contradiction rather than silently resolved.
**Impact:** 0 words net (marker added, no content removed)
**Comprehension note:** Left unresolved on purpose — flagging protects against an implementer picking the wrong count instead of confirming with product.

### Summary (DESIGN.md)
- **Total recommendations:** 4 (1 PRESERVE, 2 CONDENSE, 1 QUESTION)
- **Estimated reduction:** ~48 words cut, ~69 words added as a fully-specified question marker → **net ≈ +21 words** (actual, post-application; <1% of body)
- **Meets length target:** No target specified — reductions are duplication-driven, not length-driven
- **Comprehension trade-offs:** None — all cuts remove a second copy of information that remains available (via cross-reference) elsewhere in the same two-document pair

---

## EXPERIENCE.md

### Document Summary
- **Purpose:** This document exists to help developers and future designers implementing/extending the TravelPlan UI accomplish correct behavioral and structural implementation — information architecture, voice, component/state behavior, interaction rules, the accessibility floor, and end-to-end flows — the layer DESIGN.md's visual tokens alone can't specify.
- **Audience:** Developers and future designers implementing/extending the TravelPlan UI.
- **Reader type:** humans
- **Structure model:** Hybrid — Reference/Database for Component Patterns and State Patterns (random access, consistent row schema); Explanation/Conceptual for Foundation, Voice and Tone, and Key Flows (narrative, needs scaffolding/mental model before detail).
- **Current length:** ~4,580 words across 8 sections.

**Section word counts:**
| Section | Words |
|---|---|
| Foundation | 204 |
| Information Architecture | 489 |
| Voice and Tone | 125 |
| Component Patterns | 1,109 |
| State Patterns | 613 |
| Interaction Primitives | 272 |
| Accessibility Floor | 356 |
| Key Flows (5 flows) | 1,358 |

### Flow Analysis
Section order is **Foundation → IA → Voice and Tone → Component Patterns → State Patterns → Interaction Primitives → Accessibility Floor → Key Flows** — matches the canonical spine order exactly. No MOVE recommendations. Within Key Flows, all five flows follow a consistent Steps → Climax → Failure-mode schema — good scaffolding consistency, no changes needed.

### Recommendations

#### 1. MERGE — State Patterns: "Open-gap day" row into "Missing accommodation (gap day)" row
**Rationale:** These are two table rows for the same state. The "Open-gap day" row's own text says so explicitly ("See 'Missing accommodation' above — the same state, described from the day-detail side"). It contributes exactly one new fact (the day-detail timeline can still be partially filled even though the day is flagged) that doesn't need a whole extra row. Merging restores one-state-per-row (MECE) for this Reference-model table without losing the fact. The row label was kept as a compound ("Missing accommodation / open-gap day") so a reader searching either term still finds it.
**Impact:** ~-15 words
**Comprehension note:** None — no information lost, table gets easier to scan (one fewer near-duplicate row to reconcile mentally).

#### 2. CONDENSE — Key Flows, Flow 3: comments/voting scope-cut citation restated in full
**Rationale:** The note explaining why Flow 3 omits the PRD's "add a comment" step (FR31) re-states the entire citation — `.memlog.md`, Epic 5/6 backlog routing, John/PM processing — that is already given in full in Information Architecture's own comments/voting note earlier in the same document. Flow 3 keeps its flow-specific point (this step is deliberately missing here, and why) and points back to IA instead of repeating the citation.
**Impact:** ~-40 words

#### 3. PRESERVE — Component Patterns: hero-photo scrim-strengthening rule (empirical origin story)
**Rationale:** This is the canonical, full version of the "real photo asset stress-test added the top scrim stop" story; DESIGN.md's shorter copy of the same story was condensed to a pointer here (see DESIGN.md rec #3) rather than cutting both. Keeping one full narrative version, in the file whose job is behavioral rationale, satisfies "one source of truth" without losing the explanation anywhere.
**Impact:** 0 words (kept as the canonical copy)

#### 4. PRESERVE — [ASSUMPTION]-flagged and "not pixel-mocked" state rows (Empty bucket list, Cold load, Save-failure/error feedback) and flow failure-mode notes
**Rationale:** These explicitly mark the boundary between "specified by mockup" and "reasonable convention, not yet confirmed." This is exactly the kind of load-bearing scope information the review brief calls out as must-not-bury — cutting or shortening it for density would quietly convert an honest gap-flag into an implied spec.
**Impact:** 0 words

#### 5. PRESERVE — Repetition of the 44px touch-target rule across multiple Component Patterns rows and Accessibility Floor
**Rationale:** Looks like duplication at a glance, but each occurrence is a different component's row in a Reference/Database table where "consistent schema, random access" means each row must stand alone — a reader opening only the `checkbox` row shouldn't have to jump elsewhere to learn its target size. Accessibility Floor's mention is the aggregate summary, not a third repetition of the same sentence.
**Impact:** 0 words

### Summary (EXPERIENCE.md)
- **Total recommendations:** 5 (1 MERGE, 1 CONDENSE, 3 PRESERVE)
- **Estimated reduction:** ~-56 words (actual, post-application; <2% of document)
- **Meets length target:** No target specified — reductions are duplication-driven, not length-driven
- **Comprehension trade-offs:** None — the MERGE keeps the added fact, the CONDENSE keeps the flow-local point; only the second copy of a citation/description is removed

---

## Cross-File Notes

- **State-count inconsistency (DESIGN.md Components badge/pill vs. everywhere else):** logged as `[QUESTION FOR UX]` in DESIGN.md only (see DESIGN.md rec #4) since EXPERIENCE.md's own mentions are internally consistent at four states — the contradiction is local to one DESIGN.md sentence.
- **Hero-photo empirical story:** kept in one place (EXPERIENCE.md, Component Patterns) with DESIGN.md's Do's and Don'ts pointing to it, rather than trimming both copies to nothing or leaving both in full.
- **Comments/voting removal citation:** kept in full in EXPERIENCE.md's Information Architecture (its natural first-mention home) and DESIGN.md's Do's and Don'ts (different document, so not true duplication); only Flow 3's second, same-document restatement was condensed.
- No CUT recommendations in either file — both documents' sections earn their place against the stated purpose; this is consistent with the brief's note that this is a carefully negotiated spec and the review should be conservative.

## Total Impact (actual, post-application)
- **DESIGN.md:** 3,142 → 3,163 words (net **+21**). Two CONDENSE edits removed ~48 words of duplicated narration; the inline `[QUESTION FOR UX]` marker added ~69 words (it names the exact contradiction and both files it spans, so a future reader doesn't have to re-derive it) — net movement is a small increase, not a reduction, because resolving the flagged inconsistency was correctly left to product/UX rather than trimmed away.
- **EXPERIENCE.md:** 4,580 → 4,524 words (net **-56**). One MERGE (two State Patterns rows → one) and one CONDENSE (Flow 3's repeated citation → cross-reference) account for the reduction.
- **Tokens, component rows, state rules, and flow steps:** zero removed — every recommendation was CONDENSE/MERGE of narrated duplication, or a QUESTION marker where content was ambiguous, per the conservative brief.
