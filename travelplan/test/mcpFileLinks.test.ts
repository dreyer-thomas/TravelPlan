import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as fileLinkGET } from "@/app/f/[fileId]/route";
import { prisma } from "@/lib/db/prisma";
import { clearImageSizeCache } from "@/lib/files/imageInfo";
import { getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";
import { cleanOAuthTables, ISSUER, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool } from "./helpers/mcpClient";
import { setupConnectorTrip, stubNetworkSeams, structured } from "./helpers/connectorWriteFixtures";
import { pdfBytes } from "./helpers/uploadFixtures";

/**
 * Story 15.8. The signed links as the model sees them: `get_day`, `get_bucket_list`, `get_file` and a write
 * tool's day through `POST /api/mcp`, and each `downloadUrl` fetched through the `/f/` route with no cookie
 * and no token. The planner trip's seeded files are laid down as real images and PDFs first.
 */

setupConnectorEnvironment();

const SECRET = crypto.randomBytes(32);
const MIB = 1024 * 1024;

const rateLimitStore = () => (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore;

beforeEach(async () => {
  vi.stubEnv("FILE_LINK_SECRET", SECRET.toString("base64url"));
  vi.stubEnv("FILE_LINK_TTL_SECONDS", undefined);
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
  clearImageSizeCache();
  for (const key of [...(rateLimitStore()?.keys() ?? [])]) {
    if (key.startsWith("mcp-tool:") || key.startsWith("file-link:")) rateLimitStore()?.delete(key);
  }
  stubNetworkSeams();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type ImageEntry = { id: string; fileName: string; downloadUrl: string | null; width: number | null; height: number | null; updatedAt: string };
type DocumentEntry = { id: string; fileName: string; downloadUrl: string | null; updatedAt: string };
type Files = { documents: DocumentEntry[]; images: ImageEntry[] };
type Activity = Files & { id: string; title: string | null; updatedAt: string };
type Day = { activities: Activity[]; stay: (Files & { id: string }) | null };

const place = async (url: string, bytes: Buffer) => {
  const filePath = resolveStoredMediaPath(url);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
};

/** The planner trip with its seeded files on disk: a 3000x2000 WebP, an Orientation-6 JPEG, PDFs. */
const setup = async () => {
  const context = await setupConnectorTrip();
  const tripId = context.seed.trip.id;
  await place(`/uploads/trips/${tripId}/dinner/table.webp`, await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "teal" } }).webp().toBuffer());
  // Stored 400x300 with Orientation 6: a portrait photo, which must report 300x400.
  await place(
    `/uploads/trips/${tripId}/stay/front.jpg`,
    await sharp({ create: { width: 400, height: 300, channels: 3, background: "navy" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
  );
  await place(`/uploads/trips/${tripId}/castle/view.jpg`, await sharp({ create: { width: 800, height: 600, channels: 3, background: "olive" } }).jpeg().toBuffer());
  for (const name of ["stay/booking.pdf", "dinner/menu.pdf", "castle/ticket.pdf"]) {
    await place(`/uploads/trips/${tripId}/${name}`, pdfBytes(200));
  }
  return context;
};

const getDay = async (token: string, tripId: string, dayId: string) =>
  structured<Day>(await callTool(token, "get_day", { tripId, dayId }));

const fetchLink = (url: string) => {
  const parsed = new URL(url);
  return fileLinkGET(new Request(url, { headers: { "x-forwarded-for": "192.0.2.10" } }), {
    params: Promise.resolve({ fileId: parsed.pathname.replace(/^\/f\//, "") }),
  });
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The path ends in the served extension: `.webp` for a WebP source, `.jpg` for a JPEG or an opaque PNG, `.pdf`. */
const linkPrefix = (id: string, extension: string) => `^${escapeRegExp(ISSUER)}/f/${escapeRegExp(id)}\\.${extension}\\?`;
const imageLink = (id: string, extension: "jpg" | "webp") =>
  new RegExp(`${linkPrefix(id, extension)}w=1600&exp=\\d+&sig=[A-Za-z0-9_-]{43}$`);
const documentLink = (id: string, extension: "pdf" | "jpg" = "pdf") =>
  new RegExp(`${linkPrefix(id, extension)}exp=\\d+&sig=[A-Za-z0-9_-]{43}$`);

/** The links minus `exp`/`sig`, which differ between two reads a second apart. */
const withoutSignatures = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/exp=\d+&sig=[A-Za-z0-9_-]+/g, "exp&sig"));

describe("get_day", () => {
  it("gives each image a w=1600 link and its original oriented size, each document a link without a width", async () => {
    const { seed, owner } = await setup();
    const day = await getDay(owner.token, seed.trip.id, seed.day2.id);
    const dinner = day.activities.find((activity) => activity.id === seed.dinner.id)!;
    const [table] = dinner.images;
    expect(table).toEqual({
      id: table.id,
      fileName: "table.webp",
      downloadUrl: expect.stringMatching(imageLink(table.id, "webp")),
      width: 3000,
      height: 2000,
      updatedAt: expect.any(String),
    });
    expect(dinner.documents[0].downloadUrl).toMatch(documentLink(dinner.documents[0].id));
    const [front] = day.stay!.images;
    expect([front.width, front.height]).toEqual([300, 400]);
    expect(front.downloadUrl).toMatch(imageLink(front.id, "jpg"));
    expect(day.stay!.documents[0].downloadUrl).toMatch(documentLink(day.stay!.documents[0].id));
    // The one public reference names the file id, never the storage path.
    expect(JSON.stringify(day)).not.toContain("/uploads");
  });

  it("serves those links with no cookie and no token: the image resized and stripped, the PDF as stored", async () => {
    const { seed, owner } = await setup();
    const day = await getDay(owner.token, seed.trip.id, seed.day2.id);
    const dinner = day.activities.find((activity) => activity.id === seed.dinner.id)!;

    const image = await fetchLink(dinner.images[0].downloadUrl!);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    expect([metadata.width, metadata.height]).toEqual([1600, 1067]);

    const pdf = await fetchLink(dinner.documents[0].downloadUrl!);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).equals(pdfBytes(200))).toBe(true);
  });

  it("gives an external image and an image missing on disk nulls, and a contributor the same links", async () => {
    const { seed, owner, contributor } = await setup();
    const external = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.dinner.id, imageUrl: "https://images.example/photo.jpg", sortOrder: 1 },
    });
    const missing = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.dinner.id, imageUrl: `/uploads/trips/${seed.trip.id}/dinner/gone.jpg`, sortOrder: 2 },
    });
    const day = await getDay(contributor.token, seed.trip.id, seed.day2.id);
    const images = day.activities.find((activity) => activity.id === seed.dinner.id)!.images;
    for (const id of [external.id, missing.id]) {
      expect(images.find((image) => image.id === id)).toMatchObject({ downloadUrl: null, width: null, height: null });
    }
    expect(images[0].downloadUrl).toMatch(imageLink(images[0].id, "webp"));
    expect(withoutSignatures(await getDay(owner.token, seed.trip.id, seed.day2.id))).toEqual(withoutSignatures(day));
  });

  it("gives a document that is missing on disk downloadUrl null, as get_file does", async () => {
    const { seed, owner } = await setup();
    await fs.rm(resolveStoredMediaPath(`/uploads/trips/${seed.trip.id}/dinner/menu.pdf`));
    const day = await getDay(owner.token, seed.trip.id, seed.day2.id);
    const dinner = day.activities.find((activity) => activity.id === seed.dinner.id)!;
    expect(dinner.documents[0].downloadUrl).toBeNull();
    expect(day.stay!.documents[0].downloadUrl).toMatch(documentLink(day.stay!.documents[0].id));
  });

  it("gives every downloadUrl, width and height null without a secret", async () => {
    vi.stubEnv("FILE_LINK_SECRET", undefined);
    const { seed, owner } = await setup();
    const day = await getDay(owner.token, seed.trip.id, seed.day2.id);
    const entries = [...day.activities, day.stay!];
    const documents = entries.flatMap((entry) => entry.documents);
    const images = entries.flatMap((entry) => entry.images);
    expect(documents.length).toBeGreaterThan(0);
    expect(images.length).toBeGreaterThan(0);
    for (const document of documents) expect(document.downloadUrl).toBeNull();
    for (const image of images) expect([image.downloadUrl, image.width, image.height]).toEqual([null, null, null]);
  });
});

