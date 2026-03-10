// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { I18nProvider } from "@/i18n/provider";

vi.mock("@/components/features/trips/TripEditDialog", () => ({ default: () => <div data-testid="edit-dialog" /> }));
vi.mock("@/components/features/trips/TripDeleteDialog", () => ({ default: () => <div data-testid="delete-dialog" /> }));
vi.mock("@/components/features/trips/TripImportDialog", () => ({ default: () => <div data-testid="import-dialog" /> }));
vi.mock("@/components/features/trips/TripShareDialog", () => ({ default: () => <div data-testid="share-dialog" /> }));
vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({ default: () => <div data-testid="overview-map-panel" /> }));
vi.mock("@/components/features/trips/TripBucketListPanel", () => ({ default: () => <div data-testid="bucket-list-panel" /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("TripTimeline feedback", () => {
  it("renders viewer-safe feedback controls and hides owner-only trip actions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: {
                id: "trip-1",
                name: "Viewer Trip",
                currentUserId: "u1",
                accessRole: "viewer",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 1,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
                feedback: {
                  targetType: "trip",
                  targetId: "trip-1",
                  comments: [],
                  voteSummary: { upCount: 0, downCount: 0, userVote: null },
                },
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
                  feedback: {
                    targetType: "tripDay",
                    targetId: "day-1",
                    comments: [],
                    voteSummary: { upCount: 0, downCount: 0, userVote: null },
                  },
                },
              ],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/auth/csrf") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/feedback/comments") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              feedback: {
                targetType: "tripDay",
                targetId: "day-1",
                comments: [{ id: "comment-1", body: "Looks promising", createdAt: "", updatedAt: "", author: { id: "u1", email: "viewer@example.com" } }],
                voteSummary: { upCount: 0, downCount: 0, userVote: null },
              },
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bucket-list-panel")).not.toBeInTheDocument();

    expect(screen.queryByLabelText("Add a comment")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open comments dialog for Viewer Trip, no comments, Upvote 0, Downvote 0",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open comments dialog for Day 1, no comments",
      }),
    ).toBeInTheDocument();
    const metaRow = screen.getByTestId("timeline-day-meta-row");
    expect(metaRow).toContainElement(
      screen.getByRole("button", {
        name: "Open comments dialog for Day 1, no comments",
      }),
    );
    expect(metaRow).toHaveTextContent("Planned 0m, Unplanned 24h");
    expect(metaRow).not.toHaveTextContent("Accommodation missing");
    expect(metaRow).not.toHaveTextContent("Plan missing");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Open comments dialog for Day 1, no comments",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Comments for Day 1" });
    expect(within(dialog).queryByRole("button", { name: /Upvote/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Downvote/i })).not.toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText("Add a comment"), "Looks promising");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("Looks promising")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows contributor trip editing while keeping owner-only management actions hidden", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: {
                id: "trip-1",
                name: "Contributor Trip",
                currentUserId: "u2",
                accessRole: "contributor",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 1,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
                feedback: {
                  targetType: "trip",
                  targetId: "trip-1",
                  comments: [],
                  voteSummary: { upCount: 0, downCount: 0, userVote: null },
                },
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
                  feedback: {
                    targetType: "tripDay",
                    targetId: "day-1",
                    comments: [],
                    voteSummary: { upCount: 0, downCount: 0, userVote: null },
                  },
                },
              ],
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    expect(screen.getByRole("button", { name: "Edit trip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import trip" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("bucket-list-panel")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("keeps accommodation status and comments trigger in the same compact metadata row", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: {
                id: "trip-1",
                name: "Accommodation Trip",
                currentUserId: "u1",
                accessRole: "viewer",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 1,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
                feedback: {
                  targetType: "trip",
                  targetId: "trip-1",
                  comments: [],
                  voteSummary: { upCount: 0, downCount: 0, userVote: null },
                },
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
                  missingAccommodation: false,
                  missingPlan: true,
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
                    feedback: {
                      targetType: "accommodation",
                      targetId: "stay-1",
                      comments: [],
                      voteSummary: { upCount: 0, downCount: 0, userVote: null },
                    },
                  },
                  dayPlanItems: [],
                  travelSegments: [],
                  feedback: {
                    targetType: "tripDay",
                    targetId: "day-1",
                    comments: [],
                    voteSummary: { upCount: 0, downCount: 0, userVote: null },
                  },
                },
              ],
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    const metaRow = screen.getByTestId("timeline-day-meta-row");
    expect(metaRow).toHaveTextContent("booked");
    expect(metaRow).toHaveTextContent("Planned 8h, Unplanned 16h");
    expect(metaRow).toContainElement(
      screen.getByRole("button", {
        name: "Open comments dialog for Day 1, no comments",
      }),
    );
    expect(metaRow).toContainElement(screen.getByTestId("timeline-accommodation-surface"));

    vi.unstubAllGlobals();
  });
});
