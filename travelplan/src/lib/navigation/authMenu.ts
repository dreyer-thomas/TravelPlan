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
 *
 * A discriminated union on `kind` rather than one shape with an optional `href` - DW-127. `href?: string`
 * left the invariant `HeaderMenu` actually depends on ("anything that is not `logout` has somewhere to
 * go") enforced by nothing but the renderer's `item.key === "logout"` test and a `?? "#"` fallback, so the
 * next *action* added here would have rendered as an anchor to `#` that silently does nothing. Now a
 * destination cannot be written without an `href` and an action cannot carry one, the renderer branches on
 * shape instead of on a key literal, and the fallback is gone.
 *
 * The alternative was leaving the shape alone and asserting the invariant in a test. Rejected: a test
 * covers the items that exist today, and the failure mode is the item somebody adds tomorrow.
 */
export type AuthMenuItem =
  | {
      kind: "destination";
      key: "trips" | "admin" | "login" | "register";
      labelKey: string;
      href: string;
    }
  | {
      kind: "action";
      key: "logout";
      labelKey: string;
    };

/**
 * The keys a menu *action* can have, derived from the union rather than restated - `HeaderMenu` keys its
 * handler map on this, so adding an action to `getAuthMenuItems` without a handler is a compile error
 * (DW-127) instead of a row that renders and does nothing.
 */
export type AuthMenuActionKey = Extract<AuthMenuItem, { kind: "action" }>["key"];

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
    //
    // Still true of *content*, and only of content: DW-129's 2026-08-08 decision lets `HeaderMenu`
    // call `usePathname()` to mark the matching row `aria-current="page"` + MUI `selected`. That is
    // presentation, and this list stays route-blind - which is why the pathname is read there and
    // never passed in here.
    return [
      { kind: "destination", key: "trips", labelKey: "header.trips", href: "/trips" },
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
      ...(isAdmin
        ? [{ kind: "destination" as const, key: "admin" as const, labelKey: "header.userAdmin", href: "/admin/users" }]
        : []),
      { kind: "action", key: "logout", labelKey: "auth.logout" },
    ];
  }

  // No trips entry here, and that is the whole of Story 6.20's AC3: `/trips` is behind the session,
  // so for an anonymous visitor the row could only bounce off the login screen.
  return [
    { kind: "destination", key: "login", labelKey: "auth.login", href: "/auth/login" },
    { kind: "destination", key: "register", labelKey: "auth.register", href: "/auth/register" },
  ];
};
