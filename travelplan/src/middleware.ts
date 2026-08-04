import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/auth/sessionGuard";

/**
 * Story 5.10 added `/admin`, extending this predicate rather than adding a third branch below - the
 * treatment a signed-out or password-flagged caller gets is identical for all three page trees.
 *
 * **This does not check for `ADMIN`, and cannot.** Two reasons, both structural: the role in the session
 * token is a seven-day snapshot (`createSessionJwt({ sub, role })`), so a promotion or a revocation is
 * invisible here; and Prisma does not run in the edge runtime this file executes in, so there is no way
 * to read the live value. Rather than gate on a stale claim, the admin decision is made in the two
 * places that can make it honestly - `/admin/users/page.tsx` is a server component that re-reads the
 * role, and every `/api/admin/*` route calls `requireAdmin`. What this layer answers is "is anybody
 * signed in", which is what it is able to answer.
 */
const isProtectedPath = (pathname: string) =>
  pathname.startsWith("/trips") || pathname.startsWith("/users") || pathname.startsWith("/admin");
/**
 * Only the page predicate above was widened for `/users`; this one stays `/api/trips`-scoped.
 *
 * `/api/users` matches neither predicate - `/api/trips` is not a prefix of it, and `/users` is not
 * either, because the path starts with `/api`. It is also kept out of `config.matcher` below, so
 * this file never runs for it at all; the route self-guards with `requireSession` instead - see the
 * comment on its handler for why that is the right place for it.
 *
 * The same holds for Story 5.10's `/api/admin/*`, and for the same reason plus one more: those routes
 * need the *live* role, which only `requireAdmin` can read.
 */
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
    // `:path*` is zero-or-more, so this covers `/users` itself as well as any future subpath.
    "/users/:path*",
    // Story 5.10, same spelling and for the same reason: `/admin` today redirects to `/admin/users`,
    // and both need the signed-out redirect.
    "/admin/:path*",
    "/api/trips",
    "/api/trips/:path((?!import/?$).*)",
    "/auth/first-login-password",
  ],
};
