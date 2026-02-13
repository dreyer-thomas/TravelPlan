import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/users/me/language/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

const buildRequest = (body: Record<string, unknown>, options?: { csrf?: boolean; session?: string }) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const cookies: string[] = [];
  if (options?.csrf !== false) {
    const csrfToken = "test-csrf-token";
    headers["x-csrf-token"] = csrfToken;
    cookies.push(`csrf_token=${csrfToken}`);
  }

  if (options?.session) {
    cookies.push(`session=${options.session}`);
  }

  if (cookies.length > 0) {
    headers.cookie = cookies.join("; ");
  }

  return new NextRequest("http://localhost/api/users/me/language", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
};

describe("PATCH /api/users/me/language", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it("updates preferred language for authenticated user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "language-user@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest({ preferredLanguage: "de" }, { session: token });
    const response = await PATCH(request);
    const payload = (await response.json()) as ApiEnvelope<{ userId: string; preferredLanguage: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.preferredLanguage).toBe("de");
    expect(response.headers.get("set-cookie")).toContain("lang=de");

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.preferredLanguage).toBe("de");
  });

  it("rejects unauthenticated requests", async () => {
    const request = buildRequest({ preferredLanguage: "en" });
    const response = await PATCH(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects invalid language", async () => {
    const user = await prisma.user.create({
      data: {
        email: "language-invalid@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest({ preferredLanguage: "fr" }, { session: token });
    const response = await PATCH(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });
});
