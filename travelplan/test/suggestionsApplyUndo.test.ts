import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";
import { downloadSuggestionImages } from "@/lib/trips/suggestionImageDownload";
import { resolveStoredMediaPath } from "@/lib/trips/uploadPaths";
import {
  JPEG,
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
 * Story 12.4 AC7/AC8. *Rückgängig* after an apply of suggestions: one request takes every activity, leg,
 * picture row and picture file back and restores a swept leg, or refuses (`409 undo_stale`) when the day
 * has moved on, writing nothing.
 */

const picture = (name: string) => ({
  thumbnailUrl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/250px-${name}`,
  originalUrl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
});

const harbour = suggestion({ title: "Old Harbour", lng: -8.63, images: [picture("Harbour.jpg"), picture("Quay.jpg")] });
const museum = suggestion({ title: "Tile Museum", lng: -8.61, durationMinutes: 45, images: [picture("Tiles.jpg")] });

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getDayRouteFromOsrm).mockResolvedValue({
    polyline: [],
    distanceMeters: 9000,
    durationSeconds: 1200,
    legs: [
      { durationSeconds: 300, distanceMeters: 1000 },
      { durationSeconds: 600, distanceMeters: 2000 },
    ],
  });
  vi.mocked(downloadSuggestionImages).mockImplementation(async (groups) =>
    groups.map((images) => images.map(() => ({ bytes: JPEG, contentType: "image/jpeg" }))),
  );
});

/** Day 2 with Lunch → tonight's stay, then two suggestions applied after Lunch (sweeping that leg). */
const applyTwo = async () => {
  const seeded = await seedTrip();
  const { trip, day2, eastStay, session } = seeded;
  const lunch = await createActivity(day2.id, "Lunch", "12:00", "13:00", { lat: 41.15, lng: -8.64 });
  await prisma.travelSegment.create({
    data: {
      tripDayId: day2.id,
      fromItemType: "DAY_PLAN_ITEM",
      fromItemId: lunch.id,
      toItemType: "ACCOMMODATION",
      toItemId: eastStay.id,
      transportType: "CAR",
      durationMinutes: 15,
      distanceKm: 4,
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      updatedAt: new Date("2026-01-02T03:04:05.678Z"),
    },
  });
  const before = await databaseState();
  const preview = await postPreview(trip.id, day2.id, session, { mode: "walking", suggestions: [museum, harbour] });
  const applied = await postApply(trip.id, day2.id, session, applyBodyFrom("walking", [museum, harbour], preview.body.data!));
  expect(applied.status).toBe(200);
  const receipt = applied.body.data!.receipt;
  if (receipt.edited.kind !== "suggestionsApplied") throw new Error("expected a suggestionsApplied receipt");
  return { ...seeded, lunch, before, receipt, edited: receipt.edited };
};

describe("undo of an apply of suggestions (Story 12.4)", () => {
  it("removes every activity, leg, picture row and file, and restores the swept leg", async () => {
    const { trip, session, before, receipt, edited } = await applyTwo();
    expect(edited.items).toHaveLength(2);
    expect(edited.segments).toHaveLength(2);
    expect(receipt.removedTravelSegments).toHaveLength(1);
    const files = (await prisma.dayPlanItemImage.findMany()).map((image) => resolveStoredMediaPath(image.imageUrl));
    expect(files).toHaveLength(3);
    files.forEach((file) => expect(fs.existsSync(file)).toBe(true));

    const undone = await postUndo(trip.id, session, receipt);

    expect(undone.status).toBe(200);
    expect(await databaseState()).toEqual(before);
    files.forEach((file) => expect(fs.existsSync(file)).toBe(false));
    // Each activity's own directory goes with its last file.
    new Set(files.map((file) => path.dirname(file))).forEach((dir) => expect(fs.existsSync(dir)).toBe(false));
  });

  it("refuses when an applied activity was edited since", async () => {
    const { trip, session, receipt, edited } = await applyTwo();
    await prisma.dayPlanItem.update({ where: { id: edited.items[1].itemId }, data: { title: "Renamed" } });
    const state = await databaseState();
    const undone = await postUndo(trip.id, session, receipt);
    expect(undone.status).toBe(409);
    expect(undone.body.error?.code).toBe("undo_stale");
    expect(await databaseState()).toEqual(state);
  });

  it("refuses when an applied activity gained a picture", async () => {
    const { trip, session, receipt, edited } = await applyTwo();
    await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: edited.items[0].itemId, imageUrl: `/uploads/trips/${trip.id}/x.jpg`, sortOrder: 9 },
    });
    expect((await postUndo(trip.id, session, receipt)).status).toBe(409);
  });

  it("refuses when an applied activity gained a document", async () => {
    const { trip, session, receipt, edited } = await applyTwo();
    await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: edited.items[0].itemId, documentUrl: `/uploads/trips/${trip.id}/x.pdf`, fileName: "x.pdf", sortOrder: 1 },
    });
    expect((await postUndo(trip.id, session, receipt)).status).toBe(409);
  });

  it("refuses when an applied activity gained a leg", async () => {
    const { trip, day2, eastStay, session, receipt, edited } = await applyTwo();
    await prisma.travelSegment.create({
      data: {
        tripDayId: day2.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: edited.items[1].itemId,
        toItemType: "ACCOMMODATION",
        toItemId: eastStay.id,
        transportType: "WALKING",
        durationMinutes: 9,
      },
    });
    expect((await postUndo(trip.id, session, receipt)).status).toBe(409);
  });

  it("refuses when an applied leg was changed or removed", async () => {
    const { trip, session, receipt, edited } = await applyTwo();
    await prisma.travelSegment.update({ where: { id: edited.segments[0].segmentId }, data: { durationMinutes: 30 } });
    expect((await postUndo(trip.id, session, receipt)).status).toBe(409);
  });

  it("refuses a forged receipt with 400", async () => {
    const { trip, lunch, session, receipt, edited } = await applyTwo();
    const forged = { ...receipt, edited: { ...edited, items: [...edited.items, { itemId: lunch.id, updatedAt: edited.items[0].updatedAt }] } };
    const undone = await postUndo(trip.id, session, forged);
    expect(undone.status).toBe(400);
    expect(await prisma.dayPlanItem.findUnique({ where: { id: lunch.id } })).not.toBeNull();
  });
});
