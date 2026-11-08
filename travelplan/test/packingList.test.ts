import { describe, expect, it } from "vitest";
import {
  collectPackingTags,
  dedupePackingTags,
  itemHasAnyPackingTag,
  normalizePackingTag,
  packingTagKey,
  resolvePackingTagSelection,
  sortPackingTags,
  suggestedPackingTags,
  groupPackingItems,
  normalizePackingCategory,
  normalizePackingName,
  packingNameKey,
  resolvePackingCategorySelection,
  suggestedPackingCategories,
} from "@/lib/trips/packingList";

/** Story 16.1. The packing list's pure rules (AC 2, 3, 4, 6). */

const item = (id: string, name: string, category: string | null, packed = false) => ({ id, name, category, packed });

describe("packing list rules (Story 16.1)", () => {
  it("keys a name trimmed and lower-cased, umlauts included", () => {
    expect(packingNameKey("  Taucherbrille ")).toBe("taucherbrille");
    expect(packingNameKey("TAUCHERBRILLE")).toBe(packingNameKey("taucherbrille"));
    expect(packingNameKey("Ärmelshirt")).toBe(packingNameKey("ärmelshirt"));
    // NFD "a" + combining diaeresis folds to the same key as the precomposed form.
    expect(packingNameKey("Ärmelshirt")).toBe(packingNameKey("Ärmelshirt"));
    expect(normalizePackingName("  Sonnencreme  ")).toBe("Sonnencreme");
  });

  it("normalizes categories: empty and Other mean none", () => {
    expect(normalizePackingCategory(undefined)).toBeNull();
    expect(normalizePackingCategory(null)).toBeNull();
    expect(normalizePackingCategory("   ")).toBeNull();
    expect(normalizePackingCategory("sonstiges")).toBeNull();
    expect(normalizePackingCategory("OTHER")).toBeNull();
    expect(normalizePackingCategory(" Sonstiges ")).toBeNull();
    expect(normalizePackingCategory("  Technik ")).toBe("Technik");
  });

  it("groups alphabetically with Other last, items alphabetical, counts packed/total", () => {
    const groups = groupPackingItems(
      [
        item("1", "Ladekabel", "Technik", true),
        item("2", "Adapter", "technik"),
        item("3", "Pass", "Dokumente", true),
        item("4", "Regenschirm", null),
        item("5", "zahnbürste", "Hygiene"),
        item("6", "Badehose", "Sonstiges"),
        item("7", "Äpfel", "Essen"),
        item("8", "Zelt", "Ausrüstung"),
      ],
      "Sonstiges",
      "de-DE",
    );

    expect(groups.map((group) => group.label)).toEqual(["Ausrüstung", "Dokumente", "Essen", "Hygiene", "Technik", "Sonstiges"]);
    const technik = groups.find((group) => group.label === "Technik")!;
    expect(technik.items.map((entry) => entry.name)).toEqual(["Adapter", "Ladekabel"]);
    expect([technik.packed, technik.total]).toEqual([1, 2]);
    const other = groups.at(-1)!;
    expect(other.key).toBeNull();
    expect(other.items.map((entry) => entry.name)).toEqual(["Badehose", "Regenschirm"]);
    expect([other.packed, other.total]).toEqual([0, 2]);
  });

  it("sorts names locale-aware and case-insensitive", () => {
    const [group] = groupPackingItems(
      [item("1", "zelt", null), item("2", "Äpfel", null), item("3", "apfelsaft", null), item("4", "Brot", null)],
      "Other",
      "de-DE",
    );
    expect(group.items.map((entry) => entry.name)).toEqual(["Äpfel", "apfelsaft", "Brot", "zelt"]);
  });

  it("returns no groups for no items", () => {
    expect(groupPackingItems([], "Other", "en-US")).toEqual([]);
  });

  it("suggests defaults first, then used categories not already present", () => {
    expect(
      suggestedPackingCategories(
        ["Kleidung", "Technik", "Sonstiges"],
        ["technik", "Angeln", null, "Bücher", "angeln", "other"],
        "de-DE",
      ),
    ).toEqual(["Kleidung", "Technik", "Sonstiges", "Angeln", "Bücher"]);
  });
});

describe("packing list write schemas (Story 16.1 review)", () => {
  it("measures name and category length after NFC normalization", async () => {
    const { packingItemCreateSchema } = await import("@/lib/validation/packingListSchemas");
    // U+0958 is a composition exclusion: NFC turns each one into two code units.
    const growing = "क़".repeat(80);
    expect(growing.length).toBe(80);
    expect(packingItemCreateSchema.safeParse({ name: growing }).success).toBe(false);
    expect(packingItemCreateSchema.safeParse({ name: "x", category: "क़".repeat(40) }).success).toBe(false);
    const parsed = packingItemCreateSchema.parse({ name: "  Café  ", category: "  Technik " });
    expect(parsed).toEqual({ name: "Café", category: "Technik" });
  });
});

