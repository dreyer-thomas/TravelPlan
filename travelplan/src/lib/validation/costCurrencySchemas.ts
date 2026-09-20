import { z } from "zod";
import { isValidDateOnly } from "@/lib/validation/dateOnly";

/**
 * The foreign-currency receipt an entry carries, written **once** and imported by the three schemas
 * that must agree on it: `accommodationSchemas.ts`, `dayPlanItemSchemas.ts` and
 * `tripImportSchemas.ts`.
 *
 * Sharing it is not tidiness. The `sum(payments) === costCents` rule next door was hand-copied into
 * those same three files, and keeping three copies in step is now permanent overhead on every change
 * to it. This rule is more intricate - four fields that are all-or-nothing, plus a second sum over a
 * second column - so a fourth hand-copy would be worse.
 *
 * **Currency and rate live on the parent only.** `cost_payments` carries `amountOriginal` and nothing
 * else: no currency column, no rate column, none to be added. That is what makes "two rates in one
 * entry" unrepresentable rather than merely discouraged, and it is why the exact-integer
 * `sum(payments.amountCents) === costCents` check downstream can stay exact.
 */

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO code")
  /*
    EUR is refused *as a stored value*, not as a choice the user can make. Selecting EUR in the dialog
    clears all five columns to null, which is the only representation of "this is a euro price" -
    storing `costCurrency: "EUR"` with a rate of 1 would give the same price two spellings and make
    every read surface test for both.
  */
  .refine((value) => value !== "EUR", "Euro entries carry no currency metadata");

const rateSchema = z
  .number({ message: "Rate must be a number" })
  .refine((value) => Number.isFinite(value) && value > 0, "Rate must be a positive number");

const rateDateSchema = z
  .string()
  .trim()
  .refine((value) => isValidDateOnly(value), "Rate date must be a valid YYYY-MM-DD value");

const originalAmountSchema = z
  .number({ message: "Original amount must be a number" })
  .int("Original amount must be an integer")
  .min(0, "Original amount must be at least 0");

/**
 * Spread into an object schema's shape. Every field is optional and nullable at the field level; the
 * all-or-nothing rule is a cross-field one and lives in `refineCostCurrency` below, because Zod
 * cannot express "these four agree" in a per-field schema.
 */
export const costCurrencyFields = {
  costOriginalAmount: originalAmountSchema.optional().nullable(),
  costCurrency: currencyCodeSchema.optional().nullable(),
  costRate: rateSchema.optional().nullable(),
  costRateDate: rateDateSchema.optional().nullable(),
};

/** The payment-row half. One column, because the parent owns the currency and the rate. */
export const paymentOriginalField = {
  amountOriginal: originalAmountSchema.optional().nullable(),
};

type CostCurrencyCarrier = {
  costCents?: number | null;
  costOriginalAmount?: number | null;
  costCurrency?: string | null;
  costRate?: number | null;
  costRateDate?: string | null;
  payments?: { amountOriginal?: number | null }[] | null;
};

/**
 * The cross-field rule, applied from inside each caller's existing `.superRefine`.
 *
 * Call it **after** the `total !== costCents` check, never instead of it: that check is the invariant
 * this entire design exists to satisfy, and this one is additive.
 */
export const refineCostCurrency = (value: CostCurrencyCarrier, context: z.RefinementCtx) => {
  const costOriginalAmount = value.costOriginalAmount ?? null;
  const costCurrency = value.costCurrency ?? null;
  const costRate = value.costRate ?? null;
  const costRateDate = value.costRateDate ?? null;
  const payments = value.payments ?? [];

  const present = [costOriginalAmount, costCurrency, costRate, costRateDate].filter(
    (field) => field !== null,
  ).length;

  /*
    All four or none. A partial set is not a lesser version of a foreign-currency entry - it is an
    entry whose euro figure cannot be explained, which is the one thing the receipt exists to prevent.
    Three of four present is far more likely to be a caller that forgot to thread a field through a
    route's field-by-field destructuring than a user doing anything.
  */
  if (present !== 0 && present !== 4) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["costCurrency"],
      message: "Currency metadata must be complete or absent",
    });
    return;
  }

  /*
    A receipt with nothing to explain. `costCents === null` means "no price on this entry", and a
    currency, a rate and a rate date describing an absent figure is not a lesser entry - it is the
    state a dialog reaches by typing a foreign price, clearing the box, and saving. Storing it would
    reopen showing a foreign amount with no cost beside it.

    Code review of Story 10.2 extended this to a stored **zero**. A price of zero is a euro price: it
    is the same figure in every currency, so there is no conversion for a receipt to record. Leaving
    `0` storable with metadata put the two read surfaces into open disagreement - the day view's
    activity card hides a recorded `0` on a truthiness gate, while the print sheet's `typeof` gate
    renders it, so the same entry printed `Kosten: 0,00 EUR` with `0,00 NZ$ zu 1,8563/EUR` beneath it
    on paper and nothing at all on screen. Both dialogs now degrade such an entry to euro before it
    is sent, so this refusal is the backstop rather than the thing a user meets.
  */
  if (present === 4 && !(value.costCents ?? null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["costCurrency"],
      message: "Currency metadata requires a cost",
    });
    return;
  }

  if (present === 0) {
    /*
      A euro entry whose payment rows carry originals would be a receipt with no currency to read it
      in - and on the next save the dialog would seed the boxes from those originals as if they were
      euros.
    */
    if (payments.some((payment) => (payment.amountOriginal ?? null) !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Payment original amounts require currency metadata",
      });
    }
    return;
  }

  if (payments.length === 0) {
    return;
  }

  if (payments.some((payment) => (payment.amountOriginal ?? null) === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "Every payment must carry its original amount",
    });
    return;
  }

  /*
    The sum is checked in the **entered** currency as well as in cents. The cents check downstream can
    pass on converted numbers that no longer add up to what the user typed - the residual sweep makes
    the cents reconcile by construction - so this is the only place the typed figures are held to
    their own total.
  */
  const total = payments.reduce((sum, payment) => sum + (payment.amountOriginal ?? 0), 0);
  if (total !== costOriginalAmount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "Payment originals must match the original cost",
    });
  }
};
