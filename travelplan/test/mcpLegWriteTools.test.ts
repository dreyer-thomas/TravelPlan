import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { dayPlanApplyDeps } from "@/lib/mcp/tools/dayPlanApply";
import { updateTravelSegmentForTripDay } from "@/lib/repositories/travelSegmentRepo";
import { cleanOAuthTables, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool } from "./helpers/mcpClient";
import {
  errorText,
  getDay,
  setupConnectorTrip,
  STALE_UNDO,
  storedReceipt,
  structured,
  stubNetworkSeams,
} from "./helpers/connectorWriteFixtures";

/**
 * Story 15.6. `create_leg`, `update_leg` and `delete_leg` end to end: a real token through `POST /api/mcp`, the
 * router stubbed through `dayPlanApplyDeps`. Each save recomputes the day and is one undoable change.
 */

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  stubNetworkSeams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Leg = {
  id: string;
  from: { type: string; id: string };
  to: { type: string; id: string };
  mode: string;
  durationMinutes: number;
  distanceKm: number | null;
  link: string | null;
  updatedAt: string;
  aiChangedAt: string | null;
};
type Day = {
  id: string;
  activities: { id: string; title: string | null; startTime: string | null; endTime: string | null }[];
  legs: Leg[];
};
type LegResult = { aiChangeId: string; leg: Leg | null; day: Day };

const LEG_CHANGED =
  "This leg changed since you read it; read the day again with get_day and retry with the leg's new updatedAt.";
const NOT_ADJACENT =
  "A leg connects two consecutive entries of the day: last night's stay, the activities in order, tonight's stay.";

/** Coordinates on the dinner and the night walk, so a leg between them can be routed. */
const placeDinnerAndWalk = async (seed: Awaited<ReturnType<typeof setupConnectorTrip>>["seed"]) => {
  await prisma.dayPlanItem.update({ where: { id: seed.dinner.id }, data: { locationLat: 50.08, locationLng: 14.42 } });
  await prisma.dayPlanItem.update({ where: { id: seed.nightWalk.id }, data: { locationLat: 50.09, locationLng: 14.41 } });
};

describe.each(["owner", "contributor"] as const)("leg tools as %s", (role) => {
  it("creates a routed leg, changes and deletes one, each marked, recomputed and undoable", async () => {
    const setup = await setupConnectorTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;
    await placeDinnerAndWalk(seed);
    const before = await getDay<Day>(token, tripId, seed.day2.id);
    const route = vi.spyOn(dayPlanApplyDeps, "route").mockResolvedValue({
      polyline: [],
      distanceMeters: 1234,
      durationSeconds: 905,
      legs: [{ distanceMeters: 1234, durationSeconds: 905 }],
    });

    // Create: a walking leg without a duration, routed.
    const created = structured<LegResult>(
      await callTool(token, "create_leg", {
        tripId,
        dayId: seed.day2.id,
        from: { type: "activity", id: seed.dinner.id },
        to: { type: "activity", id: seed.nightWalk.id },
        mode: "walking",
      }),
    );
    expect(route).toHaveBeenCalledWith({
      points: [
        { lat: 50.08, lng: 14.42 },
        { lat: 50.09, lng: 14.41 },
      ],
      profile: "walking",
    });
    expect(created.leg).toMatchObject({ mode: "walking", durationMinutes: 15, distanceKm: 1.2 });
    expect(created.leg?.aiChangedAt).not.toBeNull();
    expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: created.aiChangeId } })).toMatchObject({
      action: "legCreated",
      subject: "Dinner → ?",
      tripDayId: seed.day2.id,
    });

    // Update: the walk from last night's stay takes 45 minutes now; the museum starts later.
    const walk = before.legs.find((leg) => leg.id === seed.walkLeg.id)!;
    const updated = structured<LegResult>(
      await callTool(token, "update_leg", { tripId, legId: walk.id, updatedAt: walk.updatedAt, durationMinutes: 45 }),
    );
    expect(updated.leg).toMatchObject({ mode: "walking", durationMinutes: 45, distanceKm: 1.2 });
    expect(updated.leg?.aiChangedAt).not.toBeNull();
    expect(updated.day.activities[0]).toMatchObject({ title: "National Museum", startTime: "11:45", endTime: "14:45" });
    expect((await storedReceipt(updated.aiChangeId)).edited.kind).toBe("legUpdated");
    expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: updated.aiChangeId } })).toMatchObject({
      action: "legUpdated",
      subject: "Hotel Arrival → National Museum",
    });

    // Delete: the drive to dinner.
    const drive = updated.day.legs.find((leg) => leg.id === seed.driveLeg.id)!;
    const deleted = structured<{ aiChangeId: string; deletedLegId: string; day: Day }>(
      await callTool(token, "delete_leg", { tripId, legId: drive.id, updatedAt: drive.updatedAt }),
    );
    expect(deleted.deletedLegId).toBe(drive.id);
    expect(deleted.day.legs.map((leg) => leg.id)).not.toContain(drive.id);
    expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: deleted.aiChangeId } })).toMatchObject({
      action: "legDeleted",
      subject: "National Museum → Dinner",
    });
    expect(await prisma.aiChange.count()).toBe(3);

    // Undo newest first: the day reads as before.
    for (const changeId of [deleted.aiChangeId, updated.aiChangeId, created.aiChangeId]) {
      expect(structured(await callTool(token, "undo_ai_change", { tripId, changeId }))).toEqual({ undone: true, changeId });
    }
    expect(await getDay<Day>(token, tripId, seed.day2.id)).toEqual(before);
  });
});

