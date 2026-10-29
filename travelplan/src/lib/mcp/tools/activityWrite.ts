import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GeocodingError, nominatimThrottle, searchNominatim } from "@/lib/geocoding/nominatim";
import { toolError } from "@/lib/mcp/logging";
import { toBucketActivity, toPlannerDay } from "@/lib/mcp/plannerShapes";
import {
  DAY_NOT_FOUND,
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  NOT_AUTHENTICATED,
  requireWritableTrip,
  runTool,
  toolResult,
  TRIP_NOT_FOUND,
  WRITE_TOOL_ANNOTATIONS,
} from "@/lib/mcp/toolRuntime";
import { insertAiChangeInTransaction, type AiChangeAction } from "@/lib/repositories/aiChangeRepo";
import {
  createParkedDayPlanItem,
  deleteParkedDayPlanItem,
  listParkedDayPlanItemsForTrip,
  updateParkedDayPlanItem,
} from "@/lib/repositories/bucketListRepo";
import {
  findActivityForPlanner,
  getPlannerDayForUser,
  isPlannerDayOfTrip,
  listParkedItemMediaForPlanner,
  type PlannerActivityRow,
} from "@/lib/repositories/connectorReadRepo";
import {
  createDayPlanItemForTripDay,
  DayPlanChangedError,
  deleteDayPlanItemForTripDay,
  parkDayPlanItemForTripDay,
  reorderDayPlanItemForTripDay,
  scheduleParkedDayPlanItemForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { removeParkedItemFiles } from "@/lib/trips/parkedItemFiles";
import { markdownToTiptapDoc, plainTextToTiptapDoc } from "@/lib/trips/planText";
import { fixedDurationOf } from "@/lib/repositories/dayScheduleTransaction";
import { ChangedSinceReadError, type InTransactionHook } from "@/lib/trips/writeOrigin";
import { bucketListMutationSchema } from "@/lib/validation/bucketListSchemas";
import {
  dayPlanItemMutationSchema,
  MAX_ACTIVITY_DURATION_MINUTES,
  MIN_ACTIVITY_DURATION_MINUTES,
} from "@/lib/validation/dayPlanItemSchemas";

/**
 * Story 15.4. The connector's activity writes. Each tool is a thin adapter over the repository function the
 * matching app route calls (same recompute, sweep, warnings and validation), with `origin: "ai"`, so the
 * entry carries the KI/AI badge, and an `inTransaction` hook that records the change in `ai_changes` in the
 * write's own transaction. Only trips the user may plan exist here (ruling R1): anything else is
 * `Trip not found`, an activity outside the trip `Activity not found`.
 *
 * Story 15.5: the input fields and the write helpers are exported for `apply_day_plan` (`dayPlanApply.ts`),
 * which writes a whole day through the same gate, geocoder, change record and error mapping.
 */

export const ACTIVITY_NOT_FOUND = "Activity not found";
export const CHANGED_SINCE_READ =
  "This activity changed since you read it; read it again with get_day or get_bucket_list and retry with the new updatedAt.";
export const DAY_CHANGED_WHILE_SAVING =
  "The day changed while this was being saved; read it again with get_day and retry.";
export const GEOCODE_NOT_FOUND =
  "No place was found for that name. Give place.lat and place.lng (decimal degrees) together with place.name.";
export const GEOCODE_UNAVAILABLE =
  "The place search is unavailable right now. Give place.lat and place.lng (decimal degrees), or try again later.";
const PARKED_IS_FLEXIBLE =
  "A bucket-list activity is always flexible, with no times and no position. Leave out mode fixed, startTime, " +
  "endTime and afterActivityId, or give a dayId to put the activity on a day.";

export const TIMES_NEED_FIXED =
  "startTime and endTime are for fixed activities only: pass mode \"fixed\" with them, or leave them out " +
  "for a flexible activity (its times are computed from the day's order).";
export const DESCRIPTION_EMPTY = "description must not be empty (the app requires text).";
const NOTHING_TO_CHANGE = "Nothing to change.";
/** The longest description a tool accepts, in characters. */
const MAX_DESCRIPTION_LENGTH = 10_000;

const CONNECTOR_USER_AGENT = "TravelPlan/0.1 connector";
/** How long a write waits for a Nominatim slot (one request per second, server-wide) before giving up. */
const GEOCODE_MAX_WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A place by name: its first Nominatim match, or `null` for none. Throws `GeocodingError` when Nominatim
 * cannot answer (or no slot is free soon enough). Books its start slot on the server-wide
 * `nominatimThrottle`, as the suggestion verification does.
 */
const geocodePlaceName = async (name: string): Promise<{ lat: number; lng: number } | null> => {
  const now = Date.now();
  const slotAt = nominatimThrottle.book(now, now + GEOCODE_MAX_WAIT_MS);
  if (slotAt === null) throw new GeocodingError("geocoding_unavailable", "No Nominatim slot free");
  if (slotAt > now) await sleep(slotAt - now);
  const [first] = await searchNominatim({ q: name, limit: 1, userAgent: CONNECTOR_USER_AGENT });
  return first ? { lat: first.lat, lng: first.lng } : null;
};

/** The injection seam: tests replace `geocode` (`vi.spyOn`), so no test reaches Nominatim. */
export const activityWriteDeps = { geocode: geocodePlaceName };

// ---------------------------------------------------------------------------------------------------------
// Inputs

export const tripIdField = idSchema.describe("The trip's id, from list_trips.");
const activityIdField = idSchema.describe("The activity's id, from get_day or get_bucket_list.");

export const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour, 00:00 to 23:59)");

