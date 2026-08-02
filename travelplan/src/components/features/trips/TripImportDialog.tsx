"use client";

// Re-connected to a production surface by Story 2.32 (2026-08-02): the trips list mounts this
// dialog (`TripsDashboard.tsx`), which is where a whole-trip restore belongs. Story 7.8 had removed
// the trip-overview entry point on purpose and left the component with zero call sites; that state
// is over. See _bmad-output/implementation-artifacts/deferred-work.md → DW-47.

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { MAX_IMPORT_PACKAGE_BYTES } from "@/lib/trips/importLimits";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type ImportResponse = {
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    heroImageUrl: string | null;
  };
  dayCount: number;
  mode: "overwrite" | "createNew";
  // Added by Story 2.32. Optional so an envelope from an older deployment still renders rather than
  // printing `undefined` into the summary.
  travelSegmentCount?: number;
  bucketListItemCount?: number;
  photoCount?: number;
  /** What the *export* skipped. Server-generated English, shown as-is under a translated heading. */
  warnings?: string[];
};

type TripConflict = {
  id: string;
  name: string;
};

type TripImportDialogProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
};

/**
 * The server's own limit, imported rather than mirrored - a local copy is what let this dialog and
 * two translated strings all promise "100 MB" independently of what the route enforced.
 */
const MAX_IMPORT_PACKAGE_MB = Math.floor(MAX_IMPORT_PACKAGE_BYTES / (1024 * 1024));

/**
 * How many server diagnostics to print at once.
 *
 * The route collects every problem it found so a user fixing a hand-built package sees them
 * together, but a package with a thousand bad photo rows would otherwise turn the dialog into a
 * wall of text with the buttons somewhere below the fold.
 */
const MAX_SHOWN_ISSUES = 10;

/** The `details.issues` list the route attaches to a photo-validation 400, if this response has one. */
const readIssues = (details: unknown): string[] => {
  const issues = (details as { issues?: unknown } | null | undefined)?.issues;
  return Array.isArray(issues) ? issues.filter((issue): issue is string => typeof issue === "string") : [];
};

