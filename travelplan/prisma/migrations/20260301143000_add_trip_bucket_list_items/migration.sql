-- CreateTable
CREATE TABLE "trip_bucket_list_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position_text" TEXT,
    "location_lat" REAL,
    "location_lng" REAL,
    "location_label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "trip_bucket_list_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_trip_bucket_list_items_trip_id" ON "trip_bucket_list_items"("trip_id");
