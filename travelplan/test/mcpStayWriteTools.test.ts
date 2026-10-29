import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { activityWriteDeps } from "@/lib/mcp/tools/activityWrite";
import { createAccommodationForTripDay, updateAccommodationForTripDay } from "@/lib/repositories/accommodationRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import { updateDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";
import { cleanOAuthTables, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { POST } from "@/app/api/mcp/route";
import { callTool, rpc } from "./helpers/mcpClient";
import { plannerDoc } from "./helpers/plannerFixtures";
import {
  errorText,
  getDay,
  setupConnectorTrip,
  STALE_UNDO,
  storedReceipt,
  structured,
  stubNetworkSeams,
} from "./helpers/connectorWriteFixtures";

/**
 * Story 15.6. `set_stay` and `delete_stay` end to end: a real token through `POST /api/mcp`, every network
 * seam stubbed. Each write is one `ai_changes` row whose connector-only receipt (`stayCreated`, `stayUpdated`,
 * `stayDeleted`) undoes it through `undo_ai_change`.
 */

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  stubNetworkSeams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Stay = {
  id: string;
  name: string;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  place: { label: string | null; lat: number; lng: number } | null;
  link: string | null;
  notes: string | null;
  cost: { eurCents: number } | null;
  payments: { amountEurCents: number; dueDate: string }[];
  updatedAt: string;
  aiChangedAt: string | null;
};
type Day = {
  id: string;
  activities: { id: string; title: string | null; startTime: string | null; endTime: string | null }[];
  legs: { id: string }[];
  stay: Stay | null;
};
type StayResult = { aiChangeId: string; stay: Stay | null; day: Day; nextDay?: Day };

const STAY_CHANGED =
  "This stay changed since you read it; read the day again with get_day and retry with the stay's new updatedAt.";

const fullStay = (id: string) =>
  prisma.accommodation.findUniqueOrThrow({
    where: { id },
    include: {
      payments: { orderBy: { sortOrder: "asc" } },
      images: { orderBy: { sortOrder: "asc" } },
      documents: { orderBy: { sortOrder: "asc" } },
    },
  });

describe.each(["owner", "contributor"] as const)("set_stay as %s", (role) => {
  it("creates a marked stay with a cost due on the day, as one change that undo removes", async () => {
    const setup = await setupConnectorTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;

    const result = structured<StayResult>(
      await callTool(token, "set_stay", {
        tripId,
        dayId: seed.day3.id,
        name: "Riverside Inn",
        status: "booked",
        checkInTime: "15:00",
        place: { name: "Riverside", lat: 50.08, lng: 14.41 },
        cost: { amount: 240 },
        notes: "Quiet room",
      }),
    );
    expect(result.stay).toMatchObject({
      name: "Riverside Inn",
      status: "booked",
      checkInTime: "15:00",
      place: { label: "Riverside", lat: 50.08, lng: 14.41 },
      notes: "Quiet room",
      cost: { eurCents: 24000 },
      payments: [{ amountEurCents: 24000, dueDate: "2027-05-03" }],
    });
    expect(result.stay?.aiChangedAt).not.toBeNull();
    expect(result.day.stay?.id).toBe(result.stay?.id);
    expect(result).not.toHaveProperty("nextDay");

    const changes = await prisma.aiChange.findMany();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: result.aiChangeId, action: "stayCreated", subject: "Riverside Inn", tripDayId: seed.day3.id });
    const receipt = await storedReceipt(result.aiChangeId);
    expect(receipt).toMatchObject({ tripDayId: seed.day3.id, edited: { kind: "stayCreated", accommodationId: result.stay!.id } });
    const listed = structured<{ changes: { summary: string; undoable: boolean }[] }>(
      await callTool(token, "list_ai_changes", { tripId }),
    );
    expect(listed.changes[0]).toMatchObject({ summary: 'Added stay "Riverside Inn"', undoable: true });

    expect(structured(await callTool(token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toEqual({
      undone: true,
      changeId: result.aiChangeId,
    });
    expect(await prisma.accommodation.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
    expect(await prisma.costPayment.count({ where: { accommodationId: result.stay!.id } })).toBe(0);
  });

  it("pushes the next day on a later check-out, and undo restores the stay and the next day exactly", async () => {
    const setup = await setupConnectorTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;
    const day1Before = await getDay<Day>(token, tripId, seed.day1.id);
    const day2Before = await getDay<Day>(token, tripId, seed.day2.id);
    const stayBefore = await fullStay(seed.previousStay.id);
    expect(day2Before.activities[0]).toMatchObject({ title: "National Museum", startTime: "11:15" });

    const result = structured<StayResult>(
      await callTool(token, "set_stay", {
        tripId,
        dayId: seed.day1.id,
        updatedAt: day1Before.stay!.updatedAt,
        name: "Hotel Arrival Deluxe",
        checkOutTime: "12:00",
        cost: { amount: 90 },
        link: "https://arrival.example",
      }),
    );
    expect(result.stay).toMatchObject({ name: "Hotel Arrival Deluxe", checkOutTime: "12:00", link: "https://arrival.example" });
    expect(result.stay?.aiChangedAt).not.toBeNull();
    expect(result.nextDay?.id).toBe(seed.day2.id);
    expect(result.nextDay?.activities[0]).toMatchObject({ title: "National Museum", startTime: "12:15", endTime: "15:15" });

    const receipt = await storedReceipt(result.aiChangeId);
    expect(receipt.tripDayId).toBe(seed.day2.id);
    expect(receipt.edited.kind).toBe("stayUpdated");
    expect(receipt.movedItems.map((moved) => moved.itemId)).toContain(seed.museum.id);
    expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId } })).toMatchObject({
      action: "stayUpdated",
      subject: "Hotel Arrival Deluxe",
      tripDayId: seed.day1.id,
    });

    structured(await callTool(token, "undo_ai_change", { tripId, changeId: result.aiChangeId }));
    expect(await getDay<Day>(token, tripId, seed.day1.id)).toEqual(day1Before);
    expect(await getDay<Day>(token, tripId, seed.day2.id)).toEqual(day2Before);
    expect(await fullStay(seed.previousStay.id)).toEqual(stayBefore);
  });
});

