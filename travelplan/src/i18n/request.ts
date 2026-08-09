/**
 * The request-scoped counterpart of `server.ts`, for route handlers (DW-230).
 *
 * **Why this exists beside `getServerLanguage`/`getServerT`.** Those read the cookie through
 * `next/headers`, which resolves out of Next's request async-storage. That works inside a route handler at
 * runtime, but a route handler's *test* constructs a bare `NextRequest` and invokes the exported `GET`
 * directly - there is no async-storage for `cookies()` to read there, so a route that resolved its
 * language that way could not have its non-English behaviour tested at route level at all. The packet
 * route's German case would have been untestable, which is most of what DW-230 is about.
 *
 * Reading the cookie off the request is also simply the house pattern for anything per-request: the
 * session guard (`sessionGuard.ts`) and the CSRF guards all take their cookie from `request.cookies`
 * rather than from `next/headers`. This follows them.
 *
 * The cookie name comes from `LANGUAGE_COOKIE_NAME` and the value goes through `resolveLanguage`, never a
 * raw string compare - so an absent cookie and an unsupported code both land on `DEFAULT_LANGUAGE`
 * instead of reaching a dictionary lookup that would miss.
 */
import type { NextRequest } from "next/server";
import { dictionaries, LANGUAGE_COOKIE_NAME, resolveLanguage, translate, type Language } from "@/i18n";

export const getRequestLanguage = (request: NextRequest): Language =>
  resolveLanguage(request.cookies.get(LANGUAGE_COOKIE_NAME)?.value);

/**
 * The language **and** its translator from one parse of the cookie.
 *
 * This replaced a `getRequestT(request)` that resolved the cookie again internally. A caller needing both -
 * which the packet route does, because `buildDocumentPacket` takes a `Language` while the plan-item fallback
 * needs a `t` - had to call two functions that each derived the language independently, and nothing
 * structurally said the two answers were the same one. They agreed only because both happened to call the
 * same resolver on the same request; a future short-circuit, cache or override on either side could make the
 * packet's label pages German while its plan-item labels stayed English, and no test of either function
 * alone would see it. Returning the pair from a single resolution makes them the same value by
 * construction rather than by coincidence.
 *
 * `getRequestLanguage` stays exported: it is the narrow reader, and a caller that only needs the code should
 * not have to build a dictionary closure to get one.
 */
export const getRequestI18n = (request: NextRequest): { language: Language; t: (key: string) => string } => {
  const language = getRequestLanguage(request);
  const dictionary = dictionaries[language];
  return { language, t: (key: string) => translate(dictionary, key) };
};
