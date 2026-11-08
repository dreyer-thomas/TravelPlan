import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { updatePackingItem } from "@/lib/repositories/packingListRepo";
import { cleanOAuthTables, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool } from "./helpers/mcpClient";
import { errorText, getDay, setupConnectorTrip, structured, stubNetworkSeams } from "./helpers/connectorWriteFixtures";

/**
 * Story 16.4. The packing list through the connector, end to end through `POST /api/mcp` with real tokens:
 * `get_packing_list`, `add_packing_items`, `update_packing_item`, `delete_packing_item`, the packing fields
 * of `get_trip` and `get_day`, and their undo through `undo_ai_change`. The owner and a contributor write;
 * a viewer finds no trip.
 */

setupConnectorEnvironment();

const rateLimitStore = () => (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore;

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  for (const key of [...(rateLimitStore()?.keys() ?? [])]) {
    if (key.startsWith("mcp-tool:")) rateLimitStore()?.delete(key);
  }
  stubNetworkSeams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Item = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  dayIds: string[];
  updatedAt: string;
  aiChangedAt: string | null;
};
type AddResult = {
  aiChangeId: string | null;
  results: { name: string; itemId: string; status: "created" | "existed" }[];
  items: Item[];
};
type UpdateResult = { aiChangeId: string | null; item: Item };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const list = async (token: string, tripId: string, dayId?: string) =>
  structured<{ items: Item[] }>(await callTool(token, "get_packing_list", { tripId, ...(dayId ? { dayId } : {}) })).items;

const addItems = async (token: string, tripId: string, items: { name: string; category?: string | null }[], dayId?: string) =>
  structured<AddResult>(await callTool(token, "add_packing_items", { tripId, items, ...(dayId ? { dayId } : {}) }));

const undoChange = (token: string, tripId: string, changeId: string) => callTool(token, "undo_ai_change", { tripId, changeId });

