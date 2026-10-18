import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildParkedContentJson } from "@/lib/trips/parkedItemContent";

/**
 * Story 14.1 AC1, AC2. The harness of `migrationDayPlanItemSchedule.test.ts`: every earlier migration is
 * applied to a fresh SQLite file, rows are seeded the way the app stored them before 14.1, then the
 * migration under test runs. Unlike 13.1's test the seed is a real trip with real days, because the
 * rebuilt table's foreign keys and the cascades are part of what is checked.
 */

type SqliteDatabase = {
  exec(sql: string): void;
  pragma(source: string): unknown;
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
  close(): void;
};
const Database = createRequire(import.meta.url)("better-sqlite3") as new (file: string) => SqliteDatabase;

const MIGRATION = "20261018120000_day_plan_items_without_day";
const migrationsDir = path.resolve(process.cwd(), "prisma", "migrations");

const migrationNames = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const readMigration = (name: string) => fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");

type Row = Record<string, unknown> & { id: string };

let dir: string;
let db: SqliteDatabase;

const STAMP = "2026-10-01T08:00:00.000+00:00";

const seedTrips = () => {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1', 'u1@example.com', 'x', ?, ?)`,
  ).run(STAMP, STAMP);
  for (const tripId of ["trip-1", "trip-2"]) {
    db.prepare(
      `INSERT INTO trips (id, user_id, name, start_date, end_date, created_at, updated_at)
       VALUES (?, 'u1', ?, ?, ?, ?, ?)`,
    ).run(tripId, tripId, STAMP, STAMP, STAMP, STAMP);
  }
  const day = (id: string, tripId: string, index: number) =>
    db.prepare(
      `INSERT INTO trip_days (id, trip_id, date, day_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, tripId, STAMP, index, STAMP, STAMP);
  day("day-1a", "trip-1", 1);
  day("day-1b", "trip-1", 2);
  day("day-2a", "trip-2", 1);
};

const insertItem = (id: string, tripDayId: string, values: Partial<Record<string, unknown>> = {}) => {
  const row = {
    title: `Title ${id}`,
    from_time: "09:00",
    to_time: "10:00",
    content_json: '{"type":"doc"}',
    cost_cents: 1200,
    cost_original_amount: 1300,
    cost_currency: "CHF",
    cost_rate: 0.92,
    cost_rate_date: "2026-09-30",
    link_url: "https://example.com",
    location_lat: 47.1,
    location_lng: 8.2,
    location_label: "Somewhere",
    schedule_mode: "FIXED",
    duration_minutes: 60,
    sort_order: 0,
    ...values,
  };
  db.prepare(
    `INSERT INTO day_plan_items (id, trip_day_id, title, from_time, to_time, content_json, cost_cents,
       cost_original_amount, cost_currency, cost_rate, cost_rate_date, link_url, location_lat, location_lng,
       location_label, created_at, updated_at, schedule_mode, duration_minutes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    tripDayId,
    row.title,
    row.from_time,
    row.to_time,
    row.content_json,
    row.cost_cents,
    row.cost_original_amount,
    row.cost_currency,
    row.cost_rate,
    row.cost_rate_date,
    row.link_url,
    row.location_lat,
    row.location_lng,
    row.location_label,
    STAMP,
    "2026-10-02T09:00:00.000+00:00",
    row.schedule_mode,
    row.duration_minutes,
    row.sort_order,
  );
};

type BucketSeed = {
  id: string;
  tripId?: string;
  title: string;
  description: string | null;
  positionText: string | null;
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
};

