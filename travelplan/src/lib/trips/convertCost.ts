/**
 * Turning a price typed in a foreign currency into the integer euro cents every API in this app
 * stores, and rendering a foreign amount back out for display.
 *
 * Pure and dependency-free by design: the dialogs call it, the tests call it, and nothing here
 * reaches for `fetch`, Prisma or React.
 *
 * The whole module exists to satisfy one invariant that is enforced as *exact integer equality* in
 * three separate server schemas (`accommodationSchemas.ts`, `dayPlanItemSchemas.ts`,
 * `tripImportSchemas.ts`):
 *
 *     sum(payments.amountCents) === costCents
 *
 * Two independently rounded conversions can miss each other by a cent, and a save that misses is
 * refused - or worse, saves locally and fails on restore. So there is exactly **one** rate per
 * entry, applied in a single pass to the cost and to every payment row, with the leftover cent swept
 * into one row rather than left to chance.
 */

import { formatMessage, INTL_LOCALES, type Language } from "@/i18n";

export type ConvertiblePayment = {
  /** Hundredths of the entered currency, as typed. See `toCents` for why this is not minor units. */
  amountOriginal: number;
};

export type ConvertedPayment = {
  amountCents: number;
  amountOriginal: number;
};

export type ConvertedEntry = {
  costCents: number;
  payments: ConvertedPayment[];
};

/**
 * ECB publishes **units of foreign currency per one euro** - `USD 1.1460` means one euro buys 1.1460
 * dollars - so going from a foreign amount to euro is a division, and the rate is stored exactly as
 * published, un-inverted, so the stored number can be checked against ECB's own page.
 *
 * Getting this backwards is the one error in this story that produces plausible-looking numbers
 * rather than an exception, which is why `test/convertCost.test.ts` pins an absolute hand-checked
 * figure instead of a round trip.
 */
const toCents = (amountOriginal: number, rate: number) => Math.round(amountOriginal / rate);

export const convertEntryToCents = ({
  costOriginalAmount,
  payments,
  rate,
}: {
  costOriginalAmount: number;
  payments: ConvertiblePayment[];
  rate: number;
}): ConvertedEntry => {
  if (!Number.isFinite(rate) || rate <= 0) {
    // Not a caller mistake to paper over: a zero or negative rate divides to Infinity or flips the
    // sign of a price. The service already drops such rows, so reaching here means a caller invented
    // one, and a thrown error is far cheaper than a stored Infinity.
    throw new Error("Exchange rate must be a finite positive number");
  }

  const costCents = toCents(costOriginalAmount, rate);

  if (payments.length === 0) {
    return { costCents, payments: [] };
  }

  const converted = payments.map((payment) => ({
    amountCents: toCents(payment.amountOriginal, rate),
    amountOriginal: payment.amountOriginal,
  }));

  /*
    The residual is **signed**. Rounding each row independently can land above or below the cost:
    100,00 USD split 33,33/33,33/33,34 converts a cent short (+1), while 100,00 at a rate of 3 split
    50,00/50,00 converts a cent long (-1). Code that only handles the positive case is wrong, and the
    negative case is the one that is easy to never see in a hand test.
  */
  const residual = costCents - converted.reduce((sum, payment) => sum + payment.amountCents, 0);

  if (residual !== 0) {
    /*
      The largest typed amount absorbs it, ties broken toward the **last** such row. Largest, because
      one cent is proportionally least visible against the biggest figure; last, because a rule has to
      name a winner or two equal rows make the result depend on iteration order.
    */
    let targetIndex = 0;
    for (let index = 1; index < converted.length; index += 1) {
      if (converted[index].amountOriginal >= converted[targetIndex].amountOriginal) {
        targetIndex = index;
      }
    }
    converted[targetIndex].amountCents += residual;
  }

  /*
    The guard is here rather than in a test because the caller is about to send this to a server that
    enforces the same equality and would answer with a validation error naming numbers the user never
    typed. A negative row is likewise unrepresentable downstream (`amountCents` is a non-negative int
    in the mutation schemas); it needs a rate and split pathological enough that the residual exceeds
    the largest converted row, which the split rule makes unreachable - but "unreachable" is exactly
    what an assertion is for.
  */
  const total = converted.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (total !== costCents || converted.some((payment) => payment.amountCents < 0)) {
    throw new Error("Converted payments do not reconcile with the converted cost");
  }

  return { costCents, payments: converted };
};

