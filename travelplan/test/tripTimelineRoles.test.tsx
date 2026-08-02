// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { emotionDeclarations, emotionDeclaredProperties, emotionPropertyConditions } from "./helpers/emotionStyles";
import { renderWithProviders } from "./helpers/renderWithProviders";

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

// MUI's default `md` breakpoint - the key the overview grid splits on, so the day column's desktop
// padding is declared under this condition rather than unconditionally.
const MD_MEDIA_CONDITION = "(min-width:900px)";
// MUI emits an `xs` value in a responsive object as `(min-width:0px)`, not as an unconditional
// declaration - so a rule set that covers `{ xs, md }` shows up as these two conditions and no base.
const XS_MEDIA_CONDITION = "(min-width:0px)";

// jsdom performs no layout, so Story 6.10's AC2 - "its rendered width matches a day row's" - cannot
// be measured. Two properties make it true and both are asserted below: the day column declares the
// padding that sets the width, and the card declares no width or margin that would override it.
const WIDTH_AND_SPACING_PROPERTIES = [
  "width",
  "min-width",
  "max-width",
  "inline-size",
  "min-inline-size",
  "max-inline-size",
  "flex",
  "flex-basis",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-inline",
  "margin-block",
];

/**
 * Story 6.14: the trip-controls card is one element mounted in one of two positions, chosen by the
 * overview grid's own `md` key. jsdom 28 ships no `matchMedia` at all - not on `window`, not on its
 * prototype - so MUI takes its `supportMatchMedia === false` path and every `useMediaQuery` in the
 * tree answers `defaultMatches`, i.e. `false`, i.e. the single-column layout. A case that means
 * "desktop" therefore has to say so, and a case that means "phone" pins it anyway rather than
 * riding on that default.
 *
 * Installed with `vi.stubGlobal`, so the file's existing `vi.unstubAllGlobals()` in `afterEach`
 * removes it again and no width leaks into the cases that follow.
 */
const setViewportWidth = (width: number) => {
  vi.stubGlobal("matchMedia", (query: string) => {
    const maxWidthMatch = /max-width:\s*(\d+(\.\d+)?)px/.exec(query);
    const minWidthMatch = /min-width:\s*(\d+(\.\d+)?)px/.exec(query);
    // A query with neither bound is not about width - `(prefers-color-scheme: dark)`, `(hover:
    // none)`, `print`. Answering `true` to all of those would quietly put the four cases that call
    // this helper into a different rendering mode than the rest of the file, so they get `false`.
    if (!maxWidthMatch && !minWidthMatch) {
      return buildMediaQueryList(query, false);
    }
    const maxWidth = maxWidthMatch ? Number(maxWidthMatch[1]) : Infinity;
    const minWidth = minWidthMatch ? Number(minWidthMatch[1]) : 0;

    return buildMediaQueryList(query, width >= minWidth && width <= maxWidth);
  });
};

const buildMediaQueryList = (query: string, matches: boolean) => ({
  matches,
  media: query,
  onchange: null,
  // Never fired: this helper pins one width per case rather than moving between them. Crossing the
  // breakpoint at runtime - and the focus loss that comes with the remount - is DW-107, and belongs
  // to the browser-level pass DW-14 already reserves for it.
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
});

// The widths Story 6.14's manual check uses, so the automated cases and the operator's check talk
// about the same two viewports.
const DESKTOP_WIDTH = 1400;
const PHONE_WIDTH = 390;
// 900px is the `md` breakpoint itself, where `up("md")` first answers true. Included because the
// whole story hinges on that number, and because it is the width that fails if the mount point
// drifts *upward* - keyed to `lg` (1200px), 1400px alone would still pass.
const MD_BOUNDARY_WIDTH = 900;
const TWO_COLUMN_WIDTHS = [MD_BOUNDARY_WIDTH, DESKTOP_WIDTH];
// 820px is stacked too - below `md` (900px) but above `sm` (600px), so it is the width that fails
// if the mount point drifts *downward*, to `sm`. It is also the width Story 6.10's operator pass
// measured the single-column layout at.
const TABLET_WIDTH = 820;
const SINGLE_COLUMN_WIDTHS = [PHONE_WIDTH, TABLET_WIDTH];

const controlsCards = () => document.querySelectorAll("[data-testid='trip-controls-card']");

