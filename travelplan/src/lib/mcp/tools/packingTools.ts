import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toolError } from "@/lib/mcp/logging";
import { toPackingItem } from "@/lib/mcp/packingShapes";
import {
  DAY_NOT_FOUND,
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  READ_ONLY_TOOL_ANNOTATIONS,
  requireWritableTrip,
  runTool,
  toolResult,
  TRIP_NOT_FOUND,
  WRITE_TOOL_ANNOTATIONS,
} from "@/lib/mcp/toolRuntime";
import { isCaller, startWrite, tripIdField, writeErrorResult, type Caller } from "@/lib/mcp/tools/activityWrite";
import {
  insertAiChangeInTransaction,
  UnstorableReceiptError,
  type AiChangeAction,
} from "@/lib/repositories/aiChangeRepo";
import { isPlannerDayOfTrip } from "@/lib/repositories/connectorReadRepo";
import {
  addPackingItemsForConnector,
  deletePackingItemForConnector,
  listPackingItemsForTrip,
  updatePackingItemForConnector,
  type PackingInTransactionHook,
} from "@/lib/repositories/packingListRepo";
import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type { PackingChangeReceipt } from "@/lib/trips/packingChangeReceipt";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";
import { categoryField, nameField } from "@/lib/validation/packingListSchemas";

/**
 * Story 16.4 (FR53, FR54, FR57). The trip's packing list through the connector, on the 15.4 rails: writers
 * only (R1: any other trip is `Trip not found`), every write through `startWrite` and one `ai_changes` row
 * with the packing receipt in the write's own transaction, so it is undoable from the tool and the app.
 * Names and categories follow the app's rules (`packingListSchemas.ts`); every write goes through
 * `packingListRepo.ts`, which sets the item's KI/AI marker.
 */

export const PACKING_ITEM_NOT_FOUND = "Packing item not found";
export const PACKING_CHANGED_SINCE_READ = "Packing item changed since you read it; read the list again";
const UNSTORABLE_RECEIPT = "This packing list holds data the undo cannot keep, so nothing was written.";
const NOTHING_TO_CHANGE = "Nothing to change.";
const DAY_IN_BOTH = "A day cannot be in both addDayIds and removeDayIds.";
/** The longest `subject` an add stores, in code points. */
const MAX_SUBJECT_LENGTH = 120;
/** The most items one `add_packing_items` call takes. */
export const MAX_PACKING_ITEMS_PER_CALL = 50;

const itemIdField = idSchema.describe("The packing item's id, from get_packing_list.");
const dayIdsField = z.array(idSchema).max(366);

const getInput = z.object({
  tripId: tripIdField,
  dayId: idSchema.optional().describe("Only the items linked to this day (id from get_trip)."),
});

const addInput = z.object({
  tripId: tripIdField,
  items: z
    .array(
      z.object({
        name: z.string().describe("The item's name (1-80 characters, trimmed)."),
        category: z
          .string()
          .nullable()
          .optional()
          .describe("Optional category (at most 40 characters), e.g. Kleidung, Technik, Dokumente."),
      }),
    )
    .min(1)
    .max(MAX_PACKING_ITEMS_PER_CALL)
    .describe(`1-${MAX_PACKING_ITEMS_PER_CALL} items.`),
  dayId: idSchema.optional().describe("Also link every item to this day (id from get_trip)."),
});

const updateInput = z.object({
  tripId: tripIdField,
  itemId: itemIdField,
  updatedAt: z.iso
    .datetime({ offset: true, error: "Use the ISO 8601 updatedAt from the read" })
    .describe("The item's updatedAt (ISO 8601) exactly as get_packing_list returned it."),
  name: z.string().optional().describe("New name (1-80 characters); must not be another item's name."),
  category: z
    .string()
    .nullable()
    .optional()
    .describe("New category (at most 40 characters); null or an empty string removes it."),
  packed: z.boolean().optional().describe("true = ticked off as packed."),
  addDayIds: dayIdsField.optional().describe("Days to link the item to (ids from get_trip)."),
  removeDayIds: dayIdsField.optional().describe("Days to unlink the item from."),
});

const deleteInput = z.object({ tripId: tripIdField, itemId: itemIdField });

const capSubject = (text: string) => [...text].slice(0, MAX_SUBJECT_LENGTH).join("") || null;

/**
 * The hook that records one packing change, in the write's transaction (`recordChange`'s packing twin).
 * The subject is read from the transaction, after the write. The id is reset on every run: a write that
 * lost a race reruns its whole transaction, hook included.
 */
