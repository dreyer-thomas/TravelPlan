// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripDayView from "@/components/features/trips/TripDayView";
import en from "@/i18n/en";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 9.3 AC1, AC2, AC12, AC14, AC15 - the day ⋯ menu's *Send by email*. The harness follows
 * `tripDayViewSuggestionsEntry.test.tsx`. Layout (the 44px row) is the browser pass's job, as for 9.2.
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

const tripDetail = (accessRole: AccessRole) => ({
  trip: {
    id: "trip-1",
    name: "Trip",
    accessRole,
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-01T00:00:00.000Z",
    dayCount: 1,
    plannedCostTotal: 0,
    accommodationCostTotalCents: null,
    heroImageUrl: null,
  },
  days: [
    {
      id: "day-1",
      date: "2026-12-01T00:00:00.000Z",
      dayIndex: 1,
      plannedCostSubtotal: 0,
      missingAccommodation: true,
      missingPlan: true,
      accommodation: null,
      dayPlanItems: [],
      travelSegments: [],
    },
  ],
});

const stubDay = (accessRole: AccessRole, emailResponse: () => Promise<Response> | Response) => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = requestUrl(input);
    if (url.endsWith("/days/day-1/email")) return emailResponse();
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

const emailCalls = (fetchMock: ReturnType<typeof stubDay>) =>
  fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith("/email"));

const sent = (attachment: "attached" | "tooLarge" | "none") => () =>
  mockFetchResponse({ data: { sentTo: "me@example.com", attachment }, error: null });

const openMenu = async () => {
  renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />);
  await screen.findByRole("heading", { name: "Day 1", level: 5 });
  await userEvent.click(screen.getByTestId("day-hero-overflow"));
  return screen.findByTestId("day-menu-email");
};

describe("TripDayView: Send by email (Story 9.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each<AccessRole>(["owner", "contributor", "viewer"])(
    "offers the item to a(n) %s, directly after the packet",
    async (role) => {
      stubDay(role, sent("none"));
      const item = await openMenu();

      expect(item).toHaveTextContent(en["trips.dayEmail.action"]);
      const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
      const packetIndex = items.findIndex((candidate) => candidate.dataset.testid === "day-menu-packet");
      expect(items[packetIndex + 1]).toBe(item);
      // The divider stays a planning-group separator: present for writers, absent for a viewer.
      if (role === "viewer") {
        expect(screen.queryByTestId("day-hero-overflow-divider")).not.toBeInTheDocument();
      } else {
        expect(screen.getByTestId("day-hero-overflow-divider")).toBeInTheDocument();
      }
    },
  );

  it("posts once with the CSRF header and no body, and shows the pending state meanwhile", async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubDay("viewer", () => new Promise<Response>((resolve) => (release = resolve)));
    const item = await openMenu();

    await userEvent.click(item);
    await waitFor(() => expect(item).toHaveAttribute("aria-busy", "true"));
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent(en["trips.dayEmail.pending"]);

    // A second activation while pending must not send a second mail.
    item.click();
    expect(emailCalls(fetchMock)).toHaveLength(1);
    const [, init] = emailCalls(fetchMock)[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");

    release(sent("attached")());
    expect(await screen.findByTestId("day-email-notice")).toHaveTextContent(
      "The day plan was sent to me@example.com.",
    );
    await waitFor(() => expect(screen.queryByTestId("day-menu-email")).not.toBeInTheDocument());
    expect(emailCalls(fetchMock)).toHaveLength(1);
  });

  it("names the address in a success notice", async () => {
    stubDay("owner", sent("none"));
    await userEvent.click(await openMenu());

    const notice = await screen.findByTestId("day-email-notice");
    expect(notice).toHaveTextContent("The day plan was sent to me@example.com.");
    expect(notice.className).toMatch(/Success/);
  });

  it("warns when the documents were too large for the mail", async () => {
    stubDay("owner", sent("tooLarge"));
    await userEvent.click(await openMenu());

    const notice = await screen.findByTestId("day-email-notice");
    expect(notice).toHaveTextContent(
      en["trips.dayEmail.sentWithoutDocuments"].replace("{address}", "me@example.com"),
    );
    expect(notice.className).toMatch(/Warning/);
  });

  it("says the mail could not be sent on email_failed, and shows no notice", async () => {
    stubDay("owner", () =>
      mockFetchResponse(
        { data: null, error: { code: "email_failed", message: "The email could not be sent" } },
        { status: 502 },
      ),
    );
    await userEvent.click(await openMenu());

    expect(await screen.findByText(en["trips.dayEmail.failed"])).toBeInTheDocument();
    expect(screen.queryByTestId("day-email-notice")).not.toBeInTheDocument();
  });

  it("maps a lost session to the unauthorized message", async () => {
    stubDay("owner", () =>
      mockFetchResponse({ data: null, error: { code: "unauthorized", message: "x" } }, { status: 401 }),
    );
    await userEvent.click(await openMenu());

    expect(await screen.findByText(en["errors.unauthorized"])).toBeInTheDocument();
  });
});
