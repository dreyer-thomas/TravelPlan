"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import DocumentUploadField from "@/components/forms/DocumentUploadField";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import FullscreenPhotoViewer from "@/components/ui/FullscreenPhotoViewer";
import { WarningTriangleIcon } from "@/components/features/trips/TripIcons";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import {
  DOCUMENT_LIMIT_ERROR_MESSAGE,
  DOCUMENT_UPLOAD_ACCEPT,
  MAX_DOCUMENTS_PER_ENTRY,
  isSupportedDocumentUpload,
} from "@/lib/trips/documentUploads";
import { IMAGE_UPLOAD_ACCEPT, isSupportedImageUpload } from "@/lib/trips/imageUploads";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    payments?: { amountCents: number; dueDate: string }[];
    link: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    location?: { lat: number; lng: number; label?: string | null } | null;
  } | null;
};

type AccommodationFormValues = {
  name: string;
  notes: string;
  status: "planned" | "booked";
  costCents: string;
  link: string;
  checkInTime: string;
  checkOutTime: string;
  paymentMode: "single" | "split";
  payments: { amount: string; dueDate: string }[];
};

/**
 * The dialog's four sections (Story 6.26 AC1), **in tab order**.
 *
 * Same shape as `PLAN_TAB_IDS` in `TripDayPlanDialog`, and for the same reason: `Tabs` renders from
 * this array and the error walk below orders itself by it, so "the first tab that owns an error" is
 * decided in one place rather than in two lists free to drift.
 */
export const STAY_TAB_IDS = ["basics", "cost", "place", "media"] as const;
export type StayTabId = (typeof STAY_TAB_IDS)[number];

/**
 * Every value the form holds is also a key an error can arrive under, so `keyof
 * AccommodationFormValues` *is* the error-key set — no second hand-written union to keep in step.
 * That is the one structural difference from the activity dialog, which keeps its errors in three
 * hand-rolled `useState` stores; here react-hook-form owns them and its `FieldErrors` is already
 * keyed by the form's own fields.
 */
export type StayErrorKey = keyof AccommodationFormValues;

/**
 * The total error→tab function AC3 requires. A tenth form field with no entry here is a compile
 * error, which is the point: an unmapped key would be an error the user cannot see, on a tab the
 * dialog would never select.
 *
 * **What the type does and does not buy** (review of Story 6.26 — the original wording overstated
 * it). `Record<StayErrorKey, …>` forces every form key to name *a* tab, and `stayErrorFocusId`'s
 * `never` default forces every form key to name *a* focus target. Neither connects either answer to
 * the panel the field is actually rendered in: mapping `notes` to `"media"` while its `FormField`
 * stays in the place panel compiles cleanly and produces exactly the failure this map exists to
 * prevent — the dialog switches tabs and the field is not there. The tab↔panel agreement is held by
 * the tests below, not by the compiler.
 */
export const STAY_ERROR_TAB: Record<StayErrorKey, StayTabId> = {
  name: "basics",
  status: "basics",
  checkInTime: "basics",
  checkOutTime: "basics",
  costCents: "cost",
  paymentMode: "cost",
  payments: "cost",
  notes: "place",
  link: "media",
};

/**
 * Tabs for keys the **server** can fault that are not form fields at all (review of Story 6.26,
 * Tommy's call).
 *
 * `location` is the reachable one: `locationSchemas.ts` caps `location.label` at 200 characters and
 * `handleLookupLocation` writes the geocoder's label into `resolvedLocation` untruncated, so a
 * Nominatim display name long enough to fail is an ordinary search result rather than a freak input.
 * It lives here and not in `STAY_ERROR_TAB` because it is component state, not a registered field —
 * putting it in that map would break the `keyof AccommodationFormValues` identity AC6 rests on.
 *
 * The Place tab *does* surface this value, in the coordinate line under the search box, so AC2's "a
 * field the form does not surface" does not describe it: the honest response is to select the tab
 * that shows it. `tripDayId` deliberately has no entry — nothing on any tab shows it, so the banner
 * is all there is to say.
 */
export const STAY_PAYLOAD_ERROR_TAB = { location: "place" } as const satisfies Record<string, StayTabId>;

/**
 * Every error key, ordered by the tab that owns it. `Array.prototype.sort` is stable, so keys
 * sharing a tab keep their declaration order in `STAY_ERROR_TAB` — which is also their visual order
 * inside the panel, so "first error" means the topmost one on the earliest tab.
 */
const STAY_ERROR_KEYS_IN_TAB_ORDER = (Object.keys(STAY_ERROR_TAB) as StayErrorKey[]).sort(
  (left, right) => STAY_TAB_IDS.indexOf(STAY_ERROR_TAB[left]) - STAY_TAB_IDS.indexOf(STAY_ERROR_TAB[right]),
);

const STAY_TAB_LABEL_KEYS: Record<StayTabId, string> = {
  basics: "trips.stay.tabBasics",
  cost: "trips.stay.tabCost",
  place: "trips.stay.tabPlace",
  media: "trips.stay.tabMedia",
};

/** The per-row shape react-hook-form stores under `errors.payments` when a payment line fails. */
type StayPaymentRowError = { amount?: unknown; dueDate?: unknown } | undefined;

/**
 * Whether a given key currently carries an error.
 *
 * `payments` needs the special case: react-hook-form stores two different shapes under that one
 * key — a block-level `{ message }` for "payments must add up", "cost required" and "at least two
 * rows", and a sparse *array* of `{ amount?, dueDate? }` for the per-row messages. A sparse array is
 * truthy even when every hole is empty, so the rows are counted rather than assumed.
 */
const hasStayError = (errors: FieldErrors<AccommodationFormValues>, key: StayErrorKey): boolean => {
  const entry = errors[key];
  if (!entry) return false;
  if (key === "payments") {
    const rows = entry as unknown as StayPaymentRowError[];
    if (Array.isArray(rows)) {
      return rows.some((row) => Boolean(row?.amount) || Boolean(row?.dueDate));
    }
  }
  return true;
};

/** The tabs carrying at least one error, for the tab bar's markers. */
const stayTabsWithErrors = (errors: FieldErrors<AccommodationFormValues>): Set<StayTabId> => {
  const tabs = new Set<StayTabId>();
  for (const key of STAY_ERROR_KEYS_IN_TAB_ORDER) {
    if (hasStayError(errors, key)) tabs.add(STAY_ERROR_TAB[key]);
  }
  return tabs;
};

/**
 * The control AC2's "puts focus on the offending field" has to reach, as a DOM id.
 *
 * `paymentMode` resolves to the cost box rather than to a radio: it is a hidden input mirroring the
 * radio group, and the field a user has to change to satisfy any block-level payment message is the
 * amount. The `never` default makes this resolver total over `StayErrorKey` too, so a new field gets
 * a tab *and* a focus target or it does not compile.
 *
 * `checkOutTime` can resolve to an element that is not mounted: `stayType` decides which of the two
 * time fields is rendered, and only the rendered one is registered — so the unrendered half has no
 * client-side rule that could fail. A server error naming it would mark the tab and focus nothing,
 * which is the honest outcome for a field this surface does not show.
 */
const stayErrorFocusId = (
  prefix: string,
  key: StayErrorKey,
  errors: FieldErrors<AccommodationFormValues>,
): string | null => {
  switch (key) {
    case "name":
      return `${prefix}-name`;
    case "status":
      return `${prefix}-status`;
    case "checkInTime":
      return `${prefix}-check-in`;
    case "checkOutTime":
      return `${prefix}-check-out`;
    case "costCents":
    case "paymentMode":
      return `${prefix}-cost`;
    case "payments": {
      const rows = errors.payments as unknown as StayPaymentRowError[];
      const index = Array.isArray(rows)
        ? rows.findIndex((row) => Boolean(row?.amount) || Boolean(row?.dueDate))
        : -1;
      if (index < 0) return `${prefix}-cost`;
      return rows[index]?.amount ? `${prefix}-payment-amount-${index}` : `${prefix}-payment-date-${index}`;
    }
    case "notes":
      return `${prefix}-notes`;
    case "link":
      return `${prefix}-link`;
    default: {
      const unhandled: never = key;
      return unhandled;
    }
  }
};

