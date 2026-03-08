import { describe, expect, it } from "vitest";
import { accommodationMutationSchema } from "@/lib/validation/accommodationSchemas";

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
});