/**
 * A foreign amount rendered for display, in the currency's **own** default fraction digits.
 *
 * The absent `minimumFractionDigits` / `maximumFractionDigits` is the entire point. `formatCost` and
 * `formatCentsAsAmount` next door both pin two decimals, which is right for the euro field they were
 * written for and wrong here: JPY has a zero exponent, so 5000 yen must render `5.000 ¥`, never
 * `5.000,00 ¥` - a price that never existed. Letting `Intl` pick from the currency code is what makes
 * that automatic for all twenty-nine codes instead of shipping an exponent table.
 *
 * Note the asymmetry with storage, which is deliberate: `amountOriginal` is always hundredths (AC8),
 * so the division by 100 happens here regardless of what the currency's real minor unit is.
 */
export const formatForeignAmount = (amountOriginal: number, currency: string, language: Language) => {
  const amount = amountOriginal / 100;

  try {
    return new Intl.NumberFormat(INTL_LOCALES[language], { style: "currency", currency }).format(amount);
  } catch {
    /*
      `Intl` throws a RangeError on a code it does not recognise. Everything the selector offers comes
      from `ECB_CURRENCIES`, so this is only reachable through stored data - an archive imported from
      a future version of this app, or a row edited by hand. Rendering the bare number beats throwing
      inside a dialog's render path.
    */
    return new Intl.NumberFormat(INTL_LOCALES[language]).format(amount);
  }
};

/**
 * The exchange rate as a **ratio**, never as money.
 *
 * No `style: "currency"`: the rate is units of foreign currency per one euro, so any symbol would
 * claim it is a price in something, and there is no currency it could honestly wear.
 *
 * Two digits as a floor and five as a ceiling. Five covers the widest precision ECB publishes; two
 * keeps a round `1.5` from printing as a bare `1,5`, which reads like a truncation of a number the
 * reader is being asked to check.
 *
 * The locale comes from `INTL_LOCALES`, not from an eleventh `=== "de"` ternary (DW-281).
 */
export const formatExchangeRate = (rate: number, language: Language) =>
  new Intl.NumberFormat(INTL_LOCALES[language], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  }).format(rate);

/**
 * The one decision, made once, about whether a stored cost has a conversion receipt to show and what
 * that receipt says. Five render sites across three files consume it; none of them re-implements the
 * test, which is what keeps "a euro entry is annotated nowhere" a single fact rather than five.
 *
 * `null` means *no annotation element at all* - not an empty string, not a reserved line
 * (DESIGN.md:290). A receipt needs all three of its parts to be a receipt: an amount, the currency
 * it was in, and the rate that turned it into the euro figure printed above. A rate of `0` or below
 * is not a rate; it is the value that would have produced an Infinity on the way in.
 *
 * **The wording is a parameter, not a `t` lookup**, the same shape `printDocuments.ts` uses for a
 * module a client screen and a Node route both import. It keeps this file pure and directly
 * testable, and it keeps `@/i18n`'s dictionaries out of a helper that only needs a template string.
 * Callers pass `t("trips.money.originalCaption")`.
 */
export const formatCostOriginal = (
  receipt: { amountOriginal?: number | null; currency?: string | null; rate?: number | null },
  language: Language,
  template: string,
): string | null => {
  const { amountOriginal, currency, rate } = receipt;

  if (typeof amountOriginal !== "number" || !Number.isFinite(amountOriginal)) {
    return null;
  }
  if (typeof currency !== "string" || currency.length === 0) {
    return null;
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  return formatMessage(template, {
    amount: formatForeignAmount(amountOriginal, currency, language),
    rate: formatExchangeRate(rate, language),
  });
};
