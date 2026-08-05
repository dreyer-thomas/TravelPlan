import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, vi } from "vitest";

const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? "0";
const testDbPath = path.resolve(process.cwd(), "prisma", `test-${workerId}.db`);
const migrateLockPath = path.resolve(process.cwd(), "prisma", `test-migrate-${workerId}.lock`);

/**
 * Redirect every image write away from the developer's real media root (`travelplan/var` by default).
 *
 * Four image-route suites clean up with `fs.rm(<uploadsRoot>, { recursive: true, force: true })`. While
 * `uploadsRoot` resolved to `<cwd>/public/uploads/trips` that cleanup deleted the developer's actual
 * uploaded images on every `npm test` - a real hero image and two day images were lost this way. The
 * routes now resolve their write path through `MEDIA_STORAGE_ROOT` (see `src/lib/trips/uploadPaths.ts`),
 * so pointing it at a per-worker temp directory puts real files permanently out of reach, regardless of
 * what any individual test removes.
 *
 * Set before any route module is imported, because the routes read the variable per call and the
 * suites resolve their own `uploadsRoot` at module scope.
 */
const testUploadsRoot = path.join(os.tmpdir(), "travelplan-test-uploads", `worker-${workerId}`);
process.env.MEDIA_STORAGE_ROOT = testUploadsRoot;
fs.mkdirSync(path.join(testUploadsRoot, "uploads", "trips"), { recursive: true });

const wait = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const sampleDoc = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
});

vi.mock("@tiptap/react", () => ({
  EditorContent: () => null,
  useEditor: (options: { onUpdate?: (args: { editor: { getJSON: () => unknown } }) => void }) => {
    const editor = {
      commands: { setContent: vi.fn() },
      getJSON: () => JSON.parse(sampleDoc),
    };

    if (options?.onUpdate && !(globalThis as { __tiptapUpdated?: boolean }).__tiptapUpdated) {
      (globalThis as { __tiptapUpdated?: boolean }).__tiptapUpdated = true;
      options.onUpdate({ editor });
    }

    return editor;
  },
}));

vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));

const acquireMigrationLock = () => {
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(migrateLockPath, "wx");
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") {
        if (Date.now() - start > 15000) {
          throw new Error("Timed out waiting for Prisma migration lock");
        }
        wait(50);
        continue;
      }
      throw error;
    }
  }
};

process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${testDbPath}`;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

const globalForTests = globalThis as unknown as { prismaMigrated?: Record<string, boolean> };

if (!globalForTests.prismaMigrated) {
  globalForTests.prismaMigrated = {};
}

if (!globalForTests.prismaMigrated[workerId]) {
  acquireMigrationLock();
  try {
    if (!fs.existsSync(testDbPath)) {
      fs.writeFileSync(testDbPath, "");
    }
    execSync("npx prisma migrate deploy", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
      },
    });
    globalForTests.prismaMigrated[workerId] = true;
  } finally {
    if (fs.existsSync(migrateLockPath)) {
      fs.unlinkSync(migrateLockPath);
    }
  }
}

afterAll(async () => {
  const { prisma } = await import("@/lib/db/prisma");
  await prisma.$disconnect();
});
