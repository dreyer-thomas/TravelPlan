import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { costField, resolveCost, type ResolvedCostFields } from "@/lib/mcp/costInput";
import { toolError } from "@/lib/mcp/logging";
import { toDateKey } from "@/lib/mcp/plannerShapes";
import {
  DAY_NOT_FOUND,
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  runTool,
  toolResult,
  TRIP_NOT_FOUND,
} from "@/lib/mcp/toolRuntime";
import {
  COST_FIELD_NOTE,
  isCaller,
  linkField,
  lookUpPlace,
  placeField,
  readDay,
  recordChange,
  startWrite,
  timeField,
  tripIdField,
  writeErrorResult,
  type Caller,
  type ResolvedLocation,
} from "@/lib/mcp/tools/activityWrite";
import {
  createAccommodationForTripDay,
  deleteAccommodationForTripDay,
  updateAccommodationForTripDay,
} from "@/lib/repositories/accommodationRepo";
import { UnstorableReceiptError } from "@/lib/repositories/aiChangeRepo";
import { findStayForPlanner, type PlannerStayRow } from "@/lib/repositories/connectorReadRepo";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";
import { accommodationMutationSchema } from "@/lib/validation/accommodationSchemas";

/**
 * Story 15.6. The connector's stay writes, on the 15.4 rails: `startWrite` (writers only, `Trip not found`
 * otherwise), the app's `accommodationMutationSchema` before every write, `origin: "ai"` (the badge), and
 * the `inTransaction` hook that records one `ai_changes` row with the connector-only receipt
 * (`stayCreated`, `stayUpdated`, `stayDeleted`) in the write's own transaction.
 *
 * `set_stay` creates the night's stay when the day has none (never upserting over one that appeared since
 * the read: `expectNoStay`) and otherwise changes only the fields given, checked against the `updatedAt` the
 * model read. A different resolved check-out recomputes the next day exactly as the app does, and the
 * result then carries that day too. `delete_stay` deletes as the app does: the referencing legs on every day
 * go with it, the image and document rows by cascade, the files stay on disk, and the next day is not
 * recomputed.
 */

const STAY_CHANGED =
  "This stay changed since you read it; read the day again with get_day and retry with the stay's new updatedAt.";
const NO_STAY_TO_UPDATE = "This day has no stay; leave out updatedAt to create one.";
const STAY_NEEDS_UPDATED_AT = "This day already has a stay; pass its updatedAt from get_day to change it.";
const NAME_REQUIRED = "name is required to create a stay.";
const NO_STAY = "This day has no stay.";
const NOTHING_TO_CHANGE = "Nothing to change.";
const UNSTORABLE_RECEIPT = "This stay holds data the undo cannot keep, so nothing was written.";

const updatedAtField = z.iso
  .datetime({ offset: true, error: "Use the ISO 8601 updatedAt from the read" })
  .describe("The stay's updatedAt (ISO 8601) exactly as get_day returned it.");

const setInput = z.object({
  tripId: tripIdField,
  dayId: idSchema.describe("The day's id, from get_trip: the stay is that night's."),
  updatedAt: updatedAtField
    .optional()
    .describe("The stay's updatedAt exactly as get_day returned it; required to change a stay, left out to create one."),
  name: z.string().trim().min(1).max(200).optional().describe("The stay's name; required to create one."),
  status: z.enum(["planned", "booked"]).optional().describe("planned (default for a new stay) or booked."),
  checkInTime: timeField.nullable().optional().describe("Check-in as HH:MM (24-hour), or null to remove it."),
  checkOutTime: timeField
    .nullable()
    .optional()
    .describe(
      "Check-out as HH:MM (24-hour), or null for the default 10:00. It is when the next day starts; changing " +
        "an existing stay's check-out recomputes the next day as in the app, creating a stay does not.",
    ),
  place: placeField
    .nullable()
    .optional()
    .describe("Where it is. A name alone is looked up on OpenStreetMap; give lat and lng to skip the lookup. null removes it."),
  link: linkField.nullable().optional().describe("A web link (http or https), e.g. the booking; null removes it."),
  cost: costField
    .nullable()
    .optional()
    .describe(`The price of the night(s): ${COST_FIELD_NOTE} null removes the cost and its payments.`),
  notes: z.string().max(1000).nullable().optional().describe("Plain-text notes, at most 1000 characters; null removes them."),
});

const deleteInput = z.object({
  tripId: tripIdField,
  dayId: idSchema.describe("The day's id, from get_trip."),
  updatedAt: updatedAtField,
});

