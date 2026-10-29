import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/trips/[id]/day-plan-items/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { GeocodingError } from "@/lib/geocoding/nominatim";
import { activityWriteDeps } from "@/lib/mcp/tools/activityWrite";
import { createDayPlanItemForTripDay, updateDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { cleanOAuthTables, createUser, HOSTED_CLIENT_ID, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool, issueAccessToken, type ToolCallBody } from "./helpers/mcpClient";
import { plannerDoc, seedPlannerTrip } from "./helpers/plannerFixtures";

/**
 * Story 15.4. The activity write tools and the AI-change tools end to end: a real token through
 * `POST /api/mcp`, the geocoder stubbed through `activityWriteDeps`.
 */

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Activity = {
  id: string;
  title: string | null;
  description: string;
  mode: string;
  durationMinutes: number;
  startTime?: string | null;
  endTime?: string | null;
  place: { label: string | null; lat: number; lng: number } | null;
  updatedAt: string;
  aiChangedAt: string | null;
};
type Day = { id: string; activities: Activity[]; warnings: unknown[] };
type WriteResult = { aiChangeId: string; activity: Activity | null; day: Day | null; parkAiChangeId?: string };

const structured = <T = WriteResult>(body: ToolCallBody): T => {
  expect(body.result?.isError, JSON.stringify(body)).toBeFalsy();
  return body.result!.structuredContent as T;
};

const errorText = (body: ToolCallBody) => {
  expect(body.result?.isError).toBe(true);
  return body.result?.content?.[0]?.text;
};

const setupTrip = async () => {
  const owner = await createUser();
  const contributor = await createUser();
  const viewer = await createUser();
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
  };
};

const stubGeocode = (result: { lat: number; lng: number } | null = { lat: 48.8606, lng: 2.3376 }) =>
  vi.spyOn(activityWriteDeps, "geocode").mockResolvedValue(result);

const titles = (day: Day | null) => day?.activities.map((activity) => activity.title);

const getDay = async (token: string, tripId: string, dayId: string) =>
  structured<Day>(await callTool(token, "get_day", { tripId, dayId }));

