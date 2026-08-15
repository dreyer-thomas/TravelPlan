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
  // The `md` bound as a number, read off MUI's own defaults rather than written out as `900`:
  // `theme.ts` adds no `breakpoints` override, so this is the value the component's `up("md")`
  // resolves to. Taken from `breakpoints.values` rather than by matching the emitted query string,
  // which would also have depended on MUI's serialization - and a string that stopped matching
  // would not fail, it would quietly route every query to the width comparison below and leave
  // `mockIsTwoColumnLayout` inert while the DW-107 cases still claimed to cross `md`. Should
  // `theme.ts` ever override `md`, `mockedWidth` straddles the wrong bound and those cases fail
  // outright, which is the failure mode to prefer.
  const { md } = actual.createTheme().breakpoints.values;
  // One width for the whole answer set, exactly as a real viewport would have: the narrow case sits
  // one pixel below the bound rather than at some arbitrary phone width, so it is still above `sm`
  // and `isNarrowLayout` stays `false` either way (see below).
  const mockedWidth = () => (mockIsTwoColumnLayout ? md : md - 1);
  return {
    ...actual,
    // TripTimeline calls `useMediaQuery` twice, and since DW-14 both are `min-width` queries:
    // `isTwoColumnLayout` (`up("md")`, `min-width:900px`) and `isNarrowLayout` (`up("sm")` negated
    // at the call site, `min-width:600px`). Only `isTwoColumnLayout` matters to this suite -
    // `isNarrowLayout` drives the `data-layout` attribute, which `tripTimelinePlan.test.tsx` pins
    // and `tripTimelineRoles.test.tsx` backs with the matching grid conditions, both rather than
    // here - but answering both from the same boolean would collapse `sm` and `md` into one width
    // and let them report "narrower than `sm`" and "wider than `md`" at once, a state no real
    // viewport can be in. Answering from one width instead makes that state unreachable by
    // construction: at `md - 1` every "wider than X" below `md` still holds, so `isNarrowLayout`
    // stays pinned to `false` - the one value consistent with every `mockIsTwoColumnLayout` this
    // file sets - and it keeps holding if a breakpoint here changes direction or a third one is
    // added, which a bound-by-bound match would not. Silent breakage on such an edit is exactly how
    // DW-14 got here.
    //
    // A query with no width bound is not about layout at all - `(prefers-reduced-motion)`,
    // `(hover: none)`, `print` - and answering those from a width would put this file's cases into a
    // different rendering mode than the rest of the suite, so they land on `false`. Same rule, and
    // now the same comparison, as `setViewportWidth` in `tripTimelineRoles.test.tsx` (:81-96); the
    // two harnesses disagreeing about it is its own drift.
    useMediaQuery: (query: unknown) => {
      if (typeof query !== "string") return false;
      const minWidthMatch = /min-width:\s*(\d+(\.\d+)?)px/.exec(query);
      const maxWidthMatch = /max-width:\s*(\d+(\.\d+)?)px/.exec(query);
      if (!minWidthMatch && !maxWidthMatch) return false;
      const width = mockedWidth();
      return (
        width >= (minWidthMatch ? Number(minWidthMatch[1]) : 0) &&
        width <= (maxWidthMatch ? Number(maxWidthMatch[1]) : Infinity)
      );
    },
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
