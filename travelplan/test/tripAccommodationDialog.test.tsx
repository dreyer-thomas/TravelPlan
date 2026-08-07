// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripAccommodationDialog, {
  STAY_ERROR_TAB,
  STAY_PANEL_FLOOR_SX,
  STAY_PANEL_MIN_HEIGHT,
  STAY_TAB_IDS,
} from "@/components/features/trips/TripAccommodationDialog";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/trips/documentUploads";
import { Providers } from "./helpers/renderWithProviders";

/**
 * Story 6.26 split this dialog's one column into four tabs, so a field is only in the DOM while its
 * own tab is selected. Every case below that reaches for a field outside `Basics` — the tab each open
 * starts on — says so with this helper rather than by index, because the tab *order* is a property the
 * story owns and a positional query would pass through a reordering that moved a field to a section it
 * does not belong to.
 */
const selectTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

/**
 * Each panel is `aria-labelledby` its own tab, so the panel element itself answers to the tab's
 * accessible name — and after the review renamed `trips.stay.tabCost` to "Cost", that is the name of
 * both a tab and a field. Narrowing to the control keeps the query on the label rather than falling
 * back to a test id.
 *
 * Byte-identical to `costField` in `tripDayPlanDialog.test.tsx`, which has needed it since Story 6.22:
 * `trips.plan.tabCost` and `trips.plan.costLabel` are both "Cost" there. That the same helper is now
 * required on both sides is a small confirmation the rename put the two dialogs on the same word.
 */
