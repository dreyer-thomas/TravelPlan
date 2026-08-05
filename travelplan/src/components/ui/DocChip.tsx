"use client";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import { DocumentIcon } from "@/components/features/trips/TripIcons";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { documentDisplayName } from "@/lib/trips/documentUploads";

/**
 * DESIGN.md's `doc-chip` (`:154-160`, `:260`): one attached document, drawn as a labelled chip rather
 * than a thumbnail. **The label is the content** — a photo identifies itself and a document does not,
 * so three unlabelled squares would force the user to open each one to find the ticket with their own
 * name on it, which is the case this component exists for.
 *
 * One component for both surfaces — the three timeline `tl-card`s and the two dialogs'
 * `DocumentUploadField` — because two copies of the 44px / label / ellipsis rules is how they drift,
 * and the point of DESIGN.md's entry is that the next surface does not re-derive a 32px unlabelled
 * variant. It lives in `src/components/ui/` for the same reason `FullscreenPhotoViewer` does: shared
 * chrome used across feature areas, owned by none of them.
 *
 * **It renders as an `<a target="_blank">`, never a button with a click handler.** Three things follow
 * from that with no extra wiring: it is keyboard-reachable and announced as a link, the browser owns
 * the new tab, and `overlaidContentSx`'s `"& a, & button"` opt-in (`TripDayView.tsx`) restores its
 * pointer events over the card's stretched edit overlay — the same mechanism the existing `linkUrl`
 * control relies on. It is also why an image document cannot end up in `FullscreenPhotoViewer` (AC6):
 * there is no handler here to route one into it.
 *
 * **This component draws the chip and nothing else.** Removal is the caller's, mirroring how
 * `PhotoUploadField` positions its own 44px remove button beside/over the thumbnail rather than
 * letting the thumbnail draw one: the timeline chips have no remove affordance at all, only the
 * dialog field does, and an `onRemove?` prop here would have to be a nested interactive control
 * inside an anchor — which is invalid HTML and unreachable for exactly the assistive technology the
 * 44px target is for.
 */

export type DocChipProps = {
  /** Where the document lives. The href verbatim — the chip never rewrites or cache-busts it. */
  documentUrl: string;
  /** The stored `fileName` column, extension and all. The chip strips the extension for display. */
  fileName: string;
  /**
   * Zero-based position of this document within its entry, rendered one-based in the accessible name
   * the way `PhotoUploadField` renders `trips.gallery.removeImage`.
   *
   * It is not decoration. Nothing forbids two documents on one entry sharing a file name — the unique
   * index is on `sortOrder` — and two chips with the same accessible name is precisely the defect
   * Story 5.11's review found on two comboboxes. The position is what separates them.
   */
  index: number;
  /** How many documents the entry carries, for the "{index} of {total}" half of the name. */
  total: number;
  /** Layout only — margins and flex behaviour belong to whoever is arranging the chips. */
  sx?: SxProps<Theme>;
};

export default function DocChip({ documentUrl, fileName, index, total, sx }: DocChipProps) {
  const { tokens } = useTheme().palette;
  const { t } = useI18n();
  const label = documentDisplayName(fileName);

  return (
    <Box
      component="a"
      href={documentUrl}
      target="_blank"
      // Both, and in this order because that is how every other new-tab link in the app spells it:
      // `noopener` severs the opened tab's `window.opener` handle, `noreferrer` withholds the
      // referrer and implies `noopener` in modern browsers but not in the older ones still reaching
      // an authenticated media URL.
      rel="noreferrer noopener"
      // The visible text is the bare name (DESIGN.md: the label is the content); this overrides it
      // with the disambiguated form, so what is read aloud distinguishes two same-named chips while
      // what is rendered stays the file's own name.
      aria-label={formatMessage(t("trips.documents.openDocument"), {
        name: label,
        index: index + 1,
        total,
      })}
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          // 44px is the floor every interactive element in this system carries, and it is not
          // negotiable: DW-180 records it being lost twice to MUI components resetting their own
          // heights above `sm`, and Story 5.11's review found a 32px select for the same reason.
          // Spelled out rather than derived. No `{ "&&": ... }` bump is needed *here* — this is a
          // plain `Box component="a"`, which carries no MUI height rules for a bare `sx` to lose to.
          // A future variant built on Chip, Button or ListItem would need the bump; this one does not,
          // and claiming otherwise with an unnecessary specificity hack would hide when it matters.
          minHeight: 44,
          boxSizing: "border-box",
          padding: "0 10px",
          // `rounded.sm`. Radii have no token surface in this theme, so the literal is the honest
          // spelling — `theme.shape.borderRadius` is the 6px `rounded.DEFAULT` and would be wrong.
          borderRadius: "4px",
          backgroundColor: tokens.pillNeutral,
          color: tokens.ink,
          textDecoration: "none",
          maxWidth: "100%",
          "&:focus-visible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "2px" },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <DocumentIcon sx={{ fontSize: 14, flexShrink: 0, color: tokens.inkSoft }} />
      <Typography
        component="span"
        sx={{
          fontSize: 11.5,
          fontWeight: 700,
          // Single line, ellipsised at the token's 160px. The chip is allowed to be narrower than its
          // label's natural width and never wider, which is what keeps a row of chips predictable.
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
