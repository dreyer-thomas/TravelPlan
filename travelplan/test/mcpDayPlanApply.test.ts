import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { activityWriteDeps } from "@/lib/mcp/tools/activityWrite";
import { dayPlanApplyDeps } from "@/lib/mcp/tools/dayPlanApply";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import { createDayPlanItemForTripDay, updateDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { fromDayChangeReceiptWire, type DayChangeReceipt, type TravelSegmentRow } from "@/lib/trips/dayChangeReceipt";
import { storedDayChangeReceiptSchema } from "@/lib/validation/dayChangeReceiptSchemas";
import { cleanOAuthTables, createUser, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool, issueAccessToken, rpc, type ToolCallBody } from "./helpers/mcpClient";
import { plannerDoc, seedPlannerTrip } from "./helpers/plannerFixtures";

/**
 * Story 15.5. `apply_day_plan` end to end: a real token through `POST /api/mcp`, the geocoder stubbed through
 * `activityWriteDeps` and the router through `dayPlanApplyDeps`, so no test reaches Nominatim or OSRM.
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
  mode: string;
  startTime: string | null;
  endTime: string | null;
  place: { label: string | null; lat: number; lng: number } | null;
  link: string | null;
  cost: { eurCents: number } | null;
  payments: { amountEurCents: number; dueDate: string }[];
  aiChangedAt: string | null;
};
type Leg = {
  from: { type: string; id: string };
  to: { type: string; id: string };
  mode: string;
  durationMinutes: number;
  distanceKm: number | null;
  aiChangedAt: string | null;
};
type Day = { id: string; activities: Activity[]; legs: Leg[]; warnings: { kind: string; activityId: string }[] };
type ApplyResult = {
  aiChangeId: string;
  mode: string;
  activityIds: string[];
  deletedActivityCount: number;
  legsCreated: number;
  skippedLegs: { toActivity: number; reason: string }[];
  day: Day;
};

const structured = <T = ApplyResult>(body: ToolCallBody): T => {
  expect(body.result?.isError, JSON.stringify(body)).toBeFalsy();
  return body.result!.structuredContent as T;
};

const errorText = (body: ToolCallBody) => {
  expect(body.result?.isError, JSON.stringify(body)).toBe(true);
  return body.result?.content?.[0]?.text ?? "";
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

/** No test reaches OSRM: a route that is not stubbed otherwise fails, as an outage would. */
const stubRoute = () => vi.spyOn(dayPlanApplyDeps, "route").mockRejectedValue(new Error("no network in tests"));

const getDay = async (token: string, tripId: string, dayId: string) =>
  structured<Day>(await callTool(token, "get_day", { tripId, dayId }));

const titles = (day: Day) => day.activities.map((activity) => activity.title);
const times = (day: Day) => day.activities.map((activity) => `${activity.title} ${activity.startTime}-${activity.endTime}`);

const NOT_DRAWN =
  "The two entries are not next to each other in the final plan (a fixed activity is placed by its start time), so the leg was not created.";

const storedReceipt = async (changeId: string): Promise<DayChangeReceipt> => {
  const row = await prisma.aiChange.findUniqueOrThrow({ where: { id: changeId } });
  return fromDayChangeReceiptWire(storedDayChangeReceiptSchema.parse(JSON.parse(row.receiptJson!)));
};

describe.each(["owner", "contributor"] as const)("apply_day_plan as %s", (role) => {
  it("appends flexible activities and a fixed one placed by its time, with the legs, marked, as one change", async () => {
    const setup = await setupTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;
    const route = stubRoute();

    const result = structured(
      await callTool(token, "apply_day_plan", {
        tripId,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "Castle", durationMinutes: 60, costEur: 12.5 },
          { title: "Lunch", durationMinutes: 60, link: "https://lunch.example" },
          { title: "Bridge", durationMinutes: 60 },
          { title: "Opera", mode: "fixed", startTime: "18:00", durationMinutes: 60 },
        ],
        legs: [
          { toActivity: 2, mode: "walking", durationMinutes: 10, distanceKm: 0.8 },
          { toActivity: 3, mode: "car", durationMinutes: 15, distanceKm: 6.5 },
        ],
      }),
    );
    expect(route).not.toHaveBeenCalled();

    // Day 3 starts at last night's check-out, 10:30; the fixed one lands after the flexible ones by its time.
    expect(times(result.day)).toEqual([
      "Castle 10:30-11:30",
      "Lunch 11:40-12:40",
      "Bridge 12:55-13:55",
      "Opera 18:00-19:00",
    ]);
    expect(result).toMatchObject({ mode: "append", deletedActivityCount: 0, legsCreated: 2, skippedLegs: [] });
    expect(result.activityIds).toEqual(result.day.activities.map((activity) => activity.id));
    expect(result.day.activities.every((activity) => activity.aiChangedAt !== null)).toBe(true);
    expect(result.day.activities[0]).toMatchObject({
      cost: { eurCents: 1250 },
      payments: [{ amountEurCents: 1250, dueDate: "2027-05-03" }],
    });
    expect(result.day.activities[1].link).toBe("https://lunch.example");
    expect(result.day.activities[3].mode).toBe("fixed");
    expect(result.day.legs).toHaveLength(2);
    expect(result.day.legs.map((leg) => [leg.mode, leg.durationMinutes, leg.distanceKm])).toEqual([
      ["walking", 10, 0.8],
      ["car", 15, 6.5],
    ]);
    expect(result.day.legs.every((leg) => leg.aiChangedAt !== null)).toBe(true);

    const changes = await prisma.aiChange.findMany();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      id: result.aiChangeId,
      action: "planAppended",
      subject: "Castle, Lunch, Bridge, Opera",
      tripDayId: seed.day3.id,
    });
    const listed = structured<{ changes: { summary: string; undoable: boolean }[] }>(
      await callTool(token, "list_ai_changes", { tripId }),
    );
    expect(listed.changes[0]).toMatchObject({ summary: 'Added a day plan: "Castle, Lunch, Bridge, Opera"', undoable: true });
  });
});

