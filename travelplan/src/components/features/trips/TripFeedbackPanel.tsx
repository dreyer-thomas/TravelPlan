"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  Paper,
  SvgIcon,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export type FeedbackTargetType = "trip" | "tripDay" | "accommodation" | "dayPlanItem";
export type FeedbackSummary = {
  targetType: FeedbackTargetType;
  targetId: string;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    author: {
      id: string;
      email: string;
    };
  }>;
  voteSummary: {
    upCount: number;
    downCount: number;
    userVote: "up" | "down" | null;
  };
};

type TripFeedbackPanelProps = {
  tripId: string;
  feedback?: FeedbackSummary | null;
  targetType: FeedbackTargetType;
  targetId: string;
  contextLabel?: string;
  tripDayId?: string;
  onUpdated: (feedback: FeedbackSummary) => void;
};

const buildDefaultFeedback = (targetType: FeedbackTargetType, targetId: string): FeedbackSummary => ({
  targetType,
  targetId,
  comments: [],
  voteSummary: {
    upCount: 0,
    downCount: 0,
    userVote: null,
  },
});

const CommentIcon = () => (
  <SvgIcon sx={{ fontSize: 18 }} aria-hidden="true">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.15A.5.5 0 0 1 4 17.75V5.5Z" />
  </SvgIcon>
);

const VoteIcon = ({ direction }: { direction: "up" | "down" }) => (
  <SvgIcon sx={{ fontSize: 16 }} aria-hidden="true">
    {direction === "up" ? (
      <path d="M12 4.5c.35 0 .68.18.87.48l3.55 5.52H19a1 1 0 0 1 1 1v1.85a2 2 0 0 1-.16.79l-1.73 4.05a1 1 0 0 1-.92.61H10a2 2 0 0 1-2-2V10a2 2 0 0 1 .59-1.41l2.7-2.7A1 1 0 0 1 12 5.5V4.5Zm-6 6h2v8H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
    ) : (
      <path d="M12 19.5a1 1 0 0 1-.87-.48L7.58 13.5H5a1 1 0 0 1-1-1v-1.85c0-.27.05-.54.16-.79l1.73-4.05A1 1 0 0 1 6.81 5H14a2 2 0 0 1 2 2v6a2 2 0 0 1-.59 1.41l-2.7 2.7A1 1 0 0 1 12 18.5v1Zm6-8h-2V3h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2Z" />
    )}
  </SvgIcon>
);

