import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionJwt } from "@/lib/auth/jwt";

const isProtectedPath = (pathname: string) => pathname.startsWith("/trips");
const isHomePath = (pathname: string) => pathname === "/";

const isSessionValid = async (token?: string) => {
  if (!token) {
    return false;
  }

  try {
    await verifySessionJwt(token);
    return true;
  } catch {
    return false;
  }
};

export const middleware = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("session")?.value;

  if (isHomePath(pathname)) {
    if (await isSessionValid(token)) {
      return NextResponse.redirect(new URL("/trips", request.url));
    }
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (!(await isSessionValid(token))) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  return NextResponse.next();
};

export const config = {
  matcher: ["/", "/trips/:path*"],
};
