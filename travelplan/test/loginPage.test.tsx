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

const assignMock = vi.fn();

vi.mock("@/lib/browser/assignLocation", () => ({
  assignLocation: (url: string) => assignMock(url),
}));

const stubLogin = (mustChangePassword: boolean) => {
  global.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/csrf")) {
      return { ok: true, json: async () => ({ data: { csrfToken: "test-token" }, error: null }) } as Response;
    }
    if (url.includes("/api/auth/login") && init?.method === "POST") {
      return { ok: true, json: async () => ({ data: { userId: "user-1", mustChangePassword }, error: null }) } as Response;
    }
    return { ok: false, json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected" } }) } as Response;
  }) as unknown as typeof fetch;
};

const signIn = async () => {
  const user = userEvent.setup();
  renderWithProviders(<LoginPage />);
  await user.type(screen.getByLabelText(/email/i), "regular@example.com");
  await user.type(screen.getByLabelText(/^password$/i), "correctpassword");
  await user.click(screen.getByRole("button", { name: /sign in/i }));
};

describe("LoginPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    assignMock.mockReset();
    window.history.replaceState(null, "", "/auth/login");
  });

  it("returns to the connector's authorize step when returnTo points there (Story 15.1)", async () => {
    const target = "/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fx&state=s";
    window.history.replaceState(null, "", `/auth/login?returnTo=${encodeURIComponent(target)}`);
    stubLogin(false);
    await signIn();
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(target);
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example/oauth/authorize?x", "//evil.example/oauth/authorize?x", "/trips"])(
    "ignores the unsafe returnTo %s",
    async (target) => {
      window.history.replaceState(null, "", `/auth/login?returnTo=${encodeURIComponent(target)}`);
      stubLogin(false);
      await signIn();
      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/");
      });
      expect(assignMock).not.toHaveBeenCalled();
    },
  );

  it("still forces the password change before any returnTo", async () => {
    window.history.replaceState(null, "", `/auth/login?returnTo=${encodeURIComponent("/oauth/authorize?x=1")}`);
    stubLogin(true);
    await signIn();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/auth/first-login-password");
    });
    expect(assignMock).not.toHaveBeenCalled();
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
