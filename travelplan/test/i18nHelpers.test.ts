import { describe, expect, it } from "vitest";
import { resolveLanguage, translate } from "@/i18n";

describe("i18n helpers", () => {
  it("resolves supported languages and falls back to default", () => {
    expect(resolveLanguage("de")).toBe("de");
    expect(resolveLanguage("fr")).toBe("en");
    expect(resolveLanguage(undefined)).toBe("en");
  });

  it("translates keys with fallback to key", () => {
    const dictionary = { greeting: "Hello" };
    expect(translate(dictionary, "greeting")).toBe("Hello");
    expect(translate(dictionary, "missing.key")).toBe("missing.key");
  });
});
