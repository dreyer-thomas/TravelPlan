import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    globals: true,
    testTimeout: 15000,
    pool: "forks",
    // Files run in parallel: every file has its own worker id, so its own SQLite copy of the migrated
    // template (`test/globalSetup.ts`) and its own media root (`test/setup.ts`). Four forks took a full run
    // from ~30 to ~6 minutes on Windows with identical results. `TEST_MAX_FORKS=1` restores the old serial run.
    fileParallelism: true,
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: Math.max(1, Number(process.env.TEST_MAX_FORKS) || 4),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.join(rootDir, "src"),
      // Story 12.1. `src/lib/ai/*` imports "server-only" so a client import fails the Next build. Its
      // default export condition throws by design; Next resolves the `react-server` one (an empty
      // module) for server code, and the tests run as server code, so they get the same empty module.
      "server-only": path.join(rootDir, "node_modules/server-only/empty.js"),
    },
  },
});
