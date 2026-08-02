import { describe, expect, it } from "vitest";
import en from "@/i18n/en";
import de from "@/i18n/de";

describe("i18n dictionaries", () => {
  it("exports dictionary objects for en and de", () => {
    expect(en).toBeTruthy();
    expect(de).toBeTruthy();
    expect(typeof en).toBe("object");
    expect(typeof de).toBe("object");
  });

  /**
   * Story 6.17. Several specs assert that this file "enforces parity" between the two dictionaries;
   * until now it did not — it only checked that both objects exist. Nothing else enforces it either:
   * `Dictionary` is `Record<string, string>`, so TypeScript accepts any key set, and `translate()`
   * returns the key itself when it is missing, so a half-applied rename ships the raw
   * `trips.travelSegment.save` string to whichever language was forgotten instead of failing.
   */
  it("holds exactly the same keys in both languages", () => {
    // One assertion, not three: `toEqual` on the sorted key lists already names the offending keys
    // in its diff, and the two `filter` passes it replaced used the `in` operator, which walks the
    // prototype chain - a key literally named `toString` would have satisfied them.
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty values in either language", () => {
    expect(Object.entries(en).filter(([, value]) => value.trim() === "").map(([key]) => key)).toEqual([]);
    expect(Object.entries(de).filter(([, value]) => value.trim() === "").map(([key]) => key)).toEqual([]);
  });

  /**
   * Story 6.17, AC2 and AC3. Two keys had to leave, and an orphan is the failure mode neither the
   * component suite nor the parity check above can see: a key that no longer has a reader still
   * satisfies both, and `common.save` in particular is a name that invites the next dialog to pick
   * it up and ship an OK button.
   */
  describe("story 6.17 key changes", () => {
    const has = (dictionary: Record<string, string>, key: string) =>
      Object.prototype.hasOwnProperty.call(dictionary, key);

    it("no longer defines common.save in either language", () => {
      expect(has(en, "common.save")).toBe(false);
      expect(has(de, "common.save")).toBe(false);
    });

    it("defines the dialog-specific save key as OK in both languages", () => {
      expect(en["trips.travelSegment.save"]).toBe("OK");
      expect(de["trips.travelSegment.save"]).toBe("OK");
    });

    it("no longer defines the removed Google Maps fallback helper in either language", () => {
      expect(has(en, "trips.travelSegment.googleMapsFallbackHelper")).toBe(false);
      expect(has(de, "trips.travelSegment.googleMapsFallbackHelper")).toBe(false);
    });

    /**
     * The three action labels are the same word in both dictionaries by decision, not by an
     * untranslated leftover — which is what `de.ts` actually held for two of them before this story.
     * Pinned so that "translating" them back into longer German is a deliberate act with a failing
     * test attached, not a tidy-up.
     */
    it.each([
      ["trips.travelSegment.openLink", "Maps"],
      ["trips.travelSegment.calculateGoogleMapsRoute", "Plan"],
      ["trips.travelSegment.refreshGoogleMapsRoute", "Plan"],
      ["trips.travelSegment.save", "OK"],
    ])("uses the same short label for %s in both languages", (key, value) => {
      expect(en[key]).toBe(value);
      expect(de[key]).toBe(value);
    });

    /**
     * AC4. The helpers that survived did so because they are actionable; the ones that were
     * shortened lost only the sentence that explained the feature. This pins the outcome of each
     * judgement so a later "restore the fuller wording" has to argue with a test.
     */
    /**
     * Every helper this dialog can render, in *both* languages. German is usually the longer of the
     * two, but not always - `googleMapsNoRouteForMode` is 110 characters in English against 108 in
     * German - so a German-only budget leaves the English copy unbounded. The two long ones are
     * budgeted at their current length rather than at the target: `googleMapsManualModeHelper`
     * carries Story 6.16's AC5 (it must name car, walking and cycling) and
     * `googleMapsNoRouteForMode` is 6.16's key and outside this story's AC4 list. Neither may grow.
     */
    it.each([
      ["trips.travelSegment.googleMapsUnavailableHelper", 60],
      ["trips.travelSegment.googleMapsPrefillSuccess", 60],
      ["trips.travelSegment.googleMapsFallbackActive", 80],
      ["trips.travelSegment.googleMapsManualModeHelper", 110],
      ["trips.travelSegment.googleMapsNoRouteForMode", 115],
    ] as const)("keeps %s under %i characters in both languages", (key, ceiling) => {
      expect(en[key].length).toBeLessThan(ceiling);
      expect(de[key].length).toBeLessThan(ceiling);
    });

    /**
     * Story 6.16's AC5, which this story landed after and must not undo: the manual-mode helper
     * names the modes that do import and never claims car-only. Shortening it dropped the trailing
     * "you can still open Google Maps for a lookup" — a sentence the visible "Maps" button already
     * makes — and nothing else.
     */
    it.each(["en", "de"] as const)("keeps story 6.16's manual-mode helper truthful in %s", (language) => {
      const helper = (language === "en" ? en : de)["trips.travelSegment.googleMapsManualModeHelper"];
      expect(helper).not.toMatch(/nur für Auto|car only|car-only/i);
      for (const mode of language === "en" ? ["car", "walking", "cycling"] : ["Auto", "zu Fuß", "Fahrrad"]) {
        expect(helper).toContain(mode);
      }
    });
  });
});
