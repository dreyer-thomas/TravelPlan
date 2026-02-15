// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import { I18nProvider } from "@/i18n/provider";
import type { ReactNode } from "react";

const planDialogMockState = vi.hoisted(() => ({
  lastProps: null as null | { open: boolean; mode: "add" | "edit"; item: { id: string; linkUrl: string | null } | null },
}));
const navigationMockState = vi.hoisted(() => ({
  search: "",
}));

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({
  default: () => <div data-testid="stay-dialog" />,
}));

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: (props: {
    open: boolean;
    mode: "add" | "edit";
    item: { id: string; linkUrl: string | null } | null;
  }) => {
    planDialogMockState.lastProps = props;
    return (
      <div data-testid="plan-dialog">
        <span data-testid="plan-dialog-mode">{props.mode}</span>
        <span data-testid="plan-dialog-item-id">{props.item?.id ?? "none"}</span>
        <span data-testid="plan-dialog-item-link">{props.item?.linkUrl ?? "none"}</span>
      </div>
    );
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationMockState.search),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    ({ points }: { points: { position: [number, number] }[] }) => (
      <div data-testid="day-map-container">
        {points.map((point, index) => (
          <div key={index} data-testid="day-map-marker" data-position={point.position.join(",")} />
        ))}
        {points.length >= 2 ? <div data-testid="day-map-polyline" /> : null}
      </div>
    ),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="day-map-container">{children}</div>,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: ({ children }: { children?: ReactNode }) => <div data-testid="day-map-marker">{children}</div>,
  Polyline: () => <div data-testid="day-map-polyline" />,
  useMap: () => ({ fitBounds: vi.fn(), invalidateSize: vi.fn(), getContainer: vi.fn(() => document.createElement("div")) }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
    divIcon: (options: unknown) => options,
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
  divIcon: (options: unknown) => options,
}));

