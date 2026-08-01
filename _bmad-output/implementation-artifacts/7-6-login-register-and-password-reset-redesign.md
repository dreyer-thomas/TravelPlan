---
baseline_commit: 161a58e2dd1c2defcfa5784a1e8352afcf9405d7
---

# Story 7.6: Login, Register, and Password Reset Redesign

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the login, registration, and password-reset screens to match the approved design system,
So that the first impression of the app is consistent with the rest of the redesigned product.

**FRs covered:** FR1, FR2, FR29 in `epics.md`'s own FR scheme (`epics.md:19,20,48` — "Users can create a private account", "Users can sign in", "Users can reset their password via email"). `prd.md` numbers these differently; `epics.md` is the citation of record for this epic, matching the precedent set by Story 7.5.

## Acceptance Criteria

**AC1** (epic, verbatim)
**Given** `mockups/trips-list-share-login.html` (Screen E) and `mockups/forms-authoring.html` (Screen H) and `EXPERIENCE.md`'s corresponding component patterns
**When** login, register, and password-reset screens are rebuilt
**Then** each uses the hero-photo side-panel treatment and the shared form-primitive tokens (44px inputs/buttons, default/focus/error states)

**AC2** (epic, verbatim)
**Given** the existing auth functionality (login, register, request reset, set new password)
**When** these screens are redesigned
**Then** all of it continues to work unchanged — this story is visual only

**AC3** (derived — the split-screen shell cannot render under the app topbar)
**Given** the auth routes currently mount `AppHeader` from `src/app/(routes)/layout.tsx`
**When** any auth screen renders
**Then** it fills the viewport as a two-column hero/form split with no app topbar above it, the URLs `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` and `/auth/first-login-password` are unchanged, and `middleware.ts` still matches `/auth/first-login-password`

**AC4** (derived — `/auth/first-login-password` is the fifth auth screen and the epic names only four)
**Given** an invited collaborator signs in with a temporary password and is redirected to `/auth/first-login-password` (Story 5.2, `middleware.ts:32`)
**When** that screen renders
**Then** it uses the same hero/form shell and form primitives as the other four, so the invite flow does not drop out of the design system halfway through

**AC5** (derived — the reset flow has no UI entry point today)
**Given** `EXPERIENCE.md:36` states Screen H is "Reached from: 'Passwort vergessen?' link on Login/Register", and no such link exists anywhere in the app
**When** the login screen renders
**Then** it carries a link to `/auth/forgot-password`, and the forgot-password screen carries a link back to `/auth/login`

**AC6** (regression)
**Given** the CSRF fetch-on-mount, `react-hook-form` validation rules, `resolveApiError` mapping, field-level `setError` from `validation_error` details, the register consent requirement, and the two post-login redirects (`/auth/first-login-password` vs `/`)
**When** the screens are rebuilt
**Then** every one of them behaves exactly as before — no auth endpoint, Zod schema, session, or redirect target changes in this story

### Scope note — read before Task 1

**AC2's "visual only" clause is superseded exactly three times: by AC3 (route-group move), AC5 (the missing "Forgot password?" link), and Task 5's confirm-password field. Nowhere else.** This follows the precedent Story 7.8 set against 7.2 and Story 7.5 set against its own AC3.

Three things in the mockups are **not buildable as drawn** and must be adapted rather than implemented. Each is called out again at its task:

1. **Screen H Step B's sub-line** reads "Für thomas.dreyer@gmx.de — der Link ist noch 42 Minuten gültig." The reset page holds an opaque token and there is no endpoint that returns the token's email or expiry. Building one would hand an unauthenticated caller a token-validity oracle. **Do not build it.** Use generic copy (Task 5).
2. **Screen H Step B's success note** reads "Nach dem Speichern wirst du automatisch angemeldet und zu deiner Reiseliste weitergeleitet." `POST /api/auth/password-reset/confirm` returns `ok({ success: true })` and issues no session (`route.ts:77`). **Do not add auto-login** — that is a session/security change, not a re-skin. The success note says what actually happens and links to sign-in (Task 5).
3. **`EXPERIENCE.md:93` says Login/Register is "one surface, not two routes."** It is two routes today, referenced from `HomeHero.tsx:25,28`, `authMenu.ts:13-14`, `middleware.ts:42,55` and `test/loginPage.test.tsx`. Collapsing them is a routing change, not a re-skin. **Keep both routes**; render the `auth-tabs` control on both with the inactive tab as a `next/link` (Task 3). The one behavior the spine asks for that this does not deliver is preserving a typed email across the tab switch — accepted deviation, recorded here so review does not relitigate it.

## Tasks / Subtasks

- [ ] **Task 1 — Route group so the auth screens escape `AppHeader` (AC3)**
  - [ ] `git mv travelplan/src/app/\(routes\)/auth travelplan/src/app/\(auth\)/auth` — move the whole directory (all five `page.tsx` files) into a new `(auth)` route group. Route groups do not appear in the URL, so `/auth/login` … `/auth/first-login-password` are byte-identical afterwards. Verify with `npm run build` before touching anything else.
  - [ ] New `travelplan/src/app/(auth)/layout.tsx`: `export default function AuthLayout({ children }: { children: ReactNode }) { return <>{children}</>; }`. It exists solely so `(routes)/layout.tsx`'s `AppHeader` is not an ancestor. Do **not** add a second `<html>`/`<body>` — `src/app/layout.tsx` still owns those and `ThemeRegistry`.
  - [ ] Leave `src/app/(routes)/layout.tsx` exactly as it is. `trips/` is its only remaining child and Story 7.8 is `ready-for-dev` against that page.
  - [ ] Leave `src/middleware.ts` untouched — its matcher is URL-based (`:66`), and no URL changed.
  - [ ] Update the one import that names the old path: `test/loginPage.test.tsx:6` → `@/app/(auth)/auth/login/page`. Grep for `(routes)/auth` across `src` and `test` to confirm there is no second one.

