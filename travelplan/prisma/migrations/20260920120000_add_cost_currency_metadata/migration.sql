-- AlterTable
-- All columns are nullable with no DEFAULT and no backfill: NULL is the correct
-- and complete description of every pre-existing row, which was entered in EUR.
ALTER TABLE "accommodations" ADD COLUMN "cost_original_amount" INTEGER;
ALTER TABLE "accommodations" ADD COLUMN "cost_currency" TEXT;
ALTER TABLE "accommodations" ADD COLUMN "cost_rate" REAL;
ALTER TABLE "accommodations" ADD COLUMN "cost_rate_date" TEXT;

-- AlterTable
ALTER TABLE "day_plan_items" ADD COLUMN "cost_original_amount" INTEGER;
ALTER TABLE "day_plan_items" ADD COLUMN "cost_currency" TEXT;
ALTER TABLE "day_plan_items" ADD COLUMN "cost_rate" REAL;
ALTER TABLE "day_plan_items" ADD COLUMN "cost_rate_date" TEXT;

-- AlterTable
-- Currency and rate live only on the parent entry; the payment row carries the
-- typed original amount alone, so two rates can never coexist in one entry.
ALTER TABLE "cost_payments" ADD COLUMN "amount_original" INTEGER;
