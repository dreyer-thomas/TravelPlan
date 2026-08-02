// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import { Providers } from "./helpers/renderWithProviders";

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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByLabelText("Search place")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
    expect(screen.queryByLabelText("Location label (optional)")).toBeNull();
    expect(screen.getByText("No coordinates selected")).toBeInTheDocument();

    // AC8: "Remove stay" used color="error", which at the time resolved to MUI's default #d32f2f
    // because theme.ts defined no `error` palette entry (Story 7.11 has since added one, drawn from
    // `errorBorder`). Destructive actions use the text variant now regardless - the reason this
    // assertion survives is the treatment, not the missing palette entry.
    expect(screen.getByRole("button", { name: "Remove stay" })).toBeInTheDocument();
    expect(document.querySelectorAll(".MuiButton-colorError")).toHaveLength(0);
    expect(document.querySelectorAll(".MuiAlert-standardError")).toHaveLength(0);

    // AC6: the label move must not drift a single accessible name, and the uppercase must come from
    // CSS rather than from uppercasing the i18n value.
    const stayNameLabel = document.querySelector(`label[for="${screen.getByLabelText("Stay name").id}"]`) as HTMLElement;
    expect(stayNameLabel.textContent).toBe("Stay name");
    expect(getComputedStyle(stayNameLabel).textTransform).toBe("uppercase");
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
      <Providers language="en">
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
      </Providers>,
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
      <Providers language="en">
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
      </Providers>,
    );

    const input = await screen.findByLabelText("Check-in time");
    expect(input).toHaveValue("16:00");
    /*
      Story 6.18, AC1. jsdom renders `type="time"` as a plain text input and draws no picker, so the
      attribute is the only part of the fix this suite can see — the behaviour itself is a browser
      check. What it replaced was `inputMode: "numeric"`, which asks the OS for a digits-only keypad;
      neither iOS nor Android puts a colon on that keypad, so "16:00" could not be typed at all.
    */
    expect(input).toHaveAttribute("type", "time");
    expect(input).not.toHaveAttribute("inputmode");
  });

  /**
   * Review pass, and the one consequence of AC1 that is worth writing down rather than discovering.
   * A native time input reports `value === ""` for anything that is not a complete time — including
   * a *partial* entry, hours set and minutes blank. `timeRules` allows an empty value (clearing the
   * time is legitimate), so a half-finished entry now takes the same path a deliberate clear does:
   * `checkInTime: null`, no error, and the day view falls back to its assumed 16:00.
   *
   * The old free-text field answered `trips.stay.timeInvalid` to "16:" and blocked the save. That
   * message is kept — AC5 preserves validation messages — but it is no longer reachable from this
   * control, because a time input cannot hand back a malformed value to be judged. Pinned here so
   * the collapse of "invalid" into "empty" is a recorded property rather than a surprise; whether a
   * partial entry deserves its own error is a decision for a story that is allowed to change what
   * is accepted.
   */
  it("saves a cleared check-in time as null, the state a partial entry also produces", async () => {
    // The dialog also GETs this path for the payment schedule, so collect the bodies rather than
    // sifting `mock.calls`: the save is the only call that has one.
    const sentBodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      if (init?.body) sentBodies.push(String(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { accommodation: { id: "stay-1" } }, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
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
              checkInTime: "16:00",
              checkOutTime: null,
              location: null,
            },
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    const input = await screen.findByLabelText("Check-in time");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

    await waitFor(() => {
      expect(sentBodies).toHaveLength(1);
    });

    const body = JSON.parse(sentBodies[0]);
    expect(body.checkInTime).toBeNull();
    // No error was raised on the way through: the empty value is accepted, not judged.
    expect(screen.queryByText("Enter time as HH:mm")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("defaults check-out time for previous-night stays", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
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
      </Providers>,
    );

    const input = await screen.findByLabelText("Check-out time");
    expect(input).toHaveValue("10:00");
    // Story 6.18, AC1 — the check-out half of the same pair; see the note above.
    expect(input).toHaveAttribute("type", "time");
    expect(input).not.toHaveAttribute("inputmode");
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
      <Providers language="en">
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
      </Providers>,
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
      <Providers language="en">
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
      </Providers>,
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
