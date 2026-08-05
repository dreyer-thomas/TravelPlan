import fs from "node:fs";
import path from "node:path";
import { getMediaRoot } from "./uploadPaths";

/**
 * The startup validation for the media root. **Node runtime only.**
 *
 * This lives apart from `uploadPaths.ts` for one concrete reason, learned the hard way: it needs
 * `node:fs`, and `uploadPaths.ts` is reachable from the edge runtime. Adding a top-level
 * `import fs from "node:fs"` there put `node:fs` into the edge bundle, and every request matched by
 * `middleware.ts` answered 500 with `Native module not found: node:fs` - the app's own home page
 * among them. Keeping the `fs` dependency in a module that only `instrumentation.ts` imports, behind a
 * `NEXT_RUNTIME` check, is what stops that recurring. Do not import this from anything else.
 *
 * **Why a boot check and not only the per-call throw in `getMediaRoot`.** `getMediaRoot` is read per
 * call, deliberately, and every one of its callers sits inside a request handler - so on its own it
 * lets a misconfigured server boot, bind its port and pass a health check, and the first sign of
 * trouble is a 500 on somebody's thumbnail with the explanation buried in a log. Media configuration
 * is knowable at startup, so it is checked at startup and a bad deploy fails while an operator is
 * still watching.
 *
 * `NODE_ENV` is an allow-list here rather than the deny-one comparison `getMediaRoot` uses. This runs
 * only inside the Next server, where an unset or unexpected `NODE_ENV` ("staging", "prod") is no
 * reason to accept a media root inside the application tree - whereas `getMediaRoot` is also reached
 * by one-off scripts, which must keep working on the default.
 */
export const assertMediaRootConfigured = () => {
  // `next build` legitimately has no media root to speak of - it writes no uploads and reads none -
  // and runs with `NODE_ENV=production`, so without this the build itself would demand the variable.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const nodeEnv = process.env.NODE_ENV;
  const isDevOrTest = nodeEnv === "development" || nodeEnv === "test";
  if (!isDevOrTest && !process.env.MEDIA_STORAGE_ROOT?.trim()) {
    throw new Error(
      "MEDIA_STORAGE_ROOT must be set when starting the server. Unset, uploaded media resolves " +
        "inside the application tree, where a redeploy silently empties it. Point it at an absolute " +
        "path outside the application tree that the service user can read and write - see " +
        "docs/deployment-configuration.md.",
    );
  }

  // Surfaces the absolute-path and not-inside-`public/` checks at boot instead of on a request.
  const mediaRoot = getMediaRoot();

  // The one condition that silently undoes this module's whole purpose. `public/uploads/` is served
  // statically by Next, ahead of any route handler and without a session check, so if it exists - a
  // rollback, a restore from an old backup, a half-finished migration - every file under it is
  // published again while the authorising route continues to work perfectly and the test suite stays
  // green, because that assertion is vacuous anywhere the directory was never checked in.
  const servedUploads = path.join(process.cwd(), "public", "uploads");
  if (fs.existsSync(servedUploads)) {
    throw new Error(
      `${servedUploads} exists and Next serves it statically, ahead of the authorising route and ` +
        "without a session check - so every file under it is readable by anyone who learns the URL. " +
        `Move its contents into ${path.join(mediaRoot, "uploads")} and remove it before starting - ` +
        "see the one-time migration in docs/deployment-configuration.md.",
    );
  }
};
