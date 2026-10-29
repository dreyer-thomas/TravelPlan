import { prisma } from "@/lib/db/prisma";
import type { AccommodationStatus, DayPlanItemScheduleMode, TravelSegmentItemType, TravelTransportType } from "@/generated/prisma/enums";
import { canTripAccessRoleWrite, deriveTripAccessRole } from "@/lib/auth/tripAccessRole";
import { type PaymentDetail, toPaymentDetails } from "@/lib/repositories/paymentDetail";
import { buildStoredSegmentPairKey } from "@/lib/repositories/travelSegmentRepo";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import { buildDrawnDaySegmentPairKeys } from "@/lib/trips/daySegmentPairs";
import { buildScheduleInput, derivePlanConflicts, type DayPlanConflict } from "@/lib/trips/planConflicts";

/**
 * Story 15.2. The reads behind the connector's planning tools that no app surface already answers: one
 * day with every entry's `updatedAt` (what 15.4's write tools compare) and its documents and images by
 * id, and the media of the bucket list's parked activities. All Prisma access of the read tools lives
 * here (Epic 15 shared rule: tools call repositories only).
 *
 * Writers only (ruling R1): a viewer, a removed member and a stranger all get `null`, which the tools
 * answer as "Trip not found". The tools gate with `getTripAccessForUser` first; the `where` and the
 * derived role below are the second check, as `getTripWithDaysForUser` re-derives its own.
 */

const writerTripWhere = (userId: string, tripId: string) => ({
  id: tripId,
  OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" as const } } }],
});

const mediaOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

const paymentsSelect = {
  select: { amountCents: true, dueDate: true, amountOriginal: true },
  orderBy: mediaOrder,
};

const costSelect = {
  costCents: true,
  costOriginalAmount: true,
  costCurrency: true,
  costRate: true,
  costRateDate: true,
  payments: paymentsSelect,
};

const mediaSelect = {
  images: { select: { id: true, imageUrl: true }, orderBy: mediaOrder },
  documents: { select: { id: true, fileName: true }, orderBy: mediaOrder },
};

export type PlannerMedia = {
  documents: { id: string; fileName: string }[];
  images: { id: string; imageUrl: string }[];
};

export type PlannerCost = {
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: PaymentDetail[];
};

export type PlannerLocation = { lat: number; lng: number; label: string | null } | null;

export type PlannerItem = PlannerCost &
  PlannerMedia & {
    id: string;
    title: string | null;
    contentJson: string;
    scheduleMode: DayPlanItemScheduleMode;
    durationMinutes: number;
    fromTime: string | null;
    toTime: string | null;
    linkUrl: string | null;
    location: PlannerLocation;
    updatedAt: Date;
    /** Story 15.4. When the connector last wrote the row; `null` once a person has edited it. */
    aiChangedAt: Date | null;
  };

export type PlannerStay = PlannerCost &
  PlannerMedia & {
    id: string;
    name: string;
    status: AccommodationStatus;
    checkInTime: string | null;
    checkOutTime: string | null;
    link: string | null;
    notes: string | null;
    location: PlannerLocation;
    updatedAt: Date;
    aiChangedAt: Date | null;
  };

export type PlannerLeg = {
  id: string;
  fromItemType: TravelSegmentItemType;
  fromItemId: string;
  toItemType: TravelSegmentItemType;
  toItemId: string;
  transportType: TravelTransportType;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
  updatedAt: Date;
  aiChangedAt: Date | null;
};

export type PlannerDay = {
  id: string;
  date: Date;
  dayIndex: number;
  /** Last night's stay by the schedule's rule (raw row, whatever its name); `null` when there is none. */
  previousStay: { id: string; name: string; checkOutTime: string | null } | null;
  /** In the day's order (`compareDayPlanItemsByOrder`). */
  items: PlannerItem[];
  /** The legs the day view draws (orphans left out), in `createdAt` order. */
  legs: PlannerLeg[];
  /** `null` when the stay's name is blank: the overview's rule, as `missingStay`. */
  stay: PlannerStay | null;
  missingStay: boolean;
  warnings: DayPlanConflict[];
};

/** `null`: no trip this user may plan. `{ day: null }`: the trip, but no such day in it. */
export type PlannerDayResult = { day: PlannerDay | null } | null;

const toLocation = (row: { locationLat: number | null; locationLng: number | null; locationLabel: string | null }) =>
  row.locationLat !== null && row.locationLng !== null
    ? { lat: row.locationLat, lng: row.locationLng, label: row.locationLabel }
    : null;