export const placeField = z
  .object({
    name: z.string().trim().min(1).max(200).optional().describe("The place's name or address; also its label."),
    lat: z.number().min(-90).max(90).optional().describe("Latitude in decimal degrees."),
    lng: z.number().min(-180).max(180).optional().describe("Longitude in decimal degrees."),
  })
  .refine((place) => (place.lat === undefined) === (place.lng === undefined), {
    message: "Give lat and lng together, or neither.",
  })
  .refine((place) => place.name !== undefined || place.lat !== undefined, {
    message: "Give place.name, or place.lat and place.lng.",
  });

export const activityFields = {
  title: z.string().trim().min(1).max(120).describe("The activity's title, at most 120 characters."),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH)
    .optional()
    .describe(
      "The activity's notes as plain text or simple Markdown: paragraphs (one per line), '-' bullet lists, " +
        "'1.' numbered lists, **bold**, *italic* and [text](https://...) links. At most 10000 characters; not empty.",
    ),
  mode: z
    .enum(["flexible", "fixed"])
    .optional()
    .describe(
      "flexible: placed in the day's order by durationMinutes, its times computed by TravelPlan. fixed: at " +
        "startTime, until endTime or for durationMinutes.",
    ),
  durationMinutes: z
    .number()
    .int()
    .min(MIN_ACTIVITY_DURATION_MINUTES)
    .max(MAX_ACTIVITY_DURATION_MINUTES)
    .optional()
    .describe(
      `Duration in minutes (${MIN_ACTIVITY_DURATION_MINUTES} to ${MAX_ACTIVITY_DURATION_MINUTES}). Flexible activities ` +
        "default to 15. For fixed ones the alternative to endTime.",
    ),
  startTime: timeField.optional().describe("Fixed activities only: the start as HH:MM (24-hour)."),
  endTime: timeField
    .optional()
    .describe("Fixed activities only: the end as HH:MM, after startTime and not past 23:59."),
};

const createInput = z.object({
  tripId: tripIdField,
  dayId: idSchema
    .optional()
    .describe("The day's id, from get_trip. Leave it out to add the activity to the trip's bucket list."),
  ...activityFields,
  place: placeField
    .optional()
    .describe("Where it happens. A name alone is looked up on OpenStreetMap; give lat and lng to skip the lookup."),
  afterActivityId: idSchema
    .optional()
    .describe("Flexible activities on a day only: insert directly after this activity of the same day (default: at the end)."),
});

const updatedAtField = z.iso
  .datetime({ offset: true, error: "Use the ISO 8601 updatedAt from the read" })
  .describe("The activity's updatedAt (ISO 8601) exactly as get_day or get_bucket_list returned it.");

const updateInput = z.object({
  tripId: tripIdField,
  activityId: activityIdField,
  updatedAt: updatedAtField,
  title: activityFields.title.optional(),
  description: activityFields.description,
  mode: activityFields.mode,
  durationMinutes: activityFields.durationMinutes,
  startTime: activityFields.startTime,
  endTime: activityFields.endTime,
  place: placeField
    .nullable()
    .optional()
    .describe("The new place (a name alone is looked up on OpenStreetMap), or null to remove it."),
});

const deleteInput = z.object({ tripId: tripIdField, activityId: activityIdField, updatedAt: updatedAtField });

const moveInput = z
  .object({
    tripId: tripIdField,
    activityId: activityIdField,
    direction: z
      .enum(["earlier", "later"])
      .optional()
      .describe("Swap places with the previous (earlier) or next (later) activity of the day."),
    position: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The new 1-based position in the day's order (1 = first)."),
  })
  .refine((args) => (args.direction === undefined) !== (args.position === undefined), {
    message: "Give exactly one of direction or position.",
  });

