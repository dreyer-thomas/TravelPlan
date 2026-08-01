import { SvgIcon } from "@mui/material";

/**
 * Shared presentational primitives for the redesigned trip surfaces (Epic 7).
 *
 * Every icon here is `aria-hidden` by default: across Trip Overview and Day Detail its meaning is
 * always duplicated by adjacent visible text (place name, transport label, "open day"), which is the
 * naming rule EXPERIENCE.md's Accessibility Floor sets. An icon that ever becomes the sole carrier of
 * information needs a real `aria-label` instead - none currently is.
 */

type IconProps = { sx?: object };

export function HouseIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <path
        d="M3 21V8l9-5 9 5v13"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 21v-7h6v7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

export function WarningTriangleIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <path d="M12 9v4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M12 17h.01" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path
        d="M10.3 3.9 2.5 18a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

export function ChevronRightIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 18, ...sx }}>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

/**
 * The same path as `ChevronRightIcon`, rotated 90deg via `transform`, rather than duplicating a
 * near-identical `d=` string. A second glyph would drift the moment someone tweaked the corner
 * radius on the right chevron and forgot the down copy - see the same convention already applied for
 * `bucket-add` reusing the `PlusIcon` glyph.
 */
export function ChevronDownIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 18, ...sx }}>
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="rotate(90 12 12)"
      />
    </SvgIcon>
  );
}

/**
 * Chevron-up (open state) - the mirror of `ChevronDownIcon`, same base path rotated -90 (270).
 */
export function ChevronUpIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 18, ...sx }}>
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="rotate(-90 12 12)"
      />
    </SvgIcon>
  );
}

/** Pencil (row-level edit). Stroke-based to match the rest of the icon set. */
export function PencilIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <path
        d="M4 20h4L20 8l-4-4L4 16v4z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 6l4 4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </SvgIcon>
  );
}

/** Trash (row-level delete). Stroke-based to match the rest of the icon set. */
export function TrashIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path
        d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M14 11v6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </SvgIcon>
  );
}

export function CheckIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 13, ...sx }}>
      <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

export function ClockIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 13, ...sx }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M12 7v5l3.2 2" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

export function CalendarIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 13, ...sx }}>
      <rect x="3" y="4" width="18" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth={2} />
      <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth={2} />
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </SvgIcon>
  );
}

export function PlusIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </SvgIcon>
  );
}

/** `.photo-upload-icon`'s glyph (`mockups/forms-authoring.html:731`). Used by `PhotoUploadField`. */
export function UploadIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 20, ...sx }}>
      <path d="M12 16V4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M6 10l6-6 6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </SvgIcon>
  );
}

/** The `×` inside `.photo-thumb .remove-x`. Decorative — the button around it carries the name. */
export function CloseXIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 11, ...sx }}>
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
    </SvgIcon>
  );
}

export function ShareGlyphIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <line x1="8.3" y1="10.7" x2="15.7" y2="6.3" stroke="currentColor" strokeWidth={2} />
      <line x1="8.3" y1="13.3" x2="15.7" y2="17.7" stroke="currentColor" strokeWidth={2} />
    </SvgIcon>
  );
}

// Transport glyphs. Unlike activity markers - which must stay one uniform neutral dot, because the
// data model has no activity-type field and EXPERIENCE.md forbids inventing one - these are keyed off
// TravelSegment.transportType, a real enum, so per-type iconography is legitimate here.
export function CarIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 14, ...sx }}>
      <path
        d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 11h18v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="16.5" r="1.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <circle cx="16.5" cy="16.5" r="1.5" fill="none" stroke="currentColor" strokeWidth={2} />
    </SvgIcon>
  );
}

export function ShipIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 14, ...sx }}>
      <path
        d="M3 18c1.5 0 1.5 1.5 3 1.5S7.5 18 9 18s1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 3 1.5 1.5-1.5 3-1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 15l1.2-4.4A1.5 1.5 0 0 1 7.6 9.5h8.8a1.5 1.5 0 0 1 1.4 1.1L19 15"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9.5V4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </SvgIcon>
  );
}

export function PlaneIcon({ sx }: IconProps) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 14, ...sx }}>
      <path
        d="M21 15.5 3 10V7l2 .6L6.5 10l4.5 1.3V5.2a1.6 1.6 0 0 1 3.2 0v6.9l6.3 1.8v1.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 19.5h8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </SvgIcon>
  );
}

export function transportIconFor(transportType: "car" | "ship" | "flight") {
  if (transportType === "ship") return ShipIcon;
  if (transportType === "flight") return PlaneIcon;
  return CarIcon;
}

/**
 * DESIGN.md.components.hero-photo.scrim - four stops, not three.
 *
 * The top stop (~0.26 rather than fully transparent) exists because a real, user-supplied trip photo
 * can put bright content (sky, snow, sunlit rock) directly behind breadcrumb/kicker text that has no
 * button background of its own. Both the trip hero and the day hero must carry the full four stops.
 */
export const HERO_SCRIM =
  "linear-gradient(to top, rgba(20,18,14,.88) 0%, rgba(20,18,14,.54) 38%, rgba(20,18,14,.10) 66%, rgba(20,18,14,.26) 100%)";

/** Translucent chrome for controls that sit on top of a hero photo (`.share-btn.on-photo`). */
export const ON_PHOTO_CHROME = {
  backgroundColor: "rgba(255,255,255,.18)",
  border: "1px solid rgba(255,255,255,.55)",
  color: "#FFFFFF",
  "&:hover": { backgroundColor: "rgba(255,255,255,.28)" },
} as const;

/**
 * Warn-row background for a row whose plan has holes.
 *
 * `DESIGN.md.components.day-row.bg-gap` and `.trip-row.bg-gap` are the same value, so Trip Overview's
 * day rows and the Trips List's trip rows share this one constant rather than each declaring a copy.
 * Deliberately not `tokens.warnBg` (#F6ECE0) - the mockups use a lighter tint for a whole-row fill
 * than for a pill fill. See `mockups/trips-list-share-login.html:174`.
 */
export const ROW_GAP_BG = "#FBF6EE";

/**
 * The neutral pill track for the `upcoming` and `past` trip-status states.
 *
 * The one value on this screen with no token behind it (`theme.ts` has no equivalent). Neither
 * `cardAlt` nor `warnBg` substitutes: both read as a different state. See
 * `mockups/trips-list-share-login.html:210-211`.
 */
export const NEUTRAL_PILL_BG = "#F1ECE1";

/**
 * Quoted and percent-escaped. An unquoted url() breaks on any path containing a space or ")", and
 * trip/day image URLs arrive as free-form strings through import, which would otherwise let imported
 * data close the url() and inject arbitrary CSS declarations into the page.
 */
export const toCssUrl = (src: string) => `url("${encodeURI(src).replace(/"/g, "%22")}")`;
