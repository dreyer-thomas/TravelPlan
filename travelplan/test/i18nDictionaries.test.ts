import { describe, expect, it } from "vitest";
import en from "@/i18n/en";
import de from "@/i18n/de";
import { dictionaries } from "@/i18n";

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

  /**
   * Story 6.18, AC2. Three keys left, and an orphan is again the failure the parity check above
   * cannot see: it only says the two dictionaries agree, not that a key is gone from both.
   * `trips.plan.fromTimeHelper` and `trips.plan.toTimeHelper` were dead — no source file read them —
   * and described an `HH:mm` format the day-plan dialog's native time picker never asks anyone to
   * produce. `trips.travelSegment.durationLabel` said "Duration (HH:mm)" over a field that is now
   * two number boxes, so its format claim stopped being true.
   *
   * `trips.stay.timeInvalid` ("Enter time as HH:mm") is deliberately *not* here: it is a validation
   * message, which AC5 preserves, not a hint explaining a control.
   */
  describe("story 6.18 key changes", () => {
    const has = (dictionary: Record<string, string>, key: string) =>
      Object.prototype.hasOwnProperty.call(dictionary, key);

    it.each([
      "trips.plan.fromTimeHelper",
      "trips.plan.toTimeHelper",
      "trips.travelSegment.durationLabel",
    ])("no longer defines %s in either language", (key) => {
      expect(has(en, key)).toBe(false);
      expect(has(de, key)).toBe(false);
    });

    /**
     * Review pass: this key is kept, but say plainly what it is now. A native time input hands back
     * either `""` or a well-formed `HH:mm`, so `normalizeTimeInput` can no longer fail on a
     * non-empty value and this message is unreachable from the accommodation dialog. It stays
     * because AC5 preserves validation rules and messages, and because the rule still guards a
     * value that did not come from that control. It is not evidence that a user can still see it —
     * see the partial-entry case in `tripAccommodationDialog.test.tsx`.
     */
    it("keeps the stay time validation message, which is a rule and not a hint", () => {
      expect(has(en, "trips.stay.timeInvalid")).toBe(true);
      expect(has(de, "trips.stay.timeInvalid")).toBe(true);
    });

    /**
     * Each replacement label is its box's accessible name — WCAG 2.5.3, so no `aria-label` may
     * diverge from it — and both are what `travelSegmentDialog.test.tsx` queries by. Pinned here so
     * a "clearer" longer label has to argue with a test: the pair shares one row of a dialog that
     * has to fit a 390px phone.
     */
    it.each([
      ["trips.travelSegment.durationHoursLabel", "Duration (h)", "Dauer (Std.)"],
      ["trips.travelSegment.durationMinutesLabel", "Duration (min)", "Dauer (Min.)"],
    ])("defines %s as the short label in both languages", (key, english, german) => {
      expect(en[key]).toBe(english);
      expect(de[key]).toBe(german);
    });
  });

  /**
   * Story 6.21. The day stat strip is four cells in a two-column grid at `xs`, and a grid row is as
   * tall as its tallest cell. `statCheckIn` interpolated the accommodation's name into a *label*, so
   * one long hotel name made the whole second row tall - spend cell included. It is gone; the no-stay
   * key `statCheckInGeneric` is the only one left and is now taken unconditionally.
   *
   * `statCheckInGeneric` deliberately keeps its name, though "Generic" no longer contrasts with
   * anything. The reason is not that a rename could not be tested - `toBe("Check-in")` separates a
   * renamed survivor from an orphaned `"Check-in {name}"` perfectly well. It is that `statCheckIn` is
   * a *retired* name: it is quoted as the strip's parameterised key in shipped specs (7-3, 7-11) and
   * throughout this repo's history. Rebinding it to a string with different semantics would make every
   * one of those references silently wrong instead of obviously stale. A slightly odd suffix is the
   * cheaper of the two, and it costs the reader one comment.
   */
  describe("story 6.21 stat strip labels", () => {
    const has = (dictionary: Record<string, string>, key: string) =>
      Object.prototype.hasOwnProperty.call(dictionary, key);

    it("no longer defines the name-interpolating check-in label in either language", () => {
      expect(has(en, "trips.dayView.statCheckIn")).toBe(false);
      expect(has(de, "trips.dayView.statCheckIn")).toBe(false);
    });

    it("keeps exactly one check-in label, with no {name} placeholder left in it", () => {
      expect(en["trips.dayView.statCheckInGeneric"]).toBe("Check-in");
      expect(de["trips.dayView.statCheckInGeneric"]).toBe("Check-in");
    });

    it.each([
      ["trips.dayView.statTravelTime", "Travel time", "Fahrzeit"],
      ["trips.dayView.statSpendToday", "Spend", "Ausgaben"],
    ])("shortens %s in both languages", (key, english, german) => {
      expect(en[key]).toBe(english);
      expect(de[key]).toBe(german);
    });

    /**
     * The strip's labels dropped `overflowWrap: "anywhere"` in this story - the rule existed so a hotel
     * name could break mid-word, and breaking mid-word is what turned one long name into a taller row.
     * With it gone the dictionary is what keeps these four strings inside their cells, so this is the
     * guard that replaces it.
     *
     * The binding constraint is the *longest unbroken word*, not the string length: a label may still
     * wrap at a space, but nothing can break inside a word any more, so one long word is what overflows
     * - and the wrapper's `overflow: hidden` clips it silently rather than showing it. The narrowest
     * cell is not the phone: at `sm` the grid goes to four columns, so at a 600px viewport each cell is
     * about (600 - 32 gutters - 3 borders) / 4 - 48 padding = ~89px, against ~130px at 390px. At
     * 10.5px uppercase with 0.08em tracking that is roughly 11 characters, so 10 is the ceiling with a
     * little room, and 14 bounds the whole string to at most two short lines.
     *
     * Character count is a proxy for pixels and an imperfect one - the text is uppercased at render, so
     * the measured string is not the drawn string. Treat a failure here as "check this in a browser at
     * 600px", not as a law.
     *
     * No placeholder either: a `{...}` in one of these is user-supplied text finding its way back into
     * a label, which is the whole defect this story removed.
     */
    const STAT_LABEL_KEYS = [
      "trips.dayView.statDay",
      "trips.dayView.statTravelTime",
      "trips.dayView.statSpendToday",
      "trips.dayView.statCheckInGeneric",
    ];

    // Iterate the registry rather than a hardcoded [en, de]: a third locale added to
    // `src/i18n/index.ts` must inherit this guard instead of quietly escaping it.
    it.each(STAT_LABEL_KEYS)("keeps %s short and placeholder-free in every language", (key) => {
      for (const [language, dictionary] of Object.entries(dictionaries)) {
        const value: string | undefined = dictionary[key];
        // Asserted rather than assumed, so a key missing from one locale fails by name here instead of
        // throwing "cannot read length of undefined" a line later.
        expect(value, `${key} missing from ${language}`).toBeTypeOf("string");

        const longestWord = Math.max(...value!.split(/\s+/).map((word) => word.length));
        expect(longestWord, `${language}: "${value}" has an unbreakable word too wide for the cell`).toBeLessThanOrEqual(10);
        expect(value!.length, `${language}: "${value}" is too long for the stat strip`).toBeLessThanOrEqual(14);
        expect(value).not.toMatch(/\{/);
      }
    });
  });

  /**
   * Story 6.24. Three keys left the activity dialog and one arrived, and an orphan is again the
   * failure the parity check cannot see: it only says the two dictionaries agree.
   *
   * `saveNew` ("Element speichern") and `saveUpdate` ("Änderungen speichern") both became "OK", which
   * is precisely the shape Story 6.17 called a trap on `common.save` — two names for one word, the
   * second of which the next dialog picks up without deciding anything. They are collapsed into
   * `trips.plan.save` rather than kept as a matched pair. `deleteItem` ("Löschen") lost its only
   * reader when the footer's delete became a trash glyph named by `deleteItemAria`.
   */
  describe("story 6.24 key changes", () => {
    const has = (dictionary: Record<string, string>, key: string) =>
      Object.prototype.hasOwnProperty.call(dictionary, key);

    it.each(["trips.plan.saveNew", "trips.plan.saveUpdate", "trips.plan.deleteItem"])(
      "no longer defines %s in either language",
      (key) => {
        expect(has(en, key)).toBe(false);
        expect(has(de, key)).toBe(false);
      },
    );

    /**
     * Not `common.ok`, and that is the same judgement Story 6.17 recorded in `en.ts`: a `common.`
     * name invites the next dialog to inherit an OK button it never chose. One dialog-specific key
     * with one word in it.
     */
    it("defines one plan save key, reading OK in both languages", () => {
      expect(en["trips.plan.save"]).toBe("OK");
      expect(de["trips.plan.save"]).toBe("OK");
    });

    /**
     * AC5. The glyph's accessible name is the pre-existing aria string, and it names the object
     * ("Planpunkt löschen") rather than the mechanism ("Löschen") — DESIGN.md.icon-button requires
     * exactly that of an icon-only control, because the name is now the only word it carries.
     */
    it("keeps the delete aria string, which is now the control's only label", () => {
      expect(en["trips.plan.deleteItemAria"]).toBe("Delete plan item");
      expect(de["trips.plan.deleteItemAria"]).toBe("Planpunkt löschen");
    });

    /**
     * AC7. The German is the binding wording — it is what the request itself said, lower case
     * included — and it is short on purpose: the footer has to fit one row at 390px. The full
     * sentence still reaches the user one step later, on `moveDialogTitle`, which is why shortening
     * this one costs nothing. Pinned so a "clearer" restoration has to argue with a test.
     */
    it("shortens the move action while the dialog it opens keeps the full sentence", () => {
      expect(de["trips.plan.moveAction"]).toBe("anderer Tag");
      expect(en["trips.plan.moveAction"]).toBe("Another day");
      expect(de["trips.plan.moveDialogTitle"]).toBe("Auf anderen Tag verschieben");
      expect(en["trips.plan.moveDialogTitle"]).toBe("Move to another day");
    });

    /**
     * AC3a / EXPERIENCE.md.Voice and Tone. The body names what goes rather than asking "are you
     * sure?", and the safe answer names what it preserves. Both are pinned because both are the
     * reason the pattern exists: a 44px glyph with no word for its consequence, guarded by a
     * question whose safe half is also wordless, would be no better than the unguarded `✕`.
     */
    it("words the discard confirmation as an outcome, not a mechanism", () => {
      expect(de["trips.plan.discardBody"]).toBe("Deine Änderungen an diesem Planpunkt werden verworfen.");
      // Story 6.25 promoted the title, the safe answer and the discard action to `common.discard.*`
      // — ten dialogs say those three things now, and only the body names its object. Same assertion,
      // one level up; see the `story 6.25 key changes` block.
      expect(de["common.discard.keep"]).toBe("Weiter bearbeiten");
      expect(en["common.discard.keep"]).toBe("Keep editing");
      for (const dictionary of [en, de]) {
        expect(dictionary["common.discard.keep"]).not.toMatch(/^(Cancel|Abbrechen)$/);
      }
    });

    /**
     * AC3 chose reuse over a second key: `common.close` already existed with two readers, so the
     * title-row `✕` takes its name from there. It must therefore stay defined — and stay a close
     * word rather than drifting into something a screen-reader user could not act on.
     */
    it("keeps common.close, which now also names every title-row close glyph", () => {
      expect(en["common.close"]).toBe("Close");
      expect(de["common.close"]).toBe("Schließen");
    });

  });

  /**
   * Story 6.25. `common.cancel` had eleven readers when 6.24 left it alone; this story removed the
   * last of them, so the key goes the same way `common.save` did in 6.17 — deleted rather than left
   * defined and waiting for the next dialog to pick a footer Cancel back up.
   *
   * The orphan is the failure neither the parity check nor any component suite can see: a key with no
   * readers satisfies both. That is the whole reason this block exists.
   */
  describe("story 6.25 key changes", () => {
    const has = (dictionary: Record<string, string>, key: string) =>
      Object.prototype.hasOwnProperty.call(dictionary, key);

    it("no longer defines common.cancel in either language", () => {
      expect(has(en, "common.cancel")).toBe(false);
      expect(has(de, "common.cancel")).toBe(false);
    });

    /**
     * The three keys 6.24 scoped to the activity dialog moved to `common.discard.*` when nine more
     * dialogs started asking the same question. Their old names must not survive alongside the new
     * ones — two names for one word is the `common.save` trap, and here it would be four of them.
     */
    it.each(["trips.plan.discardTitle", "trips.plan.discardConfirm", "trips.plan.discardKeep"])(
      "no longer defines %s in either language",
      (key) => {
        expect(has(en, key)).toBe(false);
        expect(has(de, key)).toBe(false);
      },
    );

    /**
     * A `common.` name for a genuinely shared thing, which is the distinction the 6.17 note was
     * drawing: the trap is a shared-*sounding* name with one reader. Ten dialogs read these.
     */
    it("defines the shared discard wording in both languages", () => {
      expect(de["common.discard.title"]).toBe("Änderungen verwerfen?");
      expect(en["common.discard.title"]).toBe("Discard changes?");
      expect(de["common.discard.confirm"]).toBe("Änderungen verwerfen");
      expect(en["common.discard.confirm"]).toBe("Discard changes");
      // The generic body still names the outcome rather than asking "are you sure?" — Voice and Tone.
      expect(de["common.discard.body"]).toBe("Deine Änderungen werden verworfen.");
      expect(en["common.discard.body"]).toBe("Your changes will be discarded.");
    });

    /**
     * AC3. The safe half of each destructive confirmation names what it *keeps*. Both are pinned
     * against the mechanism word as well as for their value: "Abbrechen" creeping back here is the
     * exact regression EXPERIENCE.md.Voice and Tone forbids, and it would still read plausibly.
     *
     * The English says "Keep item", not the story's parenthetical "Keep entry": its neighbour is
     * `trips.bucketList.deleteConfirm` = "Delete item", and two outcomes about one object have to use
     * one noun for it or the pair stops reading as a pair. The German is the binding wording and is
     * exactly as the request wrote it.
     */
    it("names what each destructive confirmation keeps, in the same noun as its neighbour", () => {
      expect(de["trips.delete.keep"]).toBe("Reise behalten");
      expect(en["trips.delete.keep"]).toBe("Keep trip");
      expect(de["trips.bucketList.deleteKeep"]).toBe("Eintrag behalten");
      expect(en["trips.bucketList.deleteKeep"]).toBe("Keep item");

      for (const dictionary of [en, de]) {
        for (const key of ["trips.delete.keep", "trips.bucketList.deleteKeep"]) {
          expect(dictionary[key]).not.toMatch(/^(Cancel|Abbrechen)$/);
        }
      }

      // The noun match, asserted rather than left to the eye: "Keep entry" beside "Delete item" would
      // pass every check above and still break the thing AC3 is about.
      //
      // Story 6.25 review rewrote this. It used to index `.split(" ")` by position and checked the
      // English bucket-list pair and the German trip pair only — so the German bucket-list pair and
      // the English trip pair went unchecked, and reworking German to "Eintrag behalten" beside
      // "Punkt löschen" passed. The index arithmetic also broke on any label that gained a word.
      // Both pairs are now checked in both languages, by shared word rather than by position: the
      // verbs differ within a pair ("behalten"/"löschen", "Keep"/"Delete"), so the only word the two
      // labels can have in common is the object they are both about.
      const sharedWords = (a: string, b: string) => {
        const bWords = b.split(/\s+/).filter(Boolean);
        return a
          .split(/\s+/)
          .filter(Boolean)
          .filter((word) => bWords.includes(word));
      };

      const pairs: [string, string][] = [
        ["trips.delete.keep", "trips.delete.submit"],
        ["trips.bucketList.deleteKeep", "trips.bucketList.deleteConfirm"],
      ];
      for (const dictionary of [en, de]) {
        for (const [keepKey, deleteKey] of pairs) {
          expect(sharedWords(dictionary[keepKey], dictionary[deleteKey]).length).toBeGreaterThan(0);
        }
      }
    });

    // `common.close` is now the accessible name of all **fifteen** title-row `✕` controls (four via
    // `DialogShell`, eleven via `DialogTitleWithClose`) rather than one dialog's, but 6.24 already pins
    // its value in both languages and a second copy of that assertion would only have to be kept in
    // step with the first.
  });
});
