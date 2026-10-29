/**
 * The caller's address for rate-limit keys: the first `x-forwarded-for` entry Nginx sets, else
 * `x-real-ip`, else `"unknown"` (callers skip the limit then, as the login route does). The same logic is
 * still inlined in the login, first-login and reset routes; new routes use this one.
 */
export const getClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
};
