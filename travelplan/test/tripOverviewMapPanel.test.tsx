// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import { I18nProvider } from "@/i18n/provider";
import type { ReactNode } from "react";

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
    render(
      <I18nProvider initialLanguage="en">
        <TripOverviewMapPanel
          points={[
            { id: "p1", label: "Hotel", position: [48.1372, 11.5756] },
            { id: "p2", label: "Museum", position: [48.145, 11.582] },
          ]}
          missingLocations={[{ id: "m1", label: "Unlocated activity", href: "/trips/trip-1/days/day-1?open=plan&itemId=m1" }]}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Trip overview map")).toBeInTheDocument();
    expect(screen.getByText("Missing locations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unlocated activity" })).toHaveAttribute(
      "href",
      "/trips/trip-1/days/day-1?open=plan&itemId=m1",
    );
  });
});
