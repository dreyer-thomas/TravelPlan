-- Story 16.7. "Not needed this time": a packing item that stays on the trip's list but is not needed on
-- this trip. The repository keeps the invariant that such an item is never packed and never linked to a day.
--
-- Additive only. Written as Prisma generates it from `schema.prisma`.

-- AlterTable
ALTER TABLE "packing_items" ADD COLUMN "not_needed" BOOLEAN NOT NULL DEFAULT false;
