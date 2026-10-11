import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH, POST } from "@/app/api/trips/[id]/accommodations/route";
import { POST as COPY_POST } from "@/app/api/trips/[id]/accommodations/copy/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import {
  copyAccommodationFromPreviousNight,
  createAccommodationForTripDay,
  updateAccommodationForTripDay,
} from "@/lib/repositories/accommodationRepo";
import type { DayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 11.4 AC3, AC4, AC5, AC6, AC8. A later check-out pushes the *next* trip day from its first timed
 * activity; creating or copying a stay pushes nothing.
 */

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

/** Day 4 with stay S (check-out `checkOutTime`), day 5 after it (the pushed day), and nothing after. */
const seedTrip = async (email: string, checkOutTime: string | null) => {
  const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Stay Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const stayDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 4 },
  });
  const nextDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 5 },
  });
  const stay = await prisma.accommodation.create({
    data: { tripDayId: stayDay.id, name: "Glenfern Villas", checkOutTime, createdAt: PAST, updatedAt: PAST },
  });
  return { user, trip, stayDay, nextDay, stay };
};

const createItem = (tripDayId: string, title: string, fromTime: string | null, toTime: string | null) =>
  prisma.dayPlanItem.create({
    data: { tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title), createdAt: PAST, updatedAt: PAST },
  });

const createStayLeg = (tripDayId: string, stayId: string, itemId: string, durationMinutes: number) =>
  prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: "ACCOMMODATION",
      fromItemId: stayId,
      toItemType: "DAY_PLAN_ITEM",
      toItemId: itemId,
      transportType: "CAR",
      durationMinutes,
      distanceKm: 40,
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

const times = async (tripDayId: string) =>
  (await prisma.dayPlanItem.findMany({ where: { tripDayId } }))
    .sort(compareDayPlanItemsByStartTime)
    .map((row) => `${row.title} ${row.fromTime ?? "-"}–${row.toTime ?? "-"}`);

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  stays: await prisma.accommodation.findMany({ orderBy: { id: "asc" } }),
});

const patchStay = (userId: string, tripId: string, tripDayId: string, checkOutTime?: string | null) =>
  updateAccommodationForTripDay({
    userId,
    tripId,
    tripDayId,
    name: "Glenfern Villas",
    status: "planned",
    ...(checkOutTime === undefined ? {} : { checkOutTime }),
  });