type SetArgs = z.infer<typeof setInput>;

const invalidStay = (issues: { message: string }[]) =>
  toolError(`Invalid stay: ${[...new Set(issues.map((issue) => issue.message))].join("; ")}.`);

const isToolResult = (value: object): value is CallToolResult => "content" in value;

/** The stored day and its stay, or the tool error that says why there is none. */
const findStay = async (caller: Caller, tripDayId: string) => {
  const found = await findStayForPlanner({ userId: caller.userId, tripId: caller.tripId, tripDayId });
  if (!found) return toolError(TRIP_NOT_FOUND);
  return found.day ?? toolError(DAY_NOT_FOUND);
};

/**
 * The stay errors the model can act on; anything else is runTool's generic error. Every stay write requires
 * a storable receipt (a delete takes the stay's media rows and legs, and its undo is the only way back), so
 * one the undo could not read rolls the write back.
 */
const stayWriteErrorResult = (error: unknown): CallToolResult => {
  if (error instanceof ChangedSinceReadError) return toolError(STAY_CHANGED);
  if (error instanceof UnstorableReceiptError) return toolError(UNSTORABLE_RECEIPT);
  return writeErrorResult(error);
};

const toInputStatus = (status: PlannerStayRow["status"]) => (status === "BOOKED" ? ("booked" as const) : ("planned" as const));

/**
 * The stored cost, for a change that does not give one: passed to the repository unchanged (`payments: null`
 * keeps the stored rows) and left out of the validation, so a stored stay the payment rule would refuse today
 * does not block an edit of its name, as for activities.
 */
const storedMoney = (stay: PlannerStayRow) => ({
  costCents: stay.costCents,
  costOriginalAmount: stay.costOriginalAmount,
  costCurrency: stay.costCurrency,
  costRate: stay.costRate,
  costRateDate: stay.costRateDate,
  payments: null,
});

const givenMoney = (fields: ResolvedCostFields) => ({
  costCents: fields.costCents,
  costOriginalAmount: fields.costOriginalAmount,
  costCurrency: fields.costCurrency,
  costRate: fields.costRate,
  costRateDate: fields.costRateDate,
  payments: fields.payments,
});

/** The fields `set_stay` changes on an existing stay (anything but the ids). */
const changesSomething = (args: SetArgs) =>
  [args.name, args.status, args.checkInTime, args.checkOutTime, args.place, args.link, args.cost, args.notes].some(
    (value) => value !== undefined,
  );

const stayResult = async (caller: Caller, aiChangeId: string | null, tripDayId: string, nextDayId: string | null) => {
  const day = await readDay(caller.userId, caller.tripId, tripDayId);
  return toolResult({
    aiChangeId,
    stay: day?.stay ?? null,
    day,
    ...(nextDayId ? { nextDay: await readDay(caller.userId, caller.tripId, nextDayId) } : {}),
  });
};

