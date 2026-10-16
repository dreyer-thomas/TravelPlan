import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/days/[dayId]/suggestions/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

vi.mock("@/lib/ai/daySuggestionService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/daySuggestionService")>("@/lib/ai/daySuggestionService");
  return {
    ...actual,
    requestDaySuggestions: vi.fn(),
  };
});

vi.mock("@/lib/ai/verifySuggestions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/verifySuggestions")>("@/lib/ai/verifySuggestions");
  return {
    ...actual,
    verifySuggestionLocations: vi.fn(),
  };
});

vi.mock("@/lib/ai/suggestionImages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/suggestionImages")>("@/lib/ai/suggestionImages");
  return {
    ...actual,
    attachSuggestionImages: vi.fn(),
  };
});

import Anthropic from "@anthropic-ai/sdk";
import { AiSuggestionError, requestDaySuggestions } from "@/lib/ai/daySuggestionService";
import { verifySuggestionLocations } from "@/lib/ai/verifySuggestions";
import { attachSuggestionImages } from "@/lib/ai/suggestionImages";

const actualService = await vi.importActual<typeof import("@/lib/ai/daySuggestionService")>("@/lib/ai/daySuggestionService");
const actualVerify = await vi.importActual<typeof import("@/lib/ai/verifySuggestions")>("@/lib/ai/verifySuggestions");

