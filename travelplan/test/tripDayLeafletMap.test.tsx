// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripDayLeafletMap from "@/components/features/trips/TripDayLeafletMap";
import type { ReactNode } from "react";

const TEST_POINTS = [
  { id: "point-1", label: "Point 1", kind: "planItem", position: [40.7, -73.9], order: 0 },
  { id: "point-2", label: "Point 2", kind: "planItem", position: [40.71, -73.98], order: 1 },
];

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="leaflet-map" style={style}>
      {children}
    </div>
  ),
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: ({ children }: { children?: ReactNode }) => <div data-testid="day-map-marker">{children}</div>,
  Polyline: () => <div data-testid="day-map-polyline" />,
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

describe("TripDayLeafletMap", () => {
  it("uses the larger day-map height for the map container", () => {
    render(<TripDayLeafletMap points={TEST_POINTS} />);

    expect(screen.getByTestId("leaflet-map")).toHaveStyle({ height: "clamp(240px, 35vh, 360px)" });
  });
});