describe("get_bucket_list and the write tools", () => {
  it("links a parked activity's files in get_bucket_list", async () => {
    const { seed, owner } = await setup();
    const { activities } = structured<{ activities: Activity[] }>(await callTool(owner.token, "get_bucket_list", { tripId: seed.trip.id }));
    const castle = activities.find((activity) => activity.id === seed.castle.id)!;
    expect(castle.images[0]).toMatchObject({ fileName: "view.jpg", width: 800, height: 600 });
    expect(castle.images[0].downloadUrl).toMatch(imageLink(castle.images[0].id, "jpg"));
    expect(castle.documents[0].downloadUrl).toMatch(documentLink(castle.documents[0].id));
    expect((await fetchLink(castle.images[0].downloadUrl!)).status).toBe(200);
  });

  it("returns the day of a write exactly as get_day shows it, links included, and a parked activity linked", async () => {
    const { seed, owner } = await setup();
    const tripId = seed.trip.id;
    const before = await getDay(owner.token, tripId, seed.day2.id);
    const dinner = before.activities.find((activity) => activity.id === seed.dinner.id)!;
    const updated = structured<{ day: Day }>(
      await callTool(owner.token, "update_activity", { tripId, activityId: dinner.id, updatedAt: dinner.updatedAt, title: "Late dinner" }),
    );
    expect(updated.day.activities.find((activity) => activity.id === dinner.id)!.images[0].downloadUrl).toMatch(
      imageLink(dinner.images[0].id, "webp"),
    );
    expect(withoutSignatures(updated.day)).toEqual(withoutSignatures(await getDay(owner.token, tripId, seed.day2.id)));

    const parked = structured<{ activity: Activity }>(await callTool(owner.token, "park_activity", { tripId, activityId: dinner.id }));
    expect(parked.activity.images[0]).toMatchObject({ width: 3000, height: 2000 });
    expect(parked.activity.images[0].downloadUrl).toMatch(imageLink(dinner.images[0].id, "webp"));
  });
});

