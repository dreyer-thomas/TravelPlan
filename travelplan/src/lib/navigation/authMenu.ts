/**
 * The global header menu's item list.
 *
 * Story 6.20 added `trips`, so this is no longer a list of *authentication* actions alone - the name
 * `AuthMenuItem` now means "an item of the auth-driven menu" rather than "an item that logs you in
 * or out". The type is deliberately not renamed: what it is built from is unchanged (auth state and
 * nothing else), which is the property the epic's "the global header menu stays auth-driven" rule
 * cares about. The name is the only thing that no longer fits, and nothing outside this file reads
 * it - `HeaderMenu` imports the function, not the type - so a rename stays cheap whenever it is
 * wanted.
 *
 * The line a destination must not cross is trip- or day-scoped state: `/trips` is a constant, so it
 * fits here, while `/trips/${tripId}` needs an id this function does not have and must not learn -
 * that target lives in the day page's own overflow menu (stories 6.11 and 6.19).
 */
export type AuthMenuItem = {
  key: "trips" | "login" | "register" | "logout";
  labelKey: string;
  href?: string;
};

export const getAuthMenuItems = (isAuthenticated: boolean): AuthMenuItem[] => {
  if (isAuthenticated) {
    // Destination first, session action last: `/trips` is somewhere to go, `logout` ends the
    // session, and a list that mixes the two reads better with the navigation above the exit.
    //
    // Story 6.20 AC4, decided here so it is not re-litigated: the row is kept on `/trips` itself,
    // where it links to the page already shown, rather than hidden with `usePathname()`. This list
    // is a function of one boolean, and making it a function of the route as well is the coupling
    // stories 6.11 and 6.15 refused; a menu whose rows appear and disappear per page is also harder
    // to learn than one with a fixed shape, and a same-route navigation costs the user nothing.
    return [
      { key: "trips", labelKey: "header.trips", href: "/trips" },
      { key: "logout", labelKey: "auth.logout" },
    ];
  }

  // No trips entry here, and that is the whole of Story 6.20's AC3: `/trips` is behind the session,
  // so for an anonymous visitor the row could only bounce off the login screen.
  return [
    { key: "login", labelKey: "auth.login", href: "/auth/login" },
    { key: "register", labelKey: "auth.register", href: "/auth/register" },
  ];
};
