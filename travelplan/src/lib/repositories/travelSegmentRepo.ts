import { prisma } from "@/lib/db/prisma";
import type { TravelSegmentItemType, TravelTransportType } from "@/generated/prisma/enums";

/** Lowercase wire vocabulary for `TravelTransportType`, mirroring `TravelSegmentItemTypeInput`. */
export type TransportTypeInput = "car" | "ship" | "flight" | "walking" | "cycling";

export type TravelSegmentDetail = {
  id: string;
  tripDayId: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: TransportTypeInput;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TravelSegmentUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "not_adjacent" }
  | { status: "updated"; segment: TravelSegmentDetail };

export type TravelSegmentDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

export type TravelSegmentCreateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "not_adjacent" }
  | { status: "created"; segment: TravelSegmentDetail };

type TravelSegmentItemTypeInput = "accommodation" | "dayPlanItem";

type TravelSegmentMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  fromItemType: TravelSegmentItemTypeInput;
  fromItemId: string;
  toItemType: TravelSegmentItemTypeInput;
  toItemId: string;
  transportType: TransportTypeInput;
  durationMinutes: number;
  distanceKm?: number | null;
  linkUrl?: string | null;
};

type TravelSegmentUpdateParams = TravelSegmentMutationParams & { segmentId: string };

type TravelSegmentDeleteParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  segmentId: string;
};

type SegmentTimelineItem = {
  id: string;
  type: TravelSegmentItemTypeInput;
};

const toPrismaItemType = (value: TravelSegmentItemTypeInput): TravelSegmentItemType =>
  value === "accommodation" ? "ACCOMMODATION" : "DAY_PLAN_ITEM";

// Both directions are exhaustive rather than `default`-terminated: a `default` here would have
// quietly stored every mode added after FLIGHT *as* FLIGHT. Story 6.16 added two, so the compiler
// has to be the one that notices the next one.
const toPrismaTransportType = (value: TransportTypeInput): TravelTransportType => {
  switch (value) {
    case "car":
      return "CAR";
    case "ship":
      return "SHIP";
    case "flight":
      return "FLIGHT";
    case "walking":
      return "WALKING";
    case "cycling":
      return "CYCLING";
    default: {
      const unhandled: never = value;
      throw new Error(`Unhandled travel transport type: ${String(unhandled)}`);
    }
  }
};

const fromPrismaItemType = (value: TravelSegmentItemType): TravelSegmentItemTypeInput =>
  value === "ACCOMMODATION" ? "accommodation" : "dayPlanItem";

const fromPrismaTransportType = (value: TravelTransportType): TransportTypeInput => {
  switch (value) {
    case "CAR":
      return "car";
    case "SHIP":
      return "ship";
    case "FLIGHT":
      return "flight";
    case "WALKING":
      return "walking";
    case "CYCLING":
      return "cycling";
    default: {
      const unhandled: never = value;
      throw new Error(`Unhandled travel transport type: ${String(unhandled)}`);
    }
  }
};

const toDetail = (segment: {
  id: string;
  tripDayId: string;
  fromItemType: TravelSegmentItemType;
  fromItemId: string;
  toItemType: TravelSegmentItemType;
  toItemId: string;
  transportType: TravelTransportType;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TravelSegmentDetail => ({
  id: segment.id,
  tripDayId: segment.tripDayId,
  fromItemType: fromPrismaItemType(segment.fromItemType),
  fromItemId: segment.fromItemId,
  toItemType: fromPrismaItemType(segment.toItemType),
  toItemId: segment.toItemId,
  transportType: fromPrismaTransportType(segment.transportType),
  durationMinutes: segment.durationMinutes,
  distanceKm: segment.distanceKm,
  linkUrl: segment.linkUrl,
  createdAt: segment.createdAt,
  updatedAt: segment.updatedAt,
});

const findTripDayForUser = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: { userId },
    },
    select: { id: true },
  });

const findTripDayForTripParticipant = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId } } }],
      },
    },
    select: { id: true },
  });

const findTripDayForTripWriter = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
    select: { id: true },
  });

const comparePlanItemsByStartTime = (
  left: { fromTime: string | null; createdAt: Date; id: string },
  right: { fromTime: string | null; createdAt: Date; id: string },
) => {
  const leftHasStart = Boolean(left.fromTime);
  const rightHasStart = Boolean(right.fromTime);
  if (leftHasStart && rightHasStart) {
    if (left.fromTime !== right.fromTime) return left.fromTime!.localeCompare(right.fromTime!);
  } else if (leftHasStart !== rightHasStart) {
    return leftHasStart ? -1 : 1;
  }

  const leftTime = left.createdAt.getTime();
  const rightTime = right.createdAt.getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
};

