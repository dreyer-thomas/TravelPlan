import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/routing/dayRouteService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/routing/dayRouteService")>("@/lib/routing/dayRouteService");
  return { ...actual, getDayRouteFromOsrm: vi.fn() };
});
vi.mock("@/lib/trips/suggestionImageDownload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trips/suggestionImageDownload")>(
    "@/lib/trips/suggestionImageDownload",
  );
  return { ...actual, downloadSuggestionImages: vi.fn() };
});

import { prisma } from "@/lib/db/prisma";
import { applySuggestionsForTripDay } from "@/lib/repositories/daySuggestionApplyRepo";
import { getTripWithDaysForUser } from "@/lib/repositories/tripRepo";
import type { SuggestionMode } from "@/lib/validation/daySuggestionSchemas";
import { DayRouteError, getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";
import { downloadSuggestionImages } from "@/lib/trips/suggestionImageDownload";
import { resolveStoredMediaPath } from "@/lib/trips/uploadPaths";
import { parsePlanText } from "@/lib/trips/planText";
import {
  CSRF,
  JPEG,
  PNG,
  addMember,
  applyBodyFrom,
  createActivity,
  databaseState,
  postApply,
  postPreview,
  postUndo,
  resetDatabase,
  seedTrip,
  suggestion,
} from "./helpers/suggestionApplyFixtures";

/**
 * Story 12.4 AC1–AC10 at the HTTP boundary, against the real test database. OSRM and the picture download
 * are mocked (never the real internet); the files land under the per-worker `MEDIA_STORAGE_ROOT`.
 *
 * Since Story 13.4 the suggestions land FLEXIBLE, appended after the day's last row, with the schedule
 * rule's times (starts are not rounded); the preview runs the apply's own planner.
 */

const thumb = (name: string) => `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/250px-${name}`;
const original = (name: string) => `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`;
const picture = (name: string) => ({ thumbnailUrl: thumb(name), originalUrl: original(name) });

/** OSRM's answer for a chain: one leg per pair, in minutes and metres. */
const osrmLegs = (...legs: Array<[minutes: number, meters: number]>) => ({
  polyline: [],
  distanceMeters: legs.reduce((sum, [, meters]) => sum + meters, 0),
  durationSeconds: legs.reduce((sum, [minutes]) => sum + minutes * 60, 0),
  legs: legs.map(([minutes, meters]) => ({ durationSeconds: minutes * 60, distanceMeters: meters })),
});

// West to east: the harbour lies before the museum on the way to tonight's stay.
const harbour = suggestion({
  title: "Old Harbour",
  lng: -8.63,
  durationMinutes: 90,
  images: [picture("Harbour.jpg"), picture("Quay.jpg")],
});
const museum = suggestion({
  title: "Tile Museum",
  description: "Azulejos from five centuries.",
  locationLabel: "Museu, Porto",
  lng: -8.61,
  durationMinutes: 45,
  verified: false,
  images: [picture("Tiles.jpg")],
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getDayRouteFromOsrm).mockReset();
  vi.mocked(downloadSuggestionImages).mockReset();
  // Every picture downloads unless a case says otherwise: the first as a JPEG, the rest as PNGs.
  vi.mocked(downloadSuggestionImages).mockImplementation(async (groups) =>
    groups.map((images) =>
      images.map((_image, index) => (index === 0 ? { bytes: JPEG, contentType: "image/jpeg" } : { bytes: PNG, contentType: "image/png" })),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST …/suggestions/preview and …/apply (Story 12.4)", () => {
  it("orders the stops along the way, plans the times from last night's check-out and shows the legs", async () => {
    const { trip, day2, westStay, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449], [7, 1200]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [museum, harbour] });

    expect(preview.status).toBe(200);
    expect(preview.body.data).toEqual({
      order: [1, 0],
      // 09:30 + 12 → 09:42 (not rounded), + 90 → 11:12; + 7 → 11:19, + 45 → 12:04.
      rows: [
        { fromTime: "09:42", toTime: "11:12" },
        { fromTime: "11:19", toTime: "12:04" },
      ],
      legs: [
        { durationMinutes: 12, distanceKm: 8.4 },
        { durationMinutes: 7, distanceKm: 1.2 },
      ],
      basis: {
        afterItemId: null,
        // No activity yet, the first leg leaves last night's stay, the stops are ordered from it, tonight's stay
        // ends the day; then the planned times.
        fingerprint: `items:0|from:accommodation:${westStay.id}@41.15,-8.65|order:41.15,-8.65|end:41.15,-8.6|times:09:42-11:12,11:19-12:04`,
      },
      overflow: false,
      routingUnavailable: false,
      origin: { kind: "stay", label: "Hotel Ribeira" },
    });
    // One request for the whole chain: last night's stay, then the stops in order, on the walking profile.
    expect(getDayRouteFromOsrm).toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(getDayRouteFromOsrm).mock.calls[0];
    expect(args.profile).toBe("walking");
    expect(args.points).toEqual([
      { lat: 41.15, lng: -8.65 },
      { lat: harbour.lat, lng: harbour.lng },
      { lat: museum.lat, lng: museum.lng },
    ]);
  });

  it("creates the activities, their pictures and the legs in the search's mode, and returns a signed receipt", async () => {
    const { trip, day2, westStay, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449], [7, 1200]));
    const suggestions = [museum, harbour];
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions });

    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", suggestions, preview.body.data!));

    expect(applied.status).toBe(200);
    expect(getDayRouteFromOsrm).toHaveBeenCalledTimes(1);
    const items = await prisma.dayPlanItem.findMany({ where: { tripDayId: day2.id }, orderBy: { fromTime: "asc" } });
    expect(items.map(({ title, scheduleMode, durationMinutes, sortOrder, fromTime, toTime, locationLabel, locationLat, locationLng }) => ({
      title,
      scheduleMode,
      durationMinutes,
      sortOrder,
      fromTime,
      toTime,
      locationLabel,
      locationLat,
      locationLng,
    }))).toEqual([
      { title: "Old Harbour", scheduleMode: "FLEXIBLE", durationMinutes: 90, sortOrder: 0, fromTime: "09:42", toTime: "11:12", locationLabel: "Harbour, Porto", locationLat: 41.15, locationLng: -8.63 },
      { title: "Tile Museum", scheduleMode: "FLEXIBLE", durationMinutes: 45, sortOrder: 1, fromTime: "11:19", toTime: "12:04", locationLabel: "Museu, Porto", locationLat: 41.15, locationLng: -8.61 },
    ]);
    expect(parsePlanText(items[0].contentJson)).toBe("Walk the quay. Then the fish market.");
    expect(JSON.parse(items[0].contentJson).content).toHaveLength(2);

    const legs = await prisma.travelSegment.findMany({ where: { tripDayId: day2.id }, orderBy: { durationMinutes: "desc" } });
    expect(legs.map(({ fromItemType, fromItemId, toItemId, transportType, durationMinutes, distanceKm }) => ({
      fromItemType,
      fromItemId,
      toItemId,
      transportType,
      durationMinutes,
      distanceKm,
    }))).toEqual([
      { fromItemType: "ACCOMMODATION", fromItemId: westStay.id, toItemId: items[0].id, transportType: "WALKING", durationMinutes: 12, distanceKm: 8.4 },
      { fromItemType: "DAY_PLAN_ITEM", fromItemId: items[0].id, toItemId: items[1].id, transportType: "WALKING", durationMinutes: 7, distanceKm: 1.2 },
    ]);

    const images = await prisma.dayPlanItemImage.findMany({ orderBy: [{ dayPlanItemId: "asc" }, { sortOrder: "asc" }] });
    const harbourImages = images.filter((image) => image.dayPlanItemId === items[0].id);
    expect(harbourImages.map((image) => image.sortOrder)).toEqual([1, 2]);
    expect(harbourImages[0].imageUrl).toMatch(
      new RegExp(`^/uploads/trips/${trip.id}/days/${day2.id}/day-plan-items/${items[0].id}/img-.+\\.jpg$`),
    );
    expect(harbourImages[1].imageUrl).toMatch(/\.png$/);
    expect(images.filter((image) => image.dayPlanItemId === items[1].id)).toHaveLength(1);
    for (const image of images) {
      expect(fs.existsSync(resolveStoredMediaPath(image.imageUrl))).toBe(true);
    }

    const receipt = applied.body.data!.receipt;
    expect(receipt.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.edited).toEqual({
      kind: "suggestionsApplied",
      items: items.map((item) => ({ itemId: item.id, updatedAt: item.updatedAt.toISOString() })),
      segments: expect.any(Array),
      imageIds: expect.arrayContaining(images.map((image) => image.id)),
    });
    expect(receipt.edited.kind === "suggestionsApplied" && receipt.edited.segments).toHaveLength(2);
    expect(receipt.removedTravelSegments).toEqual([]);
    expect(receipt.movedItems).toEqual([]);
  });

  it("appends after the day's last activity, timed or not, and takes the first leg from it", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Lunch", "12:00", "13:20", { lat: 41.15, lng: -8.64 });
    // A seed without times sorts after Lunch; it is the day's last row (scheduled as flexible, 15 min).
    const someday = await createActivity(day2.id, "Someday", null, null, { lat: 41.2, lng: -8.7 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([3, 900]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });

    // Lunch ends 13:20, Someday 13:20–13:35, + 3 → 13:38.
    expect(preview.body.data).toMatchObject({
      rows: [{ fromTime: "13:38", toTime: "15:08" }],
      basis: { afterItemId: someday.id },
      origin: { kind: "activity", label: "Someday" },
    });
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].points[0]).toEqual({ lat: 41.2, lng: -8.7 });
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].profile).toBe("driving");

    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], preview.body.data!));
    expect(applied.status).toBe(200);
    const created = await prisma.dayPlanItem.findFirstOrThrow({ where: { title: "Old Harbour" } });
    expect(created).toMatchObject({ sortOrder: 2, scheduleMode: "FLEXIBLE", fromTime: "13:38", toTime: "15:08" });
    const legs = await prisma.travelSegment.findMany();
    expect(legs.map(({ fromItemId, toItemId }) => [fromItemId, toItemId])).toEqual([[someday.id, created.id]]);
    // The seed was normalised by the recompute (FLEXIBLE, its times, sortOrder 1), and the receipt lists it.
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: someday.id } })).toMatchObject({
      scheduleMode: "FLEXIBLE",
      fromTime: "13:20",
      toTime: "13:35",
      sortOrder: 1,
    });
    expect(applied.body.data!.receipt.movedItems.map((moved) => moved.itemId)).toEqual([someday.id]);
  });

  it("starts at the latest end on the day, with the first leg still from the timeline's last activity", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Day tour", "09:00", "18:00", { lat: 41.16, lng: -8.62 });
    const coffee = await createActivity(day2.id, "Coffee", "10:00", "11:00", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([3, 900]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });

    // Not 11:03: the tour runs until 18:00. Coffee is still the day's last row, so the new stop's neighbour.
    expect(preview.body.data).toMatchObject({
      rows: [{ fromTime: "18:03", toTime: "19:33" }],
      basis: { afterItemId: coffee.id },
      origin: { kind: "activity", label: "Coffee" },
    });
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].points[0]).toEqual({ lat: 41.15, lng: -8.64 });
    await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], preview.body.data!));
    expect((await prisma.travelSegment.findFirstOrThrow()).fromItemId).toBe(coffee.id);
  });

  it("has no first leg after a last timed activity without a place, and orders from last night's stay", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Call home", "10:00", "10:30");
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([7, 1200]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [museum, harbour] });

    expect(preview.body.data?.order).toEqual([1, 0]);
    expect(preview.body.data?.legs).toEqual([null, { durationMinutes: 7, distanceKm: 1.2 }]);
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].points).toHaveLength(2);
    await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [museum, harbour], preview.body.data!));
    expect(await prisma.travelSegment.count()).toBe(1);
  });

  it("treats legs that do not match the chain as routing unavailable", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449], [7, 1200], [3, 500]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [museum, harbour] });
    expect(preview.body.data).toMatchObject({ routingUnavailable: true, legs: [null, null] });
  });

  it("starts at the 10:00 default when last night's check-out is not stored", async () => {
    const { trip, day2, session } = await seedTrip("owner@example.com", { checkOutTime: null });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([10, 2000]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    expect(preview.body.data?.rows).toEqual([{ fromTime: "10:10", toTime: "11:40" }]);
    expect(preview.body.data?.basis.fingerprint).toMatch(/\|times:10:10-11:40$/);
  });

  it("orders from the trip's start on the first day, but neither counts nor creates a leg from it", async () => {
    const { trip, day1, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([20, 15000], [7, 1200]));

    const preview = await postPreview(trip.id, day1.id, session, { mode: "car", suggestions: [harbour, museum] });

    expect(preview.body.data?.origin).toEqual({ kind: "tripStart", label: "Porto Airport" });
    // No stay last night, so no check-out: the day starts at 09:00 (Tommy's ruling 1c). The 20-minute leg
    // from the trip's start is shown but not stored, so it does not count either (Story 13.4 Q1).
    expect(preview.body.data?.legs[0]).toEqual({ durationMinutes: 20, distanceKm: 15 });
    expect(preview.body.data?.rows).toEqual([
      { fromTime: "09:00", toTime: "10:30" },
      { fromTime: "10:37", toTime: "11:22" },
    ]);
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].points[0]).toEqual({ lat: 41.24, lng: -8.68 });
    const applied = await postApply(trip.id, day1.id, session, applyBodyFrom("car", [harbour, museum], preview.body.data!));
    expect(applied.status).toBe(200);
    const legs = await prisma.travelSegment.findMany();
    expect(legs).toHaveLength(1);
    expect(legs[0].fromItemType).toBe("DAY_PLAN_ITEM");
  });

  it("plans and creates the activities without legs when OSRM fails, counting the legs as no time", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockRejectedValue(new DayRouteError("routing_no_route", "no route"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const preview = await postPreview(trip.id, day2.id, session, { mode: "cycling", suggestions: [museum, harbour] });

    expect(preview.body.data).toMatchObject({
      routingUnavailable: true,
      legs: [null, null],
      rows: [
        { fromTime: "09:30", toTime: "11:00" },
        { fromTime: "11:00", toTime: "11:45" },
      ],
    });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("cycling", [museum, harbour], preview.body.data!));
    expect(applied.status).toBe(200);
    expect(await prisma.dayPlanItem.count()).toBe(2);
    expect(await prisma.travelSegment.count()).toBe(0);
  });

  it("skips a picture that could not be downloaded and keeps the others", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    vi.mocked(downloadSuggestionImages).mockResolvedValue([[{ bytes: PNG, contentType: "image/png" }]]);

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [harbour], preview.body.data!));

    expect(applied.status).toBe(200);
    const images = await prisma.dayPlanItemImage.findMany();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ sortOrder: 1 });
    expect(images[0].imageUrl).toMatch(/\.png$/);
    // The route hands the download the pictures that passed their guards, in the suggestions' order.
    expect(vi.mocked(downloadSuggestionImages).mock.calls[0][0]).toEqual([harbour.images]);
  });

  it("drops a picture whose URL fails its guard before anything is downloaded", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const crafted = { ...harbour, images: [{ thumbnailUrl: thumb("X.jpg"), originalUrl: "http://169.254.169.254/latest" }] };
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [crafted] });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [crafted], preview.body.data!));
    expect(applied.status).toBe(200);
    expect(vi.mocked(downloadSuggestionImages).mock.calls[0][0]).toEqual([[]]);
  });

  it("sweeps the leg the new activities now sit inside, and the receipt carries it", async () => {
    const { trip, day2, eastStay, session } = await seedTrip();
    const lunch = await createActivity(day2.id, "Lunch", "12:00", "13:00", { lat: 41.15, lng: -8.64 });
    const toStay = await prisma.travelSegment.create({
      data: {
        tripDayId: day2.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: lunch.id,
        toItemType: "ACCOMMODATION",
        toItemId: eastStay.id,
        transportType: "CAR",
        durationMinutes: 15,
        distanceKm: 4,
      },
    });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([5, 1000]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], preview.body.data!));

    expect(applied.status).toBe(200);
    expect(await prisma.travelSegment.findUnique({ where: { id: toStay.id } })).toBeNull();
    expect(applied.body.data?.receipt.removedTravelSegments.map((leg) => leg.id)).toEqual([toStay.id]);
    // No leg is created to tonight's stay.
    expect(await prisma.travelSegment.count({ where: { toItemType: "ACCOMMODATION" } })).toBe(0);
  });

  it("carries no check-in warning when the appended activities reach tonight's stay late (Story 13.2)", async () => {
    const { trip, day2, eastStay, session } = await seedTrip();
    await prisma.accommodation.update({ where: { id: eastStay.id }, data: { checkInTime: "10:30" } });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([5, 1000]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], preview.body.data!));
    expect(applied.status).toBe(200);
    expect(Object.keys(applied.body.data!.receipt)).not.toContain("checkInWarning");
  });

  it("adds whatever passes 23:59 without times and says so in the preview", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Dinner", "20:00", "22:30", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([5, 1000], [5, 1000]));
    const late = [suggestion({ title: "Bar", durationMinutes: 60 }), suggestion({ title: "Club", lng: -8.61, durationMinutes: 60 })];

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: late });

    expect(preview.body.data).toMatchObject({ overflow: true, rows: [{ fromTime: "22:35", toTime: "23:35" }, null] });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", late, preview.body.data!));
    expect(applied.status).toBe(200);
    const club = await prisma.dayPlanItem.findFirstOrThrow({ where: { title: "Club" } });
    expect(club).toMatchObject({ scheduleMode: "FLEXIBLE", durationMinutes: 60, fromTime: null, toTime: null });
    // Story 13.2: the trip payload marks it as a conflict on the next read.
    const day = (await getTripWithDaysForUser(trip.userId, trip.id))!.days.find((entry) => entry.id === day2.id)!;
    expect(day.planConflicts).toEqual([{ kind: "overflow", itemId: club.id, title: "Club" }]);
  });

  it("refuses with 409 and writes nothing when the day changed since the preview", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    await createActivity(day2.id, "Breakfast", "09:00", "10:30");
    const before = await databaseState();
    const filesBefore = fs.readdirSync(process.env.MEDIA_STORAGE_ROOT!, { recursive: true }).length;

    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [harbour], preview.body.data!));

    expect(applied.status).toBe(409);
    expect(applied.body.error?.code).toBe("day_plan_changed");
    expect(await databaseState()).toEqual(before);
    expect(fs.readdirSync(process.env.MEDIA_STORAGE_ROOT!, { recursive: true }).length).toBe(filesBefore);
  });

  it("refuses a second apply of the same preview even when all its activities were untimed", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Dinner", "20:00", "23:30", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([5, 1000]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    expect(preview.body.data?.rows).toEqual([null]);
    const body = applyBodyFrom("walking", [harbour], preview.body.data!);

    expect((await postApply(trip.id, day2.id, session, body)).status).toBe(200);
    const again = await postApply(trip.id, day2.id, session, body);

    expect(again.status).toBe(409);
    expect(await prisma.dayPlanItem.count({ where: { title: "Old Harbour" } })).toBe(1);
  });

  it("refuses with 409 when the first leg's origin moved or tonight's stay changed since the preview", async () => {
    const { trip, day2, eastStay, session } = await seedTrip();
    const lunch = await createActivity(day2.id, "Lunch", "12:00", "13:00", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([3, 900]));

    const first = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });
    // Same times, another place: the preview's first leg no longer leaves from where lunch is.
    await prisma.dayPlanItem.update({ where: { id: lunch.id }, data: { locationLat: 41.2, locationLng: -8.7 } });
    expect((await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], first.body.data!))).status).toBe(409);

    const second = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });
    await prisma.accommodation.update({ where: { id: eastStay.id }, data: { locationLat: 41.1, locationLng: -8.5 } });
    expect((await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], second.body.data!))).status).toBe(409);
    expect(await prisma.dayPlanItem.count()).toBe(1);
  });

  it("stores exactly the times the preview showed (Story 13.4 AC2)", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Lunch", "12:00", "13:00", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([11, 2100], [4, 700]));
    const suggestions = [museum, harbour];

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions });
    const body = applyBodyFrom("walking", suggestions, preview.body.data!);
    expect((await postApply(trip.id, day2.id, session, body)).status).toBe(200);

    const stored = await Promise.all(
      body.suggestions.map((entry) => prisma.dayPlanItem.findFirstOrThrow({ where: { title: entry.title } })),
    );
    expect(stored.map(({ fromTime, toTime }) => ({ fromTime, toTime }))).toEqual(preview.body.data!.rows);
    expect(preview.body.data!.rows).toEqual([
      { fromTime: "13:11", toTime: "14:41" },
      { fromTime: "14:45", toTime: "15:30" },
    ]);
  });

  it("refuses with 409 and writes nothing when last night's check-out or an earlier duration changed", async () => {
    const { trip, day2, westStay, session } = await seedTrip();
    const walk = await prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: day2.id,
        title: "Walk",
        scheduleMode: "FLEXIBLE",
        durationMinutes: 60,
        fromTime: "09:30",
        toTime: "10:30",
        contentJson: "{}",
      },
    });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([5, 1000]));

    const first = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    await prisma.accommodation.update({ where: { id: westStay.id }, data: { checkOutTime: "11:00" } });
    const before = await databaseState();
    const refused = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [harbour], first.body.data!));
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("day_plan_changed");
    expect(await databaseState()).toEqual(before);

    const second = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    await prisma.dayPlanItem.update({ where: { id: walk.id }, data: { durationMinutes: 90 } });
    const stateBefore = await databaseState();
    expect((await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [harbour], second.body.data!))).status).toBe(409);
    expect(await databaseState()).toEqual(stateBefore);
  });

  it("recomputes an unsettled day, lists the moved rows, and undo restores the whole database (AC5)", async () => {
    const { trip, day2, session } = await seedTrip();
    // A legacy import's leftovers: flexible rows at stale times, sortOrders not dense.
    for (const [title, sortOrder, fromTime, toTime] of [
      ["Market", 0, "11:00", "12:00"],
      ["Garden", 5, "14:00", "14:30"],
    ] as const) {
      await prisma.dayPlanItem.create({
        data: { tripId: trip.id, tripDayId: day2.id, title, scheduleMode: "FLEXIBLE", durationMinutes: title === "Market" ? 60 : 30, sortOrder, fromTime, toTime, contentJson: "{}" },
      });
    }
    vi.mocked(getDayRouteFromOsrm).mockRejectedValue(new DayRouteError("routing_no_route", "no route"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = await databaseState();

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    // 09:30 Market → 10:30, Garden → 11:00, then the suggestion.
    expect(preview.body.data?.rows).toEqual([{ fromTime: "11:00", toTime: "12:30" }]);
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [harbour], preview.body.data!));
    expect(applied.status).toBe(200);
    const receipt = applied.body.data!.receipt;
    expect(receipt.movedItems.map((moved) => [moved.fromTime, moved.toTime])).toEqual([
      ["09:30", "10:30"],
      ["10:30", "11:00"],
    ]);
    expect(
      (await prisma.dayPlanItem.findMany({ where: { tripDayId: day2.id }, orderBy: { sortOrder: "asc" } })).map(
        ({ title, sortOrder }) => [title, sortOrder],
      ),
    ).toEqual([
      ["Market", 0],
      ["Garden", 1],
      ["Old Harbour", 2],
    ]);

    const undone = await postUndo(trip.id, session, receipt);
    expect(undone.status).toBe(200);
    expect(await databaseState()).toEqual(before);
  });

  it("writes nothing for a viewer even past the route, through the repository's own writer clause", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    const viewer = await addMember(trip.id, "VIEWER");

    const receipt = await applySuggestionsForTripDay({
      origin: "user",
      userId: viewer.user.id,
      tripId: trip.id,
      tripDayId: day2.id,
      mode: "walking",
      suggestions: [harbour],
      legs: preview.body.data!.legs,
      basis: preview.body.data!.basis,
      images: [[]],
    });

    expect(receipt).toBeNull();
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("removes the written pictures and their activity directories when the transaction fails", async () => {
    const { user, trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    const before = await databaseState();
    const entries = () => fs.readdirSync(process.env.MEDIA_STORAGE_ROOT!, { recursive: true }).map(String);
    const entriesBefore = new Set(entries());

    // A mode no schema admits: the leg create throws after the pictures are written.
    await expect(
      applySuggestionsForTripDay({
        origin: "user",
        userId: user.id,
        tripId: trip.id,
        tripDayId: day2.id,
        mode: "boat" as SuggestionMode,
        suggestions: [harbour],
        legs: preview.body.data!.legs,
        basis: preview.body.data!.basis,
        images: [[{ bytes: JPEG, contentType: "image/jpeg" }]],
      }),
    ).rejects.toThrow();

    expect(await databaseState()).toEqual(before);
    // No picture and no directory named after the rolled-back activity; the shared trip/day ones may stay.
    expect(entries().filter((entry) => !entriesBefore.has(entry) && /day-plan-items[\\/]./.test(entry))).toEqual([]);
  });

  it("refuses a viewer and an ADMIN viewer with 403, a stranger with 404 and a missing CSRF token with 403", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    const body = applyBodyFrom("walking", [harbour], preview.body.data!);
    const viewer = await addMember(trip.id, "VIEWER");
    const admin = await addMember(trip.id, "VIEWER", "ADMIN");
    const stranger = await seedTrip("stranger@example.com");

    for (const { session: other } of [viewer, admin]) {
      expect((await postPreview(trip.id, day2.id, other, { mode: "walking", suggestions: [harbour] })).body.error?.code).toBe("forbidden");
      const refused = await postApply(trip.id, day2.id, other, body);
      expect(refused.status).toBe(403);
      expect(refused.body.error?.code).toBe("forbidden");
    }
    expect((await postApply(trip.id, day2.id, stranger.session, body)).status).toBe(404);
    expect((await postApply(trip.id, day2.id, session, body, "")).status).toBe(403);
    expect((await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] }, "")).status).toBe(403);
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("lets a contributor apply", async () => {
    const { trip, day2 } = await seedTrip();
    const contributor = await addMember(trip.id, "CONTRIBUTOR");
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, contributor.session, { mode: "walking", suggestions: [harbour] });
    const applied = await postApply(trip.id, day2.id, contributor.session, applyBodyFrom("walking", [harbour], preview.body.data!));
    expect(applied.status).toBe(200);
  });

  it("refuses a body with a suggestion out of bounds, legs that do not match, or a car leg without a distance", async () => {
    const { trip, day2, session } = await seedTrip();
    const basis = { afterItemId: null, fingerprint: "items:0" };
    const leg = { durationMinutes: 5, distanceKm: 1 };
    const refused = async (body: unknown) => (await postApply(trip.id, day2.id, session, body)).status;
    expect(await refused({ mode: "car", suggestions: [{ ...harbour, durationMinutes: 601 }], legs: [leg], basis })).toBe(400);
    expect(await refused({ mode: "car", suggestions: [harbour], legs: [], basis })).toBe(400);
    expect(await refused({ mode: "car", suggestions: [harbour], legs: [{ durationMinutes: 5, distanceKm: null }], basis })).toBe(400);
    expect(await refused({ mode: "car", suggestions: Array.from({ length: 9 }, () => harbour), legs: Array(9).fill(leg), basis })).toBe(400);
    expect(await refused({ mode: "car", suggestions: [], legs: [], basis })).toBe(400);
    expect(CSRF).toBeTruthy();
  });
});

