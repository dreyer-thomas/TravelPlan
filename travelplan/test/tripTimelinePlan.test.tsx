// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import theme from "@/theme";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

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
  default: ({ expandHref }: { expandHref?: string }) => (
    <div data-testid="overview-map-panel">
      {expandHref ? (
        <a href={expandHref} data-testid="overview-map-expand-link">
          Expand map
        </a>
      ) : null}
    </div>
  ),
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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Planned 0m, Unplanned 24h")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("links the planned total to the cost overview page", async () => {
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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const costLink = screen.getByRole("link", { name: "Open cost overview" });
    expect(costLink).toHaveAttribute("href", "/trips/trip-1/costs");
    expect(within(costLink).getByText("€99.00")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("passes the full-page map route to the overview map panel", async () => {
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
              missingAccommodation: false,
              missingPlan: false,
              accommodation: {
                id: "stay-1",
                name: "Harbor Hotel",
                notes: null,
                status: "booked",
                costCents: null,
                link: null,
                checkInTime: null,
                checkOutTime: null,
                location: { lat: 53.55, lng: 10, label: "Hamburg" },
              },
              dayPlanItems: [],
              travelSegments: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("overview-map-expand-link")).toHaveAttribute("href", "/trips/trip-1/map");

    vi.unstubAllGlobals();
  });

  it("renders raw per-kind segments plus a synthesized gap segment for the mini coverage bar", async () => {
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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const dayCards = screen.getAllByTestId("timeline-day-card");
    const dayTwoCard = dayCards.find((card) => within(card).queryAllByText("Day 2").length > 0);
    expect(dayTwoCard).toBeTruthy();
    const segments = within(dayTwoCard as HTMLElement).getAllByTestId("trip-day-gantt-segment");
    // Day 2 carries over the previous night's accommodation (checkout 10:00), has its own
    // Museum plan item (09:00-11:00, overlapping the carried-over stay), and the remaining
    // uncovered time renders as a synthesized "gap" segment - three raw, unmerged segments.
    const kinds = segments.map((segment) => segment.getAttribute("data-kind"));
    expect(kinds).toEqual(expect.arrayContaining(["accommodation", "planItem", "gap"]));
    expect(segments).toHaveLength(3);

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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByTestId("trip-hero")).toHaveStyle({
      backgroundImage: "url(/images/world-map-placeholder.svg)",
    });
    expect(screen.getByTestId("overview-map-panel")).toBeInTheDocument();
    expect(screen.queryByText("Planned total")).toBeNull();
    expect(screen.getByRole("link", { name: "Open cost overview" })).toHaveTextContent("€99.00");
    expect(screen.getByRole("link", { name: /^Open day view: / })).toHaveAttribute("href", "/trips/trip-1/days/day-1");
    expect(screen.getByText("Day 1: Flight from FRA to SIN")).toBeInTheDocument();
    expect(screen.getByTestId("day-row-photo")).toHaveAttribute(
      "src",
      "/uploads/trips/trip-1/days/day-1/day.webp",
    );
    expect(screen.getByTestId("day-row-photo")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("button", { name: "Add plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit plan" })).toBeNull();

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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const dayCards = screen.getAllByTestId("timeline-day-card");
    expect(dayCards).toHaveLength(2);

    // Day 1 has an accommodation on record and is not flagged as a gap.
    expect(within(dayCards[0]).getByTestId("day-row-stay")).toHaveTextContent("Hotel One");
    expect(within(dayCards[0]).queryByTestId("day-row-gap-pill")).toBeNull();

    // Day 2 is flagged missingAccommodation, so it renders the gap pill instead of the
    // (stray) planned accommodation record - the day-row only distinguishes has-a-stay vs. gap.
    expect(within(dayCards[1]).getByTestId("day-row-gap-pill")).toHaveTextContent("No accommodation");
    expect(within(dayCards[1]).queryByTestId("day-row-stay")).toBeNull();

    expect(screen.getAllByText("No accommodation")).toHaveLength(1);

    // AC2's warn treatment: the gap row switches border and background, the non-gap row stays plain.
    // These replace the pre-redesign #e8ecf2/#4a525f assertions rather than dropping the coverage.
    expect(dayCards[0]).toHaveStyle({
      backgroundColor: theme.palette.tokens.card,
      borderColor: theme.palette.tokens.borderStrong,
    });
    expect(dayCards[1]).toHaveStyle({ backgroundColor: "#FBF6EE", borderColor: theme.palette.tokens.warnBorder });

    vi.unstubAllGlobals();
  });

  /**
   * Story 6.29, AC4. This row put the stored value straight into `href`, and the write schema accepted
   * `javascript:` until the same story tightened it, so rows holding one exist and are not migrated. The
   * unsafe value has to take the `<span>` path the no-link case already produces - a third state would be
   * a new empty state to design, and the stay name still has to be readable either way.
   */
  it("renders the overview stay as an anchor only for an http(s) link", async () => {
    const buildResponse = (link: string | null) => ({
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
            missingAccommodation: false,
            missingPlan: false,
            accommodation: {
              id: "stay-1",
              name: "Hotel One",
              notes: null,
              status: "booked",
              costCents: null,
              link,
              location: null,
            },
            dayPlanItems: [],
          },
        ],
      },
      error: null,
    });

    const renderWithLink = async (link: string | null) => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => buildResponse(link),
      })) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);
      const view = renderWithProviders(<TripTimeline tripId="trip-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      return view;
    };

    const safe = await renderWithLink("https://booking.example/stay-1");
    const safeRow = screen.getByTestId("day-row-stay");
    expect(safeRow.tagName.toLowerCase()).toBe("a");
    expect(safeRow).toHaveAttribute("href", "https://booking.example/stay-1");
    expect(safeRow).toHaveAttribute("target", "_blank");
    expect(safeRow).toHaveAttribute("rel", "noreferrer noopener");
    expect(safeRow).toHaveTextContent("Hotel One");
    safe.unmount();
    vi.unstubAllGlobals();

    await renderWithLink("javascript:alert(1)");
    const unsafeRow = screen.getByTestId("day-row-stay");
    expect(unsafeRow.tagName.toLowerCase()).toBe("span");
    expect(unsafeRow).not.toHaveAttribute("href");
    // The name is the whole content of this row; guarding the scheme must not cost the stay its label.
    expect(unsafeRow).toHaveTextContent("Hotel One");
    // Not merely a non-anchor: nothing anywhere on the page may carry the value in an `href`.
    expect(document.querySelector('[href="javascript:alert(1)"]')).toBeNull();

    vi.unstubAllGlobals();
  });

  it("renders the stat strip, cost breakdown and gap-alert card from trip data", async () => {
    const tripDetailResponse = {
      data: {
        trip: {
          id: "trip-1",
          name: "Trip",
          startDate: "2026-12-01T00:00:00.000Z",
          endDate: "2026-12-02T00:00:00.000Z",
          dayCount: 2,
          plannedCostTotal: 25000,
          accommodationCostTotalCents: 10000,
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
              link: null,
              checkInTime: "15:00",
              checkOutTime: "10:00",
              location: { lat: 53.55, lng: 10, label: "Hamburg" },
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
            accommodation: null,
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

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Stat strip: duration, station count, cost link and open-item count.
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("2 days")).toBeInTheDocument();
    expect(screen.getByText("Stations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open cost overview" })).toHaveTextContent("€250.00");
    const openItemsValue = screen.getByText("Open items").parentElement;
    expect(openItemsValue).toHaveTextContent("1");

    // Cost breakdown: accommodation comes straight from the API, activities are the remainder.
    expect(screen.getByText("Accommodation")).toBeInTheDocument();
    expect(screen.getByText("€100.00")).toBeInTheDocument();
    expect(screen.getByText("Activities & excursions")).toBeInTheDocument();
    expect(screen.getByText("€150.00")).toBeInTheDocument();

    // Gap-alert card names the first gap day, and its body no longer interpolates a place name.
    expect(screen.getByText("Action needed: Day 2")).toBeInTheDocument();
    expect(screen.getByText("No accommodation has been recorded yet for day 2 (Dec 2, 2026).")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("omits the gap-alert card when every day has an accommodation", async () => {
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
            accommodationCostTotalCents: 0,
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
                costCents: 0,
                link: null,
                checkInTime: "15:00",
                checkOutTime: "10:00",
                location: null,
              },
              dayPlanItems: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.queryByText(/Action needed/)).toBeNull();
    expect(screen.getByText("Open items").parentElement).toHaveTextContent("0");

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
    const { rerender } = renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId("timeline-day-card")).toHaveLength(2);
    expect(screen.getByText("Day 1: Arrival")).toBeInTheDocument();
    expect(screen.getByText("Day 2: City walk")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Open day view: / })).toHaveLength(2);
    expect(screen.getAllByTestId("trip-day-gantt-bar")).toHaveLength(2);
    expect(screen.getAllByTestId("timeline-day-card")[0]).toHaveAttribute("data-layout", "stacked");

    setViewport(1280);
    rerender(<Providers><TripTimeline tripId="trip-1" /></Providers>);

    expect(screen.getAllByTestId("timeline-day-card")).toHaveLength(2);
    expect(screen.getByText("Day 1: Arrival")).toBeInTheDocument();
    expect(screen.getByText("Day 2: City walk")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Open day view: / })).toHaveLength(2);
    expect(screen.getAllByText("Missing plan")).toHaveLength(1);
    expect(screen.getAllByTestId("trip-day-gantt-bar")).toHaveLength(2);
    expect(screen.getAllByTestId("timeline-day-card")[0]).toHaveAttribute("data-layout", "inline");

    vi.unstubAllGlobals();
  });
});
