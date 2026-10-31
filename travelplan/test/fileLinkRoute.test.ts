import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/f/[fileId]/route";
import { prisma } from "@/lib/db/prisma";
import { fileLinkSignature, signFileLink } from "@/lib/files/fileLinks";
import { getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";
import { createUser } from "./helpers/oauthFixtures";
import { plannerDoc } from "./helpers/plannerFixtures";
import { pdfBytes } from "./helpers/uploadFixtures";

/**
 * Story 15.8. `GET /f/{fileId}` with real files under the per-worker media root (`test/setup.ts`) and real
 * images made with sharp: the GPS, orientation, size and alpha cases decode the response bytes, not headers.
 */

const SECRET = crypto.randomBytes(32);
let ipCounter = 0;
let sortOrder = 0;

const rateLimitStore = () => (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore;

beforeEach(async () => {
  vi.stubEnv("FILE_LINK_SECRET", SECRET.toString("base64url"));
  vi.stubEnv("APP_BASE_URL", "https://plan.example.test");
  vi.stubEnv("FILE_LINK_TTL_SECONDS", undefined);
  await prisma.trip.deleteMany();
  await fs.rm(getTripsUploadRoot(), { recursive: true, force: true });
  for (const key of [...(rateLimitStore()?.keys() ?? [])]) {
    if (key.startsWith("file-link:")) rateLimitStore()?.delete(key);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const seedTrip = async () => {
  const owner = await createUser();
  const trip = await prisma.trip.create({
    data: { userId: owner.id, name: "Links", startDate: new Date("2027-05-01T00:00:00.000Z"), endDate: new Date("2027-05-01T00:00:00.000Z") },
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, dayIndex: 1, date: new Date("2027-05-01T00:00:00.000Z") } });
  const item = await prisma.dayPlanItem.create({
    data: { tripId: trip.id, tripDayId: day.id, title: "Museum", contentJson: plannerDoc("x"), scheduleMode: "FLEXIBLE", durationMinutes: 60, sortOrder: 0 },
  });
  const stay = await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Hotel" } });
  return { trip, day, item, stay };
};

type Seed = Awaited<ReturnType<typeof seedTrip>>;

const placeFile = async (url: string, bytes: Buffer) => {
  const filePath = resolveStoredMediaPath(url);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
};

const addImage = async (seed: Seed, name: string, bytes: Buffer, target: "activity" | "stay" = "activity") => {
  const url = `/uploads/trips/${seed.trip.id}/days/${seed.day.id}/${target}/${name}`;
  await placeFile(url, bytes);
  return target === "activity"
    ? prisma.dayPlanItemImage.create({ data: { dayPlanItemId: seed.item.id, imageUrl: url, sortOrder: (sortOrder += 1) } })
    : prisma.accommodationImage.create({ data: { accommodationId: seed.stay.id, imageUrl: url, sortOrder: (sortOrder += 1) } });
};

const addDocument = async (seed: Seed, name: string, bytes: Buffer) => {
  const url = `/uploads/trips/${seed.trip.id}/days/${seed.day.id}/documents/${name}`;
  await placeFile(url, bytes);
  return prisma.dayPlanItemDocument.create({ data: { dayPlanItemId: seed.item.id, documentUrl: url, fileName: name, sortOrder: (sortOrder += 1) } });
};

const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background: channels === 4 ? { r: 10, g: 120, b: 200, alpha: 0.5 } : { r: 200, g: 80, b: 20 } } });

const fetchLink = (url: string, ip?: string) => {
  ipCounter += 1;
  const parsed = new URL(url);
  const fileId = decodeURIComponent(parsed.pathname.replace(/^\/f\//, ""));
  const request = new Request(url, { headers: { "x-forwarded-for": ip ?? `203.0.113.${ipCounter % 250}` } });
  return GET(request, { params: Promise.resolve({ fileId }) });
};

const linkFor = (fileId: string, width?: number) => signFileLink(fileId, width === undefined ? {} : { width })!.url;

const decoded = async (response: Response) => sharp(Buffer.from(await response.arrayBuffer())).metadata();

describe("GET /f/{fileId}: images", () => {
  it("serves a resized JPEG with the response headers of AC 5", async () => {
    const seed = await seedTrip();
    const image = await addImage(seed, "big.jpg", await solid(3000, 2000).jpeg().toBuffer());
    const response = await fetchLink(linkFor(image.id, 1600));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    const maxAge = Number(/^private, max-age=(\d+)$/.exec(response.headers.get("cache-control") ?? "")?.[1]);
    expect(maxAge).toBeGreaterThan(890);
    expect(maxAge).toBeLessThanOrEqual(900);
    const bytes = Buffer.from(await response.clone().arrayBuffer());
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    const metadata = await decoded(response);
    expect(metadata.format).toBe("jpeg");
    expect([metadata.width, metadata.height]).toEqual([1600, 1067]);
  });

  it("strips GPS and every other metadata from the bytes it sends", async () => {
    const seed = await seedTrip();
    const source = await solid(1200, 800)
      .jpeg()
      .withExif({
        IFD0: { Make: "PhoneMaker", Copyright: "someone" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 8/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "11/1 34/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(source).metadata()).exif?.toString("latin1")).toContain("PhoneMaker");
    const image = await addImage(seed, "gps.jpg", source);
    for (const url of [linkFor(image.id, 1600), linkFor(image.id)]) {
      const response = await fetchLink(url);
      expect(response.status).toBe(200);
      const metadata = await decoded(response);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
  });

  it("applies EXIF orientation, so an Orientation-6 source comes back with its dimensions swapped", async () => {
    const seed = await seedTrip();
    // `withMetadata`, not `withExif`: sharp rewrites an Orientation tag given through `withExif` to 1.
    const source = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(source).metadata()).orientation).toBe(6);
    const image = await addImage(seed, "rotated.jpg", source);
    const metadata = await decoded(await fetchLink(linkFor(image.id, 1600)));
    expect([metadata.width, metadata.height]).toEqual([200, 400]);
    expect(metadata.orientation).toBeUndefined();
  });

  it("never enlarges a small source, and re-encodes at full size without a width", async () => {
    const seed = await seedTrip();
    const image = await addImage(seed, "small.jpg", await solid(600, 400).jpeg().toBuffer());
    expect((await decoded(await fetchLink(linkFor(image.id, 1600)))).width).toBe(600);
    expect((await decoded(await fetchLink(linkFor(image.id)))).width).toBe(600);
  });

  it("answers WebP for a PNG with alpha and for a WebP, JPEG for a PNG without alpha", async () => {
    const seed = await seedTrip();
    const alpha = await addImage(seed, "alpha.png", await solid(300, 300, 4).png().toBuffer());
    const webp = await addImage(seed, "photo.webp", await solid(300, 300).webp().toBuffer(), "stay");
    const opaque = await addImage(seed, "opaque.png", await solid(300, 300).png().toBuffer());
    for (const [id, type] of [
      [alpha.id, "image/webp"],
      [webp.id, "image/webp"],
      [opaque.id, "image/jpeg"],
    ] as const) {
      const response = await fetchLink(linkFor(id, 800));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect((await decoded(response)).format).toBe(type === "image/webp" ? "webp" : "jpeg");
    }
  });

  it("answers 404 and logs only the file id when sharp cannot decode the file", async () => {
    const seed = await seedTrip();
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x5a)]);
    const image = await addImage(seed, "broken.jpg", broken);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fetchLink(linkFor(image.id, 1600));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("file link: image could not be processed", { fileId: image.id });
  });
});

describe("GET /f/{fileId}: documents", () => {
  it("streams a PDF byte-identical as application/pdf", async () => {
    const seed = await seedTrip();
    const bytes = pdfBytes(5000);
    const document = await addDocument(seed, "ticket.pdf", bytes);
    const response = await fetchLink(linkFor(document.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("re-encodes an image document at full size without metadata", async () => {
    const seed = await seedTrip();
    const source = await solid(2000, 1000).jpeg().withExif({ IFD3: { GPSLatitudeRef: "N" } }).toBuffer();
    const document = await addDocument(seed, "screenshot.jpg", source);
    const response = await fetchLink(linkFor(document.id));
    expect(response.status).toBe(200);
    const metadata = await decoded(response);
    expect(metadata.width).toBe(2000);
    expect(metadata.exif).toBeUndefined();
  });

  it("answers 403 to a document link carrying a width, even a correctly signed one", async () => {
    const seed = await seedTrip();
    const document = await addDocument(seed, "ticket.pdf", pdfBytes());
    const response = await fetchLink(linkFor(document.id, 1600));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
  });
});

describe("GET /f/{fileId}: refusals", () => {
  it("answers an empty 403 to a tampered sig, another file id, a changed w and an expired link", async () => {
    const seed = await seedTrip();
    const image = await addImage(seed, "a.jpg", await solid(100, 100).jpeg().toBuffer());
    const other = await addImage(seed, "b.jpg", await solid(100, 100).jpeg().toBuffer());
    const url = new URL(linkFor(image.id, 1600));
    const sig = url.searchParams.get("sig")!;
    const exp = Number(url.searchParams.get("exp"));
    const past = Math.floor(Date.now() / 1000) - 1;

    const tampered = new URL(url);
    tampered.searchParams.set("sig", `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`);
    const otherFile = new URL(url);
    otherFile.pathname = `/f/${other.id}`;
    const widened = new URL(url);
    widened.searchParams.set("w", "2400");
    const noWidth = new URL(url);
    noWidth.searchParams.delete("w");
    const expired = new URL(url);
    expired.searchParams.set("exp", String(past));
    expired.searchParams.set("sig", fileLinkSignature(SECRET, image.id, 1600, past));
    const badWidth = new URL(url);
    badWidth.searchParams.set("w", "1000");
    badWidth.searchParams.set("sig", fileLinkSignature(SECRET, image.id, 1000, exp));

    for (const candidate of [tampered, otherFile, widened, noWidth, expired, badWidth]) {
      const response = await fetchLink(candidate.toString());
      expect(response.status, candidate.toString()).toBe(403);
      expect(await response.text()).toBe("");
    }
    vi.stubEnv("FILE_LINK_SECRET", undefined);
    expect((await fetchLink(url.toString())).status).toBe(403);
  });

  it("answers an empty 404 to an unknown file, an external image, a file missing on disk and a bad id", async () => {
    const seed = await seedTrip();
    const external = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.item.id, imageUrl: "https://images.example/x.jpg", sortOrder: (sortOrder += 1) },
    });
    const missing = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.item.id, imageUrl: `/uploads/trips/${seed.trip.id}/gone.jpg`, sortOrder: (sortOrder += 1) },
    });
    const outside = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: seed.item.id, imageUrl: `/uploads/trips/other-trip/x.jpg`, sortOrder: (sortOrder += 1) },
    });
    await placeFile(`/uploads/trips/other-trip/x.jpg`, await solid(10, 10).jpeg().toBuffer());
    for (const id of ["clunknownfileid000000000", external.id, missing.id, outside.id]) {
      const response = await fetchLink(linkFor(id, 1600));
      expect(response.status, id).toBe(404);
      expect(await response.text()).toBe("");
    }
    const exp = Math.floor(Date.now() / 1000) + 60;
    const badId = "a.b";
    const response = await GET(
      new Request(`https://plan.example.test/f/x?exp=${exp}&sig=${fileLinkSignature(SECRET, badId, null, exp)}`),
      { params: Promise.resolve({ fileId: badId }) },
    );
    expect(response.status).toBe(404);
  });

  it("ignores a served extension on the path, and answers 404 to any other suffix", async () => {
    const seed = await seedTrip();
    const image = await addImage(seed, "a.jpg", await solid(100, 100).jpeg().toBuffer());
    for (const extension of ["jpg", "webp", "pdf"]) {
      const url = new URL(linkFor(image.id, 1600));
      url.pathname = `/f/${image.id}.${extension}`;
      expect((await fetchLink(url.toString())).status, extension).toBe(200);
    }
    for (const suffix of [".png", ".jpg.jpg", ".JPG"]) {
      const url = new URL(linkFor(image.id, 1600));
      url.pathname = `/f/${image.id}${suffix}`;
      expect((await fetchLink(url.toString())).status, suffix).toBe(404);
    }
  });

  it("answers 429 to the 301st request from one address within a minute, before checking the link", async () => {
    const seed = await seedTrip();
    const image = await addImage(seed, "a.jpg", await solid(100, 100).jpeg().toBuffer());
    const bad = `https://plan.example.test/f/${image.id}?exp=1&sig=x`;
    for (let i = 0; i < 300; i += 1) {
      expect((await fetchLink(bad, "198.51.100.7")).status).toBe(403);
    }
    expect((await fetchLink(linkFor(image.id, 1600), "198.51.100.7")).status).toBe(429);
    expect((await fetchLink(linkFor(image.id, 1600), "198.51.100.8")).status).toBe(200);
  });
});
