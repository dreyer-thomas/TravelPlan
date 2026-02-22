"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  Paper,
  Skeleton,
  SvgIcon,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TripDeleteDialog from "@/components/features/trips/TripDeleteDialog";
import TripEditDialog, { type TripDetail as EditableTripDetail } from "@/components/features/trips/TripEditDialog";
import TripImportDialog from "@/components/features/trips/TripImportDialog";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
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
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    contentJson: string;
    linkUrl: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  }[];
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripTimelineProps = {
  tripId: string;
};

export default function TripTimeline({ tripId }: TripTimelineProps) {
  const { language, t } = useI18n();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const router = useRouter();

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
  const buildDateRange = useCallback(
    (trip: TripSummary) => `${formatDate(trip.startDate)} - ${formatDate(trip.endDate)}`,
    [formatDate],
  );
  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
  );

  const loadTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/trips/${tripId}`, { method: "GET", credentials: "include", cache: "no-store" });
      const body = (await response.json()) as ApiEnvelope<TripDetail>;

      if (response.status === 404 || body.error?.code === "not_found") {
        setNotFound(true);
        setDetail(null);
        return;
      }

      if (!response.ok || body.error || !body.data) {
        const resolveApiError = (code?: string) => {
          switch (code) {
            case "unauthorized":
              return t("errors.unauthorized");
            case "csrf_invalid":
              return t("errors.csrfInvalid");
            case "server_error":
              return t("errors.server");
            case "invalid_json":
              return t("errors.invalidJson");
            default:
              return t("trips.detail.loadError");
          }
        };

        setError(resolveApiError(body.error?.code));
        setDetail(null);
        return;
      }

      setDetail(body.data);
    } catch {
      setError(t("trips.detail.loadError"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [tripId, t]);

  useEffect(() => {
    loadTrip();
  }, [loadTrip]);

  const listEmpty = useMemo(() => !loading && !!detail && detail.days.length === 0, [loading, detail]);

  const parsePlanText = useCallback((value: string) => {
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
  }, []);

  const overviewMapData = useMemo(() => {
    const points: { id: string; label: string; position: [number, number] }[] = [];
    const missingLocations: { id: string; label: string; href: string }[] = [];

    if (!detail) {
      return { points, missingLocations };
    }

    detail.days.forEach((day) => {
      if (day.accommodation) {
        const label =
          day.accommodation.location?.label?.trim() ||
          day.accommodation.name.trim() ||
          formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex });
        if (day.accommodation.location) {
          points.push({
            id: `day-${day.id}-accommodation`,
            label,
            position: [day.accommodation.location.lat, day.accommodation.location.lng],
          });
        } else {
          missingLocations.push({
            id: `day-${day.id}-accommodation`,
            label,
            href: `/trips/${tripId}/days/${day.id}?open=stay`,
          });
        }
      }

      day.dayPlanItems.forEach((item, itemIndex) => {
        const label =
          item.location?.label?.trim() ||
          parsePlanText(item.contentJson) ||
          formatMessage(t("trips.plan.previewFallback"), { index: itemIndex + 1 });
        if (item.location) {
          points.push({
            id: item.id,
            label,
            position: [item.location.lat, item.location.lng],
          });
        } else {
          missingLocations.push({
            id: item.id,
            label,
            href: `/trips/${tripId}/days/${day.id}?open=plan&itemId=${item.id}`,
          });
        }
      });
    });

    return { points, missingLocations };
  }, [detail, parsePlanText, t, tripId]);

  if (loading) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="50%" height={34} />
          <Skeleton variant="text" width="35%" height={24} />
          <Divider />
          <Box display="flex" flexDirection="column" gap={1.5}>
            <Skeleton variant="text" width="60%" height={22} />
            <Skeleton variant="text" width="55%" height={22} />
            <Skeleton variant="text" width="50%" height={22} />
          </Box>
        </Box>
      </Paper>
    );
  }

  if (notFound) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="h6" fontWeight={600}>
            {t("trips.detail.notFoundTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.detail.notFoundBody")}
          </Typography>
          <Button component={Link} href="/trips" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.detail.back")}
          </Button>
        </Box>
      </Paper>
    );
  }

  const handleEditClose = () => {
    setEditOpen(false);
  };

  const handleDeleteClose = () => {
    setDeleteOpen(false);
  };

  const handleUpdated = (updated: EditableTripDetail) => {
    setDetail(updated as TripDetail);
    setEditOpen(false);
  };

  const handleDeleted = () => {
    setDeleteOpen(false);
    router.push("/trips");
  };

  const handleImported = async () => {
    await loadTrip();
    setSuccess(t("trips.import.success"));
    setImportOpen(false);
  };

  const extractAttachmentFilename = (headerValue: string | null) => {
    if (!headerValue) return null;
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const simpleMatch = /filename="?([^";]+)"?/i.exec(headerValue);
    return simpleMatch?.[1] ?? null;
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const handleExport = async () => {
    setError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/export`, { method: "GET" });
      if (!response.ok) {
        setError(t("trips.export.error"));
        return;
      }

      const filename = extractAttachmentFilename(response.headers.get("content-disposition")) ?? `trip-${tripId}.json`;
      const blob = await response.blob();
      triggerDownload(blob, filename);
    } catch {
      setError(t("trips.export.error"));
    }
  };

  const renderAccommodationStatus = (status: "planned" | "booked") => {
    if (status === "booked") {
      return (
        <Box display="inline-flex" alignItems="center" gap={0.5}>
          <SvgIcon sx={{ fontSize: 16 }} viewBox="0 0 24 24">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </SvgIcon>
          <Box component="span">{t("trips.stay.statusBooked").toLowerCase()}</Box>
        </Box>
      );
    }

    return t("trips.stay.statusPlanned");
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={2}
      sx={{
        backgroundColor: "#2f343d",
        borderRadius: 3,
        p: { xs: 1.5, md: 2 },
      }}
    >
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}

      {detail && (
        <>
          <Paper
            elevation={1}
            sx={{
              p: 3,
              borderRadius: 3,
              background: "#ffffff",
              boxShadow: "0 22px 40px rgba(17, 18, 20, 0.1)",
              border: "1px solid rgba(17, 18, 20, 0.08)",
            }}
          >
            <Box display="flex" flexDirection="column" gap={2}>
              <Box
                sx={{
                  width: "100%",
                  height: { xs: 220, sm: 260 },
                  borderRadius: 3,
                  overflow: "hidden",
                  position: "relative",
                  backgroundColor: "rgba(0, 0, 0, 0.04)",
                }}
              >
                <Box
                  component="img"
                  src={detail.trip.heroImageUrl ?? "/images/world-map-placeholder.svg"}
                  alt={detail.trip.name}
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.6) 100%)",
                  }}
                />
                <Box sx={{ position: "absolute", left: 24, right: 24, bottom: 20 }}>
                  <Typography variant="h4" fontWeight={700} sx={{ color: "#fff" }}>
                    {detail.trip.name}
                  </Typography>
                </Box>
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    {buildDateRange(detail.trip)}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    {formatMessage(t("trips.dashboard.dayCount"), { count: detail.trip.dayCount })}
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {formatMessage(t("trips.stay.costSummary"), { amount: formatCost(detail.trip.plannedCostTotal) })}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Paper>

          <TripOverviewMapPanel points={overviewMapData.points} missingLocations={overviewMapData.missingLocations} />

          <Paper
            elevation={1}
            sx={{
              p: 3,
              borderRadius: 3,
              background: "#ffffff",
            }}
          >
            <Box display="flex" flexDirection="column" gap={2}>
              <Typography variant="h6" fontWeight={600}>
                {t("trips.timeline.title")}
              </Typography>
              <Divider />

              {listEmpty && (
                <Typography variant="body2" color="text.secondary">
                  {t("trips.timeline.empty")}
                </Typography>
              )}

              {!listEmpty && (
                <List disablePadding sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                  {detail.days.map((day) => (
                    <ListItem key={day.id} disablePadding>
                      <Paper
                        data-testid="timeline-day-card"
                        elevation={0}
                        sx={{
                          width: "100%",
                          backgroundColor: "#e8ecf2",
                          border: "1px solid",
                          borderColor: "#c6ced9",
                          borderRadius: 2,
                          p: { xs: 1.5, sm: 2 },
                        }}
                      >
                        <Box display="flex" gap={1.5} alignItems="flex-start">
                          <Box
                            component="img"
                            src={day.imageUrl && day.imageUrl.trim().length > 0 ? day.imageUrl : "/images/world-map-placeholder.svg"}
                            alt={t("trips.dayImage.previewAlt")}
                            sx={{
                              width: { xs: 108, sm: 132 },
                              height: { xs: 72, sm: 84 },
                              objectFit: "cover",
                              borderRadius: 1,
                              border: "1px solid",
                              borderColor: "divider",
                              flexShrink: 0,
                            }}
                          />

                          <Box display="flex" flexDirection="column" gap={1} flex={1} minWidth={0}>
                            <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1.5} flexWrap="wrap">
                              <Box display="flex" flexDirection="column" gap={0.5}>
                                <Typography variant="subtitle1" fontWeight={600}>
                                  {day.note && day.note.trim().length > 0
                                    ? `${formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}: ${day.note.trim()}`
                                    : formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {formatDate(day.date)}
                                </Typography>
                              </Box>
                              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                <IconButton
                                  component={Link}
                                  href={`/trips/${tripId}/days/${day.id}`}
                                  size="small"
                                  aria-label={t("trips.timeline.openDay")}
                                  title={t("trips.timeline.openDay")}
                                >
                                  <SvgIcon sx={{ fontSize: 18 }} viewBox="0 0 24 24">
                                    <path d="m3 17.25V21h3.75l11-11-3.75-3.75zm17.71-10.04a1 1 0 0 0 0-1.41l-2.5-2.5a1 1 0 0 0-1.41 0l-1.96 1.96 3.75 3.75z" />
                                  </SvgIcon>
                                </IconButton>
                                {(day.missingAccommodation || day.missingPlan) && (
                                  <>
                                    {day.missingAccommodation && (
                                      <Chip label={t("trips.timeline.missingStay")} size="small" color="warning" variant="outlined" />
                                    )}
                                    {day.missingPlan && (
                                      <Chip label={t("trips.timeline.missingPlan")} size="small" color="warning" variant="outlined" />
                                    )}
                                  </>
                                )}
                              </Box>
                            </Box>

                            {day.accommodation && (
                              <Box
                                data-testid="timeline-accommodation-surface"
                                sx={{
                                  backgroundColor: "transparent",
                                  borderRadius: 1.25,
                                  px: 0,
                                  py: 0,
                                  width: "fit-content",
                                }}
                              >
                                <Chip
                                  label={renderAccommodationStatus(day.accommodation.status)}
                                  size="small"
                                  variant="filled"
                                  clickable={Boolean(day.accommodation.link)}
                                  component={day.accommodation.link ? "a" : "div"}
                                  href={day.accommodation.link ?? undefined}
                                  target={day.accommodation.link ? "_blank" : undefined}
                                  rel={day.accommodation.link ? "noreferrer noopener" : undefined}
                                  sx={{
                                    bgcolor: day.accommodation.status === "booked" ? "#245c39" : "#5a6473",
                                    color: "#f8fafc",
                                    "& .MuiSvgIcon-root": { color: "#f8fafc" },
                                  }}
                                />
                              </Box>
                            )}
                          </Box>
                        </Box>
                      </Paper>
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          </Paper>

          <Paper
            elevation={1}
            sx={{
              p: 3,
              borderRadius: 3,
              background: "#ffffff",
            }}
          >
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Button variant="outlined" onClick={handleExport}>
                {t("trips.export.action")}
              </Button>
              <Button variant="outlined" onClick={() => setImportOpen(true)}>
                {t("trips.import.action")}
              </Button>
              <Button variant="outlined" onClick={() => setEditOpen(true)}>
                {t("trips.edit.open")}
              </Button>
              <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)}>
                {t("trips.delete.open")}
              </Button>
            </Box>
          </Paper>
        </>
      )}

      {detail && (
        <>
          <TripEditDialog open={editOpen} trip={detail.trip} onClose={handleEditClose} onUpdated={handleUpdated} />
          <TripDeleteDialog
            open={deleteOpen}
            tripId={detail.trip.id}
            tripName={detail.trip.name}
            onClose={handleDeleteClose}
            onDeleted={handleDeleted}
          />
          <TripImportDialog open={importOpen} tripId={detail.trip.id} onClose={() => setImportOpen(false)} onImported={handleImported} />
        </>
      )}
    </Box>
  );
}
