// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirstLoginPasswordPage from "@/app/(auth)/auth/first-login-password/page";
import ForgotPasswordPage from "@/app/(auth)/auth/forgot-password/page";
import LoginPage from "@/app/(auth)/auth/login/page";
import RegisterPage from "@/app/(auth)/auth/register/page";
import ResetPasswordPage from "@/app/(auth)/auth/reset-password/page";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Component-level cover for the redesigned auth screens (Story 7.6).
 *
 * Four of the five pages had no component test before this story. What is pinned here is the
 * behaviour the re-skin could plausibly break: the tabs being navigation rather than buttons, the
 * consent requirement, the non-red error notice, the token field's visibility rule, and — the one
 * with a security cost — that `confirmPassword` never reaches the reset endpoint.
 *
 * Computed pixel heights and the focus ring are deliberately NOT asserted: neither computes in jsdom.
 * Those belong in the manual browser check.
 */

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

type FetchCall = { url: string; method?: string; body?: unknown };

let calls: FetchCall[] = [];

/** Answers the CSRF bootstrap, then whatever `responses` maps a URL fragment to. */
const mockFetch = (responses: Record<string, { ok: boolean; body: unknown }>) => {
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });

    if (url.includes("/api/auth/csrf")) {
      return { ok: true, json: async () => ({ data: { csrfToken: "test-token" }, error: null }) } as Response;
    }

    const match = Object.keys(responses).find((fragment) => url.includes(fragment));
    if (match) {
      const { ok, body } = responses[match];
      return { ok, json: async () => body } as Response;
    }

    return {
      ok: false,
      json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
    } as Response;
  }) as unknown as typeof fetch;
};

/** Waits for the CSRF fetch-on-mount to land, so a submit is not rejected for a missing token. */
const waitForCsrf = async () => {
  await waitFor(() => {
    expect(calls.some((call) => call.url.includes("/api/auth/csrf"))).toBe(true);
  });
};

const postsTo = (fragment: string) => calls.filter((call) => call.url.includes(fragment) && call.method === "POST");

beforeEach(() => {
  pushMock.mockReset();
  calls = [];
  searchParams = new URLSearchParams();
});

describe("LoginPage (redesigned shell)", () => {
  it("renders the brand, the hero copy, and the sign-in tab as current-page navigation", async () => {
    mockFetch({});
    renderWithProviders(<LoginPage />);
    await waitForCsrf();

    expect(screen.getByText("TravelPlan")).toBeInTheDocument();
    expect(screen.getByText("Plan trips that don't feel like work.")).toBeInTheDocument();

    // The active tab is a <span aria-current="page">, not a button and not a link.
    const activeTab = screen.getByText("Sign in", { selector: '[aria-current="page"]' });
    expect(activeTab.tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    // ...which is what keeps this query resolving to the submit button alone (loginPage.test.tsx).
    expect(screen.getByRole("button", { name: /sign in/i })).toHaveAttribute("type", "submit");

    const registerTab = screen.getByRole("link", { name: "Register" });
    expect(registerTab).toHaveAttribute("href", "/auth/register");
  });

  it("links to the password-reset flow", async () => {
    mockFetch({});
    renderWithProviders(<LoginPage />);
    await waitForCsrf();

    // AC5: before this story the reset flow had no entry point anywhere in the UI.
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
  });

  it("shows a failed sign-in in a role=alert notice that is not a red MUI Alert", async () => {
    const user = userEvent.setup();
    mockFetch({
      "/api/auth/login": {
        ok: false,
        body: { data: null, error: { code: "invalid_credentials", message: "nope" } },
      },
    });
    const { container } = renderWithProviders(<LoginPage />);
    await waitForCsrf();

    await user.type(screen.getByLabelText(/email/i), "someone@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrongpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password.");
    });
    // `theme.ts` defines no `error` palette entry, so a MUI Alert would fall back to a red DESIGN.md
    // does not contain. The warn-toned notice replaces it.
    expect(container.querySelector(".MuiAlert-standardError")).toBeNull();
  });
});

