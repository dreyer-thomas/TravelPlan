// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import { formatMessage } from "@/i18n";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 8.5, AC4/AC5/AC6 — the consequence half of the four ledger entries this story closes.
 *
 * A travel segment survives its own drawability: `TripDayView` renders a leg only for endpoint pairs
 * the day's timeline actually produces, while `totalTravelMinutes` used to reduce over **every**
 * fetched row. Insert an activity between two others (`DW-148`) and the row between them stops being
 * drawn without stopping being counted — invisible, permanent, and with no control anywhere that
 * could remove it (`DW-151`, reported from production on 2026-08-07).
 *
 * **The order this file is really about.** Which legs exist at all is decided by adjacency in
 * start-time order (`compareDayPlanItemsByStartTime`, applied by `travelSegmentRepo.ts`), so a screen
 * that splits drawn from orphaned in any other order inverts the split: it draws a pair the API
 * refuses and offers the one row the API accepts for deletion. The payload does arrive in start-time
 * order — `getTripWithDaysForUser` sorts it in its mapping, after a Prisma `orderBy: { createdAt }`
 * that alone would not — but nothing on the client can see that line, and `createdAt` was not even
 * carried until this story, so a same-minute tie was unreachable here in principle. This screen now
 * re-derives the order from the shared comparator instead of trusting the array, and the cases below
 * hand it deliberately mis-ordered payloads to keep that true.
 *
 * Its own file rather than another block in `tripDayViewLayout.test.tsx` (8100+ lines) for the reason
 * that file's own suites are split: one screen, one concern per suite. The harness below is that
 * file's, pared to what an orphaned leg needs.
 */

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: function TripAccommodationDialogStub(props: { open: boolean; stayType: "current" | "previous" }) {
    if (!props.open) return null;
    return <div data-testid={`stay-dialog-${props.stayType}`} />;
  },
}));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: function TripDayPlanDialogStub(props: { open: boolean }) {
    if (!props.open) return null;
    return <div data-testid="plan-dialog" />;
  },
}));

vi.mock("@/components/features/trips/TripDayTravelSegmentDialog", () => ({
  default: function TripDayTravelSegmentDialogStub(props: { open: boolean }) {
    if (!props.open) return null;
    return <div data-testid="segment-dialog" />;
  },
}));

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

type Segment = {
  id: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: "car" | "ship" | "flight" | "walking" | "cycling";
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
};

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/**
 * `createdAt` is the payload field the day view needs to reproduce the server's activity order, and
 * it is deliberately explicit in every fixture below. Where a fixture's array position and its
 * `createdAt` agree, it is describing an ordinary day; where they disagree, it is describing a payload
 * the server would not send today, which is exactly the point — this screen must not be correct only
 * for as long as `tripRepo`'s mapping keeps sorting for it.
 */
const planItem = (id: string, title: string, fromTime: string | null, toTime: string | null, createdAt: string) => ({
  id,
  title,
  fromTime,
  toTime,
  createdAt,
  contentJson: doc(title),
  costCents: null,
  payments: [],
  linkUrl: null,
  location: null,
});

const stay = (id: string, name: string, checkInTime: string | null, checkOutTime: string | null) => ({
  id,
  name,
  notes: null,
  status: "booked" as const,
  costCents: null,
  payments: [],
  link: null,
  checkInTime,
  checkOutTime,
  location: null,
});

type DayFixture = {
  id: string;
  accommodation: ReturnType<typeof stay> | null;
  dayPlanItems: ReturnType<typeof planItem>[];
  travelSegments: Segment[];
};

/**
 * All three roles, not the two the suite started with. The spec's Boundaries name the contributor
 * explicitly — "a contributor may remove an orphaned leg exactly as they may edit a segment" (Story
 * 5.13's writer clause) — and `owner` plus `viewer` pins only the two ends: the control is shown to
 * the role that may do everything and withheld from the role that may do nothing, which is true of a
 * gate on ownership as much as of a gate on the write right. The role in between is the one that
 * tells them apart.
 */
type FixtureAccessRole = "owner" | "contributor" | "viewer";

