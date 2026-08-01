// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { renderWithProviders } from "./helpers/renderWithProviders";

vi.mock("@/components/features/trips/TripEditDialog", () => ({ default: () => <div data-testid="edit-dialog" /> }));
vi.mock("@/components/features/trips/TripDeleteDialog", () => ({ default: () => <div data-testid="delete-dialog" /> }));
vi.mock("@/components/features/trips/TripShareDialog", () => ({ default: () => <div data-testid="share-dialog" /> }));
vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({ default: () => <div data-testid="overview-map-panel" /> }));
vi.mock("@/components/features/trips/TripBucketListPanel", () => ({ default: () => <div data-testid="bucket-list-panel" /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("hero diagnostic", () => {
  it("dumps hero background", async () => {
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
                name: "Hero Trip",
                currentUserId: "u1",
                accessRole: "owner",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 1,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: "/uploads/trips/trip-1/hero.png",
              },
              days: [],
            },
            error: null,
          }),
        };
      }
      if (url.endsWith("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "t" }, error: null }) };
      }
      throw new Error(`Unhandled ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<TripTimeline tripId="trip-1" />);

    const hero = await waitFor(() => screen.getByTestId("trip-hero"));
    const cs = window.getComputedStyle(hero);
    // eslint-disable-next-line no-console
    console.log("CLASS:", hero.className);
    // eslint-disable-next-line no-console
    console.log("backgroundImage:", cs.backgroundImage);
    // eslint-disable-next-line no-console
    console.log("backgroundColor:", cs.backgroundColor);
    // eslint-disable-next-line no-console
    console.log("background:", cs.background);
    expect(hero).toBeInTheDocument();
  });
});
