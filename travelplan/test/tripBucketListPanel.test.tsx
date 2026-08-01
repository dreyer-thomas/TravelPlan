// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import { renderWithProviders } from "./helpers/renderWithProviders";

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
});
