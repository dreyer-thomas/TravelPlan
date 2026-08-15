import { describe, expect, it } from "vitest";
import { MIN_HEIGHT_FULL_VIEWPORT, expectNoFullViewportFloor } from "./helpers/fullViewportFloor";

/**
 * Covers the DW-59 guard the two full-page map shells share, for the same reason
 * `hardcodedColour.test.ts` covers its own: both shells are clean, so the two suites that call
 * `expectNoFullViewportFloor` only ever exercise the passing path. Weakening the regex - or reducing
 * the helper to a no-op - would leave them green while the floor it exists to catch walks back in.
 *
 * The spellings below are the ones a later change would plausibly reach for. The multi-breakpoint
 * case is the one that motivated the second regex branch: the scalar branch stops at the first comma,
 * so `{ xs: "50vh", md: "100vh" }` slipped past it while the single-key `{ xs: "100vh" }` did not.
 *
 * The two `calc`-masked cases are the second branch's own near-miss, pinned after review found it:
 * while the `calc(` exclusion applied to the whole `{ ... }` group, the first `calc()` inside the
 * braces hid every later value, so a mixed object let a bare `100vh` through. That is not an exotic
 * spelling - the map's own height is a `calc()`, so an author reaching for it at one breakpoint and
 * a plain floor at another writes exactly this.
 *
 * The negatives are pinned as deliberately as the positives. `calc(` is excluded so the map's own
 * `max(240px, calc(100vh - 331px))` stays legal where it needs to be a `minHeight` - in the scalar
 * *and* the responsive spelling, including the comma inside `max(...)` - and a plain
 * `height: "100vh"` is out of scope: a full-bleed child that is not a sibling of the app header does
 * not produce the `100vh + header` document that DW-59 was about.
 */
describe("MIN_HEIGHT_FULL_VIEWPORT", () => {
  it.each([
    ["a double-quoted floor", 'sx={{ minHeight: "100vh" }}'],
    ["a single-quoted floor", "sx={{ minHeight: '100vh' }}"],
    ["a template literal", "sx={{ minHeight: `100vh` }}"],
    ["the CSS property spelling", "min-height: 100vh;"],
    ["the quoted CSS property spelling", '"min-height": "100vh"'],
    ["a single-breakpoint responsive floor", 'sx={{ minHeight: { xs: "100vh" } }}'],
    ["a multi-breakpoint responsive floor", 'sx={{ minHeight: { xs: "50vh", md: "100vh" } }}'],
    ["a multi-line responsive floor", 'minHeight: {\n  xs: "50vh",\n  md: "100vh",\n}'],
    ["the dynamic viewport unit", 'sx={{ minHeight: "100dvh" }}'],
    ["the small viewport unit", 'sx={{ minHeight: "100svh" }}'],
    ["the large viewport unit", 'sx={{ minHeight: "100lvh" }}'],
    ["a floor masked by an earlier calc breakpoint", 'sx={{ minHeight: { xs: "calc(100vh - 40px)", md: "100vh" } }}'],
    ["the multi-line form of that", 'minHeight: {\n  xs: "calc(100vh - 40px)",\n  md: "100vh",\n}'],
  ])("matches %s", (_label, source) => {
    expect(MIN_HEIGHT_FULL_VIEWPORT.test(source)).toBe(true);
  });

  it.each([
    ["the map's own constant", 'sx={{ minHeight: "max(240px, calc(100vh - 331px))" }}'],
    ["a calc floor inside a responsive object", 'sx={{ minHeight: { md: "calc(100vh - 331px)" } }}'],
    ["a plain full-bleed height", 'sx={{ height: "100vh" }}'],
    ["a partial viewport floor", 'sx={{ minHeight: "50vh" }}'],
    ["a longer unit that merely starts with 100vh", 'sx={{ minHeight: "100vhx" }}'],
    ["an unrelated declaration on the same line", 'sx={{ minHeight: 44, maxWidth: "100vh" }}'],
    ["the map's own constant inside a responsive object", 'sx={{ minHeight: { md: "max(240px, calc(100vh - 331px))" } }}'],
    ["a responsive object whose every value is a calc", 'sx={{ minHeight: { xs: "calc(100vh - 40px)", md: "calc(100vh - 60px)" } }}'],
  ])("does not match %s", (_label, source) => {
    expect(MIN_HEIGHT_FULL_VIEWPORT.test(source)).toBe(false);
  });
});

describe("expectNoFullViewportFloor", () => {
  // The helper is only useful if it actually reads the file it is given; a passing assertion against
  // a path that does not exist would be the quietest possible way for the guard to become a no-op.
  // Matched on `ENOENT` rather than left as a bare `.toThrow()`: any throw would satisfy that,
  // including the helper's own assertion failing for an unrelated reason, so it would not actually
  // distinguish "read the file" from "blew up somewhere".
  it("throws rather than passing when the file is missing", () => {
    expect(() => expectNoFullViewportFloor("src/app/(routes)/trips/[id]/nope/page.tsx")).toThrow(/ENOENT/);
  });
});
