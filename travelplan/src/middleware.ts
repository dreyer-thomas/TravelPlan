import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/auth/sessionGuard";

const isProtectedPath = (pathname: string) => pathname.startsWith("/trips");
const isProtectedApiPath = (pathname: string) => pathname.startsWith("/api/trips");
const isHomePath = (pathname: string) => pathname === "/";
const isForcedPasswordChangePath = (pathname: string) => pathname === "/auth/first-login-password";

export const middleware = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;
  const session = await getRequestSession(request);

  if (isProtectedApiPath(pathname)) {
    if (!session) {
      return NextResponse.json(
        { data: null, error: { code: "unauthorized", message: "Authentication required" } },
        { status: 401 },
      );
    }
    if (session.mustChangePassword) {
      return NextResponse.json(
        { data: null, error: { code: "password_change_required", message: "Password change required" } },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  if (isHomePath(pathname)) {
    if (session?.mustChangePassword) {
      return NextResponse.redirect(new URL("/auth/first-login-password", request.url));
    }
    if (session) {
      return NextResponse.redirect(new URL("/trips", request.url));
    }
    return NextResponse.next();
  }

  if (isForcedPasswordChangePath(pathname)) {
    if (!session) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    if (!session.mustChangePassword) {
      return NextResponse.redirect(new URL("/trips", request.url));
    }
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (session.mustChangePassword) {
    return NextResponse.redirect(new URL("/auth/first-login-password", request.url));
  }

  return NextResponse.next();
};

/**
 * `/api/trips/import` is deliberately *not* matched (Story 2.34 AC4).
 *
 * Next buffers a request body in memory for every path the matcher covers, before the handler runs -
 * which is invisible in this repo's own source and was only discovered on 2026-08-02, when the server
 * logged "Request body exceeded 10MB" while a 13.4 MB import failed with a misleading
 * `invalid_form_data`. `next.config.ts`'s `proxyClientMaxBodySize` raised that ceiling to 320 MB, but
 * a raised ceiling on a memory buffer is still a memory buffer: with the route now streaming its body
 * to a temp file, leaving the path in the matcher would have kept a 300 MB copy resident anyway and
 * made the rest of the story pointless.
 *
 * Only that one path is excluded. `/api/trips` itself is listed separately because `:path` requires a
 * segment, and every other `/api/trips/*` route stays guarded here. The import route self-guards with
 * `requireSession`, which returns the same `unauthorized` 401 and `password_change_required` 403 this
 * middleware does - `tripImportRoute.test.ts` asserts both, and `middleware.test.ts` asserts that the
 * matcher still covers its siblings, because "the exclusion quietly widened" is the way this breaks.
 *
 * The `/?` in the negative lookahead is not decoration: `(?!import$)` excluded `/api/trips/import`
 * and left `/api/trips/import/` matched, which is the same route with the same body and would have
 * been buffered after all. Run through Next's own `getMiddlewareMatchers`, both spellings are now
 * excluded, and `middleware.test.ts` pins both.
 */
export const config = {
  matcher: [
    "/",
    "/trips/:path*",
    "/api/trips",
    "/api/trips/:path((?!import/?$).*)",
    "/auth/first-login-password",
  ],
};
