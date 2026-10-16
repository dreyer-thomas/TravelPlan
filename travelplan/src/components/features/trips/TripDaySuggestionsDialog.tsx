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
// Zod and types only, so it is safe in a client component. Nothing under `@/lib/ai/` may be imported
// here: every file there is `server-only` and would break the build.
import {
  SUGGESTION_MODES,
  suggestionsRequestSchema,
  type DaySuggestion,
  type SuggestionMode,
} from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.3. The dialog where a planner describes the day, gets Claude's suggestions back as cards
 * (Stories 12.1 and 12.2) and ticks the ones worth keeping. It writes nothing; Story 12.4 adds that.
 *
 * - **No *Übernehmen* without `onApply`.** Until 12.4 passes a handler there is nothing for the button
 *   to do, and a button that does nothing is worse than none. The footer then carries only the
 *   "n selected" line. With a handler, *Übernehmen (n)* is the dialog's one primary action; *Suchen*
 *   fetches rather than commits, so it is an outlined button in the body.
 * - **Abort on close.** The route forwards the request's signal to the model call and both lookup
 *   steps, so closing the dialog stops paying for an answer nobody will read. An aborted search shows
 *   no error and sets no state.
 * - **No client timeout.** A search can take well over a minute (web search plus geocoding plus
 *   pictures). A timeout here would only cut it short; nginx may answer 504 with an HTML page at 60 s,
 *   which is why the body is parsed inside a `try`.
 * - **Thumbnails are hotlinked from Wikimedia** with `referrerPolicy="no-referrer"`, so Wikimedia sees
 *   the viewer's address but not the trip page they came from (DW-387). The app sets no CSP, so there is
 *   no `img-src` to extend. Only `thumbnailUrl` reaches the DOM; `originalUrl` is 12.4's server-side
 *   download source and stays in state.
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
  /** Story 12.4. Receives the ticked suggestions in list order. Absent: no apply button at all. */
  onApply?: (picked: DaySuggestion[]) => void;
};

type SearchStatus = "idle" | "searching" | "results" | "error";

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
  onApply,
}: TripDaySuggestionsDialogProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const idPrefix = useId();
  const resultsHeadingId = `${idPrefix}-results`;

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<SuggestionMode>("car");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [suggestions, setSuggestions] = useState<DaySuggestion[]>([]);
  // Indices into `suggestions`: Story 12.1 deliberately gives a suggestion no id.
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
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
  const guard = useDiscardGuard(ticked.size > 0, closeAndAbort, false);

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
    if (searching) return;

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
    setStatus("searching");

    const controller = new AbortController();
    controllerRef.current = controller;

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
        body: JSON.stringify({ prompt: parsedPrompt.data, mode }),
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
    if (searching) return;
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

  const tickedCount = ticked.size;
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

  const handleApply = () => {
    if (!onApply || tickedCount === 0) return;
    onApply(suggestions.filter((_suggestion, index) => ticked.has(index)));
  };

  const footer = (
    <>
      <Typography role="status" variant="body2" sx={{ color: tokens.inkSoft, fontWeight: 700 }}>
        {selectedText}
      </Typography>
      {onApply ? (
        <Button variant="contained" onClick={handleApply} disabled={tickedCount === 0 || searching}>
          {formatMessage(t("trips.suggestions.apply"), { count: tickedCount })}
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
        footerSx={{ justifyContent: onApply ? "space-between" : "flex-start" }}
      >
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
              disabled={searching}
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
                />
              ))}
            </Box>
          ) : null}
        </Box>
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
};

function SuggestionCard({ idBase, suggestion, checked, disabled, onToggle }: SuggestionCardProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const titleId = `${idBase}-title`;
  const metaId = `${idBase}-meta`;

  return (
    // DESIGN.md checkbox: the whole card is the click target, so the card *is* the label.
    <Box
      component="label"
      data-testid="suggestion-card"
      sx={{
        display: "flex",
        gap: 1,
        alignItems: "flex-start",
        p: "18px 18px 18px 8px",
        borderRadius: "10px",
        backgroundColor: tokens.card,
        // A ticked card takes the accent edge; the checkbox's own fill carries the state as well, so
        // colour is never the only signal.
        border: "1px solid",
        borderColor: checked ? "primary.main" : tokens.borderStrong,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.7 : 1,
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
