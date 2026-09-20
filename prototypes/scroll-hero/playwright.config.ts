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
    // Builds, THEN starts. It used to be `npm run start` alone, under a
    // comment claiming it built first — so a run would happily test whatever
    // was last compiled into .next. A whole suite once passed against a build
    // that predated the section it was meant to be checking.
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    // Not reused for the same reason: a server someone left running is a
    // server from some other commit. Better to fail loudly on a busy port.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
