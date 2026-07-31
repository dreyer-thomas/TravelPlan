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
