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

    expect(await screen.findByRole("button", { name: "Plan with Maps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Maps" })).toHaveAttribute(
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

    expect(await screen.findByRole("button", { name: "Plan with Maps" })).toBeDisabled();
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

    const routeAction = await screen.findByRole("button", { name: "Plan with Maps" });
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

    const routeAction = await screen.findByRole("button", { name: "Plan with Maps" });
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

    const routeAction = await screen.findByRole("button", { name: "Plan with Maps" });
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

  // --- Story 6.16: walking and cycling ----------------------------------------------------------

  /**
   * Keeps the vitest handle typed - `vi.fn(...) as unknown as typeof fetch` erases `.mock`, and
   * these tests assert on the request that was actually made, not just on what rendered.
   */
  const stubFetch = (
    handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>,
  ) => {
    const fetchMock = vi.fn(handler);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const csrfResponse = { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };

  const stubCsrfOnlyFetch = () => stubFetch(async () => csrfResponse);

  const stubSaveFetch = () =>
    stubFetch(async (input) => {
      if (String(input).includes("/api/auth/csrf")) return csrfResponse;
      return { ok: true, status: 200, json: async () => ({ data: { segment: { id: "segment-1" } }, error: null }) };
    });

  const openTransportMenu = async () => {
    const select = await screen.findByLabelText("Transport");
    fireEvent.mouseDown(select);
  };

  it("offers walking and cycling alongside the existing modes", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    await openTransportMenu();

    for (const label of ["Car", "Walking", "Cycling", "Ship", "Flight"]) {
      expect(await screen.findByRole("option", { name: label })).toBeInTheDocument();
    }

    vi.unstubAllGlobals();
  });

  it("offers walking and cycling in German too", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="de">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    fireEvent.mouseDown(await screen.findByLabelText("Transport"));

    for (const label of ["Auto", "Zu Fuß", "Fahrrad", "Schiff", "Flug"]) {
      expect(await screen.findByRole("option", { name: label })).toBeInTheDocument();
    }

    vi.unstubAllGlobals();
  });

  /**
   * AC6 in the UI: the distance field is offered for walking, but leaving it empty saves rather than
   * erroring - the opposite of car, whose rule is unchanged and asserted by the first test above.
   */
  it("saves a walking segment without a distance", async () => {
    const fetchMock = stubSaveFetch();

    const onSaved = vi.fn();
    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} onSaved={onSaved} />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Walking" }));

    // Offered, and labelled as optional so the difference from car is visible without trying to save.
    expect(await screen.findByLabelText("Distance (km, optional)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(screen.queryByText("Distance is required for car travel")).not.toBeInTheDocument();

    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/travel-segments"));
    const body = JSON.parse(String((saveCall?.[1] as RequestInit).body));
    expect(body.transportType).toBe("walking");
    expect(body.distanceKm).toBeNull();

    vi.unstubAllGlobals();
  });

  it("keeps the distance a cycling segment was given", async () => {
    const fetchMock = stubSaveFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Cycling" }));
    fireEvent.change(await screen.findByLabelText("Distance (km, optional)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/travel-segments"))).toBe(true);
    });
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/travel-segments"));
    const body = JSON.parse(String((saveCall?.[1] as RequestInit).body));
    expect(body.transportType).toBe("cycling");
    expect(body.distanceKm).toBe(40);

    vi.unstubAllGlobals();
  });

  it("hides the distance field for ship and flight", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Ship" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Distance (km)")).not.toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Distance (km, optional)")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /** AC4: walking and cycling ask the route service for their own mode, not for driving. */
  it.each(["Walking", "Cycling"])("requests a %s route preview for its own mode", async (label) => {
    const fetchMock = stubFetch(async (input) => {
      if (String(input).includes("/api/auth/csrf")) return csrfResponse;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            route: {
              durationSeconds: 1800,
              distanceMeters: 6200,
              polyline: [
                [52.52, 13.405],
                [48.137, 11.575],
              ],
            },
          },
          error: null,
        }),
      };
    });

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{ ...baseProps.fromItem, location: { lat: 52.52, lng: 13.405, label: "Berlin" } }}
          toItem={{ ...baseProps.toItem, location: { lat: 48.137, lng: 11.575, label: "Munich" } }}
        />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Plan with Maps" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("00:30")).toBeInTheDocument();
    });

    const previewCall = fetchMock.mock.calls.find(([url]) => String(url).includes("route-preview"));
    expect(String(previewCall?.[0])).toContain(`mode=${label.toLowerCase()}`);
    // Google's own spelling for a bike route is `bicycling`, not `cycling`.
    expect((screen.getByDisplayValue(/google\.com\/maps\/dir/) as HTMLInputElement).value).toContain(
      `travelmode=${label === "Cycling" ? "bicycling" : "walking"}`,
    );
    expect(screen.getByDisplayValue("6.2")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /** AC5: the helper no longer claims car-only, and names the modes that do import. */
  it("tells ship and flight that they are the manual path without erroring", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{ ...baseProps.fromItem, location: { lat: 52.52, lng: 13.405, label: "Berlin" } }}
          toItem={{ ...baseProps.toItem, location: { lat: 48.137, lng: 11.575, label: "Munich" } }}
        />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Flight" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan with Maps" }));

    const manualHelper =
      "Automatic route import covers car, walking and cycling. Ship and flight are entered manually - you can still open Google Maps for a lookup.";
    await waitFor(() => {
      expect(screen.getAllByText(manualHelper).length).toBeGreaterThan(0);
    });
    // Degraded, not failed: the generic error message must not appear.
    expect(
      screen.queryByText("Automatic route import is not available in this build. Use Google Maps and copy the values manually."),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /** AC4: an empty result reads as "no route for this mode here", not as a failure. */
  it("reports an empty cycling result as no route for this mode", async () => {
    stubFetch(async (input) => {
      if (String(input).includes("/api/auth/csrf")) return csrfResponse;
      return {
        ok: false,
        status: 404,
        json: async () => ({
          data: null,
          error: { code: "routing_no_route", message: "No route available for this travel mode" },
        }),
      };
    });

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          fromItem={{ ...baseProps.fromItem, location: { lat: 52.52, lng: 13.405, label: "Berlin" } }}
          toItem={{ ...baseProps.toItem, location: { lat: 48.137, lng: 11.575, label: "Munich" } }}
        />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Cycling" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan with Maps" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "No route is available for this travel mode between these two places. Enter the duration and distance manually.",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Automatic route import is not available in this build. Use Google Maps and copy the values manually."),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
