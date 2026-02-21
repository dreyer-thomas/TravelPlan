-- Add optional day plan item costs in integer cents
ALTER TABLE "day_plan_items" ADD COLUMN "cost_cents" INTEGER;
