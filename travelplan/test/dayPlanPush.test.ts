import { describe, expect, it } from "vitest";
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";
import {
  planDayPush,
  planDayReorder,
  type PushItem,
  type PushLeg,
  type PushPlan,
  type ReorderPlan,
} from "@/lib/trips/dayPlanPush";

/**
 * Story 11.2 AC13. The push rule on its own, before any repository is wired to it.
 */

const item = (
  id: string,
  fromTime: string | null,
  toTime: string | null,
  createdAt = "2026-10-01T08:00:00.000Z",
  title: string | null = id.toUpperCase(),
): PushItem => ({ id, title, fromTime, toTime, createdAt });

const leg = (fromItemId: string, toItemId: string, durationMinutes: number): PushLeg => ({
  fromItemId,
  toItemId,
  durationMinutes,
});

const okPlan = (plan: PushPlan) => {
  if (plan.status !== "ok") throw new Error(`expected ok, got ${plan.status}`);
  return plan;
};

const times = (plan: PushPlan) =>
  okPlan(plan).order.map((entry) => `${entry.id} ${entry.fromTime ?? "-"}–${entry.toTime ?? "-"}`);

/** The story's worked example: A 09–10, B 10:30–11:30, C 12–13, D 16–17, leg B→C 20 min. */
const workedDay = () => [
  item("a", "09:00", "10:00"),
  item("b", "10:30", "11:30"),
  item("c", "12:00", "13:00"),
  item("d", "16:00", "17:00"),
];

