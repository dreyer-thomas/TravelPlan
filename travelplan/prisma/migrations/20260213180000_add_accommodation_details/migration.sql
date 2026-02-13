-- Add accommodation details
ALTER TABLE "accommodations" ADD COLUMN "property_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "accommodations" ADD COLUMN "notes" TEXT;
