export type TripDayMapItemKind = "previousStay" | "planItem" | "currentStay";

export type TripDayMapItem = {
  id: string;
  label: string;
  kind: TripDayMapItemKind;
  location: { lat: number; lng: number } | null;
};

export type TripDayMapPoint = {
  id: string;
  label: string;
  kind: TripDayMapItemKind;
  position: [number, number];
  order: number;
};

export type TripDayMapPanelData = {
  points: TripDayMapPoint[];
  missingLocations: TripDayMapItem[];
};

type TripDayMapPlanItemInput = {
  id: string;
  label: string;
  location: { lat: number; lng: number } | null;
};

type TripDayMapStayInput = {
  id: string;
  name: string;
  location: { lat: number; lng: number } | null | undefined;
};

const getValidMapLocation = (value: { lat: number; lng: number } | null | undefined) => {
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

export const buildTripDayMapItems = (params: {
  previousStay?: TripDayMapStayInput | null;
  planItems?: TripDayMapPlanItemInput[];
  currentStay?: TripDayMapStayInput | null;
}) => ({
  previousStay: params.previousStay
    ? {
        id: params.previousStay.id,
        label: params.previousStay.name,
        kind: "previousStay" as const,
        location: getValidMapLocation(params.previousStay.location),
      }
    : null,
  planItems: (params.planItems ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    kind: "planItem" as const,
    location: getValidMapLocation(item.location),
  })),
  currentStay: params.currentStay
    ? {
        id: params.currentStay.id,
        label: params.currentStay.name,
        kind: "currentStay" as const,
        location: getValidMapLocation(params.currentStay.location),
      }
    : null,
});

export const buildDayMapPanelData = (params: {
  previousStay?: TripDayMapItem | null;
  planItems?: TripDayMapItem[];
  currentStay?: TripDayMapItem | null;
}): TripDayMapPanelData => {
  const ordered: TripDayMapItem[] = [];

  if (params.previousStay) ordered.push(params.previousStay);
  if (params.planItems) ordered.push(...params.planItems);
  if (params.currentStay) ordered.push(params.currentStay);

  const points: TripDayMapPoint[] = [];
  const missingLocations: TripDayMapItem[] = [];

  ordered.forEach((item, index) => {
    if (item.location) {
      points.push({
        id: item.id,
        label: item.label,
        kind: item.kind,
        position: [item.location.lat, item.location.lng],
        order: index,
      });
    } else {
      missingLocations.push(item);
    }
  });

  return { points, missingLocations };
};