describe("planDayPush", () => {
  it("runs the worked example: insert M, B and C move, D absorbs it", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [leg("b", "c", 20)],
      edit: { kind: "insert", item: item("m", "10:00", "11:30", "2026-10-02T00:00:00.000Z") },
    });

    expect(times(plan)).toEqual([
      "a 09:00–10:00",
      "m 10:00–11:30",
      "b 11:30–12:30",
      "c 12:50–13:50",
      "d 16:00–17:00",
    ]);
    expect(okPlan(plan).moves).toEqual([
      { itemId: "b", previousFromTime: "10:30", previousToTime: "11:30", fromTime: "11:30", toTime: "12:30" },
      { itemId: "c", previousFromTime: "12:00", previousToTime: "13:00", fromTime: "12:50", toTime: "13:50" },
    ]);
  });

  it("absorbs a change into slack without pushing anything", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "10:30" },
    });
    expect(okPlan(plan).moves).toEqual([]);
    expect(times(plan)[0]).toBe("a 09:00–10:30");
  });

  it("pushes a chain and stops at the first activity that fits", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "11:00" },
    });
    expect(times(plan)).toEqual([
      "a 09:00–11:00",
      "b 11:00–12:00",
      "c 12:00–13:00",
      "d 16:00–17:00",
    ]);
    // C fits exactly at B's new end, so the walk stops at C; D is never even reached.
    expect(okPlan(plan).moves.map((move) => move.itemId)).toEqual(["b"]);
  });

  it("stops mid-day and leaves everything after the stop alone, even an overlap further on", () => {
    const items = [...workedDay(), item("e", "16:30", "18:00")];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "retime", itemId: "b", fromTime: "10:30", toTime: "12:30" },
    });
    // C moves, D has slack and stops the walk; E overlapped D before the change and still does.
    expect(okPlan(plan).moves.map((move) => move.itemId)).toEqual(["c"]);
    expect(times(plan).slice(3)).toEqual(["d 16:00–17:00", "e 16:30–18:00"]);
  });

  it("skips untimed activities and never gives them a time", () => {
    const items = [
      item("a", "09:00", "10:00"),
      item("b", "10:00", "11:00"),
      item("u", null, null),
      item("v", null, "12:00"),
    ];
    const plan = planDayPush({
      items,
      legs: [leg("b", "u", 30)],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "10:30" },
    });
    expect(times(plan)).toEqual(["a 09:00–10:30", "b 10:30–11:30", "u -–-", "v -–12:00"]);
    expect(okPlan(plan).moves.map((move) => move.itemId)).toEqual(["b"]);
  });

  it("counts a leg's duration in its own direction only", () => {
    // A starts out shorter, so extending it to 10:00 is a real retime (an unchanged one plans nothing).
    const day = () => [item("a", "09:00", "09:45"), ...workedDay().slice(1)];
    const forward = planDayPush({
      items: day(),
      legs: [leg("a", "b", 45)],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "10:00" },
    });
    // 10:00 + 45 = 10:45 > 10:30: B moves 15 minutes and keeps its hour.
    expect(okPlan(forward).moves).toEqual([
      { itemId: "b", previousFromTime: "10:30", previousToTime: "11:30", fromTime: "10:45", toTime: "11:45" },
    ]);

    const reverse = planDayPush({
      items: day(),
      legs: [leg("b", "a", 45)],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "10:00" },
    });
    expect(okPlan(reverse).moves).toEqual([]);
  });

  it("refuses past midnight and names the first activity whose end would not fit", () => {
    const items = [item("a", "20:00", "21:00"), item("b", "21:00", "23:00"), item("c", "23:00", "23:30")];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "20:00", toTime: "22:00" },
    });
    // B → 22:00–24:00: its end is past 23:59, so B is named even though C would not fit either.
    expect(plan).toEqual({ status: "past_midnight", item: { id: "b", title: "B" } });
  });

  it("refuses past midnight for a zero-length row by its start", () => {
    const items = [item("a", "22:00", "23:00"), item("z", "23:30", null)];
    const plan = planDayPush({
      items,
      legs: [leg("a", "z", 60)],
      edit: { kind: "retime", itemId: "a", fromTime: "22:00", toTime: "23:30" },
    });
    expect(plan).toEqual({ status: "past_midnight", item: { id: "z", title: "Z" } });
  });

  it("accepts a push that ends exactly at 23:59", () => {
    const items = [item("a", "20:00", "21:00"), item("b", "21:00", "22:59")];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "20:00", toTime: "22:00" },
    });
    expect(okPlan(plan).moves).toEqual([
      { itemId: "b", previousFromTime: "21:00", previousToTime: "22:59", fromTime: "22:00", toTime: "23:59" },
    ]);
  });

  it("refuses a retime that would start before its predecessor", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "c", fromTime: "10:00", toTime: "11:00" },
    });
    expect(plan).toEqual({ status: "before_predecessor", predecessor: { id: "b", title: "B", fromTime: "10:30" } });
  });

  it("decides an equal start against the predecessor by createdAt", () => {
    const items = [
      item("a", "09:00", "10:00", "2026-10-01T08:00:00.000Z"),
      item("b", "11:00", "12:00", "2026-10-01T09:00:00.000Z"),
    ];
    // B was created after A: at 09:00 it still sorts after A, so the start is accepted (and overlaps A).
    const accepted = planDayPush({ items, legs: [], edit: { kind: "retime", itemId: "b", fromTime: "09:00", toTime: "09:30" } });
    expect(okPlan(accepted).moves).toEqual([]);

    const earlier = [
      item("a", "09:00", "10:00", "2026-10-01T09:00:00.000Z"),
      item("b", "11:00", "12:00", "2026-10-01T08:00:00.000Z"),
    ];
    // B was created first: at 09:00 the comparator would put it before A, so the start is refused.
    const refused = planDayPush({ items: earlier, legs: [], edit: { kind: "retime", itemId: "b", fromTime: "09:00", toTime: "09:30" } });
    expect(refused).toEqual({ status: "before_predecessor", predecessor: { id: "a", title: "A", fromTime: "09:00" } });
  });

  it("accepts an overlap with the predecessor's end alone", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "b", fromTime: "09:30", toTime: "10:30" },
    });
    expect(okPlan(plan).moves).toEqual([]);
  });

  it("keeps the place of a retime past its successor and pushes the successor", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "13:30", toTime: "14:00" },
    });
    expect(times(plan)).toEqual([
      "a 13:30–14:00",
      "b 14:00–15:00",
      "c 15:00–16:00",
      "d 16:00–17:00",
    ]);
  });

  it("slots an insert by time and never moves its predecessor", () => {
    const plan = planDayPush({
      items: workedDay(),
      legs: [],
      // Starts inside A's hour: A is its predecessor and stays put; B is pushed.
      edit: { kind: "insert", item: item("m", "09:30", "11:00", "2026-10-02T00:00:00.000Z") },
    });
    expect(times(plan)).toEqual([
      "a 09:00–10:00",
      "m 09:30–11:00",
      "b 11:00–12:00",
      "c 12:00–13:00",
      "d 16:00–17:00",
    ]);
  });

  it("treats an untimed row given a time as an insert", () => {
    const items = [...workedDay(), item("u", null, null)];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "insert", item: item("u", "10:15", "11:00") },
    });
    expect(times(plan).map((entry) => entry.split(" ")[0])).toEqual(["a", "u", "b", "c", "d"]);
    expect(okPlan(plan).moves.map((move) => move.itemId)).toEqual(["b"]);
  });

  it("never pulls anything forward: shortening and moving later with slack move nothing", () => {
    const shortened = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "b", fromTime: "10:30", toTime: "10:45" },
    });
    expect(okPlan(shortened).moves).toEqual([]);
    expect(times(shortened)[2]).toBe("c 12:00–13:00");

    const later = planDayPush({
      items: workedDay(),
      legs: [],
      edit: { kind: "retime", itemId: "c", fromTime: "13:00", toTime: "14:00" },
    });
    expect(okPlan(later).moves).toEqual([]);
  });

  it("shifts an imported overnight pair by the same amount, keeping its shape", () => {
    const items = [item("a", "20:00", "21:00"), item("o", "21:00", "01:00")];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "20:00", toTime: "21:30" },
    });
    expect(okPlan(plan).moves).toEqual([
      { itemId: "o", previousFromTime: "21:00", previousToTime: "01:00", fromTime: "21:30", toTime: "01:30" },
    ]);
  });

  it("moves a row one minute past a tie a pushed zero-length row would otherwise win", () => {
    // Z (zero-length, created last) is pushed onto 11:00, where C starts. C was created first, so at an
    // equal start the comparator puts C before Z, which would reorder the day.
    const items = [
      item("a", "09:00", "10:00", "2026-10-01T08:00:00.000Z"),
      item("z", "10:00", null, "2026-10-01T10:00:00.000Z"),
      item("c", "11:00", "12:00", "2026-10-01T07:00:00.000Z"),
    ];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "11:00" },
    });
    expect(times(plan)).toEqual(["a 09:00–11:00", "z 11:00–-", "c 11:01–12:01"]);
  });

  it("moves a pushed row one minute past the tie too, when it would be pushed onto it", () => {
    // Code review of 11.2: C starts before Z's new start, so it is pushed, and would land exactly on 11:00.
    const items = [
      item("a", "09:00", "10:00", "2026-10-01T08:00:00.000Z"),
      item("z", "10:00", null, "2026-10-01T10:00:00.000Z"),
      item("c", "10:30", "11:30", "2026-10-01T07:00:00.000Z"),
    ];
    const plan = planDayPush({
      items,
      legs: [],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "11:00" },
    });
    expect(times(plan)).toEqual(["a 09:00–11:00", "z 11:00–-", "c 11:01–12:01"]);
  });

  it("plans nothing for a save that leaves the times unchanged, even on a day that overlaps", () => {
    // Code review of 11.2: a title or notes save is not a retime. B overlaps A (an accepted overlap), and
    // C sits so late that a walk from A would refuse past midnight.
    const items = [item("a", "09:00", "10:00"), item("b", "09:30", "10:30"), item("c", "23:00", "23:59")];
    const plan = planDayPush({
      items,
      legs: [leg("b", "c", 900)],
      edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "10:00" },
    });
    expect(okPlan(plan).moves).toEqual([]);
    expect(times(plan)).toEqual(["a 09:00–10:00", "b 09:30–10:30", "c 23:00–23:59"]);
  });

  it("keeps the comparator's order: re-sorting every result yields the plan's order", () => {
    const scenarios: { items: PushItem[]; legs: PushLeg[]; edit: Parameters<typeof planDayPush>[0]["edit"] }[] = [
      { items: workedDay(), legs: [leg("b", "c", 20)], edit: { kind: "insert", item: item("m", "10:00", "11:30", "2026-10-02T00:00:00.000Z") } },
      { items: workedDay(), legs: [], edit: { kind: "retime", itemId: "a", fromTime: "13:30", toTime: "14:00" } },
      {
        items: [
          item("a", "09:00", "10:00", "2026-10-01T08:00:00.000Z"),
          item("z", "10:00", null, "2026-10-01T10:00:00.000Z"),
          item("c", "11:00", "12:00", "2026-10-01T07:00:00.000Z"),
          item("u", null, null),
        ],
        legs: [leg("z", "c", 0)],
        edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "11:00" },
      },
      {
        items: [
          item("a", "09:00", "10:00", "2026-10-01T08:00:00.000Z"),
          item("z", "10:00", null, "2026-10-01T10:00:00.000Z"),
          item("c", "10:30", "11:30", "2026-10-01T07:00:00.000Z"),
        ],
        legs: [],
        edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "11:00" },
      },
      {
        items: [...workedDay(), item("u", null, null), item("e", "16:30", "16:45")],
        legs: [leg("a", "b", 10), leg("c", "d", 200)],
        edit: { kind: "retime", itemId: "a", fromTime: "09:00", toTime: "12:00" },
      },
    ];

    for (const scenario of scenarios) {
      const plan = okPlan(planDayPush(scenario));
      const resorted = [...plan.order].sort(compareDayPlanItemsByStartTime).map((entry) => entry.id);
      expect(resorted).toEqual(plan.order.map((entry) => entry.id));
    }
  });
});

