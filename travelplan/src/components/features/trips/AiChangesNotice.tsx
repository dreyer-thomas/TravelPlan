"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import { formatMessage, INTL_LOCALES, type Language } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/features/trips/TripIcons";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/** One row of `GET /api/trips/{id}/ai-changes?tripDayId=` (Story 15.4). */
export type AiChangeEntry = {
  id: string;
  action: string;
  subject: string | null;
  createdAt: string;
  undoable: boolean;
};

type RowStatus = "stale" | "unavailable" | "error";

const ACTION_KEYS = {
  created: "trips.aiChanges.created",
  updated: "trips.aiChanges.updated",
  deleted: "trips.aiChanges.deleted",
  moved: "trips.aiChanges.moved",
  parked: "trips.aiChanges.parked",
  scheduled: "trips.aiChanges.scheduled",
  // Story 15.5. `apply_day_plan`; the subject is the plan's titles, joined.
  planAppended: "trips.aiChanges.planAppended",
  planReplaced: "trips.aiChanges.planReplaced",
  // Story 15.6. A stay's subject is its name, a leg's "<from> → <to>".
  stayCreated: "trips.aiChanges.stayCreated",
  stayUpdated: "trips.aiChanges.stayUpdated",
  stayDeleted: "trips.aiChanges.stayDeleted",
  legCreated: "trips.aiChanges.legCreated",
  legUpdated: "trips.aiChanges.legUpdated",
  legDeleted: "trips.aiChanges.legDeleted",
  // Story 15.7. The subject is the file's name.
  fileAttached: "trips.aiChanges.fileAttached",
  fileDeleted: "trips.aiChanges.fileDeleted",
} as const;

const ROW_STATUS_KEYS = {
  stale: "trips.aiChanges.stale",
  unavailable: "trips.aiChanges.unavailable",
  error: "trips.aiChanges.error",
} as const;

/** `HH:MM` in the UI language, with a short date in front when the change was not made today. */
const formatChangeTime = (iso: string, language: Language, now: Date) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const locale = INTL_LOCALES[language];
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  if (sameDay) return time;
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(at);
  return `${date}, ${time}`;
};

export type AiChangesNoticeProps = {
  tripId: string;
  /** The day on screen. Its changes are listed; a response for a day the user has left is dropped. */
  dayId: string;
  /**
   * Bumped by the day view each time its day load completes (first load, another day, a reload after
   * any write). The list is read again on every bump, so it follows the user's own writes too.
   */
  refreshKey: number;
  ensureCsrfToken: () => Promise<string>;
  /** Called after a successful undo while the user is still on the day: reload the day. */
  onDayChanged: () => void;
  /** Called after any successful undo: the bucket list is the trip's, whichever day is on screen now. */
  onBucketChanged: () => void;
  /** The outer band's styling (the day view's notice band: card background and hero gutters). */
  sx?: SxProps<Theme>;
};

/**
 * Story 15.4. "AI changed this day": the connector's changes to the day not yet undone, newest first,
 * collapsed to one line with a count and expandable to one row per change (summary, time, *Undo*).
 *
 * Rendered by the day view for writers only, and renders nothing while the list is empty, still
 * loading, or could not be read: the notice is information about the plan, not a place for errors.
 *
 * Same visual family as `ActionNotice` (card panel, strong border; `role="status"` on the summary line only,
 * so the list and its buttons are not a live region), but not that
 * component: it lists several changes, each with its own undo, and it has no close - it goes away when
 * the last change is undone or ages out of the 14-day retention.
 */
