import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/[id]/days/[dayId]/print/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (tripId: string, dayId: string, session?: string) => {
  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = `session=${session}`;
  }
  return new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/print`, {
    method: "GET",
    headers,
  });
};

describe("GET /api/trips/[id]/days/[dayId]/print", () => {
  beforeEach(async () => {
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    // Story 9.2. Documents cascade from their parents, but this list is FK-ordered explicitly so a suite
    // that starts creating them cannot be broken by the order the parents are removed in.
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("rejects unauthenticated calls with 401", async () => {
    const response = await GET(buildRequest("trip-1", "day-1"), {
      params: Promise.resolve({ id: "trip-1", dayId: "day-1" }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  it("returns 404 for a non-member requesting another user's trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "print-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "print-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: other.id, role: other.role });
    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Private Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const response = await GET(buildRequest(trip.id, day.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });

    expect(response.status).toBe(404);
  });

  it("allows owner to access the print payload", async () => {
    const user = await prisma.user.create({
      data: { email: "print-owner2@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Owner Trip",
      startDate: "2026-09-10T00:00:00.000Z",
      endDate: "2026-09-11T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });

    const response = await GET(buildRequest(trip.id, day.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{ trip: { id: string }; day: { id: string } }>;

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.trip.id).toBe(trip.id);
    expect(body.data?.day.id).toBe(day.id);
  });

  it("allows a viewer member to access the print payload", async () => {
    const owner = await prisma.user.create({
      data: { email: "print-share-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "print-viewer@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Shared Trip",
      startDate: "2026-09-15T00:00:00.000Z",
      endDate: "2026-09-15T00:00:00.000Z",
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const response = await GET(buildRequest(trip.id, day.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{ trip: { id: string }; day: { id: string } }>;

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.trip.id).toBe(trip.id);
  });

  it("allows a contributor member to access the print payload", async () => {
    const owner = await prisma.user.create({
      data: { email: "print-share-owner2@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "print-contributor@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Contrib Trip",
      startDate: "2026-09-20T00:00:00.000Z",
      endDate: "2026-09-20T00:00:00.000Z",
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const response = await GET(buildRequest(trip.id, day.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{ trip: { id: string } }>;

    expect(response.status).toBe(200);
    expect(body.data?.trip.id).toBe(trip.id);
  });

  it("returns 404 when dayId belongs to a different trip owned by the same user", async () => {
    const user = await prisma.user.create({
      data: { email: "print-cross-trip@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip: trip1 } = await createTripWithDays({
      userId: user.id,
      name: "Trip One",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-01T00:00:00.000Z",
    });
    const { trip: trip2 } = await createTripWithDays({
      userId: user.id,
      name: "Trip Two",
      startDate: "2026-10-05T00:00:00.000Z",
      endDate: "2026-10-05T00:00:00.000Z",
    });
    const dayFromTrip2 = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip2.id } });

    const response = await GET(buildRequest(trip1.id, dayFromTrip2.id, session), {
      params: Promise.resolve({ id: trip1.id, dayId: dayFromTrip2.id }),
    });

    expect(response.status).toBe(404);
  });

  /**
   * Story 9.2. The route is the print sheet's only source of data, so the `documents` field has to survive
   * the JSON round trip - a payload type that carried it while the response did not would leave the sheet
   * with an appendix it can never populate, and no component test could see that.
   */
  it("serialises each entry's documents, in sortOrder, on both stay kinds and on plan items", async () => {
    const user = await prisma.user.create({
      data: { email: "print-documents@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Documented Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });
    const [day1, day2] = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });

    const previousStay = await prisma.accommodation.create({
      data: { tripDayId: day1.id, name: "Airport Hotel", status: "BOOKED" },
    });
    const currentStay = await prisma.accommodation.create({
      data: { tripDayId: day2.id, name: "City Hotel", status: "PLANNED" },
    });
    const activity = await prisma.dayPlanItem.create({
      data: { tripDayId: day2.id, title: "Museum", fromTime: "10:00", contentJson: '{"type":"doc","content":[]}' },
    });

    await prisma.accommodationDocument.create({
      data: {
        accommodationId: previousStay.id,
        documentUrl: "/uploads/trips/doc/prev.pdf",
        fileName: "Voucher.pdf",
        sortOrder: 0,
      },
    });
    await prisma.accommodationDocument.create({
      data: {
        accommodationId: currentStay.id,
        documentUrl: "/uploads/trips/doc/curr.jpg",
        fileName: "Confirmation.jpg",
        sortOrder: 0,
      },
    });
    // Created in reverse `sortOrder`, so insertion order and sort order disagree.
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: "/uploads/trips/doc/item-b.pdf",
        fileName: "Second.pdf",
        sortOrder: 1,
      },
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: "/uploads/trips/doc/item-a.jpg",
        fileName: "First.jpg",
        sortOrder: 0,
      },
    });

    const response = await GET(buildRequest(trip.id, day2.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day2.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{
      timeline: Array<
        | { kind: "previousStay" | "currentStay"; stay: { documents: Array<{ fileName: string; documentUrl: string }> } }
        | { kind: "planItem"; item: { documents: Array<{ fileName: string; documentUrl: string }> } }
        | { kind: "travelSegment" }
      >;
    }>;

    expect(response.status).toBe(200);
    const timeline = body.data!.timeline;

    const previous = timeline.find((entry) => entry.kind === "previousStay");
    expect(previous && "stay" in previous && previous.stay.documents).toEqual([
      { id: expect.any(String), documentUrl: "/uploads/trips/doc/prev.pdf", fileName: "Voucher.pdf", sortOrder: 0 },
    ]);

    const current = timeline.find((entry) => entry.kind === "currentStay");
    expect(current && "stay" in current && current.stay.documents.map((d) => d.fileName)).toEqual([
      "Confirmation.jpg",
    ]);

    const planItem = timeline.find((entry) => entry.kind === "planItem");
    expect(planItem && "item" in planItem && planItem.item.documents.map((d) => d.fileName)).toEqual([
      "First.jpg",
      "Second.pdf",
    ]);
  });

  it("serialises an empty documents array for a day whose entries carry none", async () => {
    const user = await prisma.user.create({
      data: { email: "print-no-documents@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Bare Trip",
      startDate: "2026-09-05T00:00:00.000Z",
      endDate: "2026-09-05T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Motel", status: "PLANNED" } });

    const response = await GET(buildRequest(trip.id, day.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{
      timeline: Array<{ kind: string; stay?: { documents: unknown[] } }>;
    }>;

    const stay = body.data!.timeline.find((entry) => entry.kind === "currentStay");
    // Present and empty, not missing: the sheet reads it unconditionally.
    expect(stay?.stay?.documents).toEqual([]);
  });

  /**
   * Story 10.2. The print payload carried `costCents` and none of the four currency columns, and
   * nothing in this suite asserted anything about cost at all - which is exactly how the omission
   * would have shipped invisibly behind a sheet that renders the figure but never its receipt.
   */
  it("carries the four currency columns on a stay and on a plan item", async () => {
    const user = await prisma.user.create({
      data: { email: "print-currency@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Converted Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });
    const [, day2] = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });

    await prisma.accommodation.create({
      data: {
        tripDayId: day2.id,
        name: "City Hotel",
        status: "PLANNED",
        costCents: 10774,
        costOriginalAmount: 20000,
        costCurrency: "NZD",
        costRate: 1.8563,
        costRateDate: "2026-08-28",
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        title: "Museum",
        fromTime: "10:00",
        contentJson: '{"type":"doc","content":[]}',
        costCents: 5387,
        costOriginalAmount: 10000,
        costCurrency: "NZD",
        costRate: 1.8563,
        costRateDate: "2026-08-28",
      },
    });

    const response = await GET(buildRequest(trip.id, day2.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day2.id }),
    });
    type Receipt = {
      costCents: number | null;
      costOriginalAmount: number | null;
      costCurrency: string | null;
      costRate: number | null;
      costRateDate: string | null;
    };
    const body = (await response.json()) as ApiEnvelope<{
      timeline: Array<
        | { kind: "previousStay" | "currentStay"; stay: Receipt }
        | { kind: "planItem"; item: Receipt }
        | { kind: "travelSegment" }
      >;
    }>;

    expect(response.status).toBe(200);
    const timeline = body.data!.timeline;

    const stayEntry = timeline.find((entry) => entry.kind === "currentStay") as
      | { kind: "currentStay"; stay: Receipt }
      | undefined;
    expect(stayEntry).toBeDefined();
    expect(stayEntry!.stay).toMatchObject({
      costCents: 10774,
      costOriginalAmount: 20000,
      costCurrency: "NZD",
      costRate: 1.8563,
      // A `String?` column, not a `Date` - it crosses the wire as written.
      costRateDate: "2026-08-28",
    });

    const itemEntry = timeline.find((entry) => entry.kind === "planItem") as
      | { kind: "planItem"; item: Receipt }
      | undefined;
    expect(itemEntry).toBeDefined();
    expect(itemEntry!.item).toMatchObject({
      costCents: 5387,
      costOriginalAmount: 10000,
      costCurrency: "NZD",
      costRate: 1.8563,
      costRateDate: "2026-08-28",
    });
  });
});
