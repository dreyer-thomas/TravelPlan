-- CreateTable
CREATE TABLE "accommodation_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accommodation_id" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "accommodation_documents_accommodation_id_fkey" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "day_plan_item_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day_plan_item_id" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "day_plan_item_documents_day_plan_item_id_fkey" FOREIGN KEY ("day_plan_item_id") REFERENCES "day_plan_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_accommodation_documents_accommodation_id" ON "accommodation_documents"("accommodation_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_accommodation_documents_order" ON "accommodation_documents"("accommodation_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_day_plan_item_documents_item_id" ON "day_plan_item_documents"("day_plan_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_day_plan_item_documents_order" ON "day_plan_item_documents"("day_plan_item_id", "sort_order");
