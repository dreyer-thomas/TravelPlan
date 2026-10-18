// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 11.4 AC8/AC11 — the day view's half of a leg or check-out push. The leg dialog and both stay
 * dialogs now hand a receipt to the view; a leg save that moved activities shows the notice and reloads
 * the day, and a receipt for another day (a check-out that pushed the next day) names that day.
 *
 * The harness is `tripDayViewDayChange.test.tsx`'s, with dialog stubs whose save buttons pass the
 * receipt held in `stubControl`.
 */

const stubControl = vi.hoisted(() => ({ receipt: null as unknown }));

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: function TripAccommodationDialogStub(props: {
    open: boolean;
    stayType: "current" | "previous";
    onSaved: (receipt: unknown) => void;
  }) {
    if (!props.open) return null;
    return (
      <button type="button" onClick={() => props.onSaved(stubControl.receipt)}>
        {`stub-stay-save-${props.stayType}`}
      </button>
    );
  },
}));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: function TripDayPlanDialogStub() {
    return null;
  },
}));

vi.mock("@/components/features/trips/TripDayTravelSegmentDialog", () => ({
  default: function TripDayTravelSegmentDialogStub(props: {
    open: boolean;
    onSaved: (segment: unknown, receipt: unknown) => void;
  }) {
    if (!props.open) return null;
    return (
      <button
        type="button"
        onClick={() =>
          props.onSaved(
            {
              id: "segment-drawn",
              fromItemType: "dayPlanItem",
              fromItemId: "item-1",
              toItemType: "dayPlanItem",
              toItemId: "item-2",
              transportType: "car",
              durationMinutes: 240,
              distanceKm: 12,
              linkUrl: null,
            },
            stubControl.receipt,
          )
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

const stay = (id: string, name: string) => ({
  id,
  name,
  notes: null,
  status: "planned",
  costCents: null,
  payments: [],
  link: null,
  checkInTime: null,
  checkOutTime: "09:00",
  location: null,
});

/** Day 1 has activities, a drawn leg and a stay; day 2 follows that stay. */
const tripDetail = () => ({
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
      plannedCostSubtotal: 0,
      missingAccommodation: false,
      missingPlan: false,
      accommodation: stay("stay-1", "Glenfern"),
      dayPlanItems: [
        planItem("item-1", "Museum", "09:00", "10:00", "2026-11-01T10:00:00.000Z"),
        planItem("item-2", "Market", "13:00", "14:00", "2026-11-01T10:01:00.000Z"),
      ],
      travelSegments: [
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
      ],
    },
    {
      id: "day-2",
      date: "2026-12-02T00:00:00.000Z",
      dayIndex: 2,
      plannedCostSubtotal: 0,
      missingAccommodation: true,
      missingPlan: false,
      accommodation: null,
      dayPlanItems: [planItem("item-9", "Falls", "12:10", "13:10", "2026-11-01T10:03:00.000Z")],
      travelSegments: [],
    },
  ],
});

/** The detail a reload returns once the server has moved Market to 15:00–16:00. */
const tripDetailAfterPush = () => {
  const detail = tripDetail();
  detail.days[0]!.dayPlanItems[1] = planItem("item-2", "Market", "15:00", "16:00", "2026-11-01T10:01:00.000Z");
  return detail;
};

/** Story 13.2: the detail with Market (fixed 13:00) reached late, as the server derives it. */
const tripDetailWithLateMarket = () => {
  const detail = tripDetail();
  return {
    ...detail,
    days: detail.days.map((day, index) =>
      index === 0
        ? {
            ...day,
            planConflicts: [
              { kind: "late" as const, itemId: "item-2", title: "Market", fromTime: "13:00", reachableAt: "13:20", lateMinutes: 20 },
            ],
          }
        : day,
    ),
  };
};

const stubDay = (
  options: { first?: () => ReturnType<typeof tripDetail>; afterFirst?: () => ReturnType<typeof tripDetail> } = {},
) => {
  let detailRequests = 0;
  const undoBodies: unknown[] = [];
  stubFetch(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/day-plan-changes/undo") && init?.method === "POST") {
        undoBodies.push(JSON.parse(String(init.body ?? "{}")));
        return mockFetchResponse({ data: { undone: true }, error: null });
      }
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
      detailRequests += 1;
      const detail =
        detailRequests > 1
          ? (options.afterFirst ?? tripDetail)()
          : (options.first ?? tripDetail)();
      return mockFetchResponse({ data: detail, error: null });
    }),
  );
  return { undoBodies, detailRequestCount: () => detailRequests };
};

const renderDay = async (dayId: "day-1" | "day-2") => {
  const view = renderWithProviders(<TripDayView tripId="trip-1" dayId={dayId} />);
  await screen.findByRole("heading", { name: dayId === "day-1" ? "Day 1" : "Day 2", level: 5 });
  return view;
};

const movedRow = (itemId: string) => ({
  itemId,
  previousFromTime: "13:00",
  previousToTime: "14:00",
  previousSortOrder: 0,
  fromTime: "14:00",
  toTime: "15:00",
  previousUpdatedAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-12-01T08:00:00.000Z",
});

const receiptFor = (
  tripDayId: string,
  edited: SignedDayChangeReceiptWire["edited"],
  moved: string[],
): SignedDayChangeReceiptWire => ({
  signature: "a".repeat(64),
  version: 3,
  tripDayId,
  edited,
  removedTravelSegments: [],
  movedItems: moved.map(movedRow),
});

const legReceipt = (moved: string[]) =>
  receiptFor("day-1", { kind: "legCreated", segmentId: "segment-drawn", updatedAt: "2026-12-01T08:00:00.000Z" }, moved);

const checkOutReceipt = (tripDayId: string, moved: string[]) =>
  receiptFor(
    tripDayId,
    {
      kind: "stayCheckOutChanged",
      accommodationId: "stay-1",
      updatedAt: "2026-12-01T08:00:00.000Z",
      previousUpdatedAt: "2026-11-01T10:00:00.000Z",
      previousCheckOutTime: "09:00",
    },
    moved,
  );

describe("TripDayView and a leg or check-out push (Story 11.4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubControl.receipt = null;
  });

  it("shows the notice with the count after a leg save that moved activities, and reloads the day", async () => {
    const { detailRequestCount } = stubDay({ afterFirst: tripDetailAfterPush });
    await renderDay("day-1");
    const before = detailRequestCount();
    expect(screen.queryByText(/15:00/)).not.toBeInTheDocument();

    stubControl.receipt = legReceipt(["item-2"]);
    await userEvent.click(screen.getAllByRole("button", { name: en["trips.travelSegment.editAction"] })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "stub-segment-save" }));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(en["trips.dayChange.itemsMovedOne"]);
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
    // The reload is what shows the server's times; the local merge only knows the leg.
    expect((await screen.findAllByText(/15:00/)).length).toBeGreaterThan(0);
  });

  it("shows no notice and does not reload after a leg save that moved nothing", async () => {
    const { detailRequestCount } = stubDay();
    await renderDay("day-1");
    const before = detailRequestCount();

    stubControl.receipt = legReceipt([]);
    await userEvent.click(screen.getAllByRole("button", { name: en["trips.travelSegment.editAction"] })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "stub-segment-save" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "stub-segment-save" })).not.toBeInTheDocument());
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
    expect(detailRequestCount()).toBe(before);
  });

  // Story 13.2 review: a fixed activity becomes late, or stops being late, without moving.
  it("reloads after a leg save that made a fixed activity late without moving anything, and marks it", async () => {
    const { detailRequestCount } = stubDay({ afterFirst: tripDetailWithLateMarket });
    await renderDay("day-1");
    const before = detailRequestCount();
    expect(screen.queryByTestId("plan-conflict")).not.toBeInTheDocument();

    stubControl.receipt = {
      ...legReceipt([]),
      planConflicts: [{ itemId: "item-2", title: "Market", fromTime: "13:00", reachableAt: "13:20" }],
    };
    await userEvent.click(screen.getAllByRole("button", { name: en["trips.travelSegment.editAction"] })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "stub-segment-save" }));

    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
    expect(await screen.findByTestId("plan-conflict")).toBeInTheDocument();
  });

  it("reloads after a leg save on a day that had conflicts, so a resolved one leaves its card", async () => {
    const { detailRequestCount } = stubDay({ first: tripDetailWithLateMarket });
    await renderDay("day-1");
    expect(await screen.findByTestId("plan-conflict")).toBeInTheDocument();
    const before = detailRequestCount();

    stubControl.receipt = legReceipt([]);
    await userEvent.click(screen.getAllByRole("button", { name: en["trips.travelSegment.editAction"] })[0]);
    await userEvent.click(await screen.findByRole("button", { name: "stub-segment-save" }));

    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId("plan-conflict")).not.toBeInTheDocument());
  });

  it("shows the notice after a previous-stay save whose receipt moved this day", async () => {
    stubDay();
    await renderDay("day-2");

    stubControl.receipt = checkOutReceipt("day-2", ["item-9"]);
    await userEvent.click(screen.getByTestId("timeline-previous-stay-edit-overlay"));
    await userEvent.click(await screen.findByRole("button", { name: "stub-stay-save-previous" }));

    const notice = await screen.findByTestId("action-notice");
    expect(notice).toHaveTextContent(en["trips.dayChange.itemsMovedOne"]);
    expect(notice).not.toHaveTextContent("on day");
  });

  it("names the pushed day when the receipt is for another day", async () => {
    stubDay();
    await renderDay("day-1");

    stubControl.receipt = checkOutReceipt("day-2", ["item-9"]);
    await userEvent.click(screen.getByTestId("timeline-current-stay-edit-overlay"));
    await userEvent.click(await screen.findByRole("button", { name: "stub-stay-save-current" }));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent("1 activity moved on day 2");
    expect(screen.getByRole("button", { name: en["trips.dayChange.undo"] })).toBeEnabled();
  });

  it("undoes another day's receipt from the day being viewed, and reloads", async () => {
    const { undoBodies, detailRequestCount } = stubDay();
    await renderDay("day-1");

    const receipt = checkOutReceipt("day-2", ["item-9"]);
    stubControl.receipt = receipt;
    await userEvent.click(screen.getByTestId("timeline-current-stay-edit-overlay"));
    await userEvent.click(await screen.findByRole("button", { name: "stub-stay-save-current" }));
    await screen.findByTestId("action-notice");
    const before = detailRequestCount();

    await userEvent.click(screen.getByRole("button", { name: en["trips.dayChange.undo"] }));

    await waitFor(() => expect(undoBodies).toEqual([{ receipt }]));
    await waitFor(() => expect(detailRequestCount()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId("action-notice-undo")).not.toBeInTheDocument());
  });
});
