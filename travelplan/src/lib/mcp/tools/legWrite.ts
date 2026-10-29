import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GeoPoint } from "@/lib/geo/distance";
import { toolError } from "@/lib/mcp/logging";
import {
  DAY_NOT_FOUND,
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  runTool,
  toolResult,
  TRIP_NOT_FOUND,
  WRITE_TOOL_ANNOTATIONS,
} from "@/lib/mcp/toolRuntime";
import {
  isCaller,
  linkField,
  readDay,
  recordChange,
  startWrite,
  tripIdField,
  writeErrorResult,
  type Caller,
} from "@/lib/mcp/tools/activityWrite";
import { routeLeg } from "@/lib/mcp/tools/dayPlanApply";
import { UnstorableReceiptError } from "@/lib/repositories/aiChangeRepo";
import { findLegForPlanner, findStayForPlanner, type PlannerLegRow } from "@/lib/repositories/connectorReadRepo";
import { readDayPlanContextForWriter } from "@/lib/repositories/dayPlanApplyRepo";
import {
  createTravelSegmentForTripDay,
  deleteTravelSegmentForTripDay,
  updateTravelSegmentForTripDay,
} from "@/lib/repositories/travelSegmentRepo";
import { SUGGESTION_MODE_ROUTING } from "@/lib/trips/suggestionPlan";
import {
  TRANSPORT_TYPES,
  transportTypeAllowsDistance,
  transportTypeRequiresDistance,
  type TransportType,
} from "@/lib/trips/transportTypes";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";
import { travelSegmentMutationSchema } from "@/lib/validation/travelSegmentSchemas";

/**
 * Story 15.6. The connector's single travel legs, on the 15.4 rails: `startWrite`, the app's
 * `travelSegmentMutationSchema`, `origin: "ai"`, and the hook that records one `ai_changes` row with the
 * leg's receipt (`legCreated`, `legUpdated`, `legDeleted`, the kinds the app's leg saves already return)
 * in the write's own transaction. Each save recomputes the leg's day as in the app.
 *
 * A leg joins two consecutive entries of a day: last night's stay, the activities in order, tonight's stay.
 * `create_leg` checks that against the day it read before routing (the repository checks it again inside
 * the transaction), and fills a missing duration, or a car's missing distance, with 15.5's `routeLeg`
 * between two points with coordinates. A leg that still lacks them is refused, never stored. The endpoints
 * of a leg are fixed: `update_leg` changes how it is travelled, never what it joins.
 */

const LEG_NOT_FOUND = "Leg not found";
const ENTRY_NOT_FOUND = "Entry not found on this day";
const NOT_ADJACENT =
  "A leg connects two consecutive entries of the day: last night's stay, the activities in order, tonight's stay.";
const LEG_CHANGED =
  "This leg changed since you read it; read the day again with get_day and retry with the leg's new updatedAt.";
const LEG_NOT_DRAWN =
  "This leg's two entries are no longer next to each other on the day, so it cannot be changed; delete it with delete_leg.";
const PAIR_TAKEN = "These two entries already have a leg; read the day again with get_day and change it with update_leg.";
const NEEDS_DURATION = {
  notRoutable: "Give durationMinutes: a route is only computed for car, walking and cycling legs.",
  noCoordinates: "Give durationMinutes: a route needs both entries with coordinates (a place with lat and lng).",
  failed: "Give durationMinutes: the route could not be computed.",
} as const;
const CAR_NEEDS_DISTANCE = "A car leg needs distanceKm, and it could not be computed; give distanceKm.";
const NOTHING_TO_CHANGE = "Nothing to change.";
const LEG_ENDPOINT_GONE =
  "This leg no longer connects two entries of the day (an endpoint was removed or moved); delete it with delete_leg.";
const CAR_LEG_NEEDS_DISTANCE = "A car leg needs distanceKm; give it.";
const UNSTORABLE_RECEIPT = "This leg holds data the undo cannot keep, so nothing was written.";

/** The longest `subject` a leg's change stores. */
const MAX_SUBJECT_LENGTH = 120;

