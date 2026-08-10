// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import { Alert, Button, Checkbox, IconButton, MenuItem, Tab, Tabs } from "@mui/material";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HeaderMenu from "@/components/HeaderMenu";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import FullscreenPhotoViewer from "@/components/ui/FullscreenPhotoViewer";
import { ON_PHOTO_CHROME } from "@/components/features/trips/TripIcons";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * DW-65 / DW-154 — the app-wide focus ring reaches icon buttons.
 *
 * `theme.test.tsx` pins the override on the theme *object*; this suite is the half that is worth more,
 * because the object was never the thing in doubt. Three claims can only be made against rendered
 * components under real MUI: that a control which had no ring now has one, that `ON_PHOTO_CHROME`'s
 * white ring still beats the new theme rule (the precondition DW-154 names before the fix is allowed
 * to land), and that the rule stopped at `IconButton` instead of reaching every `ButtonBase`
 * descendant in the app.
 *
 * **jsdom cannot match `:focus-visible`**, so nothing here tabs. The class MUI itself applies,
 * `Mui-focusVisible`, is added directly and the resolved cascade is read off `getComputedStyle` — the
 * same substitution `dialogCloseAffordance.test.tsx` and `formPrimitives.test.tsx` already use. That
 * makes this a test of the *cascade*, which is where every one of these bugs lived; that the browser
 * puts the class on at the right moment is MUI's own contract and is owed a manual pass regardless.
 *
 * The `outline` shorthand is read, never `outlineWidth`/`-Style`/`-Color`: jsdom exposes no longhands
 * for it and each of them comes back as the empty string, which compares equal to nothing useful.
 *
 * One limit of the harness, stated because the on-photo assertions below turn on style *ordering* and
 * that is the one thing this cannot fully model: `renderWithProviders` mounts `ThemeProvider` alone,
 * while production also wraps `AppRouterCacheProvider` and `CssBaseline` (`src/app/theme-registry.tsx`).
 * So these run against emotion's default cache. A future change to the cache options — `enableCssLayer`,
 * `prepend`, a different key — could reorder MUI's output in the browser and leave every assertion here
 * green, which is a second reason the browser pass this change owes is owed.
 */

const INK_RING = "2px solid #2B2A26";
const WHITE_RING = "2px solid #FFFFFF";
/** MUI's `ButtonBase` ships `outline: 0`, and this is how jsdom serialises it. */
const NO_RING = "0px";

/**
 * Adds the class MUI's own focus-visible detection would add, and returns the resolved ring.
 *
 * Asserts the `before` state on the way through rather than leaving it to each caller: "it has a ring"
 * is a much weaker claim than "it had none and now has one", and for the previously-ringless controls
 * below the second half is the entire bug.
 */
const ringAfterFocus = (button: HTMLElement) => {
  expect(getComputedStyle(button).outline).toBe(NO_RING);
  button.classList.add("Mui-focusVisible");
  return {
    outline: getComputedStyle(button).outline,
    outlineOffset: getComputedStyle(button).outlineOffset,
  };
};

// `HeaderMenu` reads the route to mark the current page, and probes `/api/auth/csrf` on mount. Neither
// is what this file is about; both have to exist or the component cannot render at all.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

let fetchMock: ReturnType<typeof csrfOnlyFetch>;

/**
 * Installed through `stubFetch` rather than by assigning `global.fetch` directly, and torn down in
 * `afterEach`. DW-69 is open against suites that leak a raw assignment; the fact that nothing has been
 * bitten by one yet is a property of `vitest.config.ts`'s `fileParallelism: false` / single fork, which
 * is a config default no test file should quietly depend on.
 */
const csrfOnlyFetch = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("/api/auth/csrf")) {
      return mockFetchResponse({ data: { csrfToken: "test-token" }, error: null });
    }
    return mockFetchResponse({ data: null, error: { code: "server_error", message: "boom" } }, { status: 500 });
  });

