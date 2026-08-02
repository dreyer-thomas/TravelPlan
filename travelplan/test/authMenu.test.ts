import { describe, expect, it } from "vitest";
import { getAuthMenuItems } from "@/lib/navigation/authMenu";

describe("getAuthMenuItems", () => {
  it("returns login and register when signed out", () => {
    const items = getAuthMenuItems(false);

    expect(items.map((item) => item.key)).toEqual(["login", "register"]);
  });

  /**
   * Story 6.20, AC2: the way back to all trips left the trip detail page's breadcrumb and became a
   * row of the global menu. Order is asserted, not just membership - the destination belongs above
   * the session action.
   */
  it("returns the trips destination and then sign out when signed in", () => {
    const items = getAuthMenuItems(true);

    expect(items.map((item) => item.key)).toEqual(["trips", "logout"]);
  });

  it("gives the trips entry an href so the menu renders it as a link", () => {
    const trips = getAuthMenuItems(true).find((item) => item.key === "trips");

    expect(trips).toEqual({ key: "trips", labelKey: "header.trips", href: "/trips" });
  });

  /**
   * AC3. `/trips` is behind the session, so an anonymous visitor must not be offered a row that can
   * only bounce off the login screen.
   */
  it("omits the trips destination when signed out", () => {
    expect(getAuthMenuItems(false).some((item) => item.key === "trips")).toBe(false);
  });
});
