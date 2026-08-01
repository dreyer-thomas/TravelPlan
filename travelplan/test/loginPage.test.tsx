// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/auth/login/page";
import { renderWithProviders } from "./helpers/renderWithProviders";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("routes must-change-password users into the forced password-change flow", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          json: async () => ({ data: { csrfToken: "test-token" }, error: null }),
        } as Response;
      }
      if (url.includes("/api/auth/login") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { userId: "user-1", mustChangePassword: true }, error: null }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
      } as Response;
    }) as unknown as typeof fetch;

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), "flagged@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "correctpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/auth/first-login-password");
    });
  });

  it("routes regular users into the normal app flow", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          json: async () => ({ data: { csrfToken: "test-token" }, error: null }),
        } as Response;
      }
      if (url.includes("/api/auth/login") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { userId: "user-1", mustChangePassword: false }, error: null }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
      } as Response;
    }) as unknown as typeof fetch;

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), "regular@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "correctpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });
});
