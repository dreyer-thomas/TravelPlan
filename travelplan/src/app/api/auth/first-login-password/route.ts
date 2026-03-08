import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { firstLoginPasswordSchema } from "@/lib/validation/authSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { prisma } from "@/lib/db/prisma";
import { buildPasswordUpdateData } from "@/lib/auth/passwordUpdate";
import { createSessionJwt } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/bcrypt";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
};

export const POST = async (request: NextRequest) => {
  const ip = getClientIp(request);
  if (ip !== "unknown") {
    const rate = checkRateLimit(`first-login-password:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.ok) {
      return fail(apiError("rate_limited", "Too many password change attempts"), 429);
    }
  }

  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request, { allowPasswordChangeRequired: true });
  if (auth.response) {
    return auth.response;
  }

  if (!auth.session.mustChangePassword) {
    return fail(apiError("password_change_not_required", "Password change is not required"), 400);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = firstLoginPasswordSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid password details", parsed.error.flatten()), 400);
  }

  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: auth.session.sub },
      select: { passwordHash: true },
    });
    if (!currentUser) {
      return fail(apiError("unauthorized", "Authentication required"), 401);
    }

    const isSamePassword = await verifyPassword(parsed.data.password, currentUser.passwordHash);
    if (isSamePassword) {
      return fail(
        apiError("validation_error", "Invalid password details", {
          fieldErrors: {
            password: ["New password must be different from the temporary password"],
          },
        }),
        400,
      );
    }

    const passwordUpdateData = await buildPasswordUpdateData({ password: parsed.data.password });
    await prisma.user.update({
      where: { id: auth.session.sub },
      data: passwordUpdateData,
    });

    const token = await createSessionJwt({
      sub: auth.session.sub,
      role: auth.session.role,
      mustChangePassword: false,
    });

    const response = ok({ success: true, mustChangePassword: false });
    setSessionCookie(response, token);
    return response;
  } catch {
    return fail(apiError("server_error", "Unable to update password"), 500);
  }
};
