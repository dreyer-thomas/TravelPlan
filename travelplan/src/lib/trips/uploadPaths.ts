import path from "node:path";

/**
 * Single source of truth for where uploaded media lives on disk.
 *
 * **Why it is not in `public/` (NFR2, Story 8.3).** Next serves `public/` statically, ahead of any
 * route handler and without consulting the session, so anything under it is readable by anyone who
 * learns the URL. Trip photos and documents are frequently not the owner's to publish, and tickets
 * carry names, addresses and booking codes. Media therefore lives under a root *outside* the served
 * tree, and `src/app/uploads/[...path]/route.ts` is the only way to read it - it authorises every
 * request with `hasTripReadAccess` before streaming a byte. The stored URL shape
 * (`/uploads/trips/<tripId>/...`) did not change when the root moved: `uploads` is a segment of the
 * URL, not of the root, so the database and every component were left untouched.
 *
 * **Why nothing may bypass this module (DW-22).** Every upload route used to build its own
 * `path.join(process.cwd(), "public", ...)`. That hardcodes the *serving* directory into the
 * *writing* path, which meant the test suite had no way to redirect writes somewhere disposable - so
 * four image-route test files each did `fs.rm(<cwd>/public/uploads/trips, { recursive: true })` in
 * `beforeEach` and wiped the developer's real uploads on every `npm test`. (That is not hypothetical:
 * it destroyed a live dev hero image and two day images.) `MEDIA_STORAGE_ROOT` is what lets
 * `test/setup.ts` point all of this at a per-worker temp directory, so no test can reach real files
 * no matter what it removes.
 *
 * Read per call rather than captured at module load: the test setup sets the variable before route
 * modules run, but a module-level constant would still bake in whatever was set at import time.
 */

/**
 * Development and test default. `var` is the conventional home for variable data, and the two things
 * that matter about it here are both absences: it is outside `public/`, so Next will not serve it,
 * and it is outside `.next/`, so a rebuild does not empty it.
 */
const DEFAULT_MEDIA_ROOT_DIR = "var";

export const getMediaRoot = () => {
  // Trimmed, because a value that is nothing but whitespace is a mistake rather than a path, and
  // untrimmed it is truthy - so it would sail past the production guard below and then resolve every
  // write relative to `process.cwd()`.
  const configured = process.env.MEDIA_STORAGE_ROOT?.trim();
  if (configured) {
    // Setting the variable wrongly is worse than leaving it unset, because the guard below never
    // runs and nothing else complains. Both of these are checked in every environment, not just
    // production: a mis-rooted development tree is how the DW-22 incident started.
    if (!path.isAbsolute(configured)) {
      // A relative value resolves against `process.cwd()`, i.e. inside the application tree - the
      // exact outcome the production guard exists to prevent, reached by *setting* the variable.
      throw new Error(
        `MEDIA_STORAGE_ROOT must be an absolute path; received ${JSON.stringify(configured)}. A ` +
          "relative path resolves inside the application tree, where a redeploy silently empties " +
          "it - see docs/deployment-configuration.md.",
      );
    }
    const servedRoot = path.join(process.cwd(), "public");
    if (configured === servedRoot || configured.startsWith(`${servedRoot}${path.sep}`)) {
      // The whole point of Story 8.3. Next serves `public/` statically, ahead of any route handler
      // and without consulting the session, so a root inside it re-publishes every trip photo to
      // anyone holding the URL and reopens NFR2 completely - with a green test suite and no log line,
      // because the serve route still works perfectly. Nothing else would ever notice.
      throw new Error(
        `MEDIA_STORAGE_ROOT must not be inside ${servedRoot}. Next serves that directory statically, ` +
          "ahead of any route handler and without a session check, so uploaded media placed there is " +
          "readable by anyone who learns the URL - see docs/deployment-configuration.md.",
      );
    }
    return configured;
  }

  // Documentation cannot stop a redeploy from emptying the media root, so production refuses to run
  // on the default at all. `process.cwd()` on a server is the application tree - i.e. the thing a
  // deploy replaces - and media that lives inside it disappears the first time one runs, silently
  // and with no error to trace it back to. Dev and test keep the default: there, `travelplan/var` is
  // exactly where it should be, and `test/setup.ts` overrides it anyway.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MEDIA_STORAGE_ROOT must be set in production. Unset, uploaded media resolves inside the " +
        "application tree, where a redeploy silently empties it. Point it at an absolute path " +
        "outside the application tree that the service user can read and write - see " +
        "docs/deployment-configuration.md.",
    );
  }

  return path.join(process.cwd(), DEFAULT_MEDIA_ROOT_DIR);
};

