// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectedApps, { type Connection } from "@/components/features/account/ConnectedApps";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 15.3's client surface. The route suite (`oauthConnections.test.ts`) proves the rules; this proves
 * the section shows each connection, confirms before it disconnects, sends the CSRF-checked DELETE, and
 * offers the connector URL when nothing is connected.
 */

const MCP_URL = "https://plan.example.test/api/mcp";

const CONNECTIONS: Connection[] = [
  {
    id: "family-1",
    clientName: "Claude",
    redirectHost: "claude.ai",
    connectedAt: "2026-10-20T08:30:00.000Z",
    lastUsedAt: "2026-10-28T17:05:00.000Z",
  },
  {
    id: "family-2",
    clientName: "Claude Code",
    redirectHost: null,
    connectedAt: "2026-10-01T08:30:00.000Z",
    lastUsedAt: null,
  },
];

type Call = { path: string; method: string; csrf: string | null };

const stubFetch = (
  options: { connections?: Connection[]; listError?: boolean; deleteResult?: { status: number; code: string } } = {},
) => {
  const calls: Call[] = [];
  // Server-side state: a successful DELETE removes the family, as the real route does.
  let current = options.connections ?? CONNECTIONS;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/auth/csrf") {
      return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "test-token" }, error: null }) };
    }
    if (path === "/api/users/me/connections" && method === "GET") {
      if (options.listError) {
        return { ok: false, status: 500, json: async () => ({ data: null, error: { code: "server_error", message: "no" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { connections: current }, error: null }) };
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ path, method, csrf: headers["x-csrf-token"] ?? null });
    if (options.deleteResult) {
      const { status, code } = options.deleteResult;
      return { ok: false, status, json: async () => ({ data: null, error: { code, message: "no" } }) };
    }
    const familyId = decodeURIComponent(path.split("/").pop() ?? "");
    current = current.filter((connection) => connection.id !== familyId);
    return { ok: true, status: 200, json: async () => ({ data: { revoked: true }, error: null }) };
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return { calls };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rowFor = async (clientName: string) => {
  const name = await screen.findByText(clientName);
  const row = name.closest("li");
  if (!row) throw new Error(`No row for ${clientName}`);
  return row as HTMLElement;
};

describe("ConnectedApps", () => {
  it("lists each connection with host, connected since and last used in the UI language", async () => {
    stubFetch();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    const claude = await rowFor("Claude");
    const format = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
    expect(within(claude).getByText("Returns to: claude.ai")).toBeInTheDocument();
    expect(
      within(claude).getByText(`Connected since ${format.format(new Date(CONNECTIONS[0].connectedAt))}`),
    ).toBeInTheDocument();
    expect(within(claude).getByText(`Last used: ${format.format(new Date(CONNECTIONS[0].lastUsedAt!))}`)).toBeInTheDocument();

    const legacy = await rowFor("Claude Code");
    expect(within(legacy).getByText("Returns to: —")).toBeInTheDocument();
    expect(within(legacy).getByText("Last used: Never")).toBeInTheDocument();
  });

  it("speaks German when the UI does", async () => {
    stubFetch();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />, { language: "de" });

    expect(await screen.findByRole("heading", { name: "Verbundene Apps" })).toBeInTheDocument();
    const legacy = await rowFor("Claude Code");
    expect(within(legacy).getByText("Zuletzt verwendet: Noch nie")).toBeInTheDocument();
    const format = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
    expect(
      within(legacy).getByText(`Verbunden seit ${format.format(new Date(CONNECTIONS[1].connectedAt))}`),
    ).toBeInTheDocument();
    expect(within(legacy).getByRole("button", { name: "Trennen" })).toBeInTheDocument();
  });

  it("asks before disconnecting, then sends the DELETE with the CSRF token and removes the row", async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    await user.click(within(await rowFor("Claude")).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Disconnect Claude?")).toBeInTheDocument();
    expect(calls).toEqual([]);

    // The safe choice closes without sending anything.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toEqual([]);

    await user.click(within(await rowFor("Claude")).getByRole("button", { name: "Disconnect" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.queryByText("Claude")).not.toBeInTheDocument());
    expect(calls).toEqual([{ path: "/api/users/me/connections/family-1", method: "DELETE", csrf: "test-token" }]);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("keeps the dialog open with an error when the disconnect fails", async () => {
    stubFetch({ deleteResult: { status: 500, code: "server_error" } });
    const user = userEvent.setup();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    await user.click(within(await rowFor("Claude")).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The connection could not be disconnected. Please try again.",
    );
    expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(screen.getByText("Claude", { selector: "li *" })).toBeInTheDocument();
  });

  it("closes the dialog and reloads the list when the connection is already gone", async () => {
    const { calls } = stubFetch({ deleteResult: { status: 404, code: "not_found" } });
    const fetchMock = vi.mocked(fetch);
    const user = userEvent.setup();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    await user.click(within(await rowFor("Claude")).getByRole("button", { name: "Disconnect" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toHaveLength(1);
    const listLoads = fetchMock.mock.calls.filter(([path, init]) => path === "/api/users/me/connections" && !init?.method?.match(/DELETE/));
    expect(listLoads).toHaveLength(2);
  });

  it("asks to sign in again when the session ended before the disconnect", async () => {
    stubFetch({ deleteResult: { status: 401, code: "unauthorized" } });
    const user = userEvent.setup();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    await user.click(within(await rowFor("Claude")).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/sign in/i);
  });

  it("shows how to connect, with the connector URL as text and a copy button, when nothing is connected", async () => {
    stubFetch({ connections: [] });
    const user = userEvent.setup();
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    expect(await screen.findByText("No apps are connected.")).toBeInTheDocument();
    expect(screen.getByTestId("connector-url")).toHaveTextContent(MCP_URL);

    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(MCP_URL);
  });

  it("leaves the URL in place when the clipboard refuses", async () => {
    stubFetch({ connections: [] });
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    await user.click(await screen.findByRole("button", { name: "Copy URL" }));
    expect(screen.getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    expect(screen.getByTestId("connector-url")).toHaveTextContent(MCP_URL);
  });

  it("says so when the list cannot be loaded", async () => {
    stubFetch({ listError: true });
    renderWithProviders(<ConnectedApps mcpUrl={MCP_URL} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Connected apps could not be loaded.");
  });
});
