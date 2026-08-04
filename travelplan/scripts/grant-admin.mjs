#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

/**
 * Promotes one named account to `ADMIN`.
 *
 *   npm run admin:grant -- someone@example.com
 *
 * Story 5.10, AC8c. This is the *only* bootstrap path for a database that already has users, which is
 * every real installation: AC8b's first-registration promotion is guarded on the user table being
 * empty, and Tommy's production instance has had accounts in it for months, so that guard will never
 * open there. Run this once, on the server, against the live database, and the surface becomes
 * reachable. Until it is run, nobody is an admin and the administration page exists but admits no one.
 *
 * ## Why this is `.mjs` and talks to SQLite directly
 *
 * The story asked for `scripts/grant-admin.ts` going "through Prisma rather than `sqlite3`", and the
 * reason it gave is the one honoured here: the `sqlite3` **command-line binary** may not be installed
 * on the server, while Node and the app's own dependencies always are. What could not be honoured is
 * the file extension, and the reason is worth stating so it is not "fixed" back:
 *
 *   - The deployment server runs Node 20, which cannot execute TypeScript at all (native type
 *     stripping arrives in 22.6, and Story 8.1's bump to 24 is still in the backlog).
 *   - The generated Prisma client at `src/generated/prisma` is TypeScript only - 20 `.ts` files and no
 *     JavaScript build - so importing it needs a transpiling runner.
 *   - The only such runner in the tree is `vite-node`, which arrives transitively with `vitest`, a
 *     **devDependency**. A `.ts` script depending on it would work here and fail on any server
 *     installed with `--omit=dev` - that is, it would fail precisely at the moment it is needed, on a
 *     one-shot command with no second chance.
 *
 * `better-sqlite3` and `dotenv` are production `dependencies`, plain JavaScript, and present wherever
 * the app itself runs; `better-sqlite3` is in fact the very driver Prisma uses here, via
 * `@prisma/adapter-better-sqlite3`. So this needs nothing the running app does not already need, and
 * no external binary - which was the constraint that mattered.
 *
 * The price is that this file writes SQL rather than going through the schema, and so has to get
 * `users.updated_at` right by hand (`@updatedAt` is applied client-side by Prisma, not by SQLite).
 * `test/grantAdminScript.test.ts` pays that price down by reading every result back through
 * `prisma.user` - the way the app does - rather than asserting the raw column.
 */

/** Exactly what `PrismaBetterSqlite3` does with its `url`, and nothing more, so both open one file. */
export const resolveDatabaseFile = (databaseUrl) => String(databaseUrl).replace(/^file:/, "");

/**
 * Prisma's adapter stores `DateTime` as TEXT in this exact shape - `2026-08-04T17:13:33.750+00:00`,
 * an ISO instant with an explicit zero offset rather than the `Z` suffix `toISOString` produces.
 * Writing `CURRENT_TIMESTAMP` here instead would store `2026-08-04 17:13:33`, a different format in a
 * TEXT column that nothing would complain about until the app next read the row.
 */
const prismaTimestamp = () => new Date().toISOString().replace("Z", "+00:00");

/**
 * @returns `{ outcome: "granted" | "already_admin" | "unknown_email", email }`
 *
 * Three outcomes, not two. "Nothing changed" is ambiguous in SQL - `UPDATE ... WHERE email = ?` reports
 * zero changed rows both for an address that does not exist and for one that is already `ADMIN` - and
 * collapsing them would let a typo masquerade as a re-run. So the row is looked up first, and the
 * two cases are told apart by whether it was found.
 */
export const grantAdmin = ({ databaseUrl, email }) => {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalizedEmail === "") {
    throw new Error("An email address is required: npm run admin:grant -- someone@example.com");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  // `fileMustExist` because `new Database(path)` otherwise *creates* the file. Run from the wrong working
  // directory this script would silently make a stray empty database beside the real one and then report
  // "No account exists for <email>" - a message that reads like a mistyped address for what is actually a
  // path bug, on a one-shot command against production with no second chance. Failing here instead names the
  // file it could not open. `resolveDatabaseFile` also only strips a literal `file:` prefix, so a relative
  // `DATABASE_URL` resolves against `cwd` here and against the schema directory under Prisma; this turns that
  // divergence into an error rather than a wrong answer.
  const db = new Database(resolveDatabaseFile(databaseUrl), { fileMustExist: true });
  try {
    // `lower(email)` rather than a bare `=`: every stored address is lowercase (`normalizedEmailSchema`
    // lowercases on the way in), but an operator types the address however it was written to them.
    const existing = db.prepare("SELECT id, role FROM users WHERE lower(email) = ?").get(normalizedEmail);

    if (!existing) {
      return { outcome: "unknown_email", email: normalizedEmail };
    }
    if (existing.role === "ADMIN") {
      return { outcome: "already_admin", email: normalizedEmail };
    }

    db.prepare("UPDATE users SET role = 'ADMIN', updated_at = ? WHERE id = ?").run(prismaTimestamp(), existing.id);

    return { outcome: "granted", email: normalizedEmail };
  } finally {
    db.close();
  }
};

const MESSAGES = {
  granted: (email) => `Granted ADMIN to ${email}.`,
  already_admin: (email) => `${email} is already an ADMIN - nothing to do.`,
  unknown_email: (email) => `No account exists for ${email}. Nothing was changed.`,
};

const main = () => {
  // `npm run admin:grant -- someone@example.com` passes the address as the first script argument.
  const [email] = process.argv.slice(2);

  let result;
  try {
    result = grantAdmin({ databaseUrl: process.env.DATABASE_URL, email });
  } catch (error) {
    console.error(`admin:grant failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const message = MESSAGES[result.outcome](result.email);
  if (result.outcome === "unknown_email") {
    // Loudly, and with an exit code: a silent no-op is the failure this script exists to prevent, and
    // an operator running it from a deploy script needs the status, not just the sentence.
    console.error(message);
    process.exitCode = 1;
    return;
  }

  console.log(message);
};

// Only when executed, never when imported by the test suite.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
