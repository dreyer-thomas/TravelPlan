// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import TripCostOverview from "@/components/features/trips/TripCostOverview";
import { renderWithProviders } from "./helpers/renderWithProviders";

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripEditDialog", () => ({
  default: () => <div data-testid="edit-dialog" />,
}));

vi.mock("@/components/features/trips/TripDeleteDialog", () => ({
  default: () => <div data-testid="delete-dialog" />,
}));

vi.mock("@/components/features/trips/TripShareDialog", () => ({
  default: () => <div data-testid="share-dialog" />,
}));

vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({
  default: () => <div data-testid="overview-map-panel" />,
}));

vi.mock("@/components/features/trips/TripBucketListPanel", () => ({
  default: () => <div data-testid="bucket-list-panel" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const stubNotFoundResponse = () => {
  const fetchMock = vi.fn(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ data: null, error: { code: "not_found", message: "Trip not found" } }),
  })) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
};

const stubServerErrorResponse = () => {
  const fetchMock = vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ data: null, error: { code: "server_error", message: "Server error" } }),
  })) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
};

/**
 * Story 6.20, AC5. `href="/trips"` had three call sites and only one of them - the trip detail
 * page's breadcrumb - was in scope. These two are the "trip not found" recovery panels: they are
 * shown when the trip could not be loaded at all, and at that moment sending the user hunting
 * through a menu would be poor. They are also why `trips.detail.back` keeps its readers and its "←".
 *
 * Written because a global grep for the href finds all three and the plausible failure of this story
 * is deleting the two that must stay.
 */
describe("trip not found recovery links", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the back-to-trips button on the timeline's not-found panel", async () => {
    const fetchMock = stubNotFoundResponse();

    renderWithProviders(<TripTimeline tripId="missing-trip" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to trips" })).toHaveAttribute("href", "/trips");
  });

  it("keeps the back-to-trips button on the cost overview's not-found panel", async () => {
    const fetchMock = stubNotFoundResponse();

    renderWithProviders(<TripCostOverview tripId="missing-trip" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(await screen.findByText("Trip not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to trips" })).toHaveAttribute("href", "/trips");
  });

  /**
   * The other way the trip detail page can fail: not a 404 but an outright load error, which renders
   * an alert and no trip. That state had no exit of its own - it relied on the page's breadcrumb,
   * which this story removed - so it gets the same recovery button by the same argument as the panels
   * above. Only when there is no trip to show: a transient error over a rendered trip keeps the
   * trip's own chrome and needs no extra button.
   */
  it("offers a way back to trips when the timeline fails to load at all", async () => {
    const fetchMock = stubServerErrorResponse();

    renderWithProviders(<TripTimeline tripId="broken-trip" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "← Back to trips" })).toHaveAttribute("href", "/trips");
  });
});
