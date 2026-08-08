// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import theme from "@/theme";

/**
 * The two checkbox icons `theme.components.MuiCheckbox.defaultProps` supplies.
 *
 * DW-134 moved both off `children`-as-a-prop and onto trailing `createElement` arguments, which is what
 * cleared the repo's last two lint errors. That rewrite is easy to get subtly wrong - drop one of the
 * two trailing arguments for the checked icon and the tick disappears, leaving a filled square that
 * still reads as "checked" - and nothing asserted the output: no suite references either icon, and the
 * one suite that renders a themed `Checkbox` (`authScreens.test.tsx`) says nothing about its SVG. So the
 * only production change in the DW-134 sweep rested entirely on reading the diff.
 *
 * These cases assert the rendered shape rather than the element tree, because the defect being guarded
 * is a child that never reaches the DOM.
 */
const markup = (icon: unknown) => {
  const { container } = render(icon as ReactElement);
  return container;
};

const icons = theme.components?.MuiCheckbox?.defaultProps;

describe("theme MuiCheckbox icons", () => {
  it("supplies both an icon and a checkedIcon", () => {
    expect(icons?.icon).toBeDefined();
    expect(icons?.checkedIcon).toBeDefined();
  });

  it("renders the unchecked icon as a single stroked, unfilled box", () => {
    const svg = markup(icons?.icon).querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");

    const rects = svg?.querySelectorAll("rect") ?? [];
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute("fill")).toBe("none");
    // Read back off the theme rather than spelled as a hex here. This suite is about the two children
    // surviving the `createElement` rewrite, not about which colour the border is - pinning the value
    // would make a palette change break a test that has no opinion on the palette.
    expect(rects[0]?.getAttribute("stroke")).toBe(theme.palette.tokens.borderStrong);
    // No tick when unchecked - the two icons are not interchangeable.
    expect(svg?.querySelectorAll("path")).toHaveLength(0);
  });

  it("renders the checked icon as a filled box *and* a tick, both children surviving", () => {
    const svg = markup(icons?.checkedIcon).querySelector("svg");

    expect(svg).not.toBeNull();

    const rects = svg?.querySelectorAll("rect") ?? [];
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute("fill")).toBe(theme.palette.primary.main);

    // The child a mis-applied `createElement` rewrite loses. Without it the control still paints an
    // accent square, so every existing assertion about "checked" would keep passing.
    const paths = svg?.querySelectorAll("path") ?? [];
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute("d")).toBe("M5.5 10.5l3 3 6-6.5");
    expect(paths[0]?.getAttribute("stroke")).toBe("#FFFFFF");
  });

});

/**
 * No case here asserts that the children are passed as trailing `createElement` arguments rather than
 * inside the props object, and none can: React assigns `props.children` from the config when there are
 * no trailing arguments, so the two spellings build the same element. Rendered side by side they are
 * byte-identical, and `children` is a reserved prop React never forwards to a host element, so it
 * appears in neither `innerHTML`.
 *
 * An earlier case in this file asserted exactly that and therefore passed on the pre-fix code too. It
 * is removed rather than repaired because there is no assertion that would distinguish them. The lint
 * rule `react/no-children-prop` is the only guard against the props-object spelling returning, which is
 * the whole reason it is a lint rule; what this suite guards is the failure mode lint cannot see - a
 * child dropped during the rewrite, caught by the rendered-shape cases above.
 */
