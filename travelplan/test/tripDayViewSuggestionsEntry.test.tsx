// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 12.3 AC1 and AC8. *Ideen finden* in the day view's timeline header: shown to an owner or a
 * contributor when the AI search is configured, absent for a viewer and when it is not, and it opens
 * the real suggestion dialog with the day's stays as start and end. The harness follows
 * `tripDayViewDayChange.test.tsx`.
 */

// The three authoring dialogs carry the rich-text editor, which does not run in jsdom. None of them is
// under test here; the suggestion dialog is real.
vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({ default: () => null }));
vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({ default: () => null }));
vi.mock("@/components/features/trips/TripDayTravelSegmentDialog", () => ({ default: () => null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="day-map-container" />,
}));

vi.mock("react-leaflet", () => ({
  MapContainer: () => <div data-testid="day-map-container" />,
  TileLayer: () => <div data-testid="day-map-tile" />,
  Marker: () => <div data-testid="day-map-marker" />,
  Polyline: () => <div data-testid="day-map-polyline" />,
  useMap: () => ({
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
    getContainer: vi.fn(() => document.createElement("div")),
  }),
}));

vi.mock("leaflet", () => ({
  default: {
    latLngBounds: (points: [number, number][]) => ({ points }),
    divIcon: (options: unknown) => options,
  },
  latLngBounds: (points: [number, number][]) => ({ points }),
  divIcon: (options: unknown) => options,
}));

type AccessRole = "owner" | "contributor" | "viewer";

const stay = (id: string, name: string, label: string | null) => ({
  id,
  name,
  notes: null,
  status: "booked" as const,
  costCents: null,
  link: null,
  checkInTime: null,
  checkOutTime: null,
  location: label ? { lat: 41.1, lng: -8.6, label } : null,
});

const dayFixture = (id: string, index: number, accommodation: ReturnType<typeof stay> | null) => ({
  id,
  date: `2026-12-0${index + 1}T00:00:00.000Z`,
  dayIndex: index + 1,
  plannedCostSubtotal: 0,
  missingAccommodation: accommodation === null,
  missingPlan: true,
  accommodation,
  dayPlanItems: [],
  travelSegments: [],
});

const tripDetail = (accessRole: AccessRole) => ({
  trip: {
    id: "trip-1",
    name: "Trip",
    accessRole,
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-02T00:00:00.000Z",
    dayCount: 2,
    plannedCostTotal: 0,
    accommodationCostTotalCents: null,
    heroImageUrl: null,
  },
  days: [dayFixture("day-1", 0, stay("stay-1", "Hotel Ribeira", "Ribeira, Porto")), dayFixture("day-2", 1, null)],
});

const stubDay = (accessRole: AccessRole) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("/bucket-list-items")) return mockFetchResponse({ data: { items: [] }, error: null });
    if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf-token" }, error: null });
    if (url.includes("/images")) return mockFetchResponse({ data: { images: [] }, error: null });
    if (url.includes("/documents")) return mockFetchResponse({ data: { documents: [] }, error: null });
    if (url.includes("/route")) {
      return mockFetchResponse({
        data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } },
        error: null,
      });
    }
    return mockFetchResponse({ data: tripDetail(accessRole), error: null });
  });
  stubFetch(fetchMock);
  return fetchMock;
};

const renderDay = async (aiSuggestionsEnabled?: boolean) => {
  const view = renderWithProviders(
    <TripDayView tripId="trip-1" dayId="day-2" {...(aiSuggestionsEnabled === undefined ? {} : { aiSuggestionsEnabled })} />,
  );
  await screen.findByRole("heading", { name: "Day 2", level: 5 });
  return view;
};

const findIdeasButton = () =>
  within(screen.getByTestId("day-timeline-section-header")).queryByRole("button", {
    name: en["trips.suggestions.openAction"],
  });

describe("TripDayView: Find ideas entry (Story 12.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each<AccessRole>(["owner", "contributor"])("shows the button beside add-activity for a(n) %s", async (role) => {
    stubDay(role);
    await renderDay(true);

    const header = screen.getByTestId("day-timeline-section-header");
    const buttons = within(header).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      en["trips.plan.addPrimaryAction"],
      en["trips.suggestions.openAction"],
    ]);
  });

  it("shows no action at all to a viewer, even with the search configured", async () => {
    stubDay("viewer");
    await renderDay(true);
    expect(within(screen.getByTestId("day-timeline-section-header")).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows no button when the search is not configured", async () => {
    stubDay("owner");
    await renderDay(false);
    expect(findIdeasButton()).toBeNull();
    expect(
      within(screen.getByTestId("day-timeline-section-header")).getByRole("button", {
        name: en["trips.plan.addPrimaryAction"],
      }),
    ).toBeInTheDocument();
  });

  it("shows no button when the prop is absent", async () => {
    stubDay("owner");
    await renderDay();
    expect(findIdeasButton()).toBeNull();
  });

  it("opens the suggestion dialog with the previous night's stay as start and no stay as end", async () => {
    const user = userEvent.setup();
    stubDay("owner");
    await renderDay(true);

    expect(screen.queryByRole("dialog", { name: en["trips.suggestions.dialogTitle"] })).toBeNull();
    await user.click(findIdeasButton()!);

    const dialog = await screen.findByRole("dialog", { name: en["trips.suggestions.dialogTitle"] });
    expect(within(dialog).getByText("Day 2 plan")).toBeInTheDocument();
    const route = within(dialog).getByTestId("suggestions-route");
    expect(route).toHaveTextContent("Hotel Ribeira · Ribeira, Porto");
    expect(route).toHaveTextContent(en["trips.suggestions.endNone"]);
    // Story 12.4 has not wired the apply yet, so the footer only counts.
    expect(within(dialog).getByText(en["trips.suggestions.selectedNone"])).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Add \(/ })).toBeNull();
  });

  it("starts each open fresh", async () => {
    const user = userEvent.setup();
    stubDay("owner");
    await renderDay(true);

    await user.click(findIdeasButton()!);
    const field = await screen.findByLabelText(en["trips.suggestions.promptLabel"]);
    await user.type(field, "Tiles");
    await user.click(screen.getByRole("button", { name: en["common.close"] }));

    await user.click(await screen.findByRole("button", { name: en["trips.suggestions.openAction"] }));
    expect(await screen.findByLabelText(en["trips.suggestions.promptLabel"])).toHaveValue("");
  });
});