/**
 * One day of a trip the user may plan, by id or by `YYYY-MM-DD` date. The trip's days and their raw stays
 * come first (for the previous-stay walk), then the target day in full; both reads run in one transaction,
 * so the warnings are derived from one snapshot.
 */
export const getPlannerDayForUser = async (params: {
  userId: string;
  tripId: string;
  day: { id: string } | { date: string };
}): Promise<PlannerDayResult> => {
  const { userId, tripId } = params;
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: writerTripWhere(userId, tripId),
      select: {
        id: true,
        userId: true,
        members: { where: { userId }, select: { userId: true, role: true }, take: 1 },
        days: {
          orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
          select: {
            id: true,
            date: true,
            dayIndex: true,
            accommodation: { select: { id: true, name: true, checkOutTime: true } },
          },
        },
      },
    });
    if (!trip || !canTripAccessRoleWrite(deriveTripAccessRole(userId, trip))) return null;

    const position = trip.days.findIndex((day) =>
      "id" in params.day ? day.id === params.day.id : day.date.toISOString().slice(0, 10) === params.day.date,
    );
    if (position < 0) return { day: null };
    const target = trip.days[position];

    // Story 13.2 §3. The writes' rule (`readScheduleInputInTransaction`): last night's stay is the raw
    // accommodation row of the nearest earlier day with a lower `dayIndex`, whatever its name. `days` is
    // ordered by `[dayIndex, date]`, so that is the first lower one walking back.
    let previousStay: PlannerDay["previousStay"] = null;
    for (let index = position - 1; index >= 0; index -= 1) {
      if (trip.days[index].dayIndex < target.dayIndex) {
        previousStay = trip.days[index].accommodation;
        break;
      }
    }

    const day = await tx.tripDay.findFirst({
      where: { id: target.id, tripId: trip.id },
      select: {
        dayPlanItems: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            title: true,
            contentJson: true,
            scheduleMode: true,
            durationMinutes: true,
            sortOrder: true,
            fromTime: true,
            toTime: true,
            createdAt: true,
            updatedAt: true,
            aiChangedAt: true,
            linkUrl: true,
            locationLat: true,
            locationLng: true,
            locationLabel: true,
            ...costSelect,
            ...mediaSelect,
          },
        },
        travelSegments: {
          // Story 15.5: `id` breaks a `createdAt` tie, so a leg an undo recreated reads where it did before.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            fromItemType: true,
            fromItemId: true,
            toItemType: true,
            toItemId: true,
            transportType: true,
            durationMinutes: true,
            distanceKm: true,
            linkUrl: true,
            updatedAt: true,
            aiChangedAt: true,
          },
        },
        accommodation: {
          select: {
            id: true,
            name: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            link: true,
            notes: true,
            updatedAt: true,
            aiChangedAt: true,
            locationLat: true,
            locationLng: true,
            locationLabel: true,
            ...costSelect,
            ...mediaSelect,
          },
        },
      },
    });
    if (!day) return { day: null };

    const orderedItems = [...day.dayPlanItems].sort(compareDayPlanItemsByOrder);
    const warnings = derivePlanConflicts(
      buildScheduleInput({ items: orderedItems, legs: day.travelSegments, previousStay }),
    );
    // Review D1 (Tommy, 2026-10-29): only the legs the day view draws. An orphaned row (its endpoints no
    // longer neighbours) would read to the model as travel that is not on the plan. The endpoint order is
    // `buildSegmentTimelineInTransaction`'s: last night's stay, the activities, tonight's raw stay.
    const drawnKeys = buildDrawnDaySegmentPairKeys([
      ...(previousStay ? [{ type: "accommodation" as const, id: previousStay.id }] : []),
      ...orderedItems.map((item) => ({ type: "dayPlanItem" as const, id: item.id })),
      ...(day.accommodation ? [{ type: "accommodation" as const, id: day.accommodation.id }] : []),
    ]);
    const stayName = day.accommodation?.name.trim() ?? "";
    const stay = day.accommodation && stayName ? day.accommodation : null;

    return {
      day: {
        id: target.id,
        date: target.date,
        dayIndex: target.dayIndex,
        previousStay,
        items: orderedItems.map((item) => ({
          id: item.id,
          title: item.title,
          contentJson: item.contentJson,
          scheduleMode: item.scheduleMode,
          durationMinutes: item.durationMinutes,
          fromTime: item.fromTime,
          toTime: item.toTime,
          linkUrl: item.linkUrl,
          location: toLocation(item),
          costCents: item.costCents,
          costOriginalAmount: item.costOriginalAmount,
          costCurrency: item.costCurrency,
          costRate: item.costRate,
          costRateDate: item.costRateDate,
          payments: toPaymentDetails(item.payments),
          documents: item.documents,
          images: item.images,
          updatedAt: item.updatedAt,
          aiChangedAt: item.aiChangedAt,
        })),
        legs: day.travelSegments.filter((leg) => drawnKeys.has(buildStoredSegmentPairKey(leg))),
        stay: stay
          ? {
              id: stay.id,
              name: stayName,
              status: stay.status,
              checkInTime: stay.checkInTime,
              checkOutTime: stay.checkOutTime,
              link: stay.link,
              notes: stay.notes,
              location: toLocation(stay),
              costCents: stay.costCents,
              costOriginalAmount: stay.costOriginalAmount,
              costCurrency: stay.costCurrency,
              costRate: stay.costRate,
              costRateDate: stay.costRateDate,
              payments: toPaymentDetails(stay.payments),
              documents: stay.documents,
              images: stay.images,
              updatedAt: stay.updatedAt,
              aiChangedAt: stay.aiChangedAt,
            }
          : null,
        missingStay: stay === null,
        warnings,
      },
    };
  });
};

