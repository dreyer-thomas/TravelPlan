"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../app/page.module.css";

export default function HomeHero() {
  const [isOpen, setIsOpen] = useState(false);
  const sectionId = "how-it-works";

  const handleToggle = () => {
    if (!isOpen) {
      setIsOpen(true);
    }
    requestAnimationFrame(() => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  return (
    <>
      <section className={styles.hero}>
        <p className={styles.kicker}>Plan with calm clarity</p>
        <h1 className={styles.title}>A trip planner that keeps the whole journey in view.</h1>
        <p className={styles.subtitle}>
          Organize stays, daily plans, and costs in one clear timeline. Start with the skeleton, fill the details,
          and see gaps disappear.
        </p>
        <div className={styles.ctas}>
          <Link className={styles.primary} href="/auth/register">
            Create account
          </Link>
          <Link className={styles.secondary} href="/auth/login">
            Sign in
          </Link>
          <button
            type="button"
            className={styles.secondary}
            onClick={handleToggle}
            aria-expanded={isOpen}
            aria-controls={sectionId}
          >
            See how it works
          </button>
        </div>
      </section>
      <section
        id={sectionId}
        className={`${styles.howItWorks} ${!isOpen ? styles.howItWorksCollapsed : ""}`}
        data-open={isOpen}
      >
        <div className={styles.sectionHeading}>
          <p className={styles.sectionKicker}>How it works</p>
          <h2 className={styles.sectionTitle}>A calm, four-step planning flow.</h2>
          <p className={styles.sectionIntro}>
            Start with the trip outline, add what you know, and let the timeline reveal what still needs attention.
          </p>
        </div>
        <div className={styles.stepsGrid}>
          <div className={styles.card}>
            <span className={styles.stepIndex}>01</span>
            <h3>Set the date range</h3>
            <p>Start a trip with start and end dates to generate the full timeline instantly.</p>
          </div>
          <div className={styles.card}>
            <span className={styles.stepIndex}>02</span>
            <h3>Add stays and anchors</h3>
            <p>Drop in lodging and fixed plans so the core structure feels real right away.</p>
          </div>
          <div className={styles.card}>
            <span className={styles.stepIndex}>03</span>
            <h3>Fill day-by-day plans</h3>
            <p>Layer in activities, notes, and links to keep each day clear and actionable.</p>
          </div>
          <div className={styles.card}>
            <span className={styles.stepIndex}>04</span>
            <h3>Review gaps and costs</h3>
            <p>Use the timeline to spot open days, missing stays, and budget totals at a glance.</p>
          </div>
        </div>
      </section>
    </>
  );
}