function TripFeedbackBody({
  resolvedFeedback,
  comment,
  error,
  savingComment,
  savingVote,
  setComment,
  saveComment,
  saveVote,
}: {
  resolvedFeedback: FeedbackSummary;
  comment: string;
  error: string | null;
  savingComment: boolean;
  savingVote: boolean;
  setComment: (value: string) => void;
  saveComment: () => Promise<void>;
  saveVote: (value: "up" | "down") => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <Box display="flex" flexDirection="column" gap={1.5}>
      <Box display="flex" gap={1} flexWrap="wrap">
        <Chip
          label={`${t("trips.feedback.voteUp")} ${resolvedFeedback.voteSummary.upCount}`}
          size="small"
          color={resolvedFeedback.voteSummary.userVote === "up" ? "primary" : "default"}
          icon={<VoteIcon direction="up" />}
          onClick={() => void saveVote("up")}
          disabled={savingVote}
        />
        <Chip
          label={`${t("trips.feedback.voteDown")} ${resolvedFeedback.voteSummary.downCount}`}
          size="small"
          color={resolvedFeedback.voteSummary.userVote === "down" ? "primary" : "default"}
          icon={<VoteIcon direction="down" />}
          onClick={() => void saveVote("down")}
          disabled={savingVote}
        />
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label={t("trips.feedback.commentLabel")}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        multiline
        minRows={2}
        size="small"
      />
      <Box display="flex" justifyContent="flex-end">
        <Button variant="contained" size="small" onClick={() => void saveComment()} disabled={savingComment || !comment.trim()}>
          {t("trips.feedback.commentSubmit")}
        </Button>
      </Box>
      <Divider />
      {resolvedFeedback.comments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("trips.feedback.empty")}
        </Typography>
      ) : (
        <List disablePadding>
          {resolvedFeedback.comments.map((item) => (
            <ListItem key={item.id} disableGutters sx={{ display: "block", py: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                {item.author.email}
              </Typography>
              <Typography variant="body2">{item.body}</Typography>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}

export default function TripFeedbackPanel({
  tripId,
  feedback,
  targetType,
  targetId,
  contextLabel,
  tripDayId,
  onUpdated,
}: TripFeedbackPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const resolvedFeedback = feedback ?? buildDefaultFeedback(targetType, targetId);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [savingVote, setSavingVote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setComment("");
      setError(null);
    }
  }, [open]);

  const commentCountLabel = useMemo(() => {
    const count = resolvedFeedback.comments.length;
    if (count === 0) return t("trips.feedback.noComments");
    if (count === 1) return formatMessage(t("trips.feedback.commentCountSingular"), { count });
    return formatMessage(t("trips.feedback.commentCountPlural"), { count });
  }, [resolvedFeedback.comments.length, t]);

  const dialogTitle = contextLabel
    ? formatMessage(t("trips.feedback.titleWithTarget"), { target: contextLabel })
    : t("trips.feedback.title");
  const openDialogLabel = contextLabel
    ? formatMessage(t("trips.feedback.openDialogAriaWithTarget"), { target: contextLabel })
    : t("trips.feedback.openDialogAria");
  const closeDialogLabel = contextLabel
    ? formatMessage(t("trips.feedback.closeDialogAriaWithTarget"), { target: contextLabel })
    : t("trips.feedback.closeDialogAria");
  const triggerLabel = `${openDialogLabel}, ${commentCountLabel}, ${t("trips.feedback.voteUp")} ${resolvedFeedback.voteSummary.upCount}, ${t("trips.feedback.voteDown")} ${resolvedFeedback.voteSummary.downCount}`;

  const fetchCsrfToken = async () => {
    if (csrfToken) return csrfToken;
    const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
    const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
    if (!response.ok || body.error || !body.data?.csrfToken) {
      throw new Error("csrf");
    }
    setCsrfToken(body.data.csrfToken);
    return body.data.csrfToken;
  };

  const saveComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setSavingComment(true);
    setError(null);
    try {
      const token = await fetchCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/feedback/comments`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          targetType,
          targetId,
          tripDayId,
          body,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<{ feedback: FeedbackSummary }>;
      if (!response.ok || payload.error || !payload.data?.feedback) {
        setError(t("trips.feedback.saveError"));
        return;
      }
      onUpdated(payload.data.feedback);
      setComment("");
    } catch {
      setError(t("trips.feedback.saveError"));
    } finally {
      setSavingComment(false);
    }
  };

  const saveVote = async (value: "up" | "down") => {
    setSavingVote(true);
    setError(null);
    try {
      const token = await fetchCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/feedback/votes`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          targetType,
          targetId,
          tripDayId,
          value,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<{ feedback: FeedbackSummary }>;
      if (!response.ok || payload.error || !payload.data?.feedback) {
        setError(t("trips.feedback.voteError"));
        return;
      }
      onUpdated(payload.data.feedback);
    } catch {
      setError(t("trips.feedback.voteError"));
    } finally {
      setSavingVote(false);
    }
  };

  const closeDialog = () => {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  return (
    <>
      <ButtonBase
        ref={triggerRef}
        component={Paper}
        elevation={0}
        onClick={() => setOpen(true)}
        aria-label={triggerLabel}
        sx={{
          width: "fit-content",
          maxWidth: "100%",
          alignSelf: "flex-start",
          mt: 0.5,
          px: 1.25,
          py: 1,
          borderRadius: 2,
          border: "1px solid rgba(17,18,20,0.08)",
          backgroundColor: "#f6f8fb",
          textAlign: "left",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: 1,
          color: "inherit",
        }}
      >
        <Box display="flex" alignItems="center" gap={1} minWidth={0}>
          <CommentIcon />
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {commentCountLabel}
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={1.25} color="text.secondary">
          <Box display="flex" alignItems="center" gap={0.25}>
            <VoteIcon direction="up" />
            <Typography variant="caption">{resolvedFeedback.voteSummary.upCount}</Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={0.25}>
            <VoteIcon direction="down" />
            <Typography variant="caption">{resolvedFeedback.voteSummary.downCount}</Typography>
          </Box>
        </Box>
      </ButtonBase>

      <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby={`${targetType}-${targetId}-feedback-title`}>
        <DialogTitle id={`${targetType}-${targetId}-feedback-title`} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography component="span" variant="subtitle1" fontWeight={600}>
            {dialogTitle}
          </Typography>
          <IconButton aria-label={closeDialogLabel} onClick={closeDialog}>
            <SvgIcon>
              <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.4 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z" />
            </SvgIcon>
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <TripFeedbackBody
            resolvedFeedback={resolvedFeedback}
            comment={comment}
            error={error}
            savingComment={savingComment}
            savingVote={savingVote}
            setComment={setComment}
            saveComment={saveComment}
            saveVote={saveVote}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
