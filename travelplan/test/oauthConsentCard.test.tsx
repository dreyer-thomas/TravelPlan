// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OAuthConsentCard from "@/components/features/oauth/OAuthConsentCard";
import { renderWithProviders } from "./helpers/renderWithProviders";

const assignMock = vi.fn();

vi.mock("@/lib/browser/assignLocation", () => ({
  assignLocation: (url: string) => assignMock(url),
}));

const consentProps = {
  mode: "consent" as const,
  query: "client_id=https%3A%2F%2Fclaude.ai%2Fx&state=s",
  clientName: "Claude",
  clientHost: "claude.ai",
  redirectHost: "claude.ai",
  email: "tommy@example.com",
  loopbackWarning: false,
};

const decisionBodies: unknown[] = [];

const stubDecision = (answer: { ok: boolean; redirectUrl?: string }) => {
  decisionBodies.length = 0;
  global.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/csrf")) {
      return { ok: true, json: async () => ({ data: { csrfToken: "test-token" }, error: null }) } as Response;
    }
    if (url.includes("/api/oauth/authorize/decision")) {
      decisionBodies.push(JSON.parse(String(init?.body)));
      return {
        ok: answer.ok,
        json: async () =>
          answer.ok
            ? { data: { redirectUrl: answer.redirectUrl }, error: null }
            : { data: null, error: { code: "invalid_request", message: "x" } },
      } as Response;
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
};

describe("OAuthConsentCard", () => {
  beforeEach(() => {
    assignMock.mockReset();
  });

  it("shows the client, its host, the redirect host, the permission and the signed-in email (German)", async () => {
    stubDecision({ ok: true, redirectUrl: "https://claude.ai/cb?code=x" });
    renderWithProviders(<OAuthConsentCard {...consentProps} />, { language: "de" });
    expect(screen.getByText("Claude verbinden?")).toBeInTheDocument();
    expect(screen.getByText("Angemeldet als tommy@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("oauth-client-host")).toHaveTextContent("Identität des Clients: claude.ai");
    expect(screen.getByTestId("oauth-redirect-host")).toHaveTextContent("claude.ai");
    expect(screen.getByText("Reisen lesen und bearbeiten, auf denen du planen darfst")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erlauben" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ablehnen" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns when the client only returns to this computer", () => {
    stubDecision({ ok: true });
    renderWithProviders(<OAuthConsentCard {...consentProps} loopbackWarning />);
    expect(screen.getByText(/only returns to a program on this computer/)).toBeInTheDocument();
  });

  it("posts the original query with the decision and follows the returned URL", async () => {
    const user = userEvent.setup();
    stubDecision({ ok: true, redirectUrl: "https://claude.ai/api/mcp/auth_callback?code=abc&iss=x" });
    renderWithProviders(<OAuthConsentCard {...consentProps} />);
    const allow = screen.getByRole("button", { name: "Allow" });
    await waitFor(() => expect(allow).toBeEnabled());
    await user.click(allow);
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=abc&iss=x");
    });
    expect(decisionBodies).toEqual([{ query: consentProps.query, decision: "allow" }]);
  });

  it("shows an error and stays when the decision fails", async () => {
    const user = userEvent.setup();
    stubDecision({ ok: false });
    renderWithProviders(<OAuthConsentCard {...consentProps} />);
    const deny = screen.getByRole("button", { name: "Deny" });
    await waitFor(() => expect(deny).toBeEnabled());
    await user.click(deny);
    expect(await screen.findByText("Your decision could not be sent. Please try again.")).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
    expect(decisionBodies).toEqual([{ query: consentProps.query, decision: "deny" }]);
  });

  it("says so when no CSRF token could be fetched", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    renderWithProviders(<OAuthConsentCard {...consentProps} />);
    expect(await screen.findByText("Your decision could not be sent. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
  });

  it("renders the error card for an invalid request", () => {
    renderWithProviders(<OAuthConsentCard mode="error" reason="client_not_allowed" />);
    expect(screen.getByText("Connection not possible")).toBeInTheDocument();
    expect(screen.getByText("This client is not allowed to connect to TravelPlan.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
  });
});
