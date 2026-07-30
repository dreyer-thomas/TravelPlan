# Editorial Review — Prose

Role: clinical copy-editor, Microsoft Writing Style Guide baseline. Scope: narrative prose only (frontmatter YAML, `{path.to.token}` reference syntax, hex/CSS literals, and quoted UI-copy table cells were excluded per the task's skip rule). Author voice — direct, confident, occasionally opinionated, per each doc's own Brand & Style / Voice and Tone sections — was preserved; no rewrites for preference.

## DESIGN.md

| Original Text | Revised Text | Changes |
|---|---|---|
| "All numeric values that appear in a list or **need to compare visually**" | "All numeric values that appear in a list or **need to be compared visually**" | Active/passive mismatch — values don't "compare," they get "compared." Minimal voice correction. |
| "the active tab gets a white fill and {components.tab.activeShadow}**,** inactive tabs are transparent with {colors.ink-soft} text." | "the active tab gets a white fill and {components.tab.activeShadow}**;** inactive tabs are transparent with {colors.ink-soft} text." | Comma splice joining two independent clauses — replaced comma with semicolon. |

## EXPERIENCE.md

| Original Text | Revised Text | Changes |
|---|---|---|
| "Thumbnails are always **uniform size** within their strip" | "Thumbnails are always **uniform in size** within their strip" | Missing preposition — "uniform" takes "in size" as a predicate adjective. |
| "\`auth-tabs\` **toggle** between sign-in and registration state" | "\`auth-tabs\` **toggles** between sign-in and registration state" | Subject–verb agreement — "auth-tabs" names one component (singular referent) and takes a singular verb, consistent with its usage as a single component elsewhere in both docs. |
| "stat-strip immediately shows 12 Tage, 5 Stationen, €2.340 Kosten bisher, and — in warn color — **1 Offene Punkte**." | "...and — in warn color — **1 Offener Punkt**." | German number agreement — "1" takes the singular "Offener Punkt," not plural "Offene Punkte." (Consistent with this doc's own correctly-singularized "1 Tag offen" example a few lines away, in the Voice and Tone table and in Flow 3.) |
| "...but has no edit affordances available to her — Viewer role per PRD FR30 ("Viewers can see the trip plan but cannot edit core details"; the same permission is numbered FR23 in epics.md's own, differently-ordered FR scheme — prd.md is the citation of record here) **can see the plan but not change core details**." | "...but has no edit affordances available to her — Viewer role per PRD FR30 ("Viewers can see the trip plan but cannot edit core details"; the same permission is numbered FR23 in epics.md's own, differently-ordered FR scheme — prd.md is the citation of record here)." | Dangling/redundant trailing clause — "Viewer role... can see the plan" has no grammatical subject that can "see" (a role doesn't see), and the clause duplicates the quoted text immediately before it. Removed the stray restatement; no information is lost since the same fact is already stated in the quoted FR30 text. |

### Flagged — not applied (per Principle 4: query rather than guess)

These read as possible inconsistencies but resolving them requires a content/product judgment call, not a prose fix, so no edit was made:

- **EXPERIENCE.md line 19** — "fixed ~1080px browser-frame compositions for all five surfaces" appears to undercount: the Information Architecture table (EXPERIENCE.md lines 27–37) lists nine surfaces (Screens A–I). "Five" may be a stale reference predating Screens F–I being added back into scope (see line 39's note about panels "added back... in this pass"). Recommend the document owner confirm whether "five" should read "nine," or whether "surfaces" here means something narrower (e.g., mockup files, not screens).
- **"N Tage offen" vs. "1 Tag offen"** — DESIGN.md line 239 and EXPERIENCE.md lines 80/83 define the `trip-status.gap` pill's fixed template as "N Tage offen" (plural noun regardless of N), while EXPERIENCE.md's own usage examples (Voice and Tone table line 55, Flow 3 line 138) show "1 Tag offen" (singular, grammatically agreeing with N=1). This may be a deliberate "always-plural label" product decision or an unresolved inconsistency between the component spec and its own examples — flagging for the document owner rather than unilaterally picking one form, since it affects an actual UI copy template, not just narrative prose.

## Summary

- DESIGN.md: 2 fixes applied.
- EXPERIENCE.md: 4 fixes applied (2 flagged as queries, not applied).
