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
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import { routeContext } from "./helpers/routeContext";
import { settleSeededDay } from "./helpers/settleSeededDay";
import { tripIdOfDay } from "./helpers/tripIdOfDay";

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

const createRawItem = async (tripDayId: string, title: string, fromTime: string | null, toTime: string | null) =>
  prisma.dayPlanItem.create({
    data: { tripId: await tripIdOfDay(tripDayId), tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title), createdAt: PAST, updatedAt: PAST },
  });

/** Story 13.1: each seeded day is numbered the way the migration numbers real data. */
const createItem = async (...args: Parameters<typeof createRawItem>) => {
  const row = await createRawItem(...args);
  await settleSeededDay(row.tripDayId!);
  return prisma.dayPlanItem.findUniqueOrThrow({ where: { id: row.id } });
};

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
    .sort(compareDayPlanItemsByOrder)
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

/** Story 13.1: the next day's activities are flexible, so the check-out is what places them. */
const flexibleDay = (tripDayId: string, ...items: { id: string }[]) =>
  settleSeededDay(tripDayId, { flexible: items.map((row) => row.id) });

describe("a changed check-out recomputes the next day (Story 11.4 AC3, 13.1 AC3)", () => {
  beforeEach(resetDatabase);

  it("pushes the next day's first activity from the check-out alone, and the receipt names that day", async () => {
    const { user, trip, stayDay, nextDay, stay } = await seedTrip("stay-alone@example.com", "09:00");
    const f = await createItem(nextDay.id, "F", "10:30", "11:30");
    const g = await createItem(nextDay.id, "G", "12:00", "13:00");
    // 13.1: F 09:00–10:00 and G 10:00–11:00 from the 09:00 check-out.
    await flexibleDay(nextDay.id, f, g);

    const result = await patchStay(user.id, trip.id, stayDay.id, "11:00");

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(await times(nextDay.id)).toEqual(["F 11:00–12:00", "G 12:00–13:00"]);
    const stored = await prisma.accommodation.findUniqueOrThrow({ where: { id: stay.id } });
    expect(stored.checkOutTime).toBe("11:00");
    const movedAt = (await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: f.id } })).updatedAt;
    expect(result.receipt).toEqual({
      version: 3,
      tripDayId: nextDay.id,
      edited: {
        kind: "stayCheckOutChanged",
        accommodationId: stay.id,
        updatedAt: stored.updatedAt,
        previousUpdatedAt: PAST,
        previousCheckOutTime: "09:00",
      },
      removedTravelSegments: [],
      // 13.1: G sits tight behind F, so it moves with it.
      movedItems: [
        {
          itemId: f.id,
          previousFromTime: "09:00",
          previousToTime: "10:00",
          previousSortOrder: 0,
          fromTime: "11:00",
          toTime: "12:00",
          previousUpdatedAt: PAST,
          updatedAt: movedAt,
        },
        {
          itemId: g.id,
          previousFromTime: "10:00",
          previousToTime: "11:00",
          previousSortOrder: 1,
          fromTime: "12:00",
          toTime: "13:00",
          previousUpdatedAt: PAST,
          updatedAt: movedAt,
        },
      ],
    });
  });

  it("adds the drawn stay leg, and the walk continues", async () => {
    const { user, trip, stayDay, nextDay, stay } = await seedTrip("stay-leg@example.com", "09:00");
    const f = await createItem(nextDay.id, "F", "10:30", "11:30");
    const g = await createItem(nextDay.id, "G", "12:00", "13:00");
    await createStayLeg(nextDay.id, stay.id, f.id, 60);
    await flexibleDay(nextDay.id, f, g);

    const result = await patchStay(user.id, trip.id, stayDay.id, "11:00");

    expect(result.status === "updated" && result.receipt?.movedItems.length).toBe(2);
    expect(await times(nextDay.id)).toEqual(["F 12:00–13:00", "G 13:00–14:00"]);
  });

  it("ignores a stored stay leg that is not drawn (it does not reach the first activity)", async () => {
    const { user, trip, stayDay, nextDay, stay } = await seedTrip("stay-undrawn@example.com", "09:00");
    const f = await createItem(nextDay.id, "F", "10:30", "11:30");
    const g = await createItem(nextDay.id, "G", "14:00", "15:00");
    await createStayLeg(nextDay.id, stay.id, g.id, 240);
    // 13.1: F flexible, G a fixed booking.
    await flexibleDay(nextDay.id, f);

    await patchStay(user.id, trip.id, stayDay.id, "11:00");

    expect(await times(nextDay.id)).toEqual(["F 11:00–12:00", "G 14:00–15:00"]);
  });

  it.each([
    { label: "null → 11:00", before: null, after: "11:00", from: "10:30", to: "11:00", pushed: "F 11:00–11:30" },
    { label: "08:00 → null (the default 10:00)", before: "08:00", after: null, from: "09:00", to: "09:30", pushed: "F 10:00–10:30" },
  ])("walks for $label", async ({ before, after, from, to, pushed }) => {
    const { user, trip, stayDay, nextDay } = await seedTrip(`stay-walk-${String(before)}@example.com`, before);
    await flexibleDay(nextDay.id, await createItem(nextDay.id, "F", from, to));

    const result = await patchStay(user.id, trip.id, stayDay.id, after);

    expect(result.status === "updated" && result.receipt?.edited.kind).toBe("stayCheckOutChanged");
    expect(await times(nextDay.id)).toEqual([pushed]);
  });

  it.each([
    { label: "11:00 → null (the default 10:00)", before: "11:00", after: null as string | null, pulled: "F 10:00–11:00" },
    { label: "11:00 → 09:00", before: "11:00", after: "09:00", pulled: "F 09:00–10:00" },
  ])("an earlier check-out pulls the day forward: $label (13.1 AC4)", async ({ before, after, pulled }) => {
    const { user, trip, stayDay, nextDay } = await seedTrip(`stay-earlier-${String(after)}@example.com`, before);
    const f = await createItem(nextDay.id, "F", "11:00", "12:00");
    await flexibleDay(nextDay.id, f);

    const result = await patchStay(user.id, trip.id, stayDay.id, after);

    // 13.1 AC4: Story 11.4 moved the day only for a later check-out.
    expect(result.status === "updated" && result.receipt?.movedItems.map((row) => row.itemId)).toEqual([f.id]);
    expect(await times(nextDay.id)).toEqual([pulled]);
  });

  it.each([
    { label: "null → 10:00 (unchanged)", before: null, after: "10:00" as string | undefined },
    { label: "a PATCH without checkOutTime", before: "09:00", after: undefined },
  ])("recomputes nothing and returns no receipt for $label", async ({ before, after }) => {
    const { user, trip, stayDay, nextDay } = await seedTrip(`stay-nowalk-${String(before)}-${String(after)}@example.com`, before);
    // Already before any check-out: running the walk would move it.
    await createItem(nextDay.id, "F", "07:00", "08:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, after);

    expect(result.status).toBe("updated");
    expect(result.status === "updated" && result.receipt).toBeUndefined();
    expect(await times(nextDay.id)).toEqual(["F 07:00–08:00"]);
  });

  it("reads an unreadable stored check-out as the 10:00 default (13.1 rule 1)", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-odd@example.com", "morning");
    const f = await createItem(nextDay.id, "F", "07:00", "08:00");
    await flexibleDay(nextDay.id, f);
    expect(await times(nextDay.id)).toEqual(["F 10:00–11:00"]);

    const result = await patchStay(user.id, trip.id, stayDay.id, "12:00");

    // 13.1: Story 11.4 walked nothing from it; the schedule starts the day at the default instead.
    expect(result.status === "updated" && result.receipt?.movedItems.map((row) => row.itemId)).toEqual([f.id]);
    expect(await times(nextDay.id)).toEqual(["F 12:00–13:00"]);
  });

  it("pushes nothing on the last night and returns no receipt", async () => {
    const { user, trip, nextDay } = await seedTrip("stay-last@example.com", "09:00");
    await prisma.accommodation.create({ data: { tripDayId: nextDay.id, name: "Last night", checkOutTime: "09:00" } });

    const result = await patchStay(user.id, trip.id, nextDay.id, "12:00");

    expect(result.status).toBe("updated");
    expect(result.status === "updated" && result.receipt).toBeUndefined();
  });

  it("recomputes an empty next day too, which moves nothing", async () => {
    const { user, trip, stayDay } = await seedTrip("stay-nothing-empty@example.com", "09:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, "12:00");

    // 13.1: the next day is recomputed whatever it holds; the receipt reports nothing moved, and the
    // client drops it as side-effect-free.
    expect(result.status === "updated" && result.receipt?.movedItems).toEqual([]);
    expect((await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: stayDay.id } })).checkOutTime).toBe("12:00");
  });

  it("gives a formerly untimed activity its times from the new check-out (13.1 §5)", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-nothing-untimed@example.com", "09:00");
    const whenever = await createItem(nextDay.id, "Whenever", null, null);

    const result = await patchStay(user.id, trip.id, stayDay.id, "12:00");

    expect(result.status === "updated" && result.receipt?.movedItems.map((row) => row.itemId)).toEqual([whenever.id]);
    expect(await times(nextDay.id)).toEqual(["Whenever 12:00–12:15"]);
  });

  it("pushes the nearest later day when the day indices have a gap", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-gap@example.com", "09:00");
    await prisma.tripDay.update({ where: { id: nextDay.id }, data: { dayIndex: 7 } });
    const farDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-11-08T00:00:00.000Z"), dayIndex: 9 },
    });
    await flexibleDay(nextDay.id, await createItem(nextDay.id, "F", "09:30", "10:00"));
    await createItem(farDay.id, "Far", "09:30", "10:00");

    const result = await patchStay(user.id, trip.id, stayDay.id, "10:00");

    expect(result.status === "updated" && result.receipt?.tripDayId).toBe(nextDay.id);
    expect(await times(nextDay.id)).toEqual(["F 10:00–10:30"]);
    expect(await times(farDay.id)).toEqual(["Far 09:30–10:00"]);
  });

  it("refuses past midnight, naming the activity, with nothing written", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("stay-midnight@example.com", "09:00");
    const f = await createItem(nextDay.id, "Early bird", "08:00", "09:00");
    const late = await createItem(nextDay.id, "Late show", "22:30", "23:30");
    // 13.1 §7: flexible rows, so a 23:30 check-out leaves the first of them no room.
    await flexibleDay(nextDay.id, f, late);
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
    await flexibleDay(nextDay.id, await createItem(nextDay.id, "F", "10:30", "11:30"));
    const url = `http://localhost/api/trips/${trip.id}/accommodations`;
    const body = { tripDayId: stayDay.id, name: "Glenfern Villas", status: "planned" };

    const later = await send(PATCH, url, "PATCH", trip.id, session, { ...body, checkOutTime: "11:00" });
    expect(later.status).toBe(200);
    expect(later.body.data?.receipt?.tripDayId).toBe(nextDay.id);
    expect(later.body.data?.receipt?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(later.body.data?.receipt?.movedItems).toHaveLength(1);

    // 13.1 AC4: an earlier check-out recomputes too, so it answers with a receipt.
    const earlier = await send(PATCH, url, "PATCH", trip.id, session, { ...body, checkOutTime: "10:00" });
    expect(earlier.status).toBe(200);
    expect(earlier.body.data?.receipt?.movedItems).toHaveLength(1);

    const untouched = await send(PATCH, url, "PATCH", trip.id, session, body);
    expect(untouched.status).toBe(200);
    expect(untouched.body.data && "receipt" in untouched.body.data).toBe(false);
  });

  it("answers 409 day_plan_past_midnight with the activity in details, and writes nothing", async () => {
    const { user, trip, stayDay, nextDay } = await seedTrip("route-stay-midnight@example.com", "09:00");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const f = await createItem(nextDay.id, "Early bird", "08:00", "09:00");
    const late = await createItem(nextDay.id, "Late show", "22:30", "23:30");
    await flexibleDay(nextDay.id, f, late);
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
