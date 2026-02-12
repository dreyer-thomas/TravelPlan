import Link from "next/link";
import { cookies } from "next/headers";
import styles from "./page.module.css";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import HeaderMenu from "@/components/HeaderMenu";

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

export default async function Home() {
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get("session")?.value);

  return (
    <div className={`${styles.page} ${sourceSans.variable} ${fraunces.variable}`}>
      <div className={styles.backdrop} aria-hidden="true" />
      <main className={styles.main}>
        <header className={styles.topbar}>
          <HeaderMenu isAuthenticated={hasSession} />
          <span className={styles.brand}>TravelPlan</span>
        </header>
        <section className={styles.hero}>
          <p className={styles.kicker}>Plan with calm clarity</p>
          <h1 className={styles.title}>A trip planner that keeps the whole journey in view.</h1>
          <p className={styles.subtitle}>
            Organize stays, daily plans, and costs in one clear timeline. Start with the skeleton, fill the
            details, and see gaps disappear.
          </p>
          <div className={styles.ctas}>
            <Link className={styles.primary} href="/auth/register">
              Create account
            </Link>
            <Link className={styles.secondary} href="/auth/login">
              Sign in
            </Link>
            <Link className={styles.secondary} href="#highlights">
              See how it works
            </Link>
          </div>
        </section>
        <section id="highlights" className={styles.highlights}>
          <div className={styles.card}>
            <h2>Overview first</h2>
            <p>Instantly see missing stays, open days, and budget totals without digging.</p>
          </div>
          <div className={styles.card}>
            <h2>Set vs. open</h2>
            <p>Every day shows what’s confirmed and what’s still a loose idea.</p>
          </div>
          <div className={styles.card}>
            <h2>Designed for travel</h2>
            <p>Clean, calm layouts built for planning on desktop and checking plans on mobile.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