const toDayInput = z.object({
  tripId: tripIdField,
  activityId: activityIdField,
  dayId: idSchema.describe("The target day's id, from get_trip."),
});

const activityOnlyInput = z.object({ tripId: tripIdField, activityId: activityIdField });

// ---------------------------------------------------------------------------------------------------------
// Helpers

export type Caller = { userId: string; tripId: string; clientId: string };

/**
 * Every write tool's first step: a change is never recorded without the client that made it (a token
 * without one is refused as unauthenticated), and only a trip the user may plan exists (ruling R1).
 */
export const startWrite = async (userId: string, tripId: string, clientId: string | null): Promise<Caller | CallToolResult> => {
  if (!clientId) return toolError(NOT_AUTHENTICATED);
  const gate = await requireWritableTrip(userId, tripId);
  return gate === true ? { userId, tripId, clientId } : gate;
};

export const isCaller = (value: Caller | CallToolResult): value is Caller => "clientId" in value;

/**
 * The hook that records one change, in the write's transaction. The id is read after the write; a write
 * whose hook did not run (a refusal) has none.
 */
export const recordChange = (
  caller: Caller,
  action: AiChangeAction,
  tripDayId: string | null,
  title: string | null,
  options: { requireReceipt?: boolean } = {},
) => {
  // The activity's title at write time; never an empty string.
  const subject = title?.trim() || null;
  let id: string | null = null;
  const hook: InTransactionHook = async (tx, outcome) => {
    id = await insertAiChangeInTransaction(tx, {
      tripId: caller.tripId,
      tripDayId,
      userId: caller.userId,
      clientId: caller.clientId,
      action,
      subject,
      receipt: outcome.receipt,
      requireReceipt: options.requireReceipt,
    });
  };
  return { hook, id: () => id };
};

/** The refusals a write can throw that the model can act on; anything else is runTool's generic error. */
export const writeErrorResult = (error: unknown): CallToolResult => {
  if (error instanceof ChangedSinceReadError) return toolError(CHANGED_SINCE_READ);
  if (error instanceof DayPlanChangedError) return toolError(DAY_CHANGED_WHILE_SAVING);
  throw error;
};

export const invalid = (issues: { message: string }[]) =>
  toolError(`Invalid activity: ${[...new Set(issues.map((issue) => issue.message))].join("; ")}.`);

export type ResolvedLocation = { lat: number; lng: number; label: string | null } | null;

/**
 * A place input as the stored location; a name without coordinates is geocoded. Story 15.5: the refusal
 * as plain text, so `apply_day_plan` can name the activity it belongs to.
 */
export const lookUpPlace = async (
  place: z.infer<typeof placeField> | null,
): Promise<{ location: ResolvedLocation } | { refusal: string }> => {
  if (place === null) return { location: null };
  const label = place.name ?? null;
  if (place.lat !== undefined && place.lng !== undefined) return { location: { lat: place.lat, lng: place.lng, label } };
  try {
    const found = await activityWriteDeps.geocode(place.name!);
    return found ? { location: { ...found, label } } : { refusal: GEOCODE_NOT_FOUND };
  } catch (error) {
    if (error instanceof GeocodingError) return { refusal: GEOCODE_UNAVAILABLE };
    throw error;
  }
};

/** `lookUpPlace` with its refusal as the tool error. */
const resolvePlace = async (
  place: z.infer<typeof placeField> | null,
): Promise<{ location: ResolvedLocation } | CallToolResult> => {
  const result = await lookUpPlace(place);
  return "refusal" in result ? toolError(result.refusal) : result;
};

const isToolResult = (value: object): value is CallToolResult => "content" in value;

/** A place `resolvePlace` would send to the geocoder, which books the server-wide Nominatim slot. */
const needsGeocoding = (place: z.infer<typeof placeField> | null | undefined) =>
  place != null && (place.lat === undefined || place.lng === undefined);

/** One day, in the read tools' shape (order, computed times, warnings). */
export const readDay = async (userId: string, tripId: string, tripDayId: string) => {
  const result = await getPlannerDayForUser({ userId, tripId, day: { id: tripDayId } });
  return result?.day ? toPlannerDay(result.day) : null;
};

const dayResult = async (caller: Caller, aiChangeId: string | null, tripDayId: string, activityId: string) => {
  const day = await readDay(caller.userId, caller.tripId, tripDayId);
  const activity = day?.activities.find((entry) => entry.id === activityId) ?? null;
  return toolResult({ aiChangeId, activity, day });
};

