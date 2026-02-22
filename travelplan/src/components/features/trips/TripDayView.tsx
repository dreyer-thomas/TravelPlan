"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import TripDayMapPanel, { buildDayMapPanelData } from "@/components/features/trips/TripDayMapPanel";
import TripDayPlanDialog from "@/components/features/trips/TripDayPlanDialog";
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
  imageUrl?: string | null;
  note?: string | null;
  plannedCostSubtotal: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
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
    fromTime: string | null;
    toTime: string | null;
    contentJson: string;
    costCents: number | null;
    linkUrl: string | null;
    location: { lat: number; lng: number; label?: string | null } | null;
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
  linkUrl: string | null;
  location: { lat: number; lng: number; label?: string | null } | null;
  createdAt: string;
};

type GalleryImage = {
  id: string;
  dayPlanItemId?: string;
  imageUrl: string;
  sortOrder: number;
};

type PlanDialogMode = "add" | "edit";

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

const parsePlanText = (value: string) => {
  try {
    const doc = JSON.parse(value);
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc as { text?: string; content?: unknown[] });
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};

type RichDocNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: { href?: string } }>;
  attrs?: { src?: string; alt?: string };
  content?: RichDocNode[];
};

const isSafeLink = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
};

const parseRichDoc = (value: string): RichDocNode | null => {
  try {
    const parsed = JSON.parse(value) as RichDocNode;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
};

const applyMarks = (text: string, marks: RichDocNode["marks"]): ReactNode => {
  return (marks ?? []).reduce<ReactNode>((acc, mark, index) => {
    if (mark?.type === "italic") return <em key={`mark-italic-${index}`}>{acc}</em>;
    if (mark?.type === "bold") return <strong key={`mark-bold-${index}`}>{acc}</strong>;
    if (mark?.type === "strike") return <s key={`mark-strike-${index}`}>{acc}</s>;
    if (mark?.type === "code") return <code key={`mark-code-${index}`}>{acc}</code>;
    if (mark?.type === "link" && mark.attrs?.href && isSafeLink(mark.attrs.href)) {
      return (
        <a key={`mark-link-${index}`} href={mark.attrs.href} target="_blank" rel="noreferrer noopener">
          {acc}
        </a>
      );
    }
    return acc;
  }, text);
};

const renderRichNode = (node: RichDocNode, key: string, imageAltFallback: string): ReactNode => {
  const children = Array.isArray(node.content)
    ? node.content.map((child, index) => renderRichNode(child, `${key}-${index}`, imageAltFallback)).filter(Boolean)
    : [];

  if (node.type === "doc") return <Box key={key}>{children}</Box>;
  if (node.type === "paragraph") {
    return (
      <Typography key={key} variant="body2" component="p" sx={{ m: 0, whiteSpace: "pre-wrap" }}>
        {children}
      </Typography>
    );
  }
  if (node.type === "bulletList") {
    return (
      <Box key={key} component="ul" sx={{ m: 0, pl: 2.5 }}>
        {children}
      </Box>
    );
  }
  if (node.type === "orderedList") {
    return (
      <Box key={key} component="ol" sx={{ m: 0, pl: 2.5 }}>
        {children}
      </Box>
    );
  }
  if (node.type === "listItem") return <Box key={key} component="li">{children}</Box>;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "image" && typeof node.attrs?.src === "string" && isSafeLink(node.attrs.src)) {
    return (
      <Box
        key={key}
        component="img"
        src={node.attrs.src}
        alt={typeof node.attrs.alt === "string" && node.attrs.alt.trim() ? node.attrs.alt : imageAltFallback}
        data-testid="day-plan-inline-image"
        sx={{
          display: "block",
          maxWidth: "100%",
          width: "100%",
          height: "auto",
          maxHeight: 240,
          objectFit: "contain",
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          my: 0.75,
        }}
      />
    );
  }
  if (node.type === "text" && typeof node.text === "string") return <span key={key}>{applyMarks(node.text, node.marks)}</span>;
  if (children.length > 0) return <Box key={key}>{children}</Box>;
  return null;
};

const PlanItemRichContent = ({ contentJson, fallbackText }: { contentJson: string; fallbackText: string }) => {
  const { t } = useI18n();
  const doc = parseRichDoc(contentJson);
  if (!doc) {
    return <Typography variant="body2">{fallbackText}</Typography>;
  }

  const rendered = renderRichNode(doc, "root", t("trips.plan.inlineImageAlt"));
  if (!rendered) {
    return <Typography variant="body2">{fallbackText}</Typography>;
  }

  return <Box display="flex" flexDirection="column" gap={0.75}>{rendered}</Box>;
};

