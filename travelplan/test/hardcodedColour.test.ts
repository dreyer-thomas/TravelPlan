import { describe, expect, it } from "vitest";
import { HARDCODED_COLOUR, expectNoHardcodedColour, stripComments } from "./helpers/hardcodedColour";

/**
 * Covers the guard that four screen suites now share.
 *
 * Before DW-219 the regex lived in four copies, and a copy that stopped matching took one screen's
 * guard down with it. One definition is better, but it also means one silent edit disarms all four at
 * once - and none of those suites would notice, because every file they scan is clean, so they only
 * ever exercise the passing path. Weakening `HARDCODED_COLOUR`, or reducing
 * `expectNoHardcodedColour` to a no-op, would leave the whole suite green. These cases are what makes
 * that fail instead.
 *
 * The negatives are pinned as deliberately as the positives: the regex is case-sensitive and its
 * named-colour list is short, which is Story 7.13's scope and not an oversight. Asserting the limits
 * keeps them a decision somebody can revisit rather than a surprise somebody discovers.
 */
describe("HARDCODED_COLOUR", () => {
  it.each([
    ["3-digit hex", "color: #fff"],
    ["6-digit hex", "background: #2F343D"],
    ["8-digit hex with alpha", "border: 1px solid #2f343d80"],
    ["rgb()", "color: rgb(255 0 0)"],
    ["rgba()", "color: rgba(0, 0, 0, 0.5)"],
    ["hsl()", "color: hsl(210 40% 96%)"],
    ["hwb()", "color: hwb(210 20% 30%)"],
    ["lab()", "color: lab(52% 40 59)"],
    ["lch()", "color: lch(52% 72 40)"],
    ["oklab()", "color: oklab(0.7 0.1 0.1)"],
    ["oklch()", "color: oklch(0.7 0.1 20)"],
    ["color()", "color: color(display-p3 1 0 0)"],
    ["color-mix()", "color: color-mix(in oklch, white, black)"],
    ["a quoted named colour", 'sx={{ color: "white" }}'],
    ["a quoted named colour, other spelling", "sx={{ color: 'grey' }}"],
  ])("matches %s", (_label, source) => {
    expect(HARDCODED_COLOUR.test(source)).toBe(true);
  });

  it.each([
    ["a token reference", "color: theme.palette.tokens.textPrimary"],
    ["a keyword that names no colour", 'fill: "none"'],
    ["currentColor", 'stroke: "currentColor"'],
    ["an uppercase function - case-sensitive by design", "color: OKLCH(0.7 0.1 20)"],
    ["a named colour outside the listed set - the list is deliberately short", 'color: "navy"'],
    ["an unquoted named colour", "color: white"],
    ["a named colour in a template literal - the branch requires ' or \"", "color: `white`"],
    ["a capitalised named colour - the branch is case-sensitive", 'sx={{ color: "White" }}'],
  ])("does not match %s", (_label, source) => {
    expect(HARDCODED_COLOUR.test(source)).toBe(false);
  });

  it("catches a hex in a template literal, where it misses a named colour", () => {
    // The pair that makes the template-literal hole easy to miss rather than obvious: the hex branch is
    // unquoted, so backticks change nothing for it, while the named-colour branch requires a `'` or `"`
    // and drops the same literal. Asserted together so the asymmetry reads as known, not as a bug found
    // later in whichever half somebody happens to try first.
    expect(HARDCODED_COLOUR.test("color: `#fff`")).toBe(true);
    expect(HARDCODED_COLOUR.test("color: `white`")).toBe(false);
  });

  it("carries no global flag, so it cannot go stateful across the suites that share it", () => {
    expect(HARDCODED_COLOUR.flags).toBe("");
  });

  it("matches a hex-lettered fragment anchor - the documented false positive", () => {
    // Pinned, not endorsed: the hex branch is unanchored, so a `#` plus hex letters matches wherever it
    // sits. A scanned file that needs `href="#facade"` cannot be exempted, only the regex anchored -
    // and the day somebody anchors it, this case fails and points at the decision.
    expect(HARDCODED_COLOUR.test('href="#facade"')).toBe(true);
  });
});

describe("stripComments", () => {
  it("drops a line comment, so an issue reference cannot fail the guard", () => {
    expect(HARDCODED_COLOUR.test(stripComments("// see #1234 for the rationale"))).toBe(false);
  });

  it("drops a block comment", () => {
    expect(HARDCODED_COLOUR.test(stripComments("/* the shell used to paint #2f343d */"))).toBe(false);
  });

  it("keeps a colour that sits on the same line before a comment", () => {
    expect(HARDCODED_COLOUR.test(stripComments('color: "#fff" // deliberate'))).toBe(true);
  });

  it("treats a block-comment opener inside a string literal as a real one - the second blind spot", () => {
    // The mirror of the `//` case, and the more destructive of the two: everything to the next
    // terminator is deleted, so a colour several lines below an innocuous string vanishes with it.
    expect(HARDCODED_COLOUR.test(stripComments('const glob = "/*"; const bg = "#2f343d"; /* end */'))).toBe(false);
  });

  it("truncates at a `//` inside a string literal - the documented blind spot", () => {
    // Pinned, not endorsed: a colour after a URL on one line escapes the guard. Asserting it means the
    // day somebody fixes `stripComments`, this case fails and points at the decision rather than
    // letting the improvement look like a regression.
    expect(HARDCODED_COLOUR.test(stripComments('href="https://example.com" color="#fff"'))).toBe(false);
  });
});

describe("expectNoHardcodedColour", () => {
  it("passes on a source file that carries no colour literal", () => {
    expectNoHardcodedColour("src/app/(routes)/trips/[id]/map/page.tsx");
  });

  it("fails, naming the file and the literal, on a source file that does", () => {
    // `src/theme.ts` is where the colour literals are supposed to live, which makes it a negative case
    // that cannot rot: no future refactor will quietly make this file colour-free.
    //
    // Both halves of the message are pinned. The path alone would stay green through a rewrite back to
    // `expect(source).not.toMatch(...)`, which is the form `helpers/hardcodedColour.ts` argues against
    // precisely because it names no literal - the half a developer actually needs.
    //
    // The literal half accepts any shape the guard can report, not just a hex. Requiring a hex would
    // have pinned this to whichever literal happens to come *first* in `theme.ts` - today `#EFEAE0` on
    // line 57 - so turning that one entry into `rgba(…)` would fail this test while the guard worked
    // perfectly. Every branch of `HARDCODED_COLOUR` is accepted here for the same reason the file
    // itself is the subject: what is being pinned is "the message names the literal", not which one.
    expect(() => expectNoHardcodedColour("src/theme.ts")).toThrow(
      /src\/theme\.ts carries a hardcoded colour literal[\s\S]*(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|["'](?:white|black|whitesmoke|gainsboro|silver|gr[ae]y|ivory|snow)["'])/
    );
  });
});
