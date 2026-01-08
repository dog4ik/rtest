/// <reference types="vitest/config" />

// Configure Vitest (https://vitest.dev/config/)

import { defineConfig } from "vite";
import "allure-vitest/reporter";

export default defineConfig({
  test: {
    setupFiles: ["allure-vitest/setup"],
    // We need to share singletons like database connections between all tests.
    maxWorkers: 1,
    includeSource: ["src/**/*.ts"],
    testTimeout: 120 * 1000,
    environment: "node",
    exclude: ["dist/**/*", "node_modules/**/*"],
    watch: false,
    maxConcurrency: 10,
    reporters: [
      "verbose",
      [
        "allure-vitest/reporter",
        {
          resultsDir: "allure-results",
        },
      ],
    ],
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
    },
  },
  define: {
    "import.meta.vitest": "undefined",
  },
});