- [ ] **Task 2 — The shared auth shell (AC1, AC3, AC4)**
  - [ ] New `travelplan/src/components/features/auth/AuthScreenShell.tsx`, `"use client"`. This is the one place the split layout, hero photo, scrim, card, notices and foot link are defined; all five pages consume it. Do not let any page re-declare the hero.
  - [ ] Props: `{ heroTitle: string; heroSubtitle: string; title: string; subtitle: string; tabs?: ReactNode; stepLabel?: string; error?: string | null; success?: string | null; footer?: ReactNode; children: ReactNode }`.
  - [ ] Outer shell: `display: grid`, `gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }`, `minHeight: "100dvh"`. Mockup `.auth-shell` is `1fr 1fr` at a fixed 520–560px; the real screen fills the viewport.
  - [ ] Hero column (`.auth-hero`, `trips-list-share-login.html:318-329`): `position: relative`, `backgroundColor: theme.palette.primary.main` as the pre-load fill, `backgroundImage: toCssUrl("/hero-mountains.jpg")` (the asset already ships at `travelplan/public/hero-mountains.jpg` and is currently referenced only by `page.module.css:84`), `backgroundSize: "cover"`, `backgroundPosition: "center"`, content bottom-aligned, `padding: 32px`.
  - [ ] Scrim: an absolutely-positioned `::before`-equivalent `Box` with `background: HERO_SCRIM` imported from `@/components/features/trips/TripIcons`. **Do not paste the gradient literal** and do not use a 3-stop fade — `EXPERIENCE.md:73` and the `HERO_SCRIM` docstring both make the fourth top stop mandatory. **Skip the mockup's `::after` radial sheen**: `DESIGN.md.components.hero-photo.scrim` defines the 4-stop linear gradient and nothing else, and neither the shipped trip hero nor the day hero carries a radial.
  - [ ] Hero content above the scrim (`zIndex: 2`): brand `t("app.brand")` at 13px/900/`0.06em`/uppercase/`#FFFFFF` with `mb: "18px"`; `heroTitle` at 26px/900/`-0.4px`/`#FFFFFF` with `textShadow: "0 2px 14px rgba(0,0,0,.35)"` and `maxWidth: 320`; `heroSubtitle` at 13px/600/`rgba(255,255,255,.88)`/`lineHeight: 1.5`, `maxWidth: 300`. White-on-photo alphas are the sanctioned literal class here — the same ones `TripIcons.ON_PHOTO_CHROME` already carries.
  - [ ] At `xs` the hero collapses to a `minHeight: 180` band above the form and `heroSubtitle` is hidden (`display: { xs: "none", md: "block" }`). `EXPERIENCE.md:19` mocked desktop only; a half-viewport photo on a 390px screen pushes the email field below the fold. Pure `sx` breakpoint objects — **no `useMediaQuery`** (deferred finding from 7.2).
  - [ ] Hero photo is decorative: it is a CSS background on a `<div>` with no `<img>`, per `DESIGN.md.Photo Alt-Text` ("hero-photo (trip, day, and login/reset side panels) … empty alt"). Nothing to label.
  - [ ] Form column (`.auth-form-col`): `backgroundColor: theme.palette.background.default` (`#F7F4EC` — this is `paper`, which `theme.ts` exposes as `background.default`, **not** as a `tokens.*` entry), centred, `padding: { xs: "32px 20px", md: 40 }`. Card (`.auth-card`): `width: "100%"`, `maxWidth: 340`. It is a plain `Box` — **not** a `Paper`; `theme.ts:245-251`'s `MuiPaper` override stamps a border on every `Paper`, which is why 7.3, 7.8 and 7.9 all avoid it here.
  - [ ] Optional `stepLabel` renders the mockup's `.step-pill` (`forms-authoring.html:468-481`): `display: inline-flex`, 10.5px/800/`0.06em`/uppercase, `color: palette.primary.main`, `backgroundColor: tokens.accentSoft`, `padding: "5px 10px"`, `borderRadius: "5px"`, `mb: "14px"`.
  - [ ] `title` → 21px/900/`-0.3px`/`tokens.ink`, rendered as `component="h1"`. `subtitle` → 12.5px/600/`tokens.inkSoft`/`lineHeight: 1.5`, `mb: "22px"`. Each auth screen is a page and gets exactly one `h1` — do not use `variant="heading"`'s default element, which is a `<span>` (see Typography traps).
  - [ ] `footer` renders below the form in the `.auth-foot` treatment: 12px/600/`tokens.inkSoft`, centred, `mt: "16px"`; links inside it are `palette.primary.main`/700.
  - [ ] Notices: one local `AuthNotice` component in this file, `tone: "warn" | "success"`, rendered directly above the form (`EXPERIENCE.md:86` puts non-field errors at the top of the surface). Warn: `tokens.warnBg` fill, `1px solid tokens.warnBorder`, `palette.warning.main` text, `WarningTriangleIcon` from `TripIcons`. Success: `tokens.accentSoft` fill, `1px solid ${alpha(theme.palette.primary.main, 0.24)}`, `palette.primary.main` text, `CheckIcon` from `TripIcons`. Both 8px radius, `padding: "12px 14px"`, `role="alert"`, icon `aria-hidden`.
  - [ ] **Do not use MUI `<Alert severity="error">`.** `theme.ts:151-157` defines no `error` palette entry, so MUI falls back to its default `#d32f2f` red — a colour absent from `DESIGN.md`. This is the same constraint Story 7.8's AC states for "Reise löschen". `role="alert"` is the semantics the current `Alert` was carrying; `AuthNotice` keeps it.

- [ ] **Task 3 — Form primitives and the auth tabs (AC1)**
  - [ ] New `travelplan/src/components/features/auth/AuthField.tsx`, `"use client"` — the above-field caps label + input + error hint triple, used by all five pages so the treatment is declared once.
  - [ ] Props at minimum `{ id: string; label: string; error?: string; ...TextFieldProps }`. Renders `<Typography component="label" htmlFor={id} variant="labelCaps" sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, display: "block", mb: "7px" }}>` then a `<TextField id={id} fullWidth error={Boolean(error)} />`. **The `htmlFor`/`id` pair is the accessible name** — `test/loginPage.test.tsx:50,51` resolves both fields through `getByLabelText`, and the mockup has no floating label. Mockup `.field-label`: `forms-authoring.html:218-228`.
  - [ ] `labelCaps` is 10.5px/`0.08em` in `theme.ts:216`; the mockup's `.field-label` is 11px/`0.06em`. Override those two values in `sx` — do not invent a variant, and do not change `theme.ts`.
  - [ ] **Every field keeps the `type` it has today** — `type="email"` on the four email fields, `type="password"` on every password field (including the new confirm field), and the reset page's token field stays a text/hidden input. Dropping `type="password"` while restructuring the render tree would unmask passwords on screen; it is the single highest-cost mistake available in this story and a plain `AuthField` prop pass-through prevents it.
  - [ ] The 44px height, `tokens.cardAlt` fill, `borderStrong` border, accent focus ring and `errorBorder`/`warnBg` error swap all already come from `theme.ts:279-310`'s `MuiOutlinedInput` override. **Add none of them here.** Verify the computed box in the browser check rather than assuming.
  - [ ] Error hint: pass `helperText` as a node — `WarningTriangleIcon` (12px, `aria-hidden`) plus the message text, 11px/700/`palette.warning.main`, `display: flex`, `gap: 5px`. Override MUI's red with `sx={{ "& .MuiFormHelperText-root.Mui-error": { color: "warning.main" } }}` on the field. Mockup `.field-hint.error`: `forms-authoring.html:287-289`. The text itself is what satisfies `DESIGN.md:244`'s "never colour alone"; the icon is the mockup's addition.
  - [ ] New `travelplan/src/components/features/auth/AuthTabs.tsx` — the two-tab sign-in/register control from `DESIGN.md.Components → auth-tabs`, used by `/auth/login` and `/auth/register` only. Track: `display: flex`, `gap: 6px`, `backgroundColor: tokens.paperOuter`, `borderRadius: 7`, `padding: 4px`, `mb: "22px"`. Each tab `flex: 1`, `minHeight: 44`, centred, 12.5px/800, `borderRadius: 5`. Active: `backgroundColor: tokens.card`, `color: tokens.ink`, `boxShadow: "0 1px 3px rgba(30,28,20,.12)"`. Inactive: transparent, `tokens.inkSoft`.
  - [ ] **The active tab is not a link and not a button.** Render it as a `Box component="span"` with `aria-current="page"`; render the inactive tab as a `next/link`. This is load-bearing: `test/loginPage.test.tsx:52` does `getByRole("button", { name: /sign in/i })` and must keep resolving to the submit button alone. Do not use MUI `Tabs`/`Tab` — `theme.ts:323-345` styles those for in-page tab panels, and these are navigation.
  - [ ] Tabs go **above** the card title on both screens, per Screen E (`trips-list-share-login.html:612-615`). The 44px `minHeight` supersedes the mockup's `padding: 8px 0` (`DESIGN.md:266`).
  - [ ] Primary submit on every screen: `<Button type="submit" variant="contained" fullWidth>` — `theme.ts:253-265` already gives 44px, 6px radius, `accent` fill, 800 weight. Keep the existing `disabled={isSubmitting}` + `<CircularProgress size={22} />` swap on all five pages; `EXPERIENCE.md:85` explicitly permits a small inline spinner for a sub-second submit.

