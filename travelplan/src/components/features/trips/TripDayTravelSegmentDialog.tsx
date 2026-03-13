"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type SegmentItem = {
  id: string;
  type: "accommodation" | "dayPlanItem";
  label: string;
  location: { lat: number; lng: number; label?: string | null } | null;
};

type TravelSegment = {
  id: string;
  tripDayId?: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: "car" | "ship" | "flight";
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
};

type RoutePreview = {
  polyline: [number, number][];
  distanceMeters: number | null;
  durationSeconds: number | null;
};

type TripDayTravelSegmentDialogProps = {
  open: boolean;
  tripId: string;
  tripDayId: string | null;
  fromItem: SegmentItem | null;
  toItem: SegmentItem | null;
  segment: TravelSegment | null;
  prefillRouteOnOpen?: boolean;
  onClose: () => void;
  onSaved: (segment: TravelSegment) => void;
};

const formatMinutesToTime = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const formatDistanceKmInput = (distanceMeters: number) => {
  const km = Math.round((distanceMeters / 1000) * 10) / 10;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
};

const parseTimeToMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const isSafeExternalUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const buildLocationParam = (location: SegmentItem["location"]) => {
  if (!location) return null;
  if (Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    return `${location.lat},${location.lng}`;
  }
  if (location.label && location.label.trim()) return location.label.trim();
  return null;
};

const buildCoordinateParam = (location: SegmentItem["location"]) => {
  if (!location) return null;
  if (Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    return `${location.lat},${location.lng}`;
  }
  return null;
};

const buildGoogleMapsLink = (from: SegmentItem | null, to: SegmentItem | null) => {
  const origin = buildLocationParam(from?.location ?? null);
  const destination = buildLocationParam(to?.location ?? null);
  if (!origin || !destination) return null;
  const params = new URLSearchParams({ api: "1", origin, destination });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

const sampleRouteWaypoints = (polyline: [number, number][], limit: number) => {
  const interior = polyline.slice(1, -1);
  if (!interior.length || limit <= 0) return [];

  if (interior.length <= limit) {
    return interior.map(([lat, lng]) => `${lat},${lng}`);
  }

  const indices = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    indices.add(Math.round(((index + 1) * (interior.length + 1)) / (limit + 1)) - 1);
  }

  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => interior[index])
    .filter((point): point is [number, number] => Array.isArray(point))
    .map(([lat, lng]) => `${lat},${lng}`);
};

