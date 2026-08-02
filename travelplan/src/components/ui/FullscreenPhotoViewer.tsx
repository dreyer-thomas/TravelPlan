"use client";

import { useState } from "react";
import { Box, Dialog, IconButton, Typography } from "@mui/material";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseXIcon,
  ON_PHOTO_CHROME,
} from "@/components/features/trips/TripIcons";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

/**
 * The one fullscreen photo viewer (Story 6.12). Lives beside `DialogShell.tsx` because this is the
 * shared-chrome directory, and it replaces four byte-identical inline copies that had drifted into a
 * single shape with three defects:
 *
 * 1. **Two stacked dark surfaces.** Those copies made the paper transparent so MUI's own backdrop
 *    (`rgba(0,0,0,0.5)`) showed through, then painted `rgba(0,0,0,0.85)` on a `DialogContent` sitting
 *    on top of it. Wherever the inner fill failed to reach, the outer one read as a lighter rim.
 *    The fix taken here is **`fullScreen` + a dark paper**: the paper is the only darkened surface,
 *    it covers the viewport by MUI's own `paperFullScreen` rules, and MUI's backdrop is made
 *    transparent so nothing is stacked underneath it. (The alternative — a styled backdrop with a
 *    transparent paper — works too; this one keeps the image, the controls and the fill in one box.)
 * 2. **`100vw`.** It includes the scrollbar width on pointer devices, so the inner surface was wider
 *    than the visible area. Nothing here is sized in `100vw`; the paper's own `100%` is the viewport
 *    minus the scrollbar, and the image is bounded by `100%` of the paper.
 * 3. **Any key closed it.** Those copies carried `onKeyDown={() => setFullscreenImage(null)}` on the
 *    `Dialog`, which fired for Tab and the arrows as well as Escape. Only Escape closes now (via
 *    MUI's own `onClose` reason), and the arrows page.
 *
 * The viewer takes the whole collection plus a starting index rather than a single URL, which is what
 * makes the images `MiniImageStrip` does not render reachable at all (DW-30).
 */

/** One image in the collection the viewer pages through. */
export type FullscreenPhoto = {
  /** React key — the image id, or a stable synthetic key for a single-image surface. */
  key: string;
  imageUrl: string;
  /** Travels with the image: the alt announced is the one currently shown, not the one opened with. */
  alt: string;
};

export type FullscreenPhotoViewerProps = {
  open: boolean;
  /** The whole collection, not the clicked image. */
  images: FullscreenPhoto[];
  /** Where to open. Re-applied every time `open` flips to true or the caller picks a new image. */
  startIndex: number;
  onClose: () => void;
};

/**
 * Slightly darker than the old copies' `rgba(0,0,0,0.85)` because it is now the *only* fill: with the
 * backdrop transparent there is no second layer adding to it.
 */
const VIEWER_SURFACE = "rgba(0, 0, 0, 0.92)";

