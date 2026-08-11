import fs from "node:fs/promises";
import path from "node:path";
import {
  isExternalMediaUrl,
  mediaPathIsDirectlyIn,
  mediaPathsNameSameFile,
  resolveStoredMediaPath,
} from "@/lib/trips/uploadPaths";

/**
 * Removes the one file a stored media URL names, and never anything else.
 *
 * **One file, never a tree (Story 8.4 / DW-194).** Media directories are shared: `days/<dayId>/` is
 * the parent of every stay and activity photo and every document on that day (`uploadPaths.ts`), and
 * an entry's image directory is the parent of its `documents/`. So a cleanup whose job is one file has
 * exactly one safe instrument, `unlink`. "Remove the directory, but only when it is empty" is not an
 * alternative: emptiness is a race, and the directory is legitimately non-empty whenever the entry has
 * any other medium.
 *
 * **`allowedDir` is a containment check, not a prefix test, and that distinction is the whole of AC8.**
 * The first attempt at this story guarded the unlink with
 * `storedUrl.startsWith("/uploads/trips/<tripId>/days/<dayId>/")`, and a string prefix is not
 * containment. Two ways through it were confirmed by execution:
 *
 * - `dayImageUpdateSchema` accepts *any* string beginning `/uploads/` with no traversal check, so a
 *   writer can store `…/days/<dayId>/../../../../../victim.txt`. That satisfies the prefix, and
 *   `resolveStoredMediaPath` + `path.join` then normalise it to `<mediaRoot>/victim.txt` - an
 *   arbitrary-file-unlink primitive that did not exist before the fix.
 * - Stay and activity media live *under* `days/<dayId>/` by construction, so
 *   `…/days/<dayId>/accommodations/<a>/img-stay.webp` satisfies the day prefix too and unlinks a stay
 *   photo whose row survives - DW-194's own symptom, re-entered one file at a time.
 *
 * Hence the rule below: the resolved file's **parent directory must be exactly** the directory the
 * caller owns, where that directory is built from ids by `uploadPaths.ts` and never from a URL. One
 * condition closes both holes - a `..` sequence normalises to a different parent, and a nested file
 * has a deeper one - and it is uniform, because every caller knows precisely which directory its file
 * belongs in. A URL outside that directory belongs to something else (an external `https://` cover
 * image, a foreign `/uploads/trips/<other>/…` left by a v1 import) and is left alone.
 *
 * **A refusal is logged, because it is not a success.** The containment branch produces exactly the
 * outcome an `EACCES` does - row committed, bytes left on disk with nothing naming them - so it cannot be
 * the one silent path. Iteration 2 of this story returned quietly there, and that is how AC9's orphans
 * left no trace anywhere: not in the logs, not in a test, not in 2246 green assertions. The refusal is
 * either a hostile URL, which is worth seeing, or a directory the caller composed wrongly, which is worth
 * seeing more.
 *
 * No `realpath` layer, and that is a **bounded decision rather than a proof of safety**. `fs.unlink` on a
 * symlink removes the link and never its target, so the *final* component cannot escape - but
 * `path.dirname(...) === path.resolve(allowedDir)` is lexical, so a symlinked **intermediate** directory
 * would satisfy it while the unlink lands outside the tree. Nothing in the application creates symlinks
 * under the media root, so that is an accepted residual risk here, not a closed hole. (`resolveOwnedMediaPath`
 * and the serve route do realpath, and must: they read *through* the link.)
 *
 * **It never throws (Story 8.4 / DW-195).** Every call site runs *after* the row delete or update has
 * committed, so the change the response reports has already happened; turning a subsequent `EACCES`
 * into a 500 told the user "removal failed" about a row that was already gone, and sent them back to
 * retry an operation that could only 404. The failure is logged rather than swallowed, because the
 * orphaned bytes are then the only remaining record that anything went wrong - AC4 says log, not
 * ignore. `ENOENT` is not a failure at all: an already-absent file is the desired end state.
 */
