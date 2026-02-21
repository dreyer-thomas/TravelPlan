import { describe, expect, it } from "vitest";
import { dayPlanItemMutationSchema } from "@/lib/validation/dayPlanItemSchemas";

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
      linkUrl: "https://example.com/plan",
      location: {
        lat: 48.1372,
        lng: 11.5756,
        label: "Marienplatz",
      },
    });

    expect(result.success).toBe(true);
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
});
