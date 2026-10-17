// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import de from "@/i18n/de";
import en from "@/i18n/en";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { emotionDeclarations, emotionDoubledSelectorDeclarations } from "./helpers/emotionStyles";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 11.3 AC4, AC9, AC13 - the day view's half of *Nach oben* / *Nach unten*: which cards offer the
 * overflow trigger, what its menu holds, that it closes before the request, and what the day shows after
 * a success or a refusal. The harness is `tripDayViewDayChange.test.tsx`'s.
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

/**
 * Museum 09–10 and Market 13–14 (flexible), Park 16–17 (fixed, Story 13.1), then a Picnic that does not
 * fit (flexible, no times).
 */
const fullDay = (): PlanItemFixture[] => [
  planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z", "FLEXIBLE", 0),
  planItem("item-2", "Market", "13:00", "14:00", "2026-11-01T10:01:00.000Z", "FLEXIBLE", 1),
  planItem("item-3", "Park", "16:00", "17:00", "2026-11-01T10:02:00.000Z", "FIXED", 2),
  planItem("item-4", "Picnic", null, null, "2026-11-01T10:03:00.000Z", "FLEXIBLE", 3),
];

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

const moved = (itemId: string) => ({
  itemId,
  previousFromTime: "13:00",
  previousToTime: "14:00",
  previousSortOrder: 1,
  fromTime: "09:00",
  toTime: "10:00",
  previousUpdatedAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-12-01T08:00:00.000Z",
});

const reorderReceipt = (): SignedDayChangeReceiptWire => ({
  signature: "a".repeat(64),
  version: 3,
  tripDayId: "day-1",
  edited: { kind: "reordered", itemId: "item-2", neighbourId: "item-1" },
  removedTravelSegments: [],
  movedItems: [moved("item-2"), moved("item-1")],
});

type Outcome = { status: number; body: unknown };

const stubDay = (
  options: {
    accessRole?: "owner" | "contributor" | "viewer";
    items?: PlanItemFixture[];
    reorder?: () => Outcome;
    /** Holds the reorder response until the returned promise resolves. */
    reorderGate?: () => Promise<void>;
  } = {},
) => {
  const state = { items: options.items ?? fullDay() };
  const reorderRequests: { body: unknown; csrf: string | null }[] = [];
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
    if (url.includes("/day-plan-items/reorder") && method === "POST") {
      reorderRequests.push({
        body: JSON.parse(String(init?.body ?? "{}")),
        csrf: new Headers(init?.headers).get("x-csrf-token"),
      });
      await options.reorderGate?.();
      const outcome = options.reorder?.() ?? { status: 200, body: { data: { receipt: reorderReceipt() }, error: null } };
      return mockFetchResponse(outcome.body, { status: outcome.status });
    }

    detailRequests += 1;
    return mockFetchResponse({ data: tripDetail(options.accessRole ?? "owner", state.items), error: null });
  });

  stubFetch(fetchMock);
  return { state, reorderRequests, detailRequestCount: () => detailRequests };
};

const renderDay = async (language: "en" | "de" = "en") => {
  const view = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />, { language });
  await screen.findAllByTestId("day-plan-item-card");
  return view;
};

const triggerFor = (title: string, dictionary: Record<string, string> = en) =>
  screen.queryByRole("button", { name: dictionary["trips.plan.itemActionsAria"].replace("{title}", title) });

const openMenuFor = async (title: string, dictionary: Record<string, string> = en) => {
  await userEvent.click(triggerFor(title, dictionary)!);
  return screen.findByRole("menu", { name: dictionary["trips.plan.itemActionsMenu"] });
};

const menuItemNames = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((row) => row.textContent);