const getMapLocation = (value: { lat: number; lng: number } | null | undefined) => {
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

const MiniImageStrip = ({
  images,
  altPrefix,
  onImageClick,
}: {
  images: GalleryImage[];
  altPrefix: string;
  onImageClick: (imageUrl: string, alt: string) => void;
}) => {
  if (images.length === 0) {
    return null;
  }

  const visible = images.slice(0, 3);
  const remaining = images.length - visible.length;

  return (
    <Box display="flex" alignItems="center" gap={0.75} mt={0.75}>
      {visible.map((image, index) => (
        <Box
          key={image.id}
          component="img"
          src={image.imageUrl}
          alt={`${altPrefix} ${index + 1}`}
          sx={{
            width: 96,
            height: 96,
            objectFit: "cover",
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider",
            cursor: "pointer",
          }}
          loading="lazy"
          onClick={() => onImageClick(image.imageUrl, `${altPrefix} ${index + 1}`)}
        />
      ))}
      {remaining > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          +{remaining}
        </Typography>
      ) : null}
    </Box>
  );
};

export default function TripDayView({ tripId, dayId }: TripDayViewProps) {
  const { language, t } = useI18n();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [day, setDay] = useState<TripDay | null>(null);
  const [planItems, setPlanItems] = useState<DayPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [previousStayOpen, setPreviousStayOpen] = useState(false);
  const [planDialogMode, setPlanDialogMode] = useState<PlanDialogMode | null>(null);
  const [selectedPlanItem, setSelectedPlanItem] = useState<DayPlanItem | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [dayMetaOpen, setDayMetaOpen] = useState(false);
  const [dayImageFile, setDayImageFile] = useState<File | null>(null);
  const [dayNoteDraft, setDayNoteDraft] = useState("");
  const [dayImageSaving, setDayImageSaving] = useState(false);
  const [accommodationImages, setAccommodationImages] = useState<GalleryImage[]>([]);
  const [previousAccommodationImages, setPreviousAccommodationImages] = useState<GalleryImage[]>([]);
  const [planItemImagesById, setPlanItemImagesById] = useState<Record<string, GalleryImage[]>>({});
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [routingUnavailable, setRoutingUnavailable] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ imageUrl: string; alt: string } | null>(null);
  const planItemsRef = useRef<DayPlanItem[]>([]);
  const handledDeepLinkRef = useRef<string | null>(null);
  const defaultCheckInTime = "16:00";
  const defaultCheckOutTime = "10:00";

  useEffect(() => {
    planItemsRef.current = planItems;
  }, [planItems]);

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

  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
  );

  const resolveApiError = useCallback(
    (code?: string) => {
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
          return t("trips.dayView.loadError");
      }
    },
    [t],
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
        return;
      }

      if (!detailResponse.ok || detailBody.error || !detailBody.data) {
        setError(resolveApiError(detailBody.error?.code));
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        return;
      }

      const resolvedDay = detailBody.data.days.find((item) => item.id === dayId) ?? null;
      if (!resolvedDay) {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        setPlanItems([]);
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
    } catch {
      setError(t("trips.dayView.loadError"));
      setDetail(null);
      setDay(null);
      setPlanItems([]);
    } finally {
      setLoading(false);
    }
  }, [dayId, resolveApiError, t, tripId]);

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

  const handleOpenAddPlan = () => {
    setSelectedPlanItem(null);
    setPlanDialogMode("add");
  };

  const handleOpenEditPlan = (item: DayPlanItem) => {
    setSelectedPlanItem(item);
    setPlanDialogMode("edit");
  };

  const handleDeletePlan = useCallback(
    async (itemId: string) => {
      if (!day) return;

      const confirmed = window.confirm(t("trips.plan.deleteConfirm"));
      if (!confirmed) return;

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
        }
      } catch {
        if (removedItem) {
          setPlanItems((current) => {
            if (current.some((item) => item.id === removedItem.id)) return current;
            const insertAt = Math.min(Math.max(removedIndex, 0), current.length);
            return [...current.slice(0, insertAt), removedItem, ...current.slice(insertAt)];
          });
        }
        setError(resolveApiError("network_error"));
      }
    },
    [day, ensureCsrfToken, resolveApiError, t, tripId],
  );

  useEffect(() => {
    loadDay();
  }, [loadDay]);

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
      setStayOpen(true);
      handledDeepLinkRef.current = key;
      return;
    }

    if (openTarget === "plan") {
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
  }, [day, loading, planItems, searchParams]);

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

  const previousStay = previousDay?.accommodation ?? null;
  const currentStay = day?.accommodation ?? null;
  const dayHasTimelineContent = Boolean(previousStay || currentStay || planItems.length > 0);
  const resolveStayTime = (value: string | null | undefined, fallback: string) =>
    value && value.trim() ? value : fallback;
  const previousStayRange = previousStay
    ? `00:00 - ${resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime)}`
    : null;
  const currentStayRange = currentStay
    ? `${resolveStayTime(currentStay.checkInTime, defaultCheckInTime)} - 24:00`
    : null;
  const hasDayImage = Boolean(day?.imageUrl && day.imageUrl.trim().length > 0);

  const updateLocalDayMeta = useCallback(
    (payload: { imageUrl: string | null; note: string | null }) => {
      if (!day) return;

      setDay((current) => (current ? { ...current, imageUrl: payload.imageUrl, note: payload.note } : current));
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          days: current.days.map((entry) =>
            entry.id === day.id ? { ...entry, imageUrl: payload.imageUrl, note: payload.note } : entry,
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
          day: { id: string; imageUrl: string | null; note: string | null };
        }>;
        if (!uploadResponse.ok || uploadBody.error || !uploadBody.data?.day) {
          setError(
            uploadBody.error?.message
              ? `${t("trips.dayImage.uploadError")} (${uploadBody.error.message})`
              : t("trips.dayImage.uploadError"),
          );
          return;
        }
        updateLocalDayMeta({ imageUrl: uploadBody.data.day.imageUrl, note: uploadBody.data.day.note });
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

      const body = (await response.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null; note: string | null } }>;
      if (!response.ok || body.error || !body.data?.day) {
        setError(body.error?.message ? `${t("trips.dayImage.saveError")} (${body.error.message})` : t("trips.dayImage.saveError"));
        return;
      }

      updateLocalDayMeta({ imageUrl: body.data.day.imageUrl, note: body.data.day.note });
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

      const body = (await response.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null; note: string | null } }>;
      if (!response.ok || body.error || !body.data?.day) {
        setError(body.error?.message ? `${t("trips.dayImage.saveError")} (${body.error.message})` : t("trips.dayImage.saveError"));
        return;
      }

      updateLocalDayMeta({ imageUrl: null, note: body.data.day.note });
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

    if (previousStay) {
      entries.push({
        id: `previous-stay-${previousStay.id}`,
        label: formatMessage(t("trips.dayView.budgetItemPreviousNight"), { name: previousStay.name }),
        amountCents: previousStay.costCents,
      });
    }

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
  }, [currentStay, planItems, previousStay, t]);

  const knownBudgetEntries = useMemo(
    () =>
      budgetEntries.filter(
        (entry): entry is { id: string; label: string; amountCents: number } => entry.amountCents !== null,
      ),
    [budgetEntries],
  );
  const dayTotalCents = knownBudgetEntries.reduce((sum, entry) => sum + entry.amountCents, 0);

  const mapData = useMemo(
    () =>
      buildDayMapPanelData({
        previousStay: previousStay
          ? {
              id: previousStay.id,
              label: previousStay.name,
              kind: "previousStay",
              location: getMapLocation(previousStay.location),
            }
          : null,
        planItems: planItems.map((item, index) => ({
          id: item.id,
          label:
            item.title?.trim() ||
            parsePlanText(item.contentJson) ||
            formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 }),
          kind: "planItem" as const,
          location: getMapLocation(item.location),
        })),
        currentStay: currentStay
          ? {
              id: currentStay.id,
              label: currentStay.name,
              kind: "currentStay",
              location: getMapLocation(currentStay.location),
            }
          : null,
      }),
    [currentStay, planItems, previousStay, t],
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
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {formatDate(day.date)}
                  </Typography>
                </Box>
              </Box>
              {hasDayImage && (
                <Box
                  component="img"
                  src={day.imageUrl ?? undefined}
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
                  <Button size="small" variant="outlined" onClick={() => setStayOpen(true)}>
                    {day.accommodation ? t("trips.stay.editAction") : t("trips.stay.addAction")}
                  </Button>
                  <Button size="small" variant="outlined" onClick={handleOpenAddPlan}>
                    {t("trips.plan.addPrimaryAction")}
                  </Button>
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
                    {previousDay ? (
                      <Button size="small" variant="text" onClick={() => setPreviousStayOpen(true)}>
                        {previousStay ? t("trips.stay.editAction") : t("trips.stay.addAction")}
                      </Button>
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
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: "rgba(31, 42, 46, 0.72)" }}>
                      {t("trips.dayView.previousNightEmpty")}
                    </Typography>
                  )}
                </Paper>

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
                    return (
                      <Paper
                        key={item.id}
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
                          </Box>
                          <Box display="flex" alignItems="center" gap={0.5}>
                            <IconButton
                              size="small"
                              aria-label={t("trips.plan.editItemAria")}
                              title={t("trips.plan.editItemAria")}
                              onClick={() => handleOpenEditPlan(item)}
                            >
                              <SvgIcon fontSize="inherit">
                                <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                              </SvgIcon>
                            </IconButton>
                            <IconButton
                              size="small"
                              aria-label={t("trips.plan.deleteItemAria")}
                              title={t("trips.plan.deleteItemAria")}
                              onClick={() => void handleDeletePlan(item.id)}
                            >
                              <SvgIcon fontSize="inherit">
                                <path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1z" />
                              </SvgIcon>
                            </IconButton>
                          </Box>
                        </Box>
                      </Paper>
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
                  <Typography variant="body1" fontWeight={600} gutterBottom>
                    {t("trips.dayView.currentNightTitle")}
                  </Typography>
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
              />
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
          <TripDayPlanDialog
            open={planDialogMode !== null}
            mode={planDialogMode ?? "add"}
            tripId={tripId}
            day={day}
            item={selectedPlanItem}
            onClose={() => {
              setPlanDialogMode(null);
              setSelectedPlanItem(null);
            }}
            onSaved={() => {
              setPlanDialogMode(null);
              setSelectedPlanItem(null);
              loadDay();
            }}
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
        </>
      )}
    </Box>
  );
}
