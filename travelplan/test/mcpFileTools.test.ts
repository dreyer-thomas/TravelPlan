import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import type https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as packetGET } from "@/app/api/trips/[id]/days/[dayId]/documents/packet/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { guardedFetch, type GuardedFetchDeps, type GuardedLookup } from "@/lib/http/guardedFetch";
import { fileToolDeps, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS } from "@/lib/mcp/tools/fileTools";
import { deleteFileForConnector } from "@/lib/repositories/connectorFileRepo";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";
import { DOCUMENT_LIMIT_ERROR_MESSAGE } from "@/lib/trips/documentUploads";
import {
  getAccommodationImageUploadDir,
  getDayPlanItemDocumentUploadDir,
  getParkedDayPlanItemDocumentUploadDir,
  getTripsUploadRoot,
  resolveStoredMediaPath,
} from "@/lib/trips/uploadPaths";
import { cleanOAuthTables, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool } from "./helpers/mcpClient";
import { plannerDoc } from "./helpers/plannerFixtures";
import { realPdfBytes } from "./helpers/packetFixtures";
import { jpegBytes, pdfBytes, pngBytes, writeUploadFile } from "./helpers/uploadFixtures";
import {
  errorText,
  getDay,
  setupConnectorTrip,
  STALE_UNDO,
  storedReceipt,
  structured,
  stubNetworkSeams,
} from "./helpers/connectorWriteFixtures";

/**
 * Story 15.7. `get_file`, `attach_file` and `delete_file` end to end: a real token through `POST /api/mcp`,
 * real bytes in the per-worker media root (`test/setup.ts`), every I/O-matrix row for the owner and a
 * contributor. Downloads go through `fileToolDeps.fetch`: answered directly where only the bytes matter,
 * and through the real `guardedFetch` over fake DNS and request deps (as in `guardedFetch.test.ts`) where
 * the SSRF guard is what is being tested. No socket is ever opened.
 */

setupConnectorEnvironment();

const MIB = 1024 * 1024;

