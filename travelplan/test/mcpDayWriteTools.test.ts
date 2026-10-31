import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import type https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as dayImagePATCH, POST as dayImagePOST } from "@/app/api/trips/[id]/days/[dayId]/image/route";
import { GET as fileLinkGET } from "@/app/f/[fileId]/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { clearImageSizeCache } from "@/lib/files/imageInfo";
import { guardedFetch, type GuardedFetchDeps, type GuardedLookup } from "@/lib/http/guardedFetch";
import { fileToolDeps } from "@/lib/mcp/tools/fileTools";
import { getTripDayUploadDir, getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";
import { cleanOAuthTables, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool, type ToolCallBody } from "./helpers/mcpClient";
import {
  errorText,
  getDay,
  setupConnectorTrip,
  STALE_UNDO,
  storedReceipt,
  structured,
  stubNetworkSeams,
} from "./helpers/connectorWriteFixtures";
import { pdfBytes, pngBytes } from "./helpers/uploadFixtures";

/**
 * Story 15.9. The day's own note and picture through the connector, end to end: `update_day`, `attach_file`
 * / `delete_file` / `get_file` with the day as target, and `get_day` / `get_trip` reading them, through
 * `POST /api/mcp` with a real token, for the owner and a contributor (a viewer finds no trip). The app's own
 * day-image route is called directly where a test needs the app's write (its raw `CURRENT_TIMESTAMP` stamp,
 * its `day.<ext>` name, its marker clearing). Downloads go through the real `guardedFetch` over fake DNS and
 * request deps; no socket is ever opened.
 */

setupConnectorEnvironment();

const rateLimitStore = () => (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore;

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
  clearImageSizeCache();
  for (const key of [...(rateLimitStore()?.keys() ?? [])]) {
    if (key.startsWith("mcp-upload:") || key.startsWith("mcp-tool:") || key.startsWith("file-link:")) {
      rateLimitStore()?.delete(key);
    }
  }
  stubNetworkSeams();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type DayImage = { id: string; fileName: string; downloadUrl: string | null; width: number | null; height: number | null; updatedAt: string };
type Day = { id: string; note: string | null; image: DayImage | null; updatedAt: string; aiChangedAt: string | null };
type Write = { aiChangeId: string | null; day: Day };
type AttachResult = Write & {
  file: { id: string; fileName: string; media: string; mimeType: string; sizeBytes: number; updatedAt: string };
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const exists = (url: string) =>
  fs
    .stat(resolveStoredMediaPath(url))
    .then(() => true)
    .catch(() => false);

const filesIn = async (dir: string) =>
  (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();

const dayRow = (dayId: string) => prisma.tripDay.findUniqueOrThrow({ where: { id: dayId } });

const appHeaders = async (user: { id: string; role: string }) => {
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  return { cookie: `session=${session}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" };
};

/** The app's day-details dialog: the note save (or "Remove", with `imageUrl: null`). */
const appPatch = async (user: { id: string; role: string }, tripId: string, dayId: string, body: Record<string, unknown>) => {
  const response = await dayImagePATCH(
    new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/image`, {
      method: "PATCH",
      headers: { ...(await appHeaders(user)), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tripId, dayId }) },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { day: { aiChangedAt: string | null } } }).data.day;
};

/** The app's day-details dialog: an upload, stored as `day.<ext>`. */
const appPost = async (user: { id: string; role: string }, tripId: string, dayId: string, bytes: Buffer, name = "day.png") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" }));
  const response = await dayImagePOST(
    new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/image`, {
      method: "POST",
      headers: await appHeaders(user),
      body: form,
    }),
    { params: Promise.resolve({ id: tripId, dayId }) },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { day: { imageUrl: string; aiChangedAt: string | null } } }).data.day;
};

/** A fake `https.request`/DNS pair for the real `guardedFetch` (the `mcpFileTools.test.ts` pattern). */
const answerDownloads = (dnsTable: Record<string, string[]>, responses: Record<string, { status: number; body?: Buffer }>) => {
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
          const spec = responses[`${host}${options.path}`] ?? { status: 404 };
          const response = Readable.from(spec.body ? [spec.body] : []) as Readable & {
            statusCode: number;
            headers: Record<string, string>;
          };
          response.statusCode = spec.status;
          response.headers = {};
          onResponse(response);
        },
      );
    };
    return emitter;
  }) as unknown as typeof https.request;
  const deps: GuardedFetchDeps = { lookup, request };
  vi.spyOn(fileToolDeps, "fetch").mockImplementation((url, options) => guardedFetch(url, options, deps));
};

const undo = (token: string, tripId: string, changeId: string | null) => callTool(token, "undo_ai_change", { tripId, changeId });

const expectUndone = (body: ToolCallBody) => expect(structured(body)).toMatchObject({ undone: true });

describe.each(["owner", "contributor"] as const)("the day's note and picture as %s", (role) => {
  const setup = async () => {
    const context = await setupConnectorTrip();
    const { seed } = context;
    return { ...context, ...context[role], tripId: seed.trip.id, dayId: seed.day3.id };
  };

  describe("reads", () => {
    it("get_day gives the day's note, picture, stamp and marker; get_trip only whether there are any", async () => {
      const { token, user, tripId, dayId } = await setup();

      const empty = await getDay<Day>(token, tripId, dayId);
      expect(empty).toMatchObject({ note: null, image: null, aiChangedAt: null });
      expect(empty.updatedAt).toBe((await dayRow(dayId)).updatedAt.toISOString());

      await appPost(user, tripId, dayId, pngBytes(200));
      await appPatch(user, tripId, dayId, { note: "Castle day" });

      const filled = await getDay<Day>(token, tripId, dayId);
      expect(filled.note).toBe("Castle day");
      // No secret configured here: the picture is listed with null link fields.
      expect(filled.image).toEqual({
        id: dayId,
        fileName: "day.png",
        downloadUrl: null,
        width: null,
        height: null,
        updatedAt: filled.updatedAt,
      });
      expect(JSON.stringify(filled)).not.toContain("/uploads");

      const trip = structured<{ days: { id: string; hasNote: boolean; hasImage: boolean }[] }>(
        await callTool(token, "get_trip", { tripId }),
      );
      const flags = Object.fromEntries(trip.days.map((day) => [day.id, [day.hasNote, day.hasImage]]));
      expect(flags[dayId]).toEqual([true, true]);
      expect(Object.values(flags).filter(([note, image]) => note || image)).toHaveLength(1);
    });

    it("get_trip counts a blank note or picture as none", async () => {
      const { token, tripId, dayId } = await setup();
      await prisma.tripDay.update({ where: { id: dayId }, data: { note: "   ", imageUrl: " " } });
      const trip = structured<{ days: { id: string; hasNote: boolean; hasImage: boolean }[] }>(
        await callTool(token, "get_trip", { tripId }),
      );
      expect(trip.days.find((day) => day.id === dayId)).toMatchObject({ hasNote: false, hasImage: false });
    });
  });

  describe("update_day", () => {
    it("sets the note, marks the day, records one change and leaves the picture alone; undo restores both", async () => {
      const { token, user, tripId, dayId } = await setup();
      const picture = await appPost(user, tripId, dayId, pngBytes(200));
      const before = await getDay<Day>(token, tripId, dayId);

      const result = structured<Write>(
        await callTool(token, "update_day", { tripId, dayId, note: "  Old town walk  ", updatedAt: before.updatedAt }),
      );

      const row = await dayRow(dayId);
      expect(row.note).toBe("Old town walk");
      expect(row.imageUrl).toBe(picture.imageUrl);
      expect(await exists(picture.imageUrl)).toBe(true);
      expect(row.aiChangedAt).not.toBeNull();
      expect(result.day).toMatchObject({ note: "Old town walk", aiChangedAt: row.aiChangedAt!.toISOString() });
      expect(result.day.updatedAt).toBe(row.updatedAt.toISOString());
      expect(result.day.image?.id).toBe(dayId);

      const changes = await prisma.aiChange.findMany();
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ id: result.aiChangeId, action: "dayNoteChanged", subject: "Old town walk", tripDayId: dayId });
      expect((await storedReceipt(result.aiChangeId!)).edited).toMatchObject({
        kind: "dayDetailsChanged",
        previous: { note: null, imageUrl: picture.imageUrl, aiChangedAt: null },
        imageUrl: picture.imageUrl,
      });
      const listed = structured<{ changes: { summary: string; undoable: boolean }[] }>(
        await callTool(token, "list_ai_changes", { tripId }),
      );
      expect(listed.changes[0]).toMatchObject({ summary: 'Changed the day note: "Old town walk"', undoable: true });

      expectUndone(await undo(token, tripId, result.aiChangeId));
      const undone = await dayRow(dayId);
      expect(undone).toMatchObject({ note: null, imageUrl: picture.imageUrl, aiChangedAt: null });
      expect(await exists(picture.imageUrl)).toBe(true);
    });

    it("clears the note with an empty string and with null, naming the cleared note", async () => {
      const { token, user, tripId, dayId } = await setup();
      await appPatch(user, tripId, dayId, { note: "Before" });

      const cleared = structured<Write>(
        await callTool(token, "update_day", { tripId, dayId, note: "  ", updatedAt: (await getDay<Day>(token, tripId, dayId)).updatedAt }),
      );
      expect(cleared.day.note).toBeNull();
      expect((await dayRow(dayId)).note).toBeNull();
      expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: cleared.aiChangeId! } })).toMatchObject({ subject: "Before" });

      await appPatch(user, tripId, dayId, { note: "Again" });
      const nulled = structured<Write>(
        await callTool(token, "update_day", { tripId, dayId, note: null, updatedAt: (await getDay<Day>(token, tripId, dayId)).updatedAt }),
      );
      expect(nulled.day.note).toBeNull();
      expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: nulled.aiChangeId! } })).toMatchObject({ subject: "Again" });
    });

    it("refuses a note over 280 characters and a stale stamp, writing nothing", async () => {
      const { token, user, tripId, dayId } = await setup();
      await appPatch(user, tripId, dayId, { note: "Kept" });
      const read = await getDay<Day>(token, tripId, dayId);

      expect(errorText(await callTool(token, "update_day", { tripId, dayId, note: "x".repeat(281), updatedAt: read.updatedAt }))).toBe(
        "note must be at most 280 characters",
      );
      expect(errorText(await callTool(token, "update_day", { tripId, dayId, note: "x".repeat(2001), updatedAt: read.updatedAt }))).toBe(
        "note must be at most 280 characters",
      );
      // 280 after trimming is still fine; the stamp moved with it.
      structured(await callTool(token, "update_day", { tripId, dayId, note: ` ${"y".repeat(280)} `, updatedAt: read.updatedAt }));
      const afterWrite = await dayRow(dayId);

      expect(errorText(await callTool(token, "update_day", { tripId, dayId, note: "Late", updatedAt: read.updatedAt }))).toBe(
        "Day changed since you read it; read the day again",
      );
      expect(await dayRow(dayId)).toEqual(afterWrite);
      expect(await prisma.aiChange.count()).toBe(1);
    });

    it("answers success without a change for the note the day already has", async () => {
      const { token, user, tripId, dayId } = await setup();
      await appPatch(user, tripId, dayId, { note: "Same" });
      const before = await dayRow(dayId);

      const result = structured<Write>(
        await callTool(token, "update_day", { tripId, dayId, note: " Same ", updatedAt: before.updatedAt.toISOString() }),
      );
      expect(result.aiChangeId).toBeNull();
      expect(result.day).toMatchObject({ note: "Same", aiChangedAt: null });
      expect(await dayRow(dayId)).toEqual(before);
      expect(await prisma.aiChange.count()).toBe(0);
    });

    it("takes the stamp get_day gave after an app save (the app writes it with raw SQL, D4)", async () => {
      const { token, user, tripId, dayId } = await setup();
      await appPatch(user, tripId, dayId, { note: "From the app" });
      const read = await getDay<Day>(token, tripId, dayId);
      expect(read.updatedAt).toMatch(ISO);

      const result = structured<Write>(await callTool(token, "update_day", { tripId, dayId, note: "From Claude", updatedAt: read.updatedAt }));
      expect(result.day.note).toBe("From Claude");
    });

    it("answers Day not found for a day of another trip", async () => {
      const { token, tripId, owner } = await setup();
      const other = await setupConnectorTrip();
      void owner;
      expect(
        errorText(
          await callTool(token, "update_day", { tripId, dayId: other.seed.day1.id, note: "x", updatedAt: new Date().toISOString() }),
        ),
      ).toBe("Day not found");
    });
  });

  describe("attach_file target day", () => {
    it("sets a first picture inline into the day's folder under a day- name; undo removes the file and the picture", async () => {
      const { token, tripId, dayId } = await setup();
      const png = pngBytes(300);

      const result = structured<AttachResult>(
        await callTool(token, "attach_file", { tripId, target: "day", id: dayId, fileName: "ignored.txt", contentBase64: b64(png) }),
      );

      expect(result.file).toMatchObject({ id: dayId, media: "image", mimeType: "image/png", sizeBytes: png.length });
      expect(result.file.fileName).toMatch(/^day-\d+-[a-z0-9]+\.png$/);
      expect(JSON.stringify(result)).not.toContain("/uploads");
      const row = await dayRow(dayId);
      expect(row.imageUrl).toBe(`/uploads/trips/${tripId}/days/${dayId}/${result.file.fileName}`);
      expect(row.aiChangedAt).not.toBeNull();
      expect(result.file.updatedAt).toBe(row.updatedAt.toISOString());
      expect((await fs.readFile(path.join(getTripDayUploadDir(tripId, dayId), result.file.fileName))).equals(png)).toBe(true);
      expect(result.day.image).toMatchObject({ id: dayId, fileName: result.file.fileName, updatedAt: result.file.updatedAt });
      expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId! } })).toMatchObject({
        action: "dayImageSet",
        subject: result.file.fileName,
        tripDayId: dayId,
      });

      expectUndone(await undo(token, tripId, result.aiChangeId));
      expect(await dayRow(dayId)).toMatchObject({ imageUrl: null, aiChangedAt: null });
      expect(await filesIn(getTripDayUploadDir(tripId, dayId))).toEqual([]);
    });

    it("sets a first picture by URL; undo removes the file and the picture", async () => {
      const { token, tripId, dayId } = await setup();
      const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "teal" } }).jpeg().toBuffer();
      answerDownloads({ "photos.example": ["93.184.216.34"] }, { "photos.example/harbour": { status: 200, body: jpeg } });

      const result = structured<AttachResult>(
        await callTool(token, "attach_file", { tripId, target: "day", id: dayId, fileName: "harbour", url: "https://photos.example/harbour" }),
      );

      expect(result.file).toMatchObject({ id: dayId, media: "image", mimeType: "image/jpeg", sizeBytes: jpeg.length });
      const row = await dayRow(dayId);
      expect(row.imageUrl).toBe(`/uploads/trips/${tripId}/days/${dayId}/${result.file.fileName}`);
      expect(row.imageUrl).toMatch(/\/day-\d+-[a-z0-9]+\.jpg$/);
      expect((await storedReceipt(result.aiChangeId!)).edited).toMatchObject({ previous: { imageUrl: null }, imageUrl: row.imageUrl });

      expectUndone(await undo(token, tripId, result.aiChangeId));
      expect(await dayRow(dayId)).toMatchObject({ imageUrl: null, aiChangedAt: null });
      expect(await filesIn(getTripDayUploadDir(tripId, dayId))).toEqual([]);
    });

    it("replaces the app's picture by URL, keeping the old file; undo brings the old one back and removes the new", async () => {
      const { token, user, tripId, dayId } = await setup();
      const old = await appPost(user, tripId, dayId, pngBytes(100));
      const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "teal" } }).jpeg().toBuffer();
      answerDownloads({ "photos.example": ["93.184.216.34"] }, { "photos.example/castle": { status: 200, body: jpeg } });

      const result = structured<AttachResult>(
        await callTool(token, "attach_file", {
          tripId,
          target: "day",
          id: dayId,
          fileName: "castle",
          url: "https://photos.example/castle",
        }),
      );
      expect(result.file).toMatchObject({ mimeType: "image/jpeg", sizeBytes: jpeg.length });
      const newUrl = (await dayRow(dayId)).imageUrl!;
      expect(newUrl).toMatch(/\/day-\d+-[a-z0-9]+\.jpg$/);
      expect(await exists(old.imageUrl)).toBe(true);
      expect((await storedReceipt(result.aiChangeId!)).edited).toMatchObject({ previous: { imageUrl: old.imageUrl }, imageUrl: newUrl });

      expectUndone(await undo(token, tripId, result.aiChangeId));
      expect(await dayRow(dayId)).toMatchObject({ imageUrl: old.imageUrl, aiChangedAt: null });
      expect(await exists(old.imageUrl)).toBe(true);
      expect(await exists(newUrl)).toBe(false);
    });

    it("refuses a PDF and as document, and a blocked address, writing nothing", async () => {
      const { token, user, tripId, dayId } = await setup();
      const old = await appPost(user, tripId, dayId, pngBytes(100));
      const before = await dayRow(dayId);
      const base = { tripId, target: "day", id: dayId, fileName: "x" };
      const refusal = "Day pictures must be images (JPEG, PNG or WebP).";

      expect(errorText(await callTool(token, "attach_file", { ...base, contentBase64: b64(pdfBytes(100)) }))).toBe(refusal);
      expect(errorText(await callTool(token, "attach_file", { ...base, as: "document", contentBase64: b64(pngBytes(100)) }))).toBe(refusal);
      answerDownloads({ "intranet.example": ["10.0.0.5"] }, {});
      expect(errorText(await callTool(token, "attach_file", { ...base, url: "https://intranet.example/x.png" }))).toBe(
        "That address is not public.",
      );

      expect(await dayRow(dayId)).toEqual(before);
      expect(await filesIn(getTripDayUploadDir(tripId, dayId))).toEqual([path.basename(old.imageUrl)]);
      expect(await prisma.aiChange.count()).toBe(0);
    });

    it("answers Day not found for an unknown day", async () => {
      const { token, tripId } = await setup();
      expect(
        errorText(await callTool(token, "attach_file", { tripId, target: "day", id: "no-such-day", fileName: "x", contentBase64: b64(pngBytes()) })),
      ).toBe("Day not found");
    });

    it("cannot be undone once the app saved the note, and the picture stays", async () => {
      const { token, user, tripId, dayId } = await setup();
      const result = structured<AttachResult>(
        await callTool(token, "attach_file", { tripId, target: "day", id: dayId, fileName: "x", contentBase64: b64(pngBytes()) }),
      );
      const url = (await dayRow(dayId)).imageUrl!;
      await appPatch(user, tripId, dayId, { note: "Edited in the app" });

      expect(errorText(await undo(token, tripId, result.aiChangeId))).toBe(STALE_UNDO);
      expect((await dayRow(dayId)).imageUrl).toBe(url);
      expect(await exists(url)).toBe(true);
    });
  });

  describe("delete_file and get_file with the day picture's id", () => {
    it("removes the picture but keeps its file; undo puts it back", async () => {
      const { token, user, tripId, dayId } = await setup();
      const picture = await appPost(user, tripId, dayId, pngBytes(150));
      const read = await getDay<Day>(token, tripId, dayId);

      const result = structured<Write & { deletedFileId: string }>(
        await callTool(token, "delete_file", { tripId, fileId: read.image!.id, updatedAt: read.image!.updatedAt }),
      );
      expect(result.deletedFileId).toBe(dayId);
      expect(result.day.image).toBeNull();
      const row = await dayRow(dayId);
      expect(row.imageUrl).toBeNull();
      expect(row.aiChangedAt).not.toBeNull();
      expect(await exists(picture.imageUrl)).toBe(true);
      expect(await prisma.aiChange.findUniqueOrThrow({ where: { id: result.aiChangeId! } })).toMatchObject({
        action: "dayImageRemoved",
        subject: "day.png",
      });

      expectUndone(await undo(token, tripId, result.aiChangeId));
      expect(await dayRow(dayId)).toMatchObject({ imageUrl: picture.imageUrl, aiChangedAt: null });
      expect(await exists(picture.imageUrl)).toBe(true);
    });

    it("refuses a stale stamp, answers File not found without a picture, and its undo is stale once the kept file is gone", async () => {
      const { token, user, tripId, dayId } = await setup();
      const picture = await appPost(user, tripId, dayId, pngBytes(150));
      // The app stamps at second precision (D4): age the read so the app's next save is a new stamp.
      await prisma.tripDay.update({ where: { id: dayId }, data: { updatedAt: new Date(Date.now() - 60_000) } });
      const read = await getDay<Day>(token, tripId, dayId);
      await appPatch(user, tripId, dayId, { note: "Moved the stamp" });

      expect(errorText(await callTool(token, "delete_file", { tripId, fileId: dayId, updatedAt: read.updatedAt }))).toMatch(
        /^This file changed since you read it/,
      );
      expect((await dayRow(dayId)).imageUrl).toBe(picture.imageUrl);

      const fresh = await getDay<Day>(token, tripId, dayId);
      const result = structured<Write>(await callTool(token, "delete_file", { tripId, fileId: dayId, updatedAt: fresh.updatedAt }));
      expect(errorText(await callTool(token, "delete_file", { tripId, fileId: dayId, updatedAt: result.day.updatedAt }))).toBe(
        "File not found",
      );

      await fs.rm(resolveStoredMediaPath(picture.imageUrl));
      expect(errorText(await undo(token, tripId, result.aiChangeId))).toBe(STALE_UNDO);
      expect((await dayRow(dayId)).imageUrl).toBeNull();
    });

    it("get_file returns the day picture with its bytes", async () => {
      const { token, tripId, dayId } = await setup();
      const png = pngBytes(120);
      structured(await callTool(token, "attach_file", { tripId, target: "day", id: dayId, fileName: "x", contentBase64: b64(png) }));

      const body = await callTool(token, "get_file", { tripId, fileId: dayId });
      const metadata = structured<{ target: { type: string; id: string }; media: string; available: boolean; aiChangedAt: string | null }>(body);
      expect(metadata).toMatchObject({ target: { type: "day", id: dayId }, media: "image", available: true });
      expect(metadata.aiChangedAt).toMatch(ISO);
      const resource = body.result?.content?.[1] as { resource: { blob: string; mimeType: string } };
      expect(resource.resource.mimeType).toBe("image/png");
      expect(Buffer.from(resource.resource.blob, "base64").equals(png)).toBe(true);
    });
  });

  describe("the KI/AI marker and the app", () => {
    it("is cleared by the app's PATCH and POST; the POST also removes the connector's picture file", async () => {
      const { token, user, tripId, dayId } = await setup();
      structured(
        await callTool(token, "update_day", { tripId, dayId, note: "By Claude", updatedAt: (await getDay<Day>(token, tripId, dayId)).updatedAt }),
      );
      expect((await dayRow(dayId)).aiChangedAt).not.toBeNull();
      expect((await appPatch(user, tripId, dayId, { note: "By me" })).aiChangedAt).toBeNull();
      expect((await dayRow(dayId)).aiChangedAt).toBeNull();

      structured(await callTool(token, "attach_file", { tripId, target: "day", id: dayId, fileName: "x", contentBase64: b64(pngBytes()) }));
      const connectorUrl = (await dayRow(dayId)).imageUrl!;
      expect((await dayRow(dayId)).aiChangedAt).not.toBeNull();

      const uploaded = await appPost(user, tripId, dayId, pngBytes(80), "mine.jpg");
      expect(uploaded.aiChangedAt).toBeNull();
      expect(uploaded.imageUrl).toBe(`/uploads/trips/${tripId}/days/${dayId}/day.jpg`);
      expect((await dayRow(dayId)).aiChangedAt).toBeNull();
      expect(await exists(connectorUrl)).toBe(false);
      expect(await filesIn(getTripDayUploadDir(tripId, dayId))).toEqual(["day.jpg"]);
    });
  });
});

describe("a viewer", () => {
  it("finds no trip in update_day, attach_file target day and delete_file", async () => {
    const { seed, owner, viewer } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const dayId = seed.day3.id;
    structured(await callTool(owner.token, "attach_file", { tripId, target: "day", id: dayId, fileName: "x", contentBase64: b64(pngBytes()) }));
    const before = await dayRow(dayId);
    const updatedAt = before.updatedAt.toISOString();

    expect(errorText(await callTool(viewer.token, "update_day", { tripId, dayId, note: "x", updatedAt }))).toBe("Trip not found");
    expect(
      errorText(await callTool(viewer.token, "attach_file", { tripId, target: "day", id: dayId, fileName: "x", contentBase64: b64(pngBytes()) })),
    ).toBe("Trip not found");
    expect(errorText(await callTool(viewer.token, "delete_file", { tripId, fileId: dayId, updatedAt }))).toBe("Trip not found");
    expect(errorText(await callTool(viewer.token, "get_file", { tripId, fileId: dayId }))).toBe("Trip not found");
    expect(await dayRow(dayId)).toEqual(before);
    expect(await prisma.aiChange.count()).toBe(1);
  });
});

describe("the day picture's signed link (Story 15.8 rules)", () => {
  beforeEach(() => {
    vi.stubEnv("FILE_LINK_SECRET", crypto.randomBytes(32).toString("base64url"));
  });

  it("is signed with w=1600 and the original size, and served by /f/ without a login", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const tripId = seed.trip.id;
    const dayId = seed.day3.id;
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "navy" } }).png().toBuffer();
    const dir = getTripDayUploadDir(tripId, dayId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "day.png"), png);
    await prisma.tripDay.update({ where: { id: dayId }, data: { imageUrl: `/uploads/trips/${tripId}/days/${dayId}/day.png` } });

    const day = await getDay<Day>(owner.token, tripId, dayId);
    expect(day.image).toMatchObject({ id: dayId, fileName: "day.png", width: 2400, height: 1200 });
    expect(day.image!.downloadUrl).toMatch(new RegExp(`/f/${dayId}\\.jpg\\?w=1600&exp=\\d+&sig=`));

    const link = new URL(day.image!.downloadUrl!);
    const response = await fileLinkGET(new Request(link, { headers: { "x-forwarded-for": "192.0.2.10" } }), {
      params: Promise.resolve({ fileId: link.pathname.replace(/^\/f\//, "") }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^image\//);
  });

  it("gives null link fields for an external day picture", async () => {
    const { seed, owner } = await setupConnectorTrip();
    await prisma.tripDay.update({ where: { id: seed.day3.id }, data: { imageUrl: "https://images.example/day.jpg" } });
    const day = await getDay<Day>(owner.token, seed.trip.id, seed.day3.id);
    expect(day.image).toMatchObject({ id: seed.day3.id, downloadUrl: null, width: null, height: null });
  });
});
