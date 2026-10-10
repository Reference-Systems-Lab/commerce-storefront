import { defineConfig, devices } from "@playwright/test";

// The browser check (REQ-012), run in the pinned Playwright image against a running storefront. In the
// stub it shares storefront-web's network and browses http://localhost:3000 (BASE_URL), a trustworthy
// origin like the platform's HTTPS one.
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
