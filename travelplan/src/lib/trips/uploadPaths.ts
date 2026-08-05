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
 * Two things follow from the separation and neither is cosmetic. A directory walk over an entry - the
 * export pool builder is one, and any future cleanup pass is another - reads the entry directory as
 * "this entry's photographs"; a PDF, or worse a JPEG that the user filed as a ticket, sitting in it
 * would be indistinguishable from one. And the two sets stay separable on disk, so a document can be
 * removed, counted or archived without first consulting the database about which of the files in the
 * directory the database thinks is a photo.
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
