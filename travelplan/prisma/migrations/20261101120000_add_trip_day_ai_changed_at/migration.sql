-- Story 15.9. The day's own KI/AI marker: a nullable `ai_changed_at` on `trip_days`, set when a connector
-- write changed the day's note or picture and cleared by any write to either from the app.
--
-- Additive only. Written as Prisma generates it from `schema.prisma`.

-- AlterTable
ALTER TABLE "trip_days" ADD COLUMN "ai_changed_at" DATETIME;