/**
 * The documents and images of the trip's parked activities, by activity id, for `get_bucket_list` (the
 * bucket list read carries only the first image's URL). Scoped to parked rows of a trip the user may plan;
 * an id that is not one of them simply has no entry.
 */
export const listParkedItemMediaForPlanner = async (params: {
  userId: string;
  tripId: string;
  itemIds: string[];
}): Promise<Map<string, PlannerMedia>> => {
  const { userId, tripId, itemIds } = params;
  const media = new Map<string, PlannerMedia>();
  if (itemIds.length === 0) return media;
  const where = {
    dayPlanItemId: { in: itemIds },
    dayPlanItem: { tripId, tripDayId: null, trip: writerTripWhere(userId, tripId) },
  };
  const [documents, images] = await Promise.all([
    prisma.dayPlanItemDocument.findMany({
      where,
      orderBy: [{ dayPlanItemId: "asc" }, ...mediaOrder],
      select: { id: true, dayPlanItemId: true, fileName: true },
    }),
    prisma.dayPlanItemImage.findMany({
      where,
      orderBy: [{ dayPlanItemId: "asc" }, ...mediaOrder],
      select: { id: true, dayPlanItemId: true, imageUrl: true },
    }),
  ]);
  const entry = (itemId: string) => {
    let value = media.get(itemId);
    if (!value) {
      value = { documents: [], images: [] };
      media.set(itemId, value);
    }
    return value;
  };
  for (const document of documents) entry(document.dayPlanItemId).documents.push({ id: document.id, fileName: document.fileName });
  for (const image of images) entry(image.dayPlanItemId).images.push({ id: image.id, imageUrl: image.imageUrl });
  return media;
};

/**
 * Story 15.4. One activity of a trip the user may plan, on a day or parked, with the stored fields an
 * `update_activity` merges its input over (cost, payments and link pass through unchanged). `null`: no
 * trip this user may plan. `{ activity: null }`: no such activity on this trip.
 */
export type PlannerActivityRow = {
  id: string;
  /** `null` for a parked activity (the bucket list). */
  tripDayId: string | null;
  title: string;
  contentJson: string;
  scheduleMode: DayPlanItemScheduleMode;
  durationMinutes: number;
  fromTime: string | null;
  toTime: string | null;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  /** In stored order, with the original amount where there is one: what the repositories write back. */
  payments: { amountCents: number; dueDate: string; amountOriginal: number | null }[];
  linkUrl: string | null;
  location: PlannerLocation;
  updatedAt: Date;
};

export const findActivityForPlanner = async (params: {
  userId: string;
  tripId: string;
  activityId: string;
}): Promise<{ activity: PlannerActivityRow | null } | null> => {
  const { userId, tripId, activityId } = params;
  const trip = await prisma.trip.findFirst({ where: writerTripWhere(userId, tripId), select: { id: true } });
  if (!trip) return null;
  // Day rows carry `tripId` too (Story 14.1), so one `tripId` filter finds both sides.
  const row = await prisma.dayPlanItem.findFirst({
    where: { id: activityId, tripId: trip.id },
    select: {
      id: true,
      tripDayId: true,
      title: true,
      contentJson: true,
      scheduleMode: true,
      durationMinutes: true,
      fromTime: true,
      toTime: true,
      costCents: true,
      costOriginalAmount: true,
      costCurrency: true,
      costRate: true,
      costRateDate: true,
      payments: paymentsSelect,
      linkUrl: true,
      locationLat: true,
      locationLng: true,
      locationLabel: true,
      updatedAt: true,
    },
  });
  if (!row) return { activity: null };
  return {
    activity: {
      id: row.id,
      tripDayId: row.tripDayId,
      title: row.title ?? "",
      contentJson: row.contentJson,
      scheduleMode: row.scheduleMode,
      durationMinutes: row.durationMinutes,
      fromTime: row.fromTime,
      toTime: row.toTime,
      costCents: row.costCents,
      costOriginalAmount: row.costOriginalAmount,
      costCurrency: row.costCurrency,
      costRate: row.costRate,
      costRateDate: row.costRateDate,
      payments: row.payments,
      linkUrl: row.linkUrl,
      location: toLocation(row),
      updatedAt: row.updatedAt,
    },
  };
};

