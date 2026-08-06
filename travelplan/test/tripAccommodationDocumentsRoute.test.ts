import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { DELETE, GET, POST } from "@/app/api/trips/[id]/accommodations/documents/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";
import { getAccommodationDocumentUploadDir, getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type DocumentPayload = {
  id: string;
  accommodationId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
};

/**
 * Modelled on `tripAccommodationImagesRoute.test.ts`, with the cases that route has no equivalent
 * for: the per-entry cap, the sanitised `fileName` column, and the two rollback paths that must leave
 * nothing on disk. There is no `PATCH` here - document order is insertion order and Story 9.1 adds no
 * way to change it.
 */
describe("/api/trips/[id]/accommodations/documents", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  const seed = async (label: string) => {
    const owner = await prisma.user.create({
      data: { email: `stay-documents-${label}-owner@example.com`, passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: `Stay Documents ${label}`,
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-20T00:00:00.000Z"), dayIndex: 1 },
    });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Document Hotel" },
    });
    return { owner, token, trip, day, accommodation };
  };

  const upload = async (
    tripId: string,
    fields: { tripDayId: string; accommodationId: string },
    file: File,
    options?: { token?: string; csrf?: boolean; headers?: Record<string, string> },
  ) => {
    const form = new FormData();
    form.set("tripDayId", fields.tripDayId);
    form.set("accommodationId", fields.accommodationId);
    form.set("file", file);
    const headers: Record<string, string> = { ...options?.headers };
    if (options?.token) {
      headers.cookie =
        options.csrf === false ? `session=${options.token}` : `session=${options.token}; csrf_token=csrf-token`;
      if (options.csrf !== false) headers["x-csrf-token"] = "csrf-token";
    }
    const request = new NextRequest(`http://localhost/api/trips/${tripId}/accommodations/documents`, {
      method: "POST",
      headers,
      body: form,
    });
    return POST(request, { params: Promise.resolve({ id: tripId }) });
  };

  const listFiles = async (tripId: string, dayId: string, accommodationId: string) =>
    fs.readdir(getAccommodationDocumentUploadDir(tripId, dayId, accommodationId)).catch(() => [] as string[]);

  const pdfFile = (name = "Ticket Rom.pdf") =>
    new File([Buffer.from("%PDF-1.4 fake")], name, { type: "application/pdf" });

  it("refuses an anonymous read, a POST without CSRF and a non-owner's write", async () => {
    const { trip, day, accommodation, token } = await seed("guards");

    const anonymous = await GET(
      new NextRequest(
        `http://localhost/api/trips/${trip.id}/accommodations/documents?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
        { method: "GET" },
      ),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(anonymous.status).toBe(401);

    const noCsrf = await upload(trip.id, { tripDayId: day.id, accommodationId: accommodation.id }, pdfFile(), {
      token,
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as ApiEnvelope<null>).error?.code).toBe("csrf_invalid");

    const stranger = await prisma.user.create({
      data: { email: "stay-documents-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const strangerUpload = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      pdfFile(),
      { token: strangerToken },
    );
    expect(strangerUpload.status).toBe(404);

    const strangerRead = await GET(
      new NextRequest(
        `http://localhost/api/trips/${trip.id}/accommodations/documents?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
        { method: "GET", headers: { cookie: `session=${strangerToken}` } },
      ),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(strangerRead.status).toBe(404);

    const noCsrfDelete = await DELETE(
      new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/documents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", cookie: `session=${token}` },
        body: JSON.stringify({ tripDayId: day.id, accommodationId: accommodation.id, documentId: "x" }),
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(noCsrfDelete.status).toBe(403);

    // Nothing refused above may have reached the disk.
    expect(await listFiles(trip.id, day.id, accommodation.id)).toEqual([]);
  });

  it("stores a PDF with a server-generated name and the user's name as a column", async () => {
    const { trip, day, accommodation, token } = await seed("pdf");

    const response = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      pdfFile("Ticket Rom.pdf"),
      { token },
    );
    const payload = (await response.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();

    const document = payload.data!.document;
    expect(document.fileName).toBe("Ticket Rom.pdf");
    expect(document.sortOrder).toBe(1);
    expect(document.accommodationId).toBe(accommodation.id);
    // `tripId` third, which is what makes the authorising serve route cover these URLs unchanged, and
    // the file inside the entry's own `documents/` subdirectory rather than beside its photos.
    expect(document.documentUrl).toMatch(
      new RegExp(
        `^/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/documents/doc-\\d+-[a-z0-9]+\\.pdf$`,
      ),
    );
    // Nothing the client sent named the file on disk.
    expect(document.documentUrl).not.toContain("Ticket");

    const onDisk = await listFiles(trip.id, day.id, accommodation.id);
    expect(onDisk).toHaveLength(1);
    expect(await fs.readFile(resolveStoredMediaPath(document.documentUrl), "utf8")).toContain("%PDF-1.4");

    const listed = await GET(
      new NextRequest(
        `http://localhost/api/trips/${trip.id}/accommodations/documents?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
        { method: "GET", headers: { cookie: `session=${token}` } },
      ),
      { params: Promise.resolve({ id: trip.id }) },
    );
    const listPayload = (await listed.json()) as ApiEnvelope<{ documents: DocumentPayload[] }>;
    expect(listed.status).toBe(200);
    expect(listPayload.data?.documents).toHaveLength(1);
    expect(listPayload.data?.documents[0].fileName).toBe("Ticket Rom.pdf");
  });

  it("accepts each image type as a document and refuses everything else", async () => {
    const { trip, day, accommodation, token } = await seed("types");

    const accepted: [string, string, string][] = [
      ["image/jpeg", "boarding.jpg", "jpg"],
      ["image/png", "voucher.png", "png"],
      ["image/webp", "map.webp", "webp"],
    ];
    for (const [type, name, extension] of accepted) {
      const response = await upload(
        trip.id,
        { tripDayId: day.id, accommodationId: accommodation.id },
        new File([Buffer.from("bytes")], name, { type }),
        { token },
      );
      const payload = (await response.json()) as ApiEnvelope<{ document: DocumentPayload }>;
      expect(response.status, type).toBe(200);
      expect(payload.data?.document.fileName, type).toBe(name);
      expect(payload.data?.document.documentUrl.endsWith(`.${extension}`), type).toBe(true);
    }

    const refused = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      new File([Buffer.from("notes")], "notes.txt", { type: "text/plain" }),
      { token },
    );
    const refusedPayload = (await refused.json()) as ApiEnvelope<null>;
    expect(refused.status).toBe(400);
    expect(refusedPayload.error?.code).toBe("validation_error");
    expect(refusedPayload.error?.message).toBe("Invalid document type");
    // The three accepted ones and nothing from the refused one.
    expect(await listFiles(trip.id, day.id, accommodation.id)).toHaveLength(3);
  });

  /**
   * The route is the authoritative gate, but it must not be a *stricter* gate than the client one, and
   * `ALLOWED_TYPES[file.type]` was both stricter and weaker than `isSupportedDocumentUpload`.
   *
   * Weaker, because an index lookup on an object literal reaches `Object.prototype`: `constructor`
   * returns a function, which is truthy, so the allow-list was bypassed and the generated name ended
   * in the source text of `Object`. Stricter, because a MIME type is case-insensitive and because a
   * browser reports no type at all for some pickers and drops - the field accepted those on the name's
   * extension and the route then refused them with a message the user could do nothing about.
   */
  it("resolves the extension case-insensitively, falls back to the name, and refuses a prototype key", async () => {
    const { trip, day, accommodation, token } = await seed("type-resolution");
    const fields = { tripDayId: day.id, accommodationId: accommodation.id };

    const upperCase = await upload(
      trip.id,
      fields,
      new File([Buffer.from("%PDF-1.4 fake")], "Ticket.pdf", { type: "APPLICATION/PDF" }),
      { token },
    );
    const upperCasePayload = (await upperCase.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(upperCase.status).toBe(200);
    expect(upperCasePayload.data?.document.documentUrl.endsWith(".pdf")).toBe(true);

    // What a browser hands over when it cannot name the type - the case the client gate already
    // accepted on the extension alone.
    const noType = await upload(
      trip.id,
      fields,
      new File([Buffer.from("%PDF-1.4 fake")], "Voucher.PDF", { type: "" }),
      { token },
    );
    const noTypePayload = (await noType.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(noType.status).toBe(200);
    expect(noTypePayload.data?.document.fileName).toBe("Voucher.PDF");
    expect(noTypePayload.data?.document.documentUrl.endsWith(".pdf")).toBe(true);

    // The name carries no usable extension either, so there is nothing left to resolve from.
    const prototypeKey = await upload(
      trip.id,
      fields,
      new File([Buffer.from("payload")], "ticket", { type: "constructor" }),
      { token },
    );
    const prototypePayload = (await prototypeKey.json()) as ApiEnvelope<null>;
    expect(prototypeKey.status).toBe(400);
    expect(prototypePayload.error?.message).toBe("Invalid document type");

    // The two accepted ones only: nothing was written for the refused request.
    expect(await listFiles(trip.id, day.id, accommodation.id)).toHaveLength(2);
  });

  /**
   * `tripDayId` and `accommodationId` are path components of the entry's `documents` directory, and
   * `POST` builds that directory before the repository has confirmed the entry exists. Validated only
   * as "non-empty string", a traversal in either one creates directories outside `MEDIA_STORAGE_ROOT`
   * and writes a file into them; the failed insert removes the file but never the directories.
   *
   * Asserted at the boundary as well as by the status code, because the refusal has to happen *before*
   * `fs.mkdir`, and a 400 on its own does not say when.
   */
  it("refuses an id that is not a single safe path segment, before anything reaches the filesystem", async () => {
    const { trip, day, accommodation, token } = await seed("traversal");
    const escapeTarget = path.join(uploadsRoot, "..", "..", "documents-escape-probe");
    await fs.rm(escapeTarget, { recursive: true, force: true });

    const hostile: [string, { tripDayId: string; accommodationId: string }][] = [
      ["traversing tripDayId", { tripDayId: "../../documents-escape-probe", accommodationId: accommodation.id }],
      ["traversing accommodationId", { tripDayId: day.id, accommodationId: ".." }],
      ["separator in an id", { tripDayId: `${day.id}/nested`, accommodationId: accommodation.id }],
    ];

    for (const [label, fields] of hostile) {
      const response = await upload(trip.id, fields, pdfFile(), { token });
      const payload = (await response.json()) as ApiEnvelope<null>;
      expect(response.status, label).toBe(400);
      expect(payload.error?.code, label).toBe("validation_error");
    }

    await expect(fs.stat(escapeTarget)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listFiles(trip.id, day.id, accommodation.id)).toHaveLength(0);
    // Nothing was created for the real day either - the refusal precedes every write.
    expect(await prisma.accommodationDocument.count()).toBe(0);
  });

  it("refuses a file over 10 MB on the file-size check when no content-length was sent", async () => {
    const { trip, day, accommodation, token } = await seed("oversize");

    // `FormData` sets no `content-length` of its own, so a request built this way reaches the
    // `file.size` check - the enforcement behind the header pre-check below.
    const oversized = new File([Buffer.alloc(10 * 1024 * 1024 + 1, 0x5a)], "huge.pdf", {
      type: "application/pdf",
    });
    const response = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      oversized,
      { token },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;
    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(payload.error?.message).toContain("exceeds size limit");
    expect(await listFiles(trip.id, day.id, accommodation.id)).toEqual([]);
  });

  /**
   * The `declaredBodyExceedsFileLimit` path, and the reason it exists at all: these routes fall
   * inside the middleware matcher, so Next *truncates* a body over `proxyClientMaxBodySize` rather
   * than refusing it. Without the pre-check `request.formData()` throws and an intact 25 MB ticket is
   * answered `invalid_form_data` - "this file is damaged" for a file that is fine. The assertion is
   * therefore on the *message*, not merely on the 400.
   */
  it("answers the size message rather than invalid_form_data for a declared oversize body", async () => {
    const { trip, token } = await seed("declaredoversize");

    const request = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/documents`, {
      method: "POST",
      headers: {
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
        "content-type": "multipart/form-data; boundary=xyz",
        "content-length": String(25 * 1024 * 1024),
      },
      // A stub: the point is that nothing reads it.
      body: "--xyz--",
    });
    const response = await POST(request, { params: Promise.resolve({ id: trip.id }) });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(payload.error?.code).not.toBe("invalid_form_data");
    expect(payload.error?.message).toContain("exceeds size limit");
  });

  it("stores a hostile file name as a bare basename", async () => {
    const { trip, day, accommodation, token } = await seed("filename");

    const traversal = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      new File([Buffer.from("%PDF-")], "../../etc/passwd", { type: "application/pdf" }),
      { token },
    );
    const traversalPayload = (await traversal.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(traversal.status).toBe(200);
    expect(traversalPayload.data?.document.fileName).toBe("passwd");

    const windowsPath = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      new File([Buffer.from("%PDF-")], "C:\\Users\\tommy\\Ticket Rom.pdf", { type: "application/pdf" }),
      { token },
    );
    const windowsPayload = (await windowsPath.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(windowsPath.status).toBe(200);
    expect(windowsPayload.data?.document.fileName).toBe("Ticket Rom.pdf");

    // Neither stored name reached the filesystem, and nothing escaped the entry's directory.
    const onDisk = await listFiles(trip.id, day.id, accommodation.id);
    expect(onDisk).toHaveLength(2);
    for (const name of onDisk) {
      expect(name).toMatch(/^doc-\d+-[a-z0-9]+\.pdf$/);
    }
    expect(path.basename(traversalPayload.data!.document.documentUrl)).not.toContain("passwd");

    const nameless = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      new File([Buffer.from("%PDF-")], "   ", { type: "application/pdf" }),
      { token },
    );
    expect(nameless.status).toBe(400);
    expect(((await nameless.json()) as ApiEnvelope<null>).error?.code).toBe("validation_error");
    expect(await listFiles(trip.id, day.id, accommodation.id)).toHaveLength(2);
  });

  it("refuses the eleventh document and leaves no file behind", async () => {
    const { trip, day, accommodation, token } = await seed("cap");

    for (let index = 0; index < MAX_DOCUMENTS_PER_ENTRY; index += 1) {
      const response = await upload(
        trip.id,
        { tripDayId: day.id, accommodationId: accommodation.id },
        pdfFile(`Ticket ${index}.pdf`),
        { token },
      );
      expect(response.status, `document ${index}`).toBe(200);
    }

    const eleventh = await upload(
      trip.id,
      { tripDayId: day.id, accommodationId: accommodation.id },
      pdfFile("Eleventh.pdf"),
      { token },
    );
    const payload = (await eleventh.json()) as ApiEnvelope<null>;
    expect(eleventh.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(payload.error?.message).toBe("Document limit reached");

    // The route writes the file before it asks the repository, so the rollback is the only thing
    // between a refused upload and a permanently orphaned file nothing knows about.
    expect(await listFiles(trip.id, day.id, accommodation.id)).toHaveLength(MAX_DOCUMENTS_PER_ENTRY);
    expect(await prisma.accommodationDocument.count()).toBe(MAX_DOCUMENTS_PER_ENTRY);
  });

  it("leaves no file behind when the insert cannot find its entry", async () => {
    const { trip, day, token } = await seed("failedinsert");
    // Owner access to the trip passes, so the request gets all the way to the write; the entry id is
    // not one this day has, so the repository refuses.
    const ghostId = "cmghostaccommodation000";

    const response = await upload(trip.id, { tripDayId: day.id, accommodationId: ghostId }, pdfFile(), { token });
    expect(response.status).toBe(404);
    expect(await listFiles(trip.id, day.id, ghostId)).toEqual([]);
    expect(await prisma.accommodationDocument.count()).toBe(0);
  });

  it("deletes the row and unlinks the file, and still succeeds when the file is already gone", async () => {
    const { trip, day, accommodation, token } = await seed("delete");

    const first = (await (
      await upload(trip.id, { tripDayId: day.id, accommodationId: accommodation.id }, pdfFile("One.pdf"), { token })
    ).json()) as ApiEnvelope<{ document: DocumentPayload }>;
    const second = (await (
      await upload(trip.id, { tripDayId: day.id, accommodationId: accommodation.id }, pdfFile("Two.pdf"), { token })
    ).json()) as ApiEnvelope<{ document: DocumentPayload }>;

    const firstPath = resolveStoredMediaPath(first.data!.document.documentUrl);
    const secondPath = resolveStoredMediaPath(second.data!.document.documentUrl);

    const remove = async (documentId: string) =>
      DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/documents`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${token}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({ tripDayId: day.id, accommodationId: accommodation.id, documentId }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

    const deleted = await remove(first.data!.document.id);
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as ApiEnvelope<{ deleted: boolean }>).data?.deleted).toBe(true);
    // Both halves: the row *and* the bytes. Reading the row before deleting it is what makes the
    // second half possible at all.
    expect(await prisma.accommodationDocument.count()).toBe(1);
    await expect(fs.access(firstPath)).rejects.toThrow();

    // A file already gone - removed out of band, or by a half-finished earlier delete - is an ENOENT
    // the unlink swallows, and the row still has to go.
    await fs.rm(secondPath, { force: true });
    const orphanDelete = await remove(second.data!.document.id);
    expect(orphanDelete.status).toBe(200);
    expect(await prisma.accommodationDocument.count()).toBe(0);

    // And a document id that is not on this entry is a 404 rather than a silent success.
    const missing = await remove(second.data!.document.id);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiEnvelope<null>).error?.message).toBe("Document not found");
  });
});
