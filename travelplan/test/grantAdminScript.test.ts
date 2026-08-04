import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { grantAdmin, resolveDatabaseFile } from "../scripts/grant-admin.mjs";

/**
 * Story 5.10, AC8c. The existing-installation half of the bootstrap.
 *
 * This is the path Tommy's production instance actually uses: AC8b's first-registration promotion can
 * never fire there, because the table has had accounts in it for months. So this script is the *only*
 * way that database ever gets its first administrator, and it gets one shot at it.
 *
 * **Why the assertions round-trip through Prisma.** The script writes SQL directly through
 * `better-sqlite3` rather than through the generated Prisma client - see the file's own header for why
 * it has to - and the risk that buys is a value the app cannot read back. `users.updated_at` is TEXT in
 * a specific ISO shape, and a hand-written `CURRENT_TIMESTAMP` would be a different one. So every case
 * below reads the row through `prisma.user`, which is what the app itself does: "Prisma can read what
 * the script wrote" is the contract, and asserting the raw column would pass while the app broke.
 */
const databaseUrl = process.env.DATABASE_URL!;

describe("scripts/grant-admin.mjs", () => {
  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("promotes a known account and says whom it promoted", async () => {
    const user = await prisma.user.create({
      data: { email: "operator@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const result = grantAdmin({ databaseUrl, email: "operator@example.com" });

    expect(result).toEqual({ outcome: "granted", email: "operator@example.com" });
    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.role).toBe("ADMIN");
  });

  /**
   * The whole reason the script exists rather than an `UPDATE` typed into a SQLite shell: a mistyped
   * email changes zero rows and says nothing at all, and the operator walks away believing the
   * installation has an administrator.
   */
  it("refuses loudly on an unknown email and changes nothing", async () => {
    await prisma.user.create({
      data: { email: "operator@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const result = grantAdmin({ databaseUrl, email: "typo@example.com" });

    expect(result).toEqual({ outcome: "unknown_email", email: "typo@example.com" });
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  /** `updated_at` is the column raw SQL is most likely to get wrong, so it is asserted as a real Date. */
  it("leaves updatedAt in a shape Prisma can still read", async () => {
    const user = await prisma.user.create({
      data: { email: "operator@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const before = user.updatedAt;

    grantAdmin({ databaseUrl, email: "operator@example.com" });

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.updatedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(reloaded.updatedAt.getTime())).toBe(false);
    expect(reloaded.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("matches the email case-insensitively, the way every account is stored", async () => {
    // `normalizedEmailSchema` lowercases on the way in, so every stored address is lowercase - but an
    // operator reading an address off a screen types it however it was written to them.
    await prisma.user.create({
      data: { email: "operator@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const result = grantAdmin({ databaseUrl, email: "  Operator@Example.COM  " });

    expect(result.outcome).toBe("granted");
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "operator@example.com" } })).role).toBe("ADMIN");
  });

  it("is idempotent on an account that is already an admin", async () => {
    await prisma.user.create({
      data: { email: "operator@example.com", passwordHash: "hashed", role: "ADMIN" },
    });

    // Re-running is what an operator does when they are not sure the first run took. It must not be an
    // error, and it must not report `unknown_email` just because no row *changed*.
    const result = grantAdmin({ databaseUrl, email: "operator@example.com" });

    expect(result.outcome).toBe("already_admin");
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("does not disturb anybody else's role", async () => {
    await prisma.user.create({ data: { email: "operator@example.com", passwordHash: "h", role: "OWNER" } });
    await prisma.user.create({ data: { email: "viewer@example.com", passwordHash: "h", role: "VIEWER" } });

    grantAdmin({ databaseUrl, email: "operator@example.com" });

    expect((await prisma.user.findUniqueOrThrow({ where: { email: "viewer@example.com" } })).role).toBe("VIEWER");
  });

  it("reads the sqlite path out of a file: URL the way the app's adapter does", () => {
    // `PrismaBetterSqlite3` does `url.replace(/^file:/, "")` and nothing else. The script has to agree
    // with it exactly, or it edits a different database than the one the app reads.
    expect(resolveDatabaseFile("file:/tmp/x/dev.db")).toBe("/tmp/x/dev.db");
    expect(resolveDatabaseFile("/tmp/x/dev.db")).toBe("/tmp/x/dev.db");
  });

  it("refuses a missing email argument rather than guessing", () => {
    expect(() => grantAdmin({ databaseUrl, email: "" })).toThrow(/email/i);
    expect(() => grantAdmin({ databaseUrl, email: undefined })).toThrow(/email/i);
  });
});

/**
 * Story 5.10 review: the CLI half, spawned as a real child process.
 *
 * The cases above cover `grantAdmin` and cover it well. What none of them reaches is `main()` - the stderr
 * line and `process.exitCode = 1` - and that is the half AC8c's "refuse loudly" actually names. A silent
 * no-op is the failure this script exists to prevent, so "it returns `{ outcome: 'unknown_email' }`" is the
 * inner contract and "the operator's shell sees a message and a non-zero status" is the one they experience.
 * Only a child process can assert the second: the module guard at the foot of the script (`process.argv[1]`
 * against `import.meta.url`) exists precisely so importing it here does *not* run `main`.
 */
describe("scripts/grant-admin.mjs as the operator runs it", () => {
  const run = async (args: string[], env: Record<string, string> = {}) => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["scripts/grant-admin.mjs", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl, ...env },
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("exits 0 and names whom it promoted", async () => {
    const user = await prisma.user.create({
      data: { email: "cli-known@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const { status, stdout } = await run(["cli-known@example.com"]);

    expect(status).toBe(0);
    expect(stdout).toContain("cli-known@example.com");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("ADMIN");
  });

  it("fails loudly on an unknown address: stderr, exit 1, and nothing written", async () => {
    await prisma.user.create({
      data: { email: "bystander@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const { status, stdout, stderr } = await run(["typo@example.com"]);

    // The three things a deploy script and a human respectively depend on.
    expect(status).toBe(1);
    expect(stderr).toContain("typo@example.com");
    expect(stdout).toBe("");
    // And the loud refusal is a refusal: no bystander was promoted to make the command look successful.
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  it("fails loudly when given no address at all", async () => {
    const { status, stderr } = await run([]);

    expect(status).toBe(1);
    expect(stderr).toContain("admin:grant failed");
  });

  /**
   * The `fileMustExist` guard added by the review. `new Database(path)` creates the file when absent, so
   * before this the wrong working directory produced a stray empty database and then "No account exists for
   * <email>" - a message that reads like a mistyped address for what is a path bug, on a one-shot command
   * against production. The point of the assertion is the *absence*: no file is left behind.
   */
  it("refuses a DATABASE_URL that points at no database, and creates nothing", async () => {
    const { existsSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const stray = join(process.cwd(), "prisma", "grant-admin-nonexistent.db");
    rmSync(stray, { force: true });

    const { status, stderr } = await run(["anyone@example.com"], { DATABASE_URL: `file:${stray}` });

    expect(status).toBe(1);
    expect(stderr).toContain("admin:grant failed");
    expect(existsSync(stray)).toBe(false);
  });
});