describe("get_file", () => {
  type FileMetadata = { media: string; downloadUrl: string | null; width?: number | null; height?: number | null; note?: string };

  it("adds a w=1600 link and the oriented size for an image, a link without a width for a document", async () => {
    const { seed, owner } = await setup();
    const tripId = seed.trip.id;
    const day = await getDay(owner.token, tripId, seed.day2.id);
    const image = structured<FileMetadata>(await callTool(owner.token, "get_file", { tripId, fileId: day.stay!.images[0].id }));
    expect(image).toMatchObject({ media: "image", width: 300, height: 400 });
    expect(image.downloadUrl).toMatch(imageLink(day.stay!.images[0].id, "jpg"));
    const document = structured<FileMetadata>(await callTool(owner.token, "get_file", { tripId, fileId: day.stay!.documents[0].id }));
    expect(document.downloadUrl).toMatch(documentLink(day.stay!.documents[0].id));
    expect(document).not.toHaveProperty("width");
    expect((await fetchLink(document.downloadUrl!)).status).toBe(200);
  });

  it("signs an image document without a width, so it comes back at full size", async () => {
    const { seed, owner } = await setup();
    const tripId = seed.trip.id;
    const url = `/uploads/trips/${tripId}/dinner/screenshot.png`;
    await place(url, await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer());
    const row = await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: seed.dinner.id, documentUrl: url, fileName: "screenshot.png", sortOrder: 1 },
    });
    const metadata = structured<FileMetadata>(await callTool(owner.token, "get_file", { tripId, fileId: row.id }));
    expect(metadata.downloadUrl).toMatch(documentLink(row.id, "jpg"));
    const response = await fetchLink(metadata.downloadUrl!);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(2000);
  });

  it("points a file over 10 MB to its downloadUrl, and gives a missing file null", async () => {
    const { seed, owner } = await setup();
    const tripId = seed.trip.id;
    const url = `/uploads/trips/${tripId}/dinner/big.pdf`;
    await place(url, pdfBytes());
    await fs.truncate(resolveStoredMediaPath(url), 10 * MIB + 1);
    const big = await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: seed.dinner.id, documentUrl: url, fileName: "big.pdf", sortOrder: 1 },
    });
    const body = await callTool(owner.token, "get_file", { tripId, fileId: big.id });
    expect(body.result?.content).toHaveLength(1);
    const metadata = structured<FileMetadata>(body);
    expect(metadata.downloadUrl).toMatch(documentLink(big.id));
    expect(metadata.note).toBe("The file is larger than 10 MB, too large to transfer here; download it from downloadUrl.");

    const gone = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.dinner.id, imageUrl: `/uploads/trips/${tripId}/dinner/gone.jpg`, sortOrder: 1 },
    });
    expect(structured<FileMetadata>(await callTool(owner.token, "get_file", { tripId, fileId: gone.id }))).toMatchObject({
      downloadUrl: null,
      width: null,
      height: null,
    });
  });
});

describe("tool descriptions", () => {
  it("explain downloadUrl with the configured lifetime in get_day, get_bucket_list and get_file", async () => {
    vi.stubEnv("FILE_LINK_TTL_SECONDS", "1200");
    const { owner } = await setup();
    const { POST } = await import("@/app/api/mcp/route");
    const { rpc } = await import("./helpers/mcpClient");
    const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${owner.token}` }));
    const body = (await response.json()) as { result: { tools: { name: string; description: string }[] } };
    const descriptions = new Map(body.result.tools.map((tool) => [tool.name, tool.description]));
    for (const name of ["get_day", "get_bucket_list", "get_file"]) {
      const description = descriptions.get(name)!;
      expect(description, name).toContain("valid about 20 minutes");
      expect(description).toContain("no login and no token");
      expect(description).toContain("plain HTTPS GET");
      expect(description).toContain("fixed by the link's signature");
      expect(description).toContain("width and height are the original's pixels");
      expect(description).toContain("without any metadata");
    }
  });
});
