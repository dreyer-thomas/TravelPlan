import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { passwordResetRequestSchema } from "@/lib/validation/authSchemas";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { createPasswordResetToken } from "@/lib/auth/passwordReset";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { describeSendFailure, sendEmail } from "@/lib/notifications/email";
import { dictionaries, formatMessage, translate } from "@/i18n";

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
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, preferredLanguage: true },
    });
    if (user) {
      const rawToken = await createPasswordResetToken(user.id);
      const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
      const resetUrl = new URL("/auth/reset-password", baseUrl);
      resetUrl.searchParams.set("token", rawToken);

      // The account's language, not the `lang` cookie: the address is all the request carries, and
      // the account is what the mail is about.
      const dictionary = dictionaries[user.preferredLanguage];

      // Not awaited, on purpose. Waiting for SMTP would make a known address answer seconds later than
      // an unknown one - which tells the caller the account exists - and a slow server could hold the
      // request open past any timeout. So the answer is the same success either way, at once, and a
      // failed send surfaces only in the journal. The log line names the failure and nothing else: no
      // token, no link, no body, no credentials. (The process is a long-running `next start`, so the
      // send outlives the response.)
      void sendEmail({
        to: email,
        subject: translate(dictionary, "auth.resetEmail.subject"),
        text: formatMessage(translate(dictionary, "auth.resetEmail.body"), { url: resetUrl.toString() }),
      }).catch((error: unknown) => {
        console.error("password-reset/request: reset email not sent", describeSendFailure(error));
      });
    }
  } catch {
    return fail(apiError("server_error", "Unable to start password reset"), 500);
  }

  return ok({ success: true });
};
