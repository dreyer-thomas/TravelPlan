import { describe, expect, it } from "vitest";
import { toTripRoute } from "@/lib/mcp/routeShapes";
import type { TripWithDays } from "@/lib/repositories/tripRepo";
import { summarizeTripTravel } from "@/lib/trips/tripTravelSummary";

/** Story 15.10. `toTripRoute` on synthetic trips: every text, cost and link field carries a sentinel. */

type Day = TripWithDays["days"][number];
type Item = Day["dayPlanItems"][number];
type Stay = NonNullable<Day["accommodation"]>;
type Segment = Day["travelSegments"][number];
type Location = { lat: number; lng: number };
type Endpoint = ["accommodation" | "dayPlanItem", string];

const SENTINEL = "SENTINEL-TEXT";
const SENTINEL_LINK = "https://sentinel.example";
const SENTINEL_COST = 987654;

const located = (location: Location | null) => (location ? { ...location, label: SENTINEL } : null);

const stay = (id: string, location: Location | null): Stay => ({
  id,
  name: `Stay ${id}`,
  notes: SENTINEL,
  status: "booked",
  costCents: SENTINEL_COST,
  costOriginalAmount: SENTINEL_COST,
  costCurrency: "CZK",
  costRate: 25,
  costRateDate: "2027-04-01",
  payments: [],
  link: SENTINEL_LINK,
  checkInTime: "15:00",
  checkOutTime: "10:00",
  location: located(location),
  aiChangedAt: null,
});

const item = (id: string, sortOrder: number, location: Location | null): Item => ({
  id,
  title: SENTINEL,
  fromTime: null,
  toTime: null,
  createdAt: new Date("2027-01-01T00:00:00.000Z"),
  scheduleMode: "FLEXIBLE",
  durationMinutes: 60,
  sortOrder,
  contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: SENTINEL }] }] }),
  costCents: SENTINEL_COST,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  payments: [],
  linkUrl: SENTINEL_LINK,
  location: located(location),
  aiChangedAt: null,
});

const leg = (
  id: string,
  from: Endpoint,
  to: Endpoint,
  transportType: string,
  durationMinutes: number,
  distanceKm: number | null,
): Segment => ({
  id,
  fromItemType: from[0],
  fromItemId: from[1],
  toItemType: to[0],
  toItemId: to[1],
  transportType: transportType as Segment["transportType"],
  durationMinutes,
  distanceKm,
  linkUrl: SENTINEL_LINK,
});

const day = (
  dayIndex: number,
  parts: { stay?: Stay | null; items?: Item[]; legs?: Segment[] } = {},
): Day => ({
  id: `day-${dayIndex}`,
  date: new Date(Date.UTC(2027, 4, dayIndex)),
  dayIndex,
  imageUrl: `/uploads/${SENTINEL}.jpg`,
  note: SENTINEL,
  updatedAt: new Date("2027-01-01T00:00:00.000Z"),
  aiChangedAt: null,
  plannedCostSubtotal: SENTINEL_COST,
  missingAccommodation: !parts.stay,
  missingPlan: !parts.items?.length,
  planConflicts: [],
  accommodation: parts.stay ?? null,
  dayPlanItems: parts.items ?? [],
  travelSegments: parts.legs ?? [],
});

const trip = (days: Day[]): TripWithDays => ({
  id: "trip-1",
  name: SENTINEL,
  accessRole: "owner",
  startDate: new Date("2027-05-01T00:00:00.000Z"),
  endDate: new Date(Date.UTC(2027, 4, Math.max(days.length, 1))),
  dayCount: days.length,
  plannedCostTotal: SENTINEL_COST,
  accommodationCostTotalCents: SENTINEL_COST,
  heroImageUrl: `/uploads/${SENTINEL}-hero.jpg`,
  updatedAt: new Date("2027-01-01T00:00:00.000Z"),
  days,
});

const A = { lat: 50.1, lng: 14.1 };
const B = { lat: 50.2, lng: 14.2 };
const C = { lat: 50.3, lng: 14.3 };
const pt = (location: Location) => [location.lat, location.lng];