describe.each(["owner", "contributor"] as const)("every tool as %s", (role) => {
  it("creates, edits, moves, parks, schedules, moves to a day, deletes, lists and undoes", async () => {
    const setup = await setupTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;
    stubGeocode();

    const louvre = structured(
      await callTool(token, "create_activity", {
        tripId,
        dayId: seed.day3.id,
        title: "Louvre",
        durationMinutes: 90,
        place: { name: "Louvre" },
      }),
    );
    expect(louvre.activity).toMatchObject({ title: "Louvre", description: "Louvre", mode: "flexible", durationMinutes: 90 });
    expect(louvre.activity?.aiChangedAt).not.toBeNull();
    const orsay = structured(
      await callTool(token, "create_activity", { tripId, dayId: seed.day3.id, title: "Orsay", place: { lat: 48.86, lng: 2.32 } }),
    );
    expect(titles(orsay.day)).toEqual(["Louvre", "Orsay"]);

    const renamed = structured(
      await callTool(token, "update_activity", {
        tripId,
        activityId: louvre.activity!.id,
        updatedAt: louvre.activity!.updatedAt,
        title: "Louvre Museum",
      }),
    );
    expect(renamed.activity).toMatchObject({ title: "Louvre Museum", durationMinutes: 90 });

    const moved = structured(
      await callTool(token, "move_activity", { tripId, activityId: orsay.activity!.id, position: 1 }),
    );
    expect(titles(moved.day)).toEqual(["Orsay", "Louvre Museum"]);

    const parked = structured(await callTool(token, "park_activity", { tripId, activityId: louvre.activity!.id }));
    expect(parked.activity).toMatchObject({ id: louvre.activity!.id, title: "Louvre Museum" });
    expect(parked.activity).not.toHaveProperty("startTime");
    expect(titles(parked.day)).toEqual(["Orsay"]);

    const scheduled = structured(
      await callTool(token, "schedule_activity", { tripId, activityId: louvre.activity!.id, dayId: seed.day3.id }),
    );
    expect(titles(scheduled.day)).toEqual(["Orsay", "Louvre Museum"]);

    const toDay = structured(
      await callTool(token, "move_activity_to_day", { tripId, activityId: louvre.activity!.id, dayId: seed.day1.id }),
    );
    expect(titles(toDay.day)).toEqual(["Louvre Museum"]);
    expect(toDay.parkAiChangeId).toEqual(expect.any(String));

    const deleted = structured<{ aiChangeId: string; deletedActivityId: string; day: Day }>(
      await callTool(token, "delete_activity", {
        tripId,
        activityId: louvre.activity!.id,
        updatedAt: toDay.activity!.updatedAt,
      }),
    );
    expect(deleted.deletedActivityId).toBe(louvre.activity!.id);
    expect(deleted.day.activities).toEqual([]);

    const listed = structured<{ changes: { id: string; action: string; summary: string; undoable: boolean; clientHost: string }[] }>(
      await callTool(token, "list_ai_changes", { tripId }),
    );
    expect(listed.changes.map((change) => change.action)).toEqual([
      "deleted",
      "scheduled",
      "parked",
      "scheduled",
      "parked",
      "moved",
      "updated",
      "created",
      "created",
    ]);
    expect(listed.changes[0]).toMatchObject({
      id: deleted.aiChangeId,
      summary: 'Deleted activity "Louvre Museum"',
      undoable: true,
      clientHost: "claude.ai",
    });

    expect(structured(await callTool(token, "undo_ai_change", { tripId, changeId: deleted.aiChangeId }))).toEqual({
      undone: true,
      changeId: deleted.aiChangeId,
    });
    expect(titles(await getDay(token, tripId, seed.day1.id))).toEqual(["Louvre Museum"]);
  });
});

