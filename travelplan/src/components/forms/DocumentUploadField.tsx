"use client";

import { useId, type ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CloseXIcon, UploadIcon } from "@/components/features/trips/TripIcons";
import DocChip from "@/components/ui/DocChip";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

/**
 * The document half of the two dialogs' `Medien & Links` tab (Story 9.1): the same caps label and
 * dashed dropzone `PhotoUploadField` draws, with a column of `DocChip` rows in place of its 56px
 * thumbnail strip.
 *
 * **A sibling of `PhotoUploadField`, deliberately not an extension of it.** That component's entire
 * preview half is `<img src>` thumbnails, and a PDF rendered through one is a broken image — there is
 * no variant of it that shows a document. What is genuinely shared is the *dropzone*: the stretched
 * transparent `<input type="file">` over the whole 44px+ surface, the caps `<label htmlFor>` as the
 * field's single accessible name, and both copy lines wired as `aria-describedby` so the size and
 * format ceiling is not sighted-only. Those rules are re-stated here rather than abstracted into a
 * third component, because the day the two previews diverge further the shared shell is what would
 * have to be unpicked.
 *
 * Removal lives here rather than on `DocChip` for the reason that component's docblock gives: a
 * remove control nested inside an anchor is invalid HTML, so the field positions its own 44px button
 * *beside* the chip — the same relationship `PhotoUploadField` has with its thumbnails, which draw no
 * remove affordance of their own either.
 */

export type DocumentPreview = {
  /** React key — the document id, or a stable synthetic key for a not-yet-saved row. */
  key: string;
  documentUrl: string;
  /** The stored `fileName` column. `DocChip` strips the extension for the visible label. */
  fileName: string;
  /** Omit to render a read-only row with no remove affordance. */
  onRemove?: () => void;
};

export type DocumentUploadFieldProps = {
  /** The file input's id. The caps label's `htmlFor` — this pair IS the input's accessible name. */
  id: string;
  label: string;
  /** What the zone does. Distinct from the photo field's, which is what AC2 turns on. */
  zoneTitle: string;
  /** The size/format line: 10 MB, and PDF/JPEG/PNG/WebP. Described, never merely shown. */
  zoneHint?: string;
  /** `DOCUMENT_UPLOAD_ACCEPT`, passed in rather than spelled here — one accept list, one module. */
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  /** e.g. "2 file(s) selected" — the pending-selection line of a two-step upload flow. */
  selectionLabel?: string;
  /** Rendered in place of the chip column when `documents` is empty. */
  emptyLabel?: string;
  documents: DocumentPreview[];
  /** The explicit upload action of a two-step flow, plus any busy/error chrome the caller owns. */
  action?: ReactNode;
};

export default function DocumentUploadField({
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
  documents,
  action,
}: DocumentUploadFieldProps) {
  const { tokens, primary } = useTheme().palette;
  const { t } = useI18n();
  const total = documents.length;
  // The zone's two copy lines describe the control (what it takes, and at what size) and are the
  // input's `aria-describedby`, not decoration: a non-sighted user needs the 10 MB ceiling and the
  // accepted formats *before* picking a file, not after a rejected upload.
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
            // silently clears the selection. Same read the photo field documents.
            const input = event.target;
            onFilesSelected(input.files ? Array.from(input.files) : []);
            // DW-52, open against `PhotoUploadField` for the missing half of exactly this line: a
            // file input fires `change` only when the *selection* changes, so after pick → upload →
            // remove, picking the same file again is not a change and no event arrives — the staged
            // list stays empty and Upload stays disabled for the rest of the session, with no way
            // out but reopening the dialog. Clearing the value after the caller has taken the files
            // makes every pick a change. It is not fixed in `PhotoUploadField` here: that component
            // is shared with three other surfaces and belongs to its own change.
            input.value = "";
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
          Not `aria-hidden`: these two lines carry the accepted formats and the size ceiling, and they
          are wired to the input as `aria-describedby` above, so they are announced as the field's
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
        // A column rather than the photo field's wrapping strip: a chip is up to 160px of label plus
        // its glyph and its remove target, so two per row would ellipsise most real file names on a
        // dialog column at 390px — and the label is the whole reason the chip exists.
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", mt: "14px" }}>
          {documents.map((doc, index) => (
            <Box key={doc.key} sx={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
              <DocChip
                documentUrl={doc.documentUrl}
                fileName={doc.fileName}
                index={index}
                total={total}
                sx={{ minWidth: 0, flexShrink: 1 }}
              />
              {doc.onRemove ? (
                <Box
                  component="button"
                  type="button"
                  disabled={disabled}
                  onClick={doc.onRemove}
                  // Indexed like `trips.gallery.removeImage`, so each button's name is unique within
                  // the field even when two documents share a file name.
                  aria-label={formatMessage(t("trips.documents.removeDocument"), {
                    index: index + 1,
                    total,
                  })}
                  sx={{
                    // 44×44 (DESIGN.md:266), beside the chip rather than over it: the chip is a link
                    // filling its own width, and a remove target overlapping it would sit on top of
                    // the anchor's own hit area.
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    padding: 0,
                    border: "none",
                    background: "none",
                    cursor: disabled ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tokens.inkSoft,
                    "&:focus-visible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "-6px" },
                  }}
                >
                  <CloseXIcon sx={{ fontSize: 13 }} />
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
