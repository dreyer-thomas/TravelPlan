const CSS_STYLE_RULE = 1;

/**
 * Reads what Emotion actually declared for an element's own `sx` classes, out of the document's
 * stylesheets.
 *
 * jsdom evaluates no media queries and performs no layout, so `getComputedStyle` / `toHaveStyle`
 * cannot see a breakpoint-scoped `sx` value at all - a responsive `maxHeight` is simply invisible to
 * them. Emotion does emit the real rules into `<style>` tags, so read them back through the CSSOM
 * instead of regexing the CSS text, which would be brittle on whitespace, declaration order and
 * vendor prefixes.
 *
 * Story 7.12 introduced this technique in `tripBucketListPanel.test.tsx`; Story 6.10 needed the same
 * traversal with a different projection, so it lives here rather than in two divergent copies.
 */

const selectorsFor = (element: Element) =>
  Array.from(element.classList)
    .filter((name) => name.startsWith("css-"))
    .map((name) => `.${name}`);

/**
 * Walk every style rule that targets `element`, innermost condition first.
 *
 * Recursion keys off `cssRules` rather than the media-rule type, so `@supports`, `@layer` and
 * `@container` are traversed too. Missing one of those would let a declaration hide from the
 * negative assertions and pass them vacuously.
 *
 * `shapeSelector` is applied to each of the element's own class selectors *individually*, so a shape that
 * uses the selector twice - `&&` - yields `.css-a.css-a` and never the cross-product `.css-b.css-a`. An
 * earlier version took a plain suffix string and appended it to every selector, which matched any
 * two-class compound rule and would have let an unrelated `.css-b.css-a { min-height: 44px }` satisfy an
 * assertion about the `&&` form.
 */
const visitRulesFor = (
  element: Element,
  onRule: (rule: CSSStyleRule, mediaCondition: string | null) => void,
  shapeSelector: (classSelector: string) => string = (classSelector) => classSelector,
) => {
  const selectors = selectorsFor(element).map(shapeSelector);

  const targetsElement = (selectorText: string) =>
    selectorText.split(",").some((part) => selectors.includes(part.trim()));

  const visit = (rules: CSSRuleList, condition: string | null) => {
    Array.from(rules).forEach((rule) => {
      // Style rules first: a `CSSStyleRule` carries its own (usually empty) `cssRules` for nested
      // syntax, so testing for that property first would classify every one of them as a group and
      // silently skip the declarations this whole helper exists to read.
      if (rule.type === CSS_STYLE_RULE) {
        const styleRule = rule as CSSStyleRule;
        if (targetsElement(styleRule.selectorText)) onRule(styleRule, condition);
        return;
      }
      const grouping = rule as CSSGroupingRule;
      if (!grouping.cssRules) return;
      const media = rule as CSSMediaRule;
      const nested = media.media ? media.media.mediaText.replace(/\s+/g, "") : condition;
      visit(grouping.cssRules, nested);
    });
  };

  Array.from(document.styleSheets).forEach((sheet) => {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin sheet - jsdom throws rather than exposing its rules. Nothing of ours is there.
      rules = null;
    }
    if (rules) visit(rules, null);
  });
};

const declarationsFor = (
  element: Element,
  property: string,
  shapeSelector?: (classSelector: string) => string,
) => {
  const base: string[] = [];
  const media = new Map<string, string[]>();

  visitRulesFor(
    element,
    (styleRule, condition) => {
      const value = styleRule.style.getPropertyValue(property).trim();
      if (!value) return;
      if (condition === null) {
        base.push(value);
        return;
      }
      media.set(condition, [...(media.get(condition) ?? []), value]);
    },
    shapeSelector,
  );

  return { base, media };
};

/**
 * One CSS property's declared values, split by the media condition each declaration sits under.
 *
 * Reads only single-class rules (`.css-abc { … }`), which is also a statement about specificity: every
 * value this returns was declared at (0,1,0).
 */
