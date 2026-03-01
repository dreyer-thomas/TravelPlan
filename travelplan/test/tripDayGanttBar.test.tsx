// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TripDayGanttBar from "@/components/features/trips/TripDayGanttBar";

describe("TripDayGanttBar", () => {
  it("supports a compact variant for constrained layouts", () => {
    render(<TripDayGanttBar ariaLabel="Day gantt summary" segments={[]} variant="compact" />);
    const bar = screen.getByTestId("trip-day-gantt-bar");
    expect(bar).toHaveAttribute("data-variant", "compact");
  });
});
