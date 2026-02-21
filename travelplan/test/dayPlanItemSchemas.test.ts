import { describe, expect, it } from "vitest";
import { dayPlanItemMutationSchema } from "@/lib/validation/dayPlanItemSchemas";

const sampleDoc = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
});

describe("dayPlanItemSchemas", () => {
  it("accepts a valid contentJson and optional linkUrl", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      contentJson: sampleDoc,
      linkUrl: "https://example.com/plan",
      location: {
        lat: 48.1372,
        lng: 11.5756,
        label: "Marienplatz",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty contentJson", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      contentJson: " ",
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid JSON contentJson", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      contentJson: "{not-json}",
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty TipTap documents", () => {
    const emptyDoc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
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
      contentJson: unsafeImageDoc,
      linkUrl: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid linkUrl", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      contentJson: sampleDoc,
      linkUrl: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-http linkUrl schemes", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      contentJson: sampleDoc,
      linkUrl: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);
  });

  it("rejects partial location coordinates", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
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
      contentJson: sampleDoc,
      linkUrl: null,
      location: {
        lat: 123,
        lng: 11.5756,
      },
    });

    expect(result.success).toBe(false);
  });
});
