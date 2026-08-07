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

  type Candidate = { lat: number; lng: number; label: string };
  type NominatimRow = { lat?: string; lon?: string; display_name?: string };

  /**
   * Story 6.28. A Nominatim stub returning the rows it is handed, and the mock itself so the *outbound*
   * request can be asserted — nothing in this file looked at it before, and both `limit` and the
   * `User-Agent` header are load-bearing: the first is the whole of AC5, the second is required by
   * Nominatim's usage policy.
   */
  const stubNominatim = (rows: NominatimRow[]) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => rows,
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const geocode = async (query: string, sub: string) => {
    const session = await createSessionJwt({ sub, role: "OWNER" });
    const request = new NextRequest(`http://localhost/api/geocode?q=${encodeURIComponent(query)}`, {
      headers: {
        cookie: `session=${session}`,
      },
    });
    const response = await GET(request);
    const body = (await response.json()) as ApiEnvelope<{ results: Candidate[] }>;
    return { response, body };
  };

  it("returns a single geocoding match as a one-element array", async () => {
    stubNominatim([{ lat: "50.0379", lon: "8.5622", display_name: "Frankfurt Airport" }]);

    const { response, body } = await geocode("Frankfurt Airport", "user-1");

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    // One candidate is still one candidate — the caller adopts it directly, exactly as it did when this
    // route answered with a bare `result`.
    expect(body.data?.results).toEqual([{ lat: 50.0379, lng: 8.5622, label: "Frankfurt Airport" }]);
  });

  /**
   * AC5, and the half that fixes the reported "it only ever offers wrong places". Relevance order is
   * Nominatim's to decide and the route must not re-sort it: the caller shows the list in this order and
   * the first row is only a *suggestion*, no longer an adoption.
   */
  it("returns every match in Nominatim's own order", async () => {
    stubNominatim([
      { lat: "-36.8485", lon: "174.7633", display_name: "Sky Tower, Auckland" },
      { lat: "10.7769", lon: "106.7009", display_name: "Sky Tower, Ho Chi Minh City" },
      { lat: "43.6426", lon: "-79.3871", display_name: "Sky Tower, Toronto" },
      { lat: "51.5081", lon: "-0.0759", display_name: "Sky Tower, London" },
      { lat: "48.8584", lon: "2.2945", display_name: "Sky Tower, Paris" },
    ]);

    const { response, body } = await geocode("Sky Tower", "user-3");

    expect(response.status).toBe(200);
    expect(body.data?.results).toHaveLength(5);
    expect(body.data?.results.map((candidate) => candidate.label)).toEqual([
      "Sky Tower, Auckland",
      "Sky Tower, Ho Chi Minh City",
      "Sky Tower, Toronto",
      "Sky Tower, London",
      "Sky Tower, Paris",
    ]);
  });

  // An empty array where `result: null` used to be, still 200. The caller turns this into
  // `trips.location.noResult`, which is the message this story leaves alone.
  it("returns an empty array and a 200 for no match", async () => {
    stubNominatim([]);

    const { response, body } = await geocode("Nowhere at all", "user-4");

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.results).toEqual([]);
  });

  /**
   * The unusable-row guard, which used to discard the whole response when the *first* row was broken.
   * Per-row now: a missing `lon`, a non-numeric `lat` and an absent pair are each dropped, and a usable
   * row behind them survives instead of being lost with them.
   */
  it("drops rows whose coordinates are missing or non-finite, keeping the usable ones", async () => {
    stubNominatim([
      { lat: "50.0379", display_name: "No longitude" },
      { lat: "not-a-number", lon: "8.5622", display_name: "Unparseable latitude" },
      { display_name: "No coordinates at all" },
      { lat: "48.8584", lon: "2.2945", display_name: "Eiffel Tower" },
    ]);

    const { response, body } = await geocode("Eiffel Tower", "user-5");

    expect(response.status).toBe(200);
    expect(body.data?.results).toEqual([{ lat: 48.8584, lng: 2.2945, label: "Eiffel Tower" }]);
  });

  /**
   * Story 6.28 review, P11. The per-row guard checked presence and finiteness but not
   * `locationSchemas.ts`'s ±90/±180, so an out-of-range upstream row became a *selectable* candidate whose
   * save then failed server-side with a `validation_error` about numbers the user never typed and has no
   * way to correct. Dropped here, exactly like a row with no coordinates at all — and the usable row
   * behind it still survives, which is the property the finiteness guard already had.
   */
  it("drops rows outside the latitude/longitude bounds the write schema enforces", async () => {
    stubNominatim([
      { lat: "91.5", lon: "2.2945", display_name: "Impossible latitude" },
      { lat: "48.8584", lon: "-180.5", display_name: "Impossible longitude" },
      { lat: "48.8584", lon: "2.2945", display_name: "Eiffel Tower" },
    ]);

    const { response, body } = await geocode("Eiffel Tower", "user-9");

    expect(response.status).toBe(200);
    expect(body.data?.results).toEqual([{ lat: 48.8584, lng: 2.2945, label: "Eiffel Tower" }]);
  });

  /**
   * Story 6.28 follow-up review. `body` is upstream JSON with a declared type and no runtime guarantee.
   * `row.lat` on a `null` element threw, the throw landed in the outer `catch`, and the caller got a 500
   * with **every** usable candidate lost — where the pre-story `body[0]` path answered 200. And a
   * whitespace-only `lat` is truthy while `Number(" ")` is `0`, so it passed both the presence and the
   * finiteness test and arrived as a selectable candidate pinned at the equator.
   */
  it("drops malformed rows without failing the whole response", async () => {
    stubNominatim([
      null,
      "not a row",
      { lat: " ", lon: " ", display_name: "Blank coordinates" },
      { lat: "48.8584", lon: "2.2945", display_name: "Eiffel Tower" },
    ] as unknown as Record<string, string>[]);

    const { response, body } = await geocode("Eiffel Tower", "user-10");

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.results).toEqual([{ lat: 48.8584, lng: 2.2945, label: "Eiffel Tower" }]);
  });

  it("returns an empty array when every row is unusable", async () => {
    stubNominatim([{ display_name: "No coordinates" }, { lat: "x", lon: "y", display_name: "Nonsense" }]);

    const { response, body } = await geocode("Broken", "user-6");

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.results).toEqual([]);
  });

  // The label falls back to the query per candidate, and the 200-character cap is applied per candidate
  // too — `locationSchemas.ts` caps `location.label` at 200, so a long display name has to be cut here
  // or the save fails on a perfectly ordinary search result.
  it("falls back to the query for a nameless row and caps every label at 200 characters", async () => {
    stubNominatim([{ lat: "1", lon: "2" }, { lat: "3", lon: "4", display_name: "x".repeat(260) }]);

    const { body } = await geocode("Harbor Hotel", "user-7");

    expect(body.data?.results[0].label).toBe("Harbor Hotel");
    expect(body.data?.results[1].label).toHaveLength(200);
  });

  /**
   * The outbound request, which nothing asserted before this story. `limit=5` **is** AC5 — the parser and
   * the candidate list are both inert while the route asks for one row — and the `User-Agent` is required
   * by Nominatim's usage policy, so losing it in a refactor would be a silent etiquette breach.
   *
   * One request per Find, asserted as well: raising the limit must not raise the count, which is the
   * distinction between this and the type-ahead the story rules out.
   */
  it("asks Nominatim for five candidates, once, with a real User-Agent and no caching", async () => {
    const fetchMock = stubNominatim([{ lat: "48.8584", lon: "2.2945", display_name: "Eiffel Tower" }]);

    await geocode("Eiffel Tower", "user-8");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("limit=5");
    expect(String(url)).toContain("format=jsonv2");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("TravelPlan/0.1 geocoding");
    expect(init.cache).toBe("no-store");
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