describe("a later check-out pushes the next day (Story 11.4 AC3)", () => {
  beforeEach(resetDatabase);

  it("pushes the next day's first activity from the check-out alone, and the receipt names that day", async () => {
    const { user, trip, stayDay, nextDay, stay } = await seedTrip("stay-alone@example.com", "09:00");
    const f = await createItem(nextDay.id, "F", "10:30", "11:30");
    await createItem(nextDay.id, "G", "12:00", "13:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, "11:00");

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(await times(nextDay.id)).toEqual(["F 11:00–12:00", "G 12:00–13:00"]);
    const stored = await prisma.accommodation.findUniqueOrThrow({ where: { id: stay.id } });
    expect(stored.checkOutTime).toBe("11:00");
    expect(result.receipt).toEqual({
      version: 2,
      tripDayId: nextDay.id,
      edited: {
        kind: "stayCheckOutChanged",
        accommodationId: stay.id,
        updatedAt: stored.updatedAt,
        previousUpdatedAt: PAST,
        previousCheckOutTime: "09:00",
      },
      removedTravelSegments: [],
      movedItems: [
        {
          itemId: f.id,
          previousFromTime: "10:30",
          previousToTime: "11:30",
          previousUpdatedAt: PAST,
          updatedAt: (await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: f.id } })).updatedAt,
        },
      ],
    });
  });

  it("adds the drawn stay leg, and the walk continues", async () => {
    const { user, trip, stayDay, nextDay, stay } = await seedTrip("stay-leg@example.com", "09:00");
    const f = await createItem(nextDay.id, "F", "10:30", "11:30");
    await createItem(nextDay.id, "G", "12:00", "13:00");
    await createStayLeg(nextDay.id, stay.id, f.id, 60);

    const result = await patchStay(user.id, trip.id, stayDay.id, "11:00");

    expect(result.status === "updated" && result.receipt?.movedItems.length).toBe(2);
    expect(await times(nextDay.id)).toEqual(["F 12:00–13:00", "G 13:00–14:00"]);
  });

  it("ignores a stored stay leg that is not drawn (it does not reach the first activity)", async () => {
    const { user, trip, stayDay, nextDay, stay } = await seedTrip("stay-undrawn@example.com", "09:00");
    await createItem(nextDay.id, "F", "10:30", "11:30");
    const g = await createItem(nextDay.id, "G", "14:00", "15:00");
    await createStayLeg(nextDay.id, stay.id, g.id, 240);

    await patchStay(user.id, trip.id, stayDay.id, "11:00");

    expect(await times(nextDay.id)).toEqual(["F 11:00–12:00", "G 14:00–15:00"]);
  });

  it.each([
    { label: "null → 11:00", before: null, after: "11:00", from: "10:30", to: "11:00", pushed: "F 11:00–11:30" },
    { label: "08:00 → null (the default 10:00)", before: "08:00", after: null, from: "09:00", to: "09:30", pushed: "F 10:00–10:30" },
  ])("walks for $label", async ({ before, after, from, to, pushed }) => {
    const { user, trip, stayDay, nextDay } = await seedTrip(`stay-walk-${String(before)}@example.com`, before);
    await createItem(nextDay.id, "F", from, to);

    const result = await patchStay(user.id, trip.id, stayDay.id, after);

    expect(result.status === "updated" && result.receipt?.edited.kind).toBe("stayCheckOutChanged");
    expect(await times(nextDay.id)).toEqual([pushed]);
  });

  it.each([
    { label: "11:00 → null (earlier)", before: "11:00", after: null as string | null | undefined },
    { label: "null → 10:00 (unchanged)", before: null, after: "10:00" },
    { label: "11:00 → 09:00 (earlier)", before: "11:00", after: "09:00" },
    { label: "a PATCH without checkOutTime", before: "09:00", after: undefined },
  ])("walks nothing and returns no receipt for $label", async ({ before, after }) => {
    const { user, trip, stayDay, nextDay } = await seedTrip(`stay-nowalk-${String(before)}-${String(after)}@example.com`, before);
    // Already before any check-out: running the walk would move it.
    await createItem(nextDay.id, "F", "07:00", "08:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, after);

    expect(result.status).toBe("updated");
    expect(result.status === "updated" && result.receipt).toBeUndefined();
    expect(await times(nextDay.id)).toEqual(["F 07:00–08:00"]);
  });

  it("walks nothing for an unreadable stored check-out", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-odd@example.com", "morning");
    await createItem(nextDay.id, "F", "07:00", "08:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, "12:00");

    expect(result.status === "updated" && result.receipt).toBeUndefined();
    expect(await times(nextDay.id)).toEqual(["F 07:00–08:00"]);
  });

  it("pushes nothing on the last night and returns no receipt", async () => {
    const { user, trip, nextDay } = await seedTrip("stay-last@example.com", "09:00");
    await prisma.accommodation.create({ data: { tripDayId: nextDay.id, name: "Last night", checkOutTime: "09:00" } });

    const result = await patchStay(user.id, trip.id, nextDay.id, "12:00");

    expect(result.status).toBe("updated");
    expect(result.status === "updated" && result.receipt).toBeUndefined();
  });

  it.each([
    { label: "an empty next day", untimed: false },
    { label: "a next day with only untimed activities", untimed: true },
  ])("runs no walk and returns no receipt for $label", async ({ untimed }) => {
    const { user, trip, stayDay, nextDay } = await seedTrip(`stay-nothing-${untimed}@example.com`, "09:00");
    if (untimed) await createItem(nextDay.id, "Whenever", null, null);

    const result = await patchStay(user.id, trip.id, stayDay.id, "12:00");

    expect(result.status).toBe("updated");
    expect(result.status === "updated" && result.receipt).toBeUndefined();
    expect((await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: stayDay.id } })).checkOutTime).toBe("12:00");
  });

  it("pushes the nearest later day when the day indices have a gap", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-gap@example.com", "09:00");
    await prisma.tripDay.update({ where: { id: nextDay.id }, data: { dayIndex: 7 } });
    const farDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-08T00:00:00.000Z"), dayIndex: 9 },
    });
    await createItem(nextDay.id, "F", "09:30", "10:00");
    await createItem(farDay.id, "Far", "09:30", "10:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, "10:00");

    expect(result.status === "updated" && result.receipt?.tripDayId).toBe(nextDay.id);
    expect(await times(nextDay.id)).toEqual(["F 10:00–10:30"]);
    expect(await times(farDay.id)).toEqual(["Far 09:30–10:00"]);
  });

  it("refuses past midnight, naming the activity, with nothing written", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-midnight@example.com", "09:00");
    const f = await createItem(nextDay.id, "Early bird", "08:00", "09:00");
    await createItem(nextDay.id, "Late show", "22:30", "23:30");
    const before = await databaseState();

    const result = await updateAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: stayDay.id,
      name: "Renamed too",
      status: "booked",
      checkOutTime: "23:30",
    });

    expect(result).toEqual({ status: "past_midnight", item: { id: f.id, title: "Early bird" } });
    expect(await databaseState()).toEqual(before);
  });
});

