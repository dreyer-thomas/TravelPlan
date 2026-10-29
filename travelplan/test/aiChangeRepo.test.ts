import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  AI_CHANGE_RETENTION_MS,
  findAiChangeForTrip,
  insertAiChangeInTransaction,
  listAiChangesForTrip,
  undoAiChange,
} from "@/lib/repositories/aiChangeRepo";
import { createParkedDayPlanItem } from "@/lib/repositories/bucketListRepo";
import { createDayPlanItemForTripDay, updateDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import type { InTransactionHook } from "@/lib/trips/writeOrigin";

/**
 * Story 15.4. The stored connector changes: insert inside the write's transaction with the 14-day purge,
 * the list (newest first, within retention), and the undo through the shared core with its four refusals.
 */

const CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
const DAY_MS = 24 * 60 * 60 * 1000;

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

let count = 0;
const seedTrip = async () => {
  count += 1;
  const user = await prisma.user.create({ data: { email: `ai-change-${count}@example.com`, passwordHash: "hashed", role: "OWNER" } });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "AI Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-04T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 1 } });
  return { user, trip, day };
};

type Seeded = Awaited<ReturnType<typeof seedTrip>>;

/** The connector's hook: one `ai_changes` row in the write's transaction. */
const recordHook =
  (seeded: Seeded, action: "created" | "updated", ids: string[], now?: Date): InTransactionHook =>
  async (tx, { receipt, itemId }) => {
    ids.push(
      await insertAiChangeInTransaction(tx, {
        tripId: seeded.trip.id,
        tripDayId: receipt?.tripDayId ?? null,
        userId: seeded.user.id,
        clientId: CLIENT_ID,
        action,
        subject: itemId,
        receipt,
        now,
      }),
    );
  };

const createByAi = async (seeded: Seeded, title: string, now?: Date) => {
  const ids: string[] = [];
  const created = await createDayPlanItemForTripDay({
    userId: seeded.user.id,
    tripId: seeded.trip.id,
    tripDayId: seeded.day.id,
    title,
    scheduleMode: "FLEXIBLE",
    durationMinutes: 60,
    fromTime: null,
    toTime: null,
    contentJson: doc(title),
    origin: "ai",
    inTransaction: recordHook(seeded, "created", ids, now),
  });
  if (!created) throw new Error("setup");
  return { item: created.item, changeId: ids[0] };
};

beforeEach(resetDatabase);

describe("aiChangeRepo (Story 15.4)", () => {
  it("records the change in the write's transaction, with the receipt, and lists newest first", async () => {
    const seeded = await seedTrip();
    const first = await createByAi(seeded, "First", new Date(Date.now() - 2000));
    const second = await createByAi(seeded, "Second", new Date(Date.now() - 1000));

    const rows = await prisma.aiChange.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.receiptJson !== null && row.clientId === CLIENT_ID)).toBe(true);

    const listed = await listAiChangesForTrip({ tripId: seeded.trip.id, now: new Date() });
    expect(listed.map((entry) => entry.id)).toEqual([second.changeId, first.changeId]);
    expect(listed[0]).toMatchObject({ action: "created", tripDayId: seeded.day.id, hasReceipt: true, undoneAt: null });

    expect(await listAiChangesForTrip({ tripId: seeded.trip.id, tripDayId: "other-day", now: new Date() })).toEqual([]);
    expect(await findAiChangeForTrip({ tripId: seeded.trip.id, changeId: first.changeId, now: new Date() })).toMatchObject({
      id: first.changeId,
    });
    expect(await findAiChangeForTrip({ tripId: "other-trip", changeId: first.changeId, now: new Date() })).toBeNull();
  });

  it("a parked write is recorded without a day and without a receipt", async () => {
    const seeded = await seedTrip();
    const ids: string[] = [];
    await createParkedDayPlanItem({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      title: "Idea",
      contentJson: doc("Idea"),
      origin: "ai",
      inTransaction: recordHook(seeded, "created", ids),
    });
    const row = await prisma.aiChange.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(row).toMatchObject({ tripDayId: null, receiptJson: null });
    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId: ids[0], now: new Date() })).toEqual({
      status: "unavailable",
    });
  });

  it("ignores rows older than 14 days and deletes them on the next insert", async () => {
    const seeded = await seedTrip();
    const now = new Date();
    const old = await createByAi(seeded, "Old", new Date(now.getTime() - 15 * DAY_MS));
    const edge = await createByAi(seeded, "Edge", new Date(now.getTime() - AI_CHANGE_RETENTION_MS + 60_000));

    expect((await listAiChangesForTrip({ tripId: seeded.trip.id, now })).map((entry) => entry.id)).toEqual([edge.changeId]);
    expect(await findAiChangeForTrip({ tripId: seeded.trip.id, changeId: old.changeId, now })).toBeNull();
    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId: old.changeId, now })).toEqual({
      status: "not_found",
    });
    expect(await prisma.aiChange.count()).toBe(2);

    await createByAi(seeded, "New", now);
    const remaining = await prisma.aiChange.findMany({ select: { id: true } });
    expect(remaining.map((row) => row.id)).not.toContain(old.changeId);
    expect(remaining).toHaveLength(2);
  });

  it("undoes a change through the core, marks it undone in the same transaction, and refuses a second undo", async () => {
    const seeded = await seedTrip();
    const { item, changeId } = await createByAi(seeded, "Louvre");

    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId, now: new Date() })).toEqual({
      status: "undone",
    });
    expect(await prisma.dayPlanItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: changeId } })).undoneAt).toBeInstanceOf(Date);

    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId, now: new Date() })).toEqual({
      status: "already_undone",
    });
  });

  it("answers unavailable for a receipt that does not parse, and not_found for another trip or a viewer", async () => {
    const seeded = await seedTrip();
    const { changeId } = await createByAi(seeded, "Louvre");
    const other = await seedTrip();

    expect(await undoAiChange({ userId: other.user.id, tripId: other.trip.id, changeId, now: new Date() })).toEqual({
      status: "not_found",
    });

    const viewer = await prisma.user.create({ data: { email: "ai-viewer@example.com", passwordHash: "hashed", role: "OWNER" } });
    await prisma.tripMember.create({ data: { tripId: seeded.trip.id, userId: viewer.id, role: "VIEWER" } });
    expect(await undoAiChange({ userId: viewer.id, tripId: seeded.trip.id, changeId, now: new Date() })).toEqual({
      status: "not_found",
    });

    await prisma.aiChange.update({ where: { id: changeId }, data: { receiptJson: "{not json" } });
    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId, now: new Date() })).toEqual({
      status: "unavailable",
    });
    await prisma.aiChange.update({ where: { id: changeId }, data: { receiptJson: JSON.stringify({ version: 2 }) } });
    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId, now: new Date() })).toEqual({
      status: "unavailable",
    });
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: changeId } })).undoneAt).toBeNull();
  });

  it("refuses as stale when the day changed since, writing nothing and leaving the change open", async () => {
    const seeded = await seedTrip();
    const { item, changeId } = await createByAi(seeded, "Louvre");
    const edited = await updateDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      itemId: item.id,
      title: "Louvre, later",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 90,
      fromTime: null,
      toTime: null,
      contentJson: doc("Louvre"),
      origin: "user",
    });
    expect(edited.status).toBe("updated");
    const before = await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } });

    expect(await undoAiChange({ userId: seeded.user.id, tripId: seeded.trip.id, changeId, now: new Date() })).toEqual({
      status: "stale",
    });
    expect(await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: changeId } })).undoneAt).toBeNull();
  });

  it("stores a receipt that would not parse back as none, so the change is not listed as undoable", async () => {
    const seeded = await seedTrip();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ids: string[] = [];
    await createDayPlanItemForTripDay({
      userId: seeded.user.id,
      tripId: seeded.trip.id,
      tripDayId: seeded.day.id,
      title: "Louvre",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      fromTime: null,
      toTime: null,
      contentJson: doc("Louvre"),
      origin: "ai",
      inTransaction: async (tx, { receipt }) => {
        ids.push(
          await insertAiChangeInTransaction(tx, {
            tripId: seeded.trip.id,
            tripDayId: seeded.day.id,
            userId: seeded.user.id,
            clientId: CLIENT_ID,
            action: "created",
            subject: "Louvre",
            receipt: receipt ? { ...receipt, tripDayId: "" } : null,
          }),
        );
      },
    });
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: ids[0] } })).receiptJson).toBeNull();
    expect((await listAiChangesForTrip({ tripId: seeded.trip.id, now: new Date() }))[0].hasReceipt).toBe(false);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("failed the stored schema"));
    errors.mockRestore();
  });

  it("filters undone changes in the query and caps the list when asked", async () => {
    const seeded = await seedTrip();
    const first = await createByAi(seeded, "First", new Date(Date.now() - 3000));
    const second = await createByAi(seeded, "Second", new Date(Date.now() - 2000));
    const third = await createByAi(seeded, "Third", new Date(Date.now() - 1000));
    await prisma.aiChange.update({ where: { id: second.changeId }, data: { undoneAt: new Date() } });

    const open = await listAiChangesForTrip({ tripId: seeded.trip.id, now: new Date(), notUndone: true });
    expect(open.map((entry) => entry.id)).toEqual([third.changeId, first.changeId]);
    const capped = await listAiChangesForTrip({ tripId: seeded.trip.id, now: new Date(), notUndone: true, take: 1 });
    expect(capped.map((entry) => entry.id)).toEqual([third.changeId]);
    expect(await listAiChangesForTrip({ tripId: seeded.trip.id, now: new Date() })).toHaveLength(3);
  });

  it("a throw in the write's hook leaves neither the write nor the change behind", async () => {
    const seeded = await seedTrip();
    await expect(
      createDayPlanItemForTripDay({
        userId: seeded.user.id,
        tripId: seeded.trip.id,
        tripDayId: seeded.day.id,
        title: "Louvre",
        scheduleMode: "FLEXIBLE",
        durationMinutes: 60,
        fromTime: null,
        toTime: null,
        contentJson: doc("Louvre"),
        origin: "ai",
        inTransaction: async (tx, outcome) => {
          await recordHook(seeded, "created", [])(tx, outcome);
          throw new Error("after the insert");
        },
      }),
    ).rejects.toThrow("after the insert");
    expect(await prisma.dayPlanItem.count()).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
  });
});