/** Root of all trip uploads. The only thing tests should ever clean. */
export const getTripsUploadRoot = () => path.join(getMediaRoot(), "uploads", "trips");

/** Everything owned by one trip - hero image, day images, accommodation and plan-item galleries. */
export const getTripUploadDir = (tripId: string) => path.join(getTripsUploadRoot(), tripId);

export const getTripDayUploadDir = (tripId: string, dayId: string) =>
  path.join(getTripUploadDir(tripId), "days", dayId);

export const getAccommodationImageUploadDir = (tripId: string, dayId: string, accommodationId: string) =>
  path.join(getTripDayUploadDir(tripId, dayId), "accommodations", accommodationId);

export const getDayPlanItemImageUploadDir = (tripId: string, dayId: string, dayPlanItemId: string) =>
  path.join(getTripDayUploadDir(tripId, dayId), "day-plan-items", dayPlanItemId);

/**
 * Documents (Story 9.1) live in a `documents` subdirectory of the entry's own image directory rather
 * than beside its photos.
 *
 * The reason is separability on disk: a document can be removed, counted or archived without first
 * consulting the database about which of the files in the entry's directory the database thinks is a
 * photo. Flat, a PDF - or worse a JPEG the user filed as a ticket - would be indistinguishable from a
 * photograph to anything reading the directory rather than the rows.
 *
 * **Nothing reads it that way today.** No code in `src/` calls `readdir`: the export pool builder in
 * `tripRepo.ts` walks Prisma rows and resolves each stored URL through `resolveOwnedMediaPath`, and
 * the cleanup pass that would walk the tree does not exist (DW-187). So this separation is what makes
 * such a walker possible, not something an existing one relies on - do not read the layout as evidence
 * that a directory walk is already the authority anywhere.
 *
 * Composed from the image-dir helpers rather than rebuilt from `getTripDayUploadDir`, so there is
 * exactly one definition of where an entry's media lives and this pair cannot drift from it. Nothing
 * here goes anywhere near `process.cwd()` - see the DW-22 note in this file's header.
 */
export const getAccommodationDocumentUploadDir = (tripId: string, dayId: string, accommodationId: string) =>
  path.join(getAccommodationImageUploadDir(tripId, dayId, accommodationId), "documents");

export const getDayPlanItemDocumentUploadDir = (tripId: string, dayId: string, dayPlanItemId: string) =>
  path.join(getDayPlanItemImageUploadDir(tripId, dayId, dayPlanItemId), "documents");

/**
 * Whether one URL path segment is safe to treat as a single path component.
 *
 * **One decoded segment is not the same thing as one path component.** Next URL-decodes catch-all
 * segments before a handler sees them, so `%2e%2e` arrives as a literal `..` and - the part that
 * catches people out - `%2F` arrives as a literal `/` *inside a single array element*. So
 * "one element, one component" is false, and rejecting per element is necessary.
 *
 * It is also not sufficient, which is why it lives here rather than being the whole of the check: the
 * serve route follows it with lexical containment against the root plus a trailing separator, and
 * then a `realpath` comparison against a root that was itself realpath'd. This layer's job is to stop
 * a hostile segment reaching `path.resolve` and `fs` at all - the two layers after it are what make
 * the containment property true. Kept in this module, beside the root it protects, and exported so it
 * can be asserted directly: through the HTTP surface its refusals are indistinguishable from the
 * later layers' refusals, so tested only end-to-end it would be deletable with a green suite.
 */
export const isSafeMediaSegment = (segment: string) =>
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !segment.includes("/") &&
  !segment.includes("\\") &&
  !segment.includes("\0");

/**
 * Maps a stored media URL (`/uploads/trips/...`) back onto its file on disk.
 *
 * The leading slash is stripped so `path.join` treats the URL as relative - joining an absolute-looking
 * segment would otherwise discard the configured root and silently fall back to the filesystem root.
 *
 * This performs no containment check and must not be trusted with an untrusted URL on its own: see
 * `resolveOwnedMediaPath` in `tripRepo.ts` and the serve route for the three layers that do.
 */
export const resolveStoredMediaPath = (storedUrl: string) =>
  path.join(getMediaRoot(), storedUrl.replace(/^\/+/, ""));