export default function TripImportDialog({ open, onClose, onImported }: TripImportDialogProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<TripConflict[]>([]);
  const [conflictTargetTripId, setConflictTargetTripId] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  useEffect(() => {
    if (!open) {
      setServerError(null);
      setServerIssues([]);
      setConflicts([]);
      setConflictTargetTripId(null);
      setFile(null);
      setFileName("");
      setResult(null);
      return;
    }

    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setServerError(body.error?.message ?? t("trips.import.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.import.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open, t]);

  // A ZIP cannot be inspected here, so client-side validity is "a file is selected" and nothing
  // more: the package is a container the server has to open, verify member by member and check
  // against the manifest before it can say anything true about it.
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    // Clearing the input's value is what makes re-picking the *same* file work. Without it the
    // browser fires no `change` event for an unchanged value, so a user who was told their file was
    // too large - or who fixed the file at the same path and picked it again - got no reaction at
    // all: the error stayed, the submit button stayed disabled, and the dialog looked frozen.
    event.target.value = "";
    setServerError(null);
    setServerIssues([]);
    setConflicts([]);
    setConflictTargetTripId(null);
    setResult(null);

    if (!selected) {
      setFile(null);
      setFileName("");
      return;
    }

    setFileName(selected.name);

    if (selected.size > MAX_IMPORT_PACKAGE_BYTES) {
      setFile(null);
      setServerError(formatMessage(t("trips.import.fileTooLarge"), { limit: MAX_IMPORT_PACKAGE_MB }));
      return;
    }

    setFile(selected);
  };

  const resolveApiError = useMemo(
    () => (code?: string) => {
      switch (code) {
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "invalid_json":
          // Not `errors.invalidJson` ("request could not be processed, please try again"). On this
          // surface the code means the *selected file* was neither a ZIP nor JSON, so telling the
          // user to retry the request sends them to repeat the one thing that cannot help.
          return t("trips.import.invalidFile");
        case "file_too_large":
          return formatMessage(t("trips.import.fileTooLarge"), { limit: MAX_IMPORT_PACKAGE_MB });
        case "invalid_form_data":
          // The multipart body itself did not parse, so the file never arrived intact. Saying "this
          // backup could not be read" would send the user to look at a file that is probably fine.
          return t("trips.import.uploadFailed");
        case "validation_error":
          return t("trips.import.validationError");
        case "not_found":
          return t("trips.import.targetMissing");
        case "server_error":
          return t("errors.server");
        default:
          return t("trips.import.error");
      }
    },
    [t],
  );

  const submitImport = async (strategy?: "overwrite" | "createNew") => {
    setServerError(null);
    setServerIssues([]);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    if (!file) {
      setServerError(t("trips.import.fileRequired"));
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (strategy) {
      formData.append("strategy", strategy);
    }
    if (strategy === "overwrite") {
      // Only ever a trip the server itself named as a same-name conflict. There is no ambient trip
      // on the trips list, and falling back to one would risk overwriting a trip the user was
      // merely looking at.
      const targetTripId = conflictTargetTripId ?? conflicts[0]?.id;
      if (targetTripId) {
        formData.append("targetTripId", targetTripId);
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/trips/import", {
        method: "POST",
        credentials: "include",
        // No `Content-Type`: the browser has to set it, because only it knows the multipart boundary.
        headers: {
          "x-csrf-token": csrfToken,
        },
        body: formData,
      });

      // The reverse proxy in front of this app answers an oversized body itself, with its own HTML
      // error page and no `{ data, error }` envelope - and until `client_max_body_size` is raised
      // that is what *every* photo-bearing import gets. Calling `response.json()` on it throws, and
      // the catch below reports the generic "import failed" for what is a plain size limit.
      let body: ApiEnvelope<ImportResponse>;
      try {
        body = (await response.json()) as ApiEnvelope<ImportResponse>;
      } catch {
        setServerError(
          response.status === 413
            ? formatMessage(t("trips.import.fileTooLarge"), { limit: MAX_IMPORT_PACKAGE_MB })
            : t("trips.import.uploadFailed"),
        );
        return;
      }

      if (response.status === 409 && body.error?.code === "trip_name_conflict") {
        const conflictItems =
          ((body.error.details as { conflicts?: TripConflict[] } | undefined)?.conflicts ?? []).filter(
            (item): item is TripConflict => Boolean(item?.id && item?.name),
          );

        if (conflictItems.length === 0) {
          // `target_trip_not_conflict` answers 409 with no details at all. Overwriting the list
          // with an empty one took the strategy buttons and the target select off screen, leaving
          // the user nothing to do but close the dialog and pick the file again. The list the
          // server sent a moment ago is still the right one - only the chosen target is not.
          setServerError(t("trips.import.targetInvalid"));
          return;
        }

        setConflicts(conflictItems);
        setConflictTargetTripId(conflictItems[0]?.id ?? null);
        setServerError(t("trips.import.conflictError"));
        return;
      }

      if (!response.ok || body.error || !body.data) {
        setServerError(resolveApiError(body.error?.code));
        // The route collects every problem with a package specifically so they can all be shown at
        // once; collapsing them into one sentence threw that away. Untranslated on purpose - these
        // are server diagnostics naming archive members and photo ids, not UI copy.
        setServerIssues(readIssues(body.error?.details));
        return;
      }

      // The dialog stays open on success. An import can carry photos, travel segments and bucket
      // list entries, and closing on the spot would leave the user with no way to tell whether the
      // media came across - the one thing this story exists to make true.
      setResult(body.data);
      setConflicts([]);
      onImported();
    } catch {
      setServerError(t("trips.import.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasConflict = conflicts.length > 0;
  const warnings = result?.warnings ?? [];

  /**
   * Server-generated English under a translated heading.
   *
   * Both lists name archive members, photo ids and file paths, so there is nothing to translate and
   * no dictionary that could hold them. The heading is what carries the language.
   */
  const diagnosticList = (testId: string, heading: string, lines: string[]) => (
    <Box
      data-testid={testId}
      sx={{
        padding: "10px 14px",
        border: "1px solid",
        borderColor: tokens.border,
        borderRadius: "8px",
        backgroundColor: tokens.card,
      }}
    >
      <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.5 }}>
        {heading}
      </Typography>
      <Box component="ul" sx={{ margin: 0, paddingInlineStart: "18px" }}>
        {/* Keyed by position, not content: both lists arrive from the package, and a manifest is
            free to repeat a warning verbatim. A duplicate string key drops one of the two lines. */}
        {lines.slice(0, MAX_SHOWN_ISSUES).map((line, index) => (
          <Typography
            key={`${index}-${line}`}
            component="li"
            variant="body2"
            sx={{ color: tokens.ink, overflowWrap: "anywhere" }}
          >
            {line}
          </Typography>
        ))}
      </Box>
      {lines.length > MAX_SHOWN_ISSUES && (
        <Typography variant="caption" sx={{ color: tokens.inkSoft }}>
          {formatMessage(t("trips.import.issuesTruncated"), { count: lines.length - MAX_SHOWN_ISSUES })}
        </Typography>
      )}
    </Box>
  );

  const summaryCell = (label: string, value: number) => (
    <Box key={label} sx={{ minWidth: 0 }}>
      <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.25 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: tokens.ink }}>
        {value}
      </Typography>
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("trips.import.title")}</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2}>
          {serverError && <Alert severity="error">{serverError}</Alert>}

          {serverIssues.length > 0 &&
            diagnosticList("trip-import-issues", t("trips.import.issuesHeading"), serverIssues)}

          {result ? (
            <Box data-testid="trip-import-summary" display="flex" flexDirection="column" gap={1.5}>
              <Alert severity="success">
                {formatMessage(
                  t(result.mode === "overwrite" ? "trips.import.successOverwritten" : "trips.import.successCreated"),
                  { name: result.trip.name },
                )}
              </Alert>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                  gap: 2,
                  padding: "14px 16px",
                  border: "1px solid",
                  borderColor: tokens.border,
                  borderRadius: "8px",
                  backgroundColor: tokens.card,
                }}
              >
                {summaryCell(t("trips.import.summaryDays"), result.dayCount)}
                {summaryCell(t("trips.import.summaryPhotos"), result.photoCount ?? 0)}
                {summaryCell(t("trips.import.summarySegments"), result.travelSegmentCount ?? 0)}
                {summaryCell(t("trips.import.summaryBucket"), result.bucketListItemCount ?? 0)}
              </Box>
              {warnings.length > 0 &&
                diagnosticList("trip-import-warnings", t("trips.import.warningsHeading"), warnings)}
            </Box>
          ) : (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="body2" color="text.secondary">
                {t("trips.import.fileHelp")}
              </Typography>
              <input
                aria-label={t("trips.import.fileLabel")}
                type="file"
                accept="application/zip,.zip,application/json,.json"
                onChange={handleFileChange}
              />
              {fileName && (
                <Typography variant="caption" color="text.secondary">
                  {fileName}
                </Typography>
              )}
            </Box>
          )}

          {hasConflict && !result && (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="body2" color="text.secondary">
                {t("trips.import.conflictHelp")}
              </Typography>
              <TextField
                select
                SelectProps={{ native: true }}
                value={conflictTargetTripId ?? ""}
                onChange={(event) => setConflictTargetTripId(event.target.value)}
                label={t("trips.import.conflictSelectLabel")}
                size="small"
              >
                {conflicts.map((conflict) => (
                  <option key={conflict.id} value={conflict.id}>
                    {conflict.name}
                  </option>
                ))}
              </TextField>
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Button variant="outlined" onClick={() => void submitImport("overwrite")} disabled={isSubmitting}>
                  {t("trips.import.strategyOverwrite")}
                </Button>
                <Button variant="outlined" onClick={() => void submitImport("createNew")} disabled={isSubmitting}>
                  {t("trips.import.strategyCreateNew")}
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button variant="contained" onClick={onClose}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button variant="contained" onClick={() => void submitImport()} disabled={isSubmitting || !file}>
              {isSubmitting ? <CircularProgress size={22} /> : t("trips.import.action")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
