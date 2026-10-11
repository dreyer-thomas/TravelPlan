import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/day-plan-items/reorder/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { reorderDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 11.3. *Nach oben* / *Nach unten* wired through the repository and the route: what is written,
 * what the receipt says, which legs go (and which survive), and that every refusal writes nothing. The
 * arithmetic is pinned on its own in `dayPlanPush.test.ts`.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Fixture rows are stamped in the past so a later write can never share their millisecond. */
const PAST = new Date("2026-01-02T03:04:05.678Z");

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

/** Two days, so a stay on the first is "last night's" for the second. */
const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Reorder Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const firstDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 1 },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 2 },
  });
  return { trip, firstDay, day };
};

let created = 0;
/** Distinct, increasing `createdAt`s, so equal starts always sort in creation order. */
const createItem = (tripDayId: string, title: string | null, fromTime: string | null, toTime: string | null) => {
  created += 1;
  const stamp = new Date(PAST.getTime() + created * 1000);
  return prisma.dayPlanItem.create({
    data: { tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title ?? ""), createdAt: stamp, updatedAt: PAST },
  });
};

const createLeg = (
  tripDayId: string,
  from: { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string },
  to: { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string },
  durationMinutes = 15,
) =>
  prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: from.type,
      fromItemId: from.id,
      toItemType: to.type,
      toItemId: to.id,
      transportType: "CAR",
      durationMinutes,
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

const item = (id: string) => ({ type: "DAY_PLAN_ITEM" as const, id });
const stay = (id: string) => ({ type: "ACCOMMODATION" as const, id });

/** Success criterion 4's day: A 09–10, B 10:30–11, C 11:30–12:30. */
const seedDay = async (email: string) => {
  const user = await createUser(email);
  const { trip, firstDay, day } = await createTrip(user.id);
  const a = await createItem(day.id, "A", "09:00", "10:00");
  const b = await createItem(day.id, "B", "10:30", "11:00");
  const c = await createItem(day.id, "C", "11:30", "12:30");
  return { user, trip, firstDay, day, a, b, c };
};

/** Every row a day-plan write could touch, in a stable order. */
const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  bucket: await prisma.tripBucketListItem.findMany({ orderBy: { id: "asc" } }),
});

const times = async (tripDayId: string) =>
  Object.fromEntries(
    (await prisma.dayPlanItem.findMany({ where: { tripDayId } })).map((row) => [row.title, `${row.fromTime}–${row.toTime}`]),
  );

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
  await prisma.tripBucketListItem.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string; details?: unknown } | null };

const CSRF = "csrf-token-value";

