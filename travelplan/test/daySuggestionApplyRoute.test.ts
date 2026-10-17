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
  resetDatabase,
  seedTrip,
  suggestion,
} from "./helpers/suggestionApplyFixtures";

/**
 * Story 12.4 AC1–AC10 at the HTTP boundary, against the real test database. OSRM and the picture download
 * are mocked (never the real internet); the files land under the per-worker `MEDIA_STORAGE_ROOT`.
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
  it("orders the stops along the way, chains the times from last night's check-out and shows the legs", async () => {
    const { trip, day2, westStay, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449], [7, 1200]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [museum, harbour] });

    expect(preview.status).toBe(200);
    expect(preview.body.data).toEqual({
      order: [1, 0],
      // 09:30 + 12 → 09:45 (rounded up), + 90 → 11:15; + 7 → 11:25, + 45 → 12:10.
      rows: [
        { fromTime: "09:45", toTime: "11:15" },
        { fromTime: "11:25", toTime: "12:10" },
      ],
      legs: [
        { durationMinutes: 12, distanceKm: 8.4 },
        { durationMinutes: 7, distanceKm: 1.2 },
      ],
      basis: {
        afterItemId: null,
        startTime: "09:30",
        // No activity yet, the first leg leaves last night's stay, the stops are ordered from it, tonight's stay ends the day.
        fingerprint: `items:0|from:accommodation:${westStay.id}@41.15,-8.65|order:41.15,-8.65|end:41.15,-8.6`,
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
    expect(items.map(({ title, fromTime, toTime, locationLabel, locationLat, locationLng }) => ({
      title,
      fromTime,
      toTime,
      locationLabel,
      locationLat,
      locationLng,
    }))).toEqual([
      { title: "Old Harbour", fromTime: "09:45", toTime: "11:15", locationLabel: "Harbour, Porto", locationLat: 41.15, locationLng: -8.63 },
      { title: "Tile Museum", fromTime: "11:25", toTime: "12:10", locationLabel: "Museu, Porto", locationLat: 41.15, locationLng: -8.61 },
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

  it("starts after the last timed activity and takes the first leg from it; untimed ones are ignored", async () => {
    const { trip, day2, session } = await seedTrip();
    const lunch = await createActivity(day2.id, "Lunch", "12:00", "13:20", { lat: 41.15, lng: -8.64 });
    await createActivity(day2.id, "Someday", null, null, { lat: 41.2, lng: -8.7 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([3, 900]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });

    expect(preview.body.data).toMatchObject({
      rows: [{ fromTime: "13:25", toTime: "14:55" }],
      basis: { afterItemId: lunch.id, startTime: "13:20" },
      origin: { kind: "activity", label: "Lunch" },
    });
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].points[0]).toEqual({ lat: 41.15, lng: -8.64 });
    expect(vi.mocked(getDayRouteFromOsrm).mock.calls[0][0].profile).toBe("driving");

    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], preview.body.data!));
    expect(applied.status).toBe(200);
    const created = await prisma.dayPlanItem.findFirstOrThrow({ where: { title: "Old Harbour" } });
    // Story 13.1 §12: the apply appends after the day's last row, and the untimed one (flexible now) is
    // that row, so Lunch → Old Harbour is not drawn and no leg is created. 13.4 rewrites the apply.
    expect(created.sortOrder).toBeGreaterThan((await prisma.dayPlanItem.findFirstOrThrow({ where: { title: "Someday" } })).sortOrder);
    expect(await prisma.travelSegment.count()).toBe(0);
  });

  it("starts at the latest end on the day, with the first leg still from the timeline's last activity", async () => {
    const { trip, day2, session } = await seedTrip();
    await createActivity(day2.id, "Day tour", "09:00", "18:00", { lat: 41.16, lng: -8.62 });
    const coffee = await createActivity(day2.id, "Coffee", "10:00", "11:00", { lat: 41.15, lng: -8.64 });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([3, 900]));

    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });

    // Not 11:05: the tour runs until 18:00. The timeline still draws coffee as the new stop's neighbour.
    expect(preview.body.data).toMatchObject({
      rows: [{ fromTime: "18:05", toTime: "19:35" }],
      basis: { afterItemId: coffee.id, startTime: "18:00" },
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
    expect(preview.body.data?.basis.startTime).toBe("10:00");
    expect(preview.body.data?.rows).toEqual([{ fromTime: "10:10", toTime: "11:40" }]);
  });

  it("orders from the trip's start on the first day but creates no leg from it", async () => {
    const { trip, day1, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([20, 15000], [7, 1200]));

    const preview = await postPreview(trip.id, day1.id, session, { mode: "car", suggestions: [harbour, museum] });

    expect(preview.body.data?.origin).toEqual({ kind: "tripStart", label: "Porto Airport" });
    // No stay last night, so no check-out: the day starts at 09:00 (Tommy's ruling 1c), + 20 → 09:20.
    expect(preview.body.data?.basis.startTime).toBe("09:00");
    expect(preview.body.data?.rows[0]).toEqual({ fromTime: "09:20", toTime: "10:50" });
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

  it("warns when the appended activities reach tonight's stay after its check-in", async () => {
    const { trip, day2, eastStay, session } = await seedTrip();
    await prisma.accommodation.update({ where: { id: eastStay.id }, data: { checkInTime: "10:30" } });
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([5, 1000]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "car", suggestions: [harbour] });
    const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("car", [harbour], preview.body.data!));
    expect(applied.body.data?.receipt.checkInWarning).toEqual({ accommodationId: eastStay.id, checkInTime: "10:30" });
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
    expect(club).toMatchObject({ fromTime: null, toTime: null });
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

  it("writes nothing for a viewer even past the route, through the repository's own writer clause", async () => {
    const { trip, day2, session } = await seedTrip();
    vi.mocked(getDayRouteFromOsrm).mockResolvedValue(osrmLegs([12, 8449]));
    const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [harbour] });
    const viewer = await addMember(trip.id, "VIEWER");

    const receipt = await applySuggestionsForTripDay({
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
    const basis = { afterItemId: null, startTime: "09:30", fingerprint: "items:0" };
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
