// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeaderMenu from "@/components/HeaderMenu";
import { emotionDeclarations, emotionDoubledSelectorDeclarations } from "./helpers/emotionStyles";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * The header menu's accessibility and revalidation contract: DW-97 / DW-140 (the trigger announces the
 * popup it opens), DW-129 (the current page is marked, and only the presentation is route-aware),
 * DW-128 (a session that expired while the tab sat open collapses the menu on the next open, and nothing
 * else does), DW-180 (every row holds the 44px floor *above* `sm`, which is where it used to be lost).
 *
 * Deliberately separate from `headerMenu{TripsEntry,AdminEntry,LanguageSwitcher}.test.tsx`: those three
 * pin *which rows exist* for a given audience and hold the pathname at `/` so that stays a question about
 * auth state alone. This suite is the only one that varies the route or the probe's answer.
 */

// The route is per-test state, so the mock factory has to read it late. `vi.hoisted` is what makes the
// object exist before `vi.mock`'s factory is hoisted above the imports.
const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => navigation.pathname,
}));

const OPEN_MENU = /open menu/i;
const HEADER_MENU_ID = "header-menu";
const LANGUAGE_MENU_ID = "header-language-menu";

/** What `/api/auth/csrf` answers with. Only `ok` and `json` are read by the component. */
type CsrfProbe = () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const envelope = (data: unknown, ok = true): CsrfProbe => async () => ({
  ok,
  json: async () => ({ data, error: null }),
});

/** The shape ~17 existing suites stub, and the shape a deployment older than DW-128 returns. */
const legacyProbe = envelope({ csrfToken: "test-token" });
const probeReporting = (authenticated: boolean) => envelope({ csrfToken: "test-token", authenticated });
const errorEnvelopeProbe: CsrfProbe = async () => ({
  ok: false,
  json: async () => ({ data: null, error: { code: "internal_error", message: "boom" } }),
});
const rejectingProbe: CsrfProbe = async () => {
  throw new Error("network down");
};

let probe: CsrfProbe = legacyProbe;
/**
 * How many probe *bodies* the component has taken delivery of (or failed to). Counting fetch calls would
 * be too early: the negative cases below assert that something did **not** happen, and an assertion made
 * before the response was read passes for the wrong reason.
 */
let probesSettled = 0;

beforeEach(() => {
  navigation.pathname = "/";
  probe = legacyProbe;
  probesSettled = 0;

  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/csrf")) {
      let response: { ok: boolean; json: () => Promise<unknown> };
      try {
        response = await probe();
      } catch (error) {
        probesSettled += 1;
        throw error;
      }
      return {
        ok: response.ok,
        json: async () => {
          probesSettled += 1;
          return response.json();
        },
      } as Response;
    }
    return { ok: true, json: async () => ({ data: null, error: null }) } as Response;
  }) as unknown as typeof fetch;
});

/**
 * Renders the menu and returns the trigger as a **node reference** rather than re-querying it.
 *
 * MUI's modal marks everything outside the portal `aria-hidden` while the menu is open, so a role query
 * for the trigger stops finding it the moment it matters - and "read the trigger's attributes while it is
 * open" is half of what DW-140 is about.
 */
const renderMenu = ({ isAuthenticated = true, isAdmin = false } = {}) => {
  const user = userEvent.setup();
  const view = renderWithProviders(<HeaderMenu isAuthenticated={isAuthenticated} isAdmin={isAdmin} />);
  const trigger = screen.getByRole("button", { name: OPEN_MENU });

  return { user, trigger, unmount: view.unmount };
};

const headerMenuElement = () => {
  const menu = document.getElementById(HEADER_MENU_ID);
  if (!menu) throw new Error(`No element carries id="${HEADER_MENU_ID}"`);
  return menu;
};

