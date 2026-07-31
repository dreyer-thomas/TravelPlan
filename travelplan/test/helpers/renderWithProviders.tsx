import { render } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";
import theme from "@/theme";

type Language = "en" | "de";

/**
 * Wraps a component in the providers the app actually mounts it under.
 *
 * The theme wrapper is not optional: components reading `theme.palette.tokens.*` throw under MUI's
 * bare default theme, so every render of a token-consuming component needs it. Keeping the tree in
 * one place means adding the next provider is a one-line change rather than ~65 call-site edits.
 */
export const Providers = ({ children, language = "en" }: { children: ReactNode; language?: Language }) => (
  <ThemeProvider theme={theme}>
    <I18nProvider initialLanguage={language}>{children}</I18nProvider>
  </ThemeProvider>
);

export const renderWithProviders = (ui: ReactElement, options: { language?: Language } = {}) =>
  render(<Providers language={options.language}>{ui}</Providers>);