describe("apply_day_plan: replace and undo", () => {
  it("replaces a day's activities and legs, and the undo restores get_day exactly", async () => {
    const { seed, contributor } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    // A third leg on day 2: dinner → night walk.
    await prisma.travelSegment.create({
      data: {
        tripDayId: seed.day2.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: seed.dinner.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: seed.nightWalk.id,
        transportType: "WALKING",
        durationMinutes: 20,
        distanceKm: null,
      },
    });
    const before = await getDay(contributor.token, tripId, seed.day2.id);
    expect(before.legs).toHaveLength(3);
    const dinnerMediaBefore = await prisma.dayPlanItem.findUniqueOrThrow({
      where: { id: seed.dinner.id },
      include: { images: true, documents: true, payments: true },
    });

    const result = structured(
      await callTool(contributor.token, "apply_day_plan", {
        tripId,
        dayId: seed.day2.id,
        mode: "replace",
        activities: [
          { title: "Old Town walk", durationMinutes: 90, place: { name: "Old Town", lat: 50.087, lng: 14.421 } },
          { title: "Concert", mode: "fixed", startTime: "15:00", endTime: "16:30", costEur: 40 },
        ],
        legs: [
          { toActivity: 1, mode: "walking", durationMinutes: 12 },
          { toActivity: 2, mode: "train", durationMinutes: 20 },
        ],
      }),
    );
    expect(result).toMatchObject({ mode: "replace", deletedActivityCount: 3, legsCreated: 2, skippedLegs: [] });
    expect(titles(result.day)).toEqual(["Old Town walk", "Concert"]);
    expect(result.day.legs.map((leg) => leg.from.type)).toEqual(["stay", "activity"]);
    expect(await prisma.dayPlanItem.count({ where: { id: { in: [seed.museum.id, seed.dinner.id, seed.nightWalk.id] } } })).toBe(0);
    expect(await prisma.aiChange.findFirst()).toMatchObject({ action: "planReplaced", subject: "Old Town walk, Concert" });

    expect(structured(await callTool(contributor.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toEqual({
      undone: true,
      changeId: result.aiChangeId,
    });
    expect(await getDay(contributor.token, tripId, seed.day2.id)).toEqual(before);
    expect(
      await prisma.dayPlanItem.findUniqueOrThrow({
        where: { id: seed.dinner.id },
        include: { images: true, documents: true, payments: true },
      }),
    ).toEqual(dinnerMediaBefore);
    expect(await prisma.dayPlanItem.count({ where: { id: { in: result.activityIds } } })).toBe(0);
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId } })).undoneAt).not.toBeNull();
  });

  it("refuses the undo once a person has changed a planned activity since (stale)", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId,
        dayId: seed.day2.id,
        mode: "replace",
        activities: [{ title: "Opera", durationMinutes: 60 }],
      }),
    );
    const updated = await updateDayPlanItemForTripDay({
      userId: owner.user.id,
      tripId,
      tripDayId: seed.day2.id,
      itemId: result.activityIds[0],
      title: "Opera by hand",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      fromTime: null,
      toTime: null,
      contentJson: plannerDoc("Opera"),
      origin: "user",
    });
    expect(updated.status).toBe("updated");
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toBe(
      "The day has changed since this change was made; it can no longer be undone.",
    );
    expect(await prisma.dayPlanItem.count({ where: { id: seed.museum.id } })).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { id: result.activityIds[0] } })).toBe(1);
  });

  it("refuses a stored receipt whose rows do not add up (invalid), writing nothing", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId,
        dayId: seed.day2.id,
        mode: "replace",
        activities: [{ title: "A", durationMinutes: 60 }, { title: "B", durationMinutes: 60 }],
        legs: [{ toActivity: 2, mode: "walking", durationMinutes: 5 }],
      }),
    );
    const receipt = await storedReceipt(result.aiChangeId);
    if (receipt.edited.kind !== "dayPlanApplied") throw new Error("fixture");
    const edited = receipt.edited;
    const [first] = edited.items;
    const deleted = edited.deletedItems[0];
    const createdLeg = edited.segments[0];

    const undo = (next: DayChangeReceipt) => undoDayPlanChangeForTrip({ userId: owner.user.id, tripId, receipt: next });
    const withEdited = (changes: Partial<typeof edited>): DayChangeReceipt => ({ ...receipt, edited: { ...edited, ...changes } });
    const moved = (itemId: string) => ({
      itemId,
      previousFromTime: null,
      previousToTime: null,
      previousSortOrder: 0,
      fromTime: null,
      toTime: null,
      previousUpdatedAt: new Date(),
      updatedAt: new Date(),
    });
    const removedLeg = receipt.removedTravelSegments[0] as TravelSegmentRow;

    expect(await undo(withEdited({ items: [first, first] }))).toEqual({ status: "invalid", reason: "duplicate item" });
    expect(await undo(withEdited({ deletedItems: [deleted, deleted] }))).toEqual({
      status: "invalid",
      reason: "duplicate deleted item",
    });
    expect(await undo(withEdited({ items: [...edited.items, { itemId: deleted.id, updatedAt: new Date() }] }))).toEqual({
      status: "invalid",
      reason: "applied item listed as deleted",
    });
    expect(await undo({ ...receipt, movedItems: [moved(first.itemId)] })).toEqual({
      status: "invalid",
      reason: "applied item listed as moved",
    });
    expect(await undo({ ...receipt, movedItems: [moved(deleted.id)] })).toEqual({
      status: "invalid",
      reason: "deleted item listed as moved",
    });
    expect(await undo({ ...receipt, removedTravelSegments: [...receipt.removedTravelSegments, { ...removedLeg, id: createdLeg.segmentId }] })).toEqual({
      status: "invalid",
      reason: "leg both created and removed",
    });
    expect(await undo(withEdited({ deletedItems: [{ ...deleted, tripDayId: seed.day3.id }] }))).toEqual({
      status: "invalid",
      reason: "item on another day",
    });
    const dinner = edited.deletedItems.find((item) => item.id === seed.dinner.id)!;
    expect(
      await undo(withEdited({ deletedItems: [{ ...dinner, images: dinner.images.map((image) => ({ ...image, dayPlanItemId: "other" })) }] })),
    ).toEqual({ status: "invalid", reason: "image of another item" });

    expect(await prisma.aiChange.count({ where: { undoneAt: { not: null } } })).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { id: { in: result.activityIds } } })).toBe(2);
  });
});

