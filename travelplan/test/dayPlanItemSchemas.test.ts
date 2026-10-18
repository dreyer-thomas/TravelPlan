import { describe, expect, it } from "vitest";
import {
  dayActivityTransferSchema,
  dayPlanItemMutationSchema,
  dayPlanItemUpdateSchema,
} from "@/lib/validation/dayPlanItemSchemas";

const sampleDoc = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
});

describe("dayPlanItemSchemas", () => {
  it("accepts a valid title/contentJson and optional linkUrl", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Museum visit",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      costCents: 1200,
      payments: [{ amountCents: 1200, dueDate: "2026-11-01" }],
      linkUrl: "https://example.com/plan",
      location: {
        lat: 48.1372,
        lng: 11.5756,
        label: "Marienplatz",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects impossible payment dates", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Museum visit",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      costCents: 1200,
      payments: [{ amountCents: 1200, dueDate: "2026-02-31" }],
      linkUrl: "https://example.com/plan",
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: " ",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("accepts title with 120 characters and rejects 121 characters", () => {
    const maxTitle = "a".repeat(120);
    const overLimitTitle = "a".repeat(121);

    const atLimit = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: maxTitle,
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    const overLimit = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: overLimitTitle,
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(atLimit.success).toBe(true);
    expect(overLimit.success).toBe(false);
  });

  it("rejects empty contentJson", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: " ",
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid JSON contentJson", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: "{not-json}",
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty TipTap documents", () => {
    const emptyDoc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: emptyDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("accepts TipTap documents with image nodes even when text is absent", () => {
    const imageOnlyDoc = JSON.stringify({
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://images.example.com/plan.webp", alt: "Plan image" } }],
    });

    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Image only",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: imageOnlyDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects TipTap documents with unsafe image URLs", () => {
    const unsafeImageDoc = JSON.stringify({
      type: "doc",
      content: [{ type: "image", attrs: { src: "javascript:alert(1)", alt: "Bad image" } }],
    });

    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Unsafe image",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: unsafeImageDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid linkUrl", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-http linkUrl schemes", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);
  });

  it("rejects partial location coordinates", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: null,
      location: {
        lat: 48.1372,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects out-of-range location coordinates", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: null,
      location: {
        lat: 123,
        lng: 11.5756,
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts null costCents", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      costCents: null,
      linkUrl: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects negative costCents", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "11:00",
      contentJson: sampleDoc,
      costCents: -1,
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing fromTime and toTime", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("no longer carries a bucket-list id (Story 14.1: scheduling an idea is its own route)", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:00",
      toTime: "10:00",
      contentJson: sampleDoc,
      linkUrl: null,
      bucketListItemId: "bucket-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("bucketListItemId");
  });

  it("rejects invalid time formats", () => {
    const invalidFrom = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "9:7",
      toTime: "11:00",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    const invalidTo = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "24:00",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(invalidFrom.success).toBe(false);
    expect(invalidTo.success).toBe(false);
  });

  it("accepts HH:mm:ss values and normalizes to HH:mm", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30:00",
      toTime: "11:00:59",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromTime).toBe("09:30");
      expect(result.data.toTime).toBe("11:00");
    }
  });

  it("accepts HH:mm:ss.SSS values and normalizes to HH:mm", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "12:30:00.000",
      toTime: "13:30:59.999",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromTime).toBe("12:30");
      expect(result.data.toTime).toBe("13:30");
    }
  });

  it("rejects time ranges where toTime is not later than fromTime", () => {
    const equalTimes = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "09:30",
      toTime: "09:30",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    const earlierEnd = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      title: "Plan",
      fromTime: "10:00",
      toTime: "09:59",
      contentJson: sampleDoc,
      linkUrl: null,
    });

    expect(equalTimes.success).toBe(false);
    expect(earlierEnd.success).toBe(false);
  });

  it("accepts a valid move transfer payload", () => {
    const result = dayActivityTransferSchema.safeParse({
      operation: "move",
      sourceTripDayId: "day-1",
      targetTripDayId: "day-2",
    });

    expect(result.success).toBe(true);
  });

  it("rejects same-day transfer payloads", () => {
    const result = dayActivityTransferSchema.safeParse({
      operation: "swap",
      sourceTripDayId: "day-1",
      targetTripDayId: "day-1",
    });

    expect(result.success).toBe(false);
  });

  it("accepts explicit overwrite confirmation for move payloads", () => {
    const result = dayActivityTransferSchema.safeParse({
      operation: "move",
      sourceTripDayId: "day-1",
      targetTripDayId: "day-2",
      confirmOverwrite: true,
    });

    expect(result.success).toBe(true);
  });

  /** Story 10.1. The same rule as the stay schema's, checked against the activity's own machinery. */
  describe("foreign-currency metadata", () => {
    const foreign = (overrides: Record<string, unknown> = {}) =>
      dayPlanItemMutationSchema.safeParse({
        tripDayId: "day-id",
        title: "Sky Tower",
        fromTime: "09:30",
        toTime: "11:00",
        contentJson: sampleDoc,
        costCents: 2763,
        costOriginalAmount: 500000,
        costCurrency: "JPY",
        costRate: 180.94,
        costRateDate: "2026-09-18",
        payments: [{ amountCents: 2763, dueDate: "2026-11-01", amountOriginal: 500000 }],
        ...overrides,
      });

    it("accepts a complete foreign-currency entry", () => {
      expect(foreign().success).toBe(true);
    });

    it("rejects partial metadata", () => {
      expect(foreign({ costRate: null }).success).toBe(false);
      expect(foreign({ costCurrency: null }).success).toBe(false);
    });

    it("rejects EUR as a stored currency", () => {
      expect(foreign({ costCurrency: "EUR" }).success).toBe(false);
    });

    it("rejects a payment row missing its original amount", () => {
      expect(foreign({ payments: [{ amountCents: 2763, dueDate: "2026-11-01" }] }).success).toBe(false);
    });

    it("rejects originals that do not add up to the original cost", () => {
      expect(
        foreign({
          payments: [
            { amountCents: 1381, dueDate: "2026-11-01", amountOriginal: 250000 },
            { amountCents: 1382, dueDate: "2026-11-02", amountOriginal: 240000 },
          ],
        }).success,
      ).toBe(false);
    });

    it("rejects metadata on an entry with no cost", () => {
      expect(foreign({ costCents: null, payments: [] }).success).toBe(false);
    });

    it("still accepts a plain EUR payload", () => {
      const result = dayPlanItemMutationSchema.safeParse({
        tripDayId: "day-id",
        title: "Museum visit",
        fromTime: "09:30",
        toTime: "11:00",
        contentJson: sampleDoc,
        costCents: 1200,
        payments: [{ amountCents: 1200, dueDate: "2026-11-01" }],
      });

      expect(result.success).toBe(true);
    });

    it("still reports a time-order fault alongside the currency rule", () => {
      const result = foreign({ fromTime: "11:00", toTime: "09:30" });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === "toTime")).toBe(true);
      }
    });
  });
});

