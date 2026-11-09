// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripPackingList, {
  PACKING_FILTER_STORAGE_KEY,
  packingCategoryStorageKey,
  packingTagStorageKey,
  type PackingItemWire,
} from "@/components/features/trips/TripPackingList";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";
import { useI18n } from "@/i18n/provider";

/** Story 16.1 (AC 2-9, 11). The packing list page against a stubbed API. */

const item = (overrides: Partial<PackingItemWire> & { id: string; name: string }): PackingItemWire => ({
  category: null,
  packed: false,
  notNeeded: false,
  tags: [],
  dayCount: 0,
  days: [],
  aiChangedAt: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

type Call = { url: string; method: string; body: Record<string, unknown> | null };

/**
 * A fetch stub serving the list, the CSRF token and the writes. `writeAnswer` lets a test answer a
 * write its own way (a 409, an `existed` item); otherwise the write echoes a plausible item.
 */
const installApi = (
  initial: { accessRole?: "owner" | "contributor" | "viewer"; items: PackingItemWire[] },
  writeAnswer?: (call: Call) => Response | undefined,
) => {
  const calls: Call[] = [];
  const fetchMock = stubFetch(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call = { url, method, body };
      calls.push(call);
      if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf" }, error: null });
      if (method === "GET") {
        return mockFetchResponse({ data: { accessRole: initial.accessRole ?? "owner", items: initial.items }, error: null });
      }
      const custom = writeAnswer?.(call);
      if (custom) return custom;
      if (method === "POST") {
        return mockFetchResponse({
          data: {
            item: item({
              id: `new-${calls.length}`,
              name: String(body?.name),
              category: (body?.category as string | null) ?? null,
              tags: (body?.tags as string[] | undefined) ?? [],
            }),
            existed: false,
          },
          error: null,
        });
      }
      if (method === "PATCH") {
        const current = initial.items.find((entry) => entry.id === body?.itemId)!;
        return mockFetchResponse({
          data: {
            item: {
              ...current,
              ...(body?.packed !== undefined ? { packed: body.packed } : {}),
              ...(body?.name !== undefined ? { name: body.name } : {}),
              ...(body?.category !== undefined ? { category: body.category } : {}),
              ...(body?.tags !== undefined ? { tags: body.tags } : {}),
              // Story 16.7. Not needed: unpacked and off every day; needed again: open.
              ...(body?.notNeeded === true ? { notNeeded: true, packed: false, days: [], dayCount: 0 } : {}),
              ...(body?.notNeeded === false ? { notNeeded: false } : {}),
            },
          },
          error: null,
        });
      }
      return mockFetchResponse({ data: { deleted: true }, error: null });
    }),
  );
  return { fetchMock, calls, writes: () => calls.filter((call) => call.method !== "GET") };
};

const rowNames = () => screen.getAllByTestId("packing-row").map((row) => row.textContent);

