"use client";

import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
} from "@mui/material";
import { useI18n } from "@/i18n/provider";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/trips/imageUploads";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type HeroUploadResult = {
  trip: { id: string; heroImageUrl: string | null; updatedAt?: string };
};

type TripSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl?: string | null;
  /** Versions the hero URL for the consumer; see `withImageCacheBuster`. */
  updatedAt?: string;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation?: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
  } | null;
};

export type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripEditFormValues = {
  name: string;
  startDate: string;
  endDate: string;
  heroImage?: FileList;
};

type TripEditDialogProps = {
  open: boolean;
  trip: TripSummary;
  /**
   * Story 5.13. The trip `PATCH` this dialog performs is owner-or-contributor, so `TripTimeline` opens
   * the dialog for both roles - but `POST /api/trips/[id]/hero-image` is owner-only and stays that way:
   * the hero is the trip's identity on someone else's dashboard card, not content of a day.
   *
   * Before this prop existed the dialog had no role conditional at all, so a contributor was shown a
   * hero-image field, submitted it, and got a bare `trips.edit.uploadError` while the name and dates
   * beside it committed. That is DW-182's shape exactly - a control on screen, a route that refuses,
   * and a message that names neither - so the field and the upload are both suppressed here rather
   * than only the field: a stale `FileList` must not be able to reach a route that will refuse it.
   */
  canEditHeroImage: boolean;
  onClose: () => void;
  onUpdated: (detail: TripDetail) => void;
};

const toIsoUtc = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();
const toDateInput = (value: string) => value.slice(0, 10);
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