describe("dayPlanItemMutationSchema schedule fields (Story 13.1 AC8, AC9)", () => {
  const base = { tripDayId: "day-id", title: "Museum", contentJson: sampleDoc };
  const issues = (payload: Record<string, unknown>) => {
    const result = dayPlanItemMutationSchema.safeParse({ ...base, ...payload });
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  };

  it("treats a payload without a mode as FIXED with both times required (§14)", () => {
    expect(issues({ fromTime: "09:00", toTime: "10:00" })).toEqual([]);
    expect(issues({ fromTime: "09:00" })).toEqual(["toTime"]);
    expect(issues({ toTime: "10:00" })).toEqual(["fromTime"]);
    expect(issues({ fromTime: "10:00", toTime: "09:00" })).toEqual(["toTime"]);
    // A duration alone does not make an old-shape payload valid.
    expect(issues({ fromTime: "09:00", durationMinutes: 60 })).toEqual(["toTime"]);
  });

  it("accepts FLEXIBLE with a duration, with none (15 by default), and ignores any times", () => {
    expect(issues({ scheduleMode: "FLEXIBLE", durationMinutes: 60 })).toEqual([]);
    expect(issues({ scheduleMode: "FLEXIBLE" })).toEqual([]);
    expect(issues({ scheduleMode: "FLEXIBLE", durationMinutes: 30, fromTime: "10:00", toTime: "09:00" })).toEqual([]);
  });

  it("refuses a FLEXIBLE duration under 5 minutes or past a whole day", () => {
    expect(issues({ scheduleMode: "FLEXIBLE", durationMinutes: 4 })).toEqual(["durationMinutes"]);
    expect(issues({ scheduleMode: "FLEXIBLE", durationMinutes: 5 })).toEqual([]);
    expect(issues({ scheduleMode: "FLEXIBLE", durationMinutes: 1440 })).toEqual(["durationMinutes"]);
    expect(issues({ scheduleMode: "FLEXIBLE", durationMinutes: 12.5 })).toEqual(["durationMinutes"]);
  });

  it("accepts FIXED as start + end or start + duration, and requires one of them", () => {
    expect(issues({ scheduleMode: "FIXED", fromTime: "09:00", toTime: "10:00" })).toEqual([]);
    expect(issues({ scheduleMode: "FIXED", fromTime: "09:00", durationMinutes: 90 })).toEqual([]);
    expect(issues({ scheduleMode: "FIXED", fromTime: "09:00" })).toEqual(["toTime"]);
    expect(issues({ scheduleMode: "FIXED", durationMinutes: 90 })).toEqual(["fromTime"]);
  });

  it("checks the FIXED end form on toTime and the duration form on durationMinutes", () => {
    expect(issues({ scheduleMode: "FIXED", fromTime: "09:00", toTime: "09:00" })).toEqual(["toTime"]);
    expect(issues({ scheduleMode: "FIXED", fromTime: "09:00", durationMinutes: 3 })).toEqual(["durationMinutes"]);
    expect(issues({ scheduleMode: "FIXED", fromTime: "23:00", durationMinutes: 59 })).toEqual([]);
    expect(issues({ scheduleMode: "FIXED", fromTime: "23:00", durationMinutes: 60 })).toEqual(["durationMinutes"]);
  });

  it("lets toTime win when a FIXED payload sends both", () => {
    // The duration would end past midnight; the end time is what counts.
    expect(issues({ scheduleMode: "FIXED", fromTime: "23:00", toTime: "23:30", durationMinutes: 120 })).toEqual([]);
  });
});

