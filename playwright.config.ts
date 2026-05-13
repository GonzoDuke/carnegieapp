import { defineConfig, devices } from "@playwright/test";

// Carnegie smoke tests. Dev server is hit on http://localhost:3000;
// Playwright will reuse an already-running `npm run dev` if one's up,
// otherwise it spins one up itself.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60 * 1000,
  expect: { timeout: 15 * 1000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    video: "retain-on-failure",
    // Quick-add ISBN lookup hits external providers; give navigation a
    // generous budget so a slow OpenLibrary response doesn't flake.
    navigationTimeout: 30 * 1000,
    actionTimeout: 15 * 1000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
