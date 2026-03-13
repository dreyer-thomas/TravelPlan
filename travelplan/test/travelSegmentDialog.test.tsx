// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripDayTravelSegmentDialog from "@/components/features/trips/TripDayTravelSegmentDialog";
import { I18nProvider } from "@/i18n/provider";

const baseProps = {
  open: true,
  tripId: "trip-1",
  tripDayId: "day-1",
  fromItem: {
    id: "item-1",
    type: "dayPlanItem" as const,
    label: "Morning",
    location: null,
  },
  toItem: {
    id: "stay-1",
    type: "accommodation" as const,
    label: "Hotel",
    location: null,
  },
  segment: null,
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

describe("TripDayTravelSegmentDialog", () => {
  it("validates distance for car travel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { segment: { id: "segment-1" } }, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    const saveButton = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Distance is required for car travel")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("shows a Google Maps calculation action when both adjacent items have locations", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { route: { durationSeconds: 7200, distanceMeters: 584000, polyline: [] } }, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{
            ...baseProps.fromItem,
            location: { lat: 52.52, lng: 13.405, label: "Berlin" },
          }}
          toItem={{
            ...baseProps.toItem,
            location: { lat: 48.137, lng: 11.575, label: "Munich" },
          }}
        />
      </I18nProvider>,
    );

    expect(await screen.findByRole("button", { name: "Calculate with Google Maps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Google Maps" })).toHaveAttribute(
      "href",
      expect.stringContaining("origin=52.52%2C13.405"),
    );

    vi.unstubAllGlobals();
  });

  it("disables Google Maps calculation when adjacent locations are missing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    expect(await screen.findByRole("button", { name: "Calculate with Google Maps" })).toBeDisabled();
    expect(screen.getByText("Add locations to both adjacent items to calculate a Google Maps route.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("refreshes and prefills car travel values from adjacent items", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            route: {
              durationSeconds: 8100,
              distanceMeters: 346500,
              polyline: [
                [40.7128, -74.006],
                [41.3083, -72.9279],
                [42.3601, -71.0589],
              ],
            },
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{
            ...baseProps.fromItem,
            location: { lat: 40.7128, lng: -74.006, label: "New York" },
          }}
          toItem={{
            ...baseProps.toItem,
            location: { lat: 42.3601, lng: -71.0589, label: "Boston" },
          }}
          segment={{
            id: "segment-1",
            fromItemType: "dayPlanItem",
            fromItemId: "item-1",
            toItemType: "accommodation",
            toItemId: "stay-1",
            transportType: "car",
            durationMinutes: 95,
            distanceKm: 320.5,
            linkUrl: "https://example.com/old-link",
          }}
        />
      </I18nProvider>,
    );

    const routeAction = await screen.findByRole("button", { name: "Refresh from Google Maps" });
    fireEvent.click(routeAction);

    await waitFor(() => {
      expect(screen.getByDisplayValue("02:15")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("346.5")).toBeInTheDocument();
    expect((screen.getByDisplayValue(/google\.com\/maps\/dir/) as HTMLInputElement).value).toContain("waypoints=");
    expect(
      screen.getByText(
        "Route details were prefilled from the current adjacent locations. You can still edit them before saving.",
      ),
    ).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("keeps manual values when route lookup falls back to Google Maps", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: false,
        status: 502,
        json: async () => ({ data: null, error: { code: "routing_unavailable", message: "failed" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{
            ...baseProps.fromItem,
            location: { lat: 40.7128, lng: -74.006, label: "New York" },
          }}
          toItem={{
            ...baseProps.toItem,
            location: { lat: 42.3601, lng: -71.0589, label: "Boston" },
          }}
          segment={{
            id: "segment-1",
            fromItemType: "dayPlanItem",
            fromItemId: "item-1",
            toItemType: "accommodation",
            toItemId: "stay-1",
            transportType: "car",
            durationMinutes: 95,
            distanceKm: 320.5,
            linkUrl: "https://example.com/old-link",
          }}
        />
      </I18nProvider>,
    );

    const routeAction = await screen.findByRole("button", { name: "Refresh from Google Maps" });
    fireEvent.click(routeAction);

    await waitFor(() => {
      expect(
        screen.getByText("Automatic route import is not available in this build. Use Google Maps and copy the values manually."),
      ).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("01:35")).toBeInTheDocument();
    expect(screen.getByDisplayValue("320.5")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/google\.com\/maps\/dir/)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("keeps manual values when route lookup returns only partial route details", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { route: { durationSeconds: 8100, distanceMeters: null, polyline: [] } },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{
            ...baseProps.fromItem,
            location: { lat: 40.7128, lng: -74.006, label: "New York" },
          }}
          toItem={{
            ...baseProps.toItem,
            location: { lat: 42.3601, lng: -71.0589, label: "Boston" },
          }}
          segment={{
            id: "segment-1",
            fromItemType: "dayPlanItem",
            fromItemId: "item-1",
            toItemType: "accommodation",
            toItemId: "stay-1",
            transportType: "car",
            durationMinutes: 95,
            distanceKm: 320.5,
            linkUrl: "https://example.com/old-link",
          }}
        />
      </I18nProvider>,
    );

    const routeAction = await screen.findByRole("button", { name: "Refresh from Google Maps" });
    fireEvent.click(routeAction);

    await waitFor(() => {
      expect(
        screen.getByText("Automatic route import is not available in this build. Use Google Maps and copy the values manually."),
      ).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("01:35")).toBeInTheDocument();
    expect(screen.getByDisplayValue("320.5")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
