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
import {
  transportTypeAllowsDistance,
  transportTypeRequiresDistance,
  type TransportType,
} from "@/lib/trips/transportTypes";

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

/**
 * The modes a router can answer for, and the Google `travelmode` each maps onto. Ship and flight are
 * absent on purpose - Google has no equivalent - so they fall through to the manual path instead of
 * producing an error.
 */
const GOOGLE_TRAVEL_MODE_BY_TRANSPORT = {
  car: "driving",
  walking: "walking",
  cycling: "bicycling",
} as const satisfies Partial<Record<TransportType, string>>;

type RoutableTransportType = keyof typeof GOOGLE_TRAVEL_MODE_BY_TRANSPORT;

const isRoutableTransportType = (value: TransportType): value is RoutableTransportType =>
  value in GOOGLE_TRAVEL_MODE_BY_TRANSPORT;

// The distance rule itself lives in `@/lib/trips/transportTypes` alongside the enum, so the form and
// the schema that will judge its payload cannot drift apart.
const allowsDistance = transportTypeAllowsDistance;

const requiresDistance = transportTypeRequiresDistance;

type TravelSegment = {
  id: string;
  tripDayId?: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: TransportType;
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

/**
 * This is a *duration*, not a time of day, so hours are not capped at 23. They were, and the field
 * could therefore reject its own prefill: `formatMinutesToTime` happily writes "39:00" and the old
 * `\d{1,2}` / `hours > 23` pair then answered "Duration is required" over a field that visibly
 * contained a duration. Once route import started returning real walking speeds (~4.5 km/h) a ~110 km
 * leg was enough to reach it, and a multi-day ship crossing always could.
 */
const parseTimeToMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 999 || minutes < 0 || minutes > 59) return null;
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

/**
 * The plain "open this leg in Maps" link. `transportType` is optional because `mapsLink` below is
 * memoised on the two items alone and feeds the effect that seeds the form - making that memo depend
 * on the mode would reset the form on every dropdown change. The mode is applied where the link is
 * handed to the field instead, which is enough: a link for a walking leg that opens driving
 * directions is wrong on the one surface the user actually taps.
 */
