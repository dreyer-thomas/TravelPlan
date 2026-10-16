import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    testTimeout: 15000,
    pool: "forks",
    fileParallelism: false,
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
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