const tripDetail = (days: DayFixture[], accessRole: FixtureAccessRole = "owner") => ({
  trip: {
    id: "trip-1",
    name: "Trip",
    accessRole,
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: days.length > 1 ? "2026-12-02T00:00:00.000Z" : "2026-12-01T00:00:00.000Z",
    dayCount: days.length,
    plannedCostTotal: 0,
    accommodationCostTotalCents: null,
    heroImageUrl: null,
  },
  days: days.map((entry, index) => ({
    id: entry.id,
    date: `2026-12-0${index + 1}T00:00:00.000Z`,
    dayIndex: index + 1,
    plannedCostSubtotal: 0,
    missingAccommodation: false,
    missingPlan: false,
    accommodation: entry.accommodation,
    dayPlanItems: entry.dayPlanItems,
    travelSegments: entry.travelSegments,
  })),
});

/**
 * The default day: three activities and a stay, created in the order they happen, so the timeline's
 * endpoint order is `[Museum, Market, Park, Quinta]`. Every pair the tests below call an orphan is a
 * pair that order does not put next to each other.
 */
const defaultDay = (segments: Segment[]): DayFixture => ({
  id: "day-1",
  accommodation: stay("stay-1", "Quinta", "20:00", null),
  dayPlanItems: [
    planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z"),
    planItem("item-2", "Market", "13:00", "14:00", "2026-11-01T10:01:00.000Z"),
    planItem("item-3", "Park", "16:00", "17:00", "2026-11-01T10:02:00.000Z"),
  ],
  travelSegments: segments,
});

/** Drawn: `Museum → Market` are consecutive, so the timeline produces this pair. */
const DRAWN: Segment = {
  id: "segment-drawn",
  fromItemType: "dayPlanItem",
  fromItemId: "item-1",
  toItemType: "dayPlanItem",
  toItemId: "item-2",
  transportType: "car",
  durationMinutes: 30,
  distanceKm: 12,
  linkUrl: null,
};

/** Stranded: `Museum → Park` were adjacent until Market was inserted between them (`DW-148`). */
const ORPHAN: Segment = {
  id: "segment-orphan",
  fromItemType: "dayPlanItem",
  fromItemId: "item-1",
  toItemType: "dayPlanItem",
  toItemId: "item-3",
  transportType: "car",
  durationMinutes: 45,
  distanceKm: 30,
  linkUrl: null,
};

type StubOptions = {
  days?: DayFixture[];
  segments?: Segment[];
  accessRole?: FixtureAccessRole;
  /**
   * `json` overrides the body read, which is the only way to reproduce the response that matters most
   * here: a proxy's HTML error page, where `response.json()` rejects rather than resolving something
   * odd.
   */
  onDelete?: () => { ok: boolean; status: number; body?: unknown; json?: () => Promise<unknown> };
};

const stubDay = (options: StubOptions = {}) => {
  const deleteBodies: unknown[] = [];
  /**
   * Mutable, because a `404` from the delete is now answered by re-reading the day (see the two cases
   * below): what the *second* `GET` returns is the whole point of those tests, so the fixture has to be
   * able to change between the two the way the database can.
   */
  const state = {
    days: options.days ?? [defaultDay(options.segments ?? [DRAWN, ORPHAN])],
    accessRole: options.accessRole ?? ("owner" as FixtureAccessRole),
  };
  let detailRequests = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";

    if (url.includes("/bucket-list-items")) {
      return mockFetchResponse({ data: { items: [] }, error: null });
    }
    if (url.includes("/api/auth/csrf")) {
      return mockFetchResponse({ data: { csrfToken: "csrf-token" }, error: null });
    }
    if (url.includes("/images")) {
      return mockFetchResponse({ data: { images: [] }, error: null });
    }
    if (url.includes("/documents")) {
      return mockFetchResponse({ data: { documents: [] }, error: null });
    }
    if (url.includes("/route")) {
      return mockFetchResponse({
        data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } },
        error: null,
      });
    }
    if (url.includes("/travel-segments") && method === "DELETE") {
      deleteBodies.push(JSON.parse(String(init?.body ?? "{}")));
      const outcome = options.onDelete?.() ?? {
        ok: true,
        status: 200,
        body: { data: { deleted: true }, error: null },
      };
      return mockFetchResponse(outcome.body, {
        ok: outcome.ok,
        status: outcome.status,
        ...(outcome.json ? { json: outcome.json } : {}),
      });
    }

    detailRequests += 1;
    return mockFetchResponse({ data: tripDetail(state.days, state.accessRole), error: null });
  });

  stubFetch(fetchMock);
  return { fetchMock, deleteBodies, state, detailRequestCount: () => detailRequests };
};

