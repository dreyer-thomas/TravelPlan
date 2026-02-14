"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripDay = {
  id: string;
  dayIndex: number;
};

type DayPlanItem = {
  id: string;
  tripDayId: string;
  contentJson: string;
  linkUrl: string | null;
  createdAt: string;
};

type PlanDialogMode = "add" | "edit";

type TripDayPlanDialogProps = {
  open: boolean;
  mode: PlanDialogMode;
  tripId: string;
  day: TripDay | null;
  item: DayPlanItem | null;
  onClose: () => void;
  onSaved: () => void;
};

const emptyDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const toDocString = (value: object) => JSON.stringify(value);

const parseDoc = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return emptyDoc;
  }
};

export default function TripDayPlanDialog({ open, mode, tripId, day, item, onClose, onSaved }: TripDayPlanDialogProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingInit, setLoadingInit] = useState(false);
  const [contentJson, setContentJson] = useState<string>(toDocString(emptyDoc));
  const [linkUrl, setLinkUrl] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<{ contentJson?: string; linkUrl?: string }>({});

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      }),
    ],
    content: emptyDoc,
    editorProps: {
      attributes: {
        class: "tiptap-editor",
        style: "min-height: 160px; outline: none;",
      },
    },
    onUpdate: ({ editor: instance }) => {
      setContentJson(JSON.stringify(instance.getJSON()));
    },
  });

  const resetEditor = useCallback(() => {
    setContentJson(toDocString(emptyDoc));
    setLinkUrl("");
    setFieldErrors({});
    if (editor) {
      editor.commands.setContent(emptyDoc, false);
    }
  }, [editor]);

  const setEditorContent = useCallback(
    (value: string) => {
      setContentJson(value);
      if (editor) {
        editor.commands.setContent(parseDoc(value), false);
      }
    },
    [editor],
  );

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setCsrfToken(null);
    setFieldErrors({});
    setLoadingInit(true);

    if (mode === "edit" && item) {
      setLinkUrl(item.linkUrl ?? "");
      setEditorContent(item.contentJson);
    } else {
      resetEditor();
    }
    setLoadingInit(false);
  }, [item, mode, open, resetEditor, setEditorContent]);

  useEffect(() => {
    if (!open || !day) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setServerError(body.error?.message ?? t("trips.plan.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.plan.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [day, open, t]);

  const title = useMemo(() => {
    if (mode === "edit") return t("trips.plan.editDialogTitle");
    return t("trips.plan.addDialogTitle");
  }, [mode, t]);

  const subtitle = useMemo(() => {
    if (!day) return null;
    return formatMessage(t("trips.plan.title"), { index: day.dayIndex });
  }, [day, t]);

  const editingItemId = mode === "edit" ? (item?.id ?? null) : null;

  const saveLabel = mode === "edit" ? t("trips.plan.saveUpdate") : t("trips.plan.saveNew");
  const isBusy = saving || loadingInit;

  const resolveApiError = useCallback(
    (code: string | undefined, fallback: string) => {
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
          return fallback;
      }
    },
    [t],
  );

  const handleSave = async () => {
    if (!day) return;
    if (mode === "edit" && !editingItemId) {
      setServerError(t("trips.plan.editItemMissing"));
      return;
    }
    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setServerError(null);
    setFieldErrors({});
    setSaving(true);

    const trimmedLink = linkUrl.trim();
    const payload = {
      tripDayId: day.id,
      contentJson,
      linkUrl: trimmedLink.length > 0 ? trimmedLink : null,
    } as { tripDayId: string; contentJson: string; linkUrl: string | null; itemId?: string };

    if (mode === "edit" && editingItemId) {
      payload.itemId = editingItemId;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items`, {
        method: mode === "edit" ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as ApiEnvelope<{ dayPlanItem: DayPlanItem }>;

      if (!response.ok || body.error) {
        if (body.error?.code === "validation_error" && body.error.details) {
          const details = body.error.details as { fieldErrors?: Record<string, string[]> };
          const nextErrors: { contentJson?: string; linkUrl?: string } = {};
          Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
            if (messages?.[0]) {
              if (field === "contentJson") nextErrors.contentJson = messages[0];
              if (field === "linkUrl") nextErrors.linkUrl = messages[0];
            }
          });
          setFieldErrors(nextErrors);
          return;
        }

        const fallback = mode === "edit" ? t("trips.plan.saveError") : t("trips.plan.saveError");
        setServerError(resolveApiError(body.error?.code, fallback));
        return;
      }

      onSaved();
    } catch {
      setServerError(t("trips.plan.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Typography variant="h6" fontWeight={600} component="div" gutterBottom>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2.5}>
          {serverError && <Alert severity="error">{serverError}</Alert>}

          <Box display="flex" flexDirection="column" gap={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t("trips.plan.contentLabel")}
            </Typography>
            <Box
              sx={{
                border: "1px solid",
                borderColor: fieldErrors.contentJson ? "error.main" : "divider",
                borderRadius: 2,
                p: 2,
                backgroundColor: "#fff",
                minHeight: 180,
              }}
            >
              {editor ? <EditorContent editor={editor} /> : <Typography>{t("trips.plan.editorLoading")}</Typography>}
            </Box>
            <Typography variant="caption" color={fieldErrors.contentJson ? "error" : "text.secondary"}>
              {fieldErrors.contentJson ?? t("trips.plan.contentHelper")}
            </Typography>
          </Box>

          <TextField
            label={t("trips.plan.linkLabel")}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            error={Boolean(fieldErrors.linkUrl)}
            helperText={fieldErrors.linkUrl ?? t("trips.plan.linkHelper")}
            fullWidth
            type="url"
            inputMode="url"
            placeholder="https://"
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Button onClick={onClose} disabled={isBusy}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={isBusy || !day}>
          {saving ? <CircularProgress size={22} /> : saveLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
