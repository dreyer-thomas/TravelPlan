"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  Radio,
  RadioGroup,
  SvgIcon,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DocumentUploadField from "@/components/forms/DocumentUploadField";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import FullscreenPhotoViewer from "@/components/ui/FullscreenPhotoViewer";
import { TrashIcon, WarningTriangleIcon } from "@/components/features/trips/TripIcons";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Node } from "@tiptap/core";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  MAX_DOCUMENTS_PER_ENTRY,
  isSupportedDocumentUpload,
} from "@/lib/trips/documentUploads";
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

/**
 * A row of `day_plan_item_documents` (Story 9.1), declared locally the way `GalleryImage` above is —
 * four components each keep their own copy of the gallery row shape, and the document rows follow
 * that convention rather than introducing a shared type and refactoring the files around it.
 *
 * `fileName` is the stored column, extension and all; `DocChip` strips the extension for display.
 */
type PlanDocument = {
  id: string;
  documentUrl: string;
  fileName: string;
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

/**
 * Story 6.24 AC1/AC2. The floor under the tab panels, in px.
 *
 * **Where the number comes from.** Measured in Chrome at 1400x1000 on one activity, before this
 * story: the dialog stood at 668px on `Was`, 501px on `Wann & Wo`, 572px on `Kosten` and 660px on
 * `Medien & Links`. MUI centres a dialog vertically, so that 167px swing landed as ±84px on *both*
 * edges — and the tab bar is at the top, so the control the user had just clicked moved 84px away
 * from the pointer. That displacement, not the resize, is what read as restless.
 *
 * **What it is not.** This comment used to claim 475 was "the tallest ordinary panel's own height (the
 * `Was` panel; 485px at 390px)". Both figures were wrong, and the story's own before/after table said
 * so: `Was` went 668px → 757px, which a floor at the panel's own height could not have done. Story
 * 6.24's code review re-measured across **18 real activities** at 1400x1000 and 390x844:
 *
 * | panel | desktop | 390px |
 * |---|---|---|
 * | `Was` | 361–606 | 361–930 |
 * | `Wann & Wo` | 194 | 406 |
 * | `Kosten` (single payment) | 266 | 392 |
 * | `Medien & Links` | 315–354 | 315–354 |
 *
 * **So there is no such thing as "the tallest ordinary panel".** `Was` holds the rich-text
 * description and is therefore unbounded, in exactly the way `Kosten` is unbounded via split-payment
 * rows (DW-149). No static floor can make AC1 unconditional; what a floor buys is the *range of
 * activities* over which the frame holds still.
 *
 * **Why 475 survives the re-measure.** It clears every non-`Was` panel at both viewports with
 * headroom (the tallest is 406), and it clears `Was` for 17 of the 18 sampled activities. Measured
 * outcome: at 1400px **17 of 18 hold perfectly still** (0.0px swing) and the one exception — a long
 * description at 606px — swings 131px. At 390px 14 of 18 hold still and the worst case is **13.3px**,
 * because the taller ones run into MUI's `calc(100% - 64px)` cap and are pinned by it instead. Against
 * the 167px swing and 84px displacement this story set out to remove, that is the defect fixed for the
 * ordinary case and reduced by an order of magnitude on the phone. The residual is DW-155.
 *
 * Raising it further was rejected: covering the 606px outlier costs +131px on *every* activity, and
 * covering the 930px phone case is impossible below the viewport cap. Lowering it to the tallest
 * non-`Was` panel (406) would make more activities jump, not fewer.
 *
 * Deriving it from the panels at runtime was considered and rejected: it needs a measure-then-set
 * pass over four panels only one of which is mounted at a time, so the first switch to a taller panel
 * would still jump — the very thing being fixed.
 *
 * **To re-measure:** open the activity dialog against a throwaway DB copy, click each of the four
 * tabs and read `document.querySelector('[role="tabpanel"]').getBoundingClientRect().height`. That is
 * the panel's *natural* height even with the floor in place, because the floor is a `minHeight` on a
 * block parent and a block child is not stretched by it. Sample more than one activity — sampling one
 * is how the figures above went wrong.
 */
export const PLAN_PANEL_MIN_HEIGHT = 475;

/**
 * `minHeight`, never `height` — and exported so a test can hold that distinction rather than a
 * source-text grep.
 *
 * DW-149 records the `Kosten` panel reaching 1634px at five split-payment rows. A fixed `height`
 * would either clip it or force a nested scroll inside the dialog's own scroll. AC2 is explicit that
 * the frame must still be free to *grow*; what it may not do is shrink below the floor.
 */
export const PLAN_PANEL_FLOOR_SX = { minHeight: `${PLAN_PANEL_MIN_HEIGHT}px` } as const;

/**
 * Story 6.24 AC8. The footer is one row at every width, overriding `DialogShell`'s `xs` stack.
 *
 * The stack existed because four labels ("Abbrechen", "Auf anderen Tag verschieben", "Löschen",
 * "Element speichern") could not share a 390px row, so it wrapped them four deep — 243px, 31% of a
 * 780px dialog. After this story the row is `anderer Tag` + a 44px trash glyph + `OK`, which fits,
 * so the stack is no longer earning its height.
 *
 * **Both breakpoint keys are spelled out, and they have to be.** A plain `flexDirection: "row"` here
 * looks like it wins — `DialogShell` merges `footerSx` after its own `sx`, and the last entry of an
 * sx array takes precedence — but it does not. MUI compiles the shell's
 * `flexDirection: { xs: "column-reverse", sm: "row" }` into two media queries, `@media
 * (min-width:0px)` and `@media (min-width:600px)`; a bare property deep-merges *alongside* them and
 * then loses to the `min-width:0px` block, which always matches. The first attempt at this measured
 * `row` at 1400px (from the untouched `sm` query) and `column-reverse` at 390px — a 132px footer on
 * the one viewport AC8 is about. Matching the shell's keys replaces its queries instead of sitting
 * under them. `alignItems` carries the same trap for the same reason: `stretch` at `xs` would pull
 * every control to the row's full height.
 *
 * **`flexWrap` is the safety net the `xs` stack used to be.** `DialogActions` sets no `flex-wrap`, so
 * forcing `row` at every width removed the mechanism that absorbed a footer too wide for its dialog
 * and put nothing back. The row measures 174px + 64px inside 278px at 390px — about 40px of slack —
 * so a 320px viewport, 390px at 125% text zoom, or a translation longer than "anderer Tag" would
 * have overflowed horizontally instead of stacking. Wrapping degrades to what the stack did, and at
 * every width above the pinch it changes nothing.
 */
export const PLAN_FOOTER_SX = {
  justifyContent: "space-between",
  flexDirection: { xs: "row", sm: "row" },
  alignItems: { xs: "center", sm: "center" },
  flexWrap: "wrap",
  // The shell's `gap: 10px` already spaces a single row; this is the gap between wrapped rows, which
  // only exists once the footer has actually wrapped.
  rowGap: "10px",
} as const;

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

/**
 * Story 6.24 AC3a. Every value a user can change on this surface, in one object.
 *
 * The dialog already held all of them as dialog-level `useState`, so the dirty check needs no new
 * machinery — only a copy of what the dialog opened with. This type is that copy's shape, and it is
 * also what the open effect applies, so seeding and fingerprinting cannot drift apart: a field added
 * here has to be given a seed value and is watched from that moment.
 */
type PlanFormValues = {
  title: string;
  fromTime: string;
  toTime: string;
  cost: string;
  paymentMode: "single" | "split";
  payments: Array<{ amount: string; dueDate: string }>;
  linkUrl: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  contentJson: string;
  /**
   * Photos picked but not yet uploaded. A staged file is unsaved input in exactly the way a typed
   * title is: dismissing the dialog drops it, and nothing else in this form does.
   *
   * Note what this does *not* say. `uploadGalleryImages` runs from the Media tab's own `Upload`
   * button and from nowhere else — `handleSave` never touches `galleryFiles` — so pressing `OK`
   * discards staged files just as silently as the `✕` used to. That is pre-existing and predates
   * this story's guard (`Speichern` behaved identically); it is logged as DW-153 because fixing it
   * means changing what a save does, which AC9 forbids. Watching the count here is still right: the
   * `✕` genuinely loses them.
   *
   * Images *already* on the server are not here: adding and removing those are immediate writes, so
   * they are not what a discard discards.
   */
  pendingPhotoCount: number;
  /**
   * Documents picked but not yet uploaded (Story 9.1 AC7). The same split, one field down: a staged
   * document is unsaved input in exactly the way a staged photo is, and `uploadDocuments` runs from
   * the Media tab's own Upload button and from nowhere else — `handleSave` never touches
   * `documentFiles`, so the `✕` genuinely loses them.
   *
   * Documents *already* on the server are not here, for the same reason images are not: adding and
   * removing those are immediate writes, and a discard would not undo them.
   *
   * DW-153 applies here unchanged — pressing `OK` discards staged documents as silently as it
   * discards staged photos. That is the pre-existing behaviour of a save on this dialog, not
   * something this field introduces.
   *
   * **A count, never the array.** See `currentFingerprint`: a `File[]` rebuilt by the picker has a
   * new identity on every render and the discard question turns on how many are staged.
   */
  pendingDocumentCount: number;
};

/**
 * **"Dirty" means: the form's values differ from the ones it opened with.**
 *
 * The alternative — a per-field `touched` flag set on the first `onChange` — calls a form dirty after
 * a user types a character and deletes it again, and would then guard a `✕` that has nothing to
 * guard. A value comparison also covers the paths no `onChange` sees: the geocode lookup writing
 * `resolvedLocation`, and the payment rows the two normalisation effects rewrite.
 *
 * **Only values a save would persist are here.** `locationQuery` — the text in the location *search*
 * box — was watched in this story's first version and is not any more: `handleSave` sends
 * `location: resolvedLocation` and never the query, so an abandoned search term made the `✕` ask
 * about something no save would have kept. That is the same over-firing the `touched` flag was
 * rejected for.
 *
 * Serialised to a single string so the comparison is one equality rather than ten, and so nested
 * payment rows compare by value. `location` is spelled out field by field rather than stringified
 * whole: the object arrives from `JSON.parse` on one path and from the geocode response on another,
 * and key order is not guaranteed to match between them.
 *
 * `contentJson` needs no normalisation here because `setEditorContent` guarantees both sides of the
 * comparison come from one serializer — see it for why that mattered.
 */
const planFormFingerprint = (values: PlanFormValues) =>
  JSON.stringify([
    values.title,
    values.fromTime,
    values.toTime,
    values.cost,
    values.paymentMode,
    values.payments.map((payment) => [payment.amount, payment.dueDate]),
    values.linkUrl,
    values.location ? [values.location.lat, values.location.lng, values.location.label ?? null] : null,
    values.contentJson,
    values.pendingPhotoCount,
    values.pendingDocumentCount,
  ]);

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
  // Story 6.24 AC3a. Raised only when a dismissal arrives at a form that has something to lose.
  const [discardOpen, setDiscardOpen] = useState(false);
  /**
   * The fingerprint of the values this open seeded, written by the open effect below. `null` until
   * then, which is what keeps a dismissal during the first render from being read as an edit.
   */
  const openFingerprint = useRef<string | null>(null);
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
  // Story 9.1. The document half of the `Medien & Links` tab, in the gallery's three states: rows on
  // the server, files staged in the picker, and an in-flight flag. Separate states from the
  // gallery's, because AC2's "a file placed in one bucket never appears in the other" is first of all
  // a statement about these variables.
  const [documents, setDocuments] = useState<PlanDocument[]>([]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  // The index into `galleryPreviews`, not a URL — the shared viewer pages through the collection.
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const deleteTouchGuard = useRef(false);
  const editingItemId = mode === "edit" ? (item?.id ?? null) : null;
  const defaultDueDate = useMemo(() => toDateOnly(day?.date), [day?.date]);
  const sortedGalleryImages = useMemo(
    () => galleryImages.slice().sort((left, right) => left.sortOrder - right.sortOrder),
    [galleryImages],
  );

  /**
   * Insertion order, which for documents is the only order there is — Story 9.1 adds no reorder
   * control, so `sortOrder` only ever counts up. Sorted anyway for the reason the gallery is: the
   * list is appended to locally after each upload and re-read wholesale on the next open, and the two
   * must agree about what "first" means.
   */
  const sortedDocuments = useMemo(
    () => documents.slice().sort((left, right) => left.sortOrder - right.sortOrder),
    [documents],
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

  /**
   * Loads a stored doc into the editor and returns the string that was actually stored in state.
   *
   * The return value is the point. `onUpdate` writes `JSON.stringify(instance.getJSON())` on the
   * first keystroke, but the value seeded here arrives as the server's raw `contentJson` — and the
   * two are not byte-identical for any doc TipTap's schema touches on load (a doc written before the
   * `image`/`link` extensions existed, a node whose attrs the schema fills defaults into, or merely
   * different key order out of `JSON.parse`). AC3a compares those strings, so a mismatch made a
   * description read dirty forever: type one character, delete it again, and the `✕` still asked to
   * discard changes on a visibly unchanged form.
   *
   * So the doc is read back out of the editor after `setContent` rather than trusting the string we
   * were handed. Both sides of the dirty comparison then come from one serializer. `emitUpdate:
   * false` stays — the read-back is what replaces the update `onUpdate` would otherwise have to
   * emit, and emitting it would mark the form dirty on open instead.
   *
   * When `editor` is still `null` (`immediatelyRender: false` returns null on the first render) the
   * raw string is stored as-is and nothing can have edited it yet; the open effect re-runs when the
   * instance appears — `applyPlanFormValues` depends on it — and re-seeds both sides canonically.
   */
  const setEditorContent = useCallback(
    (value: string): string => {
      if (editor) {
        editor.commands.setContent(parseDoc(value), { emitUpdate: false });
        const canonical = JSON.stringify(editor.getJSON());
        setContentJson(canonical);
        return canonical;
      }
      setContentJson(value);
      return value;
    },
    [editor],
  );

  /**
   * Story 6.24. The one place the eleven field states are written together.
   *
   * Extracted from the open effect's three near-identical branches so the effect can *compute* the
   * values it starts from, then apply and fingerprint the same object. Two hand-maintained copies of
   * the seed — one for the setters, one for the dirty baseline — would drift on the first field the
   * next story adds, and the failure mode is silent: a `✕` that discards typing without asking.
   *
   * It returns what it applied rather than what it was given, because `setEditorContent` canonicalises
   * the description through the editor. Fingerprinting the argument instead of the return value is
   * the same two-copies-that-drift bug in miniature, so the caller is given no way to do it.
   *
   * `locationQuery` is seeded here but is deliberately absent from `PlanFormValues`: it is a search
   * box, not a saved field. See `planFormFingerprint`.
   */
  const applyPlanFormValues = useCallback(
    (values: PlanFormValues, locationQuerySeed: string): PlanFormValues => {
      setTitleInput(values.title);
      setFromTimeInput(values.fromTime);
      setToTimeInput(values.toTime);
      setCostCentsInput(values.cost);
      setPaymentMode(values.paymentMode);
      setPayments(values.payments);
      setPaymentError(null);
      setPaymentRowErrors([]);
      setLinkUrl(values.linkUrl);
      setResolvedLocation(values.location);
      setLocationQuery(locationQuerySeed);
      return { ...values, contentJson: setEditorContent(values.contentJson) };
    },
    [setEditorContent],
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
    // Story 9.1, and the same hazard the line above answers: `documentFiles` is otherwise cleared
    // only by a successful upload, and this dialog is never unmounted — so a document staged and then
    // discarded would come back selected on the next open, and `pendingDocumentCount` would hold the
    // fingerprint away from its baseline for the rest of the session.
    setDocumentFiles([]);
    setFullscreenIndex(null);
    // Same reasoning as `activeTab`: a target day chosen for the *previous* activity is not a state
    // the next one's dialog should inherit.
    setMoveOpen(false);
    setMoveTargetDayId("");
    setDiscardOpen(false);
    setLoadingInit(true);

    let seed: PlanFormValues;
    // The location *search* box's seed. Outside `PlanFormValues` because it is not a saved value and
    // so must not reach the dirty fingerprint — see `planFormFingerprint`.
    let locationQuerySeed: string;
    if (mode === "edit" && item) {
      seed = {
        title: item.title ?? "",
        fromTime: item.fromTime ?? "",
        toTime: item.toTime ?? "",
        cost: item.costCents !== null ? formatCentsAsAmount(item.costCents) : "",
        paymentMode: item.payments && item.payments.length > 1 ? "split" : "single",
        payments: buildDefaultPayments({
          payments: item.payments,
          costCents: item.costCents,
          fallbackDate: defaultDueDate,
        }),
        linkUrl: item.linkUrl ?? "",
        location: item.location ?? null,
        contentJson: item.contentJson,
        pendingPhotoCount: 0,
        pendingDocumentCount: 0,
      };
      locationQuerySeed = item.location?.label ?? "";
      // The two payment effects below would otherwise rewrite the rows this seed just restored.
      skipPaymentNormalization.current = true;
      skipCostSync.current = true;
    } else if (mode === "add" && prefill) {
      seed = {
        title: prefill.title ?? "",
        fromTime: "",
        toTime: "",
        cost: "",
        paymentMode: "single",
        payments: buildDefaultPayments({ payments: [], costCents: null, fallbackDate: defaultDueDate }),
        linkUrl: "",
        location: prefill.location ?? null,
        contentJson: prefill.contentJson,
        pendingPhotoCount: 0,
        pendingDocumentCount: 0,
      };
      locationQuerySeed = prefill.location?.label ?? "";
    } else {
      seed = {
        title: "",
        fromTime: "",
        toTime: "",
        cost: "",
        paymentMode: "single",
        payments: buildDefaultPayments({ payments: [], costCents: null, fallbackDate: defaultDueDate }),
        linkUrl: "",
        location: null,
        contentJson: toDocString(emptyDoc),
        pendingPhotoCount: 0,
        pendingDocumentCount: 0,
      };
      locationQuerySeed = "";
    }

    // AC3a's baseline, taken from what was *applied* rather than from `seed`: `setEditorContent`
    // canonicalises the description through the editor, and fingerprinting the pre-canonical string
    // would leave the form dirty from the first keystroke onward on any doc TipTap normalises.
    //
    // A prefilled dialog is *not* dirty on arrival: the bucket-list prefill and the activity being
    // edited are both values the user is looking at rather than values they entered.
    openFingerprint.current = planFormFingerprint(applyPlanFormValues(seed, locationQuerySeed));
    setLoadingInit(false);
  }, [applyPlanFormValues, defaultDueDate, item, mode, open, prefill]);

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

  /**
   * What is already attached to this activity: the photo gallery, and — since Story 9.1 — the
   * documents.
   *
   * **One effect, two independent loaders.** They share a trigger (the dialog opening on a *saved*
   * activity), a dependency list and a cancellation flag, so splitting them would be two copies of
   * one lifecycle. What must stay separate is failure: each loader owns its `try`/`catch` and writes
   * only its own state, so a documents call that 500s does not empty the photo strip, and the
   * reverse. They are not awaited in sequence either — a slow gallery must not hold the chips back.
   */
  useEffect(() => {
    if (!open || !day || !editingItemId) {
      setGalleryImages([]);
      setDocuments([]);
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

    const loadDocuments = async () => {
      try {
        const response = await fetch(
          `/api/trips/${tripId}/day-plan-items/documents?tripDayId=${day.id}&dayPlanItemId=${editingItemId}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );
        const body = (await response.json()) as ApiEnvelope<{ documents: PlanDocument[] }>;
        if (!active) return;
        if (!response.ok || body.error || !Array.isArray(body.data?.documents)) {
          setDocuments([]);
          return;
        }
        setDocuments(body.data.documents);
      } catch {
        if (active) setDocuments([]);
      }
    };

    void loadGallery();
    void loadDocuments();
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

  // Story 6.24 AC6. One key for both modes: after this story the word is "OK" either way, and two
  // keys holding one word is the shape Story 6.17 named a trap on `common.save`.
  const saveLabel = t("trips.plan.save");
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

  /**
   * The form's values as they stand, in the shape the open effect fingerprinted.
   *
   * `galleryFiles.length` rather than `galleryFiles`: the array identity changes on every render of
   * the upload field, the count is what the discard question actually turns on.
   *
   * `documentFiles.length` is here on the same terms and for the same reason (Story 9.1). Both the
   * object field *and* the dependency below take the count: a `File[]` dependency would recompute
   * this memo on every render — which is not itself wrong, since `planFormFingerprint` serialises the
   * count either way — but it makes the memo a lie about what it depends on, and the next reader has
   * to re-derive that the two spellings happen to agree.
   */
  const currentFingerprint = useMemo(
    () =>
      planFormFingerprint({
        title: titleInput,
        fromTime: fromTimeInput,
        toTime: toTimeInput,
        cost: costCentsInput,
        paymentMode,
        payments,
        linkUrl,
        location: resolvedLocation,
        contentJson,
        pendingPhotoCount: galleryFiles.length,
        pendingDocumentCount: documentFiles.length,
      }),
    [
      contentJson,
      costCentsInput,
      documentFiles.length,
      fromTimeInput,
      galleryFiles.length,
      linkUrl,
      paymentMode,
      payments,
      resolvedLocation,
      titleInput,
      toTimeInput,
    ],
  );

  /**
   * Story 6.24 AC3a. Every dismissal that does not commit anything comes through here: the title
   * row's `✕`, the backdrop, and Escape — `DialogShell` routes all three at its `onClose`.
   *
   * An untouched dialog closes silently. One the user has typed into asks once, because the exit it
   * used to have was a labelled `Abbrechen` in the footer and is now a 44px glyph in the corner:
   * easier to hit by accident, and carrying no word for what it costs. This dialog is where
   * EXPERIENCE.md's pattern is proven because it is where there is most to lose — four tabs, eleven
   * fields and a rich-text description.
   *
   * `handleDelete`, `handleMoveConfirm` and a successful save deliberately do **not** come through
   * here. Each of them is a committed decision about this activity, and re-asking "discard your
   * changes?" after the user has just deleted the thing those changes belonged to is noise.
   */
  const handleCloseRequest = useCallback(() => {
    if (isBusy) return;
    if (openFingerprint.current !== null && currentFingerprint !== openFingerprint.current) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [currentFingerprint, isBusy, onClose]);

  const handleDiscardConfirm = useCallback(() => {
    setDiscardOpen(false);
    onClose();
  }, [onClose]);

  const handleDiscardKeep = useCallback(() => setDiscardOpen(false), []);

  /**
   * Story 6.25 AC7, for the **move picker** — a separate dialog with its own dismissal and its own one
   * field. It opens with `moveTargetDayId` blank, so "dirty" is "a target day has been picked".
   * `handleMoveConfirm` closes it directly and never asks.
   *
   * Clearing the target here is what makes that first sentence true on *every* open rather than only
   * the first per activity: the outer dialog's open effect resets `moveTargetDayId`, but reopening the
   * picker within one activity does not re-run it. Without this, a day the user picked and then
   * discarded came back pre-selected with the confirm button live, one click from moving the activity
   * to a day it had just been taken away from.
   */
  const closeMovePicker = useCallback(() => {
    if (moving) return;
    setMoveOpen(false);
    setMoveTargetDayId("");
  }, [moving]);
  const moveGuard = useDiscardGuard(moveTargetDayId !== "", closeMovePicker, moving);

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

  /**
   * Story 9.1, the document twin of `uploadGalleryImages`: the same two-step flow (pick, then press
   * Upload), the same `ensureCsrfToken` handshake, the same one-request-per-file loop that commits
   * each success as it lands and leaves the unsent tail staged.
   *
   * Two deliberate differences from the pair above.
   *
   * The client-side pre-check is `isSupportedDocumentUpload` and it reports
   * `trips.documents.unsupportedFormat`, never `trips.image.unsupportedFormat` — naming photo formats
   * at a field that also takes PDF would tell the user the opposite of the truth, and the two filters
   * staying separate is half of what keeps a file out of the bucket it was not placed in.
   *
   * The **10-per-entry cap is the server's**. The Upload action is disabled at the cap in the panel
   * below, but that is a convenience: the repository counts the rows and the route answers 400 with
   * its own message, which is the branch mapped here. A cap the client alone enforces is not a cap.
   */
  const uploadDocuments = async () => {
    if (!day || !editingItemId || documentFiles.length === 0) return;

    const unsupported = documentFiles.find((file) => !isSupportedDocumentUpload(file));
    if (unsupported) {
      setServerError(t("trips.documents.unsupportedFormat"));
      return;
    }

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setDocumentBusy(true);
    setServerError(null);
    try {
      let failedAtIndex = -1;
      for (const [index, file] of documentFiles.entries()) {
        const formData = new FormData();
        formData.set("tripDayId", day.id);
        formData.set("dayPlanItemId", editingItemId);
        formData.set("file", file);
        const response = await fetch(`/api/trips/${tripId}/day-plan-items/documents`, {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": token },
          body: formData,
        });
        const body = (await response.json()) as ApiEnvelope<{ document: PlanDocument }>;
        if (!response.ok || body.error || !body.data?.document) {
          failedAtIndex = index;
          // Matched on the route's own literal because `validation_error` is also what a rejected
          // type, an oversized file and an unusable name come back as — the code alone cannot say
          // which of the four happened, and the cap is the one of them the user can act on without
          // being told anything further.
          setServerError(
            body.error?.message === "Document limit reached"
              ? t("trips.documents.limitReached")
              : t("trips.documents.uploadError"),
          );
          break;
        }
        const uploadedDocument = body.data.document;
        setDocuments((current) => [...current, uploadedDocument]);
      }

      setDocumentFiles(failedAtIndex === -1 ? [] : documentFiles.slice(failedAtIndex));
    } catch {
      setServerError(t("trips.documents.uploadError"));
    } finally {
      setDocumentBusy(false);
    }
  };

  /** The document twin of `deleteGalleryImage`: an immediate write, with nothing staged behind it. */
  const deleteDocument = async (documentId: string) => {
    if (!day || !editingItemId) return;

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setDocumentBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/day-plan-items/documents`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          tripDayId: day.id,
          dayPlanItemId: editingItemId,
          documentId,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || body.error) {
        setServerError(t("trips.documents.deleteError"));
        return;
      }
      // `documentRow`, not `document`: this file reaches for the global of that name (the error-focus
      // effect calls `document.getElementById`), and a parameter shadowing it is a trap for whoever
      // adds a focus or measurement call inside one of these callbacks next.
      setDocuments((current) => current.filter((documentRow) => documentRow.id !== documentId));
    } catch {
      setServerError(t("trips.documents.deleteError"));
    } finally {
      setDocumentBusy(false);
    }
  };

  return (
    <>
    <DialogShell
      open={open}
      // Story 6.24 AC3a. Not `onClose`: the backdrop and Escape arrive here too, and all three
      // dismissals owe the user the same question when there is typing to lose.
      onClose={handleCloseRequest}
      title={title}
      subtitle={subtitle ?? undefined}
      // Screen G's `.dialog.w-520`, down from MUI's `maxWidth="md"` (900px). The TipTap toolbar and
      // the payment rows are the two blocks that have to survive the narrowing — both wrap rather
      // than compress, and both are measured in the browser check.
      width={520}
      // Same guard the footer's Cancel button used to carry, now covering the `✕` as well as the two
      // gestures — `DialogShell` disables the glyph on the same flag.
      disableDismiss={isBusy}
      // Story 6.24 AC3/AC4. `Abbrechen` left the footer for the title row, as a named 44px `✕`.
      // `common.close` already existed with two readers, so this reuses it rather than adding a
      // second key for the same word.
      closeLabel={t("common.close")}
      footer={
        <>
          {/* AC8. A row at every width now: the group is one text label and one 44px glyph, which
              fits a 390px footer beside `OK` — the four full labels it replaced did not. */}
          <Box sx={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "10px" }}>
            {canMove ? (
              /*
                Story 6.23 AC1. In the action area, not among the fields and not inside a tab panel:
                moving is an operation on the whole activity, so putting it on `Wann & Wo` (the tab
                whose subject is closest) would say it belongs to that tab's fields.

                Story 6.24 AC7 shortened the label to "anderer Tag"; the dialog it opens still carries
                the whole sentence, so nothing is lost — only deferred by one step.
              */
              <Button
                variant="text"
                onClick={() => setMoveOpen(true)}
                /* `galleryBusy` on top of `isBusy`, which deliberately excludes it elsewhere: the
                   upload loop posts each photo against the *source* day, so a move committed
                   mid-upload makes every remaining photo 404 — and this dialog is already closed by
                   then, so the user never sees the failure. */
                disabled={isBusy || galleryBusy}
                sx={{ color: tokens.ink, whiteSpace: "nowrap" }}
              >
                {t("trips.plan.moveAction")}
              </Button>
            ) : null}
            {canDelete ? (
              /*
                Story 6.24 AC5. The label became a trash glyph, so this is now an `icon-button` and
                built to DESIGN.md's entry for one: 44x44, ~20px glyph, no fill at rest.

                It is the destructive action becoming the least-labelled control in the footer, which
                is a real trade — an icon is faster to reach and slower to read. Two things keep it
                honest and both are load-bearing rather than decorative: `deleteItemAria`
                ("Planpunkt löschen") is the accessible name *and* the tooltip, and `TripDayView`'s
                confirmation still stands between this click and the deletion.

                A real `Tooltip` rather than the native `title` attribute, and Trap 3 is why: `title`
                never fires on keyboard focus and never on touch, so on the one control whose word
                this story removed it would have reached mouse users alone. `TripDayMapPanel` and
                `TripOverviewMapPanel` already use this shape for their icon-only buttons.

                `{colors.ink}` and not `{colors.warn}`: DESIGN.md permits warn "only where the action
                is destructive *and* already confirmed elsewhere", which this is — the confirmation
                lives in `TripDayView.handleDeletePlan`. So warn was available and `ink` is a choice
                rather than a constraint: warn would make this the loudest thing in a footer whose
                committing action is a plain `OK`, and DESIGN.md gives `ink` for "actions that change
                something".

                `handleDeleteClick` + `onTouchEnd` is kept verbatim. It is not a confirmation — it is
                the guard against a touch firing `touchend` and `click` for one tap.
              */
              <Tooltip title={t("trips.plan.deleteItemAria")} enterDelay={0}>
                {/* MUI's documented wrapper: a disabled button fires no events, so `Tooltip` cannot
                    listen to one. It takes over the flex sizing so the footer row is unchanged. */}
                <Box component="span" sx={{ display: "inline-flex", flex: "0 0 auto" }}>
                <IconButton
                  aria-label={t("trips.plan.deleteItemAria")}
                  onClick={handleDeleteClick}
                  onTouchEnd={handleDeleteTouchEnd}
                  disabled={isBusy}
                  data-testid="plan-delete-action"
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "6px",
                    color: tokens.ink,
                    // As on `DialogShell`'s `✕`, and for the same reason: `theme.ts` scopes the
                    // app-wide focus ring to `MuiButton`, so this control silently lost the ring it
                    // carried as a `<Button variant="text">` when it became an `IconButton`. On the
                    // destructive action that is a regression, not a cosmetic gap.
                    "&.Mui-focusVisible": {
                      outline: `2px solid ${tokens.ink}`,
                      outlineOffset: "2px",
                    },
                  }}
                >
                  <TrashIcon sx={{ fontSize: 20 }} />
                </IconButton>
                </Box>
              </Tooltip>
            ) : null}
          </Box>
          <Button variant="contained" onClick={handleSave} disabled={isBusy || !day}>
            {saving ? <CircularProgress size={22} /> : saveLabel}
          </Button>
        </>
      }
      footerSx={PLAN_FOOTER_SX}
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
                  //
                  // `&.Mui-selected` is repeated deliberately (DW-176, from Story 6.26's review). A
                  // bare `color` on the root is one class of specificity, and MUI's own
                  // `textColor="primary"` variant emits `&.Mui-selected { color: primary.main }` at
                  // two — so the *selected* errored tab came out `primary.main` (#4B6358) green, and
                  // the triangle with it via `currentColor`. Because the error reveal auto-selects the
                  // tab that owns the error, the colour channel was missing in precisely the state the
                  // user is put into, leaving the glyph and the accessible name to carry AC2 alone.
                  sx={hasError ? { color: warning.main, "&.Mui-selected": { color: warning.main } } : undefined}
                />
              );
            })}
          </Tabs>

          {/*
            Story 6.24 AC1/AC2. The floor, wrapping all four panels rather than sitting on each of
            them: one element carries the number, so a fifth panel inherits the behaviour instead of
            having to remember it, and a panel cannot be added below the floor by omission.

            Every panel stays top-aligned inside it, so a short one shows empty space underneath —
            which is what was asked for — while a tall one (`Kosten` at five payment rows, 1634px per
            DW-149) simply exceeds the floor and scrolls with the dialog body as it always did.
          */}
          <Box data-testid="plan-tabpanel-floor" sx={PLAN_PANEL_FLOOR_SX}>
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
              {editingItemId && (
                /*
                  Story 9.1 AC2. **Below** the photo field, on the same tab, gated on the same saved
                  activity — and with a label of its own (`Dokumente` against `Bildergalerie`),
                  because the whole criterion is that a JPEG's destination is the user's choice rather
                  than the app's guess. Two fields, two accept filters, two upload actions, two
                  server-side pools: a file placed in one never appears in the other.

                  No fifth tab and no new panel; `PLAN_TAB_IDS` is unchanged. The media panel is
                  simply the tallest of the four now, and `PLAN_PANEL_MIN_HEIGHT` is a floor.
                */
                <DocumentUploadField
                  id={`${fieldIdPrefix}-documents`}
                  label={t("trips.documents.title")}
                  zoneTitle={t("trips.documents.uploadZoneTitle")}
                  // The 10 MB / PDF-JPEG-PNG-WebP line, passed so it reaches the input as
                  // `aria-describedby` rather than being sighted-only.
                  zoneHint={t("trips.documents.uploadZoneHint")}
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  multiple
                  disabled={documentBusy}
                  onFilesSelected={setDocumentFiles}
                  selectionLabel={
                    documentFiles.length > 0
                      ? formatMessage(t("trips.documents.selectedFiles"), { count: documentFiles.length })
                      : undefined
                  }
                  emptyLabel={t("trips.documents.empty")}
                  action={
                    <Button
                      variant="outlined"
                      onClick={() => void uploadDocuments()}
                      // The cap in the third term is a convenience only: the repository counts the
                      // rows and the route answers 400, and `uploadDocuments` maps that answer.
                      // Disabling here saves a round trip that could only fail; it enforces nothing.
                      disabled={
                        documentFiles.length === 0 ||
                        documentBusy ||
                        sortedDocuments.length >= MAX_DOCUMENTS_PER_ENTRY
                      }
                    >
                      {t("trips.documents.uploadAction")}
                    </Button>
                  }
                  documents={sortedDocuments.map((documentRow) => ({
                    key: documentRow.id,
                    documentUrl: documentRow.documentUrl,
                    fileName: documentRow.fileName,
                    // Keyed by the document id, not by position in a second array — an index deletes
                    // the wrong row silently the day the two lists disagree.
                    onRemove: () => void deleteDocument(documentRow.id),
                  }))}
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
              {!editingItemId && (
                // Story 9.1, its own line rather than a clause bolted onto the gallery's: the two
                // fields are absent for the same reason but they are two fields, and a user adding an
                // activity to attach a ticket to needs to be told about the one they came for.
                <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                  {t("trips.plan.documentsAfterSave")}
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
        <Dialog open={moveOpen} onClose={moveGuard.requestClose} fullWidth maxWidth="sm">
          {/*
            Story 6.25 AC1/Task 2. The move picker gets the `✕` like every other dialog. It is nested
            inside the activity dialog, which also has one, and that is fine: each closes the surface it
            sits on. The one nested dialog that is *exempt* is the discard confirmation below — see the
            note there.
          */}
          <DialogTitleWithClose label={t("common.close")} onClose={moveGuard.requestClose} disabled={moving}>
            {t("trips.plan.moveDialogTitle")}
          </DialogTitleWithClose>
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
          {/* Story 6.25 AC2 — a form dialog's footer keeps only the confirming action. */}
          <DialogActions>
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
      <DiscardChangesDialog {...moveGuard.dialogProps} />
      {/*
        Story 6.24 AC3a — EXPERIENCE.md.State Patterns → "Dismissing a dialog with unsaved input".

        Asked once, and only when there is something to lose: `handleCloseRequest` never raises this
        for an untouched form. Story 6.25 moved the markup into `DiscardChangesDialog`, because nine
        more dialogs now ask the same question and nine copies of it would drift; only the body stays
        here, since it is the line that names *this* dialog's object. `plan-discard-body` is kept as
        the testid so 6.24's assertions still point at the same element.

        It carries no `✕` of its own. That is the one exemption this story writes down rather than
        infers: DESIGN.md gives every dialog exactly one close, but this dialog is *raised by* a `✕`,
        so a glyph on it would mean the same thing as the glyph that opened it — and two clicks on
        the same corner would land the user back in the form they were leaving. Escape and the
        backdrop already resolve to keeping, so the safe default is reachable without one.
      */}
      <DiscardChangesDialog
        open={discardOpen}
        onKeep={handleDiscardKeep}
        onDiscard={handleDiscardConfirm}
        body={t("trips.plan.discardBody")}
        bodyTestId="plan-discard-body"
      />
      <FullscreenPhotoViewer
        open={fullscreenIndex !== null}
        images={galleryPreviews}
        startIndex={fullscreenIndex ?? 0}
        onClose={() => setFullscreenIndex(null)}
      />
    </>
  );
}
