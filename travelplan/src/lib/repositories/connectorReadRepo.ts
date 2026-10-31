import { prisma } from "@/lib/db/prisma";
import type { AccommodationStatus, DayPlanItemScheduleMode, TravelSegmentItemType, TravelTransportType } from "@/generated/prisma/enums";
import { canTripAccessRoleWrite, deriveTripAccessRole } from "@/lib/auth/tripAccessRole";
import { type PaymentDetail, toPaymentDetails } from "@/lib/repositories/paymentDetail";
import { buildStoredSegmentPairKey } from "@/lib/repositories/travelSegmentRepo";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import { buildDrawnDaySegmentPairKeys } from "@/lib/trips/daySegmentPairs";
import { fileNameOfUrl } from "@/lib/mcp/plannerShapes";
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

/**
 * Story 15.7: each file's `updatedAt` too, which `delete_file` compares. Story 15.8: a document's stored URL,
 * so its link is signed only when it lies on disk; it never reaches the model (`toFiles` drops it).
 */
const mediaSelect = {
  images: { select: { id: true, imageUrl: true, updatedAt: true }, orderBy: mediaOrder },
  documents: { select: { id: true, fileName: true, documentUrl: true, updatedAt: true }, orderBy: mediaOrder },
};

export type PlannerMedia = {
  documents: { id: string; fileName: string; documentUrl: string; updatedAt: Date }[];
  images: { id: string; imageUrl: string; updatedAt: Date }[];
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
  /** Story 15.9. The day's own note and picture (as stored), its stamp and its KI/AI marker. */
  note: string | null;
  imageUrl: string | null;
  updatedAt: Date;
  aiChangedAt: Date | null;
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
        // Story 15.9. Read through Prisma, not raw SQL: Prisma reads the app's second-precision
        // `CURRENT_TIMESTAMP` text as UTC, so the stamp the model gets back compares equal in `update_day`.
        note: true,
        imageUrl: true,
        updatedAt: true,
        aiChangedAt: true,
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
        note: day.note,
        imageUrl: day.imageUrl,
        updatedAt: day.updatedAt,
        aiChangedAt: day.aiChangedAt,
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
      select: { id: true, dayPlanItemId: true, fileName: true, documentUrl: true, updatedAt: true },
    }),
    prisma.dayPlanItemImage.findMany({
      where,
      orderBy: [{ dayPlanItemId: "asc" }, ...mediaOrder],
      select: { id: true, dayPlanItemId: true, imageUrl: true, updatedAt: true },
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
  for (const document of documents) {
    const { id, fileName, documentUrl, updatedAt } = document;
    entry(document.dayPlanItemId).documents.push({ id, fileName, documentUrl, updatedAt });
  }
  for (const image of images) {
    entry(image.dayPlanItemId).images.push({ id: image.id, imageUrl: image.imageUrl, updatedAt: image.updatedAt });
  }
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

/**
 * Story 15.7. One file of a trip the user may plan, by the id `get_day` or `get_bucket_list` gave it: a row of
 * any of the four media tables (an activity's or a stay's documents and images). `media` and `target` say
 * which; `tripDayId` is the parent's day (`null` for a parked activity); `url` is the stored address, for the
 * file tools only (never handed to the model). An image has no name of its own, so `fileName` is its URL's
 * last segment, as `get_day` shows it. `null` when there is no such file on a trip this user may plan; the
 * caller has already answered the trip itself.
 *
 * Story 15.9: or the day's own picture, whose id is the day's id (`target: "day"`, `parentId` and `tripDayId`
 * the day, no title). A day with no picture, or a blank stored URL, has no such file.
 */
export type PlannerFileRow = {
  id: string;
  media: "document" | "image";
  target: "activity" | "stay" | "day";
  parentId: string;
  parentTitle: string | null;
  tripDayId: string | null;
  url: string;
  fileName: string;
  updatedAt: Date;
  aiChangedAt: Date | null;
};

export const findFileForPlanner = async (params: {
  userId: string;
  tripId: string;
  fileId: string;
}): Promise<PlannerFileRow | null> => {
  const { userId, tripId, fileId } = params;
  const itemWhere = { tripId, trip: writerTripWhere(userId, tripId) };
  const stayWhere = { tripDay: { tripId, trip: writerTripWhere(userId, tripId) } };
  const stamps = { id: true, updatedAt: true, aiChangedAt: true } as const;
  const item = { select: { id: true, title: true, tripDayId: true } } as const;
  const stay = { select: { id: true, name: true, tripDayId: true } } as const;
  // Ids are cuids, unique across tables in practice; the five reads are one indexed lookup each.
  const [itemDocument, itemImage, stayDocument, stayImage, dayPicture] = await Promise.all([
    prisma.dayPlanItemDocument.findFirst({
      where: { id: fileId, dayPlanItem: itemWhere },
      select: { ...stamps, documentUrl: true, fileName: true, dayPlanItem: item },
    }),
    prisma.dayPlanItemImage.findFirst({
      where: { id: fileId, dayPlanItem: itemWhere },
      select: { ...stamps, imageUrl: true, dayPlanItem: item },
    }),
    prisma.accommodationDocument.findFirst({
      where: { id: fileId, accommodation: stayWhere },
      select: { ...stamps, documentUrl: true, fileName: true, accommodation: stay },
    }),
    prisma.accommodationImage.findFirst({
      where: { id: fileId, accommodation: stayWhere },
      select: { ...stamps, imageUrl: true, accommodation: stay },
    }),
    // Story 15.9. The day's own picture.
    prisma.tripDay.findFirst({
      where: { id: fileId, tripId, trip: writerTripWhere(userId, tripId), imageUrl: { not: null } },
      select: { ...stamps, imageUrl: true },
    }),
  ]);
  const base = (row: { id: string; updatedAt: Date; aiChangedAt: Date | null }) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    aiChangedAt: row.aiChangedAt,
  });
  if (itemDocument) {
    const parent = itemDocument.dayPlanItem;
    return {
      ...base(itemDocument),
      media: "document",
      target: "activity",
      parentId: parent.id,
      parentTitle: parent.title,
      tripDayId: parent.tripDayId,
      url: itemDocument.documentUrl,
      fileName: itemDocument.fileName,
    };
  }
  if (itemImage) {
    const parent = itemImage.dayPlanItem;
    return {
      ...base(itemImage),
      media: "image",
      target: "activity",
      parentId: parent.id,
      parentTitle: parent.title,
      tripDayId: parent.tripDayId,
      url: itemImage.imageUrl,
      fileName: fileNameOfUrl(itemImage.imageUrl),
    };
  }
  if (stayDocument) {
    const parent = stayDocument.accommodation;
    return {
      ...base(stayDocument),
      media: "document",
      target: "stay",
      parentId: parent.id,
      parentTitle: parent.name,
      tripDayId: parent.tripDayId,
      url: stayDocument.documentUrl,
      fileName: stayDocument.fileName,
    };
  }
  if (stayImage) {
    const parent = stayImage.accommodation;
    return {
      ...base(stayImage),
      media: "image",
      target: "stay",
      parentId: parent.id,
      parentTitle: parent.name,
      tripDayId: parent.tripDayId,
      url: stayImage.imageUrl,
      fileName: fileNameOfUrl(stayImage.imageUrl),
    };
  }
  if (dayPicture?.imageUrl?.trim()) {
    return {
      ...base(dayPicture),
      media: "image",
      target: "day",
      parentId: dayPicture.id,
      parentTitle: null,
      tripDayId: dayPicture.id,
      url: dayPicture.imageUrl,
      fileName: fileNameOfUrl(dayPicture.imageUrl),
    };
  }
  return null;
};

