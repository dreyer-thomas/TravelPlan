// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import TripCostOverviewPage from "@/app/(routes)/trips/[id]/costs/page";

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
