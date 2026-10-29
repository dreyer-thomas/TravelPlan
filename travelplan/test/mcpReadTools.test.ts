import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { prisma } from "@/lib/db/prisma";
import { cleanOAuthTables, createUser, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool, issueAccessToken, rpc, type ToolCallBody } from "./helpers/mcpClient";
import { seedPlannerTrip } from "./helpers/plannerFixtures";

/** Story 15.2. The read tools end to end: a real token through `POST /api/mcp`, rows seeded in this file. */

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.trip.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const structured = <T = Record<string, unknown>>(body: ToolCallBody): T => {
  expect(body.result?.isError).toBeFalsy();
  // AC 11: the same JSON as structuredContent and as the one text item.
  expect(body.result?.content).toHaveLength(1);
  expect(JSON.parse(body.result!.content![0].text)).toEqual(body.result?.structuredContent);
  return body.result!.structuredContent as T;
};

const errorText = (body: ToolCallBody) => {
  expect(body.result?.isError).toBe(true);
  return body.result?.content?.[0]?.text;
};

/** Owner, contributor, viewer and stranger on one seeded trip, each with a token. */
const setupTrip = async () => {
  const owner = await createUser();
  const contributor = await createUser();
  const viewer = await createUser();
  const stranger = await createUser();
  const seed = await seedPlannerTrip(owner.id);
  await prisma.tripMember.createMany({
    data: [
      { tripId: seed.trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      { tripId: seed.trip.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  return {
    seed,
    owner: { user: owner, token: await issueAccessToken(owner.id) },
    contributor: { user: contributor, token: await issueAccessToken(contributor.id) },
    viewer: { user: viewer, token: await issueAccessToken(viewer.id) },
    stranger: { user: stranger, token: await issueAccessToken(stranger.id) },
  };
};

describe("access (ruling R1)", () => {
  it("keeps a viewer-only trip invisible in every read tool, with the text a random id gets", async () => {
    const { seed, viewer } = await setupTrip();

    const list = structured(await callTool(viewer.token, "list_trips"));
    expect(list.trips).toEqual([]);

    const tripArgs = { tripId: seed.trip.id };
    const randomArgs = { tripId: "ckrandomnonexistent0000" };
    for (const [name, extra] of [
      ["get_trip", {}],
      ["get_day", { dayId: seed.day2.id }],
      ["get_bucket_list", {}],
    ] as const) {
      const hidden = await callTool(viewer.token, name, { ...tripArgs, ...extra });
      const missing = await callTool(viewer.token, name, { ...randomArgs, ...extra });
      expect(errorText(hidden)).toBe("Trip not found");
      expect(hidden).toEqual(missing);
    }
  });

  it("answers Trip not found to a stranger", async () => {
    const { seed, stranger } = await setupTrip();
    expect(errorText(await callTool(stranger.token, "get_trip", { tripId: seed.trip.id }))).toBe("Trip not found");
    expect(structured(await callTool(stranger.token, "list_trips")).trips).toEqual([]);
  });

  it("gives owner and contributor identical results, role aside", async () => {
    const { seed, owner, contributor } = await setupTrip();

    type List = { trips: Record<string, unknown>[] };
    const ownerList = structured<List>(await callTool(owner.token, "list_trips")).trips;
    const contributorList = structured<List>(await callTool(contributor.token, "list_trips")).trips;
    expect(ownerList).toEqual([
      { id: seed.trip.id, name: "Prague", startDate: "2027-05-01", endDate: "2027-05-03", role: "owner", dayCount: 3 },
    ]);
    expect(contributorList).toEqual([{ ...ownerList[0], role: "contributor" }]);

    for (const [name, args] of [
      ["get_trip", { tripId: seed.trip.id }],
      ["get_day", { tripId: seed.trip.id, dayId: seed.day2.id }],
      ["get_bucket_list", { tripId: seed.trip.id }],
    ] as const) {
      expect(structured(await callTool(contributor.token, name, args))).toEqual(
        structured(await callTool(owner.token, name, args)),
      );
    }
  });
});

describe("list_trips", () => {
  it("lists owned and contributed trips in the app's order, not viewed ones", async () => {
    const owner = await createUser();
    const other = await createUser();
    const later = await prisma.trip.create({
      data: { userId: owner.id, name: "Later", startDate: new Date("2028-01-01"), endDate: new Date("2028-01-02") },
    });
    const earlier = await prisma.trip.create({
      data: { userId: other.id, name: "Earlier", startDate: new Date("2027-01-01"), endDate: new Date("2027-01-01") },
    });
    const viewed = await prisma.trip.create({
      data: { userId: other.id, name: "Viewed", startDate: new Date("2027-06-01"), endDate: new Date("2027-06-01") },
    });
    await prisma.tripMember.createMany({
      data: [
        { tripId: earlier.id, userId: owner.id, role: "CONTRIBUTOR" },
        { tripId: viewed.id, userId: owner.id, role: "VIEWER" },
      ],
    });
    const token = await issueAccessToken(owner.id);
    const trips = structured(await callTool(token, "list_trips")).trips as { id: string; role: string }[];
    expect(trips.map((trip) => [trip.id, trip.role])).toEqual([
      [earlier.id, "contributor"],
      [later.id, "owner"],
    ]);
  });
});

describe("get_trip", () => {
  it("returns the overview per day with stay, missingStay, activityCount and warnings, and no totals", async () => {
    const { seed, owner } = await setupTrip();
    const trip = structured(await callTool(owner.token, "get_trip", { tripId: seed.trip.id }));
    expect(trip).toEqual({
      id: seed.trip.id,
      name: "Prague",
      startDate: "2027-05-01",
      endDate: "2027-05-03",
      days: [
        { id: seed.day1.id, date: "2027-05-01", dayIndex: 1, stay: { name: "Hotel Arrival", status: "planned" }, missingStay: false, activityCount: 0, warnings: [] },
        {
          id: seed.day2.id,
          date: "2027-05-02",
          dayIndex: 2,
          stay: { name: "Hotel Old Town", status: "booked" },
          missingStay: false,
          activityCount: 3,
          warnings: [
            { kind: "late", activityId: seed.dinner.id, title: "Dinner", startTime: "13:30", reachableAt: "14:45", lateMinutes: 75 },
            { kind: "overflow", activityId: seed.nightWalk.id, title: null },
          ],
        },
        { id: seed.day3.id, date: "2027-05-03", dayIndex: 3, stay: null, missingStay: true, activityCount: 0, warnings: [] },
      ],
    });
  });
});

describe("get_day", () => {
  it("returns the day's full payload", async () => {
    const { seed, owner } = await setupTrip();
    const body = await callTool(owner.token, "get_day", { tripId: seed.trip.id, dayId: seed.day2.id });
    const day = structured(body);
    const iso = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(day).toMatchObject({
      id: seed.day2.id,
      date: "2027-05-02",
      dayIndex: 2,
      previousStay: { id: seed.previousStay.id, name: "Hotel Arrival", checkOutTime: "11:00" },
      missingStay: false,
      warnings: [
        { kind: "late", activityId: seed.dinner.id, title: "Dinner", startTime: "13:30", reachableAt: "14:45", lateMinutes: 75 },
        { kind: "overflow", activityId: seed.nightWalk.id, title: null },
      ],
    });
    expect(day.activities).toEqual([
      {
        id: seed.museum.id,
        title: "National Museum",
        description: "Start with the main hall",
        mode: "flexible",
        durationMinutes: 180,
        startTime: "11:15",
        endTime: "14:15",
        place: { label: "Wenceslas Square", lat: 50.079, lng: 14.431 },
        link: "https://museum.example",
        cost: { eurCents: 1500, original: null },
        payments: [],
        documents: [],
        images: [],
        updatedAt: iso,
      },
      {
        id: seed.dinner.id,
        title: "Dinner",
        description: "Table for two",
        mode: "fixed",
        durationMinutes: 90,
        startTime: "13:30",
        endTime: "15:00",
        place: null,
        link: null,
        cost: null,
        payments: [],
        documents: [{ id: expect.any(String), fileName: "menu.pdf" }],
        images: [{ id: expect.any(String), fileName: "table.webp" }],
        updatedAt: iso,
      },
      expect.objectContaining({ id: seed.nightWalk.id, title: null, mode: "flexible", startTime: null, endTime: null }),
    ]);
    expect(day.legs).toEqual([
      {
        id: seed.walkLeg.id,
        from: { type: "stay", id: seed.previousStay.id },
        to: { type: "activity", id: seed.museum.id },
        mode: "walking",
        durationMinutes: 15,
        distanceKm: 1.2,
        link: null,
        updatedAt: iso,
      },
      {
        id: seed.driveLeg.id,
        from: { type: "activity", id: seed.museum.id },
        to: { type: "activity", id: seed.dinner.id },
        mode: "car",
        durationMinutes: 30,
        distanceKm: 12.5,
        link: "https://maps.example/route",
        updatedAt: iso,
      },
    ]);
    expect(day.stay).toEqual({
      id: seed.stay.id,
      name: "Hotel Old Town",
      status: "booked",
      checkInTime: "15:00",
      checkOutTime: "10:30",
      place: { label: "Old Town Square", lat: 50.087, lng: 14.421 },
      link: "https://hotel.example/booking",
      notes: "Late arrival announced",
      cost: { eurCents: 20000, original: { amountMinor: 500000, currency: "CZK", rate: 25, rateDate: "2027-04-01" } },
      payments: [
        { amountEurCents: 5000, dueDate: "2027-04-15", amountOriginalMinor: 125000 },
        { amountEurCents: 15000, dueDate: "2027-05-02", amountOriginalMinor: 375000 },
      ],
      documents: [{ id: expect.any(String), fileName: "booking.pdf" }],
      images: [{ id: expect.any(String), fileName: "front.jpg" }],
      updatedAt: iso,
    });
    expect(JSON.stringify(body)).not.toContain("/uploads/");
  });

  it("finds the same day by dayId and by date", async () => {
    const { seed, owner } = await setupTrip();
    const byId = structured(await callTool(owner.token, "get_day", { tripId: seed.trip.id, dayId: seed.day2.id }));
    const byDate = structured(await callTool(owner.token, "get_day", { tripId: seed.trip.id, date: "2027-05-02" }));
    expect(byDate).toEqual(byId);
  });

  it("refuses neither or both of dayId and date through the input schema", async () => {
    const { seed, owner } = await setupTrip();
    for (const [args, reason] of [
      [{ tripId: seed.trip.id }, "Give exactly one of dayId or date."],
      [{ tripId: seed.trip.id, dayId: seed.day2.id, date: "2027-05-02" }, "Give exactly one of dayId or date."],
      [{ tripId: seed.trip.id, date: "2 May" }, "Use YYYY-MM-DD"],
    ] as const) {
      const body = await callTool(owner.token, "get_day", args);
      expect(body.result?.structuredContent).toBeUndefined();
      expect(errorText(body)).toMatch(/^Input validation error: Invalid arguments for tool get_day/);
      expect(errorText(body)).toContain(reason);
    }
  });

  it("answers Day not found for a day of another trip and a date outside the trip", async () => {
    const { seed, owner } = await setupTrip();
    const other = await seedPlannerTrip(owner.user.id, "Other");
    expect(errorText(await callTool(owner.token, "get_day", { tripId: seed.trip.id, dayId: other.day2.id }))).toBe(
      "Day not found",
    );
    expect(errorText(await callTool(owner.token, "get_day", { tripId: seed.trip.id, date: "2027-05-09" }))).toBe(
      "Day not found",
    );
  });
});

describe("get_bucket_list", () => {
  it("returns parked activities only, in title order, without times", async () => {
    const { seed, owner } = await setupTrip();
    const body = await callTool(owner.token, "get_bucket_list", { tripId: seed.trip.id });
    const { activities } = structured(body);
    expect(activities).toEqual([
      {
        id: seed.castle.id,
        title: "Castle",
        description: "Castle idea",
        mode: "flexible",
        durationMinutes: 60,
        place: null,
        link: null,
        cost: { eurCents: 2000, original: { amountMinor: 50000, currency: "CZK", rate: 25, rateDate: "2027-04-01" } },
        payments: [{ amountEurCents: 2000, dueDate: "2027-05-03", amountOriginalMinor: 50000 }],
        documents: [{ id: expect.any(String), fileName: "ticket.pdf" }],
        images: [{ id: expect.any(String), fileName: "view.jpg" }],
        updatedAt: expect.any(String),
      },
      expect.objectContaining({ id: seed.zoo.id, title: "Zoo", documents: [], images: [] }),
    ]);
    expect(JSON.stringify(body)).not.toContain("/uploads/");

    // The parked/day split: a parked activity is on no day, a day activity is not parked.
    const ids = (activities as { id: string }[]).map((activity) => activity.id);
    expect(ids).not.toContain(seed.museum.id);
    for (const day of [seed.day1, seed.day2, seed.day3]) {
      const read = structured(await callTool(owner.token, "get_day", { tripId: seed.trip.id, dayId: day.id }));
      const dayIds = (read.activities as { id: string }[]).map((activity) => activity.id);
      expect(dayIds).not.toContain(seed.castle.id);
      expect(dayIds).not.toContain(seed.zoo.id);
    }
  });
});

describe("shared tool rules", () => {
  it("logs trip-scoped calls with trip= and never the arguments", async () => {
    const { seed, owner } = await setupTrip();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await callTool(owner.token, "get_day", { tripId: seed.trip.id, date: "2027-05-02" });
    await callTool(owner.token, "list_trips");
    const lines = info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("mcp: tool="));
    expect(lines[0]).toMatch(new RegExp(`^mcp: tool=get_day user=${owner.user.id} trip=${seed.trip.id} outcome=ok ms=\\d+$`));
    expect(lines[1]).toMatch(new RegExp(`^mcp: tool=list_trips user=${owner.user.id} outcome=ok ms=\\d+$`));
  });

  it("refuses the 121st call in a minute, leaves another user alone, and lets the next minute through", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T10:00:00.000Z"));
    const busy = await createUser();
    const other = await createUser();
    const busyToken = await issueAccessToken(busy.id);
    const otherToken = await issueAccessToken(other.id);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    for (let call = 0; call < 120; call += 1) {
      expect((await callTool(busyToken, "list_trips")).result?.isError).toBeFalsy();
    }
    expect(errorText(await callTool(busyToken, "whoami"))).toBe(
      "Rate limit reached: at most 120 TravelPlan tool calls per minute. Wait a minute and try again.",
    );
    expect((await callTool(otherToken, "list_trips")).result?.isError).toBeFalsy();

    vi.setSystemTime(new Date("2027-01-01T10:01:00.001Z"));
    expect((await callTool(busyToken, "list_trips")).result?.isError).toBeFalsy();
  });

  it("answers a read tool on the 2026-07-28 leg", async () => {
    const { seed, owner } = await setupTrip();
    const response = await POST(
      rpc(
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "get_trip",
            arguments: { tripId: seed.trip.id },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
        {
          authorization: `Bearer ${owner.token}`,
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "get_trip",
        },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ToolCallBody;
    expect(body.result?.structuredContent).toMatchObject({ id: seed.trip.id, name: "Prague" });
  });

  it("advertises read-only annotations on every tool", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${token}` }));
    const body = (await response.json()) as { result: { tools: { name: string; annotations: unknown }[] } };
    for (const tool of body.result.tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
    }
  });
});