/**
 * Story 15.8. One file by id alone, for the `/f/` route: **no user or writer filter**, because there the
 * verified link signature is the grant (it is minted only inside a tool call that passed the writer check).
 * `tripId` is the trip whose upload tree the file must lie in; `url` is the stored address, never sent out.
 */
export type SignedLinkFileRow = {
  id: string;
  tripId: string;
  media: "document" | "image";
  url: string;
  fileName: string;
};

export const findFileForSignedLink = async (fileId: string): Promise<SignedLinkFileRow | null> => {
  const item = { select: { tripId: true } } as const;
  const stay = { select: { tripDay: { select: { tripId: true } } } } as const;
  const [itemDocument, itemImage, stayDocument, stayImage, dayPicture] = await Promise.all([
    prisma.dayPlanItemDocument.findUnique({
      where: { id: fileId },
      select: { id: true, documentUrl: true, fileName: true, dayPlanItem: item },
    }),
    prisma.dayPlanItemImage.findUnique({ where: { id: fileId }, select: { id: true, imageUrl: true, dayPlanItem: item } }),
    prisma.accommodationDocument.findUnique({
      where: { id: fileId },
      select: { id: true, documentUrl: true, fileName: true, accommodation: stay },
    }),
    prisma.accommodationImage.findUnique({ where: { id: fileId }, select: { id: true, imageUrl: true, accommodation: stay } }),
    // Story 15.9. The day's own picture, whose file id is the day's id.
    prisma.tripDay.findUnique({ where: { id: fileId }, select: { id: true, tripId: true, imageUrl: true } }),
  ]);
  if (itemDocument) {
    const { id, documentUrl, fileName, dayPlanItem } = itemDocument;
    return { id, tripId: dayPlanItem.tripId, media: "document", url: documentUrl, fileName };
  }
  if (itemImage) {
    const { id, imageUrl, dayPlanItem } = itemImage;
    return { id, tripId: dayPlanItem.tripId, media: "image", url: imageUrl, fileName: fileNameOfUrl(imageUrl) };
  }
  if (stayDocument) {
    const { id, documentUrl, fileName, accommodation } = stayDocument;
    return { id, tripId: accommodation.tripDay.tripId, media: "document", url: documentUrl, fileName };
  }
  if (stayImage) {
    const { id, imageUrl, accommodation } = stayImage;
    return { id, tripId: accommodation.tripDay.tripId, media: "image", url: imageUrl, fileName: fileNameOfUrl(imageUrl) };
  }
  if (dayPicture?.imageUrl?.trim()) {
    const { id, tripId, imageUrl } = dayPicture;
    return { id, tripId, media: "image", url: imageUrl, fileName: fileNameOfUrl(imageUrl) };
  }
  return null;
};

