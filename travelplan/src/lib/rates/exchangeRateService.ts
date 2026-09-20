/**
 * The European Central Bank's daily reference-rate feed.
 *
 * Chosen over a keyed provider for one reason that outranks every feature comparison: it needs no
 * account, no key, no registration and no new dependency. The document is ~1.5 KB of XML published
 * once per TARGET working day, and this module is the only place in the codebase that knows its
 * shape.
 *
 * Modelled on `src/lib/routing/dayRouteService.ts`, the house shape for an outbound call: an
 * injectable `fetchImpl`, an `AbortController` timeout, `cache: "no-store"`, a named `User-Agent`,
 * and a typed error class the caller can branch on.
 */

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/**
 * The currencies the selector offers, in the order ECB publishes them - as observed in the live
 * document on 2026-09-20. EUR is not a member: it is the base the rates are quoted against, and the
 * UI prepends it as the default option.
 *
 * This list is a moving target. `BGN` left it when Bulgaria adopted the euro on 2026-01-01, exactly
 * as `HRK` did in 2023, and the next accession will shorten it again. Nothing may assert its length
 * - not a test, not a runtime check. Editing this array is a supported, no-consequence change.
 */
export const ECB_CURRENCIES = [
  "USD",
  "JPY",
  "CZK",
  "DKK",
  "GBP",
  "HUF",
  "PLN",
  "RON",
  "SEK",
  "CHF",
  "ISK",
  "NOK",
  "TRY",
  "AUD",
  "BRL",
  "CAD",
  "CNY",
  "HKD",
  "IDR",
  "ILS",
  "INR",
  "KRW",
  "MXN",
  "MYR",
  "NZD",
  "PHP",
  "SGD",
  "THB",
  "ZAR",
] as const;

export type EcbCurrency = (typeof ECB_CURRENCIES)[number];

/**
 * `date` is the `time` attribute of the middle `Cube` verbatim, and it is what gets stored in
 * `costRateDate`. There is no weekend special case anywhere in this module: on a Saturday the daily
 * file still serves Friday's rates carrying Friday's `time`, which is the honest answer to "what
 * rate was this converted at".
 *
 * `rates` are units of foreign currency per **one euro**, exactly as published and un-inverted.
 */
export type EcbRates = {
  date: string;
  rates: Record<string, number>;
};

export type ExchangeRateErrorCode = "rates_unavailable" | "rates_invalid_response";

export class ExchangeRateError extends Error {
  readonly code: ExchangeRateErrorCode;

  constructor(code: ExchangeRateErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Thirty minutes. The document changes at most once a day (around 16:00 CET), so this is not about
 * freshness - it is about not hitting a public service once per dialog open. Opening six dialogs in
 * a session costs one outbound request.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;

let cache: { fetchedAtMs: number; value: EcbRates } | null = null;

/*
  Story 10.1 review. The cache alone does not make AC10's "at most one outbound request per TTL
  window" true: it is read before the fetch and written only after the response parses, so every
  request arriving in that gap missed the cache and issued its own call. One user opening three
  dialogs at once, or three users after a cold start, meant three requests to a public courtesy
  service this proxy exists to spare. `useEntryCurrency` already holds the same guard on the client
  side; this is its server-side half.

  A failure is still not cached - `inFlight` is cleared in `finally`, so the *next* caller retries -
  but the callers already waiting on a failed request all receive that one failure rather than
  stampeding the upstream a second time.
*/
let inFlight: Promise<EcbRates> | null = null;

/**
 * `fileParallelism: false` and `maxForks: 1` mean module state survives from one test file into the
 * next inside a single run, so a suite that leaves a populated cache behind makes an unrelated
 * suite's "issues one request" assertion pass for the wrong reason. Call this in `beforeEach`.
 */
export const __resetExchangeRateCacheForTests = () => {
  cache = null;
  inFlight = null;
};

/**
 * The document's attributes are single-quoted (`currency='USD' rate='1.1460'`), which is legal XML
 * and is what ECB actually publishes. Both quote styles are accepted so that a future switch on
 * their side is not an outage on ours.
 *
 * Parsing by regex rather than by library is deliberate: `package.json` carries no XML parser, and
 * "no new dependency" is a stated reason this feed was chosen at all. The grammar being matched is
 * three attributes on a self-closing element, not arbitrary XML.
 */
const RATE_ROW_PATTERN = /<Cube\s+currency=['"]([A-Za-z]{3})['"]\s+rate=['"]([^'"]*)['"]\s*\/?>/g;
const TIME_PATTERN = /<Cube\s+time=['"]([0-9]{4}-[0-9]{2}-[0-9]{2})['"]\s*>/;

export const parseEcbDocument = (xml: string): EcbRates => {
  const timeMatch = TIME_PATTERN.exec(xml);
  if (!timeMatch) {
    throw new ExchangeRateError("rates_invalid_response", "Exchange rate document carries no date");
  }

  const rates: Record<string, number> = {};
  // `matchAll` rather than a stateful `exec` loop: `RATE_ROW_PATTERN` is a module-level `/g` regex,
  // and a loop that exits early would leave `lastIndex` set for the next caller.
  for (const match of xml.matchAll(RATE_ROW_PATTERN)) {
    const code = match[1].toUpperCase();
    const rate = Number(match[2]);
    /*
      One unparseable row must not cost the other twenty-eight - the same per-row-drop rule
      `api/geocode/route.ts` follows for Nominatim. A non-positive rate is dropped along with a
      non-numeric one: it would divide to Infinity or flip the sign, and a zero rate reaching the
      UI is precisely what AC9 forbids. `Number("")` is `0`, so the emptiness case falls out here
      too rather than needing its own branch.
    */
    if (!Number.isFinite(rate) || rate <= 0) {
      continue;
    }
    rates[code] = rate;
  }

  if (Object.keys(rates).length === 0) {
    throw new ExchangeRateError("rates_invalid_response", "Exchange rate document carries no usable rates");
  }

  return { date: timeMatch[1], rates };
};

const fetchEcbDocument = async ({
  fetchImpl,
  timeoutMs,
}: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<EcbRates> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(ECB_DAILY_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "TravelPlan/0.1 exchange-rates",
      },
    });

    if (!response.ok) {
      throw new ExchangeRateError("rates_unavailable", "Unable to retrieve exchange rates");
    }

    const value = parseEcbDocument(await response.text());

    /*
      Successes only. Caching a failure would blackhole the feature for half an hour after a single
      blip - every dialog opened in that window would degrade to plain EUR entry with a notice, long
      after the upstream recovered.
    */
    cache = { fetchedAtMs: Date.now(), value };
    return value;
  } catch (error) {
    if (error instanceof ExchangeRateError) {
      throw error;
    }
    // A timeout aborts the fetch, which rejects here; so does a DNS failure or a socket reset.
    throw new ExchangeRateError("rates_unavailable", "Exchange rate request failed");
  } finally {
    clearTimeout(timeout);
  }
};

export const getEcbRates = async ({
  fetchImpl = fetch,
  timeoutMs = 3500,
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<EcbRates> => {
  if (cache && Date.now() - cache.fetchedAtMs < CACHE_TTL_MS) {
    return cache.value;
  }

  // A second caller arriving while the first is still waiting joins that request instead of opening
  // its own. `fetchImpl` and `timeoutMs` come from the first caller: in production they are the
  // defaults for every caller, and a test that injects its own resets the module state anyway.
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      return await fetchEcbDocument({ fetchImpl, timeoutMs });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};
