"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  SvgIcon,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import FormField from "@/components/forms/FormField";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import TripDayGanttBar, { buildGanttPalette } from "@/components/features/trips/TripDayGanttBar";
import {
  buildPlanItemSegments,
  buildStaySegments,
  buildTravelSegments,
  deriveCoverageSummary,
  type TripDayGanttSegment,
} from "@/components/features/trips/TripDayGanttSegments";
import {
  HERO_SCRIM,
  HouseIcon,
  ON_PHOTO_CHROME,
  WarningTriangleIcon,
  toCssUrl,
  transportIconFor,
} from "@/components/features/trips/TripIcons";
import TripDayMapPanel, {
  type TripDayMapPoint,
} from "@/components/features/trips/TripDayMapPanel";
import TripDayBucketListPanel from "@/components/features/trips/TripDayBucketListPanel";
import TripDayPlanDialog from "@/components/features/trips/TripDayPlanDialog";
import TripDayTravelSegmentDialog from "@/components/features/trips/TripDayTravelSegmentDialog";
import { MiniImageStrip, PlanItemRichContent, isSafeLink, parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { buildDayMapPanelData, buildTripDayMapItems } from "@/lib/trips/dayMapData";
import { IMAGE_UPLOAD_ACCEPT, isSupportedImageUpload } from "@/lib/trips/imageUploads";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  accessRole?: "owner" | "viewer" | "contributor";
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
  imageUrl?: string | null;
  note?: string | null;
  updatedAt?: string;
  plannedCostSubtotal: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    payments?: { amountCents: number; dueDate: string }[];
    link: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    location?: { lat: number; lng: number; label?: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    title: string | null;
    fromTime: string | null;
    toTime: string | null;
    contentJson: string;
    costCents: number | null;
    payments?: { amountCents: number; dueDate: string }[];
    linkUrl: string | null;
    location: { lat: number; lng: number; label?: string | null } | null;
  }[];
  travelSegments?: {
    id: string;
    fromItemType: "accommodation" | "dayPlanItem";
    fromItemId: string;
    toItemType: "accommodation" | "dayPlanItem";
    toItemId: string;
    transportType: "car" | "ship" | "flight";
    durationMinutes: number;
    distanceKm: number | null;
    linkUrl: string | null;
  }[];
};

type DayPlanItem = {
  id: string;
  tripDayId: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  payments?: { amountCents: number; dueDate: string }[];
  linkUrl: string | null;
  location: { lat: number; lng: number; label?: string | null } | null;
  createdAt: string;
};

