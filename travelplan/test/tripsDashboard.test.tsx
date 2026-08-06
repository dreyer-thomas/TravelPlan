// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import TripsDashboard from "@/components/features/trips/TripsDashboard";
import { renderWithProviders } from "./helpers/renderWithProviders";

// "Today" is pinned so the four date-driven statuses are deterministic. Every date below is a
// UTC-normalized date-only value, matching what the write path stores.
const TODAY = new Date("2026-08-01T09:30:00.000Z");

const trip = (overrides: Record<string, unknown>) => ({
  id: "trip-x",
  name: "Trip",
  // The list is owner-OR-member since Story 5.12 and a row without this field is treated as shared,
  // so the default has to be explicit: without it every fixture below would render a viewer pill.
  accessRole: "owner",
  startDate: "2026-09-12T00:00:00.000Z",
  endDate: "2026-09-24T00:00:00.000Z",
  dayCount: 13,
  heroImageUrl: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
  openDayCount: 0,
  planItemCount: 8,
  plannedCostTotal: 234_000,
  startLocationLabel: null,
  destinationLocationLabel: null,
  ...overrides,
});

// One gap trip (3 days open), one planned, one upcoming, one past.
const FOUR_STATE_TRIPS = [
  trip({ id: "gap", name: "Portugal Roadtrip", openDayCount: 3, planItemCount: 8, plannedCostTotal: 234_000 }),
  trip({
    id: "planned",
    name: "City break Copenhagen",
    startDate: "2026-10-03T00:00:00.000Z",
    endDate: "2026-10-06T00:00:00.000Z",
    dayCount: 4,
    openDayCount: 0,
    planItemCount: 5,
    plannedCostTotal: 89_000,
  }),
  trip({
    id: "upcoming",
    name: "Alpine hiking week",
    startDate: "2026-12-14T00:00:00.000Z",
    endDate: "2026-12-21T00:00:00.000Z",
    dayCount: 8,
    openDayCount: 8,
    planItemCount: 0,
    plannedCostTotal: 0,
  }),
  trip({
    id: "past",
    name: "Tuscany wine trip",
    startDate: "2026-05-02T00:00:00.000Z",
    endDate: "2026-05-09T00:00:00.000Z",
    dayCount: 8,
    openDayCount: 2,
    planItemCount: 6,
    plannedCostTotal: 148_000,
  }),
];

let mockTripsResponse: { data: { trips: unknown[] } | null; error: unknown } = {
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
      heroImageUrl: "/uploads/trips/trip-123/hero.webp" as string | null,
    },
    dayCount: 3,
  },
  error: null,
};

