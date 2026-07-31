import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  getAccommodationImageUploadDir,
  getDayPlanItemImageUploadDir,
  getPublicRoot,
  getTripDayUploadDir,
  getTripUploadDir,
  getTripsUploadRoot,
  resolvePublicFilePath,
} from "@/lib/trips/uploadPaths";

/**
 * Guards the test-isolation fix for a bug that destroyed real user data.
 *
 * Four image-route suites clean up with `fs.rm(<uploadsRoot>, { recursive: true, force: true })`.
 * While every route hardcoded `path.join(process.cwd(), "public", ...)`, `uploadsRoot` resolved to the
 * developer's live `public/uploads/trips` - so `npm test` deleted real uploaded images. A hero image
 * and two day images were lost that way before the routes were moved onto `UPLOADS_PUBLIC_ROOT`.
 *
 * The single assertion that matters: while running under the test setup, nothing here may resolve
 * inside the repo's `public/` directory. If someone reintroduces a hardcoded path, this fails.
 */
describe("upload paths", () => {
  const realPublicDir = path.join(process.cwd(), "public");

  it("resolves every upload path outside the repo's public directory under test", () => {
    const paths = [
      getPublicRoot(),
      getTripsUploadRoot(),
      getTripUploadDir("trip-1"),
      getTripDayUploadDir("trip-1", "day-1"),
      getAccommodationImageUploadDir("trip-1", "day-1", "stay-1"),
      getDayPlanItemImageUploadDir("trip-1", "day-1", "item-1"),
      resolvePublicFilePath("/uploads/trips/trip-1/hero.png"),
    ];

    for (const resolved of paths) {
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved.startsWith(realPublicDir)).toBe(false);
    }
  });

  it("honours UPLOADS_PUBLIC_ROOT and keeps the public URL layout intact beneath it", () => {
    const root = getPublicRoot();
    expect(root).toBe(process.env.UPLOADS_PUBLIC_ROOT);

    // The served URL shape is a contract with the DB and the browser, so only the root may move:
    // everything below it must still mirror `/uploads/trips/<trip>/days/<day>/...`.
    expect(getTripsUploadRoot()).toBe(path.join(root, "uploads", "trips"));
    expect(getTripUploadDir("trip-1")).toBe(path.join(root, "uploads", "trips", "trip-1"));
    expect(getTripDayUploadDir("trip-1", "day-1")).toBe(
      path.join(root, "uploads", "trips", "trip-1", "days", "day-1"),
    );
    expect(getAccommodationImageUploadDir("trip-1", "day-1", "stay-1")).toBe(
      path.join(root, "uploads", "trips", "trip-1", "days", "day-1", "accommodations", "stay-1"),
    );
    expect(getDayPlanItemImageUploadDir("trip-1", "day-1", "item-1")).toBe(
      path.join(root, "uploads", "trips", "trip-1", "days", "day-1", "day-plan-items", "item-1"),
    );
  });

  it("maps a stored public URL back onto the configured root", () => {
    const root = getPublicRoot();
    const expected = path.join(root, "uploads", "trips", "trip-1", "hero.png");

    // The leading slash must not make `path.join` discard the root - that would send unlink() at the
    // filesystem root instead of the configured one.
    expect(resolvePublicFilePath("/uploads/trips/trip-1/hero.png")).toBe(expected);
    expect(resolvePublicFilePath("uploads/trips/trip-1/hero.png")).toBe(expected);
  });
});