const recordPackingChange = (
  caller: Caller,
  action: AiChangeAction,
  tripDayId: string | null,
  subjectOf: (tx: TransactionClient, receipt: PackingChangeReceipt) => Promise<string | null>,
) => {
  let id: string | null = null;
  const hook: PackingInTransactionHook = async (tx, outcome) => {
    id = null;
    const subject = await subjectOf(tx, outcome.receipt);
    id = await insertAiChangeInTransaction(tx, {
      tripId: caller.tripId,
      tripDayId,
      userId: caller.userId,
      clientId: caller.clientId,
      action,
      subject: subject?.trim() || null,
      receipt: outcome.receipt,
      requireReceipt: true,
    });
  };
  return { hook, id: () => id };
};

/** The names of the items the receipt touched, as stored after the write, in the receipt's order. */
const storedNamesOf = async (tx: TransactionClient, receipt: PackingChangeReceipt) => {
  const ids = receipt.entries.map((entry) => (entry.change === "created" ? entry.itemId : entry.before.id));
  const rows = await tx.packingItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((itemId) => byId.get(itemId)).filter((name): name is string => name !== undefined);
};

const packingErrorResult = (error: unknown): CallToolResult => {
  if (error instanceof ChangedSinceReadError) return toolError(PACKING_CHANGED_SINCE_READ);
  if (error instanceof UnstorableReceiptError) return toolError(UNSTORABLE_RECEIPT);
  return writeErrorResult(error);
};

const firstMessage = (error: z.ZodError) => error.issues[0]?.message ?? "invalid";

