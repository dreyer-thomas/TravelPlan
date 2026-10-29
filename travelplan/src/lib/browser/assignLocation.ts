/**
 * Story 15.1. A full navigation, possibly to another origin (the connector's OAuth redirect URI), which
 * the Next router cannot do. Its own module so component tests can replace it: jsdom does not implement
 * navigation and its `window.location` cannot be spied on.
 */
export const assignLocation = (url: string) => {
  window.location.assign(url);
};
