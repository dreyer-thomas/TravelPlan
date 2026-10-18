import { describe, expect, it } from "vitest";
import {
  planDaySchedule,
  type ScheduleDayState,
  type StoredScheduleRow,
} from "@/lib/repositories/dayScheduleTransaction";

/**
 * Story 13.3 §3. *Einfügen nach* in the plan: a new FLEXIBLE row goes directly after `afterId`, a FIXED one
 * ignores it and is placed by its time. The day starts at 09:00 (no stay last night).
 */

const STAMP = new Date("2026-01-01T00:00:00.000Z");

const flexible = (id: string, durationMinutes: number, fromTime: string, toTime: string, sortOrder: number): StoredScheduleRow => ({
  id,
  title: id,
  scheduleMode: "FLEXIBLE",
  durationMinutes,
  fromTime,
  toTime,
  sortOrder,
  createdAt: STAMP,
  updatedAt: STAMP,
});

/** A 09–10, B 10–11, C 11–12, all flexible. */
const day = (): ScheduleDayState => ({
  tripDayId: "day-1",
  rows: [flexible("A", 60, "09:00", "10:00", 0), flexible("B", 60, "10:00", "11:00", 1), flexible("C", 60, "11:00", "12:00", 2)],
  previousStay: null,
  legs: [],
});

const newRow = { id: "D", title: "D", scheduleMode: "FLEXIBLE" as const, durationMinutes: 30, fromTime: null, toTime: null };

describe("planDaySchedule insert after (Story 13.3)", () => {
  it("puts a new flexible row directly after the first row and moves the later ones", () => {
    const plan = planDaySchedule(day(), { kind: "insert", item: newRow, afterId: "A" });

    expect(plan.order.map((row) => `${row.id} ${row.fromTime}–${row.toTime}`)).toEqual([
      "A 09:00–10:00",
      "D 10:00–10:30",
      "B 10:30–11:30",
      "C 11:30–12:30",
    ]);
    expect(plan.edited).toMatchObject({ id: "D", sortOrder: 1, fromTime: "10:00", toTime: "10:30" });
    expect(plan.changes.map((change) => change.id)).toEqual(["B", "C"]);
  });

  it("after the last row is the same as appending", () => {
    const after = planDaySchedule(day(), { kind: "insert", item: newRow, afterId: "C" });
    const appended = planDaySchedule(day(), { kind: "insert", item: newRow });

    expect(after).toEqual(appended);
    expect(after.edited).toMatchObject({ id: "D", sortOrder: 3, fromTime: "12:00", toTime: "12:30" });
    expect(after.changes).toEqual([]);
  });

  it("null appends", () => {
    expect(planDaySchedule(day(), { kind: "insert", item: newRow, afterId: null })).toEqual(
      planDaySchedule(day(), { kind: "insert", item: newRow }),
    );
  });

  it("a FIXED insert ignores afterId and is placed by its time", () => {
    const fixed = { id: "F", title: "F", scheduleMode: "FIXED" as const, durationMinutes: 60, fromTime: "12:00", toTime: "13:00" };

    const plan = planDaySchedule(day(), { kind: "insert", item: fixed, afterId: "A" });

    expect(plan).toEqual(planDaySchedule(day(), { kind: "insert", item: fixed }));
    expect(plan.order.map((row) => row.id)).toEqual(["A", "B", "C", "F"]);
  });

  it("throws when afterId is not on the day (the repository checks first)", () => {
    expect(() => planDaySchedule(day(), { kind: "insert", item: newRow, afterId: "gone" })).toThrow();
  });
});