/** Story 15.4. Whether `tripDayId` is a day of a trip the user may plan. */
export const isPlannerDayOfTrip = async (params: { userId: string; tripId: string; tripDayId: string }) => {
  const day = await prisma.tripDay.findFirst({
    where: { id: params.tripDayId, trip: writerTripWhere(params.userId, params.tripId) },
    select: { id: true },
  });
  return day !== null;
};

/**
 * Story 15.6. The stored stay of a day (the raw row, whatever its name) with the fields `set_stay` merges its
 * input over, and the day's date (a cost's default payment is due on it). `null`: no trip this user may
 * plan. `{ day: null }`: no such day on the trip. `stay: null`: the day has no stay.
 */
export type PlannerStayRow = {
  id: string;
  tripDayId: string;
  name: string;
  status: AccommodationStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  link: string | null;
  notes: string | null;
  location: PlannerLocation;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  /** In stored order, with the original amount where there is one: what the repository writes back. */
  payments: { amountCents: number; dueDate: string; amountOriginal: number | null }[];
  updatedAt: Date;
};

export const findStayForPlanner = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<{ day: { id: string; date: Date; stay: PlannerStayRow | null } | null } | null> => {
  const { userId, tripId, tripDayId } = params;
  const trip = await prisma.trip.findFirst({ where: writerTripWhere(userId, tripId), select: { id: true } });
  if (!trip) return null;
  const day = await prisma.tripDay.findFirst({
    where: { id: tripDayId, tripId: trip.id },
    select: {
      id: true,
      date: true,
      accommodation: {
        select: {
          id: true,
          tripDayId: true,
          name: true,
          status: true,
          checkInTime: true,
          checkOutTime: true,
          link: true,
          notes: true,
          locationLat: true,
          locationLng: true,
          locationLabel: true,
          updatedAt: true,
          ...costSelect,
        },
      },
    },
  });
  if (!day) return { day: null };
  const stay = day.accommodation;
  return {
    day: {
      id: day.id,
      date: day.date,
      stay: stay
        ? {
            id: stay.id,
            tripDayId: stay.tripDayId,
            name: stay.name,
            status: stay.status,
            checkInTime: stay.checkInTime,
            checkOutTime: stay.checkOutTime,
            link: stay.link,
            notes: stay.notes,
            location: toLocation(stay),
            costCents: stay.costCents,
            costOriginalAmount: stay.costOriginalAmount,
            costCurrency: stay.costCurrency,
            costRate: stay.costRate,
            costRateDate: stay.costRateDate,
            payments: stay.payments,
            updatedAt: stay.updatedAt,
          }
        : null,
    },
  };
};

/**
 * Story 15.6. One stored leg of a trip the user may plan, with the fields `update_leg` merges its input over.
 * `null`: no trip this user may plan. `{ leg: null }`: no such leg on this trip.
 */
export type PlannerLegRow = Omit<PlannerLeg, "aiChangedAt"> & { tripDayId: string };

export const findLegForPlanner = async (params: {
  userId: string;
  tripId: string;
  legId: string;
}): Promise<{ leg: PlannerLegRow | null } | null> => {
  const { userId, tripId, legId } = params;
  const trip = await prisma.trip.findFirst({ where: writerTripWhere(userId, tripId), select: { id: true } });
  if (!trip) return null;
  const leg = await prisma.travelSegment.findFirst({
    where: { id: legId, tripDay: { tripId: trip.id } },
    select: {
      id: true,
      tripDayId: true,
      fromItemType: true,
      fromItemId: true,
      toItemType: true,
      toItemId: true,
      transportType: true,
      durationMinutes: true,
      distanceKm: true,
      linkUrl: true,
      updatedAt: true,
    },
  });
  return { leg };
};
