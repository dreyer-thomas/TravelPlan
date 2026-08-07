/**
 * Parses what a user typed into a number. The inverse of `formatCost.ts` next door, which renders a
 * cent amount back out as a locale string.
 *
 * Story 6.27, and it exists because of a phone. Reported on 2026-08-05: editing an accommodation on a
 * German keyboard, typing `12,50` into the cost field, and the stay saving with no cost at all. The
 * field was `type="number"`, and HTML requires a `.` in a floating-point value - so the browser called
 * the comma `badInput`, handed React `""`, and "an empty cost means no price" swallowed it without a
 * word. The fix that matters is in the fields (`type="text"` + `inputMode="decimal"`, so the comma
 * arrives at all); this module is the other half - the one place that then knows what to do with it.
 *
 * **Both separators are accepted regardless of locale, always.** A German keyboard on an `en-US`
 * browser still sends a comma, so sniffing the locale to decide what is acceptable would re-create the
 * bug for exactly the user who reported it. Locale decides how a value is *rendered*, never what is
 * *accepted*.
 *
 * **When both separators appear, the last one is the decimal separator.** That single rule is what
 * makes `1.234,50` and `1,234.50` both parse to the same amount without asking anyone which country
 * they are in. It only settles the case where both are present: a lone separator is read as a decimal
 * point, so `1,000` is one, not a thousand. The money gate then rejects that shape anyway (three
 * decimals), which is why the ambiguity only reaches `parseDecimal`.
 */

import type { Language } from "@/i18n";

/**
 * Whitespace out, thousands separator out, decimal separator normalised to `.` - the shared step
 * before money and distance part ways. Returns the digits-and-one-dot form, or `null` for an empty
 * input. It does **not** judge: `"12,,5"` comes back as `"12.,5"` for the caller's own gate to reject,
 * because "how many decimals may this field have" is a question only the caller can answer.
 *
 * Only whitespace standing where a thousands separator would stand is removed - between a digit and a
 * group of exactly three. That is the case the strip exists for (`de-DE` groups with U+202F, and a
 * phone number row can produce one), and `\s` covers those characters. A blanket strip would also weld
 * `"12 50"` into `1250` and charge a hundred times the price without a word, which is this story's own
 * bug wearing a different key. Whatever whitespace is left survives into the caller's gate and is
 * rejected there, visibly.
 */
export const normalizeDecimalInput = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;

  const compact = value.replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = compact.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (lastComma !== -1) {
    normalized = compact.replace(",", ".");
  }

  return normalized;
};

/**
 * A money field's value in integer cents - the unit every API in this app takes - or `null` if it is
 * not a non-negative amount with at most two decimals.
 *
 * `null` covers two states the caller must keep apart: an empty box (legal on every cost field here,
 * it means "no price") and unparseable text (an error the user has to see). Check the raw string for
 * emptiness first; do not read `null` alone as "no cost", which is the 2026-08-05 bug written out.
 */
export const parseAmountToCents = (rawValue: string): number | null => {
  const normalized = normalizeDecimalInput(rawValue);
  if (normalized === null) return null;

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
};

/**
 * A plain non-negative decimal, for the values that are not money - today the travel segment's
 * distance in km.
 *
 * Deliberately **not** `parseAmountToCents`: that one caps at two decimals and multiplies by 100, and
 * a distance is neither. Whatever precision was typed survives. It is also not `Number.parseFloat` on
 * the raw string, which the distance field used while it was `type="number"` and could get away with:
 * `Number.parseFloat("12,5")` returns `12`, so on a text input that call would silently turn half a
 * kilometre into none.
 *
 * **`maxDecimals` is the caller's rule, never this helper's.** Omitted, the promise above still holds
 * exactly: the gate is today's `^\d+(\.\d+)?$` and every digit typed survives. Story 6.30 added the
 * option because of one number, measured on a German phone on 2026-08-07: a *lone* three-digit group
 * is read as a fraction in **both** spellings (`normalizeDecimalInput` only resolves the ambiguity
 * when both separators appear), so `parseDecimal("1,000")` and `parseDecimal("1.000")` each returned
 * `1`. A distance typed "one thousand kilometres" saved as one kilometre - a factor of 1000, with no
 * warning, in the story whose whole subject is silent numeric loss. The travel-segment dialog passes
 * `{ maxDecimals: 1 }`, which makes all three ambiguous forms refusable and turns that silent loss
 * into a visible question. The cap lives at the call site and not in the regex here, because this
 * helper's only consumer today is exactly what would make hard-coding it look harmless: the next,
 * non-distance caller would inherit a distance rule it never asked for.
 *
 * A non-finite `maxDecimals` reads as no cap at all, and anything below one as integers only; see the
 * comment in the body for why neither may be handed to a quantifier as it arrives.
 */
