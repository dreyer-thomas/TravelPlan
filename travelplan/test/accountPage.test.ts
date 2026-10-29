import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import AccountSummary from "@/components/features/account/AccountSummary";
import ConnectedApps from "@/components/features/account/ConnectedApps";

/**
 * Story 15.3. `/account` shows who is signed in, and *Connected apps* only while the connector is on. The
 * cookie jar and `notFound` are replaced as in `adminAiUsagePage.test.ts`; the email read is the real one.
 */
const state = vi.hoisted(() => ({ session: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "session" && state.session ? { value: state.session } : undefined),
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const render = async () => (await import("@/app/(routes)/account/page")).default();

type RenderedElement = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** The first element of `type` in a rendered tree, walking `props.children` (no DOM needed). */
const findElement = (node: unknown, type: unknown): RenderedElement | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as RenderedElement;
  return element.type === type ? element : findElement(element.props.children, type);
};

const saved = { MCP_ENABLED: process.env.MCP_ENABLED, APP_BASE_URL: process.env.APP_BASE_URL };

describe("/account", () => {
  beforeEach(async () => {
    state.session = undefined;
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is not found without a session", async () => {
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the email and the connections section with the connector URL while the connector is on", async () => {
    process.env.MCP_ENABLED = "true";
    process.env.APP_BASE_URL = "https://plan.example.test";
    const user = await prisma.user.create({ data: { email: "me@example.com", passwordHash: "hashed" } });
    state.session = await createSessionJwt({ sub: user.id, role: user.role });

    const tree = await render();
    expect(findElement(tree, AccountSummary)?.props.email).toBe("me@example.com");
    expect(findElement(tree, ConnectedApps)?.props.mcpUrl).toBe("https://plan.example.test/api/mcp");
  });

  it("omits the connections section while the connector is off", async () => {
    delete process.env.MCP_ENABLED;
    const user = await prisma.user.create({ data: { email: "me@example.com", passwordHash: "hashed" } });
    state.session = await createSessionJwt({ sub: user.id, role: user.role });

    const tree = await render();
    expect(findElement(tree, AccountSummary)).not.toBeNull();
    expect(findElement(tree, ConnectedApps)).toBeNull();
  });
});
