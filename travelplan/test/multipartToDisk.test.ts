import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMultipartToDisk } from "@/lib/http/multipartToDisk";

/**
 * The streaming multipart reader, without a route around it.
 *
 * Story 2.34 replaced `await request.formData()` on the import path, and `formData()` was the thing
 * that made the framing somebody else's problem. What it bought was a body that never exists as a
 * `Buffer`; what it costs is that every framing case now has to be proven here - a boundary split
 * across two chunks in particular, because that is the bug this class of parser always has and it
 * only appears when the chunking is unlucky.
 */

const BOUNDARY = "----travelplanTestBoundary";

const streamOf = (bytes: Buffer, chunkSize: number): ReadableStream<Uint8Array> => {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunkSize)));
      offset += chunkSize;
    },
  });
};

type BuildPart =
  | { name: string; value: string }
  | { name: string; filename: string; data: Buffer; contentType?: string };

const buildBody = (parts: BuildPart[], options: { boundary?: string; epilogue?: string } = {}) => {
  const boundary = options.boundary ?? BOUNDARY;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, "latin1"));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n\r\n`,
          "latin1",
        ),
      );
      chunks.push(part.data);
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`, "latin1"));
      chunks.push(Buffer.from(part.value, "utf8"));
    }
    chunks.push(Buffer.from("\r\n", "latin1"));
  }

  chunks.push(Buffer.from(`--${boundary}--`, "latin1"));
  if (options.epilogue) {
    chunks.push(Buffer.from(options.epilogue, "latin1"));
  }
  return Buffer.concat(chunks);
};

