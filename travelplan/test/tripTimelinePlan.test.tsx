// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({
  default: () => <div data-testid="overview-map-panel" />,
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
            plannedCostTotal: 9900,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              imageUrl: "/uploads/trips/trip-1/days/day-1/day.webp",
              note: "Flight from FRA to SIN",
              plannedCostSubtotal: 9900,
              missingAccommodation: true,
              missingPlan: true,
              accommodation: null,
              dayPlanItems: [],
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
    expect(screen.getByTestId("overview-map-panel")).toBeInTheDocument();
    expect(screen.queryByText("Planned total")).toBeNull();
    expect(screen.getByText("Cost: 99.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open day view" })).toHaveAttribute("href", "/trips/trip-1/days/day-1");
    expect(screen.getByText("Day 1: Flight from FRA to SIN")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Day image" })).toHaveAttribute(
      "src",
      "/uploads/trips/trip-1/days/day-1/day.webp",
    );
    expect(screen.queryByRole("button", { name: "Add plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit plan" })).toBeNull();

    vi.unstubAllGlobals();
  });

  it("shows export action and requests trip export endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
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
              plannedCostTotal: 0,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [],
          },
          error: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => new Blob([JSON.stringify({ trip: { id: "trip-1" }, days: [] })], { type: "application/json" }),
        headers: new Headers({ "content-disposition": 'attachment; filename="trip-trip-2026-12-01.json"' }),
      }) as unknown as typeof fetch;

    const createObjectURL = vi.fn(() => "blob:trip-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1/export", { method: "GET" }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("shows localized export error when download fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
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
              plannedCostTotal: 0,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [],
          },
          error: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(await screen.findByText("Trip export failed. Please try again.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
