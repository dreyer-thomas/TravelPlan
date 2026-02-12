---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/product-brief-TravelPlan-2026-02-11.md
  - /Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md
  - /Users/tommy/Development/TravelPlan/docs/index.md
  - /Users/tommy/Development/TravelPlan/docs/project-overview.md
  - /Users/tommy/Development/TravelPlan/docs/architecture.md
  - /Users/tommy/Development/TravelPlan/docs/architecture-patterns.md
  - /Users/tommy/Development/TravelPlan/docs/technology-stack.md
  - /Users/tommy/Development/TravelPlan/docs/deployment-configuration.md
  - /Users/tommy/Development/TravelPlan/docs/deployment-guide.md
  - /Users/tommy/Development/TravelPlan/docs/development-guide.md
  - /Users/tommy/Development/TravelPlan/docs/development-instructions.md
  - /Users/tommy/Development/TravelPlan/docs/contribution-guidelines.md
  - /Users/tommy/Development/TravelPlan/docs/project-structure.md
  - /Users/tommy/Development/TravelPlan/docs/critical-folders-summary.md
  - /Users/tommy/Development/TravelPlan/docs/component-inventory.md
  - /Users/tommy/Development/TravelPlan/docs/ui-component-inventory-root.md
  - /Users/tommy/Development/TravelPlan/docs/state-management-patterns-root.md
  - /Users/tommy/Development/TravelPlan/docs/data-models-root.md
  - /Users/tommy/Development/TravelPlan/docs/api-contracts-root.md
  - /Users/tommy/Development/TravelPlan/docs/comprehensive-analysis-root.md
  - /Users/tommy/Development/TravelPlan/docs/project-parts-metadata.md
  - /Users/tommy/Development/TravelPlan/docs/source-tree-analysis.md
  - /Users/tommy/Development/TravelPlan/docs/user-provided-context.md
  - /Users/tommy/Development/TravelPlan/docs/existing-documentation-inventory.md
  - /Users/tommy/Development/TravelPlan/docs/project-scan-report.json
workflowType: 'architecture'
project_name: 'TravelPlan'
user_name: 'Tommy'
date: '2026-02-12T07:37:18Z'
lastStep: 8
status: 'complete'
completedAt: '2026-02-12T08:05:30Z'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
TravelPlan’s functional scope centers on user accounts, trip CRUD, and day-level planning. The core entities are trips with a date range, daily accommodations (status, link, cost), and daily plans (rich text + links). There is also a viewer role with comment/suggestion capabilities and a lightweight budget roll-up. Architecturally, this implies a persistent data model with per-user tenancy boundaries, day-indexed content, and optional shared access.

**Non-Functional Requirements:**
- GDPR-aligned data handling and privacy expectations
- Secure authentication (username/password)
- Backup/export and restore for data durability and migration
- Performance targets: trip load around 15 seconds
- Responsive UI for desktop and mobile/tablet
- No SEO requirement; accessibility level not specified

**Scale & Complexity:**
- Primary domain: full-stack web application (SPA + API + database)
- Complexity level: medium (core CRUD with cross-cutting privacy + durability)
- Estimated architectural components: 5-7 (UI app, API/service layer, data store, auth, file/export/backup, integrations)

### Technical Constraints & Dependencies

- Greenfield project with no current tech stack or codebase
- Must support secure access, data durability, and export/restore
- Map integration required post-MVP (impacts data model and API design)

### Cross-Cutting Concerns Identified

- Authentication and authorization boundaries (owner vs viewer)
- Data durability and recovery (backup/export + restore)
- Privacy/GDPR compliance (data handling, access control)
- Performance for trip load and daily editing flows

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (Next.js App Router + API + database), based on the requirements and your TypeScript/Next.js preference.

### Starter Options Considered

1) **Next.js default starter (`create-next-app`)**  
Pros: Official, minimal, fast start, works well for self-hosting, no vendor lock.  
Cons: Leaves ORM/auth/db choices to us (which is fine here).

2) **Create T3 App (`create-t3-app`)**  
Pros: Opinionated stack (Next.js + tRPC + Prisma + auth).  
Cons: Heavier than needed and includes pre-packaged auth; you asked for custom auth.

3) **Vercel Prisma starters**  
Pros: Quick demo scaffolding.  
Cons: Oriented toward hosted workflows; not aligned with self-host + SQLite.

### Selected Starter: Next.js default (`create-next-app`)

**Rationale for Selection:**  
Matches your tech preferences, keeps the stack minimal, and avoids forcing opinions around auth or DB. It is the most stable, self-host friendly base and stays aligned with official Next.js defaults.

