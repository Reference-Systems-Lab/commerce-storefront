import { defineConfig } from "vitest/config";

// Unit tests cover the plain TypeScript in app/lib; pages are checked in a real browser (e2e/).
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["app/lib/**/*.ts"],
      exclude: ["app/lib/**/*.test.ts"],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
