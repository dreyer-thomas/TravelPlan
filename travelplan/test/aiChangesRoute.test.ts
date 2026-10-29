import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/[id]/ai-changes/route";
import { POST } from "@/app/api/trips/[id]/ai-changes/[changeId]/undo/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { insertAiChangeInTransaction } from "@/lib/repositories/aiChangeRepo";
import { createDayPlanItemForTripDay, updateDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";

/**
 * Story 15.4. `GET /api/trips/{id}/ai-changes` and `POST .../ai-changes/{changeId}/undo`: the writer gate
 * (404 for a viewer or a stranger), CSRF on the undo, a contributor undoing a change someone else's
 * connector made, and the status mapping of the undo's outcomes.
 */

const CSRF = "csrf-token-value";
const CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string } | null };

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const resetDatabase = async () => {
  await prisma.aiChange.deleteMany();
  await prisma.travelSegment.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
const sessionFor = (user: { id: string; role: "OWNER" | "ADMIN" | "VIEWER" }) => createSessionJwt({ sub: user.id, role: user.role });

const seed = async () => {
  const owner = await createUser("ai-route-owner@example.com");
  const contributor = await createUser("ai-route-contributor@example.com");
  const viewer = await createUser("ai-route-viewer@example.com");
  const stranger = await createUser("ai-route-stranger@example.com");
  const trip = await prisma.trip.create({
    data: {
      userId: owner.id,
      name: "AI Route Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
  await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 1 } });
  const otherDay = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 2 } });
  return { owner, contributor, viewer, stranger, trip, day, otherDay };
};

type Seeded = Awaited<ReturnType<typeof seed>>;

/** A create by the owner's connector, recorded as the tools record it. */
const createByAi = async (seeded: Seeded, title: string, tripDayId = seeded.day.id) => {
  let changeId = "";
  const created = await createDayPlanItemForTripDay({
    userId: seeded.owner.id,
    tripId: seeded.trip.id,
    tripDayId,
    title,
    scheduleMode: "FLEXIBLE",
    durationMinutes: 60,
    fromTime: null,
    toTime: null,
    contentJson: doc(title),
    origin: "ai",
    inTransaction: async (tx, { receipt }) => {
      changeId = await insertAiChangeInTransaction(tx, {
        tripId: seeded.trip.id,
        tripDayId,
        userId: seeded.owner.id,
        clientId: CLIENT_ID,
        action: "created",
        subject: title,
        receipt,
      });
    },
  });
  if (!created) throw new Error("setup");
  return { item: created.item, changeId };
};

const list = async (tripId: string, session: string, query = "") => {
  const request = new NextRequest(`http://localhost/api/trips/${tripId}/ai-changes${query}`, {
    method: "GET",
    headers: { cookie: `session=${session}` },
  });
  const response = await GET(request, { params: Promise.resolve({ id: tripId }) });
  return {
    status: response.status,
    body: (await response.json()) as ApiEnvelope<{
      changes: { id: string; action: string; subject: string | null; createdAt: string; undoable: boolean }[];
    }>,
  };
};

const undo = async (tripId: string, changeId: string, session: string, csrf = CSRF) => {
  const request = new NextRequest(`http://localhost/api/trips/${tripId}/ai-changes/${changeId}/undo`, {
    method: "POST",
    headers: { cookie: `session=${session}; csrf_token=${CSRF}`, "x-csrf-token": csrf },
  });
  const response = await POST(request, { params: Promise.resolve({ id: tripId, changeId }) });
  return { status: response.status, body: (await response.json()) as ApiEnvelope<{ undone: boolean }> };
};

beforeEach(resetDatabase);