export default function FullscreenPhotoViewer({ open, images, startIndex, onClose }: FullscreenPhotoViewerProps) {
  const { t } = useI18n();
  const [index, setIndex] = useState(startIndex);

  // Reset-on-prop-change during render, which is what React prescribes for derived state — not a
  // `useEffect` that calls `setState` (that trips `react-hooks`' set-state-in-effect rule, and it
  // paints the previous image for a frame first).
  //
  // `images` rides along because some call sites hold the collection in the same state object as the
  // open flag (`fullscreenPhotos?.images ?? []`), so closing empties it in the very update that flips
  // `open` to false — while MUI keeps the dialog mounted through its exit transition. Carrying the
  // previous collection forward on close is what makes the photo fade out instead of vanishing and
  // leaving a blank dark panel behind, and it is why the close branch keeps `lastOpened.images`.
  // Written as one guarded state update rather than a ref so it never runs on an ordinary re-render:
  // several callers build `images` inline, and identity alone would be a render loop.
  const [lastOpened, setLastOpened] = useState({ open, startIndex, images });
  if (lastOpened.open !== open || lastOpened.startIndex !== startIndex) {
    setLastOpened({ open, startIndex, images: open ? images : lastOpened.images });
    setIndex(startIndex);
  }

  const shown = open || images.length > 0 ? images : lastOpened.images;
  const total = shown.length;

  // A collection can shrink under an open viewer (a delete behind it), so the index is clamped on
  // read rather than trusted.
  const safeIndex = total === 0 ? 0 : Math.min(Math.max(index, 0), total - 1);
  const current: FullscreenPhoto | undefined = shown[safeIndex];

  // Wrapping, applied identically at both ends: next from the last image lands on the first, previous
  // from the first lands on the last. Chosen over stopping so neither control is ever disabled —
  // a disabled control is a focus stop that does nothing, and the strip's "+N" entry point routinely
  // opens at the far end of the collection.
  //
  // Stepped through the functional updater rather than off the render-time `safeIndex`, so two paging
  // actions coalesced into one React batch — key-repeat on ArrowRight, a double-click on Next — do not
  // both compute from the same stale index and advance only one image.
  const goTo = (step: number) => {
    if (total === 0) {
      return;
    }
    setIndex((previous) => {
      const from = Math.min(Math.max(previous, 0), total - 1);
      return (((from + step) % total) + total) % total;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape is deliberately absent: MUI's `Dialog` already reports it through `onClose`. Every other
    // key — Tab included — falls through untouched, which is what keeps focus inside the viewer.
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(1);
    }
  };

  const controlSx = {
    ...ON_PHOTO_CHROME,
    position: "absolute" as const,
    zIndex: 1,
    width: 44,
    height: 44,
    // The surrounding surface is `zoom-out`; the controls are not a way to close.
    cursor: "pointer",
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      onKeyDown={handleKeyDown}
      slotProps={{
        // MUI's own backdrop, emptied. Exactly one darkened surface covers the screen — the paper
        // below — so there is no second fill for a rim or a seam to appear at the edge of.
        backdrop: { sx: { backgroundColor: "transparent" } },
        paper: {
          "aria-label": t("trips.gallery.viewer.title"),
          // Click-to-close on the surrounding surface, which is behaviour users have today. The
          // controls stop propagation so paging is not also a dismissal.
          onClick: onClose,
          sx: {
            position: "relative",
            backgroundColor: VIEWER_SURFACE,
            // `theme.ts` stamps a 1px rgba border on every Paper and a 10px radius + shadow on every
            // dialog paper. On a full-bleed surface all three read as the rim this story removes.
            border: "none",
            borderRadius: 0,
            boxShadow: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            cursor: "zoom-out",
            // Room for the chrome, and never expressed in `100vw`. From `sm` up the 64px inset clears
            // the 44px chevrons entirely. At `xs` the horizontal inset is only 8px, so the chevrons
            // deliberately sit *over* the photo rather than shrinking it on a 390px screen — the same
            // trade Story 6.11 made for the day hero, and the reason they spread `ON_PHOTO_CHROME`.
            padding: { xs: "56px 8px", sm: "64px 64px" },
          },
        },
      }}
    >
      {/*
        Outside the `current` gate on purpose: an empty collection under an open viewer — a delete
        behind it, or a caller that opens before its images have arrived — would otherwise be a
        full-bleed black surface with nothing focusable and no visible way out.
      */}
      <IconButton
        aria-label={t("trips.gallery.viewer.close")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        sx={{ ...controlSx, top: 8, right: 8 }}
      >
        <CloseXIcon sx={{ fontSize: 18 }} />
      </IconButton>

      {current ? (
        <>
          {total > 1 ? (
            <>
              <IconButton
                aria-label={t("trips.gallery.viewer.previous")}
                onClick={(event) => {
                  event.stopPropagation();
                  goTo(-1);
                }}
                sx={{ ...controlSx, left: 8, top: "50%", transform: "translateY(-50%)" }}
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                aria-label={t("trips.gallery.viewer.next")}
                onClick={(event) => {
                  event.stopPropagation();
                  goTo(1);
                }}
                sx={{ ...controlSx, right: 8, top: "50%", transform: "translateY(-50%)" }}
              >
                <ChevronRightIcon />
              </IconButton>
            </>
          ) : null}

          {/*
            The alt travels with the current image rather than being fixed at the one the viewer
            opened with — `current.alt`, re-read on every page. No `loading="lazy"`: the viewer's
            image is the thing the user just asked for.
          */}
          <Box
            component="img"
            key={current.key}
            src={current.imageUrl}
            alt={current.alt}
            sx={{
              maxWidth: "100%",
              maxHeight: "100%",
              // Never cropped.
              objectFit: "contain",
              display: "block",
            }}
          />

          {/*
            The position, stated. Reuses `trips.gallery.imageAlt`'s `{index}/{total}` interpolation
            rather than composing a second string for the same sentence.

            `role="status"` because paging is otherwise silent to assistive tech: focus stays parked on
            the Previous/Next button, whose own name never changes, and neither the swapped `<img alt>`
            nor this text is inside the focused node. Without the live region a screen-reader user
            presses Next four times and hears nothing at all — which would leave AC5's "the current
            position is stated" true only for a sighted user.
          */}
          <Typography
            role="status"
            aria-live="polite"
            sx={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 12.5,
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: "rgba(0,0,0,.45)",
              borderRadius: "999px",
              padding: "4px 12px",
              pointerEvents: "none",
            }}
          >
            {formatMessage(t("trips.gallery.imageAlt"), { index: safeIndex + 1, total })}
          </Typography>
        </>
      ) : null}
    </Dialog>
  );
}
