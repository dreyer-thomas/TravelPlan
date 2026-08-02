// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import type { ReactNode } from "react";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

const planDialogMockState = vi.hoisted(() => ({
  lastProps: null as null | {
    open: boolean;
    mode: "add" | "edit";
    item: { id: string; linkUrl: string | null } | null;
    prefill?: {
      title: string;
      contentJson: string;
      location: { lat: number; lng: number; label?: string | null } | null;
      bucketListItemId: string;
    } | null;
    onDelete?: (itemId: string) => Promise<boolean>;
    onClose: () => void;
    onSaved: () => void;
  },
}));
const navigationMockState = vi.hoisted(() => ({
  search: "",
}));

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: (props: {
    open: boolean;
    mode: "add" | "edit";
    item: { id: string; linkUrl: string | null } | null;
    prefill?: {
      title: string;
      contentJson: string;
      location: { lat: number; lng: number; label?: string | null } | null;
      bucketListItemId: string;
    } | null;
    onDelete?: (itemId: string) => Promise<boolean>;
    onClose: () => void;
    onSaved: () => void;
  }) => {
    planDialogMockState.lastProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="plan-dialog">
        <span data-testid="plan-dialog-mode">{props.mode}</span>
        <span data-testid="plan-dialog-item-id">{props.item?.id ?? "none"}</span>
        <span data-testid="plan-dialog-item-link">{props.item?.linkUrl ?? "none"}</span>
        <span data-testid="plan-dialog-prefill-title">{props.prefill?.title ?? "none"}</span>
        <span data-testid="plan-dialog-prefill-bucket">{props.prefill?.bucketListItemId ?? "none"}</span>
        {props.mode === "edit" && props.item ? (
          <button type="button" onClick={() => void props.onDelete?.(props.item.id)}>
            Delete plan item
          </button>
        ) : null}
      </div>
    );
  },
}));

const buildBucketListResponse = (items: unknown[] = []) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { items }, error: null }),
});

let bucketListItemsOverride: unknown[] | null = null;

const maybeHandleBucketListRequest = (input: RequestInfo | URL, items: unknown[] = []) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/bucket-list-items")) {
    const resolvedItems = bucketListItemsOverride ?? items;
    return buildBucketListResponse(resolvedItems);
  }
  return null;
};

const withBucketList = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>,
) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const bucketResponse = maybeHandleBucketListRequest(input);
    if (bucketResponse) return bucketResponse;
    return handler(input, init);
  });

