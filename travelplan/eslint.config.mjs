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
    // react-hooks/set-state-in-effect was newly enforced as "error" by
    // eslint-config-next 16.2.x. These 21 sites across 12 pre-existing files need real
    // refactors (see deferred-work.md) — downgraded to warn *only here* so
    // lint stays green without masking the rule for new code elsewhere.
    files: [
      "src/components/HeaderMenu.tsx",
      "src/components/features/trips/TripAccommodationDialog.tsx",
      "src/components/features/trips/TripDayMapFullPage.tsx",
      "src/components/features/trips/TripDayPlanDialog.tsx",
      "src/components/features/trips/TripDayPrintPage.tsx",
      "src/components/features/trips/TripDayTravelSegmentDialog.tsx",
      "src/components/features/trips/TripDayView.tsx",
      "src/components/features/trips/TripImportDialog.tsx",
      "src/components/features/trips/TripOverviewMapFullPage.tsx",
      "src/components/features/trips/TripShareDialog.tsx",
      "src/components/features/trips/TripTimeline.tsx",
      "src/components/features/trips/TripsDashboard.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
