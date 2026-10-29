-- Story 15.4. Provenance for connector writes: a nullable `ai_changed_at` on activities, stays, legs and
-- their images and documents (set when the connector created or last edited the row, cleared by any write
-- from the app), plus `ai_changes`, one row per connector write with the receipt that undoes it. Rows older
-- than 14 days are deleted by the application whenever a new row is written. All relations cascade.
--
-- Additive only. Written as Prisma generates it from `schema.prisma`; the unrelated table redefinitions
-- `prisma migrate diff` also prints for `cost_payments` and `trip_members` predate this story and are not
-- part of it.

-- AlterTable
ALTER TABLE "accommodation_documents" ADD COLUMN "ai_changed_at" DATETIME;

-- AlterTable
ALTER TABLE "accommodation_images" ADD COLUMN "ai_changed_at" DATETIME;

-- AlterTable
ALTER TABLE "accommodations" ADD COLUMN "ai_changed_at" DATETIME;

-- AlterTable
ALTER TABLE "day_plan_item_documents" ADD COLUMN "ai_changed_at" DATETIME;

-- AlterTable
ALTER TABLE "day_plan_item_images" ADD COLUMN "ai_changed_at" DATETIME;

-- AlterTable
ALTER TABLE "day_plan_items" ADD COLUMN "ai_changed_at" DATETIME;

-- AlterTable
ALTER TABLE "travel_segments" ADD COLUMN "ai_changed_at" DATETIME;

-- CreateTable
CREATE TABLE "ai_changes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_id" TEXT NOT NULL,
    "trip_day_id" TEXT,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "receipt_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" DATETIME,
    CONSTRAINT "ai_changes_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_changes_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_ai_changes_trip_day_created_at" ON "ai_changes"("trip_id", "trip_day_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ai_changes_created_at" ON "ai_changes"("created_at");
