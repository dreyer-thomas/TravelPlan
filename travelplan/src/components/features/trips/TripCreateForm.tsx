"use client";

import { useEffect, useId, useMemo, useState, type FocusEvent } from "react";
import { useForm } from "react-hook-form";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/trips/imageUploads";

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
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
};

export default function TripCreateForm({
  onCreated,
  onSuccess,
  onSubmittingChange,
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
    formState: { errors, isSubmitting },
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

  const handleLookupLocation = async (kind: "start" | "destination") => {
    const query = (kind === "start" ? startLocationQuery : destinationLocationQuery).trim();
    if (!query) {
      if (kind === "start") {
        setStartLocationError(t("trips.location.searchRequired"));
      } else {
        setDestinationLocationError(t("trips.location.searchRequired"));
      }
      return;
    }

    if (kind === "start") {
      setStartLookupLoading(true);
      setStartLocationError(null);
    } else {
      setDestinationLookupLoading(true);
      setDestinationLocationError(null);
    }

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        method: "GET",
        credentials: "include",
      });
      const body = (await response.json()) as ApiEnvelope<{
        result: { lat: number; lng: number; label: string } | null;
      }>;

      if (!response.ok || body.error) {
        const message = body.error?.message ?? t("trips.location.lookupError");
        if (kind === "start") {
          setStartLocationError(message);
        } else {
          setDestinationLocationError(message);
        }
        return;
      }

      if (!body.data?.result) {
        if (kind === "start") {
          setStartLocationError(t("trips.location.noResult"));
        } else {
          setDestinationLocationError(t("trips.location.noResult"));
        }
        return;
      }

      if (kind === "start") {
        setStartLocation({
          lat: body.data.result.lat,
          lng: body.data.result.lng,
          label: body.data.result.label,
        });
        setStartLocationQuery(body.data.result.label);
      } else {
        setDestinationLocation({
          lat: body.data.result.lat,
          lng: body.data.result.lng,
          label: body.data.result.label,
        });
        setDestinationLocationQuery(body.data.result.label);
      }
    } catch {
      if (kind === "start") {
        setStartLocationError(t("trips.location.lookupError"));
      } else {
        setDestinationLocationError(t("trips.location.lookupError"));
      }
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
                }}
                error={startLocationError ?? undefined}
                hint={startLocationError ? undefined : t("trips.form.locationHelper")}
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
              }}
              disabled={isSubmitting || startLookupLoading || (!startLocation && !startLocationQuery)}
              sx={{ mb: "23px" }}
            >
              {t("trips.location.clearAction")}
            </Button>
          </Box>
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
                }}
                error={destinationLocationError ?? undefined}
                hint={destinationLocationError ? undefined : t("trips.form.locationHelper")}
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
              }}
              disabled={isSubmitting || destinationLookupLoading || (!destinationLocation && !destinationLocationQuery)}
              sx={{ mb: "23px" }}
            >
              {t("trips.location.clearAction")}
            </Button>
          </Box>
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
          {...register("heroImage")}
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