describe("access (ruling R1)", () => {
  it("answers Trip not found to a viewer in every write tool and writes nothing", async () => {
    const { seed, viewer } = await setupTrip();
    const tripId = seed.trip.id;
    const updatedAt = seed.museum.updatedAt.toISOString();
    for (const [name, args] of [
      ["create_activity", { dayId: seed.day3.id, title: "Nope" }],
      ["update_activity", { activityId: seed.museum.id, updatedAt, title: "Nope" }],
      ["delete_activity", { activityId: seed.museum.id, updatedAt }],
      ["move_activity", { activityId: seed.museum.id, direction: "later" }],
      ["move_activity_to_day", { activityId: seed.museum.id, dayId: seed.day3.id }],
      ["park_activity", { activityId: seed.museum.id }],
      ["schedule_activity", { activityId: seed.zoo.id, dayId: seed.day3.id }],
      ["list_ai_changes", {}],
      ["undo_ai_change", { changeId: "cknonexistent" }],
    ] as const) {
      expect(errorText(await callTool(viewer.token, name, { tripId, ...args }))).toBe("Trip not found");
    }
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { tripId } })).toBe(5);
  });

  it("refuses every write tool without a client id, recording nothing, while read tools still answer", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    await prisma.oAuthToken.updateMany({ where: { userId: owner.user.id }, data: { clientId: "" } });
    const updatedAt = seed.museum.updatedAt.toISOString();
    for (const [name, args] of [
      ["create_activity", { dayId: seed.day3.id, title: "Nope" }],
      ["update_activity", { activityId: seed.museum.id, updatedAt, title: "Nope" }],
      ["delete_activity", { activityId: seed.museum.id, updatedAt }],
      ["move_activity", { activityId: seed.museum.id, direction: "later" }],
      ["move_activity_to_day", { activityId: seed.museum.id, dayId: seed.day3.id }],
      ["park_activity", { activityId: seed.museum.id }],
      ["schedule_activity", { activityId: seed.zoo.id, dayId: seed.day3.id }],
    ] as const) {
      expect(errorText(await callTool(owner.token, name, { tripId, ...args }))).toBe("Not authenticated");
    }
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { tripId } })).toBe(5);
    expect(titles(await getDay(owner.token, tripId, seed.day2.id))).toEqual(["National Museum", "Dinner", null]);
  });

  it("answers Activity not found and Day not found for ids outside the trip", async () => {
    const { seed, owner } = await setupTrip();
    const other = await seedPlannerTrip(owner.user.id, "Other");
    const tripId = seed.trip.id;
    expect(errorText(await callTool(owner.token, "park_activity", { tripId, activityId: other.museum.id }))).toBe(
      "Activity not found",
    );
    expect(errorText(await callTool(owner.token, "create_activity", { tripId, dayId: other.day3.id, title: "X" }))).toBe(
      "Day not found",
    );
    expect(
      errorText(await callTool(owner.token, "move_activity_to_day", { tripId, activityId: seed.museum.id, dayId: other.day3.id })),
    ).toBe("Day not found");
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: "cknonexistent" }))).toBe(
      "AI change not found",
    );
  });

  it("advertises write annotations, destructive for edits, deletes and undo", async () => {
    const { seed, owner } = await setupTrip();
    void seed;
    const { POST } = await import("@/app/api/mcp/route");
    const { rpc } = await import("./helpers/mcpClient");
    const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${owner.token}` }));
    const body = (await response.json()) as { result: { tools: { name: string; annotations: Record<string, boolean> }[] } };
    const annotations = new Map(body.result.tools.map((tool) => [tool.name, tool.annotations]));
    expect(annotations.get("create_activity")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotations.get("update_activity")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(annotations.get("delete_activity")).toMatchObject({ destructiveHint: true });
    expect(annotations.get("undo_ai_change")).toMatchObject({ destructiveHint: true });
    expect(annotations.get("list_ai_changes")).toMatchObject({ readOnlyHint: true });
  });
});

describe("create_activity", () => {
  it("geocodes a place by name, stores Markdown as the editor's JSON, marks the row and records one change", async () => {
    const { seed, owner } = await setupTrip();
    const geocode = stubGeocode();
    const result = structured(
      await callTool(owner.token, "create_activity", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        title: "Louvre",
        description: "See **Mona Lisa**\n- Wing *Denon*\n- [Tickets](https://louvre.example/t)",
        durationMinutes: 90,
        place: { name: "Louvre" },
      }),
    );
    expect(geocode).toHaveBeenCalledWith("Louvre");
    expect(result.activity).toMatchObject({
      title: "Louvre",
      description: "See Mona Lisa\n- Wing Denon\n- Tickets (https://louvre.example/t)",
      startTime: "10:30",
      endTime: "12:00",
      place: { label: "Louvre", lat: 48.8606, lng: 2.3376 },
    });

    const row = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: result.activity!.id } });
    expect(row.aiChangedAt).not.toBeNull();
    expect(JSON.parse(row.contentJson).content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "text", text: "Mona Lisa", marks: [{ type: "bold" }] },
      ],
    });
    expect(JSON.parse(row.contentJson).content[1].type).toBe("bulletList");

    const changes = await prisma.aiChange.findMany();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: result.aiChangeId,
      tripId: seed.trip.id,
      tripDayId: seed.day3.id,
      userId: owner.user.id,
      clientId: HOSTED_CLIENT_ID,
      action: "created",
      subject: "Louvre",
      undoneAt: null,
    });
    expect(JSON.parse(changes[0].receiptJson!)).toMatchObject({ version: 3, edited: { kind: "created" } });
  });

  it("writes nothing when the place is not found or the geocoder is down", async () => {
    const { seed, owner } = await setupTrip();
    const args = { tripId: seed.trip.id, dayId: seed.day3.id, title: "Nowhere", place: { name: "Nowhere at all" } };
    stubGeocode(null);
    expect(errorText(await callTool(owner.token, "create_activity", args))).toMatch(/^No place was found.*lat and place\.lng/);
    vi.spyOn(activityWriteDeps, "geocode").mockRejectedValue(new GeocodingError("geocoding_unavailable", "down"));
    expect(errorText(await callTool(owner.token, "create_activity", args))).toMatch(/^The place search is unavailable/);
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("does not geocode a create or an edit the day or the payload refuses anyway", async () => {
    const { seed, owner } = await setupTrip();
    const other = await seedPlannerTrip(owner.user.id, "Other");
    const tripId = seed.trip.id;
    const geocode = stubGeocode();
    const place = { name: "Louvre" };
    expect(errorText(await callTool(owner.token, "create_activity", { tripId, dayId: other.day3.id, title: "X", place }))).toBe(
      "Day not found",
    );
    expect(
      errorText(await callTool(owner.token, "create_activity", { tripId, dayId: seed.day3.id, title: "Show", mode: "fixed", place })),
    ).toContain("From time is required");
    const museum = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } });
    expect(
      errorText(
        await callTool(owner.token, "update_activity", {
          tripId,
          activityId: museum.id,
          updatedAt: museum.updatedAt.toISOString(),
          mode: "fixed",
          place,
        }),
      ),
    ).toContain("From time is required");
    expect(geocode).not.toHaveBeenCalled();
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("validates as the app does: fixed needs a start and an end or a duration within the day", async () => {
    const { seed, owner } = await setupTrip();
    const base = { tripId: seed.trip.id, dayId: seed.day3.id, title: "Show", mode: "fixed" };
    expect(errorText(await callTool(owner.token, "create_activity", base))).toContain("From time is required");
    expect(errorText(await callTool(owner.token, "create_activity", { ...base, startTime: "20:00" }))).toContain(
      "To time is required",
    );
    expect(
      errorText(await callTool(owner.token, "create_activity", { ...base, startTime: "23:00", durationMinutes: 120 })),
    ).toContain("The activity would end after midnight");
    const fixed = structured(
      await callTool(owner.token, "create_activity", { ...base, startTime: "20:00", durationMinutes: 120 }),
    );
    expect(fixed.activity).toMatchObject({ mode: "fixed", startTime: "20:00", endTime: "22:00" });
    expect(errorText(await callTool(owner.token, "create_activity", { tripId: seed.trip.id, title: "Idea", mode: "fixed" }))).toMatch(
      /^A bucket-list activity is always flexible/,
    );
  });

  it("refuses times on a flexible activity and an empty description, writing nothing", async () => {
    const { seed, owner } = await setupTrip();
    const base = { tripId: seed.trip.id, dayId: seed.day3.id, title: "Show" };
    for (const args of [
      { ...base, startTime: "20:00", endTime: "21:00" },
      { ...base, mode: "flexible", startTime: "20:00" },
      { ...base, endTime: "21:00" },
    ]) {
      expect(errorText(await callTool(owner.token, "create_activity", args))).toMatch(/pass mode "fixed"/);
    }
    expect(errorText(await callTool(owner.token, "create_activity", { ...base, description: "  \n " }))).toBe(
      "description must not be empty (the app requires text).",
    );
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("inserts a flexible activity after afterActivityId", async () => {
    const { seed, owner } = await setupTrip();
    const result = structured(
      await callTool(owner.token, "create_activity", {
        tripId: seed.trip.id,
        dayId: seed.day2.id,
        title: "Coffee",
        durationMinutes: 30,
        afterActivityId: seed.museum.id,
      }),
    );
    expect(titles(result.day)).toEqual(["National Museum", "Coffee", "Dinner", null]);
    expect(
      errorText(
        await callTool(owner.token, "create_activity", {
          tripId: seed.trip.id,
          dayId: seed.day3.id,
          title: "Coffee",
          afterActivityId: seed.museum.id,
        }),
      ),
    ).toBe("afterActivityId must be an activity on the same day.");
  });

  it("gives the same order and times as the app's create on a twin day (recompute parity)", async () => {
    const owner = await createUser();
    const token = await issueAccessToken(owner.id);
    const trip = await prisma.trip.create({
      data: { userId: owner.id, name: "Twins", startDate: new Date("2027-06-01"), endDate: new Date("2027-06-02") },
    });
    const twinA = await prisma.tripDay.create({ data: { tripId: trip.id, dayIndex: 1, date: new Date("2027-06-01") } });
    const twinB = await prisma.tripDay.create({ data: { tripId: trip.id, dayIndex: 1, date: new Date("2027-06-02") } });
    const userCreate = (tripDayId: string, title: string, extra: Record<string, unknown> = {}) =>
      createDayPlanItemForTripDay({
        userId: owner.id,
        tripId: trip.id,
        tripDayId,
        title,
        scheduleMode: "FLEXIBLE",
        durationMinutes: 120,
        fromTime: null,
        toTime: null,
        contentJson: plannerDoc(title),
        origin: "user",
        ...extra,
      });
    for (const day of [twinA, twinB]) {
      await userCreate(day.id, "Breakfast");
      await userCreate(day.id, "Lunch", { scheduleMode: "FIXED", fromTime: "12:00", toTime: "13:00" });
    }

    structured(
      await callTool(token, "create_activity", { tripId: trip.id, dayId: twinA.id, title: "Walk", durationMinutes: 150 }),
    );
    await userCreate(twinB.id, "Walk", { durationMinutes: 150 });

    const shape = (day: Day) => day.activities.map((activity) => [activity.title, activity.startTime, activity.endTime]);
    const dayA = await getDay(token, trip.id, twinA.id);
    const dayB = await getDay(token, trip.id, twinB.id);
    expect(shape(dayA)).toEqual(shape(dayB));
    expect(dayA.warnings).toEqual(dayB.warnings);
    expect(dayA.activities.find((activity) => activity.title === "Walk")?.aiChangedAt).not.toBeNull();
    expect(dayB.activities.find((activity) => activity.title === "Walk")?.aiChangedAt).toBeNull();
  });
});

describe("update_activity", () => {
  it("changes only the given fields, keeps cost and link, and sets the marker", async () => {
    const { seed, owner } = await setupTrip();
    const result = structured(
      await callTool(owner.token, "update_activity", {
        tripId: seed.trip.id,
        activityId: seed.museum.id,
        updatedAt: (await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } })).updatedAt.toISOString(),
        title: "Museum",
      }),
    );
    expect(result.activity).toMatchObject({
      title: "Museum",
      description: "Start with the main hall",
      durationMinutes: 180,
      place: { label: "Wenceslas Square", lat: 50.079, lng: 14.431 },
      link: "https://museum.example",
      cost: { eurCents: 1500, original: null },
    });
    expect(result.activity?.aiChangedAt).not.toBeNull();
    expect(await prisma.aiChange.findFirst()).toMatchObject({ action: "updated", subject: "Museum" });
  });

  it("refuses an update that changes nothing, writing no row and no change", async () => {
    const { seed, owner } = await setupTrip();
    const before = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } });
    const body = await callTool(owner.token, "update_activity", {
      tripId: seed.trip.id,
      activityId: seed.museum.id,
      updatedAt: before.updatedAt.toISOString(),
    });
    expect(errorText(body)).toBe("Nothing to change.");
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } })).toEqual(before);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("refuses times on an activity that stays flexible, an empty description and a non-ISO updatedAt", async () => {
    const { seed, owner } = await setupTrip();
    const updatedAt = (await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } })).updatedAt.toISOString();
    const base = { tripId: seed.trip.id, activityId: seed.museum.id, updatedAt };
    expect(errorText(await callTool(owner.token, "update_activity", { ...base, startTime: "15:00" }))).toMatch(
      /pass mode "fixed"/,
    );
    expect(errorText(await callTool(owner.token, "update_activity", { ...base, description: " " }))).toBe(
      "description must not be empty (the app requires text).",
    );
    const loose = await callTool(owner.token, "update_activity", { ...base, updatedAt: "May 2, 2027", title: "X" });
    expect(JSON.stringify(loose)).toContain("Use the ISO 8601 updatedAt from the read");
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("moves a fixed activity's end with its start when only startTime is given", async () => {
    const { seed, owner } = await setupTrip();
    const created = structured(
      await callTool(owner.token, "create_activity", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        title: "Tour",
        mode: "fixed",
        startTime: "10:00",
        endTime: "11:00",
      }),
    );
    const moved = structured(
      await callTool(owner.token, "update_activity", {
        tripId: seed.trip.id,
        activityId: created.activity!.id,
        updatedAt: created.activity!.updatedAt,
        startTime: "14:00",
      }),
    );
    expect(moved.activity).toMatchObject({ mode: "fixed", startTime: "14:00", endTime: "15:00" });
  });

  it("refuses a stale updatedAt and writes nothing", async () => {
    const { seed, owner } = await setupTrip();
    const body = await callTool(owner.token, "update_activity", {
      tripId: seed.trip.id,
      activityId: seed.museum.id,
      updatedAt: "2020-01-01T00:00:00.000Z",
      title: "Stale",
    });
    expect(errorText(body)).toBe(
      "This activity changed since you read it; read it again with get_day or get_bucket_list and retry with the new updatedAt.",
    );
    const row = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } });
    expect(row.title).toBe("National Museum");
    expect(row.aiChangedAt).toBeNull();
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("clears the place with null and loses the marker when a person edits in the app", async () => {
    const { seed, owner } = await setupTrip();
    const before = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } });
    const updated = structured(
      await callTool(owner.token, "update_activity", {
        tripId: seed.trip.id,
        activityId: seed.museum.id,
        updatedAt: before.updatedAt.toISOString(),
        place: null,
      }),
    );
    expect(updated.activity).toMatchObject({ place: null });
    expect(updated.activity?.aiChangedAt).not.toBeNull();

    const csrf = "csrf-token-value";
    const session = await createSessionJwt({ sub: owner.user.id, role: "OWNER" });
    const request = new NextRequest(`http://localhost/api/trips/${seed.trip.id}/day-plan-items`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `session=${session}; csrf_token=${csrf}`, "x-csrf-token": csrf },
      body: JSON.stringify({
        tripDayId: seed.day2.id,
        itemId: seed.museum.id,
        title: "Museum by hand",
        scheduleMode: "FLEXIBLE",
        durationMinutes: 180,
        contentJson: plannerDoc("Start with the main hall"),
        costCents: 1500,
        payments: [{ amountCents: 1500, dueDate: "2027-05-02" }],
      }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: seed.trip.id }) });
    expect(response.status).toBe(200);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } })).aiChangedAt).toBeNull();
  });
});

