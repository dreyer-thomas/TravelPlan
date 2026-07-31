// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { renderWithProviders } from "./helpers/renderWithProviders";

vi.mock("@/components/features/trips/TripDeleteDialog", () => ({ default: () => <div data-testid="delete-dialog" /> }));
vi.mock("@/components/features/trips/TripImportDialog", () => ({ default: () => <div data-testid="import-dialog" /> }));
vi.mock("@/components/features/trips/TripShareDialog", () => ({ default: () => <div data-testid="share-dialog" /> }));
vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({ default: () => <div data-testid="overview-map-panel" /> }));
vi.mock("@/components/features/trips/TripBucketListPanel", () => ({ default: () => <div data-testid="bucket-list-panel" /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const tripPayload = (heroImageUrl: string | null) => ({
  id: "trip-1",
  name: "Hero Trip",
  currentUserId: "u1",
  accessRole: "owner",
  startDate: "2026-12-01T00:00:00.000Z",
  endDate: "2026-12-02T00:00:00.000Z",
  dayCount: 1,
  plannedCostTotal: 0,
  accommodationCostTotalCents: null,
  heroImageUrl,
});

describe("trip hero image", () => {
  it("paints the stored hero image as the hero background on load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/trips/trip-1")) {
        return { ok: true, status: 200, json: async () => ({ data: { trip: tripPayload("/uploads/trips/trip-1/hero.png"), days: [] }, error: null }) };
      }
      if (url.endsWith("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      throw new Error(`Unhandled fetch ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    const hero = await screen.findByTestId("trip-hero");
    expect(window.getComputedStyle(hero).backgroundImage).toBe('url("/uploads/trips/trip-1/hero.png")');
  });

  // The hero is always written to `hero.<ext>`, so a re-upload leaves the URL byte-identical. Within
  // one page lifetime the browser reuses whatever it already has for that URL - including a failed
  // fetch - without revalidating, so the fresh image only appeared after a hard reload. The upload
  // response is stamped with a version so the new bytes arrive under a URL the page has never fetched.
  it("paints the newly uploaded hero image under a cache-busted url, without a page reload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ data: { trip: tripPayload(null), days: [] }, error: null }) };
      }
      if (url.endsWith("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      // PATCH still reports the pre-upload hero (null) - the upload runs after it.
      if (url.endsWith("/api/trips/trip-1") && method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({ data: { trip: tripPayload(null), days: [] }, error: null }) };
      }
      if (url.endsWith("/api/trips/trip-1/hero-image") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: { id: "trip-1", heroImageUrl: "/uploads/trips/trip-1/hero.png", updatedAt: "2026-08-01T00:16:05.000Z" },
            },
            error: null,
          }),
        };
      }
      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit trip" }));

    const fileInput = await screen.findByLabelText("Hero image (optional)");
    await user.upload(fileInput, new File(["x"], "hero.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1/hero-image", expect.objectContaining({ method: "POST" })),
    );

    await waitFor(() => {
      const hero = screen.getByTestId("trip-hero");
      const background = window.getComputedStyle(hero).backgroundImage;
      expect(background).toBe('url("/uploads/trips/trip-1/hero.png?v=20260801T001605000Z")');
    });
  });

  it("keeps a hero image that was not re-uploaded on its stored url", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && (method === "GET" || method === "PATCH")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { trip: tripPayload("/uploads/trips/trip-1/hero.png"), days: [] }, error: null }),
        };
      }
      if (url.endsWith("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit trip" }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.objectContaining({ method: "PATCH" })));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/trips/trip-1/hero-image", expect.anything());

    const hero = screen.getByTestId("trip-hero");
    expect(window.getComputedStyle(hero).backgroundImage).toBe('url("/uploads/trips/trip-1/hero.png")');
  });
});
