// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripDayPackingSection from "@/components/features/trips/TripDayPackingSection";
import type { PackingItemWire } from "@/components/features/trips/TripPackingList";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

/** Story 16.2 (AC 1-7). The day view's "Take along" section against a stubbed API. */

const DAY = { id: "day-1", dayIndex: 1, date: "2026-08-03T00:00:00.000Z" };
const OTHER_DAY = { id: "day-2", dayIndex: 2, date: "2026-08-04T00:00:00.000Z" };

const item = (overrides: Partial<PackingItemWire> & { id: string; name: string }): PackingItemWire => {
  const days = overrides.days ?? [];
  return {
    category: null,
    packed: false,
    aiChangedAt: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
    days,
    dayCount: days.length,
  };
};

type Call = { url: string; method: string; body: Record<string, unknown> | null };

const installApi = (items: PackingItemWire[], writeAnswer?: (call: Call) => Response | undefined) => {
  const calls: Call[] = [];
  stubFetch(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call = { url, method, body };
      calls.push(call);
      if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf" }, error: null });
      if (method === "GET") return mockFetchResponse({ data: { accessRole: "owner", items }, error: null });
      const custom = writeAnswer?.(call);
      if (custom) return custom;
      if (method === "POST" && body?.itemId) {
        const current = items.find((entry) => entry.id === body.itemId)!;
        return mockFetchResponse({ data: { item: item({ ...current, days: [...current.days, DAY] }), created: false }, error: null });
      }
      if (method === "POST") {
        return mockFetchResponse({
          data: { item: item({ id: "new", name: String(body?.name), category: (body?.category as string | null) ?? null, days: [DAY] }), created: true },
          error: null,
        });
      }
      const current = items.find((entry) => entry.id === body?.itemId)!;
      return mockFetchResponse({ data: { item: item({ ...current, days: current.days.filter((day) => day.id !== DAY.id) }) }, error: null });
    }),
  );
  return { calls, writes: () => calls.filter((call) => call.method !== "GET" && !call.url.includes("csrf")) };
};

const rowNames = () => screen.getAllByTestId("day-packing-row").map((row) => row.textContent);

const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Add to take along" }));
  return within(await screen.findByRole("dialog"));
};

