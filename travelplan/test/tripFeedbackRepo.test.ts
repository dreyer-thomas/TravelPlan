import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addTripFeedbackComment, listTripFeedbackForUser, upsertTripFeedbackVote } from "@/lib/repositories/tripFeedbackRepo";

describe("trip feedback repository", () => {
  beforeEach(async () => {
    await prisma.tripFeedbackVote.deleteMany();
    await prisma.tripFeedbackComment.deleteMany();
    await prisma.tripFeedbackTarget.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("persists comments and aggregates votes for supported targets", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Feedback Trip",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-07-01T00:00:00.000Z"), dayIndex: 1 },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const comment = await addTripFeedbackComment({
      userId: viewer.id,
      target: { type: "tripDay", tripId: trip.id, tripDayId: day.id },
      body: "We should stay longer here.",
    });

    expect(comment).toEqual(
      expect.objectContaining({
        targetType: "tripDay",
        targetId: day.id,
      }),
    );
    expect(comment?.comments).toHaveLength(1);
    expect(comment?.comments[0]?.author.email).toBe("viewer@example.com");

    await upsertTripFeedbackVote({
      userId: viewer.id,
      target: { type: "tripDay", tripId: trip.id, tripDayId: day.id },
      value: "up",
    });
    await upsertTripFeedbackVote({
      userId: viewer.id,
      target: { type: "tripDay", tripId: trip.id, tripDayId: day.id },
      value: "down",
    });

    const feedback = await listTripFeedbackForUser(viewer.id, trip.id);
    const dayFeedback = feedback?.[`tripDay:${day.id}`];

    expect(dayFeedback?.voteSummary).toEqual({
      upCount: 0,
      downCount: 1,
      userVote: "down",
    });
    expect(await prisma.tripFeedbackVote.count()).toBe(1);
  });

  it("blocks non-members from reading or writing trip feedback", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const outsider = await prisma.user.create({
      data: { email: "outsider@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Trip",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-02T00:00:00.000Z"),
      },
    });

    await expect(listTripFeedbackForUser(outsider.id, trip.id)).resolves.toBeNull();
    await expect(
      addTripFeedbackComment({
        userId: outsider.id,
        target: { type: "trip", tripId: trip.id },
        body: "I should not see this.",
      }),
    ).resolves.toBeNull();
  });
});
