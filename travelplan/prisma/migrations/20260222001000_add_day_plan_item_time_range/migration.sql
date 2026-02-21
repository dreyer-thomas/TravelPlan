-- Add optional from/to time columns for day plan items.
-- Keep nullable for legacy rows; application validation enforces required values on create/update.
ALTER TABLE "day_plan_items" ADD COLUMN "from_time" TEXT;
ALTER TABLE "day_plan_items" ADD COLUMN "to_time" TEXT;
