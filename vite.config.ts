/// <reference types="vitest/config" />

// Configure Vitest (https://vitest.dev/config/)

import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["playwright", "chromium-bidi"],
  },
  test: {
    // We need to share singletons like database connections between all tests.
    maxWorkers: 1,
    includeSource: ["src/**/*.ts"],
    testTimeout: 120 * 1000,
    environment: "node",
    exclude: ["dist/**/*", "node_modules/**/*"],
    watch: false,
    maxConcurrency: 10,
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
