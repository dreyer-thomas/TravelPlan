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
  Divider,
  Link as MuiLink,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
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

type TripDayPlanDialogProps = {
  open: boolean;
  tripId: string;
  day: TripDay | null;
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

const extractText = (value: string) => {
  try {
    const doc = JSON.parse(value);
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (!node) return;
      if (typeof node.text === "string") {
        parts.push(node.text);
      }
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc as { text?: string; content?: unknown[] });
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};

export default function TripDayPlanDialog({ open, tripId, day, onClose, onSaved }: TripDayPlanDialogProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [items, setItems] = useState<DayPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
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
    setSelectedItemId(null);
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

  const loadItems = useCallback(async () => {
    if (!day) return;
    setLoading(true);
    setServerError(null);

    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items?tripDayId=${day.id}`, {
        method: "GET",
        credentials: "include",
      });
      const body = (await response.json()) as ApiEnvelope<{ items: DayPlanItem[] }>;

      if (!response.ok || body.error || !body.data) {
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
              return t("trips.plan.loadError");
          }
        };

        setServerError(resolveApiError(body.error?.code));
        setItems([]);
        resetEditor();
        return;
      }

      setItems(body.data.items);
      resetEditor();
    } catch {
      setServerError(t("trips.plan.loadError"));
      setItems([]);
      resetEditor();
    } finally {
      setLoading(false);
    }
  }, [day, resetEditor, t, tripId]);

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setCsrfToken(null);
    setDeletingId(null);
    resetEditor();
  }, [open, resetEditor]);

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
    loadItems();

    return () => {
      active = false;
    };
  }, [day, loadItems, open, t]);

  const title = useMemo(() => {
    if (!day) return t("trips.plan.title");
    return formatMessage(t("trips.plan.title"), { index: day.dayIndex });
  }, [day, t]);

  const handleSelectItem = (item: DayPlanItem) => {
    setSelectedItemId(item.id);
    setLinkUrl(item.linkUrl ?? "");
    setFieldErrors({});
    setEditorContent(item.contentJson);
  };

  const handleCreateNew = () => {
    resetEditor();
  };

  const handleSave = async () => {
    if (!day) return;
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

    if (selectedItemId) {
      payload.itemId = selectedItemId;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items`, {
        method: selectedItemId ? "PATCH" : "POST",
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
              return t("trips.plan.saveError");
          }
        };

        setServerError(resolveApiError(body.error?.code));
        return;
      }

      await loadItems();
      onSaved();

      if (body.data?.dayPlanItem) {
        setSelectedItemId(body.data.dayPlanItem.id);
        setLinkUrl(body.data.dayPlanItem.linkUrl ?? "");
        setEditorContent(body.data.dayPlanItem.contentJson);
      }
    } catch {
      setServerError(t("trips.plan.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!day) return;
    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setServerError(null);
    setDeletingId(itemId);

    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ tripDayId: day.id, itemId }),
      });

      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

      if (!response.ok || body.error) {
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
              return t("trips.plan.deleteError");
          }
        };

        setServerError(resolveApiError(body.error?.code));
        return;
      }

      await loadItems();
      onSaved();

      if (selectedItemId === itemId) {
        resetEditor();
      }
    } catch {
      setServerError(t("trips.plan.deleteError"));
    } finally {
      setDeletingId(null);
    }
  };

  const selectedLabel = selectedItemId ? t("trips.plan.editItem") : t("trips.plan.addItem");
  const saveLabel = selectedItemId ? t("trips.plan.saveUpdate") : t("trips.plan.saveNew");
  const isBusy = loading || saving || Boolean(deletingId);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Typography variant="h6" fontWeight={600} component="div">
          {title}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2.5}>
          {serverError && <Alert severity="error">{serverError}</Alert>}

          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Typography variant="subtitle1" fontWeight={600}>
              {selectedLabel}
            </Typography>
            <Button variant="outlined" size="small" onClick={handleCreateNew} disabled={isBusy}>
              {t("trips.plan.newItem")}
            </Button>
          </Box>

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

          <Divider />

          <Typography variant="subtitle2" color="text.secondary">
            {t("trips.plan.itemsTitle")}
          </Typography>

          {loading && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={20} />
              <Typography variant="body2">{t("trips.plan.loading")}</Typography>
            </Box>
          )}

          {!loading && items.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("trips.plan.empty")}
            </Typography>
          )}

          {!loading && items.length > 0 && (
            <List disablePadding>
              {items.map((item) => {
                const preview = extractText(item.contentJson) || t("trips.plan.previewFallback");
                const isSelected = item.id === selectedItemId;
                return (
                  <ListItem
                    key={item.id}
                    divider
                    disablePadding
                    sx={{
                      py: 1,
                      px: 1.5,
                      borderRadius: 2,
                      backgroundColor: isSelected ? "rgba(0,0,0,0.04)" : "transparent",
                    }}
                    secondaryAction={
                      <Box display="flex" alignItems="center" gap={1}>
                        <Button size="small" onClick={() => handleSelectItem(item)} disabled={isBusy}>
                          {t("trips.plan.editItem")}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleDelete(item.id)}
                          disabled={isBusy}
                        >
                          {deletingId === item.id ? <CircularProgress size={18} /> : t("trips.plan.deleteItem")}
                        </Button>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={preview}
                      secondary={
                        item.linkUrl ? (
                          <MuiLink href={item.linkUrl} target="_blank" rel="noreferrer noopener">
                            {t("trips.plan.linkOpen")}
                          </MuiLink>
                        ) : (
                          t("trips.plan.noLink")
                        )
                      }
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
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
