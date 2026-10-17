import { describe, expect, it } from "vitest";
import {
  activityEndMinutes,
  minutesToTime,
  placeFixedItem,
  scheduleDay,
  timeToMinutes,
  type ScheduleInput,
  type ScheduleItem,
  type ScheduleLeg,
} from "@/lib/trips/daySchedule";
import { resolveDayStartMinute } from "@/lib/trips/stayTimes";

/**
 * Story 13.1 AC14. The schedule rule on its own, before any repository is wired to it. Rewritten from
 * Story 11.2's `dayPlanPush.test.ts`: the walk that only pushed later is gone, and one forward pass over
 * the day in `sortOrder` replaces it.
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

const fixed = (id: string, fromTime: string, toTime: string) => {
  const duration = (timeToMinutes(toTime) ?? 0) - (timeToMinutes(fromTime) ?? 0);
  return item(id, "FIXED", duration, fromTime, toTime);
};

const leg = (fromKey: string, toKey: string, durationMinutes: number): ScheduleLeg => ({
  fromKey,
  toKey,
  durationMinutes,
});

const STAY = "stay-last-night";

const input = (items: ScheduleItem[], legs: ScheduleLeg[] = [], dayStart = "09:00"): ScheduleInput => ({
  dayStartMinute: timeToMinutes(dayStart)!,
  previousStayId: STAY,
  items,
  legs,
});

const times = (result: ReturnType<typeof scheduleDay>) =>
  result.rows.map((row) => `${row.id} ${row.fromTime ?? "-"}–${row.toTime ?? "-"}`);

/** Puts each computed row's times back on the input, the way the repository stores them. */
const stored = (items: ScheduleItem[], result: ReturnType<typeof scheduleDay>): ScheduleItem[] =>
  items.map((entry, index) => ({ ...entry, fromTime: result.rows[index].fromTime, toTime: result.rows[index].toTime }));

