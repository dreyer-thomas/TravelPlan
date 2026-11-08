-- Story 16.1 (FR58). The trip's shared packing list: `packing_items` (one row per item, unique per trip by
-- `name_key`, the trimmed lower-cased name) and `packing_item_days`, the item's links to days (written from
-- Story 16.2 on). Both cascade with the trip; a link also cascades with its day, never taking the item.
--
-- Additive only. Written as Prisma generates it from `schema.prisma`; the unrelated table redefinitions
-- `prisma migrate diff` also prints for `cost_payments` and `trip_members` predate this story and are not
-- part of it.

-- CreateTable
CREATE TABLE "packing_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "category" TEXT,
    "packed" BOOLEAN NOT NULL DEFAULT false,
    "ai_changed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "packing_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "packing_item_days" (
    "packing_item_id" TEXT NOT NULL,
    "trip_day_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("packing_item_id", "trip_day_id"),
    CONSTRAINT "packing_item_days_packing_item_id_fkey" FOREIGN KEY ("packing_item_id") REFERENCES "packing_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "packing_item_days_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "packing_items_trip_id_name_key_key" ON "packing_items"("trip_id", "name_key");

-- CreateIndex
CREATE INDEX "idx_packing_item_days_trip_day_id" ON "packing_item_days"("trip_day_id");
