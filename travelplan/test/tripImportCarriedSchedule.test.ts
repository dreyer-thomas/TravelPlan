import { describe, expect, it } from "vitest";
import { carriedScheduleFields, type CarriedScheduleInput } from "@/lib/trips/legacySchedule";

/**
 * Story 13.4 §18. A day whose activities carry their schedule fields is restored exactly: order densified,
 * FIXED kept where it has times, FIXED without them normalised to FLEXIBLE, FLEXIBLE kept, no recompute.
 */

const row = (
  scheduleMode: CarriedScheduleInput["scheduleMode"],
  durationMinutes: number,
  sortOrder: number,
  fromTime: string | null,
  toTime: string | null,
): CarriedScheduleInput => ({ scheduleMode, durationMinutes, sortOrder, fromTime, toTime });

const fields = (items: CarriedScheduleInput[]) =>
  carriedScheduleFields(items).map(
    (entry) => `${entry.sortOrder} ${entry.scheduleMode} ${entry.durationMinutes} ${entry.fromTime ?? "-"}–${entry.toTime ?? "-"}`,
  );

describe("carriedScheduleFields (Story 13.4)", () => {
  it("densifies the order (0, 2, 7 → 0, 1, 2) and keeps a dense one, in input order", () => {
    expect(fields([row("FLEXIBLE", 30, 7, null, null), row("FIXED", 60, 0, "09:00", "10:00"), row("FLEXIBLE", 15, 2, "10:00", "10:15")])).toEqual([
      "2 FLEXIBLE 30 -–-",
      "0 FIXED 60 09:00–10:00",
      "1 FLEXIBLE 15 10:00–10:15",
    ]);
    expect(carriedScheduleFields([row("FLEXIBLE", 5, 1, null, null), row("FLEXIBLE", 5, 0, null, null)]).map((entry) => entry.sortOrder)).toEqual([1, 0]);
  });

  it("keeps a FIXED row with valid times as it is, its duration as carried", () => {
    expect(fields([row("FIXED", 45, 0, "14:00", "15:30")])).toEqual(["0 FIXED 45 14:00–15:30"]);
  });

  it("restores a FIXED row without two valid times as FLEXIBLE, times as carried", () => {
    expect(fields([row("FIXED", 15, 0, null, null), row("FIXED", 20, 1, "11:00", "10:00")])).toEqual([
      "0 FLEXIBLE 15 -–-",
      "1 FLEXIBLE 20 11:00–10:00",
    ]);
  });

  it("keeps FLEXIBLE rows, a one-minute one and an overflow one without times, untouched", () => {
    expect(fields([row("FLEXIBLE", 1, 0, "09:00", "09:01"), row("FLEXIBLE", 600, 1, null, null)])).toEqual([
      "0 FLEXIBLE 1 09:00–09:01",
      "1 FLEXIBLE 600 -–-",
    ]);
  });
});