describe("dayPlanItemMutationSchema afterItemId (Story 13.3 AC3)", () => {
  const base = { tripDayId: "day-id", title: "Walk", contentJson: sampleDoc };
  const afterItemIdIssues = (result: ReturnType<typeof dayPlanItemMutationSchema.safeParse>) =>
    result.success ? [] : result.error.issues.filter((issue) => issue.path[0] === "afterItemId");

  it("accepts it on a FLEXIBLE create, and null or absent anywhere", () => {
    expect(dayPlanItemMutationSchema.safeParse({ ...base, scheduleMode: "FLEXIBLE", durationMinutes: 60, afterItemId: "item-1" }).success).toBe(true);
    expect(dayPlanItemMutationSchema.safeParse({ ...base, scheduleMode: "FLEXIBLE", afterItemId: null }).success).toBe(true);
    expect(
      dayPlanItemMutationSchema.safeParse({ ...base, scheduleMode: "FIXED", fromTime: "09:00", toTime: "10:00", afterItemId: null }).success,
    ).toBe(true);
  });

  it("refuses it on a FIXED create and on one without a mode (= FIXED)", () => {
    const fixed = dayPlanItemMutationSchema.safeParse({ ...base, scheduleMode: "FIXED", fromTime: "09:00", toTime: "10:00", afterItemId: "item-1" });
    expect(fixed.success).toBe(false);
    expect(afterItemIdIssues(fixed)).toHaveLength(1);
    const legacy = dayPlanItemMutationSchema.safeParse({ ...base, fromTime: "09:00", toTime: "10:00", afterItemId: "item-1" });
    expect(legacy.success).toBe(false);
    expect(afterItemIdIssues(legacy)).toHaveLength(1);
  });

  it("refuses an empty or blank id", () => {
    expect(dayPlanItemMutationSchema.safeParse({ ...base, scheduleMode: "FLEXIBLE", afterItemId: "" }).success).toBe(false);
    expect(dayPlanItemMutationSchema.safeParse({ ...base, scheduleMode: "FLEXIBLE", afterItemId: "  " }).success).toBe(false);
  });

  it("is refused on an edit, which keeps its place", () => {
    const edit = { ...base, itemId: "item-2", scheduleMode: "FLEXIBLE", durationMinutes: 60 };
    expect(dayPlanItemUpdateSchema.safeParse(edit).success).toBe(true);
    const result = dayPlanItemUpdateSchema.safeParse({ ...edit, afterItemId: "item-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "afterItemId")).toBe(true);
  });
});
