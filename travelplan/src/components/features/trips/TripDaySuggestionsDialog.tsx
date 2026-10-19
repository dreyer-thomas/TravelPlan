"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DialogShell from "@/components/ui/DialogShell";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { formatApproxDuration } from "@/lib/trips/approxDuration";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
// Zod and types only, so it is safe in a client component. Nothing under `@/lib/ai/` may be imported
// here: every file there is `server-only` and would break the build.
import {
  SUGGESTION_MODES,
  suggestionsRequestSchema,
  type DaySuggestion,
  type SuggestionMode,
} from "@/lib/validation/daySuggestionSchemas";
import type { SuggestionPreview } from "@/lib/validation/daySuggestionApplySchemas";

/**
 * Story 12.3. The dialog where a planner describes the day, gets Claude's suggestions back as cards
 * (Stories 12.1 and 12.2) and ticks the ones worth keeping. Story 12.4 takes the ticked ones over.
 *
 * - **No *Übernehmen* without `onApplied`.** Without a receiver for the change there is nothing for the
 *   button to do, and a button that does nothing is worse than none. The footer then carries only the
 *   "n selected" line. With one, *Übernehmen (n)* is the dialog's one primary action; *Suchen* fetches
 *   rather than commits, so it is an outlined button in the body.
 * - **Preview, then apply (12.4).** *Übernehmen (n)* asks the server for the visiting order, the times
 *   and the legs, and shows them as a second step; *Hinzufügen* writes exactly that and hands the receipt
 *   to `onApplied`. *Zurück zur Auswahl* returns with the ticks intact. Both requests carry the mode the
 *   list was searched with (`searchedMode`), not whatever the toggle shows by then. A day that changed
 *   in between (`409 day_plan_changed`) is previewed again with a short note; if that preview fails, the
 *   stale one is dropped and the dialog returns to the choice with the error.
 * - **No closing while *Hinzufügen* runs.** The server commits whatever the client does, so an apply
 *   aborted by a close would land without its receipt: no notice, no undo, no reload. ✕, Escape and the
 *   backdrop are disabled until it answers. No search starts while a preview or apply is in flight.
 * - **Abort on close.** The route forwards the request's signal to the model call and both lookup
 *   steps, so closing the dialog stops paying for an answer nobody will read. An aborted search shows
 *   no error and sets no state. The preview and apply requests are aborted the same way.
 * - **No client timeout.** A search can take well over a minute (web search plus geocoding plus
 *   pictures). A timeout here would only cut it short; nginx may answer 504 with an HTML page at 60 s,
 *   which is why the body is parsed inside a `try`.
 * - **Thumbnails are hotlinked from Wikimedia** with `referrerPolicy="no-referrer"`, so Wikimedia sees
 *   the viewer's address but not the trip page they came from (DW-387). The app sets no CSP, so there is
 *   no `img-src` to extend. Only `thumbnailUrl` reaches the DOM; `originalUrl` is 12.4's server-side
 *   download source and stays in state.
 * - **Story 14.3: park instead of schedule.** A ticked card shows *Einplanen* / *Parken* (DESIGN.md
 *   `park-choice`), outside the card's label so a click on it never unticks the card. Only the ones set to
 *   *Einplanen* are previewed and planned; the parked ones are listed under the preview's timeline and
 *   sent beside it, and the button that writes names both counts. When every ticked one is parked there
 *   is nothing to plan: "2 parken" applies at once, without a preview.
 */

export type TripDaySuggestionsDialogProps = {
  open: boolean;
  onClose: () => void;
  tripId: string;
  dayId: string;
  dayLabel: string;
  /** The previous night's stay; `null` on the first day, where the trip's own start applies. */
  start: { label: string } | null;
  /** The night's stay; `null` when none is planned yet. */
  end: { label: string } | null;
  ensureCsrfToken: () => Promise<string>;
  /** Story 12.4. Receives the signed receipt of the applied change. Absent: no apply button at all. */
  onApplied?: (receipt: SignedDayChangeReceiptWire) => void;
};

type SearchStatus = "idle" | "searching" | "results" | "error";

