import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

/**
 * Streaming `multipart/form-data` reader that writes one named part straight to a file.
 *
 * Why this exists rather than `await request.formData()`: that call reads the entire body into
 * memory and builds a `File` out of it before the handler can look at so much as its size. For the
 * trip import that meant a 300 MB backup was two full copies resident before anything had been
 * validated, which is the coupling Story 2.34 removes. Here the framing is parsed as the bytes go
 * past and the file part never exists as a `Buffer` at all - it goes to the descriptor and is
 * forgotten.
 *
 * Why hand-rolled: no new runtime dependency. This codebase already writes its own ZIP writer
 * (`zipArchive.ts`) and its own ZIP reader (`zipReader.ts`) for exactly that reason, and RFC 7578
 * framing is a smaller problem than either.
 *
 * The parser is deliberately narrow. It supports what a browser's `FormData` and `undici` actually
 * emit - `\r\n` framing, a `content-disposition` header with `name` and optionally `filename`, one
 * file part and a handful of short text fields - and treats everything else as malformed rather than
 * guessing. It does *not* decode `content-transfer-encoding`, RFC 2231 continuations or nested
 * `multipart/mixed`; none of those has ever reached this app's one multipart endpoint.
 *
 * Four things bound what this will spend on an attacker-supplied body:
 *
 * - the file part is written out as it arrives, never accumulated, and stops the moment it passes
 *   `maxFileBytes` so a lying `content-length` cannot fill the disk;
 * - text fields are accumulated but capped individually, and the *number of parts opened* is capped
 *   too - they are `strategy` and `targetTripId`, which are a word each;
 * - the working buffer only ever holds the current field, the current header block (capped), or the
 *   `boundary.length + 3` bytes that a delimiter straddling two chunks could still be hiding in;
 * - every byte pulled off the stream counts against `maxTotalBytes`, including the ones that are
 *   discarded. That last one is about *bytes read* rather than about memory, and it was missing until
 *   2026-08-03: `maxFileBytes` bounds only the part named `filePartName`, so a part carrying any
 *   other `filename` was drained unbounded, and so were the preamble and the epilogue. The route's
 *   `content-length` pre-check is not a substitute - a `Transfer-Encoding: chunked` request simply
 *   omits the header - and since Story 2.34 took `/api/trips/import` out of the middleware matcher,
 *   Next's `proxyClientMaxBodySize` does not bound it either. Nothing else was left.
 */

/** Enough for `content-disposition` plus `content-type`; a header block larger than this is junk. */
const MAX_PART_HEADER_BYTES = 8 * 1024;

const DEFAULT_MAX_FIELD_BYTES = 4 * 1024;
const DEFAULT_MAX_FIELDS = 16;

/**
 * How far above `maxFileBytes` the whole-body ceiling sits by default.
 *
 * What a legitimate request spends on top of the file part is framing: two delimiters per part, a
 * `content-disposition` line each, and the two short text fields. That is a few hundred bytes for the
 * request this endpoint actually receives, so 256 KB is generous by three orders of magnitude while
 * still turning "unbounded" into a number.
 */
const DEFAULT_TOTAL_BYTES_SLACK = 256 * 1024;

const CR = 0x0d;
const LF = 0x0a;
const DASH = 0x2d;

export type MultipartToDiskResult =
  | {
      ok: true;
      /** Every non-file part, by name. The *first* part with a name wins, as `FormData.get` does. */
      fields: Map<string, string>;
      /** `false` when the body carried no part named `filePartName` with a filename. */
      hasFile: boolean;
      /** Bytes written to `filePath`. Zero when `hasFile` is false. */
      fileBytes: number;
    }
  | { ok: false; reason: "malformed" | "file_too_large" };

/**
 * The boundary from a `content-type` header, quoted or not.
 *
 * `undici` emits it unquoted, browsers emit it unquoted, and RFC 2045 allows it quoted - so both
 * forms have to work, and a `content-type` with no boundary at all is a malformed request rather
 * than a request with an empty boundary.
 */