describe("delete_activity and undo_ai_change", () => {
  it("undoes a day delete, refuses a second undo, and lists the change as undone", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const dinner = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.dinner.id } });
    const deleted = structured<{ aiChangeId: string; day: Day }>(
      await callTool(owner.token, "delete_activity", { tripId, activityId: dinner.id, updatedAt: dinner.updatedAt.toISOString() }),
    );
    expect(titles(deleted.day)).toEqual(["National Museum", null]);

    structured(await callTool(owner.token, "undo_ai_change", { tripId, changeId: deleted.aiChangeId }));
    expect(titles(await getDay(owner.token, tripId, seed.day2.id))).toEqual(["National Museum", "Dinner", null]);
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: deleted.aiChangeId }))).toBe(
      "This AI change is already undone.",
    );
    const listed = structured<{ changes: { id: string; undoneAt: string | null; undoable: boolean }[] }>(
      await callTool(owner.token, "list_ai_changes", { tripId, dayId: seed.day2.id }),
    );
    expect(listed.changes).toEqual([
      expect.objectContaining({ id: deleted.aiChangeId, undoneAt: expect.any(String), undoable: false }),
    ]);
  });

  it("lists at most the newest 100 changes and says when there are more", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const now = Date.now();
    await prisma.aiChange.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        tripId,
        tripDayId: seed.day2.id,
        userId: owner.user.id,
        clientId: "https://claude.ai/client",
        action: "moved",
        subject: `Change ${index}`,
        createdAt: new Date(now - index * 1000),
      })),
    });
    const listed = structured<{ truncated: boolean; changes: { subject: string }[] }>(
      await callTool(owner.token, "list_ai_changes", { tripId }),
    );
    expect(listed.truncated).toBe(true);
    expect(listed.changes).toHaveLength(100);
    expect(listed.changes[0].subject).toBe("Change 0");
    await prisma.aiChange.deleteMany({ where: { subject: "Change 0" } });
    expect(structured<{ truncated: boolean }>(await callTool(owner.token, "list_ai_changes", { tripId })).truncated).toBe(false);
  });

  it("refuses an undo once a person has changed the activity since (stale)", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const created = structured(
      await callTool(owner.token, "create_activity", { tripId, dayId: seed.day3.id, title: "Opera", durationMinutes: 60 }),
    );
    const updated = await updateDayPlanItemForTripDay({
      userId: owner.user.id,
      tripId,
      tripDayId: seed.day3.id,
      itemId: created.activity!.id,
      title: "Opera by hand",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      fromTime: null,
      toTime: null,
      contentJson: plannerDoc("Opera"),
      origin: "user",
    });
    expect(updated.status).toBe("updated");
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: created.aiChangeId }))).toBe(
      "The day has changed since this change was made; it can no longer be undone.",
    );
    expect(await prisma.dayPlanItem.count({ where: { id: created.activity!.id } })).toBe(1);
  });

  it("refuses a stale delete and writes nothing", async () => {
    const { seed, owner } = await setupTrip();
    expect(
      errorText(
        await callTool(owner.token, "delete_activity", {
          tripId: seed.trip.id,
          activityId: seed.dinner.id,
          updatedAt: "2020-01-01T00:00:00.000Z",
        }),
      ),
    ).toMatch(/^This activity changed since you read it/);
    expect(await prisma.dayPlanItem.count({ where: { id: seed.dinner.id } })).toBe(1);
    expect(await prisma.aiChange.count()).toBe(0);
  });
});

