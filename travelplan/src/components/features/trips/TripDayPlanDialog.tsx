"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  SvgIcon,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import FullscreenPhotoViewer from "@/components/ui/FullscreenPhotoViewer";
import { WarningTriangleIcon } from "@/components/features/trips/TripIcons";
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

/**
 * The dialog's four sections (Story 6.22 AC1), **in tab order**.
 *
 * This array is the order: `Tabs` renders from it and `firstPlanErrorKey` walks it, so "the first tab
 * that owns an error" (AC2) is decided in one place rather than in two lists that can drift.
 */
export const PLAN_TAB_IDS = ["what", "whenWhere", "cost", "media"] as const;
export type PlanTabId = (typeof PLAN_TAB_IDS)[number];

/**
 * The keys `fieldErrors` holds, lifted out of the `useState` call so `Record<keyof PlanFieldErrors, …>`
 * below can be a *total* function over them (AC3). Adding a seventh key here without giving it a tab
 * is a compile error, which is the whole point: an unmapped key would be an error the user cannot see.
 */
export type PlanFieldErrors = {
  title?: string;
  fromTime?: string;
  toTime?: string;
  contentJson?: string;
  costCents?: string;
  linkUrl?: string;
};

type PlanPaymentRowError = { amount?: string; dueDate?: string };

/**
 * `paymentError` and `paymentRowErrors` are *not* folded into `PlanFieldErrors`; they are mapped
 * alongside it.
 *
 * Two reasons. `paymentRowErrors` is an array of per-row `{ amount?, dueDate? }` objects and does not
 * fit a flat `Record<string, string | undefined>` without changing what the payment block reads —
 * and the payment block is moved by this story, not rewritten (Trap 5). And `paymentError` is a
 * block-level message rendered by `FormControl`/`FormHelperText`, not by a `FormField`, so folding it
 * in would buy nothing but would change three call sites' behaviour. Widening the union instead keeps
 * the compiler check that AC3 asks for: a new member of this union with no entry in `PLAN_ERROR_TAB`
 * does not compile either.
 */
export type PlanErrorKey = keyof PlanFieldErrors | "paymentError" | "paymentRowErrors";

/** The total error→tab function AC3 requires. */
export const PLAN_ERROR_TAB: Record<PlanErrorKey, PlanTabId> = {
  title: "what",
  contentJson: "what",
  fromTime: "whenWhere",
  toTime: "whenWhere",
  costCents: "cost",
  paymentError: "cost",
  paymentRowErrors: "cost",
  linkUrl: "media",
};

/**
 * Every error key, ordered by the tab that owns it. `Array.prototype.sort` is stable, so keys sharing
 * a tab keep their declaration order in `PLAN_ERROR_TAB` — `title` before `contentJson`, `fromTime`
 * before `toTime`.
 */
const PLAN_ERROR_KEYS_IN_TAB_ORDER = (Object.keys(PLAN_ERROR_TAB) as PlanErrorKey[]).sort(
  (left, right) => PLAN_TAB_IDS.indexOf(PLAN_ERROR_TAB[left]) - PLAN_TAB_IDS.indexOf(PLAN_ERROR_TAB[right]),
);

const PLAN_TAB_LABEL_KEYS: Record<PlanTabId, string> = {
  what: "trips.plan.tabWhat",
  whenWhere: "trips.plan.tabWhenWhere",
  cost: "trips.plan.tabCost",
  media: "trips.plan.tabMedia",
};

/** The three error stores the dialog keeps, read together so a tab's marker cannot go stale. */
type PlanErrorState = {
  fieldErrors: PlanFieldErrors;
  paymentError: string | null;
  paymentRowErrors: PlanPaymentRowError[];
};

const hasPlanError = (state: PlanErrorState, key: PlanErrorKey): boolean => {
  if (key === "paymentError") return Boolean(state.paymentError);
  if (key === "paymentRowErrors") {
    return state.paymentRowErrors.some((row) => Boolean(row?.amount) || Boolean(row?.dueDate));
  }
  return Boolean(state.fieldErrors[key]);
};

const firstPlanErrorKey = (state: PlanErrorState): PlanErrorKey | null =>
  PLAN_ERROR_KEYS_IN_TAB_ORDER.find((key) => hasPlanError(state, key)) ?? null;

