/**
 * Saving a `fetch`ed blob to disk under the name the server chose. Browser-only helpers, shared by the
 * trip backup export (`TripTimeline.tsx`) and the day document packet (`TripDayView.tsx`).
 *
 * **Why `src/lib/browser/` and not `src/lib/http/`.** Every module in `src/lib/http/` is server-side -
 * `multipartToDisk.ts` imports `node:fs` - so a client importing from that directory is one autocomplete
 * away from dragging `node:fs` into a bundle. These two touch `document` and `URL.createObjectURL` and
 * nothing else, which is a different place, so they get one.
 *
 * Extracted rather than copied: both call sites need the identical rule, and the second copy is where one
 * of them loses a fix.
 */

// A blob URL carries no name, so a download driven from one saves the archive under the object
// URL's uuid unless the name is set explicitly. The export route sends it in `content-disposition`
// (`attachment; filename="trip-<slug>-<date>.zip"`), so read it back from there rather than
// rebuilding the server's naming rule on the client and letting the two drift.
//
// Restored from the helper Story 7.8 deleted together with the old export button. The RFC 5987
// `filename*=UTF-8''…` branch is defensive only: neither route can currently emit it, because
// `toSafeSlug` reduces the trip name to `[a-z0-9-]` before it reaches the
// header, so even a non-ASCII name arrives as a plain `filename="…"`. It is kept because the
// branch is free and the day the route starts sending real names is not the day to discover the
// client mangles them - but do not read it as a path that runs today.
export const extractAttachmentFilename = (headerValue: string | null) => {
  if (!headerValue) return null;

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const simpleMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  return simpleMatch?.[1] ?? null;
};

// Saves a blob without navigating: a detached anchor is clicked and removed again, so the calling screen
// stays mounted and no tab opens - the trip overview for a backup archive, the day view for a document
// packet. The object URL is revoked on the next tick rather than
// immediately - Safari has historically cancelled a download whose URL was revoked inside the same
// task as the click.
export const triggerBlobDownload = (blob: Blob, filename: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);

  // `finally`, so a throw out of `click()` cannot strand the object URL. Nothing observed throws there,
  // but the thing being leaked is the whole payload - ~16 MB for a backup archive in verification, and a
  // document packet can be larger still - pinned for the lifetime of the tab, accumulating across retries.
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
};
