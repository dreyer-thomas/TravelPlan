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
 */
export const parseDecimal = (rawValue: string): number | null => {
  const normalized = normalizeDecimalInput(rawValue);
  if (normalized === null) return null;

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * Cents back into the plain string a text field holds - `1250` to `"12.50"`.
 *
 * Not `formatCost`: this is an editable field's value, so it carries no currency symbol and no
 * thousands separator, and it stays dot-decimal because that is what an unedited round-trip must hand
 * back to `parseAmountToCents`. `formatCost` is for reading, this is for editing.
 */
export const formatCentsAsAmount = (value: number) => (value / 100).toFixed(2);
