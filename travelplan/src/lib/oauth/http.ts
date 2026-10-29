import { NextResponse } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { readBodyWithinLimit } from "@/lib/http/bodyLimit";
import { fail } from "@/lib/http/response";

/**
 * Story 15.1. Response helpers for the OAuth endpoints. These answer in the shapes the RFCs prescribe
 * (`{ access_token, ... }`, `{ error, error_description }`), not in the app's `{ data, error }` envelope:
 * OAuth clients parse the RFC shape and nothing else. Token responses must not be cached (RFC 6749 §5.1).
 */

const NO_STORE_HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** AC 1: every connector endpoint answers like a route that does not exist while the switch is off. */
export const connectorDisabled = () => fail(apiError("not_found", "Not found"), 404);

export const oauthJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

export const oauthError = (error: string, description: string, status = 400) =>
  oauthJson({ error, error_description: description }, status);

export const metadataJson = (body: unknown) =>
  NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });

const MAX_FORM_BYTES = 16 * 1024;

export type FormBodyResult = { ok: true; params: URLSearchParams } | { ok: false; description: string };

/**
 * RFC 6749 requires `application/x-www-form-urlencoded` on the token endpoint. Parsed by hand rather than
 * with `request.formData()`, which would also accept multipart; the body is counted, and a parameter sent
 * twice is refused (RFC 6749 §3.2).
 */
export const readFormBody = async (request: Request): Promise<FormBodyResult> => {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return { ok: false, description: "Content-Type must be application/x-www-form-urlencoded" };
  }
  const read = await readBodyWithinLimit(request.body, MAX_FORM_BYTES);
  if (!read.ok) return { ok: false, description: read.reason === "too_large" ? "Request body too large" : "Missing request body" };
  const params = new URLSearchParams(read.bytes.toString("utf8"));
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return { ok: false, description: `Parameter ${key} sent more than once` };
    seen.add(key);
  }
  return { ok: true, params };
};
