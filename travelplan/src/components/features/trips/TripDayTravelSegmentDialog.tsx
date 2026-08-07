"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormHelperText,
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
import { parseDecimal } from "@/lib/trips/parseAmount";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";

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

/** What the two duration boxes hold. Strings, because they are what the user is mid-way through typing. */
type DurationInput = { hours: string; minutes: string };

/**
 * The duration a new segment opens with — 30 minutes, split the way the two boxes hold it. Frozen
 * because this one object is stored into both `durationInput` and `openedValues`: every update path
 * spreads into a new object today, and a future one that assigned a field in place would otherwise
 * corrupt the default for every dialog in the process.
 */
const DEFAULT_DURATION: Readonly<DurationInput> = Object.freeze({ hours: "0", minutes: "30" });

/**
 * Story 6.18 replaced the single `HH:mm` text field with an hours box and a minutes box, so this is
 * a split rather than a format. Nothing is zero-padded: the boxes take a bare count, where "05" is
 * noise.
 */
const splitMinutesToDuration = (minutes: number): DurationInput => {
  if (!Number.isFinite(minutes) || minutes <= 0) return { hours: "", minutes: "" };
  return { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) };
};

const formatDistanceKmInput = (distanceMeters: number) => {
  const km = Math.round((distanceMeters / 1000) * 10) / 10;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
};

/**
 * The two boxes recombined, or `null` for "this is not a duration" — one answer for the pair, which
 * is why one error line hangs under both boxes rather than one under each.
 *
 * The accepted set is deliberately the one the old `^(\d{1,3}):(\d{2})$` regex had: hours 0-999,
 * minutes 0-59, total above zero. That is why each box is matched against `^\d+$` before it is
 * parsed — `Number.parseInt` would otherwise read "1e3", "12abc", "-5" and "1.5" as numbers the
 * regex rejected outright. This function is the only judge; the boxes are `type="text"` precisely
 * so that everything the user typed reaches it, rather than a number input handing back `""` for
 * input it privately considers malformed.
 *
 * Hours are *not* capped at 23. They were once, and the field could therefore reject its own
 * prefill: a route import happily writes 39 hours and the old `\d{1,2}` / `hours > 23` pair then
 * answered "Duration is required" over a field that visibly contained a duration. Once route import
 * started returning real walking speeds (~4.5 km/h) a ~110 km leg was enough to reach it, and a
 * multi-day ship crossing always could.
 */