/**
 * Whether a stored URL names something *outside* our media tree entirely (Story 8.4 / AC8).
 *
 * **This is the only string-shape test left, and the change of question is the whole point.** Four
 * iterations of this story asked "does this look like one of ours?" and each one shipped a rule the next
 * review walked through, because "looks like ours" is an open set of spellings that cannot be enumerated:
 *
 * | Rule | Walked through by |
 * |---|---|
 * | `startsWith("/uploads/trips/<id>/")` | `//uploads/…`, nested media, `..` traversal |
 * | `startsWith("/uploads/")` on the raw string | `//uploads/…`, `/uploads//…` |
 * | leading slashes collapsed, then `startsWith("/uploads/")` | `uploads/…`, `/./uploads/…`, `/Uploads/…` |
 * | first non-empty, non-`.` segment `=== "uploads"` | `/x/../uploads/trips/<other>/hero.jpg` |
 *
 * The last one is not a careless rule - it was written to survive the three before it, and it does. It
 * fails because a `..` *pops the segment in front of it*, so the first segment of the string is not the
 * first segment of the path, while `resolveStoredMediaPath` maps the value onto byte-for-byte the same
 * file as the canonical spelling (confirmed by execution). And fixing that by resolving `..` before the
 * test is the *other* wrong answer: `path.posix.normalize("/uploads/trips/../../../etc/passwd")` is not a
 * media URL, which would hand a traversal the very "nothing of ours here" exit the rule exists to deny it.
 * Both directions are wrong, which is the signal that the question is wrong.
 *
 * **"Is this external?" is closed and decidable.** A value either parses as an absolute URL with a scheme
 * or it does not; there is no fifth spelling of `https://`. So this is used *only* to let an external
 * cover image out, and **everything else is treated as naming a path in our tree** and sent to the
 * resolved-path containment check - which fails closed: not inside the directory you own means nulled
 * (`isForeignTripUploadUrl`) or refused-and-logged (`removeManagedMediaFile`). The escape case and the
 * foreign-trip case stop being two rules with two exit paths and become one rule with one.
 *
 * `new URL("C:/x")` succeeds on Node (scheme `c:`), so a Windows-style path reads as external. That is the
 * safe direction here - no unlink, no null - and no writer in this application can produce one.
 */
export const isExternalMediaUrl = (storedUrl: string) => URL.canParse(storedUrl);

/**
 * Compares two resolved media paths the way the filesystem under them does.
 *
 * **Why case-folded, and why it has to be in one place.** A case-insensitive filesystem opens
 * `/Uploads/…` and `/uploads/…` as the same file, so every question this module answers about a resolved
 * path has to be answered the way that filesystem would answer it. When two of them disagree the pair is
 * a deletion rather than a refusal: a `/Uploads/…` row judged case-sensitively reads as *outside* the very
 * directory it is inside, so the import rule keeps a URL it should null and the cleanup logs a refusal
 * instead of removing the file - while a third comparison that reads the same file as *two* files fires
 * the cleanup at the file the row was just pointed at (both confirmed by execution). One shared key is
 * what stops the three from drifting back apart.
 *
 * For a *directory* comparison, folding case cannot merge two genuinely different directories here: both
 * sides are built from the same media root, and the only varying segments are trip, day and entry ids,
 * which are `cuid()`s - lowercase alphanumerics that cannot differ by case alone. For a *file*
 * comparison (`mediaPathsNameSameFile`) that argument does not hold, because the final segment is a
 * filename: on a case-sensitive filesystem `day.webp` and `DAY.webp` really are two files. The fold is
 * still right there, and the trade is deliberate - reading them as one file at worst skips an unlink and
 * leaves one orphan, where reading them as two deletes the file a row still points at.
 */
const mediaPathKey = (mediaPath: string) => path.resolve(mediaPath).toLowerCase();

/** Whether a resolved media path sits *directly* in `dir` - the containment rule, in one place. */
export const mediaPathIsDirectlyIn = (filePath: string, dir: string) =>
  mediaPathKey(path.dirname(path.resolve(filePath))) === mediaPathKey(dir);

/** Whether a resolved media path sits anywhere beneath `dir`. The trailing separator is load-bearing:
 * without it `…/abc` reads as inside trip `abcd`. */
export const mediaPathIsInside = (filePath: string, dir: string) =>
  mediaPathKey(filePath).startsWith(`${mediaPathKey(dir)}${path.sep}`);

