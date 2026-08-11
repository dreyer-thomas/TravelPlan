import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getTripsUploadRoot } from "@/lib/trips/uploadPaths";

/**
 * `POST`'s `updated === null` rollback on the day-image route, and nothing else.
 *
 * **Its own file because the branch is unreachable without a mock.** `updateTripDayImageForUser` returns
 * `null` only when its lookup - carrying Story 5.13's writer clause - finds no day, and by the time the
 * handler calls it the request has already passed `refuseUnlessTripWriter` and `getTripDayByIdForUser`
 * against the same trip and the same day. So the honest way to reach it is to make the repository answer
 * `null`, and `vi.mock` is per-module for a whole file: mocking it inside `tripDayImageRoute.test.ts`
 * would take every other case in that suite down with it. `test/tripImportRollback.test.ts` exists for
 * exactly this reason and this file mirrors it.
 *
 * **Why the branch is worth a file at all (Story 8.4 / DW-194).** Its previous behaviour was
 * `fs.rm(uploadDir, { recursive: true, force: true })` - remove the whole day directory - which is the
 * parent of every stay and activity photo and every document on that day. A rollback of one failed write
 * destroyed all of them, and no test asserted anything about it. So the assertions here are the two
 * siblings as much as the `day.<ext>` the request itself wrote.
 *
 * The helper it rolls back through never throws, deliberately: `removeExistingDayImageFiles` rethrows
 * every non-`ENOENT` errno and this handler has no `try/catch`, so an `EACCES` there would escape as a
 * framework error page instead of the 404 envelope the client is owed (AC4).
 */
const updateTripDayImage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/tripRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/tripRepo")>(
    "@/lib/repositories/tripRepo",
  );
  return { ...actual, updateTripDayImageForUser: (...args: unknown[]) => updateTripDayImage(...args) };
});

const { POST } = await import("@/app/api/trips/[id]/days/[dayId]/image/route");

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("day image upload rollback", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });

    updateTripDayImage.mockReset();
    // The branch under test: the row could not be written, so the file just written must go.
    updateTripDayImage.mockResolvedValue(null);
  });

  it("removes only the day image it just wrote and answers 404 when the row cannot be updated", async () => {
    const user = await prisma.user.create({
      data: { email: "day-image-rollback@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Rollback Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    // Seeded on disk, as in the AC1 case: the file layout is the thing under test, and these two files
    // are the ones the recursive `fs.rm` took with it.
    const dayDir = path.join(uploadsRoot, trip.id, "days", day.id);
    const stayImageDir = path.join(dayDir, "accommodations", "stay-1");
    const stayDocumentDir = path.join(stayImageDir, "documents");
    await fs.mkdir(stayDocumentDir, { recursive: true });
    const stayImagePath = path.join(stayImageDir, "img-stay.webp");
    const stayDocumentPath = path.join(stayDocumentDir, "doc-ticket.pdf");
    await fs.writeFile(stayImagePath, Buffer.from("stay-photo-bytes"));
    await fs.writeFile(stayDocumentPath, Buffer.from("stay-ticket-bytes"));

    const form = new FormData();
    form.set("file", new File([Buffer.from("fake-day-image")], "cover.webp", { type: "image/webp" }));
    const response = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/days/${day.id}/image`, {
        method: "POST",
        headers: { cookie: `session=${token}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: form,
      }),
      { params: Promise.resolve({ id: trip.id, dayId: day.id }) },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    // The 404 envelope, not a framework error page: the rollback runs through a helper that never throws.
    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
    expect(updateTripDayImage).toHaveBeenCalledTimes(1);

    // The one file this request wrote is gone...
    await expect(fs.access(path.join(dayDir, "day.webp"))).rejects.toBeDefined();
    // ...and the day's other media is byte-identical, which is the assertion the old recursive removal
    // failed and nothing was checking.
    expect(await fs.readFile(stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  });
});
