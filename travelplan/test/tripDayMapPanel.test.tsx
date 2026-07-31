// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripDayMapPanel, { buildDayMapPanelData } from "@/components/features/trips/TripDayMapPanel";
import type { ReactNode } from "react";
import { Providers } from "./helpers/renderWithProviders";

vi.mock("next/dynamic", () => ({
  default: () =>
    ({
      points,
      polylinePositions,
      onMarkerClick,
    }: {
      points: { id: string; position: [number, number] }[];
      polylinePositions?: [number, number][];
      onMarkerClick?: (id: string) => void;
    }) => (
      <div data-testid="day-map-container">
        {points.map((point, index) => (
          <button
            key={point.id}
            type="button"
            data-testid={`day-map-marker-${index}`}
            data-position={point.position.join(",")}
            onClick={() => onMarkerClick?.(point.id)}
          />
        ))}
        {(polylinePositions ?? points.map((point) => point.position)).length >= 2 ? (
          <div
            data-testid="day-map-polyline"
            data-positions={JSON.stringify(polylinePositions ?? points.map((point) => point.position))}
          />
        ) : null}
      </div>
    ),
}));

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

describe("TripDayMapPanel", () => {
  it("renders an icon-only expand control with tooltip", async () => {
    const user = userEvent.setup();
    const { points, missingLocations } = buildDayMapPanelData({
      previousStay: {
        id: "stay-prev",
        label: "Previous Stay",
        kind: "previousStay",
        location: { lat: 40.7, lng: -73.9 },
      },
    });

    render(
      <Providers>
        <TripDayMapPanel
          points={points}
          missingLocations={missingLocations}
          loading={false}
          expandHref="/trips/trip-1/days/day-1/map"
        />
      </Providers>,
    );

    const expandButton = screen.getByRole("link", { name: "Expand map" });
    expect(expandButton).toBeInTheDocument();

    await user.hover(expandButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Expand map");
  });

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
      <Providers>
        <TripDayMapPanel points={points} missingLocations={missingLocations} loading={false} />
      </Providers>
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
      <Providers>
        <TripDayMapPanel points={points} missingLocations={missingLocations} loading={false} />
      </Providers>
    );

    expect(screen.getByText("No locations to map yet")).toBeInTheDocument();
    expect(screen.getByText("Previous Stay")).toBeInTheDocument();
    expect(screen.getByText("Museum")).toBeInTheDocument();
    expect(screen.getByText("Current Stay")).toBeInTheDocument();
  });

  it("renders routed polyline and shows routing-unavailable state", () => {
    const { points, missingLocations } = buildDayMapPanelData({
      previousStay: {
        id: "stay-prev",
        label: "Previous Stay",
        kind: "previousStay",
        location: { lat: 40.7, lng: -73.9 },
      },
      currentStay: {
        id: "stay-next",
        label: "Current Stay",
        kind: "currentStay",
        location: { lat: 40.73, lng: -73.96 },
      },
    });

    render(
      <Providers>
        <TripDayMapPanel
          points={points}
          missingLocations={missingLocations}
          polylinePositions={[
            [40.7, -73.9],
            [40.71, -73.94],
            [40.73, -73.96],
          ]}
          routingUnavailable
          loading={false}
        />
      </Providers>,
    );

    expect(screen.getByTestId("day-map-polyline")).toHaveAttribute(
      "data-positions",
      JSON.stringify([
        [40.7, -73.9],
        [40.71, -73.94],
        [40.73, -73.96],
      ]),
    );
    expect(screen.getByText("Routing unavailable")).toBeInTheDocument();
    expect(screen.getByText("Showing direct line order. Check your connection and try again.")).toBeInTheDocument();
  });

  it("pairs the preview with a text caption linking to the full map", () => {
    const { points, missingLocations } = buildDayMapPanelData({
      previousStay: { id: "stay-prev", label: "Previous Stay", kind: "previousStay", location: { lat: 40.7, lng: -73.9 } },
      planItems: [{ id: "item-1", label: "Museum", kind: "planItem", location: { lat: 40.75, lng: -73.98 } }],
      currentStay: { id: "stay-cur", label: "Current Stay", kind: "currentStay", location: { lat: 40.8, lng: -73.95 } },
    });

    render(
      <Providers>
        <TripDayMapPanel
          points={points}
          missingLocations={missingLocations}
          loading={false}
          expandHref="/trips/trip-1/days/day-1/map"
        />
      </Providers>,
    );

    // A map is never the sole carrier of information: the station count is available as text, and the
    // caption is a real link to the full map rather than decoration beside the icon button.
    const caption = screen.getByTestId("day-map-caption");
    expect(caption).toHaveTextContent("3 stops · open the full map");
    expect(caption).toHaveAttribute("href", "/trips/trip-1/days/day-1/map");
  });

  it("uses the singular caption for a single stop", () => {
    const { points, missingLocations } = buildDayMapPanelData({
      planItems: [{ id: "item-1", label: "Museum", kind: "planItem", location: { lat: 40.75, lng: -73.98 } }],
    });

    render(
      <Providers>
        <TripDayMapPanel
          points={points}
          missingLocations={missingLocations}
          loading={false}
          expandHref="/trips/trip-1/days/day-1/map"
        />
      </Providers>,
    );

    // formatMessage is plain {key} substitution with no plural handling, so the singular needs its own
    // key rather than rendering "1 stops".
    expect(screen.getByTestId("day-map-caption")).toHaveTextContent("1 stop · open the full map");
  });

  it("omits the caption entirely when there is nothing to map", () => {
    render(
      <Providers>
        <TripDayMapPanel
          points={[]}
          missingLocations={[]}
          loading={false}
          expandHref="/trips/trip-1/days/day-1/map"
        />
      </Providers>,
    );

    // "0 stops · open the full map", linking to a map with nothing on it, is worse than no caption -
    // the empty-state placeholder already says what is going on.
    expect(screen.getByText("No locations to map yet")).toBeInTheDocument();
    expect(screen.queryByTestId("day-map-caption")).not.toBeInTheDocument();
  });
});
