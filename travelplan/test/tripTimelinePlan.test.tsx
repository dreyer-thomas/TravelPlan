// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      // `configurable` so the property can be taken back off again - without it the `afterEach`
      // below cannot delete it, and neither can vitest's own environment teardown.
      configurable: true,
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

  // `setMatchMedia` installs through `Object.defineProperty`, not `vi.stubGlobal`, so the
  // `vi.unstubAllGlobals()` the two viewport cases end with does not take it back off: whatever
  // width ran last stays installed for every case after it, and `window.innerWidth` with it. jsdom
  // ships no `matchMedia` of its own, so deleting it is what "restore" means here. In `afterEach`
  // rather than at the end of those cases because a failed assertion must not leak a viewport into
  // the next test on its way out - and `unstubAllGlobals` runs here for the same reason, since
  // every case in this file installs its `fetch` stub the same way and unstubs it on the last line,
  // which a failure skips. Repeating it here is idempotent, so those lines can stay.
  const originalInnerWidth = window.innerWidth;
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "matchMedia");
    window.innerWidth = originalInnerWidth;
  });

  it("renders a compact gantt bar for each day card", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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

  it("renders the day row's short date, and drops it without a dangling separator when the date is malformed", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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
              date: "not-a-date",
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
    const [firstCard, secondCard] = screen.getAllByTestId("timeline-day-card");

    // Valid date: the row shows "Day 1" plus the "· 12/1" short date.
    expect(firstCard.textContent).toContain("· 12/1");
    // Malformed date: `formatShortDate` returns null, so the row drops the date and, per the
    // TripTimeline fix, drops the leading "·" with it rather than leaving "Day 2 · " dangling.
    expect(secondCard.textContent).toContain("Day 2");
    expect(secondCard.textContent).not.toContain("·");

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
            accessRole: "owner",
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

  /**
   * Story 8.5 review (`DW-151`). **Two screens, one day, one figure.**
   *
   * The day view counts only the legs its timeline draws and lists the rest as orphaned, stating their
   * minutes as *not* counted. This bar renders through the very same `trips.dayView.ganttSummary`
   * string from the very same day's rows — and built from all of them it answered "Planned 7h 45m"
   * about the day the day view answers "Planned 7h 30m" about, the 15 minutes being an orphaned leg
   * that overhangs the drawn one. A user comparing the overview row with the day it links to was
   * simply told two different things.
   *
   * The fixture is the day view's own: Museum / Market / Park, a stay from 20:00, one drawn leg
   * (`Museum → Market`, 30m) and one stranded by an insertion (`Museum → Park`, 45m — measured while
   * they were neighbours). 4h stay + 3 × 1h + 30m drawn travel = 7h 30m; the orphan's 45m from 10:00
   * would push the union to 7h 45m.
   */
  it("keeps an orphaned travel leg out of a day's overview coverage bar", async () => {
    const planItem = (id: string, title: string, fromTime: string, toTime: string) => ({
      id,
      title,
      fromTime,
      toTime,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
      }),
      costCents: null,
      linkUrl: null,
      location: null,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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
                name: "Quinta",
                notes: null,
                status: "booked",
                costCents: null,
                link: null,
                checkInTime: "20:00",
                checkOutTime: null,
                location: null,
              },
              dayPlanItems: [
                planItem("item-1", "Museum", "09:00", "10:00"),
                planItem("item-2", "Market", "13:00", "14:00"),
                planItem("item-3", "Park", "16:00", "17:00"),
              ],
              travelSegments: [
                // Drawn: `Museum` and `Market` are consecutive in the day's endpoint order.
                {
                  id: "segment-drawn",
                  fromItemType: "dayPlanItem",
                  fromItemId: "item-1",
                  toItemType: "dayPlanItem",
                  toItemId: "item-2",
                  transportType: "car",
                  durationMinutes: 30,
                  distanceKm: 12,
                  linkUrl: null,
                },
                // Orphaned: `Market` was inserted between these two, so the timeline cannot draw the
                // leg and neither screen may count it.
                {
                  id: "segment-orphan",
                  fromItemType: "dayPlanItem",
                  fromItemId: "item-1",
                  toItemType: "dayPlanItem",
                  toItemId: "item-3",
                  transportType: "car",
                  durationMinutes: 45,
                  distanceKm: 30,
                  linkUrl: null,
                },
              ],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Planned 7h 30m, Unplanned 16h 30m")).toBeInTheDocument();
    expect(screen.queryByText("Planned 7h 45m, Unplanned 16h 15m")).toBeNull();

    vi.unstubAllGlobals();
  });

  /**
   * Review addition, and the other half of the case above. That test proves this bar applies the
   * drawn-pair rule; this one proves it applies the rule to the *right order*.
   *
   * The bar used to read `day.dayPlanItems` in array order, which was correct only because
   * `getTripWithDaysForUser` sorts each day's activities before serialising them — the same invisible,
   * unpinned dependency Story 8.5 removed from `TripDayView` and left standing here, on the surface
   * that renders the same summary string. So the fixture delivers a day the server would never emit
   * *today*: `Dinner` (19:00) ahead of `Museum` (09:00), the order they were created in. The one leg
   * the adjacency rule accepts is `Museum → Dinner`; in array order that pair is not consecutive and
   * its 30 minutes drop out of "Planned", which is this story's defect reappearing on the overview.
   *
   * 4h stay from 20:00 + 1h Museum + 1h Dinner + 30m travel = 6h 30m. Reading the array as it came
   * gives 6h.
   */
  it("derives the day's endpoint order itself rather than trusting the payload's array order", async () => {
    const planItem = (id: string, title: string, fromTime: string, toTime: string, createdAt: string) => ({
      id,
      title,
      fromTime,
      toTime,
      createdAt,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
      }),
      costCents: null,
      linkUrl: null,
      location: null,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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
                name: "Quinta",
                notes: null,
                status: "booked",
                costCents: null,
                link: null,
                checkInTime: "20:00",
                checkOutTime: null,
                location: null,
              },
              // Creation order, not start-time order — the array a payload without that sort delivers.
              dayPlanItems: [
                planItem("item-dinner", "Dinner", "19:00", "20:00", "2026-11-01T10:00:00.000Z"),
                planItem("item-museum", "Museum", "09:00", "10:00", "2026-11-01T10:01:00.000Z"),
              ],
              travelSegments: [
                // The pair the server's adjacency rule accepts, and the only one it would ever have
                // written: `Museum` runs first, `Dinner` follows it.
                {
                  id: "segment-drawn",
                  fromItemType: "dayPlanItem",
                  fromItemId: "item-museum",
                  toItemType: "dayPlanItem",
                  toItemId: "item-dinner",
                  transportType: "car",
                  durationMinutes: 30,
                  distanceKm: 12,
                  linkUrl: null,
                },
              ],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Planned 6h 30m, Unplanned 17h 30m")).toBeInTheDocument();
    // What the array-order reading produces: the accepted leg dismissed as undrawable.
    expect(screen.queryByText("Planned 6h, Unplanned 18h")).toBeNull();

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
            accessRole: "owner",
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
            accessRole: "owner",
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
            accessRole: "owner",
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
  // The `accessRole: "owner"` every fixture in this file now carries is load-bearing here and only
  // here. This case asserts a *layout* rule - per-day verbs belong on the day screen, not the
  // overview - and since DW-243 an absent role denies rather than grants, so without the field the
  // buttons below would be missing for the wrong reason and the case would stay green if the layout
  // rule were reversed.
  it("does not render per-day action buttons in the overview", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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
          accessRole: "owner",
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
          accessRole: "owner",
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
          accessRole: "owner",
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

  /**
   * DW-16. The Duration tile is the second consumer of `trips.dashboard.dayCount`, so the singular
   * twin the dashboard row got had to be branched on here as well - a day trip otherwise opened on a
   * tile reading "1 days". The German half is asserted because `de.ts` carries the same twin and
   * nothing else in this file ever renders the timeline in German.
   */
  describe("DW-16 duration tile at one day", () => {
    const oneDayTripDetail = {
      data: {
        trip: {
          id: "trip-1",
          name: "Trip",
          accessRole: "owner",
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
              costCents: 0,
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
    };

    const stubOneDayFetch = () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => oneDayTripDetail,
      })) as unknown as typeof fetch;

      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("reads 1 day, not 1 days", async () => {
      const fetchMock = stubOneDayFetch();

      renderWithProviders(<TripTimeline tripId="trip-1" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(await screen.findByText("1 day")).toBeInTheDocument();
      expect(screen.queryByText("1 days")).not.toBeInTheDocument();
    });

    it("reads 1 Tag in German", async () => {
      const fetchMock = stubOneDayFetch();

      renderWithProviders(<TripTimeline tripId="trip-1" />, { language: "de" });

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(await screen.findByText("1 Tag")).toBeInTheDocument();
      expect(screen.queryByText("1 Tage")).not.toBeInTheDocument();
    });
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
            accessRole: "owner",
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
            accessRole: "owner",
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
    // This and its `inline` twin below read the stamped attribute, not the grid templates the card
    // actually lays out with - a jsdom approximation kept as a declared shim by the 2026-08-08 DW-14
    // decision. The templates themselves are pinned in `tripTimelineRoles.test.tsx` ("declares the
    // day card's own column split under the same `sm` condition `data-layout` is keyed to", :755),
    // and both sides resolve from `TIMELINE_CARD_LAYOUT_BREAKPOINT` in `TripTimeline.tsx`. Note also
    // that `setMatchMedia`'s listeners are bare `vi.fn()`s that never fire, so nothing here observes
    // a live breakpoint crossing: the `rerender` below is what re-reads the stub.
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

  it("stamps `stacked` right up to the `sm` bound and `inline` exactly on it", async () => {
    // Guards the negated-`up()` form itself, which the two assertions above cannot see: they probe
    // 375 and 1280, so `useMediaQuery(down("sm"))` would satisfy them just as well. `down("sm")` is
    // `max-width:599.95px` while the `sm` sx key applies from `min-width:600px`, leaving `[599.95,
    // 600)` claimed by neither - a band real viewports reach through browser zoom and fractional
    // `devicePixelRatio`, where the attribute said `inline` while the `xs` template rendered.
    // 599.98 is inside that old band, so this case fails if the `down()` form ever comes back.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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
              note: "Arrival",
              missingAccommodation: true,
              missingPlan: false,
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

    setViewport(599.98);
    const { rerender } = renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // `findAllByTestId`, not `getAllByTestId`: the `waitFor` above resolves when the request is
    // *issued*, so a synchronous query can outrun the commit and fail on a missing element rather
    // than on the attribute under test.
    expect((await screen.findAllByTestId("timeline-day-card"))[0]).toHaveAttribute("data-layout", "stacked");

    setViewport(600);
    rerender(<Providers><TripTimeline tripId="trip-1" /></Providers>);

    expect(screen.getAllByTestId("timeline-day-card")[0]).toHaveAttribute("data-layout", "inline");

    vi.unstubAllGlobals();
  });

  it("stamps `inline` when no `matchMedia` exists to ask", async () => {
    // Guards the `defaultMatches: true` at `TripTimeline.tsx`'s `isNarrowLayout`. Negating `up()`
    // also negates MUI's default answer, so without that option a viewportless render - SSR, and
    // the four suites here that stub no `matchMedia` at all - would stamp `stacked` where the old
    // `down("sm")` form stamped `inline`. Nothing else in the suite notices: every other case that
    // reads the attribute installs a stub first, so this is the only place the default is visible.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "owner",
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
              note: "Arrival",
              missingAccommodation: true,
              missingPlan: false,
              accommodation: null,
              dayPlanItems: [],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    // Explicit, not inherited from the `afterEach`: this case's whole subject is the absence, so it
    // must not depend on which case ran before it.
    Reflect.deleteProperty(window, "matchMedia");

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByTestId("timeline-day-card"))[0]).toHaveAttribute("data-layout", "inline");

    vi.unstubAllGlobals();
  });
});
