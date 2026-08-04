// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripAccommodationDialog, {
  STAY_PANEL_MIN_HEIGHT,
} from "@/components/features/trips/TripAccommodationDialog";
import { Providers } from "./helpers/renderWithProviders";

/**
 * Story 6.26 split this dialog's one column into four tabs, so a field is only in the DOM while its
 * own tab is selected. Every case below that reaches for a field outside `Basics` — the tab each open
 * starts on — says so with this helper rather than by index, because the tab *order* is a property the
 * story owns and a positional query would pass through a reordering that moved a field to a section it
 * does not belong to.
 */
const selectTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

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

    // AC6: the label move must not drift a single accessible name, and the uppercase must come from
    // CSS rather than from uppercasing the i18n value. Asserted before the tab switch, because the
    // name field belongs to `Basics`.
    const stayNameLabel = document.querySelector(`label[for="${screen.getByLabelText("Stay name").id}"]`) as HTMLElement;
    expect(stayNameLabel.textContent).toBe("Stay name");
    expect(getComputedStyle(stayNameLabel).textTransform).toBe("uppercase");

    // AC8: "Remove stay" used color="error", which at the time resolved to MUI's default #d32f2f
    // because theme.ts defined no `error` palette entry (Story 7.11 has since added one, drawn from
    // `errorBorder`). Destructive actions use the text variant now regardless - the reason this
    // assertion survives is the treatment, not the missing palette entry. It sits in the footer, so
    // it is reachable from every tab.
    expect(screen.getByRole("button", { name: "Remove stay" })).toBeInTheDocument();
    expect(document.querySelectorAll(".MuiButton-colorError")).toHaveLength(0);
    expect(document.querySelectorAll(".MuiAlert-standardError")).toHaveLength(0);

    // Story 6.26: the place lookup moved to its own tab, together with the notes.
    selectTab("Place & notes");
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
    selectTab("Payment");
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

    await screen.findByLabelText("Stay name");
    selectTab("Payment");

    const splitOption = await screen.findByLabelText("Split into multiple payments");
    expect(splitOption).toBeChecked();
    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    expect(amountInputs[0]).toHaveValue(50);
    expect(amountInputs[1]).toHaveValue(70);
    expect(dateInputs[0]).toHaveValue("2026-11-01");
    expect(dateInputs[1]).toHaveValue("2026-11-02");
  });

  /**
   * Story 6.26. The four sections and what each holds.
   *
   * Asserted field by field rather than by counting tabs, because AC1's substance is the *grouping* —
   * "the dialog has four tabs" would still pass if the cost box sat next to the notes. The pairs also
   * pin AC1's other half: no tab holds a single field, including the `Media & links` tab while adding
   * a stay, which is why the link moved there from the basics column.
   */
  it("splits the form into four named sections, none of them a single field", async () => {
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

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Basics",
      "Payment",
      "Place & notes",
      "Media & links",
    ]);
    // Every open starts here, whatever tab the previous stay's dialog was left on.
    expect(screen.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");

    expect(screen.getByLabelText("Stay name")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Check-in time")).toBeInTheDocument();
    // And the fields that left this column.
    expect(screen.queryByLabelText("Cost")).toBeNull();
    expect(screen.queryByLabelText("Link")).toBeNull();

    selectTab("Payment");
    expect(screen.getByLabelText("Cost")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay all now")).toBeInTheDocument();
    expect(screen.getByLabelText("Split into multiple payments")).toBeInTheDocument();

    selectTab("Place & notes");
    expect(screen.getByLabelText("Search place")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();

    selectTab("Media & links");
    expect(screen.getByLabelText("Link")).toBeInTheDocument();
    expect(screen.getByText("Image gallery")).toBeInTheDocument();
  });

  /**
   * AC1's add-mode half, which is the reason the link is on the media tab at all: the gallery is gated
   * on a saved stay, so without the link that tab would be empty while adding one.
   */
  it("keeps the media tab non-empty while adding a stay, and says why the gallery is absent", async () => {
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    selectTab("Media & links");

    expect(screen.getByLabelText("Link")).toBeInTheDocument();
    expect(screen.getByText("You can add photos once this stay is saved.")).toBeInTheDocument();
    expect(screen.queryByText("Image gallery")).toBeNull();
  });

  /**
   * AC2/AC3, and the criterion the whole story turns on: an error on a tab the user is not looking at
   * is worse than the long scroll this replaced.
   *
   * The fixture is the one that could genuinely have broken. `name` is `required`, and its field is
   * only mounted while `Basics` is selected — so this case also pins that react-hook-form still judges
   * a field whose panel has been unmounted (`shouldUnregister` defaults to false, which is what keeps
   * the value *and* the rule alive). If that ever changes, an empty name would sail past the client
   * and come back as a server error instead, and this test is where it would surface.
   */
  it("selects, marks and focuses the tab that owns a validation error", async () => {
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Stand somewhere else entirely, leaving the required name empty.
    selectTab("Place & notes");
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

    expect(await screen.findByText("Stay name is required")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Basics/ })).toHaveAttribute("aria-selected", "true");
    // The marker is in the accessible name too, not colour and a glyph alone.
    expect(screen.getByRole("tab", { name: "Basics (contains errors)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Stay name")).toHaveFocus();

    // And the marker clears once the field is fixed, rather than standing until the next save.
    fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Basics (contains errors)" })).toBeNull());
  });

  /** The same path for a payment error, which lives two tabs away from where the save is pressed. */
  it("switches to the payment tab when the split payments do not add up", async () => {
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });

    selectTab("Payment");
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByLabelText("Split into multiple payments"));
    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    fireEvent.change(amountInputs[0], { target: { value: "40.00" } });
    fireEvent.change(dateInputs[0], { target: { value: "2026-11-01" } });
    fireEvent.change(amountInputs[1], { target: { value: "50.00" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-11-02" } });

    // Walk away from the tab that owns the error before saving.
    selectTab("Basics");
    fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

    expect(await screen.findByText("Payments must add up to the total cost")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Payment/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Cost")).toHaveFocus();
  });

  /**
   * AC4. Tabs are random access, so a value typed on one and left behind on another has to survive the
   * round trip — the panels unmount, and react-hook-form only keeps their values because
   * `shouldUnregister` is false. The location is included because it lives *outside* the form, in
   * component state the geocode lookup writes.
   */
  it("keeps typed values across a tab round trip", async () => {
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });

    selectTab("Payment");
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "120.00" } });

    selectTab("Place & notes");
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Lisbon" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Ask for a quiet room" } });

    selectTab("Media & links");
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/booking" } });

    selectTab("Basics");
    expect(screen.getByLabelText("Stay name")).toHaveValue("Harbor Hotel");
    selectTab("Payment");
    expect(screen.getByLabelText("Cost")).toHaveValue(120);
    selectTab("Place & notes");
    expect(screen.getByLabelText("Search place")).toHaveValue("Lisbon");
    expect(screen.getByLabelText("Notes")).toHaveValue("Ask for a quiet room");
    selectTab("Media & links");
    expect(screen.getByLabelText("Link")).toHaveValue("https://example.com/booking");
  });

  /**
   * AC5. The floor is a `minHeight`, and the distinction from `height` is the assertion — a fixed
   * height would clip the split-payment rows and the photo strip, both of which are unbounded. Held
   * against the exported constant rather than a literal so the number lives in one place, and read off
   * the element's own style because jsdom resolves no layout: what the frame *does* with the floor is a
   * browser check, recorded in the story.
   */
  it("puts a minimum height under the tab panels, not a fixed one", async () => {
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    const floor = await screen.findByTestId("stay-tabpanel-floor");
    const style = getComputedStyle(floor);
    expect(style.minHeight).toBe(`${STAY_PANEL_MIN_HEIGHT}px`);
    expect(style.height).not.toBe(`${STAY_PANEL_MIN_HEIGHT}px`);
  });
});
