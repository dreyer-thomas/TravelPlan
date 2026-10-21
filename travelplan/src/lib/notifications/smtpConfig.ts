/**
 * The SMTP settings for outgoing mail, and the startup check that demands them (Story 8.8).
 *
 * **No nodemailer here, on purpose.** `instrumentation.ts` imports this module for the boot check, and
 * that file is still compiled for the edge runtime, where `net` and `tls` do not exist (see its
 * docblock). Only `email.ts`, which nothing but route handlers reach, imports the transport.
 *
 * **One predicate for both sides.** `usesSmtp()` decides whether `sendEmail` talks SMTP *and* whether
 * the boot check demands the settings. `mediaRootBoot.ts` deliberately treats anything that is not
 * `development`/`test` as production; copying that rule here would let a `NODE_ENV=staging` server pass
 * the boot check and then drop every message into the in-memory outbox - the silent loss this story
 * exists to remove. `next start` always runs with `NODE_ENV=production`, so the server is covered.
 */

export const SMTP_VARIABLES = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] as const;

export type SmtpConfig = {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Every other port must upgrade with STARTTLS - see `email.ts`. */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export const usesSmtp = () => process.env.NODE_ENV === "production";

/**
 * Reads the five variables or throws. The message names variables and never a value: it ends up in
 * the journal, and one of the values is the mailbox password.
 */
export const readSmtpConfig = (): SmtpConfig => {
  const values = Object.fromEntries(
    SMTP_VARIABLES.map((name) => [name, process.env[name]?.trim() ?? ""]),
  ) as Record<(typeof SMTP_VARIABLES)[number], string>;

  const missing = SMTP_VARIABLES.filter((name) => values[name] === "");
  if (missing.length > 0) {
    throw new Error(
      `SMTP is not configured, missing or empty: ${missing.join(", ")}. In production every email ` +
        "(password reset) is sent over SMTP, and without these settings it would be lost without a " +
        "trace - see docs/deployment-configuration.md.",
    );
  }

  const port = /^\d+$/.test(values.SMTP_PORT) ? Number(values.SMTP_PORT) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a whole number from 1 to 65535 (465 for implicit TLS, 587 for STARTTLS).");
  }

  return {
    host: values.SMTP_HOST,
    port,
    secure: port === 465,
    user: values.SMTP_USER,
    // Trimmed only to decide "empty": a password may legitimately start or end with a space.
    pass: process.env.SMTP_PASS ?? "",
    from: values.MAIL_FROM,
  };
};

/** The boot check, called from `instrumentation.ts`. Quiet on success, like the media-root check. */
export const assertSmtpConfigured = () => {
  // `next build` runs with `NODE_ENV=production` and sends no mail; without this the build would
  // demand the mailbox password.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  if (!usesSmtp()) {
    return;
  }
  readSmtpConfig();
};
