import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { routeContext } from "./helpers/routeContext";

/**
 * `POST`'s `updated === null` rollback on the hero-image route, and nothing else.
 *
 * **Its own file because the branch is unreachable without a mock.** `updateTripHeroImageForUser` returns
 * `null` only when the trip stops satisfying the writer clause between the route gate and the update, and
 * by the time the handler calls it the request has already passed `hasTripOwnerAccess` and
 * `getTripByIdForUser` against the same user and the same trip. So the honest way to reach it is to make
 * the repository answer `null`, and `vi.mock` is per-module for a whole file: mocking it inside
 * `tripHeroImageRoute.test.ts` would take the other seven cases in that suite down with it.
 * `test/tripDayImageRollback.test.ts` exists for exactly this reason and this file mirrors it.
 *
 * **Why the branch is worth a file at all (Story 8.6 / DW-305).** Its previous behaviour was
 * `fs.rm(uploadDir, { recursive: true, force: true })` where `uploadDir` is `getTripUploadDir(tripId)` -
 * the root of the trip's *entire* media tree, the parent of every day image, every stay and activity photo
 * and every document across every day. A rollback of one failed hero write destroyed all of them while
 * touching no row, and no test asserted anything about it. This is DW-194 one level broader: Story 8.4
 * excluded this route on the stated ground that it "owns a flat file, not a tree", which `:109` shows is
 * false. So the assertions here are the three siblings as much as the `hero.<ext>` the request wrote.
 *
 * The helper it now rolls back through never throws, deliberately: this handler has no `try/catch`, so an
 * `EACCES` there would escape as a framework error page instead of the 404 envelope the client is owed.
 */
const updateTripHeroImage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/tripRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/tripRepo")>(
    "@/lib/repositories/tripRepo",
  );
  return { ...actual, updateTripHeroImageForUser: (...args: unknown[]) => updateTripHeroImage(...args) };
});

