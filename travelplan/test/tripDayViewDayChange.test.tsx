// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 11.1 AC3–AC8 — the day view's half of the change receipt: the `action-notice` appears after a
 * save that removed a leg, offers *Rückgängig* once, and goes away when the undo window ends (close,
 * another day, another write).
 *
 * The harness is `tripDayViewOrphanSegments.test.tsx`'s, with dialog stubs that expose the callbacks
 * this story adds or changes — `onSaved(receipt)`, `onDayWrite`, `onDelete` and the segment dialog's
 * `onSaved` — as plain buttons, so each discard trigger can be driven on its own.
 */

const stubControl = vi.hoisted(() => ({ receipt: null as unknown }));

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: function TripAccommodationDialogStub(props: {
    open: boolean;
    stayType: "current" | "previous";
    onDayWrite?: () => void;
  }) {
    if (!props.open) return null;
    return (
      <div data-testid={`stay-dialog-${props.stayType}`}>
        <button type="button" onClick={() => props.onDayWrite?.()}>
          stub-stay-media-write
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: function TripDayPlanDialogStub(props: {
    open: boolean;
    onSaved: (receipt: unknown) => void;
    onDayWrite?: () => void;
    onDelete?: (itemId: string) => Promise<boolean>;
  }) {
    if (!props.open) return null;
    return (
      <div data-testid="plan-dialog">
        <button type="button" onClick={() => props.onSaved(stubControl.receipt)}>
          stub-save
        </button>
        <button type="button" onClick={() => props.onDayWrite?.()}>
          stub-media-write
        </button>
        <button type="button" onClick={() => void props.onDelete?.("item-2")}>
          stub-delete
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/features/trips/TripDayTravelSegmentDialog", () => ({
  default: function TripDayTravelSegmentDialogStub(props: { open: boolean; onSaved: (segment: unknown) => void }) {
    if (!props.open) return null;
    return (
      <button
        type="button"
        onClick={() =>
          props.onSaved({
            id: "segment-new",
            fromItemType: "dayPlanItem",
            fromItemId: "item-2",
            toItemType: "dayPlanItem",
            toItemId: "item-3",
            transportType: "walking",
            durationMinutes: 10,
            distanceKm: 1,
            linkUrl: null,
          })
        }
      >
        stub-segment-save
      </button>
    );
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

const planItem = (id: string, title: string, fromTime: string, toTime: string, createdAt: string) => ({
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

/** Museum → Market is drawn; Museum → Park is an orphan (Market sits between them). */
const segments = [
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
];

const dayFixture = (id: string, index: number) => ({
  id,
  date: `2026-12-0${index + 1}T00:00:00.000Z`,
  dayIndex: index + 1,
  plannedCostSubtotal: 0,
  missingAccommodation: false,
  missingPlan: false,
  accommodation: null,
  dayPlanItems:
    index === 0
      ? [
          planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z"),
          planItem("item-2", "Market", "13:00", "14:00", "2026-11-01T10:01:00.000Z"),
          planItem("item-3", "Park", "16:00", "17:00", "2026-11-01T10:02:00.000Z"),
        ]
      : [],
  travelSegments: index === 0 ? segments : [],
});

const tripDetail = (accessRole: "owner" | "contributor" | "viewer") => ({
  trip: {
    id: "trip-1",
    name: "Trip",
    accessRole,
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-02T00:00:00.000Z",
    dayCount: 2,
    plannedCostTotal: 0,
    accommodationCostTotalCents: null,
    heroImageUrl: null,
  },
  days: [dayFixture("day-1", 0), dayFixture("day-2", 1)],
});

const wireLeg = (id: string) => ({
  id,
  tripDayId: "day-1",
  fromItemType: "DAY_PLAN_ITEM" as const,
  fromItemId: "item-1",
  toItemType: "DAY_PLAN_ITEM" as const,
  toItemId: "item-2",
  transportType: "CAR" as const,
  durationMinutes: 30,
  distanceKm: 12,
  linkUrl: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
});

const receipt = (legs: ReturnType<typeof wireLeg>[]): SignedDayChangeReceiptWire => ({
  // Opaque to the client: it only ever sends the server's seal back, so any well-formed value will do.
  signature: "a".repeat(64),
  version: 3,
  tripDayId: "day-1",
  edited: { kind: "created", itemId: "item-new", updatedAt: "2026-12-01T08:00:00.000Z" },
  removedTravelSegments: legs,
  movedItems: [],
});

type Outcome = { ok: boolean; status: number; body: unknown };

const stubDay = (
  options: {
    accessRole?: "owner" | "contributor" | "viewer";
    undo?: () => Outcome;
    /** Holds the DELETE response until the returned promise resolves. */
    deleteGate?: () => Promise<void>;
    /** Replaces the activity DELETE's default success. */
    deleteOutcome?: () => Outcome;
  } = {},
) => {
  const state = { accessRole: options.accessRole ?? ("owner" as "owner" | "contributor" | "viewer") };
  const undoBodies: unknown[] = [];
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
    if (url.includes("/day-plan-changes/undo") && method === "POST") {
      undoBodies.push(JSON.parse(String(init?.body ?? "{}")));
      const outcome = options.undo?.() ?? { ok: true, status: 200, body: { data: { undone: true }, error: null } };
      return mockFetchResponse(outcome.body, { ok: outcome.ok, status: outcome.status });
    }
    if (url.includes("/day-plan-items") && method === "DELETE") {
      await options.deleteGate?.();
      const outcome = options.deleteOutcome?.();
      if (outcome) return mockFetchResponse(outcome.body, { ok: outcome.ok, status: outcome.status });
      return mockFetchResponse({
        data: { deleted: true, removedTravelSegmentIds: ["segment-drawn"], receipt: receipt([wireLeg("segment-drawn")]) },
        error: null,
      });
    }
    if (url.includes("/travel-segments") && method === "DELETE") {
      return mockFetchResponse({ data: { deleted: true }, error: null });
    }

    detailRequests += 1;
    return mockFetchResponse({ data: tripDetail(state.accessRole), error: null });
  });

  stubFetch(fetchMock);
  return { state, undoBodies, detailRequestCount: () => detailRequests };
};

const renderDay = async (dayId = "day-1") => {
  const view = renderWithProviders(<TripDayView tripId="trip-1" dayId={dayId} />);
  await screen.findByRole("heading", { name: dayId === "day-1" ? "Day 1" : "Day 2", level: 5 });
  return view;
};

/** Opens the plan dialog stub and "saves" with the receipt currently in `stubControl`. */
const saveThroughPlanDialog = async () => {
  await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
  await userEvent.click(await screen.findByRole("button", { name: "stub-save" }));
};

const showNotice = async () => {
  stubControl.receipt = receipt([wireLeg("segment-drawn")]);
  await saveThroughPlanDialog();
  return screen.findByTestId("action-notice");
};

describe("TripDayView change receipt notice (Story 11.1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubControl.receipt = null;
  });

  it("shows the notice after a save whose receipt removed a leg", async () => {
    stubDay();
    await renderDay();

    const notice = await showNotice();
    expect(notice).toHaveTextContent(en["trips.dayChange.legsRemovedOne"]);
    expect(screen.getByRole("button", { name: en["trips.dayChange.undo"] })).toBeEnabled();
    expect(screen.getByRole("button", { name: en["trips.dayChange.dismiss"] })).toBeInTheDocument();
  });

  it("shows nothing after a save whose receipt has no side effects", async () => {
    const { detailRequestCount } = stubDay();
    await renderDay();
    const before = detailRequestCount();

    stubControl.receipt = receipt([]);
    await saveThroughPlanDialog();

    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("never shows the notice to a viewer, even one whose rights dropped after the receipt arrived", async () => {
    const { state } = stubDay();
    await renderDay();
    state.accessRole = "viewer";

    stubControl.receipt = receipt([wireLeg("segment-drawn")]);
    await saveThroughPlanDialog();

    // The save's own reload returns the viewer role; from then on there is no one to offer undo to.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: en["trips.plan.addPrimaryAction"] })).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-notice-undo")).not.toBeInTheDocument();
  });

  it("posts the receipt once on a double click, then removes the notice and re-reads the day", async () => {
    const { undoBodies, detailRequestCount } = stubDay();
    await renderDay();
    await showNotice();
    const before = detailRequestCount();

    const undo = screen.getByRole("button", { name: en["trips.dayChange.undo"] });
    await userEvent.dblClick(undo);

    await waitFor(() => expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument());
    expect(undoBodies).toEqual([{ receipt: receipt([wireLeg("segment-drawn")]) }]);
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
  });

  it("says the day has changed and withdraws undo on a 409, keeping close", async () => {
    const { detailRequestCount } = stubDay({
      undo: () => ({
        ok: false,
        status: 409,
        body: { data: null, error: { code: "undo_stale", message: "The day has changed" } },
      }),
    });
    await renderDay();
    await showNotice();
    const before = detailRequestCount();

    await userEvent.click(screen.getByRole("button", { name: en["trips.dayChange.undo"] }));

    expect(await screen.findByText(en["trips.dayChange.undoStale"])).toBeInTheDocument();
    expect(screen.queryByTestId("action-notice-undo")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-notice-close")).toBeInTheDocument();
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
  });

  it("withdraws undo for good when the server refuses the receipt (400/404), keeping close", async () => {
    for (const status of [400, 404]) {
      const { detailRequestCount } = stubDay({
        undo: () => ({
          ok: false,
          status,
          body: { data: null, error: { code: status === 400 ? "validation_error" : "not_found", message: "no" } },
        }),
      });
      const view = await renderDay();
      await showNotice();
      const before = detailRequestCount();

      await userEvent.click(screen.getByRole("button", { name: en["trips.dayChange.undo"] }));

      expect(await screen.findByText(en["trips.dayChange.undoUnavailable"])).toBeInTheDocument();
      expect(screen.queryByTestId("action-notice-undo")).not.toBeInTheDocument();
      expect(screen.getByTestId("action-notice-close")).toBeInTheDocument();
      await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
      view.unmount();
    }
  });

  it("keeps the notice and shows the error on any other failure", async () => {
    stubDay({
      undo: () => ({ ok: false, status: 500, body: { data: null, error: { code: "unexpected", message: "boom" } } }),
    });
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getByRole("button", { name: en["trips.dayChange.undo"] }));

    expect(await screen.findByText(en["trips.dayChange.undoError"])).toBeInTheDocument();
    expect(screen.getByTestId("action-notice")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: en["trips.dayChange.undo"] })).toBeEnabled());
  });

  it("discards the receipt when the notice is closed", async () => {
    stubDay();
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getByRole("button", { name: en["trips.dayChange.dismiss"] }));

    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("discards the receipt when the view moves to another day", async () => {
    stubDay();
    const { rerender } = await renderDay();
    await showNotice();

    rerender(
      <Providers>
        <TripDayView tripId="trip-1" dayId="day-2" />
      </Providers>,
    );

    await screen.findByRole("heading", { name: "Day 2", level: 5 });
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("discards the receipt when the plan dialog makes a media write", async () => {
    stubDay();
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
    await userEvent.click(await screen.findByRole("button", { name: "stub-media-write" }));

    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("discards the receipt when the stay dialog makes a media write", async () => {
    stubDay();
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getByTestId("timeline-current-stay-edit-overlay"));
    await userEvent.click(await screen.findByRole("button", { name: "stub-stay-media-write" }));

    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("never offers undo to a viewer from the start", async () => {
    stubDay({ accessRole: "viewer" });
    await renderDay();

    expect(screen.queryByRole("button", { name: en["trips.plan.addPrimaryAction"] })).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-notice-undo")).not.toBeInTheDocument();
  });

  it("ends the earlier undo window as soon as a delete starts", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let release: () => void = () => {};
    stubDay({ deleteGate: () => new Promise<void>((resolve) => (release = resolve)) });
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
    await userEvent.click(await screen.findByRole("button", { name: "stub-delete" }));

    // In flight: the old notice's Undo must not be able to race the delete.
    await waitFor(() => expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument());
    release();
    // Landed: the delete's own receipt opens the next window.
    expect(await screen.findByTestId("action-notice")).toBeInTheDocument();
  });

  it("drops a delete's receipt that lands after the view has moved to another day", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let release: () => void = () => {};
    stubDay({ deleteGate: () => new Promise<void>((resolve) => (release = resolve)) });
    const { rerender } = await renderDay();

    await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
    await userEvent.click(await screen.findByRole("button", { name: "stub-delete" }));
    rerender(
      <Providers>
        <TripDayView tripId="trip-1" dayId="day-2" />
      </Providers>,
    );
    await screen.findByRole("heading", { name: "Day 2", level: 5 });

    release();
    // Give the late response every chance to land before asserting it did nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("discards the receipt when an orphaned leg is removed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubDay();
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getByTestId("orphan-travel-segment-remove"));

    await waitFor(() => expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument());
  });

  it("discards the receipt when a travel segment is saved", async () => {
    stubDay();
    await renderDay();
    await showNotice();

    await userEvent.click(screen.getAllByRole("button", { name: en["trips.travelSegment.editAction"] })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "stub-segment-save" }));

    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  it("shows the notice after a delete whose receipt removed a leg, and still filters the removed segments", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubDay();
    await renderDay();

    await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
    await userEvent.click(await screen.findByRole("button", { name: "stub-delete" }));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(en["trips.dayChange.legsRemovedOne"]);
    // Without the filter, `segment-drawn` would stay in state pointing at the deleted Market and be
    // listed as an orphan; with it, Museum → Park is the day's only leg and it is drawn.
    await waitFor(() => expect(screen.queryAllByTestId("orphan-travel-segment")).toHaveLength(0));
  });

  it("names the activity when a delete is refused as past midnight (Story 13.1 §7, review)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubDay({
      deleteOutcome: () => ({
        ok: false,
        status: 409,
        body: {
          data: null,
          error: { code: "day_plan_past_midnight", message: "x", details: { itemId: "item-2", itemTitle: "Park" } },
        },
      }),
    });
    await renderDay();

    await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
    await userEvent.click(await screen.findByRole("button", { name: "stub-delete" }));

    expect(await screen.findByText(en["trips.plan.pastMidnight"].replace("{title}", "Park"))).toBeInTheDocument();
  });
});

