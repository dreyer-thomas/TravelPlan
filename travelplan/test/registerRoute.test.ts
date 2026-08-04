import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { POST } from "@/app/api/auth/register/route";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (body: Record<string, unknown>) => {
  const csrfToken = "test-csrf-token";
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      cookie: `csrf_token=${csrfToken}`,
    },
    body: JSON.stringify(body),
  });
};

describe("POST /api/auth/register", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it("returns a duplicate email error envelope", async () => {
    const firstRequest = buildRequest({
      email: "person@example.com",
      password: "strongpassword",
      consent: true,
    });

    const firstResponse = await POST(firstRequest);
    expect(firstResponse.status).toBe(200);

    const duplicateRequest = buildRequest({
      email: "person@example.com",
      password: "strongpassword",
      consent: true,
    });

    const duplicateResponse = await POST(duplicateRequest);
    const payload = (await duplicateResponse.json()) as ApiEnvelope<null>;

    expect(duplicateResponse.status).toBe(409);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("email_exists");
  });

  it("returns validation error envelope", async () => {
    const request = buildRequest({
      email: "invalid",
      password: "short",
      consent: true,
    });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  /**
   * Story 5.10, AC8b. The fresh-installation half of the bootstrap.
   *
   * This is the only path that can ever produce the first `ADMIN` on a system nobody has an account
   * on, and it can never fire on Tommy's production instance, where the table is not empty. So this
   * suite is the *only* place the behaviour is ever exercised - AC8c's `admin:grant` is what
   * production actually uses.
   */
  describe("story 5.10 first-registration bootstrap", () => {
    const register = async (email: string) => {
      const response = await POST(buildRequest({ email, password: "strongpassword", consent: true }));
      const payload = (await response.json()) as ApiEnvelope<{ userId: string }>;
      return { response, payload };
    };

    it("promotes the first account on an empty system to ADMIN", async () => {
      const { response, payload } = await register("first@example.com");

      expect(response.status).toBe(200);
      const created = await prisma.user.findUniqueOrThrow({ where: { id: payload.data!.userId } });
      expect(created.role).toBe("ADMIN");
    });

    it("leaves every registration after the first an OWNER", async () => {
      await register("first@example.com");
      const { payload } = await register("second@example.com");

      const second = await prisma.user.findUniqueOrThrow({ where: { id: payload.data!.userId } });
      expect(second.role).toBe("OWNER");
      // And the first one is not retroactively demoted by the second registration.
      const first = await prisma.user.findUniqueOrThrow({ where: { email: "first@example.com" } });
      expect(first.role).toBe("ADMIN");
    });

    /**
     * The condition is "the table is empty", not "no admin exists". An installation bootstrapped by
     * hand (AC8c) that later has its admin role revoked must not hand `ADMIN` to the next stranger
     * who reaches `/auth/register` - the table is no longer empty, so the window is closed for good.
     */
    it("does not promote a newcomer on a populated system that happens to have no admin", async () => {
      await prisma.user.create({
        data: { email: "existing@example.com", passwordHash: "hashed", role: "OWNER" },
      });

      const { payload } = await register("newcomer@example.com");

      const created = await prisma.user.findUniqueOrThrow({ where: { id: payload.data!.userId } });
      expect(created.role).toBe("OWNER");
    });

    /**
     * Trap 3b: "count the users, then insert" is a race - two requests can both read zero. The promotion
     * has to be decided inside the same transaction as the insert.
     *
     * Two registrations fired without awaiting the first, which is the closest a single-process test can
     * get to the real thing. `better-sqlite3` is synchronous and serialises the transactions, so this
     * cannot *prove* the absence of the race under a concurrent driver; what it does prove is that the
     * count is not read from outside the write, which is the property Trap 3b names. The exactly-one
     * assertion is the invariant either way.
     */
    it("promotes exactly one account when two registrations start together", async () => {
      await Promise.all([register("race-a@example.com"), register("race-b@example.com")]);

      const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
      expect(admins).toHaveLength(1);
      expect(await prisma.user.count()).toBe(2);
    });

    it("signs the first account in with the role it was actually given", async () => {
      const { response } = await register("first@example.com");

      // The JWT is a snapshot (Trap 6), so the promotion has to be visible in the token minted by this
      // very request - otherwise the founding admin would have to sign out and back in to use the
      // surface they were just given.
      const cookie = response.headers.get("set-cookie") ?? "";
      const token = /session=([^;]+)/.exec(cookie)?.[1];
      expect(token).toBeTruthy();
      const { verifySessionJwt } = await import("@/lib/auth/jwt");
      expect((await verifySessionJwt(token!)).role).toBe("ADMIN");
    });
  });
});
