import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { stripComments } from "./hardcodedColour";

/**
 * DW-59. Source-text guard against a `100vh` minimum-height floor in a full-page map shell.
 *
 * Both map screens size their map from a `calc(100vh - Npx)` constant tuned so the page fills the
 * viewport exactly. That only works while nothing *else* on the page also claims a full viewport: the
 * shell Box is a sibling of the 73px `AppHeader`, so `minHeight: "100vh"` on it made the document
 * `100vh + 73px` tall and the screen scrolled by exactly the header, whatever the map constant said.
 * That is the defect DW-59 recorded as "the constant under-measures the chrome", and no value of the
 * constant could have closed it.
 *
 * A source scan for the same reason `expectNoHardcodedColour` is one: these are async RSC page
 * shells, so vitest never renders them and there is no DOM to measure. The browser measurement that
 * proved `scrollHeight - clientHeight === 0` is the real check; this only stops the floor being put
 * back by a later change that looks locally reasonable.
 *
 * Scoped to the two full-page map shells on purpose. Five other pages - `users`, `admin/users`,
 * `trips/[id]`, `trips/[id]/costs` and `trips/[id]/days/[dayId]/print` - still set
 * `minHeight: "100vh"` on the same kind of Box and are *not* scanned. On the first four the floor
 * costs a scrollbar on an already-scrolling page rather than breaking a fit, because none of them
 * sizes a child from `100vh`. The print sheet is the pointed one: its own comment records DW-198,
 * a blank trailing page produced by this very interaction - `100vh` resolving against the page box
 * plus the same 73px header - and the floor is kept there deliberately, neutralised for print rather
 * than removed. So this bug class has a prior occurrence, and one page where the floor is the
 * correct answer. Widen the call sites only alongside a decision about those pages, not as a tidy-up.
 *
 * Deliberately narrow on what it matches. `100vh` (and `100dvh`/`100svh`/`100lvh`) is flagged only as
 * the value of a `minHeight`/`min-height`, so a `height: "100vh"` on a genuinely full-bleed child is
 * not swept up with it; `calc(` is excluded so the map's own `calc(100vh - Npx)` can be a `minHeight`
 * where it needs to be. The value side is matched loosely enough to catch a template literal, which
 * the obvious `["']?100vh` form misses.
 *
 * Two branches, because one cannot do both jobs. The scalar branch stops at the first `,`/`;`/`}` or
 * newline so `minHeight: 44, foo: "100vh"` is not read as one declaration - but that same stop makes
 * it blind to the *multi-breakpoint* responsive spelling, where a comma sits between the key and the
 * offending value (`minHeight: { xs: "50vh", md: "100vh" }`). The second branch scans inside a
 * `minHeight: { ... }` group instead, across commas and line breaks, up to the closing brace.
 *
 * In that second branch the `calc(` exclusion has to apply *per breakpoint value*, not to the group
 * as a whole. Excluding it group-wide made the first `calc(` inside the braces mask everything after
 * it, so `minHeight: { xs: "calc(100vh - 40px)", md: "100vh" }` - a mixed object, and the single most
 * likely way this floor comes back given the map's own constant is a `calc()` - went unseen. The
 * optional `(?:[^}]*,)?` prefix restarts the scan at a breakpoint boundary, and the value scan itself
 * stops at any `,`/`{`/`}`, so a bare `100vh` is caught wherever it sits in the object while a value
 * that is *itself* a `calc()` (or a `max(..., calc(...))`, comma and all) still is not. Thirteen
 * spellings and eight non-matches are exercised by `fullViewportFloor.test.ts`.
 *
 * `stripComments` is `hardcodedColour.ts`'s, imported rather than re-implemented - DW-219 pulled that
 * helper out of four divergent copies and this guard is not going to start a fifth. Its two recorded
 * limits are inherited: a `//` inside a string literal truncates the rest of that line, and a `/*`
 * inside one swallows everything to the next terminator, so a floor hidden after either escapes.
 */
const MIN_HEIGHT_KEY = String.raw`(?:minHeight|["']?min-height["']?)`;
/** Scalar value: `minHeight: "100vh"`, `minHeight: \`100vh\``, `minHeight: { xs: "100vh" }`. */
const SCALAR_FLOOR = String.raw`${MIN_HEIGHT_KEY}\s*:\s*(?:(?!calc\()[^,;}\n])*100[dsl]?vh\b`;
/** Multi-breakpoint object: `minHeight: { xs: "50vh", md: "100vh" }`, across commas and newlines. */
const RESPONSIVE_FLOOR = String.raw`${MIN_HEIGHT_KEY}\s*:\s*\{(?:[^}]*,)?(?:(?!calc\()[^,{}])*100[dsl]?vh\b`;
export const MIN_HEIGHT_FULL_VIEWPORT = new RegExp(`${SCALAR_FLOOR}|${RESPONSIVE_FLOOR}`);

/** Package root - `travelplan/` - resolved from this file, as in `hardcodedColour.ts`. */
const packageRoot = resolve(__dirname, "..", "..");

/**
 * @param relativePath package-relative, i.e. starting at `src/`.
 */
export const expectNoFullViewportFloor = (relativePath: string) => {
  const source = readFileSync(resolve(packageRoot, relativePath), "utf8");
  const match = MIN_HEIGHT_FULL_VIEWPORT.exec(stripComments(source));

  expect(
    match?.[0] ?? null,
    `${relativePath} sets a 100vh minimum height; under the app header that makes the page scroll by the header's own height, which FULL_PAGE_MAP_HEIGHT cannot compensate for`,
  ).toBeNull();
};
