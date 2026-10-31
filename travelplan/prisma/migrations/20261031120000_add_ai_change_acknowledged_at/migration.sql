-- The day view's OK on the "AI changed this day" notice (2026-10-31): a change confirmed as seen is no
-- longer listed there, for every planner of the trip. Additive only.

-- AlterTable
ALTER TABLE "ai_changes" ADD COLUMN "acknowledged_at" DATETIME;