export const removeManagedMediaFile = async ({
  storedUrl,
  allowedDir,
  context,
}: {
  storedUrl: string;
  /**
   * Absolute directory the file must sit directly in, from an `uploadPaths.ts` helper built out of the
   * ids the caller already has. Never a URL and never a prefix - see the note above.
   */
  allowedDir: string;
  /** Prefixed to the log line so a stray orphan can be traced back to the route that left it. */
  context: string;
}) => {
  // The one silent exit this design permits, and it is deliberately the *narrow* question: a value that
  // names no file on this disk at all - an external `https://…` cover image, or an empty string. Only the
  // day-image route can actually reach it; the four media routes store nothing but server-composed
  // `/uploads/…` paths.
  //
  // **Not "does this look like ours?"** Four iterations gated here on a string-shape test for our own
  // media, and each spelling the test failed to recognise - `//uploads/…`, `uploads/…`, `/Uploads/…`,
  // `/x/../uploads/…` - took this exit **silently** for a real file *inside* `allowedDir`, leaving bytes
  // behind with no row naming them and nothing in the log. "Is it external?" is closed and decidable (see
  // `isExternalMediaUrl`); everything else is path-shaped and goes on to the containment check below,
  // which fails closed and logs when it refuses.
  if (!storedUrl || isExternalMediaUrl(storedUrl)) {
    return;
  }

  const filePath = path.resolve(resolveStoredMediaPath(storedUrl));
  const resolvedAllowedDir = path.resolve(allowedDir);
  // Through `mediaPathIsDirectlyIn` rather than a bare `!==`, so this asks the filesystem's own question
  // about case and cannot drift from the other two comparators - see `mediaPathKey`'s note.
  if (!mediaPathIsDirectlyIn(filePath, resolvedAllowedDir)) {
    // Logged, not silent: this branch orphans bytes exactly as the `EACCES` below does, and a refusal is
    // the only signal that either a stored URL is hostile or a caller built the wrong directory.
    console.error(`${context}: refusing to remove media file outside its own directory`, {
      storedUrl,
      filePath,
      allowedDir: resolvedAllowedDir,
    });
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      return;
    }
    // The error object itself, not only its `code`: this line is the sole surviving record of the
    // orphan, so throwing away everything but two fields of it would leave nothing to diagnose from.
    console.error(`${context}: unable to remove media file`, { filePath, code, error });
  }
};

/**
 * Whether two stored URLs name the same file on disk (Story 8.4).
 *
 * For the day-image cleanup's trigger, which fires on "the stored URL changed". Compared as strings, two
 * spellings of one path read as two files and the cleanup unlinks the file the row still points at:
 * `/uploads//trips/<t>/days/<d>/day.webp` and `/uploads/trips/<t>/days/<d>/day.webp` are one file, and the
 * first is a value a client can send (`dayImageUpdateSchema` only requires the `/uploads/` prefix).
 *
 * Values that name no file here - `null`, an external `https://…` cover image - are never "the same file"
 * as anything, including each other: the caller's question is whether the *previous* file still has a
 * reason to exist, and two different external URLs share no file to keep. That gate is `isExternalMediaUrl`
 * for the same reason the one in `removeManagedMediaFile` is - a shape test for "ours" answers "not the
 * same file" for two spellings of one path, and this answer decides whether the cleanup fires at all.
 *
 * **Through `mediaPathsNameSameFile`, not a bare `===` (iteration 5).** A raw string comparison of the two
 * resolved paths disagreed with the comparator that then decides whether the unlink is permitted:
 * `mediaPathIsDirectlyIn` folds case, this did not. So a previous URL of `/Uploads/trips/<t>/days/<d>/day.webp`
 * and a new one of `/uploads/trips/<t>/days/<d>/day.webp` read as *two* files here - firing the cleanup - and
 * as one directory there - permitting it - which deleted the file the row had just been pointed at (confirmed
 * by execution). Both questions have to be asked of the filesystem the same way or the pair is a deletion.
 */
export const storedMediaUrlsNameSameFile = (a: string | null, b: string | null) => {
  if (!a || !b) return false;
  if (isExternalMediaUrl(a) || isExternalMediaUrl(b)) return false;
  return mediaPathsNameSameFile(resolveStoredMediaPath(a), resolveStoredMediaPath(b));
};
