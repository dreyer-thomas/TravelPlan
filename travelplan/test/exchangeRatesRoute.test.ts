import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/exchange-rates/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { __resetExchangeRateCacheForTests } from "@/lib/rates/exchangeRateService";
import { stubFetch } from "./helpers/mockFetch";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<Cube>
\t\t<Cube time='2026-09-18'>
\t\t\t<Cube currency='USD' rate='1.1460'/>
\t\t\t<Cube currency='JPY' rate='180.94'/>
\t\t</Cube>
\t</Cube>
</gesmes:Envelope>`;

/** The cast lives on the `vi.stubGlobal` argument inside `stubFetch`, never on the variable. */
const stubEcb = (body: string, status = 200) =>
  stubFetch(
    vi.fn(
      async () =>
        ({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body,
        }) as unknown as Response,
    ),
  );

describe("GET /api/exchange-rates", () => {
  beforeEach(() => {
    __resetExchangeRateCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = async (withSession: boolean) => {
    const headers: Record<string, string> = {};
    if (withSession) {
      headers.cookie = `session=${await createSessionJwt({ sub: "user-1", role: "OWNER" })}`;
    }
    const response = await GET(new NextRequest("http://localhost/api/exchange-rates", { headers }));
    const body = (await response.json()) as ApiEnvelope<{ date: string; rates: Record<string, number> }>;
    return { response, body };
  };

  it("rejects an unauthenticated request without touching the upstream", async () => {
    const fetchMock = stubEcb(ECB_XML);

    const { response, body } = await request(false);

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the parsed document to a signed-in user", async () => {
    stubEcb(ECB_XML);

    const { response, body } = await request(true);

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.date).toBe("2026-09-18");
    expect(body.data?.rates.USD).toBe(1.146);
  });

  it("answers 502 when the upstream fails, and never a zero rate", async () => {
    stubEcb("gateway timeout", 504);

    const { response, body } = await request(true);

    expect(response.status).toBe(502);
    expect(body.error?.code).toBe("rates_unavailable");
    expect(body.data).toBeNull();
  });

  it("serves a second request from cache", async () => {
    const fetchMock = stubEcb(ECB_XML);

    await request(true);
    await request(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
