import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { hasTripOwnerAccess } from "@/lib/auth/tripAccess";
import { getTripExportForUser } from "@/lib/repositories/tripRepo";
import { requireSession } from "@/lib/auth/sessionGuard";
import { createZipStream, type ZipEntry } from "@/lib/trips/zipArchive";

// `node:fs` and `node:zlib` are required by the archive writer.
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const APP_VERSION = process.env.npm_package_version ?? "0.1.0";
const FORMAT_VERSION = 2;
const MANIFEST_ENTRY_NAME = "trip.json";

const toSafeSlug = (name: string) => {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || "trip";
};

export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!(await hasTripOwnerAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    const exported = await getTripExportForUser(userId, tripId);
    if (!exported) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    const { payload, photoFiles } = exported;

    // The filename's date part is the one deliberate use of the wall clock here: it is not archive
    // content, so it cannot affect the byte-identity of two exports of an unchanged trip.
    const generatedAt = new Date().toISOString();
    const datePart = generatedAt.slice(0, 10);
    // Keep export payload deterministic for unchanged trip data.
    const exportedAt = payload.trip.updatedAt;
    const fileName = `trip-${toSafeSlug(payload.trip.name)}-${datePart}.zip`;

    // No indentation: byte-stable, and matching what the v1 export emitted.
    const manifest = Buffer.from(
      JSON.stringify({
        meta: {
          exportedAt,
          appVersion: APP_VERSION,
          formatVersion: FORMAT_VERSION,
          warnings: payload.warnings,
        },
        photos: payload.photos,
        trip: payload.trip,
        days: payload.days,
      }),
      "utf8",
    );

    // Fixed entry order: the manifest, then every pooled photo in pool-key order (`p1`, `p2`, ...),
    // which the repository already returns sorted. Order is part of AC7's byte-identity property.
    const entries: ZipEntry[] = [
      { name: MANIFEST_ENTRY_NAME, source: { kind: "buffer", data: manifest } },
      ...photoFiles.map((photo): ZipEntry => ({
        name: photo.archivePath,
        source: { kind: "file", path: photo.filePath },
      })),
    ];

    // Every ZIP timestamp derives from `trip.updatedAt`; `new Date()` here would reintroduce exactly
    // the non-determinism Story 2.9's review removed.
    const stream = createZipStream(entries, new Date(payload.trip.updatedAt));

    // No `content-length`: sizes are knowable from `fs.stat` up front, but a file that changes
    // between stat and read would make the declared length a lie. Chunked transfer costs nothing.
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to export trip"), 500);
  }
};