describe("HeaderMenu trigger announces its menu (DW-97, DW-140)", () => {
  it("says it opens a menu, and that the menu is closed, before anything is clicked", async () => {
    const { trigger } = renderMenu();
    // The mount probe is awaited even though nothing here depends on it: it settles into a `setState`, and
    // an unawaited one lands outside `act` and prints a warning against a test that is otherwise
    // synchronous.
    await waitFor(() => expect(probesSettled).toBe(1));

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Absent rather than empty while closed: mirrors the day hero's trigger, which gates `aria-controls`
    // on the anchor for exactly this reason - `keepMounted` leaves the list in the DOM, so a permanent
    // `aria-controls` would point at a list that is not there in any sense the user can act on.
    expect(trigger).not.toHaveAttribute("aria-controls");
    // The label is unchanged; the three attributes are additions to it, not a replacement.
    expect(trigger).toHaveAccessibleName("Open menu");
  });

  it("flips aria-expanded true and then false again, and points aria-controls at the menu it opens", async () => {
    const { user, trigger } = renderMenu();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The id is asserted through the DOM rather than against the literal: the point is that
    // `aria-controls` resolves to the element that actually holds the rows.
    expect(trigger.getAttribute("aria-controls")).toBe(HEADER_MENU_ID);
    const menu = headerMenuElement();
    expect(menu).toContainElement(screen.getByRole("menu"));
    expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThan(0);

    // …and the list the trigger names carries a name, from the trigger. Three attributes that say a menu
    // exists and whether it is open are worth little if the thing they open is announced as an unnamed
    // list of items - and the `id` added to the trigger is what supplies it, so this is also what stops
    // that `id` from being decoration.
    expect(screen.getByRole("menu")).toHaveAttribute("aria-labelledby", "header-menu-button");
    expect(screen.getByRole("menu")).toHaveAccessibleName("Open menu");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).not.toHaveAttribute("aria-controls");
  });
});

describe("HeaderMenu marks the current page (DW-129)", () => {
  it("marks the trips row, and only that row, on /trips", async () => {
    navigation.pathname = "/trips";
    const { user, trigger } = renderMenu({ isAdmin: true });

    await user.click(trigger);

    const menu = headerMenuElement();
    const trips = within(menu).getByRole("menuitem", { name: "All trips" });
    expect(trips).toHaveAttribute("aria-current", "page");
    // "MUI `selected`" is a class, not an aria attribute: `MenuItem` maps the prop to `Mui-selected` and
    // sets no `aria-selected` (that belongs to `role="option"`), so the class is the assertion.
    expect(trips).toHaveClass("Mui-selected");

    for (const row of within(menu).getAllByRole("menuitem")) {
      if (row === trips) continue;
      expect(row).not.toHaveAttribute("aria-current");
      expect(row).not.toHaveClass("Mui-selected");
    }
  });

  it("marks nothing on a nested route, where the row leads somewhere else", async () => {
    navigation.pathname = "/trips/abc";
    const { user, trigger } = renderMenu({ isAdmin: true });

    await user.click(trigger);

    const menu = headerMenuElement();
    for (const row of within(menu).getAllByRole("menuitem")) {
      expect(row).not.toHaveAttribute("aria-current");
      expect(row).not.toHaveClass("Mui-selected");
    }
    // Still a link to the trips list, and still reachable - 6.20 AC4 keeps the self-link, and the nested
    // route is not a reason to hide it either.
    expect(within(menu).getByRole("menuitem", { name: "All trips" })).toHaveAttribute("href", "/trips");
  });

  /**
   * The boundary the DW-129 decision drew: presentation may read the route, *content* may not. Asserted as
   * the whole row list on two different paths rather than as the presence of one row, because the failure
   * this guards against is a row quietly appearing or disappearing per page.
   */
  it("holds the same rows on /trips as anywhere else", async () => {
    const rowsOn = async (pathname: string) => {
      navigation.pathname = pathname;
      const { user, trigger, unmount } = renderMenu({ isAdmin: true });
      await user.click(trigger);
      const rows = within(headerMenuElement())
        .getAllByRole("menuitem")
        .map((row) => row.textContent);
      unmount();
      return rows;
    };

    expect(await rowsOn("/trips")).toEqual(await rowsOn("/some/other/page"));
  });

  /**
   * The marker is presentation, and this is the assertion that holds it to that. MUI's `Menu` defaults to
   * `variant="selectedMenu"`, under which `MenuList` moves initial focus onto the first `selected` child
   * and makes it the list's only tab stop - so marking the current row would silently reorder keyboard
   * entry into the menu, skipping the language row above it. `variant="menu"` is what keeps focus on the
   * list; without it this test fails with `activeElement` on the "All trips" anchor.
   */
  it("does not move keyboard focus onto the row it marks", async () => {
    navigation.pathname = "/trips";
    const { user, trigger } = renderMenu({ isAdmin: true });

    await user.click(trigger);

    const menu = headerMenuElement();
    const trips = within(menu).getByRole("menuitem", { name: "All trips" });
    // Focus is inside the popup - on the surface MUI's modal focuses, above the row list - and on no row
    // in particular. Asserted as "not a row" rather than against a specific node, because which container
    // holds it is MUI's business; that it is not the marked row is this change's.
    expect(document.activeElement).not.toBe(trips);
    expect(within(menu).getAllByRole("menuitem")).not.toContain(document.activeElement);
    expect(menu).toContainElement(document.activeElement as HTMLElement);
    // Nor is the row the list's sole tab stop, which is the other half of what `selectedMenu` would do.
    expect(trips).toHaveAttribute("tabindex", "-1");
  });
});

