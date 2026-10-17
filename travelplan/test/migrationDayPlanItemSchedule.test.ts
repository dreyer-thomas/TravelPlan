import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legacyScheduleFields } from "@/lib/trips/legacySchedule";

/**
 * Story 13.1 AC2. The first migration test: every earlier migration is applied to a fresh SQLite file,
 * rows are seeded the way the app stored them before 13.1, then the new migration runs and the rows are
 * compared before and after.
 *
 * The pattern, for the next one: `exec` each `prisma/migrations/<name>/migration.sql` in name order up to
 * the migration under test, seed with raw SQL (with foreign keys switched off after the earlier
 * migrations, so only the table under test needs rows), snapshot, `exec` the migration, assert.
 */

/**
 * `better-sqlite3` is installed for the Prisma adapter, without type declarations; this is the part of its
 * API the test uses, so no dev dependency is added for it.
 */
type SqliteDatabase = {
  exec(sql: string): void;
  pragma(source: string): unknown;
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
  close(): void;
};
const Database = createRequire(import.meta.url)("better-sqlite3") as new (file: string) => SqliteDatabase;

const MIGRATION = "20261017120000_add_day_plan_item_schedule";
const migrationsDir = path.resolve(process.cwd(), "prisma", "migrations");

const migrationNames = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const readMigration = (name: string) => fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");

type Row = Record<string, unknown> & {
  id: string;
  trip_day_id: string;
  from_time: string | null;
  to_time: string | null;
};

let dir: string;
let db: SqliteDatabase;

const createdAt = (minute: number) => `2026-10-01T08:${String(minute).padStart(2, "0")}:00.000+00:00`;

let seq = 0;
const insert = (tripDayId: string, id: string, fromTime: string | null, toTime: string | null, created = seq) => {
  seq += 1;
  db.prepare(
    `INSERT INTO day_plan_items (id, trip_day_id, title, from_time, to_time, content_json, link_url,
       cost_cents, location_lat, location_lng, location_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{"type":"doc"}', NULL, 1200, 47.1, 8.2, 'Somewhere', ?, ?)`,
  ).run(id, tripDayId, `Title ${id}`, fromTime, toTime, createdAt(created), "2026-10-02T09:00:00.000+00:00");
};

const allRows = () => db.prepare("SELECT * FROM day_plan_items ORDER BY id").all() as Row[];
const dayRows = (tripDayId: string) =>
  db.prepare("SELECT * FROM day_plan_items WHERE trip_day_id = ? ORDER BY sort_order").all(tripDayId) as Row[];

const NEW_COLUMNS = ["schedule_mode", "duration_minutes", "sort_order"];
const withoutNewColumns = (rows: Row[]) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !NEW_COLUMNS.includes(key))));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "travelplan-migration-"));
  db = new Database(path.join(dir, "migration.db"));
  for (const name of migrationNames) {
    if (name >= MIGRATION) break;
    db.exec(readMigration(name));
  }
  // Redefine migrations end in `PRAGMA foreign_keys=ON`; the seed has no trips or days behind its rows.
  db.pragma("foreign_keys = OFF");
  seq = 0;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The four days the story asks for, seeded in insertion order (`created_at` follows it). */
const seedDays = () => {
  // Day A, all timed, created in time order.
  insert("day-a", "a1", "09:00", "10:00");
  insert("day-a", "a2", "10:30", "12:00");
  insert("day-a", "a3", "08:00", "08:01"); // the one-minute row of §4, created last
  // Day B, all timed, created out of time order, with a start tie that created_at settles.
  insert("day-b", "b-dinner", "19:00", "21:00");
  insert("day-b", "b-museum", "09:00", "11:00");
  insert("day-b", "b-tie-later", "14:00", "15:00");
  insert("day-b", "b-tie-earlier", "14:00", "14:30", 0);
  // Day C, mixed: timed rows, untimed rows, and the §5 shapes (only one time, end before start).
  insert("day-c", "c-untimed-1", null, null);
  insert("day-c", "c-timed", "11:00", "12:30");
  insert("day-c", "c-half", "13:00", null);
  insert("day-c", "c-backwards", "16:00", "15:00");
  insert("day-c", "c-untimed-2", null, null);
  insert("day-c", "c-timed-early", "08:00", "09:00");
  // Day D, near midnight: the untimed rows run out of room.
  insert("day-d", "d-late", "22:30", "23:30");
  insert("day-d", "d-u1", null, null);
  insert("day-d", "d-u2", null, null);
  insert("day-d", "d-u3", null, null);
  // Day E, only untimed rows: they start at 10:00.
  insert("day-e", "e-u1", null, null);
  insert("day-e", "e-u2", "", "");
};

