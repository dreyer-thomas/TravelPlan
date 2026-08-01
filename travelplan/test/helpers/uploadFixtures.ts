import fs from "node:fs/promises";
import path from "node:path";

/**
 * Fixture writer for export photos. Paths must come from the upload helpers, never from
 * `process.cwd() + "/public"` - `test/setup.ts` redirects `UPLOADS_PUBLIC_ROOT` to a per-worker temp
 * directory and the helpers are the only thing that honours it. See the header comment in
 * `src/lib/trips/uploadPaths.ts` for what happened the last time suites rolled their own paths.
 *
 * Shared rather than copied per suite: when the way a fixture is laid down changes, one edit has to
 * reach every suite that writes one, or the suites quietly disagree about the upload contract.
 *
 * `contents` accepts a `Buffer` as well as a string so a suite can lay down real image-shaped bytes
 * - nulls, high bytes, a length that is not trivially small. CRC-32 and the size fields are the two
 * things most likely to be wrong for binary input, and an all-ASCII fixture never exercises them.
 */
export const writeUploadFile = async (dir: string, fileName: string, contents: string | Buffer) => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, fileName),
    typeof contents === "string" ? Buffer.from(contents, "utf8") : contents,
  );
};
