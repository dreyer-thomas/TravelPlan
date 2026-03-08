ALTER TABLE "cost_payments" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE("accommodation_id", "day_plan_item_id")
      ORDER BY "due_date" ASC, "created_at" ASC, "id" ASC
    ) - 1 AS "next_sort_order"
  FROM "cost_payments"
)
UPDATE "cost_payments"
SET "sort_order" = (
  SELECT "next_sort_order"
  FROM ranked
  WHERE ranked."id" = "cost_payments"."id"
);

CREATE INDEX "idx_cost_payments_target_sort_order"
ON "cost_payments"("accommodation_id", "day_plan_item_id", "sort_order");
