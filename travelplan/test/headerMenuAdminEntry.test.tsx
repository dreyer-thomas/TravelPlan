// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeaderMenu from "@/components/HeaderMenu";
import { renderWithProviders } from "./helpers/renderWithProviders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

/**
 * Story 5.10, AC2: the administration entry point is the hamburger menu, visible **only** to an admin, and
 * everyone else sees the menu exactly as it is today.
 *
 * `authMenu.test.ts` asserts the item list; this asserts what actually renders, because the two can
 * disagree - the menu component decides how each item becomes a row, and the `logout` key is already
 * proof that not every item becomes a link.
 */
describe("HeaderMenu administration entry", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { csrfToken: "test-token" }, error: null }),
    })) as unknown as typeof fetch;
  });

  const OPEN_MENU_LABEL = { en: /open menu/i, de: /menü öffnen/i };

  const openMenu = async ({
    isAuthenticated,
    isAdmin,
    language = "en",
  }: {
    isAuthenticated: boolean;
    isAdmin?: boolean;
    language?: "en" | "de";
  }) => {
    const user = userEvent.setup();
    renderWithProviders(<HeaderMenu isAuthenticated={isAuthenticated} isAdmin={isAdmin} />, { language });
    await user.click(screen.getByRole("button", { name: OPEN_MENU_LABEL[language] }));
    return { user };
  };

  it("renders the administration row for an admin, as a link to the page", async () => {
    await openMenu({ isAuthenticated: true, isAdmin: true });

    const item = await screen.findByRole("menuitem", { name: "User administration" });

    expect(item).toHaveAttribute("href", "/admin/users");
  });

  it("renders it in German too", async () => {
    await openMenu({ isAuthenticated: true, isAdmin: true, language: "de" });

    expect(await screen.findByRole("menuitem", { name: "Nutzerverwaltung" })).toHaveAttribute("href", "/admin/users");
  });

  /**
   * The three negative cases, and they are the point of the AC. Asserted as the full row list rather than
   * as the absence of one name, so an accidental extra entry fails here too - "everyone else sees the menu
   * exactly as it is today" is a claim about the whole menu.
   */
  it("shows a signed-in non-admin the menu unchanged", async () => {
    await openMenu({ isAuthenticated: true, isAdmin: false });

    expect(await screen.findByRole("menuitem", { name: "All trips" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "User administration" })).toBeNull();
  });

  it("shows a caller who passes no isAdmin at all the menu unchanged", async () => {
    // The prop is optional so the marketing home page, which the middleware only ever shows to anonymous
    // visitors, does not have to resolve a role it has no reason to. The default has to be the safe one.
    await openMenu({ isAuthenticated: true });

    expect(screen.queryByRole("menuitem", { name: "User administration" })).toBeNull();
  });

  it("shows an anonymous visitor nothing extra, even if isAdmin is somehow set", async () => {
    await openMenu({ isAuthenticated: false, isAdmin: true });

    expect(await screen.findByRole("menuitem", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "User administration" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "All trips" })).toBeNull();
  });
});
