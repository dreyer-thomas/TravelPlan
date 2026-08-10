import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/auth/csrf/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { CSRF_COOKIE_NAME } from "@/lib/security/csrf";

/**
 * `/api/auth/csrf`'s side of DW-128: the additive `authenticated` flag the header menu revalidates
 * against, and the four things about this route that must not have changed while it gained one.
 *
 * `next/headers` is mocked because `cookies()` can only be called inside a Next request scope, which a
 * unit test has no way to enter - the *route's* own reading of the csrf cookie is what that stubs, and it
 * is deliberately kept as the route's mechanism rather than switched to `request.cookies`: the flag was
 * meant to be an addition, not a rewrite of the token path. The mock's return value is per-test state so
 * the "an existing token is reused" case can still be covered.
 */
const csrfCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === CSRF_COOKIE_NAME && csrfCookie.value ? { name, value: csrfCookie.value } : undefined),
  }),
}));

// Reset here rather than at the end of the one test that sets it: an assertion that throws mid-test would
// otherwise leak `existing-token` into every test declared after it, and the suite's correctness would
// quietly depend on that test staying last.
afterEach(() => {
  csrfCookie.value = undefined;
});

/**
 * A well-formed token that has expired - the exact input the whole feature exists for, and the one
 * `createSessionJwt` cannot produce: it hard-codes `7d`. Signed with the same secret, so this exercises
 * `jwtVerify`'s `exp` rejection rather than a signature failure, which is a different code path.
 */
const expiredSessionJwt = async () =>
  new SignJWT({ sub: "user-1", role: "USER" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));

type CsrfEnvelope = {
  data: { csrfToken: string; authenticated?: boolean } | null;
  error: { code: string; message: string } | null;
};

const call = async (sessionCookie?: string) => {
  const headers: Record<string, string> = {};
  if (sessionCookie !== undefined) {
    headers.cookie = `session=${sessionCookie}`;
  }

  const response = await GET(new NextRequest("http://localhost/api/auth/csrf", { method: "GET", headers }));

  return { response, payload: (await response.json()) as CsrfEnvelope };
};

describe("GET /api/auth/csrf", () => {
  it("reports a verifiable session as authenticated", async () => {
    const session = await createSessionJwt({ sub: "user-1", role: "USER" });

    const { response, payload } = await call(session);

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.authenticated).toBe(true);
  });

  /**
   * The flag means what `AppHeader.resolveAuthState` means by `isAuthenticated` - a session cookie
   * `verifySessionJwt` accepts - and nothing more. A caller who must change their password has one, and the
   * header menu is how they sign out again, so `mustChangePassword` must not read as signed out here.
   */
  it("counts a session that must change its password as authenticated", async () => {
    const session = await createSessionJwt({ sub: "user-1", role: "USER", mustChangePassword: true });

    const { payload } = await call(session);

    expect(payload.data?.authenticated).toBe(true);
  });

  /**
   * The route must stay reachable without a session: `/auth/login`, `/auth/forgot-password` and
   * `/auth/first-login-password` all post with a token they got from here, so the answer is `false` plus a
   * token - never a 401.
   */
  it("issues a token to an anonymous caller and reports it as not authenticated", async () => {
    const { response, payload } = await call();

    expect(response.status).toBe(200);
    expect(payload.data?.authenticated).toBe(false);
    expect(payload.data?.csrfToken).toBeTruthy();
    // The cookie write and the cache header are the two things this change was forbidden to touch.
    expect(response.cookies.get(CSRF_COOKIE_NAME)?.value).toBe(payload.data?.csrfToken);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  /**
   * The body varies by cookie now, so the two properties that keep an unauthenticated, CSRF-exempt endpoint
   * from becoming a cross-site "is this visitor signed in" oracle are pinned rather than assumed: nothing
   * shared may cache it per-URL, and no origin may read it cross-site. Both hold today by construction -
   * which is exactly why they are worth a test, because neither is enforced by anything a future CORS or
   * edge-cache config would have to argue with.
   */
  it("declares that the body varies by cookie, and grants no cross-origin reader", async () => {
    const { response } = await call(await createSessionJwt({ sub: "user-1", role: "USER" }));

    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  /**
   * DW-128's motivating case, stated as its own test: a tab left open until its session expired. Every
   * other negative here is a *missing* or malformed cookie, which is not what the entry describes.
   */
  it("reports an expired session as not authenticated, and still issues a token", async () => {
    const { response, payload } = await call(await expiredSessionJwt());

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.authenticated).toBe(false);
    expect(payload.data?.csrfToken).toBeTruthy();
  });

  it("reports an unverifiable session cookie as not authenticated, without failing the request", async () => {
    const { response, payload } = await call("not-a-jwt");

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.authenticated).toBe(false);
    expect(payload.data?.csrfToken).toBeTruthy();
  });

  it("still reuses the token already in the cookie jar", async () => {
    csrfCookie.value = "existing-token";

    const { payload } = await call();

    expect(payload.data?.csrfToken).toBe("existing-token");
  });
});