/**
 * Story 15.7. The entry `attach_file` attaches to: an activity (on a day or parked) or a stay of a trip the
 * user may plan, with its current day (`null` for a parked activity: the folder the file goes to), its title
 * or name, and how many documents it holds (the cap is checked before any download). `null` when there is
 * no such entry on a trip this user may plan.
 */
export type PlannerFileParent = {
  id: string;
  tripDayId: string | null;
  title: string | null;
  documentCount: number;
};

export const findFileParentForPlanner = async (params: {
  userId: string;
  tripId: string;
  target: "activity" | "stay";
  parentId: string;
}): Promise<PlannerFileParent | null> => {
  const { userId, tripId, target, parentId } = params;
  if (target === "activity") {
    const item = await prisma.dayPlanItem.findFirst({
      where: { id: parentId, tripId, trip: writerTripWhere(userId, tripId) },
      select: { id: true, tripDayId: true, title: true, _count: { select: { documents: true } } },
    });
    return item && { id: item.id, tripDayId: item.tripDayId, title: item.title, documentCount: item._count.documents };
  }
  const stay = await prisma.accommodation.findFirst({
    where: { id: parentId, tripDay: { tripId, trip: writerTripWhere(userId, tripId) } },
    select: { id: true, tripDayId: true, name: true, _count: { select: { documents: true } } },
  });
  return stay && { id: stay.id, tripDayId: stay.tripDayId, title: stay.name, documentCount: stay._count.documents };
};
