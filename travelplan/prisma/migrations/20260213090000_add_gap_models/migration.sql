-- CreateTable
CREATE TABLE "accommodations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_day_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "accommodations_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "day_plan_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_day_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "day_plan_items_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_accommodations_trip_day_id" ON "accommodations"("trip_day_id");

-- CreateIndex
CREATE INDEX "idx_day_plan_items_trip_day_id" ON "day_plan_items"("trip_day_id");
