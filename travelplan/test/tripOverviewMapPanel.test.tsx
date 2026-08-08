// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import type { TripOverviewMapPoint } from "@/components/features/trips/TripOverviewMapData";
import type { ReactNode } from "react";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Builds a complete `TripOverviewMapPoint` from just the fields a case cares about, so the required
 * `kind`/`dayId`/`href`/`order` do not have to be repeated at every call site.
 *
 * The defaults are deliberately inert placeholders and not a copy of what `buildTripOverviewMapData`
 * would emit: `TripOverviewMapPanel` hands `points` straight to the mocked `react-leaflet` child and
 * reads none of these four fields, so mirroring the producer's `href` construction here would be a
 * second implementation that nothing compares against - free to drift the moment the real one changes.
 * A case that asserts on one of these fields should pass it explicitly.
 */
const overviewPoint = (
  overrides: Partial<TripOverviewMapPoint> & Pick<TripOverviewMapPoint, "id" | "label">,
): TripOverviewMapPoint => ({
  kind: "planItem",
  position: [48.1372, 11.5756],
  dayId: "day-1",
  href: "/trips/trip-1",
  order: 0,
  ...overrides,
});

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="overview-map-container">{children}</div>,
  TileLayer: () => <div data-testid="overview-map-tile" />,
  Marker: () => <div data-testid="overview-map-marker" />,
  useMap: () => ({ fitBounds: vi.fn(), invalidateSize: vi.fn(), getContainer: vi.fn(() => document.createElement("div")) }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
    divIcon: (options: unknown) => options,
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
  divIcon: (options: unknown) => options,
}));

describe("TripOverviewMapPanel", () => {
  it("renders map markers and missing-location items", () => {
    renderWithProviders(
      <TripOverviewMapPanel
        points={[
          overviewPoint({ id: "p1", label: "Hotel", kind: "accommodation", position: [48.1372, 11.5756], order: 0 }),
          overviewPoint({ id: "p2", label: "Museum", dayId: "day-2", position: [48.145, 11.582], order: 1 }),
        ]}
        missingLocations={[
          {
            id: "m1",
            kind: "planItem",
            label: "Unlocated activity",
            href: "/trips/trip-1/days/day-1?open=plan&itemId=m1",
          },
        ]}
      />,
    );

    expect(screen.getByText("Route")).toBeInTheDocument();
    expect(screen.getByText("Missing locations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unlocated activity" })).toHaveAttribute(
      "href",
      "/trips/trip-1/days/day-1?open=plan&itemId=m1",
    );
  });

  it("renders an icon-only expand control that links to the full-page trip map", () => {
    renderWithProviders(
      <TripOverviewMapPanel
        points={[overviewPoint({ id: "p1", label: "Hotel", kind: "accommodation", position: [48.1372, 11.5756] })]}
        missingLocations={[]}
        expandHref="/trips/trip-1/map"
      />,
    );

    expect(screen.getByRole("link", { name: "Expand map" })).toHaveAttribute("href", "/trips/trip-1/map");
  });
});