/**
 * Whether two resolved media paths name one file. The third comparator, and it has to be here with the
 * other two.
 *
 * Iteration 5: `storedMediaUrlsNameSameFile` compared `path.resolve(a) === path.resolve(b)`
 * case-*sensitively* while `mediaPathIsDirectlyIn` folded case, so the day-image cleanup could read one
 * file as two and then be permitted to unlink it. Confirmed by execution: a previous URL of
 * `/Uploads/trips/<t>/days/<d>/day.webp` against a new one of `/uploads/trips/<t>/days/<d>/day.webp` gave
 * "not the same file" (so the cleanup fired) and "directly inside the day's directory" (so it was allowed)
 * - deleting the file the row had just been pointed at. Pass 4 introduced the fold to end exactly this
 * disagreement and left this one comparison out of it.
 */
export const mediaPathsNameSameFile = (a: string, b: string) => mediaPathKey(a) === mediaPathKey(b);

/**
 * The day id a stored media URL actually lives under, or `null` if it does not name one for this trip.
 *
 * **Why a media cleanup cannot use the day id from the request (Story 8.4 / AC9).** An activity's media
 * does not follow the activity between days. `moveDayPlanItemToTripDay`
 * (`dayPlanItemRepo.ts:660-698`) moves one with a bare `updateMany` of `tripDayId` - deliberately, so
 * that "everything attached to the activity travels with it for free" - which moves no file and rewrites
 * no URL. So after a move the row names one day and its stored URL names another, and the URL is the one
 * that is true about the disk. The second implementation of this story built the directory it was allowed
 * to unlink in out of `parsed.data.tripDayId`, the *current* day; the dirname check then failed for every
 * photo and document of every activity that had ever been moved, and the delete answered
 * `200 { deleted: true }` with the bytes orphaned for good, since the row that named them was gone
 * (confirmed by execution). The trip-wide prefix test it replaced removed them correctly, so that was a
 * regression rather than a new gap.
 *
 * **Containment is not weakened by reading a segment out of the URL.** Exactly one segment is taken, it
 * must satisfy `isSafeMediaSegment`, and it is taken only after the resolved path has been shown to be
 * inside `getTripUploadDir(tripId)` - a directory the caller composed from the route parameter it has
 * already authorised. Everything else in the directory the cleanup then compares against is composed from
 * ids the caller already holds, and that comparison is exact equality against a path built only from safe
 * segments. A `..`, an empty segment, a nested path or another trip's id all return `null` here, and a
 * `null` means the unlink is skipped rather than aimed somewhere else.
 *
 * **Derived from the resolved path, never from a second parse of the raw URL, and that is what makes it
 * spelling-proof by construction.** Two earlier versions ran their own `split("/")` over the string, and
 * each inherited every defect of the shape test beside it: they answered `null` for `/uploads//trips/…`,
 * `/./uploads/…`, `/Uploads/…` and `/x/../uploads/…` while `resolveStoredMediaPath` mapped all of them onto
 * a real file inside the entry's own directory (confirmed by execution). On the four media routes a `null`
 * means "log and skip", so those spellings left a committed row delete with the bytes still on disk. There
 * is exactly one authority on what a stored URL names on disk - `resolveStoredMediaPath` - and every
 * structural question is asked of *its answer* rather than of the string it was given, so no future
 * spelling can make this disagree with the check that acts on it.
 *
 * `path.relative` is taken over the case-folded pair for the same reason `mediaPathKey` folds: the
 * `mediaPathIsInside` above has already answered "inside" case-insensitively, and a case-sensitive
 * `path.relative` against that same pair answers with a `..` prefix instead - which is precisely the
 * disagreement this module exists to prevent. The day id is returned in the *resolved path's* own spelling,
 * taken from the same position in the unfolded path, because that spelling is what opens the file.
 */
export const readStoredMediaDayId = (storedUrl: string, tripId: string): string | null => {
  const tripDir = path.resolve(getTripUploadDir(tripId));
  const resolved = path.resolve(resolveStoredMediaPath(storedUrl));
  if (!mediaPathIsInside(resolved, tripDir)) return null;

  const relativeSegments = path.relative(mediaPathKey(tripDir), mediaPathKey(resolved)).split(path.sep);
  if (relativeSegments.length < 2 || relativeSegments[0] !== "days") return null;

  // The folded relative is the tail of the unfolded resolved path segment for segment, so the day id sits
  // at the same offset from the end of both.
  const dayId = resolved.split(path.sep).at(-(relativeSegments.length - 1));
  return dayId && isSafeMediaSegment(dayId) ? dayId : null;
};
