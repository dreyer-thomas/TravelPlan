// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersList, { type AdminUser } from "@/components/features/admin/AdminUsersList";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 5.10's client surface.
 *
 * The route suites prove the rules; this proves that the surface *shows* the two relations apart (AC3) and
 * that its actions send what the routes expect. jsdom lays nothing out, so nothing here is a claim about
 * how the list looks - that is Task 7's browser pass.
 */

type Call = { path: string; method: string; body: unknown };

const ADMIN_ID = "user-admin";

/**
 * The fixture's shape, spelled out rather than inferred from `USERS`.
 *
 * `stubFetch`'s option was `users?: typeof USERS`, and `typeof USERS` narrows `role` to the literals that
 * happen to appear in the default array — every membership there is a `VIEWER`, so the two cases that pass
 * a `CONTRIBUTOR` fixture did not typecheck. It was one of the suite's pre-existing type errors and it made
 * the fixture type *lie about what the component accepts*, which matters here: the role a membership holds
 * is exactly what the role select and the no-op guard turn on.
 *
 * **Review of 5.11 replaced the hand-written clone with the real type.** The structural duplicate that
 * stood here fixed the lie but could drift into the same lie the next time `AdminUser` changed shape.
 * `AdminUser` and `AdminMembership` are exported from the component now, so the fixture is checked
 * against what the component actually accepts and the `as const` on each `role` is no longer needed.
 */
type FixtureUser = AdminUser;

const USERS: FixtureUser[] = [
  {
    id: ADMIN_ID,
    email: "admin@example.com",
    role: "ADMIN" as const,
    ownedTrips: [],
    memberships: [],
  },
  {
    id: "user-both",
    email: "both@example.com",
    role: "OWNER" as const,
    // The arrangement AC3 exists for: one account holding both relations at once.
    ownedTrips: [{ id: "trip-own", name: "Own Trip" }],
    memberships: [
      { id: "member-1", tripId: "trip-stranger", tripName: "Stranger Trip", role: "VIEWER" as const },
    ],
  },
  {
    id: "user-nobody",
    email: "nobody@example.com",
    role: "OWNER" as const,
    ownedTrips: [],
    memberships: [],
  },
];

const TRIPS = [
  { id: "trip-own", name: "Own Trip", ownerEmail: "both@example.com" },
  { id: "trip-stranger", name: "Stranger Trip", ownerEmail: "stranger@example.com" },
];

/**
 * Routes `/api/auth/csrf`, `/api/admin/users` and every mutation, recording the mutations so each action
 * can be asserted on what it actually sent.
 *
 * `mutationResult` lets one test at a time make the write fail with a given code, which is how the refusal
 * messages - AC7's named trips especially - are reached at all.
 */
const stubFetch = (
  options: {
    users?: FixtureUser[];
    trips?: typeof TRIPS;
    listError?: { status: number; code: string };
    mutationResult?: { status: number; code: string; details?: unknown };
  } = {},
) => {
  const calls: Call[] = [];

  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    if (path === "/api/auth/csrf") {
      return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "test-token" }, error: null }) };
    }

    if (path === "/api/admin/users" && method === "GET") {
      if (options.listError) {
        return {
          ok: false,
          status: options.listError.status,
          json: async () => ({ data: null, error: { code: options.listError!.code, message: "no" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { users: options.users ?? USERS, trips: options.trips ?? TRIPS },
          error: null,
        }),
      };
    }

    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (options.mutationResult) {
      return {
        ok: false,
        status: options.mutationResult.status,
        json: async () => ({
          data: null,
          error: {
            code: options.mutationResult!.code,
            message: "no",
            details: options.mutationResult!.details,
          },
        }),
      };
    }

    return { ok: true, status: 200, json: async () => ({ data: { ok: true }, error: null }) };
  });

  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return { calls };
};

const renderList = () => renderWithProviders(<AdminUsersList currentUserId={ADMIN_ID} />);

const rowFor = async (email: string) => {
  const cell = await screen.findByText(email);
  const row = cell.closest("li");
  if (!row) throw new Error(`No row for ${email}`);
  return row as HTMLElement;
};

