import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";
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

  it("redirects flagged signed-in users from home to the forced password-change page", async () => {
    const token = await createSessionJwt({ sub: "user-1", role: "owner", mustChangePassword: true });
    const request = new NextRequest("http://localhost/", {
      headers: {
        cookie: `session=${token}`,
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/first-login-password");
  });

  it("keeps signed-out users on home", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);

    expect(response.status).toBe(200);
  });

  it("redirects flagged users away from protected trip pages", async () => {
    const token = await createSessionJwt({ sub: "user-1", role: "owner", mustChangePassword: true });
    const request = new NextRequest("http://localhost/trips/123", {
      headers: {
        cookie: `session=${token}`,
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/first-login-password");
  });

  it("allows flagged users to reach the forced password-change page", async () => {
    const token = await createSessionJwt({ sub: "user-1", role: "owner", mustChangePassword: true });
    const request = new NextRequest("http://localhost/auth/first-login-password", {
      headers: {
        cookie: `session=${token}`,
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(200);
  });

  it("redirects signed-out users to /auth/login for the registered-users page", async () => {
    const request = new NextRequest("http://localhost/users");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/login");
  });

  it("redirects flagged users away from the registered-users page", async () => {
    const token = await createSessionJwt({ sub: "user-1", role: "owner", mustChangePassword: true });
    const request = new NextRequest("http://localhost/users", {
      headers: {
        cookie: `session=${token}`,
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/first-login-password");
  });

  it("returns 403 json for flagged users hitting trip apis", async () => {
    const token = await createSessionJwt({ sub: "user-1", role: "owner", mustChangePassword: true });
    const request = new NextRequest("http://localhost/api/trips/trip-1", {
      headers: {
        cookie: `session=${token}`,
      },
    });
    const response = await middleware(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("password_change_required");
  });
});

/**
 * Which paths Next will actually run the middleware for.
 *
 * Every test above calls `middleware()` directly, which says nothing about the matcher - and the
 * matcher is the whole of Story 2.34 AC4. `/api/trips/import` has to be excluded, because Next
 * buffers the request body in memory for any path it covers and that buffer is the copy the story's
 * streaming read would otherwise have been sitting behind. Everything else has to stay covered, and
 * "the exclusion quietly widened" is precisely how that breaks.
 *
 * `getMiddlewareMatchers` is Next's own compiler for the `matcher` config, so this asserts against
 * what the framework will do with the strings rather than against the strings themselves.
 */
describe("middleware matcher", () => {
  // `getMiddlewareMatchers` is a build internal and is not in Next's public type declarations, so the
  // shape is asserted here rather than imported. It is the same function `next build` runs over the
  // `matcher` array, which is the only reason this test is worth anything.
  type MatcherCompiler = (matcher: string[], nextConfig: object) => { regexp: string }[];

  const compileMatchers = async () => {
    const nextInternals = (await import("next/dist/build/analysis/get-page-static-info")) as unknown as {
      getMiddlewareMatchers: MatcherCompiler;
    };
    // The project's own config, not `{}`: `basePath` and `trailingSlash` change the regexps this
    // function emits, so compiling against an empty object would keep asserting an exclusion that
    // production had already lost - which is the failure this test exists to catch.
    const nextConfig = (await import("../next.config")).default;
    return nextInternals.getMiddlewareMatchers(config.matcher, nextConfig);
  };

  const matches = async (pathname: string) =>
    (await compileMatchers()).some((matcher) => new RegExp(matcher.regexp).test(pathname));

  it("skips the import route so Next does not buffer its body", async () => {
    expect(await matches("/api/trips/import")).toBe(false);
  });

  it("skips the trailing-slash spelling of the import route as well", async () => {
    // Same route, same body, one character apart: `(?!import$)` excluded only the bare path, so
    // `/api/trips/import/` was still matched and would still have been buffered.
    expect(await matches("/api/trips/import/")).toBe(false);
  });

  it("still covers every other trip api, including the collection itself", async () => {
    for (const pathname of [
      "/api/trips",
      "/api/trips/trip-1",
      "/api/trips/trip-1/export",
      "/api/trips/trip-1/hero-image",
      "/api/trips/trip-1/days/day-1/image",
      "/api/trips/trip-1/bucket-list-items",
      "/api/trips/trip-1/members",
    ]) {
      expect(await matches(pathname), pathname).toBe(true);
    }
  });

  it("still covers the pages and the forced password-change route", async () => {
    for (const pathname of ["/", "/trips", "/trips/trip-1", "/users", "/auth/first-login-password"]) {
      expect(await matches(pathname), pathname).toBe(true);
    }
  });

  it("does not pull the registered-users api in behind the page entry", async () => {
    // `/users/:path*` guards the page. The endpoint self-guards with `requireSession` and must stay
    // out of the matcher, or the middleware's page-redirect branch starts answering an API call.
    expect(await matches("/api/users")).toBe(false);
  });
});
