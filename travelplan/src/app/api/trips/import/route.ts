import fs from "node:fs/promises";
import { closeSync, openSync, fstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { MULTIPART_FRAMING_SLACK_BYTES, readJsonBodyWithinLimit } from "@/lib/http/bodyLimit";
import { readMultipartToDisk } from "@/lib/http/multipartToDisk";
import { fail, ok } from "@/lib/http/response";
import { importTripFromExportForUser } from "@/lib/repositories/tripRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { MAX_IMPORT_PACKAGE_BYTES } from "@/lib/trips/importLimits";
import {
  looksLikeZipPrefix,
  openImportPackage,
  parseImportPackage,
  photoSourceFromMap,
  validatePackagePhotos,
  type PhotoSource,
} from "@/lib/trips/importPackage";
import { fileByteSource, ZipReadError } from "@/lib/trips/zipReader";
import { countPhotoReferences, tripImportRequestSchema } from "@/lib/validation/tripImportSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

// `node:fs`, `node:zlib` and `Buffer` are all required by the package reader and the photo writer.
export const runtime = "nodejs";

/**
 * Rejects a body that announces itself as oversized, before anything reads it.
 *
 * `content-length` is a client-supplied claim and a request can omit it or lie, so this is a cheap
 * first pass and not the enforcement: both branches enforce the same ceiling by counting the bytes
 * they read - the multipart reader stops writing the moment the part passes `MAX_IMPORT_PACKAGE_BYTES`
 * and `readJsonBodyWithinLimit` stops accumulating at the same number. What this buys is the honest
 * majority - a browser upload always sends the header, and catching it here means neither branch
 * touches an oversized body at all.
 *
 * **The multipart allowance is what keeps that claim true.** `content-length` on a multipart request
 * describes the *whole body*, while `MAX_IMPORT_PACKAGE_BYTES` is the ceiling on the *file part* -
 * which is what `readMultipartToDisk` counts and what the dialog tells the user. Comparing the two
 * directly made a backup of exactly the permitted size fail for its own framing: the browser adds two
 * delimiters, a `content-disposition` line and the `strategy` and `targetTripId` fields, so a 300 MB
 * archive declares 300 MB plus a few hundred bytes and was refused unread. `bodyLimit.ts` already
 * exports the allowance for precisely this, and the four image upload routes already apply it. There
 * is no allowance on the JSON branch because a JSON body has no framing - `content-length` there is
 * the payload.
 *
 * It became *more* worth having in Story 2.34, not less. Reading the body now means writing it to a
 * temp file, so the cost of finding out that a body is too big by reading it went from memory
 * pressure to disk I/O on every attempt. This header is what avoids paying it.
 */
const contentLengthExceedsLimit = (request: NextRequest, isMultipart: boolean) => {
  const header = request.headers.get("content-length");
  if (!header) return false;
  const declared = Number.parseInt(header, 10);
  const ceiling = isMultipart
    ? MAX_IMPORT_PACKAGE_BYTES + MULTIPART_FRAMING_SLACK_BYTES
    : MAX_IMPORT_PACKAGE_BYTES;
  return Number.isFinite(declared) && declared > ceiling;
};

/** Form fields arrive as strings; an empty one means "not set", not "set to empty". */
const optionalFormField = (value: string | undefined) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * The uploaded archive's life on disk, and the guarantee that it ends.
 *
 * `path` is set as soon as one is chosen, *before* anything is written, because the cleanup has to
 * cover a write that failed half-way as well as one that succeeded. `fd` is the read handle the ZIP
 * reader seeks in and is only opened once the body is fully down.
 */
type UploadTempFile = { path: string | null; fd: number | null };

/**
 * Where the body lands.
 *
 * The OS temp directory, never `public/` and never anywhere near the uploads tree - see
 * `uploadPaths.ts`'s header for what happened the one time something wrote into the served tree, and
 * note that a file under `public/uploads` is also *served*, which an in-progress upload has no
 * business being. The name carries the pid and a UUID so two concurrent imports, or two instances of
 * the app sharing a box, cannot collide.
 *
 * **This assumes the temp directory is real disk, and that is an operational precondition rather than
 * something the code can check for you.** The entire memory argument for Story 2.34 is that the body
 * lands somewhere that is not RAM. On a host where `/tmp` is a `tmpfs` mount - the systemd default on
 * Fedora and Arch, and common inside containers, though not on the Debian-family host this deploys to
 * - a 300 MB upload is resident memory again and the bound is quietly void, with nothing in the logs
 * to say so. `findmnt -no FSTYPE /tmp` is the check; if it answers `tmpfs`, set `TMPDIR` for the
 * service to a directory on the same real filesystem as the uploads tree. `os.tmpdir()` honours
 * `TMPDIR`, so that is the whole of the fix and it needs no code change - which is why there is no
 * bespoke setting here duplicating a lever the platform already provides.
 *
 * **Crash leftovers are accepted, not swept.** A hard kill between the write and the `finally` below
 * leaves one file behind, bounded at `MAX_IMPORT_PACKAGE_BYTES`. A start-up sweep was considered and
 * rejected: this app has no start-up hook that runs once per process (route modules initialise
 * lazily, and there is no `instrumentation.ts`), the OS already sweeps `/tmp` on its own schedule on
 * both macOS and the Linux box this runs on, and a sweeper matching our own prefix would be a second
 * thing that deletes files it did not create - which is the exact shape of the incident
 * `uploadPaths.ts` documents. The failure mode of doing nothing is a few hundred megabytes of temp
 * space after a crash; the failure mode of a buggy sweeper is deleting a concurrent import's body.
 *
 * The standard POSIX answer is not a sweeper at all - `fs.unlink` the path as soon as the read
 * descriptor is open, and the kernel reclaims the inode when the last handle closes, `SIGKILL`
 * included. It is not used here, and the reason is this handler's shape rather than any objection to
 * the technique: the file has to stay openable *by path* after the write, first for the magic-byte
 * sniff and then, on the v1 branch, for an `fs.readFile` of the whole thing. Only the ZIP branch ever
 * reaches a point where an unlink would be safe, and Windows cannot unlink an open file at all, so
 * the guarantee would hold on one platform for one of the two container formats. That is a narrower
 * fix than it sounds and it is not the one taken; the leftover above is genuinely accepted.
 */
const createUploadTempPath = () =>
  path.join(os.tmpdir(), `travelplan-import-${process.pid}-${randomUUID()}.upload`);

const releaseUploadTempFile = async (upload: UploadTempFile) => {
  // Cleanup itself must not be able to fail the request: by the time this runs the response has
  // already been decided, and turning a successful import into a 500 over an unlink is absurd.
  if (upload.fd !== null) {
    try {
      closeSync(upload.fd);
    } catch {
      // The descriptor is already gone or was never valid; nothing left to release.
    }
    upload.fd = null;
  }
  if (upload.path !== null) {
    await fs.rm(upload.path, { force: true }).catch(() => undefined);
    upload.path = null;
  }
};

/**
 * The container decision, made against four bytes of the temp file rather than against the whole of
 * it - which is the only reason this exists separately from `parseImportPackage`'s own sniff.
 *
 * *Which* prefixes count is not decided here: `looksLikeZipPrefix` is `importPackage.ts`'s, and the
 * route reads the bytes for it. A local copy of the constants was two spellings of one rule.
 */
const looksLikeZipFile = async (filePath: string) => {
  const handle = await fs.open(filePath, "r");
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return looksLikeZipPrefix(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

type ParsedRequestBody =
  | { ok: true; raw: unknown; photos: PhotoSource }
  | { ok: false; response: Response };

/**
 * Reads the request into the shape `tripImportRequestSchema` expects.
 *
 * Two wire formats, on purpose. `multipart/form-data` is how a v2 ZIP arrives: it is binary, and
 * base64-ing it into a JSON body would inflate it by a third and force the browser to hold three
 * copies of it. `application/json` is the pre-2.32 path and stays exactly as it was - it can only
 * ever carry a v1 payload or a v2 manifest with an empty photo pool, both of which are fine.
 *
 * The multipart branch never materialises the upload: the body is streamed to `upload`'s temp file
 * and the archive is then read through a file descriptor, one member at a time. The caller owns the
 * temp file's lifetime, because the photo members are read lazily right through the import.
 */
const readRequestBody = async (
  request: NextRequest,
  upload: UploadTempFile,
): Promise<ParsedRequestBody> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  // Both branches, not just multipart: `request.json()` on the JSON path was reading an unbounded
  // body, and a v1 backup is still a whole trip's worth of text.
  if (contentLengthExceedsLimit(request, isMultipart)) {
    return {
      ok: false,
      // Its own code, not a bare `validation_error`. The dialog maps that one to "this backup could
      // not be read - it may be incomplete or damaged", which sends a user with a perfectly good
      // but oversized backup off to investigate a file that is fine. The size is the whole problem
      // and it is the one thing the message should say.
      response: fail(apiError("file_too_large", "Backup file exceeds the import size limit"), 400),
    };
  }

  if (!isMultipart) {
    const json = await readJsonBodyWithinLimit(request.body, MAX_IMPORT_PACKAGE_BYTES);
    if (!json.ok) {
      if (json.reason === "too_large") {
        return {
          ok: false,
          response: fail(apiError("file_too_large", "Backup file exceeds the import size limit"), 400),
        };
      }
      return {
        ok: false,
        response: fail(apiError("invalid_json", "Request body must be valid JSON"), 400),
      };
    }
    return { ok: true, raw: json.raw, photos: photoSourceFromMap(new Map()) };
  }

  if (!request.body) {
    return {
      ok: false,
      response: fail(apiError("invalid_form_data", "Request body must be valid form data"), 400),
    };
  }

  upload.path = createUploadTempPath();
  const multipart = await readMultipartToDisk({
    body: request.body,
    contentType: request.headers.get("content-type") ?? "",
    filePartName: "file",
    filePath: upload.path,
    maxFileBytes: MAX_IMPORT_PACKAGE_BYTES,
  });

  if (!multipart.ok) {
    if (multipart.reason === "file_too_large") {
      return {
        ok: false,
        // Its own code, not a bare `validation_error`. The dialog maps that one to "this backup could
        // not be read - it may be incomplete or damaged", which sends a user with a perfectly good
        // but oversized backup off to investigate a file that is fine. The size is the whole problem
        // and it is the one thing the message should say.
        response: fail(apiError("file_too_large", "Backup file exceeds the import size limit"), 400),
      };
    }
    return {
      ok: false,
      response: fail(apiError("invalid_form_data", "Request body must be valid form data"), 400),
    };
  }

  if (!multipart.hasFile) {
    return {
      ok: false,
      response: fail(apiError("validation_error", "Backup file is required"), 400),
    };
  }

  const strategy = optionalFormField(multipart.fields.get("strategy"));
  const targetTripId = optionalFormField(multipart.fields.get("targetTripId"));

  if (multipart.fileBytes === 0) {
    return {
      ok: false,
      response: fail(apiError("validation_error", "Backup file is empty"), 400),
    };
  }

  // A `.json` v1 backup arrives through this branch too - the dialog accepts both and the container
  // is decided by magic bytes, never by the filename or the part's `content-type`. A v1 manifest has
  // to be resident to be parsed at all (it *is* the payload), so this branch reads the file; that is
  // inherent to the format, not a copy this story could remove.
  if (!(await looksLikeZipFile(upload.path))) {
    const parsedV1 = parseImportPackage(await fs.readFile(upload.path));
    if (!parsedV1.ok) {
      return { ok: false, response: fail(apiError(parsedV1.code, parsedV1.message), 400) };
    }
    return {
      ok: true,
      raw: { payload: parsedV1.value.manifest, strategy, targetTripId },
      photos: photoSourceFromMap(parsedV1.value.photoBytes),
    };
  }

  upload.fd = openSync(upload.path, "r");
  const opened = openImportPackage(fileByteSource(upload.fd, fstatSync(upload.fd).size));
  if (!opened.ok) {
    return { ok: false, response: fail(apiError(opened.code, opened.message), 400) };
  }

  return {
    ok: true,
    raw: { payload: opened.value.manifest, strategy, targetTripId },
    photos: opened.value.photos,
  };
};

export const POST = async (request: NextRequest) => {
  // Session first, then CSRF, and that order is the wire behaviour rather than a preference. This
  // route is deliberately outside `middleware.ts`'s matcher (Story 2.34 AC4) - Next buffers the
  // request body in memory for any path the matcher covers, which would have defeated the streaming
  // read below - and the middleware ran *before* any handler, so an unauthenticated request has
  // always been answered `unauthorized` 401 whatever its CSRF token looked like. Running
  // `validateCsrf` first would have turned that into `csrf_invalid` 403 for every signed-out caller,
  // which is a change to the API nobody asked for. `requireSession` answers `unauthorized` 401 and
  // `password_change_required` 403, exactly as the middleware did.
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  // Still before anything is read or written: an authenticated request with a bad token is the
  // `csrf_invalid` 403 it always was, and the body has not been touched at that point.
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const upload: UploadTempFile = { path: null, fd: null };
  try {
    // `readRequestBody` maps every failure it anticipates, but it also streams a body to disk and
    // calls into the ZIP reader, and an unanticipated throw from either escaped the handler entirely.
    // Next then answers with its own error page rather than the `{ data, error }` envelope, so the
    // dialog's `response.json()` throws and the user is told nothing at all.
    let body: ParsedRequestBody;
    try {
      body = await readRequestBody(request, upload);
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

    try {
      // The manifest and the archive members are two independent facts, so agreement between them is
      // not something Zod can assert. This runs before the transaction because AC3 requires an
      // unrestorable package to write neither a row nor a file.
      const photoCheck = validatePackagePhotos({
        photos: parsed.data.payload.photos,
        photoBytes: body.photos,
        referenceCounts: countPhotoReferences(parsed.data.payload),
      });
      if (!photoCheck.ok) {
        return fail(apiError("validation_error", "Invalid backup photos", { issues: photoCheck.issues }), 400);
      }

      const imported = await importTripFromExportForUser({
        userId,
        payload: parsed.data.payload,
        strategy: parsed.data.strategy,
        targetTripId: parsed.data.targetTripId,
        photoBytes: body.photos,
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
      if (error instanceof ZipReadError) {
        // A member that fails its CRC-32, lies about its size or will not decompress. When the whole
        // archive was materialised up front this surfaced from `parseImportPackage` as a
        // `validation_error` 400; reading members lazily moved *when* it is discovered, and this
        // keeps *what the client sees* identical, message included.
        return fail(apiError("validation_error", error.message), 400);
      }
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
  } finally {
    // AC2, and the reason the whole handler is inside this `try`: success, a validation rejection, a
    // `ZipReadError`, a 409 conflict, an aborted request and a thrown Prisma error all pass through
    // here. The photo members are read lazily right up to the last file written, so this is the
    // earliest point at which the descriptor can be closed.
    await releaseUploadTempFile(upload);
  }
};
