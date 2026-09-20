import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { ExchangeRateError, getEcbRates } from "@/lib/rates/exchangeRateService";

/**
 * A session-gated proxy in front of the ECB daily file, the same job `api/geocode/route.ts` does for
 * Nominatim and for the same two reasons: the browser must not reach a third party directly, and a
 * public courtesy service must not see one request per dialog open. The service's 30-minute cache
 * lives behind this route, so a session that opens six dialogs costs ECB one request.
 *
 * `requireSession` rather than geocode's open-coded `verifySessionJwt`: geocode predates the helper.
 *
 * Deliberately **not** listed in `src/proxy.ts`'s `config.matcher`. That matcher covers `/api/trips`,
 * and this path is not under it, so the proxy never sees the route and the route guards itself -
 * exactly like `/api/geocode` and `/api/users`.
 */
export const GET = async (request: NextRequest) => {
  const { response: unauthorized } = await requireSession(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { date, rates } = await getEcbRates();
    return ok({ date, rates });
  } catch (error) {
    const code = error instanceof ExchangeRateError ? error.code : "rates_unavailable";
    /*
      502 for both failure codes: from the caller's side "ECB is down" and "ECB answered something we
      cannot read" are the same event, and the caller's only correct response to either is to fall
      back to plain EUR entry with a notice. It is never a blocking error and never a zero rate.
    */
    return fail(apiError(code, "Unable to retrieve exchange rates"), 502);
  }
};
