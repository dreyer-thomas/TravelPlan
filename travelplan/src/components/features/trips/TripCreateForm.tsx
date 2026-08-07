"use client";

import { useEffect, useId, useMemo, useState, type FocusEvent } from "react";
import { useForm } from "react-hook-form";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import LocationCandidateList from "@/components/features/trips/LocationCandidateList";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/trips/imageUploads";
import { formatCoordinateLabel, parseLocationInput } from "@/lib/trips/parseLocationInput";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripCreateFormValues = {
  name: string;
  startDate: string;
  endDate: string;
  heroImage?: FileList;
};

type HeroUploadResult = {
  trip: { id: string; heroImageUrl: string | null; updatedAt?: string };
};

export type TripCreateResponse = {
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    heroImageUrl?: string | null;
    /** Versions the hero URL for the consumer; see `withImageCacheBuster`. */
    updatedAt?: string;
    startLocation?: { lat: number; lng: number; label: string | null } | null;
    destinationLocation?: { lat: number; lng: number; label: string | null } | null;
  };
  dayCount: number;
};

const toIsoUtc = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();

const normalizeDateInput = (value: string) => {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed;
};

const isValidDateInput = (value: string) => {
  const normalized = normalizeDateInput(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return false;
  }
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    Number.isFinite(year) &&
    Number.isFinite(month) &&
    Number.isFinite(day) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export type TripCreateFormProps = {
  onCreated?: (trip: TripCreateResponse) => void;
  onSuccess?: () => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  /**
   * Story 6.25 AC7. Whether this form holds input the user would lose, reported up the same way
   * `onSubmittingChange` reports its other cross-boundary flag — the dialog that wraps this form owns
   * the `✕`, so it is the one that has to know whether dismissing it costs anything. The standalone
   * mount (`/trips/new`) simply does not pass it.
   */
  onDirtyChange?: (isDirty: boolean) => void;
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
};

export default function TripCreateForm({
  onCreated,
  onSuccess,
  onSubmittingChange,
  onDirtyChange,
  formId,
  submitLabel,
  showSubmit = true,
}: TripCreateFormProps) {
  const { t } = useI18n();
  // The only two additions above the return: the label/input `htmlFor`/`id` pairing needs a stable
  // unique prefix (this form is mounted both standalone and inside the create dialog), and the
  // coordinate read-out needs a token. No behaviour above this point changed.
  const fieldIdPrefix = useId();
  const { tokens } = useTheme().palette;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
    setError,
    setValue,
    reset,
  } = useForm<TripCreateFormValues>({
    defaultValues: {
      name: "",
      startDate: "",
      endDate: "",
    },
  });

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [startLocationQuery, setStartLocationQuery] = useState("");
  const [destinationLocationQuery, setDestinationLocationQuery] = useState("");
  const [startLocation, setStartLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [destinationLocation, setDestinationLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [startLookupLoading, setStartLookupLoading] = useState(false);
  const [destinationLookupLoading, setDestinationLookupLoading] = useState(false);
  const [startLocationError, setStartLocationError] = useState<string | null>(null);
  const [destinationLocationError, setDestinationLocationError] = useState<string | null>(null);
  /**
   * Story 6.28 AC5. One candidate list per end of the trip, kept in two slots rather than one keyed by
   * `kind`: this form's eight existing location slots are flat for the same reason, and a shared list
   * would make a search for the destination dismiss an unanswered question about the start.
   */
  const [startCandidates, setStartCandidates] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [destinationCandidates, setDestinationCandidates] = useState<{ lat: number; lng: number; label: string }[]>([]);

  useEffect(() => {
    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error) {
          setServerError(t("trips.create.initError"));
          return;
        }

        if (body.data?.csrfToken) {
          setCsrfToken(body.data.csrfToken);
          return;
        }

        setServerError(t("trips.create.initError"));
      } catch {
        setServerError(t("trips.create.initError"));
      }
    };

    fetchCsrf();
  }, []);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  /**
   * **`dirtyFields`, not `isDirty` — and this is a browser finding, not a preference.**
   *
   * `isDirty` is `true` from the first render of this form, with `dirtyFields` empty. react-hook-form
   * derives it by deep-comparing the live values against `defaultValues`, and `heroImage` is a
   * registered file input whose value is an empty `FileList` while the defaults do not mention it at
   * all. A `FileList` never compares equal to `undefined`, so the flag latches on mount and can never
   * clear. Measured in a browser at 390px: an untouched "Neue Reise" dialog raised "Änderungen
   * verwerfen?" on its own `✕`. jsdom does not reproduce it — its empty file input compares equal —
   * which is exactly why this was invisible to the suite and had to be caught on screen.
   *
   * `dirtyFields` is populated per field by react-hook-form's own change handling and stays empty until
   * something actually changes, so it is the honest signal. It does **not** cover the file input (a
   * FileList change is not a value diff it can record either), hence `heroImageSelected` below.
   *
   * The two `*LocationQuery` boxes are deliberately absent: they are search inputs whose text no save
   * persists, and Story 6.24 found that watching one makes a form read dirty for nothing. What a lookup
   * *resolves* to does travel with the trip, so those two count.
   */
  const [heroImageSelected, setHeroImageSelected] = useState(false);
  const heroImageField = register("heroImage");

  useEffect(() => {
    onDirtyChange?.(
      Object.keys(dirtyFields).length > 0 ||
        heroImageSelected ||
        startLocation !== null ||
        destinationLocation !== null,
    );
  }, [destinationLocation, dirtyFields, heroImageSelected, onDirtyChange, startLocation]);

  const onSubmit = async (values: TripCreateFormValues) => {
    setServerError(null);
    setSuccess(null);
    setStartLocationError(null);
    setDestinationLocationError(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const hasStartInput = startLocationQuery.trim().length > 0 || startLocation !== null;
    const hasDestinationInput = destinationLocationQuery.trim().length > 0 || destinationLocation !== null;

    if (hasStartInput || hasDestinationInput) {
      if (!startLocation || !destinationLocation) {
        if (!startLocation) {
          setStartLocationError(t("trips.form.locationResolveError"));
        }
        if (!destinationLocation) {
          setDestinationLocationError(t("trips.form.locationResolveError"));
        }
        return;
      }
    }

    const payload = {
      name: values.name,
      startDate: toIsoUtc(normalizeDateInput(values.startDate)),
      endDate: toIsoUtc(normalizeDateInput(values.endDate)),
      ...(startLocation && destinationLocation
        ? {
            startLocation,
            destinationLocation,
          }
        : {}),
    };

    const response = await fetch("/api/trips", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as ApiEnvelope<TripCreateResponse>;

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            if (field === "startLocation") {
              setStartLocationError(messages[0]);
              return;
            }
            if (field === "destinationLocation") {
              setDestinationLocationError(messages[0]);
              return;
            }
            setError(field as keyof TripCreateFormValues, { message: messages[0] });
          }
        });
        return;
      }

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
            return t("trips.create.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    if (body.data) {
      let heroImageUrl = body.data.trip.heroImageUrl ?? null;
      // Carried through so the consumer can version the hero URL; the upload bumps `updatedAt`.
      let heroUpdatedAt = body.data.trip.updatedAt;
      const file = values.heroImage?.item(0);
      let uploadFailed = false;

      if (file) {
        const formData = new FormData();
        formData.set("file", file);
        const uploadResponse = await fetch(`/api/trips/${body.data.trip.id}/hero-image`, {
          method: "POST",
          credentials: "include",
          headers: {
            "x-csrf-token": csrfToken,
          },
          body: formData,
        });

        let uploadBody: ApiEnvelope<HeroUploadResult> | null = null;
        try {
          uploadBody = (await uploadResponse.json()) as ApiEnvelope<HeroUploadResult>;
        } catch {
          uploadBody = null;
        }

        if (!uploadResponse.ok || !uploadBody || uploadBody.error) {
          uploadFailed = true;
          setServerError(t("trips.create.uploadError"));
        } else {
          // Raw URL plus version, not a pre-stamped URL - the read paths stamp it themselves, so
          // stamping here too would double-stamp into `?v=A&v=B`.
          heroImageUrl = uploadBody.data?.trip.heroImageUrl ?? null;
          heroUpdatedAt = uploadBody.data?.trip.updatedAt ?? heroUpdatedAt;
        }
      }

      setSuccess(
        formatMessage(t("trips.create.success"), {
          count: body.data.dayCount,
        }),
      );
      reset({ name: "", startDate: "", endDate: "" });
      // Cleared with the rest of the form: `reset` does not know about this flag, and a `true` left
      // behind would make the *next* untouched form ask about changes that were already saved.
      setHeroImageSelected(false);
      setStartLocationQuery("");
      setDestinationLocationQuery("");
      setStartLocation(null);
      setDestinationLocation(null);
      onCreated?.({
        ...body.data,
        trip: {
          ...body.data.trip,
          heroImageUrl,
          updatedAt: heroUpdatedAt,
        },
      });
      if (!uploadFailed) {
        onSuccess?.();
      }
    }
  };

  const nameRules = useMemo(
    () => ({
      required: t("trips.form.nameRequired"),
    }),
    [t],
  );

  const dateRules = useMemo(
    () => ({
      required: t("trips.form.dateRequired"),
      validate: (value: string) => (isValidDateInput(value) ? true : t("trips.form.dateInvalid")),
    }),
    [t],
  );

  const handleDateBlur = (field: "startDate" | "endDate") => (event: FocusEvent<HTMLInputElement>) => {
    const normalized = normalizeDateInput(event.target.value);
    if (normalized !== event.target.value) {
      setValue(field, normalized, { shouldValidate: true, shouldDirty: true });
    }
  };

  /**
   * Story 6.28 AC5. Activating a candidate row for one end of the trip: store it, write its label into
   * that end's search box, and dismiss that end's list. The two ends never share state — the form can
   * legitimately hold an unanswered question about the destination while the start is already resolved.
   */
  const selectLocationCandidate = (kind: "start" | "destination", candidate: { lat: number; lng: number; label: string }) => {
    if (kind === "start") {
      setStartLocation(candidate);
      setStartLocationQuery(candidate.label);
      setStartCandidates([]);
      return;
    }
    setDestinationLocation(candidate);
    setDestinationLocationQuery(candidate.label);
    setDestinationCandidates([]);
  };

  /**
   * Story 6.28, the same order as `TripDayPlanDialog`'s canonical copy — parse before the fetch, so a
   * coordinate pair or a pasted Google Maps link resolves with no network request at all.
   *
   * Unlike the three dialogs, this surface already has a per-field error channel, so every parse failure
   * goes to `setStartLocationError` / `setDestinationLocationError` rather than to the form-level notice:
   * the message is about one of two boxes, and the form banner cannot say which.
   */
  const handleLookupLocation = async (kind: "start" | "destination") => {
    const query = (kind === "start" ? startLocationQuery : destinationLocationQuery).trim();
    const setLocationError = kind === "start" ? setStartLocationError : setDestinationLocationError;
    if (!query) {
      setLocationError(t("trips.location.searchRequired"));
      return;
    }

    setLocationError(null);
    if (kind === "start") {
      setStartCandidates([]);
    } else {
      setDestinationCandidates([]);
    }

    const parsed = parseLocationInput(query);
    if (parsed.status === "ambiguous") {
      setLocationError(t("trips.location.coordinatesAmbiguous"));
      return;
    }
    if (parsed.status === "out_of_range") {
      setLocationError(t(parsed.field === "lat" ? "trips.location.latInvalid" : "trips.location.lngInvalid"));
      return;
    }
    if (parsed.status === "coordinates") {
      // The query box is deliberately left as typed. Its `onChange` nulls the location on every
      // keystroke, so writing the formatted pair back would be a second, pointless invalidation round.
      const location = {
        lat: parsed.lat,
        lng: parsed.lng,
        label: formatCoordinateLabel(parsed.lat, parsed.lng),
      };
      if (kind === "start") {
        setStartLocation(location);
      } else {
        setDestinationLocation(location);
      }
      return;
    }

    if (kind === "start") {
      setStartLookupLoading(true);
    } else {
      setDestinationLookupLoading(true);
    }

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        method: "GET",
        credentials: "include",
      });
      const body = (await response.json()) as ApiEnvelope<{
        results: { lat: number; lng: number; label: string }[];
      }>;

      if (!response.ok || body.error) {
        setLocationError(body.error?.message ?? t("trips.location.lookupError"));
        return;
      }

      const results = body.data?.results ?? [];
      if (results.length === 0) {
        setLocationError(t("trips.location.noResult"));
        return;
      }

      if (results.length === 1) {
        selectLocationCandidate(kind, results[0]);
        return;
      }

      if (kind === "start") {
        setStartCandidates(results);
      } else {
        setDestinationCandidates(results);
      }
    } catch {
      setLocationError(t("trips.location.lookupError"));
    } finally {
      if (kind === "start") {
        setStartLookupLoading(false);
      } else {
        setDestinationLookupLoading(false);
      }
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {/*
        Not MUI's `Alert`. The original reason - theme.ts had no `error` palette entry, so
        `severity="error"` fell back to #d32f2f - was closed by Story 7.11, which added one. This stays
        on `FormNotice` because DESIGN.md's treatment for a form-level notice is the warn family, and
        choosing between the app's two error idioms is a UX decision made elsewhere, not here. See
        `FormNotice`'s docblock. It keeps the `role="alert"` semantics either way.
      */}
      {serverError && <FormNotice tone="warn" message={serverError} />}
      {success && <FormNotice tone="success" message={success} />}

      <Box
        component="form"
        id={formId}
        onSubmit={handleSubmit(onSubmit)}
        display="flex"
        flexDirection="column"
        gap="18px"
      >
        <FormField
          id={`${fieldIdPrefix}-name`}
          label={t("trips.form.name")}
          placeholder={t("trips.form.namePlaceholder")}
          error={errors.name?.message}
          {...register("name", nameRules)}
        />
        {/*
          Screen F's `.field-row` — the two dates read as one "Zeitraum" pair. Stacks at xs; pure sx
          breakpoints, never useMediaQuery. `type="date"` stays: the tests type "2026-02-10" and
          `handleDateBlur` normalizes DD.MM.YYYY. The native control draws its own calendar affordance,
          so the mockup's `.icon-suffix` glyph is not added on top of it.
        */}
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: "12px",
            "& > *": { flex: 1, minWidth: 0 },
          }}
        >
          <FormField
            id={`${fieldIdPrefix}-start-date`}
            label={t("trips.form.startDate")}
            type="date"
            error={errors.startDate?.message}
            {...register("startDate", dateRules)}
            onBlur={handleDateBlur("startDate")}
          />
          <FormField
            id={`${fieldIdPrefix}-end-date`}
            label={t("trips.form.endDate")}
            type="date"
            error={errors.endDate?.message}
            {...register("endDate", dateRules)}
            onBlur={handleDateBlur("endDate")}
          />
        </Box>
        <Box display="flex" flexDirection="column" gap={1}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "stretch", sm: "flex-end" },
              gap: "8px",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <FormField
                id={`${fieldIdPrefix}-start-location`}
                label={t("trips.form.startLocation")}
                value={startLocationQuery}
                onChange={(event) => {
                  setStartLocationQuery(event.target.value);
                  setStartLocation(null);
                  setStartLocationError(null);
                  // Story 6.28 review, and the same reason the pin above is nulled: the rows answer the
                  // text as it was, so they must not outlive an edit of it.
                  setStartCandidates([]);
                }}
                error={startLocationError ?? undefined}
                // Story 6.28 AC7 replaced this form's own deleted helper key ("Search and select a place")
                // with the shared `searchHelper`, which says the same thing and states the coordinate
                // spelling and the latitude-first order as well. One helper on all five place fields.
                hint={startLocationError ? undefined : t("trips.location.searchHelper")}
              />
            </Box>
            {/* Both buttons are already ≥44px from theme.ts's MuiButton override. */}
            <Button
              variant="outlined"
              onClick={() => void handleLookupLocation("start")}
              disabled={isSubmitting || startLookupLoading}
              sx={{ mb: "23px" }}
            >
              {startLookupLoading ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setStartLocation(null);
                setStartLocationQuery("");
                setStartLocationError(null);
                setStartCandidates([]);
              }}
              disabled={isSubmitting || startLookupLoading || (!startLocation && !startLocationQuery)}
              sx={{ mb: "23px" }}
            >
              {t("trips.location.clearAction")}
            </Button>
          </Box>
          <LocationCandidateList
            candidates={startCandidates}
            onSelect={(candidate) => selectLocationCandidate("start", candidate)}
            disabled={isSubmitting || startLookupLoading}
            idPrefix={`${fieldIdPrefix}-start-location`}
          />
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft }}>
            {startLocation
              ? `${t("trips.location.latLabel")}: ${startLocation.lat.toFixed(6)} · ${t("trips.location.lngLabel")}: ${startLocation.lng.toFixed(6)}`
              : t("trips.location.noCoordinates")}
          </Typography>
        </Box>
        <Box display="flex" flexDirection="column" gap={1}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "stretch", sm: "flex-end" },
              gap: "8px",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <FormField
                id={`${fieldIdPrefix}-destination-location`}
                label={t("trips.form.destinationLocation")}
                value={destinationLocationQuery}
                onChange={(event) => {
                  setDestinationLocationQuery(event.target.value);
                  setDestinationLocation(null);
                  setDestinationLocationError(null);
                  // Story 6.28 review: same as the start field one block up.
                  setDestinationCandidates([]);
                }}
                error={destinationLocationError ?? undefined}
                hint={destinationLocationError ? undefined : t("trips.location.searchHelper")}
              />
            </Box>
            <Button
              variant="outlined"
              onClick={() => void handleLookupLocation("destination")}
              disabled={isSubmitting || destinationLookupLoading}
              sx={{ mb: "23px" }}
            >
              {destinationLookupLoading ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setDestinationLocation(null);
                setDestinationLocationQuery("");
                setDestinationLocationError(null);
                setDestinationCandidates([]);
              }}
              disabled={isSubmitting || destinationLookupLoading || (!destinationLocation && !destinationLocationQuery)}
              sx={{ mb: "23px" }}
            >
              {t("trips.location.clearAction")}
            </Button>
          </Box>
          <LocationCandidateList
            candidates={destinationCandidates}
            onSelect={(candidate) => selectLocationCandidate("destination", candidate)}
            disabled={isSubmitting || destinationLookupLoading}
            idPrefix={`${fieldIdPrefix}-destination-location`}
          />
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft }}>
            {destinationLocation
              ? `${t("trips.location.latLabel")}: ${destinationLocation.lat.toFixed(6)} · ${t("trips.location.lngLabel")}: ${destinationLocation.lng.toFixed(6)}`
              : t("trips.location.noCoordinates")}
          </Typography>
        </Box>
        {/*
          Kept as a FormField rather than converted to PhotoUploadField: `register("heroImage")`
          returns the ref/name/onChange triple react-hook-form needs on the *input itself*, and
          `onSubmit` reads `values.heroImage` as a FileList. A dropzone wrapper would have to re-derive
          that plumbing for a surface that has no existing preview to show — a functional change AC2
          forbids. The galleries and the day-image field, which do preview, use the dropzone.
        */}
        <FormField
          id={`${fieldIdPrefix}-hero-image`}
          label={t("trips.form.heroImage")}
          type="file"
          slotProps={{ htmlInput: { accept: IMAGE_UPLOAD_ACCEPT } }}
          hint={t("trips.form.heroImageHelper")}
          {...heroImageField}
          // Story 6.25. react-hook-form's own `onChange` still runs — it is what puts the FileList into
          // `values.heroImage` for `onSubmit`; this only adds the one bit `dirtyFields` cannot carry, so
          // a staged photo counts as something to lose. See the note on the dirty effect above.
          onChange={(event) => {
            void heroImageField.onChange(event);
            setHeroImageSelected(Boolean((event.target as HTMLInputElement).files?.length));
          }}
        />
        {showSubmit && (
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : submitLabel ?? t("trips.create.submit")}
          </Button>
        )}
      </Box>
    </Box>
  );
}
