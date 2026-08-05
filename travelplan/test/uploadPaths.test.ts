import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assertMediaRootConfigured } from "@/lib/trips/mediaRootBoot";
import {
  getAccommodationImageUploadDir,
  getDayPlanItemImageUploadDir,
  getMediaRoot,
  getTripDayUploadDir,
  getTripUploadDir,
  getTripsUploadRoot,
  isSafeMediaSegment,
  resolveStoredMediaPath,
} from "@/lib/trips/uploadPaths";

/**
 * Guards the two separate properties `uploadPaths.ts` exists to hold.
 *
 * **Test isolation (DW-22).** Four image-route suites clean up with
 * `fs.rm(<uploadsRoot>, { recursive: true, force: true })`. While every route hardcoded
 * `path.join(process.cwd(), "public", ...)`, `uploadsRoot` resolved to the developer's live
 * `public/uploads/trips` - so `npm test` deleted real uploaded images. A hero image and two day
 * images were lost that way before the routes were moved onto the configurable root.
 *
 * **NFR2 (Story 8.3).** The root is now also the thing that keeps uploaded media out of the
 * statically-served tree. `public/` is served by Next ahead of any route handler and without
 * consulting the session, so a path that resolves inside it is readable by anyone holding the URL -
 * which trip photos, frequently not the owner's to publish, must not be.
 */
