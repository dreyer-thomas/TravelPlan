"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  type Breakpoint,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Skeleton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TripDeleteDialog from "@/components/features/trips/TripDeleteDialog";
import TripEditDialog, { type TripDetail as EditableTripDetail } from "@/components/features/trips/TripEditDialog";
import TripShareDialog from "@/components/features/trips/TripShareDialog";
import TripDayGanttBar from "@/components/features/trips/TripDayGanttBar";
import { buildOverviewGanttSegments } from "@/components/features/trips/TripDayGanttOverviewData";
import { deriveCoverageSummary, type TripDayGanttSegment } from "@/components/features/trips/TripDayGanttSegments";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import { buildTripOverviewMapData } from "@/components/features/trips/TripOverviewMapData";
import { isSafeLink } from "@/components/features/trips/TripDayPlanItemContent";
import { useOpenInstanceKey } from "@/components/ui/DialogShell";
import {
  ChevronRightIcon,
  HERO_SCRIM,
  HouseIcon,
  ON_PHOTO_CHROME,
  ShareGlyphIcon,
  WarningTriangleIcon,
  toCssUrl,
} from "@/components/features/trips/TripIcons";
import {
  canTripAccessRoleManageTrip,
  canTripAccessRoleWrite,
  type TripAccessRole,
} from "@/lib/auth/tripAccessRole";
import { extractAttachmentFilename, triggerBlobDownload } from "@/lib/browser/blobDownload";
import { formatShortDate } from "@/lib/trips/formatShortDate";
// Story 8.5 review. The same two rules `TripDayView` uses, because this file's coverage bar and that
// screen's travel figure describe the same day: the order the day's endpoints are in, and which pairs
// of that order are legs the timeline draws.
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";
import {
  buildDrawnDaySegmentPairKeys,
  isDrawnDaySegment,
  type DaySegmentEndpoint,
} from "@/lib/trips/daySegmentPairs";
import { withImageCacheBuster } from "@/lib/trips/imageUploads";
import type { TransportType } from "@/lib/trips/transportTypes";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  accessRole?: TripAccessRole;
  startDate: string;
  endDate: string;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
  /** Versions the hero URL; see `withImageCacheBuster`. Optional so an older cached payload still renders. */
  updatedAt?: string;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  imageUrl?: string | null;
  note?: string | null;
  updatedAt?: string;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    title?: string | null;
    fromTime?: string | null;
    toTime?: string | null;
    contentJson: string;
    linkUrl: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
    /**
     * Story 8.5 review. `GET /api/trips/{id}` carries this, and it is optional here for the same
     * reason it is in `TripDayView`: a payload built before it did (an older cached response, a
     * fixture) must still type-check. It is the tie-break `compareDayPlanItemsByStartTime` applies to
     * two activities starting at the same minute, and this file needs that order because the coverage
     * bar below counts exactly the legs the day's endpoint order makes consecutive.
     */
    createdAt?: string;
  }[];
  travelSegments?: {
    id: string;
    fromItemType: "accommodation" | "dayPlanItem";
    fromItemId: string;
    toItemType: "accommodation" | "dayPlanItem";
    toItemId: string;
    transportType: TransportType;
    durationMinutes: number;
    distanceKm: number | null;
    linkUrl: string | null;
  }[];
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripTimelineProps = {
  tripId: string;
};

// Only reached when the header is absent or unparseable - the route always sends one, so this is
// the "something upstream changed" name, not the normal one.
const EXPORT_FILENAME_FALLBACK = "trip-backup.zip";

// The one breakpoint the day card's stacked/inline layout turns on, read by `data-layout`, by the
// card's grid templates and by its photo's size - see the comments at those three sites. Annotated
// rather than written `as const` (a no-op on a `const` string literal): the annotation is what
// rejects a pixel number, and `Exclude<…, "xs">` what stops it colliding with the literal `xs` key.
const TIMELINE_CARD_LAYOUT_BREAKPOINT: Exclude<Breakpoint, "xs"> = "sm";

