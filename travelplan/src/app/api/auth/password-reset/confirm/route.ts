import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { passwordResetConfirmSchema } from "@/lib/validation/authSchemas";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { getPasswordResetToken } from "@/lib/auth/passwordReset";
import { hashPassword } from "@/lib/auth/bcrypt";
import { checkRateLimit } from "@/lib/security/rateLimit";

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
    const rate = checkRateLimit(`password-reset-confirm:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.ok) {
      return fail(apiError("rate_limited", "Too many password reset attempts"), 429);
    }
  }

  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = passwordResetConfirmSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid reset details", parsed.error.flatten()), 400);
  }

  const { token, password } = parsed.data;
  const resetToken = await getPasswordResetToken(token);
  if (!resetToken || resetToken.used) {
    return fail(apiError("token_invalid", "Reset token is invalid"), 400);
  }

  if (resetToken.expiresAt <= new Date()) {
    return fail(apiError("token_expired", "Reset token has expired"), 400);
  }

  const passwordHash = await hashPassword(password);

  try {
    const now = new Date();
    const [userUpdate] = await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, used: false },
        data: { used: true, usedAt: now },
      }),
    ]);
    if (userUpdate.count === 0) {
      return fail(apiError("token_invalid", "Reset token is invalid"), 400);
    }
  } catch {
    return fail(apiError("server_error", "Unable to reset password"), 500);
  }

  return ok({ success: true });
};
