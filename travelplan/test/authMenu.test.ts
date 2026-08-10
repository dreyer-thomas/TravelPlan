import { describe, expect, it } from "vitest";
import { getAuthMenuItems, type AuthMenuItem } from "@/lib/navigation/authMenu";

describe("getAuthMenuItems", () => {
  it("returns login and register when signed out", () => {
    const items = getAuthMenuItems({ isAuthenticated: false, isAdmin: false });

    expect(items.map((item) => item.key)).toEqual(["login", "register"]);
  });

  /**
   * Story 6.20, AC2: the way back to all trips left the trip detail page's breadcrumb and became a
   * row of the global menu. Order is asserted, not just membership - the destination belongs above
   * the session action.
   */
  it("returns the trips destination and then sign out when signed in", () => {
    const items = getAuthMenuItems({ isAuthenticated: true, isAdmin: false });

    expect(items.map((item) => item.key)).toEqual(["trips", "logout"]);
  });

  it("gives the trips entry an href so the menu renders it as a link", () => {
    const trips = getAuthMenuItems({ isAuthenticated: true, isAdmin: false }).find((item) => item.key === "trips");

    expect(trips).toEqual({ kind: "destination", key: "trips", labelKey: "header.trips", href: "/trips" });
  });

  /**
   * DW-127's guarantee, as a checked assertion rather than a claim: `tsconfig.json` includes `test/**`, so
   * `npm run typecheck` compiles this file and the expect-error below fails the build if the destination
   * arm ever stops requiring `href`. An *unused* `@ts-expect-error` is itself an error, which is what
   * makes this a test and not a comment.
   *
   * The `expect`s below are not the test - they exercise no production code, and exist only so the two
   * bindings are read and neither the compiler nor the linter reports them unused. `tsc` is the assertion.
   */
  it("cannot describe a destination without somewhere to go", () => {
    const item: AuthMenuItem = { kind: "destination", key: "trips", labelKey: "header.trips", href: "/trips" };

    // @ts-expect-error - a destination without `href` is exactly the shape that used to render as `#`.
    const missingHref: AuthMenuItem = { kind: "destination", key: "trips", labelKey: "header.trips" };

    expect(item.kind).toBe("destination");
    expect(missingHref.kind).toBe("destination");
  });

  /**
   * AC3. `/trips` is behind the session, so an anonymous visitor must not be offered a row that can
   * only bounce off the login screen.
   */
  it("omits the trips destination when signed out", () => {
    expect(getAuthMenuItems({ isAuthenticated: false, isAdmin: false }).some((item) => item.key === "trips")).toBe(
      false,
    );
  });

  /**
   * Story 5.10, AC2: the administration entry point is this menu, and it is visible **only** to an admin.
   * Everyone else sees the menu exactly as it is today - which is what the two negative cases below assert,
   * by full list equality rather than by absence of the one key, so an accidental extra row fails too.
   */
  describe("story 5.10 administration entry", () => {
    it("offers the administration destination to an admin, above sign out", () => {
      const items = getAuthMenuItems({ isAuthenticated: true, isAdmin: true });

      expect(items.map((item) => item.key)).toEqual(["trips", "admin", "logout"]);
    });

    it("points it at the administration page", () => {
      const admin = getAuthMenuItems({ isAuthenticated: true, isAdmin: true }).find((item) => item.key === "admin");

      expect(admin).toEqual({ kind: "destination", key: "admin", labelKey: "header.userAdmin", href: "/admin/users" });
    });

    it("leaves a signed-in non-admin's menu exactly as it was", () => {
      expect(getAuthMenuItems({ isAuthenticated: true, isAdmin: false }).map((item) => item.key)).toEqual([
        "trips",
        "logout",
      ]);
    });

    /**
     * The combination that cannot happen but must not be trusted not to: `isAdmin` is resolved from a
     * database read in `AppHeader`, and a caller passing it without the session is asking for a menu row
     * that leads behind the login wall. Authentication is the outer condition.
     */
    it("offers nothing extra to an anonymous caller claiming to be an admin", () => {
      expect(getAuthMenuItems({ isAuthenticated: false, isAdmin: true }).map((item) => item.key)).toEqual([
        "login",
        "register",
      ]);
    });
  });
});
