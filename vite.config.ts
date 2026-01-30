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
    environment: "node",
    exclude: ["dist/**/*", "node_modules/**/*"],
    watch: false,
    testTimeout: 45_000,
    projects: [
      {
        extends: true,
        test: {
          maxConcurrency: 20,
          include: ["./test/global.test.ts"],
          name: "all",
        },
      },
      {
        extends: true,
        test: {
          maxConcurrency: 10,
          include: ["test/**/*.test.{ts,js}"],
          exclude: ["test/global.test.ts"],
          name: "default",
        },
      },
      {
        extends: true,
        test: {
          include: ["banking/**/*.test.{ts,js}"],
          name: "banking",
        },
      },
    ],
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
