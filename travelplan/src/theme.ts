import { createTheme } from "@mui/material/styles";

const shadowColor = "0 20px 50px rgba(17, 18, 20, 0.12)";
const shadows: string[] = ["none"];
for (let i = 1; i < 25; i += 1) {
  shadows.push(shadowColor);
}

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#f15a24", contrastText: "#ffffff" },
    secondary: { main: "#1f3b5b" },
    background: { default: "#f6f7f9", paper: "#ffffff" },
    text: { primary: "#111214", secondary: "#4b4f56" },
  },
  typography: {
    fontFamily: "var(--font-body), 'Source Sans 3', sans-serif",
    h1: { fontFamily: "var(--font-display), 'Fraunces', serif", fontWeight: 700 },
    h2: { fontFamily: "var(--font-display), 'Fraunces', serif", fontWeight: 700 },
    h3: { fontFamily: "var(--font-display), 'Fraunces', serif", fontWeight: 700 },
    h4: { fontFamily: "var(--font-display), 'Fraunces', serif", fontWeight: 700 },
    h5: { fontFamily: "var(--font-display), 'Fraunces', serif", fontWeight: 700 },
    h6: { fontFamily: "var(--font-display), 'Fraunces', serif", fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  shadows,
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
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
          borderRadius: 999,
          paddingInline: 20,
          paddingBlock: 10,
        },
        containedPrimary: {
          boxShadow: "0 16px 28px rgba(241, 90, 36, 0.28)",
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined",
      },
      styleOverrides: {
        root: {
          backgroundColor: "#ffffff",
          borderRadius: 14,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: "#ffffff",
        },
      },
    },
  },
});

export default theme;
