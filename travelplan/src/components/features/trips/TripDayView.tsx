"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  SvgIcon,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import FormField from "@/components/forms/FormField";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import DocChip from "@/components/ui/DocChip";
import FullscreenPhotoViewer, { type FullscreenPhoto } from "@/components/ui/FullscreenPhotoViewer";
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import TripDayGanttBar, { buildGanttPalette } from "@/components/features/trips/TripDayGanttBar";
import {
  buildPlanItemSegments,
  buildStaySegments,
  buildTravelSegments,
  deriveCoverageSummary,
  type TripDayGanttSegment,
} from "@/components/features/trips/TripDayGanttSegments";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HERO_SCRIM,
  HouseIcon,
  MoreHorizontalIcon,
  ON_PHOTO_CHROME,
  PencilIcon,
  WarningTriangleIcon,
  toCssUrl,
  transportIconFor,
} from "@/components/features/trips/TripIcons";
import TripDayMapPanel, {
  type TripDayMapPoint,
} from "@/components/features/trips/TripDayMapPanel";
import TripDayBucketListPanel from "@/components/features/trips/TripDayBucketListPanel";
import TripDayPlanDialog, { type PlanItemMoveOutcome } from "@/components/features/trips/TripDayPlanDialog";
import TripDayTravelSegmentDialog from "@/components/features/trips/TripDayTravelSegmentDialog";
import { MiniImageStrip, PlanItemRichContent, isSafeLink, parsePlanText, toViewerImages } from "@/components/features/trips/TripDayPlanItemContent";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { buildDayMapPanelData, buildTripDayMapItems } from "@/lib/trips/dayMapData";
import { documentDisplayName } from "@/lib/trips/documentUploads";
import { IMAGE_UPLOAD_ACCEPT, isSupportedImageUpload } from "@/lib/trips/imageUploads";
import { transportTypeAllowsDistance, type TransportType } from "@/lib/trips/transportTypes";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/**
 * Styling hook for the activity card's edit glyph.
 *
 * A real class rather than a `[data-testid=...]` selector: the card's hover and touch rules have to
 * reach the glyph from the outside, and hanging production CSS off a test attribute makes renaming a
 * test id a silent visual regression.
 */
const EDIT_GLYPH_CLASS = "day-plan-item-edit-glyph";

/**
 * Cap for the activity title once it is spoken as the edit overlay's accessible name.
 *
 * An activity with no title falls back to its flattened note body, which has no length bound of its
 * own - a screen reader would otherwise announce the whole note every time focus lands on the card.
 */
const EDIT_LABEL_MAX_CHARS = 80;

/**
 * The width at which the `doc-chip` group is allowed to sit beside the photo strip on a `tl-card`'s
 * media row (DESIGN.md `:260-264`, AC4).
 *
 * **Measured** in headless Chrome 151 against a production build, on `tl-card`s carrying three photos
 * and one, two, three and five documents (Story 9.1 Task 11). The photo strip is 180.00px at every
 * width measured — three 56px thumbnails plus two 6px gaps — so the epic's arithmetic was right about
 * the strip and wrong about the rest.
 *
 * | viewport  | card content width | photo strip | space beside strip | chips that fit | wraps? |
 * |-----------|--------------------|-------------|--------------------|----------------|--------|
 * | 390×844   | 290.00             | 180.00      | 104.00             | 0              | always, as a group |
 * | 900×900   | 430.00             | 180.00      | 244.00             | 2 (up to 244px of group) | only when the group is wider |
 * | 1280×900  | 619.33             | 180.00      | 433.33             | 2–3 (up to 433px of group) | only when the group is wider |
 *
 * 900px is in the table because it is the *tightest* desktop case, not a typo: the `md` two-column
 * layout starts there and the content column is narrower at 900 (430px) than at 880 (764px). Content
 * width by viewport, measured: 360→260, 390→290, 600→484, 768→652, 880→764, 900→430, 1024→509,
 * 1280→619.33, 1440→619.33 (capped).
 *
 * Chip widths, measured, with real names: 63.81px (`Drei`) up to **200.00px**, which is the ceiling —
 * 10px padding + 14px glyph + 6px gap + the token's 160px label cap + 10px padding. Two chips plus the
 * 6px gap therefore measured 137.96 (`Eins`+`Zwei`), 206.30 (`Bootsfahrt`+`Rechnung`), 208.61
 * (`Hotelvoucher`+`Anfahrt`), 314.97, and 406.00 for two chips both at the label cap.
 *
 * **Why 210 and not the shipped 200.** 200 is *exactly one* maximum-width chip. It can never hold two
 * of anything, so as a stand-in for AC4's "room for at least two" it was off by a chip. 210 clears the
 * widest ordinary two-chip group measured (208.61) and stays under the 244px that the narrowest
 * desktop leaves beside the strip — the upper bound that matters, because a larger value would push
 * the group below the photos at 900–1024px where two real chips demonstrably fit and DESIGN.md `:260`
 * wants them beside. Guaranteeing two chips *both* at the 160px label cap would need 406, which
 * exceeds that 244px ceiling; it is not reachable and is not what the token asks for.
 *
 * **What this constant actually does, corrected against the browser.** The old note claimed it is the
 * wrap threshold. It is the *floor* of one. Flex line-breaking uses each item's hypothetical main size
 * — its content width, clamped by `min-width` — so above this value the group's own natural width is
 * what decides, and below it this value stands in. Both halves were observed: at 600px (298px beside
 * the strip) a 208.61px group sat beside the strip while a 419.05px group on the same page wrapped,
 * though both carry the same `minWidth`; at 390px (104px beside the strip) even a lone 75.95px chip
 * wrapped below, which only this `minWidth` can cause. Either way flexbox moves the **whole group**,
 * never a chip at a time — the truncation AC4 and DESIGN.md `:262` both reject. Confirmed at 360, 390,
 * 600, 768, 880, 900, 910, 960, 1024, 1280 and 1440: no chip is ever dropped, the group is never
 * reduced to one, and the page never scrolls horizontally. No `ResizeObserver` and no breakpoint.
 */
const DOC_ROW_MIN_WIDTH = 210;

/**
 * How many `doc-chip`s a `tl-card` renders before the `+N` control takes over.
 *
 * Three, which is `MiniImageStrip`'s own cap (`TripDayPlanItemContent.tsx:191`) — one number for both
 * media kinds, so the row does not present two different ideas of "too many" side by side.
 *
 * **It is not a width decision**, and keeping it apart from `DOC_ROW_MIN_WIDTH` is what makes the row
 * testable: this one fixes what renders and therefore what `+N` counts, which a test can assert
 * deterministically at any viewport; that one fixes where the group sits, and is the only half the
 * browser measurement pass touches.
 */
const DOC_CHIP_VISIBLE_CAP = 3;

/**
 * Screen-reader-only text. The units are the entire point.
 *
 * This started as `sx={{ width: 1, height: 1, ... }}`, which reads as "1px" and is not: MUI's system
 * maps a bare `width`/`height` between 0 and 1 to a *percentage*, so `1` compiled to `width: 100%`.
 * The text stayed invisible - `clip` and `overflow: hidden` still hid it - but `clip` does not shrink
 * an element's layout box, so each of these spans went on occupying its container's full width inside
 * the scroll box. Measured at `4978db8`, the coverage-axis description alone gave the day page 25px of
 * horizontal overflow at 390px and 169px at 1440px (DW-44).
 *
 * So: explicit `px` strings, one shared constant, and never a bare number in this recipe again.
 */
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  p: 0,
  m: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * The one offset every control on the day hero reads (Story 6.19, AC3).
 *
 * All three - the previous-day chevron top-left, the next-day chevron top-right and the `⋯`
 * bottom-right - are absolutely positioned against the hero's padding box, so they share a right edge
 * only if they share this number. Before 6.19 the `⋯` lived in a flex header row and inherited the
 * hero's own inline padding instead (16px at xs, 32px at md), which left it 8px off the chevron on a
 * phone and 24px off on a desktop: the misalignment the story was raised for. Writing `8` at one call
 * site and `theme.spacing(1)` at another would reintroduce it the next time the spacing scale moves,
 * so all three read this constant and AC3 holds by construction rather than by inspection.
 */
const HERO_CONTROL_INSET = 8;

/** The app's touch-target floor, spelled out because the title's clearance is derived from it. */
const HERO_CONTROL_SIZE = 44;

/** Visible breathing room between a hero control and the nearest title text. */
const HERO_CONTROL_GAP = 8;

/**
 * 8 + 44 + 8 = 60px - the band a hero control claims at any corner, plus a gap (Story 6.19, AC5).
 *
 * The title block is bottom-anchored (`mt: auto`) and grows upward on a long note - the title is
 * "Day N: {note}" at 28px/900 and notes run to 280 characters - so it needs a real ceiling, not a
 * `zIndex`. Until 6.19 the header row provided one by occupying the top of the hero in normal flow;
 * that row is gone, and the chevrons that replaced it are out of flow and reserve nothing.
 *
 * The ceiling is the hero's own `padding-top`. Padding, not `maxHeight`/`overflow`: the title block
 * holds the title *and* the date line beneath it, and any clip applied to the block would eat the date
 * first, since it is the block's last line. Padding cannot clip anything - a title long enough to fill
 * the hero simply makes the hero taller, which is what it already did before this story. And because
 * `mt: auto` absorbs all the slack while the title is short, raising the top padding from 22px to 60px
 * is invisible on every day whose title does not actually reach the top.
 */
const HERO_CONTROL_BAND = HERO_CONTROL_INSET + HERO_CONTROL_SIZE + HERO_CONTROL_GAP;

/**
 * Responsive below md to match the panel directly beneath the hero, not because a control needs it.
 *
 * The panel reads this too rather than repeating the numbers. The two are one continuous left edge
 * down the page, and the only reason the hero is responsive at all is to keep that edge straight -
 * so a change here that the panel did not follow would break the very thing the value exists for.
 */
const HERO_PADDING_INLINE = { xs: 16, md: 32 } as const;

/**
 * The `⋯` sits at `right: 8` off the hero's *padding box*, so it reaches 8 + 44 = 52px inward from the
 * inner right edge while the title block stops at the hero's inline padding. What the title has to give
 * back is the difference plus a gap: 60 - 16 = 44px at xs, 60 - 32 = 28px at md.
 *
 * Clamped at 0 because this is a subtraction between two constants that are free to move independently.
 * Inline padding wider than the control band is a perfectly reasonable future value - it would mean the
 * title already clears the `⋯` on its own - but the naive difference goes negative there, and a negative
 * `padding-right` is not a small error: the declaration is invalid, the CSS parser drops it silently,
 * and the title loses its clearance entirely at that breakpoint with nothing raised. jsdom does not
 * resolve responsive `sx`, so no test in this suite would catch it either.
 */
const HERO_TITLE_RIGHT_CLEARANCE = {
  xs: `${Math.max(0, HERO_CONTROL_BAND - HERO_PADDING_INLINE.xs)}px`,
  md: `${Math.max(0, HERO_CONTROL_BAND - HERO_PADDING_INLINE.md)}px`,
} as const;

/**
 * A darker fill for the two chevrons alone (Story 6.19, AC6).
 *
 * `HERO_SCRIM`'s four stops are `.88` at the bottom, `.54` at 38%, `.10` at 66% and `.26` at the top,
 * so moving a control changes how much backing it has. Over a 210px hero the chevrons' centre drops
 * from ~0.351 alpha at the vertical midpoint to ~0.193 at `top: 8`.
 *
 * Every figure below is the *rendered* one: photo -> scrim -> the button's own fill -> white glyph.
 * That last step matters and is easy to drop. DW-98's headline 2.41:1 is white against the scrimmed
 * photo with no button on it; the chevron actually paints `rgba(255,255,255,.18)` over that first,
 * which lightens its own backdrop and costs it more contrast than the move does. Over the near-white
 * (`#FAFAF8`) photo DW-98 measured:
 *
 *   chevron, vertical centre, white fill  backdrop rgb(169,168,166) -> disc rgb(185,184,182)  1.98:1
 *   chevron, `top: 8`, white fill         backdrop rgb(206,205,203) -> disc rgb(215,214,212)  1.45:1
 *   chevron, `top: 8`, dark fill          backdrop rgb(206,205,203) -> disc rgb(135,134,131)  3.64:1
 *
 * So the white fill is not merely failing to save the control, it is the larger of the two problems:
 * light-on-light. The chevrons take a dark translucent fill instead, which is the second of the two
 * fixes DW-98 itself names. Replacing the fill rather than layering over it keeps the arithmetic
 * single-valued. 3.64:1 at the glyph's centre, 3.31:1 at the weakest point of the band the button
 * spans - better than the 1.98:1 they read today, and past the 3:1 non-text floor they have never met.
 *
 * Over a *dark* photo the dark fill sinks the disc into the backdrop (disc-vs-backdrop 1.58:1 -> 1.03:1)
 * while the glyph improves (13.05:1 -> 19.91:1). What delineates the control there is not the fill in
 * either version - at 1.58:1 the white one never did - but `ON_PHOTO_CHROME`'s `rgba(255,255,255,.55)`
 * border, which composites to rgb(142,142,141) and reads at 6.26:1 against that backdrop. It and the
 * white focus ring are kept for exactly that reason.
 *
 * The fill is local to the chevrons on purpose. `HERO_SCRIM` is shared with the trip hero and its stops
 * are pinned in DESIGN.md, and the `⋯` needs nothing: at `bottom: 8` it sits at ~0.752 alpha, so even
 * with its white fill it composites to rgb(109,108,105) / 5.26:1 - already clear of the floor. That
 * also keeps the three controls from diverging as much as swapping one fill suggests: after this change
 * the chevrons read rgb(135,134,131) and the `⋯` rgb(109,108,105) over the same light photo, both
 * mid-dark discs with white glyphs, no polarity split between the corners.
 */
const HERO_CHEVRON_BACKING = {
  backgroundColor: "rgba(20,18,14,.38)",
  "&:hover": { backgroundColor: "rgba(20,18,14,.52)" },
} as const;

type TripSummary = {
  id: string;
  name: string;
  accessRole?: "owner" | "viewer" | "contributor";
  startDate: string;
  endDate: string;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  imageUrl?: string | null;
  note?: string | null;
  updatedAt?: string;
  plannedCostSubtotal: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
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
  dayPlanItems: {
    id: string;
    title: string | null;
    fromTime: string | null;
    toTime: string | null;
    contentJson: string;
    costCents: number | null;
    payments?: { amountCents: number; dueDate: string }[];
    linkUrl: string | null;
    location: { lat: number; lng: number; label?: string | null } | null;
  }[];
  travelSegments?: {
    id: string;
    fromItemType: "accommodation" | "dayPlanItem";
    fromItemId: string;
    toItemType: "accommodation" | "dayPlanItem";
    toItemId: string;
    transportType: TransportType;
    durationMinutes: number;
    distanceKm: number | null;
    linkUrl: string | null;
  }[];
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

type BucketListItem = {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  positionText: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

type SegmentItem = {
  id: string;
  type: "accommodation" | "dayPlanItem";
  label: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  endTime?: string | null;
};

type GalleryImage = {
  id: string;
  dayPlanItemId?: string;
  imageUrl: string;
  sortOrder: number;
};

/**
 * One attached document as the two `…/documents` GET routes return it (Story 9.1).
 *
 * Declared here, per component, because that is this codebase's existing convention for a media row
 * type and not because a shared one would be wrong: `GalleryImage` is declared four times over
 * (`TripDayView.tsx` above, `TripAccommodationDialog.tsx:278`, `TripDayPlanDialog.tsx:75`,
 * `TripDayMapFullPage.tsx:63`) and this type will end up the same. **The extraction is a real
 * candidate** — but for a story allowed to touch all four files at once, since a shared type that only
 * three of the four use is worse than four honest copies. Mirroring the convention keeps this story
 * inside its own surface.
 *
 * `accommodationId` and `dayPlanItemId` are both optional for the same reason `GalleryImage`'s owner is:
 * one type covers both routes' rows, and only the day-wide plan-item call needs the owner field to
 * group by.
 */
type GalleryDocument = {
  id: string;
  accommodationId?: string;
  dayPlanItemId?: string;
  documentUrl: string;
  /** The stored `file_name` column, extension and all. `DocChip` strips the extension for display. */
  fileName: string;
  sortOrder: number;
};

type TravelSegment = NonNullable<TripDay["travelSegments"]>[number];

type PlanDialogMode = "add" | "edit";
type DayActivityTransferMode = "move" | "swap";

type PlanDialogPrefill = {
  title: string;
  contentJson: string;
  location: { lat: number; lng: number; label?: string | null } | null;
  bucketListItemId: string;
};

type MapDialogItem =
  | { kind: "planItem"; id: string; label: string; planItem: DayPlanItem }
  | { kind: "previousStay"; id: string; label: string; stay: TripDay["accommodation"] }
  | { kind: "currentStay"; id: string; label: string; stay: TripDay["accommodation"] };

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripDayViewProps = {
  tripId: string;
  dayId: string;
};

const compareTripDaysChronologically = (left: TripDay, right: TripDay) => {
  if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
};

const formatDurationMinutes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

const parseTimeToMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [hoursRaw, minutesRaw] = trimmed.split(":");
  if (hoursRaw === undefined || minutesRaw === undefined) return null;
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes >= 60) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
};