const buildGoogleMapsLink = (from: SegmentItem | null, to: SegmentItem | null, transportType?: TransportType) => {
  const origin = buildLocationParam(from?.location ?? null);
  const destination = buildLocationParam(to?.location ?? null);
  if (!origin || !destination) return null;
  const params = new URLSearchParams({ api: "1", origin, destination });
  if (transportType && isRoutableTransportType(transportType)) {
    params.set("travelmode", GOOGLE_TRAVEL_MODE_BY_TRANSPORT[transportType]);
  }
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
  transportType: RoutableTransportType,
) => {
  const origin = buildCoordinateParam(from?.location ?? null) ?? buildLocationParam(from?.location ?? null);
  const destination = buildCoordinateParam(to?.location ?? null) ?? buildLocationParam(to?.location ?? null);
  if (!origin || !destination) return null;

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    // Google's own spelling: `bicycling`, not `cycling`. Only the plain "Open Maps" link stays
    // mode-agnostic - it is memoised on the two items and feeds the form's initial link, so making
    // it depend on the transport type would reset the form every time the mode changed.
    travelmode: GOOGLE_TRAVEL_MODE_BY_TRANSPORT[transportType],
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
  const [transportType, setTransportType] = useState<TransportType>("car");
  const [durationInput, setDurationInput] = useState<string>("00:30");
  const [distanceKm, setDistanceKm] = useState<string>("");
  const [linkUrl, setLinkUrl] = useState<string>("");
  const [routeHelper, setRouteHelper] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ durationMinutes?: string; distanceKm?: string; linkUrl?: string }>({});
  const isEditing = Boolean(segment?.id);
  const mapsLink = useMemo(() => buildGoogleMapsLink(fromItem, toItem), [fromItem, toItem]);
  const autoPrefillTriggeredRef = useRef(false);
  /** The last link this component wrote into the field, so a link the user typed is never stomped. */
  const seededLinkRef = useRef<string>("");
  /** True while the form holds the output of a route import, which belongs to one mode only. */
  const routePrefilledRef = useRef(false);
  /** What the form held when it opened, so discarding a stale import restores rather than blanks. */
  const openSnapshotRef = useRef<{ duration: string; distance: string; link: string }>({
    duration: "00:30",
    distance: "",
    link: "",
  });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setFieldErrors({});
    setCsrfToken(null);
    setRouteHelper(null);
    routePrefilledRef.current = false;

    const opened = segment
      ? {
          duration: formatMinutesToTime(segment.durationMinutes),
          distance: segment.distanceKm !== null && segment.distanceKm !== undefined ? String(segment.distanceKm) : "",
          link: segment.linkUrl ?? "",
        }
      : { duration: "00:30", distance: "", link: mapsLink ?? "" };

    setTransportType(segment ? segment.transportType : "car");
    setDurationInput(opened.duration);
    setDistanceKm(opened.distance);
    setLinkUrl(opened.link);
    openSnapshotRef.current = opened;
    seededLinkRef.current = segment ? "" : opened.link;
  }, [open, segment, mapsLink]);

  /**
   * Changing the mode discards a route imported for the *previous* one. Without this, picking
   * Walking, importing, then switching to Cycling saved the walking duration, the walking distance
   * and a link reading `travelmode=walking` under a cycling segment, with "Route imported
   * successfully" still on screen. Before Story 6.16 only car could prefill, so the state could not
   * be reached; two routable modes make it one click.
   */
  const handleTransportTypeChange = (next: TransportType) => {
    if (next === transportType) return;
    setTransportType(next);
    setRouteHelper(null);
    setFieldErrors((errors) => ({ ...errors, distanceKm: undefined }));

    if (routePrefilledRef.current) {
      const opened = openSnapshotRef.current;
      // Re-point the link only if it is still the one this component seeded; a link the user pasted
      // is theirs to keep.
      const restoredLink =
        opened.link === (mapsLink ?? "") ? (buildGoogleMapsLink(fromItem, toItem, next) ?? "") : opened.link;
      setDurationInput(opened.duration);
      setDistanceKm(opened.distance);
      setLinkUrl(restoredLink);
      seededLinkRef.current = restoredLink;
      routePrefilledRef.current = false;
      return;
    }

    if (linkUrl === seededLinkRef.current) {
      const reseeded = buildGoogleMapsLink(fromItem, toItem, next) ?? "";
      setLinkUrl(reseeded);
      seededLinkRef.current = reseeded;
    }
  };

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

    if (requiresDistance(transportType)) {
      const distanceValue = Number.parseFloat(distanceKm);
      if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
        nextErrors.distanceKm = t("trips.travelSegment.distanceRequired");
      }
    } else if (allowsDistance(transportType) && distanceKm.trim().length > 0) {
      // Optional is not the same as silently discarded. `inputProps.min` is not enforced on submit -
      // nothing runs constraint validation - so `0` and `-3` reach here, and the API rejects both
      // (`travelSegmentSchemas.ts` is `.positive()`). Saying so beats dropping the number the user
      // typed and closing on a success.
      const distanceValue = Number.parseFloat(distanceKm);
      if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
        nextErrors.distanceKm = t("trips.travelSegment.distanceInvalid");
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
    // Point the fallback link at the mode being imported, so the link is right even on the paths
    // that return below without a route (ship and flight, no locations, no route for this mode).
    const modeAwareMapsLink = buildGoogleMapsLink(fromItem, toItem, transportType) ?? mapsLink;
    setLinkUrl(modeAwareMapsLink);
    seededLinkRef.current = modeAwareMapsLink;
    routePrefilledRef.current = false;
    setServerError(null);
    setRouteHelper(null);

    if (!isRoutableTransportType(transportType)) {
      // Ship and flight: no router has a profile for them, so this is the manual path by design and
      // must never read as an error.
      // Story 6.17 review: in the *add* dialog this exact sentence is already standing under the
      // form as `staticRouteHelper`, so setting it here too rendered the longest surviving helper
      // twice - roughly four extra wrapped lines in the dialog this story exists to fit onto a
      // 390px phone. The edit dialog renders no standing helper, so there it is still the only
      // thing that explains why nothing was imported.
      if (isEditing) setRouteHelper(t("trips.travelSegment.googleMapsManualModeHelper"));
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
        mode: transportType,
      });
      const response = await fetch(`/api/trips/${tripId}/travel-segments/route-preview?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ route: RoutePreview }>;
      const route = body.data?.route;
      // Bicycle coverage is patchy in much of the world. "There is no route for this mode here" is a
      // correct answer and gets its own message rather than the generic "import unavailable" one.
      if (body.error?.code === "routing_no_route") {
        setRouteHelper(t("trips.travelSegment.googleMapsNoRouteForMode"));
        return;
      }
      if (!response.ok || body.error || !route) {
        setRouteHelper(t("trips.travelSegment.googleMapsFallbackActive"));
        return;
      }

      const durationSeconds = typeof route.durationSeconds === "number" && route.durationSeconds > 0 ? route.durationSeconds : null;
      const distanceMeters = typeof route.distanceMeters === "number" && route.distanceMeters > 0 ? route.distanceMeters : null;
      const hasDuration = durationSeconds !== null;
      const hasDistance = distanceMeters !== null;
      if (!hasDuration || !hasDistance) {
        setRouteHelper(t("trips.travelSegment.googleMapsFallbackActive"));
        return;
      }

      const routeLink = buildGoogleMapsRouteLink(fromItem, toItem, route.polyline, transportType) ?? modeAwareMapsLink;
      setDurationInput(formatMinutesToTime(Math.max(1, Math.round(durationSeconds / 60))));
      setDistanceKm(formatDistanceKmInput(distanceMeters));
      setLinkUrl(routeLink);
      seededLinkRef.current = routeLink;
      // These three values belong to `transportType` and to no other mode - see
      // `handleTransportTypeChange`.
      routePrefilledRef.current = true;
      setRouteHelper(t("trips.travelSegment.googleMapsPrefillSuccess"));
    } catch {
      setRouteHelper(t("trips.travelSegment.googleMapsFallbackActive"));
    } finally {
      setRouteLoading(false);
    }
  }, [fromItem, isEditing, mapsLink, t, toItem, transportType, tripId]);

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
    // Walking and cycling may carry a distance but are not obliged to, so an *empty* field becomes
    // `null` rather than a `NaN` the API would reject. A field that is filled in but not positive no
    // longer reaches here - `validate()` now reports it instead of discarding it.
    const parsedDistance = Number.parseFloat(distanceKm);
    const distanceValue =
      allowsDistance(transportType) && Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : null;
    const payload = {
      tripDayId,
      fromItemType: fromItem.type,
      fromItemId: fromItem.id,
      toItemType: toItem.type,
      toItemId: toItem.id,
      transportType,
      durationMinutes: parseTimeToMinutes(durationInput) ?? 0,
      distanceKm: distanceValue,
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

  /**
   * The standing helper under the form, as opposed to `routeHelper`, which is the Alert a route
   * attempt leaves behind. `null` for the whole common case — see the comment at its render site.
   */
  const staticRouteHelper = isEditing
    ? null
    : mapsLink
      ? isRoutableTransportType(transportType)
        ? null
        : t("trips.travelSegment.googleMapsManualModeHelper")
      : t("trips.travelSegment.googleMapsUnavailableHelper");

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
              onChange={(event) => handleTransportTypeChange(event.target.value as TransportType)}
            >
              <MenuItem value="car">{t("trips.travelSegment.transport.car")}</MenuItem>
              <MenuItem value="walking">{t("trips.travelSegment.transport.walking")}</MenuItem>
              <MenuItem value="cycling">{t("trips.travelSegment.transport.cycling")}</MenuItem>
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

          {allowsDistance(transportType) ? (
            <TextField
              label={
                requiresDistance(transportType)
                  ? t("trips.travelSegment.distanceLabel")
                  : t("trips.travelSegment.distanceOptionalLabel")
              }
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

          {/*
            Story 6.17: the routable-with-locations branch used to render
            `googleMapsFallbackHelper` ("Open the route in Google Maps, then copy the duration and
            distance into this form"), which described a workflow the user was already performing.
            It is gone, key and all, so the common case — adding a car/walking/cycling leg between
            two placed items — now renders no static helper at all. The two surviving branches both
            say something the user has to act on, so the block renders only when there is one.
          */}
          {staticRouteHelper ? (
            <Typography variant="body2" color="text.secondary">
              {staticRouteHelper}
            </Typography>
          ) : null}
          {routeHelper ? <Alert severity="info">{routeHelper}</Alert> : null}

        </Box>
      </DialogContent>
      <DialogActions>
        {mapsLink ? (
          <Button component="a" href={mapsLink} target="_blank" rel="noreferrer noopener">
            {t("trips.travelSegment.openLink")}
          </Button>
        ) : null}
        <Button
          variant="outlined"
          onClick={() => void handleGoogleMapsRoute()}
          disabled={!mapsLink || routeLoading}
        >
          {/*
            Both arms are reachable — edit vs. add — and since Story 6.17 both resolve to "Plan", so
            this ternary renders the same word either way. The two keys are kept deliberately: they
            are the labels of two different actions that happen to share a word today, and collapsing
            them would make re-splitting them a dictionary change in two files instead of one.
          */}
          {isEditing
            ? t("trips.travelSegment.refreshGoogleMapsRoute")
            : t("trips.travelSegment.calculateGoogleMapsRoute")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !tripDayId || !fromItem || !toItem}>
          {t("trips.travelSegment.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
