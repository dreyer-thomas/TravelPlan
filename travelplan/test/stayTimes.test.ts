import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  resolveCheckOutTime,
  resolveStayTime,
} from "@/lib/trips/stayTimes";

/** Story 11.4 AC14. One shared default and one resolution rule for client and server. */
describe("stayTimes", () => {
  it("holds the defaults the timeline has always drawn with", () => {
    expect(DEFAULT_CHECK_OUT_TIME).toBe("10:00");
    expect(DEFAULT_CHECK_IN_TIME).toBe("16:00");
  });

  it("falls back for null, undefined, empty and whitespace, and keeps a real value", () => {
    expect(resolveStayTime(null, "x")).toBe("x");
    expect(resolveStayTime(undefined, "x")).toBe("x");
    expect(resolveStayTime("", "x")).toBe("x");
    expect(resolveStayTime("  ", "x")).toBe("x");
    expect(resolveStayTime("09:30", "x")).toBe("09:30");
  });

  it("resolves a check-out against the shared default", () => {
    expect(resolveCheckOutTime(null)).toBe("10:00");
    expect(resolveCheckOutTime(" ")).toBe("10:00");
    expect(resolveCheckOutTime("09:00")).toBe("09:00");
  });
});
