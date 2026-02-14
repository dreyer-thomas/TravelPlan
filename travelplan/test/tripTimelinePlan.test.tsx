// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { I18nProvider } from "@/i18n/provider";

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripEditDialog", () => ({
  default: () => <div data-testid="edit-dialog" />,
}));

vi.mock("@/components/features/trips/TripDeleteDialog", () => ({
  default: () => <div data-testid="delete-dialog" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("TripTimeline plan action", () => {
  it("does not render per-day action buttons in the overview", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            startDate: "2026-12-01T00:00:00.000Z",
            endDate: "2026-12-01T00:00:00.000Z",
            dayCount: 1,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              missingAccommodation: true,
              missingPlan: true,
              accommodation: null,
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("img", { name: /trip/i })).toHaveAttribute("src", "/images/world-map-placeholder.svg");
    expect(screen.getByRole("link", { name: "Open day view" })).toHaveAttribute("href", "/trips/trip-1/days/day-1");
    expect(screen.queryByRole("button", { name: "Add plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit plan" })).toBeNull();

    vi.unstubAllGlobals();
  });
});