/**
 * Story 5.11 moved attach, grant/revoke and delete off the row and into an overflow menu, so every case
 * that used to click one of those three now opens the menu first.
 *
 * The menu is rendered **once for the whole list** and portalled outside the row, so its items are reached
 * through `screen` rather than `within(row)` — a `within(row)` query would find nothing and read like the
 * item was missing rather than like it lives elsewhere. The trigger is per row and named per account, which
 * is what keeps this unambiguous with three rows on screen.
 */
const openRowMenu = async (user: ReturnType<typeof userEvent.setup>, email: string) => {
  const row = await rowFor(email);
  await user.click(within(row).getByRole("button", { name: `More actions for ${email}` }));
  return screen.getByRole("menu");
};

/** Opens the row menu and clicks one of its three items. */
const clickRowMenuItem = async (
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  item: string | RegExp,
) => {
  const menu = await openRowMenu(user, email);
  await user.click(within(menu).getByRole("menuitem", { name: item }));
};

describe("AdminUsersList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("heads the page and shows a spinner while the fetch is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);

    renderList();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // The card title is the page's only heading, so it has to be one.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("User administration");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists every account with a count", async () => {
    stubFetch();
    renderList();

    expect(await screen.findByText("Accounts (3)")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("both@example.com")).toBeInTheDocument();
    expect(screen.getByText("nobody@example.com")).toBeInTheDocument();
  });

  /**
   * **AC3, and the reason this suite exists.** Ownership and membership have to read as two different
   * things on the same row: the owned trip under "Owns", the membership under "Shared with" and carrying
   * its own role. If the surface merged them, the detach action would be offered for a trip the account
   * owns - where it means nothing - and AC7's deletion refusal would have no visible cause.
   */
  it("shows an account's owned trips and its memberships under different labels", async () => {
    stubFetch();
    renderList();

    const row = await rowFor("both@example.com");

    expect(within(row).getByText(/Owns/)).toBeInTheDocument();
    expect(within(row).getByText(/Own Trip/)).toBeInTheDocument();

    /*
      Story 5.11. The membership half is a table now, not a "Shared with X · Role" line, so the assertion
      moved with it: the trip is a cell and the role is the value of that row's select. The section is
      titled "Shares" - a different word from the "Shared with" prefix it replaced, which is why this case
      had to change rather than merely being re-queried.
    */
    const shares = within(row).getByRole("table", { name: "Shares of both@example.com" });
    expect(within(shares).getByRole("columnheader", { name: "Trip" })).toBeInTheDocument();
    expect(within(shares).getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(within(shares).getByRole("cell", { name: "Stranger Trip" })).toBeInTheDocument();
    expect(
      within(shares).getByRole("combobox", { name: "Role for Stranger Trip (both@example.com)" }),
    ).toHaveTextContent("Viewer");

    /*
      And AC3's actual claim, which survives the restyle: the owned trip is **not** in the shares table.
      A merged surface would satisfy every assertion above while showing one relation - the failure this
      case exists to catch - so the negative is what carries it.

      Review of 5.11 changed two things here. The matcher is a **regex**: Testing Library's default is
      exact equality on normalised text, so a merged cell rendering "Own Trip · Owner" would have
      satisfied `queryByText("Own Trip")` while committing precisely this failure. And the line that
      followed - `expect(getByText(/Owns/)).not.toBe(shares)` - was removed rather than kept: it compared
      a `<span>` against a `<table>` and could not fail under any change to the component.
    */
    expect(within(shares).queryByText(/Own Trip/)).toBeNull();
  });

  /**
   * Review of 5.11: an account with neither relation used to say so **twice**, in two different nouns -
   * "No trips" from the ownership line and "No shares" from the table's empty state - on the surface
   * whose whole job is that the two relations read as distinct. Two cases each pinned one half against
   * this same fixture row and neither noticed the pair. The ownership line now answers only for
   * ownership, so both halves are asserted here, together, in the words they actually use.
   */
  it("says what an account owns and what is shared with it, separately, when it has neither", async () => {
    stubFetch();
    renderList();

    const row = await rowFor("nobody@example.com");
    expect(within(row).getByText("Owns no trips")).toBeInTheDocument();
    expect(within(row).getByText("No shares")).toBeInTheDocument();
    // And not the old merged sentence, which answered for both at once.
    expect(within(row).queryByText("No trips")).toBeNull();
  });

  /**
   * Review of 5.11, and the case the suite was missing. **One trip shared with two accounts** is the
   * ordinary arrangement on this surface, and it is the one the existing AC7 cases cannot see: they all
   * query `within(row)`, which makes two names distinct as long as the *trips* differ.
   *
   * `roleToggleFor` named the account and the trip; 5.11 replaced it with `roleForTrip`, which named only
   * the trip — so two rows sharing one trip rendered two comboboxes with the identical accessible name,
   * indistinguishable to a screen reader and to `getByRole`. That is exactly the defect 5.10's review
   * added the email for, and AC7 says the restyle "must not weaken them".
   *
   * Verified to fail before the fix: `getAllByRole` returned two elements for one name.
   */
  it("gives every role select on the page a distinct name when one trip is shared with two accounts", async () => {
    const shared = { id: "trip-shared", tripId: "trip-shared", tripName: "Shared Trip", role: "VIEWER" as const };
    stubFetch({
      users: [
        {
          id: "user-alice",
          email: "alice@example.com",
          role: "OWNER" as const,
          ownedTrips: [],
          memberships: [{ ...shared, id: "m-alice" }],
        },
        {
          id: "user-bob",
          email: "bob@example.com",
          role: "OWNER" as const,
          ownedTrips: [],
          memberships: [{ ...shared, id: "m-bob" }],
        },
      ],
      trips: [{ id: "trip-shared", name: "Shared Trip", ownerEmail: "stranger@example.com" }],
    });
    renderList();

    // Page scope, deliberately: no `within(row)`, because the row scope is what hid this.
    await screen.findByText("alice@example.com");
    expect(screen.getByRole("combobox", { name: "Role for Shared Trip (alice@example.com)" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for Shared Trip (bob@example.com)" })).toBeInTheDocument();

    // The tables themselves too: `aria-labelledby` pointed at a per-row id whose *text* was "Shares" for
    // every account, so one page carried N tables with one accessible name.
    expect(screen.getByRole("table", { name: "Shares of alice@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Shares of bob@example.com" })).toBeInTheDocument();

    // And the trash glyphs, which kept their names through the restyle — asserted so the page-scope
    // guarantee covers all three controls rather than only the one that regressed.
    expect(screen.getAllByRole("button", { name: /remove.*Shared Trip/i })).toHaveLength(2);
  });

  /**
   * AC3's second entry point. Every other attach case routes through the row menu, so the `+` above the
   * shares table — the control AC3 exists for — was never pressed. Also pins the visually-hidden action
   * column header, which nothing asserted.
   */
  it("opens the attach dialog from the shares table's own plus, and names the action column", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderList();

    const row = await rowFor("both@example.com");
    const shares = within(row).getByRole("table", { name: "Shares of both@example.com" });
    expect(within(shares).getByRole("columnheader", { name: "Action" })).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Add both@example.com to a trip" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add both@example.com to a trip" })).toBeInTheDocument();
  });

  it("marks the admin's own row and badges the admin role", async () => {
    stubFetch();
    renderList();

    const adminRow = await rowFor("admin@example.com");
    // Both matter before a click rather than in an error afterwards: self-deletion is refused outright, and
    // the last-admin rule is most often met by demoting yourself.
    expect(within(adminRow).getByText("Admin")).toBeInTheDocument();
    expect(within(adminRow).getByText("You")).toBeInTheDocument();

    const otherRow = await rowFor("both@example.com");
    expect(within(otherRow).queryByText("Admin")).toBeNull();
    expect(within(otherRow).queryByText("You")).toBeNull();
  });

  it("renders the blocked state from a forbidden list read", async () => {
    // Reachable when the role is revoked between the page's server-side gate and this fetch, which is why
    // that gate is not the only one.
    stubFetch({ listError: { status: 403, code: "forbidden" } });
    renderList();

    expect(await screen.findByText("Only administrators can manage accounts.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders an error for a failed list read", async () => {
    stubFetch({ listError: { status: 500, code: "server_error" } });
    renderList();

    expect(await screen.findByText("Unable to load accounts. Please refresh.")).toBeInTheDocument();
  });

  describe("grant and revoke (AC8a)", () => {
    it("offers grant on a non-admin and revoke on an admin, and sends the matching flag", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      // Story 5.11: the item's label is what says which direction it will send, and it is read off
      // `menuUser` - so opening the menu on a non-admin and on an admin has to offer opposite words.
      await clickRowMenuItem(user, "both@example.com", "Make administrator");

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toEqual({
        path: "/api/admin/users/user-both",
        method: "PATCH",
        body: { isAdmin: true },
      });

      await clickRowMenuItem(user, "admin@example.com", "Remove administrator");

      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].body).toEqual({ isAdmin: false });
    });

    /**
     * Story 5.11. One menu serves every row, driven by `menuUser`, so "which account did I open this on"
     * is state rather than structure - and getting it wrong would send a grant to the wrong account with
     * nothing on screen to show it. Pinned here because the previous per-row buttons could not have this
     * defect at all.
     */
    it("offers the item for the account whose glyph was pressed, not the previous one", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      const adminMenu = await openRowMenu(user, "admin@example.com");
      expect(within(adminMenu).getByRole("menuitem", { name: "Remove administrator" })).toBeInTheDocument();
      await user.keyboard("{Escape}");

      const otherMenu = await openRowMenu(user, "both@example.com");
      expect(within(otherMenu).getByRole("menuitem", { name: "Make administrator" })).toBeInTheDocument();
      expect(within(otherMenu).queryByRole("menuitem", { name: "Remove administrator" })).toBeNull();
    });

    it("shows the last-admin refusal as its own message", async () => {
      const { calls } = stubFetch({ mutationResult: { status: 409, code: "last_admin" } });
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "admin@example.com", "Remove administrator");

      // Not the generic "unable to change the role": the admin needs to know the installation refused it,
      // not that something went wrong.
      expect(await screen.findByText("At least one administrator must remain.")).toBeInTheDocument();
      expect(calls).toHaveLength(1);
    });
  });

  describe("attach, role change and detach (AC5, AC6)", () => {
    /**
     * Story 5.11 turned the role toggle into a select, so the request now carries the value the admin
     * *picked* rather than the opposite of the value shown. The membership is a VIEWER here, so picking
     * "Contributor" is a real change.
     */
    it("sends the role picked from the row's select", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      const row = await rowFor("both@example.com");
      await user.click(within(row).getByRole("combobox", { name: "Role for Stranger Trip (both@example.com)" }));
      await user.click(await screen.findByRole("option", { name: "Contributor" }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toEqual({
        path: "/api/admin/users/user-both/memberships",
        method: "POST",
        body: { tripId: "trip-stranger", role: "CONTRIBUTOR" },
      });
    });

    /**
     * The other half of turning a toggle into a select, and the reason `changeMembershipRole` guards on
     * the value being different: the request is an **upsert**, so re-picking the role a membership already
     * holds would spend a write and a full list reload to arrive back where it started.
     */
    it("sends nothing when the role already showing is picked again", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      const row = await rowFor("both@example.com");
      await user.click(within(row).getByRole("combobox", { name: "Role for Stranger Trip (both@example.com)" }));
      await user.click(await screen.findByRole("option", { name: "Viewer" }));

      // Given a moment in which the request would have been sent, had one been sent.
      await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
      expect(calls).toHaveLength(0);
    });

    /**
     * Story 5.11. Removing a share is confirmed now — the control is a trash glyph carrying no word for
     * what it costs, which is the trade Story 6.24 made on the activity dialog's delete. So the click
     * alone must send nothing.
     */
    it("asks before removing a share, then detaches the trip named on that row and nothing else", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      const row = await rowFor("both@example.com");
      await user.click(
        within(row).getByRole("button", { name: "Remove both@example.com from Stranger Trip" }),
      );

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/loses access to Stranger Trip/)).toBeInTheDocument();
      // 6.25 AC3: the safe half names what it preserves, in the same noun as its neighbour.
      expect(within(dialog).getByRole("button", { name: "Keep share" })).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      await user.click(within(dialog).getByRole("button", { name: "Remove share" }));

      await waitFor(() => expect(calls).toHaveLength(1));
      // `trip-stranger`, the membership - never `trip-own`, which this account owns. AC6's second sentence.
      expect(calls[0]).toEqual({
        path: "/api/admin/users/user-both/memberships",
        method: "DELETE",
        body: { tripId: "trip-stranger" },
      });
    });

    it("sends nothing when the admin keeps the share", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      const row = await rowFor("both@example.com");
      await user.click(
        within(row).getByRole("button", { name: "Remove both@example.com from Stranger Trip" }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Keep share" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(calls).toHaveLength(0);
    });

    /** The empty state the table degrades to, which the old one-line-per-membership layout had no need of. */
    it("says so when an account holds no shares", async () => {
      stubFetch();
      renderList();

      const row = await rowFor("nobody@example.com");
      expect(within(row).getByText("No shares")).toBeInTheDocument();
      expect(within(row).queryByRole("table")).toBeNull();
    });

    it("does not offer a trip the account already owns in the attach picker", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "both@example.com", "Add to trip");

      await user.click(await screen.findByRole("combobox", { name: "Trip" }));
      const options = await screen.findAllByRole("option");

      // Attaching an owner to their own trip is refused server-side, so offering it would be offering a
      // certain failure.
      const labels = options.map((option) => option.textContent);
      expect(labels.some((label) => label?.includes("Stranger Trip"))).toBe(true);
      expect(labels.some((label) => label?.includes("Own Trip"))).toBe(false);
    });

    it("names each trip's owner in the picker, because names are not unique", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "nobody@example.com", "Add to trip");
      await user.click(await screen.findByRole("combobox", { name: "Trip" }));

      expect(await screen.findByRole("option", { name: /Stranger Trip · stranger@example.com/ })).toBeInTheDocument();
    });
  });

  describe("delete (AC7)", () => {
    it("asks first, with both buttons and the safe one naming what it keeps", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "both@example.com", "Delete account");

      const dialog = await screen.findByRole("dialog");
      // Story 6.25 AC3: two outcomes about one object, in the same noun.
      expect(within(dialog).getByRole("button", { name: "Keep account" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Delete account" })).toBeInTheDocument();
      // And the dialog's own dismissal is the title-row glyph, per 6.25.
      expect(within(dialog).getByTestId("dialog-close")).toBeInTheDocument();
    });

    it("sends nothing when the admin keeps the account", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "both@example.com", "Delete account");
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Keep account" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(calls).toHaveLength(0);
    });

    it("deletes on confirmation", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "both@example.com", "Delete account");
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete account" }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ path: "/api/admin/users/user-both", method: "DELETE" });
    });

    /**
     * **AC7's refusal, as the admin actually experiences it.** The blocking trips are named in the message
     * and the dialog stays open holding it - the admin asked here and is answered here, rather than the
     * reason being dropped into the page behind a dialog that closed.
     */
    it("names the blocking trips when the account owns some", async () => {
      stubFetch({
        mutationResult: {
          status: 409,
          code: "owns_trips",
          details: { tripNames: ["Norwegen 2027", "Island 2028"] },
        },
      });
      const user = userEvent.setup();
      renderList();

      await clickRowMenuItem(user, "both@example.com", "Delete account");
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete account" }));

      expect(
        await screen.findByText(/owns these trips and cannot be deleted: Norwegen 2027, Island 2028/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("reports the self-deletion refusal in its own words", async () => {
      stubFetch({ mutationResult: { status: 409, code: "self_delete" } });
      const user = userEvent.setup();
      renderList();

      // The item is offered on the admin's own row rather than hidden: the refusal carries a reason worth
      // reading, and a hidden item teaches nothing.
      await clickRowMenuItem(user, "admin@example.com", "Delete account");
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete account" }));

      expect(await screen.findByText("You cannot delete your own account here.")).toBeInTheDocument();
    });
  });

  describe("create (AC4)", () => {
    it("sends the email and temporary password", async () => {
      const { calls } = stubFetch();
      const user = userEvent.setup();
      renderList();

      await user.click(await screen.findByRole("button", { name: "Add account" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Email"), "newcomer@example.com");
      await user.type(within(dialog).getByLabelText(/Temporary password/), "temporary-password");
      await user.click(within(dialog).getByRole("button", { name: "OK" }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toEqual({
        path: "/api/admin/users",
        method: "POST",
        body: { email: "newcomer@example.com", temporaryPassword: "temporary-password" },
      });
    });

    it("says that the account must change the password on first sign-in", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      await user.click(await screen.findByRole("button", { name: "Add account" }));

      // AC4 sets `mustChangePassword`, and that is what makes a readable temporary password safe to type
      // here - so the form says it rather than leaving the admin to assume either way.
      expect(await screen.findByText("The account must change it on first sign-in.")).toBeInTheDocument();
    });

    it("reports a duplicate address distinctly", async () => {
      stubFetch({ mutationResult: { status: 409, code: "email_exists" } });
      const user = userEvent.setup();
      renderList();

      await user.click(await screen.findByRole("button", { name: "Add account" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Email"), "taken@example.com");
      await user.type(within(dialog).getByLabelText(/Temporary password/), "temporary-password");
      await user.click(within(dialog).getByRole("button", { name: "OK" }));

      expect(await screen.findByText("An account already exists for this email.")).toBeInTheDocument();
    });

    /**
     * Story 6.25 AC7. The `✕` on a form the admin has typed into must ask before throwing it away, and the
     * one on an untouched form must not - a question nobody needs is the defect that pass documented on
     * two hero-image forms, in the opposite direction.
     */
    it("asks before discarding a form that has been typed into", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      await user.click(await screen.findByRole("button", { name: "Add account" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Email"), "newcomer@example.com");
      await user.click(within(dialog).getByTestId("dialog-close"));

      expect(await screen.findByText("Discard changes?")).toBeInTheDocument();
    });

    it("closes an untouched form without asking", async () => {
      stubFetch();
      const user = userEvent.setup();
      renderList();

      await user.click(await screen.findByRole("button", { name: "Add account" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByTestId("dialog-close"));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.queryByText("Discard changes?")).toBeNull();
    });
  });
});

/**
 * Story 5.10 review additions.
 *
 * Three gaps the first pass left, each of which would have shipped green: AC5's submit was never pressed, a
 * network failure stranded the surface, and a row with two memberships had no distinguishable controls -
 * which is itself why every fixture above carries at most one.
 */
describe("AdminUsersList — review additions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * AC5's main flow, end to end through the dialog. The picker's *contents* were asserted twice before this
   * and its submit not at all, which matters more than usual here: this dialog uses non-native MUI selects,
   * where the rest of the codebase uses `SelectProps={{ native: true }}` so a spread `register` wires up. If
   * the wiring ever breaks, the symptom is that `role` silently ships its default on every attach - so the
   * assertion is on the request body carrying *both* chosen values, not on the dialog closing.
   */
  it("sends the chosen trip and the chosen role when the attach form is submitted", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch();
    renderList();

    await clickRowMenuItem(user, "nobody@example.com", /add to trip/i);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /trip/i }));
    await user.click(await screen.findByRole("option", { name: /Stranger Trip/ }));

    await user.click(within(dialog).getByRole("combobox", { name: /role/i }));
    await user.click(await screen.findByRole("option", { name: /contributor/i }));

    await user.click(within(dialog).getByRole("button", { name: /^ok$/i }));

    await waitFor(() => {
      expect(calls).toEqual([
        {
          path: "/api/admin/users/user-nobody/memberships",
          method: "POST",
          body: { tripId: "trip-stranger", role: "CONTRIBUTOR" },
        },
      ]);
    });
  });

  /**
   * The review's `high` finding. `mutate` guarded `response.json()` and not the `fetch`, so a rejected send -
   * offline, connection reset, server restart mid-click - escaped as an unhandled rejection and every busy
   * flag stayed set: the row froze behind a spinner with no message, recoverable only by reloading.
   *
   * Asserted as the two things the admin experiences: a message appears, and the buttons come back.
   */
  it("reports a failure and re-enables the row when the request never completes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/auth/csrf") {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "test-token" }, error: null }) };
      }
      if (path === "/api/admin/users" && (init?.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { users: USERS, trips: TRIPS }, error: null }),
        };
      }
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    renderList();
    await clickRowMenuItem(user, "nobody@example.com", /make administrator/i);

    expect(await screen.findByText(/unable to change the role/i)).toBeInTheDocument();
    /*
      Story 5.11 moved the grant control into the menu, so "the buttons come back" is now a claim about the
      **trigger**: it is what carries `disabled={busy}`, and a `busy` flag left set would leave the row with
      no way to reach any of its three actions at all - strictly worse than the frozen button this case was
      written for, because the menu cannot even be opened to see them.
    */
    const row = await rowFor("nobody@example.com");
    await waitFor(() => {
      expect(
        within(row).getByRole("button", { name: "More actions for nobody@example.com" }),
      ).toBeEnabled();
    });
  });

  /**
   * Two memberships on one row. Before the `aria-label`s the role toggle's whole accessible name was the
   * target role and detach's named no trip, so this fixture rendered two buttons called "Contributor" and two
   * called "Remove from trip" - which `getByRole` cannot tell apart either, and is the reason no such fixture
   * existed. The assertion is that each control names the trip it acts on, and that pressing one acts on
   * *that* trip.
   */
  it("names the trip in each membership control, so two memberships are distinguishable", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch({
      users: [
        USERS[0],
        {
          id: "user-two",
          email: "two@example.com",
          role: "OWNER" as const,
          ownedTrips: [],
          memberships: [
            { id: "m-a", tripId: "trip-a", tripName: "Trip A", role: "VIEWER" as const },
            { id: "m-b", tripId: "trip-b", tripName: "Trip B", role: "VIEWER" as const },
          ],
        },
      ],
      trips: [
        { id: "trip-a", name: "Trip A", ownerEmail: "stranger@example.com" },
        { id: "trip-b", name: "Trip B", ownerEmail: "stranger@example.com" },
      ],
    });
    renderList();

    const row = await rowFor("two@example.com");

    /*
      Four controls, four distinct names - two role selects and two trash glyphs after Story 5.11. The names
      are what this case is about, and the restyle did not weaken them: the select is named by a hidden label
      naming its trip **and the account**, and the glyph by an `aria-label` naming both as well. The
      account was missing from the select until review: this case could not see it, because `within(row)`
      makes one row's two names distinct as long as the trips differ. The page-scope case below is the one
      that catches it.
    */
    within(row).getByRole("combobox", { name: "Role for Trip A (two@example.com)" });
    within(row).getByRole("combobox", { name: "Role for Trip B (two@example.com)" });
    within(row).getByRole("button", { name: /remove.*Trip A/i });
    within(row).getByRole("button", { name: /remove.*Trip B/i });

    // And the one pressed is the one that acts - through the confirmation 5.11 added.
    await user.click(within(row).getByRole("button", { name: /remove.*Trip B/i }));
    const confirm = await screen.findByRole("dialog");
    await user.click(within(confirm).getByRole("button", { name: "Remove share" }));

    await waitFor(() => {
      expect(calls).toEqual([
        {
          path: "/api/admin/users/user-two/memberships",
          method: "DELETE",
          body: { tripId: "trip-b" },
        },
      ]);
    });
  });

  /**
   * The attach picker marks a trip the account is already a member of, and seeds the role select from that
   * membership. Without it, choosing such a trip and leaving the default silently demoted a `CONTRIBUTOR` to
   * `VIEWER` — an `upsert`, so it wrote, and the reload afterwards showed the new value as if it were asked
   * for. Asserted on the submitted role, which is the only place the demotion was visible.
   */
  it("does not demote an existing contributor when its trip is picked and the role left alone", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch({
      users: [
        USERS[0],
        {
          id: "user-contrib",
          email: "contrib@example.com",
          role: "OWNER" as const,
          ownedTrips: [],
          memberships: [
            { id: "m-c", tripId: "trip-shared", tripName: "Shared Trip", role: "CONTRIBUTOR" as const },
          ],
        },
      ],
      trips: [{ id: "trip-shared", name: "Shared Trip", ownerEmail: "stranger@example.com" }],
    });
    renderList();

    await clickRowMenuItem(user, "contrib@example.com", /add to trip/i);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /trip/i }));
    // The option says which role is already held, so the admin is not choosing blind.
    await user.click(await screen.findByRole("option", { name: /Shared Trip.*Contributor/i }));
    await user.click(within(dialog).getByRole("button", { name: /^ok$/i }));

    await waitFor(() => {
      expect(calls).toEqual([
        {
          path: "/api/admin/users/user-contrib/memberships",
          method: "POST",
          body: { tripId: "trip-shared", role: "CONTRIBUTOR" },
        },
      ]);
    });
  });
});