type BucketListItem = {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  positionText: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

type SegmentItem = {
  id: string;
  type: "accommodation" | "dayPlanItem";
  label: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  endTime?: string | null;
};

type GalleryImage = {
  id: string;
  dayPlanItemId?: string;
  imageUrl: string;
  sortOrder: number;
};

type TravelSegment = NonNullable<TripDay["travelSegments"]>[number];

type PlanDialogMode = "add" | "edit";
type DayActivityTransferMode = "move" | "swap";

type PlanDialogPrefill = {
  title: string;
  contentJson: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  bucketListItemId: string;
};

type MapDialogItem =
  | { kind: "planItem"; id: string; label: string; planItem: DayPlanItem }
  | { kind: "previousStay"; id: string; label: string; stay: TripDay["accommodation"] }
  | { kind: "currentStay"; id: string; label: string; stay: TripDay["accommodation"] };

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripDayViewProps = {
  tripId: string;
  dayId: string;
};

const compareTripDaysChronologically = (left: TripDay, right: TripDay) => {
  if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
};

const formatDurationMinutes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
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

const formatMinutesToTime = (value: number) => {
  const bounded = Math.max(0, Math.min(value, 24 * 60));
  const hours = Math.floor(bounded / 60);
  const minutes = bounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

// The bar spans a real 24h day, not the mockup's 08:00-22:00 sample window: stay segments run 00:00 ->
// check-out and check-in -> 24:00 by construction, and the planned/unplanned caption beside the bar is
// computed against 1440 minutes. Clamping the axis would truncate both stays and desync the two.
const COVERAGE_AXIS_TICKS = [
  { label: "00:00", percent: 0 },
  { label: "06:00", percent: 25 },
  { label: "12:00", percent: 50 },
  { label: "18:00", percent: 75 },
  { label: "24:00", percent: 100 },
];

const buildSegmentKey = (from: SegmentItem, to: SegmentItem) => `${from.type}:${from.id}::${to.type}:${to.id}`;
const buildSegmentKeyFromIds = (
  fromType: "accommodation" | "dayPlanItem",
  fromId: string,
  toType: "accommodation" | "dayPlanItem",
  toId: string,
) => `${fromType}:${fromId}::${toType}:${toId}`;

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

export default function TripDayView({ tripId, dayId }: TripDayViewProps) {
  const { language, t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  // Story 7.7 owns exactly one block of this file — the day-details dialog. This is its id prefix.
  const dayMetaIdPrefix = useId();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [day, setDay] = useState<TripDay | null>(null);
  const [planItems, setPlanItems] = useState<DayPlanItem[]>([]);
  const [bucketItems, setBucketItems] = useState<BucketListItem[]>([]);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [travelSegments, setTravelSegments] = useState<TravelSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [previousStayOpen, setPreviousStayOpen] = useState(false);
  const [planDialogMode, setPlanDialogMode] = useState<PlanDialogMode | null>(null);
  const [selectedPlanItem, setSelectedPlanItem] = useState<DayPlanItem | null>(null);
  const [planDialogPrefill, setPlanDialogPrefill] = useState<PlanDialogPrefill | null>(null);
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false);
  const [activeSegment, setActiveSegment] = useState<TravelSegment | null>(null);
  const [activeSegmentFrom, setActiveSegmentFrom] = useState<SegmentItem | null>(null);
  const [activeSegmentTo, setActiveSegmentTo] = useState<SegmentItem | null>(null);
  const [copyingStay, setCopyingStay] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [dayMetaOpen, setDayMetaOpen] = useState(false);
  const [dayImageFile, setDayImageFile] = useState<File | null>(null);
  const [dayNoteDraft, setDayNoteDraft] = useState("");
  const [mapDialogItem, setMapDialogItem] = useState<MapDialogItem | null>(null);
  const [dayImageSaving, setDayImageSaving] = useState(false);
  const [accommodationImages, setAccommodationImages] = useState<GalleryImage[]>([]);
  const [previousAccommodationImages, setPreviousAccommodationImages] = useState<GalleryImage[]>([]);
  const [planItemImagesById, setPlanItemImagesById] = useState<Record<string, GalleryImage[]>>({});
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [routingUnavailable, setRoutingUnavailable] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ imageUrl: string; alt: string } | null>(null);
  const [transferMode, setTransferMode] = useState<DayActivityTransferMode | null>(null);
  const [transferTargetDayId, setTransferTargetDayId] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const planItemsRef = useRef<DayPlanItem[]>([]);
  const handledDeepLinkRef = useRef<string | null>(null);
  const scrollRestoreKey = useMemo(() => `trip-day-scroll:${tripId}:${dayId}`, [dayId, tripId]);
  const defaultCheckInTime = "16:00";
  const defaultCheckOutTime = "10:00";
  const isOwner = detail?.trip.accessRole ? detail.trip.accessRole === "owner" : true;
  const canEditPlanning = detail?.trip.accessRole ? detail.trip.accessRole !== "viewer" : true;

  useEffect(() => {
    planItemsRef.current = planItems;
  }, [planItems]);

  useEffect(() => {
    if (loading || !day) return;
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(scrollRestoreKey);
      if (!stored) return;
      sessionStorage.removeItem(scrollRestoreKey);
      const value = Number(stored);
      if (!Number.isFinite(value)) return;
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: value, behavior: "auto" });
      });
    } catch {
      // Ignore storage failures.
    }
  }, [day, loading, scrollRestoreKey]);

  const formatDate = useMemo(
    () => (value: string) =>
      new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value)),
    [language],
  );

  // style: "currency" places the symbol per locale - German needs "1.234,50 €", not "€1.234,50".
  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
  );

  const resolveApiError = useCallback(
    (code?: string, fallback?: string) => {
      const defaultMessage = fallback ?? t("trips.dayView.loadError");
      switch (code) {
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "server_error":
          return t("errors.server");
        case "invalid_json":
          return t("errors.invalidJson");
        case "network_error":
          return t("errors.network");
        default:
          return defaultMessage;
      }
    },
    [t],
  );

  const buildBucketListContentJson = useCallback((item: BucketListItem) => {
    const description = item.description?.trim() ?? "";
    const positionText = item.positionText?.trim() ?? "";
    const includePositionText = !item.location && positionText.length > 0;
    const parts = [description, includePositionText ? positionText : ""].filter((value) => value.length > 0);
    const content = parts.length > 0 ? parts : [item.title.trim()];
    return JSON.stringify({
      type: "doc",
      content: content.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
  }, []);

  const buildBucketListPrefill = useCallback(
    (item: BucketListItem): PlanDialogPrefill => {
      const location = item.location
        ? {
            lat: item.location.lat,
            lng: item.location.lng,
            label: item.positionText?.trim() || item.location.label || null,
          }
        : null;
      return {
        title: item.title,
        contentJson: buildBucketListContentJson(item),
        location,
        bucketListItemId: item.id,
      };
    },
    [buildBucketListContentJson],
  );

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
        setPlanItems([]);
        setBucketItems([]);
        setTravelSegments([]);
        return;
      }

      if (!detailResponse.ok || detailBody.error || !detailBody.data) {
        setError(resolveApiError(detailBody.error?.code));
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        setBucketItems([]);
        setTravelSegments([]);
        return;
      }

      const resolvedDay = detailBody.data.days.find((item) => item.id === dayId) ?? null;
      if (!resolvedDay) {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        setBucketItems([]);
        setTravelSegments([]);
        return;
      }

      setDetail(detailBody.data);
      setDay(resolvedDay);
      setPlanItems(
        (resolvedDay.dayPlanItems ?? []).map((item) => ({
          id: item.id,
          tripDayId: resolvedDay.id,
          title: item.title,
          fromTime: item.fromTime ?? null,
          toTime: item.toTime ?? null,
          contentJson: item.contentJson,
          costCents: typeof item.costCents === "number" ? item.costCents : null,
          linkUrl: item.linkUrl,
          location: item.location,
          createdAt: "",
        })),
      );
      setTravelSegments(Array.isArray(resolvedDay.travelSegments) ? resolvedDay.travelSegments : []);
    } catch {
      setError(t("trips.dayView.loadError"));
      setDetail(null);
      setDay(null);
      setPlanItems([]);
      setBucketItems([]);
      setTravelSegments([]);
    } finally {
      setLoading(false);
    }
  }, [dayId, resolveApiError, t, tripId]);

  const loadBucketListItems = useCallback(async () => {
    setBucketLoading(true);
    setBucketError(null);
    try {
      if (!isOwner) {
        setBucketItems([]);
        setBucketError(null);
        setBucketLoading(false);
        return;
      }

      const response = await fetch(`/api/trips/${tripId}/bucket-list-items`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ items: BucketListItem[] }>;

      if (!response.ok || body.error) {
        setBucketError(resolveApiError(body.error?.code, t("trips.bucketList.loadError")));
        setBucketItems([]);
        return;
      }

      setBucketItems(body.data?.items ?? []);
    } catch {
      setBucketError(t("trips.bucketList.loadError"));
      setBucketItems([]);
    } finally {
      setBucketLoading(false);
    }
  }, [isOwner, resolveApiError, t, tripId]);

  const ensureCsrfToken = useCallback(async () => {
    if (csrfToken) return csrfToken;
    const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
    const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
    if (!response.ok || body.error || !body.data?.csrfToken) {
      throw new Error("csrf");
    }
    setCsrfToken(body.data.csrfToken);
    return body.data.csrfToken;
  }, [csrfToken]);

  const segmentsByKey = useMemo(() => {
    const map = new Map<string, TravelSegment>();
    for (const segment of travelSegments) {
      map.set(
        buildSegmentKeyFromIds(segment.fromItemType, segment.fromItemId, segment.toItemType, segment.toItemId),
        segment,
      );
    }
    return map;
  }, [travelSegments]);

  const handleOpenTravelSegment = (from: SegmentItem, to: SegmentItem) => {
    if (!canEditPlanning) return;
    setActiveSegmentFrom(from);
    setActiveSegmentTo(to);
    setActiveSegment(segmentsByKey.get(buildSegmentKey(from, to)) ?? null);
    setSegmentDialogOpen(true);
  };

  const handleTravelSegmentSaved = (segment: TravelSegment) => {
    setTravelSegments((current) => {
      const index = current.findIndex((item) => item.id === segment.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = segment;
        return next;
      }
      return [...current, segment];
    });
    setDay((current) =>
      current
        ? { ...current, travelSegments: [...(current.travelSegments ?? []).filter((item) => item.id !== segment.id), segment] }
        : current,
    );
    setDetail((current) => {
      if (!current || !day) return current;
      return {
        ...current,
        days: current.days.map((entry) =>
          entry.id === day.id
            ? { ...entry, travelSegments: [...(entry.travelSegments ?? []).filter((item) => item.id !== segment.id), segment] }
            : entry,
        ),
      };
    });
    setSegmentDialogOpen(false);
  };

  const handleOpenAddPlan = () => {
    if (!canEditPlanning) return;
    setPlanDialogPrefill(null);
    setSelectedPlanItem(null);
    setPlanDialogMode("add");
  };

  const handleOpenEditPlan = (item: DayPlanItem) => {
    if (!canEditPlanning) return;
    setPlanDialogPrefill(null);
    setSelectedPlanItem(item);
    setPlanDialogMode("edit");
  };

  const handleAddBucketToDay = (item: BucketListItem) => {
    if (!canEditPlanning) return;
    setPlanDialogPrefill(buildBucketListPrefill(item));
    setSelectedPlanItem(null);
    setPlanDialogMode("add");
  };

  const handleDeletePlan = useCallback(
    async (itemId: string) => {
      if (!day) return false;

      const confirmed = window.confirm(t("trips.plan.deleteConfirm"));
      if (!confirmed) return false;

      const snapshot = planItemsRef.current;
      const removedIndex = snapshot.findIndex((item) => item.id === itemId);
      const removedItem = removedIndex >= 0 ? snapshot[removedIndex] : null;
      setPlanItems((current) => current.filter((item) => item.id !== itemId));
      setError(null);

      try {
        const token = await ensureCsrfToken();
        const response = await fetch(`/api/trips/${tripId}/day-plan-items`, {
          method: "DELETE",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify({ tripDayId: day.id, itemId }),
        });

        const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
        if (!response.ok || body.error) {
          if (removedItem) {
            setPlanItems((current) => {
              if (current.some((item) => item.id === removedItem.id)) return current;
              const insertAt = Math.min(Math.max(removedIndex, 0), current.length);
              return [...current.slice(0, insertAt), removedItem, ...current.slice(insertAt)];
            });
          }
          setError(resolveApiError(body.error?.code));
          return false;
        }
        return true;
      } catch {
        if (removedItem) {
          setPlanItems((current) => {
            if (current.some((item) => item.id === removedItem.id)) return current;
            const insertAt = Math.min(Math.max(removedIndex, 0), current.length);
            return [...current.slice(0, insertAt), removedItem, ...current.slice(insertAt)];
          });
        }
        setError(resolveApiError("network_error"));
        return false;
      }
    },
    [day, ensureCsrfToken, resolveApiError, t, tripId],
  );

  const handlePlanDialogClose = () => {
    setPlanDialogMode(null);
    setSelectedPlanItem(null);
    setPlanDialogPrefill(null);
  };

  const handlePlanDialogSaved = () => {
    const shouldReloadBucket = Boolean(planDialogPrefill?.bucketListItemId);
    setPlanDialogMode(null);
    setSelectedPlanItem(null);
    setPlanDialogPrefill(null);
    loadDay();
    if (shouldReloadBucket) {
      loadBucketListItems();
    }
  };

  const handleOpenTransferDialog = (mode: DayActivityTransferMode) => {
    if (!canEditPlanning) return;
    setTransferMode(mode);
    setTransferTargetDayId("");
  };

  const handleCloseTransferDialog = () => {
    if (transferSubmitting) return;
    setTransferMode(null);
    setTransferTargetDayId("");
  };

  const orderedDays = useMemo(() => {
    if (!detail) return [];
    return [...detail.days].sort(compareTripDaysChronologically);
  }, [detail]);

  const transferTargetOptions = useMemo(() => {
    if (!day) return [];
    return orderedDays.filter((candidate) => candidate.id !== day.id);
  }, [day, orderedDays]);

  const selectedTransferTargetDay = useMemo(
    () => transferTargetOptions.find((candidate) => candidate.id === transferTargetDayId) ?? null,
    [transferTargetDayId, transferTargetOptions],
  );

  const transferNeedsOverwriteWarning =
    transferMode === "move" && Boolean(selectedTransferTargetDay && selectedTransferTargetDay.dayPlanItems.length > 0);

  const handleSubmitTransfer = useCallback(async () => {
    if (!day || !transferMode) return;
    if (!transferTargetDayId || transferTargetDayId === day.id) {
      setError(t("trips.dayTransfer.sameDayError"));
      return;
    }

    setTransferSubmitting(true);
    setError(null);

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/day-activity-transfer`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          operation: transferMode,
          sourceTripDayId: day.id,
          targetTripDayId: transferTargetDayId,
          confirmOverwrite: transferNeedsOverwriteWarning,
        }),
      });

      const body = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || body.error) {
        setError(
          resolveApiError(
            body.error?.code,
            transferMode === "move" ? t("trips.dayTransfer.moveError") : t("trips.dayTransfer.swapError"),
          ),
        );
        return;
      }

      setTransferMode(null);
      setTransferTargetDayId("");
      await loadDay();
    } catch {
      setError(
        resolveApiError("network_error", transferMode === "move" ? t("trips.dayTransfer.moveError") : t("trips.dayTransfer.swapError")),
      );
    } finally {
      setTransferSubmitting(false);
    }
  }, [
    day,
    ensureCsrfToken,
    loadDay,
    resolveApiError,
    t,
    transferMode,
    transferNeedsOverwriteWarning,
    transferTargetDayId,
    tripId,
  ]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  useEffect(() => {
    loadBucketListItems();
  }, [loadBucketListItems]);

  useEffect(() => {
    setDayImageFile(null);
    setDayNoteDraft(day?.note ?? "");
  }, [day?.id, day?.note]);

  useEffect(() => {
    if (loading || !day) return;

    const openTarget = searchParams.get("open");
    const itemId = searchParams.get("itemId");
    if (!openTarget) return;

    const key = `${day.id}:${openTarget}:${itemId ?? ""}`;
    if (handledDeepLinkRef.current === key) return;

      if (openTarget === "stay") {
      if (!canEditPlanning) return;
        setStayOpen(true);
      handledDeepLinkRef.current = key;
      return;
    }

    if (openTarget === "plan") {
      if (!canEditPlanning) return;
      if (itemId) {
        const item = planItems.find((entry) => entry.id === itemId) ?? null;
        if (item) {
          setSelectedPlanItem(item);
          setPlanDialogMode("edit");
          handledDeepLinkRef.current = key;
          return;
        }
      }

      setSelectedPlanItem(null);
      setPlanDialogMode("add");
      handledDeepLinkRef.current = key;
    }
  }, [canEditPlanning, day, loading, planItems, searchParams]);

  const previousDay = useMemo(() => {
    if (!day) return null;
    const currentIndex = orderedDays.findIndex((candidate) => candidate.id === day.id);
    if (currentIndex <= 0) return null;
    return orderedDays[currentIndex - 1] ?? null;
  }, [day, orderedDays]);

  const nextDay = useMemo(() => {
    if (!day) return null;
    const currentIndex = orderedDays.findIndex((candidate) => candidate.id === day.id);
    if (currentIndex < 0 || currentIndex >= orderedDays.length - 1) return null;
    return orderedDays[currentIndex + 1] ?? null;
  }, [day, orderedDays]);

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
        for (const item of planItems) {
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
  }, [day, planItems, previousDay, tripId]);

  const resolveStayTime = (value: string | null | undefined, fallback: string) =>
    value && value.trim() ? value : fallback;
  const previousStay = previousDay?.accommodation ?? null;
  const currentStay = day?.accommodation ?? null;
  const canCopyPreviousStay = Boolean(previousStay && !currentStay);
  const handleCopyPreviousStay = useCallback(async () => {
    if (!day || !previousStay) return;

    setCopyingStay(true);
    setError(null);
    const dayIdForCopy = day.id;

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/accommodations/copy`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ tripDayId: dayIdForCopy }),
      });

      const body = (await response.json()) as ApiEnvelope<{ accommodation: TripDay["accommodation"] }>;
      if (!response.ok || body.error || !body.data?.accommodation) {
        setError(body.error?.message ? `${t("trips.stay.error")} (${body.error.message})` : t("trips.stay.error"));
        return;
      }

      const nextAccommodation = body.data.accommodation;
      setDay((current) => (current ? { ...current, accommodation: nextAccommodation } : current));
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          days: current.days.map((entry) =>
            entry.id === dayIdForCopy ? { ...entry, accommodation: nextAccommodation } : entry,
          ),
        };
      });
    } catch {
      setError(t("trips.stay.error"));
    } finally {
      setCopyingStay(false);
    }
  }, [day, ensureCsrfToken, previousStay, t, tripId]);
  const previousStaySegment = previousStay
    ? {
        id: previousStay.id,
        type: "accommodation" as const,
        label: previousStay.name,
        location: previousStay.location ?? null,
        endTime: resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime),
      }
    : null;
  const currentStaySegment = currentStay
    ? {
        id: currentStay.id,
        type: "accommodation" as const,
        label: currentStay.name,
        location: currentStay.location ?? null,
      }
    : null;
  const staySegments = useMemo(
    () =>
      buildStaySegments({
        previousStay: previousStay
          ? { checkOutTime: resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime) }
          : null,
        currentStay: currentStay ? { checkInTime: resolveStayTime(currentStay.checkInTime, defaultCheckInTime) } : null,
      }),
    [currentStay, defaultCheckInTime, defaultCheckOutTime, previousStay],
  );
  const planItemSegments = useMemo(
    () =>
      buildPlanItemSegments(
        planItems.map((item) => ({
          id: item.id,
          fromTime: item.fromTime,
          toTime: item.toTime,
        })),
      ),
    [planItems],
  );
  const travelSegmentsForGantt = useMemo(() => {
    if (!travelSegments.length) return [];
    const accommodationEndTimes: Record<string, string | null | undefined> = {};
    if (previousStay) {
      accommodationEndTimes[previousStay.id] = resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime);
    }
    const planItemEndTimes: Record<string, string | null | undefined> = {};
    for (const item of planItems) {
      planItemEndTimes[item.id] = item.toTime;
    }
    return buildTravelSegments({
      travelSegments: travelSegments.map((segment) => ({
        id: segment.id,
        fromItemType: segment.fromItemType,
        fromItemId: segment.fromItemId,
        durationMinutes: segment.durationMinutes,
      })),
      accommodationEndTimes,
      planItemEndTimes,
    });
  }, [planItems, previousStay, travelSegments]);
  const ganttSegments = useMemo(
    () => [...staySegments, ...planItemSegments, ...travelSegmentsForGantt],
    [planItemSegments, staySegments, travelSegmentsForGantt],
  );
  const ganttCoverage = useMemo(() => deriveCoverageSummary(ganttSegments), [ganttSegments]);
  const formatDurationSummary = useCallback(
    (minutes: number) => {
      const safeMinutes = Math.max(0, Math.round(minutes));
      const hours = Math.floor(safeMinutes / 60);
      const remainingMinutes = safeMinutes % 60;
      if (hours > 0 && remainingMinutes > 0) {
        return formatMessage(t("trips.dayView.ganttHoursMinutes"), { hours, minutes: remainingMinutes });
      }
      if (hours > 0) {
        return formatMessage(t("trips.dayView.ganttHours"), { hours });
      }
      return formatMessage(t("trips.dayView.ganttMinutes"), { minutes: remainingMinutes });
    },
    [t],
  );
  // A stay on record with no check-in time is deliberately never hatched. This screen defaults such a
  // stay to 16:00 so the bar still draws a segment, but Trip Overview - which passes the raw nulls -
  // shows no accommodation segment at all for it. Branching on the raw field (not on whether segments
  // came out empty) keeps the two bars telling the same story about the same day.
  //
  // Only checkInTime is tested: on this day the current stay's checkOutTime feeds the *next* day's
  // previous-night segment, so it has no bearing on whether this bar was drawn from an assumption.
  // Requiring both to be null (the story's original wording) let a stay with a check-out but no
  // check-in draw an assumed 16:00 block *and* hatch the morning - the exact mixture this guards.
  const coverageIsAssumed = Boolean(currentStay && !currentStay.checkInTime);
  // When the bar declines to draw the open time, the caption must not assert a figure for it. Reporting
  // "Unplanned 16h" beside a bar with no hatch had three elements describing the same day three ways;
  // reporting 0 would be worse still, claiming a coverage the bar plainly does not show. The honest
  // answer is that the open time is unknown until a check-in exists.
  const plannedSummary = formatDurationSummary(ganttCoverage.plannedMinutes);
  const ganttSummary = coverageIsAssumed
    ? formatMessage(t("trips.dayView.ganttSummaryAssumed"), { planned: plannedSummary })
    : formatMessage(t("trips.dayView.ganttSummary"), {
        planned: plannedSummary,
        unplanned: formatDurationSummary(ganttCoverage.unplannedMinutes),
      });
  // Gated on the same flag: a bar with nothing hatched because the times are unknown has not earned a
  // "fully planned" badge either.
  const isFullyPlanned = !coverageIsAssumed && ganttCoverage.unplannedMinutes <= 0;
  const coverageSegments = useMemo<TripDayGanttSegment[]>(() => {
    const gaps = ganttCoverage.gaps;
    if (coverageIsAssumed || gaps.length === 0) return ganttSegments;
    // EXPERIENCE.md: a day with no accommodation shows a single oversized gap rather than many small
    // ones - the bar has to say "this day is structurally incomplete", not "some minutes are free".
    const gapSegments: TripDayGanttSegment[] = day?.missingAccommodation
      ? [{ startMinute: gaps[0].startMinute, endMinute: gaps[gaps.length - 1].endMinute, kind: "gap" }]
      : gaps.map((gap) => ({ startMinute: gap.startMinute, endMinute: gap.endMinute, kind: "gap" as const }));
    return [...ganttSegments, ...gapSegments];
  }, [coverageIsAssumed, day?.missingAccommodation, ganttCoverage.gaps, ganttSegments]);
  const totalTravelMinutes = useMemo(
    () =>
      travelSegments.reduce(
        (sum, segment) => sum + (Number.isFinite(segment.durationMinutes) ? Math.max(0, segment.durationMinutes) : 0),
        0,
      ),
    [travelSegments],
  );
  const dayHasTimelineContent = Boolean(previousStay || currentStay || planItems.length > 0);
  // The range strings stay byte-identical when the underlying times are real. When they are not, the
  // pill says so rather than presenting resolveStayTime's 16:00/10:00 fallback as a recorded fact -
  // the stat strip already refuses to, and the two must not contradict each other two cards apart.
  const previousStayRange = previousStay
    ? `00:00 - ${resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime)}`
    : null;
  const previousStayRangeIsAssumed = Boolean(previousStay && !previousStay.checkOutTime?.trim());
  const currentStayRange = currentStay
    ? `${resolveStayTime(currentStay.checkInTime, defaultCheckInTime)} - 24:00`
    : null;
  const currentStayRangeIsAssumed = Boolean(currentStay && !currentStay.checkInTime?.trim());
  const hasDayImage = Boolean(day?.imageUrl && day.imageUrl.trim().length > 0);
  const travelSegmentLabel = useCallback(
    (segment: TravelSegment | null) => {
      if (!segment) return t("trips.travelSegment.addPrompt");
      const transport = t(`trips.travelSegment.transport.${segment.transportType}`);
      const duration = formatDurationMinutes(segment.durationMinutes);
      const distance =
        segment.transportType === "car" && typeof segment.distanceKm === "number"
          ? `${segment.distanceKm} ${t("trips.travelSegment.kmSuffix")}`
          : null;
      return [transport, duration, distance].filter(Boolean).join(" · ");
    },
    [t],
  );
  const buildTravelTimeRange = useCallback((startTime: string | null | undefined, durationMinutes: number | null | undefined) => {
    if (!startTime || !durationMinutes || durationMinutes <= 0) return null;
    const startMinutes = parseTimeToMinutes(startTime);
    if (startMinutes === null) return null;
    const endMinutes = Math.min(startMinutes + durationMinutes, 24 * 60);
    return `${formatMinutesToTime(startMinutes)} - ${formatMinutesToTime(endMinutes)}`;
  }, []);
  const getPlanItemLabel = useCallback(
    (item: DayPlanItem, index: number) => {
      const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
      return item.title?.trim() || preview;
    },
    [t],
  );
  const firstPlanSegment =
    planItems.length > 0
      ? {
          id: planItems[0].id,
          type: "dayPlanItem" as const,
          label: getPlanItemLabel(planItems[0], 0),
          location: planItems[0].location,
          endTime: planItems[0].toTime ?? null,
        }
      : null;
  const previousSegmentTarget = firstPlanSegment ?? (planItems.length === 0 ? currentStaySegment : null);
  // Shared DESIGN.md shells, declared once so the timeline, sidebar and stat strip cannot drift apart.
  const cardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "18px",
  } as const;
  // badge-pill / tl-time: accent text on accent-soft, 4px radius, tabular figures.
  const timePillSx = {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 800,
    color: theme.palette.primary.main,
    backgroundColor: tokens.accentSoft,
    borderRadius: "4px",
    padding: "3px 8px",
    fontVariantNumeric: "tabular-nums",
  } as const;
  // Same pill, drained of accent, for a range derived from a default rather than a stored time.
  //
  // Still inkSoft rather than inkMuted, but for a different reason than before: Story 7.11 darkened
  // inkMuted to #7A7667 (4.55:1 on card white), closing the original finding. This pill is not on card
  // white though - it sits on `tokens.border` #E4DFD3, where inkMuted measures 3.42:1 and inkSoft
  // measures 4.25:1. Neither clears this system's 4.5:1 target on that background, so the swap would
  // strictly lose contrast at 11px for no design gain. Left on inkSoft deliberately; the pill's own
  // background is the thing to revisit if this row is ever reworked.
  const timePillAssumedSx = {
    ...timePillSx,
    color: tokens.inkSoft,
    backgroundColor: tokens.border,
  } as const;
  const renderTimePill = (range: string | null, isAssumed: boolean) => {
    if (!range) return null;
    return (
      <Box sx={{ ...(isAssumed ? timePillAssumedSx : timePillSx), mb: 0.75 }}>
        {isAssumed ? formatMessage(t("trips.dayView.approxTimeRange"), { range }) : range}
      </Box>
    );
  };
  const statValueSx = {
    fontSize: 21,
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
    color: tokens.ink,
    // Cell 4 can hold an accommodation name in its label and the "No accommodation" sentence as its
    // value; without this the overflow is clipped by the hero wrapper's overflow: hidden.
    overflowWrap: "anywhere",
  } as const;
  const statLabelSx = { color: tokens.inkSoft, display: "block", mb: 0.75, overflowWrap: "anywhere" } as const;
  const statCellSx = { p: "16px 24px", minWidth: 0 } as const;
  const tlCardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 1.5,
    minWidth: 0,
  } as const;
  // tl-card-top: the spec's grid, not a flex row - "1fr auto" pins the trailing block (cost, edit
  // affordance) to its content width and centres it against the title block.
  const tlCardTopSx = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "14px",
    alignItems: "center",
  } as const;
  const tlCostSx = {
    fontSize: 13,
    fontWeight: 800,
    color: tokens.ink,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  } as const;
  // The continuous rail: a 2px rule the dots sit on top of, inset so it stops short of both ends.
  //
  // The rule's centre is fixed at x=16 (left 15 + half of 2px) at every breakpoint, because that is
  // where a 32px dot lands at both paddings: xs pulls the dot back 34px from a 34px inset and md 44
  // from 44, so the dot spans 0..32 either way. Moving this to 11px at xs put the rule 4px left of
  // every dot on the timeline.
  const timelineRailSx = {
    position: "relative",
    pl: { xs: "34px", md: "44px" },
    "&::before": {
      content: '""',
      position: "absolute",
      top: 18,
      bottom: 18,
      left: "15px",
      width: "2px",
      backgroundColor: tokens.borderStrong,
    },
  } as const;
  const dotBaseSx = {
    position: "absolute",
    left: { xs: -34, md: -44 },
    top: 0,
    width: 32,
    height: 32,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  } as const;
  const stayDotSx = {
    ...dotBaseSx,
    backgroundColor: tokens.accentSoft,
    border: "2px solid",
    borderColor: theme.palette.primary.main,
  } as const;
  const activityDotSx = {
    ...dotBaseSx,
    backgroundColor: tokens.card,
    border: "2px solid",
    borderColor: tokens.borderStrong,
  } as const;
  const neutralMarkerSx = { width: 8, height: 8, borderRadius: "50%", backgroundColor: tokens.inkSoft } as const;
  // Read from the bar's own palette rather than restating it: a legend that re-derives the fills is
  // correct on the day it is written and wrong the first time the bar changes. The 3px hatch pitch
  // this used to hardcode already disagreed with the default bar's 4px.
  const ganttPalette = buildGanttPalette(theme, "default");
  // The hatch entry appears only when the bar actually renders a gap segment. A legend key for a fill
  // that is nowhere on the bar sends the reader looking for something that does not exist - which is
  // what happened on a day whose stay has no check-in, where the gaps are deliberately suppressed.
  const coverageHasGap = coverageSegments.some((segment) => segment.kind === "gap");
  const coverageLegend = [
    { key: "stay", label: t("trips.dayView.coverageLegendStay"), background: ganttPalette.accommodation },
    { key: "activity", label: t("trips.dayView.coverageLegendActivity"), background: ganttPalette.planItem },
    { key: "travel", label: t("trips.dayView.coverageLegendTravel"), background: ganttPalette.travel },
    ...(coverageHasGap
      ? [{ key: "gap", label: t("trips.dayView.coverageLegendGap"), background: ganttPalette.gap }]
      : []),
  ];

  // tl-segment: a plain icon + text connector row - no card, no photo, per DESIGN.md's timeline spec.
  const renderTravelSegment = (from: SegmentItem, to: SegmentItem) => {
    const segment = segmentsByKey.get(buildSegmentKey(from, to)) ?? null;
    const travelTimeRange = segment ? buildTravelTimeRange(from.endTime, segment.durationMinutes) : null;
    // Only a recorded transportType earns a transport glyph. With no segment saved the row is a prompt
    // to enter one, so a car icon there would assert a mode the user has not chosen - the same reason
    // activity nodes get a neutral marker instead of an inferred icon.
    const TransportIcon = segment ? transportIconFor(segment.transportType) : null;
    return (
      <Box
        key={`segment-${from.id}-${to.id}`}
        data-testid="travel-segment"
        data-from-id={from.id}
        data-to-id={to.id}
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          margin: "-2px 0 12px",
          padding: "6px 0 6px 4px",
          color: tokens.inkSoft,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            // Centres the 22px dot on the rail's x=16 at both paddings (34 - 29 + 11 = 16, 44 - 39 + 11 = 16).
            left: { xs: -29, md: -39 },
            top: 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            backgroundColor: theme.palette.background.default,
            color: tokens.inkSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          {TransportIcon ? <TransportIcon /> : <Box sx={neutralMarkerSx} />}
        </Box>
        <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
          {travelTimeRange ? <Box sx={timePillSx}>{travelTimeRange}</Box> : null}
          <Typography sx={{ fontSize: "11.5px", fontWeight: 700, color: tokens.inkSoft }}>
            {travelSegmentLabel(segment)}
          </Typography>
        </Box>
        {!canEditPlanning ? null : segment ? (
          <IconButton
            size="small"
            color="primary"
            aria-label={t("trips.travelSegment.editAction")}
            onClick={() => handleOpenTravelSegment(from, to)}
          >
            <Box
              component="span"
              sx={{
                position: "absolute",
                width: 1,
                height: 1,
                p: 0,
                m: -1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              {t("trips.travelSegment.editAction")}
            </Box>
            <SvgIcon fontSize="small">
              <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
            </SvgIcon>
          </IconButton>
        ) : (
          <Button size="small" variant="text" onClick={() => handleOpenTravelSegment(from, to)}>
            {t("trips.travelSegment.addAction")}
          </Button>
        )}
      </Box>
    );
  };

  const resolveDayImageSrc = useCallback((imageUrl?: string | null, updatedAt?: string) => {
    if (!imageUrl || !imageUrl.trim()) return null;
    if (!updatedAt) return imageUrl;
    const version = encodeURIComponent(updatedAt);
    return imageUrl.includes("?") ? `${imageUrl}&v=${version}` : `${imageUrl}?v=${version}`;
  }, []);

  /** AC7 — the day-details dialog's preview source, cache-busted the same way the hero is. */
  const dayImagePreviewSrc = useMemo(
    () => resolveDayImageSrc(day?.imageUrl, day?.updatedAt),
    [day?.imageUrl, day?.updatedAt, resolveDayImageSrc],
  );

  const updateLocalDayMeta = useCallback(
    (payload: { imageUrl: string | null; note: string | null; updatedAt?: string }) => {
      if (!day) return;

      setDay((current) =>
        current
          ? { ...current, imageUrl: payload.imageUrl, note: payload.note, updatedAt: payload.updatedAt ?? current.updatedAt }
          : current,
      );
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          days: current.days.map((entry) =>
            entry.id === day.id
              ? { ...entry, imageUrl: payload.imageUrl, note: payload.note, updatedAt: payload.updatedAt ?? entry.updatedAt }
              : entry,
          ),
        };
      });
    },
    [day],
  );

  const handleSaveDayImage = useCallback(async () => {
    if (!day) return;
    const normalizedNote = dayNoteDraft.trim();

    // The picker accepts any image/* so Safari lets the file be selected at all; reject unsupported
    // formats here with a specific reason instead of a generic upload failure from the server.
    if (dayImageFile && !isSupportedImageUpload(dayImageFile)) {
      setError(t("trips.image.unsupportedFormat"));
      return;
    }

    setDayImageSaving(true);
    setError(null);

    try {
      const token = await ensureCsrfToken();
      if (dayImageFile) {
        const formData = new FormData();
        formData.set("file", dayImageFile);
        formData.set("note", normalizedNote.length > 0 ? normalizedNote : "");

        const uploadResponse = await fetch(`/api/trips/${tripId}/days/${day.id}/image`, {
          method: "POST",
          credentials: "include",
          headers: {
            "x-csrf-token": token,
          },
          body: formData,
        });

        const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{
          day: { id: string; imageUrl: string | null; note: string | null; updatedAt: string };
        }>;
        if (!uploadResponse.ok || uploadBody.error || !uploadBody.data?.day) {
          setError(
            uploadBody.error?.message
              ? `${t("trips.dayImage.uploadError")} (${uploadBody.error.message})`
              : t("trips.dayImage.uploadError"),
          );
          return;
        }
        updateLocalDayMeta({
          imageUrl: uploadBody.data.day.imageUrl,
          note: uploadBody.data.day.note,
          updatedAt: uploadBody.data.day.updatedAt,
        });
        setDayImageFile(null);
        setDayNoteDraft(uploadBody.data.day.note ?? "");
        setDayMetaOpen(false);
        return;
      }

      const response = await fetch(`/api/trips/${tripId}/days/${day.id}/image`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          imageUrl: day.imageUrl ?? null,
          note: normalizedNote.length > 0 ? normalizedNote : null,
        }),
      });

      const body = (await response.json()) as ApiEnvelope<{
        day: { id: string; imageUrl: string | null; note: string | null; updatedAt: string };
      }>;
      if (!response.ok || body.error || !body.data?.day) {
        setError(body.error?.message ? `${t("trips.dayImage.saveError")} (${body.error.message})` : t("trips.dayImage.saveError"));
        return;
      }

      updateLocalDayMeta({ imageUrl: body.data.day.imageUrl, note: body.data.day.note, updatedAt: body.data.day.updatedAt });
      setDayImageFile(null);
      setDayNoteDraft(body.data.day.note ?? "");
      setDayMetaOpen(false);
    } catch {
      setError(t("trips.dayImage.saveError"));
    } finally {
      setDayImageSaving(false);
    }
  }, [day, dayImageFile, dayNoteDraft, ensureCsrfToken, t, tripId, updateLocalDayMeta]);

  const handleRemoveDayImage = useCallback(async () => {
    if (!day) return;

    setDayImageSaving(true);
    setError(null);

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/days/${day.id}/image`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ imageUrl: null, note: dayNoteDraft.trim().length > 0 ? dayNoteDraft.trim() : null }),
      });

      const body = (await response.json()) as ApiEnvelope<{
        day: { id: string; imageUrl: string | null; note: string | null; updatedAt: string };
      }>;
      if (!response.ok || body.error || !body.data?.day) {
        setError(body.error?.message ? `${t("trips.dayImage.saveError")} (${body.error.message})` : t("trips.dayImage.saveError"));
        return;
      }

      updateLocalDayMeta({ imageUrl: null, note: body.data.day.note, updatedAt: body.data.day.updatedAt });
      setDayImageFile(null);
      setDayNoteDraft(body.data.day.note ?? "");
    } catch {
      setError(t("trips.dayImage.saveError"));
    } finally {
      setDayImageSaving(false);
    }
  }, [day, dayNoteDraft, ensureCsrfToken, t, tripId, updateLocalDayMeta]);

  const budgetEntries = useMemo(() => {
    const entries: { id: string; label: string; amountCents: number | null }[] = [];

    planItems.forEach((item, index) => {
      const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
      const title = item.title?.trim() || preview;
      entries.push({
        id: item.id,
        label: title,
        amountCents: item.costCents,
      });
    });

    if (currentStay) {
      entries.push({
        id: `current-stay-${currentStay.id}`,
        label: formatMessage(t("trips.dayView.budgetItemCurrentNight"), { name: currentStay.name }),
        amountCents: currentStay.costCents,
      });
    }

    return entries;
  }, [currentStay, planItems, t]);

  const knownBudgetEntries = useMemo(
    () =>
      budgetEntries.filter(
        (entry): entry is { id: string; label: string; amountCents: number } => entry.amountCents !== null,
      ),
    [budgetEntries],
  );
  const dayTotalCents = knownBudgetEntries.reduce((sum, entry) => sum + entry.amountCents, 0);

  const mapData = useMemo(
    () => {
      const mapItems = buildTripDayMapItems({
        previousStay: previousStay ? { id: previousStay.id, name: previousStay.name, location: previousStay.location } : null,
        planItems: planItems.map((item, index) => ({
          id: item.id,
          label:
            item.title?.trim() ||
            parsePlanText(item.contentJson) ||
            formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 }),
          location: item.location,
        })),
        currentStay: currentStay ? { id: currentStay.id, name: currentStay.name, location: currentStay.location } : null,
      });
      return buildDayMapPanelData(mapItems);
    },
    [currentStay, planItems, previousStay, t],
  );

  const handleMapMarkerClick = useCallback(
    (point: TripDayMapPoint) => {
      if (point.kind === "planItem") {
        const planItem = planItems.find((item) => item.id === point.id);
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
    [currentStay, planItems, previousStay],
  );

  const handleMapExpand = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(scrollRestoreKey, String(window.scrollY));
    } catch {
      // Ignore storage failures.
    }
  }, [scrollRestoreKey]);

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

  if (loading) {
    // A skeleton silhouette of this screen's own layout - hero, coverage panel, stat strip, columns -
    // rather than a spinner, per EXPERIENCE.md's cold-load convention for a full route load.
    return (
      <Box sx={cardSx} data-testid="trip-day-view-loading">
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="rectangular" height={210} sx={{ borderRadius: "8px" }} />
          <Skeleton variant="rectangular" height={16} sx={{ borderRadius: "4px" }} />
          <Skeleton variant="text" width="40%" height={34} />
          <Skeleton variant="rectangular" height={220} />
        </Box>
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="heading" component="h5" sx={{ color: tokens.ink }}>
            {t("trips.dayView.notFoundTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.dayView.notFoundBody")}
          </Typography>
          <Button component={Link} href={`/trips/${tripId}`} variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.dayView.back")}
          </Button>
        </Box>
      </Box>
    );
  }

  const dayTitle =
    day && day.note && day.note.trim().length > 0
      ? formatMessage(t("trips.dayView.titleWithNote"), { index: day.dayIndex, note: day.note.trim() })
      : day
        ? formatMessage(t("trips.dayView.title"), { index: day.dayIndex })
        : "";

  const isDayGap = Boolean(day?.missingAccommodation);
  const dayHeroImageCss = toCssUrl(
    resolveDayImageSrc(day?.imageUrl, day?.updatedAt) ?? "/images/world-map-placeholder.svg",
  );
  // One predicate for "this day has somewhere to sleep", shared with the timeline's warn treatment.
  // Both derive from the same server field (missingAccommodation is !hasAccommodation in tripRepo), so
  // the screen's two gap signals must not be computed from two different expressions.
  const statStay = isDayGap ? null : currentStay;
  const checkInStatValue = !statStay
    ? t("trips.timeline.noAccommodation")
    : // The gantt falls back to 16:00 so it has a segment to draw; a stat cell is read as a fact about
      // the booking, so an unset check-in stays an em dash rather than surfacing the assumption.
      statStay.checkInTime?.trim() || "—";

  return (
    <Box display="flex" flexDirection="column" gap={2} data-testid="trip-day-view-page">
      {error && <Alert severity="error">{error}</Alert>}

      {detail && day && (
        <>
          <Box sx={{ borderRadius: "8px", overflow: "hidden", border: "1px solid", borderColor: tokens.border }}>
            <Box
              data-testid="day-hero"
              sx={{
                position: "relative",
                minHeight: 210,
                display: "flex",
                flexDirection: "column",
                padding: "22px 32px 24px",
                overflow: "hidden",
                backgroundColor: theme.palette.primary.main,
                backgroundImage: dayHeroImageCss,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <Box aria-hidden sx={{ position: "absolute", inset: 0, background: HERO_SCRIM }} />
              {/* In normal flow, not absolutely positioned. Out of flow it reserved no height, so a day
                  with a note - the title is "Day N: {note}" at 28px/900, and notes run to 280 chars -
                  grew the title block upward until its first line ran under the breadcrumb. */}
              <Box
                sx={{
                  position: "relative",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  zIndex: 2,
                  gap: 2,
                  mb: 2,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    fontSize: 12,
                    fontWeight: 700,
                    minWidth: 0,
                    // The breadcrumb sits at the scrim's weakest stop (.26) over arbitrary user
                    // photography, so it needs the same shadow the title already carries.
                    textShadow: "0 2px 14px rgba(0,0,0,.35)",
                  }}
                >
                  <Box
                    component={Link}
                    href={`/trips/${tripId}`}
                    sx={{
                      color: "rgba(255,255,255,.82)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    {detail.trip.name}
                  </Box>
                  <Box component="span" aria-hidden sx={{ color: "rgba(255,255,255,.45)" }}>
                    /
                  </Box>
                  <Box
                    component="span"
                    sx={{ color: "#FFFFFF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {formatMessage(t("trips.dayView.title"), { index: day.dayIndex })}
                  </Box>
                </Box>
                <Box display="flex" alignItems="center" gap={1} sx={{ flexShrink: 0 }}>
                  {isOwner ? (
                    <IconButton
                      size="small"
                      aria-label={t("trips.dayImage.editAction")}
                      title={t("trips.dayImage.editAction")}
                      onClick={() => setDayMetaOpen(true)}
                      // 44px hit area: the theme sets minHeight on MuiButton but has no MuiIconButton
                      // override, so size="small" alone renders ~28px - under the accessibility floor
                      // this same story enforces on the bucket-list "+".
                      sx={{ ...ON_PHOTO_CHROME, width: 44, height: 44 }}
                    >
                      <SvgIcon fontSize="inherit">
                        <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                      </SvgIcon>
                    </IconButton>
                  ) : null}
                  {/* No leading icon: trips.dayView.back already opens with an arrow glyph, and an
                      existing test pins that exact accessible name. */}
                  <Button
                    component={Link}
                    href={`/trips/${tripId}`}
                    variant="text"
                    sx={{ ...ON_PHOTO_CHROME, whiteSpace: "nowrap" }}
                  >
                    {t("trips.dayView.back")}
                  </Button>
                </Box>
              </Box>
              {/* mt: auto keeps the title bottom-anchored now that the hero is no longer
                  justify-content: flex-end (the top row is in flow and must stay at the top). */}
              <Box sx={{ position: "relative", zIndex: 2, mt: "auto" }}>
                {/* component="h5" is not optional: custom typography variants carry no variantMapping,
                    so without it this renders as a <span> and the page loses its only heading. */}
                <Typography
                  variant="display"
                  component="h5"
                  sx={{ color: "#FFFFFF", textShadow: "0 2px 14px rgba(0,0,0,.35)", overflowWrap: "anywhere" }}
                >
                  {dayTitle}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,.92)", fontSize: 13, fontWeight: 600, mt: 0.75 }}>
                  {formatDate(day.date)}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                backgroundColor: tokens.card,
                borderBottom: "1px solid",
                borderColor: tokens.border,
                padding: { xs: "16px 16px 18px", md: "16px 32px 18px" },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 1,
                  mb: 1.25,
                }}
              >
                <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft }}>
                  {t("trips.dayView.coverageTitle")}
                </Typography>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  {coverageLegend.map((entry) => (
                    <Box key={entry.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <Box
                        aria-hidden
                        data-testid={`coverage-legend-swatch-${entry.key}`}
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "2px",
                          flexShrink: 0,
                          background: entry.background,
                          ...(entry.key === "gap" ? { border: "1px solid", borderColor: tokens.warnBorder } : {}),
                        }}
                      />
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: tokens.inkSoft }}>
                        {entry.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <TripDayGanttBar segments={coverageSegments} ariaLabel={t("trips.dayView.ganttAriaLabel")} />

              <Box aria-hidden sx={{ position: "relative", height: 14, mt: 0.75 }} data-testid="coverage-axis">
                {COVERAGE_AXIS_TICKS.map((tick) => (
                  <Typography
                    key={tick.label}
                    sx={{
                      position: "absolute",
                      top: 0,
                      left: `${tick.percent}%`,
                      transform: tick.percent === 0 ? "none" : tick.percent === 100 ? "translateX(-100%)" : "translateX(-50%)",
                      fontSize: 10,
                      fontWeight: 600,
                      color: tokens.inkMuted,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {tick.label}
                  </Typography>
                ))}
              </Box>
              {/* The tick row stays aria-hidden - five bare numbers read in sequence are noise - but the
                  domain it conveys is real information that appears nowhere else, so it is carried in
                  text for assistive tech instead of being dropped. */}
              <Box
                component="span"
                sx={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  p: 0,
                  m: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              >
                {t("trips.dayView.coverageAxisDescription")}
              </Box>

              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mt={1}>
                <Typography variant="body2" sx={{ color: tokens.inkSoft }} aria-live="polite">
                  {ganttSummary}
                </Typography>
                {isFullyPlanned ? (
                  <Chip size="small" color="success" label={t("trips.dayView.ganttFullyPlanned")} />
                ) : null}
              </Box>
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                backgroundColor: tokens.card,
              }}
            >
              <Box
                sx={{
                  ...statCellSx,
                  borderRight: "1px solid",
                  borderBottom: { xs: "1px solid", sm: "none" },
                  borderColor: tokens.border,
                }}
                data-testid="day-stat-day"
              >
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statDay")}
                </Typography>
                <Typography sx={statValueSx}>
                  {formatMessage(t("trips.dayView.statDayValue"), {
                    index: day.dayIndex,
                    total: detail.trip.dayCount,
                  })}
                </Typography>
              </Box>
              <Box
                sx={{
                  ...statCellSx,
                  borderRight: { xs: "none", sm: "1px solid" },
                  borderBottom: { xs: "1px solid", sm: "none" },
                  borderColor: tokens.border,
                }}
                data-testid="day-stat-travel-time"
              >
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statTravelTime")}
                </Typography>
                <Typography sx={statValueSx}>{formatDurationSummary(totalTravelMinutes)}</Typography>
              </Box>
              <Box
                sx={{ ...statCellSx, borderRight: "1px solid", borderColor: tokens.border }}
                data-testid="day-stat-spend-today"
              >
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statSpendToday")}
                </Typography>
                <Typography sx={{ ...statValueSx, color: theme.palette.primary.main }}>
                  {formatCost(dayTotalCents)}
                </Typography>
              </Box>
              <Box sx={statCellSx}>
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {statStay
                    ? formatMessage(t("trips.dayView.statCheckIn"), { name: statStay.name })
                    : t("trips.dayView.statCheckInGeneric")}
                </Typography>
                <Typography
                  data-testid="day-stat-check-in"
                  sx={{ ...statValueSx, color: statStay ? tokens.ink : theme.palette.warning.main }}
                >
                  {checkInStatValue}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Day-to-day navigation and print. Undepicted by the mockup, which shows only the
              breadcrumb and back button - kept as its own slim toolbar rather than dropped. */}
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            {previousDay ? (
              <Button
                component={Link}
                href={`/trips/${tripId}/days/${previousDay.id}`}
                variant="outlined"
                size="small"
                aria-label={t("trips.dayView.previousAria")}
              >
                {t("trips.dayView.previousAction")}
              </Button>
            ) : (
              <Button variant="outlined" size="small" disabled aria-label={t("trips.dayView.previousAria")}>
                {t("trips.dayView.previousAction")}
              </Button>
            )}
            {nextDay ? (
              <Button
                component={Link}
                href={`/trips/${tripId}/days/${nextDay.id}`}
                variant="outlined"
                size="small"
                aria-label={t("trips.dayView.nextAria")}
              >
                {t("trips.dayView.nextAction")}
              </Button>
            ) : (
              <Button variant="outlined" size="small" disabled aria-label={t("trips.dayView.nextAria")}>
                {t("trips.dayView.nextAction")}
              </Button>
            )}
            <Button
              component={Link}
              href={`/trips/${tripId}/days/${day.id}/print`}
              variant="text"
              size="small"
              aria-label={t("trips.dayView.printAria")}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("trips.dayView.printAction")}
            </Button>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" },
              gap: { xs: 2, md: 0 },
            }}
          >
            <Box sx={{ p: { xs: 0, md: "22px 28px 22px 0" }, minWidth: 0 }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap" mb={1.5}>
                <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft }}>
                  {t("trips.dayView.timelineTitle")}
                </Typography>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                  {canEditPlanning ? (
                    <Button size="small" variant="outlined" onClick={() => handleOpenTransferDialog("move")}>
                      {t("trips.dayTransfer.moveAction")}
                    </Button>
                  ) : null}
                  {canEditPlanning ? (
                    <Button size="small" variant="outlined" onClick={() => handleOpenTransferDialog("swap")}>
                      {t("trips.dayTransfer.swapAction")}
                    </Button>
                  ) : null}
                  {canEditPlanning ? (
                    <Button size="small" variant="outlined" onClick={() => setStayOpen(true)}>
                      {day.accommodation ? (
                        <>
                          {t("trips.stay.editAction")}
                          <SvgIcon fontSize="small" sx={{ ml: 0.75 }}>
                            <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                          </SvgIcon>
                        </>
                      ) : (
                        t("trips.stay.addAction")
                      )}
                    </Button>
                  ) : null}
                  {canEditPlanning ? (
                    <Button size="small" variant="outlined" onClick={handleOpenAddPlan}>
                      {t("trips.plan.addPrimaryAction")}
                    </Button>
                  ) : null}
                </Box>
              </Box>
              {!dayHasTimelineContent && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                  {t("trips.dayView.timelineEmpty")}
                </Typography>
              )}

              <Box sx={timelineRailSx}>
                <Box sx={{ position: "relative", mb: "12px" }} data-testid="timeline-previous-stay">
                  <Box aria-hidden sx={stayDotSx}>
                    <HouseIcon sx={{ color: theme.palette.primary.main }} />
                  </Box>
                  <Box sx={{ ...tlCardSx, backgroundColor: tokens.cardAlt }}>
                  <Box sx={tlCardTopSx}>
                    <Box sx={{ minWidth: 0 }}>
                      {renderTimePill(previousStayRange, previousStayRangeIsAssumed)}
                      <Typography variant="cardTitle" component="p" sx={{ color: tokens.ink, m: 0 }}>
                        {previousStay ? previousStay.name : t("trips.dayView.previousNightEmpty")}
                      </Typography>
                      <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                        {t("trips.dayView.previousNightTitle")}
                      </Typography>
                    </Box>
                    {previousDay && canEditPlanning ? (
                      previousStay ? (
                        <Button size="small" variant="text" onClick={() => setPreviousStayOpen(true)}>
                          {t("trips.stay.editAction")}
                          <SvgIcon fontSize="small" sx={{ ml: 0.75 }}>
                            <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                          </SvgIcon>
                        </Button>
                      ) : (
                        <Button size="small" variant="text" onClick={() => setPreviousStayOpen(true)}>
                          {t("trips.stay.addAction")}
                        </Button>
                      )
                    ) : null}
                  </Box>
                  {previousStay ? (
                    <Box display="flex" flexDirection="column" gap={0.75}>
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Chip
                          label={previousStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                          size="small"
                          color={previousStay.status === "booked" ? "success" : "default"}
                          variant="outlined"
                        />
                      </Box>
                      {/* Last child: DESIGN.md's photo-strip runs along the bottom of the card. */}
                      <MiniImageStrip
                        variant="strip"
                        images={previousAccommodationImages}
                        altPrefix={previousStay.name}
                        onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                      />
                    </Box>
                  ) : null}
                  </Box>
                </Box>

                {previousStaySegment && previousSegmentTarget
                  ? renderTravelSegment(previousStaySegment, previousSegmentTarget)
                  : null}

                {planItems.length === 0 ? (
                  <Box sx={{ position: "relative", mb: "12px" }}>
                    <Box aria-hidden sx={activityDotSx}>
                      <Box sx={neutralMarkerSx} />
                    </Box>
                    <Box sx={tlCardSx}>
                      <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                        {t("trips.dayView.activitiesEmpty")}
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  planItems.map((item, index) => {
                    const preview =
                      parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
                    const title = item.title?.trim() || preview;
                    const segmentItem: SegmentItem = {
                      id: item.id,
                      type: "dayPlanItem",
                      label: title,
                      location: item.location,
                      endTime: item.toTime ?? null,
                    };
                    const nextPlanItem = planItems[index + 1];
                    const nextSegmentItem = nextPlanItem
                      ? {
                          id: nextPlanItem.id,
                          type: "dayPlanItem" as const,
                          label: getPlanItemLabel(nextPlanItem, index + 1),
                          location: nextPlanItem.location,
                          endTime: nextPlanItem.toTime ?? null,
                        }
                      : currentStaySegment;

                    return (
                      <Box key={item.id}>
                        <Box sx={{ position: "relative", mb: "12px" }}>
                          {/* AC2: one uniform neutral marker for every activity. The data model has no
                              activity-type field and EXPERIENCE.md forbids adding one for iconography. */}
                          <Box aria-hidden sx={activityDotSx}>
                            <Box sx={neutralMarkerSx} data-testid="activity-neutral-marker" />
                          </Box>
                          <Box sx={tlCardSx}>
                          <Box sx={tlCardTopSx}>
                            <Box display="flex" flexDirection="column" gap={0.75} sx={{ minWidth: 0 }}>
                              <Box>
                                {item.fromTime && item.toTime ? (
                                  <Box sx={{ ...timePillSx, mb: 0.75 }}>{`${item.fromTime} - ${item.toTime}`}</Box>
                                ) : null}
                                <Typography variant="cardTitle" component="p" sx={{ color: tokens.ink, m: 0 }}>
                                  {title}
                                </Typography>
                              </Box>
                              <PlanItemRichContent contentJson={item.contentJson} fallbackText={preview} />
                              {item.linkUrl && isSafeLink(item.linkUrl) ? (
                                <Button
                                  component="a"
                                  href={item.linkUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  variant="text"
                                  size="small"
                                  sx={{ p: 0, minWidth: "auto", alignSelf: "flex-start" }}
                                >
                                  {t("trips.plan.linkOpen")}
                                </Button>
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  {t("trips.plan.noLink")}
                                </Typography>
                              )}
                              {/* Last child: DESIGN.md's photo-strip runs along the bottom of the card. */}
                              <MiniImageStrip
                                variant="strip"
                                images={planItemImagesById[item.id] ?? []}
                                altPrefix={t("trips.dayView.timelineTitle")}
                                onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                              />
                            </Box>
                            {/* tl-card-top's trailing block: the cost this activity actually recorded,
                                then the edit affordance. An activity cost was previously reachable only
                                by cross-referencing the sidebar breakdown, while the stay card beside it
                                showed money - the mockup puts tl-cost on every card that has one. */}
                            <Box display="flex" alignItems="center" gap={0.5}>
                              {typeof item.costCents === "number" ? (
                                <Typography sx={tlCostSx} data-testid="day-plan-item-cost">
                                  {formatCost(item.costCents)}
                                </Typography>
                              ) : null}
                              {canEditPlanning ? (
                                <Box display="flex" alignItems="center" gap={0.5} data-testid="day-plan-item-actions">
                                  <IconButton
                                    size="small"
                                    aria-label={t("trips.plan.editItemAria")}
                                    title={t("trips.plan.editItemAria")}
                                    onClick={() => handleOpenEditPlan(item)}
                                    data-testid="day-plan-item-edit"
                                  >
                                    <SvgIcon fontSize="inherit">
                                      <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                                    </SvgIcon>
                                  </IconButton>
                                </Box>
                              ) : null}
                            </Box>
                          </Box>
                          </Box>
                        </Box>
                        {nextSegmentItem ? renderTravelSegment(segmentItem, nextSegmentItem) : null}
                      </Box>
                    );
                  })
                )}

                <Box sx={{ position: "relative", mb: "12px" }} data-testid="timeline-current-stay">
                  <Box
                    aria-hidden
                    sx={
                      isDayGap
                        ? { ...stayDotSx, backgroundColor: tokens.warnBg, borderColor: tokens.warnBorder }
                        : stayDotSx
                    }
                  >
                    {isDayGap ? (
                      <WarningTriangleIcon sx={{ color: theme.palette.warning.main }} />
                    ) : (
                      <HouseIcon sx={{ color: theme.palette.primary.main }} />
                    )}
                  </Box>
                  <Box
                    sx={
                      isDayGap
                        ? { ...tlCardSx, backgroundColor: tokens.warnBg, borderColor: tokens.warnBorder }
                        : { ...tlCardSx, backgroundColor: tokens.cardAlt }
                    }
                  >
                  <Box sx={tlCardTopSx}>
                    <Box sx={{ minWidth: 0 }}>
                      {renderTimePill(currentStayRange, currentStayRangeIsAssumed)}
                      <Typography variant="cardTitle" component="p" sx={{ color: tokens.ink, m: 0 }}>
                        {currentStay ? currentStay.name : t("trips.dayView.currentNightEmpty")}
                      </Typography>
                      <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                        {t("trips.dayView.currentNightTitle")}
                      </Typography>
                    </Box>
                    {canCopyPreviousStay && canEditPlanning ? (
                      <Button size="small" variant="text" disabled={copyingStay} onClick={() => void handleCopyPreviousStay()}>
                        {t("trips.stay.copyPreviousAction")}
                      </Button>
                    ) : null}
                  </Box>
                  {/* State Patterns: on a flagged day the accommodation slot names what is missing, in
                      warn colour paired with an icon and real text - never colour alone. */}
                  {isDayGap ? (
                    <Box
                      data-testid="day-detail-gap-pill"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        alignSelf: "flex-start",
                        gap: 0.75,
                        backgroundColor: tokens.warnBg,
                        color: theme.palette.warning.main,
                        px: 1.25,
                        py: 0.75,
                        borderRadius: "6px",
                        fontSize: "11.5px",
                        fontWeight: 700,
                      }}
                    >
                      <WarningTriangleIcon />
                      {t("trips.timeline.noAccommodation")}
                    </Box>
                  ) : null}
                  {currentStay ? (
                    <Box display="flex" flexDirection="column" gap={0.75}>
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Chip
                          label={currentStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                          size="small"
                          color={currentStay.status === "booked" ? "success" : "default"}
                          variant="outlined"
                        />
                        {typeof currentStay.costCents === "number" ? (
                          <Typography sx={tlCostSx}>{formatCost(currentStay.costCents)}</Typography>
                        ) : null}
                      </Box>
                      {/* Last child: DESIGN.md's photo-strip runs along the bottom of the card. */}
                      <MiniImageStrip
                        variant="strip"
                        images={accommodationImages}
                        altPrefix={currentStay.name}
                        onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                      />
                    </Box>
                  ) : null}
                  </Box>
                </Box>
              </Box>
            </Box>

            <Box
              sx={{
                p: { xs: 0, md: "22px 0 22px 22px" },
                borderLeft: { xs: "none", md: "1px solid" },
                borderColor: tokens.border,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                minWidth: 0,
              }}
            >
              <Box sx={cardSx}>
                <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft, display: "block", mb: 1.25 }}>
                  {t("trips.dayView.costCardTitle")}
                </Typography>
                <Typography
                  variant="metricLg"
                  data-testid="day-cost-total"
                  sx={{ color: tokens.ink, fontVariantNumeric: "tabular-nums" }}
                >
                  {formatCost(dayTotalCents)}
                </Typography>
                {/* 12px/600 per Task 6; body2 is 11.5px, which quietly undershot every other prescribed
                    size on this card. */}
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: tokens.inkSoft, mb: 1.5, display: "block" }}>
                  {formatMessage(t("trips.dayView.costCardSubtitle"), { index: day.dayIndex })}
                </Typography>

                {knownBudgetEntries.length === 0 ? (
                  <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                    {t("trips.dayView.budgetEmpty")}
                  </Typography>
                ) : (
                  // A real ul/li - the bordered rows are presentational and must not cost the breakdown
                  // its list semantics. :last-child rather than a per-row hardcode, since this list is
                  // dynamic and a hardcode would break the moment an entry is added or removed.
                  <Box
                    component="ul"
                    sx={{ listStyle: "none", m: 0, p: 0, "& > li:last-child": { borderBottom: "none" } }}
                  >
                    {knownBudgetEntries.map((entry) => (
                      <Box
                        component="li"
                        key={entry.id}
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 1.5,
                          py: "7px",
                          borderBottom: "1px solid",
                          borderColor: tokens.border,
                        }}
                      >
                        <Typography sx={{ fontSize: "12.5px", fontWeight: 600, color: tokens.ink, overflowWrap: "anywhere" }}>
                          {entry.label}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: "12.5px",
                            fontWeight: 700,
                            color: tokens.ink,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatCost(entry.amountCents)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              <TripDayMapPanel
                loading={loading}
                points={mapData.points}
                missingLocations={mapData.missingLocations}
                polylinePositions={routePolyline.length >= 2 ? routePolyline : mapData.points.map((point) => point.position)}
                routingUnavailable={routingUnavailable}
                expandHref={day ? `/trips/${tripId}/days/${day.id}/map` : undefined}
                onExpandClick={handleMapExpand}
                onMarkerClick={handleMapMarkerClick}
              />
              {isOwner ? (
                <TripDayBucketListPanel
                  items={bucketItems}
                  loading={bucketLoading}
                  error={bucketError}
                  onAddToDay={handleAddBucketToDay}
                />
              ) : null}
            </Box>
          </Box>

          <TripAccommodationDialog
            open={stayOpen}
            tripId={tripId}
            stayType="current"
            day={day}
            onClose={() => setStayOpen(false)}
            onSaved={() => {
              setStayOpen(false);
              loadDay();
            }}
          />
          <TripAccommodationDialog
            open={previousStayOpen}
            tripId={tripId}
            stayType="previous"
            day={previousDay}
            onClose={() => setPreviousStayOpen(false)}
            onSaved={() => {
              setPreviousStayOpen(false);
              loadDay();
            }}
          />
          <TripDayTravelSegmentDialog
            open={segmentDialogOpen}
            tripId={tripId}
            tripDayId={day?.id ?? null}
            fromItem={activeSegmentFrom}
            toItem={activeSegmentTo}
            segment={activeSegment}
            onClose={() => {
              setSegmentDialogOpen(false);
              setActiveSegment(null);
              setActiveSegmentFrom(null);
              setActiveSegmentTo(null);
            }}
            onSaved={(segment) => {
              handleTravelSegmentSaved(segment);
              setActiveSegment(null);
              setActiveSegmentFrom(null);
              setActiveSegmentTo(null);
            }}
          />
          <TripDayPlanDialog
            open={planDialogMode !== null}
            mode={planDialogMode ?? "add"}
            tripId={tripId}
            day={day}
            item={selectedPlanItem}
            prefill={planDialogPrefill}
            onDelete={handleDeletePlan}
            onClose={handlePlanDialogClose}
            onSaved={handlePlanDialogSaved}
          />
          <Dialog open={transferMode !== null} onClose={handleCloseTransferDialog} fullWidth maxWidth="sm">
            <DialogTitle>
              {transferMode === "move" ? t("trips.dayTransfer.moveAction") : t("trips.dayTransfer.swapAction")}
            </DialogTitle>
            <DialogContent>
              <Box mt={0.5} display="flex" flexDirection="column" gap={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {transferMode === "move" ? t("trips.dayTransfer.moveDescription") : t("trips.dayTransfer.swapDescription")}
                </Typography>
                <TextField
                  select
                  label={t("trips.dayTransfer.targetLabel")}
                  value={transferTargetDayId}
                  onChange={(event) => setTransferTargetDayId(event.target.value)}
                  fullWidth
                  SelectProps={{ native: true }}
                >
                  <option value="" />
                  {transferTargetOptions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {formatMessage(t("trips.dayView.title"), { index: candidate.dayIndex })} · {formatDate(candidate.date)}
                    </option>
                  ))}
                </TextField>
                {transferNeedsOverwriteWarning ? (
                  <Alert severity="warning">{t("trips.dayTransfer.moveOverwriteWarning")}</Alert>
                ) : null}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseTransferDialog} color="inherit" disabled={transferSubmitting}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void handleSubmitTransfer()}
                variant="contained"
                disabled={transferSubmitting || !transferTargetDayId}
              >
                {transferMode === "move" ? t("trips.dayTransfer.confirmMove") : t("trips.dayTransfer.confirmSwap")}
              </Button>
            </DialogActions>
          </Dialog>
          <DialogShell
            open={dayMetaOpen}
            onClose={() => setDayMetaOpen(false)}
            title={t("trips.dayImage.dialogTitle")}
            width={460}
            // Save and Remove are disabled while `dayImageSaving`; the dismissal gestures follow.
            disableDismiss={dayImageSaving}
            footer={
              <>
                {/* No `color="error"` on the destructive action (AC8) — and none was there to begin
                    with; this keeps the text variant explicit so a later edit does not add one. */}
                <Button
                  variant="text"
                  onClick={() => void handleRemoveDayImage()}
                  disabled={dayImageSaving || !hasDayImage}
                  sx={{ color: tokens.ink }}
                >
                  {t("trips.dayImage.removeAction")}
                </Button>
                <Box sx={{ display: "flex", flexDirection: { xs: "column-reverse", sm: "row" }, gap: "10px" }}>
                  <Button variant="outlined" onClick={() => setDayMetaOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={() => void handleSaveDayImage()} variant="contained" disabled={dayImageSaving}>
                    {t("trips.dayImage.saveAction")}
                  </Button>
                </Box>
              </>
            }
            footerSx={{ justifyContent: "space-between" }}
          >
            <Box display="flex" flexDirection="column" gap="18px">
              <PhotoUploadField
                id={`${dayMetaIdPrefix}-image`}
                label={t("trips.dayImage.fileLabel")}
                zoneTitle={t("trips.gallery.uploadZoneTitle")}
                // The size limit is this surface's own (15MB) — deliberately not a shared key: the
                // hero field says 5MB and the galleries say nothing. Reconciling the three is a
                // validation question, not a visual one.
                zoneHint={t("trips.dayImage.fileHelper")}
                accept={IMAGE_UPLOAD_ACCEPT}
                // Locked while a save is in flight, matching the Remove and Save buttons below and
                // the two galleries' `disabled={galleryBusy}` — otherwise a file picked mid-request
                // lands in `dayImageFile` behind the response that is about to arrive.
                disabled={dayImageSaving}
                onFilesSelected={(files) => setDayImageFile(files[0] ?? null)}
                selectionLabel={dayImageFile?.name}
                emptyLabel={hasDayImage ? undefined : t("trips.dayImage.empty")}
                /*
                  AC7: before this, the dialog rendered only the selected file's *name*, so a
                  non-sighted owner had no way to confirm an upload had landed. The current image is
                  meaning-bearing here (DESIGN.md.Photo Alt-Text), so it gets a real alt string and
                  no remove affordance — removal is the footer's explicit action, which also clears
                  the note-side state.
                */
                images={
                  hasDayImage && dayImagePreviewSrc
                    ? [
                        {
                          key: "current-day-image",
                          imageUrl: dayImagePreviewSrc,
                          alt: t("trips.dayImage.previewAlt"),
                        },
                      ]
                    : []
                }
              />
              <FormField
                id={`${dayMetaIdPrefix}-note`}
                label={t("trips.dayImage.noteLabel")}
                value={dayNoteDraft}
                onChange={(event) => setDayNoteDraft(event.target.value)}
                hint={t("trips.dayImage.noteHelper")}
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: 280 } }}
              />
            </Box>
          </DialogShell>
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
                        images={
                          mapDialogItem.kind === "previousStay" ? previousAccommodationImages : accommodationImages
                        }
                        altPrefix={mapDialogItem.label}
                        onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                      />
                    </>
                  )}
                </Box>
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      )}
    </Box>
  );
}