describe("scheduleDay (Story 13.1 AC14)", () => {
  describe("day start", () => {
    it("starts at a stored check-out", () => {
      const start = resolveDayStartMinute({ checkOutTime: "08:15" });
      expect(times(scheduleDay({ ...input([flex("a", 60)]), dayStartMinute: start }))).toEqual(["a 08:15–09:15"]);
    });

    it("starts at the 10:00 default when last night's stay stores no check-out", () => {
      const start = resolveDayStartMinute({ checkOutTime: null });
      expect(times(scheduleDay({ ...input([flex("a", 60)]), dayStartMinute: start }))).toEqual(["a 10:00–11:00"]);
    });

    it("starts at 09:00 without a stay last night", () => {
      const start = resolveDayStartMinute(null);
      expect(
        times(scheduleDay({ ...input([flex("a", 60)]), dayStartMinute: start, previousStayId: null })),
      ).toEqual(["a 09:00–10:00"]);
    });
  });

  describe("legs", () => {
    it("counts the drawn leg from last night's stay to the first row", () => {
      expect(times(scheduleDay(input([flex("a", 60)], [leg(STAY, "a", 30)])))).toEqual(["a 09:30–10:30"]);
    });

    it("ignores a leg the timeline does not draw", () => {
      const result = scheduleDay(
        input(
          [flex("a", 60), flex("b", 60), flex("c", 60)],
          // a → c skips b, c → b runs backwards, the stay leg to b skips a: none is drawn.
          [leg("a", "c", 45), leg("c", "b", 45), leg(STAY, "b", 45)],
        ),
      );
      expect(times(result)).toEqual(["a 09:00–10:00", "b 10:00–11:00", "c 11:00–12:00"]);
    });

    it("ignores a stay leg when there was no stay last night", () => {
      const result = scheduleDay({ ...input([flex("a", 60)], [leg(STAY, "a", 30)]), previousStayId: null });
      expect(times(result)).toEqual(["a 09:00–10:00"]);
    });

    it("takes the first leg read when several share a pair", () => {
      expect(times(scheduleDay(input([flex("a", 60), flex("b", 30)], [leg("a", "b", 10), leg("a", "b", 50)])))).toEqual([
        "a 09:00–10:00",
        "b 10:10–10:40",
      ]);
    });
  });

  it("chains flexible rows, each tight behind its predecessor plus the leg", () => {
    const result = scheduleDay(input([flex("a", 60), flex("b", 90), flex("c", 15)], [leg("a", "b", 20), leg("b", "c", 5)]));
    expect(times(result)).toEqual(["a 09:00–10:00", "b 10:20–11:50", "c 11:55–12:10"]);
    expect(result.conflicts).toEqual([]);
    expect(result.overflow).toEqual([]);
  });

  describe("pull forward", () => {
    it("moves the later flexible rows earlier when one gets shorter", () => {
      const legs = [leg("a", "b", 20), leg("b", "c", 20)];
      const before = scheduleDay(input([flex("a", 120), flex("b", 60), flex("c", 30)], legs));
      expect(times(before)).toEqual(["a 09:00–11:00", "b 11:20–12:20", "c 12:40–13:10"]);
      const after = scheduleDay(input([flex("a", 60), flex("b", 60), flex("c", 30)], legs));
      expect(times(after)).toEqual(["a 09:00–10:00", "b 10:20–11:20", "c 11:40–12:10"]);
    });

    it("closes the gap a deleted row leaves", () => {
      const result = scheduleDay(input([flex("a", 60), flex("c", 30)], [leg("a", "b", 20), leg("b", "c", 20)]));
      // b is gone, so neither of its legs is drawn any more: c sits right behind a.
      expect(times(result)).toEqual(["a 09:00–10:00", "c 10:00–10:30"]);
    });

    it("never leaves a gap before a flexible row, whatever times it had stored", () => {
      const stale = item("b", "FLEXIBLE", 30, "15:00", "15:30");
      expect(times(scheduleDay(input([flex("a", 60), stale])))).toEqual(["a 09:00–10:00", "b 10:00–10:30"]);
    });
  });

  describe("fixed rows", () => {
    it("keeps a fixed row's times with the waiting time before it", () => {
      const result = scheduleDay(input([flex("a", 60), fixed("f", "12:00", "13:00"), flex("c", 30)]));
      expect(times(result)).toEqual(["a 09:00–10:00", "f 12:00–13:00", "c 13:00–13:30"]);
      expect(result.conflicts).toEqual([]);
    });

    it("continues from the later of the cursor and the fixed end", () => {
      // a ends 11:00, after f's end of 10:30: c continues from 11:00, not 10:30.
      const result = scheduleDay(input([flex("a", 120), fixed("f", "10:00", "10:30"), flex("c", 30)]));
      expect(times(result)).toEqual(["a 09:00–11:00", "f 10:00–10:30", "c 11:00–11:30"]);
    });

    it("reports a late arrival at a fixed row and keeps its times", () => {
      const result = scheduleDay(
        input([flex("a", 60), flex("b", 60), fixed("ferry", "12:00", "13:00")], [leg("a", "b", 20), leg("b", "ferry", 40)]),
      );
      // b ends 11:20, plus 40 minutes to the ferry: reachable at 12:00 exactly is fine, 12:01 is not.
      expect(result.conflicts).toEqual([]);
      const late = scheduleDay(
        input([flex("a", 60), flex("b", 80), fixed("ferry", "12:00", "13:00")], [leg("a", "b", 20), leg("b", "ferry", 40)]),
      );
      expect(times(late)).toEqual(["a 09:00–10:00", "b 10:20–11:40", "ferry 12:00–13:00"]);
      expect(late.conflicts).toEqual([{ itemId: "ferry", title: "FERRY", fromTime: "12:00", reachableAt: "12:20" }]);
    });

    it("reports two overlapping fixed rows", () => {
      const result = scheduleDay(input([fixed("tour", "10:00", "12:00"), fixed("lunch", "11:30", "12:30")]));
      expect(times(result)).toEqual(["tour 10:00–12:00", "lunch 11:30–12:30"]);
      expect(result.conflicts).toEqual([{ itemId: "lunch", title: "LUNCH", fromTime: "11:30", reachableAt: "12:00" }]);
    });

    it("reports a fixed first row the day start cannot reach", () => {
      const result = scheduleDay(input([fixed("f", "09:10", "10:00")], [leg(STAY, "f", 30)]));
      expect(result.conflicts).toEqual([{ itemId: "f", title: "F", fromTime: "09:10", reachableAt: "09:30" }]);
    });

    it("keeps a fixed row's stored strings verbatim", () => {
      const odd = item("f", "FIXED", 60, "9:00", "10:00");
      expect(scheduleDay(input([odd])).rows).toEqual([{ id: "f", fromTime: "9:00", toTime: "10:00" }]);
    });

    it("schedules a FIXED row without two readable times as if it were flexible (§5)", () => {
      const result = scheduleDay(
        input([flex("a", 60), item("half", "FIXED", 20, "13:00", null), item("bad", "FIXED", 15, "14:00", "13:00")]),
      );
      expect(times(result)).toEqual(["a 09:00–10:00", "half 10:00–10:20", "bad 10:20–10:35"]);
    });
  });

  describe("past midnight (rule 5)", () => {
    it("gives the overflowing flexible row and every later flexible row null times", () => {
      const result = scheduleDay(
        input([fixed("dinner", "20:00", "23:00"), flex("bar", 50), flex("late", 15), fixed("night", "23:30", "23:50")], [], "09:00"),
      );
      expect(times(result)).toEqual(["dinner 20:00–23:00", "bar 23:00–23:50", "late -–-", "night 23:30–23:50"]);
      expect(result.overflow).toEqual(["late"]);
    });

    it("lets a flexible row end at 23:59 exactly", () => {
      const result = scheduleDay(input([fixed("d", "22:00", "23:00"), flex("a", 59)]));
      expect(times(result)).toEqual(["d 22:00–23:00", "a 23:00–23:59"]);
      expect(result.overflow).toEqual([]);
    });

    it("keeps every flexible row after an overflow untimed, even a short one that would fit", () => {
      const result = scheduleDay(input([fixed("d", "22:00", "23:00"), flex("long", 120), flex("short", 5)]));
      expect(times(result)).toEqual(["d 22:00–23:00", "long -–-", "short -–-"]);
      expect(result.overflow).toEqual(["long", "short"]);
    });

    it("does not report a fixed row after an overflow as reached late, so every reachableAt is a valid time", () => {
      const result = scheduleDay(input([fixed("d", "22:00", "23:00"), flex("long", 120), fixed("night", "23:30", "23:45")]));
      expect(result.overflow).toEqual(["long"]);
      expect(result.conflicts).toEqual([]);
    });

    it("reports a fixed row reached only after midnight, with reachableAt capped at 23:59 (review D1)", () => {
      const result = scheduleDay(
        input([fixed("a", "21:00", "23:00"), fixed("b", "23:30", "23:45")], [leg("a", "b", 120)]),
      );
      expect(result.overflow).toEqual([]);
      expect(result.conflicts).toEqual([{ itemId: "b", title: "B", fromTime: "23:30", reachableAt: "23:59" }]);
    });
  });

  it("is idempotent: scheduling a scheduled day changes nothing", () => {
    const items = [
      flex("a", 60),
      fixed("f", "11:00", "12:00"),
      flex("b", 45),
      fixed("g", "12:30", "13:00"),
      flex("c", 30),
    ];
    const legs = [leg(STAY, "a", 15), leg("a", "f", 20), leg("f", "b", 10), leg("b", "g", 30)];
    const once = scheduleDay(input(items, legs));
    const twice = scheduleDay(input(stored(items, once), legs));
    expect(twice).toEqual(once);
  });

  describe("the proposal's success criteria", () => {
    const legs = [leg(STAY, "first", 30), leg("first", "second", 20), leg("second", "third", 20)];

    it("1. A day with check-out 09:00, a 30-minute leg and three flexible activities of 1 h, 2 h and 30 min, with 20-minute legs between them, reads 09:30–10:30, 10:50–12:50 and 13:10–13:40, without the user typing a single time.", () => {
      const result = scheduleDay(
        input([flex("first", 60), flex("second", 120), flex("third", 30)], legs, "09:00"),
      );
      expect(times(result)).toEqual(["first 09:30–10:30", "second 10:50–12:50", "third 13:10–13:40"]);
    });

    it("2. Shortening the second activity to 1 h moves the third to 12:10–12:40.", () => {
      const result = scheduleDay(input([flex("first", 60), flex("second", 60), flex("third", 30)], legs, "09:00"));
      expect(times(result)[2]).toBe("third 12:10–12:40");
    });
  });
});