const parseBoundary = (contentType: string): string | null => {
  const match = /;\s*boundary=(?:"([^"]*)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary ? boundary : null;
};

type PartHeaders = { name: string | null; filename: string | null };

const parsePartHeaders = (block: string): PartHeaders => {
  let name: string | null = null;
  let filename: string | null = null;

  for (const line of block.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== "content-disposition") continue;

    // Quoted values only. `FormData` always quotes both, and an unquoted name containing a `;` would
    // be ambiguous to split on anyway.
    name = /;\s*name="([^"]*)"/i.exec(line)?.[1] ?? null;
    filename = /;\s*filename="([^"]*)"/i.exec(line)?.[1] ?? null;
  }

  return { name, filename };
};

type PartTarget =
  /** The named file part, being written to disk. */
  | { kind: "file" }
  /** A short text part, accumulated in memory. */
  | { kind: "field"; name: string; chunks: Buffer[]; length: number }
  /** A part nothing asked for: consumed and dropped without ever being held. */
  | { kind: "skip" };

/**
 * Read `body`, write the part named `filePartName` to `filePath`, and return the rest.
 *
 * `filePath` is created only if the body actually carries that part, so a caller whose cleanup runs
 * `fs.rm(..., { force: true })` needs no special case for the missing-file rejection.
 *
 * Never throws for bad input: a body this cannot parse is `{ ok: false, reason: "malformed" }`, which
 * the import route answers with the `invalid_form_data` 400 it always did - and a body that *errors*
 * mid-flight is bad input too, because that is what a client walking away looks like. An I/O failure
 * writing the file is the one real fault here and it does propagate.
 */
