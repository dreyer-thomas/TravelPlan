import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toolError } from "@/lib/mcp/logging";
import { DAY_NOT_FOUND, idSchema, runTool, toolResult, WRITE_TOOL_ANNOTATIONS } from "@/lib/mcp/toolRuntime";
import {
  DAY_CHANGED_SINCE_READ,
  isCaller,
  readDay,
  recordChange,
  startWrite,
  tripIdField,
  writeErrorResult,
} from "@/lib/mcp/tools/activityWrite";
import { UnstorableReceiptError } from "@/lib/repositories/aiChangeRepo";
import { updateDayNoteForConnector } from "@/lib/repositories/connectorDayRepo";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";
import { dayNoteSchema } from "@/lib/validation/dayImageSchemas";

/**
 * Story 15.9. The connector's write to the day's own note, on the 15.4 rails: `startWrite` (writers only,
 * `Trip not found` otherwise), the dialog's own note rule (`dayNoteSchema`: trimmed, at most 280
 * characters), checked against the day's `updatedAt` the model read, and one `ai_changes` row with the
 * `dayDetailsChanged` receipt in the write's own transaction. It sets the day's KI/AI marker and never touches
 * the day's picture, which the file tools change (`attach_file` / `delete_file` with the day as target).
 */

const NOTE_TOO_LONG = "note must be at most 280 characters";
const UNSTORABLE_RECEIPT = "This day holds data the undo cannot keep, so nothing was written.";
/** The longest `subject` a note change stores, in code points. */
const MAX_SUBJECT_LENGTH = 120;

const updateDayInput = z.object({
  tripId: tripIdField,
  dayId: idSchema.describe("The day's id, from get_trip or get_day."),
  // No length cap here: `dayNoteSchema` answers the 280 rule after trimming, with the text AC 3 names.
  note: z
    .string()
    .nullable()
    .describe("The day's one-line note (at most 280 characters, trimmed); an empty string or null removes it."),
  updatedAt: z.iso
    .datetime({ offset: true, error: "Use the ISO 8601 updatedAt from the read" })
    .describe("The day's updatedAt (ISO 8601) exactly as get_day returned it."),
});

const subjectOf = (text: string | null) => (text ? [...text].slice(0, MAX_SUBJECT_LENGTH).join("") : null);

const dayWriteErrorResult = (error: unknown): CallToolResult => {
  if (error instanceof ChangedSinceReadError) return toolError(DAY_CHANGED_SINCE_READ);
  if (error instanceof UnstorableReceiptError) return toolError(UNSTORABLE_RECEIPT);
  return writeErrorResult(error);
};

export const registerDayWriteTools = (server: McpServer) => {
  server.registerTool(
    "update_day",
    {
      title: "Change the day's note",
      description:
        "Sets or removes the day's own note, the one-line summary shown with the day's title (at most 280 " +
        "characters; an empty string or null removes it). Pass the day's updatedAt exactly as get_day returned " +
        "it: if the day changed since, nothing is written. The day's picture is not changed here; use " +
        "attach_file with target day, or delete_file with the picture's id. Returns aiChangeId (null when the " +
        "note was already that) and the day as get_day shows it. The change can be undone with undo_ai_change.",
      inputSchema: updateDayInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "update_day", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        let note: string | null = null;
        if (args.note !== null) {
          const parsed = dayNoteSchema.safeParse(args.note);
          if (!parsed.success) return toolError(NOTE_TOO_LONG);
          note = parsed.data || null;
        }

        // The subject is the new note, or the one cleared: known only from the day read in the transaction.
        let change: ReturnType<typeof recordChange> | null = null;
        let result;
        try {
          result = await updateDayNoteForConnector({
            userId,
            tripId: args.tripId,
            dayId: args.dayId,
            note,
            expectedUpdatedAt: new Date(args.updatedAt),
            inTransaction: async (tx, outcome) => {
              const previous = outcome.receipt?.edited.kind === "dayDetailsChanged" ? outcome.receipt.edited.previous.note : null;
              change = recordChange(caller, "dayNoteChanged", args.dayId, subjectOf(note ?? previous?.trim() ?? null), {
                requireReceipt: true,
              });
              await change.hook(tx, outcome);
            },
          });
        } catch (error) {
          return dayWriteErrorResult(error);
        }
        if (!result) return toolError(DAY_NOT_FOUND);

        return toolResult({
          aiChangeId: (change as ReturnType<typeof recordChange> | null)?.id() ?? null,
          day: await readDay(userId, args.tripId, args.dayId),
        });
      }),
  );
};
