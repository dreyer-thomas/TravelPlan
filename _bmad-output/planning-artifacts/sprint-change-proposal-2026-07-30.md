---
date: 2026-07-30
trigger: 'Product decision — discontinue comments and voting feature'
mode: incremental
status: approved
---

# Sprint Change Proposal — TravelPlan

**Author:** John (PM), with Tommy
**Date:** 2026-07-30

## 1. Issue Summary

While reviewing the JSON export/import gap and, separately, running a UX design pass on the core screens, Tommy decided the comments and voting feature (added across Epic 5 and Epic 6) should be **discontinued and removed from the product**. This is not a bug or technical limitation — it is a deliberate scope reduction. The feature is already fully built and marked `done` across 7 stories, so this is a removal of shipped functionality, not a cancelled plan.

Evidence this is intentional and already load-bearing elsewhere: the concurrent UX design pass (`ux-designs/ux-TravelPlan-2026-07-27/`) independently produced `DESIGN.md`/`EXPERIENCE.md` spines with zero comments/voting UI, and `EXPERIENCE.md` already cross-references this exact decision.

## 2. Impact Analysis

### Epic impact
- **Epic 5 — Sharing & Light Contribution**: Stories 5.5 ("Edit Own Comments") and 5.7 ("Limit Voting to Day Items") removed outright. Story 5.3 ("Viewer Access With Comments and Votes") split — its view-only-access half survives as the revised Story 5.3 ("Viewer Read-Only Access", FR23 only); its comments/votes half is dropped. Sharing/roles themselves (5.1, 5.2, 5.4, 5.6) are **unaffected** — only comments/voting is in scope, not collaboration.
- **Epic 6 — Usability Refinements**: Stories 6.1, 6.2, 6.3 removed outright (all three were UX refinements *of* the feedback system, now moot).
- **Epic 4 — Trip Bucket List**: Story 4.7 ("Comments in Dialog") removed outright.
- New **Story 5.9 — Remove Comments & Voting Feature** added to Epic 5: the actual code-removal work (Prisma models, API routes, UI components, orphaned i18n strings).

### Artifact conflicts
- **PRD** (`prd.md`): FR31 ("Viewers can add comments or suggestions to days or items") marked removed, with an `editHistory` entry. Konni's persona-journey climax, built entirely around commenting, is left as an open `[OPEN]` marker — Tommy chose not to invent a replacement engagement moment right now (see Detailed Change Proposals). Journey Requirements Summary bullet updated to drop the comments/suggestions clause.
- **Epics** (`epics.md`): FR24 (this file's own numbering for the same requirement) marked removed in the Functional Requirements list, the FR Coverage Map, and both Epic 5's and Epic 6's "FRs covered" summary lines.
- **Architecture**: Real data-model impact — `TripFeedbackTarget`/`TripFeedbackComment`/`TripFeedbackVote` Prisma models (verify exact names in `travelplan/prisma/schema.prisma`) and their API routes need removal. This is genuine code work, captured as Story 5.9's acceptance criteria, not yet executed.
- **UX**: No conflict — already resolved ahead of this proposal by the concurrent UX pass.

### Not in scope for this change
FR numbering between `prd.md` and `epics.md` was found to already be inconsistent (`epics.md` numbers a full requirement lower than `prd.md` throughout the sharing section) — this predates this change and was not introduced by it. Left as-is; not this proposal's concern. Story 6.4's stray FR24 citation (unrelated to comments — it's about accommodation-cost display) is a pre-existing mistagging, also left alone.

## 3. Recommended Approach

**Direct Adjustment** (Option 1): mark the affected stories as removed in place (preserving what was actually built, for history) rather than deleting them or rolling back git history, and add one new story to execute the actual code removal.

- **Effort:** Medium (Story 5.9's actual implementation — schema migration + route + UI removal — is real dev work, not yet done)
- **Risk:** Low (pure subtraction, no data migration of *existing* content needed, no dependency from other still-active features on the feedback system)
- **Rationale:** Preserves an honest build history, avoids the higher-risk alternative of rewriting git history via rollback, and keeps the change fully traceable from PRD → epics → sprint-status → (eventually) code.

## 4. Detailed Change Proposals

All of the following were reviewed incrementally with Tommy and approved before being applied.

### PRD (`prd.md`)
| Section | Change |
|---|---|
| Functional Requirements | FR31 struck through + removal note |
| editHistory | New 2026-07-30 entry added |
| Konni persona journey — Climax | Comment-specific climax replaced with an explicit `[OPEN]` marker; Tommy chose to leave Konni's post-removal engagement model unresolved for now rather than invent one on the spot |
| Journey Requirements Summary | "Viewer and contributor access with optional comments/suggestions" → "Viewer and contributor access (view-only vs. full-edit contributor role)" |

### Epics (`epics.md`)
| Story | Change |
|---|---|
| 4.7 Comments in Dialog | Marked REMOVED, text retained for history |
| 5.3 Viewer Access With Comments and Votes | Replaced with revised "5.3 Viewer Read-Only Access" (FR23 only) |
| 5.5 Edit Own Comments | Marked REMOVED |
| 5.7 Limit Voting to Day Items | Marked REMOVED |
| 5.9 (new) Remove Comments & Voting Feature | Added — dev-facing removal story |
| 6.1 Remove Trip Overview Header Feedback | Marked REMOVED/SUPERSEDED |
| 6.2 Feedback as Chat | Marked REMOVED |
| 6.3 Optimize Comments | Marked REMOVED |
| Requirements Inventory / FR Coverage Map | FR24 struck through in both places |
| Epic 5 & Epic 6 summary lines | FR24 dropped from both "FRs covered" lists |

### Implementation tracking (`sprint-status.yaml`)
- Removed tracking rows for 5-5, 5-7, 6-1, 6-2, 6-3 (history stays in `epics.md`, not duplicated in the status file)
- Renamed `5-3-viewer-access-with-comments-and-votes` → `5-3-viewer-read-only-access`
- Added `5-9-remove-comments-and-voting-feature: backlog`
- Note: `5-8-view-all-registered-system-users` (added earlier this session, unrelated) was already occupying "5.8", which is why the new removal story is numbered 5.9, not 5.8

## 5. Implementation Handoff

**Scope classification: Moderate.** Backlog/PRD reorganization is complete (this proposal); what remains is bounded, well-specified code removal — no fundamental replan needed.

**Routed to:** Developer agent, via Story 5.9.

**Developer responsibilities:**
1. Remove `TripFeedbackTarget`/`TripFeedbackComment`/`TripFeedbackVote` (verify exact model names) from `travelplan/prisma/schema.prisma` + generate/apply migration
2. Remove all API routes serving comments/votes
3. Remove UI: comment dialogs, vote widgets, feedback trigger buttons/badges — across every screen that showed them (trip overview header, day items, accommodations)
4. Clean up orphaned i18n strings (`en.ts`/`de.ts`) tied to comments/votes

**Success criteria:** No comments/voting code, routes, schema, or UI remain in the codebase; existing trips/data unaffected; no regressions in the surrounding features (sharing, day view, budget) that were adjacent to the removed feedback UI.

**Next step:** Run `bmad-create-story` for Story 5.9 when ready to implement, or `bmad-dev-story` directly against this proposal.