const { POST } = await import("@/app/api/trips/[id]/hero-image/route");

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("hero image upload rollback", () => {
  const uploadsRoot = getTripsUploadRoot();

  /** The trip's whole media tree, seeded on disk: what the recursive removal took with it. */
  const seedSiblings = async (tripId: string, dayId: string) => {
    const dayDir = path.join(uploadsRoot, tripId, "days", dayId);
    const stayImageDir = path.join(dayDir, "accommodations", "stay-1");
    const stayDocumentDir = path.join(stayImageDir, "documents");
    await fs.mkdir(stayDocumentDir, { recursive: true });

    const dayImagePath = path.join(dayDir, "day.webp");
    const stayImagePath = path.join(stayImageDir, "img-stay.webp");
    const stayDocumentPath = path.join(stayDocumentDir, "doc-ticket.pdf");
    await fs.writeFile(dayImagePath, Buffer.from("day-image-bytes"));
    await fs.writeFile(stayImagePath, Buffer.from("stay-photo-bytes"));
    await fs.writeFile(stayDocumentPath, Buffer.from("stay-ticket-bytes"));

    return { dayImagePath, stayImagePath, stayDocumentPath };
  };

  /** Byte-identity, not existence: a cleanup that truncated these would pass an `access` check. */
  const expectSiblingsIntact = async (siblings: Awaited<ReturnType<typeof seedSiblings>>) => {
    expect(await fs.readFile(siblings.dayImagePath)).toEqual(Buffer.from("day-image-bytes"));
    expect(await fs.readFile(siblings.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(siblings.stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  };

  const seedOwnerAndTrip = async (email: string, name: string) => {
    const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name,
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    return { token, trip, day };
  };

  const postHero = async (tripId: string, token: string) => {
    const form = new FormData();
    form.set("file", new File([Buffer.from("fake-hero-image")], "hero.webp", { type: "image/webp" }));
    return POST(
      new NextRequest(`http://localhost/api/trips/${tripId}/hero-image`, {
        method: "POST",
        headers: { cookie: `session=${token}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: form,
      }),
      routeContext(tripId),
    );
  };

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

    updateTripHeroImage.mockReset();
    // The branch under test: the row could not be written, so the file just written must go.
    updateTripHeroImage.mockResolvedValue(null);
  });

  it("removes only the hero image it just wrote and answers 404 when the row cannot be updated", async () => {
    const { token, trip, day } = await seedOwnerAndTrip("hero-rollback@example.com", "Hero Rollback Trip");
    const siblings = await seedSiblings(trip.id, day.id);

    const response = await postHero(trip.id, token);
    const payload = (await response.json()) as ApiEnvelope<null>;

    // The 404 envelope, not a framework error page: the rollback runs through a helper that never throws.
    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
    expect(payload.error?.message).toBe("Trip not found");
    expect(updateTripHeroImage).toHaveBeenCalledTimes(1);

    // The one file this request wrote is gone - and gone specifically, not merely unreadable: a bare
    // `rejects` would also be satisfied by an `EACCES` or by a path this test simply spelled wrong.
    await expect(fs.access(path.join(uploadsRoot, trip.id, "hero.webp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // ...and the rest of the trip's media is byte-identical, which is the assertion the old recursive
    // removal of `getTripUploadDir(tripId)` failed and nothing was checking.
    await expectSiblingsIntact(siblings);
  });

  it("stays silent and still answers 404 when the hero file is already gone at rollback", async () => {
    const { token, trip, day } = await seedOwnerAndTrip("hero-rollback-enoent@example.com", "Hero ENOENT Trip");
    const siblings = await seedSiblings(trip.id, day.id);
    const heroPath = path.join(uploadsRoot, trip.id, "hero.webp");

    // Removed out of band in the window between the write and the rollback - the repository call is the
    // last thing that happens in it, so arming the removal there is the narrowest way to express it.
    updateTripHeroImage.mockImplementation(async () => {
      await fs.rm(heroPath);
      return null;
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await postHero(trip.id, token);
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
      expect(updateTripHeroImage).toHaveBeenCalledTimes(1);
      // `ENOENT` is the desired end state, so it is the one branch that is allowed to say nothing.
      expect(consoleSpy).not.toHaveBeenCalled();
      await expectSiblingsIntact(siblings);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("logs and still answers 404 when the rollback unlink fails with a non-ENOENT errno", async () => {
    const { token, trip, day } = await seedOwnerAndTrip("hero-rollback-eacces@example.com", "Hero EACCES Trip");
    const siblings = await seedSiblings(trip.id, day.id);
    const heroPath = path.join(uploadsRoot, trip.id, "hero.webp");

    const permissionDenied = new Error(`EACCES: permission denied, unlink '${heroPath}'`) as Error & {
      code: string;
    };
    permissionDenied.code = "EACCES";
    // `removeExistingHeroFiles` unlinks the same four candidate names *before* the write and rethrows every
    // non-`ENOENT` errno, which is correct there (nothing is committed yet) but is not the failure under
    // test. So the rejection is armed by the repository call rather than by path: only the rollback's
    // unlink happens after it.
    const realUnlink = fs.unlink;
    const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(async (target) => {
      if (updateTripHeroImage.mock.calls.length === 0) {
        return realUnlink(target);
      }
      throw permissionDenied;
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await postHero(trip.id, token);
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe("not_found");
      // Load-bearing here rather than merely tidy: the `fs.unlink` mock below is gated on this call
      // count, so a handler that called the repository twice - or not at all - would silently change
      // which unlink the mock arms while the test stayed green.
      expect(updateTripHeroImage).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "hero image upload rollback: unable to remove media file",
        expect.objectContaining({ filePath: heroPath, code: "EACCES" }),
      );
      // The failure orphans the hero file; it must still not reach anything else.
      await expectSiblingsIntact(siblings);
    } finally {
      unlinkSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});
