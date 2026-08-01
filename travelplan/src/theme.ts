import { createTheme, type Shadows } from "@mui/material/styles";
import { createElement, type CSSProperties } from "react";

declare module "@mui/material/styles" {
  interface Palette {
    tokens: {
      ink: string;
      inkSoft: string;
      inkMuted: string;
      border: string;
      borderStrong: string;
      card: string;
      cardAlt: string;
      paperOuter: string;
      accentSoft: string;
      travelNeutral: string;
      warnBg: string;
      warnBgRow: string;
      warnBorder: string;
      pillNeutral: string;
    };
  }
  interface PaletteOptions {
    tokens?: Palette["tokens"];
  }

  interface TypographyVariants {
    display: CSSProperties;
    heading: CSSProperties;
    metricLg: CSSProperties;
    cardTitle: CSSProperties;
    kicker: CSSProperties;
    labelCaps: CSSProperties;
  }
  interface TypographyVariantsOptions {
    display?: CSSProperties;
    heading?: CSSProperties;
    metricLg?: CSSProperties;
    cardTitle?: CSSProperties;
    kicker?: CSSProperties;
    labelCaps?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    display: true;
    heading: true;
    metricLg: true;
    cardTitle: true;
    kicker: true;
    labelCaps: true;
  }
}

const colors = {
  paperOuter: "#EFEAE0",
  paper: "#F7F4EC",
  card: "#FFFFFF",
  cardAlt: "#FBF9F4",
  ink: "#2B2A26",
  inkSoft: "#6B675C",
  // Darkened from #8A8677 (3.65:1 on `card` white) to 4.55:1 - the engineering contrast target this
  // system works to under the PRD's "basic best practices (contrast)" clause. It is not a claim of
  // conformance to any formal accessibility level (see EXPERIENCE.md, Accessibility Floor).
  // Chosen as the *lightest* value that clears 4.5:1 while preserving the original's warm-grey channel
  // deltas exactly (R-G = 4, G-B = 15), so no surface shifts toward a cold grey.
  inkMuted: "#7A7667",
  border: "#E4DFD3",
  borderStrong: "#D9D0BE",
  accent: "#4B6358",
  accent2: "#7C9483",
  accentSoft: "#E7EDE7",
  travelNeutral: "#B9B2A0",
  warn: "#8A5A2B",
  warnBg: "#F6ECE0",
  // A second, weaker warn tint, for whole-row gap fills only. The mockups deliberately carry both:
  // `warnBg` over a pill, badge, error input or coverage segment, `warnBgRow` over the much larger
  // area of a full day-row / trip-row. See mockups/trips-list-share-login.html:173 (row) vs :209 (pill).
  warnBgRow: "#FBF6EE",
  warnBorder: "#E3C7A2",
  // The neutral pill track behind the `upcoming` and `past` trip-status states. Neither `cardAlt` nor
  // `warnBg` substitutes - both read as a different state. mockups/trips-list-share-login.html:210-211.
  pillNeutral: "#F1ECE1",
  errorBorder: "#C97A3E",
};

const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const modalShadow = "0 24px 60px rgba(30,28,20,.18)";
const shadows: Shadows = [
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  "none",
  modalShadow,
];

const checkboxIcon = createElement("svg", {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  "aria-hidden": true,
  children: createElement("rect", {
    x: 1,
    y: 1,
    width: 18,
    height: 18,
    rx: 4,
    fill: "none",
    stroke: colors.borderStrong,
    strokeWidth: 1.5,
  }),
});