const buildSegmentTimeline = async (
  userId: string,
  tripId: string,
  tripDayId: string,
): Promise<SegmentTimelineItem[] | null> => {
  const day = await prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
    select: {
      id: true,
      dayIndex: true,
      accommodation: { select: { id: true } },
      dayPlanItems: {
        select: { id: true, fromTime: true, createdAt: true },
      },
    },
  });

  if (!day) return null;

  const previousDay = await prisma.tripDay.findFirst({
    where: {
      tripId,
      dayIndex: { lt: day.dayIndex },
    },
    orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
    select: {
      accommodation: { select: { id: true } },
    },
  });

  const timeline: SegmentTimelineItem[] = [];
  if (previousDay?.accommodation?.id) {
    timeline.push({ id: previousDay.accommodation.id, type: "accommodation" });
  }

  const sortedPlanItems = [...day.dayPlanItems].sort(comparePlanItemsByStartTime);
  for (const item of sortedPlanItems) {
    timeline.push({ id: item.id, type: "dayPlanItem" });
  }

  if (day.accommodation?.id) {
    timeline.push({ id: day.accommodation.id, type: "accommodation" });
  }

  return timeline;
};

const ensureSegmentItemsExist = async (
  params: TravelSegmentMutationParams,
): Promise<"ok" | "missing" | "not_adjacent"> => {
  const { userId, tripId, tripDayId, fromItemType, fromItemId, toItemType, toItemId } = params;

  const timeline = await buildSegmentTimeline(userId, tripId, tripDayId);
  if (!timeline) return "missing";

  const fromIndex = timeline.findIndex((item) => item.id === fromItemId && item.type === fromItemType);
  if (fromIndex < 0) return "missing";
  const toIndex = timeline.findIndex((item) => item.id === toItemId && item.type === toItemType);
  if (toIndex < 0) return "missing";

  if (toIndex !== fromIndex + 1) return "not_adjacent";

  return "ok";
};

export const listTravelSegmentsForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<TravelSegmentDetail[] | null> => {
  const { userId, tripId, tripDayId } = params;
  const tripDay = await findTripDayForTripParticipant(userId, tripId, tripDayId);
  if (!tripDay) return null;

  const segments = await prisma.travelSegment.findMany({
    where: { tripDayId },
    orderBy: { createdAt: "asc" },
  });

  return segments.map(toDetail);
};

export const createTravelSegmentForTripDay = async (
  params: TravelSegmentMutationParams,
): Promise<TravelSegmentCreateResult> => {
  const { userId, tripId, tripDayId, fromItemType, fromItemId, toItemType, toItemId, transportType } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) return { status: "not_found" };

  const itemStatus = await ensureSegmentItemsExist(params);
  if (itemStatus === "missing") return { status: "missing" };
  if (itemStatus === "not_adjacent") return { status: "not_adjacent" };

  const segment = await prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: toPrismaItemType(fromItemType),
      fromItemId,
      toItemType: toPrismaItemType(toItemType),
      toItemId,
      transportType: toPrismaTransportType(transportType),
      durationMinutes: params.durationMinutes,
      distanceKm: params.distanceKm ?? null,
      linkUrl: params.linkUrl ?? null,
    },
  });

  return { status: "created", segment: toDetail(segment) };
};

export const updateTravelSegmentForTripDay = async (
  params: TravelSegmentUpdateParams,
): Promise<TravelSegmentUpdateResult> => {
  const { userId, tripId, tripDayId, segmentId, fromItemType, fromItemId, toItemType, toItemId, transportType } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) return { status: "not_found" };

  const existing = await prisma.travelSegment.findFirst({
    where: { id: segmentId, tripDayId },
  });

  if (!existing) {
    return { status: "missing" };
  }

  const itemStatus = await ensureSegmentItemsExist(params);
  if (itemStatus === "missing") return { status: "missing" };
  if (itemStatus === "not_adjacent") return { status: "not_adjacent" };

  const updated = await prisma.travelSegment.update({
    where: { id: segmentId },
    data: {
      fromItemType: toPrismaItemType(fromItemType),
      fromItemId,
      toItemType: toPrismaItemType(toItemType),
      toItemId,
      transportType: toPrismaTransportType(transportType),
      durationMinutes: params.durationMinutes,
      distanceKm: params.distanceKm ?? null,
      linkUrl: params.linkUrl ?? null,
    },
  });

  return { status: "updated", segment: toDetail(updated) };
};

export const deleteTravelSegmentForTripDay = async (
  params: TravelSegmentDeleteParams,
): Promise<TravelSegmentDeleteResult> => {
  const { userId, tripId, tripDayId, segmentId } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) return { status: "not_found" };

  const existing = await prisma.travelSegment.findFirst({
    where: { id: segmentId, tripDayId },
    select: { id: true },
  });

  if (!existing) return { status: "missing" };

  await prisma.travelSegment.delete({ where: { id: segmentId } });
  return { status: "deleted" };
};