**Initialization Command:**

```bash
npx create-next-app@latest travelplan
```

(Choose recommended defaults: TypeScript, ESLint, App Router; Tailwind optional.)

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**  
- TypeScript enabled by default  
- App Router enabled (recommended)

**Styling Solution:**  
- Tailwind is default; can be declined if you prefer plain CSS or another system

**Build Tooling:**  
- Next.js build pipeline and dev server

**Testing Framework:**  
- Not included by default; we’ll decide later

**Code Organization:**  
- App Router project structure with `app/`  
- Optional `src/` directory and import alias `@/*`

**Development Experience:**  
- ESLint configured by default  
- Local dev server and hot reload

**Note:** Project initialization using this command should be the first implementation story.

### Mapping Libraries (Future Integration)

- Leaflet stable `1.9.4`; Leaflet `2.0.0-alpha.1` exists but is a major change, so avoid for now.

## Core Architectural Decisions (In Progress)

### Data Architecture

- **Database Runtime:** SQLite single file (in-process), self-hosted
- **Migrations:** Prisma Migrate
- **Version Anchors:** Prisma CLI `7.3.0`, `@prisma/client` `7.3.0`, SQLite `3.51.1`
- **Durability (Optional):** Litestream `v0.5.2` for streaming backups, if/when needed

### Authentication & Security

- **Auth Model:** JWT stored in HTTP-only cookie (SameSite=Lax; Secure in prod)
- **Password Hashing:** bcrypt `6.0.0`
- **Authorization:** Role-based access (owner, viewer)
- **CSRF Protection:** Enabled for state-changing requests
- **Rate Limiting:** Basic limits on auth endpoints
- **JWT Library:** `jose` `6.1.0`

### API & Communication Patterns

- **API Style:** REST
- **Validation:** Zod schemas in API layer (`zod` `4.1.11`)
- **Error Format:** Standard `{ error: { code, message, details } }` envelope
- **Rate Limiting Scope:** Auth endpoints only

### Frontend Architecture

- **State Management:** Redux Toolkit `2.11.2`
- **Data Fetching:** Next.js Server Components + `fetch`
- **Forms:** React Hook Form `7.71.1` (v8 beta noted)
- **Rich Text Editor:** TipTap 3 (stable)

### Infrastructure & Deployment

- **Hosting Target:** Debian-based server (Debian 13 "trixie")
- **Reverse Proxy / TLS:** Nginx
- **Runtime:** Node.js LTS (v24 "Krypton")
- **Process Manager:** systemd
- **CI/CD:** none initially
- **Logging/Monitoring:** basic logs only

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Next.js + TypeScript starter (create-next-app)
- SQLite file database with Prisma Migrate
- Auth model: JWT in HTTP-only cookies with bcrypt
- REST API + Zod validation
- Debian self-host + Nginx TLS + Node LTS

**Important Decisions (Shape Architecture):**
- Role-based authorization (owner/viewer)
- Redux Toolkit for state management
- Server Components + fetch data strategy
- TipTap for rich text
- systemd process management

**Deferred Decisions (Post-MVP):**
- Litestream for continuous backup/replication
- Broader rate limiting or monitoring stack
- Map routing integration (Google) beyond core MVP

### Decision Impact Analysis

**Implementation Sequence:**
1. Initialize Next.js project (TypeScript/App Router)
2. Configure Prisma + SQLite and apply migrations
3. Implement auth (JWT + bcrypt + cookie handling + CSRF)
4. Build REST API endpoints with Zod validation
5. Implement core UI flows (Redux state + forms + rich text)
6. Deploy on Debian with Nginx + systemd

**Cross-Component Dependencies:**
- Auth decisions affect API and frontend session handling.
- Data model decisions affect API shape and UI editing flows.
- Hosting/runtime choices influence build and deployment scripts.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 6 areas where AI agents could make different choices

### Naming Patterns

**Database Naming Conventions:**
- Tables: `snake_case` plural (e.g., `trip_days`)
- Columns: `snake_case` (e.g., `trip_id`)
- Foreign keys: `snake_case` with `_id` suffix (e.g., `user_id`)
- Indexes: `idx_<table>_<column>` (e.g., `idx_trip_days_trip_id`)

**API Naming Conventions:**
- Endpoints: plural nouns (e.g., `/api/trips`, `/api/trips/:id/days`)
- Route params: `:id`
- Query params: `camelCase` (e.g., `tripId`)
- Headers: `X-Request-Id`, `X-Trace-Id` (capitalized words, hyphenated)

