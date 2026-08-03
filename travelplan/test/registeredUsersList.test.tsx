// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegisteredUsersList from "@/components/features/users/RegisteredUsersList";
import { renderWithProviders } from "./helpers/renderWithProviders";

/** One GET, one answer - the component fetches `/api/users` once on mount and nothing else. */
const stubFetch = (result: { ok: boolean; status: number; payload: unknown }) => {
  const fetchMock = vi.fn(async () => ({
    ok: result.ok,
    status: result.status,
    json: async () => result.payload,
  }));

  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
};

const USERS = [
  { id: "user-1", email: "anton@example.com" },
  { id: "user-2", email: "mira@example.com" },
  { id: "user-3", email: "zoe@example.com" },
];

describe("RegisteredUsersList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("heads the page and shows a spinner while the fetch is in flight", async () => {
    // Never resolves, so the assertions land on the loading member of the state union - the one the
    // other cases skip past.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);

    renderWithProviders(<RegisteredUsersList />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // The card title is this page's only heading, so it has to be one - and both header strings are
    // rendered outside the state switch, before any answer has arrived.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Registered users");
    expect(screen.getByText("Every account in TravelPlan")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders every account with a count label", async () => {
    stubFetch({ ok: true, status: 200, payload: { data: { users: USERS }, error: null } });

    renderWithProviders(<RegisteredUsersList />);

    expect(await screen.findByText("Accounts (3)")).toBeInTheDocument();
    expect(screen.getByText("anton@example.com")).toBeInTheDocument();
    expect(screen.getByText("mira@example.com")).toBeInTheDocument();
    expect(screen.getByText("zoe@example.com")).toBeInTheDocument();
  });

  it("renders nothing but the email in a row", async () => {
    stubFetch({ ok: true, status: 200, payload: { data: { users: USERS }, error: null } });

    renderWithProviders(<RegisteredUsersList />);

    const row = (await screen.findByText("anton@example.com")).closest("li");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("anton@example.com");
    // No role badge and no per-row action: this list informs the invite, it does not perform it.
    expect(row!.textContent).toBe("anton@example.com");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("blocks with an explanation and no list when the API answers forbidden", async () => {
    stubFetch({
      ok: false,
      status: 403,
      payload: { data: null, error: { code: "forbidden", message: "Trip ownership required" } },
    });

    renderWithProviders(<RegisteredUsersList />);

    expect(await screen.findByText("Only trip owners can view registered users.")).toBeInTheDocument();
    // Blocked is not "an empty list": there must be no list at all, and no email from it.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("anton@example.com")).toBeNull();
    expect(screen.queryByText("Accounts (0)")).toBeNull();
  });

  it("shows the load error when the API fails", async () => {
    stubFetch({
      ok: false,
      status: 500,
      payload: { data: null, error: { code: "server_error", message: "boom" } },
    });

    renderWithProviders(<RegisteredUsersList />);

    expect(
      await screen.findByText("Unable to load registered users. Please refresh."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the load error when the fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );

    renderWithProviders(<RegisteredUsersList />);

    expect(
      await screen.findByText("Unable to load registered users. Please refresh."),
    ).toBeInTheDocument();
  });

  it.each(["unauthorized", "password_change_required"])(
    "points a %s caller at signing in rather than at refreshing",
    async (code) => {
      stubFetch({
        ok: false,
        status: code === "unauthorized" ? 401 : 403,
        payload: { data: null, error: { code, message: "nope" } },
      });

      renderWithProviders(<RegisteredUsersList />);

      // The session died after the page loaded, so the middleware never saw the request. "Please
      // refresh" would send the user around a loop that cannot end.
      expect(await screen.findByText("Authentication required. Please sign in.")).toBeInTheDocument();
      expect(screen.queryByText("Unable to load registered users. Please refresh.")).toBeNull();
      expect(screen.queryByRole("list")).toBeNull();
    },
  );

  it("treats a 200 without a user list as a failure, not as an empty system", async () => {
    stubFetch({ ok: true, status: 200, payload: { data: {}, error: null } });

    renderWithProviders(<RegisteredUsersList />);

    expect(
      await screen.findByText("Unable to load registered users. Please refresh."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No accounts registered yet.")).toBeNull();
  });

  it("renders the empty message when no account is registered", async () => {
    stubFetch({ ok: true, status: 200, payload: { data: { users: [] }, error: null } });

    renderWithProviders(<RegisteredUsersList />);

    expect(await screen.findByText("No accounts registered yet.")).toBeInTheDocument();
    expect(screen.getByText("Accounts (0)")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("reads through the browser cache so a reload shows newly registered accounts", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      payload: { data: { users: USERS }, error: null },
    });

    renderWithProviders(<RegisteredUsersList />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // One GET on mount and nothing else - the docstring on `stubFetch` only answers one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/users");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("include");
  });
});
