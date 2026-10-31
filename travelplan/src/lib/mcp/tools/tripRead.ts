import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { canTripAccessRoleWrite } from "@/lib/auth/tripAccess";
import { toolError } from "@/lib/mcp/logging";
import { fileLinkNote, toLinkedBucketActivities, toLinkedPlannerDay } from "@/lib/mcp/fileLinkShapes";
import { toTripListEntry, toTripOverview } from "@/lib/mcp/plannerShapes";
import {
  DAY_NOT_FOUND,
  idSchema,
  READ_ONLY_TOOL_ANNOTATIONS,
  requireWritableTrip,
  runTool,
  toolResult,
  TRIP_NOT_FOUND,
} from "@/lib/mcp/toolRuntime";
import { listParkedDayPlanItemsForTrip } from "@/lib/repositories/bucketListRepo";
import { getPlannerDayForUser, listParkedItemMediaForPlanner } from "@/lib/repositories/connectorReadRepo";
import { getTripWithDaysForUser, listTripsForUser } from "@/lib/repositories/tripRepo";
import { DAY_START_WITHOUT_STAY } from "@/lib/trips/stayTimes";

/**
 * Story 15.2. The read tools: what Claude knows about a trip before it suggests anything. Only trips the
 * user may plan (owner or contributor) exist here (ruling R1); every trip-scoped tool checks per call and
 * answers `Trip not found` for anything else, the same text as for an id that names nothing.
 */

const tripInput = z.object({ tripId: idSchema.describe("The trip's id, from list_trips.") });

const getDayInput = z
  .object({
    tripId: idSchema.describe("The trip's id, from list_trips."),
    dayId: idSchema.optional().describe("The day's id, from get_trip. Give this or date, not both."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .optional()
      .describe("The day's date as YYYY-MM-DD. Give this or dayId, not both."),
  })
  .refine((args) => (args.dayId === undefined) !== (args.date === undefined), {
    message: "Give exactly one of dayId or date.",
  });

const UPDATED_AT_NOTE =
  "Every activity, stay and leg carries updatedAt (ISO 8601); pass it back unchanged to write tools.";

export const registerTripReadTools = (server: McpServer) => {
  server.registerTool(
    "list_trips",
    {
      title: "List my TravelPlan trips",
      description:
        "Start here. Lists the TravelPlan trips this account may plan, as owner or contributor, in the app's order " +
        "(by start date): id, name, startDate and endDate (YYYY-MM-DD), role and dayCount. Trips the account may " +
        "only view are deliberately not listed and cannot be read with these tools.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (ctx) =>
      runTool({ name: "list_trips", ctx }, async (userId) => {
        const { trips } = await listTripsForUser(userId);
        return toolResult({
          trips: trips.filter((trip) => canTripAccessRoleWrite(trip.accessRole)).map(toTripListEntry),
        });
      }),
  );

  server.registerTool(
    "get_trip",
    {
      title: "Read a trip overview",
      description:
        "Returns a trip's name, startDate and endDate (YYYY-MM-DD) and, per day in order: id, date (YYYY-MM-DD), " +
        "dayIndex (1 = first day), tonight's stay (name and status planned/booked, or null), missingStay, " +
        "activityCount and plan warnings (late: a fixed activity reached after its start, with startTime and " +
        "reachableAt as HH:MM and lateMinutes; overflow: a flexible activity that does not fit before 23:59). " +
        "No costs here: read get_day for each activity's and stay's cost and payment split.",
      inputSchema: tripInput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "get_trip", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        const trip = await getTripWithDaysForUser(userId, args.tripId);
        if (!trip || !canTripAccessRoleWrite(trip.accessRole)) return toolError(TRIP_NOT_FOUND);
        return toolResult(toTripOverview(trip));
      }),
  );

  server.registerTool(
    "get_day",
    {
      title: "Read one day of a trip",
      description:
        "Returns one day of a trip: previousStay (last night's stay with the checkOutTime the day starts from, " +
        `HH:MM; null = no stay last night, the day starts at ${DAY_START_WITHOUT_STAY}), ` +
        "the activities in order with their computed startTime/endTime (HH:MM; both null = does not fit " +
        "in the day), mode (fixed or flexible), durationMinutes, description, place, link, cost in EUR cents " +
        "(with the original currency amount in minor units and its rate per 1 EUR), payments (instalments with " +
        "amountEurCents and dueDate YYYY-MM-DD), document and image ids with file names, the travel legs between " +
        "them (durationMinutes, distanceKm), tonight's stay with the same cost details, missingStay and plan " +
        "warnings. Give either dayId or date (YYYY-MM-DD). " +
        UPDATED_AT_NOTE +
        " " +
        fileLinkNote(),
      inputSchema: getDayInput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "get_day", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        const result = await getPlannerDayForUser({
          userId,
          tripId: args.tripId,
          day: args.dayId !== undefined ? { id: args.dayId } : { date: args.date! },
        });
        if (!result) return toolError(TRIP_NOT_FOUND);
        if (!result.day) return toolError(DAY_NOT_FOUND);
        return toolResult(await toLinkedPlannerDay(args.tripId, result.day));
      }),
  );

  server.registerTool(
    "get_bucket_list",
    {
      title: "Read a trip's bucket list",
      description:
        "Returns the trip's bucket list: parked activities that are not on any day yet, ordered by title (then by " +
        "creation, then id). Each has id, title, description, mode (always flexible here), durationMinutes, place, " +
        "link, cost in EUR cents (with the original currency), payments, document and image ids with file names. " +
        "They have no times until they are scheduled onto a day. " +
        UPDATED_AT_NOTE +
        " " +
        fileLinkNote(),
      inputSchema: tripInput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "get_bucket_list", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        const items = await listParkedDayPlanItemsForTrip({ userId, tripId: args.tripId });
        if (!items) return toolError(TRIP_NOT_FOUND);
        const media = await listParkedItemMediaForPlanner({
          userId,
          tripId: args.tripId,
          itemIds: items.map((item) => item.id),
        });
        return toolResult({ activities: await toLinkedBucketActivities(args.tripId, items, media) });
      }),
  );
};
