-- Story 14.1 (FR30, FR31). One kind of entry: a bucket-list idea is an activity without a day.
--
-- `day_plan_items` gains `trip_id` (backfilled from the row's day) and `trip_day_id` becomes nullable;
-- a row with `trip_day_id IS NULL` is parked on its trip's bucket list. Every `trip_bucket_list_items`
-- row becomes such an activity with the same id, and the old table is dropped.
--
-- SQLite cannot drop a NOT NULL, so the table is rebuilt (the redefine pattern of
-- `20260301105118_add_travel_segments`). The new table is written exactly as Prisma generates it from
-- `schema.prisma`, plus one CHECK Prisma cannot express: a parked row is FLEXIBLE, has no times and
-- has `sort_order = 0`. `cost_payments`, `day_plan_item_images` and `day_plan_item_documents`
-- reference `day_plan_items` by name, so with foreign keys off they follow the rename unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_day_plan_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_id" TEXT NOT NULL,
    "trip_day_id" TEXT,
    "title" TEXT,
    "from_time" TEXT,
    "to_time" TEXT,
    "content_json" TEXT NOT NULL,
    "cost_cents" INTEGER,
    "cost_original_amount" INTEGER,
    "cost_currency" TEXT,
    "cost_rate" REAL,
    "cost_rate_date" TEXT,
    "link_url" TEXT,
    "location_lat" REAL,
    "location_lng" REAL,
    "location_label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "schedule_mode" TEXT NOT NULL DEFAULT 'FIXED',
    "duration_minutes" INTEGER NOT NULL DEFAULT 15,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "day_plan_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "day_plan_items_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "day_plan_items_parked_check" CHECK (
        "trip_day_id" IS NOT NULL
        OR ("schedule_mode" = 'FLEXIBLE' AND "from_time" IS NULL AND "to_time" IS NULL AND "sort_order" = 0)
    )
);

-- Every planned activity keeps every column; `trip_id` is its day's trip.
INSERT INTO "new_day_plan_items" (
    "id", "trip_id", "trip_day_id", "title", "from_time", "to_time", "content_json", "cost_cents",
    "cost_original_amount", "cost_currency", "cost_rate", "cost_rate_date", "link_url", "location_lat",
    "location_lng", "location_label", "created_at", "updated_at", "schedule_mode", "duration_minutes", "sort_order"
)
SELECT
    item."id", day."trip_id", item."trip_day_id", item."title", item."from_time", item."to_time",
    item."content_json", item."cost_cents", item."cost_original_amount", item."cost_currency", item."cost_rate",
    item."cost_rate_date", item."link_url", item."location_lat", item."location_lng", item."location_label",
    item."created_at", item."updated_at", item."schedule_mode", item."duration_minutes", item."sort_order"
FROM "day_plan_items" AS item
JOIN "trip_days" AS day ON day."id" = item."trip_day_id";

-- Every bucket entry becomes a parked activity: same id, title, place and timestamps; FLEXIBLE,
-- 15 minutes, no times, `sort_order` 0. `content_json` is exactly what the client built until 14.1
-- (`buildParkedContentJson` in `src/lib/trips/parkedItemContent.ts`, compared byte for byte by the
-- migration test): the trimmed description, then the trimmed position text only when the entry had
-- no coordinates, and the trimmed title when both are empty. `trim` is given every character
-- JavaScript's `String.prototype.trim` strips, because SQLite's plain `trim(x)` strips spaces only.
INSERT INTO "new_day_plan_items" (
    "id", "trip_id", "trip_day_id", "title", "from_time", "to_time", "content_json",
    "location_lat", "location_lng", "location_label", "created_at", "updated_at",
    "schedule_mode", "duration_minutes", "sort_order"
)
SELECT
    src."id", src."trip_id", NULL, src."title", NULL, NULL,
    json_object(
        'type', 'doc',
        'content', CASE
            WHEN src."description_text" <> '' AND src."position_kept" <> '' THEN json_array(
                json_object('type', 'paragraph', 'content', json_array(json_object('type', 'text', 'text', src."description_text"))),
                json_object('type', 'paragraph', 'content', json_array(json_object('type', 'text', 'text', src."position_kept")))
            )
            WHEN src."description_text" <> '' THEN json_array(
                json_object('type', 'paragraph', 'content', json_array(json_object('type', 'text', 'text', src."description_text")))
            )
            WHEN src."position_kept" <> '' THEN json_array(
                json_object('type', 'paragraph', 'content', json_array(json_object('type', 'text', 'text', src."position_kept")))
            )
            ELSE json_array(
                json_object('type', 'paragraph', 'content', json_array(json_object('type', 'text', 'text', src."title_text")))
            )
        END
    ),
    src."location_lat", src."location_lng", src."location_label", src."created_at", src."updated_at",
    'FLEXIBLE', 15, 0
FROM (
    SELECT
        bucket.*,
        trim(coalesce(bucket."description", ''), ws."chars") AS "description_text",
        CASE WHEN bucket."location_lat" IS NULL OR bucket."location_lng" IS NULL
            THEN trim(coalesce(bucket."position_text", ''), ws."chars")
            ELSE ''
        END AS "position_kept",
        trim(bucket."title", ws."chars") AS "title_text"
    FROM "trip_bucket_list_items" AS bucket
    CROSS JOIN (
        SELECT char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
            8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279) AS "chars"
    ) AS ws
) AS src;

DROP TABLE "trip_bucket_list_items";
DROP TABLE "day_plan_items";
ALTER TABLE "new_day_plan_items" RENAME TO "day_plan_items";
CREATE INDEX "idx_day_plan_items_trip_day_id" ON "day_plan_items"("trip_day_id");
CREATE INDEX "idx_day_plan_items_trip_day_sort_order" ON "day_plan_items"("trip_day_id", "sort_order");
CREATE INDEX "idx_day_plan_items_trip_id_trip_day_id" ON "day_plan_items"("trip_id", "trip_day_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
