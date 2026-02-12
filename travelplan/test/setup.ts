import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(process.cwd(), "prisma", "test.db");

process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${testDbPath}`;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
process.env.NODE_ENV = "test";

const globalForTests = globalThis as unknown as { prismaMigrated?: boolean };

if (!globalForTests.prismaMigrated) {
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
}
