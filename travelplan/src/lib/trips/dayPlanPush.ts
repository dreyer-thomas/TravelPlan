/**
 * Story 11.2 (FR42). The push rule: when an activity is inserted, retimed or extended, every later timed
 * activity moves back just as far as it has to, and no further.
 *
 * One pure function over the day's timeline. No Prisma import and no clock, so the rule is unit-tested
 * on its own (`test/dayPlanPush.test.ts`) and the repository (`dayPlanItemRepo.ts`) only reads the day,
 * calls it, and writes what it returns, all inside the edit's own transaction.
 *
 * The rule, as the story states it:
 *
 * - **Order first.** The day is ordered with the canonical `compareDayPlanItemsByStartTime`. A *retime*
 *   keeps the edited activity at its index (a time change never reorders; reordering is Story 11.3's
 *   `planDayReorder`, below, a swap of a pair followed by the same walk), so a start that would sort before its timed predecessor is refused (`before_predecessor`).
 *   An *insert* (a new activity, or an untimed one given a time) slots in where the comparator sorts it
 *   and never refuses on order.
 * - **The walk.** From the edited activity, each following timed activity may start no earlier than the
 *   previous one's end plus the duration of the stored leg between them (directional, activity to
 *   activity), or the previous end if there is none. One that starts earlier moves to exactly that start
 *   and keeps its duration. The first one that already fits stops the walk.
 * - **Never past midnight.** A shifted `fromTime` or `toTime` above `23:59` refuses the whole change and
 *   names that activity (`past_midnight`). Nothing is clamped.
 * - **Untimed activities** sort after every timed one, so the walk ends where they begin. They are never
 *   given a time.
 *
 * Order is preserved by construction: a pushed activity starts at or after its predecessor's end, which
 * is strictly after its predecessor's start whenever anything moves. The one tie the arithmetic alone
 * cannot rule out is an imported zero-length row (`toTime` null) that is pushed onto the exact start of
 * the row after it, where the comparator's `createdAt` tiebreak could put the later row first. That row
 * is moved one minute past the tie, the smallest shift that keeps the order, whether it would otherwise
 * have fitted or been pushed onto the tie itself (ruled in the Story 11.2 code review; see `planDayPush`).
 *
 * A retime whose times equal the stored ones (a title or notes save) plans nothing.
 *
 * Story 11.4 gives the walk a third entry point, `planDayPushFrom`, for the two changes that are not an
 * activity: a leg save (the walk starts at the activity the leg leaves) and last night's check-out (the
 * walk starts at a zero-length stand-in for the check-out). `planDayPush` (11.2) and `planDayReorder`
 * (11.3) are the other two; all three share `walkFrom`.
 */

import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";

export type PushItem = {
  id: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  createdAt: Date | string;
};

/**
 * A stored `DAY_PLAN_ITEM → DAY_PLAN_ITEM` leg. Legs to or from a stay never take part in
 * `planDayPush`/`planDayReorder`; `planDayPushFrom`'s `afterCheckOut` carries the stay leg as a number
 * (11.2 narrowed by 11.4).
 */
export type PushLeg = { fromItemId: string; toItemId: string; durationMinutes: number };

export type PushEdit =
  /** A create, or an untimed activity given a time. */
  | { kind: "insert"; item: PushItem }
  /** An already-timed activity given new times. */
  | { kind: "retime"; itemId: string; fromTime: string; toTime: string };

export type PushMove = {
  itemId: string;
  previousFromTime: string;
  previousToTime: string | null;
  fromTime: string;
  toTime: string | null;
};

export type PushPlan =
  /** `order` is the day after the change and the push, timed then untimed; `moves` in walk order. */
  | { status: "ok"; order: PushItem[]; moves: PushMove[] }
  | { status: "before_predecessor"; predecessor: { id: string; title: string | null; fromTime: string } }
  | { status: "past_midnight"; item: { id: string; title: string | null } };

