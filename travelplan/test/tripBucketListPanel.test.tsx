// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripBucketListPanel, { BUCKET_LIST_MAX_HEIGHT_PX } from "@/components/features/trips/TripBucketListPanel";
import { emotionDeclarations } from "./helpers/emotionStyles";
import { renderWithProviders } from "./helpers/renderWithProviders";

// MUI's default `md` breakpoint. The height cap is deliberately scoped to the same key the trip
// overview grid uses, so this is the media condition Emotion must emit it under.
const MD_MEDIA_CONDITION = "(min-width:900px)";
// MUI turns an `xs` key into `breakpoints.up("xs")`, i.e. a 0px-floor media query rather than an
// unconditional declaration - so the "no cap below md" half of AC5 lands here, not in the base rule.
const XS_MEDIA_CONDITION = "(min-width:0px)";

const buildItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "item-1",
  tripId: "trip-1",
  title: "Hike spot",
  description: "Sunset trail",
  positionText: "Trailhead",
  location: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const mockBucketListFetch = (items: unknown[]) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: { items },
      error: null,
    }),
  })) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TripBucketListPanel", () => {
  it("defaults to collapsed with a visible count line", async () => {
    const fetchMock = mockBucketListFetch([buildItem(), buildItem({ id: "item-2", title: "Museum" })]);

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("2 entries")).toBeVisible();
    expect(screen.getByRole("button", { name: "Expand bucket list" })).toBeInTheDocument();

    expect(screen.queryByText("Hike spot")).not.toBeInTheDocument();
  });

  it("expands to reveal list content when toggled", async () => {
    const fetchMock = mockBucketListFetch([buildItem()]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    expect(screen.getByText("Hike spot")).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse bucket list" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the add dialog from the collapsed add icon", async () => {
    const fetchMock = mockBucketListFetch([]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByText("Add bucket list item")).toBeInTheDocument();
  });

  it("gives the panel-level add button a 44x44 hit area and no warn coloring", async () => {
    const fetchMock = mockBucketListFetch([]);

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const addButton = screen.getByRole("button", { name: "Add item" });
    const style = window.getComputedStyle(addButton);

    // AC1 "44px floor" (padded hit area) - the button's box is 44x44 even though the visible
    // "+" circle is 24px.
    expect(style.width).toBe("44px");
    expect(style.height).toBe("44px");

    // AC1 "warn is reserved for gap/open-item states" - the pre-redesign button was colored
    // `warning.main` (#8A5A2B) with a matching border; the redesigned button must not compute
    // to the warn tone. Also assert the outer IconButton carries no MUI warning color class,
    // so the check fails loudly if a future refactor uses `color="warning"` instead of sx.
    expect(style.color).not.toBe("rgb(138, 90, 43)");
    expect(style.borderColor).not.toBe("rgb(138, 90, 43)");
    expect(addButton.className).not.toMatch(/MuiIconButton-color(Warning|Error)/);
  });

  it("suppresses the last row's bottom border via :last-child and keeps prior rows' rule", async () => {
    const fetchMock = mockBucketListFetch([
      buildItem({ id: "item-a", title: "Alpha" }),
      buildItem({ id: "item-b", title: "Beta" }),
      buildItem({ id: "item-c", title: "Gamma" }),
    ]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // The `:last-child` divider rule is a CSS-selector treatment (regression from Story 7.3),
    // so assert against the presence of the rule in each row's sx-derived style. Rows before the
    // last carry a `1px solid` bottom rule; the last row's rule is suppressed to `none`.
    const firstBorder = window.getComputedStyle(items[0]).borderBottomStyle;
    const middleBorder = window.getComputedStyle(items[1]).borderBottomStyle;
    const lastBorder = window.getComputedStyle(items[2]).borderBottomStyle;

    expect(firstBorder).toBe("solid");
    expect(middleBorder).toBe("solid");
    expect(lastBorder).toBe("none");
  });

  it("suppresses the only row's bottom border in a one-item list", async () => {
    const fetchMock = mockBucketListFetch([buildItem({ id: "solo", title: "Solo" })]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    // A single row is both first-child and last-child; the `:last-child` rule must still suppress
    // the trailing divider, otherwise a one-item list ships a stray bottom rule.
    expect(window.getComputedStyle(items[0]).borderBottomStyle).toBe("none");
  });

  it("preserves the list role after the row restyle", async () => {
    const fetchMock = mockBucketListFetch([
      buildItem({ id: "row-1", title: "One" }),
      buildItem({ id: "row-2", title: "Two" }),
    ]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    const list = screen.getByRole("list");
    // Screen readers must announce "list, N items" - the presentational `:last-child` treatment
    // sits on a real MUI List/ListItem, not a `<Box>`, per the Story 7.3 review rule.
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps the empty card compact - no minHeight anywhere in the panel (Story 7.12 AC4)", async () => {
    const fetchMock = mockBucketListFetch([]);
    const user = userEvent.setup();

    const { container } = renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    // The empty branch renders the label, the count line and the empty message - nothing else.
    // Awaited rather than read synchronously: the empty branch is gated on `!loading`, so a click
    // landing before the fetch has settled would otherwise see the loading line instead.
    await waitFor(() => expect(screen.getByText("No bucket list items yet.")).toBeVisible());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    // The providers render no DOM of their own, so the panel's card shell is the first child.
    const card = container.firstElementChild as HTMLElement;
    // Sanity-pin that this really is the card shell, so the assertion below cannot silently start
    // measuring some other element if the markup is restructured.
    const cardStyle = window.getComputedStyle(card);
    expect(cardStyle.paddingTop).toBe("18px");
    expect(cardStyle.borderRadius).toBe("8px");

    // Story 7.12 Trap 3: the expanded-height cap must be a `maxHeight`, never a `height`, and it
    // must not gain a `minHeight` companion - either would turn the cap into a floor and give an
    // empty bucket list a large blank card. Walk the whole rendered panel, not just the card, so a
    // min-height slipped onto an inner wrapper is caught too. This walks Emotion's stylesheets only,
    // so it is blind to a `style` attribute - MUI's own `Collapse` sets an inline `min-height: 0px`
    // that is deliberately out of scope here (0 is not a floor). The guard is against an authored
    // `sx`, which is how every height in this file is written.
    const panelElements = [card, ...Array.from(card.querySelectorAll<HTMLElement>("*"))];
    panelElements.forEach((element) => {
      expect(emotionDeclarations(element, "min-height").base).toEqual([]);
      expect(emotionDeclarations(element, "min-height").media.size).toBe(0);
    });
    expect(emotionDeclarations(card, "height").base).toEqual([]);
    expect(emotionDeclarations(card, "max-height").base).toEqual([]);
  });

  it("caps the expanded list and scrolls it at md, with no cap below md (Story 7.12 AC2/AC3/AC5)", async () => {
    const fetchMock = mockBucketListFetch(
      Array.from({ length: 8 }, (_, index) => buildItem({ id: `row-${index}`, title: `Idea ${index}` })),
    );
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Story 7.12 Trap 5: the panel is collapsed by default, so the cap only exists once expanded -
    // a test that never expands would never exercise it.
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);

    // AC3: the scroll container must be operable by keyboard. `tabIndex={0}` makes the overflow box
    // focusable so arrow keys/Page keys scroll it; it adds a tab stop but traps nothing.
    expect(list).toHaveAttribute("tabindex", "0");
    // A focusable element needs an accessible name; it reuses the panel's existing title key.
    expect(list).toHaveAccessibleName("Bucket list");

    const maxHeight = emotionDeclarations(list, "max-height");
    const overflowY = emotionDeclarations(list, "overflow-y");

    // Drift pin on the derivation, not a behavioural claim: a fully populated row is 53.75px of
    // text (12.5px title + two 11px sublines at lineHeight 1.5, each +1px offset) rather than the
    // 44px hit area, + 2x9px padding + 1px divider = 72.75px, x 5.5 rows. jsdom lays nothing out, so
    // whether that many rows are actually visible is Task 6's browser pass, not this assertion's.
    expect(BUCKET_LIST_MAX_HEIGHT_PX).toBe(400.125);

    // Story 7.12 Trap 3 on the element that actually carries the cap: `maxHeight` only. A `height`
    // or `minHeight` here would turn the cap into a floor, which the empty-state case cannot catch
    // because the empty branch renders no list at all.
    expect(emotionDeclarations(list, "height")).toEqual({ base: [], media: new Map() });
    expect(emotionDeclarations(list, "min-height")).toEqual({ base: [], media: new Map() });

    // No unconditional cap: every declaration is breakpoint-scoped.
    expect(maxHeight.base).toEqual([]);
    expect(overflowY.base).toEqual([]);

    // At md and up the list caps and scrolls internally.
    expect(maxHeight.media.get(MD_MEDIA_CONDITION)).toEqual([`${BUCKET_LIST_MAX_HEIGHT_PX}px`]);
    expect(overflowY.media.get(MD_MEDIA_CONDITION)).toEqual(["auto"]);

    // AC5: below md the overview is one column, so the cap is explicitly released - no scroll
    // region nested inside the page's own scroll.
    expect(maxHeight.media.get(XS_MEDIA_CONDITION)).toEqual(["none"]);
    expect(overflowY.media.get(XS_MEDIA_CONDITION)).toEqual(["visible"]);

    // And the cap lives on nothing but those two breakpoint keys - in particular not on `sm`, which
    // would open a window where the layout is stacked but the list is still capped (Trap 4).
    expect(Array.from(maxHeight.media.keys()).sort()).toEqual([XS_MEDIA_CONDITION, MD_MEDIA_CONDITION].sort());
  });

  /**
   * Story 6.28. This file holds **two** of the five geocode call sites: the explicit *Find*, and the
   * silent submit-time lookup that runs when the user typed a place and never pressed it. The second one
   * is the only behaviour this story changes anywhere — with several candidates it stops and asks rather
   * than adopting the first, because adopting the first is precisely the silent wrong pin being removed.
   */
  describe("story 6.28 — coordinates by hand and a choice of places", () => {
    const mockGeocodeFetch = (results: Array<{ lat: number; lng: number; label: string }>, sentBodies: string[] = []) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
        }
        if (url.includes("/api/geocode")) {
          return { ok: true, status: 200, json: async () => ({ data: { results }, error: null }) };
        }
        if (init?.body) {
          sentBodies.push(String(init.body));
          return { ok: true, status: 200, json: async () => ({ data: { item: buildItem() }, error: null }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: { items: [] }, error: null }) };
      }) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    // The panel loads its items on mount, so the absence of a geocode request is a filtered call list
    // rather than `not.toHaveBeenCalled()` — Trap 2.
    const geocodeCalls = (fetchMock: typeof fetch) =>
      (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
        String(call[0]).includes("/api/geocode"),
      );

    const openAddDialog = async (
      results: Array<{ lat: number; lng: number; label: string }> = [],
      sentBodies: string[] = [],
    ) => {
      const fetchMock = mockGeocodeFetch(results, sentBodies);
      const user = userEvent.setup();
      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Add item" }));
      return { fetchMock, user };
    };

    // AC1 on this surface. `resolvedLocationQuery` has to be set to the raw typed text as well, or the
    // invalidation effect nulls the pin on the next render — which is what this readout would show.
    it("resolves a typed coordinate pair without touching the geocoder", async () => {
      const { fetchMock, user } = await openAddDialog();

      await user.type(screen.getByLabelText("Position text"), "48.8584, 2.2945");
      await user.click(screen.getByRole("button", { name: "Find" }));

      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC2.
    it("resolves a pasted Google Maps URL without touching the geocoder", async () => {
      const { fetchMock, user } = await openAddDialog();

      await user.click(screen.getByLabelText("Position text"));
      await user.paste("https://www.google.com/maps/@48.8584,2.2945,17z");
      await user.click(screen.getByRole("button", { name: "Find" }));

      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC4.
    it("faults an out-of-range pair and leaves the readout empty", async () => {
      const { fetchMock, user } = await openAddDialog();

      await user.type(screen.getByLabelText("Position text"), "91.0, 2.0");
      await user.click(screen.getByRole("button", { name: "Find" }));

      expect(await screen.findByText("Latitude must be between -90 and 90")).toBeInTheDocument();
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC5 on the explicit Find. The position field keeps the user's own words — this site has never
    // written the geocoder's name into it — but the stored pin is the row that was chosen.
    it("adopts nothing until a candidate row is activated", async () => {
      const { user } = await openAddDialog([
        { lat: -36.8485, lng: 174.7633, label: "Sky Tower, Auckland" },
        { lat: 43.6426, lng: -79.3871, label: "Sky Tower, Toronto" },
      ]);

      await user.type(screen.getByLabelText("Position text"), "Sky Tower");
      await user.click(screen.getByRole("button", { name: "Find" }));

      expect(await screen.findByText("Select a place (2)")).toBeInTheDocument();
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Sky Tower, Auckland" }));

      expect(await screen.findByText("Latitude: -36.848500 · Longitude: 174.763300")).toBeInTheDocument();
      expect(screen.getByLabelText("Position text")).toHaveValue("Sky Tower");
      expect(screen.queryByRole("button", { name: "Sky Tower, Toronto" })).toBeNull();
    });

    // AC8.
    it("clears a manually entered pair", async () => {
      const { user } = await openAddDialog();

      await user.type(screen.getByLabelText("Position text"), "48.8584, 2.2945");
      await user.click(screen.getByRole("button", { name: "Find" }));
      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear" }));

      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
    });

    /**
     * The submit path, first half: a typed pair saves with its location and **no** geocode request, even
     * though *Find* was never pressed. Before this story the same keystrokes reached Nominatim as a
     * search string and the entry saved with no location at all.
     */
    it("saves a typed pair from the submit path with no geocode request", async () => {
      const sentBodies: string[] = [];
      const { fetchMock, user } = await openAddDialog([], sentBodies);

      await user.type(screen.getByLabelText("Title"), "Lookout");
      await user.type(screen.getByLabelText("Position text"), "-36.8485, 174.7633");
      await user.click(screen.getByRole("button", { name: "Save item" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      const payload = JSON.parse(sentBodies[0]);
      expect(payload.location).toEqual({ lat: -36.8485, lng: 174.7633, label: "-36.848500, 174.763300" });
      // The user's own words stay in the column that stores them.
      expect(payload.positionText).toBe("-36.8485, 174.7633");
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    /**
     * Story 6.28 review, P3. The submit path is **silent**, and `positionText` is a 200-character free-text
     * note column rather than a search box — so a refusal must not be able to make a note unsaveable.
     * `1,2,3` was answered with "Coordinates unclear…" and could then never be stored at all (it saved
     * fine before this story), and `2026, 8` was refused with a latitude complaint about a year. Both fall
     * through to the geocode attempt exactly as they did before, and the entry saves with no location.
     */
    it.each(["1,2,3", "2026, 8"])("saves the note %o that no coordinate reading can be made of", async (position) => {
      const sentBodies: string[] = [];
      const { user } = await openAddDialog([], sentBodies);

      await user.type(screen.getByLabelText("Title"), "Numbers");
      await user.type(screen.getByLabelText("Position text"), position);
      await user.click(screen.getByRole("button", { name: "Save item" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      const payload = JSON.parse(sentBodies[0]);
      expect(payload.positionText).toBe(position);
      expect(payload.location).toBeNull();
      expect(screen.queryByText("Coordinates unclear. Write 48.8584, 2.2945 or 48,8584; 2,2945.")).toBeNull();
    });

    /**
     * Story 6.28 review, P2, and the sequence that made this the one surface where a stale list did not
     * merely offer the wrong places but **saved** one. The rows answered "Sky Tower"; after the position
     * text becomes "Eiffelturm", `selectLocationCandidate` would set `resolvedLocationQuery` to the text as
     * it is *now*, the drift-invalidation effect would see agreement and leave the pin, and the entry would
     * save as "Eiffelturm" at Auckland's coordinates. The list is dismissed instead.
     *
     * The field is `register("positionText")`, so this is watched rather than handled in an `onChange` —
     * which is why it needs its own case here and not only in the two dialogs.
     */
    it("dismisses an unanswered candidate list when the position text is edited", async () => {
      const { user } = await openAddDialog([
        { lat: -36.8485, lng: 174.7633, label: "Sky Tower, Auckland" },
        { lat: 43.6426, lng: -79.3871, label: "Sky Tower, Toronto" },
      ]);

      await user.type(screen.getByLabelText("Position text"), "Sky Tower");
      await user.click(screen.getByRole("button", { name: "Find" }));
      expect(await screen.findByRole("button", { name: "Sky Tower, Auckland" })).toBeInTheDocument();

      await user.clear(screen.getByLabelText("Position text"));
      await user.type(screen.getByLabelText("Position text"), "Eiffelturm");

      expect(screen.queryByRole("button", { name: "Sky Tower, Auckland" })).toBeNull();
      expect(screen.queryByText("Select a place (2)")).toBeNull();
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
    });

    /**
     * The submit path, second half, and the one behaviour this story changes. `onSubmit` cannot prompt
     * mid-save, so with several candidates it aborts, renders the list and says why — rather than
     * adopting `results[0]`, which is the silent wrong pin, or saving with no location, which is the
     * silent drop.
     */
    it("aborts the save and asks when the submit-time lookup finds several places", async () => {
      const sentBodies: string[] = [];
      const { user } = await openAddDialog(
        [
          { lat: -36.8485, lng: 174.7633, label: "Sky Tower, Auckland" },
          { lat: 43.6426, lng: -79.3871, label: "Sky Tower, Toronto" },
        ],
        sentBodies,
      );

      await user.type(screen.getByLabelText("Title"), "Viewpoint");
      await user.type(screen.getByLabelText("Position text"), "Sky Tower");
      await user.click(screen.getByRole("button", { name: "Save item" }));

      expect(await screen.findByText("Select one of the places found.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sky Tower, Auckland" })).toBeInTheDocument();
      expect(sentBodies).toHaveLength(0);

      // And the choice makes the save go through, with the chosen row's label stored.
      await user.click(screen.getByRole("button", { name: "Sky Tower, Toronto" }));

      /*
        Story 6.28 review, P9. Choosing a row is the only thing that can answer "Select one of the places
        found.", so the banner has to go with it — leaving it standing told the user to do the thing they
        had just done, on a dialog whose save was now perfectly ready to go.
      */
      expect(screen.queryByText("Select one of the places found.")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Save item" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      expect(JSON.parse(sentBodies[0]).location).toEqual({
        lat: 43.6426,
        lng: -79.3871,
        label: "Sky Tower, Toronto",
      });
    });

    /**
     * Story 6.28 follow-up review. *Clear* and the parse on save were on a collision course here exactly
     * as they were in the two dialogs — but the dialogs' fix (empty the search box too) is not available
     * on this surface, because `positionText` is a **saved note column**, not a search box. So *Clear*
     * nulled the pin, left `48.8584, 2.2945` in the note, and `onSubmit` read the pair straight back out
     * of it: the button was a no-op and a hand-entered location could not be deleted at all.
     */
    it("keeps a cleared pin cleared when the note still spells the pair", async () => {
      const sentBodies: string[] = [];
      const { fetchMock, user } = await openAddDialog([], sentBodies);

      await user.type(screen.getByLabelText("Title"), "Lookout");
      await user.type(screen.getByLabelText("Position text"), "48.8584, 2.2945");
      await user.click(screen.getByRole("button", { name: "Find" }));
      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(screen.getByText("No coordinates selected")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Save item" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      const payload = JSON.parse(sentBodies[0]);
      expect(payload.location).toBeNull();
      // The note itself is untouched — clearing the *location* is not deleting the user's words.
      expect(payload.positionText).toBe("48.8584, 2.2945");
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // ...and the marker is a query, not a latch: retyping the note revives the lookup, so *Clear* cannot
    // quietly disable coordinate entry for the rest of the dialog's life.
    it("resolves again after Clear once the note is edited", async () => {
      const { user } = await openAddDialog();

      await user.type(screen.getByLabelText("Position text"), "48.8584, 2.2945");
      await user.click(screen.getByRole("button", { name: "Find" }));
      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Clear" }));

      await user.clear(screen.getByLabelText("Position text"));
      await user.type(screen.getByLabelText("Position text"), "-36.8485, 174.7633");
      await user.click(screen.getByRole("button", { name: "Find" }));

      expect(await screen.findByText("Latitude: -36.848500 · Longitude: 174.763300")).toBeInTheDocument();
    });

    /**
     * Story 6.28 follow-up review, and the sharpest edge the submit-time abort had. An item with a note
     * and **no** location is a legal, already-saved shape — a position is optional on a bucket-list entry.
     * Re-opening one to fix a typo in the title sent its note to Nominatim, got several rows back and
     * refused the save with "Select one of the places found.", so the title edit could not be stored
     * unless the user either pinned a place they never asked for or deleted the note. It saved fine
     * before this story.
     */
    it("saves a title edit on an item whose note was already stored without a location", async () => {
      const sentBodies: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
        }
        if (url.includes("/api/geocode")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                results: [
                  { lat: -36.8485, lng: 174.7633, label: "Sky Tower, Auckland" },
                  { lat: 43.6426, lng: -79.3871, label: "Sky Tower, Toronto" },
                ],
              },
              error: null,
            }),
          };
        }
        if (init?.body) {
          sentBodies.push(String(init.body));
          return { ok: true, status: 200, json: async () => ({ data: { item: buildItem() }, error: null }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { items: [buildItem({ positionText: "Sky Tower", location: null })] },
            error: null,
          }),
        };
      }) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);

      const user = userEvent.setup();
      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));
      await user.click(await screen.findByRole("button", { name: "Edit item" }));

      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "Hike spot fixed");
      await user.click(screen.getByRole("button", { name: "Update item" }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      const payload = JSON.parse(sentBodies[0]);
      expect(payload.title).toBe("Hike spot fixed");
      expect(payload.location).toBeNull();
      expect(payload.positionText).toBe("Sky Tower");
      expect(screen.queryByText("Select one of the places found.")).toBeNull();
      // The note was already settled, so re-saving it asks Nominatim nothing at all.
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });
  });
});