export default function AiChangesNotice({
  tripId,
  dayId,
  refreshKey,
  ensureCsrfToken,
  onDayChanged,
  onBucketChanged,
  sx,
}: AiChangesNoticeProps) {
  const { language, t } = useI18n();
  const theme = useTheme();
  const { tokens } = theme.palette;
  const listId = useId();

  const [loaded, setLoaded] = useState<{ dayId: string; changes: AiChangeEntry[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  // Another day on screen starts collapsed, without the previous day's row messages.
  const [stateDayId, setStateDayId] = useState(dayId);
  if (stateDayId !== dayId) {
    setStateDayId(dayId);
    setExpanded(false);
    setRowStatus({});
  }
  const undoInFlightRef = useRef(false);
  const currentDayIdRef = useRef(dayId);
  useEffect(() => {
    currentDayIdRef.current = dayId;
  }, [dayId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/trips/${encodeURIComponent(tripId)}/ai-changes?tripDayId=${encodeURIComponent(dayId)}`,
          { method: "GET", credentials: "include", cache: "no-store" },
        );
        const body = (await response.json()) as ApiEnvelope<{ changes: AiChangeEntry[] }>;
        if (cancelled) return;
        const changes = body?.data?.changes;
        if (!response.ok || body.error || !Array.isArray(changes)) {
          setLoaded(null);
          return;
        }
        const newestFirst = [...changes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setLoaded({ dayId, changes: newestFirst });
      } catch {
        if (!cancelled) setLoaded(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tripId, dayId, refreshKey, reloadKey]);

  const handleUndo = async (change: AiChangeEntry) => {
    if (undoInFlightRef.current) return;
    undoInFlightRef.current = true;
    const requestedDayId = dayId;
    setPendingId(change.id);
    const setStatus = (status: RowStatus | null) =>
      setRowStatus((current) => {
        const next = { ...current };
        if (status) next[change.id] = status;
        else delete next[change.id];
        return next;
      });

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(
        `/api/trips/${encodeURIComponent(tripId)}/ai-changes/${encodeURIComponent(change.id)}/undo`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": token },
        },
      );
      let body: ApiEnvelope<{ undone: boolean }> | null = null;
      try {
        body = (await response.json()) as ApiEnvelope<{ undone: boolean }>;
      } catch {
        body = null;
      }
      const code = body?.error?.code;
      const undone = response.ok && !body?.error;

      if (undone) onBucketChanged();
      // A response for a day the user has already left is about nothing on screen.
      if (currentDayIdRef.current !== requestedDayId) return;

      if (undone) {
        setStatus(null);
        setReloadKey((key) => key + 1);
        onDayChanged();
        return;
      }
      if (response.status === 409 && code === "undo_stale") {
        setStatus("stale");
        return;
      }
      if (response.status === 400 && code === "undo_unavailable") {
        setStatus("unavailable");
        return;
      }
      if (response.status === 404 || (response.status === 409 && code === "already_undone")) {
        // Gone or already taken back (by another writer, or by the assistant): read the list again.
        setStatus(null);
        setReloadKey((key) => key + 1);
        return;
      }
      setStatus("error");
    } catch {
      if (currentDayIdRef.current === requestedDayId) setStatus("error");
    } finally {
      undoInFlightRef.current = false;
      setPendingId(null);
    }
  };

  if (!loaded || loaded.dayId !== dayId || loaded.changes.length === 0) {
    return null;
  }

  const { changes } = loaded;
  const now = new Date();
  const countText =
    changes.length === 1
      ? t("trips.aiChanges.countOne")
      : formatMessage(t("trips.aiChanges.count"), { count: changes.length });

  return (
    <Box sx={sx}>
      <Box
        data-testid="ai-changes-notice"
        sx={{
          borderRadius: "8px",
          backgroundColor: tokens.card,
          border: `1px solid ${tokens.borderStrong}`,
          padding: "18px",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography role="status" variant="body2" sx={{ color: tokens.ink, flex: "1 1 240px", minWidth: 0 }}>
            {t("trips.aiChanges.title")} · {countText}
          </Typography>
          <Button
            variant="text"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={listId}
            endIcon={expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            data-testid="ai-changes-toggle"
            sx={{ ml: "auto" }}
          >
            {expanded ? t("trips.aiChanges.collapse") : t("trips.aiChanges.expand")}
          </Button>
        </Box>
        {expanded ? (
          <Box
            component="ul"
            id={listId}
            sx={{ listStyle: "none", m: 0, mt: 1, p: 0, "& > li:last-child": { borderBottom: "none" } }}
          >
            {changes.map((change) => {
              const key = ACTION_KEYS[change.action as keyof typeof ACTION_KEYS] ?? ACTION_KEYS.updated;
              const title = change.subject?.trim() || t("trips.plan.untitledActivity");
              const status = rowStatus[change.id];
              const showUndo = change.undoable && status !== "stale" && status !== "unavailable";
              return (
                <Box
                  component="li"
                  key={change.id}
                  data-testid="ai-change-row"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 1,
                    padding: "8px 0",
                    borderBottom: "1px solid",
                    borderColor: tokens.border,
                  }}
                >
                  <Box sx={{ flex: "1 1 220px", minWidth: 0 }}>
                    <Typography variant="body2" sx={{ color: tokens.ink, overflowWrap: "anywhere" }}>
                      {formatMessage(t(key), { title })}
                    </Typography>
                    <Typography variant="body2" sx={{ color: tokens.inkSoft, fontVariantNumeric: "tabular-nums" }}>
                      {formatChangeTime(change.createdAt, language, now)}
                    </Typography>
                    {status ? (
                      <Typography
                        variant="body2"
                        data-testid="ai-change-status"
                        sx={{ color: status === "error" ? theme.palette.error.main : tokens.inkSoft, mt: "2px" }}
                      >
                        {t(ROW_STATUS_KEYS[status])}
                      </Typography>
                    ) : null}
                  </Box>
                  {showUndo ? (
                    <Button
                      variant="text"
                      onClick={() => void handleUndo(change)}
                      disabled={pendingId !== null}
                      sx={{ ml: "auto" }}
                    >
                      {t("trips.aiChanges.undo")}
                    </Button>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
