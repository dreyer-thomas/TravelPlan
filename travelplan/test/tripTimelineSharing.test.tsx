// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { I18nProvider } from "@/i18n/provider";

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripEditDialog", () => ({
  default: () => <div data-testid="edit-dialog" />,
}));

vi.mock("@/components/features/trips/TripDeleteDialog", () => ({
  default: () => <div data-testid="delete-dialog" />,
}));

vi.mock("@/components/features/trips/TripImportDialog", () => ({
  default: () => <div data-testid="import-dialog" />,
}));

vi.mock("@/components/features/trips/TripOverviewMapPanel", () => ({
  default: () => <div data-testid="overview-map-panel" />,
}));

vi.mock("@/components/features/trips/TripBucketListPanel", () => ({
  default: () => <div data-testid="bucket-list-panel" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("TripTimeline sharing", () => {
  const setMatchMedia = (width: number) => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => {
        const maxWidthMatch = /max-width:\s*(\d+(\.\d+)?)px/.exec(query);
        const minWidthMatch = /min-width:\s*(\d+(\.\d+)?)px/.exec(query);
        const maxWidth = maxWidthMatch ? Number(maxWidthMatch[1]) : Infinity;
        const minWidth = minWidthMatch ? Number(minWidthMatch[1]) : 0;
        const matches = width >= minWidth && width <= maxWidth;
        return {
          matches,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        };
      },
    });
  };

  it("opens the share dialog, submits a collaborator, and renders the updated list", async () => {
    setMatchMedia(1280);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: {
                id: "trip-1",
                name: "Trip",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 2,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
              },
              days: [],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/auth/csrf") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { csrfToken: "test-csrf-token" },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/members") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              collaborators: [],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/members") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              collaborator: {
                email: "viewer@example.com",
                role: "viewer",
              },
              collaborators: [
                {
                  email: "viewer@example.com",
                  role: "viewer",
                },
              ],
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await userEvent.click(screen.getByRole("button", { name: "Share trip" }));

    expect(await screen.findByRole("dialog", { name: "Share trip" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Email"), "viewer@example.com");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "viewer");
    await userEvent.type(screen.getByLabelText("Temporary password (new accounts only)"), "TempPass123");
    await userEvent.click(screen.getByRole("button", { name: "Add collaborator" }));

    const collaboratorEmail = await screen.findByText("viewer@example.com");
    expect(collaboratorEmail).toBeInTheDocument();
    expect(collaboratorEmail.closest("li")).toHaveTextContent("Viewer");

    vi.unstubAllGlobals();
  });

  it("links an existing account successfully and keeps same-trip duplicates explicit", async () => {
    setMatchMedia(1280);

    let memberPostCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: {
                id: "trip-1",
                name: "Trip",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 2,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
              },
              days: [],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/auth/csrf") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { csrfToken: "test-csrf-token" },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/members") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              collaborators: [],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/members") && method === "POST") {
        memberPostCount += 1;
        if (memberPostCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                accountAction: "linked_existing_account",
                collaborator: {
                  email: "existing@example.com",
                  role: "contributor",
                },
                collaborators: [
                  {
                    email: "existing@example.com",
                    role: "contributor",
                  },
                ],
              },
              error: null,
            }),
          };
        }

        return {
          ok: false,
          status: 409,
          json: async () => ({
            data: null,
            error: {
              code: "trip_member_exists",
              message: "Collaborator is already linked to this trip",
            },
          }),
        };
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await userEvent.click(screen.getByRole("button", { name: "Share trip" }));

    const dialog = await screen.findByRole("dialog", { name: "Share trip" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Temporary password (new accounts only)")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Email"), "existing@example.com");
    await userEvent.selectOptions(within(dialog).getByLabelText("Role"), "contributor");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add collaborator" }));

    expect(await within(dialog).findByText("Collaborator linked successfully.")).toBeInTheDocument();
    const existingCollaborator = within(dialog).getByText("existing@example.com");
    expect(existingCollaborator).toBeInTheDocument();
    expect(existingCollaborator.closest("li")).toHaveTextContent("Contributor");

    await userEvent.type(within(dialog).getByLabelText("Email"), "existing@example.com");
    await userEvent.selectOptions(within(dialog).getByLabelText("Role"), "contributor");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add collaborator" }));

    expect(await within(dialog).findByText("This person is already linked to the trip.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows a dedicated owner-email error and handles request failures gracefully", async () => {
    setMatchMedia(1280);

    let memberPostCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/trips/trip-1") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              trip: {
                id: "trip-1",
                name: "Trip",
                startDate: "2026-12-01T00:00:00.000Z",
                endDate: "2026-12-02T00:00:00.000Z",
                dayCount: 2,
                plannedCostTotal: 0,
                accommodationCostTotalCents: null,
                heroImageUrl: null,
              },
              days: [],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/auth/csrf") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { csrfToken: "test-csrf-token" },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/members") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              collaborators: [],
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/members") && method === "POST") {
        memberPostCount += 1;
        if (memberPostCount === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              data: null,
              error: {
                code: "trip_owner_email",
                message: "Trip owner is already linked to this trip",
              },
            }),
          };
        }

        throw new Error("Network failure");
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripTimeline tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1", expect.anything()));

    await userEvent.click(screen.getByRole("button", { name: "Share trip" }));

    const dialog = await screen.findByRole("dialog", { name: "Share trip" });

    await userEvent.type(within(dialog).getByLabelText("Email"), "owner@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add collaborator" }));

    expect(await within(dialog).findByText("You cannot add the trip owner's email as a collaborator.")).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText("Email"));
    await userEvent.type(within(dialog).getByLabelText("Email"), "viewer@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add collaborator" }));

    expect(await within(dialog).findByText("Unable to add collaborator. Please try again.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