describe("readMultipartToDisk", () => {
  let directory: string | null = null;

  // A fresh name per call, because the reader opens with `O_EXCL` and refuses to write through
  // anything already at the path - which is the point of it, and mirrors the route, whose name
  // carries a pid and a UUID. A test that reuses one path is testing truncate-on-reopen instead.
  let uploads = 0;

  const tempPath = () => {
    directory ??= fs.mkdtempSync(path.join(os.tmpdir(), "travelplan-multipart-test-"));
    uploads += 1;
    return path.join(directory, `upload-${uploads}.bin`);
  };

  afterEach(() => {
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
      directory = null;
    }
  });

  const read = (
    body: Buffer,
    options: { chunkSize?: number; contentType?: string; maxFileBytes?: number; filePath?: string } = {},
  ) =>
    readMultipartToDisk({
      body: streamOf(body, options.chunkSize ?? 64 * 1024),
      contentType: options.contentType ?? `multipart/form-data; boundary=${BOUNDARY}`,
      filePartName: "file",
      filePath: options.filePath ?? tempPath(),
      maxFileBytes: options.maxFileBytes ?? 1024 * 1024,
    });

  it("writes the file part to disk and keeps the text fields in memory", async () => {
    const filePath = tempPath();
    const data = Buffer.from("PK pretend archive", "latin1");
    const result = await read(
      buildBody([
        { name: "strategy", value: "overwrite" },
        { name: "file", filename: "backup.zip", data },
        { name: "targetTripId", value: "trip-1" },
      ]),
      { filePath },
    );

    expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: data.length });
    expect(result.ok ? [...result.fields.entries()] : []).toEqual([
      ["strategy", "overwrite"],
      ["targetTripId", "trip-1"],
    ]);
    expect(fs.readFileSync(filePath)).toEqual(data);
  });

  it("finds a boundary that straddles a chunk boundary, at every possible split", async () => {
    // 64 KB of noise so the file part spans many chunks, and a range of chunk sizes so the delimiter
    // lands mid-chunk, on a chunk edge and split across two.
    const data = Buffer.alloc(64 * 1024, 0xa5);
    const body = buildBody([{ name: "file", filename: "backup.zip", data }]);

    for (const chunkSize of [1, 2, 3, 7, 13, 31, 1024, body.length - 1, body.length]) {
      // Its own path per iteration: the reader opens with `O_EXCL`, as the route's per-request name
      // lets it.
      const filePath = tempPath();
      const result = await read(body, { chunkSize, filePath });
      expect(result, `chunk size ${chunkSize}`).toMatchObject({ ok: true, hasFile: true });
      expect(fs.readFileSync(filePath), `chunk size ${chunkSize}`).toEqual(data);
    }
  });

  it("accepts a quoted boundary as well as a bare one", async () => {
    const result = await read(buildBody([{ name: "file", filename: "b.zip", data: Buffer.from("xy") }]), {
      contentType: `multipart/form-data; boundary="${BOUNDARY}"`,
    });

    expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: 2 });
  });

  it("reports a body with no file part rather than inventing an empty one", async () => {
    const filePath = tempPath();
    const result = await read(buildBody([{ name: "strategy", value: "createNew" }]), { filePath });

    expect(result).toMatchObject({ ok: true, hasFile: false, fileBytes: 0 });
    // Nothing is created for a request that carried nothing, so the caller's cleanup has no special
    // case to write.
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("stops at the byte cap instead of filling the disk", async () => {
    const filePath = tempPath();
    const result = await read(
      buildBody([{ name: "file", filename: "backup.zip", data: Buffer.alloc(4096, 1) }]),
      { maxFileBytes: 1024, chunkSize: 256, filePath },
    );

    expect(result).toEqual({ ok: false, reason: "file_too_large" });
    expect(fs.statSync(filePath).size).toBeLessThanOrEqual(1024);
  });

  it("rejects a text field longer than any field this endpoint has", async () => {
    const result = await readMultipartToDisk({
      body: streamOf(buildBody([{ name: "strategy", value: "x".repeat(64) }]), 512),
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      filePartName: "file",
      filePath: tempPath(),
      maxFileBytes: 1024,
      maxFieldBytes: 16,
    });

    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("ignores a trailing epilogue after the closing delimiter", async () => {
    const result = await read(
      buildBody([{ name: "file", filename: "b.zip", data: Buffer.from("payload") }], {
        epilogue: "\r\nthis is the epilogue and means nothing\r\n",
      }),
    );

    expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: 7 });
  });

  it("preserves CRLF inside a part's payload rather than treating it as framing", async () => {
    const filePath = tempPath();
    const data = Buffer.from("line one\r\nline two\r\n--not-the-boundary\r\n", "latin1");
    const result = await read(buildBody([{ name: "file", filename: "b.bin", data }]), { filePath });

    expect(result).toMatchObject({ ok: true, fileBytes: data.length });
    expect(fs.readFileSync(filePath)).toEqual(data);
  });

  it("treats a content-type with no boundary as malformed", async () => {
    expect(await read(buildBody([{ name: "strategy", value: "createNew" }]), {
      contentType: "multipart/form-data",
    })).toEqual({ ok: false, reason: "malformed" });
  });

  it("treats a body that never reaches its closing delimiter as malformed", async () => {
    const complete = buildBody([{ name: "file", filename: "b.zip", data: Buffer.alloc(512, 7) }]);

    expect(await read(complete.subarray(0, complete.length - 8))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("treats a body that is not multipart at all as malformed", async () => {
    expect(await read(Buffer.from("just some bytes", "utf8"))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("keeps only the first part named file, as FormData.get does", async () => {
    const filePath = tempPath();
    const result = await read(
      buildBody([
        { name: "file", filename: "first.zip", data: Buffer.from("first") },
        { name: "file", filename: "second.zip", data: Buffer.from("second-and-longer") },
      ]),
      { filePath },
    );

    expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: 5 });
    expect(fs.readFileSync(filePath).toString("utf8")).toBe("first");
  });

  it("keeps the first value for a repeated text field, as formData.get did", async () => {
    // `strategy` selects create-new versus *overwrite an existing trip*. The call this reader
    // replaced was `formData.get("strategy")`, which returns the first value for a repeated name, so
    // last-wins would have let a second part decide a destructive operation.
    const result = await read(
      buildBody([
        { name: "strategy", value: "createNew" },
        { name: "strategy", value: "overwrite" },
        { name: "file", filename: "b.zip", data: Buffer.from("x") },
      ]),
    );

    expect(result.ok ? result.fields.get("strategy") : null).toBe("createNew");
  });

  it("counts parts against the field cap, not distinct names", async () => {
    // Same name every time: `fields` never grows past one entry, so a cap counted off the map's size
    // let an arbitrary number of parts through - each one a header block and a pass through the
    // parser.
    const parts = Array.from({ length: 12 }, () => ({ name: "strategy", value: "createNew" }));

    expect(
      await readMultipartToDisk({
        body: streamOf(buildBody(parts), 512),
        contentType: `multipart/form-data; boundary=${BOUNDARY}`,
        filePartName: "file",
        filePath: tempPath(),
        maxFileBytes: 1024,
        maxFields: 3,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("caps the whole body, not just the part it is asked to keep", async () => {
    // A second part with a filename is dropped rather than written, and before this cap existed it
    // was drained with nothing bounding it at all - `maxFileBytes` only ever covered `file`.
    const result = await readMultipartToDisk({
      body: streamOf(
        buildBody([
          { name: "file", filename: "b.zip", data: Buffer.from("small") },
          { name: "decoy", filename: "decoy.bin", data: Buffer.alloc(64 * 1024, 0xa5) },
        ]),
        4096,
      ),
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      filePartName: "file",
      filePath: tempPath(),
      maxFileBytes: 1024,
      maxTotalBytes: 8 * 1024,
    });

    expect(result).toEqual({ ok: false, reason: "file_too_large" });
  });

  it("counts the epilogue against the body cap too", async () => {
    const result = await readMultipartToDisk({
      body: streamOf(
        buildBody([{ name: "file", filename: "b.zip", data: Buffer.from("small") }], {
          epilogue: "\r\n" + "e".repeat(32 * 1024),
        }),
        4096,
      ),
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      filePartName: "file",
      filePath: tempPath(),
      maxFileBytes: 1024,
      maxTotalBytes: 8 * 1024,
    });

    expect(result).toEqual({ ok: false, reason: "file_too_large" });
  });

  it("leaves the default body cap clear of a file part at exactly the file ceiling", async () => {
    // The default is `maxFileBytes` plus slack for framing, so the request this endpoint actually
    // receives - a file at the ceiling plus two short fields - must still pass.
    const data = Buffer.alloc(4096, 3);
    const result = await read(
      buildBody([
        { name: "strategy", value: "createNew" },
        { name: "file", filename: "backup.zip", data },
        { name: "targetTripId", value: "trip-1" },
      ]),
      { maxFileBytes: data.length },
    );

    expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: data.length });
  });

  it("refuses an oversized part header block however the body is chunked", async () => {
    // The cap used to be checked only while the terminating `\r\n\r\n` was still missing, which made
    // it a function of the client's chunking: a header block delivered whole arrived with its
    // terminator already present, skipped the check, and was parsed into a string of its full size.
    // The same request split across two reads was refused. Both spellings have to be refused.
    const body = Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\n`, "latin1"),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="b.zip"\r\n`, "latin1"),
      Buffer.from(`X-Padding: ${"p".repeat(64 * 1024)}\r\n\r\n`, "latin1"),
      Buffer.from("payload", "latin1"),
      Buffer.from(`\r\n--${BOUNDARY}--`, "latin1"),
    ]);

    for (const chunkSize of [body.length, 64 * 1024, 4096, 17]) {
      expect(await read(body, { chunkSize, filePath: tempPath() })).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("reports a body that errors mid-flight as a bad request, not as a server fault", async () => {
    // `await request.formData()` rejected when a client walked away and the route answered
    // `invalid_form_data` 400. Letting the rejection out of this reader instead reached the handler's
    // outer catch, which turned every dropped upload into a `server_error` 500.
    const head = buildBody([{ name: "file", filename: "b.zip", data: Buffer.alloc(4096, 7) }]).subarray(0, 2048);
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array(head));
          return;
        }
        controller.error(new Error("client went away"));
      },
    });

    const result = await readMultipartToDisk({
      body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      filePartName: "file",
      filePath: tempPath(),
      maxFileBytes: 1024 * 1024,
    });

    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to write through something already sitting at the upload path", async () => {
    // `"w"` is `O_CREAT|O_TRUNC` without `O_EXCL`: it follows a symlink and it *ignores the mode
    // argument when the file already exists*, so the `0o600` below would have been conditional on the
    // path being fresh - in a `/tmp` shared with other local accounts. `"wx"` refuses instead, and the
    // caller's name carries a UUID, so this is a fault rather than a case to handle.
    const filePath = tempPath();
    fs.writeFileSync(filePath, "planted", { mode: 0o666 });

    await expect(
      read(buildBody([{ name: "file", filename: "b.zip", data: Buffer.from("secret") }]), { filePath }),
    ).rejects.toThrow(/EEXIST/);
    expect(fs.readFileSync(filePath, "utf8")).toBe("planted");
  });

  it("creates the upload file readable only by this process's user", async () => {
    // The temp file holds the user's whole trip backup and lands in a shared `/tmp`, so the mode is
    // passed explicitly rather than inherited from whatever the umask happens to be - which is 0644
    // on both machines this runs on.
    const filePath = tempPath();
    await read(buildBody([{ name: "file", filename: "b.zip", data: Buffer.from("secret") }]), { filePath });

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("writes every byte of a chunk even when the descriptor takes them a few at a time", async () => {
    // `FileHandle.write` may return a short count. A parser that trusts it leaves a truncated archive
    // on disk and the request is reported as a corrupt backup for a file that was fine.
    const filePath = tempPath();
    const realOpen = fs.promises.open;
    const data = Buffer.alloc(8192, 0x42);
    const openSpy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof realOpen>));
      const realWrite = handle.write.bind(handle);
      // Never takes more than seven bytes at a time - legal, and what a slow device looks like.
      handle.write = ((buffer: Buffer, offset: number, length: number) =>
        realWrite(buffer, offset, Math.min(length, 7))) as typeof handle.write;
      return handle;
    });

    try {
      const result = await read(buildBody([{ name: "file", filename: "b.zip", data }]), {
        filePath,
        chunkSize: 4096,
      });

      expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: data.length });
      expect(fs.readFileSync(filePath)).toEqual(data);
    } finally {
      openSpy.mockRestore();
    }
  });

  it("cancels the request body when writing the file throws", async () => {
    // The failure branch always cancelled; a throw out of `write` went straight to the `finally`,
    // closed the descriptor and left the body stream open behind it.
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          new Uint8Array(buildBody([{ name: "file", filename: "b.zip", data: Buffer.alloc(1024, 9) }])),
        );
      },
      cancel() {
        cancelled = true;
      },
    });

    const realOpen = fs.promises.open;
    const openSpy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof realOpen>));
      handle.write = (() => Promise.reject(new Error("EIO"))) as typeof handle.write;
      return handle;
    });

    try {
      await expect(
        readMultipartToDisk({
          body,
          contentType: `multipart/form-data; boundary=${BOUNDARY}`,
          filePartName: "file",
          filePath: tempPath(),
          maxFileBytes: 1024 * 1024,
        }),
      ).rejects.toThrow("EIO");
    } finally {
      openSpy.mockRestore();
    }

    expect(cancelled).toBe(true);
  });

  it("reads a zero-length file part as a zero-length file, not as an absent one", async () => {
    const filePath = tempPath();
    const result = await read(buildBody([{ name: "file", filename: "empty.zip", data: Buffer.alloc(0) }]), {
      filePath,
    });

    expect(result).toMatchObject({ ok: true, hasFile: true, fileBytes: 0 });
    expect(fs.statSync(filePath).size).toBe(0);
  });
});
