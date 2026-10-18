import { describe, expect, it } from "vitest";
import {
  planDaySchedule,
  type ScheduleDayState,
  type StoredScheduleRow,
} from "@/lib/repositories/dayScheduleTransaction";
import type { ScheduleItem, ScheduleLeg } from "@/lib/trips/daySchedule";

/**
 * Story 13.4 §2. Applied suggestions in the plan: the items are appended FLEXIBLE after the day's last row,
 * their legs win their pair, the day is rescheduled, and the appended rows land in `appended`, never in
 * `changes`. Without a stay the day starts at 09:00; with one, at its check-out.
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

const state = (
  rows: StoredScheduleRow[],
  previousStay: ScheduleDayState["previousStay"] = null,
): ScheduleDayState => ({ tripDayId: "day-1", rows, previousStay, legs: [] });

const flexible = (id: string, durationMinutes: number): ScheduleItem => ({
  id,
  title: null,
  scheduleMode: "FLEXIBLE",
  durationMinutes,
  fromTime: null,
  toTime: null,
});

const leg = (fromKey: string, toKey: string, durationMinutes: number): ScheduleLeg => ({ fromKey, toKey, durationMinutes });

const times = (rows: { id: string; fromTime: string | null; toTime: string | null }[]) =>
  rows.map((row) => `${row.id} ${row.fromTime}–${row.toTime}`);

describe("planDaySchedule append (Story 13.4)", () => {
  it("appends to an empty day after last night's stay; the leg from the stay counts", () => {
    const plan = planDaySchedule(state([], { id: "stay-1", checkOutTime: "10:00" }), {
      kind: "append",
      items: [flexible("S0", 60), flexible("S1", 45)],
      legs: [leg("stay-1", "S0", 20), leg("S0", "S1", 13)],
    });

    expect(times(plan.appended)).toEqual(["S0 10:20–11:20", "S1 11:33–12:18"]);
    expect(plan.appended.map((row) => row.sortOrder)).toEqual([0, 1]);
    expect(plan.changes).toEqual([]);
    expect(plan.edited).toBeNull();
    expect(plan.converted).toEqual([]);
  });

  it("appends after a FIXED row: waiting time before it stays, the chain starts at its end plus the leg", () => {
    const plan = planDaySchedule(state([stored("F", "FIXED", 60, "14:00", "15:00", 0)]), {
      kind: "append",
      items: [flexible("S0", 30)],
      legs: [leg("F", "S0", 7)],
    });

    expect(times(plan.order)).toEqual(["F 14:00–15:00", "S0 15:07–15:37"]);
    expect(times(plan.appended)).toEqual(["S0 15:07–15:37"]);
    expect(plan.appended[0].sortOrder).toBe(1);
    expect(plan.changes).toEqual([]);
  });

  it("appends after an overflow row: every appended row is without times", () => {
    const plan = planDaySchedule(
      state([stored("Long", "FLEXIBLE", 900, null, null, 0), stored("Over", "FLEXIBLE", 120, null, null, 1)]),
      { kind: "append", items: [flexible("S0", 30), flexible("S1", 30)], legs: [] },
    );

    expect(times(plan.appended)).toEqual(["S0 null–null", "S1 null–null"]);
  });

  it("a chain that overflows midway: rows after the first null are null too", () => {
    const plan = planDaySchedule(state([stored("A", "FLEXIBLE", 780, "09:00", "22:00", 0)]), {
      kind: "append",
      items: [flexible("S0", 60), flexible("S1", 60), flexible("S2", 10)],
      legs: [],
    });

    expect(times(plan.appended)).toEqual(["S0 22:00–23:00", "S1 null–null", "S2 null–null"]);
    expect(plan.changes).toEqual([]);
  });

  it("an appended leg wins over a stored one for the same pair", () => {
    const base = state([stored("A", "FLEXIBLE", 60, "09:00", "10:00", 0)]);
    const plan = planDaySchedule(
      { ...base, legs: [{ id: "seg-old", fromKey: "A", toKey: "S0", durationMinutes: 90 }] },
      { kind: "append", items: [flexible("S0", 30)], legs: [leg("A", "S0", 10)] },
    );

    expect(times(plan.appended)).toEqual(["S0 10:10–10:40"]);
  });

  it("an unsettled stored row (stale times, sortOrder 0 and 5) lands in changes; appended rows never do", () => {
    const plan = planDaySchedule(
      state([stored("A", "FLEXIBLE", 60, "11:00", "12:00", 0), stored("B", "FLEXIBLE", 30, "12:00", "12:30", 5)]),
      { kind: "append", items: [flexible("S0", 30)], legs: [] },
    );

    expect(times(plan.order)).toEqual(["A 09:00–10:00", "B 10:00–10:30", "S0 10:30–11:00"]);
    expect(plan.changes.map((change) => [change.id, change.sortOrder])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
    expect(plan.changes.some((change) => change.id === "S0")).toBe(false);
    expect(plan.appended.map((row) => row.id)).toEqual(["S0"]);
  });
});
