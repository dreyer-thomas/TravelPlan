// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import TripCostOverviewPage from "@/app/(routes)/trips/[id]/costs/page";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/i18n/server", () => ({
  getServerT: async () => (key: string) => key,
}));

vi.mock("@/components/features/trips/TripDayMapBackButton", () => ({
  default: ({ href, label }: { href: string; label: string }) => (
    <div data-testid="cost-overview-back" data-href={href} data-label={label} />
  ),
}));

vi.mock("@/components/features/trips/TripCostOverview", () => ({
  default: ({ tripId }: { tripId: string }) => <div data-testid="cost-overview" data-trip-id={tripId} />,
}));

// The shell is an async RSC, so vitest renders it only through the awaited element above - a
// source-text guard is the only mechanical check available for "no hex literal remains in the page
// component". It previously painted itself #2f343d, the same non-token dark slate Story 7.9 removed
// from the two map pages, inverting the app's value scheme on the way into this screen.
// Comments are stripped first so an issue reference like `// see #1234` cannot fail the guard, and
// named colours plus every colour function notation are matched so the literal cannot come back in
// another spelling. It cannot see a colour lifted into a constant in another file, nor a hex sitting
// after a `//` inside a string literal on the same line (`stripComments` truncates there).
// `__dirname`, not `process.cwd()`, so the path holds however vitest was invoked.
const HARDCODED_COLOUR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|["'](?:white|black|whitesmoke|gainsboro|silver|gr[ae]y|ivory|snow)["']/;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("trip cost overview page shell", () => {
  it("carries no hardcoded colour", () => {
    const source = readFileSync(resolve(__dirname, "..", "src/app/(routes)/trips/[id]/costs/page.tsx"), "utf8");
    expect(stripComments(source)).not.toMatch(HARDCODED_COLOUR);
  });
});

describe("Trip cost overview page", () => {
  it("renders the back button and cost overview for the trip", async () => {
    const element = await TripCostOverviewPage({
      params: Promise.resolve({ id: "trip-1" }),
    });

    render(element as ReactNode);

    expect(screen.getByTestId("cost-overview-back")).toHaveAttribute("data-href", "/trips/trip-1");
    expect(screen.getByTestId("cost-overview-back")).toHaveAttribute("data-label", "trips.costOverview.back");
    expect(screen.getByTestId("cost-overview")).toHaveAttribute("data-trip-id", "trip-1");
  });
});
