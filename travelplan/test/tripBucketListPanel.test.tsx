// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripBucketListPanel, {
  BUCKET_LIST_MAX_HEIGHT_PX,
  BUCKET_ROW_HEIGHT_PX,
} from "@/components/features/trips/TripBucketListPanel";
import { emotionDeclarations, emotionPseudoClassStyle } from "./helpers/emotionStyles";
import { renderWithProviders } from "./helpers/renderWithProviders";
import { expectRowActionReveal } from "./helpers/bucketRowActionReveal";

/**
 * Story 14.1 rewrote this suite's data for the parked activity and replaced the inline form's cases:
 * adding and editing an idea is the activity dialog in parked mode (`tripDayPlanDialog.test.tsx` covers
 * the dialog itself, including its place search, which the Story 6.28 cases here used to cover for the
 * inline form). The dialog is mocked to its props, as `tripDayViewLayout.test.tsx` mocks it.
 */
type PlanDialogProps = {
  open: boolean;
  mode: "add" | "edit";
  tripId: string;
  day: unknown;
  placement?: "day" | "parked";
  item: { id: string; title: string | null; tripDayId: string | null; scheduleMode?: string; durationMinutes?: number } | null;
  onDelete?: (itemId: string) => Promise<boolean>;
  onClose: () => void;
  onDayWrite?: () => void;
  onSaved: (receipt: unknown) => void;
};
const planDialog = vi.hoisted(() => ({ last: null as PlanDialogProps | null }));
vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: (props: PlanDialogProps) => {
    planDialog.last = props;
    return props.open ? <div data-testid="plan-dialog">{props.mode}</div> : null;
  },
}));

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
  contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Sunset trail" }] }] }),
  durationMinutes: 60,
  costCents: null,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  payments: [],
  linkUrl: null,
  location: null,
  firstImageUrl: null,
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

// DW-48: the list-load request answers with an error envelope. `resolveApiError` falls through to
// its `fallback` argument for any code it does not special-case, which `loadItems` supplies as
// `t("trips.bucketList.loadError")` - so an unmapped code is the simplest way to land on that exact
// copy without also asserting on `resolveApiError`'s internal switch.
const mockBucketListFetchFailure = () => {
  const fetchMock = vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({
      data: null,
      error: { code: "unmapped_error", message: "boom" },
    }),
  })) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const LOAD_ERROR_TEXT = "Unable to load bucket list items.";

afterEach(() => {
  vi.unstubAllGlobals();
  planDialog.last = null;
});

