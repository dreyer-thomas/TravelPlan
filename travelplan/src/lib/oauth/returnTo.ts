/**
 * Story 15.1, AC 10. The login page's `returnTo` may only lead back to the authorize step. Anything else
 * is ignored and the login page behaves as before, so the parameter cannot become an open redirect.
 *
 * `raw` is the already-decoded query value (`URLSearchParams.get` decodes once); it is not decoded again.
 */
const AUTHORIZE_PREFIX = "/oauth/authorize?";

export const safeOAuthReturnTo = (raw: string | null | undefined): string | null => {
  if (!raw || !raw.startsWith(AUTHORIZE_PREFIX)) return null;
  if (raw.includes("\\") || raw.startsWith("//")) return null;
  // Control characters (tab, newline) are stripped by URL parsers and could reshape the target.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const resolved = new URL(raw, "http://returnto.invalid");
    if (resolved.origin !== "http://returnto.invalid" || resolved.pathname !== "/oauth/authorize") return null;
  } catch {
    return null;
  }
  return raw;
};
