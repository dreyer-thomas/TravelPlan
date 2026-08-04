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
  key: "trips" | "admin" | "login" | "register" | "logout";
  labelKey: string;
  href?: string;
};

/**
 * Story 5.10 turned the two positional booleans this would otherwise take into one named argument.
 *
 * `getAuthMenuItems(true, false)` reads as nothing at a call site, and the specific mistake it invites -
 * transposing the two - is the one that hands the administration row to every signed-in account. The
 * object makes both values say what they are at the only place they are passed.
 */
export type AuthMenuState = {
  isAuthenticated: boolean;
  /**
   * Whether the caller holds `UserRole.ADMIN`. Resolved by a live database read in `AppHeader` rather than
   * from the session token, whose `role` claim is a seven-day snapshot - so a promotion or a revocation
   * shows up in this menu on the next page load rather than at the next sign-in.
   */
  isAdmin: boolean;
};

export const getAuthMenuItems = ({ isAuthenticated, isAdmin }: AuthMenuState): AuthMenuItem[] => {
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
      // Story 5.10, AC2. It sits here because it is the same shape as `trips`: a destination that needs no
      // trip context, which is precisely the line stories 6.19 and 6.20 drew for what may live in the
      // global menu - `/admin/users` is a constant, not a `/trips/${tripId}`.
      //
      // Additionally gated, and gated *here* rather than by the menu component, so that "who sees this
      // row" is one expression in the file that decides what the menu is. Everyone who is not an admin
      // gets the identical two-row list they had before this story.
      //
      // Hiding the row is presentation only. The page re-reads the role and every `/api/admin/*` route
      // calls `requireAdmin` - a menu that merely omits an option is not a guard.
      ...(isAdmin ? [{ key: "admin" as const, labelKey: "header.userAdmin", href: "/admin/users" }] : []),
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
