import { Box, useTheme } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { TripDayGanttSegment } from "@/components/features/trips/TripDayGanttSegments";

type TripDayGanttBarProps = {
  segments?: TripDayGanttSegment[];
  ariaLabel: string;
  variant?: "default" | "compact";
};

const clampMinute = (value: number) => Math.max(0, Math.min(value, 24 * 60));

/**
 * The bar's fill for every segment kind, keyed by variant. Exported because any legend that decodes
 * this bar has to read from the same source - a legend that re-derives the colours or the hatch pitch
 * starts out matching and silently drifts the first time either changes here.
 */
export const buildGanttPalette = (theme: Theme, variant: "default" | "compact" = "default") => {
  const gapHatchPitch = variant === "compact" ? 3 : 4;
  return {
    accommodation: theme.palette.primary.main,
    planItem: theme.palette.secondary.main,
    travel: theme.palette.tokens.travelNeutral,
    gap: `repeating-linear-gradient(45deg, ${theme.palette.tokens.warnBg}, ${theme.palette.tokens.warnBg} ${gapHatchPitch}px, ${theme.palette.tokens.warnBorder} ${gapHatchPitch}px, ${theme.palette.tokens.warnBorder} ${gapHatchPitch * 2}px)`,
  } as const;
};
// Segments are absolutely-positioned siblings, so DOM order is paint order: later siblings occlude
// earlier ones where they overlap. Order by semantic layer, not by start time - a stay checking in at
// 18:00 must not paint over an activity that started at 17:00 and runs to 20:00.
const paintOrder: TripDayGanttSegment["kind"][] = ["gap", "accommodation", "travel", "planItem"];

export default function TripDayGanttBar({ segments = [], ariaLabel, variant = "default" }: TripDayGanttBarProps) {
  const theme = useTheme();
  const palette = buildGanttPalette(theme, variant);

  const ordered = [...segments]
    .map((segment) => ({
      ...segment,
      startMinute: clampMinute(segment.startMinute),
      endMinute: clampMinute(segment.endMinute),
    }))
    .filter((segment) => segment.endMinute > segment.startMinute)
    .sort((a, b) => paintOrder.indexOf(a.kind) - paintOrder.indexOf(b.kind) || a.startMinute - b.startMinute);

  return (
    <Box
      data-testid="trip-day-gantt-bar"
      aria-label={ariaLabel}
      data-variant={variant}
      sx={{
        position: "relative",
        width: "100%",
        height: variant === "compact" ? 5 : 16,
        // rounded.sm on the full bar; the mini bar sits tighter still at 2px.
        borderRadius: variant === "compact" ? "2px" : "4px",
        // The mini bar has no border in the mockup, and with border-box a 1px frame would eat 40% of
        // its 5px height - leaving too little fill for the gap hatch to read at all.
        ...(variant === "compact" ? {} : { border: "1px solid", borderColor: theme.palette.tokens.borderStrong }),
        bgcolor: theme.palette.tokens.card,
        overflow: "hidden",
      }}
    >
      {ordered.map((segment, index) => {
        const start = segment.startMinute;
        const end = Math.max(start, segment.endMinute);
        const left = (start / (24 * 60)) * 100;
        const width = ((end - start) / (24 * 60)) * 100;
        return (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={`${segment.startMinute}-${segment.endMinute}-${segment.kind}-${index}`}
            data-testid="trip-day-gantt-segment"
            data-kind={segment.kind}
            sx={{
              position: "absolute",
              left: `${left}%`,
              width: `${width}%`,
              top: 0,
              bottom: 0,
              background: palette[segment.kind],
            }}
          />
        );
      })}
    </Box>
  );
}
