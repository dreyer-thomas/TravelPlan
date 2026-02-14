// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripDayMapPanel, { buildDayMapPanelData } from "@/components/features/trips/TripDayMapPanel";
import { I18nProvider } from "@/i18n/provider";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="day-map-container">{children}</div>,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: ({ position, children, ...rest }: { position: [number, number]; children?: React.ReactNode }) => (
    <div data-testid={rest["data-testid"] ?? "day-map-marker"} data-position={position.join(",")}>
      {children}
    </div>
  ),
  Polyline: ({ positions, ...rest }: { positions: [number, number][] }) => (
    <div data-testid={rest["data-testid"] ?? "day-map-polyline"} data-positions={JSON.stringify(positions)} />
  ),
  useMap: () => ({ fitBounds: vi.fn() }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
}));

describe("TripDayMapPanel", () => {
  it("renders ordered pins with a connecting polyline", () => {
    const { points, missingLocations } = buildDayMapPanelData({
      previousStay: {
        id: "stay-prev",
        label: "Previous Stay",
        kind: "previousStay",
        location: { lat: 40.7, lng: -73.9 },
      },
      planItems: [
        {
          id: "plan-1",
          label: "Museum",
          kind: "planItem",
          location: { lat: 40.71, lng: -73.98 },
        },
        {
          id: "plan-2",
          label: "Lunch",
          kind: "planItem",
          location: { lat: 40.72, lng: -73.97 },
        },
      ],
      currentStay: {
        id: "stay-next",
        label: "Current Stay",
        kind: "currentStay",
        location: { lat: 40.73, lng: -73.96 },
      },
    });

    render(
      <I18nProvider initialLanguage="en">
        <TripDayMapPanel points={points} missingLocations={missingLocations} loading={false} />
      </I18nProvider>
    );

    const markers = screen.getAllByTestId(/day-map-marker-/);
    expect(markers).toHaveLength(4);
    expect(markers.map((marker) => marker.getAttribute("data-position"))).toEqual([
      "40.7,-73.9",
      "40.71,-73.98",
      "40.72,-73.97",
      "40.73,-73.96",
    ]);

    const polyline = screen.getByTestId("day-map-polyline");
    expect(polyline).toHaveAttribute(
      "data-positions",
      JSON.stringify([
        [40.7, -73.9],
        [40.71, -73.98],
        [40.72, -73.97],
        [40.73, -73.96],
      ])
    );
  });

  it("shows empty state and missing-location list when no pins are available", () => {
    const { points, missingLocations } = buildDayMapPanelData({
      previousStay: {
        id: "stay-prev",
        label: "Previous Stay",
        kind: "previousStay",
        location: null,
      },
      planItems: [
        {
          id: "plan-1",
          label: "Museum",
          kind: "planItem",
          location: null,
        },
      ],
      currentStay: {
        id: "stay-next",
        label: "Current Stay",
        kind: "currentStay",
        location: null,
      },
    });

    render(
      <I18nProvider initialLanguage="en">
        <TripDayMapPanel points={points} missingLocations={missingLocations} loading={false} />
      </I18nProvider>
    );

    expect(screen.getByText("No locations to map yet")).toBeInTheDocument();
    expect(screen.getByText("Previous Stay")).toBeInTheDocument();
    expect(screen.getByText("Museum")).toBeInTheDocument();
    expect(screen.getByText("Current Stay")).toBeInTheDocument();
  });
});