describe("apply_day_plan: legs", () => {
  it("computes a walking leg without a duration from the route, rounded as the leg dialog does", async () => {
    const { seed, owner } = await setupTrip();
    const route = vi.spyOn(dayPlanApplyDeps, "route").mockResolvedValue({
      polyline: [],
      distanceMeters: 1234,
      durationSeconds: 905,
      legs: [{ distanceMeters: 1234, durationSeconds: 905 }],
    });
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "Castle", place: { lat: 50.09, lng: 14.4 } },
          { title: "Bridge", place: { lat: 50.086, lng: 14.411 } },
        ],
        legs: [{ toActivity: 2, mode: "walking" }],
      }),
    );
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith({
      points: [
        { lat: 50.09, lng: 14.4 },
        { lat: 50.086, lng: 14.411 },
      ],
      profile: "walking",
    });
    expect(result.legsCreated).toBe(1);
    expect(result.day.legs).toEqual([
      expect.objectContaining({ mode: "walking", durationMinutes: 15, distanceKm: 1.2 }),
    ]);
  });

  it("skips a car leg the router cannot compute, and writes the activities anyway", async () => {
    const { seed, owner } = await setupTrip();
    const route = stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "Castle", place: { lat: 50.09, lng: 14.4 } },
          { title: "Lake", place: { lat: 49.9, lng: 14.2 } },
          { title: "Ferry", durationMinutes: 30 },
        ],
        legs: [
          { toActivity: 2, mode: "car" },
          { toActivity: 3, mode: "ship" },
        ],
      }),
    );
    expect(route).toHaveBeenCalledTimes(1);
    expect(titles(result.day)).toEqual(["Castle", "Lake", "Ferry"]);
    expect(result.legsCreated).toBe(0);
    expect(result.day.legs).toEqual([]);
    expect(result.skippedLegs).toEqual([
      { toActivity: 2, reason: "No durationMinutes was given, and the route could not be computed." },
      {
        toActivity: 3,
        reason: "No durationMinutes was given, and a route is only computed for car, walking and cycling legs.",
      },
    ]);
  });

  it("does not create a leg the final order does not draw (a fixed activity placed between)", async () => {
    const { seed, owner } = await setupTrip();
    stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "Castle", durationMinutes: 60 },
          { title: "Lunch", durationMinutes: 60 },
          { title: "Bridge", durationMinutes: 60 },
          { title: "Tour", mode: "fixed", startTime: "12:00", endTime: "12:30" },
        ],
        legs: [
          { toActivity: 2, mode: "walking", durationMinutes: 10 },
          { toActivity: 3, mode: "walking", durationMinutes: 15 },
        ],
      }),
    );
    expect(titles(result.day)).toEqual(["Castle", "Lunch", "Tour", "Bridge"]);
    expect(result.legsCreated).toBe(1);
    expect(result.skippedLegs).toEqual([{ toActivity: 3, reason: NOT_DRAWN }]);
  });
});

