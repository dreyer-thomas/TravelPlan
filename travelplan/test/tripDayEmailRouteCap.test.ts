import crypto from "node:crypto";
import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";

// 64 KB instead of 20 MB: the rule under test is "measured mail above the cap goes without the packet",
// and a test cannot afford to build a 20 MB mail to show it. File-wide, hence a file of its own.
vi.mock("@/lib/notifications/dayEmailLimits", () => ({ MAX_DAY_EMAIL_BYTES: 64 * 1024 }));

import { POST } from "@/app/api/trips/[id]/days/[dayId]/email/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { clearEmailOutbox, getEmailOutbox } from "@/lib/notifications/email";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getAccommodationDocumentUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { realPdfBytes } from "./helpers/packetFixtures";
import { writeUploadFile } from "./helpers/uploadFixtures";

/** A real, parseable PDF of roughly `bytes` bytes: random text in uncompressed content streams. */
const bulkyPdfBytes = async (bytes: number) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let written = 0;
  while (written < bytes) {
    const page = pdf.addPage([400, 600]);
    for (let line = 0; line < 50; line += 1) {
      const text = crypto.randomBytes(40).toString("hex");
      page.drawText(text, { x: 10, y: 590 - line * 11, size: 6, font });
      written += text.length * 2 + 40;
    }
  }
  return pdf.save({ useObjectStreams: false });
};

const call = async (tripId: string, dayId: string, session: string) =>
  POST(
    new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/email`, {
      method: "POST",
      headers: { cookie: `session=${session}; csrf_token=tok`, "x-csrf-token": "tok" },
    }),
    { params: Promise.resolve({ id: tripId, dayId }) },
  );

const setUpDay = async (pdf: Uint8Array) => {
  const user = await prisma.user.create({ data: { email: "cap@example.com", passwordHash: "hashed", role: "OWNER" } });
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  const { trip } = await createTripWithDays({
    userId: user.id,
    name: "Cap Trip",
    startDate: "2026-08-09T00:00:00.000Z",
    endDate: "2026-08-09T00:00:00.000Z",
  });
  const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
  const stay = await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Hotel", status: "BOOKED" } });
  await writeUploadFile(getAccommodationDocumentUploadDir(trip.id, day.id, stay.id), "doc-1.pdf", Buffer.from(pdf));
  await prisma.accommodationDocument.create({
    data: {
      accommodationId: stay.id,
      documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${stay.id}/documents/doc-1.pdf`,
      fileName: "Voucher.pdf",
      sortOrder: 0,
    },
  });
  return { session, trip, day };
};

describe("POST /api/trips/[id]/days/[dayId]/email - the size cap", () => {
  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
    clearEmailOutbox();
  });

  it("sends the mail without the packet when the finished mail would exceed the cap, and says why", async () => {
    const pdf = await bulkyPdfBytes(100 * 1024);
    // The packet alone is under the cap; base64 is what pushes the mail over it. That is the case an
    // estimate on the PDF's size would get wrong.
    expect(pdf.length).toBeGreaterThan(50 * 1024);
    const { session, trip, day } = await setUpDay(pdf);

    const response = await call(trip.id, day.id, session);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: { attachment: string } }).data.attachment).toBe("tooLarge");

    const [mail] = getEmailOutbox();
    expect(mail.attachments).toBeUndefined();
    const sentence = "The day's documents were too large for email. You can download them on the day page via the link.";
    expect(mail.text).toContain(sentence);
    expect(mail.text).not.toContain("attached as one PDF");
    expect(mail.text).toContain(`/trips/${trip.id}/days/${day.id}`);
  });

  it("still attaches a packet that fits under the cap", async () => {
    const { session, trip, day } = await setUpDay(await realPdfBytes(1));

    const response = await call(trip.id, day.id, session);
    expect(((await response.json()) as { data: { attachment: string } }).data.attachment).toBe("attached");
    expect(getEmailOutbox()[0].attachments).toHaveLength(1);
  });
});
