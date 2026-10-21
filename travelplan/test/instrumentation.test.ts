import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";

const SMTP_UNSET = {
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  MAIL_FROM: undefined,
};

const stub = (env: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * `MEDIA_STORAGE_ROOT` stays as `test/setup.ts` set it (a valid absolute temp path), so in production
 * the media-root check passes and the SMTP check is the one that fires.
 */
describe("instrumentation register", () => {
  it("refuses to start in production when the SMTP settings are missing", async () => {
    stub({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production", NEXT_PHASE: undefined, ...SMTP_UNSET });
    await expect(register()).rejects.toThrow(/SMTP is not configured, missing or empty: SMTP_HOST/);
  });

  it("starts in production with all five set", async () => {
    stub({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      NEXT_PHASE: undefined,
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "465",
      SMTP_USER: "user@example.test",
      SMTP_PASS: "secret",
      MAIL_FROM: "TravelPlan <system@example.test>",
    });
    await expect(register()).resolves.toBeUndefined();
  });

  it("checks nothing outside the Node runtime", async () => {
    stub({ NEXT_RUNTIME: "edge", NODE_ENV: "production", NEXT_PHASE: undefined, ...SMTP_UNSET });
    await expect(register()).resolves.toBeUndefined();
  });
});