const buildGoogleMapsRouteLink = (
  from: SegmentItem | null,
  to: SegmentItem | null,
  polyline: [number, number][],
) => {
  const origin = buildCoordinateParam(from?.location ?? null) ?? buildLocationParam(from?.location ?? null);
  const destination = buildCoordinateParam(to?.location ?? null) ?? buildLocationParam(to?.location ?? null);
  if (!origin || !destination) return null;

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });

  const waypoints = sampleRouteWaypoints(polyline, 8);
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.join("|"));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export default function TripDayTravelSegmentDialog({
  open,
  tripId,
  tripDayId,
  fromItem,
  toItem,
  segment,
  prefillRouteOnOpen = false,
  onClose,
  onSaved,
}: TripDayTravelSegmentDialogProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [transportType, setTransportType] = useState<"car" | "ship" | "flight">("car");
  const [durationInput, setDurationInput] = useState<string>("00:30");
  const [distanceKm, setDistanceKm] = useState<string>("");
  const [linkUrl, setLinkUrl] = useState<string>("");
  const [routeHelper, setRouteHelper] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ durationMinutes?: string; distanceKm?: string; linkUrl?: string }>({});
  const isEditing = Boolean(segment?.id);
  const mapsLink = useMemo(() => buildGoogleMapsLink(fromItem, toItem), [fromItem, toItem]);
  const autoPrefillTriggeredRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setFieldErrors({});
    setCsrfToken(null);
    setRouteHelper(null);

    if (segment) {
      setTransportType(segment.transportType);
      setDurationInput(formatMinutesToTime(segment.durationMinutes));
      setDistanceKm(segment.distanceKm !== null && segment.distanceKm !== undefined ? String(segment.distanceKm) : "");
      setLinkUrl(segment.linkUrl ?? "");
    } else {
      setTransportType("car");
      setDurationInput("00:30");
      setDistanceKm("");
      setLinkUrl(mapsLink ?? "");
    }
  }, [open, segment, mapsLink]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) setServerError(t("trips.travelSegment.initError"));
          return;
        }
        if (active) setCsrfToken(body.data.csrfToken);
      } catch {
        if (active) setServerError(t("trips.travelSegment.initError"));
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open, t]);

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

  const validate = () => {
    const nextErrors: { durationMinutes?: string; distanceKm?: string; linkUrl?: string } = {};
    const durationValue = parseTimeToMinutes(durationInput);
    if (durationValue === null || !Number.isFinite(durationValue) || durationValue <= 0) {
      nextErrors.durationMinutes = t("trips.travelSegment.durationRequired");
    }

    if (transportType === "car") {
      const distanceValue = Number.parseFloat(distanceKm);
      if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
        nextErrors.distanceKm = t("trips.travelSegment.distanceRequired");
      }
    }

    const normalizedLink = linkUrl.trim();
    if (normalizedLink.length > 0 && !isSafeExternalUrl(normalizedLink)) {
      nextErrors.linkUrl = t("trips.travelSegment.linkInvalid");
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleGoogleMapsRoute = useCallback(async () => {
    if (!mapsLink) return;
    setLinkUrl(mapsLink);
    setServerError(null);
    setRouteHelper(null);

    if (transportType !== "car") {
      setRouteHelper(t("trips.travelSegment.googleMapsCarOnlyHelper"));
      return;
    }

    if (!fromItem?.location || !toItem?.location) {
      setRouteHelper(t("trips.travelSegment.googleMapsUnavailableHelper"));
      return;
    }

    setRouteLoading(true);
    try {
      const params = new URLSearchParams({
        originLat: String(fromItem.location.lat),
        originLng: String(fromItem.location.lng),
        destinationLat: String(toItem.location.lat),
        destinationLng: String(toItem.location.lng),
      });
      const response = await fetch(`/api/trips/${tripId}/travel-segments/route-preview?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ route: RoutePreview }>;
      const route = body.data?.route;
      if (!response.ok || body.error || !route) {
        setRouteHelper(t("trips.travelSegment.googleMapsFallbackActive"));
        return;
      }

      const hasDuration = typeof route.durationSeconds === "number" && route.durationSeconds > 0;
      const hasDistance = typeof route.distanceMeters === "number" && route.distanceMeters > 0;
      if (!hasDuration || !hasDistance) {
        setRouteHelper(t("trips.travelSegment.googleMapsFallbackActive"));
        return;
      }

      setDurationInput(formatMinutesToTime(Math.max(1, Math.round(route.durationSeconds / 60))));
      setDistanceKm(formatDistanceKmInput(route.distanceMeters));
      setLinkUrl(buildGoogleMapsRouteLink(fromItem, toItem, route.polyline) ?? mapsLink);
      setRouteHelper(t("trips.travelSegment.googleMapsPrefillSuccess"));
    } catch {
      setRouteHelper(t("trips.travelSegment.googleMapsFallbackActive"));
    } finally {
      setRouteLoading(false);
    }
  }, [fromItem, mapsLink, t, toItem, transportType, tripId]);

  useEffect(() => {
    if (!open) {
      autoPrefillTriggeredRef.current = false;
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !prefillRouteOnOpen || routeLoading) return;
    if (autoPrefillTriggeredRef.current) return;
    autoPrefillTriggeredRef.current = true;
    void handleGoogleMapsRoute();
  }, [handleGoogleMapsRoute, open, prefillRouteOnOpen, routeLoading]);

  const handleSave = async () => {
    if (!tripDayId || !fromItem || !toItem) return;
    setServerError(null);

    if (!validate()) return;

    const normalizedLink = linkUrl.trim();
    const payload = {
      tripDayId,
      fromItemType: fromItem.type,
      fromItemId: fromItem.id,
      toItemType: toItem.type,
      toItemId: toItem.id,
      transportType,
      durationMinutes: parseTimeToMinutes(durationInput) ?? 0,
      distanceKm: transportType === "car" ? Number.parseFloat(distanceKm) : null,
      linkUrl: normalizedLink.length > 0 ? normalizedLink : null,
    };

    setSaving(true);
    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/travel-segments`, {
        method: isEditing ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify(isEditing ? { ...payload, segmentId: segment?.id } : payload),
      });

      const body = (await response.json()) as ApiEnvelope<{ segment: TravelSegment }>;
      if (!response.ok || body.error || !body.data?.segment) {
        setServerError(body.error?.message ?? t("trips.travelSegment.saveError"));
        return;
      }

      onSaved(body.data.segment);
    } catch {
      setServerError(t("trips.travelSegment.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEditing ? t("trips.travelSegment.editTitle") : t("trips.travelSegment.addTitle")}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {serverError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {serverError}
          </Alert>
        ) : null}

        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <Box
            display="grid"
            gridTemplateColumns={{ xs: "1fr", sm: "1fr 1fr" }}
            columnGap={2}
            rowGap={1}
          >
            <Box display="flex" flexDirection="column" gap={0.5}>
              <Typography variant="caption" color="text.secondary">
                {t("trips.travelSegment.fromLabel")}
              </Typography>
              <Typography variant="body2">{fromItem?.label ?? "-"}</Typography>
            </Box>
            <Box display="flex" flexDirection="column" gap={0.5}>
              <Typography variant="caption" color="text.secondary">
                {t("trips.travelSegment.toLabel")}
              </Typography>
              <Typography variant="body2">{toItem?.label ?? "-"}</Typography>
            </Box>
          </Box>

          <FormControl fullWidth size="small" margin="dense">
            <InputLabel id="travel-transport-label">{t("trips.travelSegment.transportLabel")}</InputLabel>
            <Select
              labelId="travel-transport-label"
              label={t("trips.travelSegment.transportLabel")}
              value={transportType}
              onChange={(event) => setTransportType(event.target.value as "car" | "ship" | "flight")}
            >
              <MenuItem value="car">{t("trips.travelSegment.transport.car")}</MenuItem>
              <MenuItem value="ship">{t("trips.travelSegment.transport.ship")}</MenuItem>
              <MenuItem value="flight">{t("trips.travelSegment.transport.flight")}</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label={t("trips.travelSegment.durationLabel")}
            value={durationInput}
            onChange={(event) => setDurationInput(event.target.value)}
            placeholder="HH:mm"
            size="small"
            margin="dense"
            error={Boolean(fieldErrors.durationMinutes)}
            helperText={fieldErrors.durationMinutes ?? ""}
            FormHelperTextProps={{ sx: { minHeight: 0 } }}
          />

          {transportType === "car" ? (
            <TextField
              label={t("trips.travelSegment.distanceLabel")}
              value={distanceKm}
              onChange={(event) => setDistanceKm(event.target.value)}
              type="number"
              size="small"
              margin="dense"
              inputProps={{ min: 0, step: "0.1" }}
              error={Boolean(fieldErrors.distanceKm)}
              helperText={fieldErrors.distanceKm ?? ""}
              FormHelperTextProps={{ sx: { minHeight: 0 } }}
            />
          ) : null}

          <TextField
            label={t("trips.travelSegment.linkLabel")}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder={mapsLink ?? "https://"}
            size="small"
            margin="dense"
            error={Boolean(fieldErrors.linkUrl)}
            helperText={fieldErrors.linkUrl ?? t("trips.travelSegment.linkHelper")}
            FormHelperTextProps={{ sx: { minHeight: 0 } }}
          />

          <Box display="flex" flexDirection="column" gap={1}>
            <Button
              variant="outlined"
              onClick={() => void handleGoogleMapsRoute()}
              disabled={!mapsLink || routeLoading}
              sx={{ alignSelf: "flex-start" }}
            >
              {isEditing
                ? t("trips.travelSegment.refreshGoogleMapsRoute")
                : t("trips.travelSegment.calculateGoogleMapsRoute")}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {mapsLink
                ? transportType === "car"
                  ? t("trips.travelSegment.googleMapsFallbackHelper")
                  : t("trips.travelSegment.googleMapsCarOnlyHelper")
                : t("trips.travelSegment.googleMapsUnavailableHelper")}
            </Typography>
            {routeHelper ? <Alert severity="info">{routeHelper}</Alert> : null}
          </Box>

        </Box>
      </DialogContent>
      <DialogActions>
        {mapsLink ? (
          <Button component="a" href={mapsLink} target="_blank" rel="noreferrer noopener">
            {t("trips.travelSegment.openLink")}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !tripDayId || !fromItem || !toItem}>
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
