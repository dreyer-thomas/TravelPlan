import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/login/route";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/bcrypt";
import { verifySessionJwt } from "@/lib/auth/jwt";

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

  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it("returns csrf error envelope when token missing", async () => {
    const request = buildRequest({ email: "user@example.com", password: "strongpassword" }, false);

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("returns validation error envelope", async () => {
    const request = buildRequest({ email: "invalid", password: "short" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("returns invalid credentials for mismatched password", async () => {
    const passwordHash = await hashPassword("correctpassword");
    await prisma.user.create({
      data: {
        email: "login-person@example.com",
        passwordHash,
        role: "OWNER",
      },
    });

    const request = buildRequest({ email: "login-person@example.com", password: "wrongpassword" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("invalid_credentials");
  });

  it("sets a session cookie on successful login", async () => {
    const passwordHash = await hashPassword("correctpassword");
    await prisma.user.create({
      data: {
        email: "login-success@example.com",
        passwordHash,
        role: "OWNER",
        preferredLanguage: "de",
      },
    });

    const request = buildRequest({ email: "login-success@example.com", password: "correctpassword" });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("lang=de");
  });

  it("returns mustChangePassword state for provisioned collaborator accounts", async () => {
    const passwordHash = await hashPassword("correctpassword");
    await prisma.user.create({
      data: {
        email: "invited@example.com",
        passwordHash,
        role: "VIEWER",
        mustChangePassword: true,
      },
    });

    const request = buildRequest({ email: "invited@example.com", password: "correctpassword" });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ userId: string; mustChangePassword: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.mustChangePassword).toBe(true);
  });

  it("stores mustChangePassword in the session jwt for forced-change users", async () => {
    const passwordHash = await hashPassword("correctpassword");
    await prisma.user.create({
      data: {
        email: "forced-session@example.com",
        passwordHash,
        role: "VIEWER",
        mustChangePassword: true,
      },
    });

    const request = buildRequest({ email: "forced-session@example.com", password: "correctpassword" });
    const response = await POST(request);

    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("session=");
    const sessionCookie = setCookie?.match(/session=([^;]+)/)?.[1];
    expect(sessionCookie).toBeTruthy();

    const payload = await verifySessionJwt(sessionCookie ?? "");
    expect(payload.sub).toBeTruthy();
    expect(payload.role).toBe("VIEWER");
    expect(payload.mustChangePassword).toBe(true);
  });
});
