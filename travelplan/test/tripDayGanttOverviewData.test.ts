import { describe, expect, it } from "vitest";
import { buildOverviewGanttSegments } from "@/components/features/trips/TripDayGanttOverviewData";

describe("buildOverviewGanttSegments", () => {
  it("builds segments using the same stay, plan item, and travel rules", () => {
    const segments = buildOverviewGanttSegments({
      previousStay: { id: "stay-prev", checkOutTime: null },
      currentStay: null,
      planItems: [
        { id: "plan-1", fromTime: "08:00", toTime: "09:00" },
        { id: "plan-2", fromTime: "11:00", toTime: "10:00" },
      ],
      travelSegments: [
        { id: "travel-1", fromItemType: "accommodation", fromItemId: "stay-prev", durationMinutes: 30 },
      ],
    });

    expect(segments.some((segment) => segment.kind === "planItem")).toBe(true);
    expect(segments.some((segment) => segment.kind === "travel")).toBe(true);
    const staySegment = segments.find((segment) => segment.kind === "accommodation");
    expect(staySegment).toMatchObject({ startMinute: 0, endMinute: 600 });
  });

  it("defaults missing current stay check-in time to provide coverage", () => {
    const segments = buildOverviewGanttSegments({
      previousStay: null,
      currentStay: { id: "stay-current", checkInTime: null },
      planItems: [],
      travelSegments: [],
    });

    const currentStaySegment = segments.find((segment) => segment.kind === "accommodation");
    expect(currentStaySegment).toMatchObject({ startMinute: 16 * 60, endMinute: 24 * 60 });
  });
});