describe("TripBucketListPanel", () => {
  it("defaults to collapsed with a visible count line", async () => {
    const fetchMock = mockBucketListFetch([buildItem(), buildItem({ id: "item-2", title: "Museum" })]);

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("2 entries")).toBeVisible();
    expect(screen.getByRole("button", { name: "Expand bucket list" })).toBeInTheDocument();

    expect(screen.queryByText("Hike spot")).not.toBeInTheDocument();
    // DW-48 AC: a successful load shows the count line and no error `Alert`.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // DW-68. Collapsed is the default, so this line is the panel's entire content until somebody
  // expands it - "1 entries" was the whole thing a one-item list had to say for itself.
  it("singularizes the count line at one item", async () => {
    const fetchMock = mockBucketListFetch([buildItem()]);

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("1 entry")).toBeVisible();
    expect(screen.queryByText("1 entries")).not.toBeInTheDocument();
  });

  it("singularizes the count line at one item in German too", async () => {
    const fetchMock = mockBucketListFetch([buildItem()]);

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />, { language: "de" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("1 Eintrag")).toBeVisible();
    expect(screen.queryByText("1 Einträge")).not.toBeInTheDocument();
  });

  // DW-48.
  describe("load error handling", () => {
    it("shows the error alert instead of the count line while collapsed", async () => {
      const fetchMock = mockBucketListFetchFailure();

      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(await screen.findByRole("alert")).toHaveTextContent(LOAD_ERROR_TEXT);
      // The panel never expanded, so a lying "0 entries" header would otherwise be the only
      // feedback the user gets.
      expect(screen.queryByText(/entries$/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand bucket list" })).toBeInTheDocument();
    });

    it("keeps the same error visible, with no stale empty-state text, once expanded", async () => {
      const fetchMock = mockBucketListFetchFailure();
      const user = userEvent.setup();

      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(await screen.findByRole("alert")).toHaveTextContent(LOAD_ERROR_TEXT);

      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

      // Still exactly one alert - the same instance, not a second copy revealed by expanding.
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(LOAD_ERROR_TEXT);
      // `loadItems` clears `items` to `[]` on failure, so without gating the empty-state copy on
      // `!loadError` this would render underneath the alert and claim "no items" about a load that
      // never actually completed.
      expect(screen.queryByText("No bucket list items yet.")).not.toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });
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

  it("opens the activity dialog in parked mode from the collapsed add icon (Story 14.1 AC6)", async () => {
    const fetchMock = mockBucketListFetch([]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Add idea" }));

    expect(screen.getByTestId("plan-dialog")).toHaveTextContent("add");
    expect(planDialog.last).toMatchObject({ open: true, mode: "add", tripId: "trip-1", day: null, placement: "parked", item: null });
  });

  it("gives the panel-level add button a 44x44 hit area and no warn coloring", async () => {
    const fetchMock = mockBucketListFetch([]);

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const addButton = screen.getByRole("button", { name: "Add idea" });
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

  // DW-50.
  describe("row action buttons", () => {
    it("spaces the edit and delete buttons 8px apart", async () => {
      const fetchMock = mockBucketListFetch([buildItem()]);
      const user = userEvent.setup();

      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

      const editButton = screen.getByRole("button", { name: "Edit item" });
      const actionsBox = editButton.parentElement as HTMLElement;
      const style = window.getComputedStyle(actionsBox);

      // theme spacing `1` = 8px (DW-50's widened target-size gap, up from the prior 2px). jsdom
      // resolves the flex `gap` shorthand directly (unlike `grid-template-columns`, see
      // `emotionStyles.ts`), so `style.gap` alone is the property to assert.
      expect(style.gap).toBe("8px");
    });

    it("gives both the edit and delete buttons a focus-visible outline", async () => {
      const fetchMock = mockBucketListFetch([buildItem()]);
      const user = userEvent.setup();

      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

      const editButton = screen.getByRole("button", { name: "Edit item" });
      const deleteButton = screen.getByRole("button", { name: "Delete item" });

      for (const button of [editButton, deleteButton]) {
        const style = emotionPseudoClassStyle(button, ":focus-visible");
        expect(style.get("outline")).toBe("2px solid #2B2A26");
        expect(style.get("outline-offset")).toBe("2px");
      }
    });
  });

  it("shows a row's edit and delete on hover, always on touch, and when focused (Story 14.2, Tommy)", async () => {
    const fetchMock = mockBucketListFetch([buildItem({ id: "item-a", title: "Alpha" })]);
    const user = userEvent.setup();

    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    expectRowActionReveal(screen.getByTestId("bucket-item"), ["Edit item", "Delete item"]);
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

    // Drift pin on the derivation, not a behavioural claim (Story 14.1 re-derived it for `bucket-item`):
    // the 44px hit area beats the 40px thumbnail and the 38.5px text block (13.5px title + 11.5px meta
    // line at lineHeight 1.5, +1px offset), + 2x9px padding + 1px divider = 63px, x 5.5 rows. jsdom
    // lays nothing out, so whether that many rows are visible is the browser pass, not this assertion's.
    expect(BUCKET_ROW_HEIGHT_PX).toBe(63);
    expect(BUCKET_LIST_MAX_HEIGHT_PX).toBe(346.5);

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

  describe("bucket-item rows (Story 14.1 AC4)", () => {
    const expand = async (items: unknown[]) => {
      const fetchMock = mockBucketListFetch(items);
      const user = userEvent.setup();
      renderWithProviders(<TripBucketListPanel tripId="trip-1" />, { language: "de" });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Bucket-Liste erweitern" }));
      return { user, fetchMock };
    };

    it("shows the first picture as a 40px square at radius 0, the title, and duration · place", async () => {
      await expand([
        buildItem({
          title: "Gullfoss",
          durationMinutes: 60,
          location: { lat: 64.3, lng: -20.1, label: "Gullfoss" },
          firstImageUrl: "/uploads/trips/trip-1/parked/day-plan-items/item-1/a.webp",
        }),
      ]);

      const row = screen.getByTestId("bucket-item");
      // Decorative: the title beside it already names the idea.
      const image = row.querySelector("img")!;
      expect(image).toHaveAttribute("alt", "");
      expect(image).toHaveAttribute("src", "/uploads/trips/trip-1/parked/day-plan-items/item-1/a.webp");
      expect(image).toHaveAttribute("loading", "lazy");
      const style = window.getComputedStyle(image);
      expect(style.width).toBe("40px");
      expect(style.height).toBe("40px");
      expect(style.borderRadius).toBe("0px");
      expect(within(row).getByText("Gullfoss", { selector: "p" })).toBeVisible();
      expect(within(row).getByText("1 Std · Gullfoss")).toBeVisible();
    });

    it("shows no placeholder without a picture, and the duration alone without a place", async () => {
      await expand([buildItem({ title: "Markt", durationMinutes: 90, location: null, firstImageUrl: null })]);

      const row = screen.getByTestId("bucket-item");
      expect(within(row).queryByRole("img")).not.toBeInTheDocument();
      expect(within(row).getByText("1 Std 30 Min")).toBeVisible();
      // The old line said "Keine Koordinaten gespeichert"; the meta line simply drops the place.
      expect(within(row).queryByText(/Koordinaten/)).not.toBeInTheDocument();
    });

    it("opens the activity dialog in parked mode on the row's edit action, with the row's activity", async () => {
      const { user } = await expand([buildItem({ id: "idea-7", title: "Hütte", durationMinutes: 45 })]);

      await user.click(screen.getByRole("button", { name: "Eintrag bearbeiten" }));

      expect(planDialog.last).toMatchObject({
        open: true,
        mode: "edit",
        day: null,
        placement: "parked",
        item: { id: "idea-7", title: "Hütte", tripDayId: null, scheduleMode: "FLEXIBLE", durationMinutes: 45 },
      });
    });

    it("reloads the list after the dialog saved", async () => {
      const { user, fetchMock } = await expand([buildItem()]);
      await user.click(screen.getByRole("button", { name: "Eintrag bearbeiten" }));

      act(() => planDialog.last!.onSaved(null));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId("plan-dialog")).not.toBeInTheDocument();
    });
  });

  describe("delete keeps its confirmation (Story 14.1 AC10)", () => {
    it("asks first; Keep closes without a request, Delete sends it and reloads", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf" }, error: null }) };
        }
        if (init?.method === "DELETE") {
          return { ok: true, status: 200, json: async () => ({ data: { deleted: true }, error: null }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: { items: [buildItem({ id: "idea-9" })] }, error: null }) };
      }) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

      await user.click(screen.getByRole("button", { name: "Delete item" }));
      const confirm = screen.getByRole("dialog");
      expect(within(confirm).getByText("Delete bucket list item?")).toBeVisible();
      await user.click(within(confirm).getByRole("button", { name: "Keep item" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(vi.mocked(fetchMock).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

      await user.click(screen.getByRole("button", { name: "Delete item" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete item" }));

      await waitFor(() =>
        expect(vi.mocked(fetchMock).mock.calls.find(([, init]) => init?.method === "DELETE")?.[1]?.body).toBe(
          JSON.stringify({ itemId: "idea-9" }),
        ),
      );
      const listLoads = vi.mocked(fetchMock).mock.calls.filter(([url, init]) => String(url).endsWith("/bucket-list-items") && !init?.method?.match(/DELETE/));
      await waitFor(() => expect(listLoads.length).toBeGreaterThanOrEqual(1));
    });

    it("hands the dialog's delete over to the same confirmation", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf" }, error: null }) };
        }
        if (init?.method === "DELETE") {
          return { ok: true, status: 200, json: async () => ({ data: { deleted: true }, error: null }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: { items: [buildItem({ id: "idea-3", title: "Hütte" })] }, error: null }) };
      }) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));
      await user.click(screen.getByRole("button", { name: "Edit item" }));

      // The editor's delete waits for the confirmation: "Keep" leaves the editor open (false).
      let kept!: Promise<boolean>;
      act(() => {
        kept = planDialog.last!.onDelete!("idea-3");
      });
      const confirm = await screen.findByRole("dialog");
      expect(within(confirm).getByText("Delete bucket list item?")).toBeVisible();
      await user.click(within(confirm).getByRole("button", { name: "Keep item" }));
      await expect(kept).resolves.toBe(false);
      expect(vi.mocked(fetchMock).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

      // Only a delete that went through closes it (true).
      let deleted!: Promise<boolean>;
      act(() => {
        deleted = planDialog.last!.onDelete!("idea-3");
      });
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete item" }));
      await expect(deleted).resolves.toBe(true);
      expect(vi.mocked(fetchMock).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    });

    it("keeps the edit dialog's item stable across a list reload, so unsaved edits are not re-seeded away", async () => {
      const fetchMock = mockBucketListFetch([buildItem({ id: "idea-4", title: "Geysir" })]);
      const user = userEvent.setup();
      renderWithProviders(<TripBucketListPanel tripId="trip-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await user.click(screen.getByRole("button", { name: "Expand bucket list" }));
      await user.click(screen.getByRole("button", { name: "Edit item" }));
      const seeded = planDialog.last!.item;
      expect(seeded).toMatchObject({ id: "idea-4" });
      const callsBefore = vi.mocked(fetchMock).mock.calls.length;

      // A picture upload in the dialog reloads the list (`onDayWrite`).
      await act(async () => {
        planDialog.last!.onDayWrite!();
      });
      await waitFor(() => expect(vi.mocked(fetchMock).mock.calls.length).toBeGreaterThan(callsBefore));

      expect(planDialog.last!.item).toBe(seeded);
    });
  });
});
