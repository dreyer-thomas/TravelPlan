import { cookies } from "next/headers";
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf";
import { ok } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export const GET = async () => {
  const cookieStore = await cookies();
  const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  const token = existing ?? createCsrfToken();
  const response = ok({ csrfToken: token });
  response.headers.set("Cache-Control", "no-store, max-age=0");
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