describe("packing tools (Story 16.4)", () => {
  it("adds a batch with an existing name and an in-batch repeat, reads it back, and records one change", async () => {
    const { seed, owner } = await setupConnectorTrip();
    await addItems(owner.token, seed.trip.id, [{ name: "Pass", category: "Dokumente" }]);

    const added = await addItems(owner.token, seed.trip.id, [
      { name: "Sonnencreme", category: "Hygiene" },
      { name: " pass " },
      { name: "SONNENCREME", category: "Sonstiges" },
    ]);

    const sun = added.results[0].itemId;
    const pass = added.results[1].itemId;
    expect(added.results).toEqual([
      { name: "Sonnencreme", itemId: sun, status: "created" },
      { name: " pass ", itemId: pass, status: "existed" },
      { name: "SONNENCREME", itemId: sun, status: "existed" },
    ]);
    expect(added.aiChangeId).toEqual(expect.any(String));
    expect(added.items.map((item) => item.name)).toEqual(["Sonnencreme", "Pass"]);
    expect(added.items[0]).toEqual({
      id: sun,
      name: "Sonnencreme",
      category: "Hygiene",
      packed: false,
      dayIds: [],
      updatedAt: expect.stringMatching(ISO),
      aiChangedAt: expect.stringMatching(ISO),
    });

    const items = await list(owner.token, seed.trip.id);
    expect(items.map((item) => [item.name, item.category])).toEqual([
      ["Pass", "Dokumente"],
      ["Sonnencreme", "Hygiene"],
    ]);

    const changes = structured<{ changes: { id: string; dayId: string | null; action: string; subject: string; summary: string }[] }>(
      await callTool(owner.token, "list_ai_changes", { tripId: seed.trip.id }),
    ).changes;
    expect(changes[0]).toMatchObject({
      id: added.aiChangeId,
      dayId: null,
      action: "packingAdded",
      subject: "Sonnencreme",
      summary: 'Added packing items "Sonnencreme"',
    });
  });

  it("an add of only existing names writes nothing (aiChangeId null)", async () => {
    const { seed, owner } = await setupConnectorTrip();
    await addItems(owner.token, seed.trip.id, [{ name: "Pass" }]);
    const again = await addItems(owner.token, seed.trip.id, [{ name: "PASS" }]);
    expect(again.aiChangeId).toBeNull();
    expect(await prisma.aiChange.count()).toBe(1);
  });

  it("refuses the whole batch for one invalid item, naming its index", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const body = await callTool(owner.token, "add_packing_items", {
      tripId: seed.trip.id,
      items: [{ name: "Pass" }, { name: "   " }],
    });
    expect(errorText(body)).toBe("items[1]: Name is required.");
    const long = await callTool(owner.token, "add_packing_items", {
      tripId: seed.trip.id,
      items: [{ name: "Pass", category: "x".repeat(41) }],
    });
    expect(errorText(long)).toBe("items[0]: Category must be at most 40 characters.");
    expect(await prisma.packingItem.count()).toBe(0);
  });

  it("adds to a day: the day's list, get_day.packingItems and get_trip.packing show it, and the change carries the day", async () => {
    const { seed, contributor } = await setupConnectorTrip();
    const added = await addItems(contributor.token, seed.trip.id, [{ name: "Badehose" }, { name: "Handtuch" }], seed.day2.id);
    expect(added.items.every((item) => item.dayIds[0] === seed.day2.id)).toBe(true);
    expect((await prisma.aiChange.findUniqueOrThrow({ where: { id: added.aiChangeId! } })).tripDayId).toBe(seed.day2.id);
    await addItems(contributor.token, seed.trip.id, [{ name: "Pass" }]);

    expect((await list(contributor.token, seed.trip.id, seed.day2.id)).map((item) => item.name)).toEqual(["Badehose", "Handtuch"]);
    expect(await list(contributor.token, seed.trip.id, seed.day1.id)).toEqual([]);
    expect(errorText(await callTool(contributor.token, "get_packing_list", { tripId: seed.trip.id, dayId: "nope" }))).toBe(
      "Day not found",
    );

    const day = await getDay<{ packingItems: unknown[] }>(contributor.token, seed.trip.id, seed.day2.id);
    expect(day.packingItems).toEqual([
      { id: added.items[0].id, name: "Badehose", category: null, packed: false },
      { id: added.items[1].id, name: "Handtuch", category: null, packed: false },
    ]);
    const other = await getDay<{ packingItems: unknown[] }>(contributor.token, seed.trip.id, seed.day1.id);
    expect(other.packingItems).toEqual([]);

    const handtuch = added.items[1];
    await updateTick(contributor.token, seed.trip.id, handtuch);
    const trip = structured<{ packing: { total: number; packed: number } }>(
      await callTool(contributor.token, "get_trip", { tripId: seed.trip.id }),
    );
    expect(trip.packing).toEqual({ total: 3, packed: 1 });
  });

  it("lists items in name-key order, not in insertion order", async () => {
    const { seed, owner } = await setupConnectorTrip();
    await addItems(owner.token, seed.trip.id, [{ name: "Zelt" }, { name: "ausweis" }]);
    await addItems(owner.token, seed.trip.id, [{ name: "Mütze" }]);
    expect((await list(owner.token, seed.trip.id)).map((item) => item.name)).toEqual(["ausweis", "Mütze", "Zelt"]);
  });

  it("undoes a day-scoped add that only linked existing items: links gone, items and their state kept", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const first = await addItems(owner.token, seed.trip.id, [{ name: "Pass", category: "Dokumente" }]);
    // An app edit clears the KI marker, so the restore of a null marker is visible.
    await tick();
    await updatePackingItem({ userId: owner.user.id, tripId: seed.trip.id, itemId: first.items[0].id, packed: true, origin: "user" });
    const [before] = await list(owner.token, seed.trip.id);
    expect(before.aiChangedAt).toBeNull();
    await tick();

    const linked = await addItems(owner.token, seed.trip.id, [{ name: "pass" }], seed.day2.id);
    expect(linked.results[0].status).toBe("existed");
    expect(linked.aiChangeId).toEqual(expect.any(String));
    expect(linked.items[0]).toMatchObject({ dayIds: [seed.day2.id], aiChangedAt: expect.stringMatching(ISO) });

    expect(structured(await undoChange(owner.token, seed.trip.id, linked.aiChangeId!))).toMatchObject({ undone: true });
    expect(await list(owner.token, seed.trip.id)).toEqual([before]);
  });

  it("answers Day not found for an add to a day that is not on the trip, writing nothing", async () => {
    const { seed, owner } = await setupConnectorTrip();
    expect(errorText(await callTool(owner.token, "add_packing_items", { tripId: seed.trip.id, items: [{ name: "X" }], dayId: "nope" }))).toBe(
      "Day not found",
    );
    expect(await prisma.packingItem.count()).toBe(0);
  });

  it("ticks, renames, links and unlinks; refuses a duplicate rename, a stale stamp and bad input", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const added = await addItems(owner.token, seed.trip.id, [{ name: "Sonnencreme" }, { name: "Pass" }], seed.day1.id);
    const [sun] = added.items;
    const update = (args: Record<string, unknown>) =>
      callTool(owner.token, "update_packing_item", { tripId: seed.trip.id, itemId: sun.id, updatedAt: sun.updatedAt, ...args });

    expect(errorText(await update({ name: "pass" }))).toBe('A packing item named "pass" already exists.');
    expect(errorText(await update({}))).toBe("Nothing to change.");
    expect(errorText(await update({ addDayIds: [seed.day2.id], removeDayIds: [seed.day2.id] }))).toBe(
      "A day cannot be in both addDayIds and removeDayIds.",
    );
    expect(errorText(await update({ addDayIds: ["nope"] }))).toBe("Day not found");
    expect(errorText(await update({ updatedAt: "2020-01-01T00:00:00.000Z", packed: true }))).toBe(
      "Packing item changed since you read it; read the list again",
    );
    expect(
      errorText(await callTool(owner.token, "update_packing_item", { tripId: seed.trip.id, itemId: "nope", updatedAt: sun.updatedAt, packed: true })),
    ).toBe("Packing item not found");

    const noop = structured<UpdateResult>(await update({ packed: false, addDayIds: [seed.day1.id] }));
    expect(noop.aiChangeId).toBeNull();

    const changed = structured<UpdateResult>(
      await update({ name: "SONNENCREME", category: "other", packed: true, addDayIds: [seed.day3.id, seed.day2.id], removeDayIds: [seed.day1.id] }),
    );
    expect(changed.aiChangeId).toEqual(expect.any(String));
    expect(changed.item).toMatchObject({ name: "SONNENCREME", category: null, packed: true, dayIds: [seed.day2.id, seed.day3.id] });
    const row = await prisma.aiChange.findUniqueOrThrow({ where: { id: changed.aiChangeId! } });
    expect(row).toMatchObject({ action: "packingUpdated", subject: "SONNENCREME", tripDayId: null });
  });

  it("deletes an item with its day links; undo brings it back on its days", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const added = await addItems(owner.token, seed.trip.id, [{ name: "Schnorchel", category: "Sport" }], seed.day1.id);
    const [item] = added.items;

    const deleted = structured<{ aiChangeId: string; deleted: { id: string; name: string; dayCount: number } }>(
      await callTool(owner.token, "delete_packing_item", { tripId: seed.trip.id, itemId: item.id }),
    );
    expect(deleted.deleted).toEqual({ id: item.id, name: "Schnorchel", dayCount: 1 });
    expect(await list(owner.token, seed.trip.id)).toEqual([]);
    expect(errorText(await callTool(owner.token, "delete_packing_item", { tripId: seed.trip.id, itemId: item.id }))).toBe(
      "Packing item not found",
    );

    expect(structured(await undoChange(owner.token, seed.trip.id, deleted.aiChangeId))).toEqual({ undone: true, changeId: deleted.aiChangeId });
    expect(await list(owner.token, seed.trip.id)).toEqual([item]);
  });

  it("undoes a chain newest first through the tool; the older one first is stale", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const added = await addItems(owner.token, seed.trip.id, [{ name: "Sonnencreme" }]);
    await tick();
    const ticked = await updateTick(owner.token, seed.trip.id, added.items[0]);

    expect(errorText(await undoChange(owner.token, seed.trip.id, added.aiChangeId!))).toBe(
      "The packing list has changed since this change was made; it can no longer be undone.",
    );
    expect(structured(await undoChange(owner.token, seed.trip.id, ticked.aiChangeId!))).toMatchObject({ undone: true });
    expect(await list(owner.token, seed.trip.id)).toEqual([added.items[0]]);
    expect(structured(await undoChange(owner.token, seed.trip.id, added.aiChangeId!))).toMatchObject({ undone: true });
    expect(await list(owner.token, seed.trip.id)).toEqual([]);
  });

  it("an app edit clears the KI marker and makes the connector change's undo stale", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const added = await addItems(owner.token, seed.trip.id, [{ name: "Hut" }]);
    expect(added.items[0].aiChangedAt).toMatch(ISO);
    await tick();

    await updatePackingItem({ userId: owner.user.id, tripId: seed.trip.id, itemId: added.items[0].id, packed: true, origin: "user" });
    const [item] = await list(owner.token, seed.trip.id);
    expect(item.aiChangedAt).toBeNull();
    expect(errorText(await undoChange(owner.token, seed.trip.id, added.aiChangeId!))).toBe(
      "The packing list has changed since this change was made; it can no longer be undone.",
    );
  });

  it("answers Trip not found to a viewer on every packing tool", async () => {
    const { seed, owner, viewer } = await setupConnectorTrip();
    const added = await addItems(owner.token, seed.trip.id, [{ name: "Pass" }]);
    const [item] = added.items;
    const calls: [string, Record<string, unknown>][] = [
      ["get_packing_list", { tripId: seed.trip.id }],
      ["add_packing_items", { tripId: seed.trip.id, items: [{ name: "X" }] }],
      ["update_packing_item", { tripId: seed.trip.id, itemId: item.id, updatedAt: item.updatedAt, packed: true }],
      ["delete_packing_item", { tripId: seed.trip.id, itemId: item.id }],
    ];
    for (const [name, args] of calls) {
      expect(errorText(await callTool(viewer.token, name, args)), name).toBe("Trip not found");
    }
    expect(await list(owner.token, seed.trip.id)).toEqual([item]);
  });
});

/** Ticks the item off through the tool and returns the result. */
const updateTick = async (token: string, tripId: string, item: Item) =>
  structured<UpdateResult>(
    await callTool(token, "update_packing_item", { tripId, itemId: item.id, updatedAt: item.updatedAt, packed: true }),
  );
