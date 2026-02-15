import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { passwordResetRequestSchema } from "@/lib/validation/authSchemas";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { createPasswordResetToken } from "@/lib/auth/passwordReset";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { sendEmail } from "@/lib/notifications/email";

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
    const rate = checkRateLimit(`password-reset-request:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.ok) {
      return fail(apiError("rate_limited", "Too many password reset requests"), 429);
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

  const parsed = passwordResetRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid reset request", parsed.error.flatten()), 400);
  }

  const { email } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const rawToken = await createPasswordResetToken(user.id);
      const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
      const resetUrl = new URL("/auth/reset-password", baseUrl);
      resetUrl.searchParams.set("token", rawToken);

      await sendEmail({
        to: email,
        subject: "Reset your password",
        text: `Use this link to reset your password: ${resetUrl.toString()}`,
      });
    }
  } catch {
    return fail(apiError("server_error", "Unable to start password reset"), 500);
  }

  return ok({ success: true });
};
