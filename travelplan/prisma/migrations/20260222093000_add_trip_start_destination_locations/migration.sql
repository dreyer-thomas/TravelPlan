-- Add optional start/destination location columns for trips.
ALTER TABLE "trips" ADD COLUMN "start_location_lat" REAL;
ALTER TABLE "trips" ADD COLUMN "start_location_lng" REAL;
ALTER TABLE "trips" ADD COLUMN "start_location_label" TEXT;
ALTER TABLE "trips" ADD COLUMN "destination_location_lat" REAL;
ALTER TABLE "trips" ADD COLUMN "destination_location_lng" REAL;
ALTER TABLE "trips" ADD COLUMN "destination_location_label" TEXT;
