ALTER TABLE "accommodations" ADD COLUMN "location_lat" REAL;
ALTER TABLE "accommodations" ADD COLUMN "location_lng" REAL;
ALTER TABLE "accommodations" ADD COLUMN "location_label" TEXT;

ALTER TABLE "day_plan_items" ADD COLUMN "location_lat" REAL;
ALTER TABLE "day_plan_items" ADD COLUMN "location_lng" REAL;
ALTER TABLE "day_plan_items" ADD COLUMN "location_label" TEXT;
