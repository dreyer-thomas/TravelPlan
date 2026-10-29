/**
 * Story 15.1. A full navigation, possibly to another origin (the connector's OAuth redirect URI), which
 * the Next router cannot do. Its own module so component tests can replace it: jsdom does not implement
 * navigation and its `window.location` cannot be spied on.
 *
 * Only `http:` and `https:` targets (absolute or same-origin relative) are followed. The server already
 * restricts OAuth redirect URIs to https or loopback; this is the second line, so a `javascript:` or
 * `data:` URL can never run in this origin through here.
 */
export const isNavigableUrl = (url: string, base = "http://localhost") => {
  try {
    const protocol = new URL(url, base).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

export const assignLocation = (url: string) => {
  if (!isNavigableUrl(url, window.location.href)) {
    throw new Error("Refusing to navigate to a non-http(s) URL");
  }
  window.location.assign(url);
};
