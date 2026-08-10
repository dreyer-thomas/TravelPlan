// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * `TripTimeline`'s half of the one-mount-per-open contract.
 *
 * `TripShareDialog` is rendered unconditionally so its exit transition still plays on close, and it
 * used to clear eight states in an `if (!open)` branch for that reason. Those setters are gone: the
 * dialog now gets a fresh instance per open, because this screen derives a key with
 * `useOpenInstanceKey` and passes it as `` key={`share-${shareDialogKey}`} ``. Nothing else resets it,
 * so if that key is ever dropped a second open reuses the first one's instance — its collaborator
 * list, its load error, its success banner, its invite draft and its CSRF token all still in place.
 *
 * It lives in its own file rather than in `tripTimelineSharing.test.tsx` because it has to stub the
 * dialog to count mounts, and that suite deliberately renders the real one end to end.
 *
 * Mounts are the only observable: React consumes `key` while building the element, so no stub can ever
 * read it as a prop, and every other assertion about this screen passes with the key deleted.
 */

const shareDialogMockState = vi.hoisted(() => ({
  mounts: 0,
  close: null as null | (() => void),
}));

vi.mock("@/components/features/trips/TripShareDialog", () => ({
  // Named, so the mount counter is a hook inside something `react-hooks/rules-of-hooks` recognises as
  // a component.
  default: function TripShareDialogStub(props: { open: boolean; onClose: () => void }) {
    // Unconditional and ahead of the `!open` early return, so the hook order is the same on every pass.
    // Counts mounts only — a re-render with new props does not run it again.
    useEffect(() => {
      shareDialogMockState.mounts += 1;
    }, []);
    shareDialogMockState.close = props.onClose;
    if (!props.open) return null;
    return <div data-testid="share-dialog" />;
  },
}));

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripEditDialog", () => ({
  default: () => <div data-testid="edit-dialog" />,
}));

vi.mock("@/components/features/trips/TripDeleteDialog", () => ({
  default: () => <div data-testid="delete-dialog" />,
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

describe("TripTimeline share dialog instance key", () => {
  beforeEach(() => {
    shareDialogMockState.mounts = 0;
    shareDialogMockState.close = null;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
  });

  it("gives the share dialog a fresh mount per open", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/trips/trip-1")) {
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
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 2,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
              },
              days: [],
            },
            error: null,
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<TripTimeline tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await userEvent.click(screen.getByRole("button", { name: "Share trip" }));
    expect(await screen.findByTestId("share-dialog")).toBeInTheDocument();
    const mountsAfterFirstOpen = shareDialogMockState.mounts;

    // The close arrives through the prop this screen owns — the same callback the real dialog's ✕ and
    // its backdrop invoke. The stub renders nothing while closed, so there is no control to click.
    await act(async () => {
      shareDialogMockState.close?.();
    });
    await waitFor(() => expect(screen.queryByTestId("share-dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Share trip" }));
    expect(await screen.findByTestId("share-dialog")).toBeInTheDocument();

    // With the key gone this stays at `mountsAfterFirstOpen`, and the second open shows whatever the
    // first one left on screen.
    expect(shareDialogMockState.mounts).toBe(mountsAfterFirstOpen + 1);

    vi.unstubAllGlobals();
  });
});