**Code Naming Conventions:**
- Components: `PascalCase` (e.g., `TripDayCard`)
- Files: `PascalCase.tsx` for components
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

### Structure Patterns

**Project Organization:**
- App Router routes under `app/`
- API handlers under `app/api/**/route.ts`
- Server actions under `app/_actions/`
- UI components under `components/`
- Shared utilities under `lib/`
- Data access under `lib/db/` and `lib/repositories/`

**File Structure Patterns:**
- Prisma schema: `prisma/schema.prisma`
- Static assets: `public/`
- Tests: co-located as `*.test.ts(x)`

### Format Patterns

**API Response Formats:**
- Success: `{ data: <payload>, error: null }`
- Error: `{ data: null, error: { code, message, details } }`

**Data Exchange Formats:**
- JSON field naming: `camelCase`
- Dates: ISO 8601 strings in UTC
- Booleans: true/false

### Communication Patterns

**Event System Patterns:**
- No async event system in MVP

**State Management Patterns:**
- Redux slices by feature (e.g., `tripSlice`)
- Action naming: `feature/action`
- Selectors in `lib/selectors/featureSelectors.ts`

### Process Patterns

**Error Handling Patterns:**
- Central error mapper in API layer
- Consistent `code` values (e.g., `AUTH_INVALID`, `NOT_FOUND`, `VALIDATION_ERROR`)

**Loading State Patterns:**
- Use `isLoading`, `isSaving`, `isDeleting`
- Clear error on new request start

### Enforcement Guidelines

**All AI Agents MUST:**
- Use `snake_case` for DB and `camelCase` for API JSON
- Return API responses using the `{ data, error }` envelope
- Store dates as ISO 8601 UTC strings

**Pattern Enforcement:**
- Reject PRs that violate naming and response formats
- Update this section when patterns evolve

### Pattern Examples

**Good Examples:**
- Table: `trip_days` with column `trip_id`
- API: `GET /api/trips/:id/days` returns `{ data: [...], error: null }`

**Anti-Patterns:**
- Mixed `camelCase` columns in DB
- Returning raw payloads without `{ data, error }`

## Project Structure & Boundaries

### Complete Project Directory Structure
```
travelplan/
├── README.md
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.example
├── .env.local
├── .gitignore
├── public/
│   └── assets/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts
│   │   │   │   ├── logout/route.ts
│   │   │   │   └── register/route.ts
│   │   │   ├── trips/route.ts
│   │   │   ├── trips/[id]/route.ts
│   │   │   ├── trips/[id]/days/route.ts
│   │   │   ├── trips/[id]/accommodations/route.ts
│   │   │   └── trips/[id]/export/route.ts
│   │   ├── (routes)/
│   │   │   ├── trips/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   └── auth/
│   │   │       ├── login/page.tsx
│   │   │       └── register/page.tsx
│   │   └── _actions/
│   │       ├── auth.ts
│   │       ├── trips.ts
│   │       ├── days.ts
│   │       └── accommodations.ts
│   ├── components/
│   │   ├── ui/
│   │   ├── forms/
│   │   └── features/
│   │       ├── trips/
│   │       ├── days/
│   │       └── accommodations/
│   ├── lib/
│   │   ├── db/
│   │   │   └── prisma.ts
│   │   ├── repositories/
│   │   │   ├── tripRepo.ts
│   │   │   ├── dayRepo.ts
│   │   │   └── accommodationRepo.ts
│   │   ├── auth/
│   │   │   ├── jwt.ts
│   │   │   ├── bcrypt.ts
│   │   │   └── session.ts
│   │   ├── validation/
│   │   │   ├── authSchemas.ts
│   │   │   ├── tripSchemas.ts
│   │   │   └── daySchemas.ts
│   │   ├── errors/
│   │   │   └── apiError.ts
│   │   ├── http/
│   │   │   └── response.ts
│   │   └── utils/
│   ├── store/
│   │   ├── store.ts
│   │   └── slices/
│   │       ├── tripSlice.ts
│   │       └── uiSlice.ts
│   ├── middleware.ts
│   └── types/
└── tests/
    ├── api/
    ├── components/
    └── e2e/
```

### Architectural Boundaries

**API Boundaries:**
- `/app/api/**/route.ts` is the only public API surface.
- Auth routes are isolated under `/app/api/auth/*`.
- Trip/day/accommodation resources are separate endpoints.

**Component Boundaries:**
- Feature components live under `components/features/*`.
- UI primitives live under `components/ui/*`.
- Forms are in `components/forms/*`.

**Service Boundaries:**
- Data access only via `lib/repositories/*`.
- Prisma client only in `lib/db/prisma.ts`.

