import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The real production path (`usesSmtp()` true), with nodemailer's transport mocked to fail - the shape
// 8.8's review asked for. File-wide mock, hence a file of its own. `mail-composer` is left real: it is
// what measures the mail, and it opens no connection.
const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));
  return { createTransport, sendMail };
});
vi.mock("nodemailer", () => ({ default: { createTransport }, createTransport }));

import { POST } from "@/app/api/trips/[id]/days/[dayId]/email/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getAccommodationDocumentUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { realPdfBytes } from "./helpers/packetFixtures";
import { writeUploadFile } from "./helpers/uploadFixtures";

const SENTINEL_PASS = "pw-sentinel-93a7";
const ADDRESS = "traveller@example.com";
const TRIP_NAME = "Secret Island Trip";

describe("POST /api/trips/[id]/days/[dayId]/email - SMTP failure in production", () => {
  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
    createTransport.mockClear();
    sendMail.mockReset();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "smtp.strato.de");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_USER", "webmaster@dreyer-travels.de");
    vi.stubEnv("SMTP_PASS", SENTINEL_PASS);
    vi.stubEnv("MAIL_FROM", "TravelPlan <system@plan.dreyer-travels.de>");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 502 email_failed and logs nothing but code, reply code and an address-blanked message", async () => {
    const user = await prisma.user.create({ data: { email: ADDRESS, passwordHash: "hashed", role: "OWNER" } });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: TRIP_NAME,
      startDate: "2026-08-09T00:00:00.000Z",
      endDate: "2026-08-09T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const stay = await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Hotel", status: "BOOKED" } });
    await writeUploadFile(
      getAccommodationDocumentUploadDir(trip.id, day.id, stay.id),
      "doc-1.pdf",
      Buffer.from(await realPdfBytes(1)),
    );
    await prisma.accommodationDocument.create({
      data: {
        accommodationId: stay.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${stay.id}/documents/doc-1.pdf`,
        fileName: "Voucher.pdf",
        sortOrder: 0,
      },
    });

    sendMail.mockRejectedValue(
      Object.assign(new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${ADDRESS}>: Recipient unknown`), {
        code: "EENVELOPE",
        responseCode: 550,
        command: `AUTH PLAIN ${SENTINEL_PASS}`,
        response: `550 5.1.1 <${ADDRESS}>: Recipient unknown`,
        rejected: [ADDRESS],
      }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/days/${day.id}/email`, {
        method: "POST",
        headers: { cookie: `session=${session}; csrf_token=tok`, "x-csrf-token": "tok" },
      }),
      { params: Promise.resolve({ id: trip.id, dayId: day.id }) },
    );

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("email_failed");

    // It really went down the SMTP path, with the attachment, to the session's address.
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = sendMail.mock.calls[0][0] as { to: string; html: string; attachments: unknown[] };
    expect(sent.to).toBe(ADDRESS);
    expect(sent.html).toContain(TRIP_NAME);
    expect(sent.attachments).toHaveLength(1);

    expect(errorLog).toHaveBeenCalledWith("day email POST: mail not sent", {
      code: "EENVELOPE",
      responseCode: 550,
      message: "Can't send mail - all recipients were rejected: 550 5.1.1 <<address>>: Recipient unknown",
    });
    const logged = JSON.stringify(errorLog.mock.calls);
    for (const secret of [ADDRESS, SENTINEL_PASS, "AUTH PLAIN", TRIP_NAME, sent.html, "Day plan", "Voucher"]) {
      expect(logged, secret).not.toContain(secret);
    }
  });
});
