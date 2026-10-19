import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import AdminAiUsage from "@/components/features/admin/AdminAiUsage";

/**
 * Story 8.7, AC9. `/admin/ai-usage` gates itself like `/admin/users`: `notFound()` for anyone who is not an
 * administrator, from the live role. `next/headers` and `next/navigation` cannot run outside a request,
 * so the cookie jar and `notFound` are replaced; the role read is the real one on the per-worker database.
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

const render = async () => (await import("@/app/(routes)/admin/ai-usage/page")).default();

/** Whether a rendered tree contains an element of `type`, walking `props.children` (no DOM needed). */
const containsElement = (node: unknown, type: unknown): boolean => {
  if (Array.isArray(node)) return node.some((child) => containsElement(child, type));
  if (!node || typeof node !== "object" || !("props" in node)) return false;
  const element = node as { type: unknown; props: { children?: unknown } };
  return element.type === type || containsElement(element.props.children, type);
};

const createUser = (email: string, role: "OWNER" | "ADMIN") => prisma.user.create({ data: { email, passwordHash: "hashed", role } });

describe("/admin/ai-usage", () => {
  beforeEach(async () => {
    state.session = undefined;
    await prisma.aiUsageRecord.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("is not found without a session", async () => {
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is not found for a non-admin, even one whose token claims ADMIN", async () => {
    const owner = await createUser("owner@example.com", "OWNER");
    state.session = await createSessionJwt({ sub: owner.id, role: "ADMIN" });

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders for an admin", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    state.session = await createSessionJwt({ sub: admin.id, role: "ADMIN" });

    expect(containsElement(await render(), AdminAiUsage)).toBe(true);
  });
});
