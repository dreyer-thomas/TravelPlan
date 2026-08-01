// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
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

  const stubDetailFetch = (body: ReturnType<typeof buildDetailResponse>) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return { ok: true, status: 200, json: async () => body };
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
    // Story 7.8: the Import/Export UI entry points were removed for every role. The label the
    // component used to render was `trips.import.action` = "Import JSON" (not "Import trip", which
    // was the vacuous name the pre-7.8 assertion queried), so query by the real strings.
    expect(screen.queryByRole("button", { name: "Import JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Import JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bucket-list-panel")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("hides Import and Export from an owner as well - the assertion AC3/AC4 actually turn on", async () => {
    // The old two role tests (viewer, contributor) would both have passed even if Import/Export
    // still rendered for owners; the queried "Import trip" name never existed. This owner case is
    // the missing anchor that fails the moment either button comes back.
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Owner Trip", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    expect(screen.queryByRole("button", { name: "Import JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders no trip-controls card at all for a viewer (empty-card guard)", async () => {
    // Task 5's edge case: with Export removed, a viewer would otherwise see an empty 18px-padded
    // bordered card. The whole block is now guarded on `canEditPlanning || isOwner`.
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Viewer Card Trip", accessRole: "viewer" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    // Neither Edit nor Delete is rendered, and there is no empty container either.
    expect(screen.queryByRole("button", { name: "Edit trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-testid='trip-controls-card']")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("renders owner Edit and Delete inside the controls card without MUI's error-red color", async () => {
    // AC2's only mechanical assertion: Delete stays outlined-secondary, never `color="error"`.
    // MUI marks non-default color buttons with `MuiButton-{outlined,color}{Error,Warning,Info,Success}`
    // classes - the assertion is that none of those apply to the Delete button.
    const fetchMock = stubDetailFetch(
      buildDetailResponse({ name: "Owner Controls", accessRole: "owner" }, { missingAccommodation: true, accommodation: null }),
    );

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const editButton = screen.getByRole("button", { name: "Edit trip" });
    const deleteButton = screen.getByRole("button", { name: "Delete trip" });

    expect(editButton).toBeInTheDocument();
    expect(deleteButton).toBeInTheDocument();
    expect(document.querySelector("[data-testid='trip-controls-card']")).not.toBeNull();
    expect(deleteButton.className).not.toMatch(/MuiButton-(outlined|color)(Error|Warning|Info|Success)/);

    vi.unstubAllGlobals();
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