export default function TripEditDialog({ open, trip, canEditHeroImage, onClose, onUpdated }: TripEditDialogProps) {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
    setError,
    setValue,
    reset,
  } = useForm<TripEditFormValues>({
    defaultValues: {
      name: trip.name,
      startDate: toDateInput(trip.startDate),
      endDate: toDateInput(trip.endDate),
    },
  });

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  /**
   * Story 6.25 AC7 / EXPERIENCE.md.State Patterns → "Dismissing a dialog with unsaved input".
   *
   * The open effect below `reset()`s to the trip's current values, which is what makes `dirtyFields`
   * mean "differs from what this dialog opened with" rather than "differs from the mount".
   *
   * **`dirtyFields`, not `isDirty`, and that is a browser finding.** `isDirty` deep-compares the live
   * values against the defaults, and `heroImage` is a registered file input whose value is an empty
   * `FileList` while the defaults do not mention it — a comparison that can never come out equal, so
   * the flag latches on the first render and never clears. `TripCreateForm` carries the full note and
   * the measurement; the same two lines of code produce the same defect here.
   *
   * `dirtyFields` cannot carry a `FileList` change either, hence `heroImageSelected` — a
   * staged-but-unuploaded photo has to count, being the one field with nothing on the server behind it.
   */
  const [heroImageSelected, setHeroImageSelected] = useState(false);

  /*
    Cleared on every open, and during render rather than in the open effect below — React's own
    prescription for resetting state when a prop changes, and what keeps this out of the
    cascading-render lint (`react-hooks/set-state-in-effect`). It also clears *before* the render that
    could raise the question, where an effect would clear it one render later. The same idiom is used
    for the day menu's anchor in `TripDayView`.

    A `true` left behind would make the next untouched open ask about a photo already uploaded.
  */
  const [openMarker, setOpenMarker] = useState(open);
  if (openMarker !== open) {
    setOpenMarker(open);
    setHeroImageSelected(false);
  }

  const heroImageField = register("heroImage");
  const editGuard = useDiscardGuard(Object.keys(dirtyFields).length > 0 || heroImageSelected, onClose);

  useEffect(() => {
    if (!open) return;
    reset({
      name: trip.name,
      startDate: toDateInput(trip.startDate),
      endDate: toDateInput(trip.endDate),
    });
  }, [open, reset, trip]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setServerError(body.error?.message ?? t("trips.edit.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.edit.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open]);

  const onSubmit = async (values: TripEditFormValues) => {
    setServerError(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const payload = {
      name: values.name,
      startDate: toIsoUtc(normalizeDateInput(values.startDate)),
      endDate: toIsoUtc(normalizeDateInput(values.endDate)),
    };

    const response = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as ApiEnvelope<TripDetail>;

    if (!response.ok || body.error || !body.data) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof TripEditFormValues, { message: messages[0] });
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
            return t("trips.edit.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    let heroImageUrl = body.data.trip.heroImageUrl ?? null;
    // Carried through so the consumer can version the hero URL. The upload bumps the trip's
    // `updatedAt`, so the value from the upload response is newer than the one on the PATCH body.
    let heroUpdatedAt = body.data.trip.updatedAt;
    // `canEditHeroImage &&`, not just the hidden field. `register("heroImage")` above runs unconditionally,
    // so the field stays registered for a contributor and is merely never mounted - which is exactly why
    // this guard cannot be left to the rendering. The request is the thing that must not happen, and
    // stating it here keeps the guard standing if the field is ever mounted, moved, or given
    // `shouldUnregister`.
    const file = canEditHeroImage ? values.heroImage?.item(0) : undefined;
    let uploadFailed = false;

    if (file) {
      const formData = new FormData();
      formData.set("file", file);
      const uploadResponse = await fetch(`/api/trips/${trip.id}/hero-image`, {
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
        setServerError(t("trips.edit.uploadError"));
      } else {
        // Hand the consumer the raw URL plus its version rather than a pre-stamped URL: every read
        // path now versions the hero itself (see `TripTimeline`/`TripsDashboard`), so stamping here
        // too would double-stamp it into `?v=A&v=B`.
        heroImageUrl = uploadBody.data?.trip.heroImageUrl ?? null;
        heroUpdatedAt = uploadBody.data?.trip.updatedAt ?? heroUpdatedAt;
      }
    }

    onUpdated({
      ...body.data,
      trip: {
        ...body.data.trip,
        heroImageUrl,
        updatedAt: heroUpdatedAt,
      },
    });
    if (!uploadFailed) {
      onClose();
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

  return (
    <>
      <Dialog open={open} onClose={editGuard.requestClose} fullWidth maxWidth="sm">
        <DialogTitleWithClose label={t("common.close")} onClose={editGuard.requestClose} disabled={isSubmitting}>
          {t("trips.edit.title")}
        </DialogTitleWithClose>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2.5}>
            {serverError && <Alert severity="error">{serverError}</Alert>}
            <Box
              component="form"
              id="trip-edit-form"
              onSubmit={handleSubmit(onSubmit)}
              display="flex"
              flexDirection="column"
              gap={2}
            >
              <TextField
                label={t("trips.form.name")}
                error={Boolean(errors.name)}
                helperText={errors.name?.message}
                {...register("name", nameRules)}
                fullWidth
              />
              <TextField
                label={t("trips.form.startDate")}
                type="date"
                error={Boolean(errors.startDate)}
                helperText={errors.startDate?.message}
                InputLabelProps={{ shrink: true }}
                {...register("startDate", dateRules)}
                onBlur={handleDateBlur("startDate")}
                fullWidth
              />
              <TextField
                label={t("trips.form.endDate")}
                type="date"
                error={Boolean(errors.endDate)}
                helperText={errors.endDate?.message}
                InputLabelProps={{ shrink: true }}
                {...register("endDate", dateRules)}
                onBlur={handleDateBlur("endDate")}
                fullWidth
              />
              {/* Story 5.13: hidden for a contributor, who reaches this dialog through the Edit button
                  (gated `canEditPlanning`) but whose hero upload the route refuses. See the prop. */}
              {canEditHeroImage ? (
                <TextField
                  label={t("trips.form.heroImage")}
                  type="file"
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ accept: IMAGE_UPLOAD_ACCEPT }}
                  helperText={t("trips.form.heroImageHelper")}
                  {...heroImageField}
                  // Story 6.25. react-hook-form's own `onChange` still runs — it is what puts the FileList
                  // into `values.heroImage` for `onSubmit`; this only adds the one bit `dirtyFields`
                  // cannot carry. See the note on `editGuard` above.
                  onChange={(event) => {
                    void heroImageField.onChange(event);
                    setHeroImageSelected(Boolean((event.target as HTMLInputElement).files?.length));
                  }}
                  fullWidth
                />
              ) : null}
            </Box>
          </Box>
        </DialogContent>
        {/* Story 6.25 AC2 — a form dialog's footer keeps only the confirming action; its dismissal is
            the `✕` in the title row. */}
        <DialogActions>
          <Button type="submit" form="trip-edit-form" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : t("trips.edit.submit")}
          </Button>
        </DialogActions>
      </Dialog>
      {/* A sibling of the dialog it guards, which is the shape `TripDayPlanDialog` already has. */}
      <DiscardChangesDialog {...editGuard.dialogProps} />
    </>
  );
}
