import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/logout/route";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = () => {
  const csrfToken = "test-csrf-token";
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: {
      "x-csrf-token": csrfToken,
      cookie: `csrf_token=${csrfToken}`,
    },
  });
};

const buildInvalidRequest = () =>
  new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: {
      "x-csrf-token": "header-token",
      cookie: "csrf_token=cookie-token",
    },
  });

describe("POST /api/auth/logout", () => {
  it("clears the session cookie and returns success envelope", async () => {
    const response = await POST(buildRequest());
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.data?.success).toBe(true);
    expect(payload.error).toBeNull();

    const setCookie = response.headers.get("set-cookie") ?? "";
    const normalized = setCookie.toLowerCase();
    expect(normalized).toContain("session=");
    expect(normalized).toContain("max-age=0");
  });

  it("returns 403 with error envelope when CSRF validation fails", async () => {
    const response = await POST(buildInvalidRequest());
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });
});
