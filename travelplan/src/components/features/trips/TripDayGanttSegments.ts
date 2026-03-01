export type TripDayGanttSegment = {
  startMinute: number;
  endMinute: number;
  kind: "accommodation" | "planItem" | "travel";
};

export type TripDayGapSegment = {
  startMinute: number;
  endMinute: number;
};

export type TripDayGanttSpan = {
  startMinute: number;
  endMinute: number;
};

type StayTimes = {
  checkInTime?: string | null;
  checkOutTime?: string | null;
};

type BuildStaySegmentsInput = {
  previousStay?: StayTimes | null;
  currentStay?: StayTimes | null;
};

type PlanItemTimes = {
  id: string;
  fromTime?: string | null;
  toTime?: string | null;
};

type TravelSegmentTimes = {
  id: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  durationMinutes: number;
};

const parseTimeToMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [hoursRaw, minutesRaw] = trimmed.split(":");
  if (hoursRaw === undefined || minutesRaw === undefined) return null;
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes >= 60) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
};

export const buildStaySegments = ({ previousStay, currentStay }: BuildStaySegmentsInput): TripDayGanttSegment[] => {
  const segments: TripDayGanttSegment[] = [];
  const checkoutMinutes =
    previousStay?.checkOutTime && previousStay.checkOutTime.trim()
      ? parseTimeToMinutes(previousStay.checkOutTime)
      : null;
  if (checkoutMinutes !== null) {
    segments.push({ startMinute: 0, endMinute: checkoutMinutes, kind: "accommodation" });
  }

  const checkinMinutes =
    currentStay?.checkInTime && currentStay.checkInTime.trim()
      ? parseTimeToMinutes(currentStay.checkInTime)
      : null;
  if (checkinMinutes !== null && checkinMinutes < 24 * 60) {
    segments.push({ startMinute: checkinMinutes, endMinute: 24 * 60, kind: "accommodation" });
  }

  return segments;
};

export const buildPlanItemSegments = (items: PlanItemTimes[]): TripDayGanttSegment[] => {
  const segments: TripDayGanttSegment[] = [];
  for (const item of items) {
    const fromTime = item.fromTime?.trim() ?? "";
    const toTime = item.toTime?.trim() ?? "";
    if (!fromTime || !toTime) continue;
    const startMinutes = parseTimeToMinutes(fromTime);
    const endMinutes = parseTimeToMinutes(toTime);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue;
    segments.push({ startMinute: startMinutes, endMinute: endMinutes, kind: "planItem" });
  }
  return segments;
};

export const buildTravelSegments = ({
  travelSegments,
  accommodationEndTimes,
  planItemEndTimes,
}: {
  travelSegments: TravelSegmentTimes[];
  accommodationEndTimes: Record<string, string | null | undefined>;
  planItemEndTimes: Record<string, string | null | undefined>;
}): TripDayGanttSegment[] => {
  const segments: TripDayGanttSegment[] = [];
  for (const segment of travelSegments) {
    if (!Number.isFinite(segment.durationMinutes) || segment.durationMinutes <= 0) continue;
    const endTime =
      segment.fromItemType === "accommodation"
        ? accommodationEndTimes[segment.fromItemId]
        : planItemEndTimes[segment.fromItemId];
    if (!endTime || !endTime.trim()) continue;
    const startMinutes = parseTimeToMinutes(endTime);
    if (startMinutes === null) continue;
    const endMinutes = Math.min(startMinutes + segment.durationMinutes, 24 * 60);
    if (endMinutes <= startMinutes) continue;
    segments.push({ startMinute: startMinutes, endMinute: endMinutes, kind: "travel" });
  }
  return segments;
};

export const mergeGanttSpans = (segments: TripDayGanttSpan[]): TripDayGanttSpan[] => {
  if (!segments.length) return [];
  const sorted = [...segments]
    .map((segment) => ({
      startMinute: Math.max(0, Math.min(segment.startMinute, 24 * 60)),
      endMinute: Math.max(0, Math.min(segment.endMinute, 24 * 60)),
    }))
    .filter((segment) => segment.endMinute > segment.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  if (!sorted.length) return [];

  const merged: TripDayGanttSpan[] = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.startMinute <= current.endMinute) {
      current.endMinute = Math.max(current.endMinute, next.endMinute);
      continue;
    }
    merged.push(current);
    current = { ...next };
  }
  merged.push(current);
  return merged;
};

export const deriveCoverageSummary = (segments: TripDayGanttSegment[]) => {
  const merged = mergeGanttSpans(
    segments.map((segment) => ({
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
    })),
  );
  let plannedMinutes = 0;
  for (const segment of merged) {
    plannedMinutes += segment.endMinute - segment.startMinute;
  }
  const unplannedMinutes = 24 * 60 - plannedMinutes;
  const gaps: TripDayGapSegment[] = [];
  let cursor = 0;
  for (const segment of merged) {
    if (segment.startMinute > cursor) {
      gaps.push({ startMinute: cursor, endMinute: segment.startMinute });
    }
    cursor = segment.endMinute;
  }
  if (cursor < 24 * 60) {
    gaps.push({ startMinute: cursor, endMinute: 24 * 60 });
  }
  return { merged, plannedMinutes, unplannedMinutes, gaps };
};