describe("upload paths", () => {
  const realPublicDir = path.join(process.cwd(), "public");

  it("resolves every upload path outside the repo's public directory under test", () => {
    const paths = [
      getMediaRoot(),
      getTripsUploadRoot(),
      getTripUploadDir("trip-1"),
      getTripDayUploadDir("trip-1", "day-1"),
      getAccommodationImageUploadDir("trip-1", "day-1", "stay-1"),
      getDayPlanItemImageUploadDir("trip-1", "day-1", "item-1"),
      resolveStoredMediaPath("/uploads/trips/trip-1/hero.png"),
    ];

    for (const resolved of paths) {
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved.startsWith(realPublicDir)).toBe(false);
    }
  });

  /**
   * The assertion above proves less than it looks like it does: `test/setup.ts` sets
   * `MEDIA_STORAGE_ROOT` to a temp directory, so under test it is nearly a tautology. This is the
   * case that can actually fail - it removes the variable and interrogates the *default*, which is
   * what dev and production run on. Before Story 8.3 the default was `<cwd>/public` and this failed.
   *
   * The variable is restored in `finally` because the whole suite shares one process
   * (`vitest.config.ts` pins `maxForks: 1` and `fileParallelism: false`): leaking the unset value
   * would send every later suite's writes into the repo's real `var/` tree.
   */
  it("keeps the default root outside public/ when MEDIA_STORAGE_ROOT is unset", () => {
    const configured = process.env.MEDIA_STORAGE_ROOT;
    delete process.env.MEDIA_STORAGE_ROOT;
    try {
      const defaultRoot = getMediaRoot();
      expect(path.isAbsolute(defaultRoot)).toBe(true);
      expect(defaultRoot).not.toBe(realPublicDir);
      expect(defaultRoot.startsWith(`${realPublicDir}${path.sep}`)).toBe(false);
      // And the whole tree beneath it, since that is what actually gets written to.
      expect(path.join(defaultRoot, "uploads", "trips").startsWith(realPublicDir)).toBe(false);
    } finally {
      process.env.MEDIA_STORAGE_ROOT = configured;
    }
  });

  /**
   * The production fail-fast, and the reason it needs a test of its own.
   *
   * The case above unsets the variable but runs under `NODE_ENV=test`, so it exercises the *default*
   * branch and never the throw. Without this block, deleting the entire production guard leaves the
   * whole suite green - which is exactly the property that got `isSafeMediaSegment` moved out of the
   * route handler, and the guard is what `docs/deployment-configuration.md` calls the only real
   * enforcement of "the media root must survive a redeploy".
   *
   * `NODE_ENV` is restored in `finally` for the same reason the variable is: one process, shared by
   * every suite (`vitest.config.ts` pins `maxForks: 1` and `fileParallelism: false`).
   */
  describe("the media root refuses to be misconfigured", () => {
    const withEnv = (env: Record<string, string | undefined>, assertion: () => void) => {
      const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      try {
        assertion();
      } finally {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    };

    it("throws in production when MEDIA_STORAGE_ROOT is unset", () => {
      withEnv({ NODE_ENV: "production", MEDIA_STORAGE_ROOT: undefined }, () => {
        expect(() => getMediaRoot()).toThrow(/MEDIA_STORAGE_ROOT must be set in production/);
      });
    });

    it("keeps the default in development and test rather than throwing", () => {
      withEnv({ NODE_ENV: "development", MEDIA_STORAGE_ROOT: undefined }, () => {
        expect(getMediaRoot()).toBe(path.join(process.cwd(), "var"));
      });
    });

    /**
     * Setting the variable wrongly is worse than leaving it unset: the production guard never runs,
     * so nothing else in the system would ever complain.
     */
    it("refuses a relative root, which would resolve inside the application tree", () => {
      withEnv({ MEDIA_STORAGE_ROOT: "var" }, () => {
        expect(() => getMediaRoot()).toThrow(/must be an absolute path/);
      });
      withEnv({ MEDIA_STORAGE_ROOT: "./media" }, () => {
        expect(() => getMediaRoot()).toThrow(/must be an absolute path/);
      });
    });

    /**
     * The one misconfiguration that undoes the whole of Story 8.3 while leaving every test green and
     * the serve route working perfectly: Next serves `public/` statically, ahead of the handler.
     */
    it("refuses a root inside the statically-served public directory", () => {
      withEnv({ MEDIA_STORAGE_ROOT: path.join(realPublicDir, "media") }, () => {
        expect(() => getMediaRoot()).toThrow(/must not be inside/);
      });
      withEnv({ MEDIA_STORAGE_ROOT: realPublicDir }, () => {
        expect(() => getMediaRoot()).toThrow(/must not be inside/);
      });
    });

    it("treats a whitespace-only root as unset rather than as a path", () => {
      withEnv({ NODE_ENV: "production", MEDIA_STORAGE_ROOT: "   " }, () => {
        expect(() => getMediaRoot()).toThrow(/must be set in production/);
      });
    });

    /**
     * The boot check, which is what makes the deployment docs' "the application refuses to start"
     * literally true rather than aspirational. `getMediaRoot()`'s own throw is per call and every
     * caller is inside a request handler, so on its own it lets a misconfigured server boot, bind and
     * pass a health check - the failure then surfaces as a 500 on a thumbnail.
     *
     * `NODE_ENV` is an allow-list here, unlike `getMediaRoot`'s deny-one comparison: this runs only
     * inside the Next server, where "staging" or an unset value is no reason to accept a root inside
     * the application tree.
     */
    describe("assertMediaRootConfigured", () => {
      it("passes on a correctly configured root", () => {
        expect(() => assertMediaRootConfigured()).not.toThrow();
      });

      it("refuses to start when the root is unset and NODE_ENV is not development or test", () => {
        for (const nodeEnv of ["production", "staging", undefined]) {
          withEnv({ NODE_ENV: nodeEnv, MEDIA_STORAGE_ROOT: undefined }, () => {
            expect(() => assertMediaRootConfigured(), String(nodeEnv)).toThrow(
              /MEDIA_STORAGE_ROOT must be set when starting the server/,
            );
          });
        }
      });

      it("allows the default in development and test", () => {
        for (const nodeEnv of ["development", "test"]) {
          withEnv({ NODE_ENV: nodeEnv, MEDIA_STORAGE_ROOT: undefined }, () => {
            expect(() => assertMediaRootConfigured(), nodeEnv).not.toThrow();
          });
        }
      });

      /**
       * `next build` reads and writes no media and runs with `NODE_ENV=production`, so without this
       * exemption the build itself would demand the variable and the app would be unbuildable without
       * one. Story 8.3's Debug Log relied on the build succeeding for exactly this reason.
       */
      it("exempts the production build phase", () => {
        withEnv(
          { NEXT_PHASE: "phase-production-build", NODE_ENV: "production", MEDIA_STORAGE_ROOT: undefined },
          () => {
            expect(() => assertMediaRootConfigured()).not.toThrow();
          },
        );
      });

      it("surfaces a relative or public-tree root at boot rather than on a request", () => {
        withEnv({ MEDIA_STORAGE_ROOT: "relative/media" }, () => {
          expect(() => assertMediaRootConfigured()).toThrow(/must be an absolute path/);
        });
        withEnv({ MEDIA_STORAGE_ROOT: path.join(realPublicDir, "media") }, () => {
          expect(() => assertMediaRootConfigured()).toThrow(/must not be inside/);
        });
      });

      /**
       * The condition that silently undoes the entire story: if `public/uploads/` reappears - a
       * rollback, a restore from an old backup, a half-finished migration - Next serves every file
       * under it statically again while the authorising route keeps working perfectly and the suite
       * stays green. Nothing else in the system would notice, which is why boot refuses.
       */
      it("refuses to start when public/uploads has reappeared", () => {
        const servedUploads = path.join(realPublicDir, "uploads");
        expect(fs.existsSync(servedUploads)).toBe(false);
        fs.mkdirSync(servedUploads, { recursive: true });
        try {
          expect(() => assertMediaRootConfigured()).toThrow(/exists and Next serves it statically/);
        } finally {
          fs.rmSync(servedUploads, { recursive: true, force: true });
        }
        // Restored, so the sibling absence assertion below is not affected by this one.
        expect(fs.existsSync(servedUploads)).toBe(false);
      });
    });
  });

  /**
   * A file left behind in `public/uploads/` stays publicly readable no matter what the code above
   * does, so AC1 asks for its absence directly.
   *
   * **This assertion is vacuous in CI.** `.gitignore` never tracked `public/uploads/`, so the
   * directory does not exist on a fresh checkout and this passes without proving anything. Its
   * audience is the developer's machine and the server, where the 458 MB of real media actually
   * lived - which is why it ships alongside the default-root case above rather than instead of it.
   */
  it("has no leftover public/uploads directory", () => {
    expect(fs.existsSync(path.join(realPublicDir, "uploads"))).toBe(false);
  });

  it("honours MEDIA_STORAGE_ROOT and keeps the stored URL layout intact beneath it", () => {
    const root = getMediaRoot();
    expect(root).toBe(process.env.MEDIA_STORAGE_ROOT);

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

  /**
   * The first of the serve route's three containment layers, asserted here because through the HTTP
   * surface it is invisible: every input it refuses is *also* refused by the lexical and `realpath`
   * layers behind it, with the same 404, so an end-to-end test cannot tell which layer acted.
   * Verified by deleting the guard from the route - `test/uploadsServeRoute.test.ts` stayed entirely
   * green, which is exactly how a mandatory layer gets refactored away by accident.
   *
   * What it buys is that a hostile segment never reaches `path.resolve` or `fs` in the first place.
   * A `\0` in particular otherwise arrives at `fs.realpath`, which throws, and the route's `catch`
   * turns that into the same 404 - correct by accident rather than by design.
   */
  describe("isSafeMediaSegment", () => {
    it("accepts the segment shapes real stored URLs are made of", () => {
      for (const segment of [
        "trips",
        "cmf1x2y3z0000abcd",
        "days",
        "hero.png",
        "day.jpg",
        "img-1764512345678-a1b2c3d4.webp",
        "accommodations",
        "day-plan-items",
        // Legal in a filename and legal here: only separators, dot-segments and NUL are refused.
        "a file with spaces.png",
        "ümlaut.png",
        "..hidden.png",
      ]) {
        expect(isSafeMediaSegment(segment), segment).toBe(true);
      }
    });

    it("refuses every spelling that is not a single path component", () => {
      for (const segment of [
        // Empty, which `path.join` silently swallows.
        "",
        ".",
        "..",
        // Next delivers catch-all segments URL-decoded, so `%2F` and `%5C` arrive like this - a
        // separator living *inside* one array element.
        "../escaped.png",
        "..\\escaped.png",
        "nested/file.png",
        "/etc/hosts",
        "C:\\Windows\\win.ini",
        // `fs` throws on a NUL rather than refusing cleanly, so it must not get that far.
        "hero.png\0.txt",
        "\0",
      ]) {
        expect(isSafeMediaSegment(segment), JSON.stringify(segment)).toBe(false);
      }
    });
  });

  it("maps a stored URL back onto the configured root", () => {
    const root = getMediaRoot();
    const expected = path.join(root, "uploads", "trips", "trip-1", "hero.png");

    // The leading slash must not make `path.join` discard the root - that would send unlink() at the
    // filesystem root instead of the configured one.
    expect(resolveStoredMediaPath("/uploads/trips/trip-1/hero.png")).toBe(expected);
    expect(resolveStoredMediaPath("uploads/trips/trip-1/hero.png")).toBe(expected);
  });
});
