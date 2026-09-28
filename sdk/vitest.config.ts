import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // batch-orchestrator.test.ts is written against node:test (see CONTRIBUTING),
    // so vitest cannot collect it. Run it with `node --test`.
    exclude: ["node_modules/**", "dist/**", "src/batch-orchestrator.test.ts"],
  },
});