describe("GET /api/trips/[id]/ai-changes (Story 15.4)", () => {
  it("lists the open changes newest first for a writer, narrowed to one day, and hides undone ones", async () => {
    const seeded = await seed();
    const first = await createByAi(seeded, "Louvre");
    const second = await createByAi(seeded, "Orsay");
    const elsewhere = await createByAi(seeded, "Versailles", seeded.otherDay.id);

    const all = await list(seeded.trip.id, await sessionFor(seeded.contributor));
    expect(all.status).toBe(200);
    expect(all.body.data?.changes.map((change) => change.id)).toEqual([elsewhere.changeId, second.changeId, first.changeId]);
    expect(all.body.data?.changes[0]).toEqual({
      id: elsewhere.changeId,
      action: "created",
      subject: "Versailles",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      undoable: true,
    });

    const day = await list(seeded.trip.id, await sessionFor(seeded.owner), `?tripDayId=${seeded.day.id}`);
    expect(day.body.data?.changes.map((change) => change.id)).toEqual([second.changeId, first.changeId]);

    await prisma.aiChange.update({ where: { id: second.changeId }, data: { undoneAt: new Date() } });
    const after = await list(seeded.trip.id, await sessionFor(seeded.owner), `?tripDayId=${seeded.day.id}`);
    expect(after.body.data?.changes.map((change) => change.id)).toEqual([first.changeId]);
  });

  it("answers 404 to a viewer and a stranger, and 401 without a session", async () => {
    const seeded = await seed();
    await createByAi(seeded, "Louvre");
    for (const user of [seeded.viewer, seeded.stranger]) {
      const result = await list(seeded.trip.id, await sessionFor(user));
      expect(result.status).toBe(404);
      expect(result.body.error?.code).toBe("not_found");
    }
    expect((await list(seeded.trip.id, "not-a-session")).status).toBe(401);
  });
});

describe("POST /api/trips/[id]/ai-changes/[changeId]/undo (Story 15.4)", () => {
  it("lets a contributor undo the owner's connector change: 200, the activity is gone, the change is undone", async () => {
    const seeded = await seed();
    const { item, changeId } = await createByAi(seeded, "Louvre");

    const result = await undo(seeded.trip.id, changeId, await sessionFor(seeded.contributor));
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ undone: true });
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: changeId } })).undoneAt).toBeInstanceOf(Date);

    const again = await undo(seeded.trip.id, changeId, await sessionFor(seeded.owner));
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("already_undone");
  });

  it("refuses a bad CSRF token with 403 and writes nothing", async () => {
    const seeded = await seed();
    const { item, changeId } = await createByAi(seeded, "Louvre");
    const result = await undo(seeded.trip.id, changeId, await sessionFor(seeded.owner), "wrong");
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("csrf_invalid");
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });

  it("answers 404 to a viewer, a stranger, an unknown change and a change of another trip", async () => {
    const seeded = await seed();
    const { item, changeId } = await createByAi(seeded, "Louvre");
    for (const user of [seeded.viewer, seeded.stranger]) {
      const result = await undo(seeded.trip.id, changeId, await sessionFor(user));
      expect(result.status).toBe(404);
    }
    expect((await undo(seeded.trip.id, "no-such-change", await sessionFor(seeded.owner))).status).toBe(404);

    const otherTrip = await prisma.trip.create({
      data: { userId: seeded.owner.id, name: "Other", startDate: new Date("2026-12-01"), endDate: new Date("2026-12-01") },
    });
    expect((await undo(otherTrip.id, changeId, await sessionFor(seeded.owner))).status).toBe(404);
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });

  it("maps no receipt to 400 undo_unavailable and a changed day to 409 undo_stale", async () => {
    const seeded = await seed();
    const { item, changeId } = await createByAi(seeded, "Louvre");

    await updateDayPlanItemForTripDay({
      userId: seeded.owner.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: item.id,
      title: "Louvre, edited",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      fromTime: null,
      toTime: null,
      contentJson: doc("Louvre"),
      origin: "user",
    });
    const stale = await undo(seeded.trip.id, changeId, await sessionFor(seeded.owner));
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("undo_stale");

    await prisma.aiChange.update({ where: { id: changeId }, data: { receiptJson: null } });
    const unavailable = await undo(seeded.trip.id, changeId, await sessionFor(seeded.owner));
    expect(unavailable.status).toBe(400);
    expect(unavailable.body.error?.code).toBe("undo_unavailable");
  });
});
