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
      warnBorder: string;
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
  inkMuted: "#8A8677",
  border: "#E4DFD3",
  borderStrong: "#D9D0BE",
  accent: "#4B6358",
  accent2: "#7C9483",
  accentSoft: "#E7EDE7",
  travelNeutral: "#B9B2A0",
  warn: "#8A5A2B",
  warnBg: "#F6ECE0",
  warnBorder: "#E3C7A2",
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
      warnBorder: colors.warnBorder,
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
        },
        containedPrimary: {
          backgroundColor: colors.accent,
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
