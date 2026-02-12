import styles from "./page.module.css";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import HeaderMenu from "@/components/HeaderMenu";
import HomeHero from "@/components/HomeHero";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-fraunces",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source-sans",
});

export default function Home() {
  return (
    <div className={`${styles.page} ${sourceSans.variable} ${fraunces.variable}`}>
      <div className={styles.backdrop} aria-hidden="true" />
      <main className={styles.main}>
        <header className={styles.topbar}>
          <HeaderMenu isAuthenticated={false} />
          <span className={styles.brand}>TravelPlan</span>
        </header>
        <HomeHero />
      </main>
    </div>
  );
}
