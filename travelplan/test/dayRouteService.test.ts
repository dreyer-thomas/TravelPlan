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
