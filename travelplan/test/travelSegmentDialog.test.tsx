// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * Story 6.17 shortened this one. Named rather than inlined because four cases assert on it and the
 * point of the rename was that the old text claimed a cause ("not available in this build") that
 * only one of its four call sites actually had.
 */
const ROUTE_IMPORT_FAILED = "Route import failed. Enter duration and distance manually.";

/**
 * Story 6.17 deleted `trips.travelSegment.googleMapsFallbackHelper` outright. These are the exact
 * strings it used to render, in both languages, kept here so the suite can assert they appear
 * nowhere — a query for a key that no longer exists would silently pass forever.
 */
const REMOVED_FALLBACK_HELPER_EN =
  "Open the route in Google Maps, then copy the duration and distance into this form.";
const REMOVED_FALLBACK_HELPER_DE =
  "Öffne die Route in Google Maps und übertrage Dauer und Entfernung anschließend manuell in dieses Formular.";

const placedItems = (props: typeof baseProps) => ({
  fromItem: { ...props.fromItem, location: { lat: 52.52, lng: 13.405, label: "Berlin" } },
  toItem: { ...props.toItem, location: { lat: 48.137, lng: 11.575, label: "Munich" } },
});

describe("TripDayTravelSegmentDialog", () => {
  // Every case in this file ends with its own `vi.unstubAllGlobals()`, which is skipped whenever an
  // assertion throws - so one genuine failure used to leave the stubbed `fetch` installed and take
  // the next case down with it, burying the real cause. This runs regardless of outcome; the
  // trailing calls are now belt-and-braces.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

    const saveButton = await screen.findByRole("button", { name: "OK" });
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

    expect(await screen.findByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Maps" })).toHaveAttribute(
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

    expect(await screen.findByRole("button", { name: "Plan" })).toBeDisabled();
    expect(screen.getByText("Add a location to both adjacent items.")).toBeInTheDocument();

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

    const routeAction = await screen.findByRole("button", { name: "Plan" });
    fireEvent.click(routeAction);

    await waitFor(() => {
      expect(screen.getByDisplayValue("02:15")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("346.5")).toBeInTheDocument();
    expect((screen.getByDisplayValue(/google\.com\/maps\/dir/) as HTMLInputElement).value).toContain("waypoints=");
    expect(
      screen.getByText("Route details were prefilled from Maps."),
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

    const routeAction = await screen.findByRole("button", { name: "Plan" });
    fireEvent.click(routeAction);

    await waitFor(() => {
      expect(
        screen.getByText(ROUTE_IMPORT_FAILED),
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

    const routeAction = await screen.findByRole("button", { name: "Plan" });
    fireEvent.click(routeAction);

    await waitFor(() => {
      expect(
        screen.getByText(ROUTE_IMPORT_FAILED),
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

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

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
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    const manualHelper =
      "Automatic route import covers car, walking and cycling. Ship and flight are entered manually.";
    // Exactly one copy - see "does not repeat the manual-mode helper" below.
    await waitFor(() => {
      expect(screen.getByText(manualHelper)).toBeInTheDocument();
    });
    // Degraded, not failed: the generic error message must not appear.
    expect(
      screen.queryByText(ROUTE_IMPORT_FAILED),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * DW-110, unmasked by the routing fix: a duration is not a time of day. A walking leg long enough
   * to pass 24 h used to be prefilled and then rejected by the same form, with "Duration is required"
   * over a field that plainly held a duration.
   */
  it("accepts a prefilled duration longer than a day", async () => {
    const fetchMock = stubFetch(async (input) => {
      if (String(input).includes("/api/auth/csrf")) return csrfResponse;
      if (String(input).includes("route-preview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            // ~110 km on foot: 26 h 30 m.
            data: {
              route: {
                durationSeconds: 95400,
                distanceMeters: 110000,
                polyline: [
                  [52.52, 13.405],
                  [48.137, 11.575],
                ],
              },
            },
            error: null,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: { segment: { id: "segment-1" } }, error: null }) };
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
    fireEvent.click(await screen.findByRole("option", { name: "Walking" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("26:30")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/travel-segments"))).toBe(true);
    });
    expect(screen.queryByText("Duration is required")).not.toBeInTheDocument();
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/travel-segments"));
    expect(JSON.parse(String((saveCall?.[1] as RequestInit).body)).durationMinutes).toBe(1590);

    vi.unstubAllGlobals();
  });

  // --- Review of story 6.16 ---------------------------------------------------------------------

  /**
   * Two routable modes made this reachable in one click: import a route for Walking, switch to
   * Cycling, save - and the cycling row carried the walking duration, the walking distance and a
   * link reading `travelmode=walking`, with "Route imported successfully" still on screen.
   */
  it("discards a route imported for the previous mode when the mode changes", async () => {
    const fetchMock = stubFetch(async (input) => {
      if (String(input).includes("/api/auth/csrf")) return csrfResponse;
      if (String(input).includes("route-preview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              route: {
                durationSeconds: 2700,
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
      }
      return { ok: true, status: 200, json: async () => ({ data: { segment: { id: "segment-1" } }, error: null }) };
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
    fireEvent.click(await screen.findByRole("option", { name: "Walking" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("00:45")).toBeInTheDocument();
    });
    expect(screen.getByText("Route details were prefilled from Maps.")).toBeInTheDocument();

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Cycling" }));

    // The walking numbers are gone, not carried over onto a cycling leg.
    await waitFor(() => {
      expect(screen.queryByDisplayValue("00:45")).not.toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("6.2")).not.toBeInTheDocument();
    expect(screen.queryByText("Route details were prefilled from Maps.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Duration (HH:mm)"), { target: { value: "01:10" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/travel-segments"))).toBe(true);
    });
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/travel-segments"));
    const body = JSON.parse(String((saveCall?.[1] as RequestInit).body));
    expect(body.transportType).toBe("cycling");
    expect(body.durationMinutes).toBe(70);
    expect(body.distanceKm).toBeNull();
    expect(String(body.linkUrl ?? "")).not.toContain("travelmode=walking");

    vi.unstubAllGlobals();
  });

  /** An untouched auto-seeded link must not send a cyclist down driving directions. */
  it("re-points the seeded Maps link at the mode the user picked", async () => {
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
    fireEvent.click(await screen.findByRole("option", { name: "Cycling" }));

    await waitFor(() => {
      expect((screen.getByDisplayValue(/google\.com\/maps\/dir/) as HTMLInputElement).value).toContain(
        "travelmode=bicycling",
      );
    });

    vi.unstubAllGlobals();
  });

  /**
   * "Optional" must not mean "silently discarded". `inputProps.min` is not enforced on submit and the
   * API rejects a non-positive distance, so dropping it to `null` and closing on a success threw away
   * the number the user typed and told them it had been saved.
   */
  it.each(["0", "-3"])("reports a distance of %s on a cycling leg instead of dropping it", async (value) => {
    const fetchMock = stubSaveFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Cycling" }));
    fireEvent.change(await screen.findByLabelText("Distance (km, optional)"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(await screen.findByText("Enter a distance greater than 0, or leave the field empty.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/travel-segments"))).toBe(false);

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
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "No route is available for this travel mode between these two places. Enter the duration and distance manually.",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(ROUTE_IMPORT_FAILED),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  // --- Story 6.17: shorter copy so the dialog fits a phone ---------------------------------------

  /**
   * AC1 and AC3, in the *add* state, where the route action reads
   * `trips.travelSegment.calculateGoogleMapsRoute`. Both languages, because before this story
   * `openLink` and the two route keys held untranslated English in `de.ts` and the save button read
   * "Speichern" — the three labels are now identical in the two dictionaries on purpose, and this is
   * what says so.
   */
  it.each(["en", "de"] as const)("labels the add-dialog actions Maps / Plan / OK in %s", async (language) => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage={language}>
        <TripDayTravelSegmentDialog {...baseProps} {...placedItems(baseProps)} />
      </I18nProvider>,
    );

    expect(await screen.findByRole("link", { name: "Maps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();

    // The strings these replaced, so a partial revert of either dictionary fails here.
    expect(screen.queryByRole("link", { name: "Open Maps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan with Maps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * The same three labels in the *edit* state, which is the only place
   * `trips.travelSegment.refreshGoogleMapsRoute` is read. Without this case that key could keep
   * saying "Plan with Maps" with the whole suite green — the two keys are separate and only one of
   * them is reachable at a time.
   */
  it.each(["en", "de"] as const)("labels the edit-dialog actions Maps / Plan / OK in %s", async (language) => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage={language}>
        <TripDayTravelSegmentDialog
          {...baseProps}
          {...placedItems(baseProps)}
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

    expect(await screen.findByRole("link", { name: "Maps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan with Maps" })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * AC1 and AC2: `googleMapsFallbackHelper` is deleted, and this is the exact state that used to
   * render it — adding a leg, a routable mode, both neighbours placed. Nothing standing is left
   * under the form in that state, which is the whole point of the story. Asserted in both languages
   * against the literal old strings rather than against a key, because `translate()` falls back to
   * returning the key itself, so a query for a deleted key would pass whatever happened.
   */
  it.each(["en", "de"] as const)(
    "renders no standing helper for a routable leg between two placed items (%s)",
    async (language) => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage={language}>
        <TripDayTravelSegmentDialog {...baseProps} {...placedItems(baseProps)} />
      </I18nProvider>,
    );

    await screen.findByRole("button", { name: "Plan" });

    // Both languages, not just the rendered one: the key is gone from both dictionaries, so neither
    // string can reach the DOM by any route.
    expect(screen.queryByText(REMOVED_FALLBACK_HELPER_EN)).not.toBeInTheDocument();
    expect(screen.queryByText(REMOVED_FALLBACK_HELPER_DE)).not.toBeInTheDocument();
    // No other standing helper stepped into its place either.
    expect(screen.queryByText(/Add a location to both adjacent items/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Füge beiden Nachbareinträgen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Automatic route import covers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Der automatische Routenimport deckt/)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
    },
  );

  /**
   * The removed helper was only ever rendered in the add state, so the edit state is where a
   * careless "put it back somewhere" would hide. Also covers the surviving keys not leaking into a
   * state they do not belong to.
   */
  it("renders no standing helper at all when editing an existing segment", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="de">
        <TripDayTravelSegmentDialog
          {...baseProps}
          {...placedItems(baseProps)}
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

    await screen.findByRole("button", { name: "Plan" });

    expect(screen.queryByText(REMOVED_FALLBACK_HELPER_DE)).not.toBeInTheDocument();
    expect(screen.queryByText(/Füge beiden Nachbareinträgen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Der automatische Routenimport deckt/)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * AC4: the two helpers that survived because they are actionable, in German, which is the length
   * constraint at 390px. The unavailable one is the state the operator has to reproduce for AC5
   * (neither neighbour placed); the manual-mode one still names the modes that *do* import, which is
   * Story 6.16's AC5 and must not be undone by shortening it.
   */
  it("keeps the two actionable helpers, shortened, in German", async () => {
    stubCsrfOnlyFetch();

    const { unmount } = render(
      <I18nProvider initialLanguage="de">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    expect(await screen.findByText("Füge beiden Nachbareinträgen einen Ort hinzu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toBeDisabled();
    unmount();

    render(
      <I18nProvider initialLanguage="de">
        <TripDayTravelSegmentDialog {...baseProps} {...placedItems(baseProps)} />
      </I18nProvider>,
    );

    fireEvent.mouseDown(await screen.findByLabelText("Transport"));
    fireEvent.click(await screen.findByRole("option", { name: "Flug" }));

    const manualHelper =
      "Der automatische Routenimport deckt Auto, zu Fuß und Fahrrad ab. Schiff und Flug trägst du manuell ein.";
    // `getByText`, not `getAllByText`: exactly one copy. The standing helper and the Alert that
    // "Plan" leaves behind used to carry this same sentence at the same time.
    // Story 6.16's AC5 - that this wording names the modes that do import and never claims
    // car-only - is pinned against the dictionary in `i18nDictionaries.test.ts`, which is the only
    // place it can be asserted without comparing this local literal to itself.
    await waitFor(() => {
      expect(screen.getByText(manualHelper)).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  /**
   * Story 6.17 review. Add mode, ship or flight, both neighbours placed: the standing helper
   * already says this, and `handleGoogleMapsRoute` used to set the identical string as an Alert on
   * top of it. Two copies of the dialog's longest helper is the opposite of what this story is for.
   */
  it("does not repeat the manual-mode helper when Plan is pressed in the add dialog", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} {...placedItems(baseProps)} />
      </I18nProvider>,
    );

    await openTransportMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Ship" }));

    const manualHelper =
      "Automatic route import covers car, walking and cycling. Ship and flight are entered manually.";
    expect(screen.getByText(manualHelper)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    await waitFor(() => {
      expect(screen.getAllByText(manualHelper)).toHaveLength(1);
    });

    vi.unstubAllGlobals();
  });

  /**
   * The edit dialog renders no standing helper, so there the Alert is the only thing that explains
   * why pressing "Plan" imported nothing. Suppressing the duplicate above must not suppress this.
   */
  it("still explains the manual path as an alert when editing a ship or flight leg", async () => {
    stubCsrfOnlyFetch();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog
          {...baseProps}
          {...placedItems(baseProps)}
          segment={{
            id: "segment-1",
            fromItemType: "dayPlanItem",
            fromItemId: "item-1",
            toItemType: "accommodation",
            toItemId: "stay-1",
            transportType: "flight",
            durationMinutes: 95,
            distanceKm: null,
            linkUrl: "https://example.com/old-link",
          }}
        />
      </I18nProvider>,
    );

    const manualHelper =
      "Automatic route import covers car, walking and cycling. Ship and flight are entered manually.";
    expect(await screen.findByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(screen.queryByText(manualHelper)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    await waitFor(() => {
      expect(screen.getByText(manualHelper)).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });
});