const planTabsWithErrors = (state: PlanErrorState): Set<PlanTabId> => {
  const tabs = new Set<PlanTabId>();
  for (const key of PLAN_ERROR_KEYS_IN_TAB_ORDER) {
    if (hasPlanError(state, key)) tabs.add(PLAN_ERROR_TAB[key]);
  }
  return tabs;
};

/**
 * The control AC2's "puts focus on the offending field" has to reach, as a DOM id.
 *
 * `contentJson` returns `null` — the rich-text control is a contenteditable with no id of its own, so
 * the caller focuses it through the block's ref instead. `paymentError` is block-level (sum mismatch,
 * "cost required", "at least two rows"), and the field a user has to change to satisfy any of the
 * three is the cost box, so that is where the caret goes.
 *
 * The `never` default is deliberate: it makes this resolver total over `PlanErrorKey` too, so a new
 * key gets a tab *and* a focus target or it does not compile.
 */
const planErrorFocusId = (prefix: string, key: PlanErrorKey, state: PlanErrorState): string | null => {
  switch (key) {
    case "title":
      return `${prefix}-title`;
    case "contentJson":
      return null;
    case "fromTime":
      return `${prefix}-from-time`;
    case "toTime":
      return `${prefix}-to-time`;
    case "costCents":
    case "paymentError":
      return `${prefix}-cost`;
    case "paymentRowErrors": {
      const index = state.paymentRowErrors.findIndex((row) => Boolean(row?.amount) || Boolean(row?.dueDate));
      if (index < 0) return `${prefix}-cost`;
      return state.paymentRowErrors[index]?.amount
        ? `${prefix}-payment-amount-${index}`
        : `${prefix}-payment-date-${index}`;
    }
    case "linkUrl":
      return `${prefix}-link`;
    default: {
      const unhandled: never = key;
      return unhandled;
    }
  }
};

type PlanDialogPrefill = {
  title: string;
  contentJson: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  bucketListItemId: string;
};

/**
 * Story 6.23. One candidate day for "Auf anderen Tag verschieben", already labelled.
 *
 * The label is built by the caller rather than here: `TripDayView` owns the day-label format
 * ("Day 3 · Nov 7") and the locale-aware date formatter that produces it, and a second copy in this
 * file would be free to drift from the picker the day-level transfer renders.
 */
type PlanMoveTargetDay = {
  id: string;
  label: string;
};

/**
 * Story 6.23. The result of a move attempt.
 *
 * A failure carries its message back rather than being rendered by the caller: this dialog stays
 * open when a move fails, and a page-level alert behind an open modal is a message the user cannot
 * read. A success carries nothing — the dialog closes, and the caller reports on the day screen.
 */
export type PlanItemMoveOutcome = { moved: true } | { moved: false; message: string };

