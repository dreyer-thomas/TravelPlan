import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/day-plan-items/make-flexible/route";
import { POST as UNDO_POST } from "@/app/api/trips/[id]/day-plan-changes/undo/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { makeDayFlexibleForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { summarizeDayChangeReceipt, type DayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import en from "@/i18n/en";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 13.3 AC5. *Alle flexibel machen* through the route: every FIXED activity becomes FLEXIBLE with its
 * duration, order unchanged, times recomputed; the receipt's undo restores the whole day or refuses.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

/** One day, no stay last night: it starts at 09:00. */
const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Flexible Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 },
  });
  return { trip, day };
};

const row = (
  tripId: string,
  tripDayId: string,
  title: string,
  sortOrder: number,
  scheduleMode: "FIXED" | "FLEXIBLE",
  durationMinutes: number,
  fromTime: string | null,
  toTime: string | null,
) =>
  prisma.dayPlanItem.create({
    data: {
      tripId,
      tripDayId,
      title,
      sortOrder,
      scheduleMode,
      durationMinutes,
      fromTime,
      toTime,
      contentJson: sampleDoc(title),
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

/**
 * A migrated 1-minute row at 09:30, a 12:00–13:30 ferry whose stored duration drifted to 15, and a
 * flexible 60-minute walk behind it (13:30–14:30).
 */
const seedDay = async (email: string) => {
  const user = await createUser(email);
  const { trip, day } = await createTrip(user.id);
  const short = await row(trip.id, day.id, "Short", 0, "FIXED", 1, "09:30", "09:31");
  const ferry = await row(trip.id, day.id, "Ferry", 1, "FIXED", 15, "12:00", "13:30");
  const walk = await row(trip.id, day.id, "Walk", 2, "FLEXIBLE", 60, "13:30", "14:30");
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  return { user, trip, day, short, ferry, walk, session };
};

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

const dayRows = async (tripDayId: string) =>
  (await prisma.dayPlanItem.findMany({ where: { tripDayId }, orderBy: { sortOrder: "asc" } })).map(
    (item) => `${item.sortOrder} ${item.title} ${item.scheduleMode} ${item.durationMinutes} ${item.fromTime}–${item.toTime}`,
  );

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

const request = (url: string, session: string, body: unknown, csrf = CSRF) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `session=${session}; csrf_token=${CSRF}`, "x-csrf-token": csrf },
    body: JSON.stringify(body),
  });

const send = async (tripId: string, session: string, body: unknown, csrf = CSRF) => {
  const response = await POST(request(`http://localhost/api/trips/${tripId}/day-plan-items/make-flexible`, session, body, csrf), routeContext(tripId));
  return { status: response.status, body: (await response.json()) as ApiEnvelope<{ receipt: DayChangeReceiptWire & { signature: string } }> };
};

const postUndo = async (tripId: string, session: string, receipt: unknown) => {
  const response = await UNDO_POST(request(`http://localhost/api/trips/${tripId}/day-plan-changes/undo`, session, { receipt }), routeContext(tripId));
  return { status: response.status, body: (await response.json()) as ApiEnvelope<unknown> };
};

const t = (key: string) => (en as Record<string, string>)[key] ?? key;

