// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import TripDayGanttBar from "@/components/features/trips/TripDayGanttBar";
import type { TripDayGanttSegment } from "@/components/features/trips/TripDayGanttSegments";
import theme from "@/theme";

// jsdom normalizes colour values to rgb(), so token hexes have to be converted before comparison.
const asRgb = (hex: string) => {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const renderBar = (segments: TripDayGanttSegment[], variant: "default" | "compact" = "compact") =>
  render(
    <ThemeProvider theme={theme}>
      <TripDayGanttBar ariaLabel="Day gantt summary" segments={segments} variant={variant} />
    </ThemeProvider>,
  );

describe("TripDayGanttBar", () => {
  it("supports a compact variant for constrained layouts", () => {
    renderBar([], "compact");
    const bar = screen.getByTestId("trip-day-gantt-bar");
    expect(bar).toHaveAttribute("data-variant", "compact");
  });

  it("renders a gap segment with a hatched fill rather than a flat colour", () => {
    renderBar([{ startMinute: 0, endMinute: 600, kind: "gap" }]);
    const segment = screen.getByTestId("trip-day-gantt-segment");
    expect(segment).toHaveAttribute("data-kind", "gap");
    // The hatch is what carries the gap signal without relying on colour perception alone.
    const background = getComputedStyle(segment).background;
    expect(background).toContain("repeating-linear-gradient");
    expect(background).toContain(asRgb(theme.palette.tokens.warnBorder));
  });

  it("maps each segment kind to its design-token colour", () => {
    renderBar([
      { startMinute: 0, endMinute: 100, kind: "accommodation" },
      { startMinute: 100, endMinute: 200, kind: "planItem" },
      { startMinute: 200, endMinute: 300, kind: "travel" },
    ]);
    const byKind = Object.fromEntries(
      screen.getAllByTestId("trip-day-gantt-segment").map((el) => [el.getAttribute("data-kind"), el]),
    );
    expect(getComputedStyle(byKind.accommodation).background).toContain(asRgb(theme.palette.primary.main));
    expect(getComputedStyle(byKind.planItem).background).toContain(asRgb(theme.palette.secondary.main));
    expect(getComputedStyle(byKind.travel).background).toContain(asRgb(theme.palette.tokens.travelNeutral));
  });

  it("positions segments proportionally across the 24h span", () => {
    renderBar([{ startMinute: 360, endMinute: 720, kind: "planItem" }]);
    const segment = screen.getByTestId("trip-day-gantt-segment");
    // 06:00-12:00 of a 1440-minute day: a quarter of the bar, starting one quarter in.
    expect(segment).toHaveStyle({ left: "25%", width: "25%" });
  });

  it("paints overlapping segments by semantic layer, not by start time", () => {
    // A stay checking in at 18:00 overlaps an activity that started at 17:00. Segments are
    // absolutely-positioned siblings, so DOM order is paint order: the activity must come last
    // so the stay does not occlude it. Gaps sit at the bottom of the stack.
    const kinds = () =>
      screen.getAllByTestId("trip-day-gantt-segment").map((el) => el.getAttribute("data-kind"));

    renderBar([
      { startMinute: 1020, endMinute: 1200, kind: "planItem" },
      { startMinute: 1080, endMinute: 1440, kind: "accommodation" },
      { startMinute: 0, endMinute: 1020, kind: "gap" },
    ]);

    expect(kinds()).toEqual(["gap", "accommodation", "planItem"]);
  });

  it("drops zero-length and inverted segments", () => {
    renderBar([
      { startMinute: 300, endMinute: 300, kind: "planItem" },
      { startMinute: 600, endMinute: 400, kind: "travel" },
      { startMinute: 0, endMinute: 60, kind: "accommodation" },
    ]);
    const segments = screen.getAllByTestId("trip-day-gantt-segment");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveAttribute("data-kind", "accommodation");
  });

  it("omits the border on the compact variant so its 5px height is all fill", () => {
    renderBar([], "compact");
    expect(getComputedStyle(screen.getByTestId("trip-day-gantt-bar")).borderStyle).not.toBe("solid");
  });
});