describe("migration 20261017120000_add_day_plan_item_schedule (Story 13.1 AC2)", () => {
  it("leaves every column of an all-timed day exactly as it was, and makes every row FIXED", () => {
    seedDays();
    const allTimedDays = ["day-a", "day-b"];
    const before = allRows().filter((row) => allTimedDays.includes(row.trip_day_id));

    db.exec(readMigration(MIGRATION));

    const after = allRows().filter((row) => allTimedDays.includes(row.trip_day_id));
    expect(withoutNewColumns(after)).toEqual(before);
    for (const row of after) {
      expect(row.schedule_mode).toBe("FIXED");
    }
    expect(Object.fromEntries(after.map((row) => [row.id, row.duration_minutes]))).toEqual({
      a1: 60,
      a2: 90,
      a3: 1,
      "b-dinner": 120,
      "b-museum": 120,
      "b-tie-earlier": 30,
      "b-tie-later": 60,
    });
  });

  it("orders an all-timed day by the old comparator (start, then created_at)", () => {
    seedDays();
    db.exec(readMigration(MIGRATION));
    expect(dayRows("day-a").map((row) => [row.id, row.sort_order])).toEqual([
      ["a3", 0],
      ["a1", 1],
      ["a2", 2],
    ]);
    expect(dayRows("day-b").map((row) => row.id)).toEqual(["b-museum", "b-tie-earlier", "b-tie-later", "b-dinner"]);
  });

  it("makes untimed rows and the §5 shapes FLEXIBLE/15, after the timed rows, with appended times", () => {
    seedDays();
    db.exec(readMigration(MIGRATION));
    expect(
      dayRows("day-c").map((row) => [row.id, row.schedule_mode, row.duration_minutes, row.from_time, row.to_time]),
    ).toEqual([
      ["c-timed-early", "FIXED", 60, "08:00", "09:00"],
      ["c-timed", "FIXED", 90, "11:00", "12:30"],
      // Rows with a start sort before rows without one, by that start, as the old comparator had it.
      ["c-half", "FLEXIBLE", 15, "12:30", "12:45"],
      ["c-backwards", "FLEXIBLE", 15, "12:45", "13:00"],
      ["c-untimed-1", "FLEXIBLE", 15, "13:00", "13:15"],
      ["c-untimed-2", "FLEXIBLE", 15, "13:15", "13:30"],
    ]);
    expect(dayRows("day-e").map((row) => [row.id, row.from_time, row.to_time])).toEqual([
      ["e-u1", "10:00", "10:15"],
      ["e-u2", "10:15", "10:30"],
    ]);
  });

  it("keeps NULL times on an untimed row whose end would pass 23:59", () => {
    seedDays();
    db.exec(readMigration(MIGRATION));
    expect(dayRows("day-d").map((row) => [row.id, row.schedule_mode, row.from_time, row.to_time])).toEqual([
      ["d-late", "FIXED", "22:30", "23:30"],
      ["d-u1", "FLEXIBLE", "23:30", "23:45"],
      ["d-u2", "FLEXIBLE", null, null],
      ["d-u3", "FLEXIBLE", null, null],
    ]);
  });

  it("numbers sort_order densely per day", () => {
    seedDays();
    db.exec(readMigration(MIGRATION));
    for (const day of ["day-a", "day-b", "day-c", "day-d", "day-e"]) {
      const orders = dayRows(day).map((row) => row.sort_order);
      expect(orders).toEqual(orders.map((_, index) => index));
    }
  });

  it("leaves every other column of a mixed day's rows as it was, apart from the untimed rows' times", () => {
    seedDays();
    const before = allRows().filter((row) => row.trip_day_id === "day-c");
    db.exec(readMigration(MIGRATION));
    const after = allRows().filter((row) => row.trip_day_id === "day-c");
    const strip = (rows: Row[]) =>
      withoutNewColumns(rows).map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== "from_time" && key !== "to_time")),
      );
    expect(strip(after)).toEqual(strip(before));
  });

  /** AC15: the import's TS helper states the same rule; both must give the same answer on the same days. */
  it("agrees with legacyScheduleFields, the import's TS statement of the rule", () => {
    seedDays();
    const seeded = db.prepare("SELECT * FROM day_plan_items ORDER BY created_at, id").all() as Row[];
    db.exec(readMigration(MIGRATION));
    const migrated = new Map(allRows().map((row) => [row.id, row]));

    for (const day of ["day-a", "day-c", "day-d", "day-e"]) {
      // Day B is left out: its tie row was created first but inserted later, which an import (whose
      // creation order *is* its array order) cannot express.
      const items = seeded.filter((row) => row.trip_day_id === day);
      const fields = legacyScheduleFields(items.map((row) => ({ fromTime: row.from_time, toTime: row.to_time })));
      items.forEach((row, index) => {
        const after = migrated.get(row.id)!;
        expect(fields[index], row.id).toEqual({
          scheduleMode: after.schedule_mode,
          durationMinutes: after.duration_minutes,
          sortOrder: after.sort_order,
          fromTime: after.from_time,
          toTime: after.to_time,
        });
      });
    }
  });

  it("adds the non-unique (trip_day_id, sort_order) index", () => {
    db.exec(readMigration(MIGRATION));
    const index = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_day_plan_items_trip_day_sort_order'")
      .get() as { sql: string } | undefined;
    expect(index?.sql).toContain('("trip_day_id", "sort_order")');
    expect(index?.sql).not.toContain("UNIQUE");
  });
});