const updatedAtField = z.iso
  .datetime({ offset: true, error: "Use the ISO 8601 updatedAt from the read" })
  .describe("The leg's updatedAt (ISO 8601) exactly as get_day returned it.");

const endpointField = z.object({
  type: z.enum(["stay", "activity"]).describe("stay: last night's or tonight's stay; activity: an activity of the day."),
  id: idSchema.describe("The stay's or activity's id, from get_day (last night's stay is previousStay)."),
});

const modeField = z.enum(TRANSPORT_TYPES).describe("How the leg is travelled.");
const durationField = z.number().int().positive().describe("Travel time in minutes.");
const distanceField = z.number().positive().describe("Distance in kilometres; required for car, not allowed for ship or flight.");

const createInput = z.object({
  tripId: tripIdField,
  dayId: idSchema.describe("The day's id, from get_trip."),
  from: endpointField.describe("Where the leg starts."),
  to: endpointField.describe("Where it ends: the entry right after from on the day."),
  mode: modeField,
  durationMinutes: durationField
    .optional()
    .describe("Travel time in minutes. Left out: computed for car, walking and cycling between places with coordinates."),
  distanceKm: distanceField
    .optional()
    .describe("Distance in kilometres; not for ship or flight. Left out: computed like durationMinutes."),
  link: linkField.optional().describe("A web link for the leg (http or https), e.g. a timetable."),
});

const updateInput = z.object({
  tripId: tripIdField,
  legId: idSchema.describe("The leg's id, from get_day."),
  updatedAt: updatedAtField,
  mode: modeField.optional(),
  durationMinutes: durationField.optional(),
  distanceKm: distanceField
    .nullable()
    .optional()
    .describe("Distance in kilometres, or null to remove it; a switch to ship or flight drops it."),
  link: linkField.nullable().optional().describe("A web link (http or https), or null to remove it."),
});

const deleteInput = z.object({
  tripId: tripIdField,
  legId: idSchema.describe("The leg's id, from get_day."),
  updatedAt: updatedAtField,
});

type Endpoint = z.infer<typeof endpointField>;
type PlannerDayShape = NonNullable<Awaited<ReturnType<typeof readDay>>>;

const toItemType = (type: Endpoint["type"]) => (type === "stay" ? ("accommodation" as const) : ("dayPlanItem" as const));
const fromStoredItemType = (type: PlannerLegRow["fromItemType"]) =>
  type === "ACCOMMODATION" ? ("accommodation" as const) : ("dayPlanItem" as const);
const fromStoredMode = (mode: PlannerLegRow["transportType"]) => mode.toLowerCase() as TransportType;

const invalidLeg = (issues: { message: string }[]) =>
  toolError(`Invalid leg: ${[...new Set(issues.map((issue) => issue.message))].join("; ")}.`);

/** Duck-typed so no Prisma import lands in a tool: the pair's unique index refused a second leg. */
const isPairTaken = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

const legErrorResult = (error: unknown): CallToolResult => {
  if (error instanceof ChangedSinceReadError) return toolError(LEG_CHANGED);
  if (isPairTaken(error)) return toolError(PAIR_TAKEN);
  if (error instanceof UnstorableReceiptError) return toolError(UNSTORABLE_RECEIPT);
  return writeErrorResult(error);
};

/** An entry's name on the day: the activity's title or the stay's name, "?" when untitled or unknown. */
const entryName = (day: PlannerDayShape | null, type: "accommodation" | "dayPlanItem", id: string) => {
  if (type === "dayPlanItem") return day?.activities.find((activity) => activity.id === id)?.title?.trim() || "?";
  if (day?.previousStay?.id === id) return day.previousStay.name.trim() || "?";
  if (day?.stay?.id === id) return day.stay.name.trim() || "?";
  return "?";
};