describe("apply_day_plan: rules", () => {
  it("saves an over-full day and returns its warnings", async () => {
    const { seed, owner } = await setupTrip();
    stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "Long one", durationMinutes: 600 },
          { title: "Longer", durationMinutes: 600 },
          { title: "Longest", durationMinutes: 600 },
          { title: "Lunch", mode: "fixed", startTime: "12:00", endTime: "13:00" },
        ],
      }),
    );
    // The fixed lunch overlaps the first long one and is reached late; the other two do not fit before 23:59.
    expect(times(result.day)).toEqual([
      "Long one 10:30-20:30",
      "Lunch 12:00-13:00",
      "Longer null-null",
      "Longest null-null",
    ]);
    expect(result.day.warnings.map((warning) => warning.kind).sort()).toEqual(["late", "overflow", "overflow"]);
  });

  it("caps the stored subject at 120 characters", async () => {
    const { seed, owner } = await setupTrip();
    stubRoute();
    const long = "x".repeat(100);
    structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities: [{ title: long }, { title: long }],
      }),
    );
    const { subject } = await prisma.aiChange.findFirstOrThrow();
    expect(subject).toHaveLength(120);
    expect(subject!.endsWith("…")).toBe(true);
  });

  it("refuses invalid entries before geocoding, naming the entry, and writes nothing", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    const geocode = vi.spyOn(activityWriteDeps, "geocode").mockResolvedValue({ lat: 50, lng: 14 });
    const route = stubRoute();
    const apply = (args: Record<string, unknown>) =>
      callTool(owner.token, "apply_day_plan", { tripId, dayId: seed.day2.id, mode: "replace", ...args });
    const named = { title: "Louvre", place: { name: "Louvre" } };

    // The shape itself (count, enums) is the SDK's input validation, which names the field by its 0-based path.
    expect(errorText(await apply({ activities: Array.from({ length: 51 }, (_v, index) => ({ title: `A${index}` })) }))).toMatch(
      /activities: Too big/,
    );
    expect(
      errorText(await apply({ activities: [named, { title: "Dinner", mode: "fixed", startTime: "19:00" }] })),
    ).toBe('Activity 2 ("Dinner"): To time is required.');
    expect(errorText(await apply({ activities: [named, { title: "Boat", mode: "boat" }] }))).toMatch(/activities\.1\.mode/);
    expect(
      errorText(await apply({ activities: [named], legs: [{ toActivity: 1, mode: "flight", durationMinutes: 60, distanceKm: 500 }] })),
    ).toBe("Leg into activity 1: distanceKm is not allowed for ship and flight legs.");
    expect(errorText(await apply({ activities: [named], legs: [{ toActivity: 2, mode: "car", durationMinutes: 5 }] }))).toBe(
      "Leg into activity 2: toActivity must be between 1 and 1.",
    );
    expect(
      errorText(
        await apply({
          activities: [named, { title: "B" }],
          legs: [
            { toActivity: 2, mode: "walking", durationMinutes: 5 },
            { toActivity: 2, mode: "walking", durationMinutes: 6 },
          ],
        }),
      ),
    ).toBe("Leg into activity 2: there is already a leg into this activity.");
    expect(errorText(await apply({ activities: [named, { title: "Late", startTime: "10:00" }] }))).toMatch(
      /^Activity 2 \("Late"\): startTime and endTime are for fixed activities only/,
    );

    expect(geocode).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: seed.day2.id } })).toBe(3);
  });

  it("names the entry whose place is not found, and writes nothing", async () => {
    const { seed, owner } = await setupTrip();
    vi.spyOn(activityWriteDeps, "geocode").mockResolvedValueOnce({ lat: 50, lng: 14 }).mockResolvedValueOnce(null);
    expect(
      errorText(
        await callTool(owner.token, "apply_day_plan", {
          tripId: seed.trip.id,
          dayId: seed.day3.id,
          mode: "append",
          activities: [
            { title: "Castle", place: { name: "Castle" } },
            { title: "Nowhere", place: { name: "Nowhere" } },
          ],
        }),
      ),
    ).toMatch(/^Activity 2 \("Nowhere"\): No place was found/);
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("answers Trip not found to a viewer and Day not found for a day of another trip", async () => {
    const { seed, owner, viewer } = await setupTrip();
    const other = await seedPlannerTrip(owner.user.id, "Other");
    const args = { tripId: seed.trip.id, dayId: seed.day3.id, mode: "append", activities: [{ title: "Nope" }] };
    expect(errorText(await callTool(viewer.token, "apply_day_plan", args))).toBe("Trip not found");
    expect(errorText(await callTool(owner.token, "apply_day_plan", { ...args, dayId: other.day3.id }))).toBe("Day not found");
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
  });

  it("advertises destructive write annotations", async () => {
    const { owner } = await setupTrip();
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${owner.token}` }));
    const body = (await response.json()) as { result: { tools: { name: string; annotations: Record<string, boolean> }[] } };
    const tool = body.result.tools.find((entry) => entry.name === "apply_day_plan");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("apply_day_plan: review hardening", () => {
  it("looks each place name up once, and refuses more than 10 distinct names before any lookup", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    const geocode = vi.spyOn(activityWriteDeps, "geocode").mockResolvedValue({ lat: 50, lng: 14 });

    const tooMany = Array.from({ length: 11 }, (_v, index) => ({ title: `Stop ${index}`, place: { name: `Place ${index}` } }));
    expect(
      errorText(await callTool(owner.token, "apply_day_plan", { tripId, dayId: seed.day3.id, mode: "append", activities: tooMany })),
    ).toBe("At most 10 places can be looked up by name in one call (11 given); give place.lat and place.lng for the others.");
    expect(geocode).not.toHaveBeenCalled();
    expect(await prisma.aiChange.count()).toBe(0);

    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "Castle", place: { name: "Prague Castle" } },
          { title: "Castle garden", place: { name: " prague castle " } },
        ],
      }),
    );
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(result.day.activities.map((activity) => activity.place?.label)).toEqual(["Prague Castle", "prague castle"]);
  });

  it("refuses a cost past the column's range through the input check, writing nothing", async () => {
    const { seed, owner } = await setupTrip();
    stubRoute();
    expect(
      errorText(
        await callTool(owner.token, "apply_day_plan", {
          tripId: seed.trip.id,
          dayId: seed.day3.id,
          mode: "append",
          activities: [{ title: "Yacht", costEur: 30_000_000 }],
        }),
      ),
    ).toMatch(/costEur/);
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
  });

  it("does not route a walking leg that has its duration, leaving its distance empty", async () => {
    const { seed, owner } = await setupTrip();
    const route = stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities: [
          { title: "A", place: { lat: 50.08, lng: 14.42 } },
          { title: "B", place: { lat: 50.09, lng: 14.43 } },
        ],
        legs: [{ toActivity: 2, mode: "walking", durationMinutes: 10 }],
      }),
    );
    expect(route).not.toHaveBeenCalled();
    expect(result.legsCreated).toBe(1);
    expect(await prisma.travelSegment.findFirstOrThrow({ where: { tripDayId: seed.day3.id } })).toMatchObject({
      durationMinutes: 10,
      distanceKm: null,
    });
  });

  it("writes nothing when a replace's receipt could not be stored for undo", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    // A legacy document row the stored receipt schema refuses (not an upload path).
    await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: seed.museum.id, documentUrl: "https://files.example/ticket.pdf", fileName: "ticket.pdf", sortOrder: 1 },
    });
    const before = await getDay(owner.token, tripId, seed.day2.id);
    expect(
      errorText(
        await callTool(owner.token, "apply_day_plan", {
          tripId,
          dayId: seed.day2.id,
          mode: "replace",
          activities: [{ title: "Opera", durationMinutes: 60 }],
        }),
      ),
    ).toBe(
      "This day holds data the undo cannot keep, so nothing was written. Use mode append, or change the day's activities one by one.",
    );
    expect(await getDay(owner.token, tripId, seed.day2.id)).toEqual(before);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("writes nothing when a replace's receipt would be refused by the undo (an image stored as an external address)", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    // Passes the stored schema (a safe external address) but lies outside the trip's upload tree.
    await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.museum.id, imageUrl: "https://images.example/museum.jpg", sortOrder: 1 },
    });
    const before = await getDay(owner.token, tripId, seed.day2.id);
    expect(
      errorText(
        await callTool(owner.token, "apply_day_plan", {
          tripId,
          dayId: seed.day2.id,
          mode: "replace",
          activities: [{ title: "Opera", durationMinutes: 60 }],
        }),
      ),
    ).toBe(
      "This day holds data the undo cannot keep, so nothing was written. Use mode append, or change the day's activities one by one.",
    );
    expect(await getDay(owner.token, tripId, seed.day2.id)).toEqual(before);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("routes at most 10 legs per call, skipping the rest with the reason and writing the activities", async () => {
    const { seed, owner } = await setupTrip();
    const route = vi.spyOn(dayPlanApplyDeps, "route").mockResolvedValue({
      polyline: [],
      distanceMeters: 600,
      durationSeconds: 480,
      legs: [{ distanceMeters: 600, durationSeconds: 480 }],
    });
    const activities = Array.from({ length: 13 }, (_, index) => ({
      title: `Stop ${index + 1}`,
      durationMinutes: 15,
      place: { lat: 50.08 + index * 0.001, lng: 14.4 },
    }));
    const legs = Array.from({ length: 12 }, (_, index) => ({ toActivity: index + 2, mode: "walking" }));
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId: seed.trip.id,
        dayId: seed.day3.id,
        mode: "append",
        activities,
        legs,
      }),
    );
    expect(route).toHaveBeenCalledTimes(10);
    expect(result.activityIds).toHaveLength(13);
    expect(result.legsCreated).toBe(10);
    expect(result.skippedLegs).toEqual([12, 13].map((toActivity) => ({
      toActivity,
      reason: "No durationMinutes was given, and only 10 legs are routed per call; give durationMinutes for the others.",
    })));
  });

  it("refuses the undo of a replace once a person has added an activity to the day since", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId,
        dayId: seed.day2.id,
        mode: "replace",
        activities: [{ title: "Opera", durationMinutes: 60 }],
      }),
    );
    await createDayPlanItemForTripDay({
      userId: owner.user.id,
      tripId,
      tripDayId: seed.day2.id,
      title: "Added by hand",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 30,
      fromTime: null,
      toTime: null,
      contentJson: plannerDoc("Added by hand"),
      origin: "user",
    });
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toBe(
      "The day has changed since this change was made; it can no longer be undone.",
    );
    expect(await prisma.dayPlanItem.count({ where: { id: seed.museum.id } })).toBe(0);
  });

  it("undoes an append whose fixed activity was placed before the existing ones, restoring their times and order", async () => {
    const { seed, owner } = await setupTrip();
    const tripId = seed.trip.id;
    stubRoute();
    const before = await getDay(owner.token, tripId, seed.day2.id);
    const result = structured(
      await callTool(owner.token, "apply_day_plan", {
        tripId,
        dayId: seed.day2.id,
        mode: "append",
        activities: [{ title: "Breakfast", mode: "fixed", startTime: "08:00", endTime: "09:00" }],
      }),
    );
    expect(titles(result.day)[0]).toBe("Breakfast");
    const receipt = await storedReceipt(result.aiChangeId);
    expect(receipt.movedItems.length).toBeGreaterThan(0);

    // An append that claims deleted activities is not something the tool ever stored.
    if (receipt.edited.kind !== "dayPlanApplied") throw new Error("fixture");
    const forged: DayChangeReceipt = {
      ...receipt,
      edited: { ...receipt.edited, deletedItems: [{ ...(await storedDeletedSnapshot(seed.day2.id)) }] },
    };
    expect(await undoDayPlanChangeForTrip({ userId: owner.user.id, tripId, receipt: forged })).toEqual({
      status: "invalid",
      reason: "append that deleted activities",
    });

    expect(structured(await callTool(owner.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toMatchObject({
      undone: true,
    });
    expect(await getDay(owner.token, tripId, seed.day2.id)).toEqual(before);
  });
});

/** A `deleted` snapshot of one of the day's activities, in the receipt's shape. */
const storedDeletedSnapshot = async (dayId: string) => {
  const item = await prisma.dayPlanItem.findFirstOrThrow({
    where: { tripDayId: dayId },
    include: { payments: true, images: true, documents: true },
  });
  const { tripId: _tripId, ...rest } = item;
  void _tripId;
  return { ...rest, tripDayId: dayId };
};