type PlanEnvelope = { data?: unknown; error?: { code?: string } | null };

/**
 * The preview step's data: the server's plan and the picked suggestions it was made for, in list order.
 * Story 14.3: `parked` are the ticked ones set to *Parken*, snapshotted with it, so a re-preview after a
 * 409 sends the same split.
 */
type PreviewState = SuggestionPreview & { picked: DaySuggestion[]; parked: DaySuggestion[] };

type ErrorEnvelope = {
  data?: { suggestions?: unknown } | null;
  error?: { code?: string; details?: { fieldErrors?: Record<string, unknown> } } | null;
};

const MODE_LABEL_KEYS: Record<SuggestionMode, string> = {
  car: "trips.suggestions.modeCar",
  walking: "trips.suggestions.modeWalking",
  cycling: "trips.suggestions.modeCycling",
};

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export default function TripDaySuggestionsDialog({
  open,
  onClose,
  tripId,
  dayId,
  dayLabel,
  start,
  end,
  ensureCsrfToken,
  onApplied,
}: TripDaySuggestionsDialogProps) {
  const { t, language } = useI18n();
  const { tokens } = useTheme().palette;
  const idPrefix = useId();
  const resultsHeadingId = `${idPrefix}-results`;

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<SuggestionMode>("car");
  // The mode the list on screen was searched with: the legs must be in that mode, whatever the toggle says now.
  const [searchedMode, setSearchedMode] = useState<SuggestionMode>("car");
  const [step, setStep] = useState<"choose" | "preview">("choose");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [planBusy, setPlanBusy] = useState<"preview" | "apply" | null>(null);
  const [planChangedNote, setPlanChangedNote] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [suggestions, setSuggestions] = useState<DaySuggestion[]>([]);
  // Indices into `suggestions`: Story 12.1 deliberately gives a suggestion no id.
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
  // Story 14.3. The ticked ones set to *Parken*, indices like `ticked`; not in the set means *Einplanen*.
  const [parkedChoice, setParkedChoice] = useState<Set<number>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bumped per result list, so a card's "this picture failed" state never survives into the next list.
  const [resultKey, setResultKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const searching = status === "searching";

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const closeAndAbort = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    onClose();
  };

  // Only ticks are worth a question: an unticked list, or a search still running, closes silently.
  const applying = planBusy === "apply";
  const guard = useDiscardGuard(ticked.size > 0, closeAndAbort, applying);

  const mapErrorCode = (status: number, code: string | undefined, promptNamed: boolean): string | null => {
    switch (code) {
      case "ai_failed":
        return t("trips.suggestions.errorFailed");
      case "ai_limit_reached":
        return t("trips.suggestions.errorLimit");
      case "ai_unavailable":
        return t("trips.suggestions.errorUnavailable");
      case "forbidden":
        return t("errors.forbidden");
      case "unauthorized":
        return t("errors.unauthorized");
      case "csrf_invalid":
        return t("errors.csrfInvalid");
      case "validation_error":
        // The field carries this one itself; `null` tells the caller not to raise a banner.
        return promptNamed ? null : t("errors.server");
      case undefined:
        // No envelope at all: nginx's HTML 502/504 when the search outran its proxy timeout.
        return status === 502 || status === 504 ? t("trips.suggestions.errorFailed") : t("errors.server");
      default:
        return t("errors.server");
    }
  };

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (searching || planBusy) return;

    // The server's own rule, so the two can never disagree about what counts as empty.
    const parsedPrompt = suggestionsRequestSchema.shape.prompt.safeParse(prompt);
    if (!parsedPrompt.success) {
      setPromptError(t("trips.suggestions.promptRequired"));
      return;
    }

    setPromptError(null);
    setErrorMessage(null);
    // Cleared when the search *starts*: the old list stays on screen until the new one arrives, but
    // nothing ticked against it can outlive the question that replaced it.
    setTicked(new Set());
    setParkedChoice(new Set());
    setStatus("searching");

    const controller = new AbortController();
    controllerRef.current = controller;
    const requestedMode = mode;

    const fail = (message: string) => {
      setSuggestions([]);
      setErrorMessage(message);
      setStatus("error");
    };

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/days/${dayId}/suggestions`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ prompt: parsedPrompt.data, mode: requestedMode }),
        signal: controller.signal,
      });

      let body: ErrorEnvelope | null = null;
      try {
        body = (await response.json()) as ErrorEnvelope;
      } catch {
        body = null;
      }
      if (controller.signal.aborted) return;

      const suggestionsInBody = body?.data?.suggestions;
      if (response.ok && !body?.error && Array.isArray(suggestionsInBody)) {
        setSuggestions(suggestionsInBody as DaySuggestion[]);
        setSearchedMode(requestedMode);
        setResultKey((current) => current + 1);
        setStatus("results");
        return;
      }

      if (response.ok) {
        fail(t("errors.server"));
        return;
      }

      const code = body?.error?.code;
      const promptNamed = Boolean(body?.error?.details?.fieldErrors?.prompt);
      const message = mapErrorCode(response.status, code, promptNamed);
      if (message === null) {
        setSuggestions([]);
        setPromptError(t("trips.suggestions.promptRequired"));
        setStatus("idle");
        return;
      }
      fail(message);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      fail(t("errors.network"));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  };

  const toggle = (index: number) => {
    if (searching || planBusy) return;
    // Unticking forgets the choice, so a card ticked again starts at *Einplanen*.
    if (ticked.has(index)) {
      setParkedChoice((current) => {
        if (!current.has(index)) return current;
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    }
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const chooseParked = (index: number, park: boolean) => {
    if (searching || planBusy) return;
    setParkedChoice((current) => {
      const next = new Set(current);
      if (park) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  const tickedCount = ticked.size;
  // Story 14.3. The ticked ones split by their choice, both in list order.
  const scheduledPicked = suggestions.filter((_suggestion, index) => ticked.has(index) && !parkedChoice.has(index));
  const parkedPicked = suggestions.filter((_suggestion, index) => ticked.has(index) && parkedChoice.has(index));
  const parkedOnly = scheduledPicked.length === 0 && parkedPicked.length > 0;
  const selectedText =
    tickedCount === 0
      ? t("trips.suggestions.selectedNone")
      : tickedCount === 1
        ? t("trips.suggestions.selectedOne")
        : formatMessage(t("trips.suggestions.selected"), { count: tickedCount });

  // Kept while a repeat search runs: the old list is still on screen, and the heading is its name.
  const resultsText =
    status === "results" || (searching && suggestions.length > 0)
      ? suggestions.length === 1
        ? t("trips.suggestions.resultsOne")
        : formatMessage(t("trips.suggestions.results"), { count: suggestions.length })
      : "";

  /** Preview and apply share one error rule (AC10): the access codes have their own words. */
  const mapPlanError = (code: string | undefined) => {
    switch (code) {
      case "forbidden":
        return t("errors.forbidden");
      case "unauthorized":
        return t("errors.unauthorized");
      case "csrf_invalid":
        return t("errors.csrfInvalid");
      case "not_found":
        return t("trips.suggestions.errorDayNotFound");
      case "validation_error":
      case "invalid_json":
        return t("errors.invalidJson");
      default:
        return t("errors.server");
    }
  };

  /**
   * POSTs to the preview or apply endpoint under the dialog's abort controller. `null` when the request
   * was aborted (the dialog closed); otherwise the status and whatever envelope came back.
   */
  const postPlan = async (endpoint: "preview" | "apply", body: unknown) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/days/${dayId}/suggestions/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let envelope: PlanEnvelope | null = null;
      try {
        envelope = (await response.json()) as PlanEnvelope;
      } catch {
        envelope = null;
      }
      if (controller.signal.aborted) return null;
      return { ok: response.ok && !envelope?.error, code: envelope?.error?.code, data: envelope?.data };
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return null;
      return { ok: false, code: "network" as const, data: undefined };
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  };

  const showPlanError = (code: string | undefined) => {
    setErrorMessage(code === "network" ? t("errors.network") : mapPlanError(code));
  };

  const requestPreview = async (picked: DaySuggestion[], parked: DaySuggestion[], afterChange: boolean) => {
    setErrorMessage(null);
    setPlanBusy("preview");
    const result = await postPlan("preview", { mode: searchedMode, suggestions: picked });
    if (!result) return;
    setPlanBusy(null);
    const data = result.data as SuggestionPreview | undefined;
    if (!result.ok || !data || !Array.isArray(data.order)) {
      showPlanError(result.ok ? undefined : result.code);
      // After a 409 the preview on screen is known to be stale; *Hinzufügen* must not send it again.
      if (afterChange) {
        setPreview(null);
        setStep("choose");
      }
      return;
    }
    setPreview({ ...data, picked, parked });
    setPlanChangedNote(afterChange);
    setStep("preview");
  };

  const handleOpenPreview = () => {
    if (!onApplied || tickedCount === 0 || planBusy) return;
    if (parkedOnly) {
      void handleApplyParkedOnly();
      return;
    }
    void requestPreview(scheduledPicked, parkedPicked, false);
  };

  /** Story 14.3. Everything parked: nothing to plan or show, so no preview and no basis. */
  const handleApplyParkedOnly = async () => {
    if (!onApplied || planBusy) return;
    setErrorMessage(null);
    setPlanBusy("apply");
    const result = await postPlan("apply", { mode: searchedMode, suggestions: [], legs: [], basis: null, parked: parkedPicked });
    if (!result) return;
    setPlanBusy(null);
    const receipt = (result.data as { receipt?: SignedDayChangeReceiptWire } | undefined)?.receipt;
    if (result.ok && receipt) {
      onApplied(receipt);
      return;
    }
    showPlanError(result.ok ? undefined : result.code);
  };

  const handleConfirmApply = async () => {
    if (!onApplied || !preview || planBusy) return;
    setErrorMessage(null);
    setPlanBusy("apply");
    const result = await postPlan("apply", {
      mode: searchedMode,
      suggestions: preview.order.map((index) => preview.picked[index]),
      legs: preview.legs,
      basis: preview.basis,
      // Only when something is parked: without, the body is 13.4's (the server defaults it to none).
      ...(preview.parked.length > 0 ? { parked: preview.parked } : {}),
    });
    if (!result) return;
    setPlanBusy(null);
    const receipt = (result.data as { receipt?: SignedDayChangeReceiptWire } | undefined)?.receipt;
    if (result.ok && receipt) {
      onApplied(receipt);
      return;
    }
    if (result.code === "day_plan_changed") {
      await requestPreview(preview.picked, preview.parked, true);
      return;
    }
    showPlanError(result.ok ? undefined : result.code);
  };

  const handleBackToChoice = () => {
    if (planBusy) return;
    setErrorMessage(null);
    setStep("choose");
  };

  const footer =
    step === "preview" ? (
      <>
        <Button variant="text" onClick={handleBackToChoice} disabled={planBusy !== null}>
          {t("trips.suggestions.back")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleConfirmApply()}
          disabled={planBusy !== null}
          startIcon={planBusy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {preview && preview.parked.length > 0
            ? formatMessage(t("trips.suggestions.applySplit"), { scheduled: preview.picked.length, parked: preview.parked.length })
            : t("trips.suggestions.confirmApply")}
        </Button>
      </>
    ) : (
      <>
        <Typography role="status" variant="body2" sx={{ color: tokens.inkSoft, fontWeight: 700 }}>
          {selectedText}
        </Typography>
        {onApplied ? (
          <Button
            variant="contained"
            onClick={handleOpenPreview}
            disabled={tickedCount === 0 || searching || planBusy !== null}
            startIcon={planBusy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {parkedOnly
              ? formatMessage(t("trips.suggestions.applyParkedOnly"), { count: parkedPicked.length })
              : formatMessage(t("trips.suggestions.apply"), { count: tickedCount })}
          </Button>
        ) : null}
      </>
    );

  return (
    <>
      <DialogShell
        open={open}
        onClose={guard.requestClose}
        title={t("trips.suggestions.dialogTitle")}
        subtitle={dayLabel}
        width={520}
        closeLabel={t("common.close")}
        fullScreenOnPhone
        footer={footer}
        disableDismiss={applying}
        footerSx={{ justifyContent: onApplied ? "space-between" : "flex-start" }}
      >
        {step === "preview" && preview ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {errorMessage ? (
              <Alert severity="warning" data-testid="suggestions-error">
                {errorMessage}
              </Alert>
            ) : null}
            <SuggestionPreviewStep preview={preview} planChanged={planChangedNote} language={language} />
            {preview.parked.length > 0 ? <SuggestionPreviewParked parked={preview.parked} /> : null}
          </Box>
        ) : (
        <Box component="form" noValidate onSubmit={handleSearch} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {errorMessage ? (
            <Alert severity="warning" data-testid="suggestions-error">
              {errorMessage}
            </Alert>
          ) : null}

          <Box
            data-testid="suggestions-route"
            sx={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 1.5,
              rowGap: 0.5,
              p: "12px 14px",
              borderRadius: 1,
              border: `1px solid ${tokens.border}`,
              backgroundColor: tokens.cardAlt,
              fontSize: 13,
            }}
          >
            <Box component="span" sx={{ color: tokens.inkSoft, fontWeight: 700 }}>
              {t("trips.suggestions.startLabel")}
            </Box>
            <Box component="span" sx={{ color: tokens.ink, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>
              {start ? start.label : t("trips.suggestions.startTripFallback")}
            </Box>
            <Box component="span" sx={{ color: tokens.inkSoft, fontWeight: 700 }}>
              {t("trips.suggestions.endLabel")}
            </Box>
            <Box component="span" sx={{ color: tokens.ink, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>
              {end ? end.label : t("trips.suggestions.endNone")}
            </Box>
          </Box>

          <TextField
            label={t("trips.suggestions.promptLabel")}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              if (promptError) setPromptError(null);
            }}
            multiline
            minRows={3}
            maxRows={6}
            fullWidth
            disabled={searching}
            error={Boolean(promptError)}
            helperText={promptError ?? undefined}
            slotProps={{ htmlInput: { maxLength: suggestionsRequestSchema.shape.prompt.maxLength ?? undefined } }}
          />

          <ToggleButtonGroup
            exclusive
            fullWidth
            value={mode}
            // Pressing the active option again reports `null`; a mode is always set, so ignore it.
            onChange={(_event, next: SuggestionMode | null) => {
              if (next) setMode(next);
            }}
            aria-label={t("trips.suggestions.modeLabel")}
            disabled={searching}
            sx={{
              // DESIGN.md auth-tabs: a track with 4 px padding, equal-width 44 px options, a white
              // active fill and ink-soft inactive text. MUI's own button borders are dropped.
              p: "4px",
              gap: "4px",
              borderRadius: "8px",
              backgroundColor: tokens.paperOuter,
              "& .MuiToggleButton-root": {
                minHeight: 44,
                border: "none",
                borderRadius: "6px !important",
                textTransform: "none",
                fontSize: 13,
                fontWeight: 800,
                color: tokens.inkSoft,
                "&.Mui-selected, &.Mui-selected:hover": {
                  backgroundColor: tokens.card,
                  color: tokens.ink,
                },
              },
            }}
          >
            {SUGGESTION_MODES.map((value) => (
              <ToggleButton key={value} value={value}>
                {t(MODE_LABEL_KEYS[value])}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Box>
            <Button
              type="submit"
              variant="outlined"
              disabled={searching || planBusy !== null}
              startIcon={searching ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {searching ? t("trips.suggestions.searching") : t("trips.suggestions.search")}
            </Button>
            <Typography role="status" variant="body2" sx={{ mt: 1, color: tokens.inkSoft, minHeight: "1em" }}>
              {searching ? t("trips.suggestions.searchingHint") : ""}
            </Typography>
          </Box>

          {/* Present and empty from the start, per DESIGN.md candidate-list: a live region only
              announces a change in something it was already watching. */}
          <Typography
            id={resultsHeadingId}
            role="status"
            variant="labelCaps"
            component="h3"
            sx={{ color: tokens.inkSoft, m: 0 }}
          >
            {resultsText}
          </Typography>

          {suggestions.length > 0 ? (
            <Box
              role="group"
              aria-labelledby={resultsHeadingId}
              aria-busy={searching || undefined}
              sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
            >
              {suggestions.map((suggestion, index) => (
                <SuggestionCard
                  key={`${resultKey}-${index}`}
                  idBase={`${idPrefix}-s${index}`}
                  suggestion={suggestion}
                  checked={ticked.has(index)}
                  disabled={searching}
                  onToggle={() => toggle(index)}
                  // Story 14.3: only where something can be applied, i.e. for a writer.
                  parkChoice={
                    onApplied
                      ? {
                          parked: parkedChoice.has(index),
                          disabled: searching || planBusy !== null,
                          onChange: (park) => chooseParked(index, park),
                        }
                      : undefined
                  }
                />
              ))}
            </Box>
          ) : null}
        </Box>
        )}
      </DialogShell>
      <DiscardChangesDialog {...guard.dialogProps} body={t("trips.suggestions.discardBody")} />
    </>
  );
}

type SuggestionCardProps = {
  idBase: string;
  suggestion: DaySuggestion;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Story 14.3. *Einplanen* / *Parken*, shown while the card is ticked; absent without an apply. */
  parkChoice?: { parked: boolean; disabled: boolean; onChange: (park: boolean) => void };
};

function SuggestionCard({ idBase, suggestion, checked, disabled, onToggle, parkChoice }: SuggestionCardProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const titleId = `${idBase}-title`;
  const metaId = `${idBase}-meta`;

  return (
    // The border is the card's; the label inside it is the click target. Story 14.3's toggle sits below
    // the label, still inside the border, so a click on it never reaches the checkbox.
    <Box
      data-testid="suggestion-card"
      sx={{
        borderRadius: "10px",
        backgroundColor: tokens.card,
        // A ticked card takes the accent edge; the checkbox's own fill carries the state as well, so
        // colour is never the only signal.
        border: "1px solid",
        borderColor: checked ? "primary.main" : tokens.borderStrong,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {/* DESIGN.md checkbox: the whole card body is the click target, so it *is* the label. */}
      <Box
        component="label"
        sx={{
          display: "flex",
          gap: 1,
          alignItems: "flex-start",
          p: "18px 18px 18px 8px",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          sx={{ mt: "-12px" }}
          slotProps={{ input: { "aria-labelledby": titleId, "aria-describedby": metaId } }}
        />
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
          <Typography id={titleId} sx={{ fontWeight: 800, color: tokens.ink, fontSize: 14.5 }}>
            {suggestion.title}
          </Typography>
          <Typography variant="body2" sx={{ color: tokens.ink, whiteSpace: "pre-line" }}>
            {suggestion.description}
          </Typography>
          <Box
            id={metaId}
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              columnGap: 1,
              rowGap: 0.5,
              fontSize: 12.5,
              color: tokens.inkSoft,
            }}
          >
            <Box component="span" sx={{ fontWeight: 700 }}>
              {suggestion.locationLabel}
            </Box>
            <Box component="span" aria-hidden="true">
              ·
            </Box>
            <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatApproxDuration(suggestion.durationMinutes, t)}
            </Box>
            {suggestion.verified ? null : (
              <Box
                component="span"
                data-testid="suggestion-unverified"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  px: "7px",
                  py: "2px",
                  borderRadius: "5px",
                  backgroundColor: tokens.pillNeutral,
                  color: tokens.inkSoft,
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                <UnverifiedPlaceGlyph />
                {t("trips.suggestions.unverified")}
              </Box>
            )}
          </Box>
          <SuggestionThumbnails title={suggestion.title} images={suggestion.images} />
        </Box>
      </Box>
      {checked && parkChoice ? (
        <Box sx={{ px: "18px", pb: "14px" }}>
          {/* DESIGN.md park-choice: `schedule-mode`'s treatment at a compact height inside the card. */}
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={parkChoice.parked ? "park" : "schedule"}
            // Pressing the active option reports `null`; one of the two is always chosen, so ignore it.
            onChange={(_event, next: "schedule" | "park" | null) => {
              if (next) parkChoice.onChange(next === "park");
            }}
            aria-label={formatMessage(t("trips.suggestions.parkChoiceLabel"), { title: suggestion.title })}
            disabled={parkChoice.disabled}
            data-testid="suggestion-park-choice"
            sx={{
              borderRadius: "6px",
              border: `1px solid ${tokens.borderStrong}`,
              backgroundColor: tokens.cardAlt,
              overflow: "hidden",
              "& .MuiToggleButton-root": {
                minHeight: 36,
                py: 0,
                border: "none",
                borderRadius: 0,
                textTransform: "none",
                fontSize: 13,
                fontWeight: 600,
                color: tokens.inkSoft,
                "&.Mui-selected, &.Mui-selected:hover": {
                  backgroundColor: tokens.accentSoft,
                  color: tokens.ink,
                  fontWeight: 700,
                },
              },
            }}
          >
            <ToggleButton value="schedule">{t("trips.suggestions.choiceSchedule")}</ToggleButton>
            <ToggleButton value="park">{t("trips.suggestions.choicePark")}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      ) : null}
    </Box>
  );
}

/** A map pin with a question mark: "where exactly?", without borrowing the gap state's warn glyph. */
function UnverifiedPlaceGlyph() {
  return (
    <Box
      component="svg"
      aria-hidden="true"
      viewBox="0 0 24 24"
      sx={{ width: 13, height: 13, flex: "0 0 auto" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" />
      <path d="M10.2 8.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1" />
      <path d="M12 13.4h.01" />
    </Box>
  );
}

/**
 * The card's pictures, drawn with the `photo-strip` geometry (56 px, cropped, square corners, 6 px
 * gap). Not `MiniImageStrip`: that wraps each picture in a button, and a button inside a card that is
 * itself a checkbox label would be a nested interactive element. These are just pictures.
 */
function SuggestionThumbnails({ title, images }: { title: string; images: DaySuggestion["images"] }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  // A failed picture leaves the count too, so "image n of total" always describes what is on screen.
  const visible = images
    .slice(0, 3)
    .map((image, index) => ({ image, index }))
    .filter(({ index }) => !failed.has(index));
  if (visible.length === 0) return null;

  return (
    <Box sx={{ display: "flex", gap: "6px", mt: 0.5 }}>
      {visible.map(({ image, index }, position) => (
        <Box
          key={image.thumbnailUrl}
          component="img"
          src={image.thumbnailUrl}
          alt={formatMessage(t("trips.suggestions.imageAlt"), { title, n: position + 1, total: visible.length })}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setFailed((current) => new Set(current).add(index))}
          sx={{ flex: "0 0 56px", width: 56, height: 56, objectFit: "cover", borderRadius: 0, display: "block" }}
        />
      ))}
    </Box>
  );
}

/**
 * Story 14.3. What goes to the bucket list with the apply: one compact row per parked suggestion, title,
 * place and duration, no times and no legs. The user sees everything the button will write.
 */
function SuggestionPreviewParked({ parked }: { parked: DaySuggestion[] }) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  return (
    <Box data-testid="suggestions-preview-parked" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="labelCaps" component="h3" sx={{ color: tokens.inkSoft, m: 0 }}>
        {t("trips.suggestions.previewParkedTitle")}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {parked.map((suggestion, index) => (
          <Box
            component="li"
            key={`${index}-${suggestion.title}`}
            data-testid="suggestions-preview-parked-row"
            sx={{ p: "10px 14px", borderRadius: "10px", border: `1px solid ${tokens.border}`, backgroundColor: tokens.cardAlt }}
          >
            <Typography sx={{ fontWeight: 800, color: tokens.ink, fontSize: 14, overflowWrap: "anywhere" }}>{suggestion.title}</Typography>
            <Typography variant="body2" sx={{ color: tokens.inkSoft, fontSize: 12.5, overflowWrap: "anywhere" }}>
              {`${suggestion.locationLabel} · ${formatApproxDuration(suggestion.durationMinutes, t)}`}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Story 12.4 AC3. The day as the apply would write it: each picked stop in visiting order with its times
 * (or "no time" past midnight) and place, and between them the leg, from the origin onwards. Read-only;
 * the footer carries *Zurück zur Auswahl* and *Hinzufügen*.
 */
function SuggestionPreviewStep({
  preview,
  planChanged,
  language,
}: {
  preview: PreviewState;
  planChanged: boolean;
  language: string;
}) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const kmFormat = new Intl.NumberFormat(language === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 });

  const originText =
    preview.origin.kind === "tripStart"
      ? t("trips.suggestions.previewFromTripStart")
      : preview.origin.kind !== "none" && preview.origin.label
        ? formatMessage(t("trips.suggestions.previewFrom"), { origin: preview.origin.label })
        : null;
  // With no point to start from there is no first leg to show.
  const showFirstLeg = preview.origin.kind !== "none";
  // From the trip's start nothing on the day can carry the leg, so it is not stored and (Story 13.4) does
  // not count in the times either; say so rather than let the notice count one leg fewer than this list shows.
  const firstLegNotSaved = preview.origin.kind === "tripStart";

  const legText = (leg: PreviewState["legs"][number]) =>
    leg
      ? leg.distanceKm !== null
        ? formatMessage(t("trips.suggestions.legSummary"), { minutes: leg.durationMinutes, km: kmFormat.format(leg.distanceKm) })
        : formatMessage(t("trips.suggestions.legSummary"), { minutes: leg.durationMinutes, km: "–" })
      : t("trips.suggestions.legUnknown");

  return (
    <Box data-testid="suggestions-preview" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="labelCaps" component="h3" sx={{ color: tokens.inkSoft, m: 0 }}>
        {t("trips.suggestions.previewTitle")}
      </Typography>
      {planChanged ? (
        <Alert severity="info" data-testid="suggestions-plan-changed">
          {t("trips.suggestions.planChanged")}
        </Alert>
      ) : null}
      {preview.overflow ? (
        <Alert severity="warning" data-testid="suggestions-overflow">
          {t("trips.suggestions.overflowWarning")}
        </Alert>
      ) : null}
      {preview.routingUnavailable ? (
        <Alert severity="info" data-testid="suggestions-routing-unavailable">
          {t("trips.suggestions.routingUnavailable")}
        </Alert>
      ) : null}
      {originText ? (
        <Typography variant="body2" sx={{ color: tokens.inkSoft, fontWeight: 700 }}>
          {originText}
        </Typography>
      ) : null}
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {preview.order.map((pickedIndex, position) => {
          const stop = preview.picked[pickedIndex];
          const times = preview.rows[position];
          const leg = preview.legs[position];
          return (
            <Box component="li" key={`${pickedIndex}-${position}`} data-testid="suggestions-preview-row" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {position > 0 || showFirstLeg ? (
                <Typography
                  variant="body2"
                  data-testid="suggestions-preview-leg"
                  sx={{ color: tokens.inkSoft, fontSize: 12.5, pl: 1.5, fontVariantNumeric: "tabular-nums" }}
                >
                  {position === 0 && firstLegNotSaved && leg
                    ? `${legText(leg)} · ${t("trips.suggestions.legNotSaved")}`
                    : legText(leg)}
                </Typography>
              ) : null}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "92px 1fr",
                  columnGap: 1.5,
                  alignItems: "baseline",
                  p: "12px 14px",
                  borderRadius: "10px",
                  border: `1px solid ${tokens.borderStrong}`,
                  backgroundColor: tokens.card,
                }}
              >
                <Box component="span" sx={{ fontWeight: 800, color: times ? tokens.ink : tokens.inkSoft, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                  {times ? `${times.fromTime}–${times.toTime}` : t("trips.suggestions.untimed")}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800, color: tokens.ink, fontSize: 14.5, overflowWrap: "anywhere" }}>{stop.title}</Typography>
                  <Typography variant="body2" sx={{ color: tokens.inkSoft, fontSize: 12.5, overflowWrap: "anywhere" }}>
                    {stop.locationLabel}
                  </Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