describe("TripPackingList (Story 16.1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // jsdom has no layout; the highlight scroll must not throw.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders groups with packed/total counts, Other last, and the overall progress", async () => {
    installApi({
      items: [
        item({ id: "1", name: "Ladekabel", category: "Electronics", packed: true }),
        item({ id: "2", name: "Adapter", category: "Electronics" }),
        item({ id: "3", name: "Umbrella" }),
        item({ id: "4", name: "Passport", category: "Documents", packed: true }),
      ],
    });
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    expect(await screen.findByTestId("packing-progress")).toHaveTextContent("2 of 4 packed");
    expect(screen.getAllByTestId("packing-group-heading").map((heading) => heading.textContent)).toEqual([
      "Documents 1/1",
      "Electronics 1/2",
      "Other 0/1",
    ]);
    expect(rowNames()).toEqual(["Passport", "Adapter", "Ladekabel", "Umbrella"]);
    // A packed item stays in place, ticked and struck through.
    expect(screen.getByRole("checkbox", { name: "Ladekabel packed" })).toBeChecked();
    expect(screen.getByText("Ladekabel")).toHaveStyle({ textDecoration: "line-through" });
  });

  it("shows the empty state", async () => {
    installApi({ items: [] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    expect(await screen.findByTestId("packing-empty")).toHaveTextContent("Nothing on the list yet.");
    expect(screen.getByTestId("packing-progress")).toHaveTextContent("0 of 0 packed");
  });

  it("speaks German", async () => {
    installApi({ items: [item({ id: "1", name: "Pass", packed: true }), item({ id: "2", name: "Hut" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });
    expect(await screen.findByTestId("packing-progress")).toHaveTextContent("1 von 2 eingepackt");
    expect(screen.getByTestId("packing-group-heading")).toHaveTextContent("Sonstiges 1/2");
  });

  it("adds an item: POSTs, shows the row, clears the name and keeps the category", async () => {
    const api = installApi({ items: [] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    const nameField = await screen.findByLabelText("Item");
    await user.type(screen.getByLabelText("Category (optional)"), "Sport");
    await user.type(nameField, "Taucherbrille{Enter}");

    await waitFor(() => expect(rowNames()).toEqual(["Taucherbrille"]));
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "POST", body: { name: "Taucherbrille", category: "Sport", tags: [] } }),
    ]);
    expect(nameField).toHaveValue("");
    expect(screen.getByLabelText("Category (optional)")).toHaveValue("Sport");
    expect(nameField).toHaveFocus();
  });

  it("offers the default and used categories as suggestions", async () => {
    installApi({ items: [item({ id: "1", name: "Rod", category: "Fishing" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByLabelText("Category (optional)"));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Clothing", "Electronics", "Toiletries", "Documents", "Medication", "Other", "Fishing"]);
  });

  it("highlights the existing item and shows a notice on a duplicate add, switching the filter to All", async () => {
    window.localStorage.setItem(PACKING_FILTER_STORAGE_KEY, "open");
    const existing = item({ id: "1", name: "Taucherbrille", packed: true });
    installApi({ items: [existing, item({ id: "2", name: "Hut" })] }, (call) =>
      call.method === "POST" ? mockFetchResponse({ data: { item: existing, existed: true }, error: null }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByText("Hut");
    expect(screen.queryByText("Taucherbrille")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Item"), "taucherbrille{Enter}");

    expect(await screen.findByTestId("packing-notice")).toHaveTextContent("'Taucherbrille' is already on the list.");
    const row = screen.getByText("Taucherbrille").closest("li")!;
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("packing-row")).toHaveLength(2);
    expect(screen.getByLabelText("Item")).toHaveValue("");
    // The automatic switch to All is for this moment only: the viewer's remembered choice stays.
    expect(window.localStorage.getItem(PACKING_FILTER_STORAGE_KEY)).toBe("open");
  });

  it("shows and highlights an existing item this page had not loaded yet (added by someone else meanwhile)", async () => {
    const addedElsewhere = item({ id: "9", name: "Sonnencreme" });
    installApi({ items: [item({ id: "2", name: "Hut" })] }, (call) =>
      call.method === "POST" ? mockFetchResponse({ data: { item: addedElsewhere, existed: true }, error: null }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByText("Hut");
    await user.type(screen.getByLabelText("Item"), "sonnencreme{Enter}");

    expect(await screen.findByTestId("packing-notice")).toHaveTextContent("'Sonnencreme' is already on the list.");
    const row = screen.getByText("Sonnencreme").closest("li")!;
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(screen.getAllByTestId("packing-row")).toHaveLength(2);
  });

  it("highlights again when the same duplicate is added twice", async () => {
    const existing = item({ id: "1", name: "Hut" });
    installApi({ items: [existing] }, (call) =>
      call.method === "POST" ? mockFetchResponse({ data: { item: existing, existed: true }, error: null }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    const row = (await screen.findByText("Hut")).closest("li")!;
    await user.type(screen.getByLabelText("Item"), "hut{Enter}");
    await waitFor(() => expect(row.scrollIntoView).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("Item"), "hut{Enter}");
    await waitFor(() => expect(row.scrollIntoView).toHaveBeenCalledTimes(2));
  });

  it("ticks an item with a PATCH and strikes it through; unticks it again", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    const box = await screen.findByRole("checkbox", { name: "Pass packed" });
    await user.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText("Pass")).toHaveStyle({ textDecoration: "line-through" });
    expect(screen.getByTestId("packing-progress")).toHaveTextContent("1 of 1 packed");
    expect(api.writes()[0]).toMatchObject({ method: "PATCH", body: { itemId: "1", packed: true } });
  });

  it("rolls a tick back when the write fails", async () => {
    installApi({ items: [item({ id: "1", name: "Pass" })] }, (call) =>
      call.method === "PATCH" ? mockFetchResponse({ data: null, error: { code: "server_error", message: "x" } }, { status: 500 }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    const box = await screen.findByRole("checkbox", { name: "Pass packed" });
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renames and changes the category in the edit dialog", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Item");
    await user.clear(nameField);
    await user.type(nameField, "Reisepass");
    await user.type(within(dialog).getByLabelText("Category (optional)"), "Documents");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()[0]).toMatchObject({ method: "PATCH", body: { itemId: "1", name: "Reisepass", category: "Documents" } });
    expect(rowNames()).toEqual(["Reisepass"]);
    expect(screen.getByTestId("packing-group-heading")).toHaveTextContent("Documents 0/1");
  });

  it("keeps the dialog open with an error when a rename hits an existing name (409)", async () => {
    installApi({ items: [item({ id: "1", name: "Pass" }), item({ id: "2", name: "Hut" })] }, (call) =>
      call.method === "PATCH"
        ? mockFetchResponse({ data: null, error: { code: "duplicate_name", message: "x" } }, { status: 409 })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Item");
    await user.clear(nameField);
    await user.type(nameField, "hut");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByTestId("packing-edit-error")).toHaveTextContent("An item with this name already exists.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Hut", "Pass"]);
  });

  it("asks before deleting an item linked to 3 days", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", dayCount: 3 })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Also removed from 3 days?")).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", body: { itemId: "1", confirmedDayCount: 3 } })]);
    expect(screen.getByTestId("packing-empty")).toBeInTheDocument();
  });

  it("uses the singular for one day, and Keep cancels", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", dayCount: 1 })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Also removed from 1 day?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByText("Also removed from 1 day?")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([]);
    expect(rowNames()).toEqual(["Pass"]);
  });

  it("deletes an item without day links directly", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass" }), item({ id: "2", name: "Hut" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", body: { itemId: "1", confirmedDayCount: 0 } })]);
    expect(rowNames()).toEqual(["Hut"]);
  });

  it("filters to not-packed items, remembers the choice, and restores it", async () => {
    installApi({ items: [item({ id: "1", name: "Pass", packed: true }), item({ id: "2", name: "Hut" })] });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByText("Pass");
    await user.click(screen.getByRole("button", { name: "Not packed yet" }));
    expect(rowNames()).toEqual(["Hut"]);
    expect(window.localStorage.getItem(PACKING_FILTER_STORAGE_KEY)).toBe("open");
    unmount();

    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Hut");
    expect(screen.queryByText("Pass")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not packed yet" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says everything is packed when the filter leaves nothing", async () => {
    window.localStorage.setItem(PACKING_FILTER_STORAGE_KEY, "open");
    installApi({ items: [item({ id: "1", name: "Pass", packed: true })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    expect(await screen.findByText("Everything is packed.")).toBeInTheDocument();
  });

  it("survives a throwing localStorage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    installApi({ items: [item({ id: "1", name: "Pass", packed: true }), item({ id: "2", name: "Hut" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByText("Pass");
    await user.click(screen.getByRole("button", { name: "Not packed yet" }));
    expect(rowNames()).toEqual(["Hut"]);
  });

  it("is read-only for a viewer: no add row, no checkbox, no edit; a packed mark instead", async () => {
    installApi({ accessRole: "viewer", items: [item({ id: "1", name: "Pass", packed: true }), item({ id: "2", name: "Hut" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    expect(await screen.findByTestId("packing-progress")).toHaveTextContent("1 of 2 packed");
    expect(screen.queryByLabelText("Item")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Packed" })).toHaveLength(1);
    // The filter is reading, not writing: viewers have it too.
    expect(screen.getByRole("button", { name: "Not packed yet" })).toBeInTheDocument();
  });

  it("shows the AI badge on an item the connector changed", async () => {
    installApi({ items: [item({ id: "1", name: "Pass", aiChangedAt: "2026-11-01T10:00:00.000Z" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    expect(await screen.findByTestId("ai-badge")).toBeInTheDocument();
  });

  it("shows the trip-not-found screen for a 404", async () => {
    stubFetch(vi.fn(async () => mockFetchResponse({ data: null, error: { code: "not_found", message: "x" } }, { status: 404 })));
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId("packing-progress")).not.toBeInTheDocument();
  });

  it("shows the linked days as short dates under the name, nothing for an unlinked item (Story 16.2)", async () => {
    installApi({
      items: [
        item({
          id: "1",
          name: "Swimwear",
          dayCount: 2,
          days: [
            { id: "d3", dayIndex: 3, date: "2026-08-03T00:00:00.000Z" },
            { id: "d4", dayIndex: 4, date: "2026-08-04T00:00:00.000Z" },
          ],
        }),
        item({ id: "2", name: "Hat" }),
      ],
    });
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    const lines = await screen.findAllByTestId("packing-row-days");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("Mon, 8/3 · Tue, 8/4");
    const hatRow = screen.getAllByTestId("packing-row").find((row) => row.textContent?.startsWith("Hat"))!;
    expect(within(hatRow).queryByTestId("packing-row-days")).not.toBeInTheDocument();
  });

  it("shows the linked days to a viewer too (Story 16.2, AC 8)", async () => {
    installApi({
      accessRole: "viewer",
      items: [item({ id: "1", name: "Swimwear", dayCount: 1, days: [{ id: "d3", dayIndex: 3, date: "2026-08-03T00:00:00.000Z" }] })],
    });
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    expect(await screen.findByTestId("packing-row-days")).toHaveTextContent("Mon, 8/3");
  });

  it("asks with the fresh count when the item was linked to days since the page loaded (Story 16.2, DW-432)", async () => {
    let deletes = 0;
    const api = installApi({ items: [item({ id: "1", name: "Pass" })] }, (call) => {
      if (call.method !== "DELETE") return undefined;
      deletes += 1;
      if (deletes === 1) {
        return mockFetchResponse(
          { data: null, error: { code: "days_changed", message: "changed", details: { dayCount: 2 } } },
          { status: 409 },
        );
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Also removed from 2 days?")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Pass"]);
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "DELETE", body: { itemId: "1", confirmedDayCount: 0 } }),
      expect.objectContaining({ method: "DELETE", body: { itemId: "1", confirmedDayCount: 2 } }),
    ]);
    expect(screen.getByTestId("packing-empty")).toBeInTheDocument();
  });

  it("updates the confirmation text when the count changes again while it is open", async () => {
    let deletes = 0;
    installApi({ items: [item({ id: "1", name: "Pass", dayCount: 1 })] }, (call) => {
      if (call.method !== "DELETE") return undefined;
      deletes += 1;
      if (deletes === 1) {
        return mockFetchResponse(
          { data: null, error: { code: "days_changed", message: "changed", details: { dayCount: 3 } } },
          { status: 409 },
        );
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Also removed from 1 day?")).toBeInTheDocument();
    await user.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Also removed from 3 days?")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Pass"]);
  });
});

/** Story 16.6 (AC 1-13). The category filter on the packing list page. */
describe("TripPackingList category filter (Story 16.6)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fixture = () => [
    item({ id: "c1", name: "Shirt", category: "Clothing", packed: true }),
    item({ id: "c2", name: "Socks", category: "Clothing" }),
    item({ id: "e1", name: "Cable", category: "Electronics" }),
    item({ id: "e2", name: "Adapter", category: "electronics", packed: true }),
    item({ id: "t1", name: "Toothbrush", category: "Toiletries" }),
    item({ id: "o1", name: "Umbrella" }),
  ];

  const chips = () => within(screen.getByTestId("packing-category-chips"));
  const chip = (name: string) => chips().getByRole("button", { name });
  const stored = (tripId = "trip-1") => window.localStorage.getItem(packingCategoryStorageKey(tripId));

  it("shows every group without a selection; All categories is pressed; no selection line", async () => {
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    expect(rowNames()).toEqual(["Shirt", "Socks", "Adapter", "Cable", "Toothbrush", "Umbrella"]);
    expect(chip("All categories")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("packing-selection-progress")).not.toBeInTheDocument();
    expect(screen.getByTestId("packing-category-chips")).toHaveAttribute("role", "group");
  });

  it("builds the chips from the groups: same labels and order, mixed case as one chip, Other last", async () => {
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    expect(chips().getAllByRole("button").map((button) => button.textContent)).toEqual([
      "All categories",
      "Clothing",
      "Electronics",
      "Toiletries",
      "Other",
    ]);
    expect(screen.getAllByTestId("packing-group-heading").map((heading) => heading.textContent?.replace(/ \d+\/\d+$/, ""))).toEqual([
      "Clothing",
      "Electronics",
      "Toiletries",
      "Other",
    ]);
  });

  it("filters to one category and shows its progress", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Electronics"));
    expect(rowNames()).toEqual(["Adapter", "Cable"]);
    expect(chip("Electronics")).toHaveAttribute("aria-pressed", "true");
    expect(chip("All categories")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("packing-progress")).toHaveTextContent("2 of 6 packed");
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 1 of 2 packed");
  });

  it("combines several categories; toggling one off removes it; All categories clears", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Toiletries"));
    await user.click(chip("Clothing"));
    expect(rowNames()).toEqual(["Shirt", "Socks", "Toothbrush"]);
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 1 of 3 packed");
    expect(JSON.parse(stored()!)).toEqual(["clothing", "toiletries"]);

    await user.click(chip("Clothing"));
    expect(rowNames()).toEqual(["Toothbrush"]);

    await user.click(chip("All categories"));
    expect(rowNames()).toHaveLength(6);
    expect(JSON.parse(stored()!)).toEqual([]);
    expect(screen.queryByTestId("packing-selection-progress")).not.toBeInTheDocument();
  });

  it("filters to the Other group (items without a category)", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Other"));
    expect(rowNames()).toEqual(["Umbrella"]);
    expect(JSON.parse(stored()!)).toEqual([null]);
  });

  it("combines with Not packed yet, and says the selection is all packed", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Clothing"));
    await user.click(screen.getByRole("button", { name: "Not packed yet" }));
    expect(rowNames()).toEqual(["Socks"]);
    // The selection line counts all items of the selection, regardless of the open filter.
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 1 of 2 packed");

    await user.click(screen.getByRole("checkbox", { name: "Socks packed" }));
    expect(await screen.findByText("Everything in your selection is packed.")).toBeInTheDocument();
    expect(screen.queryByText("Everything is packed.")).not.toBeInTheDocument();
  });

  it("remembers the selection per trip", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    await user.click(chip("Toiletries"));
    expect(JSON.parse(stored()!)).toEqual(["toiletries"]);
    unmount();

    const again = renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Toothbrush");
    expect(rowNames()).toEqual(["Toothbrush"]);
    expect(chip("Toiletries")).toHaveAttribute("aria-pressed", "true");
    again.unmount();

    renderWithProviders(<TripPackingList tripId="trip-2" />);
    await screen.findByText("Shirt");
    expect(rowNames()).toHaveLength(6);
    expect(stored("trip-2")).toBeNull();
  });

  it("ignores a vanished category and keeps the rest", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["toiletries", "gone"]));
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Toothbrush");
    expect(rowNames()).toEqual(["Toothbrush"]);
    // Only ignored, not erased: it may come back.
    expect(JSON.parse(stored()!)).toEqual(["toiletries", "gone"]);
  });

  it("shows everything when every remembered category vanished, or the stored value is malformed", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["gone"]));
    installApi({ items: fixture() });
    const { unmount } = renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    expect(rowNames()).toHaveLength(6);
    expect(screen.queryByTestId("packing-selection-progress")).not.toBeInTheDocument();
    expect(chip("All categories")).toHaveAttribute("aria-pressed", "true");
    unmount();

    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), "{not json");
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    expect(rowNames()).toHaveLength(6);
  });

  it("still filters with a throwing localStorage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    await user.click(chip("Electronics"));
    expect(rowNames()).toEqual(["Adapter", "Cable"]);
  });

  it("shows no chips and no filter with a single category, even with a stored selection", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["clothing"]));
    installApi({ items: [item({ id: "1", name: "Shirt", category: "Clothing" }), item({ id: "2", name: "Socks", category: "clothing" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    expect(screen.queryByTestId("packing-category-chips")).not.toBeInTheDocument();
    expect(screen.queryByTestId("packing-selection-progress")).not.toBeInTheDocument();
    expect(rowNames()).toEqual(["Shirt", "Socks"]);
  });

  it("prefills the add form's category for exactly one selected category", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    const categoryField = screen.getByLabelText("Category (optional)");

    await user.click(chip("Electronics"));
    // The group's label is the first spelling met.
    expect(categoryField).toHaveValue("Electronics");

    await user.click(chip("Other"));
    // Two selected: the field is left as it was.
    expect(categoryField).toHaveValue("Electronics");

    await user.click(chip("Electronics"));
    // Only Other left: empty.
    expect(categoryField).toHaveValue("");
  });

  it("prefills on load from a restored single selection", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["toiletries"]));
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Toothbrush");
    expect(screen.getByLabelText("Category (optional)")).toHaveValue("Toiletries");
  });

  it("keeps an item added outside the selection visible for now, without changing the stored choice", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Clothing"));
    const categoryField = screen.getByLabelText("Category (optional)");
    await user.clear(categoryField);
    await user.type(categoryField, "Electronics");
    await user.type(screen.getByLabelText("Item"), "Charger{Enter}");

    await waitFor(() => expect(rowNames()).toEqual(["Shirt", "Socks", "Charger"]));
    expect(JSON.parse(stored()!)).toEqual(["clothing"]);
    // The selection line does not count the revealed extra.
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 1 of 2 packed");

    // Touching a chip ends the reveal.
    await user.click(chip("Toiletries"));
    expect(rowNames()).toEqual(["Shirt", "Socks", "Toothbrush"]);
  });

  it("keeps an item recategorized outside the selection visible for now", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Clothing"));
    await user.click(screen.getByRole("button", { name: "Edit Socks" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Category (optional)");
    await user.clear(field);
    await user.type(field, "Toiletries");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(rowNames()).toEqual(["Shirt", "Socks"]);
    expect(JSON.parse(stored()!)).toEqual(["clothing"]);

    await user.click(chip("Clothing"));
    await user.click(chip("Clothing"));
    expect(rowNames()).toEqual(["Shirt"]);
  });

  it("keeps an item visible that creates the second group while a stored selection is dormant", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["clothing"]));
    installApi({ items: [item({ id: "c1", name: "Shirt", category: "Clothing" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");
    expect(screen.queryByTestId("packing-category-chips")).not.toBeInTheDocument();

    const categoryField = screen.getByLabelText("Category (optional)");
    await user.clear(categoryField);
    await user.type(categoryField, "Electronics");
    await user.type(screen.getByLabelText("Item"), "Charger{Enter}");

    // Two groups now: the stored choice applies again, but the item just added stays visible.
    await waitFor(() => expect(chip("Clothing")).toHaveAttribute("aria-pressed", "true"));
    expect(rowNames()).toEqual(["Shirt", "Charger"]);
    expect(JSON.parse(stored()!)).toEqual(["clothing"]);
  });

  it("keeps an item visible that is recategorized into a second group while a stored selection is dormant", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["clothing"]));
    installApi({
      items: [item({ id: "c1", name: "Shirt", category: "Clothing" }), item({ id: "c2", name: "Socks", category: "Clothing" })],
    });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(screen.getByRole("button", { name: "Edit Socks" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Category (optional)");
    await user.clear(field);
    await user.type(field, "Toiletries");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chip("Clothing")).toHaveAttribute("aria-pressed", "true");
    expect(rowNames()).toEqual(["Shirt", "Socks"]);
  });

  it("keeps a ticked row visible when someone else moved its item out of the selection", async () => {
    installApi({ items: fixture() }, (call) =>
      call.method === "PATCH" && call.body?.itemId === "c2"
        ? mockFetchResponse({
            data: { item: item({ id: "c2", name: "Socks", category: "Toiletries", packed: true }) },
            error: null,
          })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Clothing"));
    await user.click(screen.getByRole("checkbox", { name: /Socks/ }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Socks/ })).toBeChecked());
    expect(rowNames()).toEqual(["Shirt", "Socks"]);
  });

  it("does not overwrite the typed category or drop a reveal on a language switch", async () => {
    window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify(["toiletries"]));
    // The stub keeps added items, so the reload after the switch returns them like the server would.
    const items = fixture();
    installApi({ items }, (call) => {
      if (call.method !== "POST") return undefined;
      const added = item({ id: "new-charger", name: String(call.body?.name), category: (call.body?.category as string | null) ?? null });
      items.push(added);
      return mockFetchResponse({ data: { item: added, existed: false }, error: null });
    });
    const SwitchToGerman = () => {
      const { setLanguage } = useI18n();
      return (
        <button type="button" onClick={() => setLanguage("de")}>
          switch
        </button>
      );
    };
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <SwitchToGerman />
        <TripPackingList tripId="trip-1" />
      </>,
    );
    await screen.findByText("Toothbrush");
    expect(screen.getByLabelText("Category (optional)")).toHaveValue("Toiletries");

    // Add an item outside the selection (revealed), then type a different category.
    const categoryField = screen.getByLabelText("Category (optional)");
    await user.clear(categoryField);
    await user.type(categoryField, "Electronics");
    await user.type(screen.getByLabelText("Item"), "Charger{Enter}");
    await waitFor(() => expect(rowNames()).toEqual(["Charger", "Toothbrush"]));
    await user.clear(categoryField);
    await user.type(categoryField, "Snacks");

    await user.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(chip("Alle Kategorien")).toBeInTheDocument());
    expect(screen.getByLabelText("Kategorie (optional)")).toHaveValue("Snacks");
    expect(rowNames()).toEqual(["Charger", "Toothbrush"]);
  });

  it("shows and highlights a duplicate in an unselected category", async () => {
    const existing = fixture().find((entry) => entry.id === "e1")!;
    installApi({ items: fixture() }, (call) =>
      call.method === "POST" ? mockFetchResponse({ data: { item: existing, existed: true }, error: null }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Clothing"));
    expect(screen.queryByText("Cable")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Item"), "cable{Enter}");

    expect(await screen.findByTestId("packing-notice")).toHaveTextContent("'Cable' is already on the list.");
    const row = screen.getByText("Cable").closest("li")!;
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(JSON.parse(stored()!)).toEqual(["clothing"]);
  });

  it("lets a viewer filter too, without any write", async () => {
    const api = installApi({ accessRole: "viewer", items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    await user.click(chip("Electronics"));
    expect(rowNames()).toEqual(["Adapter", "Cable"]);
    expect(api.writes()).toEqual([]);
  });

  it("speaks German", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });
    await screen.findByText("Shirt");

    expect(chip("Alle Kategorien")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("packing-category-chips")).toHaveAttribute("aria-label", "Kategorien");
    await user.click(chip("Sonstiges"));
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Auswahl: 0 von 1 eingepackt");

    await user.click(screen.getByRole("button", { name: "Noch offen" }));
    await user.click(screen.getByRole("checkbox", { name: /Umbrella/ }));
    expect(await screen.findByText("In deiner Auswahl ist alles eingepackt.")).toBeInTheDocument();
  });

  it("makes every chip at least 44 px tall and lets the row scroll instead of wrapping", async () => {
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Shirt");

    expect(screen.getByTestId("packing-category-chips")).toHaveStyle({ flexWrap: "nowrap", overflowX: "auto" });
    for (const button of chips().getAllByRole("button")) {
      expect(button).toHaveStyle({ height: "44px" });
    }
  });
});

