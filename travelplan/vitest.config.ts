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
    },
  },
});
