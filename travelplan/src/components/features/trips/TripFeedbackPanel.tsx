"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  SvgIcon,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { formatMessage } from "@/i18n";
import { supportsTripFeedbackVoting, type FeedbackTargetType } from "@/lib/feedback/tripFeedbackCapabilities";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

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
  currentUserId?: string;
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

const EditIcon = () => (
  <SvgIcon sx={{ fontSize: 18 }} aria-hidden="true">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.33H5v-.92l9.06-9.06.92.92L5.92 19.58ZM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0l-1.13 1.13 3.75 3.75 1.14-1.13Z" />
  </SvgIcon>
);

const DeleteIcon = () => (
  <SvgIcon sx={{ fontSize: 18 }} aria-hidden="true">
    <path d="M9 3h6l1 1h4v2H4V4h4l1-1Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 12a2 2 0 0 1-2-2V7h16v12a2 2 0 0 1-2 2H6Z" />
  </SvgIcon>
);

function TripFeedbackBody({
  resolvedFeedback,
  currentUserId,
  comment,
  editingCommentId,
  editComment,
  error,
  savingComment,
  savingEditComment,
  savingVote,
  setComment,
  setEditComment,
  startEditingComment,
  cancelEditingComment,
  saveComment,
  saveEditedComment,
  deleteComment,
  deletingCommentId,
  saveVote,
  votingEnabled,
}: {
  resolvedFeedback: FeedbackSummary;
  currentUserId?: string;
  comment: string;
  editingCommentId: string | null;
  editComment: string;
  error: string | null;
  savingComment: boolean;
  savingEditComment: boolean;
  savingVote: boolean;
  setComment: (value: string) => void;
  setEditComment: (value: string) => void;
  startEditingComment: (commentId: string, body: string) => void;
  cancelEditingComment: () => void;
  saveComment: () => Promise<void>;
  saveEditedComment: () => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  deletingCommentId: string | null;
  saveVote: (value: "up" | "down") => Promise<void>;
  votingEnabled: boolean;
}) {
  const { t } = useI18n();
  const historyRef = useRef<HTMLDivElement | null>(null);
  const getEditActionAriaLabel = (body: string) => {
    const trimmed = body.trim();
    const preview = trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
    return formatMessage(t("trips.feedback.commentEditActionAria"), { preview });
  };
  const getDeleteActionAriaLabel = (body: string) => {
    const trimmed = body.trim();
    const preview = trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
    return formatMessage(t("trips.feedback.commentDeleteActionAria"), { preview });
  };

  useEffect(() => {
    const history = historyRef.current;
    if (!history) {
      return;
    }
    history.scrollTop = history.scrollHeight;
  }, [resolvedFeedback.comments]);

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={1.5}
      data-testid="feedback-chat-layout"
      sx={{ minHeight: { xs: "min(70vh, 32rem)", sm: "28rem" } }}
    >
      {votingEnabled ? (
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
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper
        ref={historyRef}
        variant="outlined"
        data-testid="feedback-message-history"
        sx={{
          flex: 1,
          minHeight: 0,
          px: 1.5,
          py: 1,
          borderRadius: 3,
          overflowY: "auto",
          backgroundColor: "#faf7f2",
          borderColor: "rgba(17,18,20,0.08)",
        }}
      >
        {resolvedFeedback.comments.length === 0 ? (
          <Box display="flex" alignItems="center" justifyContent="center" minHeight={160} px={1}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {t("trips.feedback.empty")}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
          {resolvedFeedback.comments.map((item) => (
            <ListItem key={item.id} disableGutters sx={{ display: "block", py: 0.75 }}>
              <Box
                display="flex"
                justifyContent={currentUserId === item.author.id ? "flex-end" : "flex-start"}
              >
                <Paper
                  variant="outlined"
                  data-testid={`feedback-comment-${item.id}`}
                  sx={{
                    maxWidth: "100%",
                    width: "fit-content",
                    minWidth: 0,
                    px: 1.25,
                    py: 1,
                    borderRadius: 3,
                    backgroundColor: currentUserId === item.author.id ? "#eef6ff" : "#ffffff",
                    borderColor: currentUserId === item.author.id ? "rgba(24, 94, 170, 0.2)" : "rgba(17,18,20,0.08)",
                  }}
                >
                  {editingCommentId === item.id ? (
                    <Box display="flex" flexDirection="column" gap={1}>
                      <TextField
                        label={t("trips.feedback.commentEditLabel")}
                        value={editComment}
                        onChange={(event) => setEditComment(event.target.value)}
                        multiline
                        minRows={2}
                        size="small"
                      />
                      <Box display="flex" justifyContent="flex-end" gap={1}>
                        <Button variant="text" size="small" onClick={cancelEditingComment}>
                          {t("trips.feedback.commentEditCancel")}
                        </Button>
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => void saveEditedComment()}
                          disabled={savingEditComment || !editComment.trim()}
                        >
                          {t("trips.feedback.commentEditSave")}
                        </Button>
                      </Box>
                    </Box>
                  ) : (
                    <Box
                      display="flex"
                      alignItems="flex-start"
                      gap={0.5}
                      sx={{ minWidth: 0 }}
                    >
                      <ListItemText
                        data-testid="feedback-comment-body"
                        primary={
                          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {item.body}
                          </Typography>
                        }
                        secondary={
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                          >
                            {item.author.email}
                          </Typography>
                        }
                        sx={{ m: 0, minWidth: 0, flex: 1 }}
                      />
                      {currentUserId === item.author.id ? (
                        <Box
                          data-testid="feedback-comment-actions"
                          display="flex"
                          alignItems="flex-start"
                          gap={0.25}
                          sx={{ flexShrink: 0, pt: 0.125 }}
                        >
                          <IconButton
                            size="small"
                            onClick={() => startEditingComment(item.id, item.body)}
                            aria-label={getEditActionAriaLabel(item.body)}
                            sx={{ p: 0.5, minWidth: 44, minHeight: 44 }}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => void deleteComment(item.id)}
                            aria-label={getDeleteActionAriaLabel(item.body)}
                            disabled={deletingCommentId === item.id}
                            sx={{ p: 0.5, minWidth: 44, minHeight: 44 }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      ) : null}
                    </Box>
                  )}
                </Paper>
              </Box>
            </ListItem>
          ))}
          </List>
        )}
      </Paper>
      <Box data-testid="feedback-composer">
        <Divider sx={{ mb: 1.5 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {t("trips.feedback.chatHelper")}
        </Typography>
        <TextField
          label={t("trips.feedback.commentLabel")}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          multiline
          minRows={2}
          size="small"
          fullWidth
        />
        <Box display="flex" justifyContent="flex-end" mt={1}>
          <Button variant="contained" size="small" onClick={() => void saveComment()} disabled={savingComment || !comment.trim()}>
            {t("trips.feedback.commentSubmit")}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

export default function TripFeedbackPanel({
  tripId,
  feedback,
  targetType,
  targetId,
  currentUserId,
  contextLabel,
  tripDayId,
  onUpdated,
}: TripFeedbackPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const canVote = supportsTripFeedbackVoting(targetType);
  const resolvedFeedback = feedback ?? buildDefaultFeedback(targetType, targetId);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [savingEditComment, setSavingEditComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [savingVote, setSavingVote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setComment("");
      setEditingCommentId(null);
      setEditComment("");
      setDeletingCommentId(null);
      setError(null);
    }
  }, [open]);

  const count = resolvedFeedback.comments.length;
  const commentCountLabel =
    count === 0
      ? t("trips.feedback.noComments")
      : count === 1
        ? formatMessage(t("trips.feedback.commentCountSingular"), { count })
        : formatMessage(t("trips.feedback.commentCountPlural"), { count });
  const visibleCommentCount = formatMessage(t("trips.feedback.commentCountCompact"), { count });

  const dialogTitle = canVote
    ? contextLabel
      ? formatMessage(t("trips.feedback.titleWithTarget"), { target: contextLabel })
      : t("trips.feedback.title")
    : contextLabel
      ? formatMessage(t("trips.feedback.commentsTitleWithTarget"), { target: contextLabel })
      : t("trips.feedback.commentsTitle");
  const openDialogLabel = contextLabel
    ? formatMessage(t("trips.feedback.openDialogAriaWithTarget"), { target: contextLabel })
    : t("trips.feedback.openDialogAria");
  const closeDialogLabel = contextLabel
    ? formatMessage(t("trips.feedback.closeDialogAriaWithTarget"), { target: contextLabel })
    : t("trips.feedback.closeDialogAria");
  const triggerLabel = canVote
    ? `${openDialogLabel}, ${commentCountLabel}, ${t("trips.feedback.voteUp")} ${resolvedFeedback.voteSummary.upCount}, ${t("trips.feedback.voteDown")} ${resolvedFeedback.voteSummary.downCount}`
    : `${openDialogLabel}, ${commentCountLabel}`;

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

  const startEditingComment = (commentId: string, body: string) => {
    setEditingCommentId(commentId);
    setEditComment(body);
    setError(null);
  };

  const cancelEditingComment = () => {
    setEditingCommentId(null);
    setEditComment("");
    setError(null);
  };

  const saveEditedComment = async () => {
    if (!editingCommentId) return;
    const body = editComment.trim();
    if (!body) return;

    setSavingEditComment(true);
    setError(null);
    try {
      const token = await fetchCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/feedback/comments/${editingCommentId}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ body }),
      });
      const payload = (await response.json()) as ApiEnvelope<{ feedback: FeedbackSummary }>;
      if (!response.ok || payload.error || !payload.data?.feedback) {
        setError(t("trips.feedback.editError"));
        return;
      }
      onUpdated(payload.data.feedback);
      setEditingCommentId(null);
      setEditComment("");
    } catch {
      setError(t("trips.feedback.editError"));
    } finally {
      setSavingEditComment(false);
    }
  };

  const saveVote = async (value: "up" | "down") => {
    if (!canVote) return;
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

  const deleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    setError(null);
    try {
      const token = await fetchCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/feedback/comments/${commentId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "x-csrf-token": token,
        },
      });
      const payload = (await response.json()) as ApiEnvelope<{ feedback: FeedbackSummary }>;
      if (!response.ok || payload.error || !payload.data?.feedback) {
        setError(t("trips.feedback.deleteError"));
        return;
      }
      onUpdated(payload.data.feedback);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditComment("");
      }
    } catch {
      setError(t("trips.feedback.deleteError"));
    } finally {
      setDeletingCommentId((current) => (current === commentId ? null : current));
    }
  };

  const closeDialog = () => {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  return (
    <>
      <Paper
        ref={triggerRef}
        component="button"
        type="button"
        elevation={0}
        onClick={() => setOpen(true)}
        aria-label={triggerLabel}
        sx={{
          width: "fit-content",
          maxWidth: "100%",
          minHeight: 44,
          alignSelf: "flex-start",
          mt: 0.5,
          px: 1.25,
          py: 1,
          borderRadius: 2,
          border: "1px solid rgba(17,18,20,0.08)",
          backgroundColor: "#f6f8fb",
          textAlign: "left",
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: 1,
          color: "inherit",
          cursor: "pointer",
          appearance: "none",
        }}
      >
        <Box display="flex" alignItems="center" gap={1} minWidth={0}>
          <CommentIcon />
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {visibleCommentCount}
          </Typography>
        </Box>
        {canVote ? (
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
        ) : null}
      </Paper>

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
            currentUserId={currentUserId}
            comment={comment}
            editingCommentId={editingCommentId}
            editComment={editComment}
            error={error}
            savingComment={savingComment}
            savingEditComment={savingEditComment}
            savingVote={savingVote}
            setComment={setComment}
            setEditComment={setEditComment}
            startEditingComment={startEditingComment}
            cancelEditingComment={cancelEditingComment}
            saveComment={saveComment}
            saveEditedComment={saveEditedComment}
            deleteComment={deleteComment}
            deletingCommentId={deletingCommentId}
            saveVote={saveVote}
            votingEnabled={canVote}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
