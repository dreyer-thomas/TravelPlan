import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/trips/import/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { MULTIPART_FRAMING_SLACK_BYTES } from "@/lib/http/bodyLimit";
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
    contentLength?: string;
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
  // `FormData` sets no `content-length` of its own, so this is the only way to exercise the header
  // pre-check. The header is a claim either way - that is precisely why the route re-checks the size.
  if (options.contentLength) headers["content-length"] = options.contentLength;
  const cookies: string[] = [];
  if (options.session) cookies.push(`session=${options.session}`);
  if (options.csrf) cookies.push(`csrf_token=${options.csrf}`);
  if (cookies.length > 0) headers.cookie = cookies.join("; ");

  // No explicit content-type: `FormData` sets the multipart boundary, which is what the route
  // branches on and what a browser would actually send.
  return new NextRequest("http://localhost/api/trips/import", { method: "POST", headers, body: form });
};

/**
 * Uploads the route streamed to the OS temp directory and has not cleaned up yet (AC2).
 *
 * The prefix is the route's own, so this cannot see anything else on the machine - and the whole
 * point of naming it is that a leftover is attributable. Nothing here removes them: a test that
 * tidied up after the route would assert nothing.
 */
const leftoverImportTempFiles = () =>
  readdirSync(os.tmpdir()).filter((name) => name.startsWith("travelplan-import-"));

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

    it("keeps the guard order: session before csrf before parsing", async () => {
      const { session } = await createOwner("import-route-multipart-guards@example.com");

      // Signed in, no token: the CSRF guard answers, and it does so before the body is read.
      const noCsrf = await POST(buildMultipartRequest(v2Package(), { session }));
      const noCsrfPayload = (await noCsrf.json()) as ApiEnvelope<null>;
      expect(noCsrf.status).toBe(403);
      expect(noCsrfPayload.error?.code).toBe("csrf_invalid");

      // Signed out and no token either - the shape the middleware used to answer, and it answered
      // 401. The session guard therefore has to run first, or a signed-out caller is told its CSRF
      // token is wrong instead of that it is not signed in.
      const noSessionNoCsrf = await POST(buildMultipartRequest(v2Package()));
      const noSessionNoCsrfPayload = (await noSessionNoCsrf.json()) as ApiEnvelope<null>;
      expect(noSessionNoCsrf.status).toBe(401);
      expect(noSessionNoCsrfPayload.error?.code).toBe("unauthorized");

      const noSession = await POST(buildMultipartRequest(v2Package(), { csrf: "csrf-token" }));
      expect(noSession.status).toBe(401);
    });

    // Two checks guard the size and only one of them runs before the body is read. `FormData` sets no
    // `content-length`, so a request built the way a browser builds it reaches the `file.size` check
    // with the whole body already buffered - which is what the route's own comment says. Both are
    // covered, each by what it actually is, and both derive their figure from the constant.
    it("rejects an oversized package on the content-length pre-check, before reading it", async () => {
      const { session } = await createOwner("import-route-oversize-header@example.com");

      // A small body with a header that claims otherwise: if the route read the body it would find a
      // perfectly good package, so a rejection here can only have come from the pre-check.
      const response = await POST(
        buildMultipartRequest(v2Package(), {
          session,
          csrf: "csrf-token",
          contentLength: String(MAX_IMPORT_PACKAGE_BYTES + MULTIPART_FRAMING_SLACK_BYTES + 1),
        })
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("file_too_large");
      expect(payload.error?.message).toContain("size limit");
    });

    // The pre-check reads a whole-body figure and compares it against a *file-part* ceiling, so
    // without the framing allowance a backup of exactly the permitted size was refused for the two
    // delimiters and the `strategy` field wrapped around it - the documented 300 MB being unreachable
    // from the app's own dialog. The allowance is `bodyLimit.ts`'s, the same one the four image upload
    // routes apply.
    it("does not refuse a declared length that is only over the ceiling by its multipart framing", async () => {
      const { session } = await createOwner("import-route-framing-slack@example.com");

      const response = await POST(
        buildMultipartRequest(v2Package(), {
          session,
          csrf: "csrf-token",
          contentLength: String(MAX_IMPORT_PACKAGE_BYTES + 1),
        })
      );
      const payload = (await response.json()) as ApiEnvelope<{ dayCount: number }>;

      // Read rather than refused, and the package inside it imported.
      expect(response.status).toBe(200);
      expect(payload.data?.dayCount).toBe(V2_MANIFEST.days.length);
    });

    it("rejects an oversized package on the file-size check when no content-length was sent", async () => {
      const { session } = await createOwner("import-route-oversize@example.com");

      // Allocated for real, because `formData()` re-parses the multipart body into a fresh `File` -
      // a faked `size` on the one handed in would not survive the round trip.
      const oversize = Buffer.alloc(MAX_IMPORT_PACKAGE_BYTES + 1);
      const request = buildMultipartRequest(oversize, { session, csrf: "csrf-token" });
      expect(request.headers.get("content-length")).toBeNull();

      const response = await POST(request);
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("file_too_large");
      expect(payload.error?.message).toContain("size limit");
    }, 120_000);

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

    it("maps a member that fails its CRC-32 to the same validation_error it always did", async () => {
      const { session } = await createOwner("import-route-bad-crc@example.com");

      // Reading members lazily moved *when* this is discovered - the archive's structure is sound,
      // so the open succeeds and the photo only fails once validation asks for its bytes. What the
      // client sees must not have moved with it.
      const archive = buildZip([
        { name: "trip.json", data: Buffer.from(JSON.stringify(V2_MANIFEST), "utf8") },
        { name: "photos/p1.jpg", data: jpegBytes(), crc: 0x1234abcd },
      ]);
      const response = await POST(buildMultipartRequest(archive, { session, csrf: "csrf-token" }));
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
      expect(payload.error?.message).toContain("CRC-32");
      expect(await prisma.trip.count()).toBe(0);
      expect(await fs.readdir(uploadsRoot).catch(() => [])).toEqual([]);
    });
  });

  /**
   * Story 2.34 took `/api/trips/import` out of `middleware.ts`'s matcher, because Next buffers the
   * body in memory for every path the matcher covers and that copy would have survived everything
   * else the story does. The 401 and the 403 it used to produce are now the route's own job.
   *
   * Neither of these sends a CSRF pair, and that is the point: the middleware ran before any handler,
   * so what it answered a request with no token and no session was 401, not 403. `requireSession`
   * therefore has to run before `validateCsrf` in the route, and a test that supplied a valid token
   * to make the assertion hold would be pinning the workaround instead of the behaviour.
   */
  describe("self-guards without the middleware", () => {
    it("answers 401 unauthorized for a request with no session and no csrf token", async () => {
      for (const response of [
        await POST(buildRequest({ payload: VALID_PAYLOAD })),
        await POST(buildMultipartRequest(v2Package())),
      ]) {
        const payload = (await response.json()) as ApiEnvelope<null>;
        expect(response.status).toBe(401);
        expect(payload.error?.code).toBe("unauthorized");
        expect(payload.error?.message).toBe("Authentication required");
      }
    });

    it("answers 403 password_change_required for a session that must change its password", async () => {
      const user = await prisma.user.create({
        data: { email: "import-route-must-change@example.com", passwordHash: "hashed", role: "OWNER" },
      });
      const session = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });

      // No CSRF pair here either: the flagged session is what the middleware answered on, ahead of
      // anything the route would have checked.
      for (const response of [
        await POST(buildRequest({ payload: VALID_PAYLOAD }, { session })),
        await POST(buildMultipartRequest(v2Package(), { session })),
      ]) {
        const payload = (await response.json()) as ApiEnvelope<null>;
        expect(response.status).toBe(403);
        expect(payload.error?.code).toBe("password_change_required");
        expect(payload.error?.message).toBe("Password change required");
      }
      expect(await prisma.trip.count()).toBe(0);
    });
  });

  describe("temporary upload file", () => {
    const createOwner = async (email: string) => {
      const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
      return { user, session: await createSessionJwt({ sub: user.id, role: user.role }) };
    };

    it("leaves nothing behind on success, on a validation rejection or on a ZipReadError", async () => {
      const { session } = await createOwner("import-route-temp-file@example.com");
      const before = leftoverImportTempFiles();

      const success = await POST(buildMultipartRequest(v2Package(), { session, csrf: "csrf-token" }));
      expect(success.status).toBe(200);
      expect(leftoverImportTempFiles()).toEqual(before);

      // A package whose photo bytes decode as no image: rejected after the body is on disk and after
      // the archive has been opened, which is the path a `finally` is easiest to get wrong on.
      const rejected = await POST(
        buildMultipartRequest(
          buildPackage(V2_MANIFEST, [{ name: "photos/p1.jpg", data: Buffer.from("not an image", "utf8") }]),
          { session, csrf: "csrf-token" },
        ),
      );
      expect(rejected.status).toBe(400);
      expect(leftoverImportTempFiles()).toEqual(before);

      const unreadable = await POST(
        buildMultipartRequest(
          buildZip([
            { name: "trip.json", data: Buffer.from(JSON.stringify(V2_MANIFEST), "utf8") },
            { name: "photos/p1.jpg", data: jpegBytes(), crc: 0x1234abcd },
          ]),
          { session, csrf: "csrf-token" },
        ),
      );
      expect(unreadable.status).toBe(400);
      expect(leftoverImportTempFiles()).toEqual(before);
    });

    it("leaves nothing behind for a 409 conflict or a body it never managed to parse", async () => {
      const { user, session } = await createOwner("import-route-temp-file-conflict@example.com");
      await createTripWithDays({
        userId: user.id,
        name: V2_MANIFEST.trip.name,
        startDate: "2026-10-01T00:00:00.000Z",
        endDate: "2026-10-02T00:00:00.000Z",
      });
      const before = leftoverImportTempFiles();

      const conflict = await POST(buildMultipartRequest(v2Package(), { session, csrf: "csrf-token" }));
      expect(conflict.status).toBe(409);
      expect(leftoverImportTempFiles()).toEqual(before);

      // A multipart content-type over a body that is not multipart at all: the reader gives up before
      // a single part is framed, and the temp path was already claimed by then.
      const malformed = await POST(
        new NextRequest("http://localhost/api/trips/import", {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=----nothingLikeThisInTheBody",
            "x-csrf-token": "csrf-token",
            cookie: `session=${session}; csrf_token=csrf-token`,
          },
          body: "not multipart in the slightest",
        }),
      );
      const malformedPayload = (await malformed.json()) as ApiEnvelope<null>;
      expect(malformed.status).toBe(400);
      expect(malformedPayload.error?.code).toBe("invalid_form_data");
      expect(leftoverImportTempFiles()).toEqual(before);
    });
  });

  /**
   * Story 2.35. The JSON wire path is used rather than a ZIP because none of this is about photos:
   * both paths hand the same parsed payload to the same repository, and a manifest with an empty pool
   * is exactly what the legacy branch carries.
   */
  describe("travel segment endpoints", () => {
    const STAMP = "2026-02-14T12:00:00.000Z";

    const createOwner = async (email: string) => {
      const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
      return { user, session: await createSessionJwt({ sub: user.id, role: user.role }) };
    };

    const stay = (id: string) => ({
      id,
      name: `Stay ${id}`,
      notes: null,
      status: "planned",
      costCents: null,
      link: null,
      checkInTime: null,
      checkOutTime: null,
      location: null,
      createdAt: STAMP,
      updatedAt: STAMP,
      images: [],
    });

    const planItem = (id: string) => ({
      id,
      contentJson: "{\"type\":\"doc\"}",
      linkUrl: null,
      location: null,
      createdAt: STAMP,
      updatedAt: STAMP,
      images: [],
    });

    const segment = (overrides: Record<string, unknown>) => ({
      id: "src-seg",
      fromItemType: "accommodation",
      fromItemId: "src-stay-1",
      toItemType: "dayPlanItem",
      toItemId: "src-plan-2",
      transportType: "flight",
      durationMinutes: 45,
      distanceKm: null,
      linkUrl: null,
      createdAt: STAMP,
      updatedAt: STAMP,
      ...overrides,
    });

    /** Two days, each with its own stay and plan item; every segment sits on day 2. */
    const twoDayManifest = (name: string, daySegments: unknown[]) => ({
      meta: { exportedAt: STAMP, appVersion: "0.1.0", formatVersion: 2, warnings: [] },
      photos: {},
      trip: { ...VALID_PAYLOAD.trip, name, heroPhotoId: null, bucketListItems: [] },
      days: [
        {
          ...VALID_PAYLOAD.days[0],
          accommodation: stay("src-stay-1"),
          dayPlanItems: [planItem("src-plan-1")],
          travelSegments: [],
        },
        {
          ...VALID_PAYLOAD.days[1],
          accommodation: stay("src-stay-2"),
          dayPlanItems: [planItem("src-plan-2")],
          travelSegments: daySegments,
        },
      ],
    });

    it("restores a day-2 segment that starts at day 1's accommodation", async () => {
      // AC1 end to end: the schema now accepts it *and* the importer's trip-wide map resolves it to
      // the right row. Getting the first without the second would import the archive and wire the
      // segment to whatever else happened to be in the map.
      const { session } = await createOwner("import-route-previous-stay@example.com");

      const response = await POST(
        buildRequest(
          { payload: twoDayManifest("Previous Stay Restore", [segment({ id: "src-seg-prev" })]) },
          { session, csrf: "csrf-token" },
        ),
      );
      const payload = (await response.json()) as ApiEnvelope<{
        trip: { id: string };
        travelSegmentCount: number;
        warnings: string[];
      }>;

      expect(response.status).toBe(200);
      expect(payload.data?.travelSegmentCount).toBe(1);
      expect(payload.data?.warnings).toEqual([]);

      const days = await prisma.tripDay.findMany({
        where: { tripId: payload.data!.trip.id },
        orderBy: { dayIndex: "asc" },
        include: { accommodation: true, travelSegments: true },
      });
      expect(days[0].travelSegments).toHaveLength(0);
      expect(days[1].travelSegments).toHaveLength(1);
      // The segment lives on day 2 and points back at day 1's stay - the whole shape of the feature.
      expect(days[1].travelSegments[0].fromItemId).toBe(days[0].accommodation!.id);
      expect(days[1].travelSegments[0].fromItemId).not.toBe(days[1].accommodation!.id);
    });

    it("skips a segment whose endpoint names no record and reports the count", async () => {
      // AC2 and AC3. One orphan used to make the whole archive unrestorable.
      const { session } = await createOwner("import-route-orphan-segment@example.com");

      const response = await POST(
        buildRequest(
          {
            payload: twoDayManifest("Orphan Segment Trip", [
              segment({ id: "src-seg-orphan", fromItemType: "dayPlanItem", fromItemId: "deleted-long-ago" }),
            ]),
          },
          { session, csrf: "csrf-token" },
        ),
      );
      const payload = (await response.json()) as ApiEnvelope<{
        trip: { id: string };
        dayCount: number;
        travelSegmentCount: number;
        warnings: string[];
      }>;

      expect(response.status).toBe(200);
      expect(payload.data?.dayCount).toBe(2);
      expect(payload.data?.travelSegmentCount).toBe(0);
      expect(payload.data?.warnings).toEqual([
        "Skipped 1 travel segment whose start or end point is missing from this backup",
      ]);
      expect(await prisma.travelSegment.count({ where: { tripDay: { tripId: payload.data!.trip.id } } })).toBe(0);
      // The rest of the archive is intact, which is the entire point of skipping rather than refusing.
      expect(await prisma.tripDay.count({ where: { tripId: payload.data!.trip.id } })).toBe(2);
      expect(await prisma.accommodation.count({ where: { tripDay: { tripId: payload.data!.trip.id } } })).toBe(2);
    });

    it("keeps the reported counts in step with the rows when segments are skipped", async () => {
      const { session } = await createOwner("import-route-skip-counts@example.com");

      const response = await POST(
        buildRequest(
          {
            payload: twoDayManifest("Mixed Segment Trip", [
              // Restored: the previous-night segment AC1 is about.
              segment({ id: "src-seg-prev" }),
              // Restored: an ordinary same-day segment.
              segment({ id: "src-seg-same", fromItemId: "src-stay-2" }),
              // Skipped, twice over - and the warning has to say "segments", not "segment".
              segment({ id: "src-seg-gone-1", fromItemType: "dayPlanItem", fromItemId: "deleted-a" }),
              segment({ id: "src-seg-gone-2", fromItemType: "dayPlanItem", fromItemId: "deleted-b" }),
            ]),
          },
          { session, csrf: "csrf-token" },
        ),
      );
      const payload = (await response.json()) as ApiEnvelope<{
        trip: { id: string };
        travelSegmentCount: number;
        warnings: string[];
      }>;

      expect(response.status).toBe(200);
      expect(payload.data?.travelSegmentCount).toBe(2);
      expect(await prisma.travelSegment.count({ where: { tripDay: { tripId: payload.data!.trip.id } } })).toBe(2);
      expect(payload.data?.warnings).toEqual([
        "Skipped 2 travel segments whose start or end point is missing from this backup",
      ]);
    });

    it("reports what the import skipped ahead of what the export dropped, in one list", async () => {
      // AC3 says "the existing warnings channel", so the import's own line joins the manifest's
      // rather than arriving in a second field the dialog would have to learn about.
      //
      // Order is load-bearing, not incidental: `TripImportDialog` renders the first ten lines and
      // replaces the rest with a "+N more" caption, while `meta.warnings` may hold up to
      // `MAX_IMPORT_WARNINGS`. The import's own line goes first so it cannot be the loss the user is
      // never shown - on an old archive that dropped a dozen photo files, appending would hide it.
      const { session } = await createOwner("import-route-both-warnings@example.com");
      const manifest = twoDayManifest("Both Warnings Trip", [
        segment({ id: "src-seg-gone", fromItemType: "dayPlanItem", fromItemId: "deleted-long-ago" }),
      ]);

      const response = await POST(
        buildRequest(
          {
            payload: {
              ...manifest,
              meta: {
                ...manifest.meta,
                warnings: ["Skipped image whose file is missing on disk: /uploads/x.jpg"],
              },
            },
          },
          { session, csrf: "csrf-token" },
        ),
      );
      const payload = (await response.json()) as ApiEnvelope<{ warnings: string[] }>;

      expect(response.status).toBe(200);
      expect(payload.data?.warnings).toEqual([
        "Skipped 1 travel segment whose start or end point is missing from this backup",
        "Skipped image whose file is missing on disk: /uploads/x.jpg",
      ]);
    });

    it("reports a skipped segment when overwriting, where the lost row is not recoverable", async () => {
      // Overwrite deletes the target trip's own days - and with them its segments - before writing the
      // package's. So this is the path where dropping a segment destroys a row that existed a moment
      // ago and has no copy left anywhere, which makes the AC3 warning the user's only notice. The two
      // transaction branches carry `skippedTravelSegmentCount` independently; every other test here
      // creates a new trip and so only exercises the other one.
      const { user, session } = await createOwner("import-route-overwrite-skip@example.com");
      // Overwrite is only offered for a same-name conflict, so the target has to carry the name the
      // manifest declares.
      const target = await createTripWithDays({
        userId: user.id,
        name: "Overwrite Skip Trip",
        startDate: "2026-10-01T00:00:00.000Z",
        endDate: "2026-10-02T00:00:00.000Z",
      });

      const manifest = twoDayManifest("Overwrite Skip Trip", [
        segment({ id: "src-seg-prev" }),
        segment({ id: "src-seg-gone", fromItemType: "dayPlanItem", fromItemId: "deleted-long-ago" }),
      ]);
      const response = await POST(
        buildRequest(
          { payload: manifest, strategy: "overwrite", targetTripId: target.trip.id },
          { session, csrf: "csrf-token" },
        ),
      );
      const payload = (await response.json()) as ApiEnvelope<{
        mode: string;
        trip: { id: string };
        travelSegmentCount: number;
        warnings: string[];
      }>;

      expect(response.status).toBe(200);
      expect(payload.data?.mode).toBe("overwrite");
      expect(payload.data?.trip.id).toBe(target.trip.id);
      expect(payload.data?.travelSegmentCount).toBe(1);
      expect(payload.data?.warnings).toEqual([
        "Skipped 1 travel segment whose start or end point is missing from this backup",
      ]);
      expect(await prisma.travelSegment.count({ where: { tripDay: { tripId: target.trip.id } } })).toBe(1);
    });

    it("still refuses a segment naming an accommodation from a later day", async () => {
      // AC5 and Trap 4: the skip path is for endpoints that name nothing, not for every endpoint the
      // importer cannot resolve. A forward reference names a record the package holds, and the
      // sorted-order map cannot have reached it yet.
      const { user, session } = await createOwner("import-route-forward-reference@example.com");

      const manifest = twoDayManifest("Forward Reference Trip", []);
      const response = await POST(
        buildRequest(
          {
            payload: {
              ...manifest,
              days: [
                { ...manifest.days[0], travelSegments: [segment({ fromItemId: "src-stay-2", toItemId: "src-plan-1" })] },
                manifest.days[1],
              ],
            },
          },
          { session, csrf: "csrf-token" },
        ),
      );
      const payload = (await response.json()) as ApiEnvelope<null>;

      expect(response.status).toBe(400);
      expect(payload.error?.code).toBe("validation_error");
      expect(await prisma.trip.count({ where: { userId: user.id } })).toBe(0);
    });
  });
});
