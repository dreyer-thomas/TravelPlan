import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { updateLanguageSchema } from "@/lib/validation/userSchemas";
import { LANGUAGE_COOKIE_NAME } from "@/i18n";

const getSessionUserId = async (request: NextRequest) => {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return null;
  }

  try {
    const payload = await verifySessionJwt(token);
    return payload.sub;
  } catch {
    return null;
  }
};

export const PATCH = async (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = updateLanguageSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid language selection", parsed.error.flatten()), 400);
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { preferredLanguage: parsed.data.preferredLanguage },
      select: { id: true, preferredLanguage: true },
    });

    const response = ok({ userId: updated.id, preferredLanguage: updated.preferredLanguage });
    response.cookies.set({
      name: LANGUAGE_COOKIE_NAME,
      value: updated.preferredLanguage,
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch {
    return fail(apiError("server_error", "Unable to update language"), 500);
  }
};