- [ ] **Task 4 — Login and Register pages (AC1, AC2, AC5, AC6)**
  - [ ] `src/app/(auth)/auth/login/page.tsx`: replace the `Container`/`Paper`/`Box` wrapper (`:147-195`) with `AuthScreenShell` + `AuthTabs` + two `AuthField`s. **Everything above the `return` — the `useForm` setup, the CSRF effect, `onSubmit`, `resolveApiError`, `emailRules`, `passwordRules` — is untouched.** Diff the top half of the file to zero lines.
  - [ ] Wire `serverError` → shell `error`, `success` → shell `success` (`t("auth.login.success")`).
  - [ ] Login footer, two lines: the "Forgot password?" link to `/auth/forgot-password` (**AC5 — this link does not exist anywhere in the app today; the entire reset flow is currently unreachable from the UI**), then `auth.login.noAccount` + a link to `/auth/register` reading `auth.login.registerLink`. The register tab and the foot link are deliberately redundant — Screen E draws both (`:628`).
  - [ ] `src/app/(auth)/auth/register/page.tsx`: same treatment, `initialTab="register"`.
  - [ ] **Keep the consent checkbox.** `registerSchema` requires `consent: z.literal(true)` (`authSchemas.ts:13`) and `test/registerRoute.test.ts` pins it; removing it means either an API change or silently hardcoding consent. Screen E replaces it with a passive `.register-note` — that is a mockup shortcut against a form that has no consent field, not a decision to drop consent. Restyle it instead: `FormControlLabel` on a `min-height: 44px` clickable row, 20px box (`theme.ts:346-355` already supplies the token check glyphs), label 13px/600/`tokens.ink`. Whole row is the target, per `DESIGN.md.components.checkbox` and `EXPERIENCE.md:72`.
  - [ ] Drop the separate `.register-note` line. `auth.consentLabel` already states the same commitment; adding a second sentence beside it is the redundancy `DESIGN.md`'s "check before adding" rule guards against.
  - [ ] Move `errors.consent` from its current free-floating `Typography color="error"` (`register/page.tsx:194-198`) into the same warn-toned error-hint treatment `AuthField` uses. `color="error"` is the MUI red this story is removing.
  - [ ] Register footer: `auth.register.haveAccount` + link to `/auth/login` reading `auth.register.loginLink`.

- [ ] **Task 5 — Forgot-password, reset-password, first-login (AC1, AC2, AC4, AC5, AC6)**
  - [ ] `src/app/(auth)/auth/forgot-password/page.tsx` → Screen H Step A. `stepLabel = t("auth.forgot.step")` ("Schritt 1 von 2"), one `AuthField` for email, full-width primary. Footer: `auth.forgot.rememberedPrefix` + link to `/auth/login` reading `auth.backToLogin`. Success renders through the shell's success notice (`auth.forgot.success` — keep the existing "if an account exists" wording; it is deliberately non-enumerating).
  - [ ] `src/app/(auth)/auth/reset-password/page.tsx` → Screen H Step B. `stepLabel = t("auth.reset.step")`.
  - [ ] **The token field:** Screen H Step B shows none, because the emailed link carries it. Keep the field registered, but render it as a hidden input (`type="hidden"`) when `searchParams.get("token")` is non-empty, and as a visible `AuthField` when it is absent. That preserves manual-token entry and keeps `auth.reset.tokenRequired` reachable, while matching the mockup on the path a real user takes. Do not delete the `token` registration — `passwordResetConfirmSchema` requires it (`authSchemas.ts:32`).
  - [ ] **Add a confirm-password field** (Screen H Step B, `forms-authoring.html:817-820`). Client-side only: register `confirmPassword` with `validate: (v, values) => v === values.password || t("auth.reset.confirmMismatch")` plus a `required`. **It must not reach the request body** — build the payload explicitly as `{ token, password }` rather than passing the whole `values` object, which today is forwarded verbatim at `:81`. This is the third and last supersession of AC2.
  - [ ] **The sub-line must not claim to know the email or the link's remaining validity.** No endpoint exposes either, and one that did would be a token-validity oracle for unauthenticated callers. Use the new generic `auth.reset.subtitle` copy from Task 6.
  - [ ] **The success note must not claim auto-login.** `POST /api/auth/password-reset/confirm` issues no session (`confirm/route.ts:77`). Keep the existing `auth.reset.success` ("You can now sign in") in the shell's success notice, and put a link to `/auth/login` in the footer.
  - [ ] `src/app/(auth)/auth/first-login-password/page.tsx` → same shell, no step pill, no tabs, its own hero copy, single password field, footer omitted. **No confirm-password field here** — Screen H's confirm field is mocked for the reset screen; this screen has no mockup and inventing a second field for it would be adding an unreviewed requirement.
  - [ ] All three keep their `useEffect` CSRF fetch, `resolveApiError` switch, `setError` mapping and (for first-login) the `router.push("/")` on success, unchanged.
  - [ ] `reset-password/page.tsx` keeps `useSearchParams` exactly as it is, including the absence of a `<Suspense>` boundary. That is pre-existing; changing it is a build-behaviour change, not a re-skin.

