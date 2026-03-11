import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as POST_COMMENT } from "@/app/api/trips/[id]/feedback/comments/route";
import { DELETE as DELETE_COMMENT, PUT as PUT_COMMENT } from "@/app/api/trips/[id]/feedback/comments/[commentId]/route";
import { PUT as PUT_VOTE } from "@/app/api/trips/[id]/feedback/votes/route";
import { GET as GET_TRIP, PATCH as PATCH_TRIP } from "@/app/api/trips/[id]/route";
import { POST as POST_STAY } from "@/app/api/trips/[id]/accommodations/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (
  url: string,
  options?: { session?: string; csrf?: string; method?: string; body?: Record<string, unknown> },
) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }
  if (options?.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }
  return new NextRequest(url, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
};

describe("trip feedback routes", () => {
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

  it("lets a viewer read trip detail with collaboration payloads and create a comment", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Shared Trip",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-09-02T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-09-01T00:00:00.000Z"), dayIndex: 1 },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const createResponse = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session,
        csrf: "csrf-token",
        body: {
          targetType: "tripDay",
          targetId: day.id,
          body: "Looks good to me.",
        },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const createPayload = (await createResponse.json()) as ApiEnvelope<{ feedback: { comments: Array<{ body: string }> } }>;
    expect(createResponse.status).toBe(200);
    expect(createPayload.data?.feedback.comments[0]?.body).toBe("Looks good to me.");

    const detailResponse = await GET_TRIP(
      buildRequest(`http://localhost/api/trips/${trip.id}`, { session }),
      { params: { id: trip.id } },
    );
    const detailPayload = (await detailResponse.json()) as ApiEnvelope<{
      trip: { accessRole: string; feedback: { comments: unknown[] } };
      days: Array<{ id: string; feedback: { comments: Array<{ body: string }> } }>;
    }>;

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.data?.trip.accessRole).toBe("viewer");
    expect(detailPayload.data?.days[0]?.feedback.comments[0]?.body).toBe("Looks good to me.");
  });

  it("lets a viewer cast and change a vote without creating duplicate rows", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Vote Trip",
        startDate: new Date("2026-09-05T00:00:00.000Z"),
        endDate: new Date("2026-09-06T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const upResponse = await PUT_VOTE(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/votes`, {
        method: "PUT",
        session,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, value: "up" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(upResponse.status).toBe(200);

    const downResponse = await PUT_VOTE(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/votes`, {
        method: "PUT",
        session,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, value: "down" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const downPayload = (await downResponse.json()) as ApiEnvelope<{ feedback: { voteSummary: { upCount: number; downCount: number; userVote: string } } }>;

    expect(downResponse.status).toBe(200);
    expect(downPayload.data?.feedback.voteSummary).toEqual({ upCount: 0, downCount: 1, userVote: "down" });
    expect(await prisma.tripFeedbackVote.count()).toBe(1);
  });

  it("rejects votes for trip-day targets before persistence", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Vote Limits Trip",
        startDate: new Date("2026-09-05T00:00:00.000Z"),
        endDate: new Date("2026-09-06T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-09-05T00:00:00.000Z"), dayIndex: 1 },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const response = await PUT_VOTE(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/votes`, {
        method: "PUT",
        session,
        csrf: "csrf-token",
        body: { targetType: "tripDay", targetId: day.id, value: "up" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(await prisma.tripFeedbackVote.count()).toBe(0);
  });

  it("rejects votes for accommodation targets before persistence while keeping day-plan-item votes enabled", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Mixed Feedback Trip",
        startDate: new Date("2026-09-05T00:00:00.000Z"),
        endDate: new Date("2026-09-06T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-09-05T00:00:00.000Z"), dayIndex: 1 },
    });
    const stay = await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Harbor Hotel",
        status: "PLANNED",
      },
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
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const blockedResponse = await PUT_VOTE(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/votes`, {
        method: "PUT",
        session,
        csrf: "csrf-token",
        body: { targetType: "accommodation", targetId: stay.id, tripDayId: day.id, value: "up" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const blockedPayload = (await blockedResponse.json()) as ApiEnvelope<null>;

    expect(blockedResponse.status).toBe(400);
    expect(blockedPayload.error?.code).toBe("validation_error");

    const allowedResponse = await PUT_VOTE(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/votes`, {
        method: "PUT",
        session,
        csrf: "csrf-token",
        body: { targetType: "dayPlanItem", targetId: item.id, tripDayId: day.id, value: "up" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const allowedPayload = (await allowedResponse.json()) as ApiEnvelope<{
      feedback: { voteSummary: { upCount: number; downCount: number; userVote: string | null } };
    }>;

    expect(allowedResponse.status).toBe(200);
    expect(allowedPayload.data?.feedback.voteSummary).toEqual({ upCount: 1, downCount: 0, userVote: "up" });
    expect(await prisma.tripFeedbackVote.count()).toBe(1);
  });

  it("returns inaccessible-trip behavior for non-members on feedback routes", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const outsider = await prisma.user.create({ data: { email: "outsider@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Trip",
        startDate: new Date("2026-09-07T00:00:00.000Z"),
        endDate: new Date("2026-09-08T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-09-07T00:00:00.000Z"), dayIndex: 1 },
    });
    const session = await createSessionJwt({ sub: outsider.id, role: outsider.role });

    const response = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, body: "No access" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");

    const unsupportedVoteResponse = await PUT_VOTE(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/votes`, {
        method: "PUT",
        session,
        csrf: "csrf-token",
        body: { targetType: "tripDay", targetId: day.id, value: "up" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const unsupportedVotePayload = (await unsupportedVoteResponse.json()) as ApiEnvelope<null>;

    expect(unsupportedVoteResponse.status).toBe(404);
    expect(unsupportedVotePayload.error?.code).toBe("not_found");
  });

  it("keeps viewers blocked from protected core trip mutations", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Protected Trip",
        startDate: new Date("2026-09-10T00:00:00.000Z"),
        endDate: new Date("2026-09-11T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-09-10T00:00:00.000Z"), dayIndex: 1 },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const tripUpdateResponse = await PATCH_TRIP(
      buildRequest(`http://localhost/api/trips/${trip.id}`, {
        method: "PATCH",
        session,
        csrf: "csrf-token",
        body: {
          name: "Changed",
          startDate: "2026-09-10T00:00:00.000Z",
          endDate: "2026-09-11T00:00:00.000Z",
        },
      }),
      { params: { id: trip.id } },
    );
    expect(tripUpdateResponse.status).toBe(404);

    const stayResponse = await POST_STAY(
      buildRequest(`http://localhost/api/trips/${trip.id}/accommodations`, {
        method: "POST",
        session,
        csrf: "csrf-token",
        body: {
          tripDayId: day.id,
          name: "Blocked Stay",
          status: "planned",
          costCents: null,
          link: null,
          notes: null,
        },
      }),
      { params: { id: trip.id } },
    );
    expect(stayResponse.status).toBe(404);
  });

  it("lets viewers and contributors edit their own comments and returns the updated feedback payload", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const contributor = await prisma.user.create({
      data: { email: "contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Editable Trip",
        startDate: new Date("2026-09-12T00:00:00.000Z"),
        endDate: new Date("2026-09-13T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
        { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      ],
    });

    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const contributorSession = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    const createdByViewer = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session: viewerSession,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, body: "Viewer draft" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const viewerCommentPayload = (await createdByViewer.json()) as ApiEnvelope<{ feedback: { comments: Array<{ id: string }> } }>;
    const viewerCommentId = viewerCommentPayload.data!.feedback.comments[0]!.id;

    const updatedByViewer = await PUT_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${viewerCommentId}`, {
        method: "PUT",
        session: viewerSession,
        csrf: "csrf-token",
        body: { body: "Viewer final" },
      }),
      { params: Promise.resolve({ id: trip.id, commentId: viewerCommentId }) },
    );
    const viewerUpdatePayload = (await updatedByViewer.json()) as ApiEnvelope<{ feedback: { comments: Array<{ body: string }> } }>;
    expect(updatedByViewer.status).toBe(200);
    expect(viewerUpdatePayload.data?.feedback.comments[0]?.body).toBe("Viewer final");

    const createdByContributor = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session: contributorSession,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, body: "Contributor draft" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const contributorCommentPayload = (await createdByContributor.json()) as ApiEnvelope<{
      feedback: { comments: Array<{ id: string; author: { email: string } }> };
    }>;
    const contributorCommentId = contributorCommentPayload.data!.feedback.comments.find(
      (comment) => comment.author.email === "contributor@example.com",
    )!.id;

    const updatedByContributor = await PUT_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${contributorCommentId}`, {
        method: "PUT",
        session: contributorSession,
        csrf: "csrf-token",
        body: { body: "Contributor final" },
      }),
      { params: Promise.resolve({ id: trip.id, commentId: contributorCommentId }) },
    );
    const contributorUpdatePayload = (await updatedByContributor.json()) as ApiEnvelope<{ feedback: { comments: Array<{ body: string }> } }>;
    expect(updatedByContributor.status).toBe(200);
    expect(contributorUpdatePayload.data?.feedback.comments.some((comment) => comment.body === "Contributor final")).toBe(true);
  });

  it("blocks editing another user's comment, rejects invalid bodies, and keeps non-members on not-found behavior", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const contributor = await prisma.user.create({
      data: { email: "contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const outsider = await prisma.user.create({ data: { email: "outsider@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Editable Trip",
        startDate: new Date("2026-09-14T00:00:00.000Z"),
        endDate: new Date("2026-09-15T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
        { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      ],
    });
    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const contributorSession = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const outsiderSession = await createSessionJwt({ sub: outsider.id, role: outsider.role });

    const created = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session: viewerSession,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, body: "Protected comment" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const createdPayload = (await created.json()) as ApiEnvelope<{ feedback: { comments: Array<{ id: string }> } }>;
    const commentId = createdPayload.data!.feedback.comments[0]!.id;

    const forbiddenResponse = await PUT_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${commentId}`, {
        method: "PUT",
        session: contributorSession,
        csrf: "csrf-token",
        body: { body: "Hijacked" },
      }),
      { params: Promise.resolve({ id: trip.id, commentId }) },
    );
    const forbiddenPayload = (await forbiddenResponse.json()) as ApiEnvelope<null>;
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenPayload.error?.code).toBe("forbidden");

    const invalidResponse = await PUT_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${commentId}`, {
        method: "PUT",
        session: viewerSession,
        csrf: "csrf-token",
        body: { body: "   " },
      }),
      { params: Promise.resolve({ id: trip.id, commentId }) },
    );
    const invalidPayload = (await invalidResponse.json()) as ApiEnvelope<null>;
    expect(invalidResponse.status).toBe(400);
    expect(invalidPayload.error?.code).toBe("validation_error");

    const outsiderResponse = await PUT_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${commentId}`, {
        method: "PUT",
        session: outsiderSession,
        csrf: "csrf-token",
        body: { body: "Outsider edit" },
      }),
      { params: Promise.resolve({ id: trip.id, commentId }) },
    );
    const outsiderPayload = (await outsiderResponse.json()) as ApiEnvelope<null>;
    expect(outsiderResponse.status).toBe(404);
    expect(outsiderPayload.error?.code).toBe("not_found");

    const persisted = await prisma.tripFeedbackComment.findUnique({
      where: { id: commentId },
      select: { body: true },
    });
    expect(persisted?.body).toBe("Protected comment");
  });

  it("deletes an authored comment and returns the refreshed feedback payload", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Delete Route Trip",
        startDate: new Date("2026-09-16T00:00:00.000Z"),
        endDate: new Date("2026-09-17T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const created = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session: viewerSession,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, body: "Delete me" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const createdPayload = (await created.json()) as ApiEnvelope<{ feedback: { comments: Array<{ id: string }> } }>;
    const commentId = createdPayload.data!.feedback.comments[0]!.id;

    const deleted = await DELETE_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${commentId}`, {
        method: "DELETE",
        session: viewerSession,
        csrf: "csrf-token",
      }),
      { params: Promise.resolve({ id: trip.id, commentId }) },
    );
    const deletedPayload = (await deleted.json()) as ApiEnvelope<{ feedback: { comments: Array<{ id: string }> } }>;

    expect(deleted.status).toBe(200);
    expect(deletedPayload.data?.feedback.comments).toEqual([]);
    expect(await prisma.tripFeedbackComment.findUnique({ where: { id: commentId } })).toBeNull();
  });

  it("rejects delete attempts from non-authors and non-members without mutating data", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const contributor = await prisma.user.create({ data: { email: "contributor@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const outsider = await prisma.user.create({ data: { email: "outsider@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Protected Delete Route Trip",
        startDate: new Date("2026-09-18T00:00:00.000Z"),
        endDate: new Date("2026-09-19T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
        { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      ],
    });

    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const contributorSession = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const outsiderSession = await createSessionJwt({ sub: outsider.id, role: outsider.role });

    const created = await POST_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments`, {
        method: "POST",
        session: viewerSession,
        csrf: "csrf-token",
        body: { targetType: "trip", targetId: trip.id, body: "Protected delete" },
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const createdPayload = (await created.json()) as ApiEnvelope<{ feedback: { comments: Array<{ id: string }> } }>;
    const commentId = createdPayload.data!.feedback.comments[0]!.id;

    const forbidden = await DELETE_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${commentId}`, {
        method: "DELETE",
        session: contributorSession,
        csrf: "csrf-token",
      }),
      { params: Promise.resolve({ id: trip.id, commentId }) },
    );
    const forbiddenPayload = (await forbidden.json()) as ApiEnvelope<null>;
    expect(forbidden.status).toBe(403);
    expect(forbiddenPayload.error?.code).toBe("forbidden");

    const outsiderDelete = await DELETE_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/${commentId}`, {
        method: "DELETE",
        session: outsiderSession,
        csrf: "csrf-token",
      }),
      { params: Promise.resolve({ id: trip.id, commentId }) },
    );
    const outsiderPayload = (await outsiderDelete.json()) as ApiEnvelope<null>;
    expect(outsiderDelete.status).toBe(404);
    expect(outsiderPayload.error?.code).toBe("not_found");

    const persisted = await prisma.tripFeedbackComment.findUnique({
      where: { id: commentId },
      select: { body: true },
    });
    expect(persisted?.body).toBe("Protected delete");
  });

  it("returns not-found for delete requests that reference an invalid comment id", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@example.com", passwordHash: "hashed", role: "OWNER" } });
    const viewer = await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "hashed", role: "VIEWER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Missing Comment Route Trip",
        startDate: new Date("2026-09-20T00:00:00.000Z"),
        endDate: new Date("2026-09-21T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const response = await DELETE_COMMENT(
      buildRequest(`http://localhost/api/trips/${trip.id}/feedback/comments/missing-comment`, {
        method: "DELETE",
        session: viewerSession,
        csrf: "csrf-token",
      }),
      { params: Promise.resolve({ id: trip.id, commentId: "missing-comment" }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
    expect(await prisma.tripFeedbackComment.count()).toBe(0);
  });
});
