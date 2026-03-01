import { describe, expect, it } from "vitest";
import {
  buildPlanItemSegments,
  buildStaySegments,
  buildTravelSegments,
  deriveCoverageSummary,
  mergeGanttSpans,
} from "@/components/features/trips/TripDayGanttSegments";

describe("TripDayGanttSegments", () => {
  it("creates planned segments for previous and current stays when times are present", () => {
    const segments = buildStaySegments({
      previousStay: { checkOutTime: "09:30" },
      currentStay: { checkInTime: "16:15" },
    });

    expect(segments).toEqual([
      { startMinute: 0, endMinute: 570, kind: "accommodation" },
      { startMinute: 975, endMinute: 1440, kind: "accommodation" },
    ]);
  });

  it("skips stay segments when times are missing or invalid", () => {
    const segments = buildStaySegments({
      previousStay: { checkOutTime: null },
      currentStay: { checkInTime: "25:00" },
    });

    expect(segments).toEqual([]);
  });

  it("creates planned segments for day plan items with from/to times", () => {
    const segments = buildPlanItemSegments([
      { id: "item-1", fromTime: "09:00", toTime: "10:30" },
      { id: "item-2", fromTime: "14:15", toTime: "15:00" },
    ]);

    expect(segments).toEqual([
      { startMinute: 540, endMinute: 630, kind: "planItem" },
      { startMinute: 855, endMinute: 900, kind: "planItem" },
    ]);
  });

  it("skips plan item segments when times are missing, invalid, or reversed", () => {
    const segments = buildPlanItemSegments([
      { id: "item-1", fromTime: null, toTime: "10:30" },
      { id: "item-2", fromTime: "09:00", toTime: null },
      { id: "item-3", fromTime: "24:00", toTime: "24:00" },
      { id: "item-4", fromTime: "18:00", toTime: "17:59" },
      { id: "item-5", fromTime: "25:00", toTime: "26:00" },
    ]);

    expect(segments).toEqual([]);
  });

  it("creates planned segments for travel segments using previous item end time plus duration", () => {
    const segments = buildTravelSegments({
      travelSegments: [
        { id: "seg-1", fromItemType: "accommodation", fromItemId: "stay-prev", durationMinutes: 35 },
        { id: "seg-2", fromItemType: "dayPlanItem", fromItemId: "item-1", durationMinutes: 50 },
      ],
      accommodationEndTimes: { "stay-prev": "08:45" },
      planItemEndTimes: { "item-1": "12:10" },
    });

    expect(segments).toEqual([
      { startMinute: 525, endMinute: 560, kind: "travel" },
      { startMinute: 730, endMinute: 780, kind: "travel" },
    ]);
  });

  it("skips travel segments when duration or previous item time is missing", () => {
    const segments = buildTravelSegments({
      travelSegments: [
        { id: "seg-1", fromItemType: "accommodation", fromItemId: "stay-prev", durationMinutes: 0 },
        { id: "seg-2", fromItemType: "dayPlanItem", fromItemId: "item-1", durationMinutes: 30 },
      ],
      accommodationEndTimes: { "stay-prev": "08:45" },
      planItemEndTimes: {},
    });

    expect(segments).toEqual([]);
  });

  it("merges overlapping and contiguous segments into continuous blocks", () => {
    const merged = mergeGanttSpans([
      { startMinute: 0, endMinute: 120 },
      { startMinute: 90, endMinute: 180 },
      { startMinute: 180, endMinute: 240 },
      { startMinute: 300, endMinute: 360 },
      { startMinute: 355, endMinute: 400 },
    ]);

    expect(merged).toEqual([
      { startMinute: 0, endMinute: 240 },
      { startMinute: 300, endMinute: 400 },
    ]);
  });

  it("derives planned and unplanned minutes from merged segments", () => {
    const { plannedMinutes, unplannedMinutes, gaps } = deriveCoverageSummary([
      { startMinute: 60, endMinute: 120, kind: "planItem" },
      { startMinute: 200, endMinute: 260, kind: "travel" },
    ]);

    expect(plannedMinutes).toBe(120);
    expect(unplannedMinutes).toBe(24 * 60 - 120);
    expect(gaps).toEqual([
      { startMinute: 0, endMinute: 60 },
      { startMinute: 120, endMinute: 200 },
      { startMinute: 260, endMinute: 1440 },
    ]);
  });
});
