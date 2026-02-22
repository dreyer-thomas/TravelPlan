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
});