const formatMinutesToTime = (value: number) => {
  const bounded = Math.max(0, Math.min(value, 24 * 60));
  const hours = Math.floor(bounded / 60);
  const minutes = bounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

// The bar spans a real 24h day, not the mockup's 08:00-22:00 sample window: stay segments run 00:00 ->
// check-out and check-in -> 24:00 by construction, and the planned/unplanned caption beside the bar is
// computed against 1440 minutes. Clamping the axis would truncate both stays and desync the two.
const COVERAGE_AXIS_TICKS = [
  { label: "00:00", percent: 0 },
  { label: "06:00", percent: 25 },
  { label: "12:00", percent: 50 },
  { label: "18:00", percent: 75 },
  { label: "24:00", percent: 100 },
];

const buildSegmentKey = (from: SegmentItem, to: SegmentItem) => `${from.type}:${from.id}::${to.type}:${to.id}`;
const buildSegmentKeyFromIds = (
  fromType: "accommodation" | "dayPlanItem",
  fromId: string,
  toType: "accommodation" | "dayPlanItem",
  toId: string,
) => `${fromType}:${fromId}::${toType}:${toId}`;

const parsePolyline = (value: unknown): [number, number][] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point): point is [number, number] => {
      if (!Array.isArray(point) || point.length !== 2) return false;
      return (
        typeof point[0] === "number" &&
        typeof point[1] === "number" &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
      );
    })
    .map((point) => [point[0], point[1]]);
};

