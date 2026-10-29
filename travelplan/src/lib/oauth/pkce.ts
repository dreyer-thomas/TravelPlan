import crypto from "crypto";

/** RFC 7636 §4.1/§4.2: 43-128 characters of the unreserved set. Used for verifier and challenge alike. */
const PKCE_VALUE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export const isValidPkceValue = (value: string) => PKCE_VALUE_PATTERN.test(value);

/** S256 only. Compared in constant time; the lengths of two base64url SHA-256 digests are always equal. */
export const verifyS256 = (verifier: string, challenge: string) => {
  if (!isValidPkceValue(verifier) || !isValidPkceValue(challenge)) return false;
  const computed = Buffer.from(crypto.createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
};