export default function TripTimeline({ tripId }: TripTimelineProps) {
  const { language, t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /**
   * One mount of the share dialog per open — see `useOpenInstanceKey`. The dialog is rendered
   * unconditionally so its exit transition still plays on close, which is why it used to clear its
   * own state in a `!open` branch; a fresh instance per open makes every `useState` initial value
   * the reset.
   *
   * Namespaced into `share-…` at the call site even though this is currently the only keyed dialog
   * on this screen. Its two siblings — the edit and delete dialogs — are unkeyed today, and every
   * counter this hook hands out starts at `0`: the first one of them to be given a bare key would
   * collide with this one on the first render, which is the failure `TripDayView` already had to
   * fix once. The namespace costs nothing and does not depend on remembering this.
   */
  const shareDialogKey = useOpenInstanceKey(shareOpen);
  // Export gets its own error slot rather than reusing `error` above. `error` is the load-failure
  // slot: it renders at the very top of the page and drives the `error && !detail` branch that
  // replaces the whole trip with a "Back to trips" button. A failed export leaves a perfectly good
  // trip on screen, so it belongs beside the button that produced it, inside the controls card.
  // Same split, and the same reason, as `loadError` vs. `serverError` in `TripShareDialog`.
  //
  // The *key* is held rather than the resolved sentence, and resolved at render. A message resolved
  // once at failure time would still be on screen in the previous language after a language switch,
  // which this app supports without a reload.
  const [exportErrorKey, setExportErrorKey] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const router = useRouter();
  // Negated `up()`, not `down()`: the `sm` sx key applies from `min-width:600px`, while
  // `down("sm")` is `max-width:599.95px`, so the old form left `[599.95, 600)` claimed by neither -
  // reachable through browser zoom and fractional `devicePixelRatio`. Pinned by
  // `tripTimelinePlan.test.tsx` ("stamps `stacked` right up to the `sm` bound and `inline` exactly
  // on it", :1191/:1196), which is the only case that fails if `down()` comes back.
  // `defaultMatches: true` because the negation inverts MUI's default: with no `matchMedia` (SSR,
  // and the suites that stub nothing) a bare `up()` answers `false`, which negates to `stacked`,
  // where `down("sm")` used to answer `false` and stamp `inline`. Wrong on its own terms too - a
  // viewportless render is not a phone - and it would move every server-rendered card's attribute.
  // Pinned by the same file's "stamps `inline` when no `matchMedia` exists to ask" (:1249).
  // Consumed once, at the day card's `data-layout` - see the comment there.
  const isNarrowLayout = !useMediaQuery(theme.breakpoints.up(TIMELINE_CARD_LAYOUT_BREAKPOINT), {
    defaultMatches: true,
  });
  // The overview grid's own key (`gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" }`), not a new
  // value: this decides *where* the single trip-controls card is mounted, and any other breakpoint
  // would open a window where the layout is stacked but the ordering is not.
  //
  // This is the sanctioned exception to "pure sx breakpoints, never useMediaQuery" (see the same
  // convention comment in DialogShell.tsx, AuthScreenShell.tsx and TripCreateForm.tsx): per the
  // 2026-08-08 decision recorded against DW-106, useMediaQuery may decide *which subtree mounts* -
  // never how a mounted subtree looks. `tripControlsCard` below is mounted at one of two JSX
  // positions depending on this value, which is exactly that case; nothing here uses it to style
  // an already-mounted element. See DW-107 for the focus-restore consequence of the resulting
  // unmount/remount.
  const isTwoColumnLayout = useMediaQuery(theme.breakpoints.up("md"));
  // The same two predicates the server gates the routes behind, not a restatement of them: an absent
  // or unrecognised role has to grant nothing, and these say so by testing for the roles that *do*
  // grant rather than for the one that does not. Until DW-243 both lines read `accessRole ? test :
  // true`, so a payload without the field - an older cached response, a shape change, a fetch that
  // failed halfway - handed the reader Edit, Delete, Share, Export and click-to-edit on a trip that
  // might be somebody else's, and every one of those buttons then died on a 403 or 404 from the route.
  //
  // DW-243's decision accepts that an owner may briefly see the read-only surface, since "not yet
  // known" and "no access" are now the same state. That cost is not paid *here*, but name the reason
  // precisely, because the obvious one is only half of it: the `loading` early return below covers
  // the first render, and the load-error path does *not* - it clears `detail` and drops `loading`,
  // then falls through to the main return. What actually keeps both flags out of a rendered tree is
  // that `tripControlsCard` and every other reader of them sit inside the `{detail && …}` wrappers.
  // Hoist one of them out and this cost lands here after all. It is paid on the day screen, where
  // `canEditPlanning` also gates an effect - see `TripDayView.tsx`.
  const isOwner = canTripAccessRoleManageTrip(detail?.trip.accessRole);
  const canEditPlanning = canTripAccessRoleWrite(detail?.trip.accessRole);

  // DW-107: `tripControlsCard` (below, after the `loading`/`notFound` early returns) is built once
  // but mounted at one of two JSX positions gated by `isTwoColumnLayout` above - different React
  // tree positions, so crossing `md` unmounts the card in one and mounts a fresh instance in the
  // other. A keyboard user focused on one of its three buttons would otherwise lose focus to
  // `<body>` at that instant. These refs track which button last held focus so the effect below can
  // restore it on the new instance; declared here, ahead of every early return, because hooks must
  // run unconditionally on every render.
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedControlRef = useRef<"edit" | "delete" | "export" | null>(null);

  // `lastFocusedControlRef` is never cleared on blur - clearing it there would race the very unmount
  // it needs to survive (the blur such a removal fires would clear it before this effect gets a
  // chance to read it). The `document.activeElement === document.body` check is the guard against
  // that staleness: it does not prove the transition below is *why* focus is on `<body>`, only that
  // nothing else has claimed it since. A user who deliberately blurs to `<body>` (e.g. a stray click
  // on blank page space) and then triggers an unrelated crossing while a stale control is still
  // named could see focus land back on it - a false positive, not a crash, and no worse than the
  // `<body>` dead end this effect exists to avoid; still narrower than the remount case itself,
  // which is why it is accepted here rather than solved.
  //
  // Plain `useEffect`, not `useLayoutEffect`: this is a "use client" component, and a layout effect
  // here would warn on the server render.
  useEffect(() => {
    if (!lastFocusedControlRef.current) return;
    if (typeof document === "undefined" || document.activeElement !== document.body) return;
    const refByControl = {
      edit: editButtonRef,
      delete: deleteButtonRef,
      export: exportButtonRef,
    } as const;
    refByControl[lastFocusedControlRef.current].current?.focus();
  }, [isTwoColumnLayout]);

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

  const loadTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    // A past export failure must not outlive the trip it was about. Without this the alert sits in
    // the controls card indefinitely - through a reload, through an edit - reporting a failure that
    // is no longer true of anything on screen.
    setExportErrorKey(null);

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
  const resolveDayImageSrc = useCallback((imageUrl?: string | null, updatedAt?: string) => {
    if (!imageUrl || !imageUrl.trim()) return null;
    if (!updatedAt) return imageUrl;
    const version = encodeURIComponent(updatedAt);
    return imageUrl.includes("?") ? `${imageUrl}&v=${version}` : `${imageUrl}?v=${version}`;
  }, []);

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

  // Only ever resolves a real place: the accommodation's own location label, or nothing. A day-note
  // fallback used to exist here for the gap-alert copy, but a gap day has no accommodation by
  // construction (tripRepo: missingAccommodation === !hasAccommodation), so it only ever produced the
  // raw note - sometimes an itinerary line - in place of a place name. The gap-alert copy now names
  // the day and date instead.
  const resolveStayLocationLabel = useCallback(
    (day: TripDay): string | null => day.accommodation?.location?.label?.trim() || null,
    [],
  );

  const overviewMapData = useMemo(() => {
    if (!detail) {
      return { points: [], missingLocations: [], polylinePositions: [] };
    }

    return buildTripOverviewMapData({
      tripId,
      days: detail.days.map((day) => ({
        id: day.id,
        date: day.date,
        dayIndex: day.dayIndex,
        accommodation: day.accommodation
          ? {
              id: day.accommodation.id,
              name: day.accommodation.name,
              notes: day.accommodation.notes,
              location: day.accommodation.location,
            }
          : null,
        dayPlanItems: day.dayPlanItems.map((item) => ({
          id: item.id,
          title: item.title ?? null,
          contentJson: item.contentJson,
          location: item.location,
        })),
      })),
      getDayLabel: (index) => formatMessage(t("trips.timeline.dayLabel"), { index }),
      getPlanItemFallbackLabel: (index) => formatMessage(t("trips.plan.previewFallback"), { index }),
    });
  }, [detail, t, tripId]);

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
    // `accessRole` is carried across rather than taken from `updated`, and the spread order is the
    // whole point: `EditableTripDetail`'s trip type (`TripEditDialog.tsx`) declares no `accessRole`
    // at all, so the cast below is the one path in this component that can hand `setDetail` a trip
    // without one. The PATCH response does include the field today - the dialog spreads the body
    // through - which is exactly why this was invisible while the flags failed open. Now that an
    // absent role means "no access", the same cast would strip an owner's Edit, Delete, Share and
    // Export the instant her own save succeeded, with no error and nothing on screen to explain it.
    // `...updated.trip` still wins wherever the field is present, so a role the server actually
    // changed is respected; this only fills a hole the type cannot see.
    setDetail((current) => ({ ...updated, trip: { accessRole: current?.trip.accessRole, ...updated.trip } }) as TripDetail);
    setEditOpen(false);
  };

  const handleDeleted = () => {
    setDeleteOpen(false);
    router.push("/trips");
  };

  // Fetched into a blob rather than handed to an `<a download>` pointing at the route. The route
  // reports every failure as a JSON `{data,error}` envelope - 401 unauthenticated, 403
  // `password_change_required`, 404 for a non-owner or a missing trip, 500 `server_error` - and an
  // anchor cannot see a status code: it would save that envelope to disk as a file called `export`
  // and the user would find out by opening it. Going through `fetch` is what makes `response.ok`,
  // and therefore the error path below, reachable at all; it is also what makes the pending state
  // possible, and a photo-heavy archive takes long enough to build that the pending state matters.
  //
  // The trade-off is that the whole archive is resident in memory as a blob before it reaches disk,
  // where a plain anchor would have streamed it. A trip's photos are the bulk of it and the largest
  // seen in verification was ~16 MB, which is not a size a browser struggles with - but this is the
  // ceiling to revisit if exports ever grow into the hundreds of megabytes.
  //
  // No CSRF token: this app validates CSRF per-route inside the mutating handlers rather than in
  // middleware, and this GET has no `validateCsrf` call. (`middleware.ts` checks the session cookie
  // and nothing else.)
  const handleExport = async () => {
    setExportErrorKey(null);
    setIsExporting(true);

    try {
      const response = await fetch(`/api/trips/${tripId}/export`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        // Read the envelope rather than reporting one sentence for every failure. Two of these are
        // states where "please try again" is actively wrong advice: an expired session (401, from
        // middleware) and a trip that was deleted or was never yours (404) both repeat forever, and
        // only the first has a way out. Existing keys, deliberately - no new i18n contract for a
        // control whose own strings are the only ones this story adds.
        const body = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;

        switch (body?.error?.code) {
          case "unauthorized":
            setExportErrorKey("errors.unauthorized");
            break;
          case "not_found":
            setExportErrorKey("trips.detail.notFoundBody");
            break;
          // Story 5.13 moved this route to owner-or-contributor, so a refusal for the caller's role now
          // arrives as `forbidden` rather than folded into the 404 above. "Please try again" is the same
          // wrong advice here as it is for the two cases above it - the role is not going to change on a
          // retry - and this button is reachable by a contributor, so the case is not theoretical.
          case "forbidden":
            setExportErrorKey("errors.forbidden");
            break;
          case "server_error":
            setExportErrorKey("errors.server");
            break;
          default:
            setExportErrorKey("trips.export.error");
        }

        return;
      }

      const filename = extractAttachmentFilename(response.headers.get("content-disposition")) ?? EXPORT_FILENAME_FALLBACK;
      triggerBlobDownload(await response.blob(), filename);
    } catch {
      // A thrown request, or a `blob()` that rejected because the archive failed mid-stream. Not the
      // network key: a truncated archive is not an unreachable server, and this branch cannot tell
      // the two apart.
      setExportErrorKey("trips.export.error");
    } finally {
      setIsExporting(false);
    }
  };

  // The hero is versioned at *read* time, not just at upload time. The upload route replaces
  // `hero.<ext>` in place, so without a version the URL is byte-identical before and after and the
  // browser keeps serving whatever it already cached for that key - which is why a freshly uploaded
  // hero appeared, then vanished again the moment this component refetched on the next navigation.
  // The placeholder is a static asset and needs no version.
  const heroImageCss = detail
    ? toCssUrl(
        detail.trip.heroImageUrl
          ? withImageCacheBuster(detail.trip.heroImageUrl, detail.trip.updatedAt)
          : "/images/world-map-placeholder.svg",
      )
    : "none";
  const openDaysCount = detail?.days.filter((day) => day.missingAccommodation).length ?? 0;
  const firstGapDay = detail?.days.find((day) => day.missingAccommodation) ?? null;
  const accommodationCostTotal = detail?.trip.accommodationCostTotalCents ?? 0;
  const activitiesCostTotal = Math.max((detail?.trip.plannedCostTotal ?? 0) - accommodationCostTotal, 0);

  // One card, two possible parents - never two cards. Story 6.14: below `md` the grid stacks and DOM
  // order is visual order, so a card living inside the day column lands between the day list and the
  // sidebar's information. It has to move past the whole sidebar there, and a CSS `order` cannot do
  // that: it reorders siblings, and the card's siblings are the day rows, not the sidebar's cards.
  // So the element is built once here and mounted in exactly one of two positions (see the grid
  // below); duplicating it and hiding one copy would double Edit/Delete in the accessibility tree.
  // The guard travels with it - viewers get neither button, and a bare 18px-padded bordered card is
  // the defect Story 7.8 Task 5 fixed.
  //
  // DW-107: because the two positions are different tree positions, the browser drops focus to
  // `<body>` when the previously-focused button's instance is the one that unmounts. The refs and
  // the restoring effect live earlier in this component, alongside `isTwoColumnLayout` - not here -
  // because hooks cannot sit after the `loading`/`notFound` early returns above.
  // `|| isOwner` used to sit on this test and is gone: `canTripAccessRoleWrite` admits every role
  // `canTripAccessRoleManageTrip` does, so the second operand could never change the answer. It read
  // as two independent reasons to render the card when there has only ever been one.
  const tripControlsCard =
    canEditPlanning ? (
      <Box
        data-testid="trip-controls-card"
        sx={{
          backgroundColor: tokens.card,
          border: "1px solid",
          borderColor: tokens.borderStrong,
          borderRadius: "8px",
          padding: "18px",
        }}
      >
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          {canEditPlanning ? (
            <Button
              ref={editButtonRef}
              variant="outlined"
              onClick={() => setEditOpen(true)}
              onFocus={() => {
                lastFocusedControlRef.current = "edit";
              }}
            >
              {t("trips.edit.open")}
            </Button>
          ) : null}
          {isOwner ? (
            <Button
              ref={deleteButtonRef}
              variant="outlined"
              onClick={() => setDeleteOpen(true)}
              onFocus={() => {
                lastFocusedControlRef.current = "delete";
              }}
            >
              {t("trips.delete.open")}
            </Button>
          ) : null}
          {/* `canEditPlanning` as of Story 5.13, which answered the question this comment used to
              leave open. The export route is owner-or-contributor now: a contributor can already
              read every stay, activity, photo and document the archive contains, so refusing her the
              ZIP protected nothing and only changed the container. It still sits beside Delete
              rather than beside Edit, because that is where Story 7.8 put it.

              Note the button and the route move together. `isOwner` here was never a guard - it was
              a mirror of a gate, and leaving it behind after widening the route would have hidden a
              control a contributor is now entitled to.

              No `color`, `size` or `startIcon`: the Epic 7 outlined treatment comes from
              `theme.ts`, and anything declared here would make this button the odd one of three. */}
          {canEditPlanning ? (
            <Button
              ref={exportButtonRef}
              variant="outlined"
              onClick={() => void handleExport()}
              onFocus={() => {
                lastFocusedControlRef.current = "export";
              }}
              disabled={isExporting}
              // The spinner replaces the label, which would otherwise take the accessible name with
              // it: mid-flight the button would drop out of `getByRole("button", { name })` and go
              // unnamed to a screen reader at the one moment it has something to say. `aria-busy`
              // is what says *why* it is disabled rather than leaving it silently inert.
              aria-label={t("trips.export.open")}
              aria-busy={isExporting}
              // The spinner is much narrower than the label it replaces, and this row wraps. Without
              // a floor the button collapses to spinner width for the whole export and Edit/Delete
              // re-flow around it - on a phone, where the row is already close to wrapping, the
              // controls visibly rearrange themselves and then rearrange back.
              sx={{ minWidth: 148 }}
            >
              {isExporting ? <CircularProgress size={22} /> : t("trips.export.open")}
            </Button>
          ) : null}
        </Box>
        {/* Inside the card, under the row that produced it - see the note on `exportErrorKey`. */}
        {exportErrorKey && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {t(exportErrorKey)}
          </Alert>
        )}
      </Box>
    ) : null;

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {/*
       * Story 6.20: when the load failed outright there is no trip to render, so this alert is the
       * whole page. It gets the same recovery button as the not-found panel above, for the same
       * reason that one keeps its own: the way back to all trips used to sit above this component as
       * a breadcrumb on the trip detail page, and hunting through the header menu is a poor thing to
       * ask of someone whose page did not load. A transient error over an already-rendered trip
       * (`detail` present) does not get one - the trip's own chrome is still there.
       */}
      {error && !detail && (
        <Button component={Link} href="/trips" variant="outlined" sx={{ alignSelf: "flex-start" }}>
          {t("trips.detail.back")}
        </Button>
      )}

      {detail && (
        <>
          <Box sx={{ borderRadius: "8px", overflow: "hidden", border: "1px solid", borderColor: tokens.border }}>
            <Box
              data-testid="trip-hero"
              sx={{
                position: "relative",
                minHeight: 300,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: "22px 32px 24px",
                overflow: "hidden",
                backgroundColor: theme.palette.primary.main,
                backgroundImage: heroImageCss,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <Box aria-hidden sx={{ position: "absolute", inset: 0, background: HERO_SCRIM }} />
              <Box
                sx={{
                  position: "absolute",
                  top: 20,
                  left: 32,
                  right: 32,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  zIndex: 2,
                  gap: 2,
                }}
              >
                <Typography variant="kicker" sx={{ color: "rgba(255,255,255,.92)" }}>
                  {t("trips.timeline.activeTripKicker")}
                </Typography>
                {isOwner ? (
                  <Button
                    variant="text"
                    onClick={() => setShareOpen(true)}
                    startIcon={<ShareGlyphIcon />}
                    sx={{ ...ON_PHOTO_CHROME, whiteSpace: "nowrap" }}
                  >
                    {t("trips.share.open")}
                  </Button>
                ) : null}
              </Box>
              <Box sx={{ position: "relative", zIndex: 2 }}>
                <Typography variant="display" component="h4" sx={{ color: "#FFFFFF", textShadow: "0 2px 14px rgba(0,0,0,.35)" }}>
                  {detail.trip.name}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,.92)", fontSize: 13, fontWeight: 600, mt: 0.75 }}>
                  {buildDateRange(detail.trip)}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                backgroundColor: tokens.card,
              }}
            >
              <Box sx={{ p: "16px 24px", borderRight: "1px solid", borderBottom: { xs: "1px solid", sm: "none" }, borderColor: tokens.border }}>
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.statDuration")}
                </Typography>
                <Typography sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: tokens.ink }}>
                  {formatMessage(t("trips.dashboard.dayCount"), { count: detail.trip.dayCount })}
                </Typography>
              </Box>
              <Box sx={{ p: "16px 24px", borderRight: { xs: "none", sm: "1px solid" }, borderBottom: { xs: "1px solid", sm: "none" }, borderColor: tokens.border }}>
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.statStations")}
                </Typography>
                <Typography sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: tokens.ink }}>
                  {overviewMapData.points.length}
                </Typography>
              </Box>
              <Box
                component={Link}
                href={`/trips/${tripId}/costs`}
                aria-label={t("trips.costOverview.openAria")}
                sx={{
                  p: "16px 24px",
                  borderRight: "1px solid",
                  borderColor: tokens.border,
                  textDecoration: "none",
                  display: "block",
                }}
              >
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.costSummaryTitle")}
                </Typography>
                <Typography sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: theme.palette.primary.main }}>
                  {formatCost(detail.trip.plannedCostTotal)}
                </Typography>
              </Box>
              <Box sx={{ p: "16px 24px" }}>
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.statOpenItems")}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 21,
                    fontWeight: 900,
                    fontVariantNumeric: "tabular-nums",
                    color: openDaysCount > 0 ? theme.palette.warning.main : tokens.ink,
                  }}
                >
                  {openDaysCount}
                </Typography>
              </Box>
            </Box>
          </Box>

          <Box
            data-testid="trip-overview-grid"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" },
              gap: { xs: 2, md: 0 },
            }}
          >
            <Box data-testid="trip-overview-main-column" sx={{ p: { xs: 0, md: "22px 28px 22px 0" } }}>
              <Typography variant="labelCaps" component="h5" sx={{ color: tokens.inkSoft, display: "block", mb: 1.5 }}>
                {t("trips.timeline.title")}
              </Typography>

              {listEmpty && (
                <Typography variant="body2" color="text.secondary">
                  {t("trips.timeline.empty")}
                </Typography>
              )}

              <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
              {!listEmpty &&
                detail.days.map((day, index) => {
                  const previousDay = index > 0 ? detail.days[index - 1] : null;
                  /**
                   * Story 8.5 review (`DW-151`). The day's endpoint order, exactly as `TripDayView`
                   * builds it: last night's stay, the day's activities, this night's stay. Only the
                   * consecutive pairs of it are legs the timeline draws, and only those may be counted.
                   *
                   * This bar renders through the *same* `trips.dayView.ganttSummary` string as the day
                   * view's, so fed every stored row it reported a different "Planned" figure for the
                   * very day the day view lists the extra leg under "Orphaned travel legs" as not
                   * counted — 7h 45m here against 7h 30m there, on this story's own fixture. One rule,
                   * imported, rather than a second local opinion about what is drawn.
                   *
                   * **And the activity order is derived here, not taken from the payload.** This bar
                   * used to read `day.dayPlanItems` in array order, which was correct only because
                   * `getTripWithDaysForUser` sorts each day's activities before serialising them
                   * (`tripRepo.ts`) — the same invisible, unpinned dependency this story removed from
                   * `TripDayView`, left standing on the surface that renders the *same* summary string.
                   * Applying the shared comparator here means both screens compute their drawn set from
                   * an order they own, so they cannot come apart if that mapping ever changes.
                   */
                  const orderedPlanItems = [...day.dayPlanItems].sort((left, right) =>
                    compareDayPlanItemsByStartTime(
                      { fromTime: left.fromTime ?? null, createdAt: left.createdAt ?? "", id: left.id },
                      { fromTime: right.fromTime ?? null, createdAt: right.createdAt ?? "", id: right.id },
                    ),
                  );
                  const dayEndpoints: DaySegmentEndpoint[] = [
                    ...(previousDay?.accommodation
                      ? [{ type: "accommodation" as const, id: previousDay.accommodation.id }]
                      : []),
                    ...orderedPlanItems.map((item) => ({ type: "dayPlanItem" as const, id: item.id })),
                    ...(day.accommodation ? [{ type: "accommodation" as const, id: day.accommodation.id }] : []),
                  ];
                  const drawnPairKeys = buildDrawnDaySegmentPairKeys(dayEndpoints);
                  const drawnTravelSegments = Array.isArray(day.travelSegments)
                    ? day.travelSegments.filter((segment) => isDrawnDaySegment(drawnPairKeys, segment))
                    : [];
                  const ganttSegments = buildOverviewGanttSegments({
                    previousStay: previousDay?.accommodation
                      ? {
                          id: previousDay.accommodation.id,
                          checkOutTime: previousDay.accommodation.checkOutTime ?? null,
                        }
                      : null,
                    currentStay: day.accommodation
                      ? {
                          id: day.accommodation.id,
                          checkInTime: day.accommodation.checkInTime ?? null,
                          checkOutTime: day.accommodation.checkOutTime ?? null,
                        }
                      : null,
                    planItems: orderedPlanItems.map((item) => ({
                      id: item.id,
                      fromTime: item.fromTime ?? null,
                      toTime: item.toTime ?? null,
                    })),
                    travelSegments: drawnTravelSegments.map((segment) => ({
                      id: segment.id,
                      fromItemType: segment.fromItemType,
                      fromItemId: segment.fromItemId,
                      durationMinutes: segment.durationMinutes,
                    })),
                  });
                  const ganttCoverage = deriveCoverageSummary(ganttSegments);
                  // A stay on record with no check-in/out times contributes no accommodation segment,
                  // which would otherwise hatch the whole bar and read as "structurally incomplete" on
                  // a day that actually has a booked place to sleep.
                  const stayLacksTimes =
                    !!day.accommodation && !day.accommodation.checkInTime && !day.accommodation.checkOutTime;
                  // Per AC2 / EXPERIENCE.md: a day with no accommodation shows one oversized gap rather
                  // than several slivers - the bar says "this day is structurally incomplete", not "some
                  // minutes are free". Gaps paint beneath real segments, so the span reads as a backdrop.
                  const gapSegments: TripDayGanttSegment[] = stayLacksTimes
                    ? []
                    : day.missingAccommodation && ganttCoverage.gaps.length > 0
                      ? [
                          {
                            startMinute: ganttCoverage.gaps[0].startMinute,
                            endMinute: ganttCoverage.gaps[ganttCoverage.gaps.length - 1].endMinute,
                            kind: "gap",
                          },
                        ]
                      : ganttCoverage.gaps.map((gap) => ({
                          startMinute: gap.startMinute,
                          endMinute: gap.endMinute,
                          kind: "gap" as const,
                        }));
                  const allSegments: TripDayGanttSegment[] = [...ganttSegments, ...gapSegments];
                  const plannedSummary = formatDurationSummary(ganttCoverage.plannedMinutes);
                  const unplannedSummary = formatDurationSummary(ganttCoverage.unplannedMinutes);
                  const ganttSummary = formatMessage(t("trips.dayView.ganttSummary"), {
                    planned: plannedSummary,
                    unplanned: unplannedSummary,
                  });
                  const isGap = day.missingAccommodation;
                  // One derivation drives `component`, `href`, `target` and `rel` together, so an unsafe
                  // stored value takes the `<span>` path the no-link case already produces rather than
                  // becoming a third state to style. Rows written before the write schema gained its
                  // scheme check still hold `javascript:` and `data:` values, and this row was the one site
                  // that put the stored string straight into `href` - the day view's activity link has
                  // always run the same predicate, so this closes the disagreement rather than adding a
                  // rule.
                  const stayLink =
                    day.accommodation?.link && isSafeLink(day.accommodation.link) ? day.accommodation.link : null;
                  const subLabel = resolveStayLocationLabel(day);
                  const shortDate = formatShortDate(day.date, language);
                  const titleText =
                    day.note && day.note.trim().length > 0
                      ? `${formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}: ${day.note.trim()}`
                      : formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex });

                  return (
                    <Box
                      key={day.id}
                      component="li"
                      data-testid="timeline-day-card"
                      // Read by `tripTimelinePlan.test.tsx` ("keeps timeline cards readable when
                      // viewport changes between mobile and desktop widths", :1120/:1131). This
                      // `useMediaQuery` sits *outside* DW-106's sanction, which covers only a
                      // breakpoint deciding which subtree mounts; it is kept anyway as a declared
                      // jsdom shim per the 2026-08-08 DW-14 decision. It drives no styling: the
                      // layout itself is the sx grid below, keyed to the same constant.
                      data-layout={isNarrowLayout ? "stacked" : "inline"}
                      sx={{
                        position: "relative",
                        display: "grid",
                        // The xs template must name every area the children use: without a "stay" row the
                        // stay/gap indicator resolves against non-existent grid lines and gets auto-placed
                        // into an implicit track, overflowing the row on narrow viewports.
                        //
                        // Both keys below read the same constant the `data-layout` query above is built
                        // from, so the attribute and this grid cannot drift apart. Their emitted
                        // conditions are pinned by `tripTimelineRoles.test.tsx` ("declares the day card's
                        // own column split under the same `sm` condition `data-layout` is keyed to",
                        // :755) - a literal put back here fails there as soon as it names a breakpoint
                        // other than the constant's. Columns, areas and the photo's size are pinned
                        // separately on purpose: moving one alone renders three columns against a
                        // two-column area template, which is the auto-placement overflow above.
                        gridTemplateColumns: { xs: "56px 1fr", [TIMELINE_CARD_LAYOUT_BREAKPOINT]: "72px 1fr 190px" },
                        gridTemplateAreas: {
                          xs: '"photo title" "stay stay" "cov cov"',
                          [TIMELINE_CARD_LAYOUT_BREAKPOINT]: '"photo title stay" "cov cov cov"',
                        },
                        alignItems: "center",
                        gap: "14px",
                        padding: "12px 14px",
                        border: "1px solid",
                        borderColor: isGap ? tokens.warnBorder : tokens.borderStrong,
                        borderRadius: "8px",
                        marginBottom: "8px",
                        backgroundColor: isGap ? tokens.warnBgRow : tokens.card,
                        // Keyboard-only focus: the row is outlined when its navigation link is focused,
                        // without also firing on plain mouse clicks the way :focus-within does.
                        "&:has(:focus-visible)": {
                          outline: `2px solid ${theme.palette.primary.main}`,
                          outlineOffset: 2,
                        },
                      }}
                    >
                      <Box
                        component={Link}
                        href={`/trips/${tripId}/days/${day.id}`}
                        aria-label={formatMessage(t("trips.timeline.openDayNamed"), { day: titleText })}
                        sx={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "8px" }}
                      />

                      <Box
                        component="img"
                        data-testid="day-row-photo"
                        src={resolveDayImageSrc(day.imageUrl, day.updatedAt) ?? "/images/world-map-placeholder.svg"}
                        alt=""
                        sx={{
                          gridArea: "photo",
                          // 56/72 are the grid's own first-column widths above, so the photo takes the
                          // same constant: moving one without the other leaves the photo under- or
                          // over-filling its track. Pinned alongside the templates in the same
                          // `tripTimelineRoles.test.tsx` case, via `day-row-photo`.
                          width: { xs: 56, [TIMELINE_CARD_LAYOUT_BREAKPOINT]: 72 },
                          height: { xs: 56, [TIMELINE_CARD_LAYOUT_BREAKPOINT]: 72 },
                          objectFit: "cover",
                          objectPosition: "center",
                          borderRadius: 0,
                          flexShrink: 0,
                          position: "relative",
                        }}
                      />

                      <Box sx={{ gridArea: "title", display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0, position: "relative" }}>
                        <Typography variant="labelCaps" sx={{ color: tokens.inkSoft }}>
                          <Box component="span" sx={{ color: theme.palette.primary.main }}>
                            {formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}
                          </Box>{" "}
                          {shortDate ? `· ${shortDate}` : null}
                        </Typography>
                        <Typography variant="cardTitle" component="h6" sx={{ color: tokens.ink }}>
                          {titleText}
                        </Typography>
                        {subLabel ? (
                          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                            {subLabel}
                          </Typography>
                        ) : null}
                        {day.missingPlan ? (
                          <Typography variant="body2" sx={{ color: theme.palette.warning.main, fontWeight: 700 }}>
                            {t("trips.timeline.missingPlan")}
                          </Typography>
                        ) : null}
                      </Box>

                      <Box
                        sx={{
                          gridArea: "stay",
                          position: "relative",
                          zIndex: 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: isGap ? "flex-start" : "flex-end",
                          gap: 0.75,
                          // This column paints above the full-row navigation link, so without letting
                          // clicks through, the chevron - the visible "open day" affordance - and the
                          // whole 190px column would be dead zones. Real controls opt back in.
                          pointerEvents: "none",
                          "& a, & button": { pointerEvents: "auto" },
                        }}
                      >
                        {isGap ? (
                          <Box
                            data-testid="day-row-gap-pill"
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
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
                        ) : day.accommodation ? (
                          <Box
                            component={stayLink ? "a" : "span"}
                            href={stayLink ?? undefined}
                            target={stayLink ? "_blank" : undefined}
                            rel={stayLink ? "noreferrer noopener" : undefined}
                            data-testid="day-row-stay"
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 0.75,
                              color: theme.palette.primary.main,
                              fontSize: "11.5px",
                              fontWeight: 700,
                              textDecoration: "none",
                              minWidth: 0,
                            }}
                          >
                            <HouseIcon sx={{ flexShrink: 0 }} />
                            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {day.accommodation.name}
                            </Box>
                          </Box>
                        ) : null}
                        <ChevronRightIcon sx={{ color: tokens.inkMuted, flexShrink: 0 }} />
                      </Box>

                      <Box
                        sx={{
                          gridArea: "cov",
                          position: "relative",
                          zIndex: 2,
                          display: "flex",
                          flexDirection: "column",
                          gap: 0.5,
                          // Non-interactive, but painted above the row link - pass clicks through.
                          pointerEvents: "none",
                        }}
                      >
                        <TripDayGanttBar segments={allSegments} ariaLabel={t("trips.dayView.ganttAriaLabel")} variant="compact" />
                        <Typography variant="caption" sx={{ color: tokens.inkSoft }}>
                          {ganttSummary}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>

              {/* Two-column layout only: last block of the day column, so it lines up with the day
                  rows above it. The column's own padding sets the width - a `width`/`maxWidth`/
                  margin here would drift the moment the grid changes - and the rows already end
                  with their 8px `marginBottom`, this column's spacing rhythm, so a margin would
                  stack a second gap on top of it. Below `md` this position is empty and the same
                  element mounts after the side column instead. */}
              {isTwoColumnLayout ? tripControlsCard : null}
            </Box>

            <Box
              data-testid="trip-overview-side-column"
              sx={{ p: { xs: 0, md: "22px 0 22px 22px" }, borderLeft: { xs: "none", md: "1px solid" }, borderColor: tokens.border }}
            >
              <Box sx={{ backgroundColor: tokens.card, border: "1px solid", borderColor: tokens.borderStrong, borderRadius: "8px", padding: "18px", mb: 2 }}>
                <Typography variant="labelCaps" component="h5" sx={{ color: tokens.inkSoft, display: "block", mb: 1.25 }}>
                  {t("trips.timeline.costSummaryTitle")}
                </Typography>
                <Typography variant="metricLg" sx={{ color: tokens.ink, fontVariantNumeric: "tabular-nums" }}>
                  {formatCost(detail.trip.plannedCostTotal)}
                </Typography>
                <Typography variant="body2" sx={{ color: tokens.inkSoft, mb: 1.5, display: "block" }}>
                  {t("trips.timeline.costSummarySubtitle")}
                </Typography>
                {/* Divider via :last-child so adding a third row (travel costs, once the schema carries
                    them) does not leave a trailing rule the way a per-row hardcode would. */}
                <Box sx={{ "& > div:last-child": { borderBottom: "none" } }}>
                  {[
                    { key: "accommodation", label: t("trips.timeline.costAccommodationLine"), value: accommodationCostTotal },
                    { key: "activities", label: t("trips.timeline.costActivitiesLine"), value: activitiesCostTotal },
                  ].map((row) => (
                    <Box
                      key={row.key}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        py: 1,
                        borderBottom: "1px solid",
                        borderColor: tokens.border,
                      }}
                    >
                      <Typography sx={{ fontSize: "12.5px", fontWeight: 600, color: tokens.ink }}>{row.label}</Typography>
                      <Typography
                        sx={{ fontSize: "12.5px", color: tokens.ink, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}
                      >
                        {formatCost(row.value)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <TripOverviewMapPanel
                points={overviewMapData.points}
                missingLocations={overviewMapData.missingLocations}
                polylinePositions={overviewMapData.polylinePositions}
                expandHref={`/trips/${tripId}/map`}
              />

              {/* Third sidebar card, after the map panel. The panel brings its own card shell
                  (Story 7.8), so the wrapper carries spacing only - a bordered wrapper here would
                  double the edge. The side column has no flex gap: its rhythm is the sibling
                  `mb: 2` / `mt: 2` used by the cost card and the gap alert, so this joins that same
                  16px rule rather than introducing a second spacing scale.

                  `canEditPlanning` as of Story 5.13: all four bucket-list verbs moved to
                  owner-or-contributor, so this panel mirrors its route again. A viewer still gets
                  nothing, which is the same answer the route would give her. */}
              {canEditPlanning ? (
                <Box sx={{ mt: 2 }}>
                  <TripBucketListPanel tripId={detail.trip.id} />
                </Box>
              ) : null}

              {firstGapDay ? (
                <Box
                  sx={{
                    mt: 2,
                    border: "1px solid",
                    borderColor: tokens.warnBorder,
                    backgroundColor: tokens.warnBg,
                    borderRadius: "8px",
                    padding: "14px 16px",
                    display: "flex",
                    gap: 1.25,
                    alignItems: "flex-start",
                  }}
                >
                  <WarningTriangleIcon sx={{ color: theme.palette.warning.main, fontSize: 18, mt: "1px" }} />
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 800, color: theme.palette.warning.main, mb: 0.5 }}>
                      {formatMessage(t("trips.timeline.gapAlertTitle"), { dayIndex: firstGapDay.dayIndex })}
                    </Typography>
                    <Typography sx={{ fontSize: "11.5px", color: tokens.ink, fontWeight: 500 }}>
                      {formatMessage(t("trips.timeline.gapAlertBody"), {
                        dayIndex: firstGapDay.dayIndex,
                        date: formatDate(firstGapDay.date),
                      })}
                    </Typography>
                  </Box>
                </Box>
              ) : null}
            </Box>

            {/* Single-column layout only: a third grid child, after the side column, so the two
                actions nobody reaches for end the page instead of interrupting it. Staying inside
                the grid is deliberate - the card gets the grid's own `1fr` track and its own
                `gap: { xs: 2 }`, so it is width-constrained exactly the way the columns are
                (both carry `p: { xs: 0 }`) and needs no width, margin or wrapper of its own.
                Rendering it after the grid instead would reintroduce the loose full-width block
                Stories 7.12 and 6.10 removed. At `md` and above this position is empty, so nothing
                follows the side column and the desktop tree is exactly what Story 6.10 left. */}
            {isTwoColumnLayout ? null : tripControlsCard}
          </Box>
        </>
      )}

      {detail && (
        <>
          {/* `isOwner` and not `canEditPlanning`: the Edit button above opens this for a contributor
              too, because renaming the trip and moving its dates are hers to do - the hero image is
              not (Story 5.13), so the dialog is told which of its two writes she may perform. */}
          <TripEditDialog
            open={editOpen}
            trip={detail.trip}
            canEditHeroImage={isOwner}
            onClose={handleEditClose}
            onUpdated={handleUpdated}
          />
          <TripDeleteDialog
            open={deleteOpen}
            tripId={detail.trip.id}
            tripName={detail.trip.name}
            onClose={handleDeleteClose}
            onDeleted={handleDeleted}
          />
          <TripShareDialog
            key={`share-${shareDialogKey}`}
            open={shareOpen}
            tripId={detail.trip.id}
            tripName={detail.trip.name}
            onClose={() => setShareOpen(false)}
          />
        </>
      )}
    </Box>
  );
}
