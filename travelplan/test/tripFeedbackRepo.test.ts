import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  addTripFeedbackComment,
  deleteTripFeedbackComment,
  listTripFeedbackForUser,
  updateTripFeedbackComment,
  upsertTripFeedbackVote,
} from "@/lib/repositories/tripFeedbackRepo";

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

  it("persists comments, rejects trip-day votes, and aggregates day-plan-item votes", async () => {
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
    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }] }),
      },
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

    await expect(
      upsertTripFeedbackVote({
        userId: viewer.id,
        target: { type: "tripDay", tripId: trip.id, tripDayId: day.id },
        value: "up",
      }),
    ).rejects.toThrow("Voting is not supported for tripDay feedback targets");

    await upsertTripFeedbackVote({
      userId: viewer.id,
      target: { type: "dayPlanItem", tripId: trip.id, tripDayId: day.id, dayPlanItemId: item.id },
      value: "up",
    });
    await upsertTripFeedbackVote({
      userId: viewer.id,
      target: { type: "dayPlanItem", tripId: trip.id, tripDayId: day.id, dayPlanItemId: item.id },
      value: "down",
    });

    const feedback = await listTripFeedbackForUser(viewer.id, trip.id);
    const dayFeedback = feedback?.[`tripDay:${day.id}`];
    const itemFeedback = feedback?.[`dayPlanItem:${item.id}`];

    expect(dayFeedback?.voteSummary).toEqual({
      upCount: 0,
      downCount: 0,
      userVote: null,
    });
    expect(itemFeedback?.voteSummary).toEqual({
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

  it("updates an authored comment and returns the refreshed summary", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Editable Feedback Trip",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-09-02T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const created = await addTripFeedbackComment({
      userId: viewer.id,
      target: { type: "trip", tripId: trip.id },
      body: "Original comment",
    });

    const updated = await updateTripFeedbackComment({
      userId: viewer.id,
      tripId: trip.id,
      commentId: created!.comments[0]!.id,
      body: "Updated comment",
    });

    expect(updated).toEqual(
      expect.objectContaining({
        outcome: "updated",
        feedback: expect.objectContaining({
          targetType: "trip",
          targetId: trip.id,
          comments: [
            expect.objectContaining({
              id: created!.comments[0]!.id,
              body: "Updated comment",
            }),
          ],
        }),
      }),
    );
  });

  it("rejects attempts to edit another participant's comment without mutating it", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Protected Feedback Trip",
        startDate: new Date("2026-09-03T00:00:00.000Z"),
        endDate: new Date("2026-09-04T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
        { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      ],
    });

    const created = await addTripFeedbackComment({
      userId: viewer.id,
      target: { type: "trip", tripId: trip.id },
      body: "Viewer comment",
    });

    await expect(
      updateTripFeedbackComment({
        userId: contributor.id,
        tripId: trip.id,
        commentId: created!.comments[0]!.id,
        body: "Intrusion",
      }),
    ).resolves.toEqual({ outcome: "forbidden" });

    const persisted = await prisma.tripFeedbackComment.findUnique({
      where: { id: created!.comments[0]!.id },
      select: { body: true },
    });
    expect(persisted?.body).toBe("Viewer comment");
  });

  it("deletes an authored comment and returns the refreshed summary", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Deletable Feedback Trip",
        startDate: new Date("2026-09-05T00:00:00.000Z"),
        endDate: new Date("2026-09-06T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const created = await addTripFeedbackComment({
      userId: viewer.id,
      target: { type: "trip", tripId: trip.id },
      body: "Delete me",
    });

    const deleted = await deleteTripFeedbackComment({
      userId: viewer.id,
      tripId: trip.id,
      commentId: created!.comments[0]!.id,
    });

    expect(deleted).toEqual(
      expect.objectContaining({
        outcome: "updated",
        feedback: expect.objectContaining({
          targetType: "trip",
          targetId: trip.id,
          comments: [],
        }),
      }),
    );
    expect(await prisma.tripFeedbackComment.findUnique({ where: { id: created!.comments[0]!.id } })).toBeNull();
  });

  it("rejects attempts to delete another participant's comment without mutating it", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Protected Delete Trip",
        startDate: new Date("2026-09-07T00:00:00.000Z"),
        endDate: new Date("2026-09-08T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
        { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      ],
    });

    const created = await addTripFeedbackComment({
      userId: viewer.id,
      target: { type: "trip", tripId: trip.id },
      body: "Viewer comment",
    });

    await expect(
      deleteTripFeedbackComment({
        userId: contributor.id,
        tripId: trip.id,
        commentId: created!.comments[0]!.id,
      }),
    ).resolves.toEqual({ outcome: "forbidden" });

    const persisted = await prisma.tripFeedbackComment.findUnique({
      where: { id: created!.comments[0]!.id },
      select: { body: true },
    });
    expect(persisted?.body).toBe("Viewer comment");
  });
});
