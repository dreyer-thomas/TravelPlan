// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeaderMenu from "@/components/HeaderMenu";
import { I18nProvider } from "@/i18n/provider";
import { LANGUAGE_COOKIE_NAME } from "@/i18n";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("unauthenticated language cookie persistence", () => {
  beforeEach(() => {
    Object.defineProperty(window.document, "cookie", {
      writable: true,
      value: "",
    });

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          json: async () => ({ data: { csrfToken: "test-token" }, error: null }),
        } as Response;
      }
      return { ok: true, json: async () => ({ data: null, error: null }) } as Response;
    }) as unknown as typeof fetch;
  });

  it("writes lang cookie when switching language while signed out", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLanguage="en">
        <HeaderMenu isAuthenticated={false} />
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: /language/i }));
    await user.click(await screen.findByRole("menuitem", { name: /german|deutsch/i }));

    expect(document.cookie).toContain(`${LANGUAGE_COOKIE_NAME}=de`);
  });
});