vi.mock("@/components/features/trips/TripDayTravelSegmentDialog", () => ({
  default: (props: {
    open: boolean;
    segment: {
      id: string;
      fromItemType: "accommodation" | "dayPlanItem";
      fromItemId: string;
      toItemType: "accommodation" | "dayPlanItem";
      toItemId: string;
      transportType: "car" | "ship" | "flight";
      durationMinutes: number;
      distanceKm: number | null;
      linkUrl: string | null;
    } | null;
    fromItem: { id: string; type: "accommodation" | "dayPlanItem" } | null;
    toItem: { id: string; type: "accommodation" | "dayPlanItem" } | null;
    onSaved: (segment: {
      id: string;
      fromItemType: "accommodation" | "dayPlanItem";
      fromItemId: string;
      toItemType: "accommodation" | "dayPlanItem";
      toItemId: string;
      transportType: "car" | "ship" | "flight";
      durationMinutes: number;
      distanceKm: number | null;
      linkUrl: string | null;
    }) => void;
  }) => {
    if (!props.open) return null;
    const baseSegment =
      props.segment ??
      (props.fromItem && props.toItem
        ? {
            id: "segment-new",
            fromItemType: props.fromItem.type,
            fromItemId: props.fromItem.id,
            toItemType: props.toItem.type,
            toItemId: props.toItem.id,
            transportType: "car" as const,
            durationMinutes: 30,
            distanceKm: null,
            linkUrl: null,
          }
        : null);

    return (
      <button
        type="button"
        data-testid="segment-save"
        onClick={() => {
          if (!baseSegment) return;
          props.onSaved({ ...baseSegment, durationMinutes: 60 });
        }}
      >
        Save segment
      </button>
    );
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationMockState.search),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    ({
      points,
      polylinePositions,
      onMarkerClick,
    }: {
      points: { id: string; position: [number, number] }[];
      polylinePositions?: [number, number][];
      onMarkerClick?: (point: { id: string }) => void;
    }) => (
      <div data-testid="day-map-container">
        {points.map((point, index) => (
          <button
            key={point.id}
            type="button"
            data-testid="day-map-marker"
            data-position={point.position.join(",")}
            onClick={() => onMarkerClick?.(point)}
          />
        ))}
        {(polylinePositions ?? points.map((point) => point.position)).length >= 2 ? (
          <div
            data-testid="day-map-polyline"
            data-positions={JSON.stringify(polylinePositions ?? points.map((point) => point.position))}
          />
        ) : null}
      </div>
    ),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="day-map-container">{children}</div>,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: ({ children }: { children?: ReactNode }) => <div data-testid="day-map-marker">{children}</div>,
  Polyline: () => <div data-testid="day-map-polyline" />,
  useMap: () => ({ fitBounds: vi.fn(), invalidateSize: vi.fn(), getContainer: vi.fn(() => document.createElement("div")) }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
    divIcon: (options: unknown) => options,
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
  divIcon: (options: unknown) => options,
}));

describe("TripDayView layout", () => {
  beforeEach(() => {
    bucketListItemsOverride = null;
  });
  it("renders the day gantt bar in the header overview area", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByTestId("trip-day-gantt-bar")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("hides owner-only day controls", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input) => {
      const url = String(input);
      if (url.includes("/accommodations/images") || url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/days/day-1/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              accessRole: "viewer",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-01T00:00:00.000Z",
              dayCount: 1,
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
                accommodation: {
                  id: "stay-1",
                  name: "Viewer Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  payments: [],
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Museum",
                    fromTime: "09:00",
                    toTime: "10:00",
                    contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Visit" }] }] }),
                    costCents: null,
                    payments: [],
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
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add stay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    // Story 6.9: the pencil is gone; a viewer's activity card is inert instead of pencil-less.
    expect(screen.queryByTestId("day-plan-item-edit-overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("Bucket list")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows contributor planning controls while keeping owner-only bucket list hidden", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input) => {
      const url = String(input);
      if (url.includes("/accommodations/images") || url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/days/day-1/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              accessRole: "contributor",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-01T00:00:00.000Z",
              dayCount: 1,
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
                accommodation: {
                  id: "stay-1",
                  name: "Contributor Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  payments: [],
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Museum",
                    fromTime: "09:00",
                    toTime: "10:00",
                    contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Visit" }] }] }),
                    costCents: null,
                    payments: [],
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
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit stay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add plan item" })).toBeInTheDocument();
    // Story 6.9: a contributor edits by clicking the card, so the gate shows up as the stretched edit
    // overlay. canEditPlanning, not isOwner - a contributor keeps this.
    expect(screen.getByTestId("day-plan-item-edit-overlay")).toBeInTheDocument();
    expect(screen.queryByText("Bucket list")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders bucket list items and opens the plan dialog with prefill data", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    bucketListItemsOverride = [
      {
        id: "bucket-1",
        tripId: "trip-1",
        title: "Bucket stop",
        description: "Bucket notes",
        positionText: "Central Station",
        location: { lat: 48.1372, lng: 11.5756, label: "Munich" },
        createdAt: "2026-12-01T00:00:00.000Z",
        updatedAt: "2026-12-01T00:00:00.000Z",
      },
    ];
    const fetchMock = withBucketList(async () => {
      return {
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
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByText("Bucket list")).toBeInTheDocument();
    expect(screen.getByText("Bucket stop")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to day" }));

    await waitFor(() => {
      expect(planDialogMockState.lastProps?.prefill?.bucketListItemId).toBe("bucket-1");
      expect(planDialogMockState.lastProps?.prefill?.title).toBe("Bucket stop");
      expect(planDialogMockState.lastProps?.prefill?.location?.label).toBe("Central Station");
      expect(planDialogMockState.lastProps?.prefill?.contentJson).toContain("Bucket notes");
    });

    vi.unstubAllGlobals();
  });

  it("renders a textual planned vs unplanned summary for the gantt bar", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("Planned 0m, Unplanned 24h")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows a fully planned indicator when the gantt coverage reaches 24 hours", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Previous Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  link: null,
                  checkInTime: null,
                  checkOutTime: "10:00",
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-2",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-current",
                  name: "Current Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  link: null,
                  checkInTime: "10:00",
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    expect(await screen.findByRole("heading", { name: "Day 2", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("Fully planned day")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("updates the gantt summary after saving a travel segment", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
                accommodation: {
                  id: "stay-prev",
                  name: "Previous Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  link: null,
                  checkInTime: null,
                  checkOutTime: "08:00",
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Museum",
                    fromTime: "09:00",
                    toTime: "10:00",
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
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    // This day's stay has no checkInTime, so its 16:00 block is assumed and the gaps are suppressed -
    // the caption therefore reports the planned figure and declines to put a number on the open time
    // rather than claiming 15h of hatch that the bar does not draw. The planned figure still moves,
    // which is what this test is about.
    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(
      screen.getByText("Planned 9h, Unplanned unknown until a check-in time is set"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add travel" }));
    fireEvent.click(await screen.findByTestId("segment-save"));

    await waitFor(() => {
      expect(
        screen.getByText("Planned 10h, Unplanned unknown until a check-in time is set"),
      ).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("renders overlapping gantt segments for different planned sources", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Previous Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  link: null,
                  checkInTime: null,
                  checkOutTime: "10:00",
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-2",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "item-1",
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
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });
    const segments = screen.getAllByTestId("trip-day-gantt-segment");
    expect(segments.some((segment) => segment.getAttribute("data-kind") === "planItem")).toBe(true);
    expect(segments.some((segment) => segment.getAttribute("data-kind") === "accommodation")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("colors travel segments in orange", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-2",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-prev",
                  name: "Previous Hotel",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  link: null,
                  checkInTime: null,
                  checkOutTime: "08:00",
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
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
                travelSegments: [
                  {
                    id: "segment-1",
                    fromItemType: "dayPlanItem",
                    fromItemId: "item-1",
                    toItemType: "accommodation",
                    toItemId: "stay-prev",
                    transportType: "car",
                    durationMinutes: 60,
                    distanceKm: null,
                    linkUrl: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    const segments = screen.getAllByTestId("trip-day-gantt-segment");
    expect(segments.some((segment) => segment.getAttribute("data-kind") === "travel")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("renders a day plan time-range chip as HH:mm - HH:mm", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Morning walk",
                    fromTime: "09:00",
                    toTime: "10:15",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan details" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("09:00 - 10:15")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders legacy day plan items without times without showing a chip", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
                dayPlanItems: [
                  {
                    id: "item-legacy",
                    title: "Legacy walk",
                    fromTime: null,
                    toTime: null,
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy details" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getAllByText("Legacy walk").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d{2}:\d{2}\s-\s\d{2}:\d{2}/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders hotel time ranges for previous and current night accommodations", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: 20000,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 10000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Previous Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 10000,
                  link: null,
                  checkInTime: null,
                  checkOutTime: "09:30",
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-2",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 10000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-current",
                  name: "Current Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 10000,
                  link: null,
                  checkInTime: "16:30",
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });
    expect(screen.getByText("00:00 - 09:30")).toBeInTheDocument();
    expect(screen.getByText("16:30 - 24:00")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows previous and next navigation links for a middle day based on chronological order", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-03T00:00:00.000Z",
              dayCount: 3,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-next",
                date: "2026-12-03T00:00:00.000Z",
                dayIndex: 3,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-middle",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-prev",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-middle" />);

    expect(await screen.findByRole("heading", { name: "Day 2", level: 5 })).toBeInTheDocument();

    const previousLink = screen.getByRole("link", { name: "Go to previous day" });
    const nextLink = screen.getByRole("link", { name: "Go to next day" });

    // Story 6.11: the chevrons carry no visible label, so the test ids are the only handle on which
    // side each one is. Tying the id to the accessible name here is what catches a left/right swap -
    // mirrored chevrons read as correct in a screenshot and only the hrefs disagree.
    expect(screen.getByTestId("day-hero-prev")).toBe(previousLink);
    expect(screen.getByTestId("day-hero-next")).toBe(nextLink);
    expect(previousLink).toHaveAttribute("href", "/trips/trip-1/days/day-prev");
    expect(nextLink).toHaveAttribute("href", "/trips/trip-1/days/day-next");

    // AC3: the toolbar band below the hero is gone, not emptied. Asserting the chevrons live inside
    // day-hero is the positive form of that claim - deleting the old assertions only proved the old
    // labels vanished, which an empty leftover Box would also satisfy.
    const hero = screen.getByTestId("day-hero");
    expect(hero).toContainElement(previousLink);
    expect(hero).toContainElement(nextLink);
    expect(screen.queryAllByLabelText(/Go to (previous|next) day/)).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("renders localized previous and next chevron labels in German", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-03T00:00:00.000Z",
              dayCount: 3,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-next",
                date: "2026-12-03T00:00:00.000Z",
                dayIndex: 3,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-middle",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-prev",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-middle" />, { language: "de" });

    expect(await screen.findByRole("heading", { name: "Tag 2", level: 5 })).toBeInTheDocument();

    const previousLink = screen.getByRole("link", { name: "Zum vorherigen Tag wechseln" });
    const nextLink = screen.getByRole("link", { name: "Zum nächsten Tag wechseln" });

    expect(previousLink).toHaveAttribute("href", "/trips/trip-1/days/day-prev");
    expect(nextLink).toHaveAttribute("href", "/trips/trip-1/days/day-next");

    // The two strings a German user now needs in order to find print at all. Nothing in this repo
    // compares the EN and DE key sets, so a missing or wrong DE value is only caught here.
    const overflow = screen.getByRole("button", { name: "Weitere Aktionen" });
    await userEvent.click(overflow);
    expect(await screen.findByRole("menuitem", { name: "Tag drucken" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders no previous chevron on the first day and no next chevron on the last day", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-03T00:00:00.000Z",
              dayCount: 3,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-prev",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-middle",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-next",
                date: "2026-12-03T00:00:00.000Z",
                dayIndex: 3,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-prev" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    // Story 6.11 replaced the disabled buttons with nothing at all. Absence has to be asserted three
    // ways because a regression could bring any one of them back: the test id, the accessible name in
    // either role a control might take, and the name unbound from role entirely.
    expect(screen.queryByTestId("day-hero-prev")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to previous day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to previous day" })).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("Go to previous day")).toHaveLength(0);
    expect(screen.getByTestId("day-hero-next")).toHaveAttribute("href", "/trips/trip-1/days/day-middle");

    rerender(<Providers><TripDayView tripId="trip-1" dayId="day-next" /></Providers>);

    expect(await screen.findByRole("heading", { name: "Day 3", level: 5 })).toBeInTheDocument();
    expect(screen.getByTestId("day-hero-prev")).toHaveAttribute("href", "/trips/trip-1/days/day-middle");
    expect(screen.queryByTestId("day-hero-next")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to next day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to next day" })).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("Go to next day")).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("renders destination day details when day route target changes", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-03T00:00:00.000Z",
              dayCount: 3,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-prev",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-middle",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "plan-mid",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Middle day activity" }] }],
                    }),
                    linkUrl: null,
                    location: null,
                  },
                ],
              },
              {
                id: "day-next",
                date: "2026-12-03T00:00:00.000Z",
                dayIndex: 3,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "plan-next",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Next day activity" }] }],
                    }),
                    linkUrl: null,
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-middle" />);

    expect((await screen.findAllByText("Middle day activity")).length).toBeGreaterThan(0);

    rerender(<Providers><TripDayView tripId="trip-1" dayId="day-next" /></Providers>);

    expect((await screen.findAllByText("Next day activity")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Middle day activity")).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("renders formatted day plan content including italic text and inline images", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      return {
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
                dayPlanItems: [
                  {
                    id: "plan-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Italic activity", marks: [{ type: "italic" }] }],
                        },
                        {
                          type: "image",
                          attrs: { src: "https://images.example.com/day-1.webp", alt: "Plan image" },
                        },
                      ],
                    }),
                    linkUrl: null,
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.getAllByText("Italic activity").some((element) => element.tagName === "EM")).toBe(true);
    expect(screen.getByAltText("Plan image")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("does not render unsafe item links as clickable anchors", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      return {
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
                dayPlanItems: [
                  {
                    id: "plan-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Unsafe link item" }] }],
                    }),
                    linkUrl: "javascript:alert(1)",
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.queryByRole("link", { name: "Open link" })).not.toBeInTheDocument();
    expect(screen.getByText("No link")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders the day view page layout for a selected day", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 12000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 12000,
                  link: null,
                  location: { lat: 48.3538, lng: 11.7861 },
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 16000,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 16000,
                  link: null,
                  location: { lat: 48.145, lng: 11.582 },
                },
                dayPlanItems: [
                  {
                    id: "plan-1",
                    title: "Museum title",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Body details" }] }],
                    }),
                    linkUrl: "https://example.com/museum",
                    location: { lat: 48.1372, lng: 11.5756 },
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));

    expect(await screen.findByTestId("trip-day-view-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("Dec 1, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to trip" })).toBeInTheDocument();
    expect(screen.getByText("Previous night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("Airport Hotel").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Museum title").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Body details").length).toBeGreaterThan(0);
    expect(screen.queryByText("Activity 1")).toBeNull();
    expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://example.com/museum");
    expect(screen.getByText("Current night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("City Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("Costs today")).toBeInTheDocument();
    expect(screen.getByTestId("day-cost-total")).toHaveTextContent("€160.00");
    expect(screen.getAllByRole("button", { name: "Edit stay" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add plan item" })).toBeInTheDocument();
    // Story 6.9: the card is the edit target and its overlay is the only control on the activity -
    // the pencil and the wrapper that existed only to hold it are gone.
    const planItemCard = screen.getByTestId("day-plan-item-card");
    expect(within(planItemCard).getByTestId("day-plan-item-edit-overlay")).toHaveAccessibleName(
      "Edit plan item: Museum title",
    );
    expect(screen.queryByTestId("day-plan-item-actions")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Delete plan item" })).toHaveLength(0);
    expect(screen.queryByTestId("plan-dialog-mode")).toBeNull();
    expect(screen.queryByTestId("plan-dialog-item-id")).toBeNull();
    expect(screen.getAllByTestId("day-map-marker")).toHaveLength(3);
    expect(screen.getByTestId("day-map-polyline")).toBeInTheDocument();

    fireEvent.click(within(planItemCard).getByTestId("day-plan-item-edit-overlay"));

    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    expect(screen.getByTestId("plan-dialog-mode")).toHaveTextContent("edit");
    expect(screen.getByTestId("plan-dialog-item-id")).toHaveTextContent("plan-1");
    expect(screen.getByTestId("plan-dialog-item-link")).toHaveTextContent("https://example.com/museum");

    vi.unstubAllGlobals();
  });

  it("excludes previous-night accommodation cost from the selected day summary while keeping overnight context visible", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 12000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 12000,
                  link: null,
                  checkOutTime: "09:00",
                  location: { lat: 48.3538, lng: 11.7861 },
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 20500,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 16000,
                  link: null,
                  checkInTime: "16:00",
                  location: { lat: 48.145, lng: 11.582 },
                },
                dayPlanItems: [
                  {
                    id: "plan-1",
                    title: "Museum title",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Body details" }] }],
                    }),
                    costCents: 4500,
                    linkUrl: "https://example.com/museum",
                    location: { lat: 48.1372, lng: 11.5756 },
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByTestId("trip-day-view-page")).toBeInTheDocument();
    expect(screen.getByText("Previous night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("Airport Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("00:00 - 09:00")).toBeInTheDocument();
    expect(screen.queryByText("Previous night: Airport Hotel")).toBeNull();
    expect(screen.getByText("Current night: City Hotel")).toBeInTheDocument();
    expect(screen.getAllByText("Museum title").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("day-cost-total")).toHaveTextContent("€205.00");
    expect(screen.queryByText("€120.00")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("shows copy previous night action when a previous-night accommodation exists", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-prev",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 12000,
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.getByRole("button", { name: "Copy previous night" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows an overwrite warning before moving activities to a populated target day", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const transferBodies: Array<{ operation: string; confirmOverwrite?: boolean }> = [];

    const tripState = {
      trip: {
        id: "trip-1",
        name: "Trip",
        accessRole: "owner" as const,
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2026-12-02T00:00:00.000Z",
        dayCount: 2,
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
          accommodation: {
            id: "stay-1",
            name: "City Hotel",
            notes: null,
            status: "planned" as const,
            costCents: 10000,
            link: null,
            checkInTime: "16:00",
            checkOutTime: "10:00",
            location: { lat: 48.145, lng: 11.582 },
          },
          dayPlanItems: [
            {
              id: "plan-1",
              title: "Museum title",
              fromTime: "09:00",
              toTime: "10:00",
              contentJson: JSON.stringify({
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Body details" }] }],
              }),
              costCents: null,
              linkUrl: null,
              location: { lat: 48.1372, lng: 11.5756 },
            },
          ],
          travelSegments: [],
        },
        {
          id: "day-2",
          date: "2026-12-02T00:00:00.000Z",
          dayIndex: 2,
          plannedCostSubtotal: 0,
          missingAccommodation: false,
          missingPlan: false,
          accommodation: {
            id: "stay-2",
            name: "Lake Hotel",
            notes: null,
            status: "booked" as const,
            costCents: 20000,
            link: null,
            checkInTime: "16:00",
            checkOutTime: "10:00",
            location: { lat: 47.0, lng: 11.0 },
          },
          dayPlanItems: [
            {
              id: "plan-2",
              title: "Target activity",
              fromTime: "12:00",
              toTime: "13:00",
              contentJson: JSON.stringify({
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Target details" }] }],
              }),
              costCents: null,
              linkUrl: null,
              location: { lat: 47.1, lng: 11.1 },
            },
          ],
          travelSegments: [],
        },
      ],
    };

    const fetchMock = withBucketList(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/auth/csrf") {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      if (url === "/api/trips/trip-1") {
        return { ok: true, status: 200, json: async () => ({ data: tripState, error: null }) };
      }
      if (url === "/api/trips/trip-1/day-plan-items/images?tripDayId=day-1") {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url.includes("/accommodations/images?tripDayId=day-1")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url.includes("/accommodations/images?tripDayId=day-2")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url === "/api/trips/trip-1/days/day-1/route") {
        return { ok: true, status: 200, json: async () => ({ data: { route: { polyline: [[48.145, 11.582], [48.1372, 11.5756]] } }, error: null }) };
      }
      if (url === "/api/trips/trip-1/day-activity-transfer" && init?.method === "POST") {
        transferBodies.push(JSON.parse(String(init.body)) as { operation: string; confirmOverwrite?: boolean });
        return { ok: true, status: 200, json: async () => ({ data: { operation: "move" }, error: null }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByText("Museum title")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move activities" }));
    expect(await screen.findByRole("heading", { name: "Move activities", level: 2 })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Target day"), "day-2");

    expect(screen.getByText("Activities already exist on the selected day. Moving will delete them before reassignment.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm move" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm move" }));
    await waitFor(() => expect(transferBodies).toHaveLength(1));
    expect(transferBodies[0]).toMatchObject({ operation: "move", confirmOverwrite: true });

    vi.unstubAllGlobals();
  });

  it("submits move without overwrite confirmation for an empty target day", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";

    const transferBodies: Array<{ operation: string; confirmOverwrite?: boolean }> = [];
    const tripState = {
      trip: {
        id: "trip-1",
        name: "Trip",
        accessRole: "owner" as const,
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2026-12-02T00:00:00.000Z",
        dayCount: 2,
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
          dayPlanItems: [
            {
              id: "plan-1",
              title: "Source activity",
              fromTime: "09:00",
              toTime: "10:00",
              contentJson: JSON.stringify({
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Source details" }] }],
              }),
              costCents: null,
              linkUrl: null,
              location: null,
            },
          ],
          travelSegments: [],
        },
        {
          id: "day-2",
          date: "2026-12-02T00:00:00.000Z",
          dayIndex: 2,
          plannedCostSubtotal: 0,
          missingAccommodation: false,
          missingPlan: false,
          accommodation: null,
          dayPlanItems: [],
          travelSegments: [],
        },
      ],
    };

    const fetchMock = withBucketList(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/auth/csrf") {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      if (url === "/api/trips/trip-1") {
        return { ok: true, status: 200, json: async () => ({ data: tripState, error: null }) };
      }
      if (url === "/api/trips/trip-1/day-plan-items/images?tripDayId=day-1") {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url.includes("/accommodations/images?tripDayId=day-1")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url === "/api/trips/trip-1/days/day-1/route") {
        return { ok: true, status: 200, json: async () => ({ data: { route: { polyline: [] } }, error: null }) };
      }
      if (url === "/api/trips/trip-1/day-activity-transfer" && init?.method === "POST") {
        transferBodies.push(JSON.parse(String(init.body)) as { operation: string; confirmOverwrite?: boolean });
        return { ok: true, status: 200, json: async () => ({ data: { operation: "move" }, error: null }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move activities" }));
    await userEvent.selectOptions(screen.getByLabelText("Target day"), "day-2");
    await userEvent.click(screen.getByRole("button", { name: "Confirm move" }));

    await waitFor(() => expect(transferBodies).toHaveLength(1));
    expect(transferBodies[0]).toMatchObject({ operation: "move", confirmOverwrite: false });

    vi.unstubAllGlobals();
  });

  it("refreshes the day view after swapping activities and keeps accommodation rendering intact", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";

    const dayOne = {
      id: "day-1",
      date: "2026-12-01T00:00:00.000Z",
      dayIndex: 1,
      plannedCostSubtotal: 0,
      missingAccommodation: false,
      missingPlan: false,
      accommodation: {
        id: "stay-1",
        name: "City Hotel",
        notes: null,
        status: "planned" as const,
        costCents: 10000,
        link: null,
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: { lat: 48.145, lng: 11.582 },
      },
      dayPlanItems: [
        {
          id: "plan-1",
          title: "Museum title",
          fromTime: "09:00",
          toTime: "10:00",
          contentJson: JSON.stringify({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Body details" }] }],
          }),
          costCents: null,
          linkUrl: null,
          location: { lat: 48.1372, lng: 11.5756 },
        },
      ],
      travelSegments: [],
    };
    const dayTwo = {
      id: "day-2",
      date: "2026-12-02T00:00:00.000Z",
      dayIndex: 2,
      plannedCostSubtotal: 0,
      missingAccommodation: false,
      missingPlan: false,
      accommodation: {
        id: "stay-2",
        name: "Lake Hotel",
        notes: null,
        status: "booked" as const,
        costCents: 20000,
        link: null,
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: { lat: 47.0, lng: 11.0 },
      },
      dayPlanItems: [
        {
          id: "plan-2",
          title: "Target activity",
          fromTime: "12:00",
          toTime: "13:00",
          contentJson: JSON.stringify({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Target details" }] }],
          }),
          costCents: null,
          linkUrl: null,
          location: { lat: 47.1, lng: 11.1 },
        },
      ],
      travelSegments: [],
    };

    let tripState = {
      trip: {
        id: "trip-1",
        name: "Trip",
        accessRole: "owner" as const,
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2026-12-02T00:00:00.000Z",
        dayCount: 2,
        accommodationCostTotalCents: null,
        heroImageUrl: null,
      },
      days: [dayOne, dayTwo],
    };

    const fetchMock = withBucketList(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/auth/csrf") {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      if (url === "/api/trips/trip-1") {
        return { ok: true, status: 200, json: async () => ({ data: tripState, error: null }) };
      }
      if (url === "/api/trips/trip-1/day-plan-items/images?tripDayId=day-1") {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url.includes("/accommodations/images?tripDayId=day-1")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url.includes("/accommodations/images?tripDayId=day-2")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url === "/api/trips/trip-1/days/day-1/route") {
        return { ok: true, status: 200, json: async () => ({ data: { route: { polyline: [[48.145, 11.582], [48.1372, 11.5756]] } }, error: null }) };
      }
      if (url === "/api/trips/trip-1/day-activity-transfer" && init?.method === "POST") {
        tripState = {
          ...tripState,
          days: [
            { ...dayOne, dayPlanItems: [dayTwo.dayPlanItems[0]] },
            { ...dayTwo, dayPlanItems: [dayOne.dayPlanItems[0]] },
          ],
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              operation: "swap",
              firstDayItemIds: ["plan-2"],
              secondDayItemIds: ["plan-1"],
            },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect(await screen.findByText("Museum title")).toBeInTheDocument();
    expect(screen.getAllByText("City Hotel").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Swap activities" }));
    expect(await screen.findByRole("heading", { name: "Swap activities", level: 2 })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Target day"), "day-2");
    await userEvent.click(screen.getByRole("button", { name: "Confirm swap" }));

    await waitFor(() => expect(screen.queryByText("Museum title")).toBeNull());
    expect(screen.getAllByText("Target activity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("City Hotel").length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("hides copy previous night action when a current-night accommodation already exists", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-prev",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 12000,
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 15000,
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.queryByRole("button", { name: "Copy previous night" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("hides copy previous night action when there is no previous-night accommodation", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-prev",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: true,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.queryByRole("button", { name: "Copy previous night" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("updates the current-night accommodation after copying the previous night", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      if (url.includes("/accommodations/copy")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accommodation: {
                id: "stay-current",
                tripDayId: "day-1",
                name: "Copied Stay",
                notes: "Same notes",
                status: "planned",
                costCents: null,
                link: "https://example.com/copy",
                checkInTime: "15:00",
                checkOutTime: "11:00",
                location: { lat: 48.1372, lng: 11.5756, label: "Old Town" },
              },
            },
            error: null,
          }),
        };
      }
      if (url.includes("/accommodations/images") || url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/api/trips/trip-1")) {
        return {
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
                accommodationCostTotalCents: null,
                heroImageUrl: null,
              },
              days: [
                {
                  id: "day-prev",
                  date: "2026-11-30T00:00:00.000Z",
                  dayIndex: 0,
                  plannedCostSubtotal: 0,
                  missingAccommodation: false,
                  missingPlan: false,
                  accommodation: {
                    id: "stay-prev",
                    name: "Previous Stay",
                    notes: null,
                    status: "booked",
                    costCents: 12000,
                    link: null,
                    checkInTime: null,
                    checkOutTime: null,
                    location: null,
                  },
                  dayPlanItems: [],
                },
                {
                  id: "day-1",
                  date: "2026-12-01T00:00:00.000Z",
                  dayIndex: 1,
                  plannedCostSubtotal: 0,
                  missingAccommodation: false,
                  missingPlan: false,
                accommodation: null,
                  dayPlanItems: [],
                },
              ],
            },
            error: null,
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: null, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Copy previous night" }));

    await waitFor(() => expect(screen.getAllByText("Copied Stay").length).toBeGreaterThan(0));

    vi.unstubAllGlobals();
  });

  it("renders image mini-strips with +N indicator for gallery images", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [{ id: "acc-img-1", imageUrl: "/uploads/a1.webp", sortOrder: 1 }],
            },
            error: null,
          }),
        };
      }
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [
                { id: "plan-img-1", dayPlanItemId: "item-1", imageUrl: "/uploads/p1.webp", sortOrder: 1 },
                { id: "plan-img-2", dayPlanItemId: "item-1", imageUrl: "/uploads/p2.webp", sortOrder: 2 },
                { id: "plan-img-3", dayPlanItemId: "item-1", imageUrl: "/uploads/p3.webp", sortOrder: 3 },
                { id: "plan-img-4", dayPlanItemId: "item-1", imageUrl: "/uploads/p4.webp", sortOrder: 4 },
              ],
            },
            error: null,
          }),
        };
      }
      return {
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
              accommodationCostTotalCents: 10000,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 10000,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-1",
                  name: "Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 10000,
                  link: null,
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }],
                    }),
                    linkUrl: null,
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await waitFor(() => {
      expect(screen.getByText("+1")).toBeInTheDocument();
    });
    expect(screen.getAllByAltText(/Gallery thumbnail|Hotel|Day timeline/i).length).toBeGreaterThanOrEqual(4);

    vi.unstubAllGlobals();
  });

  it("renders previous-night accommodation gallery images", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/accommodations/images") && url.includes("accommodationId=stay-prev")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [{ id: "prev-img-1", imageUrl: "/uploads/prev.webp", sortOrder: 1 }],
            },
            error: null,
          }),
        };
      }
      if (url.includes("/accommodations/images") && url.includes("accommodationId=stay-current")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [],
            },
            error: null,
          }),
        };
      }
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [],
            },
            error: null,
          }),
        };
      }
      return {
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
              accommodationCostTotalCents: 20000,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 10000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Previous Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 10000,
                  link: null,
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-2",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 10000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-current",
                  name: "Current Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 10000,
                  link: null,
                  location: null,
                },
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });
    await waitFor(() => {
      expect(screen.getByAltText(/Previous Hotel 1/i)).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("deletes a day plan item from dialog action and updates the visible list", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const items = [
      {
        id: "plan-1",
        tripDayId: "day-1",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
        }),
        linkUrl: null,
        location: null,
        createdAt: "2026-12-01T09:00:00.000Z",
      },
    ];

    const fetchMock = withBucketList(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.includes("/day-plan-items") && method === "DELETE") {
        items.splice(0, items.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { deleted: true }, error: null }),
        };
      }

      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: items.map((item) => ({
                  id: item.id,
                  contentJson: item.contentJson,
                  linkUrl: item.linkUrl,
                  location: item.location,
                })),
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: "Delete plan item" })).toHaveLength(0);
    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Delete plan item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );

    await waitFor(() => expect(screen.queryAllByText("Museum visit")).toHaveLength(0));
    expect(await screen.findByText("No day details yet. Add a stay or day plan item to begin.")).toBeInTheDocument();
    expect(screen.getByTestId("day-cost-total")).toHaveTextContent("€0.00");
    vi.unstubAllGlobals();
  });

  it("opens the plan edit dialog from query params", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "open=plan&itemId=plan-1";
    const fetchMock = withBucketList(async () => {
      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 12000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 16000,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "plan-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
                    }),
                    linkUrl: "https://example.com/museum",
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));

    expect(planDialogMockState.lastProps?.mode).toBe("edit");
    expect(planDialogMockState.lastProps?.item?.id).toBe("plan-1");
    vi.unstubAllGlobals();
  });

  it("renders persisted day image and supports replace/remove actions", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";

    const state = {
      imageUrl: "https://example.com/day-initial.webp" as string | null,
      note: "Flight from FRA to SIN" as string | null,
    };

    const fetchMock = withBucketList(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.includes("/days/day-1/image") && method === "POST") {
        const formData = init?.body as FormData;
        const noteValue = formData?.get("note");
        state.note = typeof noteValue === "string" && noteValue.trim().length > 0 ? noteValue : null;
        state.imageUrl = "/uploads/trips/trip-1/days/day-1/day.webp";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              day: { id: "day-1", imageUrl: state.imageUrl, note: state.note, updatedAt: "2026-12-01T00:00:00.000Z" },
            },
            error: null,
          }),
        };
      }

      if (url.includes("/days/day-1/image") && method === "PATCH") {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { imageUrl: string | null; note: string | null };
        state.imageUrl = parsed.imageUrl;
        state.note = parsed.note;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              day: { id: "day-1", imageUrl: state.imageUrl, note: state.note, updatedAt: "2026-12-01T00:00:00.000Z" },
            },
            error: null,
          }),
        };
      }

      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                imageUrl: null,
                note: null,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                imageUrl: state.imageUrl,
                note: state.note,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    // The day photo is the hero background now, not an <img>: DESIGN.md treats it as decorative
    // (the adjacent title already names the day), so it carries no alt to query by.
    const hero = await screen.findByTestId("day-hero");
    expect(getComputedStyle(hero).backgroundImage).toContain("https://example.com/day-initial.webp");
    expect(screen.getByRole("heading", { name: "Day 1: Flight from FRA to SIN", level: 5 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit day details" }));

    // AC7: the dialog previews the CURRENT day image. Before Story 7.7 it rendered only the selected
    // file's name, so a non-sighted owner had no way to confirm an upload had landed. The hero is
    // decorative; this editing surface is not, so the preview carries a real alt string.
    const currentPreview = await screen.findByAltText("Current day image");
    expect(currentPreview).toHaveAttribute("src", expect.stringContaining("day-initial.webp"));

    const fileInput = await screen.findByLabelText("Day image");
    const file = new File([new Uint8Array([1, 2, 3])], "day.webp", { type: "image/webp" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Day note"), { target: { value: "Flight from MUC to SIN" } });
    fireEvent.click(screen.getByRole("button", { name: "Save day details" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/days/day-1/image"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    await waitFor(() =>
      expect(getComputedStyle(screen.getByTestId("day-hero")).backgroundImage).toContain(
        "/uploads/trips/trip-1/days/day-1/day.webp",
      ),
    );
    // findBy, not getBy: the day-details dialog aria-hides the rest of the app while it is open, and
    // the hero background settles before the dialog unmounts.
    expect(await screen.findByRole("heading", { name: "Day 1: Flight from MUC to SIN", level: 5 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit day details" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    // Removing the image falls the hero back to the placeholder rather than removing an element.
    await waitFor(() =>
      expect(getComputedStyle(screen.getByTestId("day-hero")).backgroundImage).toContain("world-map-placeholder.svg"),
    );
    expect(screen.getByText("No day image selected yet.")).toBeInTheDocument();
    // ...and the preview goes with it (AC7's other half).
    expect(screen.queryByAltText("Current day image")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("renders routed polyline from day route API for two-point days", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";

    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/trips/trip-1/days/day-1/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              points: [
                { id: "prev", kind: "previousStay", lat: 48.3538, lng: 11.7861 },
                { id: "curr", kind: "currentStay", lat: 48.145, lng: 11.582 },
              ],
              route: {
                polyline: [
                  [48.3538, 11.7861],
                  [48.24, 11.67],
                  [48.145, 11.582],
                ],
                distanceMeters: 12000,
                durationSeconds: 1600,
              },
            },
            error: null,
          }),
        };
      }

      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 0,
                  link: null,
                  location: { lat: 48.3538, lng: 11.7861 },
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 0,
                  link: null,
                  location: { lat: 48.145, lng: 11.582 },
                },
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/trips/trip-1/days/day-1/route"),
        expect.objectContaining({ method: "GET" }),
      ),
    );
    expect(screen.getByTestId("day-map-polyline")).toHaveAttribute(
      "data-positions",
      JSON.stringify([
        [48.3538, 11.7861],
        [48.24, 11.67],
        [48.145, 11.582],
      ]),
    );
    vi.unstubAllGlobals();
  });

  it("shows routing error state while preserving map markers", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";

    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/trips/trip-1/days/day-1/route")) {
        return {
          ok: false,
          status: 502,
          json: async () => ({
            data: null,
            error: {
              code: "routing_unavailable",
              message: "Routing service unavailable",
              details: {
                fallbackPolyline: [
                  [48.3538, 11.7861],
                  [48.145, 11.582],
                ],
              },
            },
          }),
        };
      }

      return {
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
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 0,
                  link: null,
                  location: { lat: 48.3538, lng: 11.7861 },
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 0,
                  link: null,
                  location: { lat: 48.145, lng: 11.582 },
                },
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(await screen.findByText("Routing unavailable")).toBeInTheDocument();
    expect(screen.getAllByTestId("day-map-marker")).toHaveLength(2);
    expect(screen.getByTestId("day-map-polyline")).toHaveAttribute(
      "data-positions",
      JSON.stringify([
        [48.3538, 11.7861],
        [48.145, 11.582],
      ]),
    );
    vi.unstubAllGlobals();
  });

  it("opens a map marker dialog with plan item details", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const user = userEvent.setup();

    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { images: [{ id: "img-1", dayPlanItemId: "plan-1", imageUrl: "/plan-1.jpg", sortOrder: 0 }] },
            error: null,
          }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { route: { polyline: [[48.1, 11.5], [48.2, 11.6]] } }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-02T00:00:00.000Z",
              dayCount: 1,
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
                dayPlanItems: [
                  {
                    id: "plan-1",
                    title: "Museum visit",
                    fromTime: null,
                    toTime: null,
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan details" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: { lat: 48.1, lng: 11.5 },
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    const markers = await screen.findAllByTestId("day-map-marker");
    await user.click(markers[0]);

    expect(await screen.findAllByText("Plan details")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Museum visit 1" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders travel segments between timeline items with time tags", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      return {
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
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Prev Stay",
                  notes: null,
                  status: "planned",
                  costCents: null,
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-2",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-current",
                  name: "Current Stay",
                  notes: null,
                  status: "planned",
                  costCents: null,
                  link: null,
                  checkInTime: "16:00",
                  checkOutTime: "09:30",
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Morning",
                    fromTime: "09:00",
                    toTime: "10:00",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                  {
                    id: "item-2",
                    title: "Noon",
                    fromTime: "12:00",
                    toTime: "23:30",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan 2" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                ],
                travelSegments: [
                  {
                    id: "segment-1",
                    fromItemType: "accommodation",
                    fromItemId: "stay-prev",
                    toItemType: "dayPlanItem",
                    toItemId: "item-1",
                    transportType: "car",
                    durationMinutes: 45,
                    distanceKm: null,
                    linkUrl: null,
                  },
                  {
                    id: "segment-2",
                    fromItemType: "dayPlanItem",
                    fromItemId: "item-1",
                    toItemType: "dayPlanItem",
                    toItemId: "item-2",
                    transportType: "car",
                    durationMinutes: 30,
                    distanceKm: null,
                    linkUrl: null,
                  },
                  {
                    id: "segment-3",
                    fromItemType: "dayPlanItem",
                    fromItemId: "item-2",
                    toItemType: "accommodation",
                    toItemId: "stay-current",
                    transportType: "car",
                    durationMinutes: 90,
                    distanceKm: null,
                    linkUrl: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });
    expect(screen.getAllByTestId("travel-segment")).toHaveLength(3);
    expect(screen.getAllByText("Edit travel")).toHaveLength(3);
    expect(screen.getByText("10:00 - 10:45")).toBeInTheDocument();
    expect(screen.getByText("10:00 - 10:30")).toBeInTheDocument();
    expect(screen.getByText("23:30 - 24:00")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("updates travel segment time tags after save without full refresh", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      return {
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
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Prev Stay",
                  notes: null,
                  status: "planned",
                  costCents: null,
                  link: null,
                  checkInTime: null,
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems: [],
              },
              {
                id: "day-2",
                date: "2026-12-02T00:00:00.000Z",
                dayIndex: 2,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-current",
                  name: "Current Stay",
                  notes: null,
                  status: "planned",
                  costCents: null,
                  link: null,
                  checkInTime: "16:00",
                  checkOutTime: "09:30",
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Morning",
                    fromTime: "09:00",
                    toTime: "10:00",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                  {
                    id: "item-2",
                    title: "Noon",
                    fromTime: "12:00",
                    toTime: "23:30",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan 2" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                ],
                travelSegments: [
                  {
                    id: "segment-1",
                    fromItemType: "accommodation",
                    fromItemId: "stay-prev",
                    toItemType: "dayPlanItem",
                    toItemId: "item-1",
                    transportType: "car",
                    durationMinutes: 45,
                    distanceKm: null,
                    linkUrl: null,
                  },
                  {
                    id: "segment-2",
                    fromItemType: "dayPlanItem",
                    fromItemId: "item-1",
                    toItemType: "dayPlanItem",
                    toItemId: "item-2",
                    transportType: "car",
                    durationMinutes: 30,
                    distanceKm: null,
                    linkUrl: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });
    expect(screen.getByText("10:00 - 10:30")).toBeInTheDocument();

    const segments = screen.getAllByTestId("travel-segment");
    const targetSegment = segments.find(
      (segment) => segment.getAttribute("data-from-id") === "item-1" && segment.getAttribute("data-to-id") === "item-2",
    );
    expect(targetSegment).toBeTruthy();

    fireEvent.click(within(targetSegment as HTMLElement).getByRole("button", { name: "Edit travel" }));
    fireEvent.click(await screen.findByTestId("segment-save"));
    await screen.findByText("10:00 - 11:00");
    vi.unstubAllGlobals();
  });

  it("hides travel segment time tags when the previous item has no end time", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }
      return {
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
                accommodation: {
                  id: "stay-current",
                  name: "Current Stay",
                  notes: null,
                  status: "planned",
                  costCents: null,
                  link: null,
                  checkInTime: "16:00",
                  checkOutTime: "09:30",
                  location: null,
                },
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Open Slot",
                    fromTime: "10:00",
                    toTime: null,
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
                    }),
                    costCents: null,
                    linkUrl: null,
                    location: null,
                  },
                ],
                travelSegments: [
                  {
                    id: "segment-1",
                    fromItemType: "dayPlanItem",
                    fromItemId: "item-1",
                    toItemType: "accommodation",
                    toItemId: "stay-current",
                    transportType: "car",
                    durationMinutes: 45,
                    distanceKm: null,
                    linkUrl: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.getAllByTestId("travel-segment")).toHaveLength(1);
    expect(screen.queryByText("10:00 - 10:45")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("opens the hero overflow menu to a print link that navigates to the day print page", async () => {
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input) => {
      const url = String(input);
      if (url.includes("/accommodations/images") || url.includes("/day-plan-items/images")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      if (url.includes("/days/day-1/route")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } }, error: null }),
        };
      }
      return {
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
                dayPlanItems: [],
                travelSegments: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Story 6.11: print moved behind the hero overflow. A closed MUI Menu is not mounted at all, so
    // nothing is queryable until the trigger is clicked - and AC3 wants the old toolbar link gone,
    // which is the `link` half of this assertion. The item is queried as a menuitem, not a link:
    // MUI puts role="menuitem" on MenuItem, which overrides the anchor's implicit role even though
    // the element it renders is still a real <a href>.
    expect(screen.queryByRole("menuitem", { name: "Print day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /print|export/i })).not.toBeInTheDocument();

    // AC6, owner half: this fixture is accessRole "owner", so the right slot must carry both the
    // owner-only day-image action and the overflow. Scoped to the header row - queried globally the
    // overflow could drift back below the hero and this would still pass.
    const headerRow = screen.getByTestId("day-hero-header-row");
    expect(within(headerRow).getByRole("button", { name: "Edit day details" })).toBeInTheDocument();
    const overflow = within(headerRow).getByTestId("day-hero-overflow");
    expect(overflow).toHaveAttribute("aria-haspopup", "menu");
    expect(overflow).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(overflow);
    expect(overflow).toHaveAttribute("aria-expanded", "true");

    // Queried by the visible label, not a loose regex: an aria-label that shadowed "Print day" would
    // still match /print|export/i via "printable", leaving the label a user actually reads untested.
    const printLink = await screen.findByRole("menuitem", { name: "Print day" });
    expect(printLink.tagName).toBe("A");
    expect(printLink).toHaveAttribute("href", "/trips/trip-1/days/day-1/print");
    expect(printLink).toHaveAttribute("target", "_blank");
    expect(printLink).toHaveAttribute("rel", "noopener noreferrer");

    // Activating it must dismiss the menu; the tab it opens is a new one, so the day page stays put.
    await userEvent.click(printLink);
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Print day" })).not.toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  // --- Story 7.3: coverage panel, stat strip and gap state -------------------------------------

  const buildDayResponse = (day: Record<string, unknown>, trip: Record<string, unknown> = {}) =>
    withBucketList(async (input) => {
      const url = String(input);
      if (url.includes("/accommodations/images") || url.includes("/day-plan-items/images")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-04T00:00:00.000Z",
              dayCount: 4,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
              ...trip,
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
                dayPlanItems: [],
                travelSegments: [],
                ...day,
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

  it("renders the four coverage legend entries and a 24-hour axis", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    for (const label of ["Accommodation", "Activity", "Travel", "Open"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The swatches are the point of a legend, so assert the fills - not just that four labels exist.
    // They are read from the bar's own palette, so a colour change on the bar moves both together.
    expect(getComputedStyle(screen.getByTestId("coverage-legend-swatch-stay")).backgroundColor).toBe(
      "rgb(75, 99, 88)",
    );
    expect(getComputedStyle(screen.getByTestId("coverage-legend-swatch-activity")).backgroundColor).toBe(
      "rgb(124, 148, 131)",
    );
    expect(getComputedStyle(screen.getByTestId("coverage-legend-swatch-travel")).backgroundColor).toBe(
      "rgb(185, 178, 160)",
    );
    // The hatch must use the same 4px pitch as the default bar, not a hand-copied 3px.
    const gapSwatch = getComputedStyle(screen.getByTestId("coverage-legend-swatch-gap"));
    expect(`${gapSwatch.background}${gapSwatch.backgroundImage}`).toContain("repeating-linear-gradient");
    expect(`${gapSwatch.background}${gapSwatch.backgroundImage}`).toContain("4px");

    // The axis spans a real day, not the mockup's 08:00-22:00 sample window: stay segments run
    // 00:00 -> check-out and check-in -> 24:00, so a clamped axis would truncate them.
    const axis = screen.getByTestId("coverage-axis");
    expect(axis.textContent).toBe("00:0006:0012:0018:0024:00");

    // The tick row is aria-hidden (five bare numbers are noise read in sequence), so the domain it
    // conveys has to reach assistive tech as text.
    expect(screen.getByText("The coverage bar spans the full day, from 00:00 to 24:00.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("drops the Open legend entry when the bar renders no gap segment", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        accommodation: {
          id: "stay-1",
          name: "Quinta",
          notes: null,
          status: "booked",
          costCents: null,
          link: null,
          checkInTime: null,
          checkOutTime: null,
          location: null,
        },
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    // Gaps are suppressed for a stay with no times, so a legend key for the hatch would send the
    // reader hunting for a fill that is nowhere on the bar.
    expect(screen.queryAllByTestId("trip-day-gantt-segment").filter((s) => s.dataset.kind === "gap")).toHaveLength(0);
    expect(screen.queryByTestId("coverage-legend-swatch-gap")).not.toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders the four stat-strip cells for a populated day", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        accommodation: {
          id: "stay-1",
          name: "Quinta",
          notes: null,
          status: "booked",
          costCents: 18500,
          link: null,
          checkInTime: "16:00",
          checkOutTime: null,
          location: null,
        },
        dayPlanItems: [
          {
            id: "item-1",
            title: "Wine tasting",
            fromTime: "14:00",
            toTime: "16:00",
            contentJson: JSON.stringify({ type: "doc", content: [] }),
            costCents: 4500,
            linkUrl: null,
            location: null,
          },
        ],
        travelSegments: [
          {
            id: "segment-1",
            fromItemType: "dayPlanItem",
            fromItemId: "item-1",
            toItemType: "accommodation",
            toItemId: "stay-1",
            transportType: "car",
            durationMinutes: 130,
            distanceKm: null,
            linkUrl: null,
          },
        ],
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // All four labels, and each value asserted against its own cell - not against whichever element in
    // the document happens to carry the same text. Cell 3 in particular is the stat strip's "Spend
    // today", which is a different element from the sidebar cost card's total.
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Total travel time")).toBeInTheDocument();
    expect(screen.getByText("Spend today")).toBeInTheDocument();
    expect(screen.getByTestId("day-stat-day")).toHaveTextContent("1 / 4");
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("2h 10m");
    expect(screen.getByTestId("day-stat-spend-today")).toHaveTextContent("€230.00");
    expect(screen.getByText("Check-in Quinta")).toBeInTheDocument();
    expect(screen.getByTestId("day-stat-check-in")).toHaveTextContent("16:00");
    expect(screen.getByTestId("day-cost-total")).toHaveTextContent("€230.00");

    // An activity with a recorded cost shows it on its own card, not only in the sidebar breakdown.
    expect(screen.getByTestId("day-plan-item-cost")).toHaveTextContent("€45.00");

    vi.unstubAllGlobals();
  });

  it("renders one uniform neutral marker per activity and never a per-activity icon (AC2)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        dayPlanItems: [
          {
            id: "item-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: JSON.stringify({ type: "doc", content: [] }),
            costCents: null,
            linkUrl: null,
            location: null,
          },
          {
            id: "item-2",
            title: "Wine tasting",
            fromTime: "14:00",
            toTime: "16:00",
            contentJson: JSON.stringify({ type: "doc", content: [] }),
            costCents: null,
            linkUrl: null,
            location: null,
          },
        ],
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The data model has no activity-type field and EXPERIENCE.md forbids adding one for iconography,
    // so every activity dot must be the same 8px neutral circle - no svg, no variation by cost or
    // duration or title. Asserted structurally so an icon picker cannot be slipped in later.
    const markers = screen.getAllByTestId("activity-neutral-marker");
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      const style = getComputedStyle(marker);
      expect(style.width).toBe("8px");
      expect(style.height).toBe("8px");
      expect(style.borderRadius).toBe("50%");
      expect(style.backgroundColor).toBe("rgb(107, 103, 92)");
      expect(marker.parentElement?.querySelector("svg")).toBeNull();
    }

    vi.unstubAllGlobals();
  });

  it("shows an em dash for a stay whose check-in time is unset, not the assumed default", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        accommodation: {
          id: "stay-1",
          name: "Quinta",
          notes: null,
          status: "planned",
          costCents: null,
          link: null,
          checkInTime: null,
          checkOutTime: null,
          location: null,
        },
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    // 16:00 is the coverage bar's drawing fallback, never a claim about the booking.
    expect(screen.getByTestId("day-stat-check-in")).toHaveTextContent("—");

    vi.unstubAllGlobals();
  });

  it("flags a day with no accommodation in the stat strip and on the current-night node", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ missingAccommodation: true }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    expect(screen.getByTestId("day-stat-check-in")).toHaveTextContent("No accommodation");
    expect(screen.getByTestId("day-detail-gap-pill")).toHaveTextContent("No accommodation");

    // The pill is only half of the State Pattern: the node itself takes the warn treatment. Without
    // this, the card could silently lose its warn tones and the test would still pass.
    const currentStayCard = screen.getByTestId("timeline-current-stay");
    const warnCard = currentStayCard.querySelector<HTMLElement>('[data-testid="day-detail-gap-pill"]')
      ?.parentElement;
    expect(warnCard).toBeTruthy();
    const cardStyle = getComputedStyle(warnCard as HTMLElement);
    expect(cardStyle.backgroundColor).toBe("rgb(246, 236, 224)");
    expect(cardStyle.borderColor).toBe("rgb(227, 199, 162)");

    // Colour is never the sole carrier: the warn dot swaps the house glyph for the warning triangle.
    expect(currentStayCard.querySelectorAll("svg").length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("collapses gaps into a single oversized segment when the day has no accommodation", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        missingAccommodation: true,
        dayPlanItems: [
          {
            id: "item-1",
            title: "Museum",
            fromTime: "10:00",
            toTime: "11:00",
            contentJson: JSON.stringify({ type: "doc", content: [] }),
            costCents: null,
            linkUrl: null,
            location: null,
          },
        ],
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    // One oversized gap, not two slivers either side of the activity: the bar has to say "this day is
    // structurally incomplete", not "some minutes are free".
    const gaps = screen
      .getAllByTestId("trip-day-gantt-segment")
      .filter((segment) => segment.getAttribute("data-kind") === "gap");
    expect(gaps).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("renders one gap segment per open interval when the day has an accommodation", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
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
          {
            id: "item-1",
            title: "Museum",
            fromTime: "10:00",
            toTime: "11:00",
            contentJson: JSON.stringify({ type: "doc", content: [] }),
            costCents: null,
            linkUrl: null,
            location: null,
          },
        ],
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    const gaps = screen
      .getAllByTestId("trip-day-gantt-segment")
      .filter((segment) => segment.getAttribute("data-kind") === "gap");
    // 00:00-10:00 and 11:00-20:00, proportional to the real open time.
    expect(gaps).toHaveLength(2);

    vi.unstubAllGlobals();
  });

  it("never hatches a stay that is on record but has no check-in or check-out time", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        accommodation: {
          id: "stay-1",
          name: "Quinta",
          notes: null,
          status: "booked",
          costCents: null,
          link: null,
          checkInTime: null,
          checkOutTime: null,
          location: null,
        },
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    // Trip Overview shows no accommodation segment at all for such a stay; hatching it here would
    // have the two bars telling contradictory stories about the same day.
    const gaps = screen
      .getAllByTestId("trip-day-gantt-segment")
      .filter((segment) => segment.getAttribute("data-kind") === "gap");
    expect(gaps).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("suppresses hatching when only the check-out time is recorded, and says the open time is unknown", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        accommodation: {
          id: "stay-1",
          name: "Quinta",
          notes: null,
          status: "booked",
          costCents: null,
          link: null,
          checkInTime: null,
          checkOutTime: "10:00",
          location: null,
        },
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The two time fields are independently nullable, and only checkInTime bears on this day's bar -
    // the current stay's checkOutTime feeds the *next* day's previous-night segment. Guarding on both
    // being null let this case draw an assumed 16:00 block AND hatch the morning around it.
    const gaps = screen
      .getAllByTestId("trip-day-gantt-segment")
      .filter((segment) => segment.getAttribute("data-kind") === "gap");
    expect(gaps).toHaveLength(0);

    // The caption declines to put a figure on the open time rather than reporting hours of hatch that
    // the bar does not draw - and the "fully planned" chip stays off, since a blank bar has not earned it.
    expect(
      screen.getByText(/Unplanned unknown until a check-in time is set/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Fully planned day")).not.toBeInTheDocument();

    // The pill marks the range as approximate instead of presenting the 16:00 fallback as a booking fact.
    expect(screen.getByText("approx. 16:00 - 24:00")).toBeInTheDocument();
    expect(screen.getByTestId("day-stat-check-in")).toHaveTextContent("—");

    vi.unstubAllGlobals();
  });

  it("renders timeline photos as sharp-cornered 56px squares", async () => {
    navigationMockState.search = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/bucket-list-items")) {
        return { ok: true, status: 200, json: async () => ({ data: { items: [] }, error: null }) };
      }
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { images: [{ id: "img-1", dayPlanItemId: "item-1", imageUrl: "/uploads/a.webp", sortOrder: 0 }] },
            error: null,
          }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      return {
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
                dayPlanItems: [
                  {
                    id: "item-1",
                    title: "Museum visit",
                    fromTime: "09:00",
                    toTime: "10:00",
                    contentJson: JSON.stringify({ type: "doc", content: [] }),
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
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    // Meaning-bearing, so it keeps a real alt - nothing else on screen says which photo this is.
    const photo = await screen.findByRole("img", { name: "Day timeline 1" });
    const style = getComputedStyle(photo);
    expect(style.width).toBe("56px");
    expect(style.height).toBe("56px");
    // Photography is always sharp, independent of the radius of the card containing it.
    expect(style.borderRadius).toBe("0px");

    vi.unstubAllGlobals();
  });

  // --- Story 6.9: cost pill, whole-card edit target, header split -------------------------------

  const activityWithCost = {
    id: "item-1",
    title: "Museum visit",
    fromTime: "09:00",
    toTime: "10:00",
    contentJson: JSON.stringify({ type: "doc", content: [] }),
    costCents: 4500,
    payments: [],
    linkUrl: null,
    location: null,
  };

  it("renders the activity cost as a filled accent pill in the card head (AC1)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const costPill = screen.getByTestId("day-plan-item-cost");
    expect(costPill).toHaveTextContent("€45.00");

    // Filled accent with white text - the second badge-pill variant, distinguishable at a glance from
    // the soft time pill sitting on the same line.
    const pillStyle = getComputedStyle(costPill);
    expect(pillStyle.backgroundColor).toBe("rgb(75, 99, 88)");
    expect(pillStyle.color).toBe("rgb(255, 255, 255)");
    expect(pillStyle.borderRadius).toBe("4px");
    expect(pillStyle.fontVariantNumeric).toBe("tabular-nums");

    // Same line as the time pill, and inside the card head rather than the trailing block.
    const head = screen.getByTestId("day-plan-item-head");
    expect(within(head).getByTestId("day-plan-item-cost")).toBe(costPill);
    expect(within(head).getByText("09:00 - 10:00")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders no cost pill for an activity without a recorded cost (AC1)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [{ ...activityWithCost, costCents: null }] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    expect(screen.queryByTestId("day-plan-item-cost")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders no cost pill for a recorded cost of zero (AC1)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [{ ...activityWithCost, costCents: 0 }] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // As plain text a "€0.00" read as a footnote; as a filled accent pill it would be the loudest
    // thing in the card head, announcing a cost on an activity that has none.
    expect(screen.queryByTestId("day-plan-item-cost")).not.toBeInTheDocument();
    // Scoped to the card: the sidebar's cost roll-up legitimately shows a €0.00 total for this day.
    expect(within(screen.getByTestId("day-plan-item-card")).queryByText("€0.00")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("omits the card head entirely when it would be empty (AC1, AC12)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse(
        { dayPlanItems: [{ ...activityWithCost, fromTime: null, toTime: null, costCents: null }] },
        { accessRole: "viewer" },
      ),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // No times, no cost, and no glyph because a viewer gets none - an unconditional head would open
    // this card with a blank band the width of the card's 12px row gap.
    expect(screen.queryByTestId("day-plan-item-head")).not.toBeInTheDocument();
    // Scoped: the activity's title also appears in the map panel's stop list.
    expect(within(screen.getByTestId("day-plan-item-card")).getByText("Museum visit")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("removes the per-activity pencil button and its wrapper (AC2)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    expect(screen.queryByTestId("day-plan-item-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("day-plan-item-actions")).not.toBeInTheDocument();
    // The day-image edit action in the hero header stays.
    expect(screen.getByRole("button", { name: "Edit day details" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("opens the editor when the activity card itself is clicked (AC3)", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The card is the target, but the control is a stretched overlay covering it rather than the card
    // element itself - `role="button"` on the card would make its own contents presentational.
    const card = screen.getByTestId("day-plan-item-card");
    expect(card).not.toHaveAttribute("role");
    const overlay = within(card).getByTestId("day-plan-item-edit-overlay");
    expect(overlay.tagName.toLowerCase()).toBe("button");
    fireEvent.click(overlay);

    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    expect(screen.getByTestId("plan-dialog-mode")).toHaveTextContent("edit");
    expect(screen.getByTestId("plan-dialog-item-id")).toHaveTextContent("item-1");

    vi.unstubAllGlobals();
  });

  it("leaves the notes block selectable rather than passing its clicks to the overlay (AC3)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The rest of the card hands its clicks to the stretched overlay, and a layer that does that
    // cannot be drag-selected. The notes hold addresses and booking references, so they opt back in.
    const card = screen.getByTestId("day-plan-item-card");
    expect(getComputedStyle(within(card).getByTestId("day-plan-item-notes")).pointerEvents).toBe("auto");
    expect(getComputedStyle(screen.getByTestId("day-plan-item-head")).pointerEvents).toBe("none");

    vi.unstubAllGlobals();
  });

  it("keeps the card's own content in the accessibility tree (AC3, AC12)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // ARIA gives `button` Children Presentational: True. Had the role gone on the card, everything
    // below would have collapsed into the overlay's single accessible name - and a viewer, who gets
    // no role at all, would have heard more of the card than a contributor.
    const card = screen.getByTestId("day-plan-item-card");
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabindex");
    expect(within(card).getByText("Museum visit")).toBeInTheDocument();
    expect(within(card).getByText("09:00 - 10:00")).toBeInTheDocument();
    expect(within(card).getByTestId("day-plan-item-cost")).toHaveTextContent("€45.00");

    vi.unstubAllGlobals();
  });

  it("does not open the editor when a card thumbnail or its link action is clicked (AC3)", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [{ id: "img-1", dayPlanItemId: "item-1", imageUrl: "/uploads/plan.webp", sortOrder: 1 }],
            },
            error: null,
          }),
        };
      }
      if (url.includes("/accommodations/images")) {
        return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
      }
      return {
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
                dayPlanItems: [{ ...activityWithCost, linkUrl: "https://example.com/museum" }],
                travelSegments: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The "open link" action opens the link and nothing else. The editor's absence is read off the DOM
    // rather than off the mock's recorded props: the mock renders nothing while closed, and the props
    // are re-recorded on every render, so the DOM is the honest signal here.
    const thumbnail = await screen.findByRole("img", { name: "Day timeline 1" });
    fireEvent.click(screen.getByRole("link", { name: "Open link" }));
    expect(screen.queryByTestId("plan-dialog")).toBeNull();

    // The thumbnail opens the fullscreen viewer, and its click must not bubble into the card handler.
    // Asserted last: the viewer is a modal that aria-hides everything behind it.
    fireEvent.click(thumbnail);
    expect(screen.queryByTestId("plan-dialog")).toBeNull();
    const viewer = await screen.findByRole("dialog");
    expect(within(viewer).getByRole("img", { name: "Day timeline 1" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("makes the activity card keyboard operable with Enter (AC6)", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const overlay = screen.getByTestId("day-plan-item-edit-overlay");
    // A real `<button type="button">`, which is what makes Enter and Space the browser's job rather
    // than a hand-rolled key handler's. The previous handler tested only `event.key` and called
    // `preventDefault()` unconditionally, so a keydown bubbling up from the "open link" anchor
    // cancelled the link and opened the editor instead.
    expect(overlay.tagName.toLowerCase()).toBe("button");
    expect(overlay).toHaveAttribute("type", "button");
    // An accessible name that says which activity it edits, and a promise of what activating it does.
    expect(overlay).toHaveAccessibleName("Edit plan item: Museum visit");
    expect(overlay).toHaveAttribute("aria-haspopup", "dialog");

    overlay.focus();
    expect(overlay).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));

    vi.unstubAllGlobals();
  });

  it("makes the activity card keyboard operable with Space (AC6)", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Its own render, not a second activation in the Enter case: there the dialog is already open by
    // the time Space fires, so the assertion could not tell activation from a no-op.
    const overlay = screen.getByTestId("day-plan-item-edit-overlay");
    overlay.focus();
    await userEvent.keyboard(" ");

    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    expect(screen.getByTestId("plan-dialog-item-id")).toHaveTextContent("item-1");

    vi.unstubAllGlobals();
  });

  it("truncates a note-derived accessible name instead of reading the whole note (AC6)", async () => {
    navigationMockState.search = "";
    const longNote = "Wander the tiled backstreets of Alfama until the light goes, then find the miradouro above the cathedral and wait for it.";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        dayPlanItems: [
          {
            ...activityWithCost,
            title: null,
            contentJson: JSON.stringify({
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: longNote }] }],
            }),
          },
        ],
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // An untitled activity falls back to its flattened note for a title. The card still shows all of
    // it; the name a screen reader speaks on every focus is capped.
    const name = screen.getByTestId("day-plan-item-edit-overlay").getAttribute("aria-label") ?? "";
    expect(name.length).toBeLessThan(longNote.length);
    expect(name.startsWith("Edit plan item: Wander the tiled")).toBe(true);
    expect(name.endsWith("…")).toBe(true);

    vi.unstubAllGlobals();
  });

  it("shows a decorative, non-focusable edit glyph on the card (AC4, AC5)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({ dayPlanItems: [activityWithCost] }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const glyph = screen.getByTestId("day-plan-item-edit-glyph");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph.tagName.toLowerCase()).not.toBe("button");
    expect(glyph).not.toHaveAttribute("tabindex");
    expect(within(glyph).queryByRole("button")).toBeNull();
    // The overlay is the card's only tab stop; the glyph must not add a second one.
    expect(within(screen.getByTestId("day-plan-item-card")).getAllByRole("button")).toHaveLength(1);

    // The reveal itself is a media-query behaviour and jsdom implements no media-query matching -
    // `getComputedStyle` returns "" for any property declared inside `@media`, so asserting on the
    // cursor or the glyph's opacity here would pass whether the rules existed or not. What is
    // checkable in jsdom is that the rules were authored: the emitted stylesheet must carry all three
    // pointer branches. The rendered result is browser-verified; see the story's Dev Agent Record.
    const css = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("");
    const glyphSelector = `.${glyph.className.split(" ").find((name) => name.startsWith("day-plan-item-edit-glyph"))}`;
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain("@media (hover: none)");
    // A touchscreen laptop reports `hover: hover`, so without this branch it would never see the glyph.
    expect(css).toContain("@media (any-pointer: coarse)");
    expect(css).toContain(glyphSelector);
    // No custom cursor image on any device: the pointer affordance is the keyword, nothing else.
    expect(css).not.toContain("cursor:url(");

    vi.unstubAllGlobals();
  });

  it("gives a viewer no click-to-edit, no pointer cursor and no glyph on activity cards (AC7)", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({ dayPlanItems: [activityWithCost] }, { accessRole: "viewer" }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const card = screen.getByTestId("day-plan-item-card");
    expect(card).not.toHaveAttribute("role", "button");
    expect(card).not.toHaveAttribute("tabindex");
    expect(screen.queryByTestId("day-plan-item-edit-glyph")).not.toBeInTheDocument();
    // The control itself must be absent, not merely inert. Reading `cursor` off the card is not a
    // gate check: it is declared inside `@media (hover: hover)`, which jsdom does not apply, so that
    // assertion returned "" for an editable card too.
    expect(screen.queryByTestId("day-plan-item-edit-overlay")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button")).toBeNull();

    fireEvent.click(card);
    expect(screen.queryByTestId("plan-dialog")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("drops the hero breadcrumb and moves the trip button into the left slot (AC8)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The breadcrumb carried no test id, so its absence has to be read off what it rendered: a link
    // to the trip labelled with the trip's name, and the "/" separator beside it.
    expect(screen.queryByRole("link", { name: "Test Trip" })).not.toBeInTheDocument();
    expect(screen.queryByText("/")).not.toBeInTheDocument();

    const headerRow = screen.getByTestId("day-hero-header-row");
    const backLink = within(headerRow).getByRole("link", { name: "← Back to trip" });
    const leftSlot = within(headerRow).getByTestId("day-hero-header-left");
    expect(leftSlot).toContainElement(backLink);
    // Enlarged for touch: it is now the primary way out of this screen.
    expect(Number.parseInt(getComputedStyle(backLink).minHeight, 10)).toBeGreaterThanOrEqual(44);

    vi.unstubAllGlobals();
  });

  it("keeps the trip button in the left slot for a non-owner with no day-image action (AC8)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "contributor" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // "Edit day details" is the day-image action's actual accessible name (`trips.dayImage.editAction`)
    // and it is `isOwner`-gated, so a contributor does not get it. Naming anything else here asserts
    // the absence of an element that never existed.
    expect(screen.queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();

    const leftSlot = screen.getByTestId("day-hero-header-left");
    expect(within(leftSlot).getByRole("link", { name: "← Back to trip" })).toBeInTheDocument();
    // The row still distributes rather than centring or right-snapping the lone remaining control.
    expect(getComputedStyle(screen.getByTestId("day-hero-header-row")).justifyContent).toBe("space-between");

    vi.unstubAllGlobals();
  });

  it("no longer renders the coverage label and retitles the cost card (AC9, AC10)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    expect(screen.queryByText("Day coverage")).not.toBeInTheDocument();
    expect(screen.getByText("Costs today")).toBeInTheDocument();
    expect(screen.queryByText("Cost so far · today")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("sizes the screen-reader-only coverage description in pixels, not percent (AC11, DW-44)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // `sx={{ width: 1 }}` is MUI for `width: 100%`, not 1px. `clip` hid the text either way, but the
    // span went on occupying its container's full width in the scroll box - which is where the day
    // page's measured 25px of horizontal overflow at 390px came from. jsdom cannot measure the
    // overflow, so the unit itself is what gets pinned here.
    const style = getComputedStyle(screen.getByTestId("coverage-axis-description"));
    expect(style.width).toBe("1px");
    expect(style.height).toBe("1px");
    expect(style.position).toBe("absolute");
    expect(style.overflow).toBe("hidden");
    // Still reachable by assistive tech - the point of the recipe is invisible, not absent.
    expect(screen.getByTestId("coverage-axis-description")).toHaveTextContent(
      "The coverage bar spans the full day, from 00:00 to 24:00.",
    );

    vi.unstubAllGlobals();
  });

  // --- Story 6.11: print is a read action, not an owner action ---------------------------------

  it("gives a viewer the hero overflow and its print link without the owner-only day-image action", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "viewer" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The overflow shares the right slot with the isOwner-gated day-image action. Putting it inside
    // that branch would silently take print away from viewers and contributors - a capability loss
    // wearing a layout change's clothes, which is why this asserts both halves of the slot at once.
    const headerRow = screen.getByTestId("day-hero-header-row");
    expect(within(headerRow).queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();
    const overflow = within(headerRow).getByTestId("day-hero-overflow");

    await userEvent.click(overflow);

    const printLink = await screen.findByRole("menuitem", { name: "Print day" });
    expect(printLink).toHaveAttribute("href", "/trips/trip-1/days/day-1/print");
    expect(printLink).toHaveAttribute("target", "_blank");
    expect(printLink).toHaveAttribute("rel", "noopener noreferrer");

    vi.unstubAllGlobals();
  });
});
