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

  it("accepts a body that carries only a note", () => {
    // Story 8.4. The day-meta save sends only the field being edited: it used to resend
    // `imageUrl: day.imageUrl ?? null` out of local state, which under the new cleanup trigger unlinked
    // the day's current photo whenever that local value was stale. Omitting the key is how the client
    // says "leave the image alone", and the repository already skips the column when it is `undefined`.
    const result = dayImageUpdateSchema.safeParse({ note: "Ferry at 07:40" });

    expect(result.success).toBe(true);
    expect(result.data?.imageUrl).toBeUndefined();
  });

  it("rejects a body that asks for no change at all", () => {
    // The other side of making both fields optional (Story 8.4). `updateTripDayImageForUser` builds its
    // `SET` clauses from the fields that are present and skips the `UPDATE` when there are none, so `{}`
    // would answer `200` for a save that wrote nothing - which the dialog renders as "saved".
    expect(dayImageUpdateSchema.safeParse({}).success).toBe(false);
    // Same for a body whose only key is not one this endpoint knows: `note` is absent either way.
    expect(dayImageUpdateSchema.safeParse({ noteText: "Ferry at 07:40" }).success).toBe(false);
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
