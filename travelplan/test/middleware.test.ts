import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { createSessionJwt } from "@/lib/auth/jwt";

describe("middleware auth guard", () => {
  it("redirects signed-out users to /auth/login for protected routes", async () => {
    const request = new NextRequest("http://localhost/trips/123");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/login");
  });

  it("redirects signed-in users from home to /trips", async () => {
    const token = await createSessionJwt({ sub: "user-1", role: "owner" });
    const request = new NextRequest("http://localhost/", {
      headers: {
        cookie: `session=${token}`,
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/trips");
  });

  it("keeps signed-out users on home", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);

    expect(response.status).toBe(200);
  });
});