const costField = () => screen.getByLabelText("Cost", { selector: "input" });

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
    selectTab("Cost");
    fireEvent.change(costField(), { target: { value: "100.00" } });
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
    selectTab("Cost");

    const splitOption = await screen.findByLabelText("Split into multiple payments");
    expect(splitOption).toBeChecked();
    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    // Story 6.27 turned this row into `type="text"`, so `toHaveValue` reads the string the field
    // actually holds rather than the number a number input coerced it to. Tightened, not relaxed:
    // `50` passed against "50", "50.0" and "50.00" alike, and the exact string is the thing that has
    // to survive a round trip back through the parser.
    expect(amountInputs[0]).toHaveValue("50.00");
    expect(amountInputs[1]).toHaveValue("70.00");
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
      // "Cost", not "Payment": review of Story 6.26 settled the drift against the already-shipped
      // `trips.plan.tabCost`, so the two sibling dialogs name this identical section the same word.
      "Cost",
      "Place & notes",
      "Media & links",
    ]);
    // Every open starts here, whatever tab the previous stay's dialog was left on.
    expect(screen.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");

    expect(screen.getByLabelText("Stay name")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Check-in time")).toBeInTheDocument();
    // And the fields that left this column.
    expect(screen.queryByLabelText("Cost", { selector: "input" })).toBeNull();
    expect(screen.queryByLabelText("Link")).toBeNull();

    selectTab("Cost");
    expect(costField()).toBeInTheDocument();
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
   * only mounted while `Basics` is selected.
   *
   * **What this case does *not* pin** (corrected in review of Story 6.26 — the previous wording had it
   * exactly backwards). It said this test proved "react-hook-form still judges a field whose panel has
   * been unmounted". It does not, and react-hook-form does not: `shouldUnregister: false` keeps an
   * unmounted field's *value* but its built-in pass **skips the rules**, verified directly against a
   * minimal form. That is precisely why `collectRuleFailures` exists in the component. So the empty
   * name here is caught by that re-run, not by react-hook-form, and this case would pass either way —
   * it cannot surface the regression the old docstring claimed. The case below it, standing *on*
   * `Basics`, is the one that exercises react-hook-form's own pass.
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

    selectTab("Cost");
    fireEvent.change(costField(), { target: { value: "100.00" } });
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
    expect(screen.getByRole("tab", { name: /^Cost/ })).toHaveAttribute("aria-selected", "true");
    expect(costField()).toHaveFocus();
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

    selectTab("Cost");
    fireEvent.change(costField(), { target: { value: "120.00" } });

    selectTab("Place & notes");
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Lisbon" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Ask for a quiet room" } });

    selectTab("Media & links");
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/booking" } });

    selectTab("Basics");
    expect(screen.getByLabelText("Stay name")).toHaveValue("Harbor Hotel");
    selectTab("Cost");
    // Story 6.27: `type="text"`, so this is now the string that was typed rather than the number the
    // field coerced it to — which is the stricter reading of "keeps typed values".
    expect(costField()).toHaveValue("120.00");
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
    /*
      `height` is asserted **empty**, not merely different (review of Story 6.26).

      It was `expect(style.height).not.toBe("300px")`, which cannot fail: jsdom resolves `height` to
      `""` for every element whatever the component sets, so that line passed identically for
      `minHeight: 300`, `height: 300` and no rule at all — while its docstring claimed to pin the
      distinction. Asserting `""` is not much stronger on its own, so the real guard is the exported
      `STAY_PANEL_FLOOR_SX` below: it is the object the component spreads, and it can be checked for
      shape rather than for rendered pixels.
    */
    expect(style.height).toBe("");
    expect(STAY_PANEL_FLOOR_SX).toEqual({ minHeight: `${STAY_PANEL_MIN_HEIGHT}px` });
    expect(Object.keys(STAY_PANEL_FLOOR_SX)).not.toContain("height");
  });

  /**
   * Every case in this block was added by Story 6.26's code review, and each one was verified to FAIL
   * against the code as it stood before its fix. That order matters more than usual here: the story
   * shipped six passing cases for the marker mechanism while the marker was broken on its most common
   * path, because all six stood on a tab other than the one that owned the error.
   */
  describe("review of Story 6.26", () => {
    const csrfOnly = () =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        })) as unknown as typeof fetch,
      );

    type StayDay = NonNullable<Parameters<typeof TripAccommodationDialog>[0]["day"]>;
    const renderStay = (accommodation: StayDay["accommodation"] = null) =>
      render(
        <Providers language="en">
          <TripAccommodationDialog
            open
            tripId="trip-1"
            stayType="current"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation }}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

    /**
     * The headline finding. Saving from the tab that already owns the error marked **nothing** — no
     * colour, no glyph, no accessible name — while the field's own message rendered underneath.
     *
     * The cause was `useMemo(() => stayTabsWithErrors(errors), [errors])`: for its own built-in
     * validation pass react-hook-form mutates `_formState.errors` in place, so the identity never
     * changes and the memo never recomputes. AC2 names this exact case in words ("including when the
     * user is already standing on that tab") and no test covered it.
     */
    it("marks the tab it is already standing on when react-hook-form's own rule fails", async () => {
      csrfOnly();
      renderStay();

      // No tab switch: `Basics` is where every open starts, and `name` is mounted and `required`.
      fireEvent.click(await screen.findByRole("button", { name: "Save stay" }));

      expect(await screen.findByText("Stay name is required")).toBeInTheDocument();
      // The marker, in the accessible name — which carries the glyph and the colour with it.
      const basicsTab = await screen.findByRole("tab", { name: "Basics (contains errors)" });
      expect(basicsTab).toBeInTheDocument();
      expect(screen.getByLabelText("Stay name")).toHaveFocus();

      /*
        AC3 wants all three channels, and colour was missing on the *selected* tab — which, because
        AC2 auto-selects the tab that owns the error, is the only state this path leaves the user in.
        MUI's `textColor="primary"` variant emits `&.Mui-selected { color: primary.main }` at two
        classes of specificity and beat the single-class `color` on the root.

        Asserted as a computed colour, not by reading `sx`: the whole defect was about which of two
        rules the cascade picked, so an `sx` assertion would have passed before and after the fix.
      */
      expect(getComputedStyle(basicsTab).color).toBe("rgb(138, 90, 43)"); // warning.main #8A5A2B
      expect(getComputedStyle(basicsTab).color).not.toBe("rgb(75, 99, 88)"); // primary.main #4B6358

      // And the glyph, which inherits `currentColor` and so went green with it.
      expect(basicsTab.querySelectorAll("svg").length).toBe(1);

      // And it still clears on the fix, the way AC3 asks.
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      await waitFor(() => expect(screen.queryByRole("tab", { name: "Basics (contains errors)" })).toBeNull());
    });

    /**
     * AC3 says *every* tab with an error is marked. Two errors on two tabs used to need two saves:
     * react-hook-form's pass failed on the mounted field, so `onSubmit` never ran, so the re-run that
     * is the only thing which sees unmounted fields never ran either.
     */
    it("marks every tab that owns an error on the first save, not the second", async () => {
      csrfOnly();
      renderStay();

      // A bad link on `Media & links` …
      selectTab("Media & links");
      fireEvent.change(screen.getByLabelText("Link"), { target: { value: "not a url" } });
      // … and an empty name on `Basics`, which is where we press Save from.
      selectTab("Basics");
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByRole("tab", { name: "Basics (contains errors)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Media & links (contains errors)" })).toBeInTheDocument();
      // The reveal picks the first failure in *tab* order across both passes.
      expect(screen.getByRole("tab", { name: "Basics (contains errors)" })).toHaveAttribute("aria-selected", "true");
    });

    /**
     * Story 6.29, AC5's user-visible half. The write schema rejecting an unsupported scheme is only
     * half the promise: without the same check in this dialog's own rule the value passes the client
     * pass, the route answers 400, and the user reads the generic "Stay update failed" with no field
     * marked — technically stored-nothing, visibly a bug. `new URL("javascript:alert(1)")` parses, so
     * the old rule waved all three of these through. Nothing else in the suite submits them.
     */
    it.each(["javascript:alert(1)", "data:text/html,<h1>x", "ftp://x.example/a", "https:booking.example/x"])(
      "reports %s on the link field instead of failing the save (AC5)",
      async (link) => {
        csrfOnly();
        renderStay();

        fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
        selectTab("Media & links");
        fireEvent.change(screen.getByLabelText("Link"), { target: { value: link } });
        fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

        expect(await screen.findByText("Enter a valid http(s) link")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Media & links (contains errors)" })).toBeInTheDocument();
        // Not the generic banner: the point of the change is that the error lands on the field.
        expect(screen.queryByText("Stay update failed. Please try again.")).toBeNull();
      },
    );

    it("still accepts an ordinary booking link on the same field (AC5)", async () => {
      csrfOnly();
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      selectTab("Media & links");
      fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://booking.example/x" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(screen.queryByText("Enter a valid http(s) link")).toBeNull());
      expect(screen.queryByRole("tab", { name: "Media & links (contains errors)" })).toBeNull();
    });

    /**
     * AC3's "the marker clears as soon as the field is fixed rather than standing until the next save",
     * for `payments` — the one key with no registered input behind it, so nothing revalidated it.
     */
    it("clears a block-level payment error when the amounts are corrected", async () => {
      csrfOnly();
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      selectTab("Cost");
      fireEvent.change(costField(), { target: { value: "100.00" } });
      fireEvent.click(screen.getByLabelText("Split into multiple payments"));
      const amounts = screen.getAllByLabelText("Amount");
      const dates = screen.getAllByLabelText("Due date");
      fireEvent.change(amounts[0], { target: { value: "40.00" } });
      fireEvent.change(dates[0], { target: { value: "2026-11-01" } });
      fireEvent.change(amounts[1], { target: { value: "50.00" } });
      fireEvent.change(dates[1], { target: { value: "2026-11-02" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByText("Payments must add up to the total cost")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /^Cost \(contains errors\)/ })).toBeInTheDocument();

      // 40 + 60 = 100. Both the message and the marker have to go, without another save.
      fireEvent.change(screen.getAllByLabelText("Amount")[1], { target: { value: "60.00" } });
      await waitFor(() => expect(screen.queryByText("Payments must add up to the total cost")).toBeNull());
      expect(screen.queryByRole("tab", { name: /contains errors/ })).toBeNull();
    });

    /**
     * The same store, a different way in: a row-level error outlived the row itself. Switching back to
     * a single payment replaces the field array, so the tab stayed marked for a row that no longer
     * existed — a marker with nothing to fix and no message to explain it.
     */
    it("clears a row-level payment error when the payment mode switch removes the row", async () => {
      csrfOnly();
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      selectTab("Cost");
      fireEvent.change(costField(), { target: { value: "100.00" } });
      fireEvent.click(screen.getByLabelText("Split into multiple payments"));
      // Leave the second row's amount empty so that row fails on its own.
      fireEvent.change(screen.getAllByLabelText("Amount")[0], { target: { value: "100.00" } });
      fireEvent.change(screen.getAllByLabelText("Due date")[0], { target: { value: "2026-11-01" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByRole("tab", { name: /^Cost \(contains errors\)/ })).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText("Pay all now"));
      await waitFor(() => expect(screen.queryByRole("tab", { name: /contains errors/ })).toBeNull());
    });

    /**
     * AC2's third reveal path, which Task 2 names and no case covered: the server's field errors.
     */
    it("reveals, marks and focuses the tab a server field error names", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).includes("/api/auth/csrf")) {
            return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
          }
          return {
            ok: false,
            status: 422,
            json: async () => ({
              data: null,
              error: {
                code: "validation_error",
                message: "Invalid",
                details: { fieldErrors: { notes: ["Notes are too long"] } },
              },
            }),
          };
        }) as unknown as typeof fetch,
      );
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByRole("tab", { name: "Place & notes (contains errors)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Place & notes (contains errors)" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(await screen.findByText("Notes are too long")).toBeInTheDocument();
      expect(screen.getByLabelText("Notes")).toHaveFocus();
    });

    /**
     * The worst finding of the review, and the one furthest from anything a reader would suspect.
     *
     * `setError` used to run for every key the server named, including `location` and `tripDayId`,
     * which have no registered field. An error planted under such a key is one react-hook-form never
     * clears, and `handleSubmit` then routes to its *invalid* callback on every later press — forever,
     * never reaching `onSubmit`. So one rejection turned every subsequent Save into a silent no-op:
     * no request, no banner, no marker. The banner on the *first* failure is exactly what made it read
     * as handled.
     *
     * The assertion that matters is the second save reaching the network at all.
     */
    it("still saves after a server error naming a field the form does not surface", async () => {
      let saveAttempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/auth/csrf")) {
            return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
          }
          saveAttempts += 1;
          if (saveAttempts === 1) {
            return {
              ok: false,
              status: 422,
              json: async () => ({
                data: null,
                error: {
                  code: "validation_error",
                  message: "Invalid",
                  details: { fieldErrors: { tripDayId: ["Trip day is required"] } },
                },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ data: { accommodation: { id: "stay-1" } }, error: null }) };
        }) as unknown as typeof fetch,
      );
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      // AC2's stated guarantee: unmappable means the banner, not silence.
      expect(await screen.findByText("Stay update failed. Please try again.")).toBeInTheDocument();
      await waitFor(() => expect(saveAttempts).toBe(1));

      // The form is not wedged: a second press reaches the server.
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));
      await waitFor(() => expect(saveAttempts).toBe(2));
    });

    /**
     * Tommy's call in review: `location` is not a form field, but the Place tab *does* show it, in the
     * coordinate line. `locationSchemas.ts` caps the label at 200 characters and the geocoder's label
     * goes in untruncated, so this is an ordinary search result rather than a freak input.
     */
    it("selects the place tab for a server error on the location, which is not a form field", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).includes("/api/auth/csrf")) {
            return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
          }
          return {
            ok: false,
            status: 422,
            json: async () => ({
              data: null,
              error: {
                code: "validation_error",
                message: "Invalid",
                details: { fieldErrors: { "location.label": ["Location label must be at most 200 characters"] } },
              },
            }),
          };
        }) as unknown as typeof fetch,
      );
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Place & notes" })).toHaveAttribute("aria-selected", "true"),
      );
      // No form field was faulted, so no tab carries a marker and there is no inline slot to render
      // into. The banner carries the server's own wording — which names what to shorten, where the
      // generic "Stay update failed" would not — and the caret lands in the search box.
      expect(screen.getByText("Location label must be at most 200 characters")).toBeInTheDocument();
      expect(screen.getByLabelText("Search place")).toHaveFocus();
      expect(screen.queryByRole("tab", { name: /contains errors/ })).toBeNull();
    });

    /**
     * `nameRules` was `{ required }` alone while the re-run judged `!values.name.trim()`, and
     * react-hook-form's `required` accepts `"   "`. The visible consequence was an error the user could
     * dismiss by typing *more* of what caused it.
     */
    it("does not let a whitespace-only name clear its own error", async () => {
      csrfOnly();
      renderStay();

      fireEvent.change(await screen.findByLabelText("Stay name"), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByText("Stay name is required")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Basics (contains errors)" })).toBeInTheDocument();

      // A fourth space is still not a name. The message and the marker must both stand.
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "    " } });
      await waitFor(() => expect(screen.getByText("Stay name is required")).toBeInTheDocument());
      expect(screen.getByRole("tab", { name: "Basics (contains errors)" })).toBeInTheDocument();
    });

    /**
     * The rule re-run used to sit *after* the CSRF fetch, so a Save with an empty name issued a network
     * request before judging anything — and a failing token replaced the field error with
     * `errors.csrfMissing`. Before the tab split every one of these rules ran ahead of `onSubmit`, so
     * this restores that ordering as much as it fixes the masking.
     */
    it("shows the field error rather than a token error when the CSRF fetch fails", async () => {
      /*
        The token has to *fail* for this to test anything. Counting fetches does not work: the init
        effect has already cached a token, so `ensureCsrfToken` returns without a request whichever
        order the two blocks sit in — a first version of this case asserted the call count and passed
        against the unfixed code. What the ordering actually decides is which message the user gets
        when the token cannot be had, so that is what is asserted.
      */
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).includes("/api/auth/csrf")) {
            return { ok: false, status: 500, json: async () => ({ data: null, error: { code: "server_error", message: "nope" } }) };
          }
          throw new Error("the save must never be attempted with an empty name");
        }) as unknown as typeof fetch,
      );
      renderStay();

      // Empty name, pressed from a tab that does not show it.
      selectTab("Cost");
      fireEvent.click(await screen.findByRole("button", { name: "Save stay" }));

      // The field that is wrong, marked and revealed — not "Your session expired…".
      expect(await screen.findByRole("tab", { name: "Basics (contains errors)" })).toBeInTheDocument();
      expect(screen.getByText("Stay name is required")).toBeInTheDocument();
      expect(screen.queryByText("Security token missing. Please refresh and try again.")).toBeNull();
    });

    /**
     * AC4 names three things the round-trip case did not assert. The staged file is the one with real
     * teeth — `galleryFiles` is component state that also holds Story 6.25's discard guard open, so a
     * tab switch losing it would both drop the upload and quietly release the guard.
     */
    it("keeps a staged upload across a tab round trip, and asks to discard exactly once", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).includes("/api/auth/csrf")) {
            return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
          }
          return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
        }) as unknown as typeof fetch,
      );
      const onClose = vi.fn();
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
            onClose={onClose}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      selectTab("Media & links");
      const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["x"], "beach.jpg", { type: "image/jpeg" });
      fireEvent.change(picker, { target: { files: [file] } });
      expect(await screen.findByText("1 file(s) selected")).toBeInTheDocument();

      // Away and back.
      selectTab("Basics");
      selectTab("Media & links");
      expect(screen.getByText("1 file(s) selected")).toBeInTheDocument();

      // A staged file is unsaved input, so the X asks — exactly once, and not by closing outright.
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(await screen.findByRole("button", { name: "Discard changes" })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getAllByRole("button", { name: "Discard changes" })).toHaveLength(1);
    });

    /**
     * AC6 is compiler-enforced for *totality* — every form key names a tab — but nothing ties a key's
     * tab to the panel its field is actually rendered in. Mapping `notes` to `"media"` while its
     * `FormField` stays in the place panel compiles cleanly and produces the exact failure the map
     * exists to prevent. That agreement is a test's job, so here it is.
     */
    it("puts every mapped field in the panel its tab actually renders", async () => {
      csrfOnly();
      renderStay();
      await screen.findByRole("button", { name: "Save stay" });

      const fieldForKey: Partial<Record<keyof typeof STAY_ERROR_TAB, string>> = {
        name: "Stay name",
        checkInTime: "Check-in time",
        costCents: "Cost",
        notes: "Notes",
        link: "Link",
      };
      const tabLabel: Record<(typeof STAY_TAB_IDS)[number], string> = {
        basics: "Basics",
        cost: "Cost",
        place: "Place & notes",
        media: "Media & links",
      };

      for (const [key, label] of Object.entries(fieldForKey)) {
        const expectedTab = STAY_ERROR_TAB[key as keyof typeof STAY_ERROR_TAB];
        selectTab(tabLabel[expectedTab]);
        // `queryAll`, not `query`: "Cost" is the accessible name of both the tab and the field, so a
        // single-match query throws on ambiguity rather than answering the question being asked here,
        // which is only whether the field is present on the tab its key maps to.
        expect(screen.queryAllByLabelText(label as string).length).toBeGreaterThan(0);
      }
    });
  });

  /**
   * Story 9.1 — the document field on the `Medien & Links` tab.
   *
   * **These cases live here, and that is deliberate** (DW-53). The sibling `tripDayPlanDialog.test.tsx`
   * mocks `@mui/material` wholesale and that mock has drifted from real MUI, so anything that turns on
   * what MUI actually renders — a `Button`'s `disabled` reaching the DOM, a `Typography component="label"`
   * emitting a real `<label for>` that pairs with an input — can pass there against a component the
   * browser would render differently. This suite renders the real thing. The activity dialog's twins
   * exist too, and the Completion Notes say which suite proved what.
   */
  describe("Story 9.1 — documents on the media tab", () => {
    type StayDay = NonNullable<Parameters<typeof TripAccommodationDialog>[0]["day"]>;

    const SAVED_STAY: StayDay["accommodation"] = {
      id: "stay-1",
      name: "Harbor Hotel",
      notes: null,
      status: "planned",
      costCents: null,
      link: null,
      checkInTime: null,
      checkOutTime: null,
      location: null,
    };

    /**
     * CSRF, an empty photo gallery and whichever documents the case wants. Routed by URL rather than
     * by call order, because the two media fetches now share one effect and are not awaited in
     * sequence — a positional mock would answer the wrong one the day their timing changes.
     */
    const mediaFetch = (documents: Array<{ id: string; documentUrl: string; fileName: string; sortOrder: number }> = []) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/auth/csrf")) {
            return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
          }
          if (url.includes("/accommodations/documents")) {
            return { ok: true, status: 200, json: async () => ({ data: { documents }, error: null }) };
          }
          return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
        }) as unknown as typeof fetch,
      );

    const renderStay = (accommodation: StayDay["accommodation"], onClose = () => undefined) =>
      render(
        <Providers language="en">
          <TripAccommodationDialog
            open
            tripId="trip-1"
            stayType="current"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation }}
            onClose={onClose}
            onSaved={() => undefined}
          />
        </Providers>,
      );

    /**
     * The two file inputs, told apart by what they accept rather than by position.
     *
     * An index into the panel would keep passing if the two fields swapped places, and "a file placed
     * in one bucket never appears in the other" (AC2) is exactly the property such a query cannot see.
     * `application/pdf` is in one accept list and in neither photo one.
     */
    const photoInput = () =>
      document.querySelector('input[type="file"]:not([accept*="application/pdf"])') as HTMLInputElement | null;
    const documentInput = () =>
      document.querySelector('input[type="file"][accept*="application/pdf"]') as HTMLInputElement | null;

    const labelTextFor = (input: HTMLInputElement) =>
      document.querySelector(`label[for="${input.id}"]`)?.textContent ?? null;

    /** The `Upload` button inside one field's own subtree — the two share an accessible name. */
    const uploadButtonNear = (input: HTMLInputElement) => {
      const root = input.parentElement?.parentElement as HTMLElement;
      return within(root).getByRole("button", { name: "Upload" });
    };

    const pdf = (name = "Ticket Rom.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });

    /**
     * AC2, the criterion the whole field turns on: two fields on one tab whose labels say two
     * different things, so a JPEG's destination is the user's choice and not a guess.
     *
     * Written so it can fail. Reusing `trips.gallery.title` for the document field — the exact
     * shortcut the story forbids — leaves two labels reading "Image gallery" and no "Documents" at
     * all, and both the equality assertions and the inequality one below go red. Verified by making
     * that edit in the source and watching this case fail.
     */
    it("puts a document field beside the photo field, under a visibly different label", async () => {
      mediaFetch();
      renderStay(SAVED_STAY);
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");

      const photos = photoInput();
      const documents = documentInput();
      expect(photos).not.toBeNull();
      expect(documents).not.toBeNull();
      // Two inputs, not one element matched twice by two selectors.
      expect(photos).not.toBe(documents);

      expect(labelTextFor(photos!)).toBe("Image gallery");
      expect(labelTextFor(documents!)).toBe("Documents");
      expect(labelTextFor(documents!)).not.toBe(labelTextFor(photos!));

      // The accept list comes from `documentUploads.ts`, never spelled inline — `documentUploadAccept.
      // test.ts` scans the component tree for the literal, and this pins the value that arrives.
      expect(documents!.getAttribute("accept")).toBe(DOCUMENT_UPLOAD_ACCEPT);

      /*
        The 10 MB / format line, reached the way a screen reader reaches it. Asserted through
        `aria-describedby` rather than by `getByText`, because a hint that renders but is not wired to
        the input is sighted-only — and a green test defending a string nothing announces is one of the
        four weaknesses Story 5.11's review found.
      */
      const describedBy = (documents!.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      expect(describedBy.length).toBeGreaterThan(1);
      const description = describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      expect(description).toContain("Choose documents");
      expect(description).toContain("up to 10 MB each");
    });

    /**
     * Story 6.26 AC4 for the new field: a tab round trip loses nothing.
     *
     * The staging assertions are two-sided on purpose. "1 file(s) selected" appearing proves *a* file
     * is staged somewhere; `trips.documents.selectedFiles` and `trips.gallery.selectedFiles` are
     * separate keys whose English coincides, so on its own that text cannot say which bucket took the
     * PDF. The pair of `Upload` buttons can: the document field's goes live and the photo field's
     * stays disabled. Wiring the picker to `setGalleryFiles` would satisfy the first assertion and
     * fail both of the others.
     */
    it("keeps a staged document across a tab round trip, and puts it in the document bucket", async () => {
      mediaFetch();
      renderStay(SAVED_STAY);
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");
      fireEvent.change(documentInput()!, { target: { files: [pdf()] } });

      expect(await screen.findByText("1 file(s) selected")).toBeInTheDocument();
      expect(screen.getAllByText("1 file(s) selected")).toHaveLength(1);
      expect(uploadButtonNear(documentInput()!)).toBeEnabled();
      expect(uploadButtonNear(photoInput()!)).toBeDisabled();

      // Away and back.
      selectTab("Basics");
      selectTab("Media & links");

      expect(screen.getByText("1 file(s) selected")).toBeInTheDocument();
      expect(uploadButtonNear(documentInput()!)).toBeEnabled();
      expect(uploadButtonNear(photoInput()!)).toBeDisabled();
    });

    /**
     * AC7 / Story 6.25, both halves, on one fixture so the only difference between them is the staged
     * document.
     */
    it("asks to discard a staged document exactly once", async () => {
      mediaFetch();
      const onClose = vi.fn();
      renderStay(SAVED_STAY, onClose);
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");
      fireEvent.change(documentInput()!, { target: { files: [pdf()] } });
      await screen.findByText("1 file(s) selected");

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(await screen.findByRole("button", { name: "Discard changes" })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getAllByRole("button", { name: "Discard changes" })).toHaveLength(1);
    });

    /**
     * The negative, and the one that can actually fail: a guard term that reads "did the document
     * field ever mount" rather than "is anything staged" passes the case above and this one goes red.
     * The fixture is the one above with the `fireEvent.change` removed and nothing else.
     */
    it("does not ask when nothing was staged", async () => {
      mediaFetch();
      const onClose = vi.fn();
      renderStay(SAVED_STAY, onClose);
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");
      // The field is present and empty — the point is that its presence is not itself dirtiness.
      expect(documentInput()).not.toBeNull();
      expect(screen.getByText("No documents yet.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
    });

    /**
     * AC7's reopen half. `documentFiles` is otherwise cleared only by a successful upload, and this
     * dialog is never unmounted — so without the open effect's reset a document staged and then
     * discarded comes back selected on the next open, with the guard held dirty behind it for the rest
     * of the session. The gallery carries the scar tissue for exactly this.
     */
    it("forgets a document that was staged and then discarded", async () => {
      mediaFetch();
      const onClose = vi.fn();
      const view = render(
        <Providers language="en">
          <TripAccommodationDialog
            open
            tripId="trip-1"
            stayType="current"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: SAVED_STAY }}
            onClose={onClose}
            onSaved={() => undefined}
          />
        </Providers>,
      );
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");
      fireEvent.change(documentInput()!, { target: { files: [pdf()] } });
      await screen.findByText("1 file(s) selected");

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      const day = { id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: SAVED_STAY };
      view.rerender(
        <Providers language="en">
          <TripAccommodationDialog open={false} tripId="trip-1" stayType="current" day={day} onClose={onClose} onSaved={() => undefined} />
        </Providers>,
      );
      view.rerender(
        <Providers language="en">
          <TripAccommodationDialog open tripId="trip-1" stayType="current" day={day} onClose={onClose} onSaved={() => undefined} />
        </Providers>,
      );
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");
      expect(screen.queryByText("1 file(s) selected")).toBeNull();
      expect(uploadButtonNear(documentInput()!)).toBeDisabled();

      // And the guard is released with it: a reopened dialog nobody has touched closes silently.
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    /**
     * Add mode. The document field is gated on a saved stay the same way the gallery is, so the tab
     * has to say why it is absent — and say it about documents, not only about photos. Both negatives
     * are asserted, because "the field is missing" is satisfied just as well by a broken render.
     */
    it("explains the absent document field while adding a stay", async () => {
      mediaFetch();
      renderStay(null);
      await screen.findByRole("button", { name: "Save stay" });

      selectTab("Media & links");

      expect(screen.getByText("You can add photos once this stay is saved.")).toBeInTheDocument();
      expect(screen.getByText("You can add documents once this stay is saved.")).toBeInTheDocument();
      expect(screen.queryByText("Documents")).toBeNull();
      expect(documentInput()).toBeNull();
      // The link is still there, so the tab is not empty — which is why the link lives on it.
      expect(screen.getByLabelText("Link")).toBeInTheDocument();
    });
  });

  /**
   * Story 6.27. Reported from a German phone on 2026-08-05: `12,50` in the cost field saved the stay
   * with no cost at all. With `type="number"` jsdom sanitises a comma-decimal to `""` exactly as a
   * browser does, so these cases fail against the pre-6.27 code by asserting the *saved* value —
   * `costCents` arrived as `null`, not as an error. Anything that only reads the input's `value`
   * would pass on both sides of the fix and prove nothing.
   */
  describe("comma decimals", () => {
    /** Collects the save body; the dialog also GETs this path, and only the save carries one. */
    const saveFetch = (sentBodies: string[]) => {
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
      return fetchMock;
    };

    const renderEmptyStay = () =>
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

    it("saves a comma-decimal stay cost as the cents a period would have produced", async () => {
      const sentBodies: string[] = [];
      const fetchMock = saveFetch(sentBodies);

      renderEmptyStay();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Test Stay" } });
      selectTab("Cost");
      fireEvent.change(costField(), { target: { value: "12,50" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).costCents).toBe(1250);
    });

    it("saves a comma-decimal total split across comma-decimal payment rows", async () => {
      const sentBodies: string[] = [];
      const fetchMock = saveFetch(sentBodies);

      renderEmptyStay();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Test Stay" } });
      selectTab("Cost");
      fireEvent.change(costField(), { target: { value: "100,00" } });
      fireEvent.click(screen.getByLabelText("Split into multiple payments"));

      const amountInputs = screen.getAllByLabelText("Amount");
      const dateInputs = screen.getAllByLabelText("Due date");
      fireEvent.change(amountInputs[0], { target: { value: "50,00" } });
      fireEvent.change(dateInputs[0], { target: { value: "2026-11-01" } });
      fireEvent.change(amountInputs[1], { target: { value: "50,00" } });
      fireEvent.change(dateInputs[1], { target: { value: "2026-11-02" } });

      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      const body = JSON.parse(sentBodies[0]);
      expect(body.costCents).toBe(10000);
      expect(body.payments).toEqual([
        { amountCents: 5000, dueDate: "2026-11-01" },
        { amountCents: 5000, dueDate: "2026-11-02" },
      ]);
      expect(screen.queryByText("Payments must add up to the total cost")).toBeNull();
    });

    /**
     * The half of the story that is not about commas: once the field is `type="text"`, junk arrives
     * intact instead of arriving as `""`, and "empty means no cost" must no longer swallow it.
     */
    it("blocks the save and shows an error for an unparseable stay cost", async () => {
      const sentBodies: string[] = [];
      const fetchMock = saveFetch(sentBodies);

      renderEmptyStay();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Test Stay" } });
      selectTab("Cost");
      fireEvent.change(costField(), { target: { value: "abc" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByText("Enter an amount like 10.00 or 10,00 — at most 2 decimals")).toBeInTheDocument();
      expect(sentBodies).toHaveLength(0);
    });

    /**
     * Story 6.27 AC8b. jsdom's sanitisation is the only thing standing between a green suite and a
     * broken German phone, so the input type is asserted directly: a refactor putting `type="number"`
     * back would break every comma while the behavioural cases could be argued green again.
     */
    it("renders the cost and payment-amount fields as decimal text inputs", async () => {
      const fetchMock = saveFetch([]);
      renderEmptyStay();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      selectTab("Cost");
      expect(costField()).toHaveAttribute("type", "text");
      expect(costField()).toHaveAttribute("inputmode", "decimal");
      expect(costField()).toHaveAttribute("placeholder", "0.00");
      // Renders `trips.stay.costHelper`, which until this story was in both dictionaries and on no
      // screen.
      expect(screen.getByText("Optional amount (e.g. 10.00 or 10,00)")).toBeInTheDocument();

      const amount = screen.getByLabelText("Amount");
      expect(amount).toHaveAttribute("type", "text");
      expect(amount).toHaveAttribute("inputmode", "decimal");
      // AC1b: unrelated to the type change and easy to lose while rewriting the `htmlInput` object.
      expect(amount).toHaveAttribute("readonly");
    });

    it("shows a comma placeholder and the accepted forms under de, and saves a comma there", async () => {
      const sentBodies: string[] = [];
      const fetchMock = saveFetch(sentBodies);
      render(
        <Providers language="de">
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

      // The dialog opens on the basics tab, and its German label carries a soft hyphen (Story 6.26's
      // 390px fix), so the name is filled here rather than by querying that tab back by its text.
      fireEvent.change(screen.getByLabelText("Name der Unterkunft"), { target: { value: "Test Stay" } });

      selectTab("Kosten");
      // The separator the field wants, said in the language being read. Both are accepted either
      // way — this is rendering, and only rendering follows the locale.
      const cost = screen.getByLabelText("Kosten", { selector: "input" });
      expect(cost).toHaveAttribute("placeholder", "0,00");
      expect(screen.getByText("Optionaler Betrag (z. B. 10,00 oder 10.00)")).toBeInTheDocument();

      // The bug was reported in German, so the save is asserted in German too. Parsing does not read
      // the locale by design — this is the case that proves the design holds rather than assuming it.
      fireEvent.change(cost, { target: { value: "12,50" } });
      fireEvent.click(screen.getByRole("button", { name: "Unterkunft speichern" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).costCents).toBe(1250);
    });

    it("reports a filled-but-unparseable payment amount as invalid rather than missing", async () => {
      const sentBodies: string[] = [];
      const fetchMock = saveFetch(sentBodies);

      renderEmptyStay();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Test Stay" } });
      selectTab("Cost");
      fireEvent.change(costField(), { target: { value: "100,00" } });
      fireEvent.click(screen.getByLabelText("Split into multiple payments"));

      const amountInputs = screen.getAllByLabelText("Amount");
      const dateInputs = screen.getAllByLabelText("Due date");
      fireEvent.change(amountInputs[0], { target: { value: "abc" } });
      fireEvent.change(dateInputs[0], { target: { value: "2026-11-01" } });
      fireEvent.change(amountInputs[1], { target: { value: "50,00" } });
      fireEvent.change(dateInputs[1], { target: { value: "2026-11-02" } });

      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByText("Enter a valid amount")).toBeInTheDocument();
      expect(screen.queryByText("Payment amount is required")).toBeNull();
      expect(sentBodies).toHaveLength(0);
    });
  });

  /**
   * Story 6.28. The same rules as `tripDayPlanDialog.test.tsx`'s canonical block, in this dialog's own
   * idiom — the place field lives on the `Place & notes` tab here and the pending flag is `isGeocoding`.
   * Both surfaces are covered rather than one: the story's own Dev Notes say the five copies of this
   * handler must not diverge further, and the only way a suite can hold them to that is to ask each one.
   */
  describe("story 6.28 — coordinates by hand and a choice of places", () => {
    const geocodeFetch = (results: Array<{ lat: number; lng: number; label: string }>, sentBodies: string[] = []) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
        }
        if (url.includes("/api/geocode")) {
          return { ok: true, status: 200, json: async () => ({ data: { results }, error: null }) };
        }
        if (init?.body) sentBodies.push(String(init.body));
        return { ok: true, status: 200, json: async () => ({ data: { accommodation: { id: "stay-1" } }, error: null }) };
      }) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    // The CSRF fetch fires on mount, so "no request reached the geocoder" can only honestly be a
    // filtered call list — Trap 2.
    const geocodeCalls = (fetchMock: typeof fetch) =>
      (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
        String(call[0]).includes("/api/geocode"),
      );

    const renderPlace = async (
      results: Array<{ lat: number; lng: number; label: string }> = [],
      sentBodies: string[] = [],
      onClose: () => void = () => undefined,
    ) => {
      const fetchMock = geocodeFetch(results, sentBodies);
      render(
        <Providers language="en">
          <TripAccommodationDialog
            open
            tripId="trip-1"
            stayType="current"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
            onClose={onClose}
            onSaved={() => undefined}
          />
        </Providers>,
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      selectTab("Place & notes");
      return fetchMock;
    };

    const find = (value: string) => {
      fireEvent.change(screen.getByLabelText("Search place"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Find" }));
    };

    // AC1.
    it("resolves a typed coordinate pair without touching the geocoder", async () => {
      const fetchMock = await renderPlace();

      find("48.8584, 2.2945");

      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC2.
    it("resolves a pasted Google Maps URL without touching the geocoder", async () => {
      const fetchMock = await renderPlace();

      find("https://www.google.com/maps?q=48.8584,2.2945");

      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC4. A visible error and nothing set.
    it("faults an out-of-range pair and leaves the readout empty", async () => {
      const fetchMock = await renderPlace();

      find("48.0, 181.0");

      expect(await screen.findByText("Longitude must be between -180 and 180")).toBeInTheDocument();
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC5. Nothing is adopted until a row is activated, and the stored label is the row's.
    it("adopts nothing until a candidate row is activated", async () => {
      await renderPlace([
        { lat: 38.7223, lng: -9.1393, label: "Harbor Hotel, Lisbon" },
        { lat: 41.1579, lng: -8.6291, label: "Harbor Hotel, Porto" },
      ]);

      find("Harbor Hotel");

      expect(await screen.findByRole("button", { name: "Harbor Hotel, Lisbon" })).toBeInTheDocument();
      expect(screen.getByText("Select a place (2)")).toBeInTheDocument();
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Harbor Hotel, Porto" }));

      expect(await screen.findByText("Latitude: 41.157900 · Longitude: -8.629100")).toBeInTheDocument();
      expect(screen.getByLabelText("Search place")).toHaveValue("Harbor Hotel, Porto");
      expect(screen.queryByRole("button", { name: "Harbor Hotel, Lisbon" })).toBeNull();
    });

    // AC8. `Clear` still empties the location after the path that never saw a geocoder response.
    it("clears a manually entered pair", async () => {
      await renderPlace();

      find("48.8584, 2.2945");
      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
    });

    /**
     * Story 6.28 review, P10. DESIGN.md's `candidate-list` entry cites {typography.label-caps} for this
     * heading, and the component had a hand-rolled 11px/700/0.06em with no `text-transform` instead — so
     * the record and the code did not match. Real MUI here, so the variant's own uppercase is observable;
     * `role="status"` is asserted alongside it because the two live on the same element (P7).
     */
    it("renders the count heading with the labelCaps variant and announces it", async () => {
      await renderPlace([
        { lat: 38.7223, lng: -9.1393, label: "Harbor Hotel, Lisbon" },
        { lat: 41.1579, lng: -8.6291, label: "Harbor Hotel, Porto" },
      ]);

      find("Harbor Hotel");

      const heading = await screen.findByRole("status");
      expect(heading).toHaveTextContent("Select a place (2)");
      expect(window.getComputedStyle(heading).textTransform).toBe("uppercase");
      // P7: the rows are a named group, which a bare <div aria-labelledby> cannot be.
      expect(screen.getByRole("group", { name: "Select a place (2)" })).toBeInTheDocument();
    });

    /**
     * Story 6.28 review, P2. The rows answer the text as it was when *Find* was pressed, so they do not
     * survive an edit of it — activating a stale row would pin a place the field no longer names.
     */
    it("dismisses an unanswered candidate list when the place field is edited", async () => {
      await renderPlace([
        { lat: 38.7223, lng: -9.1393, label: "Harbor Hotel, Lisbon" },
        { lat: 41.1579, lng: -8.6291, label: "Harbor Hotel, Porto" },
      ]);

      find("Harbor Hotel");
      expect(await screen.findByRole("button", { name: "Harbor Hotel, Porto" })).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Harbor Hostel" } });

      expect(screen.queryByRole("button", { name: "Harbor Hotel, Porto" })).toBeNull();
      expect(screen.queryByText("Select a place (2)")).toBeNull();
    });

    /**
     * Story 6.28 review, P1. This dialog is never unmounted — the open effect resets `activeTab`,
     * `galleryFiles` and `documentFiles` for exactly that reason, each with a comment saying so — and an
     * unanswered candidate list is otherwise cleared only by a select, a *Clear* or a new *Find*. So stay
     * A's offer stood over stay B's empty field, and activating a row pinned A's place on B.
     */
    it("does not carry an unanswered candidate list into the next stay's dialog", async () => {
      const fetchMock = geocodeFetch([
        { lat: 38.7223, lng: -9.1393, label: "Harbor Hotel, Lisbon" },
        { lat: 41.1579, lng: -8.6291, label: "Harbor Hotel, Porto" },
      ]);
      const dialog = (open: boolean, dayId: string) => (
        <Providers language="en">
          <TripAccommodationDialog
            open={open}
            tripId="trip-1"
            stayType="current"
            day={{ id: dayId, date: "2026-11-01T00:00:00.000Z", dayIndex: 1, accommodation: null }}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>
      );

      const { rerender } = render(dialog(true, "day-1"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      selectTab("Place & notes");

      find("Harbor Hotel");
      expect(await screen.findByRole("button", { name: "Harbor Hotel, Porto" })).toBeInTheDocument();

      await act(async () => {
        rerender(dialog(false, "day-1"));
      });
      await act(async () => {
        rerender(dialog(true, "day-2"));
      });
      selectTab("Place & notes");

      expect(screen.queryByRole("button", { name: "Harbor Hotel, Porto" })).toBeNull();
      expect(screen.queryByText("Select a place (2)")).toBeNull();
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
    });

    /**
     * Story 6.28 review, P8. The helper line invites a typed pair and `locationQuery` is outside the dirty
     * key comparison, so a pair typed and saved without pressing *Find* was dropped silently — no pin, no
     * message, no prompt. The save path parses too, and still issues no geocode request.
     */
    it("saves a pair typed into the place field without pressing Find", async () => {
      const sentBodies: string[] = [];
      const fetchMock = await renderPlace([], sentBodies);

      fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "-36.8485, 174.7633" } });
      selectTab("Basics");
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Auckland Lookout" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).location).toEqual({
        lat: -36.8485,
        lng: 174.7633,
        label: "-36.848500, 174.763300",
      });
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    /**
     * The half of P8 that must **not** change: an unsearched place name still saves the stay with no
     * location and no request. Blocking the save, or geocoding behind the user's back, would both be new
     * behaviour on a field whose value is optional.
     */
    it("saves with no location when the place field holds an unsearched place name", async () => {
      const sentBodies: string[] = [];
      const fetchMock = await renderPlace([], sentBodies);

      fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Harbor Hotel" } });
      selectTab("Basics");
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).location).toBeNull();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC1's last clause: it saves, with the formatted pair standing in for the `display_name` a manual
    // entry does not have.
    it("saves a manually entered pair with the formatted pair as its label", async () => {
      const sentBodies: string[] = [];
      await renderPlace([], sentBodies);

      find("-36.8485, 174.7633");
      expect(await screen.findByText("Latitude: -36.848500 · Longitude: 174.763300")).toBeInTheDocument();

      selectTab("Basics");
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Auckland Lookout" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).location).toEqual({
        lat: -36.8485,
        lng: 174.7633,
        label: "-36.848500, 174.763300",
      });
    });

    /**
     * 6.28 follow-up review, the same collision `TripDayPlanDialog` carries. `Clear` nulled the coordinate
     * and left the text; `locationQuery` is seeded from the stored label, which for a hand-entered pair *is*
     * the pair; and the save path parses that text. So `Clear` then *Save stay* put the pin straight back
     * and a manually entered location could not be removed.
     */
    it("removes a manually entered location for good when Clear is pressed before Save", async () => {
      const sentBodies: string[] = [];
      await renderPlace([], sentBodies);

      find("-36.8485, 174.7633");
      expect(await screen.findByText("Latitude: -36.848500 · Longitude: 174.763300")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
      expect(screen.getByLabelText("Search place")).toHaveValue("");

      selectTab("Basics");
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Auckland Lookout" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).location).toBeNull();
    });

    /**
     * 6.28 follow-up review. *Save stay* on an unanswered candidate list saved with `location: null` in
     * silence — nothing was resolved, so the save-path parse answered `search` and the rows the user was
     * choosing between left with the dialog. The bucket list and the create form both refuse here.
     */
    it("refuses to save past an unanswered candidate list", async () => {
      const sentBodies: string[] = [];
      await renderPlace(
        [
          { lat: 38.7223, lng: -9.1393, label: "Harbor Hotel, Lisbon" },
          { lat: 41.1579, lng: -8.6291, label: "Harbor Hotel, Porto" },
        ],
        sentBodies,
      );

      find("Harbor Hotel");
      expect(await screen.findByRole("button", { name: "Harbor Hotel, Porto" })).toBeInTheDocument();

      selectTab("Basics");
      fireEvent.change(screen.getByLabelText("Stay name"), { target: { value: "Harbor Hotel" } });
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      expect(await screen.findByText("Select one of the places found.")).toBeInTheDocument();
      expect(sentBodies).toHaveLength(0);
      // Reported on the tab that holds the field, not on the one the user was standing on.
      expect(screen.getByRole("button", { name: "Harbor Hotel, Porto" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Harbor Hotel, Porto" }));
      /*
        6.28 follow-up review, the same clear the day-plan dialog and the bucket list carry: activating a
        row is the only answer to this message, so it must not outlive the answer.
      */
      expect(screen.queryByText("Select one of the places found.")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save stay" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).location).toEqual({
        lat: 41.1579,
        lng: -8.6291,
        label: "Harbor Hotel, Porto",
      });
    });

    /**
     * 6.28 follow-up review. `role="status"` announces a *change* in a region the screen reader was already
     * watching; the component used to return `null` while empty, so region and first text arrived together
     * and the announcement the design rests on was routinely never made. Real MUI here, so this is also the
     * check that an empty heading leaves no visible trace: no group, hence no stray bordered hairline.
     */
    it("keeps the count line's live region mounted before any search runs", async () => {
      await renderPlace([{ lat: 38.7223, lng: -9.1393, label: "Harbor Hotel, Lisbon" }]);

      expect(screen.getByRole("status")).toHaveTextContent("");
      expect(screen.queryByRole("group")).toBeNull();
    });

    /**
     * 6.28 follow-up review, the same hole the day-plan dialog had. `locationQuery` is excluded from the
     * dirty comparison because a search box persists nothing — but the pass before this one taught
     * `onSubmit` to parse it, so a typed pair *does* persist now, and the ✕ was closing on it without
     * asking. Only the `coordinates` reading enters the comparison.
     */
    it("asks before discarding a typed pair that was never resolved", async () => {
      const onClose = vi.fn();
      await renderPlace([], [], onClose);

      fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "48.8584, 2.2945" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    });

    // ...and a search *term* still holds nothing open, which is what the exclusion is for.
    it("closes without asking on an unresolved place name", async () => {
      const onClose = vi.fn();
      await renderPlace([], [], onClose);

      fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Harbor Hotel" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