/** "<from> → <to>", capped by code point so an emoji at the cut is never split. */
const legSubject = (
  day: PlannerDayShape | null,
  from: { type: "accommodation" | "dayPlanItem"; id: string },
  to: { type: "accommodation" | "dayPlanItem"; id: string },
) => {
  const characters = Array.from(`${entryName(day, from.type, from.id)} → ${entryName(day, to.type, to.id)}`);
  return characters.length > MAX_SUBJECT_LENGTH
    ? `${characters.slice(0, MAX_SUBJECT_LENGTH - 1).join("")}…`
    : characters.join("");
};

const legResult = async (caller: Caller, aiChangeId: string | null, tripDayId: string, legId: string) => {
  const day = await readDay(caller.userId, caller.tripId, tripDayId);
  return toolResult({ aiChangeId, leg: day?.legs.find((leg) => leg.id === legId) ?? null, day });
};

/** The stored leg of the trip, or the tool error that says why there is none. */
const findLeg = async (caller: Caller, legId: string): Promise<PlannerLegRow | CallToolResult> => {
  const found = await findLegForPlanner({ userId: caller.userId, tripId: caller.tripId, legId });
  if (!found) return toolError(TRIP_NOT_FOUND);
  return found.leg ?? toolError(LEG_NOT_FOUND);
};

const isLeg = (value: PlannerLegRow | CallToolResult): value is PlannerLegRow => "tripDayId" in value;

