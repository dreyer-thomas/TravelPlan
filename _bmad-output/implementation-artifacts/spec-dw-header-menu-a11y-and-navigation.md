---
title: 'Header menu: accessible trigger, current-page marker, typed items, revalidated auth, 44px rows'
type: 'bugfix'
created: '2026-08-10'
status: 'done'
baseline_revision: 'b89d014'
final_revision: '33f3819'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.bmad-loop/runs/20260810-183633-664f/bundles/dw-header-menu-a11y-and-navigation/intent.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Five defects in the global header menu, all deferred: the hamburger `IconButton` carries `aria-label` alone, so a screen-reader user is never told it opens a menu nor whether it is open (DW-97, DW-140), while the day hero has carried `aria-haspopup`/`aria-expanded`/`aria-controls` since 6.11; the trips row is not marked as the current page on `/trips` (DW-129); `AuthMenuItem.href` is optional on a union that now holds destinations, so the next *action* item would render as a dead `#` anchor rather than fail to compile (DW-127); `authState` never revalidates, so a tab left past session expiry keeps offering "All trips" into a login bounce (DW-128); and every menu row carries no height rule, inheriting MUI's `minHeight: 48` below `sm` and its `auto` above it — measured at 32.3px at 747px (DW-180).

**Approach:** One pass over `HeaderMenu.tsx`, `authMenu.ts` and `LanguageSwitcherMenuItem.tsx`. Mirror `TripDayView`'s trigger attributes; add `usePathname()` and mark the matching destination row `aria-current="page"` + MUI `selected` (per the 2026-08-08 decision on DW-129); make `AuthMenuItem` a discriminated union on `kind` so a destination cannot exist without an `href` and the `?? "#"` fallback goes away; revalidate auth by refetching `/api/auth/csrf` on menu open and reading an additive `authenticated` flag from it; put `{ "&&": { minHeight: 44 } }` on every row in both menu files.

## Boundaries & Constraints

**Always:**
- Menu *content* stays a function of auth state alone. `usePathname()` may change only presentation (`aria-current`, `selected`) — never which rows exist. This is the narrow form of route-coupling DW-129's decision authorised; stories 6.11/6.15/6.20 AC4 refused the rest.
- `aria-current="page"` is exact-path only. On `/trips/abc` the trips row is not the current page.
- The 44px floor uses the doubled selector `{ "&&": { minHeight: 44 } }`. A bare `minHeight: 44` is one class and loses to MUI's `theme.breakpoints.up('sm')` reset — that *is* DW-180.
- The new `authenticated` field on the csrf envelope is additive and optional to consumers. `authState` flips to `false` **only** on an explicit `authenticated === false` from a successful response; an absent field, an error envelope, a non-ok status or a thrown fetch must leave `authState` untouched.
- `authenticated` means exactly what `AppHeader.resolveAuthState` means by `isAuthenticated`: a `session` cookie that `verifySessionJwt` accepts, regardless of `mustChangePassword`. Reuse `getRequestSession` rather than re-verifying by hand.

**Block If:**
- Making the trips row's current-page marker work would require the item list itself to become route-dependent.

