-- Add optional check-in/out time columns for accommodations.
-- Keep nullable for legacy rows; application validation enforces optional HH:mm values.
ALTER TABLE "accommodations" ADD COLUMN "check_in_time" TEXT;
ALTER TABLE "accommodations" ADD COLUMN "check_out_time" TEXT;
