// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripDayMapFullPage from "@/components/features/trips/TripDayMapFullPage";
import { renderWithProviders } from "./helpers/renderWithProviders";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// The page shell is an async RSC, so vitest cannot render it. A source-text guard is the only
// mechanical check available for "no hardcoded hex value remains in either page component"; the
// shell previously painted itself #2f343d, inverting the app's value scheme on the way in.
// Comments are stripped first so an issue reference like `// see #1234` cannot fail the guard, and
// rgb()/hsl() are matched too so the literal cannot simply come back in another notation.
const HARDCODED_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("day map page shell", () => {
  it("carries no hardcoded colour", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx"),
      "utf8",
    );
    expect(stripComments(source)).not.toMatch(HARDCODED_COLOUR);
  });
});

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

    renderWithProviders(<TripDayMapFullPage tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByTestId("day-map-container")).toBeInTheDocument();
    // The card label is this screen's only heading, and the custom labelCaps variant has no
    // variantMapping entry - drop `component=` and it silently degrades to a <span>.
    expect(screen.getByRole("heading", { name: "Day map" })).toBeInTheDocument();
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

    renderWithProviders(<TripDayMapFullPage tripId="trip-1" dayId="day-1" />);

    const markers = await screen.findAllByTestId("day-map-marker");
    await user.click(markers[0]);
    expect(await screen.findByText("Plan details")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Morning walk 1" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