describe("bucket-list writes", () => {
  it("creates, edits and deletes a parked activity with a null receipt that cannot be undone", async () => {
    const { seed, contributor } = await setupTrip();
    const tripId = seed.trip.id;
    const created = structured(
      await callTool(contributor.token, "create_activity", { tripId, title: "Sauna", durationMinutes: 45 }),
    );
    expect(created.day).toBeNull();
    expect(created.activity).toMatchObject({ title: "Sauna", description: "Sauna", durationMinutes: 45 });
    expect(created.activity?.aiChangedAt).not.toBeNull();

    const edited = structured(
      await callTool(contributor.token, "update_activity", {
        tripId,
        activityId: created.activity!.id,
        updatedAt: created.activity!.updatedAt,
        description: "Bring a *towel*",
      }),
    );
    expect(edited.activity).toMatchObject({ title: "Sauna", description: "Bring a towel" });
    expect(
      errorText(
        await callTool(contributor.token, "update_activity", {
          tripId,
          activityId: created.activity!.id,
          updatedAt: edited.activity!.updatedAt,
          startTime: "10:00",
        }),
      ),
    ).toMatch(/^A bucket-list activity is always flexible/);

    const deleted = structured<{ aiChangeId: string; day: null }>(
      await callTool(contributor.token, "delete_activity", {
        tripId,
        activityId: created.activity!.id,
        updatedAt: edited.activity!.updatedAt,
      }),
    );
    expect(deleted.day).toBeNull();
    expect(await prisma.dayPlanItem.count({ where: { id: created.activity!.id } })).toBe(0);

    const rows = await prisma.aiChange.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.action, row.tripDayId, row.receiptJson])).toEqual([
      ["created", null, null],
      ["updated", null, null],
      ["deleted", null, null],
    ]);
    expect(errorText(await callTool(contributor.token, "undo_ai_change", { tripId, changeId: rows[0].id }))).toBe(
      "This AI change cannot be undone.",
    );
  });
});

