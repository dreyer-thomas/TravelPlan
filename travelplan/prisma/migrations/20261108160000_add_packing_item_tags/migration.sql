-- Story 16.8. Free tags on packing items ("Kaufen", "Aufladen", "Zoll anmelden"). One row per tag; the
-- composite primary key on (item, tag key) keeps a tag unique per item ignoring case. The repository
-- stores the trip's first spelling of a tag key.
--
-- Additive only. Written as Prisma generates it from `schema.prisma` (the CreateTable part of the diff).

-- CreateTable
CREATE TABLE "packing_item_tags" (
    "packing_item_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "tag_key" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("packing_item_id", "tag_key"),
    CONSTRAINT "packing_item_tags_packing_item_id_fkey" FOREIGN KEY ("packing_item_id") REFERENCES "packing_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