describe("TripDayView layout", () => {
  it("renders the day view page layout for a selected day", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-02T00:00:00.000Z",
              dayCount: 2,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 12000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: {
                  id: "stay-prev",
                  name: "Airport Hotel",
                  notes: null,
                  status: "booked",
                  costCents: 12000,
                  link: null,
                  location: { lat: 48.3538, lng: 11.7861 },
                },
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 16000,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: {
                  id: "stay-current",
                  name: "City Hotel",
                  notes: null,
                  status: "planned",
                  costCents: 16000,
                  link: null,
                  location: { lat: 48.145, lng: 11.582 },
                },
                dayPlanItems: [
                  {
                    id: "plan-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
                    }),
                    linkUrl: "https://example.com/museum",
                    location: { lat: 48.1372, lng: 11.5756 },
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayView tripId="trip-1" dayId="day-1" />
      </I18nProvider>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(await screen.findByTestId("trip-day-view-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Day 1", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("Dec 1, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to trip" })).toBeInTheDocument();
    expect(screen.getByText("Previous night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("Airport Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("Day activities")).toBeInTheDocument();
    expect(screen.getAllByText("Museum visit").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://example.com/museum");
    expect(screen.getByText("Current night accommodation")).toBeInTheDocument();
    expect(screen.getAllByText("City Hotel").length).toBeGreaterThan(0);
    expect(screen.getByText("Day total")).toBeInTheDocument();
    expect(screen.getAllByText("Cost: 160.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Edit stay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add plan item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit plan item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete plan item" })).toBeInTheDocument();
    expect(screen.getByTestId("plan-dialog-mode")).toHaveTextContent("add");
    expect(screen.getByTestId("plan-dialog-item-id")).toHaveTextContent("none");
    expect(screen.getAllByTestId("day-map-marker")).toHaveLength(3);
    expect(screen.getByTestId("day-map-polyline")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit plan item" }));

    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));
    expect(screen.getByTestId("plan-dialog-mode")).toHaveTextContent("edit");
    expect(screen.getByTestId("plan-dialog-item-id")).toHaveTextContent("plan-1");
    expect(screen.getByTestId("plan-dialog-item-link")).toHaveTextContent("https://example.com/museum");

    vi.unstubAllGlobals();
  });

  it("deletes a day plan item from row icon action and updates the visible list", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";
    const items = [
      {
        id: "plan-1",
        tripDayId: "day-1",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
        }),
        linkUrl: null,
        location: null,
        createdAt: "2026-12-01T09:00:00.000Z",
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.includes("/day-plan-items") && method === "DELETE") {
        items.splice(0, items.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { deleted: true }, error: null }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-02T00:00:00.000Z",
              dayCount: 2,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: items.map((item) => ({
                  id: item.id,
                  contentJson: item.contentJson,
                  linkUrl: item.linkUrl,
                  location: item.location,
                })),
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(
      <I18nProvider initialLanguage="en">
        <TripDayView tripId="trip-1" dayId="day-1" />
      </I18nProvider>,
    );

    expect((await screen.findAllByText("Museum visit")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete plan item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );

    await waitFor(() => expect(screen.queryAllByText("Museum visit")).toHaveLength(0));
    expect(await screen.findByText("No day details yet. Add a stay or day plan item to begin.")).toBeInTheDocument();
    expect(screen.getByText("Cost: 0.00")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("opens the plan edit dialog from query params", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "open=plan&itemId=plan-1";
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-02T00:00:00.000Z",
              dayCount: 2,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                plannedCostSubtotal: 12000,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                plannedCostSubtotal: 16000,
                missingAccommodation: false,
                missingPlan: false,
                accommodation: null,
                dayPlanItems: [
                  {
                    id: "plan-1",
                    contentJson: JSON.stringify({
                      type: "doc",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Museum visit" }] }],
                    }),
                    linkUrl: "https://example.com/museum",
                    location: null,
                  },
                ],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayView tripId="trip-1" dayId="day-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(planDialogMockState.lastProps?.open).toBe(true));

    expect(planDialogMockState.lastProps?.mode).toBe("edit");
    expect(planDialogMockState.lastProps?.item?.id).toBe("plan-1");
    vi.unstubAllGlobals();
  });

  it("renders persisted day image and supports replace/remove actions", async () => {
    planDialogMockState.lastProps = null;
    navigationMockState.search = "";

    const state = {
      imageUrl: "https://example.com/day-initial.webp" as string | null,
      note: "Flight from FRA to SIN" as string | null,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.includes("/days/day-1/image") && method === "POST") {
        const formData = init?.body as FormData;
        const noteValue = formData?.get("note");
        state.note = typeof noteValue === "string" && noteValue.trim().length > 0 ? noteValue : null;
        state.imageUrl = "/uploads/trips/trip-1/days/day-1/day.webp";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              day: { id: "day-1", imageUrl: state.imageUrl, note: state.note, updatedAt: "2026-12-01T00:00:00.000Z" },
            },
            error: null,
          }),
        };
      }

      if (url.includes("/days/day-1/image") && method === "PATCH") {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { imageUrl: string | null; note: string | null };
        state.imageUrl = parsed.imageUrl;
        state.note = parsed.note;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              day: { id: "day-1", imageUrl: state.imageUrl, note: state.note, updatedAt: "2026-12-01T00:00:00.000Z" },
            },
            error: null,
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: {
              id: "trip-1",
              name: "Trip",
              startDate: "2026-12-01T00:00:00.000Z",
              endDate: "2026-12-02T00:00:00.000Z",
              dayCount: 2,
              accommodationCostTotalCents: null,
              heroImageUrl: null,
            },
            days: [
              {
                id: "day-0",
                date: "2026-11-30T00:00:00.000Z",
                dayIndex: 0,
                imageUrl: null,
                note: null,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
              {
                id: "day-1",
                date: "2026-12-01T00:00:00.000Z",
                dayIndex: 1,
                imageUrl: state.imageUrl,
                note: state.note,
                plannedCostSubtotal: 0,
                missingAccommodation: false,
                missingPlan: true,
                accommodation: null,
                dayPlanItems: [],
              },
            ],
          },
          error: null,
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayView tripId="trip-1" dayId="day-1" />
      </I18nProvider>,
    );

    const initialImage = await screen.findByRole("img", { name: "Day image" });
    expect(initialImage).toHaveAttribute("src", "https://example.com/day-initial.webp");
    expect(screen.getByRole("heading", { name: "Day 1: Flight from FRA to SIN", level: 5 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit day details" }));

    const fileInput = await screen.findByLabelText("Day image");
    const file = new File([new Uint8Array([1, 2, 3])], "day.webp", { type: "image/webp" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Day note"), { target: { value: "Flight from MUC to SIN" } });
    fireEvent.click(screen.getByRole("button", { name: "Save day details" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/days/day-1/image"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Day image" })).toHaveAttribute(
        "src",
        "/uploads/trips/trip-1/days/day-1/day.webp",
      ),
    );
    expect(screen.getByRole("heading", { name: "Day 1: Flight from MUC to SIN", level: 5 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit day details" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    await waitFor(() => expect(screen.queryByRole("img", { name: "Day image" })).not.toBeInTheDocument());
    expect(screen.getByText("No day image selected yet.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
