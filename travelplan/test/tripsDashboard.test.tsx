// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripsDashboard from "@/components/features/trips/TripsDashboard";

const mockTripsResponse = {
  data: { trips: [] },
  error: null,
};

const mockCsrfResponse = {
  data: { csrfToken: "test-token" },
  error: null,
};

const mockCreateResponse = {
  data: {
    trip: {
      id: "trip-123",
      name: "Autumn in Oslo",
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-12T00:00:00.000Z",
    },
    dayCount: 3,
  },
  error: null,
};

describe("TripsDashboard", () => {
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

      if (url.includes("/api/trips") && method === "GET") {
        return {
          ok: true,
          json: async () => mockTripsResponse,
        } as Response;
      }

      if (url.includes("/api/trips") && method === "POST") {
        return {
          ok: true,
          json: async () => mockCreateResponse,
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it("shows an Add trip button instead of the inline create form", async () => {
    render(<TripsDashboard />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /add trip/i }).length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/create a new trip/i)).not.toBeInTheDocument();
  });

  it("opens the create trip dialog when the Add trip button is clicked", async () => {
    const user = userEvent.setup();
    render(<TripsDashboard />);

    const [addButton] = await screen.findAllByRole("button", { name: /add trip/i });
    await user.click(addButton);

    const dialog = screen.getByRole("dialog");
    const dialogScope = within(dialog);
    expect(dialogScope.getByText(/create a new trip/i)).toBeInTheDocument();
    expect(dialogScope.getByLabelText(/trip name/i)).toBeInTheDocument();
    expect(dialogScope.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(dialogScope.getByLabelText(/end date/i)).toBeInTheDocument();
  });

  it("closes the dialog and updates the list after a successful create", async () => {
    const user = userEvent.setup();
    render(<TripsDashboard />);

    const [addButton] = await screen.findAllByRole("button", { name: /add trip/i });
    await user.click(addButton);

    const dialog = screen.getByRole("dialog");
    const dialogScope = within(dialog);

    await user.type(dialogScope.getByLabelText(/trip name/i), "Autumn in Oslo");
    await user.type(dialogScope.getByLabelText(/start date/i), "2026-02-10");
    await user.type(dialogScope.getByLabelText(/end date/i), "2026-02-12");

    await user.click(dialogScope.getByRole("button", { name: /create trip/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Autumn in Oslo")).toBeInTheDocument();
  });
});
