"use client";

import { useId, type ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CloseXIcon, UploadIcon } from "@/components/features/trips/TripIcons";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

/**
 * Screen G's photo block: caps label, dashed dropzone, then a left-aligned strip of uniform 56px
 * sharp-cornered previews (`mockups/forms-authoring.html:346-395`).
 *
 * Used by the accommodation gallery, the day-plan gallery and the day-details dialog, so the 56px
 * geometry and the accessible-name scheme are declared once rather than three times.
 *
 * `MiniImageStrip` (`TripDayPlanItemContent.tsx`) ships the same 56px values for *display* surfaces
 * and is deliberately not imported here: it caps at three images with a "+N" overflow and has a
 * keyboard-access defect deferred at `deferred-work.md:57`. An editing surface must show and address
 * every image, so this is its own component reusing the same numbers.
 *
 * There is no shared size-limit string. The three call sites state three different limits today
 * (5MB hero, 15MB day image, none on the galleries), so the hint is a prop and each passes its own
 * existing key. Reconciling the three is a validation question, not a visual one.
 */

export type PhotoPreview = {
  /** React key — the image id, or a stable synthetic key for a single-file surface. */
  key: string;
  imageUrl: string;
  /** Overrides the indexed `trips.gallery.imageAlt` string. The day-image preview uses its own. */
  alt?: string;
  /** Omit to render a read-only preview with no remove affordance. */
  onRemove?: () => void;
  onOpen?: () => void;
};

export type PhotoUploadFieldProps = {
  /** The file input's id. The caps label's `htmlFor` — this pair IS the input's accessible name. */
  id: string;
  label: string;
  /** `.photo-upload-text .t` — what the zone does. */
  zoneTitle: string;
  /** `.photo-upload-text .d` — the call site's own size/format line, or nothing. */
  zoneHint?: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  /** e.g. "2 file(s) selected" — the pending-selection line of a two-step upload flow. */
  selectionLabel?: string;
  /** Rendered in place of the strip when `images` is empty. */
  emptyLabel?: string;
  images: PhotoPreview[];
  /** The explicit upload action of a two-step flow, plus any busy/error chrome the caller owns. */
  action?: ReactNode;
};

