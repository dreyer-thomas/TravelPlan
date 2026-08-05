// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import type { ReactNode } from "react";
import theme from "@/theme";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

// jsdom reports computed colours as `rgb(r, g, b)`; the palette stores hex. Converting here lets colour
// assertions name the token they mean instead of a literal triple nobody can trace back to the theme.
const toRgb = (hex: string) => {
  const value = parseInt(hex.replace("#", ""), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

const planDialogMockState = vi.hoisted(() => ({
  // Story 6.23. What `onMove` resolved to, recorded because a failed move is reported *inside* the
  // real dialog: the screen behind it is covered, so the message has to come back rather than be
  // rendered here. Two flat fields rather than the outcome object — `vi.hoisted` widens the state's
  // property types to `never` in this file (see `lastProps`), and a field nothing reads *into* is
  // the only shape that survives it.
  lastMoveMoved: null as boolean | null,
  lastMoveMessage: null as string | null,
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
    // Story 6.23. Recorded so a test can assert *what this screen offers the dialog* — the candidate
    // days with the current one excluded — rather than only what happens after a click.
    moveTargetDays?: { id: string; label: string }[];
    onMove?: (itemId: string, targetTripDayId: string) => Promise<{ moved: true } | { moved: false; message: string }>;
    onClose: () => void;
    onSaved: () => void;
  },
}));
const navigationMockState = vi.hoisted(() => ({
  search: "",
}));

// Story 6.13: both stay cards are now edit targets, and they open *different* dialogs - previous
// night edits yesterday's accommodation from today's screen. The mock therefore has to record which
// instance was opened; a single shared `stay-dialog` testid could not tell the two apart, and wiring
// both cards to one handler is a silent data bug no visual check catches.
const stayDialogMockState = vi.hoisted(() => ({
  current: false,
  previous: false,
}));

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: (props: { open: boolean; stayType: "current" | "previous" }) => {
    if (props.stayType === "previous") {
      stayDialogMockState.previous = props.open;
    } else {
      stayDialogMockState.current = props.open;
    }
    if (!props.open) return null;
    return <div data-testid={`stay-dialog-${props.stayType}`} />;
  },
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
    moveTargetDays?: { id: string; label: string }[];
    onMove?: (itemId: string, targetTripDayId: string) => Promise<{ moved: true } | { moved: false; message: string }>;
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
        {/*
          Story 6.23. The real dialog puts a target-day picker behind this button; the mock stands in
          for the whole picker by moving to the first candidate this screen offered, because what is
          under test here is the *screen's* half of the contract — the request, the reload and the
          sentence naming what was removed.
        */}
        {props.mode === "edit" && props.item && props.onMove && props.moveTargetDays?.length ? (
          <button
            type="button"
            onClick={() =>
              void props.onMove?.(props.item!.id, props.moveTargetDays![0].id).then((outcome) => {
                planDialogMockState.lastMoveMoved = outcome.moved;
                planDialogMockState.lastMoveMessage = outcome.moved ? null : outcome.message;
              })
            }
          >
            Move plan item
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

// Story 6.15: the day-image edit, "Move activities" and "Swap activities" are no longer buttons on
// the page - they are items inside the hero's `⋯` overflow, and a closed MUI Menu is not mounted at
// all, so nothing about them is queryable until the trigger is clicked. Every caller that used to
// do a single `getByRole("button", …)` now needs both halves, which is what this wraps.
const activateDayOverflowItem = async (name: string) => {
  await userEvent.click(screen.getByTestId("day-hero-overflow"));
  await userEvent.click(await screen.findByRole("menuitem", { name }));
};

describe("TripDayView layout", () => {
  beforeEach(() => {
    bucketListItemsOverride = null;
    stayDialogMockState.current = false;
    stayDialogMockState.previous = false;
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
    // Story 6.13: the stay control is no longer a toolbar button but the card's own overlay, so the
    // viewer gate shows up as the overlay being absent.
    expect(screen.queryByTestId("timeline-current-stay-edit-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-previous-stay-edit-overlay")).not.toBeInTheDocument();
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
    // Story 6.13: a contributor edits the stay by clicking its card, so the gate shows up as the
    // stretched overlay on the current-night card rather than a toolbar button.
    expect(screen.getByTestId("timeline-current-stay-edit-overlay")).toBeInTheDocument();
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
    // Story 6.19: the back-to-trip button left the hero for the first row of the `⋯` menu, and a
    // closed MUI Menu is not mounted, so nothing named by it is on the page until the trigger is
    // clicked. Its presence in the menu is asserted by the 6.19 block below; here the claim is that
    // the page no longer paints it anywhere on its own - which an empty leftover slot would fail.
    expect(screen.queryByRole("link", { name: "Back to trip" })).not.toBeInTheDocument();
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
    // Story 6.13: both stay cards carry their own stretched edit overlay; neither the toolbar button
    // nor the previous-night card's inline button exists any more.
    expect(screen.getByTestId("timeline-previous-stay-edit-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-current-stay-edit-overlay")).toBeInTheDocument();
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

    await activateDayOverflowItem("Move activities");
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

    await activateDayOverflowItem("Move activities");
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

    await activateDayOverflowItem("Swap activities");
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

    // Story 6.13 AC6: copy-previous is the one nested control inside a stay card, and the card around
    // it is now an edit target. `overlaidContentSx` raises real <button>s above the overlay and gives
    // them their pointer events back, so this click ran the copy and nothing else - no stay editor.
    expect(stayDialogMockState.current).toBe(false);
    expect(stayDialogMockState.previous).toBe(false);
    expect(screen.queryByTestId("stay-dialog-current")).not.toBeInTheDocument();

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
    expect(screen.getAllByAltText(/Gallery thumbnail|Hotel|Museum/i).length).toBeGreaterThanOrEqual(4);

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

  /**
   * Story 6.23 AC4 — the half of the story a repository test cannot show: after the activity has
   * gone to another day and the dialog has closed, the user is told what the move deleted.
   *
   * A silent success would be wrong here, because a travel segment carries a duration, a distance
   * and sometimes a link that someone typed.
   */
  it("moves one activity to another day and reports the travel segments the move removed", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const items = [
      {
        id: "plan-1",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
        }),
        linkUrl: null,
        location: null,
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

      if (url.includes("/day-plan-items/move") && method === "POST") {
        items.splice(0, items.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              itemId: "plan-1",
              sourceTripDayId: "day-1",
              targetTripDayId: "day-0",
              removedTravelSegmentIds: ["segment-1", "segment-2"],
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
                dayPlanItems: items,
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));

    // The candidates handed to the dialog: the trip's other day, labelled the way the day-level
    // transfer's picker labels it, with the day the user is on excluded.
    await waitFor(() =>
      expect(planDialogMockState.lastProps?.moveTargetDays).toEqual([
        { id: "day-0", label: "Day 0 · Nov 30, 2026" },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Move plan item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items/move"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ tripDayId: "day-1", itemId: "plan-1", targetTripDayId: "day-0" }),
        }),
      ),
    );

    // AC4: named, not silent — and it names the day as well as the count. The plural is a real
    // plural, not "(s)": `formatMessage` has no plural support, so the singular is its own key.
    expect(
      await screen.findByText("Activity moved to Day 0 · Nov 30, 2026. 2 travel segments removed."),
    ).toBeInTheDocument();
    // And the day the user is on has actually reloaded without it.
    await waitFor(() => expect(screen.queryAllByText("Museum visit")).toHaveLength(0));
    vi.unstubAllGlobals();
  });

  /** The move that removed nothing must not mention travel segments at all. */
  it("reports a move that removed no travel segments without naming any", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const items = [
      {
        id: "plan-1",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
        }),
        linkUrl: null,
        location: null,
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

      if (url.includes("/day-plan-items/move") && method === "POST") {
        items.splice(0, items.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              itemId: "plan-1",
              sourceTripDayId: "day-1",
              targetTripDayId: "day-0",
              removedTravelSegmentIds: [],
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
                dayPlanItems: items,
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Move plan item" }));

    expect(await screen.findByText("Activity moved to Day 0 · Nov 30, 2026.")).toBeInTheDocument();
    expect(screen.queryByText(/travel segment/)).toBeNull();
    vi.unstubAllGlobals();
  });

  /**
   * One removed segment reads "1 travel segment removed", not "1 travel segment(s) removed":
   * `formatMessage` has no plural support, so every count-bearing string in this codebase carries
   * its own singular twin. One is also the common case here — an activity in the middle of a day has
   * two neighbours, one at either end has one.
   */
  it("names a single removed travel segment in the singular", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const items = [
      {
        id: "plan-1",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
        }),
        linkUrl: null,
        location: null,
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

      if (url.includes("/day-plan-items/move") && method === "POST") {
        items.splice(0, items.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              itemId: "plan-1",
              sourceTripDayId: "day-1",
              targetTripDayId: "day-0",
              removedTravelSegmentIds: ["segment-1"],
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
                dayPlanItems: items,
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Move plan item" }));

    expect(
      await screen.findByText("Activity moved to Day 0 · Nov 30, 2026. 1 travel segment removed."),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  /**
   * A failed move is reported by the dialog, not by this screen: the dialog stays open on failure and
   * covers the page, so an alert rendered here is one the user cannot read. The specific reason
   * travels back instead — "your session has expired" and "please try again" ask for different
   * things, and only one of them can work.
   */
  it("hands a failed move's reason back to the dialog instead of alerting behind it", async () => {
    planDialogMockState.lastProps = null;
    planDialogMockState.lastMoveMoved = null;
    planDialogMockState.lastMoveMessage = null;
    navigationMockState.search = "";

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

      if (url.includes("/day-plan-items/move") && method === "POST") {
        return {
          ok: false,
          status: 403,
          json: async () => ({ data: null, error: { code: "unauthorized", message: "no" } }),
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
                dayPlanItems: [
                  {
                    id: "plan-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
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

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Move plan item" }));

    await waitFor(() => expect(planDialogMockState.lastMoveMoved).toBe(false));
    // A reason, and the specific one the API gave — not this screen's generic fallback.
    expect(planDialogMockState.lastMoveMessage).toBe("Authentication required. Please sign in.");
    // Nothing was announced on this screen: no success line, and no error alert stranded behind the
    // open dialog.
    expect(screen.queryByText(/Activity moved to/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // The activity is still where it was — a failed move moves nothing.
    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  /**
   * Story 6.23 AC6, the half a repository test cannot reach. The delete is optimistic and nothing
   * reloads the day afterwards, so the segments the server removed have to leave client state too —
   * otherwise "Travel time" keeps summing minutes for an activity that is gone, which is the exact
   * defect AC6 exists to close, just moved from the database into the session.
   */
  it("stops counting a deleted activity's travel time without a reload", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let deleteCalls = 0;

    const dayPlanItems = [
      {
        id: "plan-1",
        title: "Museum visit",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
        costCents: null,
        linkUrl: null,
        location: null,
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
        deleteCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { deleted: true, removedTravelSegmentIds: ["segment-1"] },
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
                  name: "Quinta",
                  notes: null,
                  status: "booked",
                  costCents: null,
                  link: null,
                  checkInTime: "16:00",
                  checkOutTime: null,
                  location: null,
                },
                dayPlanItems,
                travelSegments: [
                  {
                    id: "segment-1",
                    fromItemType: "dayPlanItem",
                    fromItemId: "plan-1",
                    toItemType: "accommodation",
                    toItemId: "stay-1",
                    transportType: "car",
                    durationMinutes: 130,
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
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("2h 10m");

    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Delete plan item" }));

    await waitFor(() => expect(deleteCalls).toBe(1));
    // The 130 minutes went with the activity. Before this, they stayed on screen for the rest of the
    // session because nothing reloads the day after a delete.
    await waitFor(() => expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("0m"));

    confirmSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  /**
   * Story 6.24 AC5. The activity dialog's delete lost its label and became a trash glyph, which makes
   * it faster to reach and easier to hit — so the confirmation standing between it and the deletion
   * stops being a formality and becomes the thing that keeps the glyph honest.
   *
   * It lives here rather than in the dialog because it always did: `handleDeletePlan` asks, and only
   * then calls the API. This asserts the *declined* half, which nothing covered — the accepted half
   * is the test above. Without it, the confirmation could be dropped entirely and every existing test
   * (all of which answer "yes") would still pass.
   */
  it("deletes nothing when the confirmation is declined", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    let deleteCalls = 0;

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
        deleteCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { deleted: true, removedTravelSegmentIds: [] }, error: null }),
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

    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    fireEvent.click(screen.getAllByTestId("day-plan-item-edit-overlay")[0]);
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Delete plan item" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("Delete this plan item?"));
    expect(deleteCalls).toBe(0);
    // The optimistic removal is inside the confirmed branch, so the activity never left the screen.
    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);

    confirmSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  /**
   * AC8. A viewer cannot reach the activity dialog at all, so the guard that matters is the one on
   * the props: no handler and no candidate days means the dialog cannot render the action even if it
   * is opened some other way.
   */
  it("withholds the move handler from a viewer", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "open=plan&itemId=plan-1";

    const fetchMock = withBucketList(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Trip",
            accessRole: "viewer",
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
              dayPlanItems: [
                {
                  id: "plan-1",
                  contentJson: JSON.stringify({
                    type: "doc",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
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
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    await waitFor(() => expect(planDialogMockState.lastProps).not.toBeNull());
    await waitFor(() => {
      expect(planDialogMockState.lastProps?.onMove).toBeUndefined();
      expect(planDialogMockState.lastProps?.moveTargetDays).toBeUndefined();
    });
    expect(screen.queryByRole("button", { name: "Move plan item" })).toBeNull();
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

    await activateDayOverflowItem("Edit day details");

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

    await activateDayOverflowItem("Edit day details");
    fireEvent.click(await screen.findByRole("button", { name: "Remove image" }));

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

  /**
   * Story 6.16 / AC1, AC2 and AC3 on one render.
   *
   * AC2: each new mode gets its own glyph rather than inheriting the car one, so the two SVGs must
   * differ from each other and from car's.
   * AC1: both roll into the day's travel total exactly like any other mode.
   * AC3: the coverage legend still names four kinds and says "Travel" once - the bar must not have
   * grown a per-mode distinction while the modes were being added.
   */
  it("renders walking and cycling segments with their own glyphs and rolls them into the travel total", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/day-plan-items/images") || url.includes("/accommodations/images")) {
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
                  checkOutTime: "09:00",
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
                    title: "Morning",
                    fromTime: "10:00",
                    toTime: "11:00",
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
                    fromTime: "13:00",
                    toTime: "14:00",
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
                    id: "segment-walk",
                    fromItemType: "accommodation",
                    fromItemId: "stay-prev",
                    toItemType: "dayPlanItem",
                    toItemId: "item-1",
                    transportType: "walking",
                    durationMinutes: 20,
                    distanceKm: 1.5,
                    linkUrl: null,
                  },
                  {
                    id: "segment-bike",
                    fromItemType: "dayPlanItem",
                    fromItemId: "item-1",
                    toItemType: "dayPlanItem",
                    toItemId: "item-2",
                    transportType: "cycling",
                    durationMinutes: 40,
                    distanceKm: 12,
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

    const segments = screen.getAllByTestId("travel-segment");
    const walkSegment = segments.find((segment) => segment.getAttribute("data-to-id") === "item-1");
    const bikeSegment = segments.find((segment) => segment.getAttribute("data-to-id") === "item-2");
    expect(walkSegment).toBeTruthy();
    expect(bikeSegment).toBeTruthy();

    // AC2 - distinct glyphs. The SVGs are `aria-hidden` decoration, so they are compared by markup.
    const walkGlyph = (walkSegment as HTMLElement).querySelector("svg");
    const bikeGlyph = (bikeSegment as HTMLElement).querySelector("svg");
    expect(walkGlyph).toBeTruthy();
    expect(bikeGlyph).toBeTruthy();
    expect(walkGlyph?.innerHTML).not.toBe(bikeGlyph?.innerHTML);

    // Meaning is not carried by the glyph alone: the row names the mode in text as well, and the
    // distance the new modes are now allowed to carry is shown.
    expect(within(walkSegment as HTMLElement).getByText("Walking · 20m · 1.5 km")).toBeInTheDocument();
    expect(within(bikeSegment as HTMLElement).getByText("Cycling · 40m · 12 km")).toBeInTheDocument();

    // AC1 - both roll into the day's travel total (20 + 40).
    expect(within(screen.getByTestId("day-stat-travel-time")).getByText("1h")).toBeInTheDocument();

    // AC3 - four kinds, one "Travel", no per-mode entries.
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(screen.queryByText("Walking", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cycling", { selector: "span" })).not.toBeInTheDocument();

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

    // AC6, owner half: this fixture is accessRole "owner". Story 6.15 moved the owner-only
    // day-image action *into* the menu, so what the hero must carry is the overflow and nothing
    // else. Scoped to the hero - queried globally the overflow could drift below the hero and this
    // would still pass. (Story 6.19 removed the header row this used to scope to; the hero itself is
    // the enclosing surface now that the three controls are positioned against it directly.)
    const hero = screen.getByTestId("day-hero");
    expect(within(hero).queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();
    const overflow = within(hero).getByTestId("day-hero-overflow");
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
    // the document happens to carry the same text. Cell 3 in particular is the stat strip's spend
    // figure, which is a different element from the sidebar cost card's total.
    //
    // Story 6.21 shortened three of the four labels: "Total travel time" and "Spend today" each dropped
    // a qualifier ("gesamt"/"heute") that the strip's position under the day photo already supplies.
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Travel time")).toBeInTheDocument();
    expect(screen.getByText("Spend")).toBeInTheDocument();
    expect(screen.getByTestId("day-stat-day")).toHaveTextContent("1 / 4");
    expect(screen.getByTestId("day-stat-travel-time")).toHaveTextContent("2h 10m");
    expect(screen.getByTestId("day-stat-spend-today")).toHaveTextContent("€230.00");
    // The stay's name has left the label. It is still on screen - on its timeline segment - so this is
    // a narrower label, not lost information.
    expect(screen.getByText("Check-in")).toBeInTheDocument();
    expect(screen.queryByText("Check-in Quinta")).not.toBeInTheDocument();
    expect(screen.getByTestId("day-stat-check-in")).toHaveTextContent("16:00");
    expect(screen.getByTestId("day-cost-total")).toHaveTextContent("€230.00");

    // An activity with a recorded cost shows it on its own card, not only in the sidebar breakdown.
    expect(screen.getByTestId("day-plan-item-cost")).toHaveTextContent("€45.00");

    vi.unstubAllGlobals();
  });

  /**
   * Story 6.21, AC2 and AC5. The strip is a two-column grid at `xs`, and a grid row is as tall as its
   * tallest cell - so an accommodation name in the check-in *label* did not just grow that cell, it
   * grew the spend cell beside it. The label is now a constant, and this is the assertion that would
   * have caught the original problem: it compares the rendered label across both states rather than
   * checking each one against its own expected string, which is what let two different labels pass.
   *
   * The second half is the trap the collapse invites. `statStay` still drives the value and its colour;
   * deleting it because "the label no longer needs it" would silently merge "no accommodation" into
   * "check-in unset", and a label-only test would stay green through that.
   */
  it("uses one check-in label for both states while the value keeps them apart", async () => {
    navigationMockState.search = "";

    // The cell carries no test id of its own - the value does, and the label is the cell's first child.
    // Read positionally, not via getByText("Check-in"): a query that names the expected text cannot
    // observe a label that is wrong, which is precisely what AC2 is about.
    const readCheckInCell = () => {
      const value = screen.getByTestId("day-stat-check-in");
      const cell = value.parentElement as HTMLElement;
      const label = cell.firstElementChild as HTMLElement;
      return {
        label: label.textContent ?? "",
        labelOverflowWrap: getComputedStyle(label).overflowWrap,
        value: value.textContent ?? "",
        color: getComputedStyle(value).color,
      };
    };

    // The case that motivated the story: a name no cell can absorb.
    const longName = "Quinta do Vale Abraão Boutique Hotel and Vineyard Retreat";
    vi.stubGlobal(
      "fetch",
      buildDayResponse({
        accommodation: {
          id: "stay-1",
          name: longName,
          notes: null,
          status: "booked",
          costCents: null,
          link: null,
          checkInTime: "16:00",
          checkOutTime: null,
          location: null,
        },
      }),
    );
    const staying = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);
    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    const withStay = readCheckInCell();
    staying.unmount();
    vi.unstubAllGlobals();

    vi.stubGlobal("fetch", buildDayResponse({ missingAccommodation: true }));
    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);
    await screen.findByRole("heading", { name: "Day 1", level: 5 });
    const withoutStay = readCheckInCell();
    vi.unstubAllGlobals();

    // AC2: no user-supplied text reaches the label, so nothing a user types can set the row's height.
    expect(withStay.label).toBe("Check-in");
    expect(withoutStay.label).toBe(withStay.label);
    expect(withStay.label).not.toContain("Quinta");

    // AC5: the two states still read differently, in text and in colour - warn for the gap, ink for a
    // booked stay. Colour is asserted as a pair as well as by token, so a theme change that collapses
    // both to one tone fails here rather than shipping a cell that looks the same either way. Derived
    // from the palette rather than written as raw rgb: a retuned token should move this test's
    // expectation with it, and only an actual collapse of the two should fail it.
    expect(withStay.value).toBe("16:00");
    expect(withoutStay.value).toBe("No accommodation");
    expect(withStay.color).toBe(toRgb(theme.palette.tokens.ink));
    expect(withoutStay.color).toBe(toRgb(theme.palette.warning.main));
    expect(withoutStay.color).not.toBe(withStay.color);

    // Story 6.21, Task 3. `overflowWrap: "anywhere"` was removed from the labels deliberately - it was
    // there so a hotel name could break mid-word, and breaking mid-word is what grew the row. Pinned so
    // that re-adding it to make some future long label "fit" has to argue with this line first. The
    // value keeps its own wrap rule, which is why both are asserted.
    expect(withStay.labelOverflowWrap).not.toBe("anywhere");
    expect(getComputedStyle(screen.getByTestId("day-stat-check-in")).overflowWrap).toBe("anywhere");
  });

  it("renders the shortened stat labels in German", async () => {
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
          checkInTime: "16:00",
          checkOutTime: null,
          location: null,
        },
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />, { language: "de" });

    await screen.findByRole("heading", { name: "Tag 1", level: 5 });
    // German carries the longer words, so it is the language the 390px check turns on. "Fahrzeit
    // gesamt" and "Ausgaben heute" must not come back.
    expect(within(screen.getByTestId("day-stat-travel-time")).getByText("Fahrzeit")).toBeInTheDocument();
    expect(within(screen.getByTestId("day-stat-spend-today")).getByText("Ausgaben")).toBeInTheDocument();
    expect(screen.queryByText("Fahrzeit gesamt")).not.toBeInTheDocument();
    expect(screen.queryByText("Ausgaben heute")).not.toBeInTheDocument();
    // Scoped to the cell like the two above. German has other "Check-in…" strings on this screen
    // (`trips.stay.checkInLabel` is "Check-in-Zeit"), and the one label this story is actually about
    // should not be the one read with a document-wide query.
    const checkInCell = screen.getByTestId("day-stat-check-in").parentElement as HTMLElement;
    expect((checkInCell.firstElementChild as HTMLElement).textContent).toBe("Check-in");

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
    // Named after the activity, not the section: the alt is now a control name too (Story 6.12).
    const photo = await screen.findByRole("img", { name: "Museum visit 1" });
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
    // The day-image edit action survives - Story 6.15 relocated it into the hero overflow rather
    // than deleting it, so it is reachable but no longer a button on the page.
    expect(screen.queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("day-hero-overflow"));
    expect(await screen.findByRole("menuitem", { name: "Edit day details" })).toBeInTheDocument();

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
    const thumbnail = await screen.findByRole("img", { name: "Museum visit 1" });
    fireEvent.click(screen.getByRole("link", { name: "Open link" }));
    expect(screen.queryByTestId("plan-dialog")).toBeNull();

    // The thumbnail opens the fullscreen viewer, and its click must not bubble into the card handler.
    // Asserted last: the viewer is a modal that aria-hides everything behind it.
    fireEvent.click(thumbnail);
    expect(screen.queryByTestId("plan-dialog")).toBeNull();
    const viewer = await screen.findByRole("dialog");
    expect(within(viewer).getByRole("img", { name: "Museum visit 1" })).toBeInTheDocument();

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

  // Story 6.9 dropped the hero breadcrumb and put the trip button in the header row's left slot;
  // Story 6.19 removed the row and moved the button into the `⋯` menu. What survives of 6.9's AC8 is
  // the half about the breadcrumb - the slot assertions belong to the 6.19 block below now.
  it("drops the hero breadcrumb, leaving one route back to the trip rather than two (AC8)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The breadcrumb carried no test id, so its absence has to be read off what it rendered: a link
    // to the trip labelled with the trip's name, and the "/" separator beside it.
    expect(screen.queryByRole("link", { name: "Test Trip" })).not.toBeInTheDocument();
    expect(screen.queryByText("/")).not.toBeInTheDocument();

    // And the route it duplicated is still exactly one route, now the menu's first row.
    await userEvent.click(screen.getByTestId("day-hero-overflow"));
    expect(await screen.findAllByRole("menuitem", { name: "Back to trip" })).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("gives a non-owner the same single route back to the trip (AC8)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "contributor" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // "Edit day details" is the day-image action's actual accessible name (`trips.dayImage.editAction`)
    // and it is `isOwner`-gated, so a contributor does not get it. Naming anything else here asserts
    // the absence of an element that never existed.
    expect(screen.queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("day-hero-overflow"));
    expect(await screen.findByRole("menuitem", { name: "Back to trip" })).toHaveAttribute(
      "href",
      "/trips/trip-1",
    );

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

    // The overflow used to share a slot with the isOwner-gated day-image action. Putting it inside
    // that branch would silently take print away from viewers and contributors - a capability loss
    // wearing a layout change's clothes, which is why this asserts both halves at once. Scoped to the
    // hero since Story 6.19 removed the header row.
    const hero = screen.getByTestId("day-hero");
    expect(within(hero).queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();
    const overflow = within(hero).getByTestId("day-hero-overflow");

    await userEvent.click(overflow);

    const printLink = await screen.findByRole("menuitem", { name: "Print day" });
    expect(printLink).toHaveAttribute("href", "/trips/trip-1/days/day-1/print");
    expect(printLink).toHaveAttribute("target", "_blank");
    expect(printLink).toHaveAttribute("rel", "noopener noreferrer");

    vi.unstubAllGlobals();
  });

  // --- Story 6.13: the accommodation cards edit like activity cards ----------------------------

  const stayFixture = (id: string, name: string) => ({
    id,
    name,
    notes: null,
    status: "planned",
    costCents: null,
    payments: [],
    link: null,
    checkInTime: null,
    checkOutTime: null,
    location: null,
  });

  // `buildDayResponse` serves a single day, which leaves `previousDay` null - and a null previous day
  // is precisely the case in which the previous-night card must stay inert. Anything asserting on that
  // card needs a trip that actually has a day before the one on screen.
  const buildTwoDayResponse = (
    options: {
      previousAccommodation?: Record<string, unknown> | null;
      accommodation?: Record<string, unknown> | null;
      trip?: Record<string, unknown>;
    } = {},
  ) =>
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
              startDate: "2026-11-30T00:00:00.000Z",
              endDate: "2026-12-01T00:00:00.000Z",
              dayCount: 2,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
              ...options.trip,
            },
            days: [
              {
                id: "day-prev",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: options.previousAccommodation ?? null,
                dayPlanItems: [],
                travelSegments: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: options.accommodation ?? null,
                dayPlanItems: [],
                travelSegments: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

  it("opens the previous-night dialog - not the current-night one - from the previous-night card (AC1, AC2)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildTwoDayResponse({
        previousAccommodation: stayFixture("stay-prev", "Airport Hotel"),
        accommodation: stayFixture("stay-current", "City Hotel"),
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const overlay = within(screen.getByTestId("timeline-previous-stay")).getByTestId(
      "timeline-previous-stay-edit-overlay",
    );
    // The same mechanism 6.9 settled on: a stretched <button>, not `role="button"` on the card. ARIA
    // gives `button` Children Presentational: True, which would collapse the stay name, the time pill
    // and the status chip into the overlay's single accessible name.
    expect(overlay.tagName.toLowerCase()).toBe("button");
    expect(overlay.parentElement).not.toHaveAttribute("role");
    expect(overlay).toHaveAccessibleName("Edit previous-night accommodation: Airport Hotel");
    expect(overlay).toHaveAttribute("aria-haspopup", "dialog");
    // The card's own content is still in the accessibility tree, which the presentational-children
    // collapse would have taken away.
    expect(within(screen.getByTestId("timeline-previous-stay")).getByText("Airport Hotel")).toBeInTheDocument();

    fireEvent.click(overlay);

    // The two stay dialogs edit different days. Wiring this card to `setStayOpen` would overwrite
    // today's accommodation while the screen said "previous night", so both halves are asserted.
    await waitFor(() => expect(stayDialogMockState.previous).toBe(true));
    expect(stayDialogMockState.current).toBe(false);
    expect(screen.getByTestId("stay-dialog-previous")).toBeInTheDocument();
    expect(screen.queryByTestId("stay-dialog-current")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("opens the current-night dialog - not the previous-night one - from the current-night card (AC1, AC2)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildTwoDayResponse({
        previousAccommodation: stayFixture("stay-prev", "Airport Hotel"),
        accommodation: stayFixture("stay-current", "City Hotel"),
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    const overlay = within(screen.getByTestId("timeline-current-stay")).getByTestId(
      "timeline-current-stay-edit-overlay",
    );
    expect(overlay.tagName.toLowerCase()).toBe("button");
    expect(overlay.parentElement).not.toHaveAttribute("role");
    expect(overlay).toHaveAccessibleName("Edit current-night accommodation: City Hotel");

    fireEvent.click(overlay);

    await waitFor(() => expect(stayDialogMockState.current).toBe(true));
    expect(stayDialogMockState.previous).toBe(false);
    expect(screen.getByTestId("stay-dialog-current")).toBeInTheDocument();
    expect(screen.queryByTestId("stay-dialog-previous")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("opens the add dialog from an empty stay card and says so in the name (AC5)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildTwoDayResponse({ previousAccommodation: null, accommodation: null }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Removing both buttons removed the only "add accommodation" entry point, so the empty card has to
    // be the new one - and an empty card looks like a filled one to a screen reader unless the name
    // carries the difference.
    expect(screen.getByText("No previous-night accommodation set.")).toBeInTheDocument();
    const previousOverlay = screen.getByTestId("timeline-previous-stay-edit-overlay");
    expect(previousOverlay).toHaveAccessibleName("Add previous-night accommodation");
    const currentOverlay = screen.getByTestId("timeline-current-stay-edit-overlay");
    expect(currentOverlay).toHaveAccessibleName("Add current-night accommodation");

    // Both empty cards are activated, not just named. Trap 2 - the two dialogs edit different days -
    // applies to the add path exactly as it does to the edit path, and asserting the name alone would
    // still pass if the empty previous-night branch were wired to `setStayOpen`.
    fireEvent.click(previousOverlay);
    await waitFor(() => expect(stayDialogMockState.previous).toBe(true));
    expect(stayDialogMockState.current).toBe(false);

    fireEvent.click(currentOverlay);
    await waitFor(() => expect(stayDialogMockState.current).toBe(true));

    vi.unstubAllGlobals();
  });

  it("keeps the copy-previous button hit-testable while it is disabled (AC6)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildTwoDayResponse({
        previousAccommodation: stayFixture("stay-prev", "Airport Hotel"),
        accommodation: null,
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // `overlaidContentSx` gives real <button>s their pointer events back, but MUI's ButtonBase sets
    // `&.Mui-disabled { pointer-events: none }` at a higher specificity - so while a copy is in flight
    // the button stops hit-testing and a second, impatient click would land on the stretched overlay
    // beneath it and open this day's stay editor on top of the copy. The wrapper is what absorbs it.
    // jsdom has no hit testing, so the fall-through itself is browser-only (Task 6); what is checkable
    // here is that the button is not a direct child of the pointer-events-none head row.
    const copyButton = screen.getByRole("button", { name: "Copy previous night" });
    const wrapper = copyButton.parentElement as HTMLElement;
    expect(window.getComputedStyle(wrapper).pointerEvents).toBe("auto");

    vi.unstubAllGlobals();
  });

  it("removes the toolbar stay button and the previous-night card's inline stay button (AC3, AC4)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildTwoDayResponse({
        previousAccommodation: stayFixture("stay-prev", "Airport Hotel"),
        accommodation: stayFixture("stay-current", "City Hotel"),
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The mechanical check that both are gone: nothing anywhere is named by what the two buttons said.
    // `trips.stay.editAction` / `addAction` were removed along with their only call sites, so this
    // asserts on the strings they carried rather than on the keys.
    expect(screen.queryByRole("button", { name: "Edit stay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add stay" })).not.toBeInTheDocument();
    // Each stay card's overlay is now its only control - the inline button would be a second one.
    expect(within(screen.getByTestId("timeline-previous-stay")).getAllByRole("button")).toHaveLength(1);
    expect(within(screen.getByTestId("timeline-current-stay")).getAllByRole("button")).toHaveLength(1);
    // Story 6.15 finished the job this story started: move and swap went into the hero overflow,
    // so the section header is down to the one action that creates what the section lists.
    expect(screen.getByRole("button", { name: "Add plan item" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("signals editability on stay cards exactly as it does on activity cards (AC7)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildTwoDayResponse({
        previousAccommodation: stayFixture("stay-prev", "Airport Hotel"),
        accommodation: stayFixture("stay-current", "City Hotel"),
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The reveal is a media-query behaviour and jsdom implements no media-query matching, so what is
    // checkable here is that all three card kinds are driven by the *same* authored rules: the glyph
    // carries the shared EDIT_GLYPH_CLASS, which is the only selector those rules target.
    for (const testId of ["timeline-previous-stay-edit-glyph", "timeline-current-stay-edit-glyph"]) {
      const glyph = screen.getByTestId(testId);
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      expect(glyph.tagName.toLowerCase()).not.toBe("button");
      expect(glyph).not.toHaveAttribute("tabindex");
      expect(glyph.className).toContain("day-plan-item-edit-glyph");
    }

    const css = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("");
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain("@media (hover: none)");
    expect(css).toContain("@media (any-pointer: coarse)");

    vi.unstubAllGlobals();
  });

  it("gives a viewer no overlay, no glyph and no click-to-edit on either stay card (AC8)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal(
      "fetch",
      buildTwoDayResponse({
        previousAccommodation: stayFixture("stay-prev", "Airport Hotel"),
        accommodation: stayFixture("stay-current", "City Hotel"),
        trip: { accessRole: "viewer" },
      }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // The control must be absent, not merely inert: the cursor and the hover treatment live inside
    // `@media (hover: hover)`, which jsdom does not apply, so reading them off the card proves nothing.
    const previousCard = screen.getByTestId("timeline-previous-stay");
    const currentCard = screen.getByTestId("timeline-current-stay");
    expect(within(previousCard).queryByTestId("timeline-previous-stay-edit-overlay")).not.toBeInTheDocument();
    expect(within(currentCard).queryByTestId("timeline-current-stay-edit-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-previous-stay-edit-glyph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-current-stay-edit-glyph")).not.toBeInTheDocument();
    expect(within(previousCard).queryByRole("button")).toBeNull();
    expect(within(currentCard).queryByRole("button")).toBeNull();

    fireEvent.click(previousCard);
    fireEvent.click(currentCard);
    expect(stayDialogMockState.previous).toBe(false);
    expect(stayDialogMockState.current).toBe(false);

    vi.unstubAllGlobals();
  });

  it("leaves the previous-night card inert on a day with no previous day (AC8)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Two-part condition: planning rights alone are not enough. With no day before this one there is
    // no accommodation to edit and nothing for the add dialog to attach to.
    expect(screen.queryByTestId("timeline-previous-stay-edit-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-previous-stay-edit-glyph")).not.toBeInTheDocument();
    expect(screen.getByTestId("timeline-current-stay-edit-overlay")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  // --- Story 6.15: move, swap and the day-image edit join print in the hero overflow -----------

  // Returns items AND the divider, in DOM order, with the divider as the literal "---". Collecting
  // only `role="menuitem"` would leave the separator invisible to the order assertion, and the
  // divider's *position* is the whole of Task 4's decision: a rule floating above "Edit day details",
  // or dropped between move and swap and splitting the pair, would both read as green.
  const dayOverflowItemNames = async () => {
    await userEvent.click(screen.getByTestId("day-hero-overflow"));
    const menu = await screen.findByRole("menu");
    return Array.from(menu.querySelectorAll('[role="menuitem"], hr, li.MuiDivider-root')).map((node) =>
      node.getAttribute("role") === "menuitem" ? node.textContent : "---"
    );
  };

  it("gives an owner all four overflow items, planning first, print below a divider (AC1, AC2, AC3)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "owner" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Order is asserted, not just membership: move and swap are a pair and must stay adjacent, and
    // the divider is only meaningful if everything that changes this day sits above it. Story 6.19
    // prepends back-to-trip - the way off the screen, ahead of everything that keeps you on it.
    expect(await dayOverflowItemNames()).toEqual([
      "Back to trip",
      "Edit day details",
      "Move activities",
      "Swap activities",
      "---",
      "Print day",
    ]);
    // A <ul> may only contain <li>, so the separator has to be one - as a bare <hr> it validates as
    // an error and AT rebuilding the list from valid children can drop it.
    expect(screen.getByTestId("day-hero-overflow-divider").tagName).toBe("LI");

    vi.unstubAllGlobals();
  });

  it("gives a contributor three overflow items and no day-image edit (AC3)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "contributor" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Still one planning group above print, so the divider still separates two kinds of thing - and
    // it is still below the pair, not floating at the top of a shorter list.
    expect(await dayOverflowItemNames()).toEqual([
      "Back to trip",
      "Move activities",
      "Swap activities",
      "---",
      "Print day",
    ]);

    vi.unstubAllGlobals();
  });

  it("gives a viewer back-to-trip and print, with no divider left floating at the top (AC3, AC5)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "viewer" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // AC5's live half: the trigger stays for a viewer because print stays for a viewer. Wrapping it
    // in `isOwner` because the day-image item moved in is the regression 6.11 AC6 was written for -
    // and after Story 6.19 it would also strand the viewer, since back-to-trip lives in here too.
    expect(screen.getByTestId("day-hero-overflow")).toBeInTheDocument();
    expect(await dayOverflowItemNames()).toEqual(["Back to trip", "Print day"]);
    // Two items, no rule between them: the divider marks off the day-changing group, and a viewer has
    // none. A separator drawn between a viewer's only two entries would be noise, not structure.
    expect(screen.queryByTestId("day-hero-overflow-divider")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("leaves the hero holding the overflow alone and the page holding no move, swap or day-image button (AC1, AC2, AC6)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "owner" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Named by the strings the three controls carried, not by their keys: all three keys survive as
    // menu labels, so a key grep would prove nothing about where they are rendered.
    expect(screen.queryByRole("button", { name: "Move activities" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Swap activities" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit day details" })).not.toBeInTheDocument();

    // AC2: one 44px control where there were two plus their 8px gap. Story 6.19 removed the slot this
    // used to scope to, so it is scoped to the hero - and this fixture is a single-day trip, so there
    // is no chevron on the hero either and the overflow is genuinely the only button on the photo.
    const hero = screen.getByTestId("day-hero");
    const heroButtons = within(hero).getAllByRole("button");
    expect(heroButtons).toHaveLength(1);
    expect(heroButtons[0]).toBe(screen.getByTestId("day-hero-overflow"));

    // AC6: the timeline section header is down to its label and the one action that creates what
    // the section lists. Scoped by testid rather than by the label's `parentElement` so that wrapping
    // the Typography for any reason cannot silently rescope this to something other than the header
    // row - and asserted as a count, because an empty leftover wrapper would still satisfy "move and
    // swap are gone".
    const timelineHeader = screen.getByTestId("day-timeline-section-header");
    expect(within(timelineHeader).getByText("Day timeline")).toBeInTheDocument();
    const timelineHeaderButtons = within(timelineHeader).getAllByRole("button");
    expect(timelineHeaderButtons).toHaveLength(1);
    expect(timelineHeaderButtons[0]).toHaveTextContent("Add plan item");

    vi.unstubAllGlobals();
  });

  it("opens the transfer dialog in move mode from the move item and in swap mode from the swap item (AC4)", async () => {
    navigationMockState.search = "";
    // Role pinned rather than left to the `accessRole`-absent default: these two items are gated on
    // `canEditPlanning`, so the case worth proving is a contributor reaching them, not the fallback
    // that treats an unknown role as an owner.
    vi.stubGlobal("fetch", buildTwoDayResponse({ trip: { accessRole: "contributor" } }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // Two items, two modes. Wiring both to one mode reads as correct everywhere except here: the
    // confirm button is the only place the chosen mode surfaces before the request goes out.
    await activateDayOverflowItem("Move activities");
    expect(await screen.findByRole("heading", { name: "Move activities", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm move" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm swap" })).not.toBeInTheDocument();
    // Story 6.25: the footer's Cancel became the title row's `✕`. Nothing was picked in the select, so
    // this closes straight through without raising the discard question.
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm move" })).not.toBeInTheDocument());

    await activateDayOverflowItem("Swap activities");
    expect(await screen.findByRole("heading", { name: "Swap activities", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm swap" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm move" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("opens the day-details dialog from the day-image item (AC2, AC4)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "owner" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    await activateDayOverflowItem("Edit day details");

    // Story 7.7's surface, reached a new way and otherwise untouched.
    expect(await screen.findByLabelText("Day note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save day details" })).toBeInTheDocument();

    // AC4: the menu closes on any selection, including the ones that open something on top of it.
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Edit day details" })).not.toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  /**
   * Story 6.25 code review, and the sharpest of the defects it found.
   *
   * The day-details dialog's discard guard compares `dayNoteDraft` against the day's saved note, but
   * closing the dialog only flipped `dayMetaOpen` — the effect that re-seeds the draft keys on
   * `[day?.id, day?.note]`, and neither changes when a dialog closes. So answering "Discard changes"
   * closed the dialog and kept the text: reopening showed the note the user had just discarded, the
   * guard read dirty on an untouched reopen, and — the part that made this worse than an annoyance —
   * both `handleSaveDayImage` and `handleRemoveDayImage` post `dayNoteDraft`, so a later save of only
   * the *photo* would have written the discarded note to the server.
   *
   * Both directions are asserted here: that typing raises the question at all, and that discarding
   * actually discards.
   */
  it("discards the day note it was told to discard, and does not re-offer it (AC7)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "owner" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    await activateDayOverflowItem("Edit day details");
    await userEvent.type(await screen.findByLabelText("Day note"), "Ferry leaves at six");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    // The draft is dirty, so the `✕` asks rather than throwing the text away.
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByLabelText("Day note")).not.toBeInTheDocument());

    await activateDayOverflowItem("Edit day details");

    // Reopened clean: the discarded text is gone, and the dialog closes silently because the draft
    // matches the day's saved note again.
    expect(await screen.findByLabelText("Day note")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByLabelText("Day note")).not.toBeInTheDocument());
    expect(screen.queryByTestId("discard-changes-body")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("keeps print's link props and closes the menu behind it (AC4)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildDayResponse({}, { accessRole: "viewer" }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    await userEvent.click(screen.getByTestId("day-hero-overflow"));
    const print = await screen.findByRole("menuitem", { name: "Print day" });

    // The one item that keeps them. The three handler items must not, or their dialogs would open
    // in a tab of their own.
    expect(print).toHaveAttribute("href", "/trips/trip-1/days/day-1/print");
    expect(print).toHaveAttribute("target", "_blank");
    expect(print).toHaveAttribute("rel", "noopener noreferrer");
    expect(print).not.toHaveAttribute("aria-haspopup");

    // The only item whose closure nothing else would catch: it navigates away in a new tab, so a
    // missing `handleDayMenuClose` leaves this menu open over the day the user comes back to.
    await userEvent.click(print);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  // --- Story 6.19: three surfaces on the day hero ----------------------------------------------

  // `buildDayResponse` serves a single day, which leaves both neighbours null - and a day with no
  // neighbours has no chevrons, so it cannot say anything about the three-control claim or about the
  // order they are reached in. These are the three days AC1, AC7 and AC9 all need at once.
  //
  // Options object, not positionals, and deliberately unlike `buildDayResponse(day, trip)` above:
  // both take `Record<string, unknown>` first, so had this one kept a bare `trip` parameter the same
  // leading argument would mean "the day" in one and "the trip" in the other, with the compiler
  // content either way. `buildThreeDayResponse({ note })` would then have written `note` onto the
  // trip and silently rendered a day with no note - exactly the call the AC5 case below needs.
  const buildThreeDayResponse = ({
    trip = {},
    day = {},
  }: { trip?: Record<string, unknown>; day?: Record<string, unknown> } = {}) =>
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
              endDate: "2026-12-03T00:00:00.000Z",
              dayCount: 3,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
              ...trip,
            },
            days: [1, 2, 3].map((index) => ({
              plannedCostSubtotal: 0,
              missingAccommodation: false,
              missingPlan: true,
              accommodation: null,
              dayPlanItems: [],
              travelSegments: [],
              ...day,
              // Identity last, after the spread: `day` carries per-day *content* such as a note, and
              // every one of the three is meant to receive it, but an `id` arriving that way would
              // collapse all three onto one - and a fixture whose days share an id has no neighbours,
              // which is the single thing this builder exists to provide.
              id: `day-${index}`,
              date: `2026-12-0${index}T00:00:00.000Z`,
              dayIndex: index,
            })),
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

  // Every anchor and every button the hero paints, in DOM order. Both roles matter: the chevrons are
  // `IconButton component={Link}`, so they are links, and the `⋯` is a real button - counting only one
  // role would let the other kind multiply unnoticed.
  const heroControls = () =>
    Array.from(screen.getByTestId("day-hero").querySelectorAll("a[href], button"));

  it("carries exactly three interactive controls on the photo, in the order the corners read (AC1, AC9)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildThreeDayResponse({ trip: { accessRole: "owner" } }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });

    // AC1. Asserted as a count of *everything* focusable in the hero rather than as three positive
    // lookups: a fourth control added later would pass three getBy calls and fail only this.
    expect(heroControls()).toHaveLength(3);

    // AC9. Tab order is DOM order here - nothing in the hero carries a tabindex - and DOM order must
    // match the eye: top-left, top-right, bottom-right. Position comes from top/left/right/bottom, so
    // a regression that reorders these is invisible in a screenshot and only shows up on a keyboard.
    expect(heroControls()).toEqual([
      screen.getByTestId("day-hero-prev"),
      screen.getByTestId("day-hero-next"),
      screen.getByTestId("day-hero-overflow"),
    ]);

    vi.unstubAllGlobals();
  });

  it("pins all three hero controls to the same 8px inset (AC3, as far as jsdom can see)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildThreeDayResponse({ trip: { accessRole: "owner" } }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });

    const previous = getComputedStyle(screen.getByTestId("day-hero-prev"));
    const next = getComputedStyle(screen.getByTestId("day-hero-next"));
    const overflow = getComputedStyle(screen.getByTestId("day-hero-overflow"));

    // AC3 is a rendered-pixel claim and jsdom computes no layout, so what is pinned here is the input
    // to it: the `⋯` and the next-day chevron declare the same `right`, off the same containing block.
    // The bug being fixed was the `⋯` inheriting the hero's padding (16px at xs, 32px at md) from a
    // flex row while the chevron was absolutely positioned at 8 - the equality below is what that
    // could not satisfy. The operator's browser pass owns the measured half.
    // The containing block first. `right: 8px` on all three only means "the same edge" while the hero
    // is what they resolve against; drop `position: relative` from the hero and they fall through to
    // whatever positioned ancestor is next, or to the initial containing block - the `⋯` and the
    // chevron stop sharing any edge at all and every assertion below still passes.
    expect(getComputedStyle(screen.getByTestId("day-hero")).position).toBe("relative");

    expect(next.right).toBe("8px");
    expect(overflow.right).toBe("8px");
    expect(previous.left).toBe("8px");
    expect(previous.position).toBe("absolute");
    expect(next.position).toBe("absolute");
    expect(overflow.position).toBe("absolute");

    // Corners, not edges: the chevrons no longer hang off the vertical midpoint, and the `⋯` is at the
    // bottom. `top: 50%` with a `translateY(-50%)` left behind would still look plausible.
    expect(previous.top).toBe("8px");
    expect(next.top).toBe("8px");
    expect(overflow.bottom).toBe("8px");
    expect(previous.transform).toBe("");
    expect(next.transform).toBe("");

    // All three one rung above the title block, which the long-note case grows into from below. At
    // equal zIndex the later sibling wins hit-testing, and the title is the later sibling.
    expect(previous.zIndex).toBe("3");
    expect(next.zIndex).toBe("3");
    expect(overflow.zIndex).toBe("3");
    const titleBlock = getComputedStyle(
      screen.getByRole("heading", { name: "Day 2", level: 5 }).parentElement as HTMLElement,
    );
    expect(titleBlock.zIndex).toBe("2");
    // Still bottom-anchored - the premise AC5's clearance is built on. Its actual clearance (the
    // hero's 60px top padding and the title block's right padding) is declared through MUI's
    // responsive breakpoints, which jsdom does not resolve, so those two are the operator's to check.
    expect(titleBlock.marginTop).toBe("auto");

    vi.unstubAllGlobals();
  });

  it("renders no chevron for a missing neighbour, leaving the overflow alone on the photo (AC1, AC7)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildThreeDayResponse({ trip: { accessRole: "owner" } }));

    const { rerender } = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);

    await screen.findByRole("heading", { name: "Day 1", level: 5 });

    // 6.11's rule survives the move: nothing at all, not a disabled control. Asserted through the
    // hero's own control count as well as by test id, because a disabled button still renders.
    expect(screen.queryByTestId("day-hero-prev")).not.toBeInTheDocument();
    expect(heroControls()).toHaveLength(2);
    expect(heroControls()).toEqual([
      screen.getByTestId("day-hero-next"),
      screen.getByTestId("day-hero-overflow"),
    ]);

    rerender(<Providers><TripDayView tripId="trip-1" dayId="day-3" /></Providers>);

    await screen.findByRole("heading", { name: "Day 3", level: 5 });
    expect(screen.queryByTestId("day-hero-next")).not.toBeInTheDocument();
    expect(heroControls()).toEqual([
      screen.getByTestId("day-hero-prev"),
      screen.getByTestId("day-hero-overflow"),
    ]);

    vi.unstubAllGlobals();
  });

  it("keeps the whole 280-character title and its date line alongside all three controls (AC5)", async () => {
    navigationMockState.search = "";
    // The longest note the field allows. A short title hides this case entirely: the title block is
    // bottom-anchored and only reaches the chevrons' band when it is tall enough to fill the hero.
    const longestNote = "N".repeat(280);
    // The middle of three days, not a lone one. A single-day fixture leaves both neighbours null and
    // therefore paints no chevrons at all - which would leave this case asserting "alongside all three
    // controls" against a hero carrying exactly one, and the two top corners the 60px band exists to
    // protect would be tested by nothing anywhere in the suite.
    vi.stubGlobal(
      "fetch",
      buildThreeDayResponse({ trip: { accessRole: "owner" }, day: { note: longestNote } }),
    );

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    // AC5's testable half: the clearance is bought with padding, not with a `maxHeight`/`overflow`
    // on the title block - and this is what tells the two apart. A clip sized to keep the title off
    // the chevrons would eat the *date* first, because the date is the block's last line, and it
    // would truncate the note in the accessible name without changing anything a screenshot shows.
    const heading = await screen.findByRole("heading", { level: 5 });
    expect(heading).toHaveTextContent(`Day 2: ${longestNote}`);
    expect(screen.getByText("Dec 2, 2026")).toBeInTheDocument();

    // And the controls the title now grows past are all three still there, still above it, and still
    // in their corners - the arrangement whose clearance the operator then measures.
    expect(heroControls()).toEqual([
      screen.getByTestId("day-hero-prev"),
      screen.getByTestId("day-hero-next"),
      screen.getByTestId("day-hero-overflow"),
    ]);
    // Whether any of it *visually* overlaps is a rendered-pixel question jsdom cannot answer; the
    // 60px top padding and the title's right padding are the operator's browser pass to confirm.

    vi.unstubAllGlobals();
  });

  it("moves back-to-trip off the photo and into the menu, and removes the row it sat in (AC2, AC4)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildThreeDayResponse({ trip: { accessRole: "owner" } }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

    await screen.findByRole("heading", { name: "Day 2", level: 5 });

    // AC4: gone, not emptied. An empty flex container would keep reserving `mb: 2` and a line box, and
    // every "the button is not in the hero" assertion below would still pass with it in place.
    expect(screen.queryByTestId("day-hero-header-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("day-hero-header-left")).not.toBeInTheDocument();
    expect(screen.queryByTestId("day-hero-header-right")).not.toBeInTheDocument();

    // AC2, negative half. Both roles, because the control was a `Button component={Link}` and a
    // regression could bring it back as either.
    const hero = screen.getByTestId("day-hero");
    expect(within(hero).queryByRole("link", { name: "Back to trip" })).not.toBeInTheDocument();
    expect(within(hero).queryByRole("button", { name: "Back to trip" })).not.toBeInTheDocument();

    // AC2, positive half: exactly one, first, still a real anchor to the trip. `getAllBy` rather than
    // `getBy` so a duplicated item fails here rather than at some later ambiguous-query error.
    await userEvent.click(screen.getByTestId("day-hero-overflow"));
    const menu = await screen.findByRole("menu");
    const backItems = within(menu).getAllByRole("menuitem", { name: "Back to trip" });
    expect(backItems).toHaveLength(1);
    expect(backItems[0]).toBe(within(menu).getAllByRole("menuitem")[0]);
    expect(backItems[0].tagName).toBe("A");
    expect(backItems[0]).toHaveAttribute("href", "/trips/trip-1");
    // An in-app link. Print's props stay on print; here they would leave the trip in a second tab.
    expect(backItems[0]).not.toHaveAttribute("target");
    expect(backItems[0]).not.toHaveAttribute("rel");

    // The touch target survives the move. The hero button this replaced carried an explicit
    // `minHeight: 48` because it is the way off the screen and is reached with a thumb; relocating a
    // control is not a licence to shrink its hit area, which is the whole point of `DAY_MENU_ITEM_SX`
    // - MUI drops MenuItem to 36px at sm and up on its own. The old assertion left with the button,
    // and without a replacement every item in this menu could quietly fall to 36px with the suite
    // still green. Asserted across all of them, not just this one: the floor is the menu's, not the
    // item's.
    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(Number.parseInt(getComputedStyle(item).minHeight, 10)).toBeGreaterThanOrEqual(44);
    }

    // And it dismisses the menu on its way out, like every other item.
    await userEvent.click(backItems[0]);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  it("renders the German back label without the arrow glyph the hero button carried (AC2)", async () => {
    navigationMockState.search = "";
    vi.stubGlobal("fetch", buildThreeDayResponse({ trip: { accessRole: "viewer" } }));

    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />, { language: "de" });

    await screen.findByRole("heading", { name: "Tag 2", level: 5 });

    // The glyph was dropped deliberately (Story 6.19 Task 1) and in both locales at once. Pinning the
    // DE string as well as the EN one is what stops the two drifting apart - nothing in this repo
    // compares the two key sets.
    await userEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    expect(await screen.findByRole("menuitem", { name: "Zurück zur Reise" })).toHaveAttribute(
      "href",
      "/trips/trip-1",
    );
    expect(screen.queryByRole("menuitem", { name: "← Zurück zur Reise" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it.each(["owner", "contributor", "viewer"] as const)(
    "leaves %s able to reach both print and the way back to the trip (AC8)",
    async (accessRole) => {
      navigationMockState.search = "";
      vi.stubGlobal("fetch", buildThreeDayResponse({ trip: { accessRole } }));

      renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);

      await screen.findByRole("heading", { name: "Day 2", level: 5 });

      // Trap 4: the trigger must never be gated now that the only route off this screen is behind it.
      // A viewer losing it does not lose a menu - it loses the day screen.
      const trigger = screen.getByTestId("day-hero-overflow");
      expect(trigger).toBeInTheDocument();
      await userEvent.click(trigger);

      expect(await screen.findByRole("menuitem", { name: "Back to trip" })).toHaveAttribute(
        "href",
        "/trips/trip-1",
      );
      expect(screen.getByRole("menuitem", { name: "Print day" })).toBeInTheDocument();

      // And the 6.15 gates are still gates: only the two roles that can edit planning see move/swap,
      // only the owner sees the day-image edit.
      const gatedVisible = screen.queryAllByRole("menuitem", { name: /Move activities|Swap activities/ });
      expect(gatedVisible).toHaveLength(accessRole === "viewer" ? 0 : 2);
      expect(screen.queryAllByRole("menuitem", { name: "Edit day details" })).toHaveLength(
        accessRole === "owner" ? 1 : 0,
      );

      vi.unstubAllGlobals();
    },
  );
});

/**
 * Story 9.1, Task 6 — the `doc-chip` row on the three timeline `tl-card`s.
 *
 * These live in this file rather than in `docChip.test.tsx` on purpose. `docChip.test.tsx` renders the
 * primitive in isolation and proves what one chip *is*; everything below is about what `TripDayView`
 * *does with a collection of them* — the cap, the `+N`, the menu, the absence of a row — and all of it
 * needs this file's harness: the three dialog mocks, `next/navigation`, leaflet, and the bucket-list
 * fetch wrapper. A new file would have been a 250-line copy of the top of this one.
 *
 * It also matters that this suite does **not** mock `@mui/material` (DW-53 is open against
 * `tripDayPlanDialog.test.tsx` for doing exactly that): the `+N` overflow is a real MUI `Menu`, and a
 * mocked one would prove nothing about what it renders or how it is named.
 */
describe("TripDayView document chips", () => {
  type TestDocument = { id: string; documentUrl: string; fileName: string; sortOrder: number };

  const documentUrlFor = (name: string) =>
    `/uploads/trips/trip-1/days/day-2/accommodations/stay-current/documents/${name}`;

  const buildDocumentFetch = ({
    previousStayDocuments = [],
    currentStayDocuments = [],
    planItemDocuments = [],
    currentStayImages = [],
    planItemImages = [],
  }: {
    previousStayDocuments?: TestDocument[];
    currentStayDocuments?: TestDocument[];
    planItemDocuments?: (TestDocument & { dayPlanItemId: string })[];
    currentStayImages?: { id: string; imageUrl: string; sortOrder: number }[];
    planItemImages?: { id: string; dayPlanItemId: string; imageUrl: string; sortOrder: number }[];
  }) =>
    withBucketList(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data, error: null }) });

      if (url.includes("/accommodations/documents")) {
        return payload({
          documents: url.includes("accommodationId=stay-prev") ? previousStayDocuments : currentStayDocuments,
        });
      }
      if (url.includes("/day-plan-items/documents")) return payload({ documents: planItemDocuments });
      if (url.includes("/accommodations/images")) {
        return payload({ images: url.includes("accommodationId=stay-prev") ? [] : currentStayImages });
      }
      if (url.includes("/day-plan-items/images")) return payload({ images: planItemImages });

      return payload({
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
            missingPlan: false,
            accommodation: {
              id: "stay-current",
              name: "Current Hotel",
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
      });
    }) as unknown as typeof fetch;

  const renderDayTwo = async () => {
    renderWithProviders(<TripDayView tripId="trip-1" dayId="day-2" />);
    await screen.findByRole("heading", { name: "Day 2", level: 5 });
  };

  beforeEach(() => {
    bucketListItemsOverride = null;
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
  });

  it("renders a chip on all three tl-card kinds, labelled with the file name minus its extension", async () => {
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        previousStayDocuments: [
          { id: "prev-doc-1", documentUrl: documentUrlFor("d1.pdf"), fileName: "Previous Ticket.pdf", sortOrder: 1 },
        ],
        currentStayDocuments: [
          { id: "stay-doc-1", documentUrl: documentUrlFor("d2.pdf"), fileName: "Hotel Booking.pdf", sortOrder: 1 },
        ],
        planItemDocuments: [
          {
            id: "item-doc-1",
            dayPlanItemId: "item-1",
            documentUrl: documentUrlFor("d3.pdf"),
            fileName: "Museum Entry.pdf",
            sortOrder: 1,
          },
        ],
      }),
    );

    await renderDayTwo();

    // Scoped per card, not looked up globally: "a chip renders somewhere on the page" would pass with
    // all three attached to one card, which is exactly the wiring mistake the three sites can make.
    const previousCard = within(await screen.findByTestId("timeline-previous-stay"));
    const activityCard = within(screen.getByTestId("day-plan-item-card"));
    const currentCard = within(screen.getByTestId("timeline-current-stay"));

    await waitFor(() => expect(previousCard.getByText("Previous Ticket")).toBeInTheDocument());
    expect(activityCard.getByText("Museum Entry")).toBeInTheDocument();
    expect(currentCard.getByText("Hotel Booking")).toBeInTheDocument();

    // Named here so the `queryByTestId(...)` nulls in the "no chip row" case below are falsifiable:
    // this is the test that proves the id exists at all when there is a group to find.
    expect(previousCard.getByTestId("tl-card-doc-row")).toBeInTheDocument();
    expect(activityCard.getByTestId("tl-card-doc-row")).toBeInTheDocument();
    expect(currentCard.getByTestId("tl-card-doc-row")).toBeInTheDocument();

    // The extension is stripped from the *label*, not from the href — the file on disk is unchanged.
    expect(previousCard.queryByText("Previous Ticket.pdf")).toBeNull();
    expect(currentCard.getByRole("link", { name: /Hotel Booking/ })).toHaveAttribute(
      "href",
      documentUrlFor("d2.pdf"),
    );

    vi.unstubAllGlobals();
  });

  it("gives every chip a new tab and a severed opener", async () => {
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        currentStayDocuments: [
          { id: "stay-doc-1", documentUrl: documentUrlFor("d1.pdf"), fileName: "Hotel Booking.pdf", sortOrder: 1 },
          { id: "stay-doc-2", documentUrl: documentUrlFor("d2.pdf"), fileName: "Parking.pdf", sortOrder: 2 },
        ],
      }),
    );

    await renderDayTwo();

    const currentCard = within(await screen.findByTestId("timeline-current-stay"));
    await waitFor(() => expect(currentCard.getAllByRole("link")).toHaveLength(2));
    for (const chip of currentCard.getAllByRole("link")) {
      expect(chip).toHaveAttribute("target", "_blank");
      const rel = chip.getAttribute("rel") ?? "";
      expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(["noreferrer", "noopener"]));
    }

    vi.unstubAllGlobals();
  });

  it("renders no chip row without documents, and no media row at all without either kind", async () => {
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        currentStayImages: [{ id: "stay-img-1", imageUrl: "/uploads/a1.webp", sortOrder: 1 }],
      }),
    );

    await renderDayTwo();

    // The current stay has photos and no documents: a media row, but no chip group inside it.
    const currentCard = within(await screen.findByTestId("timeline-current-stay"));
    await waitFor(() => expect(currentCard.getByAltText(/Current Hotel 1/i)).toBeInTheDocument());
    expect(currentCard.queryByTestId("tl-card-doc-row")).toBeNull();

    // The activity has neither, so it renders exactly what it rendered before this story: no row.
    const activityCard = within(screen.getByTestId("day-plan-item-card"));
    expect(activityCard.queryByTestId("tl-card-doc-row")).toBeNull();
    expect(activityCard.queryByRole("img")).toBeNull();

    vi.unstubAllGlobals();
  });

  it.each([
    { extra: 1, expectedName: "Show 1 more document" },
    { extra: 2, expectedName: "Show 2 more documents" },
  ])("caps the chips at three and names the +$extra for what it hides", async ({ extra, expectedName }) => {
    const total = 3 + extra;
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        currentStayDocuments: Array.from({ length: total }, (_, index) => ({
          id: `stay-doc-${index + 1}`,
          documentUrl: documentUrlFor(`d${index + 1}.pdf`),
          fileName: `Ticket ${index + 1}.pdf`,
          sortOrder: index + 1,
        })),
      }),
    );

    await renderDayTwo();

    const currentCard = within(await screen.findByTestId("timeline-current-stay"));
    // Exactly three, whatever the total: the cap is a fixed number and not a width decision, which is
    // what lets this assert an exact count in jsdom, where nothing has a width at all.
    await waitFor(() => expect(currentCard.getAllByRole("link")).toHaveLength(3));
    expect(currentCard.getByText(`+${extra}`)).toBeInTheDocument();
    // The singular/plural twin, because `formatMessage` has no plural support and "Show 1 more
    // documents" is the defect the `…One` key exists to prevent.
    expect(currentCard.getByRole("button", { name: expectedName })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("opens every document's name from +N, not just the hidden ones", async () => {
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        currentStayDocuments: Array.from({ length: 5 }, (_, index) => ({
          id: `stay-doc-${index + 1}`,
          documentUrl: documentUrlFor(`d${index + 1}.pdf`),
          fileName: `Ticket ${index + 1}.pdf`,
          sortOrder: index + 1,
        })),
      }),
    );

    await renderDayTwo();

    const currentCard = within(await screen.findByTestId("timeline-current-stay"));
    await waitFor(() => expect(currentCard.getByText("+2")).toBeInTheDocument());
    await userEvent.click(currentCard.getByRole("button", { name: "Show 2 more documents" }));

    // Five, not two. The strip's `+N` opens the whole collection at the first unshown index, and a
    // list that omitted the three names already on the card would be a different affordance wearing
    // the same glyph. The count is asserted, not merely that something opened.
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.textContent)).toEqual([
      "Ticket 1",
      "Ticket 2",
      "Ticket 3",
      "Ticket 4",
      "Ticket 5",
    ]);
    // Each entry is an anchor into a new tab, not a viewer page.
    expect(items[4]).toHaveAttribute("href", documentUrlFor("d5.pdf"));
    expect(items[4]).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("menu", { name: "All documents" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("keeps an image document out of FullscreenPhotoViewer, from the chip and from the menu (AC6)", async () => {
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        // Four, so the row carries a `+1` as well as chips: both routes to a document have to stay
        // clear of the viewer, and the menu is the one that could most easily be wired into it.
        currentStayDocuments: Array.from({ length: 4 }, (_, index) => ({
          id: `stay-doc-${index + 1}`,
          documentUrl: documentUrlFor(`d${index + 1}.jpg`),
          fileName: `Boarding Pass ${index + 1}.jpg`,
          sortOrder: index + 1,
        })),
        // A real photo on the same card, and it is what makes the two negatives below falsifiable:
        // the final assertion proves this exact query *does* find the viewer when something opens it,
        // so the nulls above are the component's behaviour and not a query that never matches.
        currentStayImages: [{ id: "stay-img-1", imageUrl: "/uploads/a1.webp", sortOrder: 1 }],
      }),
    );

    await renderDayTwo();

    const currentCard = within(await screen.findByTestId("timeline-current-stay"));
    await waitFor(() => expect(currentCard.getAllByRole("link")).toHaveLength(3));

    // A JPEG document is still a document. `FullscreenPhotoViewer` belongs to the trip's photographs
    // and a boarding pass is not one, so activating the chip must not mount it.
    fireEvent.click(currentCard.getAllByRole("link")[0]);
    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();

    await userEvent.click(currentCard.getByRole("button", { name: "Show 1 more document" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(4);
    fireEvent.click(items[0]);
    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();

    // The falsifiability guard: the photo thumbnail on the same card *does* open it.
    fireEvent.click(currentCard.getByRole("img", { name: /Current Hotel 1/i }));
    expect(await screen.findByRole("dialog", { name: "Photo viewer" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("distinguishes two documents on one entry that share a file name", async () => {
    vi.stubGlobal(
      "fetch",
      buildDocumentFetch({
        // Nothing forbids this: the unique index is on `sortOrder`, not on the name, and two people's
        // tickets are commonly issued under one file name.
        currentStayDocuments: [
          { id: "stay-doc-1", documentUrl: documentUrlFor("d1.pdf"), fileName: "Ticket.pdf", sortOrder: 1 },
          { id: "stay-doc-2", documentUrl: documentUrlFor("d2.pdf"), fileName: "Ticket.pdf", sortOrder: 2 },
        ],
      }),
    );

    await renderDayTwo();

    const currentCard = within(await screen.findByTestId("timeline-current-stay"));
    await waitFor(() => expect(currentCard.getAllByRole("link")).toHaveLength(2));
    const [first, second] = currentCard.getAllByRole("link");

    // The visible label stays the bare name on both — the label is the content — while the accessible
    // names differ by position. Two controls sharing an accessible name is the defect Story 5.11's
    // review found on two comboboxes.
    expect(first).toHaveTextContent(/^Ticket$/);
    expect(second).toHaveTextContent(/^Ticket$/);
    expect(first).toHaveAccessibleName("Open Ticket (1 of 2)");
    expect(second).toHaveAccessibleName("Open Ticket (2 of 2)");
    expect(first.getAttribute("aria-label")).not.toBe(second.getAttribute("aria-label"));

    vi.unstubAllGlobals();
  });
});