export const parseDecimal = (
  rawValue: string,
  options?: { maxDecimals?: number },
): number | null => {
  const normalized = normalizeDecimalInput(rawValue);
  if (normalized === null) return null;

  // A cap has to become a whole number of digits before it can become a quantifier, and the two ways
  // of getting there wrong fail in opposite directions - so both are normalised here rather than
  // trusted from the call site. Below one (a literal `0`, a negative, or a fraction like `0.5` that
  // floors to `0`) would build `\d{1,0}`, which no engine accepts: it throws a `SyntaxError` out of a
  // function whose entire contract is to answer `null` instead. Non-finite is the quieter one -
  // `Infinity` interpolates as *text*, and `\d{1,Infinity}` is a perfectly valid pattern matching
  // those literal characters, so the natural spelling of "no cap" would refuse every decimal and
  // accept only integers, silently. Non-finite therefore means unbounded, and below one means
  // integers only, which is what each was reaching for.
  const requested = options?.maxDecimals;
  const cap = requested === undefined || !Number.isFinite(requested) ? null : Math.floor(requested);
  const pattern = cap === null ? /^\d+(\.\d+)?$/ : cap < 1 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${cap}})?$`);

  if (!pattern.test(normalized)) {
    return null;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * Cents back into the plain string a text field holds - `1250` to `"12.50"` under `en`, `"12,50"`
 * under `de`.
 *
 * Not `formatCost`: this is an editable field's value, so it carries no currency symbol and no
 * thousands separator. It mirrors `formatCost(cents, language)` next door in *signature* only -
 * `formatCost` hands the whole job to `Intl.NumberFormat`, which is how it gets grouping and symbol
 * placement, and neither of those may appear in a box the user types back into. `language` is
 * **required** so that adding it named every existing call site instead of leaving one silently
 * English. Note what that does *not* buy: the separator here is a hand-written `=== "de"` ternary, so
 * a third dictionary would compile and test clean while rendering `120.50` beside its own locale's
 * placeholder. The fix at that point is `Intl` for the separator alone -
 * `new Intl.NumberFormat(tag).formatToParts(1.1)`, taking the `decimal` part and nothing else. It is
 * a different repair from the one `formatCost` will need, which is a `Language`-to-BCP-47 map instead
 * of its own `=== "de"` fallback to `en-US`.
 *
 * **What Story 6.30 retired.** This used to be dot-decimal on purpose, and the stated reason was that
 * an unedited round trip has to hand the string back to `parseAmountToCents`. That reason was sound
 * only while the parser was dot-only, and since Story 6.27 it is not - `parseAmountToCents("120,50")`
 * returns `12050` exactly as `"120.50"` does. What the old argument left behind was a German field
 * whose placeholder read `0,00` while its own value read `120.50`: the box contradicting its own hint,
 * spotted by the first German user to look at it after 6.27 landed on 2026-08-07.
 *
 * **Still no thousands separator, even though grouping would round-trip.**
 * `parseAmountToCents("1.234,50")` does return `123450`, so emitting `"1.234,50"` would be safe for
 * *this* field. It is refused anyway, because a box showing `1.234,50` teaches the habit the distance
 * field next door exists to refuse: a lone three-digit group like `1.000` is a fraction to
 * `normalizeDecimalInput`, and reading `1.000` as a thousand is what silently turned 1000 km into 1 km.
 * Grouping belongs in `formatCost`, which is read-only.
 */
export const formatCentsAsAmount = (value: number, language: Language) => {
  const plain = (value / 100).toFixed(2);
  return language === "de" ? plain.replace(".", ",") : plain;
};
