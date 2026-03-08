// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import { I18nProvider } from "@/i18n/provider";

describe("TripAccommodationDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders place lookup with read-only coordinates text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripAccommodationDialog
          open
          tripId="trip-1"
          stayType="current"
          day={{
            id: "day-1",
            date: "2026-11-01T00:00:00.000Z",
            dayIndex: 1,
            accommodation: {
              id: "stay-1",
              name: "Harbor Hotel",
              notes: null,
              status: "planned",
              costCents: null,
              link: null,
              checkInTime: null,
              checkOutTime: null,
              location: null,
            },
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByLabelText("Search place")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
    expect(screen.queryByLabelText("Location label (optional)")).toBeNull();
    expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
  });

  it("submits with a fallback CSRF fetch when save is clicked before init token resolves", async () => {
    let csrfCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/api/auth/csrf")) {
        csrfCalls += 1;
        if (csrfCalls === 1) {
          return new Promise<Response>(() => {
            // keep the initial dialog-load request pending to simulate a slow network
          });
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-fallback" }, error: null }),
        };
      }

      if (url.includes("/api/trips/trip-1/accommodations")) {
        expect(init?.method).toBe("PATCH");
        expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-fallback");
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { accommodation: { id: "stay-1" } }, error: null }),
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ data: null, error: { code: "not_found", message: "Not found" } }),
      };
    }) as unknown as typeof fetch;

    const onSaved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripAccommodationDialog
          open
          tripId="trip-1"
          stayType="current"
          day={{
            id: "day-1",
            date: "2026-11-01T00:00:00.000Z",
            dayIndex: 1,
            accommodation: {
              id: "stay-1",
              name: "Harbor Hotel",
              notes: null,
              status: "planned",
              costCents: null,
              link: null,
              checkInTime: null,
              checkOutTime: null,
              location: null,
            },
          }}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(csrfCalls).toBeGreaterThanOrEqual(2));
  });

  it("defaults check-in time for current-night stays", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripAccommodationDialog
          open
          tripId="trip-1"
          stayType="current"
          day={{
            id: "day-1",
            date: "2026-11-01T00:00:00.000Z",
            dayIndex: 1,
            accommodation: {
              id: "stay-1",
              name: "Harbor Hotel",
              notes: null,
              status: "planned",
              costCents: null,
              link: null,
              checkInTime: null,
              checkOutTime: null,
              location: null,
            },
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    const input = await screen.findByLabelText("Check-in time");
    expect(input).toHaveValue("16:00");
  });

  it("defaults check-out time for previous-night stays", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripAccommodationDialog
          open
          tripId="trip-1"
          stayType="previous"
          day={{
            id: "day-0",
            date: "2026-10-31T00:00:00.000Z",
            dayIndex: 0,
            accommodation: {
              id: "stay-0",
              name: "Previous Hotel",
              notes: null,
              status: "planned",
              costCents: null,
              link: null,
              checkInTime: null,
              checkOutTime: null,
              location: null,
            },
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    const input = await screen.findByLabelText("Check-out time");
    expect(input).toHaveValue("10:00");
  });

  it("blocks save when split payments do not match the total cost", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ data: null, error: { code: "not_found", message: "Not found" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripAccommodationDialog
          open
          tripId="trip-1"
          stayType="current"
          day={{
            id: "day-1",
            date: "2026-11-01T00:00:00.000Z",
            dayIndex: 1,
            accommodation: null,
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Test Stay" } });
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByLabelText("Split into multiple payments"));

    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    fireEvent.change(amountInputs[0], { target: { value: "40.00" } });
    fireEvent.change(dateInputs[0], { target: { value: "2026-11-01" } });
    fireEvent.change(amountInputs[1], { target: { value: "50.00" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-11-02" } });

    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

    expect(await screen.findByText("Payments must add up to the total cost")).toBeInTheDocument();
    const accommodationCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/accommodations"));
    expect(accommodationCalls).toHaveLength(0);
  });

  it("loads payment schedule when editing an accommodation cost", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripAccommodationDialog
          open
          tripId="trip-1"
          stayType="current"
          day={{
            id: "day-1",
            date: "2026-11-01T00:00:00.000Z",
            dayIndex: 1,
            accommodation: {
              id: "stay-1",
              name: "Harbor Hotel",
              notes: null,
              status: "planned",
              costCents: 12000,
              payments: [
                { amountCents: 5000, dueDate: "2026-11-01" },
                { amountCents: 7000, dueDate: "2026-11-02" },
              ],
              link: null,
              checkInTime: null,
              checkOutTime: null,
              location: null,
            },
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    const splitOption = await screen.findByLabelText("Split into multiple payments");
    expect(splitOption).toBeChecked();
    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    expect(amountInputs[0]).toHaveValue(50);
    expect(amountInputs[1]).toHaveValue(70);
    expect(dateInputs[0]).toHaveValue("2026-11-01");
    expect(dateInputs[1]).toHaveValue("2026-11-02");
  });
});