export default function PhotoUploadField({
  id,
  label,
  zoneTitle,
  zoneHint,
  accept,
  multiple = false,
  disabled = false,
  onFilesSelected,
  selectionLabel,
  emptyLabel,
  images,
  action,
}: PhotoUploadFieldProps) {
  const { tokens, primary } = useTheme().palette;
  const { t } = useI18n();
  const total = images.length;
  // The zone's two copy lines describe the control (what it takes, and at what size). They are the
  // input's `aria-describedby`, not decoration — the day-image surface's "up to 15MB" line was a
  // plain readable Typography before this component existed and must not become sighted-only.
  const zoneTitleId = useId();
  const zoneHintId = useId();

  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
        variant="labelCaps"
        sx={{
          fontSize: 11,
          letterSpacing: "0.06em",
          color: tokens.inkSoft,
          display: "block",
          mb: "7px",
        }}
      >
        {label}
      </Typography>

      {/*
        The `<input type="file">` is stretched transparently over the whole zone rather than hidden
        behind a JS click handler: the entire 44px+ surface is then the native control, it stays
        keyboard-reachable and focusable with no extra wiring, and it keeps exactly one accessible
        name (the caps label above). Copy never promises drag-and-drop — there is no `onDrop`.
      */}
      <Box
        sx={{
          position: "relative",
          border: `1.5px dashed ${tokens.borderStrong}`,
          borderRadius: "8px",
          backgroundColor: tokens.cardAlt,
          padding: "20px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          opacity: disabled ? 0.6 : 1,
          // The same 4px accent ring `theme.ts`'s MuiOutlinedInput override draws on `.Mui-focused`,
          // derived from the palette rather than copied as a literal so the two cannot drift.
          "&:focus-within": {
            borderColor: primary.main,
            boxShadow: `0 0 0 4px ${alpha(primary.main, 0.18)}`,
          },
        }}
      >
        <Box
          component="input"
          type="file"
          id={id}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={zoneHint ? `${zoneTitleId} ${zoneHintId}` : zoneTitleId}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            // `target` is the <input>; `currentTarget` may be a wrapper without `.files`, which
            // silently clears the selection. Same read the day-image field documents.
            const input = event.target;
            onFilesSelected(input.files ? Array.from(input.files) : []);
          }}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: disabled ? "default" : "pointer",
          }}
        />
        <Box
          aria-hidden
          sx={{
            width: 44,
            height: 44,
            borderRadius: "8px",
            backgroundColor: tokens.accentSoft,
            color: primary.main,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <UploadIcon sx={{ fontSize: 20 }} />
        </Box>
        {/*
          Not `aria-hidden`: these two lines carry the accepted formats and the size ceiling, which a
          non-sighted user needs *before* picking a file rather than after a rejected upload. They are
          wired to the input as `aria-describedby` above, so they are announced as the field's
          description and never as part of its name (the caps label is the name).
        */}
        <Box sx={{ minWidth: 0 }}>
          <Typography id={zoneTitleId} sx={{ fontSize: 12.5, fontWeight: 700, color: tokens.ink, mb: "2px" }}>
            {zoneTitle}
          </Typography>
          {zoneHint ? (
            <Typography id={zoneHintId} sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkMuted }}>
              {zoneHint}
            </Typography>
          ) : null}
        </Box>
      </Box>

      {selectionLabel ? (
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft, mt: "8px" }}>
          {selectionLabel}
        </Typography>
      ) : null}

      {action ? <Box sx={{ mt: "10px" }}>{action}</Box> : null}

      {total === 0 ? (
        emptyLabel ? (
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft, mt: "14px" }}>
            {emptyLabel}
          </Typography>
        ) : null
      ) : (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            columnGap: "8px",
            // The mockup's 8px applies in both axes, but its 18px remove-x is below the 44px touch
            // floor. The real target overhangs the thumb by 8px, so wrapped rows get the extra room.
            rowGap: "16px",
            mt: "14px",
          }}
        >
          {images.map((image, index) => {
            const indexValues = { index: index + 1, total };
            const alt = image.alt ?? formatMessage(t("trips.gallery.imageAlt"), indexValues);

            return (
              <Box key={image.key} sx={{ position: "relative", flex: "0 0 56px", width: 56, height: 56 }}>
                <Box
                  component="img"
                  src={image.imageUrl}
                  alt={alt}
                  loading="lazy"
                  onClick={image.onOpen}
                  sx={{
                    // Fixed basis, never flex: 1 — thumbnails are uniform, not stretched (EXPERIENCE.md:67).
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    objectPosition: "center",
                    // Photography is always sharp, whatever the radius of the surface holding it.
                    borderRadius: 0,
                    border: "1px solid rgba(0,0,0,0.06)",
                    display: "block",
                    cursor: image.onOpen ? "pointer" : "default",
                  }}
                />
                {image.onRemove ? (
                  <Box
                    component="button"
                    type="button"
                    disabled={disabled}
                    onClick={image.onRemove}
                    aria-label={formatMessage(t("trips.gallery.removeImage"), indexValues)}
                    sx={{
                      // 44×44 transparent target (DESIGN.md:266) with the mockup's 18px disc drawn in
                      // its top-right corner, so the visible mark lands where `.remove-x` does.
                      position: "absolute",
                      top: "-8px",
                      right: "-8px",
                      width: 44,
                      height: 44,
                      padding: 0,
                      border: "none",
                      background: "none",
                      cursor: disabled ? "default" : "pointer",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "flex-end",
                      "&:focus-visible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "-10px" },
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        backgroundColor: tokens.ink,
                        color: tokens.card,
                        border: `1.5px solid ${tokens.card}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <CloseXIcon sx={{ fontSize: 11 }} />
                    </Box>
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
