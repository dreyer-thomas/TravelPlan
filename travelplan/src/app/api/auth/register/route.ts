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
    /**
     * Story 5.10, AC8b: on a system with **no accounts at all**, the first registration becomes the
     * administrator. Every registration after that stays `OWNER`, exactly as before.
     *
     * The emptiness check is inside the same transaction as the insert, and that placement is the whole
     * point (Trap 3b): "count the users, then insert" is a race in which two requests both read zero and
     * both get promoted.
     *
     * What actually forecloses that race here is worth stating precisely, because the obvious answer is
     * wrong. This database is `journal_mode=delete` - a rollback journal, not WAL - so two deferred
     * transactions that both read zero do **not** resolve by one cleanly waiting for the other: one takes
     * `SQLITE_BUSY` on its `INSERT` or on the other's `COMMIT`. The real guarantee is that `better-sqlite3`
     * is synchronous and single-process, so within one server the two transactions cannot interleave at all.
     * Either way no second `ADMIN` is ever committed, which is what AC8b asks; the losing request is refused
     * rather than promoted. A second process writing the same file - a rolling deploy, or a driver swap to
     * something asynchronous - would leave the `SQLITE_BUSY` path as the only thing standing between two
     * simultaneous first registrations, so it is handled below rather than assumed away.
     *
     * The condition is "the table is empty", not "no admin exists". An installation whose admin role was
     * later revoked must not hand `ADMIN` to the next stranger who reaches `/auth/register`; once any row
     * exists this window is closed for good. On Tommy's production instance it was never open.
     *
     * `hashPassword` stays outside: bcrypt takes ~100ms and holding a SQLite write transaction open
     * across it would serialise every concurrent registration behind it.
     *
     * Note the open window this does create on a genuinely fresh deployment (Trap 3): `/auth/register`
     * requires only CSRF - no invite token, no allowlist - so whoever reaches it first becomes the
     * administrator. That is the standard first-run pattern and it closes the moment the operator
     * registers, but it is a real property of AC8b and is written into the deployment note in the story's
     * Dev Agent Record rather than left to be discovered.
     */
    user = await prisma.$transaction(async (tx) => {
      // `findFirst` rather than `count()`: the question is "is there any row", which stops at the first
      // one instead of walking the table.
      const anyExistingAccount = await tx.user.findFirst({ select: { id: true } });

      return tx.user.create({
        data: {
          email,
          passwordHash,
          role: anyExistingAccount === null ? "ADMIN" : "OWNER",
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(apiError("email_exists", "An account already exists for this email"), 409);
    }
    // Everything else answers in the envelope rather than escaping. `throw error` predates Story 5.10, but
    // the `$transaction` above does not, and it brings failure modes a single `create` did not have: write-lock
    // contention (`SQLITE_BUSY`) and Prisma's 5 s interactive-transaction timeout (`P2028`). Rethrown, those
    // reach the client as Next's generic 500 HTML - and every caller of this endpoint parses `{ data, error }`,
    // so an unparseable body is a second failure on top of the first. A registration that lost a race is worth
    // retrying, which the client can only be told in a shape it can read.
    console.error("register: account creation failed", error);
    return fail(apiError("server_error", "Unable to create the account"), 500);
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
