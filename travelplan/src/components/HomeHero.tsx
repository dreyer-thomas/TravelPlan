"use client";

import Link from "next/link";
import styles from "../app/page.module.css";
import { useI18n } from "@/i18n/provider";

type HomeHeroProps = {
  showHowItWorks?: boolean;
};

export default function HomeHero({ showHowItWorks = true }: HomeHeroProps) {
  const { t } = useI18n();

  return (
    <>
      <section className={styles.hero}>
        <p className={styles.kicker}>{t("home.kicker")}</p>
        <div className={styles.heroCopy}>
          <h1 className={styles.title}>{t("home.title")}</h1>
          <p className={styles.subtitle}>
            {t("home.subtitle")}
          </p>
        </div>
        <div className={styles.ctas}>
          <Link className={styles.primary} href="/auth/register">
            {t("home.cta.createAccount")}
          </Link>
          <Link className={styles.secondary} href="/auth/login">
            {t("home.cta.signIn")}
          </Link>
        </div>
      </section>
      {showHowItWorks && (
        <section id="how-it-works" className={styles.howItWorks}>
          <div className={styles.sectionHeading}>
            <p className={styles.sectionKicker}>{t("home.howItWorks.kicker")}</p>
            <h2 className={styles.sectionTitle}>{t("home.howItWorks.title")}</h2>
            <p className={styles.sectionIntro}>{t("home.howItWorks.intro")}</p>
          </div>
          <div className={styles.stepsGrid}>
            <div className={styles.card}>
              <span className={styles.stepIndex}>01</span>
              <h3>{t("home.howItWorks.step1.title")}</h3>
              <p>{t("home.howItWorks.step1.body")}</p>
            </div>
            <div className={styles.card}>
              <span className={styles.stepIndex}>02</span>
              <h3>{t("home.howItWorks.step2.title")}</h3>
              <p>{t("home.howItWorks.step2.body")}</p>
            </div>
            <div className={styles.card}>
              <span className={styles.stepIndex}>03</span>
              <h3>{t("home.howItWorks.step3.title")}</h3>
              <p>{t("home.howItWorks.step3.body")}</p>
            </div>
            <div className={styles.card}>
              <span className={styles.stepIndex}>04</span>
              <h3>{t("home.howItWorks.step4.title")}</h3>
              <p>{t("home.howItWorks.step4.body")}</p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