- [ ] **Task 6 — i18n (AC1, AC5)**
  - [ ] All keys land in **both** `src/i18n/en.ts` and `src/i18n/de.ts`, inside the existing `auth.*` block (`en.ts:10-57`, `de.ts:10-57`). New keys:

    | Key | en | de |
    |---|---|---|
    | `auth.tabs.signIn` | `Sign in` | `Anmelden` |
    | `auth.tabs.register` | `Register` | `Registrieren` |
    | `auth.emailPlaceholder` | `name@example.com` | `name@beispiel.de` |
    | `auth.passwordPlaceholderMin` | `At least 8 characters` | `Mind. 8 Zeichen` |
    | `auth.backToLogin` | `Back to sign-in` | `Zurück zur Anmeldung` |
    | `auth.hero.loginTitle` | `Plan trips that don't feel like work.` | `Reisen planen, die sich nicht wie Arbeit anfühlen.` |
    | `auth.hero.loginSubtitle` | `Day plans, stays and budget in one place — together with the people you travel with.` | `Tagespläne, Unterkünfte und Budget an einem Ort — gemeinsam mit deinen Mitreisenden.` |
    | `auth.hero.registerTitle` | `Your first trip cockpit is waiting.` | `Dein erstes Reise-Cockpit wartet.` |
    | `auth.hero.registerSubtitle` | `Register for free and set up your first trip in minutes.` | `Kostenlos registrieren und in wenigen Minuten deine erste Reise anlegen.` |
    | `auth.hero.forgotTitle` | `No problem — happens to the best of us.` | `Kein Problem — passiert den Besten.` |
    | `auth.hero.forgotSubtitle` | `We'll send you a link that gets you back in under a minute.` | `Wir schicken dir einen Link, mit dem du in unter einer Minute wieder Zugriff hast.` |
    | `auth.hero.resetTitle` | `Almost there.` | `Fast geschafft.` |
    | `auth.hero.resetSubtitle` | `Set a new password and you're back in your trip cockpit.` | `Leg ein neues Passwort fest und du bist direkt wieder in deinem Reise-Cockpit.` |
    | `auth.hero.firstLoginTitle` | `One step before you start.` | `Ein Schritt, bevor es losgeht.` |
    | `auth.hero.firstLoginSubtitle` | `Replace the temporary password from your invitation and the trip is yours.` | `Ersetze das temporäre Passwort aus deiner Einladung und die Reise gehört dir.` |
    | `auth.login.forgotLink` | `Forgot password?` | `Passwort vergessen?` |
    | `auth.login.noAccount` | `No account yet?` | `Noch kein Konto?` |
    | `auth.login.registerLink` | `Register now` | `Jetzt registrieren` |
    | `auth.register.haveAccount` | `Already registered?` | `Bereits registriert?` |
    | `auth.register.loginLink` | `Sign in now` | `Jetzt anmelden` |
    | `auth.forgot.step` | `Step 1 of 2` | `Schritt 1 von 2` |
    | `auth.forgot.rememberedPrefix` | `Remembered it?` | `Erinnert?` |
    | `auth.reset.step` | `Step 2 of 2` | `Schritt 2 von 2` |
    | `auth.reset.confirmPassword` | `Confirm password` | `Passwort bestätigen` |
    | `auth.reset.confirmPlaceholder` | `Repeat password` | `Passwort wiederholen` |
    | `auth.reset.confirmRequired` | `Please confirm your new password` | `Bitte bestätige dein neues Passwort` |
    | `auth.reset.confirmMismatch` | `Passwords do not match` | `Passwörter stimmen nicht überein` |

  - [ ] Changed **values** on existing keys (keep every key name — call sites do not move):

    | Key | New en | New de | Why |
    |---|---|---|---|
    | `auth.login.subtitle` | `Sign in to see your trips.` | `Melde dich an, um deine Reisen zu sehen.` | Screen E `:616` |
    | `auth.register.subtitle` | `Ready in seconds.` | `In wenigen Sekunden startklar.` | Screen E `:648` |
    | `auth.forgot.subtitle` | `Enter your email address. We'll send you a link to reset it.` | `Gib deine E-Mail-Adresse ein. Du bekommst von uns einen Link zum Zurücksetzen.` | Screen H `:778` |
    | `auth.forgot.submit` | `Send reset link` (unchanged) | `Link zum Zurücksetzen senden` | Screen H `:784`; the German currently reads only "Link senden" |
    | `auth.reset.subtitle` | `Choose a new password for your account.` | `Lege ein neues Passwort für dein Konto fest.` | Replaces "Enter the reset token and your new password" — the token field is now hidden on the linked path. **Deliberately not the mockup's email+validity line** (Scope note 1) |
    | `auth.reset.submit` | `Save password` | `Passwort speichern` | Screen H `:821` |

  - [ ] Do **not** touch `auth.login`, `auth.register`, `auth.logout` (`:10-12`) — those are `authMenu.ts`'s header labels and `test/authMenu.test.ts` pins them. `auth.tabs.*` exists precisely so the tabs do not borrow them.
  - [ ] Do **not** change `auth.login.submit` ("Sign in") — `test/loginPage.test.tsx:52,89` queries the submit button by that name.
  - [ ] No `formatMessage` interpolation is needed anywhere in this story; every new key is a static string.
  - [ ] Both dictionaries are plain flat `Record<string, string>` objects and must stay key-for-key identical. Add each key to both files in the same edit.

