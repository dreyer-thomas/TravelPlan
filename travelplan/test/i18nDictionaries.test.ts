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
});
