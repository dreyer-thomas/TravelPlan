import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware auth guard", () => {
  it("redirects signed-out users to /auth/login for protected routes", async () => {
    const request = new NextRequest("http://localhost/trips/123");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/login");
  });
});
