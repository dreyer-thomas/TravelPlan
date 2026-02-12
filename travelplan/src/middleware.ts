import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionJwt } from "@/lib/auth/jwt";

const isProtectedPath = (pathname: string) => pathname.startsWith("/trips");

export const middleware = async (request: NextRequest) => {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  try {
    await verifySessionJwt(token);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
};

export const config = {
  matcher: ["/trips/:path*"],
};
