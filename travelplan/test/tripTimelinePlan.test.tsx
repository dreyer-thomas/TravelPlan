// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { I18nProvider } from "@/i18n/provider";

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripEditDialog", () => ({
  default: () => <div data-testid="edit-dialog" />,
}));

vi.mock("@/components/features/trips/TripDeleteDialog", () => ({
  default: () => <div data-testid="delete-dialog" />,
}));

vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({
  default: () => <div data-testid="overview-map-panel" />,
}));

vi.mock("@/components/features/trips/TripBucketListPanel", () => ({
  default: () => <div data-testid="bucket-list-panel" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("TripTimeline plan action", () => {
  const setMatchMedia = (width: number) => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => {
        const maxWidthMatch = /max-width:\s*(\d+(\.\d+)?)px/.exec(query);
        const minWidthMatch = /min-width:\s*(\d+(\.\d+)?)px/.exec(query);
        const maxWidth = maxWidthMatch ? Number(maxWidthMatch[1]) : Infinity;
        const minWidth = minWidthMatch ? Number(minWidthMatch[1]) : 0;
        const matches = width >= minWidth && width <= maxWidth;
        return {
          matches,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        };
      },
    });
  };

  it("renders a compact gantt bar for each day card", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            startDate: "2026-12-01T00:00:00.000Z",
            endDate: "2026-12-02T00:00:00.000Z",
            dayCount: 2,
            plannedCostTotal: 0,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              imageUrl: null,
              note: null,
              missingAccommodation: true,
              missingPlan: true,
              accommodation: null,
              dayPlanItems: [],
              travelSegments: [],
            },
            {
              id: "day-2",
              date: "2026-12-02T00:00:00.000Z",
              dayIndex: 2,
              imageUrl: null,
              note: null,
              missingAccommodation: false,
              missingPlan: false,
              accommodation: null,
              dayPlanItems: [],
              travelSegments: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getAllByTestId("trip-day-gantt-bar")).toHaveLength(2);

    vi.unstubAllGlobals();
  });

  it("renders a planned vs unplanned summary for empty overview gantt bars", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
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
              imageUrl: null,
              note: null,
              missingAccommodation: true,
              missingPlan: true,
              accommodation: null,
              dayPlanItems: [],
              travelSegments: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Planned 0m, Unplanned 24h")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("merges overlapping planned segments into a single overview span", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            startDate: "2026-12-01T00:00:00.000Z",
            endDate: "2026-12-02T00:00:00.000Z",
            dayCount: 2,
            plannedCostTotal: 0,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              imageUrl: null,
              note: null,
              missingAccommodation: false,
              missingPlan: false,
              accommodation: {
                id: "stay-prev",
                name: "Prev Stay",
                notes: null,
                status: "booked",
                costCents: null,
                link: null,
                checkInTime: null,
                checkOutTime: "10:00",
                location: null,
              },
              dayPlanItems: [],
              travelSegments: [],
            },
            {
              id: "day-2",
              date: "2026-12-02T00:00:00.000Z",
              dayIndex: 2,
              imageUrl: null,
              note: null,
              missingAccommodation: false,
              missingPlan: false,
              accommodation: null,
              dayPlanItems: [
                {
                  id: "plan-1",
                  title: "Museum",
                  fromTime: "09:00",
                  toTime: "11:00",
                  contentJson: JSON.stringify({
                    type: "doc",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Visit" }] }],
                  }),
                  costCents: null,
                  linkUrl: null,
                  location: null,
                },
              ],
              travelSegments: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const dayCards = screen.getAllByTestId("timeline-day-card");
    const dayTwoCard = dayCards.find((card) => within(card).queryByText("Day 2"));
    expect(dayTwoCard).toBeTruthy();
    const segments = within(dayTwoCard as HTMLElement).getAllByTestId("trip-day-gantt-segment");
    expect(segments).toHaveLength(1);

    vi.unstubAllGlobals();
  });
  it("does not render per-day action buttons in the overview", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            startDate: "2026-12-01T00:00:00.000Z",
            endDate: "2026-12-01T00:00:00.000Z",
            dayCount: 1,
            plannedCostTotal: 9900,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              imageUrl: "/uploads/trips/trip-1/days/day-1/day.webp",
              note: "Flight from FRA to SIN",
              plannedCostSubtotal: 9900,
              missingAccommodation: true,
              missingPlan: true,
              accommodation: null,
              dayPlanItems: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("img", { name: /trip/i })).toHaveAttribute("src", "/images/world-map-placeholder.svg");
    expect(screen.getByTestId("overview-map-panel")).toBeInTheDocument();
    expect(screen.queryByText("Planned total")).toBeNull();
    expect(screen.getByText("Cost: 99.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open day view" })).toHaveAttribute("href", "/trips/trip-1/days/day-1");
    expect(screen.getByText("Day 1: Flight from FRA to SIN")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Day image" })).toHaveAttribute(
      "src",
      "/uploads/trips/trip-1/days/day-1/day.webp",
    );
    expect(screen.queryByRole("button", { name: "Add plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit plan" })).toBeNull();

    vi.unstubAllGlobals();
  });

  it("shows export action and requests trip export endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-01T00:00:00.000Z",
              dayCount: 1,
              plannedCostTotal: 0,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [],
          },
          error: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => new Blob([JSON.stringify({ trip: { id: "trip-1" }, days: [] })], { type: "application/json" }),
        headers: new Headers({ "content-disposition": 'attachment; filename="trip-trip-2026-12-01.json"' }),
      }) as unknown as typeof fetch;

    const createObjectURL = vi.fn(() => "blob:trip-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1/export", { method: "GET" }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("shows localized export error when download fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-01T00:00:00.000Z",
              dayCount: 1,
              plannedCostTotal: 0,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [],
          },
          error: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(await screen.findByText("Trip export failed. Please try again.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders each day as a card and keeps accommodation surface tied to accommodation data", async () => {
    const tripDetailResponse = {
      data: {
        trip: {
          id: "trip-1",
          name: "Trip",
          startDate: "2026-12-01T00:00:00.000Z",
          endDate: "2026-12-02T00:00:00.000Z",
          dayCount: 2,
          plannedCostTotal: 0,
          accommodationCostTotalCents: null,
          heroImageUrl: null,
        },
        days: [
          {
            id: "day-1",
            date: "2026-12-01T00:00:00.000Z",
            dayIndex: 1,
            imageUrl: null,
            note: null,
            missingAccommodation: false,
            missingPlan: false,
            accommodation: {
              id: "stay-1",
              name: "Hotel One",
              notes: null,
              status: "booked",
              costCents: 10000,
              link: "https://example.com/stay-1",
              location: null,
            },
            dayPlanItems: [],
          },
          {
            id: "day-2",
            date: "2026-12-02T00:00:00.000Z",
            dayIndex: 2,
            imageUrl: null,
            note: null,
            missingAccommodation: true,
            missingPlan: false,
            accommodation: {
              id: "stay-2",
              name: "Hotel Two",
              notes: null,
              status: "planned",
              costCents: null,
              link: null,
              location: null,
            },
            dayPlanItems: [],
          },
        ],
      },
      error: null,
    };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => tripDetailResponse,
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const dayCards = screen.getAllByTestId("timeline-day-card");
    expect(dayCards).toHaveLength(2);
    expect(dayCards[0]).toHaveStyle({ backgroundColor: "#e8ecf2" });
    expect(dayCards[1]).toHaveStyle({ backgroundColor: "#e8ecf2" });

    const accommodationSurfaces = screen.getAllByTestId("timeline-accommodation-surface");
    expect(accommodationSurfaces).toHaveLength(2);
    expect(accommodationSurfaces[0]).toHaveStyle({ backgroundColor: "#4a525f" });
    expect(accommodationSurfaces[1]).toHaveStyle({ backgroundColor: "#4a525f" });

    expect(screen.getAllByText("Missing stay")).toHaveLength(1);

    expect(screen.queryByText(/accommodation/i)).toBeNull();

    vi.unstubAllGlobals();
  });

  it("keeps timeline cards readable when viewport changes between mobile and desktop widths", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            startDate: "2026-12-01T00:00:00.000Z",
            endDate: "2026-12-02T00:00:00.000Z",
            dayCount: 2,
            plannedCostTotal: 0,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              imageUrl: null,
              note: "Arrival",
              missingAccommodation: false,
              missingPlan: false,
              accommodation: null,
              dayPlanItems: [],
            },
            {
              id: "day-2",
              date: "2026-12-02T00:00:00.000Z",
              dayIndex: 2,
              imageUrl: null,
              note: "City walk",
              missingAccommodation: false,
              missingPlan: true,
              accommodation: null,
              dayPlanItems: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    const setViewport = (width: number) => {
      setMatchMedia(width);
      window.innerWidth = width;
      window.dispatchEvent(new Event("resize"));
    };

    setViewport(375);
    const { rerender } = render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId("timeline-day-card")).toHaveLength(2);
    expect(screen.getByText("Day 1: Arrival")).toBeInTheDocument();
    expect(screen.getByText("Day 2: City walk")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open day view" })).toHaveLength(2);
    expect(screen.getAllByTestId("trip-day-gantt-bar")).toHaveLength(2);
    expect(screen.getAllByTestId("timeline-day-card")[0].querySelector('[data-layout="stacked"]')).toBeTruthy();

    setViewport(1280);
    rerender(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    expect(screen.getAllByTestId("timeline-day-card")).toHaveLength(2);
    expect(screen.getByText("Day 1: Arrival")).toBeInTheDocument();
    expect(screen.getByText("Day 2: City walk")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open day view" })).toHaveLength(2);
    expect(screen.getAllByText("Missing plan")).toHaveLength(1);
    expect(screen.getAllByTestId("trip-day-gantt-bar")).toHaveLength(2);
    expect(screen.getAllByTestId("timeline-day-card")[0].querySelector('[data-layout="inline"]')).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