describe("packing category selection (Story 16.6)", () => {
  const keys = ["electronics", "kleidung", "toiletries", null];

  it("keeps the stored keys that exist, in group order", () => {
    expect(resolvePackingCategorySelection(["toiletries", "electronics"], keys)).toEqual(["electronics", "toiletries"]);
  });

  it("drops a vanished key, and answers [] when all vanished", () => {
    expect(resolvePackingCategorySelection(["kleidung", "gone"], keys)).toEqual(["kleidung"]);
    expect(resolvePackingCategorySelection(["gone"], keys)).toEqual([]);
  });

  it("keeps the Other group (null) when it exists", () => {
    expect(resolvePackingCategorySelection([null], keys)).toEqual([null]);
    expect(resolvePackingCategorySelection([null], ["electronics", "kleidung"])).toEqual([]);
  });

  it("collapses duplicates and matches ignoring case", () => {
    expect(resolvePackingCategorySelection(["Kleidung", "kleidung", "KLEIDUNG"], keys)).toEqual(["kleidung"]);
  });

  it("answers [] with fewer than two groups", () => {
    expect(resolvePackingCategorySelection(["kleidung"], ["kleidung"])).toEqual([]);
    expect(resolvePackingCategorySelection([null], [])).toEqual([]);
  });
});

describe("packing tags (Story 16.8)", () => {
  it("normalizes and keys a tag: NFC, trimmed, lower-cased", () => {
    expect(normalizePackingTag("  Kaufen ")).toBe("Kaufen");
    expect(packingTagKey(" Äußern ")).toBe("äußern");
    expect(packingTagKey("Cafe\u0301")).toBe(packingTagKey("Café"));
  });

  it("dedupes ignoring case, keeps the first spelling and the input order, drops empties", () => {
    expect(dedupePackingTags(["Kaufen", " ", "aufladen", "KAUFEN", " Aufladen "])).toEqual(["Kaufen", "aufladen"]);
  });

  it("sorts alphabetically, ignoring case", () => {
    expect(sortPackingTags(["kaufen", "Aufladen", "Zoll anmelden", "Ärger"], "de")).toEqual([
      "Ärger",
      "Aufladen",
      "kaufen",
      "Zoll anmelden",
    ]);
  });

  it("suggests the defaults first, then the trip's tags not among them, alphabetically", () => {
    expect(
      suggestedPackingTags(["Kaufen", "Aufladen"], ["zoll", "kaufen", "Batterie", "Zoll"], "de"),
    ).toEqual(["Kaufen", "Aufladen", "Batterie", "zoll"]);
  });

  it("collects the trip's tags with the first spelling met, sorted by label", () => {
    expect(
      collectPackingTags([{ tags: ["kaufen", "Zoll"] }, { tags: ["Kaufen", "Aufladen"] }, { tags: [] }], "de"),
    ).toEqual([
      { key: "aufladen", label: "Aufladen" },
      { key: "kaufen", label: "kaufen" },
      { key: "zoll", label: "Zoll" },
    ]);
  });

  it("resolves the stored selection: existing keys in chip order, vanished keys ignored, one tag is enough", () => {
    expect(resolvePackingTagSelection(["KAUFEN"], ["kaufen"])).toEqual(["kaufen"]);
    expect(resolvePackingTagSelection(["zoll", "aufladen", "gone"], ["aufladen", "kaufen", "zoll"])).toEqual([
      "aufladen",
      "zoll",
    ]);
    expect(resolvePackingTagSelection(["gone"], ["kaufen"])).toEqual([]);
  });

  it("matches an item against any selected tag, and everything for no selection", () => {
    expect(itemHasAnyPackingTag({ tags: [] }, [])).toBe(true);
    expect(itemHasAnyPackingTag({ tags: ["Kaufen"] }, ["aufladen", "kaufen"])).toBe(true);
    expect(itemHasAnyPackingTag({ tags: ["Kaufen"] }, ["aufladen"])).toBe(false);
    expect(itemHasAnyPackingTag({ tags: [] }, ["kaufen"])).toBe(false);
  });

  it("validates tags: 1-30 characters after NFC, no comma, at most 10, deduped", async () => {
    const { packingItemCreateSchema, packingItemUpdateSchema } = await import("@/lib/validation/packingListSchemas");
    expect(packingItemCreateSchema.safeParse({ name: "x", tags: ["a".repeat(31)] }).success).toBe(false);
    expect(packingItemCreateSchema.safeParse({ name: "x", tags: ["a".repeat(30)] }).success).toBe(true);
    expect(packingItemCreateSchema.safeParse({ name: "x", tags: ["a,b"] }).success).toBe(false);
    expect(packingItemCreateSchema.safeParse({ name: "x", tags: ["  "] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, index) => `t${index}`);
    expect(packingItemCreateSchema.safeParse({ name: "x", tags: eleven }).success).toBe(false);
    expect(packingItemCreateSchema.parse({ name: "x", tags: [" Kaufen", "kaufen", "Aufladen"] }).tags).toEqual([
      "Kaufen",
      "Aufladen",
    ]);
    expect(packingItemUpdateSchema.safeParse({ itemId: "i", tags: [] }).success).toBe(true);
  });
});
