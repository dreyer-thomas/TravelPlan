// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripShareDialog from "@/components/features/trips/TripShareDialog";
import { renderWithProviders } from "./helpers/renderWithProviders";

type MembersPayload = {
  owner?: { email: string };
  collaborators: { id: string; email: string; role: "viewer" | "contributor" }[];
};

const OWNER = { email: "owner@example.com" };

const CONTRIBUTOR = { id: "member-1", email: "nina@example.com", role: "contributor" as const };
const VIEWER = { id: "member-2", email: "pereira@example.com", role: "viewer" as const };

/**
 * The dialog opens with a parallel CSRF + members fetch, so every case needs both mocked. `onDelete`
 * lets a case decide what the DELETE responds with; omitted, DELETE is not expected.
 */
const stubFetch = (options: {
  members: MembersPayload;
  onDelete?: (body: { memberId: string }) => { ok: boolean; status: number; payload: unknown };
}) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/auth/csrf") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { csrfToken: "test-csrf-token" }, error: null }),
      };
    }

    if (url.endsWith("/api/trips/trip-1/members") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: options.members, error: null }),
      };
    }

    if (url.endsWith("/api/trips/trip-1/members") && method === "DELETE") {
      const body = JSON.parse(String(init?.body)) as { memberId: string };
      const result = options.onDelete?.(body);
      if (!result) {
        throw new Error("Unexpected DELETE");
      }
      return {
        ok: result.ok,
        status: result.status,
        json: async () => result.payload,
      };
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });

  // Cast only at the stub boundary so the returned mock keeps its call-argument types.
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
};

const renderDialog = () =>
  renderWithProviders(
    <TripShareDialog open tripId="trip-1" tripName="Portugal Roadtrip" onClose={vi.fn()} />,
  );

describe("TripShareDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the owner first with an Owner badge and no remove action", async () => {
    stubFetch({ members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] } });

    renderDialog();

    const ownerEmail = await screen.findByText("owner@example.com");
    const ownerRow = ownerEmail.closest("li");
    expect(ownerRow).not.toBeNull();
    expect(ownerRow).toHaveTextContent("Owner");
    expect(within(ownerRow!).queryByRole("button")).toBeNull();

    // Owner is the first row of the access list, ahead of every collaborator.
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("owner@example.com");
  });

  it("renders a role badge for each collaborator", async () => {
    stubFetch({ members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] } });

    renderDialog();

    const contributorEmail = await screen.findByText("nina@example.com");
    expect(contributorEmail.closest("li")).toHaveTextContent("Contributor");

    const viewerEmail = screen.getByText("pereira@example.com");
    expect(viewerEmail.closest("li")).toHaveTextContent("Viewer");
  });

  it("counts the owner in the access label", async () => {
    stubFetch({ members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] } });

    renderDialog();

    expect(await screen.findByText("Access (3)")).toBeInTheDocument();
  });

  it("names the collaborator in the remove button's accessible name", async () => {
    stubFetch({ members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] } });

    renderDialog();

    expect(await screen.findByRole("button", { name: "Remove nina@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove pereira@example.com" })).toBeInTheDocument();
  });

  it("removes a collaborator with a CSRF-protected DELETE and drops the row", async () => {
    const fetchMock = stubFetch({
      members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] },
      onDelete: () => ({
        ok: true,
        status: 200,
        payload: { data: { deleted: true, collaborators: [VIEWER] }, error: null },
      }),
    });

    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Remove nina@example.com" }));

    await waitFor(() => expect(screen.queryByText("nina@example.com")).toBeNull());
    expect(screen.getByText("pereira@example.com")).toBeInTheDocument();
    expect(screen.getByText("Access (2)")).toBeInTheDocument();

    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deleteCall).toBeDefined();
    const [, init] = deleteCall!;
    expect(JSON.parse(String(init?.body))).toEqual({ memberId: "member-1" });
    expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("test-csrf-token");
  });

  it("surfaces a removal error and keeps the row when DELETE fails", async () => {
    stubFetch({
      members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] },
      onDelete: () => ({
        ok: false,
        status: 500,
        payload: { data: null, error: { code: "server_error", message: "Unable to remove collaborator" } },
      }),
    });

    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Remove nina@example.com" }));

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.getByText("nina@example.com")).toBeInTheDocument();
  });

  it("reconciles the row away when DELETE reports the membership is already gone", async () => {
    // A 404 means somebody else already removed them: the user's intent is satisfied, so the row must
    // not survive as a phantom that errors on every retry.
    stubFetch({
      members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] },
      onDelete: () => ({
        ok: false,
        status: 404,
        payload: { data: null, error: { code: "not_found", message: "Collaborator not found" } },
      }),
    });

    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Remove nina@example.com" }));

    await waitFor(() => expect(screen.queryByText("nina@example.com")).toBeNull());
    expect(screen.getByText("Access removed.")).toBeInTheDocument();
    expect(screen.getByText("Access (2)")).toBeInTheDocument();
    expect(screen.queryByText("Unable to remove collaborator. Please try again.")).toBeNull();
  });

  it("does not resurrect an already-removed collaborator from a slower response", async () => {
    // Each DELETE answers with a server snapshot taken at its own commit time, so a slower first
    // response can still contain the member a faster second one deleted.
    const responses: Record<string, { id: string; email: string; role: "viewer" | "contributor" }[]> = {
      "member-1": [VIEWER],
      "member-2": [CONTRIBUTOR],
    };
    stubFetch({
      members: { owner: OWNER, collaborators: [CONTRIBUTOR, VIEWER] },
      onDelete: ({ memberId }) => ({
        ok: true,
        status: 200,
        payload: { data: { deleted: true, collaborators: responses[memberId] }, error: null },
      }),
    });

    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Remove nina@example.com" }));
    await waitFor(() => expect(screen.queryByText("nina@example.com")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Remove pereira@example.com" }));

    // member-2's response still lists member-1; the already-removed row must not come back.
    await waitFor(() => expect(screen.queryByText("pereira@example.com")).toBeNull());
    expect(screen.queryByText("nina@example.com")).toBeNull();
    expect(screen.getByText("Access (1)")).toBeInTheDocument();
  });

  it("hides the access count and the empty state when the members fetch fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "test-csrf-token" }, error: null }),
        };
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    renderDialog();

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    // A load that never returned data must not claim the trip has nobody on it.
    expect(screen.queryByText("Access (0)")).toBeNull();
    expect(screen.queryByText("No collaborators added yet.")).toBeNull();
  });

  it("keeps the temporary-password field and its label", async () => {
    stubFetch({ members: { owner: OWNER, collaborators: [] } });

    renderDialog();

    expect(
      await screen.findByLabelText("Temporary password (new accounts only)"),
    ).toBeInTheDocument();
    expect(screen.getByText("No collaborators added yet.")).toBeInTheDocument();
  });
});
