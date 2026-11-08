import { describe, expect, it } from "vitest";
import {
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