describe("POST /api/trips/[id]/day-plan-items/make-flexible (Story 13.3 AC5)", () => {
  beforeEach(resetDatabase);

  it("makes every fixed activity flexible with its span as duration, keeps the order and closes the gaps", async () => {
    const { trip, day, short, ferry, walk, session } = await seedDay("flexible-convert@example.com");

    const response = await send(trip.id, session, { tripDayId: day.id });

    expect(response.status).toBe(200);
    expect(await dayRows(day.id)).toEqual([
      "0 Short FLEXIBLE 1 09:00–09:01",
      "1 Ferry FLEXIBLE 90 09:01–10:31",
      "2 Walk FLEXIBLE 60 10:31–11:31",
    ]);
    const receipt = response.body.data!.receipt;
    expect(receipt.version).toBe(3);
    expect(receipt.edited).toEqual({
      kind: "madeFlexible",
      items: [
        {
          itemId: short.id,
          updatedAt: expect.any(String),
          previous: { durationMinutes: 1, fromTime: "09:30", toTime: "09:31", sortOrder: 0, updatedAt: PAST.toISOString() },
        },
        {
          itemId: ferry.id,
          updatedAt: expect.any(String),
          previous: { durationMinutes: 15, fromTime: "12:00", toTime: "13:30", sortOrder: 1, updatedAt: PAST.toISOString() },
        },
      ],
    });
    expect(receipt.movedItems.map((moved) => moved.itemId)).toEqual([walk.id]);
    expect(summarizeDayChangeReceipt(receipt, t)).toBe("2 activities made flexible · 1 activity moved");
    // Both converted rows carry the stamp the receipt names, which is what undo compares against.
    if (receipt.edited.kind !== "madeFlexible") throw new Error("expected madeFlexible");
    const written = receipt.edited.items[0].updatedAt;
    const stamps = await prisma.dayPlanItem.findMany({ where: { id: { in: [short.id, ferry.id] } } });
    for (const stamp of stamps) expect(stamp.updatedAt.toISOString()).toBe(written);
  });

  it("stores a converted row that no longer fits without times (13.2)", async () => {
    const user = await createUser("flexible-midnight@example.com");
    const { trip, day } = await createTrip(user.id);
    await row(trip.id, day.id, "Long", 0, "FLEXIBLE", 840, "09:00", "23:00");
    await row(trip.id, day.id, "Show", 1, "FIXED", 120, "21:00", "23:00");

    const result = await makeDayFlexibleForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id });

    expect(result.status).toBe("made_flexible");
    expect(await dayRows(day.id)).toEqual(["0 Long FLEXIBLE 840 09:00–23:00", "1 Show FLEXIBLE 120 null–null"]);
  });

  it("undo restores modes, durations, times, order and stamps: the whole DB", async () => {
    const { trip, day, session } = await seedDay("flexible-undo@example.com");
    const before = await databaseState();

    const response = await send(trip.id, session, { tripDayId: day.id });
    expect(response.status).toBe(200);

    const undone = await postUndo(trip.id, session, response.body.data!.receipt);
    expect(undone).toEqual({ status: 200, body: { data: { undone: true }, error: null } });
    expect(await databaseState()).toEqual(before);
  });

  it("refuses the undo as undo_stale once a converted row was edited, and writes nothing", async () => {
    const { trip, day, ferry, session } = await seedDay("flexible-undo-stale@example.com");
    const response = await send(trip.id, session, { tripDayId: day.id });
    await prisma.dayPlanItem.update({ where: { id: ferry.id }, data: { title: "Ferry renamed", updatedAt: new Date("2030-01-01T00:00:00.000Z") } });
    const before = await databaseState();

    const undone = await postUndo(trip.id, session, response.body.data!.receipt);

    expect(undone.status).toBe(409);
    expect(undone.body.error?.code).toBe("undo_stale");
    expect(await databaseState()).toEqual(before);
  });

  it("refuses a tampered receipt (empty items, a converted id also moved) with 400", async () => {
    const { user, trip, day, session } = await seedDay("flexible-undo-tampered@example.com");
    const response = await send(trip.id, session, { tripDayId: day.id });
    const { signature: _signature, ...receipt } = response.body.data!.receipt;
    void _signature;
    if (receipt.edited.kind !== "madeFlexible") throw new Error("setup");
    const before = await databaseState();

    const empty = signDayChangeReceipt({ ...receipt, edited: { kind: "madeFlexible", items: [] } }, { tripId: trip.id, userId: user.id });
    expect((await postUndo(trip.id, session, empty)).status).toBe(400);

    const converted = receipt.edited.items[0];
    const alsoMoved = signDayChangeReceipt(
      {
        ...receipt,
        movedItems: [
          ...receipt.movedItems,
          {
            itemId: converted.itemId,
            previousFromTime: "09:30",
            previousToTime: "09:31",
            previousSortOrder: 0,
            fromTime: "09:00",
            toTime: "09:01",
            previousUpdatedAt: converted.previous.updatedAt,
            updatedAt: converted.updatedAt,
          },
        ],
      },
      { tripId: trip.id, userId: user.id },
    );
    expect((await postUndo(trip.id, session, alsoMoved)).status).toBe(400);
    expect(await databaseState()).toEqual(before);
  });

  it("answers 409 day_plan_changed on a day without a fixed activity, and writes nothing", async () => {
    const user = await createUser("flexible-none@example.com");
    const { trip, day } = await createTrip(user.id);
    await row(trip.id, day.id, "Walk", 0, "FLEXIBLE", 60, "09:00", "10:00");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const response = await send(trip.id, session, { tripDayId: day.id });

    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("day_plan_changed");
    expect(await databaseState()).toEqual(before);
  });

  it("gates: viewer 403, outsider 404, bad CSRF 403, unknown day 404, bad body 400; a contributor may", async () => {
    const { trip, day, session } = await seedDay("flexible-gates@example.com");
    const viewer = await createUser("flexible-viewer@example.com");
    const outsider = await createUser("flexible-outsider@example.com");
    const contributor = await createUser("flexible-contributor@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    const sessionOf = (user: { id: string; role: "OWNER" | "VIEWER" | "ADMIN" }) => createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const asViewer = await send(trip.id, await sessionOf(viewer), { tripDayId: day.id });
    expect(asViewer.status).toBe(403);
    expect((await send(trip.id, await sessionOf(outsider), { tripDayId: day.id })).status).toBe(404);
    const forged = await send(trip.id, session, { tripDayId: day.id }, "wrong");
    expect(forged.status).toBe(403);
    expect(forged.body.error?.code).toBe("csrf_invalid");
    expect((await send(trip.id, session, { tripDayId: "nope" })).status).toBe(404);
    const extra = await send(trip.id, session, { tripDayId: day.id, itemId: "x" });
    expect(extra.status).toBe(400);
    expect(extra.body.error?.code).toBe("validation_error");
    expect(await databaseState()).toEqual(before);

    expect((await send(trip.id, await sessionOf(contributor), { tripDayId: day.id })).status).toBe(200);
  });
});
