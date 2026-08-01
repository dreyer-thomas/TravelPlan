import type { ReactNode } from "react";

/**
 * Exists solely so the auth screens are NOT descendants of `(routes)/layout.tsx`, which mounts
 * `AppHeader`. The split-screen hero/form shell fills the viewport and cannot render under an app
 * topbar (Story 7.6, AC3).
 *
 * Route groups do not appear in the URL, so `/auth/login` … `/auth/first-login-password` are
 * unchanged and `middleware.ts`'s URL-based matcher keeps working untouched.
 *
 * No `<html>`/`<body>` here — `src/app/layout.tsx` still owns those, `I18nProvider` and
 * `ThemeRegistry`.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
