// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import { I18nProvider } from "@/i18n/provider";

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

    render(
      <I18nProvider initialLanguage="en">
        <TripBucketListPanel tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("2 entries")).toBeVisible();
    expect(screen.getByRole("button", { name: "Expand bucket list" })).toBeInTheDocument();

    expect(screen.queryByText("Hike spot")).not.toBeInTheDocument();
  });

  it("expands to reveal list content when toggled", async () => {
    const fetchMock = mockBucketListFetch([buildItem()]);
    const user = userEvent.setup();

    render(
      <I18nProvider initialLanguage="en">
        <TripBucketListPanel tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Expand bucket list" }));

    expect(screen.getByText("Hike spot")).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse bucket list" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the add dialog from the collapsed add icon", async () => {
    const fetchMock = mockBucketListFetch([]);
    const user = userEvent.setup();

    render(
      <I18nProvider initialLanguage="en">
        <TripBucketListPanel tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByText("Add bucket list item")).toBeInTheDocument();
  });
});
