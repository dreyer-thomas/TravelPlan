CREATE TABLE "trip_feedback_targets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trip_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_key" TEXT NOT NULL,
  "trip_day_id" TEXT,
  "accommodation_id" TEXT,
  "day_plan_item_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_feedback_targets_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trip_feedback_targets_trip_day_id_fkey" FOREIGN KEY ("trip_day_id") REFERENCES "trip_days" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trip_feedback_targets_accommodation_id_fkey" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trip_feedback_targets_day_plan_item_id_fkey" FOREIGN KEY ("day_plan_item_id") REFERENCES "day_plan_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "trip_feedback_targets_target_key_key" ON "trip_feedback_targets"("target_key");
CREATE INDEX "idx_trip_feedback_targets_trip_type" ON "trip_feedback_targets"("trip_id", "target_type");
CREATE INDEX "idx_trip_feedback_targets_trip_day_id" ON "trip_feedback_targets"("trip_day_id");
CREATE INDEX "idx_trip_feedback_targets_accommodation_id" ON "trip_feedback_targets"("accommodation_id");
CREATE INDEX "idx_trip_feedback_targets_day_plan_item_id" ON "trip_feedback_targets"("day_plan_item_id");

CREATE TABLE "trip_feedback_comments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "target_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_feedback_comments_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "trip_feedback_targets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trip_feedback_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_trip_feedback_comments_target_created_at" ON "trip_feedback_comments"("target_id", "created_at");
CREATE INDEX "idx_trip_feedback_comments_author_id" ON "trip_feedback_comments"("author_id");

CREATE TABLE "trip_feedback_votes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "target_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_feedback_votes_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "trip_feedback_targets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "trip_feedback_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_trip_feedback_votes_target_id" ON "trip_feedback_votes"("target_id");
CREATE INDEX "idx_trip_feedback_votes_user_id" ON "trip_feedback_votes"("user_id");
CREATE UNIQUE INDEX "trip_feedback_votes_target_id_user_id_key" ON "trip_feedback_votes"("target_id", "user_id");

CREATE TRIGGER "trip_feedback_targets_trip_only_insert"
BEFORE INSERT ON "trip_feedback_targets"
WHEN NEW."target_type" = 'TRIP'
 AND (NEW."trip_day_id" IS NOT NULL OR NEW."accommodation_id" IS NOT NULL OR NEW."day_plan_item_id" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback TRIP target must not reference child records');
END;

CREATE TRIGGER "trip_feedback_targets_trip_day_only_insert"
BEFORE INSERT ON "trip_feedback_targets"
WHEN NEW."target_type" = 'TRIP_DAY'
 AND (NEW."trip_day_id" IS NULL OR NEW."accommodation_id" IS NOT NULL OR NEW."day_plan_item_id" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback TRIP_DAY target must reference exactly one trip day');
END;

CREATE TRIGGER "trip_feedback_targets_accommodation_only_insert"
BEFORE INSERT ON "trip_feedback_targets"
WHEN NEW."target_type" = 'ACCOMMODATION'
 AND (NEW."trip_day_id" IS NULL OR NEW."accommodation_id" IS NULL OR NEW."day_plan_item_id" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback ACCOMMODATION target must reference trip day and accommodation');
END;

CREATE TRIGGER "trip_feedback_targets_day_plan_item_only_insert"
BEFORE INSERT ON "trip_feedback_targets"
WHEN NEW."target_type" = 'DAY_PLAN_ITEM'
 AND (NEW."trip_day_id" IS NULL OR NEW."accommodation_id" IS NOT NULL OR NEW."day_plan_item_id" IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback DAY_PLAN_ITEM target must reference trip day and day plan item');
END;

CREATE TRIGGER "trip_feedback_targets_trip_only_update"
BEFORE UPDATE ON "trip_feedback_targets"
WHEN NEW."target_type" = 'TRIP'
 AND (NEW."trip_day_id" IS NOT NULL OR NEW."accommodation_id" IS NOT NULL OR NEW."day_plan_item_id" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback TRIP target must not reference child records');
END;

CREATE TRIGGER "trip_feedback_targets_trip_day_only_update"
BEFORE UPDATE ON "trip_feedback_targets"
WHEN NEW."target_type" = 'TRIP_DAY'
 AND (NEW."trip_day_id" IS NULL OR NEW."accommodation_id" IS NOT NULL OR NEW."day_plan_item_id" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback TRIP_DAY target must reference exactly one trip day');
END;

CREATE TRIGGER "trip_feedback_targets_accommodation_only_update"
BEFORE UPDATE ON "trip_feedback_targets"
WHEN NEW."target_type" = 'ACCOMMODATION'
 AND (NEW."trip_day_id" IS NULL OR NEW."accommodation_id" IS NULL OR NEW."day_plan_item_id" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback ACCOMMODATION target must reference trip day and accommodation');
END;

CREATE TRIGGER "trip_feedback_targets_day_plan_item_only_update"
BEFORE UPDATE ON "trip_feedback_targets"
WHEN NEW."target_type" = 'DAY_PLAN_ITEM'
 AND (NEW."trip_day_id" IS NULL OR NEW."accommodation_id" IS NOT NULL OR NEW."day_plan_item_id" IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'trip feedback DAY_PLAN_ITEM target must reference trip day and day plan item');
END;