describe("set_stay: refusals and the stale rule", () => {
  it("asks for updatedAt only on an existing stay, and a name only on a new one", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    expect(
      errorText(await callTool(owner.token, "set_stay", { tripId, dayId: seed.day3.id, updatedAt: new Date().toISOString(), name: "X" })),
    ).toBe("This day has no stay; leave out updatedAt to create one.");
    expect(errorText(await callTool(owner.token, "set_stay", { tripId, dayId: seed.day2.id, name: "X" }))).toBe(
      "This day already has a stay; pass its updatedAt from get_day to change it.",
    );
    expect(errorText(await callTool(owner.token, "set_stay", { tripId, dayId: seed.day3.id, status: "booked" }))).toBe(
      "name is required to create a stay.",
    );
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("refuses a stale updatedAt, and writes nothing", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const before = await fullStay(seed.stay.id);
    expect(
      errorText(
        await callTool(owner.token, "set_stay", {
          tripId: seed.trip.id,
          dayId: seed.day2.id,
          updatedAt: new Date(before.updatedAt.getTime() - 1000).toISOString(),
          name: "Renamed",
        }),
      ),
    ).toBe(STAY_CHANGED);
    expect(await fullStay(seed.stay.id)).toEqual(before);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("geocodes a place given by name, keeping the stored cost and its payments", async () => {
    const { seed, owner } = await setupConnectorTrip();
    vi.spyOn(activityWriteDeps, "geocode").mockResolvedValue({ lat: 50.1, lng: 14.5 });
    const before = await fullStay(seed.stay.id);
    const result = structured<StayResult>(
      await callTool(owner.token, "set_stay", {
        tripId: seed.trip.id,
        dayId: seed.day2.id,
        updatedAt: before.updatedAt.toISOString(),
        place: { name: "New Town" },
      }),
    );
    expect(result.stay).toMatchObject({ name: "Hotel Old Town", place: { label: "New Town", lat: 50.1, lng: 14.5 } });
    const after = await fullStay(seed.stay.id);
    expect(after.payments.map((payment) => payment.id)).toEqual(before.payments.map((payment) => payment.id));
    expect(after).toMatchObject({ costCents: 20000, costCurrency: "CZK", checkOutTime: "10:30" });
  });

  it("never upserts over a stay that appeared since the read", async () => {
    const { seed, owner } = await setupConnectorTrip();
    await expect(
      createAccommodationForTripDay({
        userId: owner.user.id,
        tripId: seed.trip.id,
        tripDayId: seed.day2.id,
        name: "Overwrite",
        status: "planned",
        origin: "ai",
        expectNoStay: true,
      }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    expect((await prisma.accommodation.findUniqueOrThrow({ where: { id: seed.stay.id } })).name).toBe("Hotel Old Town");
  });

  it("refuses the undo of a pushed check-out once a pushed activity was edited (stale)", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const day1 = await getDay<Day>(owner.token, tripId, seed.day1.id);
    const result = structured<StayResult>(
      await callTool(owner.token, "set_stay", {
        tripId,
        dayId: seed.day1.id,
        updatedAt: day1.stay!.updatedAt,
        checkOutTime: "12:00",
      }),
    );
    const edited = await updateDayPlanItemForTripDay({
      userId: owner.user.id,
      tripId,
      tripDayId: seed.day2.id,
      itemId: seed.museum.id,
      title: "Museum by hand",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 180,
      fromTime: null,
      toTime: null,
      contentJson: plannerDoc("Museum"),
      origin: "user",
    });
    expect(edited.status).toBe("updated");
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toBe(STALE_UNDO);
    expect((await prisma.accommodation.findUniqueOrThrow({ where: { id: seed.previousStay.id } })).checkOutTime).toBe("12:00");
  });

  it("loses its badge when a person saves the stay in the app, and the route answers as before", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const before = await fullStay(seed.stay.id);
    structured(
      await callTool(owner.token, "set_stay", {
        tripId: seed.trip.id,
        dayId: seed.day2.id,
        updatedAt: before.updatedAt.toISOString(),
        notes: "Marked",
      }),
    );
    expect((await fullStay(seed.stay.id)).aiChangedAt).not.toBeNull();
    const saved = await updateAccommodationForTripDay({
      userId: owner.user.id,
      tripId: seed.trip.id,
      tripDayId: seed.day2.id,
      name: "Hotel Old Town",
      status: "booked",
      origin: "user",
    });
    expect(saved.status).toBe("updated");
    expect(saved).not.toHaveProperty("receipt");
    expect((await fullStay(seed.stay.id)).aiChangedAt).toBeNull();
  });
});

describe("delete_stay", () => {
  /** Day 2's stay with a leg into it (day 2), a leg out of it (day 3), and an old orphan naming it. */
  const seedLegs = async (seed: Awaited<ReturnType<typeof setupConnectorTrip>>["seed"]) => {
    const breakfast = await prisma.dayPlanItem.create({
      data: {
        tripId: seed.trip.id,
        tripDayId: seed.day3.id,
        title: "Breakfast",
        contentJson: plannerDoc("Breakfast"),
        scheduleMode: "FLEXIBLE",
        durationMinutes: 45,
        sortOrder: 0,
        fromTime: "10:30",
        toTime: "11:15",
      },
    });
    const into = await prisma.travelSegment.create({
      data: {
        tripDayId: seed.day2.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: seed.nightWalk.id,
        toItemType: "ACCOMMODATION",
        toItemId: seed.stay.id,
        transportType: "WALKING",
        durationMinutes: 10,
        distanceKm: 0.5,
      },
    });
    const outOf = await prisma.travelSegment.create({
      data: {
        tripDayId: seed.day3.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: seed.stay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: breakfast.id,
        transportType: "CAR",
        durationMinutes: 5,
        distanceKm: 2,
        linkUrl: "https://maps.example/breakfast",
      },
    });
    // Never drawn: the stay is not the museum's neighbour.
    const orphan = await prisma.travelSegment.create({
      data: {
        tripDayId: seed.day2.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: seed.stay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: seed.museum.id,
        transportType: "BUS",
        durationMinutes: 7,
        distanceKm: null,
      },
    });
    return { breakfast, into, outOf, orphan };
  };

  it("deletes the stay with its rows and both legs, and undo restores them exactly", async () => {
    const { seed, contributor } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const { into, outOf, orphan } = await seedLegs(seed);
    const day2Before = await getDay<Day>(contributor.token, tripId, seed.day2.id);
    const day3Before = await getDay<Day>(contributor.token, tripId, seed.day3.id);
    expect(day2Before.legs.map((leg) => leg.id)).toContain(into.id);
    expect(day3Before.legs.map((leg) => leg.id)).toEqual([outOf.id]);
    const stayBefore = await fullStay(seed.stay.id);
    const legsBefore = await prisma.travelSegment.findMany({ where: { id: { in: [into.id, outOf.id] } }, orderBy: { id: "asc" } });

    const result = structured<{ aiChangeId: string; deletedStayId: string; day: Day }>(
      await callTool(contributor.token, "delete_stay", {
        tripId,
        dayId: seed.day2.id,
        updatedAt: stayBefore.updatedAt.toISOString(),
      }),
    );
    expect(result.deletedStayId).toBe(seed.stay.id);
    expect(result.day.stay).toBeNull();
    expect(await prisma.accommodation.count({ where: { id: seed.stay.id } })).toBe(0);
    expect(await prisma.accommodationImage.count({ where: { accommodationId: seed.stay.id } })).toBe(0);
    expect(await prisma.travelSegment.count({ where: { id: { in: [into.id, outOf.id, orphan.id] } } })).toBe(0);

    const receipt = await storedReceipt(result.aiChangeId);
    if (receipt.edited.kind !== "stayDeleted") throw new Error("fixture");
    expect(receipt.tripDayId).toBe(seed.day2.id);
    expect(receipt.removedTravelSegments.map((leg) => leg.id)).toEqual([into.id]);
    expect(receipt.edited.nextDayId).toBe(seed.day3.id);
    expect(receipt.edited.nextDayLegs.map((leg) => leg.id)).toEqual([outOf.id]);
    expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId } })).toMatchObject({
      action: "stayDeleted",
      subject: "Hotel Old Town",
    });

    structured(await callTool(contributor.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }));
    expect(await fullStay(seed.stay.id)).toEqual(stayBefore);
    expect(
      await prisma.travelSegment.findMany({ where: { id: { in: [into.id, outOf.id] } }, orderBy: { id: "asc" } }),
    ).toEqual(legsBefore);
    expect(await getDay<Day>(contributor.token, tripId, seed.day2.id)).toEqual(day2Before);
    expect(await getDay<Day>(contributor.token, tripId, seed.day3.id)).toEqual(day3Before);
    // The orphan was deleted as the app does, and not brought back.
    expect(await prisma.travelSegment.count({ where: { id: orphan.id } })).toBe(0);
  });

  it("refuses the undo once the day has a stay again (stale)", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const stay = await fullStay(seed.stay.id);
    const result = structured<{ aiChangeId: string }>(
      await callTool(owner.token, "delete_stay", { tripId, dayId: seed.day2.id, updatedAt: stay.updatedAt.toISOString() }),
    );
    structured(await callTool(owner.token, "set_stay", { tripId, dayId: seed.day2.id, name: "Second choice" }));
    expect(errorText(await callTool(owner.token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toBe(STALE_UNDO);
    expect((await prisma.accommodation.findUniqueOrThrow({ where: { tripDayId: seed.day2.id } })).name).toBe("Second choice");
  });

  it("refuses a stale updatedAt and a day without a stay, writing nothing", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    expect(
      errorText(
        await callTool(owner.token, "delete_stay", { tripId, dayId: seed.day2.id, updatedAt: "2020-01-01T00:00:00.000Z" }),
      ),
    ).toBe(STAY_CHANGED);
    expect(
      errorText(
        await callTool(owner.token, "delete_stay", { tripId, dayId: seed.day3.id, updatedAt: "2020-01-01T00:00:00.000Z" }),
      ),
    ).toBe("This day has no stay.");
    expect(await prisma.accommodation.count({ where: { id: seed.stay.id } })).toBe(1);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("refuses forged stay receipts as invalid", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const { outOf } = await seedLegs(seed);
    const stay = await fullStay(seed.stay.id);
    const result = structured<{ aiChangeId: string }>(
      await callTool(owner.token, "delete_stay", { tripId, dayId: seed.day2.id, updatedAt: stay.updatedAt.toISOString() }),
    );
    const receipt = await storedReceipt(result.aiChangeId);
    if (receipt.edited.kind !== "stayDeleted") throw new Error("fixture");
    const edited = receipt.edited;
    const undo = (next: DayChangeReceipt) => undoDayPlanChangeForTrip({ userId: owner.user.id, tripId, receipt: next });
    const withEdited = (changes: Partial<typeof edited>): DayChangeReceipt => ({ ...receipt, edited: { ...edited, ...changes } });
    const nextLeg = edited.nextDayLegs[0];

    expect(await undo(withEdited({ accommodationId: "other" }))).toEqual({ status: "invalid", reason: "snapshot of another stay" });
    expect(await undo(withEdited({ previous: { ...edited.previous, tripDayId: seed.day3.id } }))).toEqual({
      status: "invalid",
      reason: "stay on another day",
    });
    expect(
      await undo(withEdited({ previous: { ...edited.previous, images: edited.previous.images.map((image) => ({ ...image, accommodationId: "x" })) } })),
    ).toEqual({ status: "invalid", reason: "image of another stay" });
    expect(
      await undo(
        withEdited({
          previous: {
            ...edited.previous,
            documents: edited.previous.documents.map((document) => ({ ...document, documentUrl: "/uploads/trips/other/x.pdf" })),
          },
        }),
      ),
    ).toEqual({ status: "invalid", reason: "document outside the trip" });
    expect(
      await undo(
        withEdited({
          previous: { ...edited.previous, payments: edited.previous.payments.map((payment) => ({ ...payment, accommodationId: "x" })) },
        }),
      ),
    ).toEqual({ status: "invalid", reason: "payment of another entry" });
    expect(await undo(withEdited({ nextDayId: null }))).toEqual({ status: "invalid", reason: "next-day legs without a next day" });
    expect(await undo(withEdited({ nextDayId: seed.day2.id }))).toEqual({ status: "invalid", reason: "next day is the stay's day" });
    expect(await undo(withEdited({ nextDayLegs: [{ ...nextLeg, tripDayId: seed.day1.id }] }))).toEqual({
      status: "invalid",
      reason: "leg on another day",
    });
    expect(await undo({ ...receipt, removedTravelSegments: [{ ...nextLeg, tripDayId: seed.day2.id }] })).toEqual({
      status: "invalid",
      reason: "duplicate leg",
    });
    expect(await undo(withEdited({ nextDayLegs: [{ ...nextLeg, fromItemId: seed.previousStay.id }] }))).toEqual({
      status: "invalid",
      reason: "next-day leg not out of the stay",
    });
    expect(
      await undo({
        ...receipt,
        removedTravelSegments: receipt.removedTravelSegments.map((leg) => ({ ...leg, toItemType: "DAY_PLAN_ITEM" as const, toItemId: seed.museum.id })),
      }),
    ).toEqual({ status: "invalid", reason: "removed leg of another entry" });
    expect(nextLeg.id).toBe(outOf.id);
    expect(await prisma.accommodation.count({ where: { id: seed.stay.id } })).toBe(0);
  });
});

