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

  it.each(["driving", "walking", "cycling"] as const)("requests the %s OSRM profile", async (profile) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(`/route/v1/${profile}/`);
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

  it("defaults to the driving profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/route/v1/driving/");
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
