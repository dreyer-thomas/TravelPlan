import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import os from "node:os";
import { POST } from "@/app/api/trips/import/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { buildPackage } from "./helpers/zipBuilder";
import { jpegBytes } from "./helpers/uploadFixtures";

/**
 * AC2's last path: the import itself throws something nobody anticipated.
 *
 * Its own file because the only honest way to reach the route's outer `catch` is to make the
 * repository throw, and `vi.mock` is per-module for the whole file - the same reasoning
 * `tripImportRollback.test.ts` records for mocking `importPhotos`. Doing it inside
 * `tripImportRoute.test.ts` would take every successful import in that suite down with it.
 *
 * What is under test is *not* the 500. It is that the body streamed to the OS temp directory is gone
 * afterwards: a `finally` that covers the happy path and the validation rejections but not the throw
 * is the version of this that would ship and then quietly fill `/tmp` on the one day something breaks.
 */
const throwingImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/tripRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/tripRepo")>(
    "@/lib/repositories/tripRepo",
  );
  return { ...actual, importTripFromExportForUser: (...args: unknown[]) => throwingImport(...args) };
});

const STAMP = "2026-02-14T12:00:00.000Z";

const MANIFEST = {
  meta: { exportedAt: STAMP, appVersion: "0.1.0", formatVersion: 2, warnings: [] },
  photos: { p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" } },
  trip: {
    id: "source-trip",
    name: "Temp File Trip",
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-01T00:00:00.000Z",
    heroImageUrl: null,
    heroPhotoId: "p1",
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  days: [
    {
      id: "source-day-1",
      date: "2026-12-01T00:00:00.000Z",
      dayIndex: 1,
      createdAt: STAMP,
      updatedAt: STAMP,
      accommodation: null,
      dayPlanItems: [],
    },
  ],
};

const leftoverImportTempFiles = () =>
  readdirSync(os.tmpdir()).filter((name) => name.startsWith("travelplan-import-"));

describe("import temp file, when the import throws", () => {
  beforeEach(async () => {
    throwingImport.mockReset();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
  });

  it("removes the streamed upload even when the repository throws", async () => {
    const user = await prisma.user.create({
      data: { email: "import-temp-throw@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    throwingImport.mockRejectedValue(new Error("the database fell over mid-import"));

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(buildPackage(MANIFEST, [{ name: "photos/p1.jpg", data: jpegBytes() }]))], "backup.zip", {
        type: "application/zip",
      }),
    );

    const before = leftoverImportTempFiles();
    const response = await POST(
      new NextRequest("http://localhost/api/trips/import", {
        method: "POST",
        headers: { "x-csrf-token": "csrf-token", cookie: `session=${session}; csrf_token=csrf-token` },
        body: form,
      }),
    );
    const payload = (await response.json()) as { error: { code: string } | null };

    expect(response.status).toBe(500);
    expect(payload.error?.code).toBe("server_error");
    expect(throwingImport).toHaveBeenCalledTimes(1);
    expect(leftoverImportTempFiles()).toEqual(before);
  });
});