describe("TripDayPackingSection (Story 16.2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the day's items grouped like the trip list, Other last, with a packed mark only on packed items and no checkbox", async () => {
    installApi([
      item({ id: "1", name: "Swimwear", category: "Clothing", days: [DAY] }),
      item({ id: "2", name: "Cap", category: "Clothing", packed: true, days: [DAY, OTHER_DAY] }),
      item({ id: "3", name: "Towel", days: [DAY] }),
      item({ id: "4", name: "Passport", category: "Documents", days: [DAY], aiChangedAt: "2026-11-01T10:00:00.000Z" }),
      item({ id: "5", name: "Tent", category: "Camping", days: [OTHER_DAY] }),
    ]);
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    expect(await screen.findByRole("heading", { name: "Take along" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("day-packing-row")).toHaveLength(4));
    expect(screen.getAllByTestId("day-packing-group").map((group) => group.textContent)).toEqual(["Clothing", "Documents", "Other"]);
    expect(rowNames().map((name) => name?.replace(/AI|KI/, ""))).toEqual(["Cap", "Swimwear", "Passport", "Towel"]);
    expect(screen.getAllByRole("img", { name: "Packed" })).toHaveLength(1);
    const capRow = screen.getAllByTestId("day-packing-row")[0];
    expect(within(capRow).getByRole("img", { name: "Packed" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Cap")).not.toHaveStyle({ textDecoration: "line-through" });
  });

  it("shows a planner an empty day as heading and add button only", async () => {
    installApi([item({ id: "1", name: "Tent", days: [OTHER_DAY] })]);
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    expect(await screen.findByRole("heading", { name: "Take along" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to take along" })).toBeEnabled());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders nothing for a viewer on an empty day", async () => {
    const api = installApi([item({ id: "1", name: "Tent", days: [OTHER_DAY] })]);
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit={false} />);

    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("day-packing-section")).not.toBeInTheDocument();
  });

  it("shows a viewer the day's list without add or remove", async () => {
    installApi([item({ id: "1", name: "Swimwear", packed: true, days: [DAY] })]);
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit={false} />);

    expect(await screen.findByText("Swimwear")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Packed" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("picks an item: filters case-insensitively, hides linked items, links with POST and shows the row", async () => {
    const api = installApi([
      item({ id: "1", name: "Swimwear", days: [DAY] }),
      item({ id: "2", name: "Snorkel mask", category: "Sport" }),
      item({ id: "3", name: "Sunscreen" }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    const dialog = await openPicker(user);
    await user.type(dialog.getByRole("combobox"), "s");
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Snorkel maskSport", "Sunscreen", "Create 's'"]);

    await user.clear(dialog.getByRole("combobox"));
    await user.type(dialog.getByRole("combobox"), "KEL");
    await user.click(await screen.findByRole("option", { name: /Snorkel mask/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "POST", url: "/api/trips/trip-1/packing-items/day-links", body: { tripDayId: DAY.id, itemId: "2" } }),
    ]);
    expect(rowNames()).toEqual(["Snorkel mask", "Swimwear"]);
  });

  it("creates a new item from the day with a category", async () => {
    const api = installApi([item({ id: "1", name: "Swimwear", category: "Clothing" })]);
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    const dialog = await openPicker(user);
    await user.type(dialog.getByRole("combobox"), "Snorkel mask");
    await user.click(await screen.findByRole("option", { name: "Create 'Snorkel mask'" }));

    expect(await screen.findByTestId("day-packing-create-name")).toHaveTextContent("Snorkel mask");
    await user.type(screen.getByRole("combobox", { name: "Category (optional)" }), "Sport");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: "POST", body: { tripDayId: DAY.id, name: "Snorkel mask", category: "Sport" } }),
    ]);
    expect(rowNames()).toEqual(["Snorkel mask"]);
  });

  it("offers the default categories when creating", async () => {
    installApi([]);
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    const dialog = await openPicker(user);
    await user.type(dialog.getByRole("combobox"), "Hat{Enter}");
    await user.click(await screen.findByRole("combobox", { name: "Category (optional)" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toContain("Clothing");
  });

  it("links the existing item on Enter for a name in other case, without a create option", async () => {
    const api = installApi([item({ id: "2", name: "Snorkel mask" })]);
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    const dialog = await openPicker(user);
    await user.type(dialog.getByRole("combobox"), "  SNORKEL MASK");
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toEqual([expect.objectContaining({ method: "POST", body: { tripDayId: DAY.id, itemId: "2" } })]);
  });

  it("says an item is already on the day and offers no create for it", async () => {
    const api = installApi([item({ id: "1", name: "Swimwear", days: [DAY] })]);
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    const dialog = await openPicker(user);
    await user.type(dialog.getByRole("combobox"), "swimwear");
    expect(dialog.getByText("Already on this day.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(api.writes()).toEqual([]);
  });

  it("removes an item from the day without confirmation", async () => {
    const api = installApi([item({ id: "1", name: "Swimwear", days: [DAY, OTHER_DAY] }), item({ id: "2", name: "Towel", days: [DAY] })]);
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    await user.click(await screen.findByRole("button", { name: "Remove Swimwear from this day" }));

    await waitFor(() => expect(rowNames()).toEqual(["Towel"]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", body: { tripDayId: DAY.id, itemId: "1" } })]);
  });

  it("restores the row with an error when the remove fails", async () => {
    installApi([item({ id: "1", name: "Swimwear", days: [DAY] })], (call) =>
      call.method === "DELETE" ? mockFetchResponse({ data: null, error: { code: "server_error", message: "x" } }, { status: 500 }) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    await user.click(await screen.findByRole("button", { name: "Remove Swimwear from this day" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Swimwear"]);
  });

  it("drops the row when the item was deleted from the trip list meanwhile (404)", async () => {
    installApi([item({ id: "1", name: "Swimwear", days: [DAY] })], (call) =>
      call.method === "DELETE"
        ? mockFetchResponse({ data: null, error: { code: "not_found", message: "Packing item not found" } }, { status: 404 })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    await user.click(await screen.findByRole("button", { name: "Remove Swimwear from this day" }));

    await waitFor(() => expect(screen.queryByTestId("day-packing-row")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the row removed without an error when the day is gone meanwhile (404 day)", async () => {
    installApi([item({ id: "1", name: "Swimwear", days: [DAY] }), item({ id: "2", name: "Towel", days: [DAY] })], (call) =>
      call.method === "DELETE"
        ? mockFetchResponse({ data: null, error: { code: "not_found", message: "Trip day not found" } }, { status: 404 })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);

    await user.click(await screen.findByRole("button", { name: "Remove Swimwear from this day" }));

    await waitFor(() => expect(rowNames()).toEqual(["Towel"]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the picker when the day changes", async () => {
    installApi([item({ id: "1", name: "Swimwear", days: [DAY] })]);
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);
    await openPicker(user);

    rerender(
      <Providers>
        <TripDayPackingSection tripId="trip-1" dayId={OTHER_DAY.id} canEdit />
      </Providers>,
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("re-fetches when the day changes", async () => {
    const api = installApi([item({ id: "1", name: "Swimwear", days: [DAY] }), item({ id: "2", name: "Tent", days: [OTHER_DAY] })]);
    const { rerender } = renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit={false} />);
    expect(await screen.findByText("Swimwear")).toBeInTheDocument();

    rerender(
      <Providers>
        <TripDayPackingSection tripId="trip-1" dayId={OTHER_DAY.id} canEdit={false} />
      </Providers>,
    );

    expect(await screen.findByText("Tent")).toBeInTheDocument();
    expect(screen.queryByText("Swimwear")).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.method === "GET")).toHaveLength(2);
  });

  it("shows a planner a load error inside the card", async () => {
    stubFetch(vi.fn(async () => mockFetchResponse({ data: null, error: { code: "server_error", message: "x" } }, { status: 500 })));
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />);
    expect(await screen.findByText("Could not load the take-along list.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Take along" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to take along" })).not.toBeInTheDocument();
  });

  it("speaks German", async () => {
    installApi([item({ id: "1", name: "Badehose", packed: true, days: [DAY] })]);
    renderWithProviders(<TripDayPackingSection tripId="trip-1" dayId={DAY.id} canEdit />, { language: "de" });

    expect(await screen.findByRole("heading", { name: "Mitnehmen" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Badehose vom Tag entfernen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mitnehmen hinzufügen" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Eingepackt" })).toBeInTheDocument();
  });
});
