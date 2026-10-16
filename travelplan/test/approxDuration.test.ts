import { describe, expect, it } from "vitest";
import { formatApproxDuration } from "@/lib/trips/approxDuration";
import de from "@/i18n/de";
import en from "@/i18n/en";

const tDe = (key: string) => de[key as keyof typeof de] ?? key;
const tEn = (key: string) => en[key as keyof typeof en] ?? key;

/** Story 12.3 Task 2. The "ca. 1½ h" a suggestion card shows for its typical duration. */
describe("formatApproxDuration", () => {
  it.each([
    [10, "ca. 10 min"],
    [45, "ca. 45 min"],
    [52, "ca. 50 min"],
    [59, "ca. 1 h"],
    [60, "ca. 1 h"],
    [90, "ca. 1½ h"],
    [100, "ca. 1½ h"],
    [105, "ca. 2 h"],
    [150, "ca. 2½ h"],
    [600, "ca. 10 h"],
  ])("writes %i minutes as %s", (minutes, expected) => {
    expect(formatApproxDuration(minutes, tDe)).toBe(expected);
  });

  it("never rounds a short duration down to nothing", () => {
    expect(formatApproxDuration(1, tDe)).toBe("ca. 5 min");
  });

  it("keeps a duration just under the hour in minutes when it rounds below 60", () => {
    expect(formatApproxDuration(57, tDe)).toBe("ca. 55 min");
  });

  it("uses the English wording", () => {
    expect(formatApproxDuration(90, tEn)).toBe("about 1½ h");
    expect(formatApproxDuration(45, tEn)).toBe("about 45 min");
  });
});
