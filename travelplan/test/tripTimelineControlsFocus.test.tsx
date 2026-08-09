// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
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

vi.mock("@/components/features/trips/TripShareDialog", () => ({
  default: () => <div data-testid="share-dialog" />,
}));

vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({
  default: () => <div data-testid="overview-map-panel" />,
}));

vi.mock("@/components/features/trips/TripBucketListPanel", () => ({
  default: () => <div data-testid="bucket-list-panel" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * DW-107 regression: `tripControlsCard` (TripTimeline.tsx) is built once but mounted at one of two
 * JSX positions gated by `isTwoColumnLayout`. Those are different React tree positions, so crossing
 * `md` unmounts the card at one slot and mounts a fresh instance at the other - a keyboard user
 * focused on one of its three buttons loses focus to `<body>` at that instant unless it is restored.
 *
 * `tripTimelineRoles.test.tsx`'s `setViewportWidth` stubs `matchMedia` with a no-op
 * `addEventListener`, so jsdom cannot fire a real "change" event through MUI's `useMediaQuery`
 * subscription - that harness can pin one width per case, not cross a breakpoint live. Per this
 * bundle's "Never" boundary that harness is not touched; `useMediaQuery` is mocked directly instead,
 * so a case can flip the mocked return value and `rerender` to drive the transition.
 */
let mockIsTwoColumnLayout = true;

vi.mock("@mui/material", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mui/material")>();
  return {
    ...actual,
    // TripTimeline calls `useMediaQuery` twice: `isNarrowLayout` (`theme.breakpoints.down("sm")`,
    // a `max-width` query) and `isTwoColumnLayout` (`theme.breakpoints.up("md")`, a `min-width`
    // query). Only `isTwoColumnLayout` matters to this suite - `isNarrowLayout` only drives a
    // cosmetic `data-layout` attribute (DW-14, out of scope here) - but answering both from the same
    // boolean would let them report "narrower than `sm`" and "wider than `md`" at once, a state no
    // real viewport can be in. Routing on the query string keeps `isNarrowLayout` pinned to `false`
    // instead, which is the one value consistent with every `mockIsTwoColumnLayout` this file sets.
    useMediaQuery: (query: unknown) =>
      typeof query === "string" && query.includes("min-width") ? mockIsTwoColumnLayout : false,
  };
});

const EDIT_LABEL = "Edit trip";
const DELETE_LABEL = "Delete trip";
const EXPORT_LABEL = "Export backup";

const buildDetailResponse = () => ({
  data: {
    trip: {
      id: "trip-1",
      name: "Focus Trip",
      currentUserId: "u1",
      accessRole: "owner",
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-02T00:00:00.000Z",
      dayCount: 1,
      plannedCostTotal: 0,
      accommodationCostTotalCents: null,
      heroImageUrl: null,
      updatedAt: "2026-12-01T00:00:00.000Z",
    },
    days: [
      {
        id: "day-1",
        date: "2026-12-01T00:00:00.000Z",
        dayIndex: 1,
        imageUrl: null,
        note: null,
        updatedAt: "2026-12-01T00:00:00.000Z",
        plannedCostSubtotal: 0,
        missingAccommodation: true,
        missingPlan: true,
        accommodation: null,
        dayPlanItems: [],
        travelSegments: [],
      },
    ],
  },
  error: null,
});

const stubDetailFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/trips/trip-1") && method === "GET") {
      return { ok: true, status: 200, json: async () => buildDetailResponse() };
    }

    throw new Error(`Unhandled fetch ${method} ${url}`);
  }) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("TripTimeline trip-controls focus restore across the md remount (DW-107)", () => {
  afterEach(() => {
    mockIsTwoColumnLayout = true;
    vi.unstubAllGlobals();
  });

  it("restores focus to the new Edit trip instance when the layout crosses from two-column to single-column", async () => {
    mockIsTwoColumnLayout = true;
    const fetchMock = stubDetailFetch();

    const view = renderWithProviders(<TripTimeline tripId="trip-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const editButtonBefore = screen.getByRole("button", { name: EDIT_LABEL });
    act(() => {
      editButtonBefore.focus();
    });
    expect(document.activeElement).toBe(editButtonBefore);

    // Crosses `md` downward: the day-column mount point (two-column) unmounts and the trailing,
    // single-column mount point takes over - a fresh `tripControlsCard` instance.
    mockIsTwoColumnLayout = false;
    view.rerender(
      <Providers>
        <TripTimeline tripId="trip-1" />
      </Providers>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: EDIT_LABEL }));
    });

    const editButtonAfter = screen.getByRole("button", { name: EDIT_LABEL });
    // A genuinely different DOM node - not the same instance surviving the remount - is what proves
    // the effect actively restored focus rather than the browser never having dropped it.
    expect(editButtonAfter).not.toBe(editButtonBefore);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("restores focus to the new Export backup instance when the layout crosses from single-column to two-column", async () => {
    // Covers the ref-selection branch for a control other than Edit, and the opposite direction of
    // the crossing (single-column -> two-column).
    mockIsTwoColumnLayout = false;
    const fetchMock = stubDetailFetch();

    const view = renderWithProviders(<TripTimeline tripId="trip-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const exportButtonBefore = screen.getByRole("button", { name: EXPORT_LABEL });
    act(() => {
      exportButtonBefore.focus();
    });
    expect(document.activeElement).toBe(exportButtonBefore);

    mockIsTwoColumnLayout = true;
    view.rerender(
      <Providers>
        <TripTimeline tripId="trip-1" />
      </Providers>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: EXPORT_LABEL }));
    });

    const exportButtonAfter = screen.getByRole("button", { name: EXPORT_LABEL });
    expect(exportButtonAfter).not.toBe(exportButtonBefore);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("restores focus to the new Delete trip instance when the layout crosses from two-column to single-column", async () => {
    // Covers the third branch of `refByControl` - Edit and Export are exercised above, Delete is the
    // one control neither of those cases touches.
    mockIsTwoColumnLayout = true;
    const fetchMock = stubDetailFetch();

    const view = renderWithProviders(<TripTimeline tripId="trip-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const deleteButtonBefore = screen.getByRole("button", { name: DELETE_LABEL });
    act(() => {
      deleteButtonBefore.focus();
    });
    expect(document.activeElement).toBe(deleteButtonBefore);

    mockIsTwoColumnLayout = false;
    view.rerender(
      <Providers>
        <TripTimeline tripId="trip-1" />
      </Providers>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: DELETE_LABEL }));
    });

    const deleteButtonAfter = screen.getByRole("button", { name: DELETE_LABEL });
    expect(deleteButtonAfter).not.toBe(deleteButtonBefore);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("leaves focus untouched when nothing in the controls card is focused when the layout crosses", async () => {
    mockIsTwoColumnLayout = true;
    const fetchMock = stubDetailFetch();

    const view = renderWithProviders(<TripTimeline tripId="trip-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    // A day row's own navigation link - part of the day column, not the trip-controls card, and not
    // a node that moves between mount points when `isTwoColumnLayout` flips.
    const dayLink = screen.getByRole("link", { name: /Open day view/ });
    act(() => {
      dayLink.focus();
    });
    expect(document.activeElement).toBe(dayLink);

    mockIsTwoColumnLayout = false;
    view.rerender(
      <Providers>
        <TripTimeline tripId="trip-1" />
      </Providers>,
    );

    // Nothing to restore - `lastFocusedControlRef.current` was never set - so whatever was focused
    // beforehand stays focused rather than being stolen toward a control the user never touched.
    expect(document.activeElement).toBe(dayLink);
  });
});