export const registerStayWriteTools = (server: McpServer) => {
  server.registerTool(
    "set_stay",
    {
      title: "Set the night's stay",
      description:
        "Creates or changes the stay of a day (that night's accommodation). Without a stay on the day it is " +
        "created: name is required, status defaults to planned, and updatedAt must be left out. With a stay, " +
        "pass its updatedAt exactly as get_day returned it; only the fields given change, and if the stay " +
        "changed since, nothing is written. Times as HH:MM; place by name is looked up, or give lat and lng; " +
        "notes are plain text. Changing an existing stay's check-out recomputes the next day as in the app " +
        "(its flexible activities start then); creating a stay does not recompute anything, as in the app. Returns aiChangeId, the stay and the day as get_day shows them, and nextDay " +
        "when the next day was recomputed. The change can be undone with undo_ai_change.",
      inputSchema: setInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "set_stay", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const day = await findStay(caller, args.dayId);
        if (isToolResult(day)) return day;
        const { stay } = day;
        if (!stay) {
          if (args.updatedAt !== undefined) return toolError(NO_STAY_TO_UPDATE);
          if (args.name === undefined) return toolError(NAME_REQUIRED);
        } else {
          if (args.updatedAt === undefined) return toolError(STAY_NEEDS_UPDATED_AT);
          if (!changesSomething(args)) return toolError(NOTHING_TO_CHANGE);
        }

        let money: ResolvedCostFields | null = null;
        if (args.cost !== undefined) {
          const resolved = await resolveCost(args.cost, { dueDateDefault: toDateKey(day.date) });
          if ("refusal" in resolved) return toolError(resolved.refusal);
          money = resolved.fields;
        }

        // The given fields over the stored ones; a create starts from nothing.
        const pick = <T>(given: T | undefined, stored: T) => (given !== undefined ? given : stored);
        const payload = (location: ResolvedLocation) => ({
          tripDayId: day.id,
          name: args.name ?? stay?.name ?? "",
          status: args.status ?? (stay ? toInputStatus(stay.status) : ("planned" as const)),
          link: pick(args.link, stay?.link ?? null),
          notes: pick(args.notes, stay?.notes ?? null),
          checkInTime: pick(args.checkInTime, stay?.checkInTime ?? null),
          checkOutTime: pick(args.checkOutTime, stay?.checkOutTime ?? null),
          location,
          ...(money ? givenMoney(money) : {}),
        });

        let location: ResolvedLocation = stay?.location ?? null;
        if (args.place !== undefined) {
          // A save the schema would refuse anyway does not take a geocoder slot first.
          if (args.place !== null && (args.place.lat === undefined || args.place.lng === undefined)) {
            const precheck = accommodationMutationSchema.safeParse(payload(null));
            if (!precheck.success) return invalidStay(precheck.error.issues);
          }
          const place = await lookUpPlace(args.place);
          if ("refusal" in place) return toolError(place.refusal);
          location = place.location;
        }
        const parsed = accommodationMutationSchema.safeParse(payload(location));
        if (!parsed.success) return invalidStay(parsed.error.issues);
        const fields = {
          userId,
          tripId: args.tripId,
          tripDayId: day.id,
          name: parsed.data.name,
          status: parsed.data.status,
          link: parsed.data.link ?? null,
          notes: parsed.data.notes?.trim() || null,
          location,
          ...(money ? givenMoney(money) : stay ? storedMoney(stay) : {}),
          origin: "ai" as const,
        };

        if (!stay) {
          const change = recordChange(caller, "stayCreated", day.id, parsed.data.name, { requireReceipt: true });
          let created;
          try {
            created = await createAccommodationForTripDay({
              ...fields,
              checkInTime: parsed.data.checkInTime ?? null,
              checkOutTime: parsed.data.checkOutTime ?? null,
              expectNoStay: true,
              inTransaction: change.hook,
            });
          } catch (error) {
            return stayWriteErrorResult(error);
          }
          if (!created) return toolError(DAY_NOT_FOUND);
          return stayResult(caller, change.id(), day.id, null);
        }

        const change = recordChange(caller, "stayUpdated", day.id, parsed.data.name, { requireReceipt: true });
        let updated;
        try {
          updated = await updateAccommodationForTripDay({
            ...fields,
            // Only a given time is written: an absent check-out never recomputes the next day.
            ...(args.checkInTime !== undefined ? { checkInTime: parsed.data.checkInTime ?? null } : {}),
            ...(args.checkOutTime !== undefined ? { checkOutTime: parsed.data.checkOutTime ?? null } : {}),
            expectedUpdatedAt: new Date(args.updatedAt!),
            inTransaction: change.hook,
          });
        } catch (error) {
          return stayWriteErrorResult(error);
        }
        if (updated.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (updated.status === "missing") return toolError(STAY_CHANGED);
        // The route's receipt names the pushed next day when the check-out recompute ran.
        return stayResult(caller, change.id(), day.id, updated.receipt?.tripDayId ?? null);
      }),
  );

  server.registerTool(
    "delete_stay",
    {
      title: "Delete the night's stay",
      description:
        "Deletes the stay of a day, as the app does: the travel legs into and out of it go with it, and so do " +
        "its documents and images; the next day is not recomputed. Pass the stay's updatedAt exactly as get_day " +
        "returned it: if it changed since, nothing is deleted. Returns aiChangeId, deletedStayId and the day as " +
        "get_day shows it. The delete can be undone with undo_ai_change.",
      inputSchema: deleteInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "delete_stay", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const day = await findStay(caller, args.dayId);
        if (isToolResult(day)) return day;
        if (!day.stay) return toolError(NO_STAY);
        const change = recordChange(caller, "stayDeleted", day.id, day.stay.name, { requireReceipt: true });
        let deleted;
        try {
          deleted = await deleteAccommodationForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: day.id,
            expectedUpdatedAt: new Date(args.updatedAt),
            inTransaction: change.hook,
          });
        } catch (error) {
          return stayWriteErrorResult(error);
        }
        if (!deleted) return toolError(DAY_NOT_FOUND);
        return toolResult({
          aiChangeId: change.id(),
          deletedStayId: day.stay.id,
          day: await readDay(userId, args.tripId, day.id),
        });
      }),
  );
};
