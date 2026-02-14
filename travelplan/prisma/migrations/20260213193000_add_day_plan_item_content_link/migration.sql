-- Add day plan item content and link
ALTER TABLE "day_plan_items" ADD COLUMN "content_json" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "day_plan_items" ADD COLUMN "link_url" TEXT;