const checkboxCheckedIcon = createElement("svg", {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  "aria-hidden": true,
  children: [
    createElement("rect", {
      key: "box",
      x: 1,
      y: 1,
      width: 18,
      height: 18,
      rx: 4,
      fill: colors.accent,
    }),
    createElement("path", {
      key: "check",
      d: "M5.5 10.5l3 3 6-6.5",
      fill: "none",
      stroke: "#FFFFFF",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  ],
});

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: colors.accent, contrastText: "#FFFFFF" },
    secondary: { main: colors.accent2 },
    warning: { main: colors.warn },
    // Drawn from existing tokens rather than MUI's stock #d32f2f red and stock green, so `<Alert
    // severity="error">` / `severity="success"` and every MUI-derived `helperText` error colour come
    // from the design system instead of from MUI's defaults. No component-local `sx` needed.
    //
    // `error.main` is the *border/edge* token, so it is deliberately NOT used as a fill behind white
    // text: white on #C97A3E is 3.31:1. Two places would otherwise do exactly that, and both are
    // redirected below rather than by a component `sx` - `MuiButton.containedError` (the two
    // `color="error" variant="contained"` delete confirms) and `MuiFormHelperText.Mui-error`.
    error: { main: colors.errorBorder },
    success: { main: colors.accent },
    // `info` too, for the same reason `error` and `success` are here: without it MUI's stock #0288d1
    // blue is the one non-token colour left on an alert, and the warm token border the `MuiAlert`
    // override draws would frame a cold blue box. `travelNeutral` is the system's existing
    // "connective tissue, not a destination" neutral, which is what an informational notice is.
    info: { main: colors.travelNeutral },
    background: { default: colors.paper, paper: colors.card },
    text: { primary: colors.ink, secondary: colors.inkSoft },
    tokens: {
      ink: colors.ink,
      inkSoft: colors.inkSoft,
      inkMuted: colors.inkMuted,
      border: colors.border,
      borderStrong: colors.borderStrong,
      card: colors.card,
      cardAlt: colors.cardAlt,
      paperOuter: colors.paperOuter,
      accentSoft: colors.accentSoft,
      travelNeutral: colors.travelNeutral,
      warnBg: colors.warnBg,
      warnBgRow: colors.warnBgRow,
      warnBorder: colors.warnBorder,
      pillNeutral: colors.pillNeutral,
    },
  },
  typography: {
    fontFamily: "var(--font-body), \"Calibri\", \"Arial\", sans-serif",
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
    body1: { fontSize: "13.5px", fontWeight: 600 },
    body2: { fontSize: "11.5px", fontWeight: 600 },
    display: {
      fontFamily: fontStack,
      fontSize: "28px",
      fontWeight: 900,
      letterSpacing: "-0.4px",
      lineHeight: 1.15,
    },
    heading: {
      fontFamily: fontStack,
      fontSize: "21px",
      fontWeight: 900,
      letterSpacing: "-0.3px",
    },
    metricLg: {
      fontFamily: fontStack,
      fontSize: "30px",
      fontWeight: 900,
      letterSpacing: "-0.5px",
    },
    cardTitle: {
      fontFamily: fontStack,
      fontSize: "14.5px",
      fontWeight: 700,
    },
    kicker: {
      fontFamily: fontStack,
      fontSize: "11px",
      fontWeight: 800,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
    },
    labelCaps: {
      fontFamily: fontStack,
      fontSize: "10.5px",
      fontWeight: 800,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
  },
  shape: { borderRadius: 8 },
  shadows,
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          "&.MuiInputLabel-shrink": {
            backgroundColor: "#ffffff",
            padding: "0 6px",
            marginLeft: -6,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(17, 18, 20, 0.08)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 6,
          paddingInline: 20,
          paddingBlock: 10,
          // MUI's own contained-button focus indicator is `boxShadow: theme.shadows[6]`, and the
          // `shadows` array above is blanked everywhere except index 24 - so without this every
          // `variant="contained"` button in the app computes to `outline: none` / `box-shadow: none`
          // and shows nothing at all under keyboard focus. EXPERIENCE.md's Accessibility Floor makes
          // visible focus an unconditional baseline commitment.
          //
          // A 4px accent halo (what the inputs use) would be accent-on-accent on a filled primary
          // button and invisible, so the ring is a 2px `ink` outline with an offset: high contrast
          // against the accent fill, the card white and the paper column alike, and built from an
          // existing token rather than a new one. Lives here rather than in a per-screen `sx` so
          // non-auth buttons ("Neue Reise", dialog footers) get it too.
          "&.Mui-focusVisible": {
            outline: `2px solid ${colors.ink}`,
            outlineOffset: "2px",
          },
        },
        containedPrimary: {
          backgroundColor: colors.accent,
          color: "#FFFFFF",
          fontWeight: 800,
        },
        // `palette.error.main` is `errorBorder` #C97A3E, an edge token. MUI derives `contrastText`
        // "#FFFFFF" for it, which lands the label of the two `color="error" variant="contained"`
        // delete confirms (TripDeleteDialog, TripBucketListPanel) at 3.31:1 - below this system's
        // 4.5:1 target, and *worse* than the #d32f2f these buttons rendered before the `error` entry
        // existed. So the destructive fill steps to `warn` #8A5A2B, the darkest member of the same
        // terracotta family, where a white label measures 5.87:1. Fixed here rather than at the two
        // call sites so no third one can reintroduce the thin fill.
        containedError: {
          backgroundColor: colors.warn,
          color: "#FFFFFF",
          fontWeight: 800,
        },
        outlined: {
          backgroundColor: colors.card,
          borderColor: colors.borderStrong,
          color: colors.ink,
          fontWeight: 700,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined",
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 6,
          backgroundColor: colors.cardAlt,
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: colors.accent,
            borderWidth: 2,
          },
          "&.Mui-focused": {
            backgroundColor: colors.card,
            boxShadow: "0 0 0 4px rgba(75,99,88,.18)",
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: colors.accent,
            borderWidth: 2,
          },
          "&.Mui-error": {
            backgroundColor: colors.warnBg,
          },
          "&.Mui-error .MuiOutlinedInput-notchedOutline": {
            borderColor: colors.errorBorder,
          },
          "&.Mui-focused.Mui-error": {
            boxShadow: "0 0 0 4px rgba(201,122,62,.18)",
          },
        },
        notchedOutline: {
          borderColor: colors.borderStrong,
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          minHeight: 44,
          borderRadius: 6,
          backgroundColor: colors.card,
          display: "flex",
          alignItems: "center",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          backgroundColor: colors.paperOuter,
          padding: 4,
          minHeight: 44,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 6,
          color: colors.inkSoft,
          backgroundColor: "transparent",
          "&.Mui-selected": {
            backgroundColor: "#FFFFFF",
            boxShadow: "0 1px 3px rgba(30,28,20,.12)",
          },
        },
      },
    },
    MuiCheckbox: {
      defaultProps: {
        icon: checkboxIcon,
        checkedIcon: checkboxCheckedIcon,
      },
      styleOverrides: {
        root: {
          padding: 12,
        },
      },
    },
    // DESIGN.md:251 is explicit that an error field's inline message below it is `warn` #8A5A2B.
    // `FormField` already forced that locally; every component that reaches for a raw `TextField`
    // instead (TripEditDialog, TripShareDialog, TripBucketListPanel, TripDayTravelSegmentDialog,
    // TripImportDialog, TripAccommodationDialog) inherited MUI's `palette.error.main` - #d32f2f
    // before this story, #C97A3E after it, which is 3.31:1 on card white and reads as an input
    // border rather than as text. Lifting the rule to the theme puts every error line in the app on
    // the one colour the design system assigns to it, at 5.87:1.
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          "&.Mui-error": { color: colors.warn },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        // `AlertRoot` is `styled(Paper)`, so the `MuiPaper` root override above already draws
        // `1px solid rgba(17, 18, 20, 0.08)` on every alert. Restating `border` here *replaces* that
        // edge rather than adding a second one (Alert's own styles are emitted after Paper's), which
        // is what keeps the severity borders below from reading as a double rule. All four tints are
        // MUI-derived from the palette entries above, which are themselves tokens.
        //
        // The `root` border is a fallback, not the border any alert in the app actually renders: the
        // default `standard` variant always resolves one of the four severity slots below, and those
        // are emitted after `root`. It exists so a future `variant="outlined"` / `"filled"` alert -
        // there are none today - gets a token edge instead of the `MuiPaper` rgba.
        root: {
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
        },
        standardError: { border: `1px solid ${colors.errorBorder}` },
        standardWarning: { border: `1px solid ${colors.warnBorder}` },
        standardSuccess: { border: `1px solid ${colors.accent2}` },
        standardInfo: { border: `1px solid ${colors.borderStrong}` },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 10,
          boxShadow: "var(--shadow-modal)",
        },
      },
    },
  },
});

export default theme;