describe("stay tools: unstorable receipts (review)", () => {
  it("deletes nothing when the stay holds an image the undo could not restore", async () => {
    const { seed, owner } = await setupConnectorTrip();
    await prisma.accommodationImage.create({
      data: { accommodationId: seed.stay.id, imageUrl: "https://cdn.example/outside.jpg", sortOrder: 5 },
    });
    const stay = await fullStay(seed.stay.id);
    expect(
      errorText(
        await callTool(owner.token, "delete_stay", { tripId: seed.trip.id, dayId: seed.day2.id, updatedAt: stay.updatedAt.toISOString() }),
      ),
    ).toBe("This stay holds data the undo cannot keep, so nothing was written.");
    expect(await fullStay(seed.stay.id)).toEqual(stay);
    expect(await prisma.travelSegment.count({ where: { id: seed.walkLeg.id } })).toBe(1);
    expect(await prisma.aiChange.count()).toBe(0);
  });
});

describe("set_stay: description (review)", () => {
  it("says only changing an existing stay's check-out recomputes the next day", async () => {
    const { owner } = await setupConnectorTrip();
    const response = await POST(
      rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { authorization: `Bearer ${owner.token}` }),
    );
    const body = (await response.json()) as { result: { tools: { name: string; description: string }[] } };
    const setStay = body.result.tools.find((tool) => tool.name === "set_stay")!;
    expect(setStay.description).toContain("Changing an existing stay's check-out recomputes the next day");
    expect(setStay.description).toContain("creating a stay does not recompute anything");
  });
});

describe("stay tools: access", () => {
  it("answers Trip not found to a viewer, writing nothing", async () => {
    const { seed, viewer } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const stay = await fullStay(seed.stay.id);
    expect(errorText(await callTool(viewer.token, "set_stay", { tripId, dayId: seed.day3.id, name: "X" }))).toBe("Trip not found");
    expect(
      errorText(await callTool(viewer.token, "delete_stay", { tripId, dayId: seed.day2.id, updatedAt: stay.updatedAt.toISOString() })),
    ).toBe("Trip not found");
    expect(await prisma.accommodation.count({ where: { tripDayId: seed.day3.id } })).toBe(0);
    expect(await prisma.accommodation.count({ where: { id: seed.stay.id } })).toBe(1);
  });
});