/** `HH:MM` has no 24:00 (`normalizeTime` caps hours at 23), so the last storable minute is 23:59. */
export const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** Minutes since midnight, or `null` for anything that is not a readable `HH:MM` (an odd import). */
export const timeToMinutes = (value: string | null): number | null => {
  if (!value) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * Zero-padded `HH:MM`. Only called for values the midnight check has already bounded. Exported for Story
 * 12.4's time chain (`suggestionPlan.ts`), so there is one formatter.
 */
export const minutesToTime = (value: number): string =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

const isTimed = (item: PushItem) => Boolean(item.fromTime);

/**
 * The end of an activity in minutes: its `toTime` when that is set and after its start, otherwise its
 * start (a zero-length row, or an overnight `23:00–01:00` pair from an import). `null` when even the
 * start is unreadable.
 */
export const activityEndMinutes = (item: Pick<PushItem, "fromTime" | "toTime">): number | null => {
  const start = timeToMinutes(item.fromTime);
  if (start === null) return null;
  const end = timeToMinutes(item.toTime);
  return end !== null && end > start ? end : start;
};

const legKey = (fromItemId: string, toItemId: string) => `${fromItemId}\u0000${toItemId}`;

const buildLegMinutes = (legs: PushLeg[]): Map<string, number> => {
  const legMinutes = new Map<string, number>();
  for (const leg of legs) {
    const key = legKey(leg.fromItemId, leg.toItemId);
    if (!legMinutes.has(key)) legMinutes.set(key, leg.durationMinutes);
  }
  return legMinutes;
};

type WalkResult = { status: "ok"; moves: PushMove[] } | { status: "past_midnight"; item: { id: string; title: string | null } };

/**
 * The walk itself, shared by `planDayPush` and `planDayReorder`. It starts after `order[startIndex]`,
 * rewrites each pushed row of `order` in place, and returns the moves in walk order. `startMoved` says
 * whether the row at `startIndex` was itself moved by the change, which is what arms the zero-length tie
 * guard for the first step (a retime or insert passes `false`, the reorder's moved pair `true`).
 */
const walkFrom = (
  order: PushItem[],
  startIndex: number,
  legMinutes: Map<string, number>,
  startMoved: boolean,
): WalkResult => {
  const moves: PushMove[] = [];
  let previous = order[startIndex];
  let previousMoved = startMoved;

  for (let index = startIndex + 1; index < order.length; index += 1) {
    const next = order[index];
    if (!isTimed(next)) break;

    const previousEnd = activityEndMinutes(previous);
    const nextStart = timeToMinutes(next.fromTime);
    // An unreadable time on either side gives the walk nothing to compute with. Stopping is the
    // conservative answer: it moves nothing it cannot reason about.
    if (previousEnd === null || nextStart === null) break;

    // The tie described in the module docblock: `next` would start exactly where a pushed zero-length
    // `previous` does, and the comparator's `createdAt` tiebreak would sort `next` first.
    const previousStart = timeToMinutes(previous.fromTime);
    const tieWouldFlip = (start: number) =>
      previousMoved &&
      start === previousStart &&
      compareDayPlanItemsByStartTime({ ...next, fromTime: previous.fromTime }, previous) < 0;

    let earliest = previousEnd + (legMinutes.get(legKey(previous.id, next.id)) ?? 0);
    if (nextStart >= earliest) {
      // It fits, unless it ties.
      if (!tieWouldFlip(nextStart)) break;
      earliest = nextStart + 1;
    } else if (tieWouldFlip(earliest)) {
      // It is pushed, and would be pushed onto the tie: one minute further.
      earliest += 1;
    }

    const shift = earliest - nextStart;
    const moved = shiftItem(next, shift);
    if (!moved) return { status: "past_midnight", item: { id: next.id, title: next.title } };

    moves.push(toMove(next, moved));
    order[index] = moved;
    previous = moved;
    previousMoved = true;
  }

  return { status: "ok", moves };
};

/**
 * `item` with both times shifted by `shift` minutes, keeping its duration. An unreadable `toTime` is left
 * exactly as it was rather than rewritten. `null` when a shifted time would leave the day (past `23:59`,
 * or, for the reorder's earlier shift, before `00:00`).
 */
const shiftItem = (item: PushItem, shift: number): PushItem | null => {
  const start = timeToMinutes(item.fromTime);
  if (start === null) return null;
  const end = timeToMinutes(item.toTime);
  const shiftedFrom = start + shift;
  const shiftedTo = end === null ? null : end + shift;
  const outOfDay = (value: number) => value < 0 || value > LAST_MINUTE_OF_DAY;
  if (outOfDay(shiftedFrom) || (shiftedTo !== null && outOfDay(shiftedTo))) return null;
  return {
    ...item,
    fromTime: minutesToTime(shiftedFrom),
    toTime: shiftedTo === null ? item.toTime : minutesToTime(shiftedTo),
  };
};

const toMove = (before: PushItem, after: PushItem): PushMove => ({
  itemId: before.id,
  previousFromTime: before.fromTime!,
  previousToTime: before.toTime,
  fromTime: after.fromTime!,
  toTime: after.toTime,
});

export const planDayPush = (input: { items: PushItem[]; legs: PushLeg[]; edit: PushEdit }): PushPlan => {
  const { items, legs, edit } = input;

  const legMinutes = buildLegMinutes(legs);

  let order: PushItem[];
  let editedIndex: number;

  if (edit.kind === "insert") {
    // An untimed row given a time is in `items` already: take it out, then sort it back in.
    order = [...items.filter((item) => item.id !== edit.item.id), edit.item].sort(compareDayPlanItemsByStartTime);
    editedIndex = order.findIndex((item) => item.id === edit.item.id);
  } else {
    order = [...items].sort(compareDayPlanItemsByStartTime);
    editedIndex = order.findIndex((item) => item.id === edit.itemId);
    if (editedIndex < 0) {
      throw new Error("planDayPush: the retimed activity is not on the day");
    }
    const current = order[editedIndex];
    // A save that leaves the times as they are (a title or notes edit) is not a retime: it moves
    // nothing, even where the day already overlaps, and is never refused.
    if (current.fromTime === edit.fromTime && current.toTime === edit.toTime) {
      return { status: "ok", order, moves: [] };
    }
    const edited: PushItem = { ...current, fromTime: edit.fromTime, toTime: edit.toTime };
    const predecessor = editedIndex > 0 ? order[editedIndex - 1] : null;
    // Timed rows come first, so the row directly before a timed one is timed whenever it exists. The
    // comparator, not `<`, decides: an equal start is a tie that `createdAt` settles.
    if (predecessor && isTimed(predecessor) && compareDayPlanItemsByStartTime(edited, predecessor) < 0) {
      return {
        status: "before_predecessor",
        predecessor: { id: predecessor.id, title: predecessor.title, fromTime: predecessor.fromTime! },
      };
    }
    // The edited row keeps its index; nothing is re-sorted.
    order = order.map((item, index) => (index === editedIndex ? edited : item));
  }

  const walked = walkFrom(order, editedIndex, legMinutes, false);
  if (walked.status === "past_midnight") return walked;
  return { status: "ok", order, moves: walked.moves };
};


export type ReorderDirection = "up" | "down";

export type ReorderPlan =
  /** `order` is the day after the swap and the push; `moves` lists the pair (later row first), then the walk's. */
  | { status: "ok"; order: PushItem[]; moves: PushMove[]; itemId: string; neighbourId: string }
  | { status: "not_reorderable" }
  | { status: "past_midnight"; item: { id: string; title: string | null } };

/**
 * Story 11.3 (FR43). *Nach oben* / *Nach unten*: the activity and its timed neighbour in that direction
 * trade places, and the 11.2 walk runs on from the pair.
 *
 * `first` is the earlier row of the pair, `second` the later; which one the user chose depends on the
 * direction, and both directions give the same result for the same pair.
 *
 * 1. `second` takes `first`'s start and keeps its duration (it only ever moves earlier).
 * 2. `first` starts at `second`'s new end plus the stored leg `second → first`, and keeps its duration.
 *    Where that start ties `second`'s (a zero-length `second`, no leg) and `createdAt` would still sort
 *    `first` first, it moves one minute later: 11.2's tie rule, applied to the pair.
 * 3. `second` would tie the row before the pair on start and lose it to `createdAt` (the predecessor-side
 *    tie): refused, because the only fix would move something earlier than the pair's start.
 * 4. The walk runs from `first` over the rest of the day, exactly as for a retime.
 *
 * Refusals: `not_reorderable` for an untimed row, no timed neighbour in that direction, a start either
 * row cannot read, a shift that would leave the day before `00:00`, or the predecessor-side tie;
 * `past_midnight` naming the first row whose shifted time would pass `23:59`. Throws when `itemId` is not
 * on the day; the repository checks that first.
 */
export const planDayReorder = (input: {
  items: PushItem[];
  legs: PushLeg[];
  itemId: string;
  direction: ReorderDirection;
}): ReorderPlan => {
  const { items, legs, itemId, direction } = input;
  const order = [...items].sort(compareDayPlanItemsByStartTime);
  const index = order.findIndex((entry) => entry.id === itemId);
  if (index < 0) {
    throw new Error("planDayReorder: the activity is not on the day");
  }

  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  const neighbour = order[neighbourIndex];
  if (!neighbour || !isTimed(order[index]) || !isTimed(neighbour)) return { status: "not_reorderable" };

  const lowerIndex = Math.min(index, neighbourIndex);
  const first = order[lowerIndex];
  const second = order[lowerIndex + 1];
  const firstStart = timeToMinutes(first.fromTime);
  const secondStart = timeToMinutes(second.fromTime);
  if (firstStart === null || secondStart === null) return { status: "not_reorderable" };

  const legMinutes = buildLegMinutes(legs);

  const secondMoved = shiftItem(second, firstStart - secondStart);
  // It only moves earlier, so the one way out of the day is an imported overnight `toTime` before 00:00.
  if (!secondMoved) return { status: "not_reorderable" };

  let firstNewStart = activityEndMinutes(secondMoved)! + (legMinutes.get(legKey(second.id, first.id)) ?? 0);
  if (
    firstNewStart <= LAST_MINUTE_OF_DAY &&
    compareDayPlanItemsByStartTime({ ...first, fromTime: minutesToTime(firstNewStart) }, secondMoved) < 0
  ) {
    firstNewStart += 1;
  }
  const firstMoved = shiftItem(first, firstNewStart - firstStart);
  if (!firstMoved) return { status: "past_midnight", item: { id: first.id, title: first.title } };

  const predecessor = lowerIndex > 0 ? order[lowerIndex - 1] : null;
  if (predecessor && compareDayPlanItemsByStartTime(secondMoved, predecessor) < 0) {
    return { status: "not_reorderable" };
  }

  order[lowerIndex] = secondMoved;
  order[lowerIndex + 1] = firstMoved;

  const walked = walkFrom(order, lowerIndex + 1, legMinutes, true);
  if (walked.status === "past_midnight") return walked;

  return {
    status: "ok",
    order,
    moves: [toMove(second, secondMoved), toMove(first, firstMoved), ...walked.moves],
    itemId,
    neighbourId: neighbour.id,
  };
};

/** Story 11.4. Where `planDayPushFrom` starts the walk. */
export type PushStart =
  /** A leg A→B: walk from A; `legs` already holds the leg's new duration. */
  | { kind: "afterItem"; itemId: string }
  /** Last night's stay: the day's first activity may start no earlier than `minute + legMinutes`. */
  | { kind: "afterCheckOut"; minute: number; legMinutes: number };

/**
 * Stands in for last night's check-out while the walk runs, the `NEW_ITEM_ID` idiom: no stored leg can
 * name it, and it never leaves this function.
 */
const CHECK_OUT_ID = "\u0000checkout";

/**
 * Story 11.4 (FR42). The walk from something that is not an edited activity: a leg save, or a later
 * check-out of last night's stay. Nothing is re-sorted and nothing is refused on order, so the answer is
 * only ever `ok` or `past_midnight`.
 *
 * - `afterItem`: the walk starts at that activity. An untimed or unreadable one gives it nothing to
 *   start from, so nothing moves. Throws when the activity is not on the day; the repository checks first.
 * - `afterCheckOut`: a zero-length stand-in at `minute` is put before the day's first row, with
 *   `legMinutes` as its leg to that row, and the walk starts there. `startMoved` is `false`, so the tie
 *   guard never applies to the stand-in. An untimed first row stops the walk at once.
 */
export const planDayPushFrom = (input: { items: PushItem[]; legs: PushLeg[]; start: PushStart }): PushPlan => {
  const { items, legs, start } = input;
  const order = [...items].sort(compareDayPlanItemsByStartTime);
  const legMinutes = buildLegMinutes(legs);

  if (start.kind === "afterItem") {
    const index = order.findIndex((entry) => entry.id === start.itemId);
    if (index < 0) {
      throw new Error("planDayPushFrom: the activity is not on the day");
    }
    const walked = walkFrom(order, index, legMinutes, false);
    if (walked.status === "past_midnight") return walked;
    return { status: "ok", order, moves: walked.moves };
  }

  if (order.length === 0) return { status: "ok", order, moves: [] };
  const checkOut: PushItem = {
    id: CHECK_OUT_ID,
    title: null,
    fromTime: minutesToTime(start.minute),
    toTime: null,
    createdAt: new Date(0),
  };
  legMinutes.set(legKey(CHECK_OUT_ID, order[0].id), start.legMinutes);
  const withCheckOut = [checkOut, ...order];
  const walked = walkFrom(withCheckOut, 0, legMinutes, false);
  if (walked.status === "past_midnight") return walked;
  return { status: "ok", order: withCheckOut.slice(1), moves: walked.moves };
};
