import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { importTripFromExportForUser } from "@/lib/repositories/tripRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { MAX_IMPORT_PACKAGE_BYTES } from "@/lib/trips/importLimits";
import { parseImportPackage, validatePackagePhotos } from "@/lib/trips/importPackage";
import { countPhotoReferences, tripImportRequestSchema } from "@/lib/validation/tripImportSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

// `node:fs`, `node:zlib` and `Buffer` are all required by the package reader and the photo writer.
export const runtime = "nodejs";

/**
 * Rejects a body that announces itself as oversized, before anything reads it.
 *
 * `content-length` is a client-supplied claim and a request can omit it or lie, so this is a cheap
 * first pass and not the enforcement: the multipart branch still checks `file.size`. What it buys
 * is the honest majority - a browser upload always sends the header, and catching it here means
 * neither `request.json()` nor `request.formData()` buffers a 400 MB body first.
 *
 * Note what is *not* true: `await request.formData()` reads the whole body into memory before the
 * `file.size` check below can run, so that check bounds what is written and parsed, not what is
 * resident. This header check is the only thing standing between the process and an oversized body.
 */
const contentLengthExceedsLimit = (request: NextRequest) => {
  const header = request.headers.get("content-length");
  if (!header) return false;
  const declared = Number.parseInt(header, 10);
  return Number.isFinite(declared) && declared > MAX_IMPORT_PACKAGE_BYTES;
};

/** Form fields arrive as strings; an empty one means "not set", not "set to empty". */
const optionalFormField = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

type ParsedRequestBody =
  | { ok: true; raw: unknown; photoBytes: Map<string, Buffer> }
  | { ok: false; response: Response };

/**
 * Reads the request into the shape `tripImportRequestSchema` expects.
 *
 * Two wire formats, on purpose. `multipart/form-data` is how a v2 ZIP arrives: it is binary, and
 * base64-ing it into a JSON body would inflate it by a third and force the browser to hold three
 * copies of it. `application/json` is the pre-2.32 path and stays exactly as it was - it can only
 * ever carry a v1 payload or a v2 manifest with an empty photo pool, both of which are fine.
 */
const readRequestBody = async (request: NextRequest): Promise<ParsedRequestBody> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  // Both branches, not just multipart: `request.json()` on the JSON path was reading an unbounded
  // body, and a v1 backup is still a whole trip's worth of text.
  if (contentLengthExceedsLimit(request)) {
    return {
      ok: false,
      // Its own code, not a bare `validation_error`. The dialog maps that one to "this backup could
      // not be read - it may be incomplete or damaged", which sends a user with a perfectly good
      // but oversized backup off to investigate a file that is fine. The size is the whole problem
      // and it is the one thing the message should say.
      response: fail(apiError("file_too_large", "Backup file exceeds the import size limit"), 400),
    };
  }

  if (!contentType.includes("multipart/form-data")) {
    try {
      return { ok: true, raw: await request.json(), photoBytes: new Map() };
    } catch {
      return {
        ok: false,
        response: fail(apiError("invalid_json", "Request body must be valid JSON"), 400),
      };
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return {
      ok: false,
      response: fail(apiError("invalid_form_data", "Request body must be valid form data"), 400),
    };
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return {
      ok: false,
      response: fail(apiError("validation_error", "Backup file is required"), 400),
    };
  }
  // The body is already buffered by `formData()` above, so this bounds what gets parsed and
  // written, not what was read. `contentLengthExceedsLimit` is the part that runs before the read.
  if (file.size > MAX_IMPORT_PACKAGE_BYTES) {
    return {
      ok: false,
      // Its own code, not a bare `validation_error`. The dialog maps that one to "this backup could
      // not be read - it may be incomplete or damaged", which sends a user with a perfectly good
      // but oversized backup off to investigate a file that is fine. The size is the whole problem
      // and it is the one thing the message should say.
      response: fail(apiError("file_too_large", "Backup file exceeds the import size limit"), 400),
    };
  }

  const parsedPackage = parseImportPackage(Buffer.from(await file.arrayBuffer()));
  if (!parsedPackage.ok) {
    return {
      ok: false,
      response: fail(apiError(parsedPackage.code, parsedPackage.message), 400),
    };
  }

  return {
    ok: true,
    raw: {
      payload: parsedPackage.value.manifest,
      strategy: optionalFormField(formData.get("strategy")),
      targetTripId: optionalFormField(formData.get("targetTripId")),
    },
    photoBytes: parsedPackage.value.photoBytes,
  };
};

