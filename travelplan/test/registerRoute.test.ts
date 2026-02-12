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
});