export const readMultipartToDisk = async (params: {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  filePartName: string;
  filePath: string;
  maxFileBytes: number;
  maxFieldBytes?: number;
  maxFields?: number;
  /** Ceiling on every byte pulled off `body`, framing and discarded parts included. */
  maxTotalBytes?: number;
}): Promise<MultipartToDiskResult> => {
  const maxFieldBytes = params.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES;
  const maxFields = params.maxFields ?? DEFAULT_MAX_FIELDS;
  const maxTotalBytes = params.maxTotalBytes ?? params.maxFileBytes + DEFAULT_TOTAL_BYTES_SLACK;

  const boundary = parseBoundary(params.contentType);
  if (!boundary) {
    return { ok: false, reason: "malformed" };
  }

  // Every delimiter after the first is preceded by CRLF; the opening one is not. Seeding the buffer
  // with a CRLF makes the two cases identical and is the whole of the preamble handling.
  const delimiter = Buffer.from(`\r\n--${boundary}`, "latin1");
  let buffer = Buffer.from("\r\n", "latin1");

  const fields = new Map<string, string>();
  let target: PartTarget | null = null;
  let state: "preamble" | "afterDelimiter" | "headers" | "body" | "epilogue" = "preamble";
  let fileHandle: FileHandle | null = null;
  let fileBytes = 0;
  let totalBytes = 0;
  let partsOpened = 0;
  let hasFile = false;
  let sawClosingDelimiter = false;
  let streamDrained = false;
  let failure: MultipartToDiskResult | null = null;

  const reader = params.body.getReader();

  const writeFileChunk = async (chunk: Buffer) => {
    if (chunk.length === 0) return true;
    if (fileBytes + chunk.length > params.maxFileBytes) {
      // Stop at the ceiling rather than writing the overshoot: the request is already refused, and
      // the point of streaming to disk is not to trade a memory ceiling for a disk one.
      failure = { ok: false, reason: "file_too_large" };
      return false;
    }
    // `FileHandle.write` resolves with how much it actually wrote and is not obliged to take the
    // whole buffer. Ignoring that leaves a silently truncated archive on disk and reports a perfectly
    // good backup as corrupt, so the short write is looped rather than assumed away. A write that
    // takes nothing is not progress and is an I/O fault - it throws, and the route answers 500.
    let written = 0;
    while (written < chunk.length) {
      const { bytesWritten } = await fileHandle!.write(chunk, written, chunk.length - written);
      if (bytesWritten <= 0) {
        throw new Error("multipart_write_stalled");
      }
      written += bytesWritten;
    }
    fileBytes += chunk.length;
    return true;
  };

  /** Feed the current part's bytes to wherever they belong. Returns false to abandon the read. */
  const consumePartBytes = async (chunk: Buffer) => {
    if (!target || chunk.length === 0) return true;
    if (target.kind === "skip") return true;
    if (target.kind === "file") return writeFileChunk(chunk);

    if (target.length + chunk.length > maxFieldBytes) {
      // `strategy` and `targetTripId` are one short word each. Anything longer is not a form field
      // this endpoint has, and buffering it would be the memory leak this module exists to avoid.
      failure = { ok: false, reason: "malformed" };
      return false;
    }
    target.chunks.push(chunk);
    target.length += chunk.length;
    return true;
  };

  const finishPart = () => {
    if (target?.kind === "field" && !fields.has(target.name)) {
      // First wins, because `formData.get("strategy")` - the call this reader replaced - returns the
      // first value for a repeated name. `strategy` chooses between creating a new trip and
      // *overwriting* an existing one, so which duplicate is honoured is not a detail worth changing
      // on the way to a streaming parser.
      fields.set(target.name, Buffer.concat(target.chunks).toString("utf8"));
    }
    target = null;
  };

  try {
    let done = false;
    while (!done) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        // A request body that errors mid-flight - the client went away, the proxy cut it - is a bad
        // request and not a server fault. `await request.formData()`, the call this reader replaced,
        // rejected on exactly this input and the route answered `invalid_form_data` 400; letting the
        // rejection out of here instead reached the handler's outer catch and turned every dropped
        // upload into a `server_error` 500. A write fault still propagates, which is the difference
        // this catch is drawn around: that one is ours, this one is the caller's.
        failure = { ok: false, reason: "malformed" };
        break;
      }
      done = next.done;
      if (done) {
        streamDrained = true;
      }
      if (next.value) {
        totalBytes += next.value.byteLength;
        if (totalBytes > maxTotalBytes) {
          // Counted on the way in, before the bytes are classified: a part this reader intends to
          // discard costs exactly as much to read as one it keeps, and the epilogue costs the same
          // again. `file_too_large` rather than `malformed` because oversize is what it is, and the
          // route has a message for that which does not send the user off to inspect a sound backup.
          failure = { ok: false, reason: "file_too_large" };
          break;
        }
        buffer = buffer.length === 0 ? Buffer.from(next.value) : Buffer.concat([buffer, Buffer.from(next.value)]);
      }

      // Drain everything the buffer unambiguously contains, then wait for more bytes.
      let progressed = true;
      while (progressed && !failure) {
        progressed = false;

        if (state === "epilogue") {
          buffer = buffer.subarray(buffer.length);
          break;
        }

        if (state === "preamble" || state === "body") {
          const index = buffer.indexOf(delimiter);
          if (index >= 0) {
            if (state === "body" && !(await consumePartBytes(buffer.subarray(0, index)))) {
              break;
            }
            finishPart();
            buffer = buffer.subarray(index + delimiter.length);
            state = "afterDelimiter";
            progressed = true;
            continue;
          }

          // No delimiter yet: everything but a possible partial delimiter at the tail is safe to
          // emit. This is what makes a boundary split across two chunks work.
          const keep = Math.min(buffer.length, delimiter.length - 1);
          const flushable = buffer.subarray(0, buffer.length - keep);
          if (state === "body" && !(await consumePartBytes(flushable))) {
            break;
          }
          buffer = buffer.subarray(buffer.length - keep);
          continue;
        }

        if (state === "afterDelimiter") {
          if (buffer.length < 2) continue;
          if (buffer[0] === DASH && buffer[1] === DASH) {
            sawClosingDelimiter = true;
            state = "epilogue";
            buffer = buffer.subarray(2);
            progressed = true;
            continue;
          }
          if (buffer[0] === CR && buffer[1] === LF) {
            buffer = buffer.subarray(2);
            state = "headers";
            progressed = true;
            continue;
          }
          failure = { ok: false, reason: "malformed" };
          break;
        }

        // state === "headers"
        const headerEnd = buffer.indexOf("\r\n\r\n", 0, "latin1");
        // The cap has to be checked on both branches, not only while the terminator is still
        // missing. Applying it to `buffer.length` alone made it a function of how the body happened
        // to be chunked: a 60 KB header block delivered in one read arrived with its `\r\n\r\n`
        // already present, took the branch below, and was parsed and turned into a 60 KB string,
        // while the identical request split across two reads was refused.
        if ((headerEnd < 0 ? buffer.length : headerEnd) > MAX_PART_HEADER_BYTES) {
          failure = { ok: false, reason: "malformed" };
          break;
        }
        if (headerEnd < 0) {
          continue;
        }

        const headers = parsePartHeaders(buffer.subarray(0, headerEnd).toString("latin1"));
        buffer = buffer.subarray(headerEnd + 4);
        if (!headers.name) {
          failure = { ok: false, reason: "malformed" };
          break;
        }

        // A part is *the* file only if it names a filename, which is what makes `formData.get("file")`
        // return a `File` rather than a string. A second one is dropped, mirroring `FormData.get`
        // handing back the first.
        // Parts *opened*, not distinct names: same-named parts overwrite each other in `fields`, so
        // counting the map let a hundred parts all called `strategy` walk past a cap of three. Each
        // one still costs a header block and a pass through the parser, which is what the cap is for.
        partsOpened += 1;
        if (partsOpened > maxFields) {
          failure = { ok: false, reason: "malformed" };
          break;
        }

        if (headers.name === params.filePartName && headers.filename !== null && !hasFile) {
          hasFile = true;
          // `0o600` explicitly rather than whatever `0666 & ~umask` produces - which is `0644` on
          // both machines this runs on. The file is the user's entire trip backup, photos included,
          // and it sits in `os.tmpdir()`, which on the Linux host is a `/tmp` shared with every other
          // local account and with a second instance of this app. World-readable is the wrong default
          // to inherit for a file like that, and the umask is not ours to rely on.
          //
          // `"wx"` and not `"w"`, for the same threat model rather than a different one: `"w"` is
          // `O_CREAT|O_TRUNC` without `O_EXCL`, so it follows a symlink and it *ignores the mode
          // argument when the file already exists*. Against a shared `/tmp` that makes the `0o600`
          // above conditional on the path being fresh. `O_EXCL` refuses to reuse anything already
          // sitting there, and the caller's name carries a UUID, so a genuine collision is a fault
          // worth failing on rather than a case worth handling.
          fileHandle = await fs.open(params.filePath, "wx", 0o600);
          target = { kind: "file" };
        } else if (headers.filename !== null) {
          target = { kind: "skip" };
        } else {
          target = { kind: "field", name: headers.name, chunks: [], length: 0 };
        }

        state = "body";
        progressed = true;
      }

      if (failure) {
        break;
      }
    }

    if (failure) {
      return failure;
    }
    if (!sawClosingDelimiter) {
      // The body ended mid-part: `--boundary--` never arrived, so whatever was written is a fragment
      // of a file the client did not finish sending.
      return { ok: false, reason: "malformed" };
    }

    return { ok: true, fields, hasFile, fileBytes };
  } finally {
    // Every exit that did not read the body to completion cancels it, not just the ones this function
    // decided on: a `file_too_large`, a malformed body, and equally a throw out of `fileHandle.write`,
    // which used to close the descriptor and leave the request stream open behind it. The cancel is
    // best-effort - a stream that is already errored or locked rejects, and there is nothing left to
    // do about it at this point.
    if (!streamDrained) {
      await reader.cancel().catch(() => undefined);
    }
    await fileHandle?.close().catch(() => undefined);
  }
};
