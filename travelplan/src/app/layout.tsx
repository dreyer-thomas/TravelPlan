import type { Metadata } from "next";
import ThemeRegistry from "@/app/theme-registry";
import { getServerLanguage } from "@/i18n/server";
import { I18nProvider } from "@/i18n/provider";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelPlan",
  description: "TravelPlan trip planning",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialLanguage = await getServerLanguage();

  return (
    <html lang={initialLanguage}>
      <body>
        <I18nProvider initialLanguage={initialLanguage}>
          <ThemeRegistry>{children}</ThemeRegistry>
        </I18nProvider>
      </body>
    </html>
  );
}