/**
 * Story 11.3 AC12. The reorder (*Nach oben* / *Nach unten*): a swap of the pair plus the 11.2 walk.
 */
describe("planDayReorder", () => {
  const okReorder = (plan: ReorderPlan) => {
    if (plan.status !== "ok") throw new Error(`expected ok, got ${plan.status}`);
    return plan;
  };
  const reorderTimes = (plan: ReorderPlan) =>
    okReorder(plan).order.map((entry) => `${entry.id} ${entry.fromTime ?? "-"}–${entry.toTime ?? "-"}`);

  it("absorbs the slack between the pair and keeps the slack after it", () => {
    const items = [item("a", "09:00", "10:00"), item("b", "10:30", "11:00"), item("c", "11:30", "12:30")];
    const plan = planDayReorder({ items, legs: [], itemId: "b", direction: "up" });

    expect(reorderTimes(plan)).toEqual(["b 09:00–09:30", "a 09:30–10:30", "c 11:30–12:30"]);
    expect(okReorder(plan).moves).toEqual([
      { itemId: "b", previousFromTime: "10:30", previousToTime: "11:00", fromTime: "09:00", toTime: "09:30" },
      { itemId: "a", previousFromTime: "09:00", previousToTime: "10:00", fromTime: "09:30", toTime: "10:30" },
    ]);
    expect(okReorder(plan).itemId).toBe("b");
    expect(okReorder(plan).neighbourId).toBe("a");
  });

  it("pushes the activities after an overlapping pair", () => {
    const items = [item("a", "09:00", "11:00"), item("b", "10:00", "10:30"), item("c", "11:00", "12:00")];
    const plan = planDayReorder({ items, legs: [], itemId: "b", direction: "up" });

    expect(reorderTimes(plan)).toEqual(["b 09:00–09:30", "a 09:30–11:30", "c 11:30–12:30"]);
    expect(okReorder(plan).moves.map((move) => move.itemId)).toEqual(["b", "a", "c"]);
  });

  it("counts a stored leg from the later row back to the earlier one", () => {
    const items = [item("a", "09:00", "10:00"), item("b", "10:00", "11:00")];
    const plan = planDayReorder({ items, legs: [leg("b", "a", 20), leg("a", "b", 45)], itemId: "b", direction: "up" });

    expect(reorderTimes(plan)).toEqual(["b 09:00–10:00", "a 10:20–11:20"]);
  });

  it("gives the same result for down on the predecessor as for up on the successor", () => {
    const days: { items: PushItem[]; legs: PushLeg[] }[] = [
      { items: [item("a", "09:00", "10:00"), item("b", "10:30", "11:00"), item("c", "11:30", "12:30")], legs: [] },
      { items: [item("a", "09:00", "11:00"), item("b", "10:00", "10:30"), item("c", "11:00", "12:00")], legs: [] },
      { items: [item("a", "09:00", "10:00"), item("b", "10:00", "11:00")], legs: [leg("b", "a", 20)] },
    ];
    for (const day of days) {
      const up = okReorder(planDayReorder({ ...day, itemId: "b", direction: "up" }));
      const down = okReorder(planDayReorder({ ...day, itemId: "a", direction: "down" }));
      expect(down.order).toEqual(up.order);
      expect(down.moves).toEqual(up.moves);
      expect(down.itemId).toBe("a");
      expect(down.neighbourId).toBe("b");
    }
  });

  it("refuses past midnight on the pair and names the earlier row", () => {
    const items = [item("a", "21:00", "23:00"), item("b", "22:00", "23:30")];
    expect(planDayReorder({ items, legs: [], itemId: "b", direction: "up" })).toEqual({
      status: "past_midnight",
      item: { id: "a", title: "A" },
    });
  });

  it("refuses past midnight on a pushed row and names that row", () => {
    const items = [item("a", "20:00", "22:00"), item("b", "21:00", "21:30"), item("c", "22:00", "23:50")];
    expect(planDayReorder({ items, legs: [], itemId: "b", direction: "up" })).toEqual({
      status: "past_midnight",
      item: { id: "c", title: "C" },
    });
  });

  it("refuses without a timed neighbour in that direction", () => {
    const items = [item("a", "09:00", "10:00"), item("b", "11:00", "12:00"), item("u", null, null)];
    expect(planDayReorder({ items, legs: [], itemId: "a", direction: "up" }).status).toBe("not_reorderable");
    expect(planDayReorder({ items, legs: [], itemId: "b", direction: "down" }).status).toBe("not_reorderable");
    expect(planDayReorder({ items, legs: [], itemId: "u", direction: "up" }).status).toBe("not_reorderable");
    expect(planDayReorder({ items, legs: [], itemId: "u", direction: "down" }).status).toBe("not_reorderable");
  });

  it("refuses a pair with a start time it cannot read", () => {
    const items = [item("a", "9h", "10:00"), item("b", "11:00", "12:00")];
    expect(planDayReorder({ items, legs: [], itemId: "b", direction: "up" }).status).toBe("not_reorderable");
  });

  it("refuses a move that would take an imported overnight end before 00:00", () => {
    const items = [item("a", "09:00", "10:00"), item("b", "23:00", "00:30")];
    expect(planDayReorder({ items, legs: [], itemId: "b", direction: "up" }).status).toBe("not_reorderable");
    expect(planDayReorder({ items, legs: [], itemId: "a", direction: "down" }).status).toBe("not_reorderable");
  });

  it("throws for an activity that is not on the day", () => {
    expect(() => planDayReorder({ items: [item("a", "09:00", "10:00")], legs: [], itemId: "x", direction: "up" })).toThrow();
  });

  it("moves the earlier row one minute past the tie a zero-length row would otherwise lose", () => {
    const items = [
      item("a", "09:00", "10:00", "2026-10-01T07:00:00.000Z"),
      item("b", "10:00", null, "2026-10-01T08:00:00.000Z"),
    ];
    const plan = planDayReorder({ items, legs: [], itemId: "b", direction: "up" });

    expect(reorderTimes(plan)).toEqual(["b 09:00–-", "a 09:01–10:01"]);
  });

  it("refuses the predecessor-side tie instead of moving anything earlier than the pair", () => {
    const items = [
      item("p", "09:00", "09:00", "2026-10-01T08:00:00.000Z"),
      item("a", "09:00", "10:00", "2026-10-01T09:00:00.000Z"),
      item("b", "10:00", "11:00", "2026-10-01T07:00:00.000Z"),
    ];
    expect(planDayReorder({ items, legs: [], itemId: "b", direction: "up" }).status).toBe("not_reorderable");
  });

  it("keeps the comparator's order: re-sorting puts the moved row directly before its neighbour", () => {
    // A small deterministic PRNG, so the property runs the same days every time.
    let seed = 1103;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pad = (value: number) => String(value).padStart(2, "0");
    const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

    let checked = 0;
    for (let round = 0; round < 200; round += 1) {
      const count = 2 + Math.floor(random() * 5);
      const items: PushItem[] = [];
      for (let index = 0; index < count; index += 1) {
        const id = `i${index}`;
        if (random() < 0.15) {
          items.push(item(id, null, null, `2026-10-01T0${index}:00:00.000Z`));
          continue;
        }
        const start = 6 * 60 + Math.floor(random() * 8) * 30;
        const length = [0, 15, 30, 60, 90][Math.floor(random() * 5)];
        const createdAt = `2026-10-01T0${Math.floor(random() * 9)}:00:00.000Z`;
        items.push(item(id, hhmm(start), length === 0 && random() < 0.5 ? null : hhmm(start + length), createdAt));
      }
      const legs: PushLeg[] = [];
      for (const from of items) {
        for (const to of items) {
          if (from.id !== to.id && random() < 0.1) legs.push(leg(from.id, to.id, Math.floor(random() * 40)));
        }
      }
      const sorted = [...items].sort(compareDayPlanItemsByStartTime);
      sorted.forEach((entry, index) => {
        const directions = [
          ...(entry.fromTime && index > 0 && sorted[index - 1].fromTime ? (["up"] as const) : []),
          ...(entry.fromTime && sorted[index + 1]?.fromTime ? (["down"] as const) : []),
        ];
        for (const direction of directions) {
          const plan = planDayReorder({ items, legs, itemId: entry.id, direction });
          if (plan.status !== "ok") continue;
          checked += 1;
          const ids = plan.order.map((row) => row.id);
          expect([...plan.order].sort(compareDayPlanItemsByStartTime).map((row) => row.id)).toEqual(ids);
          const before = sorted.map((row) => row.id);
          const lower = Math.min(index, direction === "up" ? index - 1 : index + 1);
          const expected = [...before];
          [expected[lower], expected[lower + 1]] = [expected[lower + 1], expected[lower]];
          expect(ids).toEqual(expected);
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
  });
});
