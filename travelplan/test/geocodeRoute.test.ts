import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/geocode/route";
import { createSessionJwt } from "@/lib/auth/jwt";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("GET /api/geocode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns first geocoding match", async () => {
    const session = await createSessionJwt({ sub: "user-1", role: "OWNER" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          lat: "50.0379",
          lon: "8.5622",
          display_name: "Frankfurt Airport",
        },
      ],
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("http://localhost/api/geocode?q=Frankfurt%20Airport", {
      headers: {
        cookie: `session=${session}`,
      },
    });
    const response = await GET(request);
    const body = (await response.json()) as ApiEnvelope<{ result: { lat: number; lng: number; label: string } | null }>;

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.result).toEqual({
      lat: 50.0379,
      lng: 8.5622,
      label: "Frankfurt Airport",
    });
  });

  it("returns validation_error for missing query", async () => {
    const session = await createSessionJwt({ sub: "user-2", role: "OWNER" });
    const request = new NextRequest("http://localhost/api/geocode", {
      headers: {
        cookie: `session=${session}`,
      },
    });
    const response = await GET(request);
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe("validation_error");
  });

  it("returns unauthorized without a valid session", async () => {
    const request = new NextRequest("http://localhost/api/geocode?q=Frankfurt%20Airport");
    const response = await GET(request);
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe("unauthorized");
  });
});
