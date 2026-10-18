import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/day-plan-items/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import {
  fromDayChangeReceiptWire,
  summarizeDayChangeReceipt,
  type DayChangeReceiptWire,
} from "@/lib/trips/dayChangeReceipt";
import en from "@/i18n/en";
import { routeContext } from "./helpers/routeContext";
import { settleSeededDay } from "./helpers/settleSeededDay";

/**
 * Story 13.3 AC3. *Einfügen nach* through the create route: a new FLEXIBLE activity goes directly after the
 * one named, the later flexible ones move later and are listed in the receipt, and undo restores the day.
 * A vanished target is 409 with nothing written; a FIXED create with the field is 400.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const PAST = new Date("2026-01-02T03:04:05.678Z");

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Insert Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-06T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 },
  });
  const otherDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
  });
  return { trip, day, otherDay };
};

let created = 0;
const createItem = async (tripId: string, tripDayId: string, title: string, fromTime: string, toTime: string) => {
  created += 1;
  return prisma.dayPlanItem.create({
    data: {
      tripId,
      tripDayId,
      title,
      fromTime,
      toTime,
      contentJson: sampleDoc(title),
      createdAt: new Date(PAST.getTime() + created * 1000),
      updatedAt: PAST,
    },
  });
};

/** A 09–10, B 10–11, C 11–12, flexible, on a day starting at 09:00. */
const seedDay = async (email: string) => {
  const user = await createUser(email);
  const { trip, day, otherDay } = await createTrip(user.id);
  const a = await createItem(trip.id, day.id, "A", "09:00", "10:00");
  const b = await createItem(trip.id, day.id, "B", "10:00", "11:00");
  const c = await createItem(trip.id, day.id, "C", "11:00", "12:00");
  await settleSeededDay(day.id, { flexible: [a.id, b.id, c.id] });
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  return { user, trip, day, otherDay, a, b, c, session };
};

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

const dayRows = (tripDayId: string) =>
  prisma.dayPlanItem.findMany({ where: { tripDayId }, orderBy: { sortOrder: "asc" } });

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
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

const send = async (tripId: string, session: string, body: unknown) => {
  const request = new NextRequest(`http://localhost/api/trips/${tripId}/day-plan-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `session=${session}; csrf_token=${CSRF}`,
      "x-csrf-token": CSRF,
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request, routeContext(tripId));
  return { status: response.status, body: (await response.json()) as ApiEnvelope<unknown> };
};

const flexibleBody = (tripDayId: string, afterItemId?: string | null) => ({
  tripDayId,
  title: "D",
  scheduleMode: "FLEXIBLE",
  durationMinutes: 30,
  contentJson: sampleDoc("D"),
  ...(afterItemId === undefined ? {} : { afterItemId }),
});

const t = (key: string) => (en as Record<string, string>)[key] ?? key;

describe("POST /api/trips/[id]/day-plan-items with afterItemId (Story 13.3 AC3)", () => {
  beforeEach(resetDatabase);

  it("puts D after A: order A, D, B, C; B and C move later and are in the receipt; undo restores the day", async () => {
    const { user, trip, day, a, b, c, session } = await seedDay("insert-after@example.com");
    const before = await databaseState();

    const response = await send(trip.id, session, flexibleBody(day.id, a.id));

    expect(response.status).toBe(200);
    const data = response.body.data as { dayPlanItem: { id: string }; receipt: DayChangeReceiptWire };
    const d = data.dayPlanItem.id;
    expect((await dayRows(day.id)).map((row) => [row.id, row.sortOrder, row.fromTime, row.toTime])).toEqual([
      [a.id, 0, "09:00", "10:00"],
      [d, 1, "10:00", "10:30"],
      [b.id, 2, "10:30", "11:30"],
      [c.id, 3, "11:30", "12:30"],
    ]);
    expect(data.receipt.edited).toMatchObject({ kind: "created", itemId: d });
    expect(data.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, c.id]);
    expect(summarizeDayChangeReceipt(data.receipt, t)).toBe("2 activities moved");

    const receipt = fromDayChangeReceiptWire(data.receipt);
    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt })).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("with afterItemId null or absent, appends as before", async () => {
    const { trip, day, a, b, c, session } = await seedDay("insert-after-append@example.com");

    const first = await send(trip.id, session, flexibleBody(day.id, null));
    expect(first.status).toBe(200);
    const second = await send(trip.id, session, flexibleBody(day.id));
    expect(second.status).toBe(200);

    const rows = await dayRows(day.id);
    expect(rows.slice(0, 3).map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    expect(rows.slice(3).map((row) => [row.fromTime, row.toTime])).toEqual([
      ["12:00", "12:30"],
      ["12:30", "13:00"],
    ]);
  });

  it("answers 409 day_plan_changed and writes nothing when the named activity is parked or on another day", async () => {
    const { trip, day, otherDay, session } = await seedDay("insert-after-stale@example.com");
    const parked = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: null, title: "Parked", scheduleMode: "FLEXIBLE", durationMinutes: 30, sortOrder: 0, contentJson: sampleDoc("P") },
    });
    const elsewhere = await createItem(trip.id, otherDay.id, "Elsewhere", "09:00", "10:00");
    const before = await databaseState();

    for (const afterItemId of [parked.id, elsewhere.id, "gone"]) {
      const response = await send(trip.id, session, flexibleBody(day.id, afterItemId));
      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe("day_plan_changed");
    }
    expect(await databaseState()).toEqual(before);
  });

  it("refuses afterItemId on a FIXED create, and on one without a mode, with 400", async () => {
    const { trip, day, a, session } = await seedDay("insert-after-fixed@example.com");
    const before = await databaseState();

    for (const scheduleMode of ["FIXED", undefined]) {
      const response = await send(trip.id, session, {
        tripDayId: day.id,
        title: "Ferry",
        ...(scheduleMode ? { scheduleMode } : {}),
        fromTime: "12:00",
        toTime: "13:00",
        contentJson: sampleDoc("Ferry"),
        afterItemId: a.id,
      });
      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe("validation_error");
    }
    expect(await databaseState()).toEqual(before);
  });
});
