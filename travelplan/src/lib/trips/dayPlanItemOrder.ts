/**
 * Story 8.5 (`DW-148`, `DW-151`). The order a day's activities happen in — one rule, in one place,
 * for the two layers whose disagreement about it *was* the defect this story closes.
 *
 * Which pairs of activities are *adjacent* is what decides whether a travel leg can exist, is drawn,
 * and is counted — so the screen and the adjacency rule have to answer it identically. Two things
 * make that easy to get wrong, and one of them nearly did:
 *
 * 1. The Prisma query behind `GET /api/trips/{id}` orders `dayPlanItems` by `createdAt`
 *    (`tripRepo.ts`, the select's `orderBy`), and the day view renders the array it is handed. What
 *    saves it is a second sort a hundred lines later — `[...day.dayPlanItems].sort(...)` in the same
 *    repository — which used to apply a private, byte-identical copy of *this* rule and now calls this
 *    function (it sorts the print payload too). So the screen was ordered correctly only because of a
 *    line in a mapping function nothing on the client can see. That is an implicit dependency of the
 *    kind this whole story is about, and it is pinned by a test now (`tripDetailRoute.test.ts`).
 * 2. `fromTime` alone is not a total order. Two activities starting at the same minute are separated
 *    by `createdAt` and then `id`, and the payload dropped `createdAt` entirely — so a client sorting
 *    for itself could not reach the server's answer even in principle. It is carried now.
 *
 * Hence one exported comparator: `travelSegmentRepo.ts` decides adjacency with it and
 * `TripDayView.tsx` orders the activities it renders with it, so the screen's order is the adjacency
 * order *because it is the same function*, not because two files happen to agree today.
 *
 * **`createdAt` is `Date | string` on purpose.** The repository holds a Prisma `Date`; the client
 * holds whatever `JSON.parse` left of it, an ISO string. Both are the same instant and both must sort
 * the same way, so the conversion lives here once instead of at each call site.
 *
 * Scope, stated so it is not misread as an invariant, and corrected in review: `tripRepo.ts` held a
 * third byte-identical copy — the one that ordered both the day payload and the print payload — and it
 * imports this module now, so the print payload is covered by the same rule through it. The last
 * private copy, `dayPlanItemRepo.ts`'s (`DW-216`), was retired by Story 11.2, whose push walk orders the
 * day with this function too. There are no copies left.
 */

export type DayPlanItemOrderable = {
  /** Story 13.1. The day's order, dense (0…n−1) per day; see `compareDayPlanItemsByOrder`. */
  sortOrder: number;
  fromTime: string | null;
  createdAt: Date | string;
  id: string;
};

/**
 * Milliseconds for either representation, or `null` when there is no instant to be had — an absent
 * field, an empty string, an unparseable one.
 *
 * `null` rather than `0`, which is the review correction. Collapsing to `0` made two items that both
 * lack a `createdAt` *tie* on the creation key, and the tie then fell through to `id.localeCompare` —
 * so the fallback for "we do not know when these were created" was to re-sort them by id. On a payload
 * without `createdAt` (the case the type comment above admits, and the one an older cached response
 * produces) two 09:00 activities named `zzz` and `aaa` came out reversed: the screen drew
 * `aaa → zzz`, and offered the one leg the server accepts, `zzz → aaa`, for deletion as an orphan.
 * Returning `NaN` upward would be worse still — `Array.prototype.sort` is implementation-defined for a
 * comparator that returns it.
 */
const toMillis = (value: Date | string): number | null => {
  const millis = typeof value === "string" ? Date.parse(value) : value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isFinite(millis) ? millis : null;
};

/**
 * Before Story 13.1 this was the day's order itself (exported as `compareDayPlanItemsByStartTime`): timed
 * activities first, in start-time order; untimed ones after, in creation order; `id` breaks a remaining
 * tie so the order is total and stable across processes. It survives only as the tiebreak below.
 *
 * `fromTime` is a `HH:MM` string, which sorts correctly lexicographically, so no parsing is needed.
 */
const compareByStartTime = (left: DayPlanItemOrderable, right: DayPlanItemOrderable): number => {
  const leftHasStart = Boolean(left.fromTime);
  const rightHasStart = Boolean(right.fromTime);
  if (leftHasStart && rightHasStart) {
    if (left.fromTime !== right.fromTime) return left.fromTime!.localeCompare(right.fromTime!);
  } else if (leftHasStart !== rightHasStart) {
    return leftHasStart ? -1 : 1;
  }

  const leftTime = toMillis(left.createdAt);
  const rightTime = toMillis(right.createdAt);
  // Unknown on either side ends the comparison *before* the `id` tiebreak. `0` from a comparator means
  // "leave these two as they are", and `Array.prototype.sort` has been stable since ES2019, so the
  // incoming order survives — and the incoming order is the server's, which is the only order that
  // could be right when the field that would decide it is missing. Falling through to `id` instead
  // would not be a tiebreak but an active re-sort by an arbitrary key (see `toMillis`).
  if (leftTime === null || rightTime === null) return 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
};

/**
 * Story 13.1 (FR42). The day's order: `sortOrder` ascending, which every write renumbers densely inside its
 * own transaction, so the day view, the gantts, print, adjacency, the route points and the schedule rule
 * all read one order because they call one function.
 *
 * **The tiebreak is the old start-time order on purpose**, not only `id` as the 2026-10-17 proposal wrote
 * it. In production two rows of one day never share a `sortOrder` (it is dense), so the tiebreak cannot be
 * observed there. It matters for rows a test seeds straight through Prisma, which all take the schema
 * default `0`: `id` would scramble them, start-time order keeps them in the order their times describe,
 * which is the order the migration gives real rows too.
 */
export const compareDayPlanItemsByOrder = (left: DayPlanItemOrderable, right: DayPlanItemOrderable): number => {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return compareByStartTime(left, right);
};
