/**
 * Shared `accept` filter, client-side gate and name handling for every document upload field in the
 * app (Story 9.1). The sibling of `imageUploads.ts`, deliberately not an extension of it.
 *
 * Only registered MIME types belong here, for the reason `imageUploads.ts` records: browsers map the
 * `accept` list onto the native file panel's allowed-type set, so a bogus entry can only ever narrow
 * or confuse it - and it does so inside the OS dialog, where no unit test and no error message can
 * reach. `application/pdf` is the registered type for a PDF; `application/x-pdf` and `text/pdf` are
 * not, and neither is any of the `image/jpg` family the day-image field once carried.
 *
 * The image types are here as well as in `IMAGE_UPLOAD_ACCEPT` on purpose. A ticket screenshot is a
 * document, and which bucket a JPEG belongs in is the user's decision rather than something the app
 * infers from a MIME type. **The two filters stay separate**: it is what keeps a file placed in one
 * bucket out of the other, and widening the photo filter to admit a PDF is the single change that
 * would let a non-image be restored into a photo gallery.
 *
 * Note that `accept` is a picker filter, not validation: it is not enforced when a file is dropped
 * onto the input, so `isSupportedDocumentUpload` below is the client-side gate, and the two document
 * upload routes are the authoritative one.
 */
export const DOCUMENT_UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/** MIME types the document upload routes accept. Keep in sync with `ALLOWED_TYPES` in those routes. */
const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Extensions the document upload routes accept when a browser reports no or an unhelpful MIME type. */
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

/**
 * How many documents one stay or activity may carry.
 *
 * It lives in this module rather than in either repository because both repositories and the client
 * need it, and the client cannot import a repository without dragging Prisma into the bundle - the
 * same reason `importLimits.ts` exists as a dependency-free module. **The cap is enforced in the
 * repository create**, not only in the dialog: a cap the client alone enforces is not a cap, and the
 * image galleries have no count cap at all so there was no existing pattern to copy.
 */
export const MAX_DOCUMENTS_PER_ENTRY = 10;

/**
 * Mirrors the routes' `ALLOWED_TYPES` lookup so an unsupported pick fails immediately with a specific
 * message, rather than round-tripping to a generic "please try again" error.
 */
export const isSupportedDocumentUpload = (file: { type?: string; name?: string }) => {
  if (SUPPORTED_DOCUMENT_MIME_TYPES.has((file.type ?? "").toLowerCase())) return true;
  const name = typeof file.name === "string" ? file.name : "";
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  return Boolean(extension && SUPPORTED_DOCUMENT_EXTENSIONS.has(extension));
};

/**
 * The chip's label: the stored file name minus its **final** extension, and nothing else.
 *
 * Only the last one, so `Ticket Rom.v2.pdf` reads as `Ticket Rom.v2` rather than losing half its
 * name - the dots in the middle are part of what the user called it. A name with no extension
 * (`README`) is returned untouched, and so is a dotfile (`.gitignore`): a leading dot with nothing
 * after it is the whole name, not an empty name with an extension, and stripping it would leave a
 * chip labelled with nothing at all.
 *
 * One definition, used by the dialog field and by the timeline chip, so the two cannot disagree about
 * what a document is called.
 */
export const documentDisplayName = (fileName: string) => {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
};

/** Cap on the stored name. Long enough for any real file name, short enough to render and to index. */
const MAX_DOCUMENT_FILE_NAME_LENGTH = 255;

/**
 * Turns a client-supplied `file.name` into the value stored in the `file_name` column, or `null` when
 * there is nothing usable left of it.
 *
 * **It never produces a path segment.** The on-disk name is generated server-side
 * (`doc-<ts>-<rand>.<ext>`) and this value is a column entry only - but it is rendered in the UI and
 * Story 9.2 will print it onto PDF pages, so it is sanitised at every entry point rather than at the
 * one that happens to write a file today. Exported so the upload routes and the backup importer share
 * one definition: two copies of a sanitiser is how one of them loses a rule.
 *
 * The basename is taken first, which disposes of `../../etc/passwd` (`passwd`) and of a Windows
 * `C:\Users\x\ticket.pdf` (`ticket.pdf`) in the same step, and leaves nothing behind that a later
 * check has to reason about as a path. What is left is then judged as text: empty after trimming is
 * unusable, a bare `.` or `..` is a directory reference rather than a name, and a control character
 * has no business in something that will be rendered and printed.
 */
export const sanitizeDocumentFileName = (raw: string): string | null => {
  if (typeof raw !== "string") return null;

  // Both separators, because the name comes from whichever OS the browser is running on and a
  // backslash is a separator on exactly one of them - so treating only `/` as one lets a Windows path
  // through whole.
  const lastSeparator = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  const baseName = (lastSeparator >= 0 ? raw.slice(lastSeparator + 1) : raw).trim();

  if (!baseName) return null;
  if (baseName === "." || baseName === "..") return null;
  if (/[\x00-\x1f\x7f]/.test(baseName)) return null;

  // Truncation rather than rejection: an over-long name is a real file the user picked, and a
  // shortened label is a better answer than a refused upload. Trimmed again because the cut can land
  // on a space, and re-checked because it can also leave `.` or `..` behind.
  //
  // The trailing lone surrogate goes too. `slice` counts UTF-16 code units, so a cut at 255 can land
  // *between* the two halves of an astral character - an emoji in a file name is enough - and what
  // survives is an unpaired high surrogate: it renders as U+FFFD in the chip, `JSON.stringify` writes
  // it into the backup as a bare `\udXXX` escape that no strict-UTF-8 reader will accept, and Story
  // 9.2 will print it onto a PDF page. Dropping the half character is the only repair available.
  const capped = baseName.length > MAX_DOCUMENT_FILE_NAME_LENGTH
    ? baseName
        .slice(0, MAX_DOCUMENT_FILE_NAME_LENGTH)
        .replace(/[\uD800-\uDBFF]$/, "")
        .trim()
    : baseName;
  if (!capped || capped === "." || capped === "..") return null;

  return capped;
};
