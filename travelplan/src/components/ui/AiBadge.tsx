"use client";

import { Box, Tooltip } from "@mui/material";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import { useI18n } from "@/i18n/provider";

export type AiBadgeProps = {
  /** Merged last, for the caller's spacing (a left margin after an inline title, say). */
  sx?: SxProps<Theme>;
};

/**
 * Story 15.4. The *KI* / *AI* pill on an entry the connector created or changed (`aiChangedAt` set).
 * Generic on purpose: it never names the assistant.
 *
 * The day view's assumed-time pill (`timePillAssumedSx`): neutral ink on `tokens.border`, 11px/800,
 * radius 4, so it reads as a tag beside the title and never as an action or a time.
 *
 * Accessible as an image named by the tooltip text: the visible "KI" alone tells a screen reader
 * nothing, and a hover tooltip reaches mouse users only. `role="img"` + `aria-label` gives every reader
 * the full sentence; MUI's `Tooltip` keeps the existing `aria-label` rather than adding its own.
 */
export default function AiBadge({ sx }: AiBadgeProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const tooltip = t("trips.aiBadge.tooltip");

  return (
    <Tooltip title={tooltip} enterDelay={0}>
      <Box
        component="span"
        role="img"
        aria-label={tooltip}
        data-testid="ai-badge"
        sx={[
          {
            display: "inline-block",
            flexShrink: 0,
            fontSize: "11px",
            fontWeight: 800,
            lineHeight: 1.2,
            color: tokens.inkSoft,
            backgroundColor: tokens.border,
            borderRadius: "4px",
            padding: "3px 8px",
            verticalAlign: "middle",
            whiteSpace: "nowrap",
            cursor: "default",
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {t("trips.aiBadge.label")}
      </Box>
    </Tooltip>
  );
}
