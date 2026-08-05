import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/uploads/[...path]/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { getTripUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/**
 * The authorisation gate in front of every uploaded file (Story 8.3, NFR2).
 *
 * **This suite is establishing an idiom rather than following one.** Nothing else in the suite tests
 * a byte-range response, an `ETag`, a conditional request or headers on a file body - `Cache-Control`
 * and `Content-Type` are asserted only on JSON and ZIP routes. The shape below is the standard
 * harness shape (import the handler, build a `NextRequest`, pass `params` as a promise, assert on
 * `response.status` and `response.headers`), extended with `arrayBuffer()` reads where the point of
 * the assertion is the bytes.
 *
 * Every negative here is written so it can actually fail. Story 5.11's review found four test
 * weaknesses that each let a real defect through, including a green test defending a string nothing
 * rendered - so the traversal and symlink cases assert that no bytes come back, not merely that a
 * status code is 404.
 */
describe("GET /uploads/[...path]", () => {
  const uploadsRoot = getTripsUploadRoot();

  /** A recognisable 256-byte body: `bytes[i] === i`, so any slice is checkable by arithmetic. */
  const fileBody = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

  const seed = async (label: string) => {
    const owner = await prisma.user.create({
      data: { email: `uploads-${label}-owner@example.com`, passwordHash: "hashed", role: "OWNER" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: `Uploads ${label}`,
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });
    const ownerToken = await createSessionJwt({ sub: owner.id, role: owner.role });
    return { owner, trip, ownerToken };
  };

  const writeHero = async (tripId: string, fileName = "hero.png", body: Buffer = fileBody) => {
    const dir = getTripUploadDir(tripId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), body);
    return path.join(dir, fileName);
  };

  const get = async (
    segments: string[],
    options?: { token?: string; headers?: Record<string, string>; query?: string },
  ) => {
    const url = `http://localhost/uploads/${segments.map(encodeURIComponent).join("/")}${options?.query ?? ""}`;
    const headers: Record<string, string> = { ...options?.headers };
    if (options?.token) {
      headers.cookie = `session=${options.token}`;
    }
    const request = new NextRequest(url, { method: "GET", headers });
    // `Promise.resolve` and not the bare object: Next 16 types `params` as a promise, and the
    // segments are handed over already URL-decoded, exactly as Next hands them to the handler.
    return GET(request, { params: Promise.resolve({ path: segments }) });
  };

  beforeEach(async () => {
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

  /**
   * The five-row access matrix, and the reason AC2 spells all five out.
   *
   * The four image upload routes gate on `hasTripOwnerAccess`. A guard chain copied from any of them
   * would refuse a viewer and a contributor - and would pass a suite that never tried one, since a
   * viewer looking at a photo is not something those suites do. Owner, viewer and contributor must
   * each get their bytes.
   */
  it("serves the owner, a viewer and a contributor, and refuses everyone else", async () => {
    const { trip, ownerToken } = await seed("access");
    await writeHero(trip.id);

    const unauth = await get(["trips", trip.id, "hero.png"]);
    expect(unauth.status).toBe(401);
    expect(((await unauth.json()) as ApiEnvelope<null>).error?.code).toBe("unauthorized");

    const stranger = await prisma.user.create({
      data: { email: "uploads-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });
    const refused = await get(["trips", trip.id, "hero.png"], { token: strangerToken });
    // 404 and not 403: distinguishing "hidden" from "absent" would leak which trips exist.
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");

    const viewer = await prisma.user.create({
      data: { email: "uploads-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const contributor = await prisma.user.create({
      data: { email: "uploads-contributor@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    const contributorToken = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    for (const token of [ownerToken, viewerToken, contributorToken]) {
      const response = await get(["trips", trip.id, "hero.png"], { token });
      expect(response.status).toBe(200);
      // The bytes, not just the status - a 200 carrying nothing would pass a status-only assertion.
      expect(Buffer.from(await response.arrayBuffer()).equals(fileBody)).toBe(true);
    }
  });

  it("refuses a session whose password change is still outstanding", async () => {
    const { trip, owner } = await seed("mustchange");
    await writeHero(trip.id);
    const token = await createSessionJwt({ sub: owner.id, role: owner.role, mustChangePassword: true });

    const response = await get(["trips", trip.id, "hero.png"], { token });
    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("password_change_required");
  });

  /**
   * AC3, one assertion per input, all of them against a caller who *can* read the trip - otherwise
   * the access gate would be what refused them and the containment layers would be untested.
   *
   * `%2e%2e` and `%2F` are written here as the decoded values Next actually delivers: a catch-all
   * segment arrives decoded, so `%2e%2e` is `..` and `%2F` is a literal `/` *inside one element*.
   * That is why a per-segment check is necessary and also not sufficient on its own.
   *
   * **What this case does not prove** is *which* layer refused each input - the per-segment guard,
   * lexical containment and the `realpath` re-check all answer with the same 404, and deleting the
   * per-segment guard leaves this test green (checked). The guard is asserted directly in
   * `uploadPaths.test.ts`; what is asserted here is the property that matters at the HTTP boundary,
   * which is that none of these inputs yields bytes from outside the root.
   */
  it("refuses every traversal spelling", async () => {
    const { trip, ownerToken } = await seed("traversal");
    await writeHero(trip.id);

    // A file the traversal cases can *actually* reach if containment fails, which is the only kind
    // worth planting. `uploadsRoot` is `<mediaRoot>/uploads/trips`, and the request base is the
    // trip's own directory two levels below that, so `["..", "..", "escaped-secret.png"]` resolves to
    // `<mediaRoot>/uploads/escaped-secret.png` - here. An earlier version of this test wrote the
    // fixture to `<mediaRoot>/escaped-secret.png`, three levels up, which no input below could reach:
    // every case then 404'd on `ENOENT` whatever containment did, and the "no bytes came back"
    // assertions were true by construction rather than by the code being correct.
    const escapeTarget = path.join(uploadsRoot, "..", "escaped-secret.png");
    await fs.mkdir(path.dirname(escapeTarget), { recursive: true });
    await fs.writeFile(escapeTarget, Buffer.from("escaped"));
    // And a second one at the level the single-`..` cases reach, so those are falsifiable too.
    const siblingTripEscape = path.join(uploadsRoot, "escaped-secret.png");
    await fs.writeFile(siblingTripEscape, Buffer.from("escaped"));

    // A sibling root that a prefix check without a trailing separator would let through, equivalent
    // to `tripRepo.test.ts`'s `-evil` fixture.
    const evilSibling = `${getTripUploadDir(trip.id)}-evil`;
    await fs.mkdir(evilSibling, { recursive: true });
    await fs.writeFile(path.join(evilSibling, "hero.png"), Buffer.from("evil"));

    const cases: { name: string; segments: string[] }[] = [
      { name: "parent segment", segments: ["trips", trip.id, "..", "..", "escaped-secret.png"] },
      // `%2e%2e` arrives already decoded, so this is the same array as above by the time Next is done.
      { name: "encoded parent segment", segments: ["trips", trip.id, "..", "escaped-secret.png"] },
      // A decoded `%2F` living inside one element - "one element = one path component" is false.
      { name: "encoded separator inside a segment", segments: ["trips", trip.id, "../escaped-secret.png"] },
      { name: "absolute-looking segment", segments: ["trips", trip.id, "/etc/hosts"] },
      { name: "embedded null byte", segments: ["trips", trip.id, "hero.png\0.txt"] },
      { name: "empty segment", segments: ["trips", trip.id, ""] },
      // Refused by the *access* gate rather than by containment - `<id>-evil` is not a trip this
      // caller can read - but it is the URL an attacker writes, so it is asserted where it is read.
      { name: "sibling trip-directory collision", segments: ["trips", `${trip.id}-evil`, "hero.png"] },
      { name: "not a trips URL", segments: ["other", trip.id, "hero.png"] },
      { name: "too few segments", segments: ["trips", trip.id] },
    ];

    for (const { name, segments } of cases) {
      const response = await get(segments, { token: ownerToken });
      expect(response.status, name).toBe(404);
      // Not merely a 404 - nothing from outside the root may come back in any form.
      const body = Buffer.from(await response.arrayBuffer()).toString("utf8");
      expect(body, name).not.toContain("escaped");
      expect(body, name).not.toContain("evil");
    }

    await fs.rm(escapeTarget, { force: true });
    await fs.rm(siblingTripEscape, { force: true });
  });

  /**
   * The cross-trip direction, which is the one the two symlink cases below do *not* cover: both of
   * those point outside the uploads root, and an earlier version of the handler contained against
   * that root rather than against the authorised trip's own directory. It admitted this, returning a
   * `200` and the victim's bytes to a caller holding a perfectly valid session for a different trip.
   *
   * The distinction is that authorisation is per-trip (`hasTripReadAccess(userId, segments[1])`) so
   * containment must be per-trip too. Rooted at `uploads/`, `<root>/uploads/trips/<other>/hero.png`
   * is still "contained", and a symlink reaching it is refused by nothing at all.
   */
  it("refuses a symlink from one trip into another trip inside the same media root", async () => {
    const { trip: attackerTrip, ownerToken: attackerToken } = await seed("crosstripattacker");
    const { trip: victimTrip, ownerToken: victimToken } = await seed("crosstripvictim");

    const victimDir = getTripUploadDir(victimTrip.id);
    await fs.mkdir(victimDir, { recursive: true });
    await fs.writeFile(path.join(victimDir, "hero.png"), Buffer.from("VICTIM-PRIVATE-BYTES"));

    const attackerDir = getTripUploadDir(attackerTrip.id);
    await fs.mkdir(attackerDir, { recursive: true });
    await fs.symlink(path.join(victimDir, "hero.png"), path.join(attackerDir, "stolen.png"));

    const response = await get(["trips", attackerTrip.id, "stolen.png"], { token: attackerToken });
    expect(response.status).toBe(404);
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).not.toContain("VICTIM-PRIVATE-BYTES");

    // And the victim's own request for the same file still works, so the tightened root refuses the
    // escape without refusing legitimate reads.
    const legitimate = await get(["trips", victimTrip.id, "hero.png"], { token: victimToken });
    expect(legitimate.status).toBe(200);
    expect(Buffer.from(await legitimate.arrayBuffer()).toString("utf8")).toBe("VICTIM-PRIVATE-BYTES");
  });

  /**
   * The lexical check passes a symlink; only the `realpath` re-check catches it, and `fs.stat` and
   * `createReadStream` both follow symlinks. Without this case that layer is untested and a future
   * refactor could delete it with a green suite.
   */
  it("refuses a symlink planted inside the media root that points outside it", async () => {
    const { trip, ownerToken } = await seed("symlink");
    const dir = getTripUploadDir(trip.id);
    await fs.mkdir(dir, { recursive: true });

    const outside = path.join(os.tmpdir(), `travelplan-outside-${process.pid}.png`);
    await fs.writeFile(outside, Buffer.from("outside-the-root"));
    await fs.symlink(outside, path.join(dir, "escape.png"));

    const response = await get(["trips", trip.id, "escape.png"], { token: ownerToken });
    expect(response.status).toBe(404);
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).not.toContain("outside-the-root");

    await fs.rm(outside, { force: true });
  });

  /**
   * The one case that pins the *trailing separator* on the realpath comparison, which is otherwise
   * the easiest layer in the handler to simplify away.
   *
   * A symlink inside the trip's own directory pointing at `<mediaRoot>/uploads-evil/...` produces a
   * realpath that satisfies a bare `startsWith(uploadsRoot)` and is nonetheless outside the uploads
   * root. `tripRepo.ts` gets this right and `tripRepo.test.ts:618` pins its equivalent; without this
   * case the same detail here is unasserted.
   */
  it("refuses a symlink into a sibling of the uploads root", async () => {
    const { trip, ownerToken } = await seed("siblingroot");
    const dir = getTripUploadDir(trip.id);
    await fs.mkdir(dir, { recursive: true });

    // `uploadsRoot` is `<mediaRoot>/uploads/trips`, so two levels up is the media root itself.
    const evilRoot = path.join(uploadsRoot, "..", "..", "uploads-evil");
    await fs.mkdir(evilRoot, { recursive: true });
    await fs.writeFile(path.join(evilRoot, "hero.png"), Buffer.from("sibling-root-bytes"));
    await fs.symlink(path.join(evilRoot, "hero.png"), path.join(dir, "sibling.png"));

    const response = await get(["trips", trip.id, "sibling.png"], { token: ownerToken });
    expect(response.status).toBe(404);
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).not.toContain("sibling-root-bytes");

    await fs.rm(evilRoot, { recursive: true, force: true });
  });

  it("sets the authorised-bytes headers and types by stored extension only", async () => {
    const { trip, ownerToken } = await seed("headers");
    await writeHero(trip.id, "hero.png");
    await writeHero(trip.id, "photo.JPG");
    await writeHero(trip.id, "shot.webp");
    await writeHero(trip.id, "ticket.pdf");

    const png = await get(["trips", trip.id, "hero.png"], { token: ownerToken });
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate, no-transform");
    expect(png.headers.get("x-content-type-options")).toBe("nosniff");
    expect(png.headers.get("accept-ranges")).toBe("bytes");
    expect(png.headers.get("content-length")).toBe(String(fileBody.length));
    expect(png.headers.get("etag")).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(png.headers.get("content-disposition")).toBeNull();
    // `Last-Modified` is the other validator Next's static server sent. Dropping it makes a
    // date-revalidating cache re-download every image instead of receiving a 304.
    expect(png.headers.get("last-modified")).toMatch(/GMT$/);
    // The body depends entirely on the session cookie, and the reverse-proxy config is Story 8.1's.
    expect(png.headers.get("vary")).toBe("Cookie");

    // Extension matching is case-insensitive: the upload routes lower-case theirs, but an imported
    // or hand-placed file need not have.
    const jpg = await get(["trips", trip.id, "photo.JPG"], { token: ownerToken });
    expect(jpg.headers.get("content-type")).toBe("image/jpeg");
    expect((await get(["trips", trip.id, "shot.webp"], { token: ownerToken })).headers.get("content-type")).toBe(
      "image/webp",
    );

    /**
     * An unrecognised extension is never guessed at and never rendered in place. `pdf` is
     * deliberately unrecognised *here*: Story 9.1 is what adds it, with `inline`, and until then a
     * PDF is bytes of unknown type like any other.
     */
    const pdf = await get(["trips", trip.id, "ticket.pdf"], { token: ownerToken });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/octet-stream");
    expect(pdf.headers.get("content-disposition")).toBe("attachment");
  });

  it("answers a matching If-None-Match with a 304 that carries the ETag", async () => {
    const { trip, ownerToken } = await seed("conditional");
    await writeHero(trip.id);

    const first = await get(["trips", trip.id, "hero.png"], { token: ownerToken });
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const revalidated = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { "if-none-match": etag as string },
    });
    expect(revalidated.status).toBe(304);
    // Omitting the ETag here is the classic silent-re-fetch bug: the client would have nothing to
    // revalidate against on the next navigation and would re-download every image every time.
    expect(revalidated.headers.get("etag")).toBe(etag);
    expect(Buffer.from(await revalidated.arrayBuffer()).byteLength).toBe(0);

    const stale = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { "if-none-match": 'W/"deadbeef-1"' },
    });
    expect(stale.status).toBe(200);
    expect(Buffer.from(await stale.arrayBuffer()).equals(fileBody)).toBe(true);

    // `*` means "any current representation", so an existing file matches it.
    const star = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { "if-none-match": "*" },
    });
    expect(star.status).toBe(304);
  });

  /**
   * The date validator, which Next's static server also supplied and which the first version of this
   * route dropped entirely. Only consulted when there is no `If-None-Match` - the entity tag is the
   * stronger validator and wins whenever a client sends both, which browsers do.
   */
  it("answers If-Modified-Since when no If-None-Match is present", async () => {
    const { trip, ownerToken } = await seed("ifmodifiedsince");
    await writeHero(trip.id);

    const first = await get(["trips", trip.id, "hero.png"], { token: ownerToken });
    const lastModified = first.headers.get("last-modified") as string;
    expect(lastModified).toBeTruthy();

    const fresh = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { "if-modified-since": lastModified },
    });
    expect(fresh.status).toBe(304);
    expect(fresh.headers.get("last-modified")).toBe(lastModified);
    expect(fresh.headers.get("etag")).toBe(first.headers.get("etag"));

    const long_ago = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { "if-modified-since": new Date(0).toUTCString() },
    });
    expect(long_ago.status).toBe(200);
    expect(Buffer.from(await long_ago.arrayBuffer()).equals(fileBody)).toBe(true);

    // A non-matching entity tag alongside a fresh date must still serve the body: the ETag decides.
    const etagWins = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { "if-none-match": 'W/"deadbeef-1"', "if-modified-since": lastModified },
    });
    expect(etagWins.status).toBe(200);
  });

  it("answers range requests with the right status, headers and bytes", async () => {
    const { trip, ownerToken } = await seed("range");
    await writeHero(trip.id);
    const size = fileBody.length;

    const first = await get(["trips", trip.id, "hero.png"], { token: ownerToken });
    const etag = first.headers.get("etag") as string;

    const closed = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=0-9" },
    });
    expect(closed.status).toBe(206);
    expect(closed.headers.get("content-range")).toBe(`bytes 0-9/${size}`);
    expect(closed.headers.get("content-length")).toBe("10");
    // The bytes have to be that slice of the file, not just ten bytes of something.
    expect(Buffer.from(await closed.arrayBuffer()).equals(fileBody.subarray(0, 10))).toBe(true);

    const openEnded = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=5-" },
    });
    expect(openEnded.status).toBe(206);
    expect(openEnded.headers.get("content-range")).toBe(`bytes 5-${size - 1}/${size}`);
    expect(Buffer.from(await openEnded.arrayBuffer()).equals(fileBody.subarray(5))).toBe(true);

    const suffix = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=-5" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe(`bytes ${size - 5}-${size - 1}/${size}`);
    expect(Buffer.from(await suffix.arrayBuffer()).equals(fileBody.subarray(size - 5))).toBe(true);

    const unsatisfiable = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=999999-" },
    });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("content-range")).toBe(`bytes */${size}`);
    expect(Buffer.from(await unsatisfiable.arrayBuffer()).byteLength).toBe(0);

    // Multi-range needs a `multipart/byteranges` body and nothing that reaches this route sends one;
    // the whole file is a correct answer to a `Range` the server declines to honour.
    const multi = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=0-9,20-29" },
    });
    expect(multi.status).toBe(200);
    expect(Buffer.from(await multi.arrayBuffer()).equals(fileBody)).toBe(true);

    // A matching `If-Range` keeps the range...
    const ifRangeMatch = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=0-9", "if-range": etag },
    });
    expect(ifRangeMatch.status).toBe(206);

    // ...and a mismatching one means the client's copy is stale, so its offsets are meaningless.
    const ifRangeMismatch = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=0-9", "if-range": 'W/"deadbeef-1"' },
    });
    expect(ifRangeMismatch.status).toBe(200);
    expect(Buffer.from(await ifRangeMismatch.arrayBuffer()).equals(fileBody)).toBe(true);

    // `*` is legal in `If-None-Match` but not in `If-Range`, so a header spelt that way is malformed
    // and must not be honoured as a match - otherwise a broken client silently gets a partial body.
    const ifRangeStar = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=0-9", "if-range": "*" },
    });
    expect(ifRangeStar.status).toBe(200);
    expect(Buffer.from(await ifRangeStar.arrayBuffer()).equals(fileBody)).toBe(true);

    // An inverted range is invalid *syntax*, not an unsatisfiable range: RFC 9110 §14.2 says ignore
    // it and serve the representation. A 416 here would hand the client nothing it could use.
    const inverted = await get(["trips", trip.id, "hero.png"], {
      token: ownerToken,
      headers: { range: "bytes=5-2" },
    });
    expect(inverted.status).toBe(200);
    expect(Buffer.from(await inverted.arrayBuffer()).equals(fileBody)).toBe(true);
  });

  /**
   * AC2a. `withImageCacheBuster` appends `?v=<token>` to every freshly uploaded URL and `toCssUrl`
   * runs the whole URL through `encodeURI` for the three `background-image` sites, so the handler
   * must be indifferent to the query string - it reads `params.path` and nothing else.
   */
  it("ignores the cache-buster query string", async () => {
    const { trip, ownerToken } = await seed("querystring");
    await writeHero(trip.id);

    const plain = await get(["trips", trip.id, "hero.png"], { token: ownerToken });
    const busted = await get(["trips", trip.id, "hero.png"], { token: ownerToken, query: "?v=abc123" });
    const doubled = await get(["trips", trip.id, "hero.png"], { token: ownerToken, query: "?v=abc123&v=def456" });

    for (const response of [busted, doubled]) {
      expect(response.status).toBe(plain.status);
      expect(response.headers.get("etag")).toBe(plain.headers.get("etag"));
      expect(Buffer.from(await response.arrayBuffer()).equals(fileBody)).toBe(true);
    }
  });

  it("answers 404 rather than 500 for a missing file under a readable trip", async () => {
    const { trip, ownerToken } = await seed("missing");
    await writeHero(trip.id);

    const response = await get(["trips", trip.id, "does-not-exist.png"], { token: ownerToken });
    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
  });

  it("answers 404 for a directory and refuses a zero-byte file's range", async () => {
    const { trip, ownerToken } = await seed("edges");
    const dir = getTripUploadDir(trip.id);
    await fs.mkdir(path.join(dir, "days"), { recursive: true });
    await fs.writeFile(path.join(dir, "empty.png"), Buffer.alloc(0));

    // A directory resolves and stats cleanly; only the `isFile()` check refuses it.
    const directory = await get(["trips", trip.id, "days"], { token: ownerToken });
    expect(directory.status).toBe(404);

    const emptyFull = await get(["trips", trip.id, "empty.png"], { token: ownerToken });
    expect(emptyFull.status).toBe(200);
    expect(emptyFull.headers.get("content-length")).toBe("0");

    // An empty file can satisfy no range at all, not even `bytes=0-`.
    const emptyRange = await get(["trips", trip.id, "empty.png"], {
      token: ownerToken,
      headers: { range: "bytes=0-" },
    });
    expect(emptyRange.status).toBe(416);
    expect(emptyRange.headers.get("content-range")).toBe("bytes */0");
  });
});
