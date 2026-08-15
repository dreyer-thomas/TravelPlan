// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripOverviewMapFullPage from "@/components/features/trips/TripOverviewMapFullPage";
import en from "@/i18n/en";
import { renderWithProviders } from "./helpers/renderWithProviders";
import { expectNoHardcodedColour } from "./helpers/hardcodedColour";
import { expectNoFullViewportFloor } from "./helpers/fullViewportFloor";
import { mockFetchResponse, stubFetch } from "./helpers/mockFetch";

vi.mock("next/dynamic", () => ({
  default: () =>
    ({
      points,
      polylinePositions,
      onMarkerClick,
    }: {
      points: { id: string; position: [number, number] }[];
      polylinePositions?: [number, number][];
      onMarkerClick?: (point: { id: string }) => void;
    }) => (
      <div data-testid="trip-map-container">
        {points.map((point, index) => (
          <button key={point.id} type="button" data-testid={`trip-map-marker-${index}`} onClick={() => onMarkerClick?.(point)} />
        ))}
        <div data-testid="trip-map-polyline" data-positions={JSON.stringify(polylinePositions ?? [])} />
      </div>
    ),
}));

// This trip-overview shell previously painted itself #2f343d, inverting the app's value scheme on the
// way in. The day-map shell made the same mistake and is guarded separately in
// `tripDayMapFullPage.test.tsx`; each call reads exactly the one file named.
describe("trip map page shell", () => {
  it("carries no hardcoded colour", () => {
    expectNoHardcodedColour("src/app/(routes)/trips/[id]/map/page.tsx");
  });

  // DW-59, and a source scan for the same reason the colour guard is one: vitest never renders this
  // async RSC shell. `minHeight: "100vh"` on the Box under the 73px AppHeader is what made the
  // document 100vh + header and the screen scroll by exactly that much - unfixable from
  // `FULL_PAGE_MAP_HEIGHT`, and an obvious-looking thing for a later change to put back.
  it("puts no full-viewport floor under the app header", () => {
    expectNoFullViewportFloor("src/app/(routes)/trips/[id]/map/page.tsx");
  });
});

describe("TripOverviewMapFullPage", () => {
  it("renders canonical trip markers, a chronological polyline, and popup details for stays and plan items", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Northern Route",
            startDate: "2026-06-01T00:00:00.000Z",
            endDate: "2026-06-03T00:00:00.000Z",
            dayCount: 3,
            plannedCostTotal: 0,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-2",
              date: "2026-06-02T00:00:00.000Z",
              dayIndex: 2,
              accommodation: {
                id: "stay-2",
                name: "Harbor Hotel",
                notes: "Late check-in",
                location: { lat: 53.55, lng: 10, label: "Hamburg" },
              },
              dayPlanItems: [],
            },
            {
              id: "day-1",
              date: "2026-06-01T00:00:00.000Z",
              dayIndex: 1,
              accommodation: {
                id: "stay-1",
                name: "Harbor Hotel",
                notes: "Check-in note",
                location: { lat: 53.55, lng: 10, label: "Hamburg" },
              },
              dayPlanItems: [
                {
                  id: "item-1",
                  title: "Museum",
                  contentJson: JSON.stringify({
                    type: "doc",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Museum details" }] }],
                  }),
                  location: { lat: 53.551, lng: 9.99, label: "Museum" },
                },
              ],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripOverviewMapFullPage tripId="trip-1" />);

    expect(await screen.findByTestId("trip-map-container")).toBeInTheDocument();
    // AC3: the card label renders the same string as the preview panel it enlarges, as a real
    // heading (the custom labelCaps variant degrades to a <span> without `component=`). The trip
    // name survives as a subline; the retired "Full trip map" title does not. Asserted as
    // heading-role vs. plain text so the "Route" / "Northern Route" fixture cannot satisfy both.
    expect(screen.getByRole("heading", { name: "Route" })).toBeInTheDocument();
    expect(screen.getByText("Northern Route")).toBeInTheDocument();
    expect(screen.queryByText("Full trip map")).not.toBeInTheDocument();
    expect(screen.getByTestId("trip-map-polyline")).toHaveAttribute(
      "data-positions",
      JSON.stringify([
        [53.551, 9.99],
        [53.55, 10],
      ]),
    );

    const markers = screen.getAllByRole("button");
    await user.click(markers[0]);
    expect(await screen.findByText("Museum details")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open details" })).toHaveAttribute(
      "href",
      "/trips/trip-1/days/day-1?open=plan&itemId=item-1",
    );

    await user.click(markers[1]);
    expect(await screen.findByText("Check-in note")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open details" })).toHaveAttribute("href", "/trips/trip-1/days/day-1?open=stay");

    /*
      Story 6.25 AC1, added by that story's code review — see the matching note in
      `tripDayMapFullPage.test.tsx`. This is one of the four read-only popups that had no visible
      dismissal at all before 6.25, and the story's claim that the glyph was unit-covered did not hold
      for any of them.
    */
    const closeButton = screen.getByTestId("dialog-close");
    expect(closeButton).toHaveAccessibleName("Close");

    await user.click(closeButton);
    expect(screen.queryByText("Check-in note")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("keeps missing-location items visible while excluding them from the map", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Northern Route",
            startDate: "2026-06-01T00:00:00.000Z",
            endDate: "2026-06-01T00:00:00.000Z",
            dayCount: 1,
            plannedCostTotal: 0,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-06-01T00:00:00.000Z",
              dayIndex: 1,
              accommodation: null,
              dayPlanItems: [
                {
                  id: "item-1",
                  title: "Unmapped museum",
                  contentJson: JSON.stringify({
                    type: "doc",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Museum details" }] }],
                  }),
                  location: null,
                },
              ],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripOverviewMapFullPage tripId="trip-1" />);

    expect(await screen.findByText("Missing locations")).toBeInTheDocument();
    expect(screen.getByText("Unmapped museum")).toBeInTheDocument();
    expect(screen.queryByTestId("trip-map-container")).not.toBeInTheDocument();
    // Matching the preview panel: missing-location labels link to the day that owns them.
    expect(screen.getByRole("link", { name: "Unmapped museum" })).toHaveAttribute(
      "href",
      "/trips/trip-1/days/day-1?open=plan&itemId=item-1",
    );

    vi.unstubAllGlobals();
  });

  // DW-56. A failed load leaves `mapData.points` empty for the same reason a trip with nothing mapped
  // does, and the screen used to answer both with the placeholder - so the alert said "we could not
  // load this" while the panel under it said "there is nothing here", and only one of them was true.
  it("shows only the error alert when the trip fails to load", async () => {
    stubFetch(
      vi.fn(async () =>
        mockFetchResponse({ data: null, error: { code: "server_error", message: "boom" } }, { status: 500 }),
      ),
    );

    renderWithProviders(<TripOverviewMapFullPage tripId="trip-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(en["trips.dayView.loadError"]);
    expect(screen.queryByText(en["trips.overviewMap.emptyTitle"])).not.toBeInTheDocument();
    expect(screen.queryByText(en["trips.overviewMap.emptyBody"])).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
