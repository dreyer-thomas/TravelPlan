# Story 1.1: Initialize Project From Starter Template

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want to initialize the project from the approved Next.js starter template,
so that the codebase is ready for feature implementation.

## Acceptance Criteria

1. **Given** I am starting implementation  
   **When** I initialize the project using `create-next-app` with the agreed settings  
   **Then** a new project is created and runs locally  
   **And** the repository contains the default Next.js structure

## Tasks / Subtasks

- [x] Initialize the Next.js app using the approved starter configuration (AC: #1)
- [x] Verify the app runs locally after initialization (AC: #1)
- [x] Confirm the repo structure matches the architecture baseline (AC: #1)

## Developer Context

- This story is scaffolding-only: no feature logic or domain models yet.
- Keep changes minimal and aligned with the architecture baseline.
- Do not introduce additional dependencies beyond what `create-next-app` installs.

## Technical Requirements

- Use `create-next-app@latest` with TypeScript enabled.
- Use `create-next-app@latest` with ESLint enabled.
- Use `create-next-app@latest` with App Router enabled.
- Use `create-next-app@latest` with the `src/` directory enabled.
- Use `create-next-app@latest` with import alias `@/*`.
- Use `create-next-app@latest` with Tailwind CSS disabled (Material UI is the baseline UI system).
- If running in the repo root, use `.` as the target to avoid nesting; otherwise use `travelplan`.
- Use the default package manager already in use for this repo (npm if none).

## Architecture Compliance

- App Router only (no Pages Router).
- API routes must live under `src/app/api/**/route.ts`.
- Preserve the foundational structure described in architecture docs.

## Library / Framework Requirements

- Next.js must be initialized via `create-next-app` (default template).
- Keep the import alias as `@/*` to align with architecture examples.
- Do not add Prisma or auth libraries in this story; those are later stories.

## File Structure Requirements

- Ensure the `src/` directory is used.
- Ensure `src/app/layout.tsx`, `src/app/page.tsx`, and `src/app/globals.css` exist after init.
- Ensure `tsconfig.json` defines the `@/*` path alias.

## Testing Requirements

- No automated tests required in this story.
- Validate that `npm run dev` starts and the default page renders.
- `npm run lint` should pass after initialization.

## Latest Tech Information

- Next.js 16.x is Active LTS and 15.x is Maintenance LTS. Use `create-next-app@latest` to scaffold from the latest stable defaults.
- Node.js v24 (Krypton) is Active LTS; keep local dev aligned with that runtime.
- `create-next-app` supports flags including `--ts/--js`, `--eslint` or `--no-linter`, `--app`, `--src-dir`, `--import-alias`, and `--tailwind` plus `--no-*` to negate defaults (e.g., `--no-tailwind`).

## Project Context Reference

- Epics: `_bmad-output/planning-artifacts/epics.md`
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
- PRD: `_bmad-output/planning-artifacts/prd.md`
- UX: `_bmad-output/planning-artifacts/ux-design-specification.md`

## Dev Notes

- This story is limited to project scaffolding; no domain or data-model implementation.
- The architecture baseline expects App Router under `src/app` and REST API routes under `src/app/api/**/route.ts`.
- Keep UI system decisions aligned to Material UI (Tailwind disabled at init).

### Project Structure Notes

- Ensure `src/` exists and is used (matches architecture file tree).
- Ensure `@/*` alias is configured in `tsconfig.json`.
- If `create-next-app` defaults conflict with the architecture baseline, document the variance in the completion notes.

### References

- Epics Story 1.1: `_bmad-output/planning-artifacts/epics.md#Story-1.1-Initialize-Project-From-Starter-Template`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Starter-Template-Evaluation`
- Architecture patterns: `_bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries`
- UX system baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`

## Story Completion Status

- Status: done
- Completion note: Scaffold complete; lint/dev checks passed; review fixes applied.

## Dev Agent Record

### Agent Model Used

gpt-5 (Codex)

### Debug Log References

### Completion Notes List

- Initialized Next.js app via `create-next-app@latest` in `travelplan/` with `--ts --eslint --app --src-dir --import-alias "@/*" --no-tailwind --use-npm`.
- Verified `npm run dev` starts (Next.js 16.1.6, default page) and `npm run lint` passes.
- Architecture baseline alignment: App Router under `src/app`, `@/*` alias present, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` exist. Full baseline structure (e.g., `prisma/`, `src/app/api/**`) deferred to later stories.
- Review fixes: README path updated for `src/` layout; `.gitignore` allows committing `.env.example`. Kept `next.config.ts` as scaffolded and documented variance from baseline `next.config.js`.

### File List

- _bmad-output/implementation-artifacts/1-1-initialize-project-from-starter-template.md
- travelplan/.gitignore
- travelplan/README.md
- travelplan/eslint.config.mjs
- travelplan/next-env.d.ts
- travelplan/next.config.ts
- travelplan/package-lock.json
- travelplan/package.json
- travelplan/public/file.svg
- travelplan/public/globe.svg
- travelplan/public/next.svg
- travelplan/public/vercel.svg
- travelplan/public/window.svg
- travelplan/src/app/favicon.ico
- travelplan/src/app/globals.css
- travelplan/src/app/layout.tsx
- travelplan/src/app/page.module.css
- travelplan/src/app/page.tsx
- travelplan/tsconfig.json

### Change Log

- 2026-02-12: Scaffolded Next.js app in `travelplan/`, verified dev server and lint.
- 2026-02-12: Review fixes applied (README path, `.gitignore` env rules, documented `next.config.ts` variance).
