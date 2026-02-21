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
  SvgIcon,
  TextField,
  Typography,
} from "@mui/material";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Node } from "@tiptap/core";
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
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  linkUrl: string | null;
  location: { lat: number; lng: number; label?: string | null } | null;
  createdAt: string;
};

type GalleryImage = {
  id: string;
  imageUrl: string;
  sortOrder: number;
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

const PlanImage = Node.create({
  name: "image",
  group: "block",
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", HTMLAttributes];
  },
  addCommands() {
    return {
      setImage:
        (attrs: { src: string; alt?: string; title?: string }) =>
        ({ commands }: { commands: { insertContent: (value: unknown) => boolean } }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});

const toDocString = (value: object) => JSON.stringify(value);

const parseDoc = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return emptyDoc;
  }
};

const formatCentsAsAmount = (value: number) => (value / 100).toFixed(2);

const parseAmountToCents = (rawValue: string): number | null => {
  const value = rawValue.trim();
  if (!value) return null;

  const compact = value.replace(/\s+/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = compact.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (lastComma !== -1) {
    normalized = compact.replace(",", ".");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
};

export default function TripDayPlanDialog({ open, mode, tripId, day, item, onClose, onSaved }: TripDayPlanDialogProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingInit, setLoadingInit] = useState(false);
  const [contentJson, setContentJson] = useState<string>(toDocString(emptyDoc));
  const [titleInput, setTitleInput] = useState<string>("");
  const [costCentsInput, setCostCentsInput] = useState<string>("");
  const [fromTimeInput, setFromTimeInput] = useState<string>("");
  const [toTimeInput, setToTimeInput] = useState<string>("");
  const [linkUrl, setLinkUrl] = useState<string>("");
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lng: number; label?: string | null } | null>(
    null,
  );
  const [locationQuery, setLocationQuery] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    fromTime?: string;
    toTime?: string;
    contentJson?: string;
    costCents?: string;
    linkUrl?: string;
  }>(
    {},
  );
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryFile, setGalleryFile] = useState<File | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ imageUrl: string; alt: string } | null>(null);
  const editingItemId = mode === "edit" ? (item?.id ?? null) : null;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      PlanImage,
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
    setTitleInput("");
    setFromTimeInput("");
    setToTimeInput("");
    setCostCentsInput("");
    setLinkUrl("");
    setResolvedLocation(null);
    setLocationQuery("");
    setFieldErrors({});
    if (editor) {
      editor.commands.setContent(emptyDoc, { emitUpdate: false });
    }
  }, [editor]);

  const setEditorContent = useCallback(
    (value: string) => {
      setContentJson(value);
      if (editor) {
        editor.commands.setContent(parseDoc(value), { emitUpdate: false });
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
      setTitleInput(item.title ?? "");
      setFromTimeInput(item.fromTime ?? "");
      setToTimeInput(item.toTime ?? "");
      setCostCentsInput(item.costCents !== null ? formatCentsAsAmount(item.costCents) : "");
      setLinkUrl(item.linkUrl ?? "");
      setResolvedLocation(item.location ?? null);
      setLocationQuery(item.location?.label ?? "");
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

  useEffect(() => {
    if (!open || !day || !editingItemId) {
      setGalleryImages([]);
      return;
    }
    let active = true;

    const loadGallery = async () => {
      try {
        const response = await fetch(
          `/api/trips/${tripId}/day-plan-items/images?tripDayId=${day.id}&dayPlanItemId=${editingItemId}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );
        const body = (await response.json()) as ApiEnvelope<{ images: GalleryImage[] }>;
        if (!active) return;
        if (!response.ok || body.error) {
          setGalleryImages([]);
          return;
        }
        setGalleryImages(body.data?.images ?? []);
      } catch {
        if (active) setGalleryImages([]);
      }
    };

    void loadGallery();
    return () => {
      active = false;
    };
  }, [day, editingItemId, open, tripId]);

  const title = useMemo(() => {
    if (mode === "edit") return t("trips.plan.editDialogTitle");
    return t("trips.plan.addDialogTitle");
  }, [mode, t]);

  const subtitle = useMemo(() => {
    if (!day) return null;
    return formatMessage(t("trips.plan.title"), { index: day.dayIndex });
  }, [day, t]);

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

    const trimmedCost = costCentsInput.trim();
    const trimmedLink = linkUrl.trim();
    const parsedCostCents = parseAmountToCents(trimmedCost);

    if (trimmedCost.length > 0 && parsedCostCents === null) {
      setSaving(false);
      setFieldErrors({ costCents: t("trips.plan.costInvalid") });
      return;
    }

    const payload = {
      tripDayId: day.id,
      title: titleInput.trim(),
      fromTime: fromTimeInput.trim(),
      toTime: toTimeInput.trim(),
      contentJson,
      costCents: trimmedCost.length > 0 ? parsedCostCents : null,
      linkUrl: trimmedLink.length > 0 ? trimmedLink : null,
      location: resolvedLocation,
    } as {
      tripDayId: string;
      title: string;
      fromTime: string;
      toTime: string;
      contentJson: string;
      costCents: number | null;
      linkUrl: string | null;
      location: { lat: number; lng: number; label?: string | null } | null;
      itemId?: string;
    };

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
          const nextErrors: {
            title?: string;
            fromTime?: string;
            toTime?: string;
            contentJson?: string;
            costCents?: string;
            linkUrl?: string;
          } = {};
          Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
            if (messages?.[0]) {
              if (field === "title") nextErrors.title = messages[0];
              if (field === "fromTime") nextErrors.fromTime = messages[0];
              if (field === "toTime") nextErrors.toTime = messages[0];
              if (field === "contentJson") nextErrors.contentJson = messages[0];
              if (field === "costCents") nextErrors.costCents = messages[0];
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

  const handleInsertLink = () => {
    if (!editor) return;
    const href = window.prompt(t("trips.plan.toolbarLinkPrompt"), linkUrl.trim());
    if (!href) return;
    const trimmed = href.trim();
    if (!trimmed) return;
    (editor as unknown as { chain: () => { focus: () => { setLink: (value: { href: string }) => { run: () => boolean } } } })
      .chain()
      .focus()
      .setLink({ href: trimmed })
      .run();
  };

  const handleInsertImage = () => {
    if (!editor) return;
    const src = window.prompt(t("trips.plan.toolbarImagePrompt"), "https://");
    if (!src) return;
    const trimmed = src.trim();
    if (!trimmed) return;
    (editor as unknown as { chain: () => { focus: () => { setImage: (value: { src: string; alt: string }) => { run: () => boolean } } } })
      .chain()
      .focus()
      .setImage({ src: trimmed, alt: t("trips.plan.inlineImageAlt") })
      .run();
  };

  const handleLookupLocation = async () => {
    const query = locationQuery.trim();
    if (!query) {
      setServerError(t("trips.location.searchRequired"));
      return;
    }

    setServerError(null);
    setLookupLoading(true);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        method: "GET",
        credentials: "include",
      });
      const body = (await response.json()) as ApiEnvelope<{
        result: { lat: number; lng: number; label: string } | null;
      }>;

      if (!response.ok || body.error) {
        setServerError(body.error?.message ?? t("trips.location.lookupError"));
        return;
      }

      if (!body.data?.result) {
        setServerError(t("trips.location.noResult"));
        return;
      }

      setResolvedLocation({
        lat: body.data.result.lat,
        lng: body.data.result.lng,
        label: body.data.result.label,
      });
      setLocationQuery(body.data.result.label);
    } catch {
      setServerError(t("trips.location.lookupError"));
    } finally {
      setLookupLoading(false);
    }
  };

  const uploadGalleryImage = async () => {
    if (!day || !editingItemId || !galleryFile || !csrfToken) return;

    setGalleryBusy(true);
    setServerError(null);
    try {
      const formData = new FormData();
      formData.set("tripDayId", day.id);
      formData.set("dayPlanItemId", editingItemId);
      formData.set("file", galleryFile);
      const response = await fetch(`/api/trips/${tripId}/day-plan-items/images`, {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": csrfToken },
        body: formData,
      });
      const body = (await response.json()) as ApiEnvelope<{ image: GalleryImage }>;
      if (!response.ok || body.error || !body.data?.image) {
        setServerError(t("trips.plan.saveError"));
        return;
      }
      setGalleryImages((current) => [...current, body.data!.image]);
      setGalleryFile(null);
    } catch {
      setServerError(t("trips.plan.saveError"));
    } finally {
      setGalleryBusy(false);
    }
  };

  const deleteGalleryImage = async (imageId: string) => {
    if (!day || !editingItemId || !csrfToken) return;

    setGalleryBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items/images`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          tripDayId: day.id,
          dayPlanItemId: editingItemId,
          imageId,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || body.error) {
        setServerError(t("trips.plan.saveError"));
        return;
      }
      setGalleryImages((current) => current.filter((image) => image.id !== imageId));
    } catch {
      setServerError(t("trips.plan.saveError"));
    } finally {
      setGalleryBusy(false);
    }
  };

  const reorderGalleryImages = async (nextImages: GalleryImage[]) => {
    if (!day || !editingItemId || !csrfToken) return;

    setGalleryBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items/images`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          tripDayId: day.id,
          dayPlanItemId: editingItemId,
          order: nextImages.map((image, index) => ({ imageId: image.id, sortOrder: index + 1 })),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ reordered: boolean }>;
      if (!response.ok || body.error) {
        setServerError(t("trips.plan.saveError"));
        return;
      }
      setGalleryImages(nextImages.map((image, index) => ({ ...image, sortOrder: index + 1 })));
    } catch {
      setServerError(t("trips.plan.saveError"));
    } finally {
      setGalleryBusy(false);
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
              <Box display="flex" gap={0.75} flexWrap="wrap" mb={1.25}>
                <Button
                  variant={editor?.isActive("bold") ? "contained" : "outlined"}
                  size="small"
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                  disabled={isBusy || !editor}
                  aria-label={t("trips.plan.toolbarBold")}
                  title={t("trips.plan.toolbarBold")}
                  sx={{ minWidth: 36, px: 0.5 }}
                >
                  <Typography component="span" sx={{ fontWeight: 800, fontSize: "0.95rem", lineHeight: 1 }}>
                    B
                  </Typography>
                </Button>
                <Button
                  variant={editor?.isActive("italic") ? "contained" : "outlined"}
                  size="small"
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                  disabled={isBusy || !editor}
                  aria-label={t("trips.plan.toolbarItalic")}
                  title={t("trips.plan.toolbarItalic")}
                  sx={{ minWidth: 36, px: 0.5 }}
                >
                  <Typography component="span" sx={{ fontStyle: "italic", fontSize: "0.95rem", lineHeight: 1 }}>
                    I
                  </Typography>
                </Button>
                <Button
                  variant={editor?.isActive("bulletList") ? "contained" : "outlined"}
                  size="small"
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                  disabled={isBusy || !editor}
                  aria-label={t("trips.plan.toolbarBulletList")}
                  title={t("trips.plan.toolbarBulletList")}
                  sx={{ minWidth: 36, px: 0.5 }}
                >
                  <SvgIcon fontSize="small">
                    <path d="M4 7a1 1 0 1 0 0.001 0zM7 6h13v2H7zM4 12a1 1 0 1 0 0.001 0zM7 11h13v2H7zM4 17a1 1 0 1 0 0.001 0zM7 16h13v2H7z" />
                  </SvgIcon>
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleInsertLink}
                  disabled={isBusy || !editor}
                  aria-label={t("trips.plan.toolbarLink")}
                  title={t("trips.plan.toolbarLink")}
                  sx={{ minWidth: 36, px: 0.5 }}
                >
                  <SvgIcon fontSize="small">
                    <path d="M10.59 13.41a1.996 1.996 0 0 1 0-2.82l2.18-2.18a2 2 0 1 1 2.83 2.83l-1.06 1.06 1.41 1.41 1.06-1.06a4 4 0 0 0-5.66-5.66L9.17 9.17a4 4 0 0 0 0 5.66l.12.12 1.41-1.41-.11-.13zm2.82-2.82-2.82 2.82-1.41-1.41L12 9.17l1.41 1.42zm-6.18 1.11L6.17 12.76a4 4 0 1 0 5.66 5.66l2.18-2.18a4 4 0 0 0 0-5.66l-.12-.12-1.41 1.41.12.12a2 2 0 0 1 0 2.83l-2.18 2.18a2 2 0 1 1-2.83-2.83l1.06-1.06-1.4-1.4z" />
                  </SvgIcon>
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleInsertImage}
                  disabled={isBusy || !editor}
                  aria-label={t("trips.plan.toolbarImage")}
                  title={t("trips.plan.toolbarImage")}
                  sx={{ minWidth: 36, px: 0.5 }}
                >
                  <SvgIcon fontSize="small">
                    <path d="M21 19V5a2 2 0 0 0-2-2H5C3.9 3 3 3.9 3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 11.5 11 15l3.5-4.5L19 17H5l3.5-5.5zM8 8a1.5 1.5 0 1 0 0.001 0z" />
                  </SvgIcon>
                </Button>
              </Box>
              {editor ? <EditorContent editor={editor} /> : <Typography>{t("trips.plan.editorLoading")}</Typography>}
            </Box>
            {fieldErrors.contentJson && (
              <Typography variant="caption" color="error">
                {fieldErrors.contentJson}
              </Typography>
            )}
          </Box>

          <TextField
            label={t("trips.plan.titleLabel")}
            value={titleInput}
            onChange={(event) => setTitleInput(event.target.value)}
            error={Boolean(fieldErrors.title)}
            helperText={fieldErrors.title ?? t("trips.plan.titleHelper")}
            fullWidth
            inputProps={{ maxLength: 120 }}
          />
          <Box display="flex" gap={1}>
            <TextField
              label={t("trips.plan.fromTimeLabel")}
              value={fromTimeInput}
              onChange={(event) => setFromTimeInput(event.target.value)}
              error={Boolean(fieldErrors.fromTime)}
              helperText={fieldErrors.fromTime ?? t("trips.plan.fromTimeHelper")}
              fullWidth
              type="time"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label={t("trips.plan.toTimeLabel")}
              value={toTimeInput}
              onChange={(event) => setToTimeInput(event.target.value)}
              error={Boolean(fieldErrors.toTime)}
              helperText={fieldErrors.toTime ?? t("trips.plan.toTimeHelper")}
              fullWidth
              type="time"
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          <TextField
            label={t("trips.plan.costLabel")}
            value={costCentsInput}
            onChange={(event) => setCostCentsInput(event.target.value)}
            error={Boolean(fieldErrors.costCents)}
            helperText={fieldErrors.costCents ?? t("trips.plan.costHelper")}
            fullWidth
            type="text"
            inputMode="decimal"
            placeholder="0.00"
          />
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
          <Box display="flex" gap={1} alignItems="flex-start">
            <TextField
              label={t("trips.location.searchLabel")}
              value={locationQuery}
              onChange={(event) => setLocationQuery(event.target.value)}
              fullWidth
            />
            <Button
              variant="outlined"
              onClick={() => void handleLookupLocation()}
              disabled={isBusy || lookupLoading}
              sx={{ mt: 1 }}
            >
              {lookupLoading ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
            </Button>
            <Button
              variant="text"
              onClick={() => setResolvedLocation(null)}
              disabled={isBusy || lookupLoading || !resolvedLocation}
              sx={{ mt: 1 }}
            >
              {t("trips.location.clearAction")}
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {resolvedLocation
              ? `${t("trips.location.latLabel")}: ${resolvedLocation.lat.toFixed(6)} · ${t("trips.location.lngLabel")}: ${resolvedLocation.lng.toFixed(6)}`
              : t("trips.location.noCoordinates")}
          </Typography>
          {editingItemId && (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="body2" fontWeight={600}>
                {t("trips.gallery.title")}
              </Typography>
              <Box display="flex" gap={1} alignItems="center">
                <TextField
                  size="small"
                  type="file"
                  onChange={(event) => {
                    const input = event.currentTarget as HTMLInputElement;
                    setGalleryFile(input.files?.[0] ?? null);
                  }}
                  inputProps={{ accept: "image/jpeg,image/png,image/webp" }}
                  fullWidth
                />
                <Button variant="outlined" onClick={() => void uploadGalleryImage()} disabled={!galleryFile || galleryBusy}>
                  {t("trips.gallery.uploadAction")}
                </Button>
              </Box>
              {galleryImages.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {t("trips.gallery.empty")}
                </Typography>
              ) : (
                <Box display="flex" flexDirection="column" gap={0.75}>
                  {galleryImages
                    .slice()
                    .sort((left, right) => left.sortOrder - right.sortOrder)
                    .map((image, index, all) => (
                      <Box key={image.id} display="flex" alignItems="center" gap={1}>
                        <Box
                          component="img"
                          src={image.imageUrl}
                          alt={t("trips.gallery.thumbnailAlt")}
                          sx={{ width: 42, height: 42, objectFit: "cover", borderRadius: 1, cursor: "pointer" }}
                          loading="lazy"
                          onClick={() => setFullscreenImage({ imageUrl: image.imageUrl, alt: t("trips.gallery.thumbnailAlt") })}
                        />
                        <Button
                          size="small"
                          onClick={() => {
                            if (index === 0) return;
                            const next = [...all];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            void reorderGalleryImages(next);
                          }}
                          disabled={index === 0 || galleryBusy}
                        >
                          {t("trips.gallery.moveUp")}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            if (index === all.length - 1) return;
                            const next = [...all];
                            [next[index], next[index + 1]] = [next[index + 1], next[index]];
                            void reorderGalleryImages(next);
                          }}
                          disabled={index === all.length - 1 || galleryBusy}
                        >
                          {t("trips.gallery.moveDown")}
                        </Button>
                        <Button size="small" color="error" onClick={() => void deleteGalleryImage(image.id)} disabled={galleryBusy}>
                          {t("trips.gallery.removeAction")}
                        </Button>
                      </Box>
                    ))}
                </Box>
              )}
            </Box>
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
      <Dialog
        open={Boolean(fullscreenImage)}
        onClose={() => setFullscreenImage(null)}
        maxWidth={false}
        sx={{
          "& .MuiDialog-paper": {
            backgroundColor: "transparent",
            boxShadow: "none",
            m: 0,
          },
        }}
        onKeyDown={() => setFullscreenImage(null)}
      >
        {fullscreenImage ? (
          <DialogContent
            onClick={() => setFullscreenImage(null)}
            sx={{
              p: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "100vw",
              minHeight: "100vh",
              backgroundColor: "rgba(0, 0, 0, 0.85)",
              cursor: "zoom-out",
            }}
          >
            <Box
              component="img"
              src={fullscreenImage.imageUrl}
              alt={fullscreenImage.alt}
              sx={{
                maxWidth: "96vw",
                maxHeight: "96vh",
                objectFit: "contain",
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </Dialog>
  );
}
