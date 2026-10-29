import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { createSessionJwt } from "@/lib/auth/jwt";
import {
  authorizeQuery,
  CLAUDE_CODE_CLIENT_ID,
  createUser,
  HOSTED_REDIRECT,
  ISSUER,
  setupConnectorEnvironment,
} from "./helpers/oauthFixtures";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const { default: OAuthAuthorizePage } = await import("@/app/(auth)/oauth/authorize/page");

setupConnectorEnvironment();

const render = (params: URLSearchParams) =>
  OAuthAuthorizePage({ searchParams: Promise.resolve(Object.fromEntries(params.entries())) });

const propsOf = (element: unknown) => {
  expect(isValidElement(element)).toBe(true);
  return (element as ReactElement<Record<string, unknown>>).props;
};

beforeEach(() => {
  cookieJar.clear();
});

describe("/oauth/authorize page", () => {
  it("is not found while the connector is off", async () => {
    process.env.MCP_ENABLED = "false";
    await expect(render(authorizeQuery())).rejects.toThrow("NOT_FOUND");
  });

  it("renders an error card and never redirects for a disallowed client or an unregistered redirect", async () => {
    const badClient = propsOf(await render(authorizeQuery({ client_id: "https://evil.example/client" })));
    expect(badClient).toEqual({ mode: "error", reason: "client_not_allowed" });
    const badRedirect = propsOf(await render(authorizeQuery({ redirect_uri: "https://evil.example/cb" })));
    expect(badRedirect).toEqual({ mode: "error", reason: "invalid_redirect_uri" });
  });

  it("redirects later errors back to the client with state and iss", async () => {
    await expect(render(authorizeQuery({ code_challenge_method: "plain" }))).rejects.toThrow(
      new RegExp(`^REDIRECT:${HOSTED_REDIRECT.replace(/[/.]/g, "\\$&")}\\?.*error=invalid_request.*state=state-123.*iss=`),
    );
  });

  it("sends a signed-out visitor through the login page with returnTo", async () => {
    const query = authorizeQuery();
    try {
      await render(query);
      throw new Error("expected a redirect");
    } catch (error) {
      const message = (error as Error).message;
      expect(message.startsWith("REDIRECT:/auth/login?returnTo=")).toBe(true);
      const returnTo = new URLSearchParams(message.slice("REDIRECT:/auth/login?".length)).get("returnTo");
      expect(returnTo).toBe(`/oauth/authorize?${query.toString()}`);
    }
  });

  it("treats a session that must change its password as signed out", async () => {
    const user = await createUser({ mustChangePassword: true });
    cookieJar.set("session", await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true }));
    await expect(render(authorizeQuery())).rejects.toThrow(/^REDIRECT:\/auth\/login\?returnTo=/);
  });

  it("shows the consent card with the client host and the redirect host", async () => {
    const user = await createUser();
    cookieJar.set("session", await createSessionJwt({ sub: user.id, role: user.role }));
    const props = propsOf(await render(authorizeQuery()));
    expect(props).toMatchObject({
      mode: "consent",
      clientName: "Claude",
      clientHost: "claude.ai",
      redirectHost: "claude.ai",
      email: user.email,
      loopbackOnly: false,
    });
    expect(new URLSearchParams(props.query as string).get("state")).toBe("state-123");
  });

  it("flags a loopback-only client for the warning", async () => {
    const user = await createUser();
    cookieJar.set("session", await createSessionJwt({ sub: user.id, role: user.role }));
    const props = propsOf(
      await render(authorizeQuery({ client_id: CLAUDE_CODE_CLIENT_ID, redirect_uri: "http://127.0.0.1:43123/callback" })),
    );
    expect(props).toMatchObject({ mode: "consent", redirectHost: "127.0.0.1:43123", loopbackOnly: true });
    expect(ISSUER).toBe("https://plan.example.test");
  });
});
