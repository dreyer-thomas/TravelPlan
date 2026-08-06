import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { GET } from "@/app/api/trips/[id]/days/[dayId]/documents/packet/route";
import { MAX_PACKET_DOCUMENTS } from "@/lib/trips/packetPdf";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import {
  getAccommodationDocumentUploadDir,
  getDayPlanItemDocumentUploadDir,
  getTripsUploadRoot,
} from "@/lib/trips/uploadPaths";
import { encryptedPdfBytes, realJpegBytes, realPdfBytes } from "./helpers/packetFixtures";
import { writeUploadFile } from "./helpers/uploadFixtures";

/**
 * Story 9.2, AC4-AC6, end to end over the packet route: real `NextRequest`, real Prisma against the
 * per-worker test db, real bytes written into the per-worker media root (`test/setup.ts` points
 * `MEDIA_STORAGE_ROOT` at a temp directory, and the `uploadPaths` helpers are the only thing that honours
 * it - never build a path here by hand).
 *
 * Patterned on `tripDayPrintRoute.test.ts` for the access cases, because both routes must answer them the
 * same way and a divergence is what AC6 is about.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (tripId: string, dayId: string, session?: string) => {
  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = `session=${session}`;
  }
  return new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/documents/packet`, {
    method: "GET",
    headers,
  });
};

const call = (tripId: string, dayId: string, session?: string) =>
  GET(buildRequest(tripId, dayId, session), { params: Promise.resolve({ id: tripId, dayId }) });

const uploadsRoot = getTripsUploadRoot();

/** Writes one document's bytes where its stored URL says they are, and returns that URL. */
const writeAccommodationDocument = async (
  { tripId, dayId, accommodationId, fileName }: { tripId: string; dayId: string; accommodationId: string; fileName: string },
  bytes: Uint8Array,
) => {
  const dir = getAccommodationDocumentUploadDir(tripId, dayId, accommodationId);
  await writeUploadFile(dir, fileName, Buffer.from(bytes));
  return `/uploads/trips/${tripId}/days/${dayId}/accommodations/${accommodationId}/documents/${fileName}`;
};

const writePlanItemDocument = async (
  { tripId, dayId, planItemId, fileName }: { tripId: string; dayId: string; planItemId: string; fileName: string },
  bytes: Uint8Array,
) => {
  const dir = getDayPlanItemDocumentUploadDir(tripId, dayId, planItemId);
  await writeUploadFile(dir, fileName, Buffer.from(bytes));
  return `/uploads/trips/${tripId}/days/${dayId}/day-plan-items/${planItemId}/documents/${fileName}`;
};

const pageCountOf = async (response: Response) => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPageCount();
};

