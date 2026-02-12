import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loginSchema } from "@/lib/validation/authSchemas";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { verifyPassword } from "@/lib/auth/bcrypt";
import { createSessionJwt } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const DUMMY_PASSWORD_HASH = "$2b$12$yKCcHe7jK2n4NHvOoOULDO543C1um0.nfo6rMRdS2SW5IYceExTYe";

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? request.ip ?? "unknown";
};

export const POST = async (request: NextRequest) => {
  const ip = getClientIp(request);
  if (ip !== "unknown") {
    const rate = checkRateLimit(`login:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.ok) {
      return fail(apiError("rate_limited", "Too many login attempts"), 429);
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

  const parsed = loginSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid login details", parsed.error.flatten()), 400);
  }

  const { email, password } = parsed.data;

  let user: { id: string; passwordHash: string; role: string } | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true },
    });
  } catch {
    return fail(apiError("server_error", "Unable to validate credentials"), 500);
  }

  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    return fail(apiError("invalid_credentials", "Invalid email or password"), 401);
  }

  let token: string;
  try {
    token = await createSessionJwt({ sub: user.id, role: user.role });
  } catch {
    return fail(apiError("server_error", "Unable to create session"), 500);
  }

  const response = ok({ userId: user.id });
  setSessionCookie(response, token);

  return response;
};
