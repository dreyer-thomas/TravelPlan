// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiChangesNotice from "@/components/features/trips/AiChangesNotice";
import TripDayView from "@/components/features/trips/TripDayView";
import de from "@/i18n/de";
import en from "@/i18n/en";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 15.4. The day view's half of the connector's provenance: the KI/AI badge on marked activity and
 * stay cards, and the "AI changed this day" notice with its per-change undo. Harness after
 * `tripDayViewDayChange.test.tsx`; the dialogs are stubbed out, they have their own suites.
 */

vi.mock("@/components/features/trips/TripAccommodationDialog", () => ({ default: () => null }));
vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: function TripDayPlanDialogStub(props: { open: boolean; onDelete?: (itemId: string) => Promise<boolean> }) {
    if (!props.open) return null;
    return (
      <button type="button" onClick={() => void props.onDelete?.("item-2")}>
        stub-delete
      </button>
    );
  },
}));
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

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const planItem = (id: string, title: string, sortOrder: number, aiChangedAt: string | null) => ({
  id,
  title,
  fromTime: null,
  toTime: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  scheduleMode: "FLEXIBLE",
  durationMinutes: 60,
  sortOrder,
  contentJson: doc(title),
  costCents: null,
  payments: [],
  linkUrl: null,
  location: null,
  aiChangedAt,
});

const tripDetail = (accessRole: "owner" | "contributor" | "viewer", travelSegments: unknown[] = []) => ({
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
      missingAccommodation: false,
      missingPlan: false,
      accommodation: {
        id: "stay-1",
        name: "Harbour Inn",
        notes: null,
        status: "planned",
        costCents: null,
        link: null,
        checkInTime: null,
        checkOutTime: null,
        location: null,
        aiChangedAt: "2026-10-29T08:00:00.000Z",
      },
      dayPlanItems: [planItem("item-1", "Louvre", 0, "2026-10-29T08:00:00.000Z"), planItem("item-2", "Orsay", 1, null)],
      travelSegments,
    },
  ],
});

type Change = { id: string; action: string; subject: string | null; createdAt: string; undoable: boolean };

const changes: Change[] = [
  { id: "c1", action: "created", subject: "Louvre", createdAt: "2026-10-20T08:00:00.000Z", undoable: true },
  { id: "c3", action: "parked", subject: "Orsay", createdAt: "2026-10-20T10:00:00.000Z", undoable: true },
  // A parked-row edit: no receipt, so listed without undo.
  { id: "c2", action: "updated", subject: null, createdAt: "2026-10-20T09:00:00.000Z", undoable: false },
];

const stubDay = (
  options: {
    accessRole?: "owner" | "contributor" | "viewer";
    list?: () => Change[];
    undo?: () => { status: number; body: unknown };
    /** Story 15.6. The day's legs. */
    travelSegments?: unknown[];
  } = {},
) => {
  const calls = { list: 0, detail: 0, bucket: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";

    if (url.includes("/day-plan-items") && method === "DELETE") {
      return mockFetchResponse({ data: { deleted: true, removedTravelSegmentIds: [], receipt: null }, error: null });
    }
    if (url.includes("/ai-changes/") && method === "POST") {
      const outcome = options.undo?.() ?? { status: 200, body: { data: { undone: true }, error: null } };
      return mockFetchResponse(outcome.body, { status: outcome.status });
    }
    if (url.includes("/ai-changes")) {
      calls.list += 1;
      return mockFetchResponse({ data: { changes: options.list?.() ?? changes }, error: null });
    }
    if (url.includes("/bucket-list-items")) {
      calls.bucket += 1;
      return mockFetchResponse({ data: { items: [] }, error: null });
    }
    if (url.includes("/api/auth/csrf")) return mockFetchResponse({ data: { csrfToken: "csrf-token" }, error: null });
    if (url.includes("/images")) return mockFetchResponse({ data: { images: [] }, error: null });
    if (url.includes("/documents")) return mockFetchResponse({ data: { documents: [] }, error: null });
    if (url.includes("/route")) {
      return mockFetchResponse({
        data: { points: [], route: { polyline: [], distanceMeters: null, durationSeconds: null } },
        error: null,
      });
    }
    calls.detail += 1;
    return mockFetchResponse({ data: tripDetail(options.accessRole ?? "owner", options.travelSegments), error: null });
  });
  stubFetch(fetchMock);
  return { fetchMock, calls };
};

