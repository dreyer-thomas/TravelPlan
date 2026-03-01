-- CreateTable
CREATE TABLE "travel_segments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_day_id" TEXT NOT NULL,
    "from_item_type" TEXT NOT NULL,
    "from_item_id" TEXT NOT NULL,
    "to_item_type" TEXT NOT NULL,
    "to_item_id" TEXT NOT NULL,
    "transport_type" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "distance_km" REAL,
    "link_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "travel_segments_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_accommodations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_day_id" TEXT NOT NULL,
    "property_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "cost_cents" INTEGER,
    "link_url" TEXT,
    "location_lat" REAL,
    "location_lng" REAL,
    "location_label" TEXT,
    "notes" TEXT,
    "check_in_time" TEXT,
    "check_out_time" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "accommodations_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_accommodations" ("check_in_time", "check_out_time", "cost_cents", "created_at", "id", "link_url", "location_label", "location_lat", "location_lng", "notes", "property_name", "status", "trip_day_id", "updated_at") SELECT "check_in_time", "check_out_time", "cost_cents", "created_at", "id", "link_url", "location_label", "location_lat", "location_lng", "notes", "property_name", "status", "trip_day_id", "updated_at" FROM "accommodations";
DROP TABLE "accommodations";
ALTER TABLE "new_accommodations" RENAME TO "accommodations";
CREATE UNIQUE INDEX "idx_accommodations_trip_day_id" ON "accommodations"("trip_day_id");
CREATE TABLE "new_day_plan_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_day_id" TEXT NOT NULL,
    "title" TEXT,
    "from_time" TEXT,
    "to_time" TEXT,
    "content_json" TEXT NOT NULL,
    "cost_cents" INTEGER,
    "link_url" TEXT,
    "location_lat" REAL,
    "location_lng" REAL,
    "location_label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "day_plan_items_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_day_plan_items" ("content_json", "cost_cents", "created_at", "from_time", "id", "link_url", "location_label", "location_lat", "location_lng", "title", "to_time", "trip_day_id", "updated_at") SELECT "content_json", "cost_cents", "created_at", "from_time", "id", "link_url", "location_label", "location_lat", "location_lng", "title", "to_time", "trip_day_id", "updated_at" FROM "day_plan_items";
DROP TABLE "day_plan_items";
ALTER TABLE "new_day_plan_items" RENAME TO "day_plan_items";
CREATE INDEX "idx_day_plan_items_trip_day_id" ON "day_plan_items"("trip_day_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "idx_travel_segments_trip_day_id" ON "travel_segments"("trip_day_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_travel_segments_pair" ON "travel_segments"("trip_day_id", "from_item_type", "from_item_id", "to_item_type", "to_item_id");
