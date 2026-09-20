"use client";

import { useCallback, useRef, useState } from "react";
import type { EcbRates } from "@/lib/rates/exchangeRateService";

/**
 * The currency selector's state machine, shared by the accommodation dialog and the activity dialog.
 *
 * Written once rather than twice because the two dialogs disagree about almost everything else -
 * react-hook-form against three hand-rolled `useState` stores - but must agree exactly here: when a
 * rate is fetched, what happens when the fetch fails, and which rate a submit converts at. Two
 * hand-copied versions of that is how the `sum(payments) === costCents` rule ended up with three call
 * sites that have to be kept in step.
 *
 * Three rules it exists to enforce:
 *
 * 1. **Nothing is requested while EUR is selected** (AC4). Not on open, not on first render - the
 *    first move off EUR is the only trigger. A euro-only session issues no outbound request at all.
 * 2. **One request per dialog, not one per keystroke.** The document is held for the dialog's life;
 *    the proxy's own 30-minute cache then flattens several dialogs into one ECB request.
 * 3. **A failure degrades, never blocks** (AC9). `unavailable` goes true, the caller shows a notice
 *    in the caption slot, and the field carries on as plain euro entry. Never a blocking error,
 *    never a silent zero, never a `0` rate.
 */

export type EntryCurrencyState = {
  currency: string;
  /** The rate for `currency`, or `null` when EUR is selected or no rate could be obtained. */
  rate: number | null;
  /** The ECB publication date behind `rate` - the `time` attribute, verbatim. */
  rateDate: string | null;
  /** A lookup was attempted for the selected code and did not produce a usable rate. */
  unavailable: boolean;
  isForeign: boolean;
  /** The entry was loaded with a complete stored receipt, so losing it is a regression, not a default. */
  hasStoredReceipt: boolean;
  selectCurrency: (next: string) => void;
  /**
   * Restore a currency **without** asking for a rate - what a dialog's open-effect does when it
   * seeds itself from a saved entry.
   *
   * Separate from `selectCurrency` because the trigger for a lookup is the *user* moving off EUR, not
   * the value being foreign: seeding through `selectCurrency` would issue a request on every open of
   * a foreign entry, which is both AC4's "no request while the user has not asked" and AC11's "no
   * re-fetch, no re-conversion at today's rate" broken by one line that looks like housekeeping.
   */
  seedCurrency: (next: string) => void;
  /**
   * Resolve the rate for the current selection, fetching if this is the first time it is needed.
   * `null` means "carry on in euros" - the submit path must treat that as a EUR save, never as a
   * reason to refuse.
   */
  ensureRate: () => Promise<{ rate: number; rateDate: string } | null>;
};

export const useEntryCurrency = ({
  initialCurrency,
  initialRate,
  initialRateDate,
  fetchImpl,
}: {
  initialCurrency?: string | null;
  initialRate?: number | null;
  initialRateDate?: string | null;
  fetchImpl?: typeof fetch;
} = {}): EntryCurrencyState => {
  const [currency, setCurrency] = useState(initialCurrency || "EUR");
  const [rates, setRates] = useState<EcbRates | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  /*
    The rate the entry was *stored* with, kept apart from anything fetched in this session. While the
    selection still matches the loaded entry it is the honest answer to "what rate is this priced at"
    - re-fetching to answer that would silently re-price a saved entry at today's rate, which is the
    failure AC11 is written against.
  */
  const storedCurrency = initialCurrency || null;
  const storedRate = initialRate ?? null;
  const storedRateDate = initialRateDate ?? null;

  // A ref, not state: two selector changes in one tick must share one request, and a state update
  // would not be visible to the second of them.
  const inFlight = useRef<Promise<EcbRates | null> | null>(null);

  const loadRates = useCallback(async (): Promise<EcbRates | null> => {
    if (rates) return rates;
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      try {
        const doFetch = fetchImpl ?? fetch;
        const response = await doFetch("/api/exchange-rates", { credentials: "include" });
        const body = (await response.json()) as {
          data: EcbRates | null;
          error: { code: string } | null;
        };
        if (!response.ok || body.error || !body.data) {
          setUnavailable(true);
          return null;
        }
        setRates(body.data);
        setUnavailable(false);
        return body.data;
      } catch {
        // A network error is the same outcome as a 502 to this caller: no rate, euro entry, notice.
        setUnavailable(true);
        return null;
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = request;
    return request;
  }, [fetchImpl, rates]);

  const rateFor = useCallback(
    (code: string, document: EcbRates | null): { rate: number; rateDate: string } | null => {
      if (code === "EUR") return null;
      const fetched = document?.rates[code];
      if (typeof fetched === "number" && Number.isFinite(fetched) && fetched > 0) {
        return { rate: fetched, rateDate: document!.date };
      }
      /*
        Falling back to the stored rate only while the selection is unchanged. A code the fetched
        document does not carry - a currency that left the list between the save and this edit - is
        the same outcome as an outage for any *other* code: no rate, euro entry, notice.
      */
      if (code === storedCurrency && storedRate !== null && storedRateDate !== null) {
        return { rate: storedRate, rateDate: storedRateDate };
      }
      return null;
    },
    [storedCurrency, storedRate, storedRateDate],
  );

  const selectCurrency = useCallback(
    (next: string) => {
      setCurrency(next);
      if (next === "EUR") {
        // Switching back to EUR clears the notice: there is nothing left that needs a rate, so a
        // standing "rates unavailable" line would describe a problem the field no longer has.
        setUnavailable(false);
        return;
      }
      /*
        Fire and forget for the caption - the submit path awaits `ensureRate` rather than depending
        on this having finished - but the answer is still inspected when it lands.

        AC9 names two failures, not one: the fetch failing, and "a selected code absent from the
        fetched document". Only the first used to raise the notice. The second left `unavailable`
        false (a successful `loadRates` sets it so) and, worse, `loadRates` short-circuits on an
        already-cached document, so selecting a delisted code after any earlier selection went
        through this function without touching the flag at all. The user saw a field with no
        conversion and no warning, and the typed amount saved as euros.
      */
      void loadRates().then((document) => {
        setUnavailable(rateFor(next, document) === null);
      });
    },
    [loadRates, rateFor],
  );

  const seedCurrency = useCallback((next: string) => {
    setCurrency(next || "EUR");
    setUnavailable(false);
  }, []);

  const ensureRate = useCallback(async () => {
    if (currency === "EUR") return null;
    const resolved = rateFor(currency, rates ?? (await loadRates()));
    if (!resolved) {
      setUnavailable(true);
    }
    return resolved;
  }, [currency, loadRates, rateFor, rates]);

  const resolved = rateFor(currency, rates);

  return {
    currency,
    rate: resolved?.rate ?? null,
    rateDate: resolved?.rateDate ?? null,
    unavailable: currency !== "EUR" && unavailable && resolved === null,
    isForeign: currency !== "EUR",
    /*
      Story 10.1 review. Whether this entry arrived carrying a receipt, which is what decides
      between AC9's "degrade to euros" and AC11's "never drop the receipt" when no rate can be
      obtained. A *new* entry has nothing to lose and degrades; an entry already priced in a foreign
      currency would have its stored rate, rate date and euro figure overwritten by the typed
      foreign number, so its submit is refused instead. See the submit paths in both dialogs.
    */
    hasStoredReceipt: storedCurrency !== null && storedRate !== null && storedRateDate !== null,
    selectCurrency,
    seedCurrency,
    ensureRate,
  };
};