export const POST = async (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  // `readRequestBody` maps every failure it anticipates, but it also awaits `file.arrayBuffer()` and
  // calls into the ZIP reader, and an unanticipated throw from either escaped the handler entirely.
  // Next then answers with its own error page rather than the `{ data, error }` envelope, so the
  // dialog's `response.json()` throws and the user is told nothing at all.
  let body: ParsedRequestBody;
  try {
    body = await readRequestBody(request);
  } catch {
    return fail(apiError("server_error", "Unable to read the uploaded backup"), 500);
  }
  if (!body.ok) {
    return body.response;
  }

  const parsed = tripImportRequestSchema.safeParse(body.raw);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid import payload", parsed.error.flatten()), 400);
  }

  // The manifest and the archive members are two independent facts, so agreement between them is
  // not something Zod can assert. This runs before the transaction because AC3 requires an
  // unrestorable package to write neither a row nor a file.
  const photoCheck = validatePackagePhotos({
    photos: parsed.data.payload.photos,
    photoBytes: body.photoBytes,
    referenceCounts: countPhotoReferences(parsed.data.payload),
  });
  if (!photoCheck.ok) {
    return fail(apiError("validation_error", "Invalid backup photos", { issues: photoCheck.issues }), 400);
  }

  try {
    const imported = await importTripFromExportForUser({
      userId,
      payload: parsed.data.payload,
      strategy: parsed.data.strategy,
      targetTripId: parsed.data.targetTripId,
      photoBytes: body.photoBytes,
    });

    if (imported.outcome === "conflict") {
      return fail(
        apiError("trip_name_conflict", "Trip with same name already exists", {
          conflicts: imported.conflicts,
          strategyRequired: true,
        }),
        409
      );
    }

    return ok({
      trip: {
        id: imported.trip.id,
        name: imported.trip.name,
        startDate: imported.trip.startDate.toISOString(),
        endDate: imported.trip.endDate.toISOString(),
        heroImageUrl: imported.trip.heroImageUrl,
      },
      dayCount: imported.dayCount,
      mode: imported.mode,
      travelSegmentCount: imported.travelSegmentCount,
      bucketListItemCount: imported.bucketListItemCount,
      photoCount: imported.photoCount,
      // What the *export* dropped - a photo whose file was already gone, one that failed the
      // containment check. The import restored everything the package contained, so this is the
      // only place a user can learn that the package itself was already short of the original.
      warnings: parsed.data.payload.meta.warnings,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "target_trip_required") {
      // Shadowed today by `tripImportRequestSchema`'s own rule, so this is belt and braces - but its
      // five sibling errors all got explicit 4xx mappings and a missing parameter answering 500 is
      // wrong in a way that only shows up once the schema changes.
      return fail(apiError("validation_error", "Overwrite requires the trip to overwrite"), 400);
    }
    if (error instanceof Error && error.message === "target_trip_not_found") {
      return fail(apiError("not_found", "Target trip not found for overwrite"), 404);
    }
    if (error instanceof Error && error.message === "target_trip_not_conflict") {
      return fail(apiError("trip_name_conflict", "Target trip must be selected from name conflicts"), 409);
    }
    if (error instanceof Error && error.message === "photo_bytes_missing") {
      // Only reachable when a manifest declares photos the container never carried - a JSON body
      // with a populated pool, say. Schema-detectable in spirit, so it answers as a 400.
      return fail(apiError("validation_error", "Backup references photos that are not in the package"), 400);
    }
    if (error instanceof Error && error.message === "photo_reference_missing") {
      // Same class as `photo_bytes_missing`: the payload names a pool entry that is not there. The
      // schema rejects it first, so this only fires for a caller that bypassed validation - still
      // bad input rather than a server fault, and a 500 would tell the user nothing.
      return fail(apiError("validation_error", "Backup references a photo that is not in its photo pool"), 400);
    }
    if (error instanceof Error && error.message === "travel_segment_reference_missing") {
      // Likewise: a segment whose endpoints are not records of its own day. Bad input by the
      // repository's own comment at the throw site.
      return fail(
        apiError("validation_error", "Backup has a travel segment that points at no record on its day"),
        400,
      );
    }
    if (error instanceof Error && error.message === "photo_write_failed") {
      // The rows committed, then the disk phase failed and undid itself. Nothing the client can fix.
      return fail(apiError("server_error", "Unable to write imported photos"), 500);
    }

    return fail(apiError("server_error", "Unable to import trip"), 500);
  }
};
