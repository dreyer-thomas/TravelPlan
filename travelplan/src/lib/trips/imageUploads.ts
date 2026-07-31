/**
 * Shared `accept` filter for every image upload field in the app.
 *
 * Only registered MIME types belong here. An earlier version of the day-image field's filter also
 * carried `image/jpg` and `image/pjpeg`, neither of which is a registered type (`image/jpeg` is the
 * real one; `image/pjpeg` is a legacy IE progressive-JPEG alias). Browsers map these entries onto
 * the native file panel's allowed-type set, so a bogus entry can only ever narrow or confuse it.
 *
 * Note that `accept` is a picker filter, not validation: it is not enforced when a file is dropped
 * onto the input, so `isSupportedImageUpload` below is the client-side gate, and the upload routes
 * are the authoritative one.
 */
export const IMAGE_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";

/** MIME types the upload routes accept. Keep in sync with `ALLOWED_TYPES` in those routes. */
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Extensions the upload routes accept when a browser reports no or an unhelpful MIME type. */
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

/**
 * Mirrors the server's `resolveUploadExtension` check so an unsupported pick fails immediately with
 * a specific message, rather than round-tripping to a generic "please try again" error.
 */
export const isSupportedImageUpload = (file: { type?: string; name?: string }) => {
  if (SUPPORTED_IMAGE_MIME_TYPES.has((file.type ?? "").toLowerCase())) return true;
  const name = typeof file.name === "string" ? file.name : "";
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  return Boolean(extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension));
};

/**
 * Stamps a freshly uploaded image URL so the page fetches it as a resource it has never seen.
 *
 * The upload routes write to a stable filename (`hero.png`, and the day image likewise), so replacing
 * an image leaves its URL byte-identical. A browser reuses whatever it already holds for that exact
 * URL for the rest of the page's lifetime - including a fetch that previously 404'd, which is what a
 * trip whose stored hero file had gone missing would have - without revalidating. The replacement
 * therefore only appeared after a hard reload. Server-rendered URLs stay unstamped: `Cache-Control:
 * public, max-age=0` already forces a revalidation on the next navigation, and the ETag changes with
 * the file, so this is only needed at the moment of upload.
 *
 * The version is the trip's `updatedAt` from the upload response, matching how day images version
 * theirs. A caller with no version gets the URL back untouched rather than a stamp that cannot
 * distinguish one upload from the next.
 *
 * The timestamp is reduced to its alphanumerics rather than percent-encoded. The hero URL is escaped
 * again downstream by `toCssUrl`'s `encodeURI`, which would turn a `%3A` from the colons into `%253A`
 * and point the background at a path that does not exist. An alphanumeric token is a fixed point of
 * both escapers, and still changes on every write.
 */
export const withImageCacheBuster = (url: string, version: string | undefined) => {
  const token = (version ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${token}`;
};
