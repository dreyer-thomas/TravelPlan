// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripOverviewMapFullPage from "@/components/features/trips/TripOverviewMapFullPage";
import { I18nProvider } from "@/i18n/provider";

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

    render(
      <I18nProvider initialLanguage="en">
        <TripOverviewMapFullPage tripId="trip-1" />
      </I18nProvider>,
    );

    expect(await screen.findByTestId("trip-map-container")).toBeInTheDocument();
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

    render(
      <I18nProvider initialLanguage="en">
        <TripOverviewMapFullPage tripId="trip-1" />
      </I18nProvider>,
    );

    expect(await screen.findByText("Missing locations")).toBeInTheDocument();
    expect(screen.getByText("Unmapped museum")).toBeInTheDocument();
    expect(screen.queryByTestId("trip-map-container")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