export const registerLegWriteTools = (server: McpServer) => {
  server.registerTool(
    "create_leg",
    {
      title: "Add a travel leg",
      description:
        "Adds a travel leg between two consecutive entries of a day: last night's stay (previousStay in get_day), " +
        "the activities in their order, tonight's stay. from and to name them by type (stay or activity) and id. " +
        "A missing durationMinutes, or a car's missing distanceKm, is computed for car, walking and cycling " +
        "between entries with coordinates; when it cannot be, nothing is written and you are asked for it. " +
        "distanceKm is required for car and not allowed for ship or flight. Two entries have at most one leg. " +
        "The day is recomputed as in the app. Returns aiChangeId, the leg and the day as get_day shows them. " +
        "The leg can be removed again with undo_ai_change.",
      inputSchema: createInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "create_leg", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const [day, context, tonight] = await Promise.all([
          readDay(userId, args.tripId, args.dayId),
          readDayPlanContextForWriter({ userId, tripId: args.tripId, tripDayId: args.dayId }),
          findStayForPlanner({ userId, tripId: args.tripId, tripDayId: args.dayId }),
        ]);
        if (!day || !context) return toolError(DAY_NOT_FOUND);
        const tonightStay = tonight?.day?.stay ?? null;

        // The day's timeline as the repository reads it, with each entry's point, to refuse before routing.
        const timeline: { type: Endpoint["type"]; id: string; point: GeoPoint | null }[] = [
          ...(context.previousStay ? [{ type: "stay" as const, ...context.previousStay }] : []),
          ...day.activities.map((activity) => ({
            type: "activity" as const,
            id: activity.id,
            point: activity.place ? { lat: activity.place.lat, lng: activity.place.lng } : null,
          })),
          ...(tonightStay ? [{ type: "stay" as const, id: tonightStay.id, point: tonightStay.location }] : []),
        ];
        const indexOf = (endpoint: Endpoint) =>
          timeline.findIndex((entry) => entry.type === endpoint.type && entry.id === endpoint.id);
        const fromIndex = indexOf(args.from);
        const toIndex = indexOf(args.to);
        if (fromIndex < 0 || toIndex < 0) return toolError(ENTRY_NOT_FOUND);
        if (toIndex !== fromIndex + 1) return toolError(NOT_ADJACENT);
        const existing = day.legs.find(
          (leg) =>
            leg.from.type === args.from.type &&
            leg.from.id === args.from.id &&
            leg.to.type === args.to.type &&
            leg.to.id === args.to.id,
        );
        if (existing) return toolError(`These two entries already have a leg (${existing.id}); change it with update_leg.`);

        const fields = {
          tripDayId: day.id,
          fromItemType: toItemType(args.from.type),
          fromItemId: args.from.id,
          toItemType: toItemType(args.to.type),
          toItemId: args.to.id,
          transportType: args.mode,
          linkUrl: args.link ?? null,
        };
        // Everything but the measurements, checked before a route is asked for.
        const precheck = travelSegmentMutationSchema.safeParse({
          ...fields,
          durationMinutes: args.durationMinutes ?? 1,
          distanceKm: args.distanceKm ?? (transportTypeRequiresDistance(args.mode) ? 1 : null),
        });
        if (!precheck.success) return invalidLeg(precheck.error.issues);

        let durationMinutes = args.durationMinutes ?? null;
        let distanceKm = args.distanceKm ?? null;
        if (durationMinutes === null || (distanceKm === null && transportTypeRequiresDistance(args.mode))) {
          const from = timeline[fromIndex].point;
          const to = timeline[toIndex].point;
          const routable = args.mode in SUGGESTION_MODE_ROUTING;
          const routed = routable && from && to ? await routeLeg(args.mode, from, to) : null;
          if (routed) {
            durationMinutes ??= routed.durationMinutes;
            if (distanceKm === null && transportTypeAllowsDistance(args.mode)) distanceKm = routed.distanceKm;
          } else if (durationMinutes === null) {
            return toolError(
              !routable ? NEEDS_DURATION.notRoutable : !from || !to ? NEEDS_DURATION.noCoordinates : NEEDS_DURATION.failed,
            );
          }
        }
        if (durationMinutes === null) return toolError(NEEDS_DURATION.failed);
        if (distanceKm === null && transportTypeRequiresDistance(args.mode)) return toolError(CAR_NEEDS_DISTANCE);

        const parsed = travelSegmentMutationSchema.safeParse({ ...fields, durationMinutes, distanceKm });
        if (!parsed.success) return invalidLeg(parsed.error.issues);
        const change = recordChange(
          caller,
          "legCreated",
          day.id,
          legSubject(day, { type: fields.fromItemType, id: fields.fromItemId }, { type: fields.toItemType, id: fields.toItemId }),
        );
        let created;
        try {
          created = await createTravelSegmentForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: day.id,
            fromItemType: parsed.data.fromItemType,
            fromItemId: parsed.data.fromItemId,
            toItemType: parsed.data.toItemType,
            toItemId: parsed.data.toItemId,
            transportType: parsed.data.transportType,
            durationMinutes: parsed.data.durationMinutes,
            distanceKm: parsed.data.distanceKm ?? null,
            linkUrl: parsed.data.linkUrl ?? null,
            origin: "ai",
            inTransaction: change.hook,
          });
        } catch (error) {
          return legErrorResult(error);
        }
        if (created.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (created.status === "missing") return toolError(ENTRY_NOT_FOUND);
        if (created.status === "not_adjacent") return toolError(NOT_ADJACENT);
        return legResult(caller, change.id(), day.id, created.segment.id);
      }),
  );

  server.registerTool(
    "update_leg",
    {
      title: "Change a travel leg",
      description:
        "Changes how a travel leg is travelled: mode, durationMinutes, distanceKm (null removes it) and link " +
        "(null removes it). What it joins stays fixed; to join other entries, delete it and create a new one. " +
        "Switching to ship or flight without a distanceKm drops the stored distance; a car leg needs one. Pass " +
        "updatedAt exactly as get_day returned it: if the leg changed since, nothing is written. The day is " +
        "recomputed as in the app. Returns aiChangeId, the leg and the day as get_day shows them. The change can " +
        "be undone with undo_ai_change.",
      inputSchema: updateInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "update_leg", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        if ([args.mode, args.durationMinutes, args.distanceKm, args.link].every((value) => value === undefined)) {
          return toolError(NOTHING_TO_CHANGE);
        }
        const leg = await findLeg(caller, args.legId);
        if (!isLeg(leg)) return leg;

        const mode = args.mode ?? fromStoredMode(leg.transportType);
        const distanceKm =
          args.distanceKm !== undefined ? args.distanceKm : transportTypeAllowsDistance(mode) ? leg.distanceKm : null;
        if (transportTypeRequiresDistance(mode) && distanceKm === null) return toolError(CAR_LEG_NEEDS_DISTANCE);
        const parsed = travelSegmentMutationSchema.safeParse({
          tripDayId: leg.tripDayId,
          fromItemType: fromStoredItemType(leg.fromItemType),
          fromItemId: leg.fromItemId,
          toItemType: fromStoredItemType(leg.toItemType),
          toItemId: leg.toItemId,
          transportType: mode,
          durationMinutes: args.durationMinutes ?? leg.durationMinutes,
          distanceKm,
          linkUrl: args.link !== undefined ? args.link : leg.linkUrl,
        });
        if (!parsed.success) return invalidLeg(parsed.error.issues);

        const day = await readDay(userId, args.tripId, leg.tripDayId);
        const change = recordChange(
          caller,
          "legUpdated",
          leg.tripDayId,
          legSubject(
            day,
            { type: parsed.data.fromItemType, id: parsed.data.fromItemId },
            { type: parsed.data.toItemType, id: parsed.data.toItemId },
          ),
          { requireReceipt: true },
        );
        let updated;
        try {
          updated = await updateTravelSegmentForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: leg.tripDayId,
            segmentId: leg.id,
            fromItemType: parsed.data.fromItemType,
            fromItemId: parsed.data.fromItemId,
            toItemType: parsed.data.toItemType,
            toItemId: parsed.data.toItemId,
            transportType: parsed.data.transportType,
            durationMinutes: parsed.data.durationMinutes,
            distanceKm: parsed.data.distanceKm ?? null,
            linkUrl: parsed.data.linkUrl ?? null,
            expectedUpdatedAt: new Date(args.updatedAt),
            origin: "ai",
            inTransaction: change.hook,
          });
        } catch (error) {
          return legErrorResult(error);
        }
        if (updated.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (updated.status === "missing") {
          // `missing` is also an endpoint gone: a leg still carrying the stamp that was read has not changed.
          const current = await findLegForPlanner({ userId, tripId: args.tripId, legId: leg.id });
          const unchanged = current?.leg && current.leg.updatedAt.getTime() === new Date(args.updatedAt).getTime();
          return toolError(unchanged ? LEG_ENDPOINT_GONE : LEG_CHANGED);
        }
        if (updated.status === "not_adjacent") return toolError(LEG_NOT_DRAWN);
        return legResult(caller, change.id(), leg.tripDayId, leg.id);
      }),
  );

  server.registerTool(
    "delete_leg",
    {
      title: "Delete a travel leg",
      description:
        "Deletes a travel leg. Pass updatedAt exactly as get_day returned it: if the leg changed since, nothing " +
        "is deleted. The day is recomputed as in the app. Returns aiChangeId, deletedLegId and the day as get_day " +
        "shows it. The delete can be undone with undo_ai_change.",
      inputSchema: deleteInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "delete_leg", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const leg = await findLeg(caller, args.legId);
        if (!isLeg(leg)) return leg;
        const day = await readDay(userId, args.tripId, leg.tripDayId);
        const change = recordChange(
          caller,
          "legDeleted",
          leg.tripDayId,
          legSubject(
            day,
            { type: fromStoredItemType(leg.fromItemType), id: leg.fromItemId },
            { type: fromStoredItemType(leg.toItemType), id: leg.toItemId },
          ),
          { requireReceipt: true },
        );
        let deleted;
        try {
          deleted = await deleteTravelSegmentForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: leg.tripDayId,
            segmentId: leg.id,
            expectedUpdatedAt: new Date(args.updatedAt),
            inTransaction: change.hook,
          });
        } catch (error) {
          return legErrorResult(error);
        }
        if (deleted.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (deleted.status === "missing") return toolError(LEG_CHANGED);
        return toolResult({
          aiChangeId: change.id(),
          deletedLegId: leg.id,
          day: await readDay(userId, args.tripId, leg.tripDayId),
        });
      }),
  );
};