describe("TripDayView activity overflow menu (Story 11.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("offers no trigger to a viewer", async () => {
    stubDay({ accessRole: "viewer" });
    await renderDay();

    expect(screen.queryAllByTestId("day-plan-item-overflow")).toHaveLength(0);
  });

  it("offers a trigger on every flexible activity with a neighbour, timed or not, never on a fixed one (13.1 §10)", async () => {
    stubDay();
    await renderDay();

    expect(screen.getAllByTestId("day-plan-item-overflow")).toHaveLength(3);
    expect(triggerFor("Museum")).toBeInTheDocument();
    expect(triggerFor("Market")).toBeInTheDocument();
    // 13.1 §10: a fixed activity's place follows from its time; the untimed Picnic is flexible and moves.
    expect(triggerFor("Park")).not.toBeInTheDocument();
    expect(triggerFor("Picnic")).toBeInTheDocument();
  });

  it("offers no trigger on a lone activity, whose menu would open empty", async () => {
    stubDay({
      items: [planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z")],
    });
    await renderDay();

    expect(screen.queryAllByTestId("day-plan-item-overflow")).toHaveLength(0);
  });

  it("gives the first activity only Move down, the last only Move up, and a middle one both", async () => {
    stubDay();
    await renderDay();

    expect(menuItemNames(await openMenuFor("Museum"))).toEqual([en["trips.plan.moveDown"]]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    // 13.1 §10: the last activity is the flexible Picnic, and it may move up past the fixed Park.
    expect(menuItemNames(await openMenuFor("Picnic"))).toEqual([en["trips.plan.moveUp"]]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    expect(menuItemNames(await openMenuFor("Market"))).toEqual([en["trips.plan.moveUp"], en["trips.plan.moveDown"]]);
  });

  it("names its trigger after the activity and announces the menu it opens", async () => {
    stubDay();
    await renderDay();

    const trigger = triggerFor("Market")!;
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");

    const menu = await openMenuFor("Market");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "day-plan-item-overflow-menu");
    expect(menu.closest("#day-plan-item-overflow-menu")).not.toBeNull();
    // The open menu is modal and hides the page from the accessibility tree, so the others by test id.
    const others = screen.getAllByTestId("day-plan-item-overflow").filter((button) => button !== trigger);
    expect(others).toHaveLength(2);
    for (const other of others) expect(other).toHaveAttribute("aria-expanded", "false");
  });

  it("names the items exactly Nach oben and Nach unten in German, and holds the 44px floor via &&", async () => {
    stubDay();
    await renderDay("de");

    const menu = await openMenuFor("Market", de);
    expect(menuItemNames(menu)).toEqual(["Nach oben", "Nach unten"]);
    for (const row of within(menu).getAllByRole("menuitem")) {
      expect(row).not.toHaveAttribute("aria-label");
      expect(emotionDoubledSelectorDeclarations(row, "min-height").base).toContain("44px");
    }
  });

  it("sizes the trigger at 44 by 44", async () => {
    stubDay();
    await renderDay();

    const trigger = triggerFor("Market")!;
    expect(emotionDeclarations(trigger, "width").base).toContain("44px");
    expect(emotionDeclarations(trigger, "height").base).toContain("44px");
  });

  it("never opens the edit dialog from the trigger", async () => {
    stubDay();
    await renderDay();

    await openMenuFor("Market");
    expect(screen.queryByTestId("plan-dialog")).not.toBeInTheDocument();
  });

  it("closes the menu, posts the request with the CSRF header, shows the notice and reloads the day", async () => {
    const { reorderRequests, detailRequestCount } = stubDay();
    await renderDay();
    const before = detailRequestCount();

    const menu = await openMenuFor("Market");
    await userEvent.click(within(menu).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(reorderRequests).toEqual([{ body: { tripDayId: "day-1", itemId: "item-2", direction: "up" }, csrf: "csrf-token" }]);
    const notice = await screen.findByTestId("action-notice");
    expect(notice).toHaveTextContent(en["trips.dayChange.reordered"]);
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
  });

  it("closes the menu before the request is answered", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reorderRequests } = stubDay({ reorderGate: () => gate });
    await renderDay();

    const menu = await openMenuFor("Market");
    await userEvent.click(within(menu).getByRole("menuitem", { name: en["trips.plan.moveDown"] }));

    await waitFor(() => expect(reorderRequests).toHaveLength(1));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    release();
    await screen.findByTestId("action-notice");
  });

  it("sends one request when the trigger and item are used twice in quick succession", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reorderRequests } = stubDay({ reorderGate: () => gate });
    await renderDay();

    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));
    await waitFor(() => expect(reorderRequests).toHaveLength(1));
    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));

    release();
    await screen.findByTestId("action-notice");
    expect(reorderRequests).toHaveLength(1);
  });

  it("shows the past-midnight refusal naming the activity after the reload, and no notice", async () => {
    const { detailRequestCount } = stubDay({
      reorder: () => ({
        status: 409,
        body: {
          data: null,
          error: { code: "day_plan_past_midnight", message: "x", details: { itemId: "item-1", itemTitle: "Museum" } },
        },
      }),
    });
    await renderDay();
    const before = detailRequestCount();

    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));

    expect(await screen.findByText(en["trips.plan.pastMidnight"].replace("{title}", "Museum"))).toBeInTheDocument();
    expect(detailRequestCount()).toBeGreaterThan(before);
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("says the day changed on day_plan_changed, and that the view was refreshed on day_plan_not_reorderable", async () => {
    let code = "day_plan_changed";
    const { detailRequestCount } = stubDay({
      reorder: () => ({ status: 409, body: { data: null, error: { code, message: "x" } } }),
    });
    await renderDay();
    let before = detailRequestCount();

    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));
    expect(await screen.findByText(en["trips.plan.reorderStale"])).toBeInTheDocument();
    expect(detailRequestCount()).toBeGreaterThan(before);

    code = "day_plan_not_reorderable";
    before = detailRequestCount();
    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));
    expect(await screen.findByText(en["trips.plan.reorderUnavailable"])).toBeInTheDocument();
    expect(detailRequestCount()).toBeGreaterThan(before);
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("reloads the day on a 404, so an activity deleted elsewhere loses its card and menu", async () => {
    const { state } = stubDay({
      reorder: () => {
        state.items = state.items.filter((entry) => entry.id !== "item-2");
        return { status: 404, body: { data: null, error: { code: "not_found", message: "Day plan item not found" } } };
      },
    });
    await renderDay();

    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));

    await waitFor(() => expect(triggerFor("Market")).not.toBeInTheDocument());
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("falls back to the reorder error for anything else", async () => {
    stubDay({ reorder: () => ({ status: 500, body: { data: null, error: { code: "something_else", message: "x" } } }) });
    await renderDay();

    await userEvent.click(within(await openMenuFor("Market")).getByRole("menuitem", { name: en["trips.plan.moveUp"] }));
    expect(await screen.findByText(en["trips.plan.reorderError"])).toBeInTheDocument();
  });
});
