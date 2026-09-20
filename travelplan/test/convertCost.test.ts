import { describe, expect, it } from "vitest";
import {
  convertEntryToCents,
  formatCostOriginal,
  formatExchangeRate,
  formatForeignAmount,
} from "@/lib/trips/convertCost";

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

describe("formatExchangeRate", () => {
  it("renders a ratio, not money - no currency symbol anywhere", () => {
    // The rate is units of foreign currency per one euro. Attaching a symbol would claim it is a
    // price in something, and there is no currency it could honestly wear.
    expect(formatExchangeRate(1.8563, "en")).toBe("1.8563");
    expect(formatExchangeRate(1.8563, "de")).toBe("1,8563");
  });

  it("keeps two digits as a floor so a round rate is not a bare 1,5", () => {
    expect(formatExchangeRate(1.5, "en")).toBe("1.50");
    expect(formatExchangeRate(1.5, "de")).toBe("1,50");
  });

  it("keeps five digits as a ceiling - the widest precision ECB publishes", () => {
    expect(formatExchangeRate(1.234567, "en")).toBe("1.23457");
    expect(formatExchangeRate(0.87543, "de")).toBe("0,87543");
  });

  it("resolves the locale through INTL_LOCALES rather than a de/en ternary", () => {
    // DW-281: grouping separators differ per locale, so a wrong tag shows up here.
    expect(formatExchangeRate(1234.5, "de")).toBe("1.234,50");
    expect(formatExchangeRate(1234.5, "en")).toBe("1,234.50");
  });
});

describe("formatCostOriginal", () => {
  const template = "{amount} at {rate}";

  it("renders the amount through formatForeignAmount and the rate beside it", () => {
    expect(
      formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: 1.8563 }, "en", template),
    ).toBe("NZ$200.00 at 1.8563");
    expect(
      formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: 1.8563 }, "de", "{amount} zu {rate}"),
      // `Intl` joins a German amount to its symbol with a NO-BREAK SPACE (U+00A0), not a plain one.
      // Spelling it as an escape keeps the assertion readable and keeps a future editor from
      // "fixing" an invisible character.
    ).toBe("200,00\u00A0NZ$ zu 1,8563");
  });

  it("renders a zero-exponent currency with no fraction digits", () => {
    // AC1: the first production caller of formatForeignAmount's non-EUR path. 5000 yen is never
    // 5.000,00 - a price that has never existed.
    const rendered = formatCostOriginal({ amountOriginal: 500000, currency: "JPY", rate: 172.5 }, "de", template);

    expect(rendered).toBe("5.000\u00A0¥ at 172,50");
    expect(rendered).not.toMatch(/5\.000,00/);
  });

  it("returns null when the amount is absent", () => {
    expect(formatCostOriginal({ currency: "NZD", rate: 1.8563 }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: null, currency: "NZD", rate: 1.8563 }, "en", template)).toBeNull();
    expect(
      formatCostOriginal({ amountOriginal: Number.NaN, currency: "NZD", rate: 1.8563 }, "en", template),
    ).toBeNull();
  });

  it("returns null when the currency is absent or empty", () => {
    expect(formatCostOriginal({ amountOriginal: 20000, rate: 1.8563 }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: 20000, currency: null, rate: 1.8563 }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: 20000, currency: "", rate: 1.8563 }, "en", template)).toBeNull();
  });

  it("returns null for a rate that is absent, zero, negative or not finite", () => {
    expect(formatCostOriginal({ amountOriginal: 20000, currency: "NZD" }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: null }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: 0 }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: -1.5 }, "en", template)).toBeNull();
    expect(formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: Number.NaN }, "en", template)).toBeNull();
    expect(
      formatCostOriginal({ amountOriginal: 20000, currency: "NZD", rate: Number.POSITIVE_INFINITY }, "en", template),
    ).toBeNull();
  });

  it("renders a zero amount rather than treating it as missing", () => {
    // A recorded 0 is a fact about the entry; only absence is an absent receipt.
    expect(formatCostOriginal({ amountOriginal: 0, currency: "USD", rate: 1.146 }, "en", template)).toBe(
      // 1.146 keeps three digits: two is the floor, five the ceiling, and neither pads to the top.
      "$0.00 at 1.146",
    );
  });
});
