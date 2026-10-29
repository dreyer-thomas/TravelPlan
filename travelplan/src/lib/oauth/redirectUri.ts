/**
 * Story 15.1, AC 8. A requested `redirect_uri` must equal a registered one exactly, with one exception:
 * a registered loopback URI (RFC 8252 §7.3) matches on any port, because Claude Code listens on an
 * ephemeral port and registers `http://localhost/callback` and `http://127.0.0.1/callback` without one.
 * Nothing else is relaxed: no prefix match, no trailing slash, no extra query.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

const parse = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const isLoopbackRedirectUri = (value: string) => {
  const url = parse(value);
  return url !== null && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
};

const sameExceptPort = (requested: URL, registered: URL) =>
  requested.protocol === registered.protocol &&
  requested.hostname === registered.hostname &&
  requested.pathname === registered.pathname &&
  requested.search === registered.search &&
  requested.hash === "" &&
  registered.hash === "" &&
  requested.username === "" &&
  requested.password === "";

export const matchesRegisteredRedirectUri = (requested: string, registered: readonly string[]) => {
  if (registered.includes(requested)) return parse(requested) !== null;
  const requestedUrl = parse(requested);
  if (!requestedUrl || !isLoopbackRedirectUri(requested)) return false;
  return registered.some((candidate) => {
    if (!isLoopbackRedirectUri(candidate)) return false;
    const registeredUrl = parse(candidate);
    return registeredUrl !== null && sameExceptPort(requestedUrl, registeredUrl);
  });
};
