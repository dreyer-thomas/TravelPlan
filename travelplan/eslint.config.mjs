import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /**
     * `react-hooks/set-state-in-effect` was newly enforced as "error" by eslint-config-next 16.2.x.
     * Downgraded to "warn" *only* for the files below, so the rule stays an error everywhere else and
     * cannot be re-introduced by new code.
     *
     * The list is derived from an actual `npx eslint --format json .` run, not from intent: 17 sites
     * across these 10 files. It was 21 across 12 until the four trip dialogs were given one mount per
     * open (`useOpenInstanceKey`), which deleted their hand-written reset-on-open clusters outright and
     * took `TripDayTravelSegmentDialog.tsx` and `TripShareDialog.tsx` off this list entirely.
     *
     * What is left, so the next reader does not have to re-derive it — and it is **not** uniformly
     * benign:
     *
     * - *Async loads guarded by a cancel flag* — a `let cancelled/active` closed over by the fetch, so
     *   nothing writes state after unmount. What the rule actually points at is the synchronous line
     *   ahead of the request (`setLoading(true)`, an empty-list clear on the not-applicable branch, a
     *   fallback polyline), and for those it is a known false positive: `TripDayPrintPage`,
     *   `TripDayMapFullPage`'s route effect, `TripDayView`'s route effect,
     *   `TripAccommodationDialog`'s and `TripDayPlanDialog`'s gallery/documents loaders.
     * - *Async loads with no such guard* — an effect that calls a `useCallback` which sets loading,
     *   error and result state after an `await`. These are real findings, not false positives: they can
     *   write into an unmounted component and are the ones a future story should convert.
     *   `TripsDashboard`, `TripTimeline`, `TripOverviewMapFullPage`, `TripDayMapFullPage`'s day load,
     *   `TripDayView`'s day load *and* its separate bucket-list load, `HeaderMenu`'s CSRF fetch.
     * - *State mirrored from props* — `HeaderMenu`'s `authState` (a prop that also flips locally on
     *   sign-out) and `TripDayView`'s day-meta seed. Both would be render-phase derivations or a key.
     * - *A dialog opened from the URL* — `TripDayView`'s deep-link effect. It genuinely reacts to an
     *   external system (the query string), so the setState is the point; only its shape is at issue.
     * - *`TripDayPlanDialog`'s payment normalisation* — the split/single row count, reconciled from
     *   the mode and the current rows. Deliberately an effect: it converges over several passes and is
     *   suppressed on the open pass by `skipPaymentNormalization`.
     * - *`TripImportDialog`'s `!open` reset cluster* — the last dialog still carrying one. It is the
     *   same anti-pattern the four trip dialogs just shed, and the same fix would apply; tracked as
     *   DW-266 so this line has somewhere to point rather than describing a permanent state of affairs.
     */
    files: [
      "src/components/HeaderMenu.tsx",
      "src/components/features/trips/TripAccommodationDialog.tsx",
      "src/components/features/trips/TripDayMapFullPage.tsx",
      "src/components/features/trips/TripDayPlanDialog.tsx",
      "src/components/features/trips/TripDayPrintPage.tsx",
      "src/components/features/trips/TripDayView.tsx",
      "src/components/features/trips/TripImportDialog.tsx",
      "src/components/features/trips/TripOverviewMapFullPage.tsx",
      "src/components/features/trips/TripTimeline.tsx",
      "src/components/features/trips/TripsDashboard.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
