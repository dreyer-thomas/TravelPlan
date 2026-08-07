import { describe, expect, it } from "vitest";
import {
  formatCentsAsAmount,
  normalizeDecimalInput,
  parseAmountToCents,
  parseDecimal,
} from "@/lib/trips/parseAmount";

/**
 * Story 6.27. The unit half of a bug that is mostly not a unit-level bug: a comma-decimal typed on a
 * German keyboard never reached this code at all while the fields were `type="number"`. These cases
 * pin the parser's contract; the dialog suites are what prove the comma now arrives.
 */
describe("parseAmountToCents", () => {
  it("reads a comma as the decimal separator", () => {
    expect(parseAmountToCents("12,50")).toBe(1250);
  });

  it("reads a period as the decimal separator", () => {
    expect(parseAmountToCents("12.50")).toBe(1250);
  });

  it("accepts a whole number", () => {
    expect(parseAmountToCents("12")).toBe(1200);
  });

  it("treats zero as an amount rather than as an absent one", () => {
    // `0` and `null` are two different answers and the callers branch on the difference.
    expect(parseAmountToCents("0")).toBe(0);
    expect(parseAmountToCents("0")).not.toBeNull();
  });

  it("resolves both separators by taking the last one as the decimal separator", () => {
    expect(parseAmountToCents("1.234,50")).toBe(123450);
    expect(parseAmountToCents("1,234.50")).toBe(123450);
  });

  it("strips whitespace, including the thin space a phone keypad can put in a thousands group", () => {
    // U+202F NARROW NO-BREAK SPACE — the one `de-DE` grouping and some keypads produce. It is inside
    // `\s`, which is the whole reason the strip is a regex rather than a `" "` split.
    expect(parseAmountToCents("1\u202f234,50")).toBe(123450);
    expect(parseAmountToCents(" 12,50 ")).toBe(1250);
    expect(parseAmountToCents("1 234 567,89")).toBe(123456789);
  });

  it("refuses whitespace that is not standing where a thousands separator would", () => {
    // The failure a blanket `/\s+/g` strip produces, and it is this story's own bug in another key:
    // `12 50` would weld into `1250` and save a hundred times the price with no error at all. A
    // stripped space has to be followed by exactly three digits, so these fall through to the gate
    // and are rejected where the user can see it.
    expect(parseAmountToCents("12 50")).toBeNull();
    expect(parseAmountToCents("1 2")).toBeNull();
    expect(parseAmountToCents("1 2345")).toBeNull();
    expect(parseDecimal("12 50")).toBeNull();
  });

  it("returns null for an empty or whitespace-only string", () => {
    // Not an error by itself: every cost field in this app reads this as "no price", which is why
    // callers must check the raw string for emptiness before reading `null` as invalid.
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("   ")).toBeNull();
  });

  it("returns null for text, a doubled separator, or a negative amount", () => {
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12,,5")).toBeNull();
    expect(parseAmountToCents("-1")).toBeNull();
  });

  it("returns null for more than two decimals, because cents are the API's unit", () => {
    expect(parseAmountToCents("12,555")).toBeNull();
    expect(parseAmountToCents("12.555")).toBeNull();
  });

  it("parses an amount above the stay ceiling rather than rejecting it here", () => {
    // The ceiling is `costRules`' judgement, not the parser's — the parser only says what the number
    // is, and the field is what decides it is too large.
    expect(parseAmountToCents("1000000.01")).toBe(100000001);
  });
});

describe("parseDecimal", () => {
  it("keeps a comma decimal at full value, which Number.parseFloat does not", () => {
    // The whole reason the distance field may not keep calling `Number.parseFloat` on a text input.
    expect(parseDecimal("12,5")).toBe(12.5);
    expect(Number.parseFloat("12,5")).toBe(12);
  });

  it("keeps more than two decimals and does not scale by 100", () => {
    // A distance is not money: no cent rounding, no ×100.
    expect(parseDecimal("12,555")).toBe(12.555);
    expect(parseDecimal("12.555")).toBe(12.555);
    expect(parseAmountToCents("12,555")).toBeNull();
  });

  it("handles periods, whole numbers, thousands separators and zero", () => {
    expect(parseDecimal("12.5")).toBe(12.5);
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal("1.234,5")).toBe(1234.5);
    expect(parseDecimal("1,234.5")).toBe(1234.5);
    expect(parseDecimal("1\u202f234,5")).toBe(1234.5);
    expect(parseDecimal("0")).toBe(0);
  });

  it("returns null for empty, text, a doubled separator and a negative", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("12,,5")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
  });
});

describe("normalizeDecimalInput", () => {
  it("hands back a dot-decimal string with the thousands separator removed", () => {
    expect(normalizeDecimalInput("1.234,50")).toBe("1234.50");
    expect(normalizeDecimalInput("1,234.50")).toBe("1234.50");
    expect(normalizeDecimalInput("12,50")).toBe("12.50");
    expect(normalizeDecimalInput("12.50")).toBe("12.50");
  });

  it("returns null only for an empty input, leaving the judging to its callers", () => {
    expect(normalizeDecimalInput("  ")).toBeNull();
    // Junk passes through: `parseAmountToCents` and `parseDecimal` apply different gates to it, and
    // that difference is the reason the normalisation is shared but the validation is not.
    expect(normalizeDecimalInput("abc")).toBe("abc");
    expect(normalizeDecimalInput("12,,5")).toBe("12.,5");
  });
});

describe("formatCentsAsAmount", () => {
  it("round-trips through parseAmountToCents", () => {
    expect(formatCentsAsAmount(1250)).toBe("12.50");
    expect(formatCentsAsAmount(0)).toBe("0.00");
    expect(parseAmountToCents(formatCentsAsAmount(123450))).toBe(123450);
  });
});