describe("TripDayView change receipt notice, version 2 (Story 11.2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubControl.receipt = null;
  });

  const movedRow = (itemId: string) => ({
    itemId,
    previousFromTime: "10:30",
    previousToTime: "11:30",
    previousSortOrder: 0,
    fromTime: "11:30",
    toTime: "12:30",
    previousUpdatedAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-12-01T08:00:00.000Z",
  });

  it("shows the moved summary before the legs part after a save that pushed activities", async () => {
    stubDay();
    await renderDay();

    stubControl.receipt = { ...receipt([wireLeg("segment-drawn")]), movedItems: [movedRow("a"), movedRow("b"), movedRow("c")] };
    await saveThroughPlanDialog();

    const notice = await screen.findByTestId("action-notice");
    expect(notice).toHaveTextContent("3 activities moved · 1 travel leg removed");
  });

  it("shows the notice for a receipt whose only side effect is a moved activity", async () => {
    stubDay();
    await renderDay();

    stubControl.receipt = { ...receipt([]), movedItems: [movedRow("a")] };
    await saveThroughPlanDialog();

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(en["trips.dayChange.itemsMovedOne"]);
  });

  it("shows the check-in warning line, and drops it once undo is withdrawn as stale", async () => {
    stubDay({
      undo: () => ({
        ok: false,
        status: 409,
        body: { data: null, error: { code: "undo_stale", message: "The day has changed" } },
      }),
    });
    await renderDay();

    stubControl.receipt = {
      ...receipt([]),
      movedItems: [movedRow("a")],
      checkInWarning: { accommodationId: "stay-1", checkInTime: "17:30" },
    };
    await saveThroughPlanDialog();

    const warning = "You will reach your stay after its 17:30 check-in.";
    expect(await screen.findByText(warning)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: en["trips.dayChange.undo"] }));
    expect(await screen.findByText(en["trips.dayChange.undoStale"])).toBeInTheDocument();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });

  it("puts a new plan conflict before the check-in warning, joined with a middle dot (Story 13.1 AC5)", async () => {
    stubDay();
    await renderDay();

    stubControl.receipt = {
      ...receipt([]),
      movedItems: [movedRow("a")],
      checkInWarning: { accommodationId: "stay-1", checkInTime: "17:30" },
      planConflicts: [{ itemId: "ferry", title: "Ferry", fromTime: "12:00", reachableAt: "12:40" }],
    };
    await saveThroughPlanDialog();

    expect(
      await screen.findByText(
        "Ferry starts at 12:00, reachable only at 12:40 · You will reach your stay after its 17:30 check-in.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the notice for a save that moved nothing but ran into a fixed activity (Story 13.1 §15)", async () => {
    stubDay();
    await renderDay();

    stubControl.receipt = {
      ...receipt([]),
      planConflicts: [{ itemId: "ferry", title: "Ferry", fromTime: "12:00", reachableAt: "12:40" }],
    };
    await saveThroughPlanDialog();

    const notice = await screen.findByTestId("action-notice");
    expect(notice).toHaveTextContent("Ferry starts at 12:00, reachable only at 12:40");
  });
});