// The strings the two new keys resolve to in the test locale (`en`). Named rather than inlined,
// because Story 2.33's whole point about the assertions it replaces is that they queried labels no
// dictionary contained - a constant next to the dictionary's own wording is harder to drift from.
const EXPORT_LABEL = "Export backup";
const IMPORT_LABEL = "Import backup";
const EXPORT_ERROR = "Trip export failed. Please try again.";
// The two envelope codes the export path maps to something better than the generic sentence above.
const EXPORT_NOT_FOUND = "This trip might have been deleted or you may not have access to it.";
const EXPORT_UNAUTHORIZED = "Authentication required. Please sign in.";
// What the export route sends in `content-disposition`; the client reads the saved name out of it.
const EXPORT_FILENAME = "trip-owner-trip-2026-08-03.zip";
// Only reached when the header is missing, which the route never does - so this is the client's own
// fallback, and the assertion that it is still wired is the only thing standing between a changed
// header name and every archive landing on disk under an object-URL uuid.
const EXPORT_FILENAME_FALLBACK = "trip-backup.zip";

/**
 * jsdom implements neither `URL.createObjectURL` nor `URL.revokeObjectURL`, and the export button's
 * save path calls both. Assigned onto the `URL` constructor rather than installed with
 * `vi.stubGlobal`, which reaches `globalThis` properties only, and deliberately left in place for
 * the whole file instead of being torn down per case: the component revokes on a `setTimeout(0)`
 * that can outlive the case that started it, and a removed stub would then surface as an unhandled
 * error inside a timer rather than as a test failure. Each case clears the calls it cares about.
 */
// What the save path was handed, recorded as it goes by. Read from here rather than from
// `createObjectURL.mock.calls`, whose tuple type is empty for a zero-arg mock and cannot be indexed.
const objectUrlSources: Blob[] = [];
const createObjectURL = vi.fn((blob: Blob) => {
  objectUrlSources.push(blob);
  return "blob:trip-export";
});
const revokeObjectURL = vi.fn();
Object.assign(URL, { createObjectURL, revokeObjectURL });

/**
 * Trip-overview role gating and day-row status rendering.
 *
 * These cases were rescued from `tripTimelineFeedback.test.tsx`, which Story 5.9 deleted as
 * "feedback-only". It was not: it held the only `TripTimeline` coverage for non-owner access
 * roles, and the only assertions pinning that booked/planned status strings stay *off* the day
 * row. The feedback triggers and dialogs are gone; the role gating and status-absence assertions
 * below are the non-feedback half, restored verbatim in intent.
 */
