import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/bindings/**"],
      thresholds: {
        functions: 90,
        lines: 80,
        statements: 80,
        branches: 60,
      },
    },
  },
});
