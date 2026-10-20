import { afterEach, describe, expect, it } from "vitest";
import { formatLongDate } from "@/lib/trips/formatLongDate";
import { formatShortDate } from "@/lib/trips/formatShortDate";

describe("formatShortDate / formatLongDate (Story 7.15)", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("prints the short weekday with month/day", () => {
    expect(formatShortDate("2026-08-09T00:00:00.000Z", "en")).toBe("Sun, 8/9");
    expect(formatShortDate("2026-08-09T00:00:00.000Z", "de")).toBe("So., 9.8.");
  });

  it("prints the long weekday with the month written out", () => {
    expect(formatLongDate("2026-08-09T00:00:00.000Z", "en")).toBe("Sunday, August 9, 2026");
    expect(formatLongDate("2026-08-09T00:00:00.000Z", "de")).toBe("Sonntag, 9. August 2026");
    expect(formatLongDate("2026-08-10", "en")).toBe("Monday, August 10, 2026");
    expect(formatLongDate("2026-08-10", "de")).toBe("Montag, 10. August 2026");
  });

  it.each(["", "not-a-date"])("returns null for the malformed value %j", (value) => {
    expect(formatShortDate(value, "en")).toBeNull();
    expect(formatShortDate(value, "de")).toBeNull();
    expect(formatLongDate(value, "en")).toBeNull();
    expect(formatLongDate(value, "de")).toBeNull();
  });

  // A day is stored at midnight UTC; west of UTC, local formatting would show Saturday the 8th.
  it("keeps the UTC calendar day and weekday in a zone west of UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(formatShortDate("2026-08-09T00:00:00.000Z", "de")).toBe("So., 9.8.");
    expect(formatShortDate("2026-08-09T00:00:00.000Z", "en")).toBe("Sun, 8/9");
    expect(formatLongDate("2026-08-09T00:00:00.000Z", "de")).toBe("Sonntag, 9. August 2026");
    expect(formatLongDate("2026-08-09T00:00:00.000Z", "en")).toBe("Sunday, August 9, 2026");
  });
});