describe("TripsDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: TODAY });
    mockTripsResponse = { data: { trips: [] }, error: null };
    // `mockCreateResponse` is module-scope and mutable, so every field a test overwrites is restored
    // here rather than at the end of that test - otherwise a failed assertion skips the restore and
    // leaks the override into every test that follows.
    mockCreateResponse.data.trip.heroImageUrl = "/uploads/trips/trip-123/hero.webp";
    mockCreateResponse.data.trip.startDate = "2026-02-10T00:00:00.000Z";
    mockCreateResponse.data.trip.endDate = "2026-02-12T00:00:00.000Z";

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

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderDashboard = () => renderWithProviders(<TripsDashboard />);

  const rowFor = async (name: RegExp) => {
    const rows = await screen.findAllByTestId("trip-row");
    const row = rows.find((candidate) => name.test(candidate.textContent ?? ""));
    expect(row).toBeDefined();
    return row!;
  };

  it("shows an Add trip button instead of the inline create form", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /add trip/i }).length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/create a new trip/i)).not.toBeInTheDocument();
  });

  it("opens the create trip dialog when the Add trip button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();

    const [addButton] = await screen.findAllByRole("button", { name: /add trip/i });
    await user.click(addButton);

    const dialog = screen.getByRole("dialog");
    const dialogScope = within(dialog);
    expect(dialogScope.getByText(/create a new trip/i)).toBeInTheDocument();
    expect(dialogScope.getByLabelText(/trip name/i)).toBeInTheDocument();
    expect(dialogScope.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(dialogScope.getByLabelText(/end date/i)).toBeInTheDocument();
  });

  describe("import entry point", () => {
    // Story 2.32 AC6. The control lives here rather than on the trip overview: an import creates or
    // replaces a whole trip, and Story 7.8 removed the overview's copy deliberately.
    const importButton = () => screen.getByRole("button", { name: /^import backup$/i });

    it("offers an Import backup control beside Add trip, with no dialog mounted until it is used", async () => {
      renderDashboard();

      await waitFor(() => expect(importButton()).toBeInTheDocument());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/backup file/i)).not.toBeInTheDocument();
    });

    it("keeps the control off the individual trip rows", async () => {
      mockTripsResponse = { data: { trips: FOUR_STATE_TRIPS }, error: null };
      renderDashboard();

      const rows = await screen.findAllByTestId("trip-row");
      for (const row of rows) {
        // A row is a link into one trip; import is not a per-trip action, and putting it here would
        // make "overwrite" look like it targets the row it sits on.
        expect(within(row).queryByRole("button", { name: /import/i })).not.toBeInTheDocument();
      }
      expect(screen.getAllByRole("button", { name: /^import backup$/i })).toHaveLength(1);
    });

    it("opens the import dialog on click", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDashboard();

      await waitFor(() => expect(importButton()).toBeInTheDocument());
      await user.click(importButton());

      const dialogScope = within(screen.getByRole("dialog"));
      expect(dialogScope.getByText("Import trip backup")).toBeInTheDocument();
      expect(dialogScope.getByLabelText("Backup file")).toBeInTheDocument();
      expect(dialogScope.getByRole("button", { name: "Start import" })).toBeInTheDocument();
    });

    it("refetches the trip list once an import reports success", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const baseFetch = global.fetch;
      let listFetches = 0;

      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/trips/import")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                trip: {
                  id: "imported",
                  name: "Restored Lofoten",
                  startDate: "2026-09-12T00:00:00.000Z",
                  endDate: "2026-09-24T00:00:00.000Z",
                  heroImageUrl: null,
                },
                dayCount: 13,
                mode: "createNew",
                travelSegmentCount: 2,
                bucketListItemCount: 1,
                photoCount: 4,
              },
              error: null,
            }),
          } as Response;
        }
        if (url.includes("/api/trips") && (init?.method ?? "GET") === "GET") {
          listFetches += 1;
        }
        return baseFetch(input, init);
      }) as unknown as typeof fetch;

      renderDashboard();
      await waitFor(() => expect(listFetches).toBe(1));

      await user.click(importButton());
      const dialogScope = within(screen.getByRole("dialog"));
      await user.upload(
        dialogScope.getByLabelText("Backup file"),
        new File(["PK"], "backup.zip", { type: "application/zip" }),
      );
      // The restored trip only exists from the refetch onwards - the import response does not carry
      // the derived per-row figures the list renders.
      mockTripsResponse = {
        data: { trips: [trip({ id: "imported", name: "Restored Lofoten" })] },
        error: null,
      };
      await user.click(dialogScope.getByRole("button", { name: "Start import" }));

      await waitFor(() => expect(listFetches).toBe(2));
      expect(await screen.findByText("Restored Lofoten")).toBeInTheDocument();

      global.fetch = baseFetch;
    });
  });

  const createOsloTrip = async (user: ReturnType<typeof userEvent.setup>) => {
    const [addButton] = await screen.findAllByRole("button", { name: /add trip/i });
    await user.click(addButton);

    const dialogScope = within(screen.getByRole("dialog"));
    await user.type(dialogScope.getByLabelText(/trip name/i), "Autumn in Oslo");
    await user.type(dialogScope.getByLabelText(/start date/i), "2026-02-10");
    await user.type(dialogScope.getByLabelText(/end date/i), "2026-02-12");
    await user.click(dialogScope.getByRole("button", { name: /create trip/i }));

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  };

  it("closes the dialog and updates the list after a successful create", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();

    await createOsloTrip(user);

    expect(screen.getByText("Autumn in Oslo")).toBeInTheDocument();
  });

  it("renders a placeholder image when heroImageUrl is missing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();

    mockCreateResponse.data.trip.heroImageUrl = null;
    await createOsloTrip(user);

    // The alt is empty by design (the title names the trip), so the photo is located by testid.
    const [photo] = screen.getAllByTestId("trip-row-photo");
    expect(photo).toHaveAttribute("src", "/images/world-map-placeholder.svg");
    expect(photo).toHaveAttribute("alt", "");
  });

  it("derives upcoming for a freshly created trip rather than a warn row", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();

    // Dated in the past relative to TODAY (2026-02) - so this specific fixture derives to `past`;
    // re-date it to the future to exercise the fresh-trip path.
    mockCreateResponse.data.trip.startDate = "2026-11-10T00:00:00.000Z";
    mockCreateResponse.data.trip.endDate = "2026-11-12T00:00:00.000Z";
    await createOsloTrip(user);

    const row = await rowFor(/autumn in oslo/i);
    expect(row).toHaveAttribute("data-status", "upcoming");
  });

  it("leaves a freshly created trip unmarked, as the account's own", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();

    await createOsloTrip(user);

    // POST returns no `accessRole`, so `handleTripCreated` sets it. Drop that one line and the
    // absent-field fallback puts a VIEWER pill on a trip the account just created itself.
    expect(within(await rowFor(/autumn in oslo/i)).queryByTestId("trip-row-role")).not.toBeInTheDocument();
  });

  it("derives upcoming for a trip created to start today, not a warn row", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();

    mockCreateResponse.data.trip.startDate = "2026-08-01T00:00:00.000Z";
    mockCreateResponse.data.trip.endDate = "2026-08-03T00:00:00.000Z";
    await createOsloTrip(user);

    const row = await rowFor(/autumn in oslo/i);
    expect(row).toHaveAttribute("data-status", "upcoming");
  });

  describe("with a four-state fixture", () => {
    beforeEach(() => {
      mockTripsResponse = { data: { trips: FOUR_STATE_TRIPS }, error: null };
    });

    it("renders each of the four status pills with its expected text", async () => {
      renderDashboard();

      const rows = await screen.findAllByTestId("trip-row");
      expect(rows).toHaveLength(4);

      expect(within(await rowFor(/portugal/i)).getByTestId("trip-row-status")).toHaveTextContent("3 days open");
      expect(within(await rowFor(/copenhagen/i)).getByTestId("trip-row-status")).toHaveTextContent("Fully planned");
      expect(within(await rowFor(/alpine/i)).getByTestId("trip-row-status")).toHaveTextContent(
        "Upcoming · planning open",
      );
      expect(within(await rowFor(/tuscany/i)).getByTestId("trip-row-status")).toHaveTextContent("Completed");
    });

    it("singularizes the gap pill at one open day", async () => {
      mockTripsResponse = {
        data: { trips: [trip({ id: "gap", name: "Portugal Roadtrip", openDayCount: 1, planItemCount: 8 })] },
        error: null,
      };
      renderDashboard();

      expect(within(await rowFor(/portugal/i)).getByTestId("trip-row-status")).toHaveTextContent("1 day open");
    });

    it("fades only a past trip's photo and border, never its text, and uses the total-costs label", async () => {
      renderDashboard();

      const row = await rowFor(/tuscany/i);
      expect(row).toHaveAttribute("data-status", "past");

      // The archival multiplier lives on the two decorative carriers. It is deliberately NOT on the
      // row: a row-level `opacity` inherits into every descendant and drops the 12px `inkSoft`
      // sub-line and the 11.5px status pill below this system's 4.5:1 contrast target.
      expect(within(row).getByTestId("trip-row-photo")).toHaveStyle({ opacity: "0.78" });
      // `borderStrong` #D9D0BE composited at 0.78 - a colour, not a nested opacity, so nothing
      // inherits down into the children.
      expect(row).toHaveStyle({ borderColor: "rgba(217, 208, 190, 0.78)" });

      // The row itself, its text and its status pill all stay at full opacity. jsdom does not resolve
      // a UA default for an undeclared `opacity`, so "no reduced opacity declared anywhere on the
      // inheritance path" is what is actually checkable - and it is the property that matters, since
      // any declaration on these three would inherit down to the text.
      for (const el of [row, within(row).getByTestId("trip-row-status"), within(row).getByText(/total costs/i)]) {
        expect(["", "1"]).toContain(getComputedStyle(el).opacity);
      }
      expect(getComputedStyle(row).opacity).not.toBe("0.78");

      expect(within(row).getByText(/total costs/i)).toBeInTheDocument();
      expect(within(await rowFor(/portugal/i)).getByText(/costs so far/i)).toBeInTheDocument();
    });

    it("leaves an active trip's photo and border at full strength", async () => {
      renderDashboard();

      const row = await rowFor(/copenhagen/i);
      expect(row).toHaveAttribute("data-status", "planned");
      expect(within(row).getByTestId("trip-row-photo")).toHaveStyle({ opacity: "1" });
      expect(row).toHaveStyle({ borderColor: "#D9D0BE" });
    });

    it("gives a gap row the warn border and background", async () => {
      renderDashboard();

      const row = await rowFor(/portugal/i);
      expect(row).toHaveAttribute("data-status", "gap");
      // Guards AC3's pixel-identical claim: `ROW_GAP_BG` became `tokens.warnBgRow`, and the rendered
      // hex must not have moved. #FBF6EE is the whole-row gap fill, distinct from `warnBg` #F6ECE0.
      expect(row).toHaveStyle({ backgroundColor: "#FBF6EE", borderColor: "#E3C7A2" });
    });

    it("renders the neutral status pills on the pill-neutral token, unchanged from the old literal", async () => {
      renderDashboard();

      // The other half of AC3: `NEUTRAL_PILL_BG` became `tokens.pillNeutral`, same #F1ECE1.
      for (const name of [/alpine/i, /tuscany/i]) {
        const pill = within(await rowFor(name)).getByTestId("trip-row-status");
        expect(pill).toHaveStyle({ backgroundColor: "#F1ECE1" });
      }
    });

    it("sorts past trips last", async () => {
      renderDashboard();

      const rows = await screen.findAllByTestId("trip-row");
      expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["gap", "planned", "upcoming", "past"]);
    });

    it("computes the stat cells with past trips excluded from active trips and open items", async () => {
      renderDashboard();

      await screen.findAllByTestId("trip-row");

      // 4 trips, 1 of them past.
      expect(screen.getByTestId("stat-active-trips")).toHaveTextContent("3");
      // Total cost spans every trip including the past one: 2340 + 890 + 0 + 1480.
      expect(screen.getByTestId("stat-total-cost")).toHaveTextContent("€4,710.00");
      // Open days on `gap` trips only: Portugal's 3. Tuscany is past, so its 2 open days are not
      // actionable; the Alpine trip is `upcoming`, so its 8 untouched days are not holes in a plan -
      // counting them would turn this cell warn-orange for a brand-new trip.
      expect(screen.getByTestId("stat-open-items")).toHaveTextContent("3");
      // The sub-line counts trips over the same population the cell counts days over.
      expect(screen.getByText("4 trips · 1 with open items")).toBeInTheDocument();
    });

    it("does not state counts it does not have while loading or after a load failure", async () => {
      mockTripsResponse = { data: null, error: { code: "internal", message: "Unable to load trips." } };
      renderDashboard();

      await screen.findByRole("alert");

      // The numbers all derive from an empty `trips`, so printing them would assert "no trips, no
      // cost, nothing open" as fact directly beside a banner saying the data could not be loaded.
      expect(screen.getByTestId("stat-active-trips")).toHaveTextContent("—");
      expect(screen.getByTestId("stat-total-cost")).toHaveTextContent("—");
      expect(screen.getByTestId("stat-open-items")).toHaveTextContent("—");
      expect(screen.queryByText(/with open items/i)).not.toBeInTheDocument();
    });

    it("singularizes the sub-line at one trip", async () => {
      mockTripsResponse = { data: { trips: [trip({ id: "gap", name: "Portugal Roadtrip", openDayCount: 3 })] }, error: null };
      renderDashboard();

      await screen.findAllByTestId("trip-row");
      expect(screen.getByText("1 trip · 1 with open items")).toBeInTheDocument();
    });

    it("makes the whole row one link named after the trip", async () => {
      renderDashboard();

      const row = await rowFor(/portugal/i);
      const link = within(row).getByRole("link", { name: /open trip portugal roadtrip/i });
      expect(link).toHaveAttribute("href", "/trips/gap");
      expect(within(row).getAllByRole("link")).toHaveLength(1);
    });

    it("renders the per-row cost as currency with tabular figures", async () => {
      renderDashboard();

      const row = await rowFor(/portugal/i);
      const value = within(row).getByText("€2,340.00");
      expect(value).toHaveStyle({ fontVariantNumeric: "tabular-nums" });
    });

    it("formats costs for the German locale", async () => {
      renderWithProviders(<TripsDashboard />, { language: "de" });

      const row = await rowFor(/portugal/i);
      expect(within(row).getByText("2.340,00 €")).toBeInTheDocument();
      expect(within(row).getByTestId("trip-row-status")).toHaveTextContent("3 Tage offen");
    });
  });

  // Story 5.12. The list is owner-OR-member, so a row has to say which it is: an unmarked shared row
  // would present somebody else's trip as the account's own.
  describe("shared trips", () => {
    const OWNED = trip({ id: "owned", name: "My own trip" });
    const SHARED_VIEWER = trip({ id: "shared", name: "Shared with me", accessRole: "viewer", openDayCount: 3 });

    it("marks a shared row with its role and leaves an owned row unmarked", async () => {
      mockTripsResponse = { data: { trips: [OWNED, SHARED_VIEWER] }, error: null };
      renderDashboard();

      const sharedRow = await rowFor(/shared with me/i);
      const rolePill = within(sharedRow).getByTestId("trip-row-role");
      expect(rolePill).toHaveAttribute("data-role", "viewer");
      expect(rolePill).toHaveTextContent("Viewer");

      // The absence is the signal on an owned row - the warn-toned owner badge is reserved for the
      // share dialog, and this row already spends warn on its gap state.
      expect(within(await rowFor(/my own trip/i)).queryByTestId("trip-row-role")).not.toBeInTheDocument();
    });

    it("uses the contributor word for a contributor membership", async () => {
      mockTripsResponse = {
        data: { trips: [trip({ id: "shared", name: "Shared with me", accessRole: "contributor" })] },
        error: null,
      };
      renderDashboard();

      const rolePill = within(await rowFor(/shared with me/i)).getByTestId("trip-row-role");
      expect(rolePill).toHaveAttribute("data-role", "contributor");
      expect(rolePill).toHaveTextContent("Contributor");
    });

    it("takes the role words from the shared share-dialog dictionary keys", async () => {
      const sharedContributor = trip({ id: "contrib", name: "Shared as contributor", accessRole: "contributor" });
      mockTripsResponse = { data: { trips: [SHARED_VIEWER, sharedContributor] }, error: null };
      renderWithProviders(<TripsDashboard />, { language: "de" });

      // `trips.share.roleViewer` / `roleContributor`, the same keys the share dialog's badge renders
      // - not literals. Both words are asserted because the longer one is what stresses the layout.
      expect(within(await rowFor(/shared with me/i)).getByTestId("trip-row-role")).toHaveTextContent("Betrachter");
      expect(within(await rowFor(/shared as contributor/i)).getByTestId("trip-row-role")).toHaveTextContent(
        "Mitwirkender",
      );
    });

    it("names the shared row's link in German too, with the role in it", async () => {
      mockTripsResponse = { data: { trips: [SHARED_VIEWER] }, error: null };
      renderWithProviders(<TripsDashboard />, { language: "de" });

      // `test/i18nDictionaries.test.ts` compares key sets and non-emptiness, not placeholders, so a
      // German value that quietly lost `{role}` would keep every other test green while the one
      // string only screen-reader users ever receive stopped stating the role.
      expect(
        await screen.findByRole("link", { name: "Reise Shared with me öffnen, für dich freigegeben als Betrachter" }),
      ).toBeInTheDocument();
    });

    it("separates the viewer pill from a planned status pill it shares a fill colour with", async () => {
      // `statusPill`'s `planned` treatment is `accentSoft` on `primary.main` - exactly the viewer
      // variant's. On a fully planned shared trip the two sit 8px apart in one column, so the role
      // pill carries a border to stay its own chip rather than reading as more of the one beside it.
      const plannedShared = trip({
        id: "planned-shared",
        name: "Planned and shared",
        accessRole: "viewer",
        openDayCount: 0,
        planItemCount: 4,
      });
      mockTripsResponse = { data: { trips: [plannedShared] }, error: null };
      renderDashboard();

      const row = await rowFor(/planned and shared/i);
      expect(within(row).getByTestId("trip-row-status")).toHaveAttribute("data-status", "planned");
      const rolePill = within(row).getByTestId("trip-row-role");
      expect(rolePill).toHaveAttribute("data-role", "viewer");

      // The colour is the load-bearing half, not the `solid`: an outline drawn in the fill's own
      // colour is invisible and the two chips merge again, which is the defect this case exists for.
      // So the border is pinned against the pill's own two colours rather than against a literal -
      // it has to be the text colour (`primary.main`) and it has to differ from the background
      // (`accentSoft`). Changing `border` to `accentSoft` fails here; changing the palette does not.
      const pill = window.getComputedStyle(rolePill);
      expect(pill.borderStyle).toBe("solid");
      expect(pill.borderColor).toBe(pill.color);
      expect(pill.borderColor).not.toBe(pill.backgroundColor);
      // And the separation has to come from the role pill, because the status pill beside it draws
      // no border at all - asserting merely "not solid" there would hold for any implementation.
      expect(window.getComputedStyle(within(row).getByTestId("trip-row-status")).borderStyle).toBe("");
    });

    it("names the shared row's link so the distinction is not visual only", async () => {
      mockTripsResponse = { data: { trips: [OWNED, SHARED_VIEWER] }, error: null };
      renderDashboard();

      // The pill sits outside the overlay link, so a reader traversing by link list would otherwise
      // hear only "Open trip Shared with me" - identical to the account's own row.
      expect(
        await screen.findByRole("link", { name: "Open trip Shared with me, shared with you as Viewer" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open trip My own trip" })).toBeInTheDocument();
    });

    it("treats a row with no accessRole as shared rather than owned", async () => {
      // An older cached payload, from before the field existed. `TripTimeline` reads an absent role
      // as owner; this surface must not, or an unknown row is presented as the account's own trip.
      const legacyRow = trip({ id: "legacy", name: "Cached older payload" }) as Record<string, unknown>;
      delete legacyRow.accessRole;
      mockTripsResponse = { data: { trips: [legacyRow] }, error: null };
      renderDashboard();

      const rolePill = within(await rowFor(/cached older payload/i)).getByTestId("trip-row-role");
      expect(rolePill).toHaveAttribute("data-role", "viewer");
    });

    it("offers a viewer nothing on the row beyond opening the trip", async () => {
      mockTripsResponse = { data: { trips: [SHARED_VIEWER] }, error: null };
      renderDashboard();

      const row = await rowFor(/shared with me/i);
      // The row is one overlay link over a four-area grid - there is no menu, no delete, no edit and
      // no per-row control on this surface at all, for any role. Deletion lives on the trip overview,
      // which gates on `accessRole` itself. Pinned so a future per-row action cannot arrive here
      // ungated.
      expect(within(row).queryAllByRole("button")).toHaveLength(0);
      const links = within(row).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", "/trips/shared");
      // The pill is a label, not a control.
      expect(within(row).getByTestId("trip-row-role").tagName).toBe("SPAN");
    });

    it("counts a shared trip in the stat strip and the sub-line", async () => {
      mockTripsResponse = { data: { trips: [OWNED, SHARED_VIEWER] }, error: null };
      renderDashboard();

      await screen.findAllByTestId("trip-row");

      // The strip is a caption for the list beneath it, so a visible row it does not count would be
      // a bug report waiting to be filed.
      expect(screen.getByTestId("stat-active-trips")).toHaveTextContent("2");
      expect(screen.getByTestId("stat-total-cost")).toHaveTextContent("€4,680.00");
      expect(screen.getByTestId("stat-open-items")).toHaveTextContent("3");
      expect(screen.getByText("2 trips · 1 with open items")).toBeInTheDocument();
    });

    it("asks for the list with no-store, so a replay cannot re-mark every row", async () => {
      mockTripsResponse = { data: { trips: [OWNED] }, error: null };
      renderDashboard();
      await screen.findAllByTestId("trip-row");

      // `cache: "no-store"` is load-bearing rather than a freshness nicety: this surface reads an
      // absent `accessRole` as *shared*, so a replayed payload from before the field existed would
      // put a viewer pill on every one of the account's own trips. Deleting it must fail here.
      // `credentials: "include"` carries no such weight - the call is same-origin, where the default
      // already sends the session cookie - and is pinned only to keep the list fetch shaped like
      // every other authenticated GET in this tree. Removing it would be a tidy-up, not a defect.
      const listCall = (global.fetch as unknown as Mock).mock.calls.find(
        ([input, init]) => String(input).includes("/api/trips") && (init?.method ?? "GET") === "GET",
      );
      expect(listCall?.[1]).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });
    });

    it("keeps the existing empty state for an account with neither trips nor memberships", async () => {
      mockTripsResponse = { data: { trips: [] }, error: null };
      renderDashboard();

      expect(await screen.findByText(/no trips yet/i)).toBeInTheDocument();
      expect(screen.queryByTestId("trip-row")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("shows trip-row-shaped skeletons while loading", async () => {
    let resolveTrips: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveTrips = resolve;
    });
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/trips") && (init?.method ?? "GET") === "GET") return pending;
      return realFetch(input, init);
    }) as unknown as typeof fetch;

    renderDashboard();

    expect(await screen.findAllByTestId("trip-row-skeleton")).toHaveLength(3);

    resolveTrips({ ok: true, json: async () => mockTripsResponse } as Response);
    await waitFor(() => {
      expect(screen.queryByTestId("trip-row-skeleton")).not.toBeInTheDocument();
    });
  });
});