describe("GET /api/trips/[id]/days/[dayId]/documents/packet", () => {
  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    // The per-worker temp root only. See the header of `src/lib/trips/uploadPaths.ts` for what happened
    // the last time a suite computed this path itself.
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("rejects unauthenticated calls with 401", async () => {
    const response = await call("trip-1", "day-1");
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  it("returns 404 not_found for a non-member requesting another user's trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "packet-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "packet-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: other.id, role: other.role });
    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Private Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Hotel", status: "BOOKED" },
    });
    const documentUrl = await writeAccommodationDocument(
      { tripId: trip.id, dayId: day.id, accommodationId: stay.id, fileName: "doc-1.pdf" },
      await realPdfBytes(1),
    );
    await prisma.accommodationDocument.create({
      data: { accommodationId: stay.id, documentUrl, fileName: "Voucher.pdf", sortOrder: 0 },
    });

    const response = await call(trip.id, day.id, session);
    const body = (await response.json()) as ApiEnvelope<null>;

    // 404 and not 403, and with no bytes: a non-member must not learn that this day has documents at all.
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("not_found");
  });

  it("produces the packet for a trip member with the viewer role", async () => {
    const owner = await prisma.user.create({
      data: { email: "packet-share-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "packet-viewer@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Shared Trip",
      startDate: "2026-09-15T00:00:00.000Z",
      endDate: "2026-09-15T00:00:00.000Z",
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Hotel", status: "BOOKED" },
    });
    const documentUrl = await writeAccommodationDocument(
      { tripId: trip.id, dayId: day.id, accommodationId: stay.id, fileName: "doc-1.pdf" },
      await realPdfBytes(2),
    );
    await prisma.accommodationDocument.create({
      data: { accommodationId: stay.id, documentUrl, fileName: "Voucher.pdf", sortOrder: 0 },
    });

    const response = await call(trip.id, day.id, session);

    // Read access is the gate, not ownership: a viewer who can open the day can take its tickets offline.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(await pageCountOf(response)).toBe(3);
  });

  it("answers a day with no documents with its own no_documents code, not not_found", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-empty@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Empty Day Trip",
      startDate: "2026-09-20T00:00:00.000Z",
      endDate: "2026-09-20T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Hotel", status: "BOOKED" } });

    const response = await call(trip.id, day.id, session);
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    // The distinction AC6 turns on. `not_found` maps to "trip not found" on the client, which would send
    // the traveller looking for a trip that is perfectly fine.
    expect(body.error?.code).toBe("no_documents");
    expect(body.error?.code).not.toBe("not_found");
    expect(body.error?.message).toBeTruthy();
  });

  it("refuses a day carrying more documents than the packet limit rather than building it", async () => {
    // Story 9.1 caps documents at 10 *per entry* and nothing caps entries per day, so the day's total is
    // unbounded and each document is up to 10 MB held in memory during the merge. A read-access member
    // could otherwise OOM-kill the process from legitimate uploads. Refused, not truncated: a packet that
    // silently holds some of the day's documents while calling itself the day's documents is worse.
    const user = await prisma.user.create({
      data: { email: "packet-too-many@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Overloaded Day",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    // Seven activities of ten documents each: past the limit, and no file is written because the refusal
    // has to happen before anything is opened.
    for (let item = 0; item < 7; item += 1) {
      const planItem = await prisma.dayPlanItem.create({
        data: { tripDayId: day.id, title: `Activity ${item}`, contentJson: "{}" },
      });
      await prisma.dayPlanItemDocument.createMany({
        data: Array.from({ length: 10 }, (_unused, index) => ({
          dayPlanItemId: planItem.id,
          documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${planItem.id}/documents/doc-${index}.pdf`,
          fileName: `Ticket ${item}-${index}.pdf`,
          sortOrder: index + 1,
        })),
      });
    }

    const response = await call(trip.id, day.id, session);
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(413);
    expect(body.error?.code).toBe("too_many_documents");
    // Not the empty-day code and not the generic one: the client has to be able to say something true.
    expect(body.error?.code).not.toBe("no_documents");
    expect(body.error?.code).not.toBe("server_error");
  });

  it("accepts a day sitting exactly on the document limit, and refuses the one past it", async () => {
    // The boundary, off the constant itself. The case above only proves that *seventy* documents are
    // refused, which stays green if the comparison flips to `>=` (refusing an ordinary day of exactly 60)
    // or if the constant is changed to 10. Both directions are asserted against the same day, so nothing
    // here can pass by describing a different one.
    const user = await prisma.user.create({
      data: { email: "packet-limit-boundary@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Boundary Day",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const planItem = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, title: "Boundary activity", contentJson: "{}" },
    });

    // No bytes on disk for any of them: every document degrades to its own label page, which is what makes
    // this affordable at this count and is exactly AC5's shape. The count is the variable under test.
    const addDocuments = (count: number, from: number) =>
      prisma.dayPlanItemDocument.createMany({
        data: Array.from({ length: count }, (_unused, index) => ({
          dayPlanItemId: planItem.id,
          documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${planItem.id}/documents/doc-${from + index}.pdf`,
          fileName: `Ticket ${from + index}.pdf`,
          sortOrder: from + index,
        })),
      });

    await addDocuments(MAX_PACKET_DOCUMENTS, 0);
    const atLimit = await call(trip.id, day.id, session);
    expect(atLimit.status).toBe(200);
    expect(atLimit.headers.get("content-type")).toBe("application/pdf");
    // One label page per document and nothing else, since none of them could be read.
    expect(await pageCountOf(atLimit)).toBe(MAX_PACKET_DOCUMENTS);

    await addDocuments(1, MAX_PACKET_DOCUMENTS);
    const pastLimit = await call(trip.id, day.id, session);
    expect(pastLimit.status).toBe(413);
    expect(((await pastLimit.json()) as ApiEnvelope<null>).error?.code).toBe("too_many_documents");
  });

  it("returns 404 when the day belongs to a different trip owned by the same user", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-cross-trip@example.com", passwordHash: "hashed", role: "OWNER" },
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
    const stay = await prisma.accommodation.create({
      data: { tripDayId: dayFromTrip2.id, name: "Hotel", status: "BOOKED" },
    });
    const documentUrl = await writeAccommodationDocument(
      { tripId: trip2.id, dayId: dayFromTrip2.id, accommodationId: stay.id, fileName: "doc-1.pdf" },
      await realPdfBytes(1),
    );
    await prisma.accommodationDocument.create({
      data: { accommodationId: stay.id, documentUrl, fileName: "Voucher.pdf", sortOrder: 0 },
    });

    const response = await call(trip1.id, dayFromTrip2.id, session);
    const body = (await response.json()) as ApiEnvelope<null>;

    // The payload builder scopes the day by `{ id: dayId, tripId }`, so the mismatch is what refuses this -
    // not the access check, which passes for both trips.
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("not_found");
  });

  it("merges the day's documents in timeline order, with a label page before each", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-order@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Rome & Back!",
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });
    const [day1, day2] = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });

    const previousStay = await prisma.accommodation.create({
      data: { tripDayId: day1.id, name: "Airport Hotel", status: "BOOKED" },
    });
    const currentStay = await prisma.accommodation.create({
      data: { tripDayId: day2.id, name: "Hotel Roma", status: "BOOKED" },
    });
    // Created out of chronological order, so `compareDayPlanItemsByStartTime` has something to do.
    const afternoon = await prisma.dayPlanItem.create({
      data: { tripDayId: day2.id, title: "Colosseum", fromTime: "15:00", contentJson: '{"type":"doc","content":[]}' },
    });
    const morning = await prisma.dayPlanItem.create({
      data: { tripDayId: day2.id, title: "Vatican", fromTime: "09:00", contentJson: '{"type":"doc","content":[]}' },
    });

    // 3-page PDF on the previous night's stay, one image on each activity, 2-page PDF on tonight's stay.
    await prisma.accommodationDocument.create({
      data: {
        accommodationId: previousStay.id,
        documentUrl: await writeAccommodationDocument(
          { tripId: trip.id, dayId: day1.id, accommodationId: previousStay.id, fileName: "doc-1.pdf" },
          await realPdfBytes(3),
        ),
        fileName: "Airport voucher.pdf",
        sortOrder: 0,
      },
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: morning.id,
        documentUrl: await writePlanItemDocument(
          { tripId: trip.id, dayId: day2.id, planItemId: morning.id, fileName: "doc-1.jpg" },
          realJpegBytes({ width: 800, height: 1200 }),
        ),
        fileName: "Vatican ticket.jpg",
        sortOrder: 0,
      },
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: afternoon.id,
        documentUrl: await writePlanItemDocument(
          { tripId: trip.id, dayId: day2.id, planItemId: afternoon.id, fileName: "doc-1.jpg" },
          realJpegBytes({ width: 1200, height: 800 }),
        ),
        fileName: "Colosseum ticket.jpg",
        sortOrder: 0,
      },
    });
    await prisma.accommodationDocument.create({
      data: {
        accommodationId: currentStay.id,
        documentUrl: await writeAccommodationDocument(
          { tripId: trip.id, dayId: day2.id, accommodationId: currentStay.id, fileName: "doc-1.pdf" },
          await realPdfBytes(2),
        ),
        fileName: "Hotel booking.pdf",
        sortOrder: 0,
      },
    });

    const response = await call(trip.id, day2.id, session);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    // The trip name is slugged by the shared `toSafeSlug`, so `&` and `!` are gone and the day index is the
    // payload's own.
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="rome-back-day-2-documents.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    const sizes = pdf.getPages().map((page) => ({
      width: Math.round(page.getWidth()),
      height: Math.round(page.getHeight()),
    }));

    // label, 3 copied, label, 1 portrait image, label, 1 landscape image, label, 2 copied = 11 pages, and
    // the sequence of page sizes is what pins the *order*: only the previous stay's PDF is 3 pages, only
    // tonight's is 2, and the two images differ in orientation.
    expect(sizes).toEqual([
      { width: 595, height: 842 },
      { width: 400, height: 600 },
      { width: 400, height: 600 },
      { width: 400, height: 600 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 595, height: 842 },
      { width: 400, height: 600 },
      { width: 400, height: 600 },
    ]);
  });

  it("returns 200 with every other document when one cannot be merged", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-degrade@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Degrade Trip",
      startDate: "2026-10-20T00:00:00.000Z",
      endDate: "2026-10-20T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const activity = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, title: "Flight", fromTime: "09:00", contentJson: '{"type":"doc","content":[]}' },
    });

    // A real `/Encrypt`-carrying PDF, which is how airline tickets normally arrive.
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: await writePlanItemDocument(
          { tripId: trip.id, dayId: day.id, planItemId: activity.id, fileName: "doc-1.pdf" },
          await encryptedPdfBytes(),
        ),
        fileName: "Encrypted boarding pass.pdf",
        sortOrder: 0,
      },
    });
    // A row whose file was unlinked: nothing is written for this one.
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${activity.id}/documents/doc-gone.pdf`,
        fileName: "Deleted.pdf",
        sortOrder: 1,
      },
    });
    // A hand-corrupted URL that walks out of the trip's own upload directory.
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/../../../../etc/passwd`,
        fileName: "Escape.pdf",
        sortOrder: 2,
      },
    });
    // And one that works.
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: await writePlanItemDocument(
          { tripId: trip.id, dayId: day.id, planItemId: activity.id, fileName: "doc-4.pdf" },
          await realPdfBytes(1),
        ),
        fileName: "Good ticket.pdf",
        sortOrder: 3,
      },
    });

    const response = await call(trip.id, day.id, session);

    // AC5: 200, four label-page groups, only the last carrying content. One bad ticket does not cost the
    // traveller the others, and does not reach the outer handler as a 500.
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(5);
    expect(pdf.getPages().map((page) => Math.round(page.getWidth()))).toEqual([595, 595, 595, 595, 400]);
  });

  it("reads nothing outside the trip's own upload directory", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-containment@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip: mine } = await createTripWithDays({
      userId: user.id,
      name: "Mine",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const { trip: theirs } = await createTripWithDays({
      userId: user.id,
      name: "Theirs",
      startDate: "2026-11-05T00:00:00.000Z",
      endDate: "2026-11-05T00:00:00.000Z",
    });
    const myDay = await prisma.tripDay.findFirstOrThrow({ where: { tripId: mine.id } });
    const theirDay = await prisma.tripDay.findFirstOrThrow({ where: { tripId: theirs.id } });
    const activity = await prisma.dayPlanItem.create({
      data: { tripDayId: myDay.id, title: "Probe", fromTime: "09:00", contentJson: '{"type":"doc","content":[]}' },
    });

    // A real, readable, perfectly valid PDF - but it lives under a *different* trip's directory. Access is
    // scoped per trip, so containment has to be too: a merged page here would cross the boundary the
    // access check drew, with a 200 and no log line to notice it by.
    const foreignDir = path.join(getTripsUploadRoot(), theirs.id, "days", theirDay.id);
    await writeUploadFile(foreignDir, "secret.pdf", Buffer.from(await realPdfBytes(4)));
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: `/uploads/trips/${theirs.id}/days/${theirDay.id}/secret.pdf`,
        fileName: "Someone else.pdf",
        sortOrder: 0,
      },
    });

    const response = await call(mine.id, myDay.id, session);

    expect(response.status).toBe(200);
    const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
    // One label page saying it could not be included, and none of the four pages it would have contributed.
    //
    // This pins the two containment layers *jointly*: through this surface either one alone still refuses a
    // cross-trip path, exactly as the serve route's own docblock records of its layers. The case below is
    // the one only the realpath layer can catch.
    expect(pdf.getPageCount()).toBe(1);
  });

  it("does not follow a symlink planted inside the trip's own directory", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-symlink@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Symlink Trip",
      startDate: "2026-11-10T00:00:00.000Z",
      endDate: "2026-11-10T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const activity = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, title: "Probe", fromTime: "09:00", contentJson: '{"type":"doc","content":[]}' },
    });

    // The target sits outside the uploads tree entirely. The *link* is inside the trip's own directory, so
    // the lexical layer is satisfied by construction - only realpathing the file refuses this.
    const outside = path.join(getTripsUploadRoot(), "..", "..", "outside-the-tree");
    await writeUploadFile(outside, "secret.pdf", Buffer.from(await realPdfBytes(4)));
    const linkDir = getDayPlanItemDocumentUploadDir(trip.id, day.id, activity.id);
    await fs.mkdir(linkDir, { recursive: true });
    await fs.symlink(path.join(outside, "secret.pdf"), path.join(linkDir, "doc-1.pdf"));

    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${activity.id}/documents/doc-1.pdf`,
        fileName: "Link.pdf",
        sortOrder: 0,
      },
    });

    try {
      const response = await call(trip.id, day.id, session);

      expect(response.status).toBe(200);
      const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
      expect(pdf.getPageCount()).toBe(1);
    } finally {
      // Written outside `uploadsRoot`, so `beforeEach` will not reach it.
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("names the file from the trip slug and the day index", async () => {
    const user = await prisma.user.create({
      data: { email: "packet-filename@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      // Nothing here survives `toSafeSlug`, which is what its `"trip"` fallback exists for.
      name: "!!!",
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-03T00:00:00.000Z",
    });
    const days = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
    const day3 = days[2];
    const activity = await prisma.dayPlanItem.create({
      data: { tripDayId: day3.id, title: "Ferry", fromTime: "09:00", contentJson: '{"type":"doc","content":[]}' },
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: activity.id,
        documentUrl: await writePlanItemDocument(
          { tripId: trip.id, dayId: day3.id, planItemId: activity.id, fileName: "doc-1.pdf" },
          await realPdfBytes(1),
        ),
        fileName: "Ferry.pdf",
        sortOrder: 0,
      },
    });

    const response = await call(trip.id, day3.id, session);

    expect(response.headers.get("content-disposition")).toBe('attachment; filename="trip-day-3-documents.pdf"');
  });
});
