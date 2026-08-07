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

/**
 * Story 6.30 Part 1. Ruled by Tommy on 2026-08-07 after the 6.27 operator pass: the distance field caps
 * at one decimal, and it does so by passing the cap in rather than by narrowing the helper. The rows
 * here are the story's I/O matrix — the four refusals, the five acceptances, and the one call that
 * proves the default is still unbounded.
 */
describe("parseDecimal with maxDecimals", () => {
  it("refuses a lone three-digit group, the silent factor of 1000 this option exists for", () => {
    // The measured bug: `normalizeDecimalInput` only resolves the separator ambiguity when *both*
    // separators appear, so a lone group is a fraction in either spelling and "one thousand
    // kilometres" saved as one kilometre with no warning at all.
    expect(parseDecimal("1,000", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("1.000", { maxDecimals: 1 })).toBeNull();
  });

  it("refuses more than one decimal", () => {
    // Story 6.27 required `12,555` to parse (see `parseDecimal` above, which still pins the helper's
    // own behaviour). That expectation is deliberately reversed *for the distance caller* here, and
    // the reversal is the spec amendment rather than a dev detail.
    expect(parseDecimal("12,555", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("12.555", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("60,12345", { maxDecimals: 1 })).toBeNull();
  });

  it("accepts one decimal in either spelling, a whole number, and a grouped value", () => {
    expect(parseDecimal("60,5", { maxDecimals: 1 })).toBe(60.5);
    expect(parseDecimal("60.5", { maxDecimals: 1 })).toBe(60.5);
    expect(parseDecimal("12000", { maxDecimals: 1 })).toBe(12000);
    // Two separators were never ambiguous, which is why this story is narrow rather than systemic.
    expect(parseDecimal("1.234,5", { maxDecimals: 1 })).toBe(1234.5);
    expect(parseDecimal("1,234.5", { maxDecimals: 1 })).toBe(1234.5);
    // A whitespace thousands group still collapses before the cap is applied.
    expect(parseDecimal("1 000", { maxDecimals: 1 })).toBe(1000);
  });

  it("leaves the default unbounded, so the helper's own promise still holds", () => {
    // AC3. The cap is the distance field's rule. A future non-distance caller that passes nothing gets
    // exactly what this helper documented before Story 6.30 touched it.
    expect(parseDecimal("60,12345")).toBe(60.12345);
    expect(parseDecimal("12,555")).toBe(12.555);
  });

  it("reads maxDecimals: 0 as integers-only rather than building an invalid quantifier", () => {
    // `\d{1,0}` is not a quantifier any engine accepts, so zero has to take a different branch.
    expect(parseDecimal("12", { maxDecimals: 0 })).toBe(12);
    expect(parseDecimal("12.5", { maxDecimals: 0 })).toBeNull();
    expect(parseDecimal("12,5", { maxDecimals: 0 })).toBeNull();
  });

  /**
   * The cap is a number from a caller, so the two ways of spelling it wrong have to be answered here
   * rather than in the quantifier. They fail in opposite directions and neither is caught by a `<= 0`
   * check: a fraction floors into `\d{1,0}` and *throws* `SyntaxError` out of a function contracted to
   * answer `null`, while `Infinity` — the natural spelling of "no cap" — interpolates as literal text,
   * making `\d{1,Infinity}` a valid pattern that quietly accepts integers and refuses every decimal.
   */
  it("answers a fractional cap as integers-only instead of throwing", () => {
    expect(() => parseDecimal("12.5", { maxDecimals: 0.5 })).not.toThrow();
    expect(parseDecimal("12.5", { maxDecimals: 0.5 })).toBeNull();
    expect(parseDecimal("12", { maxDecimals: 0.5 })).toBe(12);
    expect(parseDecimal("12.5", { maxDecimals: -1 })).toBeNull();
  });

  it("reads a non-finite cap as no cap, not as integers-only", () => {
    expect(parseDecimal("60,12345", { maxDecimals: Number.POSITIVE_INFINITY })).toBe(60.12345);
    expect(parseDecimal("60,12345", { maxDecimals: Number.NaN })).toBe(60.12345);
    // And a cap of 1.9 still means one decimal — flooring, not rounding.
    expect(parseDecimal("60,55", { maxDecimals: 1.9 })).toBeNull();
    expect(parseDecimal("60,5", { maxDecimals: 1.9 })).toBe(60.5);
  });

  it("still refuses everything the uncapped gate refuses", () => {
    expect(parseDecimal("", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("abc", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("12,,5", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("-1", { maxDecimals: 1 })).toBeNull();
    expect(parseDecimal("12 50", { maxDecimals: 1 })).toBeNull();
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
    // Story 6.30: `language` is required, so these three gained an argument rather than changing shape.
    expect(formatCentsAsAmount(1250, "en")).toBe("12.50");
    expect(formatCentsAsAmount(0, "en")).toBe("0.00");
    expect(parseAmountToCents(formatCentsAsAmount(123450, "en"))).toBe(123450);
  });

  it("writes the separator the account language would type", () => {
    // AC5. Under German the placeholder said `0,00` while the value beside it said `120.50` — the box
    // contradicting its own hint, and the first thing a German user noticed after 6.27 landed.
    expect(formatCentsAsAmount(12050, "de")).toBe("120,50");
    expect(formatCentsAsAmount(12050, "en")).toBe("120.50");
    expect(formatCentsAsAmount(0, "de")).toBe("0,00");
  });

  it("never emits a thousands separator, in either language", () => {
    // `parseAmountToCents("1.234,50")` does return 123450, so grouping would round-trip — it is refused
    // anyway, because a box showing `1.234,50` teaches the habit the distance cap above exists to
    // refuse. Grouping belongs to `formatCost`, which is read-only.
    expect(formatCentsAsAmount(123450, "de")).toBe("1234,50");
    expect(formatCentsAsAmount(123450, "en")).toBe("1234.50");
    expect(formatCentsAsAmount(123456789, "de")).toBe("1234567,89");
  });

  it("round-trips exactly in both languages, as a property over a spread of cent values", () => {
    // AC6, and the one that keeps Part 2 from becoming a data bug: an open-and-save with no edit must
    // change nothing, whichever separator the field was seeded with.
    const cents = [0, 1, 9, 10, 99, 100, 250, 1250, 6000, 6050, 12050, 99999, 123450, 100000001];
    for (const language of ["en", "de"] as const) {
      for (const value of cents) {
        expect(parseAmountToCents(formatCentsAsAmount(value, language))).toBe(value);
      }
    }
  });
});
