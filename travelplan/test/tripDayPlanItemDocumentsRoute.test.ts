import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { DELETE, GET, POST } from "@/app/api/trips/[id]/day-plan-items/documents/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";
import { getDayPlanItemDocumentUploadDir, getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type DocumentPayload = {
  id: string;
  dayPlanItemId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
};

const CONTENT_JSON = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Document stop" }] }],
});

/**
 * The activity twin of `tripAccommodationDocumentsRoute.test.ts`, plus the day-wide `GET` branch the
 * timeline depends on - one request per day rather than one per card. No `PATCH`: document order is
 * insertion order and Story 9.1 adds no way to change it.
 */
describe("/api/trips/[id]/day-plan-items/documents", () => {
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
      data: { email: `item-documents-${label}-owner@example.com`, passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: `Item Documents ${label}`,
        startDate: new Date("2026-12-21T00:00:00.000Z"),
        endDate: new Date("2026-12-21T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-21T00:00:00.000Z"), dayIndex: 1 },
    });
    const item = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, contentJson: CONTENT_JSON },
    });
    return { owner, token, trip, day, item };
  };

  const upload = async (
    tripId: string,
    fields: { tripDayId: string; dayPlanItemId: string },
    file: File,
    options?: { token?: string; csrf?: boolean },
  ) => {
    const form = new FormData();
    form.set("tripDayId", fields.tripDayId);
    form.set("dayPlanItemId", fields.dayPlanItemId);
    form.set("file", file);
    const headers: Record<string, string> = {};
    if (options?.token) {
      headers.cookie =
        options.csrf === false ? `session=${options.token}` : `session=${options.token}; csrf_token=csrf-token`;
      if (options.csrf !== false) headers["x-csrf-token"] = "csrf-token";
    }
    const request = new NextRequest(`http://localhost/api/trips/${tripId}/day-plan-items/documents`, {
      method: "POST",
      headers,
      body: form,
    });
    return POST(request, { params: Promise.resolve({ id: tripId }) });
  };

  const read = async (tripId: string, query: string, token?: string) =>
    GET(
      new NextRequest(`http://localhost/api/trips/${tripId}/day-plan-items/documents?${query}`, {
        method: "GET",
        headers: token ? { cookie: `session=${token}` } : {},
      }),
      { params: Promise.resolve({ id: tripId }) },
    );

  const listFiles = async (tripId: string, dayId: string, itemId: string) =>
    fs.readdir(getDayPlanItemDocumentUploadDir(tripId, dayId, itemId)).catch(() => [] as string[]);

  const pdfFile = (name = "Museum ticket.pdf") =>
    new File([Buffer.from("%PDF-1.4 fake")], name, { type: "application/pdf" });

  it("refuses an anonymous read, a POST without CSRF and a non-owner's write", async () => {
    const { trip, day, item, token } = await seed("guards");

    const anonymous = await read(trip.id, `tripDayId=${day.id}&dayPlanItemId=${item.id}`);
    expect(anonymous.status).toBe(401);

    const noCsrf = await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, pdfFile(), {
      token,
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as ApiEnvelope<null>).error?.code).toBe("csrf_invalid");

    const stranger = await prisma.user.create({
      data: { email: "item-documents-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const strangerUpload = await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, pdfFile(), {
      token: strangerToken,
    });
    expect(strangerUpload.status).toBe(404);

    const strangerRead = await read(trip.id, `tripDayId=${day.id}&dayPlanItemId=${item.id}`, strangerToken);
    expect(strangerRead.status).toBe(404);
    // The day-wide branch is scoped too, and by a different helper - it is refused separately or not
    // at all.
    const strangerDayWide = await read(trip.id, `tripDayId=${day.id}`, strangerToken);
    expect(strangerDayWide.status).toBe(404);

    expect(await listFiles(trip.id, day.id, item.id)).toEqual([]);
  });

  it("stores a PDF with a server-generated name and the user's name as a column", async () => {
    const { trip, day, item, token } = await seed("pdf");

    const response = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      pdfFile("Museum ticket.pdf"),
      { token },
    );
    const payload = (await response.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();

    const document = payload.data!.document;
    expect(document.fileName).toBe("Museum ticket.pdf");
    expect(document.sortOrder).toBe(1);
    expect(document.dayPlanItemId).toBe(item.id);
    expect(document.documentUrl).toMatch(
      new RegExp(
        `^/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${item.id}/documents/doc-\\d+-[a-z0-9]+\\.pdf$`,
      ),
    );
    expect(document.documentUrl).not.toContain("Museum");
    expect(await fs.readFile(resolveStoredMediaPath(document.documentUrl), "utf8")).toContain("%PDF-1.4");
  });

  it("accepts each image type as a document and refuses everything else", async () => {
    const { trip, day, item, token } = await seed("types");

    for (const [type, name, extension] of [
      ["image/jpeg", "boarding.jpg", "jpg"],
      ["image/png", "voucher.png", "png"],
      ["image/webp", "map.webp", "webp"],
    ] as const) {
      const response = await upload(
        trip.id,
        { tripDayId: day.id, dayPlanItemId: item.id },
        new File([Buffer.from("bytes")], name, { type }),
        { token },
      );
      const payload = (await response.json()) as ApiEnvelope<{ document: DocumentPayload }>;
      expect(response.status, type).toBe(200);
      expect(payload.data?.document.documentUrl.endsWith(`.${extension}`), type).toBe(true);
    }

    const refused = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      new File([Buffer.from("notes")], "notes.txt", { type: "text/plain" }),
      { token },
    );
    const refusedPayload = (await refused.json()) as ApiEnvelope<null>;
    expect(refused.status).toBe(400);
    expect(refusedPayload.error?.message).toBe("Invalid document type");
    expect(await listFiles(trip.id, day.id, item.id)).toHaveLength(3);
  });

  /**
   * The day-wide branch. Two activities, so "grouped by item" is actually exercised, and a viewer, so
   * the read scope is the participant one and not the owner-only one the writes use.
   */
  it("answers for the whole day when dayPlanItemId is omitted", async () => {
    const { trip, day, item, token } = await seed("daywide");
    const second = await prisma.dayPlanItem.create({ data: { tripDayId: day.id, contentJson: CONTENT_JSON } });

    const viewer = await prisma.user.create({
      data: { email: "item-documents-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, pdfFile("First.pdf"), { token });
    await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, pdfFile("Second.pdf"), { token });
    await upload(trip.id, { tripDayId: day.id, dayPlanItemId: second.id }, pdfFile("Other.pdf"), { token });

    const scoped = await read(trip.id, `tripDayId=${day.id}&dayPlanItemId=${item.id}`, token);
    const scopedPayload = (await scoped.json()) as ApiEnvelope<{ documents: DocumentPayload[] }>;
    expect(scoped.status).toBe(200);
    expect(scopedPayload.data?.documents.map((entry) => entry.fileName)).toEqual(["First.pdf", "Second.pdf"]);

    const dayWide = await read(trip.id, `tripDayId=${day.id}`, token);
    const dayWidePayload = (await dayWide.json()) as ApiEnvelope<{ documents: DocumentPayload[] }>;
    expect(dayWide.status).toBe(200);
    expect(dayWidePayload.data?.documents).toHaveLength(3);
    expect(new Set(dayWidePayload.data?.documents.map((entry) => entry.dayPlanItemId))).toEqual(
      new Set([item.id, second.id]),
    );
    expect(
      dayWidePayload.data?.documents
        .filter((entry) => entry.dayPlanItemId === item.id)
        .map((entry) => entry.fileName),
    ).toEqual(["First.pdf", "Second.pdf"]);

    // A viewer sees the day's documents, which is the read gate the timeline needs.
    const viewerDayWide = await read(trip.id, `tripDayId=${day.id}`, viewerToken);
    expect(viewerDayWide.status).toBe(200);
    expect(((await viewerDayWide.json()) as ApiEnvelope<{ documents: DocumentPayload[] }>).data?.documents).toHaveLength(
      3,
    );

    // The trip day is still required; without it there is nothing to scope the read to.
    const noDay = await read(trip.id, "dayPlanItemId=whatever", token);
    expect(noDay.status).toBe(400);
  });

  /**
   * The sibling suite carries the reasoning in full. Repeated here rather than trusted to it because
   * `resolveUploadExtension` is a *copy* in each route - the same shape `ALLOWED_TYPES` is - so a fix
   * applied to one of them and not the other is exactly the drift this suite exists to catch.
   */
  it("resolves the extension case-insensitively, falls back to the name, and refuses a prototype key", async () => {
    const { trip, day, item, token } = await seed("type-resolution");
    const fields = { tripDayId: day.id, dayPlanItemId: item.id };

    const upperCase = await upload(trip.id, fields, pdfFile("Museum.pdf"), { token });
    expect(upperCase.status).toBe(200);

    const noType = await upload(
      trip.id,
      fields,
      new File([Buffer.from("%PDF-1.4 fake")], "Guide.PDF", { type: "" }),
      { token },
    );
    const noTypePayload = (await noType.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(noType.status).toBe(200);
    expect(noTypePayload.data?.document.documentUrl.endsWith(".pdf")).toBe(true);

    const prototypeKey = await upload(
      trip.id,
      fields,
      new File([Buffer.from("payload")], "ticket", { type: "constructor" }),
      { token },
    );
    expect(prototypeKey.status).toBe(400);
    expect(((await prototypeKey.json()) as ApiEnvelope<null>).error?.message).toBe("Invalid document type");
    expect(await listFiles(trip.id, day.id, item.id)).toHaveLength(2);
  });

  /**
   * `tripDayId` and `dayPlanItemId` are path components of the entry's `documents` directory, and `POST`
   * builds that directory before the repository has confirmed the entry exists - so the refusal has to
   * precede `fs.mkdir`, which a status code alone does not say. Asserted at the boundary too.
   */
  it("refuses an id that is not a single safe path segment, before anything reaches the filesystem", async () => {
    const { trip, day, item, token } = await seed("traversal");
    const escapeTarget = `${uploadsRoot}/../../day-plan-documents-escape-probe`;
    await fs.rm(escapeTarget, { recursive: true, force: true });

    const hostile: [string, { tripDayId: string; dayPlanItemId: string }][] = [
      ["traversing tripDayId", { tripDayId: "../../day-plan-documents-escape-probe", dayPlanItemId: item.id }],
      ["traversing dayPlanItemId", { tripDayId: day.id, dayPlanItemId: ".." }],
      ["separator in an id", { tripDayId: `${day.id}/nested`, dayPlanItemId: item.id }],
    ];

    for (const [label, fields] of hostile) {
      const response = await upload(trip.id, fields, pdfFile(), { token });
      expect(response.status, label).toBe(400);
      expect(((await response.json()) as ApiEnvelope<null>).error?.code, label).toBe("validation_error");
    }

    await expect(fs.stat(escapeTarget)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listFiles(trip.id, day.id, item.id)).toHaveLength(0);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);
  });

  it("refuses a file over 10 MB on the file-size check when no content-length was sent", async () => {
    const { trip, day, item, token } = await seed("oversize");

    const oversized = new File([Buffer.alloc(10 * 1024 * 1024 + 1, 0x5a)], "huge.pdf", {
      type: "application/pdf",
    });
    const response = await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, oversized, { token });
    const payload = (await response.json()) as ApiEnvelope<null>;
    expect(response.status).toBe(400);
    expect(payload.error?.message).toContain("exceeds size limit");
    expect(await listFiles(trip.id, day.id, item.id)).toEqual([]);
  });

  /**
   * The `declaredBodyExceedsFileLimit` path: these routes fall inside the middleware matcher, so Next
   * truncates a body over `proxyClientMaxBodySize` rather than refusing it, and without the pre-check
   * an intact 25 MB ticket is answered `invalid_form_data` - "this file is damaged" for a file that is
   * fine. The assertion is on the message, not merely on the 400.
   */
  it("answers the size message rather than invalid_form_data for a declared oversize body", async () => {
    const { trip, token } = await seed("declaredoversize");

    const request = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/documents`, {
      method: "POST",
      headers: {
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
        "content-type": "multipart/form-data; boundary=xyz",
        "content-length": String(25 * 1024 * 1024),
      },
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
    const { trip, day, item, token } = await seed("filename");

    const traversal = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      new File([Buffer.from("%PDF-")], "../../etc/passwd", { type: "application/pdf" }),
      { token },
    );
    expect(
      ((await traversal.json()) as ApiEnvelope<{ document: DocumentPayload }>).data?.document.fileName,
    ).toBe("passwd");

    const windowsPath = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      new File([Buffer.from("%PDF-")], "C:\\Users\\tommy\\Museum ticket.pdf", { type: "application/pdf" }),
      { token },
    );
    expect(
      ((await windowsPath.json()) as ApiEnvelope<{ document: DocumentPayload }>).data?.document.fileName,
    ).toBe("Museum ticket.pdf");

    const onDisk = await listFiles(trip.id, day.id, item.id);
    expect(onDisk).toHaveLength(2);
    for (const name of onDisk) {
      expect(name).toMatch(/^doc-\d+-[a-z0-9]+\.pdf$/);
    }
  });

  it("refuses the eleventh document and leaves no file behind", async () => {
    const { trip, day, item, token } = await seed("cap");

    for (let index = 0; index < MAX_DOCUMENTS_PER_ENTRY; index += 1) {
      const response = await upload(
        trip.id,
        { tripDayId: day.id, dayPlanItemId: item.id },
        pdfFile(`Ticket ${index}.pdf`),
        { token },
      );
      expect(response.status, `document ${index}`).toBe(200);
    }

    const eleventh = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      pdfFile("Eleventh.pdf"),
      { token },
    );
    const payload = (await eleventh.json()) as ApiEnvelope<null>;
    expect(eleventh.status).toBe(400);
    expect(payload.error?.message).toBe("Document limit reached");
    expect(await listFiles(trip.id, day.id, item.id)).toHaveLength(MAX_DOCUMENTS_PER_ENTRY);
    expect(await prisma.dayPlanItemDocument.count()).toBe(MAX_DOCUMENTS_PER_ENTRY);
  });

  it("leaves no file behind when the insert cannot find its entry", async () => {
    const { trip, day, token } = await seed("failedinsert");
    const ghostId = "cmghostplanitem000000";

    const response = await upload(trip.id, { tripDayId: day.id, dayPlanItemId: ghostId }, pdfFile(), { token });
    expect(response.status).toBe(404);
    expect(await listFiles(trip.id, day.id, ghostId)).toEqual([]);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);
  });

  it("deletes the row and unlinks the file, and still succeeds when the file is already gone", async () => {
    const { trip, day, item, token } = await seed("delete");

    const first = (await (
      await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, pdfFile("One.pdf"), { token })
    ).json()) as ApiEnvelope<{ document: DocumentPayload }>;
    const second = (await (
      await upload(trip.id, { tripDayId: day.id, dayPlanItemId: item.id }, pdfFile("Two.pdf"), { token })
    ).json()) as ApiEnvelope<{ document: DocumentPayload }>;

    const firstPath = resolveStoredMediaPath(first.data!.document.documentUrl);
    const secondPath = resolveStoredMediaPath(second.data!.document.documentUrl);

    const remove = async (documentId: string) =>
      DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/documents`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${token}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({ tripDayId: day.id, dayPlanItemId: item.id, documentId }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

    const deleted = await remove(first.data!.document.id);
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as ApiEnvelope<{ deleted: boolean }>).data?.deleted).toBe(true);
    expect(await prisma.dayPlanItemDocument.count()).toBe(1);
    await expect(fs.access(firstPath)).rejects.toThrow();

    await fs.rm(secondPath, { force: true });
    const orphanDelete = await remove(second.data!.document.id);
    expect(orphanDelete.status).toBe(200);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);

    const missing = await remove(second.data!.document.id);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiEnvelope<null>).error?.message).toBe("Document not found");
  });

  /**
   * Story 5.13, AC1/AC4/AC6 - the activity twin of the stay case. The contributor's account row is
   * `role: "VIEWER"` on purpose, so a regression reading `User.role` instead of `TripMember.role`
   * fails here.
   */
  it("lets a contributor upload and delete, refuses a viewer 403 forbidden and a stranger 404", async () => {
    const { trip, day, item } = await seed("roles");

    const contributor = await prisma.user.create({
      data: { email: "item-documents-roles-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributorToken = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const viewer = await prisma.user.create({
      data: { email: "item-documents-roles-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const stranger = await prisma.user.create({
      data: { email: "item-documents-roles-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });

    const remove = (sessionToken: string, documentId: string) =>
      DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/documents`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${sessionToken}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({ tripDayId: day.id, dayPlanItemId: item.id, documentId }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

    const contributorUpload = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      pdfFile("Contributor ticket.pdf"),
      { token: contributorToken },
    );
    const contributorPayload = (await contributorUpload.json()) as ApiEnvelope<{ document: DocumentPayload }>;
    expect(contributorUpload.status).toBe(200);
    expect(contributorPayload.error).toBeNull();
    const documentId = contributorPayload.data!.document.id;
    // Both layers: the route admitted her and the repository scope wrote the row.
    expect(await prisma.dayPlanItemDocument.findUnique({ where: { id: documentId } })).not.toBeNull();

    // The viewer keeps her read - AC4 takes nothing away - but loses both writes with a stated reason.
    const viewerRead = await read(trip.id, `tripDayId=${day.id}&dayPlanItemId=${item.id}`, viewerToken);
    expect(viewerRead.status).toBe(200);

    const viewerUpload = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      pdfFile("Viewer ticket.pdf"),
      { token: viewerToken },
    );
    expect(viewerUpload.status).toBe(403);
    expect(((await viewerUpload.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");

    const viewerDelete = await remove(viewerToken, documentId);
    expect(viewerDelete.status).toBe(403);
    expect(((await viewerDelete.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    expect(await prisma.dayPlanItemDocument.findUnique({ where: { id: documentId } })).not.toBeNull();

    // The stranger keeps 404: AC6 moves the *role* refusal only, never the existence question.
    const strangerUpload = await upload(
      trip.id,
      { tripDayId: day.id, dayPlanItemId: item.id },
      pdfFile("Stranger ticket.pdf"),
      { token: strangerToken },
    );
    expect(strangerUpload.status).toBe(404);
    expect(((await strangerUpload.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");

    const strangerDelete = await remove(strangerToken, documentId);
    expect(strangerDelete.status).toBe(404);

    const contributorDelete = await remove(contributorToken, documentId);
    expect(contributorDelete.status).toBe(200);
    expect(await prisma.dayPlanItemDocument.findUnique({ where: { id: documentId } })).toBeNull();
  });
});
