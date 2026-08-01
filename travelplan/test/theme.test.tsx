// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { Alert } from "@mui/material";
import { describe, expect, it } from "vitest";
import theme from "@/theme";
import { ON_PHOTO_CHROME } from "@/components/features/trips/TripIcons";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 7.11's guardrail on the token contract itself.
 *
 * These assertions read the theme object rather than a rendered screen on purpose: the values below
 * are consumed by ~20 `<Alert>` call sites and ~27 `helperText` usages across the app, so pinning them
 * once here is cheaper and more honest than asserting a derived colour on each surface.
 */
describe("theme token contract", () => {
  it("carries the two row/pill tokens that were previously hardcoded in the icon module", () => {
    // AC1-AC3: `ROW_GAP_BG` and `NEUTRAL_PILL_BG` moved out of `TripIcons.tsx` into the palette. The
    // hexes must not have moved with them - the swap corrects the specification, it does not restyle.
    expect(theme.palette.tokens.warnBgRow).toBe("#FBF6EE");
    expect(theme.palette.tokens.pillNeutral).toBe("#F1ECE1");
    // Distinct from `warnBg`, which keeps serving pills, badges, error inputs and coverage segments.
    expect(theme.palette.tokens.warnBg).toBe("#F6ECE0");
    expect(theme.palette.tokens.warnBgRow).not.toBe(theme.palette.tokens.warnBg);
  });

  it("clears the 4.5:1 contrast target for inkMuted on card, and stays a warm grey", () => {
    // AC4. 4.5:1 is this system's engineering contrast target under the PRD's "basic best practices
    // (contrast)" clause - not a claim of conformance to any formal accessibility level.
    const srgb = (hex: string) =>
      [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const luminance = (hex: string) => {
      const [r, g, b] = srgb(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const { inkMuted, card } = theme.palette.tokens;
    expect(contrast(inkMuted, card)).toBeGreaterThanOrEqual(4.5);
    // The old value, for contrast with the above: it did not clear the target.
    expect(contrast("#8A8677", card)).toBeLessThan(4.5);

    // Still a warm grey, not a cold one: red >= green > blue, same channel ordering as the original.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(inkMuted.slice(i, i + 2), 16));
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
  });

  it("draws error and success from design tokens instead of MUI's defaults", () => {
    // AC7. Without these, `<Alert severity="error">` renders MUI's #d32f2f and every MUI-derived
    // error `helperText` follows it - neither colour exists in DESIGN.md.
    expect(theme.palette.error.main).toBe("#C97A3E");
    expect(theme.palette.error.main).not.toBe("#d32f2f");
    expect(theme.palette.success.main).toBe("#4B6358");
    // Both are existing tokens, reused rather than introduced.
    expect(theme.palette.success.main).toBe(theme.palette.primary.main);
    // `info` too, or MUI's #0288d1 blue would be the one stock colour left on an alert, framed by the
    // warm token border `MuiAlert` draws.
    expect(theme.palette.info.main).toBe(theme.palette.tokens.travelNeutral);
    expect(theme.palette.info.main).not.toBe("#0288d1");
  });

  it("never puts a white label on the thin error edge token", () => {
    // `error.main` #C97A3E is an *edge* colour; MUI derives contrastText "#FFFFFF" for it, which is
    // 3.31:1 - worse than the #d32f2f these buttons rendered before `palette.error` existed. The two
    // `color="error" variant="contained"` delete confirms take the darkest member of the same
    // terracotta family instead, where a white label is 5.87:1.
    const containedError = theme.components?.MuiButton?.styleOverrides?.containedError as Record<string, unknown>;
    expect(containedError).toBeDefined();
    expect(containedError.backgroundColor).toBe("#8A5A2B");
    expect(containedError.color).toBe("#FFFFFF");
    expect(containedError.backgroundColor).not.toBe(theme.palette.error.main);
  });

  it("puts every inline error line on the one colour DESIGN.md assigns to it", () => {
    // DESIGN.md:252 - an error field's message below it is `warn` #8A5A2B. `FormField` forced this
    // locally; the six components that use a raw `TextField` inherited `palette.error.main` instead.
    const helper = theme.components?.MuiFormHelperText?.styleOverrides?.root as Record<string, unknown>;
    expect(helper?.["&.Mui-error"]).toEqual({ color: "#8A5A2B" });
  });

  it("draws exactly one border on an Alert, not one from MuiPaper plus one from MuiAlert", () => {
    // Trap 4 from the story: `AlertRoot` is `styled(Paper)`, and `MuiPaper.styleOverrides.root`
    // already puts `1px solid rgba(17, 18, 20, 0.08)` on it. The `MuiAlert` severity borders must
    // *replace* that edge, not stack a second rule on top of it.
    renderWithProviders(
      <>
        <Alert severity="error">boom</Alert>
        <Alert severity="success">saved</Alert>
      </>,
    );

    const error = screen.getByText("boom").closest(".MuiAlert-root") as HTMLElement;
    const success = screen.getByText("saved").closest(".MuiAlert-root") as HTMLElement;

    for (const [el, expected] of [
      // errorBorder #C97A3E and accent2 #7C9483 - both existing tokens.
      [error, "rgb(201, 122, 62)"],
      [success, "rgb(124, 148, 131)"],
    ] as const) {
      const computed = getComputedStyle(el);
      expect(computed.borderTop).toBe(`1px solid ${expected}`);
      // The single resolved colour is the severity's, not `MuiPaper`'s rgba(17, 18, 20, 0.08) - if the
      // two declarations were stacking rather than replacing, this would still read as the rgba().
      expect(computed.borderColor).toBe(expected);
      expect(computed.borderColor).not.toContain("rgba");
      expect(computed.borderTopWidth).toBe("1px");
    }
  });

  it("gives every contained button a visible keyboard focus ring", () => {
    // AC6. jsdom does not implement `:focus-visible`, so this cannot be asserted end-to-end by
    // focusing a button - the override's presence on the theme object is what is checkable here. The
    // rendered ring is owed a manual browser check on both an auth screen and a non-auth button.
    const root = theme.components?.MuiButton?.styleOverrides?.root as Record<string, unknown>;
    expect(root).toBeDefined();
    // MUI's own contained-button focus indicator is `boxShadow: shadows[6]`, and `shadows` is blanked
    // everywhere except index 24 - so an outline is the only thing that can carry focus here.
    expect(theme.shadows[6]).toBe("none");
    expect(root["&.Mui-focusVisible"]).toEqual({
      outline: `2px solid ${theme.palette.tokens.ink}`,
      outlineOffset: "2px",
    });
    // ...except on a hero photo, where an ink ring is ink-on-near-black. `ON_PHOTO_CHROME` inverts it
    // for its two MUI `Button` consumers (TripTimeline's share action, TripDayView's back link).
    expect(ON_PHOTO_CHROME["&.Mui-focusVisible"]).toEqual({
      outline: "2px solid #FFFFFF",
      outlineOffset: "2px",
    });
  });
});
