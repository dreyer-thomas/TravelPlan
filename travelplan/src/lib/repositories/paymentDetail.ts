/**
 * The outbound shape of a payment row, written once because five read paths have to agree on it:
 * `accommodationRepo`, `dayPlanItemRepo`, the trip-detail payload, the export payload and the two
 * synthesize-from-`costCents` fallbacks inside the export.
 *
 * **`amountOriginal` is omitted, not `null`, for a euro row.** Story 10.1's first cut made it a
 * required outbound field carrying `null`, which put a new key on every payload the application has
 * ever produced - and AC4's "every existing test that saves a EUR cost passes unmodified" stopped
 * being true, for six suites, on a story whose whole premise is that the euro path is byte-for-byte
 * what it was. A row has an original amount only when the entry was priced in another currency; for
 * every other row the honest encoding is that the field is not there.
 *
 * The cost of that choice, stated plainly: the shape is conditional, so a consumer must treat the
 * field as optional rather than nullable. `tripImportSchemas.ts` already does - `amountOriginal` is
 * `.optional().nullable()` there - and `costCurrencySchemas.ts`'s `refineCostCurrency` reads it as
 * `payment.amountOriginal ?? null`, so both halves of the round trip accept either encoding.
 */
export type PaymentDetail = {
  amountCents: number;
  dueDate: string;
  amountOriginal?: number;
};

type PaymentRow = { amountCents: number; dueDate: string; amountOriginal?: number | null };

/** One row, with `amountOriginal` dropped when the entry carries no foreign-currency receipt. */
export const toPaymentDetail = (row: PaymentRow): PaymentDetail =>
  row.amountOriginal === null || row.amountOriginal === undefined
    ? { amountCents: row.amountCents, dueDate: row.dueDate }
    : { amountCents: row.amountCents, dueDate: row.dueDate, amountOriginal: row.amountOriginal };

/** The array form, which is how every call site actually needs it. */
export const toPaymentDetails = (rows: PaymentRow[] | null | undefined): PaymentDetail[] =>
  (rows ?? []).map(toPaymentDetail);
