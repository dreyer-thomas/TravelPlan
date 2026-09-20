import { describe, expect, it } from "vitest";
import { convertEntryToCents, formatForeignAmount } from "@/lib/trips/convertCost";

describe("convertEntryToCents", () => {
  /**
   * AC7's hand-checked figure. A round-trip test (convert, then unconvert) passes with the direction
   * reversed, so the absolute number is the only assertion that actually pins the direction: ECB
   * publishes units of foreign currency per one euro, so 100.00 USD at 1.1460 is a *division*.
   * 10000 / 1.1460 = 8726.003..., which rounds to 8726 cents = 87,26 EUR.
   *
   * Multiplying instead would give 11460 cents, which this assertion refuses.
   */
  it("divides by the published rate (100,00 USD @ 1.1460 -> 8726 cents)", () => {
    const result = convertEntryToCents({ costOriginalAmount: 10000, payments: [], rate: 1.146 });

    expect(result.costCents).toBe(8726);
  });

  it("sweeps a positive residual into the largest payment", () => {
    const result = convertEntryToCents({
      costOriginalAmount: 10000,
      payments: [{ amountOriginal: 3333 }, { amountOriginal: 3333 }, { amountOriginal: 3334 }],
      rate: 1.146,
    });

    expect(result.costCents).toBe(8726);
    // Naive per-row rounding gives 2908 / 2908 / 2909 = 8725; the missing cent lands on row 3.
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([2908, 2908, 2910]);
    expect(result.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(result.costCents);
  });

  it("sweeps a negative residual, breaking a tie toward the last row", () => {
    const result = convertEntryToCents({
      costOriginalAmount: 10000,
      payments: [{ amountOriginal: 5000 }, { amountOriginal: 5000 }],
      rate: 3,
    });

    expect(result.costCents).toBe(3333);
    // 1667 + 1667 = 3334, one cent too many. The originals tie, so the *last* row gives it back.
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([1667, 1666]);
    expect(result.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(3333);
  });

  it("carries each payment's original amount through untouched", () => {
    const result = convertEntryToCents({
      costOriginalAmount: 10000,
      payments: [{ amountOriginal: 3333 }, { amountOriginal: 6667 }],
      rate: 1.146,
    });

    expect(result.payments.map((payment) => payment.amountOriginal)).toEqual([3333, 6667]);
  });

  it("stores hundredths regardless of the currency's ISO 4217 exponent", () => {
    // AC8: JPY has a zero exponent, but 5000 yen is still stored as 500000 hundredths.
    const result = convertEntryToCents({ costOriginalAmount: 500000, payments: [], rate: 180.94 });

    expect(result.costCents).toBe(2763);
  });

  it("returns a zero cost for a zero amount without dividing anything into NaN", () => {
    const result = convertEntryToCents({ costOriginalAmount: 0, payments: [{ amountOriginal: 0 }], rate: 1.146 });

    expect(result.costCents).toBe(0);
    expect(result.payments[0].amountCents).toBe(0);
  });

  it("never allocates a negative payment amount", () => {
    // A single tiny row absorbing a negative residual is the shape that could go below zero.
    const result = convertEntryToCents({
      costOriginalAmount: 100,
      payments: [{ amountOriginal: 100 }],
      rate: 3,
    });

    expect(result.payments.every((payment) => payment.amountCents >= 0)).toBe(true);
    expect(result.payments[0].amountCents).toBe(result.costCents);
  });

  it("refuses a non-positive rate rather than emitting Infinity", () => {
    expect(() => convertEntryToCents({ costOriginalAmount: 10000, payments: [], rate: 0 })).toThrow();
    expect(() => convertEntryToCents({ costOriginalAmount: 10000, payments: [], rate: -1 })).toThrow();
  });
});

describe("formatForeignAmount", () => {
  it("renders a zero-exponent currency with no fraction digits", () => {
    // AC12: 500000 hundredths of JPY is 5000 yen, and it must never render as 5.000,00.
    expect(formatForeignAmount(500000, "JPY", "de")).not.toMatch(/,00/);
    expect(formatForeignAmount(500000, "JPY", "de")).toContain("5.000");
    expect(formatForeignAmount(500000, "JPY", "en")).toContain("5,000");
  });

  it("renders a two-exponent currency with its two fraction digits", () => {
    expect(formatForeignAmount(10000, "USD", "en")).toContain("100.00");
    expect(formatForeignAmount(10000, "USD", "de")).toContain("100,00");
  });

  it("resolves the locale through INTL_LOCALES rather than a de/en ternary", () => {
    // Grouping separators differ per locale; a wrong tag shows up here.
    expect(formatForeignAmount(123456789, "USD", "de")).toContain("1.234.567,89");
    expect(formatForeignAmount(123456789, "USD", "en")).toContain("1,234,567.89");
  });

  it("falls back to the bare number when the currency code is not one Intl knows", () => {
    expect(formatForeignAmount(10000, "ZZZ", "en")).toContain("100");
  });
});
