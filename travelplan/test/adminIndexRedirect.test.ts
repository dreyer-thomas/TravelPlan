import { describe, expect, it, vi } from "vitest";

/**
 * Story 5.10 review: `/admin` resolves rather than 404ing.
 *
 * `middleware.ts`'s matcher comment claimed "`/admin` today redirects to `/admin/users`" and nothing did -
 * there was no `admin/page.tsx` and no redirect anywhere, so the obvious parent of the URL behind a menu row
 * labelled "User administration" was a dead end for a signed-in admin.
 *
 * The matcher assertion in `middleware.test.ts` covers `/admin`, which *reinforced* the false claim rather
 * than catching it: being matched by the middleware only decides that a signed-out caller is redirected to
 * login, not that the path resolves to anything afterwards. So this asserts the page module itself.
 *
 * Its own file because the mock has to be module-scoped, and `middleware.test.ts` has no other reason to
 * replace `next/navigation`.
 */
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("/admin", () => {
  it("sends a caller to /admin/users", async () => {
    const { redirect } = await import("next/navigation");
    const AdminIndexPage = (await import("@/app/(routes)/admin/page")).default;

    AdminIndexPage();

    expect(redirect).toHaveBeenCalledWith("/admin/users");
  });
});
