import path from "node:path";

/**
 * Single source of truth for where uploaded images live on disk.
 *
 * Every upload route used to build its own `path.join(process.cwd(), "public", ...)`. That hardcodes
 * the *serving* directory into the *writing* path, which meant the test suite had no way to redirect
 * writes somewhere disposable - so four image-route test files each did
 * `fs.rm(<cwd>/public/uploads/trips, { recursive: true })` in `beforeEach` and wiped the developer's
 * real uploads on every `npm test`. (That is not hypothetical: it destroyed a live dev hero image.)
 *
 * `UPLOADS_PUBLIC_ROOT` lets the test setup point all of this at a per-run temp directory, so no test
 * can reach real files no matter what it deletes. Unset - i.e. in dev and production - it resolves to
 * `<cwd>/public` exactly as before, so served URLs and on-disk layout are unchanged.
 *
 * Read per call rather than captured at module load: the test setup sets the variable before route
 * modules run, but a module-level constant would still bake in whatever was set at import time.
 */
export const getPublicRoot = () => process.env.UPLOADS_PUBLIC_ROOT || path.join(process.cwd(), "public");

/** Root of all trip uploads. The only thing tests should ever clean. */
export const getTripsUploadRoot = () => path.join(getPublicRoot(), "uploads", "trips");

/** Everything owned by one trip - hero image, day images, accommodation and plan-item galleries. */
export const getTripUploadDir = (tripId: string) => path.join(getTripsUploadRoot(), tripId);

export const getTripDayUploadDir = (tripId: string, dayId: string) =>
  path.join(getTripUploadDir(tripId), "days", dayId);

export const getAccommodationImageUploadDir = (tripId: string, dayId: string, accommodationId: string) =>
  path.join(getTripDayUploadDir(tripId, dayId), "accommodations", accommodationId);

export const getDayPlanItemImageUploadDir = (tripId: string, dayId: string, dayPlanItemId: string) =>
  path.join(getTripDayUploadDir(tripId, dayId), "day-plan-items", dayPlanItemId);

/**
 * Maps a stored public URL (`/uploads/trips/...`) back to its file on disk.
 *
 * The leading slash is stripped so `path.join` treats the URL as relative - joining an absolute-looking
 * segment would otherwise discard the configured root and silently fall back to the filesystem root.
 */
export const resolvePublicFilePath = (publicUrl: string) =>
  path.join(getPublicRoot(), publicUrl.replace(/^\/+/, ""));
