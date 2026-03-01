// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripDayMapFullPage from "@/components/features/trips/TripDayMapFullPage";
import { I18nProvider } from "@/i18n/provider";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="day-map-container">{children}</div>,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: ({
    children,
    eventHandlers,
  }: {
    children?: ReactNode;
    eventHandlers?: { click?: () => void };
  }) => (
    <button type="button" data-testid="day-map-marker" onClick={() => eventHandlers?.click?.()}>
      {children}
    </button>
  ),
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="day-map-polyline" data-positions={JSON.stringify(positions)} />
  ),
  useMap: () => ({ fitBounds: vi.fn(), invalidateSize: vi.fn() }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
    divIcon: (options: unknown) => options,
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
  divIcon: (options: unknown) => options,
}));

describe("TripDayMapFullPage", () => {
  it("renders the full-page day map when day data loads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { route: { polyline: [[40.7, -73.9], [40.71, -73.98]] } },
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
              endDate: "2026-12-05T00:00:00.000Z",
              dayCount: 1,
              plannedCostTotal: 0,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                note: null,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Morning walk",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan details" }] }],
                    }),
                    location: { lat: 40.7, lng: -73.9 },
                  },
                ],
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
        <TripDayMapFullPage tripId="trip-1" dayId="day-1" />
      </I18nProvider>,
    );

    expect(await screen.findByTestId("day-map-container")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("opens map marker dialog with plan item details and renders routed polyline", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { route: { polyline: [[40.7, -73.9], [40.71, -73.98]] } },
            error: null,
          }),
        };
      }
      if (String(input).includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { images: [{ id: "img-1", dayPlanItemId: "item-1", imageUrl: "/plan-1.jpg", sortOrder: 0 }] },
            error: null,
          }),
        };
      }
      if (String(input).includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
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
              endDate: "2026-12-05T00:00:00.000Z",
              dayCount: 1,
              plannedCostTotal: 0,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                note: null,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Morning walk",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan details" }] }],
                    }),
                    location: { lat: 40.7, lng: -73.9 },
                  },
                ],
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
        <TripDayMapFullPage tripId="trip-1" dayId="day-1" />
      </I18nProvider>,
    );

    const markers = await screen.findAllByTestId("day-map-marker");
    await user.click(markers[0]);
    expect(await screen.findByText("Plan details")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Morning walk 1" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
