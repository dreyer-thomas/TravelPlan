import type { Language } from "@/i18n";

/**
 * Renders a cent amount as a locale-placed currency string.
 *
 * `style: "currency"` rather than a bare number, because the symbol's position is locale-dependent:
 * German needs "1.234,50 €", not "€1.234,50". Currency is hardcoded EUR app-wide - there is no
 * per-trip currency field, and adding one is recorded as deferred work rather than guessed at here.
 *
 * Intended as the home for this formatter, but it is not yet the only one: `TripTimeline.tsx` and
 * `TripDayView.tsx` each still carry an identical local copy, and rewriting those screens was outside
 * Story 7.4's scope. `TripCostOverview.tsx` was folded in here by Story 7.13. Point new code here,
 * and fold the other two in when a story next owns them - the duplication is recorded in
 * `deferred-work.md`.
 */
export const formatCost = (cents: number, language: Language) =>
  new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
