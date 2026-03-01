"use client";

import { Alert, Box, Chip, Dialog, DialogContent, DialogTitle, List, ListItem, Paper, Skeleton, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import TripDayLeafletMap from "@/components/features/trips/TripDayLeafletMap";
import { buildDayMapPanelData, buildTripDayMapItems } from "@/components/features/trips/TripDayMapPanel";
import { MiniImageStrip, PlanItemRichContent, parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  note?: string | null;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    location?: { lat: number; lng: number; label?: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    title: string | null;
    contentJson: string;
    location: { lat: number; lng: number; label?: string | null } | null;
  }[];
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripDayMapFullPageProps = {
  tripId: string;
  dayId: string;
};

type GalleryImage = {
  id: string;
  dayPlanItemId?: string;
  imageUrl: string;
  sortOrder: number;
};

type MapDialogItem =
  | { kind: "planItem"; id: string; label: string; planItem: TripDay["dayPlanItems"][number] }
  | { kind: "previousStay"; id: string; label: string; stay: TripDay["accommodation"] }
  | { kind: "currentStay"; id: string; label: string; stay: TripDay["accommodation"] };

const FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)";

const compareTripDaysChronologically = (left: TripDay, right: TripDay) => {
  if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
};

const parsePolyline = (value: unknown): [number, number][] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point): point is [number, number] => {
      if (!Array.isArray(point) || point.length !== 2) return false;
      return (
        typeof point[0] === "number" &&
        typeof point[1] === "number" &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
      );
    })
    .map((point) => [point[0], point[1]]);
};

