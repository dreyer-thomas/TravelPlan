import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ECB_CURRENCIES,
  ExchangeRateError,
  __resetExchangeRateCacheForTests,
  getEcbRates,
} from "@/lib/rates/exchangeRateService";

/**
 * The verbatim shape of `eurofxref-daily.xml` as fetched on 2026-09-20: single-quoted attributes,
 * tab indentation, and three nested elements all named `Cube`. A parser written against
 * double-quoted attributes reads zero rates out of this and the feature silently degrades to EUR
 * for every user, which is why the fixture is copied rather than normalised.
 */
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<gesmes:subject>Reference rates</gesmes:subject>
\t<gesmes:Sender>
\t\t<gesmes:name>European Central Bank</gesmes:name>
\t</gesmes:Sender>
\t<Cube>
\t\t<Cube time='2026-09-18'>
\t\t\t<Cube currency='USD' rate='1.1460'/>
\t\t\t<Cube currency='JPY' rate='180.94'/>
\t\t\t<Cube currency='CHF' rate='0.9328'/>
\t\t</Cube>
\t</Cube>
</gesmes:Envelope>`;

/**
 * `mockFetchResponse` from `test/helpers/mockFetch.ts` is deliberately not used here: it models a
 * JSON body and offers no `text()`, and this is the one upstream in the codebase that answers XML.
 * The shape stays minimal for the same reason that helper gives - a fixture that answers a call
 * production never makes proves nothing.
 */
const xmlResponse = (body: string, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }) as unknown as Response;

describe("exchangeRateService", () => {
  beforeEach(() => {
    __resetExchangeRateCacheForTests();
  });

  it("parses the published document, single-quoted attributes and all", async () => {
    const fetchImpl = vi.fn(async () => xmlResponse(ECB_XML));

    const result = await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.date).toBe("2026-09-18");
    expect(result.rates.USD).toBe(1.146);
    expect(result.rates.JPY).toBe(180.94);
    expect(result.rates.CHF).toBe(0.9328);
  });

  /**
   * Story 10.1 review. The TTL cache alone did not make AC10's "at most one outbound request per TTL
   * window" true: it is read before the fetch and written only after the response parses, so every
   * caller arriving in that gap missed it and opened its own request. One user with three dialogs,
   * or three users after a cold start, meant three calls to a public courtesy service.
   */
  it("issues one outbound request when several callers arrive on a cold cache", async () => {
    let resolveBody: ((value: string) => void) | null = null;
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            new Promise<string>((resolve) => {
              resolveBody = resolve;
            }),
        }) as unknown as Response,
    );

    const first = getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const second = getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const third = getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await vi.waitFor(() => expect(resolveBody).not.toBeNull());
    resolveBody!(ECB_XML);

    const [a, b, c] = await Promise.all([first, second, third]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.rates.USD).toBe(1.146);
    // The same resolved document, not three parses of three responses.
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  /** A failure is still never cached, and the in-flight guard must not turn one outage into a stuck promise. */
  it("retries after a failed request rather than holding the failure in flight", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => xmlResponse("", 503))
      .mockImplementationOnce(async () => xmlResponse(ECB_XML));

    await expect(getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(
      ExchangeRateError,
    );

    const retried = await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(retried.date).toBe("2026-09-18");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts double-quoted attributes too", async () => {
    const doubleQuoted = ECB_XML.replace(/'/g, '"');
    const fetchImpl = vi.fn(async () => xmlResponse(doubleQuoted));

    const result = await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.date).toBe("2026-09-18");
    expect(result.rates.USD).toBe(1.146);
  });

  it("drops a single malformed row and keeps the rest of the document", async () => {
    const withBadRow = ECB_XML.replace(
      "<Cube currency='JPY' rate='180.94'/>",
      "<Cube currency='JPY' rate='N/A'/>\n\t\t\t<Cube currency='SEK' rate='0'/>",
    );
    const fetchImpl = vi.fn(async () => xmlResponse(withBadRow));

    const result = await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.rates.JPY).toBeUndefined();
    expect(result.rates.SEK).toBeUndefined();
    expect(result.rates.USD).toBe(1.146);
    expect(result.rates.CHF).toBe(0.9328);
  });

  it("throws rates_unavailable on a non-200 response", async () => {
    const fetchImpl = vi.fn(async () => xmlResponse("upstream is down", 503));

    await expect(getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      code: "rates_unavailable",
    });
  });

  it("throws rates_invalid_response when the document carries no time attribute", async () => {
    const noTime = ECB_XML.replace("<Cube time='2026-09-18'>", "<Cube>");
    const fetchImpl = vi.fn(async () => xmlResponse(noTime));

    await expect(getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(
      ExchangeRateError,
    );
  });

  it("throws rates_invalid_response when every row is unusable", async () => {
    const empty = ECB_XML.replace(/<Cube currency=[^/]*\/>/g, "");
    const fetchImpl = vi.fn(async () => xmlResponse(empty));

    await expect(getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      code: "rates_invalid_response",
    });
  });

  it("serves the second read from cache, issuing one outbound request", async () => {
    const fetchImpl = vi.fn(async () => xmlResponse(ECB_XML));

    await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the TTL window has passed", async () => {
    const fetchImpl = vi.fn(async () => xmlResponse(ECB_XML));
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });
    nowSpy.mockReturnValue(1_000_000 + 30 * 60 * 1000 + 1);
    await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("never caches a failure", async () => {
    const failing = vi.fn(async () => xmlResponse("down", 502));
    await expect(getEcbRates({ fetchImpl: failing as unknown as typeof fetch })).rejects.toBeInstanceOf(
      ExchangeRateError,
    );

    const succeeding = vi.fn(async () => xmlResponse(ECB_XML));
    const result = await getEcbRates({ fetchImpl: succeeding as unknown as typeof fetch });

    expect(result.date).toBe("2026-09-18");
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("requests the ECB daily file with the house headers", async () => {
    const fetchImpl = vi.fn(async () => xmlResponse(ECB_XML));

    await getEcbRates({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("eurofxref-daily.xml");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("TravelPlan");
  });

  it("publishes a currency list that excludes EUR and holds only ISO codes", () => {
    expect(ECB_CURRENCIES).not.toContain("EUR");
    expect(ECB_CURRENCIES.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(new Set(ECB_CURRENCIES).size).toBe(ECB_CURRENCIES.length);
    // Deliberately no length assertion: the list is a moving target (BGN left it on 2026-01-01).
    expect(ECB_CURRENCIES[0]).toBe("USD");
  });
});
