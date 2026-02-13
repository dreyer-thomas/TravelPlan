// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeaderMenu from "@/components/HeaderMenu";
import { I18nProvider } from "@/i18n/provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mockCsrfResponse = {
  data: { csrfToken: "test-token" },
  error: null,
};

describe("HeaderMenu language switcher", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          json: async () => mockCsrfResponse,
        } as Response;
      }

      if (url.includes("/api/users/me/language") && method === "PATCH") {
        return {
          ok: true,
          json: async () => ({ data: { userId: "user-1", preferredLanguage: "de" }, error: null }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: null, error: null }),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it("lets the user open the menu and change language", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLanguage="en">
        <HeaderMenu isAuthenticated={false} />
      </I18nProvider>
    );

    const openButton = screen.getByRole("button", { name: /open menu/i });
    await user.click(openButton);

    const languageItem = await screen.findByRole("menuitem", { name: /language/i });
    await user.click(languageItem);

    const germanOption = await screen.findByRole("menuitem", { name: /german|deutsch/i });
    await user.click(germanOption);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /german|deutsch/i })).toBeInTheDocument();
    });
  });

  it("persists language for authenticated users", async () => {
    const user = userEvent.setup();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    render(
      <I18nProvider initialLanguage="en">
        <HeaderMenu isAuthenticated />
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: /language/i }));
    await user.click(await screen.findByRole("menuitem", { name: /german|deutsch/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/me/language",
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });
  });
});