- [ ] **Task 7 — Tests (all ACs)**
  - [ ] `test/loginPage.test.tsx` — two edits, no assertion changes. (1) Import path → `@/app/(auth)/auth/login/page`. (2) Swap the two bare `render(<I18nProvider …>)` calls for `renderWithProviders` from `test/helpers/renderWithProviders.tsx`. **The second is mandatory, not cosmetic**: the moment the page reads `theme.palette.tokens.*` it throws under MUI's bare default theme. 7.3, 7.4 and 7.5 each lost time to exactly this. The four existing queries (`getByLabelText(/email/i)`, `getByLabelText(/^password$/i)`, `getByRole("button", { name: /sign in/i })`, and both `pushMock` expectations) must all keep passing untouched — if one breaks, the component is wrong, not the test.
  - [ ] **New `test/authScreens.test.tsx`** — four of the five pages have never had a component test. Render each directly under `renderWithProviders`. Mock `next/navigation` for `useRouter` and, on the reset page, `useSearchParams`. Cover:
    - (a) Login renders the brand, the hero title, an `aria-current="page"` sign-in tab, and a "Register" **link** (`role="link"`) pointing at `/auth/register` — asserting the tab is not a button is what protects the `loginPage` query.
    - (b) Login renders a link to `/auth/forgot-password` (AC5).
    - (c) A failed login (`invalid_credentials`) renders the message inside a `role="alert"` node and **not** inside a MUI `Alert` with error-red — assert on `role="alert"` text, and separately assert the tree contains no `.MuiAlert-standardError`.
    - (d) Register still requires consent: submitting with the checkbox unchecked shows `auth.consentRequired` and issues **no** `POST /api/auth/register`.
    - (e) Register submits `{ email, password, consent: true }` when the box is checked — the payload shape is what `registerSchema` pins.
    - (f) Forgot-password shows "Step 1 of 2", posts to `/api/auth/password-reset/request`, and renders the success notice.
    - (g) Reset-password with `?token=abc`: no visible field labelled "Reset token", and a successful submit still sends `token: "abc"`.
    - (h) Reset-password with no `token` query param: the visible token field **is** present.
    - (i) Reset-password confirm mismatch blocks submit — inline error shown, `fetch` never called with `/password-reset/confirm`.
    - (j) Reset-password payload contains exactly `["password", "token"]` (sorted key-set assertion) — this is what proves `confirmPassword` never reaches the API. A payload key-set assertion is what caught a missing field during the hero-image investigation; reuse the technique.
    - (k) First-login renders inside the shell (hero title present), posts, and calls `router.push("/")`.
  - [ ] Do not attempt to assert 44px heights or the focus ring in jsdom — neither computes there (`data-layout` is on the deferred list precisely for faking this). Those belong in the browser check.
  - [ ] Run `npm test`, `npx tsc --noEmit -p .`, and `eslint` on the touched files, all from `travelplan/`. **Establish the baseline with `git stash` first** rather than assuming: 7.4 recorded 556 tests / 152 tsc errors / 3 eslint warnings after its review, and 7.5 has landed since. Triage each failure as a stale assertion (fix it, say so) or a real regression (fix the code).
  - [ ] None of the five auth pages appears in `eslint.config.mjs:31`'s `react-hooks/set-state-in-effect` warn-scoped list, and all five contain a `setState`-in-`useEffect` CSRF fetch. **They pass today** (the rule flags the pattern only in certain shapes) — confirm eslint is still clean on them after the move; if the rule newly fires, the correct response is to leave the effect alone and report it, not to refactor auth bootstrapping inside a visual story.
  - [ ] Manual browser check on a real dev server against a **throwaway** database — never `prisma/dev.db`, which holds Tommy's real trip data (the suite destroyed real uploads once already; see `deferred-work.md`, hero-image investigation). Verify: all five URLs still resolve with no app topbar; the hero photo renders with the 4-stop scrim on each; the split holds at 1200px and collapses to a 180px band at 390px with no horizontal overflow; computed height ≥44px on every input, button and tab; focus ring visible on each field and on the submit button; a real login, a real registration, a real reset request, a real reset via an emailed-style `?token=` URL, and a real first-login password change all still succeed; the tab and foot links navigate.

## Dev Notes

### Scope boundary

This story owns **five page components, one new route-group layout, and one new `components/features/auth/` folder**. Do **not** touch:

