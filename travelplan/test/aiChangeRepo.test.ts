import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  AI_CHANGE_RETENTION_MS,
  findAiChangeForTrip,
  insertAiChangeInTransaction,
  listAiChangesForTrip,
  sweepExpiredFileDeletions,
  undoAiChange,
} from "@/lib/repositories/aiChangeRepo";
import { createParkedDayPlanItem } from "@/lib/repositories/bucketListRepo";
import { createDayPlanItemForTripDay, updateDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { toDayChangeReceiptWire, type DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { getDayPlanItemDocumentUploadDir, getTripDayUploadDir, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";
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

describe("the expiry of files kept for a fileDeleted undo (Story 15.7)", () => {
  beforeEach(resetDatabase);

  const exists = (url: string) =>
    fs
      .stat(resolveStoredMediaPath(url))
      .then(() => true)
      .catch(() => false);

  /** A kept ticket on disk, and the stored `fileDeleted` change naming it, `ageDays` old. */
  const seedKeptFile = async (seeded: Seeded, ageDays: number, options: { undone?: boolean } = {}) => {
    const item = await prisma.dayPlanItem.create({
      data: { tripId: seeded.trip.id, tripDayId: seeded.day.id, title: "Train", contentJson: doc("Train"), sortOrder: 0 },
    });
    const dir = getDayPlanItemDocumentUploadDir(seeded.trip.id, seeded.day.id, item.id);
    const diskName = `doc-${count}-${ageDays}.pdf`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, diskName), "%PDF-1.7 kept");
    const url = `/uploads/trips/${seeded.trip.id}/days/${seeded.day.id}/day-plan-items/${item.id}/documents/${diskName}`;
    const createdAt = new Date(Date.now() - ageDays * DAY_MS);
    const receipt: DayChangeReceipt = {
      version: 3,
      tripDayId: seeded.day.id,
      edited: {
        kind: "fileDeleted",
        target: "activity",
        media: "document",
        previous: {
          id: `kept-${count}-${ageDays}`,
          dayPlanItemId: item.id,
          documentUrl: url,
          fileName: "Ticket.pdf",
          sortOrder: 0,
          createdAt,
          updatedAt: createdAt,
          aiChangedAt: createdAt,
        },
      },
      removedTravelSegments: [],
      movedItems: [],
    };
    const change = await prisma.aiChange.create({
      data: {
        tripId: seeded.trip.id,
        tripDayId: seeded.day.id,
        userId: seeded.user.id,
        clientId: CLIENT_ID,
        action: "fileDeleted",
        subject: "Ticket.pdf",
        receiptJson: JSON.stringify(toDayChangeReceiptWire(receipt)),
        createdAt,
        undoneAt: options.undone ? createdAt : null,
      },
    });
    return { item, url, change };
  };

  it("keeps an expired, not undone file deletion through the insert's retention delete, for the sweep", async () => {
    const seeded = await seedTrip();
    const kept = await seedKeptFile(seeded, 15);
    const undone = await seedKeptFile(seeded, 16, { undone: true });

    await createByAi(seeded, "Next write");

    const ids = (await prisma.aiChange.findMany({ select: { id: true } })).map((row) => row.id);
    expect(ids).toContain(kept.change.id);
    // An undone one put its row back, which names the file: the generic delete takes it as before.
    expect(ids).not.toContain(undone.change.id);
    expect(await exists(kept.url)).toBe(true);
    expect(await exists(undone.url)).toBe(true);
  });

  it("deletes the expired row first and then unlinks its kept file; a fresh one and a file named again stay", async () => {
    const seeded = await seedTrip();
    const expired = await seedKeptFile(seeded, 15);
    const fresh = await seedKeptFile(seeded, 3);
    const reused = await seedKeptFile(seeded, 20);
    // A media row names the reused URL again (an import, say): its file is not the sweep's to remove.
    await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: reused.item.id, documentUrl: reused.url, fileName: "Again.pdf", sortOrder: 5 },
    });

    expect(await sweepExpiredFileDeletions()).toBe(2);

    const ids = (await prisma.aiChange.findMany({ select: { id: true } })).map((row) => row.id);
    expect(ids).toEqual([fresh.change.id]);
    expect(await exists(expired.url)).toBe(false);
    expect(await exists(fresh.url)).toBe(true);
    expect(await exists(reused.url)).toBe(true);
    expect(await sweepExpiredFileDeletions()).toBe(0);
  });

  it("refuses to unlink a kept file outside its entry's own folder, and logs it", async () => {
    const seeded = await seedTrip();
    const kept = await seedKeptFile(seeded, 15);
    const other = await prisma.dayPlanItem.create({
      data: { tripId: seeded.trip.id, tripDayId: seeded.day.id, title: "Other", contentJson: doc("Other"), sortOrder: 1 },
    });
    // The receipt claims the file belongs to another activity: no folder of that one holds it.
    const receipt = JSON.parse(kept.change.receiptJson!) as { edited: { previous: { dayPlanItemId: string } } };
    receipt.edited.previous.dayPlanItemId = other.id;
    await prisma.aiChange.update({ where: { id: kept.change.id }, data: { receiptJson: JSON.stringify(receipt) } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await sweepExpiredFileDeletions()).toBe(1);
    expect(await exists(kept.url)).toBe(true);
    expect(error).toHaveBeenCalledWith("ai-changes sweep: kept file url names no folder of its entry", expect.any(Object));
    error.mockRestore();
  });

  it("logs a kept file whose receipt no longer reads, by change id, and still drops the row", async () => {
    const seeded = await seedTrip();
    const kept = await seedKeptFile(seeded, 15);
    await prisma.aiChange.update({ where: { id: kept.change.id }, data: { receiptJson: "{\"version\":99}" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await sweepExpiredFileDeletions()).toBe(1);
    expect(await exists(kept.url)).toBe(true);
    expect(error).toHaveBeenCalledWith("ai-changes sweep: kept file's receipt no longer reads; file left on disk", {
      tripId: seeded.trip.id,
      changeId: kept.change.id,
    });
    error.mockRestore();
  });

  it("takes at most a batch per call, oldest first, so a backlog drains over later writes", async () => {
    const seeded = await seedTrip();
    const kept = [];
    for (let index = 0; index < 27; index += 1) kept.push(await seedKeptFile(seeded, 15 + index));

    expect(await sweepExpiredFileDeletions()).toBe(25);
    const left = (await prisma.aiChange.findMany({ select: { id: true } })).map((row) => row.id).sort();
    // The two youngest (15 and 16 days) wait for the next call.
    expect(left).toEqual([kept[0].change.id, kept[1].change.id].sort());
    expect(await sweepExpiredFileDeletions()).toBe(2);
  });
});

describe("the expiry of day pictures kept for a dayDetailsChanged undo (Story 15.9)", () => {
  const exists = (url: string) =>
    fs
      .stat(resolveStoredMediaPath(url))
      .then(() => true)
      .catch(() => false);

  /** A day picture the connector replaced `ageDays` ago: the old file kept on disk, the day on the new one. */
  const seedKeptDayPicture = async (seeded: Seeded, ageDays: number, action: "dayImageSet" | "dayImageRemoved") => {
    const dir = getTripDayUploadDir(seeded.trip.id, seeded.day.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "day.jpg"), "kept picture");
    await fs.writeFile(path.join(dir, `day-${ageDays}-new.jpg`), "new picture");
    const keptUrl = `/uploads/trips/${seeded.trip.id}/days/${seeded.day.id}/day.jpg`;
    const newUrl = action === "dayImageSet" ? `/uploads/trips/${seeded.trip.id}/days/${seeded.day.id}/day-${ageDays}-new.jpg` : null;
    await prisma.tripDay.update({ where: { id: seeded.day.id }, data: { imageUrl: newUrl } });
    const createdAt = new Date(Date.now() - ageDays * DAY_MS);
    const receipt: DayChangeReceipt = {
      version: 3,
      tripDayId: seeded.day.id,
      edited: {
        kind: "dayDetailsChanged",
        updatedAt: createdAt,
        previous: { note: null, imageUrl: keptUrl, aiChangedAt: null },
        imageUrl: newUrl,
      },
      removedTravelSegments: [],
      movedItems: [],
    };
    const change = await prisma.aiChange.create({
      data: {
        tripId: seeded.trip.id,
        tripDayId: seeded.day.id,
        userId: seeded.user.id,
        clientId: CLIENT_ID,
        action,
        subject: "day.jpg",
        receiptJson: JSON.stringify(toDayChangeReceiptWire(receipt)),
        createdAt,
      },
    });
    return { keptUrl, newUrl, change };
  };

  it("unlinks a replaced or removed day picture once its change leaves the window, and keeps a fresh one", async () => {
    const replaced = await seedKeptDayPicture(await seedTrip(), 15, "dayImageSet");
    const removed = await seedKeptDayPicture(await seedTrip(), 16, "dayImageRemoved");
    const fresh = await seedKeptDayPicture(await seedTrip(), 3, "dayImageRemoved");

    expect(await sweepExpiredFileDeletions()).toBe(2);

    expect(await exists(replaced.keptUrl)).toBe(false);
    expect(await exists(replaced.newUrl!)).toBe(true);
    expect(await exists(removed.keptUrl)).toBe(false);
    expect(await exists(fresh.keptUrl)).toBe(true);
    expect((await prisma.aiChange.findMany({ select: { id: true } })).map((row) => row.id)).toEqual([fresh.change.id]);
  });

  it("keeps the file when a day points at that picture again (the app reuses day.<ext>)", async () => {
    const seeded = await seedTrip();
    const kept = await seedKeptDayPicture(seeded, 15, "dayImageRemoved");
    await prisma.tripDay.update({ where: { id: seeded.day.id }, data: { imageUrl: kept.keptUrl } });

    expect(await sweepExpiredFileDeletions()).toBe(1);
    expect(await exists(kept.keptUrl)).toBe(true);
  });

  it("keeps the file while a newer change on the day still keeps the same day.<ext> for its undo", async () => {
    const seeded = await seedTrip();
    const older = await seedKeptDayPicture(seeded, 15, "dayImageSet");
    const newer = await seedKeptDayPicture(seeded, 3, "dayImageSet");
    expect(newer.keptUrl).toBe(older.keptUrl);

    expect(await sweepExpiredFileDeletions()).toBe(1);
    expect(await exists(older.keptUrl)).toBe(true);
    expect((await prisma.aiChange.findMany({ select: { id: true } })).map((row) => row.id)).toEqual([newer.change.id]);
  });

  it("keeps a kept day picture's change out of the insert's retention delete, so only the sweep removes it", async () => {
    const seeded = await seedTrip();
    const kept = await seedKeptDayPicture(seeded, 15, "dayImageSet");
    await createByAi(seeded, "Later");

    expect(await prisma.aiChange.count({ where: { id: kept.change.id } })).toBe(1);
  });
});
