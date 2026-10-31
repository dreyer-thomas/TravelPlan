import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertFileLinksConfigured,
  fileLinkSignature,
  readFileLinkSecret,
  readFileLinkTtlSeconds,
  signFileLink,
  verifyFileLink,
} from "@/lib/files/fileLinks";

const SECRET = crypto.randomBytes(32);
const NOW = new Date("2026-10-31T12:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;

const queryOf = (url: string) => {
  const parsed = new URL(url);
  return {
    fileId: decodeURIComponent(parsed.pathname.replace(/^\/f\//, "")),
    w: parsed.searchParams.get("w"),
    exp: parsed.searchParams.get("exp"),
    sig: parsed.searchParams.get("sig"),
  };
};

beforeEach(() => {
  vi.stubEnv("FILE_LINK_SECRET", SECRET.toString("base64url"));
  vi.stubEnv("APP_BASE_URL", "https://plan.example.test/");
  vi.stubEnv("FILE_LINK_TTL_SECONDS", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signFileLink", () => {
  it("builds the url with w, exp (now + 900) and the HMAC signature", () => {
    const link = signFileLink("file_1", { width: 1600, now: NOW })!;
    const exp = NOW_SECONDS + 900;
    expect(link.url).toBe(
      `https://plan.example.test/f/file_1?w=1600&exp=${exp}&sig=${fileLinkSignature(SECRET, "file_1", 1600, exp)}`,
    );
    expect(link.expiresAt).toEqual(new Date(exp * 1000));
    const expected = crypto.createHmac("sha256", SECRET).update(`file_1|1600|${exp}`).digest("base64url");
    expect(queryOf(link.url).sig).toBe(expected);
  });

  it("leaves w out of the query and signs an empty w without a width", () => {
    const link = signFileLink("file_1", { now: NOW })!;
    const exp = NOW_SECONDS + 900;
    expect(link.url).toBe(`https://plan.example.test/f/file_1?exp=${exp}&sig=${fileLinkSignature(SECRET, "file_1", null, exp)}`);
    expect(queryOf(link.url).sig).toBe(crypto.createHmac("sha256", SECRET).update(`file_1||${exp}`).digest("base64url"));
  });

  it("returns null with a short, malformed or missing secret, or without a base url", () => {
    vi.stubEnv("FILE_LINK_SECRET", crypto.randomBytes(31).toString("base64url"));
    expect(signFileLink("file_1", { now: NOW })).toBeNull();
    vi.stubEnv("FILE_LINK_SECRET", "not base64url!!");
    expect(signFileLink("file_1", { now: NOW })).toBeNull();
    vi.stubEnv("FILE_LINK_SECRET", undefined);
    expect(signFileLink("file_1", { now: NOW })).toBeNull();
    vi.stubEnv("FILE_LINK_SECRET", SECRET.toString("base64url"));
    vi.stubEnv("APP_BASE_URL", undefined);
    expect(signFileLink("file_1", { now: NOW })).toBeNull();
  });

  it("accepts a padded secret", () => {
    vi.stubEnv("FILE_LINK_SECRET", SECRET.toString("base64").replace(/\+/g, "-").replace(/\//g, "_"));
    expect(readFileLinkSecret()).toEqual(SECRET);
  });
});

describe("readFileLinkTtlSeconds", () => {
  it("defaults to 900 and clamps anything outside 60..86400 back to it", () => {
    expect(readFileLinkTtlSeconds()).toBe(900);
    for (const [raw, expected] of [
      ["60", 60],
      ["86400", 86400],
      ["59", 900],
      ["86401", 900],
      ["600.5", 900],
      ["-300", 900],
      ["abc", 900],
      ["", 900],
    ] as const) {
      vi.stubEnv("FILE_LINK_TTL_SECONDS", raw);
      expect(readFileLinkTtlSeconds(), raw).toBe(expected);
    }
  });

  it("is what signFileLink adds to now", () => {
    vi.stubEnv("FILE_LINK_TTL_SECONDS", "120");
    expect(queryOf(signFileLink("file_1", { now: NOW })!.url).exp).toBe(String(NOW_SECONDS + 120));
  });
});

describe("verifyFileLink", () => {
  const signed = () => queryOf(signFileLink("file_1", { width: 1600, now: NOW })!.url);

  it("accepts a fresh link and reports its width and expiry", () => {
    expect(verifyFileLink({ ...signed(), now: NOW })).toEqual({ ok: true, width: 1600, expiresAt: NOW_SECONDS + 900 });
    const noWidth = queryOf(signFileLink("file_1", { now: NOW })!.url);
    expect(verifyFileLink({ ...noWidth, now: NOW })).toEqual({ ok: true, width: null, expiresAt: NOW_SECONDS + 900 });
  });

  it("refuses a tampered signature, another file id, a changed or removed w, and a missing exp or sig", () => {
    const link = signed();
    const flipped = `${link.sig![0] === "A" ? "B" : "A"}${link.sig!.slice(1)}`;
    const cases = [
      { ...link, sig: flipped },
      { ...link, sig: `${link.sig}A` },
      { ...link, fileId: "file_2" },
      { ...link, w: "2400" },
      { ...link, w: null },
      { ...link, exp: null },
      { ...link, sig: null },
    ];
    for (const params of cases) {
      expect(verifyFileLink({ ...params, now: NOW })).toEqual({ ok: false });
    }
  });

  it("refuses an expired, a non-numeric and an unsupported-width link even when signed", () => {
    const link = signed();
    expect(verifyFileLink({ ...link, now: new Date((NOW_SECONDS + 900) * 1000) })).toEqual({ ok: false });
    expect(verifyFileLink({ ...link, exp: "12e9", now: NOW })).toEqual({ ok: false });
    const exp = NOW_SECONDS + 60;
    expect(
      verifyFileLink({ fileId: "file_1", w: "1000", exp: String(exp), sig: fileLinkSignature(SECRET, "file_1", 1000, exp), now: NOW }),
    ).toEqual({ ok: false });
    expect(
      verifyFileLink({ fileId: "file_1", w: "01600", exp: String(exp), sig: fileLinkSignature(SECRET, "file_1", 1600, exp), now: NOW }),
    ).toEqual({ ok: false });
    expect(verifyFileLink({ ...link, exp: `0${link.exp}`, now: NOW })).toEqual({ ok: false });
  });

  it("refuses everything without a usable secret", () => {
    const link = signed();
    vi.stubEnv("FILE_LINK_SECRET", undefined);
    expect(verifyFileLink({ ...link, now: NOW })).toEqual({ ok: false });
  });
});

describe("assertFileLinksConfigured", () => {
  it("throws only in production with the connector on and no usable secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("FILE_LINK_SECRET", undefined);
    expect(() => assertFileLinksConfigured()).toThrow("MCP_ENABLED=true requires FILE_LINK_SECRET (base64url, at least 32 bytes)");
    vi.stubEnv("FILE_LINK_SECRET", crypto.randomBytes(16).toString("base64url"));
    expect(() => assertFileLinksConfigured()).toThrow(/FILE_LINK_SECRET/);
    vi.stubEnv("FILE_LINK_SECRET", SECRET.toString("base64url"));
    expect(() => assertFileLinksConfigured()).not.toThrow();

    vi.stubEnv("FILE_LINK_SECRET", undefined);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(() => assertFileLinksConfigured()).not.toThrow();
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("MCP_ENABLED", "false");
    expect(() => assertFileLinksConfigured()).not.toThrow();
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertFileLinksConfigured()).not.toThrow();
  });
});
