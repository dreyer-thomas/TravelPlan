import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(process.cwd(), "prisma", "test.db");
const migrateLockPath = path.resolve(process.cwd(), "prisma", "test-migrate.lock");

const wait = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

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
process.env.NODE_ENV = "test";

const globalForTests = globalThis as unknown as { prismaMigrated?: boolean };

if (!globalForTests.prismaMigrated) {
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
    globalForTests.prismaMigrated = true;
  } finally {
    if (fs.existsSync(migrateLockPath)) {
      fs.unlinkSync(migrateLockPath);
    }
  }
}