const combineDurationToMinutes = ({ hours, minutes }: DurationInput): number | null => {
  // The one widening Story 6.18 allows: an *empty* box counts as zero, where "01:" and ":30" were
  // both rejected. An empty box in a two-box duration reads as zero, and 60 and 30 minutes were
  // always acceptable durations. It applies to both boxes on purpose — an empty hours box next to a
  // minutes box reading 45 is the same "Duration is required over a field that visibly holds a
  // duration" this function's second paragraph exists to prevent, and a box empties itself on one
  // backspace. Two empty boxes still cannot mean "0 minutes": the `total > 0` floor below catches
  // that.
  const hoursRaw = hours.trim() || "0";
  const minutesRaw = minutes.trim() || "0";
  if (!/^\d+$/.test(hoursRaw) || !/^\d+$/.test(minutesRaw)) return null;
  const parsedHours = Number.parseInt(hoursRaw, 10);
  const parsedMinutes = Number.parseInt(minutesRaw, 10);
  if (parsedHours > 999 || parsedMinutes > 59) return null;
  const total = parsedHours * 60 + parsedMinutes;
  return total > 0 ? total : null;
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
  const [durationInput, setDurationInput] = useState<DurationInput>(DEFAULT_DURATION);
  const [distanceKm, setDistanceKm] = useState<string>("");
  const [linkUrl, setLinkUrl] = useState<string>("");
  const [routeHelper, setRouteHelper] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ durationMinutes?: string; distanceKm?: string; linkUrl?: string }>({});
  const isEditing = Boolean(segment?.id);
  /** One error line serves both duration boxes, so both have to point `aria-describedby` at it. */
  const durationErrorId = `${useId()}-duration-error`;
  const mapsLink = useMemo(() => buildGoogleMapsLink(fromItem, toItem), [fromItem, toItem]);
  const autoPrefillTriggeredRef = useRef(false);
  /** The last link this component wrote into the field, so a link the user typed is never stomped. */
  const seededLinkRef = useRef<string>("");
  /** True while the form holds the output of a route import, which belongs to one mode only. */
  const routePrefilledRef = useRef(false);
  /**
   * What the form holds when it opens.
   *
   * Story 6.25 turned this from a ref written by the open effect into a `useMemo`, because it now has a
   * second reader — the dirty comparison that decides whether the `✕` asks before discarding — and that
   * one runs during render. A ref read during render is both an eslint error (`react-hooks/refs`) and a
   * real correctness hazard: nothing re-renders when a ref changes, so the comparison could sit on a
   * stale baseline. Derived instead, from exactly the inputs the open effect keys on, so seeding and
   * comparing cannot drift apart.
   *
   * `transport` joined for the dirty comparison only; `handleTransportTypeChange` reads the other three
   * by name, to restore a stale route import.
   */
  const openedValues = useMemo(
    () =>
      segment
        ? {
            duration: splitMinutesToDuration(segment.durationMinutes),
            distance:
              segment.distanceKm !== null && segment.distanceKm !== undefined ? String(segment.distanceKm) : "",
            link: segment.linkUrl ?? "",
            transport: segment.transportType,
          }
        : { duration: DEFAULT_DURATION, distance: "", link: mapsLink ?? "", transport: "car" as TransportType },
    [segment, mapsLink],
  );

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setFieldErrors({});
    setCsrfToken(null);
    setRouteHelper(null);
    routePrefilledRef.current = false;

    setTransportType(openedValues.transport);
    setDurationInput(openedValues.duration);
    setDistanceKm(openedValues.distance);
    setLinkUrl(openedValues.link);
    seededLinkRef.current = segment ? "" : openedValues.link;
  }, [open, segment, openedValues]);

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
      const opened = openedValues;
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
    // `combineDurationToMinutes` already returns `null` for everything outside the accepted set,
    // including a non-positive total, so there is nothing left for this to re-check.
    if (combineDurationToMinutes(durationInput) === null) {
      nextErrors.durationMinutes = t("trips.travelSegment.durationRequired");
    }

    if (requiresDistance(transportType)) {
      // Story 6.27: `parseDecimal`, not `Number.parseFloat`. Now that the box is `type="text"` a
      // German `12,5` arrives intact, and `Number.parseFloat` would read it as `12` - a silent
      // truncation the number input was accidentally hiding by delivering `""` instead.
      //
      // And the same empty-versus-invalid split the money fields get: while this was `type="number"`
      // an unparseable distance arrived as `""`, so "required" described both states. It arrives
      // intact now, and answering "required" to a box the user can see holds `abc` is the lie this
      // story removed everywhere else.
      const distanceValue = parseDecimal(distanceKm);
      if (!distanceKm.trim()) {
        nextErrors.distanceKm = t("trips.travelSegment.distanceRequired");
      } else if (distanceValue === null || distanceValue <= 0) {
        nextErrors.distanceKm = t("trips.travelSegment.distancePositive");
      }
    } else if (allowsDistance(transportType) && distanceKm.trim().length > 0) {
      // Optional is not the same as silently discarded. Nothing runs constraint validation on submit,
      // so `0` and `-3` reach here, and the API rejects both (`travelSegmentSchemas.ts` is
      // `.positive()`). Saying so beats dropping the number the user typed and closing on a success.
      const distanceValue = parseDecimal(distanceKm);
      if (distanceValue === null || distanceValue <= 0) {
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
      setDurationInput(splitMinutesToDuration(Math.max(1, Math.round(durationSeconds / 60))));
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
    const parsedDistance = parseDecimal(distanceKm);
    const distanceValue =
      allowsDistance(transportType) && parsedDistance !== null && parsedDistance > 0 ? parsedDistance : null;
    const payload = {
      tripDayId,
      fromItemType: fromItem.type,
      fromItemId: fromItem.id,
      toItemType: toItem.type,
      toItemId: toItem.id,
      transportType,
      durationMinutes: combineDurationToMinutes(durationInput) ?? 0,
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

  /**
   * Story 6.25 AC7. Compared against the values the dialog opened with rather than against a per-field
   * `touched` flag, which is 6.24's finding: a flag calls the form dirty after a character is typed
   * and deleted again, and would guard the `✕` with nothing behind it. It also covers the two paths no
   * `onChange` sees — the route import writing all three fields, and the mode switch restoring them.
   *
   * `serverError`, `routeHelper` and `fieldErrors` are deliberately absent: they are the form's
   * feedback about itself, not input the user would lose.
   */
  const isDirty =
    transportType !== openedValues.transport ||
    durationInput.hours !== openedValues.duration.hours ||
    durationInput.minutes !== openedValues.duration.minutes ||
    distanceKm !== openedValues.distance ||
    linkUrl !== openedValues.link;
  const segmentGuard = useDiscardGuard(isDirty, onClose);

  return (
    <>
    <Dialog open={open} onClose={segmentGuard.requestClose} fullWidth maxWidth="sm">
      <DialogTitleWithClose label={t("common.close")} onClose={segmentGuard.requestClose} disabled={saving}>
        {isEditing ? t("trips.travelSegment.editTitle") : t("trips.travelSegment.addTitle")}
      </DialogTitleWithClose>
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

          {/*
            Story 6.18. A duration is a span, not a time of day, so this is deliberately *not*
            `type="time"`: a clock would read "01:30" as half past one and could not hold 26:30 at
            all, which a real walking prefill produces.

            `type="text"` with `inputMode="numeric"`, not `type="number"`. Both give a phone a
            digits-only keypad — `inputMode` is the part that does it, and on iOS bare
            `type="number"` in fact yields the numbers-*and-punctuation* keyboard — but a number
            input also reports `value === ""` for anything the browser calls `badInput`. "12e" and a
            comma-decimal typed on a German keyboard both look filled on screen and arrive here
            empty, which the empty-box-means-zero rule below would then save as a silent zero. A
            text box hands `combineDurationToMinutes` exactly what the user typed, so its `^\d+$`
            gate can reject it and say so. It also drops `type="number"`'s scroll-wheel behaviour,
            which silently rewrites a focused field when the dialog is scrolled.

            The two boxes share one row inside the column the single field used to occupy, so the
            dialog gains no height — Story 6.17 spent itself reclaiming exactly that — and one error
            line hangs under the pair rather than one under each box, because the two boxes are one
            value and `validate()` produces one message for it.
          */}
          <Box>
            <Box display="flex" gap={2} sx={{ "& > *": { flex: 1, minWidth: 0 } }}>
              <TextField
                label={t("trips.travelSegment.durationHoursLabel")}
                value={durationInput.hours}
                onChange={(event) => {
                  setDurationInput((current) => ({ ...current, hours: event.target.value }));
                  setFieldErrors((errors) => ({ ...errors, durationMinutes: undefined }));
                }}
                type="text"
                size="small"
                margin="dense"
                error={Boolean(fieldErrors.durationMinutes)}
                slotProps={{
                  htmlInput: {
                    inputMode: "numeric",
                    "aria-describedby": fieldErrors.durationMinutes ? durationErrorId : undefined,
                  },
                }}
              />
              <TextField
                label={t("trips.travelSegment.durationMinutesLabel")}
                value={durationInput.minutes}
                onChange={(event) => {
                  setDurationInput((current) => ({ ...current, minutes: event.target.value }));
                  setFieldErrors((errors) => ({ ...errors, durationMinutes: undefined }));
                }}
                type="text"
                size="small"
                margin="dense"
                error={Boolean(fieldErrors.durationMinutes)}
                slotProps={{
                  htmlInput: {
                    inputMode: "numeric",
                    "aria-describedby": fieldErrors.durationMinutes ? durationErrorId : undefined,
                  },
                }}
              />
            </Box>
            {fieldErrors.durationMinutes ? (
              // `mx: "14px"` is the indent MUI's `contained` helper-text variant applies inside an
              // outlined field; this one sits outside both fields' `FormControl`s, so it has to say
              // so itself to line up with the distance field's error below it.
              <FormHelperText error id={durationErrorId} sx={{ minHeight: 0, mx: "14px" }}>
                {fieldErrors.durationMinutes}
              </FormHelperText>
            ) : null}
          </Box>

          {allowsDistance(transportType) ? (
            <TextField
              label={
                requiresDistance(transportType)
                  ? t("trips.travelSegment.distanceLabel")
                  : t("trips.travelSegment.distanceOptionalLabel")
              }
              value={distanceKm}
              onChange={(event) => setDistanceKm(event.target.value)}
              // Story 6.27. The argument the docblock above makes for the duration boxes was never
              // applied to this one, twenty lines below it: this stayed `type="number"`, so `12,5`
              // arrived empty and the user was told a distance was required. Same fix, one
              // difference - `inputMode="decimal"` rather than `"numeric"`, because a distance has a
              // fractional part. `min`/`step` go with the type: nothing ran constraint validation on
              // them, `validate()` is what rejects `0` and `-3`, and `step: "0.1"` implied a
              // one-decimal cap that has never existed.
              type="text"
              size="small"
              margin="dense"
              slotProps={{ htmlInput: { inputMode: "decimal" } }}
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
        {/* Story 6.25 AC2. `Abbrechen` left; the two remaining left-hand buttons are not dismissals —
            one opens the route in Maps, the other imports it — so the spacer still earns its place. */}
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !tripDayId || !fromItem || !toItem}>
          {t("trips.travelSegment.save")}
        </Button>
      </DialogActions>
    </Dialog>
    <DiscardChangesDialog {...segmentGuard.dialogProps} />
    </>
  );
}
