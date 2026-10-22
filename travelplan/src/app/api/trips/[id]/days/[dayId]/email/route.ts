import type { NextRequest } from "next/server";
import MailComposer from "nodemailer/lib/mail-composer";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripReadAccess } from "@/lib/auth/tripAccess";
import { requireSession } from "@/lib/auth/sessionGuard";
import { prisma } from "@/lib/db/prisma";
import { getRequestI18n } from "@/i18n/request";
import { buildDayEmail, type DayEmailDocuments } from "@/lib/notifications/dayEmail";
import { MAX_DAY_EMAIL_BYTES } from "@/lib/notifications/dayEmailLimits";
import { describeSendFailure, sendEmail, type EmailAttachment } from "@/lib/notifications/email";
import { getTripDayPrintPayloadForUser } from "@/lib/repositories/tripRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { buildDayPacket } from "@/lib/trips/dayPacket";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";

// `node:fs` and `pdf-lib` for the packet, `nodemailer` for the size and the send; none runs on the edge.
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id?: string;
    dayId?: string;
  }>;
};

const NO_STORE = { headers: { "cache-control": "no-store" } };

/**
 * The size of the mail as it would go over the wire, measured rather than estimated: a `bytes * 4/3`
 * guess misses the line breaks, the headers and the quoted-printable HTML part. Same composer nodemailer
 * sends with, no transport, so it measures identically in every environment. The sender and recipient
 * here are placeholders of fixed length; the real ones differ by a few bytes against a 20 MB cap.
 */
const measureMail = async (mail: {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}): Promise<number> => {
  const built = await new MailComposer({
    from: "sender@example.invalid",
    to: "recipient@example.invalid",
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength),
    })),
  })
    .compile()
    .build();
  return built.length;
};

/**
 * `POST /api/trips/[id]/days/[dayId]/email` - the day plan, and its document packet when it fits, to the
 * signed-in traveller's own mailbox (Story 9.3, FR51).
 *
 * **The recipient is the session's account and nothing else.** The body is never read: there is nothing in
 * it this route wants, and a route that parsed it would be one refactor away from honouring a `to`. The
 * address comes from the database by `session.sub`, because the session JWT carries only `sub` and `role`.
 *
 * **Language is the `lang` cookie**, one `getRequestI18n` call shared by the mail and the packet - the UI
 * language the user clicked in, not the account's `preferredLanguage` that the reset mail uses (that route
 * has no session; this one does).
 *
 * **Awaited**, unlike the reset mail: here nothing is enumerated by timing (the caller is signed in and
 * the recipient is themselves), and the user is waiting to be told whether the mail went. The SMTP
 * per-phase timeouts in `email.ts` bound the wait.
 *
 * Guard order: CSRF → session → params → read access (404 for non-members) → day. Read access, not
 * ownership: a viewer who can open the day can take it offline, exactly as with the packet.
 */
export const POST = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403, NO_STORE);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    // The guard builds its own response; the header is added rather than threading an option through it.
    auth.response.headers.set("cache-control", "no-store");
    return auth.response;
  }
  const userId = auth.session.sub;

  const parsedParams = dayRouteParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return fail(apiError("validation_error", "Invalid route parameters", parsedParams.error.flatten()), 400, NO_STORE);
  }
  const { id: tripId, dayId } = parsedParams.data;

  if (!(await hasTripReadAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip day not found"), 404, NO_STORE);
  }

  let mail: { subject: string; text: string; html: string; attachments: EmailAttachment[] };
  let documents: DayEmailDocuments;
  let to: string;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) {
      return fail(apiError("unauthorized", "Authentication required"), 401, NO_STORE);
    }
    to = user.email;

    const payload = await getTripDayPrintPayloadForUser({ userId, tripId, dayId });
    if (!payload) {
      return fail(apiError("not_found", "Trip day not found"), 404, NO_STORE);
    }

    const { language, t } = getRequestI18n(request);
    const dayUrl = new URL(
      `/trips/${tripId}/days/${dayId}`,
      process.env.APP_BASE_URL ?? "http://localhost:3000",
    ).toString();
    const compose = (which: DayEmailDocuments) => buildDayEmail({ payload, language, t, dayUrl, documents: which });

    // The packet is the download's packet, built by the same code: same order, labels, failure pages and
    // file name. More than `MAX_PACKET_DOCUMENTS` cannot be built at all, which for this mail is the same
    // answer as "too large" - the documents are on the day page, behind the link.
    const packet = await buildDayPacket({ tripId, dayId, payload, language, t, logPrefix: "day email POST" });

    if (packet.kind === "built") {
      const attachments: EmailAttachment[] = [
        { filename: packet.fileName, contentType: "application/pdf", content: packet.bytes },
      ];
      const withPacket = { ...compose("attached"), attachments };
      if ((await measureMail(withPacket)) <= MAX_DAY_EMAIL_BYTES) {
        mail = withPacket;
        documents = "attached";
      } else {
        mail = { ...compose("tooLarge"), attachments: [] };
        documents = "tooLarge";
      }
    } else {
      documents = packet.kind === "tooMany" ? "tooLarge" : "none";
      mail = { ...compose(documents), attachments: [] };
    }
  } catch (error) {
    // Nobody's expected outcome - a containment escape, `MEDIA_STORAGE_ROOT` unset, a database failure.
    // No mail goes out: one without the packet would have to claim the documents were too large, which
    // would be false. No address in the line, only what the packet route's catch logs.
    console.error("day email POST: unable to prepare the day email", {
      tripId,
      dayId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return fail(apiError("server_error", "Unable to prepare the day email"), 500, NO_STORE);
  }

  try {
    await sendEmail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.attachments.length > 0 ? { attachments: mail.attachments } : {}),
    });
  } catch (error) {
    // Code, reply code and an address-blanked message - never the error object, the address, the
    // subject, the body or the attachment (Story 8.8's logging rule).
    console.error("day email POST: mail not sent", describeSendFailure(error));
    return fail(apiError("email_failed", "The email could not be sent"), 502, NO_STORE);
  }

  return ok({ sentTo: to, attachment: documents }, NO_STORE);
};