const insertBucket = (seed: BucketSeed) => {
  db.prepare(
    `INSERT INTO trip_bucket_list_items (id, trip_id, title, description, position_text, location_lat, location_lng,
       location_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.tripId ?? "trip-1",
    seed.title,
    seed.description,
    seed.positionText,
    seed.lat ?? null,
    seed.lng ?? null,
    seed.label ?? null,
    `2026-09-0${(seed.id.length % 9) + 1}T10:00:00.000+00:00`,
    `2026-09-1${(seed.id.length % 9) + 1}T11:00:00.000+00:00`,
  );
};

/** AC2: the cases the story names, each one a bucket row. */
const BUCKETS: BucketSeed[] = [
  { id: "b-desc-only", title: "Wasserfall", description: "Früh hin, bevor die Busse kommen", positionText: null },
  { id: "b-pos-no-coords", title: "Hütte", description: null, positionText: "Oberhalb von Zermatt" },
  {
    id: "b-pos-with-coords",
    title: "Gullfoss",
    description: null,
    positionText: "Gullfoss, Island",
    lat: 64.3271,
    lng: -20.1199,
    label: "Gullfoss",
  },
  {
    id: "b-desc-and-pos",
    title: "Markt",
    description: "Samstags",
    positionText: "Marktplatz",
  },
  {
    id: "b-desc-and-pos-coords",
    title: "Brücke",
    description: "Bei Sonnenuntergang",
    positionText: "Alte Brücke",
    lat: 47.0,
    lng: 8.0,
    label: "Kapellbrücke",
  },
  { id: "b-both-empty", title: "  Nur ein Titel ", description: null, positionText: null },
  { id: "b-both-blank", title: "Leer", description: "   ", positionText: "\t \n" },
  {
    id: "b-special",
    title: "Sonderzeichen",
    description: 'Sie sagte "hallo" \\ dann ging sie 🏔️\nZeile zwei äöü ß',
    positionText: null,
  },
  { id: "b-whitespace", title: "Leerraum", description: "\t  Mit Tab und Leerzeichen  \t", positionText: " \r\nPos " },
  { id: "b-unicode-space", title: "Unicode", description: " ﻿Text　", positionText: null },
  { id: "b-lat-only", title: "Halb", description: null, positionText: "Ohne Länge", lat: 47.0, lng: null },
  { id: "b-trip-2", tripId: "trip-2", title: "Anderer Trip", description: "Zwei", positionText: null },
];

const allRows = () => db.prepare("SELECT * FROM day_plan_items ORDER BY id").all() as Row[];

const NEW_COLUMNS = ["trip_id"];
const withoutNewColumns = (rows: Row[]) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !NEW_COLUMNS.includes(key))));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "travelplan-migration-"));
  db = new Database(path.join(dir, "migration.db"));
  for (const name of migrationNames) {
    if (name >= MIGRATION) break;
    db.exec(readMigration(name));
  }
  db.pragma("foreign_keys = ON");
  seedTrips();
  insertItem("i-1", "day-1a");
  insertItem("i-2", "day-1a", { from_time: null, to_time: null, schedule_mode: "FLEXIBLE", duration_minutes: 15, sort_order: 1 });
  insertItem("i-3", "day-1b", { title: null, cost_cents: null, location_lat: null, location_lng: null, location_label: null });
  insertItem("i-4", "day-2a", { cost_currency: null, cost_rate: null, cost_rate_date: null, cost_original_amount: null });
  db.prepare(
    `INSERT INTO day_plan_item_images (id, day_plan_item_id, image_url, sort_order, created_at, updated_at)
     VALUES ('img-1', 'i-1', '/uploads/trips/trip-1/days/day-1a/day-plan-items/i-1/a.jpg', 0, ?, ?)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO cost_payments (id, day_plan_item_id, amount_cents, due_date, sort_order, created_at, updated_at)
     VALUES ('pay-1', 'i-1', 1200, '2026-10-05', 0, ?, ?)`,
  ).run(STAMP, STAMP);
  for (const bucket of BUCKETS) {
    insertBucket(bucket);
  }
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("migration 20261018120000_day_plan_items_without_day (Story 14.1 AC1)", () => {
  it("leaves every pre-existing activity unchanged in every old column and gives it its day's trip", () => {
    const before = allRows();
    db.exec(readMigration(MIGRATION));
    const after = allRows().filter((row) => !row.id.startsWith("b-"));

    expect(withoutNewColumns(after)).toEqual(before);
    expect(Object.fromEntries(after.map((row) => [row.id, row.trip_id]))).toEqual({
      "i-1": "trip-1",
      "i-2": "trip-1",
      "i-3": "trip-1",
      "i-4": "trip-2",
    });
  });

  it("turns every bucket row into a parked activity with the same id, place and timestamps", () => {
    const buckets = db.prepare("SELECT * FROM trip_bucket_list_items ORDER BY id").all() as Row[];
    db.exec(readMigration(MIGRATION));

    const parked = db.prepare("SELECT * FROM day_plan_items WHERE trip_day_id IS NULL ORDER BY id").all() as Row[];
    expect(parked.map((row) => row.id)).toEqual(buckets.map((row) => row.id));
    for (const bucket of buckets) {
      const row = parked.find((candidate) => candidate.id === bucket.id)!;
      expect(row).toMatchObject({
        trip_id: bucket.trip_id,
        trip_day_id: null,
        title: bucket.title,
        from_time: null,
        to_time: null,
        schedule_mode: "FLEXIBLE",
        duration_minutes: 15,
        sort_order: 0,
        location_lat: bucket.location_lat,
        location_lng: bucket.location_lng,
        location_label: bucket.location_label,
        created_at: bucket.created_at,
        updated_at: bucket.updated_at,
        cost_cents: null,
        cost_original_amount: null,
        cost_currency: null,
        cost_rate: null,
        cost_rate_date: null,
        link_url: null,
      });
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((table) => table.name)).not.toContain("trip_bucket_list_items");
  });

  it("writes content_json byte for byte as buildParkedContentJson does (Story 14.1 AC2)", () => {
    db.exec(readMigration(MIGRATION));
    const parked = db
      .prepare("SELECT id, content_json FROM day_plan_items WHERE trip_day_id IS NULL ORDER BY id")
      .all() as { id: string; content_json: string }[];

    for (const bucket of BUCKETS) {
      const row = parked.find((candidate) => candidate.id === bucket.id)!;
      const expected = buildParkedContentJson({
        title: bucket.title,
        description: bucket.description,
        positionText: bucket.positionText,
        hasCoordinates: bucket.lat != null && bucket.lng != null,
      });
      expect({ id: bucket.id, json: row.content_json }).toEqual({ id: bucket.id, json: expected });
    }
  });

  it("pins the texts of the interesting cases", () => {
    db.exec(readMigration(MIGRATION));
    const texts = (id: string) => {
      const row = db.prepare("SELECT content_json FROM day_plan_items WHERE id = ?").get(id) as { content_json: string };
      const doc = JSON.parse(row.content_json) as { content: { content: { text: string }[] }[] };
      return doc.content.map((paragraph) => paragraph.content[0].text);
    };
    expect(texts("b-pos-no-coords")).toEqual(["Oberhalb von Zermatt"]);
    expect(texts("b-pos-with-coords")).toEqual(["Gullfoss"]);
    expect(texts("b-desc-and-pos")).toEqual(["Samstags", "Marktplatz"]);
    expect(texts("b-desc-and-pos-coords")).toEqual(["Bei Sonnenuntergang"]);
    expect(texts("b-both-empty")).toEqual(["Nur ein Titel"]);
    expect(texts("b-both-blank")).toEqual(["Leer"]);
    expect(texts("b-whitespace")).toEqual(["Mit Tab und Leerzeichen", "Pos"]);
    expect(texts("b-unicode-space")).toEqual(["Text"]);
    expect(texts("b-lat-only")).toEqual(["Ohne Länge"]);
    expect(texts("b-special")).toEqual(['Sie sagte "hallo" \\ dann ging sie 🏔️\nZeile zwei äöü ß']);
  });

  it("refuses a parked row that is not FLEXIBLE, has a time or has a sort order", () => {
    db.exec(readMigration(MIGRATION));
    const insertParked = (values: { mode: string; from: string | null; to: string | null; order: number }) =>
      db
        .prepare(
          `INSERT INTO day_plan_items (id, trip_id, trip_day_id, title, from_time, to_time, content_json, updated_at,
             schedule_mode, duration_minutes, sort_order)
           VALUES (?, 'trip-1', NULL, 'x', ?, ?, '{}', ?, ?, 15, ?)`,
        )
        .run(`bad-${values.mode}-${values.from}-${values.order}`, values.from, values.to, STAMP, values.mode, values.order);

    expect(() => insertParked({ mode: "FIXED", from: null, to: null, order: 0 })).toThrow(/CHECK constraint failed/);
    expect(() => insertParked({ mode: "FLEXIBLE", from: "09:00", to: null, order: 0 })).toThrow(/CHECK constraint failed/);
    expect(() => insertParked({ mode: "FLEXIBLE", from: null, to: "10:00", order: 0 })).toThrow(/CHECK constraint failed/);
    expect(() => insertParked({ mode: "FLEXIBLE", from: null, to: null, order: 1 })).toThrow(/CHECK constraint failed/);
    expect(() => insertParked({ mode: "FLEXIBLE", from: null, to: null, order: 0 })).not.toThrow();
    // A planned row is not constrained by it.
    expect(() =>
      db
        .prepare(
          `INSERT INTO day_plan_items (id, trip_id, trip_day_id, content_json, updated_at, schedule_mode, sort_order)
           VALUES ('fixed-on-day', 'trip-1', 'day-1a', '{}', ?, 'FIXED', 3)`,
        )
        .run(STAMP),
    ).not.toThrow();
  });

  it("keeps the foreign keys: a trip's delete takes its parked rows, a day's delete takes its activities", () => {
    db.exec(readMigration(MIGRATION));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.prepare("DELETE FROM trip_days WHERE id = 'day-1a'").run();
    const afterDay = allRows().map((row) => row.id);
    expect(afterDay).not.toContain("i-1");
    expect(afterDay).not.toContain("i-2");
    expect(afterDay).toContain("b-desc-only");
    // The rebuilt table is still the target of the image and payment foreign keys.
    expect(db.prepare("SELECT * FROM day_plan_item_images WHERE id = 'img-1'").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM cost_payments WHERE id = 'pay-1'").all()).toEqual([]);

    db.prepare("DELETE FROM trips WHERE id = 'trip-1'").run();
    expect(allRows().map((row) => row.id)).toEqual(["b-trip-2", "i-4"]);
  });

  it("creates the three indexes", () => {
    db.exec(readMigration(MIGRATION));
    const indexes = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'day_plan_items' AND sql IS NOT NULL ORDER BY name")
      .all() as { name: string; sql: string }[];
    expect(indexes.map((index) => index.name)).toEqual([
      "idx_day_plan_items_trip_day_id",
      "idx_day_plan_items_trip_day_sort_order",
      "idx_day_plan_items_trip_id_trip_day_id",
    ]);
  });
});

/**
 * Review 2026-10-18. The CHECK lives only in hand-written SQL - `schema.prisma` cannot say it - so a later
 * generated migration that redefines `day_plan_items` would drop it without a word. This applies *every*
 * migration, today's and any added after 14.1, and asserts the constraint is still on the table.
 */
describe("day_plan_items_parked_check survives every later migration", () => {
  it("is on day_plan_items after all migrations", () => {
    db.exec(readMigration(MIGRATION));
    for (const name of migrationNames) {
      if (name > MIGRATION) db.exec(readMigration(name));
    }
    const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'day_plan_items'`).get() as {
      sql: string;
    };
    expect(table.sql).toContain(`CONSTRAINT "day_plan_items_parked_check" CHECK`);
  });
});