**Data Boundaries:**
- Prisma schema is the single source of truth for DB structure.
- Validation happens in `lib/validation/*` with Zod.

### Requirements to Structure Mapping

**Feature/FR Mapping:**
- **User Access & Accounts (FR1-FR3)**
  - Routes: `src/app/api/auth/*`
  - UI: `src/app/(routes)/auth/*`
  - Auth logic: `src/lib/auth/*`

- **Trip Management (FR4-FR8)**
  - API: `src/app/api/trips/*`
  - UI: `src/app/(routes)/trips/*`
  - Data: `src/lib/repositories/tripRepo.ts`

- **Day-by-Day Planning (FR9-FR11)**
  - API: `src/app/api/trips/[id]/days/*`
  - UI: `src/components/features/days/*`
  - Data: `src/lib/repositories/dayRepo.ts`

- **Accommodation Planning (FR12-FR16)**
  - API: `src/app/api/trips/[id]/accommodations/*`
  - UI: `src/components/features/accommodations/*`
  - Data: `src/lib/repositories/accommodationRepo.ts`

- **Day Plans (FR17-FR20)**
  - UI: `src/components/features/days/*`
  - Rich text: TipTap components inside day feature

- **Budget Awareness (FR21)**
  - Aggregation: `tripRepo.ts` and API responses
  - UI: `components/features/trips/*`

- **Viewer/Light Contributor (FR22-FR24)**
  - Auth roles: `src/lib/auth/*`
  - API guards: `src/middleware.ts`

- **Data Safety (FR25)**
  - Export route: `src/app/api/trips/[id]/export/route.ts`

### Integration Points

**Internal Communication:**
- UI -> Server actions in `app/_actions/*`
- UI -> API via REST endpoints using `fetch`

**External Integrations:**
- Maps (future): `components/features/trips/` and `components/features/days/`
- Routing (future): server integration in `lib/services/maps.ts`

**Data Flow:**
- UI submits -> server action / API -> repository -> Prisma -> SQLite

### File Organization Patterns

**Configuration Files:**
- `.env.local` for local secrets; `.env.example` for templates

**Source Organization:**
- Feature-based UI + centralized `lib/*` services

**Test Organization:**
- Unit tests co-located or under `tests/` by category
- E2E tests in `tests/e2e/`

**Asset Organization:**
- Static assets under `public/assets`

### Development Workflow Integration

**Development Server Structure:**
- Next dev server uses App Router and API routes in `src/app`

**Build Process Structure:**
- Next build outputs `.next/` and bundles API routes

**Deployment Structure:**
- systemd manages Node process; Nginx terminates TLS and proxies to Next

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are compatible: Next.js + TypeScript + Prisma + SQLite + REST + JWT + Redux. Versions align and do not conflict.

**Pattern Consistency:**
Naming, response formats, and validation rules are consistent with the stack and prevent agent divergence.

**Structure Alignment:**
Project structure supports App Router, API routes, Prisma, and feature-based UI organization.

### Requirements Coverage Validation ✅

**Epic/Feature Coverage:**
No epics provided; FR categories are fully mapped to routes, components, and repositories.

**Functional Requirements Coverage:**
All FRs (accounts, trips, days, accommodations, plans, budget, viewer role, backup/export) are supported by the architecture and file structure.

**Non-Functional Requirements Coverage:**
- Performance: trip load target set to 15 seconds (resolved)
- Security: auth, role-based access, CSRF, rate limiting
- Reliability: backup/export path defined
- Compliance: GDPR accounted for in access patterns

### Implementation Readiness Validation ✅

**Decision Completeness:**
Critical decisions documented with versions and rationale.

**Structure Completeness:**
Full project tree defined with clear boundaries.

**Pattern Completeness:**
Naming, formats, error handling, and loading states are defined.

### Gap Analysis Results

**Critical Gaps:** None  
**Important Gaps:** None  
**Nice-to-Have Gaps:** Optional Litestream backup and expanded monitoring stack (deferred)

### Validation Issues Addressed

- Resolved performance target conflict: **15 seconds** is the authoritative requirement.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION  
**Confidence Level:** High

**Key Strengths:**
- Coherent, minimal stack aligned to requirements
- Clear boundaries and naming rules for AI agent consistency
- Full mapping of requirements to structure

**Areas for Future Enhancement:**
- Add Litestream for automated SQLite backup/replication
- Expand monitoring/alerting if the app scales beyond personal use

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
Initialize the Next.js project with `create-next-app` and apply the Prisma + SQLite setup.
