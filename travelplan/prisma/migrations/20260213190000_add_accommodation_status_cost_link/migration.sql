-- Add accommodation status, cost, and link
ALTER TABLE "accommodations" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PLANNED';
ALTER TABLE "accommodations" ADD COLUMN "cost_cents" INTEGER;
ALTER TABLE "accommodations" ADD COLUMN "link_url" TEXT;