describe("toTripRoute", () => {
  it("answers an empty trip with no days and zero totals", () => {
    expect(toTripRoute(trip([]))).toEqual({
      id: "trip-1",
      startDate: "2027-05-01",
      endDate: "2027-05-01",
      totals: { distanceKm: 0, byMode: [] },
      days: [],
    });
  });

  it("answers days without stops with empty legs and path", () => {
    const route = toTripRoute(trip([day(1), day(2)]));
    expect(route.days).toEqual([
      { date: "2027-05-01", dayIndex: 1, stay: null, legs: [], path: [], missingPositions: 0 },
      { date: "2027-05-02", dayIndex: 2, stay: null, legs: [], path: [], missingPositions: 0 },
    ]);
  });

  it("gives a day without stay its activities' path and legs", () => {
    const route = toTripRoute(
      trip([
        day(1, {
          items: [item("a", 0, A), item("b", 1, B)],
          legs: [leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "car", 10, 5)],
        }),
      ]),
    );
    expect(route.days[0]).toEqual({
      date: "2027-05-01",
      dayIndex: 1,
      stay: null,
      legs: [{ mode: "car", count: 1, distanceKm: 5, durationMinutes: 10 }],
      path: [{ mode: "car", points: [pt(A), pt(B)] }],
      missingPositions: 0,
    });
  });

  it("gives a ferry day a ship section joined to the drive before it", () => {
    const route = toTripRoute(
      trip([
        day(1, { stay: stay("s1", A) }),
        day(2, {
          stay: stay("s2", C),
          items: [item("port", 0, B)],
          legs: [
            leg("drive", ["accommodation", "s1"], ["dayPlanItem", "port"], "car", 45, 30.5),
            leg("ferry", ["dayPlanItem", "port"], ["accommodation", "s2"], "ship", 120, null),
          ],
        }),
      ]),
    );
    expect(route.days[1].stay).toEqual({ name: "Stay s2", ...C });
    expect(route.days[1].legs).toEqual([
      { mode: "car", count: 1, distanceKm: 30.5, durationMinutes: 45 },
      { mode: "ship", count: 1, distanceKm: null, durationMinutes: 120 },
    ]);
    expect(route.days[1].path).toEqual([
      { mode: "car", points: [pt(A), pt(B)] },
      { mode: "ship", points: [pt(B), pt(C)] },
    ]);
  });

  it("merges consecutive hops of the same mode into one section", () => {
    const route = toTripRoute(
      trip([
        day(1, {
          items: [item("a", 0, A), item("b", 1, B), item("c", 2, C)],
          legs: [
            leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "walking", 10, 1),
            leg("bc", ["dayPlanItem", "b"], ["dayPlanItem", "c"], "walking", 20, 2),
          ],
        }),
      ]),
    );
    expect(route.days[0].path).toEqual([{ mode: "walking", points: [pt(A), pt(B), pt(C)] }]);
    expect(route.days[0].legs).toEqual([{ mode: "walking", count: 2, distanceKm: 3, durationMinutes: 30 }]);
  });

  it("leaves an orphaned leg out of the totals and the path modes", () => {
    const route = toTripRoute(
      trip([
        day(1, {
          stay: stay("s2", C),
          items: [item("a", 0, A), item("b", 1, B)],
          legs: [
            leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "walking", 15, 1.2),
            leg("orphan", ["dayPlanItem", "a"], ["accommodation", "s2"], "car", 600, 900),
          ],
        }),
      ]),
    );
    expect(route.days[0].legs).toEqual([{ mode: "walking", count: 1, distanceKm: 1.2, durationMinutes: 15 }]);
    expect(route.days[0].path).toEqual([
      { mode: "walking", points: [pt(A), pt(B)] },
      { mode: null, points: [pt(B), pt(C)] },
    ]);
    expect(route.totals).toEqual({ distanceKm: 1.2, byMode: [{ mode: "walking", count: 1, distanceKm: 1.2, durationMinutes: 15 }] });
  });

  it("skips a stop without position, counts it, and gives the hop across it no mode", () => {
    const route = toTripRoute(
      trip([
        day(1, {
          items: [item("a", 0, A), item("b", 1, null), item("c", 2, C)],
          legs: [
            leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "car", 10, 5),
            leg("bc", ["dayPlanItem", "b"], ["dayPlanItem", "c"], "car", 10, 5),
          ],
        }),
      ]),
    );
    expect(route.days[0].path).toEqual([{ mode: null, points: [pt(A), pt(C)] }]);
    expect(route.days[0].missingPositions).toBe(1);
    expect(route.days[0].legs).toEqual([{ mode: "car", count: 2, distanceKm: 10, durationMinutes: 20 }]);
  });

  it("counts tonight's stay without position once, and not again as last night's stay", () => {
    const route = toTripRoute(trip([day(1, { stay: stay("s1", null) }), day(2, { items: [item("a", 0, null)] })]));
    expect(route.days.map((entry) => [entry.stay, entry.missingPositions])).toEqual([
      [null, 1],
      [null, 1],
    ]);
  });

  it("treats a non-finite coordinate as no position", () => {
    const route = toTripRoute(trip([day(1, { stay: stay("s1", { lat: Number.NaN, lng: 14 }) })]));
    expect(route.days[0]).toMatchObject({ stay: null, path: [], missingPositions: 1 });
  });

  it("drops the zero-length hop of the same hotel two nights and keeps the place as one point", () => {
    const route = toTripRoute(trip([day(1, { stay: stay("s1", A) }), day(2, { stay: stay("s2", A) })]));
    expect(route.days[0].path).toEqual([{ mode: null, points: [pt(A)] }]);
    expect(route.days[1].path).toEqual([{ mode: null, points: [pt(A)] }]);
  });

  it("does not count or name a leg with an unknown transport type", () => {
    const route = toTripRoute(
      trip([
        day(1, {
          items: [item("a", 0, A), item("b", 1, B)],
          legs: [leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "hovercraft", 10, 5)],
        }),
      ]),
    );
    expect(route.days[0].legs).toEqual([]);
    expect(route.days[0].path).toEqual([{ mode: null, points: [pt(A), pt(B)] }]);
  });

  it("ignores a stored flight distance", () => {
    const route = toTripRoute(
      trip([
        day(1, {
          items: [item("a", 0, A), item("b", 1, B)],
          legs: [leg("ab", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "flight", 120, 800)],
        }),
      ]),
    );
    expect(route.days[0].legs).toEqual([{ mode: "flight", count: 1, distanceKm: null, durationMinutes: 120 }]);
    expect(route.totals.distanceKm).toBe(0);
  });

  it("rounds coordinates to 5 decimals", () => {
    const route = toTripRoute(
      trip([day(1, { stay: stay("s1", { lat: 50.123456789, lng: 14.987654321 }), items: [item("a", 0, { lat: -0.000004, lng: 1.000006 })] })]),
    );
    expect(route.days[0].stay).toEqual({ name: "Stay s1", lat: 50.12346, lng: 14.98765 });
    // -0.000004 rounds to 0, not -0.
    expect(Object.is(route.days[0].path[0].points[0][0], 0)).toBe(true);
    expect(route.days[0].path[0].points).toEqual([
      [0, 1.00001],
      [50.12346, 14.98765],
    ]);
  });

  it("matches summarizeTripTravel in totals and in per-day legs summed over the trip", () => {
    const days = [
      day(1, {
        stay: stay("s1", A),
        items: [item("x", 0, C)],
        legs: [leg("fly", ["dayPlanItem", "x"], ["accommodation", "s1"], "flight", 120, null)],
      }),
      day(2, {
        stay: stay("s2", B),
        items: [item("a", 0, A), item("b", 1, C)],
        legs: [
          leg("first", ["accommodation", "s1"], ["dayPlanItem", "a"], "car", 45, 30.5),
          leg("walk", ["dayPlanItem", "a"], ["dayPlanItem", "b"], "walking", 15, null),
          leg("last", ["dayPlanItem", "b"], ["accommodation", "s2"], "car", 90, 100.2),
          leg("orphan", ["dayPlanItem", "a"], ["accommodation", "s2"], "car", 600, 900),
        ],
      }),
      day(3, {
        items: [item("c", 0, A)],
        legs: [leg("back", ["accommodation", "s2"], ["dayPlanItem", "c"], "car", 60, 40.1)],
      }),
    ];
    const route = toTripRoute(trip(days));
    const summary = summarizeTripTravel(days);
    expect(route.totals).toEqual({
      distanceKm: summary.totalKm,
      byMode: summary.byMode.map((entry) => ({
        mode: entry.transportType,
        count: entry.legCount,
        distanceKm: entry.distanceKm,
        durationMinutes: entry.durationMinutes,
      })),
    });

    const summed = new Map<string, { count: number; durationMinutes: number; distanceKm: number | null }>();
    for (const entry of route.days.flatMap((routeDay) => routeDay.legs)) {
      const sum = summed.get(entry.mode) ?? { count: 0, durationMinutes: 0, distanceKm: null };
      sum.count += entry.count;
      sum.durationMinutes += entry.durationMinutes;
      if (entry.distanceKm !== null) sum.distanceKm = Math.round(((sum.distanceKm ?? 0) + entry.distanceKm) * 10) / 10;
      summed.set(entry.mode, sum);
    }
    expect(Object.fromEntries(summed)).toEqual(
      Object.fromEntries(route.totals.byMode.map(({ mode, count, durationMinutes, distanceKm }) => [mode, { count, durationMinutes, distanceKm }])),
    );
  });

  it("carries no texts, costs, links or files, and exactly the day keys", () => {
    const route = toTripRoute(
      trip([
        day(1, { stay: stay("s1", A), items: [item("a", 0, B)], legs: [leg("l", ["dayPlanItem", "a"], ["accommodation", "s1"], "car", 5, 1)] }),
        day(2, { items: [item("b", 0, null)] }),
      ]),
    );
    const json = JSON.stringify(route);
    for (const forbidden of [SENTINEL, SENTINEL_LINK, String(SENTINEL_COST), "/uploads/", "updatedAt", "aiChangedAt", "label"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(route)).toEqual(["id", "startDate", "endDate", "totals", "days"]);
    for (const routeDay of route.days) {
      expect(Object.keys(routeDay)).toEqual(["date", "dayIndex", "stay", "legs", "path", "missingPositions"]);
    }
  });

  it("stays below 60 KB for 60 days with 10 stops a day", () => {
    const days = Array.from({ length: 60 }, (_, index) => {
      const dayIndex = index + 1;
      const at = (stop: number) => ({ lat: 40 + dayIndex * 0.123456 + stop * 0.011111, lng: -3 - dayIndex * 0.654321 - stop * 0.022222 });
      const items = Array.from({ length: 10 }, (__, stop) => item(`d${dayIndex}i${stop}`, stop, at(stop)));
      const endpoints: Endpoint[] = [
        ...(dayIndex > 1 ? [["accommodation", `s${dayIndex - 1}`] as Endpoint] : []),
        ...items.map((entry) => ["dayPlanItem", entry.id] as Endpoint),
        ["accommodation", `s${dayIndex}`],
      ];
      const legs = endpoints.slice(1).map((to, stop) =>
        leg(`d${dayIndex}l${stop}`, endpoints[stop], to, stop % 3 === 0 ? "car" : "walking", 25, 12.3),
      );
      return day(dayIndex, { stay: stay(`s${dayIndex}`, at(11)), items, legs });
    });
    const route = toTripRoute(trip(days));
    expect(route.days).toHaveLength(60);
    expect(route.days[1].path.flatMap((section) => section.points).length).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(route).length).toBeLessThan(60_000);
  });
});
