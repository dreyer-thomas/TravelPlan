import nodemailer from "nodemailer";
import { readSmtpConfig, usesSmtp } from "@/lib/notifications/smtpConfig";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Connection, greeting and socket inactivity, each - per phase, not a cap on the whole send. The reset
 * route does not await the send, so these bound how long a stuck background send lives, not a request.
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
  });
};

export const getEmailOutbox = () => [...outbox];

export const clearEmailOutbox = () => {
  outbox.length = 0;
};
