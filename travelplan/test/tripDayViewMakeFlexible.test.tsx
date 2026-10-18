// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 13.3 AC5 - the day view's half of *Alle flexibel machen*: who sees the day-menu item, its
 * confirmation, the request it sends, the notice and the reload. The harness is `tripDayViewReorder.test.tsx`'s.
 */

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: function TripDayPlanDialogStub(props: { open: boolean }) {
    return props.open ? <div data-testid="plan-dialog" /> : null;
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

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const planItem = (
  id: string,
  title: string,
  fromTime: string | null,
  toTime: string | null,
  createdAt: string,
  scheduleMode: "FLEXIBLE" | "FIXED" = "FLEXIBLE",
  sortOrder = 0,
) => ({
  id,
  title,
  fromTime,
  toTime,
  createdAt,
  scheduleMode,
  durationMinutes: 60,
  sortOrder,
  contentJson: doc(title),
  costCents: null,
  payments: [],
  linkUrl: null,
  location: null,
});

type PlanItemFixture = ReturnType<typeof planItem>;

const tripDetail = (accessRole: "owner" | "contributor" | "viewer", items: PlanItemFixture[]) => ({
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
      missingAccommodation: false,
      missingPlan: false,
      accommodation: null,
      dayPlanItems: items,
      travelSegments: [],
    },
  ],
});


/** Three FIXED activities made flexible; one flexible row behind them moved. */
const madeFlexibleReceipt = (): SignedDayChangeReceiptWire => ({
  signature: "c".repeat(64),
  version: 3,
  tripDayId: "day-1",
  edited: {
    kind: "madeFlexible",
    items: ["item-1", "item-2", "item-3"].map((itemId, sortOrder) => ({
      itemId,
      updatedAt: "2026-12-01T08:00:00.000Z",
      previous: { durationMinutes: 60, fromTime: "10:00", toTime: "11:00", sortOrder, updatedAt: "2026-11-01T10:00:00.000Z" },
    })),
  },
  removedTravelSegments: [],
  movedItems: [],
});

/** Museum, Market and Park fixed, Picnic flexible. */
const fixedDay = (): PlanItemFixture[] => [
  planItem("item-1", "Museum", "10:00", "11:00", "2026-11-01T10:00:00.000Z", "FIXED", 0),
  planItem("item-2", "Market", "13:00", "14:00", "2026-11-01T10:01:00.000Z", "FIXED", 1),
  planItem("item-3", "Park", "16:00", "17:00", "2026-11-01T10:02:00.000Z", "FIXED", 2),
  planItem("item-4", "Picnic", "17:00", "18:00", "2026-11-01T10:03:00.000Z", "FLEXIBLE", 3),
];

const allFlexible = (items: PlanItemFixture[]) => items.map((item) => ({ ...item, scheduleMode: "FLEXIBLE" as const }));

type Outcome = { status: number; body: unknown };

const stubDay = (options: { accessRole?: "owner" | "contributor" | "viewer"; items?: PlanItemFixture[]; makeFlexible?: () => Outcome } = {}) => {
  const state = { items: options.items ?? fixedDay() };
  const requests: { body: unknown; csrf: string | null }[] = [];
  let detailRequests = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
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
    if (url.includes("/day-plan-items/make-flexible") && method === "POST") {
      requests.push({ body: JSON.parse(String(init?.body ?? "{}")), csrf: new Headers(init?.headers).get("x-csrf-token") });
      const outcome = options.makeFlexible?.() ?? { status: 200, body: { data: { receipt: madeFlexibleReceipt() }, error: null } };
      if (outcome.status === 200) state.items = allFlexible(state.items);
      return mockFetchResponse(outcome.body, { status: outcome.status });
    }
    detailRequests += 1;
    return mockFetchResponse({ data: tripDetail(options.accessRole ?? "owner", state.items), error: null });
  });
  stubFetch(fetchMock);
  return { state, requests, detailRequestCount: () => detailRequests };
};

const renderDay = async (language: "en" | "de" = "en") => {
  const view = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />, { language });
  await screen.findAllByTestId("day-plan-item-card");
  return view;
};

const openDayMenu = async () => {
  await userEvent.click(screen.getByTestId("day-hero-overflow"));
  return screen.findByRole("menu");
};

const openConfirmation = async () => {
  const menu = await openDayMenu();
  await userEvent.click(within(menu).getByTestId("day-menu-make-flexible"));
  return screen.findByTestId("day-make-flexible-dialog");
};

