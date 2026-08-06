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

/** The five spellings `SUPPORTED_DOCUMENT_EXTENSIONS` admits, as a type the compiler can switch on. */
export type DocumentUrlExtension = "pdf" | "jpg" | "jpeg" | "png" | "webp";

/**
 * The stored `documentUrl`'s final extension, lowercased, or `null` when it is not one of the five the
 * upload routes produce.
 *
 * **This, and never `fileName`, is what decides whether a document is a PDF or an image** (Story 9.2).
 * The two columns have completely different provenance: the on-disk name - and therefore the URL - is
 * generated server-side as `doc-<ts>-<rand>.<ext>` with `<ext>` chosen by the upload route from its own
 * `ALLOWED_TYPES`, while `fileName` is whatever the client sent, sanitised for rendering and nothing
 * more. So `fileName` may legitimately end in `.pdf` for a file the route stored as a `.jpg`, and both
 * halves of Story 9.2 would then disagree with each other and with the bytes: the print sheet would
 * list a JPEG in its "not included" PDF appendix, and the packet would hand `PDFDocument.load` a JPEG.
 *
 * No query string is stripped, deliberately: the column never carries one, and `resolveStoredMediaPath`
 * makes exactly the same assumption when it maps the URL back onto a file. Tolerating one here and not
 * there would move the failure rather than remove it.
 *
 * Anything unrecognised is `null` rather than a guess. For the packet that is the right answer already -
 * a format it cannot embed degrades to a label page - and for the print sheet it means the document is
 * neither paged nor listed, which is the same treatment an unreadable file gets.
 */
export const documentUrlExtension = (documentUrl: string): DocumentUrlExtension | null => {
  // No `typeof documentUrl !== "string"` guard: the parameter is typed, both callers pass a non-null
  // Prisma column, and this file's own reasoning about `readJpegOrientation`'s EOI branch is that
  // defensive code no fixture can make fail does not belong in the tree. The same rule applies here.
  //
  // The last path segment first, so a dot in a directory name cannot be mistaken for the extension.
  const lastSlash = documentUrl.lastIndexOf("/");
  const fileSegment = lastSlash >= 0 ? documentUrl.slice(lastSlash + 1) : documentUrl;
  // `> 0`, matching `documentDisplayName`: a leading dot with nothing before it is the whole name.
  const lastDot = fileSegment.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const extension = fileSegment.slice(lastDot + 1).toLowerCase();
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(extension) ? (extension as DocumentUrlExtension) : null;
};

/**
 * Whether a stored document URL names a PDF. The single discriminator both halves of Story 9.2 use -
 * see `documentUrlExtension` for why it is the URL and not the file name.
 */
export const isPdfDocumentUrl = (documentUrl: string) => documentUrlExtension(documentUrl) === "pdf";

/**
 * How many documents one stay or activity may carry.
 *
 * It lives in this module rather than in either repository because both repositories and the client
 * need it, and the client cannot import a repository without dragging Prisma into the bundle - the
 * same reason `importLimits.ts` exists as a dependency-free module. **The cap is enforced in the
 * repository create**, not only in the dialog: a cap the client alone enforces is not a cap, and the
 * image galleries have no count cap at all so there was no existing pattern to copy.
 *
 * **Raising it is safe; lowering it is not.** `documentsSchema` in `tripImportSchemas.ts` applies it as
 * a `.max()` on the manifest, so a lower value refuses every backup already written from an entry that
 * carries more than the new number - including backups this build produced. See that docblock.
 */
export const MAX_DOCUMENTS_PER_ENTRY = 10;

/**
 * The exact `error.message` both document upload routes answer a cap refusal with, and the value both
 * dialogs match on to choose `trips.documents.limitReached` over the generic upload error.
 *
 * It is a shared constant rather than a literal repeated four times because the code alone cannot
 * carry the distinction: the routes answer `validation_error` for a rejected type, an oversized file,
 * an unusable name *and* the cap, so the message is the only discriminator, and "up to 10 per entry"
 * is the one of the four the user can act on. Spelled out on both sides, a reword on the route side
 * would silently downgrade that to "please try again" — an instruction to retry a condition retrying
 * cannot fix — and nothing would fail. Here, the two sides cannot drift.
 */
export const DOCUMENT_LIMIT_ERROR_MESSAGE = "Document limit reached";

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
