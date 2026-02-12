import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf";
import { ok } from "@/lib/http/response";

export const GET = async () => {
  const token = createCsrfToken();
  const response = ok({ csrfToken: token });
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
