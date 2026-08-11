import { describe, expect, it } from "vitest";
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";

/**
 * Story 8.5. A direct suite for the rule two layers now share.
 *
 * It has one until now: this comparator existed as a private copy inside `travelSegmentRepo.ts` and
 * was exercised only through the segment routes, while the screen that draws the same day's legs
 * ordered its activities differently. A rule tested only through its consumers is exactly how two
 * consumers come to disagree about it without anything going red, so the rule is pinned here on its
 * own — including the `Date | string` equivalence, which is the whole reason it could be shared at
 * all (the repository holds a Prisma `Date`, the client an ISO string off the wire).
 */

const item = (id: string, fromTime: string | null, createdAt: Date | string) => ({ id, fromTime, createdAt });
const sortIds = (items: ReturnType<typeof item>[]) =>
  [...items].sort(compareDayPlanItemsByStartTime).map((entry) => entry.id);

const T1 = "2026-01-01T08:00:00.000Z";
const T2 = "2026-01-02T08:00:00.000Z";

describe("compareDayPlanItemsByStartTime", () => {
  it("orders two timed activities by their start time, whatever order they arrive in", () => {
    const museum = item("museum", "09:00", T2);
    const dinner = item("dinner", "19:00", T1);

    // Both input orders, because the point of the shared rule is that the answer does not depend on
    // the order the rows arrive in: entered late, happens first.
    expect(sortIds([dinner, museum])).toEqual(["museum", "dinner"]);
    expect(sortIds([museum, dinner])).toEqual(["museum", "dinner"]);
  });

  it("compares start times as strings, which is correct for zero-padded HH:MM", () => {
    const nine = item("nine", "09:30", T1);
    const ten = item("ten", "10:00", T1);
    const twentyOne = item("twenty-one", "21:05", T1);

    expect(sortIds([twentyOne, ten, nine])).toEqual(["nine", "ten", "twenty-one"]);
  });

  it("puts a timed activity ahead of an untimed one regardless of when either was created", () => {
    const timed = item("timed", "18:00", T2);
    const untimed = item("untimed", null, T1);

    expect(sortIds([untimed, timed])).toEqual(["timed", "untimed"]);
    expect(sortIds([timed, untimed])).toEqual(["timed", "untimed"]);
  });

  it("falls back to creation order for two activities that start at the same minute", () => {
    const later = item("later", "09:00", T2);
    const earlier = item("earlier", "09:00", T1);

    expect(sortIds([later, earlier])).toEqual(["earlier", "later"]);
  });

  it("falls back to creation order for two untimed activities", () => {
    const later = item("later", null, T2);
    const earlier = item("earlier", null, T1);

    expect(sortIds([later, earlier])).toEqual(["earlier", "later"]);
  });

  it("breaks a remaining tie by id, so the order is total rather than merely mostly-defined", () => {
    const b = item("b", "09:00", T1);
    const a = item("a", "09:00", T1);

    expect(sortIds([b, a])).toEqual(["a", "b"]);
  });

  /**
   * The point of the shared module: the repository passes `Date`, the day view passes what
   * `JSON.parse` left of the same instant. Two representations sorting differently would put the
   * screen and the adjacency rule back into disagreement, one tie at a time.
   */
  it("gives the same answer for a Date and for its ISO string", () => {
    const asDates = [item("later", "09:00", new Date(T2)), item("earlier", "09:00", new Date(T1))];
    const asStrings = [item("later", "09:00", T2), item("earlier", "09:00", T1)];
    const mixed = [item("later", "09:00", new Date(T2)), item("earlier", "09:00", T1)];

    expect(sortIds(asDates)).toEqual(["earlier", "later"]);
    expect(sortIds(asStrings)).toEqual(["earlier", "later"]);
    expect(sortIds(mixed)).toEqual(["earlier", "later"]);
  });

  /**
   * A payload built before `createdAt` was carried, or a fixture that omits it, must not make the
   * comparator return `NaN` — `Array.prototype.sort` with a `NaN` comparator is
   * implementation-defined, which would be a far stranger failure than the tie this collapses to.
   *
   * **And the tie has to stop at the tie.** Review correction: the missing value used to collapse to
   * `0` milliseconds, so two items that both lack a `createdAt` tied on the creation key and fell
   * through to `id.localeCompare` — which does not break a tie, it *re-sorts*. The pair below is the
   * shape that costs something: on a payload without `createdAt` the day view drew `aaa → zzz` and
   * offered `zzz → aaa`, the one leg the server accepts, for deletion as an orphan. `0` here means
   * "leave them alone", and `Array.prototype.sort` being stable, the server's order survives.
   */
  it("leaves two activities alone when either side's createdAt is missing, rather than re-sorting by id", () => {
    const zzz = item("zzz", "09:00", "");
    const aaa = item("aaa", "09:00", "");

    expect(compareDayPlanItemsByStartTime(zzz, aaa)).toBe(0);
    expect(sortIds([zzz, aaa])).toEqual(["zzz", "aaa"]);
    expect(sortIds([aaa, zzz])).toEqual(["aaa", "zzz"]);
  });

  it("leaves the pair alone when only one side's createdAt is unparseable", () => {
    const known = item("zzz", "09:00", T1);
    const unknown = item("aaa", "09:00", "not-a-date");

    // Nothing can be concluded from one instant, so nothing is: the incoming order stands either way.
    expect(compareDayPlanItemsByStartTime(known, unknown)).toBe(0);
    expect(compareDayPlanItemsByStartTime(unknown, known)).toBe(0);
    expect(sortIds([known, unknown])).toEqual(["zzz", "aaa"]);
    expect(sortIds([unknown, known])).toEqual(["aaa", "zzz"]);
  });

  /** The `id` tiebreak still applies where it is a tiebreak: both instants known and equal. */
  it("still breaks a tie by id when both activities carry the same real createdAt", () => {
    const b = item("b", "09:00", T1);
    const a = item("a", "09:00", T1);

    expect(sortIds([b, a])).toEqual(["a", "b"]);
  });
});