**Never:**
- No new API endpoint. `/api/auth/csrf` may only *gain* a field: `csrfToken` keeps its name, type and semantics, the cookie write and `Cache-Control` header are untouched, and the route stays reachable without a session (it must keep issuing a token to anonymous callers — `/auth/login`, `/auth/forgot-password` and `/auth/first-login-password` all depend on that).
- Do not flip `authState` from `false` to `true`. DW-128 asks for one direction; a stale-negative prop is not a reported defect.
- Do not touch `DAY_MENU_ITEM_SX` / `TripDayView.tsx` / `AdminUsersList.tsx` — Story 9.2 already fixed the day menu's half of DW-180.
- Do not rename the `AuthMenuItem` type (`authMenu.ts:1-15` records why the name stays).
- No shared/exported 44px sx module. Every existing site is a module-local const; follow that.
- Do not edit `{implementation_artifacts}/deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Csrf probe, live session | `GET /api/auth/csrf` with a `session` cookie `verifySessionJwt` accepts | `200 { data: { csrfToken, authenticated: true } }` | No error expected |
| Csrf probe, no/expired session | Same request, cookie absent or unverifiable | `200 { data: { csrfToken, authenticated: false } }`, csrf token still issued | No error expected |
| Menu opened after expiry | `isAuthenticated` prop `true`, probe returns `authenticated: false` | Rows collapse to Login + Register; "All trips" and "User administration" gone | No error surfaced to the user |
| Probe unavailable | Menu opened, `fetch` rejects or returns a non-ok / error envelope | `authState` unchanged, menu still usable | Swallowed as today; `csrfToken` set to `null` |
| Legacy envelope | Response body has `csrfToken` but no `authenticated` | `authState` unchanged | No error expected |
| Current row on `/trips` | `usePathname()` === `/trips`, signed in | Trips row has `aria-current="page"` and MUI `selected`; other rows have neither | No error expected |
| Nested route | `usePathname()` === `/trips/abc` | No row marked current | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/HeaderMenu.tsx` -- the component all five defects live in. Trigger at `:173-197`, `Menu` at `:198`, row rendering at `:221-235`, `authState` at `:36`, `fetchCsrfToken` at `:44-62`, `handleOpen` at `:74-77`.
- `travelplan/src/lib/navigation/authMenu.ts` -- `AuthMenuItem` (`:16-20`, `href?: string`) and `getAuthMenuItems` (`:39-72`). Heavy decision comments; preserve them.
- `travelplan/src/components/LanguageSwitcherMenuItem.tsx` -- submenu trigger row (`:82`) and the two language rows (`:48`); no height rule anywhere.
- `travelplan/src/app/api/auth/csrf/route.ts` -- always `ok()`, never 401. Gains the `authenticated` flag.
- `travelplan/src/lib/auth/sessionGuard.ts` -- `getRequestSession(request)` is the reuse target for that flag.
- `travelplan/src/components/features/trips/TripDayView.tsx:2849-2876` -- the trigger pattern to mirror (`id`, `aria-haspopup`, `aria-expanded`, `aria-controls` gated on the anchor, `id` on the `Menu`). Read-only.
- `travelplan/test/helpers/emotionStyles.ts` -- `emotionDeclarations`; `test/docChip.test.tsx:76-87` is the 44px-floor assertion to copy.
- `travelplan/test/headerMenu{TripsEntry,AdminEntry,LanguageSwitcher}.test.tsx`, `travelplan/test/languageCookiePersistence.test.tsx` -- all four `vi.mock("next/navigation", …)` with `useRouter` only; a `usePathname` import would be `undefined` and throw.
- `travelplan/test/authMenu.test.ts:23-26,52-55` -- two `toEqual({ key, labelKey, href })` assertions the union change invalidates.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/navigation/authMenu.ts` -- turn `AuthMenuItem` into `{ kind: "destination"; key: "trips" | "admin" | "login" | "register"; labelKey: string; href: string } | { kind: "action"; key: "logout"; labelKey: string }`; export the action key union (e.g. `AuthMenuActionKey = Extract<AuthMenuItem, { kind: "action" }>["key"]`); add `kind` to all five literals -- DW-127: the invariant the menu depends on becomes a type rather than a convention.
- [x] `travelplan/src/app/api/auth/csrf/route.ts` -- take `request: NextRequest`, resolve `getRequestSession(request)`, return `ok({ csrfToken, authenticated: session !== null })`; keep the cookie write and `Cache-Control` untouched -- DW-128: the signal the menu needs, with no new endpoint and no extra request.
- [x] `travelplan/src/components/HeaderMenu.tsx` -- (a) `id`, `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-controls={open ? "header-menu" : undefined}` on the `IconButton` and `id="header-menu"` on the `Menu`; (b) `usePathname()` and `aria-current="page"` + `selected` on the destination row whose `href` equals the pathname; (c) branch on `item.kind`, dispatch actions through a `Record<AuthMenuActionKey, () => void>` so an unhandled future action fails to compile, and delete `?? "#"`; (d) `void fetchCsrfToken()` in `handleOpen`, and in `fetchCsrfToken` call `setAuthState(false)` when the successful body reports `authenticated === false`; (e) a module-local `{ "&&": { minHeight: 44 } }` on all three `MenuItem` sites -- DW-97/140, DW-129, DW-127, DW-128, DW-180.
- [x] `travelplan/src/components/LanguageSwitcherMenuItem.tsx` -- module-local `{ "&&": { minHeight: 44 } }` on the trigger row and both language rows; give the trigger row `aria-haspopup="menu"`, `aria-expanded={open}` and `aria-controls` for its own `Menu` id -- DW-180, plus the same trigger defect DW-97 says to take "with whatever next touches that component", in the one other file this bundle already opens.
- [x] `travelplan/test/headerMenuAccessibility.test.tsx` -- new suite: trigger attributes and the `aria-expanded` false→true→false flip; `aria-current`/`selected` present on `/trips` and absent on `/trips/abc` and on the other rows; the 44px floor on every header and language row via `emotionDeclarations`; the stale-session collapse and the three no-conclusion cases from the matrix -- pins the bundle, and pins DW-180 above `sm` where a browser measurement was still owed.
- [x] `travelplan/test/{headerMenuTripsEntry,headerMenuAdminEntry,headerMenuLanguageSwitcher,languageCookiePersistence}.test.tsx` -- add `usePathname: () => "/"` to each `next/navigation` mock factory -- the factories replace the whole module, so without this every one of them throws.
- [x] `travelplan/test/authMenu.test.ts` -- add `kind` to the two full-object `toEqual` assertions; add one `@ts-expect-error` case proving a destination literal without `href` does not typecheck -- `tsc --noEmit` covers `test/**`, so this makes DW-127's guarantee a checked assertion rather than a claim.
- [x] `travelplan/test/helpers/emotionStyles.ts` -- add `emotionDoubledSelectorDeclarations`; keep `emotionDeclarations` behaviour byte-identical (both now delegate to one private `declarationsFor`) -- **spec correction, added during implementation**: `emotionDeclarations` matches a rule only when its selector *equals* `.css-X`, so it cannot see the `.css-X.css-X` rule Emotion emits for `{ "&&": … }`. Reading the floor through it returns MUI's 48px/`auto` pair and misses the 44 — a vacuous pass in the direction of "the bug is still there". The named technique was blind to the exact CSS form this spec mandates.
- [x] `travelplan/test/csrfRouteAuthenticatedFlag.test.ts` -- new suite -- **added during implementation**: the spec's task list gave matrix rows 1–2 (the route's own `authenticated` values) no coverage, so DW-128's server half would have shipped untested. Pins `true` for a verifiable session, `true` for `mustChangePassword`, `false` + a token still issued for anonymous and for an unverifiable cookie, and that the cookie write and `Cache-Control` are unchanged.

**Acceptance Criteria:**
- Given the header is rendered, when the hamburger button's attributes are read, then `aria-haspopup` is `"menu"` and `aria-expanded` is `"false"`; and when the menu is opened and then closed, then `aria-expanded` reads `"true"` and `"false"` in turn, and `aria-controls` points at the rendered `Menu`'s own `id` while open.
- Given a signed-in visitor on `/trips`, when the menu opens, then the trips row is the only row carrying `aria-current="page"` and MUI's `selected`, and the menu holds the same rows it holds on any other page.
- Given a new action item is added to `getAuthMenuItems` without a handler, when `npm run typecheck` runs, then it fails — and no code path can render a `MenuItem` whose `href` is `"#"`.
- Given a tab whose session expired while open, when the menu is opened, then the probe reports `authenticated: false` and the menu offers Login and Register instead of "All trips".
- Given any viewport above 600px, when a header-menu or language-menu row's declared `min-height` is read at the highest specificity that declares it, then it is 44px, and no media condition declares a different value *at that specificity*. (Wording sharpened during the follow-up review: MUI's own `sm` reset to `auto` is still present and still inside a media condition — it is simply outranked, and the suite asserts it is still there, because the reset's continued existence is what makes the doubled selector necessary. The earlier phrasing read as a claim that no `auto` declaration exists anywhere, which was never true and was never what the tests checked.)
- Given the whole change, when `npm run lint && npm run typecheck && npm run test` runs, then all three pass with no pre-existing suite regressed.

## Spec Change Log

No entries. No `bad_spec` loopback was triggered; the two spec corrections found during implementation (the `emotionDeclarations` blindness to `&&` rules, and the missing coverage for the route's own `authenticated` values) were recorded as checked Execution tasks rather than re-derived, because neither changed the intent or the approach.

## Review Triage Log

### 2026-08-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 0, medium 2, low 12)
- defer: 3: (high 0, medium 1, low 2)
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` The menu list carried no accessible name and the new `id="header-menu-button"` was referenced by nothing — the comment claimed to mirror the day hero but omitted the one attribute that names the popup. Added `slotProps.list: { "aria-labelledby": … }` on both the header menu and the language submenu (whose trigger row gained `LANGUAGE_TRIGGER_ID`), matching `TripDayView.tsx:2916` and `AdminUsersList.tsx:1109`; pinned in `headerMenuAccessibility.test.tsx`.
  - `[medium]` `[patch]` `/api/auth/csrf`'s body now varies by the `session` cookie but declared no `Vary`, leaving an unauthenticated CSRF-exempt endpoint one permissive cache or CORS config away from a cross-site "is this visitor signed in" oracle. Added `Vary: Cookie` plus a test asserting it and the absence of `Access-Control-Allow-*`.
  - `[low]` `[patch]` `emotionDoubledSelectorDeclarations` appended each class as a *suffix* to the whole class list, matching any two-class compound (`.css-b.css-a`) rather than the doubled form. `visitRulesFor` now takes a per-selector shaping function, so `&&` reads as `.css-a.css-a` only; `emotionPseudoClassStyle` moved onto the same mechanism.
  - `[low]` `[patch]` Running `fetchCsrfToken` on every menu open turned a transient blip into a discarded *valid* CSRF token. The failure paths now keep whatever token is cached; the mutation paths already refetch on `403`. **This narrows the I/O matrix's "Probe unavailable" *Error Handling* cell** ("`csrfToken` set to `null`") — that cell was prefaced "as today", i.e. describing the status quo rather than requiring it, and the row's actual expectation ("`authState` unchanged, menu still usable") is unaffected. The matrix is inside `<intent-contract>` and was therefore not edited; the deviation is stated here instead.
  - `[low]` `[patch]` Both menus being edited were left on MUI 7's deprecated `PaperProps`, while `TripDayView`/`AdminUsersList` carry an explicit comment that `slotProps.paper` is the house idiom. Migrated both (also required, since `slotProps` is where the list is reached); verified empirically that the paper still renders `rgb(255,255,255)` / `24px`.
  - `[low]` `[patch]` `handleOpen`'s comment claimed the per-open probe "costs no extra request" — it is one `GET` per open where there used to be one per mount. Corrected to state the cost and why it is worth paying.
  - `[low]` `[patch]` The one-direction comment claimed "the prop effect above already restores the truth on the next page load"; `AppHeader` is a server component in the `(routes)` layout, which App Router keeps mounted across a soft navigation, so the prop never changes. Rewritten to name what actually recovers (a document load or leaving the group) and the residual window.
  - `[low]` `[patch]` `HEADER_MENU_ITEM_SX`'s comment called `DAY_MENU_ITEM_SX`/`ROW_MENU_ITEM_SX` module-local; both are declared inside their component functions. And `menuActions`' comment said "logout" now appears in one place instead of two — it appears in the type, the item literal and the handler key. Both corrected.
  - `[low]` `[patch]` The csrf route's docstring justified the flag as stopping a middleware bounce, then reported `mustChangePassword` sessions as authenticated — which *are* bounced off `/trips`. The narrowing is now stated, with why reporting them signed out would be the worse trade.
  - `[low]` `[patch]` No test exercised a well-formed **expired** token — the only input the feature exists for (`createSessionJwt` hard-codes `7d`, so every negative case was a missing or malformed cookie). Added a `SignJWT` fixture with a past `exp`.
  - `[low]` `[patch]` `describe("… hold the 44px floor above sm")` overstated what jsdom can prove. Renamed to "declare … at a specificity that survives sm", with the ledger's owed browser measurement explicitly recorded as still owed.
  - `[low]` `[patch]` `authMenu.test.ts`'s new case claimed to be "runtime-asserted too"; the `expect`s only consume the bindings so the `@ts-expect-error` is not reported unused. The docstring now says `tsc` is the assertion.
  - `[low]` `[patch]` The csrf suite reset `csrfCookie.value` inline at the end of one test, so a throw would leak `existing-token` into every later test and correctness depended on that test staying last. Moved to `afterEach`.
  - `[low]` `[patch]` The DW-180 mechanism was restated verbatim in three files. `HeaderMenu.tsx` now holds the one explanation and `LanguageSwitcherMenuItem.tsx` points at it — the spec forbids a shared constant, not a single source for the prose.

**Deviation from step-04, stated rather than silent:** the three `defer` findings were **not** appended to `deferred-work.md`. The invocation forbids editing the ledger ("the orchestrator records resolution"), so they are recorded under `## Auto Run Result` → *Deferred for the ledger* instead, for the orchestrator to enter.

### 2026-08-10 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 1, low 7)
- defer: 5: (high 0, medium 1, low 4)
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` **The current-page marker silently reordered keyboard entry into the menu, and combined with the revalidation it stranded focus on `<body>`.** MUI's `Menu` defaults to `variant="selectedMenu"`, under which `MenuList` moves initial focus onto the first `selected` child and makes it the list's only tab stop — so on `/trips` opening the menu focused the "All trips" anchor and skipped the language row above it. Measured in jsdom: `activeElement` on the `<a>All trips</a>` with `tabindex="0"`. Worse in combination with DW-128: the probe then unmounts that very row, leaving `document.activeElement === document.body` while the menu is still open with `aria-expanded="true"` — also measured. `selected` was authorised as *presentation*; focus order is a third thing nobody costed. Fixed with `variant="menu"` on the `Menu`, which focuses the list instead — a container no row-list change can unmount — and leaves `aria-current` + `Mui-selected` as the marker they were meant to be. Pinned by two new tests ("does not move keyboard focus onto the row it marks", "keeps keyboard focus inside the menu when the rows collapse under it"), both verified to fail with the prop removed.
  - `[low]` `[patch]` `persistLanguage`'s `if (!authState) return true;` was a safe statement about a server-rendered prop and is now a statement about a network response, since DW-128 made `authState` probe-writable — a wrongly-negative probe takes that branch and the language preference reaches the cookie but never the account. Left as behaviour (in the case the probe exists for, the session is gone and the `PATCH` would 401; in the case it is wrong, the language still changes and still persists for that browser) and documented at the site, because the line no longer means what its shape suggests.
  - `[low]` `[patch]` The trigger comment claimed the change makes "the app's two menu triggers read identically". `grep aria-haspopup="menu"` finds five: `TripDayView.tsx:2102` and `:2853`, `AdminUsersList.tsx:816`, plus the two this bundle adds. Corrected to name them.
  - `[low]` `[patch]` `test/helpers/emotionStyles.ts` carried two consecutive JSDoc blocks before `visitRulesFor`; only the second attaches, orphaning the original explanation of why recursion keys off `cssRules` rather than the media-rule type — which that block itself argues is load-bearing against vacuous passes. Merged.
  - `[low]` `[patch]` The csrf route was six statements under ~35 lines of comment, one paragraph of which existed only to defend a parenthesis against a charge of self-contradiction ("That last parenthesis is a deliberate narrowing of the sentence above it, not a contradiction of it"). A comment arguing with an imagined reviewer is not documentation; the docstring now states the `mustChangePassword` narrowing once, in the sentence that makes the claim.
  - `[low]` `[patch]` AC5 read "no media condition declares a different value", which the suite's own sibling assertion disproves as worded — MUI's `sm` reset to `auto` is still there, and the test asserts it *is*, because its continued existence is what makes the doubled selector necessary. AC5 now says "at the highest specificity that declares it", with the earlier phrasing and why it was wrong recorded inline.
  - `[low]` `[patch]` `expect(submenuList).toHaveAccessibleName(expect.stringContaining("Language") as unknown as string)` defeated the type checker with a double cast to smuggle an asymmetric matcher into a matcher not typed for one. The `aria-labelledby`-resolves-to-the-trigger assertion on the line above already carries the meaning; replaced with a direct check on the referenced row's text.
  - `[low]` `[patch]` The Verification step's "no new warnings" was checked against the repo-wide warning total, which cannot distinguish "no new warnings" from "one added and one removed". Re-verified per file against the `b89d014` copy (`HeaderMenu.tsx`: 2 warnings before, the same 2 after, same lines) and the Verification step now states the per-file basis as the requirement.

**Deferred (DW-287…DW-291), appended to `deferred-work.md` as new entries only.** This invocation authorises appending new findings while reserving existing entries' status to the orchestrator, so the three deferrals the first pass could only record in prose — the collapse-while-open announcement/pointer problem, the app-wide inert `aria-controls`, and the collapse persisting across soft navigation — are now durably tracked (DW-287, DW-288, DW-289) alongside two the follow-up found: the `&&` form overriding MUI's unconditional 48 so phone rows shrink to 44 across all four sites (DW-290), and DW-180's owed above-600px browser measurement, which would otherwise have vanished when that entry closed (DW-291).

## Design Notes

**DW-128's stated mechanism does not exist, and this spec corrects it.** The entry proposes "the menu already fetches `/api/auth/csrf` when it opens, so a `401` there is a ready signal". Both halves are false against the code: `src/app/api/auth/csrf/route.ts` is unauthenticated by design — it reads or mints a token and always returns `ok()`, so it cannot 401 — and `HeaderMenu` fetches it once on mount (`:64-66`), never on open, which is useless for a tab that has been open for hours. The intent (revalidate on open, no new endpoint, one boolean) is unchanged and delivered; the carrier becomes an additive `authenticated` field plus a refetch in `handleOpen`. The rejected alternative was probing `/api/trips`, which middleware does 401 — but it runs a full trips query and returns every trip's name, dates and cost totals to answer one boolean.

Only an explicit `false` acts, which is what keeps the seventeen existing suites that stub csrf as `{ data: { csrfToken } }` green, and what makes a proxy-cached or older response harmless.

Trigger pattern to mirror (`TripDayView.tsx:2849-2855`) — `aria-controls` gated on the open state even though `keepMounted` leaves the list in the DOM, so the two triggers read identically:

```tsx
<IconButton
  id="header-menu-button"
  aria-label={t("header.openMenu")}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={open ? "header-menu" : undefined}
```

No new dictionary keys: every string in this change already exists, and `aria-current` is not announced from the dictionary.

## Verification

**Commands:**
- `cd travelplan && npm run lint` -- expected: clean, no new warnings. Compare **per touched file**, not against the repo-wide total: a matching total cannot distinguish "no new warnings" from "one added and one removed". The check is `npx eslint <the touched files>` against the same command run on the `b89d014` copy of each.
- `cd travelplan && npm run typecheck` -- expected: exit 0, including the `@ts-expect-error` case in `authMenu.test.ts` (an *unused* expect-error is itself an error, so this proves the union bites).
- `cd travelplan && npx vitest run test/headerMenuAccessibility.test.tsx test/headerMenuTripsEntry.test.tsx test/headerMenuAdminEntry.test.tsx test/headerMenuLanguageSwitcher.test.tsx test/languageCookiePersistence.test.tsx test/authMenu.test.ts` -- expected: all pass.
- `cd travelplan && npm run test` -- expected: the full suite passes; compare against the pre-change baseline and treat any newly failing file as a regression to fix.


## Auto Run Result

Status: done
Bundle: `dw-header-menu-a11y-and-navigation` — DW-97, DW-140, DW-129, DW-127, DW-128, DW-180 (header-menu half)

**What was implemented.** Five defects in the global header menu, in one pass over the three files the bundle names plus the csrf route the auth check needed. The hamburger announces its popup and names the list it opens (DW-97/DW-140). The destination row whose `href` equals the current path is marked `aria-current="page"` + MUI `selected`, with menu *content* still derived from auth state alone (DW-129). `AuthMenuItem` is a discriminated union on `kind`, so a destination cannot exist without an `href`, the renderer branches on shape, and the `?? "#"` fallback is gone (DW-127). The menu revalidates auth on every open and collapses to Login/Register when the session is gone (DW-128). Every row in both menus declares the 44px floor through the doubled `&&` selector (DW-180).

**This follow-up pass** was a second, independent review of the same diff (`review_loop_iteration` reset to 0, no code re-derivation). It found one behavioural defect the first pass missed — the current-page marker was quietly changing keyboard focus order, and in combination with the revalidation it stranded focus on `<body>` inside an open menu — plus seven documentation and test-precision fixes. It also moved five deferrals into the ledger, three of which the first pass could only record in prose.

**Files changed** (cumulative since `b89d014`).
- `travelplan/src/lib/navigation/authMenu.ts` — `AuthMenuItem` becomes `destination | action`; exports `AuthMenuActionKey`.
- `travelplan/src/app/api/auth/csrf/route.ts` — additive `authenticated` flag via `getRequestSession`, plus `Vary: Cookie`; docstring trimmed this pass.
- `travelplan/src/components/HeaderMenu.tsx` — trigger aria attributes and `id`, `usePathname()` current-page marker, `kind`-based rendering with an exhaustive action map, per-open revalidation, 44px rows, `slotProps` migration with `aria-labelledby`; **`variant="menu"` added this pass** so the marker stays presentational.
- `travelplan/src/components/LanguageSwitcherMenuItem.tsx` — submenu trigger aria attributes and `id`, 44px rows, `slotProps` migration with `aria-labelledby`.
- `travelplan/test/headerMenuAccessibility.test.tsx` — now 16 tests: trigger attributes and the expanded flip, accessible names, the current-page marker on `/trips` and its absence on `/trips/abc`, row-list equality across routes, the stale-session collapse and every no-conclusion case, the 44px declarations, MUI's `sm` reset still underneath, and **the two new focus tests**.
- `travelplan/test/csrfRouteAuthenticatedFlag.test.ts` — 7 tests: the flag's four inputs including a genuinely expired token, the untouched cookie/cache behaviour, and the `Vary`/no-CORS properties.
- `travelplan/test/helpers/emotionStyles.ts` — `emotionDoubledSelectorDeclarations` (the `&&` form is invisible to `emotionDeclarations`); per-selector shaping replaces the suffix.
- `travelplan/test/authMenu.test.ts` — `kind` in the two full-object assertions, plus a compile-checked `@ts-expect-error` case.
- `travelplan/test/{headerMenuTripsEntry,headerMenuAdminEntry,headerMenuLanguageSwitcher,languageCookiePersistence}.test.tsx` — `usePathname` added to each `next/navigation` mock factory.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-287…DW-291 appended. No existing entry was modified.

**Review findings, this pass.** 8 patches applied (1 medium, 7 low), 5 deferred to the ledger, 12 rejected, 0 intent gaps, 0 spec loopbacks. See the Review Triage Log.

**Verification.**
- `npm run typecheck` → exit 0. This is also what proves DW-127's guarantee: an unused `@ts-expect-error` is itself an error.
- `npx eslint` on the eight touched files → 0 errors, 2 warnings, both `react-hooks/set-state-in-effect` at `HeaderMenu.tsx:121`. Verified pre-existing **per file** this pass, not by repo-wide total: the same command against the `b89d014` copy of `HeaderMenu.tsx` reports the same 2 warnings on the same lines.
- `npm run test` → **143 files / 2202 tests passing**, against 141/2178 at the `b89d014` baseline and 143/2200 at the end of the first pass; the delta this pass is exactly the two new focus tests.
- Both new focus tests were verified to **fail** with `variant="menu"` removed, so they pin the fix rather than describing MUI's default.
- Every measurement quoted in the findings above (the `aria-controls` target being `role="presentation"`, the `role="menu"` list having no `id`, `getComputedStyle` reporting 44px below `sm`, focus on the "All trips" anchor, `activeElement === document.body` after collapse) was taken in a throwaway jsdom probe, since removed.

**Residual risks.**
- **DW-180's owed browser measurement above 600px is still owed** — now tracked as DW-291 rather than left in prose. jsdom evaluates no media queries and performs no layout, so the suite proves the floor is *declared* above the specificity of MUI's `sm` reset, which is the mechanism, not the measurement.
- **Phone rows are 4px shorter than before this change** (48 → 44), because the doubled selector also outranks MUI's *unconditional* `minHeight: 48`, not just its `sm` reset. Still above the app's target floor, and the form is mandated by this spec's Boundaries and shared with two files it may not touch — tracked as DW-290 for one decision across all four sites.
- The row list can still change under an open menu without announcement, and a pointer already aimed at a row can land on its replacement (DW-287). The keyboard half of that is fixed and pinned.
- The per-open probe adds one `GET /api/auth/csrf` per menu open (verifies a JWT, re-issues the CSRF cookie). Deliberate, and the cost of AC3's absolute phrasing. It has no in-flight guard or `AbortController`; latent rather than broken, because the token is stable per cookie and a late `setAuthState(false)` on a closed menu is a no-op.
- `authenticated` is a login-state signal on an unauthenticated endpoint. Safe today by construction (no CORS headers, `no-store`, `Vary: Cookie`, all three pinned by tests), but a future permissive CORS or shared-cache config would make it readable cross-site.
- `aria-controls` is inert on all five of the app's menu triggers (DW-288). The announcement DW-97/DW-140 asked for is carried by `aria-haspopup` + `aria-expanded`, and each list is named via `slotProps.list`, so the deferral does not leave the original defect open.
