"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  SvgIcon,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import FullscreenPhotoViewer from "@/components/ui/FullscreenPhotoViewer";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Node } from "@tiptap/core";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { IMAGE_UPLOAD_ACCEPT, isSupportedImageUpload } from "@/lib/trips/imageUploads";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: { src: string; alt?: string; title?: string }) => ReturnType;
    };
  }
}

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripDay = {
  id: string;
  date: string;
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
  payments?: { amountCents: number; dueDate: string }[];
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

type PlanDialogPrefill = {
  title: string;
  contentJson: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  bucketListItemId: string;
};

type TripDayPlanDialogProps = {
  open: boolean;
  mode: PlanDialogMode;
  tripId: string;
  day: TripDay | null;
  item: DayPlanItem | null;
  prefill?: PlanDialogPrefill | null;
  onDelete?: (itemId: string) => Promise<boolean>;
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
        ({ commands }) =>
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

const toDateOnly = (value?: string | null) => {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

/**
 * The TipTap toolbar's five buttons.
 *
 * `minWidth: 36` measured 36x44 in the browser — below the 44x44 floor DESIGN.md:266 sets and the
 * one place in these four dialogs that was under it. The height already came from theme.ts's
 * `MuiButton` override; only the width needed raising.
 */
const TOOLBAR_BUTTON_SX = { minWidth: 44, width: 44, px: 0 } as const;

const buildDefaultPayments = ({
  payments,
  costCents,
  fallbackDate,
}: {
  payments?: { amountCents: number; dueDate: string }[];
  costCents: number | null | undefined;
  fallbackDate: string;
}) => {
  if (payments && payments.length > 0) {
    return payments.map((payment) => ({
      amount: formatCentsAsAmount(payment.amountCents),
      dueDate: payment.dueDate,
    }));
  }
  if (typeof costCents === "number") {
    return [{ amount: formatCentsAsAmount(costCents), dueDate: fallbackDate }];
  }
  return [{ amount: "", dueDate: "" }];
};

export default function TripDayPlanDialog({
  open,
  mode,
  tripId,
  day,
  item,
  prefill = null,
  onDelete,
  onClose,
  onSaved,
}: TripDayPlanDialogProps) {
  const { t } = useI18n();
  // Unique `htmlFor`/`id` prefix for the above-field labels this restyle introduces.
  const fieldIdPrefix = useId();
  const { tokens } = useTheme().palette;
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingInit, setLoadingInit] = useState(false);
  const [contentJson, setContentJson] = useState<string>(toDocString(emptyDoc));
  const [titleInput, setTitleInput] = useState<string>("");
  const [costCentsInput, setCostCentsInput] = useState<string>("");
  const [fromTimeInput, setFromTimeInput] = useState<string>("");
  const [toTimeInput, setToTimeInput] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<"single" | "split">("single");
  const [payments, setPayments] = useState<Array<{ amount: string; dueDate: string }>>([]);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentRowErrors, setPaymentRowErrors] = useState<Array<{ amount?: string; dueDate?: string }>>([]);
  const skipPaymentNormalization = useRef(false);
  const skipCostSync = useRef(false);
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
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  // The index into `galleryPreviews`, not a URL — the shared viewer pages through the collection.
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const deleteTouchGuard = useRef(false);
  const editingItemId = mode === "edit" ? (item?.id ?? null) : null;
  const defaultDueDate = useMemo(() => toDateOnly(day?.date), [day?.date]);
  const sortedGalleryImages = useMemo(
    () => galleryImages.slice().sort((left, right) => left.sortOrder - right.sortOrder),
    [galleryImages],
  );

  // Built once and handed to both the strip and the viewer, so the alt a thumbnail announces is the
  // one the viewer announces for the same image.
  const galleryPreviews = useMemo(
    () =>
      sortedGalleryImages.map((image, index) => ({
        key: image.id,
        imageUrl: image.imageUrl,
        alt: formatMessage(t("trips.gallery.imageAlt"), {
          index: index + 1,
          total: sortedGalleryImages.length,
        }),
      })),
    [sortedGalleryImages, t],
  );

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
        // The block's caps label is above the editor, not on it — a contenteditable is a textbox in
        // the a11y tree and would otherwise be the one unnamed control on the surface.
        "aria-labelledby": `${fieldIdPrefix}-content-label`,
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
    setPaymentMode("single");
    setPayments(buildDefaultPayments({ payments: [], costCents: null, fallbackDate: defaultDueDate }));
    setPaymentError(null);
    setPaymentRowErrors([]);
    setLinkUrl("");
    setResolvedLocation(null);
    setLocationQuery("");
    setFieldErrors({});
    if (editor) {
      editor.commands.setContent(emptyDoc, { emitUpdate: false });
    }
  }, [defaultDueDate, editor]);

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
    setGalleryFiles([]);
    setFullscreenIndex(null);
    setLoadingInit(true);

    if (mode === "edit" && item) {
      setTitleInput(item.title ?? "");
      setFromTimeInput(item.fromTime ?? "");
      setToTimeInput(item.toTime ?? "");
      setCostCentsInput(item.costCents !== null ? formatCentsAsAmount(item.costCents) : "");
      const initialMode = item.payments && item.payments.length > 1 ? "split" : "single";
      skipPaymentNormalization.current = true;
      skipCostSync.current = true;
      setPaymentMode(initialMode);
      setPayments(buildDefaultPayments({ payments: item.payments, costCents: item.costCents, fallbackDate: defaultDueDate }));
      setPaymentError(null);
      setPaymentRowErrors([]);
      setLinkUrl(item.linkUrl ?? "");
      setResolvedLocation(item.location ?? null);
      setLocationQuery(item.location?.label ?? "");
      setEditorContent(item.contentJson);
    } else if (mode === "add" && prefill) {
      setTitleInput(prefill.title ?? "");
      setFromTimeInput("");
      setToTimeInput("");
      setCostCentsInput("");
      setPaymentMode("single");
      setPayments(buildDefaultPayments({ payments: [], costCents: null, fallbackDate: defaultDueDate }));
      setPaymentError(null);
      setPaymentRowErrors([]);
      setLinkUrl("");
      setResolvedLocation(prefill.location ?? null);
      setLocationQuery(prefill.location?.label ?? "");
      setEditorContent(prefill.contentJson);
    } else {
      resetEditor();
    }
    setLoadingInit(false);
  }, [defaultDueDate, item, mode, open, prefill, resetEditor, setEditorContent]);

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

  useEffect(() => {
    if (!open) return;
    if (skipPaymentNormalization.current) {
      skipPaymentNormalization.current = false;
      return;
    }
    if (paymentMode === "split") {
      if (payments.length < 2) {
        setPayments((current) => {
          const next = [...current];
          while (next.length < 2) {
            next.push({ amount: "", dueDate: defaultDueDate });
          }
          return next;
        });
      }
    } else if (payments.length !== 1) {
      setPayments((current) => {
        const first = current[0];
        return [
          {
            amount: first?.amount ?? "",
            dueDate: first?.dueDate ?? defaultDueDate,
          },
        ];
      });
    }
  }, [defaultDueDate, open, paymentMode, payments.length]);

  useEffect(() => {
    if (!open) return;
    if (paymentMode !== "single") return;
    if (skipCostSync.current) {
      skipCostSync.current = false;
      return;
    }
    const normalized = costCentsInput.trim();
    setPayments((current) => {
      const next = [...current];
      if (!next[0]) {
        return [{ amount: normalized, dueDate: normalized ? defaultDueDate : "" }];
      }
      if (next[0].amount === normalized) return current;
      next[0] = {
        ...next[0],
        amount: normalized,
        dueDate: next[0].dueDate || (normalized ? defaultDueDate : ""),
      };
      return next;
    });
  }, [costCentsInput, defaultDueDate, open, paymentMode]);

  const title = useMemo(() => {
    if (mode === "edit") return t("trips.plan.editDialogTitle");
    return t("trips.plan.addDialogTitle");
  }, [mode, t]);

  const subtitle = useMemo(() => {
    if (!day) return null;
    return formatMessage(t("trips.plan.title"), { index: day.dayIndex });
  }, [day, t]);

  const saveLabel = mode === "edit" ? t("trips.plan.saveUpdate") : t("trips.plan.saveNew");
  const isBusy = saving || deleting || loadingInit;
  const canDelete = Boolean(editingItemId && onDelete);

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

  const ensureCsrfToken = useCallback(async () => {
    if (csrfToken) return csrfToken;

    const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
    const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
    if (!response.ok || body.error || !body.data?.csrfToken) {
      throw new Error("csrf");
    }

    setCsrfToken(body.data.csrfToken);
    return body.data.csrfToken;
  }, [csrfToken]);

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
    setPaymentError(null);
    setPaymentRowErrors([]);
    setSaving(true);

    const trimmedCost = costCentsInput.trim();
    const trimmedLink = linkUrl.trim();
    const parsedCostCents = parseAmountToCents(trimmedCost);

    if (trimmedCost.length > 0 && parsedCostCents === null) {
      setSaving(false);
      setFieldErrors({ costCents: t("trips.plan.costInvalid") });
      return;
    }

    let paymentsPayload: { amountCents: number; dueDate: string }[] = [];
    if (trimmedCost.length === 0) {
      const hasPaymentInput = payments.some(
        (payment) => payment.amount.trim().length > 0 || payment.dueDate.trim().length > 0,
      );
      if (hasPaymentInput) {
        setSaving(false);
        setPaymentError(t("trips.payments.costRequired"));
        return;
      }
    } else if (paymentMode === "single") {
      const dueDate = payments[0]?.dueDate?.trim() ?? "";
      if (!dueDate) {
        setSaving(false);
        setPaymentRowErrors([{ dueDate: t("trips.payments.dateRequired") }]);
        return;
      }
      paymentsPayload = [{ amountCents: parsedCostCents!, dueDate }];
    } else {
      if (payments.length < 2) {
        setSaving(false);
        setPaymentError(t("trips.payments.minRows"));
        return;
      }
      const rowErrors: Array<{ amount?: string; dueDate?: string }> = [];
      let total = 0;
      let hasError = false;
      payments.forEach((payment, index) => {
        const amountValue = payment.amount.trim();
        const amountCents = parseAmountToCents(amountValue);
        const dueDate = payment.dueDate.trim();
        const nextError: { amount?: string; dueDate?: string } = {};
        if (!amountValue || amountCents === null) {
          nextError.amount = t("trips.payments.amountRequired");
          hasError = true;
        }
        if (!dueDate) {
          nextError.dueDate = t("trips.payments.dateRequired");
          hasError = true;
        }
        rowErrors[index] = nextError;
        if (amountCents !== null && dueDate) {
          total += amountCents;
          paymentsPayload.push({ amountCents, dueDate });
        }
      });
      if (hasError) {
        setSaving(false);
        setPaymentRowErrors(rowErrors);
        return;
      }
      if (total !== parsedCostCents) {
        setSaving(false);
        setPaymentError(t("trips.payments.sumMismatch"));
        return;
      }
    }

    const payload = {
      tripDayId: day.id,
      title: titleInput.trim(),
      fromTime: fromTimeInput.trim(),
      toTime: toTimeInput.trim(),
      contentJson,
      costCents: trimmedCost.length > 0 ? parsedCostCents : null,
      payments: paymentsPayload,
      linkUrl: trimmedLink.length > 0 ? trimmedLink : null,
      location: resolvedLocation,
    } as {
      tripDayId: string;
      title: string;
      fromTime: string;
      toTime: string;
      contentJson: string;
      costCents: number | null;
      payments: { amountCents: number; dueDate: string }[];
      linkUrl: string | null;
      location: { lat: number; lng: number; label?: string | null } | null;
      itemId?: string;
      bucketListItemId?: string;
    };

    if (mode === "edit" && editingItemId) {
      payload.itemId = editingItemId;
    }
    if (mode === "add" && prefill?.bucketListItemId) {
      payload.bucketListItemId = prefill.bucketListItemId;
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
              if (field.startsWith("payments")) setPaymentError(messages[0]);
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

  const handleDelete = useCallback(async () => {
    if (!editingItemId || !onDelete) return;
    setDeleting(true);
    const deleted = await onDelete(editingItemId);
    setDeleting(false);
    if (deleted) {
      onClose();
    }
  }, [editingItemId, onClose, onDelete]);

  const handleDeleteClick = () => {
    if (deleteTouchGuard.current) {
      deleteTouchGuard.current = false;
      return;
    }
    void handleDelete();
  };

  const handleDeleteTouchEnd = (event: React.TouchEvent<HTMLButtonElement>) => {
    if (isBusy) return;
    deleteTouchGuard.current = true;
    event.preventDefault();
    void handleDelete();
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

  const uploadGalleryImages = async () => {
    if (!day || !editingItemId || galleryFiles.length === 0) return;

    // The picker accepts any image/* so Safari can select at all; reject unsupported formats
    // here with a specific reason rather than a generic server-side upload failure.
    const unsupported = galleryFiles.find((file) => !isSupportedImageUpload(file));
    if (unsupported) {
      setServerError(t("trips.image.unsupportedFormat"));
      return;
    }

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setGalleryBusy(true);
    setServerError(null);
    try {
      let failedAtIndex = -1;
      for (const [index, file] of galleryFiles.entries()) {
        const formData = new FormData();
        formData.set("tripDayId", day.id);
        formData.set("dayPlanItemId", editingItemId);
        formData.set("file", file);
        const response = await fetch(`/api/trips/${tripId}/day-plan-items/images`, {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": token },
          body: formData,
        });
        const body = (await response.json()) as ApiEnvelope<{ image: GalleryImage }>;
        if (!response.ok || body.error || !body.data?.image) {
          failedAtIndex = index;
          setServerError(t("trips.plan.saveError"));
          break;
        }
        const uploadedImage = body.data.image;
        setGalleryImages((current) => [...current, uploadedImage]);
      }

      if (failedAtIndex === -1) {
        setGalleryFiles([]);
      } else {
        setGalleryFiles(galleryFiles.slice(failedAtIndex));
      }
    } catch {
      setServerError(t("trips.plan.saveError"));
    } finally {
      setGalleryBusy(false);
    }
  };

  const deleteGalleryImage = async (imageId: string) => {
    if (!day || !editingItemId) return;

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setGalleryBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items/images`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
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

  return (
    <>
    <DialogShell
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle ?? undefined}
      // Screen G's `.dialog.w-520`, down from MUI's `maxWidth="md"` (900px). The TipTap toolbar and
      // the payment rows are the two blocks that have to survive the narrowing — both wrap rather
      // than compress, and both are measured in the browser check.
      width={520}
      // Same guard as the accommodation dialog: Cancel is disabled while `isBusy`, so the two
      // dismissal gestures must be too.
      disableDismiss={isBusy}
      footer={
        <>
          {/* No `alignItems` override: DialogShell stretches footer children to full width at xs and
              centres them from sm up, and this group opts into that rather than out of it. */}
          <Box sx={{ display: "flex", flexDirection: { xs: "column-reverse", sm: "row" }, gap: "10px" }}>
            <Button variant="outlined" onClick={onClose} disabled={isBusy}>
              {t("common.cancel")}
            </Button>
            {canDelete ? (
              /*
                No `color="error"` (AC8). `handleDeleteClick` + `onTouchEnd`'s two-tap confirm is kept
                verbatim — it is the only delete confirmation this dialog has.
              */
              <Button
                variant="text"
                onClick={handleDeleteClick}
                onTouchEnd={handleDeleteTouchEnd}
                disabled={isBusy}
                sx={{ color: tokens.ink }}
              >
                {t("trips.plan.deleteItem")}
              </Button>
            ) : null}
          </Box>
          <Button variant="contained" onClick={handleSave} disabled={isBusy || !day}>
            {saving ? <CircularProgress size={22} /> : saveLabel}
          </Button>
        </>
      }
      footerSx={{ justifyContent: "space-between" }}
    >
        <Box display="flex" flexDirection="column" gap="18px">
          {serverError && <FormNotice tone="warn" message={serverError} />}

          <FormField
            id={`${fieldIdPrefix}-title`}
            label={t("trips.plan.titleLabel")}
            value={titleInput}
            onChange={(event) => setTitleInput(event.target.value)}
            error={fieldErrors.title ?? undefined}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          {/*
            The editor is preserved whole (FR18): same TipTap instance, same extensions, same button
            roles and the same pinned `aria-label`s. Only the container and the toolbar chrome are
            restyled to the token idiom — Screen G draws no rich-text field, which is the mockup
            showing a smaller form, not a decision to drop it.
          */}
          {/*
            No container `gap`: this block mirrors `FormField`'s own spacing exactly (label `mb: 7px`,
            helper `mt: 6px`) so the editor's label sits at the same distance from its control as
            every other field on the surface, rather than at a `gap` minus a negative margin.
          */}
          <Box display="flex" flexDirection="column">
            <Typography
              id={`${fieldIdPrefix}-content-label`}
              variant="labelCaps"
              component="div"
              sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, mb: "7px" }}
            >
              {t("trips.plan.contentLabel")}
            </Typography>
            <Box
              sx={{
                border: "1px solid",
                borderColor: fieldErrors.contentJson ? tokens.warnBorder : tokens.borderStrong,
                borderRadius: "6px",
                p: "14px",
                backgroundColor: fieldErrors.contentJson ? tokens.warnBg : tokens.card,
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
                  sx={TOOLBAR_BUTTON_SX}
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
                  sx={TOOLBAR_BUTTON_SX}
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
                  sx={TOOLBAR_BUTTON_SX}
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
                  sx={TOOLBAR_BUTTON_SX}
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
                  sx={TOOLBAR_BUTTON_SX}
                >
                  <SvgIcon fontSize="small">
                    <path d="M21 19V5a2 2 0 0 0-2-2H5C3.9 3 3 3.9 3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 11.5 11 15l3.5-4.5L19 17H5l3.5-5.5zM8 8a1.5 1.5 0 1 0 0.001 0z" />
                  </SvgIcon>
                </Button>
              </Box>
              {editor ? <EditorContent editor={editor} /> : <Typography>{t("trips.plan.editorLoading")}</Typography>}
            </Box>
            {fieldErrors.contentJson && (
              // `warning.main`, not `color="error"`: theme.ts defines no `error` palette entry, so
              // MUI falls back to #d32f2f — the same colour AC8 removed from the buttons and the
              // reason the container's error border above uses `warnBorder`.
              <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 700, mt: "6px" }}>
                {fieldErrors.contentJson}
              </Typography>
            )}
          </Box>
          {/* Screen G's `.field-row`; stacks to a column at xs. Native `type="time"` is kept — it is
              what the tests drive and it draws its own clock affordance. */}
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              gap: "12px",
              "& > *": { flex: 1, minWidth: 0 },
            }}
          >
            <FormField
              id={`${fieldIdPrefix}-from-time`}
              label={t("trips.plan.fromTimeLabel")}
              value={fromTimeInput}
              onChange={(event) => {
                setFromTimeInput(event.target.value);
                setFieldErrors((previous) => ({ ...previous, fromTime: undefined, toTime: undefined }));
              }}
              error={fieldErrors.fromTime ?? undefined}
              type="time"
            />
            <FormField
              id={`${fieldIdPrefix}-to-time`}
              label={t("trips.plan.toTimeLabel")}
              value={toTimeInput}
              onChange={(event) => {
                setToTimeInput(event.target.value);
                setFieldErrors((previous) => ({ ...previous, fromTime: undefined, toTime: undefined }));
              }}
              error={fieldErrors.toTime ?? undefined}
              type="time"
            />
          </Box>

          <FormField
            id={`${fieldIdPrefix}-cost`}
            label={t("trips.plan.costLabel")}
            value={costCentsInput}
            onChange={(event) => setCostCentsInput(event.target.value)}
            error={fieldErrors.costCents ?? undefined}
            hint={t("trips.plan.costHelper")}
            type="text"
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            placeholder="0.00"
          />
          <FormControl component="fieldset" error={Boolean(paymentError)} variant="standard">
            <FormLabel
              sx={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: tokens.inkSoft,
                mb: "7px",
                "&.Mui-focused, &.Mui-error": { color: tokens.inkSoft },
              }}
            >
              {t("trips.payments.title")}
            </FormLabel>
            <RadioGroup
              row
              value={paymentMode}
              onChange={(event) => setPaymentMode(event.target.value as "single" | "split")}
            >
              <FormControlLabel value="single" control={<Radio />} label={t("trips.payments.payAllNow")} />
              <FormControlLabel value="split" control={<Radio />} label={t("trips.payments.split")} />
            </RadioGroup>
            <Box display="flex" flexDirection="column" gap={1.25} mt={0.5}>
              {payments.map((payment, index) => (
                <Box key={`payment-${index}`} display="flex" gap={1} alignItems="flex-start" flexWrap="wrap">
                  <Box sx={{ flex: 1, minWidth: 140 }}>
                    <FormField
                      id={`${fieldIdPrefix}-payment-amount-${index}`}
                      label={t("trips.payments.amountLabel")}
                      value={payment.amount}
                      onChange={(event) => {
                        const next = [...payments];
                        next[index] = { ...next[index], amount: event.target.value };
                        setPayments(next);
                      }}
                      error={paymentRowErrors[index]?.amount}
                      type="number"
                      slotProps={{
                        htmlInput: { min: 0, step: 0.01, readOnly: paymentMode !== "split", inputMode: "decimal" },
                      }}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 170 }}>
                    <FormField
                      id={`${fieldIdPrefix}-payment-date-${index}`}
                      label={t("trips.payments.dateLabel")}
                      value={payment.dueDate}
                      onChange={(event) => {
                        const next = [...payments];
                        next[index] = { ...next[index], dueDate: event.target.value };
                        setPayments(next);
                      }}
                      error={paymentRowErrors[index]?.dueDate}
                      type="date"
                    />
                  </Box>
                  {paymentMode === "split" && (
                    <Button
                      variant="text"
                      onClick={() => {
                        const next = payments.filter((_, idx) => idx !== index);
                        setPayments(next);
                      }}
                      disabled={payments.length <= 2}
                      sx={{ color: tokens.ink, mt: "24px" }}
                    >
                      {t("trips.payments.removeAction")}
                    </Button>
                  )}
                </Box>
              ))}
              {paymentMode === "split" && (
                <Button
                  variant="outlined"
                  onClick={() => setPayments((current) => [...current, { amount: "", dueDate: defaultDueDate }])}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("trips.payments.addAction")}
                </Button>
              )}
            </Box>
            <FormHelperText>{paymentError ?? undefined}</FormHelperText>
          </FormControl>
          <FormField
            id={`${fieldIdPrefix}-link`}
            label={t("trips.plan.linkLabel")}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            error={fieldErrors.linkUrl ?? undefined}
            hint={t("trips.plan.linkHelper")}
            type="url"
            slotProps={{ htmlInput: { inputMode: "url" } }}
            placeholder="https://"
          />
          <Box display="flex" flexDirection="column" gap={1}>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "stretch", sm: "flex-end" },
                gap: "8px",
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <FormField
                  id={`${fieldIdPrefix}-place`}
                  label={t("trips.location.searchLabel")}
                  value={locationQuery}
                  onChange={(event) => setLocationQuery(event.target.value)}
                />
              </Box>
              <Button variant="outlined" onClick={() => void handleLookupLocation()} disabled={isBusy || lookupLoading}>
                {lookupLoading ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
              </Button>
              <Button
                variant="text"
                onClick={() => setResolvedLocation(null)}
                disabled={isBusy || lookupLoading || !resolvedLocation}
                sx={{ color: tokens.ink }}
              >
                {t("trips.location.clearAction")}
              </Button>
            </Box>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft }}>
              {resolvedLocation
                ? `${t("trips.location.latLabel")}: ${resolvedLocation.lat.toFixed(6)} · ${t("trips.location.lngLabel")}: ${resolvedLocation.lng.toFixed(6)}`
                : t("trips.location.noCoordinates")}
            </Typography>
          </Box>
          {editingItemId && (
            /* Same AC5 rebuild as the accommodation gallery; the explicit Upload action is kept for
               the same reason (a real network step with its own error path and busy state). */
            <PhotoUploadField
              id={`${fieldIdPrefix}-gallery`}
              label={t("trips.gallery.title")}
              zoneTitle={t("trips.gallery.uploadZoneTitle")}
              accept={IMAGE_UPLOAD_ACCEPT}
              multiple
              disabled={galleryBusy}
              onFilesSelected={setGalleryFiles}
              selectionLabel={
                galleryFiles.length > 0
                  ? formatMessage(t("trips.gallery.selectedFiles"), { count: galleryFiles.length })
                  : undefined
              }
              emptyLabel={t("trips.gallery.empty")}
              action={
                <Button
                  variant="outlined"
                  onClick={() => void uploadGalleryImages()}
                  disabled={galleryFiles.length === 0 || galleryBusy}
                >
                  {t("trips.gallery.uploadAction")}
                </Button>
              }
              images={galleryPreviews.map((preview) => ({
                ...preview,
                // Keyed by the image id `preview.key` carries, not by position in a second array: the
                // strip and `sortedGalleryImages` agree today, and an index would delete the wrong photo
                // silently on the day any filtering or async insertion makes them disagree.
                onRemove: () => void deleteGalleryImage(preview.key),
              }))}
              onImageOpen={setFullscreenIndex}
            />
          )}
        </Box>
    </DialogShell>
      <FullscreenPhotoViewer
        open={fullscreenIndex !== null}
        images={galleryPreviews}
        startIndex={fullscreenIndex ?? 0}
        onClose={() => setFullscreenIndex(null)}
      />
    </>
  );
}