export const registerPackingTools = (server: McpServer) => {
  server.registerTool(
    "get_packing_list",
    {
      title: "Read the trip's packing list",
      description:
        "Returns the trip's shared packing list, sorted by name: per item id, name, category (or null), packed " +
        "(ticked off), dayIds (the days the item is needed on, in day order), updatedAt and aiChangedAt (ISO " +
        "8601; aiChangedAt is set while the last change came through this connector). Give dayId for one day's " +
        "items only. There are no quantities. Pass an item's updatedAt to update_packing_item.",
      inputSchema: getInput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "get_packing_list", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        if (args.dayId !== undefined && !(await isPlannerDayOfTrip({ userId, tripId: args.tripId, tripDayId: args.dayId }))) {
          return toolError(DAY_NOT_FOUND);
        }
        const list = await listPackingItemsForTrip({ userId, tripId: args.tripId });
        if (!list) return toolError(TRIP_NOT_FOUND);
        const items =
          args.dayId === undefined ? list.items : list.items.filter((item) => item.days.some((day) => day.id === args.dayId));
        return toolResult({ items: items.map(toPackingItem) });
      }),
  );

  server.registerTool(
    "add_packing_items",
    {
      title: "Add items to the packing list",
      description:
        `Adds 1-${MAX_PACKING_ITEMS_PER_CALL} items to the trip's shared packing list, each with a name (1-80 ` +
        "characters) and an optional category (at most 40). Names are unique per trip ignoring case: a name " +
        "that exists resolves to that item (status existed; its category and packed state stay), so this " +
        "never makes a duplicate. There are no quantities. With dayId every item is also linked to that day " +
        "(the things the day needs). One invalid item refuses the whole call. Returns results (one per input: " +
        "name, itemId, status created or existed), items (as get_packing_list shows them) and aiChangeId (null " +
        "when nothing was written). Undo with undo_ai_change.",
      inputSchema: addInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "add_packing_items", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;

        const items: { name: string; category: string | null | undefined }[] = [];
        for (const [index, input] of args.items.entries()) {
          const name = nameField.safeParse(input.name);
          if (!name.success) return toolError(`items[${index}]: ${firstMessage(name.error)}.`);
          const category = input.category === undefined ? undefined : categoryField.safeParse(input.category);
          if (category && !category.success) return toolError(`items[${index}]: ${firstMessage(category.error)}.`);
          items.push({ name: name.data, category: category?.data });
        }

        const change = recordPackingChange(caller, "packingAdded", args.dayId ?? null, async (tx, receipt) =>
          capSubject((await storedNamesOf(tx, receipt)).join(", ")),
        );
        let result;
        try {
          result = await addPackingItemsForConnector({
            userId,
            tripId: args.tripId,
            items,
            tripDayId: args.dayId,
            inTransaction: change.hook,
          });
        } catch (error) {
          return packingErrorResult(error);
        }
        if (result.status === "not_found") return toolError(TRIP_NOT_FOUND);
        if (result.status === "day_missing") return toolError(DAY_NOT_FOUND);

        return toolResult({
          aiChangeId: result.written ? change.id() : null,
          results: result.results.map((entry, index) => ({
            name: args.items[index].name,
            itemId: entry.itemId,
            status: entry.status,
          })),
          items: result.items.map(toPackingItem),
        });
      }),
  );

  server.registerTool(
    "update_packing_item",
    {
      title: "Change a packing item",
      description:
        "Changes one packing item: name (must not be another item's name, ignoring case), category (null or an " +
        "empty string removes it), packed (tick off or untick), and the days it is linked to (addDayIds, " +
        "removeDayIds). Only the given fields change. Pass the item's updatedAt exactly as get_packing_list " +
        "returned it: if the item changed since, nothing is written. Returns aiChangeId (null when nothing " +
        "changed) and the item as get_packing_list shows it. Undo with undo_ai_change.",
      inputSchema: updateInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "update_packing_item", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;

        if (
          args.name === undefined &&
          args.category === undefined &&
          args.packed === undefined &&
          (args.addDayIds ?? []).length === 0 &&
          (args.removeDayIds ?? []).length === 0
        ) {
          return toolError(NOTHING_TO_CHANGE);
        }
        const removing = new Set(args.removeDayIds ?? []);
        if ((args.addDayIds ?? []).some((dayId) => removing.has(dayId))) return toolError(DAY_IN_BOTH);

        let name: string | undefined;
        if (args.name !== undefined) {
          const parsed = nameField.safeParse(args.name);
          if (!parsed.success) return toolError(`${firstMessage(parsed.error)}.`);
          name = parsed.data;
        }
        let category: string | null | undefined;
        if (args.category !== undefined) {
          const parsed = categoryField.safeParse(args.category);
          if (!parsed.success) return toolError(`${firstMessage(parsed.error)}.`);
          category = parsed.data;
        }

        const change = recordPackingChange(caller, "packingUpdated", null, async (tx, receipt) =>
          (await storedNamesOf(tx, receipt))[0] ?? null,
        );
        let result;
        try {
          result = await updatePackingItemForConnector({
            userId,
            tripId: args.tripId,
            itemId: args.itemId,
            expectedUpdatedAt: new Date(args.updatedAt),
            name,
            category,
            packed: args.packed,
            addDayIds: args.addDayIds,
            removeDayIds: args.removeDayIds,
            inTransaction: change.hook,
          });
        } catch (error) {
          return packingErrorResult(error);
        }
        switch (result.status) {
          case "not_found":
            return toolError(TRIP_NOT_FOUND);
          case "missing":
            return toolError(PACKING_ITEM_NOT_FOUND);
          case "day_missing":
            return toolError(DAY_NOT_FOUND);
          case "duplicate_name":
            return toolError(`A packing item named "${name ?? args.name}" already exists.`);
          case "unchanged":
            return toolResult({ aiChangeId: null, item: toPackingItem(result.item) });
          case "updated":
            return toolResult({ aiChangeId: change.id(), item: toPackingItem(result.item) });
          default: {
            const unhandled: never = result;
            throw new Error(`Unhandled update result: ${String(unhandled)}`);
          }
        }
      }),
  );

  server.registerTool(
    "delete_packing_item",
    {
      title: "Delete a packing item",
      description:
        "Deletes one item from the trip's packing list. This also removes it from every day it is linked to " +
        "(dayIds in get_packing_list), so confirm with the user first, naming those days. Returns aiChangeId " +
        "and deleted (id, name, dayCount = how many days it was removed from). Undo with undo_ai_change.",
      inputSchema: deleteInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "delete_packing_item", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;

        const change = recordPackingChange(caller, "packingDeleted", null, async (_tx, receipt) => {
          const [entry] = receipt.entries;
          return entry && entry.change === "deleted" ? entry.before.name : null;
        });
        let result;
        try {
          result = await deletePackingItemForConnector({
            userId,
            tripId: args.tripId,
            itemId: args.itemId,
            inTransaction: change.hook,
          });
        } catch (error) {
          return packingErrorResult(error);
        }
        if (result.status === "not_found") return toolError(TRIP_NOT_FOUND);
        if (result.status === "missing") return toolError(PACKING_ITEM_NOT_FOUND);
        return toolResult({
          aiChangeId: change.id(),
          deleted: { id: result.id, name: result.name, dayCount: result.dayCount },
        });
      }),
  );
};
