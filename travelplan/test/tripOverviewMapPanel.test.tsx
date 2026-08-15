// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import type { TripOverviewMapPoint } from "@/components/features/trips/TripOverviewMapData";
import type { ReactNode } from "react";
import en from "@/i18n/en";
import { formatMessage } from "@/i18n";
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

  // DW-15. The caption is the panel's accessibility floor, not decoration: the marker count is the
  // one fact the map carries that nothing else on the panel states in text.
  it("pairs the preview with a text caption linking to the full map", () => {
    renderWithProviders(
      <TripOverviewMapPanel
        points={[
          overviewPoint({ id: "p1", label: "Hotel", kind: "accommodation" }),
          overviewPoint({ id: "p2", label: "Museum" }),
          overviewPoint({ id: "p3", label: "Park" }),
          overviewPoint({ id: "p4", label: "Bridge" }),
          overviewPoint({ id: "p5", label: "Market" }),
        ]}
        missingLocations={[]}
        expandHref="/trips/trip-1/map"
      />,
    );

    const caption = screen.getByTestId("trip-overview-map-caption");
    // Composed from the dictionary rather than hardcoded, so a wording change moves one string and a
    // *placeholder* change - the failure mode this guards - still fails here.
    expect(caption).toHaveTextContent(formatMessage(en["trips.overviewMap.mapCaption"], { count: 5 }));
    expect(caption.textContent).not.toContain("{count}");
    expect(caption).toHaveAttribute("href", "/trips/trip-1/map");
  });

  it("uses the singular caption for a single stop", () => {
    renderWithProviders(
      <TripOverviewMapPanel
        points={[overviewPoint({ id: "p1", label: "Hotel", kind: "accommodation" })]}
        missingLocations={[]}
        expandHref="/trips/trip-1/map"
      />,
    );

    // formatMessage is plain {key} substitution with no plural handling, so the singular needs its
    // own key rather than rendering "1 stops".
    const caption = screen.getByTestId("trip-overview-map-caption");
    expect(caption).toHaveTextContent(en["trips.overviewMap.mapCaptionOne"]);
    expect(caption.textContent).not.toContain("{count}");
  });

  it("omits the caption entirely when there is nothing to map", () => {
    renderWithProviders(<TripOverviewMapPanel points={[]} missingLocations={[]} expandHref="/trips/trip-1/map" />);

    // "0 stops · open the full map", linking to a map with nothing on it, is worse than no caption -
    // the empty-state placeholder already says what is going on.
    expect(screen.getByText(en["trips.overviewMap.emptyTitle"])).toBeInTheDocument();
    expect(screen.queryByTestId("trip-overview-map-caption")).not.toBeInTheDocument();
  });

  it("omits the caption when there is no full map to link to", () => {
    renderWithProviders(
      <TripOverviewMapPanel
        points={[
          overviewPoint({ id: "p1", label: "Hotel", kind: "accommodation" }),
          overviewPoint({ id: "p2", label: "Museum" }),
          overviewPoint({ id: "p3", label: "Park" }),
        ]}
        missingLocations={[]}
      />,
    );

    // The caption is a link and nothing else; with no `expandHref` there is no destination, and a
    // count rendered as dead text would be a different component.
    expect(screen.queryByTestId("trip-overview-map-caption")).not.toBeInTheDocument();
  });

  // DW-56: the parent raises an error alert of its own, so a "no mapped places yet" panel underneath
  // it would be a second, contradicting answer to the same question.
  it("suppresses the empty state when the load failed", () => {
    renderWithProviders(<TripOverviewMapPanel points={[]} missingLocations={[]} loadError />);

    expect(screen.queryByText(en["trips.overviewMap.emptyTitle"])).not.toBeInTheDocument();
    expect(screen.queryByText(en["trips.overviewMap.emptyBody"])).not.toBeInTheDocument();
    // The card itself stays - only the contradicting placeholder goes.
    expect(screen.getByText(en["trips.overviewMap.title"])).toBeInTheDocument();
  });
});