describe("POST …/suggestions/apply with parked suggestions (Story 14.3)", () => {
  const dayState = async (tripDayId: string) => ({
    items: await prisma.dayPlanItem.findMany({ where: { tripDayId }, orderBy: { id: "asc" } }),
    legs: await prisma.travelSegment.findMany({ where: { tripDayId }, orderBy: { id: "asc" } }),
  });

  it("schedules the scheduled ones as 13.4 does and parks the others to the bucket list with their pictures", async () => {
    const { trip, day2, westStay, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    // Only the scheduled one goes through the preview, as the dialog sends it.
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    const parkedMuseum = { ...museum, durationMinutes: 43 };

    const applied = await postApply(trip.id, day2.id, session, {
      ...applyBodyFrom("walking", [harbour], preview.body.data!),
      parked: [parkedMuseum],
    });

    expect(applied.status).toBe(200);
    expect(getDayRouteFromOsrm).toHaveBeenCalledTimes(1);
    // One download for both lists, the scheduled ones first.
    expect(vi.mocked(downloadSuggestionImages)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadSuggestionImages).mock.calls[0][0]).toEqual([harbour.images, museum.images]);

    const dayItems = await prisma.dayPlanItem.findMany({ where: { tripDayId: day2.id } });
    expect(dayItems.map(({ title, fromTime, toTime, sortOrder }) => ({ title, fromTime, toTime, sortOrder }))).toEqual([
      { title: "Old Harbour", ...preview.body.data!.rows[0]!, sortOrder: 0 },
    ]);
    const legs = await prisma.travelSegment.findMany();
    expect(legs.map(({ fromItemId, toItemId }) => [fromItemId, toItemId])).toEqual([[westStay.id, dayItems[0].id]]);

    const parked = await prisma.dayPlanItem.findMany({ where: { tripId: trip.id, tripDayId: null } });
    expect(parked).toHaveLength(1);
    const [row] = parked;
    expect({
      title: row.title,
      scheduleMode: row.scheduleMode,
      fromTime: row.fromTime,
      toTime: row.toTime,
      sortOrder: row.sortOrder,
      durationMinutes: row.durationMinutes,
      locationLabel: row.locationLabel,
      locationLat: row.locationLat,
      locationLng: row.locationLng,
    }).toEqual({
      title: "Tile Museum",
      scheduleMode: "FLEXIBLE",
      fromTime: null,
      toTime: null,
      sortOrder: 0,
      // Rounded up to five minutes, as a scheduled suggestion's.
      durationMinutes: 45,
      locationLabel: "Museu, Porto",
      locationLat: 41.15,
      locationLng: -8.61,
    });
    expect(parsePlanText(row.contentJson)).toBe("Azulejos from five centuries.");
    expect(legs.some((leg) => leg.fromItemId === row.id || leg.toItemId === row.id)).toBe(false);

    const parkedImages = await prisma.dayPlanItemImage.findMany({ where: { dayPlanItemId: row.id } });
    expect(parkedImages).toHaveLength(1);
    expect(parkedImages[0].sortOrder).toBe(1);
    expect(parkedImages[0].imageUrl).toMatch(new RegExp(`^/uploads/trips/${trip.id}/parked/day-plan-items/${row.id}/img-.+\\.jpg$`));
    expect(fs.existsSync(resolveStoredMediaPath(parkedImages[0].imageUrl))).toBe(true);

    const edited = applied.body.data!.receipt.edited;
    expect(edited.kind).toBe("suggestionsApplied");
    if (edited.kind !== "suggestionsApplied") return;
    expect(edited.items).toEqual([{ itemId: dayItems[0].id, updatedAt: dayItems[0].updatedAt.toISOString() }]);
    expect(edited.parkedItems).toEqual([{ itemId: row.id, updatedAt: row.updatedAt.toISOString() }]);
    expect(edited.imageIds).toEqual(expect.arrayContaining([parkedImages[0].id]));
    expect(edited.imageIds).toHaveLength(3);
  });

  it("writes the 13.4 receipt, without a parkedItems key, when nothing is parked", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });

    const applied = await postApply(trip.id, day2.id, session, { ...applyBodyFrom("walking", [harbour], preview.body.data!), parked: [] });

    expect(applied.status).toBe(200);
    expect("parkedItems" in applied.body.data!.receipt.edited).toBe(false);
  });

  it("parks everything without touching the day, even when the day changed since the dialog opened", async () => {
    const { trip, day2, session } = await seedTrip();
    const lunch = await createActivity(day2.id, "Lunch", "12:00", "13:00", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([3, 900]));
    // A preview and then a change of the day: a scheduled apply of it would answer 409.
    await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    await prisma.dayPlanItem.update({ where: { id: lunch.id }, data: { toTime: "13:30" } });
    vi.mocked(getDayRouteFromOsrm).mockClear();
    const before = await dayState(day2.id);

    const applied = await postApply(trip.id, day2.id, session, {
      mode: "walking",
      suggestions: [],
      legs: [],
      basis: null,
      parked: [harbour, museum],
    });

    expect(applied.status).toBe(200);
    expect(getDayRouteFromOsrm).not.toHaveBeenCalled();
    expect(await dayState(day2.id)).toEqual(before);
    const parked = await prisma.dayPlanItem.findMany({ where: { tripId: trip.id, tripDayId: null }, orderBy: { createdAt: "asc" } });
    expect(parked.map((row) => row.title)).toEqual(["Old Harbour", "Tile Museum"]);
    const receipt = applied.body.data!.receipt;
    expect(receipt.tripDayId).toBe(day2.id);
    expect(receipt.movedItems).toEqual([]);
    expect(receipt.removedTravelSegments).toEqual([]);
    expect(receipt.edited).toEqual({
      kind: "suggestionsApplied",
      items: [],
      segments: [],
      imageIds: expect.any(Array),
      parkedItems: parked.map((row) => ({ itemId: row.id, updatedAt: row.updatedAt.toISOString() })),
    });
  });

  it("refuses an all-parked apply by a viewer at the route and in the repository, and writes nothing", async () => {
    const { trip, day2 } = await seedTrip();
    const viewer = await addMember(trip.id, "VIEWER");
    const stranger = await seedTrip("stranger@example.com");
    const body = { mode: "walking", suggestions: [], legs: [], basis: null, parked: [harbour] };
    const before = await databaseState();

    const refused = await postApply(trip.id, day2.id, viewer.session, body);
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe("forbidden");
    expect((await postApply(trip.id, day2.id, stranger.session, body)).status).toBe(404);
    const receipt = await applySuggestionsForTripDay({
      origin: "user",
      userId: viewer.user.id,
      tripId: trip.id,
      tripDayId: day2.id,
      mode: "walking",
      suggestions: [],
      legs: [],
      basis: null,
      images: [],
      parked: [harbour],
      parkedImages: [[]],
    });
    expect(receipt).toBeNull();
    expect(await databaseState()).toEqual(before);
  });

  it("refuses more than 8 together, none at all, a missing basis and a basis with nothing scheduled", async () => {
    const { trip, day2, session } = await seedTrip();
    const basis = { afterItemId: null, fingerprint: "items:0" };
    const leg = { durationMinutes: 5, distanceKm: 1 };
    const before = await databaseState();
    const refused = async (body: unknown) => {
      const response = await postApply(trip.id, day2.id, session, body);
      return [response.status, response.body.error?.code];
    };
    const invalid = [400, "validation_error"];
    expect(
      await refused({
        mode: "walking",
        suggestions: Array.from({ length: 5 }, () => harbour),
        legs: Array(5).fill(leg),
        basis,
        parked: Array.from({ length: 4 }, () => museum),
      }),
    ).toEqual(invalid);
    expect(await refused({ mode: "walking", suggestions: [], legs: [], basis: null, parked: [] })).toEqual(invalid);
    expect(await refused({ mode: "walking", suggestions: [harbour], legs: [leg], basis: null, parked: [museum] })).toEqual(invalid);
    expect(await refused({ mode: "walking", suggestions: [], legs: [], basis, parked: [museum] })).toEqual(invalid);
    expect(await refused({ mode: "walking", suggestions: [], legs: [], basis: null, parked: Array(9).fill(museum) })).toEqual(invalid);
    expect(await databaseState()).toEqual(before);
    expect(downloadSuggestionImages).not.toHaveBeenCalled();
  });
});
