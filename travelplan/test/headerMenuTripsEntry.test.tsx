// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
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
 * Story 6.20. `/trips` moved out of the trip detail page's breadcrumb and into the global menu, so
 * the menu's item list is now the only thing that decides who is offered it.
 */
describe("HeaderMenu trips entry", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { csrfToken: "test-token" }, error: null }),
    })) as unknown as typeof fetch;
  });

  const OPEN_MENU_LABEL = { en: /open menu/i, de: /menü öffnen/i };

  /**
   * `renderWithProviders` rather than a bare `I18nProvider`: it carries the app's theme too, which is
   * not optional for anything reading `theme.palette.tokens.*`. `HeaderMenu` gets away with literals
   * today, and a suite that only passes because of that would fail on the first token it adopts.
   */
  const openMenu = async ({
    isAuthenticated,
    language = "en",
  }: {
    isAuthenticated: boolean;
    language?: "en" | "de";
  }) => {
    const user = userEvent.setup();
    renderWithProviders(<HeaderMenu isAuthenticated={isAuthenticated} />, { language });

    await user.click(screen.getByRole("button", { name: OPEN_MENU_LABEL[language] }));

    return { user };
  };

  // AC2.
  it("offers all trips to an authenticated user", async () => {
    await openMenu({ isAuthenticated: true });

    const tripsItem = await screen.findByRole("menuitem", { name: "All trips" });

    expect(tripsItem).toHaveAttribute("href", "/trips");
  });

  /**
   * AC7. The markup this story deleted was a `<Link>` wrapping a `<Button>` - an `<a>` containing a
   * `<button>`, invalid HTML and two tab stops for one control. `MenuItem component={Link}` renders a
   * single element, and this pins that: the menu row *is* the anchor and holds no nested control.
   */
  it("renders the entry as a single anchor, not a control inside a link", async () => {
    await openMenu({ isAuthenticated: true });

    const tripsItem = await screen.findByRole("menuitem", { name: "All trips" });

    expect(tripsItem.tagName).toBe("A");
    expect(tripsItem.querySelector("a, button")).toBeNull();
  });

  /**
   * The one behaviour `HeaderMenu` contributes to the row beyond rendering it: choosing it dismisses
   * the menu. Navigation itself is the anchor's `href`, asserted above; without this the menu would
   * stay open over the page the user just asked for.
   */
  it("closes the menu when the entry is chosen", async () => {
    const { user } = await openMenu({ isAuthenticated: true });

    const tripsItem = await screen.findByRole("menuitem", { name: "All trips" });

    await user.click(tripsItem);

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "All trips" })).not.toBeInTheDocument();
    });
  });

  // AC3.
  it("does not offer it to an anonymous visitor", async () => {
    await openMenu({ isAuthenticated: false });

    expect(await screen.findByRole("menuitem", { name: /language/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "All trips" })).not.toBeInTheDocument();
  });

  /**
   * AC8. The rest of the menu is untouched: the language row and the session rows are still exactly
   * the ones each audience had before, and the trips entry is an addition rather than a replacement.
   */
  it("leaves the other rows in place for an authenticated user", async () => {
    await openMenu({ isAuthenticated: true });

    expect(await screen.findByRole("menuitem", { name: /language/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Login" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Register" })).not.toBeInTheDocument();
  });

  it("keeps login and register for an anonymous visitor", async () => {
    await openMenu({ isAuthenticated: false });

    expect(await screen.findByRole("menuitem", { name: "Login" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("menuitem", { name: "Register" })).toHaveAttribute("href", "/auth/register");
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("reads without a back arrow in German, where it is a destination rather than a back link", async () => {
    await openMenu({ isAuthenticated: true, language: "de" });

    const tripsItem = await screen.findByRole("menuitem", { name: "Alle Reisen" });

    expect(tripsItem).toHaveAttribute("href", "/trips");
    expect(tripsItem).not.toHaveTextContent("←");
  });
});
