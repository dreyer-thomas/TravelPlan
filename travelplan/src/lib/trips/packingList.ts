/**
 * Story 16.1 (FR58). The packing list's pure rules: name and category normalization, the per-trip name
 * key, the category grouping and order, and the category suggestions. No Prisma here, so the page, the
 * repository, the backup import (and from 16.2 on the day section, the day email and the connector) all
 * read the same rules.
 */

export const PACKING_ITEM_NAME_MAX = 80;
export const PACKING_CATEGORY_MAX = 40;

/** The labels "no category" is shown under. A typed category equal to one of them (ignoring case) is no category. */
const OTHER_CATEGORY_KEYS = new Set(["sonstiges", "other"]);

/** The stored spelling of a name: NFC, trimmed. */
export const normalizePackingName = (raw: string) => raw.normalize("NFC").trim();

/**
 * The per-trip uniqueness key: NFC, trimmed, lower-cased. `toLowerCase()` after NFC folds umlauts too
 * ("Ä" → "ä"), which SQLite's `COLLATE NOCASE` would not.
 */
export const packingNameKey = (name: string) => normalizePackingName(name).toLowerCase();

/**
 * Trimmed; empty → `null`; "Sonstiges" / "Other" in any case → `null`, so picking the "Other" suggestion
 * never forms a second "Other" group next to the items without a category.
 */
export const normalizePackingCategory = (raw: string | null | undefined): string | null => {
  if (raw == null) return null;
  const trimmed = raw.normalize("NFC").trim();
  if (trimmed.length === 0) return null;
  if (OTHER_CATEGORY_KEYS.has(trimmed.toLowerCase())) return null;
  return trimmed;
};

export type PackingGroup<T> = {
  /** The lower-cased category, or `null` for the "Other" group. */
  key: string | null;
  label: string;
  packed: number;
  total: number;
  items: T[];
};

type GroupableItem = { id: string; name: string; category: string | null; packed: boolean };

/**
 * Groups by category (ignoring case; the first spelling met labels the group). Categories alphabetical,
 * locale-aware and case-insensitive, with the "Other" group (no category) last; items alphabetical within
 * a group, ties by id so the order is stable. Packed items keep their place.
 */
export const groupPackingItems = <T extends GroupableItem>(
  items: readonly T[],
  otherLabel: string,
  locale: string,
): PackingGroup<T>[] => {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const byKey = new Map<string | null, PackingGroup<T>>();

  for (const item of items) {
    const category = normalizePackingCategory(item.category);
    const key = category === null ? null : category.toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: category ?? otherLabel, packed: 0, total: 0, items: [] };
      byKey.set(key, group);
    }
    group.items.push(item);
    group.total += 1;
    if (item.packed) group.packed += 1;
  }

  const groups = [...byKey.values()];
  for (const group of groups) {
    group.items.sort((left, right) => {
      const byName = collator.compare(left.name, right.name);
      if (byName !== 0) return byName;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }

  return groups.sort((left, right) => {
    if (left.key === null) return right.key === null ? 0 : 1;
    if (right.key === null) return -1;
    const byLabel = collator.compare(left.label, right.label);
    if (byLabel !== 0) return byLabel;
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
};

/**
 * The category input's suggestions: the localized defaults first, then every category already used on
 * the trip that is not one of them (ignoring case), alphabetically. Nothing is stored as a list.
 */
export const suggestedPackingCategories = (
  defaults: readonly string[],
  usedCategories: readonly (string | null | undefined)[],
  locale = "en",
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of defaults) {
    const key = label.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(label.trim());
  }

  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const extra: string[] = [];
  for (const raw of usedCategories) {
    const category = normalizePackingCategory(raw);
    if (category === null) continue;
    const key = category.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(category);
  }
  extra.sort((left, right) => collator.compare(left, right));
  return [...result, ...extra];
};