/** A parked activity in `get_bucket_list`'s shape, or `null` when it is no longer parked. */
const readBucketActivity = async (caller: Caller, activityId: string) => {
  const items = await listParkedDayPlanItemsForTrip({ userId: caller.userId, tripId: caller.tripId });
  const item = items?.find((entry) => entry.id === activityId);
  if (!item) return null;
  const media = await listParkedItemMediaForPlanner({ userId: caller.userId, tripId: caller.tripId, itemIds: [item.id] });
  return toBucketActivity(item, media.get(item.id));
};

const bucketResult = async (caller: Caller, aiChangeId: string | null, activityId: string) =>
  toolResult({ aiChangeId, activity: await readBucketActivity(caller, activityId), day: null });

/** The activity of the trip, or the tool error that says why there is none. */
const findActivity = async (caller: Caller, activityId: string): Promise<PlannerActivityRow | CallToolResult> => {
  const found = await findActivityForPlanner({ userId: caller.userId, tripId: caller.tripId, activityId });
  if (!found) return toolError(TRIP_NOT_FOUND);
  return found.activity ?? toolError(ACTIVITY_NOT_FOUND);
};

const isActivity = (value: PlannerActivityRow | CallToolResult): value is PlannerActivityRow => "tripDayId" in value;

/**
 * Cost, payments and link as stored: out of scope for 15.4 (15.6), and the repositories replace payments
 * wholesale. Passed to the repository unchanged and left out of the validation, so a stored row the
 * payment rule would refuse today (a legacy cost without instalments) does not block an edit of its title.
 */
const storedMoneyAndLink = (row: PlannerActivityRow) => ({
  costCents: row.costCents,
  costOriginalAmount: row.costOriginalAmount,
  costCurrency: row.costCurrency,
  costRate: row.costRate,
  costRateDate: row.costRateDate,
  payments: row.costCents === null ? null : row.payments,
  linkUrl: row.linkUrl,
});

type ScheduleInput = {
  mode?: "flexible" | "fixed";
  durationMinutes?: number;
  startTime?: string;
  endTime?: string;
};

/** The day-activity payload `dayPlanItemMutationSchema` checks, exactly as the app's routes do. */
const validateDayPayload = (payload: Record<string, unknown>) => dayPlanItemMutationSchema.safeParse(payload);

export const scheduleOfCreate = (args: ScheduleInput) =>
  args.mode === "fixed"
    ? {
        scheduleMode: "FIXED" as const,
        fromTime: args.startTime ?? null,
        toTime: args.endTime ?? null,
        durationMinutes: args.durationMinutes ?? null,
      }
    : { scheduleMode: "FLEXIBLE" as const, fromTime: null, toTime: null, durationMinutes: args.durationMinutes ?? null };

/** The mode an update leaves the activity in: the given one, else the stored one. */
const effectiveModeOf = (row: PlannerActivityRow, args: ScheduleInput) =>
  args.mode ? (args.mode === "fixed" ? ("FIXED" as const) : ("FLEXIBLE" as const)) : row.scheduleMode;

/**
 * The provided schedule fields over the stored ones. A fixed activity given a new duration without an end
 * drops its stored end (the end follows from start + duration); one given only a new start keeps its
 * duration, so the end moves with the start. Flexible ignores times, as in the app.
 */
const scheduleOfUpdate = (row: PlannerActivityRow, args: ScheduleInput) => {
  const scheduleMode = effectiveModeOf(row, args);
  if (scheduleMode === "FLEXIBLE") {
    return {
      scheduleMode,
      fromTime: null,
      toTime: null,
      durationMinutes: args.durationMinutes ?? row.durationMinutes,
    } as const;
  }
  const wasFixed = row.scheduleMode === "FIXED";
  if (args.startTime !== undefined && args.endTime === undefined && args.durationMinutes === undefined) {
    return {
      scheduleMode,
      fromTime: args.startTime,
      toTime: null,
      durationMinutes: wasFixed ? fixedDurationOf(row) : row.durationMinutes,
    } as const;
  }
  const fromTime = args.startTime ?? (wasFixed ? row.fromTime : null);
  const toTime =
    args.endTime ?? (args.durationMinutes !== undefined || !wasFixed ? null : row.toTime);
  return {
    scheduleMode,
    fromTime,
    toTime,
    durationMinutes: args.durationMinutes ?? row.durationMinutes,
  } as const;
};

// ---------------------------------------------------------------------------------------------------------
// Tools

