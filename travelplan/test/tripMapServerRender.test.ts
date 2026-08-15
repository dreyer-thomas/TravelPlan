import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/hardcodedColour";

/**
 * Every map surface must be importable without a DOM.
 *
 * `react-leaflet` and `leaflet` read `window` at module evaluation, so a client component that
 * imports its Leaflet child *statically* throws `ReferenceError: window is not defined` the moment
 * Next server-renders it. `TripDayMapFullPage` did exactly that from Story 2.28 until DW-59's
 * measurement pass tripped over it, and `/trips/{id}/days/{dayId}/map` answered **500** - in
 * `next dev` and in a production build alike. The three sibling surfaces were always correct,
 * reaching their Leaflet child through `dynamic(..., { ssr: false })`.
 *
 * Nothing caught it. Every suite that renders these components mocks `react-leaflet` and `leaflet`,
 * so under those mocks a static import is perfectly happy and the whole route stays green while
 * being unreachable in production. This suite installs no mocks for exactly that reason: it asserts
 * the real module graph loads with no `window` in scope, which is the condition the server actually
 * evaluates them under.
 *
 * This file must therefore keep the config default of `environment: "node"` and carry **no**
 * environment docblock. Note that vitest scans the file's leading comments for that directive by
 * text, so even naming the jsdom directive in prose up here switches the whole suite over and makes
 * every assertion below vacuous - which is what the first test guards against. Import failures
 * surface as a rejected `import()`, so resolving to a component is the check.
 */
describe("map surfaces render on the server", () => {
  it("has no DOM in this environment", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it.each([
    ["TripDayMapFullPage", () => import("@/components/features/trips/TripDayMapFullPage")],
    ["TripOverviewMapFullPage", () => import("@/components/features/trips/TripOverviewMapFullPage")],
    ["TripDayMapPanel", () => import("@/components/features/trips/TripDayMapPanel")],
    ["TripOverviewMapPanel", () => import("@/components/features/trips/TripOverviewMapPanel")],
  ])("imports %s without touching window", async (_name, load) => {
    const mod = await load();
    expect(mod.default).toBeTypeOf("function");
  });

  /*
    The import assertion above catches only one spelling of the defect - the *static* import. Going
    back through `dynamic()` with `ssr: true`, or with the options object omitted entirely (whose
    default is `ssr: true`), leaves the module graph exactly as clean: `dynamic` does not evaluate its
    factory at import time, so the suite above stays green while Next server-renders the Leaflet child
    and the route 500s again. The other half of the guard therefore has to read the source.
  */
  it.each([
    "TripDayMapFullPage",
    "TripOverviewMapFullPage",
    "TripDayMapPanel",
    "TripOverviewMapPanel",
  ])("reaches its Leaflet child through ssr: false in %s", (name) => {
    const source = stripComments(
      readFileSync(resolve(__dirname, "..", "src", "components", "features", "trips", `${name}.tsx`), "utf8"),
    );
    // `matchAll`, not `exec`: every Leaflet `dynamic()` in the file has to carry the option, not just
    // the first one the regex happens to reach. A surface that grows a second Leaflet child - a
    // minimap, an overlay - and gets `ssr: true` on it 500s the route exactly as before while a
    // first-match check stays green. Comments are stripped for the mirror of that: a commented-out
    // correct call must not vouch for live code that is wrong.
    const dynamicCalls = [
      ...source.matchAll(/dynamic\(\s*\(\)\s*=>\s*import\([^)]*Leaflet[^)]*\)\s*,\s*\{([^}]*)\}\s*\)/g),
    ];

    expect(
      dynamicCalls.length,
      `${name} does not load its Leaflet child through dynamic() with options`,
    ).toBeGreaterThan(0);
    for (const call of dynamicCalls) {
      expect(call[1], `${name}: ${call[0]}`).toMatch(/ssr\s*:\s*false/);
    }
  });
});
