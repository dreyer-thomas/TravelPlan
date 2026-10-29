import { z } from "zod";
import { ECB_CURRENCIES, ExchangeRateError, getEcbRates } from "@/lib/rates/exchangeRateService";
import { convertEntryToCents } from "@/lib/trips/convertCost";
import { isValidDateOnly } from "@/lib/validation/dateOnly";

/**
 * Story 15.6. The connector's cost input, shared by `create_activity`, `update_activity` and `set_stay`: an
 * amount in EUR or in a currency the ECB publishes, with an optional payment schedule.
 *
 * The dialogs convert a foreign price in the browser (`convertEntryToCents` over the ECB rates the
 * `/api/exchange-rates` proxy serves). The connector has no browser, so it fetches the same rates on the
 * server (`getEcbRates`, cached for 30 minutes) and runs the same pure conversion: the stored shape is the
 * dialog's exactly (`costCents`, the four currency columns, `amountCents` and `amountOriginal` per payment),
 * and the entry's own schema re-checks it before the write.
 *
 * `cost: null` clears the cost, its currency fields and its payments; an absent `cost` keeps what is stored
 * (the tools decide that, not this module).
 */

/** The injection seam: tests replace `rates` (`vi.spyOn`), so no test reaches the ECB. */
export const costDeps = { rates: () => getEcbRates() };

/** The largest amount one cost or payment takes, in the currency's major unit. */
export const MAX_COST_AMOUNT = 1_000_000;
/** The most payments one cost is split into. */
export const MAX_COST_PAYMENTS = 20;

export const COST_CURRENCIES: readonly string[] = ["EUR", ...ECB_CURRENCIES];

export const ECB_UNAVAILABLE =
  "The ECB exchange rates are unavailable right now, so nothing was written. Give the cost in EUR or try again later.";
const PAYMENTS_NEED_A_DAY =
  "A bucket-list activity has no day to date its payment by: give cost.payments with their dueDate (YYYY-MM-DD).";
const FOREIGN_ZERO = "A cost in a foreign currency must be more than 0; give a zero cost in EUR.";
const NOT_CONVERTIBLE = "The payments cannot be converted to whole euro cents; use fewer or larger payments.";
const BELOW_ONE_CENT = "The amount is less than one euro cent at today's ECB rate.";
const ABOVE_MAXIMUM = "The cost converts to more than 1,000,000 EUR.";
/** The entry schemas' largest cost, in EUR cents (the stay's `costSchema`). */
const MAX_COST_CENTS = 100_000_000;

/** Whole cents: at most two decimals, within floating-point noise. Story 15.5's rule, shared since 15.6. */
export const hasAtMostTwoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

/** An amount in hundredths of its currency: the stored original amount, and euro cents for EUR. */
const toHundredths = (amount: number) => Math.round(amount * 100);

const amountField = z
  .number()
  .nonnegative()
  .max(MAX_COST_AMOUNT)
  .refine(hasAtMostTwoDecimals, "Amounts have at most two decimals");

const currencyMessage = `cost.currency must be one of: ${COST_CURRENCIES.join(", ")}`;

export const costField = z
  .object({
    amount: amountField.describe(
      `The total in the currency's major unit (e.g. 12.5), at most two decimals and at most ${MAX_COST_AMOUNT}.`,
    ),
    currency: z
      .string()
      .refine((value) => COST_CURRENCIES.includes(value), currencyMessage)
      .optional()
      .describe(
        `EUR (the default) or a currency the ECB publishes (${ECB_CURRENCIES.join(", ")}); a foreign amount is ` +
          "converted to EUR at today's ECB rate, as the app's dialogs do.",
      ),
    payments: z
      .array(
        z.object({
          amount: amountField.describe("The instalment, in the same currency as cost.amount."),
          dueDate: z
            .string()
            .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isValidDateOnly(value), "Use YYYY-MM-DD for dueDate")
            .describe("When it is due, as YYYY-MM-DD."),
        }),
      )
      .min(1)
      .max(MAX_COST_PAYMENTS)
      .optional()
      .describe(
        `The payment schedule, 1 to ${MAX_COST_PAYMENTS} instalments that add up exactly to amount. Left out: one ` +
          "payment of the full amount due on the entry's day (a bucket-list activity has no day, so it must give them).",
      ),
  })
  .refine(
    (cost) =>
      cost.payments === undefined ||
      cost.payments.reduce((sum, payment) => sum + toHundredths(payment.amount), 0) === toHundredths(cost.amount),
    { message: "cost.payments must add up exactly to cost.amount", path: ["payments"] },
  );

export type CostInput = z.infer<typeof costField>;

/** What the repositories store for a cost; the payments replace the stored ones wholesale. */
export type ResolvedCostFields = {
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: { amountCents: number; dueDate: string; amountOriginal: number | null }[];
};

const NO_COST: ResolvedCostFields = {
  costCents: null,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  payments: [],
};

/**
 * The cost as the dialog would store it, or the refusal to give the model (nothing is written then).
 * `dueDateDefault` is the entry's day (`YYYY-MM-DD`), or `null` for a bucket-list activity.
 */
export const resolveCost = async (
  cost: CostInput | null,
  options: { dueDateDefault: string | null },
): Promise<{ fields: ResolvedCostFields } | { refusal: string }> => {
  if (cost === null) return { fields: { ...NO_COST, payments: [] } };
  let schedule: { amount: number; dueDate: string }[];
  if (cost.payments) {
    schedule = cost.payments;
  } else if (options.dueDateDefault !== null) {
    schedule = [{ amount: cost.amount, dueDate: options.dueDateDefault }];
  } else {
    return { refusal: PAYMENTS_NEED_A_DAY };
  }

  const currency = cost.currency ?? "EUR";
  if (currency === "EUR") {
    return {
      fields: {
        ...NO_COST,
        costCents: toHundredths(cost.amount),
        payments: schedule.map((payment) => ({
          amountCents: toHundredths(payment.amount),
          dueDate: payment.dueDate,
          amountOriginal: null,
        })),
      },
    };
  }

  if (toHundredths(cost.amount) === 0) return { refusal: FOREIGN_ZERO };
  let rates;
  try {
    rates = await costDeps.rates();
  } catch (error) {
    if (error instanceof ExchangeRateError) return { refusal: ECB_UNAVAILABLE };
    throw error;
  }
  const rate = rates.rates[currency];
  if (rate === undefined) return { refusal: ECB_UNAVAILABLE };

  const costOriginalAmount = toHundredths(cost.amount);
  let converted;
  try {
    converted = convertEntryToCents({
      costOriginalAmount,
      payments: schedule.map((payment) => ({ amountOriginal: toHundredths(payment.amount) })),
      rate,
    });
  } catch {
    // The reconciliation guard: a split whose leftover cent cannot be absorbed without a negative row.
    return { refusal: NOT_CONVERTIBLE };
  }
  // A foreign zero in cents would be refused by the currency rule; past the cap by the entry's schema.
  if (converted.costCents === 0) return { refusal: BELOW_ONE_CENT };
  if (converted.costCents > MAX_COST_CENTS) return { refusal: ABOVE_MAXIMUM };
  return {
    fields: {
      costCents: converted.costCents,
      costOriginalAmount,
      costCurrency: currency,
      costRate: rate,
      costRateDate: rates.date,
      payments: converted.payments.map((payment, index) => ({
        amountCents: payment.amountCents,
        dueDate: schedule[index].dueDate,
        amountOriginal: payment.amountOriginal,
      })),
    },
  };
};