describe("TripPackingList AI-changes notice (Story 16.4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const change = {
    id: "change-1",
    action: "packingAdded",
    subject: "Sonnencreme, Hut",
    createdAt: new Date().toISOString(),
    undoable: true,
  };

  /** The list (which loses its AI item after the undo), the packing-scoped changes and the undo. */
  const installNoticeApi = (accessRole: "owner" | "contributor" | "viewer", undoAnswer?: () => Response) => {
    let undone = false;
    const calls: string[] = [];
    stubFetch(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf" }, error: null });
        if (url.includes("/ai-changes/change-1/undo")) {
          if (undoAnswer) return undoAnswer();
          undone = true;
          return mockFetchResponse({ data: { undone: true }, error: null });
        }
        if (url.includes("/ai-changes")) {
          return mockFetchResponse({ data: { changes: undone ? [] : [change] }, error: null });
        }
        const items = undone
          ? [item({ id: "1", name: "Pass" })]
          : [item({ id: "1", name: "Pass" }), item({ id: "2", name: "Sonnencreme", aiChangedAt: "2026-11-08T10:00:00.000Z" })];
        return mockFetchResponse({ data: { accessRole, items }, error: null });
      }),
    );
    return calls;
  };

  it("shows the packing-scoped notice to a writer, and Undo reloads the list", async () => {
    const calls = installNoticeApi("contributor");
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    const notice = await screen.findByTestId("ai-changes-notice");
    expect(notice).toHaveTextContent("AI changed the packing list");
    expect(calls).toContain("GET /api/trips/trip-1/ai-changes?scope=packing");
    expect(screen.getByTestId("ai-badge")).toBeInTheDocument();

    await user.click(within(notice).getByTestId("ai-changes-toggle"));
    expect(within(notice).getByTestId("ai-change-row")).toHaveTextContent("Added to the packing list: Sonnencreme, Hut");
    await user.click(within(notice).getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(rowNames()).toEqual(["Pass"]));
    expect(screen.queryByTestId("ai-changes-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-badge")).not.toBeInTheDocument();
  });

  it("speaks German, and says the list changed since for a stale undo", async () => {
    installNoticeApi("owner", () =>
      mockFetchResponse({ data: null, error: { code: "undo_stale", message: "stale" } }, { status: 409 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });

    const notice = await screen.findByTestId("ai-changes-notice");
    expect(notice).toHaveTextContent("KI hat die Packliste geändert");
    await user.click(within(notice).getByTestId("ai-changes-toggle"));
    expect(within(notice).getByTestId("ai-change-row")).toHaveTextContent("Zur Packliste hinzugefügt: Sonnencreme, Hut");
    await user.click(within(notice).getByRole("button", { name: "Rückgängig" }));
    expect(await within(notice).findByTestId("ai-change-status")).toHaveTextContent(
      "Die Packliste hat sich seitdem geändert; diese Änderung kann nicht mehr rückgängig gemacht werden.",
    );
  });

  it("reads the changes again after the person's own edit, so an edited item's change shows as stale", async () => {
    let changesReads = 0;
    let packed = false;
    stubFetch(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf" }, error: null });
        if (url.includes("/ai-changes")) {
          changesReads += 1;
          return mockFetchResponse({ data: { changes: [{ ...change, undoable: !packed }] }, error: null });
        }
        if (init?.method === "PATCH") {
          packed = true;
          return mockFetchResponse({ data: { item: item({ id: "2", name: "Sonnencreme", packed: true }) }, error: null });
        }
        return mockFetchResponse({
          data: { accessRole: "owner", items: [item({ id: "2", name: "Sonnencreme", aiChangedAt: "2026-11-08T10:00:00.000Z" })] },
          error: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByTestId("ai-changes-notice");
    const readsBefore = changesReads;
    await user.click(screen.getByRole("checkbox", { name: /Sonnencreme/ }));
    await waitFor(() => expect(changesReads).toBeGreaterThan(readsBefore));
  });

  it("shows no notice to a viewer and does not ask for the changes", async () => {
    const calls = installNoticeApi("viewer");
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    expect(await screen.findByTestId("packing-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-changes-notice")).not.toBeInTheDocument();
    expect(calls.some((call) => call.includes("/ai-changes"))).toBe(false);
  });
});

/** Story 16.7 (AC 1, 3-5, 7, 9, 10, 16). Not needed this time on the packing list page. */
describe("TripPackingList not needed this time (Story 16.7)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fixture = () => [
    item({ id: "c1", name: "Shirt", category: "Clothing", packed: true }),
    item({ id: "c2", name: "Socks", category: "Clothing" }),
    item({ id: "c3", name: "Swimwear", category: "Clothing", notNeeded: true }),
    item({ id: "e1", name: "Cable", category: "Electronics" }),
    item({ id: "s1", name: "Snorkel", category: "Sport", notNeeded: true }),
    item({ id: "o1", name: "Umbrella", notNeeded: true }),
  ];

  const section = () => screen.getByTestId("packing-not-needed-section");
  const toggle = () => screen.getByTestId("packing-not-needed-toggle");
  const notNeededRows = () => screen.queryAllByTestId("packing-not-needed-row").map((row) => row.querySelector("p")?.textContent);

  it("leaves not-needed items out of the groups and every count", async () => {
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    expect(await screen.findByTestId("packing-progress")).toHaveTextContent("1 of 3 packed");
    expect(screen.getAllByTestId("packing-group-heading").map((heading) => heading.textContent)).toEqual([
      "Clothing 1/2",
      "Electronics 0/1",
    ]);
    expect(rowNames()).toEqual(["Shirt", "Socks", "Cable"]);
  });

  it("shows the section after the categories, collapsed with its count, and expands it grouped and greyed", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByTestId("packing-progress");
    expect(toggle()).toHaveTextContent("Not needed (3)");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    // After the last group.
    const lastGroup = screen.getAllByTestId("packing-group-heading").at(-1)!;
    expect(lastGroup.compareDocumentPosition(section()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(section()).getAllByTestId("packing-not-needed-heading").map((heading) => heading.textContent)).toEqual([
      "Clothing",
      "Sport",
      "Other",
    ]);
    expect(notNeededRows()).toEqual(["Swimwear", "Snorkel", "Umbrella"]);
    expect(within(section()).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(section()).getByText("Swimwear")).not.toHaveStyle({ textDecoration: "line-through" });
  });

  it("renders no section without not-needed items", async () => {
    installApi({ items: [item({ id: "1", name: "Pass" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByTestId("packing-progress");
    expect(screen.queryByTestId("packing-not-needed-section")).not.toBeInTheDocument();
  });

  it("hides the section under Not packed yet", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByTestId("packing-not-needed-section");

    await user.click(screen.getByRole("button", { name: "Not packed yet" }));
    expect(screen.queryByTestId("packing-not-needed-section")).not.toBeInTheDocument();
  });

  it("applies the category selection to the section, and a section-only category still has a chip", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByTestId("packing-progress");

    const chips = within(screen.getByTestId("packing-category-chips"));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "All categories",
      "Clothing",
      "Electronics",
      "Sport",
      "Other",
    ]);

    await user.click(chips.getByRole("button", { name: "Clothing" }));
    expect(toggle()).toHaveTextContent("Not needed (1)");
    await user.click(toggle());
    expect(notNeededRows()).toEqual(["Swimwear"]);
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("1 of 2 packed");

    await user.click(chips.getByRole("button", { name: "Clothing" }));
    await user.click(chips.getByRole("button", { name: "Electronics" }));
    expect(screen.queryByTestId("packing-not-needed-section")).not.toBeInTheDocument();

    await user.click(chips.getByRole("button", { name: "Electronics" }));
    await user.click(chips.getByRole("button", { name: "Sport" }));
    expect(toggle()).toHaveTextContent("Not needed (1)");
    expect(screen.queryAllByTestId("packing-row")).toHaveLength(0);
  });

  it("says nothing in the selection is needed when the chosen category holds only not-needed items (Story 16.7 review)", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });
    await screen.findByTestId("packing-progress");

    await user.click(within(screen.getByTestId("packing-category-chips")).getByRole("button", { name: "Sport" }));
    expect(screen.getByTestId("packing-all-done")).toHaveTextContent("In dieser Auswahl ist diesmal nichts nötig.");
    expect(screen.queryByTestId("packing-selection-progress")).not.toBeInTheDocument();
    expect(screen.getByTestId("packing-progress")).toHaveTextContent("1 von 3 eingepackt");

    // With a needed item in the selection, the selection line and its own messages are back.
    await user.click(within(screen.getByTestId("packing-category-chips")).getByRole("button", { name: "Clothing" }));
    expect(screen.queryByTestId("packing-all-done")).not.toBeInTheDocument();
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("1 von 2");
  });

  it("speaks English for the not-needed-only selection (Story 16.7 review)", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByTestId("packing-progress");

    await user.click(within(screen.getByTestId("packing-category-chips")).getByRole("button", { name: "Sport" }));
    expect(screen.getByTestId("packing-all-done")).toHaveTextContent("Nothing in this selection is needed this time.");
  });

  it("marks an item without days not needed from the edit dialog, directly", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", packed: true }), item({ id: "2", name: "Hut" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Not needed this time" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "PATCH", body: { itemId: "1", notNeeded: true, confirmedDayCount: 0 } }),
    ]);
    expect(rowNames()).toEqual(["Hut"]);
    expect(screen.getByTestId("packing-progress")).toHaveTextContent("0 of 1 packed");
    expect(toggle()).toHaveTextContent("Not needed (1)");
  });

  it("asks before marking an item linked to 3 days, sending the confirmed count", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", dayCount: 3 })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Not needed this time" }));

    expect(await screen.findByText("Not needed this time?")).toBeInTheDocument();
    expect(screen.getByTestId("packing-not-needed-days")).toHaveTextContent("Remove from 3 days?");
    expect(api.writes()).toEqual([]);
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(confirm).getByRole("button", { name: "Not needed" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "PATCH", body: { itemId: "1", notNeeded: true, confirmedDayCount: 3 } }),
    ]);
  });

  it("uses the singular for one day, and Cancel keeps the item needed", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", dayCount: 1 })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });

    await user.click(await screen.findByRole("button", { name: "Pass bearbeiten" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Diesmal nicht nötig" }));
    expect(await screen.findByText("Diesmal nicht nötig?")).toBeInTheDocument();
    expect(screen.getByTestId("packing-not-needed-days")).toHaveTextContent("Von 1 Tag entfernen?");
    await user.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Abbrechen" }));

    await waitFor(() => expect(screen.queryByText("Diesmal nicht nötig?")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([]);
    expect(rowNames()).toEqual(["Pass"]);
  });

  it("asks again with the fresh count when the server answers days_changed", async () => {
    let patches = 0;
    const api = installApi({ items: [item({ id: "1", name: "Pass" })] }, (call) => {
      if (call.method !== "PATCH") return undefined;
      patches += 1;
      if (patches === 1) {
        return mockFetchResponse(
          { data: null, error: { code: "days_changed", message: "changed", details: { dayCount: 2 } } },
          { status: 409 },
        );
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Not needed this time" }));
    expect(await screen.findByText("Remove from 2 days?")).toBeInTheDocument();
    await user.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Not needed" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({ body: { itemId: "1", notNeeded: true, confirmedDayCount: 0 } }),
      expect.objectContaining({ body: { itemId: "1", notNeeded: true, confirmedDayCount: 2 } }),
    ]);
    expect(toggle()).toHaveTextContent("Not needed (1)");
  });

  it("marks an item needed again from the section, back as an open row", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Swimwear", notNeeded: true }), item({ id: "2", name: "Hut" })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByTestId("packing-not-needed-toggle"));
    await user.click(screen.getByRole("button", { name: "Mark Swimwear needed" }));

    await waitFor(() => expect(screen.queryByTestId("packing-not-needed-section")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([expect.objectContaining({ method: "PATCH", body: { itemId: "1", notNeeded: false } })]);
    expect(rowNames()).toEqual(["Hut", "Swimwear"]);
    expect(screen.getByRole("checkbox", { name: "Swimwear packed" })).not.toBeChecked();
  });

  it("marks an item needed again from the edit dialog", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Swimwear", notNeeded: true })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });

    await user.click(await screen.findByTestId("packing-not-needed-toggle"));
    await user.click(screen.getByRole("button", { name: "Swimwear bearbeiten" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Doch nötig" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([expect.objectContaining({ body: { itemId: "1", notNeeded: false } })]);
    expect(rowNames()).toEqual(["Swimwear"]);
  });

  it("sends a typed rename and category with Not needed this time, also after the day confirmation (Story 16.7 review)", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", dayCount: 2 })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Item");
    await user.clear(nameField);
    await user.type(nameField, "Reisepass");
    await user.type(within(dialog).getByLabelText("Category (optional)"), "Documents");
    await user.click(within(dialog).getByRole("button", { name: "Not needed this time" }));
    const confirm = (await screen.findAllByRole("dialog")).at(-1)!;
    await user.click(within(confirm).getByRole("button", { name: "Not needed" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        body: { itemId: "1", name: "Reisepass", category: "Documents", notNeeded: true, confirmedDayCount: 2 },
      }),
    ]);
    await user.click(toggle());
    expect(notNeededRows()).toEqual(["Reisepass"]);
  });

  it("sends a typed rename with Needed after all, and nothing extra when nothing was typed (Story 16.7 review)", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Swimwear", category: "Clothing", notNeeded: true })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByTestId("packing-not-needed-toggle"));
    await user.click(screen.getByRole("button", { name: "Edit Swimwear" }));
    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Item");
    await user.clear(nameField);
    expect(within(dialog).getByRole("button", { name: "Needed after all" })).toBeDisabled();
    await user.type(nameField, "Swim shorts");
    await user.click(within(dialog).getByRole("button", { name: "Needed after all" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([expect.objectContaining({ body: { itemId: "1", name: "Swim shorts", notNeeded: false } })]);
    expect(rowNames()).toEqual(["Swim shorts"]);
  });

  it("keeps the edit dialog open with the error when the typed rename hits an existing name (Story 16.7 review)", async () => {
    installApi({ items: [item({ id: "1", name: "Pass" }), item({ id: "2", name: "Hut" })] }, (call) =>
      call.method === "PATCH"
        ? mockFetchResponse({ data: null, error: { code: "duplicate_name", message: "x" } }, { status: 409 })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Pass" }));
    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Item");
    await user.clear(nameField);
    await user.type(nameField, "Hut");
    await user.click(within(dialog).getByRole("button", { name: "Not needed this time" }));

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(nameField).toHaveValue("Hut");
    expect(rowNames()).toEqual(["Hut", "Pass"]);
  });

  it("opens the section and highlights the row when a not-needed name is added, without marking it needed", async () => {
    window.localStorage.setItem(PACKING_FILTER_STORAGE_KEY, "open");
    const existing = item({ id: "1", name: "Swimwear", notNeeded: true });
    const api = installApi({ items: [existing, item({ id: "2", name: "Hut" })] }, (call) =>
      call.method === "POST" ? mockFetchResponse({ data: { item: existing, existed: true }, error: null }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await screen.findByText("Hut");
    expect(screen.queryByTestId("packing-not-needed-section")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Item"), "swimwear{Enter}");

    expect(await screen.findByTestId("packing-notice")).toHaveTextContent("'Swimwear' is already on the list.");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const row = screen.getByTestId("packing-not-needed-row");
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(api.writes()).toEqual([expect.objectContaining({ method: "POST" })]);
    expect(window.localStorage.getItem(PACKING_FILTER_STORAGE_KEY)).toBe("open");
  });

  it("says nothing is needed when every item is not needed", async () => {
    installApi({ items: [item({ id: "1", name: "Swimwear", notNeeded: true })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });

    expect(await screen.findByTestId("packing-all-done")).toHaveTextContent("Diesmal ist nichts auf der Liste nötig.");
    expect(screen.getByTestId("packing-progress")).toHaveTextContent("0 von 0 eingepackt");
    expect(screen.getByTestId("packing-not-needed-toggle")).toHaveTextContent("Nicht nötig (1)");
  });

  it("rolls a tick back and reloads when the item was marked not needed elsewhere", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass" })] }, (call) =>
      call.method === "PATCH"
        ? mockFetchResponse({ data: null, error: { code: "not_needed", message: "not needed" } }, { status: 409 })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("checkbox", { name: "Pass packed" }));
    expect(await screen.findByText("This item is marked not needed this time.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Pass packed" })).not.toBeChecked();
    await waitFor(() => expect(api.calls.filter((call) => call.method === "GET" && call.url.endsWith("/packing-items"))).toHaveLength(2));
  });

  it("lets a viewer open the section read-only", async () => {
    installApi({ accessRole: "viewer", items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByTestId("packing-not-needed-toggle"));
    expect(notNeededRows()).toEqual(["Swimwear", "Snorkel", "Umbrella"]);
    // The toggle is the section's only button: no "Needed after all", no edit pencil.
    expect(within(section()).getAllByRole("button")).toEqual([toggle()]);
    expect(screen.queryByRole("button", { name: "Mark Swimwear needed" })).not.toBeInTheDocument();
  });
});

describe("TripPackingList tags (Story 16.8)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fixture = () => [
    item({ id: "p1", name: "Powerbank", category: "Electronics", tags: ["Kaufen", "Aufladen"] }),
    item({ id: "p2", name: "Cable", category: "Electronics", packed: true, tags: ["kaufen"] }),
    item({ id: "p3", name: "Socks", category: "Clothing", tags: ["Kaufen"] }),
    item({ id: "p4", name: "Shirt", category: "Clothing" }),
    item({ id: "p5", name: "Drone", category: "Electronics", notNeeded: true, tags: ["Zoll anmelden"] }),
  ];

  /** The name of each list row (its first paragraph), without the tag chips. */
  const names = () => screen.queryAllByTestId("packing-row").map((row) => row.querySelector("p")?.textContent);
  const rowTags = (rowName: string) => {
    const row = screen.getAllByTestId(/packing-(not-needed-)?row/).find((entry) => entry.querySelector("p")?.textContent === rowName)!;
    return within(row).queryAllByTestId("packing-tag").map((tag) => tag.textContent);
  };
  const tagChip = (name: string) => within(screen.getByTestId("packing-tag-chips")).getByRole("button", { name });
  const categoryChip = (name: string) => within(screen.getByTestId("packing-category-chips")).getByRole("button", { name });
  const storedTags = () => window.localStorage.getItem(packingTagStorageKey("trip-1"));
  const tagsField = (container: HTMLElement = document.body) =>
    within(container).getByRole("combobox", { name: "Tags" });
  const fieldChips = (container: HTMLElement = document.body) =>
    within(container).queryAllByTestId("packing-tag-input-chip").map((chip) => chip.textContent);

  it("shows an item's tags as chips after its name, alphabetically, in the list and the not-needed section", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    expect(rowTags("Powerbank")).toEqual(["Aufladen", "Kaufen"]);
    expect(rowTags("Cable")).toEqual(["kaufen"]);
    expect(rowTags("Shirt")).toEqual([]);
    await user.click(screen.getByTestId("packing-not-needed-toggle"));
    expect(rowTags("Drone")).toEqual(["Zoll anmelden"]);
    // Display only: a chip is no button.
    expect(screen.getAllByTestId("packing-tag")[0].tagName).toBe("SPAN");
  });

  it("builds the tag filter from every item: All tags first, one chip per key in the first spelling, alphabetically", async () => {
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    const row = screen.getByTestId("packing-tag-chips");
    expect(row).toHaveAttribute("role", "group");
    expect(row).toHaveAttribute("aria-label", "Tags");
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "All tags",
      "Aufladen",
      "Kaufen",
      "Zoll anmelden",
    ]);
    expect(tagChip("All tags")).toHaveAttribute("aria-pressed", "true");
    // Below the category row.
    const categories = screen.getByTestId("packing-category-chips");
    expect(categories.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the tag row alone with a single category, and none without tags", async () => {
    installApi({ items: [item({ id: "1", name: "Pass", tags: ["Kopieren"] })] });
    const { unmount } = renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Pass");
    expect(screen.queryByTestId("packing-category-chips")).not.toBeInTheDocument();
    expect(screen.getByTestId("packing-tag-chips")).toBeInTheDocument();
    unmount();

    installApi({ items: [item({ id: "1", name: "Pass" })] });
    renderWithProviders(<TripPackingList tripId="trip-2" />);
    await screen.findByText("Pass");
    expect(screen.queryByTestId("packing-tag-chips")).not.toBeInTheDocument();
  });

  it("filters by any selected tag, combines with categories and Not packed yet, and counts the selection", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    await user.click(tagChip("Kaufen"));
    expect(names()).toEqual(["Socks", "Cable", "Powerbank"]);
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 1 of 3 packed");
    // Heading counts keep counting the whole category (D6).
    expect(screen.getAllByTestId("packing-group-heading").map((heading) => heading.textContent)).toEqual([
      "Clothing 0/2",
      "Electronics 1/2",
    ]);

    await user.click(tagChip("Aufladen"));
    expect(names()).toEqual(["Socks", "Cable", "Powerbank"]);

    await user.click(categoryChip("Electronics"));
    expect(names()).toEqual(["Cable", "Powerbank"]);
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 1 of 2 packed");

    await user.click(screen.getByRole("button", { name: "Not packed yet" }));
    expect(names()).toEqual(["Powerbank"]);

    await user.click(tagChip("Kaufen"));
    await user.click(tagChip("Aufladen"));
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(names()).toEqual(["Cable", "Powerbank"]);
    await user.click(tagChip("All tags"));
    expect(tagChip("All tags")).toHaveAttribute("aria-pressed", "true");
  });

  it("applies the tag selection to the not-needed section, and says when the selection is packed or not needed", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    await user.click(tagChip("Zoll anmelden"));
    expect(names()).toEqual([]);
    expect(screen.getByTestId("packing-all-done")).toHaveTextContent("Nothing in this selection is needed this time.");
    expect(screen.queryByTestId("packing-selection-progress")).not.toBeInTheDocument();
    expect(screen.getByTestId("packing-not-needed-toggle")).toHaveTextContent("Not needed (1)");

    await user.click(tagChip("Kaufen"));
    expect(screen.getByTestId("packing-not-needed-toggle")).toHaveTextContent("Not needed (1)");
    await user.click(tagChip("Zoll anmelden"));
    expect(screen.queryByTestId("packing-not-needed-section")).not.toBeInTheDocument();

    await user.click(categoryChip("Electronics"));
    await user.click(screen.getByRole("button", { name: "Not packed yet" }));
    expect(names()).toEqual(["Powerbank"]);
    await user.click(screen.getByRole("checkbox", { name: "Powerbank packed" }));
    expect(screen.getByTestId("packing-all-done")).toHaveTextContent("Everything in your selection is packed.");
  });

  it("remembers the tag selection per trip; a vanished tag is ignored, never erased", async () => {
    window.localStorage.setItem(packingTagStorageKey("trip-1"), JSON.stringify(["gone", "AUFLADEN"]));
    installApi({ items: fixture() });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");
    expect(names()).toEqual(["Powerbank"]);
    expect(tagChip("Aufladen")).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(storedTags()!)).toEqual(["gone", "AUFLADEN"]);

    await user.click(tagChip("Kaufen"));
    expect(JSON.parse(storedTags()!)).toEqual(["aufladen", "kaufen"]);
    unmount();

    window.localStorage.setItem(packingTagStorageKey("trip-1"), JSON.stringify(["gone"]));
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");
    expect(names()).toHaveLength(4);
    expect(storedTags()).toBe(JSON.stringify(["gone"]));
  });

  it("prefills the add form's tags for one selected tag, on the first load and on a chip change", async () => {
    window.localStorage.setItem(packingTagStorageKey("trip-1"), JSON.stringify(["kaufen"]));
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");
    expect(fieldChips()).toEqual(["Kaufen"]);

    await user.click(tagChip("Aufladen"));
    // Two selected: the field is left as it was.
    expect(fieldChips()).toEqual(["Kaufen"]);
    await user.click(tagChip("Kaufen"));
    expect(fieldChips()).toEqual(["Aufladen"]);
  });

  it("does not overwrite the typed tags on a reload (language switch)", async () => {
    window.localStorage.setItem(packingTagStorageKey("trip-1"), JSON.stringify(["kaufen"]));
    installApi({ items: fixture() });
    const SwitchToGerman = () => {
      const { setLanguage } = useI18n();
      return (
        <button type="button" onClick={() => setLanguage("de")}>
          switch
        </button>
      );
    };
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <SwitchToGerman />
        <TripPackingList tripId="trip-1" />
      </>,
    );
    await screen.findByText("Powerbank");
    await user.type(tagsField(), "Batterie{Enter}");
    expect(fieldChips()).toEqual(["Kaufen", "Batterie"]);

    await user.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(tagChip("Alle Tags")).toBeInTheDocument());
    expect(fieldChips()).toEqual(["Kaufen", "Batterie"]);
  });

  it("adds tags with Enter and comma, ignores a duplicate, sends typed text on Add, and keeps the tags", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Pass", tags: ["Kopieren"] })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Pass");

    await user.type(tagsField(), "Kaufen{Enter}");
    await user.type(tagsField(), "aufladen,kaufen,");
    expect(fieldChips()).toEqual(["Kaufen", "aufladen"]);
    await user.type(tagsField(), "Zoll");
    await user.type(screen.getByLabelText("Item"), "Powerbank{Enter}");

    await waitFor(() => expect(names()).toContain("Powerbank"));
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "POST", body: { name: "Powerbank", category: null, tags: ["Kaufen", "aufladen", "Zoll"] } }),
    ]);
    expect(fieldChips()).toEqual(["Kaufen", "aufladen", "Zoll"]);
    expect(tagsField()).toHaveValue("");
    expect(rowTags("Powerbank")).toEqual(["aufladen", "Kaufen", "Zoll"]);
  });

  it("offers the default tags and the trip's tags, minus the ones already chosen", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    await user.click(tagsField());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Buy",
      "Repair",
      "Charge",
      "Declare at customs",
      "Aufladen",
      "Kaufen",
      "Zoll anmelden",
    ]);
    await user.click(within(listbox).getByRole("option", { name: "Repair" }));
    expect(fieldChips()).toEqual(["Repair"]);
    await user.click(tagsField());
    expect(within(await screen.findByRole("listbox")).queryByRole("option", { name: "Repair" })).not.toBeInTheDocument();
  });

  it("turns the 11th tag away with At most 10 tags, and does not send while typed text is over the limit", async () => {
    const api = installApi({ items: [] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByTestId("packing-empty");

    await user.type(tagsField(), "a,b,c,d,e,f,g,h,i,j,");
    expect(fieldChips()).toHaveLength(10);
    expect(screen.queryByText("At most 10 tags.")).not.toBeInTheDocument();
    await user.type(tagsField(), "k,");
    expect(fieldChips()).toHaveLength(10);
    expect(screen.getByText("At most 10 tags.")).toBeInTheDocument();

    await user.type(tagsField(), "late");
    await user.type(screen.getByLabelText("Item"), "Koffer{Enter}");
    expect(api.writes()).toEqual([]);
    expect(tagsField()).toHaveValue("late");
  });

  it("shows the 409 too_many_tags message for a merge past 10", async () => {
    installApi({ items: [item({ id: "1", name: "Koffer" })] }, (call) =>
      call.method === "POST"
        ? mockFetchResponse({ data: null, error: { code: "too_many_tags", message: "x" } }, { status: 409 })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Koffer");
    await user.type(tagsField(), "Neu{Enter}");
    await user.type(screen.getByLabelText("Item"), "koffer{Enter}");
    expect(await screen.findByText("This item would have too many tags.")).toBeInTheDocument();
  });

  it("merges tags onto an existing name and reveals it when it lands outside the tag selection", async () => {
    const existing = item({ id: "p4", name: "Shirt", category: "Clothing" });
    installApi({ items: fixture() }, (call) =>
      call.method === "POST"
        ? mockFetchResponse({ data: { item: { ...existing, tags: call.body?.tags as string[] }, existed: true }, error: null })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    await user.click(tagChip("Aufladen"));
    expect(names()).toEqual(["Powerbank"]);
    // The prefilled tag is Aufladen; adding "Shirt" merges it, so Shirt now matches and shows.
    await user.type(screen.getByLabelText("Item"), "shirt{Enter}");
    await waitFor(() => expect(names()).toEqual(["Shirt", "Powerbank"]));
    expect(rowTags("Shirt")).toEqual(["Aufladen"]);
    expect(screen.getByTestId("packing-notice")).toHaveTextContent("'Shirt' is already on the list.");
  });

  it("keeps an item added without the selected tag visible for now", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    await user.click(tagChip("Aufladen"));
    // Remove the prefilled tag in one tap, then add an untagged item.
    // The chip's delete control is a 44 px target (AC 5); jsdom cannot measure layout, so by style.
    expect(screen.getByRole("button", { name: "Remove tag Aufladen" })).toHaveStyle({ width: "44px", height: "44px" });
    await user.click(screen.getByRole("button", { name: "Remove tag Aufladen" }));
    expect(fieldChips()).toEqual([]);
    await user.type(screen.getByLabelText("Item"), "Charger{Enter}");
    // Charger has no category: the Other group, last.
    await waitFor(() => expect(names()).toEqual(["Powerbank", "Charger"]));
    expect(screen.getByTestId("packing-selection-progress")).toHaveTextContent("Selection: 0 of 1 packed");
    await user.click(tagChip("Kaufen"));
    expect(names()).not.toContain("Charger");
  });

  it("edits tags in the dialog: prefilled, removed with one tap, the full list saved", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Powerbank", tags: ["Kaufen", "Aufladen"] })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Powerbank" }));
    const dialog = await screen.findByRole("dialog");
    expect(fieldChips(dialog)).toEqual(["Kaufen", "Aufladen"]);
    await user.click(within(dialog).getByRole("button", { name: "Remove tag Kaufen" }));
    expect(fieldChips(dialog)).toEqual(["Aufladen"]);
    await user.type(tagsField(dialog), "Reparieren");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        body: { itemId: "1", name: "Powerbank", category: null, tags: ["Aufladen", "Reparieren"] },
      }),
    ]);
    expect(rowTags("Powerbank")).toEqual(["Aufladen", "Reparieren"]);
  });

  it("saves a rename without tags when the tags are unchanged, so tags added elsewhere are not dropped (Story 16.8 review)", async () => {
    const api = installApi({ items: [item({ id: "1", name: "Powerbank", tags: ["Kaufen"] })] });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Powerbank" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Item"));
    await user.type(within(dialog).getByLabelText("Item"), "Power bank");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes().map((call) => call.body)).toEqual([{ itemId: "1", name: "Power bank", category: null }]);
  });

  it("sends nothing with Not needed this time or Needed after all while typed tag text is over the limit (Story 16.8 review)", async () => {
    const ten = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"];
    const api = installApi({
      items: [
        item({ id: "1", name: "Powerbank", tags: ten }),
        item({ id: "2", name: "Hut", tags: ten, notNeeded: true }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Powerbank" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(tagsField(dialog), "Kaufen");
    await user.click(within(dialog).getByRole("button", { name: "Not needed this time" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByText("At most 10 tags.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByTestId("packing-not-needed-toggle"));
    await user.click(await screen.findByRole("button", { name: "Edit Hut" }));
    dialog = await screen.findByRole("dialog");
    await user.type(tagsField(dialog), "Kaufen");
    await user.click(within(dialog).getByRole("button", { name: "Needed after all" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    expect(api.writes()).toEqual([]);
  });

  it("sends changed tags with Not needed this time, and none when they are unchanged", async () => {
    const api = installApi({
      items: [item({ id: "1", name: "Powerbank", tags: ["Kaufen"] }), item({ id: "2", name: "Hut", tags: ["Kaufen"] })],
    });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);

    await user.click(await screen.findByRole("button", { name: "Edit Powerbank" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(tagsField(dialog), "Aufladen{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Not needed this time" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Edit Hut" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Not needed this time" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(api.writes().map((call) => call.body)).toEqual([
      { itemId: "1", tags: ["Kaufen", "Aufladen"], notNeeded: true, confirmedDayCount: 0 },
      { itemId: "2", notNeeded: true, confirmedDayCount: 0 },
    ]);
  });

  it("lets a viewer see the chips and use the tag filter, without a tags field", async () => {
    installApi({ accessRole: "viewer", items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");

    expect(rowTags("Powerbank")).toEqual(["Aufladen", "Kaufen"]);
    expect(screen.queryByRole("combobox", { name: "Tags" })).not.toBeInTheDocument();
    await user.click(tagChip("Aufladen"));
    expect(names()).toEqual(["Powerbank"]);
    expect(JSON.parse(storedTags()!)).toEqual(["aufladen"]);
  });

  it("speaks German", async () => {
    installApi({ items: fixture() });
    const user = userEvent.setup();
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });
    await screen.findByText("Powerbank");
    expect(tagChip("Alle Tags")).toBeInTheDocument();
    await user.click(tagsField());
    expect(within(await screen.findByRole("listbox")).getAllByRole("option").map((option) => option.textContent).slice(0, 4)).toEqual([
      "Kaufen",
      "Reparieren",
      "Aufladen",
      "Zoll anmelden",
    ]);
  });

  it("makes every tag chip at least 44 px tall and lets the row scroll", async () => {
    installApi({ items: fixture() });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Powerbank");
    const row = screen.getByTestId("packing-tag-chips");
    expect(row).toHaveStyle({ flexWrap: "nowrap", overflowX: "auto" });
    for (const chip of within(row).getAllByRole("button")) expect(chip).toHaveStyle({ height: "44px" });
  });
});


describe("TripPackingList copy from another trip (Story 16.5)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Source = { id: string; name: string; startDate: string; endDate: string; itemCount: number };

  const summer: Source = {
    id: "src-1",
    name: "Sommer 2026",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-14T00:00:00.000Z",
    itemCount: 4,
  };
  const winter: Source = {
    id: "src-2",
    name: "Winter 2025",
    startDate: "2025-12-20T00:00:00.000Z",
    endDate: "2025-12-27T00:00:00.000Z",
    itemCount: 1,
  };

  const summerItems = [
    item({ id: "s1", name: "Badehose", category: "Kleidung", packed: true }),
    item({ id: "s2", name: "Sonnenhut", category: "Kleidung", tags: ["Kaufen"] }),
    item({ id: "s3", name: "Schnorchel", category: "Kleidung", notNeeded: true }),
    item({ id: "s4", name: "Ladekabel" }),
  ];

  /**
   * The list stub routes by URL before the method: the sources listing, the source trip's list and the
   * copy POST, then the trip's own list for every other GET.
   */
  const installCopyApi = (options: {
    accessRole?: "owner" | "contributor" | "viewer";
    items?: PackingItemWire[];
    sources?: Source[] | "error";
    sourceItems?: PackingItemWire[] | "error";
    copyAnswer?: (body: Record<string, unknown>) => Response;
  }) => {
    const calls: Call[] = [];
    stubFetch(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        calls.push({ url, method, body });
        if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf" }, error: null });
        if (url.includes("/packing-items/copy")) {
          if (method === "GET") {
            if (options.sources === "error") return mockFetchResponse({ data: null, error: { code: "server_error", message: "x" } }, { status: 500 });
            return mockFetchResponse({ data: { trips: options.sources ?? [summer, winter] }, error: null });
          }
          if (options.copyAnswer) return options.copyAnswer(body!);
          const ids = body!.itemIds as string[];
          return mockFetchResponse({
            data: {
              added: ids.length,
              existed: 0,
              items: ids.map((id) => item({ id: `copy-${id}`, name: summerItems.find((entry) => entry.id === id)!.name })),
            },
            error: null,
          });
        }
        if (/\/api\/trips\/src-\d\/packing-items$/.test(url)) {
          if (options.sourceItems === "error") return mockFetchResponse({ data: null, error: { code: "server_error", message: "x" } }, { status: 500 });
          return mockFetchResponse({ data: { accessRole: "viewer", items: options.sourceItems ?? summerItems }, error: null });
        }
        return mockFetchResponse({ data: { accessRole: options.accessRole ?? "owner", items: options.items ?? [] }, error: null });
      }),
    );
    return { calls, copyPosts: () => calls.filter((call) => call.method === "POST" && call.url.includes("/copy")) };
  };

  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByTestId("packing-copy-open"));
    return screen.findByRole("dialog");
  };

  const chooseSummer = async (user: ReturnType<typeof userEvent.setup>) => {
    const dialog = await openDialog(user);
    const rows = await within(dialog).findAllByTestId("packing-copy-source");
    await user.click(rows[0]);
    await within(dialog).findAllByTestId("packing-copy-item");
    return dialog;
  };

  it("shows the button for owner and contributor, below the add form, also on an empty list", async () => {
    for (const accessRole of ["owner", "contributor"] as const) {
      installCopyApi({ accessRole });
      const { unmount } = renderWithProviders(<TripPackingList tripId="trip-1" />);
      expect(await screen.findByTestId("packing-copy-open")).toHaveTextContent("Copy from another trip");
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it("hides the button from a viewer", async () => {
    installCopyApi({ accessRole: "viewer", items: [item({ id: "1", name: "Pass" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    await screen.findByText("Pass");
    expect(screen.queryByTestId("packing-copy-open")).not.toBeInTheDocument();
  });

  it("lists the trips in the server's order with name, dates and item count", async () => {
    const user = userEvent.setup();
    installCopyApi({});
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await openDialog(user);

    const rows = await within(dialog).findAllByTestId("packing-copy-source");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Sommer 2026Jul 1, 2026 – Jul 14, 2026 · 4 items",
      "Winter 2025Dec 20, 2025 – Dec 27, 2025 · 1 item",
    ]);
  });

  it("says so when no other trip has a packing list", async () => {
    const user = userEvent.setup();
    installCopyApi({ sources: [] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByTestId("packing-copy-no-sources")).toHaveTextContent("No other trip has a packing list.");
  });

  it("shows a load error for the trips and for the source list", async () => {
    const user = userEvent.setup();
    installCopyApi({ sources: "error" });
    const first = renderWithProviders(<TripPackingList tripId="trip-1" />);
    let dialog = await openDialog(user);
    expect(await within(dialog).findByTestId("packing-copy-load-error")).toHaveTextContent("Could not be loaded.");
    first.unmount();
    vi.unstubAllGlobals();

    installCopyApi({ sourceItems: "error" });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    dialog = await openDialog(user);
    await user.click((await within(dialog).findAllByTestId("packing-copy-source"))[0]);
    expect(await within(dialog).findByTestId("packing-copy-load-error")).toHaveTextContent("Could not be loaded.");
  });

  it("groups the source items like the list, Other last, all selected, not-needed inside its category, with hints", async () => {
    const user = userEvent.setup();
    installCopyApi({ items: [item({ id: "mine", name: "LADEKABEL" })] });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await chooseSummer(user);

    const groups = within(dialog).getAllByTestId("packing-copy-group");
    expect(groups.map((group) => within(group).getByRole("heading").textContent)).toEqual(["Kleidung", "Other"]);
    expect(within(groups[0]).getAllByTestId("packing-copy-item").map((row) => row.textContent)).toEqual([
      "Badehose",
      "Schnorchelnot needed there",
      "SonnenhutKaufen",
    ]);
    expect(within(groups[1]).getAllByTestId("packing-copy-item").map((row) => row.textContent)).toEqual([
      "Ladekabelalready on the list",
    ]);
    for (const row of within(dialog).getAllByTestId("packing-copy-item")) {
      expect(within(row).getByRole("checkbox")).toBeChecked();
    }
    expect(within(dialog).getByTestId("packing-copy-count")).toHaveTextContent("4 of 4 selected");
    expect(within(dialog).getByTestId("packing-copy-confirm")).toHaveTextContent("Copy 4");
  });

  it("selects a category all / none with its tri-state box and disables confirm at zero", async () => {
    const user = userEvent.setup();
    installCopyApi({});
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await chooseSummer(user);
    const groupBox = within(dialog).getByRole("checkbox", { name: "Kleidung: select all" });
    const otherBox = within(dialog).getByRole("checkbox", { name: "Other: select all" });

    expect(groupBox).toBeChecked();
    await user.click(groupBox);
    expect(groupBox).not.toBeChecked();
    expect(within(dialog).getByTestId("packing-copy-count")).toHaveTextContent("1 of 4 selected");

    await user.click(groupBox);
    expect(groupBox).toBeChecked();

    const badehose = within(dialog).getAllByTestId("packing-copy-item")[0];
    await user.click(within(badehose).getByRole("checkbox"));
    expect(groupBox).toHaveAttribute("data-indeterminate", "true");
    expect(within(dialog).getByTestId("packing-copy-count")).toHaveTextContent("3 of 4 selected");

    await user.click(groupBox);
    expect(groupBox).toBeChecked();
    await user.click(groupBox);
    await user.click(otherBox);
    expect(within(dialog).getByTestId("packing-copy-confirm")).toBeDisabled();
    expect(within(dialog).getByTestId("packing-copy-confirm")).toHaveTextContent("Copy 0");
  });

  it("sends the source and the selected ids, closes, shows the created items and the notice", async () => {
    const user = userEvent.setup();
    const api = installCopyApi({});
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await chooseSummer(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "Kleidung: select all" }));

    await user.click(within(dialog).getByTestId("packing-copy-confirm"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.copyPosts()).toEqual([
      { url: "/api/trips/trip-1/packing-items/copy", method: "POST", body: { sourceTripId: "src-1", itemIds: ["s4"] } },
    ]);
    expect(screen.getByTestId("packing-notice")).toHaveTextContent("1 item added.");
    expect(rowNames()).toEqual(["Ladekabel"]);
  });

  it.each([
    [3, 0, "3 items added."],
    [2, 1, "2 items added. 1 was already on the list."],
    [1, 2, "1 item added. 2 were already on the list."],
    [0, 4, "Nothing added. 4 were already on the list."],
  ])("words the notice for %i added and %i skipped", async (added, existed, text) => {
    const user = userEvent.setup();
    installCopyApi({
      copyAnswer: () => mockFetchResponse({ data: { added, existed, items: [] }, error: null }),
    });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await chooseSummer(user);
    await user.click(within(dialog).getByTestId("packing-copy-confirm"));
    expect(await screen.findByTestId("packing-notice")).toHaveTextContent(text);
  });

  it("speaks German in the notice", async () => {
    const user = userEvent.setup();
    installCopyApi({
      copyAnswer: () => mockFetchResponse({ data: { added: 2, existed: 1, items: [] }, error: null }),
    });
    renderWithProviders(<TripPackingList tripId="trip-1" />, { language: "de" });
    await user.click(await screen.findByTestId("packing-copy-open"));
    const dialog = await screen.findByRole("dialog");
    await user.click((await within(dialog).findAllByTestId("packing-copy-source"))[0]);
    await within(dialog).findAllByTestId("packing-copy-item");
    expect(within(dialog).getByTestId("packing-copy-confirm")).toHaveTextContent("4 übernehmen");
    await user.click(within(dialog).getByTestId("packing-copy-confirm"));
    expect(await screen.findByTestId("packing-notice")).toHaveTextContent(
      "2 Gegenstände übernommen. 1 war schon auf der Liste.",
    );
  });

  it("keeps the dialog on step 2 with the selection and shows a failed copy in it", async () => {
    const user = userEvent.setup();
    installCopyApi({
      copyAnswer: () => mockFetchResponse({ data: null, error: { code: "source_not_found", message: "x" } }, { status: 404 }),
    });
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await chooseSummer(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "Other: select all" }));

    await user.click(within(dialog).getByTestId("packing-copy-confirm"));

    expect(await within(dialog).findByTestId("packing-copy-error")).toHaveTextContent("That trip is no longer available.");
    expect(within(dialog).getByTestId("packing-copy-count")).toHaveTextContent("3 of 4 selected");
    expect(screen.queryByTestId("packing-notice")).not.toBeInTheDocument();
  });

  it("goes back to the trips with Other trip and drops the selection", async () => {
    const user = userEvent.setup();
    installCopyApi({});
    renderWithProviders(<TripPackingList tripId="trip-1" />);
    const dialog = await chooseSummer(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "Other: select all" }));

    await user.click(within(dialog).getByRole("button", { name: "Other trip" }));

    expect(await within(dialog).findAllByTestId("packing-copy-source")).toHaveLength(2);
    await user.click(within(dialog).getAllByTestId("packing-copy-source")[0]);
    await within(dialog).findAllByTestId("packing-copy-item");
    expect(within(dialog).getByTestId("packing-copy-count")).toHaveTextContent("4 of 4 selected");
  });
});
