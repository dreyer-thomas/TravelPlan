import type { NextResponse } from "next/server";

export const setSessionCookie = (response: NextResponse, token: string) => {
  response.cookies.set({
    name: "session",
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
};
