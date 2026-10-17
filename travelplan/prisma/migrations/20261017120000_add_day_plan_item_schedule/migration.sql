-- Story 13.1 (FR42, FR46). Activities are planned by duration: a FLEXIBLE activity's times are worked
-- out by the schedule rule, a FIXED one keeps its booked times, and the day's order is stored in
-- `sort_order` instead of being derived from `from_time`.
--
-- Tommy's ruling: nothing moves by itself. Every validly timed row becomes FIXED with exactly its times,
-- so a day whose rows were all timed reads the same afterwards in every column but the three new ones.
--
-- The defaults equal `schema.prisma`'s (`@default(FIXED)`, `@default(15)`, `@default(0)`); SQLite needs
-- one to add a NOT NULL column, and every write path sets all three explicitly from now on.
ALTER TABLE "day_plan_items" ADD COLUMN "schedule_mode" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "day_plan_items" ADD COLUMN "duration_minutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "day_plan_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Validly timed (§5): both times `HH:MM` with hours 00-23 and the end after the start. Such a row is
-- FIXED and its duration is the true difference, even under the dialog's 5-minute minimum (§4: one
-- real activity lasts 08:00-08:01, and the minimum is an input rule, not a column constraint).
-- Every other shape (untimed, only one time, end at or before start) becomes FLEXIBLE with 15 minutes
-- ("kurz anhalten und umschauen").
UPDATE "day_plan_items"
SET
  "schedule_mode" = 'FIXED',
  "duration_minutes" =
    (CAST(substr("to_time", 1, 2) AS INTEGER) * 60 + CAST(substr("to_time", 4, 2) AS INTEGER))
    - (CAST(substr("from_time", 1, 2) AS INTEGER) * 60 + CAST(substr("from_time", 4, 2) AS INTEGER))
WHERE "from_time" GLOB '[0-2][0-9]:[0-5][0-9]'
  AND "to_time" GLOB '[0-2][0-9]:[0-5][0-9]'
  AND CAST(substr("from_time", 1, 2) AS INTEGER) <= 23
  AND CAST(substr("to_time", 1, 2) AS INTEGER) <= 23
  AND "to_time" > "from_time";

UPDATE "day_plan_items"
SET "schedule_mode" = 'FLEXIBLE', "duration_minutes" = 15
WHERE NOT (
  "from_time" GLOB '[0-2][0-9]:[0-5][0-9]'
  AND "to_time" GLOB '[0-2][0-9]:[0-5][0-9]'
  AND CAST(substr("from_time", 1, 2) AS INTEGER) <= 23
  AND CAST(substr("to_time", 1, 2) AS INTEGER) <= 23
  AND "to_time" > "from_time"
) OR "from_time" IS NULL OR "to_time" IS NULL;

-- The order: FIXED rows first, then FLEXIBLE ones, each group in the comparator order the app used
-- until now (`compareDayPlanItemsByStartTime`: rows with a start by `from_time`, rows without one
-- after, then `created_at`, then `id`). On a day whose rows were all timed that is exactly the old
-- order. Former untimed rows land after the timed ones in their former relative order.
-- Prisma 7 with the better-sqlite3 adapter stores `created_at` as ISO-8601 text
-- (`2026-10-16T16:10:54.700+00:00`); `julianday` reads that and SQLite's own `CURRENT_TIMESTAMP`
-- format alike, so the order is by instant, as the TS comparator's `Date.parse` has it.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "trip_day_id"
      ORDER BY
        CASE WHEN "schedule_mode" = 'FIXED' THEN 0 ELSE 1 END,
        CASE WHEN "from_time" IS NULL OR "from_time" = '' THEN 1 ELSE 0 END,
        CASE WHEN "from_time" IS NULL OR "from_time" = '' THEN NULL ELSE "from_time" END,
        julianday("created_at"),
        "id"
    ) - 1 AS "next_sort_order"
  FROM "day_plan_items"
)
UPDATE "day_plan_items"
SET "sort_order" = (
  SELECT "next_sort_order"
  FROM ranked
  WHERE ranked."id" = "day_plan_items"."id"
);

-- Former untimed rows get times only where they fit (§6): from the latest end among the day's FIXED
-- rows (10:00 on a day without one), each takes the next 15 minutes in order. Legs are not counted
-- here; the schedule rule recomputes the day exactly on its next write. A row whose end would pass
-- 23:59 keeps both times NULL, which means "does not fit in the day" (rule 5), a state every reader
-- already handles because Story 12.4's overflow stores it too.
WITH day_start AS (
  SELECT
    "trip_day_id",
    COALESCE(
      MAX(
        CASE WHEN "schedule_mode" = 'FIXED'
          THEN CAST(substr("to_time", 1, 2) AS INTEGER) * 60 + CAST(substr("to_time", 4, 2) AS INTEGER)
        END
      ),
      600
    ) AS "start_minute",
    SUM(CASE WHEN "schedule_mode" = 'FIXED' THEN 1 ELSE 0 END) AS "fixed_count"
  FROM "day_plan_items"
  GROUP BY "trip_day_id"
),
slots AS (
  SELECT
    item."id",
    day_start."start_minute" + 15 * (item."sort_order" - day_start."fixed_count") AS "slot_from",
    day_start."start_minute" + 15 * (item."sort_order" - day_start."fixed_count" + 1) AS "slot_to"
  FROM "day_plan_items" AS item
  JOIN day_start ON day_start."trip_day_id" = item."trip_day_id"
  WHERE item."schedule_mode" = 'FLEXIBLE'
)
UPDATE "day_plan_items"
SET
  "from_time" = (
    SELECT CASE WHEN slots."slot_to" <= 1439
      THEN printf('%02d:%02d', slots."slot_from" / 60, slots."slot_from" % 60)
    END
    FROM slots WHERE slots."id" = "day_plan_items"."id"
  ),
  "to_time" = (
    SELECT CASE WHEN slots."slot_to" <= 1439
      THEN printf('%02d:%02d', slots."slot_to" / 60, slots."slot_to" % 60)
    END
    FROM slots WHERE slots."id" = "day_plan_items"."id"
  )
WHERE "schedule_mode" = 'FLEXIBLE';

-- The day's order is read with this index; it is not unique, because a write renumbers inside its
-- transaction and seeded rows share the default.
CREATE INDEX "idx_day_plan_items_trip_day_sort_order" ON "day_plan_items"("trip_day_id", "sort_order");
