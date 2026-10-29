import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { hasAtMostTwoDecimals } from "@/lib/mcp/costInput";
import { toolError } from "@/lib/mcp/logging";
import { toDateKey } from "@/lib/mcp/plannerShapes";
import {
  DAY_NOT_FOUND,
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  runTool,
  toolResult,
} from "@/lib/mcp/toolRuntime";
import {
  activityFields,
  DESCRIPTION_EMPTY,
  isCaller,
  lookUpPlace,
  placeField,
  readDay,
  recordChange,
  scheduleOfCreate,
  startWrite,
  TIMES_NEED_FIXED,
  tripIdField,
  writeErrorResult,
  type ResolvedLocation,
} from "@/lib/mcp/tools/activityWrite";
import { UnstorableReceiptError } from "@/lib/repositories/aiChangeRepo";
import {
  applyDayPlanForTripDay,
  readDayPlanContextForWriter,
  type DayPlanActivityInput,
  type DayPlanLegInput,
} from "@/lib/repositories/dayPlanApplyRepo";
import type { GeoPoint } from "@/lib/geo/distance";
import { getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";
import { markdownToTiptapDoc, plainTextToTiptapDoc } from "@/lib/trips/planText";
import { legFromOsrm, SUGGESTION_MODE_ROUTING } from "@/lib/trips/suggestionPlan";
import {
  TRANSPORT_TYPES,
  transportTypeAllowsDistance,
  transportTypeRequiresDistance,
  type TransportType,
} from "@/lib/trips/transportTypes";
import {
  dayPlanItemMutationSchema,
  linkSchema,
  MAX_DAY_PLAN_APPLY_ACTIVITIES,
} from "@/lib/validation/dayPlanItemSchemas";

/**
 * Story 15.5. `apply_day_plan`: a whole day written in one call, as one stored change that undoes in one step.
 *
 * The tool does everything that may not sit inside the transaction, in this order, and writes nothing until
 * all of it passed:
 *
 * 1. The gate (`startWrite`) and the day (`readDayPlanContextForWriter`, the writer clause).
 * 2. Every activity through the app's `dayPlanItemMutationSchema`, before any geocoding, routing or write; a
 *    refusal names the 1-based entry (`Activity 3 ("Louvre"): …`). The legs' own rules (range, duplicates,
 *    the distance rule per mode, the link) are checked here too.
 * 3. Places by name, through the shared geocoder (`activityWriteDeps.geocode`).
 * 4. Legs without a duration or distance, routed as the leg dialog's route preview does
 *    (`dayPlanApplyDeps.route`, car, walking or cycling between two points with coordinates). A leg still
 *    without a duration (or a car leg without a distance) is skipped and reported, never stored.
 * 5. The write (`applyDayPlanForTripDay`), with the hook that records one `ai_changes` row.
 *
 * Costs are EUR only here (foreign currency and payment schedules are Story 15.6): `costEur` becomes
 * `costCents` and one payment of the full amount due on the day's date, the dialog's default row.
 */

/** The injection seam: tests replace `route` (`vi.spyOn`), so no test reaches OSRM. */
export const dayPlanApplyDeps = { route: getDayRouteFromOsrm };

const NO_ENTRY_BEFORE =
  "Nothing comes before the first activity (no earlier activity on the day and no stay last night), so there is no leg into it.";
const NOT_ROUTABLE = "No durationMinutes was given, and a route is only computed for car, walking and cycling legs.";
const NO_COORDINATES = "No durationMinutes was given, and a route needs both places with coordinates.";
const ROUTE_FAILED = "No durationMinutes was given, and the route could not be computed.";
const CAR_NEEDS_DISTANCE = "A car leg needs distanceKm, and it could not be computed.";
const ROUTE_CAP_REACHED =
  "No durationMinutes was given, and only 10 legs are routed per call; give durationMinutes for the others.";
const NOT_DRAWN =
  "The two entries are not next to each other in the final plan (a fixed activity is placed by its start time), so the leg was not created.";

/** The longest `subject` a plan's change stores: its titles joined by ", ". */
const MAX_SUBJECT_LENGTH = 120;

const subjectOf = (titles: string[]) => {
  // By code point, so an emoji at the cut is never split into half a surrogate pair.
  const characters = Array.from(titles.join(", "));
  return characters.length > MAX_SUBJECT_LENGTH
    ? `${characters.slice(0, MAX_SUBJECT_LENGTH - 1).join("")}…`
    : characters.join("");
};

/**
 * The most distinct place names one call may look up. Nominatim allows one request per second for the
 * whole server, so 50 names would hold every other user's lookup for close to a minute and run past a
 * client's patience; a plan's places are best given with coordinates anyway.
 */
const MAX_GEOCODED_PLACES = 10;
/**
 * The most legs one call routes. Each route may wait out the router's 3.5 s timeout, one after another; past
 * the cap a leg without its duration is skipped and reported, so a plan still writes in reasonable time.
 */
const MAX_ROUTED_LEGS = 10;
/** The largest cost an activity takes here, in EUR; its cents must fit the 32-bit column. */
const MAX_COST_EUR = 1_000_000;

const UNSTORABLE_RECEIPT = {
  replace:
    "This day holds data the undo cannot keep, so nothing was written. Use mode append, or change the day's " +
    "activities one by one.",
  append: "This plan could not be stored with its undo, so nothing was written. Add the activities one by one.",
} as const;

/** The key two name-only places share a lookup by. */
const placeNameKey = (name: string) => name.trim().toLowerCase();

const planActivity = z.object({
  ...activityFields,
  place: placeField
    .optional()
    .describe("Where it happens. A name alone is looked up on OpenStreetMap; give lat and lng to skip the lookup."),
  link: z.string().max(2000).optional().describe("A web link for the activity (http or https)."),
  costEur: z
    .number()
    .nonnegative()
    .max(MAX_COST_EUR)
    .refine(hasAtMostTwoDecimals, "costEur has at most two decimals (whole cents)")
    .optional()
    .describe(
      `The cost in EUR as an amount (e.g. 12.5), at most two decimals and at most ${MAX_COST_EUR}. Stored with ` +
        "one payment of the full amount due on the day's date.",
    ),
});

const planLeg = z.object({
  toActivity: z
    .number()
    .int()
    .min(1)
    .describe(
      "The 1-based activity this leg goes to. Leg n leaves from activity n-1; leg 1 leaves from the day's last " +
        "activity (append) or last night's stay (replace, or an empty day).",
    ),
  mode: z.enum(TRANSPORT_TYPES).describe("How the leg is travelled."),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Travel time in minutes. Left out: computed for car, walking and cycling between places with coordinates."),
  distanceKm: z
    .number()
    .positive()
    .optional()
    .describe("Distance in kilometres; not for ship or flight. Left out: computed like durationMinutes."),
  link: z.string().max(2000).optional().describe("A web link for the leg (http or https), e.g. a timetable."),
});

const applyInput = z.object({
  tripId: tripIdField,
  dayId: idSchema.describe("The day's id, from get_trip."),
  mode: z
    .enum(["append", "replace"])
    .describe("append: add after the day's last activity. replace: delete the day's activities and their legs first."),
  activities: z
    .array(planActivity)
    .min(1)
    .max(MAX_DAY_PLAN_APPLY_ACTIVITIES)
    .describe(`The activities in visiting order, 1 to ${MAX_DAY_PLAN_APPLY_ACTIVITIES}.`),
  legs: z.array(planLeg).max(MAX_DAY_PLAN_APPLY_ACTIVITIES).optional().describe("The travel legs into the activities."),
});

type PlanActivityArgs = z.infer<typeof planActivity>;
type PlanLegArgs = z.infer<typeof planLeg>;

const entryName = (index: number, title: string) => `Activity ${index + 1} ("${title}")`;

const issuesText = (issues: { message: string }[]) => [...new Set(issues.map((issue) => issue.message))].join("; ");

/** A leg's refusal, before anything is geocoded or routed; `null` when it passes. */
const legRefusal = (leg: PlanLegArgs, activityCount: number, seen: Set<number>): string | null => {
  const name = `Leg into activity ${leg.toActivity}`;
  if (leg.toActivity > activityCount) return `${name}: toActivity must be between 1 and ${activityCount}.`;
  if (seen.has(leg.toActivity)) return `${name}: there is already a leg into this activity.`;
  if (leg.distanceKm !== undefined && !transportTypeAllowsDistance(leg.mode)) {
    return `${name}: distanceKm is not allowed for ship and flight legs.`;
  }
  if (leg.link !== undefined) {
    const parsed = linkSchema.safeParse(leg.link);
    if (!parsed.success) return `${name}: ${issuesText(parsed.error.issues)}.`;
  }
  return null;
};

/**
 * The route between two points as the leg dialog's preview stores it, or `null` for no usable answer. Story
 * 15.6: exported for `create_leg`.
 */
export const routeLeg = async (mode: TransportType, from: GeoPoint, to: GeoPoint) => {
  const routing = (SUGGESTION_MODE_ROUTING as Partial<Record<TransportType, { profile: "driving" | "walking" | "cycling" }>>)[mode];
  if (!routing) return null;
  try {
    const route = await dayPlanApplyDeps.route({
      points: [from, to].map((point) => ({ lat: point.lat, lng: point.lng })),
      profile: routing.profile,
    });
    const leg = route.legs?.[0] ?? { durationSeconds: route.durationSeconds, distanceMeters: route.distanceMeters };
    return legFromOsrm(leg.durationSeconds, leg.distanceMeters);
  } catch {
    // Any routing failure leaves the leg to the "no duration" rule; the plan itself is still written.
    return null;
  }
};

export const registerDayPlanApplyTools = (server: McpServer) => {
  server.registerTool(
    "apply_day_plan",
    {
      title: "Write a whole day plan",
      description:
        "Writes a whole day of a trip in one step: mode append adds the activities after the day's last " +
        "activity, mode replace first deletes the day's activities and their legs. Each activity is flexible " +
        "(durationMinutes, default 15, its times computed from the day's order) or fixed (startTime HH:MM plus " +
        "endTime HH:MM or durationMinutes, ending by 23:59, placed by its start time). Optional: description " +
        "(simple Markdown; default the title), place (a name alone is looked up, at most 10 distinct names per call; give lat and lng to skip the lookup), link, costEur (EUR amount, " +
        "stored with one payment due on the day's date). legs: leg n goes from activity n-1 to activity n; leg 1 " +
        "from the day's last activity (append) or last night's stay. A missing durationMinutes or distanceKm is " +
        "computed for car, walking and cycling between places with coordinates (at most 10 legs routed per call); a leg still without a duration " +
        "(or a car leg without a distance), or one the final order does not join, is not created and listed in " +
        "skippedLegs with the reason; the activities are written anyway. Any invalid entry writes nothing, and " +
        "the message names it. The day is recomputed once; an over-full day is saved and returned with its " +
        "warnings. Returns aiChangeId, mode, activityIds (input order), deletedActivityCount, legsCreated, " +
        "skippedLegs and the day as get_day shows it. The whole call is one change: undo it with undo_ai_change.",
      inputSchema: applyInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "apply_day_plan", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const context = await readDayPlanContextForWriter({ userId, tripId: args.tripId, tripDayId: args.dayId });
        if (!context) return toolError(DAY_NOT_FOUND);
        const dueDate = toDateKey(context.date);

        // Every entry as the app's dialog would send it, checked before anything is geocoded or routed.
        const titles = args.activities.map((activity) => activity.title.trim());
        const payloadOf = (activity: PlanActivityArgs, index: number, location: ResolvedLocation) => {
          const costCents = activity.costEur !== undefined ? Math.round(activity.costEur * 100) : null;
          return {
            tripDayId: args.dayId,
            title: titles[index],
            contentJson:
              activity.description !== undefined
                ? markdownToTiptapDoc(activity.description)
                : plainTextToTiptapDoc(titles[index]),
            location,
            linkUrl: activity.link ?? null,
            costCents,
            payments: costCents === null ? null : [{ amountCents: costCents, dueDate }],
            ...scheduleOfCreate(activity),
          };
        };
        for (const [index, activity] of args.activities.entries()) {
          const name = entryName(index, titles[index]);
          if (activity.description !== undefined && activity.description.trim() === "") {
            return toolError(`${name}: ${DESCRIPTION_EMPTY}`);
          }
          if (activity.mode !== "fixed" && (activity.startTime !== undefined || activity.endTime !== undefined)) {
            return toolError(`${name}: ${TIMES_NEED_FIXED}`);
          }
          const parsed = dayPlanItemMutationSchema.safeParse(payloadOf(activity, index, null));
          if (!parsed.success) return toolError(`${name}: ${issuesText(parsed.error.issues)}.`);
        }
        const legs = args.legs ?? [];
        const seen = new Set<number>();
        for (const leg of legs) {
          const refusal = legRefusal(leg, args.activities.length, seen);
          if (refusal) return toolError(refusal);
          seen.add(leg.toActivity);
        }

        // Places by name, one geocoder slot per distinct name, refused up front past the cap.
        const nameKeyOf = (activity: PlanActivityArgs) =>
          activity.place && activity.place.lat === undefined && activity.place.name !== undefined
            ? placeNameKey(activity.place.name)
            : null;
        const names = new Set(args.activities.map(nameKeyOf).filter((key): key is string => key !== null));
        if (names.size > MAX_GEOCODED_PLACES) {
          return toolError(
            `At most ${MAX_GEOCODED_PLACES} places can be looked up by name in one call (${names.size} given); ` +
              "give place.lat and place.lng for the others.",
          );
        }
        const lookedUp = new Map<string, Awaited<ReturnType<typeof lookUpPlace>>>();
        const locations: ResolvedLocation[] = [];
        for (const [index, activity] of args.activities.entries()) {
          if (!activity.place) {
            locations.push(null);
            continue;
          }
          // Given coordinates are used as they are; only a name alone takes a geocoder slot, once per name.
          const key = nameKeyOf(activity);
          const place = (key !== null ? lookedUp.get(key) : undefined) ?? (await lookUpPlace(activity.place));
          if (key !== null) lookedUp.set(key, place);
          if ("refusal" in place) return toolError(`${entryName(index, titles[index])}: ${place.refusal}`);
          // The label is each activity's own name, even when the point came from an earlier lookup.
          locations.push(place.location ? { ...place.location, label: activity.place.name ?? null } : null);
        }
        const activities: DayPlanActivityInput[] = [];
        for (const [index, activity] of args.activities.entries()) {
          const parsed = dayPlanItemMutationSchema.safeParse(payloadOf(activity, index, locations[index]));
          if (!parsed.success) return toolError(`${entryName(index, titles[index])}: ${issuesText(parsed.error.issues)}.`);
          activities.push({
            title: parsed.data.title,
            contentJson: parsed.data.contentJson,
            scheduleMode: parsed.data.scheduleMode ?? "FLEXIBLE",
            durationMinutes: parsed.data.durationMinutes ?? null,
            fromTime: parsed.data.fromTime ?? null,
            toTime: parsed.data.toTime ?? null,
            location: locations[index],
            linkUrl: parsed.data.linkUrl ?? null,
            costCents: parsed.data.costCents ?? null,
            payments: parsed.data.payments ?? null,
          });
        }

        // The legs: given values first, the route preview's for what is missing, skipped when still unusable.
        const firstFrom = args.mode === "append" ? (context.lastItem ?? context.previousStay) : context.previousStay;
        const resolvedLegs: DayPlanLegInput[] = [];
        const skippedLegs: { toActivity: number; reason: string }[] = [];
        let routedLegs = 0;
        for (const leg of legs) {
          const toIndex = leg.toActivity - 1;
          if (toIndex === 0 && !firstFrom) {
            skippedLegs.push({ toActivity: leg.toActivity, reason: NO_ENTRY_BEFORE });
            continue;
          }
          let durationMinutes = leg.durationMinutes ?? null;
          let distanceKm = leg.distanceKm ?? null;
          // A route is asked for a missing duration, or for a distance only a car leg must have; one asked
          // anyway fills a missing optional distance too.
          const needsDistance = distanceKm === null && transportTypeRequiresDistance(leg.mode);
          const wantsDistance = distanceKm === null && transportTypeAllowsDistance(leg.mode);
          const from = toIndex === 0 ? (firstFrom?.point ?? null) : (locations[toIndex - 1] ?? null);
          const to = locations[toIndex];
          let missing: string | null = null;
          if (durationMinutes === null || needsDistance) {
            const routable = leg.mode in SUGGESTION_MODE_ROUTING;
            const capped = routedLegs >= MAX_ROUTED_LEGS;
            if (routable && from && to && !capped) routedLegs += 1;
            const routed = routable && from && to && !capped ? await routeLeg(leg.mode, from, to) : null;
            if (routed) {
              durationMinutes ??= routed.durationMinutes;
              if (wantsDistance) distanceKm = routed.distanceKm;
            } else {
              missing = !routable ? NOT_ROUTABLE : !from || !to ? NO_COORDINATES : capped ? ROUTE_CAP_REACHED : ROUTE_FAILED;
            }
          }
          if (durationMinutes === null) {
            skippedLegs.push({ toActivity: leg.toActivity, reason: missing ?? ROUTE_FAILED });
            continue;
          }
          if (transportTypeRequiresDistance(leg.mode) && distanceKm === null) {
            skippedLegs.push({ toActivity: leg.toActivity, reason: CAR_NEEDS_DISTANCE });
            continue;
          }
          resolvedLegs.push({
            toIndex,
            transportType: leg.mode,
            durationMinutes,
            distanceKm,
            linkUrl: leg.link?.trim() ?? null,
          });
        }

        const change = recordChange(
          caller,
          args.mode === "append" ? "planAppended" : "planReplaced",
          args.dayId,
          subjectOf(titles),
          // One step back is the point of the tool: a plan whose receipt cannot be stored is not written.
          { requireReceipt: true },
        );
        let applied;
        try {
          applied = await applyDayPlanForTripDay({
            userId,
            tripId: args.tripId,
            tripDayId: args.dayId,
            mode: args.mode,
            activities,
            legs: resolvedLegs,
            firstLegFromId: firstFrom?.id ?? null,
            origin: "ai",
            inTransaction: change.hook,
          });
        } catch (error) {
          if (error instanceof UnstorableReceiptError) return toolError(UNSTORABLE_RECEIPT[args.mode]);
          return writeErrorResult(error);
        }
        if (!applied) return toolError(DAY_NOT_FOUND);
        for (const skipped of applied.skippedLegs) {
          skippedLegs.push({ toActivity: skipped.toIndex + 1, reason: NOT_DRAWN });
        }

        return toolResult({
          aiChangeId: change.id(),
          mode: args.mode,
          activityIds: applied.itemIds,
          deletedActivityCount: applied.deletedCount,
          legsCreated: applied.legsCreated,
          skippedLegs: skippedLegs.sort((left, right) => left.toActivity - right.toActivity),
          day: await readDay(userId, args.tripId, args.dayId),
        });
      }),
  );
};
