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
});