describe("moves", () => {
  it("moves to a 1-based position, and refuses a fixed activity or a move past the first place", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const moved = structured(await callTool(owner.token, "move_activity", { tripId, activityId: seed.nightWalk.id, position: 1 }));
    expect(titles(moved.day)).toEqual([null, "National Museum", "Dinner"]);
    expect(moved.activity?.aiChangedAt).not.toBeNull();
    // The rows the move only shifted keep their (absent) marker.
    expect(moved.day?.activities.find((activity) => activity.id === seed.museum.id)?.aiChangedAt).toBeNull();
    expect(errorText(await callTool(owner.token, "move_activity", { tripId, activityId: seed.dinner.id, direction: "earlier" }))).toMatch(
      /^This activity cannot move there/,
    );
    expect(errorText(await callTool(owner.token, "move_activity", { tripId, activityId: seed.nightWalk.id, direction: "earlier" }))).toMatch(
      /^This activity cannot move there/,
    );
    const both = await callTool(owner.token, "move_activity", { tripId, activityId: seed.museum.id, direction: "later", position: 2 });
    expect(errorText(both)).toContain("Give exactly one of direction or position.");
  });

  it("says the activity is already there when position is its current one", async () => {
    const { seed, owner } = await setupTrip();
    const body = await callTool(owner.token, "move_activity", { tripId: seed.trip.id, activityId: seed.museum.id, position: 1 });
    expect(errorText(body)).toBe("The activity is already at position 1.");
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("records an untitled activity's change with a null subject, never an empty string", async () => {
    const { seed, owner } = await setupTrip();
    structured(await callTool(owner.token, "park_activity", { tripId: seed.trip.id, activityId: seed.nightWalk.id }));
    expect(await prisma.aiChange.findFirst()).toMatchObject({ action: "parked", subject: null });
  });

  it("moves to another day as park then schedule, with two recorded changes", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const result = structured(
      await callTool(owner.token, "move_activity_to_day", { tripId, activityId: seed.museum.id, dayId: seed.day3.id }),
    );
    expect(titles(result.day)).toEqual(["National Museum"]);
    expect(result.activity?.aiChangedAt).not.toBeNull();
    const rows = await prisma.aiChange.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.id, row.action, row.tripDayId])).toEqual([
      [result.parkAiChangeId, "parked", seed.day2.id],
      [result.aiChangeId, "scheduled", seed.day3.id],
    ]);
    expect(titles(await getDay(owner.token, tripId, seed.day2.id))).toEqual(["Dinner", null]);
  });

  it("schedules a bucket-list activity and parks a day activity", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const scheduled = structured(
      await callTool(owner.token, "schedule_activity", { tripId, activityId: seed.zoo.id, dayId: seed.day3.id }),
    );
    expect(scheduled.activity).toMatchObject({ id: seed.zoo.id, title: "Zoo", startTime: "10:30", endTime: "11:30" });
    expect(errorText(await callTool(owner.token, "schedule_activity", { tripId, activityId: seed.zoo.id, dayId: seed.day1.id }))).toMatch(
      /already on a day/,
    );
    const parked = structured(await callTool(owner.token, "park_activity", { tripId, activityId: seed.dinner.id }));
    expect(parked.activity).toMatchObject({ id: seed.dinner.id, mode: "flexible", durationMinutes: 90 });
    expect(titles(parked.day)).toEqual(["National Museum", null]);
    expect(errorText(await callTool(owner.token, "park_activity", { tripId, activityId: seed.dinner.id }))).toBe(
      "This activity is already in the bucket list.",
    );
  });
});
