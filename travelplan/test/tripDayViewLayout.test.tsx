// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import { I18nProvider } from "@/i18n/provider";
import type { ReactNode } from "react";

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: () => <div data-testid="plan-dialog" />,
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="day-map-container">{children}</div>,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: ({ children }: { children?: ReactNode }) => <div data-testid="day-map-marker">{children}</div>,
  Polyline: () => <div data-testid="day-map-polyline" />,
  useMap: () => ({ fitBounds: vi.fn() }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
}));

describe("TripDayView layout", () => {
  it("renders the day view page layout for a selected day", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              items: [
                {
                  id: "plan-1",
                  tripDayId: "day-1",
                  contentJson: JSON.stringify({
                    type: "doc",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
                  }),
                  linkUrl: "https://example.com/museum",
                  location: { lat: 48.1372, lng: 11.5756 },
                  createdAt: "2026-12-01T09:00:00.000Z",
                },
              ],
            },
            error: null,
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-02T00:00:00.000Z",
              dayCount: 2,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 12000,
                  link: null,
                  location: { lat: 48.3538, lng: 11.7861 },
                },
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 16000,
                  link: null,
                  location: { lat: 48.145, lng: 11.582 },
                },
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayView tripId="trip-1" dayId="day-1" />
      </I18nProvider>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(await screen.findByTestId("trip-day-view-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("Dec 1, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to trip" })).toBeInTheDocument();
    expect(screen.getByText("Previous night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("Airport Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("Day activities")).toBeInTheDocument();
    expect(screen.getAllByText("Museum visit").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://example.com/museum");
    expect(screen.getByText("Current night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("City Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("Day total")).toBeInTheDocument();
    expect(screen.getByText("Cost: 280.00")).toBeInTheDocument();
    expect(screen.getAllByTestId("day-map-marker")).toHaveLength(3);
    expect(screen.getByTestId("day-map-polyline")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