const renderDay = async (language: "en" | "de" = "en") => {
  const view = renderWithProviders(<TripDayView tripId="trip-1" dayId="day-1" />, { language });
  await screen.findByRole("heading", { name: language === "de" ? "Tag 1" : "Day 1", level: 5 });
  return view;
};

const expandNotice = async () => {
  const notice = await screen.findByTestId("ai-changes-notice");
  await userEvent.click(within(notice).getByRole("button", { name: en["trips.aiChanges.expand"] }));
  return notice;
};

describe("TripDayView AI provenance (Story 15.4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("badges the AI-changed activity card and stay card, and not the unmarked activity", async () => {
    stubDay();
    await renderDay();

    const cards = await screen.findAllByTestId("day-plan-item-card");
    const louvre = cards.find((card) => within(card).queryAllByText("Louvre").length > 0)!;
    const orsay = cards.find((card) => within(card).queryAllByText("Orsay").length > 0)!;
    expect(within(louvre).getByTestId("ai-badge")).toHaveTextContent("AI");
    expect(within(orsay).queryByTestId("ai-badge")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("timeline-current-stay")).getByTestId("ai-badge")).toBeInTheDocument();
  });

  it("collapses to one count line and expands to the changes newest first, without undo for a no-receipt row", async () => {
    stubDay();
    await renderDay();

    const notice = await screen.findByTestId("ai-changes-notice");
    expect(notice).toHaveTextContent(`${en["trips.aiChanges.title"]} · 3 changes`);
    expect(within(notice).queryAllByTestId("ai-change-row")).toHaveLength(0);

    await expandNotice();
    const rows = within(notice).getAllByTestId("ai-change-row");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
      "\u201cOrsay\u201d parked",
      `\u201c${en["trips.plan.untitledActivity"]}\u201d changed`,
      "\u201cLouvre\u201d added",
    ]);
    expect(within(rows[0]).getByRole("button", { name: en["trips.aiChanges.undo"] })).toBeEnabled();
    expect(within(rows[1]).queryByRole("button", { name: en["trips.aiChanges.undo"] })).not.toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: en["trips.aiChanges.undo"] })).toBeInTheDocument();
  });

  it("speaks German, with the singular count for one change", async () => {
    stubDay({ list: () => [changes[0]] });
    await renderDay("de");

    const notice = await screen.findByTestId("ai-changes-notice");
    expect(notice).toHaveTextContent(`${de["trips.aiChanges.title"]} · 1 Änderung`);
    await userEvent.click(within(notice).getByRole("button", { name: de["trips.aiChanges.expand"] }));
    expect(within(notice).getByTestId("ai-change-row")).toHaveTextContent("\u201eLouvre\u201c hinzugefügt");
  });

  it("undoes a change with the CSRF token, then reads the list, the day and the bucket list again", async () => {
    let listed = changes;
    const { fetchMock, calls } = stubDay({ list: () => listed });
    await renderDay();
    const notice = await expandNotice();
    await waitFor(() => expect(calls.list).toBeGreaterThan(0));
    const before = { ...calls };

    listed = changes.filter((change) => change.id !== "c3");
    const [orsayRow] = within(notice).getAllByTestId("ai-change-row");
    await userEvent.click(within(orsayRow).getByRole("button", { name: en["trips.aiChanges.undo"] }));

    await waitFor(() => expect(screen.getByTestId("ai-changes-notice")).toHaveTextContent("2 changes"));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(requestUrl(post![0])).toBe("/api/trips/trip-1/ai-changes/c3/undo");
    expect(new Headers(post![1]?.headers).get("x-csrf-token")).toBe("csrf-token");
    await waitFor(() => {
      expect(calls.list).toBeGreaterThan(before.list);
      expect(calls.detail).toBeGreaterThan(before.detail);
      expect(calls.bucket).toBeGreaterThan(before.bucket);
    });
  });

  it("shows the stale text on a refused row and withdraws its undo", async () => {
    stubDay({
      undo: () => ({
        status: 409,
        body: { data: null, error: { code: "undo_stale", message: "stale" } },
      }),
    });
    await renderDay();
    const notice = await expandNotice();

    const [orsayRow] = within(notice).getAllByTestId("ai-change-row");
    await userEvent.click(within(orsayRow).getByRole("button", { name: en["trips.aiChanges.undo"] }));

    expect(await within(orsayRow).findByText(en["trips.aiChanges.stale"])).toBeInTheDocument();
    expect(within(orsayRow).queryByRole("button", { name: en["trips.aiChanges.undo"] })).not.toBeInTheDocument();
    // The other rows keep theirs.
    const rows = within(notice).getAllByTestId("ai-change-row");
    expect(within(rows[2]).getByRole("button", { name: en["trips.aiChanges.undo"] })).toBeEnabled();
  });

  it("reads the list again after a delete that needs no day reload", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fetchMock, calls } = stubDay();
    await renderDay();
    await screen.findByTestId("ai-changes-notice");
    const before = { ...calls };

    await userEvent.click(screen.getByRole("button", { name: en["trips.plan.addPrimaryAction"] }));
    await userEvent.click(await screen.findByRole("button", { name: "stub-delete" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(calls.list).toBeGreaterThan(before.list));
    expect(calls.detail).toBe(before.detail);
  });

  it("shows nothing when the day has no AI change left", async () => {
    const { calls } = stubDay({ list: () => [] });
    await renderDay();

    await waitFor(() => expect(calls.list).toBeGreaterThan(0));
    expect(screen.queryByTestId("ai-changes-notice")).not.toBeInTheDocument();
  });

  it("never shows the notice to a viewer, nor asks for the list", async () => {
    const { calls } = stubDay({ accessRole: "viewer" });
    await renderDay();

    await screen.findAllByTestId("day-plan-item-card");
    expect(screen.queryByTestId("ai-changes-notice")).not.toBeInTheDocument();
    expect(calls.list).toBe(0);
  });
});