export const emotionDeclarations = (element: Element, property: string) => declarationsFor(element, property);

/**
 * The same reading, taken at the doubled-class specificity that `sx: { "&&": … }` emits.
 *
 * Emotion compiles `{ "&&": { minHeight: 44 } }` to `.css-abc.css-abc { min-height: 44px }` - the same
 * class twice, which is the whole point (DW-180: MUI's `MenuItem` resets `minHeight` to `auto` inside a
 * `min-width:600px` rule, and only a selector above (0,1,0) survives that). `emotionDeclarations` cannot
 * see those rules at all: it matches a rule when its selector *equals* one of the element's own class
 * selectors, and `.css-abc.css-abc` never equals `.css-abc`. Reading a `&&` floor through it therefore
 * reports MUI's 48px/auto pair and misses the 44 entirely - a vacuous pass in the direction of "the bug is
 * still there".
 *
 * So the pair reads as: this function says what the winning declaration is, and `emotionDeclarations` says
 * what the losing one-class rules say. The two together are the mechanism DW-180 records.
 *
 * Strictly the *doubled* form, not "any two classes": each of the element's own class selectors is repeated
 * against itself, so `.css-a.css-b` - which Emotion does not emit, but which nothing else would have
 * excluded - cannot stand in for the floor.
 */
export const emotionDoubledSelectorDeclarations = (element: Element, property: string) =>
  declarationsFor(element, property, (classSelector) => `${classSelector}${classSelector}`);

/**
 * Which conditions declare a property, without reading its value.
 *
 * jsdom's CSSOM parses some shorthands into the rule's property list but implements no getter for
 * them - `grid-template-columns` is one: it shows up in `Array.from(rule.style)` while
 * `getPropertyValue` returns `""`, so `emotionDeclarations` reports nothing for it. When the
 * question is *at which breakpoint* a declaration lives rather than what it says, this answers it
 * from the property list instead and sidesteps the gap.
 *
 * Story 6.14 needs it to pin the overview grid's `gridTemplateColumns` breakpoint to the same `md`
 * the trip-controls card's mount point is keyed to - two halves of one decision that nothing else
 * in jsdom can hold together (DW-14).
 */
export const emotionPropertyConditions = (element: Element, property: string) => {
  let base = false;
  const media: string[] = [];

  visitRulesFor(element, (styleRule, condition) => {
    if (!Array.from(styleRule.style).includes(property)) return;
    if (condition === null) {
      base = true;
      return;
    }
    if (!media.includes(condition)) media.push(condition);
  });

  return { base, media };
};

/**
 * Every CSS property Emotion declares for an element, flattened across whatever conditions the
 * declarations sit under. Use when the question is *whether* a property is set at all rather than
 * what it is set to.
 */
export const emotionDeclaredProperties = (element: Element) => {
  const properties = new Set<string>();

  visitRulesFor(element, (styleRule) => {
    Array.from(styleRule.style).forEach((property) => properties.add(property));
  });

  return properties;
};

/**
 * Every declaration Emotion emits under a pseudo-class (e.g. `:focus-visible`) for an element's own
 * `sx` classes, merged into one lookup. jsdom applies no pseudo-class matching to `getComputedStyle`,
 * so a `&:focus-visible` block written in `sx` - as `DocChip.tsx` / `PhotoUploadField.tsx` do - is
 * invisible to `.focus()` + `getComputedStyle` and has to be read back out of the CSSOM instead, the
 * same way `emotionDeclarations` reads an element's plain declarations.
 */
export const emotionPseudoClassStyle = (element: Element, pseudoClass: string) => {
  const style = new Map<string, string>();

  visitRulesFor(
    element,
    (styleRule) => {
      Array.from(styleRule.style).forEach((property) => {
        style.set(property, styleRule.style.getPropertyValue(property));
      });
    },
    (classSelector) => `${classSelector}${pseudoClass}`,
  );

  return style;
};
