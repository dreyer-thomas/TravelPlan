import { describe, expect, it } from "vitest";
import { timeToMinutes, type ScheduleItem } from "@/lib/trips/daySchedule";
import { buildScheduleInput, derivePlanConflicts } from "@/lib/trips/planConflicts";

/**
 * Story 13.2 AC1, AC2. The read-side derivation on its own: the day's rows, legs and last night's stay in,
 * the marked activities out. `scheduleDay` decides; this pins the mapping and the builder the trip payload
 * and the writes share.
 */

const item = (
  id: string,
  scheduleMode: ScheduleItem["scheduleMode"],
  durationMinutes: number,
  fromTime: string | null = null,
  toTime: string | null = null,
  title: string | null = id.toUpperCase(),
): ScheduleItem => ({ id, title, scheduleMode, durationMinutes, fromTime, toTime });

const flex = (id: string, durationMinutes: number) => item(id, "FLEXIBLE", durationMinutes);

const fixed = (id: string, fromTime: string, toTime: string) =>
  item(id, "FIXED", (timeToMinutes(toTime) ?? 0) - (timeToMinutes(fromTime) ?? 0), fromTime, toTime);

const segment = (fromItemId: string, toItemId: string, durationMinutes: number) => ({
  fromItemId,
  toItemId,
  durationMinutes,
});

const STAY = { id: "stay-last-night", checkOutTime: "09:00" };

const conflictsOf = (
  items: ScheduleItem[],
  legs: ReturnType<typeof segment>[] = [],
  previousStay: { id: string; checkOutTime: string | null } | null = STAY,
) => derivePlanConflicts(buildScheduleInput({ items, legs, previousStay }));

describe("derivePlanConflicts (Story 13.2 AC1, AC2)", () => {
  it("reports a flexible chain reaching a 12:30 ferry at 12:40 as late by 10 minutes", () => {
    const result = conflictsOf(
      [flex("hike", 120), flex("lunch", 60), fixed("ferry", "12:30", "14:00")],
      [segment(STAY.id, "hike", 30), segment("lunch", "ferry", 10)],
    );
    expect(result).toEqual([
      { kind: "late", itemId: "ferry", title: "FERRY", fromTime: "12:30", reachableAt: "12:40", lateMinutes: 10 },
    ]);
  });

  it("reports the second of two overlapping fixed activities as late", () => {
    const result = conflictsOf([fixed("museum", "10:00", "12:00"), fixed("ferry", "11:30", "12:30")]);
    expect(result).toEqual([
      { kind: "late", itemId: "ferry", title: "FERRY", fromTime: "11:30", reachableAt: "12:00", lateMinutes: 30 },
    ]);
  });

  it("reports nothing for a fixed activity reached exactly at its start", () => {
    expect(conflictsOf([flex("a", 60), fixed("ferry", "10:00", "11:00")])).toEqual([]);
  });

  it("reports every flexible activity past 23:59 as overflow, in day order, and no late fixed one after them", () => {
    const result = conflictsOf([
      fixed("dinner", "20:00", "23:00"),
      flex("bar", 90),
      flex("walk", 15),
      fixed("night", "23:30", "23:50"),
    ]);
    expect(result).toEqual([
      { kind: "overflow", itemId: "bar", title: "BAR" },
      { kind: "overflow", itemId: "walk", title: "WALK" },
    ]);
  });

  it("caps reachableAt at 23:59 for a booking reachable only after midnight (13.1 D1), but not lateMinutes (13.2 review)", () => {
    const result = conflictsOf(
      [fixed("a", "21:00", "23:00"), fixed("b", "23:30", "23:45")],
      [segment("a", "b", 120)],
    );
    expect(result).toEqual([
      { kind: "late", itemId: "b", title: "B", fromTime: "23:30", reachableAt: "23:59", lateMinutes: 90 },
    ]);
  });

  it("never reports arriving at tonight's stay after its check-in", () => {
    // The leg into tonight's stay is not between two activities, so it never moves a cursor.
    const result = conflictsOf([flex("a", 600)], [segment("a", "stay-tonight", 300)]);
    expect(result).toEqual([]);
  });

  it("does not report a 00:00–12:30 booking on the first day, which has no stay before it (13.2 real run)", () => {
    expect(conflictsOf([fixed("flight", "00:00", "12:30"), flex("a", 60)], [], null)).toEqual([]);
  });

  it("returns [] for a day that works", () => {
    expect(conflictsOf([flex("a", 60), fixed("f", "12:00", "13:00"), flex("b", 30)])).toEqual([]);
  });

  it("returns [] for a day without activities", () => {
    expect(conflictsOf([])).toEqual([]);
  });
});

describe("buildScheduleInput (Story 13.2 §2, §3)", () => {
  const items = [flex("a", 30)];

  it("starts at 09:00 without a stay last night", () => {
    const input = buildScheduleInput({ items, legs: [], previousStay: null });
    expect(input.dayStartMinute).toBe(9 * 60);
    expect(input.previousStayId).toBeNull();
  });

  it("starts at the 10:00 default for a stay without a check-out", () => {
    const input = buildScheduleInput({ items, legs: [], previousStay: { id: "s", checkOutTime: null } });
    expect(input.dayStartMinute).toBe(10 * 60);
    expect(input.previousStayId).toBe("s");
  });

  it("starts at a stored check-out", () => {
    const input = buildScheduleInput({ items, legs: [], previousStay: { id: "s", checkOutTime: "07:15" } });
    expect(input.dayStartMinute).toBe(7 * 60 + 15);
  });

  it("counts a blank-named stay: the name is not part of the input", () => {
    const blank = { id: "s", name: "  ", checkOutTime: "11:00" };
    const input = buildScheduleInput({ items, legs: [segment("s", "a", 20)], previousStay: blank });
    expect(input.dayStartMinute).toBe(11 * 60);
    expect(input.previousStayId).toBe("s");
    expect(input.legs).toEqual([{ fromKey: "s", toKey: "a", durationMinutes: 20 }]);
  });

  it("maps rows to schedule items and keeps the legs' order (the first leg per pair wins)", () => {
    const row = { ...flex("a", 30), sortOrder: 0, createdAt: new Date(), extra: true };
    const input = buildScheduleInput({
      items: [row],
      legs: [segment("s", "a", 20), segment("s", "a", 50)],
      previousStay: { id: "s", checkOutTime: "09:00" },
    });
    expect(input.items).toEqual([flex("a", 30)]);
    expect(input.legs.map((leg) => leg.durationMinutes)).toEqual([20, 50]);
    expect(derivePlanConflicts(input)).toEqual([]);
  });
});
