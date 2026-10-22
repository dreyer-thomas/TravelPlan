import nodemailer from "nodemailer";
import { readSmtpConfig, usesSmtp } from "@/lib/notifications/smtpConfig";

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
};

export type EmailMessage = {
  to: string;
  subject: string;
  /** Always present: the plain-text part, and the whole mail when there is no `html`. */
  text: string;
  /** Optional HTML alternative to `text` (Story 9.3). Carries the same content, never more. */
  html?: string;
  attachments?: EmailAttachment[];
};

/** Anything shaped like a mail address. nodemailer's messages quote the server's reply, recipient included. */
const ADDRESS_PATTERN = /[^\s<>"',;:()[\]]+@[^\s<>"',;:()[\]]+/g;

/**
 * What an SMTP failure is allowed to put in the journal: nodemailer's error code (`EAUTH`,
 * `ECONNECTION`, `ETIMEDOUT`...), the server's reply code and the message with any address blanked -
 * never the error object, whose `command`, `response` and envelope fields are not ours to vouch for,
 * and never a non-`Error` throw, which could be anything.
 */
export const describeSendFailure = (error: unknown) => {
  const fields = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;
  return {
    code: typeof fields.code === "string" ? fields.code : undefined,
    responseCode: typeof fields.responseCode === "number" ? fields.responseCode : undefined,
    message:
      error instanceof Error ? error.message.replace(ADDRESS_PATTERN, "<address>") : `non-Error thrown (${typeof error})`,
  };
};

/**
 * Connection, greeting and socket inactivity, each - per phase, not a cap on the whole send. The reset
 * route does not await its send, so there they bound how long a stuck background send lives; the day
 * email route (Story 9.3) awaits, so there they also bound the request - per phase, so a slow but
 * moving upload of a large attachment is not cut off, and a stalled one is.
 */
const SMTP_TIMEOUT_MS = 15_000;

const globalForEmail = globalThis as unknown as {
  emailOutbox?: EmailMessage[];
};

const outbox = globalForEmail.emailOutbox ?? [];

if (process.env.NODE_ENV !== "production") {
  globalForEmail.emailOutbox = outbox;
}

/**
 * Production sends over SMTP (Story 8.8); everywhere else the message goes into the in-memory outbox
 * and no connection is made, whatever SMTP variables happen to be set.
 *
 * **Throws when the mail is not sent.** Deciding what a failure means is the caller's job - the reset
 * route logs it and still answers success - but a swallowed failure in here is exactly how reset mail
 * went missing in production before this story.
 *
 * A transport per call, not a cached one: the volume is a handful of mails a year, and a cached
 * transport would keep settings from before a config change.
 */
export const sendEmail = async (message: EmailMessage) => {
  if (!usesSmtp()) {
    outbox.push(message);
    return;
  }

  const config = readSmtpConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Implicit TLS on 465; anywhere else STARTTLS is mandatory, or nodemailer would carry on in clear
    // text (AUTH included) if the server did not offer it. Certificate verification is left on.
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  await transport.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    // Spread only when present: the reset mail's `sendMail` call stays exactly `{ from, to, subject,
    // text }`, with no `html: undefined` key that a transport could read as "there is an HTML part".
    ...(message.html !== undefined ? { html: message.html } : {}),
    ...(message.attachments !== undefined
      ? {
          attachments: message.attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            // A view over the same memory, not a copy: the attachment can be a packet of several MB.
            content: Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength),
          })),
        }
      : {}),
  });
};

export const getEmailOutbox = () => [...outbox];

export const clearEmailOutbox = () => {
  outbox.length = 0;
};
