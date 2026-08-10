import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf";
import { getRequestSession } from "@/lib/auth/sessionGuard";
import { ok } from "@/lib/http/response";

export const dynamic = "force-dynamic";

/**
 * Still unauthenticated by design: this route mints a token for `/auth/login`, `/auth/forgot-password` and
 * `/auth/first-login-password`, all of which are reached without a session, so it must never 401 and
 * `csrfToken` is issued to anonymous callers exactly as before.
 *
 * `authenticated` is DW-128's carrier and nothing more. `HeaderMenu` refetches this route every time the
 * menu opens, so a tab left open past session expiry needs one boolean to stop offering "All trips" into a
 * middleware bounce - and this route is the request it was already making. The entry proposed reading a
 * `401` from here instead, which cannot work: there is no session requirement to fail. Probing a protected
 * route (`/api/trips`) was the other candidate and was rejected - it runs a full trips query and returns
 * every trip's name, dates and cost totals to answer one boolean.
 *
 * `getRequestSession` rather than a hand-rolled verify, so this flag means exactly what
 * `AppHeader.resolveAuthState` means by `isAuthenticated`: a `session` cookie `verifySessionJwt` accepts.
 * That is "there is a session", not "that session can reach every row of the menu" - a
 * `mustChangePassword` caller has one and is still bounced off `/trips`. Reporting them signed out would
 * take the sign-out row away from the population that most needs a way back out, and `middleware.ts` sends
 * them to `/auth/first-login-password`, which renders no `AppHeader` at all.
 *
 * `Vary: Cookie` because the body is no longer the same for every caller. `Cache-Control: no-store` below
 * already forbids storing it, and this route emits no CORS headers so a cross-origin credentialed read is
 * blocked - `Vary` is the belt to those braces, against a future shared cache turning one visitor's
 * `authenticated: true` into another's.
 *
 * Additive: `csrfToken` keeps its name, type and semantics, the cookie write and `Cache-Control` are
 * untouched, and every existing consumer that reads only `csrfToken` is unaffected.
 */
export const GET = async (request: NextRequest) => {
  const cookieStore = await cookies();
  const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  const token = existing ?? createCsrfToken();
  const session = await getRequestSession(request);
  const response = ok({ csrfToken: token, authenticated: session !== null });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
};
