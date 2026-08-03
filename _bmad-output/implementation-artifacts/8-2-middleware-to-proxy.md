---
authored_against: 03af7c7
---

# Story 8.2: `middleware.ts` Becomes `proxy.ts`

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator of this installation,
I want the deprecated `middleware` file convention replaced by `proxy`,
so that the warning on every server start stops being noise and the app is ready for the release that removes the old name.

## Acceptance Criteria

1. **The file is `src/proxy.ts`** and the deprecation warning no longer appears on `next dev` or `next build`.
2. **The export is renamed with it.** Next requires a default export or a named export matching the filename, so `export const middleware` becomes `export const proxy`. Renaming only the file produces a different, louder error.
3. **`config.matcher` is unchanged, character for character** — in particular `"/api/trips/:path((?!import/?$).*)"`, whose `/?` is what keeps both `/api/trips/import` and `/api/trips/import/` out of the matcher.
4. **Every guard still guards.** The page redirects, the `/api/trips` 401 and 403, the `/` and first-login-password branches all behave exactly as before.
5. **The suite moves with the file.** `test/middleware.test.ts` (176 lines, 14 tests) keeps its coverage; whether it is renamed is a decision, not an accident.

## Tasks / Subtasks

- [ ] **Task 1 — Move the file and the export** (AC: 1, 2)
  - [ ] `git mv src/middleware.ts src/proxy.ts`, then `export const middleware` → `export const proxy`.
  - [ ] Next's own message names both halves: *"You are migrating from `middleware` to `proxy`, but haven't updated the exported function."* Do both or neither.
  - [ ] `getMiddlewareMatchers` is shared between the two conventions, so `config.matcher` needs no change — verify rather than assume, since AC3 is the whole risk.

- [ ] **Task 2 — Follow the references** (AC: 4, 5)
  - [ ] Story 5.8 added `/users` to the matcher and **Story 5.10 extends it again** for the admin surface. Whichever lands second reads the other.
  - [ ] `next.config.ts`'s long comment refers to "the middleware" and to `middlewareClientMaxBodySize`; the option is already `proxyClientMaxBodySize`. Update the prose so the file and the comment agree.
  - [ ] Grep for `middleware` across `src/` and `test/` and decide, per hit, whether it names the file or the concept.

- [ ] **Task 3 — Tests** (AC: 3, 4, 5)
  - [ ] `middleware.test.ts` pins the matcher, both spellings of the import exclusion included. Keep every assertion; rename the file only if the imports are updated with it.
  - [ ] `npm test` green, and the count unchanged — this story adds no behaviour.

- [ ] **Task 4 — Manual check** (AC: 1)
  - [ ] Start the dev server and confirm the warning is gone.
  - [ ] Sign in, open a trip and a day, and sign out — the guards this file provides are the app's front door and a green suite is not the same as a working redirect.

## Dev Notes

### Why now

Next 16.2.12 prints on every start:

> The "middleware" file convention is deprecated. Please use "proxy" instead.

It is a warning, not a fault — nothing is broken and it can wait. It is worth doing because the file is the app's authentication gate for both pages and API, and a rename done under time pressure when Next 17 removes the old name is a worse moment than a quiet one now.

### What Next actually requires

Read out of `node_modules/next/dist` rather than from memory: the filename becomes `proxy`, and the file must export a function either as default or under the name matching the file. `getMiddlewareMatchers` is the same parser for both, so `config.matcher` carries over untouched.

### Traps

**1. The matcher is subtle.** `"/api/trips/:path((?!import/?$).*)"` — the `/?` is not decoration. Without it `/api/trips/import` was excluded and `/api/trips/import/` was not: the same route, the same body, buffered after all. `middleware.test.ts` pins both spellings.

**2. Two other stories touch this file.** 5.10 extends the matcher for the admin surface; 5.8 already added `/users`.

**3. Renaming only the file is worse than doing nothing.** It swaps a warning for a hard error.

### Testing

Vitest 3.2. `test/middleware.test.ts` is the constraint.

### Project Structure Notes

`src/middleware.ts` → `src/proxy.ts`, `test/middleware.test.ts`, and the prose in `next.config.ts`. No schema, route or behaviour change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.2]
- [Source: travelplan/src/middleware.ts] — the file, its guards and its matcher
- [Source: https://nextjs.org/docs/messages/middleware-to-proxy]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
