import { describe, expect, it } from "vitest";
import { accommodationMutationSchema } from "@/lib/validation/accommodationSchemas";
import { isSafeLink } from "@/components/features/trips/TripDayPlanItemContent";

describe("accommodationSchemas", () => {
  it("accepts a valid payment date", () => {
    const result = accommodationMutationSchema.safeParse({
      tripDayId: "day-1",
      name: "Harbor Hotel",
      status: "planned",
      costCents: 10000,
      payments: [{ amountCents: 10000, dueDate: "2026-11-01" }],
      link: null,
      notes: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects impossible payment dates", () => {
    const result = accommodationMutationSchema.safeParse({
      tripDayId: "day-1",
      name: "Harbor Hotel",
      status: "planned",
      costCents: 10000,
      payments: [{ amountCents: 10000, dueDate: "2026-02-31" }],
      link: null,
      notes: null,
    });

    expect(result.success).toBe(false);
  });

  /**
   * Story 6.29. Measured against the unmodified schema, all four of these were ACCEPTED: `.url()`
   * asks whether `new URL()` parses, not which scheme it parsed. `ftp:` is in the list because it is
   * the case that proves the guard is an allowlist of two schemes rather than a denylist of the two
   * attacks.
   */
  const parseWithLink = (link: string) =>
    accommodationMutationSchema.safeParse({
      tripDayId: "day-1",
      name: "Harbor Hotel",
      status: "planned",
      costCents: null,
      payments: [],
      link,
      notes: null,
    });

  it.each(["https://booking.example/x", "http://hotel.example/x"])("accepts the http(s) link %s", (link) => {
    expect(parseWithLink(link).success).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<h1>x", "ftp://x.example/a"])(
    "rejects the non-http(s) link %s",
    (link) => {
      expect(parseWithLink(link).success).toBe(false);
    },
  );

  /**
   * The gate must not accept anything the render guard then drops, or a link saves without complaint
   * and silently fails to appear on all three surfaces. For a special scheme the WHATWG parser forgives
   * a missing slash pair, so `new URL("https:booking.example/x")` yields `https://booking.example/x`
   * and the parse-only rule accepted it while `isSafeLink`'s prefix test refused it — on the trip
   * overview row that was a value which used to render as a working anchor.
   */
  it.each(["https:booking.example/x", "https:/booking.example/x", "http:hotel.example/x"])(
    "rejects the slash-less shorthand %s, which the render guard cannot render",
    (link) => {
      expect(parseWithLink(link).success).toBe(false);
    },
  );

  it.each([
    "https://booking.example/x",
    "http://hotel.example/x",
    "HTTPS://Booking.Example/x",
    "  https://booking.example/x  ",
    "https:booking.example/x",
    "javascript:alert(1)",
    "data:text/html,<h1>x",
    "ftp://x.example/a",
    "not a url",
  ])("keeps every stored link renderable: %s", (link) => {
    // The invariant itself, stated once: gate ⟹ guard. `isSafeLink` is the render-side predicate all
    // three sites call, imported here from the module that owns it rather than restated.
    if (parseWithLink(link).success) {
      expect(isSafeLink(link)).toBe(true);
    }
  });
});
