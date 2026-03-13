"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  Paper,
  Skeleton,
  SvgIcon,
  TextField,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import TripDayGanttBar from "@/components/features/trips/TripDayGanttBar";
import {
  buildPlanItemSegments,
  buildStaySegments,
  buildTravelSegments,
  deriveCoverageSummary,
} from "@/components/features/trips/TripDayGanttSegments";
import TripDayMapPanel, {
  buildDayMapPanelData,
  buildTripDayMapItems,
  type TripDayMapPoint,
} from "@/components/features/trips/TripDayMapPanel";
import TripDayBucketListPanel from "@/components/features/trips/TripDayBucketListPanel";
import TripDayPlanDialog from "@/components/features/trips/TripDayPlanDialog";
import TripDayTravelSegmentDialog from "@/components/features/trips/TripDayTravelSegmentDialog";
import TripFeedbackPanel, { type FeedbackSummary } from "@/components/features/trips/TripFeedbackPanel";
import { MiniImageStrip, PlanItemRichContent, isSafeLink, parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  currentUserId?: string;
  accessRole?: "owner" | "viewer" | "contributor";
  startDate: string;
  endDate: string;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
  feedback?: FeedbackSummary;
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
    feedback?: FeedbackSummary;
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
    feedback?: FeedbackSummary;
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
  feedback?: FeedbackSummary;
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
  feedback?: FeedbackSummary;
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

const buildSegmentKey = (from: SegmentItem, to: SegmentItem) => `${from.type}:${from.id}::${to.type}:${to.id}`;
const hasUsableSegmentLocation = (item: SegmentItem) =>
  Boolean(item.location && Number.isFinite(item.location.lat) && Number.isFinite(item.location.lng));
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
  const [prefillSegmentRouteOnOpen, setPrefillSegmentRouteOnOpen] = useState(false);
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

  const buildFeedbackContextLabel = useCallback(
    (value: string) => value.trim(),
    [],
  );

  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
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
          feedback: item.feedback,
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

  const handleOpenTravelSegment = (from: SegmentItem, to: SegmentItem, options?: { prefillRoute?: boolean }) => {
    if (!canEditPlanning) return;
    setActiveSegmentFrom(from);
    setActiveSegmentTo(to);
    setActiveSegment(segmentsByKey.get(buildSegmentKey(from, to)) ?? null);
    setPrefillSegmentRouteOnOpen(Boolean(options?.prefillRoute));
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
    setPrefillSegmentRouteOnOpen(false);
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
  const plannedSummary = formatDurationSummary(ganttCoverage.plannedMinutes);
  const unplannedSummary = formatDurationSummary(ganttCoverage.unplannedMinutes);
  const ganttSummary = formatMessage(t("trips.dayView.ganttSummary"), {
    planned: plannedSummary,
    unplanned: unplannedSummary,
  });
  const isFullyPlanned = ganttCoverage.unplannedMinutes <= 0;
  const dayHasTimelineContent = Boolean(previousStay || currentStay || planItems.length > 0);
  const previousStayRange = previousStay
    ? `00:00 - ${resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime)}`
    : null;
  const currentStayRange = currentStay
    ? `${resolveStayTime(currentStay.checkInTime, defaultCheckInTime)} - 24:00`
    : null;
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
  const renderTravelSegment = (from: SegmentItem, to: SegmentItem) => {
    const segment = segmentsByKey.get(buildSegmentKey(from, to)) ?? null;
    const travelTimeRange = segment ? buildTravelTimeRange(from.endTime, segment.durationMinutes) : null;
    return (
      <Box
        key={`segment-${from.id}-${to.id}`}
        data-testid="travel-segment"
        data-from-id={from.id}
        data-to-id={to.id}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.25,
          color: "text.secondary",
        }}
      >
        <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
          {travelTimeRange ? (
            <Chip
              label={travelTimeRange}
              size="small"
              sx={{
                bgcolor: "#1b3d73",
                color: "#ffffff",
                borderColor: "#1b3d73",
              }}
            />
          ) : null}
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {travelSegmentLabel(segment)}
          </Typography>
        </Box>
        {!canEditPlanning ? null : (
          <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
            {hasUsableSegmentLocation(from) && hasUsableSegmentLocation(to) ? (
              <Button
                size="small"
                variant="text"
                onClick={() => handleOpenTravelSegment(from, to, { prefillRoute: true })}
              >
                {segment
                  ? t("trips.travelSegment.refreshGoogleMapsRoute")
                  : t("trips.travelSegment.calculateGoogleMapsRoute")}
              </Button>
            ) : null}
            {segment ? (
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
        planItems: planItems.map((item) => ({
          id: item.id,
          title: item.title,
          contentJson: item.contentJson,
          location: item.location,
        })),
        currentStay: currentStay ? { id: currentStay.id, name: currentStay.name, location: currentStay.location } : null,
        getPlanItemFallbackLabel: (index) => formatMessage(t("trips.dayView.budgetItemPlan"), { index }),
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
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="40%" height={34} />
          <Skeleton variant="text" width="30%" height={22} />
          <Divider />
          <Skeleton variant="rectangular" height={220} />
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
          <Button component={Link} href={`/trips/${tripId}`} variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.dayView.back")}
          </Button>
        </Box>
      </Paper>
    );
  }

  const dayTitle =
    day && day.note && day.note.trim().length > 0
      ? formatMessage(t("trips.dayView.titleWithNote"), { index: day.dayIndex, note: day.note.trim() })
      : day
        ? formatMessage(t("trips.dayView.title"), { index: day.dayIndex })
        : "";

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={2}
      data-testid="trip-day-view-page"
      sx={{
        backgroundColor: "#2f343d",
        borderRadius: 3,
        p: { xs: 1.5, md: 2 },
      }}
    >
      {error && <Alert severity="error">{error}</Alert>}

      {detail && day && (
        <>
          <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
            <Box display="flex" flexDirection={{ xs: "column", sm: "row" }} alignItems="stretch" gap={2}>
              <Box display="flex" flexDirection="column" gap={2} flex={1}>
                <Button component={Link} href={`/trips/${tripId}`} variant="text" sx={{ alignSelf: "flex-start" }}>
                  {t("trips.dayView.back")}
                </Button>
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
                </Box>
                <Box display="flex" flexDirection="column" gap={0.5}>
                  <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                    <Typography variant="h5" fontWeight={700}>
                      {dayTitle}
                    </Typography>
                    {isOwner ? (
                      <IconButton
                        size="small"
                        aria-label={t("trips.dayImage.editAction")}
                        title={t("trips.dayImage.editAction")}
                        onClick={() => setDayMetaOpen(true)}
                      >
                        <SvgIcon fontSize="inherit">
                          <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                        </SvgIcon>
                      </IconButton>
                    ) : null}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {formatDate(day.date)}
                  </Typography>
                  <Box pt={0.5} pr={{ xs: 0, sm: 2 }}>
                    <TripDayGanttBar segments={ganttSegments} ariaLabel={t("trips.dayView.ganttAriaLabel")} />
                  </Box>
                  <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography variant="caption" color="text.secondary" aria-live="polite">
                      {ganttSummary}
                    </Typography>
                    {isFullyPlanned ? (
                      <Chip size="small" color="success" label={t("trips.dayView.ganttFullyPlanned")} />
                    ) : null}
                  </Box>
                  <TripFeedbackPanel
                    tripId={tripId}
                    feedback={day.feedback}
                    targetType="tripDay"
                    targetId={day.id}
                    currentUserId={detail?.trip.currentUserId}
                    contextLabel={buildFeedbackContextLabel(
                      day.note && day.note.trim().length > 0
                        ? formatMessage(t("trips.dayView.titleWithNote"), { index: day.dayIndex, note: day.note.trim() })
                        : formatMessage(t("trips.dayView.title"), { index: day.dayIndex }),
                    )}
                    onUpdated={(feedback) => {
                      setDay((current) => (current ? { ...current, feedback } : current));
                      setDetail((current) =>
                        current
                          ? {
                              ...current,
                              days: current.days.map((entry) => (entry.id === day.id ? { ...entry, feedback } : entry)),
                            }
                          : current,
                      );
                    }}
                  />
                </Box>
              </Box>
              {hasDayImage && (
                <Box
                  component="img"
                  src={resolveDayImageSrc(day.imageUrl, day.updatedAt) ?? undefined}
                  alt={t("trips.dayImage.previewAlt")}
                  sx={{
                    width: { xs: "100%", sm: 320 },
                    height: { xs: "auto", sm: 220 },
                    objectFit: "cover",
                    borderRadius: 1.5,
                    border: "1px solid",
                    borderColor: "divider",
                    flexShrink: 0,
                    alignSelf: { xs: "stretch", sm: "flex-start" },
                  }}
                />
              )}
            </Box>
          </Paper>

          <Box display="flex" flexDirection={{ xs: "column", lg: "row" }} gap={2}>
            <Paper elevation={0} sx={{ flex: 2, p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                <Typography variant="subtitle1" fontWeight={600}>
                  {t("trips.dayView.timelineTitle")}
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
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
              <Divider sx={{ my: 1.5 }} />
              {!dayHasTimelineContent && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                  {t("trips.dayView.timelineEmpty")}
                </Typography>
              )}

              <Box display="flex" flexDirection="column" gap={1.25}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    borderRadius: 1.5,
                    border: "1px solid",
                    borderColor: "#aeb7c6",
                    bgcolor: "#cfd6e2",
                    color: "#1f2a2e",
                  }}
                >
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                    <Typography variant="body1" fontWeight={600}>
                      {t("trips.dayView.previousNightTitle")}
                    </Typography>
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
                        {previousStayRange ? (
                          <Chip
                            label={previousStayRange}
                            size="small"
                            sx={{
                              bgcolor: "#1b3d73",
                              color: "#ffffff",
                              borderColor: "#1b3d73",
                            }}
                          />
                        ) : null}
                        <Typography variant="body2">{previousStay.name}</Typography>
                        <Chip
                          label={previousStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                          size="small"
                          color={previousStay.status === "booked" ? "success" : "default"}
                          variant="outlined"
                        />
                      </Box>
                      <MiniImageStrip
                        images={previousAccommodationImages}
                        altPrefix={previousStay.name}
                        onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                      />
                      <TripFeedbackPanel
                        tripId={tripId}
                        feedback={previousStay.feedback}
                        targetType="accommodation"
                        targetId={previousStay.id}
                        currentUserId={detail?.trip.currentUserId}
                        contextLabel={buildFeedbackContextLabel(
                          `${t("trips.dayView.previousNightTitle")}: ${previousStay.name}`,
                        )}
                        tripDayId={previousDay?.id}
                        onUpdated={(feedback) =>
                          setDetail((current) =>
                            current
                              ? {
                                  ...current,
                                  days: current.days.map((entry) =>
                                    entry.id === previousDay?.id && entry.accommodation
                                      ? { ...entry, accommodation: { ...entry.accommodation, feedback } }
                                      : entry,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: "rgba(31, 42, 46, 0.72)" }}>
                      {t("trips.dayView.previousNightEmpty")}
                    </Typography>
                  )}
                </Paper>

                {previousStaySegment && previousSegmentTarget ? (
                  <Box mt={-0.25}>{renderTravelSegment(previousStaySegment, previousSegmentTarget)}</Box>
                ) : null}

                {planItems.length === 0 ? (
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      border: "1px solid",
                      borderColor: "#c6ced9",
                      backgroundColor: "#e8ecf2",
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {t("trips.dayView.activitiesEmpty")}
                    </Typography>
                  </Paper>
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
                      <Box key={item.id} display="flex" flexDirection="column" gap={0.75}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 1.5,
                            borderRadius: 1.5,
                            border: "1px solid",
                            borderColor: "#c6ced9",
                            backgroundColor: "#e8ecf2",
                          }}
                        >
                          <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
                            <Box display="flex" flexDirection="column" gap={0.75}>
                              <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
                                {item.fromTime && item.toTime ? (
                                  <Chip
                                    label={`${item.fromTime} - ${item.toTime}`}
                                    size="small"
                                    sx={{
                                      bgcolor: "#1b3d73",
                                      color: "#ffffff",
                                      borderColor: "#1b3d73",
                                    }}
                                  />
                                ) : null}
                                <Typography variant="body2" fontWeight={700}>
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
                              <MiniImageStrip
                                images={planItemImagesById[item.id] ?? []}
                                altPrefix={t("trips.dayView.timelineTitle")}
                                onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                              />
                              <TripFeedbackPanel
                                tripId={tripId}
                                feedback={item.feedback}
                                targetType="dayPlanItem"
                                targetId={item.id}
                                currentUserId={detail?.trip.currentUserId}
                                contextLabel={buildFeedbackContextLabel(title)}
                                tripDayId={day.id}
                                onUpdated={(feedback) => {
                                  setPlanItems((current) =>
                                    current.map((entry) => (entry.id === item.id ? { ...entry, feedback } : entry)),
                                  );
                                  setDay((current) =>
                                    current
                                      ? {
                                          ...current,
                                          dayPlanItems: current.dayPlanItems.map((entry) =>
                                            entry.id === item.id ? { ...entry, feedback } : entry,
                                          ),
                                        }
                                      : current,
                                  );
                                  setDetail((current) =>
                                    current
                                      ? {
                                          ...current,
                                          days: current.days.map((entry) =>
                                            entry.id === day.id
                                              ? {
                                                  ...entry,
                                                  dayPlanItems: entry.dayPlanItems.map((planItem) =>
                                                    planItem.id === item.id ? { ...planItem, feedback } : planItem,
                                                  ),
                                                }
                                              : entry,
                                          ),
                                        }
                                      : current,
                                  );
                                }}
                              />
                            </Box>
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
                        </Paper>
                        {nextSegmentItem ? renderTravelSegment(segmentItem, nextSegmentItem) : null}
                      </Box>
                    );
                  })
                )}

                <Paper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    borderRadius: 1.5,
                    border: "1px solid",
                    borderColor: "#aeb7c6",
                    bgcolor: "#cfd6e2",
                    color: "#1f2a2e",
                  }}
                >
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                    <Typography variant="body1" fontWeight={600}>
                      {t("trips.dayView.currentNightTitle")}
                    </Typography>
                    {canCopyPreviousStay && canEditPlanning ? (
                      <Button size="small" variant="text" disabled={copyingStay} onClick={() => void handleCopyPreviousStay()}>
                        {t("trips.stay.copyPreviousAction")}
                      </Button>
                    ) : null}
                  </Box>
                  {currentStay ? (
                    <Box display="flex" flexDirection="column" gap={0.75}>
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        {currentStayRange ? (
                          <Chip
                            label={currentStayRange}
                            size="small"
                            sx={{
                              bgcolor: "#1b3d73",
                              color: "#ffffff",
                              borderColor: "#1b3d73",
                            }}
                          />
                        ) : null}
                        <Typography variant="body2">{currentStay.name}</Typography>
                        <Chip
                          label={currentStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                          size="small"
                          color={currentStay.status === "booked" ? "success" : "default"}
                          variant="outlined"
                        />
                      </Box>
                      <MiniImageStrip
                        images={accommodationImages}
                        altPrefix={currentStay.name}
                        onImageClick={(imageUrl, alt) => setFullscreenImage({ imageUrl, alt })}
                      />
                      <TripFeedbackPanel
                        tripId={tripId}
                        feedback={currentStay.feedback}
                        targetType="accommodation"
                        targetId={currentStay.id}
                        currentUserId={detail?.trip.currentUserId}
                        contextLabel={buildFeedbackContextLabel(
                          `${t("trips.dayView.currentNightTitle")}: ${currentStay.name}`,
                        )}
                        tripDayId={day.id}
                        onUpdated={(feedback) => {
                          setDay((current) =>
                            current && current.accommodation
                              ? { ...current, accommodation: { ...current.accommodation, feedback } }
                              : current,
                          );
                          setDetail((current) =>
                            current
                              ? {
                                  ...current,
                                  days: current.days.map((entry) =>
                                    entry.id === day.id && entry.accommodation
                                      ? { ...entry, accommodation: { ...entry.accommodation, feedback } }
                                      : entry,
                                  ),
                                }
                              : current,
                          );
                        }}
                      />
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: "rgba(31, 42, 46, 0.72)" }}>
                      {t("trips.dayView.currentNightEmpty")}
                    </Typography>
                  )}
                </Paper>
              </Box>
            </Paper>

            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {t("trips.dayView.summaryTitle")}
                </Typography>
                <Box display="flex" justifyContent="space-between" alignItems="center" mt={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    {t("trips.dayView.budgetTotal")}
                  </Typography>
                  <Typography variant="body1" fontWeight={700}>
                    {formatMessage(t("trips.stay.costSummary"), { amount: formatCost(dayTotalCents) })}
                  </Typography>
                </Box>
                <Divider sx={{ my: 1.5 }} />

                {knownBudgetEntries.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t("trips.dayView.budgetEmpty")}
                  </Typography>
                )}

                {knownBudgetEntries.length > 0 && (
                  <List dense sx={{ p: 0 }}>
                    {knownBudgetEntries.map((entry) => (
                      <ListItem key={entry.id} sx={{ px: 0, py: 0.5 }}>
                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) auto",
                            alignItems: "center",
                            columnGap: 1.5,
                            width: "100%",
                          }}
                        >
                          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                            {entry.label}
                          </Typography>
                          <Typography variant="body2" textAlign="right">
                            {formatMessage(t("trips.stay.costSummary"), { amount: formatCost(entry.amountCents) })}
                          </Typography>
                        </Box>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>

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
            prefillRouteOnOpen={prefillSegmentRouteOnOpen}
            onClose={() => {
              setPrefillSegmentRouteOnOpen(false);
              setSegmentDialogOpen(false);
              setActiveSegment(null);
              setActiveSegmentFrom(null);
              setActiveSegmentTo(null);
            }}
            onSaved={(segment) => {
              handleTravelSegmentSaved(segment);
              setPrefillSegmentRouteOnOpen(false);
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
          <Dialog open={dayMetaOpen} onClose={() => setDayMetaOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{t("trips.dayImage.dialogTitle")}</DialogTitle>
            <DialogContent>
              <Box mt={0.5} display="flex" flexDirection="column" gap={1.5}>
                <Typography variant="body2" fontWeight={600}>
                  {t("trips.dayImage.fileLabel")}
                </Typography>
                <TextField
                  size="small"
                  type="file"
                  onChange={(event) => {
                    const input = event.currentTarget as HTMLInputElement;
                    const file = input.files?.[0] ?? null;
                    setDayImageFile(file);
                  }}
                  fullWidth
                  inputProps={{
                    accept: "image/jpeg,image/jpg,image/pjpeg,image/png,image/webp",
                    "aria-label": t("trips.dayImage.fileLabel"),
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {t("trips.dayImage.fileHelper")}
                </Typography>
                {dayImageFile && (
                  <Typography variant="body2" color="text.secondary">
                    {dayImageFile.name}
                  </Typography>
                )}
                <TextField
                  size="small"
                  value={dayNoteDraft}
                  onChange={(event) => setDayNoteDraft(event.target.value)}
                  label={t("trips.dayImage.noteLabel")}
                  helperText={t("trips.dayImage.noteHelper")}
                  fullWidth
                  multiline
                  minRows={2}
                  inputProps={{ maxLength: 280 }}
                />
                {!hasDayImage && (
                  <Typography variant="body2" color="text.secondary">
                    {t("trips.dayImage.empty")}
                  </Typography>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDayMetaOpen(false)} color="inherit">
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void handleRemoveDayImage()} color="inherit" disabled={dayImageSaving || !hasDayImage}>
                {t("trips.dayImage.removeAction")}
              </Button>
              <Button onClick={() => void handleSaveDayImage()} variant="contained" disabled={dayImageSaving}>
                {t("trips.dayImage.saveAction")}
              </Button>
            </DialogActions>
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
