import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { POST } from "@/app/api/trips/[id]/days/[dayId]/email/route";
import { MAX_PACKET_DOCUMENTS } from "@/lib/trips/packetPdf";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { clearEmailOutbox, getEmailOutbox } from "@/lib/notifications/email";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getAccommodationDocumentUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { realPdfBytes } from "./helpers/packetFixtures";
import { writeUploadFile } from "./helpers/uploadFixtures";

/**
 * Story 9.3, AC3-AC17, end to end over the day email route: real `NextRequest`, real Prisma against the
 * per-worker test db, real bytes in the per-worker media root, and the in-memory outbox `sendEmail` uses
 * outside production - so no network anywhere. Patterned on `tripDayDocumentPacketRoute.test.ts`.
 *
 * The cap and the SMTP failure each live in a file of their own, because both need a module mock and a
 * module mock is file-wide: `tripDayEmailRouteCap.test.ts`, `tripDayEmailRouteSmtpFailure.test.ts`.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type Sent = { sentTo: string; attachment: "attached" | "tooLarge" | "none" };

const CSRF = "csrf-token-day-email";

const call = (
  tripId: string,
  dayId: string,
  {
    session,
    language,
    csrf = CSRF,
    csrfHeader = csrf,
    body,
  }: { session?: string; language?: string; csrf?: string | null; csrfHeader?: string | null; body?: string } = {},
) => {
  const cookies: string[] = [];
  if (session) cookies.push(`session=${session}`);
  if (csrf) cookies.push(`csrf_token=${csrf}`);
  if (language) cookies.push(`lang=${language}`);
  const headers: Record<string, string> = {};
  if (cookies.length > 0) headers.cookie = cookies.join("; ");
  if (csrfHeader) headers["x-csrf-token"] = csrfHeader;
  if (body) headers["content-type"] = "application/json";
  const request = new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/email`, {
    method: "POST",
    headers,
    body,
  });
  return POST(request, { params: Promise.resolve({ id: tripId, dayId }) });
};

const uploadsRoot = getTripsUploadRoot();

const createOwnerDay = async (email: string, tripName = "Iceland") => {
  const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  const { trip } = await createTripWithDays({
    userId: user.id,
    name: tripName,
    startDate: "2026-08-09T00:00:00.000Z",
    endDate: "2026-08-09T00:00:00.000Z",
  });
  const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
  return { user, session, trip, day };
};

const addStayDocument = async (tripId: string, dayId: string, bytes: Uint8Array) => {
  const stay = await prisma.accommodation.create({ data: { tripDayId: dayId, name: "Hotel Vík", status: "BOOKED" } });
  const dir = getAccommodationDocumentUploadDir(tripId, dayId, stay.id);
  await writeUploadFile(dir, "doc-1.pdf", Buffer.from(bytes));
  await prisma.accommodationDocument.create({
    data: {
      accommodationId: stay.id,
      documentUrl: `/uploads/trips/${tripId}/days/${dayId}/accommodations/${stay.id}/documents/doc-1.pdf`,
      fileName: "Voucher.pdf",
      sortOrder: 0,
    },
  });
  return stay;
};

describe("POST /api/trips/[id]/days/[dayId]/email", () => {
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
    await fs.rm(uploadsRoot, { recursive: true, force: true });
    clearEmailOutbox();
  });

  it("refuses a request without a matching CSRF pair with 403 and sends nothing", async () => {
    const { session, trip, day } = await createOwnerDay("csrf@example.com");

    for (const options of [{ csrfHeader: null }, { csrf: null }, { csrfHeader: "other-token" }]) {
      const response = await call(trip.id, day.id, { session, ...options });
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("csrf_invalid");
    }
    expect(getEmailOutbox()).toEqual([]);
  });

  it("rejects unauthenticated calls with 401", async () => {
    const response = await call("trip-1", "day-1");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("unauthorized");
    expect(getEmailOutbox()).toEqual([]);
  });

  it("returns 404 not_found to a non-member and sends nothing", async () => {
    const { trip, day } = await createOwnerDay("owner@example.com");
    const other = await prisma.user.create({
      data: { email: "other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: other.id, role: other.role });

    const response = await call(trip.id, day.id, { session });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
    expect(getEmailOutbox()).toEqual([]);
  });

  it("returns 404 for a day of another trip and sends nothing", async () => {
    const { session, trip } = await createOwnerDay("cross@example.com");
    const { day: foreignDay } = await createOwnerDay("foreign@example.com");

    const response = await call(trip.id, foreignDay.id, { session });
    expect(response.status).toBe(404);
    expect(getEmailOutbox()).toEqual([]);
  });

  it("sends the day to a viewer's own address", async () => {
    const { trip, day } = await createOwnerDay("share-owner@example.com");
    const viewer = await prisma.user.create({
      data: { email: "viewer@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const session = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const response = await call(trip.id, day.id, { session });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as ApiEnvelope<Sent>).data).toEqual({
      sentTo: "viewer@example.com",
      attachment: "none",
    });
    const outbox = getEmailOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("viewer@example.com");
  });

  it("sends to the session's account even when the body names another address", async () => {
    const { session, trip, day } = await createOwnerDay("me@example.com");

    const response = await call(trip.id, day.id, {
      session,
      body: JSON.stringify({ to: "evil@example.test", email: "evil@example.test" }),
    });
    expect(response.status).toBe(200);
    const outbox = getEmailOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("me@example.com");
    expect(JSON.stringify(outbox[0])).not.toContain("evil@example.test");
  });

  it("sends a day without documents with no attachment and says so", async () => {
    const { session, trip, day } = await createOwnerDay("nodocs@example.com");

    const response = await call(trip.id, day.id, { session });
    expect(((await response.json()) as ApiEnvelope<Sent>).data?.attachment).toBe("none");
    const [mail] = getEmailOutbox();
    expect(mail.attachments).toBeUndefined();
    expect(mail.text).toContain("This day has no documents.");
    expect(mail.html).toContain("This day has no documents.");
  });

  it("writes the plan in English by default, with both parts and the day link", async () => {
    const { session, trip, day } = await createOwnerDay("english@example.com");
    await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Glacier walk", contentJson: "{}" },
    });

    await call(trip.id, day.id, { session });
    const [mail] = getEmailOutbox();
    expect(mail.subject).toBe("Day plan: Iceland, Sunday, August 9, 2026");
    const link = `http://localhost:3000/trips/${trip.id}/days/${day.id}`;
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("Glacier walk");
      expect(part).toContain("Day 1");
    }
  });

  it("writes the plan in the language of the lang cookie", async () => {
    const { session, trip, day } = await createOwnerDay("deutsch@example.com");
    // The account prefers English; the cookie says German, and the cookie wins (AC5).
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "deutsch@example.com" } })).preferredLanguage).toBe("en");

    await call(trip.id, day.id, { session, language: "de" });
    const [mail] = getEmailOutbox();
    expect(mail.subject).toBe("Tagesplan: Iceland, Sonntag, 9. August 2026");
    expect(mail.text).toContain("Tag 1");
    expect(mail.text).toContain("Dieser Tag hat keine Dokumente.");
    expect(mail.html).toContain("Diesen Tag in TravelPlan öffnen");
  });

  it("attaches the day's packet, named as the download names it", async () => {
    const { session, trip, day } = await createOwnerDay("attach@example.com", "Ring Road 2026");
    await addStayDocument(trip.id, day.id, await realPdfBytes(2));

    const response = await call(trip.id, day.id, { session });
    expect(((await response.json()) as ApiEnvelope<Sent>).data).toEqual({
      sentTo: "attach@example.com",
      attachment: "attached",
    });
    const [mail] = getEmailOutbox();
    expect(mail.attachments).toHaveLength(1);
    const [attachment] = mail.attachments!;
    expect(attachment.contentType).toBe("application/pdf");
    expect(attachment.filename).toBe("ring-road-2026-day-1-documents.pdf");
    // Label page + the two source pages - the packet's shape, from the packet's code.
    const pdf = await PDFDocument.load(attachment.content);
    expect(pdf.getPageCount()).toBe(3);
    expect(mail.text).toContain("The day's documents are attached as one PDF.");
  });

  it("sends without the attachment when the day has too many documents to package", async () => {
    const { session, trip, day } = await createOwnerDay("toomany@example.com");
    const planItem = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Busy", contentJson: "{}" },
    });
    // Rows only, no bytes: the count is refused before any file is opened.
    await prisma.dayPlanItemDocument.createMany({
      data: Array.from({ length: MAX_PACKET_DOCUMENTS + 1 }, (_unused, index) => ({
        dayPlanItemId: planItem.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${planItem.id}/documents/doc-${index}.pdf`,
        fileName: `Ticket ${index}.pdf`,
        sortOrder: index,
      })),
    });

    const response = await call(trip.id, day.id, { session });
    expect(response.status).toBe(200);
    expect(((await response.json()) as ApiEnvelope<Sent>).data?.attachment).toBe("tooLarge");
    const [mail] = getEmailOutbox();
    expect(mail.attachments).toBeUndefined();
    expect(mail.text).toContain("too large for email");
  });

  it("escapes a hostile title in the HTML part and keeps it raw in the text part", async () => {
    const hostile = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;
    const { session, trip, day } = await createOwnerDay("hostile@example.com", hostile);
    await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: hostile, contentJson: "{}" },
    });

    await call(trip.id, day.id, { session });
    const [mail] = getEmailOutbox();
    expect(mail.text).toContain(hostile);
    expect(mail.html).not.toContain("<script");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=alert(2)&gt;");
  });
});
