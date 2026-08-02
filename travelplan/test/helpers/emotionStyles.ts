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
 */
const visitRulesFor = (
  element: Element,
  onRule: (rule: CSSStyleRule, mediaCondition: string | null) => void,
) => {
  const selectors = selectorsFor(element);

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

/**
 * One CSS property's declared values, split by the media condition each declaration sits under.
 */
export const emotionDeclarations = (element: Element, property: string) => {
  const base: string[] = [];
  const media = new Map<string, string[]>();

  visitRulesFor(element, (styleRule, condition) => {
    const value = styleRule.style.getPropertyValue(property).trim();
    if (!value) return;
    if (condition === null) {
      base.push(value);
      return;
    }
    media.set(condition, [...(media.get(condition) ?? []), value]);
  });

  return { base, media };
};

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
