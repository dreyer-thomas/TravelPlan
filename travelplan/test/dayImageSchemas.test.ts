import { describe, expect, it } from "vitest";
import { dayImageUpdateSchema } from "@/lib/validation/dayImageSchemas";

describe("dayImageSchemas", () => {
  it("accepts a valid image url", () => {
    const result = dayImageUpdateSchema.safeParse({
      imageUrl: "https://example.com/images/day.webp",
      note: "Flight from FRA to SIN",
    });

    expect(result.success).toBe(true);
  });

  it("accepts internal uploads paths", () => {
    const result = dayImageUpdateSchema.safeParse({
      imageUrl: "/uploads/trips/trip-1/days/day-1/day.webp",
      note: "Flight from FRA to SIN",
    });

    expect(result.success).toBe(true);
  });

  it("accepts null to remove the image", () => {
    const result = dayImageUpdateSchema.safeParse({
      imageUrl: null,
      note: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid url values", () => {
    const result = dayImageUpdateSchema.safeParse({
      imageUrl: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects urls over 2000 chars", () => {
    const url = `https://example.com/${"a".repeat(2001)}`;
    const result = dayImageUpdateSchema.safeParse({
      imageUrl: url,
    });

    expect(result.success).toBe(false);
  });

  it("rejects note values over 280 chars", () => {
    const result = dayImageUpdateSchema.safeParse({
      imageUrl: null,
      note: "a".repeat(281),
    });

    expect(result.success).toBe(false);
  });
});
