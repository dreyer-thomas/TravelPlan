-- CreateTable
CREATE TABLE "cost_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accommodation_id" TEXT,
    "day_plan_item_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "due_date" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "cost_payments_one_target_check" CHECK (
      ("accommodation_id" IS NOT NULL AND "day_plan_item_id" IS NULL) OR
      ("accommodation_id" IS NULL AND "day_plan_item_id" IS NOT NULL)
    ),
    CONSTRAINT "cost_payments_accommodation_id_fkey" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cost_payments_day_plan_item_id_fkey" FOREIGN KEY ("day_plan_item_id") REFERENCES "day_plan_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_cost_payments_accommodation_id" ON "cost_payments"("accommodation_id");

-- CreateIndex
CREATE INDEX "idx_cost_payments_day_plan_item_id" ON "cost_payments"("day_plan_item_id");

-- RedefineIndex
DROP INDEX "idx_trips_user_id";
CREATE INDEX "trips_user_id_idx" ON "trips"("user_id");