describe("RegisterPage (redesigned shell)", () => {
  it("still requires consent before it will post", async () => {
    const user = userEvent.setup();
    mockFetch({ "/api/auth/register": { ok: true, body: { data: { userId: "u1" }, error: null } } });
    renderWithProviders(<RegisterPage />);
    await waitForCsrf();

    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "longenoughpassword");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Consent is required")).toBeInTheDocument();
    });
    expect(postsTo("/api/auth/register")).toHaveLength(0);
  });

  it("posts { email, password, consent: true } when consent is given", async () => {
    const user = userEvent.setup();
    mockFetch({ "/api/auth/register": { ok: true, body: { data: { userId: "u1" }, error: null } } });
    renderWithProviders(<RegisterPage />);
    await waitForCsrf();

    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "longenoughpassword");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(postsTo("/api/auth/register")).toHaveLength(1);
    });
    // The payload shape `registerSchema` pins.
    expect(postsTo("/api/auth/register")[0].body).toEqual({
      email: "new@example.com",
      password: "longenoughpassword",
      consent: true,
    });
  });
});

describe("ForgotPasswordPage (Screen H step A)", () => {
  it("shows the step pill, requests the reset, and renders the success notice", async () => {
    const user = userEvent.setup();
    mockFetch({
      "/api/auth/password-reset/request": { ok: true, body: { data: { success: true }, error: null } },
    });
    renderWithProviders(<ForgotPasswordPage />);
    await waitForCsrf();

    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign-in" })).toHaveAttribute("href", "/auth/login");

    await user.type(screen.getByLabelText(/email/i), "someone@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(postsTo("/api/auth/password-reset/request")).toHaveLength(1);
    });
    // Non-enumerating by design: the wording does not confirm whether the account exists.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "If an account exists for that email, a reset link has been sent.",
    );
  });
});

describe("ResetPasswordPage (Screen H step B)", () => {
  it("hides the token field when the emailed link carries a token, and still submits it", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("token=abc");
    mockFetch({
      "/api/auth/password-reset/confirm": { ok: true, body: { data: { success: true }, error: null } },
    });
    renderWithProviders(<ResetPasswordPage />);
    await waitForCsrf();

    expect(screen.queryByLabelText(/reset token/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("New password"), "brandnewpassword");
    await user.type(screen.getByLabelText("Confirm password"), "brandnewpassword");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => {
      expect(postsTo("/api/auth/password-reset/confirm")).toHaveLength(1);
    });
    expect(postsTo("/api/auth/password-reset/confirm")[0].body).toMatchObject({ token: "abc" });
  });

  it("shows the token field when no token is in the URL", async () => {
    mockFetch({});
    renderWithProviders(<ResetPasswordPage />);
    await waitForCsrf();

    // Manual token entry stays possible, so `auth.reset.tokenRequired` remains reachable.
    expect(screen.getByLabelText(/reset token/i)).toBeInTheDocument();
  });

  it("blocks submit when the confirmation does not match", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("token=abc");
    mockFetch({
      "/api/auth/password-reset/confirm": { ok: true, body: { data: { success: true }, error: null } },
    });
    renderWithProviders(<ResetPasswordPage />);
    await waitForCsrf();

    await user.type(screen.getByLabelText("New password"), "brandnewpassword");
    await user.type(screen.getByLabelText("Confirm password"), "differentpassword");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    });
    expect(postsTo("/api/auth/password-reset/confirm")).toHaveLength(0);
  });

  it("never sends confirmPassword to the API", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("token=abc");
    mockFetch({
      "/api/auth/password-reset/confirm": { ok: true, body: { data: { success: true }, error: null } },
    });
    renderWithProviders(<ResetPasswordPage />);
    await waitForCsrf();

    await user.type(screen.getByLabelText("New password"), "brandnewpassword");
    await user.type(screen.getByLabelText("Confirm password"), "brandnewpassword");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => {
      expect(postsTo("/api/auth/password-reset/confirm")).toHaveLength(1);
    });
    // A key-set assertion, not a field check: this is what proves the client-only field cannot leak
    // into the request body if the payload is ever built from `values` again.
    const payload = postsTo("/api/auth/password-reset/confirm")[0].body as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["password", "token"]);
  });
});