/**
 * Story 6.26 AC5, the floor under the tab panels in px — the same mechanism Story 6.24 put under the
 * activity dialog, applied here for the same reason: MUI centres a dialog vertically, so a panel
 * swing lands as half of itself on the *top* edge, which is where the tab bar the user just clicked
 * sits.
 *
 * **Measured in a browser, not derived** (Task 7, 2026-08-04). The first value was 300, from arithmetic
 * over the panels' composition, and that arithmetic was wrong twice over: it assumed a 44px input at
 * 13.5px type, which fix 6.26a invalidates by raising every control to 16px on touch, and it was
 * desktop-only, missing that at `xs` the basics row stacks to `flexDirection: column`. Both errors were
 * identified in review before the measurement confirmed them.
 *
 * Read as `document.querySelector('[role="tabpanel"]').getBoundingClientRect().height` per tab, against
 * a throwaway copy of `dev.db`, on **two** stays — sampling one is how 6.24's first figures went wrong:
 *
 * | panel | 747px | 390px, 3 payments, no notes | 390px, 2 payments, 102-char notes |
 * |---|---|---|---|
 * | `Basisdaten` | 194.4 | 289.5 | 289.5 |
 * | `Ort & Notizen` | 231.9 | 359.0 | **399.0** |
 * | `Medien & Links` | 355.2 | 358.8 | 358.8 |
 * | `Kosten` | 467.4 | 1015.8 | 762.3 |
 *
 * **400 is chosen so three of the four panels sit at exactly the floor at both widths** — which is what
 * AC5 asks for: the frame stops moving. Only `Kosten` exceeds it, and AC5 exempts that explicitly,
 * split-payment rows being unbounded (DW-149 records 1634px at five rows on the activity dialog; 1015.8
 * is measured here at three). `Ort & Notizen` clears 400 by 1px on the notes-heavy sample and will
 * exceed it with longer notes — same unbounded category, handled the same way. `clipped` was `false` on
 * every panel in every run, so exceeding the floor grows the frame rather than cutting content off.
 *
 * Any width above `sm` (600px) reproduces the 747px column: the dialog is `width={520}`, so panel
 * content width does not change with the viewport above that breakpoint. 747px was the sample taken.
 *
 * For scale, the activity dialog's measured equivalent is `PLAN_PANEL_MIN_HEIGHT = 475`. Two sibling
 * dialogs on one day screen at 300 and 475 would have read as two different frames; 400 and 475 do not.
 *
 * `minHeight` and never `height` — see `STAY_PANEL_FLOOR_SX`. That distinction is now confirmed on
 * screen rather than merely asserted in jsdom: with the floor still at 300, `Kosten` measured a *used*
 * height of 467.4px, i.e. the frame grew past the floor instead of clipping.
 */
export const STAY_PANEL_MIN_HEIGHT = 400;

/**
 * `minHeight`, never `height` — and exported so a test can hold that distinction rather than a
 * source-text grep.
 *
 * A fixed `height` would either clip the split-payment rows and the photo strip or force a nested
 * scroll inside the dialog's own scroll. The frame must stay free to *grow*; what it may not do is
 * shrink below the floor.
 */
export const STAY_PANEL_FLOOR_SX = { minHeight: `${STAY_PANEL_MIN_HEIGHT}px` } as const;

type GalleryImage = {
  id: string;
  imageUrl: string;
  sortOrder: number;
};

/**
 * A row of `accommodation_documents` (Story 9.1), declared locally the way `GalleryImage` above is.
 *
 * Four components each keep their own copy of the gallery row shape rather than sharing one type
 * (`TripDayView`, this dialog, `TripDayPlanDialog`, `TripDayMapFullPage`); the document rows follow
 * that convention rather than introducing a shared type and refactoring the files around it. The
 * extraction is a real candidate — for a story allowed to touch all of them.
 *
 * `fileName` is the stored column, extension and all: `DocChip` strips the extension for the visible
 * label, and the label is the whole reason the chip exists rather than a thumbnail.
 */
type AccommodationDocument = {
  id: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
};

type TripAccommodationDialogProps = {
  open: boolean;
  tripId: string;
  stayType: "previous" | "current";
  day: TripDay | null;
  onClose: () => void;
  onSaved: () => void;
};

const DEFAULT_CHECK_IN = "16:00";
const DEFAULT_CHECK_OUT = "10:00";

const formatCents = (value: number) => (value / 100).toFixed(2);

const parseAmountToCents = (rawValue: string): number | null => {
  const value = rawValue.trim();
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
};

const toDateOnly = (value?: string | null) => {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

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
      amount: formatCents(payment.amountCents),
      dueDate: payment.dueDate,
    }));
  }
  if (typeof costCents === "number") {
    return [{ amount: formatCents(costCents), dueDate: fallbackDate }];
  }
  return [{ amount: "", dueDate: "" }];
};

