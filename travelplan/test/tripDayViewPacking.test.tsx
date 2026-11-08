// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 16.2 (AC 1, 3). The real take-along section mounted in the day view's side column, in the order
 * Tommy set on 2026-11-08: map, costs, take along, bucket list. Harness from `tripDayViewEmail.test.tsx`.
 */

// The three authoring dialogs carry the rich-text editor, which does not run in jsdom. None of them is
// under test here; the suggestion dialog is real.
vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({ default: () => null }));
vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({ default: () => null }));
vi.mock("@/components/features/trips/TripDayTravelSegmentDialog", () => ({ default: () => null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="day-map-container" />,
}));

vi.mock("react-leaflet", () => ({
  MapContainer: () => <div data-testid="day-map-container" />,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: () => <div data-testid="day-map-marker" />,
  Polyline: () => <div data-testid="day-map-polyline" />,
  useMap: () => ({
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
    getContainer: vi.fn(() => document.createElement("div")),
  }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
    divIcon: (options: unknown) => options,
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
  divIcon: (options: unknown) => options,
}));

type AccessRole = "owner" | "contributor" | "viewer";

const tripDetail = (accessRole: AccessRole) => ({
  trip: {
    id: "trip-1",
    name: "Trip",
    accessRole,
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-01T00:00:00.000Z",
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
      plannedCostSubtotal: 0,
      missingAccommodation: true,
      missingPlan: true,
      accommodation: null,
      dayPlanItems: [],
      travelSegments: [],
    },
  ],
});

const packingItem = (id: string, name: string, dayIds: string[]) => ({
  id,
  name,
  category: null,
  packed: false,
  dayCount: dayIds.length,
  days: dayIds.map((dayId, index) => ({ id: dayId, dayIndex: index + 1, date: "2026-12-01T00:00:00.000Z" })),
  aiChangedAt: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
});

const stubDay = (accessRole: AccessRole, packingItems: ReturnType<typeof packingItem>[]) => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = requestUrl(input);
    if (url.includes("/packing-items")) return mockFetchResponse({ data: { accessRole, items: packingItems }, error: null });
    if (url.includes("/bucket-list-items")) return mockFetchResponse({ data: { items: [] }, error: null });
    if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf-token" }, error: null });
    if (url.includes("/images")) return mockFetchResponse({ data: { images: [] }, error: null });
    if (url.includes("/documents")) return mockFetchResponse({ data: { documents: [] }, error: null });
    if (url.includes("/route")) {
      return mockFetchResponse({
        data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } },
        error: null,
      });
    }
    return mockFetchResponse({ data: tripDetail(accessRole), error: null });
  });
  stubFetch(fetchMock);
  return fetchMock;
};

const SIDE_CARDS = new Set([
  en["trips.dayView.mapTitle"],
  en["trips.dayView.costCardTitle"],
  en["trips.packingList.dayTitle"],
  en["trips.bucketList.title"],
]);

/** The side column's card titles in document order (other h6s, like the timeline's, left out). */
const sideHeadings = () =>
  screen
    .getAllByRole("heading", { level: 6 })
    .map((heading) => heading.textContent)
    .filter((text): text is string => text !== null && SIDE_CARDS.has(text));

describe("TripDayView: take along (Story 16.2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the owner the section between the costs and the bucket list, after the map", async () => {
    stubDay("owner", [packingItem("p1", "Swimwear", ["day-1"]), packingItem("p2", "Tent", ["day-2"])]);
    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByText("Swimwear")).toBeInTheDocument();
    expect(screen.queryByText("Tent")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(sideHeadings()).toEqual([
        en["trips.dayView.mapTitle"],
        en["trips.dayView.costCardTitle"],
        en["trips.packingList.dayTitle"],
        en["trips.bucketList.title"],
      ]),
    );
    expect(screen.getByRole("button", { name: "Remove Swimwear from this day" })).toBeInTheDocument();
  });

  it("shows a viewer the day's list read-only, after the costs", async () => {
    stubDay("viewer", [packingItem("p1", "Swimwear", ["day-1"])]);
    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByText("Swimwear")).toBeInTheDocument();
    expect(sideHeadings()).toEqual([en["trips.dayView.mapTitle"], en["trips.dayView.costCardTitle"], en["trips.packingList.dayTitle"]]);
    expect(screen.queryByRole("button", { name: en["trips.packingList.dayAddAria"] })).not.toBeInTheDocument();
  });

  it("shows a viewer no section on a day without items", async () => {
    const fetchMock = stubDay("viewer", []);
    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes("/packing-items"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("day-packing-section")).not.toBeInTheDocument();
  });

  it("shows a planner the empty section with its add button", async () => {
    stubDay("contributor", []);
    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("button", { name: en["trips.packingList.dayAddAria"] })).toBeInTheDocument();
    expect(screen.getByTestId("day-packing-section")).toBeInTheDocument();
  });
});
