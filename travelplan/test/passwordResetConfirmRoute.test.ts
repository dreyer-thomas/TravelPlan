import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/password-reset/confirm/route";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/bcrypt";
import { createPasswordResetToken, hashPasswordResetToken } from "@/lib/auth/passwordReset";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (body: Record<string, unknown>, includeCsrf = true) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (includeCsrf) {
    const csrfToken = "test-csrf-token";
    headers["x-csrf-token"] = csrfToken;
    headers.cookie = `csrf_token=${csrfToken}`;
  }

  return new NextRequest("http://localhost/api/auth/password-reset/confirm", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("POST /api/auth/password-reset/confirm", () => {
  beforeEach(async () => {
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns csrf error envelope when token missing", async () => {
    const request = buildRequest({ token: "some-token", password: "newpassword" }, false);

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects invalid token and leaves password unchanged", async () => {
    const originalHash = await hashPassword("oldpassword");
    const user = await prisma.user.create({
      data: {
        email: "reset-invalid@example.com",
        passwordHash: originalHash,
        role: "OWNER",
      },
    });

    const request = buildRequest({ token: "invalid-token", password: "newpassword" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("token_invalid");

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed).not.toBeNull();
    expect(await verifyPassword("oldpassword", refreshed?.passwordHash ?? "")).toBe(true);
  });

  it("rejects expired token", async () => {
    const originalHash = await hashPassword("oldpassword");
    const user = await prisma.user.create({
      data: {
        email: "reset-expired@example.com",
        passwordHash: originalHash,
        role: "OWNER",
      },
    });

    const rawToken = "expired-token";
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashPasswordResetToken(rawToken),
        expiresAt: new Date(Date.now() - 60_000),
        used: false,
      },
    });

    const request = buildRequest({ token: rawToken, password: "newpassword" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("token_expired");

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed).not.toBeNull();
    expect(await verifyPassword("oldpassword", refreshed?.passwordHash ?? "")).toBe(true);
  });

  it("updates password and marks token used", async () => {
    const user = await prisma.user.create({
      data: {
        email: "reset-success@example.com",
        passwordHash: await hashPassword("oldpassword"),
        role: "OWNER",
      },
    });

    const rawToken = await createPasswordResetToken(user.id);

    const request = buildRequest({ token: rawToken, password: "newpassword" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.success).toBe(true);

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed).not.toBeNull();
    expect(await verifyPassword("newpassword", refreshed?.passwordHash ?? "")).toBe(true);

    const storedToken = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(storedToken?.used).toBe(true);
    expect(storedToken?.usedAt).not.toBeNull();
  });
});
