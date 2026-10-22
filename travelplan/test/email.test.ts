import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));
  return { createTransport, sendMail };
});

vi.mock("nodemailer", () => ({ default: { createTransport }, createTransport }));

import { clearEmailOutbox, getEmailOutbox, sendEmail } from "@/lib/notifications/email";

const SMTP = {
  SMTP_HOST: "smtp.strato.de",
  SMTP_PORT: "465",
  SMTP_USER: "webmaster@dreyer-travels.de",
  SMTP_PASS: "pw-sentinel-8c1f",
  MAIL_FROM: "TravelPlan <system@plan.dreyer-travels.de>",
};

const MESSAGE = { to: "someone@example.test", subject: "Subject", text: "Line one\nLine two" };

const stub = (env: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
};

beforeEach(() => {
  createTransport.mockClear();
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "<id@test>" });
  clearEmailOutbox();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearEmailOutbox();
});

describe("sendEmail outside production", () => {
  it.each(["development", "test", "staging"])(
    "puts the message in the outbox and never creates a transport under NODE_ENV=%s, SMTP settings or not",
    async (nodeEnv) => {
      stub({ NODE_ENV: nodeEnv, ...SMTP });
      await sendEmail(MESSAGE);
      expect(getEmailOutbox()).toEqual([MESSAGE]);
      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    },
  );
});

describe("sendEmail in production", () => {
  it("sends over implicit TLS on 465 with verification on and bounded timeouts", async () => {
    stub({ NODE_ENV: "production", ...SMTP });
    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledTimes(1);
    const options = (createTransport.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      host: "smtp.strato.de",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "webmaster@dreyer-travels.de", pass: "pw-sentinel-8c1f" },
    });
    for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      expect(options[key], key).toBeTypeOf("number");
      expect(options[key] as number, key).toBeLessThanOrEqual(15_000);
    }
    expect(JSON.stringify(options)).not.toContain("rejectUnauthorized");
  });

  it("requires STARTTLS on any other port", async () => {
    stub({ NODE_ENV: "production", ...SMTP, SMTP_PORT: "587" });
    await sendEmail(MESSAGE);
    expect((createTransport.mock.calls[0] as unknown[])[0]).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it("sends plain text from MAIL_FROM to exactly the given address, and keeps nothing in the outbox", async () => {
    stub({ NODE_ENV: "production", ...SMTP });
    await sendEmail(MESSAGE);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: "TravelPlan <system@plan.dreyer-travels.de>",
      to: "someone@example.test",
      subject: "Subject",
      text: "Line one\nLine two",
    });
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("html");
    expect(getEmailOutbox()).toEqual([]);
  });

  it("rejects when the transport fails, so a caller cannot mistake a lost mail for a sent one", async () => {
    stub({ NODE_ENV: "production", ...SMTP });
    sendMail.mockRejectedValue(Object.assign(new Error("Invalid login: 535 Authentication failed"), { code: "EAUTH" }));
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ code: "EAUTH" });
  });

  it("rejects without opening a transport when a setting is missing", async () => {
    stub({ NODE_ENV: "production", ...SMTP, SMTP_PASS: undefined });
    await expect(sendEmail(MESSAGE)).rejects.toThrow(/SMTP_PASS/);
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe("sendEmail with an HTML part and attachments (Story 9.3)", () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const RICH = {
    ...MESSAGE,
    html: "<p>Line one</p>",
    attachments: [{ filename: "trip-day-1-documents.pdf", contentType: "application/pdf", content: bytes }],
  };

  it("passes html and attachments through to nodemailer in production", async () => {
    stub({ NODE_ENV: "production", ...SMTP });
    await sendEmail(RICH);

    const sent = sendMail.mock.calls[0][0] as {
      html: string;
      attachments: { filename: string; contentType: string; content: Buffer }[];
    };
    expect(sent.html).toBe("<p>Line one</p>");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toBe("trip-day-1-documents.pdf");
    expect(sent.attachments[0].contentType).toBe("application/pdf");
    expect(Buffer.isBuffer(sent.attachments[0].content)).toBe(true);
    expect([...sent.attachments[0].content]).toEqual([...bytes]);
  });

  it("passes only the attachment's own bytes when it is a view into a larger buffer", async () => {
    stub({ NODE_ENV: "production", ...SMTP });
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    await sendEmail({ ...MESSAGE, attachments: [{ filename: "a.pdf", contentType: "application/pdf", content: view }] });
    const sent = sendMail.mock.calls[0][0] as { attachments: { content: Buffer }[] };
    expect([...sent.attachments[0].content]).toEqual([1, 2, 3]);
  });

  it("adds no html or attachments key when the message has none", async () => {
    stub({ NODE_ENV: "production", ...SMTP });
    await sendEmail(MESSAGE);
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("html");
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("attachments");
  });

  it("keeps html and attachments in the outbox outside production", async () => {
    stub({ NODE_ENV: "test" });
    await sendEmail(RICH);
    expect(getEmailOutbox()).toEqual([RICH]);
  });
});
