# Sprint Change Proposal - TravelPlan

**Date:** 2026-02-12  
**Prepared by:** Scrum Master (Correct Course workflow)  
**Trigger:** Implementation Readiness Assessment (2026-02-12)

## 1. Issue Summary
The implementation readiness review (Winston, 2026-02-12) identified inconsistencies across PRD, UX, epics, and architecture that could cause implementation churn. Specifically: conflicting performance target references, unclear accessibility target, missing restore/import story coverage, and missing routing-service setup/fallback for map-based routes.

## 2. Impact Analysis

### Epic Impact
- **Epic 2 (Core Trip Planning):** add restore/import story to satisfy backup/restore requirement.
- **Epic 3 (Route & Map-Based Planning):** add routing service setup and fallback story to ensure routing dependencies are explicit.
- **Epic 1/4:** no direct changes required.

### Story Impact
- **New Story 2.10:** Restore/Import Trip Data from JSON.
- **New Story 3.4:** Routing Service Setup and Fallback Strategy.

### Artifact Conflicts
- **PRD:** Accessibility target corrected to “no formal standard required.” Performance target remains 15 seconds (already correct in PRD).
- **Architecture (planning artifact):** remove incorrect note about PRD containing 115 seconds.
- **UX Design:** accessibility section aligned to “no formal standard required,” retaining best-practice guidance.

### Technical Impact
- No code changes yet. Primarily documentation alignment and story coverage improvements.

## 3. Recommended Approach
**Selected Path:** Option 1 — Direct Adjustment.

**Rationale:** Changes are documentation and story additions only. No implementation rollback required. Low risk, minimal effort, and resolves readiness blockers.

**Effort:** Low  
**Risk:** Low  
**Timeline Impact:** Minimal; can proceed once docs are aligned and readiness report is regenerated.

## 4. Detailed Change Proposals

### PRD Updates
**Section:** Accessibility Level

OLD:
- WCAG 2.1 AA target

NEW:
- No formal accessibility standard required at this stage; follow basic best practices (contrast, focus states, keyboard access).

Rationale: Owner confirmed no formal accessibility requirement; avoid enforcing WCAG AA.

### Architecture Updates (planning artifact)
**Section:** Requirements Overview

OLD:
- Performance targets: trip load around 15 seconds (note PRD also states 115 seconds, needs resolution)

NEW:
- Performance targets: trip load around 15 seconds

Rationale: PRD has 15s; 115s was incorrect.

### UX Design Updates
**Section:** Accessibility Strategy

OLD:
- Target: WCAG AA.

NEW:
- No formal accessibility standard required at this stage. (Retain best-practice guidance.)

Rationale: Align UX with updated PRD accessibility position.

### Epics/Stories Updates
**Epic 2:** Add Story 2.10 Restore/Import Trip Data from JSON

**Epic 3:** Add Story 3.4 Routing Service Setup and Fallback Strategy

Rationale: Address readiness report gaps (restore/import missing; routing dependency unclear).

## 5. Implementation Handoff

**Scope Classification:** Minor

**Handoff Recipients:**
- **Scrum Master/Product Owner:** update backlog with new stories and revised acceptance criteria.
- **Architecture/UX Owner:** confirm updated accessibility position aligns with intent.
- **Dev Team:** proceed with implementation once updated readiness report confirms alignment.

**Success Criteria:**
- PRD/UX/Architecture/epics are aligned to 15s performance target and “no formal accessibility standard.”
- Restore/import and routing setup stories exist in Epic 2/3.
- Updated implementation readiness report shows no critical blockers.
