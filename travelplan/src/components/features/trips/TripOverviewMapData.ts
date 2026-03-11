"use client";

import { parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";

export type TripOverviewMapItemKind = "accommodation" | "planItem";

type MapLocation = {
  lat: number;
  lng: number;
  label?: string | null;
};

type TripOverviewStayInput = {
  id: string;
  name: string;
  notes: string | null;
  location: MapLocation | null;
};

type TripOverviewPlanItemInput = {
  id: string;
  title: string | null;
  contentJson: string;
  location: MapLocation | null;
};

type TripOverviewDayInput = {
  id: string;
  date: string;
  dayIndex: number;
  accommodation: TripOverviewStayInput | null;
  dayPlanItems: TripOverviewPlanItemInput[];
};

export type TripOverviewMapPoint = {
  id: string;
  label: string;
  kind: TripOverviewMapItemKind;
  position: [number, number];
  dayId: string;
  href: string;
  order: number;
  stayKey?: string;
  notes?: string | null;
  contentJson?: string;
};

export type TripOverviewMissingLocation = {
  id: string;
  kind: TripOverviewMapItemKind;
  label: string;
  href: string;
};

export type TripOverviewMapData = {
  points: TripOverviewMapPoint[];
  missingLocations: TripOverviewMissingLocation[];
  polylinePositions: [number, number][];
};

const getValidMapLocation = (value: MapLocation | null | undefined) => {
  if (!value) return null;
  if (
    typeof value.lat !== "number" ||
    typeof value.lng !== "number" ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lng)
  ) {
    return null;
  }

  return value;
};

export const compareTripDaysChronologically = (left: TripOverviewDayInput, right: TripOverviewDayInput) => {
  if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;

  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
};

const isSamePointPosition = (left: [number, number], right: [number, number]) => left[0] === right[0] && left[1] === right[1];

const buildStayKey = (stay: TripOverviewStayInput, dayIndex: number) => {
  const normalizedLocationLabel = stay.location?.label?.trim().toLocaleLowerCase();
  const normalizedName = stay.name.trim().toLocaleLowerCase();
  return normalizedLocationLabel || normalizedName || `day-${dayIndex}-stay-${stay.id}`;
};

export const buildTripOverviewMapData = (params: {
  tripId: string;
  days: TripOverviewDayInput[];
  getDayLabel: (index: number) => string;
  getPlanItemFallbackLabel: (index: number) => string;
}): TripOverviewMapData => {
  const points: TripOverviewMapPoint[] = [];
  const missingLocations: TripOverviewMissingLocation[] = [];

  const orderedDays = [...params.days].sort(compareTripDaysChronologically);

  orderedDays.forEach((day) => {
    day.dayPlanItems.forEach((item, itemIndex) => {
      const label =
        item.title?.trim() ||
        parsePlanText(item.contentJson) ||
        params.getPlanItemFallbackLabel(itemIndex + 1);
      const location = getValidMapLocation(item.location);
      const href = `/trips/${params.tripId}/days/${day.id}?open=plan&itemId=${item.id}`;

      if (!location) {
        missingLocations.push({ id: item.id, kind: "planItem", label, href });
        return;
      }

      points.push({
        id: item.id,
        label,
        kind: "planItem",
        position: [location.lat, location.lng],
        dayId: day.id,
        href,
        order: points.length,
        contentJson: item.contentJson,
      });
    });

    if (!day.accommodation) {
      return;
    }

    const location = getValidMapLocation(day.accommodation.location);
    const label = day.accommodation.name.trim() || params.getDayLabel(day.dayIndex);
    const href = `/trips/${params.tripId}/days/${day.id}?open=stay`;

    if (!location) {
      missingLocations.push({ id: day.accommodation.id, kind: "accommodation", label, href });
      return;
    }

    const nextPoint: TripOverviewMapPoint = {
      id: day.accommodation.id,
      label,
      kind: "accommodation",
      position: [location.lat, location.lng],
      dayId: day.id,
      href,
      order: points.length,
      stayKey: buildStayKey(day.accommodation, day.dayIndex),
      notes: day.accommodation.notes,
    };

    const previousPoint = points.at(-1);
    if (
      previousPoint &&
      previousPoint.kind === "accommodation" &&
      previousPoint.stayKey === nextPoint.stayKey &&
      isSamePointPosition(previousPoint.position, nextPoint.position) &&
      previousPoint.dayId !== nextPoint.dayId
    ) {
      return;
    }

    points.push(nextPoint);
  });

  return {
    points: points.map((point, index) => ({ ...point, order: index })),
    missingLocations,
    polylinePositions: points.map((point) => point.position),
  };
};