- `src/theme.ts`. Every token, the 44px primitives, the focus ring, the error swap, the checkbox glyphs and the modal shadow already exist. If you find yourself adding one, the value belongs in a component. (`MuiInputLabel`'s shrink override at `:234-243` becomes unused on these screens — leave it; other dialogs still float labels.)
- `src/components/features/trips/*`. You **import** `HERO_SCRIM`, `WarningTriangleIcon`, `CheckIcon` and `toCssUrl` from `TripIcons.tsx`; you do not move, rename or edit that file. Story 7.8 is `ready-for-dev` against `TripTimeline.tsx` and `TripBucketListPanel.tsx`, and 7.9 is queued behind it.
- `src/middleware.ts`, `src/lib/auth/*`, `src/lib/validation/authSchemas.ts`, and every `src/app/api/auth/**/route.ts`. No endpoint, schema, session, cookie or redirect changes.
- `src/components/AppHeader.tsx`, `HeaderMenu.tsx`, `src/lib/navigation/authMenu.ts`. The route-group move is how the header stops rendering on auth pages — not a conditional inside the header.
- `src/app/page.tsx` / `HomeHero.tsx` / `page.module.css`. The marketing landing page is not in Epic 7's scope; its two CTAs keep pointing at `/auth/register` and `/auth/login`, which still work.
- `src/app/(routes)/layout.tsx` and everything under `(routes)/trips/`.

### What this story is really about

7.2 and 7.3 were pure re-skins. 7.5 had two data gaps. This one has **one structural gap and three unbuildable mockup claims**, and they are the only places a CSS review would miss a mistake:

1. **The structural gap** is that the split-screen shell cannot exist under `AppHeader`. A route group is the smallest correct fix — it changes no URL, no middleware matcher, no link. Anything else (a conditional header, a `usePathname` wrapper, a duplicated layout) is more code and more surface.
2. **The three unbuildable claims** are the reset screen's email/validity sub-line, its auto-login promise, and the spine's one-surface login/register. Each is enumerated in the Scope note with what to build instead. If a reviewer asks why the screen does not match the mockup at those three points, the answer is in this file — do not "fix" it by building an endpoint that leaks token metadata or a session-issuing reset confirm.

### What must not be built

Every item below has been considered and ruled out. Building any of them is scope creep:

- **A token-metadata endpoint** (email behind a reset token, remaining validity). Scope note 1.
- **Auto-login on reset confirm.** Scope note 2.
- **Collapsing login and register into one route** with client-side tab state. Scope note 3.
- **Removing the consent checkbox** to match Screen E's passive note. Task 4 — `registerSchema` requires it.
- **A confirm-password field on `/auth/first-login-password`.** Task 5 — not mocked.
- **A "show password" toggle, password-strength meter, "remember me", social sign-in, or a terms/privacy route.** None appears in any mockup, in `epics.md`, or in the code.
- **Moving `HERO_SCRIM`/`toCssUrl`/the icons out of `TripIcons.tsx`** into a neutral module. The misplacement is real and already on the deferred list from 7.4's review; fixing it here collides with 7.8.
- **Adding an `error` entry to the MUI palette** so `Alert severity="error"` looks right. `DESIGN.md` defines no red; the warn family is what the system has, and Story 7.8's AC states this constraint explicitly.
- **Refactoring the CSRF-fetch effects.** Task 7.

### Reference implementations to copy, not re-derive

| Pattern | Reference |
|---|---|
| Hero photo + 4-stop scrim + on-photo white text | `TripTimeline.tsx` trip hero (Story 7.2), `TripDayView.tsx` day hero (Story 7.3) |
| `HERO_SCRIM`, `toCssUrl`, `WarningTriangleIcon`, `CheckIcon` | `src/components/features/trips/TripIcons.tsx:37, 61, 191, 226` |
| Caps section/field label | `Typography variant="labelCaps"` (`theme.ts:216`), used at `TripShareDialog.tsx` (7.5) |
| Pill with token background, no icon | `TripsDashboard.tsx` trip-status pill (Story 7.4) — the `.step-pill` is the same shape |
| Token `card`-family surface built on `Box`, not `Paper` | `TripTimeline.tsx:765` |
| Provider-wrapped component render | `test/helpers/renderWithProviders.tsx` |
| Existing page test with a `next/navigation` mock | `test/loginPage.test.tsx:9-15` |
| `sx` breakpoint objects for responsive layout | `TripsDashboard.tsx` row/stat templates (Story 7.4) |

### Token mapping — mockup hex to theme token

**This story adds no new hex literal except the white-on-photo alphas the hero requires**, which are the same class `ON_PHOTO_CHROME` already carries. Hardcoded-literal debt from 7.2 is on the deferred list; do not grow it.

| Mockup | Token |
|---|---|
| `#F7F4EC` form-column background | `theme.palette.background.default` (**not** a `tokens.*` entry — `theme.ts` has no `paper` token) |
| `#EFEAE0` tab track | `tokens.paperOuter` |
| `#FFFFFF` active tab, card surfaces | `tokens.card` |
| `#FBF9F4` input fill | `tokens.cardAlt` (already applied by `MuiOutlinedInput`) |
| `#E4DFD3` hairline rules | `tokens.border` |
| `#D9D0BE` input borders | `tokens.borderStrong` (already applied) |
| `#2B2A26` titles, active tab text, checkbox label | `tokens.ink` |
| `#6B675C` sub-lines, field labels, inactive tab, foot text | `tokens.inkSoft` |
| `#8A8677` placeholders only | `tokens.inkMuted` |
| `#4B6358` primary button, links, step pill text, success text | `palette.primary.main` |
| `#E7EDE7` step pill fill, success notice fill | `tokens.accentSoft` |
| `#C9D2C7` success notice border | `alpha(theme.palette.primary.main, 0.24)` — derive it; do not add a token |
| `#8A5A2B` error hint, warn notice text | `palette.warning.main` |
| `#F6ECE0` / `#E3C7A2` warn notice fill / border | `tokens.warnBg` / `tokens.warnBorder` |
| `#C97A3E` input error border | already applied by `MuiOutlinedInput`'s `Mui-error` rule (`theme.ts:300-302`) |

`tokens.inkMuted` is a known AA failure at small sizes (deferred from 7.3). Use it for placeholders only; anything a user must read to act uses `tokens.inkSoft`.

### Typography traps

- The custom variants (`display`, `heading`, `metricLg`, `cardTitle`, `kicker`, `labelCaps`) have **no `variantMapping`** — `<Typography variant="heading">` renders a `<span>` unless you pass `component=`. This bit 7.2, 7.3 and 7.5. Each auth screen's card title must be `component="h1"`; each field label must be `component="label"` with `htmlFor`.
- Every one of these five routes currently has **no heading element at all** below `h4` — the pages use `variant="h4"`, which does map to `<h4>`. Giving each screen one real `h1` is a strict improvement and does not touch the app-wide heading-level problem recorded in `deferred-work.md` (7-3 review) for the trip screens.
- `labelCaps` is 10.5px/`0.08em`; the mockup's field label is 11px/`0.06em` and the step pill is 10.5px/`0.06em`. Override the deltas in `sx`.

### Responsive behaviour

`EXPERIENCE.md:19` states this design pass mocked desktop only. Established resolution: pure-CSS MUI breakpoint objects in `sx` (`{ xs: …, md: … }`), never `useMediaQuery`. Two things change below `md`: the grid goes single-column, and the hero becomes a 180px band with its sub-line hidden. 7.4 found that its fixed tracks needed ~750px and moved its breakpoint from `sm` to `md` — the auth split has the same problem (a 340px card plus a photo does not fit at 600px), so **use `md`, not `sm`**, as the split's breakpoint.

### Accessibility floor

No formal WCAG claim (`prd.md:207`, `EXPERIENCE.md:99`) — these are the project's stated basics:

- 44×44px on every input, button and tab (`DESIGN.md:266`, `EXPERIENCE.md:106`). Measure the computed box in the browser check; do not infer it from the theme.
- Visible keyboard focus everywhere. `EXPERIENCE.md:95` notes focus visuals were never mocked; MUI's default ring plus `theme.ts`'s accent focus ring satisfies the floor — do not suppress either. Tab order must reach the tabs, every field, the submit button, and the foot links.
- Each field's accessible name comes from a real `<label htmlFor>`. Placeholders are not labels and `tokens.inkMuted` placeholder text is below AA — never let a placeholder be the only description of a field.
- Field errors stay inline and paired with their field; non-field errors go in the top notice (`EXPERIENCE.md:71, 86`). Every warn-coloured signal carries an icon **and** text (`DESIGN.md:258`).
- Every decorative icon (`WarningTriangleIcon`, `CheckIcon`, the checkbox glyph) is `aria-hidden="true"`, because adjacent text always carries the meaning (`EXPERIENCE.md:107`).
- The hero photo is decorative and needs no text alternative (`DESIGN.md.Photo Alt-Text`); it must not be announced.
- The notice region is `role="alert"` so a server error is announced when it appears — that is what the current `<Alert>` provides and what must not be lost.

### Previous story intelligence

From 7.2 / 7.3 / 7.4 / 7.5 — re-applied rules, not discoveries to repeat:

- **A component reading `theme.palette.tokens.*` throws under MUI's bare default theme.** Any test rendering it must use `renderWithProviders`. Three stories in a row lost time here; `loginPage.test.tsx` is currently a bare `I18nProvider` render and will break the instant Task 4 lands. Fix it in the same commit.
- **`Paper` carries a forced border** from `theme.ts:245-251`. 7.3, 7.8 and 7.9 all build card surfaces on `Box` for this reason. All five auth pages currently use `Paper`; none should afterwards.
- **Extract shared pure helpers rather than inlining** (7.4 pulled out `tripStatus.ts` and `formatCost.ts`). Here the equivalent is the three components in `features/auth/` — five pages sharing one shell is the whole point; do not let the hero markup appear twice.
- **Add i18n keys to both dictionaries in the same change** and check for orphans before finishing. `auth.reset.subtitle`'s old wording ("Enter the reset token…") is being replaced, not orphaned; nothing here should end up unreferenced, but grep and say so in Dev Agent Record.
- **7.4's singular/plural finding**: `formatMessage` has no plural support. Nothing in this story is count-bearing, so it does not apply — noted so you do not go looking.
- **Browser check on a throwaway database, from a disposable copy of the app on a spare port.** 7.4's record describes the exact procedure (a second `next dev` refuses to start in the same directory).

### Git intelligence

`HEAD` is `161a58e` (`7-4-trips-list-redesign`). The redesign sequence is `a876b8c` 7.1 → `a65c533` 7.2 → `cacfa72` 7.3 → `57c438d` 5.9 → `161a58e` 7.4.

**The working tree is not clean.** Story 7.5 is `in-progress` and has uncommitted edits to `TripShareDialog.tsx`, `src/app/api/trips/[id]/members/route.ts`, `tripRepo.ts`, `tripMemberSchemas.ts`, two test files, **and both `src/i18n/en.ts` and `src/i18n/de.ts`**. Those two i18n files are the only overlap with this story. Check `git status` before starting; if 7.5 has not landed, rebase onto it rather than editing the dictionaries in parallel — 7.5 adds to the `trips.share.*` block and this story adds to `auth.*`, so the merge is mechanical but only if it happens once.

Established convention from the four Epic 7 commits: one commit per story, tests in the same commit as the code, i18n keys added to both dictionaries in the same change, no new dependency.

### Latest technical information

No new library, no version bump, no migration. Everything is installed and pinned:

- `next` 16.2.12, App Router. Route groups `(name)/` are the supported way to scope a layout without affecting the URL; a nested layout cannot remove an ancestor layout, which is why Task 1 moves the directory instead of adding one. `useSearchParams` in a client component still warrants a `<Suspense>` boundary for static generation — the reset page ships without one today and keeps shipping without one.
- `@mui/material` ^7.3.8 — `Box`, `Typography`, `TextField`, `Button`, `Checkbox`, `FormControlLabel`, `CircularProgress`, and `alpha` from `@mui/material/styles`. `Container`, `Paper` and `Alert` all leave these five files.
- `react-hook-form` ^7.71.1 — unchanged usage plus one `validate` rule on `confirmPassword`. `validate` receives `(value, formValues)`, which is how the mismatch check reads `password` without a `watch`.
- `next/link` for the tab and foot links; `next/navigation` `useRouter`/`useSearchParams` unchanged.
- Vitest ^3.2.7 with `@testing-library/react` ^16.3.2 and `user-event` ^14.6.1.
- No Prisma change: `User`, `PasswordResetToken` and every auth route are untouched.

### Project Structure Notes

Files expected to change:

| Status | Path | Why |
|---|---|---|
| R | `travelplan/src/app/(routes)/auth/**` → `travelplan/src/app/(auth)/auth/**` | Route-group move, all five pages (Task 1) |
| A | `travelplan/src/app/(auth)/layout.tsx` | Header-free layout (Task 1) |
| A | `travelplan/src/components/features/auth/AuthScreenShell.tsx` | Split shell, hero, card, notices (Task 2) |
| A | `travelplan/src/components/features/auth/AuthField.tsx` | Label + input + error hint (Task 3) |
| A | `travelplan/src/components/features/auth/AuthTabs.tsx` | Sign-in / register tabs (Task 3) |
| M | `travelplan/src/app/(auth)/auth/login/page.tsx` | Render tree only (Task 4) |
| M | `travelplan/src/app/(auth)/auth/register/page.tsx` | Render tree + consent row (Task 4) |
| M | `travelplan/src/app/(auth)/auth/forgot-password/page.tsx` | Render tree (Task 5) |
| M | `travelplan/src/app/(auth)/auth/reset-password/page.tsx` | Render tree + token visibility + confirm field (Task 5) |
| M | `travelplan/src/app/(auth)/auth/first-login-password/page.tsx` | Render tree (Task 5) |
| M | `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` | 28 new keys, 6 changed values (Task 6) |
| M | `travelplan/test/loginPage.test.tsx` | Import path + `renderWithProviders` (Task 7) |
| A | `travelplan/test/authScreens.test.tsx` | **New** — first component test for four of the five pages (Task 7) |
| M | `_bmad-output/implementation-artifacts/sprint-status.yaml` | Status transitions |

This matches `architecture.md`'s boundaries: App Router routes under `app/`, feature components under `components/features/*`, validation only in `lib/validation/*` with Zod (untouched here), the `{ data, error }` envelope (untouched here). No schema migration, no new dependency, no Redux slice, no API change. If any of those seem necessary, the change belongs in a different story.

### References

- `_bmad-output/planning-artifacts/epics.md` → "Epic 7: Visual Redesign — Light Cockpit System" (`:1549-1551`, framing and source-of-truth pointer) → "Story 7.6: Login, Register, and Password Reset Redesign" (`:1667-1683`, AC1–AC2 copied verbatim above). Sibling scope: 7.5 (`:1645`, `in-progress`), 7.7 (`:1685`, owns the create/add-entry dialogs), 7.8 (`:1703`, `ready-for-dev`, and the precedent for superseding a prior AC plus the "no MUI red, the palette has no `error` entry" constraint), 7.9 (`:1740`, the `Paper`-vs-`Box` constraint restated). FR inventory `:19-51` (FR1 `:19`, FR2 `:20`, FR29 `:48`); "Additional Requirements" `:73` (CSRF on every state-changing request), `:82` (44×44px touch targets, visible focus, full keyboard navigation), `:79` (Material UI as the baseline component system).
- `_bmad-output/planning-artifacts/prd.md` — "Accessibility Level" (`:207`, no formal standard, basic best practices only).
- `.../ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — front-matter `colors` (`:10-26`), `typography` (`:27-67`), `rounded` (`:68-75`), `spacing` (`:76-88`), `components.hero-photo` (`:90-97`, the 4-stop scrim), `components.button`/`input`/`select`/`tab`/`checkbox` (`:154-184`, all at 44px); prose "Colors" (`:205`, warn reserved for gaps; `accent-soft` as the non-warning soft background), "Typography" (`:209-213`), "Elevation & Depth" (`:225`, only the active tab's micro-lift is shadowed on these screens), "Shapes" (`:229`), "Components → hero-photo" (`:233`, "on the auth screen, a static marketing panel beside the login/register form"), "→ auth-tabs" (`:242`), "→ button" (`:243`), "→ input / select" (`:244`, the three states and the mandatory inline error line), "→ checkbox" (`:245`), "Photo Alt-Text" (`:249-252`, the login/reset side panels are decorative), "Do's and Don'ts" (`:266`, the 44px floor supersedes the smaller paddings in the original Login mockup — `forms-authoring.html`'s swatch sheet is the corrected reference).
- `.../EXPERIENCE.md` — "Foundation" (`:17-21`, desktop-first, desktop-only mockups, MUI-as-substrate unconfirmed but tokens are the source of truth), "Information Architecture" (`:33` Screen E reached from unauthenticated entry, `:36` Screen H reached from the "Passwort vergessen?" link — **the basis for AC5**, `:37` the Form-Bausteine sheet backs every form row here), "Voice and Tone" (`:47-56`, German copy, warm and concrete), "Component Patterns → auth-tabs / type-tabs" (`:69`), "→ button" (`:70`), "→ input / select" (`:71`), "→ checkbox" (`:72`), "→ hero-photo scrim-strengthening rule" (`:73`, names the Login/Register side panel explicitly), "State Patterns" (`:85` inline spinner permitted for a short submit, `:86` non-field errors as a warn-toned banner that must not auto-dismiss), "Interaction Primitives" (`:93`, the one-surface claim — see Scope note 3; `:95`, hover/focus never mocked), "Accessibility Floor" (`:103-107`), "Key Flow 3 step 2" (`:137`, Konni registers beside the same hero panel), "Key Flow 5" (`:156-164`, the whole reset flow **including its two unbuildable claims** — the validity window at step 3 and the auto-login at step 5).
- `.../mockups/trips-list-share-login.html` — Screen E markup `:595-664` (login card `:602-630`, register card `:633-661`), CSS `:310-424`: `.auth-shell` `:313`, `.auth-hero` `:318`, `.auth-hero::before` scrim `:330`, `.auth-hero::after` radial (**skipped** — see Task 2) `:336`, `.auth-hero-content` `:342`, `.auth-brand` `:343`, `.auth-hero-title` `:344`, `.auth-hero-sub` `:353`, `.auth-form-col` `:355`, `.auth-card` `:362`, `.auth-tabs` `:366`, `.auth-tab` `:367`, `.auth-tab.active` `:376`, `.auth-card-title` `:378`, `.auth-card-sub` `:379`, `.field-block` `:381`, `.auth-submit` `:384`, `.auth-foot` `:396-403`, `.register-note` `:418`. **This file's input/button heights predate the accessibility fix** — `DESIGN.md:266` supersedes them with the Form-Bausteine primitives in `forms-authoring.html:213-330`.
- `.../mockups/forms-authoring.html` — Screen H Step A `:759-790`, Step B `:792-831`, Screen I swatch sheet `:836-930`. CSS: `.field-block` `:213`, `.field-label` `:218-229`, `.field-input` `:231-247`, `.field-hint` / `.field-hint.error` `:287-289`, `.btn-primary` `:293-312`, `.btn-secondary` `:313`, `.type-tabs`/`.type-tab` (the same pill technique as `.auth-tabs`, at the corrected 44px) `:334-348`, `.checkbox-row` `:413`, `.checkbox-box` `:420-429`, `.checkbox-label` `:430`, `.auth-shell`/`.auth-hero` (1:1 from Screen E) `:435-463`, `.auth-form-col`/`.auth-card` `:465-466`, `.step-pill` `:468-481`, `.auth-card-title`/`.auth-card-sub` `:483-484`, `.auth-foot` `:486-487`, `.success-note` `:489-500`.
- `_bmad-output/implementation-artifacts/7-5-share-dialog-redesign.md` — the whole Dev Notes block; "Typography traps", "Accessibility floor", "Token mapping", and the scope-note precedent this story's Scope note follows.
- `_bmad-output/implementation-artifacts/7-4-trips-list-redesign.md` — Dev Agent Record: the provider-wrapper trap, the throwaway-database procedure, the payload key-set lesson, the baseline-by-`git stash` procedure, and the `sm`→`md` breakpoint finding.
- `_bmad-output/implementation-artifacts/deferred-work.md` — "npm-audit-zero-vuln-gate" (`:8`, the `set-state-in-effect` warn-scoped file list — **none of the auth pages is on it**), "code review of 7-2" (`:23` hardcoded-literal debt, `:25` why `useMediaQuery`/`data-layout` must not be replicated), "code review of 7-3" (`:55` `inkMuted` contrast), "code review of 7-4" (`:32` design-system constants living in `TripIcons.tsx`), "hero-image investigation" (`:41`, why the browser check uses a throwaway database).
- `travelplan/src/app/(routes)/auth/login/page.tsx` (197 lines), `register/page.tsx` (207), `forgot-password/page.tsx` (175), `reset-password/page.tsx` (198), `first-login-password/page.tsx` (178) — **read all five in full**; every current-state line reference above is from them. They are near-identical in structure: CSRF effect, `onSubmit` with `resolveApiError`, `useMemo` rules, then a `Container`/`Paper` render tree. Only the render tree changes.
- `travelplan/src/app/(routes)/layout.tsx` (the `AppHeader` mount this story escapes), `src/app/layout.tsx` + `src/app/theme-registry.tsx` (`ThemeProvider` is app-wide, so the new components get the theme without extra wiring), `src/middleware.ts:32,42,55,66` (the redirect targets and matcher that must keep working).
- `travelplan/src/theme.ts` — tokens `:158-171`, custom variants `:185-222`, `MuiPaper` forced border `:245-251`, `MuiButton` `:253-273`, `MuiOutlinedInput` (44px, fill, focus ring, error swap) `:279-311`, `MuiTab` `:332-345`, `MuiCheckbox` glyphs `:346-355`.
- `travelplan/src/components/features/trips/TripIcons.tsx:37` (`WarningTriangleIcon`), `:61` (`CheckIcon`), `:191` (`HERO_SCRIM` and its docstring on why four stops), `:226` (`toCssUrl` and why the URL must be quoted/escaped).
- `travelplan/src/lib/validation/authSchemas.ts` (all five schemas — the contracts this story must not violate), `src/app/api/auth/password-reset/confirm/route.ts:77` (returns `ok({ success: true })`, issues no session), `src/app/api/auth/register/route.ts`, `src/lib/navigation/authMenu.ts:13-14` (header labels that must keep their current values).
- `travelplan/src/i18n/en.ts:10-57` and `de.ts:10-57` (the `auth.*` block), `src/i18n/index.ts:23` (`formatMessage`, not needed here).
- `travelplan/test/loginPage.test.tsx` (95 lines — the only existing component test on any auth page, and the exact four queries that must survive), `test/helpers/renderWithProviders.tsx`, `test/authMenu.test.ts` (pins `auth.login`/`auth.register`/`auth.logout`), `test/registerRoute.test.ts` / `loginRoute.test.ts` / `passwordResetRequestRoute.test.ts` / `passwordResetConfirmRoute.test.ts` / `firstLoginPasswordRoute.test.ts` (API-level, must pass untouched — if one of these breaks you changed an endpoint), `travelplan/eslint.config.mjs:31`.
- `_bmad-output/planning-artifacts/architecture.md` — "Structure Patterns" (`:241`), "Format Patterns" (`:256`), "Architectural Boundaries" (`:392`, feature components under `components/features/*`).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev. AC1–AC2 copied verbatim from `epics.md`; AC3–AC5 added because the split-screen shell cannot render under `AppHeader`, `/auth/first-login-password` is a fifth auth screen the epic does not name, and the reset flow has no UI entry point at all — see the Scope note. Three mockup claims (token email/validity, auto-login on reset, one-surface login/register) are documented as deliberately not built.
