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

export const config = {
  matcher: ["/", "/trips/:path*", "/api/trips/:path*", "/auth/first-login-password"],
};
