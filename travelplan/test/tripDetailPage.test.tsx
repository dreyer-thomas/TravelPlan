// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import TripDetailPage from "@/app/(routes)/trips/[id]/page";

vi.mock("@/components/features/trips/TripTimeline", () => ({
  default: ({ tripId }: { tripId: string }) => <div data-testid="trip-timeline" data-trip-id={tripId} />,
}));

/**
 * Story 6.20, AC1. The page used to open with a `← Zurück zu Reisen` breadcrumb above the timeline;
 * that way back is a row of the global `HeaderMenu` now, so the trip is the page's first block.
 */
describe("Trip detail page", () => {
  it("renders the timeline for the trip and nothing above it", async () => {
    const element = await TripDetailPage({ params: Promise.resolve({ id: "trip-1" }) });

    const { container } = render(element as ReactNode);

    expect(screen.getByTestId("trip-timeline")).toHaveAttribute("data-trip-id", "trip-1");

    // "First block" asserted as first *element child of the content column*, not as a count of the
    // mock: counting it would stay green if a heading or a breadcrumb reappeared above the timeline,
    // which is exactly what AC1 forbids and exactly what the deleted markup was.
    const content = container.querySelector(".MuiContainer-root");

    expect(content).not.toBeNull();
    expect(content?.children).toHaveLength(1);
    expect(content?.firstElementChild).toHaveAttribute("data-testid", "trip-timeline");
  });

  it("renders no link back to the trips list", async () => {
    const element = await TripDetailPage({ params: Promise.resolve({ id: "trip-1" }) });

    const { container } = render(element as ReactNode);

    expect(container.querySelector("a[href='/trips']")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  /**
   * AC7. The removed markup was a `<Link>` wrapping a `<Button>`, so both a link and a button are
   * gone from the page shell - it renders no interactive element of its own at all now.
   */
  it("renders no control of its own", async () => {
    const element = await TripDetailPage({ params: Promise.resolve({ id: "trip-1" }) });

    const { container } = render(element as ReactNode);

    expect(container.querySelectorAll("a, button")).toHaveLength(0);
  });
});