const send = async (tripId: string, session: string, body: unknown, csrf = CSRF) => {
  const request = new NextRequest(`http://localhost/api/trips/${tripId}/day-plan-items/reorder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `session=${session}; csrf_token=${CSRF}`,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request, routeContext(tripId));
  return { status: response.status, body: (await response.json()) as ApiEnvelope<unknown> };
};

type WireReceipt = {
  version: number;
  signature: string;
  edited: { kind: string; itemId: string; neighbourId: string };
  movedItems: { itemId: string; previousFromTime: string; previousToTime: string; previousUpdatedAt: string; updatedAt: string }[];
  removedTravelSegments: { id: string }[];
  checkInWarning?: { accommodationId: string; checkInTime: string };
};

describe("POST /api/trips/[id]/day-plan-items/reorder (Story 11.3)", () => {
  beforeEach(resetDatabase);

  it("moves B up: writes both times, answers a signed receipt naming the pair first, and the DB matches", async () => {
    const { user, trip, day, a, b } = await seedDay("reorder-up@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(response.status).toBe(200);
    expect(await times(day.id)).toEqual({ A: "09:30–10:30", B: "09:00–09:30", C: "11:30–12:30" });
    const receipt = (response.body.data as { receipt: WireReceipt }).receipt;
    expect(receipt.version).toBe(2);
    expect(receipt.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.edited).toEqual({ kind: "reordered", itemId: b.id, neighbourId: a.id });
    expect(receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id]);
    expect(receipt.movedItems[0]).toMatchObject({ previousFromTime: "10:30", previousToTime: "11:00", previousUpdatedAt: PAST.toISOString() });
    expect(receipt.removedTravelSegments).toEqual([]);

    const stored = await prisma.dayPlanItem.findMany({ where: { id: { in: [a.id, b.id] } } });
    for (const row of stored) {
      expect(row.updatedAt.toISOString()).toBe(receipt.movedItems.find((moved) => moved.itemId === row.id)!.updatedAt);
    }
  });

  it("moving A down is the same swap: same times, same pair, the user's item named as itemId", async () => {
    const { user, trip, day, a, b } = await seedDay("reorder-down@example.com");

    const result = await reorderDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id, direction: "down" });

    expect(result.status).toBe("reordered");
    if (result.status !== "reordered") return;
    expect(await times(day.id)).toEqual({ A: "09:30–10:30", B: "09:00–09:30", C: "11:30–12:30" });
    expect(result.receipt.edited).toEqual({ kind: "reordered", itemId: a.id, neighbourId: b.id });
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id]);
  });

  it("sweeps stay→A, A→B and B→C, and creates nothing (AC3)", async () => {
    const { user, trip, firstDay, day, a, b, c } = await seedDay("reorder-legs@example.com");
    const lastNight = await prisma.accommodation.create({ data: { tripDayId: firstDay.id, name: "Last night", status: "BOOKED" } });
    const fromStay = await createLeg(day.id, stay(lastNight.id), item(a.id));
    const ab = await createLeg(day.id, item(a.id), item(b.id));
    const bc = await createLeg(day.id, item(b.id), item(c.id));

    const result = await reorderDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(result.status).toBe("reordered");
    if (result.status !== "reordered") return;
    expect(result.receipt.removedTravelSegments.map((leg) => leg.id).sort()).toEqual([fromStay.id, ab.id, bc.id].sort());
    expect(await prisma.travelSegment.count()).toBe(0);
  });

  it("keeps a pre-existing undrawn B→A leg and counts it (Read this first §5)", async () => {
    const user = await createUser("reorder-reverse-leg@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:00", "11:00");
    const ba = await createLeg(day.id, item(b.id), item(a.id), 20);

    const result = await reorderDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(result.status).toBe("reordered");
    if (result.status !== "reordered") return;
    expect(await times(day.id)).toEqual({ A: "10:20–11:20", B: "09:00–10:00" });
    expect(result.receipt.removedTravelSegments).toEqual([]);
    expect(await prisma.travelSegment.findMany()).toEqual([ba]);
  });

  it("pushes what follows an overlapping pair and lists it after the pair", async () => {
    const user = await createUser("reorder-push@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "11:00");
    const b = await createItem(day.id, "B", "10:00", "10:30");
    const c = await createItem(day.id, "C", "11:00", "12:00");

    const result = await reorderDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

    if (result.status !== "reordered") throw new Error(`expected reordered, got ${result.status}`);
    expect(await times(day.id)).toEqual({ A: "09:30–11:30", B: "09:00–09:30", C: "11:30–12:30" });
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id, c.id]);
  });

  it("past midnight: 409 with the named activity in details, and the whole DB unchanged", async () => {
    const user = await createUser("reorder-midnight@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "21:00", "23:00");
    const b = await createItem(day.id, "B", "22:00", "23:30");
    await createLeg(day.id, item(a.id), item(b.id));
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: "day_plan_past_midnight", details: { itemId: a.id, itemTitle: "A" } });
    expect(await databaseState()).toEqual(before);
  });

  it("not reorderable: the first activity up, an untimed one, the last down → 409, DB unchanged", async () => {
    const { user, trip, day, a, c } = await seedDay("reorder-refused@example.com");
    const untimed = await createItem(day.id, "U", null, null);
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    for (const body of [
      { tripDayId: day.id, itemId: a.id, direction: "up" },
      { tripDayId: day.id, itemId: c.id, direction: "down" },
      { tripDayId: day.id, itemId: untimed.id, direction: "up" },
    ]) {
      const response = await send(trip.id, session, body);
      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe("day_plan_not_reorderable");
    }
    expect(await databaseState()).toEqual(before);
  });

  it("a missing item is 404; a viewer is 404; a bad CSRF token is 403; a bad direction is 400", async () => {
    const { user, trip, day, b } = await seedDay("reorder-guards@example.com");
    const viewer = await createUser("reorder-viewer@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const before = await databaseState();

    const missing = await send(trip.id, session, { tripDayId: day.id, itemId: "nope", direction: "up" });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.message).toBe("Day plan item not found");

    const asViewer = await send(trip.id, viewerSession, { tripDayId: day.id, itemId: b.id, direction: "up" });
    expect(asViewer.status).toBe(404);

    const forged = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" }, "wrong");
    expect(forged.status).toBe(403);
    expect(forged.body.error?.code).toBe("csrf_invalid");

    const sideways = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "left" });
    expect(sideways.status).toBe(400);
    expect(sideways.body.error?.code).toBe("validation_error");

    expect(await databaseState()).toEqual(before);
  });

  it("a contributor may reorder", async () => {
    const { trip, day, b } = await seedDay("reorder-owner@example.com");
    const contributor = await createUser("reorder-contributor@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    const session = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });
    expect(response.status).toBe(200);
  });

  it("carries the check-in warning when the swapped day reaches an explicit check-in too late", async () => {
    const user = await createUser("reorder-checkin@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "15:00", "17:00");
    const b = await createItem(day.id, "B", "16:00", "16:30");
    const tonight = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Hotel", status: "BOOKED", checkInTime: "17:15" },
    });
    // B→A takes 20 minutes: A becomes 16:50–18:50, after the 17:15 check-in.
    await createLeg(day.id, item(b.id), item(a.id), 20);
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(response.status).toBe(200);
    const receipt = (response.body.data as { receipt: WireReceipt }).receipt;
    expect(receipt.checkInWarning).toEqual({ accommodationId: tonight.id, checkInTime: "17:15" });
  });
});
