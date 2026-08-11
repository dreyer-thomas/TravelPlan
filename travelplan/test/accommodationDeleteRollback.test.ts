import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * Story 8.5 AC1 — the *atomicity* half of `deleteAccommodationForTripDay`, and nothing else.
 *
 * The repository's docblock sells a specific guarantee: "One transaction, so a failed sweep fails the
 * delete rather than committing half of it." Nothing pinned it. The stay row is deleted first and the
 * segment sweep runs after it, so a sweep that throws is exactly the case where the promise is worth
 * something — without the transaction the user would be left with the stay gone and its travel legs
 * still in place, which is `DW-79`'s defect with an extra step rather than its fix.
 *
 * **Its own file because the branch is unreachable without a mock**, the same reason
 * `test/tripDayImageRollback.test.ts` and `test/tripImportRollback.test.ts` are their own files. The
 * sweep is a `findMany` plus a `deleteMany` over rows this test has just created; there is no input
 * that makes it fail. So the helper is made to throw, and `vi.mock` is per-module for a whole file —
 * doing it inside `accommodationRepo.test.ts` would put every other case in that suite behind a mocked
 * segment sweep.
 */
const removeSegments = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/travelSegmentRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/travelSegmentRepo")>(
    "@/lib/repositories/travelSegmentRepo",
  );
  return {
    ...actual,
    removeTravelSegmentsReferencingItemInTransaction: (...args: unknown[]) => removeSegments(...args),
  };
});

const { deleteAccommodationForTripDay } = await import("@/lib/repositories/accommodationRepo");

describe("stay deletion is atomic with its travel-segment sweep", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    removeSegments.mockReset();
  });

  it("leaves the accommodation and its segments in place when the sweep throws", async () => {
    const user = await prisma.user.create({
      data: { email: "stay-rollback@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Rollback Trip",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 },
    });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Doomed Stay", status: "PLANNED" },
    });
    const morning = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, title: "Morning", contentJson: "{}" },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: morning.id,
        toItemType: "ACCOMMODATION",
        toItemId: stay.id,
        transportType: "CAR",
        durationMinutes: 45,
      },
    });

    // The sweep runs *after* `tx.accommodation.delete`, so this is the moment the stay is already gone
    // inside the transaction and only the rollback can bring it back.
    removeSegments.mockRejectedValue(new Error("sweep failed"));

    await expect(
      deleteAccommodationForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id }),
    ).rejects.toThrow("sweep failed");

    // Neither half committed: no stay deleted without its legs, and no legs deleted without the stay.
    expect(await prisma.accommodation.count()).toBe(1);
    expect(await prisma.accommodation.findUnique({ where: { id: stay.id } })).not.toBeNull();
    expect(await prisma.travelSegment.count()).toBe(1);
  });

  it("commits both halves when the sweep succeeds", async () => {
    const user = await prisma.user.create({
      data: { email: "stay-rollback-ok@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Commit Trip",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 },
    });
    await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Fine Stay", status: "PLANNED" },
    });

    // The control for the case above: the same call, the same mock, only the outcome differs — so a
    // rollback assertion cannot pass merely because the delete never ran.
    removeSegments.mockResolvedValue([]);

    await expect(
      deleteAccommodationForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id }),
    ).resolves.toBe(true);
    expect(await prisma.accommodation.count()).toBe(0);
    expect(removeSegments).toHaveBeenCalledTimes(1);
    // Trip-scoped, and with the enum member the stay path owns (`DW-215`: one helper, both members).
    expect(removeSegments.mock.calls[0][2]).toBe("ACCOMMODATION");
    expect(removeSegments.mock.calls[0][1]).toEqual([day.id]);
  });
});
