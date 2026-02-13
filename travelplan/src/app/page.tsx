import { cookies } from "next/headers";
import styles from "./page.module.css";
import HeaderMenu from "@/components/HeaderMenu";
import HomeHero from "@/components/HomeHero";
import { verifySessionJwt } from "@/lib/auth/jwt";

const resolveAuthState = async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return false;

  try {
    await verifySessionJwt(token);
    return true;
  } catch {
    return false;
  }
};

export default async function Home() {
  const isAuthenticated = await resolveAuthState();
  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <main className={styles.main}>
        <header className={styles.topbar}>
          <HeaderMenu isAuthenticated={isAuthenticated} />
          <span className={styles.brand}>TravelPlan</span>
        </header>
        <HomeHero showHowItWorks={!isAuthenticated} />
      </main>
    </div>
  );
}