describe("creating or copying a stay pushes nothing (Story 11.4 AC4)", () => {
  beforeEach(resetDatabase);

  it("leaves the next day alone on a POST, including its upsert's update arm", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-post@example.com", "09:00");
    await createItem(nextDay.id, "F", "07:00", "08:00");

    // The update arm: day 4 already has a stay.
    await createAccommodationForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: stayDay.id,
      name: "Glenfern Villas",
      status: "planned",
      checkOutTime: "12:00",
    });
    expect(await times(nextDay.id)).toEqual(["F 07:00–08:00"]);
  });

  it("leaves the following day alone on a copy", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-copy@example.com", "12:00");
    const thirdDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 6 },
    });
    await createItem(thirdDay.id, "F", "07:00", "08:00");
    void stayDay;

    const copied = await copyAccommodationFromPreviousNight({ userId: user.id, tripId: trip.id, tripDayId: nextDay.id });

    expect(copied.status).toBe("copied");
    expect(await times(thirdDay.id)).toEqual(["F 07:00–08:00"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// The route.

type Envelope = {
  data: { accommodation: { id: string }; receipt?: DayChangeReceiptWire & { signature: string } } | null;
  error: { code: string; details?: Record<string, unknown> } | null;
};

const send = async (
  handler: typeof PATCH,
  url: string,
  method: "POST" | "PATCH",
  tripId: string,
  session: string,
  body: unknown,
) => {
  const response = await handler(
    new NextRequest(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${session}; csrf_token=${CSRF}`,
        "x-csrf-token": CSRF,
      },
      body: JSON.stringify(body),
    }),
    routeContext(tripId),
  );
  return { status: response.status, body: (await response.json()) as Envelope };
};

describe("PATCH /api/trips/[id]/accommodations (Story 11.4)", () => {
  beforeEach(resetDatabase);

  it("answers with the signed receipt when the walk ran, and without one otherwise", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("route-stay-receipt@example.com", "09:00");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    await createItem(nextDay.id, "F", "10:30", "11:30");
    const url = `http://localhost/api/trips/${trip.id}/accommodations`;
    const body = { tripDayId: stayDay.id, name: "Glenfern Villas", status: "planned" };

    const later = await send(PATCH, url, "PATCH", trip.id, session, { ...body, checkOutTime: "11:00" });
    expect(later.status).toBe(200);
    expect(later.body.data?.receipt?.tripDayId).toBe(nextDay.id);
    expect(later.body.data?.receipt?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(later.body.data?.receipt?.movedItems).toHaveLength(1);

    const earlier = await send(PATCH, url, "PATCH", trip.id, session, { ...body, checkOutTime: "10:00" });
    expect(earlier.status).toBe(200);
    expect(earlier.body.data && "receipt" in earlier.body.data).toBe(false);
  });

  it("answers 409 day_plan_past_midnight with the activity in details, and writes nothing", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("route-stay-midnight@example.com", "09:00");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const f = await createItem(nextDay.id, "Early bird", "08:00", "09:00");
    await createItem(nextDay.id, "Late show", "22:30", "23:30");
    const before = await databaseState();

    const result = await send(PATCH, `http://localhost/api/trips/${trip.id}/accommodations`, "PATCH", trip.id, session, {
      tripDayId: stayDay.id,
      name: "Glenfern Villas",
      status: "planned",
      checkOutTime: "23:30",
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({
      code: "day_plan_past_midnight",
      details: { itemId: f.id, itemTitle: "Early bird" },
    });
    expect(await databaseState()).toEqual(before);
  });

  it("answers a POST and a copy without a receipt", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("route-stay-post@example.com", "09:00");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    // A timed activity on the following day, so a POST that pushed would have something to move.
    await createItem(nextDay.id, "F", "10:00", "11:00");

    const created = await send(POST, `http://localhost/api/trips/${trip.id}/accommodations`, "POST", trip.id, session, {
      tripDayId: stayDay.id,
      name: "Glenfern Villas",
      status: "planned",
      checkOutTime: "12:00",
    });
    expect(created.status).toBe(200);
    expect(created.body.data && "receipt" in created.body.data).toBe(false);
    expect(await times(nextDay.id)).toEqual(["F 10:00–11:00"]);

    const copied = await send(COPY_POST, `http://localhost/api/trips/${trip.id}/accommodations/copy`, "POST", trip.id, session, {
      tripDayId: nextDay.id,
    });
    expect(copied.status).toBe(200);
    expect(copied.body.data && "receipt" in copied.body.data).toBe(false);
  });
});
