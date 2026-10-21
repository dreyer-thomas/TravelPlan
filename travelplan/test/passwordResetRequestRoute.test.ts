import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn<(options: unknown) => { sendMail: typeof sendMail }>(() => ({ sendMail }));
  return { createTransport, sendMail };
});

// Reached only by the case that runs the real production path; everything else uses the outbox.
vi.mock("nodemailer", () => ({ default: { createTransport }, createTransport }));

// The real `sendEmail` (outbox under NODE_ENV=test) unless a case makes it throw.
vi.mock("@/lib/notifications/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

import { POST } from "@/app/api/auth/password-reset/request/route";
import { prisma } from "@/lib/db/prisma";
import { clearEmailOutbox, getEmailOutbox, sendEmail } from "@/lib/notifications/email";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (body: Record<string, unknown>, includeCsrf = true, extraCookie?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (includeCsrf) {
    const csrfToken = "test-csrf-token";
    headers["x-csrf-token"] = csrfToken;
    headers.cookie = `csrf_token=${csrfToken}`;
  }
  if (extraCookie) {
    headers.cookie = headers.cookie ? `${headers.cookie}; ${extraCookie}` : extraCookie;
  }

  return new NextRequest("http://localhost/api/auth/password-reset/request", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("POST /api/auth/password-reset/request", () => {
  beforeEach(async () => {
    createTransport.mockClear();
    sendMail.mockReset();
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
    clearEmailOutbox();
    vi.stubEnv("APP_BASE_URL", "https://plan.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearEmailOutbox();
  });

  const createUser = (email: string, preferredLanguage: "en" | "de") =>
    prisma.user.create({
      data: { email, passwordHash: "hashed-password", role: "OWNER", preferredLanguage },
    });

  const RESET_LINK = /https:\/\/plan\.example\.test\/auth\/reset-password\?token=([0-9a-f]{64})/;

  it("returns csrf error envelope when token missing", async () => {
    const request = buildRequest({ email: "user@example.com" }, false);

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("returns success envelope even when email is unknown", async () => {
    const request = buildRequest({ email: "unknown@example.com" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.success).toBe(true);

    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(0);
  });

  it("creates a reset token for a known email", async () => {
    await prisma.user.create({
      data: {
        email: "known@example.com",
        passwordHash: "hashed-password",
        role: "OWNER",
      },
    });

    const request = buildRequest({ email: "known@example.com" });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.success).toBe(true);

    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].used).toBe(false);
  });

  it("mails the reset link to exactly that address, in English for an English account", async () => {
    await createUser("known@example.com", "en");

    const response = await POST(buildRequest({ email: "known@example.com" }));
    expect(response.status).toBe(200);

    const outbox = getEmailOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("known@example.com");
    expect(outbox[0].subject).toBe("Reset your TravelPlan password");
    expect(outbox[0].text).toMatch(RESET_LINK);
    expect(outbox[0].text).toContain("valid for one hour");
  });

  it("writes in the account's language, not the language of the page it was asked from", async () => {
    await createUser("de@example.com", "de");

    await POST(buildRequest({ email: "de@example.com" }, true, "lang=en"));

    const outbox = getEmailOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].subject).toBe("TravelPlan: Passwort zurücksetzen");
    expect(outbox[0].text).toContain("Er ist eine Stunde gültig");
    expect(outbox[0].text).toMatch(RESET_LINK);
  });

  it("sends nothing for an unknown address", async () => {
    await POST(buildRequest({ email: "unknown@example.com" }));
    expect(getEmailOutbox()).toEqual([]);
  });

  it("still answers success when the mail cannot be sent, and logs the failure without the error object", async () => {
    await createUser("known@example.com", "en");
    vi.mocked(sendEmail).mockRejectedValueOnce(
      Object.assign(new Error("Invalid login: 535 Authentication credentials invalid"), {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(buildRequest({ email: "known@example.com" }));
    const payload = (await response.json()) as ApiEnvelope<{ success: boolean }>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({ data: { success: true }, error: null });

    // The send is not awaited, so the failure is logged once the rejection settles.
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("password-reset/request: reset email not sent");
    expect(details).toEqual({
      code: "EAUTH",
      responseCode: 535,
      message: "Invalid login: 535 Authentication credentials invalid",
    });
  });

  it("logs a real SMTP failure without password, token, link, body or recipient", async () => {
    await createUser("known@example.com", "en");
    for (const [key, value] of Object.entries({
      NODE_ENV: "production",
      SMTP_HOST: "smtp.strato.de",
      SMTP_PORT: "465",
      SMTP_USER: "webmaster@dreyer-travels.de",
      SMTP_PASS: "pw-sentinel-8c1f",
      MAIL_FROM: "TravelPlan <system@plan.dreyer-travels.de>",
    })) {
      vi.stubEnv(key, value);
    }
    // Shaped like nodemailer's: the message quotes the server's reply, recipient included, and the
    // extra fields carry what the log must never see.
    sendMail.mockRejectedValueOnce(
      Object.assign(
        new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <known@example.com>: Recipient unknown"),
        {
          code: "EENVELOPE",
          responseCode: 550,
          command: "AUTH PLAIN pw-sentinel-8c1f",
          response: "550 5.1.1 <known@example.com>: Recipient unknown",
          rejected: ["known@example.com"],
        },
      ),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(buildRequest({ email: "known@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { success: true }, error: null });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    expect(consoleError.mock.calls[0][1]).toEqual({
      code: "EENVELOPE",
      responseCode: 550,
      message: "Can't send mail - all recipients were rejected: 550 5.1.1 <<address>>: Recipient unknown",
    });

    // The real transport saw the real mail, so the secrets below were on the path the log came from.
    const sent = sendMail.mock.calls[0][0] as { to: string; text: string };
    expect(sent.to).toBe("known@example.com");
    expect(createTransport.mock.calls[0][0]).toMatchObject({ auth: { pass: "pw-sentinel-8c1f" } });
    const rawToken = sent.text.match(RESET_LINK)?.[1];
    expect(rawToken).toBeDefined();
    const logged = JSON.stringify(consoleError.mock.calls);
    for (const secret of [rawToken!, "/auth/reset-password", sent.text, "pw-sentinel-8c1f", "AUTH PLAIN", "known@example.com"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("logs only the kind of a non-Error rejection", async () => {
    await createUser("known@example.com", "en");
    vi.mocked(sendEmail).mockRejectedValueOnce("raw reply for known@example.com");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(buildRequest({ email: "known@example.com" }));

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    expect(consoleError.mock.calls[0][1]).toEqual({
      code: undefined,
      responseCode: undefined,
      message: "non-Error thrown (string)",
    });
  });

  it("answers at once while the send is still pending, as it does for an unknown address", async () => {
    await createUser("known@example.com", "en");
    vi.mocked(sendEmail).mockReturnValueOnce(new Promise<void>(() => {}));

    const response = await POST(buildRequest({ email: "known@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { success: true }, error: null });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("answers the same for a failed send as for an unknown address", async () => {
    await createUser("known@example.com", "en");
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const failed = await POST(buildRequest({ email: "known@example.com" }));
    const unknown = await POST(buildRequest({ email: "unknown@example.com" }));

    expect(failed.status).toBe(unknown.status);
    expect(await failed.json()).toEqual(await unknown.json());
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
  });
});
