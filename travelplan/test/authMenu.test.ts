import { describe, expect, it } from "vitest";
import { getAuthMenuItems } from "@/lib/navigation/authMenu";

describe("getAuthMenuItems", () => {
  it("returns login and register when signed out", () => {
    const items = getAuthMenuItems(false);

    expect(items.map((item) => item.key)).toEqual(["login", "register"]);
  });

  it("returns sign out when signed in", () => {
    const items = getAuthMenuItems(true);

    expect(items.map((item) => item.key)).toEqual(["logout"]);
  });
});