describe("TripDayView Alle flexibel machen (Story 13.3 AC5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the item to an owner and a contributor on a day with a fixed activity, announcing a dialog", async () => {
    for (const accessRole of ["owner", "contributor"] as const) {
      stubDay({ accessRole });
      const view = await renderDay();

      const menu = await openDayMenu();
      const item = within(menu).getByTestId("day-menu-make-flexible");
      expect(item).toHaveTextContent(en["trips.dayView.makeFlexibleAction"]);
      expect(item).toHaveAttribute("aria-haspopup", "dialog");
      expect(item).not.toHaveAttribute("aria-label");
      // Above the divider, directly after the swap.
      const names = within(menu).getAllByRole("menuitem").map((row) => row.textContent);
      expect(names.indexOf(en["trips.dayView.makeFlexibleAction"])).toBe(names.indexOf(en["trips.dayTransfer.swapAction"]) + 1);
      expect(item.nextElementSibling).toBe(within(menu).getByTestId("day-hero-overflow-divider"));
      view.unmount();
    }
  });

  it("does not offer it on an all-flexible day, nor to a viewer", async () => {
    stubDay({ items: allFlexible(fixedDay()) });
    const view = await renderDay();
    expect(within(await openDayMenu()).queryByTestId("day-menu-make-flexible")).not.toBeInTheDocument();
    view.unmount();

    stubDay({ accessRole: "viewer" });
    await renderDay();
    expect(within(await openDayMenu()).queryByTestId("day-menu-make-flexible")).not.toBeInTheDocument();
  });

  it("asks first, in German: the count, and Feste Zeiten behalten posts nothing", async () => {
    const { requests } = stubDay();
    await renderDay("de");

    const dialog = await openConfirmation();
    expect(within(dialog).getByText("Alle Aktivitäten flexibel machen?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("3 Aktivitäten mit fester Zeit behalten ihre Dauer und Reihenfolge. Ihre Zeiten berechnet danach die App.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Feste Zeiten behalten" }));

    await waitFor(() => expect(screen.queryByTestId("day-make-flexible-dialog")).not.toBeInTheDocument());
    expect(requests).toEqual([]);
  });

  it("uses the singular body for one fixed activity", async () => {
    stubDay({ items: [planItem("item-1", "Ferry", "12:00", "13:00", "2026-11-01T10:00:00.000Z", "FIXED", 0)] });
    await renderDay();

    expect(await openConfirmation()).toHaveTextContent(en["trips.dayView.makeFlexibleBodyOne"]);
  });

  it("confirming posts the day with the CSRF header, shows the notice with Undo and reloads the day", async () => {
    const { requests, detailRequestCount } = stubDay();
    await renderDay();
    const loadsBefore = detailRequestCount();

    const dialog = await openConfirmation();
    await userEvent.click(within(dialog).getByRole("button", { name: en["trips.dayView.makeFlexibleConfirm"] }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({ body: { tripDayId: "day-1" }, csrf: "csrf-token" });
    // The confirmation is gone (its exit transition hides the page from the accessibility tree until then).
    await waitFor(() => expect(screen.queryByTestId("day-make-flexible-dialog")).not.toBeInTheDocument());
    const notice = await screen.findByTestId("action-notice");
    expect(notice).toHaveTextContent("3 activities made flexible");
    expect(within(notice).getByRole("button", { name: en["trips.dayChange.undo"] })).toBeInTheDocument();
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(loadsBefore));
    await waitFor(() => expect(screen.queryAllByTestId("day-plan-item-time-fixed")).toHaveLength(0));
  });

  it("on day_plan_changed reloads the day and says so", async () => {
    const { detailRequestCount } = stubDay({
      makeFlexible: () => ({ status: 409, body: { data: null, error: { code: "day_plan_changed", message: "changed" } } }),
    });
    await renderDay();
    const loadsBefore = detailRequestCount();

    const dialog = await openConfirmation();
    await userEvent.click(within(dialog).getByRole("button", { name: en["trips.dayView.makeFlexibleConfirm"] }));

    expect(await screen.findByText(en["trips.dayView.makeFlexibleStale"])).toBeInTheDocument();
    expect(detailRequestCount()).toBeGreaterThan(loadsBefore);
  });

  it("falls back to the error message for anything else", async () => {
    stubDay({ makeFlexible: () => ({ status: 500, body: { data: null, error: { code: "something_else", message: "x" } } }) });
    await renderDay();

    const dialog = await openConfirmation();
    await userEvent.click(within(dialog).getByRole("button", { name: en["trips.dayView.makeFlexibleConfirm"] }));

    expect(await screen.findByText(en["trips.dayView.makeFlexibleError"])).toBeInTheDocument();
  });
});
