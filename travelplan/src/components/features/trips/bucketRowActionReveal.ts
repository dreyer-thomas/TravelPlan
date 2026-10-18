import type { Theme } from "@mui/material/styles";

/**
 * Story 14.2 (Tommy). The class every bucket row's action button carries (edit, delete, add to day), so
 * the row's reveal below can target them.
 */
export const BUCKET_ROW_ACTION_CLASS = "bucket-row-action";

/**
 * Story 14.2 (Tommy): a bucket row's actions behave like the activity card's edit glyph
 * (`editableCardSx` in `TripDayView.tsx`), on the overview and on Day Detail alike.
 *
 * - On a pointer device they appear on hover over the row.
 * - On a touch device there is no hover, so they are always there. A touchscreen laptop reports
 *   `hover: hover`, so `any-pointer: coarse` keeps them visible there too. It must follow the hover
 *   block, because media queries add no specificity and source order decides.
 * - They are real buttons with their own tab stops, so a focused one shows itself.
 *
 * `opacity`, not conditional rendering: hidden buttons keep their space, so nothing shifts on hover.
 * Spread into the row's `sx`.
 */
export const bucketRowActionRevealSx = (theme: Theme) => ({
  "@media (hover: hover)": {
    [`& .${BUCKET_ROW_ACTION_CLASS}`]: {
      opacity: 0,
      transition: theme.transitions.create("opacity", { duration: theme.transitions.duration.shortest }),
    },
    [`&:hover .${BUCKET_ROW_ACTION_CLASS}`]: { opacity: 1 },
  },
  "@media (hover: none)": {
    [`& .${BUCKET_ROW_ACTION_CLASS}`]: { opacity: 1 },
  },
  "@media (any-pointer: coarse)": {
    [`& .${BUCKET_ROW_ACTION_CLASS}`]: { opacity: 1 },
  },
  [`& .${BUCKET_ROW_ACTION_CLASS}:focus-visible`]: { opacity: 1 },
});