describe("AiChangesNotice (Story 15.4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("announces only the summary line, and starts collapsed without row messages on another day", async () => {
    stubFetch(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (init?.method === "POST") {
          return mockFetchResponse({ data: null, error: { code: "undo_stale", message: "stale" } }, { status: 409 });
        }
        if (url.includes("/ai-changes")) return mockFetchResponse({ data: { changes }, error: null });
        return mockFetchResponse({ data: null, error: null });
      }),
    );
    const props = {
      tripId: "trip-1",
      refreshKey: 0,
      ensureCsrfToken: async () => "csrf-token",
      onDayChanged: () => undefined,
      onBucketChanged: () => undefined,
    };
    const view = renderWithProviders(<AiChangesNotice {...props} dayId="day-1" />);

    const notice = await expandNotice();
    const status = within(notice).getByRole("status");
    expect(status).toHaveTextContent(`${en["trips.aiChanges.title"]} · 3 changes`);
    expect(within(status).queryByRole("button")).not.toBeInTheDocument();
    expect(within(status).queryByRole("list")).not.toBeInTheDocument();

    const [orsayRow] = within(notice).getAllByTestId("ai-change-row");
    await userEvent.click(within(orsayRow).getByRole("button", { name: en["trips.aiChanges.undo"] }));
    expect(await within(orsayRow).findByText(en["trips.aiChanges.stale"])).toBeInTheDocument();

    view.rerender(
      <Providers>
        <AiChangesNotice {...props} dayId="day-2" />
      </Providers>,
    );
    const next = await screen.findByTestId("ai-changes-notice");
    expect(within(next).getByRole("button", { name: en["trips.aiChanges.expand"] })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(within(next).getByRole("button", { name: en["trips.aiChanges.expand"] }));
    expect(within(next).queryByText(en["trips.aiChanges.stale"])).not.toBeInTheDocument();
  });
});

describe("AiChangesNotice, day plans (Story 15.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const planChanges: Change[] = [
    { id: "p2", action: "planReplaced", subject: "Old Town walk, Concert", createdAt: "2026-10-20T11:00:00.000Z", undoable: true },
    { id: "p1", action: "planAppended", subject: "Castle, Lunch", createdAt: "2026-10-20T10:00:00.000Z", undoable: true },
  ];

  it.each([
    ["en", en, "Day plan replaced: Old Town walk, Concert", "Day plan added: Castle, Lunch"],
    ["de", de, "Tagesplan ersetzt: Old Town walk, Concert", "Tagesplan ergänzt: Castle, Lunch"],
  ] as const)("labels a replaced and an appended day plan in %s", async (language, dictionary, replaced, appended) => {
    stubFetch(
      vi.fn(async (input: RequestInfo | URL) => {
        if (requestUrl(input).includes("/ai-changes")) return mockFetchResponse({ data: { changes: planChanges }, error: null });
        return mockFetchResponse({ data: null, error: null });
      }),
    );
    renderWithProviders(
      <AiChangesNotice
        tripId="trip-1"
        dayId="day-1"
        refreshKey={0}
        ensureCsrfToken={async () => "csrf-token"}
        onDayChanged={() => undefined}
        onBucketChanged={() => undefined}
      />,
      { language },
    );
    const notice = await screen.findByTestId("ai-changes-notice");
    await userEvent.click(within(notice).getByRole("button", { name: dictionary["trips.aiChanges.expand"] }));
    const rows = within(notice).getAllByTestId("ai-change-row");
    expect(rows[0]).toHaveTextContent(replaced);
    expect(rows[1]).toHaveTextContent(appended);
  });
});

