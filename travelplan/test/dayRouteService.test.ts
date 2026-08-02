import { afterEach, describe, expect, it, vi } from "vitest";
import { DayRouteError, getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";

describe("dayRouteService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests OSRM with ordered lng,lat path and maps geometry to lat,lng polyline", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/11.7861,48.3538;11.5756,48.1372;11.582,48.145");

      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              geometry: {
                coordinates: [
                  [11.7861, 48.3538],
                  [11.6, 48.2],
                  [11.5756, 48.1372],
                  [11.582, 48.145],
                ],
              },
              distance: 12345,
              duration: 1800,
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const result = await getDayRouteFromOsrm({
      points: [
        { lat: 48.3538, lng: 11.7861 },
        { lat: 48.1372, lng: 11.5756 },
        { lat: 48.145, lng: 11.582 },
      ],
      fetchImpl: fetchMock,
    });

    expect(result.polyline).toEqual([
      [48.3538, 11.7861],
      [48.2, 11.6],
      [48.1372, 11.5756],
      [48.145, 11.582],
    ]);
    expect(result.distanceMeters).toBe(12345);
    expect(result.durationSeconds).toBe(1800);
  });

  // --- Story 6.16: per-mode routing profiles ---------------------------------------------------

  /**
   * The profile is chosen by *endpoint*, not by the `{profile}` path segment - an OSRM deployment
   * serves one graph and ignores that segment, which is how walking and cycling originally shipped
   * returning car numbers. Asserting the whole path is the point: a test that only checked
   * `/route/v1/walking/` passed against a car-only host.
   */
  it.each([
    ["driving", "routed-car/route/v1/driving"],
    ["walking", "routed-foot/route/v1/foot"],
    ["cycling", "routed-bike/route/v1/bike"],
  ] as const)("requests the %s endpoint", async (profile, path) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(`https://routing.openstreetmap.de/${path}/`);
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              geometry: {
                coordinates: [
                  [11.7861, 48.3538],
                  [11.5756, 48.1372],
                ],
              },
              distance: 100,
              duration: 60,
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    await getDayRouteFromOsrm({
      points: [
        { lat: 48.3538, lng: 11.7861 },
        { lat: 48.1372, lng: 11.5756 },
      ],
      profile,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("defaults to the car endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/routed-car/route/v1/driving/");
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              geometry: {
                coordinates: [
                  [11.7861, 48.3538],
                  [11.5756, 48.1372],
                ],
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    await getDayRouteFromOsrm({
      points: [
        { lat: 48.3538, lng: 11.7861 },
        { lat: 48.1372, lng: 11.5756 },
      ],
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  /**
   * OSRM answers "this profile's graph connects nothing between these points" with `NoRoute`, and
   * cycling hits that in large parts of the world. It is a correct answer, so it gets a code of its
   * own instead of being flattened into `routing_unavailable`.
   */
  it("throws routing_no_route when OSRM finds no route for the profile", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: "NoRoute", routes: [] }),
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        profile: "cycling",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "routing_no_route" });
  });

  it("throws routing_no_route when OSRM returns Ok with an empty route list", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: "Ok", routes: [] }),
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        profile: "cycling",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "routing_no_route" });
  });

  /** A self-hosted deployment mirroring the same three paths must be a config change, not a patch. */
  it("honours OSRM_BASE_URL and strips a trailing slash", async () => {
    vi.stubEnv("OSRM_BASE_URL", "https://osrm.internal.example/");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("https://osrm.internal.example/routed-bike/route/v1/bike/");
      expect(String(input)).not.toContain("routing.openstreetmap.de");
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              geometry: {
                coordinates: [
                  [11.7861, 48.3538],
                  [11.5756, 48.1372],
                ],
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    await getDayRouteFromOsrm({
      points: [
        { lat: 48.3538, lng: 11.7861 },
        { lat: 48.1372, lng: 11.5756 },
      ],
      profile: "cycling",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
  });

  // --- Review of story 6.16: the no-route path has to survive the real transport ------------------

  /**
   * The bug this pins: OSRM reports every non-`Ok` code with **HTTP 400** and a JSON body carrying
   * the code, so a `!response.ok` guard placed before the body is read collapses "there is no route
   * for this profile here" into "the router is down" - and made `routing_no_route`, its 404 and its
   * user-facing message unreachable in production while the mocked tests stayed green.
   */
  it.each(["NoRoute", "NoSegment"])("throws routing_no_route for a %s body served with HTTP 400", async (code) => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ code, message: "Impossible route between points" }),
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        profile: "cycling",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "routing_no_route" });
  });

  /** A coordinate off the profile's network: an answer about the request, not an outage. */
  it("throws routing_no_route for a NoSegment body served with HTTP 200", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: "NoSegment", routes: [] }),
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        profile: "walking",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "routing_no_route" });
  });

  /** Reading the body first must not turn a genuine outage into "no route". */
  it("still throws routing_unavailable when an error response carries no parseable body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "routing_unavailable" });
  });

  it("still throws routing_unavailable for a non-Ok code that is not a no-route answer", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ code: "InvalidValue", message: "Invalid coordinate value." }),
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "routing_unavailable" });
  });

  it("throws routing_unavailable when OSRM request fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject<Partial<DayRouteError>>({
      code: "routing_unavailable",
    });
  });

  it("maps timeout aborts to routing_unavailable", async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        fetchImpl: fetchMock,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject<Partial<DayRouteError>>({
      code: "routing_unavailable",
    });
  });

  it("throws routing_invalid_response for invalid OSRM payload", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ geometry: { coordinates: [[11.7861, 48.3538]] } }],
      }),
    })) as unknown as typeof fetch;

    await expect(
      getDayRouteFromOsrm({
        points: [
          { lat: 48.3538, lng: 11.7861 },
          { lat: 48.1372, lng: 11.5756 },
        ],
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject<Partial<DayRouteError>>({
      code: "routing_invalid_response",
    });
  });
});
