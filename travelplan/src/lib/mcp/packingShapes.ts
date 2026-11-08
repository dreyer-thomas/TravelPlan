import type { PackingItemDetail } from "@/lib/repositories/packingListRepo";

/**
 * Story 16.4. A packing item as the connector's packing tools hand it to the model: its day ids ascending by
 * `dayIndex` (as `toDetail` sorts them), ISO 8601 stamps, and `aiChangedAt` (the key every connector read
 * uses for the KI/AI marker; `null` once a person has edited the item).
 */
export const toPackingItem = (item: PackingItemDetail) => ({
  id: item.id,
  name: item.name,
  category: item.category,
  packed: item.packed,
  dayIds: item.days.map((day) => day.id),
  updatedAt: item.updatedAt.toISOString(),
  aiChangedAt: item.aiChangedAt ? item.aiChangedAt.toISOString() : null,
});