describe("leg tools: refusals", () => {
  it("refuses a non-adjacent pair, a pair that has a leg, an unknown entry and a car leg without a distance", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const create = (fields: Record<string, unknown>) => callTool(owner.token, "create_leg", { tripId, dayId: seed.day2.id, ...fields });

    expect(
      errorText(
        await create({ from: { type: "stay", id: seed.previousStay.id }, to: { type: "activity", id: seed.dinner.id }, mode: "walking", durationMinutes: 5 }),
      ),
    ).toBe(NOT_ADJACENT);
    expect(
      errorText(
        await create({ from: { type: "stay", id: seed.previousStay.id }, to: { type: "activity", id: seed.museum.id }, mode: "bus", durationMinutes: 5 }),
      ),
    ).toBe(`These two entries already have a leg (${seed.walkLeg.id}); change it with update_leg.`);
    expect(
      errorText(
        await create({ from: { type: "activity", id: seed.zoo.id }, to: { type: "activity", id: seed.museum.id }, mode: "bus", durationMinutes: 5 }),
      ),
    ).toBe("Entry not found on this day");
    expect(
      errorText(
        await create({ from: { type: "activity", id: seed.dinner.id }, to: { type: "activity", id: seed.nightWalk.id }, mode: "car", durationMinutes: 5 }),
      ),
    ).toBe("A car leg needs distanceKm, and it could not be computed; give distanceKm.");
    expect(
      errorText(
        await create({ from: { type: "activity", id: seed.dinner.id }, to: { type: "activity", id: seed.nightWalk.id }, mode: "ship" }),
      ),
    ).toBe("Give durationMinutes: a route is only computed for car, walking and cycling legs.");
    expect(
      errorText(
        await create({ from: { type: "activity", id: seed.dinner.id }, to: { type: "activity", id: seed.nightWalk.id }, mode: "walking" }),
      ),
    ).toBe("Give durationMinutes: a route needs both entries with coordinates (a place with lat and lng).");
    expect(await prisma.travelSegment.count({ where: { tripDayId: seed.day2.id } })).toBe(2);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("refuses a stale updatedAt on update and delete, writing nothing", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const stale = "2020-01-01T00:00:00.000Z";
    expect(errorText(await callTool(owner.token, "update_leg", { tripId, legId: seed.walkLeg.id, updatedAt: stale, durationMinutes: 40 }))).toBe(
      LEG_CHANGED,
    );
    expect(errorText(await callTool(owner.token, "delete_leg", { tripId, legId: seed.walkLeg.id, updatedAt: stale }))).toBe(LEG_CHANGED);
    expect((await prisma.travelSegment.findUniqueOrThrow({ where: { id: seed.walkLeg.id } })).durationMinutes).toBe(15);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("tells a leg whose endpoint is gone from a changed one, and asks a car leg for its distance (review)", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const bus = await prisma.travelSegment.create({
      data: {
        tripDayId: seed.day2.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: seed.dinner.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: seed.nightWalk.id,
        transportType: "BUS",
        durationMinutes: 10,
        distanceKm: null,
      },
    });
    expect(
      errorText(await callTool(owner.token, "update_leg", { tripId, legId: bus.id, updatedAt: bus.updatedAt.toISOString(), mode: "car" })),
    ).toBe("A car leg needs distanceKm; give it.");

    // Last night's stay removed behind the app's back: the walk from it names nothing any more.
    const walk = await prisma.travelSegment.findUniqueOrThrow({ where: { id: seed.walkLeg.id } });
    await prisma.accommodation.delete({ where: { id: seed.previousStay.id } });
    expect(
      errorText(
        await callTool(owner.token, "update_leg", { tripId, legId: walk.id, updatedAt: walk.updatedAt.toISOString(), durationMinutes: 20 }),
      ),
    ).toBe("This leg no longer connects two entries of the day (an endpoint was removed or moved); delete it with delete_leg.");
    expect(await prisma.travelSegment.findUniqueOrThrow({ where: { id: walk.id } })).toEqual(walk);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("drops the distance on a switch to a flight, and keeps the endpoints", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const drive = await prisma.travelSegment.findUniqueOrThrow({ where: { id: seed.driveLeg.id } });
    const result = structured<LegResult>(
      await callTool(owner.token, "update_leg", {
        tripId: seed.trip.id,
        legId: drive.id,
        updatedAt: drive.updatedAt.toISOString(),
        mode: "flight",
        link: null,
      }),
    );
    expect(result.leg).toMatchObject({
      mode: "flight",
      distanceKm: null,
      link: null,
      from: { type: "activity", id: seed.museum.id },
      to: { type: "activity", id: seed.dinner.id },
    });
  });

  it("refuses the undo of a leg change once a person changed the leg again (stale), and that edit clears the badge", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const walk = await prisma.travelSegment.findUniqueOrThrow({ where: { id: seed.walkLeg.id } });
    const result = structured<LegResult>(
      await callTool(owner.token, "update_leg", { tripId, legId: walk.id, updatedAt: walk.updatedAt.toISOString(), durationMinutes: 25 }),
    );
    expect(result.leg?.aiChangedAt).not.toBeNull();
    const saved = await updateTravelSegmentForTripDay({
      userId: owner.user.id,
      tripId,
      tripDayId: seed.day2.id,
      segmentId: walk.id,
      fromItemType: "accommodation",
      fromItemId: seed.previousStay.id,
      toItemType: "dayPlanItem",
      toItemId: seed.museum.id,
      transportType: "walking",
      durationMinutes: 30,
      distanceKm: 1.2,
      origin: "user",
    });
    expect(saved.status).toBe("updated");
    expect((await prisma.travelSegment.findUniqueOrThrow({ where: { id: walk.id } })).aiChangedAt).toBeNull();
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toBe(STALE_UNDO);
    expect((await prisma.travelSegment.findUniqueOrThrow({ where: { id: walk.id } })).durationMinutes).toBe(30);
  });

  it("answers Trip not found to a viewer, writing nothing", async () => {
    const { seed, viewer } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const walk = await prisma.travelSegment.findUniqueOrThrow({ where: { id: seed.walkLeg.id } });
    const updatedAt = walk.updatedAt.toISOString();
    expect(
      errorText(
        await callTool(viewer.token, "create_leg", {
          tripId,
          dayId: seed.day2.id,
          from: { type: "activity", id: seed.dinner.id },
          to: { type: "activity", id: seed.nightWalk.id },
          mode: "walking",
          durationMinutes: 5,
        }),
      ),
    ).toBe("Trip not found");
    expect(errorText(await callTool(viewer.token, "update_leg", { tripId, legId: walk.id, updatedAt, durationMinutes: 5 }))).toBe(
      "Trip not found",
    );
    expect(errorText(await callTool(viewer.token, "delete_leg", { tripId, legId: walk.id, updatedAt }))).toBe("Trip not found");
    expect(await prisma.travelSegment.findUniqueOrThrow({ where: { id: walk.id } })).toEqual(walk);
    expect(await prisma.aiChange.count()).toBe(0);
  });
});
