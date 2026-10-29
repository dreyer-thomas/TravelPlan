import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/first-login-password/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt, verifySessionJwt } from "@/lib/auth/jwt";
import { hashPassword, verifyPassword } from "@/lib/auth/bcrypt";
import { issueAccessToken } from "./helpers/mcpClient";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (
  body: Record<string, unknown>,
  options?: { session?: string; includeCsrf?: boolean }
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  if (options?.includeCsrf !== false) {
    const csrfToken = "test-csrf-token";
    headers["x-csrf-token"] = csrfToken;
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${csrfToken}` : `csrf_token=${csrfToken}`;
  }

  return new NextRequest("http://localhost/api/auth/first-login-password", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("POST /api/auth/first-login-password", () => {
  beforeEach(async () => {
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns 401 when the session is missing", async () => {
    const request = buildRequest({ password: "newpassword" }, { includeCsrf: true });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("returns 403 when csrf validation fails", async () => {
    const user = await prisma.user.create({
      data: {
        email: "csrf-first-login@example.com",
        passwordHash: await hashPassword("oldpassword"),
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });
    const request = buildRequest({ password: "newpassword" }, { session, includeCsrf: false });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("returns validation details for an invalid password", async () => {
    const user = await prisma.user.create({
      data: {
        email: "invalid-first-login@example.com",
        passwordHash: await hashPassword("oldpassword"),
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });
    const request = buildRequest({ password: "short" }, { session });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed?.mustChangePassword).toBe(true);
    expect(await verifyPassword("oldpassword", refreshed?.passwordHash ?? "")).toBe(true);
  });

  it("rejects reusing the temporary password", async () => {
    const user = await prisma.user.create({
      data: {
        email: "same-first-login@example.com",
        passwordHash: await hashPassword("temporary-password"),
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });
    const request = buildRequest({ password: "temporary-password" }, { session });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(payload.error?.details).toEqual({
      fieldErrors: {
        password: ["New password must be different from the temporary password"],
      },
    });

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed?.mustChangePassword).toBe(true);
    expect(await verifyPassword("temporary-password", refreshed?.passwordHash ?? "")).toBe(true);
  });

  it("updates the password, clears mustChangePassword, and reissues the session", async () => {
    const user = await prisma.user.create({
      data: {
        email: "success-first-login@example.com",
        passwordHash: await hashPassword("oldpassword"),
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });
    const request = buildRequest({ password: "newpassword" }, { session });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean; mustChangePassword: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data).toEqual({ success: true, mustChangePassword: false });

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed?.mustChangePassword).toBe(false);
    expect(await verifyPassword("newpassword", refreshed?.passwordHash ?? "")).toBe(true);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("session=");
    const updatedSession = setCookie?.match(/session=([^;]+)/)?.[1];
    const sessionPayload = await verifySessionJwt(updatedSession ?? "");
    expect(sessionPayload.mustChangePassword).toBe(false);
  });

  /** Story 15.3 (NFR14): the forced password change ends every connector connection of the user. */
  it("revokes all of the user's connector tokens and nobody else's", async () => {
    const user = await prisma.user.create({
      data: {
        email: "tokens-first-login@example.com",
        passwordHash: await hashPassword("oldpassword"),
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const other = await prisma.user.create({
      data: { email: "tokens-first-login-other@example.com", passwordHash: await hashPassword("oldpassword"), role: "VIEWER" },
    });
    await issueAccessToken(user.id);
    await issueAccessToken(user.id);
    await issueAccessToken(other.id);

    const session = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });
    const response = await POST(buildRequest({ password: "newpassword" }, { session }));

    expect(response.status).toBe(200);
    expect(await prisma.oAuthToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.oAuthToken.count({ where: { userId: other.id, revokedAt: null } })).toBe(2);
  });
});
