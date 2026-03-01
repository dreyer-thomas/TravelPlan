import { Box } from "@mui/material";
import type { TripDayGanttSegment } from "@/components/features/trips/TripDayGanttSegments";

type TripDayGanttBarProps = {
  segments?: TripDayGanttSegment[];
  ariaLabel: string;
  variant?: "default" | "compact";
};

const clampMinute = (value: number) => Math.max(0, Math.min(value, 24 * 60));
const ganttColors = {
  accommodation: "#1b3d73",
  travel: "#f08a24",
  planItem: "#1f5e3b",
} as const;
const kindOrder: TripDayGanttSegment["kind"][] = ["accommodation", "planItem", "travel"];

export default function TripDayGanttBar({ segments = [], ariaLabel, variant = "default" }: TripDayGanttBarProps) {
  const ordered = [...segments]
    .map((segment) => ({
      ...segment,
      startMinute: clampMinute(segment.startMinute),
      endMinute: clampMinute(segment.endMinute),
    }))
    .filter((segment) => segment.endMinute > segment.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));

  return (
    <Box
      data-testid="trip-day-gantt-bar"
      aria-label={ariaLabel}
      data-variant={variant}
      sx={{
        position: "relative",
        width: "100%",
        height: variant === "compact" ? 10 : 16,
        borderRadius: 999,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "#ffffff",
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
              bgcolor: ganttColors[segment.kind],
            }}
          />
        );
      })}
    </Box>
  );
}