const orphanRows = () => screen.queryAllByTestId("orphan-travel-segment");

/** The timeline legs actually rendered, as `from → to` id pairs. */
const drawnPairs = () =>
  screen
    .queryAllByTestId("travel-segment")
    .map((row) => `${row.getAttribute("data-from-id")}->${row.getAttribute("data-to-id")}`);

describe("TripDayView orphaned travel legs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **The screen's ordering contract, pinned against a payload that arrives in the wrong order.**
   * `Dinner` (19:00) was entered before `Museum` (09:00), and this fixture hands them over in that
   * order. Adjacency is decided in start-time order, so the one pair the API accepts — and the one
   * row on this day — is `Museum → Dinner`.
   *
   * Today the payload cannot actually arrive like this: `getTripWithDaysForUser` sorts each day's
   * activities with the same rule before serialising them (`tripRepo.ts`, the
   * `[...day.dayPlanItems].sort(...)` in its mapping — a private copy of this comparator until the
   * review pass replaced it with an import). That sort is the *only* thing that made the
   * screen's order right, no test pinned it, and the payload dropped `createdAt` — so a day view
   * reading the array head-on would draw `Dinner → Museum`, call the stored row an orphan, offer to
   * delete it and report `0m`. Inviting the user to destroy the one leg the server considers valid is
   * too sharp an edge to leave resting on a line in someone else's mapping function, which is why the
   * comparator is shared and applied here. This test is what keeps that true.
   */
  it("counts and draws the leg the server accepts on a day whose activities were created out of order", async () => {
    stubDay({
      days: [
        {
          id: "day-1",
          accommodation: null,
          dayPlanItems: [
            // Entered first, happens last.
            planItem("item-dinner", "Dinner", "19:00", "20:30", "2026-11-01T10:00:00.000Z"),
            planItem("item-museum", "Museum", "09:00", "10:00", "2026-11-01T10:05:00.000Z"),
          ],
          travelSegments: [
            {
              id: "segment-chronological",
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
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Drawn as the leg between the two cards it connects, in the order the day happens.
    expect(drawnPairs()).toEqual(["item-museum->item-dinner"]);
    // Counted, because it is drawn.
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("30m");
    // And emphatically not offered for deletion: this is the row the API answers `200` for.
    expect(orphanRows()).toHaveLength(0);
    expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument();
  });

  /**
   * **The comparator's fallback, seen from the screen it decides.** A payload without `createdAt` is
   * the case the shared type comment admits — an older cached response, a client built before the
   * field was carried — and the day view maps the absent field to `""`. Two activities at the same
   * minute then have no creation instant to be separated by, and the comparator used to fall through
   * to `id.localeCompare`, which does not break the tie so much as impose an order: `aaa` before `zzz`
   * regardless of what the server sent. The consequence is this screen's worst one — the pair the
   * timeline draws is reversed, so the one row the API accepts is presented as an orphan with a delete
   * button next to it.
   *
   * With the fallback returning `0`, a stable sort leaves the server's order alone and the row is
   * drawn and counted.
   */
  it("keeps the server's order for same-minute activities on a payload that carries no createdAt", async () => {
    // Deleted rather than destructured away: an unused binding is a lint warning, and what this
    // fixture is describing is precisely a wire object on which the key is *absent*.
    const withoutCreatedAt = (id: string, title: string, fromTime: string, toTime: string) => {
      const partial = { ...planItem(id, title, fromTime, toTime, "") } as Partial<ReturnType<typeof planItem>>;
      delete partial.createdAt;
      return partial as ReturnType<typeof planItem>;
    };
    stubDay({
      days: [
        {
          id: "day-1",
          accommodation: null,
          // Both at 09:00, in the server's order, with nothing on the wire to reconstruct it from.
          dayPlanItems: [withoutCreatedAt("zzz", "Zoo", "09:00", "10:00"), withoutCreatedAt("aaa", "Aquarium", "09:00", "10:00")],
          travelSegments: [
            {
              id: "segment-server-order",
              fromItemType: "dayPlanItem",
              fromItemId: "zzz",
              toItemType: "dayPlanItem",
              toItemId: "aaa",
              transportType: "car",
              durationMinutes: 25,
              distanceKm: null,
              linkUrl: null,
            },
          ],
        },
      ],
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    expect(drawnPairs()).toEqual(["zzz->aaa"]);
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("25m");
    expect(orphanRows()).toHaveLength(0);
  });

  /**
   * `DW-148` built the way a user actually reaches it. Insertion is not "a fixture with a gap in it":
   * it is creating an activity whose `fromTime` falls between two existing ones. The row is written
   * last and lands in the middle of the day, so `A → B` — measured while they were neighbours — stops
   * being a pair the timeline produces, while nothing deletes it. That is the production defect
   * itself: the leg keeps its minutes in "Fahrzeit" with no row on screen to remove them.
   */
  it("strands the neighbours' leg when a third activity is created last with a time between them", async () => {
    stubDay({
      days: [
        {
          id: "day-1",
          accommodation: null,
          dayPlanItems: [
            planItem("item-a", "Harbour", "09:00", "10:00", "2026-11-01T10:00:00.000Z"),
            planItem("item-b", "Castle", "15:00", "16:00", "2026-11-01T10:01:00.000Z"),
            // Created last, happens in the middle — this is what "inserted" means to the database.
            planItem("item-m", "Lunch", "12:00", "13:00", "2026-11-05T09:00:00.000Z"),
          ],
          travelSegments: [
            {
              id: "segment-stranded",
              fromItemType: "dayPlanItem",
              fromItemId: "item-a",
              toItemType: "dayPlanItem",
              toItemId: "item-b",
              transportType: "car",
              durationMinutes: 40,
              distanceKm: 12,
              linkUrl: null,
            },
          ],
        },
      ],
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Lunch sits between them now, so `Harbour → Castle` is not a pair the timeline produces.
    expect(drawnPairs()).toEqual(["item-a->item-m", "item-m->item-b"]);
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("0m");

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-segment-id", "segment-stranded");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-route")).toHaveTextContent("Harbour → Castle");
    // The measurements are intact and on screen — that is why the row was kept rather than deleted.
    expect(within(rows[0]).getByTestId("orphan-travel-segment-label")).toHaveTextContent("Car · 40m · 12 km");
  });

  /**
   * AC5, and the reason this file exists. 30 + 45 = 75 minutes were reported as "Fahrzeit" while only
   * the 30 had a row on screen. The figure now equals the sum of exactly what the timeline drew.
   */
  it("counts only the legs the timeline draws in the day's travel time", async () => {
    stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("30m");
    expect(screen.getByTestId("day-stat-travel-time")).not.toHaveTextContent("1h 15m");

    // AC4's other half: the stranded pair is not drawn as a timeline leg, and the drawn one is.
    expect(drawnPairs()).toContain("item-1->item-2");
    expect(drawnPairs()).not.toContain("item-1->item-3");
  });

  /**
   * AC5 again, one panel over. The coverage bar sits above the stat strip and derives "Planned" from
   * the same rows; fed every fetched segment it painted a travel block for a leg the list below
   * declares uncounted, so one panel reported an orphan's minutes twice over while denying them.
   */
  it("keeps an orphaned leg's minutes out of the coverage bar's planned total as well", async () => {
    stubDay({ segments: [DRAWN, ORPHAN] });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // 4h of stay (20:00-24:00) + 3 × 1h of activity + the drawn leg's 30m = 7h 30m. The orphan starts
    // at Museum's 10:00 and runs 45m, so counting it would push the bar to 7h 45m — the figure the
    // block below the strip simultaneously calls uncounted.
    expect(
      screen.getByText(
        formatMessage(en["trips.dayView.ganttSummary"], { planned: "7h 30m", unplanned: "16h 30m" }),
      ),
    ).toBeInTheDocument();
  });

  /**
   * AC4. The row names what it records — both endpoints as stored, plus the mode, duration and
   * distance that are the user's own measurement and the reason the row is surfaced rather than
   * silently deleted.
   */
  it("lists the stranded leg as an orphaned leg naming what it records", async () => {
    stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const block = screen.getByTestId("orphan-travel-segments");
    expect(within(block).getByText(en["trips.travelSegment.orphanTitle"])).toBeInTheDocument();

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-segment-id", "segment-orphan");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-route")).toHaveTextContent("Museum → Park");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-label")).toHaveTextContent("Car · 45m · 30 km");

    // AC5's second half: the minutes are reported, and reported as *not* part of the figure above.
    expect(
      within(block).getByText(formatMessage(en["trips.travelSegment.orphanUncounted"], { duration: "45m" })),
    ).toBeInTheDocument();
  });

  it("renders no orphan block at all when every leg is drawn", async () => {
    stubDay({ segments: [DRAWN] });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument();
  });

  /**
   * The previous night's stay is the timeline's leading endpoint, which shifts every activity one
   * place along the endpoint array. That offset is the branch the drawn/orphan split is most easily
   * got wrong in — an off-by-one there would call every drawn leg an orphan — so a day with a
   * previous night is exercised on its own.
   */
  it("splits drawn from orphaned correctly on a day that opens with the previous night's stay", async () => {
    stubDay({
      days: [
        {
          id: "day-0",
          accommodation: stay("stay-prev", "Pousada", "18:00", "08:00"),
          dayPlanItems: [],
          travelSegments: [],
        },
        {
          id: "day-1",
          accommodation: stay("stay-1", "Quinta", "20:00", null),
          dayPlanItems: [
            planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z"),
            planItem("item-2", "Market", "13:00", "14:00", "2026-11-01T10:01:00.000Z"),
          ],
          travelSegments: [
            // Drawn: the previous night's stay is the endpoint immediately before the first activity.
            {
              id: "segment-from-previous-stay",
              fromItemType: "accommodation",
              fromItemId: "stay-prev",
              toItemType: "dayPlanItem",
              toItemId: "item-1",
              transportType: "car",
              durationMinutes: 20,
              distanceKm: null,
              linkUrl: null,
            },
            // Orphaned: the previous night's stay and this night's are two endpoints apart at least.
            {
              id: "segment-stay-to-stay",
              fromItemType: "accommodation",
              fromItemId: "stay-prev",
              toItemType: "accommodation",
              toItemId: "stay-1",
              transportType: "car",
              durationMinutes: 50,
              distanceKm: null,
              linkUrl: null,
            },
          ],
        },
      ],
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });

    expect(drawnPairs()).toEqual(["stay-prev->item-1", "item-1->item-2", "item-2->stay-1"]);
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("20m");

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-segment-id", "segment-stay-to-stay");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-route")).toHaveTextContent("Pousada → Quinta");
  });

  /**
   * AC6. The endpoint has always accepted an orphan's id (`travelSegmentRepo.ts:349` looks the row up
   * by `{ id, tripDayId }` and never consults `ensureSegmentItemsExist`) — what was missing is that
   * nothing in `src/` ever issued the request. This is that request.
   */
  it("removes an orphaned leg through the existing delete endpoint without a reload", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { deleteBodies } = stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() => expect(deleteBodies).toHaveLength(1));
    expect(deleteBodies[0]).toEqual({ tripDayId: "day-1", segmentId: "segment-orphan" });
    expect(confirmSpy).toHaveBeenCalledWith(en["trips.travelSegment.orphanRemoveConfirm"]);

    await waitFor(() => expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument());
    // The drawn leg and its 30 minutes are untouched: removal takes one row, not the day's travel.
    expect(drawnPairs()).toContain("item-1->item-2");
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("30m");

    confirmSpy.mockRestore();
  });

  it("keeps the leg when the confirmation is declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { deleteBodies } = stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    expect(deleteBodies).toHaveLength(0);
    expect(orphanRows()).toHaveLength(1);

    confirmSpy.mockRestore();
  });

  /** AC6's second half: a failed removal puts the row back and says so. */
  it("restores the leg and surfaces the failure when the delete is refused", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubDay({
      onDelete: () => ({
        ok: false,
        status: 403,
        body: { data: null, error: { code: "forbidden", message: "Forbidden" } },
      }),
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(en["errors.forbidden"]));
    expect(orphanRows()).toHaveLength(1);
    expect(orphanRows()[0]).toHaveAttribute("data-segment-id", "segment-orphan");

    confirmSpy.mockRestore();
  });

  /**
   * **A `404` is two different answers and the client cannot tell them apart.**
   *
   * `travel-segments/route.ts` answers `404 not_found` both when the row is missing and when
   * `findTripDayForTripWriter` refuses the caller — a viewer, or a contributor demoted while this tab
   * was open. Iteration 1 restored the row under a "please try again" that can never succeed; the fix
   * for that treated every `404` as success, which is this half of the same coin: a refused delete made
   * the row vanish silently, with no error, and come back on the next reload.
   *
   * So neither answer is given here. The day is re-read and the server's own state settles it. This
   * case is the "really gone" half — the second `GET` no longer carries the row.
   */
  it("re-reads the day on a 404 and leaves the row gone when the server agrees it is gone", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { state, detailRequestCount } = stubDay({
      onDelete: () => {
        // The state the `404` is describing: somebody else (a second tab, a collaborator) already
        // removed this row, so the reload finds a day without it.
        state.days[0].travelSegments = state.days[0].travelSegments.filter(
          (segment) => segment.id !== "segment-orphan",
        );
        return {
          ok: false,
          status: 404,
          body: { data: null, error: { code: "not_found", message: "Travel segment not found" } },
        };
      },
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    const requestsBefore = detailRequestCount();
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    // Not simply "kept removed in local state": the day is asked.
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(requestsBefore));
    await waitFor(() => expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The rest of the day is untouched by a removal that had already happened elsewhere.
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("30m");

    confirmSpy.mockRestore();
  });

  /**
   * The other half, and the one that was silently wrong: the `404` was a refusal. The row is still
   * there, the reload brings it back with the day's real permissions — and no removal is claimed for
   * something the server never did.
   */
  it("brings the row back on a 404 that was a refused write, with the day's real permissions", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { state } = stubDay({
      onDelete: () => {
        // Demoted between load and click: the route refuses the write and cannot say so in the status,
        // because "you may not" and "it is not there" are the same `404` here. The row survives.
        state.accessRole = "viewer";
        return {
          ok: false,
          status: 404,
          body: { data: null, error: { code: "not_found", message: "Travel segment not found" } },
        };
      },
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() => expect(orphanRows()).toHaveLength(1));
    expect(orphanRows()[0]).toHaveAttribute("data-segment-id", "segment-orphan");
    // The reload is what supplies the truth, so the row comes back with the role that goes with it.
    expect(screen.queryByTestId("orphan-travel-segment-remove")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  /**
   * `response.json()` is not safe to call before the status has been read: a proxy or platform error
   * page is HTML, so the parse throws — straight into the `catch` that restores the row under the
   * retry message, which for a `404` is precisely the ghost row this handler exists not to produce.
   */
  it("survives a non-JSON error body without restoring a ghost row", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { state } = stubDay({
      onDelete: () => {
        state.days[0].travelSegments = state.days[0].travelSegments.filter(
          (segment) => segment.id !== "segment-orphan",
        );
        return {
          ok: false,
          status: 404,
          json: async () => {
            throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
          },
        };
      },
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() => expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  /** A non-404 failure with an unreadable body is still a failure: the row comes back and says so. */
  it("restores the row and shows the generic message when a failure body cannot be parsed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubDay({
      onDelete: () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
        },
      }),
    });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(en["trips.travelSegment.orphanRemoveError"]),
    );
    expect(orphanRows()).toHaveLength(1);

    confirmSpy.mockRestore();
  });

  /**
   * The second click of a double click used to be what undid the first: it issued its own `DELETE`
   * for a row the server had already removed. The control is disabled while its own request is in
   * flight, so there is no second request to answer.
   */
  it("does not issue a second delete for a leg whose removal is already in flight", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { deleteBodies } = stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Two clicks in one turn, before anything the first one started can settle — which is what a
    // double click is, and what a `window.confirm` dismissed twice in quick succession produces.
    const button = screen.getByTestId("orphan-travel-segment-remove");
    button.click();
    button.click();

    await waitFor(() => expect(deleteBodies).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument());
    // Not two, and so never a `404` answering the second click that undoes the first click's result.
    expect(deleteBodies).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  /**
   * The pre-existing rows this story deliberately does not migrate: an endpoint id that names nothing
   * on the day at all. The row is being shown so it can be removed, and a label that cannot be found
   * is itself the explanation — so it gets the fallback rather than a fetch.
   */
  it("renders an unresolvable endpoint with a fallback label and still removes the row", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const ghost: Segment = {
      ...ORPHAN,
      id: "segment-ghost",
      fromItemId: "deleted-long-ago",
    };
    const { deleteBodies } = stubDay({ segments: [DRAWN, ghost] });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId("orphan-travel-segment-route")).toHaveTextContent(
      `${en["trips.travelSegment.orphanUnknownEndpoint"]} → Park`,
    );

    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));
    await waitFor(() => expect(deleteBodies).toHaveLength(1));
    expect(deleteBodies[0]).toEqual({ tripDayId: "day-1", segmentId: "segment-ghost" });

    confirmSpy.mockRestore();
  });

  /**
   * Each orphan's remove control has to be *findable by name*, not merely unequal to its neighbour.
   *
   * Two things were wrong with the first version of this name. It read "Remove travel leg Museum →
   * Park", and most screen readers announce `→` as nothing at all — so what a user actually heard was
   * "Remove travel leg Museum Park", two nouns with no relationship between them. And it identified the
   * row by its endpoints alone, so the two rows below — whose four endpoints have all been deleted and
   * all resolve to the same fallback — shared one identical name between them (a distinct count of 1
   * for 2 buttons, confirmed by execution). The name now spells the connector out and carries what the
   * row records, which is the last thing left that differs.
   */
  it("gives each orphan's remove control a spoken, self-identifying name", async () => {
    const bothEndpointsGone: Segment = {
      ...ORPHAN,
      id: "segment-ghost-1",
      fromItemId: "gone-1",
      toItemId: "gone-2",
      transportType: "car",
      durationMinutes: 45,
      distanceKm: 30,
    };
    const alsoBothGone: Segment = {
      ...ORPHAN,
      id: "segment-ghost-2",
      fromItemId: "gone-3",
      toItemId: "gone-4",
      transportType: "ship",
      durationMinutes: 90,
      distanceKm: null,
    };
    stubDay({ segments: [bothEndpointsGone, alsoBothGone] });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    expect(orphanRows()).toHaveLength(2);
    const names = screen
      .getAllByTestId("orphan-travel-segment-remove")
      .map((button) => button.getAttribute("aria-label") ?? "");
    expect(new Set(names).size).toBe(2);

    for (const name of names) {
      // Meaningful, not just distinct: worded connectors rather than a glyph that is announced as
      // silence, and both endpoints named even when both of them are the fallback.
      expect(name).toContain("from");
      expect(name).toContain("to");
      expect(name).not.toContain("→");
      expect(name).toContain(en["trips.travelSegment.orphanUnknownEndpoint"]);
    }

    // And each one names its own row, by the only thing the two rows still differ in.
    expect(
      screen.getByRole("button", {
        name: formatMessage(en["trips.travelSegment.orphanRemoveAction"], {
          from: en["trips.travelSegment.orphanUnknownEndpoint"],
          to: en["trips.travelSegment.orphanUnknownEndpoint"],
          details: "Car · 45m · 30 km",
        }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: formatMessage(en["trips.travelSegment.orphanRemoveAction"], {
          from: en["trips.travelSegment.orphanUnknownEndpoint"],
          to: en["trips.travelSegment.orphanUnknownEndpoint"],
          details: "Ship · 1h 30m",
        }),
      }),
    ).toBeInTheDocument();
  });

  /** The resolvable case keeps naming its endpoints — the connector wording is the only change. */
  it("names the resolved endpoints of an orphan whose row still points at real items", async () => {
    stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    expect(
      screen.getByRole("button", {
        name: formatMessage(en["trips.travelSegment.orphanRemoveAction"], {
          from: "Museum",
          to: "Park",
          details: "Car · 45m · 30 km",
        }),
      }),
    ).toBeInTheDocument();
  });

  /** AC4: "and a viewer sees it too" — the row is information, the removal is a right. */
  it("shows the orphaned leg to a viewer without offering a remove control", async () => {
    stubDay({ accessRole: "viewer" });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId("orphan-travel-segment-label")).toHaveTextContent("Car · 45m · 30 km");
    expect(screen.queryByTestId("orphan-travel-segment-remove")).not.toBeInTheDocument();
  });

  /**
   * Review addition. The spec's Boundaries say it in one line — "a contributor may remove an orphaned
   * leg exactly as they may edit a segment" — and the suite proved it for neither role that carries the
   * write right, only for the owner. `canEditPlanning` is `canTripAccessRoleWrite`, which grants owner
   * *and* contributor; a control gated on `canTripAccessRoleManageTrip` by mistake would pass the owner
   * case, pass the viewer case, and refuse exactly the user Story 5.13 added the writer clause for.
   * The removal is carried through to the request, because the right that matters is the one the server
   * honours, not the one the button implies.
   */
  it("lets a contributor remove an orphaned leg", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { deleteBodies } = stubDay({ accessRole: "contributor" });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() => expect(deleteBodies).toHaveLength(1));
    expect(deleteBodies[0]).toEqual({ tripDayId: "day-1", segmentId: "segment-orphan" });
    await waitFor(() => expect(screen.queryByTestId("orphan-travel-segments")).not.toBeInTheDocument());

    confirmSpy.mockRestore();
  });

  /**
   * AC7's day-side half. The production report was "Travel segment already exists" against a row
   * nothing on screen could account for; the dialog's half of that answer is in
   * `travelSegmentDialog.test.tsx`, and this is the half it points at — the day really does offer a
   * way to reach the row the `@@unique` constraint refused to duplicate.
   */
  it("offers the existing row for the pair a repeat creation would be refused for", async () => {
    stubDay();

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    // The very pair `POST` answers `409 travel_segment_exists` for.
    expect(rows[0]).toHaveAttribute("data-segment-id", "segment-orphan");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-route")).toHaveTextContent("Museum → Park");
  });

  /**
   * AC8's client half. Story 2.35 restores a segment whose endpoints are no longer adjacent rather
   * than dropping it (`tripImportRoute.test.ts` proves the row survives the import); this is where
   * such a row lands — as an orphaned leg, not as silent minutes. The shape is the restored one:
   * an activity → stay leg with an activity since inserted between them.
   */
  it("surfaces a restored non-adjacent leg from a backup as an orphaned leg", async () => {
    const restored: Segment = {
      id: "segment-restored",
      fromItemType: "dayPlanItem",
      fromItemId: "item-2",
      toItemType: "accommodation",
      toItemId: "stay-1",
      transportType: "ship",
      durationMinutes: 90,
      distanceKm: null,
      linkUrl: null,
    };
    stubDay({ segments: [DRAWN, restored] });

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const rows = orphanRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-segment-id", "segment-restored");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-route")).toHaveTextContent("Market → Quinta");
    expect(within(rows[0]).getByTestId("orphan-travel-segment-label")).toHaveTextContent("Ship · 1h 30m");
    // Restored, surfaced, and still not folded into the figure the timeline earned.
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("30m");
  });
});
