import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toolError } from "@/lib/mcp/logging";
import {
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  READ_ONLY_TOOL_ANNOTATIONS,
  requireWritableTrip,
  runTool,
  toolResult,
} from "@/lib/mcp/toolRuntime";
import { listAiChangesForTrip, undoAiChange, type AiChangeEntry } from "@/lib/repositories/aiChangeRepo";

/**
 * Story 15.4. The connector's own change log: what it changed in a trip in the last 14 days, and the undo
 * of one change through the same core the app's *Undo* uses (stale rule unchanged). Any writer of the
 * trip may undo any of its changes, as in the app.
 */

export const AI_CHANGE_NOT_FOUND = "AI change not found";
export const AI_CHANGE_STALE = "The day has changed since this change was made; it can no longer be undone.";

const SUMMARIES: Record<string, (subject: string) => string> = {
  created: (subject) => `Created activity ${subject}`,
  updated: (subject) => `Updated activity ${subject}`,
  deleted: (subject) => `Deleted activity ${subject}`,
  moved: (subject) => `Moved activity ${subject} within its day`,
  parked: (subject) => `Moved activity ${subject} to the bucket list`,
  scheduled: (subject) => `Scheduled activity ${subject} onto a day`,
  // Story 15.5. The subject is the plan's titles, joined.
  planAppended: (subject) => `Added a day plan: ${subject}`,
  planReplaced: (subject) => `Replaced the day plan with ${subject}`,
};

/** The English one-liner from `action` + `subject`, e.g. `Created activity "Louvre"`. */
export const summarizeAiChange = (entry: Pick<AiChangeEntry, "action" | "subject">) => {
  const subject = entry.subject ? `"${entry.subject}"` : "(untitled)";
  return (SUMMARIES[entry.action] ?? ((value: string) => `Changed activity ${value}`))(subject);
};

const hostOf = (clientId: string) => {
  try {
    return new URL(clientId).host || null;
  } catch {
    return null;
  }
};

const listInput = z.object({
  tripId: idSchema.describe("The trip's id, from list_trips."),
  dayId: idSchema.optional().describe("Only the changes of this day (id from get_trip)."),
});

const undoInput = z.object({
  tripId: idSchema.describe("The trip's id, from list_trips."),
  changeId: idSchema.describe("The change's id: aiChangeId from a write tool, or id from list_ai_changes."),
});

/** The newest changes `list_ai_changes` returns, so a busy fortnight does not flood the model's context. */
const LIST_LIMIT = 100;

export const registerAiChangeTools = (server: McpServer) => {
  server.registerTool(
    "list_ai_changes",
    {
      title: "List AI changes to a trip",
      description:
        "Lists the changes made to a trip through this connector in the last 14 days, newest first, by any " +
        "connected app of any trip member: id, dayId (null for the bucket list), action (created, updated, " +
        "deleted, moved, parked, scheduled, planAppended, planReplaced), subject (the activity's title, or a " +
        "day plan's titles joined by commas), summary (one English line), " +
        "createdAt and undoneAt (ISO 8601; undoneAt null = not undone), undoable (undo_ai_change can be tried) " +
        "and clientHost (the app that made it). At most the newest 100; truncated is true when there are more. " +
        "Give dayId for one day's changes only.",
      inputSchema: listInput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "list_ai_changes", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        const listed = await listAiChangesForTrip({
          tripId: args.tripId,
          tripDayId: args.dayId,
          now: new Date(),
          take: LIST_LIMIT + 1,
        });
        const entries = listed.slice(0, LIST_LIMIT);
        return toolResult({
          truncated: listed.length > LIST_LIMIT,
          changes: entries.map((entry) => ({
            id: entry.id,
            dayId: entry.tripDayId,
            action: entry.action,
            subject: entry.subject,
            summary: summarizeAiChange(entry),
            createdAt: entry.createdAt.toISOString(),
            undoneAt: entry.undoneAt ? entry.undoneAt.toISOString() : null,
            undoable: entry.hasReceipt && entry.undoneAt === null,
            clientHost: hostOf(entry.clientId),
          })),
        });
      }),
  );

  server.registerTool(
    "undo_ai_change",
    {
      title: "Undo an AI change",
      description:
        "Undoes one change made through this connector (aiChangeId from a write tool, or an id from " +
        "list_ai_changes), restoring the day as it was before, as the app's Undo does. Refused when the day has " +
        "changed since in a way the undo would overwrite, when the change is already undone, or when it cannot " +
        "be undone (bucket-list creates, edits and deletes). Undo changes newest first.",
      inputSchema: undoInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "undo_ai_change", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        const result = await undoAiChange({ userId, tripId: args.tripId, changeId: args.changeId, now: new Date() });
        switch (result.status) {
          case "undone":
            return toolResult({ undone: true, changeId: args.changeId });
          case "not_found":
            return toolError(AI_CHANGE_NOT_FOUND);
          case "already_undone":
            return toolError("This AI change is already undone.");
          case "unavailable":
            return toolError("This AI change cannot be undone.");
          case "stale":
            return toolError(AI_CHANGE_STALE);
          default: {
            const unhandled: never = result;
            throw new Error(`Unhandled undo status: ${String(unhandled)}`);
          }
        }
      }),
  );
};
