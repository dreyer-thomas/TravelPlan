import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { POST } from "@/app/api/trips/import/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { MAX_IMPORT_PACKAGE_BYTES } from "@/lib/trips/importLimits";
import { getTripUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { buildPackage, buildZip } from "./helpers/zipBuilder";
import { jpegBytes, pngBytes } from "./helpers/uploadFixtures";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const VALID_PAYLOAD = {
  meta: {
    exportedAt: "2026-02-14T12:00:00.000Z",
    appVersion: "0.1.0",
    formatVersion: 1,
  },
  trip: {
    id: "export-trip-1",
    name: "Imported Route Trip",
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2026-11-02T00:00:00.000Z",
    heroImageUrl: null,
    createdAt: "2026-02-14T12:00:00.000Z",
    updatedAt: "2026-02-14T12:00:00.000Z",
  },
  days: [
    {
      id: "export-day-1",
      date: "2026-11-01T00:00:00.000Z",
      dayIndex: 1,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
    },
    {
      id: "export-day-2",
      date: "2026-11-02T00:00:00.000Z",
      dayIndex: 2,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
    },
  ],
};

const buildRequest = (
  body: unknown,
  options?: { session?: string; csrf?: string; rawBody?: string; contentType?: string }
) => {
  const headers: Record<string, string> = {
    "Content-Type": options?.contentType ?? "application/json",
  };

  if (options?.csrf) {
    headers["x-csrf-token"] = options.csrf;
  }

  const cookies: string[] = [];
  if (options?.session) cookies.push(`session=${options.session}`);
  if (options?.csrf) cookies.push(`csrf_token=${options.csrf}`);
  if (cookies.length > 0) headers.cookie = cookies.join("; ");

  return new NextRequest("http://localhost/api/trips/import", {
    method: "POST",
    headers,
    body: options?.rawBody ?? JSON.stringify(body),
  });
};

/**
 * A v2 manifest with one pooled photo on the hero, matching `V2_PACKAGE`'s single archive member.
 * Kept minimal: the full-fidelity restore is proven in `tripBackupRoundTrip.test.ts`, what matters
 * here is that the multipart wire path reaches the same repository as the JSON one.
 */
const V2_MANIFEST = {
  meta: { exportedAt: "2026-02-14T12:00:00.000Z", appVersion: "0.1.0", formatVersion: 2, warnings: [] },
  photos: { p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" } },
  trip: {
    ...VALID_PAYLOAD.trip,
    name: "Multipart Package Trip",
    heroImageUrl: null,
    heroPhotoId: "p1",
    bucketListItems: [{ id: "b1", title: "Sauna" }],
  },
  days: [
    {
      ...VALID_PAYLOAD.days[0],
      accommodation: {
        id: "src-stay-1",
        name: "Package Hotel",
        notes: null,
        status: "planned",
        costCents: null,
        link: null,
        checkInTime: null,
        checkOutTime: null,
        location: null,
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
        images: [],
      },
      dayPlanItems: [
        {
          id: "src-plan-1",
          contentJson: "{\"type\":\"doc\"}",
          linkUrl: null,
          location: null,
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
          images: [],
        },
      ],
      travelSegments: [
        {
          id: "src-seg-1",
          fromItemType: "accommodation",
          fromItemId: "src-stay-1",
          toItemType: "dayPlanItem",
          toItemId: "src-plan-1",
          transportType: "flight",
          durationMinutes: 60,
          distanceKm: null,
          linkUrl: null,
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
        },
      ],
    },
    VALID_PAYLOAD.days[1],
  ],
};

const v2Package = () => buildPackage(V2_MANIFEST, [{ name: "photos/p1.jpg", data: jpegBytes() }]);

const buildMultipartRequest = (
  fileBytes: Buffer,
  options: {
    session?: string;
    csrf?: string;
    fileName?: string;
    contentType?: string;
    strategy?: string;
    targetTripId?: string;
    omitFile?: boolean;
  } = {}
) => {
  const form = new FormData();
  if (!options.omitFile) {
    form.set(
      "file",
      new File([new Uint8Array(fileBytes)], options.fileName ?? "backup.zip", {
        type: options.contentType ?? "application/zip",
      })
    );
  }
  if (options.strategy) form.set("strategy", options.strategy);
  if (options.targetTripId) form.set("targetTripId", options.targetTripId);

  const headers: Record<string, string> = {};
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  const cookies: string[] = [];
  if (options.session) cookies.push(`session=${options.session}`);
  if (options.csrf) cookies.push(`csrf_token=${options.csrf}`);
  if (cookies.length > 0) headers.cookie = cookies.join("; ");

  // No explicit content-type: `FormData` sets the multipart boundary, which is what the route
  // branches on and what a browser would actually send.
  return new NextRequest("http://localhost/api/trips/import", { method: "POST", headers, body: form });
};

describe("POST /api/trips/import", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("imports valid payload for authenticated user", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-success@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { session, csrf: "csrf-token" }));
    const payload = (await response.json()) as ApiEnvelope<{ trip: { id: string }; dayCount: number; mode: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.dayCount).toBe(2);
    expect(payload.data?.mode).toBe("createNew");
  });

  it("rejects unauthenticated requests", async () => {
    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { csrf: "csrf-token" }));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects invalid csrf token", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-csrf@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { session }));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects invalid json body", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-json@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(
      buildRequest({}, { session, csrf: "csrf-token", rawBody: "{", contentType: "application/json" })
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("invalid_json");
  });

  it("returns validation error for malformed payload", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-validation@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(
      buildRequest({ payload: { ...VALID_PAYLOAD, days: [{ ...VALID_PAYLOAD.days[0], dayIndex: 0 }] } }, { session, csrf: "csrf-token" })
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects an oversized json body before reading it", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-json-oversize@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    // `MAX_IMPORT_PACKAGE_BYTES` only ever guarded the multipart branch; `await request.json()` on
    // this one was unbounded. The header is a claim, so it is a pre-check and not the enforcement.
    const request = new NextRequest("http://localhost/api/trips/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": String(MAX_IMPORT_PACKAGE_BYTES + 1),
        "x-csrf-token": "csrf-token",
        cookie: `session=${session}; csrf_token=csrf-token`,
      },
      body: JSON.stringify({ payload: VALID_PAYLOAD }),
    });
    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    // Its own code, so the dialog can say "larger than 100 MB" instead of "incomplete or damaged".
    expect(payload.error?.code).toBe("file_too_large");
    expect(payload.error?.message).toContain("size limit");
    expect(await prisma.trip.count()).toBe(0);
  });

  it("returns name conflict when no strategy is provided", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-conflict@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });

    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { session, csrf: "csrf-token" }));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("trip_name_conflict");
  });

  it("supports overwrite strategy", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-overwrite@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const target = await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-02T00:00:00.000Z",
    });

    const response = await POST(
      buildRequest(
        { payload: VALID_PAYLOAD, strategy: "overwrite", targetTripId: target.trip.id },
        { session, csrf: "csrf-token" }
      )
    );
    const payload = (await response.json()) as ApiEnvelope<{ trip: { id: string }; dayCount: number; mode: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.mode).toBe("overwrite");
    expect(payload.data?.trip.id).toBe(target.trip.id);
  });

  it("rejects overwrite target that is not part of same-name conflicts", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-invalid-overwrite-target@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });
    const unrelatedTarget = await createTripWithDays({
      userId: user.id,
      name: "Different Name",
      startDate: "2026-09-03T00:00:00.000Z",
      endDate: "2026-09-04T00:00:00.000Z",
    });

    const response = await POST(
      buildRequest(
        { payload: VALID_PAYLOAD, strategy: "overwrite", targetTripId: unrelatedTarget.trip.id },
        { session, csrf: "csrf-token" }
      )
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("trip_name_conflict");
  });

  it("supports create-new strategy when name conflict exists", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-create-new@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });

    const response = await POST(
      buildRequest({ payload: VALID_PAYLOAD, strategy: "createNew" }, { session, csrf: "csrf-token" })
    );
    const payload = (await response.json()) as ApiEnvelope<{ trip: { id: string }; dayCount: number; mode: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.mode).toBe("createNew");

    const trips = await prisma.trip.findMany({ where: { userId: user.id, name: VALID_PAYLOAD.trip.name } });
    expect(trips).toHaveLength(2);
  });

  describe("multipart package uploads", () => {
    const createOwner = async (email: string) => {
      const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
      return { user, session: await createSessionJwt({ sub: user.id, role: user.role }) };
    };

    it("imports a v2 zip package and reports the restored counts", async () => {
      const { user, session } = await createOwner("import-route-package@example.com");

      const response = await POST(buildMultipartRequest(v2Package(), { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<{
        trip: { id: string; heroImageUrl: string | null };
        dayCount: number;
        mode: string;
        travelSegmentCount: number;
        bucketListItemCount: number;
        photoCount: number;
      }>;

      expect(response.status).toBe(200);
      expect(payload.error).toBeNull();
      expect(payload.data?.mode).toBe("createNew");
      expect(payload.data?.dayCount).toBe(2);
      expect(payload.data?.travelSegmentCount).toBe(1);
      expect(payload.data?.bucketListItemCount).toBe(1);
      expect(payload.data?.photoCount).toBe(1);

      const tripId = payload.data!.trip.id;
      expect(payload.data?.trip.heroImageUrl).toBe(`/uploads/trips/${tripId}/hero.jpg`);
      expect(await fs.readFile(path.join(getTripUploadDir(tripId), "hero.jpg"))).toEqual(jpegBytes());

      const segment = await prisma.travelSegment.findFirstOrThrow({});
      const accommodation = await prisma.accommodation.findFirstOrThrow({});
      expect(segment.fromItemId).toBe(accommodation.id);
      expect(await prisma.tripBucketListItem.count({ where: { tripId } })).toBe(1);
      expect(await prisma.trip.count({ where: { userId: user.id } })).toBe(1);
    });

    it("imports a bare v1 json file uploaded as multipart", async () => {
      const { session } = await createOwner("import-route-v1-file@example.com");

      const response = await POST(
        buildMultipartRequest(Buffer.from(JSON.stringify(VALID_PAYLOAD), "utf8"), {
          session,
          csrf: "csrf-token",
          fileName: "backup.json",
          contentType: "application/json",
        })
      );
      const payload = (await response.json()) as ApiEnvelope<{ dayCount: number; photoCount: number }>;

      expect(response.status).toBe(200);
      expect(payload.data?.dayCount).toBe(2);
      expect(payload.data?.photoCount).toBe(0);
    });

    it("rejects a malformed archive with a validation error", async () => {
      const { session } = await createOwner("import-route-bad-archive@example.com");

      // A ZIP with no `trip.json` at all - well-formed container, unusable package.
      const archive = buildZip([{ name: "photos/p1.jpg", data: jpegBytes() }]);
      const response = await POST(buildMultipartRequest(archive, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
      expect(await prisma.trip.count()).toBe(0);
    });

    it("rejects a package whose photo bytes decode as no image at all", async () => {
      const { session } = await createOwner("import-route-bad-photo@example.com");

      // AC3's "photo data that cannot be decoded", which is about the bytes and not about whether
      // they agree with the manifest's `contentType`.
      const archive = buildPackage(V2_MANIFEST, [
        { name: "photos/p1.jpg", data: Buffer.from("not an image at all", "utf8") },
      ]);
      const response = await POST(buildMultipartRequest(archive, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
      expect(await prisma.trip.count()).toBe(0);
      // AC3 covers files as well as rows.
      expect(await fs.readdir(uploadsRoot).catch(() => [])).toEqual([]);
    });

    it("restores a package whose declared type disagrees with its bytes, naming the file for the bytes", async () => {
      const { session } = await createOwner("import-route-sniffed-type@example.com");

      // Exactly what `hero-image/route.ts` produces from a PNG uploaded as `image/jpeg`: the
      // manifest says jpeg, the member is a PNG. The restored file has to be a `.png`, or the app
      // serves a `.jpg` that is not one.
      const archive = buildPackage(V2_MANIFEST, [{ name: "photos/p1.jpg", data: pngBytes() }]);
      const response = await POST(buildMultipartRequest(archive, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<{
        trip: { id: string; heroImageUrl: string | null };
      }>;

      expect(response.status).toBe(200);
      const tripId = payload.data!.trip.id;
      expect(payload.data?.trip.heroImageUrl).toBe(`/uploads/trips/${tripId}/hero.png`);
      expect(await fs.readFile(path.join(getTripUploadDir(tripId), "hero.png"))).toEqual(pngBytes());
    });

    it("surfaces the export's own warnings in the success envelope", async () => {
      const { session } = await createOwner("import-route-warnings@example.com");

      // A backup whose export already dropped a photo restores "successfully" with a lower photo
      // count. Without this the user has no way to learn anything was missing.
      const manifest = {
        ...V2_MANIFEST,
        meta: { ...V2_MANIFEST.meta, warnings: ["Skipped image whose file is missing on disk: /uploads/x.jpg"] },
      };
      const archive = buildPackage(manifest, [{ name: "photos/p1.jpg", data: jpegBytes() }]);
      const response = await POST(buildMultipartRequest(archive, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<{ warnings: string[] }>;

      expect(response.status).toBe(200);
      expect(payload.data?.warnings).toEqual([
        "Skipped image whose file is missing on disk: /uploads/x.jpg",
      ]);
    });

    it("rejects a package with an unregistered archive member", async () => {
      const { session } = await createOwner("import-route-stowaway@example.com");

      const archive = buildPackage(V2_MANIFEST, [
        { name: "photos/p1.jpg", data: jpegBytes() },
        { name: "photos/stowaway.png", data: pngBytes() },
      ]);
      const response = await POST(buildMultipartRequest(archive, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
    });

    it("requires a file part", async () => {
      const { session } = await createOwner("import-route-no-file@example.com");

      const response = await POST(
        buildMultipartRequest(Buffer.alloc(0), { session, csrf: "csrf-token", omitFile: true })
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
    });

    it("keeps the guard order: csrf before session before parsing", async () => {
      const { session } = await createOwner("import-route-multipart-guards@example.com");

      const noCsrf = await POST(buildMultipartRequest(v2Package(), { session }));
      expect(noCsrf.status).toBe(403);

      const noSession = await POST(buildMultipartRequest(v2Package(), { csrf: "csrf-token" }));
      expect(noSession.status).toBe(401);
    });

    it("rejects a package larger than the import size limit before reading it", async () => {
      const { session } = await createOwner("import-route-oversize@example.com");

      const oversize = Buffer.alloc(100 * 1024 * 1024 + 1);
      const response = await POST(buildMultipartRequest(oversize, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("file_too_large");
      expect(payload.error?.message).toContain("size limit");
    }, 60_000);

    it("returns a conflict and then overwrites through the multipart path", async () => {
      const { user, session } = await createOwner("import-route-package-overwrite@example.com");

      const target = await createTripWithDays({
        userId: user.id,
        name: V2_MANIFEST.trip.name,
        startDate: "2026-10-01T00:00:00.000Z",
        endDate: "2026-10-02T00:00:00.000Z",
      });

      const conflict = await POST(buildMultipartRequest(v2Package(), { session, csrf: "csrf-token" }));
      const conflictPayload = (await conflict.json()) as ApiEnvelope<null>;
      expect(conflict.status).toBe(409);
      expect(conflictPayload.error?.code).toBe("trip_name_conflict");
      expect((conflictPayload.error?.details as { conflicts: { id: string }[] }).conflicts[0].id).toBe(
        target.trip.id
      );

      const overwrite = await POST(
        buildMultipartRequest(v2Package(), {
          session,
          csrf: "csrf-token",
          strategy: "overwrite",
          targetTripId: target.trip.id,
        })
      );
      const overwritePayload = (await overwrite.json()) as ApiEnvelope<{ mode: string; trip: { id: string } }>;

      expect(overwrite.status).toBe(200);
      expect(overwritePayload.data?.mode).toBe("overwrite");
      expect(overwritePayload.data?.trip.id).toBe(target.trip.id);
      expect(await prisma.trip.count({ where: { userId: user.id } })).toBe(1);
    });
  });
});
