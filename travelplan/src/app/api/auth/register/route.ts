import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { registerSchema } from "@/lib/validation/authSchemas";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hashPassword } from "@/lib/auth/bcrypt";
import { createSessionJwt } from "@/lib/auth/jwt";
import { setSessionCookie } from "@/lib/auth/session";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { Prisma } from "@/generated/prisma/client";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
};

export const POST = async (request: NextRequest) => {
  const ip = getClientIp(request);
  const rate = checkRateLimit(`register:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rate.ok) {
    return fail(apiError("rate_limited", "Too many registration attempts"), 429);
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

  const parsed = registerSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid registration details", parsed.error.flatten()), 400);
  }

  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return fail(apiError("email_exists", "An account already exists for this email"), 409);
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: "OWNER",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(apiError("email_exists", "An account already exists for this email"), 409);
    }
    throw error;
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
