import { describe, expect, it } from "vitest";
import { resolveLanguage, LANGUAGE_COOKIE_NAME, DEFAULT_LANGUAGE } from "@/i18n";

describe("language cookie constants", () => {
  it("exposes expected cookie name and default", () => {
    expect(LANGUAGE_COOKIE_NAME).toBe("lang");
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(resolveLanguage("de")).toBe("de");
  });
});