describe("HeaderMenu revalidates auth state when it opens (DW-128)", () => {
  it("collapses to login and register when the probe reports the session is gone", async () => {
    const { user, trigger } = renderMenu();

    // First open: the tab is healthy, and the probe says nothing either way.
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "All trips" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // The session expires while the tab sits there. Nothing re-renders, no prop changes - the only event
    // is the user reaching for the menu again, which is precisely why the mount-only fetch was useless.
    probe = probeReporting(false);
    await user.click(trigger);

    expect(await screen.findByRole("menuitem", { name: "Login" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("menuitem", { name: "Register" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "All trips" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument();
  });

  /**
   * The collapse unmounts rows under an open menu, so it must not unmount whatever holds focus. On
   * `/trips` that is the sharp case: the current-page row is the one the probe removes, and under MUI's
   * default `selectedMenu` variant it is also the row that would have been focused - leaving
   * `document.activeElement` on `<body>` with the menu still open. Focus belongs on the list, which
   * survives any change to the rows inside it.
   *
   * This does not claim the collapse is *announced*, or that a click already aimed at a row cannot land on
   * its replacement. Both are recorded as deferred work; this pins only that keyboard focus is not lost.
   */
  it("keeps keyboard focus inside the menu when the rows collapse under it", async () => {
    navigation.pathname = "/trips";
    const { user, trigger } = renderMenu();

    await user.click(trigger);
    await user.keyboard("{Escape}");

    probe = probeReporting(false);
    await user.click(trigger);
    await screen.findByRole("menuitem", { name: "Login" });

    expect(document.activeElement).not.toBe(document.body);
    expect(headerMenuElement()).toContainElement(document.activeElement as HTMLElement);
  });

  /**
   * One direction only, by contract. A probe that could turn the menu *on* would let this endpoint hand
   * the client a session state the server never rendered; the prop effect is what restores a true state,
   * on the next page load.
   */
  it("never promotes an anonymous menu, however emphatically the probe says otherwise", async () => {
    probe = probeReporting(true);
    const { user, trigger } = renderMenu({ isAuthenticated: false });

    await user.click(trigger);
    await waitFor(() => expect(probesSettled).toBe(2));

    expect(screen.getByRole("menuitem", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "All trips" })).not.toBeInTheDocument();
  });

  /**
   * The three no-conclusion cases from the I/O matrix. Each asserts an absence, so each waits for the
   * probe to have been *read* first - `probesSettled` reaching 2 means the mount probe and the open probe
   * both landed, and the collapse test above proves that a probe which does report `false` is acted on, so
   * these are not vacuous.
   */
  const survives = (description: string, failing: CsrfProbe) => {
    it(description, async () => {
      const { user, trigger } = renderMenu();

      probe = failing;
      await user.click(trigger);
      await waitFor(() => expect(probesSettled).toBe(2));

      expect(screen.getByRole("menuitem", { name: "All trips" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    });
  };

  survives("leaves the menu alone when the body carries no authenticated field at all", legacyProbe);
  survives("leaves the menu alone on a non-ok status with an error envelope", errorEnvelopeProbe);
  survives("leaves the menu alone when the fetch itself rejects", rejectingProbe);
});

describe("HeaderMenu rows declare the 44px floor at a specificity that survives sm (DW-180)", () => {
  /**
   * "Declare", not "measure", and the distinction is the whole of DW-180: jsdom evaluates no media queries
   * and performs no layout, so nothing in this file renders at 747px or reads a box. What it can do is read
   * the CSSOM and check that the floor is declared *above* the specificity of MUI's `sm` reset, which is
   * the property that made the browser number wrong. The 32.3px measurement above 600px that the ledger
   * records as owed is still owed; it cannot be discharged from here.
   *
   * Read at the doubled-class specificity `sx: { "&&": … }` emits, because `emotionDeclarations` matches
   * single-class selectors only and cannot see those rules at all.
   */
  const expectFloor = (row: Element) => {
    const declared = emotionDoubledSelectorDeclarations(row, "min-height");
    expect(declared.base).toContain("44px");
    // And nothing may take it away again above a breakpoint at that same specificity.
    for (const values of declared.media.values()) {
      for (const value of values) expect(value).toBe("44px");
    }
    // jsdom drops the media rules and keeps specificity, so this is the sub-`sm` cascade: 44 beats MUI's
    // unconditional 48.
    expect(getComputedStyle(row).minHeight).toBe("44px");
  };

  it("declares it on every row of the header menu, and not via some other compound rule", async () => {
    const { user, trigger } = renderMenu({ isAdmin: true });

    await user.click(trigger);

    const rows = within(headerMenuElement()).getAllByRole("menuitem");
    // Language, trips, user administration, sign out - the admin row included, because it is the
    // privileged navigation target DW-180 singles out as holding the floor on a phone and losing it on
    // every desktop.
    expect(rows).toHaveLength(4);
    for (const row of rows) expectFloor(row);
  });

  it("declares it on both rows of the language submenu", async () => {
    const { user, trigger } = renderMenu();

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: /language/i }));

    const submenu = document.getElementById(LANGUAGE_MENU_ID);
    expect(submenu).not.toBeNull();
    const rows = within(submenu as HTMLElement).getAllByRole("menuitem");
    expect(rows).toHaveLength(2);
    for (const row of rows) expectFloor(row);
  });

  /**
   * The mechanism itself, so the `&&` form is not mistaken for superstition: MUI's own `MenuItem` styles
   * still reset `min-height` to `auto` above `sm`, and they sit in the same emotion class at *one* class of
   * specificity. A bare `sx={{ minHeight: 44 }}` would land at that same specificity and lose on source
   * order, which is the whole of DW-180.
   *
   * If this one ever fails, MUI stopped resetting - and the doubled selector can be reconsidered rather
   * than the floor.
   */
  it("still has MUI's sm reset underneath it, at one class of specificity", async () => {
    const { user, trigger } = renderMenu();

    await user.click(trigger);

    const row = within(headerMenuElement()).getByRole("menuitem", { name: "All trips" });
    // `emotionDeclarations` matches single-class selectors only, so everything it returns is (0,1,0).
    const singleClass = emotionDeclarations(row, "min-height");
    expect(singleClass.base).toContain("48px");
    expect([...singleClass.media.values()].flat()).toContain("auto");
    // …and the 44 is not among them, which is what proves the floor is declared above that specificity
    // rather than beside it.
    expect(singleClass.base).not.toContain("44px");
  });
});

describe("LanguageSwitcherMenuItem announces its submenu", () => {
  it("says the row opens a menu, and flips aria-expanded when it does", async () => {
    const { user, trigger } = renderMenu();

    await user.click(trigger);

    const languageRow = await screen.findByRole("menuitem", { name: /language/i });
    expect(languageRow).toHaveAttribute("aria-haspopup", "menu");
    expect(languageRow).toHaveAttribute("aria-expanded", "false");
    expect(languageRow).not.toHaveAttribute("aria-controls");

    await user.click(languageRow);

    expect(languageRow).toHaveAttribute("aria-expanded", "true");
    // …and the id it names is the submenu that actually holds the two languages, not a literal nobody
    // renders.
    expect(languageRow.getAttribute("aria-controls")).toBe(LANGUAGE_MENU_ID);
    const submenu = document.getElementById(LANGUAGE_MENU_ID);
    expect(submenu).not.toBeNull();
    expect(within(submenu as HTMLElement).getAllByRole("menuitem")).toHaveLength(2);
    // Named by the row that opened it, the same way the header menu is named by the hamburger.
    const submenuList = within(submenu as HTMLElement).getByRole("menu");
    expect(languageRow.id).toBeTruthy();
    expect(submenuList).toHaveAttribute("aria-labelledby", languageRow.id);
    // The name is checked through that reference rather than as a literal: the row's visible text carries
    // the current language too ("Language  English (EN)"), so pinning the whole computed string here would
    // make this a test of the row's copy.
    expect(languageRow.textContent).toContain("Language");
  });
});