describe("placeFixedItem (Story 13.1 AC7, AC14)", () => {
  const place = (items: ScheduleItem[], itemId: string, legs: ScheduleLeg[] = []) =>
    placeFixedItem({ ...input(items, legs), itemId });

  it("places a fixed row after the last row whose computed start is at or before its start", () => {
    // a 09–10, b 10–11, c 11–12 once the ferry is out of the way; the ferry at 10:30 goes after b.
    expect(place([fixed("ferry", "10:30", "11:00"), flex("a", 60), flex("b", 60), flex("c", 60)], "ferry")).toBe(2);
  });

  it("goes to position 0 when nothing starts at or before it", () => {
    expect(place([flex("a", 60), fixed("early", "08:00", "08:30")], "early")).toBe(0);
  });

  it("goes after a row that starts at the same minute (a tie)", () => {
    expect(place([flex("a", 60), flex("b", 60), fixed("f", "10:00", "10:30")], "f")).toBe(2);
  });

  it("counts a row without computed times as later than everything", () => {
    const items = [fixed("d", "22:00", "23:00"), flex("long", 120), fixed("f", "23:30", "23:45")];
    // long does not fit (null times); f, at 23:30, still goes after d and before long.
    expect(place(items, "f")).toBe(1);
  });

  it("uses the computed starts of the rest, which the placed row no longer takes part in", () => {
    // With f out of the way, b starts at 10:00, before f's 10:15: f goes after b.
    expect(place([flex("a", 60), fixed("f", "10:15", "11:00"), flex("b", 30)], "f")).toBe(2);
  });

  it("throws when the row is not on the day", () => {
    expect(() => place([flex("a", 60)], "missing")).toThrow();
  });
});

describe("time helpers moved from dayPlanPush.ts", () => {
  it("reads and formats HH:MM", () => {
    expect(timeToMinutes("09:05")).toBe(545);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(minutesToTime(545)).toBe("09:05");
    expect(activityEndMinutes({ fromTime: "10:00", toTime: "09:00" })).toBe(600);
  });
});
