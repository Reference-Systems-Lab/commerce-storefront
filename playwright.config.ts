import { defineConfig, devices } from "@playwright/test";

// The browser check (REQ-012), run in the pinned Playwright image against a running storefront:
// http://storefront-web:3000 in the CI stub, or a local server in development (BASE_URL).
export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  // The workspace is mounted read-only in the browser container.
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  use: { baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3000" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