const rateLimitStore = () => (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore;

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
  // Every upload and tool-call budget from an earlier test, so each one starts with its full allowance.
  for (const key of [...(rateLimitStore()?.keys() ?? [])]) {
    if (key.startsWith("mcp-upload:") || key.startsWith("mcp-tool:")) rateLimitStore()?.delete(key);
  }
  stubNetworkSeams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type FileEntry = { id: string; fileName: string; updatedAt: string };
type Day = {
  id: string;
  activities: { id: string; documents: FileEntry[]; images: FileEntry[] }[];
  stay: { id: string; documents: FileEntry[]; images: FileEntry[] } | null;
};
type AttachResult = {
  aiChangeId: string | null;
  file: { id: string; fileName: string; media: string; mimeType: string; sizeBytes: number; updatedAt: string };
  day?: Day;
};
type FileMetadata = {
  id: string;
  fileName: string;
  media: string;
  target: { type: string; id: string };
  mimeType: string;
  sizeBytes: number | null;
  updatedAt: string;
  aiChangedAt: string | null;
  available: boolean;
  note?: string;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Everything below the trip's upload tree: what a refusal must leave untouched. */
const filesUnder = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
};

const exists = (url: string) =>
  fs
    .stat(resolveStoredMediaPath(url))
    .then(() => true)
    .catch(() => false);

const packet = async (user: { id: string; role: string }, tripId: string, dayId: string) => {
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  return packetGET(
    new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/documents/packet`, {
      method: "GET",
      headers: { cookie: `session=${session}` },
    }),
    { params: Promise.resolve({ id: tripId, dayId }) },
  );
};

const pageCount = async (response: Response) => (await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))).getPageCount();

/** A fake `https.request`/DNS pair for the real `guardedFetch` (the `guardedFetch.test.ts` pattern). */
type FakeResponse = { status: number; headers?: Record<string, string>; body?: Buffer };
const buildFetchDeps = (dnsTable: Record<string, string[]>, responses: Record<string, FakeResponse>) => {
  const connected: string[] = [];
  const lookup: GuardedLookup = (hostname, _options, callback) => {
    const addresses = dnsTable[hostname];
    if (!addresses) {
      const error: NodeJS.ErrnoException = new Error("not found");
      error.code = "ENOTFOUND";
      callback(error, []);
      return;
    }
    callback(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  };
  const request = ((options: https.RequestOptions, onResponse: (response: unknown) => void) => {
    const emitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    emitter.destroy = () => {
      queueMicrotask(() => emitter.emit("close"));
    };
    emitter.end = () => {
      const host = String(options.hostname);
      (options.lookup as unknown as (h: string, o: { all: boolean }, cb: (...args: unknown[]) => void) => void)(
        host,
        { all: true },
        (error: unknown) => {
          if (error) {
            emitter.emit("error", error);
            return;
          }
          connected.push(`${host}${options.path}`);
          const spec = responses[`${host}${options.path}`] ?? { status: 404 };
          const response = Readable.from(spec.body ? [spec.body] : []) as Readable & {
            statusCode: number;
            headers: Record<string, string>;
          };
          response.statusCode = spec.status;
          response.headers = spec.headers ?? {};
          onResponse(response);
        },
      );
    };
    return emitter;
  }) as unknown as typeof https.request;
  const deps: GuardedFetchDeps = { lookup, request };
  vi.spyOn(fileToolDeps, "fetch").mockImplementation((url, options) => guardedFetch(url, options, deps));
  return { connected };
};

/** A seeded trip plus an activity on day 1 (no other documents that day) and its day-1 stay. */
const setup = async () => {
  const connector = await setupConnectorTrip();
  const { seed } = connector;
  const train = await prisma.dayPlanItem.create({
    data: {
      tripId: seed.trip.id,
      tripDayId: seed.day1.id,
      title: "Train to Prague",
      contentJson: plannerDoc("Train"),
      scheduleMode: "FLEXIBLE",
      durationMinutes: 120,
      sortOrder: 0,
    },
  });
  return { ...connector, train };
};

describe.each(["owner", "contributor"] as const)("attach_file as %s", (role) => {
  it("attaches an inline PDF to an activity: marked row, the app's folder, one change, in the packet; undo removes both", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token, user } = context[role];
    const tripId = seed.trip.id;
    const pdf = await realPdfBytes(2);

    const result = structured<AttachResult>(
      await callTool(token, "attach_file", {
        tripId,
        target: "activity",
        id: train.id,
        fileName: "ticket.pdf",
        contentBase64: b64(pdf),
      }),
    );
    expect(result.file).toMatchObject({ fileName: "ticket.pdf", media: "document", mimeType: "application/pdf", sizeBytes: pdf.length });
    // No storage path or `/uploads` URL ever reaches the model.
    expect(JSON.stringify(result)).not.toContain("/uploads");

    const row = await prisma.dayPlanItemDocument.findUniqueOrThrow({ where: { id: result.file.id } });
    expect(row).toMatchObject({ dayPlanItemId: train.id, fileName: "ticket.pdf", sortOrder: 1 });
    expect(row.aiChangedAt).not.toBeNull();
    expect(row.documentUrl).toMatch(
      new RegExp(`^/uploads/trips/${tripId}/days/${seed.day1.id}/day-plan-items/${train.id}/documents/doc-\\d+-[a-z0-9]+\\.pdf$`),
    );
    const onDisk = path.join(getDayPlanItemDocumentUploadDir(tripId, seed.day1.id, train.id), path.basename(row.documentUrl));
    expect(Buffer.from(await fs.readFile(onDisk)).equals(Buffer.from(pdf))).toBe(true);

    const changes = await prisma.aiChange.findMany();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: result.aiChangeId, action: "fileAttached", subject: "ticket.pdf", tripDayId: seed.day1.id });
    expect((await storedReceipt(result.aiChangeId!)).edited).toMatchObject({
      kind: "fileAttached",
      target: "activity",
      media: "document",
      parentId: train.id,
      fileId: row.id,
    });
    // `get_day` lists the file with the stamp delete_file takes back.
    expect(result.day?.activities[0].documents).toEqual([{ id: row.id, fileName: "ticket.pdf", updatedAt: row.updatedAt.toISOString() }]);
    expect((await getDay<Day>(token, tripId, seed.day1.id)).activities[0].documents[0].updatedAt).toBe(result.file.updatedAt);
    const listed = structured<{ changes: { summary: string; undoable: boolean }[] }>(
      await callTool(token, "list_ai_changes", { tripId }),
    );
    expect(listed.changes[0]).toMatchObject({ summary: 'Attached file "ticket.pdf"', undoable: true });

    // Where the day packet finds it: a label page and the ticket's two pages.
    const built = await packet(user, tripId, seed.day1.id);
    expect(built.status).toBe(200);
    expect(await pageCount(built)).toBe(3);

    expect(structured(await callTool(token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toEqual({
      undone: true,
      changeId: result.aiChangeId,
    });
    expect(await prisma.dayPlanItemDocument.count({ where: { id: row.id } })).toBe(0);
    expect(await exists(row.documentUrl)).toBe(false);
  });

  it("attaches a URL image to a stay by its content, ignoring the server's content-type; undo removes row and file", async () => {
    const context = await setup();
    const { seed } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const png = pngBytes(200);
    const fetch = vi.spyOn(fileToolDeps, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "text/html" },
      body: new Uint8Array(png),
      url: "https://photos.example/hotel",
    });

    const result = structured<AttachResult>(
      await callTool(token, "attach_file", {
        tripId,
        target: "stay",
        id: seed.stay.id,
        fileName: "hotel.html",
        as: "image",
        url: "https://photos.example/hotel",
      }),
    );
    expect(fetch).toHaveBeenCalledWith("https://photos.example/hotel", { maxBytes: 5 * MIB, timeoutMs: 15_000, maxRedirects: 3 });
    expect(result.file).toMatchObject({ media: "image", mimeType: "image/png", sizeBytes: png.length });
    expect(result.file.fileName).toMatch(/^img-\d+-[a-z0-9]+\.png$/);
    const row = await prisma.accommodationImage.findUniqueOrThrow({ where: { id: result.file.id } });
    expect(row.accommodationId).toBe(seed.stay.id);
    expect(row.aiChangedAt).not.toBeNull();
    expect(row.imageUrl).toBe(`/uploads/trips/${tripId}/days/${seed.day2.id}/accommodations/${seed.stay.id}/${result.file.fileName}`);
    const onDisk = path.join(getAccommodationImageUploadDir(tripId, seed.day2.id, seed.stay.id), result.file.fileName);
    expect((await fs.readFile(onDisk)).equals(png)).toBe(true);
    expect((await storedReceipt(result.aiChangeId!)).edited).toMatchObject({ kind: "fileAttached", target: "stay", media: "image" });
    // An image keeps no name: the change is listed under the stored one get_day shows, not the model's.
    const change = await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId! } });
    expect(change.subject).toBe(result.file.fileName);
    expect(result.day?.stay?.images.map((image) => image.id)).toContain(row.id);

    expect(structured(await callTool(token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toMatchObject({ undone: true });
    expect(await prisma.accommodationImage.count({ where: { id: row.id } })).toBe(0);
    expect(await exists(row.imageUrl)).toBe(false);
  });

  it("refuses too large content, inline and by URL, writing nothing", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const base = { tripId, target: "activity", id: train.id, fileName: "ticket.pdf" };

    const inline = Buffer.concat([pdfBytes(0), Buffer.alloc(MIB, 0x20)]);
    expect(errorText(await callTool(token, "attach_file", { ...base, contentBase64: b64(inline) }))).toBe(
      "The file is larger than 1 MB; pass a url to download it instead.",
    );

    buildFetchDeps(
      { "files.example": ["93.184.216.34"] },
      { "files.example/big.pdf": { status: 200, body: Buffer.concat([pdfBytes(0), Buffer.alloc(10 * MIB, 0x20)]) } },
    );
    expect(errorText(await callTool(token, "attach_file", { ...base, url: "https://files.example/big.pdf" }))).toBe(
      "The file is larger than 10 MB.",
    );

    expect(await prisma.dayPlanItemDocument.count({ where: { dayPlanItemId: train.id } })).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });

  it("refuses bytes that are not a PDF whatever the name says, naming the accepted types, writing nothing", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;

    const html = Buffer.from("<!doctype html><html><body>ticket</body></html>");
    expect(
      errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "ticket.pdf", contentBase64: b64(html) })),
    ).toBe("Only PDF, JPEG, PNG and WebP files can be attached as documents; this file is none of them.");
    // A PDF is a document, never an image.
    expect(
      errorText(
        await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.jpg", as: "image", contentBase64: b64(pdfBytes()) }),
      ),
    ).toBe("Only JPEG, PNG and WebP files can be attached as images; this file is none of them.");

    expect(await prisma.dayPlanItemDocument.count({ where: { dayPlanItemId: train.id } })).toBe(0);
    expect(await prisma.dayPlanItemImage.count({ where: { dayPlanItemId: train.id } })).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });

  it("refuses a literal IP, a private or metadata address, and a redirect into a private network, through the real guard", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const base = { tripId: seed.trip.id, target: "activity", id: train.id, fileName: "ticket.pdf" };
    const { connected } = buildFetchDeps(
      {
        "private.example": ["10.0.0.5"],
        "metadata.example": ["169.254.169.254"],
        "public.example": ["93.184.216.34"],
        "internal.example": ["192.168.1.1"],
      },
      {
        "public.example/ticket.pdf": { status: 302, headers: { location: "https://internal.example/ticket.pdf" } },
        "internal.example/ticket.pdf": { status: 200, body: pdfBytes() },
      },
    );

    expect(errorText(await callTool(token, "attach_file", { ...base, url: "https://127.0.0.1/x" }))).toBe(
      "Only https URLs on port 443 with a host name are accepted.",
    );
    for (const url of ["https://private.example/x", "https://metadata.example/latest", "https://public.example/ticket.pdf"]) {
      expect(errorText(await callTool(token, "attach_file", { ...base, url })), url).toBe("That address is not public.");
    }
    // Only the public hop was ever connected to; the redirect target was refused at DNS.
    expect(connected).toEqual(["public.example/ticket.pdf"]);
    expect(await prisma.dayPlanItemDocument.count({ where: { dayPlanItemId: train.id } })).toBe(0);
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });

  it("maps a failed download and a non-2xx answer to short refusals", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const base = { tripId: seed.trip.id, target: "activity", id: train.id, fileName: "ticket.pdf" };
    buildFetchDeps({ "files.example": ["93.184.216.34"] }, { "files.example/gone.pdf": { status: 404 } });

    expect(errorText(await callTool(token, "attach_file", { ...base, url: "https://files.example/gone.pdf" }))).toBe(
      "The download failed (HTTP 404).",
    );
    expect(errorText(await callTool(token, "attach_file", { ...base, url: "https://nowhere.example/x.pdf" }))).toBe(
      "The download failed.",
    );
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });

  it("refuses an entry already holding 10 documents before any download, using no upload slot", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token, user } = context[role];
    await prisma.dayPlanItemDocument.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        dayPlanItemId: train.id,
        documentUrl: `/uploads/trips/${seed.trip.id}/x/doc-${index}.pdf`,
        fileName: `doc-${index}.pdf`,
        sortOrder: index,
      })),
    });
    const fetch = vi.spyOn(fileToolDeps, "fetch");

    expect(
      errorText(
        await callTool(token, "attach_file", {
          tripId: seed.trip.id,
          target: "activity",
          id: train.id,
          fileName: "ticket.pdf",
          url: "https://files.example/ticket.pdf",
        }),
      ),
    ).toContain(DOCUMENT_LIMIT_ERROR_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
    expect(rateLimitStore()?.has(`mcp-upload:${user.id}`)).toBe(false);
    expect(await prisma.dayPlanItemDocument.count({ where: { dayPlanItemId: train.id } })).toBe(10);
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });

  it("refuses the 51st upload within the hour", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token, user } = context[role];
    for (let index = 0; index < UPLOAD_RATE_LIMIT - 1; index += 1) {
      checkRateLimit(`mcp-upload:${user.id}`, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS);
    }
    const args = { tripId: seed.trip.id, target: "activity", id: train.id, fileName: "a.jpg", as: "image", contentBase64: b64(jpegBytes()) };

    structured(await callTool(token, "attach_file", args));
    expect(errorText(await callTool(token, "attach_file", args))).toBe("Upload limit reached (50 per hour); try again later.");
    expect(await prisma.dayPlanItemImage.count({ where: { dayPlanItemId: train.id } })).toBe(1);
  });

  it("refuses an unknown entry, an unusable name, both or neither source, and invalid base64", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const content = b64(pdfBytes());

    expect(errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: "nope", fileName: "a.pdf", contentBase64: content }))).toBe(
      "Activity not found",
    );
    // A stay's id is no activity, and an activity's no stay.
    expect(errorText(await callTool(token, "attach_file", { tripId, target: "stay", id: train.id, fileName: "a.pdf", contentBase64: content }))).toBe(
      "Stay not found",
    );
    expect(errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: " / ", contentBase64: content }))).toBe(
      "fileName has no usable characters; give the file's name, e.g. ticket.pdf.",
    );
    expect(
      errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: content, url: "https://x.example/a" })),
    ).toContain("Give exactly one of contentBase64 or url.");
    expect(errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf" }))).toContain(
      "Give exactly one of contentBase64 or url.",
    );
    expect(
      errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: `${content.slice(0, 8)}\n${content.slice(8)}` })),
    ).toContain("not valid base64");
    expect(errorText(await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: "" }))).toBe(
      "The file is empty.",
    );
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });

  it("attaches to a parked activity in its parked folder, without undo", async () => {
    const context = await setup();
    const { seed } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;

    const result = structured<AttachResult>(
      await callTool(token, "attach_file", { tripId, target: "activity", id: seed.zoo.id, fileName: "zoo.pdf", contentBase64: b64(pdfBytes()) }),
    );
    expect(result).not.toHaveProperty("day");
    const row = await prisma.dayPlanItemDocument.findUniqueOrThrow({ where: { id: result.file.id } });
    expect(row.documentUrl.startsWith(`/uploads/trips/${tripId}/parked/day-plan-items/${seed.zoo.id}/documents/doc-`)).toBe(true);
    expect(await filesUnder(getParkedDayPlanItemDocumentUploadDir(tripId, seed.zoo.id))).toHaveLength(1);
    const change = await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId! } });
    expect(change).toMatchObject({ action: "fileAttached", tripDayId: null, receiptJson: null });
  });
});

describe.each(["owner", "contributor"] as const)("get_file as %s", (role) => {
  it("returns a small file as an embedded resource with its metadata", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const pdf = await realPdfBytes(1);
    const attached = structured<AttachResult>(
      await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "Ticket.pdf", contentBase64: b64(pdf) }),
    );

    const body = await callTool(token, "get_file", { tripId, fileId: attached.file.id });
    const metadata = structured<FileMetadata>(body);
    expect(metadata).toEqual({
      id: attached.file.id,
      fileName: "Ticket.pdf",
      media: "document",
      target: { type: "activity", id: train.id },
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      updatedAt: attached.file.updatedAt,
      aiChangedAt: expect.any(String),
      available: true,
    });
    const [text, resource] = body.result!.content!;
    expect(JSON.parse(text.text!)).toEqual(metadata);
    expect(resource.type).toBe("resource");
    expect(resource.resource).toMatchObject({ uri: `travelplan://trips/${tripId}/files/${attached.file.id}`, mimeType: "application/pdf" });
    expect(Buffer.from(resource.resource!.blob!, "base64").equals(Buffer.from(pdf))).toBe(true);
    expect(JSON.stringify(body)).not.toContain("/uploads");
  });

  it("answers metadata only for a file over 10 MB, and available false for a URL into another trip", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const dir = getDayPlanItemDocumentUploadDir(tripId, seed.day1.id, train.id);
    await writeUploadFile(dir, "doc-big.pdf", pdfBytes());
    await fs.truncate(path.join(dir, "doc-big.pdf"), 10 * MIB + 1);
    const big = await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: train.id,
        documentUrl: `/uploads/trips/${tripId}/days/${seed.day1.id}/day-plan-items/${train.id}/documents/doc-big.pdf`,
        fileName: "Big.pdf",
        sortOrder: 0,
      },
    });
    // A row that points into another trip's tree, whose file does exist there.
    const otherDir = getDayPlanItemDocumentUploadDir("other-trip", "d", "i");
    await writeUploadFile(otherDir, "doc-x.pdf", pdfBytes());
    const foreign = await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: train.id, documentUrl: "/uploads/trips/other-trip/days/d/day-plan-items/i/documents/doc-x.pdf", fileName: "X.pdf", sortOrder: 1 },
    });

    const bigBody = await callTool(token, "get_file", { tripId, fileId: big.id });
    expect(bigBody.result?.content).toHaveLength(1);
    expect(structured<FileMetadata>(bigBody)).toMatchObject({ available: true, sizeBytes: 10 * MIB + 1, mimeType: "application/pdf" });
    expect(structured<FileMetadata>(bigBody).note).toContain("too large to transfer");

    const foreignBody = await callTool(token, "get_file", { tripId, fileId: foreign.id });
    expect(foreignBody.result?.content).toHaveLength(1);
    expect(structured<FileMetadata>(foreignBody)).toMatchObject({ available: false, sizeBytes: null, mimeType: "application/pdf" });

    // A seeded image whose file was never written: metadata, the URL's last segment as its name.
    const image = await prisma.dayPlanItemImage.findFirstOrThrow({ where: { dayPlanItemId: seed.dinner.id } });
    expect(structured<FileMetadata>(await callTool(token, "get_file", { tripId, fileId: image.id }))).toMatchObject({
      fileName: "table.webp",
      media: "image",
      target: { type: "activity", id: seed.dinner.id },
      mimeType: "image/webp",
      available: false,
    });
    expect(errorText(await callTool(token, "get_file", { tripId, fileId: "nope" }))).toBe("File not found");
  });
});