describe("AI provenance on legs and the stay and leg notices (Story 15.6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const legRow = (id: string, fromItemId: string, toItemType: "accommodation" | "dayPlanItem", toItemId: string, aiChangedAt: string | null) => ({
    id,
    fromItemType: "dayPlanItem",
    fromItemId,
    toItemType,
    toItemId,
    transportType: "walking",
    durationMinutes: 15,
    distanceKm: 1.2,
    linkUrl: null,
    aiChangedAt,
  });

  it("badges the leg the connector wrote, and not the one a person wrote", async () => {
    stubDay({
      list: () => [],
      travelSegments: [
        legRow("seg-1", "item-1", "dayPlanItem", "item-2", "2026-10-29T08:00:00.000Z"),
        legRow("seg-2", "item-2", "accommodation", "stay-1", null),
      ],
    });
    await renderDay();

    const segments = await screen.findAllByTestId("travel-segment");
    const marked = segments.find((segment) => segment.getAttribute("data-from-id") === "item-1")!;
    const plain = segments.find((segment) => segment.getAttribute("data-from-id") === "item-2")!;
    expect(within(marked).getByTestId("ai-badge")).toHaveTextContent("AI");
    expect(within(plain).queryByTestId("ai-badge")).not.toBeInTheDocument();
  });

  const stayAndLegChanges: Change[] = [
    { id: "l3", action: "legDeleted", subject: "Museum → Dinner", createdAt: "2026-10-20T15:00:00.000Z", undoable: true },
    { id: "l2", action: "legUpdated", subject: "Museum → Dinner", createdAt: "2026-10-20T14:00:00.000Z", undoable: true },
    { id: "l1", action: "legCreated", subject: "Hotel → Museum", createdAt: "2026-10-20T13:00:00.000Z", undoable: true },
    { id: "s3", action: "stayDeleted", subject: "Harbour Inn", createdAt: "2026-10-20T12:00:00.000Z", undoable: true },
    { id: "s2", action: "stayUpdated", subject: "Harbour Inn", createdAt: "2026-10-20T11:00:00.000Z", undoable: true },
    { id: "s1", action: "stayCreated", subject: "Harbour Inn", createdAt: "2026-10-20T10:00:00.000Z", undoable: true },
  ];

  it.each([
    [
      "en",
      en,
      [
        "Leg deleted: Museum → Dinner",
        "Leg changed: Museum → Dinner",
        "Leg added: Hotel → Museum",
        "Stay deleted: Harbour Inn",
        "Stay changed: Harbour Inn",
        "Stay added: Harbour Inn",
      ],
    ],
    [
      "de",
      de,
      [
        "Fahrt gelöscht: Museum → Dinner",
        "Fahrt geändert: Museum → Dinner",
        "Fahrt hinzugefügt: Hotel → Museum",
        "Unterkunft gelöscht: Harbour Inn",
        "Unterkunft geändert: Harbour Inn",
        "Unterkunft hinzugefügt: Harbour Inn",
      ],
    ],
  ] as const)("labels stay and leg changes in %s", async (language, dictionary, labels) => {
    stubFetch(
      vi.fn(async (input: RequestInfo | URL) => {
        if (requestUrl(input).includes("/ai-changes")) return mockFetchResponse({ data: { changes: stayAndLegChanges }, error: null });
        return mockFetchResponse({ data: null, error: null });
      }),
    );
    renderWithProviders(
      <AiChangesNotice
        tripId="trip-1"
        dayId="day-1"
        refreshKey={0}
        ensureCsrfToken={async () => "csrf-token"}
        onDayChanged={() => undefined}
        onBucketChanged={() => undefined}
      />,
      { language },
    );
    const notice = await screen.findByTestId("ai-changes-notice");
    await userEvent.click(within(notice).getByRole("button", { name: dictionary["trips.aiChanges.expand"] }));
    const rows = within(notice).getAllByTestId("ai-change-row");
    labels.forEach((label, index) => expect(rows[index]).toHaveTextContent(label));
  });
});
