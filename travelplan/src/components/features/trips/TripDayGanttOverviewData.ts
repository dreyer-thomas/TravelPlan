import {
  buildPlanItemSegments,
  buildStaySegments,
  buildTravelSegments,
  type TripDayGanttSegment,
} from "@/components/features/trips/TripDayGanttSegments";

type OverviewStay = {
  id: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
};

type OverviewPlanItem = {
  id: string;
  fromTime?: string | null;
  toTime?: string | null;
};

type OverviewTravelSegment = {
  id: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  durationMinutes: number;
};

type BuildOverviewGanttSegmentsInput = {
  previousStay: OverviewStay | null;
  currentStay: OverviewStay | null;
  planItems: OverviewPlanItem[];
  travelSegments: OverviewTravelSegment[];
  defaultCheckOutTime?: string;
  defaultCheckInTime?: string;
};

const resolveStayTime = (value: string | null | undefined, fallback: string) =>
  value && value.trim() ? value : fallback;

export const buildOverviewGanttSegments = ({
  previousStay,
  currentStay,
  planItems,
  travelSegments,
  defaultCheckOutTime = "10:00",
  defaultCheckInTime = "16:00",
}: BuildOverviewGanttSegmentsInput): TripDayGanttSegment[] => {
  const staySegments = buildStaySegments({
    previousStay: previousStay
      ? { checkOutTime: resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime) }
      : null,
    currentStay: currentStay
      ? { checkInTime: resolveStayTime(currentStay.checkInTime, defaultCheckInTime) }
      : null,
  });
  const planItemSegments = buildPlanItemSegments(
    planItems.map((item) => ({
      id: item.id,
      fromTime: item.fromTime,
      toTime: item.toTime,
    })),
  );
  const accommodationEndTimes: Record<string, string | null | undefined> = {};
  if (previousStay) {
    accommodationEndTimes[previousStay.id] = resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime);
  }
  const planItemEndTimes: Record<string, string | null | undefined> = {};
  for (const item of planItems) {
    planItemEndTimes[item.id] = item.toTime;
  }
  const travelSegmentsForGantt = buildTravelSegments({
    travelSegments: travelSegments.map((segment) => ({
      id: segment.id,
      fromItemType: segment.fromItemType,
      fromItemId: segment.fromItemId,
      durationMinutes: segment.durationMinutes,
    })),
    accommodationEndTimes,
    planItemEndTimes,
  });

  return [...staySegments, ...planItemSegments, ...travelSegmentsForGantt];
};
