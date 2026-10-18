import { describe, expect, it } from "vitest";
import de from "@/i18n/de";
import en from "@/i18n/en";
import { bucketItemMetaLine, formatActivityDuration } from "@/lib/trips/activityDuration";

const dictionary = (entries: Record<string, string>) => (key: string) => entries[key] ?? key;

describe("formatActivityDuration and the bucket-item meta line (Story 14.1 AC4)", () => {
  it("drops the minutes for whole hours and the hours under one, in both languages", () => {
    expect(formatActivityDuration(60, dictionary(de))).toBe("1 Std");
    expect(formatActivityDuration(45, dictionary(de))).toBe("45 Min");
    expect(formatActivityDuration(90, dictionary(de))).toBe("1 Std 30 Min");
    expect(formatActivityDuration(120, dictionary(en))).toBe("2 h");
    expect(formatActivityDuration(15, dictionary(en))).toBe("15 min");
    expect(formatActivityDuration(135, dictionary(en))).toBe("2 h 15 min");
  });

  it("joins duration and place with a middle dot, and shows the duration alone without a place", () => {
    expect(bucketItemMetaLine({ durationMinutes: 60, location: { label: "Gullfoss" } }, dictionary(de))).toBe("1 Std · Gullfoss");
    expect(bucketItemMetaLine({ durationMinutes: 60, location: null }, dictionary(de))).toBe("1 Std");
    expect(bucketItemMetaLine({ durationMinutes: 30, location: { label: "  " } }, dictionary(en))).toBe("30 min");
  });
});
