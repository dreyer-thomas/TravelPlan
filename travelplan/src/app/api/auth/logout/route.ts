import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { clearSessionCookie } from "@/lib/auth/session";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";

export const POST = async (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const response = ok({ success: true });
  clearSessionCookie(response);

  return response;
};
