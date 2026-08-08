import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

/**
 * Source-text guard against colour literals in a component that vitest cannot assert on any other
 * way.
 *
 * The screens this covers are async RSC page shells: vitest never renders them, so there is no DOM
 * and no CSSOM to read a `backgroundColor` back out of. Scanning the file's own text is the only
 * mechanical check left for "no colour literal remains here", which is why a negative source check
 * earns its place next to the positive style assertions on the client components underneath.
 *
 * The regex is Story 7.13's, kept verbatim: named colours and every colour-function notation are
 * matched so a literal cannot come back in another spelling, and case stays significant (hex spells
 * both cases explicitly) because widening match semantics is a separate decision. Comments are
 * stripped first so an issue reference like `// see #1234` cannot fail the guard. DW-219 pulls all of
 * it out of four copies - two of which carried a strictly weaker regex, so every guard improvement
 * reached only the newest screens.
 *
 * Known limits, and a reader should not assume it closes them. Five let a colour through:
 * - a colour lifted into a constant in another file escapes entirely, since only the one path handed
 *   in is read;
 * - the named-colour branch requires a `'` or `"`, so a template literal - `` color: `white` `` -
 *   escapes it. The hex and function branches are unquoted and do not share this hole, which is why it
 *   is easy to miss: `` `#fff` `` is caught and `` `white` `` is not;
 * - that branch is also case-sensitive, so `"White"` and `"WHITE"` escape where `"white"` is caught.
 *   Case-sensitivity is deliberate for the *function* names (see below), but here it is a consequence
 *   of the same decision rather than a choice made about named colours on their own;
 * - `stripComments` truncates at the first `//` on a line, including one inside a string literal, so
 *   a hex hiding after it on that same line escapes too;
 * - the reverse of that: a block-comment opener inside a string literal opens a comment as far as
 *   `stripComments` is concerned, so everything up to the next comment terminator - colour literals
 *   included - is deleted before the regex ever sees it.
 *
 * And one goes the other way, a false positive. The hex branch is unanchored, so any `#` followed by
 * three-to-eight hex *letters* matches: `href="#add"`, `href="#face"`, `id="#deed"`. There is no
 * exemption mechanism, so a scanned file that legitimately needs such an anchor has to be fixed by
 * anchoring the regex to a colour position instead. `hardcodedColour.test.ts` pins one of these, so the
 * behaviour is a recorded decision rather than a surprise.
 */
export const HARDCODED_COLOUR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|["'](?:white|black|whitesmoke|gainsboro|silver|gr[ae]y|ivory|snow)["']/;

export const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * The **package** root - `travelplan/`, not the repository root a level above it - resolved from this
 * file rather than `process.cwd()`: `vitest.config.ts` sets no `test.root` and the npm script is a bare
 * `vitest run`, so the working directory is wherever vitest happened to be invoked from and a
 * cwd-relative read throws `ENOENT` from anywhere but `travelplan/`. Two levels up, because this helper
 * sits one deeper than the suites that call it.
 */
const packageRoot = resolve(__dirname, "..", "..");

/**
 * Assert that one source file carries no colour literal.
 *
 * @param relativePath package-relative, i.e. starting at `src/` - not `travelplan/src/`, which
 * resolves outside the package and fails with `ENOENT` rather than an assertion.
 *
 * Asserting on the matched text rather than `expect(source).not.toMatch(...)`: a failing `not.toMatch`
 * dumps the whole file and names neither the path scanned nor the literal that tripped it, which is a
 * worse starting point for the fix than the four inline copies gave.
 */
export const expectNoHardcodedColour = (relativePath: string) => {
  const source = readFileSync(resolve(packageRoot, relativePath), "utf8");
  const match = HARDCODED_COLOUR.exec(stripComments(source));

  expect(match?.[0] ?? null, `${relativePath} carries a hardcoded colour literal`).toBeNull();
};
