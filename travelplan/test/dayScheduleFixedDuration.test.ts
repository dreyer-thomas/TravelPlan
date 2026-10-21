import { describe, expect, it } from "vitest";
import { fixedDurationOf } from "@/lib/repositories/dayScheduleTransaction";

describe("fixedDurationOf", () => {
  it("is the span when both times read and the end is later, else the stored duration", () => {
    expect(fixedDurationOf({ fromTime: "10:00", toTime: "11:30", durationMinutes: 15 })).toBe(90);
    expect(fixedDurationOf({ fromTime: "10:00", toTime: "09:00", durationMinutes: 15 })).toBe(15);
    expect(fixedDurationOf({ fromTime: null, toTime: "09:00", durationMinutes: 45 })).toBe(45);
  });
});
