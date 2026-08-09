import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, resolveLanguage, translate } from "@/i18n";

describe("i18n helpers", () => {
  it("resolves supported languages and falls back to default", () => {
    expect(resolveLanguage("de")).toBe("de");
    expect(resolveLanguage("fr")).toBe("en");
    expect(resolveLanguage(undefined)).toBe("en");
  });

  /**
   * `isLanguage` used to be `value in dictionaries`, and `in` walks the prototype chain - so every member
   * of `Object.prototype` resolved as a language. `resolveLanguage("valueOf")` returned `"valueOf"`, and
   * both `dictionaries["valueOf"]` and `INTL_LOCALES["valueOf"]` are then *functions*: the packet's label
   * pages would be drawn with raw dictionary keys and `Intl.DateTimeFormat` would silently fall back to the
   * OS locale. Reachable from the `lang` cookie, which is not `httpOnly` and so is user-writable.
   *
   * Pinned by name rather than by "some odd string falls back", because the defect is specific to the
   * inherited members and an arbitrary string (`"fr"` above) passed the broken version perfectly well.
   */
  it.each(["valueOf", "constructor", "toString", "hasOwnProperty", "__proto__"])(
    "does not accept the prototype member %s as a language",
    (value) => {
      expect(resolveLanguage(value)).toBe(DEFAULT_LANGUAGE);
    },
  );

  it("translates keys with fallback to key", () => {
    const dictionary = { greeting: "Hello" };
    expect(translate(dictionary, "greeting")).toBe("Hello");
    expect(translate(dictionary, "missing.key")).toBe("missing.key");
  });
});
