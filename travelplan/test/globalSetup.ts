import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Runs once per `vitest run`, before any worker starts: migrates one template database that every test
 * file then copies (`test/setup.ts`).
 *
 * Every test file gets its own worker id and therefore its own database file, and each used to run
 * `npx prisma migrate deploy` itself - about three seconds of process start-up per file, roughly twelve
 * of the thirty minutes a full run took on Windows. A file copy takes milliseconds and yields the same
 * schema, migrated by the same command from the same migrations folder.
 */
export const TEMPLATE_DB_NAME = "test-template.db";

export default function globalSetup() {
  const root = path.resolve(__dirname, "..");
  const templatePath = path.join(root, "prisma", TEMPLATE_DB_NAME);
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${templatePath}${suffix}`, { force: true });
  }
  fs.writeFileSync(templatePath, "");
  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${templatePath}` },
  });
}
