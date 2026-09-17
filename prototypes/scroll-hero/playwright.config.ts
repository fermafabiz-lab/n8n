import { defineConfig } from "@playwright/test";

// Runs against the production build (`next build` first, then `next start`)
// so what is measured is what would ship. Chromium comes from the
// preinstalled Playwright browsers; nothing is downloaded.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    screenshot: "off",
    launchOptions: {
      // Use the Chromium already on the box instead of the revision this
      // Playwright version would download. Unset PW_CHROMIUM to let
      // Playwright manage its own browser.
      executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
    },
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