describe.each(["owner", "contributor"] as const)("delete_file as %s", (role) => {
  it("deletes a document and keeps its file; undo restores the row exactly and the packet has it again", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token, user } = context[role];
    const tripId = seed.trip.id;
    const pdf = await realPdfBytes(2);
    const dir = getDayPlanItemDocumentUploadDir(tripId, seed.day1.id, train.id);
    await writeUploadFile(dir, "doc-1.pdf", Buffer.from(pdf));
    const marked = new Date("2027-04-01T08:00:00.000Z");
    const before = await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: train.id,
        documentUrl: `/uploads/trips/${tripId}/days/${seed.day1.id}/day-plan-items/${train.id}/documents/doc-1.pdf`,
        fileName: "Ticket.pdf",
        sortOrder: 4,
        aiChangedAt: marked,
      },
    });

    expect(
      errorText(await callTool(token, "delete_file", { tripId, fileId: before.id, updatedAt: "2020-01-01T00:00:00.000Z" })),
    ).toContain("This file changed since you read it");
    const result = structured<{ aiChangeId: string; deletedFileId: string; day: Day }>(
      await callTool(token, "delete_file", { tripId, fileId: before.id, updatedAt: before.updatedAt.toISOString() }),
    );
    expect(result.deletedFileId).toBe(before.id);
    expect(result.day.activities[0].documents).toEqual([]);
    expect(await prisma.dayPlanItemDocument.count({ where: { id: before.id } })).toBe(0);
    expect(await exists(before.documentUrl)).toBe(true);
    const changes = await prisma.aiChange.findMany();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ action: "fileDeleted", subject: "Ticket.pdf", tripDayId: seed.day1.id });
    expect((await storedReceipt(result.aiChangeId)).edited).toMatchObject({ kind: "fileDeleted", target: "activity", media: "document" });
    expect((await packet(user, tripId, seed.day1.id)).status).toBe(404);

    expect(structured(await callTool(token, "undo_ai_change", { tripId, changeId: result.aiChangeId }))).toMatchObject({ undone: true });
    expect(await prisma.dayPlanItemDocument.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    const built = await packet(user, tripId, seed.day1.id);
    expect(built.status).toBe(200);
    expect(await pageCount(built)).toBe(3);
  });

  it("puts a restored row after the last one when its place was taken since", async () => {
    const context = await setup();
    const { seed } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const image = await prisma.dayPlanItemImage.findFirstOrThrow({ where: { dayPlanItemId: seed.dinner.id } });
    const dir = path.dirname(resolveStoredMediaPath(image.imageUrl));
    await writeUploadFile(dir, path.basename(image.imageUrl), jpegBytes());
    const result = structured<{ aiChangeId: string }>(
      await callTool(token, "delete_file", { tripId, fileId: image.id, updatedAt: image.updatedAt.toISOString() }),
    );
    await prisma.dayPlanItemImage.create({ data: { dayPlanItemId: seed.dinner.id, imageUrl: image.imageUrl, sortOrder: image.sortOrder } });

    structured(await callTool(token, "undo_ai_change", { tripId, changeId: result.aiChangeId }));
    const restored = await prisma.dayPlanItemImage.findUniqueOrThrow({ where: { id: image.id } });
    expect(restored.sortOrder).toBe(image.sortOrder + 1);
    expect(restored.updatedAt).toEqual(image.updatedAt);
  });

  it("refuses a delete whose activity changed day since the read, recording nothing", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token, user } = context[role];
    const tripId = seed.trip.id;
    const attached = structured<AttachResult>(
      await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: b64(pdfBytes()) }),
    );
    // The caller read the activity on day 1; it was parked before the delete ran.
    await expect(
      deleteFileForConnector({
        userId: user.id,
        tripId,
        target: "activity",
        media: "document",
        fileId: attached.file.id,
        expectedUpdatedAt: new Date(attached.file.updatedAt),
        expectedTripDayId: null,
        inTransaction: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(ChangedSinceReadError);
    expect(await prisma.dayPlanItemDocument.count({ where: { id: attached.file.id } })).toBe(1);
  });

  it("refuses the undo as stale once the activity is gone", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const attached = structured<AttachResult>(
      await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: b64(pdfBytes()) }),
    );
    const deleted = structured<{ aiChangeId: string }>(
      await callTool(token, "delete_file", { tripId, fileId: attached.file.id, updatedAt: attached.file.updatedAt }),
    );
    await prisma.dayPlanItem.delete({ where: { id: train.id } });

    expect(errorText(await callTool(token, "undo_ai_change", { tripId, changeId: deleted.aiChangeId }))).toBe(STALE_UNDO);
  });

  it("deletes a parked activity's file at once, without undo, as the app does", async () => {
    const context = await setup();
    const { seed } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const attached = structured<AttachResult>(
      await callTool(token, "attach_file", { tripId, target: "activity", id: seed.zoo.id, fileName: "zoo.pdf", contentBase64: b64(pdfBytes()) }),
    );
    const row = await prisma.dayPlanItemDocument.findUniqueOrThrow({ where: { id: attached.file.id } });

    const result = structured<{ aiChangeId: string }>(
      await callTool(token, "delete_file", { tripId, fileId: row.id, updatedAt: attached.file.updatedAt }),
    );
    expect(result).not.toHaveProperty("day");
    expect(await exists(row.documentUrl)).toBe(false);
    expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId } })).toMatchObject({
      action: "fileDeleted",
      receiptJson: null,
    });
    expect(errorText(await callTool(token, "delete_file", { tripId, fileId: row.id, updatedAt: attached.file.updatedAt }))).toBe(
      "File not found",
    );
  });

  it("sweeps a 15-day-old deletion on the next connector write: the row first, then the kept file", async () => {
    const context = await setup();
    const { seed, train } = context;
    const { token } = context[role];
    const tripId = seed.trip.id;
    const attached = structured<AttachResult>(
      await callTool(token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: b64(pdfBytes()) }),
    );
    const url = (await prisma.dayPlanItemDocument.findUniqueOrThrow({ where: { id: attached.file.id } })).documentUrl;
    const deleted = structured<{ aiChangeId: string }>(
      await callTool(token, "delete_file", { tripId, fileId: attached.file.id, updatedAt: attached.file.updatedAt }),
    );
    await prisma.aiChange.update({
      where: { id: deleted.aiChangeId },
      data: { createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
    });
    expect(await exists(url)).toBe(true);

    structured(await callTool(token, "create_activity", { tripId, dayId: seed.day3.id, title: "Next write" }));

    expect(await prisma.aiChange.count({ where: { id: deleted.aiChangeId } })).toBe(0);
    expect(await exists(url)).toBe(false);
  });
});

describe("the file tools for a viewer", () => {
  it("answer Trip not found, writing nothing", async () => {
    const context = await setup();
    const { seed, train, viewer } = context;
    const tripId = seed.trip.id;
    const document = await prisma.dayPlanItemDocument.findFirstOrThrow({ where: { dayPlanItemId: seed.dinner.id } });

    expect(errorText(await callTool(viewer.token, "get_file", { tripId, fileId: document.id }))).toBe("Trip not found");
    expect(
      errorText(await callTool(viewer.token, "attach_file", { tripId, target: "activity", id: train.id, fileName: "a.pdf", contentBase64: b64(pdfBytes()) })),
    ).toBe("Trip not found");
    expect(
      errorText(await callTool(viewer.token, "delete_file", { tripId, fileId: document.id, updatedAt: document.updatedAt.toISOString() })),
    ).toBe("Trip not found");
    expect(await prisma.dayPlanItemDocument.count({ where: { id: document.id } })).toBe(1);
    expect(await prisma.aiChange.count()).toBe(0);
    expect(await filesUnder(getTripsUploadRoot())).toEqual([]);
  });
});
