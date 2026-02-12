import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/password-reset/request/route";
import { prisma } from "@/lib/db/prisma";

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

  return new NextRequest("http://localhost/api/auth/password-reset/request", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("POST /api/auth/password-reset/request", () => {
  beforeEach(async () => {
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns csrf error envelope when token missing", async () => {
    const request = buildRequest({ email: "user@example.com" }, false);

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("returns success envelope even when email is unknown", async () => {
    const request = buildRequest({ email: "unknown@example.com" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.success).toBe(true);

    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(0);
  });

  it("creates a reset token for a known email", async () => {
    await prisma.user.create({
      data: {
        email: "known@example.com",
        passwordHash: "hashed-password",
        role: "OWNER",
      },
    });

    const request = buildRequest({ email: "known@example.com" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.success).toBe(true);

    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].used).toBe(false);
  });
});