describe("FirstLoginPasswordPage (invite flow)", () => {
  it("renders inside the auth shell and redirects into the app on success", async () => {
    const user = userEvent.setup();
    mockFetch({
      "/api/auth/first-login-password": { ok: true, body: { data: { success: true }, error: null } },
    });
    renderWithProviders(<FirstLoginPasswordPage />);
    await waitForCsrf();

    // AC4: the fifth screen uses the same hero/form shell as the other four.
    expect(screen.getByText("One step before you start.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/new password/i), "brandnewpassword");
    await user.click(screen.getByRole("button", { name: /save new password/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(postsTo("/api/auth/first-login-password")).toHaveLength(1);
  });
});

/**
 * Cover for the code-review patches (2026-08-01). Each block pins a defect that shipped in the
 * story commit, so a regression fails here rather than in a browser check.
 */
describe("code-review patches", () => {
  it("surfaces a token error in the notice when the token field is hidden", async () => {
    // The API rejects a whitespace-only `?token=` (`.trim().min(1)`), but RHF's `required` passes it,
    // so `setError("token")` fires against an input that is `type="hidden"` and renders nothing.
    const user = userEvent.setup();
    searchParams = new URLSearchParams("token=%20%20");
    mockFetch({
      "/api/auth/password-reset/confirm": {
        ok: false,
        body: {
          data: null,
          error: {
            code: "validation_error",
            message: "Invalid reset details",
            details: { fieldErrors: { token: ["Reset token is required"] } },
          },
        },
      },
    });
    renderWithProviders(<ResetPasswordPage />);
    await waitForCsrf();

    expect(screen.queryByLabelText(/reset token/i)).toBeNull();

    await user.type(screen.getByLabelText(/new password/i), "brandnewpassword");
    await user.type(screen.getByLabelText(/confirm password/i), "brandnewpassword");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => {
      expect(postsTo("/api/auth/password-reset/confirm")).toHaveLength(1);
    });
    // Before the patch this was a total silent failure: no alert, no field error, no success.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Reset token is required");
    });
  });

  it("clears the mismatch error when the password field is corrected, not just the confirm field", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("token=abc");
    mockFetch({
      "/api/auth/password-reset/confirm": { ok: true, body: { data: { success: true }, error: null } },
    });
    renderWithProviders(<ResetPasswordPage />);
    await waitForCsrf();

    await user.type(screen.getByLabelText(/new password/i), "brandnewpassword");
    await user.type(screen.getByLabelText(/confirm password/i), "somethingelse00");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    });
    expect(postsTo("/api/auth/password-reset/confirm")).toHaveLength(0);

    // Fixing the OTHER field is what `deps: ["password"]` makes re-validate. Without it the stale
    // error sits there until the confirm field is touched again.
    await user.clear(screen.getByLabelText(/new password/i));
    await user.type(screen.getByLabelText(/new password/i), "somethingelse00");

    await waitFor(() => {
      expect(screen.queryByText("Passwords do not match")).toBeNull();
    });
  });

  it("ties the register consent error to the checkbox", async () => {
    const user = userEvent.setup();
    mockFetch({});
    renderWithProviders(<RegisterPage />);
    await waitForCsrf();

    const consent = screen.getByRole("checkbox");
    expect(consent).not.toHaveAttribute("aria-describedby");

    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "brandnewpassword");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    // Same pairing AuthField gets free from MUI's id/helperText wiring: the message must be
    // reachable from the control, not merely visible next to it.
    await waitFor(() => {
      expect(consent).toHaveAttribute("aria-invalid", "true");
    });
    const describedBy = consent.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("Consent is required");
  });

  it("offers a language switcher on the auth screens, which have no AppHeader", async () => {
    const user = userEvent.setup();
    mockFetch({});
    renderWithProviders(<LoginPage />);
    await waitForCsrf();

    // The (auth) route group has no AppHeader ancestor, so this shell is the only place an
    // unauthenticated visitor can reach the German dictionary.
    const toggle = screen.getByRole("group", { name: "Language" });
    expect(toggle).toBeInTheDocument();

    const german = within(toggle).getByRole("button", { name: "German" });
    expect(within(toggle).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(german).toHaveAttribute("aria-pressed", "false");

    await user.click(german);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
    });
    // The whole screen follows, not just the toggle.
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
  });

  it("sets autoComplete on every auth field so managers do not offer the current password as a new one", async () => {
    mockFetch({});

    const { unmount } = renderWithProviders(<LoginPage />);
    await waitForCsrf();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("autocomplete", "current-password");
    unmount();

    searchParams = new URLSearchParams("token=abc");
    renderWithProviders(<ResetPasswordPage />);
    // The distinction that matters: these are new-password, so a manager offers a generated
    // secret rather than autofilling the account's existing one.
    expect(screen.getByLabelText(/new password/i)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute("autocomplete", "new-password");
  });
});