const normalizeTimeInput = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export default function TripAccommodationDialog({
  open,
  tripId,
  stayType,
  day,
  onClose,
  onSaved,
}: TripAccommodationDialogProps) {
  const { t, language } = useI18n();
  // Unique `htmlFor`/`id` prefix: this dialog is mounted twice on the day view (current night and
  // previous night), so a fixed id string would collide between the two instances. The `<form>`'s
  // own id has to come from here too — the footer's Save reaches it by `form={formId}`, and with a
  // fixed string that attribute resolves to whichever instance is first in document order.
  const fieldIdPrefix = useId();
  const formId = `${fieldIdPrefix}-form`;
  const { tokens, warning } = useTheme().palette;
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lng: number; label: string | null } | null>(
    null,
  );
  const [initError, setInitError] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  // Story 9.1. The document half of the `Medien & Links` tab, split exactly as the gallery's three
  // states are: rows already on the server, files staged in the picker but not yet sent, and an
  // in-flight flag. Kept in three separate states from the gallery's rather than folded into them,
  // because AC2's "a file placed in one bucket never appears in the other" is first of all a
  // statement about these variables.
  const [documents, setDocuments] = useState<AccommodationDocument[]>([]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  // The index into `galleryPreviews`, not a URL — the shared viewer pages through the collection.
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<StayTabId>("basics");
  /**
   * The control AC2 owes the caret, as a DOM id, plus a counter — and the counter is the point.
   *
   * The focus effect cannot key off `activeTab`: pressing Save while *already standing on* the tab
   * that owns the error leaves `activeTab` unchanged, and AC2 asks for the caret to land on the field
   * either way. Nor can it key off the id alone, for the same reason one field failing twice in a row
   * must fire twice. A fresh object per reveal gives the effect a new identity every time.
   *
   * State rather than the `useRef` this started as: the ref had to be *written* from a function passed
   * to `handleSubmit` during render, which the React Compiler correctly rejects ("Cannot access refs
   * during render") — and it bailed out of compiling the whole component rather than only that line.
   */
  const [pendingErrorFocus, setPendingErrorFocus] = useState<{ elementId: string | null; nonce: number } | null>(null);
  const defaultDueDate = useMemo(() => toDateOnly(day?.date), [day?.date]);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields, isDirty },
    getValues,
    setError,
    clearErrors,
    reset,
    setValue,
  } = useForm<AccommodationFormValues>({
    defaultValues: {
      name: day?.accommodation?.name ?? "",
      notes: day?.accommodation?.notes ?? "",
      status: day?.accommodation?.status ?? "planned",
      costCents:
        day?.accommodation?.costCents !== null && day?.accommodation?.costCents !== undefined
          ? (day.accommodation.costCents / 100).toFixed(2)
          : "",
      link: day?.accommodation?.link ?? "",
      checkInTime: day?.accommodation?.checkInTime ?? DEFAULT_CHECK_IN,
      checkOutTime: day?.accommodation?.checkOutTime ?? DEFAULT_CHECK_OUT,
      paymentMode: day?.accommodation?.payments && day.accommodation.payments.length > 1 ? "split" : "single",
      payments: buildDefaultPayments({
        payments: day?.accommodation?.payments,
        costCents: day?.accommodation?.costCents,
        fallbackDate: defaultDueDate,
      }),
    },
  });

  /**
   * Story 6.26 AC2/AC3. Select the tab that owns `key` and queue the caret for its field.
   *
   * Split from `revealFirstError` because the two callers know different things. `onSubmit`'s manual
   * `setError` paths each know exactly which key they just failed on — and cannot read it back out of
   * `errors`, whose value in that closure predates the `setError` call.
   */
  const revealError = useCallback((key: StayErrorKey, focusId: string | null) => {
    setActiveTab(STAY_ERROR_TAB[key]);
    setPendingErrorFocus((current) => ({ elementId: focusId, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!pendingErrorFocus?.elementId) return;
    // `setActiveTab` ran in the same batch as this state, so the panel holding the field is mounted
    // by the time the effect runs.
    document.getElementById(pendingErrorFocus.elementId)?.focus();
  }, [pendingErrorFocus]);

  const { fields: paymentFields, append, remove, replace } = useFieldArray({
    control,
    name: "payments",
  });
  const paymentMode = useWatch({ control, name: "paymentMode" });
  const costInput = useWatch({ control, name: "costCents" });
  const watchedPayments = useWatch({ control, name: "payments" });

  useEffect(() => {
    if (!open) return;
    if (paymentMode === "split") {
      if (paymentFields.length < 2) {
        const next = [...paymentFields];
        while (next.length < 2) {
          next.push({ id: `new-${next.length}`, amount: "", dueDate: defaultDueDate } as (typeof paymentFields)[number]);
        }
        replace(
          next.map((field, index) => ({
            amount: (watchedPayments?.[index]?.amount ?? field.amount ?? "") as string,
            dueDate: (watchedPayments?.[index]?.dueDate ?? field.dueDate ?? defaultDueDate) as string,
          })),
        );
      }
    } else if (paymentFields.length !== 1) {
      const first = watchedPayments?.[0];
      replace([
        {
          amount: first?.amount ?? "",
          dueDate: first?.dueDate ?? defaultDueDate,
        },
      ]);
    }
  }, [defaultDueDate, open, paymentFields, paymentMode, replace, watchedPayments]);

  /**
   * True once this effect has run to convergence for the current open — i.e. once the seeded values
   * already agree and nothing had to be written. Until then its writes are a *normalisation of what
   * the form opened with*, not a consequence of the user editing the cost.
   *
   * Story 6.25 review. Marking that first pass dirty latched `isDirty` true before any interaction,
   * so a stay whose single stored payment disagrees with its cost — a deposit against a larger total,
   * or a null cost beside a payment row — asked "Änderungen verwerfen?" on a dialog nobody had
   * touched. Same defect class as the `heroImage` `FileList` one the browser pass caught, and the
   * reason it survived is that `buildDefaultPayments` derives the row from the cost whenever the stay
   * has no `payments` array, which is the shape every fixture used.
   */
  const paymentSyncSettled = useRef(false);

  useEffect(() => {
    if (!open) {
      paymentSyncSettled.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (paymentMode !== "single") return;
    const normalized = (costInput ?? "").trim();
    const current = watchedPayments?.[0]?.amount ?? "";
    // Every pass after the values have settled is a real edit and still marks the form dirty.
    const shouldDirty = paymentSyncSettled.current;
    let settled = true;
    if (normalized !== current) {
      setValue("payments.0.amount", normalized, { shouldDirty });
      settled = false;
    }
    const dueDate = watchedPayments?.[0]?.dueDate ?? "";
    if (normalized && !dueDate) {
      setValue("payments.0.dueDate", defaultDueDate, { shouldDirty });
      settled = false;
    }
    if (settled) {
      paymentSyncSettled.current = true;
    }
  }, [costInput, defaultDueDate, open, paymentMode, setValue, watchedPayments]);

  /**
   * AC3's "the marker clears as soon as the field is fixed rather than standing until the next save" —
   * for the one key where it did not (review of Story 6.26).
   *
   * Every other error key belongs to a registered input with a rule, so react-hook-form revalidates it
   * on change and clears it by itself. `payments` has neither: the block-level messages
   * (`sumMismatch`, `minRows`, `costRequired`) and the per-row ones are all planted by hand with
   * `setError`, on a field-array name with no input behind it. Nothing revalidated them, and the only
   * `clearErrors("payments")` sat inside `onSubmit` — i.e. on the *next* save. Measured: 100.00 split
   * into 40 + 50 fails, the marker and "Payments must add up to the total cost" appear, and correcting
   * the second row to 60.00 left **both** standing.
   *
   * Two things it also fixes. A row-level error survived a split→single switch, so the `Kosten` tab
   * stayed marked for a row that no longer existed — a marker with nothing to fix and no message to
   * explain it. And a *server* `payments` rejection now clears on edit like a client one.
   *
   * The dependency is a **serialised value**, never the watched array: `watchedPayments` is a fresh
   * object on every change and this must fire on changes of value, not of identity — the same
   * distinction that made the tab markers stale two hundred lines up. It runs once on open with no
   * errors to clear, which is a no-op.
   */
  const paymentsErrorSignature = `${paymentMode ?? ""}|${costInput ?? ""}|${JSON.stringify(watchedPayments ?? [])}`;
  useEffect(() => {
    clearErrors("payments");
  }, [clearErrors, paymentsErrorSignature]);

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setInitError(null);
    setCsrfToken(null);
    setIsDeleting(false);
    setIsGeocoding(false);
    // Matches `TripDayPlanDialog`'s reset: a stale index left behind by a programmatic close would
    // otherwise spring the viewer open on top of the dialog the next time it is shown.
    setFullscreenIndex(null);
    // Every open starts on `Basisdaten`. Tabs are random access, but the tab a *previous* edit
    // finished on is not a state the next stay's dialog should inherit — and this dialog is never
    // unmounted, so without this it would.
    setActiveTab("basics");
    // Story 6.25 review, and the same reset `TripDayPlanDialog` already does. `setGalleryFiles([])`
    // otherwise runs only after a *successful upload*, and this dialog is never unmounted — so photos
    // staged and then discarded came back selected on the next open, with Upload live for them and
    // `galleryFiles.length > 0` holding the discard guard dirty for the rest of the session.
    setGalleryFiles([]);
    // Story 9.1, and the identical hazard one line down: `documentFiles` is cleared only on a
    // successful upload too, and it is a term of the discard guard below. Without this line a
    // document staged and then discarded comes back selected on the next open and holds the guard
    // dirty for the rest of the session — the defect the line above is the scar tissue for.
    setDocumentFiles([]);
    reset({
      name: day?.accommodation?.name ?? "",
      notes: day?.accommodation?.notes ?? "",
      status: day?.accommodation?.status ?? "planned",
      costCents:
        day?.accommodation?.costCents !== null && day?.accommodation?.costCents !== undefined
          ? (day.accommodation.costCents / 100).toFixed(2)
          : "",
      link: day?.accommodation?.link ?? "",
      checkInTime: day?.accommodation?.checkInTime ?? DEFAULT_CHECK_IN,
      checkOutTime: day?.accommodation?.checkOutTime ?? DEFAULT_CHECK_OUT,
      paymentMode: day?.accommodation?.payments && day.accommodation.payments.length > 1 ? "split" : "single",
      payments: buildDefaultPayments({
        payments: day?.accommodation?.payments,
        costCents: day?.accommodation?.costCents,
        fallbackDate: defaultDueDate,
      }),
    });
    setResolvedLocation(
      day?.accommodation?.location
        ? {
            lat: day.accommodation.location.lat,
            lng: day.accommodation.location.lng,
            label: day.accommodation.location.label ?? null,
          }
        : null,
    );
    setLocationQuery(day?.accommodation?.location?.label ?? day?.accommodation?.name ?? "");
  }, [day, defaultDueDate, open, reset]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setInitError(body.error?.message ?? t("trips.stay.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setInitError(t("trips.stay.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open, t]);

  /**
   * What is already attached to this stay: the photo gallery, and — since Story 9.1 — the documents.
   *
   * **One effect, two independent loaders.** They share a trigger (the dialog opening on a *saved*
   * stay), a dependency list and a cancellation flag, so splitting them would be two copies of the
   * same lifecycle. What must stay separate is failure: each loader owns its own `try`/`catch` and
   * writes only its own state, so a documents call that 500s does not empty the photo strip, and the
   * reverse. They are also not awaited in sequence — a slow gallery must not hold the chips back.
   *
   * Tolerant in the same way on both sides: any non-`ok` answer, any error envelope and any throw
   * leave that one list empty rather than half-populated. The upload zones still work when a list
   * could not be read; what is lost is the view of what is attached, not the ability to attach more.
   */
  useEffect(() => {
    if (!open || !day?.accommodation) {
      setGalleryImages([]);
      setDocuments([]);
      return;
    }
    const accommodationId = day.accommodation.id;
    let active = true;

    const loadGallery = async () => {
      try {
        const response = await fetch(
          `/api/trips/${tripId}/accommodations/images?tripDayId=${day.id}&accommodationId=${accommodationId}`,
          { method: "GET", credentials: "include", cache: "no-store" },
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
          `/api/trips/${tripId}/accommodations/documents?tripDayId=${day.id}&accommodationId=${accommodationId}`,
          { method: "GET", credentials: "include", cache: "no-store" },
        );
        const body = (await response.json()) as ApiEnvelope<{ documents: AccommodationDocument[] }>;
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
  }, [day?.accommodation, day?.id, open, tripId]);

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

  /**
   * Component-scope, added by Story 5.13. This file used to carry two copies of this switch, both declared
   * *inside* `onSubmit` and `handleDelete` and therefore invisible to the four media and document handlers
   * below, which set a fixed key and never looked at `body.error.code` at all. Adding a `case` to the two
   * local copies would have changed nothing on the surfaces this story widened, so the switch had to become
   * reachable first — and once it was, the two locals were deleted rather than left to shadow it. Three
   * bodies under one identifier would mean the next `case` has to be added in three places, and a reader
   * standing in `onSubmit` would be looking at a different function from the one the file appears to define.
   *
   * `fallback` is required rather than defaulted: each call site has its own "this write failed" message
   * (`trips.stay.error`, `trips.documents.deleteError`, …) and picking one of them as a default here
   * would silently relabel the others. Shape copied from `TripBucketListPanel`.
   */
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
        // Story 5.13: the widened routes answer this to a participant refused for her role, where they
        // used to answer `not_found`. Without this branch the fallback would still say "it is not there".
        case "forbidden":
          return t("errors.forbidden");
        default:
          return fallback;
      }
    },
    [t],
  );

  /**
   * The three `validate` rules, declared **above** `onSubmit` rather than below the request handlers
   * where they used to sit.
   *
   * Story 6.26 gave them a second caller: `onSubmit` re-runs them for the fields react-hook-form
   * skipped because their panel was unmounted (see the block inside it). Read from a closure declared
   * earlier in the component body, the React Compiler could no longer prove the memoization was
   * preserved and bailed out of compiling the whole component — three
   * `Compilation Skipped: Existing memoization could not be preserved` errors. Moving the definitions
   * ahead of their first use is the whole fix; the bodies are untouched.
   */
  /**
   * `validate` as well as `required`, and the two say the same thing (review of Story 6.26).
   *
   * It was `{ required }` alone, while the unmounted re-run below judged `!values.name.trim()`.
   * react-hook-form's `required` treats `"   "` as present, so the two disagreed on whitespace — and
   * the disagreement was worse than either rule on its own: a name of three spaces failed the re-run
   * and raised "Stay name is required", then **typing a fourth space cleared the message and the tab
   * marker**, because revalidation ran the lenient rule and found the field satisfied. An error the
   * user can dismiss by typing more of what caused it is worse than no error at all.
   *
   * `required` is kept alongside so an empty field still fails on react-hook-form's own pass rather
   * than only on the re-run.
   */
  const nameRules = useMemo(
    () => ({
      required: t("trips.stay.nameRequired"),
      validate: (value: string) => (value.trim() ? true : t("trips.stay.nameRequired")),
    }),
    [t],
  );

  const maxCostCents = 100000000;
  const costRules = useMemo(
    () => ({
      validate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
          return t("trips.stay.costInvalid");
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return t("trips.stay.costInvalid");
        }
        const cents = Math.round(parsed * 100);
        if (cents > maxCostCents) {
          return t("trips.stay.costTooHigh");
        }
        return true;
      },
    }),
    [t],
  );

  const linkRules = useMemo(
    () => ({
      validate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        try {
          new URL(trimmed);
          return true;
        } catch {
          return t("trips.stay.linkInvalid");
        }
      },
    }),
    [t],
  );

  const timeRules = useMemo(
    () => ({
      validate: (value: string) => {
        if (!value.trim()) return true;
        return normalizeTimeInput(value) ? true : t("trips.stay.timeInvalid");
      },
    }),
    [t],
  );

  /**
   * Story 6.26, and the trap the tab split walked into rather than a precaution.
   *
   * **react-hook-form does not judge a field whose panel has been unmounted.** Its rules survive the
   * unmount — `shouldUnregister` defaults to false, which is what makes AC4 work at all — but
   * `handleSubmit`'s built-in pass skips fields marked as no longer mounted, so `handleSubmit`'s
   * invalid callback never fires for them and `onSubmit` runs with the value unchecked. Before the
   * split every field was always mounted and the distinction did not exist; after it, pressing `Save`
   * from `Kosten` sent an **empty stay name** — which `nameRules` marks `required` — straight to the
   * server, and a validation_error came back for a field the user could not see.
   *
   * So the four rule-bearing fields are re-judged from `values`, which carries every field regardless
   * of what is mounted. The rule *objects* are reused rather than their logic re-implemented, so
   * there is still one definition of "valid" per field.
   *
   * Collected and returned **before any `setError`**, so a caller can pick the first failure in *tab*
   * order rather than in the order the checks happen to run.
   *
   * **Extracted by Story 6.26's review**, because `onSubmit` was not the only caller that needed it.
   * `handleSubmit`'s built-in pass and this re-run were mutually exclusive: any *mounted* field
   * failing its rule meant `onSubmit` never ran, so the re-run — the only thing that sees unmounted
   * fields — never ran either. A bad link on `Medien & Links` plus an empty name on `Basisdaten`
   * marked only the name, and the link surfaced on a *second* Save. AC3 asks for every tab with an
   * error to be marked, so both passes now feed one set of failures.
   */
  const collectRuleFailures = useCallback(
    (values: AccommodationFormValues) => {
      const ruleFailures: Array<{ key: StayErrorKey; message: string }> = [];
      const addRuleFailure = (key: StayErrorKey, outcome: string | true) => {
        if (typeof outcome === "string") ruleFailures.push({ key, message: outcome });
      };
      addRuleFailure("name", nameRules.validate(values.name));
      addRuleFailure("costCents", costRules.validate(values.costCents));
      addRuleFailure("link", linkRules.validate(values.link));
      // Only the half `stayType` renders: the other is not registered, carries the dialog's default
      // and is never sent, so judging it would raise an error on a field this surface does not show.
      if (stayType === "current") {
        addRuleFailure("checkInTime", timeRules.validate(values.checkInTime));
      } else {
        addRuleFailure("checkOutTime", timeRules.validate(values.checkOutTime));
      }
      return ruleFailures;
    },
    [costRules, linkRules, nameRules, stayType, timeRules],
  );

  /** Set every collected failure, then reveal the first one in tab order. */
  const applyRuleFailures = useCallback(
    (ruleFailures: Array<{ key: StayErrorKey; message: string }>) => {
      for (const failure of ruleFailures) {
        setError(failure.key, { message: failure.message });
      }
      const firstKey = STAY_ERROR_KEYS_IN_TAB_ORDER.find((key) =>
        ruleFailures.some((failure) => failure.key === key),
      );
      if (firstKey) revealError(firstKey, stayErrorFocusId(fieldIdPrefix, firstKey, {}));
    },
    [fieldIdPrefix, revealError, setError],
  );

  /**
   * `handleSubmit`'s invalid callback — AC2 and AC3 together, and the one place both validation
   * passes meet.
   *
   * react-hook-form has already judged the **mounted** fields and hands their `FieldErrors` in.
   * `onSubmit` never runs in that case, so the unmounted re-run inside it never runs either — which
   * is why this callback repeats it. Without that, a bad link on `Medien & Links` plus an empty name
   * on `Basisdaten` marked only `Basisdaten`, and the link appeared on a *second* Save. AC3 says every
   * tab with an error is marked; both passes have to be in hand before that can be true.
   *
   * Failures react-hook-form already reported are filtered out rather than re-set, so the message the
   * user sees is the one its own rule produced. The reveal then picks the first key in **tab** order
   * across the union of the two passes.
   */
  const handleInvalid = useCallback(
    (formErrors: FieldErrors<AccommodationFormValues>) => {
      const unmountedFailures = collectRuleFailures(getValues()).filter(
        (failure) => !hasStayError(formErrors, failure.key),
      );
      for (const failure of unmountedFailures) {
        setError(failure.key, { message: failure.message });
      }
      const failedKeys = new Set<StayErrorKey>([
        ...STAY_ERROR_KEYS_IN_TAB_ORDER.filter((key) => hasStayError(formErrors, key)),
        ...unmountedFailures.map((failure) => failure.key),
      ]);
      const firstKey = STAY_ERROR_KEYS_IN_TAB_ORDER.find((key) => failedKeys.has(key));
      if (firstKey) revealError(firstKey, stayErrorFocusId(fieldIdPrefix, firstKey, formErrors));
    },
    [collectRuleFailures, fieldIdPrefix, getValues, revealError, setError],
  );

  const onSubmit = async (values: AccommodationFormValues) => {
    if (!day) return;
    setServerError(null);

    /**
     * The re-run happens **before** the CSRF fetch (review of Story 6.26). It used to sit after it,
     * which meant a Save pressed with an empty name issued a network request first — and if that
     * request failed the user was told `errors.csrfMissing` instead of being shown the field that was
     * actually wrong. Before the tab split every one of these rules was judged by react-hook-form
     * ahead of `onSubmit`, i.e. ahead of any fetch, so this also restores the pre-6.26 ordering.
     */
    const ruleFailures = collectRuleFailures(values);
    if (ruleFailures.length > 0) {
      applyRuleFailures(ruleFailures);
      return;
    }

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const costValue = values.costCents.trim();
    const parsedCostCents = parseAmountToCents(costValue);
    if (costValue && parsedCostCents === null) {
      setError("costCents", { message: t("trips.stay.costInvalid") });
      revealError("costCents", `${fieldIdPrefix}-cost`);
      return;
    }
    const costCents = costValue ? parsedCostCents : null;
    const linkValue = values.link.trim();
    clearErrors("payments");

    let paymentsPayload: { amountCents: number; dueDate: string }[] = [];
    if (costCents === null) {
      const hasPaymentInput =
        values.payments?.some((payment) => payment.amount.trim().length > 0 || payment.dueDate.trim().length > 0) ?? false;
      if (hasPaymentInput) {
        setError("payments", { message: t("trips.payments.costRequired") });
        revealError("payments", `${fieldIdPrefix}-cost`);
        return;
      }
    } else {
      if (values.paymentMode === "single") {
        const dueDate = values.payments?.[0]?.dueDate?.trim() ?? "";
        if (!dueDate) {
          setError("payments.0.dueDate", { message: t("trips.payments.dateRequired") });
          revealError("payments", `${fieldIdPrefix}-payment-date-0`);
          return;
        }
        paymentsPayload = [{ amountCents: costCents, dueDate }];
      } else {
        if (!values.payments || values.payments.length < 2) {
          setError("payments", { message: t("trips.payments.minRows") });
          revealError("payments", `${fieldIdPrefix}-cost`);
          return;
        }
        let total = 0;
        let hasError = false;
        // The index of the first row that failed, so AC2's caret lands on *that* row rather than on
        // the block. `forEach` keeps going after a failure (it sets an error per row), so the first
        // one is remembered rather than recomputed from `errors`, which is stale in this closure.
        let firstFailedFocusId: string | null = null;
        values.payments.forEach((payment, index) => {
          const amountValue = payment.amount?.trim() ?? "";
          const amountCents = parseAmountToCents(amountValue);
          if (!amountValue || amountCents === null) {
            setError(`payments.${index}.amount` as const, { message: t("trips.payments.amountRequired") });
            hasError = true;
            firstFailedFocusId ??= `${fieldIdPrefix}-payment-amount-${index}`;
            return;
          }
          const dueDate = payment.dueDate?.trim() ?? "";
          if (!dueDate) {
            setError(`payments.${index}.dueDate` as const, { message: t("trips.payments.dateRequired") });
            hasError = true;
            firstFailedFocusId ??= `${fieldIdPrefix}-payment-date-${index}`;
            return;
          }
          total += amountCents;
          paymentsPayload.push({ amountCents, dueDate });
        });
        if (hasError) {
          revealError("payments", firstFailedFocusId);
          return;
        }
        if (total !== costCents) {
          setError("payments", { message: t("trips.payments.sumMismatch") });
          revealError("payments", `${fieldIdPrefix}-cost`);
          return;
        }
      }
    }

    const payload: {
      tripDayId: string;
      name: string;
      status: "planned" | "booked";
      costCents: number | null;
      payments: { amountCents: number; dueDate: string }[];
      link: string | null;
      notes: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
      checkInTime?: string | null;
      checkOutTime?: string | null;
    } = {
      tripDayId: day.id,
      name: values.name,
      status: values.status,
      costCents,
      payments: paymentsPayload,
      link: linkValue.length > 0 ? linkValue : null,
      notes: values.notes.trim() ? values.notes : null,
      location: resolvedLocation,
    };
    if (stayType === "current" && dirtyFields.checkInTime) {
      payload.checkInTime = normalizeTimeInput(values.checkInTime) ?? null;
    }
    if (stayType === "previous" && dirtyFields.checkOutTime) {
      payload.checkOutTime = normalizeTimeInput(values.checkOutTime) ?? null;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/accommodations`, {
        method: day.accommodation ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as ApiEnvelope<{ accommodation: { id: string } }>;

      if (!response.ok || body.error) {
        if (body.error?.code === "validation_error" && body.error.details) {
          const details = body.error.details as { fieldErrors?: Record<string, string[]> };
          // AC2/AC3. Which tabs the server just faulted, collected while the errors are set: a
          // dotted path like `payments.0.amount` belongs to the `payments` key, and `errors` cannot
          // be read back here because these `setError` calls have not been applied yet.
          // Keyed by the error key, valued by the *path* the server used, so a row-level
          // `payments.1.amount` can still focus row 1 rather than the block.
          const failedPaths = new Map<StayErrorKey, string>();
          // A tab the server faulted through a key that is not a form field — `location`, per the
          // review decision. Held separately because there is no `setError` to make for it: nothing on
          // that tab is a registered field, so there is no inline slot to render the message in and
          // the banner has to carry it. The server's own wording is kept rather than the generic
          // `trips.stay.error`, because "Location label must be at most 200 characters" tells the user
          // what to shorten and "Stay update failed" does not.
          let payloadTab: StayTabId | null = null;
          let payloadMessage: string | null = null;
          // A key that is neither a form field nor payload-mapped (`tripDayId`), or a `fieldErrors`
          // that is absent entirely. Nothing on any tab shows it, so the banner is the whole answer.
          let hasUnmappable = false;
          Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
            if (!messages?.[0]) return;
            const baseKey = field.split(".")[0];
            if (baseKey in STAY_ERROR_TAB) {
              /*
                `setError` **only** for keys the form actually registered, and this guard is the whole
                fix for the worst defect Story 6.26's review found.

                It used to run unconditionally, for every key the server named. An error planted under
                a key with no registered field is one react-hook-form never revalidates and never
                clears — and `handleSubmit` then routes to its *invalid* callback on every subsequent
                press, forever, never reaching `onSubmit`. Verified: two submits with valid data, both
                invalid. So one `location` rejection turned every later Save into a silent no-op — no
                request, no banner, no marker — and the dialog stayed dead until it was closed and
                reopened. The first failure raised the banner, which is exactly why it read as
                handled.
              */
              setError(field as keyof AccommodationFormValues, { message: messages[0] });
              if (!failedPaths.has(baseKey as StayErrorKey)) failedPaths.set(baseKey as StayErrorKey, field);
            } else if (baseKey in STAY_PAYLOAD_ERROR_TAB) {
              payloadTab ??= STAY_PAYLOAD_ERROR_TAB[baseKey as keyof typeof STAY_PAYLOAD_ERROR_TAB];
              payloadMessage ??= messages[0];
            } else {
              hasUnmappable = true;
            }
          });

          const firstKey = STAY_ERROR_KEYS_IN_TAB_ORDER.find((key) => failedPaths.has(key));
          /*
            The banner is raised whenever *anything* was unmappable, not only when everything was —
            which is the second half of the same finding. `if (!firstKey)` alone meant a response
            naming both `name` and `tripDayId` revealed the name and dropped the other with no banner,
            no marker and no trace. AC2's "saving never fails silently" has to hold per error, not per
            response.
          */
          if (hasUnmappable || (!firstKey && !payloadTab)) {
            setServerError(t("trips.stay.error"));
          } else if (payloadMessage) {
            // A payload-mapped fault has a tab but no inline slot, so the banner is the only place its
            // message can appear. Selecting a tab and saying nothing would be its own silent failure.
            setServerError(payloadMessage);
          }
          if (!firstKey) {
            // No form field was faulted, but `location` was: select the tab that shows it and put the
            // caret in the search box, rather than leaving the user with only a banner.
            if (payloadTab) {
              setActiveTab(payloadTab);
              setPendingErrorFocus((current) => ({
                elementId: `${fieldIdPrefix}-place`,
                nonce: (current?.nonce ?? 0) + 1,
              }));
            }
            return;
          }
          const serverPath = failedPaths.get(firstKey) ?? firstKey;
          const paymentRow = /^payments\.(\d+)\.(amount|dueDate)$/.exec(serverPath);
          revealError(
            firstKey,
            paymentRow
              ? `${fieldIdPrefix}-payment-${paymentRow[2] === "amount" ? "amount" : "date"}-${paymentRow[1]}`
              : // No `errors` object to consult, and none is needed: every other key resolves to a
                // fixed id, and the `payments` fallback (`-cost`) is the right target for a
                // block-level message anyway.
                stayErrorFocusId(fieldIdPrefix, firstKey, {}),
          );
          return;
        }

        setServerError(resolveApiError(body.error?.code, t("trips.stay.error")));
        return;
      }

      onSaved();
    } catch {
      setServerError(t("trips.stay.error"));
    }
  };

  const handleDelete = async () => {
    if (!day || !day.accommodation) return;

    setServerError(null);
    setIsDeleting(true);

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      setIsDeleting(false);
      return;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/accommodations`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ tripDayId: day.id }),
      });

      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

      if (!response.ok || body.error) {
        setServerError(resolveApiError(body.error?.code, t("trips.stay.deleteError")));
        return;
      }

      onSaved();
    } catch {
      setServerError(t("errors.csrfMissing"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLookupLocation = async () => {
    const query = locationQuery.trim();
    if (!query) {
      setServerError(t("trips.location.searchRequired"));
      return;
    }

    setServerError(null);
    setIsGeocoding(true);
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
      setIsGeocoding(false);
    }
  };

  const uploadGalleryImages = async () => {
    if (!day?.accommodation || galleryFiles.length === 0) return;

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
      const uploaded: GalleryImage[] = [];
      for (const file of galleryFiles) {
        const formData = new FormData();
        formData.set("tripDayId", day.id);
        formData.set("accommodationId", day.accommodation.id);
        formData.set("file", file);

        const response = await fetch(`/api/trips/${tripId}/accommodations/images`, {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": token },
          body: formData,
        });
        const body = (await response.json()) as ApiEnvelope<{ image: GalleryImage }>;
        if (!response.ok || body.error || !body.data?.image) {
          setServerError(resolveApiError(body.error?.code, t("trips.stay.error")));
          return;
        }
        uploaded.push(body.data.image);
      }
      setGalleryImages((current) => [...current, ...uploaded]);
      setGalleryFiles([]);
    } catch {
      setServerError(resolveApiError(undefined, t("trips.stay.error")));
    } finally {
      setGalleryBusy(false);
    }
  };

  const deleteGalleryImage = async (imageId: string) => {
    if (!day?.accommodation) return;
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
      const response = await fetch(`/api/trips/${tripId}/accommodations/images`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          tripDayId: day.id,
          accommodationId: day.accommodation.id,
          imageId,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || body.error) {
        setServerError(resolveApiError(body.error?.code, t("trips.stay.deleteError")));
        return;
      }
      setGalleryImages((current) => current.filter((image) => image.id !== imageId));
    } catch {
      setServerError(resolveApiError(undefined, t("trips.stay.deleteError")));
    } finally {
      setGalleryBusy(false);
    }
  };

  /**
   * Story 9.1, the document twin of `uploadGalleryImages`: the same two-step flow (pick, then press
   * Upload), the same `ensureCsrfToken` handshake, the same one-request-per-file loop.
   *
   * Three deliberate differences from the pair above.
   *
   * The client-side pre-check is `isSupportedDocumentUpload` and it reports
   * `trips.documents.unsupportedFormat`, never `trips.image.unsupportedFormat`. Naming photo formats
   * at a field that also accepts PDF would tell the user the opposite of the truth, and the two
   * filters staying separate is half of what keeps a file out of the bucket it was not placed in.
   *
   * The **10-per-entry cap is the server's**. The Upload action is disabled at the cap in the panel
   * below, but that is a convenience: the repository counts the rows and the route answers 400 with
   * its own message, which is the branch mapped here. A cap the client alone enforces is not a cap.
   *
   * The loop follows `TripDayPlanDialog`'s rather than this file's gallery loop: each success is
   * committed to state as it lands and only the unsent tail stays staged. `uploadGalleryImages`
   * collects into a local array and returns on the first failure, which drops every already-stored
   * photo out of the view until the dialog is reopened — a pre-existing wart belonging to that
   * function's own change, and not one to ship a second copy of.
   */
  const uploadDocuments = async () => {
    if (!day?.accommodation || documentFiles.length === 0) return;

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
        formData.set("accommodationId", day.accommodation.id);
        formData.set("file", file);

        const response = await fetch(`/api/trips/${tripId}/accommodations/documents`, {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": token },
          body: formData,
        });
        const body = (await response.json()) as ApiEnvelope<{ document: AccommodationDocument }>;
        if (!response.ok || body.error || !body.data?.document) {
          failedAtIndex = index;
          // Matched on the message because `validation_error` is also what a rejected type, an
          // oversized file and an unusable name come back as — the code alone cannot tell the user
          // which of the four happened, and "up to 10 per entry" is the one of them the user can act
          // on without being told anything else. Against the shared constant rather than a literal:
          // the route answers with the same one, so a reword cannot silently turn the actionable
          // message into "please try again". It stays ahead of `resolveApiError` for that same reason:
          // the cap is a `validation_error` like three other rejections, so the code switch cannot tell
          // it apart and would flatten it back into the generic message.
          setServerError(
            body.error?.message === DOCUMENT_LIMIT_ERROR_MESSAGE
              ? t("trips.documents.limitReached")
              : resolveApiError(body.error?.code, t("trips.documents.uploadError")),
          );
          break;
        }
        const uploadedDocument = body.data.document;
        setDocuments((current) => [...current, uploadedDocument]);
      }

      setDocumentFiles(failedAtIndex === -1 ? [] : documentFiles.slice(failedAtIndex));
    } catch {
      setServerError(resolveApiError(undefined, t("trips.documents.uploadError")));
    } finally {
      setDocumentBusy(false);
    }
  };

  /** The document twin of `deleteGalleryImage`: an immediate write, with nothing staged behind it. */
  const deleteDocument = async (documentId: string) => {
    if (!day?.accommodation) return;
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
      const response = await fetch(`/api/trips/${tripId}/accommodations/documents`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          tripDayId: day.id,
          accommodationId: day.accommodation.id,
          documentId,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || body.error) {
        setServerError(resolveApiError(body.error?.code, t("trips.documents.deleteError")));
        return;
      }
      // `documentRow`, not `document`: this file reaches for the global of that name (the error-focus
      // effect calls `document.getElementById`), and a parameter shadowing it is a trap for whoever
      // adds a focus or measurement call inside one of these callbacks next.
      setDocuments((current) => current.filter((documentRow) => documentRow.id !== documentId));
    } catch {
      setServerError(resolveApiError(undefined, t("trips.documents.deleteError")));
    } finally {
      setDocumentBusy(false);
    }
  };

  const title = day?.accommodation ? t("trips.stay.editTitle") : t("trips.stay.addTitle");

  /**
   * Screen G's `.dialog-sub`: which day this stay belongs to. The `day` prop already carries both
   * halves. The `Intl` call is inlined rather than shared because the only existing short-date
   * formatter lives inside `TripTimeline.tsx`, which Story 7.8 owns and this story must not touch —
   * extracting it is a follow-up once 7.8 lands.
   */
  const daySubtitle = useMemo(() => {
    if (!day) return null;
    const dayLabel = formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex });
    const date = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(day.date));
    return `${dayLabel} · ${date}`;
  }, [day, language, t]);

  const sortedGalleryImages = useMemo(
    () => galleryImages.slice().sort((left, right) => left.sortOrder - right.sortOrder),
    [galleryImages],
  );

  /**
   * Insertion order, which for documents is the only order there is: Story 9.1 adds no reorder
   * control, so `sortOrder` only ever counts up. Sorted here anyway, for the same reason the gallery
   * is — the list is appended to locally after each upload and re-read wholesale on the next open,
   * and the two must agree about what "first" means.
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

  /**
   * Recomputed from `errors` on every render rather than kept in a second store: the markers are
   * global chrome now, and a tab that keeps its warning triangle after the user has fixed the field
   * makes the tab bar lie until the next save. react-hook-form clears the key on revalidation, so
   * reading straight from it is what keeps them honest.
   *
   * **Not `useMemo`, and this is the whole finding of Story 6.26's review.** It was
   * `useMemo(() => stayTabsWithErrors(errors), [errors])`, and that cached an empty `Set` forever:
   * for its *own* built-in validation pass react-hook-form mutates `_formState.errors` **in place**,
   * so the object identity never changes and the dependency never fires. The effect was that the one
   * path AC2 names in words — pressing Save while already standing on the tab that owns the error —
   * marked nothing at all: no colour, no glyph, no accessible name, while the field's own message
   * rendered fine right underneath.
   *
   * It survived because the manual `setError` paths *do* get a fresh object (`handleSubmit` replaces
   * `errors` with `{}` before invoking the valid callback), and every one of the story's six new
   * cases stood on a different tab first, which routes through those. The sibling
   * `TripDayPlanDialog` is unaffected for a reason that does not transfer: it memoises over
   * `useState` values that are replaced immutably.
   *
   * A plain call is correct here — `stayTabsWithErrors` walks nine keys — and it is the only form
   * that cannot go stale against a mutable store. If a future refactor reaches for memoisation
   * again, the dependency has to be a *value* derived from the errors, never the errors object.
   */
  const tabsWithErrors = stayTabsWithErrors(errors);

  /**
   * Story 6.25 AC7 / EXPERIENCE.md.State Patterns → "Dismissing a dialog with unsaved input".
   *
   * `isDirty` is measured against the open effect's `reset()`, so it means "differs from the stay this
   * dialog opened on". Two things live outside the form and are added by hand:
   *
   * - `resolvedLocation`, written by the geocode lookup, which no `onChange` sees. Compared against the
   *   coordinate the stay already had rather than against `null`, so an untouched saved location does
   *   not read as dirty. `locationQuery` is deliberately excluded: it is a search box whose text no
   *   save persists, and Story 6.24 found that watching one makes a form dirty for nothing.
   * - `galleryFiles`, the photos staged but not yet uploaded. `galleryImages` — the ones already on the
   *   server — are excluded, because adding and removing those are immediate writes with nothing
   *   pending behind them. Same split as 6.24.
   * - `documentFiles` (Story 9.1), and it splits along exactly the same line for exactly the same
   *   reason. A staged document is unsaved input: `uploadDocuments` runs from the Media tab's own
   *   Upload button and from nowhere else, so dismissing the dialog drops it and nothing else in this
   *   form does. `documents` — the rows already on the server — are excluded, because adding and
   *   removing those are immediate writes and a discard would not undo them.
   *
   * `.length` on both file arrays rather than the arrays themselves: what the question turns on is
   * whether anything is staged, and the identity of a `File[]` rebuilt from a picker change is not
   * that.
   */
  const openLocationKey = day?.accommodation?.location
    ? `${day.accommodation.location.lat},${day.accommodation.location.lng}`
    : "";
  const currentLocationKey = resolvedLocation ? `${resolvedLocation.lat},${resolvedLocation.lng}` : "";
  const stayGuard = useDiscardGuard(
    isDirty || currentLocationKey !== openLocationKey || galleryFiles.length > 0 || documentFiles.length > 0,
    onClose,
  );

  return (
    <>
    <DialogShell
      open={open}
      onClose={stayGuard.requestClose}
      closeLabel={t("common.close")}
      title={title}
      subtitle={daySubtitle ?? undefined}
      // Screen G's `.dialog.w-520`. This dialog carries the payment rows, whose minWidth floors are
      // preserved rather than compressed — see the browser check in the story record.
      width={520}
      // The `✕` is disabled while a save or delete is in flight; without this the backdrop and
      // Escape would walk straight past that guard and discard the user's edits mid-request.
      disableDismiss={isSubmitting || isDeleting}
      footer={
        <>
          <Box>
            {day?.accommodation && (
              /*
                No `color="error"`: theme.ts defines no `error` palette entry, so MUI falls back to
                #d32f2f, a colour DESIGN.md does not have. Destructive actions use the text variant,
                exactly as 7.8's AC states for "Reise löschen".
              */
              <Button variant="text" onClick={handleDelete} disabled={isSubmitting || isDeleting} sx={{ color: tokens.ink }}>
                {isDeleting ? <CircularProgress size={22} /> : t("trips.stay.delete")}
              </Button>
            )}
          </Box>
          {/* Story 6.25 AC2. `Abbrechen` left the footer for the head's `✕`, so the wrapper that
              stacked the pair at xs has one child and is kept for the layout, not the pair. */}
          <Box sx={{ display: "flex", flexDirection: { xs: "column-reverse", sm: "row" }, gap: "10px" }}>
            <Button type="submit" form={formId} variant="contained" disabled={isSubmitting || isDeleting}>
              {isSubmitting ? <CircularProgress size={22} /> : t("trips.stay.save")}
            </Button>
          </Box>
        </>
      }
      footerSx={{ justifyContent: "space-between" }}
    >
        <Box display="flex" flexDirection="column" gap="18px">
          {(serverError || initError) && <FormNotice tone="warn" message={serverError ?? initError ?? ""} />}

          {/*
            Story 6.26 AC1. MUI `Tabs`/`Tab` rather than hand-rolled buttons, and the same pill switch
            `AuthTabs` established and `theme.ts` already encodes (`MuiTabs` paints the `paperOuter`
            track, `MuiTab` the white selected pill) — the chrome is copied from `TripDayPlanDialog`
            deliberately, because two dialogs on the same day screen splitting their fields into tabs
            that *look* different would read as two unrelated mechanisms.

            The bar sits outside the `<form>`: a `Tab` is a `<button>`, and while MUI types it
            `button` rather than `submit`, keeping the tablist out of the form means no future default
            can turn a tab switch into a save.

            The underline indicator is switched off because the filled pill is the selected state, and
            an underline on top of it is a second, conflicting one.
          */}
          <Tabs
            value={activeTab}
            onChange={(_event, value: StayTabId) => setActiveTab(value)}
            aria-label={t("trips.stay.tabsLabel")}
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
            {STAY_TAB_IDS.map((tabId) => {
              const label = t(STAY_TAB_LABEL_KEYS[tabId]);
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
                  // AC3's marker is a warning triangle, not a colour: the tint on its own would be the
                  // only signal for a red-green colour-blind reader. The accessible name says it in
                  // words too, so the marker is not sighted-only either.
                  aria-label={hasError ? formatMessage(t("trips.stay.tabWithErrors"), { label }) : undefined}
                  label={label}
                  icon={hasError ? <WarningTriangleIcon sx={{ fontSize: 13 }} /> : undefined}
                  iconPosition="end"
                  // `warning.main`, not `warnBorder`: the marker has to be legible on the white
                  // selected pill, where the border token sits at 1.6:1. This is the colour theme.ts
                  // already assigns to every error foreground in the app.
                  //
                  // `&.Mui-selected` is repeated deliberately (review of Story 6.26). A bare `color`
                  // on the root is one class of specificity, and MUI's own `textColor="primary"`
                  // variant emits `&.Mui-selected { color: primary.main }` at two — so the *selected*
                  // errored tab came out `primary.main` green, and the triangle with it via
                  // `currentColor`. AC2 auto-selects the tab that owns the error, which means the
                  // colour channel was missing in precisely the state the user is put into, leaving
                  // the glyph and the accessible name to carry AC3 alone.
                  sx={hasError ? { color: warning.main, "&.Mui-selected": { color: warning.main } } : undefined}
                />
              );
            })}
          </Tabs>

          {/*
            AC2/AC3. `handleSubmit`'s second argument is react-hook-form's invalid callback — it fires
            with the `FieldErrors` its own rules produced (a missing name, a malformed time or URL)
            *instead of* `onSubmit`, so without it a rule failing on an unselected tab would mark
            nothing and focus nothing. The manual `setError` paths inside `onSubmit` reveal themselves.

            AC5's floor lives on the form rather than on each panel: one element carries the number, so
            a fifth panel inherits the behaviour instead of having to remember it. Every panel stays
            top-aligned inside it — a flex child is not stretched along the main axis — so a short one
            shows empty space underneath while a tall one simply exceeds the floor and scrolls with the
            dialog body as it always did.
          */}
          <Box
            component="form"
            id={formId}
            onSubmit={handleSubmit(onSubmit, handleInvalid)}
            display="flex"
            flexDirection="column"
            gap="18px"
            data-testid="stay-tabpanel-floor"
            sx={STAY_PANEL_FLOOR_SX}
          >
          {activeTab === "basics" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-basics`}
              aria-labelledby={`${fieldIdPrefix}-tab-basics`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
            <FormField
              id={`${fieldIdPrefix}-name`}
              label={t("trips.stay.nameLabel")}
              // `nameRules` carries a message the floating-label version never rendered. DESIGN.md:244
              // — colour is never the sole signal — so the restyle shows it.
              error={errors.name?.message}
              {...register("name", nameRules)}
            />
            {/*
              Screen G pairs two fields in one `.field-row`. Before this story the row held the time
              field and the cost field, because `stayType` renders exactly one of check-in/check-out
              and a lone time input left a hole. Cost belongs to `Kosten` now, so the row pairs the
              status select with the time instead — the same reasoning, a different second field, and
              a 520px-wide dialog still does not want a 44px time input stretched across all of it.
            */}
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                gap: "12px",
                "& > *": { flex: 1, minWidth: 0 },
              }}
            >
              {/*
                The status select keeps its own caps label rather than an `InputLabel`: a floating
                label is the pattern this restyle removes, and MUI's `Select` renders a div, so a
                `<label htmlFor>` would associate with nothing. `aria-labelledby` names it instead.
                Preserved because Screen G does not draw it — that is the mockup showing a smaller
                form, not a decision to drop FR13.
              */}
              <FormControl fullWidth error={Boolean(errors.status)}>
                <Typography
                  id={`${fieldIdPrefix}-status-label`}
                  variant="labelCaps"
                  component="div"
                  sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, mb: "7px" }}
                >
                  {t("trips.stay.statusLabel")}
                </Typography>
                <Controller
                  control={control}
                  name="status"
                  /*
                    `labelId`, not a bare `aria-labelledby`. MUI forwards unrecognised props through
                    `...other` onto the OutlinedInput *wrapper div*, leaving the inner
                    `role="combobox"` — the element AT actually reads — unnamed. `labelId` is the one
                    prop `Select` routes down to it.

                    `id` is what Story 6.26 adds: it lands on the `role="combobox"` element, which is
                    what `stayErrorFocusId` needs to be able to focus the control for a `status` error.
                  */
                  render={({ field }) => (
                    <Select id={`${fieldIdPrefix}-status`} labelId={`${fieldIdPrefix}-status-label`} {...field}>
                      <MenuItem value="planned">{t("trips.stay.statusPlanned")}</MenuItem>
                      <MenuItem value="booked">{t("trips.stay.statusBooked")}</MenuItem>
                    </Select>
                  )}
                />
              </FormControl>
              {/*
                Story 6.18: native `type="time"`, matching `TripDayPlanDialog`. The previous
                `inputMode: "numeric"` asked the OS for a digits-only keypad, and neither iOS nor
                Android puts a colon on it — so `16:00` could not be typed on a phone at all. The
                placeholders went with it: a time input never renders one, and both fields are
                prefilled with the default anyway. `timeRules` still judges the value; `type="time"`
                narrows the keyboard, not the set of values that can reach `onSubmit`.
              */}
              {stayType === "current" ? (
                <FormField
                  id={`${fieldIdPrefix}-check-in`}
                  label={t("trips.stay.checkInLabel")}
                  error={errors.checkInTime?.message}
                  {...register("checkInTime", timeRules)}
                  type="time"
                />
              ) : (
                <FormField
                  id={`${fieldIdPrefix}-check-out`}
                  label={t("trips.stay.checkOutLabel")}
                  error={errors.checkOutTime?.message}
                  {...register("checkOutTime", timeRules)}
                  type="time"
                />
              )}
            </Box>
            </Box>
          )}

          {activeTab === "cost" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-cost`}
              aria-labelledby={`${fieldIdPrefix}-tab-cost`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
            {/* Moved out of the time row: the amount and the schedule it is split into are one
                subject, and separating them across two tabs was the split the user could not read. */}
            <FormField
              id={`${fieldIdPrefix}-cost`}
              label={t("trips.stay.costLabel")}
              error={errors.costCents?.message}
              {...register("costCents", costRules)}
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.01, inputMode: "decimal" } }}
              placeholder="0.00"
            />
            <FormControl component="fieldset" error={Boolean(errors.payments)} variant="standard">
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
                value={paymentMode ?? "single"}
                onChange={(event) => {
                  setValue("paymentMode", event.target.value as "single" | "split", { shouldDirty: true });
                }}
              >
                <FormControlLabel value="single" control={<Radio />} label={t("trips.payments.payAllNow")} />
                <FormControlLabel value="split" control={<Radio />} label={t("trips.payments.split")} />
              </RadioGroup>
              <input type="hidden" {...register("paymentMode")} />
              {/* flexWrap and the minWidth floors are preserved — the rows wrap rather than being
                  compressed below the 44px control floor to make 520px fit. */}
              <Box display="flex" flexDirection="column" gap={1.25} mt={0.5}>
                {paymentFields.map((field, index) => (
                  <Box key={field.id} display="flex" gap={1} alignItems="flex-start" flexWrap="wrap">
                    <Box sx={{ flex: 1, minWidth: 140 }}>
                      <FormField
                        id={`${fieldIdPrefix}-payment-amount-${index}`}
                        label={t("trips.payments.amountLabel")}
                        error={errors.payments?.[index]?.amount?.message}
                        {...register(`payments.${index}.amount` as const)}
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
                        error={errors.payments?.[index]?.dueDate?.message}
                        {...register(`payments.${index}.dueDate` as const)}
                        type="date"
                      />
                    </Box>
                    {paymentMode === "split" && (
                      <Button
                        variant="text"
                        onClick={() => remove(index)}
                        disabled={paymentFields.length <= 2}
                        sx={{ color: tokens.ink, mt: "24px" }}
                      >
                        {t("trips.payments.removeAction")}
                      </Button>
                    )}
                  </Box>
                ))}
                {paymentMode === "split" && (
                  <Button size="small" onClick={() => append({ amount: "", dueDate: defaultDueDate })}>
                    {t("trips.payments.addAction")}
                  </Button>
                )}
              </Box>
              <FormHelperText>{errors.payments?.message}</FormHelperText>
            </FormControl>
            </Box>
          )}

          {activeTab === "place" && (
            <Box
              role="tabpanel"
              id={`${fieldIdPrefix}-tabpanel-place`}
              aria-labelledby={`${fieldIdPrefix}-tab-place`}
              display="flex"
              flexDirection="column"
              gap="18px"
            >
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
                <Button
                  variant="outlined"
                  onClick={() => void handleLookupLocation()}
                  disabled={isSubmitting || isDeleting || isGeocoding}
                >
                  {isGeocoding ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
                </Button>
                <Button
                  variant="text"
                  onClick={() => setResolvedLocation(null)}
                  disabled={isSubmitting || isDeleting || isGeocoding || !resolvedLocation}
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
            <FormField
              id={`${fieldIdPrefix}-notes`}
              label={t("trips.stay.notesLabel")}
              error={errors.notes?.message}
              {...register("notes")}
              multiline
              minRows={3}
            />
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
            {/*
              AC1 pairs the link with the gallery, exactly as Story 6.22 did on the activity dialog and
              for the same two reasons. The gallery is gated on a saved stay, so on its own this tab
              would be empty while adding one; and a tab holding nothing but the link would be the
              single-field tab 6.22 ruled out. Together they are a section either way.
            */}
            <FormField
              id={`${fieldIdPrefix}-link`}
              label={t("trips.stay.linkLabel")}
              error={errors.link?.message}
              {...register("link", linkRules)}
              type="url"
              slotProps={{ htmlInput: { inputMode: "url" } }}
              placeholder="https://"
              hint={t("trips.stay.linkHelper")}
            />
            {!day?.accommodation && (
              // Saying why the upload zone is absent, rather than rendering one that would have no
              // accommodation id to post against. Same treatment as `trips.plan.galleryAfterSave`.
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {t("trips.stay.galleryAfterSave")}
              </Typography>
            )}
            {!day?.accommodation && (
              // Story 9.1. Its own line rather than a sentence bolted onto the gallery's: the two
              // fields are absent for the same reason but they are two fields, and a user adding a
              // stay to attach a ticket to needs to be told about the one they came for.
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {t("trips.stay.documentsAfterSave")}
              </Typography>
            )}
            {day?.accommodation && (
              /*
                AC5 rebuild: dashed dropzone + a 56px sharp preview strip, replacing the bare file
                TextField and the vertical list of 42px rounded thumbs each paired with a red 36px
                delete button. The explicit Upload action is KEPT — `uploadGalleryImages` is a real
                network step with its own error path and busy state, so the select-then-upload flow
                stays two-step rather than firing on selection.
              */
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
                    ? // Was hardcoded English (`{n} file(s) selected`) while the day-plan dialog used
                      // this key for the same string. Uses the key now.
                      formatMessage(t("trips.gallery.selectedFiles"), { count: galleryFiles.length })
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
            {day?.accommodation && (
              /*
                Story 9.1 AC2. **Below** the photo field, on the same tab, gated on the same saved
                stay — and with a label of its own (`Dokumente` against `Bildergalerie`), because the
                whole criterion is that a JPEG's destination is the user's choice rather than the
                app's guess. Two fields, two accept filters, two upload actions, two server-side
                pools: a file placed in one never appears in the other.

                No fifth tab and no new panel. `STAY_TAB_IDS` is unchanged, and the media panel is now
                the tallest of the four — which is fine, `STAY_PANEL_MIN_HEIGHT` is a floor and a
                floor is a thing a panel is allowed to stand well above.

                Deliberately outside react-hook-form, as the gallery is. Story 6.26 recorded that the
                form keeps an unmounted field's *value* but skips its *rules*, which is why `onSubmit`
                re-judges four fields by hand; a document field registered here would inherit that
                problem for no gain, since nothing about it is submitted with the stay.
              */
              <DocumentUploadField
                id={`${fieldIdPrefix}-documents`}
                label={t("trips.documents.title")}
                zoneTitle={t("trips.documents.uploadZoneTitle")}
                // The 10 MB / PDF-JPEG-PNG-WebP line. Passed so it is wired to the input as
                // `aria-describedby` rather than being sighted-only — a rejected 12 MB upload is a
                // worse way to learn the ceiling than reading it before picking.
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
                    // The cap in the third term is a convenience only: the repository counts the rows
                    // and the route answers 400, and `uploadDocuments` maps that answer. Disabling
                    // here saves a round trip that could only ever fail; it does not enforce anything.
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
                  // Keyed by the document id, not by position in a second array — the same reason the
                  // gallery's remove is: an index deletes the wrong row silently the day any filtering
                  // or async insertion makes the two lists disagree.
                  onRemove: () => void deleteDocument(documentRow.id),
                }))}
              />
            )}
            </Box>
          )}
          </Box>
        </Box>
    </DialogShell>
      <DiscardChangesDialog {...stayGuard.dialogProps} />
      <FullscreenPhotoViewer
        open={fullscreenIndex !== null}
        images={galleryPreviews}
        startIndex={fullscreenIndex ?? 0}
        onClose={() => setFullscreenIndex(null)}
      />
    </>
  );
}
