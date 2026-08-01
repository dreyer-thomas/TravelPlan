import type { SxProps, Theme } from "@mui/material/styles";

/**
 * The primary submit treatment shared by all five auth screens.
 *
 * It exists for one reason beyond the 6px top offset: **MUI's contained-button focus indicator is
 * `boxShadow: theme.shadows[6]`, and `theme.ts` blanks every shadow except index 24.** So a
 * keyboard-focused primary button computes to `outline: none` / `box-shadow: none` and shows no focus
 * state at all — measured directly in the browser check for this story. `EXPERIENCE.md`'s
 * Accessibility Floor requires visible keyboard focus everywhere, and the auth screens are the app's
 * front door.
 *
 * A 4px accent halo (what the inputs use) would be accent-on-accent here and invisible, so the ring is
 * a 2px `ink` outline with an offset — high contrast against both the accent fill and the paper column,
 * and built from an existing token rather than a new one.
 *
 * The root cause is theme-wide: every `variant="contained"` button in the app has the same gap. Fixing
 * it there means editing `theme.ts`, which this story's scope boundary excludes, so it is recorded as
 * deferred work for the design-system pass instead of patched app-wide from an auth story.
 */
export const AUTH_SUBMIT_SX: SxProps<Theme> = {
  mt: "6px",
  "&.Mui-focusVisible": {
    outline: (theme) => `2px solid ${theme.palette.tokens.ink}`,
    outlineOffset: "2px",
  },
};