/**
 * Story 12.1, AC10. The route end to end on a real per-worker SQLite database, with the model call
 * mocked at its module boundary and Nominatim stubbed through `fetch`. Verification is mocked to "all
 * unverified" by default, because the real one spends the one-second Nominatim spacing in real time;
 * the first case runs it for real, once.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type Suggestion = {
  title: string;
  locationLabel: string;
  lat: number;
  lng: number;
  verified: boolean;
};

const CSRF = "csrf-token";
const BASE = { lat: 52.52, lng: 13.405 };
const north = (meters: number) => ({ lat: BASE.lat + ((meters / 6371000) * 180) / Math.PI, lng: BASE.lng });

const modelSuggestion = (label: string) => ({
  title: label,
  description: `Why ${label}.`,
  locationLabel: label,
  lat: BASE.lat,
  lng: BASE.lng,
  durationMinutes: 60,
});

const threeSuggestions = () => ["Near", "Far", "Down"].map(modelSuggestion);

const ENV_KEYS = ["ANTHROPIC_API_KEY", "AI_SUGGESTIONS_DAILY_LIMIT"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const buildRequest = (
  tripId: string,
  dayId: string,
  options: { session?: string; csrf?: string | null; body?: unknown; rawBody?: string } = {},
) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const cookies: string[] = [];
  if (options.session) cookies.push(`session=${options.session}`);
  const csrf = options.csrf === undefined ? CSRF : options.csrf;
  if (csrf) {
    cookies.push(`csrf_token=${csrf}`);
    headers["x-csrf-token"] = csrf;
  }
  if (cookies.length) headers.cookie = cookies.join("; ");
  return new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/suggestions`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? { prompt: "museums", mode: "walking" }),
  });
};

const call = async (tripId: string, dayId: string, options: Parameters<typeof buildRequest>[2] = {}) => {
  const response = await POST(buildRequest(tripId, dayId, options), {
    params: Promise.resolve({ id: tripId, dayId }),
  });
  const body = (await response.json()) as ApiEnvelope<{ suggestions: Suggestion[] }>;
  return { status: response.status, body };
};

let counter = 0;
const makeUser = (role: "OWNER" | "ADMIN" = "OWNER") =>
  prisma.user.create({
    data: { email: `suggest-${Date.now()}-${counter++}@example.com`, passwordHash: "hashed", role },
  });
const sessionFor = (user: { id: string; role: "OWNER" | "VIEWER" | "ADMIN" }) =>
  createSessionJwt({ sub: user.id, role: user.role });

const seedTrip = async () => {
  const owner = await makeUser();
  const { trip } = await createTripWithDays({
    userId: owner.id,
    name: "Secret Trip Name",
    startDate: "2026-08-01T00:00:00.000Z",
    endDate: "2026-08-02T00:00:00.000Z",
    startLocation: { lat: 52.52, lng: 13.405, label: "Berlin Hbf" },
  });
  const days = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
  return { owner, trip, days };
};

const addMember = async (tripId: string, role: "VIEWER" | "CONTRIBUTOR", userRole: "OWNER" | "ADMIN" = "OWNER") => {
  const user = await makeUser(userRole);
  await prisma.tripMember.create({ data: { tripId, userId: user.id, role } });
  return user;
};

/** Nominatim: "Near" 1.9 km away, "Far" 2.1 km away, "Down" fails; anything else no match. */
const stubNominatim = () => {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const q = new URL(String(input)).searchParams.get("q");
    if (q === "Down") {
      return { ok: false, status: 503, json: async () => [] };
    }
    const point = q === "Near" ? north(1900) : q === "Far" ? north(2100) : null;
    const rows = point ? [{ lat: String(point.lat), lon: String(point.lng), display_name: `${q} (Nominatim)` }] : [];
    return { ok: true, status: 200, json: async () => rows };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("POST /api/trips/[id]/days/[dayId]/suggestions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    delete process.env.AI_SUGGESTIONS_DAILY_LIMIT;
    vi.mocked(requestDaySuggestions).mockResolvedValue(threeSuggestions());
    vi.mocked(verifySuggestionLocations).mockImplementation(async (suggestions) =>
      suggestions.map((suggestion) => ({ ...suggestion, verified: false })),
    );
    // Story 12.2: "no images" by default, so no case here reaches Wikimedia over the real network.
    vi.mocked(attachSuggestionImages).mockImplementation(async (suggestions) =>
      suggestions.map((suggestion) => ({ ...suggestion, images: [] })),
    );
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("answers the owner with verified and unverified suggestions (1.9 km yes, 2.1 km no, Nominatim down no)", async () => {
    const { owner, trip, days } = await seedTrip();
    const fetchMock = stubNominatim();
    vi.mocked(verifySuggestionLocations).mockImplementation(actualVerify.verifySuggestionLocations);

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(owner) });

    expect(status).toBe(200);
    expect(body.error).toBeNull();
    const [near, far, down] = body.data!.suggestions;
    expect(near).toMatchObject({ locationLabel: "Near", verified: true, lat: north(1900).lat });
    expect(far).toMatchObject({ locationLabel: "Far", verified: false, lat: BASE.lat });
    expect(down).toMatchObject({ locationLabel: "Down", verified: false, lat: BASE.lat });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("TravelPlan/0.1 suggestions");
  });

  it("attaches the image lookup's pictures to the verified suggestions (Story 12.2)", async () => {
    const { owner, trip, days } = await seedTrip();
    const image = {
      thumbnailUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/250px-X.jpg",
      originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg",
    };
    vi.mocked(verifySuggestionLocations).mockImplementation(async (suggestions) =>
      suggestions.map((suggestion, index) => ({ ...suggestion, verified: index === 0 })),
    );
    vi.mocked(attachSuggestionImages).mockImplementation(async (suggestions) =>
      suggestions.map((suggestion, index) => ({ ...suggestion, images: index === 0 ? [image] : [] })),
    );

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(owner) });

    expect(status).toBe(200);
    const [verifiedInput, options] = vi.mocked(attachSuggestionImages).mock.calls[0];
    expect(verifiedInput.map((suggestion) => suggestion.verified)).toEqual([true, false, false]);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const suggestions = body.data!.suggestions as Array<Suggestion & { images: unknown[] }>;
    expect(suggestions.map((suggestion) => suggestion.images)).toEqual([[image], [], []]);
    expect(suggestions[0]).toMatchObject({ locationLabel: "Near", verified: true });
  });

  it("still answers 200 with images: [] when the image lookup rejects (AC7)", async () => {
    const { owner, trip, days } = await seedTrip();
    vi.mocked(verifySuggestionLocations).mockImplementation(async (suggestions) =>
      suggestions.map((suggestion) => ({ ...suggestion, verified: true })),
    );
    vi.mocked(attachSuggestionImages).mockRejectedValueOnce(new TypeError("a bug in the image step"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(owner) });

    expect(status).toBe(200);
    const suggestions = body.data!.suggestions as Array<Suggestion & { images: unknown[] }>;
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.images)).toEqual([[], [], []]);
    expect(warnSpy).toHaveBeenCalledWith("day suggestions: image step failed", { name: "TypeError" });
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("passes only the day context, the wish and the mode to the model - no member data", async () => {
    const { owner, trip, days } = await seedTrip();
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[0].id,
        title: "Pergamon",
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "private note" }] }] }),
        costCents: 1234,
        linkUrl: "https://secret.example.com",
      },
    });
    stubNominatim();

    await call(trip.id, days[0].id, { session: await sessionFor(owner), body: { prompt: "  museums  ", mode: "cycling" } });

    const [args] = vi.mocked(requestDaySuggestions).mock.calls[0];
    expect(args.prompt).toBe("museums");
    expect(args.mode).toBe("cycling");
    expect(args.context).toEqual({
      date: "2026-08-01",
      start: { label: "Berlin Hbf", lat: 52.52, lng: 13.405 },
      end: null,
      existingTitles: ["Pergamon"],
    });
    const sent = JSON.stringify(args);
    for (const secret of ["Secret Trip Name", owner.email, owner.id, "private note", "1234", "secret.example.com"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("sends Claude no trip name, email, note, cost or link - checked on the real request body", async () => {
    const { owner, trip, days } = await seedTrip();
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[0].id,
        title: "Pergamon",
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "private note" }] }] }),
        costCents: 1234,
        linkUrl: "https://secret.example.com",
      },
    });
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ suggestions: threeSuggestions() }), citations: null }],
    }));
    const client = { messages: { create } } as unknown as Anthropic;
    vi.mocked(requestDaySuggestions).mockImplementationOnce((args) => actualService.requestDaySuggestions({ ...args, client }));

    const { status } = await call(trip.id, days[0].id, { session: await sessionFor(owner) });

    expect(status).toBe(200);
    const sent = JSON.stringify(create.mock.calls[0]);
    expect(sent).toContain("Pergamon");
    expect(sent).toContain("Berlin Hbf");
    for (const secret of ["Secret Trip Name", owner.email, owner.id, "private note", "1234", "secret.example.com", "sk-ant-test-key"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("admits a contributor", async () => {
    const { trip, days } = await seedTrip();
    const contributor = await addMember(trip.id, "CONTRIBUTOR");
    stubNominatim();

    const { status } = await call(trip.id, days[0].id, { session: await sessionFor(contributor) });

    expect(status).toBe(200);
  });

  it("admits an admin who can view the trip", async () => {
    const { trip, days } = await seedTrip();
    const admin = await addMember(trip.id, "VIEWER", "ADMIN");
    stubNominatim();

    const { status } = await call(trip.id, days[0].id, { session: await sessionFor(admin) });

    expect(status).toBe(200);
  });

  it("refuses a viewer who is not an admin with 403, without calling Claude", async () => {
    const { trip, days } = await seedTrip();
    const viewer = await addMember(trip.id, "VIEWER");

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(viewer) });

    expect(status).toBe(403);
    expect(body.error).toMatchObject({ code: "forbidden", message: "Trip write access required" });
    expect(requestDaySuggestions).not.toHaveBeenCalled();
  });

  it("refuses an admin who is not on the trip with 404", async () => {
    const { trip, days } = await seedTrip();
    const admin = await makeUser("ADMIN");

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(admin) });

    expect(status).toBe(404);
    expect(body.error).toMatchObject({ code: "not_found", message: "Trip day not found" });
    expect(requestDaySuggestions).not.toHaveBeenCalled();
  });

  it("answers 404 for a day that belongs to another trip", async () => {
    const a = await seedTrip();
    const b = await seedTrip();

    const { status } = await call(a.trip.id, b.days[0].id, { session: await sessionFor(a.owner) });

    expect(status).toBe(404);
    expect(requestDaySuggestions).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    const { trip, days } = await seedTrip();

    const { status, body } = await call(trip.id, days[0].id);

    expect(status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  it("answers 403 csrf_invalid without a CSRF token", async () => {
    const { owner, trip, days } = await seedTrip();

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(owner), csrf: null });

    expect(status).toBe(403);
    expect(body.error?.code).toBe("csrf_invalid");
  });

  it("answers 503 ai_unavailable when the key is unset or blank, before looking at the trip", async () => {
    const owner = await makeUser();
    const session = await sessionFor(owner);

    delete process.env.ANTHROPIC_API_KEY;
    const unset = await call("no-such-trip", "no-such-day", { session });
    process.env.ANTHROPIC_API_KEY = "   ";
    const blank = await call("no-such-trip", "no-such-day", { session });

    expect(unset.status).toBe(503);
    expect(unset.body.error?.code).toBe("ai_unavailable");
    expect(blank.status).toBe(503);
    expect(requestDaySuggestions).not.toHaveBeenCalled();
  });

  it("answers 400 invalid_json and validation_error without calling Claude", async () => {
    const { owner, trip, days } = await seedTrip();
    const session = await sessionFor(owner);

    const badJson = await call(trip.id, days[0].id, { session, rawBody: "{not json" });
    const emptyPrompt = await call(trip.id, days[0].id, { session, body: { prompt: "   ", mode: "car" } });
    const longPrompt = await call(trip.id, days[0].id, { session, body: { prompt: "x".repeat(501), mode: "car" } });
    const badMode = await call(trip.id, days[0].id, { session, body: { prompt: "museums", mode: "train" } });

    expect(badJson.status).toBe(400);
    expect(badJson.body.error?.code).toBe("invalid_json");
    for (const result of [emptyPrompt, longPrompt, badMode]) {
      expect(result.status).toBe(400);
      expect(result.body.error?.code).toBe("validation_error");
      expect(result.body.error?.details).toBeDefined();
    }
    expect(requestDaySuggestions).not.toHaveBeenCalled();
  });

  it("answers 429 after the daily limit, counting failed model calls but not refused requests", async () => {
    process.env.AI_SUGGESTIONS_DAILY_LIMIT = "2";
    const { owner, trip, days } = await seedTrip();
    const session = await sessionFor(owner);
    const viewer = await addMember(trip.id, "VIEWER");
    stubNominatim();
    vi.mocked(requestDaySuggestions).mockRejectedValueOnce(new AiSuggestionError("ai_failed", "x"));

    // Refusals before the model call do not count.
    await call(trip.id, days[0].id, { session, body: { prompt: "", mode: "car" } });
    await call(trip.id, days[0].id, { session: await sessionFor(viewer) });

    const failed = await call(trip.id, days[0].id, { session });
    const second = await call(trip.id, days[0].id, { session, body: { prompt: "zzz", mode: "car" } });
    const third = await call(trip.id, days[0].id, { session });

    expect(failed.status).toBe(502);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error?.code).toBe("ai_limit_reached");
    expect(requestDaySuggestions).toHaveBeenCalledTimes(2);
  });

  it("answers 502 ai_failed with a generic message when the model call fails", async () => {
    const { owner, trip, days } = await seedTrip();
    vi.mocked(requestDaySuggestions).mockRejectedValueOnce(
      new AiSuggestionError("ai_failed", "Unable to get suggestions right now", undefined, "APIConnectionTimeoutError"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(owner) });

    expect(status).toBe(502);
    expect(body).toEqual({ data: null, error: { code: "ai_failed", message: "Unable to get suggestions right now" } });
    // The log line carries class names and the status only.
    expect(errorSpy).toHaveBeenCalledWith("day suggestions: request failed", {
      name: "AiSuggestionError",
      upstream: "APIConnectionTimeoutError",
      status: undefined,
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-ant-test-key");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("museums");
    errorSpy.mockRestore();
  });

  it("answers 500 server_error for anything else", async () => {
    const { owner, trip, days } = await seedTrip();
    vi.mocked(requestDaySuggestions).mockRejectedValueOnce(new TypeError("a bug"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await call(trip.id, days[0].id, { session: await sessionFor(owner) });

    expect(status).toBe(500);
    expect(body.error?.code).toBe("server_error");
    errorSpy.mockRestore();
  });
});
