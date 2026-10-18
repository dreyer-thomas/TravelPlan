// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
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
 *
 * Story 14.2 adds *Parken* as the menu's last item, so every card offers the trigger to a writer.
 */

// Story 14.2 review: the bucket idea dialog's props, so a test can save it.
const ideaDialogMock = vi.hoisted(() => ({ props: null as { onSaved: () => void } | null }));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: function TripDayPlanDialogStub(props: { open: boolean; placement?: string; onSaved: () => void }) {
    if (props.open && props.placement === "parked") ideaDialogMock.props = props;
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

/** Story 14.2. A park that moved `moved` rows earlier and removed `legs` legs. */
const parkReceipt = (itemId: string, movedIds: string[] = [], legs = 0): SignedDayChangeReceiptWire => ({
  signature: "b".repeat(64),
  version: 3,
  tripDayId: "day-1",
  edited: {
    kind: "parked",
    itemId,
    updatedAt: "2026-12-01T08:00:00.000Z",
    previous: {
      tripDayId: "day-1",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      sortOrder: 1,
      fromTime: "13:00",
      toTime: "14:00",
      updatedAt: "2026-11-01T10:00:00.000Z",
    },
  },
  removedTravelSegments: Array.from({ length: legs }, (_, index) => ({
    id: `leg-${index}`,
    tripDayId: "day-1",
    fromItemType: "DAY_PLAN_ITEM" as const,
    fromItemId: "item-1",
    toItemType: "DAY_PLAN_ITEM" as const,
    toItemId: itemId,
    transportType: "WALKING" as const,
    durationMinutes: 10,
    distanceKm: null,
    linkUrl: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  })),
  movedItems: movedIds.map(moved),
});

/** `unreadable`: the answer arrives but its body is not JSON (a proxy's HTML 502). */
type Outcome = { status: number; body: unknown; unreadable?: boolean };

/** Story 14.2 review. A bucket row, as the bucket-list route returns it. */
const bucketIdea = (id: string, title: string) => ({
  id,
  tripId: "trip-1",
  title,
  contentJson: '{"type":"doc","content":[]}',
  durationMinutes: 60,
  costCents: null,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  payments: [],
  linkUrl: null,
  location: null,
  firstImageUrl: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
});

const stubDay = (
  options: {
    accessRole?: "owner" | "contributor" | "viewer";
    items?: PlanItemFixture[];
    reorder?: () => Outcome;
    /** Holds the reorder response until the returned promise resolves. */
    reorderGate?: () => Promise<void>;
    /** Story 14.2. The park answer; by default 200 with `parkReceipt()`. */
    park?: () => Outcome;
    parkGate?: () => Promise<void>;
    /** Story 14.2. What the day holds after a successful park (the activity has left it). */
    afterPark?: (items: PlanItemFixture[], itemId: string) => PlanItemFixture[];
    undo?: () => Outcome;
    /** Story 14.2 review. What the bucket-list route returns; empty by default. */
    bucketItems?: () => unknown[];
  } = {},
) => {
  const state = { items: options.items ?? fullDay() };
  const reorderRequests: { body: unknown; csrf: string | null }[] = [];
  const parkRequests: { body: { itemId: string; tripDayId: string }; csrf: string | null }[] = [];
  const undoRequests: unknown[] = [];
  let detailRequests = 0;
  let bucketRequests = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";

    if (url.includes("/bucket-list-items")) {
      bucketRequests += 1;
      return mockFetchResponse({ data: { items: options.bucketItems?.() ?? [] }, error: null });
    }
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

    if (url.includes("/day-plan-items/park") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { itemId: string; tripDayId: string };
      parkRequests.push({ body, csrf: new Headers(init?.headers).get("x-csrf-token") });
      await options.parkGate?.();
      const outcome = options.park?.() ?? { status: 200, body: { data: { receipt: parkReceipt(body.itemId) }, error: null } };
      if (outcome.status === 200) {
        state.items = (options.afterPark ?? ((items, id) => items.filter((entry) => entry.id !== id)))(state.items, body.itemId);
      }
      if (outcome.unreadable) {
        return mockFetchResponse(undefined, {
          status: outcome.status,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        });
      }
      return mockFetchResponse(outcome.body, { status: outcome.status });
    }
    if (url.includes("/day-plan-changes/undo") && method === "POST") {
      undoRequests.push(JSON.parse(String(init?.body ?? "{}")));
      const outcome = options.undo?.() ?? { status: 200, body: { data: { undone: true }, error: null } };
      return mockFetchResponse(outcome.body, { status: outcome.status });
    }

    detailRequests += 1;
    return mockFetchResponse({ data: tripDetail(options.accessRole ?? "owner", state.items), error: null });
  });

  stubFetch(fetchMock);
  return {
    state,
    reorderRequests,
    parkRequests,
    undoRequests,
    detailRequestCount: () => detailRequests,
    bucketRequestCount: () => bucketRequests,
  };
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

  it("offers a trigger on every activity, a fixed one too, whose menu then holds only Park (Story 14.2 AC2)", async () => {
    stubDay();
    await renderDay();

    expect(screen.getAllByTestId("day-plan-item-overflow")).toHaveLength(4);
    for (const title of ["Museum", "Market", "Park", "Picnic"]) expect(triggerFor(title)).toBeInTheDocument();
    // 13.1 §10: a fixed activity's place follows from its time, so it cannot move - but it can be parked.
    expect(menuItemNames(await openMenuFor("Park"))).toEqual([en["trips.plan.parkAction"]]);
  });

  it("offers a trigger on a lone activity too, whose menu holds only Park (Story 14.2 AC2)", async () => {
    stubDay({
      items: [planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z")],
    });
    await renderDay();

    expect(screen.getAllByTestId("day-plan-item-overflow")).toHaveLength(1);
    expect(menuItemNames(await openMenuFor("Museum"))).toEqual([en["trips.plan.parkAction"]]);
  });

  it("gives the first activity only Move down, the last only Move up, and a middle one both", async () => {
    stubDay();
    await renderDay();

    expect(menuItemNames(await openMenuFor("Museum"))).toEqual([en["trips.plan.moveDown"], en["trips.plan.parkAction"]]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    // 13.1 §10: the last activity is the flexible Picnic, and it may move up past the fixed Park.
    expect(menuItemNames(await openMenuFor("Picnic"))).toEqual([en["trips.plan.moveUp"], en["trips.plan.parkAction"]]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    expect(menuItemNames(await openMenuFor("Market"))).toEqual([
      en["trips.plan.moveUp"],
      en["trips.plan.moveDown"],
      en["trips.plan.parkAction"],
    ]);
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
    expect(others).toHaveLength(3);
    for (const other of others) expect(other).toHaveAttribute("aria-expanded", "false");
  });

  it("names the items exactly Nach oben, Nach unten and Parken in German, and holds the 44px floor via &&", async () => {
    stubDay();
    await renderDay("de");

    const menu = await openMenuFor("Market", de);
    expect(menuItemNames(menu)).toEqual(["Nach oben", "Nach unten", "Parken"]);
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

describe("TripDayView Parken (Story 14.2 AC1, AC3, AC4, AC8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ideaDialogMock.props = null;
  });

  const parkFrom = async (title: string, dictionary: Record<string, string> = en) =>
    userEvent.click(within(await openMenuFor(title, dictionary)).getByRole("menuitem", { name: dictionary["trips.plan.parkAction"] }));

  it("closes the menu before the request, posts itemId and tripDayId with the CSRF header, and asks no confirmation", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirm = vi.spyOn(window, "confirm");
    const { parkRequests } = stubDay({ parkGate: () => gate });
    await renderDay();

    await parkFrom("Market");

    await waitFor(() => expect(parkRequests).toHaveLength(1));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(parkRequests).toEqual([{ body: { itemId: "item-2", tripDayId: "day-1" }, csrf: "csrf-token" }]);
    expect(confirm).not.toHaveBeenCalled();
    release();
    await screen.findByTestId("action-notice");
  });

  it("sends one request when Park is chosen twice in quick succession", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { parkRequests } = stubDay({ parkGate: () => gate, afterPark: (items) => items });
    await renderDay();

    await parkFrom("Market");
    await waitFor(() => expect(parkRequests).toHaveLength(1));
    await parkFrom("Market");

    release();
    await screen.findByTestId("action-notice");
    expect(parkRequests).toHaveLength(1);
  });

  it("names the parked activity in the notice although the reloaded day no longer holds it, and reloads the bucket list", async () => {
    const { bucketRequestCount } = stubDay();
    await renderDay("de");
    const bucketBefore = bucketRequestCount();

    await parkFrom("Market", de);

    const notice = await screen.findByTestId("action-notice");
    await waitFor(() => expect(triggerFor("Market", de)).not.toBeInTheDocument());
    expect(notice).toHaveTextContent("„Market“ geparkt");
    expect(within(notice).getByRole("button", { name: de["trips.dayChange.undo"] })).toBeInTheDocument();
    await waitFor(() => expect(bucketRequestCount()).toBeGreaterThan(bucketBefore));
  });

  it("appends the moved count and the removed legs to the notice", async () => {
    stubDay({
      park: () => ({ status: 200, body: { data: { receipt: parkReceipt("item-2", ["item-3", "item-4"], 1) }, error: null } }),
    });
    await renderDay("de");

    await parkFrom("Market", de);

    expect(await screen.findByTestId("action-notice")).toHaveTextContent("„Market“ geparkt · 2 Aktivitäten verschoben · 1 Fahrt entfernt");
  });

  it("posts the receipt on Rückgängig and reloads the bucket list after the undo", async () => {
    const { undoRequests, bucketRequestCount } = stubDay();
    await renderDay();

    await parkFrom("Market");
    const notice = await screen.findByTestId("action-notice");
    await waitFor(() => expect(triggerFor("Market")).not.toBeInTheDocument());
    const bucketBefore = bucketRequestCount();

    await userEvent.click(within(notice).getByRole("button", { name: en["trips.dayChange.undo"] }));

    await waitFor(() => expect(undoRequests).toEqual([{ receipt: parkReceipt("item-2") }]));
    await waitFor(() => expect(bucketRequestCount()).toBeGreaterThan(bucketBefore));
  });

  it("says the day changed on day_plan_changed, after the reload, and reloads the bucket list", async () => {
    const { detailRequestCount, bucketRequestCount } = stubDay({
      park: () => ({ status: 409, body: { data: null, error: { code: "day_plan_changed", message: "x" } } }),
    });
    await renderDay();
    const detailBefore = detailRequestCount();
    const bucketBefore = bucketRequestCount();

    await parkFrom("Market");

    expect(await screen.findByText(en["trips.plan.parkStale"])).toBeInTheDocument();
    expect(detailRequestCount()).toBeGreaterThan(detailBefore);
    await waitFor(() => expect(bucketRequestCount()).toBeGreaterThan(bucketBefore));
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("reloads the day on a 404 and shows the park error, and the bucket list reloads too", async () => {
    const { state, bucketRequestCount } = stubDay({
      park: () => {
        state.items = state.items.filter((entry) => entry.id !== "item-2");
        return { status: 404, body: { data: null, error: { code: "not_found", message: "Day plan item not found" } } };
      },
    });
    await renderDay();
    const bucketBefore = bucketRequestCount();

    await parkFrom("Market");

    await waitFor(() => expect(triggerFor("Market")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(en["trips.plan.parkError"]);
    await waitFor(() => expect(bucketRequestCount()).toBeGreaterThan(bucketBefore));
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("shows the network message on a network failure and keeps the day rather than reloading it", async () => {
    const { bucketRequestCount, detailRequestCount } = stubDay({
      park: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderDay();
    const bucketBefore = bucketRequestCount();
    const detailBefore = detailRequestCount();

    await parkFrom("Market");

    expect(await screen.findByRole("alert")).toHaveTextContent(en["errors.network"]);
    await waitFor(() => expect(bucketRequestCount()).toBeGreaterThan(bucketBefore));
    expect(detailRequestCount()).toBe(detailBefore);
    expect(triggerFor("Market")).toBeInTheDocument();
  });

  it("reloads the day when the answer arrives unreadable, so a park the server saved leaves the day (review)", async () => {
    const { state, bucketRequestCount } = stubDay({
      park: () => {
        state.items = state.items.filter((entry) => entry.id !== "item-2");
        return { status: 502, body: null, unreadable: true };
      },
    });
    await renderDay();
    const bucketBefore = bucketRequestCount();

    await parkFrom("Market");

    await waitFor(() => expect(triggerFor("Market")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(en["errors.network"]);
    await waitFor(() => expect(bucketRequestCount()).toBeGreaterThan(bucketBefore));
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("ends the park's undo window when the parked idea is then edited from its bucket row (review)", async () => {
    let parked = false;
    stubDay({
      park: () => {
        parked = true;
        return { status: 200, body: { data: { receipt: parkReceipt("item-2") }, error: null } };
      },
      bucketItems: () => (parked ? [bucketIdea("item-2", "Market")] : []),
    });
    await renderDay();

    await parkFrom("Market");
    const notice = await screen.findByTestId("action-notice");
    expect(within(notice).getByRole("button", { name: en["trips.dayChange.undo"] })).toBeInTheDocument();

    const row = await screen.findByTestId("bucket-item");
    await userEvent.click(within(row).getByRole("button", { name: en["trips.bucketList.editAction"] }));
    await waitFor(() => expect(ideaDialogMock.props).not.toBeNull());
    await act(async () => {
      ideaDialogMock.props?.onSaved();
    });

    await waitFor(() => expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument());
  });

  it("keeps the park's undo window when another idea is edited (review)", async () => {
    let parked = false;
    stubDay({
      park: () => {
        parked = true;
        return { status: 200, body: { data: { receipt: parkReceipt("item-2") }, error: null } };
      },
      bucketItems: () => (parked ? [bucketIdea("idea-9", "Wasserfall"), bucketIdea("item-2", "Market")] : []),
    });
    await renderDay();

    await parkFrom("Market");
    await screen.findByTestId("action-notice");

    const rows = await screen.findAllByTestId("bucket-item");
    const other = rows.find((row) => row.textContent?.includes("Wasserfall"))!;
    await userEvent.click(within(other).getByRole("button", { name: en["trips.bucketList.editAction"] }));
    await waitFor(() => expect(ideaDialogMock.props).not.toBeNull());
    await act(async () => {
      ideaDialogMock.props?.onSaved();
    });

    const notice = await screen.findByTestId("action-notice");
    expect(within(notice).getByRole("button", { name: en["trips.dayChange.undo"] })).toBeInTheDocument();
  });

  it("falls back to the park error for anything else", async () => {
    stubDay({ park: () => ({ status: 500, body: { data: null, error: { code: "something_else", message: "x" } } }) });
    await renderDay();

    await parkFrom("Market");
    expect(await screen.findByText(en["trips.plan.parkError"])).toBeInTheDocument();
  });

  it("offers a viewer no trigger, so no Park", async () => {
    stubDay({ accessRole: "viewer" });
    await renderDay();

    expect(screen.queryAllByTestId("day-plan-item-overflow")).toHaveLength(0);
    expect(screen.queryByRole("menuitem", { name: en["trips.plan.parkAction"] })).not.toBeInTheDocument();
  });
});
