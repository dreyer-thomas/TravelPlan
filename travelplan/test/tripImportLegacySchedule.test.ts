import { describe, expect, it } from "vitest";
import { legacyScheduleFields } from "@/lib/trips/legacySchedule";

/**
 * Story 13.1 AC15. A backup made before Story 13.4 carries no schedule fields, so the import gives each row
 * the migration's: the same cases as `migrationDayPlanItemSchedule.test.ts`, in import order (the array
 * order is the creation order the tiebreak reads). That test also runs this helper against the migration.
 */

const fields = (items: Array<[string | null, string | null]>) =>
  legacyScheduleFields(items.map(([fromTime, toTime]) => ({ fromTime, toTime }))).map(
    (row) => `${row.sortOrder} ${row.scheduleMode} ${row.durationMinutes} ${row.fromTime ?? "-"}–${row.toTime ?? "-"}`,
  );

describe("legacyScheduleFields (Story 13.1 AC15)", () => {
  it("makes every validly timed row FIXED with its true duration and unchanged times, in start order", () => {
    expect(
      fields([
        ["09:00", "10:00"],
        ["10:30", "12:00"],
        ["08:00", "08:01"],
      ]),
    ).toEqual(["1 FIXED 60 09:00–10:00", "2 FIXED 90 10:30–12:00", "0 FIXED 1 08:00–08:01"]);
  });

  it("breaks a start tie by array order", () => {
    expect(
      fields([
        ["14:00", "15:00"],
        ["14:00", "14:30"],
      ]),
    ).toEqual(["0 FIXED 60 14:00–15:00", "1 FIXED 30 14:00–14:30"]);
  });

  it("makes untimed rows and the §5 shapes FLEXIBLE/15, appended after the latest fixed end", () => {
    expect(
      fields([
        [null, null],
        ["11:00", "12:30"],
        ["13:00", null],
        ["16:00", "15:00"],
        [null, null],
        ["08:00", "09:00"],
      ]),
    ).toEqual([
      "4 FLEXIBLE 15 13:00–13:15",
      "1 FIXED 90 11:00–12:30",
      "2 FLEXIBLE 15 12:30–12:45",
      "3 FLEXIBLE 15 12:45–13:00",
      "5 FLEXIBLE 15 13:15–13:30",
      "0 FIXED 60 08:00–09:00",
    ]);
  });

  it("starts at 10:00 on a day with no fixed row, and treats an empty string as no time", () => {
    expect(
      fields([
        [null, null],
        ["", ""],
      ]),
    ).toEqual(["0 FLEXIBLE 15 10:00–10:15", "1 FLEXIBLE 15 10:15–10:30"]);
  });

  it("keeps null times on a row whose end would pass 23:59", () => {
    expect(
      fields([
        ["22:30", "23:30"],
        [null, null],
        [null, null],
        [null, null],
      ]),
    ).toEqual([
      "0 FIXED 60 22:30–23:30",
      "1 FLEXIBLE 15 23:30–23:45",
      "2 FLEXIBLE 15 -–-",
      "3 FLEXIBLE 15 -–-",
    ]);
  });

  it("does not treat a time without two digits of hour as valid, as the migration's GLOB does not", () => {
    expect(fields([["9:00", "10:00"]])).toEqual(["0 FLEXIBLE 15 10:00–10:15"]);
  });
});
