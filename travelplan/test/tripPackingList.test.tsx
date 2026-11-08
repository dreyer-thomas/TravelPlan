// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripPackingList, { PACKING_FILTER_STORAGE_KEY, type PackingItemWire } from "@/components/features/trips/TripPackingList";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/** Story 16.1 (AC 2-9, 11). The packing list page against a stubbed API. */

const item = (overrides: Partial<PackingItemWire> & { id: string; name: string }): PackingItemWire => ({
  category: null,
  packed: false,
  dayCount: 0,
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
          data: { item: item({ id: `new-${calls.length}`, name: String(body?.name), category: (body?.category as string | null) ?? null }), existed: false },
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
      expect.objectContaining({ method: "POST", body: { name: "Taucherbrille", category: "Sport" } }),
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
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", body: { itemId: "1" } })]);
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
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", body: { itemId: "1" } })]);
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
});