type TripDayPlanDialogProps = {
  open: boolean;
  mode: PlanDialogMode;
  tripId: string;
  day: TripDay | null;
  item: DayPlanItem | null;
  prefill?: PlanDialogPrefill | null;
  onDelete?: (itemId: string) => Promise<boolean>;
  /**
   * Story 6.23. The other days of this trip, current day already excluded by the caller.
   *
   * Passing the candidates in — rather than fetching them here — is what makes AC8 work the same way
   * `onDelete` already does: `TripDayView` supplies `onMove` only when `canEditPlanning`, so a viewer
   * gets no action at all rather than a disabled one.
   */
  moveTargetDays?: PlanMoveTargetDay[];
  /** The caller owns the request and the success message; a failure comes back with its own text. */
  onMove?: (itemId: string, targetTripDayId: string) => Promise<PlanItemMoveOutcome>;
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
  moveTargetDays,
  onMove,
  onClose,
  onSaved,
}: TripDayPlanDialogProps) {
  const { t } = useI18n();
  // Unique `htmlFor`/`id` prefix for the above-field labels this restyle introduces.
  const fieldIdPrefix = useId();
  const { tokens, warning } = useTheme().palette;
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Story 6.23. The picker is a second dialog rather than a field, because the action belongs to the
  // activity as a whole and not to any one of the four tabs.
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetDayId, setMoveTargetDayId] = useState("");
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const [loadingInit, setLoadingInit] = useState(false);
  const [contentJson, setContentJson] = useState<string>(toDocString(emptyDoc));
  const [titleInput, setTitleInput] = useState<string>("");
  const [costCentsInput, setCostCentsInput] = useState<string>("");
  const [fromTimeInput, setFromTimeInput] = useState<string>("");
  const [toTimeInput, setToTimeInput] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<"single" | "split">("single");
  const [payments, setPayments] = useState<Array<{ amount: string; dueDate: string }>>([]);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentRowErrors, setPaymentRowErrors] = useState<PlanPaymentRowError[]>([]);
  const skipPaymentNormalization = useRef(false);
  const skipCostSync = useRef(false);
  const [linkUrl, setLinkUrl] = useState<string>("");
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lng: number; label?: string | null } | null>(
    null,
  );
  const [locationQuery, setLocationQuery] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<PlanFieldErrors>({});
  const [activeTab, setActiveTab] = useState<PlanTabId>("what");
  /**
   * Bumped once per rejected save. The focus effect below cannot key off `activeTab`: pressing
   * Speichern while already standing on the tab that owns the error leaves `activeTab` unchanged, and
   * AC2 asks for the caret to land on the field either way.
   */
  const [errorFocusNonce, setErrorFocusNonce] = useState(0);
  const pendingErrorFocus = useRef<{ key: PlanErrorKey; elementId: string | null } | null>(null);
  const contentBlockRef = useRef<HTMLDivElement | null>(null);
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

  const errorState = useMemo<PlanErrorState>(
    () => ({ fieldErrors, paymentError, paymentRowErrors }),
    [fieldErrors, paymentError, paymentRowErrors],
  );
  const tabsWithErrors = useMemo(() => planTabsWithErrors(errorState), [errorState]);

  /**
   * AC2, the criterion this story exists to satisfy safely: an error on a tab the user is not looking
   * at is worse than the long scroll this replaced. Select the first tab in tab order that owns an
   * error and queue the caret for its field — marking the tab alone is not enough.
   *
   * The error state is passed in rather than read from the closure: every caller has just computed it
   * and the corresponding `setState` has not been applied yet.
   */
  const revealFirstError = useCallback(
    (state: PlanErrorState) => {
      const key = firstPlanErrorKey(state);
      if (!key) return;
      setActiveTab(PLAN_ERROR_TAB[key]);
      pendingErrorFocus.current = { key, elementId: planErrorFocusId(fieldIdPrefix, key, state) };
      setErrorFocusNonce((current) => current + 1);
    },
    [fieldIdPrefix],
  );

  useEffect(() => {
    if (errorFocusNonce === 0) return;
    const pending = pendingErrorFocus.current;
    if (!pending) return;
    pendingErrorFocus.current = null;

    // `setActiveTab` ran in the same batch as the nonce, so the panel holding this field is mounted
    // by the time this effect runs.
    if (pending.key === "contentJson") {
      const host = contentBlockRef.current;
      const editable = host?.querySelector<HTMLElement>('[contenteditable="true"]');
      (editable ?? host)?.focus();
      return;
    }
    if (!pending.elementId) return;
    document.getElementById(pending.elementId)?.focus();
  }, [errorFocusNonce]);

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
      // The tab marker is global chrome now, not a message beside the field: leaving it up after the
      // user has fixed the content makes the tab bar lie until the next save.
      setFieldErrors((previous) => (previous.contentJson ? { ...previous, contentJson: undefined } : previous));
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
    // Every open starts on `Was`. Tabs are random access (Trap 1), but the tab a *previous* edit
    // finished on is not a state the next activity's dialog should inherit.
    setActiveTab("what");
    setGalleryFiles([]);
    setFullscreenIndex(null);
    // Same reasoning as `activeTab`: a target day chosen for the *previous* activity is not a state
    // the next one's dialog should inherit.
    setMoveOpen(false);
    setMoveTargetDayId("");
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
  const isBusy = saving || deleting || moving || loadingInit;
  const canDelete = Boolean(editingItemId && onDelete);
  /**
   * AC1 and AC8 in one expression, and deliberately the same shape as `canDelete`.
   *
   * `editingItemId` is what makes it absent while creating — there is nothing to move yet. `onMove`
   * is what makes it absent for a viewer: `TripDayView` only passes the handler when
   * `canEditPlanning`. The length check covers the one-day trip, which has nowhere to move to.
   */
  const canMove = Boolean(editingItemId && onMove && (moveTargetDays?.length ?? 0) > 0);

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
      const nextErrors: PlanFieldErrors = { costCents: t("trips.plan.costInvalid") };
      setFieldErrors(nextErrors);
      revealFirstError({ fieldErrors: nextErrors, paymentError: null, paymentRowErrors: [] });
      return;
    }

    let paymentsPayload: { amountCents: number; dueDate: string }[] = [];
    if (trimmedCost.length === 0) {
      const hasPaymentInput = payments.some(
        (payment) => payment.amount.trim().length > 0 || payment.dueDate.trim().length > 0,
      );
      if (hasPaymentInput) {
        setSaving(false);
        const message = t("trips.payments.costRequired");
        setPaymentError(message);
        revealFirstError({ fieldErrors: {}, paymentError: message, paymentRowErrors: [] });
        return;
      }
    } else if (paymentMode === "single") {
      const dueDate = payments[0]?.dueDate?.trim() ?? "";
      if (!dueDate) {
        setSaving(false);
        const rowErrors: PlanPaymentRowError[] = [{ dueDate: t("trips.payments.dateRequired") }];
        setPaymentRowErrors(rowErrors);
        revealFirstError({ fieldErrors: {}, paymentError: null, paymentRowErrors: rowErrors });
        return;
      }
      paymentsPayload = [{ amountCents: parsedCostCents!, dueDate }];
    } else {
      if (payments.length < 2) {
        setSaving(false);
        const message = t("trips.payments.minRows");
        setPaymentError(message);
        revealFirstError({ fieldErrors: {}, paymentError: message, paymentRowErrors: [] });
        return;
      }
      const rowErrors: PlanPaymentRowError[] = [];
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
        revealFirstError({ fieldErrors: {}, paymentError: null, paymentRowErrors: rowErrors });
        return;
      }
      if (total !== parsedCostCents) {
        setSaving(false);
        const message = t("trips.payments.sumMismatch");
        setPaymentError(message);
        revealFirstError({ fieldErrors: {}, paymentError: message, paymentRowErrors: [] });
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
          const nextErrors: PlanFieldErrors = {};
          // Collected rather than set inside the loop: `revealFirstError` below needs the payment
          // message in the same snapshot as the field errors to pick the first tab that owns one.
          // `for…of`, not `forEach`: an assignment inside a callback is invisible to TypeScript's
          // control-flow analysis, which would narrow `nextPaymentError` back to `null` below and
          // leave the payment branch of AC3's error path unchecked.
          let nextPaymentError: string | null = null;
          for (const [field, messages] of Object.entries(details.fieldErrors ?? {})) {
            if (messages?.[0]) {
              if (field === "title") nextErrors.title = messages[0];
              if (field === "fromTime") nextErrors.fromTime = messages[0];
              if (field === "toTime") nextErrors.toTime = messages[0];
              if (field === "contentJson") nextErrors.contentJson = messages[0];
              if (field === "costCents") nextErrors.costCents = messages[0];
              if (field === "linkUrl") nextErrors.linkUrl = messages[0];
              if (field.startsWith("payments")) nextPaymentError = messages[0];
            }
          }
          setFieldErrors(nextErrors);
          if (nextPaymentError) setPaymentError(nextPaymentError);

          const nextState: PlanErrorState = {
            fieldErrors: nextErrors,
            paymentError: nextPaymentError,
            paymentRowErrors: [],
          };
          if (!firstPlanErrorKey(nextState)) {
            // AC2, and the one path that can still break it: the schema has top-level keys this
            // dialog does not surface (`location`, `tripDayId`, `bucketListItemId`, `itemId`), and
            // `details.fieldErrors` may be absent entirely. Without this the stores are cleared, no
            // tab is marked, no field is focused and no banner appears — the save fails in silence.
            setServerError(resolveApiError(body.error?.code, t("trips.plan.saveError")));
            return;
          }
          revealFirstError(nextState);
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

  /**
   * AC1/AC4. The request and the message both belong to `TripDayView`: it owns the day the user is
   * on, the reload, and the surface a "what was removed" line can survive on once this dialog is
   * gone. Here the only job is to close both dialogs on success — and, on failure, to say so *in*
   * this dialog rather than on the screen behind it, which the user cannot see.
   */
  const handleMoveConfirm = useCallback(async () => {
    if (!editingItemId || !onMove || !moveTargetDayId) return;
    // `moving` and not just the button's `disabled`: two clicks in the same tick both run before
    // React re-renders, and the second one would post a move for an activity that is no longer on
    // this day. Delete on this surface guards itself with a ref for the same reason.
    if (movingRef.current) return;
    movingRef.current = true;
    setServerError(null);
    setMoving(true);
    const outcome = await onMove(editingItemId, moveTargetDayId);
    movingRef.current = false;
    setMoving(false);
    if (!outcome.moved) {
      setMoveOpen(false);
      // The caller's message, not a generic one: "your session has expired" and "please try again"
      // ask the user to do different things, and only one of them can succeed.
      setServerError(outcome.message);
      return;
    }
    setMoveOpen(false);
    onClose();
  }, [editingItemId, moveTargetDayId, onClose, onMove]);

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
            {canMove ? (
              /*
                Story 6.23 AC1. In the action area, not among the fields and not inside a tab panel:
                moving is an operation on the whole activity, so putting it on `Wann & Wo` (the tab
                whose subject is closest) would say it belongs to that tab's fields. Same `text` +
                `tokens.ink` treatment as Delete — a secondary action on this surface, and not
                destructive enough to earn anything louder.
              */
              <Button
                variant="text"
                onClick={() => setMoveOpen(true)}
                /* `galleryBusy` on top of `isBusy`, which deliberately excludes it elsewhere: the
                   upload loop posts each photo against the *source* day, so a move committed
                   mid-upload makes every remaining photo 404 — and this dialog is already closed by
                   then, so the user never sees the failure. */
                disabled={isBusy || galleryBusy}
                sx={{ color: tokens.ink }}
              >
                {t("trips.plan.moveAction")}
              </Button>
            ) : null}
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

          {/*
            AC6/AC7. MUI `Tabs`/`Tab` rather than hand-rolled buttons: they carry `role="tablist"`,
            `aria-selected`, roving `tabIndex` and the arrow-key handling AC7 asks for, and none of
            that is worth re-implementing.

            The chrome is deliberately the *pill switch* `AuthTabs` established and `theme.ts` already
            encodes (`MuiTabs` paints the `paperOuter` track, `MuiTab` the white selected pill), not a
            row of small square controls — because the formatting toolbar directly below is exactly
            that, and two rows of small square controls read as one broken widget (Trap 3). The
            underline indicator is switched off for the same reason: the filled pill is the selected
            state, and an underline on top of it is a second, conflicting one.

            `variant="fullWidth"` over `scrollable`: a scrollable bar hides tabs, which works against
            the story. Four German labels ("Was", "Wann & Wo", "Kosten", "Medien & Links") fit a 390px
            phone at 12px/800 once the per-tab padding is cut to 6px; the longest may wrap to two
            lines, which costs ~8px of bar height and keeps all four reachable in one tap.
          */}
          <Tabs
            value={activeTab}
            onChange={(_event, value: PlanTabId) => setActiveTab(value)}
            aria-label={t("trips.plan.tabsLabel")}
            variant="fullWidth"
            sx={{
              borderRadius: "7px",
              minHeight: 44,
              "& .MuiTabs-indicator": { display: "none" },
              // MUI 7 renames the flex container slot to `list`; both are targeted so the gap does
              // not silently disappear on either side of that rename.
              "& .MuiTabs-list, & .MuiTabs-flexContainer": { gap: "6px" },
              "& .MuiTab-root": {
                minHeight: 44,
                minWidth: 0,
                px: "6px",
                gap: "4px",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0,
                textTransform: "none",
              },
            }}
          >
            {PLAN_TAB_IDS.map((tabId) => {
              const label = t(PLAN_TAB_LABEL_KEYS[tabId]);
              const hasError = tabsWithErrors.has(tabId);
              return (
                <Tab
                  key={tabId}
                  value={tabId}
                  id={`${fieldIdPrefix}-tab-${tabId}`}
                  // Only the selected tab names a panel, because only its panel is in the DOM. A
                  // permanent `aria-controls` on all four would point three screen readers at an id
                  // that does not exist whenever a user invokes jump-to-controlled-element.
                  aria-controls={activeTab === tabId ? `${fieldIdPrefix}-tabpanel-${tabId}` : undefined}
                  // AC2's marker is a warning triangle, not a colour: the tint on its own would be
                  // the only signal for a red-green colour-blind user. The accessible name says it in
                  // words too, so the marker is not sighted-only either.
                  aria-label={hasError ? formatMessage(t("trips.plan.tabWithErrors"), { label }) : undefined}
                  label={label}
                  icon={hasError ? <WarningTriangleIcon sx={{ fontSize: 13 }} /> : undefined}
                  iconPosition="end"
                  // `warning.main` (#8A5A2B), not `warnBorder` (#E3C7A2): the marker has to be legible
                  // on the white selected pill, where the border token sits at 1.6:1. This is the
                  // colour `theme.ts` already assigns to every error foreground in the app, at 5.87:1.
                  sx={hasError ? { color: warning.main } : undefined}
                />
              );
            })}
          </Tabs>

          {activeTab === "what" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-what`}
              aria-labelledby={`${fieldIdPrefix}-tab-what`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
              <FormField
                id={`${fieldIdPrefix}-title`}
                label={t("trips.plan.titleLabel")}
                value={titleInput}
                onChange={(event) => {
                  setTitleInput(event.target.value);
                  setFieldErrors((previous) => ({ ...previous, title: undefined }));
                }}
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
                  ref={contentBlockRef}
                  // AC2 has to be able to put focus here, and a contenteditable is the one control on this
                  // surface with no id to look up. `-1` makes the block programmatically focusable without
                  // adding a stop to the tab order; the effect prefers the contenteditable when it exists.
                  tabIndex={-1}
                  sx={{
                    border: "1px solid",
                    borderColor: fieldErrors.contentJson ? tokens.warnBorder : tokens.borderStrong,
                    borderRadius: "6px",
                    p: "14px",
                    backgroundColor: fieldErrors.contentJson ? tokens.warnBg : tokens.card,
                    minHeight: 180,
                    outline: "none",
                    // The `outline: none` above is for the click case. When AC2 focuses this block
                    // programmatically — which happens when the editor has not initialised yet and
                    // there is no contenteditable to reach — the caret has to be visible somewhere,
                    // or the user is told nothing at all about where save sent them.
                    // `:focus`, not `:focus-visible` — this is the phone case, and after a tap on
                    // Speichern the focus-visible heuristic does not match, which is precisely when
                    // the ring is needed. Focus lands on the host only through that fallback or a
                    // click on its padding; focus in a child is `:focus-within` and does not match.
                    "&:focus": { outline: `2px solid ${warning.main}`, outlineOffset: 2 },
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
            </Box>
          )}

          {activeTab === "whenWhere" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-whenWhere`}
              aria-labelledby={`${fieldIdPrefix}-tab-whenWhere`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
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
              {/* Moved here from below the link field, unchanged: AC1 pairs the location search with the
                  two time fields so `Wann & Wo` is a section rather than a two-field tab. */}
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
            </Box>
          )}

          {/* `Kosten` is one block that expands: the mode radio reveals the repeatable rows. It earns
              its tab by that expansion, not by field count. */}
          {activeTab === "cost" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-cost`}
              aria-labelledby={`${fieldIdPrefix}-tab-cost`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
              <FormField
                id={`${fieldIdPrefix}-cost`}
                label={t("trips.plan.costLabel")}
                value={costCentsInput}
                onChange={(event) => {
                  setCostCentsInput(event.target.value);
                  setFieldErrors((previous) => ({ ...previous, costCents: undefined }));
                  // The block-level payment message ("sum does not match the cost") is about this
                  // number, so editing it invalidates that message too — and it is what keeps the
                  // Kosten marker up.
                  setPaymentError(null);
                }}
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
                  onChange={(event) => {
                    setPaymentMode(event.target.value as "single" | "split");
                    // Switching mode rebuilds the rows, so positional row errors no longer point at
                    // anything that is rendered. Left alone they keep the Kosten tab marked with a
                    // triangle and no visible message anywhere on the panel.
                    setPaymentRowErrors([]);
                    setPaymentError(null);
                  }}
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
                            // `paymentRowErrors` is positional. Removing a row without removing its
                            // slot re-attaches the message to whichever row slid up into the index,
                            // and an error past the new end stays true for `hasPlanError` while
                            // rendering nowhere.
                            setPaymentRowErrors((previous) =>
                              previous.length > 0 ? previous.filter((_, idx) => idx !== index) : previous,
                            );
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
            </Box>
          )}

          {activeTab === "media" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-media`}
              aria-labelledby={`${fieldIdPrefix}-tab-media`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
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
              {!editingItemId && (
                // AC1: without this the add flow's `Medien & Links` is a one-field tab, because the
                // gallery is gated on an item id that does not exist yet. Saying why is cheaper than
                // rendering an upload zone that would 404, and cheaper than regrouping the tabs.
                <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                  {t("trips.plan.galleryAfterSave")}
                </Typography>
              )}
              {/* Moved here from between the payment block and the location search, unchanged: AC1 pairs
                  the link with the gallery so `Medien & Links` is not a one-field tab. */}
              <FormField
                id={`${fieldIdPrefix}-link`}
                label={t("trips.plan.linkLabel")}
                value={linkUrl}
                onChange={(event) => {
                  setLinkUrl(event.target.value);
                  setFieldErrors((previous) => ({ ...previous, linkUrl: undefined }));
                }}
                error={fieldErrors.linkUrl ?? undefined}
                hint={t("trips.plan.linkHelper")}
                type="url"
                slotProps={{ htmlInput: { inputMode: "url" } }}
                placeholder="https://"
              />
            </Box>
          )}
        </Box>
    </DialogShell>
      {/*
        Story 6.23. The same picker the day-level transfer renders (`trips.dayTransfer.targetLabel`,
        a native `select`), with the current day already excluded by the caller — reused rather than
        reinvented so the two "choose a day" surfaces read alike.

        It is a second dialog rather than an expanding block inside the first, because the first is a
        four-tab form and an expanding block would have to live in one of the tabs, which is exactly
        what AC1 says the action must not do.
      */}
      {canMove ? (
        <Dialog
          open={moveOpen}
          onClose={() => {
            if (moving) return;
            setMoveOpen(false);
          }}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>{t("trips.plan.moveDialogTitle")}</DialogTitle>
          <DialogContent>
            <Box mt={0.5} display="flex" flexDirection="column" gap={1.5}>
              {/* AC3 said in words. The story exists because the alternative is retyping, so the
                  dialog states what travels rather than leaving the user to hope. */}
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {t("trips.plan.moveDescription")}
              </Typography>
              {/* What the move costs, said before it happens. AC4 asks for the removed travel
                  segments to be reported rather than removed in silence; a receipt after the fact is
                  the weaker half of that, and the form can also be dirty when this opens — only the
                  saved activity moves. */}
              <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="plan-move-warning">
                {t("trips.plan.moveWarning")}
              </Typography>
              <TextField
                select
                id={`${fieldIdPrefix}-move-target`}
                label={t("trips.dayTransfer.targetLabel")}
                value={moveTargetDayId}
                onChange={(event) => setMoveTargetDayId(event.target.value)}
                fullWidth
                SelectProps={{ native: true }}
              >
                <option value="" />
                {(moveTargetDays ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </TextField>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" onClick={() => setMoveOpen(false)} disabled={moving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleMoveConfirm()}
              disabled={moving || !moveTargetDayId}
            >
              {moving ? <CircularProgress size={22} /> : t("trips.plan.moveConfirm")}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
      <FullscreenPhotoViewer
        open={fullscreenIndex !== null}
        images={galleryPreviews}
        startIndex={fullscreenIndex ?? 0}
        onClose={() => setFullscreenIndex(null)}
      />
    </>
  );
}