const UNDO_NOTE = "The result's aiChangeId can be undone with undo_ai_change.";
const DAY_RESULT_NOTE =
  "Returns aiChangeId, the activity and the day as get_day shows it (activities in order with their computed " +
  "startTime/endTime as HH:MM, and the plan warnings); day is null for a bucket-list activity.";

export const registerActivityWriteTools = (server: McpServer) => {
  server.registerTool(
    "create_activity",
    {
      title: "Add an activity",
      description:
        "Adds an activity to a day of a trip, or to the trip's bucket list when dayId is left out. A flexible " +
        "activity (the default) is appended to the day, or inserted after afterActivityId, and gets its times " +
        "from the day's order; a fixed one needs startTime (HH:MM) and endTime (HH:MM) or durationMinutes, and " +
        "must end by 23:59. Without a description the title is used as the text. " +
        "The day is recomputed as in the app; an over-full day is saved anyway and returned with its warnings. " +
        DAY_RESULT_NOTE +
        " " +
        UNDO_NOTE,
      inputSchema: createInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "create_activity", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const title = args.title.trim();
        if (args.description !== undefined && args.description.trim() === "") return toolError(DESCRIPTION_EMPTY);

        if (args.dayId === undefined) {
          if (args.mode === "fixed" || args.startTime || args.endTime || args.afterActivityId) {
            return toolError(PARKED_IS_FLEXIBLE);
          }
        } else if (args.mode !== "fixed" && (args.startTime !== undefined || args.endTime !== undefined)) {
          return toolError(TIMES_NEED_FIXED);
        }
        if (args.dayId !== undefined && args.afterActivityId !== undefined) {
          const after = await findActivity(caller, args.afterActivityId);
          if (!isActivity(after)) return after;
          if (after.tripDayId !== args.dayId) return toolError("afterActivityId must be an activity on the same day.");
        }

        const contentJson =
          args.description !== undefined ? markdownToTiptapDoc(args.description) : plainTextToTiptapDoc(title);
        const bucketPayload = (location: ResolvedLocation) => ({
          title,
          contentJson,
          durationMinutes: args.durationMinutes ?? null,
          location,
        });
        const dayPayload = (location: ResolvedLocation) => ({
          tripDayId: args.dayId,
          title,
          contentJson,
          location,
          afterItemId: args.afterActivityId ?? null,
          ...scheduleOfCreate(args),
        });
        // A create the day or the payload would refuse anyway does not take a geocoder slot first.
        if (needsGeocoding(args.place)) {
          if (args.dayId !== undefined && !(await isPlannerDayOfTrip({ userId, tripId: args.tripId, tripDayId: args.dayId }))) {
            return toolError(DAY_NOT_FOUND);
          }
          const precheck =
            args.dayId === undefined
              ? bucketListMutationSchema.safeParse(bucketPayload(null))
              : validateDayPayload(dayPayload(null));
          if (!precheck.success) return invalid(precheck.error.issues);
        }
        const place = args.place ? await resolvePlace(args.place) : { location: null };
        if (isToolResult(place)) return place;
        const change = recordChange(caller, "created", args.dayId ?? null, title);

        if (args.dayId === undefined) {
          const parsed = bucketListMutationSchema.safeParse(bucketPayload(place.location));
          if (!parsed.success) return invalid(parsed.error.issues);
          const created = await createParkedDayPlanItem({
            userId,
            tripId: args.tripId,
            title: parsed.data.title,
            contentJson: parsed.data.contentJson,
            durationMinutes: parsed.data.durationMinutes ?? null,
            location: place.location,
            origin: "ai",
            inTransaction: change.hook,
          });
          if (!created) return toolError(TRIP_NOT_FOUND);
          return bucketResult(caller, change.id(), created.id);
        }

        const parsed = validateDayPayload(dayPayload(place.location));
        if (!parsed.success) return invalid(parsed.error.issues);
        let created;
        try {
          created = await createDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: args.dayId,
            title: parsed.data.title,
            scheduleMode: parsed.data.scheduleMode,
            durationMinutes: parsed.data.durationMinutes ?? null,
            fromTime: parsed.data.fromTime ?? null,
            toTime: parsed.data.toTime ?? null,
            contentJson: parsed.data.contentJson,
            location: place.location,
            afterItemId: parsed.data.afterItemId ?? null,
            origin: "ai",
            inTransaction: change.hook,
          });
        } catch (error) {
          return writeErrorResult(error);
        }
        if (!created) return toolError(DAY_NOT_FOUND);
        return dayResult(caller, change.id(), args.dayId, created.item.id);
      }),
  );

  server.registerTool(
    "update_activity",
    {
      title: "Change an activity",
      description:
        "Changes an activity on a day or in the bucket list. Only the fields given change; the others, and the " +
        "activity's cost, payments, link, documents and images, stay as they are. place: null removes the place. " +
        "Pass updatedAt exactly as get_day or get_bucket_list returned it: if the activity changed since, nothing " +
        "is written and you are asked to read it again. Times as HH:MM, durationMinutes in minutes; a bucket-list " +
        "activity has no mode or times. " +
        DAY_RESULT_NOTE +
        " " +
        UNDO_NOTE,
      inputSchema: updateInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "update_activity", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const changing = [
          args.title,
          args.description,
          args.mode,
          args.durationMinutes,
          args.startTime,
          args.endTime,
          args.place,
        ].some((value) => value !== undefined);
        if (!changing) return toolError(NOTHING_TO_CHANGE);
        if (args.description !== undefined && args.description.trim() === "") return toolError(DESCRIPTION_EMPTY);
        const row = await findActivity(caller, args.activityId);
        if (!isActivity(row)) return row;

        const parked = row.tripDayId === null;
        if (parked && (args.mode === "fixed" || args.startTime || args.endTime)) return toolError(PARKED_IS_FLEXIBLE);
        const hasTimes = args.startTime !== undefined || args.endTime !== undefined;
        if (!parked && hasTimes && effectiveModeOf(row, args) === "FLEXIBLE") return toolError(TIMES_NEED_FIXED);

        const title = (args.title ?? row.title).trim();
        const contentJson = args.description !== undefined ? markdownToTiptapDoc(args.description) : row.contentJson;
        const bucketPayload = (location: ResolvedLocation) => ({
          title,
          contentJson,
          durationMinutes: args.durationMinutes ?? row.durationMinutes,
          location,
        });
        const dayPayload = (location: ResolvedLocation) => ({
          tripDayId: row.tripDayId!,
          title,
          contentJson,
          location,
          ...scheduleOfUpdate(row, args),
        });
        let location: ResolvedLocation = row.location;
        if (args.place !== undefined) {
          // An edit the payload would refuse anyway does not take a geocoder slot first.
          if (needsGeocoding(args.place)) {
            const precheck = parked
              ? bucketListMutationSchema.safeParse(bucketPayload(null))
              : validateDayPayload(dayPayload(null));
            if (!precheck.success) return invalid(precheck.error.issues);
          }
          const place = await resolvePlace(args.place);
          if (isToolResult(place)) return place;
          location = place.location;
        }
        const expectedUpdatedAt = new Date(args.updatedAt);
        const change = recordChange(caller, "updated", row.tripDayId, title);

        try {
          if (parked) {
            const parsed = bucketListMutationSchema.safeParse(bucketPayload(location));
            if (!parsed.success) return invalid(parsed.error.issues);
            const updated = await updateParkedDayPlanItem({
              userId,
              tripId: args.tripId,
              itemId: row.id,
              title: parsed.data.title,
              contentJson: parsed.data.contentJson,
              durationMinutes: parsed.data.durationMinutes ?? null,
              location,
              ...storedMoneyAndLink(row),
              expectedUpdatedAt,
              origin: "ai",
              inTransaction: change.hook,
            });
            if (updated.status === "not_found") return toolError(TRIP_NOT_FOUND);
            if (updated.status === "missing") return toolError(CHANGED_SINCE_READ);
            return bucketResult(caller, change.id(), row.id);
          }

          const tripDayId = row.tripDayId!;
          const parsed = validateDayPayload(dayPayload(location));
          if (!parsed.success) return invalid(parsed.error.issues);
          const updated = await updateDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId,
            itemId: row.id,
            title: parsed.data.title,
            scheduleMode: parsed.data.scheduleMode,
            durationMinutes: parsed.data.durationMinutes ?? null,
            fromTime: parsed.data.fromTime ?? null,
            toTime: parsed.data.toTime ?? null,
            contentJson: parsed.data.contentJson,
            location,
            ...storedMoneyAndLink(row),
            expectedUpdatedAt,
            origin: "ai",
            inTransaction: change.hook,
          });
          if (updated.status === "not_found") return toolError(DAY_NOT_FOUND);
          if (updated.status === "missing") return toolError(CHANGED_SINCE_READ);
          return dayResult(caller, change.id(), tripDayId, row.id);
        } catch (error) {
          return writeErrorResult(error);
        }
      }),
  );

  server.registerTool(
    "delete_activity",
    {
      title: "Delete an activity",
      description:
        "Deletes an activity from a day or from the bucket list. Pass updatedAt exactly as get_day or " +
        "get_bucket_list returned it: if the activity changed since, nothing is deleted. A day activity's delete " +
        "recomputes the day and can be undone with undo_ai_change; a bucket-list activity's delete also removes " +
        "its documents and images and cannot be undone. Returns aiChangeId, deletedActivityId and the day (null " +
        "for the bucket list).",
      inputSchema: deleteInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "delete_activity", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const row = await findActivity(caller, args.activityId);
        if (!isActivity(row)) return row;
        const expectedUpdatedAt = new Date(args.updatedAt);
        const change = recordChange(caller, "deleted", row.tripDayId, row.title);

        try {
          if (row.tripDayId === null) {
            const deleted = await deleteParkedDayPlanItem({
              userId,
              tripId: args.tripId,
              itemId: row.id,
              expectedUpdatedAt,
              inTransaction: change.hook,
            });
            if (deleted.status === "not_found") return toolError(TRIP_NOT_FOUND);
            if (deleted.status === "missing") return toolError(CHANGED_SINCE_READ);
            await removeParkedItemFiles(args.tripId, row.id, deleted);
            return toolResult({ aiChangeId: change.id(), deletedActivityId: row.id, day: null });
          }

          const deleted = await deleteDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: row.tripDayId,
            itemId: row.id,
            expectedUpdatedAt,
            inTransaction: change.hook,
          });
          if (deleted.status === "not_found") return toolError(DAY_NOT_FOUND);
          if (deleted.status === "missing") return toolError(CHANGED_SINCE_READ);
          return toolResult({
            aiChangeId: change.id(),
            deletedActivityId: row.id,
            day: await readDay(userId, args.tripId, row.tripDayId),
          });
        } catch (error) {
          return writeErrorResult(error);
        }
      }),
  );

  server.registerTool(
    "move_activity",
    {
      title: "Move an activity within its day",
      description:
        "Moves a flexible activity within its day: direction earlier/later swaps it with its neighbour, or " +
        "position puts it at that 1-based place in the day's order (1 = first). Give exactly one. Fixed " +
        "activities are placed by their startTime and cannot be moved this way; change startTime with " +
        "update_activity instead. The day is recomputed. " +
        DAY_RESULT_NOTE +
        " " +
        UNDO_NOTE,
      inputSchema: moveInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "move_activity", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const row = await findActivity(caller, args.activityId);
        if (!isActivity(row)) return row;
        if (row.tripDayId === null) {
          return toolError("This activity is in the bucket list; use schedule_activity to put it on a day.");
        }
        const change = recordChange(caller, "moved", row.tripDayId, row.title);
        const target =
          args.direction !== undefined
            ? { direction: args.direction === "earlier" ? ("up" as const) : ("down" as const) }
            : { toIndex: args.position! - 1 };

        let moved;
        try {
          moved = await reorderDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: row.tripDayId,
            itemId: row.id,
            origin: "ai",
            inTransaction: change.hook,
            ...target,
          });
        } catch (error) {
          return writeErrorResult(error);
        }
        if (moved.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (moved.status === "missing") return toolError(ACTIVITY_NOT_FOUND);
        if (moved.status === "not_reorderable") {
          if (args.position !== undefined) {
            const day = await readDay(userId, args.tripId, row.tripDayId);
            const current = day?.activities.findIndex((entry) => entry.id === row.id) ?? -1;
            if (current + 1 === args.position) {
              return toolError(`The activity is already at position ${args.position}.`);
            }
          }
          return toolError(
            "This activity cannot move there: only a flexible activity moves, to another position within its day " +
              "(1 to the number of activities), and not past the first or last place.",
          );
        }
        return dayResult(caller, change.id(), row.tripDayId, row.id);
      }),
  );

  server.registerTool(
    "move_activity_to_day",
    {
      title: "Move an activity to another day",
      description:
        "Moves an activity from its day to the end of another day of the same trip, as flexible, as the app " +
        "does it: it is parked in the bucket list, then scheduled onto the target day. Both days are recomputed. " +
        "This records two changes: aiChangeId (the schedule onto the target day) and parkAiChangeId (taking it off " +
        "its day); undo them newest first. For a bucket-list activity use schedule_activity. " +
        DAY_RESULT_NOTE,
      inputSchema: toDayInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "move_activity_to_day", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const row = await findActivity(caller, args.activityId);
        if (!isActivity(row)) return row;
        if (row.tripDayId === null) {
          return toolError("This activity is in the bucket list; use schedule_activity to put it on a day.");
        }
        if (row.tripDayId === args.dayId) {
          return toolError("The activity is already on that day; use move_activity to change its position.");
        }
        if (!(await isPlannerDayOfTrip({ userId, tripId: args.tripId, tripDayId: args.dayId }))) {
          return toolError(DAY_NOT_FOUND);
        }

        const park = recordChange(caller, "parked", row.tripDayId, row.title);
        try {
          const parked = await parkDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: row.tripDayId,
            itemId: row.id,
            origin: "ai",
            inTransaction: park.hook,
          });
          if (parked.status === "not_found") return toolError(DAY_NOT_FOUND);
          if (parked.status === "missing") return toolError(ACTIVITY_NOT_FOUND);
        } catch (error) {
          return writeErrorResult(error);
        }

        const schedule = recordChange(caller, "scheduled", args.dayId, row.title);
        const parkNote =
          `it is now in the bucket list (AI change ${park.id()}; undo it with undo_ai_change or schedule it ` +
          "with schedule_activity).";
        const scheduleFailed = toolError(
          `The activity was taken off its day but could not be put on the target day; ${parkNote}`,
        );
        let scheduled;
        try {
          scheduled = await scheduleParkedDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: args.dayId,
            itemId: row.id,
            origin: "ai",
            inTransaction: schedule.hook,
          });
        } catch (error) {
          console.error("mcp: move_activity_to_day schedule failed after park", error instanceof Error ? error.name : "unknown");
          return scheduleFailed;
        }
        if (scheduled.status === "not_found") {
          return toolError(`The activity was taken off its day, but the target day was not found; ${parkNote}`);
        }
        if (scheduled.status === "missing") {
          return toolError(
            "The activity was taken off its day (AI change " +
              `${park.id()}), but it had left the bucket list before it could be scheduled: it was changed in ` +
              "the meantime. Read get_bucket_list and get_day to see where it is now.",
          );
        }
        const day = await readDay(userId, args.tripId, args.dayId);
        return toolResult({
          aiChangeId: schedule.id(),
          parkAiChangeId: park.id(),
          activity: day?.activities.find((entry) => entry.id === row.id) ?? null,
          day,
        });
      }),
  );

  server.registerTool(
    "schedule_activity",
    {
      title: "Put a bucket-list activity on a day",
      description:
        "Moves an activity from the trip's bucket list to the end of a day, as flexible with its duration; the " +
        "day is recomputed. " +
        DAY_RESULT_NOTE +
        " " +
        UNDO_NOTE,
      inputSchema: toDayInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "schedule_activity", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const row = await findActivity(caller, args.activityId);
        if (!isActivity(row)) return row;
        if (row.tripDayId !== null) {
          return toolError("This activity is already on a day; use move_activity_to_day to move it to another day.");
        }
        const change = recordChange(caller, "scheduled", args.dayId, row.title);
        let scheduled;
        try {
          scheduled = await scheduleParkedDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: args.dayId,
            itemId: row.id,
            origin: "ai",
            inTransaction: change.hook,
          });
        } catch (error) {
          return writeErrorResult(error);
        }
        if (scheduled.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (scheduled.status === "missing") return toolError(ACTIVITY_NOT_FOUND);
        return dayResult(caller, change.id(), args.dayId, row.id);
      }),
  );

  server.registerTool(
    "park_activity",
    {
      title: "Move an activity to the bucket list",
      description:
        "Takes an activity off its day and puts it in the trip's bucket list, keeping its text, duration, place, " +
        "cost, documents and images; it becomes flexible without times. The day is recomputed. Returns " +
        "aiChangeId, the activity in get_bucket_list's shape and the day it left as get_day shows it. " +
        UNDO_NOTE,
      inputSchema: activityOnlyInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "park_activity", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const row = await findActivity(caller, args.activityId);
        if (!isActivity(row)) return row;
        if (row.tripDayId === null) return toolError("This activity is already in the bucket list.");
        const change = recordChange(caller, "parked", row.tripDayId, row.title);
        let parked;
        try {
          parked = await parkDayPlanItemForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: row.tripDayId,
            itemId: row.id,
            origin: "ai",
            inTransaction: change.hook,
          });
        } catch (error) {
          return writeErrorResult(error);
        }
        if (parked.status === "not_found") return toolError(DAY_NOT_FOUND);
        if (parked.status === "missing") return toolError(ACTIVITY_NOT_FOUND);
        return toolResult({
          aiChangeId: change.id(),
          activity: await readBucketActivity(caller, row.id),
          day: await readDay(userId, args.tripId, row.tripDayId),
        });
      }),
  );
};
