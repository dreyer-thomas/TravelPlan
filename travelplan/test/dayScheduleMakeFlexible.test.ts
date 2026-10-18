import { describe, expect, it } from "vitest";
import {
  fixedDurationOf,
  planDaySchedule,
  type ScheduleDayState,
  type StoredScheduleRow,
} from "@/lib/repositories/dayScheduleTransaction";

/**
 * Story 13.3 §7. *Alle flexibel machen* in the plan: the named rows become FLEXIBLE in place with their fixed
 * duration, the day is rescheduled from its start, and the converted rows land in `converted`, never in
 * `changes`. The day starts at 09:00 (no stay last night).
 */

const STAMP = new Date("2026-01-01T00:00:00.000Z");

const stored = (
  id: string,
  scheduleMode: "FIXED" | "FLEXIBLE",
  durationMinutes: number,
  fromTime: string | null,
  toTime: string | null,
  sortOrder: number,
): StoredScheduleRow => ({ id, title: id, scheduleMode, durationMinutes, fromTime, toTime, sortOrder, createdAt: STAMP, updatedAt: STAMP });

const state = (rows: StoredScheduleRow[]): ScheduleDayState => ({ tripDayId: "day-1", rows, previousStay: null, legs: [] });

const times = (rows: { id: string; fromTime: string | null; toTime: string | null }[]) =>
  rows.map((row) => `${row.id} ${row.fromTime}–${row.toTime}`);

describe("planDaySchedule makeFlexible (Story 13.3)", () => {
  it("turns three fixed rows with gaps into a tight chain from the day start", () => {
    const plan = planDaySchedule(
      state([
        stored("F1", "FIXED", 60, "10:00", "11:00", 0),
        stored("F2", "FIXED", 60, "13:00", "14:00", 1),
        stored("F3", "FIXED", 30, "16:00", "16:30", 2),
      ]),
      { kind: "makeFlexible", itemIds: ["F1", "F2", "F3"] },
    );

    expect(times(plan.order)).toEqual(["F1 09:00–10:00", "F2 10:00–11:00", "F3 11:00–11:30"]);
    expect(times(plan.converted)).toEqual(["F1 09:00–10:00", "F2 10:00–11:00", "F3 11:00–11:30"]);
    expect(plan.converted.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
    expect(plan.changes).toEqual([]);
    expect(plan.edited).toBeNull();
  });

  it("keeps a mixed day's order; the flexible row behind them moves earlier and is a change, a converted row never", () => {
    const plan = planDaySchedule(
      state([
        stored("F1", "FIXED", 60, "12:00", "13:00", 0),
        stored("X", "FLEXIBLE", 60, "13:00", "14:00", 1),
        stored("F2", "FIXED", 60, "15:00", "16:00", 2),
      ]),
      { kind: "makeFlexible", itemIds: ["F1", "F2"] },
    );

    expect(times(plan.order)).toEqual(["F1 09:00–10:00", "X 10:00–11:00", "F2 11:00–12:00"]);
    expect(plan.converted.map((row) => row.id)).toEqual(["F1", "F2"]);
    expect(plan.changes.map((change) => change.id)).toEqual(["X"]);
    expect(plan.changes[0]).toMatchObject({ previous: { fromTime: "13:00", toTime: "14:00" } });
  });

  it("uses the span as the duration, not a drifted stored value; a 1-minute row stays 1 minute", () => {
    const plan = planDaySchedule(
      state([stored("Short", "FIXED", 15, "10:00", "10:01", 0), stored("Drift", "FIXED", 15, "11:00", "12:30", 1)]),
      { kind: "makeFlexible", itemIds: ["Short", "Drift"] },
    );

    expect(times(plan.converted)).toEqual(["Short 09:00–09:01", "Drift 09:01–10:31"]);
  });

  it("stores a converted row past 23:59 without times (13.2)", () => {
    const plan = planDaySchedule(
      state([stored("Long", "FLEXIBLE", 840, "09:00", "23:00", 0), stored("Show", "FIXED", 120, "21:00", "23:00", 1)]),
      { kind: "makeFlexible", itemIds: ["Show"] },
    );

    expect(times(plan.converted)).toEqual(["Show null–null"]);
  });
});

describe("fixedDurationOf (Story 13.3)", () => {
  it("is the span when both times read and the end is later, else the stored duration", () => {
    expect(fixedDurationOf({ fromTime: "10:00", toTime: "11:30", durationMinutes: 15 })).toBe(90);
    expect(fixedDurationOf({ fromTime: "10:00", toTime: "09:00", durationMinutes: 15 })).toBe(15);
    expect(fixedDurationOf({ fromTime: null, toTime: "09:00", durationMinutes: 45 })).toBe(45);
  });
});