describe("TripTimeline role gating", () => {
  // Each case ends with its own `vi.unstubAllGlobals()`, which a failing assertion skips - leaking
  // the stubbed `fetch` into every case after it and turning one real failure into a cascade of
  // misleading ones. This runs regardless.
  afterEach(() => {
    // Also removes the `matchMedia` `setViewportWidth` stubs, returning it to jsdom's own state of
    // not defining it at all.
    vi.unstubAllGlobals();
  });

  type TripOverrides = { name: string; accessRole: "owner" | "contributor" | "viewer" };

  const buildDetailResponse = (
    trip: TripOverrides & { heroImageUrl?: string | null; updatedAt?: string },
    day: { missingAccommodation: boolean; accommodation: unknown },
  ) => ({
    data: {
      trip: {
        id: "trip-1",
        name: trip.name,
        currentUserId: "u1",
        accessRole: trip.accessRole,
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2026-12-02T00:00:00.000Z",
        dayCount: 1,
        plannedCostTotal: 0,
        accommodationCostTotalCents: null,
        heroImageUrl: trip.heroImageUrl ?? null,
        updatedAt: trip.updatedAt,
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
          missingAccommodation: day.missingAccommodation,
          missingPlan: true,
          accommodation: day.accommodation,
          dayPlanItems: [],
          travelSegments: [],
        },
      ],
    },
    error: null,
  });

  /**
   * `exportResponse` is what `GET /api/trips/trip-1/export` answers. It is optional so that every
   * case predating Story 2.33 keeps its exact behaviour, and so that a case which never presses the
   * export button still trips the `Unhandled fetch` throw below if the component starts calling the
   * route on its own.
   *
   * `gate` is awaited before the export response resolves, which is the only way to observe the
   * in-flight state: without it the request settles inside the same click that started it and the
   * disabled/spinner window never exists for an assertion to see.
   *
   * `throws` models a request that never produced a response at all - offline, DNS failure, the
   * connection dropped mid-archive. It is a distinct branch in the component (`catch`, not
   * `!response.ok`) and AC5 names it, so it needs a way in here.
   *
   * `errorCode` is the envelope code a failing response carries; the component maps it to a
   * message. `withoutFilename` drops `content-disposition` so the client's fallback name is
   * reachable.
   */
  type ExportStub = {
    ok: boolean;
    status: number;
    gate?: Promise<unknown>;
    throws?: boolean;
    errorCode?: string;
    withoutFilename?: boolean;
  };

  const stubDetailFetch = (body: ReturnType<typeof buildDetailResponse>, exportResponse?: ExportStub) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return { ok: true, status: 200, json: async () => body };
      }

      if (exportResponse && url.endsWith("/api/trips/trip-1/export") && method === "GET") {
        await exportResponse.gate;

        if (exportResponse.throws) {
          throw new TypeError("Failed to fetch");
        }

        return {
          ok: exportResponse.ok,
          status: exportResponse.status,
          // Only `content-disposition` is read; anything else answers null the way a real `Headers`
          // does for an absent header, so a lookup that drifts fails loudly rather than silently.
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-disposition" && !exportResponse.withoutFilename
                ? `attachment; filename="${EXPORT_FILENAME}"`
                : null,
          },
          blob: async () => new Blob(["PK"], { type: "application/zip" }),
          // The failure envelope the route really sends, and the component now reads it: the code
          // decides which message the user gets, so a stub returning the wrong shape here shows up
          // as the generic fallback rather than passing quietly.
          json: async () => ({
            data: null,
            error: { code: exportResponse.errorCode ?? "not_found", message: "Trip not found" },
          }),
        };
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("hides every owner-only trip action from a viewer", async () => {
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Viewer Trip", accessRole: "viewer" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    // Story 2.33 AC3/AC4: Export is back on the overview, gated on `isOwner`, so a viewer must not
    // see it - and gets no controls card to hold it either. Import never came here; Story 2.32 left
    // it on the trips list, and its absence is asserted for all three roles (AC6).
    //
    // Queried by the strings the dictionary actually holds. Until Story 2.33 these two lines asked
    // for "Import JSON" and "Export JSON", which are in neither `en.ts` nor `de.ts` - the
    // assertions could not have failed, whatever the component rendered.
    expect(screen.queryByRole("button", { name: IMPORT_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EXPORT_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bucket-list-panel")).not.toBeInTheDocument();

    // A viewer still gets the read-only overview itself.
    expect(screen.getByRole("heading", { name: "Viewer Trip", level: 4 })).toBeInTheDocument();
    expect(screen.getByText("Dec 1, 2026 - Dec 2, 2026")).toBeInTheDocument();
    expect(screen.getByTestId("overview-map-panel")).toBeInTheDocument();

    const dayCard = screen.getByTestId("timeline-day-card");
    expect(dayCard).toHaveTextContent("Planned 0m, Unplanned 24h");
    expect(dayCard).not.toHaveTextContent("Accommodation missing");
    expect(dayCard).not.toHaveTextContent("Plan missing");

    vi.unstubAllGlobals();
  });

  it("renders the owner's bucket list inside the overview's side column, not as a full-width block", async () => {
    // Story 7.12 AC1. Asserted as an ancestor relationship rather than a sibling index, so the case
    // survives a reordering of the sidebar's cards but still fails if the panel escapes the column.
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Sidebar Trip", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const sideColumn = screen.getByTestId("trip-overview-side-column");
    const panel = screen.getByTestId("bucket-list-panel");

    expect(within(sideColumn).getByTestId("bucket-list-panel")).toBe(panel);
    // The map panel is the sidebar card the bucket list sits below; both live in the same column.
    expect(within(sideColumn).getByTestId("overview-map-panel")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows contributor trip editing while keeping owner-only management actions hidden", async () => {
    const fetchMock = stubDetailFetch(
      buildDetailResponse(
        { name: "Contributor Trip", accessRole: "contributor" },
        { missingAccommodation: true, accommodation: null },
      ),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    expect(screen.getByRole("button", { name: "Edit trip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    // Story 2.33 AC3: a contributor gets the card and its Edit button, but Export sits with Delete
    // on `isOwner` - the route answers 404 to a contributor, so a visible button would only produce
    // a bare "not found", which is what Story 7.8 removed the old one over.
    expect(screen.queryByRole("button", { name: EXPORT_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: IMPORT_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bucket-list-panel")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows Export to an owner beside Edit and Delete, and still no Import", async () => {
    // Story 2.33 AC1/AC3/AC4, and the deliberate inversion of what Story 7.8 asserted here. 7.8
    // pinned the *absence* of both controls for every role because the export button of the day was
    // ungated and handed a contributor or viewer a bare 404. Story 2.33 gates the button on
    // `isOwner`, so the reason for the absence is gone and the owner half of the assertion flips to
    // presence. The two non-owner halves above stay as they were. Import does not flip: Story 2.32
    // put it on the trips list and this story does not move it (AC6).
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Owner Trip", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const card = screen.getByTestId("trip-controls-card");

    // AC1: three buttons in the one existing row, in one card - not a second card and not a toolbar.
    expect(within(card).getByRole("button", { name: "Edit trip" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Delete trip" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: EXPORT_LABEL })).toBeInTheDocument();
    expect(controlsCards()).toHaveLength(1);
    // The same outlined treatment as its two siblings, carried by the class MUI puts on `variant`.
    expect(within(card).getByRole("button", { name: EXPORT_LABEL }).className).toMatch(/MuiButton-outlined/);
    expect(screen.queryByRole("button", { name: IMPORT_LABEL })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("exports the trip being viewed, saves it under the server's filename, and stays on the overview", async () => {
    // Story 2.33 AC2, and the save path in full. Two claims are mechanical here and neither is
    // observable as an actual file, because jsdom writes none:
    //
    //   1. The id in the request path. A wrong one hands the owner a 404 or somebody else's archive.
    //   2. The name on the anchor. Without it the browser falls back to the object URL's uuid, and
    //      an archive called `a3f1e0c2-...` is not a backup anyone can find again. This is asserted
    //      by spying on the click and reading the element it fired on - the earlier version of this
    //      case asserted only that `createObjectURL` was called, which a mutation proved would keep
    //      passing with `anchor.download` deleted outright.
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    objectUrlSources.length = 0;
    // The anchor is captured at click time rather than read off `clickSpy.mock.instances`, whose
    // vitest typing follows the spied method's `void` return and cannot be narrowed to the element.
    const clickedAnchors: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchors.push(this);
    });
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Export Owner", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
      { ok: true, status: 200 },
    );
    const user = userEvent.setup();

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await user.click(screen.getByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trips/trip-1/export",
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store" }),
    );
    // The blob handed to the object URL is the archive, not something rebuilt on the way.
    expect(objectUrlSources[0]).toBeInstanceOf(Blob);

    const anchor = clickedAnchors[0];
    expect(anchor.download).toBe(EXPORT_FILENAME);
    expect(anchor.href).toContain("blob:trip-export");
    // Detached again straight after the click, and the object URL released on the next tick, so a
    // repeated export cannot pin one archive per attempt for the lifetime of the tab.
    expect(anchor.isConnected).toBe(false);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:trip-export"));

    // AC2: the trip is still mounted afterwards - no navigation, no new tab, and the button is back
    // to its resting state rather than stuck disabled.
    expect(screen.getByRole("heading", { name: "Export Owner", level: 4 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();
    expect(screen.queryByText(EXPORT_ERROR)).not.toBeInTheDocument();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("falls back to a fixed archive name when the response carries no content-disposition", async () => {
    // The other half of the filename path. The route always sends the header, so this branch only
    // runs if something upstream changes - which is exactly when a silent fall-through to an
    // object-URL uuid would go unnoticed.
    const clickedAnchors: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchors.push(this);
    });
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Nameless Export", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
      { ok: true, status: 200, withoutFilename: true },
    );
    const user = userEvent.setup();

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await user.click(screen.getByRole("button", { name: EXPORT_LABEL }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(clickedAnchors[0].download).toBe(EXPORT_FILENAME_FALLBACK);

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("reports a request that never produced a response", async () => {
    // AC5's second failure mode: offline, DNS failure, the connection dropped mid-archive. It is a
    // different branch in the component from a non-2xx response - `catch`, not `!response.ok` - and
    // nothing else in the suite reaches it.
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Offline Export", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
      { ok: false, status: 0, throws: true },
    );
    const user = userEvent.setup();

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await user.click(screen.getByRole("button", { name: EXPORT_LABEL }));

    const card = screen.getByTestId("trip-controls-card");
    await waitFor(() => expect(within(card).getByText(EXPORT_ERROR)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();

    vi.unstubAllGlobals();
  });

  it("tells an expired session apart from a generic export failure", async () => {
    // A tab left open past session expiry: middleware answers 401 `unauthorized` for every
    // `/api/trips/*` request. Reporting "please try again" there sends the user to press a button
    // that can never work; the envelope code is read so they are told to sign in instead.
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Expired Export", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
      { ok: false, status: 401, errorCode: "unauthorized" },
    );
    const user = userEvent.setup();

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await user.click(screen.getByRole("button", { name: EXPORT_LABEL }));

    const card = screen.getByTestId("trip-controls-card");
    await waitFor(() => expect(within(card).getByText(EXPORT_UNAUTHORIZED)).toBeInTheDocument());
    expect(within(card).queryByText(EXPORT_ERROR)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("disables the export button while the request is in flight and reports a failure inside the card", async () => {
    // Story 2.33 AC5, both halves, in one case because they are two points on one request: the
    // pending state exists only between the click and the response, so the gate that lets the
    // pending state be observed is the same gate that delays the failure.
    //
    // 404 rather than 500: that is what the route answers for a trip that vanished between load and
    // press, and for a non-owner - the realistic failure. The message asserted below is the
    // not-found one rather than the generic export sentence, because the component reads the
    // envelope code; "please try again" would be wrong advice for a trip that is gone.
    let releaseExport = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Failing Export", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
      { ok: false, status: 404, gate },
    );
    const user = userEvent.setup();

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await user.click(screen.getByRole("button", { name: EXPORT_LABEL }));

    // Mid-flight: disabled, and still findable by its accessible name even though the label has been
    // replaced by a spinner - `aria-label` is what keeps it reachable here and to a screen reader.
    await waitFor(() => expect(screen.getByRole("button", { name: EXPORT_LABEL })).toBeDisabled());
    expect(within(screen.getByRole("button", { name: EXPORT_LABEL })).getByRole("progressbar")).toBeInTheDocument();

    releaseExport();

    const card = screen.getByTestId("trip-controls-card");
    await waitFor(() => expect(within(card).getByText(EXPORT_NOT_FOUND)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: EXPORT_LABEL })).toBeEnabled();

    // The failure lands in the card's own slot, not the page-level one: the trip is still rendered
    // and the `error && !detail` recovery branch - a "Back to trips" button above everything - has
    // not been triggered. Wiring this into `error` would have replaced a working page with it.
    expect(screen.getByRole("heading", { name: "Failing Export", level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "← Back to trips" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders no trip-controls card at all for a viewer (empty-card guard)", async () => {
    // Task 5's edge case: with Export removed, a viewer would otherwise see an empty 18px-padded
    // bordered card. The whole block is now guarded on `canEditPlanning || isOwner`.
    //
    // Pinned at the desktop width by Story 6.14: before that pin this case rode on jsdom's absent
    // `matchMedia` and so silently exercised only the phone mount point. The phone side has its own
    // viewer case below; this one is the desktop half it used to be.
    setViewportWidth(DESKTOP_WIDTH);
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Viewer Card Trip", accessRole: "viewer" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    // Neither Edit nor Delete is rendered, and there is no empty container either.
    expect(screen.queryByRole("button", { name: "Edit trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    expect(controlsCards()).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("renders owner Edit and Delete inside the controls card without MUI's error-red color", async () => {
    // AC2's only mechanical assertion: Delete stays outlined-secondary, never `color="error"`.
    // MUI marks non-default color buttons with `MuiButton-{outlined,color}{Error,Warning,Info,Success}`
    // classes - the assertion is that none of those apply to the Delete button.
    //
    // Pinned at the desktop width for the same reason as the viewer case above: Story 6.14 gave the
    // card two mount points, and without a pin this would only ever check the phone one.
    setViewportWidth(DESKTOP_WIDTH);
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Owner Controls", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const editButton = screen.getByRole("button", { name: "Edit trip" });
    const deleteButton = screen.getByRole("button", { name: "Delete trip" });

    expect(editButton).toBeInTheDocument();
    expect(deleteButton).toBeInTheDocument();
    expect(controlsCards()).toHaveLength(1);
    expect(deleteButton.className).not.toMatch(/MuiButton-(outlined|color)(Error|Warning|Info|Success)/);

    vi.unstubAllGlobals();
  });

  it.each(TWO_COLUMN_WIDTHS)(
    "ends the day column with the controls card, below the last day row, in the two-column layout at %ipx",
    async (width) => {
      // Story 6.10 AC1/AC6, now scoped to the layout it was always about, per Story 6.14 AC3. Ancestry
      // plus document order, not a sibling index: the card must be inside the grid's day column (AC1)
      // and be the last thing in it (AC6), while an unrelated insertion elsewhere in the column leaves
      // the case alone. Membership on its own would pass with the card rendered above the timeline
      // heading, which is neither of those things.
      //
      // Story 6.14 kept the ancestry assertion rather than replacing it with a position among the
      // grid's children: "in the content column" is the claim that makes the width right, and it
      // survives the sidebar or the day list gaining blocks.
      setViewportWidth(width);
      const fetchMock = stubDetailFetch(
        buildDetailResponse({ name: "Controls Placement", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
      );

      renderWithProviders(<TripTimeline tripId="trip-1" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

      const dayColumn = screen.getByTestId("trip-overview-main-column");
      const card = screen.getByTestId("trip-controls-card");
      const dayRows = within(dayColumn).getAllByTestId("timeline-day-card");

      expect(dayColumn.contains(card)).toBe(true);
      expect(dayColumn.lastElementChild).toBe(card);
      // DOCUMENT_POSITION_FOLLOWING: the card comes after the day rows it has to line up with.
      expect(dayRows[dayRows.length - 1].compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );

      // Story 6.14 AC4: the grid still holds exactly its two columns here - the phone position is a
      // third grid child, and if it rendered at this width the card would be duplicated or displaced.
      // Identity per child, not `toEqual` on the collection: `toEqual` compares DOM nodes
      // structurally, so a *clone* of the day column would satisfy it - and AC6 is precisely about
      // a second copy of a node.
      const grid = screen.getByTestId("trip-overview-grid");
      const sideColumn = screen.getByTestId("trip-overview-side-column");
      expect(grid.children).toHaveLength(2);
      expect(grid.children[0]).toBe(dayColumn);
      expect(grid.children[1]).toBe(sideColumn);
      // AC6: one card, not one visible and one hidden.
      expect(controlsCards()).toHaveLength(1);
      // AC4: no loose full-width block after the grid. Stated as "every controls card in the
      // document is inside the grid" rather than as `grid.nextElementSibling === null`, because the
      // grid's real siblings are the dialogs, which this file mocks as bare divs - that assertion
      // would fail on the mocks while saying nothing about layout.
      expect(Array.from(controlsCards()).every((node) => grid.contains(node))).toBe(true);
    },
  );

  it("declares the grid's own column split under the same `md` condition the mount point is keyed to", async () => {
    // Story 6.14 Trap 3, and the half the placement cases structurally cannot reach. The card's
    // position is chosen in JS (`useMediaQuery(theme.breakpoints.up("md"))`) while the stacking it
    // has to agree with is chosen in CSS (`gridTemplateColumns: { xs, md }`). jsdom evaluates no
    // media query, so every other case in this file reads only the JS half: move the *CSS* half to
    // `lg` and they all stay green while a real browser at 1000px stacks the layout and still mounts
    // the card inside the day column - the exact defect this story exists to remove. Reading the
    // emitted rule pins the two halves to one number. This is DW-14's failure mode, closed for the
    // one declaration that now carries structural weight.
    setViewportWidth(DESKTOP_WIDTH);
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Grid Breakpoint", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const columns = emotionPropertyConditions(screen.getByTestId("trip-overview-grid"), "grid-template-columns");

    // MUI emits `xs` as `(min-width:0px)` rather than as an unconditional rule, so the whole
    // responsive object shows up as exactly two conditions. Listing both, in order, is what makes
    // this fail if the split moves to `lg`, or if a third breakpoint is bolted on beside it.
    expect(columns.base).toBe(false);
    expect(columns.media).toEqual([XS_MEDIA_CONDITION, MD_MEDIA_CONDITION]);
  });

  it.each(SINGLE_COLUMN_WIDTHS)("puts the controls card last on the page at %ipx, after the sidebar's cards", async (width) => {
    // Story 6.14 AC1/AC4/AC6. Below `md` the grid stacks and DOM order is visual order, so "last on
    // the page" is a document-order claim about the card against the sidebar's content - stated as
    // ancestry plus `compareDocumentPosition`, not a sibling index, so it survives the sidebar
    // gaining or losing a card.
    //
    // The card stays *inside* the grid as a third child: that is what gives it the grid's `1fr`
    // track and its `gap: { xs: 2 }` without a width, margin or wrapper of its own, and it is why
    // no loose full-width block reappears after the grid (AC4).
    setViewportWidth(width);
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Controls Last", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const grid = screen.getByTestId("trip-overview-grid");
    const dayColumn = screen.getByTestId("trip-overview-main-column");
    const sideColumn = screen.getByTestId("trip-overview-side-column");
    const card = screen.getByTestId("trip-controls-card");

    // AC6: exactly one card exists - the two mount points are alternatives, never both.
    expect(controlsCards()).toHaveLength(1);

    // Inside the grid, but in neither column: it is the grid's own last child.
    expect(grid.contains(card)).toBe(true);
    expect(dayColumn.contains(card)).toBe(false);
    expect(sideColumn.contains(card)).toBe(false);
    expect(grid.lastElementChild).toBe(card);

    // AC1: after everything the sidebar holds - the cost summary, the map, the bucket list and the
    // gap alert - which is the ordering Story 6.10 broke and this story restores.
    [sideColumn, screen.getByTestId("overview-map-panel"), screen.getByTestId("bucket-list-panel")].forEach((node) => {
      expect(node.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
    // The gap alert carries no test id; it is the side column's last block, so assert against that.
    // Guarded, because a side column that lost its last child would otherwise throw here and the
    // failure would read as a crash rather than as the missing gap alert it is.
    const gapAlert = sideColumn.lastElementChild;
    expect(gapAlert).not.toBeNull();
    expect(gapAlert).toHaveTextContent("Action needed: Day 1");
    expect(gapAlert!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // AC4: no loose full-width block after the grid. The card is the grid's own last child rather
    // than a block following it, which is what keeps it in the grid's `1fr` track and its `gap`
    // without a wrapper of its own. Phrased against the cards rather than `grid.nextElementSibling`,
    // whose real value here is a mocked dialog stub.
    expect(Array.from(controlsCards()).every((node) => grid.contains(node))).toBe(true);

    // AC2/AC7 hold at this width too: still no constraint of its own, still gated.
    const declared = emotionDeclaredProperties(card);
    WIDTH_AND_SPACING_PROPERTIES.forEach((property) => {
      expect(declared.has(property)).toBe(false);
    });
    expect(within(card).getByRole("button", { name: "Edit trip" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Delete trip" })).toBeInTheDocument();
  });

  it("renders no controls card for a viewer in the single-column layout either", async () => {
    // Story 6.14 AC7. The guard travels with the element rather than sitting beside one of its two
    // mount points, so moving the card must not open a width at which a viewer gets an empty
    // bordered card - the defect Story 7.8 Task 5 fixed.
    setViewportWidth(PHONE_WIDTH);
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Viewer Phone", accessRole: "viewer" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    expect(controlsCards()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Edit trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    // The grid is back to its two columns, with nothing appended in the card's place.
    const grid = screen.getByTestId("trip-overview-grid");
    expect(grid.children).toHaveLength(2);
  });

  it("lets the day column's padding set the controls card's width, with no constraint on the card", async () => {
    // Story 6.10 AC2, in two halves, because either one alone passes while the card is misaligned:
    // the column must still declare the padding that produces the day rows' width, and the card must
    // declare nothing that overrides it. The trailing 8px `marginBottom` of the last day row is the
    // column's spacing rhythm, so a margin here would stack a second gap on top of it as well.
    //
    // Story 6.14 AC2/AC3: pinned at the desktop width, because that is where the card is a child of
    // this column and where the two properties below combine into the day rows' width.
    setViewportWidth(DESKTOP_WIDTH);
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Controls Width", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const dayColumn = screen.getByTestId("trip-overview-main-column");
    const card = screen.getByTestId("trip-controls-card");

    // The mechanism: 28px of right padding on the column is what holds every block in it, day rows
    // and card alike, off the grid's gutter. Drop it and the card silently widens again.
    const columnPadding = emotionDeclarations(dayColumn, "padding");
    // `0` comes back as `0px` - the CSSOM normalises it on the way in.
    expect(columnPadding.media.get(MD_MEDIA_CONDITION)).toEqual(["22px 28px 22px 0px"]);

    const declared = emotionDeclaredProperties(card);

    expect(card.getAttribute("style")).toBeNull();
    WIDTH_AND_SPACING_PROPERTIES.forEach((property) => {
      expect(declared.has(property)).toBe(false);
    });
    // Story 7.8's treatment is untouched (AC5) - the same rule set still carries it. Also the canary
    // proving the helper found this element's rules at all, so the absences above are not vacuous.
    expect(declared.has("border-radius")).toBe(true);
    expect(declared.has("padding")).toBe(true);
  });

  /**
   * Regression: a freshly uploaded hero appeared, then vanished on the next navigation back to the
   * overview, leaving the bare `primary.main` background showing through.
   *
   * Cause: the upload route replaces `hero.<ext>` in place, so the stored URL is byte-identical
   * across replacements. The cache-buster was applied only inside the edit/create dialogs at upload
   * time, so the URL held in component state was versioned but the one this component refetched from
   * the API was not - and the browser kept serving its pre-upload cache entry for that key.
   *
   * The fix versions the hero at *read* time from `trip.updatedAt`, which is what day images already
   * do. This asserts the rendered URL actually carries the version.
   */
  it("versions the hero image URL so a replaced hero is refetched", async () => {
    const fetchMock = stubDetailFetch(
      buildDetailResponse(
        {
          name: "Hero Trip",
          accessRole: "owner",
          heroImageUrl: "/uploads/trips/trip-1/hero.png",
          updatedAt: "2026-12-05T10:11:12.345Z",
        },
        { missingAccommodation: true, accommodation: null },
      ),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const hero = screen.getByTestId("trip-hero");
    const background = window.getComputedStyle(hero).backgroundImage;

    expect(background).toContain("/uploads/trips/trip-1/hero.png");
    // Versioned, and with the timestamp reduced to alphanumerics so `encodeURI` in `toCssUrl` is a
    // fixed point on it (a `%3A` from the colons would be re-escaped to `%253A` and 404).
    expect(background).toContain("?v=20261205T101112345Z");
    expect(background).not.toMatch(/%25/);
    // Never double-stamped - the dialogs hand over a raw URL plus its version, not a stamped URL.
    expect(background.match(/[?&]v=/g)).toHaveLength(1);
  });

  it("leaves the placeholder unversioned when the trip has no hero image", async () => {
    const fetchMock = stubDetailFetch(
      buildDetailResponse(
        { name: "No Hero Trip", accessRole: "owner", heroImageUrl: null, updatedAt: "2026-12-05T10:11:12.345Z" },
        { missingAccommodation: true, accommodation: null },
      ),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const background = window.getComputedStyle(screen.getByTestId("trip-hero")).backgroundImage;
    expect(background).toContain("/images/world-map-placeholder.svg");
    expect(background).not.toContain("?v=");
  });

  it("keeps booked/planned status strings off the day row while showing the stay name", async () => {
    const fetchMock = stubDetailFetch(
      buildDetailResponse(
        { name: "Accommodation Trip", accessRole: "viewer" },
        {
          missingAccommodation: false,
          accommodation: {
            id: "stay-1",
            name: "Booked stay",
            notes: null,
            status: "booked",
            costCents: null,
            link: null,
            checkInTime: null,
            checkOutTime: null,
            location: null,
          },
        },
      ),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const dayCard = screen.getByTestId("timeline-day-card");
    // The day-row's stay indicator shows the accommodation's own name ("Booked stay" is this
    // fixture's name, not a status string) and only distinguishes "has a stay" vs. "gap" per the
    // redesign. Booked/planned status is deliberately no longer surfaced here - it remains visible
    // in the accommodation's own edit dialog - so assert its absence explicitly rather than letting
    // a name that happens to contain "Booked" imply status coverage that no longer exists.
    const stayIndicator = within(dayCard).getByTestId("day-row-stay");
    expect(stayIndicator).toHaveTextContent("Booked stay");
    expect(within(dayCard).queryByText("booked")).toBeNull();
    expect(within(dayCard).queryByText("planned")).toBeNull();
    expect(within(dayCard).queryByTestId("day-row-gap-pill")).toBeNull();
    expect(dayCard).toHaveTextContent("Planned 8h, Unplanned 16h");
    expect(dayCard).toContainElement(screen.getByTestId("day-row-stay"));

    vi.unstubAllGlobals();
  });
});
