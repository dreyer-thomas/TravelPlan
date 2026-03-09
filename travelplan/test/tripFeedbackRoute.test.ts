import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as POST_COMMENT } from "@/app/api/trips/[id]/feedback/comments/route";
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
});