export default function TripDayView({ tripId, dayId }: TripDayViewProps) {
  const { language, t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  // Story 7.7 owns exactly one block of this file — the day-details dialog. This is its id prefix.
  const dayMetaIdPrefix = useId();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [day, setDay] = useState<TripDay | null>(null);
  const [planItems, setPlanItems] = useState<DayPlanItem[]>([]);
  const [bucketItems, setBucketItems] = useState<BucketListItem[]>([]);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [travelSegments, setTravelSegments] = useState<TravelSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [previousStayOpen, setPreviousStayOpen] = useState(false);
  const [planDialogMode, setPlanDialogMode] = useState<PlanDialogMode | null>(null);
  const [selectedPlanItem, setSelectedPlanItem] = useState<DayPlanItem | null>(null);
  const [planDialogPrefill, setPlanDialogPrefill] = useState<PlanDialogPrefill | null>(null);
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false);
  const [activeSegment, setActiveSegment] = useState<TravelSegment | null>(null);
  const [activeSegmentFrom, setActiveSegmentFrom] = useState<SegmentItem | null>(null);
  const [activeSegmentTo, setActiveSegmentTo] = useState<SegmentItem | null>(null);
  const [copyingStay, setCopyingStay] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [dayMetaOpen, setDayMetaOpen] = useState(false);
  const [dayImageFile, setDayImageFile] = useState<File | null>(null);
  const [dayNoteDraft, setDayNoteDraft] = useState("");
  const [mapDialogItem, setMapDialogItem] = useState<MapDialogItem | null>(null);
  const [dayImageSaving, setDayImageSaving] = useState(false);
  const [accommodationImages, setAccommodationImages] = useState<GalleryImage[]>([]);
  const [previousAccommodationImages, setPreviousAccommodationImages] = useState<GalleryImage[]>([]);
  const [planItemImagesById, setPlanItemImagesById] = useState<Record<string, GalleryImage[]>>({});
  // Beside their image twins and loaded by the same effect, so a card never paints its photos and its
  // documents from two different moments in time.
  const [accommodationDocuments, setAccommodationDocuments] = useState<GalleryDocument[]>([]);
  const [previousAccommodationDocuments, setPreviousAccommodationDocuments] = useState<GalleryDocument[]>([]);
  const [planItemDocumentsById, setPlanItemDocumentsById] = useState<Record<string, GalleryDocument[]>>({});
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [routingUnavailable, setRoutingUnavailable] = useState(false);
  // The whole collection plus a starting index, not a single URL: that is what lets the shared
  // viewer page to the images the three-thumbnail strip does not render (DW-30).
  const [fullscreenPhotos, setFullscreenPhotos] = useState<{ images: FullscreenPhoto[]; index: number } | null>(
    null,
  );
  // The documents' answer to `fullscreenPhotos`, and deliberately shaped the same way: one anchor plus
  // **the whole collection**, one mount for all three cards. The collection rather than the hidden
  // tail because that is what the strip's own `+N` does — it opens the full set at the first unshown
  // index — and DESIGN.md `:264` asks the two overflows to read as one kind of thing.
  //
  // It is a `Menu` and not `FullscreenPhotoViewer` (AC6, and the viewer's own docblock: it belongs to
  // the trip's photographs). A ticket is not a photograph, there is nothing to page through, and the
  // name is what the user is choosing between — so the overflow surface is a list of names.
  // `ownerKey` is which entry's `+N` opened it, so that control - and only that one - can report
  // itself expanded. See `renderMediaRow`.
  const [documentMenu, setDocumentMenu] = useState<{
    anchorEl: HTMLElement;
    documents: GalleryDocument[];
    ownerKey: string | null;
  } | null>(null);
  // Story 6.23 AC4. A success line, not an error: a move deletes travel segments the user typed, so
  // it may not succeed in silence. It outlives the dialog on purpose — the dialog closes, and the
  // sentence has to land somewhere the user is actually looking.
  const [planMoveNotice, setPlanMoveNotice] = useState<string | null>(null);
  const [transferMode, setTransferMode] = useState<DayActivityTransferMode | null>(null);
  const [transferTargetDayId, setTransferTargetDayId] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [dayMenuAnchor, setDayMenuAnchor] = useState<null | HTMLElement>(null);
  // Reset-on-prop-change during render rather than in an effect, which is React's own prescription
  // and keeps this out of the cascading-render lint. The menu's backdrop swallows clicks but not
  // browser back/forward, so navigating to a sibling day can leave the anchor pointing at the
  // trigger the loading skeleton just unmounted - a detached node, which Popover then measures as
  // the viewport's top-left corner.
  const [dayMenuDayId, setDayMenuDayId] = useState(dayId);
  if (dayMenuDayId !== dayId) {
    setDayMenuDayId(dayId);
    setDayMenuAnchor(null);
    // Story 6.23. Same trigger, same prescription: the move notice is about a move made *from this
    // day*, so navigating to a sibling has to drop it or it reads as something that just happened
    // here. It cannot key off `day?.id`, which the reload after a move leaves unchanged.
    setPlanMoveNotice(null);
  }
  const planItemsRef = useRef<DayPlanItem[]>([]);
  const handledDeepLinkRef = useRef<string | null>(null);
  const scrollRestoreKey = useMemo(() => `trip-day-scroll:${tripId}:${dayId}`, [dayId, tripId]);
  const defaultCheckInTime = "16:00";
  const defaultCheckOutTime = "10:00";
  const isOwner = detail?.trip.accessRole ? detail.trip.accessRole === "owner" : true;
  const canEditPlanning = detail?.trip.accessRole ? detail.trip.accessRole !== "viewer" : true;

  // Story 6.15: the hero overflow used to hold one ungated item (print), so the trigger could be
  // unconditional by inheritance. It now holds three gating levels at once, so "does anything
  // render inside it?" has to be stated. Each field mirrors the gate on the item it names - change
  // an item's condition and change it here. Print is deliberately `true`: every role that can open
  // this day can print it, which is also why the trigger must never be wrapped in `isOwner` (AC5,
  // and 6.11 AC6 - that would take print away from viewers and contributors).
  //
  // Story 6.19: back-to-trip is *not* a field here, because it has no gate to mirror. It is the way
  // off this screen and it renders for every role, which is also what retires the `hasDayMenuItems`
  // guard this record used to feed: the menu can no longer be empty, so the trigger is unconditional
  // (6.19 AC8, and its trap 4 - gating the trigger now would strand a viewer on the day screen).
  const dayMenuItemsVisible: Record<"dayImage" | "transfers" | "print", boolean> = {
    dayImage: isOwner,
    transfers: canEditPlanning,
    print: true,
  };
  // The divider only earns its place when there is a planning group above it to separate.
  const showDayMenuDivider = (dayMenuItemsVisible.dayImage || dayMenuItemsVisible.transfers) && dayMenuItemsVisible.print;
  // MUI drops MenuItem to 36px at sm and up. The three controls that moved into this menu were all
  // 44px buttons and the codebase enforces that floor deliberately, so it has to be restated here -
  // relocating a control is not a licence to shrink its hit area on a tablet.
  const DAY_MENU_ITEM_SX = { minHeight: 44 } as const;

  useEffect(() => {
    planItemsRef.current = planItems;
  }, [planItems]);

  useEffect(() => {
    if (loading || !day) return;
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(scrollRestoreKey);
      if (!stored) return;
      sessionStorage.removeItem(scrollRestoreKey);
      const value = Number(stored);
      if (!Number.isFinite(value)) return;
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: value, behavior: "auto" });
      });
    } catch {
      // Ignore storage failures.
    }
  }, [day, loading, scrollRestoreKey]);

  const formatDate = useMemo(
    () => (value: string) =>
      new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value)),
    [language],
  );

  // style: "currency" places the symbol per locale - German needs "1.234,50 €", not "€1.234,50".
  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
  );

  const resolveApiError = useCallback(
    (code?: string, fallback?: string) => {
      const defaultMessage = fallback ?? t("trips.dayView.loadError");
      switch (code) {
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "server_error":
          return t("errors.server");
        case "invalid_json":
          return t("errors.invalidJson");
        case "network_error":
          return t("errors.network");
        default:
          return defaultMessage;
      }
    },
    [t],
  );

  const buildBucketListContentJson = useCallback((item: BucketListItem) => {
    const description = item.description?.trim() ?? "";
    const positionText = item.positionText?.trim() ?? "";
    const includePositionText = !item.location && positionText.length > 0;
    const parts = [description, includePositionText ? positionText : ""].filter((value) => value.length > 0);
    const content = parts.length > 0 ? parts : [item.title.trim()];
    return JSON.stringify({
      type: "doc",
      content: content.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    });
  }, []);

  const buildBucketListPrefill = useCallback(
    (item: BucketListItem): PlanDialogPrefill => {
      const location = item.location
        ? {
            lat: item.location.lat,
            lng: item.location.lng,
            label: item.positionText?.trim() || item.location.label || null,
          }
        : null;
      return {
        title: item.title,
        contentJson: buildBucketListContentJson(item),
        location,
        bucketListItemId: item.id,
      };
    },
    [buildBucketListContentJson],
  );

  const loadDay = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const detailResponse = await fetch(`/api/trips/${tripId}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const detailBody = (await detailResponse.json()) as ApiEnvelope<TripDetail>;

      if (detailResponse.status === 404 || detailBody.error?.code === "not_found") {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        setBucketItems([]);
        setTravelSegments([]);
        return;
      }

      if (!detailResponse.ok || detailBody.error || !detailBody.data) {
        setError(resolveApiError(detailBody.error?.code));
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        setBucketItems([]);
        setTravelSegments([]);
        return;
      }

      const resolvedDay = detailBody.data.days.find((item) => item.id === dayId) ?? null;
      if (!resolvedDay) {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        setBucketItems([]);
        setTravelSegments([]);
        return;
      }

      setDetail(detailBody.data);
      setDay(resolvedDay);
      setPlanItems(
        (resolvedDay.dayPlanItems ?? []).map((item) => ({
          id: item.id,
          tripDayId: resolvedDay.id,
          title: item.title,
          fromTime: item.fromTime ?? null,
          toTime: item.toTime ?? null,
          contentJson: item.contentJson,
          costCents: typeof item.costCents === "number" ? item.costCents : null,
          linkUrl: item.linkUrl,
          location: item.location,
          createdAt: "",
        })),
      );
      setTravelSegments(Array.isArray(resolvedDay.travelSegments) ? resolvedDay.travelSegments : []);
    } catch {
      setError(t("trips.dayView.loadError"));
      setDetail(null);
      setDay(null);
      setPlanItems([]);
      setBucketItems([]);
      setTravelSegments([]);
    } finally {
      setLoading(false);
    }
  }, [dayId, resolveApiError, t, tripId]);

  const loadBucketListItems = useCallback(async () => {
    setBucketLoading(true);
    setBucketError(null);
    try {
      if (!isOwner) {
        setBucketItems([]);
        setBucketError(null);
        setBucketLoading(false);
        return;
      }

      const response = await fetch(`/api/trips/${tripId}/bucket-list-items`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ items: BucketListItem[] }>;

      if (!response.ok || body.error) {
        setBucketError(resolveApiError(body.error?.code, t("trips.bucketList.loadError")));
        setBucketItems([]);
        return;
      }

      setBucketItems(body.data?.items ?? []);
    } catch {
      setBucketError(t("trips.bucketList.loadError"));
      setBucketItems([]);
    } finally {
      setBucketLoading(false);
    }
  }, [isOwner, resolveApiError, t, tripId]);

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

  const segmentsByKey = useMemo(() => {
    const map = new Map<string, TravelSegment>();
    for (const segment of travelSegments) {
      map.set(
        buildSegmentKeyFromIds(segment.fromItemType, segment.fromItemId, segment.toItemType, segment.toItemId),
        segment,
      );
    }
    return map;
  }, [travelSegments]);

  const handleOpenTravelSegment = (from: SegmentItem, to: SegmentItem) => {
    if (!canEditPlanning) return;
    setActiveSegmentFrom(from);
    setActiveSegmentTo(to);
    setActiveSegment(segmentsByKey.get(buildSegmentKey(from, to)) ?? null);
    setSegmentDialogOpen(true);
  };

  const handleTravelSegmentSaved = (segment: TravelSegment) => {
    setTravelSegments((current) => {
      const index = current.findIndex((item) => item.id === segment.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = segment;
        return next;
      }
      return [...current, segment];
    });
    setDay((current) =>
      current
        ? { ...current, travelSegments: [...(current.travelSegments ?? []).filter((item) => item.id !== segment.id), segment] }
        : current,
    );
    setDetail((current) => {
      if (!current || !day) return current;
      return {
        ...current,
        days: current.days.map((entry) =>
          entry.id === day.id
            ? { ...entry, travelSegments: [...(entry.travelSegments ?? []).filter((item) => item.id !== segment.id), segment] }
            : entry,
        ),
      };
    });
    setSegmentDialogOpen(false);
  };

  const handleOpenAddPlan = () => {
    if (!canEditPlanning) return;
    setPlanDialogPrefill(null);
    setSelectedPlanItem(null);
    setPlanDialogMode("add");
  };

  const handleOpenEditPlan = (item: DayPlanItem) => {
    if (!canEditPlanning) return;
    setPlanDialogPrefill(null);
    setSelectedPlanItem(item);
    setPlanDialogMode("edit");
  };

  const handleAddBucketToDay = (item: BucketListItem) => {
    if (!canEditPlanning) return;
    setPlanDialogPrefill(buildBucketListPrefill(item));
    setSelectedPlanItem(null);
    setPlanDialogMode("add");
  };

  const handleDeletePlan = useCallback(
    async (itemId: string) => {
      if (!day) return false;

      const confirmed = window.confirm(t("trips.plan.deleteConfirm"));
      if (!confirmed) return false;

      const snapshot = planItemsRef.current;
      const removedIndex = snapshot.findIndex((item) => item.id === itemId);
      const removedItem = removedIndex >= 0 ? snapshot[removedIndex] : null;
      setPlanItems((current) => current.filter((item) => item.id !== itemId));
      setError(null);
      setPlanMoveNotice(null);

      try {
        const token = await ensureCsrfToken();
        const response = await fetch(`/api/trips/${tripId}/day-plan-items`, {
          method: "DELETE",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify({ tripDayId: day.id, itemId }),
        });

        const body = (await response.json()) as ApiEnvelope<{
          deleted: boolean;
          removedTravelSegmentIds?: string[];
        }>;
        if (!response.ok || body.error) {
          if (removedItem) {
            setPlanItems((current) => {
              if (current.some((item) => item.id === removedItem.id)) return current;
              const insertAt = Math.min(Math.max(removedIndex, 0), current.length);
              return [...current.slice(0, insertAt), removedItem, ...current.slice(insertAt)];
            });
          }
          setError(resolveApiError(body.error?.code));
          return false;
        }
        // Story 6.23 AC6, client half. The delete is optimistic and nothing reloads the day
        // afterwards, so the segments the server just removed have to leave `travelSegments` here or
        // "Fahrzeit" keeps summing minutes for an activity that is gone.
        const removedSegmentIds = body.data?.removedTravelSegmentIds ?? [];
        if (removedSegmentIds.length > 0) {
          const removed = new Set(removedSegmentIds);
          setTravelSegments((current) => current.filter((segment) => !removed.has(segment.id)));
        }
        return true;
      } catch {
        if (removedItem) {
          setPlanItems((current) => {
            if (current.some((item) => item.id === removedItem.id)) return current;
            const insertAt = Math.min(Math.max(removedIndex, 0), current.length);
            return [...current.slice(0, insertAt), removedItem, ...current.slice(insertAt)];
          });
        }
        setError(resolveApiError("network_error"));
        return false;
      }
    },
    [day, ensureCsrfToken, resolveApiError, t, tripId],
  );

  const handlePlanDialogClose = () => {
    setPlanDialogMode(null);
    setSelectedPlanItem(null);
    setPlanDialogPrefill(null);
  };

  const handlePlanDialogSaved = () => {
    const shouldReloadBucket = Boolean(planDialogPrefill?.bucketListItemId);
    setPlanDialogMode(null);
    setSelectedPlanItem(null);
    setPlanDialogPrefill(null);
    // Story 6.23. The move notice describes a move, not a save; leaving it up over later work would
    // have it reporting something that is no longer what just happened.
    setPlanMoveNotice(null);
    loadDay();
    if (shouldReloadBucket) {
      loadBucketListItems();
    }
  };

  const handleOpenTransferDialog = (mode: DayActivityTransferMode) => {
    if (!canEditPlanning) return;
    setTransferMode(mode);
    setTransferTargetDayId("");
  };

  const handleCloseTransferDialog = useCallback(() => {
    if (transferSubmitting) return;
    setTransferMode(null);
    setTransferTargetDayId("");
  }, [transferSubmitting]);

  /**
   * Story 6.25 AC7. This dialog's whole input is one select, and it opens empty (`setTransferTargetDayId("")`
   * above), so "dirty" is simply "a day has been picked". EXPERIENCE.md's rule has no triviality
   * threshold — a chosen target is something to lose — and applying it uniformly is what makes the
   * `✕` mean the same thing on every dialog rather than on most of them.
   */
  const transferGuard = useDiscardGuard(transferTargetDayId !== "", handleCloseTransferDialog, transferSubmitting);

  const orderedDays = useMemo(() => {
    if (!detail) return [];
    return [...detail.days].sort(compareTripDaysChronologically);
  }, [detail]);

  const transferTargetOptions = useMemo(() => {
    if (!day) return [];
    return orderedDays.filter((candidate) => candidate.id !== day.id);
  }, [day, orderedDays]);

  const selectedTransferTargetDay = useMemo(
    () => transferTargetOptions.find((candidate) => candidate.id === transferTargetDayId) ?? null,
    [transferTargetDayId, transferTargetOptions],
  );

  const transferNeedsOverwriteWarning =
    transferMode === "move" && Boolean(selectedTransferTargetDay && selectedTransferTargetDay.dayPlanItems.length > 0);

  /**
   * Story 6.23. The candidates for the activity dialog's "Auf anderen Tag verschieben" picker.
   *
   * Derived from `transferTargetOptions`, which is the day-level transfer's own list and already
   * excludes the current day — so the two pickers cannot come to disagree about which days exist.
   * The label is built here rather than in the dialog because this component owns `formatDate` and
   * the "Day {index} · date" format the day-level picker renders.
   */
  const buildDayLabel = useCallback(
    (candidate: { dayIndex: number; date: string }) =>
      `${formatMessage(t("trips.dayView.title"), { index: candidate.dayIndex })} · ${formatDate(candidate.date)}`,
    [formatDate, t],
  );

  const planMoveTargetDays = useMemo(
    () =>
      transferTargetOptions.map((candidate) => ({
        id: candidate.id,
        label: buildDayLabel(candidate),
      })),
    [buildDayLabel, transferTargetOptions],
  );

  /**
   * Every day of the trip, not just the move candidates — the success line names the day the activity
   * landed on, and looking it up in the filtered list means an empty name ("Activity moved to .") the
   * moment the two disagree, which a background reload between opening the picker and confirming is
   * enough to cause.
   */
  const dayLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of orderedDays) {
      map.set(candidate.id, buildDayLabel(candidate));
    }
    return map;
  }, [buildDayLabel, orderedDays]);

  const handleSubmitTransfer = useCallback(async () => {
    if (!day || !transferMode) return;
    if (!transferTargetDayId || transferTargetDayId === day.id) {
      setError(t("trips.dayTransfer.sameDayError"));
      return;
    }

    setTransferSubmitting(true);
    setError(null);
    setPlanMoveNotice(null);

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/day-activity-transfer`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          operation: transferMode,
          sourceTripDayId: day.id,
          targetTripDayId: transferTargetDayId,
          confirmOverwrite: transferNeedsOverwriteWarning,
        }),
      });

      const body = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || body.error) {
        setError(
          resolveApiError(
            body.error?.code,
            transferMode === "move" ? t("trips.dayTransfer.moveError") : t("trips.dayTransfer.swapError"),
          ),
        );
        return;
      }

      setTransferMode(null);
      setTransferTargetDayId("");
      await loadDay();
    } catch {
      setError(
        resolveApiError("network_error", transferMode === "move" ? t("trips.dayTransfer.moveError") : t("trips.dayTransfer.swapError")),
      );
    } finally {
      setTransferSubmitting(false);
    }
  }, [
    day,
    ensureCsrfToken,
    loadDay,
    resolveApiError,
    t,
    transferMode,
    transferNeedsOverwriteWarning,
    transferTargetDayId,
    tripId,
  ]);

  /**
   * Story 6.23 AC4. Moves one activity to another day and reports what the move removed.
   *
   * Deliberately *not* the `day-activity-transfer` endpoint: that one is whole-day and its "move"
   * deletes the target day's activities. This one appends.
   *
   * It returns the failure message rather than `false` and rendering it here: on failure the dialog
   * stays open, and a page-level alert behind an open modal is a message the user cannot read. So the
   * specific reason ("your session has expired") goes back to the dialog, and this component only
   * owns the success line — which has to outlive the dialog, because a successful move closes it.
   *
   * There is no optimistic removal here, unlike delete: the reload is what proves the activity
   * really landed on the other day, and AC3 (everything travelled with it) is not something the
   * client can assert on its own.
   */
  const handleMovePlanItem = useCallback(
    async (itemId: string, targetTripDayId: string): Promise<PlanItemMoveOutcome> => {
      if (!day) return { moved: false, message: t("trips.plan.moveError") };
      if (!canEditPlanning) return { moved: false, message: t("trips.plan.moveError") };

      setPlanMoveNotice(null);

      try {
        const token = await ensureCsrfToken();
        const response = await fetch(`/api/trips/${tripId}/day-plan-items/move`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify({ tripDayId: day.id, itemId, targetTripDayId }),
        });

        const body = (await response.json()) as ApiEnvelope<{ removedTravelSegmentIds?: string[] }>;
        if (!response.ok || body.error) {
          return { moved: false, message: resolveApiError(body.error?.code, t("trips.plan.moveError")) };
        }

        const removedCount = body.data?.removedTravelSegmentIds?.length ?? 0;
        const targetLabel = dayLabelById.get(targetTripDayId) ?? t("trips.plan.moveFallbackDay");
        // The notice is set *after* the reload, so a reload that fails shows its own error instead of
        // a green success line floating above a blank day.
        await loadDay();
        setPlanMoveNotice(
          removedCount > 1
            ? formatMessage(t("trips.plan.moveSuccessWithSegments"), { day: targetLabel, count: removedCount })
            : removedCount === 1
              ? formatMessage(t("trips.plan.moveSuccessWithSegment"), { day: targetLabel })
              : formatMessage(t("trips.plan.moveSuccess"), { day: targetLabel }),
        );
        return { moved: true };
      } catch {
        return { moved: false, message: resolveApiError("network_error", t("trips.plan.moveError")) };
      }
    },
    [canEditPlanning, day, dayLabelById, ensureCsrfToken, loadDay, resolveApiError, t, tripId],
  );

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  useEffect(() => {
    loadBucketListItems();
  }, [loadBucketListItems]);

  useEffect(() => {
    setDayImageFile(null);
    setDayNoteDraft(day?.note ?? "");
  }, [day?.id, day?.note]);

  /**
   * Story 6.25 AC7, for the day-image dialog. Its two inputs are the staged file and the note draft;
   * the note's baseline is the day's saved note, which is exactly what the effect above seeds it to,
   * so reopening an unedited dialog is silent. A photo already on the day is not part of this — it is
   * on the server, with nothing pending behind it.
   */
  const handleCloseDayMeta = useCallback(() => {
    setDayMetaOpen(false);
    // Closing ends the draft, whether the user answered "verwerfen" or the dialog was already clean.
    // The seed effect above keys on `[day?.id, day?.note]` and neither changes when the dialog merely
    // closes, so without this the discarded text survives into the next open — and `handleSaveDayImage`
    // and `handleRemoveDayImage` both post `dayNoteDraft`, which would write a discarded note to the
    // server. The two save paths close via `setDayMetaOpen(false)` directly and re-seed from the
    // response, so they do not go through here and are unaffected.
    setDayImageFile(null);
    setDayNoteDraft(day?.note ?? "");
  }, [day?.note]);
  const dayMetaGuard = useDiscardGuard(
    dayImageFile !== null || dayNoteDraft !== (day?.note ?? ""),
    handleCloseDayMeta,
  );

  useEffect(() => {
    if (loading || !day) return;

    const openTarget = searchParams.get("open");
    const itemId = searchParams.get("itemId");
    if (!openTarget) return;

    const key = `${day.id}:${openTarget}:${itemId ?? ""}`;
    if (handledDeepLinkRef.current === key) return;

      if (openTarget === "stay") {
      if (!canEditPlanning) return;
        setStayOpen(true);
      handledDeepLinkRef.current = key;
      return;
    }

    if (openTarget === "plan") {
      if (!canEditPlanning) return;
      if (itemId) {
        const item = planItems.find((entry) => entry.id === itemId) ?? null;
        if (item) {
          setSelectedPlanItem(item);
          setPlanDialogMode("edit");
          handledDeepLinkRef.current = key;
          return;
        }
      }

      setSelectedPlanItem(null);
      setPlanDialogMode("add");
      handledDeepLinkRef.current = key;
    }
  }, [canEditPlanning, day, loading, planItems, searchParams]);

  const previousDay = useMemo(() => {
    if (!day) return null;
    const currentIndex = orderedDays.findIndex((candidate) => candidate.id === day.id);
    if (currentIndex <= 0) return null;
    return orderedDays[currentIndex - 1] ?? null;
  }, [day, orderedDays]);

  const nextDay = useMemo(() => {
    if (!day) return null;
    const currentIndex = orderedDays.findIndex((candidate) => candidate.id === day.id);
    if (currentIndex < 0 || currentIndex >= orderedDays.length - 1) return null;
    return orderedDays[currentIndex + 1] ?? null;
  }, [day, orderedDays]);

  // Story 9.1 keeps documents in this effect rather than giving them one of their own. A card's photo
  // strip and its `doc-chip`s are one media row, and two effects racing on the same `day` would let the
  // row paint half from before a navigation and half from after. Six requests, one `try`, one `catch`
  // that empties everything: the card's two halves are always the same read of the same day.
  useEffect(() => {
    const loadImages = async () => {
      if (!day) {
        setAccommodationImages([]);
        setPreviousAccommodationImages([]);
        setPlanItemImagesById({});
        setAccommodationDocuments([]);
        setPreviousAccommodationDocuments([]);
        setPlanItemDocumentsById({});
        return;
      }

      try {
        if (previousDay?.accommodation) {
          const previousAccommodationResponse = await fetch(
            `/api/trips/${tripId}/accommodations/images?tripDayId=${previousDay.id}&accommodationId=${previousDay.accommodation.id}`,
            {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            },
          );
          const previousAccommodationBody = (await previousAccommodationResponse.json()) as ApiEnvelope<{
            images: GalleryImage[];
          }>;
          const previousImages =
            previousAccommodationResponse.ok &&
            !previousAccommodationBody.error &&
            Array.isArray(previousAccommodationBody.data?.images)
              ? previousAccommodationBody.data.images
              : [];
          setPreviousAccommodationImages(previousImages);

          const previousDocumentsResponse = await fetch(
            `/api/trips/${tripId}/accommodations/documents?tripDayId=${previousDay.id}&accommodationId=${previousDay.accommodation.id}`,
            {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            },
          );
          const previousDocumentsBody = (await previousDocumentsResponse.json()) as ApiEnvelope<{
            documents: GalleryDocument[];
          }>;
          // The same tolerant guard the image reads use, and for the same reason: a 404 from a stay
          // that has just been deleted, or an envelope whose `data` is a different shape entirely,
          // has to leave the card with no chips rather than throw inside a render path.
          setPreviousAccommodationDocuments(
            previousDocumentsResponse.ok &&
              !previousDocumentsBody.error &&
              Array.isArray(previousDocumentsBody.data?.documents)
              ? previousDocumentsBody.data.documents
              : [],
          );
        } else {
          setPreviousAccommodationImages([]);
          setPreviousAccommodationDocuments([]);
        }

        if (day.accommodation) {
          const accommodationResponse = await fetch(
            `/api/trips/${tripId}/accommodations/images?tripDayId=${day.id}&accommodationId=${day.accommodation.id}`,
            {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            },
          );
          const accommodationBody = (await accommodationResponse.json()) as ApiEnvelope<{ images: GalleryImage[] }>;
          const currentImages =
            accommodationResponse.ok && !accommodationBody.error && Array.isArray(accommodationBody.data?.images)
              ? accommodationBody.data.images
              : [];
          setAccommodationImages(currentImages);

          const accommodationDocumentsResponse = await fetch(
            `/api/trips/${tripId}/accommodations/documents?tripDayId=${day.id}&accommodationId=${day.accommodation.id}`,
            {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            },
          );
          const accommodationDocumentsBody = (await accommodationDocumentsResponse.json()) as ApiEnvelope<{
            documents: GalleryDocument[];
          }>;
          setAccommodationDocuments(
            accommodationDocumentsResponse.ok &&
              !accommodationDocumentsBody.error &&
              Array.isArray(accommodationDocumentsBody.data?.documents)
              ? accommodationDocumentsBody.data.documents
              : [],
          );
        } else {
          setAccommodationImages([]);
          setAccommodationDocuments([]);
        }

        const nextPlanItemImages: Record<string, GalleryImage[]> = {};
        const planItemImagesResponse = await fetch(`/api/trips/${tripId}/day-plan-items/images?tripDayId=${day.id}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const planItemImagesBody = (await planItemImagesResponse.json()) as ApiEnvelope<{ images: GalleryImage[] }>;
        if (planItemImagesResponse.ok && !planItemImagesBody.error && Array.isArray(planItemImagesBody.data?.images)) {
          for (const image of planItemImagesBody.data.images) {
            const itemId = image.dayPlanItemId;
            if (!itemId) continue;
            if (!nextPlanItemImages[itemId]) {
              nextPlanItemImages[itemId] = [];
            }
            nextPlanItemImages[itemId].push(image);
          }
        }
        for (const item of planItems) {
          if (!nextPlanItemImages[item.id]) {
            nextPlanItemImages[item.id] = [];
          }
        }
        setPlanItemImagesById(nextPlanItemImages);

        // One day-wide call for every activity's documents, the twin of the image call above. Per
        // activity it would be one request per card on a busy day; the route's `dayPlanItemId` is
        // optional for exactly this reason.
        const nextPlanItemDocuments: Record<string, GalleryDocument[]> = {};
        const planItemDocumentsResponse = await fetch(
          `/api/trips/${tripId}/day-plan-items/documents?tripDayId=${day.id}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );
        const planItemDocumentsBody = (await planItemDocumentsResponse.json()) as ApiEnvelope<{
          documents: GalleryDocument[];
        }>;
        if (
          planItemDocumentsResponse.ok &&
          !planItemDocumentsBody.error &&
          Array.isArray(planItemDocumentsBody.data?.documents)
        ) {
          // `documentRow`, not `document`: the global of that name is what every DOM call in this file
          // reaches for, and shadowing it inside a loop is a trap for whoever edits this next.
          for (const documentRow of planItemDocumentsBody.data.documents) {
            const itemId = documentRow.dayPlanItemId;
            if (!itemId) continue;
            if (!nextPlanItemDocuments[itemId]) {
              nextPlanItemDocuments[itemId] = [];
            }
            nextPlanItemDocuments[itemId].push(documentRow);
          }
        }
        // Every activity gets an entry even with nothing attached, so a card reads an empty array
        // rather than `undefined` and the media row's "render anything at all?" test is one shape.
        for (const item of planItems) {
          if (!nextPlanItemDocuments[item.id]) {
            nextPlanItemDocuments[item.id] = [];
          }
        }
        setPlanItemDocumentsById(nextPlanItemDocuments);
      } catch {
        setAccommodationImages([]);
        setPreviousAccommodationImages([]);
        setPlanItemImagesById({});
        setAccommodationDocuments([]);
        setPreviousAccommodationDocuments([]);
        setPlanItemDocumentsById({});
      }
    };

    void loadImages();
  }, [day, planItems, previousDay, tripId]);

  const resolveStayTime = (value: string | null | undefined, fallback: string) =>
    value && value.trim() ? value : fallback;
  const previousStay = previousDay?.accommodation ?? null;
  const currentStay = day?.accommodation ?? null;
  const canCopyPreviousStay = Boolean(previousStay && !currentStay);
  const handleCopyPreviousStay = useCallback(async () => {
    if (!day || !previousStay) return;

    setCopyingStay(true);
    setError(null);
    const dayIdForCopy = day.id;

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/accommodations/copy`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ tripDayId: dayIdForCopy }),
      });

      const body = (await response.json()) as ApiEnvelope<{ accommodation: TripDay["accommodation"] }>;
      if (!response.ok || body.error || !body.data?.accommodation) {
        setError(body.error?.message ? `${t("trips.stay.error")} (${body.error.message})` : t("trips.stay.error"));
        return;
      }

      const nextAccommodation = body.data.accommodation;
      setDay((current) => (current ? { ...current, accommodation: nextAccommodation } : current));
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          days: current.days.map((entry) =>
            entry.id === dayIdForCopy ? { ...entry, accommodation: nextAccommodation } : entry,
          ),
        };
      });
    } catch {
      setError(t("trips.stay.error"));
    } finally {
      setCopyingStay(false);
    }
  }, [day, ensureCsrfToken, previousStay, t, tripId]);
  const previousStaySegment = previousStay
    ? {
        id: previousStay.id,
        type: "accommodation" as const,
        label: previousStay.name,
        location: previousStay.location ?? null,
        endTime: resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime),
      }
    : null;
  const currentStaySegment = currentStay
    ? {
        id: currentStay.id,
        type: "accommodation" as const,
        label: currentStay.name,
        location: currentStay.location ?? null,
      }
    : null;
  const staySegments = useMemo(
    () =>
      buildStaySegments({
        previousStay: previousStay
          ? { checkOutTime: resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime) }
          : null,
        currentStay: currentStay ? { checkInTime: resolveStayTime(currentStay.checkInTime, defaultCheckInTime) } : null,
      }),
    [currentStay, defaultCheckInTime, defaultCheckOutTime, previousStay],
  );
  const planItemSegments = useMemo(
    () =>
      buildPlanItemSegments(
        planItems.map((item) => ({
          id: item.id,
          fromTime: item.fromTime,
          toTime: item.toTime,
        })),
      ),
    [planItems],
  );
  const travelSegmentsForGantt = useMemo(() => {
    if (!travelSegments.length) return [];
    const accommodationEndTimes: Record<string, string | null | undefined> = {};
    if (previousStay) {
      accommodationEndTimes[previousStay.id] = resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime);
    }
    const planItemEndTimes: Record<string, string | null | undefined> = {};
    for (const item of planItems) {
      planItemEndTimes[item.id] = item.toTime;
    }
    return buildTravelSegments({
      travelSegments: travelSegments.map((segment) => ({
        id: segment.id,
        fromItemType: segment.fromItemType,
        fromItemId: segment.fromItemId,
        durationMinutes: segment.durationMinutes,
      })),
      accommodationEndTimes,
      planItemEndTimes,
    });
  }, [planItems, previousStay, travelSegments]);
  const ganttSegments = useMemo(
    () => [...staySegments, ...planItemSegments, ...travelSegmentsForGantt],
    [planItemSegments, staySegments, travelSegmentsForGantt],
  );
  const ganttCoverage = useMemo(() => deriveCoverageSummary(ganttSegments), [ganttSegments]);
  const formatDurationSummary = useCallback(
    (minutes: number) => {
      const safeMinutes = Math.max(0, Math.round(minutes));
      const hours = Math.floor(safeMinutes / 60);
      const remainingMinutes = safeMinutes % 60;
      if (hours > 0 && remainingMinutes > 0) {
        return formatMessage(t("trips.dayView.ganttHoursMinutes"), { hours, minutes: remainingMinutes });
      }
      if (hours > 0) {
        return formatMessage(t("trips.dayView.ganttHours"), { hours });
      }
      return formatMessage(t("trips.dayView.ganttMinutes"), { minutes: remainingMinutes });
    },
    [t],
  );
  // A stay on record with no check-in time is deliberately never hatched. This screen defaults such a
  // stay to 16:00 so the bar still draws a segment, but Trip Overview - which passes the raw nulls -
  // shows no accommodation segment at all for it. Branching on the raw field (not on whether segments
  // came out empty) keeps the two bars telling the same story about the same day.
  //
  // Only checkInTime is tested: on this day the current stay's checkOutTime feeds the *next* day's
  // previous-night segment, so it has no bearing on whether this bar was drawn from an assumption.
  // Requiring both to be null (the story's original wording) let a stay with a check-out but no
  // check-in draw an assumed 16:00 block *and* hatch the morning - the exact mixture this guards.
  const coverageIsAssumed = Boolean(currentStay && !currentStay.checkInTime);
  // When the bar declines to draw the open time, the caption must not assert a figure for it. Reporting
  // "Unplanned 16h" beside a bar with no hatch had three elements describing the same day three ways;
  // reporting 0 would be worse still, claiming a coverage the bar plainly does not show. The honest
  // answer is that the open time is unknown until a check-in exists.
  const plannedSummary = formatDurationSummary(ganttCoverage.plannedMinutes);
  const ganttSummary = coverageIsAssumed
    ? formatMessage(t("trips.dayView.ganttSummaryAssumed"), { planned: plannedSummary })
    : formatMessage(t("trips.dayView.ganttSummary"), {
        planned: plannedSummary,
        unplanned: formatDurationSummary(ganttCoverage.unplannedMinutes),
      });
  // Gated on the same flag: a bar with nothing hatched because the times are unknown has not earned a
  // "fully planned" badge either.
  const isFullyPlanned = !coverageIsAssumed && ganttCoverage.unplannedMinutes <= 0;
  const coverageSegments = useMemo<TripDayGanttSegment[]>(() => {
    const gaps = ganttCoverage.gaps;
    if (coverageIsAssumed || gaps.length === 0) return ganttSegments;
    // EXPERIENCE.md: a day with no accommodation shows a single oversized gap rather than many small
    // ones - the bar has to say "this day is structurally incomplete", not "some minutes are free".
    const gapSegments: TripDayGanttSegment[] = day?.missingAccommodation
      ? [{ startMinute: gaps[0].startMinute, endMinute: gaps[gaps.length - 1].endMinute, kind: "gap" }]
      : gaps.map((gap) => ({ startMinute: gap.startMinute, endMinute: gap.endMinute, kind: "gap" as const }));
    return [...ganttSegments, ...gapSegments];
  }, [coverageIsAssumed, day?.missingAccommodation, ganttCoverage.gaps, ganttSegments]);
  const totalTravelMinutes = useMemo(
    () =>
      travelSegments.reduce(
        (sum, segment) => sum + (Number.isFinite(segment.durationMinutes) ? Math.max(0, segment.durationMinutes) : 0),
        0,
      ),
    [travelSegments],
  );
  const dayHasTimelineContent = Boolean(previousStay || currentStay || planItems.length > 0);
  // The range strings stay byte-identical when the underlying times are real. When they are not, the
  // pill says so rather than presenting resolveStayTime's 16:00/10:00 fallback as a recorded fact -
  // the stat strip already refuses to, and the two must not contradict each other two cards apart.
  const previousStayRange = previousStay
    ? `00:00 - ${resolveStayTime(previousStay.checkOutTime, defaultCheckOutTime)}`
    : null;
  const previousStayRangeIsAssumed = Boolean(previousStay && !previousStay.checkOutTime?.trim());
  const currentStayRange = currentStay
    ? `${resolveStayTime(currentStay.checkInTime, defaultCheckInTime)} - 24:00`
    : null;
  const currentStayRangeIsAssumed = Boolean(currentStay && !currentStay.checkInTime?.trim());
  const hasDayImage = Boolean(day?.imageUrl && day.imageUrl.trim().length > 0);
  const travelSegmentLabel = useCallback(
    (segment: TravelSegment | null) => {
      if (!segment) return t("trips.travelSegment.addPrompt");
      const transport = t(`trips.travelSegment.transport.${segment.transportType}`);
      const duration = formatDurationMinutes(segment.durationMinutes);
      // Walking and cycling may carry a distance too (Story 6.16 / AC6); ship and flight still
      // cannot, so a stored value on them would be data the schema forbids and is not shown.
      const distance =
        transportTypeAllowsDistance(segment.transportType) && typeof segment.distanceKm === "number"
          ? `${segment.distanceKm} ${t("trips.travelSegment.kmSuffix")}`
          : null;
      return [transport, duration, distance].filter(Boolean).join(" · ");
    },
    [t],
  );
  const buildTravelTimeRange = useCallback((startTime: string | null | undefined, durationMinutes: number | null | undefined) => {
    if (!startTime || !durationMinutes || durationMinutes <= 0) return null;
    const startMinutes = parseTimeToMinutes(startTime);
    if (startMinutes === null) return null;
    const endMinutes = Math.min(startMinutes + durationMinutes, 24 * 60);
    return `${formatMinutesToTime(startMinutes)} - ${formatMinutesToTime(endMinutes)}`;
  }, []);
  const getPlanItemLabel = useCallback(
    (item: DayPlanItem, index: number) => {
      const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
      return item.title?.trim() || preview;
    },
    [t],
  );
  const firstPlanSegment =
    planItems.length > 0
      ? {
          id: planItems[0].id,
          type: "dayPlanItem" as const,
          label: getPlanItemLabel(planItems[0], 0),
          location: planItems[0].location,
          endTime: planItems[0].toTime ?? null,
        }
      : null;
  const previousSegmentTarget = firstPlanSegment ?? (planItems.length === 0 ? currentStaySegment : null);
  // Shared DESIGN.md shells, declared once so the timeline, sidebar and stat strip cannot drift apart.
  const cardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "18px",
  } as const;
  // badge-pill / tl-time: accent text on accent-soft, 4px radius, tabular figures.
  const timePillSx = {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 800,
    color: theme.palette.primary.main,
    backgroundColor: tokens.accentSoft,
    borderRadius: "4px",
    padding: "3px 8px",
    fontVariantNumeric: "tabular-nums",
  } as const;
  // Same pill, drained of accent, for a range derived from a default rather than a stored time.
  //
  // Still inkSoft rather than inkMuted, but for a different reason than before: Story 7.11 darkened
  // inkMuted to #7A7667 (4.55:1 on card white), closing the original finding. This pill is not on card
  // white though - it sits on `tokens.border` #E4DFD3, where inkMuted measures 3.42:1 and inkSoft
  // measures 4.25:1. Neither clears this system's 4.5:1 target on that background, so the swap would
  // strictly lose contrast at 11px for no design gain. Left on inkSoft deliberately; the pill's own
  // background is the thing to revisit if this row is ever reworked.
  const timePillAssumedSx = {
    ...timePillSx,
    color: tokens.inkSoft,
    backgroundColor: tokens.border,
  } as const;
  // badge-pill, filled variant: the same 4px/tabular geometry as the time pill with the accent moved
  // from the text to the fill. The two pills share the card head's one line, so the soft variant would
  // read as a second time range at a glance - which is the whole reason the fill is here.
  //
  // It shares `containedPrimary`'s accent-on-white pairing, but nothing else a button has: no 44px
  // minimum, no 6px radius, no 20px inline padding, and it sits inside a card head rather than on a
  // baseline of its own. At 11px in a 3px/8px pill it reads as a tag, not as an action.
  // `primary.main` *is* DESIGN.md's `colors.accent` #4B6358 - the palette entry is where theme.ts puts
  // it, and there is no `tokens.accent`. White on it measures 6.51:1.
  const costPillSx = {
    ...timePillSx,
    color: theme.palette.primary.contrastText,
    backgroundColor: theme.palette.primary.main,
    // The head row is `1fr auto`, so this cell sizes to its content and can be squeezed by a long
    // title beside it. `tlCostSx`, which this replaces, carried `nowrap` for the same reason - a
    // pill that breaks mid-amount stops reading as a pill.
    whiteSpace: "nowrap",
  } as const;
  const renderTimePill = (range: string | null, isAssumed: boolean) => {
    if (!range) return null;
    return (
      <Box sx={{ ...(isAssumed ? timePillAssumedSx : timePillSx), mb: 0.75 }}>
        {isAssumed ? formatMessage(t("trips.dayView.approxTimeRange"), { range }) : range}
      </Box>
    );
  };
  const statValueSx = {
    fontSize: 21,
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
    color: tokens.ink,
    // Cell 4's value carries the "No accommodation" sentence; without this the overflow is clipped by
    // the hero wrapper's overflow: hidden.
    overflowWrap: "anywhere",
  } as const;
  // Story 6.21: no `overflowWrap: "anywhere"` here, deliberately. It existed so cell 4's label could
  // break mid-word rather than overflow when it held an accommodation name - and breaking mid-word is
  // what turned one long name into a taller grid *row*, spend cell included. Every label is now a short
  // dictionary constant, so the rule has nothing left to act on: the widest is "TRAVEL TIME" at ~86px
  // against a ~130px column at 390px ((390 - 32 container gutters - 2 borders) / 2 - 48 cell padding).
  // Be honest about the trade: the wrapper at :2034 sets `overflow: hidden`, so a label that did
  // outgrow its cell is *clipped*, not shown overflowing. Clipping one label is still preferable to a
  // wrap that grows the row and drags the spend cell up with it, which is the defect this story exists
  // to remove - but it is a quiet failure, so the dictionary is what holds the line: the label guard in
  // i18nDictionaries.test.ts caps the longest word in each of these four strings. Do not reach for this
  // rule again to make a long label fit; shorten the string, or give the labels nowrap + ellipsis so the
  // truncation is at least visible (see DW-138).
  const statLabelSx = { color: tokens.inkSoft, display: "block", mb: 0.75 } as const;
  const statCellSx = { p: "16px 24px", minWidth: 0 } as const;
  const tlCardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 1.5,
    minWidth: 0,
  } as const;
  // tl-card-top: the spec's grid, not a flex row - "1fr auto" pins the trailing block (cost, edit
  // affordance) to its content width and centres it against the title block.
  const tlCardTopSx = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "14px",
    alignItems: "center",
  } as const;
  const tlCostSx = {
    fontSize: 13,
    fontWeight: 800,
    color: tokens.ink,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  } as const;
  // The whole card opens its editor, so it needs the affordances the pencil used to supply. Shared by
  // all three timeline card kinds - activity (6.9), previous night and current night (6.13) - because
  // a second near-identical copy is how two card kinds drift apart later.
  //
  // Split by pointer capability rather than by breakpoint. On a pointer device the glyph is a hover
  // reveal, so the card is not permanently decorated with an icon; on a touch device there is no hover
  // to reveal it with, so it is always there at low emphasis - a screen where nothing indicates the
  // card is editable is the failure mode this replaces the pencil to avoid.
  //
  // `opacity` rather than conditional rendering: the glyph holds its space in the head row at all
  // times, so the cost pill beside it does not jump left when the pointer arrives.
  const editableCardSx = canEditPlanning
    ? {
        transition: theme.transitions.create(["border-color", "background-color"], {
          duration: theme.transitions.duration.shortest,
        }),
        "@media (hover: hover)": {
          cursor: "pointer",
          [`& .${EDIT_GLYPH_CLASS}`]: {
            opacity: 0,
            transition: theme.transitions.create("opacity", {
              duration: theme.transitions.duration.shortest,
            }),
          },
          "&:hover": {
            backgroundColor: tokens.cardAlt,
            borderColor: theme.palette.primary.main,
            [`& .${EDIT_GLYPH_CLASS}`]: { opacity: 1, color: theme.palette.primary.main },
          },
        },
        "@media (hover: none)": {
          [`& .${EDIT_GLYPH_CLASS}`]: { opacity: 1 },
        },
        // A touchscreen laptop reports `hover: hover` - Chrome derives that pair from the *primary*
        // pointer - so the two branches above would leave it pinned at `opacity: 0` and reachable
        // only by mouse. Someone using that machine with a finger would see a card with nothing on
        // it saying it can be edited, which is the exact regression the touch branch exists to
        // prevent. `any-pointer: coarse` asks the other question: is a coarse pointer available at
        // all. It must stay after the `hover: hover` block - media queries add no specificity, so
        // source order is what decides this.
        "@media (any-pointer: coarse)": {
          [`& .${EDIT_GLYPH_CLASS}`]: { opacity: 1 },
        },
        // Keyboard reaches the overlay, not the glyph, so the hover reveal never fires for it. Without
        // this a keyboard user on a pointer device gets a focus ring around a card with no indication
        // of what activating it does. Outranks the `opacity: 0` above on specificity, not order.
        //
        // Scoped to the overlay rather than any descendant: every card kind now contains other
        // focusable children - links, photo thumbnails (6.12), and on the current-night card the copy
        // button sitting in the same row as the glyph (6.13). A bare `:has(:focus-visible)` lights the
        // pencil for all of them, telling a keyboard user that activating what they have focused
        // edits the card when it copies a stay or opens a photo.
        '&:has([data-testid$="-edit-overlay"]:focus-visible)': {
          [`& .${EDIT_GLYPH_CLASS}`]: { opacity: 1, color: theme.palette.primary.main },
        },
      }
    : {};
  // The card's content paints *above* the full-card edit overlay but lets clicks fall through to it,
  // so the card stays one click target without the content having to know the overlay exists. This is
  // the row pattern from `TripsDashboard.tsx:573-586`, which is also where the opt-out/opt-in pair
  // comes from: a layer that paints above the overlay is a dead zone unless it passes clicks on, and
  // real controls then take theirs back.
  //
  // The opt-in is what makes the links work, and it is why nothing here calls `stopPropagation`. A
  // raised `<a>` receives the click itself, so the overlay beneath it never fires at all - true for
  // the "open link" action and equally for a link mark inside the rich-text notes, which no handler
  // on the card could have distinguished from ordinary text.
  const overlaidContentSx = canEditPlanning
    ? {
        position: "relative",
        zIndex: 2,
        pointerEvents: "none",
        "& a, & button": { pointerEvents: "auto" },
      }
    : {};
  // An untitled activity falls back to its whole note body for a title, and that string becomes the
  // overlay's accessible name - a screen reader would read the entire note on every focus. The card
  // still shows the full text; only the name is capped.
  const capLabel = (label: string) =>
    label.length <= EDIT_LABEL_MAX_CHARS ? label : `${label.slice(0, EDIT_LABEL_MAX_CHARS - 1).trimEnd()}…`;
  const editLabelFor = (label: string) => formatMessage(t("trips.plan.editItemAria"), { title: capLabel(label) });
  // An accommodation card, unlike an activity, can be on screen with nothing on record - and an empty
  // card looks exactly like a filled one to a screen reader once the name is all it has. So add and
  // edit get different names, and the name is the only place that distinction lives.
  const stayLabelFor = (stayName: string | null | undefined, editKey: string, addKey: string) =>
    stayName ? formatMessage(t(editKey), { title: capLabel(stayName) }) : t(addKey);
  // The stretched control itself, shared by all three card kinds. A real `<button>`, so Enter and
  // Space are the browser's job: no `onKeyDown`, no `preventDefault`, and therefore no way for this to
  // swallow a keystroke meant for a link or a nested button inside the card.
  //
  // `inset: 0` puts it exactly on the card's border box, so its own focus ring at `outline-offset: 2`
  // draws where a ring on the card would. It owns the ring rather than the card, so focus stays
  // visible even where `:has()` does not resolve.
  const editOverlaySx = {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    borderRadius: "8px",
    border: 0,
    padding: 0,
    background: "none",
    appearance: "none",
    // Deliberately inherited: the pointer affordance is authored once on the card, inside
    // `@media (hover: hover)`, so a touch device does not get a cursor rule it has no cursor for.
    cursor: "inherit",
    "&:focus-visible": {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  } as const;
  // The decorative pencil that says the card is editable. Never a control: the overlay already carries
  // the role, the name and the tab stop, and on a pointer device this is invisible until hover, so a
  // tab stop here would land on nothing the user can see.
  const renderEditGlyph = (testId: string) => (
    <Box
      aria-hidden
      data-testid={testId}
      className={EDIT_GLYPH_CLASS}
      sx={{ display: "flex", alignItems: "center", color: tokens.inkMuted }}
    >
      <PencilIcon />
    </Box>
  );
  /**
   * DESIGN.md's amended `tl-card` (`:254`, `:260-264`): the card's bottom media row — the `photo-strip`
   * leading, the `doc-chip` group trailing, the group wrapping to a row of its own when the width
   * cannot hold both. One helper for all three `tl-card`s (previous stay, activity, current stay),
   * because the three sites were already byte-identical apart from their collections and their
   * `altPrefix`, and three copies of a two-limit layout is three chances for one of them to drift.
   *
   * Only the three `variant="strip"` sites use it. The `variant="gallery"` strips further down this
   * file and in `TripDayMapFullPage.tsx` are map-dialog surfaces, not `tl-card`s, and carry no media
   * row at all.
   *
   * Returns `null` when the entry has neither photos nor documents, so a bare card renders exactly what
   * it rendered before this story: no row, no wrapper, no empty flex box taking up a gap.
   */
  const renderMediaRow = (images: GalleryImage[], documents: GalleryDocument[], altPrefix: string) => {
    if (images.length === 0 && documents.length === 0) return null;
    const visibleDocuments = documents.slice(0, DOC_CHIP_VISIBLE_CAP);
    const hiddenDocumentCount = documents.length - visibleDocuments.length;
    // Identifies this entry's chip group against the one shared `Menu` mount, for the `+N` control's
    // `aria-expanded` below. A document row belongs to exactly one stay or activity, so its id names
    // the group as well as any generated key would - and unlike a `useRef` it is available during the
    // render that has to state the expanded/collapsed answer.
    const documentGroupKey = documents[0]?.id ?? null;

    return (
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "6px",
          // The whole of AC4's alignment rule, from one declaration and no measurement.
          // `space-between` is resolved **per flex line**: a line holding both children puts the strip
          // at the start and the chip group at the end (the token's "right, beside photo-strip"), and
          // a line holding one child puts it at the start (the token's "left, wrapped row"). Any
          // `justify-content: flex-end` or `margin-left: auto` spelling of the same idea would keep
          // the wrapped group pinned right, because neither can tell the two lines apart.
          justifyContent: "space-between",
        }}
      >
        {images.length > 0 ? (
          // The wrapper restores pointer events for the strip's gaps as well as its thumbnails, so a
          // near-miss between two of them does not fall through to the overlay and open the editor.
          // Kept even though the thumbnails are real `<button>`s that `overlaidContentSx`'s
          // `"& a, & button"` opt-in reaches on its own — the gaps are the point.
          <Box sx={{ pointerEvents: "auto" }}>
            <MiniImageStrip
              variant="strip"
              images={images}
              altPrefix={altPrefix}
              onImageClick={(index) => setFullscreenPhotos({ images: toViewerImages(images, altPrefix), index })}
            />
          </Box>
        ) : null}
        {documents.length > 0 ? (
          <Box
            data-testid="tl-card-doc-row"
            sx={{
              // Same reasoning as the strip's wrapper, and the same defect it prevents: the chips are
              // anchors the opt-in already reaches, but the 6px between two of them is not, and a
              // near-miss there would open the entry's editor instead of doing nothing.
              pointerEvents: "auto",
              display: "flex",
              // Up to three chips wrap among themselves rather than overflowing the card at 390px.
              // The group still moves below the photos as one unit — that is the outer row's job, not
              // this one's.
              flexWrap: "wrap",
              alignItems: "center",
              gap: "6px",
              // Never `flexGrow`. The group shrink-wraps its chips so the outer row's
              // `space-between` has free space to push it right with; a growing group would fill the
              // line and pin itself to the left of it.
              flex: "0 1 auto",
              // The floor of the wrap threshold, and the only width decision in this row. Flex line
              // breaking reads each item's content width clamped by `min-width`, so a group naturally
              // wider than this wraps on its own width and a narrower one wraps on this — and either
              // way flexbox moves the **whole group** to the next line rather than shrinking it to
              // one, the truncation DESIGN.md `:262` and AC4 both reject. Measured; see the
              // constant's table.
              minWidth: DOC_ROW_MIN_WIDTH,
              // Matches `MiniImageStrip`'s own `mt`, so the two children's margin boxes centre on the
              // same line beside each other and the wrapped group still clears the photos beneath.
              mt: 0.75,
            }}
          >
            {visibleDocuments.map((documentRow, index) => (
              <DocChip
                key={documentRow.id}
                documentUrl={documentRow.documentUrl}
                fileName={documentRow.fileName}
                // The position within **the entry**, not within the visible slice, and the entry's
                // full count — so the third chip of five is announced as 3 of 5 rather than 3 of 3.
                // Two documents on one entry may share a file name (the unique index is on
                // `sortOrder`, not on the name), and this is what keeps their accessible names apart.
                index={index}
                total={documents.length}
                // No cache-buster on the href. `withImageCacheBuster` exists because the hero and
                // day-image routes write a *stable* filename, so a replacement keeps a byte-identical
                // URL (DW-23). A document's name carries a timestamp and a random suffix and is never
                // overwritten, so a stamp here would only add noise to a URL that is already unique.
              />
            ))}
            {hiddenDocumentCount > 0 ? (
              // The strip's own `+N`, down to the element, the 44px floor and the singular/plural
              // twin — only the dictionary keys differ. A second overflow vocabulary in the same row
              // would read as a different kind of thing (DESIGN.md `:264`).
              <Typography
                component="button"
                type="button"
                variant="caption"
                color="text.secondary"
                aria-haspopup="menu"
                // `aria-haspopup` alone promises a popup and never says whether it is open, so the
                // control announces the same thing in both directions and the state of the overflow is
                // never conveyed - the one thing a screen-reader user cannot see for themselves. The
                // menu is a single shared mount, so "is it mine?" is answered by the entry's first
                // document id rather than by a ref per chip group; documents belong to exactly one
                // entry, so that id identifies the group. No `aria-controls`: the list does not exist
                // while the menu is closed, and pointing at an absent element is worse than silence.
                aria-expanded={documentMenu?.ownerKey === documentGroupKey}
                aria-label={
                  hiddenDocumentCount === 1
                    ? t("trips.documents.showMoreDocumentsOne")
                    : formatMessage(t("trips.documents.showMoreDocuments"), { count: hiddenDocumentCount })
                }
                // The whole collection, not the hidden tail: the strip's `+N` opens the full set at
                // the first unshown index, and a list that omitted the three names already on the
                // card would be a different affordance wearing the same glyph.
                onClick={(event) =>
                  setDocumentMenu({ anchorEl: event.currentTarget, documents, ownerKey: documentGroupKey })
                }
                sx={{
                  fontWeight: 600,
                  // The 44px touch floor, below the 56px thumbnails so the row's height is unchanged.
                  minWidth: 44,
                  minHeight: 44,
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  "&:focus-visible": { outline: "2px solid", outlineColor: "text.primary", outlineOffset: "2px" },
                }}
              >
                +{hiddenDocumentCount}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  };
  // Two-part, and not the same condition as the current-night card's: with no previous day there is no
  // accommodation to edit and nothing for the add dialog to attach to, so the card stays inert even for
  // someone who can otherwise plan.
  const canEditPreviousStay = Boolean(previousDay) && canEditPlanning;
  // The continuous rail: a 2px rule the dots sit on top of, inset so it stops short of both ends.
  //
  // The rule's centre is fixed at x=16 (left 15 + half of 2px) at every breakpoint, because that is
  // where a 32px dot lands at both paddings: xs pulls the dot back 34px from a 34px inset and md 44
  // from 44, so the dot spans 0..32 either way. Moving this to 11px at xs put the rule 4px left of
  // every dot on the timeline.
  const timelineRailSx = {
    position: "relative",
    pl: { xs: "34px", md: "44px" },
    "&::before": {
      content: '""',
      position: "absolute",
      top: 18,
      bottom: 18,
      left: "15px",
      width: "2px",
      backgroundColor: tokens.borderStrong,
    },
  } as const;
  const dotBaseSx = {
    position: "absolute",
    left: { xs: -34, md: -44 },
    top: 0,
    width: 32,
    height: 32,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  } as const;
  const stayDotSx = {
    ...dotBaseSx,
    backgroundColor: tokens.accentSoft,
    border: "2px solid",
    borderColor: theme.palette.primary.main,
  } as const;
  const activityDotSx = {
    ...dotBaseSx,
    backgroundColor: tokens.card,
    border: "2px solid",
    borderColor: tokens.borderStrong,
  } as const;
  const neutralMarkerSx = { width: 8, height: 8, borderRadius: "50%", backgroundColor: tokens.inkSoft } as const;
  // Read from the bar's own palette rather than restating it: a legend that re-derives the fills is
  // correct on the day it is written and wrong the first time the bar changes. The 3px hatch pitch
  // this used to hardcode already disagreed with the default bar's 4px.
  const ganttPalette = buildGanttPalette(theme, "default");
  // The hatch entry appears only when the bar actually renders a gap segment. A legend key for a fill
  // that is nowhere on the bar sends the reader looking for something that does not exist - which is
  // what happened on a day whose stay has no check-in, where the gaps are deliberately suppressed.
  const coverageHasGap = coverageSegments.some((segment) => segment.kind === "gap");
  const coverageLegend = [
    { key: "stay", label: t("trips.dayView.coverageLegendStay"), background: ganttPalette.accommodation },
    { key: "activity", label: t("trips.dayView.coverageLegendActivity"), background: ganttPalette.planItem },
    { key: "travel", label: t("trips.dayView.coverageLegendTravel"), background: ganttPalette.travel },
    ...(coverageHasGap
      ? [{ key: "gap", label: t("trips.dayView.coverageLegendGap"), background: ganttPalette.gap }]
      : []),
  ];

  // tl-segment: a plain icon + text connector row - no card, no photo, per DESIGN.md's timeline spec.
  const renderTravelSegment = (from: SegmentItem, to: SegmentItem) => {
    const segment = segmentsByKey.get(buildSegmentKey(from, to)) ?? null;
    const travelTimeRange = segment ? buildTravelTimeRange(from.endTime, segment.durationMinutes) : null;
    // Only a recorded transportType earns a transport glyph. With no segment saved the row is a prompt
    // to enter one, so a car icon there would assert a mode the user has not chosen - the same reason
    // activity nodes get a neutral marker instead of an inferred icon.
    const TransportIcon = segment ? transportIconFor(segment.transportType) : null;
    return (
      <Box
        key={`segment-${from.id}-${to.id}`}
        data-testid="travel-segment"
        data-from-id={from.id}
        data-to-id={to.id}
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          margin: "-2px 0 12px",
          padding: "6px 0 6px 4px",
          color: tokens.inkSoft,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            // Centres the 22px dot on the rail's x=16 at both paddings (34 - 29 + 11 = 16, 44 - 39 + 11 = 16).
            left: { xs: -29, md: -39 },
            top: 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            backgroundColor: theme.palette.background.default,
            color: tokens.inkSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          {TransportIcon ? <TransportIcon /> : <Box sx={neutralMarkerSx} />}
        </Box>
        <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
          {travelTimeRange ? <Box sx={timePillSx}>{travelTimeRange}</Box> : null}
          <Typography sx={{ fontSize: "11.5px", fontWeight: 700, color: tokens.inkSoft }}>
            {travelSegmentLabel(segment)}
          </Typography>
        </Box>
        {!canEditPlanning ? null : segment ? (
          <IconButton
            size="small"
            color="primary"
            aria-label={t("trips.travelSegment.editAction")}
            onClick={() => handleOpenTravelSegment(from, to)}
          >
            <Box component="span" sx={VISUALLY_HIDDEN}>
              {t("trips.travelSegment.editAction")}
            </Box>
            <SvgIcon fontSize="small">
              <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
            </SvgIcon>
          </IconButton>
        ) : (
          <Button size="small" variant="text" onClick={() => handleOpenTravelSegment(from, to)}>
            {t("trips.travelSegment.addAction")}
          </Button>
        )}
      </Box>
    );
  };

  const resolveDayImageSrc = useCallback((imageUrl?: string | null, updatedAt?: string) => {
    if (!imageUrl || !imageUrl.trim()) return null;
    if (!updatedAt) return imageUrl;
    const version = encodeURIComponent(updatedAt);
    return imageUrl.includes("?") ? `${imageUrl}&v=${version}` : `${imageUrl}?v=${version}`;
  }, []);

  /** AC7 — the day-details dialog's preview source, cache-busted the same way the hero is. */
  const dayImagePreviewSrc = useMemo(
    () => resolveDayImageSrc(day?.imageUrl, day?.updatedAt),
    [day?.imageUrl, day?.updatedAt, resolveDayImageSrc],
  );

  const updateLocalDayMeta = useCallback(
    (payload: { imageUrl: string | null; note: string | null; updatedAt?: string }) => {
      if (!day) return;

      setDay((current) =>
        current
          ? { ...current, imageUrl: payload.imageUrl, note: payload.note, updatedAt: payload.updatedAt ?? current.updatedAt }
          : current,
      );
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          days: current.days.map((entry) =>
            entry.id === day.id
              ? { ...entry, imageUrl: payload.imageUrl, note: payload.note, updatedAt: payload.updatedAt ?? entry.updatedAt }
              : entry,
          ),
        };
      });
    },
    [day],
  );

  const handleSaveDayImage = useCallback(async () => {
    if (!day) return;
    const normalizedNote = dayNoteDraft.trim();

    // The picker accepts any image/* so Safari lets the file be selected at all; reject unsupported
    // formats here with a specific reason instead of a generic upload failure from the server.
    if (dayImageFile && !isSupportedImageUpload(dayImageFile)) {
      setError(t("trips.image.unsupportedFormat"));
      return;
    }

    setDayImageSaving(true);
    setError(null);

    try {
      const token = await ensureCsrfToken();
      if (dayImageFile) {
        const formData = new FormData();
        formData.set("file", dayImageFile);
        formData.set("note", normalizedNote.length > 0 ? normalizedNote : "");

        const uploadResponse = await fetch(`/api/trips/${tripId}/days/${day.id}/image`, {
          method: "POST",
          credentials: "include",
          headers: {
            "x-csrf-token": token,
          },
          body: formData,
        });

        const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{
          day: { id: string; imageUrl: string | null; note: string | null; updatedAt: string };
        }>;
        if (!uploadResponse.ok || uploadBody.error || !uploadBody.data?.day) {
          setError(
            uploadBody.error?.message
              ? `${t("trips.dayImage.uploadError")} (${uploadBody.error.message})`
              : t("trips.dayImage.uploadError"),
          );
          return;
        }
        updateLocalDayMeta({
          imageUrl: uploadBody.data.day.imageUrl,
          note: uploadBody.data.day.note,
          updatedAt: uploadBody.data.day.updatedAt,
        });
        setDayImageFile(null);
        setDayNoteDraft(uploadBody.data.day.note ?? "");
        setDayMetaOpen(false);
        return;
      }

      const response = await fetch(`/api/trips/${tripId}/days/${day.id}/image`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          imageUrl: day.imageUrl ?? null,
          note: normalizedNote.length > 0 ? normalizedNote : null,
        }),
      });

      const body = (await response.json()) as ApiEnvelope<{
        day: { id: string; imageUrl: string | null; note: string | null; updatedAt: string };
      }>;
      if (!response.ok || body.error || !body.data?.day) {
        setError(body.error?.message ? `${t("trips.dayImage.saveError")} (${body.error.message})` : t("trips.dayImage.saveError"));
        return;
      }

      updateLocalDayMeta({ imageUrl: body.data.day.imageUrl, note: body.data.day.note, updatedAt: body.data.day.updatedAt });
      setDayImageFile(null);
      setDayNoteDraft(body.data.day.note ?? "");
      setDayMetaOpen(false);
    } catch {
      setError(t("trips.dayImage.saveError"));
    } finally {
      setDayImageSaving(false);
    }
  }, [day, dayImageFile, dayNoteDraft, ensureCsrfToken, t, tripId, updateLocalDayMeta]);

  const handleRemoveDayImage = useCallback(async () => {
    if (!day) return;

    setDayImageSaving(true);
    setError(null);

    try {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/days/${day.id}/image`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ imageUrl: null, note: dayNoteDraft.trim().length > 0 ? dayNoteDraft.trim() : null }),
      });

      const body = (await response.json()) as ApiEnvelope<{
        day: { id: string; imageUrl: string | null; note: string | null; updatedAt: string };
      }>;
      if (!response.ok || body.error || !body.data?.day) {
        setError(body.error?.message ? `${t("trips.dayImage.saveError")} (${body.error.message})` : t("trips.dayImage.saveError"));
        return;
      }

      updateLocalDayMeta({ imageUrl: null, note: body.data.day.note, updatedAt: body.data.day.updatedAt });
      setDayImageFile(null);
      setDayNoteDraft(body.data.day.note ?? "");
    } catch {
      setError(t("trips.dayImage.saveError"));
    } finally {
      setDayImageSaving(false);
    }
  }, [day, dayNoteDraft, ensureCsrfToken, t, tripId, updateLocalDayMeta]);

  const budgetEntries = useMemo(() => {
    const entries: { id: string; label: string; amountCents: number | null }[] = [];

    planItems.forEach((item, index) => {
      const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
      const title = item.title?.trim() || preview;
      entries.push({
        id: item.id,
        label: title,
        amountCents: item.costCents,
      });
    });

    if (currentStay) {
      entries.push({
        id: `current-stay-${currentStay.id}`,
        label: formatMessage(t("trips.dayView.budgetItemCurrentNight"), { name: currentStay.name }),
        amountCents: currentStay.costCents,
      });
    }

    return entries;
  }, [currentStay, planItems, t]);

  const knownBudgetEntries = useMemo(
    () =>
      budgetEntries.filter(
        (entry): entry is { id: string; label: string; amountCents: number } => entry.amountCents !== null,
      ),
    [budgetEntries],
  );
  const dayTotalCents = knownBudgetEntries.reduce((sum, entry) => sum + entry.amountCents, 0);

  const mapData = useMemo(
    () => {
      const mapItems = buildTripDayMapItems({
        previousStay: previousStay ? { id: previousStay.id, name: previousStay.name, location: previousStay.location } : null,
        planItems: planItems.map((item, index) => ({
          id: item.id,
          label:
            item.title?.trim() ||
            parsePlanText(item.contentJson) ||
            formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 }),
          location: item.location,
        })),
        currentStay: currentStay ? { id: currentStay.id, name: currentStay.name, location: currentStay.location } : null,
      });
      return buildDayMapPanelData(mapItems);
    },
    [currentStay, planItems, previousStay, t],
  );

  const handleMapMarkerClick = useCallback(
    (point: TripDayMapPoint) => {
      if (point.kind === "planItem") {
        const planItem = planItems.find((item) => item.id === point.id);
        if (!planItem) return;
        setMapDialogItem({ kind: "planItem", id: planItem.id, label: point.label, planItem });
        return;
      }

      if (point.kind === "previousStay") {
        if (!previousStay) return;
        setMapDialogItem({ kind: "previousStay", id: previousStay.id, label: point.label, stay: previousStay });
        return;
      }

      if (point.kind === "currentStay") {
        if (!currentStay) return;
        setMapDialogItem({ kind: "currentStay", id: currentStay.id, label: point.label, stay: currentStay });
      }
    },
    [currentStay, planItems, previousStay],
  );

  const handleMapExpand = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(scrollRestoreKey, String(window.scrollY));
    } catch {
      // Ignore storage failures.
    }
  }, [scrollRestoreKey]);

  const handleDayMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setDayMenuAnchor(event.currentTarget);
  };

  const handleDayMenuClose = () => {
    setDayMenuAnchor(null);
  };

  useEffect(() => {
    const fallbackPolyline = mapData.points.map((point) => point.position);
    setRoutePolyline(fallbackPolyline);
    setRoutingUnavailable(false);

    if (!day || mapData.points.length < 2) {
      return;
    }

    let active = true;
    const loadRoute = async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}/days/${day.id}/route`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const payload = (await response.json()) as ApiEnvelope<{
          route?: {
            polyline?: unknown;
          };
        }>;

        if (!active) return;

        if (!response.ok || payload.error) {
          const fallbackFromError = parsePolyline(
            (payload.error?.details as { fallbackPolyline?: unknown } | undefined)?.fallbackPolyline,
          );
          setRoutePolyline(fallbackFromError.length >= 2 ? fallbackFromError : fallbackPolyline);
          setRoutingUnavailable(true);
          return;
        }

        const routedPolyline = parsePolyline(payload.data?.route?.polyline);
        setRoutePolyline(routedPolyline.length >= 2 ? routedPolyline : fallbackPolyline);
      } catch {
        if (!active) return;
        setRoutePolyline(fallbackPolyline);
        setRoutingUnavailable(true);
      }
    };

    void loadRoute();

    return () => {
      active = false;
    };
  }, [day, mapData.points, tripId]);

  if (loading) {
    // A skeleton silhouette of this screen's own layout - hero, coverage panel, stat strip, columns -
    // rather than a spinner, per EXPERIENCE.md's cold-load convention for a full route load.
    return (
      <Box sx={cardSx} data-testid="trip-day-view-loading">
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="rectangular" height={210} sx={{ borderRadius: "8px" }} />
          <Skeleton variant="rectangular" height={16} sx={{ borderRadius: "4px" }} />
          <Skeleton variant="text" width="40%" height={34} />
          <Skeleton variant="rectangular" height={220} />
        </Box>
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="heading" component="h5" sx={{ color: tokens.ink }}>
            {t("trips.dayView.notFoundTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.dayView.notFoundBody")}
          </Typography>
          <Button component={Link} href={`/trips/${tripId}`} variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.dayView.back")}
          </Button>
        </Box>
      </Box>
    );
  }

  const dayTitle =
    day && day.note && day.note.trim().length > 0
      ? formatMessage(t("trips.dayView.titleWithNote"), { index: day.dayIndex, note: day.note.trim() })
      : day
        ? formatMessage(t("trips.dayView.title"), { index: day.dayIndex })
        : "";

  const isDayGap = Boolean(day?.missingAccommodation);
  const dayHeroImageCss = toCssUrl(
    resolveDayImageSrc(day?.imageUrl, day?.updatedAt) ?? "/images/world-map-placeholder.svg",
  );
  // One predicate for "this day has somewhere to sleep", shared with the timeline's warn treatment.
  // Both derive from the same server field (missingAccommodation is !hasAccommodation in tripRepo), so
  // the screen's two gap signals must not be computed from two different expressions.
  const statStay = isDayGap ? null : currentStay;
  const checkInStatValue = !statStay
    ? t("trips.timeline.noAccommodation")
    : // The gantt falls back to 16:00 so it has a segment to draw; a stat cell is read as a fact about
      // the booking, so an unset check-in stays an em dash rather than surfacing the assumption.
      statStay.checkInTime?.trim() || "—";

  return (
    <Box display="flex" flexDirection="column" gap={2} data-testid="trip-day-view-page">
      {error && <Alert severity="error">{error}</Alert>}
      {planMoveNotice && <Alert severity="success">{planMoveNotice}</Alert>}

      {detail && day && (
        <>
          <Box sx={{ borderRadius: "8px", overflow: "hidden", border: "1px solid", borderColor: tokens.border }}>
            <Box
              data-testid="day-hero"
              sx={{
                position: "relative",
                minHeight: 210,
                display: "flex",
                flexDirection: "column",
                // Inline padding is responsive below md to match the panel directly beneath the hero.
                // The top padding is not decoration: with the header row gone (Story 6.19) it is the
                // only thing standing between a 280-character note and the two chevrons at the top
                // corners, so it is `HERO_CONTROL_BAND` and derived from their geometry. See that
                // constant for why a ceiling in padding beats a `maxHeight` on the title block.
                padding: {
                  xs: `${HERO_CONTROL_BAND}px ${HERO_PADDING_INLINE.xs}px 24px`,
                  md: `${HERO_CONTROL_BAND}px ${HERO_PADDING_INLINE.md}px 24px`,
                },
                overflow: "hidden",
                backgroundColor: theme.palette.primary.main,
                backgroundImage: dayHeroImageCss,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <Box aria-hidden sx={{ position: "absolute", inset: 0, background: HERO_SCRIM }} />
              {/* Story 6.19: three controls, three corners, and nothing else on the photo. The
                  two-slot header row that used to sit here in normal flow is gone rather than
                  emptied - its last child, the "back to trip" button, is now the first item of the
                  `⋯` menu below, and an empty flex container would go on reserving `mb: 2` plus a
                  line box of height for nothing.

                  All three are absolutely positioned against the hero's padding box and all three
                  read `HERO_CONTROL_INSET`, which is what makes the `⋯` and the next-day chevron
                  share a right edge at every breakpoint (AC3). The row's inherited padding was the
                  discrepancy; none of them may reintroduce it.

                  DOM order is previous, next, `⋯` - the reading order of the three corners they
                  occupy, so the keyboard follows the eye (AC9). Position comes entirely from
                  `top`/`left`/`right`/`bottom`, so ordering them for the keyboard costs nothing
                  visually.

                  `zIndex: 3` on all three, one above the title block. The title is bottom-anchored
                  and grows upward on a long note, and at equal `zIndex` the later sibling wins both
                  painting and hit-testing - which would leave a control looking present and partly
                  dead to the touch. The title's own clearance is `HERO_CONTROL_BAND`, not this
                  stacking order: `zIndex` decides who paints on top, not whether text runs visibly
                  under a translucent button.

                  A missing neighbour renders nothing - not a disabled button (6.11). There is no row
                  shape left to preserve, and disabled chrome over arbitrary photography reads as a
                  smudge rather than as an unavailable control. */}
              {previousDay ? (
                <IconButton
                  component={Link}
                  href={`/trips/${tripId}/days/${previousDay.id}`}
                  aria-label={t("trips.dayView.previousAria")}
                  data-testid="day-hero-prev"
                  sx={{
                    ...ON_PHOTO_CHROME,
                    ...HERO_CHEVRON_BACKING,
                    position: "absolute",
                    top: HERO_CONTROL_INSET,
                    left: HERO_CONTROL_INSET,
                    zIndex: 3,
                    width: HERO_CONTROL_SIZE,
                    height: HERO_CONTROL_SIZE,
                  }}
                >
                  <ChevronLeftIcon />
                </IconButton>
              ) : null}
              {nextDay ? (
                <IconButton
                  component={Link}
                  href={`/trips/${tripId}/days/${nextDay.id}`}
                  aria-label={t("trips.dayView.nextAria")}
                  data-testid="day-hero-next"
                  sx={{
                    ...ON_PHOTO_CHROME,
                    ...HERO_CHEVRON_BACKING,
                    position: "absolute",
                    top: HERO_CONTROL_INSET,
                    right: HERO_CONTROL_INSET,
                    zIndex: 3,
                    width: HERO_CONTROL_SIZE,
                    height: HERO_CONTROL_SIZE,
                  }}
                >
                  <ChevronRightIcon />
                </IconButton>
              ) : null}
              {/* Deliberately outside every role condition, and no longer behind a "does the menu
                  hold anything?" test either: the menu's first item is the way back to the trip and
                  it is ungated, so the trigger can never be empty and gating it would strand a
                  viewer on the day screen with no route off it (6.19 AC8; 6.15 trap 1b). The 44px
                  hit area is spelled out because the theme sets `minHeight` on MuiButton and has no
                  MuiIconButton override - `size="small"` alone renders ~28px. */}
              <IconButton
                id="day-hero-overflow-button"
                aria-label={t("trips.dayView.moreActions")}
                title={t("trips.dayView.moreActions")}
                aria-haspopup="menu"
                aria-expanded={Boolean(dayMenuAnchor)}
                aria-controls={dayMenuAnchor ? "day-hero-overflow-menu" : undefined}
                onClick={handleDayMenuOpen}
                data-testid="day-hero-overflow"
                sx={{
                  ...ON_PHOTO_CHROME,
                  position: "absolute",
                  bottom: HERO_CONTROL_INSET,
                  right: HERO_CONTROL_INSET,
                  zIndex: 3,
                  width: HERO_CONTROL_SIZE,
                  height: HERO_CONTROL_SIZE,
                }}
              >
                <MoreHorizontalIcon />
              </IconButton>
              {/* A page-local menu rather than an entry in the global HeaderMenu: that menu is built
                  from getAuthMenuItems(authState) alone, while these items need this trip and this
                  day, and a globally visible print entry would dangle on every page that is not a
                  day. HeaderMenu.tsx and authMenu.ts stay untouched (6.11 AC5, 6.15). `/trips/{id}`
                  needs the trip id too, which is why 6.19 put back-to-trip here and not there. */}
              <Menu
                id="day-hero-overflow-menu"
                anchorEl={dayMenuAnchor}
                // The anchor alone. Until 6.19 this read `hasDayMenuItems && Boolean(dayMenuAnchor)`,
                // against a role change unmounting a gated trigger while the menu was open and
                // leaving `anchorEl` on a detached node. Dropping the conjunct is a no-op, and not
                // because 6.19 made the trigger unconditional: `hasDayMenuItems` was
                // `some(dayImage, transfers, print)` with `print` a literal `true`, so it was
                // tautologically true for every role and never suppressed anything. It read as a
                // guard without being one.
                //
                // The hole it was written for is real and still open, which is why it is recorded in
                // deferred-work rather than papered over here: `loadDay()` sets `loading` with the
                // dayId unchanged (a transfer submit, an accommodation save), and `notFound` swaps
                // the hero out the same way - either unmounts the trigger under an open menu, and
                // the `dayId`-change reset does not fire because the day did not change. Fixing it
                // means clearing the anchor where the hero unmounts, not adding a term here.
                open={Boolean(dayMenuAnchor)}
                onClose={handleDayMenuClose}
                // Right-aligned to its trigger, which HeaderMenu's does not need to be: that one
                // anchors mid-header, this one sits at the hero's right edge, where MUI's
                // default top-left origin would open the paper rightwards over the trigger and
                // leave it to Popover's viewport clamping to drag back.
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                // slotProps.paper, not the deprecated PaperProps (MUI 7) - same call the dialogs
                // make. The surface itself is HeaderMenu's, so the two menus read as one idiom.
                slotProps={{
                  paper: {
                    sx: {
                      mt: 1,
                      borderRadius: 3,
                      px: 1,
                      backgroundColor: "#ffffff",
                      border: "1px solid rgba(17, 18, 20, 0.08)",
                      boxShadow: "0 20px 40px rgba(17, 18, 20, 0.18)",
                    },
                  },
                  // Named by its trigger. Every role that can open this day can print, so the menu
                  // is never announced unnamed in practice - but the name should come from the
                  // trigger rather than from that coincidence.
                  list: { "aria-labelledby": "day-hero-overflow-button" },
                }}
              >
                {/* Ordering (Story 6.15 Task 4): everything that changes this day sits above the
                    divider, in descending privilege - the owner-only day-image edit, then move and
                    swap as the adjacent pair they are - and print, which changes nothing and leaves
                    for another tab, sits below it. Ordering by privilege also means each role sees
                    a contiguous tail of this list, so the divider never floats to the top: it is
                    suppressed outright when the group above it is empty.

                    Story 6.19 puts back-to-trip above all of it. It is the way off the screen and
                    the first thing a thumb should reach, and it is the only item every role gets.
                    It is deliberately not part of either group the divider separates, and does not
                    feed `showDayMenuDivider`: giving it a rule of its own would draw a separator
                    between the only two entries a viewer sees, which is noise, not structure.

                    No aria-label on any item: it would replace the visible label as the accessible
                    name rather than supplement it, so a voice-control user saying what they read
                    could not activate it (WCAG 2.5.3). The visible label is the name.

                    aria-haspopup="dialog" on the three that open one: unlike aria-label it is
                    additive, so it warns that activating the item swaps this menu for a modal
                    without touching the name. Print does not carry it - it opens a tab. */}
                {/* An in-app link, so no target/rel - those belong to print alone, and giving them
                    to this one would leave the trip open in a second tab behind the day. */}
                <MenuItem
                  component={Link}
                  href={`/trips/${tripId}`}
                  sx={DAY_MENU_ITEM_SX}
                  onClick={handleDayMenuClose}
                >
                  <Typography>{t("trips.dayView.back")}</Typography>
                </MenuItem>
                {dayMenuItemsVisible.dayImage ? (
                  <MenuItem
                    aria-haspopup="dialog"
                    sx={DAY_MENU_ITEM_SX}
                    onClick={() => {
                      handleDayMenuClose();
                      setDayMetaOpen(true);
                    }}
                  >
                    <Typography>{t("trips.dayImage.editAction")}</Typography>
                  </MenuItem>
                ) : null}
                {dayMenuItemsVisible.transfers ? (
                  <MenuItem
                    aria-haspopup="dialog"
                    sx={DAY_MENU_ITEM_SX}
                    onClick={() => {
                      handleDayMenuClose();
                      handleOpenTransferDialog("move");
                    }}
                  >
                    <Typography>{t("trips.dayTransfer.moveAction")}</Typography>
                  </MenuItem>
                ) : null}
                {dayMenuItemsVisible.transfers ? (
                  <MenuItem
                    aria-haspopup="dialog"
                    sx={DAY_MENU_ITEM_SX}
                    onClick={() => {
                      handleDayMenuClose();
                      handleOpenTransferDialog("swap");
                    }}
                  >
                    <Typography>{t("trips.dayTransfer.swapAction")}</Typography>
                  </MenuItem>
                ) : null}
                {/* component="li": Divider defaults to <hr>, and MenuList renders a <ul>, whose only
                    permitted children are <li>. As an <hr> it validates as an error and AT that
                    rebuilds the list from valid children can drop the separator outright. */}
                {showDayMenuDivider ? (
                  <Divider component="li" data-testid="day-hero-overflow-divider" />
                ) : null}
                {/* The only item carrying link props: print opens a document in a new tab. The
                    three above are handlers, and giving them target/rel would open their dialogs
                    in a tab of their own. */}
                {dayMenuItemsVisible.print ? (
                  <MenuItem
                    component={Link}
                    href={`/trips/${tripId}/days/${day.id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={DAY_MENU_ITEM_SX}
                    onClick={handleDayMenuClose}
                  >
                    <Typography>{t("trips.dayView.printAction")}</Typography>
                  </MenuItem>
                ) : null}
              </Menu>
              {/* The hero's only in-flow child, and `mt: auto` is what keeps it pinned to the bottom
                  now that it is alone in the column.

                  `pr` is the second half of AC5's clearance, and the half `zIndex` cannot give: the
                  `⋯` is a translucent 44px disc at the bottom-right corner, and the title's last line
                  would otherwise run visibly beneath it. Stacking order only decides who paints on
                  top. The ceiling for the *other* end - the two chevrons in the top corners, which
                  the header row used to keep a long title away from just by being in flow - is the
                  hero's `padding-top`, `HERO_CONTROL_BAND`. */}
              <Box
                sx={{
                  position: "relative",
                  zIndex: 2,
                  mt: "auto",
                  pr: HERO_TITLE_RIGHT_CLEARANCE,
                }}
              >
                {/* component="h5" is not optional: custom typography variants carry no variantMapping,
                    so without it this renders as a <span> and the page loses its only heading. */}
                <Typography
                  variant="display"
                  component="h5"
                  sx={{ color: "#FFFFFF", textShadow: "0 2px 14px rgba(0,0,0,.35)", overflowWrap: "anywhere" }}
                >
                  {dayTitle}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,.92)", fontSize: 13, fontWeight: 600, mt: 0.75 }}>
                  {formatDate(day.date)}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                backgroundColor: tokens.card,
                borderBottom: "1px solid",
                borderColor: tokens.border,
                // Inline padding from the same constant the hero reads: this panel is the reason the
                // hero's gutters are responsive at all, and the pair only earns that if they cannot
                // drift apart. Block padding is this panel's own and stays literal.
                padding: {
                  xs: `16px ${HERO_PADDING_INLINE.xs}px 18px`,
                  md: `16px ${HERO_PADDING_INLINE.md}px 18px`,
                },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 1,
                  mb: 1.25,
                }}
              >
                {/* No section label. The bar sits directly under a hero whose title already says which
                    day this is, and its own legend names every fill on it - "Day coverage" restated
                    what the reader could see and cost a line of vertical space on a phone. */}
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  {coverageLegend.map((entry) => (
                    <Box key={entry.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <Box
                        aria-hidden
                        data-testid={`coverage-legend-swatch-${entry.key}`}
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "2px",
                          flexShrink: 0,
                          background: entry.background,
                          ...(entry.key === "gap" ? { border: "1px solid", borderColor: tokens.warnBorder } : {}),
                        }}
                      />
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: tokens.inkSoft }}>
                        {entry.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <TripDayGanttBar segments={coverageSegments} ariaLabel={t("trips.dayView.ganttAriaLabel")} />

              <Box aria-hidden sx={{ position: "relative", height: 14, mt: 0.75 }} data-testid="coverage-axis">
                {COVERAGE_AXIS_TICKS.map((tick) => (
                  <Typography
                    key={tick.label}
                    sx={{
                      position: "absolute",
                      top: 0,
                      left: `${tick.percent}%`,
                      transform: tick.percent === 0 ? "none" : tick.percent === 100 ? "translateX(-100%)" : "translateX(-50%)",
                      fontSize: 10,
                      fontWeight: 600,
                      color: tokens.inkMuted,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {tick.label}
                  </Typography>
                ))}
              </Box>
              {/* The tick row stays aria-hidden - five bare numbers read in sequence are noise - but the
                  domain it conveys is real information that appears nowhere else, so it is carried in
                  text for assistive tech instead of being dropped. */}
              <Box component="span" data-testid="coverage-axis-description" sx={VISUALLY_HIDDEN}>
                {t("trips.dayView.coverageAxisDescription")}
              </Box>

              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mt={1}>
                <Typography variant="body2" sx={{ color: tokens.inkSoft }} aria-live="polite">
                  {ganttSummary}
                </Typography>
                {isFullyPlanned ? (
                  <Chip size="small" color="success" label={t("trips.dayView.ganttFullyPlanned")} />
                ) : null}
              </Box>
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                backgroundColor: tokens.card,
              }}
            >
              <Box
                sx={{
                  ...statCellSx,
                  borderRight: "1px solid",
                  borderBottom: { xs: "1px solid", sm: "none" },
                  borderColor: tokens.border,
                }}
                data-testid="day-stat-day"
              >
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statDay")}
                </Typography>
                <Typography sx={statValueSx}>
                  {formatMessage(t("trips.dayView.statDayValue"), {
                    index: day.dayIndex,
                    total: detail.trip.dayCount,
                  })}
                </Typography>
              </Box>
              <Box
                sx={{
                  ...statCellSx,
                  borderRight: { xs: "none", sm: "1px solid" },
                  borderBottom: { xs: "1px solid", sm: "none" },
                  borderColor: tokens.border,
                }}
                data-testid="day-stat-travel-time"
              >
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statTravelTime")}
                </Typography>
                <Typography sx={statValueSx}>{formatDurationSummary(totalTravelMinutes)}</Typography>
              </Box>
              <Box
                sx={{ ...statCellSx, borderRight: "1px solid", borderColor: tokens.border }}
                data-testid="day-stat-spend-today"
              >
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statSpendToday")}
                </Typography>
                <Typography sx={{ ...statValueSx, color: theme.palette.primary.main }}>
                  {formatCost(dayTotalCents)}
                </Typography>
              </Box>
              <Box sx={statCellSx}>
                {/* Story 6.21: the label is a constant, never the stay's name. Grid rows size to their
                    tallest cell, so a long accommodation name here grew the spend cell alongside it on a
                    phone. `statStay` still drives the value and its colour below - only the label stops
                    varying. The name is not lost: it is on the stay's own timeline card unconditionally,
                    and in the cost breakdown too when the stay has a recorded cost (that list filters on
                    `amountCents !== null`, so an un-priced stay shows the name once, not twice). */}
                <Typography variant="labelCaps" sx={statLabelSx}>
                  {t("trips.dayView.statCheckInGeneric")}
                </Typography>
                <Typography
                  data-testid="day-stat-check-in"
                  sx={{ ...statValueSx, color: statStay ? tokens.ink : theme.palette.warning.main }}
                >
                  {checkInStatValue}
                </Typography>
              </Box>
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" },
              gap: { xs: 2, md: 0 },
            }}
          >
            <Box sx={{ p: { xs: 0, md: "22px 28px 22px 0" }, minWidth: 0 }}>
              <Box
                data-testid="day-timeline-section-header"
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap={1}
                flexWrap="wrap"
                mb={1.5}
              >
                <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft }}>
                  {t("trips.dayView.timelineTitle")}
                </Typography>
                {/* One action, no wrapper. This header carried four buttons and wrapped to a second
                    line on a phone: Story 6.13 took the stay control out once both stay cards became
                    their own edit targets, and Story 6.15 took move and swap into the hero overflow.
                    What is left is the one action that belongs in a section header, because it
                    creates what the section lists. */}
                {canEditPlanning ? (
                  <Button size="small" variant="outlined" onClick={handleOpenAddPlan}>
                    {t("trips.plan.addPrimaryAction")}
                  </Button>
                ) : null}
              </Box>
              {!dayHasTimelineContent && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                  {t("trips.dayView.timelineEmpty")}
                </Typography>
              )}

              <Box sx={timelineRailSx}>
                <Box sx={{ position: "relative", mb: "12px" }} data-testid="timeline-previous-stay">
                  <Box aria-hidden sx={stayDotSx}>
                    <HouseIcon sx={{ color: theme.palette.primary.main }} />
                  </Box>
                  {/* Story 6.13: the card is the edit target, exactly as an activity card is - same
                      stretched `<button>`, same reason it is not `role="button"` on the card itself
                      (ARIA's Children Presentational: True would collapse the stay name, the pill and
                      the status chip into one announced label). The empty card is deliberately in
                      scope: with both stay buttons gone it is the only way left to add an
                      accommodation. */}
                  <Box
                    sx={{
                      ...tlCardSx,
                      backgroundColor: tokens.cardAlt,
                      position: "relative",
                      ...(canEditPreviousStay ? editableCardSx : {}),
                    }}
                  >
                  {canEditPreviousStay ? (
                    <Box
                      component="button"
                      type="button"
                      data-testid="timeline-previous-stay-edit-overlay"
                      aria-label={stayLabelFor(
                        previousStay?.name,
                        "trips.stay.editPreviousNightAria",
                        "trips.stay.addPreviousNightAria",
                      )}
                      aria-haspopup="dialog"
                      onClick={() => setPreviousStayOpen(true)}
                      sx={editOverlaySx}
                    />
                  ) : null}
                  <Box sx={{ ...tlCardTopSx, ...(canEditPreviousStay ? overlaidContentSx : {}) }}>
                    <Box sx={{ minWidth: 0 }}>
                      {renderTimePill(previousStayRange, previousStayRangeIsAssumed)}
                      <Typography variant="cardTitle" component="p" sx={{ color: tokens.ink, m: 0 }}>
                        {previousStay ? previousStay.name : t("trips.dayView.previousNightEmpty")}
                      </Typography>
                      <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                        {t("trips.dayView.previousNightTitle")}
                      </Typography>
                    </Box>
                    {canEditPreviousStay ? renderEditGlyph("timeline-previous-stay-edit-glyph") : null}
                  </Box>
                  {previousStay ? (
                    <Box
                      display="flex"
                      flexDirection="column"
                      gap={0.75}
                      sx={canEditPreviousStay ? overlaidContentSx : undefined}
                    >
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Chip
                          label={previousStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                          size="small"
                          color={previousStay.status === "booked" ? "success" : "default"}
                          variant="outlined"
                        />
                      </Box>
                      {/* Last child: DESIGN.md's media row runs along the bottom of the card - the
                          photo-strip leading, the doc-chips trailing. Both halves and their
                          pointer-events wrappers live in `renderMediaRow`. */}
                      {renderMediaRow(
                        previousAccommodationImages,
                        previousAccommodationDocuments,
                        previousStay.name,
                      )}
                    </Box>
                  ) : null}
                  </Box>
                </Box>

                {previousStaySegment && previousSegmentTarget
                  ? renderTravelSegment(previousStaySegment, previousSegmentTarget)
                  : null}

                {planItems.length === 0 ? (
                  <Box sx={{ position: "relative", mb: "12px" }}>
                    <Box aria-hidden sx={activityDotSx}>
                      <Box sx={neutralMarkerSx} />
                    </Box>
                    <Box sx={tlCardSx}>
                      <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                        {t("trips.dayView.activitiesEmpty")}
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  planItems.map((item, index) => {
                    const preview =
                      parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
                    const title = item.title?.trim() || preview;
                    const segmentItem: SegmentItem = {
                      id: item.id,
                      type: "dayPlanItem",
                      label: title,
                      location: item.location,
                      endTime: item.toTime ?? null,
                    };
                    const itemImages = planItemImagesById[item.id] ?? [];
                    // Every child of the head row is conditional, so the row itself has to be too.
                    const showCardHead = Boolean((item.fromTime && item.toTime) || item.costCents || canEditPlanning);
                    const nextPlanItem = planItems[index + 1];
                    const nextSegmentItem = nextPlanItem
                      ? {
                          id: nextPlanItem.id,
                          type: "dayPlanItem" as const,
                          label: getPlanItemLabel(nextPlanItem, index + 1),
                          location: nextPlanItem.location,
                          endTime: nextPlanItem.toTime ?? null,
                        }
                      : currentStaySegment;

                    return (
                      <Box key={item.id}>
                        <Box sx={{ position: "relative", mb: "12px" }}>
                          {/* AC2: one uniform neutral marker for every activity. The data model has no
                              activity-type field and EXPERIENCE.md forbids adding one for iconography. */}
                          <Box aria-hidden sx={activityDotSx}>
                            <Box sx={neutralMarkerSx} data-testid="activity-neutral-marker" />
                          </Box>
                          {/* The whole card is the edit target - there is no per-activity pencil to
                              hit - but the card element itself is not the control. A stretched
                              overlay is, and the difference is the point: `role="button"` on this
                              wrapper would make its contents *presentational* (ARIA gives `button`
                              Children Presentational: True), so the title, the notes, both pills and
                              the link would collapse into a single node announced as the card's
                              label. A viewer, who gets no role, would hear the whole card while a
                              contributor heard one line of it.
                              `editableCardSx` / `overlaidContentSx` are both empty without
                              planning rights, and the overlay does not render, so a reader gets a
                              plain inert card. */}
                          <Box
                            data-testid="day-plan-item-card"
                            sx={{ ...tlCardSx, position: "relative", ...editableCardSx }}
                          >
                            {canEditPlanning ? (
                              <Box
                                component="button"
                                type="button"
                                data-testid="day-plan-item-edit-overlay"
                                aria-label={editLabelFor(title)}
                                aria-haspopup="dialog"
                                onClick={() => handleOpenEditPlan(item)}
                                sx={editOverlaySx}
                              />
                            ) : null}
                            {/* tl-card-top's head row: time on the left, money and the edit glyph
                                right-aligned against it. The cost was previously in a trailing block
                                beside the card body, where it read as a footnote to the description
                                rather than as a property of the time slot.

                                Rendered only when it holds something. All three children are
                                conditional, and for a reader looking at an untimed, cost-free
                                activity all three are absent - an unconditional head would open that
                                card with a blank band the width of `tlCardSx`'s 12px row gap. */}
                            {showCardHead ? (
                              <Box data-testid="day-plan-item-head" sx={{ ...tlCardTopSx, ...overlaidContentSx }}>
                                <Box sx={{ minWidth: 0 }}>
                                  {item.fromTime && item.toTime ? (
                                    <Box sx={timePillSx}>{`${item.fromTime} - ${item.toTime}`}</Box>
                                  ) : null}
                                </Box>
                                <Box display="flex" alignItems="center" gap={0.75}>
                                  {/* Truthy, not `typeof === "number"`: a recorded 0 renders nothing.
                                      As plain 13px text a "€0.00" was a footnote; as a filled accent
                                      pill it would be the loudest thing in the card head, announcing
                                      a cost on an activity that has none. */}
                                  {item.costCents ? (
                                    <Box sx={costPillSx} data-testid="day-plan-item-cost">
                                      {formatCost(item.costCents)}
                                    </Box>
                                  ) : null}
                                  {canEditPlanning ? renderEditGlyph("day-plan-item-edit-glyph") : null}
                                </Box>
                              </Box>
                            ) : null}
                            <Box display="flex" flexDirection="column" gap={0.75} sx={{ minWidth: 0, ...overlaidContentSx }}>
                              <Typography variant="cardTitle" component="p" sx={{ color: tokens.ink, m: 0 }}>
                                {title}
                              </Typography>
                              {/* The notes take their pointer events back, which is the one place the
                                  stretched overlay costs something real. Everything else on the card
                                  passes clicks down to it, and a layer that does that cannot be
                                  drag-selected either - the drag never reaches the text and the
                                  mouse-up lands on the overlay, so the reader gets an edit dialog
                                  instead of a selection. Measured before deciding: selection came back
                                  empty. This block is the one that holds addresses and booking
                                  references, so it stays selectable and copyable at the price of not
                                  being part of the click target. */}
                              <Box sx={{ pointerEvents: "auto" }} data-testid="day-plan-item-notes">
                                <PlanItemRichContent contentJson={item.contentJson} fallbackText={preview} />
                              </Box>
                              {item.linkUrl && isSafeLink(item.linkUrl) ? (
                                <Button
                                  component="a"
                                  href={item.linkUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  variant="text"
                                  size="small"
                                  // Opens the link, and only the link. No `stopPropagation` needed:
                                  // this renders as an `<a>`, so `overlaidContentSx` restores its
                                  // pointer events and it sits above the overlay - the click lands
                                  // here and the overlay never sees it, on pointer or on keyboard.
                                  sx={{ p: 0, minWidth: "auto", alignSelf: "flex-start" }}
                                >
                                  {t("trips.plan.linkOpen")}
                                </Button>
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  {t("trips.plan.noLink")}
                                </Typography>
                              )}
                              {/* Last child: DESIGN.md's media row runs along the bottom of the card -
                                  the photo-strip leading, the doc-chips trailing. The strip is shared
                                  with four other call sites, so its pointer-events wrapper lives in
                                  `renderMediaRow` rather than inside it.

                                  `altPrefix` is the activity's own title, not the section heading. It
                                  is now a control name, not just an `<img alt>` - a day with three
                                  photo-bearing activities would otherwise present nine buttons sharing
                                  three names, and AC7 wants a name that says which photo it opens.
                                  Capped, because an untitled activity falls back to its whole note.
                                  The chips need no such prefix: a document's own name is its label. */}
                              {renderMediaRow(itemImages, planItemDocumentsById[item.id] ?? [], capLabel(title))}
                            </Box>
                          </Box>
                        </Box>
                        {nextSegmentItem ? renderTravelSegment(segmentItem, nextSegmentItem) : null}
                      </Box>
                    );
                  })
                )}

                <Box sx={{ position: "relative", mb: "12px" }} data-testid="timeline-current-stay">
                  <Box
                    aria-hidden
                    sx={
                      isDayGap
                        ? { ...stayDotSx, backgroundColor: tokens.warnBg, borderColor: tokens.warnBorder }
                        : stayDotSx
                    }
                  >
                    {isDayGap ? (
                      <WarningTriangleIcon sx={{ color: theme.palette.warning.main }} />
                    ) : (
                      <HouseIcon sx={{ color: theme.palette.primary.main }} />
                    )}
                  </Box>
                  {/* Story 6.13: same overlay as the activity and previous-night cards, wired to
                      `setStayOpen` - *this* day's accommodation. The two stay dialogs look alike and
                      edit different days, so crossing the wires here would be a silent data bug no
                      visual check catches. */}
                  <Box
                    sx={{
                      ...(isDayGap
                        ? { ...tlCardSx, backgroundColor: tokens.warnBg, borderColor: tokens.warnBorder }
                        : { ...tlCardSx, backgroundColor: tokens.cardAlt }),
                      position: "relative",
                      ...editableCardSx,
                      // `editableCardSx` hovers every card to `tokens.cardAlt`, which on a flagged day
                      // would repaint the warn surface away under the pointer - dropping one of
                      // DESIGN.md's warn cues exactly while the user is aiming at the card to fix what
                      // it is flagging. Media queries add no specificity, so this later, unwrapped
                      // `&:hover` wins on source order; the border still goes primary, so hover
                      // feedback survives.
                      ...(isDayGap && canEditPlanning ? { "&:hover": { backgroundColor: tokens.warnBg } } : {}),
                    }}
                  >
                  {canEditPlanning ? (
                    <Box
                      component="button"
                      type="button"
                      data-testid="timeline-current-stay-edit-overlay"
                      aria-label={stayLabelFor(
                        currentStay?.name,
                        "trips.stay.editCurrentNightAria",
                        "trips.stay.addCurrentNightAria",
                      )}
                      aria-haspopup="dialog"
                      onClick={() => setStayOpen(true)}
                      sx={editOverlaySx}
                    />
                  ) : null}
                  <Box sx={{ ...tlCardTopSx, ...overlaidContentSx }}>
                    <Box sx={{ minWidth: 0 }}>
                      {renderTimePill(currentStayRange, currentStayRangeIsAssumed)}
                      <Typography variant="cardTitle" component="p" sx={{ color: tokens.ink, m: 0 }}>
                        {currentStay ? currentStay.name : t("trips.dayView.currentNightEmpty")}
                      </Typography>
                      <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                        {t("trips.dayView.currentNightTitle")}
                      </Typography>
                    </Box>
                    {canEditPlanning ? (
                      <Box display="flex" alignItems="center" gap={0.75}>
                        {/* The one nested control in either stay card. It needs no `stopPropagation`:
                            `overlaidContentSx` gives real `<button>`s their pointer events back and
                            raises them above the overlay, so the click lands here and the overlay
                            never sees it - on pointer and on keyboard alike.

                            The wrapper covers the one state where that is not enough. While the copy
                            is in flight the button is `disabled`, and MUI's ButtonBase sets
                            `&.Mui-disabled { pointer-events: none }` at a higher specificity than
                            `overlaidContentSx`'s `& button` opt-in. The button then stops hit-testing
                            and the second, impatient click falls straight through to the overlay,
                            opening this day's stay editor on top of a copy that is about to rewrite
                            the same record. A wrapper that keeps its own pointer events absorbs it. */}
                        {canCopyPreviousStay ? (
                          <Box sx={{ pointerEvents: "auto", display: "flex" }}>
                            <Button size="small" variant="text" disabled={copyingStay} onClick={() => void handleCopyPreviousStay()}>
                              {t("trips.stay.copyPreviousAction")}
                            </Button>
                          </Box>
                        ) : null}
                        {renderEditGlyph("timeline-current-stay-edit-glyph")}
                      </Box>
                    ) : null}
                  </Box>
                  {/* State Patterns: on a flagged day the accommodation slot names what is missing, in
                      warn colour paired with an icon and real text - never colour alone. */}
                  {isDayGap ? (
                    <Box
                      data-testid="day-detail-gap-pill"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        alignSelf: "flex-start",
                        gap: 0.75,
                        backgroundColor: tokens.warnBg,
                        color: theme.palette.warning.main,
                        px: 1.25,
                        py: 0.75,
                        borderRadius: "6px",
                        fontSize: "11.5px",
                        fontWeight: 700,
                        ...overlaidContentSx,
                      }}
                    >
                      <WarningTriangleIcon />
                      {t("trips.timeline.noAccommodation")}
                    </Box>
                  ) : null}
                  {currentStay ? (
                    <Box display="flex" flexDirection="column" gap={0.75} sx={overlaidContentSx}>
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Chip
                          label={currentStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                          size="small"
                          color={currentStay.status === "booked" ? "success" : "default"}
                          variant="outlined"
                        />
                        {typeof currentStay.costCents === "number" ? (
                          <Typography sx={tlCostSx}>{formatCost(currentStay.costCents)}</Typography>
                        ) : null}
                      </Box>
                      {/* Last child: DESIGN.md's media row runs along the bottom of the card - the
                          photo-strip leading, the doc-chips trailing. Both halves and their
                          pointer-events wrappers live in `renderMediaRow`. */}
                      {renderMediaRow(accommodationImages, accommodationDocuments, currentStay.name)}
                    </Box>
                  ) : null}
                  </Box>
                </Box>
              </Box>
            </Box>

            <Box
              sx={{
                p: { xs: 0, md: "22px 0 22px 22px" },
                borderLeft: { xs: "none", md: "1px solid" },
                borderColor: tokens.border,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                minWidth: 0,
              }}
            >
              <Box sx={cardSx}>
                <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft, display: "block", mb: 1.25 }}>
                  {t("trips.dayView.costCardTitle")}
                </Typography>
                <Typography
                  variant="metricLg"
                  data-testid="day-cost-total"
                  sx={{ color: tokens.ink, fontVariantNumeric: "tabular-nums" }}
                >
                  {formatCost(dayTotalCents)}
                </Typography>
                {/* 12px/600 per Task 6; body2 is 11.5px, which quietly undershot every other prescribed
                    size on this card. */}
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: tokens.inkSoft, mb: 1.5, display: "block" }}>
                  {formatMessage(t("trips.dayView.costCardSubtitle"), { index: day.dayIndex })}
                </Typography>

                {knownBudgetEntries.length === 0 ? (
                  <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                    {t("trips.dayView.budgetEmpty")}
                  </Typography>
                ) : (
                  // A real ul/li - the bordered rows are presentational and must not cost the breakdown
                  // its list semantics. :last-child rather than a per-row hardcode, since this list is
                  // dynamic and a hardcode would break the moment an entry is added or removed.
                  <Box
                    component="ul"
                    sx={{ listStyle: "none", m: 0, p: 0, "& > li:last-child": { borderBottom: "none" } }}
                  >
                    {knownBudgetEntries.map((entry) => (
                      <Box
                        component="li"
                        key={entry.id}
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 1.5,
                          py: "7px",
                          borderBottom: "1px solid",
                          borderColor: tokens.border,
                        }}
                      >
                        <Typography sx={{ fontSize: "12.5px", fontWeight: 600, color: tokens.ink, overflowWrap: "anywhere" }}>
                          {entry.label}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: "12.5px",
                            fontWeight: 700,
                            color: tokens.ink,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatCost(entry.amountCents)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              <TripDayMapPanel
                loading={loading}
                points={mapData.points}
                missingLocations={mapData.missingLocations}
                polylinePositions={routePolyline.length >= 2 ? routePolyline : mapData.points.map((point) => point.position)}
                routingUnavailable={routingUnavailable}
                expandHref={day ? `/trips/${tripId}/days/${day.id}/map` : undefined}
                onExpandClick={handleMapExpand}
                onMarkerClick={handleMapMarkerClick}
              />
              {isOwner ? (
                <TripDayBucketListPanel
                  items={bucketItems}
                  loading={bucketLoading}
                  error={bucketError}
                  onAddToDay={handleAddBucketToDay}
                />
              ) : null}
            </Box>
          </Box>

          <TripAccommodationDialog
            open={stayOpen}
            tripId={tripId}
            stayType="current"
            day={day}
            onClose={() => setStayOpen(false)}
            onSaved={() => {
              setStayOpen(false);
              loadDay();
            }}
          />
          <TripAccommodationDialog
            open={previousStayOpen}
            tripId={tripId}
            stayType="previous"
            day={previousDay}
            onClose={() => setPreviousStayOpen(false)}
            onSaved={() => {
              setPreviousStayOpen(false);
              loadDay();
            }}
          />
          <TripDayTravelSegmentDialog
            open={segmentDialogOpen}
            tripId={tripId}
            tripDayId={day?.id ?? null}
            fromItem={activeSegmentFrom}
            toItem={activeSegmentTo}
            segment={activeSegment}
            onClose={() => {
              setSegmentDialogOpen(false);
              setActiveSegment(null);
              setActiveSegmentFrom(null);
              setActiveSegmentTo(null);
            }}
            onSaved={(segment) => {
              handleTravelSegmentSaved(segment);
              setActiveSegment(null);
              setActiveSegmentFrom(null);
              setActiveSegmentTo(null);
            }}
          />
          <TripDayPlanDialog
            open={planDialogMode !== null}
            mode={planDialogMode ?? "add"}
            tripId={tripId}
            day={day}
            item={selectedPlanItem}
            prefill={planDialogPrefill}
            onDelete={handleDeletePlan}
            /* Story 6.23 AC8: both are withheld from a viewer, so the action is absent rather than
               disabled — the same way `canEditPlanning` already gates every other write here. */
            moveTargetDays={canEditPlanning ? planMoveTargetDays : undefined}
            onMove={canEditPlanning ? handleMovePlanItem : undefined}
            onClose={handlePlanDialogClose}
            onSaved={handlePlanDialogSaved}
          />
          <Dialog open={transferMode !== null} onClose={transferGuard.requestClose} fullWidth maxWidth="sm">
            <DialogTitleWithClose
              label={t("common.close")}
              onClose={transferGuard.requestClose}
              disabled={transferSubmitting}
            >
              {transferMode === "move" ? t("trips.dayTransfer.moveAction") : t("trips.dayTransfer.swapAction")}
            </DialogTitleWithClose>
            <DialogContent>
              <Box mt={0.5} display="flex" flexDirection="column" gap={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {transferMode === "move" ? t("trips.dayTransfer.moveDescription") : t("trips.dayTransfer.swapDescription")}
                </Typography>
                <TextField
                  select
                  label={t("trips.dayTransfer.targetLabel")}
                  value={transferTargetDayId}
                  onChange={(event) => setTransferTargetDayId(event.target.value)}
                  fullWidth
                  SelectProps={{ native: true }}
                >
                  <option value="" />
                  {transferTargetOptions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {formatMessage(t("trips.dayView.title"), { index: candidate.dayIndex })} · {formatDate(candidate.date)}
                    </option>
                  ))}
                </TextField>
                {transferNeedsOverwriteWarning ? (
                  <Alert severity="warning">{t("trips.dayTransfer.moveOverwriteWarning")}</Alert>
                ) : null}
              </Box>
            </DialogContent>
            {/* Story 6.25 AC2 — a form dialog's footer keeps only the confirming action. */}
            <DialogActions>
              <Button
                onClick={() => void handleSubmitTransfer()}
                variant="contained"
                disabled={transferSubmitting || !transferTargetDayId}
              >
                {transferMode === "move" ? t("trips.dayTransfer.confirmMove") : t("trips.dayTransfer.confirmSwap")}
              </Button>
            </DialogActions>
          </Dialog>
          <DiscardChangesDialog {...transferGuard.dialogProps} />
          <DialogShell
            open={dayMetaOpen}
            onClose={dayMetaGuard.requestClose}
            title={t("trips.dayImage.dialogTitle")}
            width={460}
            // Save and Remove are disabled while `dayImageSaving`; the dismissal gestures follow.
            disableDismiss={dayImageSaving}
            closeLabel={t("common.close")}
            footer={
              <>
                {/* No `color="error"` on the destructive action (AC8) — and none was there to begin
                    with; this keeps the text variant explicit so a later edit does not add one. */}
                <Button
                  variant="text"
                  onClick={() => void handleRemoveDayImage()}
                  disabled={dayImageSaving || !hasDayImage}
                  sx={{ color: tokens.ink }}
                >
                  {t("trips.dayImage.removeAction")}
                </Button>
                {/* Story 6.25 AC2. `Abbrechen` left for the head's `✕`; Remove is not a dismissal, so
                    the footer still holds two controls and `space-between` still earns its place. */}
                <Box sx={{ display: "flex", flexDirection: { xs: "column-reverse", sm: "row" }, gap: "10px" }}>
                  <Button onClick={() => void handleSaveDayImage()} variant="contained" disabled={dayImageSaving}>
                    {t("trips.dayImage.saveAction")}
                  </Button>
                </Box>
              </>
            }
            footerSx={{ justifyContent: "space-between" }}
          >
            <Box display="flex" flexDirection="column" gap="18px">
              <PhotoUploadField
                id={`${dayMetaIdPrefix}-image`}
                label={t("trips.dayImage.fileLabel")}
                zoneTitle={t("trips.gallery.uploadZoneTitle")}
                // The size limit is this surface's own (15MB) — deliberately not a shared key: the
                // hero field says 5MB and the galleries say nothing. Reconciling the three is a
                // validation question, not a visual one.
                zoneHint={t("trips.dayImage.fileHelper")}
                accept={IMAGE_UPLOAD_ACCEPT}
                // Locked while a save is in flight, matching the Remove and Save buttons below and
                // the two galleries' `disabled={galleryBusy}` — otherwise a file picked mid-request
                // lands in `dayImageFile` behind the response that is about to arrive.
                disabled={dayImageSaving}
                onFilesSelected={(files) => setDayImageFile(files[0] ?? null)}
                selectionLabel={dayImageFile?.name}
                emptyLabel={hasDayImage ? undefined : t("trips.dayImage.empty")}
                /*
                  AC7: before this, the dialog rendered only the selected file's *name*, so a
                  non-sighted owner had no way to confirm an upload had landed. The current image is
                  meaning-bearing here (DESIGN.md.Photo Alt-Text), so it gets a real alt string and
                  no remove affordance — removal is the footer's explicit action, which also clears
                  the note-side state.
                */
                images={
                  hasDayImage && dayImagePreviewSrc
                    ? [
                        {
                          key: "current-day-image",
                          imageUrl: dayImagePreviewSrc,
                          alt: t("trips.dayImage.previewAlt"),
                        },
                      ]
                    : []
                }
              />
              <FormField
                id={`${dayMetaIdPrefix}-note`}
                label={t("trips.dayImage.noteLabel")}
                value={dayNoteDraft}
                onChange={(event) => setDayNoteDraft(event.target.value)}
                hint={t("trips.dayImage.noteHelper")}
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: 280 } }}
              />
            </Box>
          </DialogShell>
          <DiscardChangesDialog {...dayMetaGuard.dialogProps} />
          <FullscreenPhotoViewer
            open={Boolean(fullscreenPhotos)}
            images={fullscreenPhotos?.images ?? []}
            startIndex={fullscreenPhotos?.index ?? 0}
            onClose={() => setFullscreenPhotos(null)}
          />
          {/* The `doc-chip` row's `+N` surface (Story 9.1 AC5, and Tommy's 2026-08-05 decision: a
              menu, not a `DialogShell` list). One mount for all three `tl-card`s, the way one
              `FullscreenPhotoViewer` serves every photo strip - and pointedly *not* that viewer, which
              belongs to the trip's photographs. An image document must never enter it (AC6), which is
              why every entry below is an anchor and nothing here has a handler that could route one
              into a viewer.

              The list is the entry's whole collection, including the three names already on the card:
              the strip's `+N` opens the full set at the first unshown index, and a list that showed
              only the tail would be a different affordance wearing the same glyph. */}
          <Menu
            anchorEl={documentMenu?.anchorEl ?? null}
            open={Boolean(documentMenu)}
            onClose={() => setDocumentMenu(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            // The menu is named, not the trigger: the trigger is a bare `+N` whose own accessible name
            // ("Show 2 more documents") describes the act of opening rather than what was opened, so
            // `aria-labelledby` pointing back at it would announce the list as an instruction.
            slotProps={{ list: { "aria-label": t("trips.documents.overflowTitle") } }}
          >
            {(documentMenu?.documents ?? []).map((documentRow, index) => (
              <MenuItem
                key={documentRow.id}
                component="a"
                href={documentRow.documentUrl}
                target="_blank"
                rel="noreferrer noopener"
                // The one place in this file an item carries an `aria-label`, and it earns it: two
                // documents on one entry may share a file name, and two menu items with the same
                // accessible name is the defect Story 5.11's review found on two comboboxes. The
                // visible label is still contained in the name, so a voice-control user saying what
                // they read still matches (WCAG 2.5.3) - which is what the day-hero menu's blanket
                // "no aria-label" rule is protecting, and it is not violated here.
                aria-label={formatMessage(t("trips.documents.openDocument"), {
                  name: documentDisplayName(documentRow.fileName),
                  index: index + 1,
                  total: documentMenu?.documents.length ?? 0,
                })}
                onClick={() => setDocumentMenu(null)}
                // `&&` rather than a bare `minHeight`, unlike `DAY_MENU_ITEM_SX` above: MenuItem's own
                // root sets `minHeight: 48` and then resets it to `auto` above `sm`, and DW-180
                // records that reset winning against a plain `sx` twice. The bump is cheap here and
                // the 44px floor is not negotiable at either width.
                sx={{ "&&": { minHeight: 44 } }}
              >
                <Typography>{documentDisplayName(documentRow.fileName)}</Typography>
              </MenuItem>
            ))}
          </Menu>
          {/* Story 6.25 AC1 — a read-only popup, no footer, so the `✕` is its only visible dismissal. */}
          <Dialog open={Boolean(mapDialogItem)} onClose={() => setMapDialogItem(null)} fullWidth maxWidth="sm">
            <DialogTitleWithClose label={t("common.close")} onClose={() => setMapDialogItem(null)}>
              {mapDialogItem?.label ?? ""}
            </DialogTitleWithClose>
            <DialogContent>
              {mapDialogItem ? (
                <Box display="flex" flexDirection="column" gap={1.5}>
                  {mapDialogItem.kind === "planItem" ? (
                    <>
                      <PlanItemRichContent
                        contentJson={mapDialogItem.planItem.contentJson}
                        fallbackText={parsePlanText(mapDialogItem.planItem.contentJson) || mapDialogItem.label}
                      />
                      <MiniImageStrip
                        images={planItemImagesById[mapDialogItem.planItem.id] ?? []}
                        altPrefix={capLabel(mapDialogItem.label)}
                        onImageClick={(index) =>
                          setFullscreenPhotos({
                            images: toViewerImages(
                              planItemImagesById[mapDialogItem.planItem.id] ?? [],
                              capLabel(mapDialogItem.label),
                            ),
                            index,
                          })
                        }
                      />
                    </>
                  ) : (
                    <>
                      {mapDialogItem.stay?.notes ? (
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          {mapDialogItem.stay.notes}
                        </Typography>
                      ) : null}
                      <MiniImageStrip
                        images={
                          mapDialogItem.kind === "previousStay" ? previousAccommodationImages : accommodationImages
                        }
                        altPrefix={capLabel(mapDialogItem.label)}
                        onImageClick={(index) =>
                          setFullscreenPhotos({
                            images: toViewerImages(
                              mapDialogItem.kind === "previousStay"
                                ? previousAccommodationImages
                                : accommodationImages,
                              capLabel(mapDialogItem.label),
                            ),
                            index,
                          })
                        }
                      />
                    </>
                  )}
                </Box>
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      )}
    </Box>
  );
}
