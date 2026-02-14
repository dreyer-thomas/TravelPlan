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

  it("rejects invalid linkUrl", () => {
    const result = dayPlanItemMutationSchema.safeParse({
      tripDayId: "day-id",
      contentJson: sampleDoc,
      linkUrl: "not-a-url",
    });

    expect(result.success).toBe(false);
  });
});