export default function TripDayMapFullPage({ tripId, dayId }: TripDayMapFullPageProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [day, setDay] = useState<TripDay | null>(null);
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [routingUnavailable, setRoutingUnavailable] = useState(false);
  const [mapDialogItem, setMapDialogItem] = useState<MapDialogItem | null>(null);
  const [accommodationImages, setAccommodationImages] = useState<GalleryImage[]>([]);
  const [previousAccommodationImages, setPreviousAccommodationImages] = useState<GalleryImage[]>([]);
  const [planItemImagesById, setPlanItemImagesById] = useState<Record<string, GalleryImage[]>>({});
  const [fullscreenImage, setFullscreenImage] = useState<{ imageUrl: string; alt: string } | null>(null);

  const loadDay = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const detailResponse = await fetch(`/api/trips/${tripId}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const detailBody = (await detailResponse.json()) as ApiEnvelope<TripDetail>;

      if (detailResponse.status === 404 || detailBody.error?.code === "not_found") {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        return;
      }

      if (!detailResponse.ok || detailBody.error || !detailBody.data) {
        setError(t("trips.dayView.loadError"));
        setDetail(null);
        setDay(null);
        return;
      }

      const resolvedDay = detailBody.data.days.find((item) => item.id === dayId) ?? null;
      if (!resolvedDay) {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        return;
      }

      setDetail(detailBody.data);
      setDay(resolvedDay);
    } catch {
      setError(t("trips.dayView.loadError"));
      setDetail(null);
      setDay(null);
    } finally {
      setLoading(false);
    }
  }, [dayId, t, tripId]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const orderedDays = useMemo(() => {
    if (!detail) return [];
    return [...detail.days].sort(compareTripDaysChronologically);
  }, [detail]);

  const previousDay = useMemo(() => {
    if (!day) return null;
    const currentIndex = orderedDays.findIndex((candidate) => candidate.id === day.id);
    if (currentIndex <= 0) return null;
    return orderedDays[currentIndex - 1] ?? null;
  }, [day, orderedDays]);

  const previousStay = previousDay?.accommodation ?? null;
  const currentStay = day?.accommodation ?? null;

  const mapData = useMemo(() => {
    const mapItems = buildTripDayMapItems({
      previousStay: previousStay ? { id: previousStay.id, name: previousStay.name, location: previousStay.location } : null,
      planItems: (day?.dayPlanItems ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        contentJson: item.contentJson,
        location: item.location,
      })),
      currentStay: currentStay ? { id: currentStay.id, name: currentStay.name, location: currentStay.location } : null,
      getPlanItemFallbackLabel: (index) => formatMessage(t("trips.dayView.budgetItemPlan"), { index }),
    });
    return buildDayMapPanelData(mapItems);
  }, [currentStay, day?.dayPlanItems, previousStay, t]);

  const handleMapMarkerClick = useCallback(
    (point: { id: string; kind: "previousStay" | "planItem" | "currentStay"; label: string }) => {
      if (point.kind === "planItem") {
        const planItem = day?.dayPlanItems.find((item) => item.id === point.id);
        if (!planItem) return;
        setMapDialogItem({ kind: "planItem", id: planItem.id, label: point.label, planItem });
        return;
      }

      if (point.kind === "previousStay") {
        if (!previousStay) return;
        setMapDialogItem({ kind: "previousStay", id: previousStay.id, label: point.label, stay: previousStay });
        return;
      }

      if (point.kind === "currentStay") {
        if (!currentStay) return;
        setMapDialogItem({ kind: "currentStay", id: currentStay.id, label: point.label, stay: currentStay });
      }
    },
    [currentStay, day?.dayPlanItems, previousStay],
  );

  useEffect(() => {
    const fallbackPolyline = mapData.points.map((point) => point.position);
    setRoutePolyline(fallbackPolyline);
    setRoutingUnavailable(false);

    if (!day || mapData.points.length < 2) {
      return;
    }

    let active = true;
    const loadRoute = async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}/days/${day.id}/route`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const payload = (await response.json()) as ApiEnvelope<{
          route?: {
            polyline?: unknown;
          };
        }>;

        if (!active) return;

        if (!response.ok || payload.error) {
          const fallbackFromError = parsePolyline(
            (payload.error?.details as { fallbackPolyline?: unknown } | undefined)?.fallbackPolyline,
          );
          setRoutePolyline(fallbackFromError.length >= 2 ? fallbackFromError : fallbackPolyline);
          setRoutingUnavailable(true);
          return;
        }

        const routedPolyline = parsePolyline(payload.data?.route?.polyline);
        setRoutePolyline(routedPolyline.length >= 2 ? routedPolyline : fallbackPolyline);
      } catch {
        if (!active) return;
        setRoutePolyline(fallbackPolyline);
        setRoutingUnavailable(true);
      }
    };

    void loadRoute();

    return () => {
      active = false;
    };
  }, [day, mapData.points, tripId]);

  useEffect(() => {
    const loadImages = async () => {
      if (!day) {
        setAccommodationImages([]);
        setPreviousAccommodationImages([]);
        setPlanItemImagesById({});
        return;
      }

      try {
        if (previousDay?.accommodation) {
          const previousAccommodationResponse = await fetch(
            `/api/trips/${tripId}/accommodations/images?tripDayId=${previousDay.id}&accommodationId=${previousDay.accommodation.id}`,
            {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            },
          );
          const previousAccommodationBody = (await previousAccommodationResponse.json()) as ApiEnvelope<{
            images: GalleryImage[];
          }>;
          const previousImages =
            previousAccommodationResponse.ok &&
            !previousAccommodationBody.error &&
            Array.isArray(previousAccommodationBody.data?.images)
              ? previousAccommodationBody.data.images
              : [];
          setPreviousAccommodationImages(previousImages);
        } else {
          setPreviousAccommodationImages([]);
        }

        if (day.accommodation) {
          const accommodationResponse = await fetch(
            `/api/trips/${tripId}/accommodations/images?tripDayId=${day.id}&accommodationId=${day.accommodation.id}`,
            {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            },
          );
          const accommodationBody = (await accommodationResponse.json()) as ApiEnvelope<{ images: GalleryImage[] }>;
          const currentImages =
            accommodationResponse.ok && !accommodationBody.error && Array.isArray(accommodationBody.data?.images)
              ? accommodationBody.data.images
              : [];
          setAccommodationImages(currentImages);
        } else {
          setAccommodationImages([]);
        }

        const nextPlanItemImages: Record<string, GalleryImage[]> = {};
        const planItemImagesResponse = await fetch(`/api/trips/${tripId}/day-plan-items/images?tripDayId=${day.id}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const planItemImagesBody = (await planItemImagesResponse.json()) as ApiEnvelope<{ images: GalleryImage[] }>;
        if (planItemImagesResponse.ok && !planItemImagesBody.error && Array.isArray(planItemImagesBody.data?.images)) {
          for (const image of planItemImagesBody.data.images) {
            const itemId = image.dayPlanItemId;
            if (!itemId) continue;
            if (!nextPlanItemImages[itemId]) {
              nextPlanItemImages[itemId] = [];
            }
            nextPlanItemImages[itemId].push(image);
          }
        }
        for (const item of day.dayPlanItems ?? []) {
          if (!nextPlanItemImages[item.id]) {
            nextPlanItemImages[item.id] = [];
          }
        }
        setPlanItemImagesById(nextPlanItemImages);
      } catch {
        setAccommodationImages([]);
        setPreviousAccommodationImages([]);
        setPlanItemImagesById({});
      }
    };

    void loadImages();
  }, [day, previousDay, tripId]);

  if (loading) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="30%" height={28} />
          <Skeleton variant="rectangular" height={FULL_PAGE_MAP_HEIGHT} />
        </Box>
      </Paper>
    );
  }

  if (notFound) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="h6" fontWeight={600}>
            {t("trips.dayView.notFoundTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.dayView.notFoundBody")}
          </Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="h6" fontWeight={600}>
            {t("trips.dayView.mapTitle")}
          </Typography>

          {mapData.points.length === 0 ? (
            <Box
              sx={{
                minHeight: FULL_PAGE_MAP_HEIGHT,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 2,
                border: "1px dashed",
                borderColor: "divider",
                px: 2,
                textAlign: "center",
                gap: 1,
              }}
            >
              <Typography variant="body1" fontWeight={600}>
                {t("trips.dayView.mapEmptyTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("trips.dayView.mapEmptyBody")}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ borderRadius: 2, overflow: "hidden" }}>
              <TripDayLeafletMap
                points={mapData.points}
                polylinePositions={routePolyline.length >= 2 ? routePolyline : mapData.points.map((point) => point.position)}
                height={FULL_PAGE_MAP_HEIGHT}
                onMarkerClick={handleMapMarkerClick}
              />
            </Box>
          )}

          {routingUnavailable && (
            <Box display="flex" flexDirection="column" gap={0.5} data-testid="day-map-routing-unavailable">
              <Typography variant="body2" color="warning.main" fontWeight={600}>
                {t("trips.dayView.routingUnavailableTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("trips.dayView.routingUnavailableBody")}
              </Typography>
            </Box>
          )}

          {mapData.missingLocations.length > 0 && (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="body2" fontWeight={600}>
                {t("trips.dayView.mapMissingTitle")}
              </Typography>
              <List dense sx={{ p: 0 }}>
                {mapData.missingLocations.map((item) => (
                  <ListItem key={item.id} sx={{ px: 0, display: "flex", gap: 1 }}>
                    <Chip label={t("trips.dayView.mapMissingTag")} size="small" color="warning" />
                    <Typography variant="body2">{item.label}</Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Box>
      </Paper>
      <Dialog open={Boolean(mapDialogItem)} onClose={() => setMapDialogItem(null)} fullWidth maxWidth="sm">
        <DialogTitle>{mapDialogItem?.label ?? ""}</DialogTitle>
        <DialogContent>
          {mapDialogItem ? (
            <Box display="flex" flexDirection="column" gap={1.5}>
              {mapDialogItem.kind === "planItem" ? (
                <>
                  <PlanItemRichContent
                    contentJson={mapDialogItem.planItem.contentJson}
                    fallbackText={parsePlanText(mapDialogItem.planItem.contentJson) || mapDialogItem.label}
                  />
                  <MiniImageStrip
                    images={planItemImagesById[mapDialogItem.planItem.id] ?? []}
                    altPrefix={mapDialogItem.label}
                    onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                  />
                </>
              ) : (
                <>
                  {mapDialogItem.stay?.notes ? (
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {mapDialogItem.stay.notes}
                    </Typography>
                  ) : null}
                  <MiniImageStrip
                    images={mapDialogItem.kind === "previousStay" ? previousAccommodationImages : accommodationImages}
                    altPrefix={mapDialogItem.label}
                    onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                  />
                </>
              )}
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(fullscreenImage)}
        onClose={() => setFullscreenImage(null)}
        maxWidth={false}
        sx={{
          "& .MuiDialog-paper": {
            backgroundColor: "transparent",
            boxShadow: "none",
            m: 0,
          },
        }}
        onKeyDown={() => setFullscreenImage(null)}
      >
        {fullscreenImage ? (
          <DialogContent
            onClick={() => setFullscreenImage(null)}
            sx={{
              p: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "100vw",
              minHeight: "100vh",
              backgroundColor: "rgba(0, 0, 0, 0.85)",
              cursor: "zoom-out",
            }}
          >
            <Box
              component="img"
              src={fullscreenImage.imageUrl}
              alt={fullscreenImage.alt}
              sx={{
                maxWidth: "96vw",
                maxHeight: "96vh",
                objectFit: "contain",
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </Box>
  );
}
