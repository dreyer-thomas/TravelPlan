-- Story 8.7. One row per AI day search that reached Claude, holding only what it consumed: model, outcome,
-- duration and the token / web-search counts summed over the request and its `pause_turn` resumptions.
-- No prompt, wish, place, trip or day id (Story 12.1's privacy rule). No price is stored: cost is computed
-- at display time, so a price change needs no migration.
--
-- `user_id` is the first `ON DELETE SET NULL` in this schema. Everything else cascades, but a deleted
-- account's searches were still paid for, so the rows survive the account and a month's totals do not
-- shrink. Written as Prisma generates it from `schema.prisma`.

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "model" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_creation_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "web_search_requests" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ai_usage_records_created_at_idx" ON "ai_usage_records"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_idx" ON "ai_usage_records"("user_id");