beforeEach(() => {
  fetchMock = stubFetch(csrfOnlyFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("icon buttons that had no focus ring at all (DW-65)", () => {
  /**
   * The control DW-65 was filed against, and the reason it is first: it is the app's global navigation
   * affordance, it sits on the near-white app bar where an `ink` ring is the right one, and a keyboard
   * user who cannot see where focus is has no way into the menu at all. Asserted through the real
   * `HeaderMenu` rather than a bare `<IconButton>`, because the control also carries its own `sx`
   * (`border: none`, `borderRadius: 0`, a 32px box) and a synthetic stand-in could not tell you that
   * none of it removes the ring the theme now supplies.
   */
  it("puts the ring on the header's Open menu hamburger", async () => {
    renderWithProviders(<HeaderMenu isAuthenticated isAdmin={false} />);
    // The mount probe settles into a `setState`; awaiting it keeps that inside `act`.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const trigger = screen.getByRole("button", { name: /open menu/i });
    expect(ringAfterFocus(trigger)).toEqual({ outline: INK_RING, outlineOffset: "2px" });
  });

  /**
   * A second real site, chosen because it is the least like the first: it is `size="small"`, it is
   * wrapped in a `Tooltip`, and `component={Link}` renders it as an `<a>` rather than a `<button>`.
   * If the override had been written against an element or a variant rather than against
   * `MuiIconButton-root`, this is the one that would have been missed.
   */
  it("puts the ring on the map panel's expand control, anchor element and all", () => {
    renderWithProviders(<TripOverviewMapPanel points={[]} missingLocations={[]} expandHref="/trips/t1/map" />);

    const expand = screen.getByTestId("trip-overview-map-expand");
    expect(expand.tagName).toBe("A");
    expect(ringAfterFocus(expand)).toEqual({ outline: INK_RING, outlineOffset: "2px" });
  });

  /**
   * The other half of a conditional rule, and the one a careless override breaks: nothing may gain a
   * resting outline. A `MuiIconButton.styleOverrides.root` written one nesting level too shallow — the
   * `outline` lifted out of its `&.Mui-focusVisible` wrapper — would put a permanent 2px box around
   * every icon button in the app and pass every other assertion in this file.
   */
  it("leaves every icon button ringless while nothing is focused", async () => {
    renderWithProviders(
      <>
        <HeaderMenu isAuthenticated isAdmin={false} />
        <TripOverviewMapPanel points={[]} missingLocations={[]} expandHref="/trips/t1/map" />
        <IconButton aria-label="bare">x</IconButton>
      </>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const iconButtons = document.querySelectorAll(".MuiIconButton-root");
    // A floor rather than an exact count: the point is that the loop below has something to check, not
    // how many icon buttons these two components happen to render this month.
    expect(iconButtons.length).toBeGreaterThanOrEqual(3);
    for (const button of iconButtons) expect(getComputedStyle(button).outline).toBe(NO_RING);
  });
});

describe("on-photo chrome still outranks the theme (DW-154's precondition)", () => {
  /**
   * The check DW-154 makes a condition of the fix. An `ink` ring on a hero photo is ink-on-near-black,
   * so `ON_PHOTO_CHROME` inverts it — and until this change it was inverting a rule that only reached
   * MUI `Button`s. Now it has to beat one that reaches the six `IconButton`s too.
   *
   * It does not win on specificity, and it does not win by one class beating another. Both rules compile
   * to the *identical* selector and are emitted as two separate rules in two separate `<style>` elements,
   * ink first and white second, because `sx` is the final style argument in MUI's `styled()` composition.
   * So what decides is the order emotion inserts them into the document — a dependency on MUI's internal
   * composition order and on emotion's insertion behaviour, not on anything CSS guarantees. Which is
   * exactly why it is measured against real MUI here instead of being reasoned about.
   */
  it("keeps the white ring on all three FullscreenPhotoViewer controls", () => {
    renderWithProviders(
      <FullscreenPhotoViewer
        open
        startIndex={1}
        images={[
          { key: "a", imageUrl: "/uploads/a.webp", alt: "Photo 1" },
          { key: "b", imageUrl: "/uploads/b.webp", alt: "Photo 2" },
        ]}
        onClose={vi.fn()}
      />,
    );

    for (const name of [/close/i, /previous photo/i, /next photo/i]) {
      const control = screen.getByRole("button", { name });
      expect(ringAfterFocus(control)).toEqual({ outline: WHITE_RING, outlineOffset: "2px" });
    }
  });

  /**
   * The same spread on a bare `IconButton`, so the day hero's two chevrons and its overflow trigger are
   * covered by the mechanism rather than by three more renders of a screen that needs a trip, a day and
   * a Leaflet map to exist. What is being pinned is the precedence, and precedence does not know which
   * component the `sx` arrived on.
   *
   * The chevrons compose *two* objects — `sx={{ ...ON_PHOTO_CHROME, ...HERO_CHEVRON_BACKING, ... }}`
   * (`TripDayView.tsx:2809`, `:2829`) — so the second spread is modelled here rather than the simpler
   * one-object shape: object spread is last-key-wins, and a focus key arriving after `ON_PHOTO_CHROME`
   * would clobber the white ring before the cascade ever saw it. State the limit plainly, because this
   * does not close it: `HERO_CHEVRON_BACKING` is module-local to `TripDayView` and cannot be imported
   * here, so what is pinned is that a trailing spread of the *shape* production uses is harmless today —
   * not that the real one stays that way. It carries `backgroundColor` and `&:hover` only, checked
   * against `TripDayView.tsx:277`.
   */
  it("keeps the white ring wherever the chrome is spread", () => {
    const chevronBackingShape = {
      backgroundColor: "rgba(20,18,14,.38)",
      "&:hover": { backgroundColor: "rgba(20,18,14,.52)" },
    };
    renderWithProviders(
      <IconButton aria-label="hero chevron" sx={{ ...ON_PHOTO_CHROME, ...chevronBackingShape }}>
        x
      </IconButton>,
    );

    const control = screen.getByRole("button", { name: "hero chevron" });
    expect(ringAfterFocus(control)).toEqual({ outline: WHITE_RING, outlineOffset: "2px" });
    // Not merely "not ink": the white ring is the whole point, and a dropped `sx` would read as ink.
    expect(getComputedStyle(control).outline).not.toBe(INK_RING);
  });
});

describe("the override stopped at IconButton", () => {
  /**
   * Why `MuiIconButton` and not `MuiButtonBase`, stated as a test rather than as a comment. `Button`,
   * `MenuItem`, `Tab` and `Checkbox` all extend `ButtonBase`, and all four already carry deliberate
   * treatment in `theme.ts`; a base-level ring would have restyled focus on four component families to
   * fix one, which is the change the ledger entries were careful not to ask for.
   *
   * What is asserted is the *absence of a leak from this override*, not the absence of a ring. The
   * distinction is load-bearing, and the three are not in the same state: measured here, `MenuItem` does
   * get a focus treatment — MUI's own `rgba(0, 0, 0, 0.12)` background, which this theme does not remove —
   * while `Tab` and `Checkbox` change nothing at all on `Mui-focusVisible`, no outline, no background, no
   * shadow. Whether that clears EXPERIENCE.md's Accessibility Floor ("visible focus state required on all
   * interactive elements") is its own open question, and whoever closes it should not be met by a failure
   * from a test filed under `IconButton` scope. So the assertion is `not.toBe(INK_RING)` — a leak shows up
   * as this override's exact value — rather than `toBe(NO_RING)`, which would freeze the gap as a
   * requirement and would already be false for `MenuItem`'s background.
   */
  it("does not leak the icon-button ring onto the other ButtonBase descendants", () => {
    renderWithProviders(
      <>
        <MenuItem>Row</MenuItem>
        <Tabs value={0}>
          <Tab label="One" />
        </Tabs>
        <Checkbox inputProps={{ "aria-label": "tick" }} />
      </>,
    );

    for (const selector of [".MuiMenuItem-root", ".MuiTab-root", ".MuiCheckbox-root"]) {
      const element = document.querySelector(selector) as HTMLElement;
      expect(element).not.toBeNull();
      // Not an `IconButton`, so nothing the override says can reach it in the first place.
      expect(element.classList.contains("MuiIconButton-root")).toBe(false);
      element.classList.add("Mui-focusVisible");
      expect(getComputedStyle(element).outline).not.toBe(INK_RING);
    }
  });

  /**
   * The override reaches further than the `<IconButton` sites anyone can grep for, and that is worth
   * pinning rather than discovering. MUI composes `IconButton` internally, so `Alert`'s `onClose` slot is
   * one — `AdminUsersList`'s error alert renders it — and it takes this ring without a line of app code
   * mentioning it. Correct by the Accessibility Floor, but it means the blast radius of anything ever
   * added to this override is "every icon button MUI renders", not "the twenty in `src/`", which is why
   * `theme.test.tsx` forbids geometry there.
   */
  it("reaches the icon buttons MUI renders internally, not just the ones src/ writes", () => {
    renderWithProviders(
      <Alert severity="error" onClose={vi.fn()}>
        boom
      </Alert>,
    );

    const close = screen.getByRole("button", { name: /close/i });
    expect(close.classList.contains("MuiIconButton-root")).toBe(true);
    expect(ringAfterFocus(close)).toEqual({ outline: INK_RING, outlineOffset: "2px" });
  });

  /**
   * And the rule the new one was copied from still holds on its own component. Icon buttons were given
   * the *same* ring rather than a similar one, so the two being indistinguishable at the rendered level
   * is the claim — one focus ring in the app, stated twice because MUI splits the components.
   */
  it("leaves contained buttons on the ring they already had, and it is the same ring", () => {
    renderWithProviders(
      <>
        <Button variant="contained">Save</Button>
        <IconButton aria-label="icon">x</IconButton>
      </>,
    );

    const contained = ringAfterFocus(screen.getByRole("button", { name: "Save" }));
    const icon = ringAfterFocus(screen.getByRole("button", { name: "icon" }));

    expect(contained).toEqual({ outline: INK_RING, outlineOffset: "2px" });
    expect(icon).toEqual(contained);
  });
});
